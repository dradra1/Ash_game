import test from 'node:test';
import assert from 'node:assert';
import { loadConfig } from './fixture.js';
import {
  createStats, resolveStats, armorFactor, dodgeChance,
  weaponDamage, weaponCooldown, weaponRange, critChance,
} from '../../static/js/sim/stats.js';

const config = loadConfig();

function stats(mods) {
  const s = createStats(config);
  return resolveStats(s, config, [mods || null]);
}

test('база берётся из конфига, все 17 статов присутствуют', () => {
  const s = stats(null);
  for (const key of config.stats.order) {
    assert.ok(s[key] !== undefined, 'нет стата ' + key);
    assert.equal(s[key], config.player.base[key]);
  }
});

test('плоские модификаторы складываются, процентные применяются после них', () => {
  const base = config.player.base.max_hp;
  const s = stats({ max_hp: 10, max_hp_pct: -50 });
  assert.equal(s.max_hp, Math.round((base + 10) * 0.5));
});

test('порядок источников не влияет на результат', () => {
  const a = createStats(config);
  resolveStats(a, config, [{ max_hp: 6 }, { max_hp_pct: 20 }]);
  const b = createStats(config);
  resolveStats(b, config, [{ max_hp_pct: 20 }, { max_hp: 6 }]);
  assert.equal(a.max_hp, b.max_hp);
});

test('max_hp не опускается ниже min_max_hp', () => {
  const s = stats({ max_hp_pct: -100000 });
  assert.equal(s.max_hp, config.stats.min_max_hp);
});

test('отрицательные статы кроме max_hp не клампятся к нулю', () => {
  const s = stats({ armor: -5, move_speed_pct: -30 });
  assert.equal(s.armor, config.player.base.armor - 5);
  assert.equal(s.move_speed_pct, config.player.base.move_speed_pct - 30);
});

test('броня режет урон по формуле и упирается в потолок', () => {
  const k = config.stats.armor_k;
  assert.equal(armorFactor(config, 0), 1);
  const a = 10;
  assert.ok(Math.abs(armorFactor(config, a) - (1 - a / (a + k))) < 1e-9);
  assert.ok(armorFactor(config, 1e9) >= 1 - config.stats.armor_cap - 1e-9);
  assert.ok(armorFactor(config, 1e9) <= 1 - config.stats.armor_cap + 1e-9);
});

test('уклонение упирается в dodge_cap', () => {
  assert.ok(Math.abs(dodgeChance(config, { dodge_pct: 20 }) - 0.2) < 1e-9);
  assert.equal(dodgeChance(config, { dodge_pct: 500 }), config.stats.dodge_cap / 100);
});

test('урон оружия растёт от профильного стата и от damage_pct', () => {
  const w = config.weapons.w_cleaver_1;
  const plain = weaponDamage(w, stats(null));
  assert.ok(plain >= w.damage);
  const withMelee = weaponDamage(w, stats({ melee_dmg: 10 }));
  assert.ok(withMelee > plain, 'ближний стат должен усиливать ближнее оружие');
  const withPct = weaponDamage(w, stats({ damage_pct: 100 }));
  assert.ok(Math.abs(withPct - plain * 2) < 1e-6);
});

test('дальний стат не усиливает ближнее оружие', () => {
  const w = config.weapons.w_cleaver_1;
  assert.equal(weaponDamage(w, stats({ ranged_dmg: 50 })), weaponDamage(w, stats(null)));
});

test('скорость атаки уменьшает кулдаун', () => {
  const w = config.weapons.w_nailer_1;
  const base = weaponCooldown(config, w, stats(null));
  const fast = weaponCooldown(config, w, stats({ attack_speed_pct: 100 }));
  assert.ok(Math.abs(fast - base / 2) < 1e-9);
});

test('дальность у ближнего оружия работает вполсилы и удорожает замах', () => {
  const melee = config.weapons.w_cleaver_1;
  const ranged = config.weapons.w_nailer_1;
  const s = stats({ range: 4 });
  const step = config.stats.range_step_px;
  assert.equal(weaponRange(config, ranged, s), ranged.range + 4 * step);
  assert.equal(weaponRange(config, melee, s),
    melee.range + 4 * step * config.stats.range_melee_factor);
  assert.ok(weaponCooldown(config, melee, s) > weaponCooldown(config, melee, stats(null)),
    'range должен удорожать кулдаун ближнего оружия');
});

test('шанс крита складывается из стата и оружия и не превышает 1', () => {
  const w = config.weapons.w_carbine_1;
  const s = stats(null);
  assert.ok(Math.abs(critChance(w, s) - (s.crit_pct + w.crit_pct) / 100) < 1e-9);
  assert.equal(critChance(w, { crit_pct: 500 }), 1);
});
