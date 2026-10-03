/* =========================================================================
 * minimarket.js — integrasi Divisi Minimarket dengan aplikasi MiniMarket
 * (kasir, stok, kas & bank, laporan keuangan). HANYA BACA lewat /api/minimarket.
 *   - Template divisi Minimarket (3 departemen + karyawan siap pakai)
 *   - Data → markdown untuk konteks agen, laporan otomatis tanpa AI
 * ========================================================================= */
(function () {
  const VO = window.VO;
  const mm = (VO.minimarket = {});
  const rp = (v) => VO.rp(v);
  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '-');
  const fmtTime = (iso) => { try { return new Date(iso).toLocaleString('id-ID'); } catch { return iso; } };

  mm.TEMPLATE = {
    name: 'Minimarket',
    color: '#e76f51',
    director: { role: 'Direktur Minimarket', prompt: 'Kamu memimpin divisi Minimarket. Kamu menyatukan laporan toko, persediaan, dan keuangan menjadi ringkasan eksekutif untuk Boss: kinerja penjualan, kesehatan stok, posisi kas, risiko, dan rekomendasi tindakan.' },
    departments: [
      { name: 'Toko & Penjualan', roles: [
        { role: 'Kepala Toko', isLead: true, style: 'suit', prompt: 'Kamu memimpin operasional toko. Susun laporan final tentang kinerja penjualan, pola harian, produk terlaris, dan rekomendasi promosi berdasarkan data MiniMarket.' },
        { role: 'Analis Penjualan', style: 'shirt', prompt: 'Fokus pada data penjualan: omzet harian & bulanan, jumlah transaksi, rata-rata nilai transaksi, metode bayar, produk terlaris dan yang tidak laku, serta tren 30 hari.' },
        { role: 'Supervisor Kasir', style: 'cardigan', prompt: 'Fokus pada transaksi kasir: penjualan kredit vs tunai, diskon, dan piutang pelanggan yang belum lunas beserta umurnya.' },
      ] },
      { name: 'Persediaan', roles: [
        { role: 'Kepala Persediaan', isLead: true, style: 'suit', prompt: 'Kamu memimpin pengelolaan stok toko. Susun laporan final kondisi persediaan dan rencana pemesanan ulang berdasarkan data MiniMarket.' },
        { role: 'Analis Stok & Pembelian', style: 'shirt', prompt: 'Fokus pada stok: produk habis/menipis dibanding stok minimum, nilai persediaan per kategori, penerimaan barang dari pemasok, barang keluar (rusak/kedaluwarsa), stock opname, dan saran jumlah pesanan.' },
      ] },
      { name: 'Keuangan Toko', roles: [
        { role: 'Akuntan Toko', isLead: true, style: 'suit', prompt: 'Kamu bertanggung jawab atas laporan keuangan toko. Susun laporan final laba rugi bulan berjalan, posisi kas & bank, piutang dan hutang, berdasarkan data MiniMarket.' },
        { role: 'Analis Kas & Piutang', style: 'cardigan', prompt: 'Fokus pada saldo kas & bank, hutang ke pemasok yang mendekati jatuh tempo, piutang pelanggan yang belum lunas, serta margin laba kotor.' },
      ] },
    ],
  };

  /** Data → markdown ringkas untuk konteks AI */
  mm.toMarkdown = function (d) {
    const r = d.ringkasan, h = r.penjualanHariIni, b = r.penjualanBulanIni, lr = d.labaRugiBulanIni;
    const L = [];
    L.push(`Sumber: aplikasi MiniMarket, diambil ${fmtTime(d.diambil)}. Tanggal acuan data (transaksi terakhir): ${d.tanggalAcuan}. Periode bulan: ${d.periodeBulan.dari} s/d ${d.periodeBulan.sampai}. Semua nilai dalam Rupiah.`);
    L.push(`Ringkasan: penjualan hari ini ${h.trx} trx, omzet ${rp(h.omzet)}, laba kotor ${rp(h.labaKotor)} · bulan ini ${b.trx} trx, omzet ${rp(b.omzet)}, laba kotor ${rp(b.labaKotor)} (margin ${pct(b.labaKotor, b.omzet)}), diskon ${rp(b.diskon)} · ${r.jumlahProduk} produk (${r.stokHabis} habis, ${r.stokMenipis} menipis), nilai persediaan ${rp(r.nilaiPersediaan)} · kas & bank ${rp(r.saldoKasBank)} · piutang ${rp(r.piutang)} (${r.jumlahPiutangBelumLunas} transaksi) · hutang ${rp(r.hutang)} (${r.jumlahHutangBelumLunas} penerimaan).`);

    L.push('\n## Laba rugi bulan berjalan');
    for (const p of lr.pendapatan) L.push(`- Pendapatan · ${p.akun}: ${rp(p.jumlah)}`);
    for (const x of lr.beban) L.push(`- Beban · ${x.akun}: ${rp(x.jumlah)}`);
    L.push(`- Laba kotor: ${rp(lr.labaKotor)} · Beban operasional: ${rp(lr.bebanOperasional)} · Lain-lain bersih: ${rp(lr.pendapatanBebanLain)} · LABA BERSIH: ${rp(lr.labaBersih)}`);

    L.push('\n## Penjualan harian 30 hari (tanggal | trx | omzet | laba kotor)');
    for (const x of d.penjualanHarian) L.push(`- ${x.tanggal} | ${x.trx} | ${rp(x.omzet)} | ${rp(x.labaKotor)}`);
    if (d.metodeBayarBulanIni.length) L.push('Metode bayar bulan ini: ' + d.metodeBayarBulanIni.map((m) => `${m.metode} ${m.trx} trx (${rp(m.omzet)})`).join(', '));

    L.push('\n## Produk terlaris 30 hari (sku | nama | qty | omzet | laba kotor)');
    for (const t of d.produkTerlaris30Hari) L.push(`- ${t.sku} | ${t.nama} | ${t.qty} ${t.satuan} | ${rp(t.omzet)} | ${rp(t.labaKotor)}`);
    if (d.produkTidakLaku30Hari.length) L.push('Tidak terjual 30 hari: ' + d.produkTidakLaku30Hari.join(', '));

    L.push('\n## Stok produk (sku | nama | kategori | stok | min | HPP | harga jual | nilai stok | status)');
    for (const p of d.produk.slice(0, 150)) L.push(`- ${p.sku} | ${p.nama} | ${p.kategori} | ${p.stok} ${p.satuan} | min ${p.minStok} | ${rp(p.hpp)} | ${rp(p.hargaJual)} | ${rp(p.nilaiStok)} | ${p.status}${p.aktif ? '' : ' (nonaktif)'}`);
    L.push('Nilai persediaan per kategori: ' + d.nilaiPersediaanPerKategori.map((k) => `${k.kategori} ${rp(k.nilai)}`).join(', '));

    L.push('\n## Kas & bank');
    for (const k of d.kasBank) L.push(`- ${k.akun}: ${rp(k.saldo)}`);

    L.push(`\n## Piutang belum lunas (${r.jumlahPiutangBelumLunas} total, ditampilkan yang tertua)`);
    for (const x of d.piutangBelumLunas.slice(0, 25)) L.push(`- ${x.no} | ${x.tanggal} | ${x.pelanggan} | total ${rp(x.total)} | sisa ${rp(x.sisa)}`);
    L.push(`\n## Hutang ke pemasok belum lunas (${r.jumlahHutangBelumLunas})`);
    for (const x of d.hutangBelumLunas) L.push(`- ${x.no} | ${x.tanggal} | jatuh tempo ${x.jatuhTempo || '-'} | ${x.pemasok} | sisa ${rp(x.sisa)}`);

    L.push('\n## Penerimaan barang terbaru');
    for (const x of d.penerimaanBarangTerbaru) L.push(`- ${x.no} | ${x.tanggal} | ${x.pemasok} | ${rp(x.total)} | ${x.status}`);
    L.push('\n## Pengeluaran barang (non-penjualan) terbaru');
    if (!d.pengeluaranBarangTerbaru.length) L.push('- (tidak ada)');
    for (const x of d.pengeluaranBarangTerbaru) L.push(`- ${x.no} | ${x.tanggal} | ${x.alasan} | ${rp(x.nilai)}${x.catatan ? ' | ' + x.catatan : ''}`);
    L.push('\n## Stock opname terbaru');
    if (!d.stockOpnameTerbaru.length) L.push('- (tidak ada)');
    for (const x of d.stockOpnameTerbaru) L.push(`- ${x.no} | ${x.tanggal} | ${x.produk} | sistem ${x.sistem}, fisik ${x.fisik}, selisih ${x.selisih} (${rp(x.nilai)})`);
    return L.join('\n').slice(0, 26000);
  };

  /** Laporan tanpa AI: dihitung langsung dari data */
  mm.simReport = function (d, title) {
    if (d.error) return `> Data MiniMarket gagal diambil: ${d.error}`;
    const r = d.ringkasan, b = r.penjualanBulanIni, lr = d.labaRugiBulanIni;
    const L = [`# Laporan Minimarket: ${title}`, '', `_Sumber: MiniMarket · data per ${d.tanggalAcuan} · diambil ${fmtTime(d.diambil)} · dihitung otomatis (mode simulasi, tanpa AI)_`, ''];
    L.push('## 1. Kinerja penjualan', `- Hari ini: ${r.penjualanHariIni.trx} transaksi, omzet **${rp(r.penjualanHariIni.omzet)}**`, `- Bulan ini: ${b.trx} transaksi, omzet **${rp(b.omzet)}**, laba kotor ${rp(b.labaKotor)} (margin ${pct(b.labaKotor, b.omzet)})`, '');
    L.push('## 2. Laba rugi bulan berjalan', '| Pos | Jumlah |', '|---|---|', `| Pendapatan usaha | ${rp(lr.totalPendapatan)} |`, `| Harga pokok penjualan | ${rp(lr.hpp)} |`, `| Laba kotor | ${rp(lr.labaKotor)} |`, `| Beban operasional | ${rp(lr.bebanOperasional)} |`, `| Pendapatan/beban lain | ${rp(lr.pendapatanBebanLain)} |`, `| **Laba bersih** | **${rp(lr.labaBersih)}** |`, '');
    L.push('## 3. Produk terlaris 30 hari', '| Produk | Qty | Omzet | Laba kotor |', '|---|---|---|---|');
    for (const t of d.produkTerlaris30Hari.slice(0, 5)) L.push(`| ${t.nama} | ${t.qty} ${t.satuan} | ${rp(t.omzet)} | ${rp(t.labaKotor)} |`);
    L.push('');
    const kritis = d.produk.filter((p) => p.status !== 'aman');
    L.push('## 4. Stok perlu dipesan ulang');
    if (!kritis.length) L.push('Semua stok di atas batas minimum.');
    else { L.push('| SKU | Produk | Stok | Minimum | Status |', '|---|---|---|---|---|'); for (const p of kritis) L.push(`| ${p.sku} | ${p.nama} | ${p.stok} ${p.satuan} | ${p.minStok} | ${p.status} |`); }
    L.push('', '## 5. Kas, piutang & hutang');
    for (const k of d.kasBank) L.push(`- ${k.akun}: ${rp(k.saldo)}`);
    L.push(`- Piutang belum lunas: ${rp(r.piutang)} (${r.jumlahPiutangBelumLunas} transaksi)`, `- Hutang ke pemasok: ${rp(r.hutang)} (${r.jumlahHutangBelumLunas} penerimaan)`);
    return L.join('\n');
  };

  VO.integ.define({
    key: 'minimarket',
    label: 'MiniMarket',
    icon: 'inbox',
    endpoint: '/api/minimarket',
    toMarkdown: mm.toMarkdown,
    simReport: mm.simReport,
    testText: (d) => `${d.ringkasan.jumlahProduk} produk, omzet bulan ini ${rp(d.ringkasan.penjualanBulanIni.omzet)}, data per ${d.tanggalAcuan}`,
    logText: (d) => `${d.ringkasan.jumlahProduk} produk, ${d.ringkasan.penjualanBulanIni.trx} transaksi bulan ini`,
    leadNote: 'pakai angka Rupiah, nomor transaksi, dan periode dari data',
  });
})();
