import { MASS_MAX, PHYS, PLAYER, PLAYER_MAX_HP, STEP } from './config.js';
import { approach2, dirOf, turnToward } from './math.js';
import { moveBody } from './physics.js';

export const POWERS = ['fists', 'claws', 'whip', 'blade'];
export const POWER_NAMES = { fists: 'FISTS', claws: 'CLAWS', whip: 'WHIPFIST', blade: 'BLADE' };

// Attack frames. Each one hits anything within `radius` of a line straight ahead of the player,
// from `near` to `far` metres out, at `height` above the feet. kb and lift are the speeds (m/s)
// it knocks a target away and up.
export const ATTACKS = {
  fists: [
    { dur: 14, from: 3, to: 7, near: 0.3, far: 1.5, radius: 0.6, height: 1.2, dmg: 1, kb: 4, lift: 3 },
    { dur: 14, from: 3, to: 7, near: 0.3, far: 1.5, radius: 0.6, height: 1.2, dmg: 1, kb: 4, lift: 3 },
    { dur: 20, from: 5, to: 10, near: 0.2, far: 1.7, radius: 0.8, height: 1.4, dmg: 2, kb: 7, lift: 8 },
  ],
  claws: [{ dur: 24, from: 7, to: 13, near: 0, far: 2.3, radius: 1.2, height: 1.1, dmg: 3, kb: 7, lift: 5, super: true }],
  whip: [{ dur: 28, from: 9, to: 17, near: 0.6, far: 8, radius: 0.7, height: 1.2, dmg: 2, kb: 6, lift: 3, super: true }],
  // Sword arm: a fast slash, then a heavy overhead cleave. Cuts projectiles out of the air and
  // bites through armour that blunts the other powers.
  blade: [
    { dur: 18, from: 5, to: 9, near: 0.3, far: 3, radius: 1, height: 1.2, dmg: 3, kb: 6, lift: 3, super: true, cuts: true },
    { dur: 26, from: 8, to: 14, near: 0, far: 3.4, radius: 1.4, height: 1, dmg: 5, kb: 10, lift: 9, super: true, cuts: true },
  ],
};

const SLAM_SPEED = 32;

export function createPlayer(x, y, z, yaw = 0) {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    r: PLAYER.radius,
    h: PLAYER.height,
    yaw,
    onGround: false,
    hitWall: null,
    hp: PLAYER_MAX_HP,
    mass: 0,
    power: 'fists',
    armor: false,
    disguised: false,
    alive: true,
    jumps: 0,
    coyote: 0,
    wallRun: null,
    gliding: false,
    dash: 0,
    dashCd: 0,
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

/** The line an active attack hits along, or null outside its active frames. */
export function attackSegment(p) {
  if (!p.attack) return null;
  const def = ATTACKS[p.attack.power][p.attack.index];
  if (p.attack.t < def.from || p.attack.t > def.to) return null;
  const f = dirOf(p.yaw);
  const y = p.y + def.height;
  return {
    a: { x: p.x + f.x * def.near, y, z: p.z + f.z * def.near },
    b: { x: p.x + f.x * def.far, y, z: p.z + f.z * def.far },
    radius: def.radius,
    def,
  };
}

function startAttack(p, game, power, index) {
  const def = ATTACKS[power][index];
  p.attack = { power, index, t: 0, hits: new Set() };
  p.comboQueued = false;
  game.autoAim(p, def.far + 2);
  if (p.onGround && (power === 'fists' || power === 'blade')) {
    const f = dirOf(p.yaw);
    const lunge = power === 'blade' ? 4 : 3;
    p.vx = f.x * lunge;
    p.vz = f.z * lunge;
  }
  game.sfx(power === 'fists' ? 'punch' : power);
  if (def.super) game.superMove(power);
}

/**
 * input: down(action), pressed(action), and moveVector(game) → { x, z }, the direction to move in
 * world space with length 0..1 (a human's stick is turned into world space by the camera).
 */
export function updatePlayer(p, game, input) {
  const level = game.level;
  const dt = STEP;
  p.animT++;
  if (p.invuln > 0) p.invuln--;
  if (p.hurt > 0) p.hurt--;
  if (p.dashCd > 0) p.dashCd--;
  if (p.inputLock > 0) p.inputLock--;
  p.sinceHit++;

  // Slow regeneration out of combat, up to 60%.
  if (p.sinceHit > 180 && p.hp < 60) p.hp = Math.min(60, p.hp + 0.06);

  // Devastator: hover in place while the tendrils burst out.
  if (p.dev > 0) {
    p.dev--;
    p.vx = p.vz = 0;
    p.vy = p.dev > 20 ? 1.2 : 0;
    if (p.dev === 20) game.devastatorBurst();
    p.anim = 'dev';
    moveBody(level, p, dt);
    return;
  }

  // Consuming: locked in place until it completes.
  if (p.consume) {
    [p.vx, p.vz] = approach2(p.vx, p.vz, 0, 0, PHYS.friction * dt);
    p.vy = Math.max(p.vy - PHYS.gravity * dt, -PHYS.maxFall);
    moveBody(level, p, dt);
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
  if (input.pressed('p5')) select('blade');
  if (input.pressed('cycle')) select(POWERS[(POWERS.indexOf(p.power) + 1) % POWERS.length]);
  if (input.pressed('p4')) {
    p.armor = !p.armor;
    game.sfx('armor');
    if (p.armor) game.superMove('armor');
  }

  const move = input.moveVector ? input.moveVector(game) : { x: 0, z: 0 };
  const moveLen = Math.min(1, Math.hypot(move.x, move.z));
  const speed = PHYS.run * (p.armor ? 0.78 : 1);

  if (p.onGround) {
    p.jumps = 0;
    p.coyote = 6;
  } else if (p.coyote > 0) p.coyote--;

  // Dash, in the direction you're pushing (or facing)
  if (input.pressed('dash') && p.dashCd === 0 && !p.attack && !p.slam) {
    if (moveLen > 0.2) p.yaw = Math.atan2(move.z, move.x);
    p.dash = PHYS.dashFrames;
    p.dashCd = PHYS.dashCooldown;
    p.invuln = Math.max(p.invuln, 8);
    game.sfx('dash');
    game.superMove('dash');
  }

  // Devastator
  if (input.pressed('dev') && p.mass >= MASS_MAX && !p.attack) {
    p.dev = 40;
    p.mass = 0;
    p.invuln = Math.max(p.invuln, 60);
    game.sfx('devCharge');
    game.superMove('devastator');
    return;
  }

  // Consume
  if (input.pressed('consume') && !p.attack && !p.slam) {
    game.tryConsume();
    if (p.consume) return;
  }

  // Attack. Claws in mid-air dive into a ground slam.
  if (input.pressed('attack') && !p.slam) {
    if (p.attack) {
      if (p.attack.index < ATTACKS[p.attack.power].length - 1) p.comboQueued = true;
    } else if (!p.onGround && p.power === 'claws' && p.y > (p.ground?.y1 ?? 0) + 1.5) {
      p.slam = true;
      p.vx = p.vz = 0;
      p.vy = -SLAM_SPEED;
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
      if (p.comboQueued) startAttack(p, game, p.attack.power, p.attack.index + 1);
      else p.attack = null;
    }
  }

  // Wall run: push into any climbable wall and you run straight up it.
  const wall = p.hitWall;
  const pushingWall = wall && !wall.box.noClimb && moveLen > 0.3 && !p.dash && !p.slam && !p.attack && move.x * -wall.nx + move.z * -wall.nz > 0.5;
  if (pushingWall) {
    if (!p.wallRun) game.superMove('wallrun');
    p.wallRun = { nx: wall.nx, nz: wall.nz };
    p.yaw = Math.atan2(-wall.nz, -wall.nx);
    p.vy = PHYS.wallClimb;
    p.jumps = 1;
  } else if (p.wallRun && !wall) {
    // Over the top: keep going forward onto the roof.
    p.wallRun = null;
  } else {
    p.wallRun = null;
  }

  // Jumping
  if (input.pressed('jump') && p.inputLock === 0 && !p.slam) {
    if (p.wallRun) {
      const { nx, nz } = p.wallRun;
      p.vx = nx * PHYS.wallJump;
      p.vz = nz * PHYS.wallJump;
      p.vy = PHYS.wallJumpUp;
      p.yaw = Math.atan2(nz, nx);
      p.wallRun = null;
      p.inputLock = 10;
      game.sfx('jump');
    } else if (p.onGround || p.coyote > 0) {
      p.vy = PHYS.jump;
      p.jumps = 1;
      p.coyote = 0;
      game.sfx('jump');
    } else if (p.jumps < 2) {
      p.vy = PHYS.doubleJump;
      p.jumps = 2;
      game.sfx('jump2');
      game.superMove('doublejump');
    }
  }
  // Releasing jump early makes a shorter hop.
  if (!input.down('jump') && p.vy > 6 && !p.wallRun && !p.dash) p.vy = 6;

  // Horizontal movement
  const wasGliding = p.gliding;
  p.gliding = !p.onGround && !p.wallRun && !p.slam && !p.dash && p.vy < 0 && input.down('jump') && p.inputLock === 0;
  if (p.dash > 0) {
    p.dash--;
    const f = dirOf(p.yaw);
    p.vx = f.x * PHYS.dash;
    p.vz = f.z * PHYS.dash;
    p.vy = 0;
    if (p.dash === 0) {
      p.vx = f.x * speed;
      p.vz = f.z * speed;
    }
  } else if (p.slam) {
    p.vx = p.vz = 0;
  } else if (p.wallRun) {
    // Keep pressed against the wall so the contact holds.
    p.vx = -p.wallRun.nx * 2;
    p.vz = -p.wallRun.nz * 2;
  } else if (p.inputLock === 0) {
    const rooted = p.attack && p.onGround;
    const top = p.gliding ? PHYS.glideSpeed : speed;
    const accel = (p.onGround ? (moveLen > 0.1 ? PHYS.accel : PHYS.friction) : PHYS.airAccel) * dt;
    const target = rooted ? [0, 0] : [move.x * top, move.z * top];
    [p.vx, p.vz] = approach2(p.vx, p.vz, target[0], target[1], rooted ? PHYS.friction * dt : accel);
    if (moveLen > 0.1 && !p.attack) p.yaw = turnToward(p.yaw, Math.atan2(move.z, move.x), 0.35);
  }

  // Gravity and gliding
  if (p.slam) {
    p.vy = -SLAM_SPEED;
  } else if (!p.dash && !p.wallRun) {
    p.vy = Math.max(p.vy - PHYS.gravity * dt, -PHYS.maxFall);
    if (p.gliding) {
      p.vy = Math.max(p.vy, -PHYS.glideFall);
      if (!wasGliding) game.superMove('glide');
    }
  }

  moveBody(level, p, dt);

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
  else if (!p.onGround) p.anim = p.gliding ? 'glide' : p.vy > 0 ? 'jump' : 'fall';
  else if (Math.hypot(p.vx, p.vz) > 0.5) p.anim = 'run';
  else p.anim = 'idle';
}
