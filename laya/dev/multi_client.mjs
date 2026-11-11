#!/usr/bin/env node
/**
 * 多开实例的 CDP 客户端：把 `pk_battle.mjs` 那套「登录 → 入房 → 进战斗」
 * 流程做成**按端口寻址**的通用工具，多开时每个实例一个端口。
 *
 * 用法：
 *   node dev/multi_client.mjs --port 5959 --state
 *   node dev/multi_client.mjs --port 5971 --email a@b.c --password xxx --join ABC123
 *   node dev/multi_client.mjs --ports 5959,5971 --state
 *
 * 依赖原生 .exe 已启动且 config.ini 开了 JSDebugMode=1 / JSDebugPort=<port>。
 */
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 连到某个端口的 CDP，评估一段表达式，返回字符串结果。 */
export function evalOn(port, expr, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/laya`);
    const pending = new Map();
    let seq = 0;
    let ctxId = null;
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error(`timeout ${timeoutMs}ms on port ${port}`));
    }, timeoutMs);
    const send = (method, params = {}) => {
      const id = ++seq;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((r) => pending.set(id, r));
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
        return;
      }
      if (m.method === 'Runtime.executionContextCreated') ctxId = m.params.context.id;
    };
    ws.onerror = (e) => {
      clearTimeout(timer);
      reject(new Error(`ws error on ${port}: ${e.message ?? e}`));
    };
    ws.onopen = async () => {
      try {
        await send('Runtime.enable');
        await sleep(900);
        const r = await send('Runtime.evaluate', {
          expression: expr,
          contextId: ctxId ?? undefined,
          awaitPromise: true,
          returnByValue: true,
        });
        clearTimeout(timer);
        ws.close();
        if (r.result?.exceptionDetails) {
          reject(new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 900)));
          return;
        }
        const v = r.result?.result?.value;
        resolve(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
      } catch (e) {
        clearTimeout(timer);
        try { ws.close(); } catch { /* ignore */ }
        reject(e);
      }
    };
  });
}

/**
 * 找到 flow / battleScene。
 *
 * 原生客户端没有 `?debug=1`，`window.__PK_SCENES__` 不存在，所以这里像
 * `pk_battle.mjs` 那样从 `Laya.stage._events` 里把带 `options.flow` /
 * `options.battle` 的场景挖出来。
 */
export const PRELUDE = `
  const _scenes = (() => {
    const seen = new Set();
    const out = [];
    const maps = Laya.stage._events || {};
    for (const t of Object.keys(maps)) {
      const it = maps[t] && maps[t]._items;
      const list = it ? (Array.isArray(it) ? it : Object.values(it)) : [];
      for (const h of list) {
        if (h && typeof h === 'object' && h.options && !seen.has(h)) { seen.add(h); out.push(h); }
      }
    }
    return out;
  })();
  const _flowScene = _scenes.find((s) => s.options.flow);
  const flow = (globalThis.__PK_FLOW__ = globalThis.__PK_FLOW__ || (_flowScene && _flowScene.options.flow));
  const _battleScene = _scenes.find((s) => s.options && s.options.battle);
  // ★ 原生扩展在 bind() 之后会把 socket 复位成阻塞模式，而客户端是在 bind
  //   之前调 setNonBlocking 的 ⇒ BattleClient 每 5ms 的 recvFrom 轮询会永久
  //   阻塞 JS 主线程（进程 CPU 归零、窗口「未响应」）。这里只在 bind 之后
  //   补一次 setNonBlocking(1)，不改任何产品代码。
  const u = globalThis.spk_udp;
  if (u && !u.__pk_nb_patched) {
    const origBind = u.bind.bind(u);
    u.bind = function (h, addr, port) {
      const r = origBind(h, addr, port);
      try { u.setNonBlocking(h, 1); } catch (e) {}
      return r;
    };
    u.__pk_nb_patched = true;
  }
`;

/** 战斗状态摘要（弹幕数 / 快照数 / tick / hash）。 */
export const STATE_EXPR = `(() => {${PRELUDE}
  const bs = _battleScene;
  if (!bs) return JSON.stringify({ error: 'no battle scene', screens: flow ? flow.screen : null });
  const v = bs.view;
  const a = bs.authoritative || {};
  const players = Array.isArray(a.players) ? a.players : Object.values(a.players || {});
  return JSON.stringify({
    screen: flow.screen,
    battleState: bs.options.battle.state,
    lastError: bs.options.battle.lastError,
    activeBullets: v.activeBullets,
    authBullets: Array.isArray(a.bullets) ? a.bullets.length : -1,
    authSpawns: Array.isArray(a.bulletSpawns) ? a.bulletSpawns.length : -1,
    rebuildMismatch: a.deltaRebuildMismatch === true,
    authWireCap: a.wireCap === undefined ? -1 : a.wireCap,
    authTick: a.tick === undefined ? -1 : a.tick,
    bulletPool: (v.bulletPool || []).length,
    snapshots: bs.options.battle.metrics.snapshotsReceived,
    metrics: bs.options.battle.metrics,
    localTick: bs.options.battle.simulation ? bs.options.battle.simulation.getCurrentTick() : null,
    authoritativeTick: a.tick,
    bossHp: a.bossHp,
    players: players.map((p) => ({ id: p.playerId, connected: p.connected, bossHp: p.bossCurrentHp, score: p.score })),
  });
})()`;

/** 登录 + 入房 + 进战斗。roomCode 为空则只登录。 */
export function joinExpr(email, password, roomCode) {
  // ★ roomCode 为空时只登录、不入房。
  //   注意：这里的片段必须用**字符串拼接**而不是嵌套模板字符串——嵌套的
  //   反引号会提前终止外层模板字面量，Node 直接报 SyntaxError。
  const roomBody = roomCode
    ? [
        'out.joinOk = await flow.joinRoom(' + JSON.stringify(roomCode) + ');',
        'const room = flow.client.room;',
        'const mid = room ? room.matchId : "";',
        'out.room = room ? { code: room.roomCode, matchId: mid, players: room.players.length } : null;',
        'if (mid === "") return JSON.stringify(out);',
        'let r = await flow.client.call("battle.allocation", { match_id: mid });',
        'let p = r.payload || {};',
        '// ★ allocation 竞态：房间满员时只创建 assignment，endpoint 要等 agent',
        '//   spawn 上报后才有效。抢跑会拿到注册基址（如 :7400）而不是真实对局',
        '//   端口（如 :7401），客户端连上去永远收不到快照。',
        'for (let i = 0; i < 20 && p.endpoint_reported !== true; i += 1) {',
        '  await new Promise((res) => setTimeout(res, 250));',
        '  r = await flow.client.call("battle.allocation", { match_id: mid });',
        '  p = r.payload || {};',
        '}',
        'out.endpointReported = p.endpoint_reported === true;',
        'out.endpoint = p.endpoint || "";',
        'out.serverSeedHex = p.server_seed_hex || "";',
        'out.players = (p.players || []).map((x) => ({ uid: x.user_id, pid: x.player_id, name: x.display_name }));',
        'const mine = (p.players || []).find((x) => x.user_id === out.uid);',
        'flow.enterBattle({',
        '  matchId: mid,',
        '  serverSeedHex: out.serverSeedHex,',
        '  endpoint: out.endpoint,',
        '  playerIds: (p.players || []).map((x) => x.player_id),',
        '  playerId: mine ? mine.player_id : "",',
        '  modeId: p.mode_id || "mvp_boss_race",',
        '  rulesetVersion: (p.version && p.version.ruleset_version) || "ruleset-local-s0",',
        '});',
        'out.screen = flow.screen;',
      ].join('\n    ')
    : '';

  return '(async () => {' + PRELUDE + '\n    const out = {};\n'
    + '    if (!flow.client.session) out.signIn = await flow.signInWithAccount('
    + JSON.stringify(email) + ', ' + JSON.stringify(password) + ');\n'
    + '    out.uid = flow.client.session ? flow.client.session.userId : "";\n'
    + '    out.lastError = flow.client.lastError;\n'
    + '    ' + roomBody + '\n'
    + '    return JSON.stringify(out);\n  })()';
}

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ports = (arg('--ports', '') || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const single = arg('--port', null);
  const list = ports.length > 0 ? ports : single ? [Number(single)] : [5959];
  const email = arg('--email', 'e2e.danmaku@test.local');
  const password = arg('--password', 'E2ePass123!');
  const room = arg('--join', '');
  const cmd = arg('--cmd', 'state');

  for (const port of list) {
    const expr = cmd === 'join' ? joinExpr(email, password, room) : STATE_EXPR;
    try {
      const v = await evalOn(port, expr);
      console.log(`--- port ${port} ---`);
      console.log(v);
    } catch (e) {
      console.log(`--- port ${port} --- FAIL ${e.message}`);
    }
  }
}
