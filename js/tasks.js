/* =========================================================================
 * tasks.js — alur kerja hierarkis kantor:
 *   Boss → (rapat) → Direktur Divisi → Lead Departemen → Anggota tim
 * Setiap level: briefing ke atasan, kerja, lalu lapor balik ke atasan.
 * Mode simulasi: progres acak. Mode AI: setiap agent memanggil Claude API.
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
    VO.log(s, `📋 Boss memberi tugas: "${title}" → ${tasks.targetLabel(s, targetType, targetId)}`);
    sim.say('boss', '📋 ' + short(title), 4);
    changed();
    run(task).then(
      (report) => {
        task.status = 'done';
        task.result = report || task.result;
        task.finished = Date.now();
        VO.log(S(), `✅ Tugas selesai: "${title}"`);
        sim.say('boss', '👏 Mantap, tim!', 3);
        changed();
      },
      (err) => {
        task.status = 'failed';
        task.note = String(err && err.message ? err.message : err);
        VO.log(S(), `❌ Tugas gagal: "${title}" — ${task.note}`);
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
    return summarize(task, S().boss, reports, 'Kamu CEO. Rangkum laporan seluruh divisi menjadi ringkasan eksekutif dan langkah selanjutnya.');
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
    sim.say(dir.id, '📣 Tim ' + div.name + ', ada tugas!', 3);
    const reps = await Promise.all(depts.map((d) => runDept(task, d, dir.id, false).then((r) => `### ${d.name}\n${r}`)));
    const out = await summarize(task, dir, reps, `Kamu direktur divisi ${div.name}. Rangkum laporan departemen untuk Boss.`);
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
    if (members.length > 1) sim.say(lead.id, '👥 Ayo tim, kita bagi tugas!', 3);
    const roster = members.map((m) => `- ${m.name} (${m.role})`).join('\n');
    const outs = await Promise.all(
      members.map((m) =>
        work(task, m, `Tugas dari atasan: ${task.title}\n\nKamu anggota tim ${dept.name}. Anggota tim:\n${roster}\n\nKerjakan HANYA bagian yang sesuai jabatanmu (${m.role}).`)
          .then((o) => `**${m.name} (${m.role})**: ${o}`)
      )
    );
    const out = members.length > 1
      ? await summarize(task, lead, outs, `Kamu ${lead.role} yang memimpin tim ${dept.name}. Gabungkan hasil kerja tim menjadi satu laporan ringkas.`)
      : outs[0];
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
      A.fn(() => sim.say(superiorId, '📋 ' + short(task.title, 30), 3)),
      A.wait(2.4, 'briefing', VO.pick(['🫡 Siap laksanakan!', '👌 Siap, dimengerti!', '📝 Dicatat!'])),
      ...sim.homeActions(s, ent.id),
    ]);
  }

  async function reportTo(ent, superiorId) {
    const s = S();
    if (!stillHere(ent)) return;
    const vt = sim.visitorTile(s, superiorId);
    await sim.act(ent.id, [
      A.goto(vt, 'walking'),
      A.wait(2.2, 'reporting', '📨 Laporan sudah siap!'),
      A.fn(() => sim.say(superiorId, VO.pick(['👍 Kerja bagus!', '✅ Diterima', '🔥 Mantap!']), 2.5)),
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
    VO.log(s, `👥 Rapat besar dimulai: "${task.title}"`);
    const all = [s.boss, ...people];
    await Promise.all(all.map((p, i) => sim.act(p.id, [A.goto(seats[i % seats.length], 'walking')])));
    sim.say('boss', '📢 Rapat: ' + short(task.title, 28), 4);
    await Promise.all(all.map((p) => sim.act(p.id, [A.wait(4.5, 'meeting', p.id === 'boss' ? null : VO.pick(['📝 Mencatat...', '🤔 Noted', '💡 Siap, Bos'])) ])));
    all.forEach((p) => sim.act(p.id, sim.homeActions(S(), p.id)));
  }

  // Kerja di meja: simulasi atau panggilan Claude API
  function work(task, ent, prompt) {
    const s = S();
    const sub = { id: VO.uid('st'), agentId: ent.id, agentName: ent.name, role: ent.role, status: 'queued', progress: 0, output: '' };
    task.subtasks.push(sub);
    changed();
    const job = { progress: 0, done: false };
    if (task.ai) {
      job.start = () => {
        sub.status = 'working'; changed();
        VO.ai.run({ model: ent.model, system: VO.ai.systemPrompt(S(), ent), prompt }, (_, full) => {
          sub.output = full;
          job.progress = Math.min(0.95, 0.08 + full.length / 1800);
        }).then((full) => { sub.output = full; finish('done'); }, (e) => { sub.output = '⚠️ ' + e.message; finish('failed'); });
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
      sub.status = st; sub.progress = 1; changed();
      sim.say(ent.id, st === 'done' ? '✅ Bagianku beres!' : '⚠️ Ada kendala', 2.5);
    }
    const seat = VO.seatOf(s, ent);
    const acts = [];
    if (seat) acts.push(A.goto(seat.chair, 'walking'));
    acts.push(A.fn(() => sim.say(ent.id, '💻 ' + short(ent.role, 24), 2)));
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
    sim.say(ent.id, '🧾 Menyusun laporan...', 3);
    try {
      return await VO.ai.run({
        model: ent.model,
        system: VO.ai.systemPrompt(S(), ent),
        prompt: `${instruction}\n\nTugas awal: ${task.title}\n\nLaporan masuk:\n${joined}`,
      });
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
      VO.log(s, `🟢 Sesi Claude Code baru masuk kantor: ${ag.name}`);
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
      case 'SessionStart': sim.say(ag.id, '👋 Masuk kantor', 3); break;
      case 'UserPromptSubmit': {
        const p = short(String(ev.prompt || 'Tugas baru'), 30);
        VO.log(s, `📋 ${ag.name} menerima prompt: "${short(String(ev.prompt || ''), 80)}"`);
        sim.say('boss', '📋 ' + p, 3);
        if (rt) rt.liveTool = 'thinking';
        brief(ag, 'boss', { title: p });
        break;
      }
      case 'PreToolUse': {
        if (rt) rt.liveTool = ev.tool_name || 'tool';
        const d = toolDetail(ev);
        sim.say(ag.id, `🔧 ${ev.tool_name || 'tool'}${d ? ' · ' + d : ''}`, 2.5);
        break;
      }
      case 'PostToolUse': if (rt) rt.liveTool = 'thinking'; break;
      case 'SubagentStop': sim.say(ag.id, '🧩 Subagent selesai', 2.5); break;
      case 'Notification': sim.say(ag.id, '🔔 ' + short(String(ev.message || 'Butuh perhatian'), 34), 5); VO.log(s, `🔔 ${ag.name}: ${ev.message || ''}`); break;
      case 'Stop':
        if (rt) rt.liveTool = null;
        VO.log(s, `✅ ${ag.name} selesai merespons`);
        reportTo(ag, 'boss');
        break;
      case 'SessionEnd':
        VO.log(s, `👋 ${ag.name} pulang (sesi berakhir)`);
        sim.say(ag.id, '👋 Pulang dulu', 2);
        setTimeout(() => { VO.removeAgent(S(), ag.id); sim.dirty = true; sim.sync(S()); changed(); }, 2200);
        break;
      default: sim.say(ag.id, '⚡ ' + name, 2);
    }
    changed();
  };
})();
