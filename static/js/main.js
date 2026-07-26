// Точка входа: конфиг → профиль → экраны → по «Играть» старт забега.
// Соло — это комната из одного игрока через LocalTransport.

import { createLoop } from './engine/loop.js';
import { createInput } from './engine/input.js';
import { createRenderer } from './engine/render.js';
import { createLocalTransport, CH } from './net/transport.js';
import { createRun, PHASE_OVER, PHASE_SHOP } from './sim/run.js';
import { applyLevelChoice } from './sim/player.js';
import { createHud } from './ui/hud.js';
import { createTooltip } from './ui/tooltip.js';
import { createLevelUpUi } from './ui/levelup_ui.js';
import { createShopUi } from './ui/shop_ui.js';
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

  const screens = createScreens(uiRoot, config, t);
  const hud = createHud(config, t);
  const tip = createTooltip(uiRoot);
  const levelUi = createLevelUpUi(uiRoot, config, t);
  const shopUi = createShopUi(uiRoot, config, t, tip);

  let transport = null;
  let run = null;
  let renderer = null;
  let input = null;
  let loop = null;
  let debug = null;
  let arenaId = null;
  let runId = null;
  let finished = false;

  // Переиспользуемые объекты кадра — без аллокаций в горячем цикле
  const inputPayload = { id: 0, x: 0, y: 0 };
  const debugExtra = { entities: 0, kbs: 0, ping: 0, seed: 0 };
  const ashColor = config.render.ash_color;
  const ashSize = config.render.ash_size;
  const animFps = config.render.anim_fps;
  const WALK = '_walk';

  function myPlayer() {
    const players = run.state.players;
    for (let i = 0; i < players.length; i++) {
      if (players[i].id === transport.id) return players[i];
    }
    return players[0];
  }

  // В соло левелап ставит игру на паузу, в коопе — нет (ТЗ §5): модалка висит
  // поверх боя, персонаж продолжает управляться, выбор можно отложить.
  function maybeLevelUp() {
    const me = myPlayer();
    if (me.pendingLevels <= 0) {
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
    return !run.coop;          // пауза только в соло
  }

  function update(dt) {
    if (input.consumePressed('F3')) debug.toggle();

    const paused = maybeLevelUp();
    if (run.state.phase === PHASE_SHOP) {
      if (!shopUi.visible) {
        shopUi.show(run, myPlayer(), run.shopFor(transport.id), () => {
          run.readyUp(transport.id);
        });
      }
      if (!run.coop) return;   // в соло мир стоит, пока игрок закупается
    } else if (shopUi.visible) {
      shopUi.hide();
    }
    if (paused) return;

    inputPayload.id = transport.id;
    inputPayload.x = input.move.x;
    inputPayload.y = input.move.y;
    transport.send(CH.INPUT, inputPayload);
    run.step(dt);

    if (run.state.phase === PHASE_OVER && !finished) {
      finished = true;
      levelUi.hide();
      shopUi.hide();
      reportRun();
    }
  }

  function render() {
    const me = myPlayer();
    renderer.follow(me.x, me.y, config.sim.dt);
    renderer.begin();
    renderer.drawArena(config.arenas[arenaId]);

    // Прах
    const pickups = run.pickupPool;
    for (let i = 0; i < pickups.count; i++) {
      const p = pickups.items[i];
      renderer.drawDot(p.x, p.y, ashSize / 2, ashColor);
    }

    // Враги
    const enemies = run.enemyPool;
    for (let i = 0; i < enemies.count; i++) {
      const e = enemies.items[i];
      const moving = e.vx !== 0 || e.vy !== 0;
      renderer.drawEntity(e.cfg.texture, e.dir, (e.animT * animFps) | 0,
        e.x, e.y, e.sprite, e.cfg.color, moving ? e.cfg.texture + WALK : null);
    }

    // Игроки: под спрайтом — эллипс цветом персонажа, над головой — ник
    const players = run.state.players;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p.alive) continue;
      const chCfg = config.characters[p.character];
      const size = chCfg.sprite || config.render.sprite_default;
      if (config.render.player_ring) {
        renderer.drawRing(p.x, p.y, size * 0.3, chCfg.color, config.render.player_ring_width);
      }
      const moving = p.vx !== 0 || p.vy !== 0;
      renderer.drawEntity(chCfg.texture, p.dir, (p.animT * animFps) | 0,
        p.x, p.y, size, chCfg.color, moving ? chCfg.texture + WALK : null);
      if (config.render.nameplate && players.length > 1) {
        renderer.drawText(p.name, p.x, p.y - config.render.nameplate_offset,
          chCfg.color, 'center');
      }
    }

    // Снаряды
    const projs = run.projPool;
    for (let i = 0; i < projs.count; i++) {
      const pr = projs.items[i];
      const r = Math.max(config.render.projectile_size_min, pr.size);
      renderer.drawDot(pr.x, pr.y, r, pr.color || ashColor);
    }

    renderer.end();
    hud.draw(renderer.ctx, run, me, renderer.view);

    if (debug.visible) {
      const s = run.refreshStats();
      debugExtra.entities = s.entities;
      debug.draw(renderer.ctx, debugExtra);
    }
  }

  async function reportRun() {
    const st = run.state;
    try {
      await fetchJson('/api/run/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: runId,
          wave: st.wave,
          win: st.win,
          bosses: st.bosses,
          time_sec: st.time,
          kills: st.kills,
          score: st.score,
        }),
      });
    } catch (e) {
      // итог не отправился — забег всё равно закончен, реликвии начислит сервер позже
    }
  }

  async function startRun() {
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
      return;   // при ошибке старта остаёмся в меню
    }
    runId = data.run_id;
    finished = false;

    transport = createLocalTransport();
    run = createRun({
      config,
      seed: data.seed,
      transport,
      players: [{ id: transport.id, name: playerName, character }],
      arena: arenaId,
      danger,
    });
    renderer = createRenderer(canvas, config);
    input = createInput(canvas, config);
    loop = createLoop({
      dt: config.sim.dt,
      maxCatchup: config.sim.max_catchup_steps,
      update,
      render,
    });
    debug = createDebug(loop, transport);
    debugExtra.seed = data.seed;

    // Хуки для браузерной проверки (tools/smoke.py)
    globalThis.__RUN__ = run;
    globalThis.__LOOP__ = loop;

    screens.show('game');
    loop.start();
  }

  globalThis.addEventListener('resize', () => {
    if (renderer) renderer.resize();
  });

  screens.show('menu', { onPlay: startRun });
}

boot();
