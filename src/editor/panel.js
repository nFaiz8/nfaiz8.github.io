// The photo panel: film, stock, hidden, date/camera/lens/place overrides and delete.
// Text fields commit on change (blur or Enter), so re-rendering never fights the keyboard.
import { h } from './dom.js';
import { thumb } from './grid.js';

const TEXT_FIELDS = [['camera', 'camera', 'camera'], ['lens', 'lens', 'lens'], ['place', 'place', 'location']];

export function panel({ item, S, actions }) {
  const e = item.edits, p = item.photo || {};
  const edit = (field) => (ev) => actions.edit(item.id, field, ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value.trim());
  const reset = (field) => e[field] != null && h('button', { type: 'button', class: 'reset', 'aria-label': `reset ${field}`, onclick: () => actions.edit(item.id, field, null) }, '×');
  const src = thumb(item, S, 'hi');
  const confirming = S.confirm === `delete:${item.id}`;
  return h('aside', { class: 'panel', 'aria-label': `Edit ${item.id}` },
    h('header', {},
      h('span', { class: 'pid' }, item.path.replace(/^photos\//, '')),
      h('button', { type: 'button', class: 'btn quiet', id: 'close-panel', onclick: actions.close }, 'close')),
    src ? h('img', { class: 'preview', src, alt: '' }) : h('div', { class: 'preview nothumb' }, 'no preview until the site rebuilds'),
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', id: 'f-film', checked: !!e.film, onchange: edit('film') }), 'film'),
    h('label', { class: 'field' }, 'stock',
      h('input', { type: 'text', id: 'f-stock', value: e.stock || '', list: 'stocks', disabled: !e.film, placeholder: e.film ? 'e.g. Portra 400' : 'turn on film first', onchange: edit('stock') }),
      reset('stock')),
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', id: 'f-hidden', checked: !!e.hidden, onchange: edit('hidden') }), 'hidden'),
    h('label', { class: 'field' }, p.date ? `date (photo says ${p.date})` : 'date',
      h('input', { type: 'date', id: 'f-date', value: e.date || '', onchange: edit('date') }),
      reset('date')),
    TEXT_FIELDS.map(([field, label, key]) => h('label', { class: 'field' }, label,
      h('input', { type: 'text', id: `f-${field}`, value: e[field] || '', placeholder: p[key] || '—', onchange: edit(field) }),
      reset(field))),
    h('button', {
      type: 'button', id: 'delete-btn', class: `btn danger${confirming ? ' armed' : ''}`, disabled: item.deleting,
      onclick: () => actions.remove(item.id, item.path),
    }, item.deleting ? 'marked for deletion (undo in review)' : confirming ? 'tap again to delete' : 'delete photo'));
}
