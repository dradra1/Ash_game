// Точка входа: конфиг → профиль → экраны → соло или кооп.
//
// Соло и кооп идут ОДНИМ путём: соло — это комната из одного игрока через
// LocalTransport, кооп — та же симуляция у хоста через SocketTransport.
// Отдельной ветки «одиночный режим» не существует (CLAUDE.md §2).

import { createLoop } from './engine/loop.js';
import { createInput } from './engine/input.js';
import { createRenderer } from './engine/render.js';
import { createLocalTransport, createSocketTransport, CH } from './net/transport.js';
import { createRun, PHASE_OVER, PHASE_SHOP } from './sim/run.js';
import { createHost } from './net/host.js';
import { createNetClient } from './net/client.js';
import { createLobby, roomFromUrl } from './net/lobby.js';
import { applyLevelChoice } from './sim/player.js';
import { createHud } from './ui/hud.js';
import { createTooltip } from './ui/tooltip.js';
import { createLevelUpUi } from './ui/levelup_ui.js';
import { createShopUi } from './ui/shop_ui.js';
import { localAdapter, remoteAdapter } from './ui/shop_adapter.js';
import { createLobbyUi } from './ui/lobby_ui.js';
import { createMetaUi } from './ui/meta_ui.js';
import { createResultUi } from './ui/result_ui.js';
import { createParticles } from './engine/particles.js';
import { createAudio } from './engine/audio.js';
import { createDebug } from './ui/debug.js';
import { createScreens } from './ui/screens.js';

function firstKey(obj) {
  for (const k in obj) return k;
  return null;
}

async function fetchJson(url, options) {
  const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, options));
  if (!res.ok) throw new Error(url + ' → ' + res.status);
  return res.json();
}

async function boot() {
  const config = await fetchJson('/api/config');
  let profile = null;
  try {
    profile = await fetchJson('/api/profile');
  } catch (e) {
    // без профиля играть всё равно можно
  }

  const dict = (config.i18n && config.i18n.ru) || {};
  const t = (key) => (dict[key] !== undefined ? dict[key] : key);

  const doc = globalThis.document;
  let canvas = doc.getElementById('game');
  if (!canvas) {
    canvas = doc.createElement('canvas');
    canvas.id = 'game';
    doc.body.appendChild(canvas);
  }
  const uiRoot = doc.getElementById('ui') || doc.body;

  const bootInfo = globalThis.__BOOT__ || {};
  const playerName = bootInfo.name || (profile && profile.name) || 'player';
  // Открытое метапрогрессией оружие: пул лавки ограничен им
  const unlockedWeapons = (profile && profile.unlocks && profile.unlocks.weapon) || [];

  const screens = createScreens(uiRoot, config, t);
  const hud = createHud(config, t);
  const tip = createTooltip(uiRoot);
  const levelUi = createLevelUpUi(uiRoot, config, t);
  const shopUi = createShopUi(uiRoot, config, t, tip);
  const lobbyUi = createLobbyUi(uiRoot, config, t);
  const resultUi = createResultUi(uiRoot, config, t);
  const audio = createAudio(config);
  const particles = createParticles(config);
  // Звук нельзя запустить до жеста пользователя — цепляем на первый же
  doc.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  doc.addEventListener('keydown', () => audio.unlock(), { once: true });
  const metaUi = createMetaUi(uiRoot, config, t, {
    profile: () => fetchJson('/api/profile'),
    async unlock(kind, id) {
      try {
        return await fetchJson('/api/meta/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, id }),
        });
      } catch (e) {
        // fetchJson бросает на не-2xx; вытаскиваем код ошибки из тела
        const res = await fetch('/api/meta/unlock', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, id }),
        });
        return res.json().catch(() => ({ error: 'unknown' }));
      }
    },
  });

  // --- состояние сессии ----------------------------------------------------
  let transport = null;
  let run = null;            // авторитетная симуляция (у хоста и в соло)
  let netClient = null;      // приём снапшотов (у не-хоста)
  let hostNet = null;        // рассылка снапшотов (у хоста в коопе)
  let renderer = null;
  let input = null;
  let loop = null;
  let debug = null;
  let lobby = null;
  let socket = null;
  let arenaId = null;
  let runId = null;
  let finished = false;
  let myIndex = 0;

  const inputPayload = { id: 0, x: 0, y: 0 };
  const debugExtra = { entities: 0, kbs: 0, ping: 0, seed: 0, role: '' };
  const ashColor = config.render.ash_color;
  const ashSize = config.render.ash_size;
  const animFps = config.render.anim_fps;
  const WALK = '_walk';

  let shopSnap = null;       // последний снимок лавки, присланный хостом
  let remoteShop = null;     // адаптер лавки клиента

  const isHost = () => !netClient;
  const world = () => (netClient ? netClient.state : run.state);

  function myPlayer() {
    const players = world().players;
    return players[myIndex] || players[0];
  }

  // --- цикл ---------------------------------------------------------------
  function update(dt) {
    if (input.consumePressed('F3')) debug.toggle();

    if (netClient) {
      // Не-хост: шлём ввод, крутим интерполяцию и предсказание своего движения
      const me = myPlayer();
      netClient.step(dt, input.move, (me && me.speed) || config.player.move_speed);

      // Лавка клиента приходит снимком от хоста; действия уезжают обратно
      if (netClient.state.phase === PHASE_SHOP && remoteShop) {
        if (!shopUi.visible) shopUi.show(remoteShop);
      } else if (shopUi.visible) {
        shopUi.hide();
      }
      return;
    }

    const paused = maybeLevelUp();
    if (run.state.phase === PHASE_SHOP) {
      if (!shopUi.visible) {
        const me = myPlayer();
        shopUi.show(localAdapter(run, me, run.shopFor(me.id), config,
          () => run.readyUp(me.id)));
      }
      if (!run.coop) return;         // в соло мир стоит, пока игрок закупается
    } else if (shopUi.visible) {
      shopUi.hide();
    }
    if (paused) return;

    const me = myPlayer();
    inputPayload.id = me.id;
    inputPayload.x = input.move.x;
    inputPayload.y = input.move.y;
    if (hostNet) {
      // Хост в коопе: свой ввод применяется напрямую. Отправлять его в сокет —
      // значит вернуть себе же собственный пакет, причём объектом, который
      // бинарный декодер входа принять не может.
      run.applyInput(me.id, inputPayload);
    } else {
      transport.send(CH.INPUT, inputPayload);
    }
    run.step(dt);
    drainEvents();
    particles.step(dt);
    if (hostNet) hostNet.step(dt);

    if (run.state.phase === PHASE_OVER && !finished) {
      finished = true;
      levelUi.hide();
      shopUi.hide();
      audio.play(run.state.win ? 'levelup' : 'death');
      loop.stop();
      reportRun().then((award) => {
        resultUi.show(run.state, award, {
          onAgain: () => { resultUi.hide(); startSolo(); },
          onBack: () => { resultUi.hide(); showMenu(); },
        });
      });
    }
  }

  // События симуляции превращаются в звук и партиклы. Очередь разбирается
  // здесь, а не в sim: симуляция не должна знать ни про звук, ни про экран.
  function drainEvents() {
    const evs = run.events;
    if (!evs.length) return;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.type === 'wave_start') audio.play('wave');
      else if (e.type === 'boss_spawn') audio.play('boss');
      else if (e.type === 'player_down') audio.play('death');
      else if (e.type === 'shop_open') audio.play('buy');
    }
    if (!hostNet) evs.length = 0;   // у хоста очередь забирает host.js
  }

  // В соло левелап ставит игру на паузу, в коопе — нет (ТЗ §5)
  function maybeLevelUp() {
    const me = myPlayer();
    if (!me || me.pendingLevels <= 0) {
      if (levelUi.visible) levelUi.hide();
      return false;
    }
    if (!levelUi.visible) {
      const choices = run.levelUp.roll(me, run.rng);
      levelUi.show(me, choices, (idx) => {
        applyLevelChoice(me, config, choices[idx]);
        levelUi.hide();
      });
    }
    return !run.coop;
  }

  function render() {
    const st = world();
    const me = myPlayer();
    if (!me) return;
    renderer.follow(me.x, me.y, config.sim.dt);
    renderer.begin();
    renderer.drawArena(config.arenas[arenaId]);

    // Прах виден только у хоста: подборы в снапшот не входят — их десятки в кадре,
    // а решает не их вид, а общий котёл, который клиент видит в HUD.
    if (run) {
      const pickups = run.pickupPool;
      for (let i = 0; i < pickups.count; i++) {
        const p = pickups.items[i];
        renderer.drawDot(p.x, p.y, ashSize / 2, ashColor);
      }
    }

    const pool = netClient ? netClient.enemies : run.enemyPool;
    for (let i = 0; i < pool.count; i++) {
      const e = pool.items[i];
      if (!e.cfg) continue;
      const moving = netClient ? true : (e.vx !== 0 || e.vy !== 0);
      renderer.drawEntity(e.cfg.texture, e.dir, (e.animT * animFps) | 0,
        e.x, e.y, e.sprite, e.cfg.color, moving ? e.cfg.texture + WALK : null);
    }

    const players = st.players;
    const fallbackChar = firstKey(config.characters);
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p.alive) continue;
      const chCfg = config.characters[p.character] || config.characters[fallbackChar];
      const size = chCfg.sprite || config.render.sprite_default;
      if (config.render.player_ring) {
        renderer.drawRing(p.x, p.y, size * 0.3, chCfg.color, config.render.player_ring_width);
      }
      const moving = p.vx !== 0 || p.vy !== 0;
      renderer.drawEntity(chCfg.texture, p.dir, (p.animT * animFps) | 0,
        p.x, p.y, size, chCfg.color, moving ? chCfg.texture + WALK : null);
      if (config.render.nameplate && players.length > 1) {
        renderer.drawText(p.name || '', p.x, p.y - config.render.nameplate_offset,
          chCfg.color, 'center');
      }
    }

    particles.draw(renderer.ctx);

    if (run) {
      const projs = run.projPool;
      for (let i = 0; i < projs.count; i++) {
        const pr = projs.items[i];
        const r = Math.max(config.render.projectile_size_min, pr.size);
        renderer.drawDot(pr.x, pr.y, r, pr.color || ashColor);
      }
    }

    renderer.end();
    hud.draw(renderer.ctx, netClient || run, me, renderer.view);

    if (debug.visible) {
      if (run) {
        debugExtra.entities = run.refreshStats().entities;
      } else {
        debugExtra.entities = netClient.enemies.count + st.players.length;
      }
      debugExtra.kbs = netClient ? netClient.stats.kbs : (hostNet ? hostNet.stats.kbs : 0);
      debugExtra.ping = transport.ping || 0;
      debugExtra.role = isHost() ? 'host' : 'client';
      debug.draw(renderer.ctx, debugExtra);
    }
  }

  async function reportRun() {
    const st = run ? run.state : world();
    try {
      return await fetchJson('/api/run/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: runId, wave: st.wave, win: st.win, bosses: st.bosses || 0,
          time_sec: st.time || 0, kills: st.kills || 0, score: st.score || 0,
        }),
      });
    } catch (e) {
      return { relics_gained: 0, achievements: [] };   // итог не ушёл, забег закончен
    }
  }

  function bootEngine(arenaSize) {
    renderer = createRenderer(canvas, config, arenaSize);
    input = createInput(canvas, config);
    loop = createLoop({
      dt: config.sim.dt,
      maxCatchup: config.sim.max_catchup_steps,
      update,
      render,
    });
    debug = createDebug(loop, transport);
    particles.clear();
    // Хуки для браузерной проверки (tools/smoke.py, tools/coop_test.py)
    globalThis.__RUN__ = run || { state: netClient.state };
    globalThis.__NET__ = netClient || hostNet;
    globalThis.__LOOP__ = loop;
    screens.show('game');
    loop.start();
  }

  // --- соло ---------------------------------------------------------------
  async function startSolo() {
    const character = firstKey(config.characters);
    arenaId = firstKey(config.arenas);
    const danger = config.danger[0].id;
    let data;
    try {
      data = await fetchJson('/api/run/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character, arena: arenaId, danger }),
      });
    } catch (e) {
      return;
    }
    runId = data.run_id;
    finished = false;
    myIndex = 0;

    transport = createLocalTransport();
    run = createRun({
      config, seed: data.seed, transport,
      players: [{ id: transport.id, name: playerName, character }],
      arena: arenaId, danger, unlocked: unlockedWeapons,
    });
    debugExtra.seed = data.seed;
    bootEngine([run.arenaW, run.arenaH]);
  }

  // --- кооп ---------------------------------------------------------------
  function ensureSocket() {
    if (socket) return socket;
    socket = globalThis.io({ transports: ['websocket', 'polling'] });
    lobby = createLobby(socket);
    lobby.on((kind, data) => {
      if (kind === 'state') {
        if (lobbyUi.visible) lobbyUi.refresh();
      } else if (kind === 'start') {
        startCoopRun(data);
      }
    });
    globalThis.setInterval(() => {
      if (lobby) lobby.ping().then((ms) => { if (transport) transport.ping = ms; });
    }, PING_INTERVAL_MS);
    return socket;
  }

  async function coopCreate() {
    ensureSocket();
    const res = await lobby.create(firstKey(config.characters));
    if (res.ok) lobbyUi.show(lobby);
    return res;
  }

  async function coopJoin(code) {
    ensureSocket();
    const res = await lobby.join(code, firstKey(config.characters));
    if (res.ok) lobbyUi.show(lobby);
    return res;
  }

  function startCoopRun(msg) {
    const room = lobby.room;
    if (!room || !msg) return;
    lobbyUi.hide();
    runId = msg.run_id;
    finished = false;
    myIndex = lobby.you;
    arenaId = room.arena || firstKey(config.arenas);
    const danger = room.danger || 0;
    const hostFlag = lobby.isHost;
    const fallbackChar = firstKey(config.characters);

    transport = createSocketTransport(socket, { isHost: hostFlag, id: myIndex });
    debugExtra.seed = msg.seed;

    if (hostFlag) {
      const players = room.players.map((p, i) => ({
        id: i, name: p.name, character: p.character || fallbackChar,
      }));
      run = createRun({ config, seed: msg.seed, transport, players,
        arena: arenaId, danger, unlocked: unlockedWeapons });
      hostNet = createHost(run, transport, config);
      bootEngine([run.arenaW, run.arenaH]);
    } else {
      netClient = createNetClient(transport, config, myIndex);
      // Хост присылает снимок лавки адресно; действия уходят обратно событием
      transport.on(CH.EVENT, (msg) => {
        if (msg && msg.t === 'shop' && msg.p === myIndex) {
          shopSnap = msg.snap;
          if (shopUi.visible) shopUi.refresh();
        }
      });
      remoteShop = remoteAdapter(() => shopSnap, (kind, a) => {
        transport.send(CH.EVENT, { t: 'shop_act', p: myIndex, kind, a });
      });
      // Клиенту нужен тот же размер арены, что посчитал хост
      const scale = 1 + config.coop.arena_per_player * (room.players.length - 1);
      const w = Math.round(config.arena.size[0] * scale);
      const h = Math.round(config.arena.size[1] * scale);
      bootEngine([w, h]);
      // Имена и персонажи приходят из лобби: гонять их в снапшоте 20 раз в
      // секунду незачем, они не меняются за забег.
      const sync = () => {
        const ps = netClient.state.players;
        for (let i = 0; i < room.players.length; i++) {
          if (!ps[i]) continue;
          ps[i].name = room.players[i].name;
          ps[i].character = room.players[i].character || fallbackChar;
          ps[i].speed = config.player.move_speed;
        }
      };
      sync();
      globalThis.setInterval(sync, 1000);
    }
  }

  globalThis.addEventListener('resize', () => {
    if (renderer) renderer.resize();
  });

  // Ссылка-приглашение сразу открывает лобби нужной комнаты
  const invited = roomFromUrl();
  function showMenu() {
    screens.show('menu', {
      onPlay: startSolo,
      onCoop: coopCreate,
      onJoin: coopJoin,
      onMeta: () => metaUi.show(showMenu),
      invited,
    });
  }
  showMenu();
  if (invited) coopJoin(invited);

  // Для сквозного кооп-теста: открыть комнату и войти в неё программно
  globalThis.__COOP__ = { create: coopCreate, join: coopJoin, get lobby() { return lobby; } };
}

const PING_INTERVAL_MS = 2000;

boot();
