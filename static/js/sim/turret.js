// Инженерия: оружие ИНЖЕНЕРНОГО КЛАССА не стреляет в руках — вместо этого на
// арене стоят его копии-установки. Тесак, обрез и посох работают как работали.
//
// Какие классы разворачиваются — из конфига (`engineering.classes`), а не из
// кода: это правило контента. Плюс перекрытие `deploy` на самом оружии, если
// какой-то ствол должен вести себя не как весь его класс.
//
// Каждое такое оружие в слоте разворачивается в `copies` установок в случайных
// точках арены. Бьют они тем же шагом слота, что и оружие в руках (`stepSlot` из
// sim/weapon.js), и по статам ХОЗЯИНА — иначе предметы, левелапы и стат
// «инженерия» перестали бы влиять на урон, как только оружие уехало на пол.
//
// Точки выбираются из rng забега: раскладка обязана совпасть у хоста и у
// повторного прогона того же сида (сервер валидирует результат по сиду).
// Кооп-клиенту она приезжает готовым списком — сам он её не выводит.

import { makeSlot, equip, stepSlot, isDeployable } from './weapon.js';
import { isClear } from './arena.js';

export function makeTurret() {
  return {
    uid: 0,
    ownerId: -1,        // чей: урон, вампиризм и добивание идут этому игроку
    ownerIdx: 0,        // номер игрока в комнате — адрес для сетевого пульса
    slotIdx: 0,         // из какого слота развёрнута: по нему зеркалится кулдаун в HUD
    weaponId: null,
    x: 0,
    y: 0,
    slot: makeSlot(),
    alive: false,
  };
}

export function resetTurret(t) {
  t.alive = false;
  t.ownerId = -1;
  t.weaponId = null;
  t.slot.id = null;
  t.slot.cfg = null;
  t.slot.cd = 0;
  t.slot.targetIdx = -1;
  t.slot.targetUid = -1;
  t.slot.retargetT = 0;
  t.slot.swingT = 0;
  t.slot.flash = 0;
}

// Точка установки: внутри арены, с отступом от стен и не в завале. Если за
// attempts попыток чистого места не нашлось — ставим как есть: турель в углу
// завала стреляет ничуть не хуже, а зацикливаться на поиске в горячем пути нельзя.
export function placeTurret(config, rng, arenaW, arenaH, propIndex, out) {
  const eng = config.engineering;
  const pad = eng.place_margin;
  const clear = eng.place_clear;
  for (let a = 0; a < eng.place_attempts; a++) {
    const x = rng.range(pad, arenaW - pad);
    const y = rng.range(pad, arenaH - pad);
    if (propIndex && !isClear(x, y, clear, propIndex)) continue;
    out.x = x;
    out.y = y;
    return true;
  }
  out.x = rng.range(pad, arenaW - pad);
  out.y = rng.range(pad, arenaH - pad);
  return false;
}

// Двор турелей: разворачивание, шаг и учёт изменений лоадаута.
//
// deps для step — те же, что у оружия игрока (см. weaponDeps в sim/run.js),
// плюс players: владельца ищем по ownerId, чтобы бить его статами.
export function createTurretYard(config, pool) {
  const eng = config.engineering;
  const point = { x: 0, y: 0 };
  // Подпись лоадаута игрока: по ней видно, что оружие купили, продали или
  // проапгрейдили. Сравнение строк раз в тик на восьмерых дешевле, чем ловить
  // каждый путь изменения экипировки (лавка, левелап, читы) руками.
  const signature = {};
  let nextUid = 1;

  function copiesFor(weaponCfg, bonus) {
    // Перекрытие на само оружие: базовое число копий — общее из конфига.
    // bonus — синергия «+1 установка» (6 инженерных стволов и/или 6 с тегом
    // construct у хозяина, стакается до +2). Пул выдерживает худший случай:
    // 8 игроков × 6 слотов × (3+2) = 240 при max_turrets 264.
    const base = weaponCfg.deploy_copies !== undefined ? weaponCfg.deploy_copies : eng.copies;
    return base + (bonus || 0);
  }

  // В подпись идут ТОЛЬКО разворачиваемые слоты: покупка тесака не должна
  // переставлять уже стоящие установки на новые точки. Бонус синергии
  // дописан хвостом: его изменение без смены слотов тоже переставляет двор.
  function slotSignature(player) {
    let s = '';
    const slots = player.slots;
    for (let i = 0; i < slots.length; i++) {
      s += (isDeployable(config, slots[i].cfg) ? slots[i].id : '-') + ',';
    }
    return s + '|' + (player.synergy ? player.synergy.extraTurrets : 0);
  }

  function releaseOf(playerId) {
    for (let i = pool.count - 1; i >= 0; i--) {
      if (pool.items[i].ownerId !== playerId) continue;
      resetTurret(pool.items[i]);
      pool.release(i);
    }
  }

  // Развернуть все слоты одного игрока заново. Позиции всегда новые: по ТЗ
  // установки появляются в случайных местах, и держаться за прежние точки от
  // волны к волне значило бы превратить их в стационарную базу.
  function deployPlayer(player, playerIdx, rng, arenaW, arenaH, propIndex) {
    releaseOf(player.id);
    const slots = player.slots;
    for (let s = 0; s < slots.length; s++) {
      const src = slots[s];
      if (!src.cfg) continue;
      if (!isDeployable(config, src.cfg)) continue;   // обычное оружие бьёт с рук
      const n = copiesFor(src.cfg, player.synergy ? player.synergy.extraTurrets : 0);
      for (let c = 0; c < n; c++) {
        const t = pool.spawn();
        if (!t) return;                       // пул полон — деградация, а не рост
        placeTurret(config, rng, arenaW, arenaH, propIndex, point);
        t.uid = nextUid++;
        t.ownerId = player.id;
        t.ownerIdx = playerIdx;
        t.slotIdx = s;
        t.weaponId = src.id;
        t.x = point.x;
        t.y = point.y;
        t.alive = true;
        equip(t.slot, src.id, config);
        // Кулдаун вразнобой: три копии одного оружия, выстрелившие в один тик,
        // дают пилу по урону и тройной всплеск снарядов на кадр.
        t.slot.cd = rng.float() * (src.cfg.cooldown || 0);
      }
    }
    signature[player.id] = slotSignature(player);
  }

  function deployAll(players, rng, arenaW, arenaH, propIndex) {
    for (let i = 0; i < players.length; i++) {
      deployPlayer(players[i], i, rng, arenaW, arenaH, propIndex);
    }
  }

  // Догнать изменения лоадаута. Возвращает true, если что-то переставили —
  // хост по этому флагу шлёт клиентам новый список.
  function sync(players, rng, arenaW, arenaH, propIndex) {
    let changed = false;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (signature[p.id] === slotSignature(p)) continue;
      deployPlayer(p, i, rng, arenaW, arenaH, propIndex);
      changed = true;
    }
    return changed;
  }

  // Шаг всех установок. Кулдаун и угол зеркалятся обратно в слот хозяина: HUD
  // рисует готовность оружия из слотов и не должен знать про турели.
  function step(dt, deps, players) {
    for (let i = 0; i < pool.count; i++) {
      const t = pool.items[i];
      // Хозяин по индексу, а не перебором: установок под полторы сотни, и линейный
      // поиск по восьмерым на каждую — тысяча сравнений за тик на ровном месте.
      // id всё равно сверяем: индекс — это адрес, а истина в id.
      const owner = players[t.ownerIdx];
      if (!owner || owner.id !== t.ownerId) continue;
      stepSlot(t.slot, t.x, t.y, owner.stats, owner.id, dt, deps, SWING_TURRET, i);
      const mirror = owner.slots[t.slotIdx];
      if (mirror && mirror.id === t.weaponId && t.slot.cd < mirror.cd) {
        mirror.cd = t.slot.cd;
      }
    }
    return pool.count;
  }

  function reset() {
    for (let i = pool.count - 1; i >= 0; i--) {
      resetTurret(pool.items[i]);
      pool.release(i);
    }
    for (const k in signature) delete signature[k];
  }

  return { deployAll, deployPlayer, sync, step, reset, pool };
}

// Адрес источника замаха в сетевом пульсе: 0 — игрок, 1 — турель
export const SWING_PLAYER = 0;
export const SWING_TURRET = 1;
