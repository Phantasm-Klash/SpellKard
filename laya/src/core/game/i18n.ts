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
  'login.username': string;
  'login.email': string;
  'login.password': string;
  'login.confirmPassword': string;
  'login.emailCode': string;
  'login.notConnected': string;
  'login.signingIn': string;
  'login.creatingAccount': string;
  'login.signUpAndPlay': string;
  'login.backToSignIn': string;
  'login.sendCode': string;
  'login.resendCode': string;
  'login.connecting': string;
  'login.lobbyEndpoint': string;
  'login.failed': string;
  'login.transportError': string;
  // Local form validation, shown before a request is ever sent.
  'login.error.username': string;
  'login.error.passwordMismatch': string;
  'login.error.codeRequired': string;
  'login.error.emailRequired': string;

  // --- lobby surface ---
  'lobby.notSignedIn': string;
  'lobby.signOut': string;
  'lobby.checkin': string;
  'lobby.inventory': string;
  'lobby.page.menu': string;
  'lobby.page.play': string;
  'lobby.changeRoomCode': string;
  'lobby.createRoom': string;
  'lobby.backToLobby': string;
  'inventory.title': string;
  'inventory.cards': string;
  'inventory.chests': string;
  'inventory.open': string;
  'inventory.empty': string;
  'replay.session': string;
  'replay.play': string;
  'replay.pause': string;
  'replay.restart': string;
  'replay.close': string;
  'lobby.joinRoom': string;
  'lobby.joinRoomCode': string;
  'lobby.roomCodeHint': string;
  'lobby.joinQueue': string;
  'lobby.refreshQueue': string;
  'lobby.cancelQueue': string;
  'lobby.profile.ruleset': string;

  // --- room surface ---
  'room.title': string;
  'room.noRoom': string;
  'room.meta': string;
  'room.setup.caption': string;
  'room.setup.summary': string;
  'room.boss': string;
  'room.shot': string;
  'room.bomb': string;
  'room.default': string;
  'room.boss.default': string;
  'room.boss.tian': string;
  'room.boss.hui': string;
  'room.coop.players': string;
  'room.players': string;
  'room.waitingForPlayers': string;
  'room.ready': string;
  'room.startMatch': string;
  'room.leaveRoom': string;
  'room.readyWaiting': string;
  'room.badge.host': string;
  'room.badge.offline': string;
  'room.badge.ready': string;
  'room.badge.waiting': string;

  // --- result surface ---
  'result.title': string;
  'result.noResult': string;
  'result.victory': string;
  'result.defeat': string;
  'result.badge.victory': string;
  'result.badge.defeat': string;
  'result.yourStats': string;
  'result.opponent': string;
  'result.serverAuthoritative': string;
  'result.clientAuthoritative': string;
  'result.meta': string;
  'result.row.winner': string;
  'result.row.yourScore': string;
  'result.row.match': string;
  'result.row.opponent': string;
  'result.row.score': string;
  'result.row.replay': string;

  // --- records surface ---
  'records.career': string;
  'records.recentMatches': string;
  'records.recentMatchesCount': string;
  'records.loading': string;
  'records.noMatches': string;
  'records.refresh': string;
  'records.gold': string;
  'records.tickets': string;
  'records.points': string;
  'records.season': string;
  'records.matches': string;
  'records.wld': string;
  'records.winRate': string;
  'records.bestScore': string;
  'records.averageScore': string;
  'records.grazeHit': string;
  'records.damageCards': string;
  'records.decksCards': string;
  'records.unit.seconds': string;
  'records.unit.points': string;
  'records.result.win': string;
  'records.result.loss': string;
  'records.result.draw': string;

  // --- shop surface ---
  'shop.wallet': string;
  'shop.items': string;
  'shop.noListings': string;
  'shop.buy': string;
  'shop.stockUnlimited': string;
  'shop.stockCount': string;
  'shop.meta': string;

  // --- settings surface ---
  'settings.title': string;
  'settings.close': string;
  'settings.restoreDefaults': string;
  'settings.language': string;
  'settings.language.heading': string;
  'settings.language.hint': string;
  'settings.language.zh-Hans': string;
  'settings.language.zh-Hant': string;
  'settings.language.ja': string;
  'settings.language.en': string;
  'settings.applied': string;
  'settings.tab.display': string;
  'settings.tab.keys': string;
  'settings.tab.audio': string;
  'settings.tab.hud': string;
  'settings.tab.other': string;
  'settings.tab.about': string;
  'settings.subtitle.language': string;
  'settings.subtitle.display': string;
  'settings.subtitle.keys': string;
  'settings.subtitle.audio': string;
  'settings.subtitle.hud': string;
  'settings.subtitle.other': string;
  'settings.subtitle.about': string;
  // Display tab
  'settings.display.sharpening': string;
  'settings.display.sharpening.desc': string;
  'settings.display.upscaler': string;
  'settings.display.upscaler.desc': string;
  'settings.display.windowScale': string;
  'settings.display.windowScale.desc': string;
  'settings.display.windowScale.auto': string;
  'settings.display.effects': string;
  'settings.display.effects.desc': string;
  'settings.display.effect.low': string;
  'settings.display.effect.medium': string;
  'settings.display.effect.high': string;
  'settings.display.frameRate': string;
  'settings.display.frameRate.desc': string;
  'settings.display.frameCap.uncapped': string;
  'settings.display.showFps': string;
  'settings.display.showFps.desc': string;
  'settings.display.note': string;
  'settings.display.upscaling': string;
  'settings.display.unavailable': string;
  'settings.display.softwareNote': string;
  'settings.display.unavailableNote': string;
  // Network group (Other tab)
  'settings.network.heading': string;
  'settings.network.connection': string;
  'settings.network.connection.desc': string;
  'settings.network.official': string;
  'settings.network.lan': string;
  'settings.network.thirdParty': string;
  'settings.network.lanHost': string;
  'settings.network.lanHost.desc': string;
  'settings.network.httpBase': string;
  'settings.network.httpBase.desc': string;
  'settings.network.wsUrl': string;
  'settings.network.relayUrl': string;
  'settings.network.officialNote': string;
  // Mods group (Other tab)
  'settings.mods.heading': string;
  'settings.mods.workshop': string;
  'settings.mods.workshop.desc': string;
  'settings.mods.custom': string;
  'settings.mods.custom.desc': string;
  'settings.mods.folder': string;
  'settings.mods.note': string;
  // External modules group (Other tab)
  'settings.plugins.heading': string;
  'settings.plugins.autoLoad': string;
  'settings.plugins.autoLoad.desc': string;
  'settings.plugins.moduleUrls': string;
  'settings.plugins.moduleUrls.desc': string;
  'settings.plugins.note1': string;
  'settings.plugins.note2': string;
  // About tab
  'settings.about.repository': string;
  'settings.about.notPublished': string;
  'settings.about.open': string;
  'settings.about.heading.product': string;
  'settings.about.heading.licences': string;
  'settings.about.heading.source': string;
  'settings.about.heading.credits': string;
  'settings.about.game': string;
  'settings.about.version': string;
  'settings.about.build': string;
  'settings.about.code': string;
  'settings.about.assets': string;
  'settings.about.copyright': string;
  // Audio tab
  'settings.audio.heading.audio': string;
  'settings.audio.heading.music': string;
  'settings.audio.heading.sfx': string;
  'settings.audio.muteAll': string;
  'settings.audio.muteAll.desc': string;
  'settings.audio.master': string;
  'settings.audio.bgm': string;
  'settings.audio.graze': string;
  'settings.audio.graze.desc': string;
  'settings.audio.playerShot': string;
  'settings.audio.playerShot.desc': string;
  'settings.audio.skill': string;
  'settings.audio.skill.desc': string;
  'settings.audio.noAssetsNote': string;
  // HUD tab
  'settings.hud.heading': string;
  'settings.hud.opponentHud': string;
  'settings.hud.opponentHud.desc': string;
  'settings.hud.damageNumbers': string;
  'settings.hud.damageNumbers.desc': string;
  'settings.hud.scoreCard': string;
  'settings.hud.scoreCard.desc': string;
  'settings.hud.ultMeter': string;
  'settings.hud.ultMeter.desc': string;
  'settings.hud.statusCard': string;
  'settings.hud.statusCard.desc': string;
  'settings.hud.bulletCount': string;
  'settings.hud.bulletCount.desc': string;
  'settings.hud.countdown': string;
  'settings.hud.countdown.desc': string;
  'settings.hud.networkFooter': string;
  'settings.hud.networkFooter.desc': string;
  'settings.hud.note': string;
  // Keys tab
  'settings.keys.intro': string;
  'settings.keys.textInputNote': string;
  'settings.keys.scope.global': string;
  'settings.keys.scope.login': string;
  'settings.keys.scope.lobby': string;
  'settings.keys.scope.room': string;
  'settings.keys.scope.battle': string;
  'settings.keys.scope.result': string;
  'settings.keys.scope.checkin': string;
  'settings.keys.scope.shop': string;
  'settings.keys.scope.inventory': string;
  'settings.keys.scope.records': string;
  'settings.keys.scope.settings': string;

  // --- check-in surface ---
  'checkin.title': string;
  'checkin.cycle': string;
  'checkin.claim': string;
  'checkin.locked': string;
  'checkin.claimed': string;
  'checkin.loading': string;
  'checkin.streak': string;
  'checkin.day': string;

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

  // --- shared button labels / captions ---
  'ui.signIn': string;
  'ui.createAccount': string;
  'ui.play': string;
  'ui.records': string;
  'gacha.title': string;
  'gacha.pools': string;
  'gacha.pool.cards': string;
  'gacha.pool.characters': string;
  'gacha.wallet': string;
  'gacha.kind.cards': string;
  'gacha.kind.characters': string;
  'gacha.odds': string;
  'gacha.costLine': string;
  'gacha.pity': string;
  'gacha.lastPull': string;
  'gacha.noPulls': string;
  'gacha.roster': string;
  'gacha.rosterLine': string;
  'gacha.exchangePick': string;
  'gacha.exchangeNeed': string;
  'gacha.allUnlocked': string;
  'gacha.pullSingle': string;
  'gacha.pullTen': string;
  'gacha.back': string;
  'gacha.result.new': string;
  'gacha.result.dupeFaith': string;
  'gacha.result.dupeDust': string;
  'screen.gacha.cards': string;
  'screen.gacha.characters': string;
  'ui.shop': string;
  'ui.settings': string;
  'ui.back': string;
  'ui.gift': string;
  'ui.deck': string;
  'ui.rank': string;
  'ui.queue': string;
  'ui.mail': string;
  'ui.opponent': string;
  'ui.roomCode': string;
  'ui.backToLobby': string;
  'ui.downloadDem': string;
  'ui.matchLabel': string;

  // --- lobby flow status (`core/game/lobby_flow.ts`) -------------------------
  // The flow used to hard-code English status lines, so every language showed
  // English while signing in, creating a room and settling a match.
  'flow.notConnected': string;
  'flow.signingIn': string;
  'flow.loadingProfile': string;
  'flow.signedInAs': string;
  'flow.signInFailed': string;
  'flow.loginFailed': string;
  'flow.bootstrapFailed': string;
  'flow.enterEmailPassword': string;
  'flow.enterEmail': string;
  'flow.enterUsernameEmailPassword': string;
  'flow.sendingCode': string;
  'flow.codeSent': string;
  'flow.codeSendFailed': string;
  'flow.creatingAccount': string;
  'flow.accountCreated': string;
  'flow.signUpFailed': string;
  'flow.signedOut': string;
  'flow.creatingRoom': string;
  'flow.room.left': string;
  'flow.room.noRoom': string;
  'flow.room.bossLocked': string;
  'flow.room.reconfiguring': string;
  'flow.room.reconfigureFailed': string;
  'flow.room.ready': string;
  'flow.queue.joining': string;
  'flow.queue.joinFailed': string;
  'flow.queue.queued': string;
  'flow.queue.notQueued': string;
  'flow.queue.pollFailed': string;
  'flow.queue.status': string;
  'flow.queue.cancelFailed': string;
  'flow.queue.left': string;
  'flow.match.readyWaitingMatch': string;
  'flow.match.readyWaitingPlayers': string;
  'flow.match.readyFailed': string;
  'flow.match.backInLobby': string;
  'flow.match.noMatchToAbandon': string;
  'flow.match.leaving': string;
  'flow.match.abandonFailed': string;
  'flow.match.abandoned': string;
  'flow.match.info': string;
  'flow.match.winner': string;
  'flow.checkin.loading': string;
  'flow.checkin.loadFailed': string;
  'flow.checkin.streak': string;
  'flow.checkin.claimFailed': string;
  'flow.checkin.claimed': string;
  'flow.shop.loading': string;
  'flow.shop.loadFailed': string;
  'flow.shop.summary': string;
  'flow.shop.purchaseFailed': string;
  'flow.shop.bought': string;
  'flow.gacha.loading': string;
  'flow.gacha.loadFailed': string;
  'flow.gacha.rosterFailed': string;
  'flow.gacha.pullFailed': string;
  'flow.gacha.pulledOne': string;
  'flow.gacha.pulledMany': string;
  'flow.gacha.exchangeFailed': string;
  'flow.gacha.unlocked': string;
  'flow.inventory.loading': string;
  'flow.inventory.loadFailed': string;
  'flow.inventory.summary': string;
  'flow.records.loading': string;
  'flow.records.loadFailed': string;
  'flow.records.summary': string;
  'flow.createRoomFailed': string;
  'flow.joiningRoom': string;
  'flow.joinRoomFailed': string;
  'flow.roomStatus': string;
  'flow.matchStarting': string;
  'flow.matchResult': string;
  'flow.transportClosed': string;
  'flow.queueIdle': string;
  'flow.queueStatus': string;

  // --- auth error codes (`core/game/auth_messages.ts`) ------------------------
  'auth.unauthorized': string;
  'auth.accountExists': string;
  'auth.usernameRequired': string;
  'auth.emailRequired': string;
  'auth.passwordRequired': string;
  'auth.usernameInvalid': string;
  'auth.emailInvalid': string;
  'auth.passwordWeak': string;
  'auth.usernameTaken': string;
  'auth.emailTaken': string;
  'auth.emailNotVerified': string;
  'auth.codeRequired': string;
  'auth.codeInvalid': string;
  'auth.codeExpired': string;
  'auth.codeRateLimited': string;
  'auth.mailUnavailable': string;
  'auth.nakamaEmailCodeUnsupported': string;
  'auth.nakamaAuthenticateFailed': string;
  'auth.accountsUnavailable': string;
  'auth.invalidRequest': string;
  'auth.storageUnavailable': string;
  'auth.loginMissingSession': string;
  'auth.transportError': string;
  'auth.sessionReplaced': string;
  'auth.sessionExpired': string;

  // --- keyboard shortcut reference (core/input/shortcuts.ts) ---------------
  // The binding table carries the i18n key; `core/` stays engine-agnostic and
  // the settings panel resolves it with `t()`. Every language must ship a value
  // for each key, or the reference list silently falls back to Simplified
  // Chinese — which is exactly how a Chinese label reached an English screen.
  'shortcuts.app.fullscreen': string;
  'shortcuts.app.settings': string;
  'shortcuts.app.settingsClose': string;
  'shortcuts.battle.back': string;
  'shortcuts.battle.forfeit': string;
  'shortcuts.battle.pause': string;
  'shortcuts.battle.toggleHud': string;
  'shortcuts.gacha.nextPool': string;
  'shortcuts.gacha.prevPool': string;
  'shortcuts.gacha.pullOne': string;
  'shortcuts.lobby.activate': string;
  'shortcuts.lobby.menuNext': string;
  'shortcuts.lobby.menuPrev': string;
  'shortcuts.lobby.playPage': string;
  'shortcuts.login.back': string;
  'shortcuts.login.focusNext': string;
  'shortcuts.login.focusPrev': string;
  'shortcuts.login.sendCode': string;
  'shortcuts.login.submit': string;
  'shortcuts.login.toggleMode': string;
  'shortcuts.room.leave': string;
  'shortcuts.room.ready': string;
  'shortcuts.settings.reset': string;
  'shortcuts.settings.scrollBottom': string;
  'shortcuts.settings.scrollDown': string;
  'shortcuts.settings.scrollTop': string;
  'shortcuts.settings.scrollUp': string;
  'shortcuts.settings.tabNext': string;
  'shortcuts.settings.tabPrev': string;
  'shortcuts.shop.buy': string;
  'shortcuts.ui.back': string;
  'shortcuts.ui.confirm': string;
  'shortcuts.ui.continue': string;
  'shortcuts.ui.next': string;
  'shortcuts.ui.prev': string;
  'shortcuts.ui.use': string;
}

export type LanguageCode = 'zh-Hans' | 'zh-Hant' | 'ja' | 'en';

/**
 * Language shown when nothing is persisted.
 *
 * Simplified Chinese, because the game ships as a Chinese product (the lobby
 * header, the title logo and the store copy are all 中文-first) and a player who
 * has never opened the settings should land on the language the game is
 * marketed in. Every table is complete, so switching to any other code — or
 * overriding this one with `?lang=` — is still a one-line change at runtime.
 *
 * The English column stays verbatim: the E2E harnesses assert against it, and
 * they pin `?lang=en` explicitly rather than relying on this default.
 */
export const DEFAULT_LANGUAGE: LanguageCode = 'zh-Hans';

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
// Keys are namespaced by domain (`gift.*`, `ui.*`, `room.*`). When adding a
// string, add it to EVERY table below in the same commit —
// `tests/i18n.test.ts` fails the build otherwise. The English column is the
// copy the E2E harness asserts against, so it must stay verbatim.
// ---------------------------------------------------------------------------

const ZH_HANS: Messages = {
  'app.title': '纷争幻想',
  'app.subtitle': 'Phantasm Klash',

  'login.title': '登录',
  'login.username': '用户名',
  'login.email': '邮箱',
  'login.password': '密码',
  'login.confirmPassword': '确认密码',
  'login.emailCode': '邮箱验证码',
  'login.notConnected': '未连接',
  'login.signingIn': '正在登录…',
  'login.creatingAccount': '正在创建账号…',
  'login.signUpAndPlay': '注册并开始',
  'login.backToSignIn': '返回登录',
  'login.sendCode': '发送验证码',
  'login.resendCode': '重新发送 {seconds}s',
  'login.connecting': '正在连接…',
  'login.lobbyEndpoint': '大厅：{endpoint}',
  'login.failed': '登录失败',
  'login.transportError': '无法连接服务器，请检查网络后重试。',
  'login.error.username': '请输入用户名',
  'login.error.passwordMismatch': '两次输入的密码不一致',
  'login.error.codeRequired': '请输入我们发送到您邮箱的 6 位验证码',
  'login.error.emailRequired': '请先输入您的邮箱地址',

  'lobby.notSignedIn': '未登录',
  'lobby.signOut': '退出登录',
  'lobby.checkin': '签到',
  'lobby.inventory': '背包',
  'lobby.page.menu': '主菜单',
  'lobby.page.play': '开始游戏',
  'lobby.changeRoomCode': '更换房间码',
  'lobby.createRoom': '创建房间',
  'lobby.backToLobby': '返回大厅',
  'inventory.title': '背包',
  'inventory.cards': '卡牌',
  'inventory.chests': '卡包',
  'inventory.open': '开启',
  'inventory.empty': '背包是空的',
  'replay.session': '对战信息',
  'replay.play': '播放',
  'replay.pause': '暂停',
  'replay.restart': '重播',
  'replay.close': '关闭',
  'lobby.joinRoom': '加入房间',
  'lobby.joinRoomCode': '加入的房间码',
  'lobby.roomCodeHint': '输入房主分享的房间码',
  'lobby.joinQueue': '加入匹配队列',
  'lobby.refreshQueue': '刷新队列状态',
  'lobby.cancelQueue': '取消匹配',
  'lobby.profile.ruleset': '规则集 {version}',

  'room.title': '房间',
  'room.noRoom': '暂无房间',
  'room.meta': '{mode} · 规则集 {version}',
  'room.setup.caption': '对局设置 · 仅房主可改',
  'room.setup.summary': 'Boss：{boss} · 自机：{shot} / {bomb}',
  'room.boss': 'Boss',
  'room.shot': '射击',
  'room.bomb': '炸弹',
  'room.default': '默认',
  'room.boss.default': '默认',
  'room.boss.tian': '天',
  'room.boss.hui': '辉',
  'room.coop.players': '合作 {count} 人',
  'room.players': '玩家',
  'room.waitingForPlayers': '等待玩家加入…',
  'room.ready': '准备',
  'room.startMatch': '开始对局',
  'room.leaveRoom': '离开房间',
  'room.readyWaiting': '已准备 — 等待对局开始…',
  'room.badge.host': '房主',
  'room.badge.offline': '离线',
  'room.badge.ready': '已准备',
  'room.badge.waiting': '等待中',

  'result.title': '对局结果',
  'result.noResult': '暂无结果',
  'result.victory': '胜利！',
  'result.defeat': '失败',
  'result.badge.victory': '胜利',
  'result.badge.defeat': '失败',
  'result.yourStats': '你的数据',
  'result.opponent': '对手',
  'result.serverAuthoritative': '服务端权威',
  'result.clientAuthoritative': '客户端权威',
  'result.meta': '{source} · {ms}ms 结算',
  'result.row.winner': '胜者',
  'result.row.yourScore': '你的得分',
  'result.row.match': '对局',
  'result.row.opponent': '对手',
  'result.row.score': '得分',
  'result.row.replay': '回放',

  'records.career': '生涯数据',
  'records.recentMatches': '最近对局',
  'records.recentMatchesCount': '最近对局（{count}）',
  'records.loading': '正在加载战绩…',
  'records.noMatches': '暂无对局记录',
  'records.refresh': '刷新',
  'records.gold': '金币',
  'records.tickets': '抽奖券',
  'records.points': '点数',
  'records.season': '赛季',
  'records.matches': '对局数',
  'records.wld': '胜-负-平',
  'records.winRate': '胜率',
  'records.bestScore': '最高分',
  'records.averageScore': '平均分',
  'records.grazeHit': '擦弹 · 命中',
  'records.damageCards': '伤害 · 出牌',
  'records.decksCards': '卡组 · 卡牌',
  'records.unit.seconds': '{seconds}秒',
  'records.unit.points': '{points} 分',
  'records.result.win': '胜利',
  'records.result.loss': '失败',
  'records.result.draw': '平局',

  'shop.wallet': '钱包',
  'shop.items': '商品',
  'shop.noListings': '暂无商品',
  'shop.buy': '购买',
  'shop.stockUnlimited': '无限',
  'shop.stockCount': '库存 {count}',
  'shop.meta': '价格 {price} · {stock} · 已购买 {count}',

  'settings.title': '设置',
  'settings.close': '关闭',
  'settings.restoreDefaults': '恢复默认设置',
  'settings.language': '语言',
  'settings.language.heading': '语言',
  'settings.language.hint': '切换后立即生效，并会记住你的选择。',
  'settings.language.zh-Hans': '简体中文',
  'settings.language.zh-Hant': '繁體中文',
  'settings.language.ja': '日本語',
  'settings.language.en': 'English',
  'settings.applied': '设置已保存',
  'settings.tab.display': '显示',
  'settings.tab.keys': '按键',
  'settings.tab.audio': '音频',
  'settings.tab.hud': 'HUD',
  'settings.tab.other': '其他',
  'settings.tab.about': '关于',
  'settings.subtitle.language': '界面语言',
  'settings.subtitle.display': '分辨率、特效与帧率',
  'settings.subtitle.keys': '客户端全部按键绑定',
  'settings.subtitle.audio': '音乐、擦弹、射击与技能音量',
  'settings.subtitle.hud': '对局中绘制哪些浮层',
  'settings.subtitle.other': '连接模式与模组',
  'settings.subtitle.about': '版权、版本与制作人员',
  'settings.display.sharpening': '锐化',
  'settings.display.sharpening.desc': '在软件放大后应用的对比度自适应锐化。0% 即普通双线性放大。',
  'settings.display.upscaler': '放大器',
  'settings.display.upscaler.desc': '后处理放大后端。仅可选择此版本实际可用的后端，其余列在下方。',
'settings.display.windowScale': '窗口大小',
'settings.display.windowScale.desc': '以界面设计尺寸（900×1200）的整数倍设置游戏窗口大小。',
'settings.display.windowScale.auto': '自动',
  'settings.display.effects': '特效',
  'settings.display.effects.desc': '弹幕拖尾、辉光与命中特效。',
  'settings.display.effect.low': '低',
  'settings.display.effect.medium': '中',
  'settings.display.effect.high': '高',
  'settings.display.frameRate': '帧率上限',
  'settings.display.frameRate.desc': '限制游戏重绘频率。对局过程由服务端权威计算，此设置不会影响模拟。',
  'settings.display.frameCap.uncapped': '不限制',
  'settings.display.showFps': '显示帧率',
  'settings.display.showFps.desc': '在对局画面角落显示帧率计数器。',
  'settings.display.note':
    '帧率上限与分辨率倍率都会立即生效：前者限制引擎渲染循环，后者重设画布后备存储。',
  'settings.display.upscaling': '放大',
  'settings.display.unavailable': '{label}（不可用）',
  'settings.display.softwareNote': '这是在浏览器中实现的空间近似算法。它不是 DLSS，也不是 FSR —— 详见上方说明。',
  'settings.display.unavailableNote': '此版本不可用 —— {details}',
  'settings.network.heading': '网络',
  'settings.network.connection': '连接',
  'settings.network.connection.desc': '客户端连接哪个大厅服务器。选择会立即保存，并在下次连接时生效。',
  'settings.network.official': '官方',
  'settings.network.lan': '局域网',
  'settings.network.thirdParty': '第三方',
  'settings.network.lanHost': '局域网主机',
  'settings.network.lanHost.desc': '局域网中 Gensoulkyo 服务器的主机或主机:端口。大厅 WebSocket 与对战中继路径由此派生。',
  'settings.network.httpBase': '大厅 HTTP 地址',
  'settings.network.httpBase.desc': '第三方部署的 REST 基础地址。',
  'settings.network.wsUrl': '大厅 WebSocket 地址',
  'settings.network.relayUrl': '对战中继地址',
  'settings.network.officialNote':
    '官方模式使用编译进此版本的大厅与对战中继地址。局域网模式会从你输入的主机派生 http://<host>、ws://<host>/ws 与 ws://<host>/relay，因此只需填写主机。',
  'settings.mods.heading': '模组',
  'settings.mods.workshop': '创意工坊',
  'settings.mods.workshop.desc': '浏览并安装社区模组。预留功能 —— 尚未随附加载器。',
  'settings.mods.custom': '自定义模组',
  'settings.mods.custom.desc': '从你选择的文件夹加载模组。',
  'settings.mods.folder': '模组文件夹',
  'settings.mods.note': '模组加载器尚未实现。这些偏好会被保存，以便未来的加载器遵循；当前不会加载任何内容。',
  'settings.plugins.heading': '外部模块（DLC）',
  'settings.plugins.autoLoad': '自动加载外部模块',
  'settings.plugins.autoLoad.desc': '客户端启动时立即加载下方所有模块地址，不再逐个询问。',
  'settings.plugins.moduleUrls': '模块地址',
  'settings.plugins.moduleUrls.desc': '一个或多个 ES 模块地址，以空格分隔。在此添加之前不会获取任何内容。',
  'settings.plugins.note1':
    '除非在此输入地址，否则不会下载任何内容。每个地址必须提供导出 createUpscaler()（或 upscaler / descriptor / register(registry)）的 ES 模块。以这种方式加载的模块只能注册外部放大器后端，它无法让此渲染器支持 DLSS 或 FSR —— 只能为本就支持相应后端的平台提供一个真实后端。',
  'settings.plugins.note2':
    '仅接受 http(s):// 地址和根相对 /path 地址。其他形式 —— file:、data:、裸主机名 —— 会在存储或导入前被拒绝。',
  'settings.about.repository': '仓库',
  'settings.about.notPublished': '尚未发布',
  'settings.about.open': '打开',
  'settings.about.heading.product': '产品',
  'settings.about.heading.licences': '许可',
  'settings.about.heading.source': '源码',
  'settings.about.heading.credits': '制作人员',
  'settings.about.game': '游戏',
  'settings.about.version': '版本',
  'settings.about.build': '构建',
  'settings.about.code': '代码',
  'settings.about.assets': '素材',
  'settings.about.copyright': '版权',
  'settings.audio.heading.audio': '音频',
  'settings.audio.heading.music': '音乐',
  'settings.audio.heading.sfx': '音效',
  'settings.audio.muteAll': '全部静音',
  'settings.audio.muteAll.desc': '静音所有声道，但保留下方的混音设置，取消静音后可精确恢复。',
  'settings.audio.master': '主音量',
  'settings.audio.bgm': 'BGM 音量',
  'settings.audio.graze': '擦弹',
  'settings.audio.graze.desc': '子弹贴近判定点时播放的擦弹提示音。',
  'settings.audio.playerShot': '自机射击',
  'settings.audio.playerShot.desc': '你自机的射击音效。',
  'settings.audio.skill': '技能',
  'settings.audio.skill.desc': '炸弹与符卡音效。',
  'settings.audio.noAssetsNote':
    '此版本未随附音频文件。下方的音量设置会被保存并推送到引擎混音器，但在加入声音素材之前不会有任何声音。',
  'settings.hud.heading': '对局 HUD',
  'settings.hud.opponentHud': '对手 HUD',
  'settings.hud.opponentHud.desc': '对手的 Boss 血量面板。',
  'settings.hud.damageNumbers': '伤害数字',
  'settings.hud.damageNumbers.desc': '在 Boss 身上飘出的伤害数值。',
  'settings.hud.scoreCard': '分数卡',
  'settings.hud.scoreCard.desc': '你的分数与连击读数。',
  'settings.hud.ultMeter': '符力槽',
  'settings.hud.ultMeter.desc': '炸弹与符卡的蓄力槽。',
  'settings.hud.statusCard': '状态卡',
  'settings.hud.statusCard.desc': '主读数条：血量、残机与子弹数。',
  'settings.hud.bulletCount': '子弹数',
  'settings.hud.bulletCount.desc': '状态卡中的 BULLETS 行。',
  'settings.hud.countdown': '倒计时',
  'settings.hud.countdown.desc': '对局剩余时间。',
  'settings.hud.networkFooter': '网络页脚',
  'settings.hud.networkFooter.desc': '沿底边显示的延迟与同步读数。',
  'settings.hud.note':
    '隐藏的区块会重新排版而非留下空隙，因此 HUD 保持紧凑。伤害数字与符力槽浮层仍在制作中：这两个开关会先保存，待对应浮层上线后生效。',
  'settings.keys.intro':
    '此列表由调度器实际匹配的唯一绑定表生成，因此永远不会与代码不一致。文本输入框聚焦时仍然有效的按键会在末尾的说明中标注。',
  'settings.keys.textInputNote':
    '文本输入框聚焦时，仅触发标记为 allowInTextInput 的绑定 —— Tab、Shift+Tab、Enter、Escape、Alt+Enter、Ctrl+Tab。',
  'settings.keys.scope.global': '全局',
  'settings.keys.scope.login': '登录',
  'settings.keys.scope.lobby': '大厅',
  'settings.keys.scope.room': '房间',
  'settings.keys.scope.battle': '对局',
  'settings.keys.scope.result': '结算',
  'settings.keys.scope.checkin': '签到',
  'settings.keys.scope.shop': '商店',
  'settings.keys.scope.inventory': '背包',
  'settings.keys.scope.records': '战绩',
  'settings.keys.scope.settings': '设置',
  'checkin.title': '签到',
  'checkin.cycle': '本期',
  'checkin.claim': '领取',
  'checkin.locked': '未解锁',
  'checkin.claimed': '已领取',
  'checkin.loading': '正在加载签到…',
  'checkin.streak': '{days} 天连续签到 · {cycle}',
  'checkin.day': '第 {day} 天',

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
  'gacha.title': '寻觅 · 抽卡',
  'gacha.pools': '卡池',
  'gacha.pool.cards': '卡牌池',
  'gacha.pool.characters': '角色池',
  'gacha.wallet': '辉玉 {gems} · 信仰 {faith} · 卡尘 {dust}',
  'gacha.kind.cards': '20 张卡牌',
  'gacha.kind.characters': '52 个自机 · A1/A2/B1/B2',
  'gacha.odds': '{kind} · {odds}',
  'gacha.costLine': '单抽 {single} / 十连 {ten}',
  'gacha.pity': '保底：{rare} 抽内必出 SSR+ · {epic} 抽内必出 UR · 十连必出 SSR+',
  'gacha.lastPull': '本次结果',
  'gacha.noPulls': '还没有抽过 —— 结果全部由服务器判定',
  'gacha.roster': '名册 · 信仰兑换',
  'gacha.rosterLine': '已拥有 {owned}/52 · 信仰 {faith} · 兑换需 {cost}',
  'gacha.exchangePick': '信仰兑换 —— 选一个未解锁自机（{cost} 信仰）',
  'gacha.exchangeNeed': '信仰不足：需要 {cost}，当前 {faith}（每抽 +1）',
  'gacha.allUnlocked': '52 个自机已全部解锁',
  'gacha.pullSingle': '单抽 · {cost}',
  'gacha.pullTen': '十连 · {cost}',
  'gacha.back': '返回大厅',
  'gacha.result.new': '[{rarity}] {name} —— 新获得',
  'gacha.result.dupeFaith': '[{rarity}] {name} —— 重复 → +{faith} 信仰',
  'gacha.result.dupeDust': '[{rarity}] {name} —— 重复 → +{dust} 卡尘',
  'screen.gacha.cards': '卡牌池',
  'screen.gacha.characters': '角色池',
  'ui.shop': '商店',
  'ui.settings': '设置',

  // --- lobby flow status -----------------------------------------------------
  'flow.notConnected': '未连接',
  'flow.signingIn': '正在登录…',
  'flow.loadingProfile': '正在加载资料…',
  'flow.signedInAs': '已登录：{name}',
  'flow.signInFailed': '登录失败',
  'flow.loginFailed': '登录失败：{reason}',
  'flow.bootstrapFailed': '初始化失败：{reason}',
  'flow.enterEmailPassword': '请输入邮箱和密码',
  'flow.enterEmail': '请输入邮箱地址',
  'flow.enterUsernameEmailPassword': '请输入用户名、邮箱和密码',
  'flow.sendingCode': '正在发送验证码…',
  'flow.codeSent': '验证码已发送至 {email}',
  'flow.codeSendFailed': '验证码发送失败',
  'flow.creatingAccount': '正在创建账号…',
  'flow.accountCreated': '账号已创建 —— 已登录：{name}',
  'flow.signUpFailed': '注册失败',
  'flow.signedOut': '已退出登录',
  'flow.creatingRoom': '正在创建房间 {code}…',
  'flow.createRoomFailed': '创建房间失败：{reason}',
  'flow.joiningRoom': '正在加入房间 {code}…',
  'flow.joinRoomFailed': '加入房间失败：{reason}',
  'flow.roomStatus': '房间 {code}：{count} 人',
  'flow.matchStarting': '对局 {id} 即将开始',
  'flow.matchResult': '胜者：{winner}',
  'flow.transportClosed': '大厅连接已关闭：{reason}',
  'flow.queueIdle': '匹配队列：空闲',
  'flow.queueStatus': '匹配队列：{status}',
  'flow.room.left': '已离开房间',
  'flow.room.noRoom': '没有可重新配置的房间',
  'flow.room.bossLocked': '只有独自在房间时才能更换 Boss / 配装',
  'flow.room.reconfiguring': '正在重新配置房间…',
  'flow.room.reconfigureFailed': '重新配置房间失败：{error}',
  'flow.room.ready': '房间 {code} 已就绪',
  'flow.queue.joining': '正在加入匹配队列…',
  'flow.queue.joinFailed': '加入匹配队列失败：{error}',
  'flow.queue.queued': '排队中 {id}（{status}）',
  'flow.queue.notQueued': '当前不在匹配队列中',
  'flow.queue.pollFailed': '刷新队列状态失败：{error}',
  'flow.queue.status': '队列 {id}：{status}{suffix}',
  'flow.queue.cancelFailed': '取消匹配队列失败：{error}',
  'flow.queue.left': '已离开匹配队列',
  'flow.match.readyWaitingMatch': '已准备 — 等待匹配…',
  'flow.match.readyWaitingPlayers': '已准备 — 等待玩家…',
  'flow.match.readyFailed': '准备失败：{error}',
  'flow.match.backInLobby': '已返回大厅',
  'flow.match.noMatchToAbandon': '没有可放弃的对局',
  'flow.match.leaving': '正在离开对局…',
  'flow.match.abandonFailed': '放弃对局失败：{error}',
  'flow.match.abandoned': '已放弃对局 {id}',
  'flow.match.info': '对局 {id}',
  'flow.match.winner': '胜者：{id}',
  'flow.checkin.loading': '正在加载签到…',
  'flow.checkin.loadFailed': '加载签到失败：{error}',
  'flow.checkin.streak': '签到：连续 {streak} 天',
  'flow.checkin.claimFailed': '领取签到奖励失败：{error}',
  'flow.checkin.claimed': '已领取第 {day} 天 · 连续 {streak} 天',
  'flow.shop.loading': '正在加载商店…',
  'flow.shop.loadFailed': '加载商店失败：{error}',
  'flow.shop.summary': '商店：{count} 件商品',
  'flow.shop.purchaseFailed': '购买失败：{error}',
  'flow.shop.bought': '已购买 {count}× {item}',
  'flow.gacha.loading': '正在加载抽卡…',
  'flow.gacha.loadFailed': '加载抽卡池失败：{error}',
  'flow.gacha.rosterFailed': '加载角色列表失败：{error}',
  'flow.gacha.pullFailed': '抽卡失败：{error}',
  'flow.gacha.pulledOne': '抽到 1× {pool}',
  'flow.gacha.pulledMany': '抽到 {count}× {pool}',
  'flow.gacha.exchangeFailed': '兑换失败：{error}',
  'flow.gacha.unlocked': '已用 {faith} 信仰解锁 {item}',
  'flow.inventory.loading': '正在加载背包…',
  'flow.inventory.loadFailed': '加载背包失败：{error}',
  'flow.inventory.summary': '背包：{count} 组物品',
  'flow.records.loading': '正在加载记录…',
  'flow.records.loadFailed': '加载记录失败：{error}',
  'flow.records.summary': '记录：{wins} 胜 {losses} 负 {draws} 平',

  // --- auth error codes ------------------------------------------------------
  'auth.unauthorized': '邮箱或密码错误',
  'auth.accountExists': '该账号已注册',
  'auth.usernameRequired': '请输入用户名',
  'auth.emailRequired': '请输入邮箱地址',
  'auth.passwordRequired': '请输入密码',
  'auth.usernameInvalid': '用户名须为 3-24 位字母、数字或下划线',
  'auth.emailInvalid': '该邮箱地址无效',
  'auth.passwordWeak': '密码至少需要 8 个字符',
  'auth.usernameTaken': '该用户名已被占用',
  'auth.emailTaken': '该邮箱已注册 —— 请直接登录',
  'auth.emailNotVerified': '请先验证邮箱再登录',
  'auth.codeRequired': '请输入我们发送到邮箱的 6 位验证码',
  'auth.codeInvalid': '验证码不正确',
  'auth.codeExpired': '验证码已过期 —— 请重新获取',
  'auth.codeRateLimited': '请稍候再请求新的验证码',
  'auth.mailUnavailable': '大厅暂时无法发送邮件 —— 请稍后重试',
  'auth.nakamaEmailCodeUnsupported': '当前登录方式不支持邮箱验证码 —— 请用用户名和密码登录',
  'auth.nakamaAuthenticateFailed': '登录服务拒绝了这次登录 —— 请稍后重试',
  'auth.accountsUnavailable': '账号服务暂不可用 —— 请稍后重试',
  'auth.invalidRequest': '用户名须为 3-24 位字母、数字或下划线，密码至少 8 个字符',
  'auth.storageUnavailable': '大厅暂时无法连接数据库 —— 请稍后重试',
  'auth.loginMissingSession': '大厅已接受登录，但未返回会话',
  'auth.transportError': '无法连接大厅 —— 请确认服务正在运行',
  'auth.sessionReplaced': '该账号已在其他设备登录',
  'auth.sessionExpired': '登录已过期，请重新登录',
  'ui.back': '返回',
  'ui.gift': '送礼',
  'ui.deck': '卡组',
  'ui.rank': '段位',
  'ui.queue': '排队',
  'ui.mail': '邮件',
  'ui.opponent': '对手',
  'ui.roomCode': '房间码',
  'ui.backToLobby': '返回大厅',
  'ui.downloadDem': '下载 .dem',
  'ui.matchLabel': '对局 {id}',
  'shortcuts.app.fullscreen': '切换全屏',
  'shortcuts.app.settings': '打开设置',
  'shortcuts.app.settingsClose': '关闭设置 / 返回',
  'shortcuts.battle.back': '返回大厅',
  'shortcuts.battle.forfeit': '认输并返回',
  'shortcuts.battle.pause': '暂停 / 继续',
  'shortcuts.battle.toggleHud': '切换 HUD',
  'shortcuts.gacha.nextPool': '下一个卡池',
  'shortcuts.gacha.prevPool': '上一个卡池',
  'shortcuts.gacha.pullOne': '单抽',
  'shortcuts.lobby.activate': '激活选中项',
  'shortcuts.lobby.menuNext': '下一个菜单项',
  'shortcuts.lobby.menuPrev': '上一个菜单项',
  'shortcuts.lobby.playPage': '打开对战页面',
  'shortcuts.login.back': '返回主菜单',
  'shortcuts.login.focusNext': '下一个输入框',
  'shortcuts.login.focusPrev': '上一个输入框',
  'shortcuts.login.sendCode': '发送邮箱验证码',
  'shortcuts.login.submit': '登录 / 创建账号',
  'shortcuts.login.toggleMode': '切换登录 / 注册',
  'shortcuts.room.leave': '离开房间',
  'shortcuts.room.ready': '准备 / 开始',
  'shortcuts.settings.reset': '恢复所有默认设置',
  'shortcuts.settings.scrollBottom': '滚动到底部',
  'shortcuts.settings.scrollDown': '向下滚动一页',
  'shortcuts.settings.scrollTop': '滚动到顶部',
  'shortcuts.settings.scrollUp': '向上滚动一页',
  'shortcuts.settings.tabNext': '下一个标签页',
  'shortcuts.settings.tabPrev': '上一个标签页',
  'shortcuts.shop.buy': '购买',
  'shortcuts.ui.back': '返回',
  'shortcuts.ui.confirm': '确认',
  'shortcuts.ui.continue': '继续',
  'shortcuts.ui.next': '下一个',
  'shortcuts.ui.prev': '上一个',
  'shortcuts.ui.use': '使用',

};

const ZH_HANT: Messages = {
  'app.title': '紛爭幻想',
  'app.subtitle': 'Phantasm Klash',

  'login.title': '登入',
  'login.username': '用戶名稱',
  'login.email': '電子郵件',
  'login.password': '密碼',
  'login.confirmPassword': '確認密碼',
  'login.emailCode': '電子郵件驗證碼',
  'login.notConnected': '未連線',
  'login.signingIn': '正在登入…',
  'login.creatingAccount': '正在建立帳號…',
  'login.signUpAndPlay': '註冊並開始',
  'login.backToSignIn': '返回登入',
  'login.sendCode': '傳送驗證碼',
  'login.resendCode': '重新傳送 {seconds}s',
  'login.connecting': '正在連線…',
  'login.lobbyEndpoint': '大廳：{endpoint}',
  'login.failed': '登入失敗',
  'login.transportError': '無法連線到伺服器，請檢查網路後重試。',
  'login.error.username': '請輸入用戶名稱',
  'login.error.passwordMismatch': '兩次輸入的密碼不一致',
  'login.error.codeRequired': '請輸入我們傳送到您電子郵件的 6 位驗證碼',
  'login.error.emailRequired': '請先輸入您的電子郵件地址',

  'lobby.notSignedIn': '未登入',
  'lobby.signOut': '登出',
  'lobby.checkin': '簽到',
  'lobby.inventory': '背包',
  'lobby.page.menu': '主選單',
  'lobby.page.play': '開始遊戲',
  'lobby.changeRoomCode': '更換房間碼',
  'lobby.createRoom': '建立房間',
  'lobby.backToLobby': '返回大廳',
  'inventory.title': '背包',
  'inventory.cards': '卡牌',
  'inventory.chests': '卡包',
  'inventory.open': '開啟',
  'inventory.empty': '背包是空的',
  'replay.session': '對戰資訊',
  'replay.play': '播放',
  'replay.pause': '暫停',
  'replay.restart': '重播',
  'replay.close': '關閉',
  'lobby.joinRoom': '加入房間',
  'lobby.joinRoomCode': '加入的房間碼',
  'lobby.roomCodeHint': '輸入房主分享的房間碼',
  'lobby.joinQueue': '加入配對佇列',
  'lobby.refreshQueue': '重新整理佇列狀態',
  'lobby.cancelQueue': '取消配對',
  'lobby.profile.ruleset': '規則集 {version}',

  'room.title': '房間',
  'room.noRoom': '尚無房間',
  'room.meta': '{mode} · 規則集 {version}',
  'room.setup.caption': '對局設定 · 僅房主可改',
  'room.setup.summary': 'Boss：{boss} · 自機：{shot} / {bomb}',
  'room.boss': 'Boss',
  'room.shot': '射擊',
  'room.bomb': '炸彈',
  'room.default': '預設',
  'room.boss.default': '預設',
  'room.boss.tian': '天',
  'room.boss.hui': '輝',
  'room.coop.players': '合作 {count} 人',
  'room.players': '玩家',
  'room.waitingForPlayers': '等待玩家加入…',
  'room.ready': '準備',
  'room.startMatch': '開始對局',
  'room.leaveRoom': '離開房間',
  'room.readyWaiting': '已準備 — 等待對局開始…',
  'room.badge.host': '房主',
  'room.badge.offline': '離線',
  'room.badge.ready': '已準備',
  'room.badge.waiting': '等待中',

  'result.title': '對局結果',
  'result.noResult': '尚無結果',
  'result.victory': '勝利！',
  'result.defeat': '失敗',
  'result.badge.victory': '勝利',
  'result.badge.defeat': '失敗',
  'result.yourStats': '你的數據',
  'result.opponent': '對手',
  'result.serverAuthoritative': '伺服器權威',
  'result.clientAuthoritative': '用戶端權威',
  'result.meta': '{source} · {ms}ms 結算',
  'result.row.winner': '勝者',
  'result.row.yourScore': '你的得分',
  'result.row.match': '對局',
  'result.row.opponent': '對手',
  'result.row.score': '得分',
  'result.row.replay': '回放',

  'records.career': '生涯數據',
  'records.recentMatches': '最近對局',
  'records.recentMatchesCount': '最近對局（{count}）',
  'records.loading': '正在載入戰績…',
  'records.noMatches': '尚無對局記錄',
  'records.refresh': '重新整理',
  'records.gold': '金幣',
  'records.tickets': '抽獎券',
  'records.points': '點數',
  'records.season': '賽季',
  'records.matches': '對局數',
  'records.wld': '勝-負-平',
  'records.winRate': '勝率',
  'records.bestScore': '最高分',
  'records.averageScore': '平均分',
  'records.grazeHit': '擦彈 · 命中',
  'records.damageCards': '傷害 · 出牌',
  'records.decksCards': '牌組 · 卡牌',
  'records.unit.seconds': '{seconds}秒',
  'records.unit.points': '{points} 分',
  'records.result.win': '勝利',
  'records.result.loss': '失敗',
  'records.result.draw': '平局',

  'shop.wallet': '錢包',
  'shop.items': '商品',
  'shop.noListings': '尚無商品',
  'shop.buy': '購買',
  'shop.stockUnlimited': '無限',
  'shop.stockCount': '庫存 {count}',
  'shop.meta': '價格 {price} · {stock} · 已購買 {count}',

  'settings.title': '設定',
  'settings.close': '關閉',
  'settings.restoreDefaults': '恢復預設設定',
  'settings.language.heading': '語言',
  'settings.language': '語言',
  'settings.language.hint': '切換後立即生效，並會記住你的選擇。',
  'settings.language.zh-Hans': '简体中文',
  'settings.language.zh-Hant': '繁體中文',
  'settings.language.ja': '日本語',
  'settings.language.en': 'English',
  'settings.applied': '設定已儲存',
  'settings.tab.display': '顯示',
  'settings.tab.keys': '按鍵',
  'settings.tab.audio': '音訊',
  'settings.tab.hud': 'HUD',
  'settings.tab.other': '其他',
  'settings.tab.about': '關於',
  'settings.subtitle.language': '介面語言',
  'settings.subtitle.display': '解析度、特效與訊框率',
  'settings.subtitle.keys': '用戶端全部按鍵綁定',
  'settings.subtitle.audio': '音樂、擦彈、射擊與技能音量',
  'settings.subtitle.hud': '對局中繪製哪些浮層',
  'settings.subtitle.other': '連線模式與模組',
  'settings.subtitle.about': '版權、版本與製作人員',
  'settings.display.sharpening': '銳化',
  'settings.display.sharpening.desc': '在軟體放大後套用的對比度自适应銳化。0% 即普通雙線性放大。',
  'settings.display.upscaler': '放大器',
  'settings.display.upscaler.desc': '後處理放大後端。僅可選擇此版本實際可用的後端，其餘列在下方。',
'settings.display.windowScale': '視窗大小',
'settings.display.windowScale.desc': '以介面設計尺寸（900×1200）的整數倍設定遊戲視窗大小。',
'settings.display.windowScale.auto': '自動',
  'settings.display.effects': '特效',
  'settings.display.effects.desc': '彈幕拖尾、輝光與命中特效。',
  'settings.display.effect.low': '低',
  'settings.display.effect.medium': '中',
  'settings.display.effect.high': '高',
  'settings.display.frameRate': '訊框率上限',
  'settings.display.frameRate.desc': '限制遊戲重繪頻率。對局過程由伺服器權威計算，此設定不會影響模擬。',
  'settings.display.frameCap.uncapped': '不限制',
  'settings.display.showFps': '顯示訊框率',
  'settings.display.showFps.desc': '在對局畫面角落顯示訊框率計數器。',
  'settings.display.note':
    '幀率上限與解析度倍率都會立即生效：前者限制引擎渲染迴圈，後者重設畫布後備儲存。',
  'settings.display.upscaling': '放大',
  'settings.display.unavailable': '{label}（不可用）',
  'settings.display.softwareNote': '這是在瀏覽器中實作的空間近似演算法。它不是 DLSS，也不是 FSR —— 詳見上方說明。',
  'settings.display.unavailableNote': '此版本不可用 —— {details}',
  'settings.network.heading': '網路',
  'settings.network.connection': '連線',
  'settings.network.connection.desc': '用戶端連線哪個大廳伺服器。選擇會立即儲存，並在下次連線時生效。',
  'settings.network.official': '官方',
  'settings.network.lan': '區域網路',
  'settings.network.thirdParty': '第三方',
  'settings.network.lanHost': '區域網路主機',
  'settings.network.lanHost.desc': '區域網路中 Gensoulkyo 伺服器的主機或主機:連接埠。大廳 WebSocket 與對戰中繼路徑由此派生。',
  'settings.network.httpBase': '大廳 HTTP 位址',
  'settings.network.httpBase.desc': '第三方部署的 REST 基礎位址。',
  'settings.network.wsUrl': '大廳 WebSocket 位址',
  'settings.network.relayUrl': '對戰中繼位址',
  'settings.network.officialNote':
    '官方模式使用編譯進此版本的大廳與對戰中繼位址。區域網路模式會從你輸入的主機派生 http://<host>、ws://<host>/ws 與 ws://<host>/relay，因此只需填寫主機。',
  'settings.mods.heading': '模組',
  'settings.mods.workshop': '創意工坊',
  'settings.mods.workshop.desc': '瀏覽並安裝社群模組。預留功能 —— 尚未隨附載入器。',
  'settings.mods.custom': '自訂模組',
  'settings.mods.custom.desc': '從你選擇的資料夾載入模組。',
  'settings.mods.folder': '模組資料夾',
  'settings.mods.note': '模組載入器尚未實作。這些偏好會被儲存，以便未來的載入器遵循；當前不會載入任何內容。',
  'settings.plugins.heading': '外部模組（DLC）',
  'settings.plugins.autoLoad': '自動載入外部模組',
  'settings.plugins.autoLoad.desc': '用戶端啟動時立即載入下方所有模組位址，不再逐一詢問。',
  'settings.plugins.moduleUrls': '模組位址',
  'settings.plugins.moduleUrls.desc': '一個或多個 ES 模組位址，以空格分隔。在此加入之前不會擷取任何內容。',
  'settings.plugins.note1':
    '除非在此輸入位址，否則不會下載任何內容。每個位址必須提供匯出 createUpscaler()（或 upscaler / descriptor / register(registry)）的 ES 模組。以這種方式載入的模組只能註冊外部放大器後端，它無法讓此渲染器支援 DLSS 或 FSR —— 只能為本就支援相應後端的平台提供一個真實後端。',
  'settings.plugins.note2':
    '僅接受 http(s):// 位址和根相對 /path 位址。其他形式 —— file:、data:、裸主機名 —— 會在儲存或匯入前被拒絕。',
  'settings.about.repository': '儲存庫',
  'settings.about.notPublished': '尚未發布',
  'settings.about.open': '開啟',
  'settings.about.heading.product': '產品',
  'settings.about.heading.licences': '授權',
  'settings.about.heading.source': '原始碼',
  'settings.about.heading.credits': '製作人員',
  'settings.about.game': '遊戲',
  'settings.about.version': '版本',
  'settings.about.build': '建置',
  'settings.about.code': '程式碼',
  'settings.about.assets': '素材',
  'settings.about.copyright': '版權',
  'settings.audio.heading.audio': '音訊',
  'settings.audio.heading.music': '音樂',
  'settings.audio.heading.sfx': '音效',
  'settings.audio.muteAll': '全部靜音',
  'settings.audio.muteAll.desc': '靜音所有聲道，但保留下方的混音設定，取消靜音後可精確恢復。',
  'settings.audio.master': '主音量',
  'settings.audio.bgm': 'BGM 音量',
  'settings.audio.graze': '擦彈',
  'settings.audio.graze.desc': '子彈貼近判定點時播放的擦彈提示音。',
  'settings.audio.playerShot': '自機射擊',
  'settings.audio.playerShot.desc': '你自機的射擊音效。',
  'settings.audio.skill': '技能',
  'settings.audio.skill.desc': '炸彈與符卡音效。',
  'settings.audio.noAssetsNote':
    '此版本未隨附音訊檔案。下方的音量設定會被儲存並推送到引擎混音器，但在加入聲音素材之前不會有任何聲音。',
  'settings.hud.heading': '對局 HUD',
  'settings.hud.opponentHud': '對手 HUD',
  'settings.hud.opponentHud.desc': '對手的 Boss 血量面板。',
  'settings.hud.damageNumbers': '傷害數字',
  'settings.hud.damageNumbers.desc': '在 Boss 身上飄出的傷害數值。',
  'settings.hud.scoreCard': '分數卡',
  'settings.hud.scoreCard.desc': '你的分數與連擊讀數。',
  'settings.hud.ultMeter': '符力槽',
  'settings.hud.ultMeter.desc': '炸彈與符卡的蓄力槽。',
  'settings.hud.statusCard': '狀態卡',
  'settings.hud.statusCard.desc': '主讀數條：血量、殘機與子彈數。',
  'settings.hud.bulletCount': '子彈數',
  'settings.hud.bulletCount.desc': '狀態卡中的 BULLETS 行。',
  'settings.hud.countdown': '倒數計時',
  'settings.hud.countdown.desc': '對局剩餘時間。',
  'settings.hud.networkFooter': '網路頁尾',
  'settings.hud.networkFooter.desc': '沿底邊顯示的延遲與同步讀數。',
  'settings.hud.note':
    '隱藏的區塊會重新排版而非留下空隙，因此 HUD 保持緊湊。傷害數字與符力槽浮層仍在製作中：這兩個開關會先儲存，待對應浮層上線後生效。',
  'settings.keys.intro':
    '此列表由排程器實際比對的唯一綁定表產生，因此永遠不會與程式碼不一致。文字輸入欄聚焦時仍然有效的按鍵會在末尾的說明中標註。',
  'settings.keys.textInputNote':
    '文字輸入欄聚焦時，僅觸發標記為 allowInTextInput 的綁定 —— Tab、Shift+Tab、Enter、Escape、Alt+Enter、Ctrl+Tab。',
  'settings.keys.scope.global': '全域',
  'settings.keys.scope.login': '登入',
  'settings.keys.scope.lobby': '大廳',
  'settings.keys.scope.room': '房間',
  'settings.keys.scope.battle': '對局',
  'settings.keys.scope.result': '結算',
  'settings.keys.scope.checkin': '簽到',
  'settings.keys.scope.shop': '商店',
  'settings.keys.scope.inventory': '背包',
  'settings.keys.scope.records': '戰績',
  'settings.keys.scope.settings': '設定',
  'checkin.title': '簽到',
  'checkin.cycle': '本期',
  'checkin.claim': '領取',
  'checkin.locked': '未解鎖',
  'checkin.claimed': '已領取',
  'checkin.loading': '正在載入簽到…',
  'checkin.streak': '{days} 天連續簽到 · {cycle}',
  'checkin.day': '第 {day} 天',

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
  'error.match_state_invalid': '對局的狀態不允許此操作。',
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
  'gacha.title': '尋覓 · 抽卡',
  'gacha.pools': '卡池',
  'gacha.pool.cards': '卡牌池',
  'gacha.pool.characters': '角色池',
  'gacha.wallet': '輝玉 {gems} · 信仰 {faith} · 卡塵 {dust}',
  'gacha.kind.cards': '20 張卡牌',
  'gacha.kind.characters': '52 個自機 · A1/A2/B1/B2',
  'gacha.odds': '{kind} · {odds}',
  'gacha.costLine': '單抽 {single} / 十連 {ten}',
  'gacha.pity': '保底：{rare} 抽內必出 SSR+ · {epic} 抽內必出 UR · 十連必出 SSR+',
  'gacha.lastPull': '本次結果',
  'gacha.noPulls': '還沒有抽過 —— 結果全部由伺服器判定',
  'gacha.roster': '名冊 · 信仰兌換',
  'gacha.rosterLine': '已擁有 {owned}/52 · 信仰 {faith} · 兌換需 {cost}',
  'gacha.exchangePick': '信仰兌換 —— 選一個未解鎖自機（{cost} 信仰）',
  'gacha.exchangeNeed': '信仰不足：需要 {cost}，目前 {faith}（每抽 +1）',
  'gacha.allUnlocked': '52 個自機已全部解鎖',
  'gacha.pullSingle': '單抽 · {cost}',
  'gacha.pullTen': '十連 · {cost}',
  'gacha.back': '返回大廳',
  'gacha.result.new': '[{rarity}] {name} —— 新獲得',
  'gacha.result.dupeFaith': '[{rarity}] {name} —— 重複 → +{faith} 信仰',
  'gacha.result.dupeDust': '[{rarity}] {name} —— 重複 → +{dust} 卡塵',
  'screen.gacha.cards': '卡牌池',
  'screen.gacha.characters': '角色池',
  'ui.shop': '商店',
  'ui.settings': '設定',
  'ui.back': '返回',
  'ui.gift': '送禮',
  'ui.deck': '牌組',
  'ui.rank': '段位',
  'ui.queue': '排隊',
  'ui.mail': '郵件',
  'ui.opponent': '對手',
  'ui.roomCode': '房間碼',
  'ui.backToLobby': '返回大廳',
  'ui.downloadDem': '下載 .dem',
  'ui.matchLabel': '對局 {id}',

  // --- lobby flow status -----------------------------------------------------
  'flow.notConnected': '未連線',
  'flow.signingIn': '正在登入…',
  'flow.loadingProfile': '正在載入資料…',
  'flow.signedInAs': '已登入：{name}',
  'flow.signInFailed': '登入失敗',
  'flow.loginFailed': '登入失敗：{reason}',
  'flow.bootstrapFailed': '初始化失敗：{reason}',
  'flow.enterEmailPassword': '請輸入電子郵件和密碼',
  'flow.enterEmail': '請輸入電子郵件地址',
  'flow.enterUsernameEmailPassword': '請輸入使用者名稱、電子郵件和密碼',
  'flow.sendingCode': '正在傳送驗證碼…',
  'flow.codeSent': '驗證碼已傳送至 {email}',
  'flow.codeSendFailed': '驗證碼傳送失敗',
  'flow.creatingAccount': '正在建立帳號…',
  'flow.accountCreated': '帳號已建立 —— 已登入：{name}',
  'flow.signUpFailed': '註冊失敗',
  'flow.signedOut': '已登出',
  'flow.creatingRoom': '正在建立房間 {code}…',
  'flow.createRoomFailed': '建立房間失敗：{reason}',
  'flow.joiningRoom': '正在加入房間 {code}…',
  'flow.joinRoomFailed': '加入房間失敗：{reason}',
  'flow.roomStatus': '房間 {code}：{count} 人',
  'flow.matchStarting': '對局 {id} 即將開始',
  'flow.matchResult': '勝者：{winner}',
  'flow.transportClosed': '大廳連線已關閉：{reason}',
  'flow.queueIdle': '配對佇列：空閒',
  'flow.queueStatus': '配對佇列：{status}',
  'flow.room.left': '已離開房間',
  'flow.room.noRoom': '沒有可重新設定的房間',
  'flow.room.bossLocked': '只有獨自在房間時才能更換 Boss / 配裝',
  'flow.room.reconfiguring': '正在重新設定房間…',
  'flow.room.reconfigureFailed': '重新設定房間失敗：{error}',
  'flow.room.ready': '房間 {code} 已就緒',
  'flow.queue.joining': '正在加入匹配隊列…',
  'flow.queue.joinFailed': '加入匹配隊列失敗：{error}',
  'flow.queue.queued': '排隊中 {id}（{status}）',
  'flow.queue.notQueued': '目前不在匹配隊列中',
  'flow.queue.pollFailed': '刷新隊列狀態失敗：{error}',
  'flow.queue.status': '隊列 {id}：{status}{suffix}',
  'flow.queue.cancelFailed': '取消匹配隊列失敗：{error}',
  'flow.queue.left': '已離開匹配隊列',
  'flow.match.readyWaitingMatch': '已準備 — 等待匹配…',
  'flow.match.readyWaitingPlayers': '已準備 — 等待玩家…',
  'flow.match.readyFailed': '準備失敗：{error}',
  'flow.match.backInLobby': '已返回大廳',
  'flow.match.noMatchToAbandon': '沒有可放棄的對局',
  'flow.match.leaving': '正在離開對局…',
  'flow.match.abandonFailed': '放棄對局失敗：{error}',
  'flow.match.abandoned': '已放棄對局 {id}',
  'flow.match.info': '對局 {id}',
  'flow.match.winner': '勝者：{id}',
  'flow.checkin.loading': '正在載入簽到…',
  'flow.checkin.loadFailed': '載入簽到失敗：{error}',
  'flow.checkin.streak': '簽到：連續 {streak} 天',
  'flow.checkin.claimFailed': '領取簽到獎勵失敗：{error}',
  'flow.checkin.claimed': '已領取第 {day} 天 · 連續 {streak} 天',
  'flow.shop.loading': '正在載入商店…',
  'flow.shop.loadFailed': '載入商店失敗：{error}',
  'flow.shop.summary': '商店：{count} 件商品',
  'flow.shop.purchaseFailed': '購買失敗：{error}',
  'flow.shop.bought': '已購買 {count}× {item}',
  'flow.gacha.loading': '正在載入抽卡…',
  'flow.gacha.loadFailed': '載入抽卡池失敗：{error}',
  'flow.gacha.rosterFailed': '載入角色列表失敗：{error}',
  'flow.gacha.pullFailed': '抽卡失敗：{error}',
  'flow.gacha.pulledOne': '抽到 1× {pool}',
  'flow.gacha.pulledMany': '抽到 {count}× {pool}',
  'flow.gacha.exchangeFailed': '兌換失敗：{error}',
  'flow.gacha.unlocked': '已用 {faith} 信仰解鎖 {item}',
  'flow.inventory.loading': '正在載入背包…',
  'flow.inventory.loadFailed': '載入背包失敗：{error}',
  'flow.inventory.summary': '背包：{count} 組物品',
  'flow.records.loading': '正在載入記錄…',
  'flow.records.loadFailed': '載入記錄失敗：{error}',
  'flow.records.summary': '記錄：{wins} 勝 {losses} 負 {draws} 平',

  // --- auth error codes ------------------------------------------------------
  'auth.unauthorized': '電子郵件或密碼錯誤',
  'auth.accountExists': '該帳號已註冊',
  'auth.usernameRequired': '請輸入使用者名稱',
  'auth.emailRequired': '請輸入電子郵件地址',
  'auth.passwordRequired': '請輸入密碼',
  'auth.usernameInvalid': '使用者名稱須為 3-24 位字母、數字或底線',
  'auth.emailInvalid': '該電子郵件地址無效',
  'auth.passwordWeak': '密碼至少需要 8 個字元',
  'auth.usernameTaken': '該使用者名稱已被占用',
  'auth.emailTaken': '該電子郵件已註冊 —— 請直接登入',
  'auth.emailNotVerified': '請先驗證電子郵件再登入',
  'auth.codeRequired': '請輸入我們傳送到電子郵件的 6 位驗證碼',
  'auth.codeInvalid': '驗證碼不正確',
  'auth.codeExpired': '驗證碼已過期 —— 請重新取得',
  'auth.nakamaEmailCodeUnsupported': '目前的登入方式不支援電子郵件驗證碼 —— 請用使用者名稱與密碼登入',
  'auth.nakamaAuthenticateFailed': '登入服務拒絕了這次登入 —— 請稍後重試',
  'auth.codeRateLimited': '請稍候再請求新的驗證碼',
  'auth.mailUnavailable': '大廳暫時無法傳送郵件 —— 請稍後重試',
  'auth.accountsUnavailable': '帳號服務暫不可用 —— 請稍後重試',
  'auth.invalidRequest': '使用者名稱須為 3-24 位字母、數字或底線，密碼至少 8 個字元',
  'auth.storageUnavailable': '大廳暫時無法連線資料庫 —— 請稍後重試',
  'auth.loginMissingSession': '大廳已接受登入，但未傳回工作階段',
  'auth.transportError': '無法連線大廳 —— 請確認服務正在執行',
  'auth.sessionReplaced': '該帳號已在其他裝置登入',
  'auth.sessionExpired': '登入已過期，請重新登入',
  'shortcuts.app.fullscreen': '全画面切り替え',
  'shortcuts.app.settings': '設定を開く',
  'shortcuts.app.settingsClose': '設定を閉じる / 戻る',
  'shortcuts.battle.back': 'ロビーに戻る',
  'shortcuts.battle.forfeit': '投了して戻る',
  'shortcuts.battle.pause': '一時停止 / 再開',
  'shortcuts.battle.toggleHud': 'HUD 表示切り替え',
  'shortcuts.gacha.nextPool': '次のプール',
  'shortcuts.gacha.prevPool': '前のプール',
  'shortcuts.gacha.pullOne': '単発ガチャ',
  'shortcuts.lobby.activate': '選択項目を決定',
  'shortcuts.lobby.menuNext': '次のメニュー項目',
  'shortcuts.lobby.menuPrev': '前のメニュー項目',
  'shortcuts.lobby.playPage': 'プレイ画面を開く',
  'shortcuts.login.back': 'メインメニューに戻る',
  'shortcuts.login.focusNext': '次の入力欄',
  'shortcuts.login.focusPrev': '前の入力欄',
  'shortcuts.login.sendCode': '認証コードを送信',
  'shortcuts.login.submit': 'ログイン / アカウント作成',
  'shortcuts.login.toggleMode': 'ログイン / 登録を切り替え',
  'shortcuts.room.leave': 'ルームを退出',
  'shortcuts.room.ready': '準備 / 開始',
  'shortcuts.settings.reset': 'すべての設定を初期化',
  'shortcuts.settings.scrollBottom': '最下部へスクロール',
  'shortcuts.settings.scrollDown': '1ページ下へスクロール',
  'shortcuts.settings.scrollTop': '最上部へスクロール',
  'shortcuts.settings.scrollUp': '1ページ上へスクロール',
  'shortcuts.settings.tabNext': '次のタブ',
  'shortcuts.settings.tabPrev': '前のタブ',
  'shortcuts.shop.buy': '購入',
  'shortcuts.ui.back': '戻る',
  'shortcuts.ui.confirm': '確定',
  'shortcuts.ui.continue': '続ける',
  'shortcuts.ui.next': '次へ',
  'shortcuts.ui.prev': '前へ',
  'shortcuts.ui.use': '使う',

};

const JA: Messages = {
  'app.title': '紛争幻想',
  'app.subtitle': 'Phantasm Klash',

  'login.title': 'ログイン',
  'login.username': 'ユーザー名',
  'login.email': 'メールアドレス',
  'login.password': 'パスワード',
  'login.confirmPassword': 'パスワード確認',
  'login.emailCode': 'メール認証コード',
  'login.notConnected': '未接続',
  'login.signingIn': 'ログイン中…',
  'login.creatingAccount': 'アカウント作成中…',
  'login.signUpAndPlay': '登録してプレイ',
  'login.backToSignIn': 'ログインに戻る',
  'login.sendCode': 'コードを送信',
  'login.resendCode': '再送 {seconds}s',
  'login.connecting': '接続中…',
  'login.lobbyEndpoint': 'ロビー：{endpoint}',
  'login.failed': 'ログインに失敗しました',
  'login.transportError': 'サーバーに接続できません。通信環境を確認して再試行してください。',
  'login.error.username': 'ユーザー名を入力してください',
  'login.error.passwordMismatch': 'パスワードが一致しません',
  'login.error.codeRequired': 'メールに送信した 6 桁のコードを入力してください',
  'login.error.emailRequired': 'まずメールアドレスを入力してください',

  'lobby.notSignedIn': '未ログイン',
  'lobby.signOut': 'ログアウト',
  'lobby.checkin': 'デイリーログイン',
  'lobby.inventory': '所持品',
  'lobby.page.menu': 'メインメニュー',
  'lobby.page.play': 'プレイ',
  'lobby.changeRoomCode': 'ルームコードを変更',
  'lobby.createRoom': 'ルームを作成',
  'lobby.backToLobby': 'ロビーに戻る',
  'inventory.title': '持ち物',
  'inventory.cards': 'カード',
  'inventory.chests': 'パック',
  'inventory.open': '開ける',
  'inventory.empty': '持ち物は空です',
  'replay.session': '対戦情報',
  'replay.play': '再生',
  'replay.pause': '一時停止',
  'replay.restart': '最初から',
  'replay.close': '閉じる',
  'lobby.joinRoom': 'ルームに参加',
  'lobby.joinRoomCode': '参加するルームコード',
  'lobby.roomCodeHint': 'ホストが共有したルームコードを入力',
  'lobby.joinQueue': 'マッチメイキング列に参加',
  'lobby.refreshQueue': '順番待ちの状態を更新',
  'lobby.cancelQueue': 'マッチメイキングを中止',
  'lobby.profile.ruleset': 'ルールセット {version}',

  'room.title': 'ルーム',
  'room.noRoom': 'ルームなし',
  'room.meta': '{mode} · ルールセット {version}',
  'room.setup.caption': '対局設定 · ホストのみ変更可',
  'room.setup.summary': 'Boss：{boss} · ショット：{shot} / {bomb}',
  'room.boss': 'ボス',
  'room.shot': 'ショット',
  'room.bomb': 'ボム',
  'room.default': 'デフォルト',
  'room.boss.default': 'デフォルト',
  'room.boss.tian': '天',
  'room.boss.hui': '輝',
  'room.coop.players': '協力 {count} 人',
  'room.players': 'プレイヤー',
  'room.waitingForPlayers': 'プレイヤーを待っています…',
  'room.ready': '準備',
  'room.startMatch': '対局開始',
  'room.leaveRoom': 'ルームを退出',
  'room.readyWaiting': '準備完了 — 対局開始を待っています…',
  'room.badge.host': 'ホスト',
  'room.badge.offline': 'オフライン',
  'room.badge.ready': '準備完了',
  'room.badge.waiting': '待機中',

  'result.title': '対局結果',
  'result.noResult': '結果なし',
  'result.victory': '勝利！',
  'result.defeat': '敗北',
  'result.badge.victory': '勝利',
  'result.badge.defeat': '敗北',
  'result.yourStats': 'あなたの成績',
  'result.opponent': '相手',
  'result.serverAuthoritative': 'サーバー権威',
  'result.clientAuthoritative': 'クライアント権威',
  'result.meta': '{source} · {ms}ms で確定',
  'result.row.winner': '勝者',
  'result.row.yourScore': 'あなたのスコア',
  'result.row.match': '対局',
  'result.row.opponent': '相手',
  'result.row.score': 'スコア',
  'result.row.replay': 'リプレイ',

  'records.career': 'キャリア',
  'records.recentMatches': '最近の対局',
  'records.recentMatchesCount': '最近の対局（{count}）',
  'records.loading': '戦績を読み込み中…',
  'records.noMatches': '対局記録なし',
  'records.refresh': '更新',
  'records.gold': 'ゴールド',
  'records.tickets': 'チケット',
  'records.points': 'ポイント',
  'records.season': 'シーズン',
  'records.matches': '対局数',
  'records.wld': '勝-敗-分',
  'records.winRate': '勝率',
  'records.bestScore': '最高スコア',
  'records.averageScore': '平均スコア',
  'records.grazeHit': 'グレイズ · 命中',
  'records.damageCards': 'ダメージ · カード',
  'records.decksCards': 'デッキ · カード',
  'records.unit.seconds': '{seconds}秒',
  'records.unit.points': '{points} pt',
  'records.result.win': '勝利',
  'records.result.loss': '敗北',
  'records.result.draw': '引き分け',

  'shop.wallet': 'ウォレット',
  'shop.items': 'アイテム',
  'shop.noListings': '商品なし',
  'shop.buy': '購入',
  'shop.stockUnlimited': '無制限',
  'shop.stockCount': '在庫 {count}',
  'shop.meta': '価格 {price} · {stock} · 購入済み {count}',

  'settings.title': '設定',
  'settings.close': '閉じる',
  'settings.language.heading': '言語',
  'settings.restoreDefaults': '設定を復元',
  'settings.language': '言語',
  'settings.language.hint': '切り替えるとすぐに反映され、選択内容は保存されます。',
  'settings.language.zh-Hans': '简体中文',
  'settings.language.zh-Hant': '繁體中文',
  'settings.language.ja': '日本語',
  'settings.language.en': 'English',
  'settings.applied': '設定を保存しました',
  'settings.tab.display': '表示',
  'settings.tab.keys': 'キー',
  'settings.tab.audio': 'オーディオ',
  'settings.tab.hud': 'HUD',
  'settings.tab.other': 'その他',
  'settings.tab.about': 'このゲームについて',
  'settings.subtitle.language': 'インターフェース言語',
  'settings.subtitle.display': '解像度・エフェクト・フレームレート',
  'settings.subtitle.keys': 'クライアントの全キー割り当て',
  'settings.subtitle.audio': '音楽・グレイズ・ショット・スキルの音量',
  'settings.subtitle.hud': '対局中に描画するオーバーレイ',
  'settings.subtitle.other': '接続モードとモッド',
  'settings.subtitle.about': '著作権・バージョン・クレジット',
  'settings.display.sharpening': 'シャープニング',
  'settings.display.sharpening.desc': 'ソフトウェアアップスケール後に適用するコントラスト適応シャープニング。0% は通常のバイリニア拡大です。',
  'settings.display.upscaler': 'アップスケーラー',
  'settings.display.upscaler.desc': 'ポストプロセス後のアップスケーリング基盤。このビルドで実際に動作するものだけが選択でき、それ以外は下に表示されます。',
'settings.display.windowScale': 'ウィンドウサイズ',
'settings.display.windowScale.desc': 'デザイン寸法（900×1200）の整数倍でウィンドウサイズを設定します。',
'settings.display.windowScale.auto': '自動',
  'settings.display.effects': 'エフェクト',
  'settings.display.effects.desc': '弾の軌跡、輝き、命中エフェクト。',
  'settings.display.effect.low': '低',
  'settings.display.effect.medium': '中',
  'settings.display.effect.high': '高',
  'settings.display.frameRate': 'フレームレート上限',
  'settings.display.frameRate.desc': 'ゲームの再描画頻度を制限します。対局はサーバー権威なので、シミュレーションには影響しません。',
  'settings.display.frameCap.uncapped': '無制限',
  'settings.display.showFps': 'フレームレートを表示',
  'settings.display.showFps.desc': '対局画面の隅にフレームレートカウンターを表示します。',
  'settings.display.note':
    'フレームレート上限はエンジンの描画ループを制限してすぐに反映されます。解像度スケールはキャンバスのバッキングストアに適用されるため、次回のウィンドウリサイズまたは再起動後に初めて目に見える効果が現れます。',
  'settings.display.upscaling': 'アップスケーリング',
  'settings.display.unavailable': '{label}（利用不可）',
  'settings.display.softwareNote': 'これはブラウザ内で実装された空間近似です。DLSS でも FSR でもありません — 上の注釈を参照してください。',
  'settings.display.unavailableNote': 'このビルドでは利用できません — {details}',
  'settings.network.heading': 'ネットワーク',
  'settings.network.connection': '接続',
  'settings.network.connection.desc': 'クライアントが接続するロビーサーバー。選択はすぐに保存され、次回の接続時に使用されます。',
  'settings.network.official': '公式',
  'settings.network.lan': 'LAN',
  'settings.network.thirdParty': 'サードパーティ',
  'settings.network.lanHost': 'LAN ホスト',
  'settings.network.lanHost.desc': 'ローカルネットワーク上の Gensoulkyo サーバーのホストまたは ホスト:ポート。ロビー WebSocket と対戦リレーのパスはここから導出されます。',
  'settings.network.httpBase': 'ロビー HTTP ベース',
  'settings.network.httpBase.desc': 'サードパーティ配置の REST ベースURL。',
  'settings.network.wsUrl': 'ロビー WebSocket URL',
  'settings.network.relayUrl': '対戦リレー URL',
  'settings.network.officialNote':
    '公式モードはこのビルドにコンパイルされたロビーと対戦リレーのエンドポイントを使用します。LAN モードは入力したホストから http://<host>、ws://<host>/ws、ws://<host>/relay を導出するため、ホストだけで構いません。',
  'settings.mods.heading': 'モッド',
  'settings.mods.workshop': 'ワークショップ',
  'settings.mods.workshop.desc': 'コミュニティのモッドを閲覧・導入します。予約済み — ローダーは未同梱です。',
  'settings.mods.custom': 'カスタムモッド',
  'settings.mods.custom.desc': '選んだフォルダーからモッドを読み込みます。',
  'settings.mods.folder': 'モッドフォルダー',
  'settings.mods.note': 'モッドローダーは未実装です。これらの設定は将来のローダーが尊重できるよう保存されますが、現在は何も読み込まれません。',
  'settings.plugins.heading': '外部モジュール（DLC）',
  'settings.plugins.autoLoad': '外部モジュールを自動読み込み',
  'settings.plugins.autoLoad.desc': 'クライアント起動時に、モジュールごとに確認せず下のすべてのモジュールURLを読み込みます。',
  'settings.plugins.moduleUrls': 'モジュールURL',
  'settings.plugins.moduleUrls.desc': 'ES モジュールのURLをスペース区切りで指定します。ここに追加するまでは何も取得されません。',
  'settings.plugins.note1':
    'ここにURLが入力されない限り、何もダウンロードされません。各URLは createUpscaler()（または upscaler / descriptor / register(registry)）をエクスポートする ES モジュールを配信する必要があります。この方法で読み込まれるモジュールができるのは外部アップスケーラー後端の登録だけで、このレンダラーで DLSS や FSR を可能にすることはできません — 元から対応するプラットフォームに本物の後端を提供できるだけです。',
  'settings.plugins.note2':
    '受理されるのは http(s):// URL とルート相対 /path URL だけです。それ以外 — file:、data:、ホスト名のみ — は保存・インポート前に拒否されます。',
  'settings.about.repository': 'リポジトリ',
  'settings.about.notPublished': '未公開',
  'settings.about.open': '開く',
  'settings.about.heading.product': '製品',
  'settings.about.heading.licences': 'ライセンス',
  'settings.about.heading.source': 'ソース',
  'settings.about.heading.credits': 'クレジット',
  'settings.about.game': 'ゲーム',
  'settings.about.version': 'バージョン',
  'settings.about.build': 'ビルド',
  'settings.about.code': 'コード',
  'settings.about.assets': 'アセット',
  'settings.about.copyright': '著作権',
  'settings.audio.heading.audio': 'オーディオ',
  'settings.audio.heading.music': '音楽',
  'settings.audio.heading.sfx': '効果音',
  'settings.audio.muteAll': 'すべてミュート',
  'settings.audio.muteAll.desc': 'すべてのチャンネルをミュートしますが、下のミックスは失われないため、解除すると正確に元に戻ります。',
  'settings.audio.master': 'マスター音量',
  'settings.audio.bgm': 'BGM 音量',
  'settings.audio.graze': 'グレイズ',
  'settings.audio.graze.desc': '弾が当たり判定の近くを通ったときのグレイズ音。',
  'settings.audio.playerShot': '自機ショット',
  'settings.audio.playerShot.desc': '自機のショット音。',
  'settings.audio.skill': 'スペル',
  'settings.audio.skill.desc': 'ボムとスペルカード。',
  'settings.audio.noAssetsNote':
    'このビルドには音声ファイルが同梱されていません。下のレベルは保存されてエンジンのミキサーに送られますが、サウンドアセットが追加されるまで音は鳴りません。',
  'settings.hud.heading': '対局 HUD',
  'settings.hud.opponentHud': '相手 HUD',
  'settings.hud.opponentHud.desc': '相手のボス HP パネル。',
  'settings.hud.damageNumbers': 'ダメージ数値',
  'settings.hud.damageNumbers.desc': 'ボスの上に浮かぶダメージ数値。',
  'settings.hud.scoreCard': 'スコアカード',
  'settings.hud.scoreCard.desc': 'スコアとコンボの表示。',
  'settings.hud.ultMeter': '必殺技メーター',
  'settings.hud.ultMeter.desc': 'ボムとスペルカードのチャージメーター。',
  'settings.hud.statusCard': 'ステータスカード',
  'settings.hud.statusCard.desc': 'メインの表示帯：HP、残機、弾数。',
  'settings.hud.bulletCount': '弾数',
  'settings.hud.bulletCount.desc': 'ステータスカード内の BULLETS 行。',
  'settings.hud.countdown': 'カウントダウン',
  'settings.hud.countdown.desc': '対局の残り時間。',
  'settings.hud.networkFooter': 'ネットワークフッター',
  'settings.hud.networkFooter.desc': '下端に沿って表示される Ping と調整の読み値。',
  'settings.hud.note':
    '非表示にしたブロックは隙間を空けずに再配置されるため、HUD はコンパクトなままです。ダメージ数値と必殺技メーターのオーバーレイは現在も構築中です：これら 2 つのスイッチはすぐに保存され、それぞれのオーバーレイができ次第有効になります。',
  'settings.keys.intro':
    'この一覧は、ディスパッチャーが照合する単一の binding テーブルから生成されるため、コードと乖離しません。テキスト欄にフォーカスがある間も有効なキーは、最後の注釈に示されます。',
  'settings.keys.textInputNote':
    'テキスト欄にフォーカスがある間発動するのは allowInTextInput とマークされた绑定だけです — Tab、Shift+Tab、Enter、Escape、Alt+Enter、Ctrl+Tab。',
  'settings.keys.scope.global': 'グローバル',
  'settings.keys.scope.login': 'ログイン',
  'settings.keys.scope.lobby': 'ロビー',
  'settings.keys.scope.room': 'ルーム',
  'settings.keys.scope.battle': '対局',
  'settings.keys.scope.result': 'リザルト',
  'settings.keys.scope.checkin': 'デイリーログイン',
  'settings.keys.scope.shop': '商店',
  'settings.keys.scope.inventory': '所持品',
  'settings.keys.scope.records': '戦績',
  'settings.keys.scope.settings': '設定',
  'checkin.title': 'デイリーログイン',
  'checkin.cycle': '今回の期間',
  'checkin.claim': '受け取る',
  'checkin.locked': '未解放',
  'checkin.claimed': '受取済み',
  'checkin.loading': 'ログイン報酬を読み込み中…',
  'checkin.streak': '{days} 日連続 · {cycle}',
  'checkin.day': '{day} 日目',

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
  'gacha.title': '探訪 · ガチャ',
  'gacha.pools': 'カードプール',
  'gacha.pool.cards': 'カード',
  'gacha.pool.characters': 'キャラクター',
  'gacha.wallet': '輝玉 {gems} · 信仰 {faith} · ダスト {dust}',
  'gacha.kind.cards': '20 枚のカード',
  'gacha.kind.characters': '52 体の自機 · A1/A2/B1/B2',
  'gacha.odds': '{kind} · {odds}',
  'gacha.costLine': '1 回 {single} / 10 連 {ten}',
  'gacha.pity': '天井：SSR+ は {rare} 回以内 · UR は {epic} 回以内 · 10 連は SSR+ 確定',
  'gacha.lastPull': '今回の結果',
  'gacha.noPulls': 'まだ引いていません — 結果はすべてサーバーが決定します',
  'gacha.roster': '名簿 · 信仰交換',
  'gacha.rosterLine': '所持 {owned}/52 · 信仰 {faith} · 交換に {cost}',
  'gacha.exchangePick': '信仰交換 — 未解放の自機を選択（{cost} 信仰）',
  'gacha.exchangeNeed': '信仰不足：必要 {cost}、現在 {faith}（1 回ごとに +1）',
  'gacha.allUnlocked': '52 体すべて解放済み',
  'gacha.pullSingle': '1 回 · {cost}',
  'gacha.pullTen': '10 連 · {cost}',
  'gacha.back': 'ロビーに戻る',
  'gacha.result.new': '[{rarity}] {name} — 新規',
  'gacha.result.dupeFaith': '[{rarity}] {name} — 重複 → +{faith} 信仰',
  'gacha.result.dupeDust': '[{rarity}] {name} — 重複 → +{dust} ダスト',
  'screen.gacha.cards': 'カード',
  'screen.gacha.characters': 'キャラクター',
  'ui.shop': '商店',
  'ui.settings': '設定',
  'ui.back': '戻る',
  'ui.gift': '贈り物',
  'ui.deck': 'デッキ',
  'ui.rank': 'ランク',
  'ui.queue': '順番待ち',
  'ui.mail': 'メール',
  'ui.opponent': '相手',
  'ui.roomCode': 'ルームコード',
  'ui.backToLobby': 'ロビーに戻る',
  'ui.downloadDem': '.dem をダウンロード',
  'ui.matchLabel': '対局 {id}',

  // --- lobby flow status -----------------------------------------------------
  'flow.notConnected': '未接続',
  'flow.signingIn': 'ログイン中…',
  'flow.loadingProfile': 'プロフィールを読み込み中…',
  'flow.signedInAs': 'ログイン済み：{name}',
  'flow.signInFailed': 'ログインに失敗しました',
  'flow.loginFailed': 'ログインに失敗しました：{reason}',
  'flow.bootstrapFailed': '初期化に失敗しました：{reason}',
  'flow.enterEmailPassword': 'メールアドレスとパスワードを入力してください',
  'flow.enterEmail': 'メールアドレスを入力してください',
  'flow.enterUsernameEmailPassword': 'ユーザー名・メールアドレス・パスワードを入力してください',
  'flow.sendingCode': '確認コードを送信中…',
  'flow.codeSent': '確認コードを {email} に送信しました',
  'flow.codeSendFailed': '確認コードの送信に失敗しました',
  'flow.creatingAccount': 'アカウントを作成中…',
  'flow.accountCreated': 'アカウントを作成しました —— ログイン済み：{name}',
  'flow.signUpFailed': '登録に失敗しました',
  'flow.signedOut': 'ログアウトしました',
  'flow.creatingRoom': 'ルーム {code} を作成中…',
  'flow.createRoomFailed': 'ルームの作成に失敗しました：{reason}',
  'flow.joiningRoom': 'ルーム {code} に参加中…',
  'flow.joinRoomFailed': 'ルームへの参加に失敗しました：{reason}',
  'flow.roomStatus': 'ルーム {code}：{count} 人',
  'flow.matchStarting': '対局 {id} まもなく開始',
  'flow.matchResult': '勝者：{winner}',
  'flow.transportClosed': 'ロビー接続が切断されました：{reason}',
  'flow.queueIdle': 'マッチングキュー：待機中',
  'flow.queueStatus': 'マッチングキュー：{status}',
  'flow.room.left': 'ルームを退出しました',
  'flow.room.noRoom': '再設定できるルームがありません',
  'flow.room.bossLocked': '単独時のみボス・編成を変更できます',
  'flow.room.reconfiguring': 'ルームを再設定中…',
  'flow.room.reconfigureFailed': 'ルーム再設定に失敗しました：{error}',
  'flow.room.ready': 'ルーム {code} の準備ができました',
  'flow.queue.joining': 'マッチングキューに参加中…',
  'flow.queue.joinFailed': 'キュー参加に失敗しました：{error}',
  'flow.queue.queued': 'キュー参加中 {id}（{status}）',
  'flow.queue.notQueued': 'マッチングキューには未参加です',
  'flow.queue.pollFailed': 'キュー状態の取得に失敗しました：{error}',
  'flow.queue.status': 'キュー {id}：{status}{suffix}',
  'flow.queue.cancelFailed': 'キュー取り消しに失敗しました：{error}',
  'flow.queue.left': 'キューから退出しました',
  'flow.match.readyWaitingMatch': '準備完了 — マッチング待ち…',
  'flow.match.readyWaitingPlayers': '準備完了 — 参加者待ち…',
  'flow.match.readyFailed': '準備に失敗しました：{error}',
  'flow.match.backInLobby': 'ロビーに戻りました',
  'flow.match.noMatchToAbandon': '放弃できる対戦がありません',
  'flow.match.leaving': '対戦から退出中…',
  'flow.match.abandonFailed': '対戦の放弃に失敗しました：{error}',
  'flow.match.abandoned': '対戦 {id} を放弃しました',
  'flow.match.info': '対戦 {id}',
  'flow.match.winner': '勝者：{id}',
  'flow.checkin.loading': 'デイリーログインを読み込み中…',
  'flow.checkin.loadFailed': 'デイリーログインの読み込みに失敗しました：{error}',
  'flow.checkin.streak': 'デイリーログイン：{streak} 日連続',
  'flow.checkin.claimFailed': 'デイリー報酬の受け取りに失敗しました：{error}',
  'flow.checkin.claimed': '{day} 日目の報酬を受け取りました · {streak} 日連続',
  'flow.shop.loading': 'ショップを読み込み中…',
  'flow.shop.loadFailed': 'ショップの読み込みに失敗しました：{error}',
  'flow.shop.summary': 'ショップ：{count} 件',
  'flow.shop.purchaseFailed': '購入に失敗しました：{error}',
  'flow.shop.bought': '{count}× {item} を購入しました',
  'flow.gacha.loading': 'ガチャを読み込み中…',
  'flow.gacha.loadFailed': 'ガチャプールの読み込みに失敗しました：{error}',
  'flow.gacha.rosterFailed': 'キャラクター一覧の読み込みに失敗しました：{error}',
  'flow.gacha.pullFailed': 'ガチャに失敗しました：{error}',
  'flow.gacha.pulledOne': '1× {pool} を引きました',
  'flow.gacha.pulledMany': '{count}× {pool} を引きました',
  'flow.gacha.exchangeFailed': '交換に失敗しました：{error}',
  'flow.gacha.unlocked': '{faith} の信仰で {item} を解放しました',
  'flow.inventory.loading': 'インベントリを読み込み中…',
  'flow.inventory.loadFailed': 'インベントリの読み込みに失敗しました：{error}',
  'flow.inventory.summary': 'インベントリ：{count} スタック',
  'flow.records.loading': '戦績を読み込み中…',
  'flow.records.loadFailed': '戦績の読み込みに失敗しました：{error}',
  'flow.records.summary': '戦績：{wins}勝 {losses}敗 {draws}分',

  // --- auth error codes ------------------------------------------------------
  'auth.unauthorized': 'メールアドレスまたはパスワードが違います',
  'auth.accountExists': 'このアカウントは登録済みです',
  'auth.usernameRequired': 'ユーザー名を入力してください',
  'auth.emailRequired': 'メールアドレスを入力してください',
  'auth.passwordRequired': 'パスワードを入力してください',
  'auth.usernameInvalid': 'ユーザー名は 3-24 文字の英数字・アンダースコアで入力してください',
  'auth.emailInvalid': 'このメールアドレスは無効です',
  'auth.passwordWeak': 'パスワードは 8 文字以上で入力してください',
  'auth.usernameTaken': 'このユーザー名は使用されています',
  'auth.emailTaken': 'このメールアドレスは登録済みです —— ログインしてください',
  'auth.emailNotVerified': 'ログイン前にメールアドレスを確認してください',
  'auth.codeRequired': 'メールに送信された 6 桁の確認コードを入力してください',
  'auth.nakamaEmailCodeUnsupported': '現在のログイン方法はメール認証コードに対応していません —— ユーザー名とパスワードでログインしてください',
  'auth.nakamaAuthenticateFailed': 'ログインサービスがこのログインを拒否しました —— しばらくしてからお試しください',
  'auth.codeInvalid': '確認コードが正しくありません',
  'auth.codeExpired': '確認コードの有効期限が切れました —— 再取得してください',
  'auth.codeRateLimited': 'しばらく待ってから再度お試しください',
  'auth.mailUnavailable': 'ロビーがメールを送信できません —— しばらくしてからお試しください',
  'auth.accountsUnavailable': 'アカウントサービスが一時的に利用できません —— しばらくしてからお試しください',
  'auth.invalidRequest': 'ユーザー名は 3-24 文字の英数字・アンダースコア、パスワードは 8 文字以上で入力してください',
  'auth.storageUnavailable': 'ロビーがデータベースに接続できません —— しばらくしてからお試しください',
  'auth.loginMissingSession': 'ロビーはログインを受け付けましたが、セッションを返しませんでした',
  'auth.transportError': 'ロビーに接続できません —— サービスが動作しているか確認してください',
  'auth.sessionReplaced': 'このアカウントは他のデバイスでログインしています',
  'auth.sessionExpired': 'ログインの有効期限が切れました。再度ログインしてください',
  'shortcuts.app.fullscreen': 'Toggle fullscreen',
  'shortcuts.app.settings': 'Open settings',
  'shortcuts.app.settingsClose': 'Close settings / go back',
  'shortcuts.battle.back': 'Back to the lobby',
  'shortcuts.battle.forfeit': 'Forfeit and go back',
  'shortcuts.battle.pause': 'Pause / resume',
  'shortcuts.battle.toggleHud': 'Toggle the HUD',
  'shortcuts.gacha.nextPool': 'Next pool',
  'shortcuts.gacha.prevPool': 'Previous pool',
  'shortcuts.gacha.pullOne': 'Pull x1',
  'shortcuts.lobby.activate': 'Activate the highlighted entry',
  'shortcuts.lobby.menuNext': 'Next menu entry',
  'shortcuts.lobby.menuPrev': 'Previous menu entry',
  'shortcuts.lobby.playPage': 'Open the Play page',
  'shortcuts.login.back': 'Back to the main menu',
  'shortcuts.login.focusNext': 'Next field',
  'shortcuts.login.focusPrev': 'Previous field',
  'shortcuts.login.sendCode': 'Send e-mail verification code',
  'shortcuts.login.submit': 'Sign in / create account',
  'shortcuts.login.toggleMode': 'Switch sign-in / register',
  'shortcuts.room.leave': 'Leave the room',
  'shortcuts.room.ready': 'Ready / start',
  'shortcuts.settings.reset': 'Reset every setting',
  'shortcuts.settings.scrollBottom': 'Scroll to the bottom',
  'shortcuts.settings.scrollDown': 'Scroll down a page',
  'shortcuts.settings.scrollTop': 'Scroll to the top',
  'shortcuts.settings.scrollUp': 'Scroll up a page',
  'shortcuts.settings.tabNext': 'Next tab',
  'shortcuts.settings.tabPrev': 'Previous tab',
  'shortcuts.shop.buy': 'Buy',
  'shortcuts.ui.back': 'Back',
  'shortcuts.ui.confirm': 'Confirm',
  'shortcuts.ui.continue': 'Continue',
  'shortcuts.ui.next': 'Next',
  'shortcuts.ui.prev': 'Previous',
  'shortcuts.ui.use': 'Use',

};

const EN: Messages = {
  'app.title': 'Phantasm Klash',
  'app.subtitle': 'Clash of Fantasies',

  'login.title': 'Sign in',
  'login.username': 'Username',
  // The field prompt reads "E-mail" on the login card (kept verbatim — the E2E
  // harness matches the shipped copy), so this key carries that spelling.
  'login.email': 'E-mail',
  'login.password': 'Password',
  'login.confirmPassword': 'Confirm password',
  'login.emailCode': 'E-mail code',
  'login.notConnected': 'Not connected',
  'login.signingIn': 'Signing in…',
  'login.creatingAccount': 'Creating account…',
  'login.signUpAndPlay': 'Sign up & play',
  'login.backToSignIn': 'Back to sign in',
  'login.sendCode': 'Send code',
  'login.resendCode': 'Resend {seconds}s',
  'login.connecting': 'Connecting…',
  'login.lobbyEndpoint': 'Lobby: {endpoint}',
  'login.failed': 'Sign-in failed',
  'login.transportError': 'Cannot reach the server. Check your connection and try again.',
  'login.error.username': 'Enter a username',
  'login.error.passwordMismatch': 'Passwords do not match',
  'login.error.codeRequired': 'Enter the 6-digit code we e-mailed you',
  'login.error.emailRequired': 'Enter your e-mail address first',

  'lobby.notSignedIn': 'Not signed in',
  'lobby.signOut': 'Sign out',
  'lobby.checkin': 'Check-in',
  'lobby.inventory': 'Inventory',
  'lobby.page.menu': 'Main menu',
  'lobby.page.play': 'Play',
  'lobby.changeRoomCode': 'Change room code',
  'lobby.createRoom': 'Create room',
  'lobby.backToLobby': 'Back to lobby',
  'inventory.title': 'Inventory',
  'inventory.cards': 'Cards',
  'inventory.chests': 'Chests',
  'inventory.open': 'Open',
  'inventory.empty': 'Your inventory is empty',
  'replay.session': 'Session',
  'replay.play': 'Play',
  'replay.pause': 'Pause',
  'replay.restart': 'Restart',
  'replay.close': 'Close',
  'lobby.joinRoom': 'Join room',
  'lobby.joinRoomCode': 'Room code to join',
  'lobby.roomCodeHint': 'Type the code the host shared',
  'lobby.joinQueue': 'Join matchmaking queue',
  'lobby.refreshQueue': 'Refresh queue status',
  'lobby.cancelQueue': 'Cancel matchmaking',
  'lobby.profile.ruleset': 'ruleset {version}',

  'room.title': 'Room',
  'room.noRoom': 'No room',
  'room.meta': '{mode} · ruleset {version}',
  'room.setup.caption': 'Match setup · host only',
  'room.setup.summary': 'Boss: {boss} · Shot: {shot} / {bomb}',
  'room.boss': 'Boss',
  'room.shot': 'Shot',
  'room.bomb': 'Bomb',
  'room.default': 'default',
  'room.boss.default': 'Default',
  'room.boss.tian': '天 / tian',
  'room.boss.hui': '辉 / hui',
  'room.coop.players': 'Co-op {count}P',
  'room.players': 'Players',
  'room.waitingForPlayers': 'Waiting for players…',
  'room.ready': 'Ready',
  'room.startMatch': 'Start match',
  'room.leaveRoom': 'Leave room',
  'room.readyWaiting': 'Ready — waiting for match…',
  'room.badge.host': 'HOST',
  'room.badge.offline': 'OFFLINE',
  'room.badge.ready': 'READY',
  'room.badge.waiting': 'WAITING',

  'result.title': 'Match result',
  'result.noResult': 'No result yet',
  'result.victory': 'Victory!',
  'result.defeat': 'Defeat',
  'result.badge.victory': 'VICTORY',
  'result.badge.defeat': 'DEFEAT',
  'result.yourStats': 'Your stats',
  'result.opponent': 'Opponent',
  'result.serverAuthoritative': 'Server authoritative',
  'result.clientAuthoritative': 'Client authoritative',
  'result.meta': '{source} · settled {ms}ms',
  'result.row.winner': 'Winner',
  'result.row.yourScore': 'Your score',
  'result.row.match': 'Match',
  'result.row.opponent': 'Opponent',
  'result.row.score': 'Score',
  'result.row.replay': 'Replay',

  'records.career': 'Career',
  'records.recentMatches': 'Recent matches',
  'records.recentMatchesCount': 'Recent matches ({count})',
  'records.loading': 'Loading records…',
  'records.noMatches': 'No matches yet',
  'records.refresh': 'Refresh',
  'records.gold': 'Gold',
  'records.tickets': 'Tickets',
  'records.points': 'Points',
  'records.season': 'Season',
  'records.matches': 'Matches',
  'records.wld': 'W-L-D',
  'records.winRate': 'Win rate',
  'records.bestScore': 'Best score',
  'records.averageScore': 'Average score',
  'records.grazeHit': 'Graze · Hit',
  'records.damageCards': 'Damage · Cards',
  'records.decksCards': 'Decks · Cards',
  'records.unit.seconds': '{seconds}s',
  'records.unit.points': '{points} pts',
  'records.result.win': 'WIN',
  'records.result.loss': 'LOSS',
  'records.result.draw': 'DRAW',

  'shop.wallet': 'Wallet',
  'shop.items': 'Items',
  'shop.noListings': 'No listings',
  'shop.buy': 'Buy',
  'shop.stockUnlimited': 'unlimited',
  'shop.stockCount': 'stock {count}',
  'shop.meta': 'Price {price} · {stock} · bought {count}',

  'settings.title': 'Settings',
  'settings.language.heading': 'Language',
  'settings.close': 'Close',
  'settings.restoreDefaults': 'Restore defaults',
  'settings.language': 'Language',
  'settings.language.hint': 'Applies immediately, and your choice is remembered.',
  'settings.language.zh-Hans': '简体中文',
  'settings.language.zh-Hant': '繁體中文',
  'settings.language.ja': '日本語',
  'settings.language.en': 'English',
  'settings.applied': 'Settings saved',
  'settings.tab.display': 'Display',
  'settings.tab.keys': 'Keys',
  'settings.tab.audio': 'Audio',
  'settings.tab.hud': 'HUD',
  'settings.tab.other': 'Other',
  'settings.tab.about': 'About',
  'settings.subtitle.language': 'Interface language',
  'settings.subtitle.display': 'Resolution, effects, frame rate',
  'settings.subtitle.keys': 'Every binding the client ships',
  'settings.subtitle.audio': 'Music, graze, shot and skill volumes',
  'settings.subtitle.hud': 'Which battle overlays to draw',
  'settings.subtitle.other': 'Connection mode and mods',
  'settings.subtitle.about': 'Copyright, version, credits',
  'settings.display.sharpening': 'Sharpening',
  'settings.display.sharpening.desc':
    'Contrast-adaptive sharpening applied after the software upscale. 0% is a plain bilinear upscale.',
  'settings.display.upscaler': 'Upscaler',
  'settings.display.upscaler.desc':
    'Post-process upscaling backend. Only backends this build can actually run are selectable; the rest are listed below.',
'settings.display.windowScale': 'Window size',
'settings.display.windowScale.desc': 'Sets the game window to a whole multiple of the design size (900x1200).',
'settings.display.windowScale.auto': 'Auto',
  'settings.display.effects': 'Effects',
  'settings.display.effects.desc': 'Bullet trails, glow and impact effects.',
  'settings.display.effect.low': 'Low',
  'settings.display.effect.medium': 'Medium',
  'settings.display.effect.high': 'High',
  'settings.display.frameRate': 'Frame rate limit',
  'settings.display.frameRate.desc':
    'Caps how often the game redraws. Gameplay stays server-authoritative, so this never changes the simulation.',
  'settings.display.frameCap.uncapped': 'Uncapped',
  'settings.display.showFps': 'Show frame rate',
  'settings.display.showFps.desc': 'Draws a frame-rate counter in the corner of the battle screen.',
  'settings.display.note':
    'The frame-rate limit applies immediately by gating the engine render loop. The resolution scale is applied to the canvas backing store, so it only takes visible effect after the next window resize or a restart.',
  'settings.display.upscaling': 'Upscaling',
  'settings.display.unavailable': '{label} (unavailable)',
  'settings.display.softwareNote':
    'This is a spatial approximation implemented in the browser. It is not DLSS and not FSR — see the notes above.',
  'settings.display.unavailableNote': 'Not available in this build — {details}',
  'settings.network.heading': 'Network',
  'settings.network.connection': 'Connection',
  'settings.network.connection.desc':
    'Which lobby server the client talks to. The choice is stored immediately and used the next time the client connects.',
  'settings.network.official': 'Official',
  'settings.network.lan': 'LAN',
  'settings.network.thirdParty': 'Third-party',
  'settings.network.lanHost': 'LAN host',
  'settings.network.lanHost.desc':
    'Host or host:port of a Gensoulkyo server on your local network. The lobby WebSocket and battle relay paths are derived from it.',
  'settings.network.httpBase': 'Lobby HTTP base',
  'settings.network.httpBase.desc': 'REST base of the third-party deployment.',
  'settings.network.wsUrl': 'Lobby WebSocket URL',
  'settings.network.relayUrl': 'Battle relay URL',
  'settings.network.officialNote':
    'Official uses the lobby and battle relay endpoints compiled into this build. LAN derives http://<host>, ws://<host>/ws and ws://<host>/relay from the host you enter, so only the host is needed.',
  'settings.mods.heading': 'Mods',
  'settings.mods.workshop': 'Creative workshop',
  'settings.mods.workshop.desc': 'Browse and install community mods. Reserved — no loader ships yet.',
  'settings.mods.custom': 'Custom mods',
  'settings.mods.custom.desc': 'Load mods from a folder you choose.',
  'settings.mods.folder': 'Mod folder',
  'settings.mods.note':
    'No mod loader is implemented yet. These preferences are stored so a future loader can honour them; nothing is loaded today.',
  'settings.plugins.heading': 'External modules (DLC)',
  'settings.plugins.autoLoad': 'Auto-load external modules',
  'settings.plugins.autoLoad.desc':
    'Load every module URL below as soon as the client starts, without asking per module.',
  'settings.plugins.moduleUrls': 'Module URLs',
  'settings.plugins.moduleUrls.desc':
    'One or more ES module URLs, separated by spaces. Nothing is fetched until you add one here.',
  'settings.plugins.note1':
    'Nothing is downloaded unless a URL is entered here. Each URL must serve an ES module that exports createUpscaler() (or upscaler / descriptor / register(registry)). A module loaded this way can only ever register an external upscaler backend, and it cannot make DLSS or FSR possible on this renderer — it can only supply a real backend for a platform that already has one.',
  'settings.plugins.note2':
    'Only http(s):// URLs and root-relative /path URLs are accepted. Anything else — file:, data:, a bare hostname — is rejected before it is stored or imported.',
  'settings.about.repository': 'Repository',
  'settings.about.notPublished': 'Not published yet',
  'settings.about.open': 'Open',
  'settings.about.heading.product': 'Product',
  'settings.about.heading.licences': 'Licences',
  'settings.about.heading.source': 'Source',
  'settings.about.heading.credits': 'Credits',
  'settings.about.game': 'Game',
  'settings.about.version': 'Version',
  'settings.about.build': 'Build',
  'settings.about.code': 'Code',
  'settings.about.assets': 'Assets',
  'settings.about.copyright': 'Copyright',
  'settings.audio.heading.audio': 'Audio',
  'settings.audio.heading.music': 'Music',
  'settings.audio.heading.sfx': 'Sound effects',
  'settings.audio.muteAll': 'Mute all',
  'settings.audio.muteAll.desc':
    'Silences every channel without losing the mix below, so un-muting restores it exactly.',
  'settings.audio.master': 'Master volume',
  'settings.audio.bgm': 'BGM volume',
  'settings.audio.graze': 'Graze',
  'settings.audio.graze.desc': 'The near-miss cue when a bullet passes close to your hitbox.',
  'settings.audio.playerShot': 'Player shot',
  'settings.audio.playerShot.desc': 'Your own ship\u2019s shot cues.',
  'settings.audio.skill': 'Skill',
  'settings.audio.skill.desc': 'Bombs and spell cards.',
  'settings.audio.noAssetsNote':
    'No audio files ship with this build. The levels below are stored and pushed to the engine\u2019s mixer, but nothing will be audible until sound assets are added.',
  'settings.hud.heading': 'Battle HUD',
  'settings.hud.opponentHud': 'Opponent HUD',
  'settings.hud.opponentHud.desc': "The rival's Boss HP panel.",
  'settings.hud.damageNumbers': 'Damage numbers',
  'settings.hud.damageNumbers.desc': 'Floating damage values over the Boss.',
  'settings.hud.scoreCard': 'Score card',
  'settings.hud.scoreCard.desc': 'Your score and combo readout.',
  'settings.hud.ultMeter': 'Ultimate meter',
  'settings.hud.ultMeter.desc': 'Charge meter for bombs and spell cards.',
  'settings.hud.statusCard': 'Status card',
  'settings.hud.statusCard.desc': 'The main readout strip: HP, lives and bullet count.',
  'settings.hud.bulletCount': 'Bullet count',
  'settings.hud.bulletCount.desc': 'The BULLETS row inside the status card.',
  'settings.hud.countdown': 'Countdown',
  'settings.hud.countdown.desc': 'Remaining match time.',
  'settings.hud.networkFooter': 'Network footer',
  'settings.hud.networkFooter.desc': 'Ping and reconciliation readout along the bottom edge.',
  'settings.hud.note':
    'Hidden blocks are re-flowed away instead of leaving empty gaps, so the HUD stays compact. The damage-number and ultimate-meter overlays are still being built out: those two switches are stored now and take effect as each overlay lands.',
  'settings.keys.intro':
    'This list is generated from the single binding table the dispatcher matches against, so it can never drift from the code. Keys that stay live while a text field has focus are marked in the note at the end.',
  'settings.keys.textInputNote':
    'While a text field has focus only the bindings marked allowInTextInput fire — Tab, Shift+Tab, Enter, Escape, Alt+Enter, Ctrl+Tab.',
  'settings.keys.scope.global': 'Global',
  'settings.keys.scope.login': 'Login',
  'settings.keys.scope.lobby': 'Lobby',
  'settings.keys.scope.room': 'Room',
  'settings.keys.scope.battle': 'Battle',
  'settings.keys.scope.result': 'Result',
  'settings.keys.scope.checkin': 'Check-in',
  'settings.keys.scope.shop': 'Shop',
  'settings.keys.scope.inventory': 'Inventory',
  'settings.keys.scope.records': 'Records',
  'settings.keys.scope.settings': 'Settings',
  'checkin.title': 'Check-in',
  'checkin.cycle': 'This cycle',
  'checkin.claim': 'Claim',
  'checkin.locked': 'LOCKED',
  'checkin.claimed': 'CLAIMED',
  'checkin.loading': 'Loading check-in…',
  'checkin.streak': '{days}-day streak · {cycle}',
  'checkin.day': 'Day {day}',

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
  'gacha.title': 'Totems · Gacha',
  'gacha.pools': 'Pools',
  'gacha.pool.cards': 'Card Totem',
  'gacha.pool.characters': 'Character Totem',
  'gacha.wallet': 'gems {gems} · faith {faith} · dust {dust}',
  'gacha.kind.cards': '20-card catalog',
  'gacha.kind.characters': '52 player shots · A1/A2/B1/B2',
  'gacha.odds': '{kind} · {odds}',
  'gacha.costLine': '{single} ×1 / {ten} ×10',
  'gacha.pity': 'pity · SSR+ in ≤{rare} · UR in ≤{epic} · ten-pull rare+ guaranteed',
  'gacha.lastPull': 'Last pull',
  'gacha.noPulls': 'No pulls yet — the server owns every roll.',
  'gacha.roster': 'Roster · faith exchange',
  'gacha.rosterLine': 'owned {owned}/52 · faith {faith} · exchange {cost}',
  'gacha.exchangePick': 'Faith exchange — pick a locked shot ({cost} faith):',
  'gacha.exchangeNeed': 'Need {cost} faith (have {faith}); pull to earn 1 per draw.',
  'gacha.allUnlocked': 'All 52 shots unlocked.',
  'gacha.pullSingle': 'Pull ×1 · {cost}',
  'gacha.pullTen': 'Pull ×10 · {cost}',
  'gacha.back': 'Back to lobby',
  'gacha.result.new': '[{rarity}] {name} — NEW',
  'gacha.result.dupeFaith': '[{rarity}] {name} — dupe → +{faith} faith',
  'gacha.result.dupeDust': '[{rarity}] {name} — dupe → +{dust} dust',
  'screen.gacha.cards': 'Card Totem',
  'screen.gacha.characters': 'Character Totem',
  'ui.shop': 'Shop',
  'ui.settings': 'Settings',
  'ui.back': 'Back',
  'ui.gift': 'Gift',
  'ui.deck': 'Deck',
  'ui.rank': 'Rank',
  'ui.queue': 'Queue',
  'ui.mail': 'Mail',
  'ui.opponent': 'opponent',
  'ui.roomCode': 'Room code',
  'ui.backToLobby': 'Back to lobby',
  'ui.downloadDem': 'Download .dem',
  'ui.matchLabel': 'match {id}',

  // --- lobby flow status -----------------------------------------------------
  'flow.notConnected': 'Not connected',
  'flow.signingIn': 'Signing in…',
  'flow.loadingProfile': 'Loading profile…',
  'flow.signedInAs': 'Signed in as {name}',
  'flow.signInFailed': 'Sign-in failed',
  'flow.loginFailed': 'Login failed: {reason}',
  'flow.bootstrapFailed': 'Bootstrap failed: {reason}',
  'flow.enterEmailPassword': 'Enter your e-mail and password',
  'flow.enterEmail': 'Enter your e-mail address',
  'flow.enterUsernameEmailPassword': 'Enter a username, e-mail and password',
  'flow.sendingCode': 'Sending verification code…',
  'flow.codeSent': 'Verification code sent to {email}',
  'flow.codeSendFailed': 'Could not send the code',
  'flow.creatingAccount': 'Creating account…',
  'flow.accountCreated': 'Account created — signed in as {name}',
  'flow.signUpFailed': 'Sign-up failed',
  'flow.signedOut': 'Signed out',
  'flow.creatingRoom': 'Creating room {code}…',
  'flow.createRoomFailed': 'Create room failed: {reason}',
  'flow.joiningRoom': 'Joining room {code}…',
  'flow.joinRoomFailed': 'Join room failed: {reason}',
  'flow.roomStatus': 'Room {code}: {count} player(s)',
  'flow.matchStarting': 'Match {id} starting',
  'flow.matchResult': 'Winner: {winner}',
  'flow.transportClosed': 'Lobby transport closed: {reason}',
  'flow.queueIdle': 'Matchmaking queue: idle',
  'flow.queueStatus': 'Matchmaking queue: {status}',
  'flow.room.left': 'Left room',
  'flow.room.noRoom': 'No room to reconfigure',
  'flow.room.bossLocked': 'Boss/loadout can only change while you are alone in the room',
  'flow.room.reconfiguring': 'Reconfiguring room…',
  'flow.room.reconfigureFailed': 'Reconfigure failed: {error}',
  'flow.room.ready': 'Room {code} ready',
  'flow.queue.joining': 'Joining matchmaking queue…',
  'flow.queue.joinFailed': 'Matchmaking join failed: {error}',
  'flow.queue.queued': 'In queue {id} ({status})',
  'flow.queue.notQueued': 'Not in a matchmaking queue',
  'flow.queue.pollFailed': 'Queue poll failed: {error}',
  'flow.queue.status': 'Queue {id}: {status}{suffix}',
  'flow.queue.cancelFailed': 'Queue cancel failed: {error}',
  'flow.queue.left': 'Left matchmaking queue',
  'flow.match.readyWaitingMatch': 'Ready — waiting for match…',
  'flow.match.readyWaitingPlayers': 'Ready — waiting for players…',
  'flow.match.readyFailed': 'Ready failed: {error}',
  'flow.match.backInLobby': 'Back in lobby',
  'flow.match.noMatchToAbandon': 'No match to abandon',
  'flow.match.leaving': 'Leaving the match…',
  'flow.match.abandonFailed': 'Abandon failed: {error}',
  'flow.match.abandoned': 'Match {id} abandoned',
  'flow.match.info': 'Match {id}',
  'flow.match.winner': 'Winner: {id}',
  'flow.checkin.loading': 'Loading check-in…',
  'flow.checkin.loadFailed': 'Check-in load failed: {error}',
  'flow.checkin.streak': 'Check-in: {streak}-day streak',
  'flow.checkin.claimFailed': 'Check-in claim failed: {error}',
  'flow.checkin.claimed': 'Claimed day {day} · streak {streak}',
  'flow.shop.loading': 'Loading shop…',
  'flow.shop.loadFailed': 'Shop load failed: {error}',
  'flow.shop.summary': 'Shop: {count} item(s)',
  'flow.shop.purchaseFailed': 'Purchase failed: {error}',
  'flow.shop.bought': 'Bought {count}× {item}',
  'flow.gacha.loading': 'Loading totems…',
  'flow.gacha.loadFailed': 'Gacha load failed: {error}',
  'flow.gacha.rosterFailed': 'Roster load failed: {error}',
  'flow.gacha.pullFailed': 'Pull failed: {error}',
  'flow.gacha.pulledOne': 'Pulled 1× {pool}',
  'flow.gacha.pulledMany': 'Pulled {count}× {pool}',
  'flow.gacha.exchangeFailed': 'Exchange failed: {error}',
  'flow.gacha.unlocked': 'Unlocked {item} for {faith} faith',
  'flow.inventory.loading': 'Loading inventory…',
  'flow.inventory.loadFailed': 'Inventory load failed: {error}',
  'flow.inventory.summary': 'Inventory: {count} stack(s)',
  'flow.records.loading': 'Loading records…',
  'flow.records.loadFailed': 'Records load failed: {error}',
  'flow.records.summary': 'Records: {wins}W-{losses}L-{draws}D',

  // --- auth error codes ------------------------------------------------------
  'auth.unauthorized': 'Wrong e-mail or password',
  'auth.accountExists': 'That account is already registered',
  'auth.usernameRequired': 'Enter a username',
  'auth.emailRequired': 'Enter your e-mail address',
  'auth.passwordRequired': 'Enter a password',
  'auth.usernameInvalid': 'Username must be 3-24 letters, digits or underscores',
  'auth.emailInvalid': 'That e-mail address is not valid',
  'auth.passwordWeak': 'Password must be at least 8 characters',
  'auth.usernameTaken': 'That username is already taken',
  'auth.emailTaken': 'That e-mail is already registered — sign in instead',
  'auth.nakamaEmailCodeUnsupported': 'This sign-in method does not support e-mail codes - use your name and password',
  'auth.nakamaAuthenticateFailed': 'The sign-in service refused this attempt - please try again later',
  'auth.emailNotVerified': 'Verify your e-mail before signing in',
  'auth.codeRequired': 'Enter the 6-digit code we e-mailed you',
  'auth.codeInvalid': 'That verification code is incorrect',
  'auth.codeExpired': 'That code has expired — request a new one',
  'auth.codeRateLimited': 'Please wait a moment before requesting another code',
  'auth.mailUnavailable': 'The lobby could not send the e-mail — please try again shortly',
  'auth.accountsUnavailable': 'Accounts are unavailable right now — please try again shortly',
  'auth.invalidRequest':
    'Username must be 3-24 letters, digits or underscores, and the password at least 8 characters',
  'auth.storageUnavailable': 'The lobby cannot reach its database right now — please try again shortly',
  'auth.loginMissingSession': 'The lobby accepted the sign-in but returned no session',
  'auth.transportError': 'Cannot reach the lobby — check that it is running',
  'auth.sessionReplaced': 'That account signed in on another device',
  'auth.sessionExpired': 'Your session expired — please sign in again',
  'shortcuts.app.fullscreen': 'Toggle fullscreen',
  'shortcuts.app.settings': 'Open settings',
  'shortcuts.app.settingsClose': 'Close settings / go back',
  'shortcuts.battle.back': 'Back to the lobby',
  'shortcuts.battle.forfeit': 'Forfeit and go back',
  'shortcuts.battle.pause': 'Pause / resume',
  'shortcuts.battle.toggleHud': 'Toggle the HUD',
  'shortcuts.gacha.nextPool': 'Next pool',
  'shortcuts.gacha.prevPool': 'Previous pool',
  'shortcuts.gacha.pullOne': 'Pull x1',
  'shortcuts.lobby.activate': 'Activate the highlighted entry',
  'shortcuts.lobby.menuNext': 'Next menu entry',
  'shortcuts.lobby.menuPrev': 'Previous menu entry',
  'shortcuts.lobby.playPage': 'Open the Play page',
  'shortcuts.login.back': 'Back to the main menu',
  'shortcuts.login.focusNext': 'Next field',
  'shortcuts.login.focusPrev': 'Previous field',
  'shortcuts.login.sendCode': 'Send e-mail verification code',
  'shortcuts.login.submit': 'Sign in / create account',
  'shortcuts.login.toggleMode': 'Switch sign-in / register',
  'shortcuts.room.leave': 'Leave the room',
  'shortcuts.room.ready': 'Ready / start',
  'shortcuts.settings.reset': 'Reset every setting',
  'shortcuts.settings.scrollBottom': 'Scroll to the bottom',
  'shortcuts.settings.scrollDown': 'Scroll down a page',
  'shortcuts.settings.scrollTop': 'Scroll to the top',
  'shortcuts.settings.scrollUp': 'Scroll up a page',
  'shortcuts.settings.tabNext': 'Next tab',
  'shortcuts.settings.tabPrev': 'Previous tab',
  'shortcuts.shop.buy': 'Buy',
  'shortcuts.ui.back': 'Back',
  'shortcuts.ui.confirm': 'Confirm',
  'shortcuts.ui.continue': 'Continue',
  'shortcuts.ui.next': 'Next',
  'shortcuts.ui.prev': 'Previous',
  'shortcuts.ui.use': 'Use',

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
