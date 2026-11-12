// AUTO-GENERATED from docs/apk-reverse-notes/patterns/decode_bullet_size.py
// 原版 EnemyBullet::setBulletType @0x512140 逐分支解出的 (hitDis, artScale)。
// 216/216 个 kEnemyBullet 全部覆盖；勿手改。
export interface BulletSizeSpec { readonly lo: number; readonly hi: number; readonly hitDis: number; readonly artScale: number; }

/** 按 kind 升序的紧凑区间表；与服务端 bullet_size.hpp 逐位一致。 */
export const BULLET_SIZE_SPECS: readonly BulletSizeSpec[] = [
  { lo:   9, hi: 121, hitDis:   2.4000, artScale: 1.0 },
  { lo: 122, hi: 122, hitDis:   2.4000, artScale: 1.5 },
  { lo: 123, hi: 124, hitDis:   2.4000, artScale: 1.0 },
  { lo: 125, hi: 125, hitDis:   8.0000, artScale: 1.5 },
  { lo: 126, hi: 126, hitDis:   2.4000, artScale: 1.5 },
  { lo: 127, hi: 127, hitDis:   8.0000, artScale: 1.5 },
  { lo: 128, hi: 129, hitDis:   2.4000, artScale: 1.0 },
  { lo: 130, hi: 130, hitDis:   2.4000, artScale: 1.5 },
  { lo: 131, hi: 131, hitDis:   2.4000, artScale: 1.0 },
  { lo: 132, hi: 136, hitDis:   2.4000, artScale: 1.5 },
  { lo: 137, hi: 137, hitDis:   8.0000, artScale: 1.5 },
  { lo: 138, hi: 139, hitDis:   2.4000, artScale: 1.5 },
  { lo: 140, hi: 143, hitDis:   8.0000, artScale: 1.5 },
  { lo: 144, hi: 144, hitDis:   2.4000, artScale: 1.5 },
  { lo: 145, hi: 183, hitDis:   8.0000, artScale: 1.5 },
  { lo: 184, hi: 185, hitDis:   2.4000, artScale: 1.0 },
  { lo: 186, hi: 186, hitDis:  14.1400, artScale: 2.0 },
  { lo: 187, hi: 187, hitDis:   2.4000, artScale: 1.0 },
  { lo: 188, hi: 188, hitDis:   8.0000, artScale: 1.5 },
  { lo: 189, hi: 190, hitDis:  14.1400, artScale: 2.0 },
  { lo: 191, hi: 191, hitDis:   8.0000, artScale: 1.5 },
  { lo: 192, hi: 196, hitDis:  14.1400, artScale: 2.0 },
  { lo: 197, hi: 200, hitDis:   8.0000, artScale: 1.5 },
  { lo: 201, hi: 201, hitDis:  86.0000, artScale: 5.0 },
  { lo: 202, hi: 202, hitDis:   8.0000, artScale: 1.5 },
  { lo: 203, hi: 204, hitDis:  86.0000, artScale: 5.0 },
  { lo: 205, hi: 209, hitDis:   2.4000, artScale: 1.0 },
  { lo: 210, hi: 218, hitDis:   0.0000, artScale: 1.0 },
  { lo: 219, hi: 219, hitDis:   0.0000, artScale: 2.0 },
  { lo: 220, hi: 220, hitDis:   0.0000, artScale: 1.0 },
  { lo: 221, hi: 224, hitDis:  66.0000, artScale: 3.0 },
];

/** 原版对象的 +0x54c hitDis（像素）。未收录返回 4.0（legacy 兜底）。 */
export function bulletHitDisForKind(kind: number): number {
  for (const s of BULLET_SIZE_SPECS) {
    if (kind >= s.lo && kind <= s.hi) return s.hitDis;
  }
  return 4;
}

/** 原版对象的 +0x5f0 美术缩放（1.0 / 1.5 / 2.0 / 3.0 / 5.0）。 */
export function bulletArtScaleForKind(kind: number): number {
  for (const s of BULLET_SIZE_SPECS) {
    if (kind >= s.lo && kind <= s.hi) return s.artScale;
  }
  return 1;
}
