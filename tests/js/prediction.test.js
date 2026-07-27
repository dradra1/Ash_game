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
function makeLink(latencyFrames) {
  const hostSubs = {};
  const clientSubs = {};
  for (const k in CH) { hostSubs[CH[k]] = []; clientSubs[CH[k]] = []; }
  const queue = [];              // {at, subs, ch, payload}
  let now = 0;

  function deliver(subs, ch, payload) {
    queue.push({ at: now + latencyFrames, subs, ch, payload });
  }

  const hostTransport = {
    role: 'host', id: 0, isHost: true,
    send(ch, payload) { deliver(clientSubs, ch, payload); },
    on(ch, cb) { hostSubs[ch].push(cb); },
    off(ch, cb) {
      const i = hostSubs[ch].indexOf(cb);
      if (i >= 0) hostSubs[ch].splice(i, 1);
    },
    close() {},
  };

  const clientTransport = {
    role: 'client', id: 1, isHost: false,
    send(ch, payload) { deliver(hostSubs, ch, payload); },
    on(ch, cb) { clientSubs[ch].push(cb); },
    off(ch, cb) {
      const i = clientSubs[ch].indexOf(cb);
      if (i >= 0) clientSubs[ch].splice(i, 1);
    },
    close() {},
  };

  function pump() {
    now++;
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].at > now) continue;
      const m = queue.splice(i, 1)[0];
      const list = m.subs[m.ch];
      for (let k = 0; k < list.length; k++) list[k](m.payload, 0);
    }
  }

  return { hostTransport, clientTransport, pump };
}

// Прогон: клиент держит ввод holdSec, отпускает, ещё tailSec стоит.
// Возвращает след позиции своего персонажа ПОСЛЕ отпускания.
function runTrace(latencyFrames, holdSec, tailSec) {
  const link = makeLink(latencyFrames);
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

test('после отпускания клавиши персонаж останавливается, а не ездит назад', () => {
  for (const lat of [1, 5, 10]) {           // ~16, 80 и 160 мс задержки
    const trace = runTrace(lat, 1.0, 1.0);
    const back = totalBack(trace);
    // Тормозной путь назад — это ровно то, на что жаловались: «отпустил, а он
    // ещё возит вперёд-назад». До правки здесь набегало больше десяти пикселей.
    assert.ok(back < 2, `задержка ${lat} кадров: уехал назад на ${back.toFixed(1)} px`);
  }
});

test('через треть секунды после отпускания клиент стоит намертво', () => {
  for (const lat of [1, 5, 10]) {
    const swing = settledSwing(runTrace(lat, 1.0, 1.0));
    // Порог меньше одного тика движения: остаточная дрожь предсказания не может
    // быть больше, чем «хост успел применить подтверждённый ввод на тик больше».
    assert.ok(swing < 1, `задержка ${lat} кадров: размах ${swing.toFixed(2)} px`);
  }
});

test('клиент останавливается там же, где хост, и не уползает', () => {
  const trace = runTrace(5, 1.0, 1.0);
  const last = trace[trace.length - 1];
  assert.ok(Math.abs(last.x - last.hostX) < 2,
    `клиент ${last.x.toFixed(1)}, хост ${last.hostX.toFixed(1)}`);
  // И остановка должна быть окончательной: за последние полсекунды — ни шага
  const half = trace[Math.floor(trace.length / 2)];
  assert.ok(Math.abs(last.x - half.x) < 1,
    `после остановки ещё ползёт: ${(last.x - half.x).toFixed(2)} px за полсекунды`);
});

test('на ходу предсказание не отстаёт от хоста', () => {
  // Тот же прогон, но смотрим ХВОСТ удержания: клиент обязан быть примерно там же,
  // где авторитет, иначе игрок целится и подходит к врагу не туда, где он на самом деле.
  const link = makeLink(5);
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
  assert.ok(worst < 40, `расхождение на ходу доросло до ${worst.toFixed(1)} px`);
});
