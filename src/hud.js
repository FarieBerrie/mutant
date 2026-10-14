// The HUD and menus, drawn in pixel art on a 400×225 canvas laid over the 3D view.
import { alpha, GAME, HUD_H, HUD_W, MASS_MAX, PLAYER_MAX_HP, shade } from './config.js';
import { ENEMY_TYPES } from './enemies.js';
import { drawText, textWidth } from './font.js';
import { POWER_NAMES } from './player.js';
import { hash2 } from './rng.js';

export const CX = HUD_W / 2;
const hudState = new WeakMap(); // smoothed health trail per game

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
  // Hood down: bunched grey round the shoulders, black jacket below
  ctx.fillStyle = '#18181e';
  ctx.fillRect(x + 2, y + 18, 18, 4);
  ctx.fillStyle = '#7c7c84';
  ctx.beginPath();
  ctx.ellipse(x + 11, y + 18.5, 8.5, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5a5a62';
  ctx.fillRect(x + 7, y + 17, 8, 1);
  // Neck, face and ears
  ctx.fillStyle = '#7a4630';
  ctx.fillRect(x + 9, y + 14, 4, 3);
  ctx.fillStyle = '#9a5e40';
  ctx.beginPath();
  ctx.ellipse(x + 11, y + 10.5, 5, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x + 5, y + 9.5, 1, 3);
  ctx.fillRect(x + 16, y + 9.5, 1, 3);
  // The fade: solid black on top, thinning to skin down the sides
  ctx.fillStyle = '#0a0a0c';
  ctx.beginPath();
  ctx.ellipse(x + 11, y + 7, 5.4, 3.6, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(x + 5.6, y + 6.5, 10.8, 1.2);
  const fade = ctx.createLinearGradient(0, y + 7, 0, y + 11);
  fade.addColorStop(0, 'rgba(10,10,12,0.95)');
  fade.addColorStop(1, 'rgba(10,10,12,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(x + 5.6, y + 7, 1.6, 4);
  ctx.fillRect(x + 14.8, y + 7, 1.6, 4);
  // Brows, eyes (glowing red when powers are out), nose, mouth
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(x + 7.5, y + 8.6, 2.5, 0.6);
  ctx.fillRect(x + 12, y + 8.6, 2.5, 0.6);
  const eye = p.disguised ? '#58d854' : p.dev > 0 || p.attack ? '#ff2050' : '#f0ece4';
  ctx.fillStyle = eye;
  ctx.fillRect(x + 8, y + 9.6, 1.6, 0.8);
  ctx.fillRect(x + 12.4, y + 9.6, 1.6, 0.8);
  if (eye === '#ff2050') additive(ctx, () => glow(ctx, x + 11, y + 10, 6, eye, 0.6));
  ctx.fillStyle = '#7a4630';
  ctx.fillRect(x + 10.4, y + 10.5, 1.2, 2);
  ctx.fillStyle = '#4a2018';
  ctx.fillRect(x + 9.4, y + 13.6, 3.2, 0.6);
  ctx.strokeStyle = p.hp < 30 ? (Math.floor(t / 8) % 2 ? '#ff2050' : '#801020') : '#8a8aa0';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, 21, 21);
}

function powerIcon(ctx, x, y, power, armor) {
  ctx.fillStyle = '#121218';
  ctx.fillRect(x, y, 14, 14);
  ctx.strokeStyle = '#8a8aa0';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + 0.25, y + 0.25, 13.5, 13.5);
  if (power === 'fists') {
    ctx.fillStyle = '#e8b090';
    ctx.fillRect(x + 4, y + 4, 6, 6);
    ctx.fillStyle = '#a06a50';
    for (let k = 0; k < 4; k++) ctx.fillRect(x + 4 + k * 1.5, y + 4, 0.5, 2.5);
  } else if (power === 'claws') {
    ctx.fillStyle = '#d02030';
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
    ctx.fillRect(x + 7, y + 6, 1, 1);
    ctx.fillRect(x + 9, y + 4, 1, 1);
  } else {
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#d02030';
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 10);
    ctx.bezierCurveTo(x + 5, y + 2, x + 8, y + 12, x + 11, y + 4);
    ctx.stroke();
  }
  if (armor) {
    ctx.strokeStyle = '#c0c0d0';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 1, y - 1, 16, 16);
  }
}

/** project(x, y, z) → { x, y } on the HUD, or null if behind the camera. */
export function drawHud(ctx, game, t, project) {
  const p = game.player;
  let st = hudState.get(game);
  if (!st) {
    st = { trail: p.hp };
    hudState.set(game, st);
  }
  st.trail = st.trail > p.hp ? Math.max(p.hp, st.trail - 0.6) : p.hp;

  // Popups over the 3D view
  for (const pop of game.popups) {
    const s = project(pop.x, pop.y, pop.z);
    if (!s) continue;
    ctx.globalAlpha = Math.min(1, pop.t / 15);
    drawText(ctx, pop.text, s.x, s.y, pop.color, { align: 'center', shadow: '#000000' });
    ctx.globalAlpha = 1;
  }

  // Damage flash, devastator flash and the low-health pulse
  if (game.flash > 0) {
    ctx.fillStyle = alpha('#ffffff', game.flash / 20);
    ctx.fillRect(0, 0, HUD_W, HUD_H);
  }
  if (p.alive && p.hp < 30 && game.mode === 'play') {
    const pulse = 0.25 + 0.2 * Math.sin(t / 8);
    const r = ctx.createRadialGradient(CX, HUD_H / 2, HUD_H * 0.4, CX, HUD_H / 2, HUD_W * 0.6);
    r.addColorStop(0, alpha('#ff0020', 0));
    r.addColorStop(1, alpha('#ff0020', pulse));
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, HUD_W, HUD_H);
  }

  // Top panel
  ctx.fillStyle = vGradient(ctx, 0, 28, [alpha('#000000', 0.75), alpha('#000000', 0.35)]);
  ctx.fillRect(0, 0, HUD_W, 28);
  drawPortrait(ctx, 4, 3, p, t);
  drawText(ctx, GAME.hero, 30, 3, '#e8e0f0', { shadow: '#000000' });
  hudBar(ctx, 30, 12, 92, 5, p.hp / PLAYER_MAX_HP, p.hp < 30 ? '#ff3040' : '#d82030', { trail: st.trail / PLAYER_MAX_HP });
  const full = p.mass >= MASS_MAX;
  hudBar(ctx, 30, 20, 92, 3, p.mass / MASS_MAX, full ? '#ff40c0' : '#7a4cff', { glowing: full && Math.floor(t / 6) % 2 === 0 });

  powerIcon(ctx, CX - 46, 6, p.power, p.armor);
  drawText(ctx, POWER_NAMES[p.power] + (p.armor ? ' + ARMOR' : ''), CX - 28, 6, p.armor ? '#d0d0e0' : '#ff8080', { shadow: '#000000' });
  if (full) drawText(ctx, 'V: DEVASTATOR READY', CX - 28, 16, Math.floor(t / 10) % 2 ? '#ff60c0' : '#ffd040', { shadow: '#000000' });
  else if (p.disguised) drawText(ctx, 'DISGUISED', CX - 28, 16, '#70f070', { shadow: '#000000' });

  drawText(ctx, String(game.score).padStart(7, '0'), HUD_W - 6, 4, '#ffffff', { align: 'right', shadow: '#000000' });
  if (game.alert > 0) {
    const hot = game.alert >= 60 && Math.floor(t / 8) % 2;
    drawText(ctx, 'ALERT', HUD_W - 70, 16, hot ? '#ffffff' : '#ff4040', { shadow: '#000000' });
    hudBar(ctx, HUD_W - 38, 17, 32, 4, game.alert / 100, '#ff3030', { glowing: game.alert >= 60 });
  }

  if (game.bossActive) {
    const b = game.boss;
    ctx.fillStyle = vGradient(ctx, HUD_H - 22, HUD_H, [alpha('#000000', 0.4), alpha('#000000', 0.8)]);
    ctx.fillRect(0, HUD_H - 22, HUD_W, 22);
    drawText(ctx, ENEMY_TYPES[b.type].name, 10, HUD_H - 19, '#ff7070', { shadow: '#000000' });
    hudBar(ctx, 10, HUD_H - 9, HUD_W - 20, 4, b.hp / b.maxHp, b.phase === 3 ? '#ff2050' : '#c030c0', { glowing: b.phase === 3 });
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

// ------------------------------------------------------------------- screens

export function dim(ctx, a = 0.6) {
  ctx.fillStyle = alpha('#000000', a);
  ctx.fillRect(0, 0, HUD_W, HUD_H);
}

export function drawLogo(ctx, y, t) {
  const title = GAME.title;
  const scale = textWidth(title, 5) <= HUD_W - 60 ? 5 : 4;
  const height = 7 * scale;
  const w = textWidth(title, scale);
  additive(ctx, () => glow(ctx, CX, y + height / 2, w * 0.7, '#ff1040', 0.35 + 0.1 * Math.sin(t / 20)));
  drawText(ctx, title, CX + 1.5, y + 2, '#3a0010', { align: 'center', scale });
  drawText(ctx, title, CX + 0.5, y + 1, '#a00020', { align: 'center', scale });
  drawText(ctx, title, CX, y, vGradient(ctx, y, y + height, ['#ffffff', '#ffd0d8', '#ff4060', '#a00020']), { align: 'center', scale });
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
