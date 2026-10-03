/* =========================================================================
 * cloud.js — simpan kantor ke database (Upstash Redis) per akun, sehingga
 * kantor, ingatan agen, dan Gudang Dokumen bisa dibuka dari perangkat mana pun.
 * Aktif otomatis bila server punya database (mode akun 'db').
 * localStorage tetap dipakai sebagai cache lokal.
 * ========================================================================= */
(function () {
  const VO = window.VO;
  const cloud = (VO.cloud = { enabled: false, synced: new Set(), busy: false, again: false, lastError: '' });

  // Batasi ukuran: tugas lama & hasil yang sangat panjang dipangkas sebelum diunggah
  function officePayload(s) {
    const tasks = s.tasks.slice(0, 30).map((t) => ({
      ...t,
      result: String(t.result || '').slice(0, 8000),
      subtasks: t.subtasks.map((st) => ({ ...st, output: String(st.output || '').slice(0, 3000) })),
    }));
    return { ...s, docs: [], tasks, log: s.log.slice(0, 80) };
  }

  cloud.load = async function () {
    const r = await fetch('/api/office', { cache: 'no-store' });
    if (!r.ok) throw new Error('Gagal memuat data cloud (HTTP ' + r.status + ')');
    const j = await r.json();
    cloud.synced = new Set((j.docs || []).map((d) => d.id));
    return j;
  };

  async function post(body) {
    const r = await fetch('/api/office', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) { location.href = '/login.html'; throw new Error('Sesi habis'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  }

  /** Unggah kantor + perubahan dokumen (dokumen tidak pernah diedit, cukup tambah/hapus). */
  cloud.save = async function (s) {
    if (!cloud.enabled) return;
    if (cloud.busy) { cloud.again = true; return; }
    cloud.busy = true;
    try {
      const ids = new Set(s.docs.map((d) => d.id));
      const ops = [];
      for (const d of s.docs) if (!cloud.synced.has(d.id)) ops.push({ op: 'put', doc: d });
      for (const id of cloud.synced) if (!ids.has(id)) ops.push({ op: 'del', id });
      // kirim kantor dulu, lalu dokumen per 40 agar request tidak terlalu besar
      await post({ office: officePayload(s), docOps: ops.slice(0, 40) });
      for (let i = 40; i < ops.length; i += 40) await post({ docOps: ops.slice(i, i + 40) });
      for (const op of ops) op.op === 'put' ? cloud.synced.add(op.doc.id) : cloud.synced.delete(op.id);
      cloud.lastError = '';
      cloud.savedAt = Date.now();
    } catch (e) {
      if (cloud.lastError !== e.message) VO.ui && VO.ui.toast('Gagal menyimpan ke cloud: ' + e.message, 'alert');
      cloud.lastError = e.message;
      throw e;
    } finally {
      cloud.busy = false;
      if (cloud.again) { cloud.again = false; cloud.save(VO.app.state).catch(() => {}); }
    }
  };
})();
