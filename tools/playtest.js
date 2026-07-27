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
import { buy, mergeable, merge, freeSlotIndex, rerollCost } from '../static/js/sim/shop.js';
import { refreshStats } from '../static/js/sim/player.js';
import { steer } from './bot_move.js';

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
  let wavePrev = { kills: 0, wave: 1, gained: 0 };

  while (run.state.phase !== PHASE_OVER && guard++ < limit) {
    // --- левелап: только в фазе LEVELUP (конец волны)
    if (run.state.phase === 'levelup') {
      while (p.pendingLevels > 0 && run.state.phase === 'levelup') {
        const choices = run.choicesFor(p.id) || run.levelUp.roll(p, run.rng);
        let pick = 0;
        let best = 1e9;
        for (let i = 0; i < choices.length; i++) {
          const rank = PRIORITY.indexOf(choices[i].stat);
          const score = rank < 0 ? 100 : rank;
          if (score < best) { best = score; pick = i; }
        }
        run.applyLevelPick(p.id, pick);
      }
      continue;
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
          // Доход ИМЕННО ЗА ЭТУ ВОЛНУ. Остаток в кошельке (ash) для баланса не
          // годится: он зависит от того, что бот успел купить. Целевая кривая из
          // ТЗ задана как «сколько игрок получает за волну».
          income: Math.round(run.state.ash_gained - wavePrev.gained),
          level: p.level,
          weapons: p.slots.filter((s) => s.cfg).length,
          items: p.items.length,
          dmg: Math.round(p.stats.damage_pct),
        });
        wavePrev = {
          kills: run.state.kills,
          wave: run.state.wave + 1,
          gained: run.state.ash_gained,
        };
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
          const res = buy(p, shop, i, config, run.wallet, () => refreshStats(p, config));
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
        if (shop.reroll(p, run.danger, run.rng, run.wallet) > 0) rerolled++;
      }
      run.readyUp(p.id);
      continue;
    }

    // --- бой: направление выбирает общая «голова» бота (tools/bot_move.js),
    // та же, что и в замере кооп-дохода
    steer(p, run, config);

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
      console.log('  волна | убил | остал | HP     | доход | прах | ур | ор | пр');
      for (const w of r.perWave) {
        console.log(`  ${String(w.wave).padStart(5)} | ${String(w.kills).padStart(4)} `
          + `| ${String(w.alive).padStart(5)} | ${(w.hp + '/' + w.maxHp).padStart(6)} `
          + `| ${String(w.income).padStart(5)} | ${String(w.ash).padStart(4)} `
          + `| ${String(w.level).padStart(2)} `
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
