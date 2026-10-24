// Distant lightning: random strikes with multi-strobe flash envelope. Writes ctx.weather.lightning (0..1) and
// dispatches ctx.events 'thunder' { delay (s), intensity, distance (m) } at the flash so audio can schedule the rumble.
// Disabled in shot mode (deterministic stills).
import { mulberry32 } from './common.js';

export class Lightning {
  constructor(ctx) {
    this.ctx = ctx;
    this.rng = mulberry32(0x5eed1);
    this.value = 0;
    this.next = 6 + this.rng() * 10;
    this.strike = null; // { t0, pulses: [{t, dur, amp}], dist }
    this.enabled = !ctx.isShot;
  }

  trigger(t, intensity = 1) {
    const r = this.rng;
    const pulses = [];
    let tt = 0;
    const n = 1 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      pulses.push({ t: tt, dur: 0.05 + r() * 0.12, amp: (i === 0 ? 0.6 : 0.4 + r() * 0.6) * intensity });
      tt += 0.06 + r() * 0.22;
    }
    const dist = 1500 + r() * 6000;
    this.strike = { t0: t, pulses, end: tt + 0.6, dist };
    const delay = dist / 343;
    this.ctx.events.dispatchEvent(new CustomEvent('thunder', { detail: { delay, intensity: intensity * (1 - dist / 9000), distance: dist } }));
  }

  update(dt, t, rain) {
    if (!this.enabled) { this.value = 0; return 0; }
    if (!this.strike && t >= this.next && rain > 0.3) {
      this.trigger(t, 0.6 + this.rng() * 0.4);
      this.next = t + 9 + this.rng() * 22;
    }
    let v = 0;
    if (this.strike) {
      const lt = t - this.strike.t0;
      for (const p of this.strike.pulses) {
        const x = lt - p.t;
        if (x >= 0) v = Math.max(v, p.amp * (x < 0.015 ? x / 0.015 : Math.exp(-(x - 0.015) / p.dur)));
      }
      if (lt > this.strike.end) this.strike = null;
    }
    this.value = v;
    return v;
  }
}
