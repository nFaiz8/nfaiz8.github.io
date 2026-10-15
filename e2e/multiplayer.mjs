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
    await check('chat filter: a swear reaches the other page with one letter starred; a slur is not sent and mutes my chat', async () => {
      await sleep(2100);
      await b.focus('#stage');
      await b.keyboard.press('KeyT');
      await b.waitForSelector('#chat-form:not([hidden])');
      await b.keyboard.type('oh shit');
      await b.keyboard.press('Enter');
      await a.waitForFunction(() => document.getElementById('chat-log').textContent.includes('oh sh*t'), { timeout: 3000 });
      assert.equal(await a.evaluate(() => document.getElementById('chat-log').textContent.includes('oh shit')), false);
      await sleep(2100);
      await b.focus('#stage');
      await b.keyboard.press('KeyT');
      await b.waitForSelector('#chat-form:not([hidden])');
      await b.keyboard.type('f a g');
      await b.keyboard.press('Enter');
      assert.equal(await b.$eval('#chat-msg', (e) => e.textContent), 'chat muted for 10 min');
      await b.keyboard.type('sorry');
      await b.keyboard.press('Enter');
      assert.equal(await b.$eval('#chat-msg', (e) => e.textContent), 'chat muted for 10 min', 'still muted');
      await sleep(1000);
      const log = await a.evaluate(() => document.getElementById('chat-log').textContent);
      assert.ok(!/f a g|sorry/.test(log), `reached the other page: ${log}`);
      await b.$eval('#chat-input', (e) => { e.value = ''; });
      await b.keyboard.press('Escape');
      await b.evaluate(() => localStorage.removeItem('faiz-chat-muted')); // the later checks chat
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
      // B runs away from where B came in, then B's connection drops: on A's screen B fades where B was,
      // never back at where B's last position message (from before the fight) put them.
      await b.keyboard.down('ArrowLeft'); await sleep(700); await b.keyboard.up('ArrowLeft');
      await sleep(1000);
      const bx = (await bodyOf(bId)).x;
      const xs = a.evaluate((id) => new Promise((resolve) => {
        const out = [], t0 = performance.now();
        const tick = () => {
          const body = (window.__ascii.world.bodies || []).find((x) => x.id === id);
          if (body) out.push(body.state.x);
          if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else resolve(out);
        };
        requestAnimationFrame(tick);
      }), bId);
      await sleep(100);
      await b.evaluate(() => window.__ascii.live().net.pause());
      const drawnAt = await xs;
      assert.ok(Math.abs(bx - (entry.x - 10 + 0.5)) > 4, `B ran away from the entry spot (${bx})`);
      assert.ok(drawnAt.every((x) => Math.abs(x - bx) < 1), `B is drawn only where B was (${bx.toFixed(1)}): ${[...new Set(drawnAt.map((x) => x.toFixed(1)))].join(' ')}`);
      await b.evaluate(() => window.__ascii.live().net.resume());
      await a.waitForFunction(() => window.__ascii.live().peers.count() === 1, { timeout: 10000 });
      // From outside, nobody inside is drawn: B inside isn't an @, B outside is.
      const atsAre = (n) => a.waitForFunction((n) => window.__ascii.world.entities.filter((e) => e.glyph === '@').length === n, { timeout: 5000 }, n);
      await a.evaluate(() => window.__ascii.teleport(window.__ascii.map.spawn.x, window.__ascii.map.spawn.y));
      await sleep(300);
      await atsAre(1);
      await b.evaluate(() => window.__ascii.teleport(window.__ascii.map.spawn.x + 4, window.__ascii.map.spawn.y));
      await atsAre(2);
    });
    await check('arena: fighters collide: A runs at B and stops beside B, then jumps onto B\'s head and stands there, on both screens', async () => {
      const entry = await a.evaluate(() => window.__ascii.map.arena.entry);
      await a.evaluate((e) => window.__ascii.teleport(e.x - 20 + 0.5, e.y + 0.5), entry);
      await b.evaluate((e) => window.__ascii.teleport(e.x - 12 + 0.5, e.y + 0.5), entry);
      const aId = await a.evaluate(() => window.__ascii.live().peers.myId), bId = await b.evaluate(() => window.__ascii.live().peers.myId);
      await a.waitForFunction((id) => (window.__ascii.world.bodies || []).some((x) => x.id === id), { timeout: 5000 }, bId);
      await b.waitForFunction((id) => (window.__ascii.world.bodies || []).some((x) => x.id === id), { timeout: 5000 }, aId);
      await sleep(3200); // past both fly-ins and the 3 s of protection
      // The server clamps a first state from the door, so a teleported B is seen there until B moves: a step.
      await b.evaluate(() => window.__ascii.input().press('ArrowLeft', true));
      await sleep(50);
      await b.evaluate(() => window.__ascii.input().press('ArrowLeft', false));
      await sleep(700);
      const seenOn = async (p, id) => {
        const s = await p.evaluate((id) => (window.__ascii.world.bodies || []).find((x) => x.id === id)?.state || null, id);
        assert.ok(s, `${id} is not drawn (ran out of the arena through them?)`);
        return s;
      };
      const meOn = (p) => p.evaluate(() => { const q = window.__ascii.world.player; return { x: q.x, y: q.y, ground: q.onGround }; });
      const bAt = await meOn(b);
      await a.evaluate(() => window.__ascii.input().press('ArrowRight', true));
      await sleep(900);
      await a.evaluate(() => window.__ascii.input().press('ArrowRight', false));
      await sleep(300);
      let me = await meOn(a), seen = await seenOn(a, bId);
      assert.ok(Math.abs(me.x - (seen.x - 0.8)) < 0.05, `A stopped beside B (A ${me.x.toFixed(2)}, B drawn at ${seen.x.toFixed(2)})`);
      assert.ok(Math.abs((await meOn(b)).x - bAt.x) < 0.01, 'B was not pushed');
      // Jump; once A's feet are over B's head, a nudge right lands A on it (driven frame by frame in the page).
      await a.evaluate((id) => new Promise((resolve) => {
        const w = window.__ascii.world, inp = window.__ascii.input(), t0 = performance.now();
        let right = false;
        const nudge = (on) => { if (on !== right) { inp.press('ArrowRight', on); right = on; } };
        inp.press('Jump', true);
        const tick = () => {
          const p = w.player, s = w.bodies.find((x) => x.id === id).state, t = performance.now() - t0;
          if (t > 350) inp.press('Jump', false);
          nudge(p.y + 1.5 <= s.y - 1.5 && p.x < s.x - 0.4 && p.vx < 3);
          if (t < 1500 && !(t > 300 && p.onGround)) requestAnimationFrame(tick); else { nudge(false); inp.press('Jump', false); resolve(); }
        };
        requestAnimationFrame(tick);
      }), bId);
      await sleep(600);
      me = await meOn(a); seen = await seenOn(a, bId);
      assert.ok(me.ground && Math.abs(me.y - (seen.y - 3)) < 0.01 && Math.abs(me.x - seen.x) < 0.8, `A stands on B's head on A's screen (A ${me.x.toFixed(2)},${me.y.toFixed(2)}; B ${seen.x.toFixed(2)},${seen.y.toFixed(2)})`);
      const bNow = await meOn(b), aSeen = await seenOn(b, aId);
      assert.ok(Math.abs(aSeen.y - (bNow.y - 3)) < 0.3 && Math.abs(aSeen.x - bNow.x) < 0.8, `and on B's (A drawn at ${aSeen.x.toFixed(2)},${aSeen.y.toFixed(2)}; B ${bNow.x.toFixed(2)},${bNow.y.toFixed(2)})`);
      await a.screenshot({ path: `${SHOTS}/collide-on-head.png` });
      await a.evaluate(() => window.__ascii.teleport(window.__ascii.map.spawn.x, window.__ascii.map.spawn.y));
      await b.evaluate(() => window.__ascii.teleport(window.__ascii.map.spawn.x + 4, window.__ascii.map.spawn.y));
      await sleep(300);
    });
    // ---------- The fight with two browsers (PvP spec §14 e2e) ----------
    // Both pages reloaded straight into the arena (a fresh connection each), my shots and every hit logged in
    // window.__fight by wrapping pvp.js's fx.shot and fx.hit.
    const ids = {};
    const fightIn = async (r) => {
      for (const p of [a, b]) { await p.goto(`${live}&r=${r}#/room/arena`); await ready(p); } // a new query: a fresh page
      for (const p of [a, b]) await p.waitForFunction(() => { const P = window.__ascii.pvp(); return P.entered && P.online && P.fighters.ids().length === 1; }, { timeout: 15000 });
      for (const p of [a, b]) {
        await p.evaluate(() => {
          const fx = window.__ascii.pvp().fx, log = window.__fight = { shots: [], hits: [] }, shot = fx.shot, hit = fx.hit;
          fx.shot = (s) => { log.shots.push({ id: s.id, gun: s.gun, angle: s.angle, mine: s.mine, at: s.at }); return shot(s); };
          fx.hit = (h) => { log.hits.push({ d: h.d, at: h.at }); return hit(h); };
        });
      }
      ids.a = await a.evaluate(() => window.__ascii.pvp().me.id);
      ids.b = await b.evaluate(() => window.__ascii.pvp().me.id);
    };
    // Spots from the level: the floor, 40 cells of open floor (10 clear rows over it, clear of the pickups),
    // the spawns; the pickups where the server put them (pickups addendum). Map cells.
    const spotsOf = () => a.evaluate(() => {
      const A = window.__ascii, a = A.map.arena, L = a.level, ox = a.x + 1, oy = a.y + 1, top = L.door.r + 1;
      const P = A.pvp().pickups(performance.now());
      const busy = (c) => P.some((q) => Math.abs(q.y - oy - (top - 1.5)) < 1 && Math.abs(q.x - ox - c) < 4);
      let open = null;
      for (let c0 = 2; !open && c0 + 40 < L.cols - 2; c0++) {
        let ok = true;
        for (let c = c0; ok && c <= c0 + 40; c++) ok = L.cells[top * L.cols + c] !== 0 && !busy(c) && [...Array(10)].every((_, k) => !L.cells[(top - 1 - k) * L.cols + c]);
        if (ok) open = ox + c0 + 0.5;
      }
      const pk = (kind) => P.find((q) => q.kind === kind);
      return { floor: a.floorY - 1.5, open, rifle: pk('rifle'), sniper: pk('sniper'), spawns: L.spawns.map((s) => ({ x: s.x + ox, y: s.y + oy })) };
    });
    // A fighter as page p draws it (null if not drawn).
    const bodyOn = (p, id) => p.evaluate((id) => { const q = window.__ascii.pvp().bodies(performance.now()).find((x) => x.id === id); return q ? { ...q.state, color: q.color } : null; }, id);
    const meOn = (p) => p.evaluate(() => { const q = window.__ascii.world.player; return { x: q.x, y: q.y }; });
    // Puts p's fighter at (x, y) facing f, until q sees it there. The server clamps a jump in position (a
    // teleport) to a run from the last state it took, so it's carried over a step at a time: each teleport is a
    // new state, a third of a second after the last (the clamp allows more after a longer gap).
    const putAt = async (p, q, x, y, f) => {
      const id = p === a ? ids.a : ids.b;
      let s = null, me = null;
      for (let k = 0; k < 40; k++) { // the pickups are at random spots: it may come from across the level
        await p.evaluate((x, y, f) => { window.__ascii.teleport(x, y); window.__ascii.world.player.facing = f; }, x + (k % 2) * 0.01, y, f);
        await sleep(350);
        s = await bodyOn(q, id); me = await meOn(p);
        if (s && Math.abs(s.x - me.x) < 0.3 && Math.abs(s.y - me.y) < 0.3) return;
      }
      throw new Error(`${id} isn't seen where it was put (${x}, ${y}): there ${me && [me.x, me.y]}, seen at ${s && [s.x, s.y]}`);
    };
    let S;
    for (const r of ['canvas', 'gl']) {
      await check(`arena PvP (${r}): both in the fight see each other as fighters; A holds J facing B: B's hp falls on both screens`, async () => {
        await fightIn(r);
        assert.deepEqual([await a.evaluate(() => window.__ascii.renderer), await b.evaluate(() => window.__ascii.renderer)], [r, r]);
        assert.deepEqual([await a.evaluate(() => window.__ascii.pvp().fighters.ids()), await b.evaluate(() => window.__ascii.pvp().fighters.ids())], [[ids.b], [ids.a]]);
        S = await spotsOf();
        await putAt(a, b, S.open + 5, S.floor, 1);
        await putAt(b, a, S.open + 17, S.floor, -1);
        await sleep(1000); // past the 3 s of protection on entering (with the wait above)
        await a.keyboard.down('KeyJ');
        try { await b.waitForFunction(() => window.__ascii.pvp().me.hp < 100, { timeout: 4000 }); } finally { await a.keyboard.up('KeyJ'); }
        const hp = await b.evaluate(() => window.__ascii.pvp().me.hp);
        await a.waitForFunction((id, hp) => window.__ascii.pvp().bodies(performance.now()).find((x) => x.id === id)?.state.hp === hp, { timeout: 2000 }, ids.b, hp);
        console.log(`  ${r}: B's hp ${hp} on B's screen and on A's`);
        assert.ok(hp <= 75, `hit (${hp})`);
      });
    }
    await check('arena PvP: A pops B: the scoreboards say so (you 1 / Ann 1); B is back about 2 s later at a marked spawn, protected on A\'s screen', async () => {
      await sleep(1000); // A's last shots land or fly off
      const track = b.evaluate(() => new Promise((resolve) => {
        const P = window.__ascii.pvp(), p = window.__ascii.world.player, out = [], t0 = performance.now();
        const tick = () => {
          out.push({ t: performance.now(), alive: P.me.alive, x: p.x, y: p.y });
          const died = out.findIndex((q) => !q.alive), back = died < 0 ? -1 : out.findIndex((q, i) => i > died && q.alive);
          if (performance.now() - t0 < 12000 && back < 0) requestAnimationFrame(tick); else resolve(out);
        };
        requestAnimationFrame(tick);
      }));
      track.catch(() => {}); // awaited below; a check failing first mustn't leave it unhandled
      await a.keyboard.down('KeyJ');
      try { await b.waitForFunction(() => !window.__ascii.pvp().me.alive, { timeout: 6000 }); } finally { await a.keyboard.up('KeyJ'); }
      await a.waitForFunction(() => /you 1/.test(document.getElementById('fight-board').textContent), { timeout: 2000 });
      await b.waitForFunction(() => /Ann 1/.test(document.getElementById('fight-board').textContent), { timeout: 2000 });
      await a.waitForFunction((id) => window.__ascii.pvp().bodies(performance.now()).find((x) => x.id === id)?.state.safe === true, { timeout: 5000, polling: 'raf' }, ids.b);
      const out = await track;
      const died = out.findIndex((q) => !q.alive), back = out.findIndex((q, i) => i > died && q.alive);
      assert.ok(died >= 0 && back > died, 'popped and back');
      const gone = out[back].t - out[died].t, at = out.at(-1);
      const spawn = S.spawns.find((s) => Math.abs(s.x - at.x) < 0.1 && Math.abs(s.y - at.y) < 0.1);
      console.log(`  pop: B back after ${gone.toFixed(0)} ms at ${at.x}, ${at.y}; boards "${await a.$eval('#fight-board', (e) => e.textContent)}" / "${await b.$eval('#fight-board', (e) => e.textContent)}"`);
      assert.ok(gone > 1800 && gone < 3000, `back after ${gone.toFixed(0)} ms`);
      assert.ok(spawn, `at a marked spawn (${at.x}, ${at.y})`);
    });
    await check('arena PvP: A presses K next to B: B is knocked more than 2 cells away, on both screens', async () => {
      await putAt(b, a, S.open + 17, S.floor, -1);
      await putAt(a, b, S.open + 15.8, S.floor, 1);
      await sleep(3100); // B's protection from the respawn is over
      const b0 = (await meOn(b)).x, seen0 = (await bodyOn(a, ids.b)).x;
      await a.focus('#stage');
      await a.keyboard.press('KeyK');
      await sleep(900);
      const b1 = (await meOn(b)).x, seen1 = (await bodyOn(a, ids.b)).x;
      console.log(`  K: B moved ${(b1 - b0).toFixed(2)} cells on B's screen, ${(seen1 - seen0).toFixed(2)} on A's`);
      assert.ok(b1 - b0 > 2, `on B's screen (${b1 - b0})`);
      assert.ok(seen1 - seen0 > 2, `on A's screen (${seen1 - seen0})`);
    });
    await check('arena PvP: B jumps: on A\'s screen B never moves more than 1.2 cells a frame, and peaks within 0.5 rows of B\'s own peak', async () => {
      await sleep(600);
      const seen = a.evaluate((id) => new Promise((resolve) => {
        const P = window.__ascii.pvp(), out = [], t0 = performance.now();
        const tick = () => {
          const q = P.bodies(performance.now()).find((x) => x.id === id);
          if (q) out.push({ t: performance.now(), x: q.state.x, y: q.state.y });
          if (performance.now() - t0 < 1800) requestAnimationFrame(tick); else resolve(out);
        };
        requestAnimationFrame(tick);
      }), ids.b);
      seen.catch(() => {}); // awaited below; a check failing first mustn't leave it unhandled
      const own = b.evaluate(() => new Promise((resolve) => {
        const p = window.__ascii.world.player, out = [], t0 = performance.now();
        const tick = () => { out.push(p.y); if (performance.now() - t0 < 1800) requestAnimationFrame(tick); else resolve(out); };
        requestAnimationFrame(tick);
      }));
      own.catch(() => {}); // awaited below; a check failing first mustn't leave it unhandled
      await sleep(150);
      await b.focus('#stage');
      await b.keyboard.down('Space'); await sleep(400); await b.keyboard.up('Space');
      const fr = await seen, ys = await own;
      let step = 0, gap = 0;
      for (let i = 1; i < fr.length; i++) { step = Math.max(step, Math.hypot(fr[i].x - fr[i - 1].x, fr[i].y - fr[i - 1].y)); gap = Math.max(gap, fr[i].t - fr[i - 1].t); }
      const peakSeen = Math.min(...fr.map((f) => f.y)), peak = Math.min(...ys);
      console.log(`  B's jump on A's screen: ${fr.length} frames (longest ${gap.toFixed(0)} ms), largest step ${step.toFixed(2)} cells, peak ${peakSeen.toFixed(2)} vs B's own ${peak.toFixed(2)} (rise ${(ys[0] - peak).toFixed(2)})`);
      assert.ok(ys[0] - peak > 4, 'B jumped');
      assert.ok(step <= 1.2, `largest step a frame ${step.toFixed(2)}`);
      assert.ok(Math.abs(peakSeen - peak) <= 0.5, `peak ${peakSeen} vs ${peak}`);
    });
    await check('arena PvP: B opens a photo: B leaves the fight on A\'s screen, and is back on closing it', async () => {
      await b.focus('#stage');
      await b.keyboard.press('KeyE');
      await b.waitForFunction(() => window.__ascii.viewer.state === 'open', { timeout: 20000 });
      await a.waitForFunction(() => window.__ascii.pvp().fighters.ids().length === 0, { timeout: 3000 });
      await b.keyboard.press('Escape');
      await b.waitForFunction(() => window.__ascii.viewer.state === 'closed', { timeout: 20000 });
      await a.waitForFunction((id) => window.__ascii.pvp().fighters.ids().includes(id), { timeout: 5000 }, ids.b);
    });
    await check('arena PvP: A walks into the rifle: A holds a rifle on both screens, and B sees A\'s shots as rifle bullets', async () => {
      // Onto car A's roof from the floor right under it: one step straight up (a slanted run of clamped steps
      // can end one inside the roof, which the server drops).
      // It may be anywhere (pickups addendum): under it on the floor, then straight up onto it.
      await putAt(a, b, S.rifle.x, S.floor, 1);
      if (S.rifle.y !== S.floor) await putAt(a, b, S.rifle.x, S.rifle.y, 1).catch(() => {}); // taken on arrival: not seen standing there
      await a.waitForFunction(() => window.__ascii.pvp().me.gun === 'rifle', { timeout: 3000 });
      await b.waitForFunction((id) => window.__ascii.pvp().bodies(performance.now()).find((x) => x.id === id)?.state.gun === 'rifle', { timeout: 3000 }, ids.a);
      const n0 = await b.evaluate(() => window.__fight.shots.length); // A's earlier shots (the deagle) aren't these
      await a.keyboard.down('KeyJ'); await sleep(350); await a.keyboard.up('KeyJ');
      await b.waitForFunction((id, n0) => window.__fight.shots.slice(n0).filter((s) => s.id === id).length >= 2, { timeout: 2000 }, ids.a, n0);
      const guns = await b.evaluate((id, n0) => window.__fight.shots.slice(n0).filter((s) => s.id === id).map((s) => s.gun), ids.a, n0);
      console.log(`  rifle: B saw A's shots as ${[...new Set(guns)].join(', ')} (${guns.length})`);
      assert.ok(guns.every((g) => g === 'rifle'), guns.join(' '));
    });
    await check('arena PvP: A holds the sniper: B\'s screen draws A\'s dotted aim line', async () => {
      await putAt(a, b, S.sniper.x, S.floor, 1);
      if (S.sniper.y !== S.floor) await putAt(a, b, S.sniper.x, S.sniper.y, 1).catch(() => {});
      await a.waitForFunction(() => window.__ascii.pvp().me.gun === 'sniper', { timeout: 3000 });
      await b.waitForFunction((id) => {
        const A = window.__ascii, q = A.pvp().bodies(performance.now()).find((x) => x.id === id);
        return q && q.state.gun === 'sniper' && A.world.figures.filter((g) => g.ch === '·' && g.color && g.color.join() === q.color.join()).length >= 5;
      }, { timeout: 3000, polling: 'raf' }, ids.a);
      await b.screenshot({ path: `${SHOTS}/pvp-aim-line.png` });
    });
    await check('arena PvP: A double-taps → and rolls about 14 cells on both screens, through B (who isn\'t pushed)', async () => {
      // A first: the sniper's random spot (the last check) may be where B goes, and bodies collide.
      await putAt(a, b, S.open + 5, S.floor, 1);
      await putAt(b, a, S.open + 12, S.floor, -1);
      await sleep(700);
      const own = a.evaluate(() => new Promise((resolve) => {
        const p = window.__ascii.world.player, out = [], t0 = performance.now();
        const tick = () => { out.push({ x: p.x, rollT: p.rollT }); if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else resolve(out); };
        requestAnimationFrame(tick);
      }));
      own.catch(() => {}); // awaited below; a check failing first mustn't leave it unhandled
      await a.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const bAt = await meOn(b), seen0 = (await bodyOn(b, ids.a)).x;
      await a.focus('#stage');
      await a.keyboard.press('ArrowRight'); await a.keyboard.press('ArrowRight');
      const fr = await own;
      await sleep(500);
      const i = fr.findIndex((f) => f.rollT >= 0), j = fr.findIndex((f, k) => k > i && f.rollT < 0);
      const roll = i > 0 && j > i ? fr[j].x - fr[i - 1].x : NaN, aEnd = fr.at(-1).x, seen1 = (await bodyOn(b, ids.a)).x;
      const bNow = await meOn(b), bSeen = (await bodyOn(a, ids.b)).x;
      console.log(`  roll: ${roll.toFixed(2)} cells on A's screen (${(aEnd - fr[0].x).toFixed(2)} with the slide after); on B's ${(seen1 - seen0).toFixed(2)}, ending at ${seen1.toFixed(2)} vs ${aEnd.toFixed(2)}; B at ${bNow.x.toFixed(2)}`);
      assert.ok(roll > 13 && roll < 15.6, `rolled ${roll} cells`);
      assert.ok(Math.abs(seen1 - aEnd) < 1 && seen1 - seen0 > 13, `on B's screen (${seen0} → ${seen1})`);
      assert.ok(aEnd > bAt.x + 1 && seen1 > bNow.x + 1 && bSeen < aEnd - 1, 'through B, on both screens');
      assert.ok(Math.abs(bNow.x - bAt.x) < 0.05, 'B was not pushed');
    });
    // Last of the live checks: it kills wrangler dev.
    await check('stopping the server (wrangler dev is killed here) mid-fight: both get the dummy, and both stay walkable', async () => {
      for (const p of [a, b]) assert.equal(await p.evaluate(() => window.__ascii.mode()), 'side', 'in the arena as it stops');
      dev.kill();
      for (const p of [a, b]) await p.waitForFunction(() => { const P = window.__ascii.pvp(); return P.entered && !P.online && P.bodies(performance.now()).some((x) => x.dummy); }, { timeout: 8000 });
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
