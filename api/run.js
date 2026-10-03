// Vercel Function: POST /api/run → streaming SSE hasil kerja satu agen
import { handleRun } from '../lib/llm.js';

export default function handler(req, res) {
  return handleRun(req, res);
}
