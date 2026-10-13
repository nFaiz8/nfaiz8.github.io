// The bottom bar: pending count, review list, discard, save, and build status after saving.
import { h } from './dom.js';
import { count, describeOp } from './pending.js';
import { OWNER, REPO } from './config.js';

export function bar({ S, actions }) {
  const n = count(S.ops);
  const status = S.live === 'building' ? 'saved · building the site…'
    : S.live === 'live' ? 'saved · live ✓'
    : S.live === 'slow' ? h('span', {}, 'still building · ', h('a', { href: `https://github.com/${OWNER}/${REPO}/actions`, target: '_blank', rel: 'noopener' }, 'check Actions'))
    : null;
  return h('footer', { class: 'bar' },
    S.error && h('p', { class: 'error', role: 'alert' }, S.error),
    S.reviewing && n > 0 && h('ol', { class: 'review' }, S.ops.map((o, i) => h('li', {},
      h('span', {}, describeOp(o)),
      h('button', { type: 'button', class: 'btn quiet', 'data-undo': i, onclick: () => actions.undo(i) }, 'undo')))),
    h('div', { class: 'row' },
      h('span', { class: 'count', id: 'pending-count', role: 'status' }, n ? `${n} change${n === 1 ? '' : 's'}` : status || 'no changes'),
      n > 0 && status && !S.saving && h('span', { class: 'status' }, status),
      n > 0 && !S.saving && h('button', { type: 'button', class: 'btn quiet', id: 'review-btn', onclick: actions.review }, S.reviewing ? 'hide list' : 'review'),
      n > 0 && !S.saving && h('button', { type: 'button', class: 'btn quiet', id: 'discard-btn', onclick: actions.discard }, S.confirm === 'discard' ? 'tap again to discard' : 'discard'),
      n > 0 && h('button', { type: 'button', class: 'btn primary', id: 'save-btn', disabled: S.saving || !!S.remote.editsError, onclick: actions.save }, S.saving ? S.progress : 'save')));
}
