/* =========================================================================
 * lib/accounts.js — akun email + kata sandi di Upstash Redis (Node runtime).
 * Sama seperti SimpananMu: hash scrypt + salt, pendaftaran atomik (HSETNX),
 * maksimal 10 percobaan per email per 15 menit.
 * ========================================================================= */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { redis, keys } from './db.js';

const scryptAsync = promisify(scrypt);
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export class AccountError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const hashPassword = async (password, salt) => (await scryptAsync(password, salt, 64)).toString('hex');

async function matches(password, user) {
  if (!user || !user.salt || !user.hash) return false;
  const a = Buffer.from(await hashPassword(password, user.salt), 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const getUser = async (email) => {
  const raw = await redis('HGET', keys.users, email);
  return raw ? JSON.parse(raw) : null;
};

async function tooManyAttempts(email) {
  const n = await redis('INCR', keys.attempts(email));
  if (n === 1) await redis('EXPIRE', keys.attempts(email), 900);
  return n > 10;
}

function validate(email, password) {
  if (!EMAIL_RE.test(email)) throw new AccountError('Format email tidak valid.');
  if (password.length < 8 || password.length > 200) throw new AccountError('Kata sandi minimal 8 karakter.');
}

/** → { id: email, name } */
export async function login(emailRaw, passwordRaw) {
  const email = String(emailRaw || '').trim().toLowerCase();
  const password = String(passwordRaw || '');
  validate(email, password);
  if (await tooManyAttempts(email)) throw new AccountError('Terlalu banyak percobaan. Coba lagi 15 menit lagi.', 429);
  const user = await getUser(email);
  if (!user || !(await matches(password, user))) throw new AccountError('Email atau kata sandi salah.', 401);
  await redis('DEL', keys.attempts(email));
  return { id: user.email, name: user.name };
}

/** → { id: email, name } */
export async function register(nameRaw, emailRaw, passwordRaw) {
  const email = String(emailRaw || '').trim().toLowerCase();
  const password = String(passwordRaw || '');
  const name = String(nameRaw || '').trim().slice(0, 30);
  if (!name) throw new AccountError('Nama wajib diisi.');
  validate(email, password);
  if (await tooManyAttempts(email)) throw new AccountError('Terlalu banyak percobaan. Coba lagi 15 menit lagi.', 429);
  const salt = randomBytes(16).toString('hex');
  const user = { email, name, salt, hash: await hashPassword(password, salt), created: new Date().toISOString() };
  // HSETNX: dua pendaftaran dengan email sama tidak bisa sama-sama berhasil
  if (!(await redis('HSETNX', keys.users, email, JSON.stringify(user)))) {
    throw new AccountError('Email sudah terdaftar. Silakan masuk.', 409);
  }
  return { id: email, name };
}
