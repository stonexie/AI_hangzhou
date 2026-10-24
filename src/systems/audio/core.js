// AudioContext + mix bus graph + buffer bank + helpers for loops / one-shots / positional emitters.
//
//   sources ─► exterior ─► exteriorLP ─┐            (exterior world: muffled when inside a car)
//   reverb (convolver, generated IR) ──┘
//   interior (car roof, engine) ───────┼─► duck ─► master(volume) ─► limiter ─► mute ─► destination
//   music ─────────────────────────────┘
export class AudioCore {
  constructor() {
    this.raw = new Map();
    this.buffers = new Map();
    this.ac = null;
    this.listeners = new Map(); // name → [cb] waiting for buffer
  }

  addRaw(name, data) {
    this.raw.set(name, data);
    if (this.ac) this._make(name);
  }

  _make(name) {
    const d = this.raw.get(name);
    if (!d || this.buffers.has(name)) return;
    try {
      const b = this.ac.createBuffer(d.channels.length, d.channels[0].length, d.sampleRate);
      d.channels.forEach((c, i) => b.copyToChannel(c, i));
      this.buffers.set(name, b);
      if (name === 'ir' && this.reverb) this.reverb.buffer = b;
      const cbs = this.listeners.get(name);
      if (cbs) { this.listeners.delete(name); for (const cb of cbs) { try { cb(b); } catch (e) { console.warn('[audio]', e); } } }
    } catch (e) { console.warn('[audio] buffer', name, e); }
  }

  buf(name) { return this.buffers.get(name) || null; }
  // Run cb when buffer is available (immediately if it already is)
  when(name, cb) {
    const b = this.buf(name);
    if (b) { cb(b); return; }
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(cb);
  }

  start() {
    if (this.ac) return this.ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ac = new AC({ latencyHint: 'playback', sampleRate: 48000 });
    this.ac = ac;
    const g = (v = 1) => { const n = ac.createGain(); n.gain.value = v; return n; };
    this.out = g(1); // mute
    this.limiter = ac.createDynamicsCompressor();
    this.limiter.threshold.value = -6; this.limiter.knee.value = 4; this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003; this.limiter.release.value = 0.25;
    this.master = g(0.8);
    this.duck = g(1);
    this.exterior = g(1);
    this.exteriorLP = ac.createBiquadFilter(); this.exteriorLP.type = 'lowpass'; this.exteriorLP.frequency.value = 20000; this.exteriorLP.Q.value = 0.5;
    this.interior = g(1);
    this.music = g(0);
    this.reverb = ac.createConvolver();
    this.reverbSend = g(1);
    this.reverbReturn = g(0.55);
    this.exterior.connect(this.exteriorLP).connect(this.duck);
    this.interior.connect(this.duck);
    this.music.connect(this.duck);
    this.reverbSend.connect(this.reverb).connect(this.reverbReturn).connect(this.exterior);
    this.duck.connect(this.master).connect(this.limiter).connect(this.out).connect(ac.destination);
    for (const name of this.raw.keys()) this._make(name);
    return ac;
  }

  get now() { return this.ac ? this.ac.currentTime : 0; }

  // Smoothly drive an AudioParam (skips tiny changes to keep the main thread cheap)
  set(param, v, tau = 0.08) {
    if (!param || !Number.isFinite(v)) return;
    const last = param._nkLast;
    if (last !== undefined && Math.abs(last - v) < Math.max(1e-4, Math.abs(v) * 0.004)) return;
    param._nkLast = v;
    param.setTargetAtTime(v, this.ac.currentTime, tau);
  }

  gain(v = 1, dest) { const n = this.ac.createGain(); n.gain.value = v; if (dest) n.connect(dest); return n; }
  filter(type, f, q = 0.707, dest) { const n = this.ac.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; if (dest) n.connect(dest); return n; }
  panner(dest, { hrtf = true, ref = 2, rolloff = 1, max = 10000, model = 'inverse' } = {}) {
    const p = this.ac.createPanner();
    p.panningModel = hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = model; p.refDistance = ref; p.rolloffFactor = rolloff; p.maxDistance = max;
    if (dest) p.connect(dest);
    return p;
  }
  setPos(p, x, y, z) {
    if (p.positionX) {
      const t = this.ac.currentTime;
      for (const [prm, v] of [[p.positionX, x], [p.positionY, y], [p.positionZ, z]]) { prm.cancelScheduledValues(t); prm.setValueAtTime(v, t); prm._nkLast = v; }
    } else p.setPosition(x, y, z);
  }

  // Start a looping buffer source into dest once the buffer exists. Returns a handle {gain, src}.
  loop(name, dest, { gain = 0, rate = 1, offset = Math.random() } = {}) {
    const h = { gain: this.gain(gain, dest), src: null, rate };
    this.when(name, (b) => {
      const s = this.ac.createBufferSource();
      s.buffer = b; s.loop = true; s.playbackRate.value = h.rate;
      s.connect(h.gain);
      s.start(this.ac.currentTime + 0.02, (offset % 1) * b.duration);
      h.src = s;
    });
    return h;
  }

  // Fire a one-shot. Returns the source (or null if buffer not ready).
  oneShot(name, dest, { gain = 1, rate = 1, when = 0 } = {}) {
    const b = this.buf(name);
    if (!b || !this.ac) return null;
    const s = this.ac.createBufferSource();
    s.buffer = b; s.playbackRate.value = rate;
    const g = this.gain(gain, dest);
    s.connect(g);
    s.onended = () => { try { s.disconnect(); g.disconnect(); } catch { /* */ } };
    s.start(this.ac.currentTime + Math.max(0, when));
    return s;
  }

  // ---- Debug / verification: record the post-limiter master output ----
  async record(seconds) {
    const ac = this.ac;
    if (!ac) throw new Error('audio not started');
    if (!this._recReady) {
      const code = `class R extends AudioWorkletProcessor{constructor(){super();this.on=false;this.port.onmessage=e=>{this.on=e.data==='start';};}
        process(inp){const i=inp[0];if(this.on&&i&&i.length){this.port.postMessage([i[0].slice(),(i[1]||i[0]).slice()]);}return true;}}
        registerProcessor('nk-rec',R);`;
      const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
      await ac.audioWorklet.addModule(url);
      this._recReady = true;
    }
    const node = new AudioWorkletNode(ac, 'nk-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    const sink = this.gain(0, ac.destination);
    this.out.connect(node); node.connect(sink);
    const need = Math.round(seconds * ac.sampleRate);
    const L = new Float32Array(need), R = new Float32Array(need);
    let n = 0;
    await new Promise((resolve) => {
      node.port.onmessage = (e) => {
        const [l, r] = e.data;
        const k = Math.min(l.length, need - n);
        L.set(l.subarray(0, k), n); R.set(r.subarray(0, k), n); n += k;
        if (n >= need) resolve();
      };
      node.port.postMessage('start');
    });
    node.port.postMessage('stop');
    this.out.disconnect(node); node.disconnect(); sink.disconnect();
    return { sampleRate: ac.sampleRate, L, R };
  }
}
