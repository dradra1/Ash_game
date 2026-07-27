// Десятина: плоская выплата в котёл на старте каждой волны.
//
// Раньше стат был долей от праха каждого убитого — прибавка растворялась в дропе, и
// проверить её можно было только сравнением средних. Теперь это отдельная строка
// дохода, и на неё ложатся точные проверки: сколько начислено, когда и кому.
//
// Главное, что тут охраняется, — три вещи, которые ломаются молча:
//  1) первая волна не проходит через startWave (её состояние задано литералом), и
//     выплату на ней легко потерять;
//  2) выплата обязана попадать в ash_gained, иначе сервер и ачивки её не увидят;
//  3) в коопе доход на голову не должен расти от числа игроков (ТЗ §3.8).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, stubTransport, makePlayers } from './fixture.js';
import { createRun } from '../../static/js/sim/run.js';

const config = loadConfig();
const SCALE = config.stats.tithe_scale;
// Персонаж со стартовой десятиной: единственный источник праха в тестах ниже,
// потому что забег не шагает и врагов никто не убивает.
const TITHED = 'ch_scavenger';
const TITHE = config.characters[TITHED].stats.tithe;
const PLAIN = 'ch_pilgrim';

function newRun(character, count) {
  return createRun({
    config, seed: 4242, transport: stubTransport(),
    players: makePlayers(count || 1, character),
    arena: 'ar_hive', danger: 0, curses: [],
  });
}

test('в конфиге есть персонаж с десятиной, иначе тест ничего не проверяет', () => {
  assert.ok(TITHE > 0, `${TITHED} остался без десятины`);
});

test('выплата на первой волне равна стату', () => {
  const run = newRun(TITHED);
  assert.equal(run.economy.state.pot, TITHE * SCALE);
  assert.equal(run.state.players[0].ash, TITHE * SCALE);
});

test('без десятины на старте пусто', () => {
  assert.equal(newRun(PLAIN).economy.state.pot, 0);
});

test('каждая следующая волна платит столько же', () => {
  const run = newRun(TITHED);
  for (let wave = 2; wave <= 5; wave++) {
    run.startWave(wave);
    assert.equal(run.economy.state.pot, TITHE * SCALE * wave,
      `после старта волны ${wave}`);
  }
});

test('выплата идёт в ash_gained — её видят сервер и ачивки', () => {
  const run = newRun(TITHED);
  assert.equal(run.state.ash_gained, TITHE * SCALE);
  run.startWave(2);
  assert.equal(run.state.ash_gained, TITHE * SCALE * 2);
});

test('десятина растёт вместе со статом, а не живёт своей жизнью', () => {
  const run = newRun(TITHED);
  const p = run.state.players[0];
  p.stats.tithe = TITHE * 3;
  const before = run.economy.state.pot;
  run.startWave(2);
  assert.equal(run.economy.state.pot - before, TITHE * 3 * SCALE);
});

// Ключевой кооп-инвариант. Компенсировать деление котла тут НЕ надо, в отличие от
// дропа с убийств: доход персональный, сумма по игрокам делится обратно на N.
// Если кто-нибудь добавит сюда dropMultiplier, восьмером станет вчетверо богаче.
test('в коопе на голову ровно столько же, сколько соло', () => {
  for (const n of [1, 2, 4, 8]) {
    const run = newRun(TITHED, n);
    assert.equal(run.economy.state.pot, TITHE * SCALE * n, `котёл при ${n} игроках`);
    for (let i = 0; i < n; i++) {
      assert.equal(run.economy.shareOf(i), TITHE * SCALE,
        `доля игрока ${i} при ${n} игроках`);
    }
  }
});

test('смешанный состав: каждый получает среднее по комнате, а не чужую десятину', () => {
  const run = createRun({
    config, seed: 7, transport: stubTransport(),
    players: [
      { id: 0, name: 'a', character: TITHED },
      { id: 1, name: 'b', character: PLAIN },
    ],
    arena: 'ar_hive', danger: 0, curses: [],
  });
  // Котёл общий по ТЗ §3.8 — десятина богатого делится на всех, как любой прах
  assert.equal(run.economy.state.pot, TITHE * SCALE);
  assert.equal(run.economy.shareOf(0), (TITHE * SCALE) / 2);
  assert.equal(run.economy.shareOf(1), (TITHE * SCALE) / 2);
});
