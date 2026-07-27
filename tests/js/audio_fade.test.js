// Кривые фейдов музыки. Тест без DOM: проверяется только арифметика громкости,
// но именно она решает, звучит ли переход провалом или рывком.
//
// Почему кривых две. Кроссфейд (старый трек гасим, новый поднимаем) и появление из
// тишины — разные задачи. Линейный кроссфейд проваливается на середине: два
// некоррелированных трека по 0.5 амплитуды дают суммарную мощность 0.5, а не 1.
// Кривая равной мощности это чинит, но для старта с нуля она звучит рывком —
// на десятой доле фейда уже 16% громкости.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossUp, crossDown, fadeIn } from '../../static/js/engine/audio.js';
import { loadConfig } from './fixture.js';

const config = loadConfig();

test('обе кривые начинаются и заканчиваются ровно', () => {
  assert.equal(crossUp(0), 0);
  assert.equal(crossUp(1), 1);
  assert.equal(crossDown(0), 1);
  assert.equal(crossDown(1), 0);
  assert.equal(fadeIn(0), 0);
  assert.equal(fadeIn(1), 1);
});

test('кроссфейд держит суммарную мощность — нет провала на середине', () => {
  for (let i = 0; i <= 20; i++) {
    const k = i / 20;
    const power = crossUp(k) ** 2 + crossDown(k) ** 2;
    assert.ok(Math.abs(power - 1) < 1e-9, `на k=${k} мощность ${power}`);
  }
  // Для сравнения: у линейного сведения на середине именно провал
  assert.ok(0.5 ** 2 + 0.5 ** 2 < 0.9, 'линейное сведение внезапно перестало проваливаться');
});

test('появление из тишины начинается тише, чем кривая кроссфейда', () => {
  // Это и есть «плавный фейд-ин»: первую четверть трек почти не слышно
  assert.ok(fadeIn(0.1) < crossUp(0.1) / 2, 'старт слишком громкий');
  assert.ok(fadeIn(0.25) < 0.1);
});

test('обе кривые монотонны', () => {
  let up = -1;
  let down = 2;
  let inn = -1;
  for (let i = 0; i <= 50; i++) {
    const k = i / 50;
    assert.ok(crossUp(k) >= up, `crossUp упал на k=${k}`);
    assert.ok(crossDown(k) <= down, `crossDown вырос на k=${k}`);
    assert.ok(fadeIn(k) >= inn, `fadeIn упал на k=${k}`);
    up = crossUp(k);
    down = crossDown(k);
    inn = fadeIn(k);
  }
});

test('за пределы [0,1] кривые не выходят и не дают NaN', () => {
  for (const k of [-5, -0.1, 1.1, 42, 0]) {
    for (const f of [crossUp, crossDown, fadeIn]) {
      const v = f(k);
      assert.ok(v >= 0 && v <= 1 && !Number.isNaN(v), `${f.name}(${k}) = ${v}`);
    }
  }
});

test('длительности фейдов заданы конфигом, а не кодом', () => {
  const a = config.audio;
  assert.ok(a.fade_ms > 0, 'audio.fade_ms не задан');
  assert.ok(a.wave_fade_ms > a.fade_ms,
    'вход в волну обязан быть длиннее обычной смены темы');
});

// Файлы выровнены по EBU R128 (tools/normalize_audio.py), поэтому поправки на
// мастеринг больше не нужны. Если кто-то вернёт gain < 1 «на глаз», громкости
// снова разъедутся — и заметно это будет только ушами.
test('поправки громкости у треков нейтральны', () => {
  for (const id in config.audio.tracks) {
    const g = config.audio.tracks[id].gain;
    assert.equal(g, 1, `${id}: gain ${g} — файлы уже выровнены`);
  }
});
