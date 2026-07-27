// Резолв эффектов проклятий забега. Чистые формулы — без аллокаций в тике.

const MULT_KEYS = [
  'density_mult', 'enemy_dmg_mult', 'enemy_speed_mult', 'player_move_speed_mult',
  'max_hp_mult', 'ash_drop_mult', 'shop_price_mult', 'wave_len_mult', 'xp_mult',
  'reward_mult',
];
const FLAT_KEYS = ['tithe', 'damage_pct', 'free_rerolls', 'ash_per_kill'];

export function emptyCurseFx() {
  return {
    density_mult: 1,
    enemy_dmg_mult: 1,
    enemy_speed_mult: 1,
    player_move_speed_mult: 1,
    max_hp_mult: 1,
    ash_drop_mult: 1,
    shop_price_mult: 1,
    wave_len_mult: 1,
    xp_mult: 1,
    reward_mult: 1,
    tithe: 0,
    damage_pct: 0,
    free_rerolls: 0,
    // Прах прямо в котёл за каждое убийство, без пикапа на полу: так работает
    // «Десятина без праха», где на землю не падает ничего.
    ash_per_kill: 0,
    ash_drop_zero: false,
    shop_free: false,
    ids: [],
  };
}

/** Сложить эффекты выбранных проклятий: множители ×, flat +, флаги OR. */
export function resolveCurseFx(config, curseIds) {
  const out = emptyCurseFx();
  const table = config.curses || EMPTY;
  if (!curseIds || !curseIds.length) return out;
  for (let i = 0; i < curseIds.length; i++) {
    const id = curseIds[i];
    const entry = table[id];
    if (!entry || !entry.effects) continue;
    out.ids.push(id);
    const fx = entry.effects;
    for (let k = 0; k < MULT_KEYS.length; k++) {
      const key = MULT_KEYS[k];
      if (fx[key] !== undefined && fx[key] !== null) out[key] *= fx[key];
    }
    for (let k = 0; k < FLAT_KEYS.length; k++) {
      const key = FLAT_KEYS[k];
      if (fx[key]) out[key] += fx[key];
    }
    if (fx.ash_drop_zero) out.ash_drop_zero = true;
    if (fx.shop_free) out.shop_free = true;
  }
  return out;
}

/** Источник статов игрока из curseFx (кладётся в player.sources). */
export function curseStatMods(fx) {
  const mods = {};
  if (fx.player_move_speed_mult !== 1) {
    mods.move_speed_pct = (fx.player_move_speed_mult - 1) * 100;
  }
  if (fx.max_hp_mult !== 1) {
    mods.max_hp_pct = (fx.max_hp_mult - 1) * 100;
  }
  if (fx.damage_pct) mods.damage_pct = fx.damage_pct;
  if (fx.tithe) mods.tithe = fx.tithe;
  return mods;
}

/** Эффективная сложность с учётом проклятий (копия, без мутации конфига). */
export function applyCurseToDanger(danger, fx) {
  return {
    id: danger.id,
    name: danger.name,
    hp_mult: danger.hp_mult,
    dmg_mult: danger.dmg_mult * fx.enemy_dmg_mult,
    density: danger.density * fx.density_mult,
    elite_from: danger.elite_from,
    price_mult: danger.price_mult * fx.shop_price_mult,
    reward_mult: danger.reward_mult,
    ash_mult: danger.ash_mult != null ? danger.ash_mult : 1,
    bosses_final: danger.bosses_final != null ? danger.bosses_final : 1,
    elite_wave_every: danger.elite_wave_every,
  };
}

const EMPTY = {};
