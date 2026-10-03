/* =========================================================================
 * ui.js — panel samping: pohon organisasi, inspector, daftar tugas, log,
 * dan dialog form generik.
 * ========================================================================= */
(function () {
  const VO = window.VO;
  const $ = (id) => document.getElementById(id);
  const esc = VO.esc;
  const ui = (VO.ui = {});
  const S = () => VO.app.state;

  /* ------------------------------------------------------------ toast & dialog */
  let toastT;
  ui.toast = function (msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2200);
  };

  /** fields: [{key,label,type,value,options,placeholder}] → Promise<object|null> */
  ui.form = function (title, fields, okLabel = 'Simpan') {
    const dlg = $('dlg');
    $('dlgTitle').textContent = title;
    $('dlgOk').textContent = okLabel;
    $('dlgBody').innerHTML = fields.map((f) => {
      const id = 'f_' + f.key;
      if (f.type === 'select')
        return `<div class="field"><label for="${id}">${esc(f.label)}</label><select id="${id}">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`;
      if (f.type === 'textarea')
        return `<div class="field"><label for="${id}">${esc(f.label)}</label><textarea id="${id}" rows="4" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea></div>`;
      if (f.type === 'colors')
        return `<div class="field"><label>${esc(f.label)}</label><div class="colors">${f.value.map((c, i) => `<label title="${esc(f.names[i])}"><input type="color" id="${id}_${i}" value="${esc(c)}"/></label>`).join('')}</div></div>`;
      if (f.type === 'checkbox')
        return `<div class="field inline"><input type="checkbox" id="${id}" ${f.value ? 'checked' : ''}/><label for="${id}">${esc(f.label)}</label></div>`;
      return `<div class="field"><label for="${id}">${esc(f.label)}</label><input type="text" id="${id}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''}/></div>`;
    }).join('');
    dlg.returnValue = '';
    dlg.showModal();
    const first = dlg.querySelector('input,select,textarea');
    if (first) first.focus();
    return new Promise((resolve) => {
      dlg.addEventListener('close', function h() {
        dlg.removeEventListener('close', h);
        if (dlg.returnValue !== 'ok') return resolve(null);
        const out = {};
        for (const f of fields) {
          const id = 'f_' + f.key;
          if (f.type === 'colors') out[f.key] = f.value.map((_, i) => $(id + '_' + i).value);
          else if (f.type === 'checkbox') out[f.key] = $(id).checked;
          else out[f.key] = $(id).value.trim();
        }
        resolve(out);
      });
    });
  };

  ui.confirm = async function (msg) {
    return (await ui.form(msg, [], 'Ya, lanjutkan')) !== null;
  };

  /* ------------------------------------------------------------ aksi CRUD */
  const app = () => VO.app;

  ui.addDivision = async function () {
    const v = await ui.form('Tambah Divisi', [
      { key: 'name', label: 'Nama divisi', value: '', placeholder: 'mis. Riset & Pengembangan', required: true },
      { key: 'director', label: 'Jabatan direktur (kosongkan bila tanpa direktur)', value: 'Direktur' },
      { key: 'color', label: 'Warna', type: 'colors', value: [VO.PALETTE[S().divisions.length % VO.PALETTE.length]], names: ['Warna divisi'] },
    ]);
    if (!v || !v.name) return;
    const s = S();
    const div = VO.addDivision(s, { name: v.name, color: v.color[0], directorRole: v.director || null });
    const spot = app().findFreeRect(14, 11);
    VO.setZone(s, div, { x: spot.x, y: spot.y, w: 14, h: 11 }, false);
    div.directorDesk = { x: spot.x + 2, y: spot.y + 1 };
    VO.log(s, `🏛 Divisi baru: ${div.name}`);
    app().layoutChanged();
    app().select({ kind: 'division', id: div.id });
  };

  ui.addDept = async function (divisionId) {
    const s = S();
    const v = await ui.form('Tambah Departemen', [
      { key: 'name', label: 'Nama departemen', value: '', placeholder: 'mis. Customer Support', required: true },
      { key: 'divisionId', label: 'Divisi', type: 'select', value: divisionId, options: s.divisions.map((d) => ({ value: d.id, label: d.name })) },
      { key: 'lead', label: 'Jabatan ketua tim', value: 'Team Lead' },
      { key: 'count', label: 'Jumlah anggota awal (selain ketua)', value: '2' },
    ]);
    if (!v || !v.name) return;
    const div = s.divisions.find((d) => d.id === v.divisionId);
    const dept = VO.addDepartment(s, v.divisionId, { name: v.name });
    // taruh di kanan departemen terakhir dalam zona
    const sibs = s.departments.filter((d) => d.divisionId === v.divisionId && d !== dept);
    const rx = sibs.length ? Math.max(...sibs.map((d) => d.room.x + d.room.w)) + 1 : div.zone.x + 1;
    dept.room = { x: rx, y: div.zone.y + 4, w: 9, h: 6 };
    VO.addAgent(s, dept.id, { role: v.lead || 'Team Lead', isLead: true });
    const n = VO.clamp(parseInt(v.count, 10) || 0, 0, 20);
    for (let i = 0; i < n; i++) VO.addAgent(s, dept.id, { role: 'Staff' });
    app().fitZone(div);
    VO.log(s, `🏢 Departemen baru: ${dept.name} (${n + 1} agen)`);
    app().layoutChanged();
    app().select({ kind: 'dept', id: dept.id });
  };

  ui.addAgent = async function (deptId) {
    const s = S();
    const v = await agentForm('Rekrut Agen Baru', VO.makeAgent({ deptId, role: 'Staff' }), true);
    if (!v) return;
    const a = VO.addAgent(s, deptId, v);
    const dept = s.departments.find((d) => d.id === deptId);
    app().fitZone(s.divisions.find((d) => d.id === dept.divisionId));
    VO.log(s, `🤝 ${a.name} bergabung sebagai ${a.role} di ${dept.name}`);
    app().layoutChanged();
    app().select({ kind: 'agent', id: a.id });
  };

  async function agentForm(title, a, isNew) {
    const s = S();
    const fields = [
      { key: 'name', label: 'Nama', value: a.name, required: true },
      { key: 'role', label: 'Jabatan / peran', value: a.role },
      { key: 'model', label: 'Model AI', type: 'select', value: a.model, options: VO.MODELS.map((m) => ({ value: m.id, label: m.label })) },
      { key: 'prompt', label: 'Instruksi / kepribadian (system prompt)', type: 'textarea', value: a.prompt, placeholder: 'mis. Kamu ahli SEO yang teliti dan suka data.' },
      { key: 'colors', label: 'Penampilan (baju · rambut · kulit)', type: 'colors', value: [a.shirt, a.hair, a.skin], names: ['Baju', 'Rambut', 'Kulit'] },
    ];
    if (a.id !== 'boss' && !a.isDirector && !a.live) {
      fields.push({ key: 'deptId', label: 'Departemen', type: 'select', value: a.deptId, options: s.departments.map((d) => ({ value: d.id, label: (s.divisions.find((x) => x.id === d.divisionId)?.name || '') + ' › ' + d.name })) });
      fields.push({ key: 'isLead', label: 'Jadikan ketua tim (lead)', type: 'checkbox', value: a.isLead });
    }
    const v = await ui.form(title, fields, isNew ? 'Rekrut' : 'Simpan');
    if (!v || !v.name) return null;
    const [shirt, hair, skin] = v.colors;
    const out = { name: v.name, role: v.role || 'Staff', model: v.model, prompt: v.prompt, shirt, hair, skin };
    if ('deptId' in v) { out.deptId = v.deptId; out.isLead = v.isLead; }
    return out;
  }

  ui.editEntity = async function (id) {
    const s = S();
    const a = VO.findEntity(s, id);
    if (!a) return;
    const v = await agentForm('Edit ' + a.name, a, false);
    if (!v) return;
    const oldDept = a.deptId;
    Object.assign(a, v);
    if (v.deptId && v.deptId !== oldDept) {
      a.divisionId = s.departments.find((d) => d.id === v.deptId)?.divisionId;
      const dept = s.departments.find((d) => d.id === v.deptId);
      VO.ensureRoomCapacity(s, dept);
      app().fitZone(s.divisions.find((d) => d.id === dept.divisionId));
      VO.log(s, `🔀 ${a.name} pindah ke ${dept.name}`);
    }
    if (v.isLead) s.agents.filter((x) => x.deptId === a.deptId && x !== a).forEach((x) => (x.isLead = false));
    app().layoutChanged();
  };

  ui.editDivision = async function (id) {
    const s = S();
    const div = s.divisions.find((d) => d.id === id);
    const dir = VO.director(s, id);
    const v = await ui.form('Edit Divisi', [
      { key: 'name', label: 'Nama divisi', value: div.name, required: true },
      { key: 'color', label: 'Warna', type: 'colors', value: [div.color], names: ['Warna'] },
      { key: 'hasDir', label: 'Punya direktur divisi', type: 'checkbox', value: !!dir },
    ]);
    if (!v) return;
    div.name = v.name || div.name;
    div.color = v.color[0];
    if (v.hasDir && !dir) s.agents.push(VO.makeAgent({ divisionId: id, isDirector: true, role: 'Direktur ' + div.name, shirt: '#2d3142' }));
    if (!v.hasDir && dir) VO.removeAgent(s, dir.id);
    app().layoutChanged();
  };

  ui.editDept = async function (id) {
    const s = S();
    const d = s.departments.find((x) => x.id === id);
    const v = await ui.form('Edit Departemen', [
      { key: 'name', label: 'Nama departemen', value: d.name, required: true },
      { key: 'divisionId', label: 'Divisi', type: 'select', value: d.divisionId, options: s.divisions.map((x) => ({ value: x.id, label: x.name })) },
    ]);
    if (!v) return;
    d.name = v.name || d.name;
    if (v.divisionId !== d.divisionId) {
      d.divisionId = v.divisionId;
      s.agents.filter((a) => a.deptId === d.id).forEach((a) => (a.divisionId = v.divisionId));
      VO.log(s, `🔀 Departemen ${d.name} pindah ke divisi ${s.divisions.find((x) => x.id === v.divisionId).name} (klik 🪄 Tata Otomatis untuk merapikan)`);
    }
    app().layoutChanged();
  };

  ui.editFacility = async function (id) {
    const f = S().facilities.find((x) => x.id === id);
    const v = await ui.form('Edit Ruangan', [
      { key: 'name', label: 'Nama ruangan', value: f.name, required: true },
      { key: 'color', label: 'Warna', type: 'colors', value: [f.color], names: ['Warna'] },
    ]);
    if (!v) return;
    f.name = v.name || f.name;
    f.color = v.color[0];
    app().layoutChanged();
  };

  ui.remove = async function (kind, id) {
    const s = S();
    const names = {
      division: () => 'divisi ' + s.divisions.find((d) => d.id === id).name + ' beserta semua departemen & agennya',
      dept: () => 'departemen ' + s.departments.find((d) => d.id === id).name + ' beserta semua agennya',
      agent: () => VO.findEntity(s, id).name,
      facility: () => s.facilities.find((f) => f.id === id).name,
    };
    if (!(await ui.confirm('Hapus ' + names[kind]() + '?'))) return;
    if (kind === 'division') VO.removeDivision(s, id);
    if (kind === 'dept') VO.removeDepartment(s, id);
    if (kind === 'agent') { const a = VO.findEntity(s, id); VO.removeAgent(s, id); VO.log(s, `👋 ${a.name} keluar dari perusahaan`); }
    if (kind === 'facility') s.facilities = s.facilities.filter((f) => f.id !== id);
    app().select(null);
    app().layoutChanged();
  };

  ui.makeLead = function (id) {
    const s = S();
    const a = VO.findEntity(s, id);
    s.agents.filter((x) => x.deptId === a.deptId).forEach((x) => (x.isLead = x === a));
    VO.log(s, `⭐ ${a.name} sekarang ketua tim`);
    app().layoutChanged();
  };

  ui.assign = function (type, id) {
    const sel = $('taskTarget');
    sel.value = type + ':' + id;
    $('taskTitle').focus();
  };

  /* ------------------------------------------------------------ pohon organisasi */
  const acts = (btns) => `<span class="acts">${btns.map(([a, t, ic]) => `<button class="icon" data-act="${a}" title="${t}">${ic}</button>`).join('')}</span>`;

  ui.renderTree = function () {
    const s = S();
    const sel = VO.app.sel;
    const isSel = (k, id) => sel && sel.kind === k && sel.id === id ? 'sel' : '';
    const busy = (id) => (VO.sim.isBusy(id) ? '<span class="badge busy">sibuk</span>' : '');
    let h = `<div class="node boss ${isSel('agent', 'boss')}" data-kind="agent" data-id="boss"><span>👑</span><span class="name">${esc(s.boss.name)} <span class="sub">· ${esc(s.boss.role)}</span></span>${acts([['edit', 'Edit', '✏️']])}</div>`;
    for (const div of s.divisions) {
      const depts = s.departments.filter((d) => d.divisionId === div.id);
      h += `<div class="node div ${isSel('division', div.id)}" data-kind="division" data-id="${div.id}"><span class="dot" style="background:${esc(div.color)}"></span><span class="name">${esc(div.name)}</span>${acts([['addDept', 'Tambah departemen', '＋'], ['assign', 'Beri tugas', '📋'], ['edit', 'Edit', '✏️'], ['del', 'Hapus', '🗑']])}</div>`;
      const dir = VO.director(s, div.id);
      if (dir) h += `<div class="node director ${isSel('agent', dir.id)}" data-kind="agent" data-id="${dir.id}"><span>👔</span><span class="name">${esc(dir.name)} <span class="sub">· ${esc(dir.role)}</span></span>${busy(dir.id)}${acts([['edit', 'Edit', '✏️'], ['del', 'Hapus', '🗑']])}</div>`;
      for (const d of depts) {
        const ag = VO.deptAgents(s, d.id);
        h += `<div class="node dept ${isSel('dept', d.id)}" data-kind="dept" data-id="${d.id}"><span>🏢</span><span class="name">${esc(d.name)}</span><span class="badge">${ag.length}</span>${acts([['addAgent', 'Rekrut agen', '＋'], ['assign', 'Beri tugas', '📋'], ['edit', 'Edit', '✏️'], ['del', 'Hapus', '🗑']])}</div>`;
        for (const a of ag)
          h += `<div class="node agent ${isSel('agent', a.id)}" data-kind="agent" data-id="${a.id}"><span>${a.live ? '🟠' : a.isLead ? '⭐' : '🤖'}</span><span class="name">${esc(a.name)} <span class="sub">· ${esc(a.role)}</span></span>${busy(a.id)}${acts([['assign', 'Beri tugas', '📋'], ['edit', 'Edit', '✏️'], ['del', 'Hapus', '🗑']])}</div>`;
      }
    }
    if (!s.divisions.length) h += `<p class="empty">Belum ada divisi. Klik <b>+ Divisi</b> untuk mulai membangun kantor.</p>`;
    h += `<div class="node" style="margin-top:10px;color:var(--muted)" data-kind="none"><span>🚪</span><span class="name">Fasilitas</span></div>`;
    for (const f of s.facilities)
      h += `<div class="node dept ${isSel('facility', f.id)}" data-kind="facility" data-id="${f.id}"><span class="dot" style="background:${esc(f.color)}"></span><span class="name">${esc(f.name)}</span>${acts(f.type === 'boss' ? [['edit', 'Edit', '✏️']] : [['edit', 'Edit', '✏️'], ['del', 'Hapus', '🗑']])}</div>`;
    const tree = $('orgTree');
    if (tree._html !== h) { tree.innerHTML = h; tree._html = h; }

    const nAg = s.agents.length;
    const nBusy = s.agents.filter((a) => VO.sim.isBusy(a.id)).length;
    $('stats').innerHTML = `<span>🏛 ${s.divisions.length} divisi</span><span>🏢 ${s.departments.length} dept</span><span>🤖 ${nAg} agen</span><span>⚡ ${nBusy} sibuk</span>`;
  };

  ui.bindTree = function () {
    $('orgTree').addEventListener('click', (e) => {
      const node = e.target.closest('.node');
      if (!node || node.dataset.kind === 'none') return;
      const { kind, id } = node.dataset;
      const btn = e.target.closest('button[data-act]');
      if (!btn) { VO.app.select({ kind, id }, true); return; }
      const act = btn.dataset.act;
      if (act === 'edit') ({ agent: ui.editEntity, division: ui.editDivision, dept: ui.editDept, facility: ui.editFacility })[kind](id);
      if (act === 'del') ui.remove(kind, id);
      if (act === 'addDept') ui.addDept(id);
      if (act === 'addAgent') ui.addAgent(id);
      if (act === 'assign') ui.assign(kind === 'division' ? 'division' : kind === 'dept' ? 'dept' : 'agent', id);
    });
  };

  /* ------------------------------------------------------------ inspector */
  const STATUS_TXT = { idle: 'Santai di meja', walking: 'Berjalan', working: 'Bekerja 💻', coffee: 'Ngopi ☕', meeting: 'Rapat 👥', briefing: 'Menerima briefing 📋', reporting: 'Melapor 📨', chat: 'Ngobrol 💬', break: 'Istirahat 🌿' };

  ui.renderInspector = function () {
    const s = S();
    const sel = VO.app.sel;
    const el = $('inspector');
    let h = '';
    if (!sel) {
      h = `<h3>🔍 Inspector</h3><p class="empty">Klik karyawan, ruangan, atau item di struktur organisasi untuk melihat detail.<br/><br/>👑 <b>Boss</b> memberi perintah → 👔 <b>Direktur</b> → ⭐ <b>Ketua tim</b> → 🤖 <b>Anggota</b>. Setiap level briefing, bekerja, lalu melapor balik.</p>`;
    } else if (sel.kind === 'agent') {
      const a = VO.findEntity(s, sel.id);
      if (!a) return VO.app.select(null);
      const rt = VO.sim.rt.get(a.id);
      const dept = s.departments.find((d) => d.id === a.deptId);
      const div = s.divisions.find((d) => d.id === a.divisionId);
      const model = VO.MODELS.find((m) => m.id === a.model)?.label || a.model;
      const running = s.tasks.flatMap((t) => t.subtasks.filter((st) => st.agentId === a.id && st.status === 'working').map((st) => t.title));
      const icon = a.id === 'boss' ? '👑' : a.isDirector ? '👔' : a.isLead ? '⭐' : a.live ? '🟠' : '🤖';
      h = `<div class="insp-head"><div class="avatar" style="background:${esc(a.shirt)}"><span style="font-size:22px">${icon}</span></div><div><div class="insp-name">${esc(a.name)}</div><div class="insp-role">${esc(a.role)}</div></div></div>
        <div class="kv">
          <span>Status</span><span>${esc(rt?.liveTool && rt.liveTool !== 'thinking' ? 'Pakai tool: ' + rt.liveTool : STATUS_TXT[rt?.status] || rt?.status || '-')}</span>
          <span>Model</span><span>${esc(model)}</span>
          ${div ? `<span>Divisi</span><span>${esc(div.name)}</span>` : ''}
          ${dept ? `<span>Departemen</span><span>${esc(dept.name)}</span>` : ''}
          ${running.length ? `<span>Mengerjakan</span><span>${running.map(esc).join('<br/>')}</span>` : ''}
          ${a.prompt ? `<span>Instruksi</span><span>${esc(a.prompt)}</span>` : ''}
        </div>
        <div class="btns">
          <button class="small" data-i="edit">✏️ Edit</button>
          ${a.id !== 'boss' ? `<button class="small" data-i="assign">📋 Beri tugas</button>` : ''}
          ${a.deptId && !a.isLead && !a.live ? `<button class="small" data-i="lead">⭐ Jadikan lead</button>` : ''}
          ${a.id !== 'boss' ? `<button class="small danger" data-i="del">🗑 Hapus</button>` : ''}
        </div>`;
    } else if (sel.kind === 'dept') {
      const d = s.departments.find((x) => x.id === sel.id);
      if (!d) return VO.app.select(null);
      const ag = VO.deptAgents(s, d.id);
      const div = s.divisions.find((x) => x.id === d.divisionId);
      h = `<div class="insp-head"><div class="avatar" style="background:${esc(div?.color || '#555')}"><span style="font-size:22px">🏢</span></div><div><div class="insp-name">${esc(d.name)}</div><div class="insp-role">Departemen · ${esc(div?.name || '-')}</div></div></div>
        <div class="kv"><span>Ketua</span><span>${esc(ag[0]?.name || '-')}</span><span>Anggota</span><span>${ag.length} agen</span><span>Kapasitas</span><span>${VO.deskSlots(d.room).length} meja</span></div>
        <div class="btns"><button class="small" data-i="addAgent">＋ Rekrut agen</button><button class="small" data-i="assign">📋 Beri tugas</button><button class="small" data-i="edit">✏️ Edit</button><button class="small danger" data-i="del">🗑 Hapus</button></div>`;
    } else if (sel.kind === 'division') {
      const d = s.divisions.find((x) => x.id === sel.id);
      if (!d) return VO.app.select(null);
      const depts = s.departments.filter((x) => x.divisionId === d.id);
      const dir = VO.director(s, d.id);
      h = `<div class="insp-head"><div class="avatar" style="background:${esc(d.color)}"><span style="font-size:22px">🏛</span></div><div><div class="insp-name">${esc(d.name)}</div><div class="insp-role">Divisi</div></div></div>
        <div class="kv"><span>Direktur</span><span>${esc(dir?.name || '— (tanpa direktur)')}</span><span>Departemen</span><span>${depts.map((x) => esc(x.name)).join(', ') || '-'}</span><span>Total agen</span><span>${s.agents.filter((a) => a.divisionId === d.id).length}</span></div>
        <div class="btns"><button class="small" data-i="addDept">＋ Departemen</button><button class="small" data-i="assign">📋 Beri tugas</button><button class="small" data-i="edit">✏️ Edit</button><button class="small danger" data-i="del">🗑 Hapus</button></div>`;
    } else if (sel.kind === 'facility') {
      const f = s.facilities.find((x) => x.id === sel.id);
      if (!f) return VO.app.select(null);
      h = `<div class="insp-head"><div class="avatar" style="background:${esc(f.color)}"><span style="font-size:22px">🚪</span></div><div><div class="insp-name">${esc(f.name)}</div><div class="insp-role">${esc(VO.FACILITY_TYPES[f.type].label)} · ${f.w}×${f.h}</div></div></div>
        <div class="btns" style="margin-top:10px"><button class="small" data-i="edit">✏️ Edit</button>${f.type !== 'boss' ? '<button class="small danger" data-i="del">🗑 Hapus</button>' : ''}</div>`;
    }
    if (el._html !== h) { el.innerHTML = h; el._html = h; }
  };

  ui.bindInspector = function () {
    $('inspector').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      const sel = VO.app.sel;
      if (!b || !sel) return;
      const i = b.dataset.i;
      if (i === 'edit') ({ agent: ui.editEntity, division: ui.editDivision, dept: ui.editDept, facility: ui.editFacility })[sel.kind](sel.id);
      if (i === 'del') ui.remove(sel.kind, sel.id);
      if (i === 'lead') ui.makeLead(sel.id);
      if (i === 'addAgent') ui.addAgent(sel.id);
      if (i === 'addDept') ui.addDept(sel.id);
      if (i === 'assign') ui.assign(sel.kind, sel.id);
    });
  };

  /* ------------------------------------------------------------ tugas & log */
  ui.renderTargets = function () {
    const s = S();
    const sel = $('taskTarget');
    const cur = sel.value;
    let h = `<option value="all:">🏢 Seluruh kantor (rapat besar)</option>`;
    for (const div of s.divisions) {
      h += `<optgroup label="🏛 ${esc(div.name)}"><option value="division:${div.id}">Seluruh divisi ${esc(div.name)}</option>`;
      for (const d of s.departments.filter((x) => x.divisionId === div.id)) {
        h += `<option value="dept:${d.id}">› Tim ${esc(d.name)}</option>`;
        for (const a of VO.deptAgents(s, d.id)) h += `<option value="agent:${a.id}">   · ${esc(a.name)} (${esc(a.role)})</option>`;
      }
      h += `</optgroup>`;
    }
    if (sel._html !== h) {
      sel.innerHTML = h; sel._html = h;
      if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
    }
  };

  const ST_TXT = { briefing: 'briefing', meeting: 'rapat', in_progress: 'dikerjakan', done: 'selesai', failed: 'gagal' };
  const fmtTime = (t) => new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  ui.renderTasks = function () {
    const s = S();
    const tl = $('taskList');
    let h = '';
    for (const t of s.tasks) {
      const n = t.subtasks.length;
      const p = t.status === 'done' ? 1 : n ? t.subtasks.reduce((a, b) => a + (b.progress || 0), 0) / n : 0.03;
      h += `<div class="task" data-id="${t.id}"><div class="t">${esc(t.title)}</div>
        <div class="meta"><span class="st ${t.status}">${ST_TXT[t.status] || t.status}</span><span>→ ${esc(VO.tasks.targetLabel(s, t.targetType, t.targetId))}</span><span>· ${n} subtugas</span>${t.ai ? '<span>· 🧠 AI</span>' : ''}</div>
        <div class="bar"><i style="width:${Math.round(p * 100)}%"></i></div></div>`;
    }
    if (!h) h = `<p class="empty">Belum ada tugas. Tulis perintah di atas lalu klik <b>Kirim</b> — lihat bagaimana kantor bergerak!</p>`;
    if (tl._html !== h) { tl.innerHTML = h; tl._html = h; }

    const ll = $('logList');
    const lh = s.log.slice(0, 120).map((l) => `<div class="log"><time>${fmtTime(l.t)}</time>${esc(l.text)}</div>`).join('');
    if (ll._html !== lh) { ll.innerHTML = lh; ll._html = lh; }
  };

  // markdown mini: judul, tebal, miring, kode inline, bullet
  ui.md = function (text) {
    return esc(text || '')
      .replace(/^#{1,6} (.*)$/gm, '<b style="color:var(--accent)">$1</b>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(^|\W)_(.+?)_(?=\W|$)/g, '$1<i>$2</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^[-*] /gm, '• ');
  };

  ui.showTask = function (id) {
    const s = S();
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return;
    $('resultTitle').textContent = '📋 ' + t.title;
    let h = `<div><b>Status:</b> ${ST_TXT[t.status] || t.status} · <b>Target:</b> ${esc(VO.tasks.targetLabel(s, t.targetType, t.targetId))} · <b>Mode:</b> ${t.ai ? 'Claude API' : 'Simulasi'}</div>`;
    if (t.note) h += `<div style="color:#ef9a9a">${esc(t.note)}</div>`;
    if (t.result) h += `<h4>🧾 Laporan akhir</h4><div>${ui.md(t.result)}</div>`;
    h += `<h4>👥 Hasil per agen</h4>`;
    for (const st of t.subtasks) h += `<div class="sub"><b>${esc(st.agentName)}</b> <span style="color:var(--muted)">(${esc(st.role)}) · ${esc(st.status)} ${Math.round((st.progress || 0) * 100)}%</span>\n${ui.md(st.output || '…')}</div>`;
    $('resultBody').innerHTML = h;
    $('resultDlg').showModal();
  };
})();
