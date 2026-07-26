// Резолв статов и боевая арифметика. Все коэффициенты — из конфига.
//
// M1: база персонажа. M2 добавит сюда предметы и левелапы — API рассчитан на это:
// resolveStats заполняет переданный объект, а не создаёт новый, и принимает
// произвольные источники модификаторов.

// Ключи вида "<stat>_pct" в модификаторах персонажа — процентные к базе
// (например max_hp_pct: -20). Остальные — плоские прибавки.
const PCT_SUFFIX = '_pct';

// Какой стат добавляется к урону оружия в зависимости от его класса
const CLASS_STAT = { melee: 'melee_dmg', ranged: 'ranged_dmg', elem: 'elem_dmg', engi: 'engineering' };

export function createStats(config) {
  const out = {};
  const order = config.stats.order;
  for (let i = 0; i < order.length; i++) out[order[i]] = 0;
  return out;
}

// Заполняет out базой + модификаторами. sources — массив объектов вида
// {max_hp: 4, damage_pct: 10, max_hp_pct: -20}; null-элементы пропускаются.
export function resolveStats(out, config, sources) {
  const base = config.player.base;
  const order = config.stats.order;
  for (let i = 0; i < order.length; i++) out[order[i]] = base[order[i]] || 0;

  // Процентные модификаторы копятся отдельно и применяются после всех плоских,
  // иначе порядок предметов в инвентаре влиял бы на результат.
  const pct = PCT_ACC;
  for (const k in pct) delete pct[k];

  for (let s = 0; s < sources.length; s++) {
    const mods = sources[s];
    if (!mods) continue;
    for (const key in mods) {
      if (key.length > 4 && key.slice(-4) === PCT_SUFFIX && out[key] === undefined) {
        const target = key.slice(0, -4);
        if (out[target] !== undefined) {
          pct[target] = (pct[target] || 0) + mods[key];
          continue;
        }
      }
      if (out[key] !== undefined) out[key] += mods[key];
    }
  }

  for (const target in pct) out[target] *= 1 + pct[target] / 100;

  const minHp = config.stats.min_max_hp;
  out.max_hp = Math.max(minHp, Math.round(out.max_hp));
  return out;
}

// Аккумулятор процентных модификаторов, переиспользуется между вызовами:
// resolveStats зовётся редко (старт забега, покупка, левелап), но плодить мусор незачем.
const PCT_ACC = {};

export function moveSpeed(config, stats) {
  return config.player.move_speed * (1 + stats.move_speed_pct / 100);
}

// Множитель урона, который проходит сквозь броню. Потолок снижения — armor_cap.
export function armorFactor(config, armor) {
  if (armor <= 0) return 1;
  const cut = armor / (armor + config.stats.armor_k);
  return 1 - Math.min(config.stats.armor_cap, cut);
}

export function dodgeChance(config, stats) {
  return Math.min(config.stats.dodge_cap, stats.dodge_pct) / 100;
}

// Базовый урон оружия с учётом статов владельца. Крит считается отдельно (нужен rng).
export function weaponDamage(weapon, stats) {
  const scaling = weapon.scaling || EMPTY;
  const classStat = CLASS_STAT[weapon.class];
  let dmg = weapon.damage;
  if (classStat && scaling[classStat]) dmg += stats[classStat] * scaling[classStat];
  const globalScale = scaling.damage_pct === undefined ? 1 : scaling.damage_pct;
  dmg *= 1 + (stats.damage_pct * globalScale) / 100;
  return dmg > 0 ? dmg : 0;
}

// Кулдаун с учётом скорости атаки. У ближнего оружия стат range ещё и удорожает
// замах — иначе «дальность» была бы для него бесплатным апгрейдом.
export function weaponCooldown(config, weapon, stats) {
  const haste = 1 + stats.attack_speed_pct / 100;
  let cd = weapon.cooldown / (haste > 0.1 ? haste : 0.1);
  if (weapon.class === 'melee' && stats.range > 0) {
    cd *= 1 + stats.range * config.stats.range_melee_cooldown_pct;
  }
  return cd;
}

// Дальность оружия с учётом стата range: у ближнего — вполсилы (range_melee_factor).
export function weaponRange(config, weapon, stats) {
  if (stats.range === 0) return weapon.range;
  const step = config.stats.range_step_px;
  const factor = weapon.class === 'melee' ? config.stats.range_melee_factor : 1;
  return weapon.range + stats.range * step * factor;
}

export function critChance(weapon, stats) {
  const c = stats.crit_pct + (weapon.crit_pct || 0);
  return c > 100 ? 1 : c / 100;
}

const EMPTY = {};
