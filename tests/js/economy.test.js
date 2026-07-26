import test from 'node:test';
import assert from 'node:assert';
import { loadConfig } from './fixture.js';
import { createEconomy } from '../../static/js/sim/economy.js';

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

test('дроп праха компенсирует деление котла', () => {
  const solo = createEconomy(config, 1);
  assert.equal(solo.dropMultiplier(), 1);
  for (const n of [2, 4, 8]) {
    const e = createEconomy(config, n);
    assert.ok(Math.abs(e.dropMultiplier() - (1 + coop.ash_per_player * (n - 1))) < 1e-9);
  }
});

test('вдвоём каждый получает меньше, чем соло, но больше половины', () => {
  const duo = createEconomy(config, 2);
  // одинаковое число убийств: соло весь дроп себе, вдвоём — с множителем и пополам
  const kills = 100;
  const soloShare = kills * 1;
  duo.add(kills * duo.dropMultiplier());
  const duoShare = duo.shareOf(0);
  assert.ok(duoShare < soloShare, 'кооп не должен быть богаче на голову');
  assert.ok(duoShare > soloShare / 2, 'но и не вдвое беднее');
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
