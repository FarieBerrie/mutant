// The city's static meshes, built once per level: buildings (merged by style), street props,
// decorations, the street itself and a distant skyline. Gates are kept as their own meshes so
// they can disappear when an arena opens.
import * as THREE from 'three';
import { createRng } from './rng.js';
import { createFacades, createGlow, createRoof, createStreet, FACADE_SIZE } from './textures.js';

const ROOF_TILE = 8;
const CONTAINER_COLORS = ['#b0302a', '#2a5a9a', '#d08a20', '#3a7a4a', '#7a7a80', '#a04a8a'];

/** Geometry builder that collects quads with positions, normals, uvs and vertex colours. */
class Quads {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
  }

  /** Corners counter-clockwise as seen from the side the normal points to. */
  quad(a, b, c, d, n, uvs, color) {
    for (const [p, t] of [
      [a, uvs[0]],
      [b, uvs[1]],
      [c, uvs[2]],
      [a, uvs[0]],
      [c, uvs[2]],
      [d, uvs[3]],
    ]) {
      this.pos.push(...p);
      this.nrm.push(...n);
      this.uv.push(...t);
      this.col.push(color.r, color.g, color.b);
    }
  }

  /** The four walls of a box, textured in world units so windows line up with storeys. */
  walls(b, color, size = FACADE_SIZE) {
    const { x0, x1, y0, y1, z0, z1 } = b;
    const v0 = y0 / size;
    const v1 = y1 / size;
    const u = (len) => len / size;
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[0, v0], [u(z1 - z0), v0], [u(z1 - z0), v1], [0, v1]], color);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[0, v0], [u(z1 - z0), v0], [u(z1 - z0), v1], [0, v1]], color);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[0, v0], [u(x1 - x0), v0], [u(x1 - x0), v1], [0, v1]], color);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[0, v0], [u(x1 - x0), v0], [u(x1 - x0), v1], [0, v1]], color);
  }

  top(b, color, size = ROOF_TILE) {
    const { x0, x1, y1, z0, z1 } = b;
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[x0 / size, z1 / size], [x1 / size, z1 / size], [x1 / size, z0 / size], [x0 / size, z0 / size]], color);
  }

  /** A whole box: walls and top in one colour, uv in metres / size. */
  solid(b, color, size = 1) {
    this.walls(b, color, size);
    this.top(b, color, size);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const tmp = new THREE.Color();
const tinted = (hex, k = 1) => tmp.set(hex).multiplyScalar(k).clone();

export function buildWorld(level) {
  const group = new THREE.Group();
  const facades = createFacades();
  const glowTex = createGlow();
  const windowMaterials = [];
  const rng = createRng(level.seed + 7);

  // ---- buildings, merged by style
  const byStyle = new Map();
  const roofs = new Quads();
  const gates = new Map();
  for (const b of level.boxes) {
    if (b.kind !== 'building' && b.kind !== 'wall' && b.kind !== 'container') continue;
    const style = b.kind === 'container' ? 'container' : b.style;
    // Containers take their paint from the vertex colour; buildings vary a little in brightness.
    const color = style === 'container' ? tinted(b.color || CONTAINER_COLORS[b.id % CONTAINER_COLORS.length], 0.95) : tinted('#ffffff', b.tint ?? 1);
    if (b.gate) {
      const q = new Quads();
      q.walls(b, color);
      const mesh = new THREE.Mesh(q.geometry(), facadeMaterial(facades.wall, windowMaterials));
      gates.set(b.id, mesh);
      group.add(mesh);
      continue;
    }
    if (!byStyle.has(style)) byStyle.set(style, new Quads());
    byStyle.get(style).walls(b, color, style === 'container' ? 8 : FACADE_SIZE);
    roofs.top(b, style === 'container' ? color : tinted('#ffffff', 0.7 + (b.tint ?? 1) * 0.3));
  }
  for (const [style, quads] of byStyle) group.add(new THREE.Mesh(quads.geometry(), facadeMaterial(facades[style], windowMaterials)));
  group.add(new THREE.Mesh(roofs.geometry(), new THREE.MeshLambertMaterial({ map: createRoof(), vertexColors: true })));

  // ---- street props
  const props = new Quads();
  const glows = []; // [x, y, z, color, size]
  for (const b of level.boxes) {
    if (b.kind === 'car') {
      const c = tinted(b.color);
      const front = rng.chance(0.5) ? 1 : -1;
      props.solid({ x0: b.x0, x1: b.x1, y0: 0.3, y1: 0.95, z0: b.z0, z1: b.z1 }, c);
      const cab = front > 0 ? [b.x0 + 0.7, b.x1 - 1.3] : [b.x0 + 1.3, b.x1 - 0.7];
      props.solid({ x0: cab[0], x1: cab[1], y0: 0.95, y1: 1.5, z0: b.z0 + 0.12, z1: b.z1 - 0.12 }, tinted('#9ad0f0', 0.7));
      for (const wx of [b.x0 + 0.8, b.x1 - 0.8]) for (const wz of [b.z0, b.z1 - 0.2]) props.solid({ x0: wx - 0.35, x1: wx + 0.35, y0: 0, y1: 0.55, z0: wz, z1: wz + 0.2 }, tinted('#101012'));
      const fx = front > 0 ? b.x1 + 0.05 : b.x0 - 0.05;
      glows.push([fx, 0.7, b.z0 + 0.35, '#fff0a0', 1.4], [fx, 0.7, b.z1 - 0.35, '#fff0a0', 1.4]);
    } else if (b.kind === 'fence') {
      props.solid({ ...b, y0: 2.4, y1: 2.6 }, tinted('#9a9aa0'));
      for (let z = b.z0; z <= b.z1; z += 3) props.solid({ x0: b.x0 - 0.05, x1: b.x1 + 0.05, y0: 0, y1: 2.6, z0: z, z1: z + 0.15 }, tinted('#8a8a90'));
    } else if (b.kind === 'hive') {
      props.solid(b, tinted('#5a1450'));
    }
  }
  const fenceMesh = buildFenceMesh(level);
  if (fenceMesh) group.add(fenceMesh);

  // ---- decorations
  for (const d of level.decor) {
    if (d.kind === 'lamp') {
      const s = d.z > 0 ? -1 : 1; // arm reaches out over the road
      props.solid({ x0: d.x - 0.08, x1: d.x + 0.08, y0: 0, y1: 6, z0: d.z - 0.08, z1: d.z + 0.08 }, tinted('#2a2a30'));
      props.solid({ x0: d.x - 0.08, x1: d.x + 0.08, y0: 5.9, y1: 6.05, z0: Math.min(d.z, d.z + s * 1.4), z1: Math.max(d.z, d.z + s * 1.4) }, tinted('#2a2a30'));
      glows.push([d.x, 5.8, d.z + s * 1.3, '#ffe090', 3.5]);
      d.pool = { x: d.x, z: d.z + s * 2.5 };
    } else if (d.kind === 'neon') {
      const zFace = d.z + (d.side > 0 ? -0.06 : 0.06);
      props.solid({ x0: d.x, x1: d.x + d.w, y0: d.y, y1: d.y + 0.8, z0: Math.min(zFace, d.z), z1: Math.max(zFace, d.z) }, tinted(d.color, 1.6));
      glows.push([d.x + d.w / 2, d.y + 0.4, zFace - d.side * 0.3, d.color, 5]);
    } else if (d.kind === 'tower') {
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) props.solid({ x0: d.x + lx * 1.1 - 0.1, x1: d.x + lx * 1.1 + 0.1, y0: d.y, y1: d.y + 2.2, z0: d.z + lz * 1.1 - 0.1, z1: d.z + lz * 1.1 + 0.1 }, tinted('#4a2c10'));
      props.solid({ x0: d.x - 1.4, x1: d.x + 1.4, y0: d.y + 2.2, y1: d.y + 5, z0: d.z - 1.4, z1: d.z + 1.4 }, tinted('#8a5a24'));
      props.solid({ x0: d.x - 0.9, x1: d.x + 0.9, y0: d.y + 5, y1: d.y + 5.8, z0: d.z - 0.9, z1: d.z + 0.9 }, tinted('#6a4018'));
    } else if (d.kind === 'antenna') {
      props.solid({ x0: d.x - 0.06, x1: d.x + 0.06, y0: d.y, y1: d.y + 7, z0: d.z - 0.06, z1: d.z + 0.06 }, tinted('#9a9aa0'));
      props.solid({ x0: d.x - 0.7, x1: d.x + 0.7, y0: d.y + 4.5, y1: d.y + 4.6, z0: d.z - 0.04, z1: d.z + 0.04 }, tinted('#9a9aa0'));
      glows.push([d.x, d.y + 7.1, d.z, '#ff2020', 1.6]);
    } else if (d.kind === 'crane') {
      const c = tinted('#c87a1a');
      for (const dz of [-1, 1]) props.solid({ x0: d.x - 0.2, x1: d.x + 0.2, y0: 0, y1: 34, z0: d.z + dz * 1.2 - 0.2, z1: d.z + dz * 1.2 + 0.2 }, c);
      for (let y = 2; y < 34; y += 3) props.solid({ x0: d.x - 0.12, x1: d.x + 0.12, y0: y, y1: y + 0.15, z0: d.z - 1.2, z1: d.z + 1.2 }, tinted('#8a5210'));
      const reach = -d.flip * 22; // the boom swings out over the street
      props.solid({ x0: d.x - 0.4, x1: d.x + 0.4, y0: 34, y1: 35, z0: Math.min(d.z, d.z + reach), z1: Math.max(d.z, d.z + reach) }, c);
      props.solid({ x0: d.x - 0.03, x1: d.x + 0.03, y0: 20, y1: 34, z0: d.z + reach * 0.7, z1: d.z + reach * 0.7 + 0.06 }, tinted('#202024'));
      props.solid({ x0: d.x - 3, x1: d.x + 3, y0: 17.4, y1: 20, z0: d.z + reach * 0.7 - 1.2, z1: d.z + reach * 0.7 + 1.2 }, tinted(rng.pick(CONTAINER_COLORS)));
      glows.push([d.x, 35.3, d.z, '#ff2020', 2]);
    } else if (d.kind === 'stack') {
      props.solid({ x0: d.x - 0.9, x1: d.x + 0.9, y0: d.y, y1: d.y + 14, z0: d.z - 0.9, z1: d.z + 0.9 }, tinted('#5a5a54'));
      props.solid({ x0: d.x - 0.95, x1: d.x + 0.95, y0: d.y + 11, y1: d.y + 12, z0: d.z - 0.95, z1: d.z + 0.95 }, tinted('#c02020'));
      props.solid({ x0: d.x - 0.95, x1: d.x + 0.95, y0: d.y + 12, y1: d.y + 12.8, z0: d.z - 0.95, z1: d.z + 0.95 }, tinted('#e8e8e0'));
      glows.push([d.x, d.y + 14.3, d.z, '#ff2020', 2]);
    }
  }
  group.add(new THREE.Mesh(props.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true })));

  // ---- glowing lights: one batch of additive sprites
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(glows.flatMap((g) => g.slice(0, 3)), 3));
  glowGeo.setAttribute('color', new THREE.Float32BufferAttribute(glows.flatMap((g) => tinted(g[3]).toArray()), 3));
  const glowPoints = new THREE.Points(
    glowGeo,
    new THREE.PointsMaterial({ size: 3.2, map: glowTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  group.add(glowPoints);

  // Pools of lamplight on the street
  const pools = new Quads();
  for (const d of level.decor) {
    if (!d.pool) continue;
    const r = 3.2;
    const { x, z } = d.pool;
    pools.quad([x - r, 0.03, z + r], [x + r, 0.03, z + r], [x + r, 0.03, z - r], [x - r, 0.03, z - r], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], tinted('#ffe090', 0.35));
  }
  if (pools.pos.length) {
    group.add(new THREE.Mesh(pools.geometry(), new THREE.MeshBasicMaterial({ map: glowTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  }

  // ---- the street, one strip per district so each can take its own tint
  const street = createStreet(level.halfWidth, level.avenue);
  const groundMaterials = [];
  for (const d of level.districts) {
    const q = new Quads();
    const W = level.halfWidth;
    q.quad([d.x0, 0, W], [d.x1, 0, W], [d.x1, 0, -W], [d.x0, 0, -W], [0, 1, 0], [[d.x0 / 8, 1], [d.x1 / 8, 1], [d.x1 / 8, 0], [d.x0 / 8, 0]], tinted('#ffffff'));
    const mat = new THREE.MeshLambertMaterial({ map: street, color: d.theme === 'arena' || d.theme === 'lair' ? '#8a5a50' : '#ffffff' });
    groundMaterials.push(mat);
    group.add(new THREE.Mesh(q.geometry(), mat));
  }
  // Beyond the city's edges: dark ground under a skyline of distant towers
  const far = new Quads();
  const W = level.halfWidth;
  for (const side of [-1, 1]) {
    far.quad(
      side > 0 ? [-200, -0.05, 400] : [-200, -0.05, -W],
      side > 0 ? [level.length + 200, -0.05, 400] : [level.length + 200, -0.05, -W],
      side > 0 ? [level.length + 200, -0.05, W] : [level.length + 200, -0.05, -400],
      side > 0 ? [-200, -0.05, W] : [-200, -0.05, -400],
      [0, 1, 0],
      [[0, 0], [1, 0], [1, 1], [0, 1]],
      tinted('#1a1a20'),
    );
  }
  group.add(new THREE.Mesh(far.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true })));
  const skyline = new Quads();
  for (const side of [-1, 1]) {
    for (let x = -100; x < level.length + 100; ) {
      const w = rng.range(14, 30);
      const zNear = W + 8 + rng.range(0, 30);
      const h = rng.range(25, 95);
      skyline.walls({ x0: x, x1: x + w, y0: 0, y1: h, z0: side > 0 ? zNear : -zNear - rng.range(15, 30), z1: side > 0 ? zNear + rng.range(15, 30) : -zNear }, tinted('#ffffff', 0.25));
      x += w + rng.range(2, 12);
    }
  }
  group.add(new THREE.Mesh(skyline.geometry(), facadeMaterial(facades.concrete, windowMaterials)));

  return { group, gates, windowMaterials, groundMaterials, glowPoints };
}

function facadeMaterial({ map, glow }, windowMaterials) {
  const m = new THREE.MeshLambertMaterial({ map, emissiveMap: glow, emissive: new THREE.Color('#ffe08a'), vertexColors: true });
  windowMaterials.push(m);
  return m;
}

/** Chain-link fences: see-through panels between the posts. */
function buildFenceMesh(level) {
  const q = new Quads();
  for (const b of level.boxes) {
    if (b.kind !== 'fence') continue;
    const x = (b.x0 + b.x1) / 2;
    q.quad([x, 0, b.z0], [x, 0, b.z1], [x, 2.4, b.z1], [x, 2.4, b.z0], [1, 0, 0], [[0, 0], [(b.z1 - b.z0) / 2, 0], [(b.z1 - b.z0) / 2, 1.2], [0, 1.2]], tinted('#c8c8d0'));
  }
  if (!q.pos.length) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(210,210,220,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = -32; i < 64; i += 8) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 32, 32);
    ctx.moveTo(i + 32, 0);
    ctx.lineTo(i, 32);
  }
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return new THREE.Mesh(q.geometry(), new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
}

