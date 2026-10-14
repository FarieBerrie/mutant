// Maximus's cat: a grey companion that trots after him, sits when he stops and catches up (in a
// puff of smoke) when he leaves it behind, say by running up a building. It's part of the scene
// only: enemies ignore it and attacks pass through it.
import { PAL, PHYS, STEP } from './config.js';
import { groundHeight } from './level.js';
import { clamp, distXZ, turnToward, yawTo } from './math.js';
import { moveBody } from './physics.js';

const RUN = 11; // m/s: a little faster than Maximus, so it can keep up
const LOST_DISTANCE = 22; // further than this and it gives up and reappears beside him
const LOST_FRAMES = 45;
const SIT_AFTER = 120; // frames standing still before it sits
const MEOW_AT = 420;

export function createCat(p) {
  return {
    x: p.x - 1.4,
    y: p.y,
    z: p.z + 0.8,
    vx: 0,
    vy: 0,
    vz: 0,
    r: 0.2,
    h: 0.35,
    yaw: p.yaw,
    onGround: false,
    state: 'idle', // idle | run | sit
    idleT: 0,
    lostT: 0,
    animT: 0,
  };
}

/** Where the cat wants to be: just behind Maximus and off to his side. */
function heel(p) {
  const fx = Math.cos(p.yaw);
  const fz = Math.sin(p.yaw);
  return { x: p.x - fx * 1.4 - fz * 0.8, z: p.z - fz * 1.4 + fx * 0.8 };
}

function reappear(cat, game) {
  const p = game.player;
  const spot = heel(p);
  // Next to him if that's open ground at his height, otherwise right at his feet.
  const ground = groundHeight(game.level, spot.x, spot.z, cat.r, p.y + 0.5);
  const at = Math.abs(ground - p.y) < 0.5 ? spot : p;
  cat.x = at.x;
  cat.z = at.z;
  cat.y = p.y;
  cat.vx = cat.vy = cat.vz = 0;
  cat.yaw = p.yaw;
  cat.lostT = 0;
  game.addParticles(cat.x, cat.y + 0.3, cat.z, 12, [PAL.grayL, PAL.gray, PAL.white], { speed: 2 });
}

export function updateCat(cat, game) {
  const p = game.player;
  const dt = STEP;
  cat.animT++;

  // Lost: too far away, up on a roof it can't reach, or shut out of an arena.
  const shutOut = game.arenaLocked && cat.x < game.arena.x0 + 1;
  const stranded = p.onGround && Math.abs(p.y - cat.y) > 3;
  cat.lostT = distXZ(cat, p) > LOST_DISTANCE || stranded || shutOut ? cat.lostT + 1 : 0;
  if (cat.lostT > LOST_FRAMES) reappear(cat, game);

  const spot = heel(p);
  const d = distXZ(cat, spot);
  if (d > 0.6) {
    // Match his pace, plus a bit more the further behind it is.
    const speed = clamp(Math.hypot(p.vx, p.vz) + (d - 0.4) * 5, 2, RUN);
    cat.yaw = turnToward(cat.yaw, yawTo(cat, spot), 0.3);
    cat.vx = Math.cos(cat.yaw) * speed;
    cat.vz = Math.sin(cat.yaw) * speed;
    cat.state = 'run';
    cat.idleT = 0;
    if (cat.hitWall && cat.onGround) cat.vy = 8; // hop up onto things
  } else {
    cat.vx *= 0.7;
    cat.vz *= 0.7;
    cat.yaw = turnToward(cat.yaw, p.yaw, 0.05);
    cat.idleT++;
    cat.state = cat.idleT > SIT_AFTER ? 'sit' : 'idle';
    if (cat.idleT === MEOW_AT) game.sfx('meow');
  }

  cat.vy = Math.max(cat.vy - PHYS.gravity * dt, -PHYS.maxFall);
  moveBody(game.level, cat, dt);
}
