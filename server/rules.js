import { GUNS } from '../src/fight.js';
import { LEVEL_COLS, LEVEL_ROWS } from '../src/level.js';

// Checks shared by the multiplayer Worker and its tests. Pure: no Workers or Node APIs.
export const LIMITS = { people: 30, instances: 10, perIp: 4, bytes: 200, name: 12, chat: 80, floodDrops: 50, floodWindowMs: 10000, muteS: 600 };
export const EMOTES = ['heart', 'bang', 'ask', 'star', 'wave'];

export function allowedOrigin(origin) {
  return origin === 'https://faiz.pics' || /^http:\/\/localhost(:\d{1,5})?$/.test(origin || '');
}

export const validVersion = (v) => typeof v === 'string' && /^[0-9A-Za-z:.\-]{1,40}$/.test(v);

// Words that may not appear in a name, checked after lower-casing, dropping separators and undoing digit swaps.
const BLOCKED = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'rape', 'nazi', 'hitler', 'kike', 'spic', 'chink',
  'retard', 'whore', 'slut', 'cock', 'dick', 'pussy', 'porn', 'cum', 'tits'];
const SWAPS = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' };

export function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (!name) return '';
  if (name.length > LIMITS.name || !/^[A-Za-z0-9 ._-]+$/.test(name)) return null;
  const flat = name.toLowerCase().replace(/[ ._-]/g, '').replace(/[0-9]/g, (d) => SWAPS[d] || d);
  return BLOCKED.some((w) => flat.includes(w)) ? null : name;
}

// Chat is sentences, so it is checked word by word: some words match wherever they appear, some only at
// the start of a word (so "Scunthorpe" is fine), and some only as a whole word (so "cockpit" and "cumulus"
// are fine). Letters spelled out one at a time ("f u c k", "f.u.c.k") are joined back up first.
// Swears are censored, one letter starred (sh*t, f*ck); a slur isn't sent at all and mutes the sender's
// chat for LIMITS.muteS (chat filter addendum).
const ANYWHERE = ['fuck', 'shit', 'whore', 'slut', 'pussy', 'hitler', 'porn', 'bitch'];
const PREFIX = ['cunt', 'nazi'];
const WHOLE = ['cum', 'cock', 'dick', 'rape', 'raped', 'rapist', 'tits', 'twat'];
const SLUR_ANYWHERE = ['nigg', 'kike'];
const SLUR_PREFIX = ['fag', 'retard'];
const SLUR_WHOLE = ['spic', 'chink', 'coon', 'tranny', 'trannie'];
const NOT_SLURS = ['snigger', 'retardant', 'fagiol']; // innocent words that start like one

// The words of a line as letters, each with its index in the line: lower-cased, digit swaps undone,
// punctuation dropped, and a run of single letters joined into one word.
function wordsOf(text) {
  const words = [];
  let run = [];
  for (const m of text.matchAll(/\S+/g)) {
    const w = [];
    for (let i = 0; i < m[0].length; i++) {
      const c = m[0][i].toLowerCase();
      if (/[a-z]/.test(c)) w.push({ c, at: m.index + i });
      else if (/[0-9]/.test(c)) w.push({ c: SWAPS[c] || c, at: m.index + i });
    }
    if (w.length === 1) { run.push(w[0]); continue; }
    if (run.length) { words.push(run); run = []; }
    if (w.length) words.push(w);
  }
  if (run.length) words.push(run);
  return words;
}

// Where in word w (a string) each listed word matches: [start, length] pairs.
function matches(w, anywhere, prefix, whole) {
  const out = [];
  for (const b of anywhere) for (let i = w.indexOf(b); i >= 0; i = w.indexOf(b, i + b.length)) out.push([i, b.length]);
  for (const b of prefix) if (w.startsWith(b)) out.push([0, b.length]);
  for (const b of whole) if (w === b || w === b + 's') out.push([0, b.length]);
  return out;
}

const plain = (raw) => {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  return !text || text.length > LIMITS.chat || !/^[\x20-\x7E]+$/.test(text) ? null : text;
};

// Whether a line has a slur in it (its sender is muted instead).
export function hasSlur(raw) {
  const text = plain(raw);
  return !!text && wordsOf(text).some((l) => {
    const w = l.map((q) => q.c).join('');
    return !NOT_SLURS.some((ok) => w.startsWith(ok)) && matches(w, SLUR_ANYWHERE, SLUR_PREFIX, SLUR_WHOLE).length > 0;
  });
}

// The line as it is shown: trimmed, with one letter of each swear starred (the first vowel after its first
// letter, or its middle letter), or null if it can't be sent (empty, too long, outside the drawable set).
export function cleanText(raw) {
  const text = plain(raw);
  if (text === null) return null;
  const out = text.split('');
  for (const w of wordsOf(text)) {
    for (const [i, n] of matches(w.map((l) => l.c).join(''), ANYWHERE, PREFIX, WHOLE)) {
      let k = w.slice(i + 1, i + n).findIndex((l) => 'aeiou'.includes(l.c));
      k = k >= 0 ? i + 1 + k : i + Math.floor(n / 2);
      out[w[k].at] = '*';
    }
  }
  return out.join('');
}

const pos = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 2000;

const num = (n) => typeof n === 'number' && Number.isFinite(n);
const within = (n, max) => num(n) && Math.abs(n) <= max;
// The level, a cell around it, and three cells out through the door at its east end.
const inArena = (x, y) => num(x) && num(y) && x >= -1 && x <= LEVEL_COLS + 3 && y >= -1 && y <= LEVEL_ROWS + 1;
const stamp = (n) => Number.isInteger(n) && n >= 0 && n <= 1e9;
const round = (n, k) => Math.round(n * k) / k;

export function parseMessage(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > LIMITS.bytes) return null;
  let m;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  switch (m.t) {
    case 'hi': {
      if (m.name !== undefined && typeof m.name !== 'string') return null;
      if (m.x === undefined && m.y === undefined) return { t: 'hi', name: m.name || '' };
      return pos(m.x) && pos(m.y) ? { t: 'hi', name: m.name || '', x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10 } : null;
    }
    case 'n': return typeof m.name === 'string' ? { t: 'n', name: m.name } : null;
    case 'c': return typeof m.text === 'string' && m.text.length >= 1 && m.text.length <= LIMITS.chat ? { t: 'c', text: m.text } : null;
    case 'p': return pos(m.x) && pos(m.y) ? { t: 'p', x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10 } : null;
    case 'e': return EMOTES.includes(m.e) ? { t: 'e', e: m.e } : null;
    case 'r': return typeof m.f === 'string' && m.f.length >= 1 && m.f.length <= 64 ? { t: 'r', f: m.f } : null;
    case 'ae': case 'al': case 'rs': return { t: m.t };
    case 'a': {
      if (!inArena(m.x, m.y) || !within(m.vx, 60) || !within(m.vy, 60) || (m.f !== -1 && m.f !== 1) || (m.g !== 0 && m.g !== 1)) return null;
      if (!Number.isInteger(m.i) || m.i < 0 || m.i > 255 || !within(m.a, Math.PI / 2 + 1e-9) || !stamp(m.ts)) return null;
      return { t: 'a', x: round(m.x, 100), y: round(m.y, 100), vx: round(m.vx, 10), vy: round(m.vy, 10), f: m.f, g: m.g, i: m.i, a: round(m.a, 100), ts: m.ts };
    }
    case 'f': {
      if (!inArena(m.x, m.y) || !within(m.a, Math.PI + 1e-9) || !stamp(m.ts)) return null;
      return { t: 'f', x: round(m.x, 100), y: round(m.y, 100), a: round(m.a, 100), ts: m.ts };
    }
    case 'm': return (m.k === 'p' || m.k === 'k') && stamp(m.ts) ? { t: 'm', k: m.k, ts: m.ts } : null;
    case 'pk': return Number.isInteger(m.n) && m.n >= 0 && m.n <= 15 ? { t: 'pk', n: m.n } : null;
    default: return null;
  }
}

// Token buckets: capacity and refill per second. 'ae' covers both ae and al.
const RATES = { p: [8, 8], e: [1, 1], r: [1, 0.5], n: [1, 0.2], c: [1, 0.5], a: [24, 20], pk: [2, 2], m: [2, 3.4], ae: [4, 1], rs: [2, 1] };
export function newBuckets(now) {
  return Object.fromEntries(Object.entries(RATES).map(([k, [cap]]) => [k, { tokens: cap, at: now }]));
}
function takeAt(b, kind, cap, rate, now) {
  const s = b[kind] || (b[kind] = { tokens: cap, at: now });
  s.tokens = Math.min(cap, s.tokens + ((now - s.at) / 1000) * rate);
  s.at = now;
  if (s.tokens < 1) return false;
  s.tokens -= 1;
  return true;
}
export function take(b, kind, now) {
  const [cap, rate] = RATES[kind];
  return takeAt(b, kind, cap, rate, now);
}
// Shots: 2 in hand, refilling a little faster than the gun's own cooldown.
export const takeShot = (b, gun, now) => takeAt(b, 'f', 2, 1.15 / GUNS[gun].cooldown, now);

// Pull a too-fast move back along its line: at most 60 cells/s, plus 25% and half a cell of slack.
export function clampMove(prev, next, gapMs) {
  const lim = 60 * (gapMs / 1000) * 1.25 + 0.5;
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const k = Math.min(1, lim / Math.abs(dx), lim / Math.abs(dy));
  return k >= 1 ? next : { ...next, x: prev.x + dx * k, y: prev.y + dy * k };
}

// A sender's ms clock mapped onto the server's. The offset follows the fastest delivery seen in each
// 5 s window, and a clock running ahead can claim at most 300 ms.
export const senderClock = () => ({ base: null, lo: Infinity, raw: Infinity, loAt: 0 });
export function sentAt(clock, ts, nowMs) {
  const off = nowMs - ts;
  if (clock.base === null) { clock.base = off; clock.loAt = nowMs; }
  clock.raw = Math.min(clock.raw, off);
  if (off >= clock.base - 300) clock.lo = Math.min(clock.lo, off); // a stamp from the far future says nothing about the network
  if (nowMs - clock.loAt >= 5000) {
    if (Number.isFinite(clock.lo)) clock.base = clock.lo;
    else clock.base += Math.max(-300, Math.min(300, clock.raw - clock.base)); // a whole window refused: follow the offset, 300 ms at a time
    clock.lo = Infinity;
    clock.raw = Infinity;
    clock.loAt = nowMs;
  }
  return Math.min(clock.base + ts, nowMs + 300);
}

export const newFlood = (now) => ({ start: now, drops: 0 });
export function dropped(f, now) {
  if (now - f.start > LIMITS.floodWindowMs) { f.start = now; f.drops = 0; }
  f.drops++;
  return f.drops > LIMITS.floodDrops;
}
