/**
 * Art-direction icon mapping: the label→icon derivation is what lets every
 * existing scene get the plaque treatment without touching a single call site,
 * so a wrong mapping is a silent visual regression across the whole UI.
 */

import { expect, expectEqual, suite, test } from './harness';
import { iconNameForLabel, isArtIconName } from '../src/platform/laya/view/art_icons';

suite('art icons');

test('the labels the scenes actually use map onto an icon', () => {
  expectEqual(iconNameForLabel('Sign in'), 'account');
  expectEqual(iconNameForLabel('Create account'), 'confirm');
  expectEqual(iconNameForLabel('Play'), 'play');
  expectEqual(iconNameForLabel('Records'), 'records');
  expectEqual(iconNameForLabel('Shop'), 'shop');
  expectEqual(iconNameForLabel('Settings'), 'settings');
  expectEqual(iconNameForLabel('Gift'), 'gift');
  expectEqual(iconNameForLabel('Back'), 'back');
  expectEqual(iconNameForLabel('Deck'), 'deck');
  expectEqual(iconNameForLabel('Rank'), 'rank');
  expectEqual(iconNameForLabel('Queue'), 'queue');
  expectEqual(iconNameForLabel('Mail'), 'mail');
  // Case-insensitive and substring-based: the scenes capitalise inconsistently.
  expectEqual(iconNameForLabel('START MATCH'), 'play');
  expectEqual(iconNameForLabel('shop & store'), 'shop');
});

test('a label with no mapping returns null instead of a wrong icon', () => {
  expectEqual(iconNameForLabel('OK'), null);
  expectEqual(iconNameForLabel(''), null);
  expectEqual(iconNameForLabel('退出游戏'), null);
});

test('isArtIconName gates the icon set', () => {
  expect(isArtIconName('play'), 'a known icon passes');
  expect(isArtIconName('gift'), 'a known icon passes');
  expect(!isArtIconName('nope'), 'an unknown icon fails');
  expect(!isArtIconName(''), 'the empty string fails');
});
