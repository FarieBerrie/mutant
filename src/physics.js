import { TILE } from './config.js';
import { isLedge, isSolid, tileAt } from './level.js';

const EPS = 0.001;

/**
 * Moves a body {x, y, w, h, vx, vy} through the tile map, one axis at a time.
 * Sets onGround, hitWall (-1/0/1) and hitCeiling. One-way ledges only stop a body falling onto
 * them from above, and not while `dropThrough` is set.
 */
export function moveBody(level, b) {
  b.hitWall = 0;
  b.hitCeiling = false;

  // Horizontal
  b.x += b.vx;
  const r0 = Math.floor(b.y / TILE);
  const r1 = Math.floor((b.y + b.h - EPS) / TILE);
  if (b.vx > 0) {
    const c = Math.floor((b.x + b.w - EPS) / TILE);
    for (let r = r0; r <= r1; r++) {
      if (isSolid(tileAt(level, c, r))) {
        b.x = c * TILE - b.w;
        b.vx = 0;
        b.hitWall = 1;
        break;
      }
    }
  } else if (b.vx < 0) {
    const c = Math.floor(b.x / TILE);
    for (let r = r0; r <= r1; r++) {
      if (isSolid(tileAt(level, c, r))) {
        b.x = (c + 1) * TILE;
        b.vx = 0;
        b.hitWall = -1;
        break;
      }
    }
  }

  // Vertical
  const prevBottom = b.y + b.h;
  b.y += b.vy;
  b.onGround = false;
  const c0 = Math.floor(b.x / TILE);
  const c1 = Math.floor((b.x + b.w - EPS) / TILE);
  if (b.vy > 0) {
    const r = Math.floor((b.y + b.h - EPS) / TILE);
    for (let c = c0; c <= c1; c++) {
      const t = tileAt(level, c, r);
      const ledgeLanding = isLedge(t) && !b.dropThrough && prevBottom <= r * TILE + EPS;
      if (isSolid(t) || ledgeLanding) {
        b.y = r * TILE - b.h;
        b.vy = 0;
        b.onGround = true;
        break;
      }
    }
  } else if (b.vy < 0) {
    const r = Math.floor(b.y / TILE);
    for (let c = c0; c <= c1; c++) {
      if (isSolid(tileAt(level, c, r))) {
        b.y = (r + 1) * TILE;
        b.vy = 0;
        b.hitCeiling = true;
        break;
      }
    }
  }

  // Standing still on the ground still counts as grounded.
  if (!b.onGround && b.vy === 0) b.onGround = standingOn(level, b);
  return b;
}

export function standingOn(level, b) {
  const r = Math.floor((b.y + b.h + EPS) / TILE);
  if ((b.y + b.h) % TILE > EPS && TILE - ((b.y + b.h) % TILE) > EPS) return false;
  const c0 = Math.floor(b.x / TILE);
  const c1 = Math.floor((b.x + b.w - EPS) / TILE);
  for (let c = c0; c <= c1; c++) {
    const t = tileAt(level, c, r);
    if (isSolid(t) || (isLedge(t) && !b.dropThrough)) return true;
  }
  return false;
}

/** Is there a solid wall directly beside the body (dir = -1 left, 1 right) at its middle? */
export function wallBeside(level, b, dir) {
  const x = dir > 0 ? b.x + b.w + 1 : b.x - 1;
  const c = Math.floor(x / TILE);
  const top = Math.floor((b.y + 4) / TILE);
  const bottom = Math.floor((b.y + b.h - 4) / TILE);
  for (let r = top; r <= bottom; r++) if (isSolid(tileAt(level, c, r))) return true;
  return false;
}

export const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const centerX = (b) => b.x + b.w / 2;
export const centerY = (b) => b.y + b.h / 2;
