#!/usr/bin/env node
/**
 * Downloads the **LayaAir Windows Build Support** module — the Windows
 * LayaNative runtime + SDK — into `native/windows/sdk/` (gitignored).
 *
 * This is the package the LayaAir IDE installs when you add "Windows 构建支持"
 * from the module manager. It is a plain, public Tencent-COS download; the URL
 * and size below are taken from the CLI's own module manifest
 * (`<layaair-cli>/Resources/modules.json`, entry `id: "windows"`).
 *
 * What you get:
 *   sdk/project/Runtime/x64/release/include/extension/LayaExtension.h  (real header)
 *   sdk/project/Runtime/x64/release/include/jsvm/JSVM.h                (real header)
 *   sdk/project/Runtime/x64/release/lib/conch.lib
 *   sdk/project/Runtime/x64/release/bin/*.dll
 *   sdk/x64/Release/LayaBox.exe                                        (player)
 *   sdk/project/{LayaBox.vcxproj,LayaBox.slnx,extension/...}           (MSVC templates)
 *
 * Usage:
 *   node tools/fetch_windows_support.mjs              # pinned 3.4.1
 *   LAYA_WIN_SUPPORT_VERSION=3.4.1 node tools/fetch_windows_support.mjs
 *
 * The extracted SDK is what `native/udp_ext/windows/extension.vcxproj` points
 * at via `LAYANATIVE_SDK_ROOT`, and what you would copy next to the IDE's
 * published Windows client.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, rm, rename, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import path from 'node:path';
import process from 'node:process';

const execFileAsync = promisify(execFile);

const version = process.env.LAYA_WIN_SUPPORT_VERSION ?? '3.4.1';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const supportDir = path.join(repoRoot, 'native', 'windows');
const cacheDir = path.join(supportDir, '.cache');
const sdkDir = path.join(supportDir, 'sdk');

const zipName = `windows-support-for-${version}.zip`;
const url = `https://ldc-1251285021.file.myqcloud.com/layaair-modules/${zipName}`;
/** Declared download size in the CLI manifest; used as a cheap integrity check. */
const expectedBytes = 158_950_350;
/** Files that must exist after extraction for a usable SDK. */
const REQUIRED = [
  'x64/Release/LayaBox.exe',
  'project/Runtime/x64/release/include/extension/LayaExtension.h',
  'project/Runtime/x64/release/include/jsvm/JSVM.h',
  'project/Runtime/x64/release/lib/conch.lib',
  'project/Runtime/x64/release/bin/conch.dll',
  'project/LayaBox.slnx',
  'project/extension/extension.vcxproj',
];

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function download(dest) {
  console.log(`[windows-support] downloading ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || response.body === null) {
    throw new Error(`download failed: HTTP ${response.status} ${response.statusText}`);
  }
  await pipeline(response.body, createWriteStream(dest));
  console.log(`[windows-support] saved ${dest}`);
}

async function extract(zipPath, destDir) {
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });
  if (process.platform === 'win32') {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`,
    ]);
    return;
  }
  await execFileAsync('unzip', ['-o', '-q', zipPath, '-d', destDir]);
}

async function main() {
  await mkdir(cacheDir, { recursive: true });
  const zipPath = path.join(cacheDir, zipName);
  if (await exists(zipPath)) {
    console.log(`[windows-support] reusing cached ${zipPath}`);
  } else {
    await download(zipPath);
  }

  const size = (await stat(zipPath)).size;
  if (size !== expectedBytes) {
    console.warn(
      `[windows-support] WARNING: archive is ${size} bytes, manifest declares ${expectedBytes}`,
    );
  }

  const staging = path.join(cacheDir, 'staging');
  await extract(zipPath, staging);

  // The archive has a single top-level directory `windows-support-for-<ver>/`.
  const inner = path.join(staging, `windows-support-for-${version}`);
  const source = (await exists(inner)) ? inner : staging;
  await rm(sdkDir, { recursive: true, force: true });
  await rename(source, sdkDir);
  await rm(staging, { recursive: true, force: true });

  const missing = [];
  for (const relative of REQUIRED) {
    if (!(await exists(path.join(sdkDir, relative)))) {
      missing.push(relative);
    }
  }
  if (missing.length > 0) {
    throw new Error(`support package did not contain: ${missing.join(', ')}`);
  }

  console.log(`[windows-support] LayaAir ${version} Windows runtime ready in ${sdkDir}`);
  console.log(`[windows-support] set LAYANATIVE_SDK_ROOT=${path.join(sdkDir, 'project', 'Runtime', 'x64', 'release')}`);
}

await main();
