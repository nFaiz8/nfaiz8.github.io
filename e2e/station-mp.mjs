// Multiplayer in the station (station spec, Multiplayer): three visitors against the Worker running locally
// (wrangler dev). Two go down and see each other walk and talk, under the same train; one stays in the gallery
// and sees the lobby's count, and the one who comes back up. Usage: node e2e/station-mp.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { withBrowser, launchBrowser, ready, sleep, SHOTS } from './lib.mjs';

const PORT = Number(process.env.LIVE_PORT) || 8799;
const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], { cwd: fileURLToPath(new URL('../server', import.meta.url)) });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('wrangler dev did not start')), 60000);
  const on = (d) => { if (String(d).includes('Ready on')) { clearTimeout(t); resolve(); } };
  dev.stdout.on('data', on); dev.stderr.on('data', on);
});

const results = [];
const check = async (name, fn) => { try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };
const inStation = (p) => p.waitForFunction(() => window.__station && window.__station.frames() > 20, { timeout: 30000 });
const others = (p) => p.evaluate(() => window.__station.others());

try {
  await withBrowser(async ({ page: a, url, errors }) => {
    const live = `${url}?live=ws://127.0.0.1:${PORT}`;
    // Separate browsers, not tabs: a background tab is hidden and its animation loop never runs.
    const extra = [await launchBrowser(), await launchBrowser()];
    const [b, c] = await Promise.all(extra.map((br) => br.newPage()));
    for (const p of [b, c]) { p.on('pageerror', (e) => errors.push(e.message)); await p.setViewport({ width: 1200, height: 800 }); }
    const names = [[a, 'Ann'], [b, 'Bo'], [c, 'Cy']];
    for (const [p, n] of names) await p.evaluateOnNewDocument((n) => localStorage.setItem('faiz-live-name', n), n);
    for (const [p] of names) { await p.goto(live); await ready(p); }

    await check('three in the gallery see each other', async () => {
      for (const [p] of names) await p.waitForFunction(() => window.__ascii.live().peers.count() === 2, { timeout: 10000 });
    });

    await check('two go down: the gallery sees them leave and the lobby sign counts them', async () => {
      for (const p of [a, b]) {
        await p.evaluate(() => { const s = window.__ascii.map.stairs.inside; window.__ascii.walkTo(s.x + 2, s.y); });
        await inStation(p);
      }
      await c.waitForFunction(() => window.__ascii.live().peers.count() === 0, { timeout: 10000 });
      await c.waitForFunction(() => window.__ascii.live().stationCount === 2, { timeout: 10000 });
      const sign = await c.evaluate(() => { const s = window.__ascii.map.stairs; return window.__ascii.world.entities.filter((e) => Math.floor(e.y) === s.y - 1).map((e) => e.glyph).join(''); });
      assert.equal(sign, '·2', `the sign's count: ${sign}`);
      assert.equal(await a.evaluate(() => window.__ascii.live().areaName), 'station');
    });

    await check('below, each sees the other as a figure where they are', async () => {
      await a.waitForFunction(() => window.__station.others().length === 1, { timeout: 10000 });
      await b.waitForFunction(() => window.__station.others().length === 1, { timeout: 10000 });
      await b.evaluate(() => window.__station.teleport(30.5, 9.5));
      await a.evaluate(() => window.__station.teleport(27.5, 10.5));
      await a.waitForFunction(() => { const [o] = window.__station.others(); return o && Math.hypot(o.x - 30.5, o.z - 9.5) < 0.1; }, { timeout: 5000 });
    });

    await check('walking on one page walks the figure on the other: it moves, strides and faces the way it goes', async () => {
      await b.focus('canvas.station').catch(() => {});
      await b.keyboard.down('KeyD');
      let mid;
      try {
        await sleep(700);
        mid = (await others(a))[0];
        await sleep(300);
      } finally { await b.keyboard.up('KeyD'); }
      assert.ok(mid.x > 31, `seen moving east: x ${mid.x.toFixed(2)}`);
      assert.ok(mid.gait > 0.5, `striding: gait ${mid.gait.toFixed(2)}`);
      assert.ok(Math.abs(mid.yaw - Math.PI / 2) < 0.4, `facing east: yaw ${mid.yaw.toFixed(2)}`);
      await sleep(900);
      const bAt = await b.evaluate(() => ({ x: window.__station.walker.x, z: window.__station.walker.z }));
      const seen = (await others(a))[0];
      assert.ok(Math.hypot(seen.x - bAt.x, seen.z - bAt.z) < 0.1, `stopped where they are: ${seen.x},${seen.z} vs ${bAt.x},${bAt.z}`);
      assert.ok(seen.gait < 0.2, `standing: gait ${seen.gait.toFixed(2)}`);
    });

    await check('chat below: T opens the line, my words float over my head at once and over me on the other page', async () => {
      await b.keyboard.press('KeyT');
      await b.waitForSelector('#chat-form:not([hidden])');
      await b.keyboard.type('mind the gap');
      await b.keyboard.press('Enter');
      assert.equal((await b.evaluate(() => window.__station.mine())).say, 'mind the gap');
      await a.waitForFunction(() => window.__ascii.live().station.list(performance.now())[0]?.say === 'mind the gap', { timeout: 3000 });
      await a.evaluate(() => window.__station.teleport(31.6, 10.6));
      await b.keyboard.press('Digit1');
      await a.waitForFunction(() => window.__ascii.live().station.list(performance.now())[0]?.emote === '♥', { timeout: 3000 });
      await sleep(500);
      await a.screenshot({ path: `${SHOTS}/station-mp-a.png` });
      await b.screenshot({ path: `${SHOTS}/station-mp-b.png` });
    });

    await check('the same train for both: their clocks agree within a tenth of a second', async () => {
      const read = (p) => p.evaluate(() => ({ t: window.__station.clock(), at: Date.now() }));
      const [ra, rb] = await Promise.all([read(a), read(b)]);
      const diff = ra.t - rb.t - (ra.at - rb.at) / 1000;
      assert.ok(Math.abs(diff) < 0.1, `clocks differ by ${diff.toFixed(3)} s`);
      const [ta, tb] = await Promise.all([a, b].map((p) => p.evaluate(() => window.__station.train()?.n ?? null)));
      assert.equal(ta, tb, 'the same run');
    });

    await check('someone riding away is seen inside the departing train from the platform', async () => {
      // Wait for a local standing at MUSEUM (one every minute on the shared clock).
      await a.waitForFunction(() => window.__station.trains().some((l) => l.kind === 'local' && l.at === 0 && l.doors === 1), { timeout: 70000, polling: 250 });
      const k = await a.evaluate(() => window.__station.trains().find((l) => l.kind === 'local' && l.at === 0).k);
      await a.evaluate((k) => window.__station.board(k, 30, 0), k);
      await b.evaluate(() => window.__station.teleport(60, 6.5));
      await b.waitForFunction((k) => {
        const tr = window.__station.trains().find((l) => l.k === k), me = window.__station.others()[0];
        return tr && me && me.x > Math.min(tr.head, tr.tail) && me.x < Math.max(tr.head, tr.tail);
      }, { timeout: 15000, polling: 100 }, k);
      await a.evaluate(() => window.__station.teleport(30.5, 9.5));
    });

    await check('one goes up: the other sees them leave, the gallery sees them arrive, and the count goes down', async () => {
      await b.evaluate(() => history.back());
      await b.waitForFunction(() => !window.__station && window.__ascii.station() === 'off', { timeout: 15000 });
      await a.waitForFunction(() => window.__station.others().length === 0, { timeout: 10000 });
      await c.waitForFunction(() => window.__ascii.live().peers.count() === 1, { timeout: 10000 });
      await c.waitForFunction(() => window.__ascii.live().stationCount === 1, { timeout: 10000 });
      const [p] = await c.evaluate(() => window.__ascii.live().peers.list(performance.now()).map((x) => ({ name: x.name, x: x.x, y: x.y })));
      assert.equal(p.name, 'Bo');
      const front = await c.evaluate(() => window.__ascii.map.stairs.front);
      assert.ok(Math.hypot(p.x - front.x, p.y - front.y) < 1.5, `arrives at the stairs: ${p.x},${p.y}`);
      await b.waitForFunction(() => window.__ascii.live().peers.count() === 1, { timeout: 10000 });
      await c.screenshot({ path: `${SHOTS}/station-mp-lobby.png` });
    });

    await check('the last one comes up: the sign shows no count', async () => {
      await a.evaluate(() => history.back());
      await c.waitForFunction(() => window.__ascii.live().stationCount === 0 && window.__ascii.live().peers.count() === 2, { timeout: 10000 });
      const sign = await c.evaluate(() => { const s = window.__ascii.map.stairs; return window.__ascii.world.entities.filter((e) => Math.floor(e.y) === s.y - 1).length; });
      assert.equal(sign, 0);
    });

    for (const br of extra) await br.close();
    await check('no page errors', async () => assert.deepEqual(errors.filter((e) => !/WebSocket/.test(e)), []));
  }, { port: Number(process.env.E2E_PORT) || 5293 });
} finally {
  dev.kill();
}
for (const [s, n, m] of results) console.log(`${s.padEnd(4)} ${n}${m ? ` — ${m}` : ''}`);
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
