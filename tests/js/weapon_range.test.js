// Дальность оружия — граница ВСЕГО, что оно делает, а не только выбора цели.
//
// Баг, ради которого написан файл: цель бралась строго в радиусе, а временем
// жизни снаряда правил один shape.ttl из конфига. У половины стволов
// speed × ttl был вдвое больше паспортной дальности — копьё брало цель на 420,
// снаряд улетал на 840 и по дороге рвал врагов и ломаемые объекты далеко за
// пределами радиуса. Со стороны это выглядит ровно так: «оружие стреляет в то,
// что вне его дистанции атаки».
//
// Что ломается молча, если тесты убрать:
//   — новому стволу в конфиге поставили щедрый ttl, и он снова бьёт за радиус;
//   — запас хода посчитали от паспортной дальности, а не от эффективной, и стат
//     «дальность» перестал удлинять полёт (или удлинил его турелям вдвое);
//   — ограничение поставили присваиванием вместо min, и огнемёт, которому ttl
//     нарочно короче радиуса, начал плеваться на весь радиус.

import test from 'node:test';
import assert from 'node:assert';
import { loadConfig, stubTransport, makePlayers } from './fixture.js';
import { makeSlot, equip, stepSlot } from '../../static/js/sim/weapon.js';
import { createStats, resolveStats, weaponRange } from '../../static/js/sim/stats.js';
import { createRun } from '../../static/js/sim/run.js';

const config = loadConfig();
const DT = config.sim.dt;
const EPS = 1e-6;

const PROJECTILE_WEAPONS = Object.keys(config.weapons)
  .filter((id) => config.weapons[id].shape.type === 'projectile');

// Мир на одного врага: цель стоит в точке (tx, ty), сетка отдаёт её всегда.
// Настоящий пул и настоящая сетка тут не нужны — проверяется ровно то, с каким
// временем жизни рождается снаряд.
function stubDeps(target, extra) {
  const enemyPool = { count: 1, items: [target] };
  const projectiles = [];
  const deps = {
    config,
    rng: { float: () => 0.99, range: (a, b) => (a + b) / 2 },   // 0.99 — никаких критов
    enemyPool,
    enemyGrid: { query: (x, y, r, out) => { out[0] = 0; return 1; } },
    queryBuf: new Int32Array(8),
    projPool: {
      spawn() {
        const p = { hitIds: new Int32Array(8) };
        projectiles.push(p);
        return p;
      },
    },
    damageEnemy() {},
  };
  if (extra) Object.assign(deps, extra);
  return { deps, projectiles };
}

function makeTarget(x, y) {
  return { alive: true, breakable: false, uid: 1, x, y, size: 8 };
}

function baseStats() {
  return resolveStats(createStats(config), config, []);
}

// Стреляет один раз и возвращает снаряды выстрела.
function fireOnce(weaponId, stats, targetDist, extraDeps) {
  const slot = equip(makeSlot(), weaponId, config);
  const { deps, projectiles } = stubDeps(makeTarget(targetDist, 0), extraDeps);
  const fired = stepSlot(slot, 0, 0, stats, 0, DT, deps, 0, 0);
  assert.ok(fired, `${weaponId} не выстрелил`);
  assert.ok(projectiles.length > 0, `${weaponId} не родил снарядов`);
  return projectiles;
}

test('в конфиге есть стволы, чей ttl сам по себе перелетает дальность', () => {
  // Если однажды весь конфиг выровняют руками, тест ниже станет пустым — пусть
  // об этом скажут здесь, а не молчаливым зелёным прогоном.
  const over = PROJECTILE_WEAPONS.filter((id) => {
    const w = config.weapons[id];
    return w.shape.speed * w.shape.ttl > w.range + EPS;
  });
  assert.ok(over.length > 0,
    'ни один ствол не перелетает свою дальность даже без ограничения — тест пуст');
});

test('снаряд гаснет не дальше дальности оружия — все стволы, база', () => {
  const stats = baseStats();
  for (const id of PROJECTILE_WEAPONS) {
    const w = config.weapons[id];
    const range = weaponRange(config, w, stats);
    const reach = fireOnce(id, stats, range * 0.5)[0].ttl * w.shape.speed;
    assert.ok(reach <= range + EPS,
      `${id}: долёт ${reach.toFixed(0)} при дальности ${range.toFixed(0)}`);
  }
});

test('короткий ttl не растягивается до радиуса', () => {
  const stats = baseStats();
  for (const id of PROJECTILE_WEAPONS) {
    const w = config.weapons[id];
    const range = weaponRange(config, w, stats);
    const ttl = fireOnce(id, stats, range * 0.5)[0].ttl;
    assert.ok(ttl <= w.shape.ttl + EPS,
      `${id}: время жизни выросло с ${w.shape.ttl} до ${ttl}`);
  }
});

test('стат «дальность» удлиняет и полёт снаряда', () => {
  const id = PROJECTILE_WEAPONS.find((k) => {
    const w = config.weapons[k];
    return w.shape.speed * w.shape.ttl > w.range;   // ствол, который упирается в радиус
  });
  const stats = baseStats();
  const short = fireOnce(id, stats, 10)[0].ttl;
  stats.range += 10;
  const long = fireOnce(id, stats, 10)[0].ttl;
  assert.ok(long > short, `${id}: +10 к дальности не удлинили полёт (${short} → ${long})`);
  assert.ok(long * config.weapons[id].shape.speed
    <= weaponRange(config, config.weapons[id], stats) + EPS, 'перелёт с прокачанным статом');
});

// range_mult установок сейчас равен 1, поэтому сравнивать «с множителем» и «без»
// бессмысленно — проверяем, что запас хода считается ИМЕННО от эффективной
// дальности источника. Тогда правка множителя в конфиге доедет до снаряда сама,
// в обе стороны.
test('установка стреляет на свою дальность, а не на паспортную', () => {
  const eng = config.engineering;
  const id = PROJECTILE_WEAPONS.find((k) => config.weapons[k].class === 'engi');
  const w = config.weapons[id];
  const stats = baseStats();
  for (const mult of [eng.range_mult, 0.5, 2]) {
    const range = weaponRange(config, w, stats) * mult;
    const ttl = fireOnce(id, stats, Math.min(range, 40), { rangeMult: mult })[0].ttl;
    assert.ok(ttl * w.shape.speed <= range + EPS,
      `×${mult}: долёт ${(ttl * w.shape.speed).toFixed(0)} > дальности установки ${range.toFixed(0)}`);
    assert.ok(Math.abs(ttl - Math.min(w.shape.ttl, range / w.shape.speed)) < EPS,
      `×${mult}: множитель дальности установки не дошёл до снаряда`);
  }
});

// --- на живом забеге ---------------------------------------------------------

test('враг за радиусом на линии огня не получает урона', () => {
  const id = PROJECTILE_WEAPONS
    .find((k) => config.weapons[k].shape.speed * config.weapons[k].shape.ttl
      > config.weapons[k].range * 1.3);
  const w = config.weapons[id];
  const run = createRun({
    config, seed: 5, transport: stubTransport(),
    players: makePlayers(1, 'ch_pilgrim'), arena: 'ar_hive', danger: 0, curses: [],
  });
  const p = run.state.players[0];
  for (const s of p.slots) { s.id = null; s.cfg = null; }
  equip(p.slots[0], id, config);
  run.startWave(2);

  const range = weaponRange(config, w, p.stats);
  const near = range * 0.6;
  const far = range * 1.25;                       // вне радиуса, но в пределах старого долёта
  assert.ok(far < w.shape.speed * w.shape.ttl, 'дальняя цель и по старому не доставалась');

  function put(dist, uid) {
    const e = run.enemyPool.spawn();
    Object.assign(e, {
      alive: true, breakable: false, hp: 1e9, maxHp: 1e9, x: p.x + dist, y: p.y,
      size: 8, uid, ai: 0, cfg: config.enemies.e_cultist, speed: 0, dmg: 0, kbResist: 1,
    });
    return e;
  }
  const closeOne = put(near, 900001);
  const farOne = put(far, 900002);
  const farHp = farOne.hp;

  for (let i = 0; i < 600; i++) {
    run.state.phase = 'wave';
    run.state.phaseTime = 9999;
    closeOne.hp = 1e9;                            // ближняя цель бессмертна: ловим сквозной урон
    closeOne.x = p.x + near;
    closeOne.y = p.y;
    farOne.x = p.x + far;
    farOne.y = p.y;
    run.step(DT);
  }
  assert.equal(farOne.hp, farHp,
    `врагу на ${far.toFixed(0)} прилетело при дальности ${range.toFixed(0)}`);
});
