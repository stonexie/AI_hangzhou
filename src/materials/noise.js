// Shared TSL noise / tiling helpers (owned by the ground workstream). Pure node-graph functions (no Fn stacks),
// so results can be freely reused across colorNode / roughnessNode / normalNode.
import {
  float, vec2, vec3, vec4, step, fract, floor, sin, cos, dot, mix, smoothstep, abs, max, min, pow, sqrt, texture, dFdx, dFdy, length,
} from 'three/tsl';

// --- hashes (sin-free variants are more stable at large world coords) ------------------------------------
export const hash21 = (p) => {
  const q = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  const d = dot(q, vec3(q.y, q.z, q.x).add(33.33));
  const r = q.add(d);
  return fract(r.x.add(r.y).mul(r.z));
};
export const hash22 = (p) => {
  const q = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.103, 0.0973)));
  const d = dot(q, vec3(q.y, q.z, q.x).add(33.33));
  const r = q.add(d);
  return fract(vec2(r.x.add(r.y).mul(r.z), r.x.add(r.z).mul(r.y)));
};
export const hash23 = (p) => {
  const q = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.103, 0.0973)));
  const d = dot(q, vec3(q.y, q.x, q.z).add(33.33));
  const r = q.add(d);
  return fract(vec3(r.x.add(r.y).mul(r.z), r.x.add(r.x).mul(r.y), r.y.add(r.x).mul(r.x)));
};

// --- value noise (0..1), smooth -------------------------------------------------------------------------
export const vnoise = (p) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const a = hash21(i);
  const b = hash21(i.add(vec2(1, 0)));
  const c = hash21(i.add(vec2(0, 1)));
  const d = hash21(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
};
export const fbm = (p, oct = 4, lac = 2.03, gain = 0.5) => {
  let s = float(0); let a = 0.5; let q = p; let norm = 0;
  for (let i = 0; i < oct; i++) {
    s = s.add(vnoise(q).mul(a)); norm += a;
    q = vec2(q.x.mul(0.8).sub(q.y.mul(0.6)), q.x.mul(0.6).add(q.y.mul(0.8))).mul(lac).add(17.3 * (i + 1));
    a *= gain;
  }
  return s.div(norm);
};

// Antialiased band mask: 1 where |x| < halfWidth (x in same units as halfWidth)
export const aaBand = (x, halfWidth) => {
  const w = max(abs(dFdx(x)).add(abs(dFdy(x))), 1e-5);
  return smoothstep(w.negate(), w, float(halfWidth).sub(abs(x)));
};
// Antialiased step: 1 where x > 0
export const aaStep = (x) => {
  const w = max(abs(dFdx(x)).add(abs(dFdy(x))), 1e-5);
  return smoothstep(w.mul(-0.5), w.mul(0.5), x);
};

// --- Hex tiling (Mikkelsen 2022) -------------------------------------------------------------------------
// Returns 3 tap descriptors { uv, dx, dy, w, cs } for texture coords `uv` (in texture repeats).
// Each hex vertex gets a random offset + rotation; sample all textures with the same taps.
export function hexTaps(uv, { scale = 1.6, rotate = true, sharp = 6 } = {}) {
  const st = uv.mul(scale * 2 * Math.sqrt(3));
  const sk = vec2(st.x.sub(st.y.mul(0.57735027)), st.y.mul(1.15470054));
  const base = floor(sk);
  const f = fract(sk);
  const tz = float(1).sub(f.x).sub(f.y);
  const s = step(float(0), tz.negate()); // 1 when tz<=0
  const s2 = s.mul(2).sub(1);
  const w1 = tz.negate().mul(s2);
  const w2 = s.sub(f.y.mul(s2));
  const w3 = s.sub(f.x.mul(s2));
  const v1 = base.add(vec2(s, s));
  const v2 = base.add(vec2(s, s.oneMinus()));
  const v3 = base.add(vec2(s.oneMinus(), s));
  const dx = dFdx(uv), dy = dFdy(uv);
  const taps = [[v1, w1], [v2, w2], [v3, w3]].map(([v, w]) => {
    const h = hash23(v.add(0.5));
    const ang = rotate ? h.z.mul(6.2831853) : float(0);
    const cs = vec2(cos(ang), sin(ang));
    const rot = (q) => vec2(q.x.mul(cs.x).sub(q.y.mul(cs.y)), q.x.mul(cs.y).add(q.y.mul(cs.x)));
    return { uv: rot(uv).add(h.xy.mul(7.0)), dx: rot(dx), dy: rot(dy), w: pow(max(w, 0), sharp), cs };
  });
  const sum = taps[0].w.add(taps[1].w).add(taps[2].w).max(1e-5);
  taps.forEach((t) => { t.w = t.w.div(sum); });
  return taps;
}

// Sample colour+packed-normal textures with hex taps. Returns { color: vec3, nxy: vec2 (tangent, -1..1, uv frame), h }
export function hexSample(taps, texC, texN) {
  let col = vec3(0); let nxy = vec2(0); let h = float(0);
  for (const t of taps) {
    const c = texture(texC, t.uv).grad(t.dx, t.dy).rgb;
    const n = texture(texN, t.uv).grad(t.dx, t.dy);
    // unrotate normal xy back into uv frame
    const nx = n.r.mul(2).sub(1), ny = n.g.mul(2).sub(1);
    const un = vec2(nx.mul(t.cs.x).add(ny.mul(t.cs.y)), ny.mul(t.cs.x).sub(nx.mul(t.cs.y)));
    col = col.add(c.mul(t.w)); nxy = nxy.add(un.mul(t.w)); h = h.add(n.b.mul(t.w));
  }
  return { color: col, nxy, h };
}

// Plain (non hex) sample of a colour + packed normal pair
export function pairSample(texC, texN, uv) {
  const c = texture(texC, uv);
  const n = texture(texN, uv);
  return { color: c.rgb, nxy: n.rg.mul(2).sub(1), h: n.b };
}

// Sample with explicit gradients (for discontinuous uv e.g. per-tile shuffles)
export function pairSampleGrad(texC, texN, uv, dx, dy) {
  const c = texture(texC, uv).grad(dx, dy);
  const n = texture(texN, uv).grad(dx, dy);
  return { color: c.rgb, nxy: n.rg.mul(2).sub(1), h: n.b };
}

export const luma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
export { length, sqrt, min, vec4 };

// World-space XZ slope of an arbitrary scalar height node on a horizontal surface, via screen derivatives.
// Returns vec2 (dh/dx, dh/dz). Use nxy = slope.negate() for a normal perturbation.
export function slopeFromHeight(h, P) {
  const px = dFdx(P), py = dFdy(P);
  const hx = dFdx(h), hy = dFdy(h);
  const det = px.x.mul(py.y).sub(px.y.mul(py.x));
  const sdet = det.abs().max(1e-9).mul(det.sign().add(0.0001).sign());
  const gx = hx.mul(py.y).sub(hy.mul(px.y)).div(sdet);
  const gz = hy.mul(px.x).sub(hx.mul(py.x)).div(sdet);
  return vec2(gx, gz);
}

// Signed distance to an axis aligned box (centered), 2D
export const sdBox2 = (p, b) => {
  const d = abs(p).sub(b);
  return length(max(d, 0)).add(min(max(d.x, d.y), 0));
};
