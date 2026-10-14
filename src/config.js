// Names shown in the game. Change these in one place if you publish it under another title.
export const GAME = {
  title: 'MUTANT',
  subtitle: '64',
  hero: 'MAXIMUS',
};

// The HUD and menus are drawn on a 400×225 virtual canvas laid over the 3D view.
export const HUD_W = 400;
export const HUD_H = 225;

// The simulation runs at a fixed 60 steps a second. World units are metres; +x runs along the
// city from the first district to the last, y is up, z runs across the avenue.
export const STEP = 1 / 60;
export const WORLD = {
  halfWidth: 40, // the city corridor spans z = -40..40
  avenue: 9, // the avenue's road spans z = -9..9
};

// Base colours. The 32-bit renderer shades these automatically (see shade()).
export const PAL = {
  black: '#000000',
  ink: '#181818',
  grayD: '#3c3c3c',
  gray: '#7c7c7c',
  grayL: '#bcbcbc',
  white: '#fcfcfc',
  red: '#d82800',
  redL: '#f87858',
  redD: '#881400',
  viral: '#b0002a',
  viralL: '#ff2050',
  skin: '#fcbcb0',
  skinD: '#c86c50',
  jean: '#2038a8',
  jeanD: '#101c58',
  olive: '#588028',
  oliveD: '#304818',
  oliveL: '#88b048',
  green: '#00a800',
  greenL: '#58d854',
  zombie: '#8ca878',
  zombieD: '#4c6844',
  yellow: '#f8b800',
  yellowL: '#fce0a8',
  orange: '#e45c10',
  blue: '#0058f8',
  blueL: '#3cbcfc',
  navy: '#000088',
  purple: '#6844fc',
  purpleD: '#3c2090',
  magenta: '#940084',
  brown: '#7c4c00',
  brownL: '#ac7c00',
  brick: '#a83810',
  brickD: '#701c08',
  concrete: '#8c8c7c',
  concreteD: '#54544c',
  tan: '#c8a870',
  tanD: '#8c6c3c',
};

// Movement, in metres and seconds.
export const PHYS = {
  gravity: 34,
  maxFall: 40,
  run: 9.5,
  accel: 70,
  airAccel: 32,
  friction: 60,
  jump: 12.5,
  doubleJump: 11.5,
  glideFall: 3,
  glideSpeed: 13,
  wallClimb: 13,
  wallJump: 10,
  wallJumpUp: 11,
  dash: 28,
  dashFrames: 10,
  dashCooldown: 36,
};

export const PLAYER = { radius: 0.4, height: 1.8 };
export const PLAYER_MAX_HP = 100;
export const MASS_MAX = 100;

// ---------------------------------------------------------------- colour helpers

const shadeCache = new Map();

/** Lighten (amount > 0) or darken (amount < 0) a #rrggbb colour. Cached. */
export function shade(hex, amount) {
  const key = `${hex}|${amount}`;
  let out = shadeCache.get(key);
  if (out) return out;
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  out = `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  shadeCache.set(key, out);
  return out;
}

/** #rrggbb + alpha → rgba() string. */
export function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
