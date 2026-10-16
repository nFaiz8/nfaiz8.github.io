// The arena's keys, rebindable (Faiz's ask): each action has its default keys, and one key of your own can
// take its place, kept in this browser. input.js turns the key you press into the action's first default
// (so the rest of it never knows), and the defaults of a rebound action stop doing it. The arrows always
// move, whatever you bind; the mouse and the phone pad are untouched.
export const ACTIONS = [
  { id: 'left', label: 'left / roll', keys: ['KeyA'] },
  { id: 'right', label: 'right / roll', keys: ['KeyD'] },
  { id: 'up', label: 'jump / climb', keys: ['KeyW'] },
  { id: 'down', label: 'drop / crouch', keys: ['KeyS'] },
  { id: 'jump', label: 'jump', keys: ['Space'] },
  { id: 'crouch', label: 'crouch / crawl', keys: ['ControlLeft', 'ControlRight'] },
  { id: 'fire', label: 'shoot', keys: ['KeyJ'] },
  { id: 'hit', label: 'hit / kick', keys: ['KeyK'] },
  { id: 'hook', label: 'grappling hook', keys: ['KeyG'] },
];
const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));
export const KEYS_STORE = 'arena-keys';
// Esc cancels a rebind; Shift is the sprint held with everything; the rest belong to the browser.
const NEVER = /^(Escape|Tab|Shift|Meta|Alt|OS|CapsLock|ContextMenu|F\d+$)/;

export const canBind = (code) => typeof code === 'string' && code !== '' && !NEVER.test(code);
export const keyOf = (b, id) => b[id] || BY_ID.get(id).keys[0];

// Bind action id to code: an action that had the key takes this one's old key. Only keys away from their
// defaults are kept.
export function bind(b, id, code) {
  if (!BY_ID.has(id) || !canBind(code)) return b;
  const all = Object.fromEntries(ACTIONS.map((a) => [a.id, keyOf(b, a.id)]));
  const other = ACTIONS.find((a) => a.id !== id && all[a.id] === code);
  if (other) all[other.id] = all[id];
  all[id] = code;
  return Object.fromEntries(ACTIONS.filter((a) => all[a.id] !== a.keys[0]).map((a) => [a.id, all[a.id]]));
}

// What a key does in the arena: the default key it stands for, null for a default whose action moved away
// (it does nothing there now), or itself.
export function translate(b) {
  const to = new Map(), freed = new Set();
  for (const a of ACTIONS) {
    if (!b[a.id] || b[a.id] === a.keys[0]) continue;
    to.set(b[a.id], a.keys[0]);
    for (const k of a.keys) freed.add(k);
  }
  return (code) => (to.has(code) ? to.get(code) : freed.has(code) ? null : code);
}

// Bindings from storage: known actions, bindable keys, one action per key.
export function cleanKeys(raw) {
  let b = {};
  if (!raw || typeof raw !== 'object') return b;
  for (const a of ACTIONS) {
    const code = raw[a.id];
    if (canBind(code) && !ACTIONS.some((o) => o.id !== a.id && keyOf(b, o.id) === code)) b = bind(b, a.id, code);
  }
  return b;
}
export function loadKeys() {
  try { return cleanKeys(JSON.parse(localStorage.getItem(KEYS_STORE) || '{}')); } catch { return {}; }
}
export function saveKeys(b) {
  try { localStorage.setItem(KEYS_STORE, JSON.stringify(b)); } catch {}
}

const NAMES = { Space: 'space', ControlLeft: 'ctrl', ControlRight: 'right ctrl', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backquote: '`', Enter: 'enter', Backspace: 'backspace' };
export function keyName(code) {
  if (NAMES[code]) return NAMES[code];
  let m = /^(?:Key|Digit)(.)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(.+)$/.exec(code);
  if (m) return `num ${m[1].toLowerCase()}`;
  return String(code).toLowerCase();
}
