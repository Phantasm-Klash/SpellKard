# 对战端线路方案：加密与压缩编码（2026-10-25）

> 起因：用户提出「对战端加密通信为了保证游戏信息的即时和高效，可能不需要这一层复杂加密
> 增加信息延时」，要求先调研常规游戏（CS、WoW、PUBG）的做法，再给出一套合理方案。
>
> 本文回答两件事：**该不该加密、加密什么**；以及**真正吃带宽和延迟的是什么、怎么改**。

---

## 0. 结论先行

1. **每包 AEAD 的 CPU 开销不是延迟问题**——它是纳秒级，而网络是毫秒级。真正会加延迟的是
   **带内握手多出来的一个 RTT**，以及**大快照在弱网下被拆成十几个 UDP 分片**（丢一片整帧废）。
2. **所以加密要做，但改成带外发密钥、只封输入面**；PKI/握手那套全砍。
3. **真正的大头是编码，不是加密**：服务端每 tick 广播的快照 **平均 6,434 字节、峰值 16,178
   字节**（实测 900 tick），60 Hz 下就是 **平均 377 KB/s、峰值 948 KB/s**。
   而其中 **95% 是 bullets 数组**——客户端本来就能从 `(seed, tick)` 确定性重现它。
   去掉后 **6,434 → 332 字节（-95%）**。
4. 推荐路线分三期，每期独立可上线、可回滚：
   - **P1 编码**：快照去掉 bullets + JSON 改定长二进制 → 带宽降 ~95%，顺带大幅降低丢片率与抖动。
   - **P2 加密**：带外会话密钥 + ChaCha20-Poly1305，只封客户端→服务端的输入面（43 B/帧）。
   - **P3 增量**：delta + bit-pack + 相关性剔除（需要时在弱网/大房间场景再做）。

---

## 1. 常规游戏怎么做的（调研）

### 1.1 World of Warcraft（TrinityCore / vmangos / AshamaneCore）— TCP，MMO

- 登录时用 **SRP6** 协商出 session key；世界服从 login DB 拿到同一把钥匙。
- **只加密包头（4~6 字节 = size + opcode），payload 从不加密。**
  加密用 ARC4/RC4（`AuthCrypt::DecryptRecv` / `EncryptSend`）。
- **大 payload 改为压缩**（deflate），且压缩仅在加密激活后（即认证后）才启用。
- 双连接模型：realm 通道 + instance 通道，后者用 `SMSG_CONNECT_TO` 的 key 续接同一会话。

> 设计取舍很直白：**加密包头是为了防 opcode 嗅探/注入/重放；payload 加密对 MMO 没意义，
> 因为客户端本地就有全部数据。** 带宽用压缩来省，不用加密来防。

### 1.2 CS:GO / CS2（Valve，Source）— UDP

- NetChannel 用 **16 字节 ICE key** 加密整条通道（Source 2007 起；2013 分支用 protobuf +
  Snappy 压缩）。
- 官方服：**动态 ICE key + PKI**；社区服：由 build number 派生的**静态 key**（等于没加密，
  可从内存读出）——这也说明 Valve 认为加密的**价值主要在服务端可控的场景**。
- CS:GO 1.35.6.0+ 开放**第三方通道密钥**：16 字节二进制 key + 32 位 key index，
  由第三方后端**分别**下发给客户端软件和第三方服务器（Faceit / ESEA 走这条路）。
  带外额外 256 字节 payload 明文传，**明确警告不要把密钥放进去**。
- **connectionless 包**（`0xFFFFFFFF` + `q`/`k`）永远明文——连接建立前没有密钥。
- CS2：64 tick + **sub-tick 输入时间戳**（输入带精确时刻，不再量化到 tick 边界）；
  SDR（Steam Datagram Relay）走 Valve 私有骨干网。
- 实测带宽极小：64 tick 下行 50~120 kbps、上行 30~80 kbps；128 tick 下行 80~200 kbps。

### 1.3 PUBG（UE4）— UDP / 自定义 RUDP

- 服务器权威，**30 Hz** tick；客户端预测 + 服务端纠正。
- **Replication Graph + 网格空间划分**：只给每个玩家发相关的实体更新（相关性剔除）。
- **分层传输**：
  - L1 关键（血量/死亡/武器状态）→ 可靠（UDP+ACK）
  - L2 实时（位置/朝向/射击）→ 不可靠 + 序号 + 预测
  - L3 非关键（聊天/表情/脚步）→ 不可靠，丢了就算
- 快照插值缓冲 ~100 ms 吸收抖动。BattlEye 在网络层做反作弊监测。

### 1.4 Overwatch（Blizzard）

- **输入滑动窗口冗余**（源自 QuakeWorld）：不是只发当前帧输入，而是把「最后一次被确认
  的状态到现在」的**全部输入**打包进一个包。丢包后下一个包自动补洞，不产生预测错误。
- 客户端自适应**时间刻度**：网络差时略微加速上报，服务端缓冲区同步放大。

### 1.5 DOOM3（id Software）— 位级压缩的经典范本

- **Delta 压缩**对客户端已 ack 的公共基快照做差。
- **位打包**：HP 虽是 int32，实际 0~100 → 7 bit；浮点取半精度。
- **变量级 delta**：1 bit「变没变」，变了才写值。
- **实体级 delta + PVS**（潜在可见集）位图；PVS 按 32 bit 分组，无变化只写 1 bit。
- **0-compressor**：delta 流里大量连续的 0，做 3 bit 游程编码，实测压缩比最高（最高 4:1）。
- **字段排序优化**：按变化频率分组排列，制造更多连续 0。

### 1.6 横向规律

| 维度 | 主流做法 |
| --- | --- |
| 密钥从哪来 | **带外**：登录/大厅服务认证后下发，或第三方后端分发；**不做带内 ECDHE 握手** |
| 加密什么 | 两极：MMO **只封包头**；竞技 FPS **封整条通道**（因为 43 B 级小包，成本可忽略） |
| 加密目的 | 防**注入/重放/篡改**为主，防**窃听**为辅（客户端本地本来就有数据） |
| 省带宽靠什么 | **压缩 + 相关性剔除 + 分层传输**，不靠加密 |
| 抗丢包 | 输入冗余窗口（OW）、输入 sub-tick 时间戳（CS2）、分层可靠性（PUBG） |

---

## 2. 现状实测（本项目，非估算）

用 `BossRaceSimulation`（`mvp-boss-race-s0`，seed 12345，2 名玩家，跑满 900 tick）实测：

| 项 | 字节 | 60 Hz 带宽 |
| --- | --- | --- |
| 客户端→服务端 输入帧 | **43 B** | **2.5 KB/s** |
| 服务端→客户端 快照（平均） | **6,434 B** | **377 KB/s** |
| 服务端→客户端 快照（峰值，104 颗子弹） | **16,178 B** | **948 KB/s** |
| 快照去掉 bullets（平均） | **332 B** | **19 KB/s** |

两个立刻可读出来的事实：

- **快照占了对战流量的 99.3%**，输入面只占 0.7%。
  → 任何讨论"加密会不会拖慢对战"的精力，都应该先花在快照上。
- **16 KB 的快照在 1200 B MTU 下要拆成 ~14 个 UDP 分片，丢任意一片整帧作废。**
  这才是真正的延迟/抖动来源，而且它随弹幕数量线性恶化。
  → **压缩不只是省带宽，它直接改善有效延迟**。这一点常被忽略。

---

## 3. 推荐方案

### P1. 编码（收益最大，风险最低，建议先做）

**P1.1 快照去掉 bullets 数组。**

弹幕是 `(seed, tick)` 的纯函数，客户端的 `BossRaceSimulation` 用的就是服务端同一套弹幕库
（这是 `canonicalStateHash` 能对上的前提）。服务端继续发 `state_hash`，客户端算出不一致就
硬同步——**这个自愈机制已经存在**。

- 收益：6,434 → 332 B（**-95%**）；峰值 16,178 → ~350 B。
- 风险：客户端预测落后/落后太多时会看到弹幕缺失。已有 `catchUpPrediction` 兜底
  （超过 600 tick 重播种）。建议加一条：**客户端 tick 落后服务端超过 N（建议 30）时，
  服务端才补发一次全量 bullets**——只在异常时付代价。

**P1.2 JSON 改定长二进制。**

332 B 的 JSON 里绝大部分是键名和十进制数字。改二进制：
`[type u8][tick varint][state u8][hash u64][player_count u8][per player: x i16, y i16, hp varint, dmg varint, flags u8]`
量化到合适精度（坐标 milli 用 i16 覆盖 ±320000 需 20 bit，可用 i24 或除以 16 量化到 i16）。

- 预期：332 B → **40~60 B**。60 Hz 下 **~3 KB/s**。
- 对照：CS:GO 128 tick 全量下行也才 80~200 kbps；我们做到这个量级即进入主流区间。

**P1.3（可选）分层 + 相关性剔除。**

参考 PUBG：玩家状态每 tick 发；Boss 血量/伤害变化降频（如 10 Hz）或只在变化时发。

### P2. 加密（改成带外密钥 + 只封输入面）

**P2.1 密钥带外下发，取消带内握手。**

大厅（Nakama）在签发 `battle.ticket` 时**同时**生成 32 字节对战会话密钥，随 ticket 一起
下发给客户端，并通过对战服回调下发给对战端。这与 CS:GO 第三方通道密钥（后端分别发给客户端
和服务器）和 WoW（realmd 把 session key 交给 worldd）是同一个模式。

- **省掉一个 RTT**：开战时不需要握手，第一个输入帧就是密文。
- **省掉一整套 X25519/HKDF 代码与失败模式**（原来是先明文再切密文的二阶段）。
- ticket 本来就是签名的、走 TLS 的，密钥放里面不引入新的中间人面。
- 保留 `key_id`：用于密钥轮换与服务端判新旧，不做密钥派生。

**P2.2 只封客户端→服务端。**

| 方向 | 内容 | 是否加密 | 理由 |
| --- | --- | --- | --- |
| C→S | Input / ModeAction / Reconnect / Ping（43 B/帧） | **是** | 作弊敏感面：注入输入、重放、篡改 tick/seq 全部在此 |
| S→C | 快照 / 事件 / 结果 | **否** | 公开广播状态，所有参与者都能看到；加密不增加保密性，还要付 377 KB/s→19 KB/s 的加密开销 |

这与 WoW「只封包头」是同一个判断：**加密是为了防伪造，不是为了防看。**

**P2.3 算法与开销。**

ChaCha20-Poly1305（已有实现，`core/net/battle_crypto.ts` + 原生 `spk_crypto`）。
43 B 帧的一次 seal ≈ **亚微秒级**；60 次/秒 = 可忽略。
对比：一次网络 RTT 是毫秒级，KCP 重传是毫秒级，**加密开销差了三个数量级**。

> 也就是说：用户担心的「复杂加密增加信息延时」，**在每包开销这一层不成立**；
> 成立的部分是**握手 RTT**——而 P2.1 已经把它消掉了。

**P2.4 关于 nonce。**

现行 `devBattleNonceHex` 用 FNV-1a 从 header 派生**确定性 nonce**，目的是让服务端能做
`nonce_mismatch` 校验。这在带外密钥模型下依然成立且更简单：
`nonce = u64le(key_id 序号) ‖ u32le(seq)`，单调递增 seq 天然防重放，
服务端只需记 `last_seq`（它已经在做 `seq_replay` 检查）。

### P3. 增量编码（按需再做）

- **Delta + bit-pack**：对齐 DOOM3 那套——对客户端已 ack 的基快照做差，1 bit changed 标志，
  坐标量化，0-run 游程。P1 之后基数已经很小（40~60 B），P3 的收益变成"锦上添花"，
  可以等真的出现弱网/大房间问题再做。
- **输入冗余窗口**（Overwatch）：每个输入包带上最近 N 帧的输入，丢包自动补洞。
  对 43 B 的包来说代价极小，收益明确，**建议提到 P1 一起做**。

---

## 4. 与现有代码的映射

| 方案项 | 客户端落点 | 状态 | 服务端落点（需配合） |
| --- | --- | --- | --- |
| 密钥带外下发 | `BattleSessionInfo.sessionKey` + `battleKeyId`；`selectBattleCipherWithSessionKey()` | **已落地** | Nakama 插件在 `battle.ticket` 里带 `session_key` / `key_id`；对战端从回调取 |
| 只封输入面 | `AeadDirection`；`sealsOutgoing()` / `opensIncoming()` 分离 | **已落地** | 对战端解析信封并校验 seq |
| 快照去 bullets | `decodeBossRaceSnapshot` 兼容无 bullets 字段；`BossRaceSimulation` 已能自算 | 待服务端 | `EncodeBossRaceSnapshotPayload` 去掉 bullets；落后时补发全量 |
| JSON→二进制 | 新增 `decodeBossRaceSnapshotBinary` | 待服务端 | 新增 `EncodeBossRaceSnapshotBinary`（字段表需与 `battle-aead-server-spec.md` 同规格锁定） |
| 输入冗余窗口 | `flushInputQueue` 每包附最近 N 帧 | 未做 | 服务端按 tick 去重后 `SubmitInput`（它本就拒绝 `tick <= current`） |

**客户端侧 P2 已完成的判据**（`tests/battle_handshake.test.ts`，16 例全绿）：

- 带外密钥会话的**第一个输入帧就是密文**，握手零往返；
- 只封 C→S 时，**明文快照广播不受影响**（这条是专门为"单标志管双向"那个坑写的回归）；
- `direction: 'both'` 时 S→C 也能正常解封；
- 有密钥无 `key_id` → 明文 + `battle_key_id_missing` 告警，**对局不被卡死**。

> 一个实现上的坑，值得记一笔：`isSealing()` 原来是一个标志同时管收发。新方案只封
> 输入面后，接收端会拿着明文快照去解封、逐帧判伪造。收发必须分成
> `sealsOutgoing()` / `opensIncoming()` 两个判断。

---

## 5. 风险与回滚

- **P1.1 依赖客户端弹幕库与服务端完全一致**。这是现状前提（`hashComparable` 为真即代表）。
  但一旦客户端换了弹幕时间线，去掉 bullets 会导致静默分叉。
  → 必须有 `state_hash` 校验 + 不匹配时的全量补发兜底，且**先灰度**。
- **P2 密钥泄露面**：ticket 通道必须 TLS；密钥不落盘、不进日志、不进 dem。
- **回滚**：P1/P2 各自做成服务端开关（按 `ruleset_version` 或房间标记区分），
  客户端同时支持新旧两种解码，先双跑再切。

---

## 6. 参考

- Valve Developer Wiki: *CS:GO Network Channel Encryption*
- WoWDev Wiki: *World Packet*（包头加密）；TrinityCore/AshamaneCore `AuthCrypt`
- PUBG: UE4 Replication Graph + 自定义 RUDP + 分层传输；30 Hz
- Overwatch（Tim Ford）: 输入滑动窗口 + 自适应时间刻度
- DOOM3 网络架构：delta + bit-pack + PVS + 0-compressor
- 本仓 `docs/battle-aead-server-spec.md`（原 AEAD 规格，P2 之后该文档需按本文修订）
