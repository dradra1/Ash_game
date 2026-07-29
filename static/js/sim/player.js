// Игрок: движение, статы, i-frames, броня/уклонение, регенерация, смерть.

import { createStats, resolveStats, moveSpeed, armorFactor, dodgeChance } from './stats.js';
import { makeSlot, equip } from './weapon.js';
import { createSynergyState, refreshSynergies } from './synergy.js';
import { separateFromProps } from './arena.js';

export function createPlayer(config, id, name, characterId, x, y) {
  const chCfg = config.characters[characterId];
  const stats = createStats(config);
  // Источники модификаторов по порядку: персонаж, копилка левелапов, синергии,
  // дальше предметы. levelMods и synergy.mods — стабильные ссылки, которые
  // растут: пересоздавать их нельзя, sources держит именно эти объекты.
  const levelMods = {};
  const synergy = createSynergyState();
  const sources = [chCfg.stats, levelMods, synergy.mods];
  resolveStats(stats, config, sources);

  const slots = new Array(config.run.weapon_slots);
  for (let i = 0; i < slots.length; i++) slots[i] = makeSlot();
  const start = chCfg.start_weapons || [];
  for (let i = 0; i < start.length && i < slots.length; i++) {
    equip(slots[i], start[i], config);
  }

  const player = {
    id,
    name,
    character: characterId,
    x, y, vx: 0, vy: 0,
    dir: 0, frame: 0, animT: 0,
    moving: false,           // состояние отрисовки: «идёт ли» — едет в снапшоте битом
    hp: stats.max_hp,
    maxHp: stats.max_hp,
    radius: config.player.radius,
    pickupRadius: config.player.pickup_radius,
    speed: moveSpeed(config, stats),
    iframes: 0,
    regenAcc: 0,
    level: 1,
    xp: 0,
    xpNext: xpToNext(config, 1),
    ash: 0,
    kills: 0,
    score: 0,
    pendingLevels: 0,
    stats,
    sources,
    levelMods,
    synergy,
    items: [],
    slots,
    alive: true,
    input: { x: 0, y: 0 },
    // Номер последнего учтённого ввода — уезжает в снапшоте как ack (net/protocol.js)
    lastInputSeq: 0,
    // Очередь сетевого ввода: хост снимает РОВНО ОДИН пакет за тик.
    //
    // Раньше здесь была защёлка — последний пришедший пакет лежал в input и
    // интегрировался каждый тик, а ack прыгал на самый свежий ПОЛУЧЕННЫЙ номер.
    // Пакеты по TCP приходят пачками: пришло два между тиками — первый ни разу
    // не побывал в симуляции, но подтверждён; не пришло ни одного — старый ввод
    // проигран дважды. Клиент выбрасывает из переигровки всё не новее ack, и его
    // база разъезжается с авторитетом на один-три тика. Это и есть «резина».
    //
    // Хранится КВАНТОВАННЫЙ int8: по сети ввод едет с шагом 1/127, и клиент
    // предсказывает этим же числом. Проинтегрируй хост float — на диагоналях
    // они посчитают разную скорость, и расхождение начнёт копиться на ровном
    // месте (CLAUDE.md §2).
    inQ: {
      x: new Int8Array(config.net.input_queue_len),
      y: new Int8Array(config.net.input_queue_len),
      seq: new Uint16Array(config.net.input_queue_len),
      head: 0, tail: 0, count: 0,
      // Номер последнего ПОЛОЖЕННОГО пакета: по нему отсекаются дубликаты
      // и опоздавшие. -1 — очередь ещё ничего не видела.
      lastSeq: -1,
    },
  };

  // Стартовое оружие уже одето и могло собрать синергию — резолв повторный.
  // Прибавка max_hp от синергии долечит hp через refreshStats.
  refreshStats(player, config);
  return player;
}

// Снять из очереди один пакет ввода. Возвращать нечего: всё пишется в игрока.
//
// Голод очереди (пакет не доехал) — оставляем прежний ввод и НЕ двигаем ack:
// обнулять ввод значило бы превращать одиночную потерю в видимую всем заминку,
// а двинуть ack — заставить клиента выбросить из переигровки кадр, которого
// хост не применял, то есть воспроизвести ровно тот баг, который мы чиним.
function takeInput(p) {
  const q = p.inQ;
  if (q.count === 0) return;
  const h = q.head;
  p.input.x = q.x[h] / 127;
  p.input.y = q.y[h] / 127;
  p.lastInputSeq = q.seq[h];
  q.head = (h + 1) % q.x.length;
  q.count--;
}

// Пересобрать статы после изменения источников (покупка, левелап — M2)
export function refreshStats(player, config) {
  // Синергии пересчитываются первыми: их mods стоят в sources, и resolveStats
  // ниже обязан видеть уже готовые бонусы. Сюда же попадают все пути смены
  // лоадаута (лавка зовёт refreshStats через onChange), поэтому отдельных
  // точек пересчёта синергий не нужно.
  refreshSynergies(player, config);
  const before = player.stats.max_hp;
  resolveStats(player.stats, config, player.sources);
  player.speed = moveSpeed(config, player.stats);
  const delta = player.stats.max_hp - before;
  player.maxHp = player.stats.max_hp;
  if (delta > 0) player.hp += delta;                 // прибавка HP лечит на столько же
  if (player.hp > player.maxHp) player.hp = player.maxHp;
}

export function xpToNext(config, level) {
  const f = config.level.xp_formula;
  return Math.round(f.base + f.k * Math.pow(level, f.pow));
}

// Применить выбранное на левелапе улучшение
export function applyLevelChoice(player, config, choice) {
  const key = choice.stat;
  player.levelMods[key] = (player.levelMods[key] || 0) + choice.value;
  if (player.pendingLevels > 0) player.pendingLevels -= 1;
  refreshStats(player, config);
}

export function addXp(player, config, amount) {
  player.xp += amount;
  while (player.xp >= player.xpNext) {
    player.xp -= player.xpNext;
    player.level += 1;
    player.pendingLevels += 1;                        // очередь выборов, разбирается в M2
    player.xpNext = xpToNext(config, player.level);
  }
}

// Урон игроку с учётом уклонения, брони и i-frames. Возвращает нанесённый урон.
export function hurtPlayer(player, config, rng, amount) {
  if (!player.alive || player.iframes > 0) return 0;
  if (player._god) return 0;
  if (rng.float() < dodgeChance(config, player.stats)) return 0;
  const taken = amount * armorFactor(config, player.stats.armor);
  player.hp -= taken;
  player.iframes = config.player.iframes;
  if (player.hp <= 0) {
    player.hp = 0;
    player.alive = false;
  }
  return taken;
}

// arenaW/arenaH передаются явно: в коопе арена масштабируется числом игроков,
// и брать размер напрямую из конфига значило бы зажимать игроков в меньший
// прямоугольник, чем тот, куда спавнятся враги.
export function stepPlayers(players, dt, config, arenaW, arenaH, propIndex) {
  const w = arenaW || config.arena.size[0];
  const h = arenaH || config.arena.size[1];
  const pad = config.arena.wall_padding;

  for (let i = 0; i < players.length; i++) {
    const p = players[i];

    // Ввод снимается ДО проверки на живость: иначе очередь мертвеца копится, и
    // после воскрешения он проигрывает чужое прошлое.
    takeInput(p);

    if (!p.alive) { p.moving = false; continue; }

    if (p.iframes > 0) p.iframes -= dt;

    if (p.stats.hp_regen > 0 && p.hp < p.maxHp) {
      p.regenAcc += p.stats.hp_regen * dt;
      if (p.regenAcc >= 1) {
        const whole = Math.floor(p.regenAcc);
        p.regenAcc -= whole;
        p.hp = Math.min(p.maxHp, p.hp + whole);
      }
    }

    let ix = p.input.x;
    let iy = p.input.y;
    const len = Math.sqrt(ix * ix + iy * iy);
    if (len > 1) { ix /= len; iy /= len; }
    p.vx = ix * p.speed;
    p.vy = iy * p.speed;

    if (p.vx !== 0 || p.vy !== 0) {
      p.moving = true;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Сначала препятствия, потом стены: стена — жёсткая граница и должна
      // выиграть, иначе завал у края вытолкнет игрока наружу арены.
      if (propIndex) separateFromProps(p, p.radius, propIndex, null);
      if (p.x < pad) p.x = pad; else if (p.x > w - pad) p.x = w - pad;
      if (p.y < pad) p.y = pad; else if (p.y > h - pad) p.y = h - pad;
      if (p.vx * p.vx > p.vy * p.vy) p.dir = p.vx > 0 ? 1 : 3;
      else p.dir = p.vy > 0 ? 0 : 2;
      p.animT += dt;
    } else {
      p.moving = false;
    }
  }
}
