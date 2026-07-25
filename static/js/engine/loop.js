// Цикл с фиксированным шагом: аккумулятор + update(dt), render(alpha) раз в кадр.
// Глобалы (requestAnimationFrame, performance) читаются лениво, чтобы модуль
// импортировался в node без DOM.

const STAT_WINDOW = 30; // окно скользящего среднего для статистики, кадров

export function createLoop({ dt, maxCatchup, update, render }) {
  const simBuf = new Float32Array(STAT_WINDOW);
  const renBuf = new Float32Array(STAT_WINDOW);
  const fpsBuf = new Float32Array(STAT_WINDOW);
  let bufIdx = 0;
  let bufLen = 0;

  const stats = { fps: 0, simMs: 0, renderMs: 0, steps: 0, frame: 0 };

  let running = false;
  let handle = 0;
  let last = -1;
  let acc = 0;

  function now() {
    const p = globalThis.performance;
    return p ? p.now() : Date.now();
  }

  function schedule(cb) {
    const raf = globalThis.requestAnimationFrame;
    if (raf) return raf(cb);
    return setTimeout(() => cb(now()), 16);
  }

  function unschedule(h) {
    const caf = globalThis.cancelAnimationFrame;
    if (caf) caf(h); else clearTimeout(h);
  }

  function frame(ts) {
    if (!running) return;
    handle = schedule(frame);

    if (last < 0) last = ts;
    const delta = (ts - last) / 1000;
    last = ts;

    acc += delta;
    let steps = 0;
    const t0 = now();
    while (acc >= dt && steps < maxCatchup) {
      update(dt);
      acc -= dt;
      steps++;
    }
    // Накопленный избыток отбрасываем (вкладка из фона не отматывает час),
    // дробную фазу кадра сохраняем
    if (acc >= dt) acc %= dt;
    const t1 = now();

    render(acc / dt);
    const t2 = now();

    // Скользящее среднее по кольцевым буферам, без аллокаций
    simBuf[bufIdx] = t1 - t0;
    renBuf[bufIdx] = t2 - t1;
    fpsBuf[bufIdx] = delta > 0 ? 1 / delta : 0;
    bufIdx = (bufIdx + 1) % STAT_WINDOW;
    if (bufLen < STAT_WINDOW) bufLen++;
    let sf = 0, ss = 0, sr = 0;
    for (let i = 0; i < bufLen; i++) {
      sf += fpsBuf[i];
      ss += simBuf[i];
      sr += renBuf[i];
    }
    stats.fps = sf / bufLen;
    stats.simMs = ss / bufLen;
    stats.renderMs = sr / bufLen;
    stats.steps = steps;
    stats.frame++;
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = -1;
      acc = 0;
      handle = schedule(frame);
    },
    stop() {
      running = false;
      unschedule(handle);
    },
    get running() {
      return running;
    },
    stats,
  };
}
