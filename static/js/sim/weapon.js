// Оружие: слоты, кулдауны, автопоиск цели, атака. Игрок не целится сам.
//
// Цель ищется не каждый кадр: перевыбор раз в waves.retarget_interval, между
// перевыборами бьём по сохранённой цели, пока она жива и в радиусе.
//
// Шаг слота вынесен из stepWeapons в отдельный stepSlot: ровно тот же слот
// крутит и турель (sim/turret.js). Копировать наведение, кулдаун и разброс во
// вторую реализацию нельзя — они разъедутся на первой же правке баланса, и
// турель начнёт бить не так, как то же оружие в руках.

import { weaponCooldown, weaponRange, weaponDamage, critChance } from './stats.js';

// Разворачивается ли это оружие в установки. Единственный источник правды на
// весь проект: и симуляция, и рендер, и кооп-клиент спрашивают здесь.
//
// Порядок такой и никакой другой: сначала выключатель механики, потом
// персональное перекрытие на оружии, потом класс. Иначе `deploy: false` на
// отдельном стволе не смог бы отменить решение класса.
export function isDeployable(config, weaponCfg) {
  const eng = config.engineering;
  if (!eng || !eng.enabled || !weaponCfg) return false;
  if (weaponCfg.deploy !== undefined) return !!weaponCfg.deploy;
  const classes = eng.classes;
  if (!classes || !classes.length) return false;
  return classes.indexOf(weaponCfg.class) >= 0;
}

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
  // Ломаемые объекты арены живут в том же пуле, что враги, поэтому автоприцел
  // цеплялся бы за ближайшую бочку и в упор не замечал бегущую следом толпу.
  // Держим их отдельным «запасным» кандидатом: бьём по ним, только если ни одного
  // живого врага в радиусе нет — то есть в затишье, а не посреди свалки.
  let breakIdx = -1;
  let breakD = Infinity;
  for (let k = 0; k < n; k++) {
    const idx = deps.queryBuf[k];
    if (idx >= deps.enemyPool.count) continue;
    const e = deps.enemyPool.items[idx];
    if (!e.alive) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const d = dx * dx + dy * dy;
    if (e.breakable) {
      if (d < breakD) {
        breakD = d;
        breakIdx = idx;
      }
      continue;
    }
    if (d < bestD) {
      bestD = d;
      bestIdx = idx;
    }
  }
  return bestIdx >= 0 ? bestIdx : breakIdx;
}

// Шаг одного слота из точки (ox, oy) со статами stats. Возвращает true, если
// слот в этом тике ударил.
//
// owner — id игрока, которому засчитывается урон, вампиризм и добивание. У
// турели это её хозяин: постройка не должна обнулять предметы владельца.
// swingKind/swingIdx — адрес источника для сетевого пульса замаха: 0 — игрок,
// 1 — турель (см. noteSwing в sim/run.js).
export function stepSlot(slot, ox, oy, stats, ownerId, dt, deps, swingKind, swingIdx) {
  const config = deps.config;
  const w = slot.cfg;
  if (!w) return false;

  if (slot.flash > 0) slot.flash -= dt;
  if (slot.swingT > 0) slot.swingT -= dt;
  slot.cd -= dt;
  if (slot.cd > 0) return false;

  // Множители источника: у установки своя дальность и свой урон (инженерия).
  // Живут в deps, а не в аргументах, потому что стреляющих источников два, а
  // список параметров шага слота и без того длинный.
  //
  // syn — синергии владельца (deps.synergy выставляет stepWeapons). У турелей
  // его нет: спец-бонусы работают только для оружия в руках, у установок свой
  // бонус — лишняя копия при развёртывании (sim/turret.js).
  const syn = deps.synergy;
  let range = weaponRange(config, w, stats) * (deps.rangeMult || 1);
  if (syn && w.class === 'melee') range *= syn.meleeRangeMult;

  // Держимся за прежнюю цель, пока она валидна
  let idx = -1;
  slot.retargetT -= dt;
  if (slot.targetUid >= 0 && slot.retargetT > 0 && slot.targetIdx < deps.enemyPool.count) {
    const e = deps.enemyPool.items[slot.targetIdx];
    if (e.uid === slot.targetUid && e.alive) {
      const dx = e.x - ox;
      const dy = e.y - oy;
      if (dx * dx + dy * dy <= range * range) idx = slot.targetIdx;
    }
  }
  if (idx < 0) {
    idx = findTarget(ox, oy, range, deps);
    slot.targetIdx = idx;
    slot.targetUid = idx >= 0 ? deps.enemyPool.items[idx].uid : -1;
    slot.retargetT = config.waves.retarget_interval;
  }
  if (idx < 0) return false;

  const target = deps.enemyPool.items[idx];
  const dx = target.x - ox;
  const dy = target.y - oy;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;

  slot.lastAngle = Math.atan2(dy, dx);
  const cd = weaponCooldown(config, w, stats);
  slot.cd = cd;
  slot.flash = config.render.weapon_flash_time;
  // Замах не должен длиться дольше кулдауна, иначе быстрое оружие анимируется
  // внахлёст само на себя и поза дёргается назад посреди движения.
  slot.swingLen = Math.min(w.shape.anim_time || config.render.weapon_swing_default, cd);
  slot.swingT = slot.swingLen;

  const dmg = weaponDamage(w, stats) * (deps.damageMult || 1);
  const shape = w.shape;

  if (shape.type === 'arc') {
    swingArc(ox, oy, w, shape, range, nx, ny, dmg, stats, ownerId, deps,
      syn ? syn.meleeArcMult : 1);
  } else {
    fireShots(ox, oy, w, shape, range, nx, ny, dmg, stats, ownerId, deps, syn);
  }

  // Пульс замаха для кооп-клиентов. Дуговой удар не рождает снаряда, и без этого
  // события сосед видит немой бой: у хоста меч машет, у клиента стоит столбом.
  if (deps.noteSwing) deps.noteSwing(swingKind || 0, swingIdx || 0, slot.id, slot.lastAngle);
  return true;
}

// Шаг всех слотов одного игрока.
// deps: {config, rng, enemyPool, enemyGrid, queryBuf, projPool, damageEnemy}
//
// Инженерное оружие в руках молчит: за него работают установки на арене
// (sim/turret.js). Гейт стоит НА СЛОТЕ, а не на забеге: инженерия — свойство
// класса оружия, и тесак в соседнем слоте обязан бить как бил. Таймеры молчащему
// слоту всё равно крутим — иначе замах, зеркалённый в него с установки, никогда
// бы не погас, и оружие в руке застряло бы в позе удара навсегда.
export function stepWeapons(player, dt, deps) {
  const slots = player.slots;
  // Синергии владельца — в deps: stepSlot читает их для спец-бонусов
  // (дальность/дуга у melee, +снаряд у ranged, +пробитие у elem). Присваивание,
  // не аллокация: deps живёт весь забег.
  deps.synergy = player.synergy;

  for (let s = 0; s < slots.length; s++) {
    const slot = slots[s];
    if (!slot.cfg) continue;
    if (isDeployable(deps.config, slot.cfg)) {
      if (slot.flash > 0) slot.flash -= dt;
      if (slot.swingT > 0) slot.swingT -= dt;
      if (slot.cd > 0) slot.cd -= dt;
      continue;
    }
    stepSlot(slot, player.x, player.y, player.stats, player.id, dt, deps, 0, player.id);
  }
}

// Ближний удар: мгновенный урон всем врагам в секторе angle в сторону цели.
// arcMult — синергия «веер ударов» (6 ближних): сектор шире, чем у самого ствола.
function swingArc(ox, oy, w, shape, range, nx, ny, dmg, stats, ownerId, deps, arcMult) {
  const half = (shape.angle * (arcMult || 1) * Math.PI) / 360;   // половина сектора в радианах
  const cosHalf = Math.cos(half);
  const n = deps.enemyGrid.query(ox, oy, range, deps.queryBuf);
  for (let k = 0; k < n; k++) {
    const idx = deps.queryBuf[k];
    if (idx >= deps.enemyPool.count) continue;
    const e = deps.enemyPool.items[idx];
    if (!e.alive) continue;
    const dx = e.x - ox;
    const dy = e.y - oy;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    if (d > range + e.size) continue;
    if ((dx / d) * nx + (dy / d) * ny < cosHalf) continue;   // вне сектора
    const crit = deps.rng.float() < critChance(w, stats);
    // Крит усиливает и тег precise: пер-игрока множитель поверх общего.
    const syn = deps.synergy;
    const out = crit
      ? dmg * deps.config.stats.crit_mult * (syn ? syn.critDmgMult : 1) : dmg;
    deps.damageEnemy(idx, out, crit, dx / d, dy / d,
      w.knockback + stats.knockback, ownerId);
  }
}

// Дальний выстрел: count снарядов с разбросом spread градусов.
// syn — синергии владельца: +снарядов за выстрел (ranged-сет и тег spread)
// действует на любое стреляющее оружие, +пробитие — на стихийное, а криты
// усиливает пер-игрока множитель от тега precise.
//
// range — та же дальность, по которой выбиралась цель, и снаряд обязан гаснуть
// ровно на ней. Пока временем жизни правил один shape.ttl, реальный долёт
// (speed × ttl) у половины стволов был вдвое больше паспортной дальности: копьё
// брало цель на 420, а снаряд летел 840 и рвал всё на пути — оружие било по тому,
// что заведомо вне его дистанции атаки. Ограничение живёт здесь, а не в
// sim/projectile.js: полёт по прямой с постоянной скоростью, значит запас хода
// переводится во время один раз на выстреле, и горячий цикл снарядов не платит
// за это ничего. Мин, а не присваивание: у огнемёта и пшикалки ttl короче своей
// же дальности намеренно — струя не должна долетать до края радиуса.
function fireShots(ox, oy, w, shape, range, nx, ny, dmg, stats, ownerId, deps, syn) {
  const config = deps.config;
  const ttl = shape.speed > 0 ? Math.min(shape.ttl, range / shape.speed) : shape.ttl;
  const count = (shape.count || 1) + (syn ? syn.extraShots : 0);
  const pierce = (shape.pierce || 0) + (syn && w.class === 'elem' ? syn.extraPierce : 0);
  const critMult = config.stats.crit_mult * (syn ? syn.critDmgMult : 1);
  // Свой разброс у ствола важнее; веер от синергии — только чтобы доп. снаряды
  // не слиплись в один у оружия без своего spread.
  let spreadDeg = shape.spread || 0;
  if (!spreadDeg && count > 1 && syn) spreadDeg = syn.extraShotSpread;
  const spread = (spreadDeg * Math.PI) / 180;
  const baseAngle = Math.atan2(ny, nx);
  for (let i = 0; i < count; i++) {
    const p = deps.projPool.spawn();
    if (!p) return;                                  // пул полон — деградация
    const offset = count === 1
      ? (spread ? deps.rng.range(-spread / 2, spread / 2) : 0)
      : -spread / 2 + (spread * i) / (count - 1);
    const a = baseAngle + offset;
    const crit = deps.rng.float() < critChance(w, stats);
    p.alive = true;
    p.x = ox;
    p.y = oy;
    p.vx = Math.cos(a) * shape.speed;
    p.vy = Math.sin(a) * shape.speed;
    p.ttl = ttl;
    p.dmg = crit ? dmg * critMult : dmg;
    p.crit = crit;
    p.pierce = pierce;
    p.size = shape.size || config.render.projectile_size_default;
    p.hostile = false;
    p.texture = shape.texture || null;
    p.spin = shape.spin || null;
    p.color = w.color || null;
    p.age = 0;
    p.ownerId = ownerId;
    p.knockback = w.knockback + stats.knockback;
    p.hitCount = 0;
    if (deps.noteSpawn) deps.noteSpawn(p);
  }
}
