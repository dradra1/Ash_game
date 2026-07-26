// Враги: пул, скейлинг по волне, ИИ-архетипы, урон и смерть.
// Ноль аллокаций в step: сущности из пула, соседи — через grid, буферы переиспользуются.

// Архетипы M1. Остальные (charger/orbiter/splitter/bomber/summoner/support) — M4.
export const AI_CHASE = 0;
export const AI_SHOOTER = 1;

const AI_CODE = { chase: AI_CHASE, shooter: AI_SHOOTER };

export function makeEnemy() {
  return {
    uid: 0,                 // стабильный идентификатор: индексы пула переиспользуются
    type: null, cfg: null, ai: AI_CHASE,
    x: 0, y: 0, vx: 0, vy: 0,
    hp: 0, maxHp: 0, dmg: 0, speed: 0, size: 0, sprite: 0,
    dir: 0, frame: 0, animT: 0,
    targetId: -1, retargetT: 0, atkCd: 0, contactCd: 0,
    kbX: 0, kbY: 0, kbResist: 0,
    ash: 0, xp: 0, score: 0,
    alive: false,
  };
}

export function resetEnemy(e) {
  e.alive = false;
  e.vx = 0; e.vy = 0;
  e.kbX = 0; e.kbY = 0;
  e.targetId = -1; e.retargetT = 0; e.atkCd = 0; e.contactCd = 0;
  e.frame = 0; e.animT = 0;
}

// Характеристики врага на данной волне. Формулы — строго из конфига (waves/danger/coop).
export function scaleHp(config, cfg, wave, danger, players) {
  const w = config.waves;
  return cfg.hp
    * (1 + w.hp_growth * (wave - 1))
    * danger.hp_mult
    * (1 + config.coop.hp_per_player * (players - 1));
}

export function scaleDamage(config, cfg, wave, danger) {
  return cfg.damage * (1 + config.waves.dmg_growth * (wave - 1)) * danger.dmg_mult;
}

export function scaleSpeed(config, cfg, wave) {
  const w = config.waves;
  const mult = Math.min(w.speed_cap, 1 + w.speed_growth * (wave - 1));
  return cfg.speed * mult;
}

// Заселение сущности из пула конкретным типом врага
let nextUid = 1;

export function initEnemy(e, config, typeId, wave, danger, players) {
  const cfg = config.enemies[typeId];
  e.uid = nextUid++;
  e.type = typeId;
  e.cfg = cfg;
  e.ai = AI_CODE[cfg.ai] !== undefined ? AI_CODE[cfg.ai] : AI_CHASE;
  e.maxHp = scaleHp(config, cfg, wave, danger, players);
  e.hp = e.maxHp;
  e.dmg = scaleDamage(config, cfg, wave, danger);
  e.speed = scaleSpeed(config, cfg, wave);
  e.size = cfg.size;
  e.sprite = cfg.sprite || config.render.sprite_default;
  e.kbResist = cfg.knockback_resist || 0;
  e.ash = cfg.ash;
  e.xp = cfg.xp;
  e.score = cfg.score;
  e.alive = true;
  return e;
}

// Шаг всех врагов. Возвращает число живых.
// deps: {config, players, grid (сетка игроков), queryBuf, rng, fireProjectile, hitPlayer}
export function stepEnemies(pool, dt, deps) {
  const config = deps.config;
  const players = deps.players;
  const retargetInterval = config.waves.retarget_interval;
  const kbDecay = config.sim.knockback_decay;
  const contactCd = config.sim.enemy_contact_cooldown;

  for (let i = 0; i < pool.count; i++) {
    const e = pool.items[i];

    // Перевыбор цели — раз в retarget_interval, а не каждый кадр:
    // каждый кадр это и дёргает врага, и стоит CPU на толпе в 450 штук.
    e.retargetT -= dt;
    let target = null;
    if (e.targetId >= 0) {
      target = findPlayer(players, e.targetId);
      if (target && !target.alive) target = null;
    }
    if (!target || e.retargetT <= 0) {
      target = nearestAlivePlayer(players, e.x, e.y);
      e.targetId = target ? target.id : -1;
      e.retargetT = retargetInterval;
    }

    if (target) {
      const dx = target.x - e.x;
      const dy = target.y - e.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      if (e.ai === AI_SHOOTER) {
        const atk = e.cfg.attack;
        const keep = atk.keep_dist;
        // Держать дистанцию: подходить дальше keep, отходить ближе 0.7*keep
        if (dist > keep) {
          e.vx = (dx / dist) * e.speed;
          e.vy = (dy / dist) * e.speed;
        } else if (dist < keep * 0.7) {
          e.vx = (-dx / dist) * e.speed;
          e.vy = (-dy / dist) * e.speed;
        } else {
          e.vx = 0;
          e.vy = 0;
        }
        e.atkCd -= dt;
        if (e.atkCd <= 0 && dist <= atk.range) {
          e.atkCd = atk.cooldown;
          deps.fireProjectile(e, dx / dist, dy / dist);
        }
      } else {
        e.vx = (dx / dist) * e.speed;
        e.vy = (dy / dist) * e.speed;
      }

      // Контактный урон с внутренним кулдауном
      e.contactCd -= dt;
      const touch = e.size + target.radius;
      if (e.contactCd <= 0 && dist <= touch) {
        e.contactCd = contactCd;
        deps.hitPlayer(target, e.dmg, dx / dist, dy / dist);
      }
    } else {
      e.vx = 0;
      e.vy = 0;
    }

    // Отбрасывание затухает экспоненциально
    if (e.kbX !== 0 || e.kbY !== 0) {
      const decay = Math.max(0, 1 - kbDecay * dt);
      e.kbX *= decay;
      e.kbY *= decay;
      if (Math.abs(e.kbX) < 1) e.kbX = 0;
      if (Math.abs(e.kbY) < 1) e.kbY = 0;
    }

    e.x += (e.vx + e.kbX) * dt;
    e.y += (e.vy + e.kbY) * dt;

    // Направление спрайта по доминирующей оси
    const mx = e.vx + e.kbX;
    const my = e.vy + e.kbY;
    if (mx !== 0 || my !== 0) {
      if (mx * mx > my * my) e.dir = mx > 0 ? 1 : 3;
      else e.dir = my > 0 ? 0 : 2;
      e.animT += dt;
    }
  }
  return pool.count;
}

function findPlayer(players, id) {
  for (let i = 0; i < players.length; i++) {
    if (players[i].id === id) return players[i];
  }
  return null;
}

// Ближайший живой игрок. Игроков максимум 8 — линейный перебор дешевле сетки.
export function nearestAlivePlayer(players, x, y) {
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p.alive) continue;
    const dx = p.x - x;
    const dy = p.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
