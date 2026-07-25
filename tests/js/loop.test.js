import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoop } from '../../static/js/engine/loop.js';

// Подставной таймер: rAF-колбэки вызываем вручную с точными метками времени.
// dt = 0.0625 (1/16) — точное двоичное число, чтобы не ловить эпсилоны.
function fakeTimers() {
  let cb = null;
  globalThis.requestAnimationFrame = (f) => { cb = f; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  return {
    frame(ts) {
      const f = cb;
      cb = null;
      f(ts);
    },
  };
}

test('аккумулятор делает ровно ожидаемое число шагов', () => {
  const timer = fakeTimers();
  let updates = 0;
  let renders = 0;
  const loop = createLoop({
    dt: 0.0625,
    maxCatchup: 4,
    update: () => { updates++; },
    render: () => { renders++; },
  });

  loop.start();
  assert.equal(loop.running, true);

  timer.frame(0);       // первый кадр — прогрев, delta 0
  assert.equal(updates, 0);
  assert.equal(renders, 1);

  timer.frame(62.5);    // ровно один шаг
  assert.equal(updates, 1);

  timer.frame(187.5);   // +125 мс → 2 шага
  assert.equal(updates, 3);

  timer.frame(218.75);  // +31.25 мс → полшага, шагов нет
  assert.equal(updates, 3);

  timer.frame(250);     // +31.25 мс → суммарно набежал ровно шаг
  assert.equal(updates, 4);
  assert.equal(renders, 5); // render — раз в кадр независимо от шагов

  loop.stop();
  assert.equal(loop.running, false);
});

test('догоняющие шаги не превышают maxCatchup', () => {
  const timer = fakeTimers();
  let updates = 0;
  const loop = createLoop({
    dt: 0.0625,
    maxCatchup: 4,
    update: () => { updates++; },
    render: () => {},
  });

  loop.start();
  timer.frame(0);
  timer.frame(1000); // секунда из фона: 16 шагов накопилось, но потолок — 4
  assert.equal(updates, 4);
  assert.equal(loop.stats.steps, 4);

  timer.frame(1062.5); // избыток отброшен — дальше обычный шаг
  assert.equal(updates, 5);

  loop.stop();
});

test('render получает alpha ∈ [0, 1)', () => {
  const timer = fakeTimers();
  let lastAlpha = -1;
  const loop = createLoop({
    dt: 0.0625,
    maxCatchup: 4,
    update: () => {},
    render: (alpha) => { lastAlpha = alpha; },
  });

  loop.start();
  timer.frame(0);
  timer.frame(31.25); // половина шага → alpha ≈ 0.5
  assert.ok(lastAlpha >= 0 && lastAlpha < 1, `alpha вне [0,1): ${lastAlpha}`);
  assert.ok(Math.abs(lastAlpha - 0.5) < 1e-9, `alpha ≠ 0.5: ${lastAlpha}`);

  loop.stop();
});

test('stop останавливает кадры', () => {
  const timer = fakeTimers();
  let renders = 0;
  const loop = createLoop({
    dt: 0.0625,
    maxCatchup: 4,
    update: () => {},
    render: () => { renders++; },
  });

  loop.start();
  timer.frame(0);
  timer.frame(62.5);
  loop.stop();
  const seen = renders;
  // колбэк после stop не должен ничего рисовать
  try { timer.frame(125); } catch (e) { /* rAF мог не перезапланироваться */ }
  assert.equal(renders, seen);
});
