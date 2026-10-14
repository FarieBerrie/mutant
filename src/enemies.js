import { PHYS, STEP } from './config.js';
import { boxesNear, groundHeight } from './level.js';
import { angleDiff, clamp, dirOf, distXZ, rayBox, yawTo } from './math.js';
import { chest, moveBody } from './physics.js';

// Sizes in metres (r is half the body's width).
export const ENEMY_TYPES = {
  infected: { r: 0.4, h: 1.7, hp: 4, score: 50, heal: 12, mass: 15, consumable: true },
  soldier: { r: 0.4, h: 1.8, hp: 5, score: 100, heal: 25, mass: 20, consumable: true },
  hunter: { r: 0.8, h: 2.4, hp: 30, score: 500, heal: 40, mass: 60, consumable: 'stunned' },
  heli: { r: 2.4, h: 1.6, hp: 18, score: 800, flying: true },
  boss: { r: 1.1, h: 3.4, hp: 160, score: 5000, heal: 40, mass: 50, consumable: 'stunned', boss: true, name: 'SUPREME HUNTER' },
  // Armoured: only the blade cuts it properly; other attacks do 40% damage.
  behemoth: { r: 1.8, h: 4.6, hp: 260, score: 10000, heal: 50, mass: 60, consumable: 'stunned', boss: true, armored: true, name: 'THE BEHEMOTH' },
};

export const isBoss = (e) => ENEMY_TYPES[e.type].boss === true;

let nextId = 1;

export function createEnemy(type, x, y, z, rng = Math.random) {
  const def = ENEMY_TYPES[type];
  return {
    id: nextId++,
    type,
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    r: def.r,
    h: def.h,
    hp: def.hp,
    maxHp: def.hp,
    yaw: rng() * Math.PI * 2,
    onGround: false,
    state: def.boss ? 'intro' : 'idle',
    t: def.boss ? 110 : 0,
    cooldown: 30 + Math.floor(rng() * 40),
    leapCd: 60,
    shootT: 40 + Math.floor(rng() * 40),
    home: { x, z },
    speed: type === 'infected' ? 2.2 + rng() * 1.4 : 1,
    flash: 0,
    stagger: 0,
    grabbed: false,
    dead: false,
    stunnedOnce: { 66: false, 33: false, 20: false },
    animT: Math.floor(rng() * 60),
    hitPlayer: false,
    phase: 1,
  };
}

export const isConsumable = (e) => {
  const c = ENEMY_TYPES[e.type].consumable;
  return !e.dead && (c === true || (c === 'stunned' && e.state === 'stunned'));
};

const dt = STEP;

function physics(e, g) {
  e.vy = Math.max(e.vy - PHYS.gravity * dt, -PHYS.maxFall);
  moveBody(g.level, e, dt);
}

function walk(e, speed) {
  const f = dirOf(e.yaw);
  e.vx = f.x * speed;
  e.vz = f.z * speed;
}

function stop(e) {
  e.vx = e.vz = 0;
}

/** Is `target` within reach of e and roughly in front of it? */
function inFront(e, target, reach, cone = 1.2) {
  return distXZ(e, target) < reach + target.r && Math.abs(angleDiff(e.yaw, yawTo(e, target))) < cone && Math.abs(target.y - e.y) < e.h;
}

/** Line of sight between two bodies, eye to chest, blocked by any box. */
export function canSee(level, a, b, range) {
  const d = distXZ(a, b);
  if (d > range) return false;
  const o = { x: a.x, y: a.y + a.h * 0.9, z: a.z };
  const t = chest(b);
  const dir = { x: t.x - o.x, y: t.y - o.y, z: t.z - o.z };
  for (const box of boxesNear(level, Math.min(o.x, t.x), Math.max(o.x, t.x))) {
    if (rayBox(o, dir, box) < 1) return false;
  }
  return true;
}

function nearest(from, list, range, maxDy = 4) {
  let best = null;
  let bestD = range;
  for (const o of list) {
    if (o === from || o.dead) continue;
    const d = distXZ(from, o);
    if (d < bestD && Math.abs(o.y - from.y) < maxDy) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

function updateInfected(e, g) {
  const p = g.player;
  if (e.stagger > 0) {
    e.stagger--;
    e.vx *= 0.9;
    e.vz *= 0.9;
  } else {
    const soldiers = g.enemies.filter((o) => o.type === 'soldier');
    const target = nearest(e, p.alive ? [p, ...soldiers] : soldiers, 24, 6);
    if (!target) {
      e.state = 'idle';
      if (e.hitWall || Math.random() < 0.006) e.yaw += Math.PI * (0.5 + Math.random());
      walk(e, 0.8);
    } else if (e.state === 'windup') {
      stop(e);
      e.yaw = yawTo(e, target);
      if (--e.t <= 0) {
        e.state = 'lunge';
        e.t = 10;
        e.hitPlayer = false;
        walk(e, 9);
      }
    } else if (e.state === 'lunge') {
      if (!e.hitPlayer && inFront(e, target, 1.3)) {
        e.hitPlayer = true;
        if (target === p) g.damagePlayer(7, e);
        else g.damageEnemy(target, 2, dirOf(e.yaw), 2, 'infected');
      }
      if (--e.t <= 0) {
        e.state = 'chase';
        e.cooldown = 40;
      }
    } else {
      e.state = 'chase';
      e.yaw = yawTo(e, target);
      if (distXZ(e, target) < 1.6 && Math.abs(target.y - e.y) < 1.5 && e.cooldown <= 0) {
        e.state = 'windup';
        e.t = 16;
        stop(e);
      } else {
        walk(e, e.speed);
        if (e.hitWall && e.onGround) e.vy = 8; // scramble over obstacles
      }
    }
  }
  physics(e, g);
}

function updateSoldier(e, g) {
  const p = g.player;
  let target = null;
  if (p.alive && g.soldiersHostile() && canSee(g.level, e, p, 32)) {
    target = p;
    g.spotted(e);
  } else {
    const threats = g.enemies.filter((o) => o.type === 'infected' || o.type === 'hunter' || isBoss(o));
    target = nearest(e, threats, 22, 6);
  }

  if (e.stagger > 0) {
    e.stagger--;
    e.vx *= 0.9;
    e.vz *= 0.9;
  } else if (target) {
    e.state = 'aim';
    e.yaw = yawTo(e, target);
    // Keep a little distance while firing.
    if (distXZ(e, target) < 6) walk(e, -2);
    else stop(e);
    if (--e.shootT <= 0) {
      const f = dirOf(e.yaw);
      const muzzle = { x: e.x + f.x * 0.7, y: e.y + 1.35, z: e.z + f.z * 0.7 };
      const aim = chest(target);
      const spread = 0.04;
      const dx = aim.x - muzzle.x + (Math.random() - 0.5) * spread * 20;
      const dy = aim.y - muzzle.y;
      const dz = aim.z - muzzle.z + (Math.random() - 0.5) * spread * 20;
      const len = Math.hypot(dx, dy, dz) || 1;
      const speed = 42;
      g.spawnProjectile({ kind: 'bullet', ...muzzle, vx: (dx / len) * speed, vy: (dy / len) * speed, vz: (dz / len) * speed, r: 0.15, life: 90, owner: 'soldier', dmg: 6 });
      g.sfx('shoot');
      e.shootT = 48 + Math.floor(Math.random() * 30);
      e.muzzle = 4;
    }
  } else {
    e.state = 'patrol';
    if (e.shootT < 20) e.shootT = 20;
    if (e.hitWall || Math.hypot(e.x - e.home.x, e.z - e.home.z) > 8) e.yaw = yawTo(e, e.home) + (Math.random() - 0.5);
    // Rooftop guards stay on their roof.
    const f = dirOf(e.yaw);
    if (e.y > 0.5 && groundHeight(g.level, e.x + f.x * 1.2, e.z + f.z * 1.2, 0.1) < e.y - 0.5) e.yaw += Math.PI;
    walk(e, 1.5);
  }
  if (e.muzzle > 0) e.muzzle--;
  physics(e, g);
}

function updateHunter(e, g) {
  const p = g.player;
  if (e.state === 'stunned') {
    stop(e);
    if (--e.t <= 0) {
      e.state = 'stalk';
      e.hp = Math.max(e.hp, Math.ceil(e.maxHp * 0.35));
    }
    return physics(e, g);
  }
  if (e.stagger > 0) {
    e.stagger--;
    e.vx *= 0.9;
    e.vz *= 0.9;
    return physics(e, g);
  }
  if (e.leapCd > 0) e.leapCd--;
  if (e.cooldown > 0) e.cooldown--;
  const d = distXZ(e, p);
  const awake = d < 30 && p.alive;

  switch (e.state) {
    case 'windup':
      stop(e);
      if (--e.t <= 0) {
        e.state = 'swipe';
        e.t = 8;
        e.hitPlayer = false;
      }
      break;
    case 'swipe':
      if (!e.hitPlayer && inFront(e, p, 2.6)) {
        e.hitPlayer = true;
        g.damagePlayer(14, e, 9);
      }
      if (--e.t <= 0) {
        e.state = 'stalk';
        e.cooldown = 40;
      }
      break;
    case 'leap':
      if (e.onGround && e.vy <= 0) {
        e.state = 'stalk';
        g.shake(4);
        g.sfx('thud');
      }
      break;
    default:
      if (!awake) {
        e.state = 'idle';
        stop(e);
        break;
      }
      e.state = 'stalk';
      e.yaw = yawTo(e, p);
      walk(e, 5);
      if (d < 2.6 && Math.abs(p.y - e.y) < 2.5 && e.cooldown <= 0) {
        e.state = 'windup';
        e.t = 14;
      } else if (d > 6 && d < 18 && e.onGround && e.leapCd <= 0) {
        e.state = 'leap';
        e.vy = 12 + Math.max(0, p.y - e.y) * 0.8;
        walk(e, Math.min(14, d * 1.1));
        e.leapCd = 110;
        g.sfx('roarSmall');
      } else if (e.hitWall && e.onGround) {
        e.vy = 11;
      }
  }
  physics(e, g);
}

function updateHeli(e, g) {
  const p = g.player;
  e.animT++;
  if (!g.soldiersHostile() || g.alert <= 0) e.leaving = true;
  if (e.leaving) {
    e.vy = Math.min(e.vy + 0.3, 14);
    e.y += e.vy * dt;
    e.x += e.vx * dt;
    if (e.y > p.y + 80) e.dead = e.gone = true;
    return;
  }
  // Circle the player out of reach, then hang off its shoulder to fire.
  const a = e.animT / 150;
  const tx = p.x + Math.cos(a) * 16;
  const tz = p.z + Math.sin(a) * 16;
  const ty = Math.max(p.y, groundHeight(g.level, p.x, p.z)) + 15;
  e.vx = clamp((tx - e.x) * 1.2, -14, 14);
  e.vz = clamp((tz - e.z) * 1.2, -14, 14);
  e.vy = clamp((ty - e.y) * 2, -8, 8);
  e.x += e.vx * dt;
  e.y += e.vy * dt;
  e.z += e.vz * dt;
  e.yaw = yawTo(e, p);
  if (--e.shootT <= 0 && p.alive) {
    const from = { x: e.x, y: e.y - 0.6, z: e.z };
    const to = chest(p);
    const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) || 1;
    const speed = 18;
    g.spawnProjectile({ kind: 'rocket', ...from, vx: ((to.x - from.x) / len) * speed, vy: ((to.y - from.y) / len) * speed, vz: ((to.z - from.z) / len) * speed, r: 0.3, life: 240, owner: 'heli', dmg: 16 });
    g.sfx('rocket');
    e.shootT = 110;
  }
}

function bossPhase(e) {
  const pct = e.hp / e.maxHp;
  e.phase = pct > 0.66 ? 1 : pct > 0.33 ? 2 : 3;
}

function shockwave(g, e, speed, dmg) {
  g.spawnProjectile({ kind: 'ring', x: e.x, y: e.y, z: e.z, radius: e.r, speed, life: 90, owner: e.type, dmg, vx: 0, vy: 0, vz: 0, r: 0 });
}

function updateBoss(e, g) {
  const p = g.player;
  e.animT++;
  bossPhase(e);
  const d = distXZ(e, p);
  if (e.cooldown > 0) e.cooldown--;

  switch (e.state) {
    case 'intro':
      stop(e);
      e.yaw = yawTo(e, p);
      if (e.t === 100) {
        g.sfx('roar');
        g.shake(12);
      }
      if (--e.t <= 0) e.state = 'stalk';
      break;
    case 'stunned':
      stop(e);
      if (--e.t <= 0) e.state = 'stalk';
      break;
    case 'windup':
      stop(e);
      if (--e.t <= 0) {
        e.state = 'swipe';
        e.t = 10;
        e.hitPlayer = false;
      }
      break;
    case 'swipe':
      if (!e.hitPlayer && inFront(e, p, 3.4)) {
        e.hitPlayer = true;
        g.damagePlayer(18, e, 11);
      }
      if (--e.t <= 0) {
        e.state = 'stalk';
        e.cooldown = 30;
      }
      break;
    case 'leap':
      if (e.onGround && e.vy <= 0) {
        stop(e);
        e.state = 'stalk';
        e.cooldown = 50 - e.phase * 8;
        g.shake(10);
        g.sfx('slam');
        shockwave(g, e, 11 + e.phase, 14);
      }
      break;
    case 'chargeWindup':
      stop(e);
      e.yaw = yawTo(e, p);
      if (--e.t <= 0) {
        e.state = 'charge';
        e.t = 90;
        e.hitPlayer = false;
        g.sfx('roarSmall');
      }
      break;
    case 'charge':
      walk(e, 16 + e.phase * 1.5);
      if (!e.hitPlayer && distXZ(e, p) < e.r + p.r + 0.4 && Math.abs(p.y - e.y) < e.h) {
        e.hitPlayer = true;
        g.damagePlayer(20, e, 14);
      }
      if (e.hitWall) {
        e.state = 'stunned';
        e.t = 70;
        stop(e);
        g.shake(12);
        g.sfx('slam');
      } else if (--e.t <= 0) e.state = 'stalk';
      break;
    default: {
      e.state = 'stalk';
      e.yaw = yawTo(e, p);
      walk(e, [4.5, 5.5, 7][e.phase - 1]);
      if (e.cooldown > 0) break;
      const roll = Math.random();
      if (d < 3.4) {
        e.state = 'windup';
        e.t = e.phase === 3 ? 10 : 16;
      } else if (roll < 0.4) {
        // Leap at the player: up for about 0.8 s, landing where they stand.
        e.state = 'leap';
        e.vy = 13.6;
        walk(e, Math.min(18, d / 0.8));
        g.sfx('roarSmall');
      } else if (e.phase >= 2 && roll < 0.7) {
        e.state = 'chargeWindup';
        e.t = 30;
      } else if (e.phase >= 2 && roll < 0.85) {
        g.summonInfected(e.phase);
        g.sfx('roar');
        e.cooldown = 90;
      } else {
        e.cooldown = 40;
      }
    }
  }
  physics(e, g);
}

// The Behemoth: slow, armoured, and dangerous at range. Ground pounds send out a shockwave ring
// (and from phase 2 bring rubble down from the sky), acid spit arcs toward you, and from phase 2
// it marks the street where spikes are about to burst up.
function updateBehemoth(e, g) {
  const p = g.player;
  e.animT++;
  bossPhase(e);
  const d = distXZ(e, p);
  if (e.cooldown > 0) e.cooldown--;

  switch (e.state) {
    case 'intro':
      stop(e);
      e.yaw = yawTo(e, p);
      if (e.t === 100) {
        g.sfx('roar');
        g.shake(16);
      }
      if (--e.t <= 0) e.state = 'stalk';
      break;
    case 'stunned':
      stop(e);
      if (--e.t <= 0) e.state = 'stalk';
      break;
    case 'windup':
      stop(e);
      if (--e.t <= 0) {
        e.state = 'swipe';
        e.t = 12;
        e.hitPlayer = false;
      }
      break;
    case 'swipe':
      if (!e.hitPlayer && inFront(e, p, 4.6, 1.4)) {
        e.hitPlayer = true;
        g.damagePlayer(22, e, 13);
      }
      if (--e.t <= 0) {
        e.state = 'stalk';
        e.cooldown = 36;
      }
      break;
    case 'pound':
      stop(e);
      if (--e.t <= 0) {
        g.shake(14);
        g.sfx('quake');
        shockwave(g, e, 10, 16);
        if (e.phase >= 2) {
          const n = 2 + e.phase;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + Math.random();
            const r = i === 0 ? 0 : 2.5 + Math.random() * 3;
            g.spawnProjectile({ kind: 'rock', x: p.x + Math.cos(a) * r, y: p.y + 26 + i * 4, z: p.z + Math.sin(a) * r, vx: 0, vy: -4, vz: 0, r: 0.7, life: 300, owner: 'behemoth', dmg: 14 });
          }
        }
        e.state = 'stalk';
        e.cooldown = 64 - e.phase * 8;
      }
      break;
    case 'spit':
      stop(e);
      e.yaw = yawTo(e, p);
      if (--e.t <= 0) {
        const n = e.phase === 3 ? 5 : 3;
        const f = dirOf(e.yaw);
        const mouth = { x: e.x + f.x * 1.8, y: e.y + 3.4, z: e.z + f.z * 1.8 };
        for (let i = 0; i < n; i++) {
          // Lob each glob to land near the player in about a second, fanned out sideways.
          const spread = (i - (n - 1) / 2) * 2.2;
          const tx = p.x - f.z * spread;
          const tz = p.z + f.x * spread;
          const T = 1;
          const gy = 18;
          g.spawnProjectile({
            kind: 'acid',
            ...mouth,
            vx: (tx - mouth.x) / T,
            vy: (p.y - mouth.y) / T + 0.5 * gy * T,
            vz: (tz - mouth.z) / T,
            gravity: gy,
            r: 0.35,
            life: 200,
            owner: 'behemoth',
            dmg: 12,
          });
        }
        g.sfx('spit');
        e.state = 'stalk';
        e.cooldown = 46;
      }
      break;
    case 'spikes':
      stop(e);
      if (--e.t <= 0) {
        const n = e.phase === 3 ? 6 : 4;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const r = i === 0 ? 0 : 3.2;
          const x = p.x + Math.cos(a) * r;
          const z = p.z + Math.sin(a) * r;
          g.spawnProjectile({ kind: 'spike', x, y: groundHeight(g.level, x, z), z, vx: 0, vy: 0, vz: 0, r: 1.1, t: 0, warn: 44, life: 76, owner: 'behemoth', dmg: 16 });
        }
        g.sfx('spikeWarn');
        e.state = 'stalk';
        e.cooldown = 70;
      }
      break;
    default: {
      e.state = 'stalk';
      e.yaw = yawTo(e, p);
      walk(e, [2.4, 3, 3.6][e.phase - 1]);
      if (e.cooldown > 0) break;
      const roll = Math.random();
      if (d < 4.6) {
        e.state = 'windup';
        e.t = e.phase === 3 ? 12 : 18;
      } else if (roll < 0.35) {
        e.state = 'pound';
        e.t = 34;
        g.sfx('roarSmall');
      } else if (roll < 0.65) {
        e.state = 'spit';
        e.t = 22;
      } else if (e.phase >= 2 && roll < 0.85) {
        e.state = 'spikes';
        e.t = 20;
        g.sfx('roarSmall');
      } else {
        e.cooldown = 30;
      }
    }
  }
  physics(e, g);
}

export function updateEnemy(e, g) {
  e.animT++;
  if (e.flash > 0) e.flash--;
  if (e.cooldown > 0 && !isBoss(e) && e.type !== 'hunter') e.cooldown--;
  if (e.grabbed) {
    stop(e);
    return;
  }
  switch (e.type) {
    case 'infected':
      return updateInfected(e, g);
    case 'soldier':
      return updateSoldier(e, g);
    case 'hunter':
      return updateHunter(e, g);
    case 'heli':
      return updateHeli(e, g);
    case 'boss':
      return updateBoss(e, g);
    case 'behemoth':
      return updateBehemoth(e, g);
  }
}
