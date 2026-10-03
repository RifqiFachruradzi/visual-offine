/* =========================================================================
 * tasks.js — alur kerja hierarkis kantor:
 *   Boss → (rapat) → Direktur Divisi → Lead Departemen → Anggota tim
 * Setiap level: briefing ke atasan, kerja, lalu lapor balik ke atasan.
 * Mode simulasi: progres acak. Mode AI: setiap agent memanggil Gemini (atau Claude) lewat backend.
 * Juga memetakan event live dari Claude Code hooks menjadi karyawan kantor.
 * ========================================================================= */
(function () {
  const VO = window.VO;
  const sim = VO.sim;
  const A = sim.A;
  const S = () => VO.app.state;
  const changed = () => VO.app.changed();
  const short = (t, n = 38) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

  const tasks = (VO.tasks = {});

  tasks.create = function ({ title, targetType, targetId }) {
    const s = S();
    const task = {
      id: VO.uid('tk'), title, targetType, targetId, status: 'briefing',
      created: Date.now(), subtasks: [], result: '', note: '', ai: !!(s.settings.aiMode && VO.ai.available),
    };
    s.tasks.unshift(task);
    if (s.tasks.length > 60) s.tasks.length = 60;
    VO.log(s, `Boss memberi tugas: "${title}" → ${tasks.targetLabel(s, targetType, targetId)}`, 'send');
    sim.say('boss', short(title), 4, 'task');
    changed();
    run(task).then(
      (report) => {
        task.status = 'done';
        task.result = report || task.result;
        if (!task.ai) task.result = '> Ini hasil **simulasi** (tanpa AI). Aktifkan kotak **AI** di bar atas agar karyawan benar-benar mengerjakan tugas dengan Gemini.\n\n' + task.result;
        task.finished = Date.now();
        if (task.result) {
          VO.addDoc(S(), { kind: 'report', title: 'Laporan: ' + title, author: tasks.targetLabel(S(), targetType, targetId), taskId: task.id, content: task.result });
        }
        VO.log(S(), `Tugas selesai: "${title}" — laporan disimpan di Gudang Dokumen`, 'check');
        sim.say('boss', 'Mantap, tim!', 3, 'check');
        changed();
      },
      (err) => {
        task.status = 'failed';
        task.note = String(err && err.message ? err.message : err);
        VO.log(S(), `Tugas gagal: "${title}" — ${task.note}`, 'alert');
        changed();
      }
    );
    return task;
  };

  tasks.targetLabel = function (s, type, id) {
    if (type === 'all') return 'Seluruh kantor';
    if (type === 'division') return 'Divisi ' + (s.divisions.find((d) => d.id === id)?.name || '?');
    if (type === 'dept') return 'Dept. ' + (s.departments.find((d) => d.id === id)?.name || '?');
    const a = VO.findEntity(s, id);
    return a ? a.name : '?';
  };

  async function run(task) {
    const s = S();
    if (task.targetType === 'all') return runAll(task);
    if (task.targetType === 'division') {
      const div = s.divisions.find((d) => d.id === task.targetId);
      if (!div) throw new Error('Divisi tidak ditemukan');
      return runDivision(task, div, 'boss', false);
    }
    if (task.targetType === 'dept') {
      const dept = s.departments.find((d) => d.id === task.targetId);
      if (!dept) throw new Error('Departemen tidak ditemukan');
      return runDept(task, dept, 'boss', false);
    }
    const ag = VO.findEntity(s, task.targetId);
    if (!ag) throw new Error('Agen tidak ditemukan');
    await brief(ag, 'boss', task);
    task.status = 'in_progress'; changed();
    const out = await work(task, ag, `Tugas dari Boss: ${task.title}`);
    await reportTo(ag, 'boss');
    return out;
  }

  /* ------------------------------------------------------------ level-level */
  async function runAll(task) {
    const s = S();
    const leaders = [];
    for (const div of s.divisions) {
      const dir = VO.director(s, div.id);
      if (dir) leaders.push(dir);
      else s.departments.filter((d) => d.divisionId === div.id).forEach((d) => { const l = VO.deptLead(s, d.id); if (l) leaders.push(l); });
    }
    await meeting(task, leaders);
    task.status = 'in_progress'; changed();
    const reports = await Promise.all(
      s.divisions.map((div) => runDivision(task, div, 'boss', true).then((r) => `## Divisi ${div.name}\n${r}`))
    );
    // Boss adalah kamu: laporan semua divisi digabung untuk kamu baca (tanpa ringkasan AI)
    return reports.join('\n\n');
  }

  async function runDivision(task, div, superiorId, briefed) {
    const s = S();
    const dir = VO.director(s, div.id);
    const depts = s.departments.filter((d) => d.divisionId === div.id);
    if (!depts.length) return '_(divisi tanpa departemen)_';
    if (!dir) {
      const reps = await Promise.all(depts.map((d) => runDept(task, d, superiorId, briefed)));
      return reps.join('\n\n');
    }
    if (!briefed) await brief(dir, superiorId, task);
    task.status = 'in_progress'; changed();
    sim.say(dir.id, 'Tim ' + div.name + ', ada tugas!', 3, 'megaphone');
    const reps = await Promise.all(depts.map((d) => runDept(task, d, dir.id, false).then((r) => `### ${d.name}\n${r}`)));
    const out = await summarize(task, dir, reps, `Kamu direktur divisi ${div.name}. Gabungkan hasil semua departemen menjadi SATU dokumen final yang lengkap, rapi, dan siap dipakai untuk Boss (jangan hanya meringkas).`);
    await reportTo(dir, superiorId);
    return out;
  }

  async function runDept(task, dept, superiorId, briefed) {
    const s = S();
    const members = VO.deptAgents(s, dept.id);
    if (!members.length) return '_(departemen kosong)_';
    const lead = members[0];
    if (!briefed) await brief(lead, superiorId, task);
    task.status = 'in_progress'; changed();
    // Departemen Gudang: tarik data Gudang-Document dulu (hanya baca)
    let gudangData = null;
    if (dept.integration === 'gudang') {
      sim.say(lead.id, 'Menarik data Gudang-Document...', 3, 'server');
      gudangData = await VO.gudang.forTask(task);
      if (gudangData.error) { sim.say(lead.id, 'Data gudang gagal diambil', 3, 'alert'); VO.log(S(), `Gagal membaca Gudang-Document: ${gudangData.error}`, 'alert'); }
      else VO.log(S(), `${dept.name} menarik data Gudang-Document (${gudangData.ringkasan.jenisBarang} barang, ${gudangData.ringkasan.grn} GRN)`, 'server');
    }
    if (members.length > 1) sim.say(lead.id, 'Ayo tim, kita bagi tugas!', 3, 'users');
    const roster = members.map((m) => `- ${m.name} (${m.role})`).join('\n');
    const outs = await Promise.all(
      members.map((m) =>
        work(task, m, `Tugas dari atasan: ${task.title}\n\nKamu anggota tim ${dept.name}. Anggota tim:\n${roster}\n\nKerjakan HANYA bagian yang sesuai jabatanmu (${m.role}).`)
          .then((o) => `**${m.name} (${m.role})**: ${o}`)
      )
    );
    const gudangNote = gudangData && !gudangData.error
      ? ` Laporan ini berbasis data Gudang-Document: cantumkan sumber & waktu pengambilan data di awal, pakai angka dan nomor dokumen (PO/GRN/BK), periksa angka tim terhadap data berikut, dan jangan mengarang angka.\n\n=== DATA GUDANG-DOCUMENT ===\n${VO.gudang.toMarkdown(gudangData)}\n=== AKHIR DATA ===`
      : '';
    let out = members.length > 1
      ? await summarize(task, lead, outs, `Kamu ${lead.role} yang memimpin tim ${dept.name}. Gabungkan hasil kerja tim menjadi SATU dokumen final yang lengkap, rapi, dan siap dipakai (jangan hanya meringkas).${gudangNote}`)
      : outs[0];
    // tanpa AI: laporan gudang dihitung langsung dari data
    if (gudangData && !task.ai) out = VO.gudang.simReport(gudangData, task.title);
    await reportTo(lead, superiorId);
    return out;
  }

  /* ------------------------------------------------------------ aksi dasar */
  function stillHere(ent) { return !!VO.findEntity(S(), ent.id); }

  async function brief(ent, superiorId, task) {
    const s = S();
    if (!stillHere(ent)) return;
    const vt = sim.visitorTile(s, superiorId);
    await sim.act(ent.id, [
      A.goto(vt, 'walking'),
      A.fn(() => sim.say(superiorId, short(task.title, 30), 3, 'task')),
      A.wait(2.4, 'briefing', VO.pick(['Siap laksanakan!', 'Siap, dimengerti!', 'Dicatat!'])),
      ...sim.homeActions(s, ent.id),
    ]);
  }

  async function reportTo(ent, superiorId) {
    const s = S();
    if (!stillHere(ent)) return;
    const vt = sim.visitorTile(s, superiorId);
    await sim.act(ent.id, [
      A.goto(vt, 'walking'),
      A.wait(2.2, 'reporting', 'Laporan sudah siap!'),
      A.fn(() => sim.say(superiorId, VO.pick(['Kerja bagus!', 'Diterima', 'Mantap!']), 2.5, 'check')),
      ...sim.homeActions(s, ent.id),
    ]);
  }

  async function meeting(task, people) {
    const s = S();
    const seats = sim.spots(s, 'meeting');
    if (!seats.length || !people.length) {
      for (const p of people) await brief(p, 'boss', task);
      return;
    }
    task.status = 'meeting'; changed();
    VO.log(s, `Rapat besar dimulai: "${task.title}"`, 'meeting');
    const all = [s.boss, ...people];
    await Promise.all(all.map((p, i) => sim.act(p.id, [A.goto(seats[i % seats.length], 'walking')])));
    sim.say('boss', 'Rapat: ' + short(task.title, 28), 4, 'megaphone');
    await Promise.all(all.map((p) => sim.act(p.id, [A.wait(4.5, 'meeting', p.id === 'boss' ? null : VO.pick(['Mencatat...', 'Noted', 'Siap, Bos'])) ])));
    all.forEach((p) => sim.act(p.id, sim.homeActions(S(), p.id)));
  }

  // Kerja di meja: simulasi atau panggilan AI (Gemini / Claude)
  function work(task, ent, prompt) {
    const s = S();
    const sub = { id: VO.uid('st'), agentId: ent.id, agentName: ent.name, role: ent.role, status: 'queued', progress: 0, output: '' };
    task.subtasks.push(sub);
    changed();
    const job = { progress: 0, done: false };
    if (task.ai) {
      job.start = () => {
        sub.status = 'working'; changed();
        const q = VO.ai.withDocs(S(), prompt, task.title + ' ' + ent.role, task.id);
        if (q.docs.length) { sub.refs = q.docs.map((d) => d.title); sim.say(ent.id, 'Membaca ' + q.docs.length + ' dokumen', 2.5, 'book'); }
        const isGudang = !!VO.gudang.deptOf(S(), ent);
        if (isGudang) sub.refs = [...(sub.refs || []), 'Data Gudang-Document'];
        (isGudang ? VO.gudang.augment(task, q.prompt) : Promise.resolve(q.prompt)).then((finalPrompt) => VO.ai.run(
          { model: ent.model, system: VO.ai.systemPrompt(S(), ent), prompt: finalPrompt },
          (_, full) => {
            sub.output = full;
            job.progress = Math.min(0.95, 0.08 + full.length / 1800);
          },
          (w) => { sub.wait = w; if (w) sim.say(ent.id, w, 4); changed(); }
        ).then(
          (full) => {
            sub.output = full;
            const dept = S().departments.find((d) => d.id === ent.deptId);
            VO.addDoc(S(), { kind: 'work', title: `${task.title} — ${ent.role}`, author: ent.name, authorId: ent.id, deptId: dept?.id, taskId: task.id, content: full });
            finish('done');
          },
          (e) => { sub.output = 'Gagal: ' + e.message; finish('failed'); }
        ));
      };
      job.tick = (dt) => { if (job.progress < 0.08) job.progress += dt * 0.01; };
    } else {
      const dur = VO.rand(6, 14);
      job.start = () => { sub.status = 'working'; changed(); };
      job.tick = (dt) => {
        job.progress += dt / dur;
        if (job.progress >= 1 && !job.done) {
          sub.output = simulatedOutput(task, ent);
          finish('done');
        }
      };
    }
    function finish(st) {
      job.progress = 1; job.done = true;
      const r0 = sim.rt.get(ent.id);
      if (r0) r0.activity = null;
      if (st === 'done') VO.remember(VO.findEntity(S(), ent.id), `Tugas "${short(task.title, 60)}": ${String(sub.output).replace(/\s+/g, ' ').slice(0, 300)}`);
      sub.status = st; sub.progress = 1; changed();
      sim.say(ent.id, st === 'done' ? 'Bagianku beres!' : 'Ada kendala', 2.5, st === 'done' ? 'check' : 'alert');
    }
    const seat = VO.seatOf(s, ent);
    const acts = [];
    if (seat) acts.push(A.goto(seat.chair, 'walking'));
    acts.push(A.fn(() => {
      sim.say(ent.id, short(ent.role, 24), 2, 'monitor');
      const r = sim.rt.get(ent.id);
      if (r) r.activity = short(task.title, 26); // ditampilkan di chip aktivitas (tema Robot)
    }));
    acts.push(A.work(job));
    let lastPct = 0;
    const iv = setInterval(() => {
      sub.progress = job.progress;
      if (Math.abs(job.progress - lastPct) > 0.04) { lastPct = job.progress; changed(); }
    }, 400);
    return sim.act(ent.id, acts).then((ok) => {
      clearInterval(iv);
      if (!ok && !job.done) { sub.status = 'failed'; sub.output = sub.output || '(dibatalkan)'; changed(); }
      return sub.output;
    });
  }

  async function summarize(task, ent, parts, instruction) {
    const joined = parts.join('\n\n');
    if (!task.ai || !stillHere(ent)) return joined;
    sim.say(ent.id, 'Menyusun laporan...', 3, 'file');
    try {
      const out = await VO.ai.run(
        {
          model: ent.model,
          system: VO.ai.systemPrompt(S(), ent, true),
          prompt: `${instruction}\n\nTugas dari Boss: ${task.title}\n\nHasil kerja anggota:\n${joined}\n\nTulis dokumen final dalam markdown: judul, bagian-bagian bernomor, poin-poin, dan tabel bila perlu. Jangan menyebut nama anggota tim di dalam dokumen kecuali relevan.`,
          long: true,
        },
        null,
        (w) => w && sim.say(ent.id, w, 4)
      );
      VO.remember(VO.findEntity(S(), ent.id), `Merangkum laporan "${short(task.title, 60)}": ${out.replace(/\s+/g, ' ').slice(0, 250)}`);
      return out;
    } catch (e) {
      return joined + `\n\n_(ringkasan gagal: ${e.message})_`;
    }
  }

  function simulatedOutput(task, ent) {
    const verbs = ['menganalisis', 'menyusun draf', 'mengimplementasikan', 'meninjau', 'mengoptimalkan', 'menguji'];
    return `${VO.pick(verbs)} aspek **${ent.role}** untuk "${short(task.title, 50)}" — selesai (simulasi).`;
  }

  /* ------------------------------------------------------------ live: Claude Code hooks */
  const live = (VO.live = {});

  function ensureLiveDept(s) {
    let div = s.divisions.find((d) => d.live);
    if (!div) {
      const bottom = Math.max(12, ...s.divisions.map((d) => d.zone.y + d.zone.h), ...s.facilities.map((f) => f.y + f.h));
      div = VO.addDivision(s, { name: 'Live · Claude Code', color: '#f4a261', directorRole: null });
      div.live = true;
      VO.setZone(s, div, { x: 2, y: bottom + 2, w: 24, h: 13 }, false);
      div.directorDesk = { x: 4, y: bottom + 3 };
      s.map.h = Math.max(s.map.h, bottom + 17);
    }
    let dept = s.departments.find((d) => d.divisionId === div.id);
    if (!dept) {
      dept = VO.addDepartment(s, div.id, { name: 'Sesi Aktif' });
      dept.room = { x: div.zone.x + 1, y: div.zone.y + 4, w: 15, h: 6 };
    }
    return dept;
  }

  function liveAgent(s, ev) {
    const key = ev.session_id || 'default';
    let ag = s.agents.find((a) => a.live && a.sessionId === key);
    if (!ag) {
      const dept = ensureLiveDept(s);
      const base = (ev.cwd || '').split(/[\\/]/).filter(Boolean).pop() || 'session';
      ag = VO.addAgent(s, dept.id, { name: 'Claude · ' + base, role: 'Claude Code Session', live: true });
      ag.sessionId = key;
      ag.shirt = '#d97757';
      sim.dirty = true;
      sim.sync(s);
      VO.log(s, `Sesi Claude Code baru masuk kantor: ${ag.name}`, 'live');
    }
    return ag;
  }

  function toolDetail(ev) {
    const i = ev.tool_input || {};
    const f = i.file_path || i.path || i.notebook_path;
    if (f) return String(f).split(/[\\/]/).pop();
    if (i.command) return short(String(i.command), 22);
    if (i.pattern) return short(String(i.pattern), 22);
    if (i.description) return short(String(i.description), 22);
    return '';
  }

  live.handle = function (ev) {
    const s = S();
    const name = ev.hook_event_name || ev.type;
    if (!name) return;
    const ag = liveAgent(s, ev);
    const rt = sim.rt.get(ag.id);
    switch (name) {
      case 'SessionStart': sim.say(ag.id, 'Masuk kantor', 3, 'wave'); break;
      case 'UserPromptSubmit': {
        const p = short(String(ev.prompt || 'Tugas baru'), 30);
        VO.log(s, `${ag.name} menerima prompt: "${short(String(ev.prompt || ''), 80)}"`, 'task');
        sim.say('boss', p, 3, 'task');
        if (rt) rt.liveTool = 'thinking';
        brief(ag, 'boss', { title: p });
        break;
      }
      case 'PreToolUse': {
        if (rt) rt.liveTool = ev.tool_name || 'tool';
        const d = toolDetail(ev);
        sim.say(ag.id, `${ev.tool_name || 'tool'}${d ? ' · ' + d : ''}`, 2.5, 'tool');
        break;
      }
      case 'PostToolUse': if (rt) rt.liveTool = 'thinking'; break;
      case 'SubagentStop': sim.say(ag.id, 'Subagent selesai', 2.5, 'puzzle'); break;
      case 'Notification': sim.say(ag.id, short(String(ev.message || 'Butuh perhatian'), 34), 5, 'bell'); VO.log(s, `${ag.name}: ${ev.message || ''}`, 'bell'); break;
      case 'Stop':
        if (rt) rt.liveTool = null;
        VO.log(s, `${ag.name} selesai merespons`, 'check');
        reportTo(ag, 'boss');
        break;
      case 'SessionEnd':
        VO.log(s, `${ag.name} pulang (sesi berakhir)`, 'wave');
        sim.say(ag.id, 'Pulang dulu', 2, 'wave');
        setTimeout(() => { VO.removeAgent(S(), ag.id); sim.dirty = true; sim.sync(S()); changed(); }, 2200);
        break;
      default: sim.say(ag.id, name, 2, 'zap');
    }
    changed();
  };
})();
