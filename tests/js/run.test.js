// Интеграция: гоняем симуляцию головой в node, без DOM и без рендера.
// Это прямая проверка DoD этапа M1 — «проходятся 3 волны».

import test from 'node:test';
import assert from 'node:assert';
import { loadConfig, stubTransport, makePlayers } from './fixture.js';
import { createRun, PHASE_WAVE, PHASE_OVER, waveLength } from '../../static/js/sim/run.js';

const config = loadConfig();
const CHAR = 'ch_pilgrim';

function newRun(opts) {
  const o = opts || {};
  return createRun({
    config,
    seed: o.seed === undefined ? 42 : o.seed,
    transport: stubTransport(),
    players: makePlayers(o.players || 1, CHAR),
    arena: 'ar_hive',
    danger: o.danger === undefined ? 1 : o.danger,
  });
}

function advance(run, seconds, dt) {
  const step = dt || config.sim.dt;
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) run.step(step);
}

test('длительность волны считается по формуле, боссовые волны длиннее', () => {
  const r = config.run;
  assert.equal(waveLength(config, 1), r.wave_len_base);
  assert.equal(waveLength(config, 3), r.wave_len_base + r.wave_len_step * 2);
  assert.ok(waveLength(config, 99) <= r.wave_len_cap + 1e-9);
  // волна 10 — мид-босс: длиннее обычной
  assert.ok(waveLength(config, 10) > Math.min(r.wave_len_cap,
    r.wave_len_base + r.wave_len_step * 9) - 1e-9);
  assert.equal(waveLength(config, 20), r.boss_waves['20'].len);
});

test('на волне спавнятся враги и не превышают потолок', () => {
  const run = newRun();
  advance(run, config.run.wave_intro_sec + 6);
  assert.equal(run.state.phase, PHASE_WAVE);
  assert.ok(run.enemyPool.count > 0, 'враги должны появиться');
  const cap = Math.min(config.sim.max_enemies_cap, config.sim.max_enemies_base);
  assert.ok(run.enemyPool.count <= cap);
});

test('враги не спавнятся ближе min_spawn_dist к игроку', () => {
  const run = newRun();
  advance(run, config.run.wave_intro_sec + 0.1);
  const p = run.state.players[0];
  // сразу после появления враги ещё не успели подойти
  for (let i = 0; i < run.enemyPool.count; i++) {
    const e = run.enemyPool.items[i];
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    assert.ok(d > config.arena.min_spawn_dist * 0.9, `враг заспавнился в ${d.toFixed(0)} px`);
  }
});

test('оружие бьёт само и враги гибнут, прах и опыт капают', () => {
  const run = newRun();
  const p = run.state.players[0];
  advance(run, config.run.wave_intro_sec + 20);
  assert.ok(run.state.kills > 0, 'оружие должно убивать без участия игрока');
  assert.ok(p.xp > 0 || p.level > 1, 'опыт должен капать');
  assert.ok(run.state.pot > 0 || run.pickupPool.count > 0, 'прах должен падать');
});

test('три волны проходятся, номер волны растёт', () => {
  const run = newRun({ danger: 0 });
  const p = run.state.players[0];
  p.hp = 1e9;                     // проверяем прогресс волн, а не выживание
  p.maxHp = 1e9;
  let guard = 0;
  while (run.state.wave < 4 && guard < 200000) {
    run.step(config.sim.dt);
    p.hp = 1e9;
    // Лавка ждёт игрока: без «готов» забег стоит, это и есть задуманное поведение
    if (run.state.phase === 'shop') run.readyUp(p.id);
    guard++;
  }
  assert.ok(run.state.wave >= 4, `дошли только до волны ${run.state.wave}`);
  assert.notEqual(run.state.phase, PHASE_OVER);
});

test('лавка открывается между волнами и ждёт готовности', () => {
  const run = newRun({ danger: 0 });
  const p = run.state.players[0];
  const stop = 200000;
  let guard = 0;
  while (run.state.phase !== 'shop' && guard < stop) {
    run.step(config.sim.dt);
    p.hp = 1e9;
    guard++;
  }
  assert.equal(run.state.phase, 'shop', 'лавка должна открыться после первой волны');
  assert.ok(run.state.shopOpen);

  // без readyUp волна не стартует, сколько ни жди
  const waveBefore = run.state.wave;
  for (let i = 0; i < 5000; i++) run.step(config.sim.dt);
  assert.equal(run.state.wave, waveBefore, 'соло-лавка не должна стартовать по таймеру');

  const shop = run.shopFor(p.id);
  assert.equal(shop.slots.length, config.shop.slots);
  let filled = 0;
  for (const s of shop.slots) if (s.cfg) filled++;
  assert.ok(filled > 0, 'ассортимент должен быть непустым');

  run.readyUp(p.id);
  run.step(config.sim.dt);
  assert.equal(run.state.wave, waveBefore + 1);
});

test('на волне 10 появляется мид-босс и считается при смерти', () => {
  const run = newRun({ danger: 0 });
  const p = run.state.players[0];
  run.startWave(10);
  for (let i = 0; i < Math.round((config.run.wave_intro_sec + 0.5) / config.sim.dt); i++) {
    run.step(config.sim.dt);
    p.hp = 1e9;
  }
  assert.ok(run.state.bossUid >= 0, 'босс должен появиться на волне 10');
  let boss = null;
  for (let i = 0; i < run.enemyPool.count; i++) {
    if (run.enemyPool.items[i].uid === run.state.bossUid) boss = run.enemyPool.items[i];
  }
  assert.ok(boss, 'босс должен быть в пуле');
  assert.ok(boss.boss === true);
  assert.ok(boss.maxHp > config.enemies.e_cultist.hp * 10, 'у босса должно быть много HP');
});

test('босс меняет фазу при падении HP ниже порога', () => {
  const run = newRun({ danger: 0 });
  const p = run.state.players[0];
  run.startWave(10);
  for (let i = 0; i < Math.round((config.run.wave_intro_sec + 0.5) / config.sim.dt); i++) {
    run.step(config.sim.dt);
    p.hp = 1e9;
  }
  let boss = null;
  for (let i = 0; i < run.enemyPool.count; i++) {
    if (run.enemyPool.items[i].uid === run.state.bossUid) boss = run.enemyPool.items[i];
  }
  const phase0 = boss.phase;
  const speed0 = boss.speed;
  boss.hp = boss.maxHp * 0.5;            // ниже порога второй фазы (0.6)
  run.step(config.sim.dt);
  assert.notEqual(boss.phase, phase0, 'фаза должна смениться');
  assert.ok(boss.speed > speed0, 'вторая фаза ускоряет босса');
});

test('смерть всех игроков завершает забег', () => {
  const run = newRun();
  advance(run, config.run.wave_intro_sec + 1);
  run.state.players[0].hp = 0;
  run.state.players[0].alive = false;
  run.step(config.sim.dt);
  assert.equal(run.state.phase, PHASE_OVER);
  assert.equal(run.state.win, false);
});

test('симуляция детерминирована по сиду', () => {
  const a = newRun({ seed: 999 });
  const b = newRun({ seed: 999 });
  advance(a, 25);
  advance(b, 25);
  assert.equal(a.state.kills, b.state.kills);
  assert.equal(a.enemyPool.count, b.enemyPool.count);
  assert.ok(Math.abs(a.state.pot - b.state.pot) < 1e-9);
  for (let i = 0; i < a.enemyPool.count; i++) {
    assert.ok(Math.abs(a.enemyPool.items[i].x - b.enemyPool.items[i].x) < 1e-9);
  }
});

test('разные сиды дают разный ход забега', () => {
  const a = newRun({ seed: 1 });
  const b = newRun({ seed: 2 });
  // Сравниваем В СЕРЕДИНЕ волны: после её конца враги вычищаются, и оба забега
  // одинаково пусты независимо от сида.
  advance(a, 15);
  advance(b, 15);
  assert.ok(a.enemyPool.count > 0 && b.enemyPool.count > 0, 'должны быть живые враги');
  let differs = false;
  for (let i = 0; i < Math.min(a.enemyPool.count, b.enemyPool.count); i++) {
    if (Math.abs(a.enemyPool.items[i].x - b.enemyPool.items[i].x) > 1e-6) { differs = true; break; }
  }
  assert.ok(differs || a.state.kills !== b.state.kills, 'сид должен менять забег');
});

test('в коопе опыт не делится: каждый живой получает полный XP', () => {
  const run = newRun({ players: 4 });
  // Держим всех живыми: проверяется раздача опыта, а не выживаемость.
  // Выбывший игрок опыт не получает — это отдельное, намеренное поведение.
  const keep = () => { for (const p of run.state.players) { p.hp = 1e9; p.maxHp = 1e9; } };
  const n = Math.round((config.run.wave_intro_sec + 20) / config.sim.dt);
  for (let i = 0; i < n; i++) { keep(); run.step(config.sim.dt); }
  const levels = run.state.players.map((p) => p.level + p.xp / p.xpNext);
  for (let i = 1; i < levels.length; i++) {
    assert.ok(Math.abs(levels[i] - levels[0]) < 1e-6,
      'все живые игроки должны иметь одинаковый опыт');
  }
});

test('пул врагов не переполняется и не растёт', () => {
  const run = newRun({ danger: 3 });
  const p = run.state.players[0];
  p.hp = 1e9;
  p.maxHp = 1e9;
  for (let i = 0; i < 60000; i++) {
    run.step(config.sim.dt);
    p.hp = 1e9;
    assert.ok(run.enemyPool.count <= run.enemyPool.capacity);
    assert.ok(run.projPool.count <= run.projPool.capacity);
    assert.ok(run.pickupPool.count <= run.pickupPool.capacity);
  }
});
