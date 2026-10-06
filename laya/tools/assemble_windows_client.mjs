#!/usr/bin/env node
/**
 * Assembles a runnable Windows client directory from the LayaAir Windows
 * runtime plus the project's extension payload.
 *
 * Layout produced (all of it is what `LayaBox.exe` expects next to itself):
 *
 *   <out>/
 *     LayaBox.exe                LayaNative Windows player
 *     conch.dll v8.dll ...       runtime DLLs
 *     config.ini                 LoadExtension=true (from build-templates)
 *     spk_udp.layaext.json       extension descriptor (from build-templates)
 *     spk_udp.dll                built by native/udp_ext/windows/extension.vcxproj
 *     scripts/ ca/ font/ image/  runtime resources
 *     <app payload>              <- `--app <published-dir>`
 *
 * The **application payload** (compiled scripts + `resources/` + the runtime's
 * own `scripts/index.js`) is produced by the LayaAir IDE's Windows publish, and
 * is copied on top with `--app`. Without `--app` the directory is a runnable
 * runtime shell (it boots the LayaAir DCC demo) — useful to smoke-test the
 * player, the DLLs and the extension before wiring the real app.
 *
 * Prerequisites:
 *   node tools/fetch_windows_support.mjs      # -> native/windows/sdk/
 *   (optional) build native/udp_ext/windows/extension.vcxproj -> spk_udp.dll
 *
 * Usage:
 *   node tools/assemble_windows_client.mjs
 *   node tools/assemble_windows_client.mjs --app "C:\\path\\to\\release\\windows"
 *   node tools/assemble_windows_client.mjs --out dist-windows --app ./published
 */

import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || index + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[index + 1];
}

const sdkDir = path.resolve(repoRoot, argValue('--sdk', 'native/windows/sdk'));
const outDir = path.resolve(repoRoot, argValue('--out', 'dist-windows'));
const appDir = argValue('--app', null);
const buildTemplates = path.join(repoRoot, 'layaide', 'build-templates', 'windows', 'release');

/** Runtime files copied from the SDK's `x64/Release` player directory. */
const RUNTIME_SOURCE = path.join(sdkDir, 'x64', 'Release');
/** Sample extension shipped in the support package — must not reach the client. */
const SAMPLE_FILES = ['my_extension.dll', 'my_extension.layaext.json'];
const REQUIRED_IN_OUT = ['LayaBox.exe', 'conch.dll', 'config.ini', 'spk_udp.layaext.json'];

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(RUNTIME_SOURCE))) {
    throw new Error(
      `runtime not found at ${RUNTIME_SOURCE}\n` +
        'Run `npm run fetch:windows` first (downloads the Windows Build Support module).',
    );
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // 1. runtime player: exe + DLLs + resources + scripts
  await cp(RUNTIME_SOURCE, outDir, { recursive: true });

  // 2. drop the support package's sample extension so LoadExtension=true does
  //    not try to load a DLL that is not ours.
  for (const name of SAMPLE_FILES) {
    await rm(path.join(outDir, name), { force: true });
  }

  // 3. project payload from build-templates (config.ini, descriptor, spk_udp.dll)
  if (await exists(buildTemplates)) {
    await cp(buildTemplates, outDir, { recursive: true });
  }

  // 4. optional: the IDE-published application payload on top
  if (appDir !== null) {
    const resolvedApp = path.resolve(appDir);
    if (!(await exists(resolvedApp))) {
      throw new Error(`--app directory does not exist: ${resolvedApp}`);
    }
    await cp(resolvedApp, outDir, { recursive: true });
  }

  // 5. verify
  const missing = [];
  for (const name of REQUIRED_IN_OUT) {
    if (!(await exists(path.join(outDir, name)))) {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    throw new Error(`assembled client is missing: ${missing.join(', ')}`);
  }
  const hasExtensionDll = await exists(path.join(outDir, 'spk_udp.dll'));
  const ini = await readFile(path.join(outDir, 'config.ini'), 'utf8');
  if (!/^\s*LoadExtension\s*=\s*true/m.test(ini)) {
    throw new Error('config.ini does not enable LoadExtension=true');
  }

  const notes = [
    'Phantasm Klash — assembled Windows client',
    '=========================================',
    '',
    `runtime      : ${RUNTIME_SOURCE}`,
    `build-templates: ${buildTemplates}`,
    `app payload  : ${appDir === null ? '(none — runtime shell only)' : path.resolve(appDir)}`,
    `spk_udp.dll  : ${hasExtensionDll ? 'present' : 'MISSING (build native/udp_ext/windows/extension.vcxproj)'}`,
    '',
    hasExtensionDll
      ? 'Raw-UDP battle channel: available (spk_udp loaded via LoadExtension=true).'
      : 'Raw-UDP battle channel: unavailable — the client falls back to the WS relay.',
    '',
    'Run LayaBox.exe in this directory.',
    '',
  ];
  await writeFile(path.join(outDir, 'ASSEMBLED.txt'), notes.join('\n'), 'utf8');

  console.log(`[windows-client] assembled -> ${outDir}`);
  console.log(`[windows-client] spk_udp.dll: ${hasExtensionDll ? 'present' : 'MISSING'}`);
  if (appDir === null) {
    console.log('[windows-client] no --app payload: this boots the LayaAir demo, not SpellKard.');
  }
}

await main();
