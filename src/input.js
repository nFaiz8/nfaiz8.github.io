// Keyboard and pointer input. Held keys become a movement vector; taps become commands.
const KEYS = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
};

export function createInput(target, { onTap, onKey }) {
  const held = new Set();
  let run = false; // Shift held: sprint instead of walking

  const editable = (e) => e.target.closest && e.target.closest('input, textarea, [contenteditable]');
  window.addEventListener('keydown', (e) => {
    if (editable(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    run = e.shiftKey;
    if (KEYS[e.code]) { held.add(e.code); e.preventDefault(); return; }
    if (onKey(e)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { held.delete(e.code); run = e.shiftKey; });
  window.addEventListener('blur', () => held.clear());

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
      for (const code of held) { x += KEYS[code][0]; y += KEYS[code][1]; }
      return { x: Math.sign(x), y: Math.sign(y), run };
    },
    clear: () => held.clear(),
  };
}
