#!/usr/bin/env node
/**
 * Structural self-check for the LayaAir IDE project in `laya/layaide/`.
 *
 * The IDE itself is a Windows GUI app we cannot run on CI, so this script pins
 * the parts of the project layout that the IDE relies on and that are easy to
 * break by hand:
 *
 *   1. the project descriptor (`SpellKard.laya`) and its engine version;
 *   2. every JSON file the IDE reads parses, and the required ones exist;
 *   3. `settings/BuildSettings.json#startupScene` points at the uuid of
 *      `assets/Scene.ls` (via its `.ls.meta`);
 *   4. the scene's `_$comp` list references the uuid of
 *      `src/SpellKardBoot.ts` (via its `.ts.meta`) — i.e. the boot script is
 *      actually attached to the startup scene;
 *   5. the Windows `build-templates` payload (config.ini with LoadExtension,
 *      the spk_udp extension descriptor) exists and is well-formed.
 *
 * Zero dependencies. Exit code 1 on the first structural problem found.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
const checks = [];

function fail(message) {
  failures.push(message);
}

function check(description, condition, detail = '') {
  checks.push({ description, ok: Boolean(condition), detail });
  if (!condition) {
    fail(detail === '' ? description : `${description}: ${detail}`);
  }
}

function readJson(relativePath) {
  const absolute = join(projectRoot, relativePath);
  if (!existsSync(absolute)) {
    fail(`missing file: ${relativePath}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    fail(`invalid JSON in ${relativePath}: ${error.message}`);
    return null;
  }
}

/** LayaAir 3.4.1 is the first release with the cross-platform extension API. */
const MIN_ENGINE = [3, 4, 1];

// --- 1. project descriptor -------------------------------------------------
const descriptor = readJson('SpellKard.laya');
check('SpellKard.laya exists and parses', descriptor !== null);
if (descriptor) {
  check('SpellKard.laya#version is present', typeof descriptor.version === 'string');
  const parts = String(descriptor.version).split('.').map((n) => Number.parseInt(n, 10));
  const atLeast =
    parts.length >= 3 &&
    (parts[0] > MIN_ENGINE[0] ||
      (parts[0] === MIN_ENGINE[0] && parts[1] > MIN_ENGINE[1]) ||
      (parts[0] === MIN_ENGINE[0] && parts[1] === MIN_ENGINE[1] && parts[2] >= MIN_ENGINE[2]));
  check(
    `SpellKard.laya#version >= ${MIN_ENGINE.join('.')} (extension API)`,
    atLeast,
    `found ${descriptor.version}`,
  );
}

// --- 2. required files -----------------------------------------------------
const REQUIRED = [
  'assets/Scene.ls',
  'assets/Scene.ls.meta',
  'src/SpellKardBoot.ts',
  'src/SpellKardBoot.ts.meta',
  'settings/BuildSettings.json',
  'settings/EditorSettings.json',
  'settings/PlayerSettings.json',
  'tsconfig.json',
  'build-templates/windows/release/config.ini',
  'build-templates/windows/release/spk_udp.layaext.json',
];
for (const relativePath of REQUIRED) {
  check(`required file ${relativePath}`, existsSync(join(projectRoot, relativePath)));
}

// --- 3/4. scene <-> script <-> startup scene wiring ------------------------
const sceneMeta = readJson('assets/Scene.ls.meta');
const scene = readJson('assets/Scene.ls');
const bootMeta = readJson('src/SpellKardBoot.ts.meta');
const buildSettings = readJson('settings/BuildSettings.json');

if (sceneMeta && scene) {
  const sceneUuid = sceneMeta.uuid;
  const components = Array.isArray(scene._$comp) ? scene._$comp : [];
  const attached = components
    .map((component) => (component && typeof component._$type === 'string' ? component._$type : ''))
    .filter((value) => value !== '');
  check(
    'startup scene attaches at least one script component',
    attached.length > 0,
    'assets/Scene.ls#_$comp is empty',
  );
  if (bootMeta) {
    check(
      'assets/Scene.ls#_$comp references src/SpellKardBoot.ts uuid',
      attached.includes(bootMeta.uuid),
      `expected ${bootMeta.uuid}, found [${attached.join(', ')}]`,
    );
  }
  if (buildSettings) {
    check(
      'settings/BuildSettings.json#startupScene points at assets/Scene.ls',
      buildSettings.startupScene === `res://${sceneUuid}`,
      `expected res://${sceneUuid}, found ${buildSettings.startupScene}`,
    );
  }
}

// --- 5. Windows native payload --------------------------------------------
const extension = readJson('build-templates/windows/release/spk_udp.layaext.json');
if (extension) {
  check('extension descriptor declares name "spk_udp"', extension.extension?.name === 'spk_udp');
  check(
    'extension descriptor maps windows.x86_64 -> spk_udp.dll',
    extension.libraries?.['windows.x86_64'] === 'spk_udp.dll',
    `found ${JSON.stringify(extension.libraries)}`,
  );
  check('extension descriptor declares api_version 1', extension.extension?.api_version === 1);
}

if (existsSync(join(projectRoot, 'build-templates/windows/release/config.ini'))) {
  const ini = readFileSync(join(projectRoot, 'build-templates/windows/release/config.ini'), 'utf8');
  check(
    'windows config.ini enables LoadExtension=true',
    /^\s*LoadExtension\s*=\s*true/m.test(ini),
    'the spk_udp extension will not load without it',
  );
}

// --- report ----------------------------------------------------------------
const failed = checks.filter((entry) => !entry.ok);
if (failed.length > 0) {
  console.error(`layaide project check FAILED (${failed.length}/${checks.length} checks)`);
  for (const entry of failed) {
    console.error(`  x ${entry.description}${entry.detail ? ` — ${entry.detail}` : ''}`);
  }
  process.exit(1);
}

console.log(`layaide project check OK (${checks.length} checks)`);
