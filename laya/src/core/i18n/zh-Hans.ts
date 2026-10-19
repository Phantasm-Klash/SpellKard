import type { Messages } from './messages';

/** Simplified Chinese — the authoring locale and the fallback root. */
export const zhHans: Messages = {
  'app.title': '纷争幻想',
  'app.subtitle': 'Phantasm Klash',

  'login.title': '登录',
  'login.email': '邮箱',
  'login.password': '密码',
  'login.signIn': '登录',
  'login.createAccount': '注册账号',
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
};
