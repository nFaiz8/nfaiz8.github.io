// Checks shared by the multiplayer Worker and its tests. Pure: no Workers or Node APIs.
export const LIMITS = { people: 30, instances: 10, perIp: 4, bytes: 200, name: 12, floodDrops: 50, floodWindowMs: 10000 };
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

const pos = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 2000;

export function parseMessage(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > LIMITS.bytes) return null;
  let m;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  switch (m.t) {
    case 'hi': return m.name === undefined || typeof m.name === 'string' ? { t: 'hi', name: m.name || '' } : null;
    case 'n': return typeof m.name === 'string' ? { t: 'n', name: m.name } : null;
    case 'p': return pos(m.x) && pos(m.y) ? { t: 'p', x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10 } : null;
    case 'e': return EMOTES.includes(m.e) ? { t: 'e', e: m.e } : null;
    case 'r': return typeof m.f === 'string' && m.f.length >= 1 && m.f.length <= 64 ? { t: 'r', f: m.f } : null;
    default: return null;
  }
}

// Token buckets: capacity and refill per second.
const RATES = { p: [8, 8], e: [1, 1], r: [1, 0.5], n: [1, 0.2] };
export function newBuckets(now) {
  return Object.fromEntries(Object.entries(RATES).map(([k, [cap]]) => [k, { tokens: cap, at: now }]));
}
export function take(b, kind, now) {
  const [cap, rate] = RATES[kind];
  const s = b[kind];
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
