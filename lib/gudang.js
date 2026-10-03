/* =========================================================================
 * lib/gudang.js — membaca data aplikasi Gudang-Document (HANYA BACA).
 *
 * Gudang-Document menyimpan datanya di Upstash Redis yang sama dengan
 * Visual Office, di kunci berawalan "gudang:" (hash per koleksi). Modul ini
 * hanya memakai perintah baca (HGETALL) dan merapikan datanya untuk dipakai
 * agen departemen Gudang. Tanda tangan, foto, dan data akun tidak diambil.
 * ========================================================================= */
import { pipeline, hasDb } from './db.js';

const COLS = ['pos', 'stok', 'grn', 'barang', 'supplier', 'keluar', 'opname', 'config'];
const KEY = (c) => `gudang:${c}`;

const parseHash = (arr) => {
  const out = [];
  for (let i = 0; i < (arr || []).length; i += 2) {
    try { out.push(JSON.parse(arr[i + 1])); } catch { /* lewati data rusak */ }
  }
  return out;
};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const byTimeDesc = (k) => (a, b) => String(b[k] || '').localeCompare(String(a[k] || ''));

/** Ambil & rapikan seluruh data gudang. */
export async function readGudang() {
  if (!hasDb()) {
    const e = new Error('Database belum terhubung, data Gudang-Document tidak bisa dibaca.');
    e.status = 503;
    throw e;
  }
  const rows = await pipeline([...COLS.map((c) => ['HGETALL', KEY(c)]), ['HGETALL', 'gudang:stokqty'], ['GET', 'gudang:ver']]);
  const raw = Object.fromEntries(COLS.map((c, i) => [c, parseHash(rows[i])]));
  const qtyArr = rows[COLS.length] || [];
  const qty = {};
  for (let i = 0; i < qtyArr.length; i += 2) qty[qtyArr[i]] = num(qtyArr[i + 1]);

  const barang = Object.fromEntries(raw.barang.map((b) => [b.sku, b]));
  const settings = (raw.config.find((c) => c && 'toleransi' in c)) || {};

  // Stok: jumlah terbaru ada di hash gudang:stokqty (diubah atomik), metadata di gudang:stok
  const skus = new Set([...raw.stok.map((s) => s.sku), ...Object.keys(qty), ...Object.keys(barang)]);
  const stok = [...skus].filter(Boolean).map((sku) => {
    const meta = raw.stok.find((s) => s.sku === sku) || {};
    const master = barang[sku] || {};
    const q = sku in qty ? qty[sku] : num(meta.qty);
    const min = num(master.minStok);
    return {
      sku,
      nama: master.nama || meta.nama || sku,
      satuan: master.satuan || meta.satuan || '',
      qty: q,
      minStok: min,
      lokasi: master.lokasi || meta.lokasi || '',
      status: q <= 0 ? 'habis' : min && q <= min ? 'menipis' : 'aman',
      update: meta.update || '',
    };
  }).sort((a, b) => a.nama.localeCompare(b.nama));

  const po = raw.pos.map((p) => {
    const diterima = p.diterima || (p.status === 'Diterima' ? Object.fromEntries((p.items || []).map((i) => [i.sku, i.qty])) : {});
    const status = p.status === 'Ditahan' ? 'Terbuka' : p.status;
    const items = (p.items || []).map((i) => ({ sku: i.sku, nama: i.nama, satuan: i.satuan, dipesan: num(i.qty), diterima: num(diterima[i.sku]), sisa: Math.max(0, num(i.qty) - num(diterima[i.sku])) }));
    return { no: p.no, supplier: p.supplier, tanggal: p.tanggal, status, items, catatan: p.catatan || '', jumlahGRN: (p.grns || (p.grn ? [p.grn] : [])).length };
  }).sort(byTimeDesc('tanggal'));

  const grn = raw.grn.map((g) => ({
    no: g.no, poNo: g.poNo, supplier: g.supplier, waktu: g.waktu, petugas: g.petugas, hasil: g.hasil, keputusan: g.keputusan,
    sjNo: g.sjNo || '', catatan: g.catatan || '', disetujuiOleh: g.disetujuiOleh || '',
    items: (g.items || []).map((r) => ({ sku: r.sku, nama: r.nama, satuan: r.satuan, sj: r.sj, fisik: num(r.fisik), rusak: num(r.rusak), baik: num(r.baik), status: r.status, catatan: (r.notes || []).join('; ') })),
  })).sort(byTimeDesc('waktu'));

  const keluar = raw.keluar.map((k) => ({
    no: k.no, waktu: k.waktu, petugas: k.petugas, tujuan: k.tujuan, referensi: k.referensi || '', catatan: k.catatan || '',
    items: (k.items || []).map((i) => ({ sku: i.sku, nama: i.nama, satuan: i.satuan, qty: num(i.qty) })),
  })).sort(byTimeDesc('waktu'));

  const opname = raw.opname.map((o) => ({
    no: o.no, waktu: o.waktu, petugas: o.petugas, jenis: o.jenis, status: o.status, catatan: o.catatan || '', diputusOleh: o.diputusOleh || '',
    items: (o.items || []).map((i) => ({ sku: i.sku, nama: i.nama, satuan: i.satuan, sistem: num(i.sistem), fisik: num(i.fisik), selisih: num(i.selisih) })),
  })).sort(byTimeDesc('waktu'));

  const supplier = raw.supplier.map((s) => ({ nama: s.nama, kontak: s.kontak || '', telepon: s.telepon || '' }));

  return {
    sumber: 'Gudang-Document',
    diambil: new Date().toISOString(),
    versi: Number(rows[COLS.length + 1]) || 0,
    toleransiSelisih: num(settings.toleransi),
    ringkasan: {
      jenisBarang: stok.length,
      stokMenipis: stok.filter((s) => s.status === 'menipis').length,
      stokHabis: stok.filter((s) => s.status === 'habis').length,
      poTerbuka: po.filter((p) => p.status === 'Terbuka').length,
      poSebagian: po.filter((p) => p.status === 'Sebagian').length,
      grn: grn.length,
      grnDitahan: grn.filter((g) => g.keputusan === 'Ditahan' || (g.hasil === 'Ditahan' && !g.disetujuiOleh)).length,
      barangKeluar: keluar.length,
      opnameMenunggu: opname.filter((o) => o.status === 'Menunggu').length,
      supplier: supplier.length,
    },
    stok, po, grn, keluar, opname, supplier,
  };
}
