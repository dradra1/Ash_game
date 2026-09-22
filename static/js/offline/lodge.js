// Порт lodge.py для офлайн-сборки: доступность заказов, прогресс, сдача.
// userQuests — {quest_id: {state, progress}}, та же форма, что /api/profile.

export const quests = (config) => ((config.lodge || {}).quests) || {};
export const npcs = (config) => ((config.lodge || {}).npcs) || [];
export const lore = (config) => ((config.lodge || {}).lore) || {};

const claimed = (uq, qid) => (uq[qid] || {}).state === 'claimed';

export function npcOpen(config, uq, npc) {
  return !npc.requires || claimed(uq, npc.requires);
}

export function questAvailable(config, uq, qid) {
  const q = quests(config)[qid];
  if (!q || qid in uq) return false;
  const npc = npcs(config).find((n) => n.id === q.npc);
  if (!npc || !npcOpen(config, uq, npc)) return false;
  return !q.requires || claimed(uq, q.requires);
}

export function filterOk(run, summary, flt) {
  if (!flt) return true;
  if (flt.win && !summary.win) return false;
  if ('danger_min' in flt && (run.danger || 0) < flt.danger_min) return false;
  if ('arena' in flt && run.arena !== flt.arena) return false;
  if ('character' in flt && run.character !== flt.character) return false;
  if ('players_min' in flt && (run.players || 1) < flt.players_min) return false;
  if ('damage_taken_max' in flt && (summary.damage_taken || 0) > flt.damage_taken_max) return false;
  if ('curse' in flt || 'curse_min' in flt) {
    const active = (run.curses || []).map(String);
    if ('curse' in flt && !active.includes(flt.curse)) return false;
    if ('curse_min' in flt && active.length < flt.curse_min) return false;
  }
  return true;
}

export function metricValue(goal, summary) {
  switch (goal.metric) {
    case 'runs': return 1;
    case 'wave': return summary.wave || 0;
    case 'kills': return summary.kills || 0;
    case 'ash': return summary.ash_gained || 0;
    case 'bosses': return summary.bosses || 0;
    case 'shop_buys': return summary.shop_buys || 0;
    case 'kills_type': return Math.trunc((summary.kills_by_type || {})[goal.target] || 0);
    default: return 0;
  }
}

export function runDelta(goal, run, summary) {
  if (!filterOk(run, summary, goal.filter)) return 0;
  const value = metricValue(goal, summary);
  if (goal.scope === 'run') return value >= goal.value ? goal.value : 0;
  return value;
}

// Двигает активные заказы на месте; возвращает только что выполненные.
export function applyRun(config, uq, run, summary) {
  const table = quests(config);
  const fresh = [];
  for (const qid in uq) {
    const row = uq[qid];
    if (row.state !== 'active') continue;
    const q = table[qid];
    if (!q) continue;
    const delta = runDelta(q.goal, run, summary);
    if (!delta) continue;
    row.progress = Math.min(q.goal.value, row.progress + delta);
    if (row.progress >= q.goal.value) {
      row.state = 'done';
      fresh.push(qid);
    }
  }
  return fresh;
}

export function sanitizeKillsByType(config, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const known = Object.assign({}, config.enemies || {}, config.bosses || {});
  const out = {};
  for (const key in raw) {
    if (!(key in known)) continue;
    const n = Math.trunc(Number(raw[key]));
    if (!Number.isFinite(n) || n <= 0) continue;
    out[key] = n;
  }
  return out;
}
