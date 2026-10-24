// Small deterministic helpers for the signage system.
export function mulberry32(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length) % arr.length];
  f.chance = (p) => f() < p;
  f.weighted = (items) => { // [[value, weight], ...]
    let s = 0; for (const [, w] of items) s += w;
    let r = f() * s;
    for (const [v, w] of items) { r -= w; if (r <= 0) return v; }
    return items[items.length - 1][0];
  };
  return f;
}

// Warm Hangzhou Wulin Night Market (杭州武林夜市) lighting palette.
export const NEON = {
  magenta: [0.95, 0.28, 0.38],   // softened lotus crimson instead of harsh cyber magenta
  pink: [1.0, 0.42, 0.48],      // warm peach blossom
  hotpink: [0.98, 0.22, 0.25],  // vermilion lantern red
  cyan: [0.22, 0.82, 0.76],     // Longquan celadon jade (龙泉青瓷)
  ice: [0.68, 0.88, 0.86],      // misty West Lake jade white
  blue: [0.25, 0.52, 0.85],     // soft Jiangnan indigo
  violet: [0.78, 0.42, 0.55],   // muted plum blossom
  purple: [0.82, 0.36, 0.48],   // warm hibiscus
  red: [1.0, 0.14, 0.06],       // traditional Chinese lantern vermilion
  amber: [1.0, 0.52, 0.12],     // warm osmanthus amber (桂花暖珀)
  orange: [1.0, 0.38, 0.06],    // night market warm tanghulu orange
  warm: [1.0, 0.76, 0.42],      // soft warm tungsten / paper lantern glow
  yellow: [1.0, 0.82, 0.24],    // golden silk plaque yellow
  lime: [0.52, 0.88, 0.36],     // Longjing tea leaf green (龙井茶绿)
  green: [0.22, 0.86, 0.52],    // bamboo emerald
  white: [1.0, 0.96, 0.88],     // warm silk white
};

// Weighted palette favoring warm night-market gold, amber, vermilion red, warm white, and celadon jade.
export const NEON_WEIGHTS = [
  ['warm', 6], ['amber', 6], ['yellow', 4], ['red', 5], ['orange', 4], ['white', 3.5],
  ['cyan', 3], ['ice', 2], ['green', 1.8], ['lime', 1.2], ['pink', 1.5], ['hotpink', 1.5],
  ['blue', 1], ['magenta', 0.8], ['violet', 0.5], ['purple', 0.5],
];

export const css = (c, k = 1) => `rgb(${Math.round(Math.min(1, c[0] * k) * 255)},${Math.round(Math.min(1, c[1] * k) * 255)},${Math.round(Math.min(1, c[2] * k) * 255)})`;
