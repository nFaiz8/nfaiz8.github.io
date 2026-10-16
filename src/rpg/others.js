// Other real players in the station, drawn (station spec, Multiplayer): each one the stick figure in their
// colour, without a lantern, walking as peers3d.js derives it, with a name tag over the head; what anyone says
// (me too) floats over their head for a few seconds, an emote over that. Not solid: nobody can trap you.
// Also the small chat-and-emotes bar shown while you're below.
import { createFigure } from './figure.js';
import { poseFigure } from './rig.js';
import { makeSprite } from './sprites.js';
import { stepRemote } from './peers3d.js';
import { peerColor } from '../live.js';
import { EMOTE_GLYPH, EMOTES_ORDER } from '../peers.js';

const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const TAG = { y: 1.72, h: 0.2 }; // the name tag's foot over the figure's feet, and its height
const LINE = { h: 0.2, chars: 26, lines: 3 }; // speech: each line's height, wrapped at this many characters
const EMOTE_H = 0.32;
const SAY_INK = '#ece8de', SAY_BG = 'rgba(9, 10, 14, 0.82)';

// A line of speech in lines of at most `chars`, broken at spaces where it can, and at most `lines` of them.
export function wrapSpeech(text, chars = LINE.chars, lines = LINE.lines) {
  const out = [];
  let cur = '';
  for (const word of text.split(' ')) {
    for (let w = word; w.length;) {
      const room = chars - (cur ? cur.length + 1 : 0);
      if (w.length <= room) { cur = cur ? `${cur} ${w}` : w; w = ''; }
      else if (cur) { out.push(cur); cur = ''; }
      else { out.push(w.slice(0, chars)); w = w.slice(chars); }
    }
  }
  if (cur) out.push(cur);
  if (out.length > lines) { out.length = lines; out[lines - 1] = `${out[lines - 1].slice(0, chars - 1)}…`; }
  return out;
}

// Labels over one head: a name (or none), speech and an emote, each a sprite turned to the camera, remade
// only when its text changes.
function createStack(scene, { name = '', color = '#ffffff' }) {
  const parts = { name: null, say: null, emote: null };
  const text = { name: null, say: null, emote: null };
  const set = (k, s, make) => {
    if (s === text[k]) return;
    text[k] = s;
    if (parts[k]) { parts[k].mesh.removeFromParent(); parts[k].dispose(); parts[k] = null; }
    if (s) { parts[k] = make(s); parts[k].mesh.renderOrder = 6; parts[k].mesh.material.depthTest = false; scene.add(parts[k].mesh); } // over pillars: always readable
  };
  const stack = {
    color,
    update({ name: n, say, emote, emoteAge = 0 }, at, camera, reducedMotion) {
      set('name', n || null, (s) => ({ ...makeSprite([s], stack.color, TAG.h, { glow: true }), h: TAG.h }));
      set('say', say || null, (s) => { const ls = wrapSpeech(s), h = LINE.h * ls.length; return { ...makeSprite(ls, SAY_INK, h, { glow: true, bg: SAY_BG }), h }; });
      set('emote', emote || null, (s) => ({ ...makeSprite([s], stack.color, EMOTE_H, { glow: true }), h: EMOTE_H }));
      let y = at.y + (parts.name ? TAG.y : TAG.y - 0.08);
      const place = (p) => { p.mesh.position.set(at.x, y, at.z); p.mesh.quaternion.copy(camera.quaternion); y += p.h + 0.05; };
      if (parts.name) place(parts.name);
      if (parts.say) place(parts.say);
      if (parts.emote) { if (!reducedMotion) y += Math.min(1, emoteAge * 3) * 0.15; place(parts.emote); }
    },
    dispose() { for (const k of Object.keys(parts)) set(k, null); },
  };
  return stack;
}

export function createOthers(scene, map, { reducedMotion = false } = {}) {
  const shown = new Map(); // id → { figure, joints, r, stack, at }
  const mine = createStack(scene, {});
  const me = { say: null, sayAt: 0, emote: null, emoteAt: 0 };
  const drop = (id) => { const o = shown.get(id); if (!o) return; o.figure.dispose(); o.stack.dispose(); shown.delete(id); };
  return {
    // list: peers3d's, at now (ms). feet: where my feet are, for my own speech.
    update(list, now, dt, t, camera, feet) {
      const here = new Set();
      for (const p of list) {
        here.add(p.id);
        let o = shown.get(p.id);
        if (!o) {
          const color = hex(peerColor(p.id));
          o = { figure: createFigure(scene, { glow: true, color, lantern: false }), joints: {}, r: {}, stack: createStack(scene, { color }), at: { x: 0, y: 0, z: 0 } };
          shown.set(p.id, o);
        }
        stepRemote(o.r, p, dt);
        // stepRemote walks the figure in its frame (a train's, aboard), so its stride follows its steps, not the train;
        // ox, oz place that frame on the line.
        poseFigure({ yaw: o.r.yaw, phase: o.r.phase, gait: p.s ? 0 : o.r.gait, sit: p.s ? 1 : 0, t: t + (p.id.charCodeAt(0) % 7), reducedMotion }, o.joints);
        o.at.x = o.r.x + (p.ox || 0); o.at.z = o.r.z + (p.oz || 0); o.at.y = p.y ?? map.levelAt(o.at.x, o.at.z) ?? 0;
        o.figure.update(o.joints, camera, o.at);
        o.stack.update(p, o.at, camera, reducedMotion);
      }
      for (const id of [...shown.keys()]) if (!here.has(id)) drop(id);
      const emoting = me.emote && now - me.emoteAt < 2500;
      mine.update({ say: me.say && now - me.sayAt < 5000 ? me.say : null, emote: emoting ? me.emote : null, emoteAge: emoting ? (now - me.emoteAt) / 2500 : 0 }, feet, camera, reducedMotion);
    },
    // What I said or emoted, over my own head at once (the server sends it to the others).
    say(text, now) { me.say = text; me.sayAt = now; },
    emote(kind, now) { me.emote = EMOTE_GLYPH[kind] || null; me.emoteAt = now; },
    shown: () => [...shown.entries()].map(([id, o]) => ({ id, x: o.at.x, z: o.at.z, gait: o.r.gait, yaw: o.r.yaw })),
    mine: () => ({ say: me.say }),
    dispose() { for (const id of [...shown.keys()]) drop(id); mine.dispose(); },
  };
}

// The bar under the station while you're on the net: [T] chat and the five emotes. onChat opens the chat line
// (main.js's), onEmote(kind) sends one.
export function createTalkBar(parent, { onChat, onEmote }) {
  const bar = document.createElement('div');
  bar.className = 'station-talk';
  const button = (label, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'hud-btn'; b.textContent = label; b.title = title;
    b.addEventListener('click', (e) => { e.preventDefault(); fn(); });
    bar.append(b);
  };
  button('[T] chat', 'Chat (T or Enter)', onChat);
  EMOTES_ORDER.forEach((k, i) => button(EMOTE_GLYPH[k], `${k} (${i + 1})`, () => onEmote(k)));
  parent.append(bar);
  return { el: bar, destroy() { bar.remove(); } };
}
