import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GROUND_ROW, TILE } from '../src/config.js';
import { createEnemy } from '../src/enemies.js';
import { buildLevel, isSolid, T, tileAt } from '../src/level.js';
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

  test('has five districts, an arena and enemies to fight', () => {
    assert.equal(level.districts.length, 5);
    assert.ok(level.arena && level.arena.x1 > level.arena.x0);
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

describe('boss arena', () => {
  test('entering the arena locks the camera and wakes the Supreme Hunter', () => {
    const { game, input } = quietGame();
    const a = game.level.arena;
    const p = game.player;
    p.x = a.x0 + TILE * 6;
    p.y = GROUND_ROW * TILE - p.h;
    step(game, input, 120);
    assert.ok(game.arenaLocked);
    assert.ok(game.boss && !game.boss.dead);
    assert.ok(game.camera.x >= a.x0);
    // You can't leave the arena the way you came.
    input.hold('left');
    step(game, input, 120);
    assert.ok(p.x >= a.x0);
  });

  test('defeating the boss wins the game', () => {
    const { game, input } = quietGame();
    const a = game.level.arena;
    game.player.x = a.x0 + TILE * 6;
    step(game, input, 2);
    const boss = game.boss;
    game.damageEnemy(boss, 1000, 0, 0, 'player');
    assert.ok(boss.dead);
    step(game, input, 200);
    assert.equal(game.mode, 'victory');
    assert.ok(game.score >= 5000);
  });
});
