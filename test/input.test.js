import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDoubleTap } from '../src/input.js';

test('a double-tap within 0.25 s rolls that way; slower, or the other way, does not', () => {
  const d = createDoubleTap();
  assert.equal(d.press(1, 0), 0);
  assert.equal(d.press(1, 0.2), 1);
  assert.equal(d.press(1, 0.3), 0, 'a third tap starts over');
  assert.equal(d.press(1, 0.7), 0, 'too slow');
  assert.equal(d.press(-1, 0.8), 0);
  assert.equal(d.press(1, 0.85), 0, 'the other way starts over');
  assert.equal(d.press(-1, 1.0), 0);
  assert.equal(d.press(-1, 1.2), -1);
});

// A tiny event target standing in for window and the stage.
function fakeTarget() {
  const ls = {};
  return { addEventListener: (t, f) => { (ls[t] ||= []).push(f); }, fire: (t, e) => (ls[t] || []).forEach((f) => f(e)) };
}

test('J fires while held; K strikes once per press; double-tapping D rolls; leaving clears everything', async () => {
  const win = fakeTarget(), stage = fakeTarget();
  globalThis.window = win;
  const { createInput } = await import('../src/input.js?fake');
  let t = 0;
  const input = createInput(stage, { onTap() {}, onKey: () => false, arena: () => true, now: () => t });
  const key = (type, code, extra = {}) => win.fire(type, { code, target: {}, preventDefault() {}, shiftKey: false, ...extra });
  key('keydown', 'KeyJ');
  assert.equal(input.state().fire, true);
  key('keyup', 'KeyJ');
  assert.equal(input.state().fire, false);
  key('keydown', 'KeyK'); key('keydown', 'KeyK', { repeat: true }); key('keyup', 'KeyK'); key('keydown', 'KeyK');
  assert.equal(input.takeStrikes(), 2);
  assert.equal(input.takeStrikes(), 0);
  key('keydown', 'KeyD'); key('keyup', 'KeyD'); t = 0.15; key('keydown', 'KeyD');
  assert.equal(input.takeRoll(), 1);
  assert.equal(input.takeRoll(), 0);
  key('keydown', 'KeyJ'); key('keydown', 'KeyK');
  input.clear();
  assert.equal(input.state().fire, false);
  assert.equal(input.takeStrikes(), 0);
  delete globalThis.window;
});

test('the mouse aims and fires in the arena only; J turns mouse aim off until it moves; right button strikes', async () => {
  const win = fakeTarget(), stage = fakeTarget();
  globalThis.window = win;
  const { createInput } = await import('../src/input.js?fake2');
  let inArena = false;
  const input = createInput(stage, { onTap() {}, onKey: () => false, arena: () => inArena, now: () => 0 });
  stage.fire('pointermove', { pointerType: 'mouse', clientX: 100, clientY: 50 });
  assert.equal(input.mouse.on, false, 'not in the arena');
  inArena = true;
  stage.fire('pointermove', { pointerType: 'mouse', clientX: 100, clientY: 50 });
  assert.deepEqual(input.mouse, { on: true, px: 100, py: 50 });
  stage.fire('pointerdown', { pointerType: 'mouse', button: 0, clientX: 100, clientY: 50 });
  assert.equal(input.state().fire, true);
  stage.fire('pointerup', { pointerType: 'mouse', button: 0, clientX: 100, clientY: 50 });
  stage.fire('pointerdown', { pointerType: 'mouse', button: 2, clientX: 100, clientY: 50 });
  assert.equal(input.takeStrikes(), 1);
  win.fire('keydown', { code: 'KeyJ', target: {}, preventDefault() {} });
  assert.equal(input.mouse.on, false);
  stage.fire('pointerdown', { pointerType: 'touch', button: 0, clientX: 1, clientY: 1 });
  win.fire('keyup', { code: 'KeyJ', target: {}, preventDefault() {} });
  assert.equal(input.state().fire, false, 'touch never fires');
  delete globalThis.window;
});

test('the pad: Fire held fires, Hit strikes per press, ◀ ◀ rolls left', async () => {
  const win = fakeTarget(), stage = fakeTarget();
  globalThis.window = win;
  const { createInput } = await import('../src/input.js?fake3');
  let t = 0;
  const input = createInput(stage, { onTap() {}, onKey: () => false, arena: () => true, now: () => t });
  input.press('Fire', true);
  assert.equal(input.state().fire, true);
  input.press('Fire', false);
  input.press('Hit', true); input.press('Hit', false); input.press('Hit', true);
  assert.equal(input.takeStrikes(), 2);
  input.press('ArrowLeft', true); input.press('ArrowLeft', false); t = 0.2; input.press('ArrowLeft', true);
  assert.equal(input.takeRoll(), -1);
  delete globalThis.window;
});

test('mouse fire releases on a window pointerup, and drops when the arena is left', async () => {
  const win = fakeTarget(), stage = fakeTarget();
  globalThis.window = win;
  const { createInput } = await import('../src/input.js?fix1');
  let inArena = true;
  const input = createInput(stage, { onTap() {}, onKey: () => false, arena: () => inArena, now: () => 0 });
  stage.fire('pointerdown', { pointerType: 'mouse', button: 0, clientX: 1, clientY: 1 });
  win.fire('pointerup', { pointerType: 'mouse', button: 0 });
  assert.equal(input.state().fire, false, 'released outside the stage');
  stage.fire('pointerdown', { pointerType: 'mouse', button: 0, clientX: 1, clientY: 1 });
  win.fire('pointercancel', { pointerType: 'mouse' });
  assert.equal(input.state().fire, false, 'cancelled');
  stage.fire('pointerdown', { pointerType: 'mouse', button: 0, clientX: 1, clientY: 1 });
  inArena = false;
  assert.equal(input.state().fire, false, 'not in the arena');
  delete globalThis.window;
});

test('clear forgets a pending roll, mouse fire, pad Fire, a held direction and mouse aim', async () => {
  const win = fakeTarget(), stage = fakeTarget();
  globalThis.window = win;
  const { createInput } = await import('../src/input.js?fix2');
  let t = 0;
  const input = createInput(stage, { onTap() {}, onKey: () => false, arena: () => true, now: () => t });
  const key = (type, code) => win.fire(type, { code, target: {}, preventDefault() {}, shiftKey: false });
  key('keydown', 'KeyD'); key('keyup', 'KeyD');
  stage.fire('pointermove', { pointerType: 'mouse', clientX: 5, clientY: 5 });
  stage.fire('pointerdown', { pointerType: 'mouse', button: 0, clientX: 5, clientY: 5 });
  input.press('Fire', true);
  key('keydown', 'KeyA');
  input.clear();
  t = 0.1; key('keydown', 'KeyD');
  assert.equal(input.takeRoll(), 0, 'the earlier tap is forgotten');
  key('keyup', 'KeyD');
  assert.deepEqual([input.state().fire, input.state().x, input.mouse.on], [false, 0, false]);
  delete globalThis.window;
});

test('strikes and rolls are not counted outside the arena', async () => {
  const win = fakeTarget(), stage = fakeTarget();
  globalThis.window = win;
  const { createInput } = await import('../src/input.js?fix3');
  let inArena = false;
  const input = createInput(stage, { onTap() {}, onKey: () => false, arena: () => inArena, now: () => 0 });
  const key = (type, code) => win.fire(type, { code, target: {}, preventDefault() {}, shiftKey: false });
  key('keydown', 'KeyK'); input.press('Hit', true); input.press('Hit', false);
  key('keydown', 'KeyD'); key('keyup', 'KeyD'); key('keydown', 'KeyD');
  inArena = true;
  assert.equal(input.takeStrikes(), 0);
  assert.equal(input.takeRoll(), 0);
  delete globalThis.window;
});
