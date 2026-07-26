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
// 11-й и 12-й байты игрока — «пульс удара»: индекс оружия и угол последнего
// замаха. Два байта на игрока × 8 × 20 Гц = 320 Б/с при бюджете 30 КБ/с.
// Индекс оружия, а не номер слота, делает пульс самодостаточным: клиенту не надо
// знать лоадаут соседа и не нужно отдельного надёжного сообщения об экипировке.
const SNAP_PLAYER = 11;
const SNAP_ENEMY = 8;
const NO_WEAPON = 0xff;

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
      swingWeapon: -1, swingAngle: 0, swingSeq: 0,
    });
  }
  for (let i = 0; i < maxEntities; i++) {
    decoded.enemies.push({ uid: 0, type: 0, x: 0, y: 0, hpPct: 0, dir: 0 });
  }

  // Сортировка врагов по близости к зрителю — если их больше лимита, обрезаем
  // дальних: вблизи расхождение видно, вдали нет.
  const order = new Int32Array(config.sim.max_enemies_cap);
  const dist = new Float64Array(config.sim.max_enemies_cap);

  // Что показать из ударов игрока за такт. Слотов шесть, а байт один, поэтому
  // слоты обходятся по кругу: за пару тактов эфир получают все, и ни один вид
  // оружия не оказывается вечно невидимым для соседей.
  function pickSwing(p) {
    const slots = p.slots;
    if (!slots) return -1;
    const n = slots.length;
    const start = (p._swingCursor || 0) % n;
    for (let i = 0; i < n; i++) {
      const k = (start + i) % n;
      const slot = slots[k];
      if (slot.cfg && slot.swingT > 0) {
        p._swingCursor = k + 1;
        return k;
      }
    }
    return -1;
  }

  function encode(run, viewX, viewY, seq, typeIndex, weaponIndex) {
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
      const sw = pickSwing(p);
      if (sw >= 0) {
        const slot = p.slots[sw];
        view.setUint8(o + 9, weaponIndex ? (weaponIndex.toIdx[slot.id] & 0xff) : NO_WEAPON);
        // Угол в uint8: шаг 1.4°, для замаха избыточно точно
        view.setUint8(o + 10, Math.round(normAngle(slot.lastAngle) / TAU * 255) & 0xff);
      } else {
        view.setUint8(o + 9, NO_WEAPON);
        view.setUint8(o + 10, 0);
      }
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
      const wIdx = v.getUint8(o + 9);
      if (wIdx === NO_WEAPON) {
        p.swingWeapon = -1;
      } else {
        // swingSeq растёт на каждый новый удар: клиент по нему понимает, что это
        // именно новый замах, а не тот же самый в следующем снапшоте.
        if (p.swingWeapon !== wIdx) p.swingSeq++;
        p.swingWeapon = wIdx;
        p.swingAngle = (v.getUint8(o + 10) / 255) * TAU;
      }
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
// --- События спавна снарядов, хост → клиент --------------------------------
// Снаряды НЕ синхронизируются покадрово (CLAUDE.md §4): шлётся только факт
// рождения, дальше клиент ведёт полёт сам по прямой. Урон считает только хост,
// клиентские снаряды — чистая косметика, и расхождение в пару пикселей на них
// никак не сказывается.
//
// 11 байт на снаряд. При плотной стрельбе ~60 снарядов/с это ~0.7 КБ/с — на
// порядок дешевле покадровой рассылки тех же снарядов в снапшоте.
const SPAWN_HEADER = 4;
const SPAWN_ITEM = 11;

export function createSpawnCodec(config) {
  const max = config.sim.max_projectiles;
  const buf = new ArrayBuffer(SPAWN_HEADER + max * SPAWN_ITEM);
  const view = new DataView(buf);
  const decoded = { count: 0, items: [] };
  for (let i = 0; i < max; i++) {
    decoded.items.push({
      x: 0, y: 0, vx: 0, vy: 0, ttl: 0, size: 0, texture: 0, hostile: false,
    });
  }

  function encode(list, n, texIndex) {
    view.setUint8(0, MSG_SPAWN);
    const count = Math.min(n, max);
    view.setUint16(1, count);
    let o = SPAWN_HEADER;
    for (let i = 0; i < count; i++) {
      const s = list[i];
      view.setInt16(o, clampI16(s.x));
      view.setInt16(o + 2, clampI16(s.y));
      view.setUint8(o + 4, Math.round(normAngle(Math.atan2(s.vy, s.vx)) / TAU * 255) & 0xff);
      // Скорость до 2550 px/с с шагом 10 — быстрее в конфиге ничего нет
      view.setUint8(o + 5, Math.min(255, Math.round(Math.hypot(s.vx, s.vy) / 10)));
      view.setUint8(o + 6, Math.min(255, Math.round(s.ttl * 50)));   // до 5.1 с
      view.setUint8(o + 7, Math.min(255, s.size));
      view.setUint8(o + 8, texIndex[s.texture] === undefined ? 0xff : texIndex[s.texture]);
      view.setUint8(o + 9, s.hostile ? 1 : 0);
      view.setUint8(o + 10, 0);
      o += SPAWN_ITEM;
    }
    return new Uint8Array(buf, 0, o);
  }

  function decode(data) {
    const v = data instanceof DataView ? data : new DataView(toBuffer(data));
    if (v.getUint8(0) !== MSG_SPAWN) return null;
    const count = Math.min(v.getUint16(1), max);
    let o = SPAWN_HEADER;
    for (let i = 0; i < count; i++) {
      const s = decoded.items[i];
      s.x = v.getInt16(o);
      s.y = v.getInt16(o + 2);
      const a = (v.getUint8(o + 4) / 255) * TAU;
      const speed = v.getUint8(o + 5) * 10;
      s.vx = Math.cos(a) * speed;
      s.vy = Math.sin(a) * speed;
      s.ttl = v.getUint8(o + 6) / 50;
      s.size = v.getUint8(o + 7);
      s.texture = v.getUint8(o + 8);
      s.hostile = v.getUint8(o + 9) === 1;
      o += SPAWN_ITEM;
    }
    decoded.count = count;
    return decoded;
  }

  return { encode, decode, maxBytes: buf.byteLength };
}

// Таблица «texture-id снаряда → индекс»: те же соображения, что у врагов и оружия
export function buildProjectileIndex(config) {
  const toIdx = {};
  const toId = [];
  const add = (tex) => {
    if (!tex || toIdx[tex] !== undefined) return;
    toIdx[tex] = toId.length;
    toId.push(tex);
  };
  for (const id in config.weapons) add(config.weapons[id].shape.texture);
  for (const id in config.enemies) {
    const atk = config.enemies[id].attack;
    if (atk && atk.projectile) add(atk.projectile.texture);
  }
  for (const id in config.bosses) {
    const atk = config.bosses[id].attack;
    if (atk && atk.projectile) add(atk.projectile.texture);
  }
  return { toIdx, toId };
}

const TAU = Math.PI * 2;

function normAngle(a) {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

// Таблица «id оружия → индекс» для пульса удара. 112 оружий влезают в байт;
// строку по сети на 20 Гц гонять незачем — ровно та же причина, что у врагов.
export function buildWeaponIndex(config) {
  const toIdx = {};
  const toId = [];
  for (const id in config.weapons) {
    toIdx[id] = toId.length;
    toId.push(id);
  }
  return { toIdx, toId };
}

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
