import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../../static/js/engine/pool.js';

test('spawn до потолка, затем null — пул не растёт', () => {
  const pool = createPool(3, () => ({}));
  assert.ok(pool.spawn() !== null);
  assert.ok(pool.spawn() !== null);
  assert.ok(pool.spawn() !== null);
  assert.equal(pool.count, 3);
  assert.equal(pool.spawn(), null);
  assert.equal(pool.count, 3);
  assert.equal(pool.items.length, 3);
});

test('spawn прогоняет объект через reset', () => {
  const pool = createPool(1, () => ({ dirty: true }), (o) => { o.dirty = false; });
  const o = pool.spawn();
  assert.equal(o.dirty, false);
});

test('release — swap-remove, count падает', () => {
  const pool = createPool(4, () => ({}));
  const a = pool.spawn();
  pool.spawn();
  const c = pool.spawn();
  assert.equal(pool.count, 3);
  pool.release(0); // освобождаем первый — последний живой едет на его место
  assert.equal(pool.count, 2);
  assert.equal(pool.items[0], c);
  assert.equal(pool.items[2], a); // освобождённый уехал за границу count
});

test('release вне границ — безопасный no-op', () => {
  const pool = createPool(2, () => ({}));
  pool.spawn();
  pool.release(-1);
  pool.release(5);
  assert.equal(pool.count, 1);
});

test('повторный spawn переиспользует объект по ссылке', () => {
  const pool = createPool(2, () => ({}));
  const o = pool.spawn();
  pool.release(0);
  assert.equal(pool.spawn(), o);
});

test('10000 циклов spawn/release — объектов ровно capacity', () => {
  let made = 0;
  const capacity = 8;
  const pool = createPool(capacity, () => ({ n: ++made }));
  for (let i = 0; i < 10000; i++) {
    pool.spawn();
    pool.release(pool.count - 1);
  }
  assert.equal(made, capacity);
  assert.equal(pool.count, 0);
});

test('clear обнуляет живых, объекты остаются переиспользуемыми', () => {
  const pool = createPool(2, () => ({}));
  const a = pool.spawn();
  pool.clear();
  assert.equal(pool.count, 0);
  assert.equal(pool.spawn(), a);
});
