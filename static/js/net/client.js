// Не-хост: шлёт ввод, принимает снапшоты, интерполирует чужие сущности и
// предсказывает движение СВОЕГО персонажа.
//
// Предсказание нужно потому, что при пинге 80 мс ждать подтверждения хоста —
// значит играть с заметной задержкой на управление. Свой персонаж двигается
// локально сразу, а к позиции хоста подтягивается плавно; если расхождение
// больше net.teleport_threshold, это уже не рассинхрон, а телепорт — ставим жёстко.

import { CH } from './transport.js';
import {
  createInputCodec, createSnapshotCodec, createSpawnCodec, createSwingCodec,
  createPickupCodec, createTurretCodec,
  buildTypeIndex, buildWeaponIndex, buildProjectileIndex,
  PHASE_NAME, MSG_SNAPSHOT, MSG_SPAWN, MSG_SWING, MSG_PICKUP, MSG_TURRET,
} from './protocol.js';
import { separateFromProps } from '../sim/arena.js';
import { enemyCfg } from '../sim/enemy.js';
import { SWING_TURRET } from '../sim/turret.js';

// propIndex — препятствия арены. Клиент не симулирует мир, но своего персонажа
// предсказывает, и без коллизий предсказание въезжало бы в завал, а сверка с
// хостом выдёргивала бы обратно: у каждого препятствия управление «резинит».
// onImpact — колбэк искр в точке попадания (engine/particles.js у main.js).
// Клиент не считает урон и не знает о нём ничего, но ПАДЕНИЕ доли HP врага
// между снапшотами видит. Этого достаточно, чтобы бой перестал быть немым, и
// это не стоит ни байта трафика: отдельный канал событий урона на 450 врагах
// сожрал бы весь бюджет ради косметики.
export function createNetClient(transport, config, myIndex, propIndex, arenaW, arenaH, onImpact) {
  const inputCodec = createInputCodec();
  const snapCodec = createSnapshotCodec(config);
  const types = buildTypeIndex(config);
  const weapons = buildWeaponIndex(config);
  const projTex = buildProjectileIndex(config);
  const spawnCodec = createSpawnCodec(config);
  const swingCodec = createSwingCodec(config);
  const pickupCodec = createPickupCodec(config);
  const turretCodec = createTurretCodec(config);

  // Прах на полу. У клиента он чисто декоративный: подбирает и считает хост,
  // сюда едут только точки (MSG_PICKUP). До этого канала пол у клиента был пуст.
  const pickups = { items: [], count: 0 };
  for (let i = 0; i < config.net.max_pickups_per_snapshot; i++) {
    pickups.items.push({ uid: 0, x: 0, y: 0, tx: 0, ty: 0, tier: 0 });
  }
  // Кто из кучек пришёл в этом пакете. Кучек максимум max_pickups_per_snapshot
  // (64), поэтому поиск по uid линейный — таблица на 65536 записей, как у врагов,
  // тут была бы четвертью мегабайта ради шести десятков элементов.
  const pickupSeen = new Int32Array(config.net.max_pickups_per_snapshot);
  let pickupStamp = 0;

  // Турели: неподвижные копии оружия. Список приходит целиком при изменении,
  // замахи — пульсом MSG_SWING по индексу в этом же списке.
  const turrets = { items: [], count: 0 };
  for (let i = 0; i < config.engineering.max_turrets; i++) {
    turrets.items.push({
      x: 0, y: 0, owner: 0, id: null, cfg: null,
      slots: [{ id: null, cfg: null, cd: 0, flash: 0, swingT: 0, swingLen: 0, lastAngle: 0 }],
    });
  }

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
  const HISTORY = config.net.predict_history_frames;   // ~4 с при 60 fps
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
    // Мёртвая зона: позиция едет в снапшоте как int16, то есть округлённая до
    // целого пикселя. Пересобирая предсказание от округлённой базы каждый раз,
    // мы затаскивали ошибку округления (до 0.5 px по оси) прямо в результат —
    // и она меняла знак по мере дрейфа истинной позиции хоста относительно
    // целых. Выходила пила ±0.3 px: глазу невидимая, но в сумме «назад» за
    // долгую остановку набегала пара пикселей, и чем чаще снапшоты, тем больше.
    //
    // Если расхождение меньше кванта, сверять нечего: провод не в состоянии
    // выразить эту разницу. Держим предсказание как есть. Настоящий рассинхрон
    // даёт кратно больше и порог перешагнёт.
    const offX = scratch.x - wasX;
    const offY = scratch.y - wasY;
    if (offX * offX + offY * offY > deadzone2) {
      p.simX = scratch.x;
      p.simY = scratch.y;
    }
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
  const inputCatchup = config.net.input_catchup_max;
  const teleport = config.net.teleport_threshold;
  const deadzone2 = config.net.reconcile_deadzone_px * config.net.reconcile_deadzone_px;
  // Буфер интерполяции: чужие сущности показываем на interp_delay позже, чем они
  // приехали. Это и есть запас, который съедает дрожание доставки.
  const interpDelay = config.net.interp_delay_ms / 1000;
  // Дальше этого предела вперёд не экстраполируем: сеть моргнула — сущность
  // замирает, а не улетает. Деградация, а не лаг (CLAUDE.md §4).
  const interpMaxExtra = config.net.interp_max_extrapolate_ms / 1000;
  // За сколько секунд гаснет ВИДИМЫЙ остаток расхождения после пересборки
  // предсказания. Симуляция к этому моменту уже стоит на авторитетной позиции;
  // это чисто косметика, чтобы редкие поправки не выглядели рывком.
  const SMOOTH_TIME = config.net.smooth_time;

  // Мир глазами клиента. Ровно та же форма, что у state в sim/run.js, чтобы
  // рендер и HUD не знали, кто мы — хост или клиент.
  const state = {
    wave: 1, phase: 'intro', phaseTime: 0, time: 0, paused: false,
    players: [], pot: 0, kills: 0, score: 0, bosses: 0, win: false,
    shopOpen: false, bossUid: -1,
  };
  // Пул отображаемых врагов: интерполируем между снапшотами.
  //
  // Две выборки (a → b) со штампом ВРЕМЕНИ ПРИХОДА, а не «предыдущая и целевая
  // за один период»: снапшоты приезжают неровно, и раньше клиент тянулся к самому
  // свежему ровно за snapPeriod. Опоздавший снапшот означал, что сущность доехала
  // до цели и замерла, а потом прыгнула; пришедший раньше срока — скачок скорости.
  const SAMPLES = config.net.interp_samples;
  const makeTrack = () => ({
    x: new Float32Array(SAMPLES), y: new Float32Array(SAMPLES),
    t: new Float32Array(SAMPLES), n: 0, head: 0,
  });

  const enemies = { items: [], count: 0 };
  for (let i = 0; i < config.net.max_entities_per_snapshot; i++) {
    enemies.items.push({
      uid: 0, type: null, cfg: null, sprite: 0, dir: 0, animT: 0,
      x: 0, y: 0, hpPct: 1, vx: 0, vy: 0, alive: true, moving: false, telegraph: false,
      track: makeTrack(),
    });
  }
  // Результат выборки: один объект на модуль, чтобы не мусорить на кадр
  const at = { x: 0, y: 0 };

  // uid → слот в enemies.items. Раньше враг из снапшота ложился в слот с тем же
  // НОМЕРОМ, под которым приехал, а «тот ли это враг» решалось сравнением uid.
  // Но пул на хосте делает swap-remove при смерти, а отбор видимых сортирует их
  // по дистанции до зрителя — порядок перетасовывается каждый снапшот, сравнение
  // почти всегда ложно, и вместо интерполяции враг ЖЁСТКО переставлялся.
  //
  // Таблица прямого доступа: uid на проводе 16-битный, так что 65536 записей
  // накрывают всё пространство ключей. 256 КБ выделяются один раз при создании
  // клиента — это не горячая аллокация.
  const slotOf = new Int32Array(65536).fill(-1);
  const seenStamp = new Int32Array(config.net.max_entities_per_snapshot);
  let stamp = 0;

  const stats = { bytesIn: 0, kbs: 0, snaps: 0, lastSeq: -1, lost: 0 };
  // Счётчики для приёмки коопа: без снарядов и замахов клиент видит немой бой
  let projSeen = 0;
  let swingSeen = 0;
  let window = 0;
  let windowBytes = 0;
  // Монотонные часы клиента: ими штампуются приходящие выборки, по ним же идёт
  // воспроизведение. Ни Date.now(), ни времени хоста — прогон должен быть
  // детерминированным, а рассинхрону часов взяться неоткуда.
  let netTime = 0;
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
        x: 0, y: 0,
        // Кольцо выборок со штампом прихода — то же, что у врагов
        track: makeTrack(), seeded: false,
        vx: 0, vy: 0, dir: 0, animT: 0, moving: false,
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
        swingId: null, swingAngle: 0, swingT: 0,
        swingLen: config.render.weapon_swing_default,
      });
    }
  }

  // Замах соседа или его турели. Слот — тот же объект, что у хоста, поэтому
  // рендер не различает, чей удар рисует (main.js drawWeapons).
  function applySwing(dec) {
    for (let i = 0; i < dec.count; i++) {
      const s = dec.items[i];
      const id = weapons.toId[s.weapon];
      if (!id) continue;
      const cfg = config.weapons[id];
      const len = (cfg && cfg.shape.anim_time) || config.render.weapon_swing_default;
      let slot = null;
      if (s.kind === SWING_TURRET) {
        const t = s.idx < turrets.count ? turrets.items[s.idx] : null;
        if (t) slot = t.slots[0];
      } else {
        const p = state.players[s.idx];
        if (!p) continue;
        // У игрока бьёт конкретный слот — ищем его по оружию. Номер слота по сети
        // не едет намеренно: индекс оружия самодостаточен, а лоадаут соседа
        // клиент и так знает из надёжного сообщения.
        for (let k = 0; k < p.slots.length; k++) {
          if (p.slots[k].id === id) { slot = p.slots[k]; break; }
        }
        // Пульс кладём и в игрока: пока лоадаут не доехал, слотов ещё нет,
        // а замах показать уже надо.
        p.swingId = id;
        p.swingAngle = s.angle;
        p.swingLen = len;
        p.swingT = len;
      }
      swingSeen++;
      if (!slot) continue;
      slot.lastAngle = s.angle;
      slot.swingLen = len;
      slot.swingT = len;
      slot.flash = config.render.weapon_flash_time;
      // Кулдаун приблизительный: паспортный из конфига, без attack_speed_pct.
      // Он рисует только кольцо готовности в HUD и ни на что не влияет.
      slot.cd = cfg ? cfg.cooldown : 0;
    }
  }

  function applyTurrets(dec) {
    turrets.count = Math.min(dec.count, turrets.items.length);
    for (let i = 0; i < turrets.count; i++) {
      const src = dec.items[i];
      const t = turrets.items[i];
      t.x = src.x;
      t.y = src.y;
      t.owner = src.owner;
      const id = weapons.toId[src.weapon] || null;
      if (t.id !== id) {
        t.id = id;
        t.cfg = id ? config.weapons[id] : null;
        const slot = t.slots[0];
        slot.id = id;
        slot.cfg = t.cfg;
        slot.cd = 0;
        slot.swingT = 0;
        slot.flash = 0;
        slot.lastAngle = 0;
      }
    }
  }

  // Кучки сопоставляются ПО uid, а не по номеру записи в пакете.
  //
  // Пул праха на хосте делает swap-remove при каждом подборе, а в пакет кучки
  // отбираются по радиусу видимости конкретного клиента — порядок меняется
  // постоянно. Пока клиент верил номеру записи, слот i от пакета к пакету
  // означал разные кучки, и плавный доезд до «своей» цели превращал это в прах,
  // скачущий по всей карте.
  function applyPickups(dec) {
    pickupStamp++;
    for (let i = 0; i < dec.count && i < pickups.items.length; i++) {
      const src = dec.items[i];
      let slot = -1;
      for (let k = 0; k < pickups.count; k++) {
        if (pickups.items[k].uid === src.uid) { slot = k; break; }
      }
      if (slot < 0) {
        if (pickups.count >= pickups.items.length) continue;   // деградация, не рост
        slot = pickups.count++;
        const fresh = pickups.items[slot];
        fresh.uid = src.uid;
        // Новую кучку ставим сразу: тянуть её через полэкрана от чужого места
        // было бы хуже любого прыжка.
        fresh.x = src.x;
        fresh.y = src.y;
      }
      const p = pickups.items[slot];
      // Прах едет на 10 Гц: лёжа на полу он неподвижен, но подхваченный магнитом
      // летит к игроку, и на такой частоте это выглядело бы прыжками по 8 пикселей.
      p.tx = src.x;
      p.ty = src.y;
      p.tier = src.tier;
      pickupSeen[slot] = pickupStamp;
    }
    // Чего не было в пакете — подобрано или ушло за горизонт. Сверху вниз со
    // swap-remove: порядок кучек ни на что не влияет.
    for (let i = pickups.count - 1; i >= 0; i--) {
      if (pickupSeen[i] === pickupStamp) continue;
      const last = pickups.count - 1;
      if (i !== last) {
        const tmp = pickups.items[i];
        pickups.items[i] = pickups.items[last];
        pickups.items[last] = tmp;
        pickupSeen[i] = pickupSeen[last];
      }
      pickups.count--;
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
    if (kind === MSG_SWING) {
      const sw = swingCodec.decode(payload);
      if (sw) {
        applySwing(sw);
        stats.bytesIn += byteLength(payload);
        windowBytes += byteLength(payload);
      }
      return;
    }
    if (kind === MSG_PICKUP) {
      const pk = pickupCodec.decode(payload);
      if (pk) {
        applyPickups(pk);
        stats.bytesIn += byteLength(payload);
        windowBytes += byteLength(payload);
      }
      return;
    }
    if (kind === MSG_TURRET) {
      const tr = turretCodec.decode(payload);
      if (tr) {
        applyTurrets(tr);
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
      if (!p.seeded) {
        // Первая выборка: интерполировать не от чего, ставим сразу в присланную
        // точку и подпираем её выборкой в прошлом, чтобы кольцо не было пустым.
        p.seeded = true;
        pushSample(p.track, src.x, src.y, netTime - interpDelay);
        p.x = src.x;
        p.y = src.y;
      }
      pushSample(p.track, src.x, src.y, netTime);
      p.dir = src.dir;
      p.moving = src.moving;
      p.alive = src.alive;
      p.level = src.level;
      p.pendingLevels = src.pendingLevels || 0;
      // maxHp приходит надёжным сообщением о лоадауте; в снапшоте едет только доля,
      // поэтому HUD показывает настоящие числа, а не проценты от выдуманной сотни.
      p.hp = src.hpPct * p.maxHp;
      p.ash = src.ash;
      p.xp = src.xpPct;
      p.xpNext = 1;
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
      }
    }

    // Враги: слот ищем по uid, а не по номеру записи в снапшоте (см. slotOf)
    stamp++;
    for (let k = 0; k < dec.enemyCount; k++) {
      const src = dec.enemies[k];
      let idx = slotOf[src.uid];
      if (idx < 0 || idx >= enemies.count || enemies.items[idx].uid !== src.uid) {
        // Новичок. Интерполировать не от чего — ставим сразу в присланную точку,
        // обе выборки одинаковые.
        if (enemies.count >= enemies.items.length) continue;   // деградация, не рост
        idx = enemies.count++;
        const e0 = enemies.items[idx];
        e0.uid = src.uid;
        e0.type = null;                       // заставим пересчитать cfg ниже
        slotOf[src.uid] = idx;
        e0.track.n = 0;
        e0.track.head = 0;
        // Подпираем выборкой в прошлом: кольцо не должно быть пустым, а
        // интерполировать новичка не от чего.
        pushSample(e0.track, src.x, src.y, netTime - interpDelay);
        e0.x = src.x;
        e0.y = src.y;
      }
      pushSample(enemies.items[idx].track, src.x, src.y, netTime);

      const e = enemies.items[idx];
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
      // Искры по ПАДЕНИЮ доли HP. Урона в снапшоте нет и быть не должно, но
      // упавший hpPct означает, что по врагу попали — этого хватает, чтобы у
      // клиента бой перестал быть немым, и это не стоит ни байта.
      if (onImpact && src.hpPct < e.hpPct) onImpact(e.x, e.y, false);
      e.hpPct = src.hpPct;
      e.moving = src.moving;
      e.telegraph = src.telegraph;
      e.alive = true;
      seenStamp[idx] = stamp;
    }

    // Кого в этом снапшоте не было — того больше нет в поле зрения. Сверху вниз
    // со swap-remove: индекс, куда переезжает уцелевший, чинится в таблице.
    for (let i = enemies.count - 1; i >= 0; i--) {
      if (seenStamp[i] === stamp) continue;
      slotOf[enemies.items[i].uid] = -1;
      const last = enemies.count - 1;
      if (i !== last) {
        const tmp = enemies.items[i];
        enemies.items[i] = enemies.items[last];
        enemies.items[last] = tmp;
        slotOf[enemies.items[i].uid] = i;
        seenStamp[i] = seenStamp[last];
      }
      enemies.count--;
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

  // Положить выборку в кольцо сущности.
  function pushSample(tr, x, y, t) {
    const cap = tr.x.length;
    tr.head = (tr.head + 1) % cap;
    tr.x[tr.head] = x;
    tr.y[tr.head] = y;
    tr.t[tr.head] = t;
    if (tr.n < cap) tr.n++;
  }

  // Позиция сущности на момент renderTime, в out. Идём от новейшей выборки назад
  // и ищем отрезок, накрывающий это время.
  //
  // Кольца, а не пары выборок: время воспроизведения отстаёт на interp_delay,
  // и при задержке больше периода снапшота пара всегда оказывается СВЕЖЕЕ
  // нужного момента — сущность залипала бы на старой точке и прыгала на каждом
  // снапшоте, то есть ровно тот стук, ради которого буфер и заводится.
  //
  // За новейшей выборкой разрешена экстраполяция (снапшот задержался — сущность
  // продолжает ехать), но не дальше interp_max_extrapolate: после него она
  // встаёт. Улететь в бесконечность на оборванной связи она не должна —
  // деградация, а не лаг (CLAUDE.md §4).
  function trackAt(tr, renderTime, out) {
    if (tr.n === 0) return false;
    const cap = tr.x.length;
    let iNew = tr.head;
    if (tr.n === 1) {
      out.x = tr.x[iNew];
      out.y = tr.y[iNew];
      return true;
    }
    for (let k = 0; k < tr.n - 1; k++) {
      const iOld = (iNew - 1 + cap) % cap;
      if (tr.t[iOld] <= renderTime) {
        const span = tr.t[iNew] - tr.t[iOld];
        let f = span > 0 ? (renderTime - tr.t[iOld]) / span : 1;
        if (f > 1) {
          const max = 1 + interpMaxExtra / span;
          if (f > max) f = max;
        }
        out.x = tr.x[iOld] + (tr.x[iNew] - tr.x[iOld]) * f;
        out.y = tr.y[iOld] + (tr.y[iNew] - tr.y[iOld]) * f;
        return true;
      }
      iNew = iOld;
    }
    // Время старше всего кольца: держим самую старую выборку, а не выдумываем
    out.x = tr.x[iNew];
    out.y = tr.y[iNew];
    return true;
  }

  // Локальное предсказание своего движения + интерполяция всего остального
  function step(dt, input, moveSpeed) {
    state.time += dt;
    netTime += dt;
    window += dt;

    // Хост снимает по одному пакету за тик симуляции, поэтому слать надо столько
    // же. Одно вычитание за кадр означало, что просевший ниже 60 fps клиент
    // отправляет меньше, чем хост снимает, и НАВСЕГДА голодит его очередь: ack
    // перестаёт двигаться, переигровка растёт. Досылаем, но не больше
    // input_catchup_max за кадр — иначе возврат на вкладку выстрелит пачкой.
    inputAcc += dt;
    let sent = 0;
    while (inputAcc >= inputPeriod && sent < inputCatchup) {
      inputAcc -= inputPeriod;
      sent++;
      seq = (seq + 1) & 0xffff;
      // Квантуем ДО отправки и предсказываем тем же числом, что уедет по сети
      heldIx = quantize(input.x);
      heldIy = quantize(input.y);
      transport.send(CH.INPUT, inputCodec.encode(myIndex, seq, heldIx, heldIy, 0).slice(0));
    }
    // Если упёрлись в кап, копить остаток бессмысленно: он превратится в вечный
    // долг и будет выстреливать пачками каждый следующий кадр.
    if (inputAcc >= inputPeriod) inputAcc = 0;

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
    // Прах доезжает до присланной точки за то же время, что и остальная
    // интерполяция: канал редкий, но рывков на экране быть не должно.
    const pk = interpDelay > 0 ? Math.min(1, dt / interpDelay) : 1;
    for (let i = 0; i < pickups.count; i++) {
      const p = pickups.items[i];
      p.x += (p.tx - p.x) * pk;
      p.y += (p.ty - p.y) * pk;
    }

    // Турели: тот же слот и те же таймеры, только хозяин не двигается
    for (let i = 0; i < turrets.count; i++) {
      const slot = turrets.items[i].slots[0];
      if (slot.cd > 0) slot.cd -= dt;
      if (slot.flash > 0) slot.flash -= dt;
      if (slot.swingT > 0) slot.swingT -= dt;
    }

    // Время воспроизведения: показываем чужих на interp_delay позже, чем они
    // приехали. Отдельных «часов, догоняющих хост» не нужно — выборки штампуются
    // теми же локальными часами, так что расходиться нечему.
    const renderTime = netTime - interpDelay;
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
      } else if (p.seeded && trackAt(p.track, renderTime, at)) {
        if (at.x !== p.x || at.y !== p.y) p.animT += dt;
        p.x = at.x;
        p.y = at.y;
      }
    }

    for (let e2 = 0; e2 < enemies.count; e2++) {
      const e = enemies.items[e2];
      if (!trackAt(e.track, renderTime, at)) continue;
      const nx = at.x;
      const ny = at.y;
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
    state, enemies, projectiles, pickups, turrets, step, stats, close, applyLoadout,
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
