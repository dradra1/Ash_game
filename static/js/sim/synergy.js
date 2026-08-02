// Синергии оружия: бонусы за 2/4/6 одетых стволов одного класса ИЛИ с общим
// тегом. Ствол участвует сразу во всех своих сетах: класс (`class`) плюс
// каждый его тег (`tags`) — тесак клинковый и примитивный качает оба счётчика.
//
// Каждый слот считается за штуку, включая дубликаты до слияния (после слияния
// двух стволов в один счёт падает — как в Brotato). Пороги кумулятивны:
// за 6 действуют бонусы 2, 4 и 6 одновременно.
//
// Бонусы 2/4 — статовые: складываются в state.mods, который стоит в sources
// игрока между levelMods и предметами (sim/player.js). Бонус 6-го порога
// статом не выразить — это числовые поля состояния, которые читают
// sim/weapon.js (дальность/дуга/снаряды/пробитие) и sim/turret.js (+установка).
//
// Пересчёт — только из refreshStats (покупка, продажа, слияние, левелап),
// в горячем цикле этот код не бегает. Все числа — config.synergies.

import { setCount, thresholdShift, fullSets } from './unique.js';

// Значения по умолчанию держим в одном месте: ими же refreshSynergies
// обнуляет состояние, а не свежим объектом — ссылка на mods сидит в
// sources игрока, пересоздавать её нельзя.
function resetState(state) {
  const counts = state.counts;
  for (const k in counts) counts[k] = 0;
  const mods = state.mods;
  for (const k in mods) delete mods[k];
  state.meleeRangeMult = 1;
  state.meleeArcMult = 1;
  state.extraShots = 0;
  state.extraShotSpread = 0;
  state.extraPierce = 0;
  state.extraTurrets = 0;
  state.critDmgMult = 1;
}

export function createSynergyState() {
  const state = {
    counts: {},
    mods: {},
    meleeRangeMult: 1,
    meleeArcMult: 1,
    extraShots: 0,
    extraShotSpread: 0,
    extraPierce: 0,
    extraTurrets: 0,
    critDmgMult: 1,
  };
  return state;
}

// Применить спец-бонус шестого порога к числовым полям состояния.
function applySpecial(state, name, specials) {
  const s = specials[name];
  if (!s) return;
  if (name === 'melee_sweep') {
    state.meleeRangeMult *= s.range_mult;
    state.meleeArcMult *= s.arc_mult;
  } else if (name === 'extra_shot') {
    state.extraShots += s.shots;
    // Веер для доп. снарядов: у ствола без своего spread два снаряда полетели
    // бы в одну точку и выглядели как один.
    state.extraShotSpread = s.spread || 0;
  } else if (name === 'extra_pierce') {
    state.extraPierce += s.pierce;
  } else if (name === 'extra_turret') {
    state.extraTurrets += s.turrets;
  } else if (name === 'crit_boost') {
    // Пер-игрока множитель поверх config.stats.crit_mult — sim/weapon.js.
    state.critDmgMult *= s.mult;
  }
}

// Применить все пороги одного сета (класса или тега), которые покрывает счёт n.
//
// shift двигает планку (Калибровщик: -1, то есть 1/3/5), full открывает сет
// целиком при единственном стволе (Разнобой) — sim/unique.js.
function applyTiers(state, tiers, n, specials, shift, full) {
  for (const threshold in tiers) {
    let need = full ? 1 : +threshold + shift;
    if (need < 1) need = 1;
    if (n < need) continue;
    const bonus = tiers[threshold];
    if (bonus.special) {
      applySpecial(state, bonus.special, specials);
      continue;
    }
    const mods = state.mods;
    for (const key in bonus) mods[key] = (mods[key] || 0) + bonus[key];
  }
}

// Пересчитать синергии по текущему лоадауту игрока. Вызывается из
// refreshStats до resolveStats — mods к этому моменту уже должен быть готов.
export function refreshSynergies(player, config) {
  const state = player.synergy;
  resetState(state);

  const syn = config.synergies;
  if (!syn || !syn.enabled) return;

  // Один счёт на классы и на теги: пространства имён не пересекаются,
  // а ствол участвует сразу во всех своих сетах (класс + каждый тег).
  //
  // mult — вес одного ствола (Разломный: каждый считается за два), retired —
  // печати проданного оружия у персонажа с памятью синергий (sim/unique.js).
  const u = player.uniq;
  const mult = setCount(u);
  const counts = state.counts;
  const slots = player.slots;
  for (let i = 0; i < slots.length; i++) {
    countWeapon(counts, slots[i].cfg, mult);
  }
  const retired = player.retired;
  if (retired && retired.length) {
    for (let i = 0; i < retired.length; i++) {
      countWeapon(counts, config.weapons[retired[i]], mult);
    }
  }

  const shift = thresholdShift(u);
  const full = fullSets(u);
  for (const cls in syn.classes) {
    applyTiers(state, syn.classes[cls], counts[cls] || 0, syn.specials, shift, full);
  }
  if (syn.tags) {
    for (const tag in syn.tags) {
      applyTiers(state, syn.tags[tag], counts[tag] || 0, syn.specials, shift, full);
    }
  }
}

function countWeapon(counts, cfg, mult) {
  if (!cfg) return;
  counts[cfg.class] = (counts[cfg.class] || 0) + mult;
  const tags = cfg.tags;
  if (!tags) return;
  for (let j = 0; j < tags.length; j++) {
    counts[tags[j]] = (counts[tags[j]] || 0) + mult;
  }
}
