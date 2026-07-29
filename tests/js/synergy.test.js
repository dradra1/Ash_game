// Синергии: бонусы за 2/4/6 одетых стволов одного класса.
//
// Что ломается молча:
//   — счёт начинает игнорировать дубликаты или пустые слоты, и пороги
//     срабатывают не тогда, когда на панели лавки загораются пипки;
//   — статовые бонусы перестают доходить до resolveStats (ссылку mods
//     пересоздали, и sources смотрит в старый объект);
//   — бонусы не снимаются при продаже ствола: reset не чистит mods;
//   — спец-бонусы шестого порога (веер, +снаряд, +пробитие, +установка)
//     теряются при пересчёте.

import test from 'node:test';
import assert from 'node:assert';
import { loadConfig } from './fixture.js';
import { createPlayer, refreshStats } from '../../static/js/sim/player.js';
import { equip } from '../../static/js/sim/weapon.js';

const config = loadConfig();
const syn = config.synergies;

// По одному оружию каждого класса из настоящего конфига
const BY_CLASS = {};
for (const id in config.weapons) {
  const cls = config.weapons[id].class;
  if (!BY_CLASS[cls]) BY_CLASS[cls] = id;
}

function newPlayer() {
  const p = createPlayer(config, 0, 'p', 'ch_pilgrim', 100, 100);
  // Изолируемся от стартового оружия персонажа: чистые слоты, чистый счёт
  for (const s of p.slots) { s.id = null; s.cfg = null; }
  refreshStats(p, config);
  return p;
}

function arm(p, cls, n) {
  for (let i = 0; i < n; i++) equip(p.slots[i], BY_CLASS[cls], config);
  refreshStats(p, config);
}

// Ожидания считаем из конфига по ВСЕМ сетам ствола: класс + каждый тег.
// Иначе тест класса врёт: у любого оружия есть теги, и они дают свои бонусы.
function setsOf(id) {
  const cfg = config.weapons[id];
  return [syn.classes[cfg.class], ...(cfg.tags || []).map((tg) => syn.tags[tg])];
}

// Сумма статовых бонусов по сетам ствола id при счёте n (пороги кумулятивны)
function mergedMods(id, n) {
  const out = {};
  for (const tiers of setsOf(id)) {
    for (const th in tiers) {
      if (n < +th || tiers[th].special) continue;
      for (const k in tiers[th]) out[k] = (out[k] || 0) + tiers[th][k];
    }
  }
  return out;
}

// Сводка спец-поля по сетам ствола: множители перемножаются, счётчики суммируются
function specialField(id, n, field, mult) {
  let acc = mult ? 1 : 0;
  for (const tiers of setsOf(id)) {
    for (const th in tiers) {
      if (n < +th || !tiers[th].special) continue;
      const s = syn.specials[tiers[th].special];
      if (s[field] === undefined) continue;
      acc = mult ? acc * s[field] : acc + s[field];
    }
  }
  return acc;
}

test('механика включена и пороги заданы, иначе тест ничего не проверяет', () => {
  assert.equal(syn.enabled, true);
  for (const cls of ['melee', 'ranged', 'elem', 'engi']) {
    assert.ok(BY_CLASS[cls], `в конфиге нет оружия класса ${cls}`);
    assert.deepEqual(Object.keys(syn.classes[cls]).sort(), ['2', '4', '6'],
      `у класса ${cls} должны быть пороги 2/4/6`);
  }
});

test('подсчёт классов идёт по слотам, дубликаты считаются', () => {
  const p = newPlayer();
  arm(p, 'melee', 3);
  assert.equal(p.synergy.counts.melee, 3);
  assert.equal(p.synergy.counts.ranged || 0, 0);
});

test('порог 2: статовый бонус доходит до статы игрока', () => {
  const p = newPlayer();
  const base = p.stats.melee_dmg;
  arm(p, 'melee', 2);
  assert.equal(p.stats.melee_dmg, base + syn.classes.melee['2'].melee_dmg);
});

test('пороги кумулятивны: 4 ствола дают бонусы и 2, и 4', () => {
  const p = newPlayer();
  const baseMelee = p.stats.melee_dmg;
  const baseSpeed = p.stats.attack_speed_pct;
  arm(p, 'melee', 4);
  const want = mergedMods(BY_CLASS.melee, 4);
  assert.equal(p.stats.melee_dmg, baseMelee + (want.melee_dmg || 0));
  assert.equal(p.stats.attack_speed_pct, baseSpeed + (want.attack_speed_pct || 0));
  // и класс, и теги внесли свою долю — иначе проверка вырождена
  assert.ok(want.attack_speed_pct > syn.classes.melee['4'].attack_speed_pct,
    'выбранное оружие не имеет тега со скоростью атаки — тест не проверяет стек');
});

test('один ствол бонуса не даёт', () => {
  const p = newPlayer();
  const base = p.stats.melee_dmg;
  arm(p, 'melee', 1);
  assert.equal(p.stats.melee_dmg, base);
  assert.equal(p.synergy.meleeRangeMult, 1);
});

test('продажа стволов снимает бонусы: mods чистится, а не копится', () => {
  const p = newPlayer();
  arm(p, 'melee', 6);
  assert.ok(p.synergy.mods.melee_dmg > 0);
  for (const s of p.slots) { s.id = null; s.cfg = null; }
  refreshStats(p, config);
  assert.equal(p.synergy.mods.melee_dmg, undefined);
  assert.equal(p.synergy.meleeRangeMult, 1);
  assert.equal(p.synergy.meleeArcMult, 1);
});

test('спец 6 melee: веер ударов из конфига, теги стакаются', () => {
  const p = newPlayer();
  arm(p, 'melee', 6);
  assert.equal(p.synergy.meleeRangeMult,
    specialField(BY_CLASS.melee, 6, 'range_mult', true));
  assert.equal(p.synergy.meleeArcMult,
    specialField(BY_CLASS.melee, 6, 'arc_mult', true));
  assert.ok(p.synergy.meleeRangeMult > syn.specials.melee_sweep.range_mult,
    'тег клинка не сложился с классом — стек не проверен');
});

test('спец 6 ranged: +снаряд и веер для него', () => {
  const p = newPlayer();
  arm(p, 'ranged', 6);
  assert.equal(p.synergy.extraShots, specialField(BY_CLASS.ranged, 6, 'shots', false));
  assert.ok(p.synergy.extraShots >= syn.specials.extra_shot.shots);
  assert.equal(p.synergy.extraShotSpread, syn.specials.extra_shot.spread || 0);
});

test('спец 6 elem: +пробитие', () => {
  const p = newPlayer();
  arm(p, 'elem', 6);
  assert.equal(p.synergy.extraPierce, specialField(BY_CLASS.elem, 6, 'pierce', false));
  assert.ok(p.synergy.extraPierce >= syn.specials.extra_pierce.pierce);
});

test('спец 6 engi: +установка', () => {
  const p = newPlayer();
  arm(p, 'engi', 6);
  assert.equal(p.synergy.extraTurrets,
    specialField(BY_CLASS.engi, 6, 'turrets', false));
});

test('спец 6 не срабатывает раньше шести стволов', () => {
  const p = newPlayer();
  arm(p, 'engi', 5);
  assert.equal(p.synergy.extraTurrets, 0);
  // а статовые бонусы 2 и 4 при этом уже действуют
  assert.ok(p.synergy.mods.engineering > 0);
});

test('выключатель enabled: false гасит механику целиком', () => {
  const off = JSON.parse(JSON.stringify(config));
  off.synergies.enabled = false;
  const p = createPlayer(off, 0, 'p', 'ch_pilgrim', 100, 100);
  for (const s of p.slots) { s.id = null; s.cfg = null; }
  refreshStats(p, off);
  const base = p.stats.melee_dmg;
  for (let i = 0; i < 6; i++) equip(p.slots[i], BY_CLASS.melee, off);
  refreshStats(p, off);
  assert.equal(p.stats.melee_dmg, base);
  assert.equal(p.synergy.meleeRangeMult, 1);
});

// --- теговые синергии: один ствол качает несколько сетов --------------------

// Оружие минимум с двумя тегами из настоящего конфига
const MULTI_TAG = Object.keys(config.weapons)
  .find((k) => (config.weapons[k].tags || []).length >= 2);

function armId(p, id, n) {
  for (let i = 0; i < n; i++) equip(p.slots[i], id, config);
  refreshStats(p, config);
}

test('теги заданы для всех существующих тегов оружия, иначе сет молчит', () => {
  const known = new Set(Object.keys(syn.tags));
  for (const id in config.weapons) {
    for (const tag of config.weapons[id].tags || []) {
      assert.ok(known.has(tag), `тег ${tag} (${id}) не имеет синергии`);
    }
  }
});

test('один ствол участвует сразу во всех своих сетах: класс и каждый тег', () => {
  assert.ok(MULTI_TAG, 'в конфиге нет оружия с двумя тегами — тест пуст');
  const p = newPlayer();
  armId(p, MULTI_TAG, 2);
  const cfg = config.weapons[MULTI_TAG];
  assert.equal(p.synergy.counts[cfg.class], 2);
  for (const tag of cfg.tags) assert.equal(p.synergy.counts[tag], 2, tag);
});

test('теговый порог 2: бонусы всех сетов ствола действуют одновременно', () => {
  const p = newPlayer();
  armId(p, MULTI_TAG, 2);
  const cfg = config.weapons[MULTI_TAG];
  const want = Object.assign({}, syn.classes[cfg.class]['2']);
  for (const tag of cfg.tags) {
    const bonus = syn.tags[tag]['2'];
    if (bonus.special) continue;
    for (const k in bonus) want[k] = (want[k] || 0) + bonus[k];
  }
  for (const k in want) {
    assert.equal(p.synergy.mods[k] || 0, want[k], k);
  }
});

test('спец 6 precise: криты усилены множителем из конфига', () => {
  const id = Object.keys(config.weapons)
    .find((k) => (config.weapons[k].tags || []).includes('precise'));
  const p = newPlayer();
  armId(p, id, 6);
  assert.equal(p.synergy.critDmgMult, syn.specials.crit_boost.mult);
});

test('спецы тега и класса стакаются: 6 construct дают +2 установки', () => {
  const id = Object.keys(config.weapons)
    .find((k) => (config.weapons[k].tags || []).includes('construct'));
  const p = newPlayer();
  armId(p, id, 6);
  // construct ⊂ engi: класс engi даёт свою +1, тег construct — свою
  assert.equal(p.synergy.extraTurrets, 2 * syn.specials.extra_turret.turrets);
});

test('процентный бонус тега (heavy 6) умножает стат после плоских', () => {
  const id = Object.keys(config.weapons)
    .find((k) => (config.weapons[k].tags || []).includes('heavy'));
  const p = newPlayer();
  const base = p.stats.knockback;
  armId(p, id, 6);
  const flat = base + syn.tags.heavy['2'].knockback;
  const want = flat * (1 + syn.tags.heavy['6'].knockback_pct / 100);
  assert.ok(Math.abs(p.stats.knockback - want) < 1e-9,
    `${p.stats.knockback} != ${want}`);
});
