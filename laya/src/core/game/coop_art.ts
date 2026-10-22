/**
 * 合作模式（coop_boss）的千夜追忆（TNA）美术帧映射。
 *
 * 底层原则（见 `docs/ART_POLICY.md`）：**所有游戏内美术都来自千夜追忆 1.40
 * 的导入树**（`layaide/assets/resources/tna`），客户端不自绘矢量美术作为最终
 * 表现。本模块只登记帧坐标（`atlas#frame`），由平台层 `bullet_atlas` 统一切片；
 * 因此它是纯数据、零 Laya 依赖，可被 Node 直测。
 *
 * 帧来源：
 *  - 自机：`ply_shot_0N/player_0N.png`（32×48，机头朝上），座位 N 用第 N 号自机；
 *  - Boss：`enemylist01/stage_boss_01_11.png`（128×128）与受击帧
 *    `stage_boss_damage_01_11.png`；
 *  - 弹幕：服务端合作模式只给 `kind`（0=fan 1=cannon 2=spiral），按弹种选 TNA
 *    物种帧——小扇弹用 `kome`（16×14 小玉）、巨炮用 `mtama`（32×32 大玉）、
 *    公共旋转弹用 `stama`（16×16 圆弹）。
 *
 * NOTE: `core/` only — 不 import Laya / 平台代码。
 */

/** 一个 `atlas#frame` 帧坐标（与 `tna_actor_frames` 同形）。 */
export interface CoopArtFrame {
  /** 图集名，例如 `enemylist01`。 */
  atlas: string;
  /** 图集内帧名，例如 `stage_boss_01_11.png`。 */
  frame: string;
}

/** 合作模式 Boss 待机帧。 */
export const COOP_BOSS_ART: CoopArtFrame = {
  atlas: 'enemylist01',
  frame: 'stage_boss_01_11.png',
};

/** 合作模式 Boss 击破帧（HP 归零后替换待机帧）。 */
export const COOP_BOSS_DEFEATED_ART: CoopArtFrame = {
  atlas: 'enemylist01',
  frame: 'stage_boss_damage_01_11.png',
};

/**
 * 座位 → 自机精灵。4 个座位对应 TNA 的 1..4 号自机（`player_01..04.png`），
 * 座位号超出 4 时取模复用；负座位同样安全归一到 0..3。
 */
export function coopPlayerArt(seat: number): CoopArtFrame {
  const raw = Number.isFinite(seat) ? Math.trunc(seat) : 0;
  const n = (((raw % 4) + 4) % 4) + 1;
  const padded = String(n).padStart(2, '0');
  return { atlas: `ply_shot_${padded}`, frame: `player_${padded}.png` };
}

/**
 * 合作弹种（wire `kind`）→ TNA 弹幕帧。
 *
 * 服务端 `coop_boss.cpp` 只发 0=fan / 1=cannon / 2=spiral 三种，映射到
 * 尺寸匹配的 TNA 物种：小扇弹 `kome`、巨炮 `mtama`、公共旋转弹 `stama`。
 */
const COOP_BULLET_FRAMES: readonly CoopArtFrame[] = [
  { atlas: 'bulletlist01', frame: 'kome_01.png' },
  { atlas: 'bulletlist02', frame: 'mtama_01.png' },
  { atlas: 'bulletlist01', frame: 'stama_01.png' },
];

/** 合作弹种 → 帧；未知 kind 按 0（fan）处理，越界值安全取模。 */
export function coopBulletArt(kind: number): CoopArtFrame {
  const raw = Number.isFinite(kind) ? Math.trunc(kind) : 0;
  return COOP_BULLET_FRAMES[((raw % COOP_BULLET_FRAMES.length) + COOP_BULLET_FRAMES.length) % COOP_BULLET_FRAMES.length];
}

/** 合作模式会请求的全部帧（供图集完整性测试逐项钉住）。 */
export function allCoopArtFrames(): readonly CoopArtFrame[] {
  return [
    COOP_BOSS_ART,
    COOP_BOSS_DEFEATED_ART,
    coopPlayerArt(0),
    coopPlayerArt(1),
    coopPlayerArt(2),
    coopPlayerArt(3),
    ...COOP_BULLET_FRAMES,
  ];
}
