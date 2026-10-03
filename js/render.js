/* =========================================================================
 * render.js — menggambar kantor di <canvas> (gaya pixel / top-down).
 * Layer statis (lantai, dinding, meja, furnitur) di-cache di offscreen canvas,
 * layer dinamis (karyawan, monitor, balon chat) digambar tiap frame.
 * ========================================================================= */
(function () {
  const VO = window.VO;
  const T = VO.TILE;
  const R = (VO.render = { cam: { x: 0, y: 0, zoom: 1 }, staticDirty: true, hover: null, selected: null });

  let staticCanvas = null;

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

  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  /* ------------------------------------------------------------ static layer */
  function buildStatic(s) {
    const W = s.map.w * T, H = s.map.h * T;
    if (!staticCanvas) staticCanvas = document.createElement('canvas');
    staticCanvas.width = W; staticCanvas.height = H;
    const ctx = staticCanvas.getContext('2d');
    const fl = VO.FLOORS[s.settings.floor] || VO.FLOORS.wood;

    // lantai
    for (let y = 0; y < s.map.h; y++)
      for (let x = 0; x < s.map.w; x++) {
        ctx.fillStyle = (x + y) % 2 ? fl.a : fl.b;
        ctx.fillRect(x * T, y * T, T, T);
      }
    if (s.settings.floor === 'wood') {
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      for (let y = 0; y < s.map.h * 2; y++) { ctx.beginPath(); ctx.moveTo(0, y * 16 + 0.5); ctx.lineTo(W, y * 16 + 0.5); ctx.stroke(); }
    }
    // dinding luar
    ctx.strokeStyle = '#2a2e38'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, W - 6, H - 6); ctx.lineWidth = 1;

    // zona divisi
    for (const div of s.divisions) {
      const z = div.zone;
      ctx.fillStyle = hexA(div.color, 0.13);
      ctx.fillRect(z.x * T, z.y * T, z.w * T, z.h * T);
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = hexA(div.color, 0.8); ctx.lineWidth = 2;
      ctx.strokeRect(z.x * T + 1, z.y * T + 1, z.w * T - 2, z.h * T - 2);
      ctx.setLineDash([]); ctx.lineWidth = 1;
      // label
      ctx.font = 'bold 15px Inter, system-ui, sans-serif';
      const label = '🏛 Divisi ' + div.name;
      const tw = ctx.measureText(label).width;
      const lx = (div.directorDesk.x + 1.8) * T, ly = z.y * T + 6;
      ctx.fillStyle = div.color; rr(ctx, lx, ly, tw + 16, 22, 6); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(label, lx + 8, ly + 16);
      drawDesk(ctx, div.directorDesk.x, div.directorDesk.y, '#4a3b55');
      drawChair(ctx, div.directorDesk.x, div.directorDesk.y + 1);
    }

    // fasilitas
    for (const f of s.facilities) {
      drawRoomFloor(ctx, f, f.color);
      drawFacilityInterior(ctx, s, f);
      drawWalls(ctx, f, f);
      plate(ctx, f, f.name, f.color);
    }
    // departemen
    for (const d of s.departments) {
      const div = s.divisions.find((x) => x.id === d.divisionId);
      const color = div ? div.color : '#888888';
      drawRoomFloor(ctx, d.room, color);
      const slots = VO.deskSlots(d.room);
      slots.forEach((sl) => { drawDesk(ctx, sl.desk.x, sl.desk.y); drawChair(ctx, sl.chair.x, sl.chair.y); });
      drawWalls(ctx, d.room, null);
      plate(ctx, d.room, d.name, color);
    }
    for (const f of s.furniture) drawFurniture(ctx, f);
    R.staticDirty = false;
  }

  function drawRoomFloor(ctx, r, color) {
    ctx.fillStyle = '#ebe5da';
    ctx.fillRect(r.x * T, r.y * T, r.w * T, r.h * T);
    ctx.fillStyle = hexA(color, 0.2);
    ctx.fillRect(r.x * T, r.y * T, r.w * T, r.h * T);
    ctx.strokeStyle = 'rgba(0,0,0,0.04)';
    for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) ctx.strokeRect(x * T + 0.5, y * T + 0.5, T - 1, T - 1);
  }

  function drawWalls(ctx, r, fac) {
    const doors = VO.doorTiles(r, fac);
    const isDoor = (x, y) => doors.some((d) => d.x === x && d.y === y);
    const tile = (x, y) => {
      if (isDoor(x, y)) {
        ctx.fillStyle = '#8a6a4a';
        ctx.fillRect(x * T, y * T + 12, 3, 8); ctx.fillRect(x * T + T - 3, y * T + 12, 3, 8);
        return;
      }
      ctx.fillStyle = '#434957'; ctx.fillRect(x * T, y * T, T, T);
      ctx.fillStyle = '#5a6172'; ctx.fillRect(x * T, y * T, T, 7);
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x * T, y * T + T - 3, T, 3);
    };
    for (let x = r.x; x < r.x + r.w; x++) { tile(x, r.y); tile(x, r.y + r.h - 1); }
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) { tile(r.x, y); tile(r.x + r.w - 1, y); }
    // jendela kaca di dinding atas
    ctx.fillStyle = 'rgba(160,210,255,0.55)';
    for (let x = r.x + 1; x < r.x + r.w - 1; x += 3) if (!isDoor(x, r.y)) ctx.fillRect(x * T + 6, r.y * T + 10, T - 12, 10);
  }

  function plate(ctx, r, text, color) {
    ctx.font = 'bold 12px Inter, system-ui, sans-serif';
    const tw = ctx.measureText(text).width + 14;
    const x = r.x * T + 10, y = r.y * T - 9;
    ctx.fillStyle = color; rr(ctx, x, y, tw, 18, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillText(text, x + 7, y + 13);
  }

  function drawDesk(ctx, x, y, top = '#a47148') {
    const px = x * T, py = y * T;
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(px + 3, py + 22, 27, 5);
    ctx.fillStyle = '#7a5134'; ctx.fillRect(px + 2, py + 8, 28, 16);
    ctx.fillStyle = top; ctx.fillRect(px + 2, py + 8, 28, 11);
    // keyboard
    ctx.fillStyle = '#d9dce3'; ctx.fillRect(px + 10, py + 14, 12, 3);
    // cangkir
    ctx.fillStyle = '#fff'; ctx.fillRect(px + 25, py + 10, 3, 4);
  }

  function drawChair(ctx, x, y) {
    const px = x * T + T / 2, py = y * T + T / 2;
    ctx.fillStyle = '#2f3440';
    ctx.beginPath(); ctx.ellipse(px, py + 6, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
  }

  function drawFacilityInterior(ctx, s, f) {
    if (f.type === 'boss') {
      // karpet
      ctx.fillStyle = 'rgba(140,30,40,0.35)';
      rr(ctx, (f.x + 2) * T, (f.y + 1.5) * T, (f.w - 4) * T, (f.h - 3) * T, 10); ctx.fill();
      const seat = VO.bossSeat(s);
      const dx = (seat.desk.x - 1) * T, dy = seat.desk.y * T;
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(dx + 4, dy + 24, 3 * T - 6, 6);
      ctx.fillStyle = '#3e2618'; ctx.fillRect(dx + 2, dy + 4, 3 * T - 4, 22);
      ctx.fillStyle = '#5c3a24'; ctx.fillRect(dx + 2, dy + 4, 3 * T - 4, 15);
      ctx.fillStyle = '#d4a843'; ctx.fillRect(dx + 2, dy + 18, 3 * T - 4, 2);
      ctx.fillStyle = '#f1f1f1'; ctx.fillRect(dx + 12, dy + 8, 10, 7); // dokumen
      ctx.fillStyle = '#2e7d32'; ctx.beginPath(); ctx.arc(dx + 3 * T - 14, dy + 9, 5, 0, 7); ctx.fill();
      ctx.fillStyle = '#4a2c1a'; // kursi boss
      rr(ctx, seat.chair.x * T + 5, seat.chair.y * T + 2, 22, 22, 6); ctx.fill();
      // rak & trofi
      drawFurniture(ctx, { type: 'bookshelf', x: f.x + 1, y: f.y + 1 });
      drawFurniture(ctx, { type: 'plant', x: f.x + f.w - 2, y: f.y + 1 });
    } else if (f.type === 'meeting') {
      const t = VO.meetingTable(f);
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; rr(ctx, t.x * T + 4, t.y * T + 8, t.w * T, t.h * T, 18); ctx.fill();
      ctx.fillStyle = '#6b4f3a'; rr(ctx, t.x * T, t.y * T + 2, t.w * T, t.h * T - 4, 18); ctx.fill();
      ctx.fillStyle = '#80614a'; rr(ctx, t.x * T + 4, t.y * T + 5, t.w * T - 8, t.h * T - 14, 14); ctx.fill();
      for (let x = t.x; x < t.x + t.w; x++) { drawChair(ctx, x, t.y - 1); drawChair(ctx, x, t.y + t.h); }
      // layar presentasi
      ctx.fillStyle = '#222'; ctx.fillRect((f.x + f.w / 2 - 2) * T, (f.y + 1) * T + 2, 4 * T, 10);
      ctx.fillStyle = '#4fc3f7'; ctx.fillRect((f.x + f.w / 2 - 2) * T + 3, (f.y + 1) * T + 4, 4 * T - 6, 6);
    } else if (f.type === 'pantry') {
      ctx.fillStyle = '#9aa1ad'; ctx.fillRect((f.x + 1) * T, (f.y + 1) * T, (f.w - 2) * T, T - 4);
      ctx.fillStyle = '#c7ccd4'; ctx.fillRect((f.x + 1) * T, (f.y + 1) * T, (f.w - 2) * T, 8);
      const mx = (f.x + 2) * T; // mesin kopi
      ctx.fillStyle = '#222'; ctx.fillRect(mx + 4, (f.y + 1) * T - 4, 18, 22);
      ctx.fillStyle = '#e53935'; ctx.fillRect(mx + 8, (f.y + 1) * T, 4, 4);
      const fx = (f.x + f.w - 3) * T; // kulkas
      ctx.fillStyle = '#eceff1'; ctx.fillRect(fx + 6, (f.y + 1) * T - 8, 20, 30);
      ctx.fillStyle = '#90a4ae'; ctx.fillRect(fx + 22, (f.y + 1) * T, 2, 8);
      // meja bar kecil
      ctx.fillStyle = '#d7ccc8';
      for (let i = 0; i < Math.floor((f.w - 2) / 3); i++) { ctx.beginPath(); ctx.arc((f.x + 2 + i * 3) * T, (f.y + f.h - 3) * T, 12, 0, 7); ctx.fill(); }
    } else if (f.type === 'lounge') {
      ctx.fillStyle = 'rgba(157,78,221,0.25)';
      rr(ctx, (f.x + 1.5) * T, (f.y + 2) * T, (f.w - 3) * T, (f.h - 3.5) * T, 14); ctx.fill();
      drawFurniture(ctx, { type: 'sofa', x: f.x + 2, y: f.y + 1 });
      drawFurniture(ctx, { type: 'sofa', x: f.x + 4, y: f.y + 1 });
      drawFurniture(ctx, { type: 'arcade', x: f.x + f.w - 2, y: f.y + 1 });
    }
  }

  function drawFurniture(ctx, f) {
    const px = f.x * T, py = f.y * T;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(px + 16, py + 28, 12, 4, 0, 0, 7); ctx.fill();
    switch (f.type) {
      case 'plant':
        ctx.fillStyle = '#8d5a3b'; ctx.fillRect(px + 10, py + 18, 12, 10);
        ctx.fillStyle = '#2e7d32';
        for (const [ox, oy, r] of [[16, 12, 8], [10, 15, 6], [22, 15, 6], [16, 6, 6]]) { ctx.beginPath(); ctx.arc(px + ox, py + oy, r, 0, 7); ctx.fill(); }
        ctx.fillStyle = '#43a047'; ctx.beginPath(); ctx.arc(px + 14, py + 9, 4, 0, 7); ctx.fill();
        break;
      case 'sofa':
        ctx.fillStyle = '#5c6bc0'; rr(ctx, px + 1, py + 6, 30, 20, 6); ctx.fill();
        ctx.fillStyle = '#7986cb'; rr(ctx, px + 5, py + 13, 22, 10, 4); ctx.fill();
        break;
      case 'bookshelf':
        ctx.fillStyle = '#6d4c41'; ctx.fillRect(px + 3, py, 26, 28);
        for (let r = 0; r < 3; r++) for (let b = 0; b < 5; b++) {
          ctx.fillStyle = VO.SHIRTS[(r * 5 + b) % VO.SHIRTS.length];
          ctx.fillRect(px + 5 + b * 4.6, py + 2 + r * 9, 3.5, 7);
        }
        break;
      case 'whiteboard':
        ctx.fillStyle = '#90a4ae'; ctx.fillRect(px + 14, py + 18, 3, 10);
        ctx.fillStyle = '#fafafa'; ctx.fillRect(px + 1, py + 2, 30, 18);
        ctx.strokeStyle = '#78909c'; ctx.strokeRect(px + 1.5, py + 2.5, 29, 17);
        ctx.strokeStyle = '#e53935'; ctx.beginPath(); ctx.moveTo(px + 5, py + 14); ctx.lineTo(px + 12, py + 8); ctx.lineTo(px + 18, py + 12); ctx.lineTo(px + 26, py + 6); ctx.stroke();
        break;
      case 'cooler':
        ctx.fillStyle = '#eceff1'; ctx.fillRect(px + 9, py + 12, 14, 16);
        ctx.fillStyle = 'rgba(66,165,245,0.85)'; ctx.fillRect(px + 10, py + 1, 12, 12);
        break;
      case 'printer':
        ctx.fillStyle = '#cfd8dc'; ctx.fillRect(px + 4, py + 10, 24, 16);
        ctx.fillStyle = '#37474f'; ctx.fillRect(px + 6, py + 14, 20, 3);
        ctx.fillStyle = '#fff'; ctx.fillRect(px + 9, py + 5, 14, 7);
        break;
      case 'server':
        ctx.fillStyle = '#263238'; ctx.fillRect(px + 5, py, 22, 28);
        for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#66bb6a' : '#29b6f6'; ctx.fillRect(px + 8, py + 3 + i * 5, 3, 2); }
        break;
      case 'arcade':
        ctx.fillStyle = '#6a1b9a'; ctx.fillRect(px + 6, py, 20, 28);
        ctx.fillStyle = '#00e5ff'; ctx.fillRect(px + 9, py + 4, 14, 9);
        ctx.fillStyle = '#ffeb3b'; ctx.beginPath(); ctx.arc(px + 12, py + 18, 2, 0, 7); ctx.fill();
        ctx.fillStyle = '#f44336'; ctx.beginPath(); ctx.arc(px + 20, py + 18, 2, 0, 7); ctx.fill();
        break;
    }
  }
  R.drawFurniture = drawFurniture;

  /* ------------------------------------------------------------ dynamic */
  function drawMonitors(ctx, s, now) {
    const seats = [];
    for (const d of s.departments) {
      const ag = VO.deptAgents(s, d.id);
      VO.deskSlots(d.room).forEach((sl, i) => seats.push({ desk: sl.desk, ent: ag[i] }));
    }
    for (const div of s.divisions) seats.push({ desk: div.directorDesk, ent: VO.director(s, div.id) });
    for (const { desk, ent } of seats) {
      const rt = ent && VO.sim.rt.get(ent.id);
      const px = desk.x * T, py = desk.y * T;
      ctx.fillStyle = '#1d2129'; ctx.fillRect(px + 8, py - 1, 16, 12);
      ctx.fillRect(px + 14, py + 10, 4, 3);
      let col = '#20242c';
      if (ent) col = rt && rt.working ? '#123a5c' : '#2d3a4f';
      ctx.fillStyle = col; ctx.fillRect(px + 9, py, 14, 9);
      if (rt && rt.working) {
        for (let i = 0; i < 3; i++) {
          const w = 4 + ((Math.sin(now / 180 + i * 2 + desk.x) + 1) * 4) | 0;
          ctx.fillStyle = ['#4fc3f7', '#81c784', '#ffd54f'][i];
          ctx.fillRect(px + 10, py + 1.5 + i * 2.6, w, 1.4);
        }
        ctx.fillStyle = 'rgba(79,195,247,0.12)';
        ctx.beginPath(); ctx.arc(px + 16, py + 6, 16, 0, 7); ctx.fill();
      }
    }
  }

  const STATUS_ICON = { working: '💻', coffee: '☕', meeting: '👥', briefing: '📋', reporting: '📨', chat: '💬', break: '🌿' };

  function drawPerson(ctx, s, ent, rt, now) {
    const x = rt.x, y = rt.y;
    const moving = rt.status === 'walking' || (rt.cur && rt.cur.type === 'goto');
    const back = rt.sitting && ent.id !== 'boss';
    const bob = moving ? Math.sin(rt.phase * 14) * 1.2 : 0;
    const sel = R.selected === ent.id, hov = R.hover === ent.id;

    if (sel || hov) {
      ctx.strokeStyle = sel ? '#ffd166' : 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y + 11, 13, 5, 0, 0, 7); ctx.stroke(); ctx.lineWidth = 1;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(x, y + 11, 9, 3.5, 0, 0, 7); ctx.fill();

    const by = y - 4 + bob - (rt.sitting ? 1 : 0);
    // kaki
    if (!rt.sitting) {
      const sw = moving ? Math.sin(rt.phase * 14) * 3 : 0;
      ctx.fillStyle = '#2d3142';
      ctx.fillRect(x - 5, by + 8, 4, 7 + sw * 0.3);
      ctx.fillRect(x + 1, by + 8, 4, 7 - sw * 0.3);
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(x - 6 + sw * 0.4, by + 14, 5, 2.5); ctx.fillRect(x + 1 - sw * 0.4, by + 14, 5, 2.5);
    }
    // badan
    ctx.fillStyle = ent.live ? '#d97757' : ent.shirt;
    rr(ctx, x - 8, by - 3, 16, 13, 4); ctx.fill();
    if (!back && (ent.id === 'boss' || ent.isDirector)) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x - 3, by - 3); ctx.lineTo(x + 3, by - 3); ctx.lineTo(x, by + 2); ctx.fill();
      ctx.fillStyle = ent.id === 'boss' ? '#c62828' : '#1565c0'; ctx.fillRect(x - 1, by - 1, 2, 8);
    }
    // lengan
    ctx.fillStyle = ent.live ? '#c0623f' : shade(ent.shirt);
    const armSw = rt.working ? Math.sin(now / 90) * 1.5 : moving ? Math.sin(rt.phase * 14) * 2 : 0;
    ctx.fillRect(x - 10, by - 1 + armSw, 3, 9); ctx.fillRect(x + 7, by - 1 - armSw, 3, 9);
    // kepala
    const hy = by - 9;
    ctx.fillStyle = ent.skin; ctx.beginPath(); ctx.arc(x, hy, 7, 0, 7); ctx.fill();
    ctx.fillStyle = ent.hair;
    if (back) { ctx.beginPath(); ctx.arc(x, hy - 0.5, 7.2, 0, 7); ctx.fill(); }
    else {
      ctx.beginPath(); ctx.arc(x, hy - 1.5, 7.2, Math.PI, 0); ctx.fill();
      ctx.fillRect(x - 7, hy - 2, 3, 4); ctx.fillRect(x + 4, hy - 2, 3, 4);
      ctx.fillStyle = '#1a1a1a';
      const lx = rt.facing * 0.8;
      ctx.fillRect(x - 3 + lx, hy + 0.5, 1.8, 2); ctx.fillRect(x + 1.5 + lx, hy + 0.5, 1.8, 2);
      if (ent.live) { ctx.fillStyle = '#d97757'; ctx.fillRect(x - 6, hy - 9, 12, 3); }
    }
    // mahkota boss / badge
    if (ent.id === 'boss') {
      ctx.fillStyle = '#ffca28';
      ctx.beginPath(); ctx.moveTo(x - 6, hy - 7); ctx.lineTo(x - 6, hy - 13); ctx.lineTo(x - 3, hy - 9); ctx.lineTo(x, hy - 14); ctx.lineTo(x + 3, hy - 9); ctx.lineTo(x + 6, hy - 13); ctx.lineTo(x + 6, hy - 7); ctx.closePath(); ctx.fill();
    } else if (ent.isDirector || ent.isLead) {
      ctx.fillStyle = ent.isDirector ? '#ab47bc' : '#ffb300';
      ctx.beginPath(); ctx.arc(x + 8, hy - 6, 4, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(ent.isDirector ? 'D' : '★', x + 8, hy - 4); ctx.textAlign = 'left';
    }
    // ikon status
    const icon = rt.liveTool && rt.liveTool !== 'thinking' ? '🔧' : rt.liveTool === 'thinking' ? '🧠' : STATUS_ICON[rt.status];
    if (icon) {
      ctx.font = '10px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(icon, x - 10, hy - 6);
      ctx.textAlign = 'left';
    }
    // progress bar kerja
    if (rt.working && rt.progress > 0 && rt.progress < 1 && !ent.live) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - 11, hy - 15, 22, 4);
      ctx.fillStyle = '#66bb6a'; ctx.fillRect(x - 10, hy - 14, 20 * rt.progress, 2);
    }
    // nama
    if (R.cam.zoom >= 0.85 || sel || hov) {
      ctx.font = `${ent.id === 'boss' ? 'bold ' : ''}9px Inter, system-ui, sans-serif`;
      const name = ent.name;
      const tw = ctx.measureText(name).width;
      ctx.fillStyle = 'rgba(20,22,30,0.72)'; rr(ctx, x - tw / 2 - 4, y + 14, tw + 8, 12, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(name, x - tw / 2, y + 23);
    }
  }

  function drawBubble(ctx, rt, now) {
    if (!rt.bubble || rt.bubble.until < now) return;
    const text = rt.bubble.text;
    ctx.font = '10px Inter, system-ui, "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji", sans-serif';
    const tw = Math.min(180, ctx.measureText(text).width);
    const x = rt.x - tw / 2 - 6, y = rt.y - 46;
    const fade = Math.min(1, (rt.bubble.until - now) / 300);
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#ffffff'; rr(ctx, x, y, tw + 12, 17, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rt.x - 4, y + 17); ctx.lineTo(rt.x, y + 22); ctx.lineTo(rt.x + 4, y + 17); ctx.fill();
    ctx.fillStyle = '#1d1f27';
    ctx.save(); ctx.beginPath(); ctx.rect(x + 4, y, tw + 4, 17); ctx.clip();
    ctx.fillText(text, x + 6, y + 12); ctx.restore();
    ctx.globalAlpha = 1;
  }

  function shade(hex) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.floor(v * 0.78));
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  /* ------------------------------------------------------------ edit overlay */
  function drawEditOverlay(ctx, s, ui) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let x = 0; x <= s.map.w; x++) { ctx.beginPath(); ctx.moveTo(x * T, 0); ctx.lineTo(x * T, s.map.h * T); ctx.stroke(); }
    for (let y = 0; y <= s.map.h; y++) { ctx.beginPath(); ctx.moveTo(0, y * T); ctx.lineTo(s.map.w * T, y * T); ctx.stroke(); }
    const box = (r, col, handle) => {
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(r.x * T, r.y * T, r.w * T, r.h * T); ctx.lineWidth = 1;
      if (handle) { ctx.fillStyle = col; ctx.fillRect((r.x + r.w) * T - 12, (r.y + r.h) * T - 12, 12, 12); }
    };
    for (const div of s.divisions) box(div.zone, VO.render.hoverObj === div ? '#fff' : div.color, true);
    for (const d of s.departments) box(d.room, VO.render.hoverObj === d ? '#fff' : 'rgba(255,209,102,0.9)', true);
    for (const f of s.facilities) box(f, VO.render.hoverObj === f ? '#fff' : 'rgba(129,212,250,0.9)', true);
    if (ui.hoverTile) {
      const { x, y } = ui.hoverTile;
      if (ui.tool && ui.tool.startsWith('furn:')) {
        ctx.globalAlpha = 0.6; drawFurniture(ctx, { type: ui.tool.slice(5), x, y }); ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = ui.tool === 'erase' ? '#ef5350' : '#ffd166';
      ctx.strokeRect(x * T + 1, y * T + 1, T - 2, T - 2);
    }
  }

  /* ------------------------------------------------------------ frame */
  R.draw = function (canvas, s, ui) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const now = performance.now();
    if (R.staticDirty || !staticCanvas) buildStatic(s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#171a21'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const z = R.cam.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, -R.cam.x * z, -R.cam.y * z);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(staticCanvas, 0, 0);
    drawMonitors(ctx, s, now);

    const ents = [s.boss, ...s.agents]
      .map((e) => [e, VO.sim.rt.get(e.id)])
      .filter(([, rt]) => rt)
      .sort((a, b) => a[1].y - b[1].y);
    for (const [e, rt] of ents) drawPerson(ctx, s, e, rt, now);
    for (const [, rt] of ents) drawBubble(ctx, rt, now);
    if (ui.edit) drawEditOverlay(ctx, s, ui);
  };

  R.screenToWorld = (sx, sy) => ({ x: sx / R.cam.zoom + R.cam.x, y: sy / R.cam.zoom + R.cam.y });

  R.hitPerson = function (s, wx, wy) {
    let best = null, bd = 16;
    for (const e of [s.boss, ...s.agents]) {
      const rt = VO.sim.rt.get(e.id);
      if (!rt) continue;
      const d = Math.hypot(rt.x - wx, rt.y - 6 - wy);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };

  R.focus = function (canvas, wx, wy) {
    const vw = canvas.clientWidth / R.cam.zoom, vh = canvas.clientHeight / R.cam.zoom;
    R.cam.x = wx - vw / 2; R.cam.y = wy - vh / 2;
  };

  R.fit = function (canvas, s) {
    const W = s.map.w * T, H = s.map.h * T;
    R.cam.zoom = VO.clamp(Math.min(canvas.clientWidth / W, canvas.clientHeight / H) * 0.98, 0.25, 2.5);
    R.cam.x = (W - canvas.clientWidth / R.cam.zoom) / 2;
    R.cam.y = (H - canvas.clientHeight / R.cam.zoom) / 2;
  };
})();
