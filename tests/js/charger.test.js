// Рывкач: подготовка, упреждение назад и защита от «самонаведения».
//
// Механика держится на одном обещании: рывок бьёт в точку, где игрок был
// charge.lead секунд назад, и после прицела вектор НЕ пересчитывается. Стоит
// кому-нибудь «починить» это на ведение цели — и уклонение исчезнет, а рывок
// превратится в неизбежный удар. Тесты ниже стерегут именно это обещание.

import test from 'node:test';
import assert from 'node:assert';
import { loadConfig } from './fixture.js';
import { createPool } from '../../static/js/engine/pool.js';
import { createRng } from '../../static/js/engine/rng.js';
import { poolForWave } from '../../static/js/sim/spawn.js';
import {
  makeEnemy, resetEnemy, initEnemy, stepEnemies, AI_CHARGER,
} from '../../static/js/sim/enemy.js';

const config = loadConfig();
const DT = config.sim.dt;
const ID = 'e_lunger';
const cfg = config.enemies[ID];
const charge = cfg.charge;

function makePlayer(x, y) {
  return { id: 0, x, y, radius: config.player.radius, alive: true };
}

// Мир из одного рывкача и одного игрока. Урон и снаряды не нужны — проверяем
// только траекторию, поэтому колбэки-заглушки.
function world(playerX, playerY, enemyX, enemyY) {
  const pool = createPool(4, makeEnemy, resetEnemy);
  const e = pool.spawn();
  initEnemy(e, config, ID, 9, config.danger[0], 1, null);
  e.x = enemyX;
  e.y = enemyY;
  const player = makePlayer(playerX, playerY);
  const hits = [];
  const deps = {
    config,
    players: [player],
    rng: createRng(1),
    fireProjectile() {},
    hitPlayer(_t, dmg) { hits.push(dmg); },
  };
  return { pool, e, player, deps, hits };
}

test('рывкач заведён как отдельный архетип, а не как преследователь', () => {
  const w = world(0, 0, 1000, 0);
  assert.equal(w.e.ai, AI_CHARGER);
});

test('вне дистанции рывка просто догоняет', () => {
  const w = world(0, 0, charge.range * 3, 0);
  stepEnemies(w.pool, DT, w.deps);
  assert.equal(w.e.telegraph, false, 'краснеть на полкарты нельзя');
  assert.ok(w.e.vx < 0, 'должен идти к игроку');
  assert.ok(Math.abs(Math.hypot(w.e.vx, w.e.vy) - w.e.speed) < 1e-6,
    'на подходе идёт обычной скоростью, а не скоростью рывка');
});

test('на дистанции замирает и краснеет ровно windup секунд', () => {
  const w = world(0, 0, charge.range * 0.8, 0);
  stepEnemies(w.pool, DT, w.deps);
  assert.equal(w.e.telegraph, true, 'подготовка не началась');
  assert.equal(w.e.vx, 0, 'во время подготовки стоит на месте');
  assert.equal(w.e.vy, 0);

  // Чуть-чуть не доводим до конца подготовки: всё ещё красный и неподвижный
  const almost = Math.floor((charge.windup - 2 * DT) / DT);
  for (let i = 0; i < almost; i++) stepEnemies(w.pool, DT, w.deps);
  assert.equal(w.e.telegraph, true, `подготовка оборвалась раньше ${charge.windup} с`);
  assert.equal(w.e.vx, 0);

  // Ещё несколько тиков — рывок начался, краснота снята
  for (let i = 0; i < 4; i++) stepEnemies(w.pool, DT, w.deps);
  assert.equal(w.e.telegraph, false, 'в рывке уже не краснеет');
  assert.ok(Math.hypot(w.e.vx, w.e.vy) > w.e.speed * 2, 'рывок должен быть быстрым');
});

test('рывок уходит туда, где игрок был lead секунд назад', () => {
  // Игрок стоит справа от врага, ждёт момент прицела, потом уходит ВВЕРХ.
  const w = world(charge.range * 0.8, 0, 0, 0);
  let aimAt = null;

  // Момент прицела ловим по самому врагу (флаг aimed), а не по счёту тиков:
  // считать кадры значило бы дублировать в тесте ту же арифметику, которую он
  // и проверяет. Позиция игрока берётся ДО шага — именно её видит прицел.
  const ticks = Math.ceil((charge.windup + 0.2) / DT);
  for (let i = 0; i < ticks; i++) {
    const pre = { x: w.player.x, y: w.player.y };
    const wasAimed = w.e.aimed;
    stepEnemies(w.pool, DT, w.deps);
    if (!wasAimed && w.e.aimed) aimAt = pre;
    if (aimAt) w.player.y -= 400 * DT;            // убегаем поперёк
    if (Math.hypot(w.e.vx, w.e.vy) > w.e.speed * 2) break;
  }

  assert.ok(aimAt, 'прицел так и не снялся');
  assert.ok(Math.hypot(w.e.vx, w.e.vy) > w.e.speed * 2, 'рывок не начался');
  // Вектор рывка смотрит в ЗАПОМНЕННУЮ точку, а не в текущую позицию игрока.
  const want = Math.atan2(aimAt.y - w.e.y, aimAt.x - w.e.x);
  const got = Math.atan2(w.e.vy, w.e.vx);
  const off = Math.abs(Math.atan2(Math.sin(got - want), Math.cos(got - want)));
  assert.ok(off < 0.12, `рывок ушёл на ${(off * 180 / Math.PI).toFixed(1)}° от следа`);

  // И к текущему положению игрока он не имеет отношения: тот уже далеко вверху.
  const chase = Math.atan2(w.player.y - w.e.y, w.player.x - w.e.x);
  const offChase = Math.abs(Math.atan2(Math.sin(got - chase), Math.cos(got - chase)));
  assert.ok(offChase > off, 'рывок ведёт игрока — уклоняться стало нечем');
});

test('в рывке вектор не пересчитывается: уйти с линии можно', () => {
  const w = world(charge.range * 0.8, 0, 0, 0);
  const ticks = Math.ceil((charge.windup + 0.1) / DT);
  for (let i = 0; i < ticks; i++) stepEnemies(w.pool, DT, w.deps);
  const vx = w.e.vx;
  const vy = w.e.vy;
  // Телепортируем игрока в противоположную сторону посреди рывка
  w.player.x = -2000;
  w.player.y = -2000;
  stepEnemies(w.pool, DT, w.deps);
  assert.equal(w.e.vx, vx, 'рывок довернул за игроком');
  assert.equal(w.e.vy, vy);
});

test('рывок пролетает не меньше дистанции срабатывания', () => {
  // Иначе он не долетает до запомненной точки и механика вырождается в «постоял
  // красным и потоптался на месте».
  assert.ok(charge.speed * charge.duration >= charge.range,
    `${charge.speed}×${charge.duration} < ${charge.range}`);
});

test('прицел снимается строго внутри подготовки', () => {
  assert.ok(charge.lead > 0 && charge.lead < charge.windup,
    'lead вне (0, windup) — упреждение либо не работает, либо равно текущей точке');
});

test('после рывка есть отдых и кулдаун, а не бесконечная серия', () => {
  const w = world(charge.range * 0.5, 0, 0, 0);
  let dashes = 0;
  let wasDashing = false;
  const seconds = charge.windup + charge.duration + charge.recover + charge.cooldown;
  for (let i = 0; i < Math.ceil(seconds / DT); i++) {
    stepEnemies(w.pool, DT, w.deps);
    // Игрок стоит на месте, чтобы враг гарантированно рвался снова и снова
    w.player.x = w.e.x + charge.range * 0.5;
    w.player.y = w.e.y;
    const dashing = Math.hypot(w.e.vx, w.e.vy) > w.e.speed * 2;
    if (dashing && !wasDashing) dashes++;
    wasDashing = dashing;
  }
  assert.equal(dashes, 1, `за один полный цикл должен быть ровно один рывок, было ${dashes}`);
});

test('раньше девятой волны не появляется', () => {
  const buf = new Array(64);
  for (const arenaId of cfg.arenas) {
    for (let wave = 1; wave <= 8; wave++) {
      const n = poolForWave(config, arenaId, wave, buf);
      for (let i = 0; i < n; i++) {
        assert.notEqual(buf[i], ID, `${arenaId}: рывкач выпал на волне ${wave}`);
      }
    }
    const n = poolForWave(config, arenaId, 9, buf);
    assert.ok(buf.slice(0, n).includes(ID), `${arenaId}: на девятой волне его нет`);
  }
});

test('без блока charge архетип деградирует в преследование, а не в столб', () => {
  const pool = createPool(2, makeEnemy, resetEnemy);
  const e = pool.spawn();
  const broken = Object.assign({}, cfg);
  delete broken.charge;
  const patched = Object.assign({}, config, {
    enemies: Object.assign({}, config.enemies, { [ID]: broken }),
  });
  initEnemy(e, patched, ID, 9, config.danger[0], 1, null);
  assert.notEqual(e.ai, AI_CHARGER);
  e.x = 300;
  e.y = 0;
  const player = makePlayer(0, 0);
  stepEnemies(pool, DT, {
    config: patched, players: [player], rng: createRng(1),
    fireProjectile() {}, hitPlayer() {},
  });
  assert.ok(e.vx < 0, 'должен хотя бы идти к игроку');
});
