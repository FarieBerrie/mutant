// Low-poly characters, N64 style. Each model faces +x with its feet at the origin and is a tree
// of pivots (hips, knees, shoulders, elbows, head...). All the shapes hanging off one pivot are
// merged into a single vertex-coloured mesh, so a character costs a handful of draw calls.
// pose*() functions set target angles; smoothPose() eases the real angles toward them so limbs
// blend between poses instead of snapping.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ATTACKS } from './player.js';

const scratch = new THREE.Color();

/** Collects coloured shapes per pivot, then merges them. */
class Builder {
  constructor() {
    this.root = new THREE.Group();
    this.solid = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.parts = new Map(); // pivot → { solid: [], glow: [] }
    this.pivots = [];
    this.body = this.pivot(this.root, 0, 0, 0);
  }

  pivot(parent, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    this.parts.set(g, { solid: [], glow: [] });
    this.pivots.push(g);
    return g;
  }

  add(pivot, geometry, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, glow = false } = {}) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.deleteAttribute('uv');
    if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    g.translate(x, y, z);
    scratch.set(color);
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([scratch.r, scratch.g, scratch.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.get(pivot)[glow ? 'glow' : 'solid'].push(g);
  }

  box(pivot, w, h, d, x, y, z, color, opts = {}) {
    this.add(pivot, new THREE.BoxGeometry(w, h, d), color, { x, y, z, ...opts });
  }

  /** A tapered cylinder standing on y (rTop at the top end). */
  cyl(pivot, rTop, rBottom, h, x, y, z, color, { sides = 7, ...opts } = {}) {
    this.add(pivot, new THREE.CylinderGeometry(rTop, rBottom, h, sides), color, { x, y, z, ...opts });
  }

  cone(pivot, r, h, x, y, z, color, { sides = 5, ...opts } = {}) {
    this.add(pivot, new THREE.ConeGeometry(r, h, sides), color, { x, y, z, ...opts });
  }

  ball(pivot, r, x, y, z, color, opts = {}) {
    this.add(pivot, new THREE.IcosahedronGeometry(r, 1), color, { x, y, z, ...opts });
  }

  done(parts) {
    for (const [pivot, { solid, glow }] of this.parts) {
      if (solid.length) pivot.add(new THREE.Mesh(mergeGeometries(solid), this.solid));
      if (glow.length) pivot.add(new THREE.Mesh(mergeGeometries(glow), this.glowMaterial));
    }
    for (const p of this.pivots) p.userData.rest = p.position.clone();
    return { root: this.root, body: this.body, materials: [this.solid], glow: this.glowMaterial, pivots: this.pivots, ...parts };
  }
}

/**
 * A two-part leg hanging from a hip pivot, with a knee pivot and a shoe. Returns [hip, knee].
 */
function leg(b, parent, { x = 0, y, z, thigh, shin, rHip, rKnee, rAnkle, pants, shoe, sole = null, shoeLen = 0.28 }) {
  const hip = b.pivot(parent, x, y, z);
  b.cyl(hip, rHip, rKnee, thigh, 0, -thigh / 2, 0, pants);
  const knee = b.pivot(hip, 0, -thigh, 0);
  b.cyl(knee, rKnee, rAnkle, shin, 0, -shin / 2, 0, pants);
  b.box(knee, shoeLen, rAnkle * 1.5, rAnkle * 2.2, shoeLen * 0.22, -shin - rAnkle * 0.2, 0, shoe);
  if (sole) b.box(knee, shoeLen + 0.01, 0.03, rAnkle * 2.25, shoeLen * 0.22, -shin - rAnkle * 0.85, 0, sole);
  return [hip, knee];
}

/** A two-part arm hanging from a shoulder pivot. Returns [shoulder, elbow]. */
function arm(b, parent, { y, z, upper, fore, rShoulder, rElbow, rWrist, sleeve, hand, handSize }) {
  const shoulder = b.pivot(parent, 0, y, z);
  b.ball(shoulder, rShoulder * 1.15, 0, -0.02, 0, sleeve);
  b.cyl(shoulder, rShoulder, rElbow, upper, 0, -upper / 2, 0, sleeve);
  const elbow = b.pivot(shoulder, 0, -upper, 0);
  b.cyl(elbow, rElbow, rWrist, fore, 0, -fore / 2, 0, sleeve);
  if (hand) b.box(elbow, handSize, handSize * 1.2, handSize * 0.8, 0, -fore - handSize * 0.45, 0, hand);
  return [shoulder, elbow];
}

/** Eases every pivot's rotation toward the angles the pose set this frame. */
export function smoothPose(m, k) {
  if (m.noSmoothing) return;
  if (m.disguise?.root.visible) smoothPose(m.disguise, k);
  for (const p of m.pivots) {
    const r = p.rotation;
    const prev = (p.userData.prev ??= r.clone());
    prev.x += (r.x - prev.x) * k;
    prev.y += (r.y - prev.y) * k;
    prev.z += (r.z - prev.z) * k;
    r.copy(prev);
  }
}

function resetPose(m) {
  for (const p of m.pivots) {
    p.rotation.set(0, 0, 0);
    p.position.copy(p.userData.rest);
  }
}

/** Running: legs swing with bending knees, arms counter-swing with bent elbows. */
function runCycle(m, t, amount, speed = 0.35) {
  const s = Math.sin(t * speed);
  m.hipL.rotation.z = s * 0.9 * amount;
  m.hipR.rotation.z = -s * 0.9 * amount;
  m.kneeL.rotation.z = -(0.15 + Math.max(0, -s) * 1.3) * amount;
  m.kneeR.rotation.z = -(0.15 + Math.max(0, s) * 1.3) * amount;
  m.armL.rotation.z = -s * 0.7 * amount;
  m.armR.rotation.z = s * 0.7 * amount;
  m.elbowL.rotation.z = 0.9 * amount;
  m.elbowR.rotation.z = 0.9 * amount;
  m.body.position.y = Math.abs(Math.cos(t * speed)) * 0.06 * amount;
}

// ------------------------------------------------------------------- Maximus

export function buildHero() {
  const b = new Builder();
  const JACKET = '#1c1c22';
  const HOOD = '#7c7c84';
  const JEANS = '#2040a0';
  const [hipL, kneeL] = leg(b, b.body, { y: 0.95, z: -0.11, thigh: 0.48, shin: 0.44, rHip: 0.1, rKnee: 0.08, rAnkle: 0.065, pants: JEANS, shoe: '#18181c', sole: '#e8e8e8' });
  const [hipR, kneeR] = leg(b, b.body, { y: 0.95, z: 0.11, thigh: 0.48, shin: 0.44, rHip: 0.1, rKnee: 0.08, rAnkle: 0.065, pants: JEANS, shoe: '#18181c', sole: '#e8e8e8' });
  const torso = b.pivot(b.body, 0, 0.96, 0);
  b.cyl(torso, 0.2, 0.17, 0.22, 0, 0.1, 0, JACKET, { sides: 6 }); // waist
  b.box(torso, 0.28, 0.42, 0.44, 0, 0.38, 0, JACKET); // chest
  b.box(torso, 0.025, 0.4, 0.15, 0.145, 0.33, 0, '#c8c8cc'); // hoodie front
  b.box(torso, 0.03, 0.4, 0.012, 0.16, 0.33, 0, '#4a4a50'); // zip
  b.box(torso, 0.29, 0.07, 0.1, 0, 0.56, -0.18, '#d82800'); // red stripe
  b.box(torso, 0.18, 0.16, 0.34, -0.12, 0.6, 0, HOOD); // hood bunched at the neck
  const head = b.pivot(torso, 0.02, 0.62, 0);
  b.box(head, 0.32, 0.26, 0.3, 0, 0.12, 0, HOOD);
  b.cyl(head, 0.15, 0.15, 0.3, -0.01, 0.25, 0, HOOD, { rx: Math.PI / 2, sides: 8 }); // rounded top of the hood
  b.box(head, 0.06, 0.22, 0.2, 0.14, 0.11, 0, '#060608'); // face in shadow
  b.box(head, 0.03, 0.08, 0.11, 0.16, 0.03, 0, '#c86c50'); // chin
  b.box(head, 0.02, 0.025, 0.04, 0.18, 0.13, 0.045, '#ffffff', { glow: true });
  b.box(head, 0.02, 0.025, 0.04, 0.18, 0.13, -0.045, '#ffffff', { glow: true });
  const armSpec = { y: 0.54, upper: 0.3, fore: 0.28, rShoulder: 0.075, rElbow: 0.065, rWrist: 0.055, sleeve: JACKET, hand: '#e0a088', handSize: 0.09 };
  const [armL, elbowL] = arm(b, torso, { ...armSpec, z: -0.27 });
  const [armR, elbowR] = arm(b, torso, { ...armSpec, z: 0.27 });

  // Armour plates, shown with ARMOR on
  const plates = b.pivot(torso, 0, 0, 0);
  for (const z of [-0.27, 0.27]) b.box(plates, 0.32, 0.12, 0.2, 0, 0.62, z, '#8a8a92');
  b.box(plates, 0.04, 0.3, 0.36, 0.16, 0.36, 0, '#6a6a72');

  // Power arms, all on the right forearm, shown one at a time
  const claws = b.pivot(elbowR, 0, -0.33, 0);
  for (let i = -1; i <= 1; i++) b.cone(claws, 0.025, 0.42, 0.02, -0.2, i * 0.045, '#e02a10', { rz: Math.PI });
  const whip = b.pivot(elbowR, 0, -0.33, 0);
  for (let i = 0; i < 14; i++) b.cyl(whip, 0.06 - i * 0.002, 0.06 - i * 0.002, 0.52, 0, -0.26 - i * 0.5, 0, i % 2 ? '#881400' : '#d82800', { sides: 5 });
  b.cone(whip, 0.12, 0.3, 0, -7.2, 0, '#c8c8cc', { rz: Math.PI });
  const blade = b.pivot(elbowR, 0, -0.3, 0);
  b.box(blade, 0.045, 1.25, 0.15, 0, -0.62, 0, '#7a1208');
  b.box(blade, 0.05, 1.25, 0.03, 0, -0.62, 0.085, '#e8e8f0');
  b.cone(blade, 0.08, 0.3, 0, -1.38, 0.01, '#e8e8f0', { sides: 4, rz: Math.PI });

  const disguise = buildSoldier();
  disguise.root.visible = false;
  b.root.add(disguise.root);

  return b.done({ kind: 'hero', torso, head, hipL, hipR, kneeL, kneeR, armL, armR, elbowL, elbowR, plates, claws, whip, blade, disguise });
}

export function poseHero(m, p, t) {
  const disguised = p.disguised && p.anim !== 'dev';
  m.disguise.root.visible = disguised;
  m.body.visible = !disguised;
  if (disguised) {
    poseSoldier(m.disguise, { state: p.attack ? 'aim' : 'patrol', animT: p.animT, vx: p.vx, vz: p.vz, muzzle: 0 });
    return;
  }
  resetPose(m);
  const speed = Math.hypot(p.vx, p.vz);
  const atk = p.attack;
  const def = atk && ATTACKS[atk.power][atk.index];
  const active = def && atk.t >= def.from && atk.t <= def.to;
  const windup = def && atk.t < def.from;
  const swing = def && active ? (atk.t - def.from) / Math.max(1, def.to - def.from) : 0;

  m.plates.visible = p.armor;
  m.claws.visible = p.power === 'claws';
  m.whip.visible = p.power === 'whip' && !!atk;
  m.blade.visible = p.power === 'blade';
  m.glow.color.set(p.anim === 'dev' || (atk && p.power !== 'fists') ? '#ff2050' : '#ffffff');

  switch (p.anim) {
    case 'run':
      runCycle(m, p.animT, Math.min(1, speed / 7));
      m.torso.rotation.z = -0.15;
      break;
    case 'wall':
      runCycle(m, p.animT, 1, 0.55);
      m.torso.rotation.z = 0.2;
      break;
    case 'jump':
      m.hipL.rotation.z = 1.0;
      m.kneeL.rotation.z = -1.3;
      m.hipR.rotation.z = -0.2;
      m.kneeR.rotation.z = -0.5;
      m.armL.rotation.z = -0.5;
      m.armR.rotation.z = 0.9;
      m.elbowR.rotation.z = 0.6;
      break;
    case 'fall':
      m.hipL.rotation.z = 0.4;
      m.kneeL.rotation.z = -0.6;
      m.hipR.rotation.z = -0.1;
      m.kneeR.rotation.z = -0.3;
      m.armL.rotation.x = 0.6;
      m.armR.rotation.x = -0.6;
      break;
    case 'glide':
    case 'dev':
      m.armL.rotation.x = 1.45;
      m.armR.rotation.x = -1.45;
      m.hipL.rotation.x = 0.2;
      m.hipR.rotation.x = -0.2;
      m.kneeL.rotation.z = -0.3;
      m.kneeR.rotation.z = -0.3;
      m.torso.rotation.z = p.anim === 'glide' ? -0.35 : 0;
      if (p.anim === 'dev') m.body.position.y = 0.3;
      break;
    case 'dash':
      m.torso.rotation.z = -0.6;
      m.armL.rotation.z = -1.2;
      m.armR.rotation.z = -1.2;
      m.hipL.rotation.z = -0.5;
      m.kneeL.rotation.z = -0.9;
      m.hipR.rotation.z = 0.6;
      m.kneeR.rotation.z = -0.3;
      break;
    case 'slam':
      m.torso.rotation.z = -0.7;
      m.armL.rotation.z = 2.7;
      m.armR.rotation.z = 2.7;
      m.hipL.rotation.z = 0.8;
      m.kneeL.rotation.z = -1.4;
      m.hipR.rotation.z = 0.8;
      m.kneeR.rotation.z = -1.4;
      break;
    case 'consume':
      m.armR.rotation.z = Math.PI / 2;
      m.armL.rotation.z = 1.3;
      m.elbowL.rotation.z = 0.4;
      m.torso.rotation.z = -0.25;
      m.kneeL.rotation.z = -0.4;
      m.kneeR.rotation.z = -0.4;
      break;
    case 'hurt':
      m.torso.rotation.z = 0.4;
      m.head.rotation.z = 0.3;
      m.armL.rotation.x = 0.9;
      m.armR.rotation.x = -0.9;
      break;
    default: {
      // Idle: breathing, weight on one leg
      const breathe = Math.sin(t / 25);
      m.torso.rotation.z = breathe * 0.02;
      m.armL.rotation.x = 0.08;
      m.armR.rotation.x = -0.08;
      m.elbowL.rotation.z = 0.15 + breathe * 0.03;
      m.elbowR.rotation.z = 0.15 - breathe * 0.03;
      m.kneeR.rotation.z = -0.12;
    }
  }

  if (!atk) return;
  const arm = m.armR;
  const elbow = m.elbowR;
  elbow.rotation.z = 0;
  if (atk.power === 'fists') {
    const left = atk.index === 1;
    const [a, e] = left ? [m.armL, m.elbowL] : [arm, elbow];
    if (atk.index === 2) {
      a.rotation.z = windup ? -0.6 : active ? Math.PI * 0.95 : 1.4;
      e.rotation.z = windup ? 1.6 : 0.2;
      m.kneeL.rotation.z = windup ? -0.6 : 0;
      m.kneeR.rotation.z = windup ? -0.6 : 0;
    } else {
      a.rotation.z = windup ? -0.5 : active ? Math.PI / 2 : 0.8;
      e.rotation.z = windup ? 1.8 : active ? 0 : 1.2;
      m.torso.rotation.y = (left ? 1 : -1) * (active ? 0.35 : -0.2);
    }
  } else if (atk.power === 'claws') {
    arm.rotation.z = windup ? 2.7 : active ? 2.7 - swing * 2.5 : 0.3;
    elbow.rotation.z = windup ? 0.5 : 0.1;
    m.torso.rotation.z = active ? -0.35 : windup ? 0.15 : 0;
  } else if (atk.power === 'whip') {
    arm.rotation.z = windup ? -1.3 : Math.PI / 2;
    const ext = active ? Math.min(1, (atk.t - def.from + 1) / 4) : windup ? 0.05 : Math.max(0.05, 1 - (atk.t - def.to) / 8);
    m.whip.scale.set(1, ext, 1);
  } else if (atk.power === 'blade') {
    if (atk.index === 0) {
      // Horizontal slash: arm out front, sweeping from the right across to the left
      arm.rotation.z = Math.PI / 2;
      arm.rotation.y = windup ? -1.4 : -1.4 + swing * 2.8;
      m.torso.rotation.y = windup ? -0.4 : -0.4 + swing * 0.9;
    } else {
      // Overhead cleave
      arm.rotation.z = windup ? Math.PI * 0.95 : active ? Math.PI * 0.95 - swing * 2.5 : 0.5;
      m.torso.rotation.z = active ? -0.4 : windup ? 0.2 : 0;
      m.kneeL.rotation.z = active ? -0.5 : 0;
      m.kneeR.rotation.z = active ? -0.5 : 0;
    }
  }
}

// ------------------------------------------------------------------- Soldiers

export function buildSoldier() {
  const b = new Builder();
  const OLIVE = '#5a7a2a';
  const DARK = '#2e4416';
  const [hipL, kneeL] = leg(b, b.body, { y: 0.95, z: -0.11, thigh: 0.48, shin: 0.44, rHip: 0.1, rKnee: 0.085, rAnkle: 0.07, pants: DARK, shoe: '#141414' });
  const [hipR, kneeR] = leg(b, b.body, { y: 0.95, z: 0.11, thigh: 0.48, shin: 0.44, rHip: 0.1, rKnee: 0.085, rAnkle: 0.07, pants: DARK, shoe: '#141414' });
  const torso = b.pivot(b.body, 0, 0.96, 0);
  b.cyl(torso, 0.2, 0.18, 0.2, 0, 0.1, 0, OLIVE, { sides: 6 });
  b.box(torso, 0.3, 0.44, 0.46, 0, 0.38, 0, OLIVE);
  b.box(torso, 0.34, 0.34, 0.4, 0.01, 0.4, 0, DARK); // vest
  for (const z of [-0.1, 0.05]) b.box(torso, 0.06, 0.1, 0.1, 0.19, 0.28, z, '#3a5a1a'); // pouches
  b.box(torso, 0.34, 0.05, 0.48, 0, 0.02, 0, '#181818'); // belt
  b.box(torso, 0.16, 0.36, 0.34, -0.24, 0.38, 0, '#3a4a20'); // pack
  const head = b.pivot(torso, 0.02, 0.62, 0);
  b.ball(head, 0.2, 0, 0.2, 0, DARK, { rz: 0 }); // helmet
  b.box(head, 0.42, 0.035, 0.42, 0, 0.18, 0, DARK);
  b.box(head, 0.28, 0.24, 0.27, 0.03, 0.05, 0, '#3c3c40'); // gas mask
  b.cyl(head, 0.055, 0.065, 0.1, 0.19, -0.02, 0.08, '#202024', { rz: Math.PI / 2 }); // filters
  b.cyl(head, 0.055, 0.065, 0.1, 0.19, -0.02, -0.08, '#202024', { rz: Math.PI / 2 });
  b.box(head, 0.02, 0.06, 0.07, 0.17, 0.09, 0.06, '#ff3050', { glow: true }); // lenses
  b.box(head, 0.02, 0.06, 0.07, 0.17, 0.09, -0.06, '#ff3050', { glow: true });
  const armSpec = { y: 0.54, upper: 0.3, fore: 0.28, rShoulder: 0.08, rElbow: 0.07, rWrist: 0.06, sleeve: OLIVE, hand: '#181818', handSize: 0.09 };
  const [armL, elbowL] = arm(b, torso, { ...armSpec, z: -0.29 });
  const [armR, elbowR] = arm(b, torso, { ...armSpec, z: 0.29 });
  const rifle = b.pivot(torso, 0.1, 0.3, 0.12);
  b.box(rifle, 0.85, 0.09, 0.07, 0.28, 0, 0, '#16161a');
  b.box(rifle, 0.12, 0.2, 0.06, 0.08, -0.12, 0, '#16161a'); // magazine
  b.box(rifle, 0.24, 0.12, 0.06, -0.14, -0.02, 0, '#3a2a18'); // stock
  b.box(rifle, 0.2, 0.06, 0.05, 0.3, 0.08, 0, '#16161a'); // sight
  const muzzle = b.pivot(rifle, 0.76, 0, 0);
  b.ball(muzzle, 0.13, 0, 0, 0, '#ffd040', { glow: true });
  return b.done({ kind: 'soldier', torso, head, hipL, hipR, kneeL, kneeR, armL, armR, elbowL, elbowR, rifle, muzzle });
}

export function poseSoldier(m, e) {
  resetPose(m);
  const speed = Math.hypot(e.vx, e.vz);
  if (speed > 0.3) runCycle(m, e.animT, Math.min(0.8, speed / 3), 0.25);
  const aiming = e.state === 'aim';
  if (aiming) {
    m.rifle.position.set(0.18, 0.4, 0.06);
    m.armR.rotation.z = Math.PI / 2 - 0.15;
    m.elbowR.rotation.z = 0.2;
    m.armL.rotation.z = Math.PI / 2 - 0.25;
    m.armL.rotation.x = -0.45;
    m.elbowL.rotation.z = 0.3;
  } else {
    m.rifle.rotation.set(0, 0.9, -0.5);
    m.elbowR.rotation.z = 1.1;
    m.elbowL.rotation.z = 1.0;
  }
  m.muzzle.visible = (e.muzzle ?? 0) > 0;
}

// ------------------------------------------------------------------- Infected

export function buildInfected() {
  const b = new Builder();
  const SKIN = '#8ca878';
  const SKIN_D = '#5a7448';
  const [hipL, kneeL] = leg(b, b.body, { y: 0.88, z: -0.11, thigh: 0.44, shin: 0.42, rHip: 0.09, rKnee: 0.075, rAnkle: 0.06, pants: '#1a2a5a', shoe: SKIN_D });
  const [hipR, kneeR] = leg(b, b.body, { y: 0.88, z: 0.11, thigh: 0.44, shin: 0.42, rHip: 0.09, rKnee: 0.075, rAnkle: 0.06, pants: '#1a2a5a', shoe: SKIN_D });
  const torso = b.pivot(b.body, 0, 0.88, 0);
  b.cyl(torso, 0.17, 0.15, 0.2, 0, 0.1, 0, '#4a4a4e', { sides: 6 });
  b.box(torso, 0.27, 0.4, 0.4, 0, 0.36, 0, '#4a4a4e'); // torn shirt
  b.box(torso, 0.03, 0.18, 0.14, 0.14, 0.32, 0.07, SKIN); // skin through the rip
  for (let i = 0; i < 3; i++) b.box(torso, 0.035, 0.02, 0.1, 0.15, 0.27 + i * 0.05, 0.07, '#a01818');
  b.box(torso, 0.03, 0.1, 0.08, 0.14, 0.48, -0.1, '#881400');
  const head = b.pivot(torso, 0.08, 0.58, 0);
  b.ball(head, 0.15, 0.03, 0.1, 0, SKIN);
  b.box(head, 0.12, 0.06, 0.16, 0.12, 0.0, 0, SKIN_D); // jaw
  b.box(head, 0.03, 0.03, 0.12, 0.18, 0.01, 0, '#5a0a0a'); // mouth
  b.box(head, 0.02, 0.035, 0.035, 0.17, 0.13, 0.05, '#ff3050', { glow: true });
  b.box(head, 0.02, 0.035, 0.035, 0.17, 0.13, -0.05, '#ff3050', { glow: true });
  const armSpec = { y: 0.52, upper: 0.32, fore: 0.32, rShoulder: 0.06, rElbow: 0.055, rWrist: 0.045, sleeve: SKIN, hand: SKIN_D, handSize: 0.09 };
  const [armL, elbowL] = arm(b, torso, { ...armSpec, z: -0.25 });
  const [armR, elbowR] = arm(b, torso, { ...armSpec, z: 0.25 });
  return b.done({ kind: 'infected', torso, head, hipL, hipR, kneeL, kneeR, armL, armR, elbowL, elbowR });
}

export function poseInfected(m, e) {
  resetPose(m);
  m.torso.rotation.z = -0.45; // hunched
  m.head.rotation.x = 0.2;
  const speed = Math.hypot(e.vx, e.vz);
  if (speed > 0.3) {
    // A dragging shuffle: one leg stiff
    const s = Math.sin(e.animT * 0.22 * (e.speed || 1));
    m.hipL.rotation.z = s * 0.6;
    m.hipR.rotation.z = -s * 0.45;
    m.kneeL.rotation.z = -Math.max(0, -s) * 0.9;
    m.kneeR.rotation.z = -0.1;
    m.body.position.y = Math.abs(s) * 0.04;
  }
  const reach = e.state === 'windup' ? 2.5 : e.state === 'lunge' ? 1.6 : 1.3;
  const sway = Math.sin(e.animT * 0.1) * 0.12;
  m.armL.rotation.z = reach + sway;
  m.armR.rotation.z = reach - sway;
  m.elbowL.rotation.z = e.state === 'lunge' ? 0 : 0.35;
  m.elbowR.rotation.z = e.state === 'lunge' ? 0 : 0.25;
}

// ------------------------------------------------------------------- Hunters and the Supreme Hunter

export function buildHunter({ boss = false } = {}) {
  const b = new Builder();
  const SKIN = boss ? '#8a1080' : '#8a1a10';
  const MUSCLE = boss ? '#6844fc' : '#b0102a';
  const BONE = '#ece4d4';
  const eyeColor = boss ? '#ffd040' : '#ff3050';
  const legSpec = { y: 1.05, thigh: 0.55, shin: 0.6, rHip: 0.2, rKnee: 0.14, rAnkle: 0.1, pants: SKIN, shoe: '#2a0a08', shoeLen: 0.42 };
  const [hipL, kneeL] = leg(b, b.body, { ...legSpec, z: -0.3 });
  const [hipR, kneeR] = leg(b, b.body, { ...legSpec, z: 0.3 });
  const torso = b.pivot(b.body, 0, 1.05, 0);
  b.cyl(torso, 0.42, 0.3, 0.45, 0, 0.22, 0, SKIN, { sides: 7 }); // gut
  b.cyl(torso, 0.55, 0.44, 0.6, 0.05, 0.72, 0, SKIN, { sides: 7 }); // chest
  b.box(torso, 0.12, 0.42, 0.62, 0.45, 0.75, 0, MUSCLE, { glow: boss }); // exposed muscle
  for (let i = 0; i < 3; i++) b.box(torso, 0.1, 0.06, 0.5, 0.42, 0.4 + i * 0.1, 0, MUSCLE, { glow: boss });
  for (let i = 0; i < 5; i++) b.cone(torso, 0.08, 0.32, -0.5, 0.25 + i * 0.22, 0, BONE, { rz: Math.PI / 2 + 0.3 }); // spine spikes
  const head = b.pivot(torso, 0.4, 1.12, 0);
  b.box(head, 0.5, 0.36, 0.4, 0.15, 0.08, 0, SKIN);
  b.box(head, 0.3, 0.14, 0.36, 0.3, -0.12, 0, '#3a0808'); // jaw
  for (let i = -2; i <= 2; i++) b.cone(head, 0.025, 0.1, 0.43, -0.03, i * 0.065, BONE, { rz: Math.PI }); // teeth
  b.box(head, 0.03, 0.05, 0.06, 0.41, 0.17, 0.11, eyeColor, { glow: true });
  b.box(head, 0.03, 0.05, 0.06, 0.41, 0.17, -0.11, eyeColor, { glow: true });
  const armSpec = { y: 0.95, upper: 0.55, fore: 0.55, rShoulder: 0.17, rElbow: 0.14, rWrist: 0.11, sleeve: SKIN, hand: SKIN, handSize: 0.2 };
  const [armL, elbowL] = arm(b, torso, { ...armSpec, z: -0.62 });
  const [armR, elbowR] = arm(b, torso, { ...armSpec, z: 0.62 });
  for (const elbow of [elbowL, elbowR]) for (let i = -1; i <= 1; i++) b.cone(elbow, 0.04, 0.5, 0.06, -0.92, i * 0.08, BONE, { rz: Math.PI });
  if (boss) b.root.scale.setScalar(1.42);
  return b.done({ kind: boss ? 'boss' : 'hunter', torso, head, hipL, hipR, kneeL, kneeR, armL, armR, elbowL, elbowR });
}

export function poseHunter(m, e) {
  resetPose(m);
  m.torso.rotation.z = -0.3;
  m.kneeL.rotation.z = -0.25;
  m.kneeR.rotation.z = -0.25;
  m.elbowL.rotation.z = 0.4;
  m.elbowR.rotation.z = 0.4;
  const speed = Math.hypot(e.vx, e.vz);
  if (speed > 0.5 && e.onGround) {
    const s = Math.sin(e.animT * 0.2);
    m.hipL.rotation.z = s * 0.7;
    m.hipR.rotation.z = -s * 0.7;
    m.kneeL.rotation.z = -(0.2 + Math.max(0, -s) * 1.1);
    m.kneeR.rotation.z = -(0.2 + Math.max(0, s) * 1.1);
    m.armL.rotation.z = -s * 0.5;
    m.armR.rotation.z = s * 0.5;
    m.body.position.y = Math.abs(Math.cos(e.animT * 0.2)) * 0.1;
  }
  if (e.state === 'windup' || e.state === 'chargeWindup') {
    m.armR.rotation.z = 2.8;
    m.armL.rotation.z = 2.4;
    m.elbowR.rotation.z = 0.6;
    m.torso.rotation.z = 0;
  } else if (e.state === 'swipe') {
    m.armR.rotation.z = Math.PI / 2;
    m.armR.rotation.y = -0.7;
    m.elbowR.rotation.z = 0;
    m.torso.rotation.z = -0.5;
  } else if (e.state === 'charge') {
    m.torso.rotation.z = -0.8;
    m.armL.rotation.z = -0.9;
    m.armR.rotation.z = -0.9;
  } else if (e.state === 'leap' || !e.onGround) {
    m.armL.rotation.z = 2.3;
    m.armR.rotation.z = 2.3;
    m.hipL.rotation.z = 0.9;
    m.kneeL.rotation.z = -1.2;
    m.hipR.rotation.z = 0.3;
    m.kneeR.rotation.z = -0.8;
  } else if (e.state === 'stunned') {
    m.torso.rotation.z = -0.95;
    m.armL.rotation.z = -0.2;
    m.armR.rotation.z = 0.2;
    m.kneeL.rotation.z = -0.8;
    m.kneeR.rotation.z = -0.8;
    m.head.rotation.x = Math.sin(e.animT * 0.15) * 0.4;
  }
}

// ------------------------------------------------------------------- The Behemoth

export function buildBehemoth() {
  const b = new Builder();
  const FLESH = '#4a2a26';
  const HIDE = '#2c1816';
  const PLATE = '#6e685c';
  const BONE = '#e0d8c8';
  const legSpec = { y: 1.55, thigh: 0.85, shin: 0.75, rHip: 0.48, rKnee: 0.38, rAnkle: 0.32, pants: HIDE, shoe: '#141010', shoeLen: 1.0 };
  const [hipL, kneeL] = leg(b, b.body, { ...legSpec, z: -0.8 });
  const [hipR, kneeR] = leg(b, b.body, { ...legSpec, z: 0.8 });
  const torso = b.pivot(b.body, 0, 1.55, 0);
  b.cyl(torso, 1.3, 1.0, 1.0, 0, 0.45, 0, FLESH, { sides: 8 }); // belly
  b.cyl(torso, 1.15, 1.35, 1.4, 0.1, 1.55, 0, FLESH, { sides: 8 }); // great chest
  // Armour plates over the back and shoulders, and a row of spikes
  b.box(torso, 1.5, 0.45, 2.6, -0.55, 2.35, 0, PLATE, { rz: 0.15 });
  b.box(torso, 1.1, 0.4, 2.3, 0.45, 2.3, 0, PLATE, { rz: -0.1 });
  b.box(torso, 0.4, 1.5, 2.5, -1.15, 1.4, 0, PLATE);
  for (const z of [-1.35, 1.35]) b.box(torso, 1.3, 0.9, 0.35, 0.2, 1.75, z, PLATE);
  for (let i = 0; i < 5; i++) b.cone(torso, 0.18, 0.7, -0.9 + i * 0.4, 2.75, 0, BONE, { rz: 0.3 - i * 0.1 });
  // Molten cracks between the plates
  for (const [x, y, z, w, h, d] of [
    [-1.37, 1.6, 0.6, 0.06, 1.0, 0.1],
    [-1.37, 1.2, -0.7, 0.06, 0.8, 0.1],
    [-0.15, 2.58, 0, 0.1, 0.05, 2.2],
    [1.27, 1.3, 0.55, 0.06, 0.7, 0.1],
    [1.27, 1.0, -0.45, 0.06, 0.5, 0.1],
  ]) b.box(torso, w, h, d, x, y, z, '#ffffff', { glow: true });
  const head = b.pivot(torso, 1.3, 1.4, 0);
  b.box(head, 1.0, 0.85, 1.0, 0.3, 0.1, 0, FLESH);
  b.box(head, 0.9, 0.28, 1.06, 0.3, 0.55, 0, PLATE);
  for (const z of [-0.4, 0.4]) b.cone(head, 0.12, 0.6, 0.0, 0.85, z, BONE, { rz: 0.6 }); // horns
  b.box(head, 0.06, 0.1, 0.14, 0.82, 0.25, 0.25, '#ffffff', { glow: true });
  b.box(head, 0.06, 0.1, 0.14, 0.82, 0.25, -0.25, '#ffffff', { glow: true });
  const jaw = b.pivot(head, 0.1, -0.3, 0);
  b.box(jaw, 0.95, 0.3, 0.9, 0.35, -0.1, 0, HIDE);
  for (let i = -2; i <= 2; i++) b.cone(jaw, 0.05, 0.18, 0.78, 0.1, i * 0.16, BONE);
  const acid = b.pivot(jaw, 0.8, 0.2, 0);
  b.ball(acid, 0.25, 0, 0, 0, '#7aff60'); // lit, not glow, so the crack colour doesn't tint it
  const armSpec = { y: 1.9, upper: 1.0, fore: 1.0, rShoulder: 0.45, rElbow: 0.38, rWrist: 0.4, sleeve: FLESH, hand: PLATE, handSize: 0.75 };
  const [armL, elbowL] = arm(b, torso, { ...armSpec, z: -1.6 });
  const [armR, elbowR] = arm(b, torso, { ...armSpec, z: 1.6 });
  for (const elbow of [elbowL, elbowR]) {
    b.box(elbow, 0.85, 0.7, 0.85, -0.05, -0.5, 0, PLATE); // forearm plating
    for (let i = -1; i <= 1; i++) b.cone(elbow, 0.1, 0.6, 0.25, -1.65, i * 0.25, BONE, { rz: Math.PI });
  }
  return b.done({ kind: 'behemoth', torso, head, jaw, acid, hipL, hipR, kneeL, kneeR, armL, armR, elbowL, elbowR });
}

export function poseBehemoth(m, e, t) {
  resetPose(m);
  m.torso.rotation.z = -0.15;
  m.kneeL.rotation.z = -0.15;
  m.kneeR.rotation.z = -0.15;
  m.elbowL.rotation.z = 0.35;
  m.elbowR.rotation.z = 0.35;
  const speed = Math.hypot(e.vx, e.vz);
  if (speed > 0.3) {
    const s = Math.sin(e.animT * 0.12);
    m.hipL.rotation.z = s * 0.45;
    m.hipR.rotation.z = -s * 0.45;
    m.kneeL.rotation.z = -(0.15 + Math.max(0, -s) * 0.6);
    m.kneeR.rotation.z = -(0.15 + Math.max(0, s) * 0.6);
    m.armL.rotation.z = -s * 0.35;
    m.armR.rotation.z = s * 0.35;
    m.torso.rotation.x = s * 0.06; // heavy side-to-side sway
  }
  m.acid.visible = false;
  if (e.state === 'pound' || e.state === 'spikes') {
    const lift = Math.min(1, (34 - e.t) / 20);
    m.armL.rotation.z = 2.8 * lift;
    m.armR.rotation.z = 2.8 * lift;
    m.elbowL.rotation.z = 0.3;
    m.elbowR.rotation.z = 0.3;
    m.torso.rotation.z = 0.25 * lift;
    m.kneeL.rotation.z = -0.4 * lift;
    m.kneeR.rotation.z = -0.4 * lift;
  } else if (e.state === 'windup') {
    m.armR.rotation.z = 2.6;
    m.torso.rotation.y = -0.3;
  } else if (e.state === 'swipe') {
    m.armR.rotation.z = Math.PI / 2;
    m.armR.rotation.y = -0.9;
    m.elbowR.rotation.z = 0;
    m.torso.rotation.y = 0.4;
  } else if (e.state === 'spit') {
    m.jaw.rotation.z = -0.55;
    m.acid.visible = true;
    m.head.rotation.z = 0.25;
  } else if (e.state === 'stunned') {
    m.torso.rotation.z = -0.55;
    m.kneeL.rotation.z = -0.6;
    m.kneeR.rotation.z = -0.6;
    m.head.rotation.x = Math.sin(e.animT * 0.1) * 0.3;
  }
  m.glow.color.set(e.phase === 3 ? (Math.floor(t / 5) % 2 ? '#ff3020' : '#ff9040') : '#ff8a30');
}

// ------------------------------------------------------------------- Gunship

export function buildHeli() {
  const b = new Builder();
  const OLIVE = '#5a7a2a';
  const DARK = '#2e4416';
  b.box(b.body, 2.6, 1.2, 1.4, 0, 0, 0, OLIVE);
  b.cyl(b.body, 0.45, 0.65, 1.0, 1.75, -0.05, 0, OLIVE, { rz: -Math.PI / 2, sides: 6 }); // nose
  b.box(b.body, 0.9, 0.7, 1.2, 1.3, 0.2, 0, '#3cbcfc', { glow: true }); // cockpit glass
  b.box(b.body, 2.6, 0.25, 1.42, 0, -0.62, 0, DARK);
  b.cyl(b.body, 0.15, 0.3, 3.4, -2.9, 0.15, 0, DARK, { rz: Math.PI / 2, sides: 6 }); // tail boom
  b.box(b.body, 0.6, 1.2, 0.1, -4.5, 0.55, 0, DARK);
  b.box(b.body, 0.6, 0.1, 1.2, -4.4, 0.15, 0, DARK);
  for (const z of [-0.95, 0.95]) {
    b.box(b.body, 0.9, 0.12, 0.2, 0.2, -0.2, z * 0.8, DARK); // stub wings
    b.cyl(b.body, 0.14, 0.14, 0.8, 0.2, -0.35, z, '#181818', { rz: Math.PI / 2, sides: 6 }); // rocket pods
    b.box(b.body, 2.6, 0.06, 0.06, 0, -1.0, z * 0.6, '#181818'); // skids
  }
  const rotor = b.pivot(b.body, 0, 0.78, 0);
  b.cyl(rotor, 0.12, 0.12, 0.25, 0, 0, 0, '#181818');
  for (const ry of [0, Math.PI / 2]) b.box(rotor, 7, 0.04, 0.25, 0, 0.12, 0, '#a8a8a8', { ry });
  const tail = b.pivot(b.body, -4.5, 0.75, 0.1);
  for (const rx of [0, Math.PI / 2]) b.box(tail, 1.2, 0.16, 0.03, 0, 0, 0, '#a8a8a8', { rx });
  const light = b.pivot(b.body, -1.3, 0.65, 0);
  b.box(light, 0.15, 0.15, 0.15, 0, 0, 0, '#ff2020', { glow: true });
  // A faint disc for the spinning rotor
  const blur = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 0.02, 24), new THREE.MeshBasicMaterial({ color: 0xa8a8a8, transparent: true, opacity: 0.18, depthWrite: false }));
  blur.position.y = 0.9;
  b.body.add(blur);
  // Rotors spin continuously, so the gunship skips pose smoothing.
  return b.done({ kind: 'heli', rotor, tail, light, noSmoothing: true });
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
