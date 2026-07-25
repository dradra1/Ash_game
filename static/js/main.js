// Точка входа: конфиг → профиль → экраны → по «Играть» старт забега.
// Соло — это комната из одного игрока через LocalTransport.

import { createLoop } from './engine/loop.js';
import { createInput } from './engine/input.js';
import { createRenderer } from './engine/render.js';
import { createLocalTransport, CH } from './net/transport.js';
import { createRun } from './sim/run.js';
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
    // M0: без профиля играть всё равно можно
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

  let transport = null;
  let run = null;
  let renderer = null;
  let input = null;
  let loop = null;
  let debug = null;
  let arenaId = null;

  // Переиспользуемые объекты кадра — без аллокаций в горячем цикле
  const inputPayload = { id: 0, x: 0, y: 0 };
  const debugExtra = { entities: 0, kbs: 0, ping: 0, seed: 0 };

  function update(dt) {
    if (input.consumePressed('F3')) debug.toggle();
    inputPayload.id = transport.id;
    inputPayload.x = input.move.x;
    inputPayload.y = input.move.y;
    transport.send(CH.INPUT, inputPayload);
    run.step(dt);
  }

  function render(alpha) {
    const players = run.state.players;
    let me = players[0];
    for (let i = 0; i < players.length; i++) {
      if (players[i].id === transport.id) { me = players[i]; break; }
    }
    renderer.follow(me.x, me.y, config.sim.dt);
    renderer.begin();
    renderer.drawArena(config.arenas[arenaId]);
    // Размер спрайта — из конфига сущности, а не радиус коллизии: это разные вещи
    // (радиус ~10 px, спрайт 48 px).
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const chCfg = config.characters[p.character];
      const size = chCfg.sprite || config.render.sprite_default;
      renderer.drawEntity(chCfg.texture, p.dir, 0, p.x, p.y, size, chCfg.color);
    }
    renderer.end();
    if (debug.visible) {
      debugExtra.entities = run.stats.entities;
      debug.draw(renderer.ctx, debugExtra);
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
      return; // M0: при ошибке старта остаёмся в меню
    }

    transport = createLocalTransport();
    run = createRun({
      config,
      seed: data.seed,
      transport,
      players: [{ id: transport.id, name: playerName, character }],
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

    // Хуки для браузерной проверки (tools/smoke.py): DoD этапов формулируется как
    // «игрок бегает на 60 fps», и это проверяется в настоящем браузере.
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
