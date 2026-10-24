// Procedural sound recipes for NEON KAIDO. Each recipe returns { channels: Float32Array[], loop: boolean }.
// Loops are made seamless by construction (periodic filtering + wrap-around event placement), so no crossfade dips.
// Pure JS: runs in a worker (synth.worker.js) or in Node for offline analysis (tools/analyze-layers.mjs).
import {
  SR, mulberry32, rr, rpow, rgauss, clamp, Biquad, chain, chainPeriodic, white, pink, pinkLoop, brown,
  smoothRandomLoop, periodic, mix, mixWrap, scale, tanhSat, normalizeRms, normalizePeak, removeDC, loopify,
  fades, noiseClick, bubble, ping, modalBank, panGains, addSaw, foldTail,
} from './dsp.js';

const LOOP_RMS = 0.12; // all loops normalized to this RMS; mix levels live in the runtime (layers.js)
const N = (sec) => Math.round(sec * SR);

// Tiny broadband impulse (2-4 samples) used to excite modal banks
function impulse(dst, pos, amp, rng) {
  const L = dst.length;
  for (let k = 0; k < 3; k++) dst[(pos + k) % L] += amp * (k === 0 ? 1 : (rng() * 2 - 1) * 0.5);
}

function filt(b, specs) { return chain(b, specs); }

// ------------------------------------------------------------------ REVERB IR
// Urban street-canyon impulse response: discrete wall reflections + flutter between facades + diffuse tail
// with frequency-dependent decay (highs die faster, wet asphalt + concrete).
function reverbIR() {
  const rng = mulberry32(101);
  const n = N(3.2);
  const chs = [];
  for (let ch = 0; ch < 2; ch++) {
    const lo = filt(white(n, rng), [['lowpass', 450, 0.6]]);
    const mid = filt(white(n, rng), [['highpass', 450, 0.6], ['lowpass', 3500, 0.6]]);
    const hi = filt(white(n, rng), [['highpass', 3500, 0.6]]);
    const out = new Float32Array(n);
    const pre = N(0.012), ramp = N(0.06);
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / SR;
      const e = (T) => Math.exp((-6.91 * t) / T);
      const r = Math.min(1, (i - pre) / ramp);
      out[i] = (lo[i] * e(2.4) * 1.2 + mid[i] * e(1.7) * 0.9 + hi[i] * e(0.7) * 0.55) * r * r;
    }
    // early reflections (asymmetric per channel)
    for (let k = 0; k < 18; k++) {
      const t = 0.006 + rng() * 0.11;
      const a = (0.5 + rng() * 0.5) * Math.exp(-t / 0.08) * 1.6;
      const c = filt(noiseClick(rng, 0.004, 0.0008), [['lowpass', 5000 - t * 20000, 0.7]]);
      mix(out, c, a * (rng() < 0.5 ? -1 : 1), N(t));
    }
    // flutter echo between facades ~22 m apart (64 ms round trip)
    for (let k = 1; k < 9; k++) {
      const t = 0.064 * k + (ch ? 0.003 : 0) + rgauss(rng) * 0.0015;
      const c = filt(noiseClick(rng, 0.006, 0.001), [['bandpass', 1400, 0.8]]);
      mix(out, c, 0.5 * Math.pow(0.62, k), N(t));
    }
    fades(out, 0, 0.3);
    chs.push(out);
  }
  normalizePeak(chs, 0.9);
  return { channels: chs, loop: false };
}

// ------------------------------------------------------------------ RAIN
// Wide distant rain bed: the city-wide roar of rain on roofs/streets. Pink body + dense micro-drop texture,
// spectrally shaped: gentle low-mid body, presence 2–6 kHz, rolled-off air band. Slow gust modulation.
function rainFar() {
  const rng = mulberry32(201);
  const n = N(14);
  const gust = smoothRandomLoop(n, rng, 0.35);
  const chs = [];
  for (let ch = 0; ch < 2; ch++) {
    const base = pinkLoop(n, rng);
    chainPeriodic(base, [['highpass', 70, 0.7], ['peaking', 350, 0.9, 1.5], ['peaking', 3200, 0.7, 3.5], ['highshelf', 7000, 0.7, -5], ['lowpass', 11000, 0.7]]);
    // dense micro drops (texture)
    const crack = new Float32Array(n);
    const count = Math.round((n / SR) * 2600);
    for (let k = 0; k < count; k++) {
      const p = (rng() * n) | 0;
      crack[p] += (rng() < 0.5 ? -1 : 1) * rpow(rng, 3);
    }
    const crk = chainPeriodic(crack, [['highpass', 1200, 0.7], ['peaking', 4200, 0.9, 3], ['lowpass', 9000, 0.7]]);
    const local = smoothRandomLoop(n, rng, 1.3);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const g = 1 + 0.2 * gust[i] + 0.07 * local[i];
      out[i] = (base[i] + crk[i] * 2.2) * g;
    }
    chs.push(out);
  }
  normalizeRms(chs, LOOP_RMS);
  return { channels: chs, loop: true };
}

// Close rain on asphalt/pavement: dense individual impacts → crisp, sparkly, 2–8 kHz centric.
function rainNear() {
  const rng = mulberry32(202);
  const n = N(11.3);
  const chs = [];
  for (let ch = 0; ch < 2; ch++) {
    const out = new Float32Array(n);
    const count = Math.round((n / SR) * 700);
    for (let k = 0; k < count; k++) {
      const a = rpow(rng, 2.6);
      const c = noiseClick(rng, 0.004, rr(rng, 0.00025, 0.0011));
      mixWrap(out, c, a, (rng() * n) | 0);
    }
    const bed = pinkLoop(n, rng);
    chainPeriodic(bed, [['highpass', 1500, 0.7]]);
    mix(out, bed, 0.35);
    const shaped = chainPeriodic(out, [['highpass', 500, 0.6], ['peaking', 3000, 0.7, 3], ['highshelf', 6500, 0.7, -6], ['lowpass', 12000, 0.7]]);
    chs.push(shaped);
  }
  normalizeRms(chs, LOOP_RMS);
  return { channels: chs, loop: true };
}

// Close distinct droplets & puddle plinks around the listener (stereo scattered).
function droplets() {
  const rng = mulberry32(203);
  const n = N(9.7);
  const L = new Float32Array(n), R = new Float32Array(n);
  const count = Math.round((n / SR) * 26);
  for (let k = 0; k < count; k++) {
    const pos = (rng() * n) | 0;
    const a = 0.25 + 0.75 * rpow(rng, 2);
    const [gl, gr] = panGains(rr(rng, -1, 1));
    const ev = new Float32Array(N(0.12));
    const click = filt(noiseClick(rng, 0.005, rr(rng, 0.0004, 0.0016)), [['bandpass', rr(rng, 1800, 6000), 0.9]]);
    mix(ev, click, 1.0);
    const kind = rng();
    if (kind < 0.45) mix(ev, bubble(rr(rng, 1300, 4200), rr(rng, 0.003, 0.011), rr(rng, 0.05, 0.3)), 0.45, N(0.001));
    else if (kind < 0.52) {
      mix(ev, bubble(rr(rng, 500, 1100), rr(rng, 0.012, 0.025), 0.3), 0.6, N(0.002));
      mix(ev, filt(noiseClick(rng, 0.05, 0.012), [['bandpass', 1500, 0.7]]), 0.5);
    }
    mixWrap(L, ev, a * gl, pos); mixWrap(R, ev, a * gr, pos);
  }
  const chs = [L, R].map((c) => chainPeriodic(c, [['highpass', 200, 0.7], ['highshelf', 8000, 0.7, -3]]));
  normalizeRms(chs, LOOP_RMS * 0.8);
  return { channels: chs, loop: true };
}

// Rain on thin sheet metal / corrugated awning + heavy drips off the edge onto the pavement.
function metalPatter() {
  const rng = mulberry32(204);
  const n = N(8.9);
  const L = new Float32Array(n), R = new Float32Array(n);
  // Thin sheets have dense inharmonic modal spectra: many short, low-Q modes read as "tinny tick", not as a tone.
  const sheet = (fmin, fmax, count, dmin, dmax) => Array.from({ length: count }, () => {
    const f = fmin * Math.pow(fmax / fmin, rng());
    return [f, rr(rng, dmin, dmax), Math.pow(fmin / f, 0.35) * rr(rng, 0.5, 1)];
  });
  const panels = [
    { pan: -0.55, rate: 34, modes: sheet(700, 7500, 16, 0.006, 0.022) },
    { pan: 0.45, rate: 28, modes: sheet(550, 6500, 16, 0.007, 0.025) },
    { pan: 0.0, rate: 45, modes: sheet(260, 3200, 12, 0.008, 0.03) }, // corrugated awning, duller
  ];
  for (const p of panels) {
    const exc = new Float32Array(n);
    const count = Math.round((n / SR) * p.rate);
    for (let k = 0; k < count; k++) impulse(exc, (rng() * n) | 0, 0.2 + 0.8 * rpow(rng, 2), rng);
    const ring = periodic(exc, (d) => modalBank(d, p.modes));
    const tick = chainPeriodic(Float32Array.from(exc), [['highpass', 3000, 0.7]]);
    const [gl, gr] = panGains(p.pan);
    for (let i = 0; i < n; i++) { const v = ring[i] * 0.9 + tick[i] * 0.4; L[i] += v * gl; R[i] += v * gr; }
  }
  // edge drips → splats on pavement
  const drips = Math.round((n / SR) * 3.2);
  for (let k = 0; k < drips; k++) {
    const pos = (rng() * n) | 0;
    const ev = new Float32Array(N(0.12));
    mix(ev, bubble(rr(rng, 600, 1400), rr(rng, 0.008, 0.02), 0.25), 0.5);
    mix(ev, filt(noiseClick(rng, 0.03, 0.005), [['bandpass', rr(rng, 900, 2000), 0.8]]), 0.8);
    const [gl, gr] = panGains(rr(rng, -0.7, 0.7));
    const a = rr(rng, 0.4, 1);
    mixWrap(L, ev, a * gl, pos); mixWrap(R, ev, a * gr, pos);
  }
  const chs = [L, R].map((c) => chainPeriodic(c, [['highpass', 150, 0.7], ['lowpass', 10000, 0.7]]));
  normalizeRms(chs, LOOP_RMS);
  return { channels: chs, loop: true };
}

// Rain drumming on a car roof heard from inside: low panel modes + glassy windshield ticks, muffled.
function carRoof() {
  const rng = mulberry32(205);
  const n = N(7.9);
  const roofModes = [[95, 0.05, 1], [148, 0.045, 0.9], [213, 0.04, 0.8], [307, 0.035, 0.6], [452, 0.03, 0.45], [690, 0.02, 0.3], [1150, 0.012, 0.2]];
  const glassModes = [[1850, 0.012, 1], [2650, 0.01, 0.7], [3900, 0.008, 0.5], [5200, 0.006, 0.3]];
  const chs = [];
  const wash = chainPeriodic(white(n, rng), [['lowpass', 260, 0.7], ['lowpass', 260, 0.7]]);
  for (let ch = 0; ch < 2; ch++) {
    const exc = new Float32Array(n);
    for (let k = 0, c = Math.round((n / SR) * 170); k < c; k++) impulse(exc, (rng() * n) | 0, 0.15 + 0.85 * rpow(rng, 2.5), rng);
    const roof = periodic(exc, (d) => modalBank(d, roofModes));
    const tick = chainPeriodic(Float32Array.from(exc), [['bandpass', 2400, 0.8]]);
    const gexc = new Float32Array(n);
    for (let k = 0, c = Math.round((n / SR) * 45); k < c; k++) impulse(gexc, (rng() * n) | 0, rpow(rng, 2), rng);
    const glass = periodic(gexc, (d) => modalBank(d, glassModes));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = roof[i] * 1.0 + tick[i] * 0.5 + glass[i] * 0.6 + wash[i] * 1.2;
    chs.push(chainPeriodic(out, [['highpass', 45, 0.7], ['peaking', 1200, 0.8, 4], ['lowpass', 6000, 0.7]]));
  }
  normalizeRms(chs, LOOP_RMS);
  return { channels: chs, loop: true };
}

// Gutter / downpipe trickle: stream of bubbles + gurgling flow with pipe resonance (mono, positional).
function gutter() {
  const rng = mulberry32(206);
  const n = N(6.1);
  const out = new Float32Array(n);
  const count = Math.round((n / SR) * 75);
  for (let k = 0; k < count; k++) {
    const f = 350 * Math.exp(rng() * 1.5);
    mixWrap(out, bubble(f, rr(rng, 0.004, 0.018), rr(rng, 0.1, 0.6), SR, rng() * 6), 0.2 + 0.8 * rpow(rng, 1.5), (rng() * n) | 0);
  }
  const flow = chainPeriodic(pinkLoop(n, rng), [['bandpass', 700, 0.7]]);
  const mod = smoothRandomLoop(n, rng, 6);
  for (let i = 0; i < n; i++) out[i] += flow[i] * (0.6 + 0.4 * mod[i]) * 0.9;
  for (let k = 0, c = Math.round((n / SR) * 4); k < c; k++) {
    mixWrap(out, filt(noiseClick(rng, 0.03, 0.006), [['bandpass', 2500, 0.8]]), rr(rng, 0.2, 0.6), (rng() * n) | 0);
  }
  const shaped = chainPeriodic(out, [['highpass', 120, 0.7], ['peaking', 260, 4, 4], ['lowpass', 7000, 0.7]]);
  const chs = [shaped];
  normalizeRms(chs, LOOP_RMS);
  return { channels: chs, loop: true };
}

// ------------------------------------------------------------------ CITY
// Distant traffic bed: sub rumble of the city + wet-tyre hiss pass-bys sweeping across the stereo field.
function trafficBed() {
  const rng = mulberry32(301);
  const n = N(23);
  const shared = chainPeriodic(white(n, rng), [['lowpass', 150, 0.7], ['lowpass', 150, 0.7], ['highpass', 22, 0.7]]);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let ch = 0; ch < 2; ch++) {
    const own = chainPeriodic(white(n, rng), [['lowpass', 180, 0.7], ['lowpass', 180, 0.7], ['highpass', 22, 0.7]]);
    const dst = ch ? R : L;
    for (let i = 0; i < n; i++) dst[i] = shared[i] * 0.75 + own[i] * 0.4;
  }
  scale(L, 6); scale(R, 6);
  const passbys = 15;
  for (let k = 0; k < passbys; k++) {
    const w = rr(rng, 1.2, 3.5);
    const len = N(w * 5);
    const tc = len / 2;
    const dir = rng() < 0.5 ? -1 : 1;
    const amp = 0.15 + 0.85 * rpow(rng, 2);
    const hiss = filt(pink(len, rng), [['bandpass', rr(rng, 1300, 2500), 0.55], ['lowpass', 6000, 0.7]]);
    const eng = new Float32Array(len);
    const f0 = rr(rng, 35, 75);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const x = (i - tc) / (w * SR);
      const f = f0 * (1 - 0.04 * Math.tanh(x * 1.5));
      ph += f / SR; if (ph >= 1) ph -= 1;
      eng[i] = (2 * ph - 1);
    }
    filt(eng, [['lowpass', 220, 0.7], ['lowpass', 220, 0.7]]);
    const start = (rng() * n) | 0;
    for (let i = 0; i < len; i++) {
      const x = (i - tc) / (w * SR);
      const env = Math.exp(-x * x * 1.6);
      const [gl, gr] = panGains(dir * Math.tanh(x * 1.4) * 0.85);
      const v = (hiss[i] * 1.6 + eng[i] * 0.5) * env * amp;
      const o = (start + i) % n;
      L[o] += v * gl; R[o] += v * gr;
    }
  }
  const chs = [L, R].map((c) => chainPeriodic(c, [['highshelf', 2500, 0.7, -6], ['lowpass', 7000, 0.7], ['highpass', 20, 0.7]]));
  normalizeRms(chs, LOOP_RMS);
  return { channels: chs, loop: true };
}

// Siren tone generator: frequency curve fc(t) over loop of length sec, made phase-continuous.
function sirenTone(sec, fc, seed) {
  const rng = mulberry32(seed);
  const n = N(sec);
  const f = new Float32Array(n);
  let cyc = 0;
  for (let i = 0; i < n; i++) { f[i] = fc(i / SR); cyc += f[i] / SR; }
  const s = Math.round(cyc) / cyc; // integer number of cycles → seamless
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += (f[i] * s) / SR; if (ph >= 1) ph -= 1;
    const w = 2 * Math.PI * ph;
    let v = 0;
    for (let k = 1; k <= 9; k++) v += Math.sin(w * k) * (k % 2 ? 1 / k : 0.35 / k);
    out[i] = v;
  }
  const shaped = chainPeriodic(out, [['highpass', 380, 0.7], ['bandpass', 1300, 0.45], ['peaking', 2600, 1.2, 4]]);
  tanhSat(shaped, 2.2);
  const chs = [chainPeriodic(shaped, [['highpass', 200, 0.7], ['lowpass', 6500, 0.7]])];
  void rng;
  normalizeRms(chs, LOOP_RMS);
  return { channels: chs, loop: true };
}
// Japanese police-style wail (slow rise, slower fall)
const sirenWail = () => sirenTone(6, (t) => {
  const p = (t % 3) / 3;
  const x = p < 0.35 ? Math.sin((p / 0.35) * Math.PI / 2) : Math.cos(((p - 0.35) / 0.65) * Math.PI / 2);
  return 640 + 520 * x * x;
}, 311);
// Ambulance "pee-poh" two-tone (960 / 770 Hz)
const sirenHiLo = () => sirenTone(2.6, (t) => {
  const p = (t % 1.3) / 1.3;
  const s = 0.5 + 0.5 * Math.tanh(Math.sin(p * 2 * Math.PI) * 30);
  return 770 + 190 * s;
}, 312);

// Car horn one-shots (two-tone dissonant pair, through a cheap horn coloration)
function horn(seed, double) {
  const rng = mulberry32(seed);
  const n = N(double ? 1.0 : 0.75);
  const out = new Float32Array(n);
  const f1 = rr(rng, 395, 430), f2 = f1 * rr(rng, 1.18, 1.26);
  const segs = double ? [[0.0, 0.18], [0.3, 0.6]] : [[0.0, rr(rng, 0.35, 0.6)]];
  let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env = 0;
    for (const [a, b] of segs) {
      if (t >= a && t < b + 0.05) env = Math.max(env, Math.min(1, (t - a) / 0.012) * (t > b ? Math.max(0, 1 - (t - b) / 0.05) : 1));
    }
    p1 += f1 / SR; p2 += f2 / SR; p1 %= 1; p2 %= 1;
    const sq = (p) => Math.tanh(Math.sin(2 * Math.PI * p) * 4);
    out[i] = (sq(p1) + sq(p2) * 0.8) * env;
  }
  filt(out, [['highpass', 300, 0.7], ['bandpass', 900, 0.6], ['peaking', 2400, 1.5, 5], ['lowpass', 5000, 0.7]]);
  const chs = [out];
  normalizePeak(chs, 0.9);
  return { channels: chs, loop: false };
}

// Elevated train (mono, positional): rolling roar, viaduct boom, rail-joint "ta-tan ta-tan", inverter whine.
function trainRumble() {
  const rng = mulberry32(321);
  const n = N(10);
  const out = new Float32Array(n);
  const rumble = chainPeriodic(white(n, rng), [['lowpass', 140, 0.7], ['lowpass', 140, 0.7], ['highpass', 25, 0.7]]);
  const boom = chainPeriodic(white(n, rng), [['bandpass', 68, 4]]);
  const roar = chainPeriodic(pinkLoop(n, rng), [['bandpass', 650, 0.6]]);
  const mod = smoothRandomLoop(n, rng, 1);
  let wph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    wph += 820 / SR; wph %= 1;
    const whine = Math.sin(2 * Math.PI * wph) + 0.3 * Math.sin(4 * Math.PI * wph) + 0.12 * Math.sin(6 * Math.PI * wph);
    out[i] = rumble[i] * 9 * (1 + 0.2 * mod[i]) + boom[i] * 10 + roar[i] * 0.55 + whine * 0.012 * (1 + 0.3 * Math.sin(2 * Math.PI * 0.2 * t));
  }
  // rail joints: 25 m rails at ~20 m/s, two bogies per car
  const period = 1.25;
  for (let t0 = 0; t0 < 10 - 1e-6; t0 += period) {
    for (const off of [0, 0.115, 0.82, 0.935]) {
      const ev = new Float32Array(N(0.2));
      mix(ev, ping(rr(rng, 58, 82), 0.05), 1.0);
      mix(ev, filt(noiseClick(rng, 0.02, 0.003), [['bandpass', rr(rng, 1500, 2400), 0.8]]), 0.45);
      mixWrap(out, ev, rr(rng, 0.25, 0.4), N(t0 + off + rgauss(rng) * 0.004));
    }
  }
  const chs = [chainPeriodic(out, [['highpass', 22, 0.7], ['lowpass', 6000, 0.7]])];
  normalizeRms(chs, LOOP_RMS);
  return { channels: chs, loop: true };
}

// --- Voice babble synthesis (formant synthesis of unintelligible speech) ---
const VOWELS = [[730, 1090, 2440], [270, 2290, 3010], [300, 870, 2240], [530, 1840, 2480], [570, 840, 2410], [440, 1020, 2240], [660, 1720, 2410], [490, 1350, 1690], [400, 1900, 2600]];
function voice(rng, n, f0, opts = {}) {
  const BLK = 128;
  const nb = Math.ceil(n / BLK) + 1;
  const env = new Float32Array(n), pitch = new Float32Array(n);
  const F1 = new Float32Array(nb).fill(500), F2 = new Float32Array(nb).fill(1500), F3 = new Float32Array(nb).fill(2500);
  const out = new Float32Array(n);
  const talk = opts.talk ?? 0.6; // fraction of time talking
  let i = (rng() * SR * 1.2) | 0;
  while (i < n) {
    const uttStart = i;
    const uttLen = (rr(rng, 0.7, 3.2) * SR) | 0;
    const uttEnd = Math.min(n, i + uttLen);
    const d0 = rr(rng, 1.05, 1.3), d1 = rr(rng, 0.82, 0.95);
    const excite = rng() < 0.12 ? 1.35 : 1; // occasional animated / laughing
    while (i < uttEnd) {
      const sl = (rr(rng, 0.09, 0.26) * SR) | 0;
      const stress = 0.35 + 0.65 * Math.pow(rng(), 0.7);
      const v = VOWELS[(rng() * VOWELS.length) | 0];
      const j1 = 1 + rgauss(rng) * 0.06, j2 = 1 + rgauss(rng) * 0.06;
      const pr = rr(rng, -0.1, 0.14) * excite;
      for (let b = (i / BLK) | 0; b < Math.min(nb, (((i + sl) / BLK) | 0) + 1); b++) { F1[b] = v[0] * j1 * (opts.fShift || 1); F2[b] = v[1] * j2 * (opts.fShift || 1); F3[b] = v[2] * (opts.fShift || 1); }
      for (let j = i; j < Math.min(i + sl, n); j++) {
        const t = (j - i) / sl;
        env[j] = Math.pow(Math.sin(Math.PI * t), 0.6) * stress;
        const up = (j - uttStart) / uttLen;
        pitch[j] = f0 * excite * (d0 + (d1 - d0) * up) * (1 + pr * t);
      }
      // consonant burst at onset
      if (rng() < 0.45 && i < n) {
        const cb = filt(noiseClick(rng, rr(rng, 0.03, 0.07), rr(rng, 0.01, 0.025)), [['highpass', rr(rng, 2500, 4500), 0.7]]);
        mix(out, cb, 0.12 * stress, i);
      }
      i += sl + (rng() < 0.2 ? (rr(rng, 0.02, 0.09) * SR) | 0 : 0);
    }
    i = uttEnd + ((rr(rng, 0.25, 2.2) / Math.max(0.2, talk) * 0.6) * SR | 0);
  }
  // coarticulation: slew the formant tracks
  for (const F of [F1, F2, F3]) { let y = F[0]; for (let b = 0; b < nb; b++) { y += (F[b] - y) * 0.25; F[b] = y; } }
  // glottal source with spectral tilt
  const src = new Float32Array(n);
  let ph = 0, lp = 0;
  const a = Math.exp(-2 * Math.PI * 1400 / SR);
  for (let j = 0; j < n; j++) {
    if (env[j] <= 0) { lp *= a; src[j] = lp; continue; }
    const f = pitch[j] * (1 + (rng() - 0.5) * 0.02);
    ph += f / SR; if (ph >= 1) ph -= 1;
    const x = (2 * ph - 1) * 0.85 + (rng() * 2 - 1) * 0.12;
    lp = a * lp + (1 - a) * x;
    src[j] = lp * env[j] * 3;
  }
  const b1 = new Biquad('bandpass', 500, 6), b2 = new Biquad('bandpass', 1500, 12), b3 = new Biquad('bandpass', 2500, 16);
  for (let b = 0; b * BLK < n; b++) {
    b1.set('bandpass', F1[b], F1[b] / 90); b2.set('bandpass', F2[b], F2[b] / 110); b3.set('bandpass', F3[b], F3[b] / 160);
    const e = Math.min(n, (b + 1) * BLK);
    for (let j = b * BLK; j < e; j++) {
      const x = src[j];
      out[j] += b1.tick(x) * 1.0 + b2.tick(x) * 0.55 + b3.tick(x) * 0.28;
    }
  }
  return out;
}

function babble(seed, sec, voices, { near = false } = {}) {
  const rng = mulberry32(seed);
  const F = 1.0;
  const n = N(sec + F);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let v = 0; v < voices; v++) {
    const female = rng() < 0.5;
    const f0 = female ? rr(rng, 175, 250) : rr(rng, 92, 140);
    const vo = voice(rng, n, f0, { fShift: female ? 1.12 : 1, talk: rr(rng, 0.4, 0.8) });
    const dist = near ? rr(rng, 0.5, 1) : rr(rng, 0.15, 1);
    filt(vo, [['lowpass', near ? 6000 : 1800 + 3000 * dist, 0.7]]);
    const [gl, gr] = panGains(rr(rng, -0.9, 0.9));
    for (let i = 0; i < n; i++) { L[i] += vo[i] * dist * gl; R[i] += vo[i] * dist * gr; }
  }
  return { L, R, n, F, rng };
}

// Distant crowd murmur (stereo bed)
function crowdBabble() {
  const { L, R, F } = babble(331, 17, 16);
  const chs = [L, R].map((c) => loopify(filt(c, [['highpass', 160, 0.7], ['lowpass', 4500, 0.7]]), N(F)));
  normalizeRms(chs, LOOP_RMS);
  return { channels: chs, loop: true };
}

// Ramen / izakaya interior: a few close voices, bowl clinks, chopsticks, fryer sizzle, simmering pot.
function ramenShop() {
  const { L, R, n, F, rng } = babble(341, 13, 5, { near: true });
  scale(L, 0.8); scale(R, 0.8);
  const ev = (buf, gain, pan, pos) => { const [gl, gr] = panGains(pan); mix(L, buf, gain * gl, pos); mix(R, buf, gain * gr, pos); };
  // bowl clinks
  for (let k = 0, c = Math.round((n / SR) * 0.9); k < c; k++) {
    const f = rr(rng, 1700, 2600);
    const exc = new Float32Array(N(0.6)); impulse(exc, 0, 1, rng);
    const bowl = modalBank(exc, [[f, 0.22, 1], [f * 2.71, 0.13, 0.6], [f * 4.93, 0.08, 0.4], [f * 7.3, 0.05, 0.25]]);
    ev(bowl, rr(rng, 0.25, 0.7), rr(rng, -0.6, 0.6), (rng() * (n - bowl.length)) | 0);
  }
  // chopsticks / wooden clicks
  for (let k = 0, c = Math.round((n / SR) * 1.5); k < c; k++) {
    ev(ping(rr(rng, 2200, 3800), 0.004), rr(rng, 0.1, 0.25), rr(rng, -0.6, 0.6), (rng() * (n - 2000)) | 0);
  }
  // fryer sizzle (sparse crackle)
  const sz = new Float32Array(n);
  for (let k = 0, c = Math.round((n / SR) * 500); k < c; k++) sz[(rng() * n) | 0] += (rng() < 0.5 ? -1 : 1) * rpow(rng, 3);
  filt(sz, [['highpass', 2500, 0.7], ['peaking', 6000, 1, 4], ['lowpass', 10000, 0.7]]);
  const szm = smoothRandomLoop(n, rng, 0.5);
  for (let i = 0; i < n; i++) { const v = sz[i] * (0.7 + 0.3 * szm[i]) * 0.5; L[i] += v * 0.8; R[i] += v * 0.5; }
  // simmering pot
  for (let k = 0, c = Math.round((n / SR) * 14); k < c; k++) {
    const b = filt(bubble(rr(rng, 150, 420), rr(rng, 0.01, 0.03), 0.2), [['lowpass', 1500, 0.7]]);
    ev(b, rr(rng, 0.1, 0.3), 0.35, (rng() * (n - b.length)) | 0);
  }
  const chs = [L, R].map((c) => loopify(filt(c, [['highpass', 120, 0.7], ['lowpass', 7000, 0.7]]), N(F)));
  normalizeRms(chs, LOOP_RMS);
  return { channels: chs, loop: true };
}

// Neon sign buzz (mono, positional): 100 Hz rectified buzz with rich harmonics + gas-discharge fizz.
function neonHum(seed, bright) {
  const rng = mulberry32(seed);
  const n = N(2.0); // multiple of 1/50 s → harmonics of 50 Hz loop perfectly
  const out = new Float32Array(n);
  const base = bright ? 100 : 50;
  const K = bright ? 34 : 14;
  for (let k = 1; k <= K; k++) {
    const f = base * k;
    let a = 1 / Math.pow(k, bright ? 1.0 : 1.5) * (0.5 + rng());
    if (!bright && (k === 2 || k === 4)) a *= 2.5;
    const ph = rng() * 2 * Math.PI;
    const w = (2 * Math.PI * f) / SR;
    for (let i = 0; i < n; i++) out[i] += Math.sin(w * i + ph) * a;
  }
  if (bright) {
    const fz = chainPeriodic(white(n, rng), [['highpass', 2500, 0.7], ['lowpass', 9000, 0.7]]);
    for (let i = 0; i < n; i++) out[i] += fz[i] * Math.pow(Math.abs(Math.sin((2 * Math.PI * 50 * i) / SR)), 6) * 1.2;
  }
  const chs = [chainPeriodic(out, [['highpass', 45, 0.7], ['lowpass', bright ? 7000 : 1200, 0.7]])];
  normalizeRms(chs, LOOP_RMS);
  return { channels: chs, loop: true };
}

// Neon flicker zap one-shot
function neonZap() {
  const rng = mulberry32(352);
  const n = N(0.45);
  const out = new Float32Array(n);
  const clicks = 8 + ((rng() * 12) | 0);
  for (let k = 0; k < clicks; k++) mix(out, noiseClick(rng, 0.006, rr(rng, 0.0003, 0.0015)), rr(rng, 0.3, 1), (rng() * N(0.28)) | 0);
  for (let i = 0; i < N(0.3); i++) {
    const gate = Math.sin(i / SR * 2 * Math.PI * 7) > -0.2 ? 1 : 0;
    let v = 0; for (let k = 1; k < 12; k++) v += Math.sin((2 * Math.PI * 100 * k * i) / SR) / k;
    out[i] += v * 0.15 * gate * Math.exp(-i / N(0.15));
  }
  filt(out, [['highpass', 300, 0.7], ['lowpass', 9000, 0.7]]);
  fades(out, 0.001, 0.05);
  const chs = [out];
  normalizePeak(chs, 0.9);
  return { channels: chs, loop: false };
}

// Vending machine: compressor hum (50 Hz family) + condenser fan + faint ballast whine (mono, positional)
function vending() {
  const rng = mulberry32(361);
  const n = N(4.0);
  const out = new Float32Array(n);
  for (const [f, a] of [[50, 0.35], [100, 1], [150, 0.45], [200, 0.5], [300, 0.22], [400, 0.12], [600, 0.05], [137, 0.18], [274, 0.06], [7200, 0.006]]) {
    const ph = rng() * 6.28, w = (2 * Math.PI * f) / SR;
    for (let i = 0; i < n; i++) out[i] += Math.sin(w * i + ph) * a;
  }
  const fan = chainPeriodic(pinkLoop(n, rng), [['bandpass', 520, 0.8]]);
  mix(out, fan, 0.9);
  const chs = [chainPeriodic(out, [['highpass', 40, 0.7], ['lowpass', 8000, 0.7]])];
  normalizeRms(chs, LOOP_RMS);
  return { channels: chs, loop: true };
}

// Rooftop / open-air wind (stereo): gusty low roar + faint resonant whistle
function wind() {
  const rng = mulberry32(371);
  const n = N(15);
  const chs = [];
  const gust = smoothRandomLoop(n, rng, 0.4);
  for (let ch = 0; ch < 2; ch++) {
    const base = chainPeriodic(pinkLoop(n, rng), [['lowpass', 600, 0.7], ['highpass', 40, 0.7]]);
    const w = white(n, rng);
    const fm = smoothRandomLoop(n, rng, 0.25);
    const bq = new Biquad('bandpass', 700, 18);
    const wh = new Float32Array(n);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        if ((i & 127) === 0) bq.set('bandpass', 700 + 250 * fm[i], 18);
        const y = bq.tick(w[i]);
        if (pass) wh[i] = y;
      }
    }
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const g = 0.55 + 0.45 * gust[i];
      out[i] = base[i] * g * 2 + wh[i] * g * g * 0.25;
    }
    chs.push(out);
  }
  normalizeRms(chs, LOOP_RMS);
  return { channels: chs, loop: true };
}

// ------------------------------------------------------------------ THUNDER
function thunder(seed, { near, dur }) {
  const rng = mulberry32(seed);
  const n = N(dur);
  const L = new Float32Array(n), R = new Float32Array(n);
  const grains = near ? 95 : 70;
  // Rolling thunder = sound arriving from successive segments of the lightning channel → discrete "rolls"
  const rolls = [];
  let tc = near ? 0.03 : rr(rng, 0.3, 0.7);
  while (tc < dur - 3) {
    rolls.push({ t: tc, w: rr(rng, 0.15, 0.55), a: Math.exp(-tc / (dur * 0.35)) * rr(rng, 0.3, 1) * (rolls.length === 0 ? 1.4 : 1) });
    tc += rr(rng, 0.7, 2.2);
  }
  const wsum = rolls.reduce((s, r) => s + r.a, 0);
  for (let g = 0; g < grains; g++) {
    let pick = rng() * wsum, roll = rolls[0];
    for (const r of rolls) { pick -= r.a; if (pick <= 0) { roll = r; break; } }
    let t = roll.t + Math.abs(rgauss(rng)) * roll.w;
    t = Math.min(t, dur - 2);
    const gd = rr(rng, 0.4, 2.0);
    const len = N(gd);
    const cutoff = rr(rng, 60, 320) * (near ? 1 + 1.6 * Math.exp(-t / 0.8) : 1) * (1 - 0.4 * t / dur);
    const gr = filt(white(len, rng), [['lowpass', cutoff, 0.7], ['lowpass', cutoff, 0.7], ['highpass', 22, 0.7]]);
    const att = rr(rng, 0.02, near ? 0.15 : 0.4) * SR;
    const tau = rr(rng, 0.1, 0.45) * SR;
    for (let i = 0; i < len; i++) gr[i] *= Math.min(1, i / att) * Math.exp(-Math.max(0, i - att) / tau);
    const a = (0.3 + 0.7 * rng()) * Math.sqrt(roll.a);
    const [gl, grr] = panGains(rr(rng, -0.85, 0.85));
    mix(L, gr, a * gl, N(t)); mix(R, gr, a * grr, N(t));
  }
  // sub-bass body
  const sub = new Float32Array(n);
  let ph = 0;
  const subT = near ? 0.6 : 1.4;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (38 - 8 * Math.min(1, t / 4)) / SR;
    const e = Math.exp(-Math.pow((t - subT) / (near ? 1.2 : 1.8), 2));
    sub[i] = Math.sin(2 * Math.PI * ph) * e;
  }
  mix(L, sub, near ? 0.09 : 0.06); mix(R, sub, near ? 0.09 : 0.06);
  if (near) {
    // the crack: a fast cluster of broadband tearing transients
    const crack = new Float32Array(N(1.2));
    const subs = 7 + ((rng() * 7) | 0);
    for (let k = 0; k < subs; k++) {
      const t = k === 0 ? 0 : rpow(rng, 1.6) * 0.45;
      const c = noiseClick(rng, rr(rng, 0.15, 0.5), rr(rng, 0.02, 0.09));
      mix(crack, c, (k === 0 ? 1 : rr(rng, 0.3, 0.8)) * Math.exp(-t / 0.4), N(t));
    }
    for (let k = 0; k < 900; k++) {
      const t = rpow(rng, 1.8) * 0.9;
      crack[N(t)] += (rng() < 0.5 ? -1 : 1) * rpow(rng, 2) * Math.exp(-t / 0.3) * 2.5;
    }
    filt(crack, [['highpass', 120, 0.7], ['peaking', 1400, 0.8, 3], ['lowpass', 6500, 0.7]]);
    for (let i = 0; i < crack.length; i++) crack[i] *= Math.exp(-i / N(0.35)) * 0.6 + 0.4 * Math.max(0, 1 - i / crack.length);
    const pre = N(0.02);
    mix(L, crack, 0.4, pre); mix(R, crack, 0.4, pre + N(0.004));
  }
  const chs = [L, R].map((c) => {
    filt(c, [['lowshelf', 120, 0.7, 4], ['highpass', 20, 0.7]]);
    removeDC(c);
    return c;
  });
  normalizePeak(chs, 0.6);
  for (const c of chs) { tanhSat(c, 1.6); fades(c, 0.002, 2.0); }
  normalizePeak(chs, 0.9);
  return { channels: chs, loop: false };
}

// ------------------------------------------------------------------ FOLEY
// Footstep on wet pavement (shoe sole): heel thud + wet slap + spray ticks + toe roll. Puddle: + splash & bubbles.
function footstep(seed, puddle) {
  const rng = mulberry32(seed);
  const n = N(puddle ? 0.5 : 0.35);
  const out = new Float32Array(n);
  mix(out, ping(rr(rng, 65, 105), 0.02), 0.32);
  mix(out, filt(noiseClick(rng, 0.03, 0.0035), [['lowpass', 1600, 0.7]]), 0.5);
  const slap = filt(noiseClick(rng, 0.16, rr(rng, 0.018, 0.035)), [['bandpass', rr(rng, 1700, 2900), 0.7], ['highpass', 700, 0.7]]);
  for (let i = 0; i < Math.min(slap.length, 70); i++) slap[i] *= i / 70;
  mix(out, slap, 0.75, N(0.002));
  for (let k = 0, c = 4 + ((rng() * 6) | 0); k < c; k++) {
    mix(out, filt(noiseClick(rng, 0.004, 0.0006), [['highpass', 3000, 0.7]]), rr(rng, 0.08, 0.2), N(rr(rng, 0.005, 0.09)));
  }
  const toe = N(rr(rng, 0.06, 0.11));
  mix(out, filt(noiseClick(rng, 0.06, 0.012), [['bandpass', 2500, 0.8]]), 0.35, toe);
  mix(out, ping(rr(rng, 90, 140), 0.012), 0.18, toe);
  if (puddle) {
    mix(out, filt(noiseClick(rng, 0.3, rr(rng, 0.045, 0.07)), [['bandpass', rr(rng, 900, 1500), 0.5]]), 0.9, N(0.004));
    for (let k = 0, c = 3 + ((rng() * 4) | 0); k < c; k++) mix(out, bubble(rr(rng, 600, 2000), rr(rng, 0.005, 0.015), 0.3), rr(rng, 0.15, 0.35), N(rr(rng, 0.02, 0.2)));
  }
  filt(out, [['highpass', 50, 0.7], ['lowpass', 11000, 0.7]]);
  fades(out, 0, 0.05);
  const chs = [out];
  normalizePeak(chs, 0.9);
  return { channels: chs, loop: false };
}

// Engine: one-shot loops containing an integer number of 4-stroke V6 cycles at 2000 rpm (100 Hz firing).
// Played back with playbackRate = rpm / 2000. Low = smooth/dark cruise, High = rasp under load.
function engine(seed, high) {
  const rng = mulberry32(seed);
  const cyc = 0.06, cycles = 20; // 720° at 2000 rpm = 60 ms
  const n = N(cyc * cycles);
  const out = new Float32Array(n);
  const cylAmp = Array.from({ length: 6 }, () => 1 + rgauss(rng) * 0.12);
  const fr = high ? 260 : 160, tau = high ? 0.0028 : 0.0042;
  const pulse = new Float32Array(N(0.03));
  for (let i = 0; i < pulse.length; i++) { const t = i / SR; pulse[i] = Math.exp(-t / tau) * Math.sin(2 * Math.PI * fr * t); }
  for (let c = 0; c < cycles; c++) {
    for (let k = 0; k < 6; k++) {
      const t = c * cyc + k * (cyc / 6) + rgauss(rng) * 0.00012;
      const a = cylAmp[k] * (1 + rgauss(rng) * 0.04);
      mixWrap(out, pulse, a, N(t));
      if (high) mixWrap(out, filt(noiseClick(rng, 0.004, 0.0009), [['lowpass', 3500, 0.7]]), a * 0.35, N(t));
    }
  }
  const intake = chainPeriodic(white(n, rng), [['bandpass', high ? 1800 : 900, 0.7]]);
  for (let i = 0; i < n; i++) out[i] += intake[i] * (high ? 0.06 : 0.03) * (1 + Math.sin((2 * Math.PI * 100 * i) / SR));
  const shaped = chainPeriodic(out, [['highpass', 30, 0.7], ['lowshelf', 110, 0.7, high ? 2 : 5], ['peaking', high ? 600 : 250, 1, 4], ['lowpass', high ? 3800 : 1100, 0.7]]);
  if (high) tanhSat(shaped, 2.0);
  removeDC(shaped);
  const chs = [shaped];
  normalizeRms(chs, LOOP_RMS);
  return { channels: chs, loop: true };
}

// Wet tyre hiss + spray (stereo loop), gain follows speed
function tireHiss() {
  const rng = mulberry32(381);
  const n = N(5);
  const chs = [];
  for (let ch = 0; ch < 2; ch++) {
    const h = chainPeriodic(pinkLoop(n, rng), [['bandpass', 1900, 0.5], ['highshelf', 6000, 0.7, -6]]);
    const s = chainPeriodic(pinkLoop(n, rng), [['lowpass', 500, 0.7], ['highpass', 60, 0.7]]);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = h[i] * 1.6 + s[i] * 0.8;
    chs.push(out);
  }
  normalizeRms(chs, LOOP_RMS);
  return { channels: chs, loop: true };
}

// ------------------------------------------------------------------ MUSIC
// Dark-ambient synthwave bed: 48 s loop at 80 BPM. Wide detuned-saw pad through a slowly breathing low-pass,
// pulsing sub bass, sparse glassy arpeggio with baked ping-pong echoes, high shimmer.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
function music() {
  const rng = mulberry32(401);
  const beat = 0.75, bar = beat * 4, Ls = bar * 16;
  const n = N(Ls);
  const tail = N(4);
  const padL = new Float32Array(n + tail), padR = new Float32Array(n + tail);
  const chords = [
    { root: 38, notes: [50, 53, 57, 60, 64] }, // Dm9
    { root: 34, notes: [46, 50, 53, 57, 60] }, // Bbmaj9
    { root: 31, notes: [43, 46, 50, 53, 57] }, // Gm9
    { root: 33, notes: [45, 50, 52, 55, 57] }, // A7sus4
    { root: 38, notes: [50, 53, 57, 62, 64] },
    { root: 34, notes: [46, 53, 57, 60, 62] },
    { root: 31, notes: [43, 50, 53, 57, 58] },
    { root: 33, notes: [45, 49, 52, 55, 57] }, // A7
  ];
  const cl = bar * 2;
  chords.forEach((c, ci) => {
    const s = N(ci * cl), len = N(cl + 3);
    for (const m of c.notes) {
      const f = mtof(m);
      for (const [det, side] of [[-7, 0], [5, 0], [-4, 1], [8, 1]]) {
        const tmp = new Float32Array(len);
        addSaw(tmp, f * Math.pow(2, det / 1200), 0.05, 0, len, rng());
        for (let i = 0; i < len; i++) {
          const t = i / SR;
          const a = Math.min(1, t / 1.8);
          const r = t > cl ? Math.max(0, 1 - (t - cl) / 3) : 1;
          tmp[i] *= a * a * r;
        }
        mix(side ? padR : padL, tmp, 1, s);
      }
    }
  });
  const pL = foldTail(padL, n), pR = foldTail(padR, n);
  // breathing filter (periodic over the loop)
  for (const p of [pL, pR]) {
    const bq = new Biquad('lowpass', 800, 1.1);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        if ((i & 127) === 0) bq.set('lowpass', 650 + 550 * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N(24))), 1.1);
        const y = bq.tick(p[i]);
        if (pass) p[i] = y;
      }
    }
  }
  const L = new Float32Array(n + tail), R = new Float32Array(n + tail);
  mix(L, pL, 1); mix(R, pR, 1);
  // sub bass: 8th-note pulses with soft attack (pumping), triangle-ish
  const e8 = beat / 2;
  for (let k = 0; k < Ls / e8; k++) {
    const t0 = k * e8;
    const c = chords[Math.floor(t0 / cl) % chords.length];
    const f = mtof(c.root + 12);
    const len = N(e8 + 0.05);
    const b = new Float32Array(len);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      ph += f / SR;
      const tri = 1 - 4 * Math.abs((ph % 1) - 0.5);
      b[i] = (Math.sin(2 * Math.PI * ph) * 0.8 + tri * 0.2) * Math.min(1, t / 0.03) * Math.exp(-t / 0.22) * (k % 2 ? 0.75 : 1);
    }
    mix(L, b, 0.22, N(t0)); mix(R, b, 0.22, N(t0));
  }
  // glassy arp with ping-pong echoes (dotted 8th)
  const s16 = beat / 4;
  const pat = [0, 2, 4, 1, 3, 4, 2, 0];
  for (let k = 0; k < Ls / s16; k++) {
    if (rng() < 0.42) continue; // sparse, human
    const t0 = k * s16;
    const ci = Math.floor(t0 / cl) % chords.length;
    const c = chords[ci];
    const m = c.notes[pat[k % pat.length]] + 24;
    const f = mtof(m);
    const len = N(0.5);
    const b = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      b[i] = (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t + 1) + 0.08 * Math.sin(6 * Math.PI * f * t)) * Math.min(1, t / 0.004) * Math.exp(-t / 0.13);
    }
    const g = 0.05 * (0.6 + 0.4 * rng()) * (ci >= 4 ? 1.0 : 0.6);
    for (let e = 0; e < 6; e++) {
      const dst = e % 2 ? R : L;
      const t = t0 + e * beat * 0.75;
      const tgt = e === 0 ? [L, R] : [dst];
      for (const d of tgt) mixWrap(d, b, g * Math.pow(0.5, e) * (e === 0 ? 0.7 : 1), N(t));
    }
  }
  // shimmer: soft sines two octaves up with slow tremolo
  chords.forEach((c, ci) => {
    const len = N(cl + 2);
    for (const m of [c.notes[2] + 24, c.notes[4] + 12]) {
      const f = mtof(m), b = new Float32Array(len);
      const tr = rr(rng, 0.15, 0.4);
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        b[i] = Math.sin(2 * Math.PI * f * t) * Math.sin(Math.PI * Math.min(1, t / len * SR)) * (0.6 + 0.4 * Math.sin(2 * Math.PI * tr * t));
      }
      const [gl, gr] = panGains(rr(rng, -0.6, 0.6));
      mix(L, b, 0.012 * gl, N(ci * cl)); mix(R, b, 0.012 * gr, N(ci * cl));
    }
  });
  const chs = [foldTail(L, n), foldTail(R, n)].map((c) => chainPeriodic(c, [['highpass', 30, 0.7], ['lowpass', 9000, 0.7]]));
  normalizeRms(chs, LOOP_RMS);
  return { channels: chs, loop: true };
}

// ------------------------------------------------------------------ REGISTRY
// Order = generation order (most important first, so the soundscape comes alive quickly).
export const RECIPES = {
  ir: reverbIR,
  rainFar, rainNear, droplets, metalPatter, carRoof, gutter,
  trafficBed, neonA: () => neonHum(351, true), neonB: () => neonHum(353, false), vending,
  thunderNear: () => thunder(501, { near: true, dur: 10 }),
  thunderMid: () => thunder(502, { near: true, dur: 12 }),
  thunderFar: () => thunder(503, { near: false, dur: 13 }),
  step0: () => footstep(601, false), step1: () => footstep(602, false), step2: () => footstep(603, false), step3: () => footstep(604, false),
  step4: () => footstep(605, false), step5: () => footstep(606, false), step6: () => footstep(607, false), step7: () => footstep(608, false),
  puddle0: () => footstep(611, true), puddle1: () => footstep(612, true), puddle2: () => footstep(613, true), puddle3: () => footstep(614, true),
  engineLow: () => engine(701, false), engineHigh: () => engine(702, true), tireHiss,
  sirenWail, sirenHiLo, horn0: () => horn(801, false), horn1: () => horn(802, true), horn2: () => horn(803, false),
  trainRumble, neonZap, wind, crowdBabble, ramenShop,
  music,
};
export const ORDER = Object.keys(RECIPES);

export function generate(name) {
  const r = RECIPES[name];
  if (!r) throw new Error('unknown recipe ' + name);
  const out = r();
  // final safety: sanitize NaN/Inf
  for (const c of out.channels) for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i])) c[i] = 0;
  return { name, sampleRate: SR, ...out };
}
