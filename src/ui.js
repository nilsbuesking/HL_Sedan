/* Wörth 1870 — interface: map rendering, touch input, cards, overlays, AI playback. */
(function () {
  'use strict';
  const E = window.Engine;
  const SC_ID = 'woerth';
  const SAVE_KEY = 'woerth1870.save.v2', PREF_KEY = 'woerth1870.prefs.v1';
  const sc = E.SCENARIOS[SC_ID];
  const MAP = E.buildMap(sc);
  const S = 30, SQ3 = Math.sqrt(3), MARGIN = 34;
  const WORLD_W = MARGIN * 2 + S * SQ3 * (sc.cols + 0.5);
  const WORLD_H = MARGIN * 2 + S * (1.5 * sc.rows + 0.5);
  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FONT_UI = '"IBM Plex Sans Condensed", "Avenir Next Condensed", "Arial Narrow", sans-serif';
  const FONT_DISPLAY = '"Bodoni Moda", "Didot", "Bodoni 72", Georgia, serif';

  // Map palette: lithographed General Staff sheet
  const C = {
    margin: '#cbc4a6', frame: '#3b3125',
    elev: ['#e3e5cf', '#dcd7bb', '#d1c8a6'],
    woods: 'rgba(110,134,78,0.30)', tree: '#97a676', treeEdge: '#55633f',
    vineWash: 'rgba(160,146,82,0.16)', vine: '#6d6638',
    water: '#d2ddd8', river: '#4e7ea6', riverEdge: '#29506f',
    roadOuter: '#5d4b35', roadInner: '#f2ecd9',
    house: '#a5503d', houseEdge: '#5b2c21',
    hachure: 'rgba(122,88,52,0.75)', contour: 'rgba(122,88,52,0.45)', grid: 'rgba(80,66,40,0.17)',
    label: '#2b2219', halo: 'rgba(238,234,216,0.92)', area: '#46552f', riverLabel: '#2c5677',
    nat: { pr: '#2b3d5b', bv: '#6a92c2', wu: '#2b3d5b', fr: '#a7372b' },
    band: { pr: '#111111', bv: '#f3f0e6', wu: '#111111', fr: '#27408b' },
    bandLine: { pr: '#f3f0e6', bv: '#6a92c2', wu: '#c4372d', fr: '#f3f0e6' },
    ink: { pr: '#f3f0e6', bv: '#13213a', wu: '#f3f0e6', fr: '#f7efe6' },
    sideCol: { de: '#2b3d5b', fr: '#a7372b' },
    brass: '#c9a35a', reach: 'rgba(255,253,240,0.72)', reachEdge: 'rgba(150,108,36,0.95)',
    bg: '#15191e',
  };

  // ------------------------------------------------------------ geometry
  function center(c, r) { return [MARGIN + S * SQ3 * (c + 0.5 * (r & 1)) + S * SQ3 / 2, MARGIN + S + S * 1.5 * r]; }
  function hexPath(ctx, x, y, s) {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 180 * (60 * k - 30);
      const px = x + s * Math.cos(a), py = y + s * Math.sin(a);
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  function corner(x, y, s, k) { const a = Math.PI / 180 * (60 * k - 30); return [x + s * Math.cos(a), y + s * Math.sin(a)]; }
  const DIR_CORNERS = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];
  function worldToHex(wx, wy) {
    const x = wx - (MARGIN + S * SQ3 / 2), y = wy - (MARGIN + S);
    const q = (SQ3 / 3 * x - y / 3) / S, r = (2 / 3 * y) / S, s = -q - r;
    let rx = Math.round(q), rz = Math.round(r);
    const ry = Math.round(s);
    const dx = Math.abs(rx - q), dy = Math.abs(ry - s), dz = Math.abs(rz - r);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (!(dy > dz)) rz = -rx - ry;
    const col = rx + (rz - (rz & 1)) / 2, row = rz;
    if (col < 0 || row < 0 || col >= sc.cols || row >= sc.rows) return null;
    return [col, row];
  }
  function hash(i, k) {
    let h = (i * 374761393 + k * 668265263) ^ 0x5bf03635;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // ------------------------------------------------------------ static map layer (cached bitmap)
  let staticCanvas = null, staticScale = 0;
  function buildStatic() {
    const dpr = window.devicePixelRatio || 1;
    staticScale = Math.min(3, Math.max(2, dpr));
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(WORLD_W * staticScale); cv.height = Math.ceil(WORLD_H * staticScale);
    const g = cv.getContext('2d');
    g.scale(staticScale, staticScale);
    g.lineJoin = 'round'; g.lineCap = 'round';

    // sheet and margin
    g.fillStyle = C.margin; g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.fillStyle = C.elev[0]; g.fillRect(MARGIN - 4, MARGIN - 4, WORLD_W - 2 * MARGIN + 8, WORLD_H - 2 * MARGIN + 8);

    const N = MAP.N, W = sc.cols;
    // base tints
    for (let i = 0; i < N; i++) {
      const c = i % W, r = (i / W) | 0, [x, y] = center(c, r), t = MAP.ter[i];
      hexPath(g, x, y, S + 0.6);
      g.fillStyle = C.elev[MAP.elev[i]]; g.fill();
      if (t === '~' || t === 'f' || t === 'b') { g.fillStyle = C.water; g.fill(); }
      if (t === 'w') { g.fillStyle = C.woods; g.fill(); }
      if (t === 'g') { g.fillStyle = C.vineWash; g.fill(); }
    }
    // relief: contour on the edge, hachures on the higher side pointing downhill
    for (let i = 0; i < N; i++) {
      const c = i % W, r = (i / W) | 0, [x, y] = center(c, r);
      for (const [d, n] of MAP.nbrs[i]) {
        const drop = MAP.elev[i] - MAP.elev[n];
        if (drop <= 0) continue;
        const [k0, k1] = DIR_CORNERS[d];
        const a = corner(x, y, S, k0), b = corner(x, y, S, k1);
        g.strokeStyle = C.contour; g.lineWidth = 0.9;
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        g.strokeStyle = C.hachure; g.lineWidth = 0.9;
        const len = S * (0.16 + 0.07 * drop);
        for (let t = 0.1; t < 0.95; t += 0.1) {
          const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
          let vx = x - px, vy = y - py;
          const vl = Math.hypot(vx, vy); vx /= vl; vy /= vl;
          const l = len * (0.75 + 0.5 * hash(i * 7 + d, Math.round(t * 10)));
          g.beginPath(); g.moveTo(px, py); g.lineTo(px + vx * l, py + vy * l); g.stroke();
        }
      }
    }
    // woods, vineyards, villages
    for (let i = 0; i < N; i++) {
      const c = i % W, r = (i / W) | 0, [x, y] = center(c, r), t = MAP.ter[i];
      if (t === 'w') {
        for (let k = 0; k < 9; k++) {
          const ang = hash(i, k) * Math.PI * 2, rad = Math.sqrt(hash(i, k + 31)) * S * 0.74;
          const px = x + Math.cos(ang) * rad, py = y + Math.sin(ang) * rad * 0.92;
          const tr = S * (0.1 + 0.035 * hash(i, k + 60));
          g.fillStyle = C.tree; g.strokeStyle = C.treeEdge; g.lineWidth = 0.8;
          g.beginPath(); g.arc(px, py, tr, 0, Math.PI * 2); g.fill(); g.stroke();
          g.beginPath(); g.moveTo(px, py + tr); g.lineTo(px, py + tr + 2.2); g.stroke();
        }
      } else if (t === 'g') {
        g.strokeStyle = C.vine; g.lineWidth = 0.9;
        for (let row = -2; row <= 2; row++) for (let col = -2; col <= 2; col++) {
          const px = x + col * S * 0.3 + (row & 1) * S * 0.15, py = y + row * S * 0.28;
          if (Math.hypot(px - x, py - y) > S * 0.72) continue;
          g.beginPath(); g.moveTo(px - 2, py - 2); g.lineTo(px, py + 1.5); g.lineTo(px + 2, py - 2); g.stroke();
        }
      } else if (t === 'v') {
        const n = 6 + Math.floor(hash(i, 3) * 3);
        for (let k = 0; k < n; k++) {
          const ang = (k / n) * Math.PI * 2 + hash(i, k) * 0.6, rad = S * (0.2 + 0.32 * hash(i, k + 9));
          const px = x + Math.cos(ang) * rad, py = y + Math.sin(ang) * rad * 0.85;
          const w = S * (0.17 + 0.1 * hash(i, k + 17)), h = S * (0.12 + 0.07 * hash(i, k + 23));
          g.save(); g.translate(px, py); g.rotate((hash(i, k + 40) - 0.5) * 0.9);
          g.fillStyle = C.house; g.strokeStyle = C.houseEdge; g.lineWidth = 0.8;
          g.fillRect(-w / 2, -h / 2, w, h); g.strokeRect(-w / 2, -h / 2, w, h);
          g.restore();
        }
        // church
        g.strokeStyle = C.frame; g.lineWidth = 1.2; g.fillStyle = C.frame;
        g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(x, y - 2); g.lineTo(x, y - 8); g.moveTo(x - 2.6, y - 5.8); g.lineTo(x + 2.6, y - 5.8); g.stroke();
      }
    }
    // river
    const pts = sc.river.map(([c, r]) => center(c, r));
    const riverStroke = (w, col) => {
      g.strokeStyle = col; g.lineWidth = w;
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1] - S);
      for (let k = 0; k < pts.length - 1; k++) {
        const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2;
        g.quadraticCurveTo(pts[k][0], pts[k][1], mx, my);
      }
      const last = pts[pts.length - 1];
      g.quadraticCurveTo(last[0], last[1], last[0], last[1] + S);
      g.stroke();
    };
    riverStroke(S * 0.36 + 2, C.riverEdge);
    riverStroke(S * 0.36, C.river);
    // roads (double line)
    const roadStroke = (w, col) => {
      g.strokeStyle = col; g.lineWidth = w;
      for (const road of sc.roads) {
        g.beginPath();
        road.forEach(([c, r], k) => { const [x, y] = center(c, r); k ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.stroke();
      }
    };
    roadStroke(3.6, C.roadOuter);
    roadStroke(1.8, C.roadInner);
    // map-edge road exits
    g.fillStyle = C.label; g.font = 'italic 500 8.5px ' + FONT_DISPLAY; g.textAlign = 'center';
    const exits = [[[0, 6], 'W', 'Niederbronn ←'], [[15, 6], 'E', '→ Sulz'], [[7, 0], 'N', '↑ Lembach'], [[7, 17], 'S', '↓ Haguenau'], [[15, 12], 'E', '→ Surbourg']];
    for (const [[c, r], d, txt] of exits) {
      const [x, y] = center(c, r);
      g.save();
      if (d === 'W') { g.translate(MARGIN - 9, y); g.rotate(-Math.PI / 2); g.fillText(txt, 0, 0); }
      else if (d === 'E') { g.translate(WORLD_W - MARGIN + 13, y); g.rotate(Math.PI / 2); g.fillText(txt, 0, 0); }
      else if (d === 'N') { g.fillText(txt, x, MARGIN - 8); }
      else g.fillText(txt, x, WORLD_H - MARGIN + 15);
      g.restore();
    }
    // bridges and ford
    for (let i = 0; i < N; i++) {
      const t = MAP.ter[i];
      if (t !== 'b' && t !== 'f') continue;
      const [x, y] = center(i % W, (i / W) | 0);
      g.strokeStyle = C.frame; g.lineWidth = 1.3;
      if (t === 'b') {
        for (const s of [-1, 1]) {
          g.beginPath(); g.moveTo(x - S * 0.42, y + s * 4.2 - s * 1.5); g.lineTo(x - S * 0.32, y + s * 4.2);
          g.lineTo(x + S * 0.32, y + s * 4.2); g.lineTo(x + S * 0.42, y + s * 4.2 - s * 1.5); g.stroke();
        }
      } else {
        g.setLineDash([2.2, 2.4]); g.strokeStyle = C.roadOuter; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(x - S * 0.75, y); g.lineTo(x + S * 0.75, y); g.stroke(); g.setLineDash([]);
        g.fillStyle = C.riverLabel; g.font = 'italic 600 7.5px ' + FONT_DISPLAY; g.textAlign = 'center';
        g.fillText('Furt', x, y - 6);
      }
    }
    // hex grid
    g.strokeStyle = C.grid; g.lineWidth = 0.6;
    for (let i = 0; i < N; i++) { const [x, y] = center(i % W, (i / W) | 0); hexPath(g, x, y, S); g.stroke(); }

    // area and river labels
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const a of sc.areaLabels) {
      const x = MARGIN + S * SQ3 * (a.c + 0.5) , y = MARGIN + S + S * 1.5 * a.r;
      g.save(); g.translate(x, y);
      if (a.river) { g.rotate(Math.PI / 2); g.fillStyle = C.riverLabel; g.font = 'italic 600 12px ' + FONT_DISPLAY; }
      else { g.fillStyle = C.area; g.font = 'italic 600 13px ' + FONT_DISPLAY; }
      const txt = a.name.split('').join(String.fromCharCode(8202));
      g.strokeStyle = C.halo; g.lineWidth = 3; g.strokeText(txt, 0, 0); g.fillText(txt, 0, 0);
      g.restore();
    }
    // place names
    for (const p of sc.places) {
      const [x, y] = center(p.c, p.r);
      const big = sc.objectives.some(o => o.c === p.c && o.r === p.r && o.vp >= 2);
      g.font = (big ? '600 9.6px ' : '600 8.6px ') + FONT_UI;
      const txt = p.name.toUpperCase().split('').join(String.fromCharCode(8202));
      let ty = y + S * 0.74;
      let tx = x;
      if (p.c === 0) { g.textAlign = 'left'; tx = x - S * 0.7; }
      else if (p.c === sc.cols - 1) { g.textAlign = 'right'; tx = x + S * 0.7; }
      else g.textAlign = 'center';
      g.strokeStyle = C.halo; g.lineWidth = 3; g.strokeText(txt, tx, ty);
      g.fillStyle = C.label; g.fillText(txt, tx, ty);
    }
    // neat-line frame with graduation bars
    const x0 = MARGIN - 8, y0 = MARGIN - 8, x1 = WORLD_W - MARGIN + 8, y1 = WORLD_H - MARGIN + 8;
    g.strokeStyle = C.frame; g.lineWidth = 1.4; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    g.lineWidth = 0.6; g.strokeRect(x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8);
    g.fillStyle = C.frame;
    const step = S * SQ3 / 2;
    for (let x = x0, k = 0; x < x1; x += step, k++) if (k % 2 === 0) { g.fillRect(x, y0 - 4, Math.min(step, x1 - x), 4); g.fillRect(x, y1, Math.min(step, x1 - x), 4); }
    for (let y = y0, k = 0; y < y1; y += S * 1.5, k++) if (k % 2 === 0) { g.fillRect(x0 - 4, y, 4, Math.min(S * 1.5, y1 - y)); g.fillRect(x1, y, 4, Math.min(S * 1.5, y1 - y)); }
    // title, north arrow, scale bar in the margin
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillStyle = C.frame; g.font = 'italic 600 11px ' + FONT_DISPLAY;
    g.fillText('Schlachtfeld von Wörth · 6. August 1870', x0, y0 - 9);
    g.textAlign = 'right'; g.font = '500 8px ' + FONT_UI;
    g.fillText('ONE HEX ≈ 600 M', x1, y0 - 9);
    // scale bar
    const km = (1000 / sc.hexMetres) * S * SQ3;
    const sx = x0, sy = y1 + 13;
    for (let k = 0; k < 4; k++) {
      g.fillStyle = k % 2 ? C.margin : C.frame;
      g.fillRect(sx + k * km / 2, sy, km / 2, 3.5);
    }
    g.strokeStyle = C.frame; g.lineWidth = 0.7; g.strokeRect(sx, sy, km * 2, 3.5);
    g.fillStyle = C.frame; g.font = '500 7.5px ' + FONT_UI; g.textAlign = 'center';
    g.fillText('0', sx, sy + 12); g.fillText('1 km', sx + km, sy + 12); g.fillText('2 km', sx + km * 2, sy + 12);
    // north arrow
    const nx = x1 - 10, ny = y1 + 16;
    g.beginPath(); g.moveTo(nx, ny - 9); g.lineTo(nx + 4, ny + 2); g.lineTo(nx, ny - 1); g.lineTo(nx - 4, ny + 2); g.closePath(); g.fill();
    g.font = '600 8px ' + FONT_UI; g.fillText('N', nx - 12, ny + 1);
    staticCanvas = cv;
  }

  // ------------------------------------------------------------ DOM refs and state
  const $ = id => document.getElementById(id);
  const canvas = $('map'), ctx = canvas.getContext('2d');
  const cardEl = $('card'), actionsEl = $('actions'), overlayEl = $('overlay'), toastEl = $('toast');
  const G = {
    state: null, sel: null, reach: null, targets: [], pending: null, inspect: null,
    busy: false, ai: false, fastThisTurn: false, confirmEnd: false, trails: [], effects: [], moving: null, ghosts: [],
    prefs: { fast: false },
  };
  const cam = { x: 0, y: 0, z: 1 };
  let viewW = 0, viewH = 0, dpr = 1;

  function loadPrefs() { try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); if (p && typeof p === 'object') Object.assign(G.prefs, p); } catch (e) { /* storage unavailable */ } }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(G.prefs)); } catch (e) { /* ignore */ } }
  function save() { if (!G.state) return; try { localStorage.setItem(SAVE_KEY, E.serialize(G.state)); } catch (e) { /* ignore */ } }
  function loadSave() { try { const j = localStorage.getItem(SAVE_KEY); return j ? E.deserialize(j) : null; } catch (e) { return null; } }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }

  const unitById = id => G.state && G.state.units.find(u => u.id === id);
  const selUnit = () => (G.sel ? unitById(G.sel) : null);
  const humanTurn = () => G.state && !G.state.over && G.state.players[G.state.side] === 'human';
  const bothHuman = () => G.state && G.state.players.de === 'human' && G.state.players.fr === 'human';
  const speed = () => (REDUCED ? 0.25 : (G.prefs.fast || G.fastThisTurn) ? 0.4 : 1);
  const sleep = ms => new Promise(res => setTimeout(res, ms));

  // ------------------------------------------------------------ camera
  function zLimits() {
    const fit = Math.min(viewW / WORLD_W, viewH / WORLD_H);
    return [Math.min(fit, 1), 2.4];
  }
  function clampCam() {
    const [zmin, zmax] = zLimits();
    cam.z = Math.min(zmax, Math.max(zmin, cam.z));
    const vw = viewW / cam.z, vh = viewH / cam.z;
    if (vw >= WORLD_W) cam.x = (WORLD_W - vw) / 2; else cam.x = Math.min(Math.max(cam.x, -12), WORLD_W - vw + 12);
    if (vh >= WORLD_H) cam.y = (WORLD_H - vh) / 2; else cam.y = Math.min(Math.max(cam.y, -12), WORLD_H - vh + 12);
  }
  function defaultZoom() {
    const z = Math.min(viewW / (S * SQ3 * 8.5), viewH / (S * 1.5 * 8));
    return Math.max(zLimits()[0], Math.min(1.35, z));
  }
  function centerOn(wx, wy, z) {
    if (z) cam.z = z;
    cam.x = wx - viewW / cam.z / 2; cam.y = wy - viewH / cam.z / 2;
    clampCam(); requestDraw();
  }
  let camAnim = null;
  function panTo(wx, wy, ms, z) {
    const from = { x: cam.x, y: cam.y, z: cam.z };
    const tz = z || cam.z;
    const tx = wx - viewW / tz / 2, ty = wy - viewH / tz / 2;
    const to = { x: tx, y: ty, z: tz };
    const save = { ...cam }; Object.assign(cam, to); clampCam(); Object.assign(to, { x: cam.x, y: cam.y, z: cam.z }); Object.assign(cam, save);
    if (!ms || REDUCED) { Object.assign(cam, to); requestDraw(); return Promise.resolve(); }
    return new Promise(res => {
      const t0 = performance.now();
      camAnim = () => {
        const k = Math.min(1, (performance.now() - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        cam.x = from.x + (to.x - from.x) * e; cam.y = from.y + (to.y - from.y) * e; cam.z = from.z + (to.z - from.z) * e;
        if (k >= 1) { camAnim = null; res(); }
      };
      requestDraw();
    });
  }
  function inView(wx, wy, frac) {
    const sx = (wx - cam.x) * cam.z, sy = (wy - cam.y) * cam.z;
    const mx = viewW * (1 - frac) / 2, my = viewH * (1 - frac) / 2;
    return sx > mx && sx < viewW - mx && sy > my && sy < viewH - my;
  }
  async function follow(c, r) {
    const [x, y] = center(c, r);
    if (!inView(x, y, 0.7)) await panTo(x, y, 260 * speed());
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const first = viewW === 0;
    viewW = Math.max(1, rect.width); viewH = Math.max(1, rect.height);
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(viewW * dpr); canvas.height = Math.round(viewH * dpr);
    if (first) { cam.z = defaultZoom(); centerOn(WORLD_W * 0.5, WORLD_H * 0.42); }
    clampCam(); requestDraw();
  }

  // ------------------------------------------------------------ drawing
  let drawQueued = false;
  function requestDraw() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(frame); } }
  function frame(now) {
    drawQueued = false;
    if (camAnim) camAnim();
    draw(now);
    if (camAnim || G.moving || G.effects.length || G.ghosts.length) requestDraw();
  }

  function draw(now) {
    now = now || performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, viewW, viewH);
    if (!staticCanvas) return;
    ctx.save();
    ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(staticCanvas, 0, 0, WORLD_W, WORLD_H);
    if (!G.state) { ctx.restore(); return; }
    drawObjectives();
    drawTrails();
    drawHighlights(now);
    drawUnits();
    drawEffects(now);
    ctx.restore();
  }

  function drawObjectives() { // every holdable place gets a flag; victory objectives also a VP medallion
    const st = G.state;
    sc.objectives.forEach((o, k) => {
      const [x, y] = center(o.c, o.r);
      const owner = st.control[k], big = o.vp > 0, f = big ? 1 : 0.7;
      const px = x + S * 0.5, py = y - S * 0.5;
      ctx.strokeStyle = C.frame; ctx.lineWidth = big ? 1.3 : 1.1;
      ctx.beginPath(); ctx.moveTo(px, py + (big ? 9 : 4)); ctx.lineTo(px, py - 11 * f); ctx.stroke();
      ctx.fillStyle = C.sideCol[owner];
      ctx.beginPath(); ctx.moveTo(px, py - 11 * f); ctx.lineTo(px + 14 * f, py - 7.5 * f); ctx.lineTo(px, py - 4 * f); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.6; ctx.stroke();
      if (!big) return;
      ctx.fillStyle = '#f2ecd9'; ctx.strokeStyle = C.frame; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(px, py + 11, 5.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.frame; ctx.font = '700 8px ' + FONT_UI; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(o.vp), px, py + 11.4);
    });
  }

  function drawTrails() {
    for (const t of G.trails) {
      if (t.pts.length < 2) continue;
      ctx.strokeStyle = C.sideCol[t.side]; ctx.globalAlpha = 0.55; ctx.lineWidth = 2.2; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      t.pts.forEach(([c, r], k) => { const [x, y] = center(c, r); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke(); ctx.setLineDash([]);
      const [ax, ay] = center(...t.pts[t.pts.length - 2]), [bx, by] = center(...t.pts[t.pts.length - 1]);
      const ang = Math.atan2(by - ay, bx - ax), hx = bx - Math.cos(ang) * S * 0.62, hy = by - Math.sin(ang) * S * 0.62;
      ctx.fillStyle = C.sideCol[t.side];
      ctx.beginPath(); ctx.moveTo(hx, hy);
      ctx.lineTo(hx - Math.cos(ang - 0.5) * 8, hy - Math.sin(ang - 0.5) * 8);
      ctx.lineTo(hx - Math.cos(ang + 0.5) * 8, hy - Math.sin(ang + 0.5) * 8); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawHighlights(now) {
    const st = G.state, W = sc.cols;
    const u = selUnit();
    if (G.reach && u) {
      const ui = E.idxOf(st, u);
      for (const [k, v] of G.reach) {
        if (k === ui || !v.end) continue;
        const [x, y] = center(k % W, (k / W) | 0);
        hexPath(ctx, x, y, S - 2.2);
        ctx.fillStyle = C.reach; ctx.fill();
        ctx.strokeStyle = C.reachEdge; ctx.lineWidth = 1.5; ctx.stroke();
        if (v.stop) { ctx.fillStyle = C.reachEdge; ctx.beginPath(); ctx.arc(x, y + S * 0.55, 1.8, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    for (const t of G.targets) {
      const [x, y] = center(t.c, t.r);
      const pend = G.pending === t.id;
      const pulse = pend ? 1 + 0.06 * Math.sin(now / 160) : 1;
      const rr = S * 0.86 * pulse;
      ctx.lineWidth = pend ? 4 : 3; ctx.strokeStyle = '#1a1a1a';
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = pend ? 2.4 : 1.8; ctx.strokeStyle = pend ? C.brass : '#fffdf5';
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (rr - 5), y + Math.sin(a) * (rr - 5)); ctx.lineTo(x + Math.cos(a) * (rr + 5), y + Math.sin(a) * (rr + 5)); ctx.stroke();
      }
    }
    if (G.pending) requestDraw();
    if (u && E.isCmd(u)) { // command radius: the six hexes whose units fire better
      for (let d = 0; d < 6; d++) {
        const [nc, nr] = E.neighbour(u.c, u.r, d);
        if (nc < 0 || nr < 0 || nc >= sc.cols || nr >= sc.rows) continue;
        const [x, y] = center(nc, nr);
        hexPath(ctx, x, y, S - 3);
        ctx.setLineDash([3, 3]); ctx.strokeStyle = C.brass; ctx.lineWidth = 1.8; ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (u) {
      const [x, y] = center(u.c, u.r);
      hexPath(ctx, x, y, S - 0.5);
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = C.brass; ctx.lineWidth = 3; ctx.stroke();
    }
    if (G.inspect) {
      const [x, y] = center(G.inspect[0], G.inspect[1]);
      hexPath(ctx, x, y, S - 1);
      ctx.setLineDash([4, 3]); ctx.strokeStyle = C.frame; ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]);
    }
  }

  function unitDrawPos(u) {
    if (G.moving && G.moving.id === u.id) return G.moving.pos;
    return center(u.c, u.r);
  }

  function drawCounter(u, x, y, alpha) {
    const T = E.UNIT_TYPES[u.type];
    const w = S * 1.22, h = S * 0.94, rx = x - w / 2, ry = y - h / 2;
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    // shadow
    ctx.fillStyle = 'rgba(30,22,10,0.35)';
    roundRect(rx + 1.6, ry + 2, w, h, 3.5); ctx.fill();
    ctx.fillStyle = C.nat[u.nat];
    roundRect(rx, ry, w, h, 3.5); ctx.fill();
    // national band
    ctx.save(); roundRect(rx, ry, w, h, 3.5); ctx.clip();
    ctx.fillStyle = C.band[u.nat]; ctx.fillRect(rx, ry, w, h * 0.17);
    ctx.fillStyle = C.bandLine[u.nat]; ctx.fillRect(rx, ry + h * 0.17, w, 1.1);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 0.9; roundRect(rx, ry, w, h, 3.5); ctx.stroke();
    if (T.cmd) { ctx.strokeStyle = C.brass; ctx.lineWidth = 1.8; roundRect(rx + 1, ry + 1, w - 2, h - 2, 3); ctx.stroke(); }
    // NATO-style symbol
    const ink = C.ink[u.nat];
    const bw = w * 0.44, bh = h * 0.42, bx = rx + w * 0.1, by = ry + h * 0.3;
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 1.2;
    if (T.cmd) { // commander's pennant on a staff
      ctx.beginPath(); ctx.moveTo(bx + 2, by + bh + 2); ctx.lineTo(bx + 2, by - 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + 2, by - 2); ctx.lineTo(bx + bw, by - 2); ctx.lineTo(bx + bw - 4, by + bh * 0.3); ctx.lineTo(bx + bw, by + bh * 0.62); ctx.lineTo(bx + 2, by + bh * 0.62); ctx.closePath(); ctx.fill();
    } else ctx.strokeRect(bx, by, bw, bh);
    ctx.beginPath();
    if (T.sym === 'inf' || T.sym === 'jaeger') { ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by + bh); ctx.moveTo(bx + bw, by); ctx.lineTo(bx, by + bh); }
    if (T.sym === 'cav') { ctx.moveTo(bx, by + bh); ctx.lineTo(bx + bw, by); }
    ctx.stroke();
    if (T.sym === 'jaeger') { ctx.beginPath(); ctx.arc(bx + bw / 2, by - 0.5, 3, Math.PI, 0); ctx.stroke(); }
    if (T.sym === 'art') { ctx.beginPath(); ctx.arc(bx + bw / 2, by + bh / 2, 2.6, 0, Math.PI * 2); ctx.fill(); }
    if (T.sym === 'mg') {
      ctx.beginPath(); ctx.arc(bx + bw / 2, by + bh / 2, 2.1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx + bw * 0.2, by + bh * 0.25); ctx.lineTo(bx + bw * 0.2, by + bh * 0.75); ctx.moveTo(bx + bw * 0.8, by + bh * 0.25); ctx.lineTo(bx + bw * 0.8, by + bh * 0.75); ctx.stroke();
    }
    // strength
    ctx.fillStyle = u.str <= 3 ? (u.nat === 'bv' ? '#7a1408' : '#ffcf7a') : ink;
    ctx.font = '700 14px ' + FONT_UI; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(u.str), rx + w * 0.78, ry + h * 0.53);
    if (cam.z >= 0.85) {
      ctx.font = '600 6.6px ' + FONT_UI; ctx.fillStyle = ink; ctx.textAlign = 'left';
      ctx.fillText(u.short, bx, ry + h * 0.86);
    }
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawUnits() {
    const st = G.state;
    const human = humanTurn();
    for (const u of st.units) {
      if (!u.on || u.dead) continue;
      const [x, y] = unitDrawPos(u);
      let alpha = 1;
      if (human && u.side === st.side && !E.canMove(u) && !E.canFire(u)) alpha = 0.55;
      drawCounter(u, x, y, alpha);
      if (human && u.side === st.side && alpha === 1 && !u.moved) {
        ctx.fillStyle = C.brass; ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(x + S * 0.5, y - S * 0.36, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    for (const gh of G.ghosts) {
      const u = gh.u, [x, y] = center(u.c, u.r);
      drawCounter(u, x, y, Math.min(1, Math.max(0, 1 - (performance.now() - gh.t0) / gh.dur)));
    }
    G.ghosts = G.ghosts.filter(gh => performance.now() - gh.t0 < gh.dur);
  }

  function drawEffects(now) {
    G.effects = G.effects.filter(f => now - f.t0 < f.dur);
    for (const f of G.effects) {
      if (now < f.t0) continue;
      const k = (now - f.t0) / f.dur;
      if (f.kind === 'flash') {
        const r = S * (0.25 + 0.5 * k);
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        g.addColorStop(0, `rgba(255,236,170,${0.95 * (1 - k)})`); g.addColorStop(1, 'rgba(255,170,60,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
      } else if (f.kind === 'smoke') {
        for (let n = 0; n < 5; n++) {
          const a = f.seed + n * 1.3, d = S * (0.15 + 0.5 * k) * (0.6 + 0.4 * ((n * 37) % 7) / 7);
          ctx.fillStyle = `rgba(235,232,222,${0.55 * (1 - k)})`;
          ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d - k * 8, S * (0.12 + 0.22 * k), 0, Math.PI * 2); ctx.fill();
        }
      } else if (f.kind === 'float') {
        ctx.font = '700 15px ' + FONT_UI; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const y = f.y - k * 22;
        ctx.globalAlpha = k < 0.75 ? 1 : (1 - k) / 0.25;
        ctx.lineWidth = 3.5; ctx.strokeStyle = '#f4efe0'; ctx.strokeText(f.text, f.x, y);
        ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, y);
        ctx.globalAlpha = 1;
      } else if (f.kind === 'hit') {
        hexPath(ctx, f.x, f.y, S - 1);
        ctx.fillStyle = `rgba(214,70,40,${0.35 * (1 - k)})`; ctx.fill();
      }
    }
  }

  // ------------------------------------------------------------ animations
  function animMove(u, path) {
    if (path.length < 2) return Promise.resolve();
    const per = 115 * speed();
    const pts = path.map(([c, r]) => center(c, r));
    return new Promise(res => {
      const t0 = performance.now(), dur = per * (pts.length - 1);
      G.moving = { id: u.id, pos: pts[0], tick: null };
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / dur);
        const f = k * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), t = f - i;
        G.moving.pos = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
        requestDraw();
        if (k < 1) requestAnimationFrame(step); else { G.moving = null; requestDraw(); res(); }
      };
      requestAnimationFrame(step);
    });
  }

  async function animAttack(ev) {
    const sp = speed();
    const [ax, ay] = center(ev.from[0], ev.from[1]), [tx, ty] = center(ev.to[0], ev.to[1]);
    const now = performance.now();
    G.effects.push({ kind: 'flash', x: ax, y: ay, t0: now, dur: 260 * sp });
    G.effects.push({ kind: 'smoke', x: ax, y: ay, t0: now, dur: 900 * sp, seed: Math.random() * 6 });
    requestDraw();
    await sleep(180 * sp);
    const t2 = performance.now();
    G.effects.push({ kind: 'hit', x: tx, y: ty, t0: t2, dur: 420 * sp });
    G.effects.push({ kind: 'float', x: tx, y: ty - S * 0.3, t0: t2, dur: 1000 * Math.max(sp, 0.6), text: ev.dmg ? '−' + ev.dmg : 'miss', color: '#9b1d10' });
    if (ev.countered) {
      G.effects.push({ kind: 'flash', x: tx, y: ty, t0: t2 + 120 * sp, dur: 220 * sp });
      G.effects.push({ kind: 'float', x: ax, y: ay - S * 0.3, t0: t2 + 160 * sp, dur: 1000 * Math.max(sp, 0.6), text: ev.back ? '−' + ev.back : '0', color: '#9b1d10' });
    }
    if (ev.killed) { const t = unitById(ev.targetId); if (t) G.ghosts.push({ u: t, t0: t2 + 200 * sp, dur: 700 * sp }); }
    if (ev.lost) { const a = unitById(ev.attackerId); if (a) G.ghosts.push({ u: a, t0: t2 + 300 * sp, dur: 700 * sp }); }
    requestDraw();
    await sleep(520 * sp);
  }

  // ------------------------------------------------------------ selection and actions
  function refreshSel() {
    const st = G.state, u = selUnit();
    G.reach = null; G.targets = [];
    if (!u || u.dead || !u.on) { G.sel = null; return; }
    if (humanTurn() && u.side === st.side) {
      if (E.canMove(u)) G.reach = E.reachable(st, u);
      if (E.canFire(u)) G.targets = E.targetsFrom(st, u, E.idxOf(st, u));
    }
    if (G.pending && !G.targets.some(t => t.id === G.pending)) G.pending = null;
  }

  function select(id) {
    G.sel = id; G.inspect = null; G.pending = null; G.trails = []; G.confirmEnd = false;
    refreshSel(); renderCard(); requestDraw();
  }

  function onTap(sx, sy) {
    const wx = sx / cam.z + cam.x, wy = sy / cam.z + cam.y;
    const h = worldToHex(wx, wy);
    if (!h || !G.state || G.busy) return;
    const st = G.state;
    const u = E.unitAt(st, h[0], h[1]);
    const sel = selUnit();
    G.confirmEnd = false;
    if (humanTurn() && sel && sel.side === st.side) {
      if (u && u.side !== st.side && G.targets.includes(u)) {
        if (G.pending === u.id) { doAttack(sel, u); return; }
        G.pending = u.id; G.trails = []; renderCard(); requestDraw(); return;
      }
      const idx = h[1] * sc.cols + h[0];
      if (!u && G.reach && G.reach.has(idx) && G.reach.get(idx).end && idx !== E.idxOf(st, sel)) { doMove(sel, h); return; }
    }
    if (u) { if (G.sel === u.id && !G.pending) { G.sel = null; G.inspect = null; refreshSel(); renderCard(); requestDraw(); return; } select(u.id); return; }
    G.sel = null; G.pending = null; G.inspect = h; G.trails = [];
    refreshSel(); renderCard(); requestDraw();
  }

  async function doMove(u, h) {
    const before = G.state.control.slice();
    const res = E.moveUnit(G.state, u, h[0], h[1]);
    if (!res) return;
    G.busy = true; G.pending = null; G.reach = null; G.targets = []; renderCard();
    await animMove(u, res.path);
    G.busy = false;
    announceCaptures(before);
    save(); refreshSel(); renderCard(); requestDraw();
    if (res.stop && !G.targets.length) toast('Halted by enemy contact.');
  }

  async function doAttack(u, t) {
    const res = E.attack(G.state, u, t);
    if (!res) return;
    G.busy = true; G.pending = null; G.reach = null; G.targets = []; renderCard();
    await animAttack(res);
    G.busy = false;
    if (res.cmdFell) toast(t.name + ' has fallen. The ' + sc.sides[res.cmdFell].short + ' fire ×' + E.CMD_LOST + ' for the rest of the day.', 4200);
    else if (res.killed) toast(E.unitLabel(t) + ' is broken.');
    else if (res.lost) toast(E.unitLabel(u) + ' is broken.');
    save(); refreshSel(); renderCard(); requestDraw(); updateBar();
    if (G.state.over) showResult();
  }

  function floatAt(c, r, text, color) {
    const [x, y] = center(c, r), now = performance.now();
    G.effects.push({ kind: 'float', x, y: y - S * 0.3, t0: now, dur: 1100 * Math.max(speed(), 0.6), text, color });
    requestDraw();
  }

  function doRefit(u) {
    if (!humanTurn() || G.busy) return;
    const r = E.refit(G.state, u);
    if (!r) return;
    floatAt(u.c, u.r, '+' + r.gain, '#2f6b2a');
    toast(E.unitLabel(u) + ' refits: +' + r.gain + ' strength.');
    save(); refreshSel(); renderCard(); requestDraw(); updateBar();
  }

  function doCallup(c, r) {
    if (!humanTurn() || G.busy) return;
    const res = E.callup(G.state, r * sc.cols + c);
    if (!res) return;
    const u = unitById(res.unitId);
    G.effects.push({ kind: 'flash', x: center(c, r)[0], y: center(c, r)[1], t0: performance.now(), dur: 400 });
    floatAt(c, r, 'Formed', '#2f6b2a');
    toast(u.name + ' is formed. It can move from next turn.');
    save(); updateBar(); select(u.id);
  }

  function announceCaptures(before) {
    sc.objectives.forEach((o, k) => {
      if (before[k] === G.state.control[k]) return;
      const who = sc.sides[G.state.control[k]].short;
      toast(o.name + ' taken by the ' + who + (o.vp ? ' (' + o.vp + ' VP).' : ' (+' + o.inc + ' reserves a turn).'));
    });
  }

  function readyUnits() {
    const st = G.state;
    return E.live(st, st.side).filter(u => E.canMove(u) || (E.canFire(u) && E.targetsFrom(st, u, E.idxOf(st, u)).length))
      .filter(u => !(u.moved && !E.canFire(u) && u.mp < 0.75));
  }
  function freshUnits() { return E.live(G.state, G.state.side).filter(u => !u.moved && !u.fired); }

  function nextUnit() {
    const list = readyUnits().sort((a, b) => a.r - b.r || a.c - b.c);
    if (!list.length) { toast('No units left to act. End the turn when ready.'); return; }
    const i = list.findIndex(u => u.id === G.sel);
    const u = list[(i + 1) % list.length];
    select(u.id);
    const [x, y] = center(u.c, u.r);
    if (!inView(x, y, 0.6)) panTo(x, y, 280);
  }

  function undo() {
    if (E.undoMove(G.state)) { save(); refreshSel(); renderCard(); requestDraw(); toast('Move taken back.'); }
  }

  function endTurn() {
    if (!humanTurn() || G.busy) return;
    const left = freshUnits().length;
    if (left && !G.confirmEnd) {
      G.confirmEnd = true; renderCard();
      clearTimeout(endTurn.t); endTurn.t = setTimeout(() => { G.confirmEnd = false; renderCard(); }, 4000);
      return;
    }
    G.confirmEnd = false; G.sel = null; G.pending = null; G.inspect = null; G.reach = null; G.targets = [];
    E.endSideTurn(G.state);
    save();
    afterTurnChange();
  }

  function afterTurnChange() {
    G.fastThisTurn = false;
    updateBar(); refreshSel(); renderCard(); requestDraw();
    const st = G.state;
    if (st.over) { showResult(); return; }
    if (st.players[st.side] === 'ai') { runAI(); return; }
    if (bothHuman()) showHandover(); else announceTurn();
  }

  function announceTurn() {
    const st = G.state;
    const arr = (st.arrivals || []).map(id => unitById(id)).filter(Boolean);
    let msg = 'Turn ' + st.turn + ' · ' + E.clock(st) + '. ' + sc.sides[st.side].short + ' to move.';
    if (st.income[st.side]) msg += ' Reserves +' + st.income[st.side] + ', now ' + st.res[st.side] + '.';
    const cmdArr = arr.find(u => E.isCmd(u));
    if (cmdArr) msg += ' ' + cmdArr.name + ' has reached the field.';
    else if (arr.length) msg += ' Arriving: ' + arr.map(u => u.short).join(', ') + '.';
    toast(msg, 3200);
    const mine = E.live(st, st.side);
    if (arr.length) { const [x, y] = center(arr[0].c, arr[0].r); panTo(x, y, 400); }
    else if (mine.length && G.trails.length === 0) {
      let sx = 0, sy = 0; mine.forEach(u => { const p = center(u.c, u.r); sx += p[0]; sy += p[1]; });
      const cx = sx / mine.length, cy = sy / mine.length;
      if (!inView(cx, cy, 0.5)) panTo(cx, cy, 400);
    }
  }

  async function runAI() {
    const st = G.state, side = st.side;
    G.busy = true; G.ai = true; G.trails = [];
    updateBar(); renderCard(); requestDraw();
    await sleep(350 * speed());
    let guard = 0;
    while (!st.over && st.side === side && guard++ < 240) {
      const act = E.aiNextAction(st);
      if (!act) break;
      if (act.kind !== 'hold') await follow(act.kind === 'callup' ? act.toCR[0] : unitById(act.unitId).c, act.kind === 'callup' ? act.toCR[1] : unitById(act.unitId).r);
      const before = st.control.slice();
      const evs = E.aiApply(st, act);
      for (const ev of evs) {
        if (ev.kind === 'move') {
          G.trails.push({ side, pts: ev.path });
          await animMove(unitById(ev.unitId), ev.path);
        } else if (ev.kind === 'attack') {
          await follow(ev.to[0], ev.to[1]);
          await animAttack(ev);
          if (ev.cmdFell) toast(unitById(ev.targetId).name + ' has fallen. The ' + sc.sides[ev.cmdFell].short + ' fire ×' + E.CMD_LOST + ' for the rest of the day.', 4200);
        } else if (ev.kind === 'refit') {
          floatAt(ev.at[0], ev.at[1], '+' + ev.gain, '#2f6b2a');
          await sleep(450 * speed());
        } else if (ev.kind === 'callup') {
          const [x, y] = center(ev.at[0], ev.at[1]);
          G.effects.push({ kind: 'flash', x, y, t0: performance.now(), dur: 400 * speed() });
          floatAt(ev.at[0], ev.at[1], 'Formed', '#2f6b2a');
          await sleep(550 * speed());
        }
      }
      announceCaptures(before);
      renderCard(); updateBar();
      await sleep(70 * speed());
    }
    if (!st.over && st.side === side) E.endSideTurn(st);
    save();
    G.busy = false; G.ai = false;
    afterTurnChange();
  }

  // ------------------------------------------------------------ cards
  function esc(s) { return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
  function counterSVG(u) {
    const T = E.UNIT_TYPES[u.type];
    const fill = { pr: 'var(--prussian)', bv: 'var(--bavaria)', wu: 'var(--prussian)', fr: 'var(--garance)' }[u.nat];
    const band = { pr: 'var(--flag-black)', bv: 'var(--flag-white)', wu: 'var(--flag-black)', fr: 'var(--tricolour-blue)' }[u.nat];
    const ink = u.nat === 'bv' ? 'var(--ink)' : 'var(--flag-white)';
    let sym = '<rect x="5" y="12" width="16" height="12"/>';
    if (T.sym === 'inf' || T.sym === 'jaeger') sym += '<path d="M5 12 L21 24 M21 12 L5 24"/>';
    if (T.sym === 'cav') sym += '<path d="M5 24 L21 12"/>';
    if (T.sym === 'jaeger') sym += '<path d="M10 11 A3 3 0 0 1 16 11"/>';
    if (T.sym === 'art') sym += '<circle cx="13" cy="18" r="2.6" style="fill:' + ink + '"/>';
    if (T.sym === 'mg') sym += '<circle cx="13" cy="18" r="2.2" style="fill:' + ink + '"/><path d="M8 15v6M18 15v6"/>';
    if (T.sym === 'cmd') sym = '<path d="M7 27V10"/><path d="M7 10h14l-4 4 4 4H7z" style="fill:' + ink + '"/>';
    return '<svg class="mini" viewBox="0 0 46 36" aria-hidden="true"><rect x="1" y="1" width="44" height="34" rx="4" style="fill:' + fill + ';stroke:' + (T.cmd ? 'var(--brass);stroke-width:2' : 'rgba(0,0,0,.5)') + '"/>' +
      '<path d="M5 1h36a4 4 0 0 1 4 4v1.5H1V5a4 4 0 0 1 4-4z" style="fill:' + band + '"/>' +
      '<g style="stroke:' + ink + ';fill:none;stroke-width:1.4">' + sym + '</g>' +
      '<text x="35" y="23" text-anchor="middle" style="fill:' + ink + ';font:700 13px var(--f-ui)">' + u.str + '</text></svg>';
  }
  function meter(u) {
    let h = '<div class="meter' + (u.str <= 3 ? ' low' : '') + '" role="img" aria-label="Strength ' + u.str + ' of ' + u.max + '">';
    for (let k = 0; k < u.max; k++) h += '<i class="' + (k < u.str ? 'on' : '') + '"></i>';
    return h + '</div>';
  }
  function terrainLine(c, r) {
    const i = r * sc.cols + c, t = E.TERRAIN[MAP.ter[i]];
    let s = '<b>' + t.name + '</b> · ' + E.ELEV_NAMES[MAP.elev[i]];
    if (t.def !== 1) s += ' · cover ×' + t.def;
    if (MAP.roadHex[i]) s += ' · road';
    return s;
  }
  function fmtMp(x) { return (Math.round(x * 4) / 4).toString().replace('.5', '½').replace('.25', '¼').replace('.75', '¾').replace(/^0(?=[½¼¾])/, ''); }

  function renderCard() {
    const st = G.state;
    if (!st) { cardEl.innerHTML = ''; actionsEl.innerHTML = ''; return; }
    let html = '', acts = [];
    const u = selUnit();
    if (G.ai) {
      html = '<div class="ai-h">' + esc(sc.sides[st.side].short) + ' command is moving <span class="dots"><i></i><i></i><i></i></span></div>' +
        '<div class="hint">Turn ' + st.turn + ' · ' + E.clock(st) + '. You can pan and pinch the map while you wait. Dashed arrows show their moves.</div>';
      const last = st.log.slice(-2).filter(l => l.t === st.turn).map(l => '<div class="hint">' + esc(l.text) + '</div>').join('');
      html += last;
      acts.push(['ff', G.fastThisTurn || G.prefs.fast ? 'Fast forward on' : 'Fast forward', 'wide', !!(G.fastThisTurn || G.prefs.fast)]);
      acts.push(['menu', 'Menu', '', false]);
    } else if (u && G.pending) {
      const t = unitById(G.pending);
      const f = E.forecast(st, u, t);
      html = '<div class="fc-head">Fire on <b>' + esc(t.name) + '</b>' + (t.nat === 'fr' && t.sub ? ' · ' + esc(t.sub.replace('Division ', '')) : '') + ' · ' + f.dist + ' hex' + (f.dist > 1 ? 'es' : '') + '</div>' +
        '<div class="fc-grid"><div class="fc-col"><span class="lbl">You inflict</span><span class="big good">≈' + f.exp.toFixed(1) + '</span><span class="rng">' + f.range[0] + '–' + f.range[1] + ' strength</span></div>' +
        '<div class="fc-col"><span class="lbl">Return fire</span>' + (f.back ? '<span class="big bad">≈' + f.back.exp.toFixed(1) + '</span><span class="rng">' + f.back.range[0] + '–' + f.back.range[1] + ' strength</span>' : '<span class="big">—</span><span class="rng">Out of their range</span>') + '</div></div>' +
        (f.mods.length ? '<div class="mods">' + f.mods.map(esc).join(' · ') + '</div>' : '');
      acts.push(['cancel', 'Cancel', '', false]);
      acts.push(['fire', 'Fire', 'primary wide', false]);
    } else if (u) {
      const T = E.UNIT_TYPES[u.type];
      const mine = u.side === st.side && humanTurn();
      const enemy = st.players[u.side] !== 'human' || (bothHuman() && u.side !== st.side);
      let status = '';
      if (mine) status = u.forming ? '<span class="tag">Forming</span>' : u.refit ? '<span class="tag">Refitted</span>' : !u.moved && !u.fired ? '<span class="tag ready">Ready</span>' : u.fired ? '<span class="tag">Fired</span>' : (E.canMove(u) || E.canFire(u)) ? '<span class="tag">Moved</span>' : '<span class="tag">Spent</span>';
      else if (enemy) status = '<span class="tag enemy ' + u.side + '">' + (u.side === 'de' ? 'German' : 'French') + '</span>';
      const rng = E.fireRange(st, u, E.idxOf(st, u));
      html = '<div class="ucard">' + counterSVG(u) +
        '<div style="min-width:0"><div class="u-name">' + esc(u.name) + status + '</div><div class="u-sub">' + esc(u.sub || '') + '</div>' + meter(u) + '</div>' +
        '<div class="u-str"><b>' + u.str + '</b><small>of ' + u.max + '</small></div></div>';
      if (T.cmd) {
        html += '<div class="facts"><span><em>Move</em>' + (mine ? fmtMp(u.mp) + '/' : '') + T.mv + '</span><span><em>Command</em>next to him ×' + E.CMD_BONUS + '</span><span><em>Def</em>' + T.def + '</span></div>' +
          '<div class="where">Does not fire. Only a unit next to him can attack him; if he falls, his army fires ×' + E.CMD_LOST + ' for the rest of the day. ' + terrainLine(u.c, u.r) + '</div>';
      } else {
        html += '<div class="facts"><span><em>Move</em>' + (mine ? fmtMp(u.mp) + '/' : '') + T.mv + '</span><span><em>Range</em>' + (rng[0] === rng[1] ? rng[0] : rng[0] + '–' + rng[1]) + '</span>' +
          '<span><em>Fire</em>' + T.att.foot + '·' + T.att.horse + '·' + T.att.guns + '</span><span><em>Def</em>' + T.def + '</span></div>' +
          '<div class="where">' + esc(T.name) + ' — <i>' + esc(T.kit) + '</i>. ' + terrainLine(u.c, u.r) + '</div>';
      }
      const R = sc.reserves;
      if (mine && R && u.str < u.max && !u.refit && !u.fired) {
        const block = E.refitBlock(st, u), gain = Math.min(R.refitAmt, u.max - u.str);
        html += '<div class="spend"><span>' + (block ? esc(block) + '.' : 'Refit here: +' + gain + ' strength, ends its turn.') + '</span>' +
          '<button class="btn sm' + (block ? '' : ' primary') + '" data-act="refit"' + (block ? ' disabled' : '') + '>Refit · ' + R.refitCost + '</button></div>';
      } else if (mine && !E.canMove(u) && !E.canFire(u)) html += '<div class="hint">' + (u.forming ? 'Newly formed. It can move and fire from next turn.' : 'This unit has done all it can this turn.') + '</div>';
      else if (mine && E.canFire(u) && !G.targets.length && !E.canMove(u)) html += '<div class="hint">No enemy in range.</div>';
      pushTurnActions(acts);
    } else if (G.inspect) {
      const [c, r] = G.inspect, i = r * sc.cols + c, t = E.TERRAIN[MAP.ter[i]];
      const oi = MAP.objIdx.indexOf(i);
      const place = sc.places.find(p => p.c === c && p.r === r);
      const cost = cl => (t.cost[cl] == null ? '—' : fmtMp(t.cost[cl]));
      html = '<div class="idle-h">' + esc(place ? place.name : t.name) + (place ? ' <small>· ' + esc(t.name) + '</small>' : '') + '</div>' +
        '<div class="where">' + terrainLine(c, r) + '</div>' +
        '<div class="facts"><span><em>Move cost</em>foot ' + cost('foot') + ' · horse ' + cost('horse') + ' · guns ' + cost('guns') + '</span><span><em>Climbing</em>+½, guns +1</span></div>';
      if (oi >= 0) {
        const o = sc.objectives[oi], holder = st.control[oi];
        html += '<div class="hint">Held by the ' + sc.sides[holder].short + '. ' + (o.vp ? 'Objective worth ' + o.vp + ' VP. ' : '') +
          'Yields ' + o.inc + ' reserve' + (o.inc === 1 ? '' : 's') + ' a turn' + (t === E.TERRAIN.v ? '; units in or next to it can refit.' : '.') + '</div>';
        const R = sc.reserves;
        if (R && humanTurn() && holder === st.side && t === E.TERRAIN.v) {
          const ok = E.callupHexes(st, st.side).includes(i);
          const why = st.callups[st.side] >= R.callupMax[st.side] ? 'All ' + R.callupMax[st.side] + ' call-ups used.'
            : st.res[st.side] < R.callupCost ? 'A call-up needs ' + R.callupCost + ' reserves; you have ' + st.res[st.side] + '.'
            : E.unitAt(st, c, r) ? 'The village must be empty.' : 'Too close to the enemy.';
          html += '<div class="spend"><span>' + (ok ? 'Form a ' + esc(R.callup[st.side].name) + ' here (strength ' + R.callup[st.side].str + ').' : why) + '</span>' +
            '<button class="btn sm' + (ok ? ' primary' : '') + '" data-act="callup"' + (ok ? '' : ' disabled') + '>Call up · ' + R.callupCost + '</button></div>';
        }
      }
      pushTurnActions(acts);
    } else {
      const v = E.vp(st);
      const ready = humanTurn() ? freshUnits().length : 0;
      html = '<div class="idle-h">' + (humanTurn() ? esc(sc.sides[st.side].short) + ' to move <small>· ' + ready + ' unit' + (ready === 1 ? '' : 's') + ' not yet used</small>' : st.over ? 'The battle is over' : 'Waiting') + '</div>' +
        '<div class="objs">' + sc.objectives.map((o, k) => o.vp ? '<span class="obj"><i class="' + st.control[k] + '"></i>' + esc(o.name) + ' <b>' + o.vp + '</b></span>' : '').join('') + '</div>' +
        '<div class="hint">Germans hold ' + v.de + ' VP and need ' + sc.winVP + ' at nightfall.' +
        (humanTurn() && sc.reserves ? ' Reserves ' + st.res[st.side] + ', +' + E.incomeOf(st, st.side) + ' a turn from the places you hold.' : ' Tap a unit to act; a gold dot marks units that have not moved.') + '</div>';
      pushTurnActions(acts);
    }
    cardEl.innerHTML = html;
    actionsEl.innerHTML = acts.map(([id, label, cls, pressed]) => '<button class="btn ' + cls + '" data-act="' + id + '"' + (pressed ? ' aria-pressed="true"' : '') + (id === 'undo' && !(humanTurn() && G.state.undo) ? ' disabled' : '') + '>' + esc(label) + '</button>').join('');
  }

  function pushTurnActions(acts) {
    const st = G.state;
    if (st.over) { acts.push(['result', 'Battle report', 'primary wide', false]); acts.push(['menu', 'Menu', '', false]); return; }
    if (!humanTurn()) { acts.push(['menu', 'Menu', 'wide', false]); return; }
    acts.push(['next', 'Next unit', '', false]);
    acts.push(['undo', 'Undo move', '', false]);
    const left = freshUnits().length;
    acts.push(['end', G.confirmEnd ? 'End with ' + left + ' unused?' : 'End turn', G.confirmEnd ? 'warn' : 'primary', false]);
  }

  function onAction(e) {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const a = b.dataset.act, st = G.state;
    if (a === 'refit') { const u = selUnit(); if (u) doRefit(u); }
    else if (a === 'callup') { if (G.inspect) doCallup(G.inspect[0], G.inspect[1]); }
    else if (a === 'next') nextUnit();
    else if (a === 'undo') undo();
    else if (a === 'end') endTurn();
    else if (a === 'cancel') { G.pending = null; renderCard(); requestDraw(); }
    else if (a === 'fire') { const u = selUnit(), t = unitById(G.pending); if (u && t && !G.busy) doAttack(u, t); }
    else if (a === 'ff') { G.fastThisTurn = !G.fastThisTurn; renderCard(); }
    else if (a === 'menu') showMenu();
    else if (a === 'result') showResult();
  }
  actionsEl.addEventListener('click', onAction);
  cardEl.addEventListener('click', onAction);

  // ------------------------------------------------------------ top bar
  function updateBar() {
    const st = G.state;
    if (!st) return;
    $('turnNo').textContent = st.turn; $('turnMax').textContent = sc.turns;
    $('clock').textContent = E.clock(st);
    $('sideFlag').className = 'flag ' + st.side;
    $('sideName').textContent = sc.sides[st.side].short;
    $('sideWho').textContent = st.over ? '' : st.players[st.side] === 'ai' ? 'AI' : bothHuman() ? '' : 'You';
    $('resN').textContent = st.res[st.side];
    $('res').setAttribute('aria-label', 'Reserves ' + st.res[st.side]);
  }

  let toastT = 0;
  function toast(msg, ms) {
    toastEl.textContent = msg; toastEl.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), ms || 2400);
  }

  // ------------------------------------------------------------ overlays
  function openOverlay(html) { overlayEl.innerHTML = html; overlayEl.hidden = false; overlayEl.scrollTop = 0; }
  function closeOverlay() { overlayEl.hidden = true; overlayEl.innerHTML = ''; }

  const RULES_HTML = () => '<ul>' +
    '<li>Tap one of your units. Pale hexes show where it can move; white rings mark enemies it can fire on. Tap a ringed enemy to see the odds, then tap it again or press <b>Fire</b>.</li>' +
    '<li>A unit may move and then fire. <b>Guns</b> (artillery and mitrailleuses) move <i>or</i> fire, not both. Firing ends a unit’s movement.</li>' +
    '<li>Moving next to an enemy ends movement (zone of control). Guns exert no zone of control.</li>' +
    '<li>If you fire from within the target’s own range, it fires back at once, weakened by its losses.</li>' +
    '<li><b>The Sauer.</b> Infantry can wade it, but it takes their whole move and leaves them exposed in the water. Cavalry and guns cross only at the bridges of Wörth and Gunstett or the ford at Spachbach.</li>' +
    '<li><b>Commanders.</b> MacMahon is on the field from the start; the Crown Prince arrives at 13:15. A commander does not fire. Units next to him fire ×' + E.CMD_BONUS + '. He can be attacked only by a unit next to him. If he falls, his army fires ×' + E.CMD_LOST + ' for the rest of the day. His staff does not take or hold places.</li>' +
    '<li><b>Places and reserves.</b> Every village, and the Niederwald, belongs to whoever last entered it, shown by its flag. At the start of your turn each place you hold yields reserves (Froeschwiller 2, the others 1).</li>' +
    '<li><b>Refit</b> (' + sc.reserves.refitCost + ' reserves): a worn unit in or next to a village you hold, with no enemy next to it and not fired on since your last turn, regains up to ' + sc.reserves.refitAmt + ' strength. It must not have fired, and it can do nothing more that turn.</li>' +
    '<li><b>Call up</b> (' + sc.reserves.callupCost + ' reserves): tap an empty village you hold, away from the enemy, to form a composite battalion of strength ' + sc.reserves.callup.de.str + '. It can act from your next turn. The Germans may do this ' + sc.reserves.callupMax.de + ' times, the French ' + sc.reserves.callupMax.fr + '.</li>' +
    '<li>A unit that neither moves nor fires, and is out of contact and not under fire, also recovers 1 strength at the end of its turn.</li>' +
    '<li><b>Victory.</b> Objectives: Froeschwiller 4 VP, Elsasshausen 2, Wörth 1, Morsbronn 1, Niederwald 1. After turn 14 (nightfall) the Germans win with 6 VP or more and the French win if the Germans hold 3 or fewer. A side reduced to 30% of the strength it has committed collapses at once.</li>' +
    '</ul>' +
    '<h3>The two armies</h3><div class="tblwrap"><table class="tbl"><thead><tr><th>Unit</th><th>Move</th><th>Range</th><th>Fire vs foot·horse·guns</th><th>Def</th></tr></thead><tbody>' +
    Object.values(E.UNIT_TYPES).map(T => '<tr><td>' + esc(T.name) + '</td><td>' + T.mv + '</td><td>' + (T.cmd ? '—' : (T.rng[0] === T.rng[1] ? T.rng[1] : T.rng[0] + '–' + T.rng[1]) + (T.heightRange ? '+1' : '')) + '</td><td>' + (T.cmd ? '—' : T.att.foot + '·' + T.att.horse + '·' + T.att.guns) + '</td><td>' + T.def + '</td></tr>').join('') +
    '</tbody></table></div>' +
    '<h3>Terrain</h3><div class="tblwrap"><table class="tbl"><thead><tr><th>Terrain</th><th>Foot</th><th>Horse</th><th>Guns</th><th>Cover</th></tr></thead><tbody>' +
    Object.values(E.TERRAIN).map(t => '<tr><td>' + esc(t.name) + '</td>' + ['foot', 'horse', 'guns'].map(cl => '<td>' + (t.cost[cl] == null ? '—' : fmtMp(t.cost[cl])) + '</td>').join('') + '<td>×' + t.def + '</td></tr>').join('') +
    '<tr><td>Road (along it)</td><td>1</td><td>1</td><td>¾</td><td>—</td></tr></tbody></table></div>' +
    '<p class="fine">Higher ground adds ×1.25 to the defender. Losses on each shot are random around the expected value shown in the forecast, from half to one and a half times it. Cavalry charging into woods, villages or vineyards fight at half effect.</p>';

  // ------------------------------------------------------------ introduction
  const KP = sc.units.find(u => u.id === 'de-kp'), MM = sc.units.find(u => u.id === 'fr-mm');
  const cmdCard = (u, age, role, bio, inGame) => '<figure class="cmdcard">' + counterSVG(Object.assign({}, u, { str: u.str })) +
    '<figcaption><b>' + esc(u.name) + '</b><small>' + esc(age) + ' · ' + esc(role) + '</small></figcaption>' +
    '<p>' + esc(bio) + '</p><p class="ingame"><em>In the game</em>' + esc(inGame) + '</p></figure>';
  const INTRO = [
    {
      eyebrow: 'July 1870', title: 'War on the frontier',
      body: () => '<p class="lede">France declared war on Prussia on 19 July 1870. The quarrel began over a Hohenzollern candidate for the Spanish throne and came to a head with Bismarck’s pointed edit of the Ems telegram.</p>' +
        '<p>France had hoped the south German states would stay out. Instead Bavaria, Württemberg and Baden stood by their treaties with Prussia, although four years earlier they had fought against her.</p>' +
        '<p>Railways and staff work brought three German armies to the frontier in little more than a fortnight. The southernmost, the Third Army under the Prussian Crown Prince, mixed Prussian, Bavarian, Württemberg and Baden troops. Its task was to break into Alsace.</p>',
    },
    {
      eyebrow: '4–5 August 1870', title: 'Wissembourg',
      body: () => '<p class="lede">On 4 August the Third Army crossed the Lauter and fell on General Abel Douay’s division at Wissembourg. Douay was killed and his men driven back into the hills.</p>' +
        '<p>Marshal MacMahon gathered his I Corps on the wooded ridge west of the Sauer, from Neehwiller through Froeschwiller and Elsasshausen to the Niederwald, and called for help. Conseil-Dumesnil’s division of VII Corps joined him on the eve of battle. Of de Failly’s V Corps at Bitche, only Guyot de Lespart’s division set out.</p>' +
        '<p>MacMahon believed he had time to gather his reinforcements before the Germans attacked.</p>',
    },
    {
      eyebrow: 'The commanders', title: 'Two commanders',
      body: () => cmdCard(MM, '62', 'I Corps and the French forces in Alsace',
        'Descended from Irish Jacobite exiles. He stormed the Malakoff at Sevastopol in 1855 and won his marshal’s baton and the title Duke of Magenta in Italy in 1859. He came to the war from six years as Governor-General of Algeria; his corps included Zouaves and Algerian Tirailleurs.',
        'On the field from the start, north of Froeschwiller.') +
        cmdCard(KP, '38', 'Third Army',
          'Heir to the Prussian throne and husband of Victoria, Princess Royal, Queen Victoria’s eldest daughter. In 1866 his Second Army reached the field of Königgrätz in time to decide the battle. A liberal often at odds with Bismarck, he would reign as Emperor Friedrich III for only 99 days in 1888.',
          'He had ordered that no battle be fought on the 6th. He arrives at 13:15 by the Sulz road.') +
        '<p class="fine">Units next to their commander fire ×' + E.CMD_BONUS + '. A commander does not fire, and only a unit next to him can attack him. If he falls, his army fires ×' + E.CMD_LOST + ' for the rest of the day.</p>',
    },
    {
      eyebrow: '6 August 1870 · dawn', title: 'A battle nobody ordered',
      body: () => '<p class="lede">A thunderstorm broke over the valley on the evening of the 5th. At first light Prussian outposts near Gunstett fired on French soldiers fetching water from the Sauer. Towards 07:00 Prussian skirmishers waded the river into Wörth, which the French had left empty. The bridge there was down and the Sauer ran breast-deep.</p>' +
        '<p>The guns on both banks opened up. Hearing them, the Bavarians attacked from the north. The Crown Prince sent word that nothing was to be undertaken that would bring on a battle, but General von Kirchbach of V Corps decided to fight on his own responsibility, and XI Corps joined from Gunstett.</p>' +
        '<p>By midday the Third Army was feeding in corps after corps against a position its commander had not meant to attack that day.</p>',
    },
  ];
  const ORDERS = {
    de: ['Take Froeschwiller and the ridge. You need 6 of the 9 VP when night falls after turn 14.',
      'V Corps faces Wörth across the Sauer. II Bavarian Corps comes in from the north and XI Corps by Gunstett; more Bavarians and the Württembergers follow during the day.',
      'Your Krupp guns outrange the French. Their Chassepots outrange your Dreyse rifles, so close the distance quickly or fight from cover.'],
    fr: ['Hold the ridge until dark. Keep the Germans to 3 VP or fewer, and above all keep Froeschwiller (4 VP).',
      'You have the ground, the villages and the Chassepot. The Germans have the numbers and the better guns, and more arrive every hour.',
      'MacMahon is just north of Froeschwiller. Keep him close to the fight but out of reach. Guyot de Lespart’s division may reach Reichshoffen in the afternoon.'],
  };
  const COMMON_ORDERS = ['The Sauer: infantry can wade it, using a whole move. Cavalry and guns cross only at the bridges at Wörth and Gunstett and the ford at Spachbach.',
    'Villages you hold yield reserves every turn. Spend them to refit worn units in or next to those villages, or tap an empty village you hold to call up a composite battalion.'];

  function ordersPage(players) {
    const sides = players.de === 'human' && players.fr === 'human' ? ['de', 'fr'] : [players.de === 'human' ? 'de' : 'fr'];
    return {
      eyebrow: 'Your orders · Turn 1 · 08:00', title: sides.length > 1 ? 'Both armies' : sc.sides[sides[0]].short,
      body: () => sides.map(s => (sides.length > 1 ? '<h3 class="ord-h"><span class="flag ' + s + '"></span>' + esc(sc.sides[s].short) + '</h3>' : '') +
        '<ul class="orders">' + ORDERS[s].map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>').join('') +
        '<ul class="orders">' + COMMON_ORDERS.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>',
    };
  }

  // review: reading it again from the menu during a game
  function showIntro(players, page, review) {
    const pages = INTRO.concat([ordersPage(players)]);
    G.intro = { players, page, review };
    const p = pages[page], last = page === pages.length - 1;
    const dots = pages.map((_, k) => '<i class="' + (k === page ? 'on' : '') + '"></i>').join('');
    openOverlay('<div class="panel intro">' +
      '<div class="steps" aria-label="Page ' + (page + 1) + ' of ' + pages.length + '">' + dots + '</div>' +
      '<p class="eyebrow">' + esc(p.eyebrow) + '</p><h1 class="display small">' + esc(p.title) + '</h1>' + p.body() +
      '<div class="row">' +
      (page > 0 ? '<button class="btn" data-intro="prev">Back</button>' : '<button class="btn" data-intro="' + (review ? 'close' : 'title') + '">' + (review ? 'Back to the map' : 'Back') + '</button>') +
      (last ? '<button class="btn primary" data-intro="' + (review ? 'close' : 'go') + '">' + (review ? 'Back to the map' : 'Take command') + '</button>'
        : '<button class="btn primary" data-intro="next">Continue</button>') +
      '</div>' +
      (!last ? '<button class="linkbtn" data-intro="skip">' + (review ? 'Skip to the orders' : 'Skip to your orders') + '</button>' : '') +
      '</div>');
  }

  function showBriefing() {
    const saved = loadSave();
    const canResume = saved && !saved.over;
    const who = s => s.players.de === 'human' && s.players.fr === 'human' ? 'two players' : s.players.de === 'human' ? 'as the Germans' : 'as the French';
    openOverlay('<div class="panel">' +
      '<p class="eyebrow">Franco-Prussian War · Northern Alsace</p>' +
      '<h1 class="display">Wörth</h1>' +
      '<p class="date">Saturday, 6 August 1870 · 08:00 · Froeschwiller ridge</p>' +
      sc.briefing.map((p, k) => '<p class="' + (k ? '' : 'lede') + '">' + esc(p) + '</p>').join('') +
      '<div class="choices">' +
      (canResume ? '<button class="choice" data-start="resume"><span class="swatch ' + (saved.players.de === 'human' && saved.players.fr === 'human' ? 'hs' : saved.players.de === 'human' ? 'de' : 'fr') + '"></span><span><b>Continue the battle</b><small>Turn ' + saved.turn + ' · ' + E.clock(saved) + ', playing ' + who(saved) + '</small></span><span class="arrow">›</span></button>' : '') +
      '<button class="choice" data-start="de"><span class="swatch de"></span><span><b>Command the Germans</b><small>' + esc(sc.sides.de.commander) + '’s Third Army. Take Froeschwiller and the ridge by nightfall.</small></span><span class="arrow">›</span></button>' +
      '<button class="choice" data-start="fr"><span class="swatch fr"></span><span><b>Command the French</b><small>' + esc(sc.sides.fr.commander) + '’s I Corps. Hold the ridge until dark.</small></span><span class="arrow">›</span></button>' +
      '<button class="choice" data-start="hs"><span class="swatch hs"></span><span><b>Two players, one phone</b><small>Pass the phone between turns.</small></span><span class="arrow">›</span></button>' +
      '</div>' +
      '<details class="rules"><summary>How to play</summary>' + RULES_HTML() + '</details>' +
      '<p class="fine">The map is schematic, drawn from period descriptions rather than surveyed: about 600 m to a hex and 45 minutes to a turn. Units are brigades or their equivalent, with game strengths rather than historical headcounts.</p>' +
      '</div>');
  }

  overlayEl.addEventListener('click', e => {
    const b = e.target.closest('[data-start],[data-menu],[data-intro]');
    if (!b) return;
    if (b.dataset.start) {
      const m = b.dataset.start;
      if (m === 'resume') { const s = loadSave(); if (s) { startWith(s); return; } }
      const players = m === 'de' ? { de: 'human', fr: 'ai' } : m === 'fr' ? { de: 'ai', fr: 'human' } : { de: 'human', fr: 'human' };
      showIntro(players, 0, false);
      return;
    }
    if (b.dataset.intro) {
      const a = b.dataset.intro, it = G.intro, n = INTRO.length;
      if (a === 'next') showIntro(it.players, it.page + 1, it.review);
      else if (a === 'prev') showIntro(it.players, it.page - 1, it.review);
      else if (a === 'skip') showIntro(it.players, n, it.review);
      else if (a === 'title') showBriefing();
      else if (a === 'close') closeOverlay();
      else if (a === 'go') startWith(E.newGame(SC_ID, it.players));
      return;
    }
    const a = b.dataset.menu;
    if (a === 'close') { closeOverlay(); if (G.handoverPending) { G.handoverPending = false; announceTurn(); } }
    else if (a === 'intro') showIntro(G.state.players, 0, true);
    else if (a === 'rules') showRules();
    else if (a === 'log') showLog();
    else if (a === 'speed') { G.prefs.fast = !G.prefs.fast; savePrefs(); showMenu(); renderCard(); }
    else if (a === 'new') showConfirmNew();
    else if (a === 'new-yes') { clearSave(); G.state = null; showBriefing(); renderCard(); requestDraw(); }
    else if (a === 'menu') showMenu();
    else if (a === 'field') { closeOverlay(); G.sel = null; renderCard(); requestDraw(); }
  });

  function showMenu() {
    openOverlay('<div class="panel"><p class="eyebrow">Turn ' + G.state.turn + ' · ' + E.clock(G.state) + '</p><h1 class="display small">Field orders</h1>' +
      '<div class="menu-list">' +
      '<button class="btn primary" data-menu="close">Back to the map</button>' +
      '<button class="btn" data-menu="intro">The situation <span>Introduction and orders</span></button>' +
      '<button class="btn" data-menu="rules">How to play</button>' +
      '<button class="btn" data-menu="log">Battle log <span>' + G.state.log.length + ' entries</span></button>' +
      '<button class="btn" data-menu="speed">Animation speed <span>' + (G.prefs.fast ? 'Fast' : 'Normal') + '</span></button>' +
      '<button class="btn" data-menu="new">Start a new battle</button>' +
      '</div></div>');
  }
  function showConfirmNew() {
    openOverlay('<div class="panel"><h1 class="display small">Abandon this battle?</h1><p>The current game will be lost. You can then choose a side again.</p>' +
      '<div class="row"><button class="btn" data-menu="menu">Keep playing</button><button class="btn warn" data-menu="new-yes">Abandon and restart</button></div></div>');
  }
  function showRules() {
    openOverlay('<div class="panel"><p class="eyebrow">Wörth · rules</p><h1 class="display small">How to play</h1><div class="rules" style="border:0;padding:0">' + RULES_HTML() + '</div>' +
      '<div class="row"><button class="btn primary" data-menu="close">Back to the map</button></div></div>');
  }
  function showLog() {
    const items = G.state.log.slice().reverse().map(l => '<li class="' + esc(l.kind === 'de' || l.kind === 'fr' ? l.kind : l.kind) + '"><time>' + esc(l.time) + '</time><span>' + esc(l.text) + '</span></li>').join('');
    openOverlay('<div class="panel"><p class="eyebrow">Newest first</p><h1 class="display small">Battle log</h1>' +
      '<div class="row"><button class="btn primary" data-menu="close">Back to the map</button></div>' +
      (items ? '<ol class="log">' + items + '</ol>' : '<p class="hint">Nothing has happened yet. The first shots are yours to fire.</p>') + '</div>');
  }
  function showHandover() {
    const st = G.state;
    G.handoverPending = true;
    openOverlay('<div class="panel"><p class="eyebrow">Turn ' + st.turn + ' · ' + E.clock(st) + '</p><h1 class="display small">' + esc(sc.sides[st.side].name) + '</h1>' +
      '<p>Pass the phone to the ' + esc(sc.sides[st.side].short) + ' commander.</p>' +
      '<div class="row"><button class="btn primary" data-menu="close">Take command</button></div></div>');
  }
  function showResult() {
    const st = G.state, o = st.over;
    if (!o) return;
    const v = E.vp(st), de = E.strength(st, 'de'), fr = E.strength(st, 'fr');
    const title = o.winner === 'draw' ? 'Indecisive' : o.winner === 'de' ? 'German victory' : 'French victory';
    const human = st.players.de === 'human' && st.players.fr !== 'human' ? 'de' : st.players.fr === 'human' && st.players.de !== 'human' ? 'fr' : null;
    let line = o.reason === 'collapse' ? 'The ' + sc.sides[o.loser].short + ' have lost 70% of the strength they committed and can no longer hold together.'
      : 'Nightfall. The Germans hold ' + v.de + ' VP of 9; they needed ' + sc.winVP + '.';
    if (human) line += human === o.winner ? ' Your command carried the day.' : o.winner === 'draw' ? ' Neither side can claim the field.' : ' Your command was beaten.';
    for (const s of ['de', 'fr']) if (st.cmdLost[s]) { const cu = E.commander(st, s); line += ' ' + cu.name + ' fell during the battle.'; }
    openOverlay('<div class="panel"><p class="eyebrow">' + (o.reason === 'collapse' ? 'Turn ' + o.turn + ' · ' + E.clock(st) : 'Nightfall · 18:30') + '</p>' +
      '<h1 class="display small ' + (o.winner === 'draw' ? '' : 'verdict-' + o.winner) + '">' + title + '</h1><p class="lede">' + esc(line) + '</p>' +
      '<div class="tally"><div><small>German losses</small><b>' + (de.committed - de.now) + '</b><small>of ' + de.committed + ' strength committed</small></div>' +
      '<div><small>French losses</small><b>' + (fr.committed - fr.now) + '</b><small>of ' + fr.committed + ' strength committed</small></div></div>' +
      '<div class="objs">' + sc.objectives.map((ob, k) => ob.vp ? '<span class="obj"><i class="' + st.control[k] + '"></i>' + esc(ob.name) + ' <b>' + ob.vp + '</b></span>' : '').join('') + '</div>' +
      '<p class="fine">' + esc(sc.history) + '</p>' +
      '<div class="row"><button class="btn" data-menu="field">View the field</button><button class="btn" data-menu="log">Battle log</button><button class="btn primary" data-menu="new-yes">New battle</button></div></div>');
  }

  // ------------------------------------------------------------ input
  const pointers = new Map();
  let gesture = null;
  function local(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    camAnim = null;
    if (pointers.size === 1) gesture = { type: 'tap', sx: p.x, sy: p.y, cx: cam.x, cy: cam.y, t: performance.now() };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: cam.z, wx: mx / cam.z + cam.x, wy: my / cam.z + cam.y };
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (gesture.type === 'tap' || gesture.type === 'pan') {
      const dx = p.x - gesture.sx, dy = p.y - gesture.sy;
      if (gesture.type === 'tap' && Math.hypot(dx, dy) > 9) gesture.type = 'pan';
      if (gesture.type === 'pan') { cam.x = gesture.cx - dx / cam.z; cam.y = gesture.cy - dy / cam.z; clampCam(); requestDraw(); }
    } else if (gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const [zmin, zmax] = zLimits();
      cam.z = Math.min(zmax, Math.max(zmin, gesture.z0 * d / gesture.d0));
      cam.x = gesture.wx - mx / cam.z; cam.y = gesture.wy - my / cam.z;
      clampCam(); requestDraw();
    }
  });
  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.type === 'tap' && pointers.size === 0 && e.type === 'pointerup' && performance.now() - gesture.t < 650) onTap(gesture.sx, gesture.sy);
    if (gesture.type === 'pinch' && pointers.size === 1) {
      const p = [...pointers.values()][0];
      gesture = { type: 'pan', sx: p.x, sy: p.y, cx: cam.x, cy: cam.y };
      return;
    }
    if (pointers.size === 0) { gesture = null; if (cam.z) renderStaticIfNeeded(); }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const p = local(e), wx = p.x / cam.z + cam.x, wy = p.y / cam.z + cam.y;
    const [zmin, zmax] = zLimits();
    cam.z = Math.min(zmax, Math.max(zmin, cam.z * Math.exp(-e.deltaY * 0.0015)));
    cam.x = wx - p.x / cam.z; cam.y = wy - p.y / cam.z; clampCam(); requestDraw();
  }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault()));
  document.addEventListener('dblclick', e => e.preventDefault());
  function renderStaticIfNeeded() { /* static layer is resolution-independent enough; kept for future level-of-detail */ }

  $('menuBtn').addEventListener('click', () => { if (G.state) showMenu(); else showBriefing(); });
  $('fitBtn').addEventListener('click', () => {
    const fitZ = Math.min(viewW / WORLD_W, viewH / WORLD_H);
    if (cam.z > fitZ * 1.05) panTo(WORLD_W / 2, WORLD_H / 2, 320, fitZ);
    else { const u = selUnit(); const [x, y] = u ? center(u.c, u.r) : [WORLD_W / 2, WORLD_H / 2]; panTo(x, y, 320, defaultZoom()); }
  });
  $('focusBtn').addEventListener('click', () => {
    const u = selUnit();
    if (u) { const [x, y] = center(u.c, u.r); panTo(x, y, 300, Math.max(cam.z, defaultZoom())); return; }
    if (G.state) { const list = readyUnits(); if (list.length) { select(list[0].id); const [x, y] = center(list[0].c, list[0].r); panTo(x, y, 300, Math.max(cam.z, defaultZoom())); } }
  });

  // ------------------------------------------------------------ boot
  function startWith(state) {
    G.state = state; G.sel = null; G.pending = null; G.inspect = null; G.trails = []; G.effects = []; G.ghosts = [];
    closeOverlay(); save();
    updateBar(); refreshSel(); renderCard();
    const human = state.players[state.side] === 'human' ? state.side : (state.players.de === 'human' ? 'de' : 'fr');
    const focus = human === 'de' ? center(11, 7) : center(5, 8);
    centerOn(focus[0], focus[1], defaultZoom());
    if (state.over) { showResult(); return; }
    if (state.players[state.side] === 'ai') runAI();
    else if (bothHuman()) showHandover();
    else announceTurn();
  }

  function start(data) {
    loadPrefs();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas); else window.addEventListener('resize', resize);
    resize();
    buildStatic(); requestDraw();
    const fontsReady = document.fonts && document.fonts.load ? Promise.all([
      document.fonts.load('600 12px "IBM Plex Sans Condensed"'), document.fonts.load('italic 600 12px "Bodoni Moda"'),
    ]) : Promise.resolve();
    Promise.race([fontsReady, sleep(2500)]).then(() => { buildStatic(); requestDraw(); renderCard(); });
    let restored = null;
    if (data && data.save) { try { restored = E.deserialize(data.save); } catch (e) { restored = null; } }
    if (restored) startWith(restored);
    else { renderCard(); showBriefing(); }
  }

  if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
    try { window.claude.hot.snapshot(() => ({ save: G.state && !G.busy ? E.serialize(G.state) : null })); } catch (e) { /* optional */ }
  }
  window.__woerth = { G, cam, E };
  if (window.claude && window.claude.hot && window.claude.hot.ready) window.claude.hot.ready(start);
  else start((window.claude && window.claude.hot && window.claude.hot.data) || {});
})();
