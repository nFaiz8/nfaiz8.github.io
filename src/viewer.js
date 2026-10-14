// Opening a photo: the frame's characters refine into the real image, which then grows into a
// full-screen viewer (zoom, pan, EXIF, previous/next, alt edit, copy link). Closing plays it back.
// Works over either renderer: the transition is an overlay laid exactly over the frame on screen.
import { toCells, developCell, RAMP } from './ascii.js';
import { loadImage } from './photos.js';
import { drawGlyph, prepareText, rgb, FONT_FAMILY } from './render/glyphs.js';
import { describe, plaqueText } from './data.js';
import { photoLink } from './router.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(r));

function pixels(bitmap, w, h) {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// Draw a grid of cells (from toCells) into ctx over w×h CSS pixels.
function drawCells(ctx, cells, w, h, cellFn) {
  const { cols, rows } = cells;
  const cw = w / cols, ch = h / rows;
  const fontPx = Math.max(3, Math.floor(Math.min(ch * 0.8, cw / 0.6)));
  prepareText(ctx, `${fontPx}px ${FONT_FAMILY}`);
  ctx.clearRect(0, 0, w, h);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const k = y * cols + x;
      const { glyph, fg, bg } = cellFn(k);
      ctx.fillStyle = rgb(...bg);
      ctx.fillRect(Math.floor(x * cw), Math.floor(y * ch), Math.ceil(cw), Math.ceil(ch));
      ctx.fillStyle = rgb(...fg);
      drawGlyph(ctx, glyph, x * cw, y * ch, cw, ch, fontPx);
    }
  }
}

// Fetch with a progress callback (0..1, or null when the size is unknown).
async function fetchBlob(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) { onProgress(null); return res.blob(); }
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  return new Blob(parts, { type: res.headers.get('content-type') || 'image/jpeg' });
}

const bar = (p) => `[${'#'.repeat(Math.round(p * 9)).padEnd(9, '·')}]`;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const EXIF_FIELDS = [
  ['Camera', (p) => p.camera], ['Lens', (p) => p.lens], ['Focal length', (p) => p.focalLength],
  ['Aperture', (p) => p.aperture && `f/${String(p.aperture).replace(/^f\//, '')}`],
  ['Shutter', (p) => p.shutter && `${String(p.shutter).replace(/s$/, '')}s`], ['ISO', (p) => p.iso],
  ['Film', (p) => p.filmStock || (p.category === 'film' ? '35mm film' : null)],
  ['Film simulation', (p) => p.filmSimulation], ['Date', (p) => p.date], ['Place', (p) => p.location],
];

export function createViewer({ getRect, order, byId, reducedMotion, onShow, onNavigate, onClose, setCamTarget, extra = null }) {
  // ----- DOM -----
  const overlay = el('canvas', 'resolve');
  const progress = el('div', 'resolve-progress');
  const flip = el('img', 'flip');
  flip.alt = '';
  const root = el('div', 'viewer');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Photo viewer');
  const stageEl = el('div', 'viewer-stage');
  const img = el('img', 'viewer-img');
  img.draggable = false;
  stageEl.append(img);
  const err = el('div', 'viewer-error');
  err.hidden = true;
  const errText = el('span', null, '');
  const retry = el('button', 'vbtn', 'retry');
  retry.type = 'button';
  err.append(errText, retry);
  const info = el('aside', 'viewer-info');
  info.hidden = true;
  const bar1 = el('div', 'viewer-bar');
  const title = el('span', 'viewer-title');
  const btn = (label, key, aria) => { const b = el('button', 'vbtn', label); b.type = 'button'; b.title = aria; b.setAttribute('aria-label', aria); if (key) b.dataset.key = key; return b; };
  const prevBtn = btn('←', null, 'Previous photo');
  const nextBtn = btn('→', null, 'Next photo');
  const infoBtn = btn('[I] info', null, 'Show photo details');
  const altBtn = btn('alt edit', null, 'Show the alternate edit');
  const copyBtn = btn('copy link', null, 'Copy a link to this photo');
  const closeBtn = btn('[esc] ×', null, 'Close');
  // An optional extra action for some photos (the arena's photo: go there).
  const extraBtn = extra ? btn(extra.label, extra.key, extra.aria) : null;
  if (extraBtn) extraBtn.addEventListener('click', () => extra.onClick(cur));
  const tools = el('div', 'viewer-tools');
  tools.append(prevBtn, nextBtn, infoBtn, altBtn, copyBtn, ...(extraBtn ? [extraBtn] : []), closeBtn);
  bar1.append(title, tools);
  root.append(stageEl, err, info, bar1);
  document.body.append(overlay, progress, flip, root);
  overlay.hidden = progress.hidden = flip.hidden = true;

  let state = 'closed'; // closed | opening | open | closing
  let cur = null; // the frame being shown
  let photo = null; // the photo shown (the frame's photo or its alternate edit)
  let objectUrl = null;
  let view = { s: 1, x: 0, y: 0 };
  let usingXl = false;

  // ----- helpers -----
  const indexOf = (f) => order.indexOf(f);
  function fitRect(p) {
    const vw = innerWidth, vh = innerHeight - 56;
    const a = (p.width && p.height) ? p.width / p.height : p.aspect || 1.5;
    let w = Math.min(vw - 32, (vh - 16) * a), h = w / a;
    return { x: (innerWidth - w) / 2, y: (vh - h) / 2 + 8, w, h };
  }
  const place = (e, r) => Object.assign(e.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });

  function setOverlay(r) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    overlay.width = Math.max(1, Math.round(r.w * dpr));
    overlay.height = Math.max(1, Math.round(r.h * dpr));
    place(overlay, r);
    const ctx = overlay.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  // Keep the overlay glued to the frame while the camera settles. sync() runs from the main loop,
  // right after the world is drawn, so the two never drift apart by a frame.
  const trackers = new Set();
  function track(fn) {
    const t = (r) => { place(overlay, r); place(flip, r); if (fn) fn(r); };
    trackers.add(t);
    return () => trackers.delete(t);
  }
  function sync() {
    if (!trackers.size || !cur) return;
    const r = getRect(cur);
    trackers.forEach((t) => t(r));
  }

  let hiPromise = null;
  function loadHi(p, onProgress = () => {}) {
    // Keep the picture on screen alive until the next one replaces it (closing right after ← or → still
    // animates it); showImage frees it then.
    if (objectUrl && img.src !== objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    const src = p.src.hi || p.src.xl || p.src.low;
    hiPromise = fetchBlob(src, onProgress).then((b) => (objectUrl = URL.createObjectURL(b)));
    return hiPromise;
  }

  function preloadNeighbours() {
    const i = indexOf(cur);
    for (const f of [order[i - 1], order[i + 1]]) if (f) { const im = new Image(); im.src = f.photo.src.hi || f.photo.src.low; }
  }

  function renderInfo() {
    info.replaceChildren();
    const dl = el('dl');
    for (const [k, get] of EXIF_FIELDS) {
      const v = get(photo);
      if (v == null || v === '') continue;
      dl.append(el('dt', null, k), el('dd', null, String(v)));
    }
    info.append(el('h2', null, 'Details'), dl);
  }

  function updateChrome() {
    title.textContent = plaqueText(photo);
    const i = indexOf(cur);
    prevBtn.disabled = i <= 0;
    nextBtn.disabled = i >= order.length - 1;
    const alt = altOf(cur.photo);
    altBtn.hidden = !alt;
    altBtn.setAttribute('aria-pressed', String(photo !== cur.photo));
    altBtn.textContent = photo !== cur.photo ? 'original' : 'alt edit';
    img.alt = describe(photo);
    if (extraBtn) extraBtn.hidden = !extra.show(cur);
    renderInfo();
  }

  const altOf = (p) => (p.variants || []).map((id) => byId.get(id)).find(Boolean) || null;

  function resetView() {
    view = { s: 1, x: 0, y: 0 };
    usingXl = false;
    applyView();
  }
  function applyView() {
    img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
    if (view.s > 1.5 && !usingXl && photo.src.xl) { usingXl = true; img.src = photo.src.xl; }
  }

  async function showImage(p) {
    photo = p;
    err.hidden = true;
    resetView();
    updateChrome();
    place(img, fitRect(p));
    try {
      const url = await loadHi(p);
      if (photo !== p) return;
      const shown = img.src;
      img.src = url;
      if (shown.startsWith('blob:') && shown !== url) URL.revokeObjectURL(shown);
    } catch (e) {
      if (photo !== p) return;
      errText.textContent = `couldn't load this photo (${e.message}). `;
      err.hidden = false;
    }
  }

  // ----- the transition -----
  async function resolveIn(f, bitmap) {
    const r0 = getRect(f);
    const ctx = setOverlay(r0);
    overlay.hidden = false;
    const stop = track();
    const { cols, rows } = f;
    const cellsAt = (k) => toCells(pixels(bitmap, Math.min(bitmap.width, cols * k * 2), Math.min(bitmap.height, rows * k * 2)), cols * k, rows * k);

    if (f.darkroom) {
      // Develop: blank paper, then shadows first in red, then true colour, still as characters.
      const base = cellsAt(1);
      const paint = (exposure, mix) => drawCells(ctx, base, r0.w, r0.h, (k) => {
        const d = developCell(base.lum[k], [...base.fg.subarray(k * 3, k * 3 + 3)], exposure, mix);
        return { glyph: d.glyph, fg: d.fg, bg: d.blank ? [20, 6, 5] : [Math.round(30 * base.lum[k] + 10), 3, 3] };
      });
      paint(-1, 0);
      await wait(260);
      for (let e = 1; e <= 6; e++) { paint(e / 6, 0); await wait(130); }
      for (let m = 1; m <= 3; m++) { paint(1, m / 3); await wait(110); }
    }

    // Resolve: the characters get finer, ½, ¼ and ⅛ of a cell.
    for (const k of [2, 4, 8]) {
      const c = cellsAt(k);
      drawCells(ctx, c, r0.w, r0.h, (i) => ({ glyph: RAMP[c.glyph[i]], fg: c.fg.subarray(i * 3, i * 3 + 3), bg: c.bg.subarray(i * 3, i * 3 + 3) }));
      await wait(110);
    }
    stop();
  }

  // plain: opened from a real picture (the all-photos grid), so closing shrinks back onto it without
  // turning into characters.
  let plain = false;
  async function open(f, { instant = false, plain: fromPicture = false } = {}) {
    if (state !== 'closed') return;
    state = 'opening';
    // The arena's photo is 240 × 50 cells: resolving it into characters and back would redraw hundreds of
    // thousands of cells per step, so it always opens quick and closes plain.
    plain = fromPicture || !!f.backdrop;
    cur = f;
    photo = f.photo;
    onShow(f);
    const quick = instant || reducedMotion || !!f.backdrop;
    setCamTarget({ x: f.x + f.w / 2, y: f.y + f.h / 2 });
    updateChrome();

    if (!quick) {
      // Start the full-size image now; show its progress under the frame while the characters resolve.
      progress.hidden = false;
      const showBar = (p) => { progress.textContent = p == null ? '[loading]' : bar(p); };
      showBar(0);
      const stopBar = track((r) => { progress.style.left = `${r.x}px`; progress.style.top = `${r.y + r.h + 6}px`; });
      const hi = loadHi(f.photo, showBar).catch(() => null);
      await wait(260); // camera glide
      let bitmap = null;
      try { bitmap = await loadImage(f.photo); } catch {}
      if (bitmap) await resolveIn(f, bitmap);
      const url = await hi;
      stopBar();
      progress.hidden = true;

      if (url) {
        // Cross-fade to the real picture over the frame, then grow it to full screen (FLIP).
        flip.src = url;
        await flip.decode().catch(() => {});
        const r = getRect(f);
        place(flip, r);
        flip.style.transition = 'none';
        flip.style.transform = 'none';
        flip.style.opacity = '0';
        flip.hidden = false;
        await frame();
        flip.style.transition = 'opacity 180ms linear';
        flip.style.opacity = '1';
        await wait(190);
        overlay.hidden = true;
        const to = fitRect(f.photo);
        flip.style.transition = 'transform 360ms cubic-bezier(.2,.7,.2,1)';
        flip.style.transformOrigin = '0 0';
        flip.style.transform = `translate(${to.x - r.x}px, ${to.y - r.y}px) scale(${to.w / r.w}, ${to.h / r.h})`;
        await wait(370);
      }
    }

    root.hidden = false;
    await showImage(f.photo);
    flip.hidden = true;
    overlay.hidden = true;
    state = 'open';
    closeBtn.focus({ preventScroll: true });
    preloadNeighbours();
  }

  async function close() {
    if (state !== 'open') return;
    state = 'closing';
    const f = cur;
    root.hidden = true;
    info.hidden = true;
    if (!reducedMotion && img.src) {
      const from = fitRect(photo);
      const r = getRect(f);
      flip.src = img.src;
      place(flip, r);
      flip.style.transition = 'none';
      flip.style.transformOrigin = '0 0';
      flip.style.transform = `translate(${from.x - r.x}px, ${from.y - r.y}px) scale(${from.w / r.w}, ${from.h / r.h})`;
      flip.style.opacity = '1';
      flip.hidden = false;
      await frame();
      flip.style.transition = 'transform 300ms cubic-bezier(.4,0,.2,1)';
      flip.style.transform = 'none';
      await wait(310);
      // Back into characters: fade the picture out while the cells coarsen.
      let bitmap = null;
      if (!plain) try { bitmap = await loadImage(f.photo); } catch {}
      if (bitmap) {
        const ctx = setOverlay(r);
        overlay.hidden = false;
        const stop = track();
        flip.style.transition = 'opacity 160ms linear';
        flip.style.opacity = '0';
        for (const k of [8, 4, 2]) {
          const c = toCells(pixels(bitmap, Math.min(bitmap.width, f.cols * k * 2), Math.min(bitmap.height, f.rows * k * 2)), f.cols * k, f.rows * k, { mono: f.darkroom });
          drawCells(ctx, c, r.w, r.h, (i) => ({ glyph: RAMP[c.glyph[i]], fg: c.fg.subarray(i * 3, i * 3 + 3), bg: c.bg.subarray(i * 3, i * 3 + 3) }));
          await wait(80);
        }
        stop();
      }
    }
    overlay.hidden = true;
    flip.hidden = true;
    flip.removeAttribute('src');
    if (img.src.startsWith('blob:') && img.src !== objectUrl) URL.revokeObjectURL(img.src);
    img.removeAttribute('src');
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    setCamTarget(null);
    state = 'closed';
    onClose(f);
  }

  function go(delta) {
    if (state !== 'open') return;
    const f = order[indexOf(cur) + delta];
    if (!f) return;
    cur = f;
    onNavigate(f);
    setCamTarget({ x: f.x + f.w / 2, y: f.y + f.h / 2 }, true);
    showImage(f.photo);
    preloadNeighbours();
  }

  // ----- controls -----
  prevBtn.addEventListener('click', () => go(-1));
  nextBtn.addEventListener('click', () => go(1));
  closeBtn.addEventListener('click', close);
  infoBtn.addEventListener('click', () => { info.hidden = !info.hidden; });
  retry.addEventListener('click', () => showImage(photo));
  altBtn.addEventListener('click', () => {
    const alt = altOf(cur.photo);
    if (alt) showImage(photo === cur.photo ? alt : cur.photo);
  });
  copyBtn.addEventListener('click', () => {
    const link = photoLink(cur.id);
    const done = () => { copyBtn.textContent = 'copied'; setTimeout(() => (copyBtn.textContent = 'copy link'), 1500); };
    const fallback = () => { copyBtn.textContent = link; const s = getSelection(); const rng = document.createRange(); rng.selectNodeContents(copyBtn); s.removeAllRanges(); s.addRange(rng); };
    try { navigator.clipboard.writeText(link).then(done, fallback); } catch { fallback(); }
  });
  root.addEventListener('click', (e) => { if (e.target === root || e.target === stageEl) close(); });

  addEventListener('keydown', (e) => {
    if (state === 'closed') return;
    e.stopImmediatePropagation();
    if (state !== 'open') { e.preventDefault(); return; }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'i' || e.key === 'I') { info.hidden = !info.hidden; }
    else if (e.key === 'Tab') {
      // Keep keyboard focus inside the dialog.
      const items = [...root.querySelectorAll('button')].filter((b) => !b.hidden && !b.disabled && b.offsetParent);
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
      e.preventDefault();
      items[next].focus();
    }
  }, true);

  // Zoom and pan: wheel, drag, pinch, double-click.
  const pointers = new Map();
  let pinch = null;
  function zoomAt(s, cx, cy) {
    const r = img.getBoundingClientRect();
    const ox = cx - (r.left - view.x), oy = cy - (r.top - view.y); // point relative to untransformed image
    const ns = Math.min(8, Math.max(1, s));
    view.x -= (ox - view.x) * (ns / view.s - 1);
    view.y -= (oy - view.y) * (ns / view.s - 1);
    view.s = ns;
    if (ns === 1) { view.x = 0; view.y = 0; }
    applyView();
  }
  stageEl.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(view.s * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
  stageEl.addEventListener('dblclick', (e) => zoomAt(view.s > 1 ? 1 : 2.5, e.clientX, e.clientY));
  stageEl.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stageEl.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.s };
    }
  });
  stageEl.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      zoomAt(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (view.s > 1) {
      view.x += e.clientX - prev.x;
      view.y += e.clientY - prev.y;
      applyView();
    }
  });
  const up = (e) => {
    const start = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    // A horizontal swipe at normal zoom moves between photos.
    if (start && view.s === 1 && e.type === 'pointerup' && swipe && Math.abs(e.clientX - swipe.x) > 60 && Math.abs(e.clientY - swipe.y) < 50) go(e.clientX < swipe.x ? 1 : -1);
    swipe = null;
  };
  let swipe = null;
  stageEl.addEventListener('pointerdown', (e) => { if (pointers.size === 1) swipe = { x: e.clientX, y: e.clientY }; });
  stageEl.addEventListener('pointerup', up);
  stageEl.addEventListener('pointercancel', up);
  addEventListener('resize', () => { if (state === 'open') { place(img, fitRect(photo)); resetView(); } });

  return {
    sync,
    open,
    close,
    get isOpen() { return state !== 'closed'; },
    get state() { return state; },
    get current() { return cur; },
    get photo() { return photo; },
  };
}
