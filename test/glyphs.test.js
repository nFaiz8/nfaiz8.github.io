import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellMetrics, sideMetrics, isShape } from '../src/render/glyphs.js';

const view = (w, h) => { const m = cellMetrics(w, h); return { cols: Math.floor(w / m.cw), rows: Math.floor(h / m.ch) }; };

test('a landscape phone sees about as much of the gallery as a computer, not a 12-row close-up', () => {
  const v = view(852, 393);
  assert.ok(v.cols >= 120 && v.rows >= 28, `${v.cols}×${v.rows}`);
});

test('portrait phones and desktops are unchanged', () => {
  assert.deepEqual(cellMetrics(393, 852), cellMetrics(393));
  assert.deepEqual(cellMetrics(1440, 900), cellMetrics(1440));
  assert.ok(view(1440, 900).cols >= 150);
});

test('side view metrics: crisp at rest (whole device pixels, at least the rows asked for), exact while easing', () => {
  for (const [h, dpr] of [[900, 2], [393, 2], [393, 3], [768, 1]]) {
    for (const rows of [20, 25, 33]) {
      const m = sideMetrics(h, dpr, rows);
      assert.equal(m.ch, m.cw * 2);
      assert.ok(Number.isInteger(Math.round(m.cw * dpr * 1e6) / 1e6), `${h}@${dpr} ${rows}: ${m.cw * dpr} device px`);
      const shown = h / m.ch;
      assert.ok(shown >= rows && shown < rows * 1.12, `${h}@${dpr}: ${rows} rows asked, ${shown.toFixed(2)} shown`);
      assert.ok(m.fontPx >= 6 && m.font.includes(`${m.fontPx}px`));
      const e = sideMetrics(h, dpr, rows, false);
      assert.ok(Math.abs(h / e.ch - rows) < 1e-9, 'exact while easing');
    }
  }
});

test('the train\'s line glyphs are drawn as shapes, so they join across cells', () => {
  for (const c of '━┃┷╌╎╭╮╰╯▀▄▌▐╱╲─│═█░') assert.ok(isShape(c), c);
  assert.equal(isShape('A'), false);
});
