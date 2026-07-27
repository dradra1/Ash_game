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
    allies: () => allyRoster(run),
    meReady: () => !!run.state.ready[player.id],
    wave: () => run.state.wave + 1,
    rerollCost: () => {
      if (shop.state.freeRerollsLeft > 0) return 0;
      return rerollCost(config, shop.state.rerolls);
    },

    act(kind, a) {
      if (kind === 'buy' || kind === 'buy_merge') {
        const res = buy(player, shop, a, config, run.wallet,
          () => refreshStats(player, config), kind === 'buy_merge');
        if (res === 'ok' && run.noteShopBuy) run.noteShopBuy();
        return res;
      }
      if (kind === 'reroll') {
        shop.reroll(player, run.danger, run.rng, run.wallet);
        return 'ok';
      }
      if (kind === 'lock') {
        shop.slots[a].locked = !shop.slots[a].locked;
        return 'ok';
      }
      if (kind === 'sell_weapon' || kind === 'sell_item') {
        sell(player, kind === 'sell_weapon' ? 'weapon' : 'item', a, config,
          run.state.wave, run.danger, run.wallet, () => refreshStats(player, config));
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

// Кто в комнате и кто уже отчитался готовым. В соло список из одного человека —
// UI сам решает, показывать ли ростер (CLAUDE.md §2: соло = комната из одного).
function allyRoster(run) {
  const out = [];
  const players = run.state.players;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    out.push({
      name: p.name, character: p.character,
      ready: !!run.state.ready[p.id], alive: p.alive,
    });
  }
  return out;
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
    allies: () => (getSnapshot() ? getSnapshot().allies || [] : []),
    meReady: () => (getSnapshot() ? !!getSnapshot().meReady : false),
    wave: () => (getSnapshot() ? getSnapshot().wave : 1),
    rerollCost: () => (getSnapshot() ? getSnapshot().rerollCost : 0),
    act(kind, a) {
      sendAction(kind, a);
      return 'ok';
    },
  };
}

// Снимок экипировки игрока: то, что меняется РЕДКО (покупка, продажа, слияние,
// левелап, старт волны) и потому едет надёжным событием, а не в снапшоте 20 Гц.
//
// Без него у кооп-клиента net/client.js создавал игрока с пустыми slots/stats и
// никогда их не заполнял: полоса оружия в HUD была пуста, а предсказание движения
// шло базовой скоростью, игнорируя move_speed_pct.
export function loadoutSnapshot(player) {
  const weapons = [];
  for (let i = 0; i < player.slots.length; i++) weapons.push(player.slots[i].id);
  return {
    weapons,
    items: player.items.slice(),
    stats: Object.assign({}, player.stats),
    maxHp: player.maxHp,
    level: player.level,
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
    allies: allyRoster(run),
    meReady: !!run.state.ready[player.id],
    wave: run.state.wave + 1,
    rerollCost: shop.state.freeRerollsLeft > 0 ? 0 : rerollCost(config, shop.state.rerolls),
  };
}
