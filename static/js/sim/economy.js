// Кооп-экономика: общий котёл праха и деление поровну.
//
// Правила из ТЗ §3.8:
//  - любой поднятый прах идёт в общий котёл комнаты, а не в карман;
//  - баланс каждого в лавке = котёл / N, где N — живые и выбывшие участники;
//  - траты списываются с личной доли, неистраченное переносится;
//  - дроп праха компенсирует деление котла, чтобы вдвоём было не беднее, но и
//    не богаче на голову (см. dropMultiplier — компенсация считается от того,
//    насколько кооп уже увеличил число врагов);
//  - опыт НЕ делится: полный XP получает каждый;
//  - выбывание игрока штрафует котёл на death_penalty.

export function createEconomy(config, playerCount) {
  const coop = config.coop;
  const solo = playerCount <= 1;

  const state = {
    pot: 0,          // общий котёл
    spent: {},       // сколько уже потратил каждый игрок
    penalties: 0,    // сколько срезано за выбывания
    players: playerCount,
  };

  // Во сколько раз комната РЕАЛЬНО убивает больше одиночки. Таблица измерена
  // `node tools/coop_income.js` и лежит в конфиге (coop.kill_scale).
  //
  // Здесь была главная ошибка модели: вместо измеренного роста подставлялся
  // ПЛАНОВЫЙ рост спавна (`1 + budget_per_player*(N-1)`). Это разные величины.
  // Спавн задаёт, сколько врагов ВЫПУЩЕНО, а доход зависит от того, сколько их
  // УБИТО, — и доля дожития меняется вместе с составом: чем плотнее комната, тем
  // меньше врагов доживает до конца волны. Замер: восьмером убийств в 9.6 раза
  // больше соло при плановых 5.55, вчетвером — в 5.4 при плановых 2.95. Отсюда и
  // брался лишний доход.
  //
  // Без таблицы падаем на прежнюю формулу: конфиг может быть старым, а считать
  // что-то надо.
  function killScale() {
    const curve = coop.kill_scale;
    if (!curve || !curve.length) return 1 + coop.budget_per_player * (state.players - 1);
    const i = Math.max(0, Math.min(curve.length - 1, state.players - 1));
    return curve[i] || 1;
  }

  // Полная компенсация деления котла на N. Личный доход равен
  //   (убийства × killScale × dropFactor) / N,
  // значит для совпадения с соло dropFactor обязан быть N / killScale.
  // ash_share_target — единственная ручка: 1.0 значит «на брата столько же».
  function dropFactor() {
    return (state.players / killScale()) * coop.ash_share_target;
  }

  // Ожидаемая величина дропа. Для дохода, который идёт СРАЗУ в котёл (проклятия,
  // награда за разбитые объекты), — множитель: разыгрывать монету на редком
  // событии значит добавить разброса там, где его никто не просил.
  function dropMultiplier() {
    return dropFactor();
  }

  // А вот прах с убийств урезается ЧАСТОТОЙ, а не размером кучки: падает не с
  // каждого врага, зато кучка остаётся полноразмерной.
  //
  // Так лучше по трём причинам. Кучка в 0.6 праха неотличима от кучки в 3 и
  // выглядит как обман; вдвое меньше кучек — это вдвое меньше пикапов в пуле и в
  // канале праха при восьмерых (CLAUDE.md §4); и «дропает не каждый» — понятное
  // игроку правило, в отличие от «у всех дроп урезан на 26%».
  //
  // Матожидание то же самое: chance × amount = dropFactor.
  function dropChance() {
    const f = dropFactor();
    return f < 1 ? f : 1;
  }

  function dropAmount() {
    const f = dropFactor();
    return f > 1 ? f : 1;
  }

  // Калибровка кривой дохода по волнам. Число убийств растёт почти квадратично
  // по волне, а цели из ТЗ (≈50 на 1-й, 200 на 7-й, 600 на 13-й, 800 на 20-й) —
  // почти линейно, поэтому без поволновой поправки ранние волны нищие, а поздние
  // ломают лавку. Массив короче номера волны — берём последний элемент.
  function waveMult(wave) {
    const curve = config.economy && config.economy.wave_ash_mult;
    if (!curve || !curve.length) return 1;
    const i = Math.max(0, Math.min(curve.length - 1, Math.round(wave) - 1));
    return curve[i];
  }

  function add(amount) {
    state.pot += amount;
    return amount;
  }

  // Доля игрока = (котёл − штрафы) / N − уже потраченное им
  function shareOf(playerId) {
    const base = Math.max(0, state.pot - state.penalties) / Math.max(1, state.players);
    return Math.max(0, base - (state.spent[playerId] || 0));
  }

  function spend(playerId, amount) {
    if (amount <= 0) return true;
    if (shareOf(playerId) < amount) return false;
    state.spent[playerId] = (state.spent[playerId] || 0) + amount;
    return true;
  }

  // Возврат за продажу. Уменьшает личное «потрачено», а не растит котёл: иначе
  // продавец делился бы выручкой со всеми, а купил вещь на свою долю.
  // Уходить в минус можно — это и значит «получил больше равной доли».
  function refund(playerId, amount) {
    if (amount <= 0) return;
    state.spent[playerId] = (state.spent[playerId] || 0) - amount;
  }

  // Передать прах союзнику: списывается с доли отправителя, лимит из конфига
  function gift(fromId, toId, amount) {
    if (!coop.gift_enabled || solo) return 0;
    // Лимит передачи живёт в секции shop (так задано схемой конфига в ТЗ §4)
    const limit = shareOf(fromId) * config.shop.gift_limit_pct;
    const give = Math.min(amount, limit);
    if (give <= 0) return 0;
    state.spent[fromId] = (state.spent[fromId] || 0) + give;
    state.spent[toId] = (state.spent[toId] || 0) - give;
    return give;
  }

  function onDeath() {
    state.penalties += Math.max(0, state.pot - state.penalties) * coop.death_penalty;
  }

  // Обнулить всё, что накопилось. Нужно проклятию «Милость лавки»: там весь
  // ассортимент бесплатный, и остаток на счету не значит ничего.
  //
  // `spent` чистится обязательно: доля считается как (котёл − штрафы)/N − потрачено,
  // и один обнулённый котёл оставил бы потратившему отрицательный баланс на весь
  // остаток забега — то есть штраф за то, что он что-то купил.
  function zero() {
    state.pot = 0;
    state.penalties = 0;
    for (const id in state.spent) delete state.spent[id];
  }

  return {
    state, add, shareOf, spend, refund, gift, onDeath, zero,
    dropMultiplier, dropChance, dropAmount, killScale, waveMult, solo,
  };
}

// Кошелёк лавки: единственный способ тратить прах.
//
// До этого лавка меняла player.ash напрямую, а economy.spend не вызывался ниоткуда —
// котёл не знал о тратах, и первый же подобранный прах следующей волны пересчитывал
// player.ash из нетронутого котла, возвращая всё потраченное. player.ash теперь
// только витрина: истина живёт в economy, а onChange (run.syncAsh) переносит её в игроков.
export function createWallet(economy, onChange) {
  return {
    balance(player) {
      return economy.shareOf(player.id);
    },
    spend(player, amount) {
      if (amount <= 0) return true;
      if (!economy.spend(player.id, amount)) return false;
      if (onChange) onChange();
      return true;
    },
    add(player, amount) {
      economy.refund(player.id, amount);
      if (onChange) onChange();
    },
  };
}
