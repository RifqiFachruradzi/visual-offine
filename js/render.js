/* =========================================================================
 * render.js — renderer ISOMETRIK 2.5D (gaya pixel / Habbo) di <canvas>.
 *
 * Simulasi tetap bekerja di koordinat grid (tile). Renderer memproyeksikan
 * setiap tile (tx, ty) ke layar isometrik:
 *     x = OX + (tx - ty) * 32        y = OY + (tx + ty) * 16
 * Lantai di-cache di offscreen canvas; dinding, meja, furnitur, dan karakter
 * digambar tiap frame dan diurutkan berdasarkan kedalaman (tx + ty) agar
 * benda di depan menutupi benda di belakang.
 * ========================================================================= */
(function () {
  const VO = window.VO;
  const T = VO.TILE; // ukuran tile simulasi (px) — rt.x / T = posisi tile
  const HW = 32, HH = 16; // setengah lebar & tinggi belah ketupat isometrik
  const R = (VO.render = { cam: { x: 0, y: 0, zoom: 1 }, staticDirty: true, hover: null, selected: null, hoverObj: null });

  let floorCanvas = null;
  // Tema: 'modern' (terang, kantor terbuka — default) atau 'pixel' (gelap, gaya Habbo)
  // Tema: 'robot' (default — karakter robot, pulau kerja putih, aksen biru kobalt),
  // 'modern' (kantor terbuka terang, karakter manusia) atau 'pixel' (gelap, gaya Habbo)
  const theme = () => (VO.app && VO.app.state && VO.app.state.settings.theme) || 'robot';
  const modern = () => theme() !== 'pixel'; // tema terang (robot & modern)
  const robot = () => theme() === 'robot';
  R.isModern = modern;
  R.theme = theme;
  const NAVY = '#2633c9', CORAL = '#f04e5e', ORANGE = '#f28a30';
  let props = [];
  const geo = { OX: 0, OY: 90, W: 0, H: 0 };

  /* ------------------------------------------------------------ util warna & geometri */
  const hexToRgb = (hex) => {
    const n = parseInt(String(hex).slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const shade = (hex, f) => {
    const [r, g, b] = hexToRgb(hex);
    const m = (v) => Math.max(0, Math.min(255, Math.round(f >= 1 ? v + (255 - v) * (f - 1) : v * f)));
    return `rgb(${m(r)},${m(g)},${m(b)})`;
  };
  const mix = (a, b, t) => {
    const x = hexToRgb(a), y = hexToRgb(b);
    const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  };
  const alpha = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

  function updateGeo(s) {
    geo.OX = s.map.h * HW + 40;
    geo.OY = 90;
    geo.W = (s.map.w + s.map.h) * HW + 80;
    geo.H = (s.map.w + s.map.h) * HH + geo.OY + 60;
  }
  const iso = (tx, ty, z = 0) => ({ x: geo.OX + (tx - ty) * HW, y: geo.OY + (tx + ty) * HH - z });
  const toTile = (ix, iy) => {
    const a = (ix - geo.OX) / HW, b = (iy - geo.OY) / HH;
    return { x: (a + b) / 2, y: (b - a) / 2 };
  };
  R.iso = iso;

  const poly = (ctx, pts, fill, stroke) => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  };
  const rr = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  R.roundRect = rr;

  const diamond = (tx, ty, w = 1, d = 1, z = 0) => [iso(tx, ty, z), iso(tx + w, ty, z), iso(tx + w, ty + d, z), iso(tx, ty + d, z)];

  /**
   * Balok isometrik dari (x0,y0) sampai (x1,y1) di grid, alas di ketinggian z,
   * tinggi h (px layar). c = warna dasar; sisi diberi bayangan otomatis.
   * Mengembalikan sudut-sudut sisi depan untuk dekorasi (jendela, layar, dll.).
   */
  function box(ctx, x0, y0, x1, y1, z, h, c, opt = {}) {
    const top = c.top || shade(c.base || c, 1.12);
    const left = c.left || shade(c.base || c, 0.86); // sisi +ty (kiri-bawah)
    const right = c.right || shade(c.base || c, 0.7); // sisi +tx (kanan-bawah)
    const fL = [iso(x0, y1, z), iso(x1, y1, z), iso(x1, y1, z + h), iso(x0, y1, z + h)];
    const fR = [iso(x1, y0, z), iso(x1, y1, z), iso(x1, y1, z + h), iso(x1, y0, z + h)];
    const fT = [iso(x0, y0, z + h), iso(x1, y0, z + h), iso(x1, y1, z + h), iso(x0, y1, z + h)];
    poly(ctx, fL, left);
    poly(ctx, fR, right);
    poly(ctx, fT, top);
    if (opt.outline !== false) {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const f of [fL, fR, fT]) { ctx.moveTo(f[0].x, f[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(f[i].x, f[i].y); ctx.closePath(); }
      ctx.stroke();
    }
    return { fL, fR, fT };
  }

  // Titik di sisi depan-kiri (+ty) balok: u = 0..1 sepanjang x, v = 0..1 dari bawah ke atas
  const onFace = (f, u, v) => ({
    x: f[0].x + (f[1].x - f[0].x) * u + (f[3].x - f[0].x) * v,
    y: f[0].y + (f[1].y - f[0].y) * u + (f[3].y - f[0].y) * v,
  });
  const facePanel = (ctx, f, u0, u1, v0, v1, fill) => poly(ctx, [onFace(f, u0, v0), onFace(f, u1, v0), onFace(f, u1, v1), onFace(f, u0, v1)], fill);

  /* ------------------------------------------------------------ lantai (cache) */
  function buildFloor(s) {
    updateGeo(s);
    if (!floorCanvas) floorCanvas = document.createElement('canvas');
    floorCanvas.width = geo.W;
    floorCanvas.height = geo.H;
    const ctx = floorCanvas.getContext('2d');
    const M = modern();
    const RB = robot();
    const fl = RB ? { a: '#e9ebf4', b: '#e9ebf4' } : M ? { a: '#eef0f4', b: '#eceef3' } : VO.FLOORS[s.settings.floor] || VO.FLOORS.wood;

    // tepi platform (tebal) agar lantai terlihat seperti blok 3D
    const depth = 14;
    const A = iso(0, s.map.h), B = iso(s.map.w, s.map.h), C = iso(s.map.w, 0);
    poly(ctx, [A, B, { x: B.x, y: B.y + depth }, { x: A.x, y: A.y + depth }], shade(fl.a, M ? 0.88 : 0.55));
    poly(ctx, [B, C, { x: C.x, y: C.y + depth }, { x: B.x, y: B.y + depth }], shade(fl.a, M ? 0.8 : 0.42));

    const tint = new Map(); // "x,y" → warna lantai ruangan
    const setRect = (r, color, inset = 0) => {
      for (let y = r.y + inset; y < r.y + r.h - inset; y++) for (let x = r.x + inset; x < r.x + r.w - inset; x++) tint.set(x + ',' + y, color);
    };
    if (!RB) for (const div of s.divisions) setRect(div.zone, mix(fl.a, div.color, M ? 0.05 : 0.22));
    for (const d of s.departments) {
      if (RB) break;
      const div = s.divisions.find((x) => x.id === d.divisionId);
      setRect(d.room, M ? mix('#f7f8fb', div ? div.color : '#888888', 0.04) : mix('#e9edf2', div ? div.color : '#888888', 0.16));
    }
    for (const f of s.facilities) {
      if (RB) break;
      setRect(f, M ? mix('#f7f8fb', f.color, 0.05) : mix('#ece6dc', f.color, 0.2));
      if (f.type === 'boss') setRect({ x: f.x + 2, y: f.y + 2, w: f.w - 4, h: f.h - 3 }, M ? '#e4e8f0' : '#9c3b45');
      if (f.type === 'lounge') setRect({ x: f.x + 2, y: f.y + 2, w: f.w - 4, h: f.h - 4 }, mix(M ? '#f7f8fb' : '#ece6dc', '#9d4edd', M ? 0.12 : 0.45));
    }

    for (let y = 0; y < s.map.h; y++)
      for (let x = 0; x < s.map.w; x++) {
        const c = tint.get(x + ',' + y);
        const base = c || ((x + y) % 2 ? fl.a : fl.b);
        const fill = c ? ((x + y) % 2 ? base : shade(base, 0.96)) : base;
        poly(ctx, diamond(x, y), M ? (c || fl.a) : fill, M ? 'rgba(40,50,70,0.035)' : 'rgba(0,0,0,0.06)');
      }
    if (RB) {
      // pulau kerja putih yang terangkat untuk tiap departemen & ruangan, zona divisi bertitik
      const island = (r, inset, h) => {
        const x0 = r.x + inset, y0 = r.y + inset, x1 = r.x + r.w - inset, y1 = r.y + r.h - inset;
        const sh = [iso(x0, y0), iso(x1, y0), iso(x1, y1), iso(x0, y1)].map((p) => ({ x: p.x + 6, y: p.y + 10 }));
        poly(ctx, sh, 'rgba(60,70,140,0.08)');
        const A2 = iso(x0, y1), B2 = iso(x1, y1), C2 = iso(x1, y0);
        poly(ctx, [A2, B2, { x: B2.x, y: B2.y + h }, { x: A2.x, y: A2.y + h }], '#dde0ee');
        poly(ctx, [B2, C2, { x: C2.x, y: C2.y + h }, { x: B2.x, y: B2.y + h }], '#cbd0e4');
        poly(ctx, diamond(x0, y0, x1 - x0, y1 - y0), '#ffffff');
      };
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 7]);
      for (const div of s.divisions) poly(ctx, diamond(div.zone.x + 0.15, div.zone.y + 0.15, div.zone.w - 0.3, div.zone.h - 0.3), null, alpha(NAVY, 0.28));
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      for (const f of s.facilities) island(f, 0.25, 8);
      for (const d of s.departments) island(d.room, 0.25, 8);
      for (const div of s.divisions) island({ x: div.directorDesk.x - 1, y: div.directorDesk.y - 0.6, w: 3, h: 3 }, 0.1, 6);
      for (const div of s.divisions) floorText(ctx, div.name.toUpperCase(), div.zone.x + 1, div.zone.y + div.zone.h - 0.7, 22, alpha(NAVY, 0.35));
      for (const d of s.departments) floorText(ctx, d.name.toUpperCase(), d.room.x + 0.9, d.room.y + d.room.h - 0.6, 12, alpha(NAVY, 0.55));
      for (const f of s.facilities) floorText(ctx, f.name.toUpperCase(), f.x + 0.9, f.y + f.h - 0.6, 12, alpha(NAVY, 0.5));
      return;
    }
    if (M) {
      // garis tipis batas zona & ruangan + nama tim ditulis di lantai (gaya kantor terbuka)
      ctx.lineWidth = 1.5;
      for (const div of s.divisions) poly(ctx, diamond(div.zone.x, div.zone.y, div.zone.w, div.zone.h), null, alpha(div.color, 0.35));
      for (const d of s.departments) poly(ctx, diamond(d.room.x + 0.5, d.room.y + 0.5, d.room.w - 1, d.room.h - 1), null, 'rgba(60,70,90,0.18)');
      ctx.lineWidth = 1;
      for (const div of s.divisions) floorText(ctx, div.name.toUpperCase(), div.zone.x + 1, div.zone.y + div.zone.h - 0.9, 22, alpha(div.color, 0.55));
      for (const d of s.departments) floorText(ctx, d.name.toUpperCase(), d.room.x + 0.9, d.room.y + d.room.h - 0.55, 12, 'rgba(60,70,90,0.55)');
      for (const f of s.facilities) floorText(ctx, f.name.toUpperCase(), f.x + 0.9, f.y + f.h - 0.55, 12, 'rgba(60,70,90,0.5)');
      return;
    }
    // garis putus-putus batas zona divisi
    for (const div of s.divisions) {
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      poly(ctx, diamond(div.zone.x, div.zone.y, div.zone.w, div.zone.h), null, alpha(div.color, 0.85));
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }
  }

  // Tulisan yang "dicat" di lantai, mengikuti sumbu x isometrik (size = px per 32 unit tile)
  function floorText(ctx, text, tx, ty, size, color) {
    const o = iso(tx, ty);
    ctx.save();
    ctx.setTransform(HW / 32, HH / 32, -HW / 32, HH / 32, o.x, o.y);
    ctx.font = `800 ${size}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  /* ------------------------------------------------------------ props (benda 3D) */
  // Setiap prop: { k: kedalaman (tx+ty pusat), d: fungsi gambar(ctx, now, s) }
  function buildProps(s) {
    props = [];
    const add = (k, d) => props.push({ k, d });

    const walls = (r, color, fac) => {
      if (robot()) return; // tema robot: pulau terbuka tanpa dinding
      if (modern()) return partitions(r, fac);
      const doors = VO.doorTiles(r, fac);
      const isDoor = (x, y) => doors.some((d) => d.x === x && d.y === y);
      const wallBase = mix('#efe9df', color, 0.18);
      const TALL = 46, LOW = 12, TH_ = 0.32; // tinggi dinding belakang/depan & ketebalan
      const L = r.x, Tp = r.y, Rr = r.x + r.w - 1, B = r.y + r.h - 1;
      const seg = (x0, y0, x1, y1, h, kind, win) =>
        add((x0 + x1) / 2 + (y0 + y1) / 2, (ctx) => {
          const f = box(ctx, x0, y0, x1, y1, 0, h, { top: '#5a6172', left: shade(wallBase, 0.95), right: shade(wallBase, 0.78) });
          if (win && kind === 'top') facePanel(ctx, f.fL, 0.18, 0.82, 0.38, 0.8, 'rgba(150,205,255,0.75)');
          if (win && kind === 'left') facePanel(ctx, f.fR, 0.18, 0.82, 0.38, 0.8, 'rgba(150,205,255,0.75)');
          if (h > LOW) { // list warna di kaki dinding
            if (kind === 'top') facePanel(ctx, f.fL, 0, 1, 0, 0.12, shade(color, 0.85));
            if (kind === 'left') facePanel(ctx, f.fR, 0, 1, 0, 0.12, shade(color, 0.75));
          }
        });
      // dinding belakang (tinggi): baris atas & kolom kiri
      for (let x = L; x <= Rr; x++) {
        if (isDoor(x, Tp)) continue;
        const x0 = x === L ? x + 1 - TH_ : x, x1 = x === Rr ? x + TH_ : x + 1;
        seg(x0, Tp + 1 - TH_, x1, Tp + 1, TALL, 'top', (x - L) % 3 === 1);
      }
      for (let y = Tp + 1; y <= B; y++) {
        if (isDoor(L, y)) continue;
        const y1 = y === B ? y + TH_ : y + 1;
        seg(L + 1 - TH_, y, L + 1, y1, TALL, 'left', (y - Tp) % 3 === 2);
      }
      // dinding depan (rendah) agar isi ruangan tetap terlihat
      for (let x = L + 1; x <= Rr; x++) {
        if (isDoor(x, B)) continue;
        const x1 = x === Rr ? x + TH_ : x + 1;
        seg(x, B, x1, B + TH_, LOW, 'bottom');
      }
      for (let y = Tp + 1; y < B; y++) {
        if (isDoor(Rr, y)) continue;
        seg(Rr, y, Rr + TH_, y + 1, LOW, 'right');
      }
    };

    // Modern: sekat rendah putih + tiang tipis di sudut (kantor terbuka)
    const partitions = (r, fac) => {
      const doors = VO.doorTiles(r, fac);
      const isDoor = (x, y) => doors.some((d) => d.x === x && d.y === y);
      const H = 9, TH_ = 0.1;
      const L = r.x + 0.45, Tp = r.y + 0.45, Rr = r.x + r.w - 0.45, B = r.y + r.h - 0.45;
      const col = { top: '#ffffff', left: '#e6e9ef', right: '#d6dae2' };
      const seg = (x0, y0, x1, y1) => add((x0 + x1) / 2 + (y0 + y1) / 2, (ctx) => box(ctx, x0, y0, x1, y1, 0, H, col, { outline: false }));
      for (let x = r.x; x < r.x + r.w; x++) {
        const a = Math.max(L, x), b = Math.min(Rr, x + 1);
        if (b <= a) continue;
        if (!isDoor(x, r.y)) seg(a, Tp - TH_, b, Tp + TH_);
        if (!isDoor(x, r.y + r.h - 1)) seg(a, B - TH_, b, B + TH_);
      }
      for (let y = r.y; y < r.y + r.h; y++) {
        const a = Math.max(Tp, y), b = Math.min(B, y + 1);
        if (b <= a) continue;
        if (!isDoor(r.x, y)) seg(L - TH_, a, L + TH_, b);
        if (!isDoor(r.x + r.w - 1, y)) seg(Rr - TH_, a, Rr + TH_, b);
      }
      for (const [px, py] of [[L, Tp], [Rr, Tp], [L, B], [Rr, B]])
        add(px + py + 0.01, (ctx) => box(ctx, px - 0.05, py - 0.05, px + 0.05, py + 0.05, 0, 64, { top: '#c9ced8', left: '#d5d9e1', right: '#bfc5d0' }, { outline: false }));
    };

    for (const f of s.facilities) {
      walls(f, f.color, f);
      facilityProps(s, f, add);
    }
    for (const d of s.departments) {
      const div = s.divisions.find((x) => x.id === d.divisionId);
      walls(d.room, div ? div.color : '#888888', null);
      const members = VO.deptAgents(s, d.id);
      VO.deskSlots(d.room).forEach((sl, i) => {
        add(sl.desk.x + sl.desk.y + 1, (ctx, now) => drawDesk(ctx, sl.desk.x, sl.desk.y, now, members[i], modern() ? '#ffffff' : '#a47148'));
        add(sl.chair.x + sl.chair.y + 0.9, (ctx) => drawChair(ctx, sl.chair.x, sl.chair.y));
        add(sl.chair.x + sl.chair.y + 1.3, (ctx) => drawChairBack(ctx, sl.chair.x, sl.chair.y));
      });
    }
    for (const div of s.divisions) {
      const dd = div.directorDesk;
      add(dd.x + dd.y + 1, (ctx, now) => drawDesk(ctx, dd.x, dd.y, now, VO.director(s, div.id), robot() ? '#e6e9fb' : modern() ? '#ece8f5' : '#6d4c7d'));
      add(dd.x + dd.y + 1.9, (ctx) => drawChair(ctx, dd.x, dd.y + 1));
      add(dd.x + dd.y + 2.3, (ctx) => drawChairBack(ctx, dd.x, dd.y + 1));
    }
    for (const fu of s.furniture) add(fu.x + fu.y + 1, (ctx) => drawFurniture(ctx, fu));
    props.sort((a, b) => a.k - b.k);
  }

  function facilityProps(s, f, add) {
    if (f.type === 'boss') {
      const seat = VO.bossSeat(s);
      const dx = seat.desk.x, dy = seat.desk.y;
      for (let i = -1; i <= 1; i++)
        add(dx + i + dy + 1, (ctx) => {
          const b = box(ctx, dx + i + (i === -1 ? 0.05 : 0), dy + 0.12, dx + i + 1 - (i === 1 ? 0.05 : 0), dy + 0.88, 0, 17, robot() ? { top: '#ffffff', left: NAVY, right: '#1f2aa8' } : { top: '#6b4429', left: '#4a2c1a', right: '#3a2214' });
          facePanel(ctx, b.fL, 0, 1, 0.82, 0.9, '#d4a843');
          if (i === 0) { // dokumen & pena di atas meja
            poly(ctx, diamond(dx + 0.3, dy + 0.3, 0.35, 0.3, 17), '#f5f5f5');
          }
          if (i === 1) { // lampu meja
            const p = iso(dx + 1.5, dy + 0.4, 17);
            ctx.fillStyle = '#2e7d32'; ctx.beginPath(); ctx.arc(p.x, p.y - 5, 5, 0, 7); ctx.fill();
          }
        });
      // kursi boss (sandaran di belakang, boss menghadap ke depan)
      add(seat.chair.x + seat.chair.y + 0.8, (ctx) => {
        const cx = seat.chair.x, cy = seat.chair.y;
        box(ctx, cx + 0.2, cy + 0.15, cx + 0.8, cy + 0.3, 0, 30, robot() ? '#1f2aa8' : '#3b2418');
        box(ctx, cx + 0.22, cy + 0.25, cx + 0.78, cy + 0.8, 7, 5, robot() ? NAVY : '#5a3826');
      });
      add(f.x + 1.5 + f.y + 1.5, (ctx) => drawFurniture(ctx, { type: 'bookshelf', x: f.x + 1, y: f.y + 1 }));
      add(f.x + f.w - 1.5 + f.y + 1.5, (ctx) => drawFurniture(ctx, { type: 'plant', x: f.x + f.w - 2, y: f.y + 1 }));
    } else if (f.type === 'meeting') {
      const t = VO.meetingTable(f);
      for (let y = t.y; y < t.y + t.h; y++)
        for (let x = t.x; x < t.x + t.w; x++)
          add(x + y + 1, (ctx) => {
            box(ctx, x - (x === t.x ? -0.1 : 0), y - (y === t.y ? -0.1 : 0), x + 1 - (x === t.x + t.w - 1 ? 0.1 : 0), y + 1 - (y === t.y + t.h - 1 ? 0.1 : 0), 0, 14,
              robot() ? { top: '#ffffff', left: '#dfe2f0', right: '#c9cee3' } : { top: '#8a6648', left: '#6b4f3a', right: '#56402f' }, { outline: false });
          });
      for (const p of VO.sim.spots(s, 'meeting'))
        add(p.x + p.y + 0.9, (ctx) => box(ctx, p.x + 0.28, p.y + 0.28, p.x + 0.72, p.y + 0.72, 0, 7, robot() ? NAVY : '#3a3f4b'));
      // layar presentasi di dinding belakang
      add(f.x + f.w / 2 + f.y + 1.2, (ctx) => {
        const b = box(ctx, f.x + f.w / 2 - 1.5, f.y + 0.95, f.x + f.w / 2 + 1.5, f.y + 1.02, 18, 22, '#22252c');
        facePanel(ctx, b.fL, 0.06, 0.94, 0.12, 0.88, '#4fc3f7');
      });
    } else if (f.type === 'pantry') {
      for (let x = f.x + 1; x < f.x + f.w - 1; x++) {
        const y = f.y + 1;
        add(x + y + 1, (ctx) => {
          box(ctx, x, y + 0.1, x + 1, y + 0.9, 0, 18, robot() ? { top: '#ffffff', left: NAVY, right: '#1f2aa8' } : { top: '#d5d9df', left: '#9aa1ad', right: '#858c98' });
          if (x === f.x + 1) { // mesin kopi
            const b = box(ctx, x + 0.25, y + 0.25, x + 0.75, y + 0.65, 18, 16, '#2a2a2e');
            facePanel(ctx, b.fL, 0.3, 0.7, 0.55, 0.75, '#e53935');
          }
          if (x === f.x + f.w - 2) box(ctx, x + 0.1, y + 0.15, x + 0.9, y + 0.85, 18, 26, '#eceff1'); // kulkas
          if (x === f.x + 3) { const p = iso(x + 0.5, y + 0.5, 18); ctx.fillStyle = '#ffb74d'; ctx.beginPath(); ctx.arc(p.x, p.y - 3, 4, 0, 7); ctx.fill(); }
        });
      }
      for (let i = 0; i < Math.floor((f.w - 2) / 3); i++) {
        const x = f.x + 2 + i * 3, y = f.y + f.h - 3;
        add(x + y + 1, (ctx) => box(ctx, x + 0.2, y + 0.2, x + 0.8, y + 0.8, 0, 13, { top: '#efebe9', left: '#bcaaa4', right: '#a1887f' }));
      }
    } else if (f.type === 'lounge') {
      add(f.x + 2 + f.y + 1.5, (ctx) => drawFurniture(ctx, { type: 'sofa', x: f.x + 2, y: f.y + 1 }));
      add(f.x + 4 + f.y + 1.5, (ctx) => drawFurniture(ctx, { type: 'sofa', x: f.x + 4, y: f.y + 1 }));
      add(f.x + f.w - 1.5 + f.y + 1.5, (ctx) => drawFurniture(ctx, { type: 'arcade', x: f.x + f.w - 2, y: f.y + 1 }));
    }
  }

  function drawDesk(ctx, x, y, now, ent, topColor) {
    if (modern()) { // meja putih dengan kaki ramping
      box(ctx, x + 0.06, y + 0.14, x + 0.94, y + 0.86, 12, 3, { top: topColor, left: '#dde1e8', right: '#cdd2db' }, { outline: false });
      for (const [lx, ly] of [[0.1, 0.18], [0.86, 0.18], [0.1, 0.78], [0.86, 0.78]]) box(ctx, x + lx, y + ly, x + lx + 0.04, y + ly + 0.04, 0, 12, '#b8bfcb', { outline: false });
    } else box(ctx, x + 0.06, y + 0.14, x + 0.94, y + 0.86, 0, 15, { top: topColor, left: shade(topColor, 0.78), right: shade(topColor, 0.62) });
    // monitor menghadap kursi (sisi +ty)
    const rt = ent && VO.sim.rt.get(ent.id);
    const working = rt && rt.working;
    box(ctx, x + 0.46, y + 0.32, x + 0.54, y + 0.42, 15, 5, '#2a2d34'); // kaki monitor
    const m = box(ctx, x + 0.22, y + 0.3, x + 0.78, y + 0.38, 19, 15, '#1d2129');
    let scr = '#20242c';
    if (ent) scr = working ? '#16466e' : '#2d3a4f';
    facePanel(ctx, m.fL, 0.08, 0.92, 0.12, 0.9, scr);
    if (working) {
      for (let i = 0; i < 3; i++) {
        const len = 0.25 + ((Math.sin(now / 170 + i * 2 + x * 3) + 1) / 2) * 0.5;
        ctx.strokeStyle = ['#4fc3f7', '#81c784', '#ffd54f'][i];
        ctx.lineWidth = 1.2;
        const a = onFace(m.fL, 0.15, 0.7 - i * 0.2), bb = onFace(m.fL, 0.15 + len * 0.7, 0.7 - i * 0.2);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bb.x, bb.y); ctx.stroke();
      }
      const c = onFace(m.fL, 0.5, 0.5);
      ctx.fillStyle = 'rgba(79,195,247,0.13)'; ctx.beginPath(); ctx.arc(c.x, c.y + 6, 18, 0, 7); ctx.fill();
    }
    // keyboard & cangkir
    poly(ctx, diamond(x + 0.3, y + 0.55, 0.4, 0.14, 15), '#d9dce3');
    box(ctx, x + 0.8, y + 0.2, x + 0.88, y + 0.28, 15, 5, '#ffffff', { outline: false });
  }

  function drawChair(ctx, x, y) {
    box(ctx, x + 0.3, y + 0.32, x + 0.7, y + 0.72, 6, 4, robot() ? NAVY : modern() ? '#7f8ba0' : '#353a46'); // dudukan
    box(ctx, x + 0.46, y + 0.46, x + 0.54, y + 0.54, 0, 6, '#22252c', { outline: false }); // tiang
  }
  // sandaran digambar SETELAH karyawan yang duduk, agar menutupi punggungnya
  function drawChairBack(ctx, x, y) {
    box(ctx, x + 0.3, y + 0.7, x + 0.7, y + 0.78, 10, 16, robot() ? '#1f2aa8' : modern() ? '#6f7b90' : '#2b2f3a');
  }

  function drawFurniture(ctx, f) {
    const x = f.x, y = f.y;
    const sh = iso(x + 0.5, y + 0.5);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(sh.x, sh.y, 20, 9, 0, 0, 7); ctx.fill();
    switch (f.type) {
      case 'plant': {
        if (robot()) { // pohon bulat biru dengan pot koral
          box(ctx, x + 0.36, y + 0.36, x + 0.64, y + 0.64, 0, 10, CORAL, { outline: false });
          const q = iso(x + 0.5, y + 0.5, 10);
          ctx.fillStyle = '#5a3a2a'; ctx.fillRect(q.x - 1.5, q.y - 10, 3, 10);
          const g = ctx.createRadialGradient(q.x - 5, q.y - 26, 2, q.x, q.y - 20, 16);
          g.addColorStop(0, '#5d6bff'); g.addColorStop(1, NAVY);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.ellipse(q.x, q.y - 22, 11, 15, 0, 0, 7); ctx.fill();
          break;
        }
        box(ctx, x + 0.32, y + 0.32, x + 0.68, y + 0.68, 0, 14, '#8d5a3b');
        const p = iso(x + 0.5, y + 0.5, 14);
        for (const [ox, oy, r, c] of [[0, -10, 10, '#2e7d32'], [-8, -4, 8, '#388e3c'], [8, -5, 8, '#2e7d32'], [0, -20, 8, '#43a047'], [-4, -13, 6, '#66bb6a']]) {
          ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p.x + ox, p.y + oy, r, 0, 7); ctx.fill();
        }
        break;
      }
      case 'sofa':
        box(ctx, x + 0.05, y + 0.2, x + 0.95, y + 0.85, 0, 10, '#5c6bc0');
        box(ctx, x + 0.05, y + 0.12, x + 0.95, y + 0.32, 0, 22, '#4a59ad');
        box(ctx, x + 0.05, y + 0.2, x + 0.17, y + 0.85, 0, 16, '#4a59ad');
        box(ctx, x + 0.83, y + 0.2, x + 0.95, y + 0.85, 0, 16, '#4a59ad');
        break;
      case 'bookshelf': {
        const b = box(ctx, x + 0.08, y + 0.3, x + 0.92, y + 0.7, 0, 44, '#6d4c41');
        for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++)
          facePanel(ctx, b.fL, 0.08 + i * 0.145, 0.08 + i * 0.145 + 0.11, 0.08 + r * 0.23, 0.08 + r * 0.23 + 0.17, VO.SHIRTS[(r * 6 + i) % VO.SHIRTS.length]);
        break;
      }
      case 'whiteboard': {
        box(ctx, x + 0.47, y + 0.5, x + 0.53, y + 0.56, 0, 14, '#90a4ae');
        const b = box(ctx, x + 0.05, y + 0.48, x + 0.95, y + 0.54, 14, 28, '#fafafa');
        ctx.strokeStyle = '#e53935'; ctx.lineWidth = 1.5;
        const pts = [[0.1, 0.3], [0.3, 0.6], [0.5, 0.45], [0.7, 0.8], [0.9, 0.6]].map(([u, v]) => onFace(b.fL, u, v));
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y); ctx.stroke();
        break;
      }
      case 'cooler': {
        box(ctx, x + 0.3, y + 0.3, x + 0.7, y + 0.7, 0, 22, '#eceff1');
        const p = iso(x + 0.5, y + 0.5, 22);
        ctx.fillStyle = 'rgba(66,165,245,0.85)'; rr(ctx, p.x - 7, p.y - 16, 14, 16, 4); ctx.fill();
        break;
      }
      case 'printer': {
        const b = box(ctx, x + 0.15, y + 0.2, x + 0.85, y + 0.8, 0, 14, '#cfd8dc');
        facePanel(ctx, b.fL, 0.15, 0.85, 0.35, 0.5, '#37474f');
        poly(ctx, diamond(x + 0.3, y + 0.3, 0.4, 0.35, 15), '#ffffff');
        break;
      }
      case 'server': {
        const b = box(ctx, x + 0.15, y + 0.2, x + 0.85, y + 0.8, 0, 46, '#263238');
        for (let i = 0; i < 6; i++) facePanel(ctx, b.fL, 0.15, 0.3, 0.1 + i * 0.14, 0.15 + i * 0.14, i % 2 ? '#66bb6a' : '#29b6f6');
        break;
      }
      case 'arcade': {
        const b = box(ctx, x + 0.2, y + 0.25, x + 0.8, y + 0.75, 0, 44, '#6a1b9a');
        facePanel(ctx, b.fL, 0.15, 0.85, 0.55, 0.85, '#00e5ff');
        facePanel(ctx, b.fL, 0.25, 0.4, 0.4, 0.47, '#ffeb3b');
        facePanel(ctx, b.fL, 0.6, 0.75, 0.4, 0.47, '#f44336');
        break;
      }
    }
  }
  R.drawFurniture = drawFurniture;

  /* ------------------------------------------------------------ karakter gaya Habbo */
  /**
   * Gambar avatar dengan kaki di (0,0) koordinat lokal. Menghadap kanan-bawah
   * secara default; o.mirror membalik ke kiri; o.back = tampak belakang.
   */
  function drawAvatar(ctx, a, o) {
    const skin = a.skin, hair = a.hair, top = a.top || a.shirt, pants = a.pants || '#3b3f4a', tie = a.tie || '#c62828';
    const style = a.style || 'suit';
    const female = style === 'cardigan';
    const sw = o.moving ? Math.sin(o.phase * 13) : 0; // ayunan langkah
    const sit = o.sitting;
    ctx.save();
    if (o.mirror) ctx.scale(-1, 1);
    ctx.lineJoin = 'round';

    // bayangan
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.beginPath(); ctx.ellipse(0, 0, 13, 5, 0, 0, 7); ctx.fill();

    const lift = sit ? 6 : Math.abs(sw) * 1.2; // badan naik turun saat jalan
    ctx.translate(0, -lift);

    // ---- kaki
    const legTop = -20;
    if (!sit) {
      const legs = [[-6, sw * 2.5], [1, -sw * 2.5]];
      legs.forEach(([lx, off], i) => {
        if (female) {
          ctx.fillStyle = shade(skin, i ? 0.92 : 1);
          ctx.fillRect(lx + 1, legTop + 6 + off * 0.3, 3.5, 13);
        } else {
          ctx.fillStyle = shade(pants, i ? 0.82 : 1);
          ctx.fillRect(lx, legTop + off * 0.3, 5.5, 18);
        }
        ctx.fillStyle = female ? shade(top, 0.6) : '#26272b';
        rr(ctx, lx - 0.5 + off * 0.4, -3.5 + off * 0.2, 7.5, 4, 1.5); ctx.fill();
      });
    } else {
      // duduk: paha ke depan
      ctx.fillStyle = female ? shade(skin, 0.95) : pants;
      ctx.fillRect(-6, legTop + 4, 12, 7);
    }
    if (female) { // rok
      ctx.fillStyle = shade(pants === '#c2b49a' ? '#3b3f6a' : pants, 1.05);
      poly(ctx, [{ x: -8, y: legTop - 1 }, { x: 8, y: legTop - 1 }, { x: 10, y: legTop + 10 }, { x: -10, y: legTop + 10 }], ctx.fillStyle);
    }

    // ---- badan
    const bodyTop = -41, bodyH = 22;
    const torso = top;
    ctx.fillStyle = torso;
    rr(ctx, -9.5, bodyTop, 19, bodyH, 5); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; // bayangan sisi kanan
    rr(ctx, 4.5, bodyTop + 1, 5, bodyH - 2, 3); ctx.fill();
    if (!o.back) {
      if (style === 'suit') {
        ctx.fillStyle = '#f5f7fa';
        poly(ctx, [{ x: -3.5, y: bodyTop }, { x: 3.5, y: bodyTop }, { x: 0, y: bodyTop + 10 }], '#f5f7fa');
        ctx.fillStyle = tie; ctx.fillRect(-1.1, bodyTop + 1.5, 2.4, 11);
        poly(ctx, [{ x: -1.6, y: bodyTop + 12 }, { x: 1.9, y: bodyTop + 12 }, { x: 0.15, y: bodyTop + 15 }], tie);
        ctx.strokeStyle = shade(torso, 0.7); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-3.5, bodyTop); ctx.lineTo(0, bodyTop + 13); ctx.lineTo(3.5, bodyTop); ctx.stroke();
      } else if (style === 'shirt') {
        poly(ctx, [{ x: -3.5, y: bodyTop }, { x: 3.5, y: bodyTop }, { x: 0, y: bodyTop + 4 }], shade(torso, 0.85));
        ctx.fillStyle = tie; ctx.fillRect(-1.1, bodyTop + 2, 2.4, 12);
        poly(ctx, [{ x: -1.6, y: bodyTop + 13 }, { x: 1.9, y: bodyTop + 13 }, { x: 0.15, y: bodyTop + 16 }], tie);
        ctx.fillStyle = '#2b2b30'; ctx.fillRect(-9, bodyTop + bodyH - 3, 18, 2.5); // ikat pinggang
      } else {
        ctx.fillStyle = '#f7f1e8'; // atasan dalam
        rr(ctx, -4, bodyTop + 1, 8, bodyH - 4, 2); ctx.fill();
        ctx.fillStyle = '#ffd54f'; ctx.beginPath(); ctx.arc(0, bodyTop + 5, 1.3, 0, 7); ctx.fill(); // kalung
      }
    }
    // lengan
    const arm = (x, swing) => {
      ctx.fillStyle = shade(torso, 0.92);
      rr(ctx, x, bodyTop + 2 + swing, 4.5, 17, 2); ctx.fill();
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(x + 2.2, bodyTop + 20 + swing, 2.6, 0, 7); ctx.fill();
    };
    const armSw = o.working ? Math.sin(o.now / 85) * 1.5 : sw * 2.5;
    arm(-13.5, armSw);
    arm(9, -armSw);
    // leher
    ctx.fillStyle = shade(skin, 0.9); ctx.fillRect(-2.5, bodyTop - 3, 5, 4);

    // ---- kepala (besar, khas Habbo)
    const hy = bodyTop - 12;
    // rambut panjang di belakang kepala
    if (a.hairStyle === 2 && !o.back) { ctx.fillStyle = shade(hair, 0.85); rr(ctx, -10.5, hy - 6, 21, 22, 6); ctx.fill(); }
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.ellipse(0.5, hy, 9.5, 10.5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = shade(skin, 0.9); // telinga
    ctx.beginPath(); ctx.ellipse(-8.5, hy + 1, 2, 3, 0, 0, 7); ctx.fill();

    if (o.back) {
      ctx.fillStyle = hair;
      if (a.hairStyle === 4) { ctx.beginPath(); ctx.ellipse(0.5, hy + 3, 9.6, 6, 0, 0, Math.PI); ctx.fill(); }
      else { ctx.beginPath(); ctx.ellipse(0.5, hy - 0.5, 9.9, 10.8, 0, 0, 7); ctx.fill(); }
      if (a.hairStyle === 2) { rr(ctx, -10, hy, 21, 17, 6); ctx.fill(); }
      if (a.hairStyle === 3) { ctx.beginPath(); ctx.arc(0.5, hy - 11, 5, 0, 7); ctx.fill(); }
    } else {
      // wajah menghadap kanan-bawah (3/4)
      ctx.fillStyle = '#1b1b1f';
      ctx.fillRect(1.5, hy - 1, 2, 3.2); ctx.fillRect(6.5, hy - 1, 2, 3.2);
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(1.5, hy - 1, 1, 1); ctx.fillRect(6.5, hy - 1, 1, 1);
      ctx.fillStyle = shade(hair, 0.8); ctx.fillRect(1, hy - 3.5, 3, 1); ctx.fillRect(6, hy - 3.5, 3, 1); // alis
      ctx.fillStyle = shade(skin, 0.82); ctx.fillRect(5, hy + 2.5, 1.8, 2); // hidung
      ctx.strokeStyle = shade(skin, 0.55); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(2.5, hy + 6); ctx.quadraticCurveTo(5, hy + 7.2, 7.5, hy + 6); ctx.stroke(); // senyum
      if (female) { ctx.fillStyle = 'rgba(240,98,146,0.35)'; ctx.beginPath(); ctx.arc(0, hy + 4, 1.8, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(8.5, hy + 4, 1.6, 0, 7); ctx.fill(); }
      if (a.mustache) { ctx.fillStyle = shade(hair, 0.9); rr(ctx, 1.5, hy + 4, 7, 2, 1); ctx.fill(); }
      if (a.glasses) {
        ctx.strokeStyle = '#2b2b30'; ctx.lineWidth = 1;
        ctx.strokeRect(0.5, hy - 2, 4, 4); ctx.strokeRect(5.5, hy - 2, 4, 4);
        ctx.beginPath(); ctx.moveTo(4.5, hy); ctx.lineTo(5.5, hy); ctx.stroke();
      }
      // rambut
      ctx.fillStyle = hair;
      switch (a.hairStyle) {
        case 4: // botak: hanya samping
          ctx.beginPath(); ctx.ellipse(-6.5, hy - 1, 3.5, 5, 0, 0, 7); ctx.fill();
          break;
        case 1: // belah samping
          ctx.beginPath(); ctx.ellipse(0.5, hy - 5, 10.2, 7, 0, Math.PI, 0); ctx.fill();
          ctx.beginPath(); ctx.moveTo(-9.5, hy - 5); ctx.quadraticCurveTo(2, hy - 13, 10.5, hy - 3); ctx.lineTo(10, hy - 6); ctx.quadraticCurveTo(1, hy - 9, -9, hy - 2); ctx.fill();
          ctx.fillRect(-10, hy - 5, 4, 8);
          break;
        case 2: // panjang
          ctx.beginPath(); ctx.ellipse(0.5, hy - 4.5, 10.4, 7.5, 0, Math.PI, 0); ctx.fill();
          ctx.fillRect(-10.5, hy - 5, 5, 18);
          ctx.beginPath(); ctx.moveTo(-6, hy - 9); ctx.quadraticCurveTo(4, hy - 6, 10.8, hy - 2); ctx.lineTo(10.8, hy - 6); ctx.fill();
          break;
        case 3: // cepol
          ctx.beginPath(); ctx.ellipse(0.5, hy - 4.5, 10.2, 7.2, 0, Math.PI, 0); ctx.fill();
          ctx.beginPath(); ctx.arc(-5, hy - 12, 5, 0, 7); ctx.fill();
          ctx.fillRect(-10, hy - 5, 3.5, 7);
          break;
        case 5: // ikal
          for (const [cx, cy, r] of [[-6, -8, 4.5], [-1, -10, 4.8], [4.5, -9.5, 4.5], [8.5, -6.5, 3.5], [-8.5, -3, 3.8]]) { ctx.beginPath(); ctx.arc(cx + 0.5, hy + cy, r, 0, 7); ctx.fill(); }
          break;
        default: // pendek
          ctx.beginPath(); ctx.ellipse(0.5, hy - 5, 10, 6.8, 0, Math.PI, 0); ctx.fill();
          ctx.fillRect(-10, hy - 5, 4, 6);
          ctx.beginPath(); ctx.moveTo(-6, hy - 8); ctx.lineTo(9, hy - 7); ctx.lineTo(10.3, hy - 3.5); ctx.lineTo(4, hy - 5.5); ctx.fill();
      }
    }
    ctx.restore();
    return hy - 11 - lift; // posisi puncak kepala (untuk mahkota/ikon)
  }

  /**
   * Karakter robot (tema Robot): kepala putih dengan layar wajah, badan putih,
   * lengan & kaki oranye. Aksesori menyesuaikan jabatan. Kaki di (0,0).
   */
  function drawRobot(ctx, a, o) {
    const role = String(a.role || '').toLowerCase();
    const accent = a.id === 'boss' ? '#ffca28' : a.top || ORANGE;
    const limb = a.id === 'boss' ? '#3a3f6b' : ORANGE;
    const sw = o.moving ? Math.sin(o.phase * 13) : 0;
    const sit = o.sitting;
    ctx.save();
    if (o.mirror) ctx.scale(-1, 1);
    ctx.fillStyle = 'rgba(40,50,120,0.18)';
    ctx.beginPath(); ctx.ellipse(0, 0, 13, 5, 0, 0, 7); ctx.fill();
    const lift = sit ? 7 : Math.abs(sw) * 1.4;
    ctx.translate(0, -lift);

    // kaki
    if (!sit) {
      [[-7, sw], [1.5, -sw]].forEach(([lx, off], i) => {
        ctx.fillStyle = shade(limb, i ? 0.85 : 1);
        rr(ctx, lx + 0.5, -17 + off, 5, 10, 2); ctx.fill();
        ctx.fillStyle = i ? '#e3e5ee' : '#f4f5fa';
        rr(ctx, lx - 0.5 + off * 1.5, -8, 7.5, 7.5, 2.5); ctx.fill();
        ctx.fillStyle = '#3a3f55'; ctx.fillRect(lx - 0.5 + off * 1.5, -1.6, 7.5, 1.8);
      });
    } else {
      ctx.fillStyle = limb; rr(ctx, -7, -16, 14, 7, 3); ctx.fill();
    }
    ctx.fillStyle = '#3a3f55'; rr(ctx, -8, -20, 16, 5, 2); ctx.fill(); // pinggul

    // badan
    const bt = -37;
    ctx.fillStyle = '#f6f7fb'; rr(ctx, -10.5, bt, 21, 18, 6); ctx.fill();
    ctx.fillStyle = 'rgba(60,70,130,0.12)'; rr(ctx, 4.5, bt + 1.5, 6, 15, 4); ctx.fill();
    if (!o.back) {
      ctx.fillStyle = accent; rr(ctx, -5.5, bt + 4, 11, 8, 2.5); ctx.fill(); // panel dada
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(-3.5, bt + 6, 3, 1.6); ctx.fillRect(1, bt + 6, 2.5, 1.6);
    } else {
      ctx.fillStyle = '#dfe2ee'; rr(ctx, -6, bt + 3, 12, 11, 3); ctx.fill(); // panel punggung
    }
    // lengan
    const armSw = o.working ? Math.sin(o.now / 80) * 1.6 : sw * 2.6;
    for (const [x, d] of [[-14, armSw], [9.5, -armSw]]) {
      ctx.fillStyle = limb; ctx.beginPath(); ctx.arc(x + 2.2, bt + 3, 3.2, 0, 7); ctx.fill(); // bahu
      rr(ctx, x, bt + 3 + d, 4.5, 13, 2); ctx.fill();
      ctx.fillStyle = '#f4f5fa'; ctx.beginPath(); ctx.arc(x + 2.2, bt + 17.5 + d, 2.9, 0, 7); ctx.fill();
      ctx.fillStyle = limb;
    }
    ctx.fillStyle = '#3a3f55'; ctx.fillRect(-2.5, bt - 3, 5, 4); // leher

    // kepala
    const hy = bt - 21; // sisi atas kepala
    const hg = ctx.createLinearGradient(-12, hy, 12, hy + 20);
    hg.addColorStop(0, '#ffffff'); hg.addColorStop(1, '#e6e8f2');
    ctx.fillStyle = hg; rr(ctx, -12, hy, 24, 20, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(40,50,110,0.12)'; ctx.lineWidth = 1; rr(ctx, -12, hy, 24, 20, 6); ctx.stroke();
    if (!o.back) {
      ctx.fillStyle = '#16193a'; rr(ctx, -7.5, hy + 4, 17, 12, 4); ctx.fill(); // layar wajah
      // mata berkedip (fase acak per robot)
      let seed = 0; for (const c of String(o.seed || '')) seed = (seed * 31 + c.charCodeAt(0)) % 997;
      const blink = ((o.now / 1000 + seed) % 4.2) < 0.13;
      ctx.fillStyle = o.working ? '#7dffb2' : '#8be9ff';
      if (blink) { ctx.fillRect(-3.5, hy + 10, 4, 1.2); ctx.fillRect(3.5, hy + 10, 4, 1.2); }
      else { rr(ctx, -3.5, hy + 7, 4, 5.5, 1.2); ctx.fill(); rr(ctx, 3.5, hy + 7, 4, 5.5, 1.2); ctx.fill(); }
      if (a.glasses) { ctx.strokeStyle = '#8be9ff'; ctx.lineWidth = 0.8; ctx.strokeRect(-4.5, hy + 6, 13, 7.5); }
    } else {
      ctx.fillStyle = '#d9dcea'; rr(ctx, -6, hy + 5, 12, 10, 3); ctx.fill();
    }
    ctx.fillStyle = '#d4d8e6'; rr(ctx, -13.5, hy + 7, 3, 7, 1.5); ctx.fill(); // telinga

    // aksesori sesuai jabatan
    let topY = hy;
    if (/voice|audio|suara|musik|music|call|support|customer|cs\b|telemarket/.test(role)) {
      ctx.strokeStyle = accent; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, hy + 6, 14, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
      ctx.fillStyle = accent; rr(ctx, -15.5, hy + 4, 5, 10, 2); ctx.fill(); rr(ctx, 10.5, hy + 4, 5, 10, 2); ctx.fill();
      topY = hy - 9;
    } else if (/video|film|editor|render|reel|motion|animat/.test(role)) {
      for (const [x, y] of [[-5, hy - 6], [5, hy - 7]]) {
        ctx.fillStyle = '#3a3f55'; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 7); ctx.fill();
        ctx.fillStyle = '#f4f5fa'; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(x + Math.cos(k * 1.57) * 2.8, y + Math.sin(k * 1.57) * 2.8, 1.1, 0, 7); ctx.fill(); }
      }
      topY = hy - 13;
    } else if (a.id !== 'boss') {
      ctx.strokeStyle = '#3a3f55'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(0, hy - 6); ctx.stroke();
      ctx.fillStyle = a.isDirector ? '#9b5de5' : a.isLead ? '#ffca28' : CORAL;
      ctx.beginPath(); ctx.arc(0, hy - 7.5, 2.6, 0, 7); ctx.fill();
      topY = hy - 10;
    }
    ctx.restore();
    return topY - lift;
  }
  R.drawRobot = drawRobot;

  function drawPerson(ctx, s, ent, rt, now) {
    const fx = rt.x / T, fy = rt.y / T;
    const p = iso(fx, fy);
    const moving = rt.cur && rt.cur.type === 'goto' && rt.path && rt.path.length > 0;
    let back = false, mirror = false;
    if (rt.sitting) {
      if (ent.id === 'boss') { back = false; mirror = true; } // boss menghadap ke depan (+ty)
      else { back = true; mirror = false; } // karyawan menghadap meja (-ty)
    } else if (rt.mdx != null) {
      const sx = rt.mdx - rt.mdy, sy = rt.mdx + rt.mdy; // arah di layar
      back = sy < -0.1;
      mirror = sx < -0.1;
    }
    const sel = R.selected === ent.id, hov = R.hover === ent.id;
    if (sel || hov) {
      ctx.strokeStyle = sel ? '#ffd166' : 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 16, 7, 0, 0, 7); ctx.stroke(); ctx.lineWidth = 1;
    }
    ctx.save();
    ctx.translate(p.x, p.y + (rt.sitting && back ? -2 : 0));
    ctx.scale(1.15, 1.15);
    const look = ent.live ? { ...ent, top: '#d97757', style: 'shirt', tie: '#5e2b1c' } : ent;
    const opts = { back, mirror, moving, phase: rt.phase, sitting: rt.sitting, working: rt.working, now, seed: ent.id };
    const headTop = robot() ? drawRobot(ctx, look, opts) : drawAvatar(ctx, look, opts);
    if (ent.id === 'boss') { // mahkota
      ctx.fillStyle = '#ffca28';
      const y = headTop + 2;
      poly(ctx, [{ x: -7, y }, { x: -7, y: y - 7 }, { x: -3.5, y: y - 3 }, { x: 0, y: y - 9 }, { x: 3.5, y: y - 3 }, { x: 7, y: y - 7 }, { x: 7, y }], '#ffca28', '#b8860b');
    }
    ctx.restore();
    rt._screen = { x: p.x, y: p.y, head: p.y + headTop * 1.15 };
  }

  /* ------------------------------------------------------------ overlay: label, nama, balon */
  function drawLabels(ctx, s) {
    if (modern()) return; // nama tim sudah dicat di lantai
    ctx.font = 'bold 13px Inter, system-ui, sans-serif';
    for (const div of s.divisions) {
      const p = iso(div.zone.x + 0.5, div.zone.y + 0.5);
      const label = 'Divisi ' + div.name;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = div.color; rr(ctx, p.x - 6, p.y - 12, tw + 32, 22, 6); ctx.fill();
      VO.drawIcon(ctx, 'layers', p.x + 6, p.y - 1, 12, '#fff');
      ctx.fillStyle = '#fff'; ctx.fillText(label, p.x + 17, p.y + 4);
    }
    ctx.font = 'bold 11px Inter, system-ui, sans-serif';
    const plate = (r, text, color) => {
      const p = iso(r.x + 1.2, r.y + 1, 50);
      const tw = ctx.measureText(text).width + 14;
      ctx.fillStyle = color; rr(ctx, p.x - 4, p.y - 9, tw, 17, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillText(text, p.x + 3, p.y + 3);
    };
    for (const f of s.facilities) plate(f, f.name, f.color);
    for (const d of s.departments) {
      const div = s.divisions.find((x) => x.id === d.divisionId);
      plate(d.room, d.name, div ? div.color : '#888888');
    }
  }

  function drawPersonOverlay(ctx, ent, rt, now) {
    const sc = rt._screen;
    if (!sc) return;
    const icon = rt.liveTool && rt.liveTool !== 'thinking' ? 'tool' : rt.liveTool === 'thinking' ? 'brain' : VO.sim.STATUS_ICON[rt.status];
    const sel0 = R.selected === ent.id, hov0 = R.hover === ent.id;
    let bubbleY = sc.head - 30;
    if (robot() && (R.cam.zoom >= 0.45 || sel0 || hov0)) {
      // label pil: titik status · Nama · Jabatan, plus chip aktivitas saat bekerja
      const name = ent.name;
      const showRole = R.cam.zoom >= 1.7 || sel0 || hov0;
      const role = showRole ? (ent.id === 'boss' ? 'Boss (Kamu)' : ent.role || '') : '';
      ctx.font = 'bold 9.5px Inter, system-ui, sans-serif';
      const w1 = ctx.measureText(name).width;
      ctx.font = '9px Inter, system-ui, sans-serif';
      const w2 = role ? ctx.measureText(' · ' + role).width : 0;
      const pw = w1 + w2 + 24, ph = 16;
      const px = sc.x - pw / 2, py = sc.head - ph - 10;
      ctx.save();
      ctx.shadowColor = 'rgba(40,50,120,0.16)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
      ctx.fillStyle = '#ffffff'; rr(ctx, px, py, pw, ph, 9); ctx.fill();
      ctx.restore();
      if (sel0) { ctx.strokeStyle = NAVY; ctx.lineWidth = 1.5; rr(ctx, px, py, pw, ph, 9); ctx.stroke(); ctx.lineWidth = 1; }
      const busy = rt.working || ['briefing', 'reporting', 'meeting'].includes(rt.status);
      ctx.fillStyle = busy ? ORANGE : rt.status === 'walking' ? '#9aa3b8' : '#2fb36b';
      ctx.beginPath(); ctx.arc(px + 9, py + ph / 2, 3.2, 0, 7); ctx.fill();
      ctx.fillStyle = '#1b2140'; ctx.font = 'bold 9.5px Inter, system-ui, sans-serif'; ctx.fillText(name, px + 16, py + 11.3);
      if (role) { ctx.fillStyle = '#6b7190'; ctx.font = '9px Inter, system-ui, sans-serif'; ctx.fillText(' · ' + role, px + 16 + w1, py + 11.3); }
      const chipTxt = rt.liveTool && rt.liveTool !== 'thinking' ? 'Pakai ' + rt.liveTool
        : rt.working ? (rt.activity || 'Sedang bekerja') + (rt.progress > 0 && rt.progress < 1 ? ` · ${Math.round(rt.progress * 100)}%` : '')
        : ({ briefing: 'Menerima briefing', reporting: 'Melapor ke atasan', meeting: 'Rapat' })[rt.status];
      let top = py;
      if (chipTxt) {
        ctx.font = 'bold 9px Inter, system-ui, sans-serif';
        const cw = Math.min(170, ctx.measureText(chipTxt).width) + 14;
        const cx = sc.x - cw / 2, cy = py + ph + 3;
        ctx.fillStyle = ORANGE; rr(ctx, cx, cy, cw, 15, 4); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.save(); ctx.beginPath(); ctx.rect(cx + 4, cy, cw - 8, 15); ctx.clip();
        ctx.fillText(chipTxt, cx + 7, cy + 10.8); ctx.restore();
      }
      if (!chipTxt) drawBubble(ctx, rt, sc, top - 26, now); // chip sudah menjelaskan aktivitas
      return;
    }
    if (modern() && (R.cam.zoom >= 0.5 || sel0 || hov0)) {
      // kartu nama melayang: nama (tebal) + jabatan
      const name = ent.name, role = ent.id === 'boss' ? 'Boss (Kamu)' : ent.role || '';
      ctx.font = 'bold 10.5px Inter, system-ui, sans-serif';
      const w1 = ctx.measureText(name).width;
      ctx.font = '9px Inter, system-ui, sans-serif';
      const w2 = ctx.measureText(role).width;
      const iw = icon || ent.isLead || ent.isDirector ? 14 : 0;
      const cw = Math.max(w1, w2) + 16 + iw, ch = 29;
      const cx = sc.x - cw / 2, cy = sc.head - ch - 8;
      ctx.save();
      ctx.shadowColor = 'rgba(30,40,70,0.18)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
      ctx.fillStyle = sel0 ? '#fff8e6' : '#ffffff'; rr(ctx, cx, cy, cw, ch, 7); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = sel0 ? '#f0b429' : 'rgba(40,50,80,0.12)'; ctx.lineWidth = 1; rr(ctx, cx, cy, cw, ch, 7); ctx.stroke();
      if (iw) VO.drawIcon(ctx, icon || (ent.isDirector ? 'briefcase' : 'star'), cx + 11, cy + ch / 2, 9, rt.working ? '#3b7cff' : ent.isDirector ? '#8e44ad' : ent.isLead && !icon ? '#e0a100' : '#6b7385');
      ctx.fillStyle = '#1d2230'; ctx.font = 'bold 10.5px Inter, system-ui, sans-serif'; ctx.fillText(name, cx + 8 + iw, cy + 12.5);
      ctx.fillStyle = '#6b7385'; ctx.font = '9px Inter, system-ui, sans-serif'; ctx.fillText(role, cx + 8 + iw, cy + 23.5);
      if (rt.working && rt.progress > 0 && rt.progress < 1 && !ent.live) {
        ctx.fillStyle = '#e6eaf1'; ctx.fillRect(cx + 6, cy + ch - 3.5, cw - 12, 2.5);
        ctx.fillStyle = '#3b7cff'; ctx.fillRect(cx + 6, cy + ch - 3.5, (cw - 12) * rt.progress, 2.5);
      }
      bubbleY = cy - 24;
      drawBubble(ctx, rt, sc, bubbleY, now);
      return;
    }
    if (icon) VO.drawIcon(ctx, icon, sc.x - 15, sc.head + 6, 8, '#1d1f27', 'rgba(255,255,255,0.94)');
    if (ent.isDirector || ent.isLead) VO.drawIcon(ctx, ent.isDirector ? 'briefcase' : 'star', sc.x + 14, sc.head + 6, 7, '#fff', ent.isDirector ? '#ab47bc' : '#ffb300');
    if (rt.working && rt.progress > 0 && rt.progress < 1 && !ent.live) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(sc.x - 13, sc.head - 6, 26, 5);
      ctx.fillStyle = '#66bb6a'; ctx.fillRect(sc.x - 12, sc.head - 5, 24 * rt.progress, 3);
    }
    const sel = R.selected === ent.id, hov = R.hover === ent.id;
    if (R.cam.zoom >= 0.8 || sel || hov) {
      ctx.font = `${ent.id === 'boss' ? 'bold ' : ''}10px Inter, system-ui, sans-serif`;
      const tw = ctx.measureText(ent.name).width;
      ctx.fillStyle = 'rgba(20,22,30,0.78)'; rr(ctx, sc.x - tw / 2 - 5, sc.y + 6, tw + 10, 14, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(ent.name, sc.x - tw / 2, sc.y + 16.5);
    }
    drawBubble(ctx, rt, sc, bubbleY, now);
  }

  function drawBubble(ctx, rt, sc, by, now) {
    if (rt.bubble && rt.bubble.until > now) {
      const text = rt.bubble.text, bi = rt.bubble.icon;
      ctx.font = '11px Inter, system-ui, sans-serif';
      const iw = bi ? 14 : 0;
      const tw = Math.min(200, ctx.measureText(text).width) + iw;
      const bx = sc.x - tw / 2 - 7;
      ctx.globalAlpha = Math.min(1, (rt.bubble.until - now) / 300);
      ctx.fillStyle = '#ffffff'; rr(ctx, bx, by, tw + 14, 19, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sc.x - 4, by + 19); ctx.lineTo(sc.x, by + 24); ctx.lineTo(sc.x + 4, by + 19); ctx.fill();
      if (bi) VO.drawIcon(ctx, bi, bx + 12, by + 9.5, 10, '#4f8cff');
      ctx.fillStyle = '#1d1f27';
      ctx.save(); ctx.beginPath(); ctx.rect(bx + 4, by, tw + 6, 19); ctx.clip();
      ctx.fillText(text, bx + 7 + iw, by + 13.5); ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  function drawEditOverlay(ctx, s, ui) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = modern() ? 'rgba(40,50,80,0.08)' : 'rgba(255,255,255,0.07)';
    for (let x = 0; x <= s.map.w; x++) { const a = iso(x, 0), b = iso(x, s.map.h); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    for (let y = 0; y <= s.map.h; y++) { const a = iso(0, y), b = iso(s.map.w, y); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    const outline = (r, col) => {
      ctx.lineWidth = 2;
      poly(ctx, diamond(r.x, r.y, r.w, r.h), null, col);
      const h = iso(r.x + r.w, r.y + r.h);
      poly(ctx, [{ x: h.x, y: h.y - 9 }, { x: h.x + 9, y: h.y }, { x: h.x, y: h.y + 9 }, { x: h.x - 9, y: h.y }], col);
      ctx.lineWidth = 1;
    };
    for (const div of s.divisions) outline(div.zone, R.hoverObj === div ? '#ffffff' : div.color);
    for (const d of s.departments) outline(d.room, R.hoverObj === d ? '#ffffff' : 'rgba(255,209,102,0.95)');
    for (const f of s.facilities) outline(f, R.hoverObj === f ? '#ffffff' : 'rgba(129,212,250,0.95)');
    if (ui.hoverTile) {
      const { x, y } = ui.hoverTile;
      if (ui.tool && ui.tool.startsWith('furn:')) { ctx.globalAlpha = 0.6; drawFurniture(ctx, { type: ui.tool.slice(5), x, y }); ctx.globalAlpha = 1; }
      ctx.lineWidth = 2;
      poly(ctx, diamond(x, y), ui.tool === 'erase' ? 'rgba(239,83,80,0.25)' : 'rgba(255,209,102,0.25)', ui.tool === 'erase' ? '#ef5350' : '#ffd166');
      ctx.lineWidth = 1;
    }
  }

  /* ------------------------------------------------------------ frame */
  R.draw = function (canvas, s, ui) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const now = performance.now();
    if (R.staticDirty || !floorCanvas) {
      buildFloor(s);
      buildProps(s);
      R.staticDirty = false;
    }
    updateGeo(s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    if (robot()) { g.addColorStop(0, '#f3f4fa'); g.addColorStop(1, '#e3e6f2'); }
    else if (modern()) { g.addColorStop(0, '#f6f8fb'); g.addColorStop(1, '#e4e9f1'); }
    else { g.addColorStop(0, '#1b1f2a'); g.addColorStop(1, '#12141a'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const z = R.cam.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, -R.cam.x * z, -R.cam.y * z);
    ctx.drawImage(floorCanvas, 0, 0);

    // gabungkan props + karakter, urutkan dari belakang ke depan
    const people = [s.boss, ...s.agents].map((e) => [e, VO.sim.rt.get(e.id)]).filter(([, rt]) => rt);
    const items = props.slice();
    for (const [e, rt] of people) items.push({ k: rt.x / T + rt.y / T + 0.05, d: (c) => drawPerson(c, s, e, rt, now) });
    items.sort((a, b) => a.k - b.k);
    for (const it of items) it.d(ctx, now, s);

    drawLabels(ctx, s);
    if (ui.edit) drawEditOverlay(ctx, s, ui);
    for (const [e, rt] of people) drawPersonOverlay(ctx, e, rt, now);
  };

  /* ------------------------------------------------------------ kamera & hit test */
  // Koordinat layar → "dunia" dalam satuan simulasi (tile × T), dipakai editor & klik
  R.screenToIso = (sx, sy) => ({ x: sx / R.cam.zoom + R.cam.x, y: sy / R.cam.zoom + R.cam.y });
  R.screenToWorld = (sx, sy) => {
    const p = R.screenToIso(sx, sy);
    const t = toTile(p.x, p.y);
    return { x: t.x * T, y: t.y * T };
  };

  R.hitPerson = function (s, wx, wy) {
    const p = iso(wx / T, wy / T); // kembali ke koordinat isometrik
    let best = null, bd = Infinity;
    for (const e of [s.boss, ...s.agents]) {
      const rt = VO.sim.rt.get(e.id);
      const sc = rt && rt._screen;
      if (!sc) continue;
      if (p.x < sc.x - 16 || p.x > sc.x + 16 || p.y < sc.head - 4 || p.y > sc.y + 4) continue;
      const d = Math.abs(p.x - sc.x) + Math.abs(p.y - (sc.y + sc.head) / 2) * 0.5 - sc.y * 0.001;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };

  R.focus = function (canvas, wx, wy) {
    const p = iso(wx / T, wy / T, 20);
    const vw = canvas.clientWidth / R.cam.zoom, vh = canvas.clientHeight / R.cam.zoom;
    R.cam.x = p.x - vw / 2;
    R.cam.y = p.y - vh / 2;
  };

  // Tampilkan area yang berisi ruangan/zona/furnitur (bukan seluruh lantai kosong)
  R.fit = function (canvas, s) {
    updateGeo(s);
    const rects = [...s.facilities, ...s.departments.map((d) => d.room), ...s.divisions.map((d) => d.zone), ...s.furniture.map((f) => ({ x: f.x, y: f.y, w: 1, h: 1 }))];
    if (!rects.length) rects.push({ x: 0, y: 0, w: s.map.w, h: s.map.h });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rects) {
      for (const p of [iso(r.x - 1, r.y - 1, 60), iso(r.x + r.w + 1, r.y - 1, 60), iso(r.x + r.w + 1, r.y + r.h + 1), iso(r.x - 1, r.y + r.h + 1)]) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
    }
    const W = x1 - x0, H = y1 - y0;
    R.cam.zoom = VO.clamp(Math.min(canvas.clientWidth / W, canvas.clientHeight / H) * 0.97, 0.2, 2.2);
    R.cam.x = x0 + W / 2 - canvas.clientWidth / R.cam.zoom / 2;
    R.cam.y = y0 + H / 2 - canvas.clientHeight / R.cam.zoom / 2;
  };

  /* ------------------------------------------------------------ potret (inspector) */
  const portraitCache = new Map();
  R.portrait = function (ent) {
    const key = [theme() === 'robot', ent.role, ent.skin, ent.hair, ent.hairStyle, ent.top, ent.pants, ent.tie, ent.style, ent.glasses, ent.mustache, ent.id === 'boss', ent.isLead, ent.isDirector].join('|');
    if (portraitCache.has(key)) return portraitCache.get(key);
    const c = document.createElement('canvas');
    c.width = 88; c.height = 88;
    const ctx = c.getContext('2d');
    ctx.scale(2, 2);
    ctx.translate(22, 70);
    const po = { back: false, mirror: false, moving: false, phase: 0, sitting: false, working: false, now: 0, seed: ent.id };
    const top = theme() === 'robot' ? drawRobot(ctx, ent, po) : drawAvatar(ctx, ent, po);
    if (ent.id === 'boss') poly(ctx, [{ x: -7, y: top + 2 }, { x: -7, y: top - 5 }, { x: -3.5, y: top - 1 }, { x: 0, y: top - 7 }, { x: 3.5, y: top - 1 }, { x: 7, y: top - 5 }, { x: 7, y: top + 2 }], '#ffca28');
    const url = c.toDataURL();
    portraitCache.set(key, url);
    return url;
  };
})();
