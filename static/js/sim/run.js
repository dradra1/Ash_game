// Состояние забега: фазы волны, пулы сущностей, связывание подсистем.
//
// Симуляция не знает, соло это или кооп: ввод приходит ТОЛЬКО через транспорт,
// число игроков берётся из состояния. Весь рандом — из rng(seed), выданного сервером.

import { createRng } from '../engine/rng.js';
import { createPool } from '../engine/pool.js';
import { createGrid } from '../engine/grid.js';
import { CH } from '../net/transport.js';
import { createPlayer, stepPlayers, hurtPlayer, addXp } from './player.js';
import { makeEnemy, resetEnemy, stepEnemies, initEnemy, updatePhase, enemyCfg } from './enemy.js';
import { makeProjectile, resetProjectile, stepProjectiles } from './projectile.js';
import { makePickup, resetPickup, dropAsh, stepPickups } from './pickup.js';
import { stepWeapons } from './weapon.js';
import { createSpawner, spawnPoint } from './spawn.js';
import { createShop } from './shop.js';
import { createEconomy } from './economy.js';
import { createLevelUp } from './level.js';

export const PHASE_INTRO = 'intro';
export const PHASE_WAVE = 'wave';
export const PHASE_COLLECT = 'collect';
export const PHASE_SHOP = 'shop';
export const PHASE_OVER = 'over';

export function createRun({ config, seed, transport, players, arena, danger }) {
  const rng = createRng(seed);
  const arenaId = arena || firstKey(config.arenas);
  const dangerCfg = config.danger[danger || 0];
  // В коопе арена растёт: восемь человек с шестью оружиями каждый на исходном
  // прямоугольнике превращают экран в кашу (ТЗ §3.6).
  const arenaScale = 1 + config.coop.arena_per_player * (players.length - 1);
  const arenaW = Math.round(config.arena.size[0] * arenaScale);
  const arenaH = Math.round(config.arena.size[1] * arenaScale);

  const state = {
    wave: 1,
    phase: PHASE_INTRO,
    phaseTime: config.run.wave_intro_sec,
    waveLen: waveLength(config, 1),
    time: 0,
    seed,
    arena: arenaId,
    danger: dangerCfg.id,
    players: [],
    pot: 0,              // общий котёл праха (кооп-экономика — M3)
    kills: 0,
    score: 0,
    bosses: 0,
    win: false,
    bossUid: -1,        // кто сейчас босс: HUD рисует его полосу HP
    shopOpen: false,
    arenaW,
    arenaH,
  };

  const economy = createEconomy(config, players.length);

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    // Детерминированный разброс точек старта от сида
    const a = (i / Math.max(1, players.length)) * Math.PI * 2;
    const r = players.length > 1 ? config.player.radius * 4 : 0;
    state.players.push(createPlayer(
      config, p.id, p.name, p.character,
      arenaW / 2 + Math.cos(a) * r,
      arenaH / 2 + Math.sin(a) * r,
    ));
  }

  const enemyPool = createPool(config.sim.max_enemies_cap, makeEnemy, resetEnemy);
  const projPool = createPool(config.sim.max_projectiles, makeProjectile, resetProjectile);
  const pickupPool = createPool(config.sim.max_pickups, makePickup, resetPickup);

  // Сетка покрывает арену с запасом на зону спавна за её краями
  const margin = config.arena.spawn_margin * 2;
  const enemyGrid = createGrid(config.sim.grid_cell, arenaW + margin * 2, arenaH + margin * 2);
  const queryBuf = new Int32Array(config.sim.max_enemies_cap);
  const spawner = createSpawner(config);

  let maxEnemySize = 0;
  for (const k in config.enemies) {
    const s = config.enemies[k].size;
    if (s > maxEnemySize) maxEnemySize = s;
  }

  // Сетка живёт в сдвинутых координатах: спавн идёт за краем арены, а grid
  // клампит отрицательные координаты в нулевую ячейку — без сдвига все враги
  // за левым/верхним краем свалились бы в одну ячейку.
  function gridInsert(idx, x, y) {
    enemyGrid.insert(idx, x + margin, y + margin);
  }
  const shifted = {
    query(x, y, r, out) { return enemyGrid.query(x + margin, y + margin, r, out); },
  };

  const coop = state.players.length > 1;
  const shops = {};                     // у каждого игрока свой ассортимент и рероллы
  const levelUp = createLevelUp(config);
  for (let i = 0; i < state.players.length; i++) {
    shops[state.players[i].id] = createShop(config, null);
  }
  const ready = {};

  const events = [];        // очередь событий для UI/сети, разбирается снаружи

  function pushEvent(type, a, b) {
    if (events.length < MAX_EVENTS) events.push({ type, a, b });
  }

  function damageEnemy(idx, amount, crit, nx, ny, knockback, ownerId) {
    const e = enemyPool.items[idx];
    if (!e.alive) return;
    e.hp -= amount;
    if (knockback > 0) {
      const k = knockback * (1 - e.kbResist) * config.sim.knockback_scale;
      e.kbX += nx * k;
      e.kbY += ny * k;
    }
    if (e.hp <= 0) {
      e.alive = false;
      state.kills += 1;
      if (e.uid === state.bossUid) {
        state.bosses += 1;
        state.bossUid = -1;
        pushEvent('boss_down', e.type);
        // Финальный босс мёртв — забег выигран немедленно, дожидаться таймера
        // волны незачем: иначе убийство босса ничего не меняет.
        if (state.wave >= config.run.waves) {
          bossSlain = true;
        }
      }
      state.score += e.score;
      const owner = findPlayer(ownerId);
      if (owner) {
        owner.kills += 1;
        owner.score += e.score;
        // Вампиризм: доля нанесённого урона возвращается здоровьем
        if (owner.stats.lifesteal_pct > 0 && owner.hp < owner.maxHp) {
          owner.hp = Math.min(owner.maxHp, owner.hp + amount * owner.stats.lifesteal_pct / 100);
        }
      }
      const tithe = owner ? owner.stats.tithe : 0;
      // Множитель дропа компенсирует деление котла на число игроков
      const ashAmount = (e.ash + tithe) * economy.dropMultiplier();
      dropAsh(pickupPool, e.x, e.y, ashAmount, e.xp, config);
      // Опыт в коопе НЕ делится: каждый получает полный XP со всех убийств
      for (let i = 0; i < state.players.length; i++) {
        if (state.players[i].alive) addXp(state.players[i], config, e.xp);
      }
    }
  }

  function hitPlayer(player, amount, nx, ny) {
    const wasAlive = player.alive;
    const dealt = hurtPlayer(player, config, rng, amount);
    if (dealt > 0 && wasAlive && !player.alive) {
      economy.onDeath();                 // выбывание срезает долю котла
      syncAsh();
      pushEvent('player_down', player.id);
    }
  }

  function syncAsh() {
    state.pot = economy.state.pot;
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      p.ash = economy.solo ? economy.state.pot - (economy.state.spent[p.id] || 0)
        : economy.shareOf(p.id);
    }
  }

  function fireProjectile(enemy, nx, ny) {
    const atk = enemy.cfg.attack;
    const pr = atk.projectile;
    const p = projPool.spawn();
    if (!p) return;
    p.alive = true;
    p.x = enemy.x;
    p.y = enemy.y;
    p.vx = nx * pr.speed;
    p.vy = ny * pr.speed;
    p.ttl = pr.ttl;
    p.dmg = enemy.dmg;
    p.pierce = 0;
    p.size = pr.size;
    p.hostile = true;
    p.texture = pr.texture || null;
    p.color = enemy.cfg.color;
    p.ownerId = -1;
    p.knockback = 0;
    p.hitCount = 0;
  }

  function onCollect(player, amount, xp) {
    // Прах идёт в ОБЩИЙ котёл комнаты, а не в карман поднявшего.
    economy.add(amount);
    state.pot = economy.state.pot;
    // Личный баланс в соло равен котлу, в коопе — своей доле
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      p.ash = economy.solo ? economy.state.pot - (economy.state.spent[p.id] || 0)
        : economy.shareOf(p.id);
    }
  }

  const enemyDeps = {
    config, players: state.players, rng,
    fireProjectile, hitPlayer,
  };
  const weaponDeps = {
    config, rng, enemyPool, enemyGrid: shifted, queryBuf, projPool, damageEnemy,
  };
  const projDeps = {
    config, players: state.players, enemyPool, enemyGrid: shifted, queryBuf,
    maxEnemySize, damageEnemy, hitPlayer,
  };
  const pickupDeps = { config, players: state.players, onCollect };
  const spawnDeps = {
    config, players: state.players, rng, pool: enemyPool,
    wave: 1, danger: dangerCfg, arenaId, arenaW, arenaH,
  };

  function findPlayer(id) {
    for (let i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return state.players[i];
    }
    return null;
  }

  function applyInput(playerId, input) {
    const p = findPlayer(playerId);
    if (!p || !p.alive || !input) return;
    p.input.x = input.x || 0;
    p.input.y = input.y || 0;
  }

  transport.on(CH.INPUT, (payload, fromId) => {
    if (!payload) return;
    applyInput(payload.id !== undefined ? payload.id : fromId, payload);
  });

  function anyoneAlive() {
    for (let i = 0; i < state.players.length; i++) {
      if (state.players[i].alive) return true;
    }
    return false;
  }

  function clearEnemies() {
    for (let i = enemyPool.count - 1; i >= 0; i--) {
      resetEnemy(enemyPool.items[i]);
      enemyPool.release(i);
    }
    for (let i = projPool.count - 1; i >= 0; i--) {
      resetProjectile(projPool.items[i]);
      projPool.release(i);
    }
  }

  // Босс волны n, если он прописан в арене. Ставится не «за краем», а на
  // безопасном отдалении — иначе он появляется вплотную к игроку.
  function spawnBoss(n) {
    const arenaCfg = config.arenas[arenaId];
    const bossId = n >= config.run.waves ? arenaCfg.boss_final
      : (n === BOSS_MID_WAVE ? arenaCfg.boss_mid : null);
    if (!bossId || !config.bosses[bossId]) return;
    const e = enemyPool.spawn();
    if (!e) return;
    initEnemy(e, config, bossId, n, dangerCfg, state.players.length);
    // Босс в коопе крепче по своей формуле, а не по общей
    e.maxHp = config.bosses[bossId].hp
      * (1 + config.waves.hp_growth * (n - 1)) * dangerCfg.hp_mult
      * (1 + config.coop.boss_hp_per_player * (state.players.length - 1));
    e.hp = e.maxHp;
    if (!spawnPoint(config, rng, state.players, bossPoint, 8, arenaW, arenaH)) {
      bossPoint.x = arenaW / 2;
      bossPoint.y = config.arena.spawn_margin;
    }
    e.x = bossPoint.x;
    e.y = bossPoint.y;
    state.bossUid = e.uid;
    pushEvent('boss_spawn', bossId);
  }

  const bossPoint = { x: 0, y: 0 };
  let bossSlain = false;

  function startWave(n) {
    state.wave = n;
    state.waveLen = waveLength(config, n);
    state.phase = PHASE_INTRO;
    state.phaseTime = config.run.wave_intro_sec;
    spawner.reset();
    spawnDeps.wave = n;
    state.bossUid = -1;
    state.shopOpen = false;
    for (const k in ready) delete ready[k];
    pushEvent('wave_start', n);
  }

  function endRun(win) {
    state.win = win;
    state.phase = PHASE_OVER;
    state.phaseTime = 0;
    clearEnemies();
    pushEvent('run_over', win ? 1 : 0);
  }

  // Лавка между волнами. В соло ждём игрока сколько угодно; в коопе — до
  // coop.shop_timer, потом волна стартует сама (иначе один AFK держит комнату).
  function openShop() {
    state.phase = PHASE_SHOP;
    state.shopOpen = true;
    state.phaseTime = coop ? config.coop.shop_timer : Infinity;
    for (const k in ready) delete ready[k];
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      // Выбывшие возвращаются в строй к следующей волне
      if (!p.alive) {
        p.alive = true;
        p.hp = Math.max(1, Math.round(p.maxHp * config.coop.revive_hp_pct));
      }
      shops[p.id].open(p, state.wave + 1, dangerCfg, rng, coop);
    }
    pushEvent('shop_open', state.wave + 1);
  }

  function readyUp(playerId) {
    if (state.phase !== PHASE_SHOP) return false;
    ready[playerId] = true;
    for (let i = 0; i < state.players.length; i++) {
      if (!ready[state.players[i].id]) return false;
    }
    startWave(state.wave + 1);
    return true;
  }

  function shopFor(playerId) {
    return shops[playerId];
  }

  function step(dt) {
    state.time += dt;
    state.phaseTime -= dt;

    // Сетка врагов пересобирается раз в кадр — все запросы соседей идут через неё
    enemyGrid.clear();
    for (let i = 0; i < enemyPool.count; i++) {
      const e = enemyPool.items[i];
      gridInsert(i, e.x, e.y);
    }

    stepPlayers(state.players, dt, config, arenaW, arenaH);

    if (state.phase === PHASE_WAVE) {
      spawner.step(dt, spawnDeps);
      stepEnemies(enemyPool, dt, enemyDeps);
      for (let i = 0; i < state.players.length; i++) {
        const p = state.players[i];
        if (p.alive) stepWeapons(p, dt, weaponDeps);
      }
    } else if (state.phase === PHASE_COLLECT) {
      stepEnemies(enemyPool, dt, enemyDeps);
    }

    stepProjectiles(projPool, dt, projDeps);
    stepPickups(pickupPool, dt, pickupDeps, state.phase === PHASE_COLLECT);

    // Мутация босса при падении HP ниже порога фазы
    if (state.bossUid >= 0) {
      for (let i = 0; i < enemyPool.count; i++) {
        const e = enemyPool.items[i];
        if (e.uid === state.bossUid) {
          if (updatePhase(e)) pushEvent('boss_phase', e.phase);
          break;
        }
      }
    }

    // Уборка мёртвых врагов: swap-remove с конца, чтобы индексы не поехали
    for (let i = enemyPool.count - 1; i >= 0; i--) {
      if (!enemyPool.items[i].alive) {
        resetEnemy(enemyPool.items[i]);
        enemyPool.release(i);
      }
    }

    if (bossSlain && state.phase !== PHASE_OVER) {
      endRun(true);
      return;
    }

    if (!anyoneAlive() && state.phase !== PHASE_OVER) {
      endRun(false);
      return;
    }

    if (state.phase === PHASE_SHOP && state.phaseTime <= 0) {
      startWave(state.wave + 1);
      return;
    }

    if (state.phaseTime <= 0) {
      if (state.phase === PHASE_INTRO) {
        state.phase = PHASE_WAVE;
        state.phaseTime = state.waveLen;
        spawnBoss(state.wave);
      } else if (state.phase === PHASE_WAVE) {
        // Конец волны: живые враги исчезают, прах собирается автоматически
        clearEnemies();
        state.phase = PHASE_COLLECT;
        state.phaseTime = config.run.wave_end_collect_sec;
        pushEvent('wave_end', state.wave);
      } else if (state.phase === PHASE_COLLECT) {
        if (state.wave >= config.run.waves) endRun(true);
        else openShop();
      }
    }
  }

  const snap = {};
  function snapshot() {
    snap.wave = state.wave;
    snap.phase = state.phase;
    snap.phaseTime = state.phaseTime;
    snap.time = state.time;
    snap.players = state.players;
    snap.pot = state.pot;
    return snap;
  }

  const stats = { entities: 0, enemies: 0, projectiles: 0, pickups: 0 };
  function refreshStats() {
    stats.enemies = enemyPool.count;
    stats.projectiles = projPool.count;
    stats.pickups = pickupPool.count;
    stats.entities = enemyPool.count + projPool.count + pickupPool.count + state.players.length;
    return stats;
  }

  return {
    state, step, applyInput, snapshot, stats, refreshStats, events,
    enemyPool, projPool, pickupPool, rng,
    startWave, endRun, openShop, readyUp, shopFor, levelUp, coop, economy, syncAsh,
    danger: dangerCfg, arenaW, arenaH,
  };
}

export function waveLength(config, wave) {
  const r = config.run;
  const boss = r.boss_waves[String(wave)];
  if (boss && boss.len) return boss.len;
  let len = Math.min(r.wave_len_cap, r.wave_len_base + r.wave_len_step * (wave - 1));
  if (boss && boss.len_bonus) len += boss.len_bonus;
  return len;
}

function firstKey(obj) {
  for (const k in obj) return k;
  return null;
}

const MAX_EVENTS = 64;
const BOSS_MID_WAVE = 10;
