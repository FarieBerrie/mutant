import { MASS_MAX, PAL, PLAYER_MAX_HP, TILE, VIEW_H, VIEW_W } from './config.js';
import { canSee, createEnemy, ENEMY_TYPES, isBoss, isConsumable, updateEnemy } from './enemies.js';
import { buildLevel, districtAt, isSolid, openArena, surfaceRow, tileAt } from './level.js';
import { centerX, centerY, overlaps } from './physics.js';
import { attackBox, createPlayer, updatePlayer } from './player.js';

const WITNESS_RANGE = 150;
// Damage sources that count as the player's doing (score, alerting soldiers).
const BY_PLAYER = new Set(['player', 'blade', 'consume', 'devastator']);
// Armoured enemies take this share of damage from everything but the blade.
const ARMOR_FACTOR = 0.4;
// Projectiles a blade slash can cut out of the air.
const CUTTABLE = new Set(['bullet', 'rocket', 'acid', 'rock']);
const TIME_BONUS = 40000;

/**
 * One play-through: the city, the player, everyone in it, and the rules that connect them.
 * Rendering and audio live elsewhere; `audio` only needs an optional sfx(name) method.
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
    this.listeners = new Set();
    this.bossesDefeated = new Set(); // arena indexes; survives respawns
    this.reset();
  }

  /** (Re)start from the current checkpoint. */
  reset() {
    const cpX = this.level.checkpoints[this.checkpoint];
    const col = Math.floor(cpX / TILE);
    const keepMass = this.player ? Math.floor(this.player.mass / 2) : 0;
    this.player = createPlayer(cpX, surfaceRow(this.level, col) * TILE);
    this.player.mass = keepMass;
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
    this.camera = { x: Math.max(0, cpX - VIEW_W / 3), y: 0 };
    this.spawnCursor = this.level.spawns.findIndex((s) => s.x > cpX + 40);
    if (this.spawnCursor === -1) this.spawnCursor = this.level.spawns.length;
    this.district = districtAt(this.level, cpX);
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
    if (this.arenaLocked && p.x < this.arena.x0 + 4) {
      p.x = this.arena.x0 + 4;
      p.vx = Math.max(p.vx, 0);
    }

    this.activateSpawns();
    this.spawnAmbient();
    this.updateAlert();

    for (const e of this.enemies) if (!e.dead) updateEnemy(e, this);
    this.resolvePlayerAttacks();
    this.updateProjectiles();

    // Remove the dead (the boss lingers for its death sequence).
    this.enemies = this.enemies.filter((e) => !e.dead || (e === this.boss && this.bossDownT > 0));
    // Enemies far behind the camera are dropped to keep things fast.
    this.enemies = this.enemies.filter((e) => isBoss(e) || e.type === 'heli' || e.x > this.camera.x - VIEW_W * 1.5);

    this.updateCheckpoints();
    this.updateArena();
    this.updateParticles();
    this.updateCamera();

    // A boss goes down in a chain of explosions. The last one wins the game; the others
    // open their arena's far wall.
    if (this.bossDownT > 0 && this.boss && this.bossDownT % 12 === 0) {
      const b = this.boss;
      this.explode(b.x + Math.random() * b.w, b.y + Math.random() * b.h, 0, 0);
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
    this.popup(centerX(p), p.y - 14, 'THE WAY IS OPEN', PAL.yellow);
    this.emit('arenaCleared');
  }

  activateSpawns() {
    const spawns = this.level.spawns;
    while (this.spawnCursor < spawns.length && spawns[this.spawnCursor].x < this.camera.x + VIEW_W + 48) {
      const s = spawns[this.spawnCursor++];
      if (this.level.arenas.some((a) => s.x >= a.x0 && s.x < a.x1)) continue;
      this.enemies.push(createEnemy(s.type, s.x, s.y));
    }
  }

  spawnAmbient() {
    const d = this.level.districts[this.district];
    if (!d.ambient || this.arenaLocked) return;
    if (++this.ambientT < 140) return;
    this.ambientT = 0;
    const onScreen = this.enemies.filter((e) => e.type === 'infected' && e.x > this.camera.x - 40 && e.x < this.camera.x + VIEW_W + 40).length;
    if (onScreen >= d.ambient) return;
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side < 0 ? this.camera.x - 12 : this.camera.x + VIEW_W + 12;
    const col = Math.floor(x / TILE);
    if (col < 1 || col >= this.level.cols - 1) return;
    const e = createEnemy('infected', x, surfaceRow(this.level, col) * TILE);
    e.facing = -side;
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
    return this.enemies.filter((e) => e.type === 'soldier' && !e.dead && e !== except && !e.grabbed && Math.abs(centerX(e) - centerX(p)) < range && Math.abs(centerY(e) - centerY(p)) < 64);
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
    this.popup(centerX(p), p.y - 6, 'DISGUISE BLOWN', PAL.redL);
  }

  updateAlert() {
    const p = this.player;
    if (p.disguised) this.alert = Math.max(0, this.alert - 1);
    else if (this.frame - this.lastSeen > 150) this.alert = Math.max(0, this.alert - 0.3);

    // A gunship joins the hunt when the military is on high alert.
    const hasHeli = this.enemies.some((e) => e.type === 'heli' && !e.dead);
    if (this.alert >= 60 && !hasHeli && !p.disguised && this.level.districts[this.district].gunship && !this.arenaLocked) {
      const heli = createEnemy('heli', this.camera.x + VIEW_W + 40, this.camera.y + 10);
      heli.shootT = 90;
      this.enemies.push(heli);
      this.sfx('heli');
      this.popup(this.camera.x + VIEW_W / 2, this.camera.y + 60, 'GUNSHIP INBOUND', PAL.yellow, true);
    }
  }

  // ---------------------------------------------------------------- combat

  damagePlayer(dmg, fromX, knock = 3) {
    const p = this.player;
    if (!p.alive || p.invuln > 0 || p.dev > 0 || this.mode !== 'play') return false;
    const taken = p.armor ? dmg * 0.4 : dmg;
    p.hp -= taken;
    p.invuln = 50;
    p.hurt = 14;
    p.sinceHit = 0;
    p.attack = null;
    p.slam = false;
    if (p.consume) {
      p.consume.target.grabbed = false;
      p.consume = null;
    }
    const dir = centerX(p) >= fromX ? 1 : -1;
    p.vx = dir * knock * (p.armor ? 0.5 : 1);
    p.vy = -3;
    this.shake(6);
    this.sfx('hurt');
    this.addParticles(centerX(p), centerY(p), 8, [PAL.viral, PAL.redL, PAL.ink]);
    if (p.hp <= 0) this.killPlayer();
    return true;
  }

  killPlayer() {
    const p = this.player;
    p.hp = 0;
    p.alive = false;
    this.mode = 'dead';
    this.modeT = 0;
    this.addParticles(centerX(p), centerY(p), 40, [PAL.viral, PAL.viralL, PAL.ink, PAL.redD], { speed: 3 });
    this.sfx('death');
    this.emit('death');
  }

  damageEnemy(e, dmg, kx, ky, source) {
    if (e.dead) return;
    const p = this.player;
    if (ENEMY_TYPES[e.type].armored && source === 'player') {
      dmg *= ARMOR_FACTOR;
      if (this.frame - this.armorHintT > 240) {
        this.armorHintT = this.frame;
        this.popup(centerX(e), e.y - 8, 'ARMORED - USE THE BLADE (5)', PAL.grayL);
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
      e.vx = kx;
      e.vy = Math.min(e.vy, ky);
      e.stagger = 10;
      if (e.state === 'windup' || e.state === 'lunge') e.state = 'chase';
    }
    const colors = e.type === 'soldier' ? [PAL.redD, PAL.olive, PAL.red] : [PAL.viral, PAL.greenL, PAL.zombieD];
    this.addParticles(centerX(e), centerY(e), 5, colors);
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
      this.popup(centerX(e), e.y - 4, 'CONSUME IT!', PAL.yellow);
    }
    if (isBoss(e)) {
      for (const mark of [66, 33]) {
        if (pct * 100 <= mark && !e.stunnedOnce[mark]) {
          e.stunnedOnce[mark] = true;
          e.state = 'stunned';
          e.t = 150;
          e.vx = 0;
          this.shake(8);
          this.sfx('roar');
          this.popup(centerX(e), e.y - 6, 'STUNNED - CONSUME!', PAL.yellow);
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
      this.popup(centerX(e), e.y, `+${def.score}`, PAL.white);
    }
    if (e.type === 'heli' || isBoss(e)) {
      this.explode(centerX(e), centerY(e), 34, 0);
      this.shake(16);
    } else {
      const colors = e.type === 'soldier' ? [PAL.redD, PAL.olive, PAL.oliveD, PAL.red] : [PAL.viral, PAL.zombie, PAL.zombieD, PAL.greenL];
      this.addParticles(centerX(e), centerY(e), 16, colors, { speed: 2.5 });
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
    const box = attackBox(p);
    if (!box) return;
    const source = p.attack.power === 'blade' ? 'blade' : 'player';
    let landed = false;
    for (const e of this.enemies) {
      if (e.dead || e.grabbed || p.attack.hits.has(e.id) || !overlaps(box, e)) continue;
      p.attack.hits.add(e.id);
      const dmg = box.def.dmg * (p.armor ? 1.25 : 1);
      this.damageEnemy(e, dmg, p.facing * box.def.kb, box.def.lift ?? -1.5, source);
      landed = true;
    }
    if (box.def.cuts) this.cutProjectiles(box);
    if (landed) {
      this.hitstop = 3;
      this.sfx('hit');
    }
  }

  /** Blade slashes cut bullets, rockets, acid and rubble out of the air. */
  cutProjectiles(box) {
    let cut = false;
    for (const pr of this.projectiles) {
      if (pr.life <= 0 || pr.owner === 'player' || !CUTTABLE.has(pr.kind) || !overlaps(box, pr)) continue;
      pr.life = 0;
      cut = true;
      const x = pr.x + pr.w / 2;
      const y = pr.y + pr.h / 2;
      if (pr.kind === 'rocket') this.explode(x, y, 0, 0);
      else this.addParticles(x, y, 8, pr.kind === 'acid' ? [PAL.greenL, PAL.green, PAL.white] : [PAL.white, PAL.yellowL, PAL.grayL], { speed: 2.2 });
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
      const dx = centerX(e) - centerX(p);
      const reach = e.w / 2 + p.w / 2 + 12;
      if (Math.abs(dx) > reach || Math.abs(e.y + e.h - (p.y + p.h)) > 22) continue;
      const score = Math.abs(dx) + (Math.sign(dx) === p.facing ? 0 : 8);
      if (score < bestScore) {
        best = e;
        bestScore = score;
      }
    }
    if (!best) return;
    p.consume = { target: best, t: 0 };
    p.facing = centerX(best) >= centerX(p) ? 1 : -1;
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
    this.addParticles(centerX(e), centerY(e), 24, [PAL.viral, PAL.redD, PAL.ink, PAL.viralL], { speed: 1.8, toward: p });
    this.popup(centerX(p), p.y - 4, `+${def.heal} HP`, PAL.greenL);

    if (isBoss(e)) {
      // A boss can't be swallowed whole: consuming it while stunned tears out a chunk.
      e.state = 'stalk';
      e.cooldown = 60;
      this.damageEnemy(e, 25, 0, 0, 'consume');
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
          this.popup(centerX(p), p.y - 14, 'DISGUISED', PAL.greenL);
        }
        this.alert = 0;
      } else if (p.disguised) {
        this.blowDisguise();
      } else {
        this.alert = 100;
        this.lastSeen = this.frame;
        this.sfx('alert');
        this.popup(centerX(p), p.y - 14, 'SPOTTED!', PAL.redL);
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
      const dx = centerX(e) - centerX(p);
      const dy = centerY(e) - centerY(p);
      if (Math.hypot(dx, dy) > 140) continue;
      this.damageEnemy(e, isBoss(e) ? 30 : 14, Math.sign(dx || 1) * 5, -4, 'devastator');
    }
    this.projectiles = this.projectiles.filter((pr) => pr.owner === 'player');
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      this.particles.push({ x: centerX(p), y: centerY(p), vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, life: 30, color: i % 2 ? PAL.viral : PAL.ink, size: 3, gravity: 0 });
    }
  }

  slamLanded() {
    const p = this.player;
    this.shake(8);
    this.sfx('slam');
    for (const e of this.enemies) {
      if (e.dead || e.type === 'heli') continue;
      const dx = centerX(e) - centerX(p);
      if (Math.abs(dx) < 56 && Math.abs(e.y + e.h - (p.y + p.h)) < 30) this.damageEnemy(e, 4, Math.sign(dx || 1) * 3.5, -4, 'player');
    }
    for (let i = 0; i < 16; i++) {
      this.particles.push({ x: centerX(p), y: p.y + p.h, vx: (i - 8) * 0.5, vy: -2 - Math.random() * 2, life: 24, color: i % 2 ? PAL.concrete : PAL.viral, size: 2, gravity: 0.2 });
    }
  }

  summonInfected(count) {
    const a = this.arena;
    for (let i = 0; i < count; i++) {
      const x = i % 2 ? this.camera.x + 10 : this.camera.x + VIEW_W - 10;
      const col = Math.floor(Math.max(a.x0 + 8, Math.min(a.x1 - 40, x)) / TILE);
      this.enemies.push(createEnemy('infected', col * TILE + 8, surfaceRow(this.level, col) * TILE));
    }
  }

  // ---------------------------------------------------------------- projectiles

  spawnProjectile(pr) {
    this.projectiles.push(pr);
  }

  explode(x, y, radius, dmg) {
    this.sfx('boom');
    this.shake(10);
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.5 + Math.random() * 2.5;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 20 + Math.random() * 20, color: [PAL.yellow, PAL.orange, PAL.red, PAL.grayD][i % 4], size: 2 + (i % 3), gravity: 0.05 });
    }
    if (!dmg) return;
    const p = this.player;
    if (Math.hypot(centerX(p) - x, centerY(p) - y) < radius) this.damagePlayer(dmg, x, 4);
    for (const e of this.enemies) {
      if (e.dead || e.type === 'heli') continue;
      if (Math.hypot(centerX(e) - x, centerY(e) - y) < radius) this.damageEnemy(e, 3, Math.sign(centerX(e) - x) * 3, -3, 'rocket');
    }
  }

  updateProjectiles() {
    const p = this.player;
    for (const pr of this.projectiles) {
      pr.life--;
      if (pr.kind === 'rocket' && p.alive) {
        // Gentle homing
        const ang = Math.atan2(centerY(p) - pr.y, centerX(p) - pr.x);
        pr.vx += Math.cos(ang) * 0.04;
        pr.vy += Math.sin(ang) * 0.04;
        const sp = Math.hypot(pr.vx, pr.vy);
        pr.vx = (pr.vx / sp) * 2.4;
        pr.vy = (pr.vy / sp) * 2.4;
        if (this.frame % 3 === 0) this.particles.push({ x: pr.x, y: pr.y, vx: 0, vy: 0, life: 14, color: PAL.grayL, size: 2, gravity: -0.02 });
      }
      if (pr.gravity) pr.vy += pr.gravity;
      if (pr.kind === 'rock') pr.vy = Math.min(pr.vy + 0.22, 7);
      pr.x += pr.vx;
      pr.y += pr.vy;

      if (pr.kind === 'spike') {
        // Marked on the ground first, then erupts for a moment.
        if (++pr.t === pr.warn) {
          this.sfx('spike');
          this.addParticles(pr.x + pr.w / 2, pr.y + pr.h, 6, [PAL.concrete, PAL.viral], { speed: 2 });
        }
        if (pr.t >= pr.warn && !pr.hit && p.alive && overlaps(pr, p)) {
          pr.hit = true;
          this.damagePlayer(pr.dmg, pr.x + pr.w / 2, 3);
          p.vy = -5;
        }
        continue;
      }

      const tile = tileAt(this.level, Math.floor((pr.x + pr.w / 2) / TILE), Math.floor((pr.y + pr.h / 2) / TILE));
      if (isSolid(tile) && pr.kind !== 'wave') {
        pr.life = 0;
        if (pr.kind === 'rocket') this.explode(pr.x, pr.y, 26, pr.dmg);
        else if (pr.kind === 'acid') this.splash(pr, [PAL.greenL, PAL.green, PAL.oliveL]);
        else if (pr.kind === 'rock') this.splash(pr, [PAL.concrete, PAL.concreteD, PAL.grayL], 4);
        else this.addParticles(pr.x, pr.y, 3, [PAL.yellow, PAL.grayL]);
        continue;
      }
      if (pr.kind === 'wave' && isSolid(tileAt(this.level, Math.floor((pr.x + (pr.vx > 0 ? pr.w : 0)) / TILE), Math.floor((pr.y + 4) / TILE)))) {
        pr.life = 0;
        continue;
      }

      const box = { x: pr.x, y: pr.y, w: pr.w, h: pr.h };
      if (pr.kind === 'bullet') {
        if (this.soldiersHostile() && p.alive && overlaps(box, p)) {
          pr.life = 0;
          this.damagePlayer(pr.dmg, pr.x, 2);
          continue;
        }
        for (const e of this.enemies) {
          if (e.dead || e.type === 'soldier' || e.type === 'heli' || !overlaps(box, e)) continue;
          pr.life = 0;
          this.damageEnemy(e, 1, Math.sign(pr.vx) * 1.2, -1, 'soldier');
          break;
        }
      } else if (pr.kind === 'rocket') {
        if (p.alive && overlaps(box, p)) {
          pr.life = 0;
          this.explode(pr.x, pr.y, 26, pr.dmg);
        } else if (pr.life <= 0) {
          this.explode(pr.x, pr.y, 26, pr.dmg);
        }
      } else if (pr.kind === 'acid' || pr.kind === 'rock') {
        if (p.alive && overlaps(box, p)) {
          pr.life = 0;
          this.damagePlayer(pr.dmg, pr.x, 3);
          this.splash(pr, pr.kind === 'acid' ? [PAL.greenL, PAL.green] : [PAL.concrete, PAL.grayL]);
        }
      } else if (pr.kind === 'wave') {
        if (this.frame % 2 === 0) this.particles.push({ x: pr.x + pr.w / 2, y: pr.y + pr.h, vx: 0, vy: -1.5, life: 10, color: PAL.viralL, size: 2, gravity: 0.1 });
        if (p.alive && overlaps(box, p)) {
          pr.life = 0;
          this.damagePlayer(pr.dmg, pr.x, 4);
        }
      }
    }
    this.projectiles = this.projectiles.filter((pr) => pr.life > 0);
  }

  /** Acid or rubble breaking up where it lands; rubble also hurts anyone standing close. */
  splash(pr, colors, shake = 0) {
    const x = pr.x + pr.w / 2;
    const y = pr.y + pr.h / 2;
    this.addParticles(x, y, 10, colors, { speed: 2 });
    if (!shake) return;
    this.shake(shake);
    this.sfx('thud');
    const p = this.player;
    if (p.alive && Math.abs(centerX(p) - x) < 16 && Math.abs(p.y + p.h - (pr.y + pr.h)) < 20) this.damagePlayer(pr.dmg, x, 3);
  }

  // ---------------------------------------------------------------- world flow

  updateCheckpoints() {
    const p = this.player;
    const d = districtAt(this.level, centerX(p));
    if (d !== this.district) {
      this.district = d;
      this.emit('district', this.level.districts[d]);
    }
    const cps = this.level.checkpoints;
    if (this.checkpoint + 1 < cps.length && centerX(p) >= cps[this.checkpoint + 1]) {
      this.checkpoint++;
      this.banner = { text: this.level.districts[this.checkpoint].name, t: 150 };
      this.sfx('checkpoint');
      this.popup(centerX(p), p.y - 12, 'CHECKPOINT', PAL.blueL);
    }
    if (this.banner.t > 0) this.banner.t--;
  }

  updateArena() {
    if (this.arenaLocked) return;
    const p = this.player;
    const index = this.level.arenas.findIndex((a, i) => !this.bossesDefeated.has(i) && centerX(p) >= a.x0 + TILE * 4 && centerX(p) < a.x1);
    if (index === -1) return;
    const a = this.level.arenas[index];
    this.arena = a;
    this.arenaLocked = true;
    this.enemies = this.enemies.filter((e) => e.x > a.x0);
    this.projectiles = [];
    this.alert = 0;
    const col = Math.floor((a.x0 + 220) / TILE);
    this.boss = createEnemy(a.boss, a.x0 + 220, surfaceRow(this.level, col) * TILE);
    this.boss.facing = -1;
    this.enemies.push(this.boss);
    this.emit('boss', this.boss);
  }

  updateCamera() {
    const p = this.player;
    const lead = p.facing * 28;
    let minX = 0;
    let maxX = this.level.width - VIEW_W;
    if (this.arenaLocked) {
      minX = this.arena.x0;
      maxX = this.arena.x1 - VIEW_W;
    }
    const tx = Math.max(minX, Math.min(maxX, centerX(p) - VIEW_W / 2 + lead));
    this.camera.x += (tx - this.camera.x) * 0.1;
    this.camera.x = Math.max(minX, Math.min(maxX, this.camera.x));
    const ty = Math.min(0, p.y - 60);
    this.camera.y += (ty - this.camera.y) * 0.15;
  }

  // ---------------------------------------------------------------- effects

  addParticles(x, y, n, colors, { speed = 1.5, toward = null } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * speed + 0.3;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 1,
        life: 18 + Math.random() * 18,
        color: colors[i % colors.length],
        size: 1 + (i % 2),
        gravity: toward ? 0 : 0.15,
        toward,
      });
    }
  }

  popup(x, y, text, color, screen = false) {
    // Stack popups that land on top of each other.
    const crowd = this.popups.filter((pop) => Math.abs(pop.x - x) < 30 && Math.abs(pop.y - y) < 9).length;
    this.popups.push({ x, y: y - crowd * 9, text, color, t: 60, screen });
  }

  updateParticles() {
    for (const pt of this.particles) {
      if (pt.toward) {
        pt.vx += (centerX(pt.toward) - pt.x) * 0.02;
        pt.vy += (centerY(pt.toward) - pt.y) * 0.02;
      }
      pt.vy += pt.gravity;
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.life--;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
    for (const pop of this.popups) {
      pop.t--;
      pop.y -= 0.4;
    }
    this.popups = this.popups.filter((pop) => pop.t > 0);
  }

  get bossActive() {
    return this.boss && !this.boss.dead && this.arenaLocked;
  }
}
