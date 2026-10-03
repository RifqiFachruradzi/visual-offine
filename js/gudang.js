/* =========================================================================
 * gudang.js — integrasi departemen Gudang dengan aplikasi Gudang-Document.
 *   - Template departemen Gudang (Kepala Gudang, Analis Stok, dst.)
 *   - Menarik data Gudang-Document (HANYA BACA) lewat /api/gudang saat
 *     departemen Gudang mengerjakan tugas, lalu menyisipkannya ke prompt agen.
 *   - Laporan otomatis dari data bila mode AI mati (simulasi).
 * ========================================================================= */
(function () {
  const VO = window.VO;
  const gd = (VO.gudang = {});

  gd.TEMPLATE = {
    name: 'Gudang',
    roles: [
      { role: 'Kepala Gudang', isLead: true, style: 'suit', prompt: 'Kamu memimpin departemen Gudang. Kamu menyusun laporan final yang akurat untuk Boss berdasarkan data Gudang-Document: ringkasan kondisi gudang, temuan penting, risiko, dan rekomendasi tindakan yang konkret.' },
      { role: 'Analis Stok', style: 'shirt', prompt: 'Fokus pada data stok: barang habis, stok di bawah minimum, perputaran dan pergerakan stok (masuk vs keluar), lokasi rak, serta rekomendasi jumlah pemesanan ulang.' },
      { role: 'Admin PO & Penerimaan', style: 'shirt', prompt: 'Fokus pada purchase order dan penerimaan barang (GRN): PO terbuka/sebagian beserta sisa barang, GRN ditahan dan penyebabnya, selisih surat jalan vs fisik, barang rusak, dan kinerja supplier.' },
      { role: 'Petugas Barang Keluar & Opname', style: 'cardigan', prompt: 'Fokus pada barang keluar (tujuan, jumlah, barang paling sering keluar) dan stok opname/penyesuaian (selisih, jenis penyesuaian, yang masih menunggu persetujuan).' },
    ],
  };

  // Departemen yang terhubung ke Gudang-Document
  gd.deptOf = (s, ent) => {
    const d = s.departments.find((x) => x.id === ent.deptId);
    return d && d.integration === 'gudang' ? d : null;
  };

  gd.fetch = async function () {
    if (location.protocol === 'file:') throw new Error('Butuh server (npm start / Vercel) untuk membaca Gudang-Document');
    const r = await fetch('/api/gudang', { cache: 'no-store' });
    if (r.status === 401) { location.href = '/login.html'; throw new Error('Sesi habis'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    return j;
  };

  // Satu kali tarik data per tugas (dipakai bersama oleh semua anggota tim)
  const cache = new Map();
  gd.forTask = function (task) {
    if (!cache.has(task.id)) {
      const p = gd.fetch().catch((e) => ({ error: e.message }));
      cache.set(task.id, p);
      setTimeout(() => cache.delete(task.id), 10 * 60 * 1000);
    }
    return cache.get(task.id);
  };

  const fmtTime = (iso) => { try { return new Date(iso).toLocaleString('id-ID'); } catch { return iso; } };

  /** Data → markdown ringkas untuk konteks AI (dibatasi agar muat di prompt). */
  gd.toMarkdown = function (d) {
    const r = d.ringkasan;
    const L = [];
    L.push(`Sumber: aplikasi Gudang-Document, diambil ${fmtTime(d.diambil)}. Toleransi selisih penerimaan: ${d.toleransiSelisih}%.`);
    L.push(`Ringkasan: ${r.jenisBarang} jenis barang (${r.stokHabis} habis, ${r.stokMenipis} menipis) · PO terbuka ${r.poTerbuka}, sebagian ${r.poSebagian} · ${r.grn} GRN (${r.grnDitahan} ditahan) · ${r.barangKeluar} transaksi barang keluar · opname menunggu ${r.opnameMenunggu} · ${r.supplier} supplier.`);

    L.push('\n## Stok (sku | nama | qty satuan | min | lokasi | status)');
    for (const s of d.stok.slice(0, 150)) L.push(`- ${s.sku} | ${s.nama} | ${s.qty} ${s.satuan} | min ${s.minStok || '-'} | ${s.lokasi || '-'} | ${s.status}`);
    if (d.stok.length > 150) L.push(`- …dan ${d.stok.length - 150} barang lain`);

    const openPO = d.po.filter((p) => p.status === 'Terbuka' || p.status === 'Sebagian');
    const otherPO = d.po.filter((p) => !openPO.includes(p)).slice(0, 15);
    L.push('\n## PO terbuka / sebagian (sisa = belum diterima)');
    if (!openPO.length) L.push('- (tidak ada)');
    for (const p of openPO) L.push(`- ${p.no} | ${p.supplier} | ${p.tanggal} | ${p.status} | ` + p.items.map((i) => `${i.nama}: dipesan ${i.dipesan}, diterima ${i.diterima}, sisa ${i.sisa} ${i.satuan}`).join('; '));
    if (otherPO.length) {
      L.push('\n## PO lain terbaru');
      for (const p of otherPO) L.push(`- ${p.no} | ${p.supplier} | ${p.tanggal} | ${p.status} | ${p.items.length} item`);
    }

    L.push('\n## Penerimaan barang / GRN terbaru');
    if (!d.grn.length) L.push('- (belum ada)');
    for (const g of d.grn.slice(0, 25)) {
      const issues = g.items.filter((i) => i.status !== 'sesuai' || i.rusak).map((i) => `${i.nama} (fisik ${i.fisik}, rusak ${i.rusak}${i.sj != null ? ', SJ ' + i.sj : ''}${i.catatan ? ', ' + i.catatan : ''})`);
      L.push(`- ${g.no} | PO ${g.poNo} | ${g.supplier} | ${fmtTime(g.waktu)} | ${g.keputusan || g.hasil}${g.disetujuiOleh ? ' oleh ' + g.disetujuiOleh : ''}${issues.length ? ' | catatan: ' + issues.join('; ') : ''}`);
    }

    L.push('\n## Barang keluar terbaru');
    if (!d.keluar.length) L.push('- (belum ada)');
    for (const k of d.keluar.slice(0, 25)) L.push(`- ${k.no} | ${fmtTime(k.waktu)} | ke ${k.tujuan}${k.referensi ? ' (' + k.referensi + ')' : ''} | ` + k.items.map((i) => `${i.nama} ${i.qty} ${i.satuan}`).join(', '));

    L.push('\n## Stok opname / penyesuaian terbaru');
    if (!d.opname.length) L.push('- (belum ada)');
    for (const o of d.opname.slice(0, 15)) L.push(`- ${o.no} | ${fmtTime(o.waktu)} | ${o.jenis} | ${o.status} | ` + o.items.map((i) => `${i.nama}: sistem ${i.sistem}, fisik ${i.fisik}, selisih ${i.selisih}`).join('; '));

    if (d.supplier.length) L.push('\n## Supplier\n' + d.supplier.map((s) => `- ${s.nama}${s.kontak ? ' (' + s.kontak + (s.telepon ? ', ' + s.telepon : '') + ')' : ''}`).join('\n'));
    return L.join('\n').slice(0, 24000);
  };

  /** Tambahkan data gudang ke prompt agen departemen Gudang. */
  gd.augment = async function (task, prompt) {
    const d = await gd.forTask(task);
    if (d.error) return `${prompt}\n\nCATATAN: data Gudang-Document gagal diambil (${d.error}). Sampaikan hal ini di laporanmu dan jangan mengarang angka.`;
    return `${prompt}\n\n=== DATA GUDANG-DOCUMENT (real-time, hanya baca) ===\n${gd.toMarkdown(d)}\n=== AKHIR DATA ===\n\nAturan: gunakan HANYA data di atas sebagai fakta. Sebutkan nomor dokumen (PO/GRN/BK) dan angka yang relevan. Jika data yang dibutuhkan tidak ada, katakan tidak tersedia — jangan mengarang.`;
  };

  /** Laporan tanpa AI (mode simulasi): dihitung langsung dari data. */
  gd.simReport = function (d, title) {
    if (d.error) return `> Data Gudang-Document gagal diambil: ${d.error}`;
    const r = d.ringkasan;
    const L = [`# Laporan Gudang: ${title}`, '', `_Sumber: Gudang-Document · diambil ${fmtTime(d.diambil)} · dihitung otomatis (mode simulasi, tanpa AI)_`, ''];
    L.push('## 1. Ringkasan', `- ${r.jenisBarang} jenis barang: **${r.stokHabis} habis**, **${r.stokMenipis} menipis**`, `- PO terbuka: ${r.poTerbuka}, diterima sebagian: ${r.poSebagian}`, `- GRN: ${r.grn} (ditahan: ${r.grnDitahan})`, `- Barang keluar: ${r.barangKeluar} transaksi`, `- Opname menunggu persetujuan: ${r.opnameMenunggu}`, '');
    const kritis = d.stok.filter((s) => s.status !== 'aman');
    L.push('## 2. Stok perlu perhatian');
    if (!kritis.length) L.push('Semua stok di atas batas minimum.');
    else { L.push('| SKU | Barang | Stok | Min | Lokasi | Status |', '|---|---|---|---|---|---|'); for (const s of kritis) L.push(`| ${s.sku} | ${s.nama} | ${s.qty} ${s.satuan} | ${s.minStok || '-'} | ${s.lokasi || '-'} | ${s.status} |`); }
    L.push('');
    const openPO = d.po.filter((p) => p.status === 'Terbuka' || p.status === 'Sebagian');
    L.push('## 3. PO belum selesai');
    if (!openPO.length) L.push('Tidak ada PO terbuka.');
    else { L.push('| No PO | Supplier | Tanggal | Status | Sisa barang |', '|---|---|---|---|---|'); for (const p of openPO) L.push(`| ${p.no} | ${p.supplier} | ${p.tanggal} | ${p.status} | ${p.items.filter((i) => i.sisa > 0).map((i) => `${i.nama} ${i.sisa} ${i.satuan}`).join(', ') || '-'} |`); }
    L.push('');
    const tahan = d.grn.filter((g) => (g.keputusan || g.hasil) === 'Ditahan');
    L.push('## 4. GRN ditahan');
    L.push(tahan.length ? tahan.map((g) => `- ${g.no} (PO ${g.poNo}, ${g.supplier})`).join('\n') : 'Tidak ada GRN yang ditahan.');
    return L.join('\n');
  };

  /** Uji koneksi untuk Inspector */
  gd.test = async function () {
    const d = await gd.fetch();
    const r = d.ringkasan;
    return `${r.jenisBarang} barang, ${r.poTerbuka + r.poSebagian} PO aktif, ${r.grn} GRN, ${r.barangKeluar} barang keluar`;
  };
})();
