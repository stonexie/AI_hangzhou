// Vehicle materials (TSL node materials). All car meshes are rendered as InstancedMeshes:
//   - paint meshes carry the paint colour in instanceColor (auto-multiplied into the diffuse colour)
//   - light meshes carry the light state in instanceColor: r = headlights, g = tail/position, b = brake
// Includes Hangzhou `浙A` license plate textures and the red glowing "空车" roof LED sign for Hangzhou green taxis.
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, uniform, time, floor, fract, length, smoothstep, mix, clamp, abs, max, min, normalize, step, sin,
  positionGeometry, normalGeometry, normalView, cameraViewMatrix, instanceColor, dot, pow, positionWorld, cameraPosition, texture, uv,
} from 'three/tsl';
import { hash21, hash22, hash23, vnoise } from '../../materials/noise.js';
import { wetUniforms } from '../../materials/wet.js';

export const vehUniforms = {
  rain: wetUniforms.rain,
  wet: wetUniforms.wetness,
  headBoost: uniform(1.0),
  tailBoost: uniform(1.0),
};

const _texCache = new Map();

// Generate high-contrast glowing red "空车" LED sign texture for Hangzhou Taxis
function getTaxiKongcheTexture() {
  if (_texCache.has('taxi_kongche')) return _texCache.get('taxi_kongche');
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const g = c.getContext('2d');

  // Dark LED matrix housing background
  g.fillStyle = '#0c0808';
  g.fillRect(0, 0, 512, 192);

  // Subtle red border frame
  g.strokeStyle = '#bf1515';
  g.lineWidth = 6;
  g.strokeRect(10, 10, 492, 172);

  // Bright red glowing "空 车" characters in pure red channel (R=1.0)
  g.fillStyle = '#ff1a1a';
  g.shadowColor = '#ff0000';
  g.shadowBlur = 12;
  g.font = '900 116px "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('空 车', 256, 102);

  // Subtle LED matrix grid overlay for authentic taxi LED look
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(10, 5, 5, 0.28)';
  g.lineWidth = 1.5;
  for (let x = 0; x < 512; x += 6) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 192); g.stroke();
  }
  for (let y = 0; y < 192; y += 6) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  _texCache.set('taxi_kongche', tex);
  return tex;
}

// Generate authentic Hangzhou `浙A` license plate texture per vehicle class
function getHangzhouPlateTexture(type = 'kei') {
  const key = 'plate_' + type;
  if (_texCache.has(key)) return _texCache.get(key);

  const plateNumbers = {
    hero:  { text: '浙A·889K1', green: false },
    taxi:  { text: '浙A·T6188', green: false },
    sedan: { text: '浙A·726M9', green: false },
    suv:   { text: '浙A·F81920', green: true },
    kei:   { text: '浙A·D39528', green: true },
    van:   { text: '浙A·507N6', green: false },
  };
  const cfg = plateNumbers[type] || plateNumbers.hero;

  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d');

  if (cfg.green) {
    // Standard Chinese New-Energy Vehicle (NEV) green gradient license plate
    const grad = g.createLinearGradient(0, 0, 0, 160);
    grad.addColorStop(0.0, '#f2f7f3');
    grad.addColorStop(0.32, '#c8f0d2');
    grad.addColorStop(1.0, '#1aa852');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 160);

    g.strokeStyle = '#142018';
    g.lineWidth = 6;
    g.strokeRect(8, 8, 496, 144);

    g.fillStyle = '#101812';
    g.font = 'bold 82px "PingFang SC", "Microsoft YaHei", "Arial", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(cfg.text, 256, 84);
  } else {
    // Classic Chinese 92-style Blue License Plate (蓝底白字 浙A 牌照)
    g.fillStyle = '#0f3d96';
    g.fillRect(0, 0, 512, 160);

    g.strokeStyle = '#f4f6fa';
    g.lineWidth = 6;
    g.strokeRect(8, 8, 496, 144);

    g.fillStyle = '#f8fafc';
    g.font = 'bold 86px "PingFang SC", "Microsoft YaHei", "Arial", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(cfg.text, 256, 84);
  }

  // Four mounting rivets
  g.fillStyle = '#cfd4dc';
  for (const [rx, ry] of [[128, 22], [384, 22], [128, 138], [384, 138]]) {
    g.beginPath();
    g.arc(rx, ry, 5, 0, Math.PI * 2);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  _texCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------------------------- rain helpers
function dropLayer(uvCoord, scale, seed, density) {
  const q = uvCoord.mul(scale).add(seed);
  const id = floor(q);
  const f = fract(q).sub(0.5);
  const h = hash23(id.add(seed * 3.1));
  const c = h.xy.sub(0.5).mul(0.45);
  const r = h.z.mul(0.2).add(0.1);
  const d = f.sub(c);
  const dl = length(d);
  const on = step(float(1).sub(density), hash21(id.add(seed + 7.7)));
  const m = smoothstep(r, r.mul(0.55), dl).mul(on);
  return { m, slope: d.div(r).mul(m) };
}

export function rainNodes({ beadScale = 1, streaks = true, strength = 1 } = {}) {
  const p = positionGeometry;
  const n = normalGeometry;
  const wet = vehUniforms.wet;
  const up = smoothstep(0.3, 0.75, n.y);
  const side = float(1).sub(up).mul(smoothstep(-0.35, 0.0, n.y));
  const uvTop = vec2(p.x, p.z);
  const a = dropLayer(uvTop, 26 * beadScale, 0.0, 0.55);
  const b = dropLayer(uvTop, 41 * beadScale, 13.0, 0.5);
  const c = dropLayer(uvTop, 67 * beadScale, 31.0, 0.45);
  const beadM = max(max(a.m, b.m), c.m).mul(up);
  const beadS = a.slope.add(b.slope).add(c.slope.mul(0.7)).mul(up);
  const uvSide = vec2(p.x.add(p.z), p.y);
  const d = dropLayer(uvSide, 48 * beadScale, 5.0, 0.35);
  let mask = beadM.add(d.m.mul(side));
  let off = vec3(beadS.x, 0, beadS.y).add(vec3(d.slope.x, d.slope.y, d.slope.x).mul(side).mul(0.6));
  if (streaks) {
    const sx = p.x.add(p.z).mul(34.0);
    const sid = floor(sx);
    const hs = hash21(vec2(sid, 3.7));
    const speed = hs.mul(0.5).add(0.25);
    const fy = fract(p.y.mul(1.6).add(time.mul(speed)).add(hs.mul(9.0)));
    const fx = fract(sx).sub(0.5).add(hs.sub(0.5).mul(0.5));
    const line = smoothstep(0.16, 0.02, abs(fx)).mul(smoothstep(0.0, 0.05, fy)).mul(smoothstep(0.55, 0.2, fy)).mul(step(0.62, hs));
    const head = smoothstep(0.08, 0.0, abs(fy.sub(0.06))).mul(smoothstep(0.3, 0.0, abs(fx)));
    const st = line.max(head).mul(side);
    mask = mask.add(st);
    off = off.add(vec3(fx.sign().mul(st).mul(0.4), 0, 0));
  }
  const k = wet.mul(strength);
  return { mask: clamp(mask, 0, 1).mul(k), offset: off.mul(k) };
}

function perturbView(offsetGeom, amount) {
  const ov = cameraViewMatrix.mul(vec4(offsetGeom, 0)).xyz;
  return normalize(normalView.add(ov.mul(amount)));
}

// ---------------------------------------------------------------------------------------------- materials
export function makePaint({ metalness = 0.55, roughness = 0.34, flake = 1.0, coatRough = 0.035, solid = false } = {}, paintNode = null) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionGeometry;
  const fc = p.mul(520.0);
  const fh = hash23(floor(vec2(fc.x.add(fc.z.mul(0.71)), fc.y.add(fc.z.mul(0.43)))));
  const flakeB = fh.x.sub(0.5).mul(0.22 * flake).add(1.0);
  const grime = smoothstep(0.55, 0.12, p.y).mul(vnoise(vec2(p.x.add(p.z), p.y).mul(6.0)).mul(0.6).add(0.4));
  const rain = rainNodes({});
  m.colorNode = vec3(flakeB).mul(float(1).sub(grime.mul(0.35)));
  if (paintNode) m.colorNode = m.colorNode.mul(paintNode);
  m.metalnessNode = float(solid ? 0.08 : metalness).mul(float(1).sub(grime.mul(0.4)));
  m.roughnessNode = float(Math.max(roughness, 0.48)).add(grime.mul(0.2)).add(fh.y.sub(0.5).mul(0.08 * flake));
  const flakeN = vec3(fh.x.sub(0.5), fh.y.sub(0.5), fh.z.sub(0.5)).mul(0.18 * flake);
  m.normalNode = perturbView(flakeN.add(rain.offset.mul(0.8)), 1.0);
  m.clearcoat = 1.0;
  m.clearcoatRoughnessNode = mix(float(coatRough), float(0.012), rain.mask).add(grime.mul(0.2));
  m.clearcoatNormalNode = perturbView(rain.offset, 1.1);
  m.envMapIntensity = 1.0;
  m.name = 'veh_paint';
  return m;
}

export function makeGlass({ opacity = 0.86 } = {}) {
  const m = new THREE.MeshPhysicalNodeMaterial({ transparent: true, depthWrite: true, side: THREE.FrontSide });
  const rain = rainNodes({ beadScale: 1.4, strength: 1.0 });
  m.colorNode = vec3(0.012, 0.014, 0.018);
  m.metalnessNode = float(0.0);
  m.roughnessNode = mix(float(0.03), float(0.0), rain.mask);
  m.opacityNode = float(opacity).add(rain.mask.mul(0.1));
  m.normalNode = perturbView(rain.offset, 1.4);
  m.specularIntensity = 1.0;
  m.ior = 1.52;
  m.name = 'veh_glass';
  return m;
}

export function makeStd(name, { color = 0x101010, metalness = 0, roughness = 0.5, wetRough = null, rain = false, emissive = null } = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = vec3(new THREE.Color(color).r, new THREE.Color(color).g, new THREE.Color(color).b);
  m.metalnessNode = float(metalness);
  if (rain) {
    const r = rainNodes({ strength: 0.7, streaks: false });
    m.roughnessNode = mix(float(roughness), float(wetRough ?? roughness), vehUniforms.wet).mul(float(1).sub(r.mask.mul(0.7)));
    m.normalNode = perturbView(r.offset, 0.8);
  } else {
    m.roughnessNode = wetRough != null ? mix(float(roughness), float(wetRough), vehUniforms.wet) : float(roughness);
  }
  if (emissive) m.emissiveNode = emissive;
  m.name = 'veh_' + name;
  return m;
}

export function makeHeadLight(L = instanceColor) {
  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = vec3(0.02);
  m.roughnessNode = float(0.1);
  m.metalnessNode = float(0.0);
  const s = L.x.mul(vehUniforms.headBoost);
  m.emissiveNode = vec3(0.92, 0.94, 1.0).mul(s.mul(22.0));
  m.name = 'veh_head';
  return m;
}

export function makeTailLight(L = instanceColor) {
  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = vec3(0.06, 0.0, 0.0);
  m.roughnessNode = float(0.15);
  m.metalnessNode = float(0.0);
  const seg = smoothstep(0.0, 0.25, fract(positionGeometry.x.mul(55.0))).mul(smoothstep(1.0, 0.75, fract(positionGeometry.x.mul(55.0))));
  const ledMod = seg.mul(0.35).add(0.65);
  const s = L.y.mul(2.4).add(L.z.mul(7.5)).mul(vehUniforms.tailBoost).mul(ledMod);
  m.emissiveNode = vec3(1.0, 0.04, 0.02).mul(s);
  m.name = 'veh_tail';
  return m;
}

export function makeTurn(L = instanceColor) {
  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = vec3(0.3, 0.12, 0.0);
  m.roughnessNode = float(0.2);
  m.emissiveNode = vec3(1.0, 0.42, 0.02).mul(L.y.mul(0.45));
  m.name = 'veh_turn';
  return m;
}

export function makeAux(kind, L = instanceColor) {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  m.roughnessNode = float(0.25);
  if (kind === 'taxi') {
    // Red glowing "空车" LED sign on the roof & windshield of Hangzhou Green Taxis
    const kTex = getTaxiKongcheTexture();
    const samp = texture(kTex, uv());
    const onAmt = max(L.y, float(0.85)); // Keep "空车" lit even when parked waiting for passengers
    m.colorNode = samp.rgb.mul(0.25);
    m.emissiveNode = vec3(1.0, 0.035, 0.02).mul(samp.r).mul(onAmt.mul(7.5));
  } else if (kind === 'av') {
    const pulse = sin(time.mul(5.0)).mul(0.2).add(0.8);
    m.colorNode = vec3(0.05);
    m.emissiveNode = vec3(0.15, 0.85, 0.55).mul(L.y.mul(3.5).mul(pulse));
  } else {
    m.colorNode = vec3(0.05);
    m.emissiveNode = vec3(0.2, 0.7, 1.0).mul(L.y.mul(1.8));
  }
  m.name = 'veh_aux_' + kind;
  return m;
}

export function makePlate(type = 'kei', L = instanceColor) {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const pTex = getHangzhouPlateTexture(type);
  const samp = texture(pTex, uv());
  m.colorNode = samp.rgb;
  m.roughnessNode = float(0.32);
  m.metalnessNode = float(0.08);
  // Subtle license-plate lamp illumination so `浙A` plate is clearly readable at night
  const lamp = max(L.y, float(0.45));
  m.emissiveNode = samp.rgb.mul(lamp.mul(0.42));
  m.name = 'veh_plate_' + type;
  return m;
}

// Build the full material set for one vehicle type.
export function buildMaterialSet(type, solo = null) {
  const L = solo ? solo.light : instanceColor;
  const paintCfg = {
    hero: { metalness: 0.7, roughness: 0.3, flake: 1.0 },
    kei: { metalness: 0.35, roughness: 0.36, flake: 0.6 },
    taxi: { metalness: 0.18, roughness: 0.28, flake: 0.35, solid: true },
    van: { metalness: 0.1, roughness: 0.42, flake: 0.2, solid: true },
    av: { metalness: 0.65, roughness: 0.32, flake: 0.4 },
  }[type] || {};
  const rimCfg = {
    hero: { color: 0x0b0b0c, metalness: 1, roughness: 0.32 },
    kei: { color: 0x9a9ca0, metalness: 1, roughness: 0.38 },
    taxi: { color: 0xc2c6cc, metalness: 1, roughness: 0.25 },
    van: { color: 0xc8c8c4, metalness: 0.6, roughness: 0.45 },
    av: { color: 0x202022, metalness: 1, roughness: 0.3 },
  }[type];
  return {
    paint: makePaint(paintCfg, solo ? solo.paint : null),
    glass: makeGlass({ opacity: type === 'av' ? 0.78 : 0.86 }),
    chrome: makeStd('chrome', { color: 0xf2f2f4, metalness: 1, roughness: 0.06 }),
    rubber: makeStd('rubber', { color: 0x0b0b0c, roughness: 0.82, wetRough: 0.5 }),
    lights_head: makeHeadLight(L),
    lights_tail: makeTailLight(L),
    interior: makeStd('interior', { color: 0x0e0d0c, roughness: 0.8 }),
    trim: makeStd('trim', { color: 0x050506, roughness: 0.32, wetRough: 0.12, rain: true }),
    rim: makeStd('rim', rimCfg),
    metal: makeStd('metal', { color: 0x6a6a6c, metalness: 1, roughness: 0.42 }),
    caliper: makeStd('caliper', { color: type === 'hero' ? 0xb01010 : 0x2a2a2c, roughness: 0.4 }),
    plate: makePlate(type, L),
    lights_aux: makeAux(type, L),
    lights_turn: makeTurn(L),
  };
}

// materials whose InstancedMeshes need a per-instance colour
export const PAINT_MATS = new Set(['paint']);
export const LIGHT_MATS = new Set(['lights_head', 'lights_tail', 'lights_turn', 'lights_aux', 'plate']);
