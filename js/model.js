/* =========================================================================
 * model.js — data kantor: struktur organisasi, layout ruangan, persistensi.
 * Semua koordinat layout dalam satuan TILE (grid), bukan pixel.
 * ========================================================================= */
(function () {
  const VO = (window.VO = window.VO || {});

  VO.TILE = 32;
  VO.STORAGE_KEY = 'visual-office:v1';

  VO.uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);
  VO.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  VO.rand = (a, b) => a + Math.random() * (b - a);
  VO.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  VO.esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  VO.PALETTE = ['#4f8cff', '#ff7a59', '#2ec4b6', '#ffbf3c', '#9b5de5', '#f15bb5', '#00bbf9', '#8ac926', '#e76f51'];
  VO.SKINS = ['#f6d5bd', '#eab894', '#c98b62', '#8d5a3b', '#5e3b26'];
  VO.HAIRS = ['#2b1d14', '#4a3020', '#7a4a22', '#c9a15b', '#d0d0d0', '#151515', '#a33b20', '#3d2b5c'];
  VO.SHIRTS = ['#4f8cff', '#ff7a59', '#2ec4b6', '#ffbf3c', '#9b5de5', '#f15bb5', '#3a86ff', '#8ac926', '#ef476f', '#118ab2'];

  VO.MODELS = [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ];

  VO.FURNITURE = {
    plant: { label: 'Tanaman', icon: '🪴' },
    sofa: { label: 'Sofa', icon: '🛋️' },
    bookshelf: { label: 'Rak Buku', icon: '📚' },
    whiteboard: { label: 'Whiteboard', icon: '📋' },
    cooler: { label: 'Dispenser', icon: '🚰' },
    printer: { label: 'Printer', icon: '🖨️' },
    server: { label: 'Server Rack', icon: '🗄️' },
    arcade: { label: 'Arcade', icon: '🕹️' },
  };

  VO.FACILITY_TYPES = {
    boss: { label: 'Ruang Boss', w: 10, h: 8, color: '#5b4636' },
    meeting: { label: 'Ruang Rapat', w: 12, h: 8, color: '#3d5a80' },
    pantry: { label: 'Pantry', w: 9, h: 8, color: '#6a994e' },
    lounge: { label: 'Lounge', w: 9, h: 8, color: '#9d4edd' },
  };

  VO.FLOORS = {
    wood: { label: 'Kayu', a: '#c9a27a', b: '#bf966d' },
    tile: { label: 'Keramik', a: '#d9dde3', b: '#cfd4db' },
    dark: { label: 'Gelap', a: '#2f3542', b: '#2a2f3b' },
    mint: { label: 'Mint', a: '#cfe8dc', b: '#c3dfd1' },
  };

  const FIRST = ['Andi', 'Budi', 'Citra', 'Dewi', 'Eka', 'Fajar', 'Gita', 'Hadi', 'Indah', 'Joko', 'Kirana', 'Lukman', 'Maya', 'Nanda', 'Oki', 'Putri', 'Rama', 'Sari', 'Tono', 'Umi', 'Vina', 'Wawan', 'Yudi', 'Zahra', 'Bayu', 'Laras', 'Raka', 'Tiara'];
  VO.randomName = () => VO.pick(FIRST) + ' ' + VO.pick(['AI', 'Bot', '-01', '-02', '-X', 'GPT', 'Agent', 'Prime', 'Nova', 'Byte']);

  VO.makeAgent = (o = {}) => ({
    id: o.id || VO.uid('ag'),
    name: o.name || VO.randomName(),
    role: o.role || 'Staff',
    model: o.model || 'claude-opus-5-5',
    prompt: o.prompt || '',
    deptId: o.deptId || null,
    divisionId: o.divisionId || null,
    isLead: !!o.isLead,
    isDirector: !!o.isDirector,
    skin: o.skin || VO.pick(VO.SKINS),
    hair: o.hair || VO.pick(VO.HAIRS),
    shirt: o.shirt || VO.pick(VO.SHIRTS),
    live: !!o.live,
  });

  /* ---------------------------------------------------------------- default */
  VO.defaultState = function () {
    const s = {
      version: 1,
      company: { name: 'Nusantara AI Corp' },
      settings: { floor: 'wood', ambient: true, aiMode: false, speed: 1 },
      map: { w: 64, h: 44 },
      boss: VO.makeAgent({ id: 'boss', name: 'Pak Bos', role: 'CEO', model: 'claude-opus-5-5', shirt: '#1f2430', hair: '#1c1c1c', prompt: 'Kamu CEO perusahaan. Tegas, strategis, fokus pada hasil.' }),
      facilities: [],
      divisions: [],
      departments: [],
      agents: [],
      furniture: [],
      tasks: [],
      log: [],
    };
    for (const t of ['boss', 'meeting', 'pantry']) VO.addFacility(s, t);

    const org = [
      ['Teknologi', '#4f8cff', 'CTO', [
        ['Engineering', [['Tech Lead', 1], ['Backend Engineer'], ['Frontend Engineer'], ['QA Engineer']]],
        ['Data & AI', [['Head of Data', 1], ['Data Scientist'], ['ML Engineer']]],
      ]],
      ['Bisnis', '#ff7a59', 'CMO', [
        ['Marketing', [['Marketing Lead', 1], ['Copywriter'], ['Social Media Specialist']]],
        ['Sales', [['Sales Manager', 1], ['Account Executive']]],
      ]],
      ['Operasional', '#2ec4b6', 'COO', [
        ['HR', [['HR Manager', 1], ['Recruiter']]],
        ['Finance', [['Finance Manager', 1], ['Accountant']]],
      ]],
    ];
    for (const [dName, color, dirRole, depts] of org) {
      const div = VO.addDivision(s, { name: dName, color, directorRole: dirRole });
      for (const [deptName, roles] of depts) {
        const dept = VO.addDepartment(s, div.id, { name: deptName });
        for (const [role, lead] of roles) VO.addAgent(s, dept.id, { role, isLead: !!lead });
      }
    }
    // dekorasi
    const deco = [['plant', 1, 1], ['plant', 36, 1], ['cooler', 37, 5], ['printer', 37, 7], ['bookshelf', 38, 2], ['sofa', 40, 2], ['arcade', 42, 2], ['plant', 44, 2]];
    for (const [type, x, y] of deco) s.furniture.push({ id: VO.uid('fu'), type, x, y });
    VO.autoLayout(s);
    VO.log(s, '🏢 Kantor dibuat. Selamat datang, Boss!');
    return s;
  };

  /* ---------------------------------------------------------------- CRUD */
  VO.addFacility = function (s, type, at) {
    const def = VO.FACILITY_TYPES[type];
    const f = { id: VO.uid('fa'), type, name: def.label, x: at?.x ?? 2, y: at?.y ?? 2, w: def.w, h: def.h, color: def.color };
    s.facilities.push(f);
    return f;
  };

  VO.addDivision = function (s, o = {}) {
    const color = o.color || VO.PALETTE[s.divisions.length % VO.PALETTE.length];
    const div = { id: VO.uid('dv'), name: o.name || 'Divisi Baru', color, zone: { x: 2, y: 12, w: 12, h: 8 }, directorDesk: { x: 4, y: 13 } };
    s.divisions.push(div);
    if (o.directorRole !== null) {
      const dir = VO.makeAgent({ divisionId: div.id, isDirector: true, role: o.directorRole || 'Direktur ' + div.name, shirt: '#2d3142' });
      s.agents.push(dir);
    }
    return div;
  };

  VO.addDepartment = function (s, divisionId, o = {}) {
    const div = s.divisions.find((d) => d.id === divisionId);
    const dept = { id: VO.uid('dp'), divisionId, name: o.name || 'Departemen Baru', room: { x: (div?.zone.x ?? 2) + 1, y: (div?.zone.y ?? 12) + 4, w: 9, h: 6 } };
    s.departments.push(dept);
    return dept;
  };

  VO.addAgent = function (s, deptId, o = {}) {
    const dept = s.departments.find((d) => d.id === deptId);
    const a = VO.makeAgent({ ...o, deptId, divisionId: dept?.divisionId });
    if (a.isLead) s.agents.filter((x) => x.deptId === deptId).forEach((x) => (x.isLead = false));
    s.agents.push(a);
    if (dept) VO.ensureRoomCapacity(s, dept);
    return a;
  };

  VO.director = (s, divId) => s.agents.find((a) => a.isDirector && a.divisionId === divId);
  VO.deptAgents = (s, deptId) => {
    const list = s.agents.filter((a) => a.deptId === deptId && !a.isDirector);
    return list.sort((a, b) => (b.isLead ? 1 : 0) - (a.isLead ? 1 : 0));
  };
  VO.deptLead = (s, deptId) => VO.deptAgents(s, deptId)[0] || null;
  VO.findEntity = (s, id) => (id === 'boss' ? s.boss : s.agents.find((a) => a.id === id));

  VO.removeDivision = function (s, id) {
    for (const d of s.departments.filter((d) => d.divisionId === id)) VO.removeDepartment(s, d.id);
    s.agents = s.agents.filter((a) => !(a.isDirector && a.divisionId === id));
    s.divisions = s.divisions.filter((d) => d.id !== id);
  };
  VO.removeDepartment = function (s, id) {
    s.agents = s.agents.filter((a) => a.deptId !== id);
    s.departments = s.departments.filter((d) => d.id !== id);
  };
  VO.removeAgent = function (s, id) {
    s.agents = s.agents.filter((a) => a.id !== id);
  };

  VO.log = function (s, text) {
    s.log.unshift({ t: Date.now(), text });
    if (s.log.length > 200) s.log.length = 200;
  };

  /* ---------------------------------------------------------------- geometri ruangan */
  // Slot meja dalam ruang departemen. Baris interior: aisle, meja, kursi, aisle, ...
  VO.deskSlots = function (room) {
    const iw = room.w - 2, ih = room.h - 2;
    const cols = Math.max(1, Math.floor((iw - 1) / 2));
    const rows = Math.max(0, Math.floor((ih - 1) / 3));
    const out = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const dx = room.x + 1 + 1 + c * 2, dy = room.y + 1 + 1 + r * 3;
        out.push({ desk: { x: dx, y: dy }, chair: { x: dx, y: dy + 1 } });
      }
    return out;
  };

  VO.roomSizeFor = function (n) {
    const cols = VO.clamp(n, 2, 4);
    const rows = Math.max(1, Math.ceil(n / cols));
    return { w: cols * 2 + 1 + 2, h: rows * 3 + 1 + 2 };
  };

  VO.ensureRoomCapacity = function (s, dept) {
    const n = VO.deptAgents(s, dept.id).length;
    while (VO.deskSlots(dept.room).length < n) dept.room.h += 3;
  };

  VO.doorTiles = function (room, facility) {
    const cx = room.x + Math.floor(room.w / 2);
    const doors = [{ x: cx, y: room.y + room.h - 1 }];
    if (!facility || facility.type === 'meeting' || facility.type === 'lounge') doors.push({ x: cx, y: room.y });
    return doors;
  };

  VO.bossSeat = function (s) {
    const f = s.facilities.find((f) => f.type === 'boss');
    if (!f) return { desk: { x: 3, y: 3 }, chair: { x: 3, y: 2 }, room: null };
    const cx = f.x + Math.floor(f.w / 2);
    return { desk: { x: cx, y: f.y + 3 }, chair: { x: cx, y: f.y + 2 }, room: f };
  };

  VO.meetingTable = function (f) {
    return { x: f.x + 3, y: f.y + 3, w: Math.max(1, f.w - 6), h: Math.max(1, f.h - 6) };
  };

  // Posisi kursi/meja setiap entitas (dipakai renderer + simulasi)
  VO.seatOf = function (s, ent) {
    if (ent.id === 'boss') return VO.bossSeat(s);
    if (ent.isDirector) {
      const div = s.divisions.find((d) => d.id === ent.divisionId);
      if (!div) return null;
      return { desk: { ...div.directorDesk }, chair: { x: div.directorDesk.x, y: div.directorDesk.y + 1 } };
    }
    const dept = s.departments.find((d) => d.id === ent.deptId);
    if (!dept) return null;
    const idx = VO.deptAgents(s, dept.id).findIndex((a) => a.id === ent.id);
    return VO.deskSlots(dept.room)[idx] || null;
  };

  /* ---------------------------------------------------------------- auto layout */
  VO.autoLayout = function (s) {
    // Fasilitas di baris atas
    let x = 2;
    const order = ['boss', 'meeting', 'pantry', 'lounge'];
    const facs = [...s.facilities].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    for (const f of facs) {
      f.x = x; f.y = 2; x += f.w + 1;
    }
    let maxX = x;
    const maxW = Math.max(x, 70) - 2;
    // Divisi sebagai zona berisi ruang departemen
    let cx = 2, cy = 12, rowH = 0;
    for (const div of s.divisions) {
      const depts = s.departments.filter((d) => d.divisionId === div.id);
      const sizes = depts.map((d) => VO.roomSizeFor(Math.max(1, VO.deptAgents(s, d.id).length)));
      const innerW = sizes.reduce((acc, z) => acc + z.w, 0) + Math.max(0, sizes.length - 1);
      const zw = Math.max(12, innerW + 2);
      const zh = 5 + Math.max(4, ...sizes.map((z) => z.h));
      if (cx + zw > maxW && cx > 2) { cx = 2; cy += rowH + 2; rowH = 0; }
      VO.setZone(s, div, { x: cx, y: cy, w: zw, h: zh }, false);
      div.directorDesk = { x: cx + 2, y: cy + 1 };
      let rx = cx + 1;
      depts.forEach((d, i) => {
        d.room = { x: rx, y: cy + 4, w: sizes[i].w, h: sizes[i].h };
        rx += sizes[i].w + 1;
      });
      cx += zw + 2;
      rowH = Math.max(rowH, zh);
      maxX = Math.max(maxX, cx);
    }
    // peta mengikuti isi (furnitur tetap dipertahankan di dalam peta)
    const fx = Math.max(0, ...s.furniture.map((f) => f.x + 2));
    const fy = Math.max(0, ...s.furniture.map((f) => f.y + 2));
    s.map.w = Math.max(40, maxX + 1, fx);
    s.map.h = Math.max(24, cy + rowH + 2, fy);
  };

  // Geser zona divisi (ikut memindahkan ruang departemen & meja direktur)
  VO.setZone = function (s, div, z, moveChildren = true) {
    const dx = z.x - div.zone.x, dy = z.y - div.zone.y;
    if (moveChildren && (dx || dy)) {
      for (const d of s.departments.filter((d) => d.divisionId === div.id)) { d.room.x += dx; d.room.y += dy; }
      div.directorDesk.x += dx; div.directorDesk.y += dy;
    }
    div.zone = { ...z };
  };

  /* ---------------------------------------------------------------- persistensi */
  VO.save = function (s) {
    try { localStorage.setItem(VO.STORAGE_KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
  };
  VO.load = function () {
    try {
      const raw = localStorage.getItem(VO.STORAGE_KEY);
      if (!raw) return null;
      return VO.migrate(JSON.parse(raw));
    } catch (e) { return null; }
  };
  VO.migrate = function (s) {
    if (!s || typeof s !== 'object' || !s.boss || !Array.isArray(s.agents)) throw new Error('Format file tidak dikenali');
    const d = VO.defaultState();
    for (const k of ['facilities', 'divisions', 'departments', 'agents', 'furniture', 'tasks', 'log']) if (!Array.isArray(s[k])) s[k] = [];
    s.settings = { ...d.settings, ...(s.settings || {}) };
    s.company = s.company || d.company;
    s.map = s.map || d.map;
    // tugas yang sedang berjalan tidak bisa dilanjutkan setelah reload
    for (const t of s.tasks) if (!['done', 'failed'].includes(t.status)) t.status = 'failed', (t.note = 'Terputus (halaman dimuat ulang)');
    return s;
  };
})();
