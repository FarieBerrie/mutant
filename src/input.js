// Keyboard, gamepad and touch, merged into one set of named actions.
// Call update() once per game frame; pressed(a) is true only on the frame a button went down.

const KEYS = {
  ArrowLeft: ['left'],
  KeyA: ['left'],
  ArrowRight: ['right'],
  KeyD: ['right'],
  ArrowUp: ['up', 'jump'],
  KeyW: ['up', 'jump'],
  ArrowDown: ['down'],
  KeyS: ['down'],
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
  KeyQ: ['cycle'],
  KeyE: ['cycle'],
  Enter: ['start'],
  KeyP: ['pause'],
  Escape: ['pause'],
  KeyM: ['mute'],
};

// Standard gamepad layout
const PAD_BUTTONS = { 0: 'jump', 2: 'attack', 1: 'consume', 3: 'dev', 5: 'dash', 7: 'dash', 4: 'cycle', 6: 'p4', 9: 'start', 8: 'pause', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

export const TOUCH_BUTTONS = [
  { action: 'left', label: '◀', area: 'dpad' },
  { action: 'right', label: '▶', area: 'dpad' },
  { action: 'down', label: '▼', area: 'dpad' },
  { action: 'jump', label: 'A', title: 'Jump', area: 'face' },
  { action: 'attack', label: 'B', title: 'Attack', area: 'face' },
  { action: 'consume', label: 'C', title: 'Consume', area: 'face' },
  { action: 'dash', label: 'DASH', area: 'face' },
  { action: 'cycle', label: 'PWR', title: 'Next power', area: 'top' },
  { action: 'p4', label: 'ARMR', title: 'Armor', area: 'top' },
  { action: 'dev', label: 'DEV', title: 'Devastator', area: 'top' },
  { action: 'pause', label: '❚❚', title: 'Pause', area: 'top' },
];

export function createInput({ onFirstGesture } = {}) {
  const keyDown = new Set();
  const touchDown = new Set();
  let padDown = new Set();
  let current = new Set();
  let previous = new Set();
  let gestured = false;

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
    touchDown.clear();
  });
  window.addEventListener('pointerdown', gesture);

  function pollPads() {
    padDown = new Set();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      for (const [i, action] of Object.entries(PAD_BUTTONS)) if (pad.buttons[i]?.pressed) padDown.add(action);
      const [x = 0, y = 0] = pad.axes;
      if (x < -0.4) padDown.add('left');
      if (x > 0.4) padDown.add('right');
      if (y > 0.5) padDown.add('down');
      if (y < -0.5) padDown.add('up');
    }
    if (padDown.size) gesture();
  }

  /** Builds the on-screen controls inside `container` (shown on touch screens by CSS). */
  function attachTouch(container) {
    const areas = {};
    for (const name of ['dpad', 'face', 'top']) {
      areas[name] = document.createElement('div');
      areas[name].className = `touch-${name}`;
      container.appendChild(areas[name]);
    }
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
  }

  return {
    update() {
      pollPads();
      previous = current;
      current = new Set([...keyDown, ...touchDown, ...padDown]);
    },
    down: (a) => current.has(a),
    pressed: (a) => current.has(a) && !previous.has(a),
    /** Any "confirm"-style button this frame (for menus). */
    confirm() {
      return ['start', 'jump', 'attack'].some((a) => current.has(a) && !previous.has(a));
    },
    attachTouch,
  };
}
