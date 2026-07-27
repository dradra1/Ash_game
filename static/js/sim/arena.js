// Раскладка арены: замощение пола вариациями тайлов и статические препятствия.
//
// Всё выводится из (seed, arenaId, размер арены). Хост и клиенты строят одинаковую
// арену независимо друг от друга, по сети не передаётся ни байта — кооп-клиент знает
// и сид (room:start), и арену (room.arena), и размер (пересчитывает по числу игроков).
//
// Генератор берёт ОТДЕЛЬНЫЙ экземпляр rng. Тянуть числа из rng забега нельзя: раскладка
// съела бы сотни значений и сдвинула всю последующую случайность — спавн, дроп, лавку.

import { createRng } from '../engine/rng.js';
import { createGrid } from '../engine/grid.js';

// FNV-1a: арена должна давать разную раскладку при одном сиде забега
export function hashId(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Взвешенный выбор индекса. weights может быть короче списка — недостающим вес 1.
function pickWeighted(rng, len, weights) {
  let total = 0;
  for (let i = 0; i < len; i++) total += weightAt(weights, i);
  let roll = rng.float() * total;
  for (let i = 0; i < len; i++) {
    roll -= weightAt(weights, i);
    if (roll <= 0) return i;
  }
  return len - 1;
}

function weightAt(weights, i) {
  if (!weights) return 1;
  const w = weights[i];
  return w === undefined || w <= 0 ? 1 : w;
}

// Пол: карта индексов вариаций. Арена делится на чанки, каждый берёт свой
// доминирующий тайл, а границы между чанками РАСТУШЁВЫВАЮТСЯ — чем ближе тайл к
// краю чанка, тем вероятнее, что он возьмёт вариацию соседа.
//
// Растушёвка здесь не украшение, а исправление: первая версия подмешивала случайную
// вариацию равномерно по всему чанку, и получалось конфетти из одиночных квадратов
// поверх видимой прямоугольной сетки чанков. Смешивать надо ИМЕННО с соседом и
// ИМЕННО у границы — тогда зоны сцепляются рваным швом и читаются как один пол.
function buildTiles(rng, arena, cfg, cols, rows) {
  const variants = arena.ground && arena.ground.length ? arena.ground.length : 1;
  const tiles = new Uint8Array(cols * rows);
  if (variants <= 1) return tiles;

  const chunk = Math.max(1, cfg.chunk_tiles | 0);
  const feather = cfg.tile_feather === undefined ? 0.5 : cfg.tile_feather;
  const scatter = cfg.tile_scatter || 0;
  const weights = arena.ground_weights;
  const chunkCols = Math.ceil(cols / chunk);
  const chunkRows = Math.ceil(rows / chunk);

  // Доминанты всех чанков считаются заранее: растушёвка смотрит на соседей
  const dom = new Uint8Array(chunkCols * chunkRows);
  for (let i = 0; i < dom.length; i++) dom[i] = pickWeighted(rng, variants, weights);

  const half = chunk / 2;
  for (let y = 0; y < rows; y++) {
    const cy = (y / chunk) | 0;
    const row = y * cols;
    for (let x = 0; x < cols; x++) {
      const cx = (x / chunk) | 0;
      let v = dom[cy * chunkCols + cx];

      // Насколько тайл близок к краю своего чанка: 0 — вплотную, 1 — в центре
      const ox = Math.abs(x - (cx * chunk + half) + 0.5) / half;
      const oy = Math.abs(y - (cy * chunk + half) + 0.5) / half;
      const edge = ox > oy ? ox : oy;
      if (feather > 0 && rng.float() < feather * edge * edge) {
        // Тянемся к соседу с той стороны, к которой ближе
        let nx = cx;
        let ny = cy;
        if (ox > oy) nx += x < cx * chunk + half ? -1 : 1;
        else ny += y < cy * chunk + half ? -1 : 1;
        if (nx >= 0 && nx < chunkCols && ny >= 0 && ny < chunkRows) {
          v = dom[ny * chunkCols + nx];
        }
      } else if (scatter > 0 && rng.float() < scatter) {
        v = pickWeighted(rng, variants, weights);
      }
      tiles[row + x] = v;
    }
  }
  return tiles;
}

// Препятствия: отбраковочная выборка. Держим чистый круг в центре (там стартуют
// игроки) и отступ от стен, чтобы кольцо спавна оставалось проходимым.
function buildProps(rng, arena, cfg, arenaW, arenaH) {
  const table = arena.props;
  const props = [];
  if (!table || !table.length) return props;

  const want = cfg.props_max | 0;
  if (want <= 0) return props;
  const minGap = cfg.props_min_gap || 0;
  const wallMargin = cfg.props_wall_margin || 0;
  const centerClear = cfg.props_center_clear || 0;
  const cx = arenaW / 2;
  const cy = arenaH / 2;
  const attempts = want * (cfg.props_attempts_per_prop || 12);

  for (let a = 0; a < attempts && props.length < want; a++) {
    const idx = pickWeighted(rng, table.length, null);
    const entry = table[idx];
    const r = entry.r || 16;
    const x = rng.range(wallMargin + r, arenaW - wallMargin - r);
    const y = rng.range(wallMargin + r, arenaH - wallMargin - r);

    const dcx = x - cx;
    const dcy = y - cy;
    const clear = centerClear + r;
    if (dcx * dcx + dcy * dcy < clear * clear) continue;

    let ok = true;
    for (let i = 0; i < props.length; i++) {
      const o = props[i];
      const dx = o.x - x;
      const dy = o.y - y;
      const need = o.r + r + minGap;
      if (dx * dx + dy * dy < need * need) { ok = false; break; }
    }
    if (!ok) continue;

    props.push({
      x, y, r,
      texture: entry.texture,
      size: entry.size || r * 2,
      flip: rng.float() < 0.5,
    });
  }
  return props;
}

// Ломаемые мини-ивенты: точки, где на каждой волне встаёт объект, который можно
// разбить ради награды. Раскладка детерминирована сидом, как и всё остальное,
// поэтому кооп-клиент знает те же точки и по сети они не передаются.
//
// Коллизий у них НЕТ намеренно. Стоило бы им перекрывать проход — разрушение
// меняло бы проходимость арены, и клиенту пришлось бы синхронно перестраивать
// индекс препятствий, иначе предсказание движения выдёргивало бы игрока в месте
// уже снесённой бочки.
function buildBreakables(rng, arena, cfg, arenaW, arenaH, props) {
  const table = arena.breakables;
  const out = [];
  if (!table || !table.length) return out;

  const want = cfg.breakables_max | 0;
  if (want <= 0) return out;
  // Два разных отступа. От завалов достаточно не перекрываться (иначе объект
  // недостижим для оружия), а вот друг от друга мини-ивенты держатся далеко,
  // чтобы не сбивались в кучу в одном углу. Один общий отступ здесь не работает:
  // при 26 завалах отступ «как между ивентами» перекрывает всю арену, и
  // отбраковочная выборка не находит вообще ни одной точки.
  const propGap = cfg.breakables_prop_gap || 0;
  const minGap = cfg.breakables_min_gap || 0;
  const wallMargin = cfg.breakables_wall_margin || 0;
  const centerClear = cfg.breakables_center_clear || 0;
  const cx = arenaW / 2;
  const cy = arenaH / 2;
  const attempts = want * (cfg.props_attempts_per_prop || 12);

  for (let a = 0; a < attempts && out.length < want; a++) {
    const entry = table[pickWeighted(rng, table.length, null)];
    const r = entry.r || 14;
    const x = rng.range(wallMargin + r, arenaW - wallMargin - r);
    const y = rng.range(wallMargin + r, arenaH - wallMargin - r);

    const dcx = x - cx;
    const dcy = y - cy;
    const clear = centerClear + r;
    if (dcx * dcx + dcy * dcy < clear * clear) continue;

    // Не ставим внутрь завала: объект оказался бы недостижим для оружия
    let ok = true;
    for (let i = 0; i < props.length; i++) {
      const o = props[i];
      const dx = o.x - x;
      const dy = o.y - y;
      const need = o.r + r + propGap;
      if (dx * dx + dy * dy < need * need) { ok = false; break; }
    }
    if (ok) {
      for (let i = 0; i < out.length; i++) {
        const o = out[i];
        const dx = o.x - x;
        const dy = o.y - y;
        const need = o.r + r + minGap;
        if (dx * dx + dy * dy < need * need) { ok = false; break; }
      }
    }
    if (!ok) continue;

    out.push({ x, y, r, type: entry.type });
  }
  return out;
}

// Декали — плоские пятна, запекаемые в пол. Коллизий не имеют, ограничений тоже:
// единственное, чего они стоят, — время запекания.
function buildDecals(rng, arena, cfg, arenaW, arenaH) {
  const table = arena.decals;
  const out = [];
  if (!table || !table.length) return out;
  const want = cfg.decals_max | 0;
  for (let i = 0; i < want; i++) {
    const entry = table[pickWeighted(rng, table.length, null)];
    const size = entry.size || 48;
    out.push({
      x: rng.range(size, arenaW - size),
      y: rng.range(size, arenaH - size),
      size,
      texture: entry.texture,
      alpha: entry.alpha === undefined ? 1 : entry.alpha,
      flip: rng.float() < 0.5,
    });
  }
  return out;
}

// Единственная точка входа. Одинаковый (arenaId, seed, размер) → побайтово
// одинаковый результат: на этом держится кооп.
export function buildArenaLayout(config, arenaId, seed, arenaW, arenaH) {
  const arena = config.arenas[arenaId];
  const cfg = config.arena;
  const tile = cfg.tile_size || DEFAULT_TILE;
  const w = arenaW || cfg.size[0];
  const h = arenaH || cfg.size[1];
  const cols = Math.ceil(w / tile);
  const rows = Math.ceil(h / tile);
  const rng = createRng((seed ^ hashId(arenaId)) >>> 0);

  // Порядок вызовов фиксирован: он определяет последовательность rng.
  // Ломаемые объекты добавлены ПОСЛЕДНИМИ специально: так пол, декали и завалы
  // остаются побайтово теми же, что до их появления, и старые сиды не «переезжают».
  const tiles = buildTiles(rng, arena, cfg, cols, rows);
  const decals = buildDecals(rng, arena, cfg, w, h);
  const props = buildProps(rng, arena, cfg, w, h);
  const breakables = buildBreakables(rng, arena, cfg, w, h, props);

  return {
    arena: arenaId,
    width: w,
    height: h,
    tile,
    cols,
    rows,
    tiles,
    ground: (arena.ground || []).slice(),
    groundColor: arena.ground_color,
    decals,
    props,
    breakables,
  };
}

// --- Статический индекс и разрешение коллизий -------------------------------

// Препятствия не двигаются: сетка строится один раз и никогда не чистится.
// Отдельная от сетки врагов — insert пишет id как индекс пула, и общая сетка
// смешала бы индексы препятствий с индексами врагов.
export function createPropIndex(layout, config) {
  const props = layout.props;
  let maxR = 0;
  for (let i = 0; i < props.length; i++) {
    if (props[i].r > maxR) maxR = props[i].r;
  }
  const cell = Math.max(config.sim.grid_cell, maxR * 2 || config.sim.grid_cell);
  const grid = createGrid(cell, layout.width, layout.height);
  for (let i = 0; i < props.length; i++) {
    grid.insert(i, props[i].x, props[i].y);
  }
  return { grid, props, maxR, buf: new Int32Array(MAX_NEARBY) };
}

// Выталкивание точки радиуса r из препятствий. Мутирует ent.x/ent.y.
// Возвращает число задевших препятствий; нормаль последнего пишет в out.
export function separateFromProps(ent, radius, index, out) {
  const props = index.props;
  if (props.length === 0) return 0;
  const grid = index.grid;
  const buf = index.buf;
  const n = grid.query(ent.x, ent.y, radius + index.maxR, buf);
  let hits = 0;

  for (let k = 0; k < n; k++) {
    const p = props[buf[k]];
    let dx = ent.x - p.x;
    let dy = ent.y - p.y;
    const need = p.r + radius;
    let d2 = dx * dx + dy * dy;
    if (d2 >= need * need) continue;

    let d = Math.sqrt(d2);
    if (d < EPS) {
      // Ровно в центре — нормали нет; выталкиваем в произвольную, но
      // детерминированную сторону, иначе делится на ноль.
      dx = 1; dy = 0; d = 1;
    }
    const nx = dx / d;
    const ny = dy / d;
    ent.x = p.x + nx * need;
    ent.y = p.y + ny * need;
    hits++;
    if (out) { out.nx = nx; out.ny = ny; }
  }
  return hits;
}

// Убрать составляющую скорости, направленную внутрь препятствия: сущность
// скользит вдоль края вместо того, чтобы упираться в него лбом. Для орды этого
// достаточно, поиск пути тут не нужен и не по бюджету.
export function slideAlong(ent, nx, ny) {
  const into = ent.vx * nx + ent.vy * ny;
  if (into >= 0) return;
  ent.vx -= nx * into;
  ent.vy -= ny * into;
}

// Свободна ли точка от препятствий (спавн врагов, выпадение праха)
export function isClear(x, y, radius, index) {
  const props = index.props;
  if (props.length === 0) return true;
  const n = index.grid.query(x, y, radius + index.maxR, index.buf);
  for (let k = 0; k < n; k++) {
    const p = props[index.buf[k]];
    const dx = x - p.x;
    const dy = y - p.y;
    const need = p.r + radius;
    if (dx * dx + dy * dy < need * need) return false;
  }
  return true;
}

const DEFAULT_TILE = 32;
const MAX_NEARBY = 32;
const EPS = 1e-6;
