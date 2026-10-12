import { PHYS, TILE } from './config.js';
import { isLedge, isSolid, tileAt } from './level.js';
import { centerX, centerY, moveBody, overlaps } from './physics.js';

export const ENEMY_TYPES = {
  infected: { w: 10, h: 20, hp: 4, score: 50, heal: 12, mass: 15, consumable: true },
  soldier: { w: 10, h: 22, hp: 5, score: 100, heal: 25, mass: 20, consumable: true },
  hunter: { w: 18, h: 26, hp: 30, score: 500, heal: 40, mass: 60, consumable: 'stunned' },
  heli: { w: 40, h: 16, hp: 18, score: 800, flying: true },
  boss: { w: 28, h: 36, hp: 160, score: 5000, heal: 40, mass: 50, consumable: 'stunned' },
};

let nextId = 1;

export function createEnemy(type, x, feetY, rng = Math.random) {
  const def = ENEMY_TYPES[type];
  return {
    id: nextId++,
    type,
    x: x - def.w / 2,
    y: feetY - def.h,
    w: def.w,
    h: def.h,
    vx: 0,
    vy: 0,
    hp: def.hp,
    maxHp: def.hp,
    facing: rng() < 0.5 ? -1 : 1,
    onGround: false,
    state: type === 'boss' ? 'intro' : 'idle',
    t: type === 'boss' ? 110 : 0,
    cooldown: 30 + Math.floor(rng() * 40),
    leapCd: 60,
    shootT: 40 + Math.floor(rng() * 40),
    home: x,
    speed: type === 'infected' ? 0.55 + rng() * 0.35 : 1,
    flash: 0,
    stagger: 0,
    grabbed: false,
    dead: false,
    stunnedOnce: { 66: false, 33: false, 20: false },
    animT: Math.floor(rng() * 60),
    hitPlayer: false,
  };
}

export const isConsumable = (e) => {
  const c = ENEMY_TYPES[e.type].consumable;
  return !e.dead && (c === true || (c === 'stunned' && e.state === 'stunned'));
};

const sign = (v) => (v < 0 ? -1 : 1);

function gravity(e, level) {
  e.vy = Math.min(e.vy + PHYS.gravity, PHYS.maxFall);
  moveBody(level, e);
}

/** Is there floor just ahead of the enemy's leading foot? (So patrols don't walk off roofs.) */
function groundAhead(level, e) {
  const x = e.facing > 0 ? e.x + e.w + 2 : e.x - 2;
  const c = Math.floor(x / TILE);
  const r = Math.floor((e.y + e.h + 2) / TILE);
  const t = tileAt(level, c, r);
  return isSolid(t) || isLedge(t);
}

/** Rough line of sight at eye level: sample the tiles between two bodies. */
export function canSee(level, a, b, range) {
  const dx = centerX(b) - centerX(a);
  const dy = centerY(b) - centerY(a);
  if (Math.abs(dx) > range || Math.abs(dy) > 56) return false;
  const steps = Math.ceil(Math.abs(dx) / 8);
  for (let i = 1; i < steps; i++) {
    const x = centerX(a) + (dx * i) / steps;
    const y = a.y + 6 + (dy * i) / steps;
    if (isSolid(tileAt(level, Math.floor(x / TILE), Math.floor(y / TILE)))) return false;
  }
  return true;
}

function nearest(from, list, range, maxDy = 40) {
  let best = null;
  let bestD = range;
  for (const o of list) {
    if (o === from || o.dead) continue;
    const d = Math.abs(centerX(o) - centerX(from));
    if (d < bestD && Math.abs(centerY(o) - centerY(from)) < maxDy) {
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
  } else {
    const soldiers = g.enemies.filter((o) => o.type === 'soldier');
    const candidates = p.alive ? [p, ...soldiers] : soldiers;
    const target = nearest(e, candidates, 210, 60);
    if (!target) {
      e.vx = e.facing * 0.3;
      if (e.hitWall || !groundAhead(g.level, e) || Math.random() < 0.004) e.facing *= -1;
      e.state = 'idle';
    } else {
      const dx = centerX(target) - centerX(e);
      const dy = centerY(target) - centerY(e);
      if (e.state !== 'lunge') e.facing = sign(dx);
      if (e.state === 'windup') {
        e.vx = 0;
        if (--e.t <= 0) {
          e.state = 'lunge';
          e.t = 10;
          e.vx = e.facing * 2.4;
          e.hitPlayer = false;
        }
      } else if (e.state === 'lunge') {
        const reach = { x: e.facing > 0 ? e.x + e.w - 2 : e.x - 8, y: e.y + 4, w: 10, h: 12 };
        if (!e.hitPlayer && overlaps(reach, target)) {
          e.hitPlayer = true;
          if (target === p) g.damagePlayer(7, centerX(e));
          else g.damageEnemy(target, 2, e.facing * 1.5, -1, 'infected');
        }
        if (--e.t <= 0) {
          e.state = 'chase';
          e.cooldown = 40;
        }
      } else {
        e.state = 'chase';
        if (Math.abs(dx) < 16 && Math.abs(dy) < 18 && e.cooldown <= 0) {
          e.state = 'windup';
          e.t = 16;
          e.vx = 0;
        } else {
          e.vx = e.facing * e.speed;
          if (e.hitWall && e.onGround) e.vy = -5.4; // scramble over obstacles
        }
      }
    }
  }
  gravity(e, g.level);
}

function updateSoldier(e, g) {
  const p = g.player;
  let target = null;
  if (p.alive && g.soldiersHostile() && canSee(g.level, e, p, 180)) {
    target = p;
    g.spotted(e);
  } else {
    const threats = g.enemies.filter((o) => o.type === 'infected' || o.type === 'hunter' || o.type === 'boss');
    target = nearest(e, threats, 160, 40);
  }

  if (e.stagger > 0) {
    e.stagger--;
  } else if (target) {
    const dx = centerX(target) - centerX(e);
    e.facing = sign(dx);
    e.state = 'aim';
    // Keep a little distance while firing.
    const backOff = Math.abs(dx) < 40 && groundAheadBehind(g.level, e);
    e.vx = backOff ? -e.facing * 0.7 : 0;
    if (--e.shootT <= 0) {
      const muzzleX = e.facing > 0 ? e.x + e.w + 8 : e.x - 8;
      const muzzleY = e.y + 8;
      const dist = Math.max(16, Math.abs(dx));
      const vy = Math.max(-1.2, Math.min(1.2, ((centerY(target) - muzzleY) / dist) * 3.8));
      g.spawnProjectile({ kind: 'bullet', x: muzzleX, y: muzzleY, w: 4, h: 2, vx: e.facing * 3.8, vy, life: 110, owner: 'soldier', dmg: 6 });
      g.sfx('shoot');
      e.shootT = 48 + Math.floor(Math.random() * 30);
      e.muzzle = 4;
    }
  } else {
    e.state = 'patrol';
    if (e.shootT < 20) e.shootT = 20;
    e.vx = e.facing * 0.45;
    if (e.hitWall || !groundAhead(g.level, e)) e.facing = -e.facing;
    else if (Math.abs(centerX(e) - e.home) > 56) e.facing = centerX(e) > e.home ? -1 : 1;
  }
  if (e.muzzle > 0) e.muzzle--;
  gravity(e, g.level);
}

function groundAheadBehind(level, e) {
  const probe = { ...e, facing: -e.facing };
  return groundAhead(level, probe);
}

function updateHunter(e, g) {
  const p = g.player;
  if (e.state === 'stunned') {
    e.vx = 0;
    if (--e.t <= 0) {
      e.state = 'stalk';
      e.hp = Math.max(e.hp, Math.ceil(e.maxHp * 0.35));
    }
    gravity(e, g.level);
    return;
  }
  if (e.stagger > 0) {
    e.stagger--;
    gravity(e, g.level);
    return;
  }
  if (e.leapCd > 0) e.leapCd--;
  if (e.cooldown > 0) e.cooldown--;
  const dx = centerX(p) - centerX(e);
  const dy = centerY(p) - centerY(e);
  const awake = Math.abs(dx) < 220 && p.alive;

  switch (e.state) {
    case 'windup':
      e.vx = 0;
      if (--e.t <= 0) {
        e.state = 'swipe';
        e.t = 8;
        e.hitPlayer = false;
      }
      break;
    case 'swipe': {
      const box = { x: e.facing > 0 ? e.x + e.w - 4 : e.x - 20, y: e.y + 4, w: 24, h: 22 };
      if (!e.hitPlayer && overlaps(box, p)) {
        e.hitPlayer = true;
        g.damagePlayer(14, centerX(e), 4);
      }
      if (--e.t <= 0) {
        e.state = 'stalk';
        e.cooldown = 40;
      }
      break;
    }
    case 'leap':
      if (e.onGround && e.vy >= 0) {
        e.state = 'stalk';
        g.shake(4);
        g.sfx('thud');
      }
      break;
    default:
      if (!awake) {
        e.state = 'idle';
        e.vx = 0;
        break;
      }
      e.state = 'stalk';
      e.facing = sign(dx);
      e.vx = e.facing * 1.3;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 26 && e.cooldown <= 0) {
        e.state = 'windup';
        e.t = 14;
      } else if (Math.abs(dx) > 50 && Math.abs(dx) < 150 && e.onGround && e.leapCd <= 0) {
        e.state = 'leap';
        e.vy = -6.8;
        e.vx = e.facing * 3.2;
        e.leapCd = 110;
        g.sfx('roarSmall');
      } else if (e.hitWall && e.onGround) {
        e.vy = -6.5;
      }
  }
  gravity(e, g.level);
}

function updateHeli(e, g) {
  const p = g.player;
  e.animT++;
  if (!g.soldiersHostile() || g.alert <= 0) e.leaving = true;
  if (e.leaving) {
    e.vy = Math.max(e.vy - 0.08, -2.2);
    e.x += e.vx;
    e.y += e.vy;
    if (e.y < g.camera.y - 80) e.dead = e.gone = true;
    return;
  }
  const tx = centerX(p) + Math.sin(e.animT / 70) * 70 - e.w / 2;
  const ty = g.camera.y + 48 + Math.sin(e.animT / 37) * 6; // below the HUD
  e.vx = Math.max(-2.2, Math.min(2.2, e.vx + (tx - e.x) * 0.004));
  e.vx *= 0.98;
  e.vy = (ty - e.y) * 0.05;
  e.x += e.vx;
  e.y += e.vy;
  e.facing = sign(centerX(p) - centerX(e));
  if (--e.shootT <= 0 && p.alive) {
    const sx = centerX(e);
    const sy = e.y + e.h;
    const ang = Math.atan2(centerY(p) - sy, centerX(p) - sx);
    g.spawnProjectile({ kind: 'rocket', x: sx, y: sy, w: 6, h: 3, vx: Math.cos(ang) * 2.4, vy: Math.sin(ang) * 2.4, life: 220, owner: 'heli', dmg: 16 });
    g.sfx('rocket');
    e.shootT = 110;
  }
}

function updateBoss(e, g) {
  const p = g.player;
  e.animT++;
  const pct = e.hp / e.maxHp;
  e.phase = pct > 0.66 ? 1 : pct > 0.33 ? 2 : 3;
  const dx = centerX(p) - centerX(e);
  if (e.cooldown > 0) e.cooldown--;

  switch (e.state) {
    case 'intro':
      e.vx = 0;
      if (e.t === 100) g.sfx('roar');
      if (e.t === 100) g.shake(12);
      if (--e.t <= 0) e.state = 'stalk';
      break;
    case 'stunned':
      e.vx = 0;
      if (--e.t <= 0) e.state = 'stalk';
      break;
    case 'windup':
      e.vx = 0;
      if (--e.t <= 0) {
        e.state = 'swipe';
        e.t = 10;
        e.hitPlayer = false;
      }
      break;
    case 'swipe': {
      const box = { x: e.facing > 0 ? e.x + e.w - 6 : e.x - 26, y: e.y + 6, w: 32, h: 30 };
      if (!e.hitPlayer && overlaps(box, p)) {
        e.hitPlayer = true;
        g.damagePlayer(18, centerX(e), 5);
      }
      if (--e.t <= 0) {
        e.state = 'stalk';
        e.cooldown = 30;
      }
      break;
    }
    case 'leap':
      if (e.onGround && e.vy >= 0 && e.t-- <= 0) {
        e.state = 'stalk';
        e.cooldown = 50 - e.phase * 8;
        g.shake(10);
        g.sfx('slam');
        const groundY = e.y + e.h;
        g.spawnProjectile({ kind: 'wave', x: centerX(e) - 6, y: groundY - 12, w: 12, h: 12, vx: -3, vy: 0, life: 120, owner: 'boss', dmg: 14 });
        g.spawnProjectile({ kind: 'wave', x: centerX(e) - 6, y: groundY - 12, w: 12, h: 12, vx: 3, vy: 0, life: 120, owner: 'boss', dmg: 14 });
      }
      break;
    case 'chargeWindup':
      e.vx = 0;
      if (--e.t <= 0) {
        e.state = 'charge';
        e.t = 90;
        e.hitPlayer = false;
        g.sfx('roarSmall');
      }
      break;
    case 'charge':
      e.vx = e.facing * (4.2 + e.phase * 0.4);
      if (!e.hitPlayer && overlaps(e, p)) {
        e.hitPlayer = true;
        g.damagePlayer(20, centerX(e), 6);
      }
      if (e.hitWall) {
        e.state = 'stunned';
        e.t = 70;
        g.shake(12);
        g.sfx('slam');
      } else if (--e.t <= 0) e.state = 'stalk';
      break;
    default: {
      e.state = 'stalk';
      e.facing = sign(dx);
      e.vx = e.facing * [1.1, 1.4, 1.8][e.phase - 1];
      if (e.cooldown > 0) break;
      const roll = Math.random();
      if (Math.abs(dx) < 34) {
        e.state = 'windup';
        e.t = e.phase === 3 ? 10 : 16;
      } else if (roll < 0.4) {
        e.state = 'leap';
        e.t = 2;
        e.vy = -8;
        e.vx = Math.max(-3.6, Math.min(3.6, dx / 40));
        g.sfx('roarSmall');
      } else if (e.phase >= 2 && roll < 0.7) {
        e.state = 'chargeWindup';
        e.t = 30;
      } else if (e.phase >= 2 && roll < 0.85) {
        g.summonInfected(2 + e.phase - 2);
        g.sfx('roar');
        e.cooldown = 90;
      } else {
        e.cooldown = 40;
      }
    }
  }
  gravity(e, g.level);
}

export function updateEnemy(e, g) {
  e.animT++;
  if (e.flash > 0) e.flash--;
  if (e.cooldown > 0 && e.type !== 'boss' && e.type !== 'hunter') e.cooldown--;
  if (e.grabbed) {
    e.vx = 0;
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
  }
}
