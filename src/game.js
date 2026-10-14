import { MASS_MAX, PAL, PLAYER_MAX_HP, STEP } from './config.js';
import { canSee, createEnemy, ENEMY_TYPES, isBoss, isConsumable, updateEnemy } from './enemies.js';
import { boxesNear, buildLevel, districtAt, groundHeight, openArena } from './level.js';
import { angleDiff, dirOf, distXZ, pointSegmentDistance, yawTo } from './math.js';
import { chest } from './physics.js';
import { attackSegment, createPlayer, updatePlayer } from './player.js';

const WITNESS_RANGE = 22;
const SPAWN_AHEAD = 70; // spawns wake up this far ahead of the player
const DESPAWN_BEHIND = 90;
// Damage sources that count as the player's doing (score, alerting soldiers).
const BY_PLAYER = new Set(['player', 'blade', 'consume', 'devastator']);
// Armoured enemies take this share of damage from everything but the blade.
const ARMOR_FACTOR = 0.4;
// Projectiles a blade slash can cut out of the air.
const CUTTABLE = new Set(['bullet', 'rocket', 'acid', 'rock']);
const TIME_BONUS = 40000;
const dt = STEP;

/**
 * One play-through: the city, the player, everyone in it, and the rules that connect them.
 * Rendering and audio live elsewhere; `audio` only needs an optional sfx(name) method.
 * `viewYaw` is the camera's heading, which human input uses to turn sticks into world directions.
 */
export class Game {
  constructor({ input, audio = null, seed = 1985 } = {}) {
    this.input = input;
    this.audio = audio;
    this.level = buildLevel(seed);
    this.score = 0;
    this.kills = 0;
    this.consumes = 0;
    this.deaths = 0;
    this.frame = 0;
    this.checkpoint = 0;
    this.viewYaw = 0;
    this.listeners = new Set();
    this.bossesDefeated = new Set(); // arena indexes; survives respawns
    this.reset();
  }

  /** (Re)start from the current checkpoint. */
  reset() {
    const cp = this.level.checkpoints[this.checkpoint];
    const keepMass = this.player ? Math.floor(this.player.mass / 2) : 0;
    this.player = createPlayer(cp.x, groundHeight(this.level, cp.x, cp.z, 0.4), cp.z);
    this.player.mass = keepMass;
    this.viewYaw = 0;
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.popups = [];
    this.alert = 0;
    this.lastSeen = -999;
    this.hitstop = 0;
    this.shakeT = 0;
    this.flash = 0;
    this.mode = 'play';
    this.modeT = 0;
    this.arena = null; // the arena you're locked in
    this.arenaLocked = false;
    this.boss = null;
    this.bossDownT = 0;
    this.armorHintT = -999;
    this.ambientT = 0;
    this.spawnCursor = this.level.spawns.findIndex((s) => s.x > cp.x + 20);
    if (this.spawnCursor === -1) this.spawnCursor = this.level.spawns.length;
    this.district = districtAt(this.level, cp.x);
    this.banner = { text: this.level.districts[this.district].name, t: 150 };
    this.emit('district', this.level.districts[this.district]);
  }

  respawn() {
    this.deaths++;
    this.reset();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, data) {
    for (const fn of this.listeners) fn(type, data);
  }

  sfx(name) {
    this.audio?.sfx?.(name);
  }

  shake(amount) {
    this.shakeT = Math.max(this.shakeT, amount);
  }

  // ---------------------------------------------------------------- update

  update() {
    this.frame++;
    this.modeT++;
    if (this.flash > 0) this.flash--;
    if (this.shakeT > 0) this.shakeT--;

    if (this.mode === 'dead' || this.mode === 'victory') {
      this.updateParticles();
      return;
    }
    if (this.hitstop > 0) {
      this.hitstop--;
      return;
    }

    const p = this.player;
    updatePlayer(p, this, this.input);
    if (this.arenaLocked && p.x < this.arena.x0 + 1) {
      p.x = this.arena.x0 + 1;
      p.vx = Math.max(p.vx, 0);
    }

    this.activateSpawns();
    this.spawnAmbient();
    this.updateAlert();

    for (const e of this.enemies) if (!e.dead) updateEnemy(e, this);
    this.resolvePlayerAttacks();
    this.updateProjectiles();

    // Remove the dead (the boss lingers for its death sequence), and anyone left far behind.
    this.enemies = this.enemies.filter((e) => !e.dead || (e === this.boss && this.bossDownT > 0));
    this.enemies = this.enemies.filter((e) => isBoss(e) || e.type === 'heli' || e.x > p.x - DESPAWN_BEHIND);

    this.updateCheckpoints();
    this.updateArena();
    this.updateParticles();

    // A boss goes down in a chain of explosions. The last one wins the game; the others open
    // their arena's far wall.
    if (this.bossDownT > 0 && this.boss && this.bossDownT % 12 === 0) {
      const b = this.boss;
      this.explode(b.x + (Math.random() - 0.5) * b.r * 2, b.y + Math.random() * b.h, b.z + (Math.random() - 0.5) * b.r * 2, 0, 0);
    }
    if (this.bossDownT > 0 && --this.bossDownT === 0) {
      if (this.arena.final) this.win();
      else this.leaveArena();
    }
  }

  win() {
    this.mode = 'victory';
    this.modeT = 0;
    this.timeBonus = Math.max(0, TIME_BONUS - Math.floor(this.frame / 60) * 20);
    this.score += this.timeBonus;
    this.emit('victory');
  }

  leaveArena() {
    openArena(this.level, this.arena);
    this.arenaLocked = false;
    this.arena = null;
    this.boss = null;
    this.flash = 10;
    this.shake(14);
    this.sfx('slam');
    const p = this.player;
    this.popup(p.x, p.y + 2.4, p.z, 'THE WAY IS OPEN', PAL.yellow);
    this.emit('arenaCleared');
  }

  activateSpawns() {
    const spawns = this.level.spawns;
    while (this.spawnCursor < spawns.length && spawns[this.spawnCursor].x < this.player.x + SPAWN_AHEAD) {
      const s = spawns[this.spawnCursor++];
      if (this.level.arenas.some((a) => s.x >= a.x0 && s.x < a.x1)) continue;
      this.enemies.push(createEnemy(s.type, s.x, s.y, s.z));
    }
  }

  spawnAmbient() {
    const d = this.level.districts[this.district];
    if (!d.ambient || this.arenaLocked) return;
    if (++this.ambientT < 140) return;
    this.ambientT = 0;
    const p = this.player;
    const near = this.enemies.filter((e) => e.type === 'infected' && distXZ(e, p) < 40).length;
    if (near >= d.ambient) return;
    // Shamble in from the street ahead or behind, out of reach.
    const x = p.x + (Math.random() < 0.65 ? 1 : -1) * (28 + Math.random() * 10);
    const z = (Math.random() - 0.5) * this.level.avenue * 1.6;
    if (x < d.x0 || x > d.x1) return;
    const e = createEnemy('infected', x, groundHeight(this.level, x, z, 0.4, 3), z);
    e.yaw = yawTo(e, p);
    this.enemies.push(e);
  }

  // ---------------------------------------------------------------- disguise & alert

  soldiersHostile() {
    return !this.player.disguised;
  }

  spotted() {
    this.lastSeen = this.frame;
    const before = this.alert;
    this.alert = Math.min(100, this.alert + 1.5);
    if (before < 60 && this.alert >= 60) this.sfx('alert');
  }

  soldiersNear(range = WITNESS_RANGE, except = null) {
    const p = this.player;
    return this.enemies.filter((e) => e.type === 'soldier' && !e.dead && e !== except && !e.grabbed && distXZ(e, p) < range && Math.abs(e.y - p.y) < 8);
  }

  /** Anything superhuman done near soldiers gives the disguise away. */
  superMove() {
    if (this.player.disguised && this.soldiersNear().length > 0) this.blowDisguise();
  }

  blowDisguise() {
    const p = this.player;
    if (!p.disguised) return;
    p.disguised = false;
    this.alert = 100;
    this.lastSeen = this.frame;
    this.sfx('alert');
    this.popup(p.x, p.y + 2.2, p.z, 'DISGUISE BLOWN', PAL.redL);
  }

  updateAlert() {
    const p = this.player;
    if (p.disguised) this.alert = Math.max(0, this.alert - 1);
    else if (this.frame - this.lastSeen > 150) this.alert = Math.max(0, this.alert - 0.3);

    // A gunship joins the hunt when the military is on high alert.
    const hasHeli = this.enemies.some((e) => e.type === 'heli' && !e.dead);
    if (this.alert >= 60 && !hasHeli && !p.disguised && this.level.districts[this.district].gunship && !this.arenaLocked) {
      const heli = createEnemy('heli', p.x + 40, p.y + 25, p.z);
      heli.shootT = 90;
      this.enemies.push(heli);
      this.sfx('heli');
      this.popup(p.x, p.y + 3, p.z, 'GUNSHIP INBOUND', PAL.yellow);
    }
  }

  // ---------------------------------------------------------------- combat

  /** Turns the player toward the most sensible target in reach, so attacks don't whiff. */
  autoAim(p, range) {
    let best = null;
    let bestScore = Infinity;
    for (const e of this.enemies) {
      if (e.dead || e.grabbed || e.type === 'heli') continue;
      const d = distXZ(p, e) - e.r;
      if (d > range || Math.abs(e.y - p.y) > 2.5) continue;
      const off = Math.abs(angleDiff(p.yaw, yawTo(p, e)));
      if (off > 1.4 && d > 1.5) continue;
      const score = d + off * 2;
      if (score < bestScore) {
        best = e;
        bestScore = score;
      }
    }
    if (best) p.yaw = yawTo(p, best);
  }

  /** `from` is whatever hit the player (anything with x and z); knock is in m/s. */
  damagePlayer(dmg, from, knock = 6) {
    const p = this.player;
    if (!p.alive || p.invuln > 0 || p.dev > 0 || this.mode !== 'play') return false;
    const taken = p.armor ? dmg * 0.4 : dmg;
    p.hp -= taken;
    p.invuln = 50;
    p.hurt = 14;
    p.sinceHit = 0;
    p.attack = null;
    p.slam = false;
    p.wallRun = null;
    if (p.consume) {
      p.consume.target.grabbed = false;
      p.consume = null;
    }
    const away = Math.atan2(p.z - from.z, p.x - from.x);
    const k = knock * (p.armor ? 0.5 : 1);
    p.vx = Math.cos(away) * k;
    p.vz = Math.sin(away) * k;
    p.vy = 6;
    this.shake(6);
    this.sfx('hurt');
    this.addParticles(p.x, p.y + 1.1, p.z, 8, [PAL.viral, PAL.redL, PAL.ink]);
    if (p.hp <= 0) this.killPlayer();
    return true;
  }

  killPlayer() {
    const p = this.player;
    p.hp = 0;
    p.alive = false;
    this.mode = 'dead';
    this.modeT = 0;
    this.addParticles(p.x, p.y + 1, p.z, 40, [PAL.viral, PAL.viralL, PAL.ink, PAL.redD], { speed: 6 });
    this.sfx('death');
    this.emit('death');
  }

  /** dir is the knockback direction ({ x, z }, unit length); lift is upward speed. */
  damageEnemy(e, dmg, dir, lift, source, kb = 6) {
    if (e.dead) return;
    const p = this.player;
    if (ENEMY_TYPES[e.type].armored && source === 'player') {
      dmg *= ARMOR_FACTOR;
      if (this.frame - this.armorHintT > 240) {
        this.armorHintT = this.frame;
        this.popup(e.x, e.y + e.h + 0.6, e.z, 'ARMORED - USE THE BLADE (5)', PAL.grayL);
      }
    }
    if (BY_PLAYER.has(source) && e.type === 'soldier') {
      if (p.disguised) this.blowDisguise();
      this.alert = Math.max(this.alert, 70);
      this.lastSeen = this.frame;
    }
    e.hp -= dmg;
    e.flash = 6;
    if (e.type !== 'heli' && !isBoss(e) && e.state !== 'stunned') {
      e.vx = dir.x * kb;
      e.vz = dir.z * kb;
      e.vy = Math.max(e.vy, lift);
      e.stagger = 10;
      if (e.state === 'windup' || e.state === 'lunge') e.state = 'chase';
    }
    const colors = e.type === 'soldier' ? [PAL.redD, PAL.olive, PAL.red] : [PAL.viral, PAL.greenL, PAL.zombieD];
    this.addParticles(e.x, e.y + e.h * 0.6, e.z, 5, colors);
    if (source === 'player' || source === 'blade') p.mass = Math.min(MASS_MAX, p.mass + 2);

    if (e.hp <= 0) {
      if (isBoss(e)) e.hp = 0;
      this.killEnemy(e, source);
      return;
    }
    // Big creatures stagger at health thresholds, which lets you consume them.
    const pct = e.hp / e.maxHp;
    if (e.type === 'hunter' && pct <= 0.2 && !e.stunnedOnce[20]) {
      e.stunnedOnce[20] = true;
      e.state = 'stunned';
      e.t = 150;
      this.popup(e.x, e.y + e.h + 0.5, e.z, 'CONSUME IT!', PAL.yellow);
    }
    if (isBoss(e)) {
      for (const mark of [66, 33]) {
        if (pct * 100 <= mark && !e.stunnedOnce[mark]) {
          e.stunnedOnce[mark] = true;
          e.state = 'stunned';
          e.t = 150;
          e.vx = e.vz = 0;
          this.shake(8);
          this.sfx('roar');
          this.popup(e.x, e.y + e.h + 0.8, e.z, 'STUNNED - CONSUME!', PAL.yellow);
        }
      }
    }
  }

  killEnemy(e, source) {
    e.dead = true;
    const def = ENEMY_TYPES[e.type];
    if (BY_PLAYER.has(source)) {
      this.score += def.score;
      this.kills++;
      // Devastator kills don't refill the meter, so it can't be chained.
      if (source !== 'devastator') this.player.mass = Math.min(MASS_MAX, this.player.mass + 5);
      this.popup(e.x, e.y + e.h, e.z, `+${def.score}`, PAL.white);
    }
    if (e.type === 'heli' || isBoss(e)) {
      this.explode(e.x, e.y + e.h / 2, e.z, 0, 0);
      this.shake(16);
    } else {
      const colors = e.type === 'soldier' ? [PAL.redD, PAL.olive, PAL.oliveD, PAL.red] : [PAL.viral, PAL.zombie, PAL.zombieD, PAL.greenL];
      this.addParticles(e.x, e.y + e.h / 2, e.z, 16, colors, { speed: 5 });
      this.sfx('kill');
    }
    if (e === this.boss) {
      this.bossDownT = 180;
      this.bossesDefeated.add(this.level.arenas.indexOf(this.arena));
      this.projectiles = this.projectiles.filter((pr) => pr.owner === 'player');
      this.flash = 20;
      this.sfx('bossDeath');
      this.emit('bossDefeated');
    }
  }

  resolvePlayerAttacks() {
    const p = this.player;
    const seg = attackSegment(p);
    if (!seg) return;
    const source = p.attack.power === 'blade' ? 'blade' : 'player';
    const dir = dirOf(p.yaw);
    let landed = false;
    for (const e of this.enemies) {
      if (e.dead || e.grabbed || p.attack.hits.has(e.id)) continue;
      // Test against the enemy's centre line at the attack's height.
      const target = { x: e.x, y: Math.min(e.y + e.h, Math.max(e.y, seg.a.y)), z: e.z };
      if (pointSegmentDistance(target, seg.a, seg.b) > seg.radius + e.r) continue;
      p.attack.hits.add(e.id);
      const dmg = seg.def.dmg * (p.armor ? 1.25 : 1);
      this.damageEnemy(e, dmg, dir, seg.def.lift, source, seg.def.kb);
      landed = true;
    }
    if (seg.def.cuts) this.cutProjectiles(seg);
    if (landed) {
      this.hitstop = 3;
      this.sfx('hit');
    }
  }

  /** Blade slashes cut bullets, rockets, acid and rubble out of the air. */
  cutProjectiles(seg) {
    let cut = false;
    for (const pr of this.projectiles) {
      if (pr.life <= 0 || pr.owner === 'player' || !CUTTABLE.has(pr.kind)) continue;
      if (pointSegmentDistance(pr, seg.a, seg.b) > seg.radius + pr.r + 0.4) continue;
      pr.life = 0;
      cut = true;
      if (pr.kind === 'rocket') this.explode(pr.x, pr.y, pr.z, 0, 0);
      else this.addParticles(pr.x, pr.y, pr.z, 8, pr.kind === 'acid' ? [PAL.greenL, PAL.green, PAL.white] : [PAL.white, PAL.yellowL, PAL.grayL], { speed: 4 });
    }
    if (cut) this.sfx('clang');
  }

  tryConsume() {
    const p = this.player;
    if (p.attack || p.consume || p.dev) return;
    let best = null;
    let bestScore = Infinity;
    for (const e of this.enemies) {
      if (!isConsumable(e) || e.grabbed) continue;
      const d = distXZ(p, e) - e.r - p.r;
      if (d > 1.4 || Math.abs(e.y - p.y) > 1.6) continue;
      const score = d + Math.abs(angleDiff(p.yaw, yawTo(p, e)));
      if (score < bestScore) {
        best = e;
        bestScore = score;
      }
    }
    if (!best) return;
    p.consume = { target: best, t: 0 };
    p.yaw = yawTo(p, best);
    p.attack = null;
    p.invuln = Math.max(p.invuln, 26);
    best.grabbed = true;
    this.sfx('grab');
  }

  finishConsume() {
    const p = this.player;
    const e = p.consume?.target;
    p.consume = null;
    if (!e || e.dead) return;
    e.grabbed = false;
    const def = ENEMY_TYPES[e.type];
    p.hp = Math.min(PLAYER_MAX_HP, p.hp + def.heal);
    p.mass = Math.min(MASS_MAX, p.mass + def.mass);
    this.consumes++;
    this.sfx('consume');
    this.addParticles(e.x, e.y + e.h / 2, e.z, 24, [PAL.viral, PAL.redD, PAL.ink, PAL.viralL], { speed: 3, toward: p });
    this.popup(p.x, p.y + 2, p.z, `+${def.heal} HP`, PAL.greenL);

    if (isBoss(e)) {
      // A boss can't be swallowed whole: consuming it while stunned tears out a chunk.
      e.state = 'stalk';
      e.cooldown = 60;
      this.damageEnemy(e, 25, dirOf(p.yaw), 0, 'consume');
      return;
    }

    this.score += 50;
    this.killEnemy(e, 'consume');

    if (e.type === 'soldier') {
      const witnesses = this.soldiersNear(WITNESS_RANGE, e).filter((s) => canSee(this.level, s, p, WITNESS_RANGE));
      if (witnesses.length === 0) {
        if (!p.disguised) {
          p.disguised = true;
          this.sfx('disguise');
          this.popup(p.x, p.y + 2.6, p.z, 'DISGUISED', PAL.greenL);
        }
        this.alert = 0;
      } else if (p.disguised) {
        this.blowDisguise();
      } else {
        this.alert = 100;
        this.lastSeen = this.frame;
        this.sfx('alert');
        this.popup(p.x, p.y + 2.6, p.z, 'SPOTTED!', PAL.redL);
      }
    }
  }

  devastatorBurst() {
    const p = this.player;
    this.flash = 14;
    this.shake(22);
    this.sfx('devastator');
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - p.x, e.y + e.h / 2 - (p.y + 1), e.z - p.z);
      if (d > 14) continue;
      const dir = { x: (e.x - p.x) / (d || 1), z: (e.z - p.z) / (d || 1) };
      this.damageEnemy(e, isBoss(e) ? 30 : 14, dir, 8, 'devastator', 12);
    }
    this.projectiles = this.projectiles.filter((pr) => pr.owner === 'player');
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const up = ((i % 5) - 2) * 2;
      this.particles.push({ x: p.x, y: p.y + 1, z: p.z, vx: Math.cos(a) * 14, vy: up, vz: Math.sin(a) * 14, life: 30, color: i % 2 ? PAL.viral : PAL.ink, size: 0.3, gravity: 0 });
    }
  }

  slamLanded() {
    const p = this.player;
    this.shake(8);
    this.sfx('slam');
    for (const e of this.enemies) {
      if (e.dead || e.type === 'heli') continue;
      const d = distXZ(e, p);
      if (d < 5.5 && Math.abs(e.y - p.y) < 2.5) this.damageEnemy(e, 4, { x: (e.x - p.x) / (d || 1), z: (e.z - p.z) / (d || 1) }, 8, 'player', 9);
    }
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      this.particles.push({ x: p.x, y: p.y + 0.1, z: p.z, vx: Math.cos(a) * 6, vy: 4 + Math.random() * 3, vz: Math.sin(a) * 6, life: 24, color: i % 2 ? PAL.concrete : PAL.viral, size: 0.2, gravity: 20 });
    }
  }

  summonInfected(count) {
    const a = this.arena;
    for (let i = 0; i < count; i++) {
      const x = a.x0 + 6 + Math.random() * (a.x1 - a.x0 - 14);
      const z = (i % 2 ? 1 : -1) * (18 + Math.random() * 6);
      this.enemies.push(createEnemy('infected', x, 0, z));
    }
  }

  // ---------------------------------------------------------------- projectiles

  spawnProjectile(pr) {
    this.projectiles.push(pr);
  }

  /** Is a point inside any solid box (or below the street)? */
  solidAt(x, y, z) {
    if (y < 0) return true;
    for (const b of boxesNear(this.level, x, x)) {
      if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1) return true;
    }
    return false;
  }

  explode(x, y, z, radius, dmg) {
    this.sfx('boom');
    this.shake(10);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 6;
      const s = 2 + Math.random() * 5;
      this.particles.push({ x, y, z, vx: Math.cos(a) * s, vy: up, vz: Math.sin(a) * s, life: 20 + Math.random() * 20, color: [PAL.yellow, PAL.orange, PAL.red, PAL.grayD][i % 4], size: 0.25 + (i % 3) * 0.15, gravity: 6 });
    }
    if (!dmg) return;
    const p = this.player;
    const c = chest(p);
    if (Math.hypot(c.x - x, c.y - y, c.z - z) < radius) this.damagePlayer(dmg, { x, z }, 8);
    for (const e of this.enemies) {
      if (e.dead || e.type === 'heli') continue;
      const d = Math.hypot(e.x - x, e.y + e.h / 2 - y, e.z - z);
      if (d < radius) this.damageEnemy(e, 3, { x: (e.x - x) / (d || 1), z: (e.z - z) / (d || 1) }, 6, 'rocket');
    }
  }

  /** Acid or rubble breaking up where it lands; rubble also hurts anyone standing close. */
  splash(pr, colors, radius = 0) {
    this.addParticles(pr.x, pr.y, pr.z, 10, colors, { speed: 4 });
    if (!radius) return;
    this.shake(4);
    this.sfx('thud');
    const p = this.player;
    if (p.alive && distXZ(p, pr) < radius && Math.abs(p.y - pr.y) < 1.5) this.damagePlayer(pr.dmg, pr, 6);
  }

  updateProjectiles() {
    const p = this.player;
    const pc = chest(p);
    const hitsPlayer = (pr, extra = 0.4) => p.alive && Math.hypot(pc.x - pr.x, (pc.y - pr.y) * 0.6, pc.z - pr.z) < pr.r + extra;
    for (const pr of this.projectiles) {
      pr.life--;
      if (pr.kind === 'ring') {
        // A shockwave spreading along the ground: jump over it.
        pr.radius += pr.speed * dt;
        if (!pr.hit && p.alive && p.y - pr.y < 0.6 && Math.abs(distXZ(p, pr) - pr.radius) < 0.8) {
          pr.hit = true;
          this.damagePlayer(pr.dmg, pr, 8);
        }
        continue;
      }
      if (pr.kind === 'spike') {
        // Marked on the ground first, then erupts for a moment.
        if (++pr.t === pr.warn) {
          this.sfx('spike');
          this.addParticles(pr.x, pr.y + 0.2, pr.z, 6, [PAL.concrete, PAL.viral], { speed: 4 });
        }
        if (pr.t >= pr.warn && !pr.hit && p.alive && distXZ(p, pr) < pr.r + p.r && p.y - pr.y < 2.6) {
          pr.hit = true;
          this.damagePlayer(pr.dmg, pr, 3);
          p.vy = 12;
        }
        continue;
      }
      if (pr.kind === 'rocket' && p.alive) {
        // Gentle homing
        const d = Math.hypot(pc.x - pr.x, pc.y - pr.y, pc.z - pr.z) || 1;
        const speed = Math.hypot(pr.vx, pr.vy, pr.vz);
        pr.vx += ((pc.x - pr.x) / d) * 0.6;
        pr.vy += ((pc.y - pr.y) / d) * 0.6;
        pr.vz += ((pc.z - pr.z) / d) * 0.6;
        const s = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
        pr.vx = (pr.vx / s) * speed;
        pr.vy = (pr.vy / s) * speed;
        pr.vz = (pr.vz / s) * speed;
        if (this.frame % 3 === 0) this.particles.push({ x: pr.x, y: pr.y, z: pr.z, vx: 0, vy: 0.3, vz: 0, life: 18, color: PAL.grayL, size: 0.3, gravity: -0.5 });
      }
      if (pr.gravity) pr.vy -= pr.gravity * dt;
      if (pr.kind === 'rock') pr.vy = Math.max(pr.vy - 20 * dt, -28);
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.z += pr.vz * dt;

      if (this.solidAt(pr.x, pr.y, pr.z)) {
        pr.life = 0;
        if (pr.kind === 'rocket') this.explode(pr.x, pr.y, pr.z, 3.5, pr.dmg);
        else if (pr.kind === 'acid') this.splash({ ...pr, y: Math.max(0, pr.y) }, [PAL.greenL, PAL.green, PAL.oliveL]);
        else if (pr.kind === 'rock') this.splash({ ...pr, y: groundHeight(this.level, pr.x, pr.z) }, [PAL.concrete, PAL.concreteD, PAL.grayL], 1.8);
        else this.addParticles(pr.x, pr.y, pr.z, 3, [PAL.yellow, PAL.grayL]);
        continue;
      }

      if (pr.kind === 'bullet') {
        if (this.soldiersHostile() && hitsPlayer(pr)) {
          pr.life = 0;
          this.damagePlayer(pr.dmg, { x: pr.x - pr.vx, z: pr.z - pr.vz }, 3);
          continue;
        }
        for (const e of this.enemies) {
          if (e.dead || e.type === 'soldier' || e.type === 'heli') continue;
          if (distXZ(e, pr) > e.r + 0.2 || pr.y < e.y || pr.y > e.y + e.h) continue;
          pr.life = 0;
          this.damageEnemy(e, 1, { x: Math.sign(pr.vx) || 1, z: 0 }, 1, 'soldier', 2);
          break;
        }
      } else if (pr.kind === 'rocket') {
        if (hitsPlayer(pr) || pr.life <= 0) {
          pr.life = 0;
          this.explode(pr.x, pr.y, pr.z, 3.5, pr.dmg);
        }
      } else if (pr.kind === 'acid' || pr.kind === 'rock') {
        if (hitsPlayer(pr, 0.6)) {
          pr.life = 0;
          this.damagePlayer(pr.dmg, { x: pr.x - pr.vx, z: pr.z - pr.vz }, 5);
          this.splash(pr, pr.kind === 'acid' ? [PAL.greenL, PAL.green] : [PAL.concrete, PAL.grayL]);
        }
      }
    }
    this.projectiles = this.projectiles.filter((pr) => pr.life > 0);
  }

  // ---------------------------------------------------------------- world flow

  updateCheckpoints() {
    const p = this.player;
    const d = districtAt(this.level, p.x);
    if (d !== this.district) {
      this.district = d;
      this.emit('district', this.level.districts[d]);
    }
    const cps = this.level.checkpoints;
    if (this.checkpoint + 1 < cps.length && p.x >= cps[this.checkpoint + 1].x) {
      this.checkpoint++;
      this.banner = { text: this.level.districts[this.checkpoint].name, t: 150 };
      this.sfx('checkpoint');
      this.popup(p.x, p.y + 2.4, p.z, 'CHECKPOINT', PAL.blueL);
    }
    if (this.banner.t > 0) this.banner.t--;
  }

  updateArena() {
    if (this.arenaLocked) return;
    const p = this.player;
    const index = this.level.arenas.findIndex((a, i) => !this.bossesDefeated.has(i) && p.x >= a.x0 + 8 && p.x < a.x1);
    if (index === -1) return;
    const a = this.level.arenas[index];
    this.arena = a;
    this.arenaLocked = true;
    this.enemies = this.enemies.filter((e) => e.x > a.x0);
    this.projectiles = [];
    this.alert = 0;
    this.boss = createEnemy(a.boss, a.x0 + (a.x1 - a.x0) * 0.62, 0, 0);
    this.boss.yaw = Math.PI;
    this.enemies.push(this.boss);
    this.emit('boss', this.boss);
  }

  // ---------------------------------------------------------------- effects

  addParticles(x, y, z, n, colors, { speed = 3, toward = null } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * speed + 0.5;
      this.particles.push({
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: Math.random() * speed + 1,
        vz: Math.sin(a) * s,
        life: 18 + Math.random() * 18,
        color: colors[i % colors.length],
        size: 0.12 + (i % 2) * 0.08,
        gravity: toward ? 0 : 14,
        toward,
      });
    }
  }

  popup(x, y, z, text, color) {
    this.popups.push({ x, y, z, text, color, t: 60 });
  }

  updateParticles() {
    for (const pt of this.particles) {
      if (pt.toward) {
        const t = pt.toward;
        pt.vx += (t.x - pt.x) * 0.6;
        pt.vy += (t.y + 1 - pt.y) * 0.6;
        pt.vz += (t.z - pt.z) * 0.6;
        pt.vx *= 0.85;
        pt.vy *= 0.85;
        pt.vz *= 0.85;
      }
      pt.vy -= pt.gravity * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.z += pt.vz * dt;
      pt.life--;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
    for (const pop of this.popups) {
      pop.t--;
      pop.y += 0.02;
    }
    this.popups = this.popups.filter((pop) => pop.t > 0);
  }

  get bossActive() {
    return this.boss && !this.boss.dead && this.arenaLocked;
  }
}

