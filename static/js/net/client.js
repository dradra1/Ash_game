// Не-хост: шлёт ввод, принимает снапшоты, интерполирует чужие сущности и
// предсказывает движение СВОЕГО персонажа.
//
// Предсказание нужно потому, что при пинге 80 мс ждать подтверждения хоста —
// значит играть с заметной задержкой на управление. Свой персонаж двигается
// локально сразу, а к позиции хоста подтягивается плавно; если расхождение
// больше net.teleport_threshold, это уже не рассинхрон, а телепорт — ставим жёстко.

import { CH } from './transport.js';
import { createInputCodec, createSnapshotCodec, buildTypeIndex, PHASE_NAME } from './protocol.js';
import { separateFromProps } from '../sim/arena.js';

// propIndex — препятствия арены. Клиент не симулирует мир, но своего персонажа
// предсказывает, и без коллизий предсказание въезжало бы в завал, а сверка с
// хостом выдёргивала бы обратно: у каждого препятствия управление «резинит».
export function createNetClient(transport, config, myIndex, propIndex) {
  const inputCodec = createInputCodec();
  const snapCodec = createSnapshotCodec(config);
  const types = buildTypeIndex(config);
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
        hp: 1, maxHp: 1, alive: true, level: 1, ash: 0,
        slots: [], items: [], stats: {}, input: { x: 0, y: 0 },
        pendingLevels: 0, xp: 0, xpNext: 1,
      });
    }
  }

  function onSnapshot(payload) {
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
      p.maxHp = 100;
      p.hp = src.hpPct * 100;
      if (i === myIndex) {
        // Свой персонаж: мягко подтягиваем предсказанную позицию к авторитетной
        const dx = src.x - p.x;
        const dy = src.y - p.y;
        if (dx * dx + dy * dy > teleport * teleport) {
          p.x = src.x;
          p.y = src.y;
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
        e.cfg = config.enemies[id] || config.bosses[id];
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
          if (p.vx !== 0 || p.vy !== 0) {
            if (p.vx * p.vx > p.vy * p.vy) p.dir = p.vx > 0 ? 1 : 3;
            else p.dir = p.vy > 0 ? 0 : 2;
            p.animT += dt;
          }
        }
        p.x += (p.tx - p.x) * RECONCILE * dt * 60;
        p.y += (p.ty - p.y) * RECONCILE * dt * 60;
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
    state, enemies, step, stats, close,
    get ready() { return ready; },
    get lastRunOver() { return lastRunOver; },
    clearRunOver() { lastRunOver = null; },
  };
}

function byteLength(p) {
  if (!p) return 0;
  return p.byteLength !== undefined ? p.byteLength : 64;
}

// Скорость схождения предсказанной позиции с авторитетной. Больше — жёстче
// дёргает при расхождении, меньше — дольше «плывёт».
const RECONCILE = 0.12;
