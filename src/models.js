// Low-poly characters built from boxes, N64 style: each model faces +x with its feet at the
// origin, and has named pivots (legs, arms, head) that pose() rotates every frame. Every model
// owns its materials, so it can flash white when hit.
import * as THREE from 'three';
import { ATTACKS } from './player.js';

const geoCache = new Map();
function boxGeo(w, h, d) {
  const key = `${w},${h},${d}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(key);
}

class Builder {
  constructor() {
    this.root = new THREE.Group();
    this.materials = [];
    this.byColor = new Map();
  }

  mat(color, emissive = null) {
    const key = `${color}|${emissive}`;
    if (!this.byColor.has(key)) {
      const m = new THREE.MeshLambertMaterial({ color });
      if (emissive) {
        m.emissive = new THREE.Color(emissive);
        m.userData.glow = new THREE.Color(emissive);
      }
      m.userData.base = m.emissive.clone();
      this.materials.push(m);
      this.byColor.set(key, m);
    }
    return this.byColor.get(key);
  }

  /** A box of size (w, h, d) centred at (x, y, z) inside `parent`. */
  box(parent, w, h, d, x, y, z, color, emissive = null) {
    const mesh = new THREE.Mesh(boxGeo(w, h, d), this.mat(color, emissive));
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  pivot(parent, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  done(parts) {
    return { root: this.root, materials: this.materials, ...parts };
  }
}

/** Two legs hanging from hip pivots, with boots. */
function legs(b, parent, { hipY, spread, thick, length, pants, boots }) {
  const out = [];
  for (const side of [-1, 1]) {
    const hip = b.pivot(parent, 0, hipY, side * spread);
    b.box(hip, thick, length, thick, 0, -length / 2, 0, pants);
    b.box(hip, thick * 1.5, thick * 0.6, thick * 1.1, thick * 0.25, -length + thick * 0.3, 0, boots);
    out.push(hip);
  }
  return out;
}

function arms(b, parent, { shoulderY, spread, thick, length, sleeve, hand }) {
  const out = [];
  for (const side of [-1, 1]) {
    const shoulder = b.pivot(parent, 0, shoulderY, side * spread);
    b.box(shoulder, thick, length, thick, 0, -length / 2, 0, sleeve);
    b.box(shoulder, thick * 1.1, thick * 1.1, thick * 1.1, 0, -length - thick * 0.4, 0, hand);
    out.push(shoulder);
  }
  return out;
}

// ------------------------------------------------------------------- Maximus

export function buildHero() {
  const b = new Builder();
  const body = b.pivot(b.root, 0, 0, 0);
  const [legL, legR] = legs(b, body, { hipY: 0.95, spread: 0.13, thick: 0.18, length: 0.92, pants: '#2038a8', boots: '#101014' });
  b.box(body, 0.3, 0.62, 0.48, 0, 1.26, 0, '#181818'); // jacket
  b.box(body, 0.04, 0.5, 0.18, 0.16, 1.26, 0, '#bcbcbc'); // hoodie front
  b.box(body, 0.3, 0.1, 0.16, 0, 1.53, -0.17, '#d82800'); // red stripe on the shoulder
  const head = b.pivot(body, 0, 1.62, 0);
  b.box(head, 0.34, 0.36, 0.32, 0, 0.14, 0, '#7c7c7c'); // hood
  b.box(head, 0.06, 0.22, 0.2, 0.15, 0.1, 0, '#050505'); // shadowed face
  b.box(head, 0.03, 0.08, 0.12, 0.17, 0.02, 0, '#c86c50'); // chin
  const eye = b.box(head, 0.02, 0.03, 0.04, 0.185, 0.12, 0.04, '#ffffff', '#ff2050');
  const [armL, armR] = arms(b, body, { shoulderY: 1.5, spread: 0.3, thick: 0.14, length: 0.6, sleeve: '#181818', hand: '#fcbcb0' });
  const shoulderPads = [b.box(body, 0.34, 0.14, 0.18, 0, 1.6, -0.3, '#7c7c7c'), b.box(body, 0.34, 0.14, 0.18, 0, 1.6, 0.3, '#7c7c7c')];

  // Power arms, all hanging off the right shoulder and shown one at a time.
  const claws = b.pivot(armR, 0, -0.68, 0);
  for (let i = -1; i <= 1; i++) b.box(claws, 0.04, 0.42, 0.04, 0.04, -0.2, i * 0.06, '#d82800', '#400000');
  const whip = b.pivot(armR, 0, -0.68, 0);
  const whipSegments = [];
  for (let i = 0; i < 14; i++) whipSegments.push(b.box(whip, 0.1, 0.5, 0.1, 0, -0.25 - i * 0.5, 0, i % 2 ? '#881400' : '#d82800'));
  const whipTip = b.box(whip, 0.18, 0.2, 0.18, 0, -7.2, 0, '#bcbcbc');
  const blade = b.pivot(armR, 0, -0.68, 0);
  b.box(blade, 0.05, 1.45, 0.16, 0, -0.72, 0, '#881400', '#300000');
  b.box(blade, 0.06, 1.4, 0.03, 0, -0.72, 0.09, '#e0e0e8');
  b.box(blade, 0.05, 0.14, 0.1, 0, -1.48, 0.03, '#ffffff');

  const disguise = buildSoldier();
  disguise.root.visible = false;
  b.root.add(disguise.root);

  return b.done({ kind: 'hero', body, head, legL, legR, armL, armR, eye, shoulderPads, claws, whip, whipSegments, whipTip, blade, disguise });
}

const WALK = (t, speed) => Math.sin(t * speed);

function runCycle(m, t, amount, speed = 0.35) {
  const s = WALK(t, speed) * amount;
  m.legL.rotation.z = s;
  m.legR.rotation.z = -s;
  m.armL.rotation.z = -s * 0.8;
  m.armR.rotation.z = s * 0.8;
}

function resetPose(m) {
  for (const part of [m.body, m.legL, m.legR, m.armL, m.armR, m.head]) part?.rotation.set(0, 0, 0);
  m.body.position.y = 0;
}

export function poseHero(m, p, t) {
  m.disguise.root.visible = p.disguised && p.anim !== 'dev';
  m.body.visible = !m.disguise.root.visible;
  if (m.disguise.root.visible) {
    poseSoldier(m.disguise, { state: p.attack ? 'aim' : 'patrol', animT: p.animT, vx: p.vx, vz: p.vz, muzzle: 0 });
    return;
  }
  resetPose(m);
  const speed = Math.hypot(p.vx, p.vz);
  const atk = p.attack;
  const def = atk && ATTACKS[atk.power][atk.index];
  const active = def && atk.t >= def.from && atk.t <= def.to;
  const windup = def && atk.t < def.from;

  for (const s of m.shoulderPads) s.visible = p.armor;
  m.claws.visible = p.power === 'claws';
  m.whip.visible = p.power === 'whip' && !!atk;
  m.blade.visible = p.power === 'blade';
  const glowing = p.anim === 'dev' || (atk && p.power !== 'fists');
  m.eye.material.emissive.set(glowing ? '#ff2050' : '#000000');

  switch (p.anim) {
    case 'run':
      runCycle(m, p.animT, Math.min(1, speed / 6) * 0.9);
      m.body.rotation.z = -0.12;
      break;
    case 'wall':
      runCycle(m, p.animT, 1, 0.55);
      m.body.rotation.z = 0.25; // leaning back off the wall
      break;
    case 'jump':
      m.legL.rotation.z = 0.7;
      m.legR.rotation.z = -0.3;
      m.armL.rotation.z = -0.6;
      m.armR.rotation.z = 0.8;
      break;
    case 'fall':
      m.legL.rotation.z = 0.3;
      m.legR.rotation.z = -0.2;
      m.armL.rotation.x = 0.5;
      m.armR.rotation.x = -0.5;
      break;
    case 'glide':
    case 'dev':
      m.armL.rotation.x = 1.4;
      m.armR.rotation.x = -1.4;
      m.legL.rotation.x = 0.25;
      m.legR.rotation.x = -0.25;
      if (p.anim === 'dev') m.body.position.y = 0.3;
      break;
    case 'dash':
      m.body.rotation.z = -0.5;
      m.armL.rotation.z = -1.1;
      m.armR.rotation.z = -1.1;
      m.legL.rotation.z = -0.6;
      m.legR.rotation.z = 0.4;
      break;
    case 'slam':
      m.body.rotation.z = -0.6;
      m.armL.rotation.z = 2.6;
      m.armR.rotation.z = 2.6;
      break;
    case 'consume':
      m.armR.rotation.z = Math.PI / 2;
      m.armL.rotation.z = 1.2;
      m.body.rotation.z = -0.2;
      break;
    case 'hurt':
      m.body.rotation.z = 0.35;
      m.armL.rotation.x = 0.8;
      m.armR.rotation.x = -0.8;
      break;
    default:
      m.armL.rotation.z = Math.sin(t / 30) * 0.05;
      m.armR.rotation.z = -Math.sin(t / 30) * 0.05;
  }

  if (atk) {
    const arm = m.armR;
    if (atk.power === 'fists') {
      if (atk.index === 2) arm.rotation.z = windup ? -0.8 : active ? Math.PI * 0.95 : 1.2;
      else arm.rotation.z = windup ? -0.7 : active ? Math.PI / 2 : 0.6;
      if (atk.index === 1) {
        m.armL.rotation.z = windup ? -0.7 : active ? Math.PI / 2 : 0.6;
        arm.rotation.z = 0.2;
      }
    } else if (atk.power === 'claws') {
      arm.rotation.z = windup ? 2.6 : active ? 2.6 - ((atk.t - def.from) / (def.to - def.from)) * 2.4 : 0.3;
      m.body.rotation.z = active ? -0.3 : 0;
    } else if (atk.power === 'whip') {
      arm.rotation.z = windup ? -1.3 : Math.PI / 2;
      const ext = active ? Math.min(1, (atk.t - def.from + 1) / 4) : windup ? 0.05 : Math.max(0.05, 1 - (atk.t - def.to) / 8);
      m.whip.scale.set(1, ext, 1);
    } else if (atk.power === 'blade') {
      if (atk.index === 0) {
        // Horizontal slash: arm out front, sweeping from the right side across to the left
        arm.rotation.z = Math.PI / 2;
        const s = windup ? 0 : Math.min(1, (atk.t - def.from) / (def.to - def.from));
        arm.rotation.y = -1.3 + s * 2.6;
      } else {
        // Overhead cleave
        arm.rotation.z = windup ? Math.PI * 0.95 : active ? Math.PI * 0.95 - ((atk.t - def.from) / (def.to - def.from)) * 2.4 : 0.5;
        m.body.rotation.z = active ? -0.35 : 0;
      }
    }
  }
}

// ------------------------------------------------------------------- Soldiers

export function buildSoldier() {
  const b = new Builder();
  const body = b.pivot(b.root, 0, 0, 0);
  const [legL, legR] = legs(b, body, { hipY: 0.95, spread: 0.13, thick: 0.18, length: 0.92, pants: '#304818', boots: '#181818' });
  b.box(body, 0.32, 0.62, 0.5, 0, 1.27, 0, '#588028');
  b.box(body, 0.34, 0.4, 0.34, 0.02, 1.32, 0, '#304818'); // vest
  b.box(body, 0.34, 0.06, 0.52, 0, 0.98, 0, '#181818'); // belt
  const head = b.pivot(body, 0, 1.62, 0);
  b.box(head, 0.34, 0.14, 0.36, 0, 0.26, 0, '#304818'); // helmet
  b.box(head, 0.4, 0.04, 0.42, 0, 0.19, 0, '#304818');
  b.box(head, 0.3, 0.24, 0.3, 0.02, 0.06, 0, '#3c3c3c'); // gas mask
  b.box(head, 0.03, 0.05, 0.22, 0.18, 0.1, 0, '#ff2050', '#a01030'); // lenses
  b.box(head, 0.1, 0.1, 0.1, 0.2, -0.04, 0, '#181818'); // filter
  const [armL, armR] = arms(b, body, { shoulderY: 1.5, spread: 0.32, thick: 0.14, length: 0.58, sleeve: '#588028', hand: '#181818' });
  const rifle = b.pivot(body, 0.1, 1.2, 0.12);
  b.box(rifle, 0.9, 0.1, 0.08, 0.3, 0, 0, '#181818');
  b.box(rifle, 0.14, 0.18, 0.08, 0.05, -0.1, 0, '#181818');
  const muzzle = b.box(rifle, 0.12, 0.12, 0.12, 0.8, 0, 0, '#f8b800', '#f8b800');
  return b.done({ kind: 'soldier', body, head, legL, legR, armL, armR, rifle, muzzle });
}

export function poseSoldier(m, e) {
  resetPose(m);
  const speed = Math.hypot(e.vx, e.vz);
  if (speed > 0.3) runCycle(m, e.animT, Math.min(0.8, speed / 3), 0.25);
  const aiming = e.state === 'aim';
  m.rifle.rotation.set(0, aiming ? 0 : 0.9, aiming ? 0 : -0.5);
  m.rifle.position.set(aiming ? 0.25 : 0.1, aiming ? 1.35 : 1.2, aiming ? 0.05 : 0.12);
  if (aiming) {
    m.armR.rotation.z = Math.PI / 2 - 0.1;
    m.armL.rotation.z = Math.PI / 2 - 0.3;
    m.armL.rotation.x = -0.4;
  }
  m.muzzle.visible = (e.muzzle ?? 0) > 0;
}

// ------------------------------------------------------------------- Infected

export function buildInfected() {
  const b = new Builder();
  const body = b.pivot(b.root, 0, 0, 0);
  const [legL, legR] = legs(b, body, { hipY: 0.88, spread: 0.12, thick: 0.17, length: 0.85, pants: '#101c58', boots: '#4c6844' });
  const torso = b.pivot(body, 0, 0.9, 0);
  b.box(torso, 0.3, 0.55, 0.44, 0, 0.27, 0, '#3c3c3c'); // torn shirt
  b.box(torso, 0.04, 0.2, 0.12, 0.15, 0.25, 0.08, '#8ca878');
  b.box(torso, 0.04, 0.1, 0.1, 0.15, 0.4, -0.1, '#881400');
  const head = b.pivot(torso, 0.08, 0.62, 0);
  b.box(head, 0.3, 0.3, 0.28, 0.04, 0.1, 0, '#8ca878');
  b.box(head, 0.04, 0.05, 0.05, 0.2, 0.14, 0.07, '#ff2050', '#ff2050');
  b.box(head, 0.04, 0.05, 0.05, 0.2, 0.14, -0.07, '#ff2050', '#ff2050');
  b.box(head, 0.04, 0.06, 0.18, 0.2, 0.0, 0, '#881400');
  const [armL, armR] = arms(b, torso, { shoulderY: 0.5, spread: 0.28, thick: 0.12, length: 0.62, sleeve: '#8ca878', hand: '#4c6844' });
  return b.done({ kind: 'infected', body, torso, head, legL, legR, armL, armR });
}

export function poseInfected(m, e) {
  resetPose(m);
  m.torso.rotation.set(0, 0, -0.45); // hunched
  const speed = Math.hypot(e.vx, e.vz);
  if (speed > 0.3) {
    const s = Math.sin(e.animT * 0.22 * (e.speed || 1)) * 0.6;
    m.legL.rotation.z = s;
    m.legR.rotation.z = -s;
  }
  const reach = e.state === 'windup' ? 2.4 : e.state === 'lunge' ? 1.7 : 1.35;
  m.armL.rotation.z = reach + Math.sin(e.animT * 0.1) * 0.1;
  m.armR.rotation.z = reach - Math.sin(e.animT * 0.1) * 0.1;
}

// ------------------------------------------------------------------- Hunters and the Supreme Hunter

export function buildHunter({ boss = false } = {}) {
  const b = new Builder();
  const skin = boss ? '#940084' : '#881400';
  const muscle = boss ? '#6844fc' : '#b0002a';
  const glow = boss ? '#c040ff' : null;
  const body = b.pivot(b.root, 0, 0, 0);
  const [legL, legR] = legs(b, body, { hipY: 1.0, spread: 0.3, thick: 0.34, length: 1.0, pants: skin, boots: '#181818' });
  const torso = b.pivot(body, 0, 1.0, 0);
  b.box(torso, 0.8, 1.0, 1.0, 0, 0.55, 0, skin);
  b.box(torso, 0.1, 0.4, 0.7, 0.4, 0.75, 0, muscle, glow);
  b.box(torso, 0.1, 0.18, 0.6, 0.4, 0.35, 0, muscle, glow);
  for (let i = 0; i < 4; i++) b.box(torso, 0.16, 0.16, 0.16, -0.46, 0.3 + i * 0.22, 0, '#e0e0e0'); // spine spikes
  const head = b.pivot(torso, 0.35, 1.12, 0);
  b.box(head, 0.5, 0.42, 0.44, 0.12, 0.1, 0, skin);
  b.box(head, 0.06, 0.06, 0.36, 0.38, -0.02, 0, '#fcfcfc'); // teeth
  b.box(head, 0.04, 0.06, 0.06, 0.38, 0.18, 0.12, boss ? '#f8b800' : '#ff2050', boss ? '#f8b800' : '#ff2050');
  b.box(head, 0.04, 0.06, 0.06, 0.38, 0.18, -0.12, boss ? '#f8b800' : '#ff2050', boss ? '#f8b800' : '#ff2050');
  const [armL, armR] = arms(b, torso, { shoulderY: 0.95, spread: 0.6, thick: 0.28, length: 1.0, sleeve: skin, hand: skin });
  for (const arm of [armL, armR]) {
    for (let i = -1; i <= 1; i++) b.box(arm, 0.06, 0.5, 0.06, 0.08, -1.35, i * 0.1, '#fcfcfc');
  }
  if (boss) b.root.scale.setScalar(1.42);
  return b.done({ kind: boss ? 'boss' : 'hunter', body, torso, head, legL, legR, armL, armR });
}

export function poseHunter(m, e) {
  resetPose(m);
  m.torso.rotation.z = -0.25;
  const speed = Math.hypot(e.vx, e.vz);
  if (speed > 0.5 && e.onGround) {
    const s = Math.sin(e.animT * 0.2) * 0.7;
    m.legL.rotation.z = s;
    m.legR.rotation.z = -s;
    m.armL.rotation.z = -s * 0.5;
    m.armR.rotation.z = s * 0.5;
  }
  if (e.state === 'windup' || e.state === 'chargeWindup') {
    m.armR.rotation.z = 2.8;
    m.armL.rotation.z = 2.4;
  } else if (e.state === 'swipe') {
    m.armR.rotation.z = Math.PI / 2;
    m.armR.rotation.y = -0.6;
  } else if (e.state === 'charge') {
    m.torso.rotation.z = -0.7;
    m.armL.rotation.z = -0.8;
    m.armR.rotation.z = -0.8;
  } else if (e.state === 'leap' || !e.onGround) {
    m.armL.rotation.z = 2.2;
    m.armR.rotation.z = 2.2;
    m.legL.rotation.z = 0.6;
    m.legR.rotation.z = -0.4;
  } else if (e.state === 'stunned') {
    m.torso.rotation.z = -0.9;
    m.armL.rotation.z = -0.3;
    m.armR.rotation.z = 0.3;
    m.head.rotation.x = Math.sin(e.animT * 0.15) * 0.4;
  }
}

// ------------------------------------------------------------------- The Behemoth

export function buildBehemoth() {
  const b = new Builder();
  const flesh = '#4a2a26';
  const hide = '#2c1816';
  const plate = '#6a645a';
  const crack = '#ff8a30';
  const body = b.pivot(b.root, 0, 0, 0);
  const [legL, legR] = legs(b, body, { hipY: 1.5, spread: 0.75, thick: 0.75, length: 1.5, pants: hide, boots: '#141010' });
  const torso = b.pivot(body, 0, 1.5, 0);
  b.box(torso, 2.4, 2.2, 2.6, 0, 1.1, 0, flesh);
  b.box(torso, 2.2, 0.5, 2.4, -0.1, 0.1, 0, hide);
  // Armour plates over the back and shoulders
  b.box(torso, 1.4, 0.5, 2.8, -0.6, 2.3, 0, plate);
  b.box(torso, 1.0, 0.5, 2.4, 0.5, 2.25, 0, plate);
  b.box(torso, 0.4, 1.6, 2.8, -1.3, 1.3, 0, plate);
  for (const z of [-1.4, 1.4]) b.box(torso, 1.4, 1.0, 0.3, 0.2, 1.6, z, plate);
  // Molten cracks between the plates
  const cracks = [];
  for (const [x, y, z, w, h, d] of [
    [-1.32, 1.6, 0.6, 0.06, 1.0, 0.1],
    [-1.32, 1.2, -0.7, 0.06, 0.8, 0.1],
    [-0.1, 2.52, 0, 0.1, 0.06, 2.2],
    [1.21, 1.4, 0.5, 0.06, 0.7, 0.1],
  ]) cracks.push(b.box(torso, w, h, d, x, y, z, '#ff6a20', crack));
  const head = b.pivot(torso, 1.35, 1.4, 0);
  b.box(head, 1.0, 0.9, 1.0, 0.3, 0.1, 0, flesh);
  b.box(head, 0.9, 0.3, 1.04, 0.3, 0.55, 0, plate);
  const jaw = b.pivot(head, 0.1, -0.3, 0);
  b.box(jaw, 0.9, 0.3, 0.9, 0.35, -0.1, 0, hide);
  b.box(jaw, 0.08, 0.1, 0.7, 0.78, 0.05, 0, '#fcfcfc');
  b.box(head, 0.06, 0.1, 0.12, 0.82, 0.25, 0.25, '#ff3020', crack);
  b.box(head, 0.06, 0.1, 0.12, 0.82, 0.25, -0.25, '#ff3020', crack);
  const acid = b.box(jaw, 0.1, 0.2, 0.5, 0.8, 0.2, 0, '#58d854', '#58d854');
  const [armL, armR] = arms(b, torso, { shoulderY: 1.8, spread: 1.55, thick: 0.75, length: 1.9, sleeve: flesh, hand: plate });
  for (let i = -1; i <= 1; i++) b.box(armR, 0.14, 0.7, 0.14, 0.2, -2.6, i * 0.25, '#fcfcfc');
  return b.done({ kind: 'behemoth', body, torso, head, jaw, acid, legL, legR, armL, armR, cracks });
}

export function poseBehemoth(m, e, t) {
  resetPose(m);
  m.torso.rotation.z = -0.15;
  const speed = Math.hypot(e.vx, e.vz);
  if (speed > 0.3) {
    const s = Math.sin(e.animT * 0.12) * 0.45;
    m.legL.rotation.z = s;
    m.legR.rotation.z = -s;
    m.armL.rotation.z = -s * 0.4;
    m.armR.rotation.z = s * 0.4;
  }
  m.jaw.rotation.z = 0;
  m.acid.visible = false;
  if (e.state === 'pound' || e.state === 'spikes') {
    const lift = Math.min(1, (34 - e.t) / 20);
    m.armL.rotation.z = 2.8 * lift;
    m.armR.rotation.z = 2.8 * lift;
    m.torso.rotation.z = 0.2 * lift;
  } else if (e.state === 'windup') {
    m.armR.rotation.z = 2.6;
  } else if (e.state === 'swipe') {
    m.armR.rotation.z = Math.PI / 2;
    m.armR.rotation.y = -0.8;
  } else if (e.state === 'spit') {
    m.jaw.rotation.z = -0.5;
    m.acid.visible = true;
    m.head.rotation.z = 0.2;
  } else if (e.state === 'stunned') {
    m.torso.rotation.z = -0.5;
    m.head.rotation.x = Math.sin(e.animT * 0.1) * 0.3;
  }
  const hot = e.phase === 3 ? (Math.floor(t / 5) % 2 ? '#ff3020' : '#ff9040') : '#ff8a30';
  for (const c of m.cracks) c.material.emissive.set(hot);
}

// ------------------------------------------------------------------- Gunship

export function buildHeli() {
  const b = new Builder();
  const body = b.pivot(b.root, 0, 0, 0);
  b.box(body, 3.2, 1.2, 1.4, 0, 0, 0, '#588028');
  b.box(body, 3.2, 0.3, 1.4, 0, -0.6, 0, '#304818');
  b.box(body, 0.9, 0.8, 1.2, 1.5, 0.1, 0, '#3cbcfc', '#103040'); // cockpit
  b.box(body, 3.4, 0.35, 0.35, -2.9, 0.2, 0, '#304818'); // tail boom
  b.box(body, 0.5, 1.2, 0.12, -4.5, 0.6, 0, '#304818');
  b.box(body, 0.8, 0.3, 0.5, 0.2, -0.3, 0.9, '#181818'); // rocket pods
  b.box(body, 0.8, 0.3, 0.5, 0.2, -0.3, -0.9, '#181818');
  for (const z of [-0.6, 0.6]) b.box(body, 2.6, 0.08, 0.08, 0, -1.0, z, '#181818'); // skids
  const rotor = b.pivot(body, 0, 0.75, 0);
  b.box(rotor, 0.2, 0.2, 0.2, 0, 0, 0, '#181818');
  b.box(rotor, 7, 0.05, 0.25, 0, 0.1, 0, '#bcbcbc');
  b.box(rotor, 0.25, 0.05, 7, 0, 0.1, 0, '#bcbcbc');
  const tail = b.pivot(body, -4.5, 0.7, 0.12);
  b.box(tail, 1.2, 0.18, 0.04, 0, 0, 0, '#bcbcbc');
  const light = b.box(body, 0.15, 0.15, 0.15, -1.5, 0.65, 0, '#ff2020', '#ff2020');
  return b.done({ kind: 'heli', body, rotor, tail, light });
}

export function poseHeli(m, e, t) {
  m.rotor.rotation.y = t * 0.9;
  m.tail.rotation.z = t * 1.3;
  m.body.rotation.z = -Math.max(-0.3, Math.min(0.3, Math.hypot(e.vx, e.vz) * 0.03));
  m.light.visible = Math.floor(t / 20) % 2 === 0;
}

export const BUILDERS = {
  infected: [buildInfected, poseInfected],
  soldier: [buildSoldier, poseSoldier],
  hunter: [buildHunter, poseHunter],
  boss: [() => buildHunter({ boss: true }), poseHunter],
  behemoth: [buildBehemoth, poseBehemoth],
  heli: [buildHeli, poseHeli],
};
