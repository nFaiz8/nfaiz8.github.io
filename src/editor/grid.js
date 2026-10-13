// Toolbar (filters, add, select), the select-mode bar and the thumbnail grid.
import { h } from './dom.js';

const FILTERS = [['all', 'all'], ['film', 'film'], ['digital', 'digital'], ['hidden', 'hidden'], ['pending', 'pending']];

// Thumbnail URL for an item: the local file for a new upload, else the site's own resized copy.
export function thumb(item, S, size = 'low') {
  if (item.isNew) return S.previews.get(item.key) || null;
  const src = item.photo?.src?.[size] || item.photo?.src?.low;
  return src ? `../${src}` : null;
}

export function toolbar({ S, total, actions }) {
  const input = h('input', {
    type: 'file', id: 'add-input', class: 'sr-only', multiple: true, accept: 'image/jpeg,image/png,image/webp',
    onchange: (ev) => { const files = [...ev.target.files]; ev.target.value = ''; actions.addFiles(files); },
  });
  return h('header', { class: 'toolbar' },
    h('span', { class: 'name' }, `edit · ${total} photos`),
    h('nav', { class: 'chips', 'aria-label': 'Filter' }, FILTERS.map(([f, label]) =>
      h('button', { type: 'button', class: `chip${S.filter === f ? ' on' : ''}`, 'data-filter': f, onclick: () => actions.filter(f) }, label))),
    h('span', { class: 'tools' },
      h('label', { class: 'btn', for: 'add-input' }, '+ add photos', input),
      h('button', { type: 'button', class: 'btn', id: 'select-btn', onclick: actions.toggleSelecting }, S.selecting ? 'cancel' : 'select'),
      h('button', { type: 'button', class: 'btn quiet', onclick: actions.signOut }, 'sign out')));
}

export function selectBar({ S, actions }) {
  const stock = h('input', { type: 'text', id: 'bulk-stock', placeholder: 'stock (optional)', list: 'stocks', value: S.bulkStock, oninput: (ev) => { S.bulkStock = ev.target.value; } });
  const n = S.selected.size;
  const btn = (kind, label) => h('button', { type: 'button', class: 'btn', 'data-bulk': kind, disabled: !n, onclick: () => actions.bulk(kind, stock.value.trim()) }, label);
  return h('div', { class: 'selectbar' },
    h('span', {}, `${n} selected`), btn('film', 'film'), stock, btn('digital', 'digital'), btn('hide', 'hide'), btn('unhide', 'unhide'));
}

export function grid({ items, S, actions }) {
  if (!items.length) return h('p', { class: 'empty' }, 'nothing here');
  return h('ul', { class: 'grid' }, items.map((it) => {
    const src = thumb(it, S);
    const badges = [
      it.film && 'film', it.edits.hidden && 'hidden', Object.keys(it.saved).length > 0 && 'edited',
      it.isNew && 'new', it.deleting && 'delete',
    ].filter(Boolean);
    const cls = ['tile', S.selected.has(it.id) && 'selected', it.pending && 'pending', it.deleting && 'deleting'].filter(Boolean).join(' ');
    return h('li', {}, h('button', { type: 'button', class: cls, 'data-id': it.id, 'aria-label': it.id, onclick: () => actions.open(it.id) },
      src ? h('img', { src, alt: '', loading: 'lazy' }) : h('span', { class: 'nothumb' }, it.building ? 'building…' : it.id),
      h('span', { class: 'badges' }, badges.map((b) => h('span', { class: `badge ${b}` }, b)))));
  }));
}
