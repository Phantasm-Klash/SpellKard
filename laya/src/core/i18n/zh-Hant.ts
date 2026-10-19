import type { Messages } from './messages';

/** Traditional Chinese. */
export const zhHant: Messages = {
  'app.title': '紛爭幻想',
  'app.subtitle': 'Phantasm Klash',

  'login.title': '登入',
  'login.email': '電子郵件',
  'login.password': '密碼',
  'login.signIn': '登入',
  'login.createAccount': '註冊帳號',
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
};
