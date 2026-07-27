// Враги: пул, скейлинг по волне, ИИ-архетипы, урон и смерть.
// Ноль аллокаций в step: сущности из пула, соседи — через grid, буферы переиспользуются.

import { separateFromProps, slideAlong } from './arena.js';

// Архетипы M1. Остальные (charger/orbiter/splitter/bomber/summoner/support) — M4.
export const AI_CHASE = 0;
export const AI_SHOOTER = 1;

// Неподвижная цель без атаки: ломаемые объекты арены. Они живут в пуле врагов
// намеренно — так им бесплатно достаются HP, наведение оружия, урон от всех
// снарядов, снапшот и кооп-синхронизация, и не приходится дублировать всё это
// вторым пулом со своей сеткой и своими сообщениями.
export const AI_STATIC = 2;

const AI_CODE = { chase: AI_CHASE, shooter: AI_SHOOTER, static: AI_STATIC };

// Нормаль последнего выталкивания. Один объект на модуль: аллокация на кадр при
// 450 врагах — прямое нарушение бюджета (CLAUDE.md §4).
const propHit = { nx: 0, ny: 0 };
const PROP_TOUCH = 0.5;          // враг «толще» своего радиуса не лезет в завал

// Запись врага может лежать и в config.enemies, и в config.bosses — боссы это те же
// сущности с фазами и своим дропом, а не отдельная ветка кода.
export function enemyCfg(config, id) {
  return config.enemies[id] || config.bosses[id]
    || (config.breakables && config.breakables[id]);
}

export function makeEnemy() {
  return {
    uid: 0,                 // стабильный идентификатор: индексы пула переиспользуются
    boss: false, breakable: false, phase: 0, baseSpeed: 0, baseDmg: 0, baseCd: 1,
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
  e.boss = false; e.breakable = false;
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

export function initEnemy(e, config, typeId, wave, danger, players, curseFx) {
  const cfg = enemyCfg(config, typeId);
  e.uid = nextUid++;
  e.type = typeId;
  e.cfg = cfg;
  e.ai = AI_CODE[cfg.ai] !== undefined ? AI_CODE[cfg.ai] : AI_CHASE;
  e.maxHp = scaleHp(config, cfg, wave, danger, players);
  e.hp = e.maxHp;
  e.dmg = scaleDamage(config, cfg, wave, danger);
  const spdMult = curseFx && curseFx.enemy_speed_mult ? curseFx.enemy_speed_mult : 1;
  e.speed = scaleSpeed(config, cfg, wave) * spdMult;
  e.size = cfg.size;
  e.sprite = cfg.sprite || config.render.sprite_default;
  e.kbResist = cfg.knockback_resist || 0;
  e.ash = cfg.ash;
  e.xp = cfg.xp;
  e.score = cfg.score;
  e.boss = !!cfg.boss;
  e.breakable = !!cfg.breakable;
  e.phase = 0;
  e.baseSpeed = e.speed;
  e.baseDmg = e.dmg;
  e.baseCd = cfg.attack ? cfg.attack.cooldown : 1;
  e.alive = true;
  return e;
}

// Переход босса в следующую фазу при падении HP ниже её порога.
// Мутация меняет паттерн и разгоняет — по ТЗ это происходит один раз на 60% HP.
export function updatePhase(e) {
  const phases = e.cfg.phases;
  if (!phases) return false;
  const frac = e.maxHp > 0 ? e.hp / e.maxHp : 0;
  let want = 0;
  for (let i = 0; i < phases.length; i++) {
    if (frac <= phases[i].hp_pct) want = i;
  }
  if (want === e.phase) return false;
  e.phase = want;
  const ph = phases[want];
  e.speed = e.baseSpeed * (ph.speed_mult || 1);
  e.dmg = e.baseDmg * (ph.damage_mult || 1);
  if (ph.pattern === 'shooter' || ph.pattern === 'spiral') e.ai = AI_SHOOTER;
  else e.ai = AI_CHASE;
  return true;
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

    // Ломаемый объект: стоит на месте, никого не ищет и не бьёт. Выходим до
    // наведения и до контактного урона — иначе бочка «кусала» бы пробегающего.
    if (e.ai === AI_STATIC) {
      e.vx = 0;
      e.vy = 0;
      continue;
    }

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

    // Обтекание завалов. Врагу, у которого препятствие ровно между ним и целью,
    // мало выталкивания: он упрётся в него лбом и будет стоять всю волну. Убираем
    // составляющую скорости внутрь препятствия — он соскальзывает вдоль края.
    // Это не поиск пути: для орды хватает скольжения, и оно O(1) на сущность.
    if (deps.propIndex && separateFromProps(e, e.size * PROP_TOUCH, deps.propIndex, propHit)) {
      slideAlong(e, propHit.nx, propHit.ny);
    }

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
