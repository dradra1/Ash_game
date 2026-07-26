// Левелап: XP-кривая и генерация вариантов улучшения.
//
// Выбор редкости (обычный → легендарный) зависит от удачи игрока.
// Фаза LEVELUP и пауза — забота run.js / UI; этот модуль только крутит пул.

function makeChoice() {
  return {
    stat: null, value: 0, name: '', texture: null, color: null,
    kind: 'flat', rarity: 'common', rarityIndex: 0,
  };
}

export function createLevelUp(config) {
  const n = config.level.choices;
  const choices = new Array(n);
  for (let i = 0; i < n; i++) choices[i] = makeChoice();

  const keys = [];
  for (const k in config.level.pool) keys.push(k);
  const taken = new Array(n);

  const rarities = config.level.rarities || DEFAULT_RARITIES;
  const rarityColors = config.level.rarity_colors || DEFAULT_RARITY_COLORS;
  const luckShift = config.level.luck_rarity_shift != null
    ? config.level.luck_rarity_shift
    : (config.level.reroll_weight_luck || 0.02);

  function weightOf(key, player) {
    const entry = config.level.pool[key];
    let w = entry.weight;
    const cw = config.characters[player.character].levelup_weights;
    if (cw && cw[key] !== undefined) w *= cw[key];
    return w > 0 ? w : 0;
  }

  // Редкость: веса сдвигаются удачей в сторону более высоких тиров.
  function rollRarity(player, rng) {
    const luck = (player.stats && player.stats.luck) || 0;
    let total = 0;
    const weights = new Array(rarities.length);
    for (let i = 0; i < rarities.length; i++) {
      // Чем выше индекс редкости, тем сильнее бонус от удачи
      const w = rarities[i].weight * (1 + luck * luckShift * i);
      weights[i] = w;
      total += w;
    }
    let r = rng.float() * total;
    for (let i = 0; i < rarities.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return rarities.length - 1;
  }

  function valueFor(entry, rarityIndex) {
    const steps = entry.steps;
    if (!steps || !steps.length) return 1;
    const idx = Math.min(rarityIndex, steps.length - 1);
    return steps[idx];
  }

  function fillChoice(c, pick, player, rng) {
    const meta = config.stats.meta[pick];
    const ri = rollRarity(player, rng);
    c.stat = pick;
    c.rarityIndex = ri;
    c.rarity = rarities[ri].id;
    c.value = valueFor(config.level.pool[pick], ri);
    c.name = meta.name;
    c.texture = meta.texture;
    c.color = rarityColors[ri] || meta.color;
    c.kind = meta.kind;
  }

  function roll(player, rng) {
    for (let i = 0; i < taken.length; i++) taken[i] = null;

    for (let i = 0; i < choices.length; i++) {
      let total = 0;
      for (let k = 0; k < keys.length; k++) {
        if (isTaken(keys[k], i)) continue;
        total += weightOf(keys[k], player);
      }
      let pick = keys[0];
      if (total > 0) {
        let r = rng.float() * total;
        for (let k = 0; k < keys.length; k++) {
          if (isTaken(keys[k], i)) continue;
          r -= weightOf(keys[k], player);
          if (r <= 0) { pick = keys[k]; break; }
        }
      }
      taken[i] = pick;
      fillChoice(choices[i], pick, player, rng);
    }
    return choices;
  }

  // Автовыбор: первый вариант из свежего ролла (веса уже учтены).
  function autoPick(player, rng) {
    const rolled = roll(player, rng);
    return {
      stat: rolled[0].stat,
      value: rolled[0].value,
      rarity: rolled[0].rarity,
      rarityIndex: rolled[0].rarityIndex,
      kind: rolled[0].kind,
      name: rolled[0].name,
      texture: rolled[0].texture,
      color: rolled[0].color,
    };
  }

  function isTaken(key, upTo) {
    for (let i = 0; i < upTo; i++) {
      if (taken[i] === key) return true;
    }
    return false;
  }

  return { roll, autoPick, choices, rarities, rarityColors };
}

export function xpToNext(config, level) {
  const f = config.level.xp_formula;
  return Math.round(f.base + f.k * Math.pow(level, f.pow));
}

const DEFAULT_RARITIES = [
  { id: 'common', weight: 50 },
  { id: 'uncommon', weight: 25 },
  { id: 'rare', weight: 15 },
  { id: 'epic', weight: 7 },
  { id: 'legendary', weight: 3 },
];

const DEFAULT_RARITY_COLORS = [
  '#9aa0a8', '#6a9fc8', '#a86ac8', '#e0a03a', '#e85a3a',
];
