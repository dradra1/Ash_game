// Инженерия: оружие класса `engi` не бьёт в руках, вместо него на арене стоят
// его копии. Всё остальное оружие работает из рук, как работало.
//
// Главный регресс, ради которого половина этого файла и написана: гейт стоял на
// ЗАБЕГЕ, а не на слоте, и в установки уезжал каждый ствол — тесак, обрез,
// посох. Игрок оставался с пустыми руками, а весь его урон разъезжался по
// случайным точкам карты. Тесты ниже держат границу с обеих сторон: инженерное
// разворачивается, обычное — нет.
//
// Что ещё ломается молча:
//   — копий становится не три (перекрытие deploy_copies или сбой пересборки);
//   — установки перестают наследовать статы хозяина, и предметы с левелапами
//     перестают влиять на урон вообще;
//   — расстановка начинает зависеть от арены или расходиться между прогонами
//     одного сида, а сервер валидирует результат забега именно по сиду.

import test from 'node:test';
import assert from 'node:assert';
import { loadConfig, stubTransport, makePlayers } from './fixture.js';
import { createRun } from '../../static/js/sim/run.js';
import { equip, isDeployable } from '../../static/js/sim/weapon.js';
import { refreshStats } from '../../static/js/sim/player.js';

const config = loadConfig();
const DT = config.sim.dt;
const eng = config.engineering;

// Инженерный персонаж со стартовой автотурелью и обычный с тесаком
const ENGI_CHAR = 'ch_artificer';
const PLAIN_CHAR = 'ch_pilgrim';

const ENGI_WEAPON = Object.keys(config.weapons).find((k) => config.weapons[k].class === 'engi');
const PLAIN_RANGED = Object.keys(config.weapons)
  .find((k) => config.weapons[k].class === 'ranged' && config.weapons[k].shape.type === 'projectile');

function newRun(seed, players, character) {
  return createRun({
    config, seed: seed || 7, transport: stubTransport(),
    players: makePlayers(players || 1, character || ENGI_CHAR),
    arena: 'ar_hive', danger: 0, curses: [],
  });
}

function armedSlots(player) {
  let n = 0;
  for (const s of player.slots) if (s.cfg) n++;
  return n;
}

// Волна с врагами у обеих точек. Возвращает, сколько снарядов родилось у игрока
// и сколько — у любой из установок.
function fireSources(run, ticks) {
  const p = run.state.players[0];
  run.state.phase = 'wave';
  run.state.phaseTime = 9999;
  const NEAR = 24;                 // снаряд за тик отлетает ~7 px
  let fromPlayer = 0;
  let fromTurret = 0;
  for (let i = 0; i < ticks; i++) {
    const spots = [[p.x + 20, p.y]];
    for (let k = 0; k < run.turretPool.count; k++) {
      const t = run.turretPool.items[k];
      spots.push([t.x + 20, t.y]);
    }
    for (const [x, y] of spots) {
      const e = run.enemyPool.spawn();
      if (!e) continue;
      Object.assign(e, {
        alive: true, breakable: false, hp: 1e9, maxHp: 1e9, x, y, size: 8,
        uid: 900000 + run.enemyPool.count, ai: 0, cfg: config.enemies.e_cultist,
        speed: 0, dmg: 0, kbResist: 1,
      });
    }
    const before = run.projPool.count;
    run.state.phase = 'wave';
    run.state.phaseTime = 9999;
    run.step(DT);
    for (let k = before; k < run.projPool.count; k++) {
      const pr = run.projPool.items[k];
      if (Math.hypot(pr.x - p.x, pr.y - p.y) <= NEAR) { fromPlayer++; continue; }
      for (let j = 0; j < run.turretPool.count; j++) {
        const t = run.turretPool.items[j];
        if (Math.hypot(pr.x - t.x, pr.y - t.y) <= NEAR) { fromTurret++; break; }
      }
    }
  }
  return { fromPlayer, fromTurret };
}

test('механика включена и ограничена классом, иначе тест ничего не проверяет', () => {
  assert.equal(eng.enabled, true);
  assert.equal(eng.copies, 3);
  assert.deepEqual(eng.classes, ['engi']);
  assert.ok(ENGI_WEAPON, 'в конфиге нет ни одного инженерного оружия');
  assert.ok(PLAIN_RANGED, 'в конфиге нет обычного дальнобойного оружия');
});

test('предикат разворачивания смотрит на класс, а не на всё подряд', () => {
  for (const id in config.weapons) {
    const w = config.weapons[id];
    const want = w.deploy !== undefined ? !!w.deploy : w.class === 'engi';
    assert.equal(isDeployable(config, w), want, id);
  }
});

// --- регресс: обычное оружие осталось в руках -------------------------------

test('обычное оружие НЕ разворачивается в установки', () => {
  const run = newRun(11, 1, PLAIN_CHAR);
  const p = run.state.players[0];
  assert.ok(armedSlots(p) > 0, 'персонаж без стартового оружия — тест пуст');
  assert.equal(run.turretPool.count, 0,
    'тесак уехал на арену: гейт снова стоит на забеге, а не на классе оружия');
});

test('обычное оружие стреляет из рук игрока', () => {
  const run = newRun(3, 1, PLAIN_CHAR);
  const p = run.state.players[0];
  for (const s of p.slots) { s.id = null; s.cfg = null; }
  equip(p.slots[0], PLAIN_RANGED, config);
  run.startWave(2);
  const src = fireSources(run, 400);
  assert.ok(src.fromPlayer > 0, 'обычное оружие молчит — это и был баг');
  assert.equal(run.turretPool.count, 0);
});

test('смешанный лоадаут: инженерное на арене, обычное в руках, стреляют оба', () => {
  const run = newRun(5, 1, PLAIN_CHAR);
  const p = run.state.players[0];
  for (const s of p.slots) { s.id = null; s.cfg = null; }
  equip(p.slots[0], PLAIN_RANGED, config);
  equip(p.slots[1], ENGI_WEAPON, config);
  run.startWave(2);
  assert.equal(run.turretPool.count, eng.copies,
    'на арену должно уехать ровно инженерное оружие, и только оно');
  for (let i = 0; i < run.turretPool.count; i++) {
    assert.equal(run.turretPool.items[i].weaponId, ENGI_WEAPON);
  }
  const src = fireSources(run, 400);
  assert.ok(src.fromPlayer > 0, 'обычное оружие в руках перестало стрелять');
  assert.ok(src.fromTurret > 0, 'установки не выстрелили ни разу');
});

// --- инженерное оружие ------------------------------------------------------

test('на каждое инженерное оружие в слоте встаёт ровно copies установок', () => {
  const run = newRun(11);
  const p = run.state.players[0];
  let engiSlots = 0;
  for (const s of p.slots) if (s.cfg && isDeployable(config, s.cfg)) engiSlots++;
  assert.ok(engiSlots > 0, `${ENGI_CHAR} должен начинать с инженерным оружием`);
  assert.equal(run.turretPool.count, engiSlots * eng.copies);
  for (let i = 0; i < run.turretPool.count; i++) {
    const t = run.turretPool.items[i];
    assert.equal(t.ownerId, p.id);
    assert.ok(t.slot.cfg, 'установка без оружия');
    assert.equal(t.weaponId, p.slots[t.slotIdx].id, 'установка не того оружия');
  }
});

test('инженерное оружие в руках молчит: снаряды рождаются только у установок', () => {
  const run = newRun(3);
  run.startWave(2);
  const p = run.state.players[0];
  const NEAR = 24;
  for (let i = 0; i < run.turretPool.count; i++) {
    const t = run.turretPool.items[i];
    assert.ok(Math.hypot(t.x - p.x, t.y - p.y) > NEAR * 3,
      'установка выпала вплотную к игроку — источник снаряда не различить');
  }
  const src = fireSources(run, 600);
  assert.ok(src.fromTurret > 0, 'установки не выстрелили ни разу');
  assert.equal(src.fromPlayer, 0, 'инженерное оружие всё ещё стреляет с рук');
});

test('установки стоят внутри арены и не в стене', () => {
  for (let seed = 1; seed < 12; seed++) {
    const run = newRun(seed);
    for (let i = 0; i < run.turretPool.count; i++) {
      const t = run.turretPool.items[i];
      assert.ok(t.x >= eng.place_margin && t.x <= run.arenaW - eng.place_margin,
        `сид ${seed}: x=${t.x} вне арены`);
      assert.ok(t.y >= eng.place_margin && t.y <= run.arenaH - eng.place_margin,
        `сид ${seed}: y=${t.y} вне арены`);
    }
  }
});

test('расстановка детерминирована сидом', () => {
  const a = newRun(4242);
  const b = newRun(4242);
  assert.ok(a.turretPool.count > 0);
  assert.equal(a.turretPool.count, b.turretPool.count);
  for (let i = 0; i < a.turretPool.count; i++) {
    assert.equal(a.turretPool.items[i].x, b.turretPool.items[i].x);
    assert.equal(a.turretPool.items[i].y, b.turretPool.items[i].y);
  }
  const other = newRun(4243);
  let same = true;
  for (let i = 0; i < a.turretPool.count; i++) {
    if (other.turretPool.items[i].x !== a.turretPool.items[i].x) same = false;
  }
  assert.equal(same, false, 'разные сиды дали одну и ту же расстановку');
});

test('установки бьют статами хозяина, а не паспортными', () => {
  const run = newRun(5);
  const p = run.state.players[0];
  run.startWave(2);
  run.state.phase = 'wave';
  run.state.phaseTime = 9999;
  run.step(DT);

  const t = run.turretPool.items[0];
  const damageOf = () => {
    const e = run.enemyPool.spawn();
    Object.assign(e, {
      alive: true, breakable: false, hp: 1e9, maxHp: 1e9, x: t.x + 4, y: t.y, size: 8,
      uid: 5000 + run.enemyPool.count, ai: 0, cfg: config.enemies.e_cultist,
      speed: 0, dmg: 0, kbResist: 1,
    });
    const hp0 = e.hp;
    for (let i = 0; i < 240 && e.hp === hp0; i++) {
      run.state.phase = 'wave';
      run.state.phaseTime = 9999;
      run.step(DT);
    }
    const dealt = hp0 - e.hp;
    e.alive = false;
    return dealt;
  };

  const base = damageOf();
  assert.ok(base > 0, 'установка не нанесла урона вовсе');
  // Крит удваивает, поэтому сравниваем с запасом: важно, что стат владельца
  // ВООБЩЕ доезжает до установки.
  p.stats.engineering += 100;
  p.stats.damage_pct += 200;
  const boosted = damageOf();
  assert.ok(boosted > base, `урон не вырос со статом владельца: ${base} → ${boosted}`);
});

test('покупка инженерного оружия доставляет установки без перезапуска волны', () => {
  const run = newRun(9);
  const p = run.state.players[0];
  const before = run.turretPool.count;
  const free = p.slots.findIndex((s) => !s.cfg);
  assert.ok(free >= 0, 'нет свободного слота — тест не о чем');
  equip(p.slots[free], ENGI_WEAPON, config);
  run.step(DT);
  assert.equal(run.turretPool.count, before + eng.copies);
  assert.equal(run.turretsDirty, true, 'клиентам не сказали о новой расстановке');
});

test('покупка обычного оружия расстановку не трогает', () => {
  const run = newRun(9);
  const p = run.state.players[0];
  const before = [];
  for (let i = 0; i < run.turretPool.count; i++) {
    before.push(`${run.turretPool.items[i].x},${run.turretPool.items[i].y}`);
  }
  const free = p.slots.findIndex((s) => !s.cfg);
  equip(p.slots[free], PLAIN_RANGED, config);
  run.step(DT);
  assert.equal(run.turretPool.count, before.length, 'тесак добавил установок');
  for (let i = 0; i < run.turretPool.count; i++) {
    assert.equal(`${run.turretPool.items[i].x},${run.turretPool.items[i].y}`, before[i],
      'покупка обычного оружия переставила чужие установки');
  }
});

test('продажа инженерного оружия убирает его установки', () => {
  const run = newRun(9);
  const p = run.state.players[0];
  const taken = p.slots.findIndex((s) => s.cfg && isDeployable(config, s.cfg));
  const before = run.turretPool.count;
  p.slots[taken].id = null;
  p.slots[taken].cfg = null;
  run.step(DT);
  assert.equal(run.turretPool.count, before - eng.copies);
});

test('новая волна переставляет установки на новые точки', () => {
  const run = newRun(13);
  const was = run.turretPool.items.slice(0, run.turretPool.count)
    .map((t) => `${t.x},${t.y}`).join('|');
  run.startWave(2);
  const now = run.turretPool.items.slice(0, run.turretPool.count)
    .map((t) => `${t.x},${t.y}`).join('|');
  assert.notEqual(now, was, 'установки остались на прежних местах');
  assert.equal(run.turretPool.count, was.split('|').length);
});

test('в коопе у каждого свои установки и они помечены хозяином', () => {
  const run = newRun(21, 4);
  const owners = new Set();
  for (let i = 0; i < run.turretPool.count; i++) {
    const t = run.turretPool.items[i];
    owners.add(t.ownerId);
    assert.equal(run.state.players[t.ownerIdx].id, t.ownerId,
      'индекс хозяина не сходится с его id — адрес в снапшоте поедет');
  }
  assert.equal(owners.size, 4);
});

test('пул установок вмещает восьмерых с полным инженерным лоадаутом', () => {
  // Сколько лишних установок может насобирать один ствол: каждый сет
  // (класс или тег) со спецом extra_turret стакается. Сейчас это класс engi
  // и тег construct — и все engi-стволы конструктские, так что стек реален.
  let stack = 0;
  for (const group of [config.synergies.classes, config.synergies.tags]) {
    for (const set in group) {
      for (const th in group[set]) {
        if (group[set][th].special === 'extra_turret') {
          stack += config.synergies.specials.extra_turret.turrets;
        }
      }
    }
  }
  assert.ok(stack > 0, 'ни один сет не даёт лишних установок — тест пуст');
  const need = config.coop.max_players * config.run.weapon_slots * (eng.copies + stack);
  assert.ok(eng.max_turrets >= need,
    `${eng.max_turrets} < ${need}: у кого-то молча пропадут установки`);
});

// --- синергия engi + construct: лишние установки на каждый ствол ------------

test('шесть инженерных стволов ставят лишние установки каждый', () => {
  const run = newRun(17);
  const p = run.state.players[0];
  for (const s of p.slots) equip(s, ENGI_WEAPON, config);
  refreshStats(p, config);   // пересчёт синергий, как после покупки в лавке
  assert.ok(p.synergy.extraTurrets >= config.synergies.specials.extra_turret.turrets,
    'синергия не дала ни одной лишней установки');
  run.startWave(2);
  assert.equal(run.turretPool.count,
    p.slots.length * (eng.copies + p.synergy.extraTurrets),
    'бонус синергии не дошёл до двора установок');
});

test('потеря шестого ствола снимает лишнюю установку', () => {
  const run = newRun(19);
  const p = run.state.players[0];
  for (const s of p.slots) equip(s, ENGI_WEAPON, config);
  refreshStats(p, config);
  run.startWave(2);
  const full = run.turretPool.count;
  p.slots[5].id = null;
  p.slots[5].cfg = null;
  refreshStats(p, config);
  run.step(DT);   // yard.sync замечает новую подпись и переставляет двор
  assert.equal(run.turretPool.count, 5 * eng.copies,
    `было ${full}, ожидалось ${5 * eng.copies}: двор не перестроился`);
});
