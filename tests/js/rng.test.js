import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../static/js/engine/rng.js';

test('один сид → одинаковая последовательность', () => {
  const a = createRng(123);
  const b = createRng(123);
  for (let i = 0; i < 100; i++) {
    assert.equal(a.next(), b.next());
  }
});

test('разные сиды → разные последовательности', () => {
  const a = createRng(1);
  const b = createRng(2);
  const sa = [];
  const sb = [];
  for (let i = 0; i < 10; i++) {
    sa.push(a.next());
    sb.push(b.next());
  }
  assert.notDeepEqual(sa, sb);
});

test('float ∈ [0, 1)', () => {
  const r = createRng(42);
  for (let i = 0; i < 1000; i++) {
    const v = r.float();
    assert.ok(v >= 0 && v < 1, `float вне диапазона: ${v}`);
  }
});

test('int(a, b) — целое включительно в границах', () => {
  const r = createRng(7);
  let hitMin = false;
  let hitMax = false;
  for (let i = 0; i < 10000; i++) {
    const v = r.int(1, 6);
    assert.ok(Number.isInteger(v));
    assert.ok(v >= 1 && v <= 6, `int вне границ: ${v}`);
    if (v === 1) hitMin = true;
    if (v === 6) hitMax = true;
  }
  assert.ok(hitMin && hitMax, 'границы диапазона не достигались');
});

test('range(a, b) ∈ [a, b)', () => {
  const r = createRng(99);
  for (let i = 0; i < 1000; i++) {
    const v = r.range(-5, 10);
    assert.ok(v >= -5 && v < 10, `range вне диапазона: ${v}`);
  }
});

test('pick не выходит за массив', () => {
  const r = createRng(5);
  const arr = [10, 20, 30, 40, 50];
  for (let i = 0; i < 1000; i++) {
    assert.ok(arr.includes(r.pick(arr)));
  }
});

test('weighted уважает нулевой вес', () => {
  const r = createRng(11);
  const items = ['a', 'b', 'c'];
  const weightOf = (item, i) => (i === 1 ? 0 : 1);
  for (let i = 0; i < 5000; i++) {
    assert.notEqual(r.weighted(items, weightOf), 'b');
  }
});

test('weighted: вся масса у одного элемента', () => {
  const r = createRng(13);
  const items = ['x', 'y', 'z'];
  const weightOf = (item, i) => (i === 2 ? 1 : 0);
  for (let i = 0; i < 100; i++) {
    assert.equal(r.weighted(items, weightOf), 'z');
  }
});

test('fork — независимый детерминированный поток', () => {
  const a = createRng(77);
  a.next();
  const fa = a.fork();

  const b = createRng(77);
  b.next();
  const fb = b.fork();

  // одинаковая история → одинаковый форк
  for (let i = 0; i < 50; i++) {
    assert.equal(fa.next(), fb.next());
  }

  // форк независим от продолжения родителя
  const c = createRng(77);
  c.next();
  const fc = c.fork();
  const parent = [];
  const child = [];
  for (let i = 0; i < 10; i++) {
    parent.push(c.next());
    child.push(fc.next());
  }
  assert.notDeepEqual(parent, child);
});
