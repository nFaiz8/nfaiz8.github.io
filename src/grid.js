// Every photo on one scrolling page, grouped and ordered by colour like the rooms, each at its own
// shape (panoramas stay panoramic). Opened from the lobby kiosk, G, or #/all. Tapping a photo opens the
// usual viewer; ←/→ there go through the photos in this same order.
import { justify } from './justify.js';
import { describe } from './data.js';
import { roomColor } from './colors.js';

const GAP = 4;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const aspectOf = (p) => (p.width && p.height ? p.width / p.height : p.aspect || 1.5);
// Pixel width of a published copy whose long side is at most `long`.
function widthAt(p, long) {
  if (!p.width || !p.height) return long;
  return Math.round(p.width * Math.min(1, long / Math.max(p.width, p.height)));
}

export function createGrid(map, { onPick, onOpen, onClose }) {
  const groups = map.rooms.filter((r) => r.frames && r.frames.length);
  const total = groups.reduce((n, r) => n + r.frames.length, 0);

  const root = el('div', 'grid');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'All photos');
  const head = el('div', 'grid-head');
  const closeBtn = el('button', 'vbtn', '[esc] ×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close all photos');
  head.append(el('span', null, `all photos · ${total} · by colour`), closeBtn);
  const body = el('div', 'grid-body');
  root.append(head, body);
  document.body.append(root);

  const tiles = new Map(); // frame → button
  const sections = groups.map((room) => {
    const sec = el('section', 'grid-group');
    const label = el('h2', 'grid-label', `── ${room.name} · ${room.frames.length} ──`);
    if (room.hue != null && room.id !== 'darkroom') label.style.color = roomColor(room.hue);
    if (room.id === 'darkroom') label.style.color = 'hsl(4 60% 58%)';
    const rows = el('div', 'grid-rows');
    for (const f of room.frames) {
      const p = f.photo;
      const b = el('button', 'grid-tile');
      b.type = 'button';
      b.dataset.id = f.id;
      const img = el('img');
      img.alt = describe(p);
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = p.src.low;
      if (p.src.hi) img.srcset = `${p.src.low} ${widthAt(p, 512)}w, ${p.src.hi} ${widthAt(p, 2560)}w`;
      b.append(img);
      b.addEventListener('click', () => onPick(f));
      tiles.set(f, b);
    }
    sec.append(label, rows);
    body.append(sec);
    return { room, rows };
  });

  let laidOutFor = 0;
  function layout() {
    const width = body.clientWidth;
    if (!width || width === laidOutFor) return;
    laidOutFor = width;
    const rowH = innerWidth < 600 ? 120 : 200;
    for (const { room, rows } of sections) {
      rows.replaceChildren();
      for (const r of justify(room.frames.map((f) => aspectOf(f.photo)), width, rowH, GAP)) {
        const line = el('div', 'grid-row');
        for (const t of r.items) {
          const b = tiles.get(room.frames[t.i]);
          // Round down so rounding never pushes a full row past the edge.
          const w = Math.floor(t.w), h = Math.floor(t.h);
          Object.assign(b.style, { width: `${w}px`, height: `${h}px` });
          b.firstChild.sizes = `${w}px`;
          line.append(b);
        }
        rows.append(line);
      }
    }
  }
  addEventListener('resize', () => { if (!root.hidden) layout(); });

  let isOpen = false;
  function open() {
    if (isOpen) return;
    isOpen = true;
    root.hidden = false;
    layout();
    onOpen();
    closeBtn.focus({ preventScroll: true });
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    root.hidden = true;
    onClose();
  }
  closeBtn.addEventListener('click', close);
  // The viewer takes the keys while it is open (it listens in the capture phase and stops them).
  addEventListener('keydown', (e) => {
    if (isOpen && e.key === 'Escape') { e.preventDefault(); close(); }
  });

  return {
    open,
    close,
    get isOpen() { return isOpen; },
    // Where a photo's tile is on screen, for the viewer's open/close animation.
    rectOf(f) {
      const r = tiles.get(f).getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    },
    reveal(f) { tiles.get(f).scrollIntoView({ block: 'nearest' }); },
    focus(f) { tiles.get(f).focus({ preventScroll: true }); },
  };
}
