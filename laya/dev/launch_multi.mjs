#!/usr/bin/env node
/**
 * 原生客户端多开启动器（实机测试用）。
 *
 * 为什么需要：服务端要求 2 人满员才开局，而 conch 的 CDP 调试端口来自
 * **exe 同目录**的 config.ini（实测 cwd 无效），所以第二个实例必须有自己的
 * 目录 + 自己的 JSDebugPort，否则第二个进程会因 10048（端口占用）起不来。
 *
 * 副本不复制 293MB 产物：
 *   - release/ 下的大文件用**硬链接**（同一 NTFS 卷，零额外占用），
 *     只有 config.ini 是真实副本（要改端口）；
 *   - release/ 下的子目录与整个 resource/ 用**目录联接（Junction）**共享。
 * 实测第二实例额外占用约 63MB（config.ini + 目录项）。
 *
 * 用法：
 *   node dev/launch_multi.mjs                     # 建 N 个副本（默认 2）
 *   node dev/launch_multi.mjs --instances 3       # 建 3 个
 *   node dev/launch_multi.mjs --base app-v72      # 以哪个产物为基准
 *   node dev/launch_multi.mjs --ports 5959,5971,5972
 *   node dev/launch_multi.mjs --clean             # 只删副本，不启动
 *
 * 启动后每个实例的 CDP 端口见 stdout；用 tools/ 下的 CDP 探针按端口驱动。
 */
import { cpSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, lstatSync, openSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const LAYA_ROOT = resolve(HERE, '..');
const WIN_ROOT = 'D:/gotouhou/win/build/windows';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const has = (flag) => process.argv.includes(flag);

/** 最新产物目录（app-vN，N 最大者）。 */
function latestBuild() {
  const dirs = readdirSync(WIN_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^app-v\d+$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  if (dirs.length === 0) throw new Error(`no app-vN under ${WIN_ROOT}`);
  return dirs[dirs.length - 1];
}

/**
 * 复制一个「可独立启动」的实例目录。
 *
 * 硬链接只在同一卷内有效；跨卷时退化为真实复制（仍可用，只是占空间）。
 *
 * ★ 不整目录删除重建：副本里含目录联接（junction），整体删除会被系统层的
 *   「安全删除」拦截（"Some operations were aborted"）。所以这里只**覆盖**
 *   真正需要变的那几个文件（config.ini），其余靠联接共享。
 */
function cloneInstance(baseDir, outDir, port) {
  mkdirSync(join(outDir, 'release'), { recursive: true });

  const srcRelease = join(baseDir, 'release');
  for (const entry of readdirSync(srcRelease, { withFileTypes: true })) {
    const src = join(srcRelease, entry.name);
    const dst = join(outDir, 'release', entry.name);
    if (entry.isDirectory()) {
      if (!existsSync(dst)) {
        symlinkSync(src, dst, 'junction');
      }
      continue;
    }
    if (entry.name === 'config.ini') {
      // 独立副本：端口要改，CDP 也要开。
      // ★ `JSDebugMode=0` 时 conch 根本不监听调试端口，CDP 探针连不上 ——
      //   所以副本一律强制 `JSDebugMode=1`（产品产物本身默认关，这里只改副本）。
      const text = readFileSync(src, 'utf8');
      let patched = /^JSDebugPort=.*$/m.test(text)
        ? text.replace(/^JSDebugPort=.*$/m, `JSDebugPort=${port}`)
        : `${text}\nJSDebugPort=${port}\n`;
      patched = /^JSDebugMode=.*$/m.test(patched)
        ? patched.replace(/^JSDebugMode=.*$/m, 'JSDebugMode=1')
        : `${patched}\nJSDebugMode=1\n`;
      writeFileSync(dst, patched, 'utf8');
      continue;
    }
    if (!existsSync(dst)) {
      try {
        linkSync(src, dst);
      } catch {
        cpSync(src, dst);
      }
    }
  }

  // resource/ 共享：整个目录联接。
  const srcResource = join(baseDir, 'resource');
  if (existsSync(srcResource) && !existsSync(join(outDir, 'resource'))) {
    symlinkSync(srcResource, join(outDir, 'resource'), 'junction');
  }
  return outDir;
}

/**
 * 启动一个实例，detached 以便它在本脚本退出后继续存活。
 *
 * ★ 日志必须用**文件描述符**而不是 pipe：`child.stdout` 是 pipe 时，Node 的
 *   事件循环会一直等它关闭，脚本自己就退不出去（会被外部 SIGTERM 掉，
 *   连带子进程一起没）。把 fd 直接交给子进程即可，父进程不需要持有管道。
 */
function launch(instanceDir, port) {
  const exe = join(instanceDir, 'release', 'SpellKard.exe');
  if (!existsSync(exe)) throw new Error(`missing ${exe}`);
  const logPath = join(instanceDir, 'launch.log');
  const fd = openSync(logPath, 'a');
  const child = spawn(exe, [], {
    cwd: join(instanceDir, 'release'),
    detached: true,
    stdio: ['ignore', fd, fd],
    env: {
      ...process.env,
      // 走本机回环时不能让代理插手。
      http_proxy: '', HTTP_PROXY: '', https_proxy: '', HTTPS_PROXY: '', ALL_PROXY: '',
    },
  });
  child.unref();
  closeSync(fd);
  return { pid: child.pid, logPath };
}

function main() {
  const base = arg('--base', latestBuild());
  const baseDir = join(WIN_ROOT, base);
  if (!existsSync(baseDir)) throw new Error(`base build not found: ${baseDir}`);
  const count = Number(arg('--instances', '2'));
  const ports = (arg('--ports', '') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  const list = ports.length > 0 ? ports : Array.from({ length: count }, (_, i) => 5959 + i);

  if (has('--clean')) {
    for (const port of list) {
      const dir = join(WIN_ROOT, `${base}-p${port}`);
      rmSync(dir, { recursive: true, force: true });
      console.log(`[launch_multi] removed ${dir}`);
    }
    return;
  }
  console.log(`[launch_multi] base=${base} instances=${list.length}`);
  for (const port of list) {
    const dir = join(WIN_ROOT, `${base}-p${port}`);
    cloneInstance(baseDir, dir, port);
    const { pid, logPath } = launch(dir, port);
    console.log(`[launch_multi] port=${port} dir=${dir} pid=${pid} log=${logPath}`);
  }
  console.log('[launch_multi] 每个实例的 CDP: ws://127.0.0.1:<port>/laya');
}

main();
