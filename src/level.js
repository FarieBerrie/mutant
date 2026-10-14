import { GROUND_ROW, ROWS, TILE } from './config.js';
import { createRng } from './rng.js';

export const T = { EMPTY: 0, GROUND: 1, WALL: 2, ROOF: 3, LEDGE: 4, CAR: 5, HIVE: 6, FENCE: 7 };
const SOLID = [false, true, true, true, false, true, true, true];
export const isSolid = (tile) => SOLID[tile] === true;
export const isLedge = (tile) => tile === T.LEDGE;

// The run through the city, left to right. Spawn counts are per district. Arenas hold a boss;
// the far wall of every arena but the last opens once its boss is dead. `gunship` districts
// call in a helicopter at high alert.
export const DISTRICTS = [
  { name: 'MIDTOWN', cols: 56, theme: 'dusk', heights: [3, 7], gaps: [3, 7], soldiers: 5, infected: 3, hunters: 0, cars: 0.6, gunship: true },
  { name: 'INFECTED ZONE', cols: 60, theme: 'infected', heights: [4, 8], gaps: [3, 6], soldiers: 2, infected: 8, hunters: 1, cars: 0.4, ambient: 5, gunship: true },
  { name: 'MILITARY BASE', cols: 56, theme: 'military', heights: [2, 5], gaps: [4, 8], soldiers: 10, infected: 2, hunters: 1, fences: true, gunship: true },
  { name: 'THE HIVE', cols: 50, theme: 'hive', heights: [3, 8], gaps: [3, 6], soldiers: 0, infected: 6, hunters: 2, hive: true, ambient: 6 },
  { name: 'SUPREME HUNTER', cols: 34, theme: 'arena', arena: true, boss: 'boss' },
  { name: 'HARBOR', cols: 58, theme: 'harbor', heights: [2, 5], gaps: [3, 6], styles: ['container'], soldiers: 7, infected: 4, hunters: 1, cranes: true, gunship: true },
  { name: 'TOXIC REFINERY', cols: 58, theme: 'toxic', heights: [3, 7], gaps: [3, 6], styles: ['industrial'], soldiers: 3, infected: 8, hunters: 2, stacks: true, ambient: 6 },
  { name: 'FINANCIAL DISTRICT', cols: 60, theme: 'storm', heights: [5, 9], gaps: [3, 5], styles: ['glass', 'glass', 'concrete'], soldiers: 8, infected: 3, hunters: 1, cars: 0.5, gunship: true },
  { name: 'QUARANTINE WALL', cols: 58, theme: 'dawn', heights: [2, 5], gaps: [4, 8], styles: ['concrete', 'tan'], soldiers: 12, infected: 3, hunters: 2, fences: true, gunship: true },
  { name: 'THE BEHEMOTH', cols: 36, theme: 'lair', arena: true, boss: 'behemoth' },
];

const BUILDING_STYLES = ['brick', 'concrete', 'tan', 'glass'];
// Styles without windows, signs or rooftop clutter.
const PLAIN_STYLES = new Set(['hive', 'container', 'industrial']);
const NEON = ['#ff2050', '#3cbcfc', '#f8b800', '#58d854', '#e040fb'];

export function tileAt(level, c, r) {
  if (c < 0 || c >= level.cols) return T.WALL; // the edges of the map are walls
  if (r < 0) return T.EMPTY;
  if (r >= level.rows) return T.GROUND;
  return level.tiles[r * level.cols + c];
}

function setTile(level, c, r, tile) {
  if (c >= 0 && c < level.cols && r >= 0 && r < level.rows) level.tiles[r * level.cols + c] = tile;
}

/** Row of the first solid tile from the top in column c (where things stand). */
export function surfaceRow(level, c) {
  for (let r = 0; r < level.rows; r++) if (isSolid(tileAt(level, c, r))) return r;
  return level.rows;
}

export function buildLevel(seed = 1985) {
  const rng = createRng(seed);
  const cols = DISTRICTS.reduce((sum, d) => sum + d.cols, 0);
  const level = {
    cols,
    rows: ROWS,
    tiles: new Uint8Array(cols * ROWS),
    width: cols * TILE,
    height: ROWS * TILE,
    districts: [],
    buildings: [],
    decor: [],
    spawns: [],
    checkpoints: [],
    arenas: [],
  };

  // Street everywhere: there are no bottomless pits in this city.
  for (let c = 0; c < cols; c++) for (let r = GROUND_ROW; r < ROWS; r++) setTile(level, c, r, T.GROUND);

  const placeBuilding = (c0, w, h, style) => {
    const top = GROUND_ROW - h;
    for (let c = c0; c < c0 + w; c++) {
      for (let r = top; r < GROUND_ROW; r++) setTile(level, c, r, style === 'hive' ? T.HIVE : r === top ? T.ROOF : T.WALL);
    }
    level.buildings.push({ c0, c1: c0 + w - 1, top, style });
    if (PLAIN_STYLES.has(style)) return;
    // Neon signs hang on some facades.
    if (h >= 4 && rng.chance(0.4)) {
      level.decor.push({ kind: 'neon', x: (c0 + rng.int(0, Math.max(0, w - 3))) * TILE + 4, y: (top + rng.int(1, h - 3)) * TILE + 4, color: rng.pick(NEON), w: rng.int(22, 34) });
    }
    // Rooftop clutter: water towers and antennas (decoration only).
    if (w >= 5 && rng.chance(0.45)) {
      level.decor.push({ kind: rng.chance(0.6) ? 'tower' : 'antenna', x: (c0 + rng.int(1, w - 3)) * TILE, y: top * TILE });
    }
  };

  let start = 0;
  for (const [index, d] of DISTRICTS.entries()) {
    const x0 = start * TILE;
    const end = start + d.cols;
    level.districts.push({ name: d.name, theme: d.theme, x0, x1: end * TILE, ambient: d.ambient || 0, gunship: !!d.gunship });
    level.checkpoints.push(x0 + TILE * 2);

    if (d.arena) {
      // A sealed pit: a tall wall at the far end; the camera locks the near side. The last
      // arena is the end of the map; the others' walls are gates that open on the boss's death.
      const final = index === DISTRICTS.length - 1;
      for (let r = 0; r < GROUND_ROW; r++) {
        setTile(level, end - 1, r, T.WALL);
        setTile(level, end - 2, r, T.WALL);
      }
      const wall = { c0: end - 2, c1: end - 1, top: 0, style: 'concrete', gate: !final };
      level.buildings.push(wall);
      level.arenas.push({ x0, x1: end * TILE, boss: d.boss, final, wall });
      start = end;
      continue;
    }

    let c = start + 5; // open street at each district start (checkpoint)
    while (c < end - 6) {
      const w = rng.int(4, 8);
      const h = rng.int(d.heights[0], d.heights[1]);
      if (c + w > end - 3) break;
      placeBuilding(c, w, h, d.hive ? 'hive' : rng.pick(d.styles || BUILDING_STYLES));
      if (d.stacks && rng.chance(0.6)) level.decor.push({ kind: 'stack', x: (c + rng.int(1, w - 2)) * TILE, y: (GROUND_ROW - h) * TILE });
      c += w;

      const gap = rng.int(d.gaps[0], d.gaps[1]);
      const g0 = c;
      c += gap;
      // Street furniture in the gap
      if (gap >= 4 && d.cars && rng.chance(d.cars)) {
        const cc = g0 + rng.int(1, gap - 3);
        setTile(level, cc, GROUND_ROW - 1, T.CAR);
        setTile(level, cc + 1, GROUND_ROW - 1, T.CAR);
      }
      if (d.fences && gap >= 3 && rng.chance(0.7)) setTile(level, g0 + Math.floor(gap / 2), GROUND_ROW - 1, T.FENCE);
      if (d.cranes && gap >= 4 && rng.chance(0.5)) level.decor.push({ kind: 'crane', x: (g0 + Math.floor(gap / 2)) * TILE, y: GROUND_ROW * TILE, flip: rng.chance(0.5) });
      if (d.hive && rng.chance(0.6)) {
        const hc = g0 + rng.int(0, gap - 1);
        const hh = rng.int(1, 2);
        for (let r = GROUND_ROW - hh; r < GROUND_ROW; r++) setTile(level, hc, r, T.HIVE);
      }
      // Scaffolding between tall buildings: one-way platforms
      if (gap >= 4 && rng.chance(0.55)) {
        const row = GROUND_ROW - rng.int(3, 5);
        const pc = g0 + rng.int(1, gap - 3);
        for (let k = 0; k < 2; k++) setTile(level, pc + k, row, T.LEDGE);
      }
    }

    // Enemies, placed on whatever surface is at their column.
    const place = (type, count, { street = false } = {}) => {
      for (let i = 0; i < count; i++) {
        let col;
        let tries = 0;
        do {
          col = rng.int(start + 6, end - 3);
          tries++;
        } while (street && surfaceRow(level, col) < GROUND_ROW && tries < 20);
        if (col < 14) continue; // keep the starting street clear
        const row = surfaceRow(level, col);
        level.spawns.push({ type, x: col * TILE + TILE / 2, y: row * TILE });
      }
    };
    place('soldier', d.soldiers || 0);
    place('infected', d.infected || 0, { street: true });
    place('hunter', d.hunters || 0, { street: true });

    start = end;
  }

  // Street lamps along open sidewalks (not in the hive or the arenas).
  for (const d of level.districts) {
    if (d.theme === 'hive' || d.theme === 'arena' || d.theme === 'lair') continue;
    for (let c = d.x0 / TILE + 3; c < d.x1 / TILE - 2; c += 7) {
      if (surfaceRow(level, c) === GROUND_ROW && surfaceRow(level, c + 1) === GROUND_ROW) {
        level.decor.push({ kind: 'lamp', x: c * TILE + 8, y: GROUND_ROW * TILE });
      }
    }
  }

  level.spawns.sort((a, b) => a.x - b.x);
  level.playerStart = { x: TILE * 2, y: GROUND_ROW * TILE };
  return level;
}

/** Knocks down an arena's far wall so the run can continue. */
export function openArena(level, arena) {
  const { wall } = arena;
  for (let c = wall.c0; c <= wall.c1; c++) for (let r = 0; r < GROUND_ROW; r++) setTile(level, c, r, T.EMPTY);
  level.buildings = level.buildings.filter((b) => b !== wall);
  arena.open = true;
}

export function districtAt(level, x) {
  let index = 0;
  level.districts.forEach((d, i) => {
    if (x >= d.x0) index = i;
  });
  return index;
}
