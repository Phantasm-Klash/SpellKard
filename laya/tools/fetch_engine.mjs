#!/usr/bin/env node
/**
 * Downloads the LayaAir 3 engine build used by this client into `engine/libs/`.
 *
 * The engine is NOT an npm dependency: the published `layaair` npm package is a
 * stale 1.0.x artifact that has nothing to do with LayaAir 3. The supported way
 * to obtain the runtime is the official GitHub release archive
 * `LayaAir_<version>_libs.zip`.
 *
 * Usage:
 *   node tools/fetch_engine.mjs                 # default pinned version
 *   node tools/fetch_engine.mjs 3.3.13          # explicit version
 *   LAYA_ENGINE_VERSION=3.3.14 node tools/fetch_engine.mjs
 *
 * `engine/libs/*.js` is committed to the repository so the scaffold is runnable
 * without network access; re-run this script only when bumping the engine.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, rm, readdir, rename, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import path from 'node:path';
import process from 'node:process';

const execFileAsync = promisify(execFile);

const version = process.argv[2] ?? process.env.LAYA_ENGINE_VERSION ?? '3.3.13';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const engineDir = path.join(repoRoot, 'engine');
const libsDir = path.join(engineDir, 'libs');
const cacheDir = path.join(engineDir, '.cache');
const zipName = `LayaAir_${version}_libs.zip`;
const url = `https://github.com/layabox/LayaAir/releases/download/v${version}/${zipName}`;

/** Engine files the client actually loads, in load order. */
export const ENGINE_LIBS = [
  'laya.core.js',
  'laya.webgl_2D.js',
  'laya.opengl_2D.js',
  'laya.device.js',
  'laya.ui.js',
  'laya.ani.js',
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
  console.log(`[engine] downloading ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || response.body === null) {
    throw new Error(`download failed: HTTP ${response.status} ${response.statusText}`);
  }
  await pipeline(response.body, createWriteStream(dest));
  console.log(`[engine] saved ${dest}`);
}

/** Extracts the archive using whatever is available on the host. */
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

/** Flattens `destDir` so the wanted libs end up directly under `libsDir`. */
async function collect(sourceDir) {
  await mkdir(libsDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      await collect(full);
      continue;
    }
    if (!ENGINE_LIBS.includes(entry.name)) {
      continue;
    }
    await rename(full, path.join(libsDir, entry.name));
  }
}

async function main() {
  await mkdir(engineDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  const zipPath = path.join(cacheDir, zipName);
  if (!(await exists(zipPath))) {
    await download(zipPath);
  } else {
    console.log(`[engine] reusing cached ${zipPath}`);
  }

  const staging = path.join(cacheDir, 'staging');
  await extract(zipPath, staging);
  await collect(staging);

  const missing = [];
  for (const lib of ENGINE_LIBS) {
    if (!(await exists(path.join(libsDir, lib)))) {
      missing.push(lib);
    }
  }
  if (missing.length > 0) {
    throw new Error(`engine archive did not contain: ${missing.join(', ')}`);
  }
  console.log(`[engine] LayaAir ${version} ready in ${libsDir}`);
}

await main();
