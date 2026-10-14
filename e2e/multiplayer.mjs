// Two visitors in one gallery, against the Worker running locally (wrangler dev). Usage: npm run e2e:live
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { withBrowser, launchBrowser, ready, sleep, SHOTS } from './lib.mjs';

const PORT = 8796;
const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], { cwd: fileURLToPath(new URL('../server', import.meta.url)) });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('wrangler dev did not start')), 60000);
  const on = (d) => { if (String(d).includes('Ready on')) { clearTimeout(t); resolve(); } };
  dev.stdout.on('data', on); dev.stderr.on('data', on);
});

const results = [];
const check = async (name, fn) => { try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };

try {
  await withBrowser(async ({ page: a, url, errors }) => {
    const live = `${url}?live=ws://127.0.0.1:${PORT}`;
    // A second browser, not a second tab: a background tab is hidden and its animation loop never runs.
    const other = await launchBrowser();
    const b = await other.newPage();
    b.on('pageerror', (e) => errors.push(e.message));
    await b.setViewport({ width: 1000, height: 700 });
    await a.evaluateOnNewDocument(() => localStorage.setItem('faiz-live-name', 'Ann'));
    await b.evaluateOnNewDocument(() => localStorage.setItem('faiz-live-name', 'Bo'));
    await a.goto(live); await ready(a);
    await b.goto(live); await ready(b);
    const peersOf = (p) => p.evaluate(() => window.__ascii.live().peers.list(performance.now()).map((x) => ({ id: x.id, name: x.name, x: x.x, y: x.y, emote: x.emote })));

    await check('each sees the other, with names, and the HUD counts them', async () => {
      await a.waitForFunction(() => window.__ascii.live().peers.count() === 1, { timeout: 10000 });
      await b.waitForFunction(() => window.__ascii.live().peers.count() === 1, { timeout: 10000 });
      assert.equal((await peersOf(a))[0].name, 'Bo');
      assert.equal(await a.$eval('#hud-here', (e) => e.textContent), '1 here');
    });
    await check('someone standing still is seen where they really are', async () => {
      const bAt = await b.evaluate(() => ({ x: window.__ascii.world.player.x, y: window.__ascii.world.player.y }));
      const seen = (await peersOf(a))[0];
      assert.ok(Math.hypot(seen.x - bAt.x, seen.y - bAt.y) < 0.5, `seen at ${seen.x},${seen.y}, really ${bAt.x},${bAt.y}`);
    });
    await check('stepping to a photo without walking (a teleport) is seen on the other page', async () => {
      const to = await b.evaluate(() => { const f = window.__ascii.map.frames.filter((f) => !f.backdrop).at(-1); window.__ascii.teleport(f.stand.x + 0.5, f.stand.y + 0.5); return { x: f.stand.x + 0.5, y: f.stand.y + 0.5 }; });
      await sleep(1000);
      const seen = (await peersOf(a))[0];
      assert.ok(Math.hypot(seen.x - to.x, seen.y - to.y) < 0.5, `seen at ${seen.x},${seen.y}, really ${to.x},${to.y}`);
    });
    await check('walking on one page moves the @ on the other', async () => {
      await b.evaluate(() => { const r = window.__ascii.map.rooms[1]; window.__ascii.walkTo(r.entry.x, r.entry.y); });
      await sleep(300);
      await b.waitForFunction(() => !window.__ascii.world.player.moving, { timeout: 20000 });
      await sleep(800);
      const bAt = await b.evaluate(() => ({ x: window.__ascii.world.player.x, y: window.__ascii.world.player.y }));
      const seen = (await peersOf(a))[0];
      assert.ok(Math.hypot(seen.x - bAt.x, seen.y - bAt.y) < 1.5, `seen at ${seen.x},${seen.y}, really ${bAt.x},${bAt.y}`);
    });
    await check('pressing 1 shows a heart over that person on the other page', async () => {
      await b.focus('#stage');
      await b.keyboard.press('Digit1');
      await a.waitForFunction(() => window.__ascii.live().peers.list(performance.now())[0]?.emote === '♥', { timeout: 3000 });
    });
    await check('H at a print floats a heart from that frame on the other page', async () => {
      const fid = await b.evaluate(() => { const f = window.__ascii.map.frames[0]; window.__ascii.teleport(f.stand.x + 0.5, f.stand.y + 0.5); return f.id; });
      await b.waitForFunction((id) => window.__ascii.world.focus?.id === id, {}, fid);
      await sleep(2100); // past the local heart limit from earlier checks
      await b.keyboard.press('KeyH');
      await a.waitForFunction((id) => window.__ascii.live().peers.hearts(performance.now()).some((h) => h.f === id), { timeout: 3000 }, fid);
    });
    await check('typing in the name field sends no emotes and opens nothing', async () => {
      await a.focus('#stage');
      await a.keyboard.press('KeyN');
      await a.waitForSelector('#name-form:not([hidden])');
      assert.equal(await a.$eval('#name-input', (e) => getComputedStyle(e).outlineStyle), 'none', 'browser focus ring on the name box');
      await a.keyboard.type('5gmh');
      await sleep(400);
      assert.equal(await b.evaluate(() => window.__ascii.live().peers.list(performance.now())[0]?.emote ?? null), null);
      assert.equal(await a.evaluate(() => window.__ascii.grid.isOpen), false);
      await a.keyboard.press('Enter');
      await b.waitForFunction(() => window.__ascii.live().peers.list(performance.now())[0]?.name === '5gmh', { timeout: 3000 });
    });
    await check('on a phone: one-row HUD, popovers below it and one at a time, no zoom on the name field, caption lets taps through', async () => {
      await a.setViewport({ width: 375, height: 700, deviceScaleFactor: 1 });
      await sleep(300);
      const hud = await a.$eval('.hud', (e) => e.getBoundingClientRect().bottom);
      for (const id of ['emote-btn', 'name-btn', 'map-btn', 'renderer-btn']) {
        const h = await a.$eval(`#${id}`, (e) => e.getBoundingClientRect().height);
        assert.ok(h < 34, `#${id} is ${h}px tall (wrapped)`);
      }
      await a.click('#emote-btn');
      const barTop = await a.$eval('#emote-bar', (e) => e.getBoundingClientRect().top);
      assert.ok(barTop >= hud, `emote bar at ${barTop} under HUD bottom ${hud}`);
      await a.click('#name-btn');
      assert.equal(await a.$eval('#emote-bar', (e) => e.hidden), true, 'emote bar still open under the name form');
      const form = await a.$eval('#name-form', (e) => e.getBoundingClientRect().top);
      assert.ok(form >= hud, `name form at ${form} under HUD bottom ${hud}`);
      assert.ok(await a.$eval('#name-input', (e) => parseFloat(getComputedStyle(e).fontSize)) >= 16, 'iOS zooms inputs under 16px');
      await a.click('#name-btn');
      assert.equal(await a.$eval('#name-form', (e) => e.hidden), true, '[N] closes the form again');
      const fid = await a.evaluate(() => { const f = window.__ascii.map.frames[0]; window.__ascii.teleport(f.stand.x + 0.5, f.stand.y + 0.5); return f.id; });
      await a.waitForFunction((id) => window.__ascii.world.focus?.id === id, {}, fid);
      assert.equal(await a.$eval('#caption', (e) => getComputedStyle(e).pointerEvents), 'none');
      assert.equal(await a.$eval('#caption .heart', (e) => getComputedStyle(e).pointerEvents), 'auto');
      await a.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
      await a.focus('#stage');
    });
    await check('tapping the other @ follows them', async () => {
      const target = await b.evaluate(() => ({ x: Math.floor(window.__ascii.world.player.x), y: Math.floor(window.__ascii.world.player.y) }));
      await a.evaluate((t) => window.__ascii.teleport(t.x - 6 + 0.5, t.y + 0.5), target);
      await sleep(600);
      await a.evaluate((t) => window.__ascii.tapCell(t.x, t.y), target);
      await sleep(4000);
      const aAt = await a.evaluate(() => ({ x: window.__ascii.world.player.x, y: window.__ascii.world.player.y }));
      assert.ok(Math.hypot(aAt.x - (target.x + 0.5), aAt.y - (target.y + 0.5)) < 3.5, `follower at ${aAt.x},${aAt.y}`);
    });
    await check('chat: typing sends nothing else, the line reaches the other page, and muting hides that person', async () => {
      await a.focus('#stage');
      const before = await a.evaluate(() => [window.__ascii.world.player.x, window.__ascii.world.player.y]);
      await a.keyboard.press('KeyT');
      await a.waitForSelector('#chat-form:not([hidden])');
      const ring = await a.$eval('#chat-input', (e) => { const c = getComputedStyle(e); return { outline: c.outlineStyle, border: c.borderColor }; });
      assert.equal(ring.outline, 'none', 'browser focus ring on the chat box');
      const idle = await a.$eval('#chat-input', (e) => { e.blur(); const c = getComputedStyle(e).borderColor; e.focus(); return c; });
      assert.notEqual(ring.border, idle, 'no focus style at all');
      await a.keyboard.type('wasd 15 gmh hello');
      await sleep(400);
      assert.deepEqual(await a.evaluate(() => [window.__ascii.world.player.x, window.__ascii.world.player.y]), before, 'typing moved me');
      assert.equal(await a.evaluate(() => window.__ascii.grid.isOpen), false);
      await a.keyboard.press('Enter');
      const aId = await a.evaluate(() => window.__ascii.live().peers.myId);
      await b.waitForFunction((id) => window.__ascii.live().peers.list(performance.now()).find((p) => p.id === id)?.say === 'wasd 15 gmh hello', { timeout: 3000 }, aId);
      assert.equal(await b.evaluate((id) => window.__ascii.live().peers.list(performance.now()).find((p) => p.id === id)?.emote ?? null, aId), null, 'typing sent an emote');
      await b.waitForFunction(() => document.getElementById('chat-log').textContent.includes('wasd 15 gmh hello'), { timeout: 3000 });
      await b.click('#chat-log .chat-who');
      await sleep(2100);
      await a.focus('#stage');
      await a.keyboard.press('KeyT');
      await a.keyboard.type('second line');
      await a.keyboard.press('Enter');
      await sleep(1000);
      assert.equal(await b.evaluate(() => document.getElementById('chat-log').textContent.includes('second line')), false, 'muted line shown');
      assert.equal(await b.evaluate(() => window.__ascii.world.entities.map((e) => e.glyph).join('').includes('secondline')), false, 'muted speech drawn');
    });
    await check('arena: two people inside see each other as stickmen (colour, name above the head, chat above the name), run and jump; from outside nobody inside is drawn', async () => {
      const ats = (p) => p.evaluate(() => window.__ascii.world.entities.filter((e) => e.glyph === '@').length);
      const entry = await a.evaluate(() => window.__ascii.map.arena.entry);
      await a.evaluate((e) => window.__ascii.teleport(e.x - 20 + 0.5, e.y + 0.5), entry);
      await b.evaluate((e) => window.__ascii.teleport(e.x - 10 + 0.5, e.y + 0.5), entry);
      assert.equal(await a.evaluate(() => window.__ascii.mode()), 'side');
      // Inside, B is a fighter: the arena stream replaces B's position messages.
      await a.waitForFunction(() => (window.__ascii.world.bodies || []).some((x) => !x.me && x.label !== 'dummy'), { timeout: 5000 });
      // B is a stick figure in B's colour on A's screen, not an @, with B's name centred above the head.
      const bId = await b.evaluate(() => window.__ascii.live().peers.myId);
      const bodyOf = (id) => a.evaluate((id) => {
        const w = window.__ascii.world, body = (w.bodies || []).find((x) => x.id === id);
        if (!body) return null;
        const same = (c) => c[0] === body.color[0] && c[1] === body.color[1] && c[2] === body.color[2];
        // Labels over B only: A's own chat (from the last check) may still be showing 10 cells away.
        const row = (dy) => w.figures.filter((g) => !g.bold && !g.strip && Math.abs(g.y - (body.state.y + dy)) < 0.3 && Math.abs(g.x - body.state.x) < 4.8);
        return { x: body.state.x, y: body.state.y, color: body.color, head: w.figures.find((g) => g.bold && g.ch === 'O' && same(g.color)) || null,
          figure: w.figures.filter((g) => g.bold && same(g.color)).length, name: row(-2.2), chat: row(-3.3), strips: w.figures.filter((g) => g.strip).length };
      }, id);
      await a.waitForFunction((id) => (window.__ascii.world.bodies || []).some((x) => x.id === id), { timeout: 3000 }, bId);
      await sleep(600); // past the respawn fly-in
      let seen = await bodyOf(bId);
      assert.equal(await ats(a), 0, 'an @ in the side view');
      assert.ok(seen.figure >= 6 && seen.head, `a stick figure in B's colour (${seen.figure} glyphs)`);
      assert.notDeepEqual(seen.color, [255, 206, 110], 'B is not amber');
      assert.equal(seen.name.map((g) => g.ch).join(''), 'Bo', 'B\'s name');
      assert.ok(seen.name.every((g) => g.y < seen.head.y) && Math.abs(seen.name.reduce((s, g) => s + g.x, 0) / seen.name.length - seen.x) < 0.01, 'the name centred above the head');
      // B's chat shows above B's name (B muted A earlier, so this way round).
      await b.focus('#stage');
      await b.keyboard.press('KeyT');
      await b.waitForSelector('#chat-form:not([hidden])');
      await b.keyboard.type('hi from bo');
      await b.keyboard.press('Enter');
      await a.waitForFunction((id) => window.__ascii.live().peers.list(performance.now()).find((p) => p.id === id)?.say === 'hi from bo', { timeout: 3000 }, bId);
      await sleep(100);
      seen = await bodyOf(bId);
      const labels = await a.evaluate(() => window.__ascii.world.figures.filter((g) => !g.bold && !g.strip).map((g) => `${g.ch}@${g.y.toFixed(2)}`).join(' '));
      assert.equal(seen.chat.map((g) => g.ch).join(''), 'hifrombo', `B's chat line (body at ${seen.y.toFixed(2)}; labels ${labels})`);
      assert.ok(seen.chat[0].y < seen.name[0].y && seen.strips >= 12, 'the chat line above the name, on its strip');
      await a.screenshot({ path: `${SHOTS}/stick-multiplayer.png` });
      const yOf = async () => (await bodyOf(bId)).y;
      const y0 = await yOf();
      await b.keyboard.down('Space'); await sleep(400); await b.keyboard.up('Space');
      let top = y0;
      for (let i = 0; i < 15; i++) { top = Math.min(top, await yOf()); await sleep(60); }
      assert.ok(top < y0 - 2, `the jump is seen (${y0} → ${top})`);
      await a.evaluate(() => window.__ascii.teleport(window.__ascii.map.spawn.x, window.__ascii.map.spawn.y));
      await sleep(300);
      assert.equal(await ats(a), 1, 'only my own @ outside');
      await b.evaluate(() => window.__ascii.teleport(window.__ascii.map.spawn.x + 4, window.__ascii.map.spawn.y));
      await a.waitForFunction(() => window.__ascii.world.entities.filter((e) => e.glyph === '@').length === 2, { timeout: 5000 });
    });
    await check('stopping the server leaves both galleries walkable', async () => {
      dev.kill();
      await sleep(1500);
      await a.focus('#stage');
      const before = await a.evaluate(() => window.__ascii.world.player.x);
      await a.keyboard.down('ArrowRight'); await sleep(500); await a.keyboard.up('ArrowRight');
      assert.notEqual(await a.evaluate(() => window.__ascii.world.player.x), before);
    });
    await check('when the connection is lost the other person fades out and the count goes', async () => {
      await a.waitForFunction(() => window.__ascii.live().peers.count() === 0, { timeout: 5000 });
      assert.equal(await a.$eval('#hud-here', (e) => e.hidden), true);
      await sleep(3200);
      assert.equal((await peersOf(a)).length, 0, 'still drawn after the fade');
    });
    await other.close();
    await check('no page errors', async () => assert.deepEqual(errors.filter((e) => !/WebSocket/.test(e)), []));
  });
} finally {
  dev.kill();
}
for (const [s, n, m] of results) console.log(`${s.padEnd(4)} ${n}${m ? ` — ${m}` : ''}`);
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
