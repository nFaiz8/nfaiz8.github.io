// The station (station spec §6): down the lobby's stairs, walking, a passing train, back up, the back button, a direct link,
// a resize, a portrait phone, many trips, and staying in the gallery when the station can't load.
// Usage: node e2e/station.mjs
import { withBrowser, ready, sleep, SHOTS } from './lib.mjs';
import { startOf } from '../src/rpg/train.js';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const results = [];
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const check = async (name, fn) => {
  if (only && !only.test(name)) return;
  try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message]); }
};
const inStation = (page) => page.waitForFunction(() => window.__station && window.__station.frames() > 20, { timeout: 30000 });
const backInGallery = (page) => page.waitForFunction(() => !window.__station && window.__ascii.station() === 'off' && !window.__ascii.world.frozen, { timeout: 15000 });
const takeStairs = (page) => page.evaluate(() => { const s = window.__ascii.map.stairs.inside; window.__ascii.walkTo(s.x + 2, s.y); });

// Every console message's text, for the WebGL-context warning Chrome gives when contexts pile up.
const consoleLog = [];
const nFrames = (page, n) => page.evaluate((n) => new Promise((done) => { const f = () => (--n <= 0 ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

await withBrowser(async ({ page, url, errors }) => {
  page.on('console', (m) => consoleLog.push(m.text()));
  await page.goto(url);
  await ready(page);

  await check('walking onto the lobby stairs goes down to the station', async () => {
    await takeStairs(page);
    await inStation(page);
    assert.equal(await page.evaluate(() => location.hash), '#/station');
    assert.equal(await page.evaluate(() => document.body.classList.contains('in-station')), true);
  });

  await check('the station draws something', async () => {
    await sleep(500);
    const shot = await page.screenshot({ path: `${SHOTS}/station-hall.png` });
    const { channels } = await sharp(shot).stats();
    assert.ok(channels.some((c) => c.stdev > 8), 'not a blank screen');
  });

  await check('you walk', async () => {
    const a = await page.evaluate(() => ({ ...window.__station.walker }));
    await page.keyboard.down('KeyD');
    try { await sleep(600); } finally { await page.keyboard.up('KeyD'); }
    const b = await page.evaluate(() => ({ ...window.__station.walker }));
    assert.ok(b.x > a.x + 1, `moved east ${a.x.toFixed(2)} → ${b.x.toFixed(2)}`);
  });

  await check('a train comes out of the tunnel and passes', async () => {
    await page.evaluate((s) => { window.__station.teleport(30.5, 9.5); window.__station.setTime(s); }, startOf(0) - 2);
    await page.waitForFunction(() => window.__station.train()?.phase === 'warn', { timeout: 10000 });
    // 1.3 s out of its tunnel the train's nose is mid-platform (x ≈ 30.5); set and read in one go, so a slow
    // frame can't skip past it.
    const t = await page.evaluate((s) => { window.__station.setTime(s); const t = window.__station.train(); return t && { phase: t.phase, head: t.head }; }, startOf(0) + 1.3);
    assert.equal(t?.phase, 'pass');
    assert.ok(Math.abs(t.head - 30) < 6, `head at ${t.head}`);
    await nFrames(page, 2);
    await page.screenshot({ path: `${SHOTS}/station-train.png` });
    await page.waitForFunction(() => !window.__station.train(), { timeout: 10000 });
  });

  await check('resizing keeps the station filling the window', async () => {
    const dims = () => page.evaluate(() => { const c = document.querySelector('canvas.station'); return { w: c.clientWidth, h: c.clientHeight, bw: c.width, bh: c.height }; });
    try {
      await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
      await sleep(300);
      assert.deepEqual(await dims(), { w: 800, h: 600, bw: 800, bh: 600 });
    } finally {
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    }
    await sleep(300);
    assert.deepEqual(await dims(), { w: 1440, h: 900, bw: 1440, bh: 900 });
  });

  await check('the exit brings you up in front of the stairs, and not straight back down', async () => {
    await page.evaluate(() => window.__station.teleport(2.5, 9.5));
    await page.keyboard.down('KeyA');
    try { await page.waitForFunction(() => !window.__station, { timeout: 5000 }); } finally { await page.keyboard.up('KeyA'); }
    await backInGallery(page);
    const { p, s } = await page.evaluate(() => ({ p: { ...window.__ascii.world.player }, s: window.__ascii.map.stairs }));
    assert.ok(Math.abs(p.x - s.front.x) < 1.5 && Math.abs(p.y - s.front.y) < 1.5, `in front: ${p.x},${p.y}`);
    assert.notEqual(await page.evaluate(() => location.hash), '#/station');
    await sleep(800);
    assert.equal(await page.evaluate(() => window.__ascii.station()), 'off', 'still in the gallery');
    assert.equal(await page.evaluate(() => document.querySelectorAll('canvas.station').length), 0, 'the station canvas is gone');
  });

  await check('the back button brings you up', async () => {
    await takeStairs(page);
    await inStation(page);
    await page.goBack();
    await backInGallery(page);
  });

  await check('back during the walk down leaves you in the gallery, unfrozen', async () => {
    await takeStairs(page);
    await page.waitForFunction(() => window.__ascii.station() !== 'off', { timeout: 15000 });
    await page.evaluate(() => history.pushState(null, '', '#/elsewhere'));
    const before = await page.evaluate(() => window.__ascii.station());
    await page.evaluate(() => { location.hash = ''; });
    console.log(`  (back during the walk down: state just before the hash change was '${before}')`);
    await backInGallery(page);
    await sleep(500);
    assert.equal(await page.evaluate(() => document.querySelectorAll('canvas.station').length), 0);
  });

  await check('a link to #/station goes straight down', async () => {
    await page.goto('about:blank');
    await page.goto(`${url}#/station`);
    await inStation(page);
  });

  await check('on a portrait phone the station starts and draws the station, not the dark', async () => {
    try {
      await page.goto('about:blank');
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.goto(`${url}#/station`);
      await inStation(page);
      await sleep(500);
      const c = await page.evaluate(() => { const c = document.querySelector('canvas.station'); return { w: c.clientWidth, h: c.clientHeight }; });
      assert.deepEqual(c, { w: 390, h: 844 });
      const shot = await page.screenshot({ path: `${SHOTS}/station-phone.png` });
      // The middle third, top to bottom: mostly lit, not mostly black.
      const { width, height } = await sharp(shot).metadata();
      const third = Math.floor(height / 3);
      const { data, info } = await sharp(shot).extract({ left: 0, top: third, width, height: third }).greyscale().raw().toBuffer({ resolveWithObject: true });
      let dark = 0;
      for (const v of data) if (v < 12) dark++;
      const share = dark / (info.width * info.height);
      assert.ok(share < 0.5, `${(share * 100).toFixed(0)}% of the middle third is black`);
    } finally {
      await page.goto('about:blank');
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    }
  });

  await check('fifteen trips down and up leave one station at most and no lost WebGL contexts', async () => {
    await page.goto(url);
    await ready(page);
    for (let i = 0; i < 15; i++) {
      await takeStairs(page);
      await inStation(page);
      assert.equal(await page.evaluate(() => document.querySelectorAll('canvas.station').length), 1, `trip ${i + 1}: one station canvas`);
      await page.goBack();
      await backInGallery(page);
      assert.equal(await page.evaluate(() => document.querySelectorAll('canvas.station').length), 0, `trip ${i + 1}: no station canvas`);
    }
    const lost = consoleLog.filter((m) => m.includes('Too many active WebGL contexts'));
    assert.deepEqual(lost, []);
  });

  await check('no page errors', async () => assert.deepEqual(errors, []));

  await check('if the station cannot load, you stay in the gallery', async () => {
    await page.goto('about:blank');
    await page.setRequestInterception(true);
    const block = (req) => (req.url().includes('/src/rpg/index.js') ? req.abort() : req.continue());
    page.on('request', block);
    try {
      await page.goto(url);
      await ready(page);
      await takeStairs(page);
      await page.waitForFunction(() => window.__ascii.station() === 'off' && !window.__ascii.world.frozen && /couldn.t load/.test(document.body.innerText), { timeout: 30000 });
      assert.equal(await page.evaluate(() => !!window.__station), false);
      assert.notEqual(await page.evaluate(() => location.hash), '#/station');
    } finally {
      page.off('request', block);
      await page.setRequestInterception(false);
    }
  });
});

for (const [s, name, msg] of results) console.log(`${s.padEnd(4)} ${name}${msg ? ` — ${msg}` : ''}`);
process.exitCode = results.some((r) => r[0] === 'FAIL') ? 1 : 0;
