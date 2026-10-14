# MUTANT 64

A 64-bit-style 3D action game for the browser, starring **Maximus**, a shapeshifter loose in a city overrun by a viral outbreak. Run up skyscrapers, tear through the infected with shapeshifting powers, consume soldiers to steal their faces, and take down the Supreme Hunter and the Behemoth.

Everything is original and generated in code. The characters are built from boxes, the textures are painted on small canvases at load time, the font is a hand-made 5×7 bitmap, and the music and sound effects are synthesized live with the Web Audio API. There are no image, model or audio files. The 3D rendering uses [three.js](https://threejs.org).

### The 64-bit look

The game targets the look of the Nintendo 64 era of 3D games:

- **Soft but clear picture:** the 3D view renders up to 540 lines tall with antialiasing and anisotropic texture filtering, and is scaled up smoothly. The HUD stays crisp pixel art.
- **Low-poly characters:** Maximus (hood down, black fade), soldiers, infected, Hunters, the gunship and both bosses are built from boxes, tapered cylinders, cones and rounded shapes, with knees and elbows, and drawn with a thin dark outline so they stand out. Each limb is merged into one mesh, so a character costs only a handful of draw calls.
- **Smooth motion:** the game simulates at a fixed 60 steps a second, and everything drawn (characters, projectiles, particles, the camera) is interpolated between steps, so movement is smooth on any refresh rate. Limbs blend between poses instead of snapping.
- **Soft textures:** facades, roofs, the street, shipping containers, refinery pipework and hive flesh are painted on small canvases and filtered smoothly, the way the N64 did. Lit windows glow at night.
- **Detailed city:** buildings have dark edge lines, real window sills and lintels on the street side, plinths, floor bands, corner pilasters, cornices and parapets, with air-con units and stair huts on the roofs; glass towers have fins and stepped crowns; refineries have pipes and catwalks. Streets have raised sidewalks with kerbs, shaped cars with round wheels, lamp posts, hydrants, bins, benches, news boxes and traffic lights. Arena walls have buttresses and spikes.
- **Fog and blob shadows:** distance fog hides the draw distance, and every character casts a round shadow.
- **Districts that blend:** each district has its own sky, fog colour, lighting and weather (rain, embers, falling ash, a lightning storm), and they blend as you cross from one to the next.
- **HUD:** the pixel-art HUD from the 2D game, drawn over the 3D view.

## Play

```bash
npm install
npm run dev      # http://localhost:5190
```

`npm run build` writes a static site to `dist/` that runs from any folder: GitHub Pages, itch.io, Netlify, or a local file server.

### Deploy to Render

`render.yaml` is a Render Blueprint for a free static site. In the Render dashboard choose **New → Blueprint** and pick this repo. Render builds the game with `npm run build`, serves `dist/`, and redeploys on every push to `main`.

### Controls

Click the game to use the mouse for the camera. Movement is relative to the camera.

| Action | Keyboard and mouse | Gamepad |
| --- | --- | --- |
| Move | WASD | Left stick |
| Camera | Mouse, or the arrow keys | Right stick |
| Jump (again in mid-air) | Space / Z | A |
| Glide | Hold jump while falling | Hold A |
| Wall run | Run into any building | |
| Attack | Left click / X / J | X |
| Consume | Right click / C / L | B |
| Dash | Shift | RB / RT |
| Powers | 1 Fists · 2 Claws · 3 Whipfist · 5 Blade · 4 Armor · Q/E cycle | LB cycle, LT armor |
| Ground slam | Claws, attack in mid-air | |
| Devastator | V when the mass bar (MS) is full | Y |
| Pause / Mute | P or Esc / M | Start |

On phones and tablets, a joystick and buttons appear below the game; drag on the game to turn the camera.

## What's in it

- **A 3D city:** each district is a stretch of avenue lined with two rows of buildings on each side, with alleys between them and cars, fences, containers or hive growths in the street.
- **Parkour:** wall-run up any building, double jump, glide, air-dash. Attacks turn you toward the nearest enemy in reach.
- **Powers:**
  - Fists: a three-hit combo ending in an uppercut.
  - Claws: heavy swipes, plus a diving ground slam.
  - Whipfist: long reach, good for hitting the gunship.
  - Blade: the arm becomes a sword. A fast slash, then a heavy overhead cleave. Slashes cut bullets, rockets, acid and falling rubble out of the air, and the blade is the only power that cuts armour properly.
  - Armor: takes 60% less damage and hits harder, but you move slower.
- **Consume:** grab infected or soldiers to heal and build mass. Hunters and the bosses can be consumed when stunned.
- **Disguise:** consume a soldier with no other soldier watching and you take his form; the military stops shooting at you. Doing anything superhuman near soldiers blows your cover and maxes out the alert.
- **Alert:** soldiers who can see you raise the alert. At high alert a gunship circles overhead firing homing rockets.
- **Devastator:** when the mass bar is full, a burst of tendrils hits everything around you.
- **Ten districts:**
  - Midtown, the Infected Zone, the Military Base and the Hive lead to the **Supreme Hunter**. It leaps at you and lands with a shockwave ring (jump it), charges across the arena, summons infected, and has stun windows where you can consume it. Beating it knocks down the arena's far wall.
  - The Harbor, the Toxic Refinery, the Financial District and the Quarantine Wall lead to **the Behemoth**. It's armoured: everything but the blade does 40% damage. It ground-pounds for shockwave rings and falling rubble (watch for shadows), lobs acid, and marks the street where spikes are about to burst up.
- **Extras:** score, time bonus, high score saved in the browser, and a title screen where the game plays itself.

## Code tour

| File | What it does |
| --- | --- |
| `src/game.js` | The world: spawns, combat, consume/disguise/alert rules, projectiles, checkpoints, boss arenas |
| `src/player.js` | Player movement, wall-running, powers and animation states |
| `src/enemies.js` | Infected, soldier, Hunter, gunship, Supreme Hunter and Behemoth behaviour |
| `src/level.js` | Seeded 3D city generator: districts, buildings, street props, arenas, spawns |
| `src/physics.js` | Box collision: sliding, landing on roofs, stepping up, wall contacts |
| `src/math.js` | Vector helpers, segment and ray tests |
| `src/render3d.js` | The 3D view: themes, sky, fog, lights, weather, characters, projectiles, effects |
| `src/world3d.js` | Static city meshes, merged for speed |
| `src/details3d.js` | Building trim, rooftop clutter, cars, lamps, street furniture and arena detail |
| `src/models.js` | Low-poly characters and their poses |
| `src/textures.js` | Procedural textures |
| `src/hud.js` | HUD and menus, drawn over the 3D view |
| `src/main.js` | Screens, the third-person camera, layout and the main loop |
| `src/audio.js` | Synthesized sound effects, four-track music sequencer, echo and reverb |
| `src/input.js` | Keyboard, mouse, gamepad and touch merged into actions, a movement stick and a camera look |
| `src/bot.js` | Autopilot for the title demo and testing |

The game logic doesn't use three.js or touch the DOM, so it runs headless. `npm test` runs 30 tests covering the city, movement and wall-running, combat, the blade, consume and disguise, death and respawn, both boss fights and the gate between them. One test runs the autopilot (made invulnerable) through every district and both bosses to the victory screen.

For screenshots and tuning, `?shot=play:300&x=600&yaw=0.5` starts a bot-driven game with the player at x = 600 m, fast-forwards 300 frames, turns the camera to that heading and draws a single frame.

## Legal

Inspired by *Prototype* (Activision, 2009). This project is not affiliated with or endorsed by Activision, and it uses no assets, names or characters from that game. The game title and hero name live in one place, `src/config.js`.
