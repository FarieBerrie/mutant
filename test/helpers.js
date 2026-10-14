import { Game } from '../src/game.js';
import { groundHeight } from '../src/level.js';

/**
 * Input you can drive from a test: hold/release buttons, or tap for a single frame. Directions
 * move in world space: up = +x (along the city), right = +z.
 */
export function scriptedInput() {
  const held = new Set();
  let pressed = new Set();
  const taps = new Set();
  return {
    down: (a) => held.has(a),
    pressed: (a) => pressed.has(a),
    hold: (a) => held.add(a),
    release: (a) => held.delete(a),
    tap(a) {
      pressed.add(a);
      held.add(a);
      taps.add(a);
    },
    moveVector() {
      const x = (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0);
      const z = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
      const len = Math.hypot(x, z) || 1;
      return { x: x / len, z: z / len };
    },
    endFrame() {
      pressed = new Set();
      for (const a of taps) held.delete(a);
      taps.clear();
    },
  };
}

/** A game with no enemies spawning on their own, so each test controls the scene. */
export function quietGame() {
  const input = scriptedInput();
  const game = new Game({ input });
  game.spawnCursor = game.level.spawns.length;
  game.enemies = [];
  return { game, input };
}

/** Puts the player on the street at (x, z), facing +x, and lets them settle. */
export function placePlayer(game, x, z = 0) {
  const p = game.player;
  p.x = x;
  p.z = z;
  p.y = groundHeight(game.level, x, z, p.r);
  p.vx = p.vy = p.vz = 0;
  p.yaw = 0;
  return p;
}

/** The first spot on the avenue's centre line with `clear` metres of open street ahead. */
export function openStreet(game, clear = 20, from = 10) {
  const { level } = game;
  for (let x = from; x < level.length - clear; x += 1) {
    let ok = true;
    for (let k = 0; k <= clear && ok; k += 0.5) ok = groundHeight(level, x + k, 0, 1.5) === 0;
    if (ok) return x;
  }
  throw new Error(`No open street ${clear} m long`);
}

export function step(game, input, frames = 1, each = null) {
  for (let i = 0; i < frames; i++) {
    each?.(i);
    game.update();
    input.endFrame?.();
  }
}
