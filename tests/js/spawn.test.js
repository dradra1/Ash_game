import test from 'node:test';
import assert from 'node:assert';
import { loadConfig } from './fixture.js';
import { createRng } from '../../static/js/engine/rng.js';
import { spawnBudget, enemyCap, poolForWave, spawnPoint } from '../../static/js/sim/spawn.js';

const config = loadConfig();
const d0 = config.danger[0];
const d1 = config.danger[1];
const d3 = config.danger[3];

test('бюджет спавна растёт по формуле конфига', () => {
  const w = config.waves;
  for (const wave of [1, 5, 20]) {
    const expect = (w.budget_base + w.budget_per_wave * wave) * d1.density;
    assert.ok(Math.abs(spawnBudget(config, wave, d1, 1) - expect) < 1e-9);
  }
});

test('сложность меняет плотность ровно на свой множитель', () => {
  const a = spawnBudget(config, 6, d0, 1);
  const b = spawnBudget(config, 6, d3, 1);
  assert.ok(Math.abs(b / a - d3.density / d0.density) < 1e-9);
});

test('кооп добавляет бюджет по числу игроков', () => {
  const solo = spawnBudget(config, 4, d1, 1);
  const eight = spawnBudget(config, 4, d1, 8);
  assert.ok(Math.abs(eight / solo - (1 + config.coop.budget_per_player * 7)) < 1e-9);
});

test('потолок живых врагов растёт с игроками и упирается в cap', () => {
  const s = config.sim;
  assert.equal(enemyCap(config, 1), s.max_enemies_base);
  assert.equal(enemyCap(config, 2), s.max_enemies_base + s.max_enemies_per_player);
  assert.equal(enemyCap(config, 100), s.max_enemies_cap);
  assert.ok(enemyCap(config, 8) <= s.max_enemies_cap);
});

test('пул волны фильтруется по min_wave/max_wave', () => {
  const buf = new Array(64);
  const arenaId = Object.keys(config.arenas)[0];
  const n1 = poolForWave(config, arenaId, 1, buf);
  for (let i = 0; i < n1; i++) {
    assert.ok(config.enemies[buf[i]].min_wave <= 1, buf[i] + ' не должен быть на волне 1');
  }
  // тип с min_wave > 1 появляется только со своей волны
  const late = Object.keys(config.enemies).find((k) => config.enemies[k].min_wave > 1);
  if (late) {
    const lw = config.enemies[late].min_wave;
    const before = poolForWave(config, arenaId, lw - 1, buf);
    assert.ok(!buf.slice(0, before).includes(late));
    const after = poolForWave(config, arenaId, lw, buf);
    assert.ok(buf.slice(0, after).includes(late));
  }
});

test('точка спавна никогда не ближе min_spawn_dist к живому игроку', () => {
  const rng = createRng(12345);
  const out = { x: 0, y: 0 };
  const players = [
    { x: 800, y: 600, alive: true },
    { x: 100, y: 100, alive: true },
    { x: 400, y: 400, alive: false },   // мёртвый не учитывается
  ];
  const min2 = config.arena.min_spawn_dist ** 2;
  let found = 0;
  for (let i = 0; i < 500; i++) {
    if (!spawnPoint(config, rng, players, out, 16)) continue;
    found++;
    for (const p of players) {
      if (!p.alive) continue;
      const d2 = (p.x - out.x) ** 2 + (p.y - out.y) ** 2;
      assert.ok(d2 >= min2, `точка ${out.x},${out.y} слишком близко к ${p.x},${p.y}`);
    }
  }
  assert.ok(found > 400, 'точка спавна почти всегда должна находиться');
});

test('спавн детерминирован по сиду', () => {
  const players = [{ x: 800, y: 600, alive: true }];
  const a = [];
  const b = [];
  for (const arr of [a, b]) {
    const rng = createRng(777);
    const out = { x: 0, y: 0 };
    for (let i = 0; i < 20; i++) {
      spawnPoint(config, rng, players, out, 16);
      arr.push(out.x, out.y);
    }
  }
  assert.deepEqual(a, b);
});
