// Keyboard and pointer input. Held keys become a movement vector; taps become commands. In the arena,
// W/↑/Space jump, S/↓ drop through platforms (and crouch on a floor), Ctrl only crouches (on a floor or a
// platform), G casts the grappling hook (or lets go); the phone pad presses the same keys virtually.
const KEYS = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
};
const JUMP = ['Space', 'KeyW', 'ArrowUp', 'Jump'];
const UP = ['KeyW', 'ArrowUp', 'Jump']; // takes hold of a ladder and climbs it (Space only jumps)
const DROP = ['KeyS', 'ArrowDown', 'Drop'];
const CROUCH = ['ControlLeft', 'ControlRight']; // arena only: crouches and crawls, never drops or climbs down
// The arena's keys still play with Ctrl held (a crawl is Ctrl with ← or →).
const PLAY = new Set([...Object.keys(KEYS), 'KeyJ', 'KeyK', 'KeyG', 'Space']);

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

const SAME = (code) => code;

// keys() → translate (src/keys.js): in the arena, what each key stands for.
export function createInput(target, { onTap, onKey, arena = () => false, keys = () => SAME, now = () => performance.now() / 1000 }) {
  const win = globalThis.window;
  const held = new Set();
  const as = new Map(); // a key down: the code it stands for, so it lets go of that whatever changes meanwhile
  const pad = new Set(); // on-screen buttons held down
  let run = false; // Shift held: sprint instead of walking
  let strikes = 0, roll = 0, hooks = 0;
  let mouseFire = false;
  const dtap = createDoubleTap();
  const mouse = { on: false, px: 0, py: 0 };
  const tapRoll = (code) => { if (!arena()) return; const d = ROLL_DIR[code]; if (d) roll = dtap.press(d, now()) || roll; };

  const editable = (e) => e.target.closest && e.target.closest('input, textarea, [contenteditable]');
  win.addEventListener('keydown', (e) => {
    if (editable(e)) return;
    // A rebound default (null) is no action here, only the page's own key; a bound key is only its action.
    const to = arena() ? keys()(e.code) : e.code;
    const act = to !== null, code = act ? to : e.code, bound = act && code !== e.code;
    if (act) as.set(e.code, code);
    if (act && CROUCH.includes(code)) { if (arena()) { held.add(code); e.preventDefault(); } return; }
    if (e.metaKey || e.altKey || (e.ctrlKey && !(arena() && PLAY.has(code)))) return;
    run = e.shiftKey;
    if (act && code === 'KeyJ') { held.add('KeyJ'); mouse.on = false; e.preventDefault(); return; }
    if (act && code === 'KeyK') { if (!e.repeat && arena()) strikes++; e.preventDefault(); return; }
    if (act && code === 'KeyG' && arena()) { if (!e.repeat) hooks++; e.preventDefault(); return; }
    if (act && ROLL_DIR[code] && !e.repeat) tapRoll(code);
    if (act && KEYS[code]) { held.add(code); e.preventDefault(); return; }
    if (act && code === 'Space') held.add('Space'); // a jump in the arena; onKey decides what else it does
    if (bound) { e.preventDefault(); return; }
    if (onKey(e)) e.preventDefault();
  });
  win.addEventListener('keyup', (e) => { held.delete(as.get(e.code) ?? e.code); as.delete(e.code); run = e.shiftKey; });
  const clear = () => { held.clear(); as.clear(); pad.clear(); mouseFire = false; strikes = 0; roll = 0; hooks = 0; mouse.on = false; dtap.reset(); };
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
      return { x: Math.sign(x), y: Math.sign(y), run, jump: JUMP.some((c) => all.has(c)), down: DROP.some((c) => all.has(c)), crouch: CROUCH.some((c) => all.has(c)), up: UP.some((c) => all.has(c)),
        fire: all.has('KeyJ') || all.has('Fire') || (mouseFire && arena()) };
    },
    press(code, on) {
      if (on && !pad.has(code)) {
        if (code === 'Hit') { if (arena()) strikes++; }
        else if (code === 'Hook') { if (arena()) hooks++; }
        else tapRoll(code);
      }
      if (on) pad.add(code); else pad.delete(code);
    },
    takeStrikes() { const n = strikes; strikes = 0; return n; },
    takeRoll() { const r = roll; roll = 0; return r; },
    takeHook() { const n = hooks; hooks = 0; return n > 0; }, // a G pressed since the last frame
    mouse,
    clear,
  };
}
