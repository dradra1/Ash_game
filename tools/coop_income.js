// Замер кооп-экономики: сколько праха получает ОДИН игрок при разных составах.
//
// Главное требование ТЗ §3.8 к коопу — «вдвоём не беднее и не богаче на голову».
// Проверить это формулой мало: доход собирается из трёх умножений, которые тянут в
// разные стороны — спавн множит число врагов на budget_per_player, дроп множит прах
// на economy.dropMultiplier(), а котёл делится на N. Именно расхождение между ними
// давало коопу тройной доход (BALANCE.md п. 10). Здесь всё это считается на живой
// симуляции: те же боты, тот же сид, разное число игроков.
//
//   node tools/coop_income.js                    1/2/4/8 игроков, 10 волн
//   node tools/coop_income.js --waves 15 --buy   с закупкой в лавке
//   node tools/coop_income.js --players 1,8 --seed 777
//   node tools/coop_income.js --seed 11,22,33    среднее по трём сидам
//
// Сидов по умолчанию три, и это не перестраховка. Один прогон — это одна
// раскладка арены, одна расстановка установок и одна последовательность
// поворотов бота; разброс между сидами доходит до полутора раз. Калибровать
// компенсацию дропа по одному сиду значит подгонять её под случайность.
//
// Боты бессмертны намеренно: смерть штрафует котёл (coop.death_penalty) и меняет
// состав, а мерить надо формулу дохода, а не живучесть ботов.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRun, PHASE_SHOP, PHASE_OVER } from '../static/js/sim/run.js';
import { buy, mergeable, merge, freeSlotIndex } from '../static/js/sim/shop.js';
import { refreshStats } from '../static/js/sim/player.js';
import { steer } from './bot_move.js';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, '../config/game_config.json'), 'utf8'));

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.indexOf('--' + name) >= 0;

const WAVES = Number(arg('waves', 10));
const SEEDS = String(arg('seed', '4242,777,31337')).split(',').map(Number);
const DANGER = Number(arg('danger', 1));
const BUY = has('buy');
const COMPS = String(arg('players', '1,2,4,8')).split(',').map(Number);
const CHARACTER = 'ch_pilgrim';

const PRIORITY = ['max_hp', 'damage_pct', 'attack_speed_pct', 'armor',
  'melee_dmg', 'ranged_dmg', 'move_speed_pct', 'crit_pct'];

const transport = { id: 0, isHost: true, role: 'host', send() {}, on() {}, off() {}, close() {} };

function makePlayers(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: i, name: 'bot' + i, character: CHARACTER });
  return out;
}

function doLevelUps(run) {
  for (const p of run.state.players) {
    let guard = 0;
    while (p.pendingLevels > 0 && guard++ < 64) {
      const choices = run.choicesFor(p.id);
      if (!choices) break;
      let pick = 0;
      let best = 1e9;
      for (let i = 0; i < choices.length; i++) {
        const rank = PRIORITY.indexOf(choices[i].stat);
        const score = rank < 0 ? 100 : rank;
        if (score < best) { best = score; pick = i; }
      }
      run.applyLevelPick(p.id, pick);
    }
  }
}

// Закупка как у playtest.js, но короче: здесь важен не билд, а то, что прах
// действительно СПИСЫВАЕТСЯ через кошелёк — иначе замер дохода поймал бы старый
// баг с возвратом потраченного (BALANCE.md п. 9).
function doShop(run) {
  for (const p of run.state.players) {
    if (BUY) {
      const shop = run.shopFor(p.id);
      let m = mergeable(p, config);
      while (m) {
        merge(p, m, config, () => refreshStats(p, config));
        m = mergeable(p, config);
      }
      for (let i = 0; i < shop.slots.length; i++) {
        const s = shop.slots[i];
        if (!s.cfg || s.sold) continue;
        if (s.kind === 'weapon' && freeSlotIndex(p) < 0) continue;
        if (run.wallet.balance(p) < s.price) continue;
        buy(p, shop, i, config, run.wallet, () => refreshStats(p, config));
      }
    }
    run.readyUp(p.id);
  }
}

function measure(players, seed) {
  const run = createRun({
    config, seed, transport,
    players: makePlayers(players),
    arena: 'ar_hive', danger: DANGER,
  });
  const dt = config.sim.dt;
  const perWave = [];
  let prevGained = 0;
  let prevKills = 0;
  let guard = 0;
  const limit = 60 * 60 * 60;

  while (run.state.phase !== PHASE_OVER && run.state.wave <= WAVES && guard++ < limit) {
    if (run.state.phase === 'levelup') {
      doLevelUps(run);
      // Сорванный левелап (выбор не пришёл) не должен вешать прогон
      if (run.anyonePending && run.anyonePending()) run.step(dt);
      continue;
    }
    if (run.state.phase === PHASE_SHOP) {
      perWave.push({
        wave: run.state.wave,
        kills: run.state.kills - prevKills,
        pot: Math.round(run.state.ash_gained - prevGained),
        per: Math.round((run.state.ash_gained - prevGained) / players),
      });
      prevGained = run.state.ash_gained;
      prevKills = run.state.kills;
      doShop(run);
      continue;
    }
    for (const p of run.state.players) steer(p, run, config);
    run.step(dt);
    for (const p of run.state.players) { p.hp = p.maxHp; p.alive = true; }
  }
  return perWave;
}

// Среднее по сидам поволново: складываем одинаковые волны разных прогонов.
const data = {};
for (const n of COMPS) {
  const runs = [];
  for (const seed of SEEDS) {
    process.stdout.write(`считаю состав ${n}, сид ${seed}...\r`);
    runs.push(measure(n, seed));
  }
  const len = Math.min(...runs.map((r) => r.length));
  const avg = [];
  for (let i = 0; i < len; i++) {
    let per = 0;
    let pot = 0;
    let kills = 0;
    for (const r of runs) { per += r[i].per; pot += r[i].pot; kills += r[i].kills; }
    avg.push({
      wave: runs[0][i].wave,
      per: Math.round(per / runs.length),
      pot: Math.round(pot / runs.length),
      kills: kills / runs.length,
    });
  }
  data[n] = avg;
}

const waves = Math.min(...COMPS.map((n) => data[n].length));
console.log(`сиды ${SEEDS.join(', ')}, сложность ${DANGER}, `
  + `закупка в лавке: ${BUY ? 'да' : 'нет'}`);
console.log('прах НА ОДНОГО игрока за волну (в скобках — общий котёл)\n');
console.log('  волна | ' + COMPS.map((n) => `${n} игр.`.padStart(13)).join(' | '));
for (let i = 0; i < waves; i++) {
  const row = COMPS.map((n) => {
    const w = data[n][i];
    return `${String(w.per).padStart(5)} (${String(w.pot).padStart(5)})`;
  });
  console.log(`  ${String(data[COMPS[0]][i].wave).padStart(5)} | ${row.join(' | ')}`);
}

// Итог: доля соло принята за 1.0. Всё, что заметно выше, — кооп богаче.
const total = {};
for (const n of COMPS) total[n] = data[n].slice(0, waves).reduce((a, w) => a + w.per, 0);
const base = total[COMPS[0]] || 1;
console.log('\n  состав | на игрока за ' + waves + ' волн | к соло');
for (const n of COMPS) {
  console.log(`  ${String(n).padStart(6)} | ${String(total[n]).padStart(20)} `
    + `| ${(total[n] / base).toFixed(2)}`);
}

const worst = Math.max(...COMPS.map((n) => Math.abs(total[n] / base - 1)));
console.log(`\nмаксимальное отклонение от соло: ${(worst * 100).toFixed(0)}%`);

// Во сколько раз кооп убивает больше соло. Именно это число обязана
// компенсировать economy.dropMultiplier: личный доход = убийства × дроп / N, и
// чтобы он совпал с соло, дроп должен равняться N / (рост убийств). Раньше вместо
// измеренного роста туда подставлялся ПЛАНОВЫЙ рост спавна (budget_per_player) —
// а это разные числа: часть волны просто не доживает до конца, и с инженерией
// разрыв стал кратным.
// Убийства складываем по ТОМУ ЖЕ окну волн, что и доход. Иначе состав, добравшийся
// до десятой волны, сравнивается с тем, кто дошёл до восьмой, и рост убийств
// оказывается завышен вдвое — а по этой колонке калибруют kill_scale.
const killsOf = {};
for (const n of COMPS) {
  killsOf[n] = data[n].slice(0, waves).reduce((a, w) => a + w.kills, 0);
}
const kBase = killsOf[COMPS[0]] || 1;
console.log('\n  состав | убийств за прогон | рост убийств | нужный дроп (N/рост)');
for (const n of COMPS) {
  const grow = killsOf[n] / kBase;
  console.log(`  ${String(n).padStart(6)} | ${String(Math.round(killsOf[n])).padStart(17)} `
    + `| ${grow.toFixed(2).padStart(12)} | ${(n / grow).toFixed(2).padStart(20)}`);
}
