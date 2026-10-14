// Live checks in headless Chrome for Testing. Usage: npm run e2e
import { withBrowser, ready, sleep, SHOTS } from './lib.mjs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { coverCrop } from '../src/arena.js';

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
      const a = window.__ascii.map.arena, L = a.level, r = L.rows - 5;
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
  for (const r of ['canvas', 'gl']) {
    await check(`${r}: the arena photo fills the back wall in the side view, with bright platforms`, async () => {
      await page.goto(`${url}?r=${r}#/room/arena`); await ready(page);
      const id = await page.evaluate(() => window.__ascii.map.arena.backdrop.id);
      await page.waitForFunction((fid) => window.__ascii.loaded(fid), { timeout: 30000 }, id);
      await sleep(400);
      const shot = await page.screenshot({ clip: { x: 200, y: 150, width: 1040, height: 600 } });
      const { channels } = await sharp(shot).stats();
      const mean = channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) / 3;
      const sd = channels.slice(0, 3).reduce((s, c) => s + c.stdev, 0) / 3;
      console.log(`  ${r} arena: mean ${mean.toFixed(1)}, stdev ${sd.toFixed(1)}`);
      assert.ok(mean > 25 && sd > 20, 'a photo, not a dark room');
      const top = await page.evaluate(() => { window.__ascii.teleport(window.__ascii.map.spawn.x, window.__ascii.map.spawn.y); return window.__ascii.mode(); });
      assert.equal(top, 'top');
    });
  }
  // Where some cells are on screen right now, in CSS pixels.
  const cellsClip = (p, x0, y0, w, h) => p.evaluate((x0, y0, w, h) => {
    const { world, metrics } = window.__ascii, m = metrics();
    const left = world.cam.x - innerWidth / m.cw / 2, top = world.cam.y - innerHeight / m.ch / 2;
    return { x: (x0 - left) * m.cw, y: (y0 - top) * m.ch, width: w * m.cw, height: h * m.ch };
  }, x0, y0, w, h);
  for (const r of ['canvas', 'gl']) {
    await check(`${r}: from outside the arena is a dark room; inside, its platforms glow warm white over the photo`, async () => {
      await page.goto(`${url}?r=${r}`); await ready(page);
      const a = await arenaInfo(page);
      await page.evaluate((d) => window.__ascii.teleport(d.x + 4.5, d.y + 1.5), a.door);
      await sleep(1500);
      // Top-down, from the corridor: the arena's inside, west of the door.
      const outside = await sharp(await page.screenshot({ clip: await cellsClip(page, a.door.x - 40, a.door.y - 12, 30, 12) })).stats();
      const dark = outside.channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) / 3;
      // Side view: 14 cells from the middle of the widest platform 5 rows up from the floor (row 29).
      await page.goto(`${url}?r=${r}#/room/arena`); await ready(page);
      const c0 = await page.evaluate(() => {
        const L = window.__ascii.map.arena.level, row = L.rows - 5;
        let best = [0, 0];
        for (let c = 0, s = -1; c <= L.cols; c++) {
          const on = c < L.cols && L.cells[row * L.cols + c] === 1;
          if (on && s < 0) s = c;
          if (!on && s >= 0) { if (c - s > best[1] - best[0]) best = [s, c]; s = -1; }
        }
        return Math.floor((best[0] + best[1]) / 2) - 7;
      });
      await page.waitForFunction((fid) => window.__ascii.loaded(fid), { timeout: 30000 }, a.id);
      await sleep(400);
      const strip = async (row) => {
        const { data, info } = await sharp(await page.screenshot({ clip: await cellsClip(page, a.x + 1 + c0, a.y + 1 + row, 14, 1) })).raw().toBuffer({ resolveWithObject: true });
        const px = [];
        for (let i = 0; i < data.length; i += info.channels) px.push([data[i], data[i + 1], data[i + 2]]);
        const lum = px.map(([R, G, B]) => (R + G + B) / 3).sort((x, y) => x - y);
        // The strokes: the brightest twentieth of the strip, and whether they're warm (red over blue).
        const bright = px.filter(([R, G, B]) => (R + G + B) / 3 >= lum[Math.floor(lum.length * 0.95)]);
        const warm = bright.filter(([R, , B]) => R >= B + 20).length / bright.length;
        return { median: lum[Math.floor(lum.length / 2)], p95: lum[Math.floor(lum.length * 0.95)], warm };
      };
      const plat = await strip(29), above = await strip(28);
      console.log(`  ${r} arena: outside mean ${dark.toFixed(1)}; platform strokes ${plat.p95.toFixed(0)} (${(plat.warm * 100).toFixed(0)}% warm), median ${plat.median.toFixed(0)} (row above ${above.median.toFixed(0)})`);
      assert.ok(dark < 12, `outside, the arena is dark (${dark.toFixed(1)})`);
      // Bright against any photo: street photo strokes ~1.9× the row above, the dark station ~2×; no platform ~1×.
      assert.ok(plat.p95 > 1.4 * above.median && plat.warm > 0.5, 'bright, warm platform strokes');
      assert.ok(plat.median > 0.7 * above.median, 'the photo shows behind the strokes (no dark band)');
    });
  }
  // How closely a screenshot of some arena cells matches the backdrop photo itself (luminance correlation).
  const likePhoto = async (p, a, cx, cy, w, h) => {
    const src = await p.evaluate(() => window.__ascii.map.arena.backdrop.photo.src.hi);
    const file = new URL(`../public/${src}`, import.meta.url).pathname;
    const shot = await sharp(await p.screenshot({ clip: await cellsClip(p, a.x + 1 + cx, a.y + 1 + cy, w, h) })).raw().toBuffer({ resolveWithObject: true });
    const { width: W, height: H } = await sharp(file).metadata();
    const cr = coverCrop(W, H, a.cols, a.rows), kx = cr.sw / a.cols, ky = cr.sh / a.rows;
    const ref = await sharp(file).extract({ left: Math.round(cr.sx + cx * kx), top: Math.round(cr.sy + cy * ky), width: Math.round(w * kx), height: Math.round(h * ky) })
      .resize(shot.info.width, shot.info.height, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const n = shot.info.width * shot.info.height, sc = shot.info.channels;
    const A = [], B = [];
    for (let i = 0; i < n; i++) { A.push(shot.data[i * sc] + shot.data[i * sc + 1] + shot.data[i * sc + 2]); B.push(ref[i * 3] + ref[i * 3 + 1] + ref[i * 3 + 2]); }
    const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length, ma = mean(A), mb = mean(B);
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < n; i++) { ab += (A[i] - ma) * (B[i] - mb); aa += (A[i] - ma) ** 2; bb += (B[i] - mb) ** 2; }
    return ab / Math.sqrt(aa * bb);
  };
  for (const r of ['canvas', 'gl']) {
    await check(`${r}: the arena backdrop is the photograph itself, not characters`, async () => {
      await page.goto(`${url}?r=${r}#/room/arena`); await ready(page);
      const a = await page.evaluate(() => { const a = window.__ascii.map.arena; return { x: a.x, y: a.y, cols: a.cols, rows: a.rows, id: a.backdrop.id }; });
      await page.waitForFunction((fid) => window.__ascii.loaded(fid), { timeout: 30000 }, a.id);
      await sleep(400);
      // A gap in the level (rows 20–23, cols 64–83, the train's side): only the photo is there.
      const corr = await likePhoto(page, a, 64, 20, 20, 4);
      console.log(`  ${r} arena: backdrop vs the photo file, correlation ${corr.toFixed(3)}`);
      assert.ok(corr > 0.9, `the photograph (${corr.toFixed(3)})`);
      // A ▓ block is only its outline: the photo shows inside it (the tree trunk is one).
      const b = await page.evaluate(() => {
        const L = window.__ascii.map.arena.level, k = L.cells.indexOf(2);
        if (k < 0) return null;
        const c = k % L.cols, r = Math.floor(k / L.cols);
        let w = 0, h = 0;
        while (L.cells[r * L.cols + c + w] === 2) w++;
        while (L.cells[(r + h) * L.cols + c] === 2) h++;
        return { c, r, w, h };
      });
      if (b && b.w > 2 && b.h > 2) {
        const inside = await likePhoto(page, a, b.c + 1, b.r + 1, b.w - 2, b.h - 2);
        console.log(`  ${r} arena: inside a ▓ block vs the photo file, correlation ${inside.toFixed(3)}`);
        assert.ok(inside > 0.8, `the photo inside the block (${inside.toFixed(3)})`);
      }
    });
  }
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
    await check(`${r}: the backdrop's large image loads only near the arena, not at spawn`, async () => {
      const hits = [];
      const onReq = (q) => { if (/\/hi\//.test(q.url())) hits.push(q.url()); };
      page.on('request', onReq);
      try {
        await page.goto(`${url}?r=${r}`); await ready(page);
        const a = await arenaInfo(page);
        await sleep(2000);
        assert.deepEqual(hits.filter((h) => h.includes(a.id)), [], 'fetched at spawn');
        await page.evaluate((d) => window.__ascii.teleport(d.x + 6.5, d.y + 1.5), a.door); // in the corridor
        await page.waitForFunction((id) => window.__ascii.loaded(id), { timeout: 15000 }, a.id);
        assert.equal(hits.filter((h) => h.includes(a.id)).length, 1);
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
  // The stickman (stickman spec §8): my figure in every pose, pinned with __ascii.pose, with each renderer,
  // on a computer and on a landscape phone, over the brightest part of the arena photo.
  const POSES = [
    ['idle', {}], ['run', { vx: 30 }], ['rise', { ground: false, vy: -20 }], ['fall', { ground: false, vy: 20 }],
    ['shoot 0', { act: 'shoot', actT: 0.1, aim: 0 }], ['shoot -45', { act: 'shoot', actT: 0.1, aim: -Math.PI / 4 }],
    ['shoot +45', { act: 'shoot', actT: 0.1, aim: Math.PI / 4 }], ['shoot -90', { act: 'shoot', actT: 0.1, aim: -Math.PI / 2 }],
    ['punch', { act: 'punch', actT: 0.1 }], ['kick', { act: 'kick', actT: 0.15 }], ['hurt', { act: 'hurt', actT: 0.05 }],
    ['dead 0.3', { act: 'dead', actT: 0.3 }], ['dead 1.5', { act: 'dead', actT: 1.5 }], ['respawn 0.2', { act: 'idle', spawnT: 0.2 }],
    // The rig (rig addendum): a carried rifle at the chest, a landing squat, a kick's wind-up, the roll's tumble.
    ['rifle', { gun: 'rifle' }], ['land', { landT: 0.03 }], ['kick 0.03', { act: 'kick', actT: 0.03 }], ['roll 0.12', { act: 'roll', actT: 0.12 }],
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
      await check(`${r} on a ${size}: my stick figure in every pose, amber with a dark outline over the brightest part of the photo`, async () => {
        await page.setViewport(vp);
        await page.goto('about:blank');
        await page.goto(`${url}?r=${r}#/room/arena`); await ready(page);
        await page.waitForFunction(() => window.__ascii.loaded(window.__ascii.map.arena.backdrop.id), { timeout: 30000 });
        await page.evaluate(() => window.__ascii.pose({ act: 'dead', actT: 5 })); // nothing drawn
        await sleep(1500);
        const v = await viewOf(page);
        const spot = await brightest(page, v);
        assert.ok(spot && spot.lum > 100, `a bright spot (${spot && spot.lum.toFixed(0)})`);
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
          let ring = 0, dark = 0, baseDark = 0;
          const seen = new Uint8Array(w * h);
          for (let j = 0; j < w * h; j++) {
            if (!mask[j]) continue;
            const jx = j % w, jy = (j / w) | 0;
            for (let y = Math.max(0, jy - ringR); y <= Math.min(h - 1, jy + ringR); y++) for (let x = Math.max(0, jx - ringR); x <= Math.min(w - 1, jx + ringR); x++) {
              const q = y * w + x;
              if (mask[q] || seen[q]) continue;
              seen[q] = 1; ring++;
              if (lum(fig.data, q * 3) < 40) dark++;
              if (lum(base.data, q * 3) < 40) baseDark++;
            }
          }
          log.push(`${name}: ${n} ${ink === isWhite ? 'white' : 'amber'}, ring ${ring} (${dark} dark, ${baseDark} before)`);
          // Faded poses (dead after 1.4 s, the respawn's fly-in) fade their outline too.
          const full = !(dead && o2.actT > 1.4) && !(o2.spawnT < 0.45);
          stats.push({ name, n, dark: dark - baseDark, full, ink: ink === isWhite ? 'white' : 'amber' });
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
      await page.waitForFunction(() => window.__ascii.loaded(window.__ascii.map.arena.backdrop.id), { timeout: 30000 });
      await sleep(1000);
      await page.evaluate(() => { window.__ascii.stats.times.length = 0; });
      await sleep(2000);
      const t = await page.evaluate(() => window.__ascii.stats.times.slice());
      const sorted = [...t].sort((a, b) => a - b), avg = t.reduce((a, b) => a + b, 0) / t.length;
      const info = await page.evaluate(() => ({ bodies: window.__ascii.world.bodies.filter((b) => b.label !== 'dummy').length, glyphs: window.__ascii.world.figures.length }));
      console.log(`  ${r} with 30 bots: ${info.bodies} bodies, ${info.glyphs} glyphs, ${(avg * 1000).toFixed(1)} ms a frame, p95 ${(sorted[Math.floor(sorted.length * 0.95)] * 1000).toFixed(1)} ms`);
      await page.screenshot({ path: `${SHOTS}/stick-${r}-bots30.png` });
      assert.equal(info.bodies, 31); // me and the bots (the practice dummy stands there too)
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
    await page.evaluate((e) => window.__ascii.teleport(e.x + 0.5, e.y + 0.5), entry);
    await page.waitForFunction(() => window.__ascii.mode() === 'side' && window.__ascii.world.figures.some((g) => g.bold), { timeout: 3000 });
    assert.ok(await page.evaluate(() => window.__ascii.world.figures.some((g) => g.bold && g.a < 1)), 'flying in');
    // Past the fly-in (0.45 s) and the 1.5 s of protection on entering, whose pulse dims the figure too.
    await sleep(1800);
    assert.ok(await page.evaluate(() => window.__ascii.world.figures.filter((g) => g.bold).every((g) => g.a === 1)), 'in place after 0.45 s');
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
