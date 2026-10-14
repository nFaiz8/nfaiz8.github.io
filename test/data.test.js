import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { indexData, captionText, plaqueText, loadData } from '../src/data.js';
import { groupByColor, hueName, meanHue, photoColor } from '../src/colors.js';

const photo = (id, palette, extra = {}) => ({ id, palette, aspect: 1.5, width: 3000, height: 2000, category: 'digital', camera: 'Fujifilm X-H2S', year: 2024, ...extra });
const real = JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)));

test('photoColor picks the saturated palette entry, not black', () => {
  const c = photoColor(photo('a', ['#050505', '#c03020', '#202020', '#f0f0f0']));
  assert.ok(c.h < 15 && c.score > 0.3);
  assert.ok(photoColor(photo('g', ['#101010', '#808080', '#e0e0e0'])).score < 0.12);
});

test('hue helpers', () => {
  assert.equal(hueName(40), 'Amber');
  assert.equal(hueName(220), 'Sky');
  assert.ok(Math.abs(meanHue([350, 10]) % 360) < 1 || Math.abs(meanHue([350, 10]) - 360) < 1);
});

test('rooms group by colour: reds together, blues together, black & white in silver', () => {
  const ps = [
    ...Array.from({ length: 12 }, (_, i) => photo(`r${i}`, ['#000000', `#${(0xc0 + i).toString(16)}2010`])),
    ...Array.from({ length: 12 }, (_, i) => photo(`b${i}`, ['#000000', `#1030${(0xc0 + i).toString(16)}`])),
    ...Array.from({ length: 10 }, (_, i) => photo(`g${i}`, ['#000000', `#${(0x10 * (i + 2)).toString(16).padStart(2, '0').repeat(3)}`])),
  ];
  const rooms = groupByColor(ps);
  const where = (id) => rooms.find((r) => r.photos.some((p) => p.id === id)).id;
  assert.equal(new Set(ps.filter((p) => p.id[0] === 'r').map((p) => where(p.id))).size, 1);
  assert.equal(new Set(ps.filter((p) => p.id[0] === 'b').map((p) => where(p.id))).size, 1);
  assert.notEqual(where('r0'), where('b0'));
  assert.equal(where('g0'), 'silver', 'black & white digital goes to silver');
  assert.equal(where('g9'), 'silver');
});

test('colour rooms stay narrow: no room spans more than 30° of the colour wheel', () => {
  const hued = (id, h) => ({ id, category: 'digital', analysis: { hue: h, sat: 0.6, score: 0.5, lum: 0.4 } });
  // Like the live Gold room: orange through yellow to green, evenly spread.
  const ps = Array.from({ length: 16 }, (_, i) => hued(`g${i}`, 32 + i * 4.6));
  const rooms = groupByColor(ps);
  assert.ok(rooms.length >= 3, `${rooms.length} rooms`);
  for (const r of rooms) {
    const hs = r.photos.map((p) => p.analysis.hue);
    assert.ok(Math.max(...hs) - Math.min(...hs) <= 30, `${r.name}: ${Math.min(...hs)}–${Math.max(...hs)}`);
    assert.ok(r.photos.length >= 4, `${r.name} has ${r.photos.length}`);
  }
});

test('a stray photo joins the nearest room instead of getting a room of its own', () => {
  const hued = (id, h) => ({ id, category: 'digital', analysis: { hue: h, sat: 0.6, score: 0.5, lum: 0.4 } });
  const ps = [...Array.from({ length: 8 }, (_, i) => hued(`r${i}`, 2 + i * 3)), ...Array.from({ length: 8 }, (_, i) => hued(`t${i}`, 180 + i * 3)), hued('odd', 240)];
  const rooms = groupByColor(ps);
  const home = rooms.find((r) => r.photos.some((p) => p.id === 'odd'));
  assert.ok(home.photos.length >= 4, `the stray's room has ${home.photos.length}`);
  assert.ok(home.photos.some((p) => p.id[0] === 't'), 'joins the blue-green photos, the nearer ones');
});

test('real data: every visible photo lands in exactly one room of a sensible size', () => {
  const d = indexData(real);
  const ids = d.rooms.flatMap((r) => r.photos.map((p) => p.id));
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(ids.length, real.photos.filter((p) => !p.hidden && !p.variantOf).length);
  for (const r of d.rooms) assert.ok(r.photos.length >= 4 && r.photos.length <= 18, `${r.id} has ${r.photos.length}`);
  assert.equal(new Set(d.rooms.map((r) => r.id)).size, d.rooms.length, 'room ids are unique');
});

test('indexData rejects malformed manifests', () => {
  assert.throws(() => indexData({}), /malformed/);
  assert.throws(() => indexData(null), /malformed/);
});

test('captions leave out missing fields; film says film', () => {
  assert.equal(captionText(photo('x', [], { lens: null, aperture: null, shutter: '1/250s', iso: 160, location: 'Bukhara' })),
    'Fujifilm X-H2S · 1/250s · ISO 160 · Bukhara, 2024');
  assert.equal(plaqueText(photo('f', [], { category: 'film', camera: null })), 'film · 2024');
  assert.equal(captionText(photo('f', [], { category: 'film', camera: null, scanner: 'Noritsu', lens: null, iso: null })), 'film · Noritsu scan · 2024');
});

test('photos never show a title or file name', () => {
  const p = photo('DSCF7438', [], { title: 'A title', lens: 'XF23mmF1.4', aperture: 2, iso: 400 });
  for (const text of [captionText(p), plaqueText(p)]) {
    assert.ok(!text.includes('DSCF7438') && !text.includes('A title'), text);
  }
});

test('excluded photos are left out of every room', () => {
  const d = indexData(real, ['DSCF7326']);
  assert.ok(!d.rooms.some((r) => r.photos.some((p) => p.id === 'DSCF7326')));
  assert.equal(d.rooms.flatMap((r) => r.photos).length, real.photos.filter((p) => !p.hidden && !p.variantOf && p.id !== 'DSCF7326').length);
});

test('alternate edits are not hung on the walls', () => {
  const ps = [photo('a', ['#c03020']), photo('a-2', ['#c03020'], { variantOf: 'a' })];
  const d = indexData({ photos: ps });
  const ids = d.rooms.flatMap((r) => r.photos.map((p) => p.id));
  assert.ok(ids.includes('a') && !ids.includes('a-2'));
  assert.ok(d.byId.has('a-2'), 'but the viewer can still find them');
});

test('loadData asks the server for a fresh photos.json instead of using a cached copy', async () => {
  const real = globalThis.fetch;
  let init;
  globalThis.fetch = async (url, opts) => { init = opts; return new Response(JSON.stringify({ photos: [] })); };
  try { await loadData(); } finally { globalThis.fetch = real; }
  assert.equal(init?.cache, 'no-cache');
});

test('indexData passes on the manifest generated time (the multiplayer instance key)', () => {
  assert.equal(indexData({ photos: [], generated: 'g' }).generated, 'g');
});

test('a photo excluded for the arena is off the colour-room walls but still findable by id', () => {
  const d = indexData(real, ['IMG_1003']);
  assert.ok(!d.rooms.some((r) => r.photos.some((p) => p.id === 'IMG_1003')));
  assert.equal(d.byId.get('IMG_1003').id, 'IMG_1003');
});
