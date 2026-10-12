// Names shown in the game. Change these in one place if you publish it under another title.
export const GAME = {
  title: 'MUTANT',
  subtitle: '8-BIT',
  hero: 'MAXIMUS',
};

// NES-like resolution: 16×14 tiles of 16 px.
export const VIEW_W = 256;
export const VIEW_H = 224;
export const TILE = 16;
export const ROWS = 14;
export const GROUND_ROW = 12; // rows 12–13 are the street

// Palette in the spirit of the NES (2C02) colours.
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

// Physics, in pixels per frame at 60 fps.
export const PHYS = {
  gravity: 0.38,
  maxFall: 7,
  glideFall: 1.0,
  run: 2.4,
  accel: 0.45,
  friction: 0.6,
  jump: 6.4,
  doubleJump: 5.6,
  wallClimb: 3.4,
  wallJumpX: 3.6,
  wallJumpY: 6.0,
  dash: 5.8,
  dashFrames: 10,
  dashCooldown: 36,
};

export const PLAYER_MAX_HP = 100;
export const MASS_MAX = 100;
