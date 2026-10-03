/* =========================================================================
 * ai.js — jembatan ke server lokal (server.js):
 *   - /api/health  : cek apakah mode AI nyata (Claude API) tersedia
 *   - /api/run     : jalankan satu agent (streaming SSE)
 *   - /api/events  : event live dari Claude Code hooks
 * Jika halaman dibuka langsung dari file:// semuanya otomatis non-aktif
 * dan kantor berjalan dalam mode simulasi.
 * ========================================================================= */
(function () {
  const VO = window.VO;
  const ai = (VO.ai = { available: false, server: false, reason: 'Server belum dicek' });

  const isHttp = () => location.protocol === 'http:' || location.protocol === 'https:';

  ai.check = async function () {
    if (!isHttp()) { ai.reason = 'Dibuka dari file:// — jalankan `npm start` untuk mode AI & live'; return ai; }
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      const j = await r.json();
      ai.server = true;
      ai.available = !!j.ai;
      ai.reason = j.ai ? 'Claude API siap' : j.reason || 'API key belum diset';
    } catch (e) {
      ai.reason = 'Server tidak terjangkau';
    }
    return ai;
  };

  ai.systemPrompt = function (s, ent) {
    const dept = s.departments.find((d) => d.id === ent.deptId);
    const div = s.divisions.find((d) => d.id === ent.divisionId);
    const where = ent.id === 'boss' ? 'CEO / Boss' : [div && 'Divisi ' + div.name, dept && 'Departemen ' + dept.name].filter(Boolean).join(', ');
    return [
      `Kamu adalah ${ent.name}, karyawan AI di perusahaan "${s.company.name}".`,
      `Jabatan: ${ent.role}${where ? ' (' + where + ')' : ''}.`,
      ent.prompt ? `Instruksi khusus: ${ent.prompt}` : '',
      'Kerjakan bagianmu secara konkret dan ringkas (maksimal ~250 kata), gunakan bahasa Indonesia, format markdown sederhana.',
    ].filter(Boolean).join('\n');
  };

  /**
   * Jalankan agent. onText dipanggil untuk tiap potongan teks.
   * Resolve dengan teks lengkap, atau reject bila gagal.
   */
  ai.run = async function ({ model, system, prompt }, onText) {
    const r = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, system, prompt }),
    });
    if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        const ev = JSON.parse(line.slice(5));
        if (ev.type === 'text') { full += ev.text; onText && onText(ev.text, full); }
        else if (ev.type === 'error') throw new Error(ev.message);
        else if (ev.type === 'done' && ev.stop_reason === 'refusal') throw new Error('Permintaan ditolak oleh model (refusal)');
      }
    }
    return full;
  };

  /* ------------------------------------------------------------ live events */
  ai.listen = function (onEvent) {
    if (!isHttp() || !window.EventSource) return null;
    const es = new EventSource('/api/events');
    es.onmessage = (m) => {
      try { onEvent(JSON.parse(m.data)); } catch (e) { /* abaikan event rusak */ }
    };
    return es;
  };
})();
