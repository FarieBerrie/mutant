import { createAudio } from './audio.js';
import { createBot } from './bot.js';
import { GAME, PAL, VIEW_H, VIEW_W } from './config.js';
import { drawText } from './font.js';
import { Game } from './game.js';
import { createInput } from './input.js';
import { dim, drawLogo, drawMenu, drawPanel, renderGame } from './render.js';

const STEP = 1000 / 60;
const HIGH_SCORE_KEY = 'mutant8.highscore';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
canvas.width = VIEW_W;
canvas.height = VIEW_H;
ctx.imageSmoothingEnabled = false;

const audio = createAudio();
const input = createInput({
  onFirstGesture: () => {
    audio.unlock();
    syncMusic();
  },
});
input.attachTouch(document.getElementById('touch'));

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

const confirmPressed = () => input.pressed('start') || input.pressed('attack') || (input.pressed('jump') && !input.down('up'));

function menuNav(count) {
  if (input.pressed('up') || input.pressed('left')) {
    menuIndex = (menuIndex + count - 1) % count;
    audio.sfx('menu');
  }
  if (input.pressed('down') || input.pressed('right')) {
    menuIndex = (menuIndex + 1) % count;
    audio.sfx('menu');
  }
}

const titleItems = () => ['START GAME', 'HOW TO PLAY', `SOUND: ${audio.muted ? 'OFF' : 'ON'}`];
const pauseItems = ['RESUME', 'RESTART CHECKPOINT', 'QUIT TO TITLE'];

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
      screen = 'pause';
      menuIndex = 0;
      audio.sfx('pause');
    } else {
      game.update();
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
  syncMusic();
}

// ------------------------------------------------------------------- draw

const HOWTO = [
  ['MOVE', 'ARROWS / WASD'],
  ['JUMP', 'Z / SPACE (AGAIN IN AIR)'],
  ['GLIDE', 'HOLD JUMP WHILE FALLING'],
  ['WALL RUN', 'RUN INTO ANY BUILDING'],
  ['ATTACK', 'X / J'],
  ['CONSUME', 'C / L  HEALS YOU'],
  ['DASH', 'SHIFT'],
  ['POWERS', '1 FIST 2 CLAW 3 WHIP 4 ARMOR'],
  ['', 'Q / E  NEXT POWER'],
  ['SLAM', 'CLAWS: DOWN+ATTACK IN AIR'],
  ['DEVASTATE', 'V WHEN MASS (MS) IS FULL'],
  ['PAUSE', 'P / ESC     MUTE  M'],
];

function drawTitle() {
  renderGame(ctx, demo, t, { hud: false });
  dim(ctx, 0.62);
  drawLogo(ctx, 30, t);
  drawMenu(ctx, titleItems(), menuIndex, 112, t);
  drawText(ctx, `HI-SCORE ${String(highScore).padStart(7, '0')}`, 128, 162, PAL.yellow, { align: 'center', shadow: PAL.black });
  drawText(ctx, `STARRING ${GAME.hero}`, 128, 196, PAL.grayL, { align: 'center', shadow: PAL.black });
  drawText(ctx, 'ENTER / START / TAP TO PLAY', 128, 208, Math.floor(t / 30) % 2 ? PAL.grayL : PAL.gray, { align: 'center' });
}

function drawHowto() {
  renderGame(ctx, demo, t, { hud: false });
  dim(ctx, 0.8);
  drawPanel(ctx, 6, 6, VIEW_W - 12, VIEW_H - 12);
  drawText(ctx, 'HOW TO PLAY', 128, 14, PAL.redL, { align: 'center', scale: 2 });
  HOWTO.forEach(([k, v], i) => {
    drawText(ctx, k, 14, 36 + i * 11, PAL.yellow);
    drawText(ctx, v, 76, 36 + i * 11, PAL.white);
  });
  drawText(ctx, 'CONSUME A SOLDIER UNSEEN TO DISGUISE.', 128, 172, PAL.greenL, { align: 'center' });
  drawText(ctx, 'SUPERHUMAN MOVES NEAR SOLDIERS', 128, 182, PAL.grayL, { align: 'center' });
  drawText(ctx, 'WILL BLOW YOUR COVER.', 128, 192, PAL.grayL, { align: 'center' });
  drawText(ctx, 'GAMEPAD AND TOUCH WORK TOO', 128, 206, PAL.gray, { align: 'center' });
}

function drawPlay() {
  renderGame(ctx, game, t);
  if (game.mode === 'dead') {
    dim(ctx, Math.min(0.7, game.modeT / 60));
    if (game.modeT > 30) {
      drawText(ctx, 'YOU DIED', 128, 80, PAL.viralL, { align: 'center', scale: 3, shadow: PAL.black });
      drawText(ctx, `DEATHS ${game.deaths + 1}`, 128, 116, PAL.grayL, { align: 'center' });
      if (game.modeT > 70 && Math.floor(t / 20) % 2) drawText(ctx, 'PRESS START TO RETRY', 128, 140, PAL.white, { align: 'center' });
    }
  } else if (game.mode === 'victory') {
    dim(ctx, Math.min(0.75, game.modeT / 80));
    if (game.modeT > 40) drawVictory();
  }
  if (screen === 'pause') {
    dim(ctx, 0.6);
    drawPanel(ctx, 48, 60, 160, 92);
    drawText(ctx, 'PAUSED', 128, 70, PAL.white, { align: 'center', scale: 2 });
    drawMenu(ctx, pauseItems, menuIndex, 98, t);
    drawText(ctx, `SOUND ${audio.muted ? 'OFF' : 'ON'} (M)`, 128, 138, PAL.gray, { align: 'center' });
  }
}

function drawVictory() {
  drawPanel(ctx, 20, 24, VIEW_W - 40, 176);
  drawText(ctx, 'THE HIVE FALLS', 128, 36, PAL.yellow, { align: 'center', scale: 2, shadow: PAL.redD });
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
    drawText(ctx, k, 40, 64 + i * 13, PAL.grayL);
    drawText(ctx, String(v), 216, 64 + i * 13, PAL.white, { align: 'right' });
  });
  drawText(ctx, newHigh ? 'NEW HIGH SCORE!' : `HI-SCORE ${highScore}`, 128, 150, newHigh && Math.floor(t / 10) % 2 ? PAL.white : PAL.yellow, { align: 'center' });
  if (game.modeT > 150 && Math.floor(t / 20) % 2) drawText(ctx, 'PRESS START', 128, 180, PAL.white, { align: 'center' });
}

function draw() {
  if (screen === 'title') drawTitle();
  else if (screen === 'howto') drawHowto();
  else drawPlay();
}

// ------------------------------------------------------------------- layout & loop

function resize() {
  const touch = document.body.classList.contains('touch');
  const availH = window.innerHeight - (touch ? Math.min(220, window.innerHeight * 0.38) : 0);
  let scale = Math.min(window.innerWidth / VIEW_W, availH / VIEW_H);
  if (scale >= 1) scale = Math.floor(scale); // whole-pixel scaling keeps pixels square
  canvas.style.width = `${Math.floor(VIEW_W * scale)}px`;
  canvas.style.height = `${Math.floor(VIEW_H * scale)}px`;
}

const isTouch = window.matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', isTouch);
window.addEventListener('resize', resize);
resize();

canvas.addEventListener('pointerdown', () => {
  if (screen === 'title' && menuIndex === 0) startGame();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'play' && game?.mode === 'play') {
    screen = 'pause';
    menuIndex = 0;
  }
  if (document.hidden) audio.music(null);
});

startDemo();

// ?shot=play:900&x=3700 jumps straight into a bot-driven game and fast-forwards; handy for
// screenshots and tuning. x moves the player before simulating.
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
      game.camera.x = Math.max(0, game.player.x - 100);
    }
    screen = 'play';
    for (let i = 0; i < Number(frames || 0); i++) {
      bot.update();
      game.update();
    }
  } else {
    for (let i = 0; i < Number(frames || 0); i++) {
      demoBot.update();
      demo.update();
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
    while (acc >= STEP) {
      tick();
      acc -= STEP;
    }
    draw();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

document.title = `${GAME.title} ${GAME.subtitle}`;
