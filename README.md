# MUTANT 32-BIT

A 32-bit-style browser action game starring **Maximus**, a shapeshifter loose in a city overrun by a viral outbreak. Run up skyscrapers, tear through the infected with shapeshifting powers, consume soldiers to steal their faces, and take down the Supreme Hunter and the Behemoth.

Everything is original and generated in code. The sprites are drawn from rectangles, the font is a hand-made 5×7 bitmap, and the music and sound effects are synthesized live with the Web Audio API. There are no image or audio files and no game engine.

### The 32-bit look

The game targets the look of the Saturn, PlayStation and GBA era of 2D games:

- **Resolution:** a 400×224 widescreen view rendered at 2× (800×448), so sprites and scrolling move in half-pixel steps.
- **Shaded, outlined sprites:** each pose is collected first, then drawn with a dark outline around the silhouette and automatic highlights and shadows on every part.
- **Lighting:** additive glows for street lamps and their light cones, neon signs, headlights, muzzle flashes, rockets, explosions, viral tendrils and the Hive's pulsing veins.
- **Atmosphere:** gradient skies, a moon, drifting clouds, three parallax skyline layers, horizon haze, searchlights over the military base, rain in the Infected Zone, embers in the Hive and the arena, blob shadows, a vignette, and a red pulse at low health.
- **Detailed city:** whole shaded building facades with framed and reflective windows, sills, cornices and fire escapes; sidewalks with curbs and manholes; cars with headlights.
- **HUD:** a portrait of Maximus, beveled bars with a damage trail, and power icons.
- **Audio:** detuned sawtooth leads with vibrato, filtered bass with a sub-oscillator, chord pads and punchier drums, all through an echo and a synthetic reverb.

## Play

```bash
npm install
npm run dev      # http://localhost:5190
```

`npm run build` writes a static site to `dist/` that runs from any folder: GitHub Pages, itch.io, Netlify, or a local file server.

### Deploy to Render

`render.yaml` is a Render Blueprint for a free static site. In the Render dashboard choose **New → Blueprint** and pick this repo. Render builds the game with `npm run build`, serves `dist/`, and redeploys on every push to `main`.

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
| Powers | 1 Fists · 2 Claws · 3 Whipfist · 5 Blade · 4 Armor · Q/E cycle | LB cycle, LT armor |
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
  - Blade: the arm becomes a sword. A fast slash, then a heavy overhead cleave. Slashes cut bullets, rockets, acid and falling rubble out of the air, and the blade is the only power that cuts armour properly.
  - Armor: takes 60% less damage and hits harder, but you move slower.
- **Consume:** grab infected or soldiers to heal and build mass. Hunters and the boss can be consumed when stunned.
- **Disguise:** consume a soldier with no other soldier watching and you take his form; the military stops shooting at you. Doing anything superhuman near soldiers blows your cover and maxes out the alert.
- **Alert:** soldiers who spot you raise the alert. At high alert a gunship hunts you with homing rockets.
- **Devastator:** when the mass bar is full, a burst of tendrils hits everything around you.
- **Ten districts:** each with its own palette, checkpoint and enemy mix.
  - Midtown, the Infected Zone, the Military Base and the Hive lead to the **Supreme Hunter**. It has three phases with leap slams that send out shockwaves, charges, summoned infected, and stun windows where you can consume it. Beating it knocks down the arena's far wall.
  - The Harbor (container stacks and cranes), the Toxic Refinery (smokestacks and falling ash), the Financial District (towers in a lightning storm) and the Quarantine Wall (a heavily guarded dawn) lead to **the Behemoth**.
  - The Behemoth is armoured: everything but the blade does 40% damage. It ground-pounds for shockwaves and falling rubble (watch for shadows), spits arcs of acid, and marks the street where spikes are about to burst up. Like the Supreme Hunter it has three phases and stun windows.
- **Extras:** score, time bonus, high score saved in the browser, and a title screen where the game plays itself.

## Code tour

| File | What it does |
| --- | --- |
| `src/game.js` | The world: spawns, combat, consume/disguise/alert rules, checkpoints, boss arena, camera |
| `src/player.js` | Player movement, powers and animation states |
| `src/enemies.js` | Infected, soldier, Hunter, gunship, Supreme Hunter and Behemoth behaviour |
| `src/level.js` | Seeded city generator (ten districts, two boss arenas, buildings, containers, scaffolds, cars, fences, hive growth) |
| `src/physics.js` | Tile collision, one-way platforms, wall detection |
| `src/sprites.js` | Procedural characters, drawn outlined and shaded |
| `src/render.js` | Skies, parallax, buildings, lighting, weather, HUD and menus |
| `src/audio.js` | Synthesized sound effects, four-track music sequencer, echo and reverb |
| `src/input.js` | Keyboard, gamepad and touch merged into one set of actions |
| `src/bot.js` | Autopilot for the title demo and testing |

The game logic doesn't touch the DOM, so it runs headless. `npm test` runs 25 tests covering movement, combat, the blade, consume and disguise, death and respawn, both boss fights, and the gate between them. One test sends the autopilot from the Harbor to the Behemoth's arena, which shows the new districts can be crossed.

For screenshots and tuning, `?shot=play:900&x=3640` starts a bot-driven game at that x position, fast-forwards 900 frames and draws a single frame.

## Legal

Inspired by *Prototype* (Activision, 2009). This project is not affiliated with or endorsed by Activision, and it uses no assets, names or characters from that game. The game title and hero name live in one place, `src/config.js`.
