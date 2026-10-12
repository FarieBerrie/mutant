import { MASS_MAX, PHYS, PLAYER_MAX_HP } from './config.js';
import { moveBody, wallBeside } from './physics.js';

export const POWERS = ['fists', 'claws', 'whip'];
export const POWER_NAMES = { fists: 'FISTS', claws: 'CLAWS', whip: 'WHIPFIST' };

// Attack frames. box = [forward offset from centre, offset up from feet, width, height].
export const ATTACKS = {
  fists: [
    { dur: 14, from: 3, to: 7, box: [3, -19, 15, 12], dmg: 1, kb: 1.8, lift: -1.5 },
    { dur: 14, from: 3, to: 7, box: [3, -19, 15, 12], dmg: 1, kb: 1.8, lift: -1.5 },
    { dur: 20, from: 5, to: 10, box: [3, -24, 17, 20], dmg: 2, kb: 3.6, lift: -3.5 },
  ],
  claws: [{ dur: 24, from: 7, to: 13, box: [1, -28, 26, 28], dmg: 3, kb: 3.4, lift: -2.5, super: true }],
  whip: [{ dur: 28, from: 9, to: 17, box: [5, -18, 68, 10], dmg: 2, kb: 2.6, lift: -1.5, super: true }],
};

const DROP_FRAMES = 12;

export function createPlayer(x, feetY) {
  return {
    x: x - 5,
    y: feetY - 22,
    w: 10,
    h: 22,
    vx: 0,
    vy: 0,
    facing: 1,
    onGround: false,
    hp: PLAYER_MAX_HP,
    mass: 0,
    power: 'fists',
    armor: false,
    disguised: false,
    alive: true,
    jumps: 0,
    coyote: 0,
    wallRun: 0,
    gliding: false,
    dash: 0,
    dashCd: 0,
    dropT: 0,
    dropThrough: false,
    attack: null,
    comboQueued: false,
    slam: false,
    consume: null,
    dev: 0,
    invuln: 0,
    hurt: 0,
    sinceHit: 999,
    inputLock: 0,
    anim: 'idle',
    animT: 0,
  };
}

const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

function startAttack(p, game, power, index) {
  const def = ATTACKS[power][index];
  p.attack = { power, index, t: 0, hits: new Set() };
  p.comboQueued = false;
  if (p.onGround && power === 'fists') p.vx = p.facing * 1.4; // small lunge
  game.sfx(power === 'fists' ? 'punch' : power);
  if (def.super) game.superMove(power);
}

export function attackBox(p) {
  if (!p.attack) return null;
  const def = ATTACKS[p.attack.power][p.attack.index];
  if (p.attack.t < def.from || p.attack.t > def.to) return null;
  const [dx, dy, w, h] = def.box;
  const cx = p.x + p.w / 2;
  return { x: p.facing > 0 ? cx + dx : cx - dx - w, y: p.y + p.h + dy, w, h, def };
}

export function updatePlayer(p, game, input) {
  const level = game.level;
  p.animT++;
  if (p.invuln > 0) p.invuln--;
  if (p.hurt > 0) p.hurt--;
  if (p.dashCd > 0) p.dashCd--;
  if (p.inputLock > 0) p.inputLock--;
  if (p.dropT > 0) p.dropT--;
  p.dropThrough = p.dropT > 0;
  p.sinceHit++;

  // Slow regeneration out of combat, up to 60%.
  if (p.sinceHit > 180 && p.hp < 60) p.hp = Math.min(60, p.hp + 0.06);

  // Devastator: hover in place while the tendrils burst out.
  if (p.dev > 0) {
    p.dev--;
    p.vx = 0;
    p.vy = p.dev > 20 ? -0.4 : 0;
    if (p.dev === 20) game.devastatorBurst();
    p.anim = 'dev';
    moveBody(level, p);
    return;
  }

  // Consuming: locked in place until it completes.
  if (p.consume) {
    p.vx = approach(p.vx, 0, PHYS.friction);
    p.vy = Math.min(p.vy + PHYS.gravity, PHYS.maxFall);
    moveBody(level, p);
    p.anim = 'consume';
    if (++p.consume.t >= 26) game.finishConsume();
    return;
  }

  // Power selection
  const select = (power) => {
    if (p.power !== power) {
      p.power = power;
      game.sfx('select');
    }
  };
  if (input.pressed('p1')) select('fists');
  if (input.pressed('p2')) select('claws');
  if (input.pressed('p3')) select('whip');
  if (input.pressed('cycle')) select(POWERS[(POWERS.indexOf(p.power) + 1) % POWERS.length]);
  if (input.pressed('p4')) {
    p.armor = !p.armor;
    game.sfx('armor');
    if (p.armor) game.superMove('armor');
  }

  const dir = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);
  const speed = PHYS.run * (p.armor ? 0.78 : 1);

  if (p.onGround) {
    p.jumps = 0;
    p.coyote = 6;
  } else if (p.coyote > 0) p.coyote--;

  // Dash
  if (input.pressed('dash') && p.dashCd === 0 && !p.attack && !p.slam) {
    p.dash = PHYS.dashFrames;
    p.dashCd = PHYS.dashCooldown;
    p.invuln = Math.max(p.invuln, 8);
    if (dir) p.facing = dir;
    game.sfx('dash');
    game.superMove('dash');
  }

  // Devastator
  if (input.pressed('dev') && p.mass >= MASS_MAX && !p.attack) {
    p.dev = 40;
    p.mass = 0;
    p.invuln = Math.max(p.invuln, 60);
    p.attack = null;
    game.sfx('devCharge');
    game.superMove('devastator');
    return;
  }

  // Consume
  if (input.pressed('consume') && !p.attack && !p.slam) {
    game.tryConsume();
    if (p.consume) return;
  }

  // Attack
  if (input.pressed('attack') && !p.slam) {
    if (p.attack) {
      if (p.attack.power === 'fists' && p.attack.index < 2) p.comboQueued = true;
    } else if (!p.onGround && p.power === 'claws' && input.down('down')) {
      p.slam = true;
      p.vx = 0;
      p.vy = 8;
      game.sfx('dive');
      game.superMove('slam');
    } else {
      startAttack(p, game, p.power, 0);
    }
  }
  if (p.attack) {
    p.attack.t++;
    const def = ATTACKS[p.attack.power][p.attack.index];
    if (p.attack.t >= def.dur) {
      if (p.comboQueued) startAttack(p, game, 'fists', p.attack.index + 1);
      else p.attack = null;
    }
  }

  // Wall run: run straight up any building you push into.
  const pushingWall = dir !== 0 && !p.dash && !p.slam && !p.attack && wallBeside(level, p, dir);
  if (pushingWall) {
    if (!p.wallRun) game.superMove('wallrun');
    p.wallRun = dir;
    p.facing = dir;
    p.vy = -PHYS.wallClimb;
    p.jumps = 1;
  } else {
    p.wallRun = 0;
  }

  // Jumping
  if (input.pressed('jump') && p.inputLock === 0 && !p.slam) {
    if (input.down('down') && p.onGround) {
      p.dropT = DROP_FRAMES; // drop through scaffolding
    } else if (p.wallRun) {
      p.vx = -p.wallRun * PHYS.wallJumpX;
      p.vy = -PHYS.wallJumpY;
      p.facing = -p.wallRun;
      p.wallRun = 0;
      p.inputLock = 10;
      game.sfx('jump');
    } else if (p.onGround || p.coyote > 0) {
      p.vy = -PHYS.jump;
      p.jumps = 1;
      p.coyote = 0;
      game.sfx('jump');
    } else if (p.jumps < 2) {
      p.vy = -PHYS.doubleJump;
      p.jumps = 2;
      game.sfx('jump2');
      game.superMove('doublejump');
    }
  }
  // Releasing jump early makes a shorter hop.
  if (!input.down('jump') && p.vy < -2.5 && !p.wallRun && !p.dash) p.vy = -2.5;

  // Horizontal movement
  if (p.dash > 0) {
    p.dash--;
    p.vx = PHYS.dash * p.facing;
    p.vy = 0;
    if (p.dash === 0) p.vx = speed * p.facing;
  } else if (p.slam) {
    p.vx = 0;
  } else if (p.inputLock === 0) {
    const rooted = p.attack && p.onGround;
    if (dir && !rooted) {
      p.vx = Math.max(-speed, Math.min(speed, p.vx + dir * PHYS.accel));
      if (!p.attack) p.facing = dir;
    } else {
      p.vx = approach(p.vx, 0, PHYS.friction);
    }
  }

  // Gravity and gliding
  const wasGliding = p.gliding;
  p.gliding = false;
  if (p.slam) {
    p.vy = 8;
  } else if (!p.dash && !p.wallRun) {
    p.vy = Math.min(p.vy + PHYS.gravity, PHYS.maxFall);
    if (!p.onGround && p.vy > 0 && input.down('jump') && p.inputLock === 0) {
      p.vy = Math.min(p.vy, PHYS.glideFall);
      p.gliding = true;
      if (!wasGliding) game.superMove('glide');
    }
  }

  moveBody(level, p);

  if (p.slam && p.onGround) {
    p.slam = false;
    game.slamLanded();
  }

  // Animation state for the renderer
  if (p.hurt > 0) p.anim = 'hurt';
  else if (p.slam) p.anim = 'slam';
  else if (p.attack) p.anim = 'attack';
  else if (p.wallRun) p.anim = 'wall';
  else if (p.dash) p.anim = 'dash';
  else if (!p.onGround) p.anim = p.gliding ? 'glide' : p.vy < 0 ? 'jump' : 'fall';
  else if (Math.abs(p.vx) > 0.3) p.anim = 'run';
  else p.anim = 'idle';
}
