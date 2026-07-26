// Оружие: слоты, кулдауны, автопоиск цели, атака. Игрок не целится сам.
//
// Цель ищется не каждый кадр: перевыбор раз в waves.retarget_interval, между
// перевыборами бьём по сохранённой цели, пока она жива и в радиусе.

import { weaponCooldown, weaponRange, weaponDamage, critChance } from './stats.js';

export function makeSlot() {
  // targetIdx + targetUid — пара «индекс и поколение»: индекс даёт O(1) доступ,
  // uid проверяет, что по этому индексу всё ещё тот же враг (пул делает swap-remove).
  // swingT — остаток анимации удара. Считает ВРЕМЯ, а не кадры: рендер берёт из
  // него прогресс 0..1 и получает позу из engine/weapon_anim.js.
  return {
    id: null, cfg: null, cd: 0, targetIdx: -1, targetUid: -1, retargetT: 0,
    lastAngle: 0, flash: 0, swingT: 0, swingLen: 0,
  };
}

export function equip(slot, weaponId, config) {
  slot.id = weaponId;
  slot.cfg = config.weapons[weaponId];
  slot.cd = 0;
  slot.targetIdx = -1;
  slot.targetUid = -1;
  slot.retargetT = 0;
  return slot;
}

// Ближайший живой враг в радиусе. Только через сетку — на 450 врагах перебор недопустим.
function findTarget(x, y, range, deps) {
  const n = deps.enemyGrid.query(x, y, range, deps.queryBuf);
  let bestIdx = -1;
  let bestD = Infinity;
  for (let k = 0; k < n; k++) {
    const idx = deps.queryBuf[k];
    if (idx >= deps.enemyPool.count) continue;
    const e = deps.enemyPool.items[idx];
    if (!e.alive) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      bestIdx = idx;
    }
  }
  return bestIdx;
}

// Шаг всех слотов одного игрока.
// deps: {config, rng, enemyPool, enemyGrid, queryBuf, projPool, damageEnemy}
export function stepWeapons(player, dt, deps) {
  const config = deps.config;
  const stats = player.stats;
  const retarget = config.waves.retarget_interval;
  const slots = player.slots;

  for (let s = 0; s < slots.length; s++) {
    const slot = slots[s];
    if (!slot.cfg) continue;
    const w = slot.cfg;

    if (slot.flash > 0) slot.flash -= dt;
    if (slot.swingT > 0) slot.swingT -= dt;
    slot.cd -= dt;
    if (slot.cd > 0) continue;

    const range = weaponRange(config, w, stats);

    // Держимся за прежнюю цель, пока она валидна
    let idx = -1;
    slot.retargetT -= dt;
    if (slot.targetUid >= 0 && slot.retargetT > 0 && slot.targetIdx < deps.enemyPool.count) {
      const e = deps.enemyPool.items[slot.targetIdx];
      if (e.uid === slot.targetUid && e.alive) {
        const dx = e.x - player.x;
        const dy = e.y - player.y;
        if (dx * dx + dy * dy <= range * range) idx = slot.targetIdx;
      }
    }
    if (idx < 0) {
      idx = findTarget(player.x, player.y, range, deps);
      slot.targetIdx = idx;
      slot.targetUid = idx >= 0 ? deps.enemyPool.items[idx].uid : -1;
      slot.retargetT = retarget;
    }
    if (idx < 0) continue;

    const target = deps.enemyPool.items[idx];
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    slot.lastAngle = Math.atan2(dy, dx);
    const cd = weaponCooldown(config, w, stats);
    slot.cd = cd;
    slot.flash = FLASH_TIME;
    // Замах не должен длиться дольше кулдауна, иначе быстрое оружие анимируется
    // внахлёст само на себя и поза дёргается назад посреди движения.
    slot.swingLen = Math.min(w.shape.anim_time || DEFAULT_SWING, cd);
    slot.swingT = slot.swingLen;

    const dmg = weaponDamage(w, stats);
    const shape = w.shape;

    if (shape.type === 'arc') {
      swingArc(player, w, shape, range, nx, ny, dmg, deps);
    } else {
      fireShots(player, w, shape, nx, ny, dmg, deps);
    }
  }
}

// Ближний удар: мгновенный урон всем врагам в секторе angle в сторону цели
function swingArc(player, w, shape, range, nx, ny, dmg, deps) {
  const half = (shape.angle * Math.PI) / 360;   // половина сектора в радианах
  const cosHalf = Math.cos(half);
  const n = deps.enemyGrid.query(player.x, player.y, range, deps.queryBuf);
  for (let k = 0; k < n; k++) {
    const idx = deps.queryBuf[k];
    if (idx >= deps.enemyPool.count) continue;
    const e = deps.enemyPool.items[idx];
    if (!e.alive) continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    if (d > range + e.size) continue;
    if ((dx / d) * nx + (dy / d) * ny < cosHalf) continue;   // вне сектора
    const crit = deps.rng.float() < critChance(w, player.stats);
    const out = crit ? dmg * deps.config.stats.crit_mult : dmg;
    deps.damageEnemy(idx, out, crit, dx / d, dy / d,
      w.knockback + player.stats.knockback, player.id);
  }
}

// Дальний выстрел: count снарядов с разбросом spread градусов
function fireShots(player, w, shape, nx, ny, dmg, deps) {
  const count = shape.count || 1;
  const spread = ((shape.spread || 0) * Math.PI) / 180;
  const baseAngle = Math.atan2(ny, nx);
  for (let i = 0; i < count; i++) {
    const p = deps.projPool.spawn();
    if (!p) return;                                  // пул полон — деградация
    const offset = count === 1
      ? (spread ? deps.rng.range(-spread / 2, spread / 2) : 0)
      : -spread / 2 + (spread * i) / (count - 1);
    const a = baseAngle + offset;
    const crit = deps.rng.float() < critChance(w, player.stats);
    p.alive = true;
    p.x = player.x;
    p.y = player.y;
    p.vx = Math.cos(a) * shape.speed;
    p.vy = Math.sin(a) * shape.speed;
    p.ttl = shape.ttl;
    p.dmg = crit ? dmg * deps.config.stats.crit_mult : dmg;
    p.crit = crit;
    p.pierce = shape.pierce || 0;
    p.size = shape.size || DEFAULT_PROJECTILE_SIZE;
    p.hostile = false;
    p.texture = shape.texture || null;
    p.spin = shape.spin || null;
    p.color = w.color || null;
    p.age = 0;
    p.ownerId = player.id;
    p.knockback = w.knockback + player.stats.knockback;
    p.hitCount = 0;
  }
}

const FLASH_TIME = 0.08;                 // подсветка иконки оружия в HUD после удара
const DEFAULT_SWING = 0.22;              // длительность замаха, если её нет в конфиге
const DEFAULT_PROJECTILE_SIZE = 4;
