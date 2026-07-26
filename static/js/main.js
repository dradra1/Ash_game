// Точка входа: конфиг → профиль → экраны → соло или кооп.
//
// Соло и кооп идут ОДНИМ путём: соло — это комната из одного игрока через
// LocalTransport, кооп — та же симуляция у хоста через SocketTransport.
// Отдельной ветки «одиночный режим» не существует (CLAUDE.md §2).

import { createLoop } from './engine/loop.js';
import { createInput } from './engine/input.js';
import { createRenderer } from './engine/render.js';
import { createLocalTransport, createSocketTransport, CH } from './net/transport.js';
import { createRun, PHASE_OVER, PHASE_SHOP, PHASE_LEVELUP } from './sim/run.js';
import { buildArenaLayout, createPropIndex } from './sim/arena.js';
import { swingPose, trailAlpha, makePose } from './engine/weapon_anim.js';
import { createHost } from './net/host.js';
import { createNetClient } from './net/client.js';
import { createLobby, roomFromUrl } from './net/lobby.js';
import { createHud } from './ui/hud.js';
import { createTooltip } from './ui/tooltip.js';
import { createLevelUpUi } from './ui/levelup_ui.js';
import { createShopUi } from './ui/shop_ui.js';
import { localAdapter, remoteAdapter } from './ui/shop_adapter.js';
import { createLobbyUi } from './ui/lobby_ui.js';
import { createSetupUi } from './ui/setup_ui.js';
import { createMetaUi } from './ui/meta_ui.js';
import { createResultUi } from './ui/result_ui.js';
import { createPauseUi } from './ui/pause_ui.js';
import { createAdminUi } from './ui/admin_ui.js';
import { createParticles } from './engine/particles.js';
import { createRng } from './engine/rng.js';
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
  const isAdmin = !!bootInfo.admin;
  const unlockedWeapons = (profile && profile.unlocks && profile.unlocks.weapon) || [];

  const screens = createScreens(uiRoot, config, t);
  const hud = createHud(config, t);
  const tip = createTooltip(uiRoot);
  const levelUi = createLevelUpUi(uiRoot, config, t);
  const shopUi = createShopUi(uiRoot, config, t, tip);
  const lobbyUi = createLobbyUi(uiRoot, config, t);
  const setupUi = createSetupUi(uiRoot, config, t);
  const resultUi = createResultUi(uiRoot, config, t);
  const pauseUi = createPauseUi(uiRoot, config, t);
  const audio = createAudio(config);
  const particles = createParticles(config);
  // Отдельный ГПСЧ для косметики. Тянуть искры из rng забега нельзя: тогда забег
  // в браузере и тот же сид в tools/playtest.js разошлись бы, а сервер валидирует
  // результат именно по сиду.
  const fxRng = createRng(FX_SEED);

  // Искры в точке попадания. Один колбэк на все источники урона: его дёргает
  // damageEnemy, а симуляция про партиклы по-прежнему ничего не знает.
  function onImpact(x, y, crit) {
    const fx = config.render.impact;
    particles.burst(x, y, crit ? fx.count_crit : fx.count, crit ? fx.color_crit : fx.color,
      fxRng, fx.speed, fx.life, fx.size);
  }
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
        const res = await fetch('/api/meta/unlock', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, id }),
        });
        return res.json().catch(() => ({ error: 'unknown' }));
      }
    },
  });
  const adminUi = isAdmin ? createAdminUi(uiRoot, config, t, {
    async load() { return fetchJson('/api/admin/config'); },
    async save(section, data) {
      return fetchJson('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, data }),
      });
    },
  }) : null;

  // --- состояние сессии ----------------------------------------------------
  let transport = null;
  let run = null;
  let netClient = null;
  let hostNet = null;
  let renderer = null;
  let input = null;
  let loop = null;
  let debug = null;
  let lobby = null;
  let socket = null;
  let arenaId = null;
  let arenaLayout = null;
  const pose = makePose();       // одна на весь рендер: поза считается десятки раз за кадр
  let runId = null;
  let finished = false;
  let myIndex = 0;
  let remoteLevelChoices = null;
  let godOn = false;
  let lastSetup = null;

  const inputPayload = { id: 0, x: 0, y: 0 };
  const debugExtra = { entities: 0, kbs: 0, ping: 0, seed: 0, role: '' };
  const ashColor = config.render.ash_color;
  const ashSize = config.render.ash_size;
  const animFps = config.render.anim_fps;
  const projScale = config.render.projectile_scale;
  const WALK = '_walk';

  let shopSnap = null;
  let remoteShop = null;

  const isHost = () => !netClient;
  const world = () => (netClient ? netClient.state : run.state);

  function myPlayer() {
    const players = world().players;
    return players[myIndex] || players[0];
  }

  function teardownRun() {
    if (loop) { try { loop.stop(); } catch (e) { /* */ } }
    if (hostNet) { try { hostNet.close(); } catch (e) { /* */ } }
    if (netClient) { try { netClient.close(); } catch (e) { /* */ } }
    if (input) { try { input.destroy(); } catch (e) { /* */ } }
    levelUi.hide();
    shopUi.hide();
    pauseUi.hide();
    resultUi.hide();
    run = null;
    hostNet = null;
    netClient = null;
    remoteLevelChoices = null;
    shopSnap = null;
    arenaLayout = null;
    finished = false;
    godOn = false;
  }

  function leaveToMenu() {
    teardownRun();
    if (lobby) lobby.leave();
    transport = null;
    showMenu();
  }

  async function restartRun() {
    pauseUi.hide();
    resultUi.hide();
    if (netClient) return; // только хост
    if (lobby && lobby.room) {
      const res = await lobby.restart();
      if (res && res.error) return;
      // room:start обработает startCoopRun
      return;
    }
    teardownRun();
    await startSolo(lastSetup);
  }

  function requestPause(on) {
    if (netClient) {
      transport.send(CH.EVENT, { t: 'pause_req', on: !!on });
      return;
    }
    if (run) run.setPaused(!!on);
  }

  function openPauseMenu() {
    const host = isHost();
    if (isAdmin && host && run) {
      pauseUi.showCheats(true);
      setupCheatButtons();
    } else {
      pauseUi.showCheats(false);
    }
    pauseUi.show({
      canRestart: host,
      onResume: () => {
        pauseUi.hide();
        requestPause(false);
      },
      onRestart: () => restartRun(),
      onMenu: () => leaveToMenu(),
    });
  }

  function setupCheatButtons() {
    const root = pauseUi.cheatsRoot;
    root.innerHTML = '';
    const mk = (label, fn) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = label;
      b.addEventListener('click', fn);
      root.appendChild(b);
    };
    mk(t('ui.cheat.ash'), () => run.cheatAddAsh(100));
    mk(t('ui.cheat.level'), () => {
      const me = myPlayer();
      run.cheatLevelUp(me.id);
    });
    mk(t('ui.cheat.god'), () => {
      godOn = !godOn;
      run.cheatGodMode(myPlayer().id, godOn);
    });
    mk(t('ui.cheat.kill'), () => run.cheatKillAll());
    mk(t('ui.cheat.skip'), () => run.cheatSkipWave());
  }

  function handleEsc() {
    if (!run && !netClient) return;
    const st = world();
    if (!st || st.phase === PHASE_OVER) return;
    if (resultUi.visible) return;
    if (pauseUi.visible) {
      pauseUi.hide();
      requestPause(false);
      return;
    }
    requestPause(true);
    openPauseMenu();
  }

  // --- цикл ---------------------------------------------------------------
  function update(dt) {
    if (input) input.poll();

    if (input.consumePressed('F3')) debug.toggle();
    if (input.consumePressed('Escape')) handleEsc();
    if (isAdmin && input.consumePressed('F4') && isHost() && run) {
      if (!pauseUi.visible) {
        requestPause(true);
        openPauseMenu();
      }
    }

    // Синхронизация UI паузы с авторитетным флагом
    const st = world();
    if (st && st.paused && !pauseUi.visible && st.phase !== PHASE_OVER && !resultUi.visible) {
      openPauseMenu();
    }
    if (st && !st.paused && pauseUi.visible) {
      // Хост снял паузу удалённо — закрыть меню
      // (локальное открытие уже выставило paused)
    }

    if (netClient) {
      const me = myPlayer();
      if (!st.paused) {
        netClient.step(dt, input.move, (me && me.speed) || config.player.move_speed);
      }

      maybeClientLevelUp();
      maybeClientResult();

      if (netClient.state.phase === PHASE_SHOP && remoteShop) {
        if (!shopUi.visible) shopUi.show(remoteShop);
      } else if (shopUi.visible && netClient.state.phase !== PHASE_SHOP) {
        shopUi.hide();
      }
      if (shopUi.visible) shopUi.handleInput(input);
      return;
    }

    if (run.state.paused) {
      // Симуляция стоит, но снапшоты/события (в т.ч. pause) продолжают уходить
      if (hostNet) hostNet.step(dt);
      drainEvents();
      return;
    }

    maybeHostLevelUp();

    if (run.state.phase === PHASE_SHOP) {
      if (!shopUi.visible) {
        const me = myPlayer();
        shopUi.show(localAdapter(run, me, run.shopFor(me.id), config,
          () => run.readyUp(me.id)));
      }
      if (shopUi.visible) shopUi.handleInput(input);
      if (!run.coop) return;
    } else if (shopUi.visible) {
      shopUi.hide();
    }

    // На левелапе симуляция почти стоит (run.step сам гейтит), но phaseTime тикает
    const me = myPlayer();
    inputPayload.id = me.id;
    inputPayload.x = input.move.x;
    inputPayload.y = input.move.y;
    if (hostNet) {
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
      pauseUi.hide();
      audio.play(run.state.win ? 'levelup' : 'death');
      loop.stop();
      reportRun().then((award) => {
        resultUi.show(run.state, award, {
          canRestart: true,
          onAgain: () => restartRun(),
          onBack: () => leaveToMenu(),
        });
      });
    }
  }

  function drainEvents() {
    const evs = run.events;
    if (!evs.length) return;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.type === 'wave_start') audio.play('wave');
      else if (e.type === 'boss_spawn') audio.play('boss');
      else if (e.type === 'player_down') audio.play('death');
      else if (e.type === 'shop_open') audio.play('buy');
      else if (e.type === 'levelup_open') audio.play('levelup');
    }
    if (!hostNet) evs.length = 0;
  }

  // Левелап только в фазе LEVELUP (конец волны)
  function maybeHostLevelUp() {
    if (run.state.phase !== PHASE_LEVELUP) {
      if (levelUi.visible) levelUi.hide();
      return;
    }
    const me = myPlayer();
    if (!me || me.pendingLevels <= 0) {
      if (levelUi.visible) levelUi.hide();
      return;
    }
    if (!levelUi.visible) {
      showHostLevelChoices(me);
    }
  }

  function showHostLevelChoices(me) {
    const choices = run.choicesFor(me.id);
    if (!choices) return;
    levelUi.show(me, choices, (idx) => {
      run.applyLevelPick(me.id, idx);
      levelUi.hide();
      if (me.pendingLevels > 0 && run.state.phase === PHASE_LEVELUP) {
        showHostLevelChoices(me);
      }
    });
  }

  function maybeClientLevelUp() {
    if (netClient.state.phase !== PHASE_LEVELUP) {
      if (levelUi.visible) levelUi.hide();
      return;
    }
    const me = myPlayer();
    if (!me || me.pendingLevels <= 0 || !remoteLevelChoices) {
      if (levelUi.visible && (!me || me.pendingLevels <= 0)) levelUi.hide();
      return;
    }
    if (!levelUi.visible) {
      levelUi.show(me, remoteLevelChoices, (idx) => {
        transport.send(CH.EVENT, { t: 'levelup_act', p: myIndex, idx });
        levelUi.hide();
      });
    }
  }

  function maybeClientResult() {
    if (finished) return;
    if (netClient.state.phase !== PHASE_OVER && !netClient.lastRunOver) return;
    finished = true;
    levelUi.hide();
    shopUi.hide();
    pauseUi.hide();
    const stats = netClient.lastRunOver || {
      wave: netClient.state.wave,
      kills: netClient.state.kills,
      score: netClient.state.score,
      time: netClient.state.time,
      bosses: netClient.state.bosses,
      win: netClient.state.win,
    };
    netClient.state.win = !!stats.win;
    if (loop) loop.stop();
    audio.play(stats.win ? 'levelup' : 'death');
    // Клиент не владеет run_id хоста — реликвии начисляет хост; показываем итог без награды
    resultUi.show(Object.assign({}, netClient.state, stats), { relics_gained: 0 }, {
      canRestart: false,
      onAgain: () => { /* ждём рестарт от хоста */ },
      onBack: () => leaveToMenu(),
    });
  }

  // Оружие в руке и замах. До этого оружие в мире не рисовалось вовсе: slot.lastAngle
  // считался на каждый удар и не читался никем, а swingArc наносил урон молча.
  //
  // Спрайт оружия — один, в боковой проекции (ASSETS.md §5): позиция и поворот
  // берутся из позы, а при прицеливании влево спрайт отражается по вертикали,
  // иначе клинок висит рукоятью вперёд.
  function drawWeapons(p, size) {
    const slots = p.slots;
    if (!slots) return;                       // у кооп-клиента слотов нет
    const reach = size * config.render.weapon_reach;
    for (let s = 0; s < slots.length; s++) {
      const slot = slots[s];
      if (!slot.cfg || slot.swingT <= 0) continue;
      const w = slot.cfg;
      const k = 1 - slot.swingT / slot.swingLen;
      const half = ((w.shape.angle || 90) * Math.PI) / 360;
      swingPose(w.shape.anim, k, half, pose);

      const a = slot.lastAngle + pose.angle;
      const x = p.x + Math.cos(a) * pose.dist * reach;
      const y = p.y + Math.sin(a) * pose.dist * reach;
      const left = Math.cos(slot.lastAngle) < 0;

      if (w.shape.fx) {
        renderer.ctx.globalAlpha = trailAlpha(k) * config.render.fx_alpha;
        renderer.drawSprite(w.shape.fx, x, y, size * config.render.fx_scale,
          a + pose.tilt, left);
        renderer.ctx.globalAlpha = 1;
      }
      renderer.drawSprite(w.texture, x, y,
        config.render.weapon_size * pose.scale, a + pose.tilt, left);
    }
  }

  function render() {
    const st = world();
    const me = myPlayer();
    if (!me) return;
    renderer.follow(me.x, me.y, config.sim.dt);
    renderer.begin();
    renderer.drawArena(config.arenas[arenaId]);
    if (arenaLayout) renderer.drawProps(arenaLayout.props);

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
      drawWeapons(p, size);
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
        // Поворот только там, где он виден: у круглых (плазма, спора, лёд)
        // spin='none', и они идут быстрым путём drawSprite без трансформа —
        // на 600 снарядах это разница в бюджете рендера, а не придирка.
        let angle = 0;
        if (pr.spin === 'heading') angle = Math.atan2(pr.vy, pr.vx);
        else if (pr.spin === 'spin') angle = pr.age * PROJ_SPIN_RATE;
        if (!renderer.drawSprite(pr.texture, pr.x, pr.y, r * projScale, angle, false)) {
          renderer.drawDot(pr.x, pr.y, r, pr.color || ashColor);
        }
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
          damage_taken: st.damage_taken || 0,
          ash_gained: st.ash_gained || 0,
          shop_buys: st.shop_buys || 0,
        }),
      });
    } catch (e) {
      return { relics_gained: 0, achievements: [] };
    }
  }

  function bootEngine(arenaSize) {
    renderer = createRenderer(canvas, config, arenaSize);
    renderer.setArenaLayout(arenaLayout);
    input = createInput(canvas, config);
    loop = createLoop({
      dt: config.sim.dt,
      maxCatchup: config.sim.max_catchup_steps,
      update,
      render,
    });
    debug = createDebug(loop, transport);
    particles.clear();
    globalThis.__RUN__ = run || { state: netClient.state };
    globalThis.__NET__ = netClient || hostNet;
    globalThis.__LOOP__ = loop;
    screens.show('game');
    loop.start();
  }

  // --- соло ---------------------------------------------------------------
  async function startSolo(setup) {
    teardownRun();
    const character = (setup && setup.character) || firstKey(config.characters);
    arenaId = (setup && setup.arena) || firstKey(config.arenas);
    const danger = setup && setup.danger != null ? setup.danger : config.danger[0].id;
    const curses = (setup && setup.curses) || [];
    lastSetup = { character, arena: arenaId, danger, curses };
    let data;
    try {
      data = await fetchJson('/api/run/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character, arena: arenaId, danger, curses }),
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
      arena: arenaId, danger, unlocked: unlockedWeapons, curses, onImpact,
    });
    debugExtra.seed = data.seed;
    arenaLayout = run.layout;
    bootEngine([run.arenaW, run.arenaH]);
  }

  async function openSoloSetup() {
    let prof = profile;
    try { prof = await fetchJson('/api/profile'); profile = prof; } catch (e) { /* */ }
    setupUi.show({
      mode: 'solo',
      profile: prof,
      onConfirm: (s) => startSolo(s),
      onCancel: showMenu,
    });
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

  async function coopCreate(setup) {
    ensureSocket();
    const character = firstKey(config.characters);
    const res = await lobby.create(character);
    if (!res.ok) return res;
    if (setup) {
      await lobby.setup(setup.arena, setup.danger, setup.curses || []);
    }
    lobbyUi.show(lobby);
    return res;
  }

  async function openCoopSetup() {
    let prof = profile;
    try { prof = await fetchJson('/api/profile'); profile = prof; } catch (e) { /* */ }
    setupUi.show({
      mode: 'coop',
      profile: prof,
      onConfirm: (s) => coopCreate(s),
      onCancel: showMenu,
    });
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
    resultUi.hide();
    pauseUi.hide();
    teardownRun();
    runId = msg.run_id;
    finished = false;
    myIndex = lobby.you;
    arenaId = room.arena || firstKey(config.arenas);
    const danger = room.danger || 0;
    const curses = room.curses || [];
    const hostFlag = lobby.isHost;
    const fallbackChar = firstKey(config.characters);

    transport = createSocketTransport(socket, { isHost: hostFlag, id: myIndex });
    debugExtra.seed = msg.seed;

    if (hostFlag) {
      const players = room.players.map((p, i) => ({
        id: i, name: p.name, character: p.character || fallbackChar,
      }));
      run = createRun({ config, seed: msg.seed, transport, players,
        arena: arenaId, danger, unlocked: unlockedWeapons, curses, onImpact });
      hostNet = createHost(run, transport, config);
      arenaLayout = run.layout;
      bootEngine([run.arenaW, run.arenaH]);
    } else {
      // Клиент строит ту же раскладку сам: (seed, arenaId, размер) у него есть,
      // по сети арена не передаётся вовсе.
      const scale = 1 + config.coop.arena_per_player * (room.players.length - 1);
      const w = Math.round(config.arena.size[0] * scale);
      const h = Math.round(config.arena.size[1] * scale);
      arenaLayout = buildArenaLayout(config, arenaId, msg.seed, w, h);
      netClient = createNetClient(transport, config, myIndex,
        createPropIndex(arenaLayout, config));
      transport.on(CH.EVENT, (msg) => {
        if (!msg) return;
        if (msg.t === 'shop' && msg.p === myIndex) {
          shopSnap = msg.snap;
          if (shopUi.visible) shopUi.refresh();
        } else if (msg.t === 'levelup' && msg.p === myIndex) {
          remoteLevelChoices = msg.choices;
          const me = myPlayer();
          if (me) me.pendingLevels = msg.pending;
          if (levelUi.visible && remoteLevelChoices) {
            levelUi.refresh(me, remoteLevelChoices);
          }
        }
      });
      remoteShop = remoteAdapter(() => shopSnap, (kind, a) => {
        transport.send(CH.EVENT, { t: 'shop_act', p: myIndex, kind, a });
      });
      bootEngine([w, h]);
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

  const invited = roomFromUrl();

  async function doLogout() {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (e) { /* всё равно на логин */ }
    globalThis.location.href = '/login';
  }

  function showMenu() {
    setupUi.hide();
    screens.show('menu', {
      onPlay: openSoloSetup,
      onCoop: openCoopSetup,
      onJoin: coopJoin,
      onMeta: () => metaUi.show(showMenu),
      onAdmin: isAdmin && adminUi ? () => adminUi.show(showMenu) : null,
      onLogout: doLogout,
      invited,
    });
  }
  showMenu();
  if (invited) coopJoin(invited);

  globalThis.__COOP__ = { create: coopCreate, join: coopJoin, get lobby() { return lobby; } };
}

const PING_INTERVAL_MS = 2000;
// Сид генератора косметики. Фиксированный и свой: искры не имеют права влиять на
// случайность забега, которую сервер сверяет при валидации результата.
const FX_SEED = 0x5eed1;
const PROJ_SPIN_RATE = 14;      // рад/с для снарядов со spin='spin'

boot();
