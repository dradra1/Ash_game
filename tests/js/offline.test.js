// Офлайн-сборка: порт meta.py / lodge.py обязан считать то же, что сервер.
// Эталон — сами Python-модули на том же конфиге (без БД: берутся только чистые
// функции), так что расхождение ловится при любой правке формул или конфига.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from './fixture.js';
import {
  awardRelics, unlockPrice, upgradePrice, checkAchievements, firstClearBonus,
} from '../../static/js/offline/meta.js';
import { runDelta, questAvailable } from '../../static/js/offline/lodge.js';
import { createOfflineApi, createStore } from '../../static/js/offline/api.js';

const config = loadConfig();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function python(script, input) {
  const out = execFileSync('python3', ['-c', script], {
    cwd: ROOT, input: JSON.stringify(input), maxBuffer: 64 << 20,
  });
  return JSON.parse(out.toString());
}

const PY_HEAD = `
import json, sys
sys.path.insert(0, '.')
import meta, lodge
cfg = json.load(open('config/game_config.json', encoding='utf-8'))
`;

test('награда за забег совпадает с meta.award_relics', () => {
  const curseIds = Object.keys(config.curses || {});
  const cases = [];
  for (let danger = 0; danger < config.danger.length; danger++) {
    for (const wave of [0, 1, 7, config.run.waves]) {
      for (const win of [0, 1]) {
        cases.push({ danger, wave, win, bosses: win ? 2 : 1, curses: curseIds.slice(0, danger) });
      }
    }
  }
  const expected = python(PY_HEAD + `
class R(dict):
    pass
cases = json.load(sys.stdin)
print(json.dumps([meta.award_relics(cfg, R(danger=c['danger'], curses=json.dumps(c['curses'])),
    c['wave'], c['win'], c['bosses'], 1) for c in cases]))
`, cases);
  const got = cases.map((c) => awardRelics(config, c, c.wave, c.win, c.bosses, 1));
  assert.deepEqual(got, expected);
});

test('цены открытий и улучшений совпадают с meta.unlock_price / upgrade_price', () => {
  const items = [];
  for (const [kind, tbl] of [['faction', 'factions'], ['character', 'characters'],
    ['arena', 'arenas'], ['weapon', 'weapons']]) {
    for (const id in config[tbl]) items.push([kind, id]);
  }
  const ups = (config.meta.upgrades || []).map((u) => u.id);
  const expected = python(PY_HEAD + `
d = json.load(sys.stdin)
prices = [list(meta.unlock_price(cfg, k, i, lambda a: flag)) for flag in (False, True) for k, i in d['items']]
upg = [meta.upgrade_price(cfg, u, r)[0] for u in d['ups'] for r in range(6)]
print(json.dumps({'prices': prices, 'upg': upg}))
`, { items, ups });
  const prices = [];
  for (const flag of [false, true]) {
    for (const [k, i] of items) prices.push(unlockPrice(config, k, i, () => flag));
  }
  const upg = [];
  for (const u of ups) for (let r = 0; r < 6; r++) upg.push(upgradePrice(config, u, r)[0]);
  assert.deepEqual(prices, expected.prices);
  assert.deepEqual(upg, expected.upg);
});

test('прогресс заказа совпадает с lodge.run_delta', () => {
  const qs = (config.lodge && config.lodge.quests) || {};
  const summaries = [
    { wave: 3, win: 0, bosses: 0, kills: 120, damage_taken: 40, ash_gained: 300, shop_buys: 4, kills_by_type: {} },
    { wave: config.run.waves, win: 1, bosses: 3, kills: 2500, damage_taken: 0, ash_gained: 5000, shop_buys: 30,
      kills_by_type: Object.fromEntries(Object.keys(config.enemies).map((k) => [k, 50])) },
  ];
  const runs = [
    { character: Object.keys(config.characters)[0], arena: Object.keys(config.arenas)[0], danger: 0, players: 1, curses: [] },
    { character: Object.keys(config.characters)[1], arena: Object.keys(config.arenas)[1], danger: config.danger.length - 1,
      players: 1, curses: Object.keys(config.curses || {}) },
  ];
  const expected = python(PY_HEAD + `
class R(dict):
    pass
d = json.load(sys.stdin)
out = []
for q in d['qs'].values():
    for r in d['runs']:
        row = R(r); row['curses'] = json.dumps(r['curses'])
        for s in d['summaries']:
            out.append(lodge.run_delta(q['goal'], row, s))
print(json.dumps(out))
`, { qs, runs, summaries });
  const got = [];
  for (const q of Object.values(qs)) {
    for (const r of runs) for (const s of summaries) got.push(runDelta(q.goal, r, s));
  }
  assert.ok(got.length > 0, 'в конфиге нет заказов — тест ничего не проверил');
  assert.deepEqual(got, expected);
});

test('ачивки и бонус первого прохождения считаются по истории забегов', () => {
  const runs = [
    { run_id: 'a', finished_at: 1, win: 0, wave: 5, bosses: 1, kills: 300, danger: 0, players: 1 },
    { run_id: 'b', finished_at: 1, win: 1, wave: config.run.waves, bosses: 3, kills: 2000, danger: 1,
      players: 1, character: 'x', arena: 'y' },
  ];
  const fresh = checkAchievements(config, runs, []);
  for (const aid of fresh) {
    const c = config.achievements[aid].cond;
    assert.ok(['reach_wave', 'wins', 'win_danger', 'bosses', 'kills', 'losses', 'win_coop',
      'damage_taken', 'ash_gained', 'shop_buys'].includes(c.type));
  }
  assert.deepEqual(checkAchievements(config, runs, fresh), [], 'выданная ачивка не выдаётся повторно');
  const bonus = config.meta.first_clear_bonus || 0;
  const first = firstClearBonus(config, runs, runs[1], 1);
  if (bonus > 0) assert.ok(first > 0);
  const again = { ...runs[1], run_id: 'c' };
  assert.equal(firstClearBonus(config, [...runs, again], again, 1), 0);
});

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('офлайн-API: забег → реликвии → покупка → заказ, профиль переживает перезапуск', () => {
  const storage = memStorage();
  let api = createOfflineApi(config, createStore(storage));
  const ch = Object.keys(config.characters)[0];
  const ar = Object.keys(config.arenas)[0];
  let [st, run] = api.handle('POST', '/api/run/start', { character: ch, arena: ar, danger: 0 });
  assert.equal(st, 200);
  assert.ok(Number.isInteger(run.seed) && run.seed >= 0);
  let [, fin] = api.handle('POST', '/api/run/finish', {
    run_id: run.run_id, wave: config.run.waves, win: true, bosses: 3, kills: 1500, ash_gained: 4000,
  });
  assert.ok(fin.relics_gained > 0);
  assert.equal(api.handle('POST', '/api/run/finish', { run_id: run.run_id })[0], 409);

  // «перезапуск приложения» — новый store поверх того же хранилища
  api = createOfflineApi(config, createStore(storage));
  const [, prof] = api.handle('GET', '/api/profile');
  assert.equal(prof.relics, fin.relics_gained);
  assert.equal(prof.best.wave, config.run.waves);

  const [code, err] = api.handle('POST', '/api/meta/unlock', { kind: 'upgrade', id: 'nope' });
  assert.equal(code, 400);
  assert.equal(err.error, 'bad_id');

  const uq = {};
  const qid = Object.keys(config.lodge.quests).find((q) => questAvailable(config, uq, q));
  if (qid) {
    assert.equal(api.handle('POST', '/api/lodge/take', { quest_id: qid })[0], 200);
    assert.equal(api.handle('POST', '/api/lodge/take', { quest_id: qid })[1].error, 'quest_taken');
    assert.equal(api.handle('POST', '/api/lodge/claim', { quest_id: qid })[1].error, 'quest_not_done');
  }
  assert.equal(api.handle('GET', '/api/board')[0], 404);
});
