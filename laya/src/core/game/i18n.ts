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

/**
 * The typed contract every locale must satisfy.
 *
 * An interface rather than a loose record on purpose: a locale that forgets a
 * key is a COMPILE error, so adding a string is a "the build names the locales
 * that are now incomplete" operation instead of a "some player sees an empty
 * label" bug. `tests/i18n.test.ts` covers what types cannot: placeholder parity
 * across locales.
 */
export interface Messages {
  // --- app shell ---
  'app.title': string;
  'app.subtitle': string;

  // --- login surface ---
  'login.title': string;
  'login.email': string;
  'login.password': string;
  'login.notConnected': string;
  'login.signingIn': string;
  'login.failed': string;
  'login.transportError': string;

  // --- settings surface ---
  'settings.title': string;
  'settings.language': string;
  'settings.language.hint': string;
  'settings.language.zh-Hans': string;
  'settings.language.zh-Hant': string;
  'settings.language.ja': string;
  'settings.language.en': string;
  'settings.applied': string;

  // --- error surface (lobby error codes -> player-facing text) ---
  'error.generic': string;
  'error.network': string;
  'error.timeout': string;
  'error.unknownCode': string;
  'error.unauthorized': string;
  'error.not_found': string;
  'error.invalid_request': string;
  'error.deck_invalid': string;
  'error.mode_invalid': string;
  'error.forbidden_field': string;
  'error.match_state_invalid': string;
  'error.rate_limited': string;
  'error.battle_callback_freshness_incomplete': string;
  'error.reconnect_expired': string;
  'error.match_already_ended': string;
  'error.claim_ineligible': string;

  // --- gifts (in-match social interaction) ---
  'gift.heart': string;
  'gift.heart.blurb': string;
  'gift.star': string;
  'gift.star.blurb': string;
  'gift.ribbon': string;
  'gift.ribbon.blurb': string;
  'gift.lantern': string;
  'gift.lantern.blurb': string;
  'gift.wand': string;
  'gift.wand.blurb': string;
  'gift.cup': string;
  'gift.cup.blurb': string;
  'gift.bar.charges': string;
  'gift.announce': string;
  'gift.toast.sent': string;

  // --- shared button labels ---
  'ui.signIn': string;
  'ui.createAccount': string;
  'ui.play': string;
  'ui.records': string;
  'ui.shop': string;
  'ui.settings': string;
  'ui.back': string;
  'ui.gift': string;
  'ui.deck': string;
  'ui.rank': string;
  'ui.queue': string;
  'ui.mail': string;
  'ui.opponent': string;
}

export type LanguageCode = 'zh-Hans' | 'zh-Hant' | 'ja' | 'en';

/**
 * Language shown when nothing is persisted. `en` because the shipped UI text is
 * English — switching the default would move every label out from under the
 * existing screens in one commit.
 */
export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export interface LanguageInfo {
  readonly code: LanguageCode;
  /** Endonym — what speakers call the language themselves. */
  readonly label: string;
}

/** The languages this build ships, in the order a language picker should show. */
export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'zh-Hans', label: '简体中文' },
  { code: 'zh-Hant', label: '繁體中文' },
  { code: 'ja', label: '日本語' },
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

const ZH_HANS: Messages = {
  'app.title': '纷争幻想',
  'app.subtitle': 'Phantasm Klash',

  'login.title': '登录',
  'login.email': '邮箱',
  'login.password': '密码',
  'login.notConnected': '未连接',
  'login.signingIn': '正在登录…',
  'login.failed': '登录失败',
  'login.transportError': '无法连接服务器，请检查网络后重试。',

  'settings.title': '设置',
  'settings.language': '语言',
  'settings.language.hint': '切换后立即生效，并会记住你的选择。',
  'settings.language.zh-Hans': '简体中文',
  'settings.language.zh-Hant': '繁體中文',
  'settings.language.ja': '日本語',
  'settings.language.en': 'English',
  'settings.applied': '设置已保存',

  'error.generic': '出了点问题，请稍后再试。',
  'error.network': '网络连接失败。',
  'error.timeout': '请求超时。',
  'error.unknownCode': '发生未知错误（代码：{code}）。',
  'error.unauthorized': '登录已失效，请重新登录。',
  'error.not_found': '没有找到对应的内容。',
  'error.invalid_request': '请求格式不正确。',
  'error.deck_invalid': '卡组不符合规则，请检查后再试。',
  'error.mode_invalid': '该模式不可用。',
  'error.forbidden_field': '请求中包含不允许修改的字段。',
  'error.match_state_invalid': '对局状态不允许这个操作。',
  'error.rate_limited': '操作太频繁了，请稍后再试。',
  'error.battle_callback_freshness_incomplete': '对战服务回调信息不完整。',
  'error.reconnect_expired': '重连时间已过，本局无法再加入。',
  'error.match_already_ended': '本局已经结束了。',
  'error.claim_ineligible': '当前不满足领取条件。',

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
  'gift.bar.charges': '心意 {left}/{total}',
  'gift.announce': '{from} 向 {to} 送出了 {gift}',
  'gift.toast.sent': '送出了 {gift}',

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

const ZH_HANT: Messages = {
  'app.title': '紛爭幻想',
  'app.subtitle': 'Phantasm Klash',

  'login.title': '登入',
  'login.email': '電子郵件',
  'login.password': '密碼',
  'login.notConnected': '未連線',
  'login.signingIn': '正在登入…',
  'login.failed': '登入失敗',
  'login.transportError': '無法連線到伺服器，請檢查網路後重試。',

  'settings.title': '設定',
  'settings.language': '語言',
  'settings.language.hint': '切換後立即生效，並會記住你的選擇。',
  'settings.language.zh-Hans': '简体中文',
  'settings.language.zh-Hant': '繁體中文',
  'settings.language.ja': '日本語',
  'settings.language.en': 'English',
  'settings.applied': '設定已儲存',

  'error.generic': '發生了一點問題，請稍後再試。',
  'error.network': '網路連線失敗。',
  'error.timeout': '請求逾時。',
  'error.unknownCode': '發生未知錯誤（代碼：{code}）。',
  'error.unauthorized': '登入已失效，請重新登入。',
  'error.not_found': '找不到對應的內容。',
  'error.invalid_request': '請求格式不正確。',
  'error.deck_invalid': '牌組不符合規則，請檢查後再試。',
  'error.mode_invalid': '該模式不可用。',
  'error.forbidden_field': '請求中含有不允許修改的欄位。',
  'error.match_state_invalid': '對局狀態不允許此操作。',
  'error.rate_limited': '操作過於頻繁，請稍後再試。',
  'error.battle_callback_freshness_incomplete': '對戰服務回呼資訊不完整。',
  'error.reconnect_expired': '重連時間已過，本局無法再加入。',
  'error.match_already_ended': '本局已經結束。',
  'error.claim_ineligible': '目前不符合領取條件。',

  'gift.heart': '心願',
  'gift.heart.blurb': '把一份心意遞給對方',
  'gift.star': '星砂',
  'gift.star.blurb': '撒一把會發光的碎星',
  'gift.ribbon': '絲帶',
  'gift.ribbon.blurb': '繫一個蝴蝶結過去',
  'gift.lantern': '燈籠',
  'gift.lantern.blurb': '提一盞燈照路',
  'gift.wand': '御幣',
  'gift.wand.blurb': '借一根掃帚……不，御幣',
  'gift.cup': '茶',
  'gift.cup.blurb': '請對方喝一杯茶',
  'gift.bar.charges': '心意 {left}/{total}',
  'gift.announce': '{from} 向 {to} 送出了 {gift}',
  'gift.toast.sent': '送出了 {gift}',

  'ui.signIn': '登入',
  'ui.createAccount': '註冊帳號',
  'ui.play': '開始',
  'ui.records': '戰績',
  'ui.shop': '商店',
  'ui.settings': '設定',
  'ui.back': '返回',
  'ui.gift': '送禮',
  'ui.deck': '牌組',
  'ui.rank': '段位',
  'ui.queue': '排隊',
  'ui.mail': '郵件',
  'ui.opponent': '對手',
};

const JA: Messages = {
  'app.title': '紛争幻想',
  'app.subtitle': 'Phantasm Klash',

  'login.title': 'ログイン',
  'login.email': 'メールアドレス',
  'login.password': 'パスワード',
  'login.notConnected': '未接続',
  'login.signingIn': 'ログイン中…',
  'login.failed': 'ログインに失敗しました',
  'login.transportError': 'サーバーに接続できません。通信環境を確認して再試行してください。',

  'settings.title': '設定',
  'settings.language': '言語',
  'settings.language.hint': '切り替えるとすぐに反映され、選択内容は保存されます。',
  'settings.language.zh-Hans': '简体中文',
  'settings.language.zh-Hant': '繁體中文',
  'settings.language.ja': '日本語',
  'settings.language.en': 'English',
  'settings.applied': '設定を保存しました',

  'error.generic': '問題が発生しました。しばらくしてからお試しください。',
  'error.network': 'ネットワーク接続に失敗しました。',
  'error.timeout': 'リクエストがタイムアウトしました。',
  'error.unknownCode': '不明なエラーが発生しました（コード：{code}）。',
  'error.unauthorized': 'ログインの有効期限が切れました。再度ログインしてください。',
  'error.not_found': '該当する内容が見つかりません。',
  'error.invalid_request': 'リクエストの形式が正しくありません。',
  'error.deck_invalid': 'デッキがルールに適合していません。確認してからお試しください。',
  'error.mode_invalid': 'このモードは利用できません。',
  'error.forbidden_field': 'リクエストに変更できない項目が含まれています。',
  'error.match_state_invalid': '対局の状態ではこの操作は行えません。',
  'error.rate_limited': '操作が頻繁すぎます。しばらくしてからお試しください。',
  'error.battle_callback_freshness_incomplete': '対戦サービスのコールバック情報が不完全です。',
  'error.reconnect_expired': '再接続の期限が過ぎました。この対局には参加できません。',
  'error.match_already_ended': 'この対局はすでに終了しています。',
  'error.claim_ineligible': '現在は受取条件を満たしていません。',

  'gift.heart': '願い',
  'gift.heart.blurb': 'ちょっとした気持ちを渡す',
  'gift.star': '星砂',
  'gift.star.blurb': '光る砂をひとつかみ',
  'gift.ribbon': 'リボン',
  'gift.ribbon.blurb': '蝶結びをして渡す',
  'gift.lantern': '提灯',
  'gift.lantern.blurb': '灯りを掲げて照らす',
  'gift.wand': '御幣',
  'gift.wand.blurb': '箒を貸して……いや、御幣',
  'gift.cup': '茶',
  'gift.cup.blurb': '相手にお茶を一杯',
  'gift.bar.charges': '想い {left}/{total}',
  'gift.announce': '{from} が {to} に {gift} を贈った',
  'gift.toast.sent': '{gift} を贈った',

  'ui.signIn': 'ログイン',
  'ui.createAccount': 'アカウント作成',
  'ui.play': '開始',
  'ui.records': '戦績',
  'ui.shop': '商店',
  'ui.settings': '設定',
  'ui.back': '戻る',
  'ui.gift': '贈り物',
  'ui.deck': 'デッキ',
  'ui.rank': 'ランク',
  'ui.queue': '順番待ち',
  'ui.mail': 'メール',
  'ui.opponent': '相手',
};

const EN: Messages = {
  'app.title': 'Phantasm Klash',
  'app.subtitle': 'Clash of Fantasies',

  'login.title': 'Sign in',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.notConnected': 'Not connected',
  'login.signingIn': 'Signing in…',
  'login.failed': 'Sign-in failed',
  'login.transportError': 'Cannot reach the server. Check your connection and try again.',

  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.language.hint': 'Applies immediately, and your choice is remembered.',
  'settings.language.zh-Hans': '简体中文',
  'settings.language.zh-Hant': '繁體中文',
  'settings.language.ja': '日本語',
  'settings.language.en': 'English',
  'settings.applied': 'Settings saved',

  'error.generic': 'Something went wrong. Please try again later.',
  'error.network': 'Network connection failed.',
  'error.timeout': 'The request timed out.',
  'error.unknownCode': 'An unknown error occurred (code: {code}).',
  'error.unauthorized': 'Your session expired. Please sign in again.',
  'error.not_found': 'Nothing was found.',
  'error.invalid_request': 'The request was malformed.',
  'error.deck_invalid': 'The deck breaks the rules. Check it and try again.',
  'error.mode_invalid': 'That mode is unavailable.',
  'error.forbidden_field': 'The request contains a field that cannot be changed.',
  'error.match_state_invalid': 'The match state does not allow this action.',
  'error.rate_limited': 'Too many actions. Please slow down.',
  'error.battle_callback_freshness_incomplete': 'The battle service callback is incomplete.',
  'error.reconnect_expired': 'The reconnect window has passed; you cannot rejoin this match.',
  'error.match_already_ended': 'This match has already ended.',
  'error.claim_ineligible': 'You do not meet the claim requirements yet.',

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

const TABLES: Readonly<Record<LanguageCode, Messages>> = {
  'zh-Hans': ZH_HANS,
  'zh-Hant': ZH_HANT,
  ja: JA,
  en: EN,
};

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
  // `Messages` is an interface (no index signature), so the lookup goes through
  // a widened record: the tables are the compile-checked source of truth, and
  // this is the one place a runtime key string is allowed in.
  const table = TABLES[currentLanguage] as unknown as Readonly<Record<string, string | undefined>>;
  let value = table[key];
  if (value === undefined) {
    value = (TABLES[DEFAULT_LANGUAGE] as unknown as Readonly<Record<string, string | undefined>>)[key];
  }
  if (value === undefined) {
    return key;
  }
  if (params === undefined) {
    return value;
  }
  return value.replace(/\{(\w+)\}/g, (match: string, name: string) => {
    const param = params[name];
    return param === undefined ? match : String(param);
  });
}

/** Every key in the default table — the parity test walks this list. */
export function i18nKeys(): readonly string[] {
  return Object.keys(TABLES[DEFAULT_LANGUAGE]).sort();
}

/** The table for one language, for tests and for a future picker preview. */
export function stringTable(code: LanguageCode): Readonly<Record<string, string>> {
  return TABLES[code] as unknown as Readonly<Record<string, string>>;
}
