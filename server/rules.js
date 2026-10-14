// Checks shared by the multiplayer Worker and its tests. Pure: no Workers or Node APIs.
export const LIMITS = { people: 30, instances: 10, perIp: 4, bytes: 200, name: 12, chat: 80, floodDrops: 50, floodWindowMs: 10000 };
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

// Chat is sentences, so it is checked word by word: some words are blocked wherever they appear, some
// only at the start of a word (so "Scunthorpe" is fine), and some only as a whole word (so "cockpit" and
// "cumulus" are fine). Letters spelled out one at a time ("f u c k", "f.u.c.k") are joined back up first.
const ANYWHERE = ['fuck', 'shit', 'nigg', 'whore', 'slut', 'pussy', 'retard', 'hitler', 'kike', 'porn'];
const PREFIX = ['cunt', 'nazi', 'fag'];
const WHOLE = ['cum', 'cock', 'dick', 'spic', 'rape', 'raped', 'rapist', 'tits', 'twat', 'chink'];

export function cleanText(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || text.length > LIMITS.chat || !/^[\x20-\x7E]+$/.test(text)) return null;
  const words = [];
  let run = '';
  for (const token of text.toLowerCase().split(/\s+/)) {
    const w = token.replace(/[^a-z0-9]/g, '').replace(/[0-9]/g, (d) => SWAPS[d] || d);
    if (w.length === 1) { run += w; continue; }
    if (run) { words.push(run); run = ''; }
    if (w) words.push(w);
  }
  if (run) words.push(run);
  const bad = (w) => ANYWHERE.some((b) => w.includes(b)) || PREFIX.some((b) => w.startsWith(b))
    || WHOLE.some((b) => w === b || w === b + 's');
  return words.some(bad) ? null : text;
}

const pos = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 2000;

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
    default: return null;
  }
}

// Token buckets: capacity and refill per second.
const RATES = { p: [8, 8], e: [1, 1], r: [1, 0.5], n: [1, 0.2], c: [1, 0.5] };
export function newBuckets(now) {
  return Object.fromEntries(Object.entries(RATES).map(([k, [cap]]) => [k, { tokens: cap, at: now }]));
}
export function take(b, kind, now) {
  const [cap, rate] = RATES[kind];
  const s = b[kind] || (b[kind] = { tokens: cap, at: now });
  s.tokens = Math.min(cap, s.tokens + ((now - s.at) / 1000) * rate);
  s.at = now;
  if (s.tokens < 1) return false;
  s.tokens -= 1;
  return true;
}

export const newFlood = (now) => ({ start: now, drops: 0 });
export function dropped(f, now) {
  if (now - f.start > LIMITS.floodWindowMs) { f.start = now; f.drops = 0; }
  f.drops++;
  return f.drops > LIMITS.floodDrops;
}
