#!/usr/bin/env node
/**
 * Post-processes the `dist/` ES modules emitted by `tsc -p tsconfig.browser.json`.
 *
 * TypeScript preserves relative import specifiers verbatim, so `./ui_kit` stays
 * `./ui_kit` in the output — which browsers cannot resolve. This script appends
 * the `.js` extension to every extension-less relative specifier, which is all
 * that is needed to load the client with `<script type="module">` and no
 * bundler. Run it via `npm run build`.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

/** `from './x'` / `import './x'` / `export ... from './x'`. */
const SPECIFIER = /(\bfrom\s*|\bimport\s*)(['"])(\.\.?\/[^'"]+)\2/g;
const HAS_EXTENSION = /\.(?:js|mjs|cjs|json|css|wasm|map)$/;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

let scanned = 0;
let rewritten = 0;

for await (const file of walk(distDir)) {
  if (!file.endsWith('.js')) {
    continue;
  }
  scanned += 1;
  const source = await readFile(file, 'utf8');
  const output = source.replace(SPECIFIER, (match, keyword, quote, specifier) => {
    if (HAS_EXTENSION.test(specifier)) {
      return match;
    }
    return `${keyword}${quote}${specifier}.js${quote}`;
  });
  if (output !== source) {
    await writeFile(file, output);
    rewritten += 1;
  }
}

if (scanned === 0) {
  console.error(`[esm] no compiled modules found in ${distDir} — run tsc first`);
  process.exit(1);
}
console.log(`[esm] scanned ${scanned} module(s), rewrote specifiers in ${rewritten}`);
