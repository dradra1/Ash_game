import test from 'node:test';
import assert from 'node:assert';
import { loadConfig } from './fixture.js';
import { createRng } from '../../static/js/engine/rng.js';
import { createPlayer, addXp, applyLevelChoice, xpToNext } from '../../static/js/sim/player.js';
import { createLevelUp } from '../../static/js/sim/level.js';
import { createLocalTransport } from '../../static/js/net/transport.js';
import {
  createRun, PHASE_COLLECT, PHASE_LEVELUP, PHASE_SHOP, PHASE_WAVE,
} from '../../static/js/sim/run.js';

const config = loadConfig();

function player(character) {
  return createPlayer(config, 0, 'p', character || 'ch_pilgrim', 100, 100);
}

test('XP-кривая считается по формуле конфига и растёт', () => {
  const f = config.level.xp_formula;
  for (const lvl of [1, 2, 5, 20]) {
    assert.equal(xpToNext(config, lvl), Math.round(f.base + f.k * lvl ** f.pow));
  }
  assert.ok(xpToNext(config, 10) > xpToNext(config, 1));
});

test('накопление опыта поднимает уровень и копит очередь выборов', () => {
  const p = player();
  const need = p.xpNext;
  addXp(p, config, need);
  assert.equal(p.level, 2);
  assert.equal(p.pendingLevels, 1);
  addXp(p, config, 100000);
  assert.ok(p.level > 3);
  assert.ok(p.pendingLevels > 1, 'очередь выборов должна копиться');
});

test('генерируется ровно config.level.choices различных вариантов с редкостью', () => {
  const p = player();
  const lu = createLevelUp(config);
  const rng = createRng(3);
  const rarities = new Set((config.level.rarities || []).map((r) => r.id));
  for (let i = 0; i < 200; i++) {
    const choices = lu.roll(p, rng);
    assert.equal(choices.length, config.level.choices);
    const seen = new Set();
    for (const c of choices) {
      assert.ok(config.level.pool[c.stat], `неизвестный стат ${c.stat}`);
      assert.ok(c.value > 0);
      assert.ok(c.name && c.texture, 'вариант должен нести имя и иконку из конфига');
      assert.ok(!seen.has(c.stat), 'варианты не должны повторяться');
      assert.ok(c.rarity, 'должна быть редкость');
      if (rarities.size) assert.ok(rarities.has(c.rarity), c.rarity);
      seen.add(c.stat);
    }
  }
});

test('легендарная ступень даёт больше обычной', () => {
  const entry = config.level.pool.max_hp;
  assert.ok(entry.steps.length >= 5, 'steps должны быть длины 5');
  assert.ok(entry.steps[4] > entry.steps[0]);
});

test('веса персонажа смещают выбор: Цензор почти не видит ближний урон', () => {
  const censor = player('ch_censor');
  const pilgrim = player('ch_pilgrim');
  assert.equal(config.characters.ch_censor.levelup_weights.melee_dmg, 0,
    'у Цензора вес melee_dmg должен быть нулевым');

  function share(p, stat, seed) {
    const lu = createLevelUp(config);
    const rng = createRng(seed);
    let hits = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      for (const c of lu.roll(p, rng)) if (c.stat === stat) hits++;
    }
    return hits / n;
  }
  assert.equal(share(censor, 'melee_dmg', 9), 0, 'нулевой вес — стат не должен выпадать');
  assert.ok(share(pilgrim, 'melee_dmg', 9) > 0, 'у Пилигрима он выпадать должен');
  assert.ok(share(censor, 'ranged_dmg', 17) > share(pilgrim, 'ranged_dmg', 17),
    'Цензор должен чаще видеть дальний урон');
});

test('выбор применяется к статам и уменьшает очередь', () => {
  const p = player();
  const lu = createLevelUp(config);
  const rng = createRng(77);
  addXp(p, config, p.xpNext);
  assert.equal(p.pendingLevels, 1);

  const choices = lu.roll(p, rng);
  const c = choices.find((x) => x.stat === 'max_hp') || choices[0];
  const before = p.stats[c.stat];
  applyLevelChoice(p, config, c);
  assert.equal(p.pendingLevels, 0);
  assert.ok(p.stats[c.stat] > before, `стат ${c.stat} должен вырасти`);
});

test('прибавка max_hp лечит на ту же величину', () => {
  const p = player();
  p.hp = 5;
  const lu = createLevelUp(config);
  const rng = createRng(101);
  let choice = null;
  for (let i = 0; i < 500 && !choice; i++) {
    choice = lu.roll(p, rng).find((c) => c.stat === 'max_hp');
    if (choice) choice = { ...choice };
  }
  assert.ok(choice, 'max_hp должен встретиться среди вариантов');
  const hpBefore = p.hp;
  const maxBefore = p.maxHp;
  applyLevelChoice(p, config, choice);
  assert.equal(p.maxHp - maxBefore, p.hp - hpBefore);
});

test('левелап детерминирован по сиду', () => {
  const p = player();
  const a = createLevelUp(config).roll(p, createRng(555)).map((c) => c.stat + c.value + c.rarity).join();
  const b = createLevelUp(config).roll(p, createRng(555)).map((c) => c.stat + c.value + c.rarity).join();
  assert.equal(a, b);
});

test('после collect с pendingLevels открывается phase levelup, затем shop', () => {
  const transport = createLocalTransport();
  const arena = Object.keys(config.arenas)[0];
  const danger = config.danger[0].id;
  const run = createRun({
    config, seed: 42, transport,
    players: [{ id: 0, name: 'p', character: 'ch_pilgrim' }],
    arena, danger, unlocked: [],
  });
  // Накинуть уровней
  addXp(run.state.players[0], config, 100000);
  assert.ok(run.state.players[0].pendingLevels > 0);

  run.state.phase = PHASE_COLLECT;
  run.state.phaseTime = 0;
  run.step(0.016);

  assert.equal(run.state.phase, PHASE_LEVELUP);

  // Разобрать все выборы
  while (run.state.players[0].pendingLevels > 0 && run.state.phase === PHASE_LEVELUP) {
    assert.ok(run.applyLevelPick(0, 0));
  }
  assert.equal(run.state.phase, PHASE_SHOP);
});

test('пауза останавливает step', () => {
  const transport = createLocalTransport();
  const arena = Object.keys(config.arenas)[0];
  const danger = config.danger[0].id;
  const run = createRun({
    config, seed: 7, transport,
    players: [{ id: 0, name: 'p', character: 'ch_pilgrim' }],
    arena, danger, unlocked: [],
  });
  run.state.phase = PHASE_WAVE;
  run.state.phaseTime = 10;
  run.setPaused(true);
  const t0 = run.state.phaseTime;
  run.step(0.5);
  assert.equal(run.state.phaseTime, t0);
  run.setPaused(false);
  run.step(0.5);
  assert.ok(run.state.phaseTime < t0);
});
