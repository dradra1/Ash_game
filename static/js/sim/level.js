// Левелап: XP-кривая и генерация вариантов улучшения.
//
// В соло игра ставится на паузу, в коопе — нет: модалка висит поверх боя, выбор
// можно отложить, очередь копится (player.pendingLevels), при неответе к концу
// волны выбор делается автоматически по весам. Пауза — забота UI, не этого модуля.

// Один вариант улучшения. Объекты переиспользуются: левелап случается часто.
function makeChoice() {
  return { stat: null, value: 0, name: '', texture: null, color: null, kind: 'flat' };
}

export function createLevelUp(config) {
  const n = config.level.choices;
  const choices = new Array(n);
  for (let i = 0; i < n; i++) choices[i] = makeChoice();

  const keys = [];
  for (const k in config.level.pool) keys.push(k);
  const taken = new Array(n);

  // Вес стата для игрока: базовый × персональный множитель × поправка на удачу.
  // Удача поднимает шанс редких (тяжёлых) статов, а не «хороших» вообще.
  function weightOf(key, player) {
    const entry = config.level.pool[key];
    let w = entry.weight;
    const cw = config.characters[player.character].levelup_weights;
    if (cw && cw[key] !== undefined) w *= cw[key];
    return w > 0 ? w : 0;
  }

  // Ступень улучшения: чем больше уровень и удача, тем чаще берётся крупная
  function stepFor(entry, player, rng) {
    const steps = entry.steps;
    const luckShift = player.stats.luck * config.level.reroll_weight_luck;
    const roll = rng.float() + luckShift;
    if (roll > 0.85) return steps[steps.length - 1];
    if (roll > 0.55) return steps[Math.min(1, steps.length - 1)];
    return steps[0];
  }

  // Заполняет и возвращает массив вариантов (без аллокаций)
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

      const meta = config.stats.meta[pick];
      const c = choices[i];
      c.stat = pick;
      c.value = stepFor(config.level.pool[pick], player, rng);
      c.name = meta.name;
      c.texture = meta.texture;
      c.color = meta.color;
      c.kind = meta.kind;
    }
    return choices;
  }

  function isTaken(key, upTo) {
    for (let i = 0; i < upTo; i++) {
      if (taken[i] === key) return true;
    }
    return false;
  }

  return { roll, choices };
}

export function xpToNext(config, level) {
  const f = config.level.xp_formula;
  return Math.round(f.base + f.k * Math.pow(level, f.pow));
}
