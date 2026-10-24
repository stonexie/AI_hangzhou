// Third-person placeholder avatar: articulated low-poly "edgerunner" (yellow techwear jacket, glowing cyberware)
// with a procedural walk/run/crouch/air cycle. Used only if the crowd system doesn't provide createCharacter().
import * as THREE from 'three/webgpu';
import { color, float, time, sin, uv, mix, vec3 } from 'three/tsl';

function std(hex, rough = 0.6, metal = 0.0, extra = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ color: hex, roughness: rough, metalness: metal, ...extra });
  return m;
}

function capsule(r, len, mat, seg = 10) {
  const g = new THREE.CapsuleGeometry(r, len, 4, seg);
  g.translate(0, -len / 2 - r, 0); // pivot at top (joint)
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

export function createAvatar() {
  const root = new THREE.Group();
  root.name = 'player-avatar';

  const skin = std(0xd8a98c, 0.55);
  // Longquan celadon silk stand-collar jacket (龙泉青瓷新中式立领外套)
  const jacket = new THREE.MeshPhysicalNodeMaterial({ color: 0x6b8e85, roughness: 0.48, metalness: 0.0, clearcoat: 0.2, clearcoatRoughness: 0.45 });
  const silkCream = std(0xeae2d3, 0.55, 0.0);
  const black = std(0x1f2426, 0.6, 0.05);
  const pants = std(0x1b2024, 0.78);
  const boots = std(0x181615, 0.45, 0.08);
  const hair = std(0x141210, 0.55);
  const goldTrim = std(0xc89b4b, 0.35, 0.65);
  const jade = new THREE.MeshPhysicalNodeMaterial({ color: 0x7fc8a9, roughness: 0.22, metalness: 0.0, clearcoat: 0.8 });

  // --- hips / pelvis
  const hips = new THREE.Group(); hips.position.y = 0.96; root.add(hips);
  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.12, 4, 10), pants);
  pelvis.rotation.z = Math.PI / 2; pelvis.scale.set(0.9, 1, 0.75); hips.add(pelvis);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 14), black); belt.position.y = 0.07; belt.scale.z = 0.75; hips.add(belt);
  // Waist jade pendant (温润江南玉佩)
  const pendant = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 8, 16), jade);
  pendant.position.set(0.13, 0.01, -0.09); pendant.rotation.y = 0.4; hips.add(pendant);

  // --- spine / torso (New-Chinese stand-collar jacket)
  const spine = new THREE.Group(); spine.position.y = 0.08; hips.add(spine);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.3, 6, 14), jacket);
  torso.position.y = 0.3; torso.scale.set(1.05, 1, 0.72); torso.castShadow = true; spine.add(torso);
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.215, 0.12, 16, 1, true), black); hem.position.y = 0.06; hem.scale.z = 0.74; spine.add(hem);
  // Traditional Chinese stand collar (中式立领)
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.145, 0.09, 14, 1, true), black);
  collar.position.y = 0.59; collar.scale.z = 0.85; spine.add(collar);
  const collarIn = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.085, 14, 1, true), silkCream);
  collarIn.material.side = THREE.BackSide; collarIn.position.y = 0.59; collarIn.scale.z = 0.85; spine.add(collarIn);
  // Subtle embroidered roundel on back & frog buttons (盘扣) on chest
  const roundel = new THREE.Mesh(new THREE.RingGeometry(0.045, 0.065, 16), goldTrim); roundel.position.set(0, 0.38, 0.139); roundel.rotation.y = Math.PI; spine.add(roundel);
  for (let i = 0; i < 3; i++) {
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.012, 0.012), goldTrim);
    knot.position.set(0, 0.46 - i * 0.09, -0.139); spine.add(knot);
  }

  // --- neck / head (natural Hangzhou hairstyle, no cyber visor or mohawk)
  const neck = new THREE.Group(); neck.position.y = 0.62; spine.add(neck);
  const neckM = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), skin); neckM.position.y = 0.04; neck.add(neckM);
  const head = new THREE.Group(); head.position.y = 0.1; neck.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 14), skin); skull.scale.set(0.9, 1.08, 1.0); skull.position.y = 0.1; skull.castShadow = true; head.add(skull);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), skin); jaw.position.set(0, 0.03, -0.03); jaw.scale.set(1, 0.8, 1.05); head.add(jaw);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.116, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  hairCap.position.y = 0.12; hairCap.scale.set(0.94, 1.08, 1.06); head.add(hairCap);
  const hairCrown = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), hair);
  hairCrown.position.set(0, 0.225, 0.03); head.add(hairCrown);

  // --- arms (both sleeves in matching celadon silk with cream cuffs)
  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(s * 0.24, 0.52, 0); spine.add(shoulder);
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.082, 12, 10), jacket); pad.scale.set(1.05, 0.9, 1); shoulder.add(pad);
    const upper = capsule(0.060, 0.24, jacket); shoulder.add(upper);
    const elbow = new THREE.Group(); elbow.position.y = -0.36; shoulder.add(elbow);
    const fore = capsule(0.052, 0.22, jacket); elbow.add(fore);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.05, 10), silkCream); cuff.position.y = -0.24; elbow.add(cuff);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.095, 0.04), skin); hand.position.y = -0.34; elbow.add(hand);
    arms.push({ s, shoulder, elbow });
  }

  // --- legs
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.1, -0.02, 0); hips.add(hip);
    const thigh = capsule(0.08, 0.3, pants); hip.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
    const shin = capsule(0.065, 0.3, pants); knee.add(shin);
    const ankle = new THREE.Group(); ankle.position.y = -0.43; knee.add(ankle);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.095, 0.26), boots); boot.position.set(0, -0.04, -0.05); boot.castShadow = true; ankle.add(boot);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.114, 0.022, 0.268), silkCream); sole.position.set(0, -0.09, -0.05); sole.scale.y = 0.5; ankle.add(sole);
    legs.push({ s, hip, knee, ankle });
  }

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = true; } });

  let phase = 0, crouchK = 0, airK = 0, speedK = 0;
  return {
    object: root,
    update(dt, st) {
      const spd = st.speed || 0;
      speedK += (Math.min(spd / 7.5, 1) - speedK) * Math.min(1, dt * 8);
      crouchK += ((st.crouch ? 1 : 0) - crouchK) * Math.min(1, dt * 10);
      airK += ((st.grounded ? 0 : 1) - airK) * Math.min(1, dt * 8);
      phase += dt * (2.2 + spd * 1.05);
      const run = speedK;
      const swing = (0.35 + 0.55 * run) * Math.min(1, spd / 1.2) * (1 - airK * 0.7);
      const bob = Math.abs(Math.sin(phase)) * (0.02 + 0.05 * run) * Math.min(1, spd);
      hips.position.y = 0.96 - crouchK * 0.34 + bob - airK * 0.05;
      spine.rotation.x = -(0.06 + run * 0.22) * Math.min(1, spd / 2) - crouchK * 0.35;
      spine.rotation.y = Math.sin(phase) * 0.12 * swing;
      hips.rotation.y = -Math.sin(phase) * 0.08 * swing;
      neck.rotation.x = -spine.rotation.x * 0.7;
      for (const L of legs) {
        const p = phase + (L.s > 0 ? Math.PI : 0);
        const sw = Math.sin(p) * swing;
        L.hip.rotation.x = sw + crouchK * 1.0 + airK * 0.6 * (L.s > 0 ? 1 : 0.4);
        L.knee.rotation.x = -(Math.max(0, -Math.cos(p)) * swing * 1.6 + crouchK * 1.7 + airK * 0.9 + 0.05);
        L.ankle.rotation.x = -(L.hip.rotation.x + L.knee.rotation.x) * 0.8;
      }
      for (const A of arms) {
        const p = phase + (A.s > 0 ? 0 : Math.PI);
        A.shoulder.rotation.x = Math.sin(p) * swing * 0.9 + airK * -0.5;
        A.shoulder.rotation.z = A.s * (0.12 + airK * 0.4 + crouchK * 0.1);
        A.elbow.rotation.x = 0.25 + run * 1.1 + crouchK * 0.4;
      }
      // idle breathing
      torso.scale.y = 1 + Math.sin(performance.now() * 0.002) * 0.01 * (1 - run);
    },
  };
}
