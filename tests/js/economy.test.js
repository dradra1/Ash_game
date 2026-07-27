import test from 'node:test';
import assert from 'node:assert';
import { loadConfig } from './fixture.js';
import { createEconomy, createWallet } from '../../static/js/sim/economy.js';

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
    const budgetScale = 1 + coop.budget_per_player * (n - 1);
    const want = (n / budgetScale) * coop.ash_share_target;
    assert.ok(Math.abs(e.dropMultiplier() - want) < 1e-9, `состав ${n}`);
  }
});

// Регресс п.4 «в коопе слишком много денег»: раньше spawn умножал число врагов на
// budget_per_player, а дроп ДОПОЛНИТЕЛЬНО на ash_per_player, и при восьмерых на брата
// выходило ~3.4 дохода соло. Доход на голову обязан совпадать с соло при любом составе.
test('личный доход в коопе равен соло при любом составе', () => {
  const soloKills = 100;                       // столько убийств делает один игрок за волну
  for (const n of [1, 2, 4, 8]) {
    const e = createEconomy(config, n);
    // кооп поднимает и число врагов: убийств столько же на брата, но всего больше
    const budgetScale = 1 + coop.budget_per_player * (n - 1);
    e.add(soloKills * budgetScale * e.dropMultiplier());
    const share = e.shareOf(0);
    assert.ok(Math.abs(share - soloKills) < 1e-6,
      `состав ${n}: доля ${share.toFixed(1)} против соло ${soloKills}`);
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
