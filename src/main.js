import { createAudio } from './audio.js';
import { createBot } from './bot.js';
import { GAME, HUD_H, HUD_W, PAL, STEP } from './config.js';
import { drawText } from './font.js';
import { Game } from './game.js';
import { CX, dim, drawHud, drawLogo, drawMenu, drawPanel } from './hud.js';
import { createInput } from './input.js';
import { boxesNear, groundHeight } from './level.js';
import { clamp, rayBox, turnToward } from './math.js';
import { createRenderer } from './render3d.js';

const HIGH_SCORE_KEY = 'mutant64.highscore';
const HUD_DETAIL = 2; // the HUD canvas has 2× the pixels of its 400×225 layout

const viewEl = document.getElementById('view');
const renderer = createRenderer(document.getElementById('screen'));
const hudCanvas = document.getElementById('hud');
hudCanvas.width = HUD_W * HUD_DETAIL;
hudCanvas.height = HUD_H * HUD_DETAIL;
const ctx = hudCanvas.getContext('2d');

const audio = createAudio();
const input = createInput({
  onFirstGesture: () => {
    audio.unlock();
    syncMusic();
  },
});
input.attachPointer(viewEl, { canLock: () => screen === 'play' && game?.mode === 'play' });
input.attachTouch(document.getElementById('touch'), viewEl);

let screen = 'title'; // title | howto | play | pause
let menuIndex = 0;
let game = null;
let demo = null;
let demoBot = null;
let t = 0;
let newHigh = false;

const readHigh = () => {
  try {
    return Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;
  } catch {
    return 0;
  }
};
let highScore = readHigh();

function saveHigh(score) {
  if (score <= highScore) return false;
  highScore = score;
  try {
    localStorage.setItem(HIGH_SCORE_KEY, String(score));
  } catch {
    /* not saved */
  }
  return true;
}

function startDemo() {
  demoBot = createBot();
  demo = new Game({ input: demoBot });
  demoBot.attach(demo);
}

function startGame() {
  game = new Game({ input, audio });
  screen = 'play';
  newHigh = false;
  cam.yaw = 0;
  cam.pitch = 0.3;
  audio.sfx('start');
}

function syncMusic() {
  if (screen === 'title' || screen === 'howto') audio.music('title');
  else if (screen === 'pause') audio.music(null);
  else if (game?.mode === 'victory') audio.music('victory');
  else if (game?.mode === 'dead') audio.music(null);
  else if (game?.bossActive) audio.music('boss');
  else audio.music('level');
}

const confirmPressed = () => input.pressed('start') || input.pressed('attack') || input.pressed('jump');
const menuUp = () => input.pressed('up') || input.pressed('camUp');
const menuDown = () => input.pressed('down') || input.pressed('camDown');

function menuNav(count) {
  if (menuUp()) {
    menuIndex = (menuIndex + count - 1) % count;
    audio.sfx('menu');
  }
  if (menuDown()) {
    menuIndex = (menuIndex + 1) % count;
    audio.sfx('menu');
  }
}

const titleItems = () => ['START GAME', 'HOW TO PLAY', `SOUND: ${audio.muted ? 'OFF' : 'ON'}`];
const pauseItems = ['RESUME', 'RESTART CHECKPOINT', 'QUIT TO TITLE'];

function pause() {
  screen = 'pause';
  menuIndex = 0;
  input.releasePointer();
  audio.sfx('pause');
}

// ------------------------------------------------------------------- camera

const cam = { yaw: 0, pitch: 0.3, dist: 7.5, idle: 0, position: { x: 0, y: 5, z: -8 }, target: { x: 0, y: 1.6, z: 0 }, ready: false };

/** Third-person camera: you steer it; when you leave it alone it drifts in behind you. */
function updateCamera(g, { orbit = false } = {}) {
  const p = g.player;
  if (orbit) {
    cam.yaw += 0.003;
    cam.pitch = 0.35;
  } else {
    const look = input.look();
    cam.yaw += look.x;
    cam.pitch = clamp(cam.pitch + look.y, -0.2, 1.25);
    const moving = Math.hypot(p.vx, p.vz) > 3;
    cam.idle = Math.abs(look.x) + Math.abs(look.y) > 1e-4 ? 0 : cam.idle + 1;
    if (cam.idle > 90 && moving && !p.wallRun && !p.attack) cam.yaw = turnToward(cam.yaw, Math.atan2(p.vz, p.vx), 0.012);
  }
  g.viewYaw = cam.yaw;

  const dist = orbit ? 11 : g.arenaLocked ? 10 : cam.dist;
  const target = { x: p.x, y: p.y + 1.6, z: p.z };
  const fx = Math.cos(cam.yaw);
  const fz = Math.sin(cam.yaw);
  const want = {
    x: target.x - fx * dist * Math.cos(cam.pitch),
    y: target.y + dist * Math.sin(cam.pitch),
    z: target.z - fz * dist * Math.cos(cam.pitch),
  };
  // Pull in if a wall is between the camera and the player.
  const dir = { x: want.x - target.x, y: want.y - target.y, z: want.z - target.z };
  let hit = 1;
  for (const b of boxesNear(g.level, Math.min(target.x, want.x) - 1, Math.max(target.x, want.x) + 1)) {
    if (b.removed) continue;
    hit = Math.min(hit, rayBox(target, dir, b));
  }
  if (hit < 1) {
    const k = Math.max(0.12, hit - 0.08);
    want.x = target.x + dir.x * k;
    want.y = target.y + dir.y * k;
    want.z = target.z + dir.z * k;
  }
  want.y = Math.max(want.y, groundHeight(g.level, want.x, want.z) + 0.4);

  const ease = cam.ready ? 0.3 : 1;
  for (const k of ['x', 'y', 'z']) {
    cam.position[k] += (want[k] - cam.position[k]) * ease;
    cam.target[k] += (target[k] - cam.target[k]) * (cam.ready ? 0.5 : 1);
  }
  cam.ready = true;
}

// ------------------------------------------------------------------- update

function tick() {
  t++;
  input.update();
  if (input.pressed('mute')) audio.toggleMute();

  if (screen === 'title') {
    demoBot.update();
    demo.update();
    if (demo.mode !== 'play' || demo.frame > 60 * 50) startDemo();
    menuNav(3);
    if (confirmPressed()) {
      if (menuIndex === 0) startGame();
      else if (menuIndex === 1) screen = 'howto';
      else audio.toggleMute();
      audio.sfx('select');
    }
  } else if (screen === 'howto') {
    demoBot.update();
    demo.update();
    if (confirmPressed() || input.pressed('pause')) {
      screen = 'title';
      audio.sfx('select');
    }
  } else if (screen === 'pause') {
    menuNav(pauseItems.length);
    if (input.pressed('pause')) screen = 'play';
    else if (confirmPressed()) {
      audio.sfx('select');
      if (menuIndex === 0) screen = 'play';
      else if (menuIndex === 1) {
        game.respawn();
        screen = 'play';
      } else {
        screen = 'title';
        menuIndex = 0;
      }
    }
  } else if (screen === 'play') {
    if (game.mode === 'play' && (input.pressed('pause') || input.pressed('start'))) {
      pause();
    } else {
      game.update();
      if (game.mode !== 'play') input.releasePointer();
      if (game.mode === 'dead' && game.modeT > 70 && confirmPressed()) game.respawn();
      if (game.mode === 'victory') {
        if (game.modeT === 1) newHigh = saveHigh(game.score);
        if (game.modeT > 150 && confirmPressed()) {
          screen = 'title';
          menuIndex = 0;
        }
      }
    }
  }
  const shown = screen === 'title' || screen === 'howto' ? demo : game;
  updateCamera(shown, { orbit: shown === demo });
  syncMusic();
}

// Losing the pointer lock (Esc, alt-tab) mid-fight pauses the game.
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && screen === 'play' && game?.mode === 'play') pause();
});

// ------------------------------------------------------------------- draw

const HOWTO = [
  ['MOVE', 'WASD / LEFT STICK'],
  ['CAMERA', 'MOUSE (CLICK) / ARROWS / R STICK'],
  ['JUMP', 'SPACE / Z  (AGAIN IN AIR)'],
  ['GLIDE', 'HOLD JUMP WHILE FALLING'],
  ['WALL RUN', 'RUN INTO ANY BUILDING'],
  ['ATTACK', 'LEFT CLICK / X / J'],
  ['CONSUME', 'RIGHT CLICK / C / L  HEALS YOU'],
  ['DASH', 'SHIFT'],
  ['POWERS', '1 FIST 2 CLAW 3 WHIP 5 BLADE'],
  ['', '4 ARMOR    Q / E  NEXT POWER'],
  ['SLAM', 'CLAWS: ATTACK IN MID-AIR'],
  ['DEVASTATOR', 'V WHEN MASS (MS) IS FULL'],
  ['PAUSE', 'P / ESC     MUTE  M'],
];

function drawTitle() {
  dim(ctx, 0.45);
  drawLogo(ctx, 24, t);
  drawMenu(ctx, titleItems(), menuIndex, 118, t);
  drawText(ctx, `HI-SCORE ${String(highScore).padStart(7, '0')}`, CX, 166, PAL.yellow, { align: 'center', shadow: PAL.black });
  drawText(ctx, `STARRING ${GAME.hero}`, CX, 196, PAL.grayL, { align: 'center', shadow: PAL.black });
  drawText(ctx, 'ENTER / START / TAP TO PLAY', CX, 208, Math.floor(t / 30) % 2 ? PAL.grayL : PAL.gray, { align: 'center', shadow: PAL.black });
}

function drawHowto() {
  dim(ctx, 0.7);
  drawPanel(ctx, 6, 6, HUD_W - 12, HUD_H - 12);
  drawText(ctx, 'HOW TO PLAY', CX, 14, PAL.redL, { align: 'center', scale: 2 });
  HOWTO.forEach(([k, v], i) => {
    drawText(ctx, k, CX - 150, 34 + i * 11, PAL.yellow);
    drawText(ctx, v, CX - 78, 34 + i * 11, PAL.white);
  });
  drawText(ctx, 'CONSUME A SOLDIER UNSEEN TO DISGUISE.', CX, 181, PAL.greenL, { align: 'center' });
  drawText(ctx, 'SUPERHUMAN MOVES NEAR SOLDIERS BLOW YOUR COVER.', CX, 191, PAL.grayL, { align: 'center' });
  drawText(ctx, 'GAMEPAD AND TOUCH WORK TOO', CX, 205, PAL.gray, { align: 'center' });
}

function drawPlay() {
  drawHud(ctx, game, t, renderer.project);
  if (game.mode === 'dead') {
    dim(ctx, Math.min(0.7, game.modeT / 60));
    if (game.modeT > 30) {
      drawText(ctx, 'YOU DIED', CX, 80, PAL.viralL, { align: 'center', scale: 3, shadow: PAL.black });
      drawText(ctx, `DEATHS ${game.deaths + 1}`, CX, 116, PAL.grayL, { align: 'center' });
      if (game.modeT > 70 && Math.floor(t / 20) % 2) drawText(ctx, 'PRESS START TO RETRY', CX, 140, PAL.white, { align: 'center' });
    }
  } else if (game.mode === 'victory') {
    dim(ctx, Math.min(0.75, game.modeT / 80));
    if (game.modeT > 40) drawVictory();
  }
  if (screen === 'pause') {
    dim(ctx, 0.6);
    drawPanel(ctx, CX - 80, 60, 160, 92);
    drawText(ctx, 'PAUSED', CX, 70, PAL.white, { align: 'center', scale: 2 });
    drawMenu(ctx, pauseItems, menuIndex, 98, t);
    drawText(ctx, `SOUND ${audio.muted ? 'OFF' : 'ON'} (M)`, CX, 138, PAL.gray, { align: 'center' });
  } else if (game.mode === 'play' && !input.pointerLocked && matchMedia('(pointer: fine)').matches && t % 60 < 40) {
    drawText(ctx, 'CLICK TO USE THE MOUSE FOR THE CAMERA', CX, HUD_H - (game.bossActive ? 32 : 12), PAL.grayL, { align: 'center', shadow: PAL.black });
  }
}

function drawVictory() {
  drawPanel(ctx, CX - 130, 24, 260, 176);
  drawText(ctx, 'THE CITY IS YOURS', CX, 36, PAL.yellow, { align: 'center', scale: 2, shadow: PAL.redD });
  const secs = Math.floor(game.frame / 60);
  const rows = [
    ['TIME', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`],
    ['DEFEATED', game.kills],
    ['CONSUMED', game.consumes],
    ['DEATHS', game.deaths],
    ['TIME BONUS', game.timeBonus],
    ['SCORE', game.score],
  ];
  rows.forEach(([k, v], i) => {
    drawText(ctx, k, CX - 110, 64 + i * 13, PAL.grayL);
    drawText(ctx, String(v), CX + 110, 64 + i * 13, PAL.white, { align: 'right' });
  });
  drawText(ctx, newHigh ? 'NEW HIGH SCORE!' : `HI-SCORE ${highScore}`, CX, 150, newHigh && Math.floor(t / 10) % 2 ? PAL.white : PAL.yellow, { align: 'center' });
  if (game.modeT > 150 && Math.floor(t / 20) % 2) drawText(ctx, 'PRESS START', CX, 180, PAL.white, { align: 'center' });
}

function draw() {
  const shown = screen === 'title' || screen === 'howto' ? demo : game;
  renderer.render(shown, cam, t);
  ctx.setTransform(HUD_DETAIL, 0, 0, HUD_DETAIL, 0, 0);
  ctx.clearRect(0, 0, HUD_W, HUD_H);
  if (screen === 'title') drawTitle();
  else if (screen === 'howto') drawHowto();
  else drawPlay();
}

// ------------------------------------------------------------------- layout & loop

function resize() {
  const touch = document.body.classList.contains('touch');
  const controls = touch ? document.getElementById('touch').offsetHeight : 0;
  const w = window.innerWidth;
  const h = Math.max(120, window.innerHeight - controls);
  viewEl.style.width = `${w}px`;
  viewEl.style.height = `${h}px`;
  renderer.resize(w, h);
}

const isTouch = window.matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', isTouch);
window.addEventListener('resize', resize);
resize();

viewEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' && screen === 'title' && menuIndex === 0) startGame();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'play' && game?.mode === 'play') pause();
  if (document.hidden) audio.music(null);
});

startDemo();

// ?shot=play:900&x=600 jumps straight into a bot-driven game and fast-forwards; handy for
// screenshots and tuning. x moves the player first; yaw turns the camera (radians).
const params = new URLSearchParams(location.search);
const shot = params.get('shot');
if (shot) {
  const [scene, frames] = shot.split(':');
  if (scene === 'play') {
    const bot = createBot();
    game = new Game({ input: bot });
    bot.attach(game);
    if (params.has('x')) {
      game.player.x = Number(params.get('x'));
      game.player.y = groundHeight(game.level, game.player.x, game.player.z, 0.4);
    }
    screen = 'play';
    for (let i = 0; i < Number(frames || 0); i++) {
      bot.update();
      game.update();
      cam.yaw = Number(params.get('yaw') ?? 0);
      updateCamera(game, { orbit: false });
    }
  } else {
    for (let i = 0; i < Number(frames || 0); i++) {
      demoBot.update();
      demo.update();
      updateCamera(demo, { orbit: true });
    }
    screen = scene === 'howto' ? 'howto' : 'title';
  }
  draw();
} else {
  let last = performance.now();
  let acc = 0;
  const frame = (now) => {
    acc += Math.min(100, now - last);
    last = now;
    while (acc >= STEP * 1000) {
      tick();
      acc -= STEP * 1000;
    }
    draw();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

document.title = `${GAME.title} ${GAME.subtitle}`;
