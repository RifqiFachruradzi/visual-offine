/* =========================================================================
 * publicapi.js — data publik gratis (tanpa API key) dari daftar
 * github.com/public-apis/public-apis, HANYA BACA, untuk konteks tugas agen:
 *   - kurs   : Frankfurter (kurs ECB) — 1 mata uang asing = berapa Rupiah, tren USD 30 hari
 *   - libur  : Nager.Date — hari libur nasional Indonesia (tahun ini & depan)
 *   - cuaca  : Open-Meteo — cuaca sekarang & prakiraan 7 hari untuk kota (WEATHER_CITY)
 *   - publik : gabungan ketiganya
 * Hasil di-cache di memori server 10 menit agar hemat kuota API publik.
 * ========================================================================= */

const TTL = 10 * 60 * 1000;
const cache = new Map();
const CURRENCIES = ['USD', 'EUR', 'SGD', 'MYR', 'CNY', 'JPY', 'AUD', 'GBP', 'SAR'];

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'visual-office/1.0' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} dari ${new URL(url).host}`);
  return r.json();
}

const ymd = (d) => d.toISOString().slice(0, 10);

export async function readKurs() {
  const latest = await getJson(`https://api.frankfurter.app/latest?from=IDR&to=${CURRENCIES.join(',')}`);
  const kurs = CURRENCIES.filter((c) => latest.rates && latest.rates[c]).map((c) => ({ mataUang: c, rupiah: Math.round((1 / latest.rates[c]) * 100) / 100 }));
  const end = new Date(), start = new Date(Date.now() - 30 * 864e5);
  let trenUSD = [];
  try {
    const ts = await getJson(`https://api.frankfurter.app/${ymd(start)}..${ymd(end)}?from=USD&to=IDR`);
    trenUSD = Object.entries(ts.rates || {}).map(([tanggal, r]) => ({ tanggal, rupiah: r.IDR })).sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  } catch { /* tren opsional */ }
  const first = trenUSD[0], last = trenUSD[trenUSD.length - 1];
  return {
    sumber: 'Frankfurter (kurs referensi Bank Sentral Eropa)',
    tanggalKurs: latest.date,
    kurs,
    trenUSD,
    perubahanUSD30Hari: first && last ? { dari: first.rupiah, ke: last.rupiah, persen: Math.round(((last.rupiah - first.rupiah) / first.rupiah) * 10000) / 100 } : null,
  };
}

export async function readLibur() {
  const now = new Date(), y = now.getFullYear();
  const [a, b] = await Promise.all([getJson(`https://date.nager.at/api/v3/PublicHolidays/${y}/ID`), getJson(`https://date.nager.at/api/v3/PublicHolidays/${y + 1}/ID`).catch(() => [])]);
  const all = [...a, ...b].map((h) => ({ tanggal: h.date, nama: h.localName || h.name, namaInggris: h.name }));
  const today = ymd(now);
  const mendatang = all.filter((h) => h.tanggal >= today).slice(0, 12).map((h) => ({ ...h, hariLagi: Math.round((new Date(h.tanggal) - new Date(today)) / 864e5) }));
  return { sumber: 'Nager.Date (hari libur nasional Indonesia)', hariIni: today, mendatang, tahunIni: all.filter((h) => h.tanggal.startsWith(String(y))) };
}

const WMO = {
  0: 'Cerah', 1: 'Cerah berawan', 2: 'Berawan sebagian', 3: 'Berawan', 45: 'Berkabut', 48: 'Kabut beku',
  51: 'Gerimis ringan', 53: 'Gerimis', 55: 'Gerimis lebat', 61: 'Hujan ringan', 63: 'Hujan sedang', 65: 'Hujan lebat',
  66: 'Hujan beku ringan', 67: 'Hujan beku', 71: 'Salju ringan', 73: 'Salju', 75: 'Salju lebat', 80: 'Hujan lokal ringan',
  81: 'Hujan lokal', 82: 'Hujan lokal lebat', 95: 'Badai petir', 96: 'Badai petir + es', 99: 'Badai petir hebat',
};

export async function readCuaca(city) {
  const name = String(city || process.env.WEATHER_CITY || 'Jakarta').slice(0, 60);
  const geo = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=id&format=json`);
  const loc = geo.results && geo.results[0];
  if (!loc) throw Object.assign(new Error(`Kota "${name}" tidak ditemukan (atur WEATHER_CITY)`), { status: 400 });
  const f = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
    '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&timezone=auto&forecast_days=7');
  const d = f.daily || {};
  return {
    sumber: 'Open-Meteo (prakiraan cuaca)',
    kota: [loc.name, loc.admin1, loc.country].filter(Boolean).join(', '),
    sekarang: f.current ? { suhu: f.current.temperature_2m, kelembapan: f.current.relative_humidity_2m, angin: f.current.wind_speed_10m, kondisi: WMO[f.current.weather_code] || 'Kode ' + f.current.weather_code, waktu: f.current.time } : null,
    prakiraan: (d.time || []).map((t, i) => ({
      tanggal: t, kondisi: WMO[d.weather_code[i]] || 'Kode ' + d.weather_code[i], suhuMin: d.temperature_2m_min[i], suhuMaks: d.temperature_2m_max[i],
      hujanMm: d.precipitation_sum[i], peluangHujan: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null,
    })),
  };
}

const READERS = { kurs: () => readKurs(), libur: () => readLibur(), cuaca: (o) => readCuaca(o.city) };

/** kind: kurs | libur | cuaca | publik (gabungan). Bagian yang gagal dilaporkan, tidak menggagalkan semuanya. */
export async function readPublic(kind, opts = {}) {
  if (kind !== 'publik' && !READERS[kind]) throw Object.assign(new Error('Jenis data tidak dikenal: ' + kind), { status: 400 });
  const key = kind + '|' + (opts.city || '');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  let v;
  if (kind === 'publik') {
    const parts = await Promise.allSettled([readKurs(), readLibur(), readCuaca(opts.city)]);
    const [kurs, libur, cuaca] = parts.map((p) => (p.status === 'fulfilled' ? p.value : { error: p.reason.message }));
    if (parts.every((p) => p.status === 'rejected')) throw Object.assign(new Error('Semua API publik gagal: ' + parts.map((p) => p.reason.message).join('; ')), { status: 502 });
    v = { kurs, libur, cuaca };
  } else v = await READERS[kind](opts);
  v.diambil = new Date().toISOString();
  cache.set(key, { t: Date.now(), v });
  return v;
}
