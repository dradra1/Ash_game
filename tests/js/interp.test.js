// Интерполяция чужих сущностей у кооп-клиента.
//
// Два регресса, ради которых тест написан.
//
// 1. Враги сопоставлялись по НОМЕРУ ЗАПИСИ в снапшоте, а «тот ли это враг»
//    решалось сравнением uid. Но пул на хосте делает swap-remove при смерти, а
//    отбор видимых сортирует их по дистанции до зрителя — порядок перетасовывается
//    каждый снапшот, сравнение почти всегда ложно, и вместо интерполяции враг
//    жёстко переставлялся в новую точку.
//
// 2. Буфера не было вовсе: клиент тянулся к самому свежему снапшоту ровно за один
//    период. Опоздавший снапшот означал, что сущность доехала до цели и замерла,
//    а потом прыгнула; пришедший раньше срока — скачок скорости.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './fixture.js';
import { CH } from '../../static/js/net/transport.js';
import { createNetClient } from '../../static/js/net/client.js';
import { createSnapshotCodec, buildTypeIndex } from '../../static/js/net/protocol.js';

const config = loadConfig();
const DT = config.sim.dt;
const TYPE = 'e_cultist';
const types = buildTypeIndex(config);
const codec = createSnapshotCodec(config);

// Клиент с транспортом-заглушкой: снапшоты скармливаем руками.
// myIndex = 1, но игрока с таким номером мы не шлём — интересуют враги.
function makeClient() {
  const subs = {};
  const transport = {
    role: 'client', id: 1, isHost: false,
    send() {},
    on(ch, cb) { (subs[ch] || (subs[ch] = [])).push(cb); },
    off() {},
    close() {},
  };
  const client = createNetClient(transport, config, 1, null, 1600, 1200);
  return {
    client,
    feed(enemies) {
      const packed = codec.encode(fakeRun(enemies), 0, 0, 1, types.toIdx);
      for (const cb of subs[CH.SNAPSHOT]) cb(packed.slice(), 0);
    },
  };
}

// Минимальный «мир» под кодек: он читает только эти поля
function fakeRun(enemies) {
  return {
    state: {
      wave: 1, phase: 'wave', phaseTime: 10, paused: false, pot: 0,
      players: [{
        x: 0, y: 0, hp: 1, maxHp: 1, dir: 0, alive: true, level: 1,
        pendingLevels: 0, ash: 0, xp: 0, xpNext: 1, lastInputSeq: 0,
      }],
    },
    enemyPool: { count: enemies.length, items: enemies },
  };
}

function enemy(uid, x, y) {
  return {
    uid, type: TYPE, x, y, hp: 10, maxHp: 10,
    moving: true, telegraph: false,
  };
}

function findByUid(client, uid) {
  for (let i = 0; i < client.enemies.count; i++) {
    if (client.enemies.items[i].uid === uid) return client.enemies.items[i];
  }
  return null;
}

// Прокрутить n кадров без новых снапшотов
function spin(client, n) {
  for (let i = 0; i < n; i++) client.step(DT, { x: 0, y: 0 }, 100);
}

test('враг не телепортируется, когда хост переставил его в снапшоте', () => {
  const { client, feed } = makeClient();
  // Два врага; второй далеко, чтобы перестановка была заметной
  let xa = 100;
  const xb = 900;
  feed([enemy(1, xa, 0), enemy(2, xb, 0)]);
  spin(client, 2);

  let worstStep = 0;
  let prev = null;
  // Каждый снапшот меняем порядок записей местами — ровно то, что делает
  // swap-remove на хосте вместе с сортировкой по дистанции.
  for (let s = 0; s < 20; s++) {
    xa += 6;
    feed(s % 2 === 0 ? [enemy(2, xb, 0), enemy(1, xa, 0)]
      : [enemy(1, xa, 0), enemy(2, xb, 0)]);
    for (let f = 0; f < 2; f++) {
      spin(client, 1);
      const e = findByUid(client, 1);
      assert.ok(e, 'враг uid=1 не должен теряться при перестановке');
      if (prev !== null) {
        const step = Math.abs(e.x - prev);
        if (step > worstStep) worstStep = step;
      }
      prev = e.x;
    }
  }
  // Враг едет 6 px за снапшот, то есть ~3 px за кадр. Прыжок на всю дистанцию
  // перестановки (800 px) — это то, что было до таблицы uid → слот.
  assert.ok(worstStep < 12,
    `шаг за кадр дорос до ${worstStep.toFixed(1)} px — враг телепортируется`);
});

test('исчезнувший враг освобождает слот, соседи не путаются', () => {
  const { client, feed } = makeClient();
  feed([enemy(1, 100, 0), enemy(2, 200, 0), enemy(3, 300, 0)]);
  spin(client, 2);
  assert.equal(client.enemies.count, 3);

  // Средний пропал из поля зрения
  feed([enemy(1, 100, 0), enemy(3, 300, 0)]);
  spin(client, 2);

  assert.equal(client.enemies.count, 2, 'слот исчезнувшего обязан освободиться');
  assert.ok(findByUid(client, 1), 'uid=1 на месте');
  assert.ok(findByUid(client, 3), 'uid=3 на месте');
  assert.equal(findByUid(client, 2), null, 'uid=2 больше нет');
  assert.ok(Math.abs(findByUid(client, 3).x - 300) < 1,
    'уцелевший не должен переехать в чужую позицию');
});

test('неровная доставка не превращается в рывки', () => {
  const { client, feed } = makeClient();
  let x = 100;
  feed([enemy(1, x, 0)]);
  spin(client, 4);

  const steps = [];
  let prev = findByUid(client, 1).x;
  // Снапшоты приходят через 1, 3, 1, 3 кадра, но враг едет равномерно:
  // 2 px на кадр, значит за интервал — пропорционально его длине.
  const gaps = [1, 3, 1, 3, 1, 3, 1, 3, 2, 2, 2, 2];
  for (const gap of gaps) {
    x += 2 * gap;
    feed([enemy(1, x, 0)]);
    for (let f = 0; f < gap; f++) {
      spin(client, 1);
      const e = findByUid(client, 1);
      steps.push(e.x - prev);
      prev = e.x;
    }
  }
  // Ни одного шага назад и ни одной полной остановки посреди движения
  let back = 0;
  let stalls = 0;
  for (const s of steps) {
    if (s < -0.01) back++;
    if (Math.abs(s) < 0.01) stalls++;
  }
  assert.equal(back, 0, 'враг не должен пятиться при неровной доставке');
  assert.ok(stalls <= 2, `замираний ${stalls}: буфер не сглаживает дрожание`);
});

test('экстраполяция ограничена: связь оборвалась — враг встаёт, а не улетает', () => {
  const { client, feed } = makeClient();
  let x = 100;
  for (let s = 0; s < 4; s++) {
    x += 10;
    feed([enemy(1, x, 0)]);
    spin(client, 2);
  }
  const lastSent = x;

  // Полсекунды тишины
  spin(client, 30);
  const e = findByUid(client, 1);
  const over = e.x - lastSent;

  const maxExtra = config.net.interp_max_extrapolate_ms / 1000;
  // Скорость врага 10 px за 2 кадра = 300 px/с; за предел экстраполяции он
  // проедет не больше 300 * maxExtra, плюс запас на квант позиции.
  const limit = 300 * maxExtra + 12;
  assert.ok(over <= limit,
    `улетел на ${over.toFixed(1)} px вперёд при пределе ${limit.toFixed(1)}`);

  // И действительно ВСТАЛ: за последние кадры — ни шага
  const before = e.x;
  spin(client, 10);
  assert.ok(Math.abs(e.x - before) < 0.01,
    `после предела экстраполяции враг обязан замереть, а он проехал ещё ` +
    `${(e.x - before).toFixed(2)} px`);
});

test('новичок появляется сразу в присланной точке, а не выезжает из нуля', () => {
  const { client, feed } = makeClient();
  feed([enemy(42, 500, 300)]);
  const e = findByUid(client, 42);
  assert.ok(e, 'враг должен появиться сразу по приходу снапшота');
  assert.equal(e.x, 500);
  assert.equal(e.y, 300);

  spin(client, 1);
  const after = findByUid(client, 42);
  assert.ok(Math.abs(after.x - 500) < 1 && Math.abs(after.y - 300) < 1,
    `новичок уехал в (${after.x}, ${after.y}) вместо (500, 300)`);
});

test('флаги moving и telegraph доезжают до отображаемого врага', () => {
  const { client, feed } = makeClient();
  const e1 = enemy(1, 100, 0);
  e1.moving = false;
  e1.telegraph = true;
  feed([e1]);
  spin(client, 1);
  const got = findByUid(client, 1);
  assert.equal(got.moving, false);
  assert.equal(got.telegraph, true, 'телеграф рывка обязан быть виден клиенту');
});
