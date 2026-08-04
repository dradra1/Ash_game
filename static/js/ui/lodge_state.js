// Ловчий Дом: чистое состояние заказов, без DOM. Зеркало серверного lodge.py.
//
// Отдельным модулем, а не внутри lodge_ui.js, по двум причинам: его гоняют
// node-тесты (в них нет DOM), и его же импортирует city_ui.js ради бейджа
// «Новое» на здании — тащить туда весь экран Дома незачем.
//
// Клиент здесь ничего не решает: он только показывает то, что сервер уже
// посчитал или посчитает при следующем запросе. Расхождение формул кончится
// кнопкой «Сдать», на которую сервер ответит отказом.

export const LOCKED = 'locked';
export const AVAILABLE = 'available';
export const ACTIVE = 'active';
export const DONE = 'done';
export const CLAIMED = 'claimed';

function lodge(config) {
  return (config && config.lodge) || {};
}

export function npcList(config) {
  return lodge(config).npcs || [];
}

export function questTable(config) {
  return lodge(config).quests || {};
}

export function loreTable(config) {
  return lodge(config).lore || {};
}

function userQuests(profile) {
  return (profile && profile.quests) || {};
}

function claimed(profile, questId) {
  const q = userQuests(profile)[questId];
  return !!q && q.state === CLAIMED;
}

// Персонаж появляется в зале, когда сдан заказ из его `requires`.
export function npcOpen(config, profile, npc) {
  return !npc.requires || claimed(profile, npc.requires);
}

export function findNpc(config, npcId) {
  const list = npcList(config);
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === npcId) return list[i];
  }
  return null;
}

// Состояние заказа глазами игрока. locked — либо персонаж закрыт, либо не сдан
// предыдущий заказ цепочки; available — можно взять прямо сейчас.
export function questState(config, profile, questId) {
  const mine = userQuests(profile)[questId];
  if (mine) return mine.state;
  const q = questTable(config)[questId];
  if (!q) return LOCKED;
  const npc = findNpc(config, q.npc);
  if (!npc || !npcOpen(config, profile, npc)) return LOCKED;
  if (q.requires && !claimed(profile, q.requires)) return LOCKED;
  return AVAILABLE;
}

export function questProgress(config, profile, questId) {
  const mine = userQuests(profile)[questId];
  const q = questTable(config)[questId];
  const target = (q && q.goal && q.goal.value) || 0;
  const value = mine ? Math.min(mine.progress, target) : 0;
  return { value, target, pct: target ? value / target : 0 };
}

// Всё, что нужно диалогу: сам персонаж, его открытый лор и его заказы.
// Заказы отдаются в порядке цепочки — он же порядок сюжета.
export function npcView(config, profile, npcId) {
  const npc = findNpc(config, npcId);
  if (!npc) return null;
  const open = npcOpen(config, profile, npc);
  const seen = (profile && profile.lore) || {};
  const table = loreTable(config);

  const lore = [];
  const ids = [npc.intro].concat((npc.quests || []).map(
    (qid) => (questTable(config)[qid] || {}).lore));
  for (let i = 0; i < ids.length; i++) {
    const lid = ids[i];
    if (!lid || !table[lid] || !(lid in seen)) continue;
    lore.push({ id: lid, title: table[lid].title, text: table[lid].text });
  }

  const quests = [];
  for (const qid of (npc.quests || [])) {
    const q = questTable(config)[qid];
    if (!q) continue;
    const state = questState(config, profile, qid);
    // Закрытые заказы цепочки не показываем совсем: список из четырёх строк
    // «Закрыт» — это спойлер объёма и ничего больше. Видно ровно то, что можно
    // взять, что в работе и что уже сдано.
    if (state === LOCKED) continue;
    quests.push(Object.assign({ id: qid, state }, questProgress(config, profile, qid), { def: q }));
  }
  return { npc, open, lore, quests };
}

// Бейдж «Новое» на здании: есть что сдать, что взять или что прочитать.
export function lodgeHasNew(config, profile) {
  const seen = (profile && profile.lore) || {};
  for (const lid in seen) {
    if (!seen[lid]) return true;
  }
  const list = npcList(config);
  for (let i = 0; i < list.length; i++) {
    const npc = list[i];
    if (!npcOpen(config, profile, npc)) continue;
    // Персонаж открыт, но разговора ещё не было — вступительный лор не выдан
    if (npc.intro && !(npc.intro in seen)) return true;
    for (const qid of (npc.quests || [])) {
      const state = questState(config, profile, qid);
      if (state === DONE || state === AVAILABLE) return true;
    }
  }
  return false;
}
