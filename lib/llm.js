/* =========================================================================
 * lib/llm.js — lapisan LLM bersama untuk server lokal (server.js) dan
 * Vercel Functions (api/*.js).
 *
 * Provider:
 *   - Gemini (default, ada free tier)  → GEMINI_API_KEY (atau GOOGLE_API_KEY)
 *   - Claude (opsional)                → ANTHROPIC_API_KEY
 * Model dipilih per agen; provider ditentukan dari prefix nama model.
 * ========================================================================= */

export const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-pro-latest'];
export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'];
const DEFAULT_GEMINI = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const MAX_OUTPUT = Number(process.env.LLM_MAX_OUTPUT_TOKENS || 2048);

const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const anthropicKey = () => process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '';

let gemini, claude;
async function geminiClient() {
  if (!gemini) {
    const { GoogleGenAI } = await import('@google/genai');
    gemini = new GoogleGenAI({ apiKey: geminiKey() });
  }
  return gemini;
}
async function claudeClient() {
  if (!claude) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    claude = new Anthropic();
  }
  return claude;
}

export function status() {
  const providers = [];
  if (geminiKey()) providers.push('gemini');
  if (anthropicKey()) providers.push('claude');
  return {
    ai: providers.length > 0,
    providers,
    defaultModel: geminiKey() ? DEFAULT_GEMINI : anthropicKey() ? 'claude-opus-5-5' : null,
    reason: providers.length
      ? 'AI siap: ' + providers.map((p) => (p === 'gemini' ? 'Gemini' : 'Claude')).join(' + ')
      : 'Set GEMINI_API_KEY (gratis dari Google AI Studio) lalu restart / redeploy',
  };
}

// Pilih model yang benar-benar bisa dipakai dengan kunci yang tersedia.
function resolveModel(model) {
  const m = String(model || '');
  if (CLAUDE_MODELS.includes(m) && anthropicKey()) return { provider: 'claude', model: m };
  if (m.startsWith('gemini-') && geminiKey()) return { provider: 'gemini', model: m };
  if (geminiKey()) return { provider: 'gemini', model: DEFAULT_GEMINI };
  if (anthropicKey()) return { provider: 'claude', model: CLAUDE_MODELS.includes(m) ? m : 'claude-opus-5-5' };
  return null;
}

export class LLMError extends Error {
  constructor(message, status = 500, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// Pesan error Gemini sering berupa JSON bersarang — ambil pesan terdalam.
function cleanMessage(msg) {
  let m = String(msg || '');
  for (let i = 0; i < 4; i++) {
    try {
      const j = JSON.parse(m);
      const inner = j?.error?.message;
      if (!inner) break;
      m = String(inner);
    } catch { break; }
  }
  return m;
}

function wrapError(err) {
  const status = err?.status || err?.code || (/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(err?.message || '') ? 429 : 500);
  const m = /retry in ([\d.]+)s/i.exec(err?.message || '') || /"retryDelay":\s*"(\d+)s"/.exec(err?.message || '');
  const retryAfter = m ? Math.ceil(parseFloat(m[1])) : status === 429 ? 20 : 0;
  const short = status === 429 ? 'Kuota/rate limit gratis tercapai' : cleanMessage(err?.message || String(err)).slice(0, 300);
  return new LLMError(short, Number(status) || 500, retryAfter);
}

/**
 * Jalankan satu agen dengan streaming. onText(chunk) dipanggil per potongan.
 * Resolve { model, stopReason }.
 */
export async function runStream({ model, system, prompt }, onText, signal) {
  const pick = resolveModel(model);
  if (!pick) throw new LLMError(status().reason, 503);
  system = String(system || '').slice(0, 12000);
  prompt = String(prompt || '').slice(0, 60000);
  if (!prompt) throw new LLMError('prompt kosong', 400);

  try {
    if (pick.provider === 'gemini') {
      const ai = await geminiClient();
      const stream = await ai.models.generateContentStream({
        model: pick.model,
        contents: prompt,
        config: { systemInstruction: system || undefined, maxOutputTokens: MAX_OUTPUT, abortSignal: signal },
      });
      let finish = null;
      for await (const chunk of stream) {
        if (signal?.aborted) break;
        const t = chunk.text;
        if (t) onText(t);
        finish = chunk.candidates?.[0]?.finishReason || finish;
      }
      return { model: pick.model, stopReason: finish };
    }

    // Claude (opsional)
    const client = await claudeClient();
    const params = { model: pick.model, max_tokens: MAX_OUTPUT, system, messages: [{ role: 'user', content: prompt }] };
    if (pick.model !== 'claude-haiku-4-5') {
      params.output_config = { effort: 'medium' };
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }
    const api = params.betas ? client.beta.messages : client.messages;
    const stream = api.stream(params, { signal });
    stream.on('text', onText);
    const msg = await stream.finalMessage();
    return { model: msg.model, stopReason: msg.stop_reason };
  } catch (err) {
    if (signal?.aborted) return { model: pick.model, stopReason: 'aborted' };
    throw wrapError(err);
  }
}

/* ------------------------------------------------------------ helper HTTP (Node req/res) */
export async function readJson(req, limit = 1_000_000) {
  if (req.body && typeof req.body === 'object') return req.body; // Vercel sudah mem-parse
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new LLMError('Body terlalu besar', 413);
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

// Handler /api/run yang sama untuk server lokal & Vercel → respons SSE.
export async function handleRun(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed'); }
  let body;
  try { body = await readJson(req); } catch { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":"JSON tidak valid"}'); }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    const r = await runStream(body, (text) => send({ type: 'text', text }), ac.signal);
    send({ type: 'done', stop_reason: r.stopReason, model: r.model });
  } catch (err) {
    if (!ac.signal.aborted) send({ type: 'error', message: err.message, status: err.status || 500, retryAfter: err.retryAfter || 0 });
  }
  res.end();
}
