import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GROUND_ROW, TILE } from '../src/config.js';
import { createBot } from '../src/bot.js';
import { createEnemy } from '../src/enemies.js';
import { buildLevel, isSolid, T, tileAt } from '../src/level.js';
import { createRng } from '../src/rng.js';
import { placeOnOpenStreet, quietGame, step } from './helpers.js';

const feet = (b) => b.y + b.h;

describe('level', () => {
  const level = buildLevel(1985);

  test('is deterministic', () => {
    assert.deepEqual(buildLevel(1985).tiles, level.tiles);
  });

  test('has street under every column (no pits)', () => {
    for (let c = 0; c < level.cols; c++) assert.equal(tileAt(level, c, GROUND_ROW), T.GROUND, `column ${c}`);
  });

  test('has ten districts, two boss arenas and enemies to fight', () => {
    assert.equal(level.districts.length, 10);
    assert.deepEqual(level.arenas.map((a) => a.boss), ['boss', 'behemoth']);
    assert.deepEqual(level.arenas.map((a) => a.final), [false, true]);
    for (const a of level.arenas) assert.ok(a.x1 > a.x0);
    assert.ok(level.spawns.filter((s) => s.type === 'soldier').length >= 10);
    assert.ok(level.buildings.length >= 15);
  });

  test('spawns stand on solid ground, not inside walls', () => {
    for (const s of level.spawns) {
      const c = Math.floor(s.x / TILE);
      assert.ok(isSolid(tileAt(level, c, s.y / TILE)), `${s.type} at ${s.x} needs ground`);
      assert.ok(!isSolid(tileAt(level, c, s.y / TILE - 1)), `${s.type} at ${s.x} is inside a wall`);
    }
  });
});

describe('movement', () => {
  test('lands on the street and stays there', () => {
    const { game, input } = quietGame();
    step(game, input, 300);
    assert.equal(feet(game.player), GROUND_ROW * TILE);
    assert.ok(game.player.onGround);
  });

  test('runs up a building and onto the roof', () => {
    const { game, input } = quietGame();
    const b = game.level.buildings.find((bd) => bd.c0 > 4 && bd.style !== 'hive');
    const p = game.player;
    p.x = b.c0 * TILE - 40;
    p.y = GROUND_ROW * TILE - p.h;
    input.hold('right');
    let onRoof = false;
    step(game, input, 120, () => {
      if (p.onGround && feet(p) === b.top * TILE && p.x > b.c0 * TILE - p.w) onRoof = true;
    });
    assert.ok(onRoof, 'should climb the wall and land on the roof');
  });

  test('double jump goes higher than a single jump', () => {
    const peak = (double) => {
      const { game, input } = quietGame();
      step(game, input, 60);
      const start = game.player.y;
      let min = start;
      input.tap('jump');
      step(game, input, 60, (i) => {
        input.hold('jump');
        if (double && i === 12) input.tap('jump');
        min = Math.min(min, game.player.y);
      });
      return start - min;
    };
    assert.ok(peak(true) > peak(false) + 20);
  });

  test('dash covers ground quickly', () => {
    const { game, input } = quietGame();
    placeOnOpenStreet(game, 120);
    step(game, input, 30);
    const x0 = game.player.x;
    input.tap('dash');
    step(game, input, 10);
    assert.ok(game.player.x - x0 > 45);
  });
});

describe('combat', () => {
  function withEnemy(type, dx = 18) {
    const ctx = quietGame();
    placeOnOpenStreet(ctx.game, 240);
    step(ctx.game, ctx.input, 30);
    const p = ctx.game.player;
    const e = createEnemy(type, p.x + p.w / 2 + dx, feet(p));
    ctx.game.enemies.push(e);
    return { ...ctx, e, p };
  }

  test('blade: a slash then a heavier cleave', () => {
    const { game, input, e } = withEnemy('hunter', 24);
    input.tap('p5');
    step(game, input, 1);
    assert.equal(game.player.power, 'blade');
    input.tap('attack');
    step(game, input, 8);
    input.tap('attack'); // queue the cleave
    step(game, input, 50);
    assert.equal(e.hp, e.maxHp - 3 - 5);
  });

  test('blade slashes cut bullets out of the air', () => {
    const { game, input, p } = withEnemy('infected', 200);
    input.tap('p5');
    step(game, input, 1);
    // Far enough out that it meets the slash, not the player, when it arrives.
    const bullet = { kind: 'bullet', x: p.x + p.w + 32, y: p.y + 6, w: 4, h: 2, vx: -3.8, vy: 0, life: 110, owner: 'soldier', dmg: 6 };
    game.projectiles.push(bullet);
    const hp = p.hp;
    input.tap('attack');
    step(game, input, 12);
    assert.ok(!game.projectiles.includes(bullet), 'the bullet is gone');
    assert.equal(p.hp, hp, 'and it never reached the player');
  });

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

  test('claws hit harder than fists', () => {
    const { game, input, e } = withEnemy('hunter', 24);
    input.tap('p2');
    step(game, input, 1);
    input.tap('attack');
    step(game, input, 24);
    assert.equal(e.hp, e.maxHp - 3);
  });

  test('consuming an unseen soldier heals and grants a disguise', () => {
    const { game, input, e, p } = withEnemy('soldier', 14);
    p.hp = 40;
    input.tap('consume');
    step(game, input, 30);
    assert.ok(e.dead);
    assert.ok(p.hp >= 64);
    assert.equal(p.disguised, true);
    assert.equal(game.consumes, 1);
  });

  test('disguised: soldiers hold fire; a superhuman move nearby blows it', () => {
    const { game, input, p } = withEnemy('soldier', 14);
    input.tap('consume');
    step(game, input, 30);
    assert.equal(p.disguised, true);

    const watcher = createEnemy('soldier', p.x + 80, feet(p));
    game.enemies.push(watcher);
    step(game, input, 200);
    assert.equal(game.projectiles.filter((pr) => pr.kind === 'bullet').length, 0, 'no shots at a disguised player');

    input.tap('jump');
    step(game, input, 8, () => input.hold('jump'));
    input.tap('jump'); // double jump is superhuman
    step(game, input, 2);
    assert.equal(p.disguised, false);
    assert.equal(game.alert, 100);
  });

  test('soldiers shoot an undisguised player', () => {
    const { game, input, p } = withEnemy('soldier', 90);
    const hp = p.hp;
    step(game, input, 240);
    assert.ok(p.hp < hp);
  });

  test('devastator hits everything nearby', () => {
    const { game, input, p } = withEnemy('infected', 30);
    game.enemies.push(createEnemy('infected', p.x - 40, feet(p)));
    p.mass = 100;
    input.tap('dev');
    step(game, input, 45);
    assert.equal(game.enemies.filter((e) => !e.dead).length, 0);
    assert.equal(p.mass, 0);
  });

  test('dying and respawning at the checkpoint', () => {
    const { game, input, p } = withEnemy('infected', 200);
    game.damagePlayer(500, p.x + 20);
    assert.equal(game.mode, 'dead');
    game.respawn();
    assert.equal(game.mode, 'play');
    assert.equal(game.player.hp, 100);
    assert.equal(game.deaths, 1);
  });
});

describe('boss arenas', () => {
  test('entering the arena locks the camera and wakes the Supreme Hunter', () => {
    const { game, input } = quietGame();
    const a = game.level.arenas[0];
    const p = game.player;
    p.x = a.x0 + TILE * 6;
    p.y = GROUND_ROW * TILE - p.h;
    step(game, input, 120);
    assert.ok(game.arenaLocked);
    assert.ok(game.boss && !game.boss.dead);
    assert.equal(game.boss.type, 'boss');
    assert.ok(game.camera.x >= a.x0);
    // You can't leave the arena the way you came.
    input.hold('left');
    step(game, input, 120);
    assert.ok(p.x >= a.x0);
  });

  test('beating the Supreme Hunter opens the way on instead of ending the game', () => {
    const { game, input } = quietGame();
    const a = game.level.arenas[0];
    const p = game.player;
    p.x = a.x0 + TILE * 6;
    step(game, input, 2);
    game.damageEnemy(game.boss, 1000, 0, 0, 'player');
    step(game, input, 200);
    assert.equal(game.mode, 'play');
    assert.equal(game.arenaLocked, false);
    assert.ok(a.open);
    // Walk out through where the wall was, into the Harbor.
    input.hold('right');
    step(game, input, 240);
    assert.ok(p.x > a.x1, `player stuck at ${p.x}, gate at ${a.x1}`);
    assert.equal(game.level.districts[game.district].name, 'HARBOR');
    // A respawn doesn't bring the Supreme Hunter back.
    game.respawn();
    step(game, input, 60);
    assert.ok(!game.arenaLocked);
  });

  function inFinalArena() {
    const ctx = quietGame();
    const a = ctx.game.level.arenas[1];
    ctx.game.player.x = a.x0 + TILE * 6;
    ctx.game.player.y = GROUND_ROW * TILE - ctx.game.player.h;
    step(ctx.game, ctx.input, 2);
    return { ...ctx, a, boss: ctx.game.boss };
  }

  test('the Behemoth waits in the last arena; beating it wins the game', () => {
    const { game, input, boss } = inFinalArena();
    assert.equal(boss.type, 'behemoth');
    game.damageEnemy(boss, 1000, 0, 0, 'blade');
    assert.ok(boss.dead);
    step(game, input, 200);
    assert.equal(game.mode, 'victory');
    assert.ok(game.score >= 10000);
  });

  test("the Behemoth's armour blunts everything but the blade", () => {
    const { game, boss } = inFinalArena();
    boss.state = 'stalk';
    game.damageEnemy(boss, 10, 0, 0, 'player');
    assert.equal(boss.hp, boss.maxHp - 4);
    game.damageEnemy(boss, 10, 0, 0, 'blade');
    assert.equal(boss.hp, boss.maxHp - 14);
  });

  test('the Behemoth pounds, spits acid and raises spikes that hurt', () => {
    const { game, input, boss } = inFinalArena();
    const p = game.player;
    const homeX = boss.x;
    p.invuln = 0;
    boss.hp = boss.maxHp * 0.5; // phase 2: every attack is unlocked
    boss.stunnedOnce[66] = true;
    const kinds = new Set();
    let hurt = false;
    // The Behemoth picks attacks at random; a fixed seed keeps the test repeatable.
    const random = Math.random;
    Math.random = createRng(7).next;
    step(game, input, 1200, () => {
      boss.x = homeX; // held at range, where it uses its ranged attacks
      for (const pr of game.projectiles) kinds.add(pr.kind);
      if (p.hp < 100) hurt = true;
      p.hp = 100; // keep the test going
      p.alive = true;
      game.mode = 'play';
    });
    Math.random = random;
    for (const kind of ['wave', 'rock', 'acid', 'spike']) assert.ok(kinds.has(kind), `never used ${kind}; saw ${[...kinds]}`);
    assert.ok(hurt);
  });

  test('stunned at 66% and consumable, like the Supreme Hunter', () => {
    const { game, input, boss } = inFinalArena();
    game.damageEnemy(boss, boss.maxHp * 0.36, 0, 0, 'blade');
    assert.equal(boss.state, 'stunned');
    const p = game.player;
    p.x = boss.x - p.w - 4;
    p.y = boss.y + boss.h - p.h;
    p.facing = 1;
    const hp = boss.hp;
    input.tap('consume');
    step(game, input, 30);
    assert.ok(boss.hp < hp);
  });
});

describe('the new districts', () => {
  test('can be crossed from the Harbor to the last arena', () => {
    // The autopilot, made invulnerable, has to find a way over everything the generator built.
    const bot = createBot();
    const { game } = quietGame();
    game.input = bot;
    bot.attach(game);
    const harbor = game.level.districts.findIndex((d) => d.name === 'HARBOR');
    game.checkpoint = harbor;
    game.bossesDefeated.add(0);
    game.reset();
    const finalArena = game.level.arenas[1];
    for (let i = 0; i < 60 * 240 && !game.arenaLocked; i++) {
      game.player.invuln = 10;
      game.player.hp = 100;
      bot.update();
      game.update();
    }
    assert.ok(game.arenaLocked && game.arena === finalArena, `stuck at x=${Math.round(game.player.x)} in ${game.level.districts[game.district].name}`);
  });
});
