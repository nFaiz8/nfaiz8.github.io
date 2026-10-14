// Live checks in headless Chrome for Testing. Usage: npm run e2e
import { withBrowser, ready, sleep, SHOTS } from './lib.mjs';
import assert from 'node:assert/strict';
import sharp from 'sharp';

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
        // In the arena's side view the 3-row body's centre is a row above the entry's (floor) row.
        assert.deepEqual(at, { x: room.x, y: room.y - (room.id === 'arena' ? 1 : 0) }, `reached ${room.id}`);
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
    assert.ok(Math.abs(p.y - (a.floorY - 1.5)) < 0.01, `on the floor (${p.y})`); // the 3-row body's centre
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
      const a = window.__ascii.map.arena, L = a.level, r = L.door.r + 1 - 5; // 5 rows above the floor's top
      for (let c = 2; c < L.cols - 2; c++) {
        const run = [-1, 0, 1].every((d) => L.cells[r * L.cols + c + d] === 1);
        const clear = [1, 2, 3, 4].every((k) => [-1, 0, 1].every((d) => !L.cells[(r + k) * L.cols + c + d]));
        if (run && clear) return { x: a.x + 1 + c + 0.5, y: a.floorY - 1.5, top: a.y + 1 + r }; // 3-row body
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
    assert.ok(Math.abs(await page.evaluate(() => window.__ascii.world.player.y) - (spot.top - 1.5)) < 0.01, 'standing on the platform');
    await page.keyboard.down('ArrowDown');
    await sleep(120);
    await page.keyboard.up('ArrowDown');
    await sleep(800);
    assert.ok(Math.abs(await page.evaluate(() => window.__ascii.world.player.y) - spot.y) < 0.01, 'back on the floor');
  });
  await check('arena: a double jump (Space, then Space again in the air) reaches higher than a single jump', async () => {
    await page.goto(`${url}#/room/arena`); await ready(page);
    // A spot on a car's floor with 15 clear rows above it (up to the roof), so neither jump meets anything.
    const spot = await page.evaluate(() => {
      const a = window.__ascii.map.arena, L = a.level, r = L.door.r + 1;
      for (let c = 2; c < L.cols - 2; c++) {
        const run = [-1, 0, 1].every((d) => L.cells[r * L.cols + c + d] !== 0);
        const clear = [...Array(15)].every((_, k) => [-1, 0, 1].every((d) => !L.cells[(r - 1 - k) * L.cols + c + d]));
        if (run && clear) return { x: a.x + 1 + c + 0.5, y: a.y + 1 + r - 1.5 };
      }
      return null;
    });
    assert.ok(spot, 'a spot with room to jump');
    const rise = async (double) => {
      await page.evaluate((s) => window.__ascii.teleport(s.x, s.y), spot);
      await sleep(400);
      const y0 = await page.evaluate(() => window.__ascii.world.player.y);
      // Every frame for 1.6 s: the highest the body gets, and whether it took an air jump (flipT, as drawn, near 0).
      const seen = page.evaluate(() => new Promise((resolve) => {
        const p = window.__ascii.world.player, t0 = performance.now(), was = p.airJumpT;
        let top = Infinity, flip = false;
        const tick = () => {
          top = Math.min(top, p.y);
          if (p.airJumpT !== was && p.t - p.airJumpT < 0.05) flip = true;
          if (performance.now() - t0 < 1600) requestAnimationFrame(tick); else resolve({ top, flip });
        };
        requestAnimationFrame(tick);
      }));
      await page.keyboard.down('Space'); await sleep(300); await page.keyboard.up('Space');
      if (double) { await sleep(40); await page.keyboard.down('Space'); await sleep(300); await page.keyboard.up('Space'); }
      const r = await seen;
      return { up: y0 - r.top, flip: r.flip };
    };
    const one = await rise(false), two = await rise(true);
    console.log(`  single jump ${one.up.toFixed(2)} rows, double jump ${two.up.toFixed(2)} rows`);
    assert.ok(one.up > 5 && one.up < 7 && !one.flip, `a single jump: ${one.up} rows, no air jump`);
    assert.ok(two.up > one.up + 3, `the double jump went ${two.up} rows`);
    assert.ok(two.flip, 'the air jump was taken');
  });
  // Where some cells are on screen right now, in CSS pixels.
  const cellsClip = (p, x0, y0, w, h) => p.evaluate((x0, y0, w, h) => {
    const { world, metrics } = window.__ascii, m = metrics();
    const left = world.cam.x - innerWidth / m.cw / 2, top = world.cam.y - innerHeight / m.ch / 2;
    return { x: (x0 - left) * m.cw, y: (y0 - top) * m.ch, width: w * m.cw, height: h * m.ch };
  }, x0, y0, w, h);
  // The train level (train level addendum): the side view is two subway cars in a tunnel, drawn as glyphs.
  for (const r of ['canvas', 'gl']) {
    await check(`${r}: the arena is the train, seen from outside too; inside, the floor you stand on is warm white over the lit car; no photo drawn`, async () => {
      await page.goto(`${url}?r=${r}`); await ready(page);
      const a = await arenaInfo(page);
      await page.evaluate((d) => window.__ascii.teleport(d.x + 4.5, d.y + 1.5), a.door);
      await sleep(1500);
      // Top-down, from the corridor: the train in the arena's box, lit by its own light.
      const outside = await sharp(await page.screenshot({ clip: await cellsClip(page, a.door.x - 40, a.door.y - 12, 30, 12) })).stats();
      const lit = outside.channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) / 3;
      await page.goto(`${url}?r=${r}#/room/arena`); await ready(page);
      await page.waitForFunction(() => window.__ascii.mode() === 'side' && !window.__ascii.tilting(), { timeout: 8000 });
      await page.evaluate(() => { const a = window.__ascii.map.arena; window.__ascii.teleport(a.x + 1 + 60.5, a.floorY - 1.5); });
      await sleep(1500);
      const L = await page.evaluate(() => window.__ascii.map.arena.level.door.r + 1); // the floor's top row
      const strip = async (row) => {
        const { data, info } = await sharp(await page.screenshot({ clip: await cellsClip(page, a.x + 1 + 40, a.y + 1 + row, 14, 1) })).raw().toBuffer({ resolveWithObject: true });
        const px = [];
        for (let i = 0; i < data.length; i += info.channels) px.push([data[i], data[i + 1], data[i + 2]]);
        const lum = px.map(([R, G, B]) => (R + G + B) / 3).sort((x, y) => x - y);
        const bright = px.filter(([R, G, B]) => (R + G + B) / 3 >= lum[Math.floor(lum.length * 0.95)]);
        const warm = bright.filter(([R, , B]) => R >= B + 15).length / bright.length;
        return { median: lum[Math.floor(lum.length / 2)], p95: lum[Math.floor(lum.length * 0.95)], warm };
      };
      const floor = await strip(L), above = await strip(L - 2);
      const all = await sharp(await page.screenshot()).stats();
      const mean = all.channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) / 3, sd = all.channels.slice(0, 3).reduce((s, c) => s + c.stdev, 0) / 3;
      console.log(`  ${r} train: outside mean ${lit.toFixed(1)}; inside mean ${mean.toFixed(1)} sd ${sd.toFixed(1)}; floor strokes ${floor.p95.toFixed(0)} (${(floor.warm * 100).toFixed(0)}% warm), 2 rows up p95 ${above.p95.toFixed(0)}`);
      assert.ok(lit > 12, `from outside the train shows, lit (${lit.toFixed(1)})`);
      assert.ok(mean > 20 && sd > 20, 'a lit, detailed scene');
      assert.ok(floor.p95 > 200 && floor.warm > 0.5, 'bright, warm floor strokes');
      assert.ok(floor.p95 >= above.p95, 'the floor at least as bright as the car above it');
      assert.equal(await page.evaluate(() => window.__ascii.loaded(window.__ascii.map.arena.backdrop.id)), false, 'the photo was not loaded to be drawn');
    });
  }
  await check('the side view zooms by gun: about 20 rows with the deagle, the whole room with the sniper; the mouse aims true at both', async () => {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${url}#/room/arena`); await ready(page);
    await page.waitForFunction(() => window.__ascii.pvp().entered && !window.__ascii.tilting(), { timeout: 8000 });
    const rows = () => page.evaluate(() => innerHeight / window.__ascii.metrics().ch);
    const facesMouse = async () => {
      const out = [];
      for (const side of [-1, 1]) {
        // 4 cells to that side of me, level with my chest, on screen by this zoom's cell size.
        const at = await page.evaluate((side) => {
          const { world, metrics } = window.__ascii, m = metrics(), p = world.player;
          const left = world.cam.x - innerWidth / m.cw / 2, top = world.cam.y - innerHeight / m.ch / 2;
          return { x: (p.x + 4 * side - left) * m.cw, y: (p.y - 0.5 - top) * m.ch };
        }, side);
        await page.mouse.move(at.x, at.y);
        await sleep(150);
        const q = await page.evaluate((at) => ({ pt: window.__ascii.pointAt(at.x, at.y), p: { ...window.__ascii.world.player }, f: window.__ascii.pvp().bodies(performance.now()).find((b) => b.me).state.facing }), at);
        assert.ok(Math.abs(q.pt.x - (q.p.x + 4 * side)) < 0.6 && Math.abs(q.pt.y - (q.p.y - 0.5)) < 0.6, `pointAt under the mouse (${JSON.stringify(q.pt)} vs ${q.p.x}, ${q.p.y})`);
        out.push(q.f);
      }
      return out;
    };
    await page.evaluate(() => { const a = window.__ascii.map.arena; window.__ascii.teleport(a.x + 1 + 60.5, a.floorY - 1.5); });
    await sleep(800);
    const deagle = await rows();
    assert.ok(deagle >= 20 && deagle < 22.4, `deagle: ${deagle.toFixed(2)} rows`);
    assert.deepEqual(await facesMouse(), [-1, 1], 'faces the mouse (deagle zoom)');
    await page.evaluate(() => { window.__ascii.pvp().me.gun = 'sniper'; });
    await sleep(100);
    const easing = await page.evaluate(() => window.__ascii.zoom());
    await sleep(600);
    const sniper = await rows(), z = await page.evaluate(() => window.__ascii.zoom());
    console.log(`  zoom: deagle ${deagle.toFixed(2)} rows, sniper ${sniper.toFixed(2)} rows (mid-ease ${easing.rows.toFixed(1)}, settled ${easing.settled})`);
    assert.ok(easing.rows > 20 && easing.rows < 33 && !easing.settled, 'it eases');
    assert.ok(z.settled && sniper >= 33 && sniper < 37, `sniper: ${sniper.toFixed(2)} rows`);
    assert.deepEqual(await facesMouse(), [-1, 1], 'faces the mouse (sniper zoom)');
    assert.deepEqual(await page.evaluate(() => window.__ascii.missing()), [], 'no glyph is missing from the atlas');
    await page.evaluate(() => { window.__ascii.pvp().me.gun = 'deagle'; });
    await sleep(600);
  });
  await check('L switches the train\'s look (line, ascii) and the next visit remembers it; the HUD button does too, by name', async () => {
    await page.goto(`${url}#/room/arena`); await ready(page);
    await page.evaluate(() => { try { localStorage.removeItem('ascii-look'); } catch {} });
    await page.goto('about:blank');
    await page.goto(`${url}#/room/arena`); await ready(page);
    await page.waitForFunction(() => window.__ascii.mode() === 'side' && !window.__ascii.tilting(), { timeout: 8000 });
    assert.equal(await page.evaluate(() => window.__ascii.look()), 'line', 'line by default');
    const btn = () => page.$eval('#look-btn', (b) => ({ hidden: b.hidden, label: b.getAttribute('aria-label'), text: b.textContent }));
    assert.match((await btn()).label, /look: line/);
    assert.equal((await btn()).hidden, false, 'shown in the side view');
    await page.focus('#stage');
    await page.keyboard.press('KeyL');
    assert.equal(await page.evaluate(() => window.__ascii.look()), 'ascii');
    assert.match((await btn()).label, /look: ascii/);
    await page.goto('about:blank');
    await page.goto(`${url}#/room/arena`); await ready(page);
    assert.equal(await page.evaluate(() => window.__ascii.look()), 'ascii', 'remembered');
    await page.click('#look-btn');
    assert.equal(await page.evaluate(() => window.__ascii.look()), 'line', 'the button switches it back');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'stage', 'focus back on the stage');
    await page.evaluate(() => window.__ascii.teleport(window.__ascii.map.spawn.x, window.__ascii.map.spawn.y));
    await sleep(200);
    assert.equal((await btn()).hidden, true, 'hidden top-down');
  });
  for (const [size, vp] of [['computer', { width: 1440, height: 900, deviceScaleFactor: 1 }], ['phone', { width: 852, height: 393, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true }]]) {
    for (const r of ['canvas', 'gl']) {
      await check(`${r} on a ${size}: the train in both looks with the deagle and the sniper (screenshots), no ? glyphs`, async () => {
        await page.setViewport(vp);
        await page.goto('about:blank');
        await page.goto(`${url}?r=${r}#/room/arena`); await ready(page);
        await page.waitForFunction(() => window.__ascii.pvp().entered && !window.__ascii.tilting(), { timeout: 8000 });
        await page.evaluate(() => { const a = window.__ascii.map.arena; window.__ascii.teleport(a.x + 1 + 150.5, a.floorY - 1.5); });
        for (const gun of ['deagle', 'sniper']) {
          await page.evaluate((g) => { window.__ascii.pvp().me.gun = g; }, gun);
          for (const look of ['line', 'ascii']) {
            if (await page.evaluate(() => window.__ascii.look()) !== look) await page.evaluate(() => document.getElementById('look-btn').click());
            await sleep(900);
            await page.screenshot({ path: `${SHOTS}/train-${r}-${size}-${look}-${gun}.png` });
          }
        }
        await page.evaluate(() => { window.__ascii.pvp().me.gun = 'deagle'; if (window.__ascii.look() !== 'line') document.getElementById('look-btn').click(); });
        assert.deepEqual(await page.evaluate(() => window.__ascii.missing()), [], 'no glyph drawn as ?');
      });
    }
  }
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await check('Reduce Motion: the train holds still (one frame, no station passing, the dying tube dim and steady)', async () => {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto('about:blank');
    await page.goto(`${url}#/room/arena`); await ready(page);
    const frames = [];
    for (let k = 0; k < 4; k++) { frames.push(await page.evaluate(() => { const F = window.__ascii.world.train.F; return JSON.stringify([F.off, F.tubes, F.spoke, F.lamps.map((l) => l.x)]); })); await sleep(400); }
    assert.equal(new Set(frames).size, 1, 'the same frame');
    await page.emulateMediaFeatures([]);
  });
  await check('arena on a landscape phone: ◀ ▶ JUMP ▼ show only inside, are big enough, and work', async () => {
    await page.setViewport({ width: 852, height: 393, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true });
    await page.goto(url); await ready(page);
    assert.equal(await page.$eval('#pad', (e) => e.hidden), true, 'hidden in the gallery');
    await page.goto(`${url}#/room/arena`); await ready(page);
    await page.waitForFunction(() => !document.getElementById('pad').hidden, { timeout: 3000 });
    const rects = await page.$$eval('#pad button', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { code: b.dataset.code, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; }));
    for (const r of rects) assert.ok(r.w >= 56 && r.h >= 56, `${r.code} is ${r.w}×${r.h}`);
    // PvP: FIRE and HIT join the right-hand cluster (HIT ▼ on top, FIRE JUMP below); FIRE and JUMP are 64 px.
    for (const sel of ['.pad-fire', '.pad-hit']) {
      const b = await page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { shown: !!e.offsetParent && r.width > 0, w: r.width, h: r.height, x: r.x, y: r.y }; });
      assert.ok(b.shown && b.w >= 56 && b.h >= 56, `${sel} shown and at least 56 px (${b.w}×${b.h})`);
    }
    const box = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const [hit, drop, fire, jump] = await Promise.all(['.pad-hit', '.pad-drop', '.pad-fire', '.pad-jump'].map(box));
    assert.ok(hit.y + hit.h <= fire.y && drop.y + drop.h <= jump.y && hit.x + hit.w <= drop.x && fire.x + fire.w <= jump.x, 'HIT ▼ above FIRE JUMP');
    assert.ok(fire.w >= 64 && fire.h >= 64 && jump.w >= 64 && jump.h >= 64, `FIRE ${fire.w}×${fire.h}, JUMP ${jump.w}×${jump.h}`);
    const at = (code) => rects.find((r) => r.code === code);
    const hold = async (code, ms, sample) => {
      await page.touchscreen.touchStart(at(code).x, at(code).y);
      const t0 = Date.now(), seen = [];
      while (Date.now() - t0 < ms) { seen.push(await page.evaluate(sample)); await sleep(30); }
      await page.touchscreen.touchEnd();
      return seen;
    };
    const x0 = await page.evaluate(() => window.__ascii.world.player.x);
    await hold('ArrowLeft', 400, () => 0);
    assert.ok(await page.evaluate(() => window.__ascii.world.player.x) < x0 - 3, '◀ runs west');
    await sleep(300);
    const y0 = await page.evaluate(() => window.__ascii.world.player.y);
    const ys = await hold('Jump', 500, () => window.__ascii.world.player.y);
    assert.ok(Math.min(...ys) < y0 - 3, 'JUMP jumps');
    // Holding JUMP tilts the gun 45° up, so FIRE with JUMP held shoots up.
    await sleep(600);
    const aims = await hold('Jump', 300, () => window.__ascii.pvp().bodies(performance.now()).find((b) => b.me).state.aim);
    assert.ok(aims.some((a) => Math.abs(a + Math.PI / 4) < 0.01), `JUMP held aims up (${aims.map((a) => a.toFixed(2)).join(' ')})`);
    // The caption moves up out of the floor band (the pad and the fight are down there), its ♥ still tappable.
    const cap = await page.$eval('#caption', (e) => { const r = e.getBoundingClientRect(); return { on: e.classList.contains('on') && r.width > 0 && getComputedStyle(e).display !== 'none', top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
    assert.ok(cap.on && cap.top < 80 && cap.bottom < 393 * 0.4 && cap.left < 40, `the caption at the top left (${JSON.stringify(cap)})`);
    const hp = await page.$eval('#fight', (e) => e.getBoundingClientRect().left);
    assert.ok(cap.right <= hp, `the caption clear of the fight HUD (${cap.right} vs ${hp})`);
    await page.evaluate(() => window.__ascii.teleport(window.__ascii.map.spawn.x, window.__ascii.map.spawn.y));
    await sleep(100);
    assert.equal(await page.$eval('#pad', (e) => e.hidden), true, 'hidden again outside');
  });
  await check('arena on a phone held upright: a hint says to turn it sideways', async () => {
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.goto(url); await ready(page); // the same #/room/arena URL again would not reload the page
    await page.goto(`${url}#/room/arena`); await ready(page);
    await page.waitForFunction(() => /sideways/.test(document.getElementById('note').textContent) && document.getElementById('note').classList.contains('on'), { timeout: 3000 });
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  });
  await check('arena: resizing re-fits the side view without showing outside the room', async () => {
    await page.goto(`${url}#/room/arena`); await ready(page);
    for (const [w, h] of [[1440, 900], [852, 393], [1100, 1300]]) {
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      await sleep(1500); // the camera spring settles
      const ok = await page.evaluate(() => {
        const { world: wd, map } = window.__ascii, a = map.arena, v = wd.view;
        return wd.cam.x - v.cols / 2 >= a.x - 0.01 && wd.cam.x + v.cols / 2 <= a.x + a.w + 0.01 &&
          (v.rows >= a.h || (wd.cam.y - v.rows / 2 >= a.y - 0.01 && wd.cam.y + v.rows / 2 <= a.y + a.h + 0.01));
      });
      assert.ok(ok, `${w}×${h}`);
      // A view taller than the room shows past its ceiling: that must be dark, not the next room
      // (its wall and prints measured p99 72 here; dark is 0–3).
      const a = await arenaInfo(page);
      const top = await cellsClip(page, a.x, a.y - 8, 1, 8);
      const y = Math.max(0, top.y), height = Math.floor(top.y + top.height - y);
      if (height >= 4) {
        // The drawing only: the fight HUD and the note are DOM boxes up there.
        await page.evaluate(() => { for (const id of ['fight', 'note']) document.getElementById(id).style.visibility = 'hidden'; });
        const { data } = await sharp(await page.screenshot({ clip: { x: 0, y, width: w, height } })).greyscale().raw().toBuffer({ resolveWithObject: true });
        await page.evaluate(() => { for (const id of ['fight', 'note']) document.getElementById(id).style.visibility = ''; });
        const p99 = [...data].sort((m, n) => m - n)[Math.floor(data.length * 0.99)];
        assert.ok(p99 < 20, `${w}×${h}: above the ceiling is dark (p99 ${p99})`);
      }
    }
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  });
  for (const r of ['canvas', 'gl']) {
    await check(`${r}: the arena photo's large image is never fetched to draw the arena (E opens it, and loads it then)`, async () => {
      const hits = [];
      const onReq = (q) => { if (/\/hi\//.test(q.url())) hits.push(q.url()); };
      page.on('request', onReq);
      try {
        await page.goto(`${url}?r=${r}`); await ready(page);
        const a = await arenaInfo(page);
        await page.evaluate((d) => window.__ascii.teleport(d.x + 6.5, d.y + 1.5), a.door); // in the corridor
        await sleep(1500);
        await page.goto(`${url}?r=${r}#/room/arena`); await ready(page);
        await sleep(2000);
        assert.deepEqual(hits.filter((h) => h.includes(a.id)), [], 'fetched for drawing');
      } finally { page.off('request', onReq); }
    });
  }
  await check('the arena photo in the viewer has an arena → button that takes you there; other photos do not', async () => {
    await page.goto(url); await ready(page);
    const id = await page.evaluate(() => window.__ascii.map.arena.backdrop.id);
    await page.evaluate((fid) => window.__ascii.open(fid), id);
    await page.waitForFunction(() => window.__ascii.viewer.state === 'open', { timeout: 20000 });
    await page.click('.vbtn[data-key="arena"]');
    await page.waitForFunction(() => window.__ascii.mode() === 'side' && !window.__ascii.tilting(), { timeout: 60000 });
    const other = await page.evaluate(() => window.__ascii.map.frames[0].id);
    await page.evaluate((fid) => window.__ascii.open(fid), other);
    await page.waitForFunction(() => window.__ascii.viewer.state === 'open', { timeout: 20000 });
    assert.equal(await page.$eval('.vbtn[data-key="arena"]', (b) => b.hidden), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__ascii.viewer.state === 'closed', { timeout: 20000 });
  });
  await check('in the arena, E opens its photo and → steps out to the next photo in the gallery', async () => {
    await page.goto(`${url}#/room/arena`); await ready(page);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__ascii.viewer.state === 'open', { timeout: 20000 });
    assert.equal(await page.$eval('.vbtn[data-key="arena"]', (b) => b.hidden), true, 'no arena → while in it');
    await page.keyboard.press('ArrowLeft');
    await sleep(300);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__ascii.viewer.state === 'closed', { timeout: 20000 });
    assert.equal(await page.evaluate(() => window.__ascii.mode()), 'top');
    assert.ok(await page.evaluate(() => !!window.__ascii.world.focus && !window.__ascii.world.focus.backdrop), 'standing at a gallery photo');
  });
  await check('arena PvP: the fight HUD shows hp in the side view, and the pad has FIRE and HIT on a phone', async () => {
    await page.goto('about:blank');
    await page.goto(url); await ready(page);
    assert.equal(await page.$eval('#fight', (e) => e.hidden), true, 'hidden in the gallery');
    await page.evaluate(() => { const a = window.__ascii.map.arena; window.__ascii.teleport(a.entry.x + 0.5 - 30, a.floorY - 1.5); });
    await page.waitForFunction(() => window.__ascii.mode() === 'side');
    await page.waitForFunction(() => !document.getElementById('fight').hidden);
    assert.match(await page.$eval('#fight-hp', (e) => e.textContent), /^hp █{10} 100/);
    // Alone: the dummy, and only the hp line (no scoreboard, no feed).
    assert.equal(await page.$eval('#fight-board', (e) => getComputedStyle(e).display), 'none', 'a scoreboard alone');
    assert.ok(await page.evaluate(() => window.__ascii.world.bodies.some((b) => b.label === 'dummy')), 'the dummy');
    // The HUD bar gets its dark scrim in the side view only.
    assert.match(await page.$eval('.hud', (e) => getComputedStyle(e).backgroundImage), /gradient/);
    await page.evaluate(() => window.__ascii.teleport(window.__ascii.map.spawn.x, window.__ascii.map.spawn.y));
    await page.waitForFunction(() => document.getElementById('fight').hidden, { timeout: 3000 });
    assert.equal(await page.$eval('.hud', (e) => getComputedStyle(e).backgroundImage), 'none', 'a scrim top-down');
  });
  await check('arena PvP: the first entry notes the keys; a photo, the map or a hidden tab takes me out of the fight, and coming back puts me in', async () => {
    await page.goto('about:blank');
    await page.goto(`${url}#/room/arena`); await ready(page);
    const entered = () => page.evaluate(() => window.__ascii.pvp().entered);
    await page.waitForFunction(() => window.__ascii.pvp().entered, { timeout: 3000 });
    assert.equal(await page.$eval('#note', (e) => e.textContent), 'J shoot · K hit · mouse aims');
    // A photo.
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__ascii.viewer.state === 'open', { timeout: 20000 });
    assert.equal(await entered(), false, 'in the fight with a photo open');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__ascii.viewer.state === 'closed', { timeout: 20000 });
    await page.waitForFunction(() => window.__ascii.pvp().entered, { timeout: 3000 });
    // The map.
    await page.keyboard.press('KeyM');
    await page.waitForFunction(() => !window.__ascii.pvp().entered, { timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__ascii.pvp().entered, { timeout: 3000 });
    // The tab hidden, then shown.
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); });
    assert.equal(await entered(), false, 'in the fight with the tab hidden');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); });
    await page.waitForFunction(() => window.__ascii.pvp().entered, { timeout: 3000 });
    // Back in on a fresh visit's second entry: no note again.
    await page.evaluate(() => window.__ascii.teleport(window.__ascii.map.spawn.x, window.__ascii.map.spawn.y));
    await page.waitForFunction(() => !window.__ascii.pvp().entered, { timeout: 3000 });
    await page.evaluate(() => { document.getElementById('note').textContent = ''; const e = window.__ascii.map.arena.entry; window.__ascii.teleport(e.x + 0.5, e.y + 0.5); });
    await page.waitForFunction(() => window.__ascii.pvp().entered, { timeout: 3000 });
    assert.equal(await page.$eval('#note', (e) => e.textContent), '', 'the note once a visit');
  });
  await check('arena PvP: Space jumps with the gun level, W/↑ tilt it 45° up; a kill is read to screen readers, not shown in the note', async () => {
    await page.goto('about:blank');
    await page.goto(`${url}#/room/arena`); await ready(page);
    await page.waitForFunction(() => window.__ascii.pvp().entered, { timeout: 3000 });
    await page.focus('#stage');
    const aimWhile = async (key) => {
      await page.keyboard.down(key);
      const seen = [];
      for (let i = 0; i < 6; i++) { await sleep(40); seen.push(await page.evaluate(() => window.__ascii.pvp().bodies(performance.now()).find((b) => b.me).state.aim)); }
      await page.keyboard.up(key);
      await sleep(700); // land
      return seen;
    };
    const space = await aimWhile('Space'), up = await aimWhile('ArrowUp'), w = await aimWhile('KeyW');
    assert.ok(space.every((a) => a === 0), `Space aims level (${space.join(' ')})`);
    assert.ok(up.every((a) => Math.abs(a + Math.PI / 4) < 0.01) && w.every((a) => Math.abs(a + Math.PI / 4) < 0.01), `↑ and W aim up (${up.join(' ')} / ${w.join(' ')})`);
    // A kill: in the feed box, and in the polite screen-reader region; the note keeps the key hint.
    const hint = await page.$eval('#note', (e) => e.textContent);
    await page.evaluate(() => {
      const p = window.__ascii.pvp(), now = performance.now();
      p.onMessage({ t: 'aw', you: {}, fighters: [{ id: 'x1', x: 60.5, y: 32.5, kills: 0 }] }, now);
      p.onMessage({ t: 'k', id: 'x1', by: p.me.id, kills: 1 }, now);
    });
    await page.waitForFunction(() => document.getElementById('fight-sr').textContent === 'you popped someone', { timeout: 2000 });
    assert.equal(await page.$eval('#fight-feed', (e) => e.textContent), 'you popped someone');
    assert.equal(await page.$eval('#fight-sr', (e) => e.getAttribute('role')), 'status');
    assert.equal(await page.$eval('#note', (e) => e.textContent), hint, 'the note changed');
  });
  // The stickman (stickman spec §8): my figure in every pose, pinned with __ascii.pose, with each renderer,
  // on a computer and on a landscape phone, over the brightest part of the train.
  const POSES = [
    ['idle', {}], ['run', { vx: 30 }], ['rise', { ground: false, vy: -20 }], ['fall', { ground: false, vy: 20 }],
    ['shoot 0', { act: 'shoot', actT: 0.1, aim: 0 }], ['shoot -45', { act: 'shoot', actT: 0.1, aim: -Math.PI / 4 }],
    ['shoot +45', { act: 'shoot', actT: 0.1, aim: Math.PI / 4 }], ['shoot -90', { act: 'shoot', actT: 0.1, aim: -Math.PI / 2 }],
    ['punch', { act: 'punch', actT: 0.1 }], ['kick', { act: 'kick', actT: 0.15 }], ['hurt', { act: 'hurt', actT: 0.05 }],
    ['dead 0.3', { act: 'dead', actT: 0.3 }], ['dead 1.5', { act: 'dead', actT: 1.5 }], ['respawn 0.2', { act: 'idle', spawnT: 0.2 }],
    // The rig (rig addendum): a carried rifle at the chest, a landing squat, a kick's wind-up, the roll's tumble.
    ['rifle', { gun: 'rifle' }], ['land', { landT: 0.03 }], ['kick 0.03', { act: 'kick', actT: 0.03 }], ['roll 0.12', { act: 'roll', actT: 0.12 }],
    // The double jump's flip (headshots and double jump addendum §2): tucked mid-turn with its puff, and shooting over it.
    ['flip 0.1', { ground: false, vy: -20, flipT: 0.1 }], ['flip 0.2 shoot', { ground: false, vy: -5, flipT: 0.2, act: 'shoot', actT: 0.1, aim: -0.4 }],
  ];
  const isAmber = (R, G, B) => R >= 120 && G >= 0.68 * R && G <= 0.92 * R && B >= 0.25 * R && B <= 0.6 * R;
  const isWhite = (R, G, B) => Math.min(R, G, B) >= 225;
  const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const raw = async (buf) => { const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };
  // The view in cells and where a map cell is on screen (CSS pixels).
  const viewOf = (p) => p.evaluate(() => {
    const { world, metrics } = window.__ascii, m = metrics(), a = window.__ascii.map.arena;
    return { left: world.cam.x - innerWidth / m.cw / 2, top: world.cam.y - innerHeight / m.ch / 2, cw: m.cw, ch: m.ch, W: innerWidth, H: innerHeight,
      dpr: Math.min(2, devicePixelRatio || 1), a: { x: a.x, y: a.y, cols: a.cols, rows: a.rows }, player: { x: world.player.x, y: world.player.y } };
  });
  // The brightest 3×4 cells of the arena on screen (away from the HUD, the caption and the pad).
  const brightest = async (p, v) => {
    const cols = Math.floor(v.W / v.cw), rows = Math.floor(v.H / v.ch);
    const { data } = await sharp(await p.screenshot()).greyscale().resize(cols, rows, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    let best = null;
    for (let cy = Math.ceil(rows * 0.15); cy + 4 <= rows * 0.7; cy++) for (let cx = Math.ceil(cols * 0.1); cx + 3 <= cols * 0.9; cx++) {
      const mx = v.left + cx, my = v.top + cy;
      if (mx < v.a.x + 2 || mx + 3 > v.a.x + v.a.cols || my < v.a.y + 2 || my + 4 > v.a.y + v.a.rows) continue;
      let s = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) s += data[(cy + y) * cols + cx + x];
      if (!best || s > best.s) best = { s, x: mx + 1.5, y: my + 2, lum: s / 12 };
    }
    return best;
  };
  for (const [size, vp] of [['computer', { width: 1440, height: 900, deviceScaleFactor: 1 }], ['phone', { width: 852, height: 393, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true }]]) {
    for (const r of ['canvas', 'gl']) {
      await check(`${r} on a ${size}: my stick figure in every pose, amber with a dark outline over the brightest part of the train`, async () => {
        await page.setViewport(vp);
        await page.goto('about:blank');
        await page.goto(`${url}?r=${r}#/room/arena`); await ready(page);
        // The train held still at a station (its brightest), so before and after differ only by the figure.
        await page.evaluate(() => window.__ascii.freezeTrain(0));
        await page.evaluate(() => window.__ascii.pose({ act: 'dead', actT: 5 })); // nothing drawn
        await sleep(1500);
        const v = await viewOf(page);
        const spot = await brightest(page, v);
        // The train is darker than the photo was: its brightest 3×4 cells at a station are about 40–70.
        assert.ok(spot && spot.lum > 35, `a bright spot (${spot && spot.lum.toFixed(0)})`);
        const pin = { x: spot.x, y: spot.y, vx: 0, vy: 0, facing: 1, ground: true, act: 'idle', actT: 0, aim: 0, landT: 10, spawnT: 10 };
        // 8 cells either side, 4.5 rows above to 2.5 below the body's centre.
        const clip = { x: (spot.x - 8 - v.left) * v.cw, y: (spot.y - 4.5 - v.top) * v.ch, width: 16 * v.cw, height: 7 * v.ch };
        const shoot = async (o) => { await page.evaluate((s) => window.__ascii.pose(s), { ...pin, ...o }); await sleep(150); return page.screenshot({ clip }); };
        const base = await raw(await shoot({ act: 'dead', actT: 5 }));
        const k = base.w / clip.width; // screenshot pixels per CSS pixel
        const o = Math.max(2, Math.round(0.14 * v.cw * v.dpr)), ringR = Math.ceil((o / v.dpr + 1) * k);
        const tiles = [], log = [], stats = [];
        for (const [name, o2] of POSES) {
          const buf = await shoot(o2);
          tiles.push(buf);
          const fig = await raw(buf), { w, h } = fig;
          const dead = o2.act === 'dead', ink = o2.act === 'hurt' ? isWhite : isAmber;
          // The body's 2.1 × 3-cell area; the dead pieces scatter, so for them a wider one.
          const ax = dead ? 7.5 : 1.05, ay0 = dead ? -3.5 : -1.5;
          const mask = new Uint8Array(w * h);
          let n = 0;
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const dx = x / k / v.cw - 8, dy = y / k / v.ch - 4.5, i = (y * w + x) * 3;
            if (Math.abs(dx) > ax || dy < ay0 || dy > 1.5) continue;
            if (ink(fig.data[i], fig.data[i + 1], fig.data[i + 2]) && !ink(base.data[i], base.data[i + 1], base.data[i + 2])) { mask[y * w + x] = 1; n++; }
          }
          // The ring: within the outline's reach of those pixels.
          // Dark: under 40 and darkened by the outline (the train is dark already in places, so "dark before" alone
          // would hide an outline drawn over it).
          let ring = 0, dark = 0, baseDark = 0;
          const seen = new Uint8Array(w * h);
          for (let j = 0; j < w * h; j++) {
            if (!mask[j]) continue;
            const jx = j % w, jy = (j / w) | 0;
            for (let y = Math.max(0, jy - ringR); y <= Math.min(h - 1, jy + ringR); y++) for (let x = Math.max(0, jx - ringR); x <= Math.min(w - 1, jx + ringR); x++) {
              const q = y * w + x;
              if (mask[q] || seen[q]) continue;
              seen[q] = 1; ring++;
              const lf = lum(fig.data, q * 3), lb = lum(base.data, q * 3);
              if (lf < 40 && lf < lb - 12) dark++;
              if (lb < 40) baseDark++;
            }
          }
          log.push(`${name}: ${n} ${ink === isWhite ? 'white' : 'amber'}, ring ${ring} (${dark} dark, ${baseDark} before)`);
          // Faded poses (dead after 1.4 s, the respawn's fly-in) fade their outline too.
          const full = !(dead && o2.actT > 1.4) && !(o2.spawnT < 0.45);
          stats.push({ name, n, dark, full, ink: ink === isWhite ? 'white' : 'amber' });
        }
        console.log(`  ${r} ${size}: spot lum ${spot.lum.toFixed(0)}; ${log.join('; ')}`);
        // A contact sheet of every pose, for looking at.
        const cols = 7, tw = base.w, th = base.h;
        await sharp({ create: { width: cols * tw, height: Math.ceil(tiles.length / cols) * th, channels: 3, background: '#000' } })
          .composite(tiles.map((input, i) => ({ input, left: (i % cols) * tw, top: Math.floor(i / cols) * th }))).png().toFile(`${SHOTS}/stick-${r}-${size}.png`);
        await page.evaluate((s) => window.__ascii.pose(s), pin);
        await sleep(150);
        // The carried gun is in the hand at the chest (rig addendum §5): its grip above the hip, pointing down.
        const grip = await page.evaluate((p) => window.__ascii.world.figures.find((g) => g.bold && g.ch === '╦' && g.color[1] === 206 && Math.abs(g.x - p.x) < 3 && Math.abs(g.y - p.y) < 3), pin);
        assert.ok(grip && grip.y - pin.y < 0.1 && grip.rot > 0.3 && grip.rot < 0.4, `the carried grip at the chest, pointing 20° down (${grip && [grip.x - pin.x, grip.y - pin.y, grip.rot].map((v) => v.toFixed(2))})`);
        await page.screenshot({ path: `${SHOTS}/stick-${r}-${size}-view.png` });
        await page.evaluate(() => window.__ascii.pose(null));
        for (const st of stats) {
          assert.ok(st.n >= 4, `${st.name}: ${st.n} ${st.ink} pixels in the body's area`);
          if (st.full) assert.ok(st.dark >= Math.max(6, 0.1 * st.n), `${st.name}: a dark outline (${st.dark} new dark pixels around ${st.n})`);
        }
      });
    }
  }
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  for (const r of ['canvas', 'gl']) {
    await check(`${r}: running, the figure glides (it moves one way, mostly by fractions of a cell); top-down I'm still @`, async () => {
      await page.goto('about:blank');
      await page.goto(`${url}?r=${r}#/room/arena`); await ready(page);
      await page.evaluate(() => window.__ascii.freezeTrain(5000)); // no lamp (amber too) passing behind me
      // In car B, west of the sniper: walking over it would change the gun, and the zoom with it.
      await page.evaluate(() => { const a = window.__ascii.map.arena; window.__ascii.teleport(a.x + 1 + 160.5, a.floorY - 1.5); });
      await sleep(1500); // past the protection on entering, whose pulse dims the figure off amber
      await page.keyboard.down('ArrowLeft');
      await sleep(400);
      // Each frame, just after it's drawn: the centre of the amber pixels around me, in map cells.
      const xs = await page.evaluate(() => new Promise((resolve) => {
        const { world, metrics } = window.__ascii, cv = document.querySelector('#stage canvas'), out = [], t0 = performance.now();
        const tmp = new OffscreenCanvas(8, 8), c = tmp.getContext('2d', { willReadFrequently: true });
        const amber = (R, G, B) => Math.abs(R - 255) < 30 && Math.abs(G - 206) < 30 && Math.abs(B - 110) < 35;
        const tick = () => {
          const m = metrics(), k = cv.width / innerWidth, p = world.player;
          const left = world.cam.x - innerWidth / m.cw / 2, top = world.cam.y - innerHeight / m.ch / 2;
          const x0 = Math.floor((p.x - 6 - left) * m.cw * k), y0 = Math.floor((p.y - 2 - top) * m.ch * k);
          const w = Math.ceil(12 * m.cw * k), h = Math.ceil(4 * m.ch * k);
          if (tmp.width !== w || tmp.height !== h) { tmp.width = w; tmp.height = h; }
          c.clearRect(0, 0, w, h);
          c.drawImage(cv, x0, y0, w, h, 0, 0, w, h);
          const d = c.getImageData(0, 0, w, h).data;
          let sx = 0, n = 0;
          for (let i = 0; i < w * h; i++) if (amber(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])) { sx += i % w; n++; }
          if (n) out.push(left + (x0 + sx / n) / (m.cw * k));
          if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else resolve(out);
        };
        requestAnimationFrame(tick);
      }));
      await page.keyboard.up('ArrowLeft');
      const steps = xs.slice(1).map((x, i) => x - xs[i]);
      const frac = steps.filter((s) => Math.abs(s - Math.round(s)) > 0.02).length;
      console.log(`  ${r}: ${xs.length} frames, steps ${Math.min(...steps).toFixed(3)}..${Math.max(...steps).toFixed(3)} cells, ${frac} fractional`);
      assert.ok(xs.length >= 30, `${xs.length} frames sampled`);
      // A run frame changing can shift the amber's centre by a little (steps are ~0.25 cells at 120 Hz).
      assert.ok(steps.every((s) => s <= 0.05) && xs.at(-1) < xs[0] - 10, `moves west only (largest step east ${Math.max(...steps).toFixed(3)})`);
      assert.ok(frac >= steps.length / 2, `${frac} of ${steps.length} steps are fractions of a cell`);
      await page.evaluate(() => window.__ascii.teleport(window.__ascii.map.spawn.x, window.__ascii.map.spawn.y));
      await sleep(400);
      const v = await viewOf(page);
      const { data } = await sharp(await page.screenshot({ clip: { x: (v.player.x - 0.5 - v.left) * v.cw, y: (v.player.y - 0.5 - v.top) * v.ch, width: v.cw, height: v.ch } })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let n = 0;
      for (let i = 0; i < data.length; i += 3) if (isAmber(data[i], data[i + 1], data[i + 2])) n++;
      assert.equal(await page.evaluate(() => window.__ascii.mode()), 'top');
      assert.ok(n >= 4 && await page.evaluate(() => window.__ascii.world.entities.some((e) => e.glyph === '@') && !window.__ascii.world.figures.length), `the @ (${n} amber pixels)`);
    });
    await check(`${r}: ?bots=30 draws thirty more stickmen (frame time logged)`, async () => {
      await page.goto('about:blank');
      await page.goto(`${url}?r=${r}&bots=30#/room/arena`); await ready(page);
      await sleep(1000);
      // The deagle's close view, then the sniper's whole room (the most train cells to light), in both looks.
      const fps = [];
      for (const [gun, look] of [['deagle', 'line'], ['sniper', 'line'], ['sniper', 'ascii']]) {
        await page.evaluate(([g, l]) => { window.__ascii.pvp().me.gun = g; if (window.__ascii.look() !== l) document.getElementById('look-btn').click(); }, [gun, look]);
        await sleep(800);
        await page.evaluate(() => { window.__ascii.stats.times.length = 0; });
        await sleep(2000);
        const t = await page.evaluate(() => window.__ascii.stats.times.slice());
        const sorted = [...t].sort((a, b) => a - b), avg = t.reduce((a, b) => a + b, 0) / t.length;
        const info = await page.evaluate(() => ({ bodies: window.__ascii.world.bodies.filter((b) => b.label !== 'dummy').length, glyphs: window.__ascii.world.figures.length }));
        console.log(`  ${r} with 30 bots (${gun}, ${look}): ${info.bodies} bodies, ${info.glyphs} glyphs, ${(avg * 1000).toFixed(1)} ms a frame, p95 ${(sorted[Math.floor(sorted.length * 0.95)] * 1000).toFixed(1)} ms`);
        fps.push([`${gun} ${look}`, 1 / avg]);
        assert.equal(info.bodies, 31); // me and the bots (the practice dummy stands there too)
      }
      await page.screenshot({ path: `${SHOTS}/stick-${r}-bots30.png` });
      await page.evaluate(() => { window.__ascii.pvp().me.gun = 'deagle'; if (window.__ascii.look() !== 'line') document.getElementById('look-btn').click(); });
      for (const [what, f] of fps) assert.ok(f > 110, `${what}: ${f.toFixed(0)} fps (120 wanted)`);
    });
  }
  await check('leaving the arena and coming back within 5 s plays my fly-in again', async () => {
    await page.goto('about:blank');
    await page.goto(`${url}?r=canvas#/room/arena`); await ready(page);
    await sleep(1000);
    const entry = await page.evaluate(() => window.__ascii.map.arena.entry);
    await page.evaluate(() => window.__ascii.teleport(window.__ascii.map.spawn.x, window.__ascii.map.spawn.y));
    await page.waitForFunction(() => window.__ascii.mode() === 'top', { timeout: 3000 });
    await sleep(500);
    // Protection's pulse dims the figure too: pinned off, only the fly-in can.
    await page.evaluate(() => window.__ascii.pose({ safe: false }));
    try {
      // My sprites (amber, or white in the flash): how far they spread from my centre, and how faint.
      const mine = () => {
        const w = window.__ascii.world, me = (w.bodies || []).find((b) => b.me);
        const gs = (w.figures || []).filter((g) => g.bold && me && (g.color === me.color || g.color.every((c) => c === 255)));
        if (!me || !gs.length) return null;
        return { n: gs.length, spread: Math.max(...gs.map((g) => Math.hypot(g.x - me.state.x, (g.y - me.state.y) * 2))),
          faint: gs.some((g) => g.a < 1), white: gs.some((g) => g.color.every((c) => c === 255)), solid: gs.every((g) => g.a === 1) };
      };
      await page.evaluate((e) => window.__ascii.teleport(e.x + 0.5, e.y + 0.5), entry);
      const early = await (await page.waitForFunction(`window.__ascii.mode() === 'side' && (${mine})()`, { timeout: 3000 })).jsonValue();
      await sleep(700);
      const late = await page.evaluate(`(${mine})()`);
      console.log(`  fly-in: first frame ${JSON.stringify(early)}; after 0.7 s ${JSON.stringify(late)}`);
      assert.ok(early.faint && early.spread > late.spread + 0.5, 'flying in: faint, and spread out from where it lands');
      assert.ok(late.solid && !late.white, 'in place after 0.45 s: solid, the flash over');
    } finally {
      await page.evaluate(() => window.__ascii.pose(null));
    }
  });
  await check('side view: hearts are labels over every figure, not entities under them', async () => {
    await page.goto('about:blank');
    await page.goto(`${url}?r=gl&bots=30#/room/arena`); await ready(page);
    await sleep(500);
    const h = await page.evaluate(() => { const w = window.__ascii.world; return { first: w.figures.findIndex((g) => g.ch === '♥' && !g.bold), lastFig: w.figures.map((g) => g.bold).lastIndexOf(true), entities: w.entities.filter((e) => e.glyph === '♥').length }; });
    assert.ok(h.first > h.lastFig, `hearts after the figures (${h.first} vs ${h.lastFig})`);
    assert.equal(h.entities, 0, 'hearts still in world.entities');
  });
  await check('no page errors', async () => assert.deepEqual(errors, []));
});

for (const [s, name, msg] of results) console.log(`${s.padEnd(4)} ${name}${msg ? ` — ${msg}` : ''}`);
process.exitCode = results.some((r) => r[0] === 'FAIL') ? 1 : 0;
