/**
 * 自机 loadout 的伤害查表 —— C++ `PhK-BattleServer/src/danmaku/player_loadout.cpp`
 * `PlayerShotSpec::damage` / `PlayerBombSpec::damage` 的逐条镜像。
 *
 * 为什么单独一张表：TS 自动生成的 `player_loadout.ts`（gen_danmaku_ts.py 产物）
 * 只带贴图/角度/速度，不带 `damage`；而 `BossRaceSimulation` 要在两端算出**同一位**
 * 的每 tick 伤害（否则 state hash 无法逐位一致）。这里以 C++ 表为权威手工对齐，
 * 并复刻 C++ 的两条规则：
 *   * shot 伤害 = 该 shot 主弹 `PlayerShotSpec.damage`（-1 = 不适用）；
 *   * bomb 伤害 = 该 bomb 各分段 `part.damage` 的最大值（-1 = 不适用）。
 *
 * 数值对照（与 C++ 表同序，若两端漂移必须同步修改）：
 *   shots: ReimuA1=50 ReimuA2=65 ReimuB1=50 ReimuB2=100 / MarisaA1=13 MarisaA2=13
 *   MarisaB1=40 MarisaB2=40 / SanaeA1=100 SanaeA2=40 SanaeB1=100 SanaeB2=80 /
 *   SakuyaA1=100 SakuyaA2=270 SakuyaB1=100 SakuyaB2=68 / ReisenA1..B2=20 /
 *   YoumuA1=80 YoumuA2=-1 YoumuB1=65 YoumuB2=105 / AyaA1=100 AyaA2=140 AyaB1=105
 *   AyaB2=-1 / SeijaA1=-1 SeijaA2=-1 SeijaB1=65 SeijaB2=65 / CirnoA1=105 CirnoA2=105
 *   CirnoB1=50 CirnoB2=160 / YukariA1=-1 YukariA2=27 YukariB1=100 YukariB2=-1 /
 *   AliceA1=68 AliceA2=-1 AliceB1=13 AliceB2=70 / RemilliaA1=68 RemilliaA2=170
 *   RemilliaB1=140 RemilliaB2=170 / YuyukoA1=110 YuyukoA2=163 YuyukoB1=163 YuyukoB2=250.
 */

/** shot name → 主弹伤害（-1 = 不适用/不造成伤害）。 */
export const PLAYER_SHOT_DAMAGE: Readonly<Record<string, number>> = {
  ReimuA1: 50,
  ReimuA2: 65,
  ReimuB1: 50,
  ReimuB2: 100,
  MarisaA1: 13,
  MarisaA2: 13,
  MarisaB1: 40,
  MarisaB2: 40,
  SanaeA1: 100,
  SanaeA2: 40,
  SanaeB1: 100,
  SanaeB2: 80,
  SakuyaA1: 100,
  SakuyaA2: 270,
  SakuyaB1: 100,
  SakuyaB2: 68,
  ReisenA1: 20,
  ReisenA2: 20,
  ReisenB1: 20,
  ReisenB2: 20,
  YoumuA1: 80,
  YoumuA2: -1,
  YoumuB1: 65,
  YoumuB2: 105,
  AyaA1: 100,
  AyaA2: 140,
  AyaB1: 105,
  AyaB2: -1,
  SeijaA1: -1,
  SeijaA2: -1,
  SeijaB1: 65,
  SeijaB2: 65,
  CirnoA1: 105,
  CirnoA2: 105,
  CirnoB1: 50,
  CirnoB2: 160,
  YukariA1: -1,
  YukariA2: 27,
  YukariB1: 100,
  YukariB2: -1,
  AliceA1: 68,
  AliceA2: -1,
  AliceB1: 13,
  AliceB2: 70,
  RemilliaA1: 68,
  RemilliaA2: 170,
  RemilliaB1: 140,
  RemilliaB2: 170,
  YuyukoA1: 110,
  YuyukoA2: 163,
  YuyukoB1: 163,
  YuyukoB2: 250,
};

/** bomb name（= 角色名）→ 主弹伤害（-1 = 不适用）。 */
export const PLAYER_BOMB_DAMAGE: Readonly<Record<string, number>> = {
  Reimu: 45,
  Marisa: 24,
  Sanae: 95,
  Sakuya: 81,
  Reisen: 33,
  Youmu: 36,
  Aya: 12,
  Seija: 67,
  Cirno: 48,
  Yukari: 60,
  Alice: 24,
  Remillia: -1,
  Yuyuko: 57,
};

/** shot name → 伤害；未知/未解析返回 -1（等同 C++ 的“不适用”）。 */
export function playerShotDamage(shotType: string): number {
  const value = PLAYER_SHOT_DAMAGE[shotType];
  return value === undefined ? -1 : value;
}

/** bomb name → 伤害；未知返回 -1。 */
export function playerBombDamage(bombType: string): number {
  const value = PLAYER_BOMB_DAMAGE[bombType];
  return value === undefined ? -1 : value;
}
