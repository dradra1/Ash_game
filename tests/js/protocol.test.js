import test from 'node:test';
import assert from 'node:assert';
import { loadConfig, stubTransport, makePlayers } from './fixture.js';
import { createRun } from '../../static/js/sim/run.js';
import {
  createInputCodec, createSnapshotCodec, createSpawnCodec,
  buildTypeIndex, buildWeaponIndex, buildProjectileIndex,
  PHASE_CODE, PHASE_NAME,
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

// --- пульс удара и события спавна ------------------------------------------

test('пульс удара переживает round-trip и находит нужное оружие', () => {
  const codec = createSnapshotCodec(config);
  const types = buildTypeIndex(config);
  const weapons = buildWeaponIndex(config);
  const wid = Object.keys(config.weapons).find((k) => config.weapons[k].shape.type === 'arc');

  const run = runWith(1);
  run.state.players[0].slots = [{
    id: wid, cfg: config.weapons[wid], swingT: 0.1, lastAngle: Math.PI / 2,
  }];
  const dec = codec.decode(codec.encode(run, 0, 0, 1, types.toIdx, weapons));
  const p = dec.players[0];
  assert.equal(weapons.toId[p.swingWeapon], wid);
  assert.ok(Math.abs(p.swingAngle - Math.PI / 2) < 0.05, `угол ${p.swingAngle}`);
});

test('без замаха пульс пуст', () => {
  const codec = createSnapshotCodec(config);
  const types = buildTypeIndex(config);
  const weapons = buildWeaponIndex(config);
  const run = runWith(1);
  run.state.players[0].slots = [{ id: null, cfg: null, swingT: 0, lastAngle: 0 }];
  const dec = codec.decode(codec.encode(run, 0, 0, 1, types.toIdx, weapons));
  assert.equal(dec.players[0].swingWeapon, -1);
});

test('слоты обходятся по кругу: одно оружие не занимает эфир навсегда', () => {
  const codec = createSnapshotCodec(config);
  const types = buildTypeIndex(config);
  const weapons = buildWeaponIndex(config);
  const ids = Object.keys(config.weapons).filter((k) => config.weapons[k].shape.type === 'arc');
  const run = runWith(1);
  run.state.players[0].slots = [
    { id: ids[0], cfg: config.weapons[ids[0]], swingT: 0.1, lastAngle: 0 },
    { id: ids[1], cfg: config.weapons[ids[1]], swingT: 0.1, lastAngle: 0 },
  ];
  const seen = new Set();
  for (let i = 0; i < 4; i++) {
    const dec = codec.decode(codec.encode(run, 0, 0, i, types.toIdx, weapons));
    seen.add(weapons.toId[dec.players[0].swingWeapon]);
  }
  assert.equal(seen.size, 2, 'второй слот так и не получил эфир');
});

test('события спавна снарядов переживают round-trip', () => {
  const codec = createSpawnCodec(config);
  const tex = buildProjectileIndex(config);
  const texId = tex.toId[0];
  const list = [
    { x: 300, y: -120, vx: 400, vy: 0, ttl: 1.0, size: 6, texture: texId, hostile: false },
    { x: -50, y: 700, vx: 0, vy: -260, ttl: 0.5, size: 4, texture: texId, hostile: true },
  ];
  const dec = codec.decode(codec.encode(list, list.length, tex.toIdx));
  assert.equal(dec.count, 2);
  for (let i = 0; i < 2; i++) {
    const a = list[i];
    const b = dec.items[i];
    assert.equal(b.x, a.x);
    assert.equal(b.y, a.y);
    assert.ok(Math.abs(b.vx - a.vx) < 12, `vx ${b.vx} против ${a.vx}`);
    assert.ok(Math.abs(b.vy - a.vy) < 12, `vy ${b.vy} против ${a.vy}`);
    assert.ok(Math.abs(b.ttl - a.ttl) < 0.03, `ttl ${b.ttl}`);
    assert.equal(b.size, a.size);
    assert.equal(tex.toId[b.texture], a.texture);
    assert.equal(b.hostile, a.hostile);
  }
});

test('снапшот и событие спавна различимы по первому байту', () => {
  const snap = createSnapshotCodec(config);
  const spawn = createSpawnCodec(config);
  const types = buildTypeIndex(config);
  const tex = buildProjectileIndex(config);
  const run = runWith(1);
  const a = snap.encode(run, 0, 0, 1, types.toIdx, buildWeaponIndex(config));
  const b = spawn.encode([{ x: 0, y: 0, vx: 1, vy: 0, ttl: 1, size: 4, texture: tex.toId[0], hostile: false }], 1, tex.toIdx);
  assert.notEqual(a[0], b[0]);
  // Декодер чужого типа обязан вернуть null, а не мусор
  assert.equal(spawn.decode(a.slice()), null);
  assert.equal(snap.decode(b.slice()), null);
});

test('раскладка снапшота: 14 байт заголовка и 16 на игрока', () => {
  const codec = createSnapshotCodec(config);
  const types = buildTypeIndex(config);
  const weapons = buildWeaponIndex(config);
  const run = runWith(2);
  for (const p of run.state.players) p.slots = [];
  // Мир должен быть пуст: тест меряет чистую раскладку заголовка и игроков.
  // На первой волне в пуле уже стоят ломаемые объекты арены — они попадают в
  // радиус видимости и дают лишние байты сущностей.
  run.enemyPool.clear();
  const bytes = codec.encode(run, 0, 0, 1, types.toIdx, weapons).byteLength;
  // Заголовок 14 = 10 прежних + 4 на общий котёл.
  // Игрок 16 = 11 прежних + 2 прах + 1 доля опыта + 2 ack последнего ввода.
  assert.equal(bytes, 14 + 2 * 16);
});

test('прах, опыт и ack ввода переживают кодирование', () => {
  const codec = createSnapshotCodec(config);
  const types = buildTypeIndex(config);
  const weapons = buildWeaponIndex(config);
  const run = runWith(2);
  const me = run.state.players[0];
  me.ash = 1234;
  me.xp = 3;
  me.xpNext = 4;
  me.lastInputSeq = 4242;
  run.state.pot = 99999;
  const dec = codec.decode(codec.encode(run, me.x, me.y, 1, types.toIdx, weapons).slice());
  assert.equal(dec.players[0].ash, 1234);
  assert.ok(Math.abs(dec.players[0].xpPct - 0.75) < 0.01, 'доля опыта');
  assert.equal(dec.players[0].ackSeq, 4242);
  assert.equal(dec.pot, 99999);
});
