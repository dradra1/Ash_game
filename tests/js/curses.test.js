import test from 'node:test';
import assert from 'node:assert';
import { loadConfig } from './fixture.js';
import {
  resolveCurseFx, curseStatMods, applyCurseToDanger, emptyCurseFx,
} from '../../static/js/sim/curses.js';
import { createShop, priceOf } from '../../static/js/sim/shop.js';
import { createEconomy, createWallet } from '../../static/js/sim/economy.js';
import { createPlayer } from '../../static/js/sim/player.js';
import { createRng } from '../../static/js/engine/rng.js';
import { waveLength } from '../../static/js/sim/run.js';
import { spawnBudget } from '../../static/js/sim/spawn.js';
import { createRun } from '../../static/js/sim/run.js';
import { stubTransport, makePlayers } from './fixture.js';

const config = loadConfig();

test('resolveCurseFx пустой список даёт нейтральные множители', () => {
  const fx = resolveCurseFx(config, []);
  assert.equal(fx.density_mult, 1);
  assert.equal(fx.ash_drop_zero, false);
  assert.equal(fx.ids.length, 0);
});

test('проклятия перемножают density и суммируют tithe', () => {
  const fx = resolveCurseFx(config, ['cu_swarm', 'cu_ashless_tithe']);
  assert.ok(Math.abs(fx.density_mult - 1.75) < 1e-9);
  assert.equal(fx.ash_drop_zero, true);
  assert.equal(fx.tithe, 0.5);
  assert.ok(fx.ids.indexOf('cu_swarm') >= 0);
});

test('blood_gold даёт enemy_dmg ×11 и ash ×5', () => {
  const fx = resolveCurseFx(config, ['cu_blood_gold']);
  assert.equal(fx.enemy_dmg_mult, 11);
  assert.equal(fx.ash_drop_mult, 5);
  const d = applyCurseToDanger(config.danger[1], fx);
  assert.ok(Math.abs(d.dmg_mult - config.danger[1].dmg_mult * 11) < 1e-9);
});

test('curseStatMods: стеклянный обет режет HP и даёт урон', () => {
  const fx = resolveCurseFx(config, ['cu_glass_vow']);
  const mods = curseStatMods(fx);
  assert.equal(mods.max_hp_pct, -50);
  assert.equal(mods.damage_pct, 75);
});

test('free_market: лавка бесплатна и даёт бесплатный реролл', () => {
  const fx = resolveCurseFx(config, ['cu_free_market']);
  assert.equal(fx.shop_free, true);
  assert.equal(fx.free_rerolls, 1);
  const p = createPlayer(config, 0, 'p', 'ch_pilgrim', 0, 0);
  p.ash = 0;
  const shop = createShop(config, null, fx);
  const rng = createRng(1);
  const danger = applyCurseToDanger(config.danger[1], fx);
  shop.open(p, 5, danger, rng, false);
  for (const s of shop.slots) {
    if (s.cfg) assert.equal(s.price, 0);
  }
  const spent = shop.reroll(p, danger, rng, createWallet(createEconomy(config, 1), null));
  assert.equal(spent, 0);
  assert.equal(p.ash, 0);
});

test('iron_tithe удваивает цены через danger.price_mult', () => {
  const fx = resolveCurseFx(config, ['cu_iron_tithe']);
  const d = applyCurseToDanger(config.danger[1], fx);
  assert.ok(Math.abs(d.price_mult - config.danger[1].price_mult * 2) < 1e-9);
  assert.ok(priceOf(config, 40, 10, d) > priceOf(config, 40, 10, config.danger[1]));
});

test('short_rite укорачивает волну и поднимает density', () => {
  const fx = resolveCurseFx(config, ['cu_short_rite']);
  assert.ok(Math.abs(waveLength(config, 5, fx) - waveLength(config, 5) * 0.65) < 1e-9);
  const d = applyCurseToDanger(config.danger[1], fx);
  assert.ok(spawnBudget(config, 5, d, 1) > spawnBudget(config, 5, config.danger[1], 1));
});

test('danger 4–5 имеют dual bosses и ash_mult < 1', () => {
  assert.ok(config.danger.length >= 5);
  assert.equal(config.danger[3].bosses_final, 2);
  assert.equal(config.danger[4].bosses_final, 2);
  assert.ok(config.danger[4].ash_mult < config.danger[0].ash_mult);
});

test('emptyCurseFx нейтрален', () => {
  const e = emptyCurseFx();
  assert.equal(e.reward_mult, 1);
  assert.equal(e.shop_free, false);
});

// Регресс: с ЛЮБЫМ выбранным проклятием забег не создавался вовсе. В createRun
// локальная функция статистики сущностей называлась `refreshStats` и затеняла
// импортированный пересчёт статов игрока; ветка «наложить моды проклятий» звала не
// ту функцию и падала в TDZ. Игрок видел это как «выбрал проклятия, нажал „Дальше“
// — и вернулся в главное меню»: экран мастера прятался, а забег не стартовал.
//
// Тесты этого не ловили, потому что все проверки проклятий были на чистых формулах
// и ни одна не собирала настоящий забег с непустым списком.
test('забег создаётся с любым проклятием и переживает первые секунды', () => {
  const ids = Object.keys(config.curses);
  const mk = (curses) => createRun({
    config, seed: 42, transport: stubTransport(),
    players: makePlayers(1, Object.keys(config.characters)[0]),
    arena: Object.keys(config.arenas)[0], danger: 0, curses,
  });
  for (const id of ids) {
    const run = mk([id]);
    for (let i = 0; i < 120; i++) run.step(config.sim.dt);
    assert.deepEqual(run.state.curses, [id], `проклятие ${id} не доехало до состояния`);
  }
  const all = mk(ids);
  for (let i = 0; i < 120; i++) all.step(config.sim.dt);
  assert.equal(all.state.curses.length, ids.length);
});

// Та же поломка молча съедала бы и сам эффект: моды проклятия накладываются
// пересчётом статов, и если он не вызвался, «Стеклянный обет» не режет HP.
test('моды проклятия доезжают до статов игрока', () => {
  const mk = (curses) => createRun({
    config, seed: 7, transport: stubTransport(),
    players: makePlayers(1, Object.keys(config.characters)[0]),
    arena: Object.keys(config.arenas)[0], danger: 0, curses,
  });
  const plain = mk([]).state.players[0];
  const cursed = mk(['cu_glass_vow']).state.players[0];
  assert.ok(cursed.maxHp < plain.maxHp,
    `max_hp_mult 0.5 не применён: ${cursed.maxHp} против ${plain.maxHp}`);
  assert.equal(cursed.hp, cursed.maxHp, 'HP не подтянут под новый максимум');
  assert.ok(cursed.stats.damage_pct > plain.stats.damage_pct, 'damage_pct не применён');
});
