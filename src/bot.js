// A simple autopilot that plays the game: used for the title-screen demo and for screenshots.
import { MASS_MAX } from './config.js';
import { isConsumable } from './enemies.js';
import { centerX, centerY } from './physics.js';

export function createBot() {
  let game = null;
  let held = new Set();
  let prev = new Set();
  let stuck = 0;
  let lastX = 0;
  let t = 0;

  return {
    attach(g) {
      game = g;
    },
    update() {
      prev = held;
      held = new Set();
      if (!game || game.mode !== 'play') return;
      t++;
      const p = game.player;
      const px = centerX(p);
      const ahead = game.enemies
        .filter((e) => !e.dead && e.type !== 'heli' && Math.abs(centerY(e) - centerY(p)) < 30)
        .sort((a, b) => Math.abs(centerX(a) - px) - Math.abs(centerX(b) - px))[0];

      let dir = 1;
      if (ahead) {
        const dx = centerX(ahead) - px;
        if (Math.abs(dx) < 70) dir = Math.sign(dx) || 1;
        if (Math.abs(dx) < 34) {
          if (isConsumable(ahead) && (p.hp < 70 || ahead.type === 'soldier') && Math.abs(dx) < 20) held.add('consume');
          else if (t % 8 === 0) held.add('attack');
          if (Math.abs(dx) < 14) dir = 0;
        }
        // Claws for the big ones, fists for everything else.
        const want = ahead.type === 'hunter' || ahead.type === 'boss' ? 'p2' : 'p1';
        if (p.power !== (want === 'p2' ? 'claws' : 'fists')) held.add(want);
      }
      if (dir > 0) held.add('right');
      else if (dir < 0) held.add('left');

      if (p.mass >= MASS_MAX && ahead && Math.abs(centerX(ahead) - px) < 80) held.add('dev');
      // Jump the boss's shockwaves
      if (game.projectiles.some((pr) => pr.kind === 'wave' && Math.abs(pr.x - px) < 40)) held.add('jump');

      // Get unstuck
      if (Math.abs(p.x - lastX) < 0.2 && !p.attack && !p.consume) stuck++;
      else stuck = 0;
      lastX = p.x;
      if (stuck > 40) {
        held.add('jump');
        if (stuck > 80) stuck = 0;
      }
    },
    down: (a) => held.has(a),
    pressed: (a) => held.has(a) && !prev.has(a),
  };
}
