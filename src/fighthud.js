// The fight HUD (PvP spec §2.6): my hp (and a pickup gun's rounds), the scoreboard and the kill feed, in a
// small DOM box under the top HUD. main.js shows it in the side view only; the board and the feed show only
// when someone else is fighting.
const FEED_MAX = 3, FEED_MS = 4000;

// `hp ██████████ 100`: a █ per 10 hp (any left shows one), ░ for the rest; then ` · rifle 32` with a pickup gun.
export function hpText({ hp, gun, ammo }) {
  const v = Math.max(0, Math.min(100, Math.round(hp) || 0)), full = Math.ceil(v / 10);
  const ammoText = gun && gun !== 'deagle' && ammo >= 0 ? ` · ${gun} ${ammo}` : '';
  return `hp ${'█'.repeat(full)}${'░'.repeat(10 - full)} ${v}${ammoText}`;
}

// rows: how many places the board shows (plus me, if I'm not among them). nameOf(id), colorOf(id) → [r, g, b].
export function createFightHud({ root, hp, board, feed, rows = 5, nameOf = () => '', colorOf = () => [200, 200, 200] }) {
  let lastHp = null, lastBoard = null;

  function render(hud) {
    root.hidden = !hud;
    if (!hud) return;
    const text = hpText(hud);
    if (text !== lastHp) { hp.textContent = text; lastHp = text; }
    board.hidden = feed.hidden = !hud.showBoard;
    if (!hud.showBoard) return;
    const list = hud.board.filter(Boolean).slice(0, rows);
    const mine = hud.board.find((r) => r && r.me);
    if (mine && !list.includes(mine)) list.push(mine);
    const named = list.map((r) => ({ ...r, name: r.me ? 'you' : nameOf(r.id) || 'someone' }));
    const key = named.map((r) => `${r.id}\t${r.name}\t${r.kills}`).join('\n');
    if (key === lastBoard) return;
    lastBoard = key;
    board.replaceChildren(...named.map((r) => {
      const li = document.createElement('li');
      if (r.me) li.className = 'me';
      const dot = document.createElement('span');
      dot.className = 'fight-dot';
      dot.textContent = '●';
      dot.style.color = `rgb(${colorOf(r.id, r.me).join(' ')})`;
      li.append(dot, ` ${r.name} ${r.kills}`);
      return li;
    }));
  }

  // A kill feed line: the last 3, each for 4 s.
  function line(text) {
    const li = document.createElement('li');
    li.textContent = text;
    feed.append(li);
    while (feed.children.length > FEED_MAX) feed.firstChild.remove();
    setTimeout(() => li.remove(), FEED_MS);
  }

  return { render, line };
}
