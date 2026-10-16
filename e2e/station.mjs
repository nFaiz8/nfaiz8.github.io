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

// Sound (spec §8): every AudioContext the page makes and closes is counted, so trips that leak one show.
const countContexts = () => {
  const A = window.AudioContext;
  if (!A) return;
  const n = { created: 0, closed: 0 };
  window.AudioContext = class extends A {
    constructor(...args) { super(...args); n.created++; }
    close() { n.closed++; return super.close(); }
  };
  window.__contexts = () => ({ ...n });
};
const requested = [];

await withBrowser(async ({ page, url, errors }) => {
  page.on('console', (m) => consoleLog.push(m.text()));
  page.on('request', (r) => requested.push(r.url()));
  await page.evaluateOnNewDocument(countContexts);
  await page.goto(url);
  await ready(page);

  await check('the gallery makes no sound and loads no audio before a key press or tap', async () => {
    await sleep(500);
    assert.deepEqual(await page.evaluate(() => window.__contexts()), { created: 0, closed: 0 });
    assert.equal((await page.evaluate(() => window.__ascii.music())).state, 'none');
    assert.deepEqual(requested.filter((u) => /music|lobby-time|\/rpg\/audio/.test(u)), []);
  });

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

  await check('the station is silent until a key press', async () => {
    const a = await page.evaluate(() => window.__station.audio());
    assert.equal(a.unlocked, false);
    assert.equal((await page.evaluate(() => window.__ascii.music())).state, 'none', 'no gesture yet, so no music either');
    assert.equal(await page.evaluate(() => !!document.querySelector('.sound-toggle')), true, 'the speaker button');
  });

  await check('you walk', async () => {
    const a = await page.evaluate(() => ({ ...window.__station.walker }));
    await page.keyboard.down('KeyD');
    try { await sleep(600); } finally { await page.keyboard.up('KeyD'); }
    const b = await page.evaluate(() => ({ ...window.__station.walker }));
    assert.ok(b.x > a.x + 1, `moved east ${a.x.toFixed(2)} → ${b.x.toFixed(2)}`);
  });

  await check('after a key press the station sounds, and the museum music drifts down the stairs', async () => {
    await page.waitForFunction(() => window.__station.audio().state === 'running' && window.__station.audio().unlocked, { timeout: 5000 });
    await page.waitForFunction(() => window.__ascii.music().state === 'running' && window.__ascii.music().sources === 1, { timeout: 10000 });
    const m = await page.evaluate(() => window.__ascii.music());
    assert.equal(m.scene, 'station');
    await page.evaluate(() => window.__station.teleport(2.6, 9.5)); // at the foot of the exit stairs
    await sleep(200);
    const nearStairs = await page.evaluate(() => window.__ascii.music());
    await page.evaluate(() => window.__station.teleport(11, 9.5)); // across the hall
    await sleep(200);
    const across = await page.evaluate(() => window.__ascii.music());
    assert.ok(nearStairs.gain > 0.05 && nearStairs.cutoff < 2000, `muffled jazz by the stairs: ${JSON.stringify(nearStairs)}`);
    assert.equal(across.gain, 0, 'gone across the hall');
    await page.waitForFunction(() => window.__station.audio().loaded > 10, { timeout: 10000 });
  });

  // The turnstiles (station spec, "Life and props (round 2)"): shut from the hall until you buy a ticket.
  const gates = () => page.evaluate(() => window.__station.gates());
  const popup = () => page.evaluate(() => { const t = document.querySelector('.ticket'); return !!t && !t.hidden; });
  const hold = async (key, until, ms = 4000) => {
    await page.keyboard.down(key);
    try { await page.waitForFunction(until, { timeout: ms }); } finally { await page.keyboard.up(key); }
  };
  await check('walking into a turnstile from the hall opens the fare card machine, and you stay in the hall', async () => {
    await page.evaluate(() => window.__station.teleport(10.5, 8.5));
    await hold('KeyD', () => { const t = document.querySelector('.ticket'); return t && !t.hidden; });
    await sleep(300);
    const w = await page.evaluate(() => ({ ...window.__station.walker }));
    assert.ok(w.x < 12, `stopped at the gate: x ${w.x.toFixed(2)}`);
    assert.match(await page.evaluate(() => document.querySelector('.ticket').innerText), /FARE CARD[\s\S]*single ride[\s\S]*\$2\.90[\s\S]*unlimited ride[\s\S]*\$7\.00[\s\S]*BUY \+ TAP[\s\S]*balance \$20\.00/);
    assert.equal((await gates()).ring[1], 'refused', 'the tap target of the gate you walked into goes red');
    await page.screenshot({ path: `${SHOTS}/station-ticket.png` });
  });

  await check('Esc closes the fare card machine', async () => {
    await page.keyboard.press('Escape');
    assert.equal(await popup(), false);
    assert.equal((await gates()).pass, null);
    // Held keys don't walk you while it's open, and it doesn't come straight back until you push the gate again.
    await sleep(300);
    assert.equal(await popup(), false);
  });

  // The emergency gate: the northernmost lane, exit only and free.
  await check('the emergency gate is locked from the hall, and walking into it opens no fare machine', async () => {
    await page.evaluate(() => window.__station.teleport(10.5, 6.5));
    await page.keyboard.down('KeyD');
    try { await sleep(900); } finally { await page.keyboard.up('KeyD'); }
    const w = await page.evaluate(() => ({ ...window.__station.walker }));
    assert.ok(w.x < 12, `stopped at it: x ${w.x.toFixed(2)}`);
    assert.equal(await popup(), false, 'no pop-up');
    const g = await gates();
    assert.equal(g.swing[0], 0, 'it did not move');
    assert.equal(g.alarm, false);
    await page.screenshot({ path: `${SHOTS}/station-emergency-shut.png` });
  });

  await check('from the platform the emergency gate swings open, lets you out without a ticket, and sounds the alarm', async () => {
    await page.evaluate(() => window.__station.teleport(13.6, 6.5));
    await sleep(200);
    const before = await gates();
    assert.equal(before.pass, null, 'no ticket');
    await hold('KeyA', () => window.__station.walker.x < 12.3);
    await nFrames(page, 2);
    const mid = (await gates()).swing[0];
    assert.ok(mid > 0.1, `it swings open as you push: ${mid.toFixed(2)}`);
    await hold('KeyA', () => window.__station.walker.x < 10.3);
    let g = await gates();
    assert.equal(g.alarm, true, 'the alarm sounds');
    assert.equal(await popup(), false);
    assert.equal(g.wallet, before.wallet, 'free');
    await page.waitForFunction(() => window.__station.gates().swing[0] < 0.6, { timeout: 3000 });
    await page.screenshot({ path: `${SHOTS}/station-emergency-alarm.png` });
    await page.waitForFunction(() => { const g = window.__station.gates(); return g.swing[0] === 0 && !g.alarm; }, { timeout: 5000 });
    // The regular gates still want a ticket (and the next check carries on from this gate).
    await page.evaluate(() => window.__station.teleport(10.5, 8.5));
    await hold('KeyD', () => { const t = document.querySelector('.ticket'); return t && !t.hidden; });
    assert.ok((await page.evaluate(() => window.__station.walker.x)) < 12);
    await page.keyboard.press('Escape');
    await sleep(300);
  });

  await check('a single ride lets you through once, turning the rotor a third; the next time from the hall it asks again', async () => {
    await hold('KeyD', () => { const t = document.querySelector('.ticket'); return t && !t.hidden; });
    const x0 = await page.evaluate(() => window.__station.walker.x);
    const r0 = (await gates()).rotor[1];
    await page.keyboard.press('Enter'); // single is chosen first
    await page.waitForFunction(() => document.querySelector('.ticket').hidden, { timeout: 3000 });
    let g = await gates();
    assert.equal(g.pass, 'single');
    assert.equal(g.wallet, 2000 - 290);
    assert.ok(Math.abs((await page.evaluate(() => window.__station.walker.x)) - x0) < 0.05, 'you stood still while it was open');
    // The tap target turns green.
    assert.equal(g.ring[1], 'go');
    // Mid-push: the rotor follows where you are, so stand there (a held key overshoots) and look.
    await hold('KeyD', () => window.__station.walker.x > 11.9);
    await page.evaluate(() => window.__station.teleport(12.2, 8.5));
    await nFrames(page, 3);
    const mid = (await gates()).rotor[1] - r0;
    assert.ok(mid > 0.1 && mid < 1, `the rotor turns as you push: ${mid.toFixed(2)}`);
    await page.screenshot({ path: `${SHOTS}/station-turnstile-push.png` });
    await hold('KeyD', () => window.__station.walker.x > 13.6);
    g = await gates();
    assert.equal(g.pass, null, 'the single is used up');
    assert.equal(g.used, 1);
    assert.ok(Math.abs(g.rotor[1] - r0 - 1) < 1e-9, `a third of a turn on: ${(g.rotor[1] - r0).toFixed(2)}`);
    // Back to the hall is free...
    await hold('KeyA', () => window.__station.walker.x < 11);
    assert.equal(await popup(), false, 'no ticket needed going out');
    // ...and going in again asks again.
    await hold('KeyD', () => { const t = document.querySelector('.ticket'); return t && !t.hidden; });
    assert.ok((await page.evaluate(() => window.__station.walker.x)) < 12);
    assert.match(await page.evaluate(() => document.querySelector('.ticket').innerText), /ride used/, 'the machine says your single is used up');
  });

  await check('an unlimited ride lets you through again and again', async () => {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.ticket').hidden, { timeout: 3000 });
    assert.equal((await gates()).pass, 'unlimited');
    for (let i = 0; i < 2; i++) {
      await hold('KeyD', () => window.__station.walker.x > 13.6);
      await hold('KeyA', () => window.__station.walker.x < 11);
    }
    const g = await gates();
    assert.equal(g.pass, 'unlimited');
    assert.equal(g.wallet, 2000 - 290 - 700);
    assert.equal(await popup(), false);
    assert.match(await page.evaluate(() => document.querySelector('.ticket-chip').innerText), /UNLIMITED/);
  });

  await check('the turnstile line from the hall: steel cabinets, rotors and tap targets, no screens', async () => {
    await page.evaluate(() => window.__station.teleport(10.6, 9.5)); // in line with a cabinet, so no gate is yours
    await sleep(700);
    const g = await gates();
    assert.deepEqual(g.kind, ['emergency', 'turnstile', 'turnstile', 'turnstile']);
    assert.deepEqual(g.ring, [null, 'idle', 'idle', 'idle']);
    assert.equal(g.reader, undefined, 'no readers');
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /TAP HERE|SWIPE|INSUFFICIENT FARE|JUST USED/);
    await page.screenshot({ path: `${SHOTS}/station-turnstiles.png` });
  });

  await check('the platform has its commuters, pigeons and rats', async () => {
    await page.evaluate(() => { window.__station.setTime(20); window.__station.teleport(30.5, 9.5); });
    await sleep(800);
    const life = await page.evaluate(() => window.__station.life());
    assert.equal(life.commuters.length, 4);
    assert.equal(life.pigeons.length, 4);
    assert.equal(life.rats.length, 2);
    await page.screenshot({ path: `${SHOTS}/station-platform.png` });
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
    assert.equal(await page.evaluate(() => document.querySelectorAll('.ticket, .ticket-chip').length), 0, 'the fare card machine is gone');
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

  await check('short of money the machine says so and offers a top-up', async () => {
    await page.evaluate(() => { window.__station.setWallet(250); window.__station.teleport(10.5, 10.5); });
    await hold('KeyD', () => { const t = document.querySelector('.ticket'); return t && !t.hidden; });
    await page.keyboard.press('Enter');
    assert.match(await page.evaluate(() => document.querySelector('.ticket').innerText), /insufficient funds[\s\S]*top up \+\$20/);
    assert.equal((await gates()).pass, null);
    await page.keyboard.press('KeyT');
    assert.equal((await gates()).wallet, 2250);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.ticket').hidden, { timeout: 3000 });
    const g = await gates();
    assert.equal(g.pass, 'single');
    assert.equal(g.wallet, 2250 - 290);
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

  await check('V mutes the museum music, and it stays muted after a reload', async () => {
    await page.goto(url);
    await ready(page);
    await page.evaluate(() => localStorage.removeItem('faiz.sound'));
    await page.keyboard.press('KeyV');
    await page.waitForFunction(() => window.__ascii.music().state === 'running', { timeout: 10000 });
    assert.equal((await page.evaluate(() => window.__ascii.music())).muted, true);
    assert.equal(await page.evaluate(() => localStorage.getItem('faiz.sound')), 'off');
    assert.equal(await page.evaluate(() => document.getElementById('sound-btn').getAttribute('aria-pressed')), 'true');
    await page.reload();
    await ready(page);
    assert.equal(await page.evaluate(() => document.getElementById('sound-btn').getAttribute('aria-pressed')), 'true', 'still muted');
    await page.click('#sound-btn');
    await page.waitForFunction(() => window.__ascii.music().state === 'running' && !window.__ascii.music().muted, { timeout: 10000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('faiz.sound')), 'on');
  });

  await check('M mutes the station, and it stays muted after a reload', async () => {
    await page.goto('about:blank');
    await page.goto(`${url}#/station`);
    await inStation(page);
    await page.keyboard.press('KeyM');
    assert.equal((await page.evaluate(() => window.__station.audio())).muted, true);
    assert.equal(await page.evaluate(() => document.querySelector('.sound-toggle').getAttribute('aria-pressed')), 'true');
    await page.reload();
    await inStation(page);
    assert.equal((await page.evaluate(() => window.__station.audio())).muted, true, 'remembered');
    await page.keyboard.press('KeyM');
    assert.equal((await page.evaluate(() => window.__station.audio())).muted, false);
    assert.equal(await page.evaluate(() => localStorage.getItem('faiz.sound')), 'on');
  });

  await check('fifteen trips down and up leave one station at most, no lost WebGL contexts, no lingering AudioContexts and one music source', async () => {
    await page.goto(url);
    await ready(page);
    await page.keyboard.press('Shift'); // the music starts
    await page.waitForFunction(() => window.__ascii.music().sources === 1, { timeout: 10000 });
    const before = await page.evaluate(() => window.__ascii.music());
    for (let i = 0; i < 15; i++) {
      await takeStairs(page);
      await inStation(page);
      assert.equal(await page.evaluate(() => document.querySelectorAll('canvas.station').length), 1, `trip ${i + 1}: one station canvas`);
      await page.keyboard.press('Shift'); // the station's sound starts too
      await page.waitForFunction(() => window.__station.audio().unlocked, { timeout: 5000 });
      assert.equal((await page.evaluate(() => window.__ascii.music())).scene, 'station', `trip ${i + 1}: the music hands off`);
      await page.goBack();
      await backInGallery(page);
      assert.equal(await page.evaluate(() => document.querySelectorAll('canvas.station').length), 0, `trip ${i + 1}: no station canvas`);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.sound-toggle').length), 0, `trip ${i + 1}: no station speaker button`);
    }
    const lost = consoleLog.filter((m) => m.includes('Too many active WebGL contexts'));
    assert.deepEqual(lost, []);
    const n = await page.evaluate(() => window.__contexts());
    assert.equal(n.created - n.closed, 1, `only the music's context is left: ${JSON.stringify(n)}`);
    assert.equal(n.created, 16);
    const after = await page.evaluate(() => window.__ascii.music());
    assert.equal(after.sources, 1, 'one music source, never restarted or doubled');
    assert.equal(after.scene, 'gallery');
    assert.ok(after.at > before.at + 5, 'the music kept time all along');
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
