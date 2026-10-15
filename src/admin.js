// The admin panel (gorge addendum): behind the password, it switches the arena's map for everyone. ` opens
// it (or /admin in the chat, for a phone). Online the server checks the password and tells every page,
// which then reloads into the new map; with no server (local dev) the page checks it and switches itself.
export function createAdmin({ form, input, msg, now, buttons, send, local, check, onClose = () => {} }) {
  let waiting = false;
  const show = () => {
    now.textContent = form.dataset.map || '';
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.value === form.dataset.map));
  };
  const open = (map) => {
    form.dataset.map = map;
    msg.textContent = '';
    show();
    form.hidden = false;
    input.focus();
  };
  const close = () => {
    if (form.hidden) return;
    form.hidden = true;
    input.value = '';
    onClose();
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const map = e.submitter && e.submitter.value;
    if (!map || waiting) return;
    if (!input.value) { msg.textContent = 'password first'; input.focus(); return; }
    if (map === form.dataset.map) { msg.textContent = `the ${map} is up already`; return; }
    msg.textContent = '…';
    const sent = send(map, input.value);
    if (sent) { waiting = true; return; } // the server answers (answer)
    if (sent === null) { msg.textContent = 'not connected: try again in a moment'; return; }
    // No server at all (local dev): this page alone.
    if (await check(input.value)) { msg.textContent = `switching to the ${map}`; local(map); }
    else msg.textContent = 'wrong password';
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  return {
    open, close,
    get isOpen() { return !form.hidden; },
    toggle: (map) => (form.hidden ? open(map) : close()),
    // The server's answer: the switch is everyone's now (its map message reloads this page too).
    answer(ok, map) {
      waiting = false;
      if (form.hidden) return;
      msg.textContent = ok ? `switched to the ${map}: everyone's page follows` : 'wrong password';
      if (!ok) { input.select(); }
    },
  };
}
