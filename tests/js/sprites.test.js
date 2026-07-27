// Раскладка спрайт-листов. Тест без DOM: считается только арифметика кадра, но
// именно она и ломалась.
//
// Регресс: в drawSheet стояла догадка «квадратная картинка — одиночный спрайт»
// (её добавили ради ломаемых объектов арены 32×32). Лист ходьбы из 4 кадров ×
// 4 направлений ТОЖЕ квадратный — 192×192 у людей, 448×448 и 512×512 у боссов, —
// и весь лист целиком впечатывался в одну клетку: игрок и враги на бегу
// превращались в сетку из шестнадцати миниатюр. Одиночные картинки теперь рисует
// отдельный путь (renderer.drawObject), а sheetFrame догадок не делает.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sheetFrame } from '../../static/js/engine/sprites.js';

const here = dirname(fileURLToPath(import.meta.url));
const TEXTURES = join(here, '../../static/textures');

test('квадратный лист ходьбы режется на кадры, а не рисуется целиком', () => {
  const r = sheetFrame(192, 192, 0, 0);
  assert.equal(r.side, 48, 'сторона кадра — высота/4');
  assert.equal(r.frames, 4);
  assert.ok(r.side < 192, 'кадр обязан быть меньше листа');
});

test('строка листа выбирается направлением, столбец — номером кадра', () => {
  const r = sheetFrame(192, 192, 2, 3);
  assert.equal(r.sy, 96, 'третья строка = dir 2 × 48');
  assert.equal(r.sx, 144, 'четвёртый кадр = 3 × 48');
});

test('номер кадра закольцовывается в обе стороны', () => {
  assert.equal(sheetFrame(192, 192, 0, 4).sx, 0, 'кадр 4 из 4 — снова первый');
  assert.equal(sheetFrame(192, 192, 0, 9).sx, 48);
  assert.equal(sheetFrame(192, 192, 0, -1).sx, 144, 'отрицательный не даёт NaN');
});

test('направление за пределами четырёх заворачивается, а не уезжает за лист', () => {
  for (let dir = 0; dir < 16; dir++) {
    const r = sheetFrame(192, 192, dir, 0);
    assert.ok(r.sy >= 0 && r.sy + r.side <= 192, `dir ${dir} вышел за лист`);
  }
});

test('лист без ходьбы (один кадр на направление) режется так же', () => {
  const r = sheetFrame(48, 192, 3, 0);
  assert.equal(r.side, 48);
  assert.equal(r.frames, 1);
  assert.equal(r.sx, 0);
  assert.equal(r.sy, 144);
});

test('пустая картинка не даёт деления на ноль', () => {
  assert.equal(sheetFrame(0, 0, 0, 0), null);
});

// Смысл проверки — не арифметика, а факт: квадратные листы в игре РЕАЛЬНО есть,
// поэтому «квадрат = одиночная картинка» в этом коде не заработает никогда.
test('в игре есть квадратные листы направлений — догадка по форме невозможна', () => {
  const png = readdirSync(TEXTURES).filter((f) => f.endsWith('_walk.png'));
  assert.ok(png.length > 0, 'листов ходьбы нет вовсе');
  let squares = 0;
  for (const name of png) {
    const buf = readFileSync(join(TEXTURES, name));
    // IHDR: ширина и высота — восемь байт со смещения 16
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    assert.equal(h % 4, 0, `${name}: высота ${h} не делится на 4 строки`);
    if (w === h) squares++;
  }
  assert.ok(squares > 0,
    'ни одного квадратного листа — тест перестал охранять то, ради чего написан');
});
