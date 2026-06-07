/* ============================================================================
   VIVARIUM — RENDER (imperative canvas, decoupled from the tick)
   The surface of Mars in isometric: continuous rust terrain (rocks, craters,
   drifts — no checkerboard), frosted pressurized DOMES for the colony, day/night
   ambient, dust storms. The canvas stays imperative; React never touches it.
   ============================================================================ */
(function () {
  "use strict";

  const TW = 58, TH = 29;       // iso tile half-extents (2:1)
  const MARGIN = 6;             // how far the surface extends past the play grid
  let canvas, ctx, dpr = 1;
  let W = 0, H = 0;
  let originX = 0, originY = 0;
  let hover = null;             // {gx,gy}
  let placing = null;           // defId being placed
  let demolish = false;
  let dust = [], stars = [], decor = [];

  // ---- seeded RNG so the surface is stable across frames/reloads -------------
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash(x, y) { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const tl = hash(xi, yi), tr = hash(xi + 1, yi), bl = hash(xi, yi + 1), br = hash(xi + 1, yi + 1);
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return tl * (1 - u) * (1 - v) + tr * u * (1 - v) + bl * (1 - u) * v + br * u * v;
  }
  function fbm(x, y) { let s = 0, a = 0.6, f = 1; for (let i = 0; i < 3; i++) { s += a * vnoise(x * f, y * f); f *= 2.1; a *= 0.5; } return s; }

  function init(cv) {
    canvas = cv; ctx = canvas.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", () => { hover = null; });
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("contextmenu", onRight);
    seedParticles();
    seedDecor();
    draw();
  }

  function seedParticles() {
    dust = [];
    for (let i = 0; i < 240; i++) dust.push({ x: Math.random(), y: Math.random(), s: 0.4 + Math.random() * 1.7, v: 0.3 + Math.random() });
    stars = [];
    for (let i = 0; i < 130; i++) stars.push({ x: Math.random(), y: Math.random() * 0.5, r: Math.random() * 1.3, tw: Math.random() * 6.28 });
  }

  // ---- terrain decoration: rocks, craters, pebbles, drifts (generated once) --
  function seedDecor() {
    const N = window.Engine.state ? window.Engine.state.N : 11;
    const rng = mulberry(98213);
    decor = [];
    const lo = -MARGIN, hi = N + MARGIN;
    // boulders
    for (let i = 0; i < 70; i++) {
      const gx = lo + rng() * (hi - lo), gy = lo + rng() * (hi - lo);
      decor.push({ t: "rock", gx, gy, s: 4 + rng() * 11, r: rng() * 6.28, k: rng() });
    }
    // craters
    for (let i = 0; i < 9; i++) {
      const gx = lo + rng() * (hi - lo), gy = lo + rng() * (hi - lo);
      decor.push({ t: "crater", gx, gy, s: 16 + rng() * 30 });
    }
    // pebble scatter
    for (let i = 0; i < 220; i++) {
      const gx = lo + rng() * (hi - lo), gy = lo + rng() * (hi - lo);
      decor.push({ t: "pebble", gx, gy, s: 1 + rng() * 2.2, k: rng() });
    }
    // wind drifts (elongated pale streaks)
    for (let i = 0; i < 26; i++) {
      const gx = lo + rng() * (hi - lo), gy = lo + rng() * (hi - lo);
      decor.push({ t: "drift", gx, gy, s: 18 + rng() * 40, k: rng() });
    }
    decor.sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy));
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    originX = W * 0.56;
    originY = H * 0.10;
  }

  // ---- iso projection --------------------------------------------------------
  function iso(gx, gy) { return { x: originX + (gx - gy) * TW, y: originY + (gx + gy) * TH }; }
  function unproject(mx, my) {
    const dx = mx - originX, dy = my - originY;
    return { gx: Math.floor((dx / TW + dy / TH) / 2), gy: Math.floor((dy / TH - dx / TW) / 2) };
  }

  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    const p = unproject(e.clientX - r.left, e.clientY - r.top);
    const N = window.Engine.state.N;
    hover = (p.gx >= 0 && p.gy >= 0 && p.gx < N && p.gy < N) ? p : null;
  }
  function onClick() {
    if (!hover) return;
    if (demolish) { window.Engine.removeAt(hover.gx, hover.gy); return; }
    if (placing && window.Engine.place(placing, hover.gx, hover.gy) && onPlaced) onPlaced(placing);
  }
  function onRight(e) { e.preventDefault(); placing = null; demolish = false; if (onCancel) onCancel(); }
  let onPlaced = null, onCancel = null;

  // ---- ambient by time of day -----------------------------------------------
  function ambient() {
    const s = window.Engine.state, tod = s.tod;
    let l;
    if (tod < 0.20) l = 0.07;
    else if (tod < 0.30) l = (tod - 0.20) / 0.10 * 0.9 + 0.07;
    else if (tod < 0.74) l = 0.97;
    else if (tod < 0.85) l = 0.97 - (tod - 0.74) / 0.11 * 0.9;
    else l = 0.07;
    if (s.weather === "dust") l *= 0.55;
    return Math.max(0.07, Math.min(1, l));
  }
  function lerpC(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function rgb(c, a) { return a == null ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function now() { return performance.now() / 1000; }

  // ---- frame -----------------------------------------------------------------
  function draw() {
    const s = window.Engine.state;
    if (!s) return;
    const amb = ambient();
    const nowMs = performance.now();
    drawSky(amb);
    drawTerrain(amb);
    drawBuildings(amb, nowMs);
    drawGhost(amb);
    drawDust(nowMs, amb);
    if (s.weather === "dust") drawStormVeil(nowMs);
  }

  function drawSky(amb) {
    const s = window.Engine.state;
    const top = lerpC([8, 10, 14], s.weather === "dust" ? [44, 28, 20] : [22, 24, 32], amb);
    const horizon = lerpC([16, 12, 13], s.weather === "dust" ? [128, 70, 42] : [158, 92, 60], amb);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(top));
    g.addColorStop(0.55, rgb(lerpC(top, horizon, 0.55)));
    g.addColorStop(0.74, rgb(horizon));
    g.addColorStop(1, rgb(lerpC(horizon, [12, 8, 8], 0.5)));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (amb < 0.5) {
      const sa = (0.5 - amb) / 0.5, tt = now();
      for (const st of stars) {
        const tw = 0.5 + 0.5 * Math.sin(tt + st.tw);
        ctx.fillStyle = `rgba(180,200,210,${sa * (0.2 + 0.5 * tw) * 0.65})`;
        ctx.fillRect(st.x * W, st.y * H, st.r, st.r);
      }
    }
  }

  // ---- continuous Martian terrain (no checkerboard) --------------------------
  function tileFade(gx, gy, N) {
    const d = Math.max(0, -gx, gx - (N - 1), -gy, gy - (N - 1));
    return Math.max(0, 1 - d / MARGIN);
  }

  function drawTerrain(amb) {
    const s = window.Engine.state, N = s.N;
    const lo = -MARGIN, hi = N + MARGIN;
    const litness = 0.18 + amb * 0.95;
    for (let gx = lo; gx < hi; gx++) {
      for (let gy = lo; gy < hi; gy++) {
        const fade = tileFade(gx, gy, N);
        if (fade <= 0.01) continue;
        const c = iso(gx, gy);
        // smooth rust color from layered noise — neighbouring tiles barely differ
        const n = fbm(gx * 0.5 + 4, gy * 0.5 + 9);
        const dune = vnoise(gx * 0.14 + 20, gy * 0.14 + 3);
        let col = lerpC([54, 28, 21], [120, 64, 42], n * 0.72 + dune * 0.28);
        // a touch of hue drift toward ochre
        col = lerpC(col, [108, 58, 34], dune * 0.3);
        col = col.map((v) => v * litness);
        ctx.globalAlpha = fade;
        diamond(c.x, c.y, TW + 0.6, TH + 0.4, rgb(col));
      }
    }
    ctx.globalAlpha = 1;
    drawDecor(amb, N);
    // faint placement guide only while a tool is active
    if ((placing || demolish) && hover) drawPlacementGuide();
  }

  function diamond(cx, cy, w, h, fill) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - h); ctx.lineTo(cx + w, cy); ctx.lineTo(cx, cy + h); ctx.lineTo(cx - w, cy);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }

  function drawDecor(amb, N) {
    const lit = 0.2 + amb * 0.9;
    for (const d of decor) {
      const fade = tileFade(d.gx, d.gy, N);
      if (fade <= 0.02) continue;
      const p = iso(d.gx, d.gy);
      ctx.globalAlpha = fade;
      if (d.t === "pebble") {
        ctx.fillStyle = rgb([40 * lit + 14, 22 * lit + 8, 16 * lit + 6], 0.5);
        ctx.fillRect(p.x, p.y, d.s, d.s);
      } else if (d.t === "drift") {
        // pale wind-blown dust streak
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(1, 0.5);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, d.s);
        g.addColorStop(0, rgb([150, 96, 64].map((v) => v * lit), 0.16 + amb * 0.1));
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, d.s, 0, 6.28); ctx.fill(); ctx.restore();
      } else if (d.t === "crater") {
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(1, 0.5);
        // shadowed bowl + lit rim (light upper-left)
        ctx.fillStyle = rgb([30, 16, 12].map((v) => v * lit), 0.55);
        ctx.beginPath(); ctx.arc(0, 0, d.s, 0, 6.28); ctx.fill();
        ctx.strokeStyle = rgb([150, 92, 60].map((v) => v * lit), 0.4); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, d.s * 0.96, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
        ctx.strokeStyle = rgb([20, 10, 8], 0.5); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, d.s * 0.96, Math.PI * 0.05, Math.PI * 0.95); ctx.stroke();
        ctx.restore();
      } else if (d.t === "rock") {
        drawRock(p.x, p.y, d.s, d.r, lit, d.k);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawRock(x, y, s, rot, lit, k) {
    ctx.save(); ctx.translate(x, y);
    // contact shadow
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath(); ctx.ellipse(s * 0.18, s * 0.18, s * 0.95, s * 0.5, 0, 0, 6.28); ctx.fill();
    ctx.rotate(rot);
    const dark = [44, 26, 20].map((v) => v * lit + 6);
    const face = [96, 60, 42].map((v) => v * lit);
    // body (angular blob)
    ctx.beginPath();
    const sides = 6;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * 6.28;
      const rr = s * (0.6 + 0.4 * hash(i + 1, k * 99));
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr * 0.6;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fillStyle = rgb(dark); ctx.fill();
    // lit facet upper-left
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.5);
    ctx.lineTo(-s * 0.55, -s * 0.05);
    ctx.lineTo(-s * 0.1, s * 0.05);
    ctx.lineTo(s * 0.2, -s * 0.3);
    ctx.closePath(); ctx.fillStyle = rgb(face, 0.85); ctx.fill();
    ctx.restore();
  }

  // ---- buildings: weathered industrial metal + greebles ----------------------
  function drawBuildings(amb, nowMs) {
    const list = window.Engine.state.buildings.slice().sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy));
    for (const b of list) drawStructure(b, amb, nowMs);
  }

  function footGeo(b) {
    const fw = b.def.foot[0], fh = b.def.foot[1];
    const cgx = b.gx + (fw - 1) / 2, cgy = b.gy + (fh - 1) / 2;
    const c = iso(cgx, cgy);
    const scale = (fw + fh) / 2;
    return { cx: c.x, cy: c.y, rx: TW * 0.86 * scale, ry: TH * 0.86 * scale, scale };
  }

  function status(b) {
    const def = b.def;
    const alive = b.online && (!def.requiresPressure || b.connected) && b.staffed && b.fed;
    const hurt = (def.requiresPressure && !b.connected) || (def.staffing > 0 && !b.staffed) || !b.fed ||
      (!b.online && (def.consumes.power > 0));
    return { alive, hurt };
  }
  function glowColor(st) { return st.hurt ? [232, 120, 79] : [127, 212, 232]; }
  function hexA(hex, a) { return rgb(hexToRgb(hex), a); }

  const ACCENTS = ['#a8602f', '#7a6a44', '#3f6b66', '#8a3b32', '#566b78'];
  function genGreeble(b) {
    const rng = mulberry((b.uid * 2654435761) >>> 0);
    const tops = ['antenna', 'dish', 'vent', 'antenna'];
    const g = {
      accent: b.def.isHub ? '#3f6b66' : ACCENTS[(rng() * ACCENTS.length) | 0],
      top: b.def.isHub ? 'array' : tops[(rng() * tops.length) | 0],
      tag: b.def.glyph + '-' + (10 + ((b.uid * 7) % 89)),
      streaks: [], lights: [], flip: rng() < 0.5 ? 1 : -1,
    };
    const ns = 2 + (rng() * 3 | 0);
    for (let i = 0; i < ns; i++) g.streaks.push({ x: rng() * 1.5 - 0.75, w: 1.5 + rng() * 2.5, a: 0.10 + rng() * 0.16 });
    const nl = 1 + (rng() * 2 | 0);
    for (let i = 0; i < nl; i++) g.lights.push({ x: rng() * 1.4 - 0.7, y: 0.2 + rng() * 0.5, c: rng() < 0.4 ? [232, 96, 72] : [232, 170, 80], ph: rng() * 6.28, sp: 500 + rng() * 1400 });
    return g;
  }

  function drawStructure(b, amb, nowMs) {
    if (!b._gr) b._gr = genGreeble(b);
    const def = b.def, g = footGeo(b);
    ctx.save(); ctx.translate(g.cx, g.cy + g.ry * 0.14);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(0, 0, g.rx * 1.05, g.ry * 0.95, 0, 0, 6.28); ctx.fill();
    ctx.restore();
    if (def.solar) return drawSolar(b, g, amb);
    if (def.conduit) return drawTube(b, g, amb);
    if (def.id === 'battery') return drawDrum(b, g, amb, nowMs);
    if (def.id === 'extractor' || def.id === 'electrolysis' || def.id === 'cistern' || def.id === 'o2tank') return drawTank(b, g, amb, nowMs);
    return drawDome(b, g, amb, nowMs);
  }

  function metalRamp(base, amb) {
    const lit = 0.34 + amb * 0.66;
    return {
      spec: base.map((v) => Math.min(255, v * lit * 1.7 + 70)),
      hi: base.map((v) => Math.min(255, v * lit * 1.25)),
      mid: base.map((v) => v * lit * 0.78),
      lo: base.map((v) => v * lit * 0.4),
      dk: base.map((v) => v * lit * 0.26),
    };
  }

  function drawCollar(cx, cy, rx, ry, h, amb, accent) {
    const m = metalRamp([104, 110, 120], amb);
    function bandPath() {
      ctx.beginPath();
      ctx.moveTo(cx - rx, cy - ry); ctx.lineTo(cx - rx, cy - h);
      ctx.ellipse(cx, cy - h, rx, ry, 0, Math.PI, 2 * Math.PI);
      ctx.lineTo(cx + rx, cy - ry); ctx.ellipse(cx, cy - ry, rx, ry, 0, 2 * Math.PI, Math.PI, true);
      ctx.closePath();
    }
    bandPath();
    const lg = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
    lg.addColorStop(0, rgb(m.dk)); lg.addColorStop(0.4, rgb(m.mid)); lg.addColorStop(0.55, rgb(m.hi)); lg.addColorStop(1, rgb(m.lo));
    ctx.fillStyle = lg; ctx.fill();
    ctx.save(); bandPath(); ctx.clip();
    ctx.strokeStyle = hexA(accent, 0.5); ctx.lineWidth = Math.max(3, h * 0.42);
    ctx.beginPath(); ctx.ellipse(cx, cy - h * 0.5, rx, ry, 0, 0.05 * Math.PI, 0.95 * Math.PI); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(200,210,220,0.3)';
    for (let a = 0.12; a < Math.PI - 0.12; a += Math.PI / 12) ctx.fillRect(cx + Math.cos(a) * rx * 0.97 - 0.6, cy - h + Math.sin(a) * ry * 0.97 - 0.6, 1.4, 1.4);
  }

  function drawDome(b, g, amb, nowMs) {
    const def = b.def, st = status(b), gr = b._gr;
    const { cx, cy, rx, ry } = g;
    const collarH = rx * 0.14;
    drawCollar(cx, cy, rx * 0.99, ry, collarH, amb, gr.accent);
    const dcy = cy - collarH;
    const domeH = rx * 0.82 * (def.isHub ? 1.12 : 0.92);
    const base = def.id === 'greenhouse' ? [104, 116, 116] : [116, 124, 134];
    const m = metalRamp(base, amb);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - rx, dcy);
    ctx.bezierCurveTo(cx - rx, dcy - domeH * 1.16, cx + rx, dcy - domeH * 1.16, cx + rx, dcy);
    ctx.bezierCurveTo(cx + rx * 0.55, dcy + ry, cx - rx * 0.55, dcy + ry, cx - rx, dcy);
    ctx.closePath();
    const rad = ctx.createRadialGradient(cx - rx * 0.4, dcy - domeH * 0.82, rx * 0.06, cx - rx * 0.05, dcy - domeH * 0.25, rx * 1.5);
    rad.addColorStop(0, rgb(m.spec)); rad.addColorStop(0.16, rgb(m.hi)); rad.addColorStop(0.52, rgb(m.mid)); rad.addColorStop(1, rgb(m.lo));
    ctx.fillStyle = rad; ctx.fill();
    ctx.clip();
    if (def.id === 'greenhouse') {
      const gg = ctx.createRadialGradient(cx, dcy - domeH * 0.2, 2, cx, dcy - domeH * 0.2, rx);
      gg.addColorStop(0, rgb([120, 210, 130], 0.26 + 0.12 * (st.alive ? 1 : 0.3)));
      gg.addColorStop(1, rgb([120, 210, 130], 0));
      ctx.fillStyle = gg; ctx.fillRect(cx - rx, dcy - domeH * 1.2, rx * 2, domeH * 1.5);
    }
    drawDomePanels(cx, dcy, rx, domeH, def);
    drawStreaks(cx, dcy, rx, domeH, gr);
    const fy = 0.46, w = rx * Math.sqrt(Math.max(0, 1 - fy * fy)), yy = dcy - domeH * fy;
    ctx.strokeStyle = hexA(gr.accent, 0.55); ctx.lineWidth = domeH * 0.14;
    ctx.beginPath(); ctx.ellipse(cx, yy, w, w * 0.5, 0, 0.12 * Math.PI, 0.88 * Math.PI); ctx.stroke();
    ctx.fillStyle = 'rgba(14,18,22,0.6)'; ctx.font = '600 8px IBM Plex Mono, monospace'; ctx.textAlign = 'center';
    ctx.fillText(gr.tag, cx, yy + 3);
    ctx.restore();
    ctx.strokeStyle = rgb(m.spec, 0.4); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(cx, dcy, rx, ry, 0, Math.PI, 2 * Math.PI); ctx.stroke();
    drawHatch(cx, dcy + ry * 0.1, rx * 0.34, glowColor(st), st, nowMs, b.uid);
    serviceLights(cx, dcy, rx, domeH, gr, nowMs);
    const apex = dcy - domeH * 1.12;
    if (gr.top === 'array') drawArray(cx, apex, nowMs, b.uid);
    else if (gr.top === 'dish') drawDish(cx, apex, gr.flip, amb);
    else if (gr.top === 'vent') drawVent(cx, apex, amb);
    else drawAntenna(cx, apex, nowMs, b.uid);
  }

  function drawDomePanels(cx, dcy, rx, domeH, def) {
    const seamMain = def.id === 'greenhouse' ? 'rgba(150,210,170,0.4)' : 'rgba(18,22,28,0.5)';
    const seamHi = 'rgba(200,212,222,0.12)';
    ctx.lineWidth = 1;
    const rings = [0.3, 0.56, 0.8];
    for (const f of rings) {
      const yy = dcy - domeH * f, w = rx * Math.sqrt(Math.max(0, 1 - f * f));
      ctx.strokeStyle = seamHi; ctx.beginPath(); ctx.ellipse(cx, yy + 1, w, w * 0.5, 0, 0, Math.PI); ctx.stroke();
      ctx.strokeStyle = seamMain; ctx.beginPath(); ctx.ellipse(cx, yy, w, w * 0.5, 0, 0, 2 * Math.PI); ctx.stroke();
    }
    for (let i = -3; i <= 3; i++) {
      const off = i / 3;
      ctx.strokeStyle = seamMain;
      ctx.beginPath();
      ctx.moveTo(cx + off * rx, dcy);
      ctx.bezierCurveTo(cx + off * rx * 0.62, dcy - domeH * 0.66, cx + off * rx * 0.22, dcy - domeH * 0.96, cx, dcy - domeH * 1.04);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(205,215,224,0.22)';
    const f = rings[1], yy = dcy - domeH * f, w = rx * Math.sqrt(Math.max(0, 1 - f * f));
    for (let a = 0; a < 2 * Math.PI; a += Math.PI / 10) ctx.fillRect(cx + Math.cos(a) * w - 0.5, yy + Math.sin(a) * w * 0.5 - 0.5, 1.3, 1.3);
  }

  function drawStreaks(cx, dcy, rx, domeH, gr) {
    for (const s of gr.streaks) {
      const x = cx + s.x * rx * 0.7;
      const g = ctx.createLinearGradient(0, dcy - domeH * 0.5, 0, dcy + rx * 0.2);
      g.addColorStop(0, 'rgba(30,20,15,0)');
      g.addColorStop(0.35, rgb([38, 26, 18], s.a));
      g.addColorStop(1, 'rgba(30,20,15,0)');
      ctx.fillStyle = g; ctx.fillRect(x - s.w, dcy - domeH * 0.5, s.w * 2, domeH * 0.85);
    }
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawHatch(x, y, w, gc, st, nowMs, uid) {
    const h = w * 0.62;
    ctx.fillStyle = 'rgba(20,24,30,0.85)';
    roundRectPath(x - w / 2, y - h, w, h, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(150,160,170,0.5)'; ctx.lineWidth = 1.4; ctx.stroke();
    const pulse = 0.55 + 0.45 * Math.sin(nowMs / 700 + uid);
    ctx.save(); ctx.shadowColor = rgb(gc, 0.9); ctx.shadowBlur = 10;
    ctx.fillStyle = rgb(gc, (st.alive ? 0.8 : st.hurt ? 0.65 : 0.32) * (0.6 + 0.4 * pulse));
    roundRectPath(x - w * 0.32, y - h * 0.82, w * 0.64, h * 0.62, 2); ctx.fill();
    ctx.restore();
  }

  function serviceLights(cx, dcy, rx, domeH, gr, nowMs) {
    for (const l of gr.lights) {
      const x = cx + l.x * rx * 0.6, y = dcy - domeH * l.y;
      const on = 0.5 + 0.5 * Math.sin(nowMs / l.sp + l.ph);
      ctx.save(); ctx.shadowColor = rgb(l.c, 0.9); ctx.shadowBlur = 6;
      ctx.fillStyle = rgb(l.c, 0.25 + 0.6 * on);
      ctx.beginPath(); ctx.arc(x, y, 1.5, 0, 6.28); ctx.fill(); ctx.restore();
    }
  }

  function drawAntenna(x, y, nowMs, uid) {
    ctx.strokeStyle = 'rgba(150,160,170,0.7)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 22); ctx.stroke();
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) { const yy = y - 8 * i; ctx.beginPath(); ctx.moveTo(x - 4, yy + 2); ctx.lineTo(x, yy); ctx.lineTo(x + 4, yy + 2); ctx.stroke(); }
    const blink = Math.sin(nowMs / 600 + uid) > 0.3;
    ctx.save(); ctx.shadowColor = 'rgba(232,96,72,1)'; ctx.shadowBlur = blink ? 8 : 2;
    ctx.fillStyle = blink ? 'rgba(245,110,84,1)' : 'rgba(120,50,40,0.6)';
    ctx.beginPath(); ctx.arc(x, y - 23, 1.8, 0, 6.28); ctx.fill(); ctx.restore();
  }
  function drawDish(x, y, flip, amb) {
    const lit = 0.4 + amb * 0.6;
    ctx.strokeStyle = rgb([140, 150, 160].map((v) => v * lit), 0.9); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + flip * 5, y - 12); ctx.stroke();
    ctx.save(); ctx.translate(x + flip * 9, y - 16); ctx.rotate(flip * -0.5);
    ctx.fillStyle = rgb([150, 160, 172].map((v) => v * lit), 0.95);
    ctx.beginPath(); ctx.ellipse(0, 0, 8, 5, 0, 0, 6.28); ctx.fill();
    ctx.fillStyle = rgb([40, 46, 54], 0.9); ctx.beginPath(); ctx.ellipse(0, 0, 6, 3.6, 0, 0, 6.28); ctx.fill();
    ctx.strokeStyle = rgb([180, 190, 200], 0.8); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-flip * 4, 3); ctx.stroke();
    ctx.restore();
  }
  function drawVent(x, y, amb) {
    const m = metalRamp([110, 118, 128], amb);
    for (let i = 0; i < 2; i++) {
      const xx = x - 5 + i * 10, h = 9 + i * 3, r = 3;
      ctx.fillStyle = rgb(m.mid); ctx.fillRect(xx - r, y - h, r * 2, h);
      ctx.fillStyle = rgb(m.hi); ctx.beginPath(); ctx.ellipse(xx, y - h, r, r * 0.5, 0, 0, 6.28); ctx.fill();
      ctx.fillStyle = rgb([20, 24, 30], 0.8); ctx.beginPath(); ctx.ellipse(xx, y - h, r * 0.6, r * 0.3, 0, 0, 6.28); ctx.fill();
    }
  }
  function drawArray(x, y, nowMs, uid) {
    ctx.strokeStyle = 'rgba(160,170,180,0.8)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 26); ctx.stroke();
    for (let i = 1; i <= 3; i++) { const yy = y - 7 * i; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 5, yy + 2); ctx.lineTo(x, yy); ctx.lineTo(x + 5, yy + 2); ctx.stroke(); }
    drawDish(x - 2, y - 4, -1, 1);
    const pulse = 0.5 + 0.5 * Math.sin(nowMs / 500 + uid);
    ctx.save(); ctx.shadowColor = 'rgba(127,212,232,1)'; ctx.shadowBlur = 14;
    ctx.fillStyle = rgb([180, 235, 248], 0.5 + 0.5 * pulse);
    ctx.beginPath(); ctx.arc(x, y - 27, 2.4, 0, 6.28); ctx.fill(); ctx.restore();
  }

  function drawTank(b, g, amb, nowMs) {
    const def = b.def, st = status(b), gr = b._gr;
    const { cx, cy, rx } = g;
    const r = rx * 0.5, h = rx * (def.id === 'extractor' ? 1.05 : 1.3), ery = r * 0.5;
    let base = [120, 128, 138];
    if (def.id === 'cistern') base = [96, 120, 150];
    if (def.id === 'o2tank') base = [108, 150, 162];
    if (def.id === 'extractor') base = [120, 128, 118];
    const m = metalRamp(base, amb);
    ctx.strokeStyle = rgb(m.dk, 0.9); ctx.lineWidth = 2;
    for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + sgn * r * 0.8, cy); ctx.lineTo(cx + sgn * r * 0.5, cy - ery); ctx.stroke(); }
    function bodyPath() {
      ctx.beginPath();
      ctx.moveTo(cx - r, cy - ery); ctx.lineTo(cx - r, cy - h);
      ctx.ellipse(cx, cy - h, r, ery, 0, Math.PI, 2 * Math.PI);
      ctx.lineTo(cx + r, cy - ery); ctx.ellipse(cx, cy - ery, r, ery, 0, 2 * Math.PI, Math.PI, true);
      ctx.closePath();
    }
    bodyPath();
    const lg = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
    lg.addColorStop(0, rgb(m.dk)); lg.addColorStop(0.35, rgb(m.mid)); lg.addColorStop(0.52, rgb(m.spec)); lg.addColorStop(0.7, rgb(m.mid)); lg.addColorStop(1, rgb(m.lo));
    ctx.fillStyle = lg; ctx.fill();
    ctx.save(); bodyPath(); ctx.clip();
    ctx.strokeStyle = hexA(gr.accent, 0.5); ctx.lineWidth = h * 0.16;
    ctx.beginPath(); ctx.moveTo(cx - r, cy - h * 0.7); ctx.lineTo(cx + r, cy - h * 0.7); ctx.stroke();
    ctx.strokeStyle = rgb(m.dk, 0.7); ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) { const yy = cy - ery - (h - ery) * (i / 4); ctx.beginPath(); ctx.ellipse(cx, yy, r, ery, 0, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.fillStyle = rgb([34, 24, 16], 0.18); ctx.fillRect(cx - r * 0.3, cy - h * 0.8, 2, h * 0.7);
    ctx.restore();
    ctx.beginPath(); ctx.ellipse(cx, cy - h, r, ery, 0, 0, 6.28); ctx.fillStyle = rgb(m.hi); ctx.fill();
    ctx.strokeStyle = rgb(m.spec, 0.5); ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = rgb(m.mid, 0.9); ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(cx + r, cy - h * 0.55); ctx.lineTo(cx + r + 6, cy - h * 0.55); ctx.lineTo(cx + r + 6, cy - ery * 0.5); ctx.stroke();
    if (def.id === 'extractor') {
      ctx.strokeStyle = rgb(m.mid, 0.85); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(cx - r * 0.7, cy - h); ctx.lineTo(cx, cy - h - 18); ctx.lineTo(cx + r * 0.7, cy - h); ctx.moveTo(cx, cy - h - 18); ctx.lineTo(cx, cy - h); ctx.stroke();
    } else if (def.id === 'electrolysis') { drawVent(cx, cy - h, amb); }
    else { drawAntenna(cx, cy - h, nowMs, b.uid); }
    const gc = glowColor(st), pulse = 0.55 + 0.45 * Math.sin(nowMs / 640 + b.uid);
    ctx.save(); ctx.shadowColor = rgb(gc, 0.9); ctx.shadowBlur = 10;
    ctx.fillStyle = rgb(gc, (st.alive ? 0.85 : st.hurt ? 0.7 : 0.4) * (0.6 + 0.4 * pulse));
    ctx.beginPath(); ctx.arc(cx - r * 0.5, cy - h * 0.78, 2.2, 0, 6.28); ctx.fill(); ctx.restore();
  }

  function drawDrum(b, g, amb, nowMs) {
    const { cx, cy, rx } = g;
    const r = rx * 0.64, h = rx * 0.54, ery = r * 0.5;
    const m = metalRamp([96, 104, 114], amb);
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - ery); ctx.lineTo(cx - r, cy - h);
    ctx.ellipse(cx, cy - h, r, ery, 0, Math.PI, 2 * Math.PI);
    ctx.lineTo(cx + r, cy - ery); ctx.ellipse(cx, cy - ery, r, ery, 0, 2 * Math.PI, Math.PI, true);
    ctx.closePath();
    const lg = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
    lg.addColorStop(0, rgb(m.dk)); lg.addColorStop(0.5, rgb(m.hi)); lg.addColorStop(1, rgb(m.lo));
    ctx.fillStyle = lg; ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, cy - h, r, ery, 0, 0, 6.28); ctx.fillStyle = rgb(m.hi); ctx.fill();
    ctx.strokeStyle = rgb(m.dk, 0.6); ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = rgb(m.dk, 0.5);
    for (let i = -3; i <= 3; i++) { const x = cx + i * r * 0.26; ctx.beginPath(); ctx.moveTo(x, cy - ery - 2); ctx.lineTo(x, cy - h + 2); ctx.stroke(); }
    const s = window.Engine.state, fill = s.pools.power.amount / s.pools.power.cap;
    for (let i = 0; i < 3; i++) {
      const on = fill > (i + 0.5) / 3;
      if (on) { ctx.save(); ctx.shadowColor = 'rgba(127,212,232,0.9)'; ctx.shadowBlur = 6; }
      ctx.fillStyle = on ? 'rgba(127,212,232,0.85)' : 'rgba(127,212,232,0.12)';
      ctx.fillRect(cx - r * 0.45 + i * r * 0.45, cy - h * 0.55, r * 0.3, 3);
      if (on) ctx.restore();
    }
  }

  function drawTube(b, g, amb) {
    const { cx, cy, rx } = g;
    const r = rx * 0.7, h = rx * 0.32;
    const m = metalRamp([120, 128, 138], amb);
    ctx.save(); ctx.translate(cx, cy);
    function cap() { ctx.beginPath(); ctx.moveTo(-r, 0); ctx.bezierCurveTo(-r, -h * 1.5, r, -h * 1.5, r, 0); ctx.bezierCurveTo(r * 0.5, TH * 0.7, -r * 0.5, TH * 0.7, -r, 0); ctx.closePath(); }
    const lg = ctx.createLinearGradient(0, -h * 1.5, 0, TH * 0.7);
    lg.addColorStop(0, rgb(m.hi)); lg.addColorStop(0.5, rgb(m.mid)); lg.addColorStop(1, rgb(m.lo));
    cap(); ctx.fillStyle = lg; ctx.fill();
    ctx.save(); cap(); ctx.clip();
    ctx.strokeStyle = rgb(m.dk, 0.55); ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) { const x = i * r * 0.4; ctx.beginPath(); ctx.moveTo(x, -h * 1.5); ctx.lineTo(x, TH * 0.7); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = rgb(m.spec, 0.4); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-r, 0); ctx.bezierCurveTo(-r, -h * 1.5, r, -h * 1.5, r, 0); ctx.stroke();
    ctx.fillStyle = rgb([127, 212, 232], b.connected ? 0.14 : 0.04);
    ctx.beginPath(); ctx.ellipse(0, -h * 0.4, r * 0.4, h * 0.5, 0, 0, 6.28); ctx.fill();
    ctx.restore();
  }

  function drawSolar(b, g, amb) {
    const def = b.def;
    const n = iso(b.gx, b.gy), e = iso(b.gx + def.foot[0], b.gy), s = iso(b.gx + def.foot[0], b.gy + def.foot[1]), w = iso(b.gx, b.gy + def.foot[1]);
    const lift = 12;
    const p = [{ x: n.x, y: n.y - lift }, { x: e.x, y: e.y - lift }, { x: s.x, y: s.y - lift }, { x: w.x, y: w.y - lift }];
    const lit = 0.3 + amb * 0.7;
    ctx.strokeStyle = rgb([70, 78, 88].map((v) => v * lit), 0.9); ctx.lineWidth = 2;
    for (const pt of p) { ctx.beginPath(); ctx.moveTo(pt.x, pt.y); ctx.lineTo(pt.x, pt.y + lift); ctx.stroke(); }
    const out = window.Engine.state.solarMul || 0;
    const baseC = lerpC([18, 24, 36], [44, 66, 96], amb);
    const refl = lerpC(baseC, [150, 205, 235], out * 0.75);
    ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(p[i].x, p[i].y); ctx.closePath();
    ctx.fillStyle = rgb(refl); ctx.fill();
    ctx.strokeStyle = rgb([130, 140, 150].map((v) => v * lit), 0.9); ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(8,14,20,0.55)'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      ctx.beginPath(); ctx.moveTo(p[0].x + (p[1].x - p[0].x) * t, p[0].y + (p[1].y - p[0].y) * t); ctx.lineTo(p[3].x + (p[2].x - p[3].x) * t, p[3].y + (p[2].y - p[3].y) * t); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p[0].x + (p[3].x - p[0].x) * t, p[0].y + (p[3].y - p[0].y) * t); ctx.lineTo(p[1].x + (p[2].x - p[1].x) * t, p[1].y + (p[2].y - p[1].y) * t); ctx.stroke();
    }
  }

    // ---- placement feedback ----------------------------------------------------
  function drawPlacementGuide() {
    const N = window.Engine.state.N;
    ctx.strokeStyle = "rgba(127,212,232,0.10)"; ctx.lineWidth = 1;
    for (let gx = 0; gx <= N; gx++) { const a = iso(gx, 0), b = iso(gx, N); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    for (let gy = 0; gy <= N; gy++) { const a = iso(0, gy), b = iso(N, gy); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  }

  function drawGhost(amb) {
    if (!hover) return;
    if (demolish) {
      const b = window.Engine.buildingAt(hover.gx, hover.gy);
      if (b) for (const [x, y] of window.Engine.cellsFor(b.def, b.gx, b.gy)) { const c = iso(x, y); diamond(c.x, c.y, TW, TH, "rgba(232,120,79,0.32)"); }
      else { const c = iso(hover.gx, hover.gy); diamond(c.x, c.y, TW, TH, "rgba(232,120,79,0.12)"); }
      return;
    }
    if (!placing) { const c = iso(hover.gx, hover.gy); diamond(c.x, c.y, TW, TH, "rgba(127,212,232,0.10)"); return; }
    const def = window.Engine.DEFS[placing];
    const ok = window.Engine.canPlace(placing, hover.gx, hover.gy);
    const col = ok ? "rgba(127,212,232,0.20)" : "rgba(232,120,79,0.20)";
    for (const [x, y] of window.Engine.cellsFor(def, hover.gx, hover.gy)) { const c = iso(x, y); diamond(c.x, c.y, TW, TH, col); }
    // base ring where the structure would sit
    const fw = def.foot[0], fh = def.foot[1];
    const c = iso(hover.gx + (fw - 1) / 2, hover.gy + (fh - 1) / 2);
    const scale = (fw + fh) / 2;
    ctx.strokeStyle = ok ? "rgba(127,212,232,0.7)" : "rgba(232,120,79,0.7)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(c.x, c.y, TW * 0.86 * scale, TH * 0.86 * scale, 0, 0, 6.28); ctx.stroke();
  }

  // ---- atmosphere ------------------------------------------------------------
  function drawDust(nowMs, amb) {
    const storm = window.Engine.state.weather === "dust";
    const intensity = storm ? 1 : 0.18, wind = storm ? 2.6 : 0.7;
    for (const p of dust) {
      p.x += p.v * wind * 0.0016;
      if (p.x > 1.05) { p.x = -0.05; p.y = Math.random(); }
      const px = p.x * W, py = p.y * H;
      const a = intensity * (storm ? 0.5 : 0.22) * (0.3 + 0.7 * (p.s / 2));
      ctx.fillStyle = `rgba(${storm ? "205,145,98" : "150,120,110"},${a})`;
      ctx.fillRect(px, py, p.s, p.s);
    }
  }
  function drawStormVeil(nowMs) {
    ctx.fillStyle = `rgba(150,86,52,${0.12 + 0.07 * Math.sin(nowMs / 1400)})`;
    ctx.fillRect(0, 0, W, H);
  }

  window.Render = {
    init, draw,
    setPlacing(d) { placing = d; demolish = false; },
    setDemolish(v) { demolish = v; placing = null; },
    clearTool() { placing = null; demolish = false; },
    get placing() { return placing; },
    get demolish() { return demolish; },
    onPlaced(fn) { onPlaced = fn; },
    onCancel(fn) { onCancel = fn; },
    resize,
  };
})();
