// Состояние забега: фазы волны, пулы сущностей, связывание подсистем.
//
// Симуляция не знает, соло это или кооп: ввод приходит ТОЛЬКО через транспорт,
// число игроков берётся из состояния. Весь рандом — из rng(seed), выданного сервером.

import { createRng } from '../engine/rng.js';
import { createPool } from '../engine/pool.js';
import { createGrid } from '../engine/grid.js';
import { CH } from '../net/transport.js';
import { createPlayer, stepPlayers, hurtPlayer, addXp, applyLevelChoice, refreshStats } from './player.js';
import { makeEnemy, resetEnemy, stepEnemies, initEnemy, updatePhase, enemyCfg } from './enemy.js';
import { makeProjectile, resetProjectile, stepProjectiles } from './projectile.js';
import { makePickup, resetPickup, dropAsh, stepPickups } from './pickup.js';
import { stepWeapons } from './weapon.js';
import { createSpawner, spawnPoint } from './spawn.js';
import { createShop } from './shop.js';
import { createEconomy, createWallet } from './economy.js';
import { createLevelUp } from './level.js';
import { buildArenaLayout, createPropIndex, separateFromProps } from './arena.js';
import { resolveCurseFx, curseStatMods, applyCurseToDanger } from './curses.js';

export const PHASE_INTRO = 'intro';
export const PHASE_WAVE = 'wave';
export const PHASE_COLLECT = 'collect';
export const PHASE_LEVELUP = 'levelup';
export const PHASE_SHOP = 'shop';
export const PHASE_OVER = 'over';

// unlocked — что открыто метапрогрессией у ХОЗЯИНА забега: пул лавки ограничен
// им (ТЗ §3.9). В коопе это открытия хоста: мир один, и ассортимент общий.
export function createRun({ config, seed, transport, players, arena, danger, unlocked, curses, onImpact }) {
  const rng = createRng(seed);
  const arenaId = arena || firstKey(config.arenas);
  const curseFx = resolveCurseFx(config, curses || []);
  const dangerBase = config.danger[danger || 0];
  const dangerCfg = applyCurseToDanger(dangerBase, curseFx);
  // В коопе арена растёт: восемь человек с шестью оружиями каждый на исходном
  // прямоугольнике превращают экран в кашу (ТЗ §3.6).
  const arenaScale = 1 + config.coop.arena_per_player * (players.length - 1);
  const arenaW = Math.round(config.arena.size[0] * arenaScale);
  const arenaH = Math.round(config.arena.size[1] * arenaScale);

  const state = {
    wave: 1,
    phase: PHASE_INTRO,
    phaseTime: config.run.wave_intro_sec,
    waveLen: waveLength(config, 1, curseFx),
    time: 0,
    seed,
    arena: arenaId,
    danger: dangerCfg.id,
    curses: curseFx.ids.slice(),
    players: [],
    ready: {},           // id игрока → нажал «Готов» в лавке
    pot: 0,              // общий котёл праха (кооп-экономика — M3)
    kills: 0,
    score: 0,
    bosses: 0,
    win: false,
    bossUid: -1,        // кто сейчас босс: HUD рисует его полосу HP
    shopOpen: false,
    paused: false,      // глобальная пауза (ESC) — хост-авторитет, в коопе для всех
    arenaW,
    arenaH,
    damage_taken: 0,
    ash_gained: 0,
    shop_buys: 0,
  };

  const economy = createEconomy(config, players.length);
  const curseMods = curseStatMods(curseFx);

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    // Детерминированный разброс точек старта от сида
    const a = (i / Math.max(1, players.length)) * Math.PI * 2;
    const r = players.length > 1 ? config.player.radius * 4 : 0;
    const pl = createPlayer(
      config, p.id, p.name, p.character,
      arenaW / 2 + Math.cos(a) * r,
      arenaH / 2 + Math.sin(a) * r,
    );
    if (curseFx.ids.length) {
      pl.sources.push(curseMods);
      refreshStats(pl, config);
      pl.hp = pl.maxHp;
    }
    state.players.push(pl);
  }

  // Раскладка арены выводится из сида отдельным rng и по сети не передаётся:
  // кооп-клиент строит ту же самую из (seed, arenaId, размер). Порядок важен —
  // layout обязан быть построен до пулов, но своим rng, не общим.
  const layout = buildArenaLayout(config, arenaId, seed, arenaW, arenaH);
  const propIndex = createPropIndex(layout, config);

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
  // Текущие варианты левелапа по id игрока (переиспользуемые массивы из levelUp.roll)
  const levelChoices = {};
  for (let i = 0; i < state.players.length; i++) {
    shops[state.players[i].id] = createShop(config, unlocked || null, curseFx);
  }
  // Кто уже нажал «Готов» в лавке. Лежит в state, а не в замыкании: ростер
  // готовности рисуется и у хоста, и у клиента (снимок лавки везёт эти флаги).
  const ready = state.ready;

  const events = [];        // очередь событий для UI/сети, разбирается снаружи

  // Очередь событий спавна снарядов для рассылки клиентам. Копируем поля, а не
  // держим ссылку на снаряд: между накоплением (60 Гц) и отправкой (20 Гц) он
  // может умереть и уйти обратно в пул под другой выстрел.
  // `on` включает хост: в соло слушателя нет, и копить незачем.
  const spawns = { on: false, count: 0, items: [] };
  for (let i = 0; i < config.sim.max_projectiles; i++) {
    spawns.items.push({ x: 0, y: 0, vx: 0, vy: 0, ttl: 0, size: 0, texture: null, hostile: false });
  }

  function noteSpawn(p) {
    if (!spawns.on || spawns.count >= spawns.items.length) return;
    const s = spawns.items[spawns.count++];
    s.x = p.x; s.y = p.y; s.vx = p.vx; s.vy = p.vy;
    s.ttl = p.ttl; s.size = p.size; s.texture = p.texture; s.hostile = p.hostile;
  }

  function pushEvent(type, a, b) {
    if (events.length < MAX_EVENTS) events.push({ type, a, b });
  }

  function damageEnemy(idx, amount, crit, nx, ny, knockback, ownerId) {
    const e = enemyPool.items[idx];
    if (!e.alive) return;
    e.hp -= amount;
    // Вампиризм: lifesteal_pct — ШАНС в процентах вылечить фиксированные
    // stats.lifesteal_heal HP, и срабатывает он на КАЖДОМ попадании, а не только
    // на добивающем. Раньше лечила доля урона последнего удара, из-за чего удар
    // на 100 по врагу с 1 HP лечил как за все 100.
    if (amount > 0) {
      const owner = findPlayer(ownerId);
      if (owner && owner.stats.lifesteal_pct > 0 && owner.hp < owner.maxHp
        && rng.float() * 100 < owner.stats.lifesteal_pct) {
        owner.hp = Math.min(owner.maxHp, owner.hp + config.stats.lifesteal_heal);
      }
    }
    // Частицы — клиентская косметика, симуляция про них знать не должна: колбэк
    // приходит снаружи, как транспорт. В коопе он есть только у хоста, клиенты
    // рисуют свои искры по событиям спавна.
    if (onImpact) onImpact(e.x, e.y, crit, nx, ny);
    if (knockback > 0) {
      const k = knockback * (1 - e.kbResist) * config.sim.knockback_scale;
      e.kbX += nx * k;
      e.kbY += ny * k;
    }
    if (e.hp <= 0) {
      e.alive = false;
      // Ломаемый объект — не убийство: он не идёт ни в счётчик убийств, ни в очки,
      // ни в опыт, ни в обычный дроп праха. Вся его выгода — в награде.
      if (e.breakable) {
        applyBreakableReward(e, findPlayer(ownerId));
        return;
      }
      state.kills += 1;
      if (e.boss) {
        state.bosses += 1;
        if (e.uid === state.bossUid) {
          state.bossUid = -1;
          pushEvent('boss_down', e.type);
          // Финальный босс мёртв — забег выигран немедленно, дожидаться таймера
          // волны незачем: иначе убийство босса ничего не меняет.
          if (state.wave >= config.run.waves) {
            bossSlain = true;
          }
        } else {
          pushEvent('boss_down', e.type);
        }
      }
      state.score += e.score;
      const owner = findPlayer(ownerId);
      if (owner) {
        owner.kills += 1;
        owner.score += e.score;
      }
      const tithe = owner ? owner.stats.tithe : 0;
      // Десятина — ДОЛЯ от праха врага, а не плоская добавка к каждому убийству.
      // Плоская добавка и разгоняла позднюю экономику: убийств за волну сотни, и
      // при 40 накопленной десятины враг ценой 3 приносил 43 — доход к 16-й волне
      // улетал в 3182 при цели 686.
      const titheMult = tithe * config.stats.tithe_scale;
      // Множитель дропа компенсирует деление котла на число игроков,
      // wave_ash_mult приводит кривую дохода к целевой (см. patch_config_income).
      const raw = curseFx.ash_drop_zero
        ? e.ash * titheMult          // базовый прах обнулён проклятием, десятина капает
        : e.ash * (1 + titheMult);
      const ashAmount = raw * economy.dropMultiplier()
        * dangerCfg.ash_mult * curseFx.ash_drop_mult * economy.waveMult(state.wave);
      const xpAmount = e.xp * curseFx.xp_mult;
      const drop = dropAsh(pickupPool, e.x, e.y, ashAmount, xpAmount, config);
      // Враг мог умереть впритык к завалу: прах внутри препятствия недостижим
      if (drop) separateFromProps(drop, config.sim.pickup_radius || 0, propIndex, null);
      // Опыт в коопе НЕ делится: каждый получает полный XP со всех убийств
      for (let i = 0; i < state.players.length; i++) {
        if (state.players[i].alive) addXp(state.players[i], config, xpAmount);
      }
    }
  }

  function hitPlayer(player, amount, nx, ny) {
    const wasAlive = player.alive;
    const dealt = hurtPlayer(player, config, rng, amount);
    if (dealt > 0) state.damage_taken += dealt;
    if (dealt > 0 && wasAlive && !player.alive) {
      economy.onDeath();                 // выбывание срезает долю котла
      syncAsh();
      pushEvent('player_down', player.id);
    }
  }

  // player.ash — витрина для HUD и лавки; истина живёт в economy. Соло считается
  // тем же shareOf: соло — это комната из одного игрока, отдельной ветки быть не должно.
  function syncAsh() {
    state.pot = economy.state.pot;
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      p.ash = economy.shareOf(p.id);
    }
  }

  const wallet = createWallet(economy, syncAsh);

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
    p.spin = pr.spin || null;
    p.age = 0;
    noteSpawn(p);
  }

  function onCollect(player, amount, xp) {
    // Прах идёт в ОБЩИЙ котёл комнаты, а не в карман поднявшего.
    economy.add(amount);
    if (amount > 0) state.ash_gained += amount;
    syncAsh();
  }

  const enemyDeps = {
    config, players: state.players, rng,
    fireProjectile, hitPlayer, propIndex,
  };
  const weaponDeps = {
    config, rng, enemyPool, enemyGrid: shifted, queryBuf, projPool, damageEnemy,
    noteSpawn,
  };
  const projDeps = {
    config, players: state.players, enemyPool, enemyGrid: shifted, queryBuf,
    maxEnemySize, damageEnemy, hitPlayer, arenaW, arenaH,
  };
  const pickupDeps = { config, players: state.players, onCollect };
  const spawnDeps = {
    config, players: state.players, rng, pool: enemyPool,
    wave: 1, danger: dangerCfg, arenaId, arenaW, arenaH, curseFx, propIndex,
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
    // Номер последнего учтённого ввода уезжает обратно в снапшоте: по нему клиент
    // измеряет настоящую ошибку своего предсказания, а не тянется к устаревшей позиции.
    if (input.seq !== undefined) p.lastInputSeq = input.seq;
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
  // На высоких сложностях волна 20: два босса (final + mid).
  function spawnOneBoss(bossId, n, asPrimary) {
    if (!bossId || !config.bosses[bossId]) return null;
    const e = enemyPool.spawn();
    if (!e) return null;
    initEnemy(e, config, bossId, n, dangerCfg, state.players.length, curseFx);
    // Босс в коопе крепче по своей формуле, а не по общей
    e.maxHp = config.bosses[bossId].hp
      * (1 + config.waves.hp_growth * (n - 1)) * dangerCfg.hp_mult
      * (1 + config.coop.boss_hp_per_player * (state.players.length - 1));
    e.hp = e.maxHp;
    e.boss = true;
    if (!spawnPoint(config, rng, state.players, bossPoint, 8, arenaW, arenaH, propIndex)) {
      bossPoint.x = arenaW / 2;
      bossPoint.y = config.arena.spawn_margin;
    }
    e.x = bossPoint.x;
    e.y = bossPoint.y;
    if (asPrimary) state.bossUid = e.uid;
    pushEvent('boss_spawn', bossId);
    return e;
  }

  function spawnBoss(n) {
    const arenaCfg = config.arenas[arenaId];
    if (n >= config.run.waves) {
      spawnOneBoss(arenaCfg.boss_final, n, true);
      if ((dangerCfg.bosses_final || 1) >= 2) {
        // Смещаем вторую точку, чтобы боссы не наложились
        bossPoint.x = arenaW * 0.35;
        spawnOneBoss(arenaCfg.boss_mid, n, false);
      }
    } else if (n === BOSS_MID_WAVE) {
      spawnOneBoss(arenaCfg.boss_mid, n, true);
    }
  }

  const bossPoint = { x: 0, y: 0 };
  let bossSlain = false;

  function startWave(n) {
    state.wave = n;
    state.waveLen = waveLength(config, n, curseFx);
    state.phase = PHASE_INTRO;
    state.phaseTime = config.run.wave_intro_sec;
    healEveryone();
    spawnBreakables();
    spawner.reset();
    spawnDeps.wave = n;
    state.bossUid = -1;
    state.shopOpen = false;
    for (const k in ready) delete ready[k];
    pushEvent('wave_start', n);
  }

  // Каждая волна начинается со здоровыми игроками: выбывшие возвращаются в строй,
  // живые долечиваются. Доля берётся из конфига — это главная ручка сложности,
  // при 1.0 накопленный за волну урон полностью списывается.
  function healEveryone() {
    const pct = config.run.heal_on_wave_pct;
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      const heal = Math.round(p.maxHp * pct);
      if (!p.alive) {
        p.alive = true;
        // Выбывший поднимается ровно на то, что даёт хил, но не с нулём
        p.hp = Math.max(1, heal);
      } else {
        p.hp = Math.min(p.maxHp, p.hp + heal);
      }
      p.regenAcc = 0;
    }
  }

  // Ломаемые объекты встают заново каждую волну на своих детерминированных точках.
  // Живут в пуле врагов (ai: static), поэтому наведение оружия, урон, снапшот и
  // кооп-синхронизация достаются им даром.
  function spawnBreakables() {
    const spots = layout.breakables;
    if (!spots || !spots.length) return;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      if (!config.breakables || !config.breakables[s.type]) continue;
      const e = enemyPool.spawn();
      if (!e) return;                       // пул занят толпой — деградация, а не рост
      initEnemy(e, config, s.type, state.wave, dangerCfg, state.players.length, curseFx);
      e.x = s.x;
      e.y = s.y;
      e.vx = 0;
      e.vy = 0;
    }
  }

  // Награда за разбитый объект. Достаётся тому, кто его добил: иначе в коопе
  // выгоднее было бы не трогать бочки, а ждать, пока их разобьёт сосед.
  function applyBreakableReward(e, owner) {
    const reward = e.cfg.reward;
    if (!reward) return;
    const value = reward.value || 0;
    if (reward.type === 'heal') {
      if (owner) owner.hp = Math.min(owner.maxHp, owner.hp + value);
    } else if (reward.type === 'ash') {
      const drop = dropAsh(pickupPool, e.x, e.y, value * economy.dropMultiplier(), 0, config);
      if (drop) separateFromProps(drop, config.sim.pickup_radius || 0, propIndex, null);
    } else if (reward.type === 'push' || reward.type === 'pull') {
      const sign = reward.type === 'push' ? 1 : -1;
      const radius = reward.radius || 0;
      const n = shifted.query(e.x, e.y, radius, queryBuf);
      for (let k = 0; k < n; k++) {
        const idx = queryBuf[k];
        if (idx >= enemyPool.count) continue;
        const o = enemyPool.items[idx];
        if (!o.alive || o.breakable) continue;
        const dx = o.x - e.x;
        const dy = o.y - e.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d > radius) continue;
        // Толчок через тот же канал, что и отбрасывание оружием: сопротивление
        // босса и config.sim.knockback_scale работают сами собой.
        const k2 = value * (1 - o.kbResist) * config.sim.knockback_scale * sign;
        o.kbX += (dx / d) * k2;
        o.kbY += (dy / d) * k2;
      }
    }
    pushEvent('breakable_down', reward.type === 'heal' ? 1 : 0, { x: e.x, y: e.y });
  }

  function endRun(win) {
    state.win = win;
    state.phase = PHASE_OVER;
    state.phaseTime = 0;
    state.paused = false;
    clearEnemies();
    pushEvent('run_over', win ? 1 : 0, {
      wave: state.wave, kills: state.kills, score: state.score,
      time: state.time, bosses: state.bosses, win: !!win,
      damage_taken: state.damage_taken, ash_gained: state.ash_gained,
      shop_buys: state.shop_buys,
    });
  }

  function setPaused(on) {
    if (state.phase === PHASE_OVER) return false;
    state.paused = !!on;
    pushEvent('pause', state.paused ? 1 : 0);
    return true;
  }

  function anyonePending() {
    for (let i = 0; i < state.players.length; i++) {
      if (state.players[i].pendingLevels > 0) return true;
    }
    return false;
  }

  // Прокачка полученных уровней — у всех в конце волны, до лавки.
  function openLevelUp() {
    state.phase = PHASE_LEVELUP;
    state.shopOpen = false;
    const timer = config.coop.levelup_timer != null
      ? config.coop.levelup_timer
      : config.coop.shop_timer;
    state.phaseTime = coop ? timer : Infinity;
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      if (p.pendingLevels > 0) {
        // Снимок вариантов для сетевой рассылки; roll мутирует общий буфер —
        // копируем поля в отдельный массив на игрока.
        const rolled = levelUp.roll(p, rng);
        const copy = [];
        for (let c = 0; c < rolled.length; c++) {
          const src = rolled[c];
          copy.push({
            stat: src.stat, value: src.value, name: src.name,
            texture: src.texture, color: src.color, kind: src.kind,
            rarity: src.rarity, rarityIndex: src.rarityIndex,
          });
        }
        levelChoices[p.id] = copy;
      } else {
        levelChoices[p.id] = null;
      }
    }
    pushEvent('levelup_open', state.wave);
  }

  function choicesFor(playerId) {
    return levelChoices[playerId] || null;
  }

  function applyLevelPick(playerId, choiceIdx) {
    if (state.phase !== PHASE_LEVELUP) return false;
    const p = findPlayer(playerId);
    if (!p || p.pendingLevels <= 0) return false;
    let choices = levelChoices[playerId];
    if (!choices || !choices[choiceIdx]) {
      // Нет сохранённых — ролл на месте (соло / авто)
      choices = levelUp.roll(p, rng);
      const copy = [];
      for (let c = 0; c < choices.length; c++) {
        const src = choices[c];
        copy.push({
          stat: src.stat, value: src.value, name: src.name,
          texture: src.texture, color: src.color, kind: src.kind,
          rarity: src.rarity, rarityIndex: src.rarityIndex,
        });
      }
      levelChoices[playerId] = copy;
      choices = copy;
    }
    const choice = choices[choiceIdx];
    if (!choice) return false;
    applyLevelChoice(p, config, choice);
    if (p.pendingLevels > 0) {
      const rolled = levelUp.roll(p, rng);
      const copy = [];
      for (let c = 0; c < rolled.length; c++) {
        const src = rolled[c];
        copy.push({
          stat: src.stat, value: src.value, name: src.name,
          texture: src.texture, color: src.color, kind: src.kind,
          rarity: src.rarity, rarityIndex: src.rarityIndex,
        });
      }
      levelChoices[playerId] = copy;
    } else {
      levelChoices[playerId] = null;
    }
    if (!anyonePending()) openShop();
    return true;
  }

  function autoResolveLevelUps() {
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      while (p.pendingLevels > 0) {
        const pick = levelUp.autoPick(p, rng);
        applyLevelChoice(p, config, pick);
      }
      levelChoices[p.id] = null;
    }
  }

  // Лавка между волнами. В соло ждём игрока сколько угодно; в коопе — до
  // coop.shop_timer, потом волна стартует сама (иначе один AFK держит комнату).
  function openShop() {
    state.phase = PHASE_SHOP;
    state.shopOpen = true;
    state.phaseTime = coop ? config.coop.shop_timer : Infinity;
    for (const k in ready) delete ready[k];
    // Выбывших поднимает healEveryone на старте следующей волны — здесь только ассортимент.
    // Залоченные слоты переживают open(): fillSlot возвращается на них сразу.
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
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
    if (state.paused) return;

    state.time += dt;
    state.phaseTime -= dt;

    // Сетка врагов пересобирается раз в кадр — все запросы соседей идут через неё
    enemyGrid.clear();
    for (let i = 0; i < enemyPool.count; i++) {
      const e = enemyPool.items[i];
      gridInsert(i, e.x, e.y);
    }

    // На левелапе и в лавке мир стоит: только UI выбора.
    // Лавку сюда пришлось добавить из-за кооп-асимметрии: в соло симуляция на
    // паузе, а в коопе она крутилась все coop.shop_timer секунд, и кооп-игроки
    // регенерировали до двух минут здоровья за волну там, где соло не получал ничего.
    if (state.phase !== PHASE_LEVELUP && state.phase !== PHASE_SHOP) {
      stepPlayers(state.players, dt, config, arenaW, arenaH, propIndex);
    }

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

    if (state.phase !== PHASE_LEVELUP) {
      stepProjectiles(projPool, dt, projDeps);
      stepPickups(pickupPool, dt, pickupDeps, state.phase === PHASE_COLLECT);
    }

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

    if (state.phase === PHASE_LEVELUP && state.phaseTime <= 0) {
      autoResolveLevelUps();
      openShop();
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
        else if (anyonePending()) openLevelUp();
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

  // --- читы (только для админ-хоста, UI снаружи) ------------------------
  function cheatAddAsh(amount) {
    economy.add(amount);
    syncAsh();
  }

  function noteShopBuy() {
    state.shop_buys += 1;
  }

  function cheatLevelUp(playerId) {
    const p = findPlayer(playerId);
    if (!p) return;
    p.pendingLevels += 1;
    p.level += 1;
    p.xpNext = (() => {
      const f = config.level.xp_formula;
      return Math.round(f.base + f.k * Math.pow(p.level, f.pow));
    })();
  }
  function cheatGodMode(playerId, on) {
    const p = findPlayer(playerId);
    if (!p) return;
    p._god = !!on;
    if (p._god) p.iframes = 9999;
  }
  function cheatKillAll() {
    for (let i = 0; i < enemyPool.count; i++) {
      const e = enemyPool.items[i];
      // Ломаемые объекты живут в том же пуле, но «убить всех» — про врагов:
      // иначе чит накручивал бы убийства и очки за бочки и заодно молча съедал
      // мини-ивенты волны, не выдав ни одной награды.
      if (e.breakable) continue;
      if (e.alive) {
        e.hp = 0;
        e.alive = false;
        state.kills += 1;
        state.score += e.score;
      }
    }
  }
  function cheatSkipWave() {
    if (state.phase === PHASE_WAVE || state.phase === PHASE_INTRO) {
      clearEnemies();
      state.phase = PHASE_COLLECT;
      state.phaseTime = config.run.wave_end_collect_sec;
      pushEvent('wave_end', state.wave);
    }
  }

  // Первая волна не проходит через startWave: её состояние выставлено прямо в
  // литерале state, а startWave зовётся только на переходах между волнами. Значит
  // и объекты на ней надо поставить руками, иначе вся первая волна — единственная
  // за забег без единого мини-ивента.
  spawnBreakables();

  return {
    state, step, applyInput, snapshot, stats, refreshStats, events, spawns,
    enemyPool, projPool, pickupPool, rng,
    startWave, endRun, openShop, openLevelUp, readyUp, shopFor, levelUp, coop,
    economy, wallet, syncAsh, setPaused, applyLevelPick, choicesFor, anyonePending,
    noteShopBuy, curseFx,
    cheatAddAsh, cheatLevelUp, cheatGodMode, cheatKillAll, cheatSkipWave,
    danger: dangerCfg, arenaW, arenaH, layout, propIndex,
  };
}

export function waveLength(config, wave, curseFx) {
  const r = config.run;
  const boss = r.boss_waves[String(wave)];
  let len;
  if (boss && boss.len) len = boss.len;
  else {
    len = Math.min(r.wave_len_cap, r.wave_len_base + r.wave_len_step * (wave - 1));
    if (boss && boss.len_bonus) len += boss.len_bonus;
  }
  const mult = curseFx && curseFx.wave_len_mult ? curseFx.wave_len_mult : 1;
  return len * mult;
}

function firstKey(obj) {
  for (const k in obj) return k;
  return null;
}

const MAX_EVENTS = 64;
const BOSS_MID_WAVE = 10;
