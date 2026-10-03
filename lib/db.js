/* =========================================================================
 * lib/db.js — Upstash Redis lewat REST API (pola yang sama dengan SimpananMu
 * dan Gudang-Document): tanpa SDK, cukup fetch. Jalan di Node maupun Edge.
 * KV_REST_API_URL / KV_REST_API_TOKEN terisi otomatis saat Upstash Redis
 * dihubungkan ke project lewat Vercel → Storage.
 * ========================================================================= */

const env = () => (globalThis.process && globalThis.process.env) || {};
// Prefix default Vercel untuk Upstash adalah "KV"; prefix "STORAGE" juga diterima.
const url = () => env().KV_REST_API_URL || env().UPSTASH_REDIS_REST_URL || env().STORAGE_REST_API_URL || env().STORAGE_KV_REST_API_URL || '';
const token = () => env().KV_REST_API_TOKEN || env().UPSTASH_REDIS_REST_TOKEN || env().STORAGE_REST_API_TOKEN || env().STORAGE_KV_REST_API_TOKEN || '';

export const PREFIX = 'visualoffice';
export const hasDb = () => !!(url() && token());
export const dbToken = () => token();

export class DatabaseMissingError extends Error {
  constructor() {
    super('Database belum terhubung. Hubungkan Upstash Redis di Vercel → Storage.');
    this.code = 'db_missing';
    this.status = 503;
  }
}

async function post(path, body) {
  if (!hasDb()) throw new DatabaseMissingError();
  const res = await fetch(url().replace(/\/$/, '') + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json && json.error) throw new Error('Redis: ' + json.error);
  return json;
}

/** Satu perintah, mis. redis('HGET', key, field). */
export const redis = async (...cmd) => (await post('', cmd.map(String))).result;

/** Beberapa perintah dalam satu round trip. */
export async function pipeline(cmds) {
  if (!cmds.length) return [];
  const rows = await post('/pipeline', cmds.map((c) => c.map(String)));
  return rows.map((r) => {
    if (r.error) throw new Error('Redis: ' + r.error);
    return r.result;
  });
}

export const keys = {
  users: `${PREFIX}:users`,
  attempts: (email) => `${PREFIX}:attempts:${email}`,
  office: (email) => `${PREFIX}:u:${email}:office`,
  docs: (email) => `${PREFIX}:u:${email}:docs`,
};
