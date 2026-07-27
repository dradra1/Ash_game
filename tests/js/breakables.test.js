// Ломаемые мини-ивенты: раскладка на арене и награда за разбитый объект.
//
// Проверяем две вещи, которые ломаются молча. Первая — детерминированность точек:
// по сети они не передаются, кооп-клиент строит их сам, и расхождение видно только
// как «сосед бьёт пустое место». Вторая — что объект НЕ засчитывается как убийство:
// он живёт в пуле врагов, и любая правка damageEnemy норовит утащить его в очки,
// опыт и обычный дроп праха.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, stubTransport, makePlayers } from './fixture.js';
import { buildArenaLayout } from '../../static/js/sim/arena.js';
import { createRun } from '../../static/js/sim/run.js';

const config = loadConfig();
const SIZE = config.arena.size;
const CHAR = 'ch_pilgrim';
const DT = config.sim.dt;

function layoutFor(arena, seed, cfg) {
  return buildArenaLayout(cfg || config, arena, seed, SIZE[0], SIZE[1]);
}

function newRun(seed) {
  return createRun({
    config, seed, transport: stubTransport(),
    players: makePlayers(1, CHAR), arena: 'ar_hive', danger: 0, curses: [],
  });
}

// --- раскладка --------------------------------------------------------------

test('точки ломаемых детерминированы сидом', () => {
  assert.deepEqual(layoutFor('ar_hive', 4242).breakables,
    layoutFor('ar_hive', 4242).breakables);
  assert.notDeepEqual(layoutFor('ar_hive', 1).breakables,
    layoutFor('ar_hive', 2).breakables);
});

test('на каждой арене ломаемые есть и не больше потолка', () => {
  for (const id of Object.keys(config.arenas)) {
    const l = layoutFor(id, 2024);
    assert.ok(l.breakables.length > 0, `${id}: ломаемых нет вовсе`);
    assert.ok(l.breakables.length <= config.arena.breakables_max,
      `${id}: ${l.breakables.length} > потолка`);
  }
});

test('каждый тип точки описан в config.breakables', () => {
  for (const id of Object.keys(config.arenas)) {
    for (const s of layoutFor(id, 7).breakables) {
      assert.ok(config.breakables[s.type], `${id}: неизвестный тип ${s.type}`);
    }
  }
});

test('ломаемые не стоят в завале, в центре и в стене', () => {
  const cfg = config.arena;
  for (const id of Object.keys(config.arenas)) {
    const l = layoutFor(id, 31337);
    const cx = l.width / 2;
    const cy = l.height / 2;
    for (const b of l.breakables) {
      assert.ok(Math.hypot(b.x - cx, b.y - cy) >= cfg.breakables_center_clear,
        `${id}: ломаемый в центре, где стартуют игроки`);
      assert.ok(b.x - b.r >= cfg.breakables_wall_margin
        && b.x + b.r <= l.width - cfg.breakables_wall_margin, `${id}: вылез по x`);
      assert.ok(b.y - b.r >= cfg.breakables_wall_margin
        && b.y + b.r <= l.height - cfg.breakables_wall_margin, `${id}: вылез по y`);
      for (const p of l.props) {
        const need = p.r + b.r + cfg.breakables_prop_gap;
        assert.ok((p.x - b.x) ** 2 + (p.y - b.y) ** 2 >= need * need,
          `${id}: ломаемый внутри завала — оружием не достать`);
      }
    }
  }
});

test('ломаемые не сбиваются в кучу', () => {
  const gap = config.arena.breakables_min_gap;
  const l = layoutFor('ar_ash', 555);
  for (let i = 0; i < l.breakables.length; i++) {
    for (let j = i + 1; j < l.breakables.length; j++) {
      const a = l.breakables[i];
      const b = l.breakables[j];
      const need = a.r + b.r + gap;
      assert.ok((a.x - b.x) ** 2 + (a.y - b.y) ** 2 >= need * need, `${i} и ${j} рядом`);
    }
  }
});

// Ломаемые добавлены в раскладку ПОСЛЕДНИМИ ровно затем, чтобы не сдвинуть
// последовательность rng у пола, декалей и завалов. Иначе появление мини-ивентов
// переставило бы все старые арены, а вместе с ними и сохранённые сиды забегов.
test('ломаемые не сдвигают раскладку пола и завалов', () => {
  const off = JSON.parse(JSON.stringify(config));
  off.arena.breakables_max = 0;
  const withThem = layoutFor('ar_hive', 909);
  const without = layoutFor('ar_hive', 909, off);
  assert.equal(without.breakables.length, 0);
  assert.deepEqual(Array.from(withThem.tiles), Array.from(without.tiles));
  assert.deepEqual(withThem.props, without.props);
  assert.deepEqual(withThem.decals, without.decals);
});

// --- поведение в забеге -----------------------------------------------------

test('ломаемые встают на свои точки в начале волны', () => {
  const run = newRun(11);
  const spots = run.layout.breakables;
  const placed = [];
  for (let i = 0; i < run.enemyPool.count; i++) {
    const e = run.enemyPool.items[i];
    if (e.breakable) placed.push(e);
  }
  assert.equal(placed.length, spots.length);
  for (const s of spots) {
    assert.ok(placed.some((e) => e.x === s.x && e.y === s.y && e.cfg === config.breakables[s.type]),
      `на точке ${s.type} никто не встал`);
  }
});

test('ломаемые появляются заново каждую волну', () => {
  const run = newRun(12);
  const spots = run.layout.breakables;
  for (let i = 0; i < run.enemyPool.count; i++) {
    const e = run.enemyPool.items[i];
    if (e.breakable) e.alive = false;
  }
  run.startWave(2);
  let n = 0;
  for (let i = 0; i < run.enemyPool.count; i++) {
    if (run.enemyPool.items[i].breakable && run.enemyPool.items[i].alive) n++;
  }
  assert.equal(n, spots.length);
});

// Разбить объект в тестах приходится по-настоящему, оружием: награда висит на
// пути смерти в damageEnemy, и подделка `hp = 0` его бы не прошла.
function breakOne(run, kind, limitSec) {
  let target = null;
  for (let i = 0; i < run.enemyPool.count; i++) {
    const e = run.enemyPool.items[i];
    if (e.alive && e.breakable && e.cfg.reward && e.cfg.reward.type === kind) {
      target = e;
      break;
    }
  }
  if (!target) return null;
  const p = run.state.players[0];
  p.x = target.x - 8;
  p.y = target.y;
  const steps = Math.round((limitSec || 20) / DT);
  for (let i = 0; i < steps && target.alive; i++) {
    // Толпа увела бы автоприцел на себя: ломаемые — запасная цель, по ним бьют
    // только в затишье. В тесте затишье делаем руками.
    for (let k = 0; k < run.enemyPool.count; k++) {
      const e = run.enemyPool.items[k];
      if (!e.breakable) e.alive = false;
    }
    p.x = target.x - 8;
    p.y = target.y;
    run.step(DT);
  }
  return target.alive ? null : target;
}

function runWith(kind) {
  for (let seed = 1; seed < 40; seed++) {
    const run = newRun(seed);
    for (let i = 0; i < run.enemyPool.count; i++) {
      const e = run.enemyPool.items[i];
      if (e.alive && e.breakable && e.cfg.reward && e.cfg.reward.type === kind) return run;
    }
  }
  return null;
}

test('разбитый объект не идёт в убийства, очки и опыт', () => {
  const run = runWith('ash');
  assert.ok(run, 'ни на одном сиде не выпала урна с прахом');
  const p = run.state.players[0];
  const kills = run.state.kills;
  const score = run.state.score;
  const xp = p.xp;
  const broken = breakOne(run, 'ash');
  assert.ok(broken, 'объект не разбился за отведённое время');
  assert.equal(run.state.kills, kills);
  assert.equal(run.state.score, score);
  assert.equal(p.xp, xp);
  assert.ok(run.events.some((e) => e.type === 'breakable_down'), 'событие не ушло');
});

// Считаем по ash_gained, а не по числу лежащих кучек: игрок стоит вплотную и
// подбирает выпавшее в тот же тик, так что pickupPool успевает вернуться в ноль.
// Обычные враги в breakOne гибнут напрямую, минуя дроп, поэтому источник тут один.
test('урна с прахом роняет прах', () => {
  const run = runWith('ash');
  assert.ok(run);
  const before = run.state.ash_gained;
  assert.ok(breakOne(run, 'ash'));
  assert.ok(run.state.ash_gained > before, 'прах не выпал');
});

test('реликварий лечит того, кто его добил', () => {
  const run = runWith('heal');
  assert.ok(run, 'ни на одном сиде не выпал реликварий');
  const p = run.state.players[0];
  p.hp = 1;
  assert.ok(breakOne(run, 'heal'));
  const value = config.breakables.br_reliquary.reward.value;
  assert.ok(p.hp >= Math.min(p.maxHp, 1 + value) - 1e-6, `hp ${p.hp} после лечения на ${value}`);
});
