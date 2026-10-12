import { GROUND_ROW, TILE } from '../src/config.js';
import { Game } from '../src/game.js';
import { surfaceRow } from '../src/level.js';

/** Input you can drive from a test: hold/release buttons, or tap for a single frame. */
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

/** Moves the player to the first stretch of open street at least `width` px long. */
export function placeOnOpenStreet(game, width = 200) {
  const { level, player } = game;
  const need = Math.ceil(width / TILE);
  for (let c = 2; c < level.cols - need; c++) {
    let clear = true;
    for (let k = 0; k < need && clear; k++) clear = surfaceRow(level, c + k) === GROUND_ROW;
    if (clear) {
      player.x = c * TILE + 4;
      player.y = GROUND_ROW * TILE - player.h;
      player.vx = player.vy = 0;
      game.camera.x = Math.max(0, player.x - 60);
      return c * TILE;
    }
  }
  throw new Error(`No open street ${width}px wide`);
}

export function step(game, input, frames = 1, each = null) {
  for (let i = 0; i < frames; i++) {
    each?.(i);
    game.update();
    input.endFrame();
  }
}
