/**
 * 千夜追忆（TNA）UI 美术清单。
 *
 * 这些是 APK 里的**独立贴图**（不是图集帧），由
 * `SpellKard/tools/import_tna_atlas.py` 导入到 `tna/ui/`，并在
 * `index.json` 的 `ui` 列表里登记。按 `docs/ART_POLICY.md`，界面美术同样只
 * 来自该 APK——客户端不自绘按钮/图标/滑杆作为最终表现。
 *
 * 名称都是 **TNA 根相对路径**（`ui/btn_pause.png`、`bg_menu.png`），直接交给
 * `bullet_atlas` 的 `ensureImage` / `image` 解析，部署根由它统一处理。
 *
 * NOTE: `core/` only — 纯字符串常量与纯函数，可 Node 直测。
 */

/** 战斗内暂停按钮图标（40×40 粉圆 + 暂停符号）。 */
export const UI_PAUSE_ICON = 'ui/btn_pause.png';

/** 战斗内炸弹按钮图标（32×32）。 */
export const UI_BOMB_ICON = 'ui/btn_bomb.png';

/** 关闭按钮（常态 / 选中态）。 */
export const UI_CLOSE_NORMAL = 'ui/CloseNormal.png';
export const UI_CLOSE_SELECTED = 'ui/CloseSelected.png';

/** 菜单箭头（常态 / 选中态）。 */
export const UI_ARROW = 'ui/img_menu_arrow_01.png';
export const UI_ARROW_SELECTED = 'ui/img_menu_arrow_02.png';

/** 设置面板滑杆三件套。 */
export const UI_SLIDER_TRACK = 'ui/sliderTrack.png';
export const UI_SLIDER_THUMB = 'ui/sliderThumb.png';
export const UI_SLIDER_PROGRESS = 'ui/sliderProgress.png';

/** Boss 血环（外环 128×128，按 HP 比例调透明度）。 */
export const UI_BOSS_LIFE_RING = 'ui/e_life_bar_2.png';
/** Boss 血环内圈（细环，作装饰）。 */
export const UI_BOSS_LIFE_RING_INNER = 'ui/e_life_bar_1.png';

/** 菜单背景（320×480，暗紫星海）。 */
export const UI_MENU_BACKGROUND = 'bg_menu.png';

/**
 * 界面标题牌（APK 把每个子页面的英文标题烘焙成了 205×~40 的贴图）。
 *
 * 这些是**标题美术**，不是进度条：`bar_*` 里的 "bar" 指 banner/plaque。子页面
 * 的标题优先用它们，文本标题只作缺图兜底。
 */
export const UI_TITLE_PLAQUE_PAUSE_MENU = 'ui/bar_pause_menu.png';
export const UI_TITLE_PLAQUE_CONFIG = 'ui/bar_config.png';
export const UI_TITLE_PLAQUE_STAGE_CLEAR = 'ui/bar_stage_clear.png';
export const UI_TITLE_PLAQUE_GAME_OVER = 'ui/bar_game_over.png';
export const UI_TITLE_PLAQUE_RETRY_MENU = 'ui/bar_retry_menu.png';
export const UI_TITLE_PLAQUE_PLAYER_DATA = 'ui/bar_player_data.png';
export const UI_TITLE_PLAQUE_CHARA_SELECT = 'ui/bar_chara_select.png';
export const UI_TITLE_PLAQUE_STAGE_SELECT = 'ui/bar_stage_select.png';
export const UI_TITLE_PLAQUE_LEVEL_SELECT = 'ui/bar_level_select.png';
export const UI_TITLE_PLAQUE_SPELL_PRACTICE = 'ui/bar_spell_practice.png';
export const UI_TITLE_PLAQUE_BOSS_PRACTICE = 'ui/bar_boss_practice.png';
export const UI_TITLE_PLAQUE_HOW_TO_PLAY = 'ui/bar_how_to_play.png';
export const UI_TITLE_PLAQUE_MUSIC_ROOM = 'ui/bar_music_room.png';
export const UI_TITLE_PLAQUE_OPTION = 'ui/bar_option.png';

/** 客户端子页面 → 标题牌贴图。`''` 表示该页面没有对应贴图（用文本标题）。 */
export type UiPlaqueId =
  | 'pauseMenu'
  | 'config'
  | 'stageClear'
  | 'gameOver'
  | 'retryMenu'
  | 'playerData'
  | 'charaSelect'
  | 'stageSelect'
  | 'levelSelect'
  | 'spellPractice'
  | 'bossPractice'
  | 'howToPlay'
  | 'musicRoom'
  | 'option';

const PLAQUES: Readonly<Record<UiPlaqueId, string>> = {
  pauseMenu: UI_TITLE_PLAQUE_PAUSE_MENU,
  config: UI_TITLE_PLAQUE_CONFIG,
  stageClear: UI_TITLE_PLAQUE_STAGE_CLEAR,
  gameOver: UI_TITLE_PLAQUE_GAME_OVER,
  retryMenu: UI_TITLE_PLAQUE_RETRY_MENU,
  playerData: UI_TITLE_PLAQUE_PLAYER_DATA,
  charaSelect: UI_TITLE_PLAQUE_CHARA_SELECT,
  stageSelect: UI_TITLE_PLAQUE_STAGE_SELECT,
  levelSelect: UI_TITLE_PLAQUE_LEVEL_SELECT,
  spellPractice: UI_TITLE_PLAQUE_SPELL_PRACTICE,
  bossPractice: UI_TITLE_PLAQUE_BOSS_PRACTICE,
  howToPlay: UI_TITLE_PLAQUE_HOW_TO_PLAY,
  musicRoom: UI_TITLE_PLAQUE_MUSIC_ROOM,
  option: UI_TITLE_PLAQUE_OPTION,
};

/** 取一个子页面的标题牌贴图（TNA 根相对路径）。 */
export function titlePlaque(id: UiPlaqueId): string {
  return PLAQUES[id];
}

/**
 * 标题 logo 变体：APK 按语言烘焙了不同文字，三张都是 300px 宽的成品图。
 *
 * - `title_logo.png`（300×80）= 日文「東方千夜帖」
 * - `title_logo_ch.png`（300×70）= 简体「东方千夜帖」
 * - `title_logo_en_2.png`（300×27）= 英文 "Thousand Night Anamnesis"
 *
 * 注意英文只有 `_2` 后缀这一张（没有 `title_logo_en.png`），导入器按
 * 白名单复制，别改成不存在的名字。
 */
export const UI_TITLE_LOGO_JA = 'ui/title_logo.png';
export const UI_TITLE_LOGO_ZH = 'ui/title_logo_ch.png';
export const UI_TITLE_LOGO_EN = 'ui/title_logo_en_2.png';
/** 副标题条（"Rush"/"Spell" 之类的小字版式），装饰用。 */
export const UI_TITLE_LOGO_ALT = 'ui/title_logo_rs.png';

/**
 * 按语言挑标题 logo：中文（简/繁）用 `_ch`，英文用 `_en_2`，其余（含 ja）用日文原版。
 */
export function titleLogoFor(locale: string): string {
  const normalized = locale.toLowerCase();
  if (normalized.startsWith('zh')) {
    return UI_TITLE_LOGO_ZH;
  }
  if (normalized.startsWith('en')) {
    return UI_TITLE_LOGO_EN;
  }
  return UI_TITLE_LOGO_JA;
}

/** 界面会请求的全部 UI 贴图（供导入完整性测试逐项钉住）。 */
export function allUiAssets(): readonly string[] {
  return [
    UI_PAUSE_ICON,
    UI_BOMB_ICON,
    UI_CLOSE_NORMAL,
    UI_CLOSE_SELECTED,
    UI_ARROW,
    UI_ARROW_SELECTED,
    UI_SLIDER_TRACK,
    UI_SLIDER_THUMB,
    UI_SLIDER_PROGRESS,
    UI_BOSS_LIFE_RING,
    UI_BOSS_LIFE_RING_INNER,
    UI_MENU_BACKGROUND,
    UI_TITLE_LOGO_JA,
    UI_TITLE_LOGO_ZH,
    UI_TITLE_LOGO_EN,
    UI_TITLE_LOGO_ALT,
    ...Object.values(PLAQUES),
  ];
}
