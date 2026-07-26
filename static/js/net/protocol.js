// Бинарная упаковка сетевых сообщений.
//
// Бюджет из ТЗ: ≤30 КБ/с на клиента. Поэтому позиции квантуются в int16, углы и
// HP — в один байт, а снаряды не синхронизируются покадрово: шлётся событие спавна,
// клиент экстраполирует полёт сам (расхождение в пару пикселей визуально безразлично,
// урон всё равно считает только хост).
//
// Буферы выделяются один раз: упаковка идёт 20 раз в секунду и не должна мусорить.

export const MSG_INPUT = 1;
export const MSG_SNAPSHOT = 2;
export const MSG_SPAWN = 3;      // событие спавна снаряда
export const MSG_EVENT = 4;      // надёжные события: волна, смерть, лут, босс

export const FLAG_READY = 1;
export const FLAG_PAUSE = 2;

// --- Ввод клиента → хост (30 Гц) -------------------------------------------
// 8 байт: тип, индекс игрока, seq, вектор движения, флаги.
const INPUT_BYTES = 8;

export function createInputCodec() {
  const buf = new ArrayBuffer(INPUT_BYTES);
  const view = new DataView(buf);
  const out = { playerIdx: 0, seq: 0, x: 0, y: 0, flags: 0 };

  return {
    encode(playerIdx, seq, x, y, flags) {
      view.setUint8(0, MSG_INPUT);
      view.setUint8(1, playerIdx & 0xff);
      view.setUint16(2, seq & 0xffff);
      // вектор длины ≤1 → int8 с шагом 1/127
      view.setInt8(4, Math.max(-127, Math.min(127, Math.round(x * 127))));
      view.setInt8(5, Math.max(-127, Math.min(127, Math.round(y * 127))));
      view.setUint8(6, flags & 0xff);
      view.setUint8(7, 0);
      return buf;
    },
    decode(data) {
      const v = data instanceof DataView ? data : new DataView(toBuffer(data));
      if (v.getUint8(0) !== MSG_INPUT) return null;
      out.playerIdx = v.getUint8(1);
      out.seq = v.getUint16(2);
      out.x = v.getInt8(4) / 127;
      out.y = v.getInt8(5) / 127;
      out.flags = v.getUint8(6);
      return out;
    },
    bytes: INPUT_BYTES,
  };
}

// --- Снапшот хост → клиент (20 Гц) -----------------------------------------
// Заголовок: тип, seq, волна, фаза, время фазы (дец. сек), число игроков, число врагов.
const SNAP_HEADER = 10;
const SNAP_PLAYER = 9;
const SNAP_ENEMY = 8;

export function createSnapshotCodec(config) {
  const maxEntities = config.net.max_entities_per_snapshot;
  const maxPlayers = config.coop.max_players;
  const size = SNAP_HEADER + maxPlayers * SNAP_PLAYER + maxEntities * SNAP_ENEMY;
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);

  // Разобранный снапшот переиспользуется: клиент читает его каждый кадр
  const decoded = {
    seq: 0, wave: 1, phase: 0, phaseTime: 0, paused: false,
    players: [], playerCount: 0,
    enemies: [], enemyCount: 0,
  };
  for (let i = 0; i < maxPlayers; i++) {
    decoded.players.push({
      idx: 0, x: 0, y: 0, hpPct: 0, dir: 0, level: 1, alive: true, pendingLevels: 0,
    });
  }
  for (let i = 0; i < maxEntities; i++) {
    decoded.enemies.push({ uid: 0, type: 0, x: 0, y: 0, hpPct: 0, dir: 0 });
  }

  // Сортировка врагов по близости к зрителю — если их больше лимита, обрезаем
  // дальних: вблизи расхождение видно, вдали нет.
  const order = new Int32Array(config.sim.max_enemies_cap);
  const dist = new Float64Array(config.sim.max_enemies_cap);

  function encode(run, viewX, viewY, seq, typeIndex) {
    const state = run.state;
    view.setUint8(0, MSG_SNAPSHOT);
    view.setUint16(1, seq & 0xffff);
    view.setUint8(3, state.wave & 0xff);
    let phaseByte = PHASE_CODE[state.phase] || 0;
    if (state.paused) phaseByte |= PHASE_PAUSE_BIT;
    view.setUint8(4, phaseByte);
    const pt = isFinite(state.phaseTime) ? Math.max(0, Math.round(state.phaseTime * 10)) : 0xffff;
    view.setUint16(5, Math.min(0xffff, pt));
    view.setUint8(7, state.players.length);

    let o = SNAP_HEADER;
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      view.setUint8(o, i);
      view.setInt16(o + 1, clampI16(p.x));
      view.setInt16(o + 3, clampI16(p.y));
      view.setUint8(o + 5, p.maxHp > 0 ? Math.round((p.hp / p.maxHp) * 255) : 0);
      view.setUint8(o + 6, (p.dir & 3) | (p.alive ? 4 : 0));
      view.setUint8(o + 7, Math.min(255, p.level));
      view.setUint8(o + 8, Math.min(255, p.pendingLevels || 0));
      o += SNAP_PLAYER;
    }

    // Отбираем врагов в радиусе видимости конкретного клиента
    const r = config.net.view_radius;
    const r2 = r * r;
    const pool = run.enemyPool;
    let n = 0;
    for (let i = 0; i < pool.count; i++) {
      const e = pool.items[i];
      const dx = e.x - viewX;
      const dy = e.y - viewY;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      order[n] = i;
      dist[n] = d2;
      n++;
    }
    if (n > maxEntities) {
      partialSortByDist(order, dist, n, maxEntities);
      n = maxEntities;
    }

    view.setUint16(8, n);
    for (let k = 0; k < n; k++) {
      const e = pool.items[order[k]];
      view.setUint16(o, e.uid & 0xffff);
      view.setUint8(o + 2, typeIndex[e.type] || 0);
      view.setInt16(o + 3, clampI16(e.x));
      view.setInt16(o + 5, clampI16(e.y));
      view.setUint8(o + 7, e.maxHp > 0 ? Math.round((e.hp / e.maxHp) * 255) : 0);
      o += SNAP_ENEMY;
    }
    return new Uint8Array(buf, 0, o);
  }

  function decode(data) {
    const v = data instanceof DataView ? data : new DataView(toBuffer(data));
    if (v.getUint8(0) !== MSG_SNAPSHOT) return null;
    decoded.seq = v.getUint16(1);
    decoded.wave = v.getUint8(3);
    const phaseRaw = v.getUint8(4);
    decoded.paused = (phaseRaw & PHASE_PAUSE_BIT) !== 0;
    decoded.phase = phaseRaw & ~PHASE_PAUSE_BIT;
    const pt = v.getUint16(5);
    decoded.phaseTime = pt === 0xffff ? Infinity : pt / 10;
    decoded.playerCount = v.getUint8(7);
    decoded.enemyCount = v.getUint16(8);

    let o = SNAP_HEADER;
    for (let i = 0; i < decoded.playerCount; i++) {
      const p = decoded.players[i];
      p.idx = v.getUint8(o);
      p.x = v.getInt16(o + 1);
      p.y = v.getInt16(o + 3);
      p.hpPct = v.getUint8(o + 5) / 255;
      const d = v.getUint8(o + 6);
      p.dir = d & 3;
      p.alive = (d & 4) !== 0;
      p.level = v.getUint8(o + 7);
      p.pendingLevels = v.getUint8(o + 8);
      o += SNAP_PLAYER;
    }
    for (let k = 0; k < decoded.enemyCount; k++) {
      const e = decoded.enemies[k];
      e.uid = v.getUint16(o);
      e.type = v.getUint8(o + 2);
      e.x = v.getInt16(o + 3);
      e.y = v.getInt16(o + 5);
      e.hpPct = v.getUint8(o + 7) / 255;
      o += SNAP_ENEMY;
    }
    return decoded;
  }

  return { encode, decode, maxBytes: size };
}

// Частичная сортировка: нужны k ближайших, полная сортировка 450 элементов лишняя
function partialSortByDist(order, dist, n, k) {
  for (let i = 0; i < k; i++) {
    let best = i;
    for (let j = i + 1; j < n; j++) {
      if (dist[j] < dist[best]) best = j;
    }
    if (best !== i) {
      const oi = order[i]; order[i] = order[best]; order[best] = oi;
      const di = dist[i]; dist[i] = dist[best]; dist[best] = di;
    }
  }
}

function clampI16(v) {
  const r = Math.round(v);
  return r < -32768 ? -32768 : r > 32767 ? 32767 : r;
}

function toBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return data;
}

export const PHASE_CODE = {
  intro: 0, wave: 1, collect: 2, shop: 3, over: 4, levelup: 5,
};
export const PHASE_NAME = ['intro', 'wave', 'collect', 'shop', 'over', 'levelup'];
export const PHASE_PAUSE_BIT = 0x80;

// Таблица «id типа врага → индекс» строится один раз из конфига: гонять строки
// по сети на 20 Гц незачем.
export function buildTypeIndex(config) {
  const toIdx = {};
  const toId = [];
  for (const id in config.enemies) {
    toIdx[id] = toId.length;
    toId.push(id);
  }
  for (const id in config.bosses) {
    toIdx[id] = toId.length;
    toId.push(id);
  }
  return { toIdx, toId };
}
