// Кооп-экономика: общий котёл праха и деление поровну.
//
// Правила из ТЗ §3.8:
//  - любой поднятый прах идёт в общий котёл комнаты, а не в карман;
//  - баланс каждого в лавке = котёл / N, где N — живые и выбывшие участники;
//  - траты списываются с личной доли, неистраченное переносится;
//  - дроп праха компенсирует деление (ash_per_player), чтобы вдвоём было не
//    беднее, но и не богаче на голову;
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

  // Множитель дропа: компенсирует деление котла на N
  function dropMultiplier() {
    return 1 + coop.ash_per_player * (state.players - 1);
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

  return { state, add, shareOf, spend, gift, onDeath, dropMultiplier, solo };
}
