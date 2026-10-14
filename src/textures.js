// Procedural textures, painted on small canvases and sampled with bilinear filtering, the way
// the N64 did. Facades cover 16 m × 16 m (4 storeys of 4 bays), so the window grid lines up with
// FLOOR in level.js. Each facade also has a glow map of its lit windows.
import * as THREE from 'three';
import { createRng } from './rng.js';

export const FACADE_SIZE = 16; // metres covered by one facade texture
const PX = 8; // texture pixels per metre

function texture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function noise(ctx, w, h, rng, amount, color = '#000000') {
  ctx.fillStyle = color;
  for (let i = 0; i < w * h * amount; i++) {
    ctx.globalAlpha = rng.range(0.05, 0.2);
    ctx.fillRect(rng.int(0, w - 1), rng.int(0, h - 1), 1, 1);
  }
  ctx.globalAlpha = 1;
}

const STYLES = {
  brick: { base: '#9c3a1c', trim: '#d8b890', glass: '#2a1a24' },
  concrete: { base: '#8a8a7e', trim: '#d0d0c4', glass: '#1c2230' },
  tan: { base: '#c4a26a', trim: '#f0dcae', glass: '#2a2432' },
  glass: { base: '#2a3a6a', trim: '#9ad8ff', glass: '#142050' },
};

/** A facade with windows: { map, glow }. */
function windowFacade(style, seed) {
  const col = STYLES[style];
  const rng = createRng(seed);
  const size = FACADE_SIZE * PX;
  const lit = [];
  const map = texture(size, size, (ctx) => {
    ctx.fillStyle = col.base;
    ctx.fillRect(0, 0, size, size);
    noise(ctx, size, size, rng, 0.25);
    if (style === 'brick') {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 0; y < size; y += 3) ctx.fillRect(0, y, size, 1);
    }
    for (let floor = 0; floor < 4; floor++) {
      const y0 = floor * 32;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, y0 + 31, size, 1);
      for (let bay = 0; bay < 4; bay++) {
        for (const wx of style === 'glass' ? [2] : [5, 19]) {
          const x = bay * 32 + wx;
          const w = style === 'glass' ? 28 : 9;
          const on = rng.chance(0.35);
          ctx.fillStyle = shadeHex(col.base, -0.5);
          ctx.fillRect(x - 1, y0 + 7, w + 2, 18);
          ctx.fillStyle = on ? '#e8d8a0' : col.glass;
          ctx.fillRect(x, y0 + 8, w, 16);
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(x + 1, y0 + 9, 2, 14);
          ctx.fillStyle = col.trim;
          ctx.fillRect(x - 1, y0 + 25, w + 2, 2);
          if (on) lit.push([x, y0 + 8, w, 16]);
        }
      }
    }
    if (style === 'glass') {
      ctx.fillStyle = 'rgba(160,220,255,0.15)';
      for (let x = 0; x < size; x += 32) ctx.fillRect(x, 0, 2, size);
    }
  });
  const glow = texture(size, size, (ctx) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    for (const [x, y, w, h] of lit) ctx.fillRect(x, y, w, h);
  });
  return { map, glow };
}

function containerFacade() {
  const size = FACADE_SIZE * PX;
  const map = texture(size, size, (ctx) => {
    // Grey corrugation; the colour comes from the vertex tint.
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 4) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, 0, 1, size);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x + 2, 0, 1, size);
    }
    // Container seams every 2.6 m-ish and door bars
    for (let y = 0; y < size; y += 21) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, y, size, 2);
    }
    for (let x = 40; x < size; x += 64) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(x, 0, 2, size);
      ctx.fillRect(x + 10, 0, 2, size);
    }
  });
  return { map, glow: blackTexture() };
}

function refineryFacade(seed) {
  const rng = createRng(seed);
  const size = FACADE_SIZE * PX;
  const lights = [];
  const map = texture(size, size, (ctx) => {
    ctx.fillStyle = '#3e423a';
    ctx.fillRect(0, 0, size, size);
    noise(ctx, size, size, rng, 0.3);
    for (let y = 10; y < size; y += 34) {
      ctx.fillStyle = '#7a8070';
      ctx.fillRect(0, y, size, 5);
      ctx.fillStyle = '#2a2e26';
      ctx.fillRect(0, y + 5, size, 2);
      for (let x = 8; x < size; x += 24) {
        ctx.fillStyle = '#5a6050';
        ctx.fillRect(x, y - 1, 3, 7);
      }
    }
    ctx.fillStyle = '#4e5446';
    ctx.fillRect(90, 0, 6, size);
    for (let i = 0; i < 6; i++) {
      const x = rng.int(4, size - 8);
      const y = rng.int(4, size - 8);
      ctx.fillStyle = '#c8f060';
      ctx.fillRect(x, y, 3, 3);
      lights.push([x, y]);
    }
  });
  const glow = texture(size, size, (ctx) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    for (const [x, y] of lights) ctx.fillRect(x, y, 3, 3);
  });
  return { map, glow };
}

function hiveFacade(seed) {
  const rng = createRng(seed);
  const size = 128;
  const veins = [];
  const map = texture(size, size, (ctx) => {
    ctx.fillStyle = '#3a0c3e';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 70; i++) {
      const r = rng.range(3, 10);
      ctx.fillStyle = rng.chance(0.5) ? '#7a1a5e' : '#4a1048';
      ctx.beginPath();
      ctx.ellipse(rng.range(0, size), rng.range(0, size), r, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#ff2a60';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const pts = [];
      let x = rng.range(0, size);
      for (let y = 0; y <= size; y += 16) {
        x += rng.range(-6, 6);
        pts.push([x, y]);
      }
      veins.push(pts);
      ctx.beginPath();
      pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
    }
  });
  const glow = texture(size, size, (ctx) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    for (const pts of veins) {
      ctx.beginPath();
      pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
    }
  });
  return { map, glow };
}

function arenaWall(seed) {
  const rng = createRng(seed);
  const size = 128;
  const map = texture(size, size, (ctx) => {
    ctx.fillStyle = '#5a5650';
    ctx.fillRect(0, 0, size, size);
    noise(ctx, size, size, rng, 0.4);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 0; x < size; x += 32) ctx.fillRect(x, 0, 2, size);
    for (let y = 0; y < size; y += 32) ctx.fillRect(0, y, size, 2);
    // Claw marks
    ctx.strokeStyle = 'rgba(30,0,0,0.6)';
    for (let i = 0; i < 4; i++) {
      const x = rng.range(10, size - 30);
      const y = rng.range(10, size - 30);
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        ctx.moveTo(x + k * 5, y);
        ctx.lineTo(x + k * 5 + 12, y + 20);
      }
      ctx.stroke();
    }
  });
  return { map, glow: blackTexture() };
}

let black;
function blackTexture() {
  black ??= texture(4, 4, (ctx) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 4, 4);
  });
  return black;
}

/** Facade textures by building style. */
export function createFacades() {
  return {
    brick: windowFacade('brick', 11),
    concrete: windowFacade('concrete', 12),
    tan: windowFacade('tan', 13),
    glass: windowFacade('glass', 14),
    container: containerFacade(),
    industrial: refineryFacade(15),
    hive: hiveFacade(16),
    wall: arenaWall(17),
  };
}

/** Flat roofs: gravel with the odd vent. */
export function createRoof() {
  const rng = createRng(21);
  return texture(64, 64, (ctx) => {
    ctx.fillStyle = '#6a6862';
    ctx.fillRect(0, 0, 64, 64);
    noise(ctx, 64, 64, rng, 1.2);
    noise(ctx, 64, 64, rng, 0.4, '#ffffff');
    ctx.fillStyle = '#4a4844';
    ctx.fillRect(40, 10, 10, 8);
    ctx.fillStyle = '#8a8880';
    ctx.fillRect(41, 11, 8, 2);
  });
}

/**
 * The street, as a strip across the city: v runs across from z = -halfWidth to +halfWidth, u
 * repeats every 8 m along it. Road in the middle, sidewalks either side, alleys beyond.
 */
export function createStreet(halfWidth, avenue) {
  const rng = createRng(31);
  const W = 64;
  const H = halfWidth * 2 * 4; // 4 px per metre across
  const zToY = (z) => (z + halfWidth) * 4;
  return texture(W, H, (ctx) => {
    ctx.fillStyle = '#3a3a3e';
    ctx.fillRect(0, 0, W, H);
    noise(ctx, W, H, rng, 0.6);
    // Road
    ctx.fillStyle = '#26262a';
    ctx.fillRect(0, zToY(-avenue), W, avenue * 8);
    noise(ctx, W, H, rng, 0.3, '#5a5a60');
    ctx.fillStyle = '#e8c040';
    ctx.fillRect(0, zToY(-0.15), W, 1.2);
    ctx.fillStyle = '#d8d8d0';
    for (const z of [-avenue / 2, avenue / 2]) ctx.fillRect(4, zToY(z), 24, 1);
    // Sidewalks with paving joints and kerbs
    for (const side of [-1, 1]) {
      const y0 = side < 0 ? zToY(-avenue - 3) : zToY(avenue);
      ctx.fillStyle = '#8a8a82';
      ctx.fillRect(0, y0, W, 12);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let x = 0; x < W; x += 16) ctx.fillRect(x, y0, 1, 12);
      ctx.fillRect(0, y0 + 6, W, 1);
      ctx.fillStyle = '#c8c8bc';
      ctx.fillRect(0, side < 0 ? y0 + 11 : y0, W, 1.5);
    }
    // A manhole
    ctx.fillStyle = '#18181a';
    ctx.beginPath();
    ctx.ellipse(40, zToY(-4), 3, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** Soft round shadow for under characters. */
export function createBlob() {
  const t = texture(32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(0,0,0,0.6)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** A small round dot with a soft edge, for particles. */
export function createDot() {
  const t = texture(16, 16, (ctx) => {
    const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 16);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Soft glowing dot, for lamps, sparks and the moon's halo. */
export function createGlow() {
  const t = texture(32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function shadeHex(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}
