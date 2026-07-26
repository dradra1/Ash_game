import test from 'node:test';
import assert from 'node:assert';
import { loadConfig, stubTransport, makePlayers } from './fixture.js';
import { createRun } from '../../static/js/sim/run.js';
import {
  createInputCodec, createSnapshotCodec, buildTypeIndex, PHASE_CODE, PHASE_NAME,
} from '../../static/js/net/protocol.js';

const config = loadConfig();

test('ввод переживает упаковку и распаковку', () => {
  const c = createInputCodec();
  for (const [x, y] of [[0, 0], [1, 0], [-1, 1], [0.5, -0.25]]) {
    const dec = c.decode(new DataView(c.encode(3, 4242, x, y, 1)));
    assert.equal(dec.playerIdx, 3);
    assert.equal(dec.seq, 4242);
    assert.ok(Math.abs(dec.x - x) < 0.01, `x ${x} → ${dec.x}`);
    assert.ok(Math.abs(dec.y - y) < 0.01, `y ${y} → ${dec.y}`);
    assert.equal(dec.flags, 1);
  }
  assert.equal(c.bytes, 8, 'пакет ввода должен оставаться крошечным');
});

test('пакет ввода укладывается в бюджет 30 Гц', () => {
  const c = createInputCodec();
  const perSec = c.bytes * config.net.input_hz;
  assert.ok(perSec < 1000, `ввод ${perSec} Б/с — слишком много`);
});

function runWith(players) {
  return createRun({
    config, seed: 4242, transport: stubTransport(),
    players: makePlayers(players, 'ch_pilgrim'), arena: 'ar_hive', danger: 1,
  });
}

test('снапшот переживает упаковку: игроки, волна, фаза', () => {
  const run = runWith(4);
  const { toIdx } = buildTypeIndex(config);
  const codec = createSnapshotCodec(config);
  const me = run.state.players[0];
  const packed = codec.encode(run, me.x, me.y, 77, toIdx);
  const dec = codec.decode(new DataView(packed.buffer, packed.byteOffset, packed.byteLength));

  assert.equal(dec.seq, 77);
  assert.equal(dec.wave, run.state.wave);
  assert.equal(PHASE_NAME[dec.phase], run.state.phase);
  assert.equal(dec.playerCount, 4);
  for (let i = 0; i < 4; i++) {
    const src = run.state.players[i];
    assert.ok(Math.abs(dec.players[i].x - src.x) <= 1, 'позиция в пределах кванта');
    assert.ok(Math.abs(dec.players[i].y - src.y) <= 1);
    assert.equal(dec.players[i].alive, src.alive);
    assert.ok(Math.abs(dec.players[i].hpPct - src.hp / src.maxHp) < 0.01);
  }
});

test('в снапшот попадают только враги в радиусе видимости', () => {
  const run = runWith(1);
  const { toIdx } = buildTypeIndex(config);
  const codec = createSnapshotCodec(config);
  const me = run.state.players[0];
  // прогреваем до середины волны: после её конца врагов вычищают
  for (let i = 0; i < 900; i++) run.step(config.sim.dt);
  assert.ok(run.enemyPool.count > 0, 'должны быть враги');

  const packed = codec.encode(run, me.x, me.y, 1, toIdx);
  const dec = codec.decode(new DataView(packed.buffer, packed.byteOffset, packed.byteLength));
  const r = config.net.view_radius;
  for (let k = 0; k < dec.enemyCount; k++) {
    const e = dec.enemies[k];
    const d = Math.hypot(e.x - me.x, e.y - me.y);
    assert.ok(d <= r + 2, `враг на ${d.toFixed(0)} px вне радиуса ${r}`);
  }
  assert.ok(dec.enemyCount <= config.net.max_entities_per_snapshot);
});

test('снапшот укладывается в бюджет трафика из конфига', () => {
  const run = runWith(8);
  const { toIdx } = buildTypeIndex(config);
  const codec = createSnapshotCodec(config);
  // набиваем мир под завязку
  run.startWave(20);
  for (const p of run.state.players) { p.hp = 1e9; p.maxHp = 1e9; }
  for (let i = 0; i < 60 * 60; i++) {
    run.step(config.sim.dt);
    for (const p of run.state.players) p.hp = 1e9;
  }
  const me = run.state.players[0];
  const packed = codec.encode(run, me.x, me.y, 1, toIdx);
  const perSec = packed.byteLength * config.net.snapshot_hz;
  const budget = config.net.traffic_budget_kbs * 1024;
  assert.ok(perSec <= budget,
    `${(perSec / 1024).toFixed(1)} КБ/с при бюджете ${config.net.traffic_budget_kbs} КБ/с ` +
    `(снапшот ${packed.byteLength} Б, врагов ${run.enemyPool.count})`);
});

test('коды фаз и имена согласованы в обе стороны', () => {
  for (const name in PHASE_CODE) {
    assert.equal(PHASE_NAME[PHASE_CODE[name]], name);
  }
});

test('таблица типов покрывает и врагов, и боссов', () => {
  const { toIdx, toId } = buildTypeIndex(config);
  for (const id in config.enemies) assert.ok(toIdx[id] !== undefined, id);
  for (const id in config.bosses) assert.ok(toIdx[id] !== undefined, id);
  for (const id in toIdx) assert.equal(toId[toIdx[id]], id);
  assert.ok(toId.length < 256, 'индекс типа занимает один байт');
});
