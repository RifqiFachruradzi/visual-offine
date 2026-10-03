#!/usr/bin/env node
/* =========================================================================
 * server.js — server lokal opsional untuk Visual Office (tanpa dependency
 * wajib). Fungsi:
 *   1. Menyajikan file statis (index.html, js/, css/).
 *   2. POST /api/run    → menjalankan satu agent memakai Claude API
 *                          (butuh `npm install` + ANTHROPIC_API_KEY).
 *   3. POST /api/event  → menerima event dari Claude Code hooks,
 *      GET  /api/events → menyiarkannya ke browser (Server-Sent Events).
 *
 * Jalankan:  npm start        (default port 4317, ubah dengan PORT=xxxx)
 * ========================================================================= */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '127.0.0.1';
const ALLOWED_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']);

/* ------------------------------------------------------------ Claude SDK (opsional) */
let client = null;
let aiReason = '';
try {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  client = new Anthropic(); // ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / profil `ant auth login`
  aiReason = 'Claude API siap';
} catch {
  aiReason = 'Paket @anthropic-ai/sdk belum terpasang — jalankan `npm install`';
}
const hasCredentials = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE || fs.existsSync(path.join(process.env.HOME || '', '.config', 'anthropic')));

/* ------------------------------------------------------------ util */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8' };

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body terlalu besar')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const sse = (res) => res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
const send = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

/* ------------------------------------------------------------ live events */
const listeners = new Set();
function broadcast(ev) { for (const res of listeners) send(res, ev); }
setInterval(() => { for (const res of listeners) res.write(': ping\n\n'); }, 25_000).unref();

/* ------------------------------------------------------------ /api/run */
async function runAgent(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'JSON tidak valid' }); }
  if (!client || !hasCredentials()) return json(res, 503, { error: aiReason });
  const model = ALLOWED_MODELS.has(body.model) ? body.model : 'claude-opus-5-5';
  const system = String(body.system || '').slice(0, 8000);
  const prompt = String(body.prompt || '').slice(0, 60_000);
  if (!prompt) return json(res, 400, { error: 'prompt kosong' });

  sse(res);
  const params = {
    model,
    max_tokens: 4000,
    system,
    messages: [{ role: 'user', content: prompt }],
  };
  // Haiku 4.5 tidak mendukung `effort` maupun fallback server-side.
  if (model !== 'claude-haiku-4-5') {
    params.output_config = { effort: 'medium' };
    // Bila model menolak (refusal), API otomatis mencoba model cadangan yang direkomendasikan.
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  const api = params.betas ? client.beta.messages : client.messages;
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    const stream = api.stream(params, { signal: ac.signal });
    stream.on('text', (text) => send(res, { type: 'text', text }));
    const msg = await stream.finalMessage();
    send(res, { type: 'done', stop_reason: msg.stop_reason, model: msg.model });
  } catch (err) {
    if (!ac.signal.aborted) send(res, { type: 'error', message: err?.message || String(err) });
  }
  res.end();
}

/* ------------------------------------------------------------ server */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/health') {
      const ok = !!client && hasCredentials();
      return json(res, 200, { ok: true, ai: ok, reason: ok ? aiReason : client ? 'Set ANTHROPIC_API_KEY lalu restart server' : aiReason, listeners: listeners.size });
    }
    if (url.pathname === '/api/run' && req.method === 'POST') return runAgent(req, res);
    if (url.pathname === '/api/event' && req.method === 'POST') {
      const ev = JSON.parse((await readBody(req)) || '{}');
      broadcast(ev);
      return json(res, 200, { ok: true, delivered: listeners.size });
    }
    if (url.pathname === '/api/events') {
      sse(res);
      res.write(': connected\n\n');
      listeners.add(res);
      req.on('close', () => listeners.delete(res));
      return;
    }

    // file statis
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.normalize(path.join(here, rel));
    if (!file.startsWith(here + path.sep) || rel.includes('node_modules') || rel.includes('/.git')) return json(res, 403, { error: 'forbidden' });
    fs.readFile(file, (err, data) => {
      if (err) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n🏢 Visual Office berjalan di http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`   Mode AI   : ${client && hasCredentials() ? '✅ ' + aiReason : '⚪ ' + (client ? 'ANTHROPIC_API_KEY belum diset' : aiReason)}`);
  console.log(`   Live hook : POST http://localhost:${PORT}/api/event  (lihat hooks/README di README.md)\n`);
});
