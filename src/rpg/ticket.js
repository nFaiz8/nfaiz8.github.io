// The ticket machine (station spec, "Life and props (round 2)"): a small ASCII pop-up over the station when you walk
// into a shut turnstile. In-game money only: pick a single or a day pass, BUY + TAP, and the gate opens. No real
// payment fields of any kind. gates.js holds the wallet and the ticket; this is only the DOM.
//
// While it's open the walker stands still (index.js) and every key goes to it alone: ↑ ↓ (or W S) choose, Enter
// buys, T tops up, Esc closes. A tap picks an option or presses a button; a tap outside the box closes it.
import { KINDS, NAMES, PRICES, TOP_UP, money, buy, topUp } from './gates.js';

const W = 25; // the box's inside width, in characters
const pad = (s) => s.padEnd(W).slice(0, W);
const centre = (s) => pad(' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s);

export function createTicketMachine(gates, { parent = document.body, onBought = () => {}, onClose = () => {} } = {}) {
  const root = document.createElement('div');
  root.className = 'ticket';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'ticket machine');
  const box = document.createElement('div');
  box.className = 'ticket-box';
  root.append(box);
  const chip = document.createElement('div');
  chip.className = 'ticket-chip';
  chip.hidden = true;
  parent.append(root, chip);

  let selected = 0, status = '', funds = false, done = false, timer = 0, open = false;

  const line = (...parts) => {
    const d = document.createElement('div');
    d.className = 'ticket-line';
    d.append(...parts);
    return d;
  };
  const button = (text, cls, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  };

  function render() {
    box.textContent = '';
    const dashes = Math.floor((W - 9) / 2);
    box.append(line(`┌${'─'.repeat(dashes)} TICKETS ${'─'.repeat(W - 9 - dashes)}┐`));
    KINDS.forEach((k, i) => {
      const text = ` ${i === selected ? '(•)' : '( )'} ${NAMES[k].padEnd(10)} ${money(PRICES[k])}`;
      const b = button(pad(text), 'ticket-opt', () => { selected = i; funds = false; status = ''; render(); focusSel(); });
      b.setAttribute('aria-pressed', String(i === selected));
      box.append(line('│', b, '│'));
    });
    box.append(line(`│${centre(status)}│`));
    if (funds && !done) box.append(line('│', button(centre(`[ top up +${money(TOP_UP).replace('.00', '')} ]`), 'ticket-btn ticket-topup', doTopUp), '│'));
    box.append(line('│', button(centre('[ BUY + TAP ]'), 'ticket-btn ticket-buy', doBuy), '│'));
    box.append(line(`└${'─'.repeat(W)}┘`));
    const foot = line(` wallet ${money(gates.wallet)}`.padEnd(W - 4));
    foot.append(button('esc ✕', 'ticket-close', close));
    box.append(foot);
  }
  const focusSel = () => box.querySelectorAll('.ticket-opt')[selected]?.focus({ preventScroll: true });

  function doBuy() {
    if (done) return;
    const r = buy(gates, KINDS[selected]);
    if (!r.ok) { funds = r.reason === 'funds'; status = 'insufficient funds'; render(); box.querySelector('.ticket-topup')?.focus({ preventScroll: true }); return; }
    done = true; funds = false; status = '✓ beep';
    render();
    updateChip();
    timer = setTimeout(() => { close(); onBought(gates.pass); }, 650);
  }
  function doTopUp() {
    topUp(gates);
    funds = false; status = `+${money(TOP_UP)}`;
    render(); focusSel();
  }

  // Keys while open: ours alone (capture, before the game's input hears them).
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Tab') { e.stopImmediatePropagation(); return; } // focus moves between the buttons as usual
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.repeat && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowUp' || e.code === 'KeyW') { selected = (selected + KINDS.length - 1) % KINDS.length; status = ''; funds = false; render(); focusSel(); }
    else if (e.key === 'ArrowDown' || e.code === 'KeyS') { selected = (selected + 1) % KINDS.length; status = ''; funds = false; render(); focusSel(); }
    else if (e.code === 'KeyT' && funds) doTopUp();
    else if (e.key === 'Enter' || e.key === ' ') {
      const f = document.activeElement;
      if (f && box.contains(f) && !f.classList.contains('ticket-opt')) f.click(); else doBuy();
    }
  };
  // A tap outside the box closes it, but only one that starts there: the finger that walked you into the gate is
  // still down when this opens, and lifting it mustn't close it again.
  let downOnBackdrop = false;
  const onBackdropDown = (e) => { downOnBackdrop = e.target === root; };
  const onBackdrop = (e) => { if (e.target === root && downOnBackdrop) close(); downOnBackdrop = false; };
  root.addEventListener('pointerdown', onBackdropDown);
  root.addEventListener('click', onBackdrop);

  function show() {
    if (open) return;
    open = true; done = false; status = ''; funds = false; downOnBackdrop = false;
    root.hidden = false;
    render();
    focusSel();
    addEventListener('keydown', onKey, true);
  }
  function close() {
    if (!open) return;
    open = false;
    clearTimeout(timer);
    root.hidden = true;
    removeEventListener('keydown', onKey, true);
    document.activeElement?.blur?.();
    onClose();
  }
  function updateChip() {
    chip.hidden = !gates.pass;
    chip.textContent = gates.pass === 'day' ? '▣ DAY PASS' : gates.pass === 'single' ? '▣ SINGLE' : '';
  }

  return {
    open: show,
    close,
    get isOpen() { return open; },
    update: updateChip,
    destroy() {
      clearTimeout(timer);
      removeEventListener('keydown', onKey, true);
      root.removeEventListener('click', onBackdrop);
      root.removeEventListener('pointerdown', onBackdropDown);
      root.remove();
      chip.remove();
      open = false;
    },
  };
}
