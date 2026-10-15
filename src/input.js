// Keyboard and pointer input. Held keys become a movement vector; taps become commands. In the arena,
// W/↑/Space jump and S/↓ drop through platforms; the phone pad presses the same keys virtually.
const KEYS = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
};
const JUMP = ['Space', 'KeyW', 'ArrowUp', 'Jump'];
const UP = ['KeyW', 'ArrowUp', 'Jump']; // takes hold of a ladder and climbs it (Space only jumps)
const DROP = ['KeyS', 'ArrowDown', 'Drop'];

// Two presses of the same direction within `gap` seconds make a roll. Returns the direction, or 0.
export function createDoubleTap(gap = 0.25) {
  let dir = 0, at = -Infinity;
  return {
    reset() { dir = 0; at = -Infinity; },
    press(d, t) {
      if (d === dir && t - at <= gap) { dir = 0; at = -Infinity; return d; }
      dir = d; at = t;
      return 0;
    },
  };
}

const ROLL_DIR = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };

export function createInput(target, { onTap, onKey, arena = () => false, now = () => performance.now() / 1000 }) {
  const win = globalThis.window;
  const held = new Set();
  const pad = new Set(); // on-screen buttons held down
  let run = false; // Shift held: sprint instead of walking
  let strikes = 0, roll = 0;
  let mouseFire = false;
  const dtap = createDoubleTap();
  const mouse = { on: false, px: 0, py: 0 };
  const tapRoll = (code) => { if (!arena()) return; const d = ROLL_DIR[code]; if (d) roll = dtap.press(d, now()) || roll; };

  const editable = (e) => e.target.closest && e.target.closest('input, textarea, [contenteditable]');
  win.addEventListener('keydown', (e) => {
    if (editable(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    run = e.shiftKey;
    if (e.code === 'KeyJ') { held.add('KeyJ'); mouse.on = false; e.preventDefault(); return; }
    if (e.code === 'KeyK') { if (!e.repeat && arena()) strikes++; e.preventDefault(); return; }
    if (ROLL_DIR[e.code] && !e.repeat) tapRoll(e.code);
    if (KEYS[e.code]) { held.add(e.code); e.preventDefault(); return; }
    if (e.code === 'Space') held.add('Space'); // a jump in the arena; onKey decides what else it does
    if (onKey(e)) e.preventDefault();
  });
  win.addEventListener('keyup', (e) => { held.delete(e.code); run = e.shiftKey; });
  const clear = () => { held.clear(); pad.clear(); mouseFire = false; strikes = 0; roll = 0; mouse.on = false; dtap.reset(); };
  win.addEventListener('blur', clear);

  // The mouse aims, left fires, right strikes (arena only; touch never does)
  const isMouse = (e) => e.pointerType === 'mouse' && arena();
  target.addEventListener('pointermove', (e) => {
    if (!isMouse(e)) return;
    mouse.on = true; mouse.px = e.clientX; mouse.py = e.clientY;
  });
  target.addEventListener('contextmenu', (e) => { if (arena()) e.preventDefault(); });

  // Tap / click to walk (ignore drags)
  let down = null;
  target.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
    if (!isMouse(e)) return;
    mouse.px = e.clientX; mouse.py = e.clientY;
    if (e.button === 0) mouseFire = true;
    else if (e.button === 2) strikes++;
  });
  // Released over a HUD overlay or outside the window? The window hears it too.
  const release = (e) => { if (e.pointerType === 'mouse' && e.button === 0) mouseFire = false; };
  const cancel = () => { mouseFire = false; };
  target.addEventListener('pointercancel', cancel);
  win.addEventListener('pointercancel', cancel);
  win.addEventListener('pointerup', release);
  target.addEventListener('pointerup', (e) => {
    release(e);
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved < 10) onTap(e.clientX, e.clientY);
  });

  return {
    state() {
      let x = 0, y = 0;
      const all = new Set([...held, ...pad]);
      for (const code of all) { const k = KEYS[code]; if (k) { x += k[0]; y += k[1]; } }
      return { x: Math.sign(x), y: Math.sign(y), run, jump: JUMP.some((c) => all.has(c)), down: DROP.some((c) => all.has(c)), up: UP.some((c) => all.has(c)),
        fire: all.has('KeyJ') || all.has('Fire') || (mouseFire && arena()) };
    },
    press(code, on) {
      if (on && !pad.has(code)) {
        if (code === 'Hit') { if (arena()) strikes++; }
        else tapRoll(code);
      }
      if (on) pad.add(code); else pad.delete(code);
    },
    takeStrikes() { const n = strikes; strikes = 0; return n; },
    takeRoll() { const r = roll; roll = 0; return r; },
    mouse,
    clear,
  };
}
