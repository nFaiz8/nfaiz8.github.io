import test from 'node:test';
import assert from 'node:assert/strict';
import { hpText, streakText } from '../src/fighthud.js';

test('the hp line: a █ per 10 hp, ░ for the rest, and a pickup gun\'s rounds', () => {
  assert.equal(hpText({ hp: 100, gun: 'deagle', ammo: -1 }), 'hp ██████████ 100');
  assert.equal(hpText({ hp: 75, gun: 'deagle', ammo: -1 }), 'hp ████████░░ 75');
  assert.equal(hpText({ hp: 3, gun: 'deagle', ammo: -1 }), 'hp █░░░░░░░░░ 3', 'alive shows a block');
  assert.equal(hpText({ hp: 0, gun: 'deagle', ammo: -1 }), 'hp ░░░░░░░░░░ 0');
  assert.equal(hpText({ hp: 60, gun: 'rifle', ammo: 32 }), 'hp ██████░░░░ 60 · smg 32', 'the rifle is shown as the smg');
  assert.equal(hpText({ hp: 60, gun: 'sniper', ammo: 3 }), 'hp ██████░░░░ 60 · sniper 3');
  assert.equal(hpText({ hp: 100, gun: 'sniper', ammo: 4 }), 'hp ██████████ 100 · sniper 4');
});

test('the streak line: the all-time top three, my streak from 2, and a new record', () => {
  const best = [{ name: 'faiz', n: 7 }, { name: 'bo', n: 5 }, { name: 'cy', n: 4 }];
  assert.equal(streakText({ best, streak: 0 }), 'best streaks 1 faiz 7 · 2 bo 5 · 3 cy 4');
  assert.equal(streakText({ best, streak: 1 }), 'best streaks 1 faiz 7 · 2 bo 5 · 3 cy 4', 'one kill is no streak');
  assert.equal(streakText({ best, streak: 3 }), 'best streaks 1 faiz 7 · 2 bo 5 · 3 cy 4 · streak 3');
  assert.equal(streakText({ best, streak: 7, record: true }), 'best streaks 1 faiz 7 · 2 bo 5 · 3 cy 4 · streak 7 NEW RECORD');
  assert.equal(streakText({ best: [], streak: 2 }), 'streak 2', 'no board yet');
  assert.equal(streakText({ best: [], streak: 0 }), '');
  assert.equal(streakText({}), '');
  assert.equal(streakText({ best: [...best, { name: 'dee', n: 3 }] }), 'best streaks 1 faiz 7 · 2 bo 5 · 3 cy 4', 'only three');
});
