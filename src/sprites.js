// Characters drawn from rectangles in "local" coordinates: x grows in the direction the sprite
// faces, y is measured up from the feet (negative = up). That makes flipping and posing cheap.
import { PAL } from './config.js';
import { ATTACKS } from './player.js';

function painter(ctx, cx, footY, facing, { scale = 1, flash = false } = {}) {
  return (lx, ly, w, h, color) => {
    ctx.fillStyle = flash ? PAL.white : color;
    const x = facing >= 0 ? cx + lx * scale : cx - (lx + w) * scale;
    ctx.fillRect(Math.round(x), Math.round(footY + ly * scale), Math.ceil(w * scale), Math.ceil(h * scale));
  };
}

function legs(r, { phase = 0, pose = 'stand', pants = PAL.jean, boots = PAL.black }) {
  if (pose === 'run') {
    const s = Math.sin(phase);
    const a = Math.round(s * 4);
    const liftA = s > 0.3 ? 2 : 0;
    const liftB = s < -0.3 ? 2 : 0;
    r(-2 + a, -9 - liftA, 3, 8, pants);
    r(-2 + a, -2 - liftA, 4, 2, boots);
    r(-1 - a, -9 - liftB, 3, 8, pants);
    r(-1 - a, -2 - liftB, 4, 2, boots);
  } else if (pose === 'jump') {
    r(-4, -10, 3, 6, pants);
    r(-4, -5, 4, 2, boots);
    r(1, -9, 3, 5, pants);
    r(2, -5, 4, 2, boots);
  } else if (pose === 'spread') {
    r(-5, -9, 3, 8, pants);
    r(-6, -2, 4, 2, boots);
    r(2, -9, 3, 8, pants);
    r(2, -2, 4, 2, boots);
  } else {
    r(-4, -9, 3, 8, pants);
    r(-4, -2, 4, 2, boots);
    r(1, -9, 3, 8, pants);
    r(1, -2, 4, 2, boots);
  }
}

// ------------------------------------------------------------------- Hero

export function drawHero(ctx, p, cx, fy, t) {
  if (p.disguised && p.anim !== 'dev') {
    drawSoldier(ctx, { facing: p.facing, animT: p.animT, state: p.attack ? 'aim' : Math.abs(p.vx) > 0.3 ? 'patrol' : 'idle', vx: p.vx, flash: 0 }, cx, fy, t, { disguise: true });
    return;
  }
  const flash = p.hurt > 10;
  const r = painter(ctx, cx, fy, p.facing, { flash });
  const jacket = p.armor ? PAL.grayD : PAL.ink;
  const hood = p.armor ? PAL.grayD : PAL.gray;
  const phase = p.animT * 0.35;
  const atk = p.attack;
  const atkDef = atk && ATTACKS[atk.power][atk.index];
  const active = atk && atk.t >= atkDef.from && atk.t <= atkDef.to;
  const windup = atk && atk.t < atkDef.from;

  // Back arm (behind the body)
  if (p.anim === 'glide' || p.anim === 'dev') r(-12, -16, 8, 3, jacket);
  else r(-6, -16, 3, 7, jacket);

  // Legs
  const legPose = { run: 'run', wall: 'run', jump: 'jump', dash: 'jump', glide: 'spread', dev: 'spread', slam: 'jump' }[p.anim] || 'stand';
  legs(r, { phase: p.anim === 'wall' ? phase * 1.4 : phase, pose: legPose });

  // Torso, leaning into a dash or a wall run
  const lean = p.anim === 'dash' || p.anim === 'wall' ? 2 : 0;
  r(-4 + lean, -18, 9, 10, jacket);
  r(2 + lean, -17, 2, 8, PAL.grayL); // hoodie front
  r(-4 + lean, -18, 3, 2, PAL.red); // red stripe on the shoulder
  r(-4 + lean, -10, 9, 1, PAL.grayD); // jacket hem
  if (p.armor) {
    r(-5 + lean, -19, 3, 3, PAL.gray);
    r(-6 + lean, -21, 1, 2, PAL.grayL);
    r(-3 + lean, -14, 7, 1, PAL.black);
    r(-3 + lean, -12, 7, 1, PAL.black);
  }

  // Hood and head
  r(-4 + lean, -25, 8, 7, hood);
  r(-3 + lean, -25, 5, 1, p.armor ? PAL.gray : PAL.grayL);
  r(1 + lean, -23, 3, 5, PAL.black);
  r(2 + lean, -21, 2, 2, PAL.skinD);
  if (p.anim === 'dev' || (p.attack && p.power !== 'fists')) r(3 + lean, -21, 1, 1, PAL.viralL); // glowing eye

  // Front arm, by pose
  const arm = (x, y, w, h) => r(x + lean, y, w, h, jacket);
  if (p.anim === 'consume') {
    arm(3, -16, 5, 3);
    r(8, -17, 6, 5, PAL.viral);
  } else if (p.anim === 'glide' || p.anim === 'dev') {
    arm(3, -16, 9, 3);
    r(-12, -15, 24, 1, PAL.red);
  } else if (p.anim === 'slam') {
    arm(-1, -30, 3, 12);
    r(-3, -2, 9, 2, PAL.viral);
    r(-2, 0, 2, 3, PAL.red);
    r(2, 0, 2, 3, PAL.red);
  } else if (atk && atk.power === 'fists') {
    if (atk.index === 2 && (active || windup)) {
      arm(2, active ? -30 : -18, 3, active ? 13 : 8);
      r(2, active ? -33 : -11, 4, 4, PAL.skin);
    } else if (active) {
      arm(3, -16, 8, 3);
      r(11, -17, 4, 4, PAL.skin);
    } else {
      arm(-6, -16, 4, 3);
      r(-8, -16, 3, 3, PAL.skin);
    }
  } else if (atk && atk.power === 'claws') {
    if (windup) {
      arm(-2, -28, 4, 10);
      r(-3, -32, 2, 5, PAL.red);
      r(0, -33, 2, 6, PAL.red);
    } else {
      arm(2, -17, 6, 4);
      for (let i = 0; i < 3; i++) {
        r(7 + i, -24 + i * 4, 11 - i, 2, i % 2 ? PAL.redD : PAL.red);
        r(16 - i, -23 + i * 4, 3, 1, PAL.white);
      }
    }
  } else if (atk && atk.power === 'whip') {
    if (windup) {
      arm(-7, -17, 6, 3);
      r(-11, -18, 4, 5, PAL.redD);
    } else {
      const len = active ? Math.min(64, (atk.t - atkDef.from + 1) * 12) : 20;
      arm(3, -16, 4, 3);
      for (let x = 0; x < len; x += 4) r(7 + x, -15 + ((x / 4) % 2), 4, 3, (x / 4) % 2 ? PAL.redD : PAL.red);
      r(7 + len, -17, 4, 6, PAL.grayL);
      r(11 + len, -16, 2, 4, PAL.white);
    }
  } else {
    const swing = p.anim === 'run' ? Math.round(-Math.sin(phase) * 2) : 0;
    arm(0 + swing, -16, 3, 7);
    r(0 + swing + lean, -10, 3, 2, PAL.skin);
  }
}

// ------------------------------------------------------------------- Military

export function drawSoldier(ctx, e, cx, fy, t, { disguise = false } = {}) {
  const r = painter(ctx, cx, fy, e.facing, { flash: e.flash > 0 });
  const phase = e.animT * 0.25;
  const moving = Math.abs(e.vx) > 0.2;
  legs(r, { phase, pose: moving ? 'run' : 'stand', pants: PAL.oliveD, boots: PAL.ink });
  r(-4, -18, 9, 10, PAL.olive);
  r(-2, -17, 5, 6, PAL.oliveD); // vest
  r(-4, -10, 9, 1, PAL.ink); // belt
  // Helmet and gas mask
  r(-4, -25, 8, 3, PAL.oliveD);
  r(-5, -23, 10, 1, PAL.oliveD);
  r(-2, -22, 6, 4, PAL.grayD);
  r(2, -21, 2, 1, disguise ? PAL.viralL : PAL.redL);
  r(3, -19, 2, 2, PAL.ink); // filter
  // Rifle
  if (e.state === 'aim') {
    r(0, -16, 4, 3, PAL.olive);
    r(1, -15, 12, 2, PAL.ink);
    r(-1, -14, 3, 3, PAL.ink);
    if (e.muzzle > 0) r(13, -16, 3, 4, PAL.yellow);
  } else {
    r(-1, -16, 3, 7, PAL.olive);
    r(-2, -13, 9, 2, PAL.ink);
  }
}

// ------------------------------------------------------------------- Infected

export function drawInfected(ctx, e, cx, fy) {
  const r = painter(ctx, cx, fy, e.facing, { flash: e.flash > 0 });
  const phase = e.animT * 0.18 * (e.speed || 1);
  legs(r, { phase, pose: Math.abs(e.vx) > 0.15 ? 'run' : 'stand', pants: PAL.jeanD, boots: PAL.zombieD });
  r(-4, -16, 8, 8, PAL.grayD); // torn shirt
  r(-3, -12, 2, 3, PAL.zombie);
  r(1, -15, 2, 2, PAL.redD);
  // Hunched head
  r(0, -21, 7, 6, PAL.zombie);
  r(5, -19, 1, 1, PAL.viralL);
  r(3, -16, 4, 1, PAL.redD);
  r(0, -21, 3, 2, PAL.zombieD);
  // Arms reach forward; raised when about to lunge
  const raise = e.state === 'windup' ? -5 : 0;
  const reach = e.state === 'lunge' ? 4 : 0;
  r(2, -14 + raise, 7 + reach, 2, PAL.zombie);
  r(1, -11 + raise, 6 + reach, 2, PAL.zombieD);
}

// ------------------------------------------------------------------- Hunters

function hunterBody(r, e, { glow }) {
  const phase = e.animT * 0.2;
  const step = Math.abs(e.vx) > 0.3 ? Math.round(Math.sin(phase) * 3) : 0;
  const skin = glow ? PAL.magenta : PAL.redD;
  const muscle = glow ? PAL.purple : PAL.viral;
  // Legs
  r(-6 + step, -10, 5, 9, skin);
  r(-7 + step, -2, 6, 2, PAL.ink);
  r(1 - step, -10, 5, 9, skin);
  r(1 - step, -2, 6, 2, PAL.ink);
  // Torso
  r(-8, -24, 15, 14, skin);
  r(-6, -22, 11, 4, muscle);
  r(-5, -16, 9, 2, muscle);
  // Spine spikes
  for (let i = 0; i < 4; i++) r(-10, -24 + i * 4, 2, 2, PAL.grayL);
  // Head with teeth
  r(4, -28, 8, 7, skin);
  r(6, -23, 6, 1, PAL.white);
  r(10, -26, 1, 1, glow ? PAL.yellow : PAL.viralL);
  // Arm and bone claws, by state
  if (e.state === 'windup' || e.state === 'chargeWindup') {
    r(-2, -36, 6, 14, skin);
    for (let i = 0; i < 3; i++) r(-2 + i * 2, -41, 1, 5, PAL.white);
  } else if (e.state === 'swipe') {
    r(5, -20, 14, 5, skin);
    for (let i = 0; i < 3; i++) r(19, -22 + i * 3, 6, 1, PAL.white);
  } else {
    r(4, -20, 5, 15, skin);
    for (let i = 0; i < 3; i++) r(5 + i * 2, -5, 1, 4, PAL.white);
  }
}

export function drawHunter(ctx, e, cx, fy, t) {
  const r = painter(ctx, cx, fy, e.facing, { flash: e.flash > 0 });
  hunterBody(r, e, { glow: false });
  if (e.state === 'stunned') drawStunStars(ctx, cx, fy - 34, t);
}

export function drawBoss(ctx, e, cx, fy, t) {
  const pulse = e.phase === 3 && Math.floor(t / 6) % 2 === 0;
  const r = painter(ctx, cx, fy, e.facing, { scale: 1.4, flash: e.flash > 0 || pulse });
  hunterBody(r, e, { glow: true });
  if (e.state === 'stunned') drawStunStars(ctx, cx, fy - 52, t);
}

function drawStunStars(ctx, cx, y, t) {
  for (let i = 0; i < 3; i++) {
    const a = t / 10 + (i * Math.PI * 2) / 3;
    ctx.fillStyle = i % 2 ? PAL.yellow : PAL.white;
    ctx.fillRect(Math.round(cx + Math.cos(a) * 10), Math.round(y + Math.sin(a) * 3), 2, 2);
  }
}

// ------------------------------------------------------------------- Gunship

export function drawHeli(ctx, e, cx, fy, t) {
  const r = painter(ctx, cx, fy, e.facing, { flash: e.flash > 0 });
  r(-26, -12, 16, 3, PAL.oliveD); // tail boom
  r(-28, -16, 3, 8, PAL.oliveD); // tail fin
  r(-29, -15 + (Math.floor(t / 2) % 2) * 4, 5, 1, PAL.grayL); // tail rotor
  r(-12, -15, 22, 10, PAL.olive);
  r(-12, -7, 22, 2, PAL.oliveD);
  r(4, -14, 7, 6, PAL.blueL); // cockpit
  r(5, -13, 3, 2, PAL.white);
  r(-8, -9, 6, 3, PAL.ink); // missile pod
  r(-12, -3, 22, 1, PAL.ink); // skids
  r(-8, -4, 1, 2, PAL.ink);
  r(6, -4, 1, 2, PAL.ink);
  const blade = Math.floor(t / 2) % 2 ? 40 : 14;
  r(-blade / 2, -18, blade, 1, PAL.grayL);
  r(-1, -17, 2, 2, PAL.ink);
  if (Math.floor(t / 20) % 2) r(-12, -15, 2, 2, PAL.red);
}

// ------------------------------------------------------------------- Projectiles

export function drawProjectile(ctx, pr, x, y, t) {
  if (pr.kind === 'bullet') {
    ctx.fillStyle = PAL.yellowL;
    ctx.fillRect(x, y, 4, 2);
  } else if (pr.kind === 'rocket') {
    ctx.fillStyle = PAL.grayL;
    ctx.fillRect(x, y, 6, 3);
    ctx.fillStyle = Math.floor(t / 2) % 2 ? PAL.yellow : PAL.orange;
    ctx.fillRect(pr.vx > 0 ? x - 3 : x + 6, y, 3, 3);
  } else if (pr.kind === 'wave') {
    ctx.fillStyle = PAL.viralL;
    for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 3, y + 12 - (i % 2 ? 12 : 8), 2, i % 2 ? 12 : 8);
    ctx.fillStyle = PAL.white;
    ctx.fillRect(x + 4, y + 4, 2, 8);
  }
}
