#!/usr/bin/env node
/**
 * `.dem` replay verifier (thread B E2E tool).
 *
 * Downloads a finished match's `.dem` v1 container from the lobby by `replay_id`
 * (or reads a local file), parses it, replays it through the ported
 * `BossRaceSimulation`, and prints the server-declared vs locally-recomputed
 * `final_state_hash` side by side.
 *
 * Usage:
 *   node tools/dem_verify.mjs --file path/to/match.dem
 *   node tools/dem_verify.mjs --replay <replay_id> [--lobby http://host:7350] [--token <session>]
 *
 * Env fallbacks: GENSOULKYO_LOBBY_ENDPOINT, GENSOULKYO_SESSION_TOKEN.
 *
 * It consumes the CommonJS build under `.test-build/` (produced by `npm test` /
 * `tsc -p tsconfig.test.json`), so run that first.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

function loadCore() {
  try {
    return {
      parse: require(resolve(here, '../.test-build/src/core/dem/parse.js')),
      replayer: require(resolve(here, '../.test-build/src/core/dem/replayer.js')),
      sha256: require(resolve(here, '../.test-build/src/core/dem/sha256.js')),
    };
  } catch (error) {
    console.error(
      'dem_verify: core build not found under .test-build/. Run `npm test` (or `npx tsc -p tsconfig.test.json`) first.',
    );
    console.error(`  ${String(error)}`);
    process.exit(2);
  }
}

function parseArgs(argv) {
  const args = { file: '', replay: '', lobby: process.env.GENSOULKYO_LOBBY_ENDPOINT ?? '', token: process.env.GENSOULKYO_SESSION_TOKEN ?? '' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--file') args.file = value ?? '';
    else if (key === '--replay') args.replay = value ?? '';
    else if (key === '--lobby') args.lobby = value ?? '';
    else if (key === '--token') args.token = value ?? '';
    if (key.startsWith('--')) i += 1;
  }
  return args;
}

async function fetchDem(lobby, replayId, token) {
  if (lobby === '') {
    throw new Error('dem_verify: --lobby (or GENSOULKYO_LOBBY_ENDPOINT) is required to download');
  }
  const url = `${lobby.replace(/\/$/, '')}/v1/replays/${encodeURIComponent(replayId)}/dem`;
  const headers = token === '' ? {} : { Authorization: `Bearer ${token}` };
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`dem_verify: download failed HTTP ${response.status}`);
  }
  const declared = response.headers.get('X-PhK-Dem-Sha256') ?? '';
  const buffer = await response.arrayBuffer();
  return { bytes: new Uint8Array(buffer), declared };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.file === '' && args.replay === '') {
    console.error('usage: node tools/dem_verify.mjs --file <path.dem> | --replay <replay_id> [--lobby url] [--token token]');
    process.exit(1);
  }

  const core = loadCore();
  let bytes;
  let declaredSha = '';
  if (args.file !== '') {
    bytes = new Uint8Array(readFileSync(resolve(process.cwd(), args.file)));
  } else {
    const downloaded = await fetchDem(args.lobby, args.replay, args.token);
    bytes = downloaded.bytes;
    declaredSha = downloaded.declared;
  }

  const actualSha = core.sha256.bytesToHex(core.sha256.sha256(bytes));
  const document = core.parse.parseDemDocument(bytes);
  const replayer = new core.replayer.DemReplayer(document);
  const result = replayer.runToEnd();

  console.log('=== dem_verify ===');
  console.log(`container bytes : ${bytes.length}`);
  console.log(`container sha256: ${actualSha}`);
  if (declaredSha !== '') {
    console.log(`server-sha256   : ${declaredSha} ${declaredSha === actualSha ? '(match)' : '(MISMATCH)'}`);
  }
  console.log(`match_id        : ${document.header.match_id}`);
  console.log(`mode_id         : ${document.header.mode_id}`);
  console.log(`boss_id         : ${document.header.boss_id}`);
  console.log(`ruleset_version : ${document.header.ruleset_version}`);
  console.log(`server_seed     : ${document.header.server_seed}`);
  console.log(`players         : ${document.header.players.map((p) => p.player_id).join(', ') || '(none)'}`);
  console.log(`chain entries   : ${document.entries.length} (entry_count=${document.header.entry_count})`);
  console.log(`chain head      : ${document.header.chain_head_digest}`);
  console.log(`final tick      : ${result.finalTick}`);
  console.log(`inputs          : accepted=${result.acceptedInputs} skipped=${result.skippedInputs}`);
  console.log(`declared hash   : ${result.declaredStateHash}`);
  console.log(`replayed hash   : ${result.replayedStateHash}`);
  console.log(`hash match      : ${result.hashMatched ? 'YES' : 'NO'}`);
  console.log(`keyframes       : ${replayer.keyframes.length}`);

  process.exit(result.hashMatched ? 0 : 1);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(2);
});
