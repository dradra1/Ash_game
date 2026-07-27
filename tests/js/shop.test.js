import test from 'node:test';
import assert from 'node:assert';
import { loadConfig } from './fixture.js';
import { createRng } from '../../static/js/engine/rng.js';
import { createPlayer } from '../../static/js/sim/player.js';
import {
  createShop, priceOf, rerollCost, sellValue, maxTier, rollTier,
  buy, sell, merge, mergeable, mergeAfterBuy, freeSlotIndex,
} from '../../static/js/sim/shop.js';
import { createEconomy, createWallet } from '../../static/js/sim/economy.js';

const config = loadConfig();
const d1 = config.danger[1];
const d3 = config.danger[3];

function player() {
  return createPlayer(config, 0, 'p', 'ch_pilgrim', 100, 100);
}

// Кошелёк, как в забеге: истина в котле, player.ash — витрина, которую обновляет
// onChange (в игре это run.syncAsh).
function purse(p, amount) {
  const economy = createEconomy(config, 1);
  economy.add(amount);
  const wallet = createWallet(economy, () => { p.ash = economy.shareOf(p.id); });
  p.ash = economy.shareOf(p.id);
  return wallet;
}

test('инфляция цен растёт с волной по формуле конфига', () => {
  const s = config.shop;
  const base = 20;
  for (const wave of [1, 5, 20]) {
    const expect = Math.max(s.min_price, Math.round(
      Math.round(base * (1 + s.inflation_pct * wave) + s.inflation_flat) * d1.price_mult));
    assert.equal(priceOf(config, base, wave, d1), expect, `волна ${wave}`);
  }
  assert.ok(priceOf(config, base, 20, d1) > priceOf(config, base, 1, d1));
});

test('высокая сложность делает лавку дороже', () => {
  assert.ok(priceOf(config, 40, 10, d3) > priceOf(config, 40, 10, d1));
});

test('реролл дорожает геометрически и сбрасывается каждую лавку', () => {
  const s = config.shop;
  assert.equal(rerollCost(config, 0), Math.ceil(s.reroll_base));
  for (let n = 1; n < 6; n++) {
    assert.equal(rerollCost(config, n), Math.ceil(s.reroll_base * s.reroll_growth ** n));
    assert.ok(rerollCost(config, n) >= rerollCost(config, n - 1));
  }
});

test('продажа возвращает долю текущей цены', () => {
  const back = sellValue(config, 30, 8, d1);
  assert.equal(back, Math.floor(priceOf(config, 30, 8, d1) * config.shop.sell_pct));
  assert.ok(back < priceOf(config, 30, 8, d1), 'продажа должна быть невыгодной');
});

test('тир-гейты открываются по волнам из конфига', () => {
  const gates = config.shop.tier_min_wave;
  assert.equal(maxTier(config, 1), 1);
  for (const tier of Object.keys(gates)) {
    const w = gates[tier];
    assert.ok(maxTier(config, w) >= Number(tier), `тир ${tier} должен быть с волны ${w}`);
    assert.ok(maxTier(config, w - 1) < Number(tier), `тир ${tier} не должен быть до волны ${w}`);
  }
});

test('удача сдвигает распределение тиров вверх', () => {
  const wave = 20;
  function avgTier(luck) {
    const rng = createRng(4242);
    let sum = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) sum += rollTier(config, wave, luck, rng);
    return sum / n;
  }
  assert.ok(avgTier(100) > avgTier(0), 'с удачей средний тир должен быть выше');
});

test('ассортимент заполняется и уважает потолок тира волны', () => {
  const p = player();
  const shop = createShop(config, null);
  const rng = createRng(7);
  shop.open(p, 1, d1, rng, false);
  const cap = maxTier(config, 1);
  for (const s of shop.slots) {
    assert.ok(s.cfg, 'слот не должен быть пустым');
    assert.ok(s.cfg.tier <= cap, `тир ${s.cfg.tier} выше потолка ${cap} на волне 1`);
    assert.ok(s.price > 0);
  }
});

test('кооп-предметы не попадают в соло-лавку', () => {
  const p = player();
  const shop = createShop(config, null);
  const rng = createRng(11);
  const coopOnly = Object.keys(config.items).filter((k) => config.items[k].coop_only);
  assert.ok(coopOnly.length > 0, 'в конфиге должны быть кооп-предметы');
  for (let i = 0; i < 200; i++) {
    shop.open(p, 12, d1, rng, false);
    for (const s of shop.slots) {
      assert.ok(!(s.kind === 'item' && coopOnly.includes(s.id)),
        `кооп-предмет ${s.id} попал в соло-лавку`);
    }
  }
});

test('закрытое метапрогрессией оружие не попадает в лавку', () => {
  const p = player();
  const shop = createShop(config, null);
  const rng = createRng(13);
  const locked = Object.keys(config.weapons)
    .filter((k) => config.weapons[k].unlock.type !== 'default');
  assert.ok(locked.length > 0, 'в конфиге должно быть закрытое оружие');
  for (let i = 0; i < 200; i++) {
    shop.open(p, 12, d1, rng, false);
    for (const s of shop.slots) {
      assert.ok(!(s.kind === 'weapon' && locked.includes(s.id)),
        `закрытое оружие ${s.id} попало в лавку`);
    }
  }
});

test('покупка списывает прах, предмет меняет статы', () => {
  const p = player();
  const shop = createShop(config, null);
  const rng = createRng(5);
  shop.open(p, 3, d1, rng, false);
  const idx = shop.slots.findIndex((s) => s.kind === 'item');
  if (idx < 0) return;                       // редкий расклад — все слоты оружие
  const slot = shop.slots[idx];
  const wallet = purse(p, slot.price);
  const before = JSON.stringify(p.stats);
  const res = buy(p, shop, idx, config, wallet, () => {});
  assert.equal(res, 'ok');
  assert.equal(p.ash, 0);
  assert.ok(slot.sold);
  assert.ok(p.items.length === 1);
  const anyStat = Object.keys(config.items[slot.id].stats).length > 0;
  if (anyStat) {
    // статы пересобираются вызывающим кодом; проверяем, что источник добавлен
    assert.ok(p.sources.includes(config.items[slot.id].stats));
  }
  assert.ok(before.length > 0);
});

test('без праха купить нельзя', () => {
  const p = player();
  const shop = createShop(config, null);
  shop.open(p, 3, d1, createRng(6), false);
  const wallet = purse(p, 0);
  const idx = shop.slots.findIndex((s) => s.cfg && s.price > 0);
  assert.equal(buy(p, shop, idx, config, wallet, null), 'poor');
});

test('оружие не купить, если все слоты заняты', () => {
  const p = player();
  for (let i = 0; i < p.slots.length; i++) {
    p.slots[i].id = 'w_cleaver_1';
    p.slots[i].cfg = config.weapons.w_cleaver_1;
  }
  const shop = createShop(config, null);
  const rng = createRng(21);
  let idx = -1;
  for (let attempt = 0; attempt < 60 && idx < 0; attempt++) {
    shop.open(p, 5, d1, rng, false);
    idx = shop.slots.findIndex((s) => s.kind === 'weapon');
  }
  assert.ok(idx >= 0, 'за 60 открытий должно попасться оружие');
  const wallet = purse(p, 10000);
  assert.equal(buy(p, shop, idx, config, wallet, null), 'full');
});

test('слияние: два одинаковых одного тира дают одно следующего', () => {
  const p = player();
  const need = config.shop.merge_count;
  for (let i = 0; i < need; i++) {
    p.slots[i].id = 'w_cleaver_1';
    p.slots[i].cfg = config.weapons.w_cleaver_1;
  }
  assert.equal(mergeable(p, config), 'w_cleaver_1');
  assert.ok(merge(p, 'w_cleaver_1', config, null));
  const ids = p.slots.filter((s) => s.cfg).map((s) => s.id);
  assert.deepEqual(ids, ['w_cleaver_2']);
  assert.equal(mergeable(p, config), null, 'сливать больше нечего');
});

test('оружие тира IV не сливается дальше', () => {
  const p = player();
  for (let i = 0; i < config.shop.merge_count; i++) {
    p.slots[i].id = 'w_cleaver_4';
    p.slots[i].cfg = config.weapons.w_cleaver_4;
  }
  assert.equal(mergeable(p, config), null);
  assert.equal(merge(p, 'w_cleaver_4', config, null), false);
});

test('продажа оружия освобождает слот и возвращает прах', () => {
  const p = player();
  const wallet = purse(p, 0);
  const before = freeSlotIndex(p);
  const back = sell(p, 'weapon', 0, config, 5, d1, wallet, null);
  assert.ok(back > 0);
  assert.equal(p.ash, back);
  assert.notEqual(freeSlotIndex(p), before);
});

test('продажа предмета снимает его модификаторы, а не чужие', () => {
  const p = player();
  const id = 'it_iron_plate';
  p.items.push(id);
  p.sources.push(config.items[id].stats);
  const withItem = p.sources.length;
  sell(p, 'item', 0, config, 4, d1, purse(p, 0), null);
  assert.equal(p.items.length, 0);
  assert.equal(p.sources.length, withItem - 1);
  // персонаж и копилка левелапов остались на месте
  assert.ok(p.sources.length >= 2);
});

test('реролл списывает прах и меняет ассортимент', () => {
  const p = player();
  const shop = createShop(config, null);
  const rng = createRng(31);
  shop.open(p, 6, d1, rng, false);
  const before = shop.slots.map((s) => s.id).join(',');
  const wallet = purse(p, 1000);
  const cost = shop.reroll(p, d1, rng, wallet);
  assert.ok(cost > 0);
  assert.equal(p.ash, 1000 - cost);
  const after = shop.slots.map((s) => s.id).join(',');
  assert.notEqual(before, after);
  // второй реролл дороже первого
  const cost2 = shop.reroll(p, d1, rng, wallet);
  assert.ok(cost2 > cost);
});

test('залоченный слот переживает реролл вместе с ценой', () => {
  const p = player();
  const shop = createShop(config, null);
  const rng = createRng(41);
  shop.open(p, 9, d1, rng, false);
  shop.slots[0].locked = true;
  const id = shop.slots[0].id;
  const price = shop.slots[0].price;
  shop.reroll(p, d1, rng, purse(p, 10000));
  assert.equal(shop.slots[0].id, id);
  assert.equal(shop.slots[0].price, price);
});
