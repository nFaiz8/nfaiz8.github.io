// Keyboard and pointer input. Held keys become a movement vector; taps become commands. In the arena,
// W/↑/Space jump and S/↓ drop through platforms; the phone pad presses the same keys virtually.
const KEYS = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
};
const JUMP = ['Space', 'KeyW', 'ArrowUp', 'Jump'];
const DROP = ['KeyS', 'ArrowDown', 'Drop'];

export function createInput(target, { onTap, onKey }) {
  const held = new Set();
  const pad = new Set(); // on-screen buttons held down
  let run = false; // Shift held: sprint instead of walking

  const editable = (e) => e.target.closest && e.target.closest('input, textarea, [contenteditable]');
  window.addEventListener('keydown', (e) => {
    if (editable(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    run = e.shiftKey;
    if (KEYS[e.code]) { held.add(e.code); e.preventDefault(); return; }
    if (e.code === 'Space') held.add('Space'); // a jump in the arena; onKey decides what else it does
    if (onKey(e)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { held.delete(e.code); run = e.shiftKey; });
  window.addEventListener('blur', () => { held.clear(); pad.clear(); });

  // Tap / click to walk (ignore drags)
  let down = null;
  target.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  target.addEventListener('pointerup', (e) => {
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
      return { x: Math.sign(x), y: Math.sign(y), run, jump: JUMP.some((c) => all.has(c)), down: DROP.some((c) => all.has(c)) };
    },
    press(code, on) { if (on) pad.add(code); else pad.delete(code); },
    clear: () => { held.clear(); pad.clear(); },
  };
}
