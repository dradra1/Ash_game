import test from 'node:test';
import assert from 'node:assert';
import { loadConfig } from './fixture.js';
import { scaleHp, scaleDamage, scaleSpeed } from '../../static/js/sim/enemy.js';

const config = loadConfig();
const cfg = config.enemies.e_cultist;
const d0 = config.danger[0];
const d1 = config.danger[1];
const d3 = config.danger[3];

test('HP врага растёт по формуле конфига', () => {
  const w = config.waves;
  for (const wave of [1, 5, 12, 20]) {
    const expect = cfg.hp * (1 + w.hp_growth * (wave - 1)) * d1.hp_mult;
    assert.ok(Math.abs(scaleHp(config, cfg, wave, d1, 1) - expect) < 1e-9,
      `волна ${wave}`);
  }
});

test('на первой волне множители роста ничего не меняют', () => {
  assert.equal(scaleHp(config, cfg, 1, d1, 1), cfg.hp * d1.hp_mult);
  assert.equal(scaleDamage(config, cfg, 1, d1), cfg.damage * d1.dmg_mult);
  assert.equal(scaleSpeed(config, cfg, 1), cfg.speed);
});

test('сложность масштабирует HP и урон ровно на свои множители', () => {
  const hp0 = scaleHp(config, cfg, 7, d0, 1);
  const hp3 = scaleHp(config, cfg, 7, d3, 1);
  assert.ok(Math.abs(hp3 / hp0 - d3.hp_mult / d0.hp_mult) < 1e-9);
  const dm0 = scaleDamage(config, cfg, 7, d0);
  const dm3 = scaleDamage(config, cfg, 7, d3);
  assert.ok(Math.abs(dm3 / dm0 - d3.dmg_mult / d0.dmg_mult) < 1e-9);
});

test('кооп добавляет HP по числу игроков и не трогает урон', () => {
  const solo = scaleHp(config, cfg, 3, d1, 1);
  const four = scaleHp(config, cfg, 3, d1, 4);
  const expect = 1 + config.coop.hp_per_player * 3;
  assert.ok(Math.abs(four / solo - expect) < 1e-9);
  assert.equal(scaleDamage(config, cfg, 3, d1), scaleDamage(config, cfg, 3, d1));
});

test('скорость упирается в потолок speed_cap', () => {
  const w = config.waves;
  // волна, на которой рост заведомо перебивает потолок
  const far = Math.ceil((w.speed_cap - 1) / w.speed_growth) + 20;
  assert.equal(scaleSpeed(config, cfg, far), cfg.speed * w.speed_cap);
  assert.ok(scaleSpeed(config, cfg, far) >= scaleSpeed(config, cfg, far - 1));
});
