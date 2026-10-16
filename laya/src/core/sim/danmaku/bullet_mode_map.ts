/**
 * 节点模式 id（Enemy 节点 +0x28）→ 发射行为参数 权威查表。
 *
 * C++ 镜像：`PhK-BattleServer/src/danmaku/bullet_mode_map.cpp`（数据由
 * rev/tmp/gen_modeid_map.py 从 libMyGame.so 1.40 解出，勿手改）。
 *
 * 来源：`Enemy::createBullets1` @0x37bacc 的双跳转表
 * （表1 @0xACFC03 id∈[9,136] / 表2 @0xACFC83 id∈[137,223] / id==224 特殊 /
 * 其余默认）。w3 ∈ [178,211] 与 kEnemyBullet 值域相容、w2 ∈ [24,59] 与
 * bulletFunc 编号值域相容 **[推断]**；精确字段赋值未逐指令验证，故只暴露
 * 原始数对。完整 JSON 产物：rev/patterns/bullet_modeid_map.json。
 */

export interface BulletModePair {
  /** 参数 2（24..59）。 */
  w2: number;
  /** 参数 3（12 / 178..211）。 */
  w3: number;
}

/** 默认对（越界 id 与 id=205 的默认分支）。 */
export const BULLET_MODE_DEFAULT: BulletModePair = { w2: 24, w3: 12 };

export interface BulletModeRange {
  lo: number;
  hi: number;
  pair: BulletModePair;
}

/** 36 组，覆盖 0..255，按 lo 升序（与 C++ kRanges 逐项一致）。 */
export const BULLET_MODE_RANGES: readonly BulletModeRange[] = [
  { lo: 0, hi: 8, pair: { w2: 24, w3: 12 } },
  { lo: 9, hi: 17, pair: { w2: 47, w3: 178 } },
  { lo: 18, hi: 26, pair: { w2: 46, w3: 179 } },
  { lo: 27, hi: 35, pair: { w2: 45, w3: 180 } },
  { lo: 36, hi: 44, pair: { w2: 44, w3: 181 } },
  { lo: 45, hi: 53, pair: { w2: 53, w3: 182 } },
  { lo: 54, hi: 62, pair: { w2: 54, w3: 183 } },
  { lo: 63, hi: 71, pair: { w2: 48, w3: 184 } },
  { lo: 72, hi: 80, pair: { w2: 55, w3: 185 } },
  { lo: 81, hi: 89, pair: { w2: 56, w3: 186 } },
  { lo: 90, hi: 98, pair: { w2: 43, w3: 187 } },
  { lo: 99, hi: 107, pair: { w2: 51, w3: 188 } },
  { lo: 108, hi: 116, pair: { w2: 49, w3: 189 } },
  { lo: 117, hi: 125, pair: { w2: 50, w3: 190 } },
  { lo: 126, hi: 134, pair: { w2: 52, w3: 191 } },
  { lo: 135, hi: 137, pair: { w2: 37, w3: 192 } },
  { lo: 138, hi: 146, pair: { w2: 33, w3: 193 } },
  { lo: 147, hi: 155, pair: { w2: 34, w3: 194 } },
  { lo: 156, hi: 164, pair: { w2: 42, w3: 195 } },
  { lo: 165, hi: 173, pair: { w2: 35, w3: 196 } },
  { lo: 174, hi: 182, pair: { w2: 32, w3: 197 } },
  { lo: 183, hi: 191, pair: { w2: 36, w3: 198 } },
  { lo: 192, hi: 196, pair: { w2: 28, w3: 199 } },
  { lo: 197, hi: 203, pair: { w2: 31, w3: 200 } },
  { lo: 204, hi: 204, pair: { w2: 24, w3: 201 } },
  { lo: 205, hi: 205, pair: { w2: 24, w3: 12 } },
  { lo: 206, hi: 211, pair: { w2: 41, w3: 203 } },
  { lo: 212, hi: 216, pair: { w2: 38, w3: 204 } },
  { lo: 217, hi: 217, pair: { w2: 39, w3: 205 } },
  { lo: 218, hi: 218, pair: { w2: 40, w3: 206 } },
  { lo: 219, hi: 219, pair: { w2: 59, w3: 207 } },
  { lo: 220, hi: 220, pair: { w2: 59, w3: 208 } },
  { lo: 221, hi: 221, pair: { w2: 29, w3: 209 } },
  { lo: 222, hi: 223, pair: { w2: 26, w3: 210 } },
  { lo: 224, hi: 224, pair: { w2: 25, w3: 211 } },
  { lo: 225, hi: 255, pair: { w2: 24, w3: 12 } },
];

/** 查表：模式 id → 行为数对。id < 0 或 > 255 返回默认对。 */
export function bulletModeForId(id: number): BulletModePair {
  if (id < 0) {
    return BULLET_MODE_DEFAULT;
  }
  for (const range of BULLET_MODE_RANGES) {
    if (id <= range.hi) {
      return id >= range.lo ? range.pair : BULLET_MODE_DEFAULT;
    }
  }
  return BULLET_MODE_DEFAULT;
}
