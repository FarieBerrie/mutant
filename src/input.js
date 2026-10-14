// Keyboard, mouse, gamepad and touch, merged into one set of named actions, a movement stick and
// a camera "look" delta. Call update() once per game frame; pressed(a) is true only on the frame
// a button went down.

const KEYS = {
  KeyW: ['up'],
  KeyS: ['down'],
  KeyA: ['left'],
  KeyD: ['right'],
  ArrowUp: ['camUp'],
  ArrowDown: ['camDown'],
  ArrowLeft: ['camLeft'],
  ArrowRight: ['camRight'],
  KeyZ: ['jump'],
  Space: ['jump'],
  KeyK: ['jump'],
  KeyX: ['attack'],
  KeyJ: ['attack'],
  KeyC: ['consume'],
  KeyL: ['consume'],
  ShiftLeft: ['dash'],
  ShiftRight: ['dash'],
  Semicolon: ['dash'],
  KeyV: ['dev'],
  KeyU: ['dev'],
  Digit1: ['p1'],
  Digit2: ['p2'],
  Digit3: ['p3'],
  Digit4: ['p4'],
  Digit5: ['p5'],
  KeyQ: ['cycle'],
  KeyE: ['cycle'],
  Enter: ['start'],
  KeyP: ['pause'],
  Escape: ['pause'],
  KeyM: ['mute'],
};

// Standard gamepad layout
const PAD_BUTTONS = { 0: 'jump', 2: 'attack', 1: 'consume', 3: 'dev', 5: 'dash', 7: 'dash', 4: 'cycle', 6: 'p4', 9: 'start', 8: 'pause', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const DEADZONE = 0.2;
const MOUSE_SENSITIVITY = 0.0028;
const KEY_TURN = 0.045;
const PAD_TURN = 0.06;
const TOUCH_TURN = 0.008;

export const TOUCH_BUTTONS = [
  { action: 'jump', label: 'A', title: 'Jump', area: 'face' },
  { action: 'attack', label: 'B', title: 'Attack', area: 'face' },
  { action: 'consume', label: 'C', title: 'Consume', area: 'face' },
  { action: 'dash', label: 'DASH', area: 'face' },
  { action: 'cycle', label: 'PWR', title: 'Next power', area: 'top' },
  { action: 'p4', label: 'ARMR', title: 'Armor', area: 'top' },
  { action: 'dev', label: 'DEV', title: 'Devastator', area: 'top' },
  { action: 'pause', label: '❚❚', title: 'Pause', area: 'top' },
];

const dead = (v) => (Math.abs(v) < DEADZONE ? 0 : v);

export function createInput({ onFirstGesture } = {}) {
  const keyDown = new Set();
  const mouseDown = new Set();
  const touchDown = new Set();
  let padDown = new Set();
  let current = new Set();
  let previous = new Set();
  let gestured = false;
  const padStick = { x: 0, y: 0 };
  const padLook = { x: 0, y: 0 };
  const touchStick = { x: 0, y: 0 };
  const mouseLook = { x: 0, y: 0 };
  const touchLook = { x: 0, y: 0 };
  let look = { x: 0, y: 0 };
  let pointerTarget = null;

  const gesture = () => {
    if (!gestured) {
      gestured = true;
      onFirstGesture?.();
    }
  };

  window.addEventListener('keydown', (e) => {
    const actions = KEYS[e.code];
    if (!actions) return;
    if (!e.ctrlKey && !e.metaKey) e.preventDefault();
    gesture();
    actions.forEach((a) => keyDown.add(a));
  });
  window.addEventListener('keyup', (e) => KEYS[e.code]?.forEach((a) => keyDown.delete(a)));
  window.addEventListener('blur', () => {
    keyDown.clear();
    mouseDown.clear();
    touchDown.clear();
  });
  window.addEventListener('pointerdown', gesture);

  function pollPads() {
    padDown = new Set();
    padStick.x = padStick.y = padLook.x = padLook.y = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      for (const [i, action] of Object.entries(PAD_BUTTONS)) if (pad.buttons[i]?.pressed) padDown.add(action);
      const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
      padStick.x = dead(lx);
      padStick.y = -dead(ly);
      padLook.x = dead(rx);
      padLook.y = dead(ry);
      // Menus still want discrete directions from the stick.
      if (ly < -0.5) padDown.add('up');
      if (ly > 0.5) padDown.add('down');
      if (lx < -0.5) padDown.add('left');
      if (lx > 0.5) padDown.add('right');
    }
    if (padDown.size || padStick.x || padStick.y) gesture();
  }

  /** Mouse look with pointer lock on `el`: click to capture, left click attacks, right consumes. */
  function attachPointer(el, { canLock = () => true } = {}) {
    pointerTarget = el;
    el.addEventListener('click', () => {
      if (canLock() && document.pointerLockElement !== el && matchMedia('(pointer: fine)').matches) el.requestPointerLock?.();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== el) return;
      mouseLook.x += e.movementX;
      mouseLook.y += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== el) return;
      if (e.button === 0) mouseDown.add('attack');
      if (e.button === 2) mouseDown.add('consume');
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) mouseDown.delete('attack');
      if (e.button === 2) mouseDown.delete('consume');
    });
  }

  /** On-screen controls: a movement stick, buttons, and drag-to-look on `lookSurface`. */
  function attachTouch(container, lookSurface) {
    const areas = {};
    for (const name of ['stick', 'face', 'top']) {
      areas[name] = document.createElement('div');
      areas[name].className = `touch-${name}`;
      container.appendChild(areas[name]);
    }
    const knob = document.createElement('div');
    knob.className = 'touch-knob';
    areas.stick.appendChild(knob);
    let stickId = null;
    const moveStick = (e) => {
      const r = areas.stick.getBoundingClientRect();
      const radius = r.width / 2;
      let x = (e.clientX - (r.left + radius)) / radius;
      let y = (e.clientY - (r.top + radius)) / radius;
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      touchStick.x = x;
      touchStick.y = -y;
      knob.style.transform = `translate(${x * radius * 0.6}px, ${y * radius * 0.6}px)`;
    };
    areas.stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      gesture();
      stickId = e.pointerId;
      areas.stick.setPointerCapture?.(e.pointerId);
      moveStick(e);
    });
    areas.stick.addEventListener('pointermove', (e) => e.pointerId === stickId && moveStick(e));
    const releaseStick = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      touchStick.x = touchStick.y = 0;
      knob.style.transform = '';
    };
    areas.stick.addEventListener('pointerup', releaseStick);
    areas.stick.addEventListener('pointercancel', releaseStick);

    for (const b of TOUCH_BUTTONS) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `tbtn tbtn-${b.action}`;
      el.textContent = b.label;
      el.setAttribute('aria-label', b.title || b.action);
      const press = (e) => {
        e.preventDefault();
        gesture();
        touchDown.add(b.action);
        el.classList.add('down');
        el.setPointerCapture?.(e.pointerId);
      };
      const release = (e) => {
        e.preventDefault();
        touchDown.delete(b.action);
        el.classList.remove('down');
      };
      el.addEventListener('pointerdown', press);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      areas[b.area].appendChild(el);
    }

    // Drag anywhere on the game view to turn the camera.
    const drags = new Map();
    lookSurface.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      drags.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    lookSurface.addEventListener('pointermove', (e) => {
      const last = drags.get(e.pointerId);
      if (!last) return;
      touchLook.x += e.clientX - last.x;
      touchLook.y += e.clientY - last.y;
      drags.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    const endDrag = (e) => drags.delete(e.pointerId);
    lookSurface.addEventListener('pointerup', endDrag);
    lookSurface.addEventListener('pointercancel', endDrag);
  }

  return {
    update() {
      pollPads();
      previous = current;
      current = new Set([...keyDown, ...mouseDown, ...touchDown, ...padDown]);
      const keysX = (current.has('camRight') ? 1 : 0) - (current.has('camLeft') ? 1 : 0);
      const keysY = (current.has('camDown') ? 1 : 0) - (current.has('camUp') ? 1 : 0);
      look = {
        x: mouseLook.x * MOUSE_SENSITIVITY + keysX * KEY_TURN + padLook.x * PAD_TURN + touchLook.x * TOUCH_TURN,
        y: mouseLook.y * MOUSE_SENSITIVITY + keysY * KEY_TURN * 0.6 + padLook.y * PAD_TURN * 0.6 + touchLook.y * TOUCH_TURN,
      };
      mouseLook.x = mouseLook.y = touchLook.x = touchLook.y = 0;
    },
    down: (a) => current.has(a),
    pressed: (a) => current.has(a) && !previous.has(a),
    /** How far to turn the camera this frame, in radians: x is yaw, y is pitch. */
    look: () => look,
    /** The movement stick turned into a world direction using the camera's heading. */
    moveVector(game) {
      let sx = (current.has('right') ? 1 : 0) - (current.has('left') ? 1 : 0);
      let sy = (current.has('up') ? 1 : 0) - (current.has('down') ? 1 : 0);
      for (const stick of [padStick, touchStick]) {
        if (Math.hypot(stick.x, stick.y) > Math.hypot(sx, sy)) {
          sx = stick.x;
          sy = stick.y;
        }
      }
      const len = Math.hypot(sx, sy);
      if (len > 1) {
        sx /= len;
        sy /= len;
      }
      const yaw = game.viewYaw;
      const f = { x: Math.cos(yaw), z: Math.sin(yaw) };
      const r = { x: -Math.sin(yaw), z: Math.cos(yaw) };
      return { x: f.x * sy + r.x * sx, z: f.z * sy + r.z * sx };
    },
    get pointerLocked() {
      return !!pointerTarget && document.pointerLockElement === pointerTarget;
    },
    releasePointer() {
      if (document.pointerLockElement) document.exitPointerLock?.();
    },
    attachPointer,
    attachTouch,
  };
}
