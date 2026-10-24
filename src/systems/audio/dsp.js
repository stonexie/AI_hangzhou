// Pure-JS DSP toolkit used to synthesize all NEON KAIDO audio buffers at load time.
// No DOM / Web Audio dependencies: runs in a Web Worker, on the main thread, or in Node (for offline analysis).

export const SR = 48000;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Helpers around an rng
export const rr = (rng, a, b) => a + (b - a) * rng();
export const rpick = (rng, arr) => arr[(rng() * arr.length) | 0];
// Gaussian-ish (sum of 3 uniforms)
export const rgauss = (rng) => (rng() + rng() + rng() - 1.5) / 0.5;
// Power-law amplitude: many small, few large. k > 1 → more skew
export const rpow = (rng, k) => Math.pow(rng(), k);
export const dbToGain = (db) => Math.pow(10, db / 20);
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ---------- Biquad (RBJ cookbook) ----------
export class Biquad {
  constructor(type, freq, q = 0.7071, gainDb = 0, sr = SR) {
    this.z1 = 0; this.z2 = 0;
    this.set(type, freq, q, gainDb, sr);
  }
  set(type, freq, q = 0.7071, gainDb = 0, sr = SR) {
    const f = clamp(freq, 5, sr * 0.49);
    const w0 = (2 * Math.PI * f) / sr;
    const cw = Math.cos(w0), sw = Math.sin(w0);
    const alpha = sw / (2 * q);
    const A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break; // 0 dB peak
      case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'peaking': b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
        a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
        a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break;
      }
      default: throw new Error('biquad type ' + type);
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  // Transposed direct form II
  tick(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  run(buf) {
    const { b0, b1, b2, a1, a2 } = this;
    let z1 = this.z1, z2 = this.z2;
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      buf[i] = y;
    }
    // flush denormals
    this.z1 = Math.abs(z1) < 1e-20 ? 0 : z1; this.z2 = Math.abs(z2) < 1e-20 ? 0 : z2;
    return buf;
  }
}

// Apply a filter chain spec [[type,f,q,gain], ...] to a buffer in place.
export function chain(buf, specs, sr = SR) {
  for (const s of specs) new Biquad(s[0], s[1], s[2] ?? 0.7071, s[3] ?? 0, sr).run(buf);
  return buf;
}

// Filter a loop buffer "periodically": run the chain over the buffer twice so the filter state at
// sample 0 equals the state after the loop end → seamless loops for periodic content.
export function chainPeriodic(buf, specs, sr = SR) {
  for (const s of specs) {
    const f = new Biquad(s[0], s[1], s[2] ?? 0.7071, s[3] ?? 0, sr);
    const tmp = Float32Array.from(buf);
    f.run(tmp); // warm-up pass
    f.run(buf);
  }
  return buf;
}

// ---------- Noise ----------
export function white(n, rng) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = rng() * 2 - 1;
  return b;
}
// Paul Kellet's refined pink noise (≈ -3 dB/oct), normalized to ~unit RMS-ish
export function pink(n, rng) {
  const b = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    b[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return b;
}
// Brown noise (leaky integrator, ≈ -6 dB/oct)
export function brown(n, rng, leak = 0.996) {
  const b = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) { y = leak * y + (rng() * 2 - 1) * 0.06; b[i] = y; }
  return b;
}

// Seamless-loop pink noise: Kellet pinking filter run twice over periodic white noise.
export function pinkLoop(n, rng) {
  const w = white(n, rng);
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const x = w[i];
      b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
      b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
      if (pass) out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
      b6 = x * 0.115926;
    }
  }
  return out;
}
// Seamless-loop smooth random control signal in [-1,1]; `rate` = control points per second.
export function smoothRandomLoop(n, rng, rate, sr = SR) {
  const pts = Math.max(2, Math.round((n / sr) * rate));
  const P = new Float32Array(pts);
  for (let i = 0; i < pts; i++) P[i] = rng() * 2 - 1;
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = (i / n) * pts;
    const k = Math.floor(pos), t = pos - k;
    const a = P[k % pts], c = P[(k + 1) % pts];
    b[i] = a + (c - a) * (1 - Math.cos(Math.PI * t)) / 2;
  }
  return b;
}
// Run fn over [b, b] and keep the second half → steady-state periodic processing of a loop.
export function periodic(b, fn) {
  const n = b.length;
  const d = new Float32Array(2 * n);
  d.set(b); d.set(b, n);
  const o = fn(d) || d;
  return o.slice(n);
}

// Smooth random control signal (values in ~[-1,1]) with given rate (Hz), cosine-interpolated.
export function smoothRandom(n, rng, rate, sr = SR) {
  const b = new Float32Array(n);
  const step = Math.max(1, Math.floor(sr / rate));
  let a = rng() * 2 - 1, c = rng() * 2 - 1;
  for (let i = 0; i < n; i++) {
    const k = i % step;
    if (k === 0 && i > 0) { a = c; c = rng() * 2 - 1; }
    const t = k / step;
    const s = (1 - Math.cos(Math.PI * t)) / 2;
    b[i] = a + (c - a) * s;
  }
  return b;
}

// ---------- Buffer ops ----------
export const buf = (sec, sr = SR) => new Float32Array(Math.round(sec * sr));
export function mix(dst, src, gain = 1, offset = 0) {
  const n = Math.min(src.length, dst.length - offset);
  for (let i = 0; i < n; i++) dst[i + offset] += src[i] * gain;
  return dst;
}
// Add src into dst with circular wrap-around (for seamless loops)
export function mixWrap(dst, src, gain, offset) {
  const L = dst.length;
  let o = ((offset % L) + L) % L;
  for (let i = 0; i < src.length; i++) { dst[o] += src[i] * gain; if (++o >= L) o = 0; }
}
export function scale(b, g) { for (let i = 0; i < b.length; i++) b[i] *= g; return b; }
export function mulBuf(b, m) { for (let i = 0; i < b.length; i++) b[i] *= m[i]; return b; }
export function rms(b) { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); }
export function peak(b) { let p = 0; for (let i = 0; i < b.length; i++) { const a = Math.abs(b[i]); if (a > p) p = a; } return p; }
export function removeDC(b) { let m = 0; for (let i = 0; i < b.length; i++) m += b[i]; m /= b.length; for (let i = 0; i < b.length; i++) b[i] -= m; return b; }
export function tanhSat(b, drive = 1) { const k = Math.tanh(drive); for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * drive) / k; return b; }

// Normalize a set of channels so the loudest channel has the target RMS (linear), with a peak ceiling.
export function normalizeRms(chs, targetRms, peakCeil = 0.95) {
  let r = 0, p = 0;
  for (const c of chs) { r = Math.max(r, rms(c)); p = Math.max(p, peak(c)); }
  if (r < 1e-9) return chs;
  let g = targetRms / r;
  if (p * g > peakCeil) g = peakCeil / p;
  for (const c of chs) scale(c, g);
  return chs;
}
export function normalizePeak(chs, target = 0.9) {
  let p = 0; for (const c of chs) p = Math.max(p, peak(c));
  if (p > 1e-9) for (const c of chs) scale(c, target / p);
  return chs;
}

// Turn a buffer of length N+F into a seamless loop of length N via equal-power crossfade of the tail into the head.
export function loopify(b, F) {
  const N = b.length - F;
  const out = b.slice(0, N);
  for (let i = 0; i < F; i++) {
    const t = i / F;
    out[i] = b[i] * Math.sin(t * Math.PI / 2) + b[N + i] * Math.cos(t * Math.PI / 2);
  }
  return out;
}
// Fold a tail (render region beyond loop length) onto the start: exact for event-based content.
export function foldTail(b, N) {
  const out = b.slice(0, N);
  for (let i = N; i < b.length; i++) out[(i - N) % N] += b[i];
  return out;
}

// Fade in/out (linear-ish raised cosine), in seconds
export function fades(b, inSec, outSec, sr = SR) {
  const fi = Math.min(b.length, Math.round(inSec * sr)), fo = Math.min(b.length, Math.round(outSec * sr));
  for (let i = 0; i < fi; i++) b[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fi);
  for (let i = 0; i < fo; i++) b[b.length - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fo);
  return b;
}

// ---------- Grains / events ----------
// Short exponentially decaying noise click, optionally pre-filtered.
export function noiseClick(rng, durSec, tauSec, sr = SR) {
  const n = Math.max(2, Math.round(durSec * sr));
  const b = new Float32Array(n);
  const k = 1 / (tauSec * sr);
  for (let i = 0; i < n; i++) b[i] = (rng() * 2 - 1) * Math.exp(-i * k);
  return b;
}
// Minnaert bubble "ping": sine with rising pitch and exponential decay (drop into water).
export function bubble(f0, tauSec, rise, sr = SR, phase = 0) {
  const dur = tauSec * 6;
  const n = Math.max(2, Math.round(dur * sr));
  const b = new Float32Array(n);
  let ph = phase;
  const att = Math.max(1, Math.round(0.0006 * sr));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = f0 * (1 + rise * t / tauSec);
    ph += (2 * Math.PI * f) / sr;
    const env = Math.exp(-t / tauSec) * (i < att ? i / att : 1);
    b[i] = Math.sin(ph) * env;
  }
  return b;
}
// Decaying sine
export function ping(f, tauSec, sr = SR, durMul = 6) {
  const n = Math.max(2, Math.round(tauSec * durMul * sr));
  const b = new Float32Array(n);
  const w = (2 * Math.PI * f) / sr;
  const att = Math.max(1, Math.round(0.0004 * sr));
  for (let i = 0; i < n; i++) b[i] = Math.sin(w * i) * Math.exp(-i / (tauSec * sr)) * (i < att ? i / att : 1);
  return b;
}

// Two-pole resonator bank (modal synthesis): excitation → sum of resonant modes.
// modes: [[freq, decaySec, gain], ...]
export function modalBank(exc, modes, sr = SR) {
  const out = new Float32Array(exc.length);
  for (const [f, decay, g] of modes) {
    const r = Math.exp(-1 / (decay * sr));
    const w = (2 * Math.PI * f) / sr;
    const a1 = -2 * r * Math.cos(w), a2 = r * r;
    const norm = (1 - r) * g * 2; // roughly unit peak gain
    let y1 = 0, y2 = 0;
    for (let i = 0; i < exc.length; i++) {
      const y = exc[i] * norm - a1 * y1 - a2 * y2;
      y2 = y1; y1 = y;
      out[i] += y;
    }
  }
  return out;
}

// Constant-power pan gains for p in [-1,1]
export function panGains(p) {
  const a = (clamp(p, -1, 1) + 1) * Math.PI / 4;
  return [Math.cos(a), Math.sin(a)];
}

// PolyBLEP sawtooth oscillator into buffer (adds), freq may be a function of time index or a number.
export function addSaw(dst, freq, amp, startIdx, len, phase0 = 0, sr = SR) {
  let ph = phase0;
  const end = Math.min(dst.length, startIdx + len);
  const dt = freq / sr;
  for (let i = Math.max(0, startIdx); i < end; i++) {
    let v = 2 * ph - 1;
    // polyBLEP
    if (ph < dt) { const t = ph / dt; v -= t + t - t * t - 1; }
    else if (ph > 1 - dt) { const t = (ph - 1) / dt; v -= t * t + t + t + 1; }
    dst[i] += v * amp;
    ph += dt; if (ph >= 1) ph -= 1;
  }
  return ph;
}

// Simple Schroeder/Freeverb-ish diffuser for baking small spaces into one-shots (cheap).
export function combDelay(b, delaySec, fb, mixAmt, sr = SR) {
  const d = Math.max(1, Math.round(delaySec * sr));
  const line = new Float32Array(d);
  let idx = 0;
  for (let i = 0; i < b.length; i++) {
    const y = line[idx];
    line[idx] = b[i] + y * fb;
    idx = (idx + 1) % d;
    b[i] += y * mixAmt;
  }
  return b;
}
