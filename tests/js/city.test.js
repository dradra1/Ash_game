// cityState — чистая функция «конфиг + профиль → состояние зданий города».
// Конфиг здесь — минимальный литерал, а не game_config.json: тест проверяет
// логику (резерв, закрытие раздела, доступность покупки), а не наполнение.

import test from 'node:test';
import assert from 'node:assert';
import { cityState } from '../../static/js/ui/city_ui.js';

function makeConfig() {
  return {
    city: {
      background: 'bg_test',
      width: 1000,
      height: 500,
      buildings: [
        { id: 'lodge', texture: 't_lod', x: 0, y: 0, w: 10, h: 10, color: '#111',
          name: 'n.lodge', hint: 'h.lodge', action: { type: 'quests' } },
        { id: 'tavern', texture: 't_tav', texture_locked: 't_tav_ruin',
          x: 100, y: 0, w: 10, h: 10, color: '#222', name: 'n.tav', hint: 'h.tav',
          action: { type: 'meta', tabs: ['factions', 'characters'] } },
        { id: 'forge', texture: 't_for', texture_locked: 't_for_ruin',
          x: 200, y: 0, w: 10, h: 10, color: '#333', name: 'n.for', hint: 'h.for',
          action: { type: 'meta', tabs: ['weapons'] } },
        { id: 'chapel', texture: 't_cha', texture_locked: 't_cha_ruin',
          x: 300, y: 0, w: 10, h: 10, color: '#444', name: 'n.cha', hint: 'h.cha',
          action: { type: 'meta', tabs: ['upgrades'] } },
        { id: 'waystation', texture: 't_way', texture_locked: 't_way_ruin',
          x: 400, y: 0, w: 10, h: 10, color: '#555', name: 'n.way', hint: 'h.way',
          action: { type: 'meta', tabs: ['arenas'] } },
        { id: 'wip_c', texture: 't_c', x: 0, y: 200, w: 10, h: 10, color: '#666',
          name: 'n.soon', hint: 'h.soon', action: { type: 'none' } },
        { id: 'crypt', texture: 't_cry', texture_locked: 't_cry_ruin',
          x: 100, y: 200, w: 10, h: 10, color: '#777', name: 'n.cry', hint: 'h.cry',
          action: { type: 'meta', tabs: ['curses'] } },
        { id: 'gate', texture: 't_gat', x: 200, y: 200, w: 10, h: 10,
          color: '#888', name: 'n.gat', hint: 'h.gat', action: { type: 'play' } },
        { id: 'obelisk', texture: 't_obe', texture_locked: 't_obe_ruin',
          x: 300, y: 200, w: 10, h: 10, color: '#999', name: 'n.obe', hint: 'h.obe',
          action: { type: 'meta', tabs: ['achievements'] } },
      ],
    },
    factions: {
      f_free: { unlock: { type: 'default' } },
      f_pay: { unlock: { type: 'relics', cost: 100 } },
      f_exp: { unlock: { type: 'relics', cost: 100000 } },
    },
    characters: {
      ch_a: { faction: 'f_free', unlock: { type: 'default' } },
      ch_b: { faction: 'f_pay', unlock: { type: 'relics', cost: 40 } },
      // персонаж дорогой фракции за копейки: без gating-а дал бы «Новое» всегда
      ch_c: { faction: 'f_exp', unlock: { type: 'relics', cost: 1 } },
    },
    weapons: {
      w_a: { tier: 1, unlock: { type: 'default' } },
      w_b: { tier: 1, unlock: { type: 'relics' } },
      w_b2: { tier: 2, unlock: { type: 'relics' } },
    },
    meta: {
      weapon_unlock_price: { 1: 120 },
      achievement_discount: 0.5,
      upgrades: [
        { id: 'mu_a', max_ranks: 2, price: [80, 200] },
      ],
    },
    arenas: {
      ar_free: { unlock: { type: 'default' } },
      ar_pay: { unlock: { type: 'relics', cost: 300 } },
    },
    curses: { cu_x: { unlock_achievement: 'ac_x' } },
    achievements: { ac_x: {} },
    lodge: {
      npcs: [
        { id: 'np_a', name: 'A', title: 'a', color: '#111', texture: 'np_a',
          intro: 'l_a0', quests: ['q_a1'] },
        { id: 'np_b', name: 'B', title: 'b', color: '#222', texture: 'np_b',
          requires: 'q_a1', intro: 'l_b0', quests: ['q_b1'] },
      ],
      quests: {
        q_a1: { npc: 'np_a', name: 'A1', desc: '', brief: '', done: '',
          lore: 'l_a1', reward: 10, goal: { metric: 'kills', scope: 'total', value: 5 } },
        q_b1: { npc: 'np_b', name: 'B1', desc: '', brief: '', done: '',
          lore: 'l_b1', reward: 20, goal: { metric: 'kills', scope: 'total', value: 5 } },
      },
      lore: {
        l_a0: { npc: 'np_a', title: 'a0', text: '' },
        l_a1: { npc: 'np_a', title: 'a1', text: '' },
        l_b0: { npc: 'np_b', title: 'b0', text: '' },
        l_b1: { npc: 'np_b', title: 'b1', text: '' },
      },
    },
  };
}

function makeProfile(over) {
  return Object.assign({
    relics: 0,
    unlocks: { faction: [], character: [], weapon: [] },
    achievements: [],
    upgrades: {},
    quests: {},
    lore: {},
  }, over);
}

function byId(states, id) {
  return states.find((s) => s.id === id);
}

test('девять зданий из конфига дают девять записей, порядок сохранён', () => {
  const states = cityState(makeConfig(), makeProfile());
  assert.equal(states.length, 9);
  assert.deepEqual(states.map((s) => s.id),
    ['lodge', 'tavern', 'forge', 'chapel', 'waystation', 'wip_c', 'crypt', 'gate',
      'obelisk']);
});

// Ловчий Дом занял площадку бывшего резерва wip_a. Он не meta-раздел, и логика
// locked/unlockable к нему не применяется вовсе: сюжет виден с первого входа.
test('Ловчий Дом: никогда не закрыт, не резерв, бейджем не торгует', () => {
  const states = cityState(makeConfig(), makeProfile({ relics: 999999 }));
  const s = byId(states, 'lodge');
  assert.equal(s.locked, false);
  assert.equal(s.reserved, false);
  assert.equal(s.unlockable, false);
  assert.equal(s.action.type, 'quests');
});

test('Ловчий Дом: бейдж «Новое» — по непрочитанному, а не по реликвиям', () => {
  const config = makeConfig();
  // Свежий профиль: разговора не было, вступительный лор не выдан
  assert.equal(byId(cityState(config, makeProfile()), 'lodge').hasNew, true);

  // Поговорил, взял единственный доступный заказ — брать и сдавать нечего
  const busy = makeProfile({
    lore: { l_a0: 1 },
    quests: { q_a1: { state: 'active', progress: 1 } },
  });
  assert.equal(byId(cityState(config, busy), 'lodge').hasNew, false);

  // Заказ выполнен — надо идти сдавать
  const ready = makeProfile({
    lore: { l_a0: 1 },
    quests: { q_a1: { state: 'done', progress: 5 } },
  });
  assert.equal(byId(cityState(config, ready), 'lodge').hasNew, true);

  // Сдал: открылся второй персонаж, у него есть непрочитанное и новый заказ
  const next = makeProfile({
    lore: { l_a0: 1, l_a1: 1 },
    quests: { q_a1: { state: 'claimed', progress: 5 } },
  });
  assert.equal(byId(cityState(config, next), 'lodge').hasNew, true);
});

// Арены заехали на площадку бывшего резерва wip_b. Вкладка `arenas` живёт в
// meta_ui с самого начала, но в таблицах city_ui её не было: здание вышло бы
// навсегда закрытым, а купить арену стало бы негде вовсе.
test('арены: раздел открыт, цена читается, бейдж по достатку реликвий', () => {
  const config = makeConfig();
  const poor = byId(cityState(config, makeProfile({ relics: 299 })), 'waystation');
  assert.equal(poor.locked, false);
  assert.equal(poor.texture, 't_way');
  assert.equal(poor.unlockable, false);
  const rich = byId(cityState(config, makeProfile({ relics: 300 })), 'waystation');
  assert.equal(rich.unlockable, true);
  // купленная арена перестаёт светить бейджем
  const owned = byId(cityState(config, makeProfile({
    relics: 999, unlocks: { faction: [], character: [], weapon: [], arena: ['ar_pay'] },
  })), 'waystation');
  assert.equal(owned.unlockable, false);
});

test('резерв: reserved, без бейджей и без locked даже при горе реликвий', () => {
  const states = cityState(makeConfig(), makeProfile({ relics: 999999 }));
  for (const id of ['wip_c']) {
    const s = byId(states, id);
    assert.equal(s.reserved, true, id);
    assert.equal(s.locked, false, id);
    assert.equal(s.unlockable, false, id);
    assert.equal(s.hasNew, false, id);
  }
});

test('крипта без ачивок на проклятия закрыта, с ачивкой — открыта', () => {
  const config = makeConfig();
  const locked = byId(cityState(config, makeProfile()), 'crypt');
  assert.equal(locked.locked, true);
  const open = byId(cityState(config,
    makeProfile({ achievements: [{ id: 'ac_x' }] })), 'crypt');
  assert.equal(open.locked, false);
  // проклятия покупать нечего — бейджа «Новое» не бывает даже открытыми
  assert.equal(open.unlockable, false);
});

test('закрытому зданию подставляется texture_locked', () => {
  const s = byId(cityState(makeConfig(), makeProfile()), 'crypt');
  assert.equal(s.texture, 't_cry_ruin');
  const open = byId(cityState(makeConfig(),
    makeProfile({ achievements: [{ id: 'ac_x' }] })), 'crypt');
  assert.equal(open.texture, 't_cry');
});

test('хватает реликвий на фракцию — unlockable, не хватает — нет', () => {
  const config = makeConfig();
  const rich = byId(cityState(config, makeProfile({ relics: 100 })), 'tavern');
  assert.equal(rich.unlockable, true);
  const poor = byId(cityState(config, makeProfile({ relics: 99 })), 'tavern');
  assert.equal(poor.unlockable, false);
});

test('персонаж закрытой фракции не даёт «Новое», открытой — даёт', () => {
  const config = makeConfig();
  // f_pay стоит 100 > 50, ch_b (40) заперт за ней, ch_c (1) заперт за f_exp:
  // купить нечего, хотя цены хватает на ch_c
  const gated = byId(cityState(config, makeProfile({ relics: 50 })), 'tavern');
  assert.equal(gated.unlockable, false);
  // фракция куплена — её персонаж за 40 становится доступен
  const open = byId(cityState(config, makeProfile({
    relics: 50, unlocks: { faction: ['f_pay'], character: [], weapon: [] },
  })), 'tavern');
  assert.equal(open.unlockable, true);
});

test('оружие первого тира по цене из weapon_unlock_price, второй тир не продаётся', () => {
  const config = makeConfig();
  const enough = byId(cityState(config, makeProfile({ relics: 120 })), 'forge');
  assert.equal(enough.unlockable, true);
  const short = byId(cityState(config, makeProfile({ relics: 119 })), 'forge');
  assert.equal(short.unlockable, false);
});

test('улучшения: цена берётся по текущему рангу, на максимуме покупать нечего', () => {
  const config = makeConfig();
  const r0 = byId(cityState(config, makeProfile({ relics: 80 })), 'chapel');
  assert.equal(r0.unlockable, true);
  const r0poor = byId(cityState(config, makeProfile({ relics: 79 })), 'chapel');
  assert.equal(r0poor.unlockable, false);
  // ранг 1 — цена уже 200
  const r1 = byId(cityState(config, makeProfile({
    relics: 199, upgrades: { mu_a: 1 },
  })), 'chapel');
  assert.equal(r1.unlockable, false);
  // максимальный ранг — раздел открыт, но бейджа нет
  const maxed = byId(cityState(config, makeProfile({
    relics: 999, upgrades: { mu_a: 2 },
  })), 'chapel');
  assert.equal(maxed.locked, false);
  assert.equal(maxed.unlockable, false);
});

test('врата и обелиск никогда не locked', () => {
  const states = cityState(makeConfig(), makeProfile());
  assert.equal(byId(states, 'gate').locked, false);
  assert.equal(byId(states, 'obelisk').locked, false);
});

test('отсутствие city в конфиге — пустой массив, без исключения', () => {
  assert.deepEqual(cityState({}, makeProfile()), []);
  assert.deepEqual(cityState({ city: {} }, makeProfile()), []);
  assert.deepEqual(cityState(null, makeProfile()), []);
});

test('profile = null не роняет функцию', () => {
  const states = cityState(makeConfig(), null);
  assert.equal(states.length, 9);
  // без профиля покупать не на что и проклятия не открыты
  assert.equal(byId(states, 'tavern').unlockable, false);
  assert.equal(byId(states, 'crypt').locked, true);
  assert.equal(byId(states, 'gate').locked, false);
});
