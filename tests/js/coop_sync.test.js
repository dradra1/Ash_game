// Что кооп-клиент видит в мире хоста: прах на полу, расстановку установок и
// удары. Хост и клиент гоняются в одном процессе через транспорт с задержкой.
//
// Три жалобы, ради которых тест написан, и все три были дырами в протоколе, а не
// в рендере:
//   1. прах не ездил по сети вовсе — у подключившегося пол был пуст, и деньги
//      «не выпадали»;
//   2. замах ехал одним байтом в записи игрока, поэтому за такт в эфир попадал
//      один удар из шести, а повторный удар тем же оружием клиент вообще не
//      отличал от предыдущего и не проигрывал;
//   3. турелей в протоколе не было — инженерия у соседа выглядела как пустая
//      арена, стреляющая сама по себе.

import test from 'node:test';
import assert from 'node:assert';
import { loadConfig } from './fixture.js';
import { CH } from '../../static/js/net/transport.js';
import { createRun } from '../../static/js/sim/run.js';
import { createHost } from '../../static/js/net/host.js';
import { createNetClient } from '../../static/js/net/client.js';
import { buildArenaLayout, createPropIndex } from '../../static/js/sim/arena.js';
import { dropAsh, resetPickup } from '../../static/js/sim/pickup.js';

const config = loadConfig();
const DT = config.sim.dt;
const SEED = 31337;
// Инженерный персонаж: установки есть только у оружия класса engi
const CHAR = 'ch_artificer';

// Транспорт-пара с фиксированной задержкой. Доставка по явному pump(): никаких
// таймеров, прогон детерминирован.
function makeLink(latencyFrames) {
  const hostSubs = {};
  const clientSubs = {};
  for (const k in CH) { hostSubs[CH[k]] = []; clientSubs[CH[k]] = []; }
  const queue = [];
  let now = 0;

  const push = (subs) => (ch, payload) => {
    queue.push({ at: now + latencyFrames, subs, ch, payload });
  };
  const mk = (subs, send) => ({
    role: 'host', id: 0, isHost: subs === clientSubs,
    send, on(ch, cb) { subs[ch].push(cb); },
    off(ch, cb) {
      const i = subs[ch].indexOf(cb);
      if (i >= 0) subs[ch].splice(i, 1);
    },
    close() {},
  });

  const hostTransport = mk(hostSubs, push(clientSubs));
  hostTransport.isHost = true;
  hostTransport.id = 0;
  const clientTransport = mk(clientSubs, push(hostSubs));
  clientTransport.isHost = false;
  clientTransport.id = 1;

  function pump() {
    now++;
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].at > now) continue;
      const m = queue.splice(i, 1)[0];
      i--;
      const list = m.subs[m.ch];
      for (let k = 0; k < list.length; k++) list[k](m.payload, 0);
    }
  }

  return { hostTransport, clientTransport, pump };
}

function makePair(impacts) {
  const link = makeLink(2);
  const run = createRun({
    config, seed: SEED, transport: link.hostTransport,
    players: [
      { id: 0, name: 'host', character: CHAR },
      { id: 1, name: 'guest', character: CHAR },
    ],
    arena: 'ar_hive', danger: 0, curses: [],
  });
  const hostNet = createHost(run, link.hostTransport, config);
  const layout = buildArenaLayout(config, 'ar_hive', SEED, run.arenaW, run.arenaH);
  const client = createNetClient(link.clientTransport, config, 1,
    createPropIndex(layout, config), run.arenaW, run.arenaH,
    impacts ? (x, y) => impacts.push({ x, y }) : null);

  const input = { x: 0, y: 0 };
  function tick(n) {
    for (let i = 0; i < (n || 1); i++) {
      client.step(DT, input, client.state.players[1] ? client.state.players[1].speed : 1);
      run.step(DT);
      hostNet.step(DT);
      link.pump();
    }
  }
  return { run, hostNet, client, tick };
}

test('прах с пола доезжает до клиента', () => {
  const { run, client, tick } = makePair();
  tick(20);
  assert.equal(client.pickups.count, 0, 'на пустом полу праха быть не должно');

  const me = run.state.players[1];
  // Роняем кучки рядом с клиентом, но не вплотную: иначе он их подберёт раньше,
  // чем уедет первый пакет.
  for (let i = 0; i < 5; i++) {
    dropAsh(run.pickupPool, me.x + 120 + i * 20, me.y + 120, 4, 0, config);
  }
  // Крупная кучка: у неё должен приехать другой размерный класс
  dropAsh(run.pickupPool, me.x + 140, me.y - 160,
    config.render.ash_big_amount * 3, 0, config);

  tick(30);
  assert.ok(client.pickups.count >= 6,
    `клиент видит ${client.pickups.count} кучек вместо шести`);
  let big = 0;
  for (let i = 0; i < client.pickups.count; i++) {
    if (client.pickups.items[i].tier === 1) big++;
  }
  assert.equal(big, 1, 'крупная кучка не отличается от мелких');
});

test('расстановка установок доезжает до клиента целиком', () => {
  const { run, client, tick } = makePair();
  tick(20);
  assert.equal(client.turrets.count, run.turretPool.count,
    'у клиента другое число установок');
  for (let i = 0; i < client.turrets.count; i++) {
    const src = run.turretPool.items[i];
    const dst = client.turrets.items[i];
    assert.ok(Math.abs(dst.x - src.x) <= 1, `установка ${i}: x ${dst.x} ≠ ${src.x}`);
    assert.ok(Math.abs(dst.y - src.y) <= 1);
    assert.equal(dst.id, src.weaponId, 'у установки другое оружие');
    assert.equal(dst.owner, src.ownerIdx);
  }
});

test('новая волна переставляет установки и у клиента тоже', () => {
  const { run, client, tick } = makePair();
  tick(20);
  const was = client.turrets.items[0].x;
  run.startWave(2);
  tick(20);
  assert.equal(client.turrets.count, run.turretPool.count);
  assert.notEqual(client.turrets.items[0].x, was,
    'у клиента установки остались на прежних местах');
  assert.ok(Math.abs(client.turrets.items[0].x - run.turretPool.items[0].x) <= 1);
});

test('удары установок видны клиенту, и каждый — отдельно', () => {
  const { run, client, tick } = makePair();
  tick(20);

  // Ставим ИНЖЕНЕРНОЕ ближнее оружие: дуговой удар не рождает снаряда, и до
  // канала замахов клиент такой бой видел немым. Обычный тесак сюда не годится —
  // он бьёт из рук и установок не даёт.
  const melee = Object.keys(config.weapons).find((k) => config.weapons[k].class === 'engi'
    && config.weapons[k].shape.type === 'arc');
  const p = run.state.players[0];
  for (const s of p.slots) { s.id = null; s.cfg = null; }
  p.slots[0].id = melee;
  p.slots[0].cfg = config.weapons[melee];
  run.startWave(2);
  run.state.phase = 'wave';
  run.state.phaseTime = 60;
  tick(10);

  const before = client.swingSeen;
  const t = run.turretPool.items[0];
  assert.ok(t, 'установок нет');
  for (let i = 0; i < 300; i++) {
    const e = run.enemyPool.spawn();
    if (e) {
      Object.assign(e, {
        alive: true, breakable: false, hp: 1e9, maxHp: 1e9,
        x: t.x + 6, y: t.y, size: 8, uid: 700000 + run.enemyPool.count,
        ai: 0, cfg: config.enemies.e_cultist, speed: 0, dmg: 0, kbResist: 1,
      });
    }
    run.state.phase = 'wave';
    run.state.phaseTime = 60;
    tick(1);
  }
  const seen = client.swingSeen - before;
  const cd = config.weapons[melee].cooldown;
  const expect = Math.floor((300 * DT) / cd) - 1;
  assert.ok(seen >= expect,
    `клиент увидел ${seen} ударов, а их было не меньше ${expect}: повторные удары теряются`);
  assert.ok(client.turrets.items[0].slots[0].id === melee,
    'у клиента установка не переоделась в новое оружие');
});

test('попадания рождают искры у клиента без единого лишнего байта', () => {
  const impacts = [];
  const { run, client, tick } = makePair(impacts);
  tick(20);

  run.state.phase = 'wave';
  run.state.phaseTime = 60;
  const me = run.state.players[1];
  const e = run.enemyPool.spawn();
  Object.assign(e, {
    alive: true, breakable: false, hp: 1e6, maxHp: 1e6,
    x: me.x + 40, y: me.y, size: 8, uid: 424242,
    ai: 0, cfg: config.enemies.e_cultist, speed: 0, dmg: 0, kbResist: 1,
  });
  tick(10);
  const before = impacts.length;
  // Урон наносит хост; клиент видит только упавшую долю HP — этого достаточно.
  e.hp -= e.maxHp * 0.25;
  tick(10);
  assert.ok(impacts.length > before, 'клиент не заметил попадания по врагу');
  assert.ok(Math.abs(impacts[impacts.length - 1].x - e.x) < 40,
    'искры вспыхнули не там, где враг');
});

test('снапшот подешевел: хосту свою копию не шлём', () => {
  const { run, hostNet, tick } = makePair();
  tick(60);
  // Игроков двое, снапшот адресный — значит на такт уходит ровно один пакет,
  // а не два. Считаем по счётчику отправленных снапшотов.
  assert.ok(hostNet.stats.sent > 0);
  const perTick = hostNet.stats.sent / Math.floor(60 * DT * config.net.snapshot_hz);
  assert.ok(perTick <= 1.2,
    `${perTick.toFixed(2)} снапшота на такт при одном клиенте — хост шлёт и себе`);
});

test('кучки праха не прыгают, когда пул на хосте перетасовался', () => {
  // Регресс, ради которого тест написан: прах ехал по сети без опознавателя, и
  // клиент сопоставлял кучки по номеру записи в пакете. Пул на хосте делает
  // swap-remove при каждом подборе, отбор идёт по радиусу видимости — порядок
  // меняется постоянно, и слот i от пакета к пакету означал РАЗНЫЕ кучки. Клиент
  // плавно вёл слот к «своей» цели, и лежащий на полу прах скакал по всей карте.
  //
  // Ловим именно скачок, а не конечное положение: после доезда картинка сходится
  // и с багом тоже — он весь в переходе. Поэтому меряем, насколько НЕПОДВИЖНАЯ
  // кучка смещается между соседними кадрами.
  const { run, client, tick } = makePair();
  tick(20);

  const me = run.state.players[1];
  const drop = (a, r) => dropAsh(run.pickupPool,
    me.x + Math.cos(a) * r, me.y + Math.sin(a) * r, 4, 0, config);
  for (let i = 0; i < 8; i++) drop((i / 8) * Math.PI * 2, 220);
  tick(40);
  assert.equal(client.pickups.count, 8, 'доехали не все кучки');

  // Позиции на клиенте по uid — снимок предыдущего кадра
  const prev = new Map();
  const snap = () => {
    const m = new Map();
    for (let i = 0; i < client.pickups.count; i++) {
      const p = client.pickups.items[i];
      m.set(p.uid, { x: p.x, y: p.y });
    }
    return m;
  };
  for (const [k, v] of snap()) prev.set(k, v);

  let worst = 0;
  let worstUid = 0;
  for (let step = 0; step < 240; step++) {
    // Каждые двадцать кадров тасуем пул: подбираем кучку из середины (swap-remove
    // перекладывает последнюю на её место) и роняем новую.
    if (step % 20 === 10 && run.pickupPool.count > 2) {
      const victim = 1 + (step % (run.pickupPool.count - 1));
      resetPickup(run.pickupPool.items[victim]);
      run.pickupPool.release(victim);
      drop((step / 7) % (Math.PI * 2), 260);
    }
    tick(1);
    const now = snap();
    for (const [uid, pos] of now) {
      const was = prev.get(uid);
      if (!was) continue;                 // новая кучка — ей двигаться позволено
      const d = Math.hypot(pos.x - was.x, pos.y - was.y);
      if (d > worst) { worst = d; worstUid = uid; }
    }
    prev.clear();
    for (const [k, v] of now) prev.set(k, v);
  }

  // Кучка на полу неподвижна: магнита рядом нет, игроки стоят. Любое смещение
  // больше кванта позиции (int16 — целый пиксель) означает подмену опознавателя.
  assert.ok(worst <= 1.5,
    `кучка ${worstUid} прыгнула на ${worst.toFixed(1)} px за кадр — прах телепортируется`);
});
