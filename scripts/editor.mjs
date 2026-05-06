import { createServer } from 'http';
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, extname, basename, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import exifr from 'exifr';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = resolve(__dirname, '../public/images');
const THUMBS_DIR = resolve(__dirname, '../public/images/thumbs');
const LIST_FILE = resolve(__dirname, '../src/image-list.json');
const PORT = 3033;
const VALID_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// ── helpers ──────────────────────────────────────────────────────────────────

function getImageFiles() {
  return readdirSync(IMAGES_DIR).filter(f => {
    if (f === 'thumbs') return false;
    return VALID_EXT.has(extname(f).toLowerCase());
  });
}

function readList() {
  if (!existsSync(LIST_FILE)) return null;
  return JSON.parse(readFileSync(LIST_FILE, 'utf8'));
}

function writeList(list) {
  writeFileSync(LIST_FILE, JSON.stringify(list, null, 2) + '\n');
}

async function getExifDate(filename) {
  try {
    const tags = await exifr.parse(join(IMAGES_DIR, filename), ['DateTimeOriginal', 'DateTime']);
    return tags?.DateTimeOriginal ?? tags?.DateTime ?? null;
  } catch {
    return null;
  }
}

function sortByDate(filenames, datesMap) {
  return [...filenames].sort((a, b) => {
    const da = datesMap[a], db = datesMap[b];
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return new Date(db) - new Date(da);
  });
}

function ensureThumb(filename) {
  const base = basename(filename, extname(filename));
  const thumbPath = join(THUMBS_DIR, `${base}.jpg`);
  if (existsSync(thumbPath)) return thumbPath;
  mkdirSync(THUMBS_DIR, { recursive: true });
  try {
    execSync(
      `sips -Z 800 "${join(IMAGES_DIR, filename)}" --out "${thumbPath}" -s format jpeg -s formatOptions 82`,
      { stdio: 'pipe' }
    );
    return thumbPath;
  } catch {
    return null;
  }
}

// ── init ─────────────────────────────────────────────────────────────────────

async function initList() {
  if (existsSync(LIST_FILE)) return;
  console.log('First run — reading EXIF dates to sort images (newest first)…');
  const files = getImageFiles();
  const entries = await Promise.all(files.map(async f => ({ src: f, date: await getExifDate(f) })));
  const datesMap = Object.fromEntries(entries.map(e => [e.src, e.date]));
  writeList(sortByDate(files, datesMap));
  console.log(`Created image-list.json with ${files.length} images.`);
}

// ── api ───────────────────────────────────────────────────────────────────────

function getState() {
  const all = new Set(getImageFiles());
  const saved = readList() ?? [...all];
  const included = saved.filter(f => all.has(f));
  const includedSet = new Set(included);
  const excluded = [...all].filter(f => !includedSet.has(f)).sort();
  return { included, excluded };
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // Serve editor UI
  if (method === 'GET' && path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  // Serve thumbnail (auto-generate if missing)
  if (method === 'GET' && path.startsWith('/thumb/')) {
    const filename = decodeURIComponent(path.slice(7));
    const thumbPath = ensureThumb(filename);
    if (!thumbPath) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(readFileSync(thumbPath));
    return;
  }

  // Read body for POST/DELETE
  let body = '';
  await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });

  // GET state
  if (method === 'GET' && path === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getState()));
    return;
  }

  // POST save
  if (method === 'POST' && path === '/api/save') {
    const { included } = JSON.parse(body);
    writeList(included);
    const child = spawn(process.execPath, [resolve(__dirname, 'generate-image-data.mjs')], { stdio: 'inherit' });
    child.on('close', code => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, regenerated: code === 0 }));
    });
    return;
  }

  // POST sort-by-date
  if (method === 'POST' && path === '/api/sort-by-date') {
    const { filenames } = JSON.parse(body);
    const entries = await Promise.all(filenames.map(async f => ({ src: f, date: await getExifDate(f) })));
    const datesMap = Object.fromEntries(entries.map(e => [e.src, e.date]));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sortByDate(filenames, datesMap)));
    return;
  }

  // DELETE image
  if (method === 'DELETE' && path.startsWith('/api/image/')) {
    const filename = decodeURIComponent(path.slice(11));
    const imgPath = join(IMAGES_DIR, filename);
    if (!existsSync(imgPath)) { res.writeHead(404); res.end(); return; }
    unlinkSync(imgPath);
    const base = basename(filename, extname(filename));
    const tp = join(THUMBS_DIR, `${base}.jpg`);
    if (existsSync(tp)) unlinkSync(tp);
    const list = readList();
    if (list) writeList(list.filter(f => f !== filename));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404); res.end();
}

// ── html ──────────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Portfolio Editor</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f0f;color:#e5e5e5;min-height:100vh}

header{
  position:sticky;top:0;z-index:100;
  background:#161616;border-bottom:1px solid #262626;
  padding:12px 20px;display:flex;align-items:center;gap:10px;
}
h1{font-size:15px;font-weight:500;flex:1}
.stats{font-size:12px;color:#666}

btn,button{
  padding:6px 14px;border:1px solid #333;background:#1e1e1e;color:#ccc;
  border-radius:6px;cursor:pointer;font-size:12px;transition:background .15s,border-color .15s;
}
button:hover{background:#262626;border-color:#444}
.btn-primary{background:#1d4ed8;border-color:#1d4ed8;color:#fff}
.btn-primary:hover{background:#1e40af}
button:disabled{opacity:.45;cursor:default}

main{padding:20px;max-width:1600px}
.section{margin-bottom:32px}
.section-head{
  display:flex;align-items:center;gap:10px;
  font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  color:#555;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #1e1e1e;
}
.badge{
  background:#262626;border:1px solid #333;color:#777;
  border-radius:10px;padding:1px 8px;font-size:11px;letter-spacing:0;text-transform:none;font-weight:400;
}
.hint{font-size:12px;color:#444;font-style:italic;margin-left:auto;letter-spacing:0;text-transform:none;font-weight:400}

.grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(160px,1fr));
  gap:8px;
}

.card{
  background:#161616;border:1px solid #222;border-radius:8px;
  overflow:hidden;transition:border-color .15s,opacity .2s;
}
.card.draggable{cursor:grab}
.card.draggable:active{cursor:grabbing}
.card.drag-over{border-color:#3b82f6;box-shadow:0 0 0 1px #3b82f6}
.card.dragging{opacity:.25}
.card.excluded{opacity:.35}

.thumb{width:100%;aspect-ratio:3/2;object-fit:cover;background:#1a1a1a;display:block}

.card-body{padding:8px}
.card-name{font-size:10px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:6px}

.card-actions{display:flex;gap:4px}
.card-actions button{padding:4px 6px;font-size:11px;border-radius:4px;line-height:1}
.btn-toggle{flex:1}
.btn-toggle.on{background:#14532d22;border-color:#16a34a;color:#4ade80}
.btn-toggle.on:hover{background:#14532d44}
.btn-toggle.off{background:#1e1e1e;border-color:#333;color:#555}
.btn-toggle.off:hover{background:#222;border-color:#555;color:#999}
.btn-del{padding:4px 7px !important;border-color:#333;color:#444}
.btn-del:hover{border-color:#7f1d1d;color:#f87171;background:#1a0808}

.notice{
  padding:24px;text-align:center;color:#444;font-size:13px;
  border:1px dashed #222;border-radius:8px;
}

.toast{
  position:fixed;bottom:20px;right:20px;
  background:#15803d;color:#fff;padding:9px 16px;
  border-radius:7px;font-size:13px;opacity:0;
  transition:opacity .25s;pointer-events:none;z-index:200;
}
.toast.show{opacity:1}
.toast.error{background:#991b1b}
</style>
</head>
<body>
<header>
  <h1>Portfolio Editor</h1>
  <span class="stats" id="stats"></span>
  <button id="btn-sort" title="Re-sort included images by EXIF capture date">Sort by Date</button>
  <button class="btn-primary" id="btn-save">Save &amp; Apply</button>
</header>
<main>
  <div class="section">
    <div class="section-head">
      <span id="lbl-included">Gallery</span>
      <span class="hint">Drag to reorder &nbsp;·&nbsp; To add images, copy files into public/images/ then refresh</span>
    </div>
    <div class="grid" id="grid-included"></div>
  </div>
  <div class="section" id="sec-excluded" style="display:none">
    <div class="section-head">
      <span id="lbl-excluded">Not Included</span>
    </div>
    <div class="grid" id="grid-excluded"></div>
  </div>
</main>
<div class="toast" id="toast"></div>

<script>
let state = { included: [], excluded: [] };
let dragSrc = null;

async function load() {
  const r = await fetch('/api/state');
  state = await r.json();
  render();
}

function render() {
  const gi = document.getElementById('grid-included');
  const ge = document.getElementById('grid-excluded');
  const secEx = document.getElementById('sec-excluded');

  document.getElementById('lbl-included').textContent = 'Gallery (' + state.included.length + ')';
  document.getElementById('stats').textContent =
    state.included.length + ' in gallery · ' + state.excluded.length + ' not included';

  if (state.excluded.length > 0) {
    secEx.style.display = '';
    document.getElementById('lbl-excluded').textContent = 'Not Included (' + state.excluded.length + ')';
  } else {
    secEx.style.display = 'none';
  }

  gi.innerHTML = '';
  state.included.forEach(f => gi.appendChild(makeCard(f, true)));

  ge.innerHTML = '';
  state.excluded.forEach(f => ge.appendChild(makeCard(f, false)));
}

function makeCard(filename, included) {
  const card = document.createElement('div');
  card.className = 'card' + (included ? ' draggable' : ' excluded');
  card.dataset.file = filename;

  const img = document.createElement('img');
  img.className = 'thumb';
  img.src = '/thumb/' + encodeURIComponent(filename);
  img.alt = '';
  img.loading = 'lazy';
  card.appendChild(img);

  const body = document.createElement('div');
  body.className = 'card-body';

  const name = document.createElement('div');
  name.className = 'card-name';
  name.title = filename;
  name.textContent = filename;
  body.appendChild(name);

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const btnT = document.createElement('button');
  btnT.className = 'btn-toggle ' + (included ? 'on' : 'off');
  btnT.textContent = included ? '✓ In gallery' : '+ Include';
  btnT.onclick = () => toggle(filename, included);
  actions.appendChild(btnT);

  const btnD = document.createElement('button');
  btnD.className = 'btn-del';
  btnD.title = 'Delete file from disk';
  btnD.textContent = '✕';
  btnD.onclick = () => deleteImg(filename);
  actions.appendChild(btnD);

  body.appendChild(actions);
  card.appendChild(body);

  if (included) setupDrag(card, filename);
  return card;
}

function setupDrag(card, filename) {
  card.draggable = true;
  card.addEventListener('dragstart', e => {
    dragSrc = filename;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => card.classList.add('dragging'), 0);
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });
  card.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    card.classList.add('drag-over');
  });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', e => {
    e.preventDefault();
    card.classList.remove('drag-over');
    if (!dragSrc || dragSrc === filename) return;
    const arr = state.included;
    const from = arr.indexOf(dragSrc);
    const to = arr.indexOf(filename);
    if (from < 0 || to < 0) return;
    arr.splice(from, 1);
    arr.splice(to, 0, dragSrc);
    render();
  });
}

function toggle(filename, included) {
  if (included) {
    state.included = state.included.filter(f => f !== filename);
    state.excluded = [filename, ...state.excluded];
  } else {
    state.excluded = state.excluded.filter(f => f !== filename);
    state.included = [...state.included, filename];
  }
  render();
}

async function deleteImg(filename) {
  if (!confirm('Delete ' + filename + ' from disk?\\nThis cannot be undone.')) return;
  const r = await fetch('/api/image/' + encodeURIComponent(filename), { method: 'DELETE' });
  if (r.ok) {
    state.included = state.included.filter(f => f !== filename);
    state.excluded = state.excluded.filter(f => f !== filename);
    render();
    toast('Deleted ' + filename);
  } else {
    toast('Delete failed', true);
  }
}

document.getElementById('btn-sort').onclick = async () => {
  const btn = document.getElementById('btn-sort');
  btn.disabled = true;
  btn.textContent = 'Reading dates…';
  try {
    const r = await fetch('/api/sort-by-date', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames: state.included }),
    });
    state.included = await r.json();
    render();
    toast('Sorted by date (newest first)');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sort by Date';
  }
};

document.getElementById('btn-save').onclick = async () => {
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const r = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ included: state.included }),
    });
    const { ok } = await r.json();
    toast(ok ? 'Saved! ' + state.included.length + ' images in gallery.' : 'Saved (data regeneration failed)', !ok);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save & Apply';
  }
};

function toast(msg, error = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

load();
</script>
</body>
</html>`;

// ── main ──────────────────────────────────────────────────────────────────────

await initList();

const server = createServer((req, res) => {
  handleRequest(req, res).catch(err => {
    console.error(err);
    if (!res.headersSent) { res.writeHead(500); res.end(err.message); }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nPortfolio Editor → http://localhost:${PORT}\n`);
  console.log('  • Drag cards to reorder');
  console.log('  • Toggle "In gallery / + Include" to include or exclude images');
  console.log('  • "Sort by Date" re-sorts the gallery by EXIF capture date (newest first)');
  console.log('  • "Save & Apply" writes image-list.json and regenerates image-data.js');
  console.log('  • To add images: drop files into public/images/ then refresh the page\n');
  console.log('Ctrl+C to stop.\n');
});
