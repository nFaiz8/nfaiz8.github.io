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
function splitAtGaps(list, n, key, slack = 3) {
  const cuts = [];
  for (let i = 1; i < n; i++) {
    const ideal = Math.round((i * list.length) / n);
    let best = ideal, bestGap = -1;
    for (let c = Math.max(cuts.at(-1) + 2 || 2, ideal - slack); c <= Math.min(list.length - 2, ideal + slack); c++) {
      const gap = key(list[c]) - key(list[c - 1]);
      if (gap > bestGap) { bestGap = gap; best = c; }
    }
    cuts.push(best);
  }
  const out = [];
  let start = 0;
  for (const c of [...cuts, list.length]) { out.push(list.slice(start, c)); start = c; }
  return out.filter((r) => r.length);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function roomColor(h) {
  return `hsl(${Math.round(h)} 55% 62%)`;
}

// photos → rooms [{ id, name, subtitle, wing, hue, photos }]
export function groupByColor(photos, perRoom = 12) {
  const tagged = photos.map((p) => ({ p, c: photoColor(p) }));
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
  const runs = wheel.length ? splitAtGaps(wheel, Math.max(1, Math.round(wheel.length / perRoom)), unwrap) : [];

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

  // Colourless photos: the darkest go to the darkroom, the rest to a silver room at the end of the cool wing.
  neutral.sort((a, b) => a.c.lum - b.c.lum);
  const darkCount = neutral.length < 8 ? neutral.length : Math.ceil(neutral.length / 2);
  const dark = neutral.slice(0, darkCount).map((t) => t.p);
  const silver = neutral.slice(darkCount).map((t) => t.p);
  if (silver.length) rooms.push({ id: 'silver', name: 'Silver', subtitle: `${silver.length} photographs · black & white`, wing: 'south', hue: null, photos: silver });
  if (dark.length) rooms.push({ id: 'darkroom', name: 'Darkroom', subtitle: `${dark.length} prints · safelight on`, wing: 'east', hue: 0, photos: dark });
  return rooms;
}
