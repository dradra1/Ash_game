// Спавн волны: бюджет, точки за краем арены, выбор типа по весам.
// Формулы — из конфига (waves / danger / coop), в коде только их применение.

import { initEnemy } from './enemy.js';
import { nearestAlivePlayer } from './enemy.js';

// Сколько врагов в секунду положено на этой волне
export function spawnBudget(config, wave, danger, players) {
  const w = config.waves;
  return (w.budget_base + w.budget_per_wave * wave)
    * danger.density
    * (1 + config.coop.budget_per_player * (players - 1));
}

// Потолок одновременно живых врагов
export function enemyCap(config, players) {
  const s = config.sim;
  return Math.min(s.max_enemies_cap, s.max_enemies_base + s.max_enemies_per_player * (players - 1));
}

// Типы, доступные на этой волне в этой арене
export function poolForWave(config, arenaId, wave, out) {
  const arena = config.arenas[arenaId];
  let n = 0;
  for (let i = 0; i < arena.enemy_pool.length; i++) {
    const id = arena.enemy_pool[i];
    const cfg = config.enemies[id];
    if (!cfg) continue;
    if (wave < cfg.min_wave) continue;
    if (cfg.max_wave !== undefined && wave > cfg.max_wave) continue;
    out[n++] = id;
  }
  return n;
}

// Точка спавна за краем арены, не ближе min_spawn_dist к любому живому игроку.
// Пишет в out {x, y}; возвращает false, если за attempts попыток не нашлось места.
export function spawnPoint(config, rng, players, out, attempts) {
  const w = config.arena.size[0];
  const h = config.arena.size[1];
  const margin = config.arena.spawn_margin;
  const minDist = config.arena.min_spawn_dist;
  const minDist2 = minDist * minDist;
  const tries = attempts || 8;

  for (let a = 0; a < tries; a++) {
    const side = rng.int(0, 3);
    let x;
    let y;
    if (side === 0) { x = rng.range(-margin, w + margin); y = -margin; }
    else if (side === 1) { x = w + margin; y = rng.range(-margin, h + margin); }
    else if (side === 2) { x = rng.range(-margin, w + margin); y = h + margin; }
    else { x = -margin; y = rng.range(-margin, h + margin); }

    let ok = true;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p.alive) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < minDist2) { ok = false; break; }
    }
    if (ok) {
      out.x = x;
      out.y = y;
      return true;
    }
  }
  return false;
}

// Планировщик спавна на волну. Копит дробный бюджет и выпускает врагов пачками.
export function createSpawner(config) {
  const typeBuf = new Array(64);
  const point = { x: 0, y: 0 };
  const state = { credit: 0, packT: 0 };

  function reset() {
    state.credit = 0;
    state.packT = 0;
  }

  // deps: {rng, players, wave, danger, arenaId, pool (пул врагов)}
  function step(dt, deps) {
    const config_ = deps.config;
    const players = deps.players;
    const cap = enemyCap(config_, players.length);
    state.credit += spawnBudget(config_, deps.wave, deps.danger, players.length) * dt;
    state.packT -= dt;
    if (state.packT > 0) return 0;

    const w = config_.waves;
    // pack_size_* задаёт МИНИМАЛЬНУЮ пачку (чтобы на ранних волнах враги шли группами,
    // а не по одному), а не потолок: потолок — накопленный бюджет. Иначе формула
    // бюджета из ТЗ ни на что не влияла бы, и на 20-й волне вместо толпы приходило
    // бы 7 врагов в секунду.
    const minPack = Math.max(1, Math.round(w.pack_size_base + w.pack_size_per_wave * deps.wave));
    if (state.credit < 1) return 0;
    const packSize = Math.max(minPack, Math.floor(state.credit));

    const nTypes = poolForWave(config_, deps.arenaId, deps.wave, typeBuf);
    if (nTypes === 0) return 0;

    let spawned = 0;
    const want = Math.min(packSize, Math.floor(state.credit));
    for (let i = 0; i < want; i++) {
      if (deps.pool.count >= cap) break;            // деградация, а не рост
      if (!spawnPoint(config_, deps.rng, players, point)) break;
      const e = deps.pool.spawn();
      if (!e) break;                                 // пул кончился — тоже деградация
      const typeId = pickType(config_, deps.rng, typeBuf, nTypes);
      initEnemy(e, config_, typeId, deps.wave, deps.danger, players.length);
      e.x = point.x;
      e.y = point.y;
      const target = nearestAlivePlayer(players, e.x, e.y);
      if (target) {
        const dx = target.x - e.x;
        const dy = target.y - e.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        e.vx = (dx / d) * e.speed;
        e.vy = (dy / d) * e.speed;
      }
      state.credit -= 1;
      spawned++;
    }
    if (spawned > 0) state.packT = config_.waves.pack_interval;
    return spawned;
  }

  function pickType(config_, rng, buf, n) {
    let total = 0;
    for (let i = 0; i < n; i++) total += config_.enemies[buf[i]].weight;
    let roll = rng.float() * total;
    for (let i = 0; i < n; i++) {
      roll -= config_.enemies[buf[i]].weight;
      if (roll <= 0) return buf[i];
    }
    return buf[n - 1];
  }

  return { step, reset, state };
}
