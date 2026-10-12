# MUTANT 8-BIT

An 8-bit browser action game starring **Maximus**, a shapeshifter loose in a city overrun by a viral outbreak. Run up skyscrapers, tear through the infected with shapeshifting powers, consume soldiers to steal their faces, and take down the Supreme Hunter.

Everything is original and generated in code: the pixel art is drawn from rectangles, the font is a hand-made 5×7 bitmap, and the chiptune music and sound effects are synthesized live with the Web Audio API. There are no image or audio files and no game engine.

## Play

```bash
npm install
npm run dev      # http://localhost:5190
```

`npm run build` writes a static site to `dist/` that runs from any folder: GitHub Pages, itch.io, Netlify, or a local file server.

### Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move | Arrows / WASD | D-pad / left stick |
| Jump (again in mid-air) | Z / Space / Up | A |
| Glide | Hold jump while falling | Hold A |
| Wall run | Run into any building | |
| Attack | X / J | X |
| Consume | C / L | B |
| Dash | Shift | RB / RT |
| Powers | 1 Fists · 2 Claws · 3 Whipfist · 4 Armor · Q/E cycle | LB cycle, LT armor |
| Ground slam | Claws + Down + Attack in the air | |
| Devastator | V when the mass bar (MS) is full | Y |
| Pause / Mute | P or Esc / M | Start |

On phones and tablets, on-screen buttons appear below the game.

## What's in it

- **Parkour:** wall-run up any building, double jump, glide, air-dash, drop through scaffolding.
- **Powers:**
  - Fists: a three-hit combo ending in an uppercut.
  - Claws: heavy swipes, plus a diving ground slam.
  - Whipfist: long reach, good for hitting the gunship.
  - Armor: takes 60% less damage and hits harder, but you move slower.
- **Consume:** grab infected or soldiers to heal and build mass. Hunters and the boss can be consumed when stunned.
- **Disguise:** consume a soldier with no other soldier watching and you take his form; the military stops shooting at you. Doing anything superhuman near soldiers blows your cover and maxes out the alert.
- **Alert:** soldiers who spot you raise the alert. At high alert a gunship hunts you with homing rockets.
- **Devastator:** when the mass bar is full, a burst of tendrils hits everything around you.
- **Five districts:** Midtown, the Infected Zone, the Military Base and the Hive, each with its own palette, checkpoint and enemy mix, ending in the **Supreme Hunter** fight. It has three phases with leap slams that send out shockwaves, charges, summoned infected, and stun windows where you can consume it.
- **Extras:** score, time bonus, high score saved in the browser, and a title screen where the game plays itself.

## Code tour

| File | What it does |
| --- | --- |
| `src/game.js` | The world: spawns, combat, consume/disguise/alert rules, checkpoints, boss arena, camera |
| `src/player.js` | Player movement, powers and animation states |
| `src/enemies.js` | Infected, soldier, Hunter, gunship and boss behaviour |
| `src/level.js` | Seeded city generator (five districts, buildings, scaffolds, cars, fences, hive growth) |
| `src/physics.js` | Tile collision, one-way platforms, wall detection |
| `src/sprites.js` | Procedural pixel-art characters |
| `src/render.js` | Parallax skylines, tiles, HUD and menus |
| `src/audio.js` | Chiptune sound effects and a four-track music sequencer |
| `src/input.js` | Keyboard, gamepad and touch merged into one set of actions |
| `src/bot.js` | Autopilot for the title demo and testing |

The game logic doesn't touch the DOM, so it runs headless. `npm test` runs 18 tests covering movement, combat, consume and disguise, death and respawn, and the boss fight. A full autopilot run can finish the game, which shows the level can be completed.

For screenshots and tuning, `?shot=play:900&x=3640` starts a bot-driven game at that x position, fast-forwards 900 frames and draws a single frame.

## Legal

Inspired by *Prototype* (Activision, 2009). This project is not affiliated with or endorsed by Activision, and it uses no assets, names or characters from that game. The game title and hero name live in one place, `src/config.js`.
