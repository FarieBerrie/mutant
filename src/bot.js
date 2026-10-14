// A simple autopilot that plays the game: used for the title-screen demo and for tests. It steers
// in world space, so it doesn't need a camera.
import { MASS_MAX } from './config.js';
import { isBoss, isConsumable } from './enemies.js';
import { distXZ } from './math.js';

export function createBot() {
  let game = null;
  let held = new Set();
  let prev = new Set();
  let move = { x: 0, z: 0 };
  let stuck = 0;
  let last = { x: 0, z: 0 };
  let sidestep = 0;
  let t = 0;

  return {
    attach(g) {
      game = g;
    },
    update() {
      prev = held;
      held = new Set();
      move = { x: 0, z: 0 };
      if (!game || game.mode !== 'play') return;
      t++;
      const p = game.player;
      const ahead = game.enemies
        .filter((e) => !e.dead && e.type !== 'heli' && Math.abs(e.y - p.y) < 3 && distXZ(e, p) < 14)
        .sort((a, b) => distXZ(a, p) - distXZ(b, p))[0];

      // By default head along the avenue, drifting back to its middle.
      let mx = 1;
      let mz = Math.max(-1, Math.min(1, -p.z / 6));
      if (ahead) {
        const d = distXZ(ahead, p);
        const dx = (ahead.x - p.x) / (d || 1);
        const dz = (ahead.z - p.z) / (d || 1);
        if (d < 10) {
          mx = dx;
          mz = dz;
        }
        if (d < ahead.r + 2.2) {
          if (isConsumable(ahead) && (p.hp < 70 || ahead.type === 'soldier') && d < ahead.r + 1.4) held.add('consume');
          else if (t % 8 === 0) held.add('attack');
          if (d < ahead.r + 1.2) mx = mz = 0;
        }
        // The blade for the armoured Behemoth, claws for the other big ones, fists otherwise.
        const want = ahead.type === 'behemoth' ? ['p5', 'blade'] : ahead.type === 'hunter' || isBoss(ahead) ? ['p2', 'claws'] : ['p1', 'fists'];
        if (p.power !== want[1]) held.add(want[0]);
      }
      if (p.mass >= MASS_MAX && ahead && distXZ(ahead, p) < 8) held.add('dev');
      // Jump shockwave rings as they arrive; dash off marked spikes.
      if (game.projectiles.some((pr) => pr.kind === 'ring' && Math.abs(distXZ(p, pr) - pr.radius) < 2.5)) held.add('jump');
      if (game.projectiles.some((pr) => pr.kind === 'spike' && pr.t < pr.warn && distXZ(p, pr) < pr.r + 1)) held.add('dash');

      // Get unstuck: hop, and sidestep for a while.
      const moved = Math.hypot(p.x - last.x, p.z - last.z);
      last = { x: p.x, z: p.z };
      if (moved < 0.02 && !p.attack && !p.consume && (mx || mz)) stuck++;
      else stuck = Math.max(0, stuck - 1);
      if (stuck > 40) {
        held.add('jump');
        sidestep = 60 * (Math.random() < 0.5 ? -1 : 1);
        stuck = 0;
      }
      if (sidestep) {
        mz = Math.sign(sidestep);
        sidestep -= Math.sign(sidestep);
      }
      const len = Math.hypot(mx, mz);
      move = len ? { x: mx / len, z: mz / len } : { x: 0, z: 0 };
    },
    down: (a) => held.has(a),
    pressed: (a) => held.has(a) && !prev.has(a),
    moveVector: () => move,
  };
}
