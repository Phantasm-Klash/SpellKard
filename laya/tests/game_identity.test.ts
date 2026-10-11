/**
 * Product identity tests.
 *
 * The login title, the lobby header and the settings panel all read from
 * `game_identity`, so a typo here would ship to every screen at once. These
 * pin the exact strings the player sees.
 */

import {
  GAME_NAME_EN,
  GAME_NAME_ZH,
  GAME_VERSION,
  gameNameLine,
  gameTitle,
  lobbyTitle,
} from '../src/core/game/game_identity';
import { expect, expectEqual, suite, test } from './harness';

suite('game identity');

test('the Chinese product name is 纷争幻想', () => {
  expectEqual(GAME_NAME_ZH, '纷争幻想');
});

test('the Latin name is kept alongside the Chinese one', () => {
  expectEqual(GAME_NAME_EN, 'Phantasm Klash');
});

test('the entry title is the Chinese name, with no Latin wordmark', () => {
  expectEqual(gameTitle(), GAME_NAME_ZH);
  expect(!gameTitle().includes(GAME_NAME_EN), 'the title must not carry the Latin name');
});

test('the lobby header names the product and the screen', () => {
  expectEqual(lobbyTitle(), `${GAME_NAME_ZH} — Lobby`);
  expect(lobbyTitle().startsWith(GAME_NAME_ZH), 'the lobby header must lead with the product name');
});

test('the settings "Game" row lists both names, Chinese first', () => {
  expectEqual(gameNameLine(), `${GAME_NAME_ZH} · ${GAME_NAME_EN}`);
  expect(
    gameNameLine().indexOf(GAME_NAME_ZH) < gameNameLine().indexOf(GAME_NAME_EN),
    'the Chinese name must come first',
  );
});

test('the version is a non-empty semver-ish string', () => {
  expect(/^\d+\.\d+\.\d+$/.test(GAME_VERSION), `unexpected version string: ${GAME_VERSION}`);
});
