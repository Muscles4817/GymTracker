// Minimal static server so the app can be opened over http:// — service workers
// and "Add to Home Screen" don't work from a file:// URL.
//
//   npm start                            → http://localhost:5173
//   node tools/serve.mjs 8080 --host       also binds your LAN IP, for phone testing
//   node tools/serve.mjs 5200 --root ..    serves a parent dir, to mimic a subpath host
//                                          such as GitHub Pages' /<repo>/

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootArg = process.argv[process.argv.indexOf('--root') + 1];
const ROOT = process.argv.includes('--root') ? resolve(PROJECT, rootArg) : PROJECT;
const port = Number(process.argv.find((a) => /^\d+$/.test(a))) || 5173;
const exposeLan = process.argv.includes('--host');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';

    // Keep requests inside the project directory.
    const path = join(ROOT, normalize(rel).replace(/^([/\\])+/, ''));
    if (!path.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(path).catch(() => null);
    if (!info || info.isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }

    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'service-worker-allowed': '/',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end(String(err));
  }
});

server.listen(port, exposeLan ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`GymTracker  →  http://localhost:${port}`);
  if (exposeLan) {
    for (const list of Object.values(networkInterfaces())) {
      for (const n of list || []) {
        if (n.family === 'IPv4' && !n.internal) console.log(`  on your network →  http://${n.address}:${port}`);
      }
    }
    console.log('\nNote: phones only allow "Add to Home Screen" over https or localhost.');
  }
});
