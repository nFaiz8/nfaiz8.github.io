// Live checks for /edit/ in headless Chrome. GitHub is faked inside this process (same origin,
// via ?api=), so no check ever touches the real repository. Usage: npm run e2e:edit
import { withBrowser, SHOTS } from './lib.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { idOf } from '../src/edits.js';

const fixture = JSON.parse(fs.readFileSync(new URL('../test/fixtures/photos.json', import.meta.url)));
const files = fixture.photos.map((p) => `photos/${p.id}.jpg`); // IMG_1000 → photos/IMG_1000.jpg → id img-1000
const manifest = { generated: '2026-01-01T00:00:00.000Z', photos: fixture.photos.map((p) => ({ ...p, id: idOf(`${p.id}.jpg`) })) };
const PNG = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#888888' } }).png().toBuffer();
fs.mkdirSync(SHOTS, { recursive: true });
const tiny = path.join(SHOTS, 'Tiny.jpg');
const clash = path.join(SHOTS, 'IMG_1000.jpg'); // same name as a photo already in the repo
for (const f of [tiny, clash]) await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c03020' } }).jpeg().toFile(f);

function fakeGitHub() {
  let n = 0;
  const g = { token: 'good', blobs: new Map(), trees: new Map(), commits: new Map(), head: 'c0', race: false, refs: 0 };
  const put = (data) => { const sha = `b${++n}`; g.blobs.set(sha, Buffer.from(data)); return sha; };
  g.trees.set('t0', files.map((p) => ({ path: p, type: 'blob', mode: '100644', sha: put('img') })));
  g.commits.set('c0', { sha: 'c0', tree: { sha: 't0' }, parents: [] });
  const mkTree = (base, entries) => {
    const map = new Map(g.trees.get(base).map((e) => [e.path, e]));
    for (const e of entries) {
      if (e.sha === null) map.delete(e.path);
      else map.set(e.path, { path: e.path, type: 'blob', mode: e.mode, sha: e.content != null ? put(e.content) : e.sha });
    }
    const sha = `t${++n}`;
    g.trees.set(sha, [...map.values()]);
    return sha;
  };
  const commit = (tree, parents, message) => {
    const c = { sha: `c${++n}`, tree: { sha: tree }, parents, message, committer: { date: new Date().toISOString() } };
    g.commits.set(c.sha, c);
    return c;
  };
  g.file = (p) => {
    const e = g.trees.get(g.commits.get(g.head).tree.sha).find((x) => x.path === p);
    return e && g.blobs.get(e.sha).toString();
  };
  g.handle = (method, p, body, auth) => {
    if (auth !== `Bearer ${g.token}`) return [401, { message: 'Bad credentials' }];
    let m;
    if (method === 'GET' && p === '') return [200, { full_name: 'nFaiz8/nfaiz8.github.io' }];
    if (method === 'GET' && p === '/git/ref/heads/main') return [200, { object: { sha: g.head } }];
    if (method === 'GET' && (m = p.match(/^\/git\/commits\/(.+)$/))) return [200, g.commits.get(m[1])];
    if (method === 'GET' && (m = p.match(/^\/git\/trees\/(.+)$/))) return [200, { tree: g.trees.get(m[1]) }];
    if (method === 'GET' && (m = p.match(/^\/git\/blobs\/(.+)$/))) return [200, { content: g.blobs.get(m[1]).toString('base64'), encoding: 'base64' }];
    if (method === 'POST' && p === '/git/blobs') return [201, { sha: put(Buffer.from(body.content, 'base64')) }];
    if (method === 'POST' && p === '/git/trees') return [201, { sha: mkTree(body.base_tree, body.tree) }];
    if (method === 'POST' && p === '/git/commits') return [201, commit(body.tree, body.parents, body.message)];
    if (method === 'PATCH' && p === '/git/refs/heads/main') {
      g.refs++;
      if (g.race) { // another device saves first: an edit to a different photo
        g.race = false;
        const t = mkTree(g.commits.get(g.head).tree.sha, [{ path: 'photos/edits.json', mode: '100644', content: '{\n  "img-1005": {\n    "place": "Elsewhere"\n  }\n}\n' }]);
        g.head = commit(t, [g.head], 'other device').sha;
      }
      if (g.commits.get(body.sha).parents[0] !== g.head) return [422, { message: 'Update is not a fast forward' }];
      g.head = body.sha;
      return [200, { object: { sha: body.sha } }];
    }
    return [404, { message: `fake GitHub has no ${method} ${p}` }];
  };
  return g;
}

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message]); }
};
const text = (page, sel) => page.$eval(sel, (e) => e.textContent);
const waitText = (page, sel, re, timeout = 10000) =>
  page.waitForFunction((s, src) => new RegExp(src).test(document.querySelector(s)?.textContent || ''), { timeout }, sel, re.source);

await withBrowser(async ({ page, url, errors }) => {
  const gh = fakeGitHub();
  const apiBase = `${url}__gh`;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith(apiBase)) {
      const p = u.slice(apiBase.length).replace('/repos/nFaiz8/nfaiz8.github.io', '').replace(/\?.*$/, '');
      const body = req.postData() ? JSON.parse(req.postData()) : null;
      const [status, json] = gh.handle(req.method(), p, body, req.headers().authorization);
      const reply = () => req.respond({ status, contentType: 'application/json', body: JSON.stringify(json) });
      return gh.blobDelay && p === '/git/blobs' ? setTimeout(reply, gh.blobDelay) : reply();
    }
    if (/\/photos\/(raw|photos)\.json/.test(u)) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) });
    if (/\/photos\/(low|hi|xl)\//.test(u)) return req.respond({ status: 200, contentType: 'image/png', body: PNG });
    return req.continue();
  });
  const edit = `${url}edit/?api=${encodeURIComponent(apiBase)}`;
  const signIn = async (token) => {
    await page.waitForSelector('#token');
    await page.$eval('#token', (e) => { e.value = ''; });
    await page.type('#token', token);
    await page.keyboard.press('Enter');
  };

  await check('asks for a token first', async () => {
    await page.goto(edit);
    await page.waitForSelector('#token', { timeout: 10000 });
  });
  await check('a refused token is explained', async () => {
    await signIn('nope');
    await waitText(page, '.token .error', /refused/);
  });
  await check('a good token shows every photo in the repo', async () => {
    await signIn('good');
    await page.waitForSelector('.tile');
    assert.equal((await page.$$('.tile')).length, files.length);
  });
  await check('marks a photo as film with a stock', async () => {
    await page.click('.tile[data-id="img-1000"]');
    await page.click('#f-film');
    await page.waitForSelector('#f-stock:not([disabled])');
    await page.type('#f-stock', 'Portra 400');
    await page.keyboard.press('Tab');
    await page.waitForSelector('button[aria-label="reset stock"]'); // the stock edit has rendered
    await waitText(page, '#pending-count', /^1 change$/);
    assert.equal(await page.$eval('#f-stock', (e) => e.value), 'Portra 400');
  });
  await check('hides another photo', async () => {
    await page.click('#close-panel');
    await page.click('.tile[data-id="img-1001"]');
    await page.click('#f-hidden');
    await waitText(page, '#pending-count', /^2 changes$/);
    await page.click('#close-panel');
  });
  await check('the Pending filter shows only changed photos', async () => {
    await page.click('.chip[data-filter="pending"]');
    assert.deepEqual(await page.$$eval('.tile', (ts) => ts.map((t) => t.dataset.id).sort()), ['img-1000', 'img-1001']);
    await page.click('.chip[data-filter="all"]');
  });
  await check('adds photos, renaming a clash', async () => {
    const input = await page.$('#add-input');
    await input.uploadFile(tiny, clash);
    await waitText(page, '#pending-count', /^4 changes$/);
    await page.waitForSelector('.tile[data-id="tiny"] img');
    await page.waitForSelector('.tile[data-id="img-1000-2"] img');
    assert.match(await text(page, '.banner'), /IMG_1000-2\.jpg/);
  });
  await check('pending changes survive a reload', async () => {
    await page.reload();
    await page.waitForSelector('.tile[data-id="tiny"] img');
    await waitText(page, '#pending-count', /^4 changes$/);
  });
  await check('the panel is a bottom sheet on a phone', async () => {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.click('.tile[data-id="tiny"]');
    const r = await page.$eval('.panel', (e) => e.getBoundingClientRect().toJSON());
    assert.equal(Math.round(r.width), 390);
    assert.ok(r.top > 100, `panel top ${r.top}`);
    await page.click('#close-panel');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  });
  await check('save makes one commit, retrying once when main moved', async () => {
    gh.race = true;
    await page.click('#save-btn');
    await waitText(page, '#pending-count', /building/, 20000);
    const c = gh.commits.get(gh.head);
    assert.equal(c.message, 'Edit photos: 2 added, 2 edited');
    assert.equal(gh.refs, 2);
    assert.ok(gh.file('photos/Tiny.jpg') && gh.file('photos/IMG_1000-2.jpg'), 'both uploads committed');
    assert.ok(gh.file('photos/IMG_1000.jpg'), 'the existing photo was not overwritten');
    assert.deepEqual(JSON.parse(gh.file('photos/edits.json')), {
      'img-1000': { film: true, stock: 'Portra 400' },
      'img-1001': { hidden: true },
      'img-1005': { place: 'Elsewhere' },
    });
  });
  await check('an expired token returns to the token screen and keeps the changes', async () => {
    await page.click('.tile[data-id="img-1002"]');
    await page.click('#f-film');
    await waitText(page, '#pending-count', /^1 change$/);
    gh.token = 'rotated';
    await page.click('#save-btn');
    await waitText(page, '.token .error', /expired/);
    await signIn('rotated');
    await waitText(page, '#pending-count', /^1 change$/);
  });
  await check('moving between text fields keeps the focus', async () => {
    await page.click('.tile[data-id="img-1003"]');
    // keyboard.type, not page.type: page.type would focus the field itself and hide the bug.
    await page.click('#f-camera');
    await page.keyboard.type('Nikon FM2');
    await page.tap('#f-lens');
    await page.evaluate(() => new Promise((r) => setTimeout(r, 100))); // let the camera edit render
    await page.keyboard.type('50mm');
    assert.equal(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName), 'f-lens');
    assert.equal(await page.$eval('#f-lens', (e) => e.value), '50mm');
    await page.keyboard.press('Tab');
    await page.click('#f-hidden'); // a non-text control: the panel rebuilds with both edits
    await page.waitForSelector('button[aria-label="reset lens"]');
    assert.equal(await page.$eval('#f-camera', (e) => e.value), 'Nikon FM2');
  });
  await check('fields are at least 16px, so iOS does not zoom on tap', async () => {
    for (const sel of ['#f-place', '#f-date', '#f-stock']) {
      assert.ok(parseFloat(await page.$eval(sel, (e) => getComputedStyle(e).fontSize)) >= 16, sel);
    }
  });
  const closePanel = async () => { if (await page.$('#close-panel')) await page.click('#close-panel'); };
  await check('select mode keeps the typed stock while tiles are tapped', async () => {
    await closePanel();
    await page.click('#select-btn');
    await page.type('#bulk-stock', 'HP5');
    await page.click('.tile[data-id="img-1006"]');
    await page.click('.tile[data-id="img-1007"]');
    await page.click('[data-bulk="film"]');
    await page.click('.tile[data-id="img-1007"]');
    assert.equal(await page.$eval('#f-stock', (e) => e.value), 'HP5');
    await page.click('#close-panel');
  });
  await check('changes made while a save is running are kept for the next save', async () => {
    await closePanel();
    if (await page.$('#bulk-stock')) await page.click('#select-btn');
    gh.blobDelay = 2000;
    await (await page.$('#add-input')).uploadFile(tiny);
    await page.waitForSelector('.tile[data-id="tiny-2"] img');
    await page.click('#save-btn');
    await waitText(page, '#save-btn', /Uploading/);
    await page.click('.tile[data-id="img-1008"]');
    await page.click('#f-hidden');
    await waitText(page, '.bar', /building/, 20000).catch(async () => { throw new Error(`bar: ${await text(page, '.bar')}`); });
    gh.blobDelay = 0;
    await waitText(page, '#pending-count', /^1 change$/).catch(async (e) => { throw new Error(`bar: ${await text(page, '.bar')}`); });
    await page.click('#close-panel');
  });
  await check('adding photos while editing loses neither the edit nor the photo', async () => {
    // Slow the first IndexedDB open so the edit lands while the photo is still being stored.
    await page.evaluateOnNewDocument(() => {
      const realOpen = indexedDB.open.bind(indexedDB);
      indexedDB.open = (...a) => {
        const real = realOpen(...a);
        const fake = { get result() { return real.result; }, get error() { return real.error; } };
        real.onupgradeneeded = () => fake.onupgradeneeded?.();
        real.onsuccess = () => setTimeout(() => fake.onsuccess?.(), 1500);
        real.onerror = () => fake.onerror?.();
        return fake;
      };
    });
    await page.reload();
    await page.waitForSelector('.tile[data-id="img-1009"]');
    await (await page.$('#add-input')).uploadFile(clash);
    await page.click('.tile[data-id="img-1009"]');
    await page.click('#f-hidden');
    await waitText(page, '#pending-count', /^3 changes$/).catch(async (e) => { throw new Error(`bar: ${await text(page, '.bar')}`); });
    await page.waitForSelector('.tile[data-id="img-1000-3"] img');
    await page.click('#close-panel');
  });
  await check('no page errors', async () => {
    // A 401 on purpose shows up as a "Failed to load resource" console line; that one is expected.
    assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);
  });
}, { port: 5198 });

for (const [s, name, msg] of results) console.log(`${s.padEnd(4)} ${name}${msg ? ` — ${msg}` : ''}`);
process.exitCode = results.some((r) => r[0] === 'FAIL') ? 1 : 0;
