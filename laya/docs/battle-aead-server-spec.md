# 服务端补齐真实 AEAD 的规格（2026-10-24）

> 来源：客户端原生端加密实现的调研。**本文是给 `PhK-BattleServer`（C++ 对战端）用的**，
> 客户端已按此规格实现并验证，等服务端跟进后双方即可互通。
> 服务端逻辑本身不在客户端任务范围内，此处只记录「要改成什么样」。

## 一、现状：服务端目前是脚手架，不是真加密

`src/handshake.cpp` 的 `Accept()` 里：

```cpp
server_x25519_pub = FillDevBytes(match_id + ":server-pub");
```

`FillDevBytes` 是 **FNV-1a-64 + xorshift 的确定性填充**，不是 X25519 运算。
`hkdf-dev:...` 那个 key ref 也是一个**标签字符串**，不是派生出来的密钥。

服务端自己的文档也这么说：
- `docs/architecture.md:25`
- `README.md:31-32`
- `dev/progress.md:278`

都把「Real X25519/ECDHE and HKDF」「Real ChaCha20-Poly1305」列为待办。
全仓 grep 密码学实现 = 0。

**所以目前双方都没有真正加密**。客户端这次补上的是「能力就绪」，切换要等双方一起。

## 二、客户端已经就绪的部分

`src/platform/native/crypto/` + `src/platform/native/native_battle_crypto.ts`
（客户端仓，路径仅供对照）：

- X25519（RFC 7748，BigInt 梯子）
- HKDF-SHA256（RFC 5869）
- ChaCha20-Poly1305（RFC 8439）

会话密钥日程与 web 版 `WebCryptoKeyAgreement` **逐位一致**：

```
shared  = X25519(peer_pub, own_priv)
session = HKDF-SHA256(ikm = shared,
                      salt = clientRandom ‖ serverRandom,
                      info = "phk-battle-v1",
                      len  = 32)
```

→ native ≡ web，同一次握手推出同一把密钥。

## 三、必须严格对齐的形状（服务端强校验，错则 `nonce_mismatch` / `auth_tag_invalid`）

| 项 | 值 |
| --- | --- |
| nonce | **12 字节**（24 hex 字符）——恰好是 RFC 8439 的 96-bit nonce |
| auth tag | **16 字节**——恰好是 Poly1305 tag |
| `key_id` | 服务端下发的那一串（当前是 `hkdf-dev:<label>` 形式） |
| session key | 32 字节 |

### nonce 的字段集与顺序（客户端 `devBattleNonceHex()`）

服务端两处派生已被客户端**原样移植**并用 **MSVC 编译服务端自己的函数**产出黄金值比对，**7/7 一致**：

- `DevAeadNonceHex` → 客户端 `devBattleNonceHex()`（4/4，含 `tick = 2^64-1` 边界）
- `DevHandshakeKeyRef` → 客户端 `devHandshakeKeyRef()`（3/3）

## 四、AAD：服务端没有这个概念，需要先定一个约定

服务端代码里**完全没有 AAD**（grep 无命中），只有 nonce 绑头部。

客户端把 AAD 定为**与 nonce 完全相同的字段集 / 顺序 / 编码**：

```
direction ‖ key_id ‖ match_id ‖ player_id
        ‖ u64le(payload_type) ‖ u64le(tick) ‖ u64le(seq) ‖ u64le(ack)
```

这样服务端将来补 AEAD 校验时，可以**直接从它已经在解析的 header 重建**，
不需要新增任何协议字段。

> 服务端若采用别的 AAD 约定，必须同步给客户端，否则双方无法互通。

## 五、客户端侧还缺的一件事

`src/core/net/battle_client.ts` 目前**完全没有引用** `BattleCipher` / `KeyAgreement`，
即加密层尚未接进实际握手流程（`PlaintextCipher` / `UnsupportedKeyAgreement` 全仓零使用方）。

**接线时机必须与服务端同步**：如果客户端单方面切到真 X25519，
而服务端还在用 `FillDevBytes` 当公钥，双方会话密钥必然不同 → 对战直接坏。

推荐的切换顺序：

1. 服务端实现真 X25519 + HKDF-SHA256 + ChaCha20-Poly1305（按本文对齐形状）
2. 服务端在 `MatchServer` 里**先**接受明文 dev 会话，同时**也**接受 AEAD 会话
   （按 `key_id` / `aead` 协商字段区分）
3. 客户端接线（用 `devBattleNonceHex()` 填 `nonce_hex`、`devHandshakeKeyRef()` 填 `key_id`），
   先在 dev 开关后默认关
4. 双方各自打开开关，跑一轮互通
5. 关闭明文路径

## 六、原生端的两个后续项（客户端侧，不阻塞）

- **原生缺 OS 级 CSPRNG**：目前回退到 `Math.random()` + 计时抖动喂的 ChaCha20 DRBG，
  强度弱于浏览器。生产化建议加 LayaNative 扩展调 Windows CNG `BCryptGenRandom`，
  或推动 LayaAir 补上 `crypto.getRandomValues`（届时本实现自动切到 webcrypto 档位，无需改代码）。
  `randomSource()` 会如实报告当前档位。
- `XCHACHA20_POLY1305` 未实现（客户端始终广告 `CHACHA20_POLY1305`，不影响互通）。

## 七、客户端侧已完成的验证

- RFC 7748（公钥 / 共享秘密 / §5.2 迭代）、RFC 5869（TC1）、
  RFC 8439（§2.8.2 AEAD、§2.5.2 Poly1305）、FIPS 180-4、RFC 4231 —— 官方向量全过
- 与 Node 独立实现交叉验证：25 组随机 AEAD + 10 组随机 X25519 逐位一致
- **在真实 LayaNative 运行时内**（编译产物塞进真 `LayaBox.exe`，经 inspector 求值）9/9 全过，
  含端到端握手 + AEAD 互通
