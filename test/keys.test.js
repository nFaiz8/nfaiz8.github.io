import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, keyOf, bind, translate, keyName, cleanKeys, canBind } from '../src/keys.js';

test('the defaults: every action on its old key, nothing translated', () => {
  assert.deepEqual(ACTIONS.map((a) => [a.id, keyOf({}, a.id)]), [
    ['left', 'KeyA'], ['right', 'KeyD'], ['up', 'KeyW'], ['down', 'KeyS'], ['jump', 'Space'],
    ['crouch', 'ControlLeft'], ['fire', 'KeyJ'], ['hit', 'KeyK'], ['hook', 'KeyG'],
  ]);
  const t = translate({});
  assert.equal(t('KeyJ'), 'KeyJ');
  assert.equal(t('ControlRight'), 'ControlRight');
  assert.equal(t('KeyL'), 'KeyL', 'other keys pass through');
});

test('a new key does the action as its old key did; the old key is free', () => {
  const b = bind({}, 'fire', 'KeyL');
  assert.deepEqual(b, { fire: 'KeyL' });
  const t = translate(b);
  assert.equal(t('KeyL'), 'KeyJ');
  assert.equal(t('KeyJ'), null, 'J no longer fires');
  const c = translate(bind({}, 'crouch', 'KeyC'));
  assert.equal(c('KeyC'), 'ControlLeft');
  assert.equal(c('ControlRight'), null, 'both ctrls are free');
  assert.equal(translate(bind({}, 'left', 'KeyQ'))('ArrowLeft'), 'ArrowLeft', 'the arrows always stay');
});

test('taking a key another action has swaps them', () => {
  const b = bind({}, 'fire', 'KeyK');
  assert.equal(keyOf(b, 'fire'), 'KeyK');
  assert.equal(keyOf(b, 'hit'), 'KeyJ');
  const t = translate(b);
  assert.equal(t('KeyK'), 'KeyJ');
  assert.equal(t('KeyJ'), 'KeyK');
  assert.deepEqual(bind(b, 'fire', 'KeyJ'), {}, 'back to the defaults: nothing kept');
});

test('keys that cannot be bound, and junk in storage', () => {
  for (const k of ['Escape', 'ShiftLeft', 'ShiftRight', 'Tab', 'MetaLeft', 'AltLeft', '', undefined]) assert.ok(!canBind(k), k);
  assert.ok(canBind('KeyL') && canBind('ArrowUp') && canBind('Digit7'));
  assert.deepEqual(bind({}, 'fire', 'Escape'), {});
  assert.deepEqual(bind({}, 'nope', 'KeyL'), {});
  assert.deepEqual(cleanKeys({ fire: 'KeyL', hit: 'Escape', bogus: 'KeyQ', hook: 5 }), { fire: 'KeyL' });
  assert.deepEqual(cleanKeys({ fire: 'KeyL', hit: 'KeyL' }), { fire: 'KeyL' }, 'one key, one action');
  assert.deepEqual(cleanKeys(null), {});
  assert.deepEqual(cleanKeys('x'), {});
});

test('key names as the HUD writes them', () => {
  assert.deepEqual(['KeyJ', 'Digit3', 'Space', 'ControlLeft', 'ControlRight', 'ArrowLeft', 'ArrowUp', 'Slash', 'Numpad4', 'Semicolon'].map(keyName),
    ['J', '3', 'space', 'ctrl', 'right ctrl', '←', '↑', '/', 'num 4', ';']);
});
