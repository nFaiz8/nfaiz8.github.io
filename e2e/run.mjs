// Live checks in headless Chrome for Testing. Usage: npm run e2e
import { withBrowser, ready, sleep } from './lib.mjs';
import assert from 'node:assert/strict';

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message]); }
};

await withBrowser(async ({ page, url, errors }) => {
  for (const r of ['canvas', 'gl']) {
    await page.goto(`${url}?r=${r}`);
    await ready(page);
    await check(`${r}: starts with the requested renderer`, async () => {
      assert.equal(await page.evaluate(() => window.__ascii.renderer), r);
    });
    await check(`${r}: walks through every room`, async () => {
      const rooms = await page.evaluate(() => window.__ascii.map.rooms.filter((x) => x.entry).map((x) => ({ id: x.id, ...x.entry })));
      for (const room of rooms) {
        await page.evaluate((e) => window.__ascii.walkTo(e.x, e.y), room);
        await page.waitForFunction(() => { const w = window.__ascii.world; return !w.path && !w.want && !w.frozen; }, { timeout: 90000 });
        const at = await page.evaluate(() => ({ x: Math.floor(window.__ascii.world.player.x), y: Math.floor(window.__ascii.world.player.y) }));
        assert.deepEqual(at, { x: room.x, y: room.y }, `reached ${room.id}`);
      }
    });
    await check(`${r}: frame rate`, async () => {
      await page.evaluate(() => { window.__ascii.stats.times.length = 0; });
      await page.keyboard.down('ArrowRight');
      await sleep(2000);
      await page.keyboard.up('ArrowRight');
      const t = await page.evaluate(() => window.__ascii.stats.times.slice());
      const sorted = [...t].sort((a, b) => a - b);
      const fps = t.length / t.reduce((a, b) => a + b, 0);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] * 1000;
      console.log(`  ${r}: ${fps.toFixed(0)} fps, p95 ${p95.toFixed(1)} ms`);
      assert.ok(fps > 55, `fps ${fps}`);
      assert.ok(p95 < 20, `p95 ${p95}`);
    });
  }
  await check('R toggles renderer without moving the player', async () => {
    await page.goto(`${url}?r=canvas`);
    await ready(page);
    await page.keyboard.down('ArrowLeft');
    await sleep(400);
    await page.keyboard.up('ArrowLeft');
    await sleep(800); // let the glide finish
    const before = await page.evaluate(() => ({ ...window.__ascii.world.player }));
    await page.keyboard.press('KeyR');
    const after = await page.evaluate(() => ({ ...window.__ascii.world.player, r: window.__ascii.renderer }));
    assert.equal(after.r, 'gl');
    assert.ok(Math.abs(after.x - before.x) < 0.01 && Math.abs(after.y - before.y) < 0.01, 'position kept');
  });
  for (const r of ['canvas', 'gl']) {
    await check(`${r}: opening a photo resolves into the full-size image and closing returns to the room`, async () => {
      await page.goto(`${url}?r=${r}`);
      await ready(page);
      const id = await page.evaluate(() => { const a = window.__ascii; const f = a.map.frames.find((x) => !x.darkroom); a.teleport(f.stand.x + 0.5, f.stand.y + 0.5); return f.id; });
      await page.waitForFunction((fid) => window.__ascii.world.focus && window.__ascii.world.focus.id === fid, { timeout: 5000 }, id);
      await page.keyboard.press('KeyE');
      await page.waitForFunction(() => window.__ascii.viewer.state !== 'closed', { timeout: 5000 });
      await page.waitForFunction(() => window.__ascii.viewer.state === 'open', { timeout: 20000 });
      const shown = await page.evaluate(() => { const img = document.querySelector('.viewer-img'); return { w: img.naturalWidth, hash: location.hash }; });
      assert.ok(shown.w > 1000, `hi image loaded (${shown.w}px wide)`);
      assert.equal(shown.hash, `#/photo/${id}`);
      await page.keyboard.press('ArrowRight');
      await sleep(300);
      assert.notEqual(await page.evaluate(() => location.hash), `#/photo/${id}`, 'next photo updates the link');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__ascii.viewer.state === 'closed', { timeout: 20000 });
      assert.match(await page.evaluate(() => location.hash), /^#\/room\//);
      assert.ok(await page.evaluate(() => !!window.__ascii.world.focus), 'standing in front of the photo you closed');
    });
  }
  await check('darkroom prints develop before they open', async () => {
    await page.goto(`${url}?r=canvas`);
    await ready(page);
    await page.evaluate(() => { const a = window.__ascii; const f = a.map.frames.find((x) => x.darkroom); a.teleport(f.stand.x + 0.5, f.stand.y + 0.5); a.open(f.id); });
    await page.waitForFunction(() => !document.querySelector('.resolve').hidden, { timeout: 3000 });
    const t0 = Date.now();
    await page.waitForFunction(() => window.__ascii.viewer.state === 'open', { timeout: 20000 });
    assert.ok(Date.now() - t0 > 1200, 'the develop stages took their time');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__ascii.viewer.state === 'closed', { timeout: 20000 });
  });
  await check('cold links: #/photo opens the viewer, #/room places you in the room, unknown ids land in the lobby', async () => {
    const id = await page.evaluate(() => window.__ascii.map.frames[2].id);
    await page.goto('about:blank');
    await page.goto(`${url}#/photo/${encodeURIComponent(id)}`);
    await page.waitForFunction(() => window.__ascii && window.__ascii.viewer.state === 'open', { timeout: 20000 });
    await page.goto('about:blank');
    await page.goto(`${url}#/room/darkroom`);
    await ready(page);
    assert.equal(await page.evaluate(() => { const a = window.__ascii; const w = a.world; return a.map.rooms[a.map.roomOf[Math.floor(w.player.y) * a.map.W + Math.floor(w.player.x)]].id; }), 'darkroom');
    await page.goto('about:blank');
    await page.goto(`${url}#/photo/not-a-photo`);
    await ready(page);
    assert.equal(await page.evaluate(() => document.getElementById('note').textContent), 'photo not found');
  });
  await check('the map walks you to a room', async () => {
    await page.goto(`${url}?r=gl`);
    await ready(page);
    await page.click('#map-btn');
    await page.click('button.map-room[aria-label="Walk to Darkroom"]');
    await page.waitForFunction(() => !window.__ascii.world.path, { timeout: 60000 });
    assert.equal(await page.evaluate(() => { const a = window.__ascii, w = a.world; return a.map.rooms[a.map.roomOf[Math.floor(w.player.y) * a.map.W + Math.floor(w.player.x)]].id; }), 'darkroom');
  });
  await check('visitors wander', async () => {
    const a = await page.evaluate(() => window.__ascii.world.visitors.map((v) => [v.x, v.y]));
    await sleep(6000);
    const b = await page.evaluate(() => window.__ascii.world.visitors.map((v) => [v.x, v.y]));
    assert.ok(a.some((p, i) => p[0] !== b[i][0] || p[1] !== b[i][1]), 'at least one visitor moved');
  });
  await check('the lobby kiosk opens every photo as a grid by colour, panoramas kept wide', async () => {
    await page.goto(url);
    await ready(page);
    await page.evaluate(() => { const k = window.__ascii.map.kiosk; window.__ascii.teleport(k.stand.x + 0.5, k.stand.y + 0.5); });
    await page.waitForFunction(() => window.__ascii.world.atKiosk, { timeout: 5000 });
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__ascii.grid.isOpen, { timeout: 5000 });
    const info = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('.grid-tile')].map((b) => b.dataset.id);
      const shapes = [...document.querySelectorAll('.grid-tile')].map((b) => {
        const f = window.__ascii.map.frames.find((x) => x.id === b.dataset.id);
        const r = b.getBoundingClientRect();
        return { shown: r.width / r.height, own: f.photo.width / f.photo.height, w: r.width };
      });
      return { ids, order: window.__ascii.map.frames.map((f) => f.id), shapes, width: document.querySelector('.grid-body').clientWidth, hash: location.hash };
    });
    assert.deepEqual(info.ids, info.order, 'every photo, in room (colour) order');
    for (const s of info.shapes) assert.ok(Math.abs(s.shown - s.own) / s.own < 0.05 || s.w < 40, `shape ${s.shown} vs ${s.own}`);
    // The widest photo is shown at least about a row tall (not shrunk into a strip), or as wide as the page.
    const widest = info.shapes.reduce((a, b) => (b.own > a.own ? b : a));
    assert.ok(widest.w / widest.own > 120 || widest.w > info.width * 0.98, `widest photo (${widest.own.toFixed(2)}:1) is ${widest.w}px wide`);
    assert.equal(info.hash, '#/all');
  });
  await check('a grid photo opens the viewer, → follows colour order, Esc returns to the grid then the lobby', async () => {
    const [first, second] = await page.evaluate(() => window.__ascii.map.frames.slice(0, 2).map((f) => f.id));
    await page.click(`.grid-tile[data-id="${first}"]`);
    await page.waitForFunction(() => window.__ascii.viewer.state === 'open', { timeout: 5000 });
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => window.__ascii.viewer.current.id), second);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__ascii.viewer.state === 'closed', { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__ascii.grid.isOpen), true, 'grid still open');
    assert.equal(await page.evaluate(() => location.hash), '#/all');
    assert.equal(await page.evaluate(() => Math.floor(window.__ascii.world.player.y)), await page.evaluate(() => window.__ascii.map.kiosk.stand.y), 'player stayed in the lobby');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__ascii.grid.isOpen), false);
  });
  await check('G and #/all open the grid; tapping the kiosk walks you there and opens it', async () => {
    await page.goto(`${url}#/all`);
    await ready(page);
    await page.waitForFunction(() => window.__ascii.grid.isOpen, { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyG');
    assert.equal(await page.evaluate(() => window.__ascii.grid.isOpen), true);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { const k = window.__ascii.map.kiosk; window.__ascii.tapCell(k.x + 4, k.y + 1); });
    await page.waitForFunction(() => window.__ascii.grid.isOpen, { timeout: 15000 });
  });
  await check('on localhost without ?live= there is no connection, no multiplayer UI, and 1–5 do nothing', async () => {
    await page.goto(url); await ready(page);
    assert.equal(await page.evaluate(() => window.__ascii.live()), null);
    for (const id of ['emote-btn', 'name-btn']) assert.equal(await page.$eval(`#${id}`, (e) => e.offsetParent === null), true, `#${id} shows`);
    await page.focus('#stage');
    await page.keyboard.press('Digit1');
    await page.keyboard.press('KeyN');
    await sleep(200);
    assert.equal(await page.evaluate(() => window.__ascii.world.entities.some((e) => e.glyph === '♥')), false, 'emote shown');
    assert.equal(await page.$eval('#name-form', (e) => e.hidden), true, 'name form opened');
  });
  await check('a landscape phone sees about as much as a computer', async () => {
    await page.setViewport({ width: 852, height: 393, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true });
    await page.goto(url); await ready(page);
    const cells = await page.evaluate(() => ({ cols: Math.floor(innerWidth / window.__ascii.metrics().cw), rows: Math.floor(innerHeight / window.__ascii.metrics().ch) }));
    assert.ok(cells.cols >= 120 && cells.rows >= 28, `${cells.cols}×${cells.rows}`);
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  });
  const arenaInfo = (p) => p.evaluate(() => { const a = window.__ascii.map.arena; return { door: a.door, floorY: a.floorY, entry: a.entry, x: a.x, y: a.y, w: a.w, h: a.h, id: a.backdrop && a.backdrop.id }; });
  await check('arena: with Reduce Motion, walking west through the door cuts to the side view, and east cuts back', async () => {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(url); await ready(page);
    const a = await arenaInfo(page);
    await page.evaluate((d) => window.__ascii.teleport(d.x + 4.5, d.y + 1.5), a.door);
    await page.keyboard.down('ArrowLeft');
    await page.waitForFunction(() => window.__ascii.mode() === 'side', { timeout: 5000 });
    await page.keyboard.up('ArrowLeft');
    await sleep(300);
    const p = await page.evaluate(() => ({ ...window.__ascii.world.player }));
    assert.ok(Math.abs(p.y - (a.floorY - 0.5)) < 0.01, `on the floor (${p.y})`);
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(() => window.__ascii.mode() === 'top', { timeout: 5000 });
    await page.keyboard.up('ArrowRight');
    assert.ok(await page.evaluate((x) => window.__ascii.world.player.x > x, a.door.x), 'in the corridor');
    await page.emulateMediaFeatures([]);
  });
  await check('arena: the door tilts the view (about 0.6 s, input waits), and the stage ends flat', async () => {
    await page.emulateMediaFeatures([]);
    await page.goto(url); await ready(page);
    const a = await arenaInfo(page);
    await page.evaluate((d) => window.__ascii.teleport(d.x + 4.5, d.y + 1.5), a.door);
    await page.keyboard.down('ArrowLeft');
    await page.waitForFunction(() => window.__ascii.tilting(), { timeout: 5000 });
    const t0 = Date.now();
    await page.keyboard.up('ArrowLeft');
    await page.waitForFunction(() => window.__ascii.mode() === 'side' && !window.__ascii.tilting(), { timeout: 5000 });
    const took = Date.now() - t0;
    assert.ok(took >= 450 && took < 2000, `took ${took} ms`);
    assert.equal(await page.$eval('#stage', (s) => getComputedStyle(s).transform), 'none');
  });
  await check('arena: a jump from the floor lands on a platform, and ↓ drops back through it', async () => {
    await page.goto(`${url}#/room/arena`); await ready(page);
    assert.equal(await page.evaluate(() => window.__ascii.mode()), 'side', '#/room/arena lands in the side view');
    const spot = await page.evaluate(() => {
      const a = window.__ascii.map.arena, L = a.level, r = L.rows - 5;
      for (let c = 2; c < L.cols - 2; c++) {
        const run = [-1, 0, 1].every((d) => L.cells[r * L.cols + c + d] === 1);
        const clear = [1, 2, 3, 4].every((k) => [-1, 0, 1].every((d) => !L.cells[(r + k) * L.cols + c + d]));
        if (run && clear) return { x: a.x + 1 + c + 0.5, y: a.floorY - 0.5, top: a.y + 1 + r };
      }
      return null;
    });
    assert.ok(spot, 'a platform 5 rows up with clear space under it');
    await page.evaluate((s) => window.__ascii.teleport(s.x, s.y), spot);
    await sleep(200);
    await page.keyboard.down('Space');
    await sleep(450);
    await page.keyboard.up('Space');
    await sleep(800);
    assert.ok(Math.abs(await page.evaluate(() => window.__ascii.world.player.y) - (spot.top - 0.5)) < 0.01, 'standing on the platform');
    await page.keyboard.down('ArrowDown');
    await sleep(120);
    await page.keyboard.up('ArrowDown');
    await sleep(800);
    assert.ok(Math.abs(await page.evaluate(() => window.__ascii.world.player.y) - spot.y) < 0.01, 'back on the floor');
  });
  await check('no page errors', async () => assert.deepEqual(errors, []));
});

for (const [s, name, msg] of results) console.log(`${s.padEnd(4)} ${name}${msg ? ` — ${msg}` : ''}`);
process.exitCode = results.some((r) => r[0] === 'FAIL') ? 1 : 0;
