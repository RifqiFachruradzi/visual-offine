/* =========================================================================
 * publicdata.js — integrasi "Data Publik" dari daftar github.com/public-apis
 * (gratis, tanpa API key, HANYA BACA lewat /api/public):
 *   kurs (Frankfurter) · libur (Nager.Date) · cuaca (Open-Meteo) · publik (gabungan)
 * Dipasang di divisi/departemen lewat Edit → Integrasi data.
 * ========================================================================= */
(function () {
  const VO = window.VO;
  const pd = (VO.publicdata = {});
  const rp = (v) => 'Rp ' + Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 });
  const fmtTime = (iso) => { try { return new Date(iso).toLocaleString('id-ID'); } catch { return iso; } };
  const fmtDate = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } };
  const city = () => (VO.app && VO.app.state && VO.app.state.settings.city) || '';
  const ep = (kind) => () => `/api/public?kind=${kind}${city() ? '&city=' + encodeURIComponent(city()) : ''}`;

  /* ---------- markdown untuk konteks AI ---------- */
  pd.kursMd = (k) => {
    if (!k || k.error) return `Kurs: tidak tersedia (${k ? k.error : '-'})`;
    const L = [`## Kurs mata uang terhadap Rupiah (${k.sumber}, tanggal kurs ${k.tanggalKurs})`];
    for (const x of k.kurs) L.push(`- 1 ${x.mataUang} = ${rp(x.rupiah)}`);
    if (k.perubahanUSD30Hari) L.push(`Tren USD/IDR 30 hari: ${rp(k.perubahanUSD30Hari.dari)} → ${rp(k.perubahanUSD30Hari.ke)} (${k.perubahanUSD30Hari.persen > 0 ? '+' : ''}${k.perubahanUSD30Hari.persen}%)`);
    if (k.trenUSD.length) L.push('Data harian USD/IDR: ' + k.trenUSD.slice(-15).map((d) => `${d.tanggal} ${Math.round(d.rupiah)}`).join(', '));
    return L.join('\n');
  };
  pd.liburMd = (h) => {
    if (!h || h.error) return `Hari libur: tidak tersedia (${h ? h.error : '-'})`;
    const L = [`## Hari libur nasional Indonesia (${h.sumber}), hari ini ${h.hariIni}`, 'Mendatang:'];
    for (const x of h.mendatang) L.push(`- ${fmtDate(x.tanggal)}: ${x.nama} (${x.hariLagi === 0 ? 'hari ini' : x.hariLagi + ' hari lagi'})`);
    return L.join('\n');
  };
  pd.cuacaMd = (c) => {
    if (!c || c.error) return `Cuaca: tidak tersedia (${c ? c.error : '-'})`;
    const L = [`## Cuaca ${c.kota} (${c.sumber})`];
    if (c.sekarang) L.push(`Sekarang: ${c.sekarang.kondisi}, ${c.sekarang.suhu}°C, kelembapan ${c.sekarang.kelembapan}%, angin ${c.sekarang.angin} km/j`);
    L.push('Prakiraan 7 hari (tanggal | kondisi | suhu | curah hujan | peluang hujan):');
    for (const d of c.prakiraan) L.push(`- ${fmtDate(d.tanggal)} | ${d.kondisi} | ${d.suhuMin}–${d.suhuMaks}°C | ${d.hujanMm} mm | ${d.peluangHujan ?? '-'}%`);
    return L.join('\n');
  };
  const head = (d) => `Sumber: API publik gratis (daftar public-apis), diambil ${fmtTime(d.diambil)}.`;

  /* ---------- laporan tanpa AI ---------- */
  const simWrap = (title, body, d) => `# Laporan Data Publik: ${title}\n\n_${head(d)} Dihitung otomatis (mode simulasi, tanpa AI)._\n\n${body}`;
  pd.kursSim = (d, title) => simWrap(title, ['| Mata uang | Kurs (Rp) |', '|---|---|', ...d.kurs.map((x) => `| 1 ${x.mataUang} | ${rp(x.rupiah)} |`)].join('\n') + (d.perubahanUSD30Hari ? `\n\nUSD/IDR 30 hari: **${d.perubahanUSD30Hari.persen > 0 ? '+' : ''}${d.perubahanUSD30Hari.persen}%**` : ''), d);
  pd.liburSim = (d, title) => simWrap(title, ['| Tanggal | Hari libur | Hari lagi |', '|---|---|---|', ...d.mendatang.map((x) => `| ${fmtDate(x.tanggal)} | ${x.nama} | ${x.hariLagi} |`)].join('\n'), d);
  pd.cuacaSim = (d, title) => simWrap(title, [`**${d.kota}** — sekarang ${d.sekarang ? d.sekarang.kondisi + ', ' + d.sekarang.suhu + '°C' : '-'}`, '', '| Tanggal | Kondisi | Suhu | Hujan | Peluang |', '|---|---|---|---|---|', ...d.prakiraan.map((x) => `| ${fmtDate(x.tanggal)} | ${x.kondisi} | ${x.suhuMin}–${x.suhuMaks}°C | ${x.hujanMm} mm | ${x.peluangHujan ?? '-'}% |`)].join('\n'), d);

  const RULE = 'kutip angka & tanggal persis dari data, sebutkan sumber API-nya';
  VO.integ.define({
    key: 'kurs', label: 'Kurs Mata Uang', icon: 'activity', endpoint: ep('kurs'),
    toMarkdown: (d) => head(d) + '\n' + pd.kursMd(d), simReport: pd.kursSim,
    testText: (d) => `1 USD = ${rp((d.kurs.find((x) => x.mataUang === 'USD') || {}).rupiah || 0)} (kurs ${d.tanggalKurs})`,
    logText: (d) => `${d.kurs.length} mata uang, kurs ${d.tanggalKurs}`, leadNote: RULE,
  });
  VO.integ.define({
    key: 'libur', label: 'Hari Libur Nasional', icon: 'clock', endpoint: ep('libur'),
    toMarkdown: (d) => head(d) + '\n' + pd.liburMd(d), simReport: pd.liburSim,
    testText: (d) => d.mendatang[0] ? `Berikutnya: ${d.mendatang[0].nama} (${d.mendatang[0].hariLagi} hari lagi)` : 'Tidak ada libur mendatang',
    logText: (d) => `${d.mendatang.length} hari libur mendatang`, leadNote: RULE,
  });
  VO.integ.define({
    key: 'cuaca', label: 'Cuaca', icon: 'sun', endpoint: ep('cuaca'),
    toMarkdown: (d) => head(d) + '\n' + pd.cuacaMd(d), simReport: pd.cuacaSim,
    testText: (d) => `${d.kota}: ${d.sekarang ? d.sekarang.kondisi + ', ' + d.sekarang.suhu + '°C' : '-'}`,
    logText: (d) => `prakiraan 7 hari ${d.kota}`, leadNote: RULE,
  });
  VO.integ.define({
    key: 'publik', label: 'Data Publik (kurs + libur + cuaca)', icon: 'zap', endpoint: ep('publik'),
    toMarkdown: (d) => [head(d), pd.kursMd(d.kurs), pd.liburMd(d.libur), pd.cuacaMd(d.cuaca)].join('\n\n'),
    simReport: (d, title) => [d.kurs && !d.kurs.error ? pd.kursSim({ ...d.kurs, diambil: d.diambil }, title) : '', d.libur && !d.libur.error ? pd.liburSim({ ...d.libur, diambil: d.diambil }, title).replace(/^# .*\n\n_.*_\n\n/, '\n## Hari libur\n') : '', d.cuaca && !d.cuaca.error ? pd.cuacaSim({ ...d.cuaca, diambil: d.diambil }, title).replace(/^# .*\n\n_.*_\n\n/, '\n## Cuaca\n') : ''].join('\n'),
    testText: (d) => ['kurs', 'libur', 'cuaca'].map((k) => `${k} ${d[k] && !d[k].error ? 'OK' : 'gagal'}`).join(' · ') + (d.cuaca && d.cuaca.kota ? ` (${d.cuaca.kota})` : ''),
    logText: () => 'kurs, hari libur & cuaca', leadNote: RULE,
  });
})();
