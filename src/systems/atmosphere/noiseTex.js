import * as THREE from 'three/webgpu';

// Tileable multi-channel fBm noise texture generated on the CPU (cheap to sample in TSL vs. per-pixel Perlin).
// R: low-frequency fbm, G: mid-frequency fbm, B: high-frequency detail, A: ridged/billow noise.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeLattice(period, rnd) {
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return g;
}

function valueNoise(lat, period, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
  const a = lat[y0 * period + x0], b = lat[y0 * period + x1];
  const c = lat[y1 * period + x0], d = lat[y1 * period + x1];
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}

export function createNoiseTexture(size = 256, seed = 1337) {
  const rnd = mulberry32(seed);
  const octs = 6;
  const lats = [];
  for (let o = 0; o < octs + 2; o++) {
    const p = 4 << o;
    lats.push({ p, lat: makeLattice(p, rnd) });
  }
  const fbm = (x, y, start, n, ridged = false) => {
    let s = 0, amp = 0.5, norm = 0;
    for (let o = start; o < start + n; o++) {
      const { p, lat } = lats[o];
      let v = valueNoise(lat, p, x * p, y * p);
      if (ridged) v = 1 - Math.abs(v * 2 - 1);
      s += v * amp; norm += amp; amp *= 0.5;
    }
    return s / norm;
  };
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = i / size, y = j / size;
      const k = (j * size + i) * 4;
      data[k] = Math.min(255, Math.max(0, fbm(x, y, 0, 5) * 255));
      data[k + 1] = Math.min(255, Math.max(0, fbm(x, y, 1, 5) * 255));
      data[k + 2] = Math.min(255, Math.max(0, fbm(x, y, 3, 4) * 255));
      data[k + 3] = Math.min(255, Math.max(0, fbm(x, y, 1, 4, true) * 255));
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
