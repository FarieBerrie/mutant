// 32-bit renderer: gradient skies, layered parallax, shaded buildings, additive lighting,
// weather, blob shadows, a vignette and a detailed HUD. World units are pixels of the 400×224
// view; the canvas is scaled by DETAIL so half-pixel detail is available everywhere.
import { alpha, GAME, GROUND_ROW, MASS_MAX, PAL, PLAYER_MAX_HP, ROWS, shade, snap, TILE, VIEW_H, VIEW_W } from './config.js';
import { drawText, textWidth } from './font.js';
import { ENEMY_TYPES } from './enemies.js';
import { surfaceRow, T, tileAt } from './level.js';
import { centerX, centerY } from './physics.js';
import { ATTACKS, POWER_NAMES } from './player.js';
import { hash2 } from './rng.js';
import { drawBehemoth, drawBoss, drawHero, drawHeli, drawHunter, drawInfected, drawProjectile, drawSoldier } from './sprites.js';

export const CX = VIEW_W / 2;
const GROUND_Y = GROUND_ROW * TILE;

const THEMES = {
  dusk: {
    sky: ['#05051a', '#141446', '#36265e', '#7a3460', '#e0704c'],
    far: '#1a1a3c', mid: '#242452', near: '#2e2a5a', haze: '#b0506a', lit: '#ffe08a',
    moon: '#fff4d6', stars: true, clouds: '#7a4a7a',
  },
  infected: {
    sky: ['#0a0204', '#2a0810', '#561420', '#8c2026', '#d0482c'],
    far: '#2a0a12', mid: '#3c1018', near: '#4a141c', haze: '#c0303a', lit: '#ff9070',
    weather: 'rain', clouds: '#5a1820',
  },
  military: {
    sky: ['#020a0e', '#08202a', '#123c40', '#2a6450', '#7aa070'],
    far: '#0a1e24', mid: '#10303a', near: '#163a40', haze: '#4a8a6a', lit: '#9cffa0',
    moon: '#e6fff0', stars: true, clouds: '#2a5048', searchlights: true,
  },
  hive: {
    sky: ['#0a0210', '#28062e', '#4e0e46', '#86164e', '#d02c4c'],
    far: '#200a26', mid: '#30103c', near: '#3e1446', haze: '#c02060', lit: '#ff4a80',
    weather: 'embers', clouds: '#6a1450',
  },
  arena: {
    sky: ['#000000', '#140000', '#320408', '#640a0e', '#b01818'],
    far: '#120204', mid: '#220406', near: '#2e060a', haze: '#d01c1c', lit: '#ff6060',
    moon: '#ff5a4a', weather: 'embers',
  },
  harbor: {
    sky: ['#01040c', '#061430', '#0c2a52', '#1c4c78', '#5a8aa8'],
    far: '#081a30', mid: '#0c2440', near: '#10304c', haze: '#4a7aa0', lit: '#ffd890',
    moon: '#f0f6ff', stars: true, clouds: '#2a4a6a',
  },
  toxic: {
    sky: ['#020604', '#0a1a08', '#1c3410', '#3c5a14', '#9aa830'],
    far: '#0c1a08', mid: '#14260c', near: '#1a3010', haze: '#8aa828', lit: '#d8ff60',
    weather: 'ash', clouds: '#3a4a18',
  },
  storm: {
    sky: ['#04060a', '#10141e', '#1e2432', '#323a4a', '#5a6474'],
    far: '#121620', mid: '#1a2030', near: '#222a3a', haze: '#6a7a90', lit: '#fff0c0',
    weather: 'rain', lightning: true, clouds: '#2a3040',
  },
  dawn: {
    sky: ['#1a1a3a', '#4a3a6a', '#a05a7a', '#f08a6a', '#ffd08a'],
    far: '#3a2a4a', mid: '#4a3456', near: '#583a5a', haze: '#ffb090', lit: '#fff0b0',
    clouds: '#c07a8a', searchlights: true,
  },
  lair: {
    sky: ['#000000', '#100602', '#261006', '#4a1e08', '#8a4010'],
    far: '#140802', mid: '#200c04', near: '#2a1006', haze: '#e0601c', lit: '#ffa040',
    moon: '#ffb050', weather: 'embers',
  },
};

const CONTAINER_COLORS = ['#b0302a', '#2a5a9a', '#d08a20', '#3a7a4a', '#7a7a80', '#a04a8a'];

const BUILDING_COLORS = {
  brick: { base: '#9c3a1c', trim: '#d8b890', glass: '#2a1a24' },
  concrete: { base: '#8a8a7e', trim: '#d0d0c4', glass: '#1c2230' },
  tan: { base: '#c4a26a', trim: '#f0dcae', glass: '#2a2432' },
  glass: { base: '#18286a', trim: '#7ad0ff', glass: '#0c1640' },
};

// Render-only state (smoothed HUD bars) kept per game.
const hudState = new WeakMap();

// ------------------------------------------------------------------- helpers

function glow(ctx, x, y, radius, color, strength = 0.6) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, alpha(color, strength));
  g.addColorStop(0.4, alpha(color, strength * 0.35));
  g.addColorStop(1, alpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function additive(ctx, fn) {
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  fn();
  ctx.globalCompositeOperation = prev;
}

function vGradient(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

// ------------------------------------------------------------------- background

function drawSky(ctx, theme, camX, camY, t) {
  const offset = -camY * 0.3;
  ctx.fillStyle = vGradient(ctx, offset - 20, offset + 200, theme.sky);
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  if (theme.stars) {
    for (let i = 0; i < 70; i++) {
      const x = (hash2(i, 1) * VIEW_W * 1.5 - camX * 0.02) % VIEW_W;
      const y = hash2(i, 2) * 100 + offset;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t / 40 + i));
      ctx.fillStyle = alpha('#ffffff', tw * (hash2(i, 3) * 0.7 + 0.3));
      ctx.fillRect(snap(x < 0 ? x + VIEW_W : x), snap(y), hash2(i, 4) > 0.9 ? 1 : 0.5, hash2(i, 4) > 0.9 ? 1 : 0.5);
    }
  }
  if (theme.moon) {
    const mx = VIEW_W * 0.78 - camX * 0.01;
    const my = 38 + offset;
    additive(ctx, () => glow(ctx, mx, my, 46, theme.moon, 0.35));
    ctx.fillStyle = theme.moon;
    ctx.beginPath();
    ctx.arc(mx, my, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = alpha('#000000', 0.12);
    ctx.beginPath();
    ctx.arc(mx - 3, my - 2, 3, 0, Math.PI * 2);
    ctx.arc(mx + 4, my + 3, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (theme.searchlights) {
    additive(ctx, () => {
      for (let i = 0; i < 2; i++) {
        const baseX = ((i * 260 - camX * 0.3) % (VIEW_W + 200)) + VIEW_W;
        const x = (baseX % (VIEW_W + 200)) - 100;
        const ang = Math.sin(t / 90 + i * 2) * 0.5 - Math.PI / 2;
        const g = ctx.createLinearGradient(x, 200, x + Math.cos(ang) * 200, 200 + Math.sin(ang) * 200);
        g.addColorStop(0, alpha('#d8ffe0', 0.22));
        g.addColorStop(1, alpha('#d8ffe0', 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x, 200);
        ctx.lineTo(x + Math.cos(ang - 0.08) * 220, 200 + Math.sin(ang - 0.08) * 220);
        ctx.lineTo(x + Math.cos(ang + 0.08) * 220, 200 + Math.sin(ang + 0.08) * 220);
        ctx.fill();
      }
    });
  }
  if (theme.clouds) {
    ctx.fillStyle = alpha(theme.clouds, 0.35);
    for (let i = 0; i < 6; i++) {
      const w = 60 + hash2(i, 8) * 80;
      const x = ((hash2(i, 7) * 900 - camX * 0.08 - t * 0.05 * (1 + (i % 3))) % 900 + 900) % 900 - 150;
      const y = 20 + hash2(i, 9) * 60 + offset;
      ctx.beginPath();
      ctx.ellipse(x, y, w / 2, 6 + hash2(i, 10) * 5, 0, 0, Math.PI * 2);
      ctx.ellipse(x + w * 0.2, y - 4, w / 3, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawSkyline(ctx, camX, camY, { factor, width, minH, maxH, color, haze, lit, seed, baseY }) {
  const scroll = camX * factor;
  const first = Math.floor(scroll / width) - 1;
  const yOff = -camY * factor * 0.6;
  const fill = vGradient(ctx, baseY - maxH + yOff, baseY + yOff, [shade(color, -0.25), color, haze ? alpha(haze, 0.0) : color]);
  for (let i = first; i < first + VIEW_W / width + 3; i++) {
    const x = snap(i * width - scroll);
    const h = Math.floor(minH + hash2(i, seed) * (maxH - minH));
    const w = width - 2 - Math.floor(hash2(i, seed + 5) * 6);
    const top = snap(baseY - h + yOff);
    ctx.fillStyle = color;
    ctx.fillRect(x, top, w, VIEW_H - top);
    ctx.fillStyle = fill;
    ctx.fillRect(x, top, w, VIEW_H - top);
    // Stepped crown or antenna
    if (hash2(i, seed + 1) > 0.55) {
      ctx.fillStyle = color;
      ctx.fillRect(x + w * 0.25, top - 5, w * 0.5, 5);
      if (hash2(i, seed + 2) > 0.5) ctx.fillRect(x + w / 2 - 0.5, top - 14, 1, 9);
    }
    for (let wy = top + 4; wy < baseY + yOff - 4; wy += 5) {
      for (let wx = x + 2; wx < x + w - 2; wx += 3) {
        if (hash2(Math.floor(wx) + i * 13, Math.floor(wy)) > 0.84) {
          ctx.fillStyle = alpha(lit, 0.75);
          ctx.fillRect(wx, wy, 1, 1.5);
        }
      }
    }
  }
}

function drawWeather(ctx, theme, camX, t) {
  if (theme.lightning) {
    // An occasional double flash
    const k = t % 420;
    if (k < 4 || (k > 9 && k < 12)) {
      ctx.fillStyle = alpha('#e8f0ff', k < 4 ? 0.35 : 0.2);
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }
  if (theme.weather === 'ash') {
    for (let i = 0; i < 60; i++) {
      const x = ((hash2(i, 51) * 480 - camX * 0.8 + Math.sin(t / 50 + i) * 10) % 480 + 480) % 480 - 40;
      const y = ((hash2(i, 52) * 260 + t * (0.3 + hash2(i, 53) * 0.4)) % 260) - 20;
      ctx.fillStyle = alpha(i % 4 ? '#b8b8a0' : '#e0ff90', 0.5);
      ctx.fillRect(snap(x), snap(y), i % 3 ? 1 : 1.5, 1);
    }
  } else if (theme.weather === 'rain') {
    ctx.strokeStyle = alpha('#c8d8ff', 0.35);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let i = 0; i < 90; i++) {
      const x = ((hash2(i, 31) * 520 - camX * 1.1 + t * 2.2) % 520 + 520) % 520 - 60;
      const y = ((hash2(i, 32) * 260 + t * 7) % 260) - 20;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 9);
    }
    ctx.stroke();
  } else if (theme.weather === 'embers') {
    additive(ctx, () => {
      for (let i = 0; i < 40; i++) {
        const x = ((hash2(i, 41) * 480 - camX * 0.6 + Math.sin(t / 30 + i) * 8) % 480 + 480) % 480 - 40;
        const y = VIEW_H - ((hash2(i, 42) * 280 + t * (0.4 + hash2(i, 43) * 0.6)) % 280);
        const flicker = 0.5 + 0.5 * Math.sin(t / 6 + i);
        ctx.fillStyle = alpha(i % 3 ? '#ff6a2a' : '#ffd060', 0.5 + flicker * 0.5);
        ctx.fillRect(snap(x), snap(y), 1, 1);
      }
    });
  }
}

// ------------------------------------------------------------------- buildings & tiles

function drawBuilding(ctx, b, camX, camY, t, theme) {
  const x0 = b.c0 * TILE - camX;
  const x1 = (b.c1 + 1) * TILE - camX;
  if (x1 < -4 || x0 > VIEW_W + 4) return;
  const y0 = b.top * TILE - camY;
  const y1 = GROUND_Y - camY;
  const w = x1 - x0;

  if (b.style === 'hive') {
    drawHiveMass(ctx, x0, y0, w, y1 - y0, b, t);
    return;
  }
  if (b.style === 'container') {
    drawContainerStack(ctx, b, x0, y0, w, y1);
    return;
  }
  if (b.style === 'industrial') {
    drawRefinery(ctx, b, x0, y0, w, y1, t, theme);
    return;
  }
  const col = BUILDING_COLORS[b.style] || BUILDING_COLORS.concrete;

  // Facade: lit from the left (moonlight), darker to the right
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, shade(col.base, 0.12));
  g.addColorStop(0.7, col.base);
  g.addColorStop(1, shade(col.base, -0.35));
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, w, y1 - y0);
  ctx.fillStyle = vGradient(ctx, y0, y1, [alpha('#000000', 0), alpha(theme.haze, 0.18)]);
  ctx.fillRect(x0, y0, w, y1 - y0);

  // Floor lines
  ctx.fillStyle = alpha('#000000', 0.22);
  for (let y = y0 + TILE; y < y1; y += TILE) ctx.fillRect(x0, y - 0.5, w, 0.5);
  ctx.fillStyle = alpha('#ffffff', 0.08);
  for (let y = y0 + TILE; y < y1; y += TILE) ctx.fillRect(x0, y, w, 0.5);

  // Windows
  const rows = b.top;
  for (let c = b.c0; c <= b.c1; c++) {
    for (let r = rows; r < GROUND_ROW; r++) {
      const tx = c * TILE - camX;
      const ty = r * TILE - camY;
      for (const wx of [3, 9]) {
        const lit = hash2(c * 2 + (wx > 5 ? 1 : 0), r) > 0.62;
        const top = r === rows ? 7 : 4;
        const h = r === rows ? 5 : 7.5;
        ctx.fillStyle = shade(col.base, -0.5);
        ctx.fillRect(tx + wx - 0.5, ty + top - 0.5, 5, h + 1);
        if (lit) {
          ctx.fillStyle = vGradient(ctx, ty + top, ty + top + h, [shade(theme.lit, 0.2), theme.lit, shade(theme.lit, -0.25)]);
          ctx.fillRect(tx + wx, ty + top, 4, h);
          ctx.fillStyle = alpha('#000000', 0.25);
          ctx.fillRect(tx + wx, ty + top + h / 2, 4, 0.5);
        } else {
          ctx.fillStyle = col.glass;
          ctx.fillRect(tx + wx, ty + top, 4, h);
          ctx.fillStyle = alpha('#ffffff', 0.18);
          ctx.fillRect(tx + wx + 0.5, ty + top + 0.5, 1, h - 1);
        }
        ctx.fillStyle = alpha(col.trim, 0.55);
        ctx.fillRect(tx + wx - 0.5, ty + top + h + 0.5, 5, 0.5); // sill
      }
    }
  }
  // Warm spill from lit windows
  additive(ctx, () => {
    ctx.fillStyle = alpha(theme.lit, 0.07);
    for (let c = b.c0; c <= b.c1; c++) {
      for (let r = rows; r < GROUND_ROW; r++) {
        for (const wx of [3, 9]) {
          if (hash2(c * 2 + (wx > 5 ? 1 : 0), r) > 0.62) ctx.fillRect(c * TILE - camX + wx - 2, r * TILE - camY + 2, 8, 12);
        }
      }
    }
  });

  // Glass towers get mullions and a reflection streak
  if (b.style === 'glass') {
    ctx.fillStyle = alpha('#9ad8ff', 0.12);
    ctx.beginPath();
    ctx.moveTo(x0 + w * 0.2, y0);
    ctx.lineTo(x0 + w * 0.45, y0);
    ctx.lineTo(x0 + w * 0.05, y1);
    ctx.lineTo(x0 - w * 0.2, y1);
    ctx.fill();
  }
  // Brick buildings get a fire escape
  if (b.style === 'brick' && w >= 80) {
    const fx = x0 + w * 0.55;
    ctx.fillStyle = '#1a1a1e';
    for (let y = y0 + TILE * 1.5; y < y1 - 8; y += TILE) {
      ctx.fillRect(fx, y, 26, 1);
      ctx.fillRect(fx, y - 5, 26, 0.5);
      for (let k = 0; k <= 26; k += 4) ctx.fillRect(fx + k, y - 5, 0.5, 5);
      ctx.fillRect(fx + 20, y, 0.5, TILE);
      ctx.fillRect(fx + 24, y, 0.5, TILE);
    }
  }

  // Roof cornice and parapet
  ctx.fillStyle = col.trim;
  ctx.fillRect(x0 - 1, y0, w + 2, 2.5);
  ctx.fillStyle = shade(col.trim, -0.45);
  ctx.fillRect(x0 - 1, y0 + 2.5, w + 2, 1);
  ctx.fillStyle = shade(col.trim, 0.4);
  ctx.fillRect(x0 - 1, y0, w + 2, 0.5);
  // Edge shadows so buildings read as solid blocks
  ctx.fillStyle = alpha('#000000', 0.35);
  ctx.fillRect(x1 - 1.5, y0 + 3, 1.5, y1 - y0 - 3);
}

/** Shipping containers stacked a tile high each, two per tile row where the stack is wide. */
function drawContainerStack(ctx, b, x0, y0, w, y1) {
  for (let r = b.top; r < GROUND_ROW; r++) {
    const y = y0 + (r - b.top) * TILE;
    const color = CONTAINER_COLORS[Math.floor(hash2(b.c0, r) * CONTAINER_COLORS.length)];
    ctx.fillStyle = vGradient(ctx, y, y + TILE, [shade(color, 0.15), color, shade(color, -0.35)]);
    ctx.fillRect(x0, y, w, TILE);
    ctx.fillStyle = alpha('#000000', 0.25);
    for (let x = x0 + 2; x < x0 + w - 1; x += 2.5) ctx.fillRect(x, y + 2, 0.5, TILE - 4); // corrugation
    ctx.fillStyle = shade(color, -0.5);
    ctx.fillRect(x0, y + TILE - 1, w, 1);
    ctx.fillRect(x0, y, 1.5, TILE);
    ctx.fillRect(x0 + w - 1.5, y, 1.5, TILE);
    // Door end with locking bars, on alternate rows
    if ((r + b.c0) % 2) {
      const dx = x0 + w - 10;
      ctx.fillStyle = shade(color, -0.25);
      ctx.fillRect(dx, y + 1, 8, TILE - 2);
      ctx.fillStyle = '#d8d8d0';
      ctx.fillRect(dx + 2, y + 2, 0.5, TILE - 4);
      ctx.fillRect(dx + 5, y + 2, 0.5, TILE - 4);
    }
    ctx.fillStyle = alpha('#ffffff', 0.15);
    ctx.fillRect(x0, y, w, 0.5);
  }
}

/** Refinery blocks: dark steel with pipework, hazard stripes and a few sickly lights. */
function drawRefinery(ctx, b, x0, y0, w, y1, t, theme) {
  const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
  g.addColorStop(0, '#4a4e44');
  g.addColorStop(0.7, '#363a30');
  g.addColorStop(1, '#22261e');
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, w, y1 - y0);
  // Pipes
  for (let i = 0; i < 3; i++) {
    const py = y0 + 8 + i * 14 + hash2(b.c0, i) * 6;
    if (py > y1 - 6) break;
    ctx.fillStyle = vGradient(ctx, py, py + 3, ['#9aa090', '#5a6050', '#3a3e34']);
    ctx.fillRect(x0, py, w, 3);
    for (let x = x0 + 6; x < x0 + w; x += 18) {
      ctx.fillStyle = '#6a7060';
      ctx.fillRect(x, py - 0.5, 2, 4);
    }
  }
  // Vertical pipe and gauge lights
  ctx.fillStyle = '#5a6050';
  ctx.fillRect(x0 + w * 0.7, y0, 2.5, y1 - y0);
  additive(ctx, () => {
    for (let r = b.top + 1; r < GROUND_ROW; r += 2) {
      const lx = x0 + 5 + hash2(b.c0, r) * (w - 10);
      const ly = (r - b.top) * TILE + y0 + 6;
      const pulse = 0.5 + 0.5 * Math.sin(t / 30 + r);
      ctx.fillStyle = alpha(theme.lit, 0.8);
      ctx.fillRect(lx, ly, 2, 2);
      glow(ctx, lx + 1, ly + 1, 8, theme.lit, 0.35 * pulse);
    }
  });
  // Hazard stripes along the base
  for (let x = x0; x < x0 + w; x += 6) {
    ctx.fillStyle = '#e0b020';
    ctx.fillRect(x, y1 - 5, 3, 3);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x + 3, y1 - 5, 3, 3);
  }
  ctx.fillStyle = '#6a6e60';
  ctx.fillRect(x0 - 1, y0, w + 2, 2);
  ctx.fillStyle = alpha('#000000', 0.35);
  ctx.fillRect(x0 + w - 1.5, y0 + 2, 1.5, y1 - y0 - 2);
}

function drawHiveMass(ctx, x0, y0, w, h, b, t) {
  const g = ctx.createLinearGradient(x0, y0, x0 + w, y0 + h);
  g.addColorStop(0, '#5a1450');
  g.addColorStop(0.5, '#3a0c3e');
  g.addColorStop(1, '#22082a');
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, w, h);
  // Organic nodules and pulsing veins
  for (let i = 0; i < (w * h) / 220; i++) {
    const nx = x0 + hash2(i, b.c0) * w;
    const ny = y0 + hash2(i, b.c0 + 1) * h;
    const r = 2 + hash2(i, b.c0 + 2) * 5;
    ctx.fillStyle = hash2(i, 5) > 0.5 ? '#7a1a5e' : '#4a1048';
    ctx.beginPath();
    ctx.ellipse(nx, ny, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = alpha('#ffffff', 0.15);
    ctx.fillRect(nx - r * 0.4, ny - r * 0.5, r * 0.5, 0.5);
  }
  additive(ctx, () => {
    for (let i = 0; i < w / 10; i++) {
      const vx = x0 + hash2(i, b.c0 + 9) * w;
      const pulse = 0.4 + 0.6 * Math.abs(Math.sin(t / 25 + i));
      ctx.fillStyle = alpha('#ff2a60', 0.35 * pulse);
      ctx.fillRect(vx, y0, 0.5, h);
      glow(ctx, vx, y0 + hash2(i, 7) * h, 6, '#ff2050', 0.3 * pulse);
    }
  });
  ctx.fillStyle = '#7a1a5e';
  ctx.beginPath();
  ctx.ellipse(x0 + w / 2, y0, w / 2, 4, 0, Math.PI, 0);
  ctx.fill();
}

function drawStreet(ctx, camX, camY, t) {
  const y = GROUND_Y - camY;
  // Sidewalk
  ctx.fillStyle = vGradient(ctx, y, y + TILE, ['#a8a89e', '#7a7a72', '#5c5c56']);
  ctx.fillRect(0, y, VIEW_W, TILE);
  ctx.fillStyle = '#d8d8cc';
  ctx.fillRect(0, y, VIEW_W, 1);
  ctx.fillStyle = alpha('#000000', 0.25);
  const off = -((camX % 24) + 24) % 24;
  for (let x = off; x < VIEW_W; x += 24) ctx.fillRect(snap(x), y + 1, 0.5, TILE - 4);
  // Curb
  ctx.fillStyle = '#c8c8bc';
  ctx.fillRect(0, y + TILE - 3, VIEW_W, 1);
  ctx.fillStyle = '#3a3a36';
  ctx.fillRect(0, y + TILE - 2, VIEW_W, 2);
  // Road
  ctx.fillStyle = vGradient(ctx, y + TILE, y + TILE * 2 + 40, ['#2c2c30', '#1c1c20', '#121216']);
  ctx.fillRect(0, y + TILE, VIEW_W, TILE + 40);
  const dashOff = -((camX % 48) + 48) % 48;
  ctx.fillStyle = '#e8c040';
  for (let x = dashOff; x < VIEW_W; x += 48) ctx.fillRect(snap(x), y + TILE + 8, 22, 1.5);
  // Manholes
  for (let c = Math.floor(camX / TILE); c <= Math.floor((camX + VIEW_W) / TILE); c++) {
    if (hash2(c, 77) > 0.88) {
      const mx = c * TILE - camX + 8;
      ctx.fillStyle = '#0e0e10';
      ctx.beginPath();
      ctx.ellipse(mx, y + TILE + 4, 5, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = alpha('#ffffff', 0.12);
      ctx.fillRect(mx - 3, y + TILE + 3.5, 6, 0.5);
    }
  }
}

function drawTile(ctx, level, tile, c, r, x, y, t) {
  switch (tile) {
    case T.LEDGE: {
      ctx.fillStyle = vGradient(ctx, y, y + 3, ['#d8a040', '#a86c20']);
      ctx.fillRect(x, y, TILE, 3);
      ctx.fillStyle = '#5a3810';
      ctx.fillRect(x, y + 3, TILE, 0.5);
      ctx.fillStyle = '#6a6a70';
      ctx.fillRect(x + 2, y + 3.5, 1, 8);
      ctx.fillRect(x + 13, y + 3.5, 1, 8);
      ctx.fillRect(x + 2, y + 7, 12, 0.5);
      break;
    }
    case T.CAR: {
      if (tileAt(level, c - 1, r) === T.CAR) break; // drawn from the left tile
      const body = ['#c82020', '#2060d0', '#e0a820', '#d0d0d0', '#208040'][Math.floor(hash2(c, 3) * 5)];
      ctx.fillStyle = alpha('#000000', 0.45);
      ctx.beginPath();
      ctx.ellipse(x + 16, y + 16, 17, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = vGradient(ctx, y + 5, y + 13, [shade(body, 0.35), body, shade(body, -0.4)]);
      ctx.beginPath();
      ctx.moveTo(x + 1, y + 13);
      ctx.lineTo(x + 1, y + 8);
      ctx.lineTo(x + 7, y + 6);
      ctx.lineTo(x + 10, y + 1.5);
      ctx.lineTo(x + 22, y + 1.5);
      ctx.lineTo(x + 26, y + 6);
      ctx.lineTo(x + 31, y + 7);
      ctx.lineTo(x + 31, y + 13);
      ctx.fill();
      ctx.fillStyle = vGradient(ctx, y + 2, y + 6, ['#bfe8ff', '#4a7aa0']);
      ctx.fillRect(x + 11, y + 2.5, 5, 3.5);
      ctx.fillRect(x + 17, y + 2.5, 5, 3.5);
      ctx.fillStyle = alpha('#ffffff', 0.5);
      ctx.fillRect(x + 3, y + 8, 26, 0.5);
      ctx.fillStyle = '#0c0c0e';
      ctx.beginPath();
      ctx.arc(x + 8, y + 13.5, 2.8, 0, Math.PI * 2);
      ctx.arc(x + 24, y + 13.5, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8a8a90';
      ctx.fillRect(x + 7, y + 12.5, 2, 2);
      ctx.fillRect(x + 23, y + 12.5, 2, 2);
      ctx.fillStyle = '#fff6c0';
      ctx.fillRect(x + 29.5, y + 8, 1.5, 1.5);
      additive(ctx, () => glow(ctx, x + 32, y + 9, 10, '#fff0a0', 0.35));
      break;
    }
    case T.HIVE: {
      const pulse = 0.5 + 0.5 * Math.sin(t / 20 + c + r);
      ctx.fillStyle = '#3a0c3e';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#7a1a5e';
      ctx.beginPath();
      ctx.ellipse(x + 5, y + 5, 4, 3.5, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 11, y + 11, 4.5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      additive(ctx, () => glow(ctx, x + 8, y + 8, 8, '#ff2050', 0.25 * pulse));
      break;
    }
    case T.FENCE: {
      ctx.fillStyle = '#9a9aa0';
      ctx.fillRect(x + 1, y, 1.5, TILE);
      ctx.fillRect(x + 13.5, y, 1.5, TILE);
      ctx.fillRect(x, y + 0.5, TILE, 0.5);
      ctx.strokeStyle = alpha('#c8c8d0', 0.6);
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let i = -16; i < 16; i += 3) {
        ctx.moveTo(x + i, y + 1);
        ctx.lineTo(x + i + 15, y + 16);
        ctx.moveTo(x + i + 15, y + 1);
        ctx.lineTo(x + i, y + 16);
      }
      ctx.stroke();
      ctx.fillStyle = '#f0c020';
      ctx.fillRect(x + 4, y + 5, 8, 4);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(x + 5, y + 6.5, 6, 0.5);
      ctx.fillRect(x + 5, y + 7.5, 4, 0.5);
      break;
    }
  }
}

function drawDecor(ctx, level, camX, camY, t, layer) {
  for (const d of level.decor) {
    const x = d.x - camX;
    const y = d.y - camY;
    if (x < -100 || x > VIEW_W + 100) continue; // wide enough for a crane's boom
    if (layer === 'back') {
      if (d.kind === 'tower') {
        ctx.fillStyle = '#4a2c10';
        ctx.fillRect(x + 2, y - 8, 1.5, 8);
        ctx.fillRect(x + 14.5, y - 8, 1.5, 8);
        ctx.fillRect(x + 2, y - 4, 14, 0.5);
        ctx.fillStyle = vGradient(ctx, y - 24, y - 8, ['#c08a40', '#8a5a24', '#5a3814']);
        ctx.fillRect(x, y - 22, 18, 14);
        ctx.fillStyle = alpha('#000000', 0.3);
        for (let k = 2; k < 18; k += 3) ctx.fillRect(x + k, y - 22, 0.5, 14);
        ctx.fillStyle = '#6a4018';
        ctx.beginPath();
        ctx.moveTo(x - 1, y - 22);
        ctx.lineTo(x + 9, y - 30);
        ctx.lineTo(x + 19, y - 22);
        ctx.fill();
      } else if (d.kind === 'antenna') {
        ctx.fillStyle = '#9a9aa0';
        ctx.fillRect(x + 6, y - 26, 1, 26);
        ctx.fillRect(x + 3, y - 18, 7, 0.5);
        ctx.fillRect(x + 4, y - 12, 5, 0.5);
        const on = Math.floor(t / 30) % 2 === 0;
        ctx.fillStyle = on ? '#ff3030' : '#601010';
        ctx.fillRect(x + 5.5, y - 28, 2, 2);
        if (on) additive(ctx, () => glow(ctx, x + 6.5, y - 27, 9, '#ff2020', 0.6));
      } else if (d.kind === 'neon') {
        const flicker = hash2(Math.floor(t / 4), d.x) > 0.06 ? 1 : 0.3;
        ctx.fillStyle = '#101018';
        ctx.fillRect(x - 1, y - 1, d.w + 2, 9);
        ctx.strokeStyle = alpha(d.color, flicker);
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, d.w - 1, 6);
        ctx.fillStyle = alpha(d.color, flicker);
        for (let k = 3; k < d.w - 3; k += 4) ctx.fillRect(x + k, y + 2.5, 2.5, 2);
        additive(ctx, () => glow(ctx, x + d.w / 2, y + 3.5, d.w * 0.9, d.color, 0.3 * flicker));
      } else if (d.kind === 'crane') {
        // Harbour gantry crane: lattice tower, boom, cable and a hanging container
        const s = d.flip ? -1 : 1;
        ctx.fillStyle = '#c87a1a';
        ctx.fillRect(x - 4, y - 150, 2, 150);
        ctx.fillRect(x + 4, y - 150, 2, 150);
        ctx.fillStyle = '#8a5210';
        for (let k = y - 146; k < y; k += 10) {
          ctx.fillRect(x - 3, k, 8, 0.5);
          ctx.fillRect(x - 3, k, 0.5, 10);
        }
        ctx.fillStyle = '#c87a1a';
        ctx.fillRect(Math.min(x - 20, x + s * 70), y - 154, 90, 3);
        ctx.fillStyle = '#2a2a2e';
        ctx.fillRect(x + s * 50, y - 151, 0.5, 70);
        ctx.fillStyle = CONTAINER_COLORS[Math.floor(hash2(d.x, 5) * CONTAINER_COLORS.length)];
        ctx.fillRect(x + s * 50 - 12, y - 81, 24, 9);
        const on = Math.floor(t / 40) % 2 === 0;
        ctx.fillStyle = on ? '#ff3030' : '#601010';
        ctx.fillRect(x, y - 158, 2, 2);
        if (on) additive(ctx, () => glow(ctx, x + 1, y - 157, 9, '#ff2020', 0.6));
      } else if (d.kind === 'stack') {
        // Smokestack with a hazard band, a red light and drifting smoke
        ctx.fillStyle = vGradient(ctx, y - 60, y, ['#6a6a62', '#4a4a44']);
        ctx.fillRect(x + 2, y - 60, 10, 60);
        ctx.fillStyle = '#c02020';
        ctx.fillRect(x + 2, y - 54, 10, 3);
        ctx.fillStyle = '#e8e8e0';
        ctx.fillRect(x + 2, y - 51, 10, 2);
        for (let k = 0; k < 6; k++) {
          const age = ((t / 3 + k * 14 + d.x) % 84) / 84;
          ctx.fillStyle = alpha('#9a9a88', 0.35 * (1 - age));
          ctx.beginPath();
          ctx.ellipse(x + 7 + age * 26, y - 62 - age * 40, 3 + age * 9, 2 + age * 6, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        const on = Math.floor(t / 35) % 2 === 0;
        if (on) {
          ctx.fillStyle = '#ff3030';
          ctx.fillRect(x + 6, y - 62, 2, 2);
          additive(ctx, () => glow(ctx, x + 7, y - 61, 8, '#ff2020', 0.5));
        }
      }
    } else if (d.kind === 'lamp') {
      // Pole in front of the street, light cone and pool
      ctx.fillStyle = '#2a2a30';
      ctx.fillRect(x - 0.5, y - 40, 1.5, 40);
      ctx.fillRect(x - 0.5, y - 40, 8, 1.5);
      ctx.fillStyle = '#4a4a52';
      ctx.fillRect(x + 4, y - 39, 5, 2);
      ctx.fillStyle = '#fff4c0';
      ctx.fillRect(x + 4.5, y - 37, 4, 1);
      additive(ctx, () => {
        const g = ctx.createLinearGradient(0, y - 37, 0, y);
        g.addColorStop(0, alpha('#ffe090', 0.28));
        g.addColorStop(1, alpha('#ffe090', 0.02));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x + 4.5, y - 37);
        ctx.lineTo(x + 8.5, y - 37);
        ctx.lineTo(x + 22, y);
        ctx.lineTo(x - 9, y);
        ctx.fill();
        glow(ctx, x + 6.5, y - 36, 12, '#ffe090', 0.6);
        ctx.fillStyle = alpha('#ffe090', 0.12);
        ctx.beginPath();
        ctx.ellipse(x + 6.5, y + 1, 18, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
}

// ------------------------------------------------------------------- characters & effects

const PROJECTILE_LIGHT = { bullet: '#ffe080', rocket: '#ff8a30', wave: '#ff2050', acid: '#80ff40', spike: '#ff6030' };

/** The bright arc a blade swing leaves behind. */
function drawSlashTrail(ctx, p, cx, fy) {
  const a = p.attack;
  const def = ATTACKS.blade[a.index];
  if (a.t < def.from || a.t > def.to + 3) return;
  const k = (a.t - def.from) / (def.to - def.from);
  const fade = a.t > def.to ? 1 - (a.t - def.to) / 4 : 1;
  const ccw = p.facing < 0;
  const start = a.index === 0 ? -0.9 : -1.9;
  const sweep = a.index === 0 ? 1.4 : 2.2;
  additive(ctx, () => {
    ctx.strokeStyle = alpha('#ffe0e0', 0.55 * fade);
    ctx.lineWidth = a.index === 0 ? 2 : 3;
    ctx.beginPath();
    const radius = a.index === 0 ? 26 : 32;
    const from = start;
    const to = start + sweep * Math.min(1, k + 0.25);
    if (ccw) ctx.arc(cx, fy - 16, radius, Math.PI - to, Math.PI - from);
    else ctx.arc(cx, fy - 16, radius, from, to);
    ctx.stroke();
    ctx.strokeStyle = alpha('#ff2040', 0.35 * fade);
    ctx.lineWidth = 5;
    ctx.stroke();
  });
}

function blobShadow(ctx, cx, fy, w) {
  ctx.fillStyle = alpha('#000000', 0.4);
  ctx.beginPath();
  ctx.ellipse(cx, fy, w / 2 + 2, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawTendrils(ctx, x0, y0, x1, y1, t, count = 3) {
  const steps = 14;
  for (let k = 0; k < count; k++) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = k % 2 ? '#7a0018' : '#c0102e';
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const wobble = Math.sin(f * Math.PI * 3 + t / 3 + k * 2) * 4 * Math.sin(f * Math.PI);
      const px = x0 + (x1 - x0) * f;
      const py = y0 + (y1 - y0) * f + wobble + k - 1;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  additive(ctx, () => glow(ctx, (x0 + x1) / 2, (y0 + y1) / 2, 18, '#ff2050', 0.35));
}

function drawDevastator(ctx, p, cx, cy, t) {
  const grow = p.dev > 20 ? (40 - p.dev) / 20 : p.dev / 20;
  const len = 20 + grow * 130;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + t / 40;
    const ex = cx + Math.cos(a) * len;
    const ey = cy + Math.sin(a) * len * 0.7;
    drawTendrils(ctx, cx, cy, ex, ey, t + i * 5, 1);
    ctx.fillStyle = '#f0e8ff';
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(a) * 6 - Math.sin(a) * 2, ey - Math.sin(a) * 6 + Math.cos(a) * 2);
    ctx.lineTo(ex - Math.cos(a) * 6 + Math.sin(a) * 2, ey - Math.sin(a) * 6 - Math.cos(a) * 2);
    ctx.fill();
  }
  additive(ctx, () => glow(ctx, cx, cy, 40 + grow * 60, '#ff1040', 0.6));
}

const GLOWING = new Set(['#b0002a', '#ff2050', '#f8b800', '#e45c10', '#d82800', '#fce0a8', '#f87858']);

// ------------------------------------------------------------------- HUD

function hudBar(ctx, x, y, w, h, frac, color, { trail = null, glowing = false } = {}) {
  ctx.fillStyle = '#0a0a10';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = vGradient(ctx, y, y + h, ['#202028', '#121218']);
  ctx.fillRect(x, y, w, h);
  if (trail !== null) {
    ctx.fillStyle = '#f0e0c0';
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, trail)), h);
  }
  const fw = w * Math.max(0, Math.min(1, frac));
  ctx.fillStyle = vGradient(ctx, y, y + h, [shade(color, 0.45), color, shade(color, -0.45)]);
  ctx.fillRect(x, y, fw, h);
  ctx.fillStyle = alpha('#ffffff', 0.35);
  ctx.fillRect(x, y, fw, 0.5);
  ctx.fillStyle = alpha('#000000', 0.35);
  for (let k = x + 8; k < x + w; k += 8) ctx.fillRect(k, y, 0.5, h);
  if (glowing) additive(ctx, () => glow(ctx, x + fw, y + h / 2, 14, color, 0.6));
  ctx.strokeStyle = '#8a8aa0';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x - 0.75, y - 0.75, w + 1.5, h + 1.5);
}

function drawPortrait(ctx, x, y, p, t) {
  ctx.fillStyle = vGradient(ctx, y, y + 22, ['#3a2a4a', '#1a1424']);
  ctx.fillRect(x, y, 22, 22);
  ctx.strokeStyle = p.hp < 30 ? (Math.floor(t / 8) % 2 ? '#ff2050' : '#801020') : '#8a8aa0';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, 21, 21);
  // Hooded face
  ctx.fillStyle = '#6a6a72';
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 21);
  ctx.lineTo(x + 5, y + 7);
  ctx.quadraticCurveTo(x + 11, y + 1, x + 17, y + 7);
  ctx.lineTo(x + 18, y + 21);
  ctx.fill();
  ctx.fillStyle = '#9a9aa2';
  ctx.fillRect(x + 7, y + 4.5, 7, 0.5);
  ctx.fillStyle = '#0c0a10';
  ctx.beginPath();
  ctx.moveTo(x + 7, y + 21);
  ctx.lineTo(x + 7.5, y + 9);
  ctx.quadraticCurveTo(x + 11, y + 6, x + 14.5, y + 9);
  ctx.lineTo(x + 15, y + 21);
  ctx.fill();
  ctx.fillStyle = '#b06a50';
  ctx.fillRect(x + 9, y + 12, 4, 6);
  ctx.fillStyle = '#7a3a2a';
  ctx.fillRect(x + 9, y + 12, 4, 1);
  const eye = p.disguised ? '#58d854' : p.dev > 0 || p.attack ? '#ff2050' : '#e8e0d8';
  ctx.fillStyle = eye;
  ctx.fillRect(x + 9.5, y + 13.5, 1, 0.5);
  ctx.fillRect(x + 11.5, y + 13.5, 1, 0.5);
  if (eye === '#ff2050') additive(ctx, () => glow(ctx, x + 11, y + 14, 5, eye, 0.6));
  ctx.fillStyle = '#c82020';
  ctx.fillRect(x + 4, y + 19, 4, 2);
}

function powerIcon(ctx, x, y, power, armor) {
  ctx.fillStyle = '#121218';
  ctx.fillRect(x, y, 14, 14);
  ctx.strokeStyle = '#8a8aa0';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + 0.25, y + 0.25, 13.5, 13.5);
  ctx.fillStyle = power === 'fists' ? '#e8b090' : '#d02030';
  if (power === 'fists') {
    ctx.fillRect(x + 4, y + 4, 6, 6);
    ctx.fillStyle = '#a06a50';
    for (let k = 0; k < 4; k++) ctx.fillRect(x + 4 + k * 1.5, y + 4, 0.5, 2.5);
  } else if (power === 'claws') {
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(x + 3 + k * 3, y + 3);
      ctx.lineTo(x + 5 + k * 3, y + 3);
      ctx.lineTo(x + 7 + k * 2, y + 11);
      ctx.fill();
    }
  } else if (power === 'blade') {
    ctx.fillStyle = '#8a1a1a';
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 11);
    ctx.lineTo(x + 11, y + 2);
    ctx.lineTo(x + 12, y + 3);
    ctx.lineTo(x + 5, y + 12);
    ctx.fill();
    ctx.fillStyle = '#e0e0e8';
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 10);
    ctx.lineTo(x + 11, y + 2);
    ctx.lineTo(x + 11.5, y + 2.5);
    ctx.lineTo(x + 4.5, y + 10.5);
    ctx.fill();
  } else {
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#d02030';
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 10);
    ctx.bezierCurveTo(x + 5, y + 2, x + 8, y + 12, x + 11, y + 4);
    ctx.stroke();
    ctx.fillStyle = '#e0e0e8';
    ctx.fillRect(x + 10, y + 2.5, 2, 2);
  }
  if (armor) {
    ctx.strokeStyle = '#c0c0d0';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 1, y - 1, 16, 16);
  }
}

function drawHud(ctx, game, t) {
  const p = game.player;
  let st = hudState.get(game);
  if (!st) {
    st = { trail: p.hp };
    hudState.set(game, st);
  }
  st.trail = st.trail > p.hp ? Math.max(p.hp, st.trail - 0.6) : p.hp;

  // Top panel
  ctx.fillStyle = vGradient(ctx, 0, 28, [alpha('#000000', 0.85), alpha('#000000', 0.55)]);
  ctx.fillRect(0, 0, VIEW_W, 28);
  ctx.fillStyle = alpha('#ff2050', 0.5);
  ctx.fillRect(0, 28, VIEW_W, 0.5);

  drawPortrait(ctx, 4, 3, p, t);
  drawText(ctx, GAME.hero, 30, 3, '#e8e0f0', { shadow: '#000000' });
  hudBar(ctx, 30, 12, 92, 5, p.hp / PLAYER_MAX_HP, p.hp < 30 ? '#ff3040' : '#d82030', { trail: st.trail / PLAYER_MAX_HP });
  const full = p.mass >= MASS_MAX;
  hudBar(ctx, 30, 20, 92, 3, p.mass / MASS_MAX, full ? '#ff40c0' : '#7a4cff', { glowing: full && Math.floor(t / 6) % 2 === 0 });

  powerIcon(ctx, CX - 46, 6, p.power, p.armor);
  drawText(ctx, POWER_NAMES[p.power] + (p.armor ? ' + ARMOR' : ''), CX - 28, 6, p.armor ? '#d0d0e0' : '#ff8080', { shadow: '#000000' });
  if (full) drawText(ctx, 'V: DEVASTATOR READY', CX - 28, 16, Math.floor(t / 10) % 2 ? '#ff60c0' : '#ffd040', { shadow: '#000000' });
  else if (p.disguised) drawText(ctx, 'DISGUISED', CX - 28, 16, '#70f070', { shadow: '#000000' });

  drawText(ctx, String(game.score).padStart(7, '0'), VIEW_W - 6, 4, '#ffffff', { align: 'right', shadow: '#000000' });
  if (game.alert > 0) {
    const hot = game.alert >= 60 && Math.floor(t / 8) % 2;
    drawText(ctx, 'ALERT', VIEW_W - 70, 16, hot ? '#ffffff' : '#ff4040', { shadow: '#000000' });
    hudBar(ctx, VIEW_W - 38, 17, 32, 4, game.alert / 100, '#ff3030', { glowing: game.alert >= 60 });
  }

  if (game.bossActive) {
    const b = game.boss;
    ctx.fillStyle = vGradient(ctx, VIEW_H - 22, VIEW_H, [alpha('#000000', 0.5), alpha('#000000', 0.85)]);
    ctx.fillRect(0, VIEW_H - 22, VIEW_W, 22);
    drawText(ctx, ENEMY_TYPES[b.type].name, 10, VIEW_H - 19, '#ff7070', { shadow: '#000000' });
    hudBar(ctx, 10, VIEW_H - 9, VIEW_W - 20, 4, b.hp / b.maxHp, b.phase === 3 ? '#ff2050' : '#c030c0', { glowing: b.phase === 3 });
  }

  if (game.banner.t > 0) {
    const fade = Math.min(1, game.banner.t / 20, (150 - game.banner.t) / 15);
    const text = game.banner.text;
    const w = textWidth(text, 2) + 60;
    const y = 64;
    ctx.globalAlpha = fade;
    const g = ctx.createLinearGradient(CX - w / 2, 0, CX + w / 2, 0);
    g.addColorStop(0, alpha('#000000', 0));
    g.addColorStop(0.2, alpha('#000000', 0.8));
    g.addColorStop(0.8, alpha('#000000', 0.8));
    g.addColorStop(1, alpha('#000000', 0));
    ctx.fillStyle = g;
    ctx.fillRect(CX - w / 2, y - 6, w, 34);
    ctx.fillStyle = '#ff2050';
    ctx.fillRect(CX - w / 2 + 20, y - 6, w - 40, 0.5);
    ctx.fillRect(CX - w / 2 + 20, y + 27.5, w - 40, 0.5);
    drawText(ctx, `DISTRICT ${game.checkpoint + 1}`, CX, y, '#b0b0c0', { align: 'center' });
    drawText(ctx, text, CX, y + 10, '#ffffff', { align: 'center', scale: 2, shadow: '#801020' });
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------- main entry

export function renderGame(ctx, game, t, { hud = true } = {}) {
  const theme = THEMES[game.level.districts[game.district].theme] || THEMES.dusk;
  let camX = snap(game.camera.x);
  let camY = snap(game.camera.y);
  if (game.shakeT > 0) {
    camX += snap((Math.random() - 0.5) * Math.min(6, game.shakeT));
    camY += snap((Math.random() - 0.5) * Math.min(6, game.shakeT));
  }

  drawSky(ctx, theme, camX, camY, t);
  drawSkyline(ctx, camX, camY, { factor: 0.12, width: 18, minH: 40, maxH: 100, color: theme.far, haze: theme.haze, lit: theme.lit, seed: 11, baseY: 200 });
  drawSkyline(ctx, camX, camY, { factor: 0.28, width: 24, minH: 40, maxH: 120, color: theme.mid, haze: theme.haze, lit: theme.lit, seed: 23, baseY: 205 });
  drawSkyline(ctx, camX, camY, { factor: 0.5, width: 34, minH: 30, maxH: 90, color: theme.near, haze: null, lit: theme.lit, seed: 37, baseY: 210 });
  // Atmospheric haze toward the horizon
  ctx.fillStyle = vGradient(ctx, 90 - camY * 0.3, 210 - camY, [alpha(theme.haze, 0), alpha(theme.haze, 0.28)]);
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const level = game.level;
  for (const b of level.buildings) drawBuilding(ctx, b, camX, camY, t, theme);
  drawDecor(ctx, level, camX, camY, t, 'back');
  drawStreet(ctx, camX, camY, t);

  const c0 = Math.floor(camX / TILE);
  const c1 = Math.ceil((camX + VIEW_W) / TILE);
  for (let c = c0 - 1; c <= c1; c++) {
    for (let r = 0; r < ROWS; r++) {
      const tile = tileAt(level, c, r);
      if (tile === T.LEDGE || tile === T.CAR || tile === T.FENCE || (tile === T.HIVE && !level.buildings.some((b) => b.style === 'hive' && c >= b.c0 && c <= b.c1))) {
        drawTile(ctx, level, tile, c, r, c * TILE - camX, r * TILE - camY, t);
      }
    }
  }

  // Characters with blob shadows
  for (const e of game.enemies) {
    if (e.dead && e !== game.boss) continue;
    if (e === game.boss && e.dead && Math.floor(t / 3) % 2) continue;
    const cx = snap(centerX(e) - camX);
    const fy = snap(e.y + e.h - camY);
    if (cx < -80 || cx > VIEW_W + 80) continue;
    if (e.onGround && e.type !== 'heli') blobShadow(ctx, cx, fy, e.w);
    if (e.type === 'infected') drawInfected(ctx, e, cx, fy, t);
    else if (e.type === 'soldier') drawSoldier(ctx, e, cx, fy, t);
    else if (e.type === 'hunter') drawHunter(ctx, e, cx, fy, t);
    else if (e.type === 'heli') {
      drawHeli(ctx, e, cx, fy, t);
      additive(ctx, () => glow(ctx, cx + e.facing * 8, fy - 2, 30, '#fff8d0', 0.18));
    } else if (e.type === 'boss') {
      drawBoss(ctx, e, cx, fy, t);
      additive(ctx, () => glow(ctx, cx + e.facing * 8, fy - 40, 26, e.phase === 3 ? '#ff2040' : '#c040ff', 0.25));
    } else if (e.type === 'behemoth') {
      drawBehemoth(ctx, e, cx, fy, t);
      additive(ctx, () => glow(ctx, cx, fy - 30, 40, e.phase === 3 ? '#ff3020' : '#ff8a30', 0.1));
    }
    if (e.type === 'soldier' && e.muzzle > 0) additive(ctx, () => glow(ctx, cx + e.facing * 14, fy - 15, 14, '#ffd060', 0.8));
  }

  const p = game.player;
  const pcx = snap(centerX(p) - camX);
  const pfy = snap(p.y + p.h - camY);
  if (p.consume) {
    const tg = p.consume.target;
    drawTendrils(ctx, pcx + p.facing * 8, pfy - 15, centerX(tg) - camX, centerY(tg) - camY, t, 3);
  }
  if (p.dev > 0) drawDevastator(ctx, p, pcx, pfy - 12, t);
  const blink = p.invuln > 0 && !p.consume && p.dev === 0 && p.dash === 0 && Math.floor(t / 3) % 2;
  if (p.alive && !blink) {
    if (p.onGround) blobShadow(ctx, pcx, pfy, p.w);
    if (p.dash > 0) {
      ctx.globalAlpha = 0.3;
      drawHero(ctx, p, pcx - p.facing * 10, pfy, t);
      ctx.globalAlpha = 0.15;
      drawHero(ctx, p, pcx - p.facing * 20, pfy, t);
      ctx.globalAlpha = 1;
    }
    drawHero(ctx, p, pcx, pfy, t);
    if (p.attack?.power === 'blade') drawSlashTrail(ctx, p, pcx, pfy);
    if (p.attack && p.power !== 'fists') additive(ctx, () => glow(ctx, pcx + p.facing * 14, pfy - 16, 22, '#ff2040', 0.3));
  }

  // Projectiles and particles, with light
  for (const pr of game.projectiles) {
    const x = snap(pr.x - camX);
    const y = snap(pr.y - camY);
    if (pr.kind === 'rock') {
      // A shadow on the ground shows where rubble will land
      const groundY = surfaceRow(level, Math.floor((pr.x + pr.w / 2) / TILE)) * TILE - camY;
      const near = Math.max(0.2, Math.min(1, 1 - (groundY - y) / 200));
      ctx.fillStyle = alpha('#000000', 0.45 * near);
      ctx.beginPath();
      ctx.ellipse(x + pr.w / 2, groundY, 4 + near * 5, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    drawProjectile(ctx, pr, x, y, t);
    const color = PROJECTILE_LIGHT[pr.kind];
    if (color && (pr.kind !== 'spike' || pr.t >= pr.warn)) {
      additive(ctx, () => glow(ctx, x + pr.w / 2, y + pr.h / 2, pr.kind === 'bullet' ? 6 : 14, color, 0.7));
    }
  }
  for (const pt of game.particles) {
    const life = Math.min(1, pt.life / 18);
    const x = snap(pt.x - camX);
    const y = snap(pt.y - camY);
    ctx.globalAlpha = life;
    ctx.fillStyle = pt.color;
    ctx.fillRect(x, y, pt.size, pt.size);
    ctx.globalAlpha = 1;
    if (GLOWING.has(pt.color) && pt.size >= 2) additive(ctx, () => glow(ctx, x + 1, y + 1, 5 + pt.size, pt.color, 0.3 * life));
  }

  drawDecor(ctx, level, camX, camY, t, 'front');
  drawWeather(ctx, theme, camX, t);

  for (const pop of game.popups) {
    const x = pop.screen ? pop.x - game.camera.x : pop.x - camX;
    const y = pop.screen ? pop.y - game.camera.y : pop.y - camY;
    ctx.globalAlpha = Math.min(1, pop.t / 15);
    drawText(ctx, pop.text, x, y, pop.color, { align: 'center', shadow: '#000000' });
    ctx.globalAlpha = 1;
  }

  // Vignette
  const v = ctx.createRadialGradient(CX, VIEW_H / 2, VIEW_H * 0.45, CX, VIEW_H / 2, VIEW_W * 0.65);
  v.addColorStop(0, alpha('#000000', 0));
  v.addColorStop(1, alpha('#000000', 0.55));
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  if (game.flash > 0) {
    ctx.fillStyle = alpha('#ffffff', game.flash / 20);
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (p.alive && p.hp < 30 && game.mode === 'play') {
    // Low health: pulsing red edges
    const pulse = 0.25 + 0.2 * Math.sin(t / 8);
    const r = ctx.createRadialGradient(CX, VIEW_H / 2, VIEW_H * 0.4, CX, VIEW_H / 2, VIEW_W * 0.6);
    r.addColorStop(0, alpha('#ff0020', 0));
    r.addColorStop(1, alpha('#ff0020', pulse));
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (hud) drawHud(ctx, game, t);
}

// ------------------------------------------------------------------- screens

export function dim(ctx, a = 0.6) {
  ctx.fillStyle = alpha('#000000', a);
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

export function drawLogo(ctx, y, t) {
  const title = GAME.title;
  const scale = textWidth(title, 5) <= VIEW_W - 60 ? 5 : 4;
  const height = 7 * scale;
  const w = textWidth(title, scale);
  additive(ctx, () => glow(ctx, CX, y + height / 2, w * 0.7, '#ff1040', 0.35 + 0.1 * Math.sin(t / 20)));
  drawText(ctx, title, CX + 1.5, y + 2, '#3a0010', { align: 'center', scale });
  drawText(ctx, title, CX + 0.5, y + 1, '#a00020', { align: 'center', scale });
  drawText(ctx, title, CX, y, vGradient(ctx, y, y + height, ['#ffffff', '#ffd0d8', '#ff4060', '#a00020']), { align: 'center', scale });
  // Dripping tendrils
  ctx.fillStyle = '#c0102e';
  for (let i = 0; i < w; i += 2) {
    const drip = hash2(i, 9) * 7 + Math.max(0, Math.sin(t / 25 + i * 0.7) * 4);
    ctx.fillRect(CX - w / 2 + i, y + height + 0.5, 1, drip);
  }
  drawText(ctx, GAME.subtitle, CX, y + height + 14, vGradient(ctx, y + height + 14, y + height + 28, ['#fff0a0', '#f8b800', '#c06000']), {
    align: 'center',
    scale: 2,
    shadow: '#401000',
  });
}

export function drawMenu(ctx, items, selected, y, t) {
  items.forEach((item, i) => {
    const active = i === selected;
    if (active) {
      const w = textWidth(item) + 30;
      const g = ctx.createLinearGradient(CX - w / 2, 0, CX + w / 2, 0);
      g.addColorStop(0, alpha('#ff2050', 0));
      g.addColorStop(0.5, alpha('#ff2050', 0.35));
      g.addColorStop(1, alpha('#ff2050', 0));
      ctx.fillStyle = g;
      ctx.fillRect(CX - w / 2, y + i * 13 - 2, w, 11);
    }
    const label = active ? `> ${item} <` : item;
    drawText(ctx, label, CX, y + i * 13, active ? (Math.floor(t / 15) % 2 ? '#ffffff' : '#ffd040') : '#b0b0c0', { align: 'center', shadow: '#000000' });
  });
}

export function drawPanel(ctx, x, y, w, h) {
  ctx.fillStyle = vGradient(ctx, y, y + h, [alpha('#1a0c20', 0.95), alpha('#08040c', 0.95)]);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#c0102e';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.strokeStyle = alpha('#ff8090', 0.35);
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + 2.25, y + 2.25, w - 4.5, h - 4.5);
}
