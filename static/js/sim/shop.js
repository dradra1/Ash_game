// Лавка: ассортимент, цены с инфляцией, реролл, лок слота, продажа, слияние.
//
// Ключ жанра: экономика важнее моторики. Игрок принимает решения здесь, а не в бою,
// поэтому все числа — из конфига и легко перебалансируются.

import { equip } from './weapon.js';

export function priceOf(config, base, wave, danger) {
  const s = config.shop;
  const p = Math.round(base * (1 + s.inflation_pct * wave) + s.inflation_flat)
    * danger.price_mult;
  return Math.max(s.min_price, Math.round(p));
}

export function rerollCost(config, n) {
  return Math.ceil(config.shop.reroll_base * Math.pow(config.shop.reroll_growth, n));
}

export function sellValue(config, base, wave, danger) {
  return Math.max(0, Math.floor(priceOf(config, base, wave, danger) * config.shop.sell_pct));
}

// Разрешённый тир на этой волне: tier_min_wave задаёт, с какой волны тир доступен
export function maxTier(config, wave) {
  let max = 1;
  const gates = config.shop.tier_min_wave;
  for (const tier in gates) {
    if (wave >= gates[tier]) {
      const t = Number(tier);
      if (t > max) max = t;
    }
  }
  return max;
}

// Выбор тира с поправкой на удачу: удача сдвигает распределение к высоким тирам
export function rollTier(config, wave, luck, rng) {
  const cap = maxTier(config, wave);
  const weights = config.shop.tier_weights;
  const shift = luck * config.shop.luck_tier_shift;
  let total = 0;
  const acc = TIER_ACC;
  for (let i = 0; i < cap; i++) {
    // сдвиг усиливает верхние тиры пропорционально их номеру
    acc[i] = Math.max(0, weights[i] * (1 + shift * i));
    total += acc[i];
  }
  if (total <= 0) return 1;
  let r = rng.float() * total;
  for (let i = 0; i < cap; i++) {
    r -= acc[i];
    if (r <= 0) return i + 1;
  }
  return cap;
}

const TIER_ACC = new Float64Array(8);

export function createShop(config, unlockedWeapons, curseFx) {
  const slots = new Array(config.shop.slots);
  for (let i = 0; i < slots.length; i++) {
    slots[i] = { kind: null, id: null, cfg: null, price: 0, locked: false, sold: false };
  }
  const fx = curseFx || EMPTY_CURSE;
  const state = { rerolls: 0, wave: 1, freeRerollsLeft: 0 };

  // Пул оружия ограничен открытым метапрогрессией (M6 передаст сюда реальный список)
  const weaponIds = [];
  const itemIds = [];

  function rebuildPools(coop) {
    weaponIds.length = 0;
    for (const id in config.weapons) {
      const w = config.weapons[id];
      const open = w.unlock && w.unlock.type === 'default';
      if (open || (unlockedWeapons && unlockedWeapons.indexOf(id) >= 0)) weaponIds.push(id);
    }
    itemIds.length = 0;
    for (const id in config.items) {
      const it = config.items[id];
      if (it.coop_only && !coop) continue;   // кооп-предметы только в комнате >1
      itemIds.push(id);
    }
  }

  // Оружие подбирается с оглядкой на инвентарь: шанс совпасть по типу и по тегу
  function pickWeapon(player, tier, rng) {
    const s = config.shop;
    const roll = rng.float();
    let sameType = null;
    let sameTag = null;
    for (let i = 0; i < player.slots.length; i++) {
      const held = player.slots[i].cfg;
      if (!held) continue;
      for (let k = 0; k < weaponIds.length; k++) {
        const w = config.weapons[weaponIds[k]];
        if (w.tier !== tier) continue;
        if (!sameType && w.texture === held.texture) sameType = weaponIds[k];
        if (!sameTag && shareTag(w.tags, held.tags)) sameTag = weaponIds[k];
      }
    }
    if (roll < s.same_type_chance && sameType) return sameType;
    if (roll < s.same_type_chance + s.same_tag_chance && sameTag) return sameTag;

    let count = 0;
    for (let k = 0; k < weaponIds.length; k++) {
      if (config.weapons[weaponIds[k]].tier === tier) count++;
    }
    if (count === 0) return null;
    let idx = rng.int(0, count - 1);
    for (let k = 0; k < weaponIds.length; k++) {
      if (config.weapons[weaponIds[k]].tier !== tier) continue;
      if (idx-- === 0) return weaponIds[k];
    }
    return null;
  }

  function pickItem(tier, rng) {
    let count = 0;
    for (let k = 0; k < itemIds.length; k++) {
      if (config.items[itemIds[k]].tier === tier) count++;
    }
    if (count === 0) return null;
    let idx = rng.int(0, count - 1);
    for (let k = 0; k < itemIds.length; k++) {
      if (config.items[itemIds[k]].tier !== tier) continue;
      if (idx-- === 0) return itemIds[k];
    }
    return null;
  }

  function fillSlot(slot, player, wave, danger, rng) {
    if (slot.locked) return;                      // цена залоченного слота фиксируется
    const tier = rollTier(config, wave, player.stats.luck, rng);
    const wantWeapon = rng.float() < config.shop.weapon_chance;

    let kind = wantWeapon ? 'weapon' : 'item';
    let id = wantWeapon ? pickWeapon(player, tier, rng) : pickItem(tier, rng);
    if (!id) {                                    // на этом тире пусто — берём другой вид
      kind = wantWeapon ? 'item' : 'weapon';
      id = wantWeapon ? pickItem(tier, rng) : pickWeapon(player, tier, rng);
    }
    if (!id) {                                    // и там пусто — падаем на тир 1
      kind = 'item';
      id = pickItem(1, rng);
    }
    slot.kind = kind;
    slot.id = id;
    slot.cfg = id ? (kind === 'weapon' ? config.weapons[id] : config.items[id]) : null;
    if (!slot.cfg) {
      slot.price = 0;
    } else if (fx.shop_free) {
      slot.price = 0;
    } else {
      slot.price = priceOf(config, slot.cfg.price, wave, danger);
    }
    slot.sold = false;
  }

  // Открыть лавку на волне wave для игрока player
  function open(player, wave, danger, rng, coop) {
    state.wave = wave;
    state.rerolls = 0;
    state.freeRerollsLeft = fx.free_rerolls || 0;
    rebuildPools(coop);
    for (let i = 0; i < slots.length; i++) fillSlot(slots[i], player, wave, danger, rng);
    return slots;
  }

  function reroll(player, danger, rng, wallet) {
    let cost = 0;
    if (state.freeRerollsLeft > 0) {
      state.freeRerollsLeft -= 1;
    } else {
      cost = rerollCost(config, state.rerolls);
      if (!wallet.spend(player, cost)) return 0;
    }
    state.rerolls += 1;
    for (let i = 0; i < slots.length; i++) fillSlot(slots[i], player, state.wave, danger, rng);
    return cost;
  }

  return { slots, state, open, reroll, rebuildPools };
}

function shareTag(a, b) {
  for (let i = 0; i < a.length; i++) {
    for (let k = 0; k < b.length; k++) {
      if (a[i] === b[k]) return true;
    }
  }
  return false;
}

// --- Инвентарь игрока -------------------------------------------------------

export function freeSlotIndex(player) {
  for (let i = 0; i < player.slots.length; i++) {
    if (!player.slots[i].cfg) return i;
  }
  return -1;
}

// Купить. Возвращает код: 'ok' | 'poor' | 'full' | 'empty'
//
// withMerge — покупка ради слияния: слоты могут быть заняты, потому что сразу за
// покупкой merge_count копий схлопнутся в одну вещь и слотов станет больше, а не меньше.
export function buy(player, shop, slotIndex, config, wallet, onChange, withMerge) {
  const slot = shop.slots[slotIndex];
  if (!slot || !slot.cfg || slot.sold) return 'empty';
  if (wallet.balance(player) < slot.price) return 'poor';

  // Сначала проверяем всё, что может отказать, и только потом платим и меняем
  // инвентарь: половинчатая покупка списала бы прах и ничего не выдала.
  const merging = !!withMerge && slot.kind === 'weapon' && mergeAfterBuy(player, slot, config);
  let target = -1;
  if (slot.kind === 'weapon') {
    target = freeSlotIndex(player);
    // Слотов нет, но слияние их освободит: кладём поверх одной из копий,
    // которую слияние всё равно поглотит.
    if (target < 0 && merging) target = indexOfWeapon(player, slot.id);
    if (target < 0) return 'full';
  }
  if (!wallet.spend(player, slot.price)) return 'poor';

  if (slot.kind === 'weapon') {
    equip(player.slots[target], slot.id, config);
  } else {
    player.items.push(slot.id);
    player.sources.push(config.items[slot.id].stats);
  }
  slot.sold = true;
  slot.locked = false;
  if (merging) merge(player, slot.id, config, null);
  if (onChange) onChange();
  return 'ok';
}

function indexOfWeapon(player, weaponId) {
  for (let i = 0; i < player.slots.length; i++) {
    if (player.slots[i].id === weaponId) return i;
  }
  return -1;
}

// Продать своё за долю текущей цены
export function sell(player, kind, index, config, wave, danger, wallet, onChange) {
  if (kind === 'weapon') {
    const s = player.slots[index];
    if (!s || !s.cfg) return 0;
    const back = sellValue(config, s.cfg.price, wave, danger);
    wallet.add(player, back);
    s.id = null;
    s.cfg = null;
    s.cd = 0;
    s.targetIdx = -1;
    s.targetUid = -1;
    if (onChange) onChange();
    return back;
  }
  const id = player.items[index];
  if (!id) return 0;
  const back = sellValue(config, config.items[id].price, wave, danger);
  wallet.add(player, back);
  player.items.splice(index, 1);
  // sources[0] — персонаж, sources[1] — копилка левелапов, предметы идут с индекса 2.
  // Одинаковые предметы кладут одну и ту же ссылку — удаляем первое вхождение.
  const si = player.sources.indexOf(config.items[id].stats);
  if (si >= ITEM_SOURCE_START) player.sources.splice(si, 1);
  if (onChange) onChange();
  return back;
}

// Слияние: merge_count одинаковых одного тира → одно следующего тира
export function mergeable(player, config) {
  const counts = MERGE_COUNTS;
  for (const k in counts) delete counts[k];
  for (let i = 0; i < player.slots.length; i++) {
    const s = player.slots[i];
    if (!s.cfg || !s.cfg.next_tier) continue;
    counts[s.id] = (counts[s.id] || 0) + 1;
  }
  for (const id in counts) {
    if (counts[id] >= config.shop.merge_count) return id;
  }
  return null;
}

// Слияние сразу после покупки: хватит ли копий этого оружия, если купить ещё одну.
// Отвечает на вопрос лавки «показывать ли кнопку „купить и объединить“».
export function mergeAfterBuy(player, slot, config) {
  if (!slot || slot.kind !== 'weapon' || !slot.cfg || !slot.cfg.next_tier) return false;
  let have = 0;
  for (let i = 0; i < player.slots.length; i++) {
    if (player.slots[i].id === slot.id) have++;
  }
  return have + 1 >= config.shop.merge_count;
}

export function merge(player, weaponId, config, onChange) {
  const need = config.shop.merge_count;
  const cfg = config.weapons[weaponId];
  if (!cfg || !cfg.next_tier) return false;
  let removed = 0;
  for (let i = 0; i < player.slots.length && removed < need; i++) {
    if (player.slots[i].id === weaponId) {
      player.slots[i].id = null;
      player.slots[i].cfg = null;
      removed++;
    }
  }
  if (removed < need) return false;
  const free = freeSlotIndex(player);
  if (free < 0) return false;
  equip(player.slots[free], cfg.next_tier, config);
  if (onChange) onChange();
  return true;
}

const MERGE_COUNTS = {};
const ITEM_SOURCE_START = 2;
const EMPTY_CURSE = { shop_free: false, free_rerolls: 0 };
