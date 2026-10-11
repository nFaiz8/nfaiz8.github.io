// Colour analysis of a photo's actual pixels, used to sort photos into rooms. Pure: takes RGBA bytes.
//
// - colorfulness: Hasler & Süsstrunk's metric (0 for greyscale, ~15 muted, ~50+ vivid).
// - sat: average saturation of the pixels that aren't near black, so dark, moody colour photos
//   still count as colour.
// - hue: the dominant hue, weighted towards the most colourful pixels.
// - score: 0..1 "how much colour" combining both; below NEUTRAL (colors.js) it's black & white.

export function analyzePixels(data) {
  let n = 0, sumRg = 0, sumYb = 0, sumRg2 = 0, sumYb2 = 0, sumL = 0, satSum = 0, satN = 0;
  const bins = new Float64Array(36);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const rg = r - g, yb = 0.5 * (r + g) - b;
    sumRg += rg; sumYb += yb; sumRg2 += rg * rg; sumYb2 += yb * yb;
    sumL += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    n++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
    if (mx < 24) continue; // near-black pixels have no reliable colour
    const s = c / mx;
    satSum += s;
    satN++;
    if (c < 12) continue;
    let h;
    if (mx === r) h = ((g - b) / c) % 6;
    else if (mx === g) h = (b - r) / c + 2;
    else h = (r - g) / c + 4;
    h = (h * 60 + 360) % 360;
    bins[Math.floor(h / 10) % 36] += s * s * c; // favour strongly coloured pixels
  }
  if (!n) return { hue: 0, colorfulness: 0, sat: 0, lum: 0, score: 0 };
  const mRg = sumRg / n, mYb = sumYb / n;
  const sdRg = Math.sqrt(Math.max(0, sumRg2 / n - mRg * mRg));
  const sdYb = Math.sqrt(Math.max(0, sumYb2 / n - mYb * mYb));
  const colorfulness = Math.hypot(sdRg, sdYb) + 0.3 * Math.hypot(mRg, mYb);
  const sat = satN ? satSum / satN : 0;

  // Peak of the hue histogram (smoothed over neighbours), refined with a circular mean around it.
  let peak = 0, best = -1;
  for (let k = 0; k < 36; k++) {
    const v = bins[(k + 35) % 36] * 0.5 + bins[k] + bins[(k + 1) % 36] * 0.5;
    if (v > best) { best = v; peak = k; }
  }
  let x = 0, y = 0;
  for (let d = -2; d <= 2; d++) {
    const k = (peak + d + 36) % 36, a = ((k + 0.5) * 10 * Math.PI) / 180;
    x += Math.cos(a) * bins[k];
    y += Math.sin(a) * bins[k];
  }
  const hue = best > 0 ? ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 : 0;

  const score = Math.min(1, Math.max(0, (colorfulness - 4) / 40, (sat - 0.05) / 0.45));
  return {
    hue: Math.round(hue * 10) / 10,
    colorfulness: Math.round(colorfulness * 10) / 10,
    sat: Math.round(sat * 1000) / 1000,
    lum: Math.round((sumL / n) * 1000) / 1000,
    score: Math.round(score * 1000) / 1000,
  };
}
