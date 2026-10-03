/* =========================================================================
 * main.js — bootstrap aplikasi, game loop, input kamera & editor layout.
 * ========================================================================= */
(function () {
  const VO = window.VO;
  const T = VO.TILE;
  const R = VO.render;
  const sim = VO.sim;
  const $ = (id) => document.getElementById(id);

  const app = (VO.app = {
    state: null,
    sel: null,
    ui: { edit: false, tool: 'move', hoverTile: null },
    _dirty: true,
    _saveDirty: false,
  });

  /* ------------------------------------------------------------ perubahan state */
  app.changed = function () { app._dirty = true; app._saveDirty = true; };
  app.layoutChanged = function () {
    sim.dirty = true;
    R.staticDirty = true;
    sim.sync(app.state);
    sim.reseatAll(app.state);
    syncControls();
    app.changed();
  };
  app.select = function (sel, focus) {
    app.sel = sel;
    R.selected = sel && sel.kind === 'agent' ? sel.id : null;
    if (focus && sel) {
      const s = app.state;
      let p = null;
      if (sel.kind === 'agent') { const rt = sim.rt.get(sel.id); if (rt) p = { x: rt.x, y: rt.y }; }
      const rect = sel.kind === 'dept' ? s.departments.find((d) => d.id === sel.id)?.room
        : sel.kind === 'division' ? s.divisions.find((d) => d.id === sel.id)?.zone
        : sel.kind === 'facility' ? s.facilities.find((d) => d.id === sel.id) : null;
      if (rect) p = { x: (rect.x + rect.w / 2) * T, y: (rect.y + rect.h / 2) * T };
      if (p) R.focus($('office'), p.x, p.y);
    }
    app._dirty = true;
  };

  // perbesar zona divisi agar memuat semua ruang departemennya
  app.fitZone = function (div) {
    if (!div) return;
    const s = app.state;
    const rooms = s.departments.filter((d) => d.divisionId === div.id).map((d) => d.room);
    const z = div.zone;
    for (const r of rooms) {
      z.w = Math.max(z.w, r.x + r.w + 1 - z.x);
      z.h = Math.max(z.h, r.y + r.h + 1 - z.y);
    }
    s.map.w = Math.max(s.map.w, z.x + z.w + 2);
    s.map.h = Math.max(s.map.h, z.y + z.h + 2);
  };

  const rects = (s) => [...s.facilities, ...s.departments.map((d) => d.room), ...s.divisions.map((d) => d.zone)];
  const overlap = (a, b, m = 1) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

  app.findFreeRect = function (w, h) {
    const s = app.state;
    const all = rects(s);
    for (let y = 2; y + h < s.map.h - 1; y++)
      for (let x = 2; x + w < s.map.w - 1; x++) {
        const r = { x, y, w, h };
        if (!all.some((o) => overlap(r, o))) return r;
      }
    const bottom = Math.max(2, ...all.map((o) => o.y + o.h)) + 2;
    s.map.h = Math.max(s.map.h, bottom + h + 2);
    return { x: 2, y: bottom, w, h };
  };

  /* ------------------------------------------------------------ init */
  async function init() {
    VO.hydrateIcons();
    // Boss = pengguna yang login. Data kantor disimpan terpisah per akun.
    const me = await VO.ai.me();
    app.user = me && me.user;
    const storeId = (me && (me.id || me.user)) || '';
    if (storeId) VO.STORAGE_KEY = 'visual-office:v2:' + storeId.toLowerCase();
    $('who').classList.toggle('hidden', !app.user);
    $('btnLogout').classList.toggle('hidden', !(me && me.authRequired));

    let s = VO.load();
    // Mode database: kantor disimpan per akun di cloud (bisa dibuka di perangkat lain)
    if (me && me.cloud) {
      VO.cloud.enabled = true;
      try {
        const remote = await VO.cloud.load();
        if (remote.office) s = VO.migrate({ ...remote.office, docs: remote.docs || [] });
        else app._saveDirty = true; // akun baru: unggah kantor lokal (atau kosong)
      } catch (e) {
        VO.ui.toast(e.message + ' — memakai data lokal', 'alert');
      }
      $('who').title = 'Kamu adalah Boss · data tersimpan di cloud';
    }
    if (!s) { s = VO.defaultState(); app._saveDirty = true; }
    s.agents = s.agents.filter((a) => !a.live); // sesi live tidak bertahan setelah reload
    app.state = s;
    syncBoss();
    sim.sync(s);

    const canvas = $('office');
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, canvas.clientWidth * dpr);
      canvas.height = Math.max(1, canvas.clientHeight * dpr);
    };
    new ResizeObserver(resize).observe(canvas);
    resize();
    R.fit(canvas, s);

    bindTop();
    bindCanvas(canvas);
    bindEditBar();
    VO.ui.bindTree();
    VO.ui.bindInspector();
    VO.ui.bindDocs();
    bindTasks();
    syncControls();

    VO.ai.check().then(() => {
      // Gemini tersedia → mode AI aktif otomatis (kecuali Boss pernah mematikannya)
      if (VO.ai.available && !app.state.settings.aiModeTouched && !app.state.settings.aiMode) {
        app.state.settings.aiMode = true;
        $('aiMode').checked = true;
        app.changed();
      }
      aiPill();
      app._dirty = true;
      VO.ai.listen((ev) => VO.live.handle(ev)); // hanya aktif di server lokal
    });

    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      sim.update(app.state, dt);
      R.draw(canvas, app.state, app.ui);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    // panel UI di-refresh dengan ritme rendah agar ringan
    setInterval(() => {
      emptyStage();
      VO.ui.renderTree();
      VO.ui.renderInspector();
      if (app._dirty) {
        VO.ui.renderTargets();
        VO.ui.renderTasks();
        VO.ui.renderDocs();
        app._dirty = false;
      }
    }, 300);
    // simpan lokal tiap 2,5 dtk; ke cloud paling sering tiap 8 dtk (hemat kuota Upstash)
    let cloudDirty = false, lastCloud = 0;
    setInterval(() => {
      if (app._saveDirty) {
        app._saveDirty = false;
        cloudDirty = true;
        VO.save(app.state);
      }
      if (VO.cloud.enabled && cloudDirty && Date.now() - lastCloud > 8000) {
        cloudDirty = false;
        lastCloud = Date.now();
        VO.cloud.save(app.state).catch(() => { cloudDirty = true; });
      }
    }, 2500);
    window.addEventListener('beforeunload', () => VO.save(app.state));
  }

  function syncBoss() {
    const b = app.state.boss;
    if (app.user) b.name = app.user;
    b.role = 'Boss (Kamu)';
    $('whoName').textContent = b.name;
  }

  function emptyStage() {
    $('emptyStage').classList.toggle('hidden', app.state.divisions.length > 0 || app.ui.edit);
  }

  function aiPill() {
    const p = $('aiStatus');
    const s = app.state;
    p.innerHTML = VO.ai.available
      ? VO.icon('sparkles') + ' ' + VO.ai.label() + (s.settings.aiMode ? ' aktif' : ' siap')
      : VO.icon('dice') + ' Simulasi';
    p.title = VO.ai.reason;
    p.classList.toggle('on', VO.ai.available && s.settings.aiMode);
    $('aiMode').disabled = !VO.ai.available;
    $('aiMode').parentElement.title = VO.ai.available ? 'Agen mengerjakan tugas dengan AI sungguhan (' + VO.ai.reason + ')' : VO.ai.reason;
  }

  const THEMES = ['robot', 'modern', 'pixel'];
  const THEME_LABEL = { robot: 'Robot', modern: 'Modern (terang)', pixel: 'Pixel (gelap)' };
  const THEME_ICON = { robot: 'bot', modern: 'sun', pixel: 'moon' };
  function applyTheme() {
    const t = app.state.settings.theme || 'robot';
    document.body.classList.toggle('light', t !== 'pixel');
    const next = THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
    const b = $('btnTheme');
    b.innerHTML = VO.icon(THEME_ICON[t]);
    b.title = `Tampilan: ${THEME_LABEL[t]} — klik untuk ganti ke ${THEME_LABEL[next]}`;
  }

  function syncControls() {
    const s = app.state;
    applyTheme();
    $('companyName').value = s.company.name;
    $('ambient').checked = !!s.settings.ambient;
    $('aiMode').checked = !!s.settings.aiMode && VO.ai.available;
    $('speed').value = String(s.settings.speed || 1);
    $('rpm').value = String(s.settings.rpm || 10);
    $('floorSel').value = s.settings.floor;
    $('mapW').value = s.map.w;
    $('mapH').value = s.map.h;
    aiPill();
  }

  /* ------------------------------------------------------------ top bar */
  function setMode(edit) {
    app.ui.edit = edit;
    $('modeView').classList.toggle('active', !edit);
    $('modeEdit').classList.toggle('active', edit);
    $('editBar').classList.toggle('hidden', !edit);
    $('office').classList.toggle('edit', edit);
    $('hint').textContent = edit
      ? 'Drag ruangan/zona untuk memindah · drag kotak kecil di pojok kanan-bawah untuk ubah ukuran · klik kanan = hapus furnitur'
      : 'Scroll = zoom · Drag = geser kamera · Klik karyawan untuk detail · Klik 2× untuk edit';
  }

  function bindTop() {
    const s = () => app.state;
    $('companyName').addEventListener('change', (e) => { s().company.name = e.target.value.trim() || 'Kantor AI'; app.changed(); });
    $('modeView').onclick = () => setMode(false);
    $('modeEdit').onclick = () => setMode(true);
    $('ambient').onchange = (e) => { s().settings.ambient = e.target.checked; app.changed(); };
    $('aiMode').onchange = (e) => {
      s().settings.aiMode = e.target.checked;
      s().settings.aiModeTouched = true;
      aiPill(); app.changed();
      VO.ui.toast(e.target.checked ? `Tugas baru akan dikerjakan oleh ${VO.ai.label()}` : 'Kembali ke mode simulasi', e.target.checked ? 'sparkles' : 'dice');
    };
    $('rpm').onchange = (e) => { s().settings.rpm = parseInt(e.target.value, 10); app.changed(); };
    $('speed').onchange = (e) => { s().settings.speed = parseFloat(e.target.value); app.changed(); };
    $('btnFit').onclick = () => R.fit($('office'), s());
    $('btnTheme').onclick = () => {
      const st = s().settings;
      st.theme = THEMES[(THEMES.indexOf(st.theme || 'robot') + 1) % THEMES.length];
      applyTheme();
      R.staticDirty = true;
      app.changed();
      VO.ui.toast('Tampilan ' + THEME_LABEL[st.theme], THEME_ICON[st.theme]);
    };
    $('btnExport').onclick = () => {
      const blob = new Blob([JSON.stringify(s(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (s().company.name || 'kantor').replace(/[^\w-]+/g, '_') + '.office.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('btnImport').onclick = () => $('importFile').click();
    $('importFile').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const st = VO.migrate(JSON.parse(await f.text()));
        replaceState(st);
        VO.ui.toast('Kantor dimuat: ' + st.company.name, 'upload');
      } catch (err) {
        VO.ui.toast('Gagal import: ' + err.message, 'alert');
      }
      e.target.value = '';
    };
    $('btnReset').onclick = async () => {
      if (!(await VO.ui.confirm('Kosongkan kantor? Semua divisi, karyawan, tugas, dan dokumen akan dihapus.'))) return;
      replaceState(VO.emptyState());
      VO.ui.toast('Kantor dikosongkan — mulai dari nol', 'reset');
    };
    const loadSample = async () => {
      if (s().divisions.length && !(await VO.ui.confirm('Ganti kantor saat ini dengan kantor contoh?'))) return;
      replaceState(VO.sampleState(s()));
      VO.ui.toast('Kantor contoh dimuat', 'sparkles');
    };
    $('btnSample').onclick = loadSample;
    $('emptySample').onclick = loadSample;
    $('emptyAddDiv').onclick = () => VO.ui.addDivision();
    $('addDivision').onclick = () => VO.ui.addDivision();

    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input,textarea,select,dialog')) return;
      if (e.key === 'e' || e.key === 'E') setMode(!app.ui.edit);
      if (e.key === 'v' || e.key === 'V') setMode(false);
      if (e.key === 'f' || e.key === 'F') R.fit($('office'), app.state);
      if (e.key === 'Escape') { app.select(null); VO.chat.close(); }
      if (e.key === 'Delete' && app.sel && app.sel.id !== 'boss') VO.ui.remove(app.sel.kind, app.sel.id);
    });
  }

  function replaceState(st) {
    for (const rt of sim.rt.values()) sim.flush(rt);
    sim.rt.clear();
    app.state = st;
    syncBoss();
    app.sel = null;
    R.selected = null;
    app.layoutChanged();
    R.fit($('office'), st);
    VO.save(st);
    app._saveDirty = true;
  }

  /* ------------------------------------------------------------ edit bar */
  function bindEditBar() {
    const pal = $('furniturePalette');
    for (const [k, f] of Object.entries(VO.FURNITURE)) {
      const b = document.createElement('button');
      b.className = 'tool small';
      b.dataset.tool = 'furn:' + k;
      b.title = f.label;
      b.textContent = f.icon;
      pal.appendChild(b);
    }
    $('editBar').addEventListener('click', (e) => {
      const t = e.target.closest('[data-tool]');
      if (t) {
        app.ui.tool = t.dataset.tool;
        document.querySelectorAll('#editBar .tool').forEach((x) => x.classList.toggle('active', x === t));
      }
      const fac = e.target.closest('[data-fac]');
      if (fac) {
        const def = VO.FACILITY_TYPES[fac.dataset.fac];
        const spot = app.findFreeRect(def.w, def.h);
        const f = VO.addFacility(app.state, fac.dataset.fac, spot);
        VO.log(app.state, `Ruangan baru: ${f.name}`, 'door');
        app.layoutChanged();
        app.select({ kind: 'facility', id: f.id }, true);
      }
    });
    $('floorSel').innerHTML = Object.entries(VO.FLOORS).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join('');
    $('floorSel').onchange = (e) => { app.state.settings.floor = e.target.value; app.layoutChanged(); };
    const mapSize = () => {
      const s = app.state;
      s.map.w = VO.clamp(parseInt($('mapW').value, 10) || s.map.w, 30, 160);
      s.map.h = VO.clamp(parseInt($('mapH').value, 10) || s.map.h, 20, 120);
      app.layoutChanged();
    };
    $('mapW').onchange = mapSize;
    $('mapH').onchange = mapSize;
    $('btnAuto').onclick = () => {
      VO.autoLayout(app.state);
      app.layoutChanged();
      R.fit($('office'), app.state);
      VO.ui.toast('Layout dirapikan', 'wand');
    };
  }

  /* ------------------------------------------------------------ tugas */
  function bindTasks() {
    $('taskForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const title = $('taskTitle').value.trim();
      if (!title) return;
      const [targetType, targetId] = $('taskTarget').value.split(':');
      const t = VO.tasks.create({ title, targetType, targetId });
      $('taskTitle').value = '';
      VO.ui.toast(t.ai ? `Tugas dikirim — agen memakai ${VO.ai.label()}` : 'Tugas dikirim ke tim', 'send');
    });
    $('taskTitle').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('taskForm').requestSubmit();
    });
    document.querySelectorAll('.tab').forEach((tab) =>
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === tab));
        $('taskList').classList.toggle('hidden', tab.dataset.tab !== 'tasks');
        $('logList').classList.toggle('hidden', tab.dataset.tab !== 'log');
        $('docPane').classList.toggle('hidden', tab.dataset.tab !== 'docs');
      })
    );
    $('taskList').addEventListener('click', (e) => {
      const t = e.target.closest('.task');
      if (t) VO.ui.showTask(t.dataset.id);
    });
  }

  /* ------------------------------------------------------------ kanvas: kamera & editor */
  const MIN = { boss: [7, 6], meeting: [8, 7], pantry: [6, 5], lounge: [6, 5] };

  function hitTest(s, wx, wy) {
    const tx = Math.floor(wx / T), ty = Math.floor(wy / T);
    const inR = (r) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;
    const onHandle = (r) => wx >= (r.x + r.w) * T - 14 && wx <= (r.x + r.w) * T + 2 && wy >= (r.y + r.h) * T - 14 && wy <= (r.y + r.h) * T + 2;
    for (const d of s.departments) if (onHandle(d.room)) return { kind: 'dept', obj: d, rect: d.room, resize: true };
    for (const f of s.facilities) if (onHandle(f)) return { kind: 'facility', obj: f, rect: f, resize: true };
    for (const v of s.divisions) if (onHandle(v.zone)) return { kind: 'division', obj: v, rect: v.zone, resize: true };
    const fu = s.furniture.find((f) => f.x === tx && f.y === ty);
    if (fu) return { kind: 'furniture', obj: fu, rect: fu };
    for (const v of s.divisions) if (v.directorDesk.x === tx && (v.directorDesk.y === ty || v.directorDesk.y + 1 === ty)) return { kind: 'dirdesk', obj: v, rect: v.directorDesk };
    for (const d of s.departments) if (inR(d.room)) return { kind: 'dept', obj: d, rect: d.room };
    for (const f of s.facilities) if (inR(f)) return { kind: 'facility', obj: f, rect: f };
    for (const v of s.divisions) if (inR(v.zone)) return { kind: 'division', obj: v, rect: v.zone };
    return null;
  }

  function bindCanvas(canvas) {
    let drag = null;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return { sx: e.clientX - r.left, sy: e.clientY - r.top };
    };

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { sx, sy } = pos(e);
      const before = R.screenToIso(sx, sy);
      R.cam.zoom = VO.clamp(R.cam.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.2, 3);
      R.cam.x = before.x - sx / R.cam.zoom;
      R.cam.y = before.y - sy / R.cam.zoom;
    }, { passive: false });

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const { sx, sy } = pos(e);
      const w = R.screenToWorld(sx, sy);
      const s = app.state;
      const tile = { x: Math.floor(w.x / T), y: Math.floor(w.y / T) };
      const pan = { type: 'pan', sx, sy, cx: R.cam.x, cy: R.cam.y, moved: false };

      if (e.button !== 0) { drag = pan; return; }
      if (!app.ui.edit) { drag = { ...pan, click: w }; return; }

      // ---- mode edit
      const tool = app.ui.tool;
      if (tool === 'erase') { eraseAt(tile); drag = { type: 'erase' }; return; }
      if (tool.startsWith('furn:')) { placeAt(tool.slice(5), tile); drag = { type: 'place', kind: tool.slice(5) }; return; }
      const hit = hitTest(s, w.x, w.y);
      if (!hit) { drag = pan; return; }
      drag = { type: hit.resize ? 'resize' : 'move', hit, start: tile, orig: { ...hit.rect }, moved: false };
      if (['dept', 'facility', 'division'].includes(hit.kind)) app.select({ kind: hit.kind, id: hit.obj.id });
    });

    canvas.addEventListener('pointermove', (e) => {
      const { sx, sy } = pos(e);
      const w = R.screenToWorld(sx, sy);
      const s = app.state;
      const tile = { x: Math.floor(w.x / T), y: Math.floor(w.y / T) };
      app.ui.hoverTile = app.ui.edit && tile.x >= 0 && tile.y >= 0 && tile.x < s.map.w && tile.y < s.map.h ? tile : null;
      if (!drag) {
        const p = R.hitPerson(s, w.x, w.y);
        R.hover = p ? p.id : null;
        R.hoverObj = app.ui.edit ? hitTest(s, w.x, w.y)?.obj : null;
        canvas.style.cursor = app.ui.edit ? '' : p ? 'pointer' : '';
        return;
      }
      if (drag.type === 'pan') {
        if (Math.abs(sx - drag.sx) + Math.abs(sy - drag.sy) > 4) drag.moved = true;
        if (drag.moved) canvas.classList.add('dragging');
        R.cam.x = drag.cx - (sx - drag.sx) / R.cam.zoom;
        R.cam.y = drag.cy - (sy - drag.sy) / R.cam.zoom;
        return;
      }
      if (drag.type === 'erase') return eraseAt(tile);
      if (drag.type === 'place') return placeAt(drag.kind, tile);
      const dx = tile.x - drag.start.x, dy = tile.y - drag.start.y;
      if (!dx && !dy && !drag.moved) return;
      drag.moved = true;
      applyDrag(drag, dx, dy);
    });

    const up = (e) => {
      canvas.classList.remove('dragging');
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.type === 'pan' && !d.moved && d.click) clickSelect(d.click);
      if ((d.type === 'move' || d.type === 'resize') && d.moved) {
        if (d.hit.kind === 'dept') app.fitZone(app.state.divisions.find((v) => v.id === d.hit.obj.divisionId));
        app.layoutChanged();
      }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    canvas.addEventListener('dblclick', (e) => {
      if (app.ui.edit) return;
      const { sx, sy } = pos(e);
      const w = R.screenToWorld(sx, sy);
      const p = R.hitPerson(app.state, w.x, w.y);
      if (p) VO.ui.editEntity(p.id);
    });
  }

  function clickSelect(w) {
    const s = app.state;
    const p = R.hitPerson(s, w.x, w.y);
    if (p) {
      app.select({ kind: 'agent', id: p.id });
      if (p.id !== 'boss') VO.chat.open(p.id); // klik karyawan = buka chat
      return;
    }
    const hit = hitTest(s, w.x, w.y);
    if (hit && ['dept', 'facility', 'division'].includes(hit.kind)) return app.select({ kind: hit.kind, id: hit.obj.id });
    app.select(null);
  }

  function applyDrag(drag, dx, dy) {
    const s = app.state;
    const { hit, orig } = drag;
    const r = hit.rect;
    if (drag.type === 'move') {
      const nx = VO.clamp(orig.x + dx, 0, s.map.w - (orig.w || 1));
      const ny = VO.clamp(orig.y + dy, 0, s.map.h - (orig.h || 1));
      if (hit.kind === 'division') VO.setZone(s, hit.obj, { ...r, x: nx, y: ny }, true);
      else { r.x = nx; r.y = ny; }
    } else {
      let minW = 4, minH = 4;
      if (hit.kind === 'facility') [minW, minH] = MIN[hit.obj.type] || [6, 5];
      if (hit.kind === 'dept') {
        minW = 5; minH = 5;
        const need = VO.deptAgents(s, hit.obj.id).length;
        const nw = VO.clamp(orig.w + dx, minW, s.map.w - r.x);
        const nh = VO.clamp(orig.h + dy, minH, s.map.h - r.y);
        if (VO.deskSlots({ ...r, w: nw, h: nh }).length < need) return; // tidak muat semua meja
        r.w = nw; r.h = nh;
      } else {
        r.w = VO.clamp(orig.w + dx, minW, s.map.w - r.x);
        r.h = VO.clamp(orig.h + dy, minH, s.map.h - r.y);
      }
    }
    sim.dirty = true;
    R.staticDirty = true;
    sim.reseatAll(s);
  }

  function placeAt(type, t) {
    const s = app.state;
    if (t.x < 0 || t.y < 0 || t.x >= s.map.w || t.y >= s.map.h) return;
    if (s.furniture.some((f) => f.x === t.x && f.y === t.y)) return;
    s.furniture.push({ id: VO.uid('fu'), type, x: t.x, y: t.y });
    sim.dirty = true; R.staticDirty = true; app.changed();
  }
  function eraseAt(t) {
    const s = app.state;
    const n = s.furniture.length;
    s.furniture = s.furniture.filter((f) => !(f.x === t.x && f.y === t.y));
    if (n !== s.furniture.length) { sim.dirty = true; R.staticDirty = true; app.changed(); }
  }

  // klik kanan di mode edit = hapus furnitur
  document.addEventListener('DOMContentLoaded', () => {
    $('office').addEventListener('mousedown', (e) => {
      if (e.button === 2 && app.ui.edit) {
        const r = $('office').getBoundingClientRect();
        const w = R.screenToWorld(e.clientX - r.left, e.clientY - r.top);
        eraseAt({ x: Math.floor(w.x / T), y: Math.floor(w.y / T) });
      }
    });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
