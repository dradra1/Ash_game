// Предсказание движения у кооп-клиента: хост и клиент гоняются в одном процессе
// через транспорт с искусственной задержкой, без браузера и без сокетов.
//
// Регресс, ради которого тест написан: у подключившегося игрока движение было
// «желейным» — отпустил клавишу, а персонаж ещё возит вперёд-назад. Клиент считал
// ошибку предсказания как «позиция хоста минус наша позиция В МОМЕНТ ОТПРАВКИ
// подтверждённого ввода». Эти точки не совпадают даже при идеальной сети: получив
// ввод, хост крутит его ещё несколько тиков, пока не приедет следующий. Эта разница
// раз за разом утекала в поправку, толкая игрока вперёд на ходу и назад после
// остановки. Теперь клиент не подтягивается к присланной точке, а ПЕРЕСОБИРАЕТ
// предсказание от неё, заново проигрывая неподтверждённый ввод.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './fixture.js';
import { createRng } from '../../static/js/engine/rng.js';
import { CH } from '../../static/js/net/transport.js';
import { createRun } from '../../static/js/sim/run.js';
import { createHost } from '../../static/js/net/host.js';
import { createNetClient } from '../../static/js/net/client.js';
import { buildArenaLayout, createPropIndex } from '../../static/js/sim/arena.js';

const config = loadConfig();
const DT = config.sim.dt;
const SEED = 909;
const CHAR = 'ch_pilgrim';

// Пара транспортов с задержкой в обе стороны. Доставка — по явному pump(), чтобы
// прогон был детерминированным: никаких таймеров и никакого реального времени.
//
// jitterFrames — дрожание доставки: реальный TCP отдаёт пакеты не ровным
// ручейком, а задерживает и склеивает в пачки. Моделируется сдвигом времени
// доставки на rng.int(0, jitterFrames); порядок внутри направления при этом
// СОХРАНЯЕТСЯ (at = max(lastAt + 1, ...)) — TCP пакеты не переставляет, иначе
// это была бы модель UDP, а чиним мы не её. Рандом — из engine/rng.js с
// фиксированным сидом, прогон детерминирован.
function makeLink(latencyFrames, jitterFrames) {
  const jit = jitterFrames || 0;
  const rng = createRng(20260727);
  const hostSubs = {};
  const clientSubs = {};
  for (const k in CH) { hostSubs[CH[k]] = []; clientSubs[CH[k]] = []; }
  const queue = [];              // {at, subs, ch, payload}
  let now = 0;

  // Своё lastAt на каждое из двух направлений: склейка пачек не должна
  // разворачивать пакеты задом наперёд.
  //
  // Именно max(lastAt, ...), а НЕ max(lastAt + 1, ...): TCP сохраняет порядок,
  // но доставляет пачку в один момент, а не по одному пакету за кадр. С «+1»
  // хост, шлющий за кадр и снапшот, и событие, разгонял бы lastAt быстрее now,
  // и задержка снапшотов копилась бы без предела — это была бы модель канала с
  // пропускной способностью в один пакет за кадр, а не дрожания доставки.
  function deliverTo(subs) {
    let lastAt = -1;
    return function (ch, payload) {
      const at = Math.max(lastAt, now + latencyFrames + rng.int(0, jit));
      lastAt = at;
      queue.push({ at, subs, ch, payload });
    };
  }
  const toClient = deliverTo(clientSubs);
  const toHost = deliverTo(hostSubs);

  const hostTransport = {
    role: 'host', id: 0, isHost: true,
    send(ch, payload) { toClient(ch, payload); },
    on(ch, cb) { hostSubs[ch].push(cb); },
    off(ch, cb) {
      const i = hostSubs[ch].indexOf(cb);
      if (i >= 0) hostSubs[ch].splice(i, 1);
    },
    close() {},
  };

  const clientTransport = {
    role: 'client', id: 1, isHost: false,
    send(ch, payload) { toHost(ch, payload); },
    on(ch, cb) { clientSubs[ch].push(cb); },
    off(ch, cb) {
      const i = clientSubs[ch].indexOf(cb);
      if (i >= 0) clientSubs[ch].splice(i, 1);
    },
    close() {},
  };

  function pump() {
    now++;
    // Вперёд по очереди, а не назад: за один pump может созреть целая пачка,
    // и доставить её надо в порядке отправки, как это делает TCP.
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].at > now) continue;
      const m = queue.splice(i, 1)[0];
      i--;
      const list = m.subs[m.ch];
      for (let k = 0; k < list.length; k++) list[k](m.payload, 0);
    }
  }

  return { hostTransport, clientTransport, pump };
}

// Прогон: клиент держит ввод holdSec, отпускает, ещё tailSec стоит.
// Возвращает след позиции своего персонажа ПОСЛЕ отпускания.
function runTrace(latencyFrames, holdSec, tailSec, jitterFrames) {
  const link = makeLink(latencyFrames, jitterFrames);
  const players = [
    { id: 0, name: 'host', character: CHAR },
    { id: 1, name: 'guest', character: CHAR },
  ];
  const run = createRun({
    config, seed: SEED, transport: link.hostTransport, players,
    arena: 'ar_hive', danger: 0, curses: [],
  });
  const hostNet = createHost(run, link.hostTransport, config);

  const layout = buildArenaLayout(config, 'ar_hive', SEED, run.arenaW, run.arenaH);
  const client = createNetClient(link.clientTransport, config, 1,
    createPropIndex(layout, config), run.arenaW, run.arenaH);

  const input = { x: 0, y: 0 };
  const me = run.state.players[1];
  const speed = me.speed;
  const trace = [];
  const holdFrames = Math.round(holdSec / DT);
  const tailFrames = Math.round(tailSec / DT);

  for (let f = 0; f < holdFrames + tailFrames; f++) {
    input.x = f < holdFrames ? 1 : 0;
    input.y = 0;
    client.step(DT, input, client.state.players[1] ? client.state.players[1].speed : speed);
    run.step(DT);
    hostNet.step(DT);
    link.pump();
    if (f >= holdFrames) {
      const p = client.state.players[1];
      trace.push({ x: p.x, hostX: run.state.players[1].x });
    }
  }
  return trace;
}

// Метрики считаем в пикселях, а не в «сменах знака с порогом эпсилон»: важно не то,
// дрогнул ли последний бит координаты, а видно ли это игроку. Ориентир —
// один тик движения (скорость × dt ≈ 1.7 px): меньше него рендер всё равно
// округляет к целому пикселю.
function totalBack(trace) {
  let sum = 0;
  for (let i = 1; i < trace.length; i++) {
    const d = trace[i].x - trace[i - 1].x;
    if (d < 0) sum -= d;
  }
  return sum;
}

// Размах в «устоявшемся» хвосте: то, что игрок видит как продолжающееся шевеление
function settledSwing(trace, fromFrac) {
  const from = Math.floor(trace.length * (fromFrac === undefined ? 0.4 : fromFrac));
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = from; i < trace.length; i++) {
    if (trace[i].x < lo) lo = trace[i].x;
    if (trace[i].x > hi) hi = trace[i].x;
  }
  return hi - lo;
}

// Сетка прогонов: ровная задержка (как раньше) и дрожащая доставка — пакеты
// пачками, как TCP под нагрузкой. Именно пачки воспроизводят баг с защёлкой
// ввода на хосте: первый пакет пачки подтверждался, ни разу не побывав в
// симуляции, а в тихие кадры старый ввод крутился дважды.
const CASES = [[1, 0], [5, 0], [10, 0], [1, 2], [5, 2], [10, 2], [5, 4], [10, 4]];

test('после отпускания клавиши персонаж останавливается, а не ездит назад', () => {
  for (const [lat, jit] of CASES) {         // задержка ~16–160 мс + дрожание
    const trace = runTrace(lat, 1.0, 1.0, jit);
    const back = totalBack(trace);
    // Тормозной путь назад — это ровно то, на что жаловались: «отпустил, а он
    // ещё возит вперёд-назад». До правки здесь набегало больше десяти пикселей.
    assert.ok(back < 2,
      `задержка ${lat} + дрожание ${jit}: уехал назад на ${back.toFixed(1)} px`);
  }
});

test('через треть секунды после отпускания клиент стоит намертво', () => {
  for (const [lat, jit] of CASES) {
    const swing = settledSwing(runTrace(lat, 1.0, 1.0, jit));
    // Порог меньше одного тика движения: остаточная дрожь предсказания не может
    // быть больше, чем «хост успел применить подтверждённый ввод на тик больше».
    assert.ok(swing < 1,
      `задержка ${lat} + дрожание ${jit}: размах ${swing.toFixed(2)} px`);
  }
});

test('клиент останавливается там же, где хост, и не уползает', () => {
  for (const jit of [0, 2, 4]) {
    const trace = runTrace(5, 1.0, 1.0, jit);
    const last = trace[trace.length - 1];
    assert.ok(Math.abs(last.x - last.hostX) < 2,
      `дрожание ${jit}: клиент ${last.x.toFixed(1)}, хост ${last.hostX.toFixed(1)}`);
    // И остановка должна быть окончательной: за последние полсекунды — ни шага
    const half = trace[Math.floor(trace.length / 2)];
    assert.ok(Math.abs(last.x - half.x) < 1,
      `дрожание ${jit}: после остановки ещё ползёт: ` +
      `${(last.x - half.x).toFixed(2)} px за полсекунды`);
  }
});

test('на ходу предсказание не отстаёт от хоста', () => {
  // Тот же прогон, но смотрим ХВОСТ удержания: клиент обязан быть примерно там же,
  // где авторитет, иначе игрок целится и подходит к врагу не туда, где он на самом деле.
  for (const jit of [0, 2, 4]) {
    const link = makeLink(5, jit);
    const players = [
      { id: 0, name: 'host', character: CHAR },
      { id: 1, name: 'guest', character: CHAR },
    ];
    const run = createRun({
      config, seed: SEED, transport: link.hostTransport, players,
      arena: 'ar_hive', danger: 0, curses: [],
    });
    const hostNet = createHost(run, link.hostTransport, config);
    const layout = buildArenaLayout(config, 'ar_hive', SEED, run.arenaW, run.arenaH);
    const client = createNetClient(link.clientTransport, config, 1,
      createPropIndex(layout, config), run.arenaW, run.arenaH);

    const input = { x: 1, y: 0 };
    let worst = 0;
    for (let f = 0; f < 120; f++) {
      client.step(DT, input, run.state.players[1].speed);
      run.step(DT);
      hostNet.step(DT);
      link.pump();
      if (f > 30) {
        const d = Math.abs(client.state.players[1].x - run.state.players[1].x);
        if (d > worst) worst = d;
      }
    }
    // Клиент по определению впереди: он не ждёт подтверждения. Но опережение обязано
    // держаться в пределах задержки, а не расти.
    assert.ok(worst < 40,
      `дрожание ${jit}: расхождение на ходу доросло до ${worst.toFixed(1)} px`);
  }
});
