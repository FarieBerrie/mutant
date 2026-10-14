// Characters drawn from rectangles in "local" coordinates: x grows in the direction the sprite
// faces, y is measured up from the feet (negative = up). That makes flipping and posing cheap.
//
// 32-bit look: a pose is collected first, then drawn in two passes: a 1-pixel dark outline
// around the whole silhouette, then each part with a top highlight and a bottom/right shadow.
import { DETAIL, PAL, shade } from './config.js';
import { ATTACKS } from './player.js';

const OUTLINE = '#0b0612';
const PX = 1 / DETAIL; // one screen pixel, in world units
const snapPx = (v) => Math.round(v * DETAIL) / DETAIL;

function painter(ctx, cx, footY, facing, { scale = 1, flash = false } = {}) {
  const rects = [];
  const r = (lx, ly, w, h, color) => {
    const x = facing >= 0 ? cx + lx * scale : cx - (lx + w) * scale;
    rects.push([snapPx(x), snapPx(footY + ly * scale), w * scale, h * scale, color]);
  };
  r.flush = () => {
    ctx.fillStyle = OUTLINE;
    for (const [x, y, w, h] of rects) ctx.fillRect(x - PX, y - PX, w + 2 * PX, h + 2 * PX);
    for (const [x, y, w, h, color] of rects) {
      if (flash) {
        ctx.fillStyle = PAL.white;
        ctx.fillRect(x, y, w, h);
        continue;
      }
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      if (h >= 1.5) {
        ctx.fillStyle = shade(color, 0.3);
        ctx.fillRect(x, y, w, PX);
      }
      if (h >= 2) {
        ctx.fillStyle = shade(color, -0.35);
        ctx.fillRect(x, y + h - PX, w, PX);
      }
      if (w >= 2.5 && h >= 2) {
        ctx.fillStyle = shade(color, -0.2);
        ctx.fillRect(x + w - PX, y + PX, PX, h - 2 * PX);
      }
    }
    rects.length = 0;
  };
  return r;
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
  } else if (atk && atk.power === 'blade') {
    const cleave = atk.index === 1;
    if (windup && !cleave) {
      // Drawn back behind the shoulder
      arm(-6, -19, 5, 3);
      bladeSegment(r, -18 + lean, -24, 12, 'back');
    } else if (windup) {
      // Raised overhead
      arm(-1, -31, 3, 13);
      r(-1 + lean, -45, 3, 14, PAL.redD);
      r(1 + lean, -45, 1, 13, PAL.grayL);
      r(0 + lean, -47, 2, 2, PAL.white);
    } else if (!cleave) {
      // Horizontal slash: the arm is one long blade
      arm(3, -17, 5, 3);
      bladeSegment(r, 8 + lean, -18, 24, 'forward');
    } else {
      // Cleave: swung down and forward
      arm(3, -22, 4, 6);
      for (let i = 0; i < 6; i++) {
        r(6 + lean + i * 4, -30 + i * 5, 5, 3, i % 2 ? PAL.redD : PAL.red);
        r(8 + lean + i * 4, -31 + i * 5, 3, 1, PAL.grayL);
      }
      r(30 + lean, -2, 2, 2, PAL.white);
    }
  } else if (p.power === 'blade') {
    // At rest the forearm is a bone blade, held low along the leg.
    const swing = p.anim === 'run' ? Math.round(-Math.sin(phase) * 2) : 0;
    arm(0 + swing, -16, 3, 6);
    r(1 + swing + lean, -11, 2, 11, PAL.redD);
    r(3 + swing + lean, -11, 1, 10, PAL.grayL);
    r(2 + swing + lean, 0, 1, 2, PAL.white);
  } else {
    const swing = p.anim === 'run' ? Math.round(-Math.sin(phase) * 2) : 0;
    arm(0 + swing, -16, 3, 7);
    r(0 + swing + lean, -10, 3, 2, PAL.skin);
  }
  r.flush();
}

/** A straight blade from (x, y): red bone with a pale cutting edge and a white point. */
function bladeSegment(r, x, y, len, dir) {
  const x0 = dir === 'back' ? x - len + 12 : x;
  r(x0, y, len, 3, PAL.redD);
  r(x0, y - 1, len, 1, PAL.grayL);
  r(x0 + 2, y + 1, len - 4, 1, PAL.red);
  if (dir === 'forward') r(x0 + len, y - 1, 3, 3, PAL.white);
  else r(x0 - 3, y - 1, 3, 3, PAL.white);
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
  r.flush();
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
  r.flush();
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
  r.flush();
  if (e.state === 'stunned') drawStunStars(ctx, cx, fy - 34, t);
}

export function drawBoss(ctx, e, cx, fy, t) {
  const pulse = e.phase === 3 && Math.floor(t / 6) % 2 === 0;
  const r = painter(ctx, cx, fy, e.facing, { scale: 1.4, flash: e.flash > 0 || pulse });
  hunterBody(r, e, { glow: true });
  r.flush();
  if (e.state === 'stunned') drawStunStars(ctx, cx, fy - 52, t);
}

// ------------------------------------------------------------------- The Behemoth

export function drawBehemoth(ctx, e, cx, fy, t) {
  const r = painter(ctx, cx, fy, e.facing, { scale: 2, flash: e.flash > 0 });
  const skin = '#4a2a26';
  const hide = '#2c1816';
  const plate = '#6a645a';
  const glow = e.phase === 3 ? (Math.floor(t / 5) % 2 ? '#ff3020' : '#ff7040') : '#ff8a30';
  const step = Math.abs(e.vx) > 0.2 ? Math.round(Math.sin(e.animT * 0.12) * 2) : 0;
  const crouch = e.state === 'pound' || e.state === 'spikes' ? 1 : 0;

  // Legs like pillars
  r(-9 + step, -8, 6, 8, hide);
  r(-10 + step, -2, 8, 2, PAL.ink);
  r(3 - step, -8, 6, 8, hide);
  r(3 - step, -2, 8, 2, PAL.ink);
  // Hunched body and the armour plates over its back
  r(-11, -21 + crouch, 22, 14, skin);
  r(-9, -11 + crouch, 18, 3, hide);
  r(-13, -24 + crouch, 10, 7, plate);
  r(-4, -25 + crouch, 10, 6, plate);
  r(4, -23 + crouch, 9, 6, plate);
  r(-13, -18 + crouch, 4, 6, plate);
  // Molten cracks between the plates
  r(-8, -17 + crouch, 1, 6, glow);
  r(-1, -16 + crouch, 1, 5, glow);
  r(5, -14 + crouch, 1, 4, glow);
  r(-4, -19 + crouch, 4, 1, glow);
  // Head, low and forward, with a heavy jaw
  const open = e.state === 'spit' ? 2 : 0;
  r(8, -20 + crouch, 7, 6, skin);
  r(8, -21 + crouch, 6, 2, plate);
  r(9, -14 + crouch + open, 7, 2, hide);
  r(10, -15 + crouch, 5, 1, PAL.white);
  if (open) r(10, -14 + crouch, 5, open, PAL.greenL);
  r(13, -18 + crouch, 2, 1, glow);
  // The great arm, by attack
  if (e.state === 'pound' || e.state === 'windup' || e.state === 'spikes') {
    r(4, -33, 7, 14, skin);
    r(3, -37, 9, 5, plate);
    r(5, -30, 1, 6, glow);
  } else if (e.state === 'swipe') {
    r(9, -17, 14, 6, skin);
    r(22, -18, 4, 8, plate);
    for (let i = 0; i < 3; i++) r(26, -18 + i * 3, 5, 1, PAL.white);
  } else {
    r(6, -15, 6, 12, skin);
    r(5, -4, 8, 3, plate);
    r(7, -12, 1, 5, glow);
  }
  r.flush();
  if (e.state === 'stunned') drawStunStars(ctx, cx, fy - 58, t);
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
  r.flush();
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
  } else if (pr.kind === 'acid') {
    ctx.fillStyle = PAL.green;
    ctx.fillRect(x, y, 6, 6);
    ctx.fillStyle = PAL.greenL;
    ctx.fillRect(x + 1, y + 1, 4, 3);
    ctx.fillStyle = PAL.white;
    ctx.fillRect(x + 1.5, y + 1, 1, 1);
  } else if (pr.kind === 'rock') {
    ctx.fillStyle = '#5a5650';
    ctx.fillRect(x, y + 1, 10, 8);
    ctx.fillRect(x + 1, y, 8, 10);
    ctx.fillStyle = '#8a857c';
    ctx.fillRect(x + 1, y + 1, 6, 4);
    ctx.fillStyle = '#3a3632';
    ctx.fillRect(x + 6, y + 6, 3, 3);
  } else if (pr.kind === 'spike') {
    const groundY = y + pr.h;
    if (pr.t < pr.warn) {
      // Warning: the street cracks and glows where the spike will come up
      const on = Math.floor(t / 4) % 2;
      ctx.fillStyle = on ? '#ff5030' : '#a02010';
      ctx.fillRect(x - 2, groundY - 1, pr.w + 4, 1);
      ctx.fillRect(x + 2, groundY - 2, 2, 1);
      ctx.fillRect(x + 8, groundY - 2, 2, 1);
    } else {
      const grow = Math.min(1, (pr.t - pr.warn + 1) / 5);
      const h = pr.h * grow;
      for (const [dx, k] of [[0, 0.7], [4, 1], [8, 0.6]]) {
        ctx.fillStyle = '#d8d0c0';
        ctx.fillRect(x + dx, groundY - h * k, 4, h * k);
        ctx.fillStyle = '#8a8070';
        ctx.fillRect(x + dx + 3, groundY - h * k, 1, h * k);
        ctx.fillStyle = PAL.white;
        ctx.fillRect(x + dx + 1, groundY - h * k, 2, 2);
      }
    }
  } else if (pr.kind === 'wave') {
    ctx.fillStyle = PAL.viralL;
    for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 3, y + 12 - (i % 2 ? 12 : 8), 2, i % 2 ? 12 : 8);
    ctx.fillStyle = PAL.white;
    ctx.fillRect(x + 4, y + 4, 2, 8);
  }
}
