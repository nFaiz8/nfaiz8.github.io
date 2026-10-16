// The arena's keys screen: each action with its key; click one (or focus it and press Enter), then press the
// key you want. Esc cancels that; a key another action has swaps the two. / or the HUD button opens it;
// Esc, / or a click outside closes it. Kept in this browser (src/keys.js).
import { ACTIONS, bind, keyOf, keyName, canBind } from './keys.js';

const ALSO = { left: '←', right: '→', up: '↑', down: '↓' }; // the arrows always do these too

export function createKeyScreen({ get, set, onOpen, onClose } = {}) {
  const root = document.createElement('div');
  root.className = 'map keys';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Arena keys');
  const panel = document.createElement('div');
  panel.className = 'map-panel keys-panel';
  const head = document.createElement('div');
  head.className = 'map-head';
  const title = document.createElement('span');
  title.textContent = 'arena keys · click one, then press a key';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'vbtn';
  close.textContent = '[esc] ×';
  close.setAttribute('aria-label', 'Close arena keys');
  head.append(title, close);
  const list = document.createElement('div');
  list.className = 'keys-list';
  const foot = document.createElement('div');
  foot.className = 'keys-foot';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'vbtn';
  reset.textContent = 'reset to defaults';
  const said = document.createElement('span');
  said.className = 'keys-said';
  said.setAttribute('role', 'status');
  const mouseNote = document.createElement('span');
  mouseNote.className = 'keys-said';
  mouseNote.textContent = 'mouse: aim · left shoots · right hits';
  foot.append(reset, said);
  panel.append(head, list, mouseNote, foot);
  root.append(panel);
  document.body.append(root);

  let open = false, waiting = null; // waiting: the action id whose new key is wanted
  const buttons = new Map();
  function render() {
    const b = get();
    list.replaceChildren(...ACTIONS.map((a) => {
      const row = document.createElement('div');
      row.className = 'keys-row';
      const label = document.createElement('span');
      label.textContent = a.label;
      const btn = buttons.get(a.id) || document.createElement('button');
      btn.type = 'button';
      btn.className = 'vbtn keys-key' + (b[a.id] ? ' moved' : '');
      btn.textContent = waiting === a.id ? 'press a key…' : keyName(keyOf(b, a.id)) + (a.id === 'crouch' && !b.crouch ? ' (either)' : '');
      btn.setAttribute('aria-label', `${a.label}: ${keyName(keyOf(b, a.id))}. Change`);
      btn.onclick = () => { waiting = waiting === a.id ? null : a.id; said.textContent = ''; render(); if (waiting) btn.focus({ preventScroll: true }); };
      buttons.set(a.id, btn);
      const also = document.createElement('span'); // always there, empty or not: the rows share one grid
      also.className = 'keys-also';
      also.textContent = ALSO[a.id] ? `also ${ALSO[a.id]}` : '';
      row.append(label, btn, also);
      return row;
    }));
  }
  reset.addEventListener('click', () => { waiting = null; set({}); said.textContent = 'back to the defaults'; render(); });

  function show() {
    if (open) return;
    open = true;
    waiting = null;
    said.textContent = '';
    render();
    root.hidden = false;
    onOpen && onOpen();
    close.focus({ preventScroll: true });
  }
  function hide() {
    if (!open) return;
    open = false;
    waiting = null;
    root.hidden = true;
    onClose && onClose();
  }
  close.addEventListener('click', hide);
  root.addEventListener('click', (e) => { if (e.target === root) hide(); });
  addEventListener('keydown', (e) => {
    if (!open) return;
    e.stopImmediatePropagation();
    if (waiting) {
      e.preventDefault();
      if (e.code === 'Escape') { waiting = null; render(); return; }
      if (!canBind(e.code)) { said.textContent = `${keyName(e.code)} can't be used`; return; }
      const id = waiting, before = get(), next = bind(before, id, e.code);
      const other = ACTIONS.find((a) => a.id !== id && keyOf(before, a.id) === e.code);
      waiting = null;
      set(next);
      said.textContent = other ? `swapped with ${other.label}` : '';
      render();
      buttons.get(id).focus({ preventScroll: true });
      return;
    }
    if (e.key === 'Escape' || e.code === 'Slash') { e.preventDefault(); hide(); }
  }, true);

  return {
    show, hide,
    toggle: () => (open ? hide() : show()),
    get isOpen() { return open; },
  };
}
