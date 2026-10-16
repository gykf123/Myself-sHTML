#!/usr/bin/env node
/**
 * 零依赖本地静态服务器
 * 用途：以正确的 MIME 类型与跨源隔离头提供静态资源，使 WASM / Web Worker 可正常加载。
 *   需要 http:// 而不是 file://，否则 WebAssembly.instantiateStreaming 与 Worker 会被浏览器拦截。
 *
 * 用法：node serve.mjs [port]   默认 http://localhost:8080
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function resolveSafe(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const abs = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  return abs.startsWith(ROOT) ? abs : null;
}

const server = http.createServer((req, res) => {
  let file = resolveSafe(req.url || '/');
  if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

  const headers = {
    // 跨源隔离头：为潜在的 SharedArrayBuffer / 多线程 WASM 预留，且不影响普通资源
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': 'no-cache',
  };

  if (!file || !fs.existsSync(file)) {
    // 允许省略 .html 的整洁链接
    const alt = file ? file + '.html' : null;
    if (alt && fs.existsSync(alt)) file = alt;
    else {
      const nf = path.join(ROOT, '404.html');
      res.writeHead(404, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'Not Found');
      return;
    }
  }

  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { ...headers, 'Content-Type': MIME[ext] || 'application/octet-stream' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n  Minecraft Search 复刻版运行中\n  → http://localhost:${PORT}\n\n  Ctrl+C 停止\n`);
});
