import test from 'node:test';
import assert from 'node:assert';
import { loadConfig, stubTransport, makePlayers } from './fixture.js';
import { createRun } from '../../static/js/sim/run.js';
import {
  createInputCodec, createSnapshotCodec, createSpawnCodec, createSwingCodec,
  createPickupCodec, createTurretCodec,
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
  assert.ok(toId.length <= 63,
    'два старших бита байта типа отданы под moving и telegraph: индексу осталось 0..63');
});

// --- пульс удара, прах, турели и события спавна -----------------------------
//
// Замах уехал из снапшота в отдельный канал MSG_SWING. Прежняя схема держала в
// записи КАЖДОГО игрока байт оружия и байт угла, и этого хватало ровно на один
// удар за такт: шесть слотов делили один байт по кругу. Хуже того, клиент считал
// удар новым только при СМЕНЕ оружия — повторный замах тем же мечом он не
// проигрывал вовсе, и сосед с одним стволом анимировался один раз за забег.
// Тесты ниже стерегут обе беды: в эфир попадают все удары, и каждый — отдельно.

test('все замахи такта уезжают в эфир, а не один на игрока', () => {
  const codec = createSwingCodec(config);
  const weapons = buildWeaponIndex(config);
  const ids = Object.keys(config.weapons).filter((k) => config.weapons[k].shape.type === 'arc');
  const list = [
    { kind: 0, idx: 0, weapon: ids[0], angle: 0 },
    { kind: 0, idx: 0, weapon: ids[1], angle: Math.PI / 2 },
    { kind: 0, idx: 3, weapon: ids[0], angle: Math.PI },
  ];
  const dec = codec.decode(codec.encode(list, list.length, weapons));
  assert.equal(dec.count, 3, 'часть замахов потерялась');
  assert.equal(weapons.toId[dec.items[0].weapon], ids[0]);
  assert.equal(weapons.toId[dec.items[1].weapon], ids[1]);
  assert.equal(dec.items[2].idx, 3, 'адрес игрока не доехал');
  assert.ok(Math.abs(dec.items[1].angle - Math.PI / 2) < 0.05,
    `угол ${dec.items[1].angle}`);
});

test('повторный замах тем же оружием — отдельное событие', () => {
  const codec = createSwingCodec(config);
  const weapons = buildWeaponIndex(config);
  const wid = Object.keys(config.weapons).find((k) => config.weapons[k].shape.type === 'arc');
  const list = [
    { kind: 0, idx: 1, weapon: wid, angle: 0 },
    { kind: 0, idx: 1, weapon: wid, angle: 0 },
  ];
  const dec = codec.decode(codec.encode(list, list.length, weapons));
  assert.equal(dec.count, 2, 'второй удар тем же оружием пропал — это и был баг');
});

test('замах турели отличается от замаха игрока по флагу источника', () => {
  const codec = createSwingCodec(config);
  const weapons = buildWeaponIndex(config);
  const wid = Object.keys(config.weapons)[0];
  // Индекс турели заведомо больше 127: он не должен налезть на флаг источника
  const list = [
    { kind: 1, idx: 199, weapon: wid, angle: 1 },
    { kind: 0, idx: 199, weapon: wid, angle: 1 },
  ];
  const dec = codec.decode(codec.encode(list, list.length, weapons));
  assert.equal(dec.items[0].kind, 1);
  assert.equal(dec.items[0].idx, 199);
  assert.equal(dec.items[1].kind, 0);
  assert.equal(dec.items[1].idx, 199);
});

test('прах едет по сети и отсекается по радиусу видимости', () => {
  const codec = createPickupCodec(config);
  const r = config.net.view_radius;
  const pool = {
    count: 3,
    items: [
      { uid: 7, x: 100, y: 50, amount: 1 },
      { uid: 8, x: 100 + r * 2, y: 50, amount: 1 },   // за горизонтом — не поедет
      { uid: 9, x: 120, y: 60, amount: config.render.ash_big_amount * 2 },
    ],
  };
  const tierOf = (p) => (p.amount >= config.render.ash_big_amount ? 1 : 0);
  const dec = codec.decode(codec.encode(pool, 100, 50, tierOf));
  assert.equal(dec.count, 2, 'дальняя кучка не должна ехать');
  assert.equal(dec.items[0].x, 100);
  assert.equal(dec.items[0].tier, 0);
  assert.equal(dec.items[1].tier, 1, 'крупная кучка потеряла размерный класс');
  // uid — то, чем клиент отличает кучку от соседней. Без него он сопоставлял их
  // по номеру записи, а порядок в пакете меняется при каждом подборе.
  assert.equal(dec.items[0].uid, 7);
  assert.equal(dec.items[1].uid, 9, 'опознаватель кучки не доехал');
});

test('канал праха укладывается в бюджет трафика', () => {
  const codec = createPickupCodec(config);
  const perSec = codec.maxBytes * config.net.pickup_hz;
  const budget = config.net.traffic_budget_kbs * 1024;
  assert.ok(perSec < budget * 0.2,
    `${(perSec / 1024).toFixed(1)} КБ/с на один прах — это больше пятой части бюджета`);
});

test('расстановка турелей переживает round-trip', () => {
  const codec = createTurretCodec(config);
  const weapons = buildWeaponIndex(config);
  const wid = Object.keys(config.weapons)[0];
  const pool = {
    count: 2,
    items: [
      { x: 640, y: 480, weaponId: wid, ownerIdx: 0 },
      { x: -12, y: 1300, weaponId: wid, ownerIdx: 7 },
    ],
  };
  const dec = codec.decode(codec.encode(pool, weapons));
  assert.equal(dec.count, 2);
  assert.equal(dec.items[0].x, 640);
  assert.equal(dec.items[1].y, 1300);
  assert.equal(dec.items[1].owner, 7, 'хозяин установки потерялся');
  assert.equal(weapons.toId[dec.items[0].weapon], wid);
});

test('пул турелей влезает в адрес замаха', () => {
  assert.ok(config.engineering.max_turrets <= 0x7fff,
    'старший бит адреса источника занят флагом «это турель»');
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
  const a = snap.encode(run, 0, 0, 1, types.toIdx);
  const b = spawn.encode([{ x: 0, y: 0, vx: 1, vy: 0, ttl: 1, size: 4, texture: tex.toId[0], hostile: false }], 1, tex.toIdx);
  assert.notEqual(a[0], b[0]);
  // Декодер чужого типа обязан вернуть null, а не мусор
  assert.equal(spawn.decode(a.slice()), null);
  assert.equal(snap.decode(b.slice()), null);
});

test('раскладка снапшота: 14 байт заголовка и 14 на игрока', () => {
  const codec = createSnapshotCodec(config);
  const types = buildTypeIndex(config);
  const weapons = buildWeaponIndex(config);
  const run = runWith(2);
  for (const p of run.state.players) p.slots = [];
  // Мир должен быть пуст: тест меряет чистую раскладку заголовка и игроков.
  // На первой волне в пуле уже стоят ломаемые объекты арены — они попадают в
  // радиус видимости и дают лишние байты сущностей.
  run.enemyPool.clear();
  const bytes = codec.encode(run, 0, 0, 1, types.toIdx).byteLength;
  // Заголовок 14 = 10 прежних + 4 на общий котёл.
  // Игрок 14 = 9 базовых + 2 прах + 1 доля опыта + 2 ack последнего ввода.
  // Два байта пульса замаха отсюда УШЛИ: он уехал в отдельный канал MSG_SWING,
  // потому что одного байта на шесть слотов не хватало ни при каком раскладе.
  assert.equal(bytes, 14 + 2 * 14);
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
  const dec = codec.decode(codec.encode(run, me.x, me.y, 1, types.toIdx).slice());
  assert.equal(dec.players[0].ash, 1234);
  assert.ok(Math.abs(dec.players[0].xpPct - 0.75) < 0.01, 'доля опыта');
  assert.equal(dec.players[0].ackSeq, 4242);
  assert.equal(dec.pot, 99999);
});

test('флаги moving/telegraph переживают round-trip и не ломают dir, alive и тип', () => {
  const codec = createSnapshotCodec(config);
  const types = buildTypeIndex(config);
  const run = runWith(2);

  // Игрок: dir = 3, alive и moving сидят на соседних битах одного байта
  run.state.players[0].moving = true;
  run.state.players[0].dir = 3;
  run.state.players[0].alive = true;
  run.state.players[1].moving = false;
  run.state.players[1].dir = 3;
  run.state.players[1].alive = false;

  const dec = codec.decode(codec.encode(run, 0, 0, 1, types.toIdx));
  assert.equal(dec.players[0].moving, true);
  assert.equal(dec.players[0].dir, 3, 'moving не должен затирать dir');
  assert.equal(dec.players[0].alive, true, 'moving не должен затирать alive');
  assert.equal(dec.players[1].moving, false);
  assert.equal(dec.players[1].dir, 3);
  assert.equal(dec.players[1].alive, false);

  // Враги: все четыре сочетания moving/telegraph. Ломаемые объекты первой
  // волны уже стоят в пуле. Вид отцентрован на самом враге — он гарантированно
  // попадает в снапшот.
  const pool = run.enemyPool;
  assert.ok(pool.count >= 4, 'на первой волне должно хватить записей в пуле врагов');
  for (let i = 0; i < 4; i++) {
    const src = pool.items[i];
    src.moving = (i & 1) !== 0;
    src.telegraph = (i & 2) !== 0;
    const d2 = codec.decode(codec.encode(run, src.x, src.y, i + 1, types.toIdx));
    let got = null;
    for (let k = 0; k < d2.enemyCount; k++) {
      if (d2.enemies[k].uid === src.uid) { got = d2.enemies[k]; break; }
    }
    assert.ok(got, `враг uid=${src.uid} потерялся в снапшоте`);
    assert.equal(got.moving, src.moving, `moving uid=${src.uid}`);
    assert.equal(got.telegraph, src.telegraph, `telegraph uid=${src.uid}`);
    assert.equal(got.type, types.toIdx[src.type], `тип uid=${src.uid} искажён старшими битами`);
  }
});
