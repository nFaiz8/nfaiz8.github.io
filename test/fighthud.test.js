import test from 'node:test';
import assert from 'node:assert/strict';
import { hpText } from '../src/fighthud.js';

test('the hp line: a █ per 10 hp, ░ for the rest, and a pickup gun\'s rounds', () => {
  assert.equal(hpText({ hp: 100, gun: 'deagle', ammo: -1 }), 'hp ██████████ 100');
  assert.equal(hpText({ hp: 75, gun: 'deagle', ammo: -1 }), 'hp ████████░░ 75');
  assert.equal(hpText({ hp: 3, gun: 'deagle', ammo: -1 }), 'hp █░░░░░░░░░ 3', 'alive shows a block');
  assert.equal(hpText({ hp: 0, gun: 'deagle', ammo: -1 }), 'hp ░░░░░░░░░░ 0');
  assert.equal(hpText({ hp: 60, gun: 'rifle', ammo: 32 }), 'hp ██████░░░░ 60 · rifle 32');
  assert.equal(hpText({ hp: 100, gun: 'sniper', ammo: 4 }), 'hp ██████████ 100 · sniper 4');
});
