// The side view's people as one flat list of glyph instances for either renderer (stickman spec §5):
// each body's stick figure (others first, then you), then every label above all of them (names, chat
// lines with their dark strips, emotes). DOM-free, so node --test can import it.
import { stickPose } from '../stick.js';

const WHITE = [255, 255, 255], FX = [255, 214, 140], STRIP = [7, 8, 11];
const NAME = [150, 147, 140], SAY = [236, 232, 222];
const MARGIN = 3; // bodies further than this outside the view are skipped
const NAME_DY = 2.2, SAY_DY = 3.3, EMOTE_DY = 4.4, LIFT = 0.5;
const STRIP_A = 0.6, PHONE_NAME = 12;
const FADE_T = 1.4, DEAD_END = 2.0; // a dead body's name fades with its pieces

// Reused every frame.
const pose = [], others = [], mine = [];

// A steady breathing phase per id, so a crowd doesn't breathe in step.
function phaseOf(id) {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 997) / 997;
}

function pushFigure(out, b, t, rm) {
  const s = b.state, alpha = b.alpha >= 0 ? b.alpha : 1;
  pose.length = 0;
  stickPose(s, t, { reducedMotion: rm, phase: phaseOf(b.id) }, pose);
  for (const g of pose) {
    const color = g.tone === 'flash' ? WHITE : g.tone === 'fx' ? FX : b.color;
    out.push({ x: s.x + g.dx, y: s.y + g.dy, ch: g.ch, color, a: g.a * alpha, bold: true, strip: false, rot: g.rot, len: g.len, flip: g.flip });
  }
}

// A row of text centred on x (fractional, so it glides with the body).
function pushRow(out, text, x, y, color, a) {
  const chars = Array.from(text);
  const x0 = x - chars.length / 2 + 0.5;
  for (let i = 0; i < chars.length; i++) if (chars[i] !== ' ') out.push({ x: x0 + i, y, ch: chars[i], color, a, bold: false, strip: false, rot: 0, len: 1, flip: false });
}

// The label stack of one body. Strips (pass 0) all go before any label text (pass 1).
function pushLabels(out, b, opts, pass) {
  const s = b.state, alpha = b.alpha >= 0 ? b.alpha : 1;
  let name = b.label || (b.me ? '' : b.name || '');
  if (opts.phone && Array.from(name).length > PHONE_NAME) name = Array.from(name).slice(0, PHONE_NAME - 1).join('') + '…';
  const say = b.say || '', emote = b.emote || '';
  if (!name && !say && !emote) return;
  const lift = emote && !opts.reducedMotion ? Math.min(1, (b.emoteAge || 0) * 3) * LIFT : 0;
  // Near the ceiling the whole stack flips below the feet.
  const topDy = emote ? (say ? EMOTE_DY : SAY_DY) + (opts.reducedMotion ? 0 : LIFT) : say ? SAY_DY : NAME_DY;
  const dir = s.y - topDy - 0.5 < (opts.ceiling ?? -Infinity) ? 1 : -1;
  if (pass === 0) {
    if (!say) return;
    const n = Array.from(say).length, x0 = s.x - n / 2 - 1 + 0.5, y = s.y + dir * SAY_DY;
    for (let j = 0; j < n + 2; j++) out.push({ x: x0 + j, y, ch: ' ', color: STRIP, a: STRIP_A * alpha, bold: false, strip: true, rot: 0, len: 1, flip: false });
    return;
  }
  if (name) {
    const actT = s.actT > 0 ? s.actT : 0;
    const fade = s.act !== 'dead' || actT <= FADE_T ? 1 : Math.max(0, (DEAD_END - actT) / (DEAD_END - FADE_T));
    if (fade > 0) pushRow(out, name, s.x, s.y + dir * NAME_DY, NAME, alpha * fade);
  }
  if (say) pushRow(out, say, s.x, s.y + dir * SAY_DY, SAY, alpha);
  if (emote) pushRow(out, emote, s.x, s.y + dir * ((say ? EMOTE_DY : SAY_DY) + lift), b.color, alpha);
}

// figureGlyphs(bodies, opts, out) → out with { x, y, ch, color, a, bold, strip, rot, len, flip } appended; (x, y)
// is the glyph's centre in map cells; rot (radians, clockwise), len (a vertical stretch) and flip (mirrored
// before turning) come from the pose, and labels are upright (0, 1, false).
// bodies: [{ id, state, color, name, say, emote, emoteAge, alpha, me, label }].
// opts: { t, reducedMotion, phone, view: { left, top, cols, rows }, ceiling, memory }.
export function figureGlyphs(bodies, opts = {}, out = []) {
  const { t = 0, reducedMotion = false, view = null, memory = null } = opts;
  others.length = 0;
  mine.length = 0;
  for (const b of bodies || []) {
    const s = b && b.state;
    if (!s) continue;
    // Every body, every frame, before culling: one off screen for a while mustn't replay its respawn.
    if (memory) memory.fill(b.id, s, t);
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
    if (view && (s.x < view.left - MARGIN || s.x > view.left + view.cols + MARGIN ||
      s.y < view.top - MARGIN || s.y > view.top + view.rows + MARGIN)) continue;
    (b.me ? mine : others).push(b);
  }
  for (const b of others) pushFigure(out, b, t, reducedMotion);
  for (const b of mine) pushFigure(out, b, t, reducedMotion);
  for (let pass = 0; pass < 2; pass++) {
    for (const b of others) pushLabels(out, b, opts, pass);
    for (const b of mine) pushLabels(out, b, opts, pass);
  }
  others.length = 0;
  mine.length = 0;
  return out;
}
