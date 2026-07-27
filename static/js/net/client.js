// Не-хост: шлёт ввод, принимает снапшоты, интерполирует чужие сущности и
// предсказывает движение СВОЕГО персонажа.
//
// Предсказание нужно потому, что при пинге 80 мс ждать подтверждения хоста —
// значит играть с заметной задержкой на управление. Свой персонаж двигается
// локально сразу, а к позиции хоста подтягивается плавно; если расхождение
// больше net.teleport_threshold, это уже не рассинхрон, а телепорт — ставим жёстко.

import { CH } from './transport.js';
import {
  createInputCodec, createSnapshotCodec, createSpawnCodec,
  buildTypeIndex, buildWeaponIndex, buildProjectileIndex,
  PHASE_NAME, MSG_SNAPSHOT, MSG_SPAWN,
} from './protocol.js';
import { separateFromProps } from '../sim/arena.js';
import { enemyCfg } from '../sim/enemy.js';

// propIndex — препятствия арены. Клиент не симулирует мир, но своего персонажа
// предсказывает, и без коллизий предсказание въезжало бы в завал, а сверка с
// хостом выдёргивала бы обратно: у каждого препятствия управление «резинит».
export function createNetClient(transport, config, myIndex, propIndex, arenaW, arenaH) {
  const inputCodec = createInputCodec();
  const snapCodec = createSnapshotCodec(config);
  const types = buildTypeIndex(config);
  const weapons = buildWeaponIndex(config);
  const projTex = buildProjectileIndex(config);
  const spawnCodec = createSpawnCodec(config);

  // Снаряды у клиента — чистая косметика: урон считает хост, сюда приходит только
  // факт рождения, дальше полёт ведётся по прямой. Пул фиксированный, лишнее
  // просто не рождается (деградация, а не рост — CLAUDE.md §4).
  const projectiles = { items: [], count: 0 };
  for (let i = 0; i < config.sim.max_projectiles; i++) {
    projectiles.items.push({
      x: 0, y: 0, vx: 0, vy: 0, ttl: 0, size: 0, texture: null, spin: null,
      color: null, age: 0,
    });
  }

  // Быстрый доступ «индекс снаряда → как его вращать»: считается один раз
  const spinByTex = [];
  for (const id in config.weapons) {
    const sh = config.weapons[id].shape;
    if (sh.texture) spinByTex[projTex.toIdx[sh.texture]] = sh.spin || null;
  }

  function spawnProjectiles(dec) {
    for (let i = 0; i < dec.count; i++) {
      if (projectiles.count >= projectiles.items.length) return;
      const s = dec.items[i];
      const p = projectiles.items[projectiles.count++];
      p.x = s.x; p.y = s.y; p.vx = s.vx; p.vy = s.vy;
      p.ttl = s.ttl; p.size = s.size; p.age = 0;
      p.texture = projTex.toId[s.texture] || null;
      p.spin = spinByTex[s.texture] || null;
    }
  }

  // История предсказанных позиций по номеру ввода. Нужна, чтобы сравнивать
  // авторитетную позицию с нашей ТОГДАШНЕЙ, а не с текущей. Кольцо фиксированного
  // размера: аллокаций в кадре быть не должно.
  const HISTORY = 64;
  const history = [];
  for (let i = 0; i < HISTORY; i++) history.push({ seq: -1, x: 0, y: 0 });
  let historyAt = 0;

  function notePrediction(seq, x, y) {
    const h = history[historyAt];
    h.seq = seq;
    h.x = x;
    h.y = y;
    historyAt = (historyAt + 1) % HISTORY;
  }

  function recallPrediction(seq) {
    for (let i = 0; i < HISTORY; i++) {
      if (history[i].seq === seq) return history[i];
    }
    return null;
  }

  // Экипировка от хоста: редкое надёжное сообщение (покупка, левелап, старт волны).
  // Конфиг у клиента тот же, поэтому по сети едут только id — cfg разворачивается тут.
  function applyLoadout(idx, snap) {
    ensurePlayers(idx + 1);
    const p = state.players[idx];
    if (!p || !snap) return;
    const ids = snap.weapons || [];
    while (p.slots.length < ids.length) {
      p.slots.push({
        id: null, cfg: null, cd: 0, flash: 0, swingT: 0, swingLen: 0, lastAngle: 0,
      });
    }
    p.slots.length = ids.length;
    for (let i = 0; i < ids.length; i++) {
      const slot = p.slots[i];
      if (slot.id === ids[i]) continue;      // тот же ствол — не сбрасываем кулдаун
      slot.id = ids[i];
      slot.cfg = ids[i] ? config.weapons[ids[i]] : null;
      slot.cd = 0;
      slot.flash = 0;
      slot.swingT = 0;
    }
    p.items = snap.items || [];
    p.stats = snap.stats || {};
    p.maxHp = snap.maxHp || p.maxHp;
    p.level = snap.level || p.level;
    // Скорость предсказания обязана совпадать с той, что симулирует хост, иначе
    // реконсиляция вечно тянет игрока назад — это и есть «движение по льду».
    if (p.stats && typeof p.stats.move_speed_pct === 'number') {
      p.speed = config.player.move_speed * (1 + p.stats.move_speed_pct / 100);
    }
  }

  function stepProjectiles(dt) {
    for (let i = projectiles.count - 1; i >= 0; i--) {
      const p = projectiles.items[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.ttl -= dt;
      p.age += dt;
      if (p.ttl > 0) continue;
      // swap-remove: порядок снарядов не важен, а сдвиг массива — аллокация
      const last = projectiles.items[projectiles.count - 1];
      projectiles.items[projectiles.count - 1] = p;
      projectiles.items[i] = last;
      projectiles.count--;
    }
  }
  const inputPeriod = 1 / config.net.input_hz;
  const snapPeriod = 1 / config.net.snapshot_hz;
  const teleport = config.net.teleport_threshold;

  // Мир глазами клиента. Ровно та же форма, что у state в sim/run.js, чтобы
  // рендер и HUD не знали, кто мы — хост или клиент.
  const state = {
    wave: 1, phase: 'intro', phaseTime: 0, time: 0, paused: false,
    players: [], pot: 0, kills: 0, score: 0, bosses: 0, win: false,
    shopOpen: false, bossUid: -1,
  };
  // Пул отображаемых врагов: интерполируем между снапшотами
  const enemies = { items: [], count: 0 };
  for (let i = 0; i < config.net.max_entities_per_snapshot; i++) {
    enemies.items.push({
      uid: 0, type: null, cfg: null, sprite: 0, dir: 0, animT: 0,
      x: 0, y: 0, prevX: 0, prevY: 0, tx: 0, ty: 0, hpPct: 1, vx: 0, vy: 0, alive: true,
    });
  }

  const stats = { bytesIn: 0, kbs: 0, snaps: 0, lastSeq: -1, lost: 0 };
  // Счётчики для приёмки коопа: без снарядов и замахов клиент видит немой бой
  let projSeen = 0;
  let swingSeen = 0;
  let window = 0;
  let windowBytes = 0;
  let sinceSnap = 0;
  let inputAcc = 0;
  let seq = 0;
  let ready = false;

  function ensurePlayers(n) {
    while (state.players.length < n) {
      state.players.push({
        id: state.players.length, name: '', character: null,
        x: 0, y: 0, prevX: 0, prevY: 0, tx: 0, ty: 0,
        vx: 0, vy: 0, dir: 0, animT: 0,
        // maxHp и speed до первого сообщения о лоадауте — базовые из конфига,
        // чтобы HUD не показывал «1 / 1», а предсказание не стояло на месте.
        hp: config.player.base.max_hp, maxHp: config.player.base.max_hp,
        speed: config.player.move_speed,
        alive: true, level: 1, ash: 0,
        slots: [], items: [], stats: {}, input: { x: 0, y: 0 },
        pendingLevels: 0, xp: 0, xpNext: 1,
        // Остаток измеренной ошибки предсказания, гасится в step()
        corrX: 0, corrY: 0,
        swingSeq: -1, swingId: null, swingAngle: 0, swingT: 0, swingLen: 0.22,
      });
    }
  }

  function onSnapshot(payload) {
    const kind = messageType(payload);
    if (kind === MSG_SPAWN) {
      const sp = spawnCodec.decode(payload);
      if (sp) {
        spawnProjectiles(sp);
        projSeen += sp.count;
        stats.bytesIn += byteLength(payload);
        windowBytes += byteLength(payload);
      }
      return;
    }
    if (kind !== MSG_SNAPSHOT) return;
    const dec = snapCodec.decode(payload);
    if (!dec) return;
    stats.bytesIn += byteLength(payload);
    windowBytes += byteLength(payload);
    stats.snaps++;
    if (stats.lastSeq >= 0) {
      const gap = (dec.seq - stats.lastSeq) & 0xffff;
      if (gap > 1) stats.lost += gap - 1;
    }
    stats.lastSeq = dec.seq;
    sinceSnap = 0;
    ready = true;

    state.wave = dec.wave;
    state.phase = PHASE_NAME[dec.phase] || 'wave';
    state.phaseTime = dec.phaseTime;
    state.paused = !!dec.paused;
    state.pot = dec.pot;

    ensurePlayers(dec.playerCount);
    for (let i = 0; i < dec.playerCount; i++) {
      const src = dec.players[i];
      const p = state.players[i];
      p.prevX = p.x;
      p.prevY = p.y;
      p.tx = src.x;
      p.ty = src.y;
      p.dir = src.dir;
      p.alive = src.alive;
      p.level = src.level;
      p.pendingLevels = src.pendingLevels || 0;
      // maxHp приходит надёжным сообщением о лоадауте; в снапшоте едет только доля,
      // поэтому HUD показывает настоящие числа, а не проценты от выдуманной сотни.
      p.hp = src.hpPct * p.maxHp;
      p.ash = src.ash;
      p.xp = src.xpPct;
      p.xpNext = 1;
      // Пульс удара: новый замах виден по выросшему swingSeq. Слоты соседа
      // клиенту неизвестны, поэтому оружие приходит индексом, а не номером слота.
      if (src.swingWeapon >= 0 && src.swingSeq !== p.swingSeq) {
        p.swingSeq = src.swingSeq;
        p.swingId = weapons.toId[src.swingWeapon] || null;
        p.swingAngle = src.swingAngle;
        const cfg = p.swingId ? config.weapons[p.swingId] : null;
        p.swingLen = cfg && cfg.shape.anim_time ? cfg.shape.anim_time : 0.22;
        p.swingT = p.swingLen;
        swingSeen++;
        // Пульс переносится и в слот: раз лоадаут известен, замах и кулдаун
        // рисуются из слотов, как у хоста. Кулдаун здесь приблизительный —
        // берётся паспортный из конфига, без учёта attack_speed_pct.
        for (let s = 0; s < p.slots.length; s++) {
          const slot = p.slots[s];
          if (slot.id !== p.swingId) continue;
          slot.lastAngle = src.swingAngle;
          slot.swingLen = p.swingLen;
          slot.swingT = p.swingLen;
          slot.flash = FLASH_TIME;
          slot.cd = cfg ? cfg.cooldown : 0;
          break;
        }
      }
      if (i === myIndex) {
        // Свой персонаж. Ошибку предсказания меряем не по текущей позиции (она
        // ушла вперёд на RTT и «ошибкой» не является), а по той, в которой мы были
        // на момент ввода, который хост только что учёл. Если предсказание верное,
        // ошибка нулевая и подтягивать НЕЧЕГО — именно постоянное подтягивание к
        // устаревшей позиции и ощущалось как движение по льду.
        const past = recallPrediction(src.ackSeq);
        const dx = src.x - (past ? past.x : p.x);
        const dy = src.y - (past ? past.y : p.y);
        if (dx * dx + dy * dy > teleport * teleport) {
          // Разошлись слишком сильно (телепорт, отбрасывание, пропуск пачки пакетов)
          p.x = src.x;
          p.y = src.y;
          p.corrX = 0;
          p.corrY = 0;
        } else {
          p.corrX = dx;
          p.corrY = dy;
        }
      } else {
        // Чужие: интерполяция между снапшотами (prevPos → tx/ty за snapPeriod)
        if (p.x === 0 && p.y === 0) { p.x = src.x; p.y = src.y; p.prevX = src.x; p.prevY = src.y; }
      }
    }

    // Враги: сопоставляем по uid, чтобы не дёргались при перестановке в снапшоте
    enemies.count = dec.enemyCount;
    for (let k = 0; k < dec.enemyCount; k++) {
      const src = dec.enemies[k];
      const e = enemies.items[k];
      const same = e.uid === src.uid;
      e.uid = src.uid;
      const id = types.toId[src.type];
      if (e.type !== id) {
        e.type = id;
        // Через общий резолвер, а не по двум таблицам: ломаемые объекты арены
        // ездят в снапшоте теми же байтами, что враги, но лежат в config.breakables —
        // и на клиенте оставались без cfg, то есть не рисовались вовсе.
        e.cfg = enemyCfg(config, id);
        e.breakable = !!(e.cfg && e.cfg.breakable);
        e.sprite = (e.cfg && e.cfg.sprite) || config.render.sprite_default;
      }
      e.prevX = same ? e.x : src.x;
      e.prevY = same ? e.y : src.y;
      e.tx = src.x;
      e.ty = src.y;
      if (!same) { e.x = src.x; e.y = src.y; }
      e.hpPct = src.hpPct;
      e.alive = true;
    }
  }

  let lastRunOver = null;

  function onEvent(payload) {
    if (!payload) return;
    // Адресные события лавки / левелапа обрабатывает main.js через свой listener
    if (payload.list) {
      for (let i = 0; i < payload.list.length; i++) {
        const ev = payload.list[i];
        if (ev.type === 'run_over') {
          state.win = ev.a === 1;
          lastRunOver = ev.b || { win: state.win };
        } else if (ev.type === 'pause') {
          state.paused = ev.a === 1;
        }
      }
    }
  }

  transport.on(CH.SNAPSHOT, onSnapshot);
  transport.on(CH.EVENT, onEvent);

  // Локальное предсказание своего движения + интерполяция всего остального
  function step(dt, input, moveSpeed) {
    state.time += dt;
    sinceSnap += dt;
    window += dt;

    inputAcc += dt;
    if (inputAcc >= inputPeriod) {
      inputAcc -= inputPeriod;
      seq = (seq + 1) & 0xffff;
      transport.send(CH.INPUT, inputCodec.encode(myIndex, seq, input.x, input.y, 0).slice(0));
      const me = state.players[myIndex];
      if (me) notePrediction(seq, me.x, me.y);
    }

    stepProjectiles(dt);
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      if (p.swingT > 0) p.swingT -= dt;
      // Кулдауны и вспышки слотов тикают локально: слоты приходят лоадаутом,
      // а их таймеры по сети не гоняются.
      const slots = p.slots;
      for (let s = 0; s < slots.length; s++) {
        const slot = slots[s];
        if (slot.cd > 0) slot.cd -= dt;
        if (slot.flash > 0) slot.flash -= dt;
        if (slot.swingT > 0) slot.swingT -= dt;
      }
    }

    const k = Math.min(1, sinceSnap / snapPeriod);
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      if (i === myIndex) {
        // Предсказание: двигаемся сами, потом мягко сходимся с хостом
        if (p.alive) {
          p.vx = input.x * moveSpeed;
          p.vy = input.y * moveSpeed;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (propIndex) separateFromProps(p, config.player.radius, propIndex, null);
          // Те же стены, что и у хоста (sim/player.js): без клампа предсказание
          // уходило сквозь стену, и реконсиляция дёргала игрока обратно.
          const pad = config.arena.wall_padding;
          if (p.x < pad) p.x = pad;
          else if (p.x > arenaW - pad) p.x = arenaW - pad;
          if (p.y < pad) p.y = pad;
          else if (p.y > arenaH - pad) p.y = arenaH - pad;
          if (p.vx !== 0 || p.vy !== 0) {
            if (p.vx * p.vx > p.vy * p.vy) p.dir = p.vx > 0 ? 1 : 3;
            else p.dir = p.vy > 0 ? 0 : 2;
            p.animT += dt;
          }
        }
        // Гасим измеренную ошибку предсказания, а не расстояние до устаревшей цели.
        // Верное предсказание даёт corr ≈ 0, и игрок не «плывёт».
        const c = Math.min(1, RECONCILE * dt * 60);
        p.x += p.corrX * c;
        p.y += p.corrY * c;
        p.corrX -= p.corrX * c;
        p.corrY -= p.corrY * c;
      } else {
        const nx = p.prevX + (p.tx - p.prevX) * k;
        const ny = p.prevY + (p.ty - p.prevY) * k;
        if (nx !== p.x || ny !== p.y) p.animT += dt;
        p.x = nx;
        p.y = ny;
      }
    }

    for (let e2 = 0; e2 < enemies.count; e2++) {
      const e = enemies.items[e2];
      const nx = e.prevX + (e.tx - e.prevX) * k;
      const ny = e.prevY + (e.ty - e.prevY) * k;
      const dx = nx - e.x;
      const dy = ny - e.y;
      if (dx !== 0 || dy !== 0) {
        if (dx * dx > dy * dy) e.dir = dx > 0 ? 1 : 3;
        else e.dir = dy > 0 ? 0 : 2;
        e.animT += dt;
      }
      e.x = nx;
      e.y = ny;
    }

    if (window >= 1) {
      stats.kbs = windowBytes / 1024 / window;
      window = 0;
      windowBytes = 0;
    }
  }

  function close() {
    transport.off(CH.SNAPSHOT, onSnapshot);
    transport.off(CH.EVENT, onEvent);
  }

  return {
    state, enemies, projectiles, step, stats, close, applyLoadout,
    get projSeen() { return projSeen; },
    get swingSeen() { return swingSeen; },
    get ready() { return ready; },
    get lastRunOver() { return lastRunOver; },
    clearRunOver() { lastRunOver = null; },
  };
}

// Снапшот и события спавна идут одним каналом и различаются первым байтом
function messageType(data) {
  if (data instanceof DataView) return data.getUint8(0);
  if (data instanceof ArrayBuffer) return new Uint8Array(data)[0];
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, 1)[0];
  return -1;
}

function byteLength(p) {
  if (!p) return 0;
  return p.byteLength !== undefined ? p.byteLength : 64;
}

// Скорость гашения измеренной ошибки предсказания. Больше — жёстче дёргает при
// расхождении, меньше — дольше «плывёт». Применяется к ошибке, а не к расстоянию
// до устаревшей позиции хоста, поэтому при верном предсказании не работает вовсе.
const RECONCILE = 0.12;

// Та же длительность подсветки иконки оружия, что в sim/weapon.js: у клиента
// слоты приходят лоадаутом, а таймеры тикают локально.
const FLASH_TIME = 0.08;
