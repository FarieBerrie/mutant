// The city's finer geometry: building trim (plinths, floor bands, pilasters, cornices,
// parapets, glass fins, pipework), rooftop clutter, shaped cars and lamps, street furniture,
// arena buttresses and the distant skyline's crowns. All visual: collisions use level boxes.
// Everything is merged into a few vertex-coloured meshes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FLOOR } from './level.js';
import { createRng } from './rng.js';

const color = new THREE.Color();
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const euler = new THREE.Euler();
const v = new THREE.Vector3();
const s = new THREE.Vector3();

const templates = new Map();
function template(key, make) {
  if (!templates.has(key)) {
    const made = make();
    const g = made.index ? made.toNonIndexed() : made;
    g.deleteAttribute('uv');
    templates.set(key, g);
  }
  return templates.get(key);
}

/** A box whose top face is scaled in (tx, tz): cabs, roof crowns, lamp heads. */
const taperBox = (tx, tz) =>
  template(`taper${tx},${tz}`, () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setXYZ(i, p.getX(i) * tx, p.getY(i), p.getZ(i) * tz);
    g.computeVertexNormals();
    return g;
  });
const cylinder = (sides, top = 1) => template(`cyl${sides},${top}`, () => new THREE.CylinderGeometry(0.5 * top, 0.5, 1, sides));
const cone = (sides) => template(`cone${sides}`, () => new THREE.ConeGeometry(0.5, 1, sides));
const blob = () => template('blob', () => new THREE.IcosahedronGeometry(0.5, 1));

/** Collects transformed, coloured copies of shapes, merged into one mesh at the end. */
export class Batch {
  constructor() {
    this.geos = [];
  }

  add(geo, hex, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, k = 1 } = {}) {
    const g = geo.clone();
    m4.compose(v.set(x, y, z), q.setFromEuler(euler.set(rx, ry, rz)), s.set(sx, sy, sz));
    g.applyMatrix4(m4);
    color.set(hex).multiplyScalar(k);
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) c.set([color.r, color.g, color.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.geos.push(g);
  }

  /** An axis-aligned box by its extents. */
  box(x0, x1, y0, y1, z0, z1, hex, opts = {}) {
    this.add(template('box', () => new THREE.BoxGeometry(1, 1, 1)), hex, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, sx: x1 - x0, sy: y1 - y0, sz: z1 - z0, ...opts });
  }

  /** A vertical cylinder standing on (x, y0, z). */
  post(x, y0, z, h, r, hex, { sides = 8, top = 1, ...opts } = {}) {
    this.add(cylinder(sides, top), hex, { x, y: y0 + h / 2, z, sx: r * 2, sy: h, sz: r * 2, ...opts });
  }

  mesh(material) {
    if (!this.geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(this.geos), material);
    m.geometry.computeBoundingSphere();
    return m;
  }
}

const TRIM = { brick: '#cdb08a', concrete: '#c4c4b8', tan: '#e6d2a4', glass: '#5a7aa0', industrial: '#5a5e52', wall: '#4a4642' };

/** Trim and rooftop clutter for one building. */
function building(solid, glow, b, rng) {
  const { x0, x1, z0, z1 } = b;
  const h = b.y1;
  const trim = TRIM[b.style] || '#888888';
  const ring = (y0, y1, out, hex, k = 1) => solid.box(x0 - out, x1 + out, y0, y1, z0 - out, z1 + out, hex, { k });

  if (b.style === 'brick' || b.style === 'concrete' || b.style === 'tan') {
    ring(0, 0.9, 0.12, trim, 0.7); // plinth
    for (let y = FLOOR; y < h - 1; y += FLOOR) ring(y - 0.08, y + 0.08, 0.06, trim, 0.9); // floor bands
    for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) solid.box(cx - 0.32, cx + 0.32, 0.9, h - 0.5, cz - 0.32, cz + 0.32, trim, { k: 0.85 }); // pilasters
    ring(h - 0.55, h - 0.15, 0.32, trim); // cornice
    ring(h - 0.15, h + 0.02, 0.45, trim, 1.1);
    parapet(solid, b, h, 0.5, trim, 0.8);
    rooftop(solid, glow, b, h, rng);
  } else if (b.style === 'glass') {
    ring(0, 1.2, 0.1, '#3a4a60');
    // Vertical fins up every face
    for (let x = x0 + 1; x < x1 - 0.5; x += 2) for (const z of [z0, z1]) solid.box(x - 0.06, x + 0.06, 1.2, h, z - 0.2, z + 0.2, trim);
    for (let z = z0 + 1; z < z1 - 0.5; z += 2) for (const x of [x0, x1]) solid.box(x - 0.2, x + 0.2, 1.2, h, z - 0.06, z + 0.06, trim);
    ring(h - 0.3, h + 0.15, 0.15, '#8ab0d0');
    // A stepped crown
    const inset = Math.min(2.5, (x1 - x0) / 4, (z1 - z0) / 4);
    solid.add(taperBox(0.8, 0.8), '#2a3a5a', { x: (x0 + x1) / 2, y: h + 1.4, z: (z0 + z1) / 2, sx: x1 - x0 - inset * 2, sy: 2.8, sz: z1 - z0 - inset * 2 });
    if (rng.chance(0.5)) {
      solid.post((x0 + x1) / 2, h + 2.8, (z0 + z1) / 2, 6, 0.08, '#b0b0b8', { sides: 5 });
      glow.box((x0 + x1) / 2 - 0.12, (x0 + x1) / 2 + 0.12, h + 8.8, h + 9.05, (z0 + z1) / 2 - 0.12, (z0 + z1) / 2 + 0.12, '#ff2020');
    }
  } else if (b.style === 'industrial') {
    // Pipes running up the walls, a catwalk round the middle
    for (const z of [z0 - 0.35, z1 + 0.35]) {
      for (let x = x0 + 2; x < x1 - 1; x += 5) solid.post(x, 0, z, h + 1.5, 0.25, '#7a8070', { sides: 8 });
    }
    const mid = Math.max(3, Math.round(h / 2 / FLOOR) * FLOOR);
    ring(mid - 0.1, mid, 0.9, '#4a4e44');
    for (let x = x0 - 0.9; x <= x1 + 0.9; x += 1.5) for (const z of [z0 - 0.88, z1 + 0.88]) solid.box(x - 0.03, x + 0.03, mid, mid + 1, z - 0.03, z + 0.03, '#8a8e80');
    ring(h - 0.2, h + 0.1, 0.2, '#6a6e60');
    rooftop(solid, glow, b, h, rng);
  } else if (b.style === 'container') {
    // Each container in the stack gets its corner castings and a seam
    for (let y = 0; y < h - 0.1; y += 2.6) {
      ring(y + 2.5, y + 2.62, 0.04, '#202024');
      for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) solid.box(cx - 0.15, cx + 0.15, y, y + 0.25, cz - 0.15, cz + 0.15, '#3a3a3e');
    }
  } else if (b.style === 'hive') {
    for (let i = 0; i < 10; i++) {
      const onX = rng.chance(0.5);
      const r = rng.range(1, 2.4);
      const x = onX ? rng.pick([x0, x1]) : rng.range(x0, x1);
      const z = onX ? rng.range(z0, z1) : rng.pick([z0, z1]);
      solid.add(blob(), rng.chance(0.5) ? '#6a1a5a' : '#4a1048', { x, y: rng.range(0.5, h), z, sx: r * 2, sy: r * 1.6, sz: r * 2 });
    }
    for (let i = 0; i < 4; i++) solid.add(blob(), '#7a1a5e', { x: rng.range(x0 + 1, x1 - 1), y: h, z: rng.range(z0 + 1, z1 - 1), sx: 3, sy: 2, sz: 3 });
  }
}

function parapet(solid, b, h, height, hex, k) {
  const t = 0.25;
  const { x0, x1, z0, z1 } = b;
  solid.box(x0, x1, h, h + height, z0, z0 + t, hex, { k });
  solid.box(x0, x1, h, h + height, z1 - t, z1, hex, { k });
  solid.box(x0, x0 + t, h, h + height, z0, z1, hex, { k });
  solid.box(x1 - t, x1, h, h + height, z0, z1, hex, { k });
}

/** Air-conditioning units with fans, and a stairwell hut. */
function rooftop(solid, glow, b, h, rng) {
  const { x0, x1, z0, z1 } = b;
  if (x1 - x0 < 8 || z1 - z0 < 8) return;
  for (let i = rng.int(1, 3); i > 0; i--) {
    const x = rng.range(x0 + 2, x1 - 2);
    const z = rng.range(z0 + 2, z1 - 2);
    solid.box(x - 0.8, x + 0.8, h, h + 1, z - 0.6, z + 0.6, '#9a9a96');
    solid.post(x, h + 1, z, 0.08, 0.45, '#3a3a3c', { sides: 10 });
  }
  const sx = rng.chance(0.5) ? x0 + 2.5 : x1 - 2.5;
  const sz = rng.chance(0.5) ? z0 + 2.5 : z1 - 2.5;
  solid.box(sx - 1.3, sx + 1.3, h, h + 2.6, sz - 1.3, sz + 1.3, '#7a7672');
  solid.box(sx - 1.4, sx + 1.4, h + 2.6, h + 2.8, sz - 1.4, sz + 1.4, '#5a5652');
  glow.box(sx - 0.2, sx + 0.2, h + 2.1, h + 2.4, sz - 1.32, sz - 1.3, '#ffd890');
}

/** A car pointing along x (front = +1 or -1), with a tapered cab and round wheels. Returns its headlights. */
function car(solid, glow, b, front) {
  const len = b.x1 - b.x0;
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const w = b.z1 - b.z0;
  solid.add(taperBox(0.97, 0.94), b.color, { x: cx, y: 0.62, z: cz, sx: len, sy: 0.55, sz: w }); // body
  solid.add(taperBox(0.62, 0.78), '#2a3a4a', { x: cx - front * 0.2, y: 1.16, z: cz, sx: len * 0.52, sy: 0.55, sz: w * 0.88 }); // cab glass
  solid.box(cx - front * 0.2 - len * 0.16, cx - front * 0.2 + len * 0.16, 1.43, 1.48, cz - w * 0.33, cz + w * 0.33, b.color); // roof
  for (const end of [-1, 1]) solid.box(cx + end * len * 0.5 - 0.06, cx + end * len * 0.5 + 0.06, 0.4, 0.62, cz - w * 0.48, cz + w * 0.48, '#3a3a3e'); // bumpers
  for (const wx of [cx - len * 0.32, cx + len * 0.32]) {
    for (const wz of [b.z0 + 0.1, b.z1 - 0.1]) {
      solid.add(cylinder(10), '#141416', { x: wx, y: 0.34, z: wz, sx: 0.68, sy: 0.22, sz: 0.68, rx: Math.PI / 2 });
      solid.add(cylinder(8), '#9a9aa0', { x: wx, y: 0.34, z: wz + (wz > cz ? 0.12 : -0.12), sx: 0.32, sy: 0.02, sz: 0.32, rx: Math.PI / 2 });
    }
  }
  const fx = cx + front * len * 0.5;
  const lights = [];
  for (const lz of [cz - w * 0.33, cz + w * 0.33]) {
    glow.box(fx - 0.04, fx + 0.04, 0.68, 0.82, lz - 0.14, lz + 0.14, '#fff6c0');
    glow.box(cx - front * len * 0.5 - 0.04, cx - front * len * 0.5 + 0.04, 0.7, 0.8, lz - 0.12, lz + 0.12, '#ff2020');
    lights.push({ x: fx + front * 0.1, y: 0.75, z: lz, color: '#fff0a0' });
  }
  return lights;
}

/** Street lamp: tapered pole, curved arm, lamp head. Returns where its light is. */
function lamp(solid, glow, d) {
  const out = d.z > 0 ? -1 : 1; // the arm reaches out over the road
  solid.post(d.x, d.y, d.z, 0.4, 0.2, '#26262c', { sides: 8 });
  solid.post(d.x, d.y + 0.4, d.z, 5.6, 0.09, '#2a2a30', { sides: 8, top: 0.7 });
  solid.add(cylinder(6), '#2a2a30', { x: d.x, y: d.y + 6.05, z: d.z + out * 0.35, sx: 0.1, sy: 0.8, sz: 0.1, rx: out * 1.1 });
  solid.box(d.x - 0.05, d.x + 0.05, d.y + 6.3, d.y + 6.4, Math.min(d.z + out * 0.6, d.z + out * 1.5), Math.max(d.z + out * 0.6, d.z + out * 1.5), '#2a2a30');
  solid.add(taperBox(0.5, 0.6), '#3a3a42', { x: d.x, y: d.y + 6.25, z: d.z + out * 1.55, sx: 0.4, sy: 0.25, sz: 0.7, rx: Math.PI });
  glow.box(d.x - 0.14, d.x + 0.14, d.y + 6.08, d.y + 6.12, d.z + out * 1.55 - 0.28, d.z + out * 1.55 + 0.28, '#fff0c0');
  return { x: d.x, y: d.y + 6, z: d.z + out * 1.55 };
}

/** Hydrants, bins, benches, news boxes and traffic lights along the sidewalks. */
function streetFurniture(solid, glow, level, rng) {
  const A = level.avenue;
  const lights = [];
  for (const d of level.districts) {
    if (['hive', 'arena', 'lair'].includes(d.theme)) continue;
    for (const side of [-1, 1]) {
      for (let x = d.x0 + 4; x < d.x1 - 4; x += rng.range(7, 13)) {
        if ((x - d.x0 - 8) % 20 < 2 || (x - d.x0 - 8) % 20 > 18) continue; // keep clear of lamps
        const y = 0.15;
        const z = side * (A + 0.7);
        const pick = rng.next();
        if (pick < 0.25) {
          solid.post(x, y, z, 0.55, 0.13, '#c02020', { sides: 8 }); // hydrant
          solid.add(blob(), '#c02020', { x, y: y + 0.58, z, sx: 0.26, sy: 0.2, sz: 0.26 });
          solid.add(cylinder(6), '#e0c020', { x, y: y + 0.35, z, sx: 0.08, sy: 0.4, sz: 0.08, rx: Math.PI / 2 });
        } else if (pick < 0.5) {
          solid.post(x, y, z, 0.9, 0.3, '#2a4a2a', { sides: 10, top: 1.1 }); // bin
          solid.post(x, y + 0.9, z, 0.06, 0.34, '#1a2a1a', { sides: 10 });
        } else if (pick < 0.7) {
          const bz = side * (A + 1.9);
          solid.box(x - 0.9, x + 0.9, y + 0.42, y + 0.5, bz - 0.22, bz + 0.22, '#7a4a20'); // bench
          solid.box(x - 0.9, x + 0.9, y + 0.5, y + 0.9, bz + side * 0.2, bz + side * 0.26, '#7a4a20');
          for (const lx of [x - 0.75, x + 0.75]) solid.box(lx - 0.04, lx + 0.04, y, y + 0.45, bz - 0.2, bz + 0.2, '#202024');
        } else if (pick < 0.82) {
          solid.box(x - 0.25, x + 0.25, y, y + 1.05, z - 0.22, z + 0.22, rng.pick(['#2050a0', '#c02020', '#e0a020'])); // news box
          glow.box(x - 0.18, x + 0.18, y + 0.75, y + 0.95, z - side * 0.23, z - side * 0.22, '#f0f0d0');
        }
      }
      // A traffic light near the start of each district
      const tx = d.x0 + 3;
      const tz = side * (A + 0.4);
      solid.post(tx, 0.15, tz, 4.6, 0.08, '#26262c', { sides: 8 });
      solid.box(tx - 0.05, tx + 0.05, 4.55, 4.65, Math.min(tz, tz - side * 3), Math.max(tz, tz - side * 3), '#26262c');
      const hz = tz - side * 3;
      solid.box(tx - 0.2, tx + 0.2, 3.6, 4.6, hz - 0.2, hz + 0.2, '#18181a');
      for (const [k, col] of [[0, '#ff2020'], [1, '#ffc020'], [2, '#30ff60']]) {
        glow.box(tx - 0.22, tx - 0.2, 4.35 - k * 0.3, 4.55 - k * 0.3, hz - 0.1, hz + 0.1, col, { k: k === 2 ? 1 : 0.35 });
      }
      lights.push({ x: tx - 0.4, y: 3.8, z: hz, color: '#30ff60' });
    }
  }
  return lights;
}

/**
 * Builds the detail meshes for a level. Returns { meshes, glows } where glows are extra light
 * sources ({ x, y, z, color }) for the sprite batch.
 */
export function buildDetails(level) {
  const rng = createRng(level.seed + 101);
  const solid = new Batch();
  const glow = new Batch();
  const gates = new Map(); // gate box id → its own detail mesh, hidden when the gate opens
  const glows = [];

  for (const b of level.boxes) {
    if (b.kind === 'building') building(solid, glow, b, rng);
    else if (b.kind === 'car') glows.push(...car(solid, glow, b, rng.chance(0.5) ? 1 : -1));
    else if (b.kind === 'sidewalk') {
      // Kerb face toward the road
      const kz = b.z0 < 0 ? b.z1 : b.z0;
      solid.box(b.x0, b.x1, 0, b.y1 + 0.01, kz - 0.08, kz + 0.08, '#c8c8bc');
    } else if (b.kind === 'fence') {
      for (let z = b.z0; z <= b.z1 + 0.01; z += 3) solid.post((b.x0 + b.x1) / 2, 0, Math.min(z, b.z1), 2.7, 0.06, '#8a8a90', { sides: 6 });
      solid.add(cylinder(6), '#9a9aa0', { x: (b.x0 + b.x1) / 2, y: 2.6, z: (b.z0 + b.z1) / 2, sx: 0.08, sy: b.z1 - b.z0, sz: 0.08, rx: Math.PI / 2 });
    } else if (b.kind === 'hive') {
      solid.add(blob(), '#5a1450', { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, z: (b.z0 + b.z1) / 2, sx: (b.x1 - b.x0) * 1.15, sy: (b.y1 - b.y0) * 1.15, sz: (b.z1 - b.z0) * 1.15 });
    } else if (b.kind === 'wall') {
      const target = b.gate ? new Batch() : solid;
      // Buttresses along the inside of arena walls, spikes along the top
      const along = b.x1 - b.x0 > b.z1 - b.z0 ? 'x' : 'z';
      if (along === 'x') {
        const face = b.z0 > 0 ? b.z0 : b.z1;
        const dir = b.z0 > 0 ? -1 : 1;
        for (let x = b.x0 + 4; x < b.x1 - 2; x += 8) {
          target.add(taperBox(0.6, 0.3), '#5a5650', { x, y: 7, z: face + dir * 0.9, sx: 2, sy: 14, sz: 1.8 });
          target.add(cone(5), '#c8c0b0', { x, y: 15.2, z: face + dir * 0.4, sx: 0.8, sy: 2.4, sz: 0.8 });
        }
      } else {
        const face = b.x0;
        for (let z = b.z0 + 4; z < b.z1 - 2; z += 6) target.add(taperBox(0.3, 0.6), '#4a4640', { x: face - 0.8, y: 9, z, sx: 1.6, sy: 18, sz: 2 });
      }
      if (b.gate) gates.set(b.id, target);
    }
  }
  for (const d of level.decor) if (d.kind === 'lamp') d.light = lamp(solid, glow, d);
  glows.push(...streetFurniture(solid, glow, level, rng));

  const solidMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  const meshes = [solid.mesh(solidMaterial), glow.mesh(new THREE.MeshBasicMaterial({ vertexColors: true }))].filter(Boolean);
  const gateMeshes = new Map([...gates].map(([id, batch]) => [id, batch.mesh(solidMaterial)]));
  return { meshes, gateMeshes, glows };
}

/** Distant towers: stepped crowns and antennas on top of the skyline's blocks. */
export function skylineCrowns(batch, x0, x1, z0, z1, h, rng) {
  if (rng.chance(0.55)) batch.add(taperBox(0.7, 0.7), '#3a3a42', { x: (x0 + x1) / 2, y: h + 3, z: (z0 + z1) / 2, sx: (x1 - x0) * 0.7, sy: 6, sz: (z1 - z0) * 0.7, k: 0.5 });
  if (rng.chance(0.35)) batch.post((x0 + x1) / 2, h + 6, (z0 + z1) / 2, rng.range(6, 16), 0.3, '#3a3a42', { sides: 5, k: 0.5 });
}
