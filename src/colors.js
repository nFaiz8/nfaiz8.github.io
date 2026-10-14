// Groups photos into rooms by the colours in them, using the palette the pipeline extracted.

export function hexToHsl(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  if (d) {
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

export const NEUTRAL = 0.12; // colour score below this counts as black & white / colourless

// The photo's most telling colour: the palette entry that is saturated without being near black or white.
export function photoColor(p) {
  // Measured from the photo's pixels (scripts/prepare-photos.mjs); the palette is a fallback.
  const a = p.analysis;
  if (a && typeof a.score === 'number') return { h: a.hue, s: a.sat, score: a.score, lum: a.lum };
  const cs = (p.palette && p.palette.length ? p.palette : ['#808080']).map(hexToHsl);
  const scored = cs.map((c) => ({ ...c, score: c.s * Math.min(1, c.l * 3) * (1 - Math.max(0, c.l - 0.85) * 4) }));
  scored.sort((a, b) => b.score - a.score);
  const lum = cs.reduce((s, c) => s + c.l, 0) / cs.length;
  return { h: scored[0].h, s: scored[0].s, score: scored[0].score, lum };
}

const NAMES = [
  [0, 'Red'], [15, 'Vermilion'], [28, 'Rust'], [38, 'Amber'], [48, 'Gold'], [60, 'Ochre'], [75, 'Olive'],
  [100, 'Moss'], [130, 'Green'], [160, 'Jade'], [180, 'Teal'], [195, 'Cyan'], [210, 'Sky'], [225, 'Blue'],
  [250, 'Indigo'], [275, 'Violet'], [300, 'Magenta'], [325, 'Rose'], [345, 'Red'],
];
export function hueName(h) {
  let name = NAMES[0][1];
  for (const [start, n] of NAMES) if (h >= start) name = n;
  return name;
}

// Circular mean of hues in degrees.
export function meanHue(hues) {
  const x = hues.reduce((s, h) => s + Math.cos((h * Math.PI) / 180), 0);
  const y = hues.reduce((s, h) => s + Math.sin((h * Math.PI) / 180), 0);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Split an ordered list into n runs of near-equal size, nudging each cut to the biggest gap in key()
// within ±slack items, so rooms break where the colour actually changes.
// Rooms follow the colour wheel: a new room wherever the hues jump, small runs folded into the nearer
// neighbour, and any room still wider than MAX_SPAN degrees (or bigger than MAX_ROOM) cut at its widest gap.
const BREAK = 15, MAX_SPAN = 30, MIN_ROOM = 4, MAX_ROOM = 16;
function splitByHue(list, key) {
  if (!list.length) return [];
  let runs = [[list[0]]];
  for (let i = 1; i < list.length; i++) {
    if (key(list[i]) - key(list[i - 1]) > BREAK) runs.push([]);
    runs.at(-1).push(list[i]);
  }
  // Fold small runs into the neighbour whose nearest photo is closest in hue, smallest first.
  for (;;) {
    const small = runs.filter((r) => r.length < MIN_ROOM).sort((a, b) => a.length - b.length)[0];
    if (!small || runs.length === 1) break;
    const i = runs.indexOf(small);
    const before = i > 0 ? key(small[0]) - key(runs[i - 1].at(-1)) : Infinity;
    const after = i < runs.length - 1 ? key(runs[i + 1][0]) - key(small.at(-1)) : Infinity;
    const j = before <= after ? i - 1 : i + 1;
    runs[j] = j < i ? [...runs[j], ...small] : [...small, ...runs[j]];
    runs.splice(i, 1);
  }
  const span = (r) => key(r.at(-1)) - key(r[0]);
  const cut = (r) => {
    if (r.length < MIN_ROOM * 2 || (span(r) <= MAX_SPAN && r.length <= MAX_ROOM)) return [r];
    let best = MIN_ROOM, bestGap = -1;
    for (let c = MIN_ROOM; c <= r.length - MIN_ROOM; c++) {
      const gap = key(r[c]) - key(r[c - 1]);
      // Widest gap wins; on a tie, the cut nearer the middle.
      if (gap > bestGap + 1e-9 || (Math.abs(gap - bestGap) < 1e-9 && Math.abs(c - r.length / 2) < Math.abs(best - r.length / 2))) { bestGap = gap; best = c; }
    }
    return [...cut(r.slice(0, best)), ...cut(r.slice(best))];
  };
  return runs.flatMap(cut);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function roomColor(h) {
  return `hsl(${Math.round(h)} 55% 62%)`;
}

// photos → rooms [{ id, name, subtitle, wing, hue, photos }]
export function groupByColor(photos) {
  // Film always hangs in the darkroom; everything else is sorted by colour.
  const film = photos.filter((p) => p.category === 'film');
  const tagged = photos.filter((p) => p.category !== 'film').map((p) => ({ p, c: photoColor(p) }));
  const colored = tagged.filter((t) => t.c.score >= NEUTRAL);
  const neutral = tagged.filter((t) => t.c.score < NEUTRAL);

  // Start the colour wheel at its biggest empty gap so similar hues stay together.
  colored.sort((a, b) => a.c.h - b.c.h);
  let gapAt = 0, gap = -1;
  colored.forEach((t, i) => {
    const prev = colored[(i - 1 + colored.length) % colored.length].c.h;
    const g = (t.c.h - prev + 360) % 360 || (colored.length === 1 ? 360 : 0);
    if (g > gap) { gap = g; gapAt = i; }
  });
  const wheel = [...colored.slice(gapAt), ...colored.slice(0, gapAt)];
  const base = wheel.length ? wheel[0].c.h : 0;
  const unwrap = (t) => (t.c.h - base + 360) % 360;
  const runs = splitByHue(wheel, unwrap);

  const rooms = runs.map((run) => {
    const hue = meanHue(run.map((t) => t.c.h));
    return { name: hueName(hue), hue, photos: run.map((t) => t.p) };
  });
  // Number repeated names: Amber, Amber II …
  const seen = {};
  for (const r of rooms) {
    seen[r.name] = (seen[r.name] || 0) + 1;
    if (seen[r.name] > 1) r.name = `${r.name} ${['', 'I', 'II', 'III', 'IV', 'V'][seen[r.name]] || seen[r.name]}`;
  }
  const half = Math.ceil(rooms.length / 2);
  rooms.forEach((r, i) => {
    r.id = slug(r.name);
    r.wing = i < half ? 'north' : 'south';
    r.subtitle = `${r.photos.length} photographs`;
  });

  // Black & white digital photos get a silver room at the end of the cool wing.
  neutral.sort((a, b) => a.c.lum - b.c.lum);
  const silver = neutral.map((t) => t.p);
  if (silver.length) rooms.push({ id: 'silver', name: 'Silver', subtitle: `${silver.length} photographs · black & white`, wing: 'south', hue: null, photos: silver });
  if (film.length) rooms.push({ id: 'darkroom', name: 'Darkroom', subtitle: `${film.length} film prints · safelight on`, wing: 'east', hue: 0, photos: film });
  return rooms;
}
