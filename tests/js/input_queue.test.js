// Очередь сетевого ввода на хосте.
//
// Регресс, ради которого тест написан: хост ЗАЩЁЛКИВАЛ последний пришедший пакет
// и интегрировал защёлку каждый тик, а подтверждал сразу самый свежий ПОЛУЧЕННЫЙ
// номер. По TCP пакеты приходят пачками: пришло два между тиками — первый ни разу
// не побывал в симуляции, но подтверждён вместе со вторым; не пришло ни одного —
// старый ввод проигран дважды, хотя клиент считал его один раз. Клиент выбрасывает
// из переигровки всё не новее ack, и его база разъезжалась с авторитетом на
// один-три тика. Это и есть «резина» в движении подключившегося игрока.
//
// Здесь проверяется сам механизм, без сети: ровно один пакет за тик, ack
// продвигается только на действительно проинтегрированный ввод.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, stubTransport, makePlayers } from './fixture.js';
import { createRun } from '../../static/js/sim/run.js';

const config = loadConfig();
const DT = config.sim.dt;
const QLEN = config.net.input_queue_len;

function makeRun() {
  return createRun({
    config, seed: 4242, transport: stubTransport(),
    players: makePlayers(1, 'ch_pilgrim'), arena: 'ar_hive', danger: 1,
  });
}

// Ввод «как из сети»: с номером пакета. Именно наличие seq включает очередь.
function net(seq, x, y) {
  return { seq, x, y: y === undefined ? 0 : y };
}

test('пакеты снимаются по одному за тик и строго по порядку', () => {
  const run = makeRun();
  const p = run.state.players[0];

  run.applyInput(p.id, net(1, 1, 0));
  run.applyInput(p.id, net(2, 0, 1));
  run.applyInput(p.id, net(3, -1, 0));
  assert.equal(p.inQ.count, 3, 'все три пакета должны лечь в очередь, а не затереть друг друга');

  run.step(DT);
  assert.equal(p.lastInputSeq, 1);
  assert.ok(p.input.x > 0.99, `первый пакет: x=${p.input.x}`);

  run.step(DT);
  assert.equal(p.lastInputSeq, 2);
  assert.ok(p.input.y > 0.99, `второй пакет: y=${p.input.y}`);

  run.step(DT);
  assert.equal(p.lastInputSeq, 3);
  assert.ok(p.input.x < -0.99, `третий пакет: x=${p.input.x}`);
  assert.equal(p.inQ.count, 0);
});

test('ack продвигается ровно на один пакет за тик, а не на самый свежий полученный', () => {
  const run = makeRun();
  const p = run.state.players[0];

  // Пачка из пяти — ровно тот случай, на котором ломалась защёлка
  for (let s = 1; s <= 5; s++) run.applyInput(p.id, net(s, 1, 0));

  const seen = [];
  for (let i = 0; i < 5; i++) {
    run.step(DT);
    seen.push(p.lastInputSeq);
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5],
    'ack обязан идти по одному на тик: иначе клиент выбросит из переигровки ' +
    'кадры, которые хост не применял');
});

test('при голоде очереди ввод сохраняется, а ack стоит на месте', () => {
  const run = makeRun();
  const p = run.state.players[0];

  run.applyInput(p.id, net(7, 1, 0));
  run.step(DT);
  assert.equal(p.lastInputSeq, 7);

  const xBefore = p.x;
  // Три тика без единого пакета: сеть моргнула
  for (let i = 0; i < 3; i++) run.step(DT);

  assert.equal(p.lastInputSeq, 7, 'подтверждать нечего — пакетов не было');
  assert.ok(p.input.x > 0.99, 'ввод не обнуляется: одиночная потеря не должна давать заминку');
  assert.ok(p.x > xBefore, 'игрок продолжает двигаться прежним вводом');
});

test('переполнение выбрасывает самые старые пакеты, а не отказывает новым', () => {
  const run = makeRun();
  const p = run.state.players[0];

  // Кладём на три больше, чем влезает. Различаем пакеты по знаку x.
  const total = QLEN + 3;
  for (let s = 1; s <= total; s++) run.applyInput(p.id, net(s, s <= 3 ? -1 : 1, 0));

  assert.equal(p.inQ.count, QLEN, 'очередь не должна расти сверх своей длины');

  run.step(DT);
  // Выброшены первые три (x = -1), значит первым снятым будет четвёртый
  assert.equal(p.lastInputSeq, 4,
    'под перегрузкой важнее не отстать от игрока: копить старьё — это ' +
    'добавленная задержка управления');
  assert.ok(p.input.x > 0.99);
});

test('дубликаты и опоздавшие пакеты отбрасываются', () => {
  const run = makeRun();
  const p = run.state.players[0];

  run.applyInput(p.id, net(10, 1, 0));
  run.applyInput(p.id, net(10, -1, 0));    // дубликат
  run.applyInput(p.id, net(9, -1, 0));     // опоздавший
  run.applyInput(p.id, net(4, -1, 0));     // сильно опоздавший
  assert.equal(p.inQ.count, 1, 'в очередь должен пройти только первый');

  run.step(DT);
  assert.equal(p.lastInputSeq, 10);
  assert.ok(p.input.x > 0.99, 'опоздавший пакет не должен был перебить свежий');
});

test('16-битные номера переживают заворот', () => {
  const run = makeRun();
  const p = run.state.players[0];

  run.applyInput(p.id, net(65534, 1, 0));
  run.applyInput(p.id, net(65535, 1, 0));
  run.applyInput(p.id, net(0, 1, 0));      // заворот: это НОВЕЕ, а не «древнее»
  run.applyInput(p.id, net(1, 1, 0));
  assert.equal(p.inQ.count, 4, 'заворот номера не должен выглядеть как опоздавший пакет');

  for (let i = 0; i < 3; i++) run.step(DT);
  assert.equal(p.lastInputSeq, 0, 'третьим снимается пакет с номером 0 после заворота');
});

test('ввод без номера идёт мимо очереди: это локальный путь соло и хоста', () => {
  const run = makeRun();
  const p = run.state.players[0];

  // main.js у хоста и в соло кладёт {id, x, y} напрямую, без seq. Задержки нет,
  // сам с собой хост не сверяется, а игровой цикл может прокрутить несколько
  // шагов за кадр — очередь он бы просто выел.
  run.applyInput(p.id, { x: 1, y: 0 });
  assert.equal(p.inQ.count, 0, 'локальный ввод не должен попадать в очередь');
  assert.ok(p.input.x > 0.99, 'он применяется сразу');

  const ackBefore = p.lastInputSeq;
  run.step(DT);
  assert.equal(p.lastInputSeq, ackBefore, 'подтверждать локальный ввод не перед кем');
});

test('очередь мертвеца не копится', () => {
  const run = makeRun();
  const p = run.state.players[0];
  p.alive = false;

  for (let s = 1; s <= 4; s++) run.applyInput(p.id, net(s, 1, 0));
  for (let i = 0; i < 4; i++) run.step(DT);

  assert.equal(p.inQ.count, 0,
    'иначе после воскрешения игрок проигрывает чужое прошлое, а ack всё это ' +
    'время стоит и список переигровки у клиента растёт без предела');
  assert.equal(p.lastInputSeq, 4, 'ack продолжает идти: клиенту есть что подтверждать');
});
