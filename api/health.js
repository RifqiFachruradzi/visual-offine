// Vercel Function: GET /api/health
import { status } from '../lib/llm.js';
import { gate } from '../lib/auth.js';

export default async function handler(req, res) {
  if (!(await gate('/api/health', req.headers.cookie)).ok) { res.statusCode = 401; return res.end('{"error":"Belum login"}'); }
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  // Fitur live (Claude Code hooks) butuh koneksi SSE yang terus hidup → hanya di server lokal.
  res.end(JSON.stringify({ ok: true, ...status(), live: false, host: 'vercel' }));
}
