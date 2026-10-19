import type { Messages } from './messages';

/** Japanese. */
export const ja: Messages = {
  'app.title': '紛争幻想',
  'app.subtitle': 'Phantasm Klash',

  'login.title': 'ログイン',
  'login.email': 'メールアドレス',
  'login.password': 'パスワード',
  'login.signIn': 'ログイン',
  'login.createAccount': 'アカウント作成',
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
};
