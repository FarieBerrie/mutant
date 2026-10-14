// Moves bodies through the city's boxes. A body is a vertical box: feet at (x, y, z), half-width
// r, height h, velocity (vx, vy, vz) in metres per second.
import { boxesNear } from './level.js';

const EPS = 0.001;
const STEP_UP = 0.45; // ledges this low are stepped onto rather than blocking

export const centerY = (b) => b.y + b.h / 2;
export const chest = (b) => ({ x: b.x, y: b.y + b.h * 0.6, z: b.z });

/**
 * One step of movement, one axis at a time. Sets onGround, ground (the box underneath, or null
 * for the street), hitWall ({ nx, nz, box } facing out of the wall, or null) and hitCeiling.
 */
export function moveBody(level, b, dt) {
  const wasOnGround = b.onGround;
  b.hitWall = null;
  b.hitCeiling = false;
  const reach = b.r + Math.abs(b.vx * dt) + 1;
  const boxes = boxesNear(level, b.x - reach, b.x + reach);

  const overlapsY = (box) => b.y < box.y1 - EPS && b.y + b.h > box.y0 + EPS;
  const overlapsX = (box) => b.x + b.r > box.x0 && b.x - b.r < box.x1;
  const overlapsZ = (box) => b.z + b.r > box.z0 && b.z - b.r < box.z1;

  // A low ledge in the way is climbed instead of blocking (kerbs, car bonnets when landing).
  const stepUp = (box) => {
    if (!wasOnGround || box.y1 - b.y > STEP_UP || box.y1 - b.y <= 0) return false;
    b.y = box.y1;
    return true;
  };

  b.x += b.vx * dt;
  for (const box of boxes) {
    if (!overlapsY(box) || !overlapsZ(box) || !overlapsX(box)) continue;
    if (stepUp(box)) continue;
    if (b.vx > 0) {
      b.x = box.x0 - b.r - EPS;
      b.hitWall = { nx: -1, nz: 0, box };
    } else if (b.vx < 0) {
      b.x = box.x1 + b.r + EPS;
      b.hitWall = { nx: 1, nz: 0, box };
    }
    b.vx = 0;
  }

  b.z += b.vz * dt;
  for (const box of boxes) {
    if (!overlapsY(box) || !overlapsX(box) || !overlapsZ(box)) continue;
    if (stepUp(box)) continue;
    if (b.vz > 0) {
      b.z = box.z0 - b.r - EPS;
      b.hitWall = { nx: 0, nz: -1, box };
    } else if (b.vz < 0) {
      b.z = box.z1 + b.r + EPS;
      b.hitWall = { nx: 0, nz: 1, box };
    }
    b.vz = 0;
  }

  const prevY = b.y;
  b.y += b.vy * dt;
  b.onGround = false;
  b.ground = null;
  if (b.vy <= 0) {
    // Land on the highest surface we passed through on the way down.
    let top = 0;
    let ground = null;
    for (const box of boxes) {
      if (!overlapsX(box) || !overlapsZ(box)) continue;
      if (box.y1 <= prevY + EPS && box.y1 >= b.y - EPS && box.y1 >= top) {
        top = box.y1;
        ground = box;
      }
    }
    if (b.y <= top) {
      b.y = top;
      b.vy = 0;
      b.onGround = true;
      b.ground = ground;
    }
  } else {
    for (const box of boxes) {
      if (!overlapsX(box) || !overlapsZ(box)) continue;
      if (b.y + b.h > box.y0 && prevY + b.h <= box.y0 + EPS) {
        b.y = box.y0 - b.h;
        b.vy = 0;
        b.hitCeiling = true;
      }
    }
  }

  // The edges of the city: invisible walls you can't climb.
  const W = level.halfWidth - b.r;
  if (b.z > W) {
    b.z = W;
    b.vz = Math.min(0, b.vz);
  } else if (b.z < -W) {
    b.z = -W;
    b.vz = Math.max(0, b.vz);
  }
  if (b.x < b.r) {
    b.x = b.r;
    b.vx = Math.max(0, b.vx);
  } else if (b.x > level.length - b.r) {
    b.x = level.length - b.r;
    b.vx = Math.min(0, b.vx);
  }
}
