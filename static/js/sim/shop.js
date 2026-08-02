// Лавка: ассортимент, цены с инфляцией, реролл, лок слота, продажа, слияние.
//
// Ключ жанра: экономика важнее моторики. Игрок принимает решения здесь, а не в бою,
// поэтому все числа — из конфига и легко перебалансируются.

import { equip } from './weapon.js';
import {
  shopAllows, tierCap, weaponPriceMult, mergeAllowed, replaceOnFull, freePair,
  holdsWeapon, rememberRetired,
} from './unique.js';

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

// Выбор тира с поправкой на удачу: удача сдвигает распределение к высоким тирам.
// u — уникальная особенность покупателя: она двигает потолок (Курганный кузнец
// торгует выше волны, Барон Хлама — только хламом), см. sim/unique.js.
export function rollTier(config, wave, luck, rng, u) {
  const cap = tierCap(u, maxTier(config, wave), config);
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
  const state = { rerolls: 0, wave: 1, danger: null, freeRerollsLeft: 0 };

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

  // Оружие подбирается с оглядкой на инвентарь: шанс совпасть по типу и по тегу.
  //
  // Фильтр особенности (класс, тег, запрет дубликатов) применяется ко ВСЕМ трём
  // веткам подбора: пропусти его в «том же типе» — и Носителю Роя прилетит
  // карабин, а Разнобою — второй такой же стилет, то есть карточка, которую его
  // же buy() откажется продавать.
  function pickWeapon(player, tier, rng) {
    const s = config.shop;
    const u = player.uniq;
    const roll = rng.float();
    let sameType = null;
    let sameTag = null;
    for (let i = 0; i < player.slots.length; i++) {
      const held = player.slots[i].cfg;
      if (!held) continue;
      for (let k = 0; k < weaponIds.length; k++) {
        const w = config.weapons[weaponIds[k]];
        if (w.tier !== tier) continue;
        if (!shopAllows(u, weaponIds[k], w, player)) continue;
        if (!sameType && w.texture === held.texture) sameType = weaponIds[k];
        if (!sameTag && shareTag(w.tags, held.tags)) sameTag = weaponIds[k];
      }
    }
    if (roll < s.same_type_chance && sameType) return sameType;
    if (roll < s.same_type_chance + s.same_tag_chance && sameTag) return sameTag;

    let count = 0;
    for (let k = 0; k < weaponIds.length; k++) {
      if (allowed(weaponIds[k], tier, u, player)) count++;
    }
    if (count === 0) return null;
    let idx = rng.int(0, count - 1);
    for (let k = 0; k < weaponIds.length; k++) {
      if (!allowed(weaponIds[k], tier, u, player)) continue;
      if (idx-- === 0) return weaponIds[k];
    }
    return null;
  }

  function allowed(id, tier, u, player) {
    const w = config.weapons[id];
    return w.tier === tier && shopAllows(u, id, w, player);
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
    const tier = rollTier(config, wave, player.stats.luck, rng, player.uniq);
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
      // Наценка особенности — только на оружие: предметы к её правилам отношения
      // не имеют, а Кузнец платит именно за ранние высокие тиры.
      const mult = kind === 'weapon' ? weaponPriceMult(player.uniq) : 1;
      slot.price = Math.round(priceOf(config, slot.cfg.price, wave, danger) * mult);
    }
    slot.sold = false;
  }

  // Открыть лавку на волне wave для игрока player.
  //
  // Сложность запоминается в state: по ней считается возврат за ствол, который
  // вытесняет покупка у персонажа с одним слотом (replace_on_full в buy).
  function open(player, wave, danger, rng, coop) {
    state.wave = wave;
    state.danger = danger;
    state.rerolls = 0;
    state.freeRerollsLeft = fx.free_rerolls || 0;
    rebuildPools(coop);
    for (let i = 0; i < slots.length; i++) fillSlot(slots[i], player, wave, danger, rng);
    return slots;
  }

  function reroll(player, danger, rng, wallet) {
    state.danger = danger;
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

// Купить. Возвращает код: 'ok' | 'poor' | 'full' | 'dupe' | 'empty'
//
// withMerge — покупка ради слияния: слоты могут быть заняты, потому что сразу за
// покупкой merge_count копий схлопнутся в одну вещь и слотов станет больше, а не меньше.
export function buy(player, shop, slotIndex, config, wallet, onChange, withMerge) {
  const slot = shop.slots[slotIndex];
  if (!slot || !slot.cfg || slot.sold) return 'empty';
  if (wallet.balance(player) < slot.price) return 'poor';

  // Сначала проверяем всё, что может отказать, и только потом платим и меняем
  // инвентарь: половинчатая покупка списала бы прах и ничего не выдала.
  const u = player.uniq;
  const merging = !!withMerge && slot.kind === 'weapon' && mergeAfterBuy(player, slot, config);
  let target = -1;
  let replaced = -1;
  if (slot.kind === 'weapon') {
    if (u && u.no_duplicates && holdsWeapon(player, slot.id)) return 'dupe';
    target = freeSlotIndex(player);
    // Слотов нет, но слияние их освободит: кладём поверх одной из копий,
    // которую слияние всё равно поглотит.
    if (target < 0 && merging) target = indexOfWeapon(player, slot.id);
    // Обетнику слот не освободить иначе: новый ствол вытесняет старый, за
    // старый возвращается его цена продажи — иначе смена оружия за забег
    // была бы для него запрещена вовсе.
    if (target < 0 && replaceOnFull(u)) {
      replaced = worstSlotIndex(player);
      target = replaced;
    }
    if (target < 0) return 'full';
  }
  if (!wallet.spend(player, slot.price)) return 'poor';

  if (slot.kind === 'weapon') {
    if (replaced >= 0) {
      const old = player.slots[replaced];
      wallet.add(player, sellValue(config, old.cfg.price, shop.state.wave,
        shop.state.danger || NO_DANGER));
      rememberRetired(player, old.id);
    }
    equip(player.slots[target], slot.id, config);
    // Двоедушный: пара кладётся сразу и бесплатно. Свободного слота нет —
    // покупка остаётся обычной, а не отменяется.
    if (freePair(u)) {
      const twin = freeSlotIndex(player);
      if (twin >= 0) equip(player.slots[twin], slot.id, config);
    }
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

// Кого вытеснит покупка при полных слотах: самый дешёвый ствол — он же самый
// слабый, и выбор не зависит от порядка слотов.
function worstSlotIndex(player) {
  let best = -1;
  let bestPrice = Infinity;
  for (let i = 0; i < player.slots.length; i++) {
    const cfg = player.slots[i].cfg;
    if (!cfg) continue;
    if (cfg.price < bestPrice) {
      bestPrice = cfg.price;
      best = i;
    }
  }
  return best;
}

// Лавку могли не открывать (тесты, ботопрогон) — множители сложности по умолчанию.
const NO_DANGER = { price_mult: 1 };

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
    rememberRetired(player, s.id);
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
  // Первые ITEM_SOURCE_START источников постоянные, предметы идут после них.
  // Одинаковые предметы кладут одну и ту же ссылку — удаляем первое вхождение.
  const si = player.sources.indexOf(config.items[id].stats);
  if (si >= ITEM_SOURCE_START) player.sources.splice(si, 1);
  if (onChange) onChange();
  return back;
}

// Слияние: merge_count одинаковых одного тира → одно следующего тира
export function mergeable(player, config) {
  if (!mergeAllowed(player.uniq)) return null;
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
  if (!mergeAllowed(player.uniq)) return false;
  if (!slot || slot.kind !== 'weapon' || !slot.cfg || !slot.cfg.next_tier) return false;
  const need = config.shop.merge_count;
  let have = 0;
  for (let i = 0; i < player.slots.length; i++) {
    if (player.slots[i].id === slot.id) have++;
  }
  if (have + 1 < need) return false;
  // Покупаемой копии нужно куда-то лечь. Свободного слота нет — она встанет
  // ПОВЕРХ одной из уже одетых копий, и их число не вырастет: слияние сорвётся,
  // а прах уже списан. Значит без свободного слота обещать слияние можно только
  // тогда, когда копий хватает и без покупаемой (у персонажа с одним слотом —
  // никогда).
  return freeSlotIndex(player) >= 0 || have >= need;
}

export function merge(player, weaponId, config, onChange) {
  if (!mergeAllowed(player.uniq)) return false;
  const need = config.shop.merge_count;
  const cfg = config.weapons[weaponId];
  if (!cfg || !cfg.next_tier) return false;
  let removed = 0;
  for (let i = 0; i < player.slots.length && removed < need; i++) {
    if (player.slots[i].id === weaponId) {
      player.slots[i].id = null;
      player.slots[i].cfg = null;
      rememberRetired(player, weaponId);
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
// Постоянных источников статов у игрока четыре: персонаж, левелапы, синергии,
// уникальная особенность (sim/player.js). Предметы начинаются после них.
const ITEM_SOURCE_START = 4;
const EMPTY_CURSE = { shop_free: false, free_rerolls: 0 };
