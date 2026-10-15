// Impact frames (parry addendum §2): each kill I'm in is kept as a picture, the frame of it as the impact
// shows it (a black-and-white negative), to look at and save. Kept in memory only: a reload loses them.
// I or the HUD button opens the list; Esc, I or a click outside closes it. Its switch turns impact frames
// off (no flash, no freeze, nothing kept), remembered in this browser.

export const IMPACT_FILTER = 'invert(1) grayscale(1) contrast(4)'; // the same as #stage.impact canvas
export const KEEP = 20; // the newest this many are kept
const MAX_W = 1920; // a kept picture is at most this wide (cheaper to bake, still sharp)

// The impact look baked into RGBA pixels, in place, where the 2D context has no filter (CSS's own maths:
// invert, then the grey of grayscale(1), then contrast(4) about the middle).
export function impactPixels(d) {
  for (let i = 0; i < d.length; i += 4) {
    const grey = 255 - (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    const v = (grey - 127.5) * 4 + 127.5;
    d[i] = d[i + 1] = d[i + 2] = v < 0 ? 0 : v > 255 ? 255 : v; // a Uint8ClampedArray rounds
  }
  return d;
}

// Whether the 2D context's filter really applies (some browsers have the property and ignore it): a white
// pixel drawn through the impact filter comes out black. Asked once.
let filterOk = null;
function canFilter() {
  if (filterOk !== null) return filterOk;
  try {
    const a = document.createElement('canvas'), b = document.createElement('canvas');
    a.width = a.height = b.width = b.height = 1;
    a.getContext('2d').fillStyle = '#fff';
    a.getContext('2d').fillRect(0, 0, 1, 1);
    const ctx = b.getContext('2d');
    ctx.filter = IMPACT_FILTER;
    ctx.drawImage(a, 0, 0);
    filterOk = ctx.getImageData(0, 0, 1, 1).data[0] < 128;
  } catch { filterOk = false; }
  return filterOk;
}

// The file name a picture saves as: impact-2026-10-14-21-05-09.png, in local time.
export function shotName(at) {
  const d = new Date(at), p = (n) => String(n).padStart(2, '0');
  return `impact-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.png`;
}

const ON_KEY = 'ascii-impact'; // 'off' when turned off

export function createShots({ onOpen, onClose, onCount } = {}) {
  const shots = []; // newest first: { url, at, text }
  let on = true;
  try { on = localStorage.getItem(ON_KEY) !== 'off'; } catch {}
  const root = document.createElement('div');
  root.className = 'map shots';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Impact frames');
  const panel = document.createElement('div');
  panel.className = 'map-panel';
  const head = document.createElement('div');
  head.className = 'map-head';
  const title = document.createElement('span');
  title.textContent = 'impact frames · kept until you reload';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'vbtn';
  close.textContent = '[esc] ×';
  close.setAttribute('aria-label', 'Close impact frames');
  head.append(title, close);
  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = 'vbtn shots-switch';
  const showSwitch = () => {
    sw.textContent = `impact frames: ${on ? 'on' : 'off'}`;
    sw.setAttribute('aria-pressed', String(on));
  };
  showSwitch();
  sw.addEventListener('click', () => {
    on = !on;
    try { localStorage.setItem(ON_KEY, on ? 'on' : 'off'); } catch {}
    showSwitch();
    if (open) render();
  });
  const list = document.createElement('div');
  list.className = 'shots-list';
  panel.append(head, sw, list);
  root.append(panel);
  document.body.append(root);

  function card(s) {
    const fig = document.createElement('figure');
    fig.className = 'shot';
    const img = document.createElement('img');
    img.src = s.url;
    img.alt = `Impact frame: ${s.text}`;
    const cap = document.createElement('figcaption');
    const when = new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const save = document.createElement('a');
    save.className = 'vbtn';
    save.href = s.url;
    save.download = shotName(s.at);
    save.textContent = 'save';
    cap.append(`${s.text} · ${when} `, save);
    fig.append(img, cap);
    return fig;
  }
  function render() {
    if (shots.length) return list.replaceChildren(...shots.map(card));
    const p = document.createElement('p');
    p.className = 'shots-none';
    p.textContent = on ? 'none yet: pop someone (or the dummy) and the frame of it is kept here' : 'impact frames are off';
    list.replaceChildren(p);
  }

  let open = false;
  function show() {
    if (open) return;
    open = true;
    render();
    root.hidden = false;
    list.scrollTop = 0;
    onOpen && onOpen();
    close.focus({ preventScroll: true });
  }
  function hide() {
    if (!open) return;
    open = false;
    root.hidden = true;
    onClose && onClose();
  }
  close.addEventListener('click', hide);
  root.addEventListener('click', (e) => { if (e.target === root) hide(); });
  addEventListener('keydown', (e) => {
    if (!open) return;
    e.stopImmediatePropagation();
    if (e.key === 'Escape' || e.code === 'KeyI') { e.preventDefault(); hide(); }
  }, true);

  function keep(url, at, text) {
    shots.unshift({ url, at, text });
    while (shots.length > KEEP) URL.revokeObjectURL(shots.pop().url);
    if (open) render();
    onCount && onCount(shots.length);
  }

  // Called right after the kill's frame is drawn, before the browser shows it (a WebGL canvas is blank to
  // read after that): a plain copy now, cheap; the filter, the PNG and the list once the hold is over
  // (after), so the work never lands on the impact itself.
  function capture(canvas, text, after = 0) {
    if (!canvas.width || !canvas.height) return;
    if (!on) return;
    const at = Date.now(), k = Math.min(1, MAX_W / canvas.width);
    const w = Math.round(canvas.width * k), h = Math.round(canvas.height * k);
    const copy = document.createElement('canvas');
    copy.width = w; copy.height = h;
    try { copy.getContext('2d').drawImage(canvas, 0, 0, w, h); } catch { return; }
    setTimeout(() => {
      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      const ctx = out.getContext('2d');
      if (canFilter()) { ctx.filter = IMPACT_FILTER; ctx.drawImage(copy, 0, 0); }
      else {
        ctx.drawImage(copy, 0, 0);
        const img = ctx.getImageData(0, 0, w, h);
        impactPixels(img.data);
        ctx.putImageData(img, 0, 0);
      }
      out.toBlob((blob) => { if (blob) keep(URL.createObjectURL(blob), at, text); }, 'image/png');
    }, after);
  }

  return {
    capture, show, hide,
    toggle: () => (open ? hide() : show()),
    get isOpen() { return open; },
    get on() { return on; },
    get count() { return shots.length; },
  };
}
