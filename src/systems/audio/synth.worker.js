// Generates all procedural audio buffers off the main thread and streams them back (transferable).
import { generate, ORDER } from './synth.js';

self.onmessage = (e) => {
  const order = e.data?.order || ORDER;
  for (const name of order) {
    try {
      const r = generate(name);
      self.postMessage({ type: 'buffer', name, sampleRate: r.sampleRate, loop: r.loop, channels: r.channels }, r.channels.map((c) => c.buffer));
    } catch (err) {
      self.postMessage({ type: 'error', name, message: String(err?.message || err) });
    }
  }
  self.postMessage({ type: 'done' });
};
