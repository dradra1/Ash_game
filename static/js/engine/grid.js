// Uniform spatial hash на плоских типизированных массивах.
// Все бакеты выделяются один раз в createGrid: счётчики + элементы фиксированной
// ёмкости на ячейку. insert/query не аллоцируют; переполнение ячейки отбрасывает лишнее.

const CELL_CAP = 64; // максимум сущностей в одной ячейке

export function createGrid(cellSize, width, height) {
  const cols = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(height / cellSize));
  const nCells = cols * rows;

  const counts = new Int32Array(nCells);
  const ids = new Int32Array(nCells * CELL_CAP);
  const posX = new Float32Array(nCells * CELL_CAP);
  const posY = new Float32Array(nCells * CELL_CAP);

  function clear() {
    counts.fill(0);
  }

  // Сущность вставляется в одну ячейку по своей точке (координаты клампятся в сетку)
  function insert(id, x, y) {
    let cx = (x / cellSize) | 0;
    if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
    let cy = (y / cellSize) | 0;
    if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;
    const cell = cy * cols + cx;
    const n = counts[cell];
    if (n >= CELL_CAP) return;
    const o = cell * CELL_CAP + n;
    ids[o] = id;
    posX[o] = x;
    posY[o] = y;
    counts[cell] = n + 1;
  }

  // Точки в радиусе от (x, y). Пишет id в out, возвращает число записанных.
  function query(x, y, radius, out) {
    const r2 = radius * radius;
    let written = 0;
    // Клампить надо оба конца диапазона: враги спавнятся ЗА краем арены, и запрос
    // из такой точки давал cx0 > cx1 — цикл не выполнялся и сосед не находился.
    let cx0 = ((x - radius) / cellSize) | 0;
    if (cx0 < 0) cx0 = 0; else if (cx0 >= cols) cx0 = cols - 1;
    let cx1 = ((x + radius) / cellSize) | 0;
    if (cx1 >= cols) cx1 = cols - 1; else if (cx1 < 0) cx1 = 0;
    let cy0 = ((y - radius) / cellSize) | 0;
    if (cy0 < 0) cy0 = 0; else if (cy0 >= rows) cy0 = rows - 1;
    let cy1 = ((y + radius) / cellSize) | 0;
    if (cy1 >= rows) cy1 = rows - 1; else if (cy1 < 0) cy1 = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const base = (cy * cols + cx) * CELL_CAP;
        const n = counts[cy * cols + cx];
        for (let i = 0; i < n; i++) {
          const dx = posX[base + i] - x;
          const dy = posY[base + i] - y;
          if (dx * dx + dy * dy <= r2) {
            out[written++] = ids[base + i];
            if (written >= out.length) return written;
          }
        }
      }
    }
    return written;
  }

  // Точки внутри прямоугольника [x, x+w] × [y, y+h]
  function queryRect(x, y, w, h, out) {
    let written = 0;
    let cx0 = (x / cellSize) | 0;
    if (cx0 < 0) cx0 = 0; else if (cx0 >= cols) cx0 = cols - 1;
    let cx1 = ((x + w) / cellSize) | 0;
    if (cx1 >= cols) cx1 = cols - 1; else if (cx1 < 0) cx1 = 0;
    let cy0 = (y / cellSize) | 0;
    if (cy0 < 0) cy0 = 0; else if (cy0 >= rows) cy0 = rows - 1;
    let cy1 = ((y + h) / cellSize) | 0;
    if (cy1 >= rows) cy1 = rows - 1; else if (cy1 < 0) cy1 = 0;
    const x1 = x + w;
    const y1 = y + h;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const base = (cy * cols + cx) * CELL_CAP;
        const n = counts[cy * cols + cx];
        for (let i = 0; i < n; i++) {
          const ex = posX[base + i];
          const ey = posY[base + i];
          if (ex >= x && ex <= x1 && ey >= y && ey <= y1) {
            out[written++] = ids[base + i];
            if (written >= out.length) return written;
          }
        }
      }
    }
    return written;
  }

  return { clear, insert, query, queryRect, cellSize };
}
