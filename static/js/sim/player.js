// Игрок: движение, статы, i-frames, броня/уклонение, регенерация, смерть.

import { createStats, resolveStats, moveSpeed, armorFactor, dodgeChance } from './stats.js';
import { makeSlot, equip } from './weapon.js';

export function createPlayer(config, id, name, characterId, x, y) {
  const chCfg = config.characters[characterId];
  const stats = createStats(config);
  // Источники модификаторов по порядку: персонаж, копилка левелапов, дальше предметы.
  // levelMods — один объект, который растёт: левелапов за забег десятки.
  const levelMods = {};
  const sources = [chCfg.stats, levelMods];
  resolveStats(stats, config, sources);

  const slots = new Array(config.run.weapon_slots);
  for (let i = 0; i < slots.length; i++) slots[i] = makeSlot();
  const start = chCfg.start_weapons || [];
  for (let i = 0; i < start.length && i < slots.length; i++) {
    equip(slots[i], start[i], config);
  }

  return {
    id,
    name,
    character: characterId,
    x, y, vx: 0, vy: 0,
    dir: 0, frame: 0, animT: 0,
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
    items: [],
    slots,
    alive: true,
    input: { x: 0, y: 0 },
  };
}

// Пересобрать статы после изменения источников (покупка, левелап — M2)
export function refreshStats(player, config) {
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

export function stepPlayers(players, dt, config) {
  const arenaW = config.arena.size[0];
  const arenaH = config.arena.size[1];
  const pad = config.arena.wall_padding;

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p.alive) continue;

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
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < pad) p.x = pad; else if (p.x > arenaW - pad) p.x = arenaW - pad;
      if (p.y < pad) p.y = pad; else if (p.y > arenaH - pad) p.y = arenaH - pad;
      if (p.vx * p.vx > p.vy * p.vy) p.dir = p.vx > 0 ? 1 : 3;
      else p.dir = p.vy > 0 ? 0 : 2;
      p.animT += dt;
    }
  }
}
