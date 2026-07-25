import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrid } from '../../static/js/engine/grid.js';

function has(out, n, id) {
  for (let i = 0; i < n; i++) if (out[i] === id) return true;
  return false;
}

test('точки в радиусе находятся, за радиусом — нет', () => {
  const g = createGrid(48, 1600, 1200);
  const out = new Int32Array(16);
  g.insert(1, 100, 100);
  g.insert(2, 500, 500);
  const n = g.query(100, 100, 10, out);
  assert.equal(n, 1);
  assert.ok(has(out, n, 1));
  assert.ok(!has(out, n, 2));
});

test('query отсекает по расстоянию, а не только по ячейке', () => {
  const g = createGrid(48, 1600, 1200);
  const out = new Int32Array(16);
  g.insert(1, 100, 100);
  // центр запроса в соседней точке той же ячейки, но за пределами радиуса
  const n = g.query(130, 100, 10, out);
  assert.equal(n, 0);
});

test('query на границе радиуса включает точку', () => {
  const g = createGrid(48, 1600, 1200);
  const out = new Int32Array(16);
  g.insert(7, 110, 100);
  const n = g.query(100, 100, 10, out);
  assert.equal(n, 1);
  assert.ok(has(out, n, 7));
});

test('query не выходит за out.length', () => {
  const g = createGrid(48, 1600, 1200);
  const out = new Int32Array(3);
  for (let i = 0; i < 20; i++) g.insert(i, 100 + i, 100);
  const n = g.query(110, 100, 40, out);
  assert.equal(n, 3);
});

test('queryRect находит точки в прямоугольнике', () => {
  const g = createGrid(48, 1600, 1200);
  const out = new Int32Array(16);
  g.insert(1, 100, 100);
  g.insert(2, 200, 200);
  g.insert(3, 800, 800);
  const n = g.queryRect(50, 50, 200, 200, out);
  assert.equal(n, 2);
  assert.ok(has(out, n, 1));
  assert.ok(has(out, n, 2));
  assert.ok(!has(out, n, 3));
});

test('координаты за пределами сетки клампятся в крайнюю ячейку', () => {
  const g = createGrid(48, 1600, 1200);
  const out = new Int32Array(16);
  g.insert(9, -50, -50);       // ячейка клампится в (0,0), позиция хранится как есть
  g.insert(10, 99999, 99999);  // ячейка клампится в последнюю
  const n = g.query(-50, -50, 10, out);
  assert.equal(n, 1);
  assert.ok(has(out, n, 9));
  const n2 = g.query(99999, 99999, 10, out);
  assert.equal(n2, 1);
  assert.ok(has(out, n2, 10));
});

test('повторный clear+insert не течёт', () => {
  const g = createGrid(48, 1600, 1200);
  const out = new Int32Array(16);
  for (let cycle = 0; cycle < 1000; cycle++) {
    g.clear();
    g.insert(1, 100, 100);
    g.insert(2, 105, 100);
    const n = g.query(100, 100, 10, out);
    assert.equal(n, 2);
  }
  g.clear();
  assert.equal(g.query(100, 100, 100, out), 0);
});

test('переполнение ячейки отбрасывает лишнее, сетка не падает', () => {
  const g = createGrid(48, 1600, 1200);
  const out = new Int32Array(128);
  for (let i = 0; i < 200; i++) g.insert(i, 100, 100); // все в одну ячейку
  const n = g.query(100, 100, 10, out);
  assert.ok(n <= 64, `в ячейке больше ёмкости: ${n}`);
  assert.ok(n > 0);
});
