import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { checkStation, checkLine } from '../src/rpg/check.js';

const GOOD = [
  '########',
  '#ES>>__#',
  '#..>>__#',
  '#####!!#',
  '========',
  '########',
];
const msgs = (rows) => checkStation(rows.join('\n')).map((e) => e.msg).join(' | ');
const swap = (rows, r, c, ch) => rows.map((l, i) => (i === r ? l.slice(0, c) + ch + l.slice(c + 1) : l));

test('a good map has no errors, and neither does the shipped station', () => {
  assert.deepEqual(checkStation(GOOD.join('\n')), []);
  assert.deepEqual(checkStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8')), []);
});

test('ragged rows and unknown characters', () => {
  assert.match(msgs([...GOOD.slice(0, 2), '#..>>_#', ...GOOD.slice(3)]), /row is 7 wide/);
  assert.match(msgs(swap(GOOD, 2, 1, 'Q')), /unknown tile 'Q'/);
});

test('at most one S, and an E wherever there\'s an S', () => {
  assert.match(msgs(swap(GOOD, 2, 1, 'S')), /at most one S/);
  assert.match(msgs(swap(GOOD, 1, 1, '.')), /no E/);
});

test('every walkable tile can be reached from S', () => {
  const walled = swap(swap(GOOD, 1, 5, '#'), 2, 5, '#'); // the platform cut off from the stairs
  assert.match(msgs(walled), /cannot be reached from S/);
});

test('stairs go down in their arrow\'s direction, with floor at both ends', () => {
  assert.match(msgs(swap(swap(GOOD, 1, 3, '<'), 1, 4, '<')), /must go down/);
  const noEnd = ['######', '#ES>>#', '#..>>#', '######'];
  assert.match(msgs(noEnd), /floor at both ends/);
});

test('no floor beside a stair run, and no drop between floors', () => {
  const beside = ['#######', '#ES>>_#', '#..._.#', '####!!#', '=======', '#######'];
  assert.match(msgs(beside), /floor beside a stair run/);
  const cliff = ['#######', '#ES._!#', '#....!#', '######=', '======='];
  assert.match(msgs(cliff), /a drop between two floors/);
});

test('tracks run edge to edge, with a platform edge beside them', () => {
  assert.match(msgs(swap(GOOD, 4, 7, '#')), /edge to edge/);
  assert.match(msgs(swap(swap(GOOD, 3, 5, '_'), 3, 6, '_')), /no platform edge/);
  assert.match(msgs(swap(GOOD, 2, 6, '!')), /'!' must be next to the track/);
});

test('a walkable tile with no floor level beside it is reported', () => {
  const noFloor = ['#####', '#S#E#', '#v#.#', '#_..#', '#####'];
  assert.match(msgs(noFloor), /no floor level/);
});

test('the command line checks a file', () => {
  const out = execFileSync('node', ['src/rpg/check.js', 'src/rpg/station.txt'], { encoding: 'utf8' });
  assert.match(out, /^ok/m);
});

const canal = fs.readFileSync(new URL('../src/rpg/canalst.txt', import.meta.url), 'utf8');
const museum = fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8');

test('CANAL ST checks clean: no S and no E is fine for a station you only reach by train', () => {
  assert.deepEqual(checkStation(canal), []);
});

test('a station with an S still needs an E, and two S are an error', () => {
  assert.match(checkStation('#####\n#S..#\n#####').map((e) => e.msg).join('|'), /no E/);
  assert.match(checkStation('######\n#S.SE#\n######').map((e) => e.msg).join('|'), /at most one S/);
});

test('without an S, everything walkable must be reachable from the platform', () => {
  // Wall the island across at column 30, edges and all: its east half can't be reached from the first '!'.
  const lines = canal.split('\n'); // three header lines, then the grid
  for (let r = 4; r <= 14; r++) lines[r + 3] = lines[r + 3].slice(0, 30) + '#' + lines[r + 3].slice(31);
  assert.ok(checkStation(lines.join('\n')).some((e) => /cannot be reached from the platform/.test(e.msg)));
});

test('the line: both stations as long as STOPS says, their tracks where TRACKS says', () => {
  assert.deepEqual(checkLine([museum, canal]), []);
  const short = museum.split('\n').map((l) => (/^[#=!._|b~n]/.test(l) && !l.startsWith(';') ? l.slice(0, -1) : l)).join('\n');
  assert.ok(checkLine([short, canal]).some((e) => e.stop === 0 && /101/.test(e.msg)));
});
