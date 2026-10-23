#!/usr/bin/env node
/**
 * Publishes the Windows (LayaNative) client headlessly.
 *
 * The LayaAir IDE is a GUI app, but 3.4.1 also ships a CLI that can run the
 * exact same `windows` build pipeline without opening a window:
 *
 *     <layaair>/<version>/Resources/cli-main.js build windows -p <layaide> -o <out>
 *
 * That matters because the native `.exe` and the browser build share the same
 * `src/**` TypeScript, and the native bundle is *not* produced by `npm run
 * build` (which emits ESM into `dist/` for `index.html`). Without this script
 * the only way to refresh the `.exe` was to click through the IDE by hand, which
 * is why the checked-in launcher drifted a full day behind `src/`.
 *
 * What the CLI gets right on its own:
 *   - bundles `src/**` + `layaide/src/SpellKardBoot.ts` into `resource/js/bundle.js`,
 *     registering the boot class under the id `Scene.ls` references
 *     (`regClass("suTTxWx_S4Gdoj5PUGFygw")`) — verified byte-compatible with the
 *     IDE's own publish;
 *   - exports every asset under `layaide/assets/resources/**` into
 *     `resource/resources/**` and lists them in `resource/fileconfig.json`.
 *
 * What it does *not* do, and this script therefore fixes up:
 *   - it copies the SDK's sample extension (`my_extension.dll` +
 *     `my_extension.layaext.json`) from the player template, which must never
 *     ship — `assemble_windows_client.mjs` strips it for the same reason;
 *   - it emits the extension descriptors (`spk_udp.layaext.json`,
 *     `spk_win.layaext.json`) but never the compiled DLLs next to them, so the
 *     extensions would silently fail to load — the battle channel would fall
 *     back to the WebSocket relay and `Alt+Enter` would do nothing.
 *
 * Usage:
 *   node tools/publish_windows.mjs                       # -> build/windows/app-vN
 *   node tools/publish_windows.mjs --out D:/path/to/out
 *   node tools/publish_windows.mjs --install             # also copy into the launcher
 */

import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const layaideDir = path.join(repoRoot, 'layaide');

/** The SDK sample extension the player template ships; must not reach a build. */
const SAMPLE_FILES = ['my_extension.dll', 'my_extension.layaext.json'];

/**
 * The native extensions we ship. The IDE copies each `<name>.layaext.json`
 * descriptor from `build-templates/windows/release/` into the output on its own
 * (see the `build-templates` payload), so only the compiled DLLs need staging.
 */
const EXTENSION_DLLS = ['spk_udp.dll', 'spk_win.dll'];

/** Root of the launcher the user actually double-clicks. */
const DEFAULT_LAUNCHER = 'D:/gotouhou/win/build/windows';

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || index + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[index + 1];
}

/** Locates the newest installed LayaAir CLI version under `~/.layaair`. */
function findLayaCli() {
  const explicit = argValue('--layaair', null);
  if (explicit !== null) {
    return explicit;
  }
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const root = path.join(home, '.layaair');
  if (!existsSync(root)) {
    return null;
  }
  const versions = [];
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidate = path.join(root, entry.name, 'Resources', 'cli-main.js');
      if (existsSync(candidate)) {
        versions.push({ version: entry.name, cli: candidate });
      }
    }
  } catch {
    return null;
  }
  if (versions.length === 0) {
    return null;
  }
  versions.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  return versions[0].cli;
}

/** Picks `app-vN` with the smallest N that is still free, so runs never collide. */
async function nextVersionedOutDir(baseDir) {
  const used = new Set();
  try {
    for (const name of await readdir(baseDir)) {
      const match = /^app-v(\d+)$/.exec(name);
      if (match) {
        used.add(Number(match[1]));
      }
    }
  } catch {
    // Base directory does not exist yet — start at v1.
  }
  let n = 1;
  while (used.has(n)) {
    n += 1;
  }
  return path.join(baseDir, `app-v${n}`);
}

/** Where a compiled extension DLL is staged (the IDE build only ships its json). */
function findExtensionDll(fileName) {
  const candidates = [
    path.join(layaideDir, 'build-templates', 'windows', 'release'),
  ];
  for (const dir of candidates) {
    const file = path.join(dir, fileName);
    if (existsSync(file)) {
      return file;
    }
  }
  return null;
}

async function main() {
  const cli = findLayaCli();
  if (cli === null) {
    console.error('[publish-windows] LayaAir CLI not found. Pass --layaair=<cli-main.js> or install it (layaair install).');
    process.exit(1);
  }
  const outArg = argValue('--out', null);
  const out = outArg ?? (await nextVersionedOutDir('D:/gotouhou/win/build/windows'));

  console.log(`[publish-windows] cli    ${cli}`);
  console.log(`[publish-windows] out    ${out}`);

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const build = spawnSync(
    process.execPath,
    [cli, 'build', 'windows', '-p', layaideDir, '-o', out],
    { stdio: 'inherit' },
  );
  if (build.status !== 0) {
    console.error(`[publish-windows] LayaAir build failed with exit code ${build.status}`);
    process.exit(build.status ?? 1);
  }

  // 1. Strip the sample extension the player template drags in.
  for (const name of SAMPLE_FILES) {
    await rm(path.join(out, 'release', name), { force: true });
  }

  // 2. Stage the compiled extensions beside their descriptors. Each extension's
  //    `<name>.layaext.json` is merged into the output by the IDE from
  //    `build-templates/windows/release/`, so only the DLLs need fix-up here.
  const staged = new Map();
  for (const name of EXTENSION_DLLS) {
    const dll = findExtensionDll(name);
    staged.set(name, dll);
    if (dll === null) {
      console.warn(`[publish-windows] WARNING: ${name} not found — the matching native extension will not load.`);
    } else {
      await cp(dll, path.join(out, 'release', name));
    }
  }

  // 3. Sanity-check the pieces the runtime needs next to the executable.
  const required = ['release/SpellKard.exe', 'release/conch.dll', 'release/config.ini',
    'resource/js/bundle.js', 'resource/index.js', 'resource/Scene.ls'];
  for (const relative of required) {
    if (!existsSync(path.join(out, relative))) {
      console.error(`[publish-windows] MISSING after build: ${relative}`);
      process.exit(1);
    }
  }
  for (const name of SAMPLE_FILES) {
    if (existsSync(path.join(out, 'release', name))) {
      console.error(`[publish-windows] sample file survived cleanup: ${name}`);
      process.exit(1);
    }
  }

  const bundleSize = (await stat(path.join(out, 'resource/js/bundle.js'))).size;
  const extensionReport = EXTENSION_DLLS
    .map((name) => `${name}=${staged.get(name) === null ? 'MISSING' : 'staged'}`)
    .join('  ');
  console.log(`[publish-windows] ok  bundle.js=${bundleSize}B  ${extensionReport}`);

  if (process.argv.includes('--install')) {
    const launcher = argValue('--launcher', DEFAULT_LAUNCHER);
    console.log(`[publish-windows] installing into ${launcher}`);
    await cp(path.join(out, 'release'), path.join(launcher, 'release'), { recursive: true, force: true });
    await cp(path.join(out, 'resource'), path.join(launcher, 'resource'), { recursive: true, force: true });
    console.log('[publish-windows] launcher refreshed');
  } else {
    console.log('[publish-windows] pass --install to copy this into the launcher');
  }
}

main().catch((error) => {
  console.error('[publish-windows]', error);
  process.exit(1);
});
