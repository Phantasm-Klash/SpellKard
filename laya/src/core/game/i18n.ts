/**
 * Client i18n: one string table per language, one lookup function.
 *
 * Project rule (2026-10-20): **every user-visible string goes through here, and
 * every language is updated together.** A test enforces the second half — the
 * tables must have identical key sets and identical `{placeholder}` names, or a
 * translation that lands in one language only fails CI instead of silently
 * showing a key or a blank label.
 *
 * The module is deliberately engine-free (no Laya, no storage): the platform
 * layer owns persistence and calls {@link setLanguage} at boot. `t()` falls back
 * to the default table and then to the key itself, so a missing translation is
 * loud in development rather than invisible in production.
 *
 * 版权：东方同人逆向成果，仅用于自研玩法。
 */

export type LanguageCode = 'en' | 'zh';

/** Language shown when nothing is persisted and the platform has no opinion. */
export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export interface LanguageInfo {
  readonly code: LanguageCode;
  /** Endonym — what speakers call the language themselves. */
  readonly label: string;
}

/** The languages this build ships, in the order a language picker should show. */
export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'zh', label: '简体中文' },
  { code: 'en', label: 'English' },
];

/** A flat key → string table. Values may carry `{name}` placeholders. */
export type StringTable = Readonly<Record<string, string>>;

// ---------------------------------------------------------------------------
// Tables
//
// Keys are namespaced by domain (`gift.*`, `ui.*`). When adding a string, add
// it to EVERY table below in the same commit — `tests/i18n.test.ts` fails the
// build otherwise.
// ---------------------------------------------------------------------------

const ZH: StringTable = {
  // --- gifts: names and one-line blurbs (the catalog keeps only the keys) ---
  'gift.heart': '心愿',
  'gift.heart.blurb': '把一份心意递给对方',
  'gift.star': '星砂',
  'gift.star.blurb': '撒一把会发光的碎星',
  'gift.ribbon': '丝带',
  'gift.ribbon.blurb': '系一个蝴蝶结过去',
  'gift.lantern': '灯笼',
  'gift.lantern.blurb': '提一盏灯照路',
  'gift.wand': '御币',
  'gift.wand.blurb': '借一根扫帚……不，御币',
  'gift.cup': '茶',
  'gift.cup.blurb': '请对方喝一杯茶',

  // --- gift bar / announcements ---
  'gift.bar.charges': '心意 {left}/{total}',
  'gift.announce': '{from} 向 {to} 送出了 {gift}',
  'gift.toast.sent': '送出了 {gift}',

  // --- shared UI labels (login / lobby and the scenes that reuse them) ---
  'ui.signIn': '登录',
  'ui.createAccount': '创建账号',
  'ui.play': '开始',
  'ui.records': '战绩',
  'ui.shop': '商店',
  'ui.settings': '设置',
  'ui.back': '返回',
  'ui.gift': '送礼',
  'ui.deck': '卡组',
  'ui.rank': '段位',
  'ui.queue': '排队',
  'ui.mail': '邮件',
  'ui.opponent': '对手',
};

const EN: StringTable = {
  'gift.heart': 'Heartfelt Wish',
  'gift.heart.blurb': 'Hand a little something over',
  'gift.star': 'Stardust',
  'gift.star.blurb': 'Scatter a handful of glowing sand',
  'gift.ribbon': 'Ribbon',
  'gift.ribbon.blurb': 'Tie a bow and send it over',
  'gift.lantern': 'Lantern',
  'gift.lantern.blurb': 'Carry a light across',
  'gift.wand': 'Purification Rod',
  'gift.wand.blurb': 'Lend a gohei — not a broom',
  'gift.cup': 'Tea',
  'gift.cup.blurb': 'Offer the other side a cup',

  'gift.bar.charges': 'Thoughts {left}/{total}',
  'gift.announce': '{from} sent {to} a {gift}',
  'gift.toast.sent': 'Sent a {gift}',

  'ui.signIn': 'Sign in',
  'ui.createAccount': 'Create account',
  'ui.play': 'Play',
  'ui.records': 'Records',
  'ui.shop': 'Shop',
  'ui.settings': 'Settings',
  'ui.back': 'Back',
  'ui.gift': 'Gift',
  'ui.deck': 'Deck',
  'ui.rank': 'Rank',
  'ui.queue': 'Queue',
  'ui.mail': 'Mail',
  'ui.opponent': 'opponent',
};

const TABLES: Readonly<Record<LanguageCode, StringTable>> = { zh: ZH, en: EN };

let currentLanguage: LanguageCode = DEFAULT_LANGUAGE;

/** True when `code` is a language this build ships. */
export function isLanguageCode(code: string): code is LanguageCode {
  return Object.prototype.hasOwnProperty.call(TABLES, code);
}

/**
 * Selects the active language. An unknown code keeps the current one (a typo in
 * a persisted setting must not blank the UI).
 */
export function setLanguage(code: string): LanguageCode {
  if (isLanguageCode(code)) {
    currentLanguage = code;
  }
  return currentLanguage;
}

/** The active language code. */
export function language(): LanguageCode {
  return currentLanguage;
}

/**
 * Resolves `key` in the active language, then the default one, then the key
 * itself (loud on purpose). `{name}` placeholders are filled from `params`;
 * a param that is absent leaves its placeholder in place rather than deleting
 * the word, which keeps the sentence readable while debugging.
 */
export function t(key: string, params?: Readonly<Record<string, string | number>>): string {
  const table = TABLES[currentLanguage] ?? TABLES[DEFAULT_LANGUAGE];
  let value = table[key];
  if (value === undefined) {
    value = TABLES[DEFAULT_LANGUAGE][key];
  }
  if (value === undefined) {
    return key;
  }
  if (params === undefined) {
    return value;
  }
  return value.replace(/\{(\w+)\}/g, (match, name: string) => {
    const param = params[name];
    return param === undefined ? match : String(param);
  });
}

/** Every key in the default table — the parity test walks this list. */
export function i18nKeys(): readonly string[] {
  return Object.keys(TABLES[DEFAULT_LANGUAGE]).sort();
}

/** The table for one language, for tests and for a future picker preview. */
export function stringTable(code: LanguageCode): StringTable {
  return TABLES[code];
}
