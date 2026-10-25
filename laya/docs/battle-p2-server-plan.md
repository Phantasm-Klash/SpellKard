# 对战端 P2 加密：服务端落地规格

> 客户端侧已就绪并测试通过（SpellKard `6f31d12`）。本文是**服务端三仓**的落地规格。
> 背景与取舍见 `SpellKard/laya/docs/battle-wire-scheme.md` §P2。
>
> 编写：wire-p2，2026-10-26。配合并行会话 C4/S4（P7 计分），文件域已声明、无重叠。

---

## 0. 一句话结论

大厅签发会话密钥 → 两路分发（客户端随票据、对战服随启动参数）→ 对战端用 OpenSSL 的
ChaCha20-Poly1305 解封输入帧。**必须原子上线**，否则客户端一封、服务端不认 = 所有输入
被丢弃、对局全坏。

---

## 1. 现状盘点（2026-10-26 实测）

| 组件 | 状态 |
| --- | --- |
| 客户端 P2 | ✅ 已就绪（`BattleSessionInfo.sessionKey` / `battleKeyId`，带外密钥优先，首帧即密文，零握手） |
| `PhK-Protocol` | ✅ 已给 P7 计分字段编号（8-11，本次完成并推送 `85f5bb9`） |
| `Gensoulkyo` | 工作区干净，HEAD `d168ac3`，不领先 origin |
| `PhK-BattleServer` | 工作区干净，HEAD `bc95801`（S4 计分），不领先 origin |
| 依赖 | `third_party/` 仅 `ikcp` + `phk-protocol`；CMake 只依赖 **ZLIB**；**无 protobuf、无密码学库** |
| gateway 可用 | **OpenSSL 3.0.13**（头文件 + pkg-config 齐全）；libsodium 只有运行时、无头文件 → **用 OpenSSL** |

---

## 2. ★ 密钥分发：一个必须避开的落库陷阱

### 陷阱

`runtime/core/service_stores.go:issueBattleTicketRecordLocked` 把**整张签名票据**序列化落库：

```go
envelope, _ := json.Marshal(signed)        // 整个 SignedBattleTicket
record := BattleTicketRecord{ ..., TicketJSON: string(envelope), ... }
```

**所以会话密钥绝不能放进 `BattleTicket`（`runtime/core/types.go:533`）。**
放进去 = 明文进 `battle_tickets.ticket_json` 与审计表，任何有库读权限的人都能解密全部对局，
且对局结束后密钥仍滞留——加密形同虚设。

### 设计

密钥放在**响应 payload 顶层、与 `ticket` 并列**，不进 `SignedBattleTicket`：

```jsonc
{
  "ok": true,
  "ticket": { ... },              // 原样，被 ed25519 签名，照旧落库
  "signature_hex": "...",
  // ↓ 新增：会话密钥，不进 ticket、不进 TicketJSON、不被签名覆盖
  "battle_session": {
    "key_id": "bsess-<match_id>-<issued_ms>",
    "session_key_hex": "<64 hex = 32 bytes>"
  }
}
```

分发两路：

- **客户端**：上面的 `battle_session` 字段，与 `ticket` 同一响应下发。
- **对战服**：大厅生成后放进 **assignment** → `battle-agent` 的 `spawnArgs`
  （`cmd/battle-agent/main.go:586`）→ 对战服启动参数 `--session-key <hex> --session-key-id <id>`。

### 密钥生成

`crypto/rand` 读 32 字节，**按对局（match）生成一把**，所有座位共用：
nonce 含 `player_id` 与 `seq`，共用一把不会撞 nonce。

### 必须一并落实的三条纪律

1. 响应体**不整体打日志**（现有不少地方 `log.Printf("%+v", payload)`），下发前确认；
   必要时对 `battle_session` 做脱敏。
2. 密钥**不进** `battle_tickets` / `battle_ticket_audits` 任一行。
3. 对局结束后密钥随进程退出消失，**不持久化、不进 dem、不进回放**。

---

## 3. 密码学：用 OpenSSL，不手写

### 为什么

手写 ChaCha20-Poly1305 是 ~350 行且必须过 RFC 8439 全部向量；行业共识是**不要自己实现
密码学**。gateway 上 OpenSSL 3.0.13 头文件与 pkg-config 齐全，直接走 `EVP` 高级接口：

```cpp
EVP_CIPHER* cipher = EVP_CIPHER_fetch(nullptr, "ChaCha20-Poly1305", nullptr);
EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
EVP_DecryptInit_ex(ctx, cipher, nullptr, nullptr, nullptr);
EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_SET_IVLEN, nonce.size(), nullptr);
EVP_DecryptInit_ex(ctx, nullptr, nullptr, key.data(), nonce.data());
EVP_DecryptUpdate(ctx, nullptr, &len, aad.data(), (int)aad.size());   // AAD
EVP_DecryptUpdate(ctx, out, &len, ciphertext.data(), (int)ciphertext.size());
EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_SET_TAG, 16, tag.data());      // 期望 tag
EVP_DecryptFinal_ex(ctx, out + len, &finalLen);                        // 失败 = 伪造/篡改
```

### 必须校验的四项（顺序不能省）

1. `header.key_id` == 本进程配置的 key id（先比对，**不匹配直接丢**，省掉解密开销）
2. `auth_tag` 长度 == 16
3. `seq` 严格递增（现有 `seq_replay` 检查已覆盖，密文路径要复用同一张表）
4. nonce == `DevAeadNonceHex(header)`（现有 `protocol.cpp:466` 的算法，客户端同法派生）

第 4 项让它保持**确定性 nonce**，与现有 dev 校验一致，也天然防重放。

### 降级防护（不能漏）

配置 `--session-key` 的对局**只接受信封帧**；此时收到首字节 `0x03` 的明文输入帧 →
**拒绝**（否则攻击者剥掉信封发明文即可绕过）。未配置时行为与今天完全一致。

---

## 4. 信封解析：手写，不引 protobuf

`PhK-BattleServer` 不链 protobuf（CMake 只依赖 ZLIB），`PhK-Protocol/gen/cpp` 只是**常量
清单**、无序列化代码。信封只有 3 个字段、header 9 个，手写 wire 解析约 150 行，比引入
protobuf 运行时轻得多：

```
BattleEncryptedPacket:  1 header(0x0A len-delim) 2 ciphertext(0x12) 3 auth_tag(0x1A)
BattlePacketHeader:     1 version(0x0A) 2 match_id(0x12) 3 player_id(0x1A)
                        4 tick(0x20 varint) 5 seq(0x28) 6 ack(0x30)
                        7 payload_type(0x38) 8 key_id(0x42) 9 nonce(0x4A)
```

解析必须是**严格**的：长度越界、字段号未知、嵌套深度异常一律拒绝，不做"尽力解析"。

---

## 5. CI 连带影响（不改就红）

`PhK-BattleServer/.github/workflows/protocol-audit.yml` 里有**一条手写 g++ 命令**：

```yaml
g++ -std=c++17 -Iinclude -I../PhK-Protocol/gen/cpp \
    src/protocol.cpp src/result.cpp src/ticket.cpp src/handshake.cpp \
    src/kcp_endpoint.cpp src/server.cpp src/simulation.cpp \
    tests/battle_server_tests.cpp -o /tmp/phk_battle_tests
```

给 `protocol.cpp`（或新增的 `aead.cpp`）加 OpenSSL 调用后，这条命令**没有 `-lcrypto`，
会链接失败**。必须同步补上 `-lcrypto`（ubuntu-latest 自带 OpenSSL 开发包）。
`cpp-build.yml` 走 CMake，加 `find_package(OpenSSL REQUIRED)` 即可。

---

## 6. 上线计划（分两步，可秒级回滚）

**必须先做第 1 步、验证通过、再做第 2 步。** 顺序反了对局会全坏。

### 第 1 步：服务端具备解封能力，但**不启用**

- 对战端：信封解析 + OpenSSL 解封 + 参数接收；**未配置 `--session-key` 时行为与今天完全一致**
- `battle-agent`：`spawnArgs` 透传参数（assignment 没有该字段时不传 → 老行为）
- 大厅：**不下发** `battle_session`
- 门禁：gateway `ctest` 全绿 + `check` + CI 双绿
- 此时线上仍然是明文，**零风险**

### 第 2 步：大厅开始下发密钥

- 大厅签发会话密钥并随票据下发 + 放进 assignment
- 客户端拿到 `sessionKey` 立即密封；对战端解封
- **回滚**：大厅停止下发 `battle_session`（一个配置开关，秒级）→ 客户端回落明文

灰度建议：先按 `ruleset_version` 或房间标记只对测试房间下发，跑通若干场再全量。

---

## 7. 工作量与风险

| 项 | 量级 | 风险 |
| --- | --- | --- |
| Gensoulkyo：签发 + 双路分发 | 中 | 低（但要处理 §2 落库陷阱与日志脱敏） |
| battle-agent：参数透传 | 小 | 低（部署需重启服务） |
| PhK-BattleServer：手写信封解析 | 中 | 中（严格解析，边界必须测） |
| PhK-BattleServer：OpenSSL 解封 | 中 | **中高**（密码学校验顺序 + RFC 向量测试必须过） |
| CI：补 `-lcrypto` | 小 | 低（漏了就红，容易发现） |
| 端到端联调 | 中 | **高**（原子性：见 §6） |

---

## 8. 待确认（需用户/架构拍板）

1. **引入 OpenSSL 作为新的构建依赖**是否接受？（替代方案：手写 ChaCha20-Poly1305，
   不引依赖但自己实现密码学——不推荐）
2. 密钥是否**按对局共用一把**（推荐，nonce 已含 player_id/seq 不撞）
   还是每座位一把（更安全，但服务端要维护多把）？
3. 大厅下发的灰度开关用什么维度？（`ruleset_version` / 房间标记 / 账号白名单）
4. S→C 快照确认**不加密**（方案已定：公开广播状态，无保密性收益，且省 377 KB/s）。
