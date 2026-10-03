/* Handler HTTP (Node req/res) untuk login/logout/me — dipakai Vercel & server lokal. */
import { authConfig, checkCredentials, createSession, sessionCookie, clearCookie, gate } from './auth.js';
import { readJson } from './llm.js';

const isSecure = (req) => (req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
const json = (res, code, obj, headers = {}) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
};

export async function handleLogin(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method Not Allowed' });
  const cfg = authConfig();
  if (!cfg.configured) {
    return json(res, cfg.required ? 503 : 400, {
      error: cfg.required ? 'Login belum dikonfigurasi: set APP_USERNAME dan APP_PASSWORD di Environment Variables, lalu redeploy.' : 'Login tidak aktif (APP_PASSWORD belum diset).',
    });
  }
  let body;
  try { body = await readJson(req, 10_000); } catch { return json(res, 400, { error: 'Data tidak valid' }); }
  const user = await checkCredentials(body.username, body.password);
  if (!user) {
    await new Promise((r) => setTimeout(r, 600)); // perlambat tebak-tebakan password
    return json(res, 401, { error: 'Username atau password salah' });
  }
  const token = await createSession(user);
  return json(res, 200, { ok: true, user }, { 'set-cookie': sessionCookie(token, isSecure(req)) });
}

export async function handleLogout(req, res) {
  res.writeHead(302, { location: '/login.html', 'set-cookie': clearCookie(isSecure(req)), 'cache-control': 'no-store' });
  res.end();
}

export async function handleMe(req, res) {
  const cfg = authConfig();
  const g = await gate('/api/me', req.headers.cookie);
  if (!g.ok) return json(res, 401, { error: 'Belum login' });
  return json(res, 200, { user: g.user, authRequired: cfg.required });
}
