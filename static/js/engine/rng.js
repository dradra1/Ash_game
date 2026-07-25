// Детерминированный ГПСЧ (mulberry32). Единственный источник случайности в игре.
// Одинаковый сид → одинаковая последовательность. Math.random() запрещён.

export function createRng(seed) {
  let state = (seed >>> 0) | 0;

  // Сырое uint32
  function next() {
    state = (state + 0x6D2B79F5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  // [0, 1)
  function float() {
    return next() / 4294967296;
  }

  // [a, b)
  function range(a, b) {
    return a + float() * (b - a);
  }

  // Целое [a, b] включительно
  function int(a, b) {
    return a + Math.floor(float() * (b - a + 1));
  }

  function pick(arr) {
    return arr[int(0, arr.length - 1)];
  }

  // Выбор по весу: weightOf(item, index) → число. Нулевой вес не выбирается никогда.
  function weighted(arr, weightOf) {
    let total = 0;
    for (let i = 0; i < arr.length; i++) total += weightOf(arr[i], i);
    if (total <= 0) return null;
    let r = float() * total;
    for (let i = 0; i < arr.length; i++) {
      r -= weightOf(arr[i], i);
      if (r < 0) return arr[i];
    }
    return arr[arr.length - 1];
  }

  // Новый независимый поток, ответвлённый от текущего состояния
  function fork() {
    return createRng(next());
  }

  return { seed, next, float, range, int, pick, weighted, fork };
}
