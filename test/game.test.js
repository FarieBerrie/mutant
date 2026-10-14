import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../src/bot.js';
import { createEnemy } from '../src/enemies.js';
import { buildLevel, groundHeight } from '../src/level.js';
import { createRng } from '../src/rng.js';
import { openStreet, placePlayer, quietGame, step } from './helpers.js';

describe('city', () => {
  const level = buildLevel(1985);

  test('is deterministic', () => {
    const again = buildLevel(1985);
    assert.deepEqual(
      again.boxes.map((b) => [b.x0, b.x1, b.y1, b.z0, b.z1]),
      level.boxes.map((b) => [b.x0, b.x1, b.y1, b.z0, b.z1]),
    );
  });

  test('has ten districts, two boss arenas and enemies to fight', () => {
    assert.equal(level.districts.length, 10);
    assert.deepEqual(level.arenas.map((a) => a.boss), ['boss', 'behemoth']);
    assert.deepEqual(level.arenas.map((a) => a.final), [false, true]);
    assert.ok(level.spawns.filter((s) => s.type === 'soldier').length >= 30);
    assert.ok(level.boxes.filter((b) => b.kind === 'building').length >= 100);
  });

  test('the avenue at the start is open street', () => {
    for (let x = 0; x < 12; x++) assert.equal(groundHeight(level, x, 0, 1), 0);
  });

  test('spawns stand on something, not inside it', () => {
    for (const s of level.spawns) {
      assert.equal(groundHeight(level, s.x, s.z, 0.3, s.y), s.y, `${s.type} at ${s.x.toFixed(1)}, ${s.z.toFixed(1)}`);
      const inside = level.boxes.some((b) => s.x > b.x0 && s.x < b.x1 && s.z > b.z0 && s.z < b.z1 && s.y + 0.5 > b.y0 && s.y + 0.5 < b.y1);
      assert.ok(!inside, `${s.type} at ${s.x.toFixed(1)}, ${s.z.toFixed(1)} is inside a box`);
    }
  });
});

describe('movement', () => {
  test('stands on the street', () => {
    const { game, input } = quietGame();
    step(game, input, 60);
    assert.equal(game.player.y, 0);
    assert.ok(game.player.onGround);
  });

  test('runs where you push, in any direction', () => {
    const { game, input } = quietGame();
    const p = placePlayer(game, openStreet(game, 25));
    const x0 = p.x;
    input.hold('up');
    step(game, input, 60);
    assert.ok(p.x - x0 > 7, `ran ${p.x - x0} m`);
    input.release('up');
    input.hold('right');
    const z0 = p.z;
    step(game, input, 30);
    assert.ok(p.z - z0 > 3);
  });

  test('runs up a building and onto the roof', () => {
    const { game, input } = quietGame();
    const b = game.level.boxes.find((bx) => bx.kind === 'building' && bx.side === 1 && bx.x0 > 20 && bx.y1 >= 16);
    const p = placePlayer(game, (b.x0 + b.x1) / 2, b.z0 - 3);
    input.hold('right');
    let onRoof = false;
    step(game, input, 240, () => {
      if (p.onGround && p.ground === b) onRoof = true;
    });
    assert.ok(onRoof, `should climb ${b.y1} m and land on the roof; ended at y=${p.y.toFixed(1)}`);
  });

  test('double jump goes higher than a single jump', () => {
    const peak = (double) => {
      const { game, input } = quietGame();
      step(game, input, 30);
      let top = 0;
      input.tap('jump');
      step(game, input, 80, (i) => {
        input.hold('jump');
        if (double && i === 20) input.tap('jump');
        top = Math.max(top, game.player.y);
      });
      return top;
    };
    assert.ok(peak(true) > peak(false) + 1.5);
  });

  test('gliding falls slowly', () => {
    const fallTime = (glide) => {
      const { game, input } = quietGame();
      const p = game.player;
      p.y = 30;
      let frames = 0;
      step(game, input, 600, () => {
        if (glide) input.hold('jump');
        if (!p.onGround) frames++;
      });
      return frames;
    };
    assert.ok(fallTime(true) > fallTime(false) * 3);
  });

  test('dash covers ground quickly', () => {
    const { game, input } = quietGame();
    const p = placePlayer(game, openStreet(game, 25));
    step(game, input, 5);
    const x0 = p.x;
    input.tap('dash');
    step(game, input, 10);
    assert.ok(p.x - x0 > 4);
  });

  test("arena walls can't be climbed", () => {
    const { game, input } = quietGame();
    const a = game.level.arenas[0];
    const p = placePlayer(game, a.x0 + 20, 25);
    input.hold('right');
    step(game, input, 180);
    assert.ok(p.y < 1, `climbed to ${p.y}`);
  });
});

describe('combat', () => {
  function withEnemy(type, dx = 1.6) {
    const ctx = quietGame();
    const p = placePlayer(ctx.game, openStreet(ctx.game, 20));
    step(ctx.game, ctx.input, 5);
    const e = createEnemy(type, p.x + dx, 0, p.z);
    e.yaw = Math.PI;
    ctx.game.enemies.push(e);
    return { ...ctx, e, p };
  }

  test('punches kill an infected and score points', () => {
    const { game, input, e } = withEnemy('infected');
    for (let i = 0; i < 12 && !e.dead; i++) {
      input.tap('attack');
      step(game, input, 16);
    }
    assert.ok(e.dead);
    assert.ok(game.score >= 50);
    assert.ok(game.player.mass > 0);
  });

  test('attacks turn to face a target beside you', () => {
    const { game, input, p, e } = withEnemy('infected', 0);
    e.x = p.x;
    e.z = p.z + 1.4;
    input.tap('attack');
    step(game, input, 10);
    assert.ok(e.hp < e.maxHp);
  });

  test('claws hit harder than fists', () => {
    const { game, input, e } = withEnemy('hunter', 2);
    input.tap('p2');
    step(game, input, 1);
    input.tap('attack');
    step(game, input, 24);
    assert.equal(e.hp, e.maxHp - 3);
  });

  test('blade: a slash then a heavier cleave', () => {
    const { game, input, e } = withEnemy('hunter', 2.2);
    input.tap('p5');
    step(game, input, 1);
    assert.equal(game.player.power, 'blade');
    input.tap('attack');
    step(game, input, 8);
    input.tap('attack');
    step(game, input, 50);
    assert.equal(e.hp, e.maxHp - 3 - 5);
  });

  test('blade slashes cut bullets out of the air', () => {
    const { game, input, p } = withEnemy('infected', 30);
    input.tap('p5');
    step(game, input, 1);
    // Far enough out that it meets the slash, not the player.
    const bullet = { kind: 'bullet', x: p.x + 6, y: p.y + 1.2, z: p.z, vx: -42, vy: 0, vz: 0, r: 0.15, life: 90, owner: 'soldier', dmg: 6 };
    game.projectiles.push(bullet);
    const hp = p.hp;
    input.tap('attack');
    step(game, input, 12);
    assert.ok(!game.projectiles.includes(bullet), 'the bullet is gone');
    assert.equal(p.hp, hp, 'and it never reached the player');
  });

  test('consuming an unseen soldier heals and grants a disguise', () => {
    const { game, input, e, p } = withEnemy('soldier', 1.2);
    p.hp = 40;
    input.tap('consume');
    step(game, input, 30);
    assert.ok(e.dead);
    assert.ok(p.hp >= 64);
    assert.equal(p.disguised, true);
    assert.equal(game.consumes, 1);
  });

  test('disguised: soldiers hold fire; a superhuman move nearby blows it', () => {
    const { game, input, p } = withEnemy('soldier', 1.2);
    input.tap('consume');
    step(game, input, 30);
    assert.equal(p.disguised, true);

    const watcher = createEnemy('soldier', p.x + 8, 0, p.z);
    game.enemies.push(watcher);
    step(game, input, 200);
    assert.equal(game.projectiles.filter((pr) => pr.kind === 'bullet').length, 0, 'no shots at a disguised player');

    input.tap('jump');
    step(game, input, 10, () => input.hold('jump'));
    input.tap('jump'); // double jump is superhuman
    step(game, input, 2);
    assert.equal(p.disguised, false);
    assert.equal(game.alert, 100);
  });

  test('soldiers shoot an undisguised player they can see', () => {
    const { game, input, p } = withEnemy('soldier', 12);
    const hp = p.hp;
    step(game, input, 300);
    assert.ok(p.hp < hp);
  });

  test('devastator hits everything nearby', () => {
    const { game, input, p } = withEnemy('infected', 3);
    game.enemies.push(createEnemy('infected', p.x - 4, 0, p.z + 2));
    p.mass = 100;
    input.tap('dev');
    step(game, input, 45);
    assert.equal(game.enemies.filter((e) => !e.dead).length, 0);
    assert.equal(p.mass, 0);
  });

  test('dying and respawning at the checkpoint', () => {
    const { game, p } = withEnemy('infected', 20);
    game.damagePlayer(500, { x: p.x + 1, z: p.z });
    assert.equal(game.mode, 'dead');
    game.respawn();
    assert.equal(game.mode, 'play');
    assert.equal(game.player.hp, 100);
    assert.equal(game.deaths, 1);
  });
});

describe('boss arenas', () => {
  function enterArena(index) {
    const ctx = quietGame();
    const a = ctx.game.level.arenas[index];
    placePlayer(ctx.game, a.x0 + 12, 0);
    step(ctx.game, ctx.input, 2);
    return { ...ctx, a, boss: ctx.game.boss };
  }

  test("entering the arena wakes the Supreme Hunter, and you can't leave", () => {
    const { game, input, a, boss } = enterArena(0);
    assert.ok(game.arenaLocked);
    assert.equal(boss.type, 'boss');
    input.hold('down');
    step(game, input, 120);
    assert.ok(game.player.x >= a.x0);
  });

  test('beating the Supreme Hunter opens the way on instead of ending the game', () => {
    const { game, input, a, boss } = enterArena(0);
    game.damageEnemy(boss, 1000, { x: 1, z: 0 }, 0, 'player');
    step(game, input, 200);
    assert.equal(game.mode, 'play');
    assert.equal(game.arenaLocked, false);
    assert.ok(a.open);
    const p = game.player;
    input.hold('up');
    step(game, input, 600);
    assert.ok(p.x > a.x1, `stuck at ${p.x.toFixed(1)}, the gate was at ${a.x1}`);
    assert.equal(game.level.districts[game.district].name, 'HARBOR');
    game.respawn();
    step(game, input, 60);
    assert.ok(!game.arenaLocked, "the Supreme Hunter doesn't come back");
  });

  test('the Behemoth waits in the last arena; beating it wins the game', () => {
    const { game, input, boss } = enterArena(1);
    assert.equal(boss.type, 'behemoth');
    game.damageEnemy(boss, 1000, { x: 1, z: 0 }, 0, 'blade');
    step(game, input, 200);
    assert.equal(game.mode, 'victory');
    assert.ok(game.score >= 10000);
  });

  test("the Behemoth's armour blunts everything but the blade", () => {
    const { game, boss } = enterArena(1);
    boss.state = 'stalk';
    game.damageEnemy(boss, 10, { x: 1, z: 0 }, 0, 'player');
    assert.equal(boss.hp, boss.maxHp - 4);
    game.damageEnemy(boss, 10, { x: 1, z: 0 }, 0, 'blade');
    assert.equal(boss.hp, boss.maxHp - 14);
  });

  test('the Behemoth pounds, spits acid and raises spikes that hurt', () => {
    const { game, input, boss } = enterArena(1);
    const p = game.player;
    const home = { x: boss.x, z: boss.z };
    boss.hp = boss.maxHp * 0.5; // phase 2: every attack is unlocked
    boss.stunnedOnce[66] = true;
    const kinds = new Set();
    let hurt = false;
    // The Behemoth picks attacks at random; a fixed seed keeps the test repeatable.
    const random = Math.random;
    Math.random = createRng(7).next;
    step(game, input, 1500, () => {
      boss.x = home.x; // held at range, where it uses its ranged attacks
      boss.z = home.z;
      for (const pr of game.projectiles) kinds.add(pr.kind);
      if (p.hp < 100) hurt = true;
      p.hp = 100;
      p.alive = true;
      game.mode = 'play';
    });
    Math.random = random;
    for (const kind of ['ring', 'rock', 'acid', 'spike']) assert.ok(kinds.has(kind), `never used ${kind}; saw ${[...kinds]}`);
    assert.ok(hurt);
  });

  test('jumping clears a shockwave ring', () => {
    const { game, input, boss } = enterArena(1);
    const p = game.player;
    boss.state = 'stunned';
    boss.t = 9999;
    game.spawnProjectile({ kind: 'ring', x: p.x - 6, y: 0, z: p.z, radius: 1, speed: 10, life: 90, dmg: 16, vx: 0, vy: 0, vz: 0, r: 0 });
    const hp = p.hp;
    // The ring reaches the player after about 28 frames; jump a moment before.
    step(game, input, 90, (i) => {
      if (i === 20) input.tap('jump');
      if (i > 20) input.hold('jump');
    });
    assert.equal(p.hp, hp);
  });

  test('bosses are stunned at 66% and can be consumed', () => {
    const { game, input, boss } = enterArena(1);
    game.damageEnemy(boss, boss.maxHp * 0.36, { x: 1, z: 0 }, 0, 'blade');
    assert.equal(boss.state, 'stunned');
    const p = game.player;
    p.x = boss.x - boss.r - p.r - 0.6;
    p.z = boss.z;
    p.yaw = 0;
    const hp = boss.hp;
    input.tap('consume');
    step(game, input, 30);
    assert.ok(boss.hp < hp);
  });
});

describe('the whole run', () => {
  test('the autopilot can cross every district and beat both bosses', () => {
    // Invulnerable, so this checks the city can be crossed, not the bot's skill.
    const bot = createBot();
    const { game } = quietGame();
    game.input = bot;
    game.spawnCursor = 0;
    bot.attach(game);
    for (let i = 0; i < 60 * 60 * 10 && game.mode !== 'victory'; i++) {
      game.player.invuln = 10;
      game.player.hp = 100;
      bot.update();
      game.update();
    }
    assert.equal(game.mode, 'victory', `stuck at x=${game.player.x.toFixed(1)} in ${game.level.districts[game.district].name}`);
    assert.ok(game.kills > 20);
  });
});
