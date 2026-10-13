// The sign-in screen: how to make a token, and a field to paste it.
import { h } from './dom.js';
import { REPO } from './config.js';

export function tokenScreen({ message, onSubmit }) {
  const input = h('input', { type: 'password', id: 'token', autocomplete: 'off', spellcheck: false, placeholder: 'github_pat_…', required: true });
  const button = h('button', { type: 'submit', class: 'btn primary' }, 'sign in');
  return h('section', { class: 'token' },
    h('h1', {}, 'edit faiz.pics'),
    message && h('p', { class: 'error', role: 'alert' }, message),
    h('ol', {},
      h('li', {}, 'On GitHub, create a ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'fine-grained token'), '.'),
      h('li', {}, `Repository access: Only select repositories → ${REPO}.`),
      h('li', {}, 'Repository permissions: Contents → Read and write.'),
      h('li', {}, 'Generate it, copy it and paste it below. It is kept in this browser only.')),
    h('form', {
      class: 'token-form',
      onsubmit: (ev) => {
        ev.preventDefault();
        button.disabled = true;
        button.textContent = 'checking…';
        onSubmit(input.value.trim());
      },
    }, input, button));
}
