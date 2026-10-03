// Vercel Function: GET /api/health
import { status } from '../lib/llm.js';

export default function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  // Fitur live (Claude Code hooks) butuh koneksi SSE yang terus hidup → hanya di server lokal.
  res.end(JSON.stringify({ ok: true, ...status(), live: false, host: 'vercel' }));
}
