// Equal-height rows of photos at their own shapes (no cropping), each full row stretched or shrunk to
// fill the width exactly. A photo too wide for a row at the target height (a panorama) gets a row of
// its own, scaled down to the width.
// aspects: width/height per photo → rows [{ h, items: [{ i, w, h }] }]
export function justify(aspects, width, rowH, gap = 0) {
  const rows = [];
  let row = []; // indexes
  const sum = (idx) => idx.reduce((s, i) => s + aspects[i], 0);
  const fitH = (idx) => (width - gap * (idx.length - 1)) / sum(idx);
  const push = (idx, h) => rows.push({ h, items: idx.map((i) => ({ i, w: aspects[i] * h, h })) });
  // Never stretch a short row (e.g. one portrait before a panorama) past this; it stays a bit narrow instead.
  const close = (idx) => { if (idx.length) push(idx, Math.min(fitH(idx), rowH * 1.5)); };

  aspects.forEach((a, i) => {
    if (a * rowH >= width) {
      close(row);
      row = [];
      push([i], width / a);
      return;
    }
    const next = [...row, i];
    if (sum(next) * rowH + gap * row.length <= width) { row = next; return; }
    // Overflowing: end the row before or after this photo, whichever lands nearer the target height.
    const without = fitH(row), withIt = fitH(next);
    if (Math.abs(Math.log(without / rowH)) < Math.abs(Math.log(withIt / rowH))) {
      close(row);
      row = [i];
    } else {
      push(next, withIt);
      row = [];
    }
  });
  if (row.length) push(row, rowH);
  return rows;
}
