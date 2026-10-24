// Rotating CP2077-style minimap: static city map pre-rendered from LAYOUT, road-graph route to the active gig.
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const X0 = -280, X1 = 300, Z0 = -740, Z1 = 160, S = 3; // px per meter in the static map

export class Minimap {
  constructor(L, canvas, lots) {
    this.L = L;
    this.lots = lots;
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.map = this.buildStatic();
    this.graph = this.buildGraph();
    this.route = null;
    this.routeT = 0;
    this.scale = 1.7; // css px per meter
  }

  px(x) { return (x - X0) * S; }
  pz(z) { return (z - Z0) * S; }

  buildStatic() {
    const L = this.L;
    const c = document.createElement('canvas');
    c.width = (X1 - X0) * S; c.height = (Z1 - Z0) * S;
    const g = c.getContext('2d');
    const R = (x0, z0, x1, z1, col) => { g.fillStyle = col; g.fillRect(this.px(Math.min(x0, x1)), this.pz(Math.min(z0, z1)), Math.abs(x1 - x0) * S, Math.abs(z1 - z0) * S); };
    g.fillStyle = '#050c0f'; g.fillRect(0, 0, c.width, c.height);
    // built-up district base
    R(-230, 90, L.promenade.xMin - 2, -460, '#0a171b');
    R(L.river.xCenter + L.river.halfWidth + 4, 120, 290, -720, '#09151a');
    // lots (seeded)
    const rnd = mulberry32(7);
    const lot = (x0, x1, z0, z1) => {
      for (let x = x0; x < x1;) {
        const w = 12 + rnd() * 22;
        for (let z = z0; z < z1;) {
          const d = 10 + rnd() * 24;
          const v = rnd();
          g.fillStyle = v > 0.92 ? '#1b3940' : v > 0.6 ? '#14292f' : '#112328';
          g.fillRect(this.px(x + 1.4), this.pz(z + 1.4), (Math.min(w, x1 - x) - 2.8) * S, (Math.min(d, z1 - z) - 2.8) * S);
          z += d;
        }
        x += w;
      }
    };
    const real = this.lots && this.lots.length > 20;
    if (real) {
      // real building footprints from the buildings system, shaded by height
      const sorted = [...this.lots].sort((a, b) => a.h - b.h);
      for (const b of sorted) {
        const k = Math.min(1, (b.h || 12) / 70);
        const r = Math.round(16 + k * 22), gg = Math.round(34 + k * 34), bb = Math.round(40 + k * 36);
        g.fillStyle = `rgb(${r},${gg},${bb})`;
        const x0 = Math.min(b.x0, b.x1), z0 = Math.min(b.z0, b.z1);
        const w = Math.abs(b.x1 - b.x0), d = Math.abs(b.z1 - b.z0);
        g.fillRect(this.px(x0 + 0.5), this.pz(z0 + 0.5), (w - 1) * S, (d - 1) * S);
        g.strokeStyle = `rgba(94,246,255,${0.06 + k * 0.14})`; g.lineWidth = 1;
        g.strokeRect(this.px(x0 + 0.5), this.pz(z0 + 0.5), (w - 1) * S, (d - 1) * S);
      }
    } else {
      lot(-230, L.promenade.xMin - 3, -460, 90);
      lot(L.river.xCenter + L.river.halfWidth + 5, 290, -720, 120);
    }
    // river + promenade
    const rv = L.river;
    const grad = g.createLinearGradient(this.px(rv.xCenter - rv.halfWidth), 0, this.px(rv.xCenter + rv.halfWidth), 0);
    grad.addColorStop(0, '#0b3442'); grad.addColorStop(0.5, '#0e4252'); grad.addColorStop(1, '#0b3442');
    g.fillStyle = grad;
    g.fillRect(this.px(rv.xCenter - rv.halfWidth), this.pz(rv.zEnd), rv.halfWidth * 2 * S, (rv.zStart - rv.zEnd) * S);
    g.strokeStyle = 'rgba(94,246,255,.35)'; g.lineWidth = 2;
    g.strokeRect(this.px(rv.xCenter - rv.halfWidth), this.pz(rv.zEnd), rv.halfWidth * 2 * S, (rv.zStart - rv.zEnd) * S);
    const pr = L.promenade;
    R(pr.xMin, pr.zStart, pr.xMax, pr.zEnd, '#26343a');
    // cherry trees dots
    g.fillStyle = 'rgba(255,127,200,.55)';
    for (let z = pr.zStart - 6; z > pr.zEnd; z -= 11) { g.beginPath(); g.arc(this.px(pr.xMax - 2), this.pz(z), 2.2 * S, 0, 7); g.fill(); }
    // roads (sidewalk then asphalt)
    const av = L.avenue, cs = L.crossStreets, al = L.alley;
    const SW = '#2a4249', RD = '#36565e';
    R(av.x - av.roadHalfWidth - av.sidewalkWidth, av.zStart, av.x + av.roadHalfWidth + av.sidewalkWidth, av.zEnd, SW);
    for (const z of cs.zs) R(cs.xStart, z - cs.roadHalfWidth - cs.sidewalkWidth, cs.xEnd, z + cs.roadHalfWidth + cs.sidewalkWidth, SW);
    R(av.x - av.roadHalfWidth, av.zStart, av.x + av.roadHalfWidth, av.zEnd, RD);
    for (const z of cs.zs) R(cs.xStart, z - cs.roadHalfWidth, cs.xEnd, z + cs.roadHalfWidth, RD);
    // lane markings
    g.strokeStyle = 'rgba(200,230,235,.18)'; g.lineWidth = 1; g.setLineDash([3 * S, 3 * S]);
    g.beginPath(); g.moveTo(this.px(av.x), this.pz(av.zStart)); g.lineTo(this.px(av.x), this.pz(av.zEnd)); g.stroke();
    for (const z of cs.zs) { g.beginPath(); g.moveTo(this.px(cs.xStart), this.pz(z)); g.lineTo(this.px(cs.xEnd), this.pz(z)); g.stroke(); }
    g.setLineDash([]);
    // alley + stairs
    R(al.xStart, al.z - al.width / 2, al.xEnd, al.z + al.width / 2, '#3a2a2c');
    g.strokeStyle = 'rgba(255,97,88,.55)'; g.lineWidth = 1;
    for (let x = al.stairs.xStart; x > al.stairs.xEnd; x -= 1.2) { g.beginPath(); g.moveTo(this.px(x), this.pz(al.z - al.width / 2)); g.lineTo(this.px(x), this.pz(al.z + al.width / 2)); g.stroke(); }
    // lantern dots along the alley
    g.fillStyle = 'rgba(255,90,60,.8)';
    for (let x = al.xStart - 4; x > al.xEnd; x -= 6) { g.beginPath(); g.arc(this.px(x), this.pz(al.z + (x % 12 ? 1.6 : -1.6)), 0.6 * S, 0, 7); g.fill(); }
    // bridge
    for (const b of L.bridges) R(pr.xMin, b.z - 5, rv.xCenter + rv.halfWidth + 10, b.z + 5, '#3d5a62');
    // elevated rail + expressway (overpasses)
    const er = L.elevatedRail, ex = L.expressway;
    g.fillStyle = 'rgba(94,246,255,.10)';
    g.fillRect(this.px(X0), this.pz(er.z - er.width / 2), (X1 - X0) * S, er.width * S);
    g.fillStyle = 'rgba(94,246,255,.08)';
    g.fillRect(this.px(X0), this.pz(ex.z - ex.width / 2), (X1 - X0) * S, ex.width * S);
    g.strokeStyle = 'rgba(94,246,255,.35)'; g.setLineDash([6, 4]);
    for (const [z, w] of [[er.z, er.width], [ex.z, ex.width]]) {
      g.beginPath(); g.moveTo(0, this.pz(z - w / 2)); g.lineTo(c.width, this.pz(z - w / 2)); g.stroke();
      g.beginPath(); g.moveTo(0, this.pz(z + w / 2)); g.lineTo(c.width, this.pz(z + w / 2)); g.stroke();
    }
    g.setLineDash([]);
    // overlook building highlight
    const ov = L.overlook.position;
    g.strokeStyle = 'rgba(94,246,255,.6)'; g.lineWidth = 2;
    g.strokeRect(this.px(ov[0] - 8), this.pz(ov[2] - 8), 16 * S, 16 * S);
    return c;
  }

  buildGraph() {
    const L = this.L;
    const nodes = []; const edges = [];
    const N = (x, z) => { const i = nodes.findIndex((n) => Math.abs(n[0] - x) < 0.5 && Math.abs(n[1] - z) < 0.5); if (i >= 0) return i; nodes.push([x, z]); return nodes.length - 1; };
    const chain = (pts) => { for (let i = 0; i < pts.length - 1; i++) edges.push([N(...pts[i]), N(...pts[i + 1])]); };
    const av = L.avenue, cs = L.crossStreets, al = L.alley, pr = L.promenade, px = (pr.xMin + pr.xMax) / 2;
    const az = [av.zStart, -60, al.z, -180, -300, av.zEnd].sort((a, b) => b - a);
    chain(az.map((z) => [av.x, z]));
    for (const z of cs.zs) chain([[cs.xStart, z], [al.xEnd, z], [av.x, z], [px, z], [cs.xEnd, z]]);
    chain([[av.x, al.z], [al.xStart, al.z], [al.stairs.xStart, al.z], [al.stairs.xEnd, al.z], [al.xEnd, al.z]]);
    chain([[px, pr.zStart], [px, -60], [px, -120], [px, -180], [px, L.bridges[0].z], [px, -300], [px, pr.zEnd]]);
    for (const b of L.bridges) chain([[px, b.z], [L.river.xCenter + L.river.halfWidth + 8, b.z]]);
    return { nodes, edges };
  }

  project(p) {
    const { nodes, edges } = this.graph;
    let best = null;
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = edges[i]; const A = nodes[a], B = nodes[b];
      const dx = B[0] - A[0], dz = B[1] - A[1]; const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - A[0]) * dx + (p[1] - A[1]) * dz) / l2));
      const q = [A[0] + dx * t, A[1] + dz * t];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (!best || d < best.d) best = { d, q, e: i, a, b };
    }
    return best;
  }

  computeRoute(from, to) {
    const { nodes, edges } = this.graph;
    const s = this.project(from), t = this.project(to);
    if (!s || !t) return [from, to];
    if (s.e === t.e) return [from, s.q, t.q, to];
    const n = nodes.length; const S0 = n, T0 = n + 1;
    const pos = (i) => (i === S0 ? s.q : i === T0 ? t.q : nodes[i]);
    const adj = Array.from({ length: n + 2 }, () => []);
    const link = (a, b) => { const d = Math.hypot(pos(a)[0] - pos(b)[0], pos(a)[1] - pos(b)[1]); adj[a].push([b, d]); adj[b].push([a, d]); };
    edges.forEach(([a, b]) => link(a, b));
    link(S0, s.a); link(S0, s.b); link(T0, t.a); link(T0, t.b);
    const dist = new Array(n + 2).fill(Infinity), prev = new Array(n + 2).fill(-1), done = new Array(n + 2).fill(false);
    dist[S0] = 0;
    for (;;) {
      let u = -1; for (let i = 0; i < n + 2; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] === Infinity || u === T0) break;
      done[u] = true;
      for (const [v, w] of adj[u]) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
    }
    const path = [];
    for (let u = T0; u >= 0; u = prev[u]) path.unshift(pos(u));
    return [from, ...path, to];
  }

  draw(dt, player, yaw, target, opts = {}) {
    const cv = this.canvas, g = this.g;
    const dpr = opts.dpr || 1;
    const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const targetScale = (opts.car ? 1.05 : 1.75) * dpr;
    this.scale += (targetScale - this.scale) * Math.min(1, dt * 3);
    const k = this.scale / S;
    const rot = opts.rotate === false ? 0 : yaw;
    const cx = W / 2, cy = H * 0.56;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#04090b'; g.fillRect(0, 0, W, H);
    g.save();
    g.translate(cx, cy); g.rotate(rot); g.scale(k, k);
    g.translate(-this.px(player.x), -this.pz(player.z));
    g.imageSmoothingEnabled = true;
    g.drawImage(this.map, 0, 0);
    // route
    if (target) {
      this.routeT -= dt;
      if (!this.route || this.routeT <= 0) { this.route = this.computeRoute([player.x, player.z], [target.x, target.z]); this.routeT = 0.4; }
      this.route[0] = [player.x, player.z];
      g.strokeStyle = 'rgba(223,190,127,.95)'; g.lineWidth = (2.6 * dpr) / k; g.lineCap = 'round'; g.lineJoin = 'round';
      g.setLineDash([2 * dpr / k, 6 * dpr / k]);
      g.lineDashOffset = -performance.now() * 0.02 * dpr / k;
      g.shadowColor = 'rgba(223,190,127,.75)'; g.shadowBlur = 6 * dpr;
      g.beginPath(); this.route.forEach((p, i) => (i ? g.lineTo(this.px(p[0]), this.pz(p[1])) : g.moveTo(this.px(p[0]), this.pz(p[1])))); g.stroke();
      g.setLineDash([]); g.shadowBlur = 0;
    }
    g.restore();

    // POIs drawn in screen space (stay upright, clamp to edge)
    const toScreen = (x, z) => {
      const dx = (x - player.x) * this.scale, dz = (z - player.z) * this.scale;
      const c = Math.cos(rot), s = Math.sin(rot);
      return [cx + dx * c - dz * s, cy + dx * s + dz * c];
    };
    const clampEdge = (p, m) => {
      const x = Math.max(m, Math.min(W - m, p[0])), y = Math.max(m, Math.min(H - m, p[1]));
      return [[x, y], x !== p[0] || y !== p[1]];
    };
    for (const poi of opts.pois || []) {
      const [p] = clampEdge(toScreen(poi.x, poi.z), 10 * dpr);
      g.fillStyle = poi.color || 'rgba(138,190,178,.9)';
      g.beginPath(); g.arc(p[0], p[1], 3 * dpr, 0, 7); g.fill();
    }
    if (target) {
      const [p, edge] = clampEdge(toScreen(target.x, target.z), 14 * dpr);
      const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.15;
      g.save(); g.translate(p[0], p[1]); g.rotate(Math.PI / 4); g.scale(pulse, pulse);
      g.shadowColor = '#dfbe7f'; g.shadowBlur = 10 * dpr;
      g.fillStyle = edge ? 'rgba(223,190,127,.85)' : '#dfbe7f';
      const r = 6 * dpr; g.fillRect(-r, -r, 2 * r, 2 * r);
      g.fillStyle = '#b83b2b'; g.fillRect(-r * 0.4, -r * 0.4, r * 0.8, r * 0.8);
      g.restore();
    }
    // player: view cone + arrow
    const heading = rot - yaw; // 0 when rotating map
    g.save(); g.translate(cx, cy); g.rotate(-heading);
    const cone = g.createRadialGradient(0, 0, 0, 0, 0, 70 * dpr);
    cone.addColorStop(0, 'rgba(223,190,127,.26)'); cone.addColorStop(1, 'rgba(223,190,127,0)');
    g.fillStyle = cone; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 70 * dpr, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); g.closePath(); g.fill();
    g.shadowColor = 'rgba(223,190,127,.85)'; g.shadowBlur = 8 * dpr;
    g.fillStyle = opts.car ? '#dfbe7f' : '#f5efe2';
    const a = 9 * dpr;
    g.beginPath(); g.moveTo(0, -a); g.lineTo(a * 0.72, a * 0.8); g.lineTo(0, a * 0.38); g.lineTo(-a * 0.72, a * 0.8); g.closePath(); g.fill();
    g.restore();
    // edge vignette
    const vg = g.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, cx, cy, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(10,13,16,0)'); vg.addColorStop(1, 'rgba(10,13,16,.75)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    return { cx, cy, rot };
  }
}
