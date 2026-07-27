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

  // История ПРИМЕНЁННЫХ КАДРОВ, а не позиций. Каждый кадр запоминает, каким вводом
  // и за какое dt мы двигались; по подтверждённому номеру ввода хвост истории
  // проигрывается заново поверх авторитетной позиции.
  //
  // Раньше здесь лежали позиции, и ошибка считалась как «позиция хоста минус наша
  // позиция В МОМЕНТ ОТПРАВКИ этого ввода». Эти две точки не совпадают даже при
  // идеальной сети: получив ввод, хост крутит его ещё несколько тиков, пока не
  // приедет следующий. Разница уходила в corr и подталкивала игрока вперёд, а после
  // отпускания клавиши — назад. Это и есть «желе».
  const HISTORY = 256;                    // ~4 с при 60 fps
  const frames = [];
  for (let i = 0; i < HISTORY; i++) frames.push({ seq: -1, dt: 0, ix: 0, iy: 0, speed: 0 });
  let framesAt = 0;

  // Скорость запоминается вместе с вводом: она меняется по ходу забега (предметы,
  // левелап), и переигрывать старый кадр текущей скоростью — значит заново развести
  // предсказание с авторитетом ровно в тот момент, когда игрок что-то купил.
  function noteFrame(frameSeq, dt, ix, iy, speed) {
    const f = frames[framesAt];
    f.seq = frameSeq;
    f.dt = dt;
    f.ix = ix;
    f.iy = iy;
    f.speed = speed;
    framesAt = (framesAt + 1) % HISTORY;
  }

  // Номера ввода 16-битные и заворачиваются: сравнивать их обычным «>» нельзя.
  function seqNewer(a, b) {
    return a !== b && ((a - b) & 0xffff) < 0x8000;
  }

  // Ввод едет по сети как int8 (шаг 1/127). Предсказывать надо ТЕМ ЖЕ числом,
  // которое увидит хост, иначе на диагоналях клиент и хост считают разную скорость
  // и расхождение копится на ровном месте.
  function quantize(v) {
    return Math.max(-127, Math.min(127, Math.round(v * 127))) / 127;
  }

  // Шаг движения игрока — копия sim/player.js. Любое расхождение с ним снова
  // разведёт предсказание с авторитетом, поэтому порядок операций тот же:
  // нормализация ввода → сдвиг → препятствия → стены.
  const scratch = { x: 0, y: 0, radius: config.player.radius };

  function integrate(ent, ix, iy, speed, dt) {
    let nx = ix;
    let ny = iy;
    const len = Math.sqrt(nx * nx + ny * ny);
    if (len > 1) { nx /= len; ny /= len; }
    const vx = nx * speed;
    const vy = ny * speed;
    if (vx === 0 && vy === 0) return;
    ent.x += vx * dt;
    ent.y += vy * dt;
    if (propIndex) separateFromProps(ent, config.player.radius, propIndex, null);
    const pad = config.arena.wall_padding;
    if (ent.x < pad) ent.x = pad;
    else if (ent.x > arenaW - pad) ent.x = arenaW - pad;
    if (ent.y < pad) ent.y = pad;
    else if (ent.y > arenaH - pad) ent.y = arenaH - pad;
  }

  // Пересборка предсказания от авторитетной позиции: ставим то, что прислал хост,
  // и заново проигрываем все кадры с вводом новее подтверждённого.
  function reconcile(p, srcX, srcY, ackSeq) {
    const wasX = p.simX;
    const wasY = p.simY;
    scratch.x = srcX;
    scratch.y = srcY;
    for (let i = 0; i < HISTORY; i++) {
      const f = frames[(framesAt + i) % HISTORY];
      if (f.seq < 0 || !seqNewer(f.seq, ackSeq)) continue;
      integrate(scratch, f.ix, f.iy, f.speed, f.dt);
    }
    p.simX = scratch.x;
    p.simY = scratch.y;
    // Остаток гасим ВИЗУАЛЬНО: симуляция уже стоит там, где сказал хост, а на
    // экране игрок доезжает до неё за SMOOTH_TIME вместо рывка.
    const dx = wasX - p.simX;
    const dy = wasY - p.simY;
    if (dx * dx + dy * dy > teleport * teleport) {
      p.smoothX = 0;
      p.smoothY = 0;
    } else {
      p.smoothX = dx;
      p.smoothY = dy;
    }
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
  let started = false;        // пришёл ли первый снапшот со своей позицией
  // Ввод, которым предсказываем. Берётся В МОМЕНТ ОТПРАВКИ и держится до следующей:
  // хост увидит ровно эту последовательность, и предсказывать надо ей же. Живой
  // ввод между отправками свежее того, что уедет по сети, и прогноз по нему
  // расходится с авторитетом на каждом нажатии и отпускании клавиши.
  let heldIx = 0;
  let heldIy = 0;

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
        // simX/simY — предсказанная ИСТИНА (её пересобирает reconcile), smoothX/Y —
        // визуальный остаток, который гасится за SMOOTH_TIME. На экран идёт сумма:
        // симуляция не должна дёргаться ради красоты, а картинка — рвано прыгать.
        simX: 0, simY: 0, smoothX: 0, smoothY: 0,
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
        // Свой персонаж: не «подтягиваемся» к присланной точке, а ПЕРЕСОБИРАЕМ
        // предсказание от неё, проиграв заново весь ввод, который хост ещё не учёл.
        // Пока предсказание совпадает с авторитетом, пересборка не двигает игрока
        // вообще — а именно постоянная поправка «на глазок» и давала желе.
        if (!started) {
          started = true;
          p.simX = src.x;
          p.simY = src.y;
          p.x = src.x;
          p.y = src.y;
          p.smoothX = 0;
          p.smoothY = 0;
        } else {
          reconcile(p, src.x, src.y, src.ackSeq);
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
      // Квантуем ДО отправки и предсказываем тем же числом, что уедет по сети
      heldIx = quantize(input.x);
      heldIy = quantize(input.y);
      transport.send(CH.INPUT, inputCodec.encode(myIndex, seq, heldIx, heldIy, 0).slice(0));
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
        // Предсказание: тот же шаг, что у хоста, тем же вводом, что ему отправлен.
        // Каждый кадр уходит в историю — по ней реконсиляция пересоберёт позицию,
        // когда придёт подтверждение.
        if (p.alive) {
          const speed = moveSpeed || p.speed;
          noteFrame(seq, dt, heldIx, heldIy, speed);
          scratch.x = p.simX;
          scratch.y = p.simY;
          integrate(scratch, heldIx, heldIy, speed, dt);
          p.simX = scratch.x;
          p.simY = scratch.y;
          p.vx = heldIx * speed;
          p.vy = heldIy * speed;
          if (p.vx !== 0 || p.vy !== 0) {
            if (p.vx * p.vx > p.vy * p.vy) p.dir = p.vx > 0 ? 1 : 3;
            else p.dir = p.vy > 0 ? 0 : 2;
            p.animT += dt;
          }
        }
        // Визуальный остаток гаснет за фиксированное ВРЕМЯ, а не «долю за кадр»:
        // так сглаживание одинаково на 60 и на 144 fps.
        const c = SMOOTH_TIME > 0 ? Math.min(1, dt / SMOOTH_TIME) : 1;
        p.smoothX -= p.smoothX * c;
        p.smoothY -= p.smoothY * c;
        p.x = p.simX + p.smoothX;
        p.y = p.simY + p.smoothY;
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

// За сколько секунд гаснет ВИДИМЫЙ остаток расхождения после пересборки
// предсказания. Симуляция к этому моменту уже стоит на авторитетной позиции;
// это чисто косметика, чтобы редкие поправки не выглядели рывком.
const SMOOTH_TIME = 0.1;

// Та же длительность подсветки иконки оружия, что в sim/weapon.js: у клиента
// слоты приходят лоадаутом, а таймеры тикают локально.
const FLASH_TIME = 0.08;
