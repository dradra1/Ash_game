// Уникальные особенности персонажей: правила обращения с оружием.
//
// Устроено как синергии (sim/synergy.js): «ключ в конфиге → ветка здесь →
// числовое поле, которое читает симуляция». Никаких веток «если это Обетник»:
// движок знает про ПОЛЯ, а не про персонажей, поэтому новый персонаж — это
// запись в config.characters, а не правка кода.
//
// Поля `characters[id].unique` (все необязательны, персонаж берёт своё
// подмножество; `type` нужен только интерфейсу для строки ui.unique.<type>):
//
//   slots             перекрытие config.run.weapon_slots
//   set_count         ствол считается за N штук в своих сетах синергий
//   full_sets         любой затронутый сет сразу на максимальном пороге
//   threshold_shift   пороги сетов сдвигаются (-1: 2/4/6 → 1/3/5)
//   synergy_memory    проданное и слитое продолжает считаться в синергиях, до N печатей
//   per_weapon        статы за каждый одетый ствол
//   per_distinct_tag  статы за каждый РАЗНЫЙ тег в лоадауте
//   shop_class        лавка предлагает только оружие этого класса
//   shop_tag          ...только оружие с этим тегом
//   shop_max_tier     жёсткий потолок тира в лавке
//   shop_tier_bonus   прибавка к потолку тира, разрешённому волной
//   weapon_price_mult множитель цены оружия в лавке
//   no_duplicates     нельзя носить два одинаковых ствола
//   no_merge          слияние недоступно
//   free_pair         покупка оружия кладёт бесплатную вторую копию
//   replace_on_full   при полных слотах покупка заменяет ствол с возвратом праха
//
// Всё, что здесь считается, считается ВНЕ горячего цикла: точки входа — создание
// игрока и refreshStats (покупка, продажа, слияние, левелап).

export function uniqueOf(config, characterId) {
  const ch = config.characters[characterId];
  return (ch && ch.unique) || null;
}

// Сколько слотов оружия у этого персонажа. Единственный источник правды:
// config.run.weapon_slots читается только отсюда.
export function slotCount(config, characterId) {
  const u = uniqueOf(config, characterId);
  return u && u.slots > 0 ? u.slots : config.run.weapon_slots;
}

// За сколько штук считается один ствол в счётчиках синергий.
export function setCount(u) {
  return u && u.set_count > 0 ? u.set_count : 1;
}

export function thresholdShift(u) {
  return u && u.threshold_shift ? u.threshold_shift : 0;
}

export function fullSets(u) {
  return !!(u && u.full_sets);
}

export function mergeAllowed(u) {
  return !(u && u.no_merge);
}

export function weaponPriceMult(u) {
  return u && u.weapon_price_mult > 0 ? u.weapon_price_mult : 1;
}

export function replaceOnFull(u) {
  return !!(u && u.replace_on_full);
}

export function freePair(u) {
  return !!(u && u.free_pair);
}

// Держит ли игрок этот ствол — для запрета дубликатов.
export function holdsWeapon(player, weaponId) {
  const slots = player.slots;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].id === weaponId) return true;
  }
  return false;
}

// Пустит ли лавка этот ствол в ассортимент. Проверка одна на подбор и на покупку,
// иначе игрок увидел бы карточку, которую нельзя купить.
export function shopAllows(u, weaponId, weaponCfg, player) {
  if (!u || !weaponCfg) return true;
  if (u.shop_class && weaponCfg.class !== u.shop_class) return false;
  if (u.shop_tag) {
    const tags = weaponCfg.tags;
    if (!tags || tags.indexOf(u.shop_tag) < 0) return false;
  }
  if (u.no_duplicates && player && holdsWeapon(player, weaponId)) return false;
  return true;
}

// Потолок тира в лавке. cap приходит от волны (shop.maxTier), особенность двигает
// его вверх или вниз; выше числа заданных весов тиров не поднимаем — rollTier
// ходит по config.shop.tier_weights и за его краем получил бы undefined.
export function tierCap(u, cap, config) {
  let out = cap;
  if (u) {
    if (u.shop_tier_bonus) out += u.shop_tier_bonus;
    if (u.shop_max_tier > 0 && out > u.shop_max_tier) out = u.shop_max_tier;
  }
  const top = config.shop.tier_weights.length;
  if (out > top) out = top;
  return out < 1 ? 1 : out;
}

// Печати Реликвария: проданное и поглощённое слиянием оружие продолжает считаться
// в синергиях. Список живёт в игроке, обрезается по лимиту с начала — свежие
// печати вытесняют старые.
export function rememberRetired(player, weaponId) {
  const u = player.uniq;
  const limit = u && u.synergy_memory > 0 ? u.synergy_memory : 0;
  if (!limit || !weaponId) return;
  const list = player.retired;
  list.push(weaponId);
  while (list.length > limit) list.shift();
}

// Статы, зависящие от лоадаута (per_weapon, per_distinct_tag). Пишутся в
// player.uniqMods — СТАБИЛЬНЫЙ объект: ссылка на него лежит в player.sources,
// пересоздавать его нельзя (та же причина, что у synergy.mods).
export function refreshUniqueMods(player, config) {
  const mods = player.uniqMods;
  for (const k in mods) delete mods[k];
  const u = player.uniq;
  if (!u) return;
  const perWeapon = u.per_weapon;
  const perTag = u.per_distinct_tag;
  if (!perWeapon && !perTag) return;

  const seen = TAG_SEEN;
  for (const k in seen) delete seen[k];
  const slots = player.slots;
  let armed = 0;
  let distinct = 0;
  for (let i = 0; i < slots.length; i++) {
    const cfg = slots[i].cfg;
    if (!cfg) continue;
    armed++;
    const tags = cfg.tags;
    if (!tags) continue;
    for (let j = 0; j < tags.length; j++) {
      if (seen[tags[j]]) continue;
      seen[tags[j]] = 1;
      distinct++;
    }
  }
  if (perWeapon) {
    for (const k in perWeapon) mods[k] = (mods[k] || 0) + perWeapon[k] * armed;
  }
  if (perTag) {
    for (const k in perTag) mods[k] = (mods[k] || 0) + perTag[k] * distinct;
  }
}

// Переиспользуемый набор виденных тегов: refreshStats зовётся редко, но мусорить
// объектом на каждый пересчёт незачем (CLAUDE.md §4).
const TAG_SEEN = {};
