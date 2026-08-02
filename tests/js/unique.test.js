// Уникальные особенности персонажей: слоты, счёт синергий, правила лавки.
//
// Что ломается молча:
//   — слоты берутся из config.run.weapon_slots мимо особенности, и Обетник
//     играет шестью стволами, а Барон Хлама — шестью из десяти;
//   — фильтр лавки применён к покупке, но не к подбору: в ассортименте висит
//     карточка, которую нельзя купить (или наоборот);
//   — счёт синергий забыл про set_count/full_sets/сдвиг порога, и панель лавки
//     показывает пороги, которых нет в статах;
//   — печати Реликвария копятся без лимита или не копятся вовсе;
//   — статы от лоадаута (per_weapon) не пересчитались после продажи;
//   — правки задели обычных персонажей: у Пилигрима те же шесть слотов.

import test from 'node:test';
import assert from 'node:assert';
import { loadConfig } from './fixture.js';
import { createRng } from '../../static/js/engine/rng.js';
import { createPlayer, refreshStats } from '../../static/js/sim/player.js';
import { equip } from '../../static/js/sim/weapon.js';
import { slotCount } from '../../static/js/sim/unique.js';
import {
  createShop, buy, sell, merge, mergeable, mergeAfterBuy, maxTier, priceOf, sellValue,
} from '../../static/js/sim/shop.js';
import { createEconomy, createWallet } from '../../static/js/sim/economy.js';
import { shopSnapshot, remoteAdapter } from '../../static/js/ui/shop_adapter.js';

const config = loadConfig();
const syn = config.synergies;
const d1 = config.danger[1];

function player(id) {
  return createPlayer(config, 0, 'p', id, 100, 100);
}

function bare(id) {
  const p = player(id);
  for (const s of p.slots) { s.id = null; s.cfg = null; }
  refreshStats(p, config);
  return p;
}

function purse(p, amount) {
  const economy = createEconomy(config, 1);
  economy.add(amount);
  const wallet = createWallet(economy, () => { p.ash = economy.shareOf(p.id); });
  p.ash = economy.shareOf(p.id);
  return wallet;
}

function armId(p, id, n) {
  for (let i = 0; i < n; i++) equip(p.slots[i], id, config);
  refreshStats(p, config);
}

// Сумма статовых бонусов всех сетов ствола на порогах не выше th
function modsUpTo(id, th) {
  const cfg = config.weapons[id];
  const sets = [syn.classes[cfg.class], ...(cfg.tags || []).map((tg) => syn.tags[tg])];
  const out = {};
  for (const tiers of sets) {
    for (const t in tiers) {
      if (+t > th || tiers[t].special) continue;
      for (const k in tiers[t]) out[k] = (out[k] || 0) + tiers[t][k];
    }
  }
  return out;
}

const DEFAULT_WEAPONS = Object.keys(config.weapons)
  .filter((k) => config.weapons[k].unlock.type === 'default');

// --- слоты ------------------------------------------------------------------

test('число слотов задаёт особенность персонажа, а не только конфиг забега', () => {
  assert.equal(slotCount(config, 'ch_pilgrim'), config.run.weapon_slots);
  assert.equal(slotCount(config, 'ch_oathkeeper'), 1);
  assert.equal(slotCount(config, 'ch_riftbound'), 3);
  assert.equal(slotCount(config, 'ch_barrowsmith'), 4);
  assert.equal(slotCount(config, 'ch_reliquary'), 5);
  assert.equal(slotCount(config, 'ch_junkbaron'), 10);
  for (const id of ['ch_pilgrim', 'ch_oathkeeper', 'ch_junkbaron']) {
    assert.equal(player(id).slots.length, slotCount(config, id), id);
  }
});

test('стартовое оружие влезает в слоты каждому персонажу', () => {
  for (const id in config.characters) {
    const c = config.characters[id];
    assert.ok(c.start_weapons.length <= slotCount(config, id), id);
    const p = player(id);
    let armed = 0;
    for (const s of p.slots) if (s.cfg) armed++;
    assert.equal(armed, c.start_weapons.length, id);
  }
});

// --- синергии ---------------------------------------------------------------

test('set_count: у Разломного три ствола дают шестой порог', () => {
  const p = bare('ch_riftbound');
  const id = 'w_rod_1';
  armId(p, id, 3);
  const cfg = config.weapons[id];
  assert.equal(p.synergy.counts[cfg.class], 6);
  assert.equal(p.synergy.extraPierce, 2 * syn.specials.extra_pierce.pierce,
    'класс elem и тег warp должны дать по пробитию');
});

test('обычному персонажу три ствола шестого порога не дают', () => {
  const p = bare('ch_pilgrim');
  armId(p, 'w_rod_1', 3);
  assert.equal(p.synergy.counts.elem, 3);
  assert.equal(p.synergy.extraPierce, 0);
});

test('full_sets: Разнобою хватает одного ствола на весь сет', () => {
  const p = bare('ch_discordant');
  const id = 'w_stilettos_1';
  armId(p, id, 1);
  const want = modsUpTo(id, 6);
  for (const k in want) assert.equal(p.synergy.mods[k] || 0, want[k], k);
  assert.equal(p.synergy.critDmgMult, syn.specials.crit_boost.mult,
    'тег precise должен открыть спец шестого порога');
});

test('threshold_shift: у Калибровщика пороги 1/3/5', () => {
  const p = bare('ch_calibrator');
  const id = 'w_carbine_1';
  armId(p, id, 1);
  const at2 = modsUpTo(id, 2);
  for (const k in at2) assert.equal(p.synergy.mods[k] || 0, at2[k], `1 ствол: ${k}`);
  armId(p, id, 3);
  const at4 = modsUpTo(id, 4);
  for (const k in at4) assert.equal(p.synergy.mods[k] || 0, at4[k], `3 ствола: ${k}`);
  armId(p, id, 5);
  assert.ok(p.synergy.extraShots > 0, '5 стволов должны дать спец шестого порога');
});

test('печати Реликвария: проданное считается в синергиях и не копится сверх лимита', () => {
  const p = bare('ch_reliquary');
  const wallet = purse(p, 0);
  armId(p, 'w_hammer_1', 1);
  const before = p.synergy.counts.melee;
  sell(p, 'weapon', 0, config, 1, d1, wallet, () => refreshStats(p, config));
  assert.equal(p.synergy.counts.melee, before, 'печать должна заменить проданный ствол');

  const limit = config.characters.ch_reliquary.unique.synergy_memory;
  for (let i = 0; i < limit + 4; i++) {
    equip(p.slots[0], 'w_hammer_1', config);
    sell(p, 'weapon', 0, config, 1, d1, wallet, () => refreshStats(p, config));
  }
  assert.equal(p.retired.length, limit);
});

test('без памяти проданное оружие из синергий исчезает', () => {
  const p = bare('ch_pilgrim');
  const wallet = purse(p, 0);
  armId(p, 'w_hammer_1', 1);
  sell(p, 'weapon', 0, config, 1, d1, wallet, () => refreshStats(p, config));
  assert.equal(p.retired.length, 0);
  assert.equal(p.synergy.counts.melee, 0);
});

// --- статы от лоадаута ------------------------------------------------------

test('per_weapon: Носитель Роя ускоряется с каждым стволом и замедляется после продажи', () => {
  const p = bare('ch_swarmcarrier');
  const per = config.characters.ch_swarmcarrier.unique.per_weapon;
  const base = p.stats.attack_speed_pct;
  armId(p, 'w_claws_1', 4);
  const withSyn = p.synergy.mods.attack_speed_pct || 0;
  assert.equal(p.stats.attack_speed_pct, base + withSyn + per.attack_speed_pct * 4);
  armId(p, 'w_claws_1', 4);
  p.slots[3].id = null;
  p.slots[3].cfg = null;
  refreshStats(p, config);
  assert.equal(p.uniqMods.attack_speed_pct, per.attack_speed_pct * 3);
});

test('per_distinct_tag: Разноликому платят за разные теги, а не за число стволов', () => {
  const per = config.characters.ch_manyfaced.unique.per_distinct_tag;
  const same = bare('ch_manyfaced');
  armId(same, 'w_pike_1', 3);
  const tags = config.weapons.w_pike_1.tags.length;
  assert.equal(same.uniqMods.damage_pct, per.damage_pct * tags);

  const mixed = bare('ch_manyfaced');
  equip(mixed.slots[0], 'w_pike_1', config);
  equip(mixed.slots[1], 'w_turret_1', config);
  refreshStats(mixed, config);
  const distinct = new Set([...config.weapons.w_pike_1.tags,
    ...config.weapons.w_turret_1.tags]).size;
  assert.equal(mixed.uniqMods.damage_pct, per.damage_pct * distinct);
  assert.ok(distinct > tags, 'второй ствол должен принести новые теги');
});

// --- лавка ------------------------------------------------------------------

// Слоты лавки переиспользуются между открытиями, поэтому наружу отдаём снимок:
// ссылка на слот к моменту проверки была бы уже перезаполнена другим товаром.
function offers(charId, wave, n) {
  const p = player(charId);
  const shop = createShop(config, null);
  const rng = createRng(99);
  const out = [];
  for (let i = 0; i < n; i++) {
    shop.open(p, wave, d1, rng, false);
    for (const s of shop.slots) {
      if (s.kind === 'weapon') out.push({ id: s.id, cfg: s.cfg, price: s.price });
    }
  }
  return { p, shop, out };
}

test('class_lock: Носителю Роя лавка предлагает только ближнее', () => {
  const { out } = offers('ch_swarmcarrier', 12, 60);
  assert.ok(out.length > 0, 'оружие в ассортименте должно попадаться');
  for (const s of out) assert.equal(s.cfg.class, 'melee', s.id);
});

test('tag_lock: Калибровщику лавка предлагает только огнестрел', () => {
  const { out } = offers('ch_calibrator', 12, 60);
  assert.ok(out.length > 0);
  for (const s of out) assert.ok(s.cfg.tags.includes('gun'), s.id);
});

test('shop_max_tier: Барону Хлама не продают выше второго тира', () => {
  const { out } = offers('ch_junkbaron', 20, 60);
  assert.ok(maxTier(config, 20) > 2, 'на 20 волне обычно доступны высокие тиры');
  assert.ok(out.length > 0);
  for (const s of out) assert.ok(s.cfg.tier <= 2, `${s.id} тир ${s.cfg.tier}`);
});

test('shop_tier_bonus и наценка: Кузнец видит высокие тиры с первой волны и платит больше', () => {
  const { out } = offers('ch_barrowsmith', 1, 60);
  const cap = maxTier(config, 1);
  const high = out.filter((s) => s.cfg.tier > cap);
  assert.ok(high.length > 0, 'на первой волне должны попадаться тиры выше обычного потолка');
  const mult = config.characters.ch_barrowsmith.unique.weapon_price_mult;
  for (const s of high) {
    assert.equal(s.price, Math.round(priceOf(config, s.cfg.price, 1, d1) * mult));
  }
});

test('no_duplicates: Разнобою не предлагают то, что уже одето, и не продают', () => {
  const p = player('ch_discordant');
  const held = p.slots[0].id;
  const shop = createShop(config, null);
  const rng = createRng(5);
  for (let i = 0; i < 60; i++) {
    shop.open(p, 12, d1, rng, false);
    for (const s of shop.slots) {
      assert.ok(!(s.kind === 'weapon' && s.id === held), 'дубликат в ассортименте');
    }
  }
  // Прямая покупка дубликата тоже должна отказать, а не занять слот
  const wallet = purse(p, 10000);
  shop.slots[0].kind = 'weapon';
  shop.slots[0].id = held;
  shop.slots[0].cfg = config.weapons[held];
  shop.slots[0].price = 1;
  shop.slots[0].sold = false;
  assert.equal(buy(p, shop, 0, config, wallet, null, false), 'dupe');
  assert.equal(p.ash, 10000, 'за отказ платить не должны');
});

test('free_pair: Двоедушный получает вторую копию бесплатно', () => {
  const p = bare('ch_twinsoul');
  const shop = createShop(config, null);
  const rng = createRng(3);
  shop.open(p, 5, d1, rng, false);
  const wallet = purse(p, 10000);
  const slot = shop.slots.find((s) => s.kind === 'weapon');
  assert.ok(slot, 'в ассортименте должно быть оружие');
  const before = p.ash;
  assert.equal(buy(p, shop, shop.slots.indexOf(slot), config, wallet, null, false), 'ok');
  let copies = 0;
  for (const s of p.slots) if (s.id === slot.id) copies++;
  assert.equal(copies, 2);
  assert.equal(p.ash, before - slot.price, 'вторая копия должна быть бесплатной');
});

test('no_merge: пару Двоедушного и разнобой Разнобоя слить нельзя', () => {
  for (const id of ['ch_twinsoul', 'ch_discordant']) {
    const p = bare(id);
    armId(p, 'w_cleaver_1', config.shop.merge_count);
    assert.equal(mergeable(p, config), null, id);
    assert.equal(merge(p, 'w_cleaver_1', config, null), false, id);
    assert.ok(p.slots[0].cfg, `${id}: слияние не должно съедать стволы`);
  }
});

test('обычному персонажу слияние по-прежнему доступно', () => {
  const p = bare('ch_pilgrim');
  armId(p, 'w_cleaver_1', config.shop.merge_count);
  assert.equal(mergeable(p, config), 'w_cleaver_1');
  assert.equal(merge(p, 'w_cleaver_1', config, null), true);
  assert.equal(p.slots[0].id, config.weapons.w_cleaver_1.next_tier);
});

test('одному слоту слияние не обещают: копия легла бы поверх единственной', () => {
  const p = player('ch_oathkeeper');
  const held = p.slots[0].id;
  const slot = { kind: 'weapon', id: held, cfg: config.weapons[held], sold: false };
  assert.ok(config.weapons[held].next_tier, 'у стартового ствола должен быть следующий тир');
  assert.equal(mergeAfterBuy(p, slot, config), false);
});

test('при полных слотах слияние обещают, только когда копий уже хватает', () => {
  const p = bare('ch_pilgrim');
  const need = config.shop.merge_count;
  // Все слоты заняты, но копий на слияние ещё не хватает
  for (let i = 0; i < p.slots.length; i++) {
    equip(p.slots[i], i < need - 1 ? 'w_cleaver_1' : 'w_hammer_1', config);
  }
  const slot = { kind: 'weapon', id: 'w_cleaver_1', cfg: config.weapons.w_cleaver_1, sold: false };
  assert.equal(mergeAfterBuy(p, slot, config), false);
  // А когда хватает — покупка ложится поверх копии, слияние их и заберёт
  for (let i = 0; i < need; i++) equip(p.slots[i], 'w_cleaver_1', config);
  assert.equal(mergeAfterBuy(p, slot, config), true);
});

test('replace_on_full: покупка Обетника меняет ствол и возвращает прах', () => {
  const p = player('ch_oathkeeper');
  const old = p.slots[0].cfg;
  const shop = createShop(config, null);
  const rng = createRng(17);
  shop.open(p, 5, d1, rng, false);
  const wallet = purse(p, 10000);
  const idx = shop.slots.findIndex((s) => s.kind === 'weapon' && s.id !== p.slots[0].id);
  assert.ok(idx >= 0, 'в ассортименте должно быть другое оружие');
  const bought = shop.slots[idx];
  const before = p.ash;
  assert.equal(buy(p, shop, idx, config, wallet, null, false), 'ok');
  assert.equal(p.slots.length, 1);
  assert.equal(p.slots[0].id, bought.id);
  assert.equal(p.ash, before - bought.price + sellValue(config, old.price, 5, d1));
});

test('без replace_on_full полные слоты по-прежнему отказывают', () => {
  const p = player('ch_pilgrim');
  for (const s of p.slots) equip(s, 'w_cleaver_1', config);
  const shop = createShop(config, null);
  const rng = createRng(19);
  shop.open(p, 5, d1, rng, false);
  const wallet = purse(p, 10000);
  const idx = shop.slots.findIndex((s) => s.kind === 'weapon' && s.id !== 'w_cleaver_1');
  assert.ok(idx >= 0, 'в ассортименте должно быть другое оружие');
  assert.equal(buy(p, shop, idx, config, wallet, null, false), 'full');
});

// --- кооп -------------------------------------------------------------------

test('счёт синергий и особенность доезжают до кооп-клиента', () => {
  const p = bare('ch_riftbound');
  armId(p, 'w_rod_1', 3);
  const shop = createShop(config, null);
  const run = {
    state: { players: [p], ready: {}, wave: 4 },
  };
  const snap = shopSnapshot(run, p, shop, config);
  assert.deepEqual(snap.counts, p.synergy.counts);
  assert.equal(snap.uniq, p.uniq);

  // Панель синергий у клиента читает те же поля из своего игрока-заглушки
  const remote = remoteAdapter(() => snap, () => {});
  const mirror = remote.player();
  assert.equal(mirror.synergy.counts.elem, p.synergy.counts.elem);
  assert.equal(mirror.uniq.set_count, 2);
});

// --- контент ----------------------------------------------------------------

test('у каждой особенности есть описание в обеих локалях', () => {
  for (const id in config.characters) {
    const u = config.characters[id].unique;
    if (!u || !u.type) continue;
    if (!ENGINE_TYPES.has(u.type)) continue;
    for (const lang of ['ru', 'en']) {
      assert.ok(config.i18n[lang]['ui.unique.' + u.type],
        `${id}: нет ui.unique.${u.type} в ${lang}`);
    }
  }
});

test('фильтры лавки не запирают персонажа наглухо: открытое оружие для них есть', () => {
  for (const id in config.characters) {
    const u = config.characters[id].unique;
    if (!u || (!u.shop_class && !u.shop_tag)) continue;
    const fit = DEFAULT_WEAPONS.filter((w) => {
      const cfg = config.weapons[w];
      if (u.shop_class && cfg.class !== u.shop_class) return false;
      if (u.shop_tag && !cfg.tags.includes(u.shop_tag)) return false;
      return cfg.tier === 1;
    });
    assert.ok(fit.length >= 2, `${id}: под фильтр подходит меньше двух стволов первого тира`);
  }
});

// Особенности, которые реально читает движок: остальные объявлены в конфиге до
// его появления и намеренно ничего не делают (см. sim/unique.js).
const ENGINE_TYPES = new Set(['single_oath', 'many_slots', 'tag_lock', 'class_lock',
  'few_heavy', 'distinct_tags', 'synergy_memory_seals', 'high_tier', 'no_twins',
  'paired_buy']);
