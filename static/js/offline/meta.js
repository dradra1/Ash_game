// Порт meta.py для офлайн-сборки: реликвии, ачивки, цены открытий.
// Формулы обязаны совпадать с серверными один в один — tests/js/offline.test.js
// сверяет их на тех же входах, что tests/py. Плаузибилити-проверок (check_run)
// здесь нет: офлайн игрок жульничает только против себя.

export function gainMult(config) {
  const g = config.meta.relic_formula.gain_mult;
  return g === undefined ? 1.0 : g;
}

// Python round() — банковское округление; Math.round на .5 уходит вверх.
export function pyRound(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (Math.abs(diff - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

function tableMult(config, curses, key) {
  let mult = 1.0;
  const table = config.curses || {};
  for (const cid of curses || []) {
    const entry = table[cid];
    if (!entry) continue;
    const m = (entry.effects || {})[key];
    if (m) mult *= Number(m);
  }
  return mult;
}

export function curseRewardMult(config, run) {
  return tableMult(config, run.curses, 'reward_mult');
}

export function awardRelics(config, run, wave, win, bosses, players) {
  const f = config.meta.relic_formula;
  let danger = run.danger != null ? run.danger : 0;
  danger = Math.max(0, Math.min(danger, config.danger.length - 1));
  const rewardMult = config.danger[danger].reward_mult;
  const coopMult = 1 + f.coop_per_player * Math.max(0, players - 1);
  const base = f.per_wave * wave + f.win * (win ? 1 : 0) + f.per_boss * bosses;
  return pyRound(base * rewardMult * coopMult * curseRewardMult(config, run) * gainMult(config));
}

// runs — вся история профиля, текущий забег в ней уже записан (как в SQL-версии,
// где он исключается по id).
export function firstClearBonus(config, runs, run, win) {
  if (!win) return 0;
  const bonus = config.meta.first_clear_bonus || 0;
  if (bonus <= 0) return 0;
  let total = 0;
  for (const col of ['character', 'arena', 'danger']) {
    const value = run[col];
    if (value == null) continue;
    let n = 0;
    for (const r of runs) {
      if (r.run_id !== run.run_id && r.win && r[col] === value) n++;
    }
    if (n === 0) total += bonus;
  }
  return pyRound(total * gainMult(config));
}

export function runStats(runs) {
  const s = {
    best_wave: 0, wins: 0, losses: 0, bosses: 0, kills: 0, damage_taken: 0,
    ash_gained: 0, shop_buys: 0, best_danger: -1, best_coop: 0,
  };
  for (const r of runs) {
    if (!r.finished_at) continue;
    s.best_wave = Math.max(s.best_wave, r.wave || 0);
    if (r.win) {
      s.wins++;
      s.best_danger = Math.max(s.best_danger, r.danger);
      s.best_coop = Math.max(s.best_coop, r.players || 1);
    } else {
      s.losses++;
    }
    s.bosses += r.bosses || 0;
    s.kills += r.kills || 0;
    s.damage_taken += r.damage_taken || 0;
    s.ash_gained += r.ash_gained || 0;
    s.shop_buys += r.shop_buys || 0;
  }
  return s;
}

const ACH_STAT = {
  reach_wave: 'best_wave', wins: 'wins', win_danger: 'best_danger', win_coop: 'best_coop',
  bosses: 'bosses', kills: 'kills', damage_taken: 'damage_taken',
  ash_gained: 'ash_gained', losses: 'losses', shop_buys: 'shop_buys',
};

export function checkAchievements(config, runs, earnedIds) {
  const earned = new Set(earnedIds);
  const stats = runStats(runs);
  const fresh = [];
  const table = config.achievements || {};
  for (const aid in table) {
    if (earned.has(aid)) continue;
    const cond = table[aid].cond;
    const key = ACH_STAT[cond.type];
    if (key && stats[key] >= cond.value) fresh.push(aid);
  }
  return fresh;
}

const KIND_TABLE = { faction: 'factions', character: 'characters', arena: 'arenas', weapon: 'weapons' };

export function unlockPrice(config, kind, id, hasAchievement) {
  const tbl = KIND_TABLE[kind];
  if (!tbl) return [null, null];
  const entry = (config[tbl] || {})[id];
  if (!entry) return [null, null];
  const unlock = entry.unlock || {};
  if (unlock.type === 'default') return [null, null];
  let cost;
  if (kind === 'weapon') {
    cost = config.meta.weapon_unlock_price[String(unlock.tier != null ? unlock.tier : 1)];
  } else {
    cost = unlock.cost;
  }
  if (cost == null) return [null, null];
  const needAch = unlock.achievement || null;
  if (needAch && hasAchievement(needAch)) {
    cost = pyRound(cost * config.meta.achievement_discount);
  }
  return [Math.trunc(cost), needAch];
}

export function requirementsMet(config, kind, id, unlocks) {
  if (kind !== 'character') return true;
  const ch = config.characters[id];
  if (!ch) return false;
  const fac = config.factions[ch.faction] || {};
  if ((fac.unlock || {}).type === 'default') return true;
  return (unlocks.faction || []).includes(ch.faction);
}

export function upgradePrice(config, upgradeId, rank) {
  for (const up of config.meta.upgrades || []) {
    if (up.id !== upgradeId) continue;
    if (rank >= up.max_ranks) return [null, up];
    const prices = up.price;
    return [Math.trunc(prices[Math.min(rank, prices.length - 1)]), up];
  }
  return [null, null];
}
