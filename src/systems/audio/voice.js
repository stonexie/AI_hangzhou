// Real Chinese voice layer: night-market vendor calls, PA announcements and pedestrian chatter.
// The mp3 assets are generated offline with edge-tts neural voices (zh-CN) and played through
// HRTF panners so every line is anchored to a real world position (stall / walkway / crowd).
export class VoiceLayer {
  constructor(ctx, core) {
    this.ctx = ctx;
    this.core = core;
    this.pending = new Map();
    this.buffers = new Map();
    this.started = false;
    this.t = 0;
    this.nextPA = 8;
    this.paFlip = 0;
    this.vendors = [
      { name: 'vendor_noodle', pos: { x: -8.78, y: 1.6, z: 11.5 }, next: 0, gain: 0.95 },
      { name: 'vendor_tea', pos: { x: 8.78, y: 1.6, z: -6.0 }, next: 0, gain: 0.9 },
      { name: 'vendor_dumpling', pos: { x: -8.78, y: 1.6, z: -38.0 }, next: 0, gain: 0.9 },
      { name: 'vendor_cake', pos: { x: 8.78, y: 1.6, z: -86.0 }, next: 0, gain: 0.9 },
      { name: 'vendor_silk', pos: { x: -8.78, y: 1.6, z: -132.0 }, next: 0, gain: 0.9 },
      { name: 'vendor_lantern', pos: { x: 133.5, y: 1.6, z: -52.0 }, next: 0, gain: 0.85 },
    ];
    this.pa = [
      { pos: { x: -7.5, y: 3.4, z: 14 }, next: 0 },
      { pos: { x: 7.5, y: 3.4, z: -118 }, next: 0 },
    ];
    this.chatterNames = ['chatter_1', 'chatter_2', 'chatter_3', 'chatter_4', 'chatter_5', 'chatter_6', 'chatter_7', 'chatter_8'];
  }

  async load() {
    const names = [
      ...this.vendors.map((v) => v.name),
      'pa_welcome', 'pa_lastcall',
      ...this.chatterNames,
    ];
    await Promise.all([...new Set(names)].map(async (n) => {
      try {
        const res = await fetch(`/audio/voice/${n}.mp3`);
        if (!res.ok) return;
        this.pending.set(n, await res.arrayBuffer());
      } catch { /* offline asset missing → silently skip */ }
    }));
  }

  // Must be called after the AudioContext exists (first user gesture).
  start() {
    const ac = this.core.ac;
    if (!ac || this.started) return;
    this.started = true;
    for (const [name, ab] of this.pending) {
      ac.decodeAudioData(ab.slice(0)).then((b) => this.buffers.set(name, b)).catch(() => {});
    }
    this.pending.clear();
  }

  _play(name, pos, gain = 1, { ref = 3.0, rolloff = 1.6, max = 70 } = {}) {
    const ac = this.core.ac;
    const buf = this.buffers.get(name);
    if (!ac || !buf) return;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.97 + Math.random() * 0.06;
    const pan = this.core.panner(this.core.exterior, { hrtf: true, ref, rolloff, max });
    this.core.setPos(pan, pos.x, pos.y, pos.z);
    const g = this.core.gain(gain, pan);
    src.connect(g);
    try { src.start(ac.currentTime + 0.01); } catch { return; }
    const send = this.core.gain(0.22, this.core.reverbSend);
    pan.connect(send);
    src.onended = () => { try { pan.disconnect(); send.disconnect(); } catch { /* ignore */ } };
  }

  update(dt, ctx) {
    if (!this.started || !this.core.ac || this.core.ac.state !== 'running') return;
    const p = ctx.api?.player?.object?.position || ctx.camera.position;
    if (!p) return;
    this.t += dt;

    // ---- vendor calls: only when the player is close enough to hear them
    for (const v of this.vendors) {
      const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
      if (d > 48) { v.next = Math.max(v.next, this.t + 2.5); continue; }
      if (this.t < v.next) continue;
      v.next = this.t + 11 + Math.random() * 13;
      this._play(v.name, v.pos, v.gain * (0.75 + 0.25 * Math.min(1, 20 / Math.max(4, d))), { ref: 2.6, rolloff: 1.7, max: 55 });
    }

    // ---- PA announcements (night-market broadcast)
    if (this.t >= this.nextPA) {
      const slot = this.pa[this.paFlip++ % this.pa.length];
      this._play(this.paFlip % 4 === 1 ? 'pa_lastcall' : 'pa_welcome', slot.pos, 0.85, { ref: 8, rolloff: 0.9, max: 130 });
      this.nextPA = this.t + 105 + Math.random() * 60;
    }

    // ---- pedestrian chatter: borrow the nearest crowd agents as moving talkers
    const agents = ctx.api?.crowd?.agents;
    if (!agents || !agents.length) return;
    let used = 0;
    for (const ag of agents) {
      if (used >= 4) break;
      if (ag._voiceNext === undefined) ag._voiceNext = this.t + 2 + Math.random() * 12;
      if (ag.dist === undefined) continue;
      if (ag.dist > 16 || !ag.vis) continue;
      if (this.t < ag._voiceNext) continue;
      ag._voiceNext = this.t + 9 + Math.random() * 12;
      used++;
      const name = this.chatterNames[(ag.id + this.chatterNames.length) % this.chatterNames.length];
      this._play(name, { x: ag.x, y: (ag.y || 0) + 1.55, z: ag.z }, 0.5, { ref: 1.6, rolloff: 2.0, max: 26 });
    }
  }
}
