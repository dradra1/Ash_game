// Два источника данных для одной и той же лавки.
//
// UI лавки не должен знать, свой это забег или чужой: у хоста и в соло действия
// применяются к симуляции сразу, у клиента — уезжают событием хосту, а обратно
// приходит обновлённый снимок. Иначе пришлось бы держать две реализации экрана.

import { buy, sell, merge, rerollCost } from '../sim/shop.js';
import { refreshStats } from '../sim/player.js';

// --- Хост и соло: всё локально -------------------------------------------
export function localAdapter(run, player, shop, config, onReady) {
  return {
    slots: () => shop.slots,
    player: () => player,
    wave: () => run.state.wave + 1,
    rerollCost: () => {
      if (shop.state.freeRerollsLeft > 0) return 0;
      return rerollCost(config, shop.state.rerolls);
    },

    act(kind, a) {
      if (kind === 'buy') {
        const res = buy(player, shop, a, config, () => refreshStats(player, config));
        if (res === 'ok' && run.noteShopBuy) run.noteShopBuy();
        return res;
      }
      if (kind === 'reroll') {
        shop.reroll(player, run.danger, run.rng);
        return 'ok';
      }
      if (kind === 'lock') {
        shop.slots[a].locked = !shop.slots[a].locked;
        return 'ok';
      }
      if (kind === 'sell_weapon' || kind === 'sell_item') {
        sell(player, kind === 'sell_weapon' ? 'weapon' : 'item', a, config,
          run.state.wave, run.danger, () => refreshStats(player, config));
        return 'ok';
      }
      if (kind === 'merge') {
        merge(player, a, config, () => refreshStats(player, config));
        return 'ok';
      }
      if (kind === 'ready') {
        onReady();
        return 'ok';
      }
      return 'ok';
    },
  };
}

// --- Клиент: снимок по сети, действия событием ---------------------------
// snapshot — то, что прислал хост: {slots, ash, rerollCost, wave, weapons, items, stats}
export function remoteAdapter(getSnapshot, sendAction) {
  const player = {
    ash: 0, slots: [], items: [], stats: {},
  };

  function sync() {
    const s = getSnapshot();
    if (!s) return player;
    player.ash = s.ash;
    player.slots = s.weapons;
    player.items = s.items;
    player.stats = s.stats;
    return player;
  }

  return {
    slots: () => (getSnapshot() ? getSnapshot().slots : []),
    player: sync,
    wave: () => (getSnapshot() ? getSnapshot().wave : 1),
    rerollCost: () => (getSnapshot() ? getSnapshot().rerollCost : 0),
    act(kind, a) {
      sendAction(kind, a);
      return 'ok';
    },
  };
}

// Снимок лавки игрока для отправки клиенту. Ссылки на конфиг раскрываются в
// плоские данные: у клиента тот же конфиг, но объекты по сети не ходят.
export function shopSnapshot(run, player, shop, config) {
  const slots = [];
  for (let i = 0; i < shop.slots.length; i++) {
    const s = shop.slots[i];
    slots.push(s.cfg ? {
      kind: s.kind, id: s.id, price: s.price, locked: s.locked, sold: s.sold,
      cfg: s.cfg,
    } : { kind: null, id: null, price: 0, locked: false, sold: false, cfg: null });
  }
  const weapons = [];
  for (let i = 0; i < player.slots.length; i++) {
    weapons.push({ id: player.slots[i].id, cfg: player.slots[i].cfg });
  }
  return {
    slots,
    weapons,
    items: player.items.slice(),
    stats: Object.assign({}, player.stats),
    ash: player.ash,
    wave: run.state.wave + 1,
    rerollCost: shop.state.freeRerollsLeft > 0 ? 0 : rerollCost(config, shop.state.rerolls),
  };
}
