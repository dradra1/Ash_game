// Автопрогон забега головой, без браузера: бот бегает, качается и закупается.
// Отвечает на главный вопрос M2 — «проходится ли забег и решает ли билд».
//
//   node tools/playtest.js                       один забег, сложность 1
//   node tools/playtest.js --danger 3 --runs 20  двадцать забегов на «Мученике»
//   node tools/playtest.js --runs 10 --quiet     только сводка
//
// Бот намеренно простой: держится подальше от ближайшего врага, на левелапе берёт
// по приоритету своего билда, в лавке покупает всё, что по карману. Это нижняя
// граница мастерства: если у бота проходится, у человека тем более.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRun, PHASE_SHOP, PHASE_OVER } from '../static/js/sim/run.js';
import { applyLevelChoice } from '../static/js/sim/player.js';
import { buy, mergeable, merge, freeSlotIndex, rerollCost } from '../static/js/sim/shop.js';
import { refreshStats } from '../static/js/sim/player.js';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, '../config/game_config.json'), 'utf8'));

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}
const has = (name) => process.argv.indexOf('--' + name) >= 0;

const DANGER = arg('danger', 1);
const RUNS = arg('runs', 1);
const CHARACTER = 'ch_pilgrim';
const QUIET = has('quiet');
// Проверка машинерии, а не баланса: с бессмертным игроком видно, доходит ли забег
// до 20-й волны, появляется ли босс, работает ли экономика и растёт ли билд.
const GOD = has('god');

// Приоритет левелапа: живучесть, потом урон. Специально не оптимальный.
const PRIORITY = ['max_hp', 'damage_pct', 'attack_speed_pct', 'armor',
  'melee_dmg', 'ranged_dmg', 'move_speed_pct', 'crit_pct'];

// Порог отхода подстраивается под оружие: убегать дальше, чем бьёшь, —
// значит не убить никого. Бот держит врагов на дистанции чуть меньше своей
// самой короткой дальности, чтобы оружие стреляло, но контакта не было.
const WALL_R = 140;
const DIRS = 16;         // сколько направлений перебираем
const LOOKAHEAD = 0.5;   // на сколько секунд заглядываем вперёд
const WALL_PENALTY = 1.5;
const DANGER_W = 6;      // штраф за подпускание врага в контакт
const KILL_W = 7;        // премия за каждую цель в радиусе оружия

function threatRadius(p, config) {
  let shortest = Infinity;
  for (const s of p.slots) {
    if (s.cfg && s.cfg.range < shortest) shortest = s.cfg.range;
  }
  if (!isFinite(shortest)) shortest = 120;
  const contact = config.player.radius + 24;
  return Math.max(contact + 18, shortest * 0.8);
}

function wallPush(v, size) {
  if (v < WALL_R) return (WALL_R - v) / WALL_R;
  if (v > size - WALL_R) return -(WALL_R - (size - v)) / WALL_R;
  return 0;
}

const transport = { id: 0, isHost: true, role: 'host', send() {}, on() {}, off() {}, close() {} };

function playOne(seed) {
  const run = createRun({
    config, seed, transport,
    players: [{ id: 0, name: 'bot', character: CHARACTER }],
    arena: 'ar_hive', danger: DANGER,
  });
  const p = run.state.players[0];
  const dt = config.sim.dt;
  let guard = 0;
  const limit = 60 * 60 * 60;      // час игрового времени — заведомо больше забега
  let bought = 0;
  let rerolled = 0;
  // Поволновой срез: без него баланс правится на ощупь
  const perWave = [];
  let wavePrev = { kills: 0, wave: 1 };

  while (run.state.phase !== PHASE_OVER && guard++ < limit) {
    // --- левелап: берём по приоритету
    while (p.pendingLevels > 0) {
      const choices = run.levelUp.roll(p, run.rng);
      let pick = 0;
      let best = 1e9;
      for (let i = 0; i < choices.length; i++) {
        const rank = PRIORITY.indexOf(choices[i].stat);
        const score = rank < 0 ? 100 : rank;
        if (score < best) { best = score; pick = i; }
      }
      applyLevelChoice(p, config, choices[pick]);
    }

    // --- лавка: слить что можно, купить что по карману, объявить готовность
    if (run.state.phase === PHASE_SHOP) {
      if (wavePrev.wave === run.state.wave) {
        perWave.push({
          wave: run.state.wave,
          kills: run.state.kills - wavePrev.kills,
          alive: run.enemyPool.count,
          hp: Math.ceil(p.hp),
          maxHp: p.maxHp,
          ash: Math.floor(p.ash),
          level: p.level,
          weapons: p.slots.filter((s) => s.cfg).length,
          items: p.items.length,
          dmg: Math.round(p.stats.damage_pct),
        });
        wavePrev = { kills: run.state.kills, wave: run.state.wave + 1 };
      }
      const shop = run.shopFor(p.id);
      if (process.env.PT_DEBUG) {
        console.log(`  [лавка перед волной ${run.state.wave + 1}] прах ${Math.floor(p.ash)}: `
          + shop.slots.map((s) => s.cfg ? `${s.id}@${s.price}` : 'пусто').join(', '));
      }
      let m = mergeable(p, config);
      while (m) {
        merge(p, m, config, () => refreshStats(p, config));
        m = mergeable(p, config);
      }
      for (let pass = 0; pass < 3; pass++) {
        // Пока слоты пустые, оружие важнее предметов: один ствол не выносит волну
        const needWeapons = freeSlotIndex(p) >= 0
          && p.slots.filter((s) => s.cfg).length < 3;
        for (let pri = 0; pri < 2; pri++) {
        for (let i = 0; i < shop.slots.length; i++) {
          const s = shop.slots[i];
          if (!s.cfg || s.sold) continue;
          if (needWeapons && pri === 0 && s.kind !== 'weapon') continue;
          if (s.kind === 'weapon' && freeSlotIndex(p) < 0) continue;
          if (p.ash < s.price) continue;
          const res = buy(p, shop, i, config, () => refreshStats(p, config));
          if (res === 'ok') bought++;
          else if (process.env.PT_DEBUG) console.log('  отказ', s.kind, s.id, s.price, res, 'прах', Math.floor(p.ash));
        }
        }
        // Реролл как у человека: если ничего не по карману, но реролл по карману —
        // крутим в надежде на что-то дешевле; если по карману покупка, крутим только
        // когда после реролла хватит и на неё.
        const cost = rerollCost(config, shop.state.rerolls);
        let cheapest = Infinity;
        for (const s of shop.slots) if (s.cfg && !s.sold && s.price < cheapest) cheapest = s.price;
        const canBuy = p.ash >= cheapest;
        const worthIt = canBuy ? p.ash >= cost + cheapest : p.ash >= cost * 2;
        if (!worthIt) break;
        if (shop.reroll(p, run.danger, run.rng) > 0) rerolled++;
      }
      run.readyUp(p.id);
      continue;
    }

    // --- бой: перебор направлений. Для каждого из DIRS вариантов смотрим, где
    // окажемся через LOOKAHEAD секунд, и берём тот, где ближайший враг дальше всего
    // (со штрафом за стену). Это близко к тому, как кайтит человек, и, в отличие от
    // чистого отталкивания, не загоняет само себя в угол.
    const aw = config.arena.size[0];
    const ah = config.arena.size[1];
    const pad = config.arena.wall_padding;
    // Дальность самого длинного оружия — по ней и собираем цели
    let reach = 0;
    for (const s of p.slots) if (s.cfg && s.cfg.range > reach) reach = s.cfg.range;
    if (reach === 0) reach = 120;
    const reach2 = reach * reach;
    const safeD = config.player.radius + 30;
    let bestScore = -Infinity;
    let bx = 0;
    let by = 0;
    for (let d = 0; d < DIRS; d++) {
      const a = (d / DIRS) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let nx = p.x + dx * p.speed * LOOKAHEAD;
      let ny = p.y + dy * p.speed * LOOKAHEAD;
      if (nx < pad) nx = pad; else if (nx > aw - pad) nx = aw - pad;
      if (ny < pad) ny = pad; else if (ny > ah - pad) ny = ah - pad;

      let minD2 = Infinity;
      let inRange = 0;
      for (let i = 0; i < run.enemyPool.count; i++) {
        const e = run.enemyPool.items[i];
        // враг тоже успеет подойти — учитываем его смещение к нам
        const ex = e.x + (p.x - e.x) * (e.speed * LOOKAHEAD) / (Math.hypot(p.x - e.x, p.y - e.y) || 1);
        const ey = e.y + (p.y - e.y) * (e.speed * LOOKAHEAD) / (Math.hypot(p.x - e.x, p.y - e.y) || 1);
        const ddx = nx - ex;
        const ddy = ny - ey;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < minD2) minD2 = d2;
        if (d2 <= reach2) inRange++;
      }
      // Чистое «убежать подальше» = ноль убийств = нет праха = смерть позже.
      // Оценка ищет компромисс: не пускать врага в контакт, но держать в радиусе
      // оружия как можно больше целей — это и есть навык жанра.
      const minD = Math.sqrt(minD2);
      let score = minD < safeD ? (minD - safeD) * DANGER_W : 0;
      score += inRange * KILL_W;
      const wall = Math.min(nx, ny, aw - nx, ah - ny);
      if (wall < WALL_R) score -= (WALL_R - wall) * WALL_PENALTY;
      if (score > bestScore) { bestScore = score; bx = dx; by = dy; }
    }
    p.input.x = bx;
    p.input.y = by;

    run.step(dt);
    if (GOD) { p.hp = p.maxHp; p.alive = true; }
  }

  return {
    wave: run.state.wave,
    win: run.state.win,
    kills: run.state.kills,
    score: run.state.score,
    bosses: run.state.bosses,
    level: p.level,
    time: run.state.time,
    ash: Math.floor(p.ash),
    bought,
    rerolled,
    perWave,
    weapons: p.slots.filter((s) => s.cfg).map((s) => s.cfg.name),
    items: p.items.length,
    hp: `${Math.ceil(p.hp)}/${p.maxHp}`,
  };
}

const results = [];
for (let i = 0; i < RUNS; i++) {
  const r = playOne(1000 + i * 7919);
  results.push(r);
  if (!QUIET) {
    console.log(`забег ${i + 1}: волна ${r.wave}${r.win ? ' ПОБЕДА' : ''}`
      + `, уровень ${r.level}, боссов ${r.bosses}, убийств ${r.kills}`
      + `, очки ${r.score}, куплено ${r.bought}, рероллов ${r.rerolled}`);
    if (RUNS === 1) {
      console.log('  волна | убил | остал | HP     | прах | ур | ор | пр');
      for (const w of r.perWave) {
        console.log(`  ${String(w.wave).padStart(5)} | ${String(w.kills).padStart(4)} `
          + `| ${String(w.alive).padStart(5)} | ${(w.hp + '/' + w.maxHp).padStart(6)} `
          + `| ${String(w.ash).padStart(4)} | ${String(w.level).padStart(2)} `
          + `| ${String(w.weapons).padStart(2)} | ${String(w.items).padStart(2)}`);
      }
      console.log(`  оружие: ${r.weapons.join(', ') || '—'}`);
      console.log(`  предметов ${r.items}, HP ${r.hp}, праха ${r.ash}, ` +
        `время ${Math.round(r.time)} с`);
    }
  }
}

const wins = results.filter((r) => r.win).length;
const avgWave = results.reduce((a, r) => a + r.wave, 0) / results.length;
const avgLevel = results.reduce((a, r) => a + r.level, 0) / results.length;
const bosses = results.reduce((a, r) => a + r.bosses, 0);
console.log(`\nсложность ${DANGER} (${config.danger[DANGER].name}), забегов ${RUNS}`);
console.log(`побед ${wins}/${RUNS}, средняя волна ${avgWave.toFixed(1)}, ` +
  `средний уровень ${avgLevel.toFixed(1)}, боссов убито ${bosses}`);
