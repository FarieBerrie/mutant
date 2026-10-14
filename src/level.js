// Seeded 3D city: ten districts in a row along +x, each a stretch of avenue lined with buildings
// on both sides (a front row on the avenue and a back row behind an alley). Everything solid is
// an axis-aligned box, and every building can be wall-run. Arenas are walled plazas whose walls
// can't be climbed; all but the last open at the far end once their boss is dead.
import { WORLD } from './config.js';
import { createRng } from './rng.js';

export const FLOOR = 4; // metres per storey
export const SIDEWALK = 0.15; // kerb height; low enough to step up onto
const CELL = 16; // the collision grid buckets boxes by x
const ARENA_WALL = 60;
const BUILDING_STYLES = ['brick', 'concrete', 'tan', 'glass'];
const NEON = ['#ff2050', '#3cbcfc', '#f8b800', '#58d854', '#e040fb'];
const CAR_COLORS = ['#c82020', '#2060d0', '#e0a820', '#d0d0d0', '#208040', '#202024'];

// The run through the city. Spawn counts are per district. `gunship` districts call in a
// helicopter at high alert; `ambient` districts keep infected wandering in.
export const DISTRICTS = [
  { name: 'MIDTOWN', length: 140, theme: 'dusk', floors: [3, 9], soldiers: 5, infected: 3, hunters: 0, cars: 6, gunship: true },
  { name: 'INFECTED ZONE', length: 150, theme: 'infected', floors: [4, 10], soldiers: 2, infected: 9, hunters: 1, cars: 5, ambient: 5, gunship: true },
  { name: 'MILITARY BASE', length: 140, theme: 'military', floors: [2, 5], soldiers: 11, infected: 2, hunters: 1, fences: true, gunship: true },
  { name: 'THE HIVE', length: 130, theme: 'hive', floors: [3, 9], styles: ['hive'], soldiers: 0, infected: 7, hunters: 2, hive: true, ambient: 6 },
  { name: 'SUPREME HUNTER', length: 80, theme: 'arena', arena: true, boss: 'boss' },
  { name: 'HARBOR', length: 140, theme: 'harbor', floors: [2, 5], styles: ['container'], soldiers: 7, infected: 4, hunters: 1, cranes: true, containers: true, gunship: true },
  { name: 'TOXIC REFINERY', length: 140, theme: 'toxic', floors: [3, 8], styles: ['industrial'], soldiers: 3, infected: 9, hunters: 2, stacks: true, ambient: 6 },
  { name: 'FINANCIAL DISTRICT', length: 150, theme: 'storm', floors: [7, 12], styles: ['glass', 'glass', 'concrete'], soldiers: 8, infected: 3, hunters: 1, cars: 6, gunship: true },
  { name: 'QUARANTINE WALL', length: 140, theme: 'dawn', floors: [2, 5], styles: ['concrete', 'tan'], soldiers: 13, infected: 3, hunters: 2, fences: true, gunship: true },
  { name: 'THE BEHEMOTH', length: 90, theme: 'lair', arena: true, boss: 'behemoth' },
];

export function buildLevel(seed = 1985) {
  const rng = createRng(seed);
  const W = WORLD.halfWidth;
  const A = WORLD.avenue;
  const length = DISTRICTS.reduce((sum, d) => sum + d.length, 0);
  const level = {
    seed,
    length,
    halfWidth: W,
    avenue: A,
    boxes: [],
    decor: [],
    spawns: [],
    checkpoints: [],
    districts: [],
    arenas: [],
    cells: [],
    playerStart: { x: 4, y: 0, z: 0 },
  };

  const addBox = (x0, x1, y0, y1, z0, z1, props) => {
    const box = { id: level.boxes.length, x0, x1, y0, y1, z0: Math.min(z0, z1), z1: Math.max(z0, z1), ...props };
    level.boxes.push(box);
    return box;
  };
  const clearOf = (x0, x1, z0, z1) => !level.boxes.some((b) => b.x0 < x1 && b.x1 > x0 && b.z0 < z1 && b.z1 > z0);

  let x0 = 0;
  for (const [index, d] of DISTRICTS.entries()) {
    const x1 = x0 + d.length;
    level.districts.push({ name: d.name, theme: d.theme, x0, x1, ambient: d.ambient || 0, gunship: !!d.gunship });
    level.checkpoints.push({ x: x0 + 6, z: 0 });

    if (d.arena) {
      // A walled plaza. The near side stays open until the fight starts; the camera can't
      // leave once it has, and the walls can't be climbed.
      const final = index === DISTRICTS.length - 1;
      for (const side of [-1, 1]) addBox(x0, x1, 0, ARENA_WALL, side * 28, side * (W + 2), { kind: 'wall', style: 'wall', noClimb: true });
      const wall = addBox(x1 - 3, x1, 0, ARENA_WALL, -W - 2, W + 2, { kind: 'wall', style: 'wall', noClimb: true, gate: !final });
      level.arenas.push({ x0, x1, boss: d.boss, final, wall, open: false });
      x0 = x1;
      continue;
    }

    const styles = d.styles || BUILDING_STYLES;
    const front = []; // front-row buildings, for rooftop soldiers and signs
    for (const side of [-1, 1]) {
      let x = x0 + 4;
      while (x < x1 - 10) {
        let w = rng.int(12, 24);
        if (x + w > x1 - 4) w = x1 - 4 - x;
        if (w < 8) break;
        const zNear = A + 3 + rng.int(0, 2);
        const depth = rng.int(10, 16);
        const style = rng.pick(styles);
        const h = rng.int(d.floors[0], d.floors[1]) * FLOOR;
        const b = addBox(x, x + w, 0, h, side * zNear, side * (zNear + depth), { kind: 'building', style, side, tint: rng.range(0.82, 1.08) });
        front.push(b);
        // Back row, across an alley
        const zBack = zNear + depth + rng.int(5, 8);
        if (W - 1 - zBack >= 6) {
          const hb = rng.int(d.floors[0] + 1, d.floors[1] + 2) * FLOOR;
          const inset = rng.int(0, 2);
          addBox(x + inset, x + w - inset, 0, hb, side * zBack, side * (W - 1), { kind: 'building', style: rng.pick(styles), side, tint: rng.range(0.82, 1.08) });
        }
        // Signs, water towers, antennas and smokestacks
        if (style !== 'hive' && style !== 'container' && h >= 12 && rng.chance(0.5)) {
          level.decor.push({ kind: 'neon', x: x + rng.range(2, w - 6), y: rng.range(5, h - 4), z: side * zNear, side, w: rng.range(3, 5), color: rng.pick(NEON) });
        }
        if (BUILDING_STYLES.includes(style) && w >= 14 && rng.chance(0.45)) {
          level.decor.push({ kind: rng.chance(0.6) ? 'tower' : 'antenna', x: x + rng.range(3, w - 3), y: h, z: side * (zNear + rng.range(3, depth - 3)) });
        }
        if (d.stacks && rng.chance(0.6)) level.decor.push({ kind: 'stack', x: x + rng.range(2, w - 2), y: h, z: side * (zNear + depth / 2) });
        if (d.cranes && rng.chance(0.4)) level.decor.push({ kind: 'crane', x: x + w + 3, y: 0, z: side * (zNear + depth + 2), flip: side });
        x += w + rng.int(5, 10);
      }
    }

    // Things in the street
    const lane = () => (rng.chance(0.5) ? -1 : 1) * rng.range(2.5, A - 2.5);
    for (let i = 0; i < (d.cars || 0); i++) {
      const cx = rng.range(x0 + 16, x1 - 10);
      const cz = lane();
      if (clearOf(cx - 3, cx + 3, cz - 2, cz + 2)) addBox(cx - 2.2, cx + 2.2, 0, 1.5, cz - 1, cz + 1, { kind: 'car', color: rng.pick(CAR_COLORS) });
    }
    if (d.fences) {
      // Fence lines across the avenue, each with a gap to run through
      for (let fx = x0 + 30; fx < x1 - 15; fx += rng.int(28, 40)) {
        const gap = rng.range(-A + 3, A - 3);
        addBox(fx, fx + 0.3, 0, 2.6, -A - 3, gap - 2.5, { kind: 'fence' });
        addBox(fx, fx + 0.3, 0, 2.6, gap + 2.5, A + 3, { kind: 'fence' });
      }
    }
    if (d.containers) {
      for (let i = 0; i < 7; i++) {
        const cx = rng.range(x0 + 14, x1 - 10);
        const cz = (rng.chance(0.5) ? -1 : 1) * rng.range(4, A - 1.5);
        if (!clearOf(cx - 4, cx + 4, cz - 2, cz + 2)) continue;
        const stack = rng.int(1, 2);
        for (let k = 0; k < stack; k++) addBox(cx - 3, cx + 3, k * 2.6, (k + 1) * 2.6, cz - 1.2, cz + 1.2, { kind: 'container', color: rng.pick(['#b0302a', '#2a5a9a', '#d08a20', '#3a7a4a', '#7a7a80']) });
      }
    }
    if (d.hive) {
      for (let i = 0; i < 7; i++) {
        const cx = rng.range(x0 + 14, x1 - 8);
        const cz = rng.range(-A + 2, A - 2);
        const s = rng.range(1.5, 3);
        if (clearOf(cx - s, cx + s, cz - s, cz + s)) addBox(cx - s, cx + s, 0, s * 1.4, cz - s, cz + s, { kind: 'hive' });
      }
    }
    if (d.theme !== 'hive') {
      // Raised sidewalks along both sides of the avenue, with lamps on them
      for (const side of [-1, 1]) addBox(x0, x1, 0, SIDEWALK, side * A, side * (A + 3), { kind: 'sidewalk' });
      for (let lx = x0 + 8; lx < x1 - 4; lx += 20) for (const side of [-1, 1]) level.decor.push({ kind: 'lamp', x: lx, y: SIDEWALK, z: side * (A + 1.5) });
    }

    // Enemies. Soldiers sometimes stand guard on front-row roofs.
    const place = (type, count, roofChance = 0) => {
      for (let i = 0; i < count; i++) {
        const roofs = front.filter((b) => b.x0 >= x0 && b.x1 <= x1 && b.style !== 'hive');
        if (roofChance && roofs.length && rng.chance(roofChance)) {
          const b = rng.pick(roofs);
          level.spawns.push({ type, x: rng.range(b.x0 + 2, b.x1 - 2), y: b.y1, z: rng.range(b.z0 + 2, b.z1 - 2) });
          continue;
        }
        const x = rng.range(Math.max(x0 + 12, 25), x1 - 8);
        const z = rng.range(-A + 1.5, A - 1.5);
        level.spawns.push({ type, x, y: 0, z });
      }
    };
    place('soldier', d.soldiers || 0, 0.35);
    place('infected', d.infected || 0);
    place('hunter', d.hunters || 0);

    x0 = x1;
  }

  rebuildGrid(level);
  // Spawns that landed on a car or a container stand on top of it.
  for (const s of level.spawns) if (s.y === 0) s.y = groundHeight(level, s.x, s.z, 0.4, 5);
  level.spawns.sort((a, b) => a.x - b.x);
  return level;
}

function rebuildGrid(level) {
  level.cells = Array.from({ length: Math.ceil(level.length / CELL) + 1 }, () => []);
  for (const b of level.boxes) {
    const c0 = Math.max(0, Math.floor(b.x0 / CELL));
    const c1 = Math.min(level.cells.length - 1, Math.floor(b.x1 / CELL));
    for (let c = c0; c <= c1; c++) level.cells[c].push(b);
  }
}

let stamp = 0;
/** Every box overlapping the x range [xa, xb], each once. */
export function boxesNear(level, xa, xb) {
  stamp++;
  const out = [];
  const c0 = Math.max(0, Math.floor(xa / CELL));
  const c1 = Math.min(level.cells.length - 1, Math.floor(xb / CELL));
  for (let c = c0; c <= c1; c++) {
    for (const b of level.cells[c]) {
      if (b._seen === stamp) continue;
      b._seen = stamp;
      out.push(b);
    }
  }
  return out;
}

/** Height of the highest surface under a square footprint, no higher than `below` (default: any). */
export function groundHeight(level, x, z, r = 0, below = Infinity) {
  let top = 0;
  for (const b of boxesNear(level, x - r, x + r)) {
    if (b.y1 > below + 0.01 || b.y1 <= top) continue;
    if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) top = b.y1;
  }
  return top;
}

/** Knocks down an arena's far wall so the run can continue. */
export function openArena(level, arena) {
  arena.wall.removed = true;
  arena.open = true;
  level.boxes = level.boxes.filter((b) => b !== arena.wall);
  rebuildGrid(level);
}

export function districtAt(level, x) {
  let index = 0;
  level.districts.forEach((d, i) => {
    if (x >= d.x0) index = i;
  });
  return index;
}
