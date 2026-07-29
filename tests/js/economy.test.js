import test from 'node:test';
import assert from 'node:assert';
import { loadConfig, stubTransport, makePlayers } from './fixture.js';
import { createEconomy, createWallet } from '../../static/js/sim/economy.js';
import { createRun } from '../../static/js/sim/run.js';

const config = loadConfig();
const coop = config.coop;
// лимит передачи задан схемой конфига в секции shop, а не coop
const giftLimit = config.shop.gift_limit_pct;

test('котёл делится поровну между всеми участниками', () => {
  const e = createEconomy(config, 4);
  e.add(400);
  for (const id of [0, 1, 2, 3]) assert.equal(e.shareOf(id), 100);
});

test('траты списываются с личной доли и не трогают чужую', () => {
  const e = createEconomy(config, 4);
  e.add(400);
  assert.ok(e.spend(0, 60));
  assert.equal(e.shareOf(0), 40);
  assert.equal(e.shareOf(1), 100, 'чужая доля не должна меняться');
});

test('нельзя потратить больше своей доли', () => {
  const e = createEconomy(config, 2);
  e.add(100);
  assert.equal(e.shareOf(0), 50);
  assert.equal(e.spend(0, 80), false);
  assert.equal(e.shareOf(0), 50, 'неудачная трата ничего не списывает');
});

test('неистраченное переносится: новый прах добавляется к остатку', () => {
  const e = createEconomy(config, 2);
  e.add(100);
  e.spend(0, 20);
  assert.equal(e.shareOf(0), 30);
  e.add(100);
  assert.equal(e.shareOf(0), 80, '(200/2) − 20');
});

test('дроп праха компенсирует деление котла по ИЗМЕРЕННОМУ росту убийств', () => {
  const solo = createEconomy(config, 1);
  assert.equal(solo.dropMultiplier(), 1);
  assert.equal(solo.dropChance(), 1, 'в соло дроп не разыгрывается вовсе');
  for (let n = 2; n <= coop.max_players; n++) {
    const e = createEconomy(config, n);
    const want = (n / coop.kill_scale[n - 1]) * coop.ash_share_target;
    assert.ok(Math.abs(e.dropMultiplier() - want) < 1e-9, `состав ${n}`);
  }
});

// Регресс п.4 «в коопе слишком много денег» и его продолжение после инженерии.
//
// Первая версия множила прах на ash_per_player поверх роста спавна, и восьмером на
// брата выходило ~3.4 дохода соло. Вторая брала компенсацию из ПЛАНОВОГО роста
// спавна — но доход зависит не от того, сколько врагов выпущено, а от того,
// сколько убито, и доля дожития падает с ростом комнаты. Считаем по измеренному
// росту убийств: он и есть та величина, которую компенсация обязана погасить.
test('личный доход в коопе равен соло при любом составе', () => {
  const soloKills = 100;                       // столько убийств делает один игрок за волну
  for (let n = 1; n <= coop.max_players; n++) {
    const e = createEconomy(config, n);
    const kills = soloKills * e.killScale();   // всего убийств в комнате
    // Матожидание дропа: доля убийств, с которых он падает, × размер кучки
    e.add(kills * e.dropChance() * e.dropAmount());
    const share = e.shareOf(0);
    assert.ok(Math.abs(share - soloKills) < 1e-6,
      `состав ${n}: доля ${share.toFixed(1)} против соло ${soloKills}`);
  }
});

test('урезаем частотой дропа, а не размером кучки', () => {
  for (let n = 2; n <= coop.max_players; n++) {
    const e = createEconomy(config, n);
    const f = e.dropMultiplier();
    assert.ok(Math.abs(e.dropChance() * e.dropAmount() - f) < 1e-9,
      `состав ${n}: матожидание разъехалось с множителем`);
    if (f < 1) {
      assert.equal(e.dropAmount(), 1,
        `состав ${n}: кучка урезана — игроку это видно как обман, режем частоту`);
      assert.ok(e.dropChance() < 1);
    }
  }
});

test('таблица роста убийств покрывает все составы и растёт', () => {
  const curve = coop.kill_scale;
  assert.equal(curve.length, coop.max_players,
    'на каждый состав нужна своя строка: интерполяция тут — выдумка');
  assert.equal(curve[0], 1, 'соло — точка отсчёта');
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i] > curve[i - 1],
      `${i + 1} игроков убивают не больше, чем ${i} — таблица испорчена`);
    assert.ok(curve[i] <= i + 1 + 4,
      `рост убийств ${curve[i]} при ${i + 1} игроках выглядит опечаткой`);
  }
});

// Регресс п.16 «при выходе из магазина возвращаются все потраченные деньги».
// Причина была в том, что лавка меняла player.ash напрямую, economy.spend не вызывался
// ниоткуда, и следующий же подобранный прах пересчитывал баланс из нетронутого котла.
test('трата переживает пополнение котла и не возвращается', () => {
  const e = createEconomy(config, 1);
  const wallet = createWallet(e, null);
  const p = { id: 0 };
  e.add(100);
  assert.equal(wallet.balance(p), 100);
  assert.ok(wallet.spend(p, 35));
  assert.equal(wallet.balance(p), 65);
  e.add(10);                                   // подобрали прах на следующей волне
  assert.equal(wallet.balance(p), 75, 'потраченное не должно возвращаться');
});

test('продажа возвращает деньги только продавцу', () => {
  const e = createEconomy(config, 2);
  const wallet = createWallet(e, null);
  const a = { id: 0 };
  const b = { id: 1 };
  e.add(200);                                  // по 100 каждому
  assert.ok(wallet.spend(a, 60));
  wallet.add(a, 30);
  assert.equal(wallet.balance(a), 70);
  assert.equal(wallet.balance(b), 100, 'чужая доля не должна меняться');
});

test('выбывание штрафует котёл на death_penalty', () => {
  const e = createEconomy(config, 4);
  e.add(1000);
  const before = e.shareOf(0);
  e.onDeath();
  const after = e.shareOf(0);
  assert.ok(Math.abs(after - before * (1 - coop.death_penalty)) < 1e-9);
});

test('передача праха ограничена долей отправителя', () => {
  const e = createEconomy(config, 2);
  e.add(200);                       // по 100 каждому
  const given = e.gift(0, 1, 1000);
  assert.ok(Math.abs(given - 100 * giftLimit) < 1e-9,
    'больше лимита передать нельзя');
  assert.ok(Math.abs(e.shareOf(0) - (100 - given)) < 1e-9);
  assert.ok(Math.abs(e.shareOf(1) - (100 + given)) < 1e-9);
});

test('в соло передача праха не работает', () => {
  const e = createEconomy(config, 1);
  e.add(100);
  assert.equal(e.gift(0, 0, 50), 0);
});

// --- живой забег ------------------------------------------------------------
//
// Формулы выше можно свести и на бумаге. Здесь проверяется, что они доезжают до
// пола: прах с убийства идёт через жребий в damageEnemy, и любая правка этого
// места (например «а давайте всё-таки урежем размер кучки») тихо разъедет
// матожидание с моделью.

// Волна поздняя: на ранних спавн-бюджет мал, и за минуту набирается два десятка
// убийств — на таком счёте жребий дропа даёт разброс больше измеряемой величины.
const WAVE = 12;

function killRun(players, seed, ticks) {
  const config2 = loadConfig();
  const run = createRun({
    config: config2, seed, transport: stubTransport(),
    players: makePlayers(players, 'ch_pilgrim'), arena: 'ar_hive', danger: 1,
  });
  run.startWave(WAVE);
  // Бессмертие ЧЕРЕЗ ЧИТ, а не «поднимем после шага»: игрок гибнет внутри
  // run.step, и та же step тут же завершает забег по «никого не осталось» —
  // воскрешать после неё поздно, фаза уже over и спавн стоит.
  for (const p of run.state.players) run.cheatGodMode(p.id, true);
  const dt = config2.sim.dt;
  // Игроков ставим на их собственные установки и держим там. Без этого стоящий
  // столбом игрок собирает толпу вдали от своих турелей и за сорок секунд не
  // набирает и десятка убийств — мерить было бы нечего. Кайт-бот сюда тащить
  // незачем: он живёт в tools/ и решает другую задачу.
  const seat = [];
  for (let k = 0; k < run.turretPool.count; k++) {
    const t = run.turretPool.items[k];
    if (seat[t.ownerIdx] === undefined) seat[t.ownerIdx] = k;
  }
  for (let i = 0; i < ticks; i++) {
    for (let k = 0; k < run.state.players.length; k++) {
      const t = run.turretPool.items[seat[k]];
      if (!t) continue;
      run.state.players[k].x = t.x;
      run.state.players[k].y = t.y;
    }
    // Волна не должна кончиться посреди замера: спавн идёт только в ней
    if (run.state.phase === 'wave') run.state.phaseTime = 999;
    run.step(dt);
  }
  return { kills: run.state.kills, ash: run.state.ash_gained, run };
}

test('прах на убийство в коопе урезан ровно во столько, во сколько модель обещает', () => {
  const TICKS = 60 * 120;
  const solo = killRun(1, 4242, TICKS);
  assert.ok(solo.kills > 120, `соло убил всего ${solo.kills} — мерить нечего`);
  const soloPerKill = solo.ash / solo.kills;

  for (const n of [4, 8]) {
    const coopRun = killRun(n, 4242, TICKS);
    assert.ok(coopRun.kills > 400, `состав ${n}: убийств ${coopRun.kills}`);
    const perKill = coopRun.ash / coopRun.kills;
    const want = coopRun.run.economy.dropMultiplier();
    const got = perKill / soloPerKill;
    // Жребий даёт разброс: на сотнях убийств 25% — с запасом. Ловим не точность,
    // а порядок: если кто-то уберёт компенсацию, отношение станет 1.0.
    assert.ok(Math.abs(got / want - 1) < 0.25,
      `состав ${n}: прах на убийство ${got.toFixed(2)} от соло при обещанных ${want.toFixed(2)}`);
  }
});

test('когда компенсация меньше единицы — режется частота, а не размер кучки', () => {
  // Текущая калибровка даёт восьмерым фактор больше единицы (кучки крупнее), и
  // на живом конфиге урезание не наступает вовсе. Механизм от этого не перестаёт
  // быть нужным: стоит вырасти плотности огня — и фактор уйдёт под единицу.
  // Поэтому режим воспроизводим синтетическим конфигом, а не ждём его от баланса.
  const cfg = loadConfig();
  cfg.coop = Object.assign({}, cfg.coop, {
    kill_scale: cfg.coop.kill_scale.map((v, i) => (i === 0 ? 1 : v * 3)),
  });
  const e = createEconomy(cfg, 8);
  assert.ok(e.dropMultiplier() < 1, 'синтетика не загнала фактор под единицу');
  assert.ok(e.dropChance() < 1, 'частота дропа не урезана');
  assert.equal(e.dropAmount(), 1, 'урезан размер кучки — игроку это видно как обман');

  // И на живом забеге: средний прах с убийства не превышает размер ОДНОЙ
  // полноразмерной кучки самого щедрого врага — значит режется именно частота.
  const run = createRun({
    config: cfg, seed: 777, transport: stubTransport(),
    players: makePlayers(8, 'ch_pilgrim'), arena: 'ar_hive', danger: 1,
  });
  run.startWave(WAVE);
  for (const p of run.state.players) run.cheatGodMode(p.id, true);
  for (let i = 0; i < 60 * 60; i++) {
    if (run.state.phase === 'wave') run.state.phaseTime = 999;
    run.step(cfg.sim.dt);
  }
  assert.ok(run.state.kills > 200, `убийств всего ${run.state.kills}`);
  let richest = 0;
  for (const id in cfg.enemies) {
    if (cfg.enemies[id].ash > richest) richest = cfg.enemies[id].ash;
  }
  const perKill = run.state.ash_gained / run.state.kills;
  const cap = richest * run.economy.dropAmount() * run.danger.ash_mult
    * run.economy.waveMult(WAVE);
  assert.ok(perKill <= cap,
    `${perKill.toFixed(2)} праха с убийства при потолке одной кучки ${cap.toFixed(2)}`);
});
