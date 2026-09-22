// Офлайн-сборка: вместо сервера на /api/* отвечает этот модуль.
//
// Симуляция и UI не знают, что сервера нет, — они по-прежнему делают fetch('/api/…'),
// а здесь fetch подменён: ответы той же формы, что в app.py, включая ошибки
// строкой {error: "..."} с тем же HTTP-кодом. Профиль (реликвии, открытия, ачивки,
// заказы, лор, история забегов) живёт в localStorage устройства.
//
// Логика начислений — порт meta.py / lodge.py (./meta.js, ./lodge.js).

import {
  awardRelics, firstClearBonus, checkAchievements, unlockPrice, requirementsMet, upgradePrice,
} from './meta.js';
import {
  quests, npcs, lore, npcOpen, questAvailable, applyRun, sanitizeKillsByType,
} from './lodge.js';

const STORE_KEY = 'ash_offline_v1';
const CONFIG_URL = '/static/offline/game_config.json';
const PLAYER_NAME = 'Странник';
// История забегов нужна агрегатам ачивок и бонусу первого прохождения. Строка
// забега — ~250 байт, так что лимита localStorage хватит на десятки тысяч забегов.

function emptyProfile() {
  return {
    relics: 0,
    unlocks: { faction: [], character: [], weapon: [], arena: [] },
    upgrades: {},
    achievements: [],
    runs: [],
    quests: {},
    lore: {},
  };
}

export function createStore(storage) {
  let mem = null;
  function load() {
    if (mem) return mem;
    let data = null;
    try {
      const raw = storage && storage.getItem(STORE_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (e) { /* битое хранилище — начинаем заново */ }
    mem = Object.assign(emptyProfile(), data || {});
    return mem;
  }
  function save() {
    try { if (storage) storage.setItem(STORE_KEY, JSON.stringify(mem)); } catch (e) { /* */ }
  }
  return { load, save };
}

function randomId(n) {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  let s = '';
  for (let i = 0; i < n; i++) s += a[i].toString(16).padStart(2, '0');
  return s;
}

function randomSeed() {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0];
}

export function createOfflineApi(config, store) {
  const p = () => store.load();

  function profile() {
    const s = p();
    let wave = 0;
    let score = 0;
    for (const r of s.runs) {
      if (!r.finished_at) continue;
      wave = Math.max(wave, r.wave || 0);
      score = Math.max(score, r.score || 0);
    }
    return {
      name: PLAYER_NAME,
      relics: s.relics,
      unlocks: s.unlocks,
      upgrades: s.upgrades,
      achievements: s.achievements,
      best: { wave, score },
      quests: s.quests,
      lore: s.lore,
      admin: false,
      offline: true,
    };
  }

  function runStart(data) {
    if (!data.character || !data.arena || data.danger == null) {
      return [400, { error: 'missing_fields' }];
    }
    const s = p();
    const run = {
      run_id: randomId(9), seed: randomSeed(), character: data.character, arena: data.arena,
      danger: Math.trunc(Number(data.danger)), players: 1,
      curses: Array.isArray(data.curses) ? data.curses.map(String) : [],
      started_at: Date.now() / 1000, finished_at: null,
    };
    // Незавершённые забеги (закрыли приложение посреди боя) не копятся.
    s.runs = s.runs.filter((r) => r.finished_at);
    s.runs.push(run);
    store.save();
    return [200, { run_id: run.run_id, seed: run.seed }];
  }

  function runFinish(data) {
    const s = p();
    const run = s.runs.find((r) => r.run_id === data.run_id);
    if (!data.run_id) return [400, { error: 'missing_run_id' }];
    if (!run) return [403, { error: 'not_your_run' }];
    if (run.finished_at) return [409, { error: 'already_finished' }];
    const num = (v) => Math.max(0, Math.trunc(Number(v) || 0));
    Object.assign(run, {
      wave: num(data.wave), win: data.win ? 1 : 0, bosses: num(data.bosses),
      time_sec: Math.max(0, Number(data.time_sec) || 0), kills: num(data.kills),
      score: num(data.score), damage_taken: num(data.damage_taken),
      ash_gained: num(data.ash_gained), shop_buys: num(data.shop_buys),
      kills_by_type: sanitizeKillsByType(config, data.kills_by_type),
      finished_at: Date.now() / 1000,
    });
    let relics = awardRelics(config, run, run.wave, run.win, run.bosses, 1);
    relics += firstClearBonus(config, s.runs, run, run.win);
    const fresh = checkAchievements(config, s.runs, s.achievements.map((a) => a.id));
    const summary = {
      wave: run.wave, win: run.win, bosses: run.bosses, kills: run.kills,
      damage_taken: run.damage_taken, ash_gained: run.ash_gained,
      shop_buys: run.shop_buys, kills_by_type: run.kills_by_type,
    };
    const questsDone = applyRun(config, s.quests, run, summary);
    delete run.kills_by_type;
    s.relics += relics;
    const at = Date.now() / 1000;
    for (const aid of fresh) s.achievements.push({ id: aid, at });
    store.save();
    return [200, { relics_gained: relics, unlocks: [], achievements: fresh,
      quests_done: questsDone }];
  }

  function metaUnlock(data) {
    const { kind, id } = data;
    if (!['faction', 'character', 'weapon', 'arena', 'upgrade'].includes(kind)) {
      return [400, { error: 'bad_kind' }];
    }
    if (!id) return [400, { error: 'bad_id' }];
    const s = p();
    if (kind === 'upgrade') {
      const rank = s.upgrades[id] || 0;
      const [price, up] = upgradePrice(config, id, rank);
      if (!up) return [400, { error: 'bad_id' }];
      if (price == null) return [409, { error: 'max_rank' }];
      if (s.relics < price) return [402, { error: 'not_enough_relics' }];
      s.relics -= price;
      s.upgrades[id] = rank + 1;
      store.save();
      return [200, { ok: true, kind, id, rank: rank + 1, spent: price, relics: s.relics }];
    }
    const owned = s.unlocks[kind] || (s.unlocks[kind] = []);
    if (owned.includes(id)) return [409, { error: 'already_owned' }];
    const earned = new Set(s.achievements.map((a) => a.id));
    const [price] = unlockPrice(config, kind, id, (a) => earned.has(a));
    if (price == null) return [400, { error: 'not_unlockable' }];
    if (!requirementsMet(config, kind, id, s.unlocks)) return [409, { error: 'faction_locked' }];
    if (s.relics < price) return [402, { error: 'not_enough_relics' }];
    s.relics -= price;
    owned.push(id);
    store.save();
    return [200, { ok: true, kind, id, spent: price, relics: s.relics }];
  }

  function lodgeTalk(data) {
    const s = p();
    const npc = npcs(config).find((n) => n.id === data.npc_id);
    if (!npc) return [400, { error: 'unknown_npc' }];
    if (!npcOpen(config, s.quests, npc)) return [409, { error: 'quest_not_available' }];
    const intro = npc.intro || null;
    if (intro && !(intro in s.lore)) s.lore[intro] = 0;
    const table = lore(config);
    for (const lid in table) {
      if (table[lid].npc === npc.id && lid in s.lore) s.lore[lid] = 1;
    }
    store.save();
    return [200, { ok: true, lore: intro }];
  }

  function lodgeTake(data) {
    const s = p();
    const qid = data.quest_id;
    if (!(qid in quests(config))) return [400, { error: 'unknown_quest' }];
    if (qid in s.quests) return [409, { error: 'quest_taken' }];
    if (!questAvailable(config, s.quests, qid)) return [409, { error: 'quest_not_available' }];
    s.quests[qid] = { state: 'active', progress: 0 };
    store.save();
    return [200, { ok: true, quest_id: qid }];
  }

  function lodgeClaim(data) {
    const s = p();
    const qid = data.quest_id;
    const q = quests(config)[qid];
    if (!q) return [400, { error: 'unknown_quest' }];
    const state = (s.quests[qid] || {}).state;
    if (state == null) return [409, { error: 'quest_not_available' }];
    if (state === 'claimed') return [409, { error: 'quest_claimed' }];
    if (state !== 'done') return [409, { error: 'quest_not_done' }];
    s.quests[qid].state = 'claimed';
    const relics = Math.trunc(q.reward || 0);
    s.relics += relics;
    const lid = q.lore || null;
    if (lid && !(lid in s.lore)) s.lore[lid] = 0;
    store.save();
    return [200, { ok: true, quest_id: qid, relics, lore: lid }];
  }

  const routes = {
    'GET /api/profile': profile,
    'POST /api/run/start': runStart,
    'POST /api/run/finish': runFinish,
    'POST /api/meta/unlock': metaUnlock,
    'POST /api/lodge/talk': lodgeTalk,
    'POST /api/lodge/take': lodgeTake,
    'POST /api/lodge/claim': lodgeClaim,
  };

  // -> [status, body]
  function handle(method, path, body) {
    const fn = routes[method + ' ' + path];
    if (!fn) return [404, { error: 'offline' }];
    const out = fn(body || {});
    return Array.isArray(out) ? out : [200, out];
  }

  return { handle };
}

// --- подмена fetch в браузере ------------------------------------------------

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export function installOffline() {
  const realFetch = globalThis.fetch.bind(globalThis);
  let configPromise = null;
  let api = null;
  const getConfig = () => {
    if (!configPromise) {
      configPromise = realFetch(CONFIG_URL).then((r) => {
        if (!r.ok) throw new Error(CONFIG_URL + ' → ' + r.status);
        return r.json();
      });
    }
    return configPromise;
  };
  let storage = null;
  try { storage = globalThis.localStorage; } catch (e) { /* без хранилища — прогресс в памяти */ }
  const store = createStore(storage);

  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, globalThis.location.href);
    if (url.origin !== globalThis.location.origin || !url.pathname.startsWith('/api/')) {
      return realFetch(input, init);
    }
    const method = ((init && init.method) || 'GET').toUpperCase();
    const config = await getConfig();
    if (url.pathname === '/api/config') return jsonResponse(200, config);
    if (!api) api = createOfflineApi(config, store);
    let body = {};
    try { if (init && init.body) body = JSON.parse(init.body); } catch (e) { /* */ }
    const [status, out] = api.handle(method, url.pathname, body);
    return jsonResponse(status, out);
  };
}
