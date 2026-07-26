// Бенчмарк симуляции против бюджета из CLAUDE.md §4: sim ≤ 6 мс/тик при
// 8 игроках, 450 врагах и 600 снарядах. Гонять после любой правки движка.
//
//   node tools/bench_sim.js            быстрый прогон
//   node tools/bench_sim.js --seconds 20 --players 8

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRun } from '../static/js/sim/run.js';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, '../config/game_config.json'), 'utf8'));

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

const players = arg('players', 8);
const seconds = arg('seconds', 15);
const danger = arg('danger', 3);
const wave = arg('wave', 20);

const transport = { id: 0, isHost: true, role: 'host', send() {}, on() {}, off() {}, close() {} };
const list = [];
for (let i = 0; i < players; i++) {
  list.push({ id: i, name: 'p' + i, character: 'ch_pilgrim' });
}

const run = createRun({ config, seed: 20260726, transport, players: list, arena: 'ar_hive', danger });

// Забиваем все слоты смесью ближнего и дальнего: бюджет описан для 600 снарядов,
// а стартовый тесак не создаёт ни одного.
const { equip } = await import('../static/js/sim/weapon.js');
const mix = ['w_nailer_1', 'w_carbine_1', 'w_cleaver_1', 'w_nailer_1', 'w_carbine_1', 'w_censer_1'];
for (const p of run.state.players) {
  for (let s = 0; s < p.slots.length; s++) equip(p.slots[s], mix[s % mix.length], config);
}

// Сразу на финальную волну и с бессмертными игроками — нас интересует нагрузка,
// а не выживание. Ввод раскидываем, чтобы игроки не стояли в одной точке.
run.startWave(wave);
const dt = config.sim.dt;
const steps = Math.round(seconds / dt);
const samples = new Float64Array(steps);

// Прогрев: даём миру наполниться до потолка, эти кадры в статистику не идут
for (let i = 0; i < Math.round(20 / dt); i++) {
  keepAlive();
  run.step(dt);
}

let peakEnemies = 0;
let peakProj = 0;
let peakPickups = 0;

for (let i = 0; i < steps; i++) {
  keepAlive();
  const t0 = process.hrtime.bigint();
  run.step(dt);
  const t1 = process.hrtime.bigint();
  samples[i] = Number(t1 - t0) / 1e6;
  const s = run.refreshStats();
  if (s.enemies > peakEnemies) peakEnemies = s.enemies;
  if (s.projectiles > peakProj) peakProj = s.projectiles;
  if (s.pickups > peakPickups) peakPickups = s.pickups;
}

function keepAlive() {
  const ps = run.state.players;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    p.hp = 1e9;
    p.maxHp = 1e9;
    p.alive = true;
    // круговое движение, чтобы толпа не вырождалась в одну точку
    p.input.x = Math.cos(run.state.time * 0.7 + i);
    p.input.y = Math.sin(run.state.time * 0.7 + i);
  }
}

const sorted = Array.prototype.slice.call(samples).sort((a, b) => a - b);
const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
const p50 = sorted[Math.floor(sorted.length * 0.5)];
const p99 = sorted[Math.floor(sorted.length * 0.99)];
const max = sorted[sorted.length - 1];
const budget = 6;

console.log(`игроков ${players}, сложность ${danger}, волна ${wave}, ${seconds} с симуляции`);
console.log(`пик: врагов ${peakEnemies}, снарядов ${peakProj}, праха ${peakPickups}`);
console.log(`sim мс/тик — среднее ${avg.toFixed(3)}  медиана ${p50.toFixed(3)}  ` +
            `p99 ${p99.toFixed(3)}  максимум ${max.toFixed(3)}`);
console.log(`бюджет ${budget} мс: ${p99 <= budget ? 'УКЛАДЫВАЕМСЯ' : 'ПРЕВЫШЕН'} (по p99)`);
process.exit(p99 <= budget ? 0 : 1);
