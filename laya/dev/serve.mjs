#!/usr/bin/env node
/**
 * Zero-dependency static file server for the LayaAir build.
 *
 * Serves the `laya/` directory (so `index.html`, `engine/libs/*.js` and the
 * compiled `dist/` tree are all reachable) with correct MIME types. Run it
 * through `npm run dev` (build + serve) or `npm run serve` (serve only).
 *
 *   PORT=8080 node dev/serve.mjs
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

/** Resolves a request path to a file inside `root`, or null when it escapes. */
function resolveWithinRoot(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const full = path.resolve(root, relative);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return full === root || full.startsWith(prefix) ? full : null;
}

const server = createServer(async (request, response) => {
  const target = resolveWithinRoot(request.url ?? '/');
  if (target === null) {
    response.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(target);
    const file = info.isDirectory() ? path.join(target, 'index.html') : target;
    const body = await readFile(file);
    const type = MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }).end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
  }
});

server.listen(port, host, () => {
  console.log(`[serve] http://${host}:${port}/  (root ${root})`);
});
