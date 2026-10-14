// The map: a small floor plan of the whole gallery with every room as a button. Pick one and you
// walk there. Opens with M or the HUD button; Esc, M or a click outside closes it.
import { T } from './layout.js';
import { roomTint, C } from './render/palette.js';

export function createMap(map, { onGo, onOpen, onClose }) {
  const root = document.createElement('div');
  root.className = 'map';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Map');
  const panel = document.createElement('div');
  panel.className = 'map-panel';
  const head = document.createElement('div');
  head.className = 'map-head';
  const title = document.createElement('span');
  title.textContent = 'map · pick a room to walk there';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'vbtn';
  close.textContent = '[esc] ×';
  close.setAttribute('aria-label', 'Close map');
  head.append(title, close);
  const plan = document.createElement('div');
  plan.className = 'map-plan';
  plan.style.aspectRatio = `${map.W} / ${map.H * 2}`;
  // As wide as fits, without growing taller than the screen.
  plan.style.width = `min(100%, calc((100vh - 140px) * ${(map.W / (map.H * 2)).toFixed(4)}))`;
  const canvas = document.createElement('canvas');
  const you = document.createElement('span');
  you.className = 'map-you';
  you.textContent = '@';
  you.setAttribute('aria-hidden', 'true');
  plan.append(canvas);
  const list = document.createElement('div');
  list.className = 'map-list';
  panel.append(head, plan, list);
  root.append(panel);
  document.body.append(root);

  // Floor plan, one cell = 1×2 pixels (cells are twice as tall as wide).
  canvas.width = map.W;
  canvas.height = map.H * 2;
  const ctx = canvas.getContext('2d');
  const tints = map.rooms.map(roomTint);
  const img = ctx.createImageData(map.W, map.H * 2);
  for (let y = 0; y < map.H; y++) {
    for (let x = 0; x < map.W; x++) {
      const i = y * map.W + x, t = map.tiles[i], r = map.roomOf[i];
      let c = null;
      if (t === T.WALL) c = [70, 74, 88];
      else if (t === T.FLOOR || t === T.DOOR) c = r > 0 ? tints[r].dot.map((v) => v * 1.4) : [26, 28, 34];
      else if (t === T.PROP) c = C.frame;
      if (!c) continue;
      for (const yy of [y * 2, y * 2 + 1]) img.data.set([c[0], c[1], c[2], 255], (yy * map.W + x) * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  for (const f of map.frames) {
    // Prints in their room's colour, so each room reads at a glance.
    const col = f.darkroom ? [190, 60, 48] : tints[f.roomIndex].title;
    ctx.fillStyle = `rgb(${col.join(',')})`;
    ctx.fillRect(f.x + 1, (f.y + 1) * 2, f.w - 2, (f.h - 2) * 2);
  }

  // One button per room, centred on it.
  const buttons = map.rooms.map((r, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'map-room';
    b.textContent = r.name;
    b.style.left = `${((r.x + r.w / 2) / map.W) * 100}%`;
    b.style.top = `${((r.y + r.h / 2) / map.H) * 100}%`;
    const col = i === 0 ? C.name : r.plan && r.plan.darkroom ? [220, 90, 72] : tints[i].title;
    b.style.color = `rgb(${col.join(',')})`;
    b.setAttribute('aria-label', `Walk to ${r.name}`);
    b.addEventListener('click', () => { hide(); onGo(r); });
    plan.append(b);
    // The same rooms as a plain list, used on narrow screens where labels on the plan would crowd.
    const li = b.cloneNode(true);
    li.className = 'map-room-item';
    li.style.left = li.style.top = '';
    li.addEventListener('click', () => { hide(); onGo(r); });
    list.append(li);
    return b;
  });
  const items = [...list.children];
  plan.append(you);

  let open = false;
  function show() {
    if (open) return;
    open = true;
    root.hidden = false;
    onOpen && onOpen();
    const pick = (matchMedia('(max-width: 600px)').matches ? items : buttons);
    (pick[current] || pick[0]).focus({ preventScroll: true });
  }
  function hide() {
    if (!open) return;
    open = false;
    root.hidden = true;
    onClose && onClose();
  }
  let current = 0;
  const dots = [];

  close.addEventListener('click', hide);
  root.addEventListener('click', (e) => { if (e.target === root) hide(); });
  addEventListener('keydown', (e) => {
    if (!open) return;
    e.stopImmediatePropagation();
    if (e.key === 'Escape' || e.code === 'KeyM') { e.preventDefault(); hide(); }
    else if (e.key === 'Tab') {
      const all = [close, ...buttons, ...items].filter((b) => b.offsetParent);
      const k = all.indexOf(document.activeElement);
      e.preventDefault();
      all[(k + (e.shiftKey ? all.length - 1 : 1)) % all.length].focus();
    }
  }, true);

  return {
    show,
    hide,
    toggle: () => (open ? hide() : show()),
    get isOpen() { return open; },
    // Keep the "you are here" marker on the player; called from the main loop.
    sync(player, roomIndex, others = []) {
      current = roomIndex;
      if (!open) return;
      you.style.left = `${(player.x / map.W) * 100}%`;
      you.style.top = `${(player.y / map.H) * 100}%`;
      while (dots.length < others.length) { const d = document.createElement('span'); d.className = 'map-peer'; d.textContent = '@'; d.setAttribute('aria-hidden', 'true'); plan.append(d); dots.push(d); }
      dots.forEach((d, i) => {
        const o = others[i];
        d.hidden = !o;
        if (o) { d.style.left = `${(o.x / map.W) * 100}%`; d.style.top = `${(o.y / map.H) * 100}%`; }
      });
      buttons.forEach((b, i) => b.classList.toggle('here', i === roomIndex));
      items.forEach((b, i) => b.classList.toggle('here', i === roomIndex));
    },
  };
}
