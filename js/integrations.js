/* =========================================================================
 * integrations.js — penghubung divisi/departemen dengan aplikasi lain
 * (Gudang-Document, MiniMarket, …). Semuanya HANYA BACA.
 *
 * Integrasi dipasang di departemen (dept.integration) atau di divisi
 * (division.integration — berlaku untuk semua departemen & direkturnya).
 * Setiap integrasi menyediakan: fetch data, data → markdown untuk konteks
 * AI, laporan tanpa AI, dan tes koneksi.
 * ========================================================================= */
(function () {
  const VO = window.VO;
  const integ = (VO.integ = { registry: {} });

  /**
   * Buat & daftarkan integrasi.
   * def: { key, label, icon, endpoint, toMarkdown(d), simReport(d, title), testText(d), logText(d), leadNote }
   */
  integ.define = function (def) {
    const cache = new Map();
    const mod = {
      ...def,
      async fetch() {
        if (location.protocol === 'file:') throw new Error(`Butuh server (npm start / Vercel) untuk membaca ${def.label}`);
        const r = await fetch(def.endpoint, { cache: 'no-store' });
        if (r.status === 401) { location.href = '/login.html'; throw new Error('Sesi habis'); }
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
        return j;
      },
      // satu kali tarik data per tugas, dipakai bersama semua anggota tim
      forTask(task) {
        if (!cache.has(task.id)) {
          cache.set(task.id, mod.fetch().catch((e) => ({ error: e.message })));
          setTimeout(() => cache.delete(task.id), 10 * 60 * 1000);
        }
        return cache.get(task.id);
      },
      async augment(task, prompt) {
        const d = await mod.forTask(task);
        const tag = def.label.toUpperCase();
        if (d.error) return `${prompt}\n\nCATATAN: data ${def.label} gagal diambil (${d.error}). Sampaikan hal ini di laporanmu dan jangan mengarang angka.`;
        return `${prompt}\n\n=== DATA ${tag} (real-time, hanya baca) ===\n${def.toMarkdown(d)}\n=== AKHIR DATA ===\n\nAturan: gunakan HANYA data di atas sebagai fakta. Sebutkan angka & nomor dokumen yang relevan. Jika data yang dibutuhkan tidak ada, katakan tidak tersedia — jangan mengarang.`;
      },
      async test() { return def.testText(await mod.fetch()); },
    };
    integ.registry[def.key] = mod;
    return mod;
  };

  integ.get = (key) => (key && integ.registry[key]) || null;
  integ.keyForDept = (s, dept) => {
    if (!dept) return null;
    if (dept.integration) return dept.integration;
    const div = s.divisions.find((d) => d.id === dept.divisionId);
    return (div && div.integration) || null;
  };
  integ.forDept = (s, dept) => integ.get(integ.keyForDept(s, dept));
  integ.forDivision = (s, div) => integ.get(div && div.integration);
  integ.forEnt = (s, ent) => {
    if (!ent) return null;
    if (ent.isDirector) return integ.forDivision(s, s.divisions.find((d) => d.id === ent.divisionId));
    return integ.forDept(s, s.departments.find((d) => d.id === ent.deptId));
  };
  integ.options = () => [{ value: '', label: 'Tidak ada' }, ...Object.values(integ.registry).map((m) => ({ value: m.key, label: `${m.label} (hanya baca)` }))];

  // Format Rupiah ringkas untuk konteks AI & laporan
  VO.rp = (v) => 'Rp ' + Math.round(Number(v) || 0).toLocaleString('id-ID');
})();
