/* =========================================================================
 * lib/minimarket.js — membaca data aplikasi MiniMarket (HANYA BACA).
 *
 * MiniMarket menyimpan datanya di Turso/libSQL (SQLite). Visual Office
 * terhubung ke database yang sama dan menjalankan kueri SELECT tetap di
 * dalam transaksi baca-saja (batch mode "read"), sehingga tidak ada data
 * MiniMarket yang bisa berubah. Data akun pengguna & password tidak dibaca.
 *
 * Environment variables (salah satu):
 *   MINIMARKET_DATABASE_URL + MINIMARKET_AUTH_TOKEN      (disarankan: token read-only)
 *   MINIMARKET_TURSO_DATABASE_URL + MINIMARKET_TURSO_AUTH_TOKEN  (integrasi Vercel × Turso, prefix MINIMARKET)
 * URL lokal "file:/path/minimarket.db" juga didukung untuk pengembangan.
 * ========================================================================= */

const env = () => (globalThis.process && globalThis.process.env) || {};
const dbUrl = () => env().MINIMARKET_DATABASE_URL || env().MINIMARKET_TURSO_DATABASE_URL || env().MINIMARKET_URL || '';
const dbToken = () => env().MINIMARKET_AUTH_TOKEN || env().MINIMARKET_TURSO_AUTH_TOKEN || env().MINIMARKET_TOKEN || '';
export const hasMinimarket = () => !!dbUrl();

let client = null;
async function getClient() {
  if (!client) {
    const { createClient } = await import('@libsql/client');
    client = createClient({ url: dbUrl(), authToken: dbToken() || undefined });
  }
  return client;
}

const rowsOf = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, typeof r[i] === 'bigint' ? Number(r[i]) : r[i]])));
const n = (v) => Number(v) || 0;
const addDays = (iso, d) => {
  const t = new Date(iso + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

/** Ambil & rapikan data MiniMarket. Semua uang dalam Rupiah (integer). */
export async function readMinimarket() {
  if (!hasMinimarket()) {
    const e = new Error('MiniMarket belum terhubung: set MINIMARKET_DATABASE_URL & MINIMARKET_AUTH_TOKEN (token Turso read-only), lalu redeploy.');
    e.status = 503;
    throw e;
  }
  const db = await getClient();

  // Tanggal acuan = tanggal transaksi penjualan terakhir (data contoh bisa saja tidak sampai hari ini)
  const [refRs] = await db.batch([{ sql: 'SELECT max(date) AS d FROM sales', args: [] }], 'read');
  const ref = (refRs.rows[0] && refRs.rows[0][0]) || new Date().toISOString().slice(0, 10);
  const monthStart = ref.slice(0, 8) + '01';
  const d30 = addDays(ref, -29);

  const q = (sql, args = []) => ({ sql, args });
  const rs = await db.batch(
    [
      q('SELECT count(*) AS trx, coalesce(sum(total),0) AS omzet, coalesce(sum(cogs),0) AS hpp FROM sales WHERE date = ?', [ref]),
      q('SELECT count(*) AS trx, coalesce(sum(total),0) AS omzet, coalesce(sum(cogs),0) AS hpp, coalesce(sum(discount),0) AS diskon FROM sales WHERE date BETWEEN ? AND ?', [monthStart, ref]),
      q('SELECT date, count(*) AS trx, sum(total) AS omzet, sum(cogs) AS hpp FROM sales WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date', [d30, ref]),
      q('SELECT sku, name, category, unit, stock, min_stock, avg_cost, sell_price, stock_value, is_active FROM products ORDER BY name'),
      q(`SELECT p.sku, p.name, p.unit, sum(si.qty) AS qty, sum(si.subtotal) AS omzet, sum(si.subtotal - si.unit_cost * si.qty) AS laba
         FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
         WHERE s.date BETWEEN ? AND ? GROUP BY p.id ORDER BY qty DESC`, [d30, ref]),
      q(`SELECT a.code, a.name, coalesce(sum(l.debit - l.credit), 0) AS saldo
         FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id WHERE a.is_cash = 1 GROUP BY a.id ORDER BY a.code`),
      q(`SELECT s.number, s.date, coalesce(c.name, '-') AS pelanggan, s.total, s.amount_paid, (s.total - s.amount_paid) AS sisa
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.status != 'paid' ORDER BY s.date LIMIT 40`),
      q(`SELECT g.number, g.date, g.due_date, sp.name AS pemasok, g.total, g.amount_paid, (g.total - g.amount_paid) AS sisa
         FROM goods_receipts g JOIN suppliers sp ON sp.id = g.supplier_id WHERE g.status != 'paid' ORDER BY g.due_date LIMIT 40`),
      q(`SELECT a.code, a.name, a.type, a.report_group AS grp, coalesce(sum(l.debit),0) AS debit, coalesce(sum(l.credit),0) AS kredit
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
         WHERE e.date BETWEEN ? AND ? AND a.type IN ('revenue','expense') GROUP BY a.id ORDER BY a.code`, [monthStart, ref]),
      q(`SELECT g.number, g.date, sp.name AS pemasok, g.total, g.status FROM goods_receipts g JOIN suppliers sp ON sp.id = g.supplier_id ORDER BY g.date DESC LIMIT 10`),
      q('SELECT number, date, reason, total_cost, note FROM goods_issues ORDER BY date DESC LIMIT 10'),
      q(`SELECT a.number, a.date, p.name AS produk, a.system_qty, a.physical_qty, a.difference, a.value
         FROM stock_adjustments a JOIN products p ON p.id = a.product_id ORDER BY a.date DESC LIMIT 10`),
      q('SELECT payment_type, count(*) AS trx, coalesce(sum(total),0) AS omzet FROM sales WHERE date BETWEEN ? AND ? GROUP BY payment_type', [monthStart, ref]),
      q(`SELECT a.code, a.name, a.type, coalesce(sum(l.debit - l.credit), 0) AS saldo
         FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id WHERE a.code IN ('1-1400','1-1500','2-1100') GROUP BY a.id`),
      q(`SELECT (SELECT count(*) FROM sales WHERE status != 'paid') AS piutang_n, (SELECT coalesce(sum(total - amount_paid),0) FROM sales WHERE status != 'paid') AS piutang,
                (SELECT count(*) FROM goods_receipts WHERE status != 'paid') AS hutang_n, (SELECT coalesce(sum(total - amount_paid),0) FROM goods_receipts WHERE status != 'paid') AS hutang`),
    ],
    'read'
  );
  const [today, month, daily, products, top, cash, piutang, hutang, pl, receipts, issues, adjustments, payTypes, keyAcc, [totals]] = rs.map(rowsOf);

  const produk = products.map((p) => ({
    sku: p.sku, nama: p.name, kategori: p.category, satuan: p.unit, stok: n(p.stock), minStok: n(p.min_stock),
    hpp: n(p.avg_cost), hargaJual: n(p.sell_price), nilaiStok: n(p.stock_value), aktif: !!n(p.is_active),
    status: n(p.stock) <= 0 ? 'habis' : n(p.min_stock) && n(p.stock) <= n(p.min_stock) ? 'menipis' : 'aman',
  }));
  const kategori = {};
  for (const p of produk) kategori[p.kategori] = (kategori[p.kategori] || 0) + p.nilaiStok;

  const pendapatan = pl.filter((r) => r.type === 'revenue').map((r) => ({ akun: r.name, kelompok: r.grp, jumlah: n(r.kredit) - n(r.debit) }));
  const beban = pl.filter((r) => r.type === 'expense').map((r) => ({ akun: r.name, kelompok: r.grp, jumlah: n(r.debit) - n(r.kredit) }));
  const sum = (arr, f = () => true) => arr.filter(f).reduce((a, r) => a + r.jumlah, 0);
  const totalPendapatan = sum(pendapatan, (r) => r.kelompok === 'operating');
  const hppBulan = sum(beban, (r) => r.kelompok === 'cogs');
  const bebanOps = sum(beban, (r) => r.kelompok === 'operating');
  const lainNet = sum(pendapatan, (r) => r.kelompok === 'other') - sum(beban, (r) => r.kelompok === 'other');
  const labaKotor = totalPendapatan - hppBulan;
  const labaBersih = labaKotor - bebanOps + lainNet;

  const soldSku = new Set(top.map((t) => t.sku));
  const tidakLaku = produk.filter((p) => p.aktif && !soldSku.has(p.sku)).map((p) => p.nama);

  return {
    sumber: 'MiniMarket',
    diambil: new Date().toISOString(),
    tanggalAcuan: ref,
    periodeBulan: { dari: monthStart, sampai: ref },
    ringkasan: {
      penjualanHariIni: { trx: n(today[0].trx), omzet: n(today[0].omzet), labaKotor: n(today[0].omzet) - n(today[0].hpp) },
      penjualanBulanIni: { trx: n(month[0].trx), omzet: n(month[0].omzet), hpp: n(month[0].hpp), diskon: n(month[0].diskon), labaKotor: n(month[0].omzet) - n(month[0].hpp) },
      jumlahProduk: produk.length,
      stokHabis: produk.filter((p) => p.status === 'habis').length,
      stokMenipis: produk.filter((p) => p.status === 'menipis').length,
      nilaiPersediaan: produk.reduce((a, p) => a + p.nilaiStok, 0),
      saldoKasBank: cash.reduce((a, c) => a + n(c.saldo), 0),
      piutang: n(totals.piutang),
      jumlahPiutangBelumLunas: n(totals.piutang_n),
      hutang: n(totals.hutang),
      jumlahHutangBelumLunas: n(totals.hutang_n),
    },
    labaRugiBulanIni: { pendapatan, beban, totalPendapatan, hpp: hppBulan, labaKotor, bebanOperasional: bebanOps, pendapatanBebanLain: lainNet, labaBersih },
    penjualanHarian: daily.map((d) => ({ tanggal: d.date, trx: n(d.trx), omzet: n(d.omzet), labaKotor: n(d.omzet) - n(d.hpp) })),
    metodeBayarBulanIni: payTypes.map((p) => ({ metode: p.payment_type === 'cash' ? 'tunai/transfer' : 'kredit', trx: n(p.trx), omzet: n(p.omzet) })),
    produkTerlaris30Hari: top.slice(0, 10).map((t) => ({ sku: t.sku, nama: t.name, qty: n(t.qty), satuan: t.unit, omzet: n(t.omzet), labaKotor: n(t.laba) })),
    produkTidakLaku30Hari: tidakLaku,
    produk,
    nilaiPersediaanPerKategori: Object.entries(kategori).map(([k, v]) => ({ kategori: k, nilai: v })).sort((a, b) => b.nilai - a.nilai),
    kasBank: cash.map((c) => ({ akun: c.name, saldo: n(c.saldo) })),
    piutangBelumLunas: piutang.map((r) => ({ no: r.number, tanggal: r.date, pelanggan: r.pelanggan, total: n(r.total), dibayar: n(r.amount_paid), sisa: n(r.sisa) })),
    hutangBelumLunas: hutang.map((r) => ({ no: r.number, tanggal: r.date, jatuhTempo: r.due_date, pemasok: r.pemasok, total: n(r.total), dibayar: n(r.amount_paid), sisa: n(r.sisa) })),
    penerimaanBarangTerbaru: receipts.map((r) => ({ no: r.number, tanggal: r.date, pemasok: r.pemasok, total: n(r.total), status: r.status })),
    pengeluaranBarangTerbaru: issues.map((r) => ({ no: r.number, tanggal: r.date, alasan: r.reason, nilai: n(r.total_cost), catatan: r.note || '' })),
    stockOpnameTerbaru: adjustments.map((r) => ({ no: r.number, tanggal: r.date, produk: r.produk, sistem: n(r.system_qty), fisik: n(r.physical_qty), selisih: n(r.difference), nilai: n(r.value) })),
    saldoAkunUtama: keyAcc.map((a) => ({ akun: a.name, saldo: a.type === 'liability' ? -n(a.saldo) : n(a.saldo) })),
  };
}
