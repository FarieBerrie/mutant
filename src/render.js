import { GAME, GROUND_ROW, MASS_MAX, PAL, PLAYER_MAX_HP, ROWS, TILE, VIEW_H, VIEW_W } from './config.js';
import { drawText, textWidth } from './font.js';
import { T, tileAt } from './level.js';
import { centerX, centerY } from './physics.js';
import { POWER_NAMES } from './player.js';
import { hash2 } from './rng.js';
import { drawBoss, drawHeli, drawHunter, drawInfected, drawHero, drawProjectile, drawSoldier } from './sprites.js';

const THEMES = {
  dusk: { sky: ['#0c0c3c', '#1c1c6c', '#3c2878', '#78306c', '#c0505c'], far: '#141434', mid: '#24244c', lit: PAL.yellowL, stars: true },
  infected: { sky: ['#1c0408', '#3c0c14', '#6c1420', '#a02828', '#c84c30'], far: '#200810', mid: '#3c1018', lit: PAL.redL, fog: PAL.viral },
  military: { sky: ['#041418', '#082c34', '#145048', '#2c7458', '#5c9c64'], far: '#06181c', mid: '#0c2c30', lit: PAL.greenL, stars: true },
  hive: { sky: ['#14041c', '#300838', '#58104c', '#881854', '#b82850'], far: '#1c0820', mid: '#341040', lit: PAL.viralL, fog: PAL.magenta },
  arena: { sky: ['#000000', '#1c0000', '#3c0408', '#68080c', '#a01010'], far: '#100000', mid: '#240406', lit: PAL.redL, fog: PAL.viral },
};

const BUILDING_COLORS = {
  brick: { base: PAL.brick, dark: PAL.brickD, trim: PAL.tan },
  concrete: { base: PAL.concrete, dark: PAL.concreteD, trim: PAL.grayL },
  tan: { base: PAL.tan, dark: PAL.tanD, trim: PAL.yellowL },
  glass: { base: PAL.navy, dark: '#000040', trim: PAL.blueL },
};

const styleCache = new WeakMap();
function buildingStyleAt(level, c) {
  if (!styleCache.has(level)) {
    const map = new Array(level.cols).fill('concrete');
    for (const b of level.buildings) for (let x = b.c0; x <= b.c1; x++) map[x] = b.style;
    styleCache.set(level, map);
  }
  return styleCache.get(level)[c];
}

let ditherCache = new Map();
function ditherPattern(ctx, color) {
  if (!ditherCache.has(color)) {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, 1, 1);
    g.fillRect(1, 1, 1, 1);
    ditherCache.set(color, ctx.createPattern(c, 'repeat'));
  }
  return ditherCache.get(color);
}

// ------------------------------------------------------------------- background

function drawSky(ctx, theme, camY, t) {
  const bands = theme.sky;
  const bandH = Math.ceil(170 / bands.length);
  const offset = Math.round(-camY * 0.3);
  ctx.fillStyle = bands[0];
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  for (let i = 1; i < bands.length; i++) {
    const y = i * bandH + offset;
    // Dithered seam between bands, NES style
    ctx.fillStyle = ditherPattern(ctx, bands[i]);
    ctx.fillRect(0, y - 2, VIEW_W, 2);
    ctx.fillStyle = bands[i];
    ctx.fillRect(0, y, VIEW_W, VIEW_H - y);
  }
  if (theme.stars) {
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(hash2(i, 1) * VIEW_W);
      const y = Math.floor(hash2(i, 2) * 80) + offset;
      ctx.fillStyle = hash2(i, Math.floor(t / 30)) > 0.9 ? PAL.grayL : PAL.white;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function drawSkyline(ctx, camX, camY, { factor, width, minH, maxH, color, lit, seed, baseY }) {
  const scroll = camX * factor;
  const first = Math.floor(scroll / width) - 1;
  const yOff = Math.round(-camY * factor * 0.6);
  for (let i = first; i < first + VIEW_W / width + 3; i++) {
    const x = Math.round(i * width - scroll);
    const h = Math.floor(minH + hash2(i, seed) * (maxH - minH));
    const top = baseY - h + yOff;
    ctx.fillStyle = color;
    ctx.fillRect(x, top, width - 2, VIEW_H - top);
    if (hash2(i, seed + 1) > 0.6) ctx.fillRect(x + Math.floor(width / 2) - 1, top - 6, 2, 6); // antenna
    for (let wy = top + 4; wy < baseY + yOff; wy += 6) {
      for (let wx = x + 3; wx < x + width - 4; wx += 4) {
        if (hash2(wx + i * 13, wy) > 0.85) {
          ctx.fillStyle = lit;
          ctx.fillRect(wx, wy, 1, 2);
          ctx.fillStyle = color;
        }
      }
    }
  }
}

// ------------------------------------------------------------------- tiles

function drawTile(ctx, level, tile, c, r, x, y, t) {
  switch (tile) {
    case T.GROUND:
      if (r === GROUND_ROW) {
        ctx.fillStyle = PAL.concreteD;
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = PAL.grayL;
        ctx.fillRect(x, y, TILE, 3);
        ctx.fillStyle = PAL.grayD;
        ctx.fillRect(x + 15, y + 3, 1, 13);
      } else {
        ctx.fillStyle = PAL.grayD;
        ctx.fillRect(x, y, TILE, TILE);
        if (c % 3 === 0) {
          ctx.fillStyle = PAL.yellow;
          ctx.fillRect(x + 2, y + 7, 10, 2);
        }
      }
      break;
    case T.WALL:
    case T.ROOF: {
      const col = BUILDING_COLORS[buildingStyleAt(level, c)] || BUILDING_COLORS.concrete;
      ctx.fillStyle = col.base;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = col.dark;
      ctx.fillRect(x, y + 15, TILE, 1);
      if (tile === T.ROOF) {
        ctx.fillStyle = col.trim;
        ctx.fillRect(x, y, TILE, 3);
        ctx.fillStyle = col.dark;
        ctx.fillRect(x, y + 3, TILE, 1);
      }
      // Two windows per tile; some lit
      for (const wx of [3, 9]) {
        const lit = hash2(c * 2 + (wx > 5 ? 1 : 0), r) > 0.62;
        ctx.fillStyle = lit ? (buildingStyleAt(level, c) === 'glass' ? PAL.blueL : PAL.yellowL) : PAL.ink;
        ctx.fillRect(x + wx, y + (tile === T.ROOF ? 7 : 4), 4, tile === T.ROOF ? 5 : 7);
      }
      break;
    }
    case T.LEDGE:
      ctx.fillStyle = PAL.brownL;
      ctx.fillRect(x, y, TILE, 3);
      ctx.fillStyle = PAL.brown;
      ctx.fillRect(x, y + 3, TILE, 1);
      ctx.fillRect(x + 2, y + 4, 1, 6);
      ctx.fillRect(x + 13, y + 4, 1, 6);
      break;
    case T.CAR: {
      if (tileAt(level, c - 1, r) === T.CAR) break; // drawn from the left tile
      const body = [PAL.red, PAL.blue, PAL.yellow, PAL.grayL][Math.floor(hash2(c, 3) * 4)];
      ctx.fillStyle = body;
      ctx.fillRect(x + 1, y + 6, 30, 7);
      ctx.fillRect(x + 7, y + 1, 16, 6);
      ctx.fillStyle = PAL.blueL;
      ctx.fillRect(x + 9, y + 2, 5, 4);
      ctx.fillRect(x + 16, y + 2, 5, 4);
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(x + 4, y + 12, 6, 4);
      ctx.fillRect(x + 22, y + 12, 6, 4);
      ctx.fillStyle = PAL.yellowL;
      ctx.fillRect(x + 29, y + 7, 2, 2);
      break;
    }
    case T.HIVE: {
      const pulse = Math.floor(t / 20 + c + r) % 3;
      ctx.fillStyle = PAL.purpleD;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = PAL.magenta;
      ctx.fillRect(x + 1, y + 1, 6, 6);
      ctx.fillRect(x + 9, y + 8, 6, 7);
      ctx.fillStyle = pulse === 0 ? PAL.viralL : PAL.viral;
      ctx.fillRect(x + 3, y + 3, 2, 2);
      ctx.fillRect(x + 11, y + 10, 2, 2);
      ctx.fillRect(x + 7, y, 1, TILE);
      break;
    }
    case T.FENCE:
      ctx.fillStyle = PAL.grayL;
      ctx.fillRect(x + 1, y, 2, TILE);
      ctx.fillRect(x + 13, y, 2, TILE);
      ctx.fillRect(x, y + 1, TILE, 1);
      ctx.fillStyle = PAL.gray;
      for (let i = 0; i < 16; i += 4) {
        ctx.fillRect(x + i, y + 3 + (i % 8), 1, 1);
        ctx.fillRect(x + i + 2, y + 7 + (i % 8), 1, 1);
      }
      ctx.fillStyle = PAL.yellow;
      ctx.fillRect(x + 4, y + 6, 8, 3);
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(x + 5, y + 7, 6, 1);
      break;
  }
}

function drawDecor(ctx, level, camX, camY) {
  for (const d of level.decor) {
    const x = Math.round(d.x - camX);
    const y = Math.round(d.y - camY);
    if (x < -40 || x > VIEW_W + 40) continue;
    if (d.kind === 'tower') {
      ctx.fillStyle = PAL.brown;
      ctx.fillRect(x + 2, y - 8, 2, 8);
      ctx.fillRect(x + 14, y - 8, 2, 8);
      ctx.fillStyle = PAL.brownL;
      ctx.fillRect(x, y - 22, 18, 14);
      ctx.fillStyle = PAL.brown;
      ctx.fillRect(x, y - 18, 18, 1);
      ctx.fillRect(x, y - 13, 18, 1);
      ctx.fillRect(x + 2, y - 26, 14, 4);
    } else {
      ctx.fillStyle = PAL.grayL;
      ctx.fillRect(x + 6, y - 24, 1, 24);
      ctx.fillRect(x + 3, y - 18, 7, 1);
      ctx.fillStyle = PAL.red;
      ctx.fillRect(x + 5, y - 26, 3, 2);
    }
  }
}

// ------------------------------------------------------------------- effects

function drawTendrils(ctx, x0, y0, x1, y1, t, count = 3) {
  const steps = 10;
  for (let k = 0; k < count; k++) {
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const wobble = Math.sin(f * Math.PI * 3 + t / 3 + k * 2) * 4 * Math.sin(f * Math.PI);
      ctx.fillStyle = (i + k) % 2 ? PAL.viral : PAL.ink;
      ctx.fillRect(Math.round(x0 + (x1 - x0) * f), Math.round(y0 + (y1 - y0) * f + wobble + k - 1), 2, 2);
    }
  }
}

function drawDevastator(ctx, p, cx, cy, t) {
  const grow = p.dev > 20 ? (40 - p.dev) / 20 : p.dev / 20;
  const len = 20 + grow * 110;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + t / 40;
    const ex = cx + Math.cos(a) * len;
    const ey = cy + Math.sin(a) * len * 0.7;
    drawTendrils(ctx, cx, cy, ex, ey, t + i * 5, 1);
    ctx.fillStyle = PAL.white;
    ctx.fillRect(Math.round(ex) - 1, Math.round(ey) - 1, 3, 3);
  }
}

// ------------------------------------------------------------------- HUD

function bar(ctx, x, y, w, h, frac, fill, back = PAL.ink) {
  ctx.fillStyle = PAL.grayL;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = back;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, frac))), h);
}

function drawHud(ctx, game, t) {
  const p = game.player;
  ctx.fillStyle = PAL.black;
  ctx.fillRect(0, 0, VIEW_W, 21);
  ctx.fillStyle = PAL.grayD;
  ctx.fillRect(0, 21, VIEW_W, 1);

  drawText(ctx, 'HP', 4, 3, PAL.white);
  const low = p.hp < 30 && Math.floor(t / 8) % 2;
  bar(ctx, 18, 4, 64, 5, p.hp / PLAYER_MAX_HP, low ? PAL.white : PAL.red);
  drawText(ctx, 'MS', 4, 12, PAL.white);
  const full = p.mass >= MASS_MAX;
  bar(ctx, 18, 13, 64, 4, p.mass / MASS_MAX, full && Math.floor(t / 6) % 2 ? PAL.viralL : PAL.purple);

  const power = POWER_NAMES[p.power] + (p.armor ? '+ARMOR' : '');
  drawText(ctx, power, 128, 3, p.armor ? PAL.grayL : PAL.redL, { align: 'center' });
  if (full) drawText(ctx, 'V: DEVASTATOR', 128, 12, Math.floor(t / 10) % 2 ? PAL.viralL : PAL.yellow, { align: 'center' });
  else if (p.disguised) drawText(ctx, 'DISGUISED', 128, 12, PAL.greenL, { align: 'center' });

  drawText(ctx, String(game.score).padStart(7, '0'), 252, 3, PAL.white, { align: 'right' });
  if (game.alert > 0) {
    drawText(ctx, 'ALERT', 186, 12, game.alert >= 60 && Math.floor(t / 8) % 2 ? PAL.white : PAL.red);
    bar(ctx, 218, 13, 34, 4, game.alert / 100, PAL.red);
  }

  if (game.bossActive) {
    const b = game.boss;
    ctx.fillStyle = PAL.black;
    ctx.fillRect(0, VIEW_H - 18, VIEW_W, 18);
    drawText(ctx, 'SUPREME HUNTER', 8, VIEW_H - 15, PAL.redL);
    bar(ctx, 8, VIEW_H - 6, VIEW_W - 16, 3, b.hp / b.maxHp, b.phase === 3 ? PAL.viralL : PAL.magenta);
  }

  if (game.banner.t > 0 && Math.floor(game.banner.t / 4) % 8 !== 0) {
    const text = game.banner.text;
    const w = textWidth(text, 2) + 24;
    const y = 52;
    ctx.fillStyle = PAL.black;
    ctx.fillRect(128 - w / 2, y - 6, w, 34);
    ctx.fillStyle = PAL.viral;
    ctx.fillRect(128 - w / 2, y - 6, w, 2);
    ctx.fillRect(128 - w / 2, y + 26, w, 2);
    drawText(ctx, `DISTRICT ${game.checkpoint + 1}`, 128, y, PAL.grayL, { align: 'center' });
    drawText(ctx, text, 128, y + 10, PAL.white, { align: 'center', scale: 2, shadow: PAL.redD });
  }
}

// ------------------------------------------------------------------- main entry

export function renderGame(ctx, game, t, { hud = true } = {}) {
  const theme = THEMES[game.level.districts[game.district].theme] || THEMES.dusk;
  let camX = Math.round(game.camera.x);
  let camY = Math.round(game.camera.y);
  if (game.shakeT > 0) {
    camX += Math.round((Math.random() - 0.5) * Math.min(6, game.shakeT));
    camY += Math.round((Math.random() - 0.5) * Math.min(6, game.shakeT));
  }

  drawSky(ctx, theme, camY, t);
  drawSkyline(ctx, camX, camY, { factor: 0.2, width: 14, minH: 30, maxH: 90, color: theme.far, lit: theme.lit, seed: 11, baseY: 190 });
  drawSkyline(ctx, camX, camY, { factor: 0.45, width: 22, minH: 40, maxH: 120, color: theme.mid, lit: theme.lit, seed: 23, baseY: 200 });
  if (theme.fog) {
    ctx.fillStyle = ditherPattern(ctx, theme.fog);
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, 120 - camY * 0.3, VIEW_W, VIEW_H);
    ctx.globalAlpha = 1;
  }

  const level = game.level;
  const c0 = Math.floor(camX / TILE);
  const c1 = Math.ceil((camX + VIEW_W) / TILE);
  const r0 = Math.max(0, Math.floor(camY / TILE));
  for (let c = c0; c <= c1; c++) {
    for (let r = r0; r < ROWS; r++) {
      const tile = tileAt(level, c, r);
      if (tile) drawTile(ctx, level, tile, c, r, c * TILE - camX, r * TILE - camY, t);
    }
  }
  drawDecor(ctx, level, camX, camY);

  // Characters
  for (const e of game.enemies) {
    if (e.dead && e !== game.boss) continue;
    if (e === game.boss && e.dead && Math.floor(t / 3) % 2) continue;
    const cx = Math.round(centerX(e) - camX);
    const fy = Math.round(e.y + e.h - camY);
    if (cx < -60 || cx > VIEW_W + 60) continue;
    if (e.type === 'infected') drawInfected(ctx, e, cx, fy, t);
    else if (e.type === 'soldier') drawSoldier(ctx, e, cx, fy, t);
    else if (e.type === 'hunter') drawHunter(ctx, e, cx, fy, t);
    else if (e.type === 'heli') drawHeli(ctx, e, cx, fy, t);
    else if (e.type === 'boss') drawBoss(ctx, e, cx, fy, t);
  }

  const p = game.player;
  const pcx = Math.round(centerX(p) - camX);
  const pfy = Math.round(p.y + p.h - camY);
  if (p.consume) {
    const tg = p.consume.target;
    drawTendrils(ctx, pcx + p.facing * 8, pfy - 15, Math.round(centerX(tg) - camX), Math.round(centerY(tg) - camY), t, 3);
  }
  if (p.dev > 0) drawDevastator(ctx, p, pcx, pfy - 12, t);
  const blink = p.invuln > 0 && !p.consume && p.dev === 0 && p.dash === 0 && Math.floor(t / 3) % 2;
  if (p.alive && !blink) drawHero(ctx, p, pcx, pfy, t);

  for (const pr of game.projectiles) drawProjectile(ctx, pr, Math.round(pr.x - camX), Math.round(pr.y - camY), t);
  for (const pt of game.particles) {
    ctx.fillStyle = pt.color;
    ctx.fillRect(Math.round(pt.x - camX), Math.round(pt.y - camY), pt.size, pt.size);
  }
  for (const pop of game.popups) {
    const x = pop.screen ? pop.x - game.camera.x : pop.x - camX;
    const y = pop.screen ? pop.y - game.camera.y : pop.y - camY;
    drawText(ctx, pop.text, x, y, pop.color, { align: 'center', shadow: PAL.black });
  }

  if (game.flash > 0) {
    ctx.fillStyle = PAL.white;
    ctx.globalAlpha = game.flash / 20;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalAlpha = 1;
  }
  if (hud) drawHud(ctx, game, t);
}

// ------------------------------------------------------------------- screens

export function dim(ctx, alpha = 0.6) {
  ctx.fillStyle = PAL.black;
  ctx.globalAlpha = alpha;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.globalAlpha = 1;
}

export function drawLogo(ctx, y, t) {
  const title = GAME.title;
  // As big as fits: short titles get chunkier letters.
  const scale = textWidth(title, 4) <= 232 ? 4 : 3;
  const height = 7 * scale;
  // Red tendril shadow, then the title in stacked layers for an 8-bit "bevel".
  drawText(ctx, title, 129, y + 2, PAL.redD, { align: 'center', scale });
  drawText(ctx, title, 128, y + 1, PAL.viral, { align: 'center', scale });
  drawText(ctx, title, 128, y, PAL.white, { align: 'center', scale });
  const w = textWidth(title, scale);
  ctx.fillStyle = PAL.viral;
  for (let i = 0; i < w; i += 3) {
    const drip = Math.floor(hash2(i, 9) * 6 + Math.max(0, Math.sin(t / 20 + i) * 3));
    ctx.fillRect(128 - w / 2 + i, y + height + 1, 2, drip);
  }
  drawText(ctx, GAME.subtitle, 128, y + height + 12, PAL.yellow, { align: 'center', scale: 2, shadow: PAL.redD });
}

export function drawMenu(ctx, items, selected, y, t) {
  items.forEach((item, i) => {
    const active = i === selected;
    const label = active ? `> ${item} <` : item;
    drawText(ctx, label, 128, y + i * 12, active ? (Math.floor(t / 15) % 2 ? PAL.white : PAL.yellow) : PAL.grayL, { align: 'center', shadow: PAL.black });
  });
}

export function drawPanel(ctx, x, y, w, h) {
  ctx.fillStyle = PAL.black;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = PAL.viral;
  ctx.fillRect(x, y, w, 2);
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.fillRect(x, y, 2, h);
  ctx.fillRect(x + w - 2, y, 2, h);
}
