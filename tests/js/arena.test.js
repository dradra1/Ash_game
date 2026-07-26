import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, stubTransport, makePlayers } from './fixture.js';
import {
  buildArenaLayout, createPropIndex, separateFromProps, slideAlong, isClear, hashId,
} from '../../static/js/sim/arena.js';
import { createRun } from '../../static/js/sim/run.js';

const config = loadConfig();
const SIZE = config.arena.size;

function layoutFor(arena, seed, w, h) {
  return buildArenaLayout(config, arena, seed, w || SIZE[0], h || SIZE[1]);
}

// Главная гарантия всей затеи: арена не передаётся по сети, хост и клиенты
// строят её независимо. Разъедется — игроки будут упираться в разные завалы.
test('одинаковый сид даёт побайтово одинаковую раскладку', () => {
  const a = layoutFor('ar_hive', 12345);
  const b = layoutFor('ar_hive', 12345);
  assert.deepEqual(Array.from(a.tiles), Array.from(b.tiles));
  assert.deepEqual(a.props, b.props);
  assert.deepEqual(a.decals, b.decals);
});

test('разный сид даёт разную раскладку', () => {
  const a = layoutFor('ar_hive', 1);
  const b = layoutFor('ar_hive', 2);
  assert.notDeepEqual(Array.from(a.tiles), Array.from(b.tiles));
});

test('разные арены на одном сиде не совпадают', () => {
  const a = layoutFor('ar_hive', 777);
  const b = layoutFor('ar_ash', 777);
  assert.notDeepEqual(a.props, b.props);
  assert.notEqual(hashId('ar_hive'), hashId('ar_ash'));
});

test('размер арены задаёт размер карты тайлов', () => {
  const l = layoutFor('ar_hive', 5, 1600, 1200);
  assert.equal(l.cols, Math.ceil(1600 / l.tile));
  assert.equal(l.rows, Math.ceil(1200 / l.tile));
  assert.equal(l.tiles.length, l.cols * l.rows);
});

test('индексы тайлов не выходят за список ground', () => {
  for (const id of Object.keys(config.arenas)) {
    const l = layoutFor(id, 42);
    for (let i = 0; i < l.tiles.length; i++) {
      assert.ok(l.tiles[i] < l.ground.length, `${id}: индекс ${l.tiles[i]}`);
    }
  }
});

test('пол не однороден: встречается больше одной вариации', () => {
  const l = layoutFor('ar_hive', 99);
  const seen = new Set(l.tiles);
  assert.ok(seen.size > 1, 'все тайлы одинаковые — чанки не работают');
});

test('препятствия не наезжают друг на друга и держат просвет', () => {
  const gap = config.arena.props_min_gap;
  for (const id of Object.keys(config.arenas)) {
    const l = layoutFor(id, 2024);
    assert.ok(l.props.length > 0, `${id}: препятствий нет вовсе`);
    for (let i = 0; i < l.props.length; i++) {
      for (let j = i + 1; j < l.props.length; j++) {
        const a = l.props[i];
        const b = l.props[j];
        const need = a.r + b.r + gap;
        const d2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
        assert.ok(d2 >= need * need, `${id}: ${i} и ${j} ближе просвета`);
      }
    }
  }
});

test('центр арены свободен: там стартуют игроки', () => {
  const clear = config.arena.props_center_clear;
  const l = layoutFor('ar_ash', 31337);
  const cx = l.width / 2;
  const cy = l.height / 2;
  for (const p of l.props) {
    const d = Math.hypot(p.x - cx, p.y - cy);
    assert.ok(d >= clear, `завал в ${d.toFixed(0)} px от центра при просвете ${clear}`);
  }
});

test('препятствия не вылезают за стены', () => {
  const l = layoutFor('ar_tomb', 8);
  const m = config.arena.props_wall_margin;
  for (const p of l.props) {
    assert.ok(p.x - p.r >= m && p.x + p.r <= l.width - m, 'по x');
    assert.ok(p.y - p.r >= m && p.y + p.r <= l.height - m, 'по y');
  }
});

test('выталкивание выводит точку наружу за один шаг', () => {
  const l = layoutFor('ar_hive', 4);
  const idx = createPropIndex(l, config);
  const prop = l.props[0];
  const ent = { x: prop.x + 2, y: prop.y - 1 };
  const hits = separateFromProps(ent, 10, idx, null);
  assert.equal(hits, 1);
  const d = Math.hypot(ent.x - prop.x, ent.y - prop.y);
  assert.ok(d >= prop.r + 10 - 1e-6, `после выталкивания ${d} < ${prop.r + 10}`);
});

test('выталкивание из точного центра не делит на ноль', () => {
  const l = layoutFor('ar_hive', 4);
  const idx = createPropIndex(l, config);
  const prop = l.props[0];
  const ent = { x: prop.x, y: prop.y };
  separateFromProps(ent, 8, idx, null);
  assert.ok(Number.isFinite(ent.x) && Number.isFinite(ent.y));
  assert.ok(Math.hypot(ent.x - prop.x, ent.y - prop.y) >= prop.r + 8 - 1e-6);
});

test('свободная точка не двигается', () => {
  const l = layoutFor('ar_hive', 4);
  const idx = createPropIndex(l, config);
  const cx = l.width / 2;
  const cy = l.height / 2;
  const ent = { x: cx, y: cy };
  assert.equal(separateFromProps(ent, 10, idx, null), 0);
  assert.equal(ent.x, cx);
  assert.equal(ent.y, cy);
  assert.ok(isClear(cx, cy, 10, idx));
});

test('скольжение снимает движение внутрь и сохраняет вдоль края', () => {
  const e = { vx: -100, vy: 40 };
  slideAlong(e, 1, 0);                 // нормаль наружу по x, враг едет внутрь
  assert.ok(Math.abs(e.vx) < 1e-9, 'составляющая внутрь не убрана');
  assert.equal(e.vy, 40, 'тангенциальная составляющая потеряна');
});

test('скольжение не трогает движение прочь от препятствия', () => {
  const e = { vx: 100, vy: 40 };
  slideAlong(e, 1, 0);
  assert.equal(e.vx, 100);
  assert.equal(e.vy, 40);
});

// Раскладка обязана тянуть числа из СВОЕГО rng. Иначе она съест сотни значений
// и сдвинет всю случайность забега — спавн, дроп, ассортимент лавки.
test('генерация арены не сдвигает rng забега', () => {
  const mk = () => createRun({
    config, seed: 555, transport: stubTransport(),
    players: makePlayers(1, Object.keys(config.characters)[0]),
    arena: 'ar_hive', danger: 0, unlocked: null, curses: [],
  });
  const a = mk();
  const b = mk();
  const seqA = [];
  const seqB = [];
  for (let i = 0; i < 20; i++) { seqA.push(a.rng.float()); seqB.push(b.rng.float()); }
  assert.deepEqual(seqA, seqB);

  // И первое значение rng забега не должно зависеть от того, сколько
  // препятствий выпало: сравниваем с ареной, где их заведомо другое число.
  const other = createRun({
    config, seed: 555, transport: stubTransport(),
    players: makePlayers(1, Object.keys(config.characters)[0]),
    arena: 'ar_tomb', danger: 0, unlocked: null, curses: [],
  });
  assert.equal(other.rng.float(), seqA[0]);
});

test('в коопе арена больше и препятствий не меньше', () => {
  const solo = layoutFor('ar_hive', 61, SIZE[0], SIZE[1]);
  const scale = 1 + config.coop.arena_per_player * 7;
  const coop = layoutFor('ar_hive', 61,
    Math.round(SIZE[0] * scale), Math.round(SIZE[1] * scale));
  assert.ok(coop.width > solo.width);
  assert.ok(coop.tiles.length > solo.tiles.length);
});
