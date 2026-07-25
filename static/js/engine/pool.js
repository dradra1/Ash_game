// Пул объектов фиксированной ёмкости. Все объекты создаются один раз через factory,
// дальше — ноль аллокаций: spawn/release только двигают count и делают swap-remove.

export function createPool(capacity, factory, reset) {
  const items = new Array(capacity);
  for (let i = 0; i < capacity; i++) items[i] = factory();

  const pool = {
    items,
    count: 0,
    capacity,

    // Живой объект или null при переполнении — пул не растёт
    spawn() {
      if (pool.count >= capacity) return null;
      const obj = items[pool.count++];
      if (reset) reset(obj);
      return obj;
    },

    // Освобождение по индексу: последний живой переезжает на место освобождённого
    release(i) {
      if (i < 0 || i >= pool.count) return;
      const last = --pool.count;
      const tmp = items[i];
      items[i] = items[last];
      items[last] = tmp;
    },

    clear() {
      pool.count = 0;
    },
  };

  return pool;
}
