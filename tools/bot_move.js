// Кайт-бот: общая «голова» для автопрогонов (`playtest.js`, `coop_income.js`).
//
// Вынесено в отдельный модуль, потому что мерить кооп-экономику имеет смысл только
// тем же ботом, что и соло: разное поведение — разное число убийств, и сравнение
// дохода превращается в сравнение двух ботов.
//
// Бот намеренно простой и это НИЖНЯЯ граница мастерства: перебирает DIRS
// направлений, смотрит, где окажется через LOOKAHEAD секунд, и берёт то, где
// ближайший враг дальше всего, со штрафом за стену и премией за каждую цель в
// радиусе оружия. Чистое «убежать подальше» дало бы ноль убийств, ноль праха и ту
// же смерть, только позже.

import { isDeployable } from '../static/js/sim/weapon.js';

const WALL_R = 140;
const DIRS = 16;         // сколько направлений перебираем
const LOOKAHEAD = 0.5;   // на сколько секунд заглядываем вперёд
const WALL_PENALTY = 1.5;
const DANGER_W = 6;      // штраф за подпускание врага в контакт
const KILL_W = 7;        // премия за каждую цель в радиусе оружия
const COVER_W = 30;      // премия за каждую свою установку, простреливающую точку
const UNCOVERED_KILL = 0.15;   // чего стоит цель рядом, если по ней никто не бьёт

// Записывает выбранное направление прямо в p.input.
export function steer(p, run, config) {
  // Размеры берём у забега, а не из config.arena.size: в коопе арена больше
  // (coop.arena_per_player), и бот, считающий стены по соло-размеру, жался бы к
  // центру и упирался в границу, которой нет.
  const aw = run.arenaW;
  const ah = run.arenaH;
  const pad = config.arena.wall_padding;

  // Дальность самого длинного оружия — по ней и собираем цели. Заодно смотрим,
  // осталось ли хоть что-то стреляющее В РУКАХ: инженерное уехало на арену.
  let reach = 0;
  let handArmed = false;
  for (const s of p.slots) {
    if (!s.cfg) continue;
    if (s.cfg.range > reach) reach = s.cfg.range;
    if (!isDeployable(config, s.cfg)) handArmed = true;
  }
  if (reach === 0) reach = 120;
  const reach2 = reach * reach;
  const safeD = config.player.radius + 30;

  let bestScore = -Infinity;
  let bx = 0;
  let by = 0;
  for (let d = 0; d < DIRS; d++) {
    const a = (d / DIRS) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let nx = p.x + dx * p.speed * LOOKAHEAD;
    let ny = p.y + dy * p.speed * LOOKAHEAD;
    if (nx < pad) nx = pad; else if (nx > aw - pad) nx = aw - pad;
    if (ny < pad) ny = pad; else if (ny > ah - pad) ny = ah - pad;

    let minD2 = Infinity;
    let inRange = 0;
    for (let i = 0; i < run.enemyPool.count; i++) {
      const e = run.enemyPool.items[i];
      // враг тоже успеет подойти — учитываем его смещение к нам
      const ex = e.x + (p.x - e.x) * (e.speed * LOOKAHEAD) / (Math.hypot(p.x - e.x, p.y - e.y) || 1);
      const ey = e.y + (p.y - e.y) * (e.speed * LOOKAHEAD) / (Math.hypot(p.x - e.x, p.y - e.y) || 1);
      const ddx = nx - ex;
      const ddy = ny - ey;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < minD2) minD2 = d2;
      if (d2 <= reach2) inRange++;
    }
    const minD = Math.sqrt(minD2);
    let score = minD < safeD ? (minD - safeD) * DANGER_W : 0;
    // Инженерное оружие не бьёт из рук: за него работают установки на арене.
    // Премия за «цель в радиусе моего оружия» без поправки увела бы бота водить
    // толпу туда, где по ней никто не стреляет.
    //
    // Два слагаемых, а не одно. Прямое притяжение к своему полю огня — потому
    // что встать под свои стволы это самостоятельная цель; без него бот с одной
    // инженерией вырождался в беглеца, жался от толпы, упирался в стену и гиб на
    // первой волне, ни разу не подойдя к собственным турелям.
    //
    // Обесценивание целей вне покрытия — только для того, у кого В РУКАХ ПУСТО.
    // С тесаком в слоте цель рядом стоит полной премии независимо от установок:
    // иначе бот с обычным оружием разучился бы драться на ровном месте.
    const cover = coverAt(nx, ny, run);
    score += cover * COVER_W;
    score += inRange * KILL_W * (handArmed || cover > 0 ? 1 : UNCOVERED_KILL);
    const wall = Math.min(nx, ny, aw - nx, ah - ny);
    if (wall < WALL_R) score -= (WALL_R - wall) * WALL_PENALTY;
    if (score > bestScore) { bestScore = score; bx = dx; by = dy; }
  }
  p.input.x = bx;
  p.input.y = by;
}

// Сколько СВОИХ установок держит точку под огнём. Ноль, если их нет вовсе, —
// тогда оба слагаемых выше молчат и бот ведёт себя как до инженерии.
function coverAt(x, y, run) {
  const pool = run.turretPool;
  if (!pool || pool.count === 0) return 0;
  let n = 0;
  for (let i = 0; i < pool.count; i++) {
    const t = pool.items[i];
    if (!t.slot.cfg) continue;
    const r = t.slot.cfg.range;
    const dx = t.x - x;
    const dy = t.y - y;
    if (dx * dx + dy * dy <= r * r) n++;
  }
  return n;
}
