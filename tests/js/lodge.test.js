// lodge_state — чистое состояние заказов на клиенте, зеркало серверного lodge.py.
// Конфиг здесь минимальный литерал: тест проверяет цепочки и видимость, а не
// наполнение Ловчего Дома.

import test from 'node:test';
import assert from 'node:assert';
import {
  npcOpen, npcView, questState, questProgress, lodgeHasNew, findNpc,
  LOCKED, AVAILABLE, ACTIVE, DONE, CLAIMED,
} from '../../static/js/ui/lodge_state.js';

function makeConfig() {
  return {
    lodge: {
      npcs: [
        { id: 'np_a', name: 'Первый', title: 'т1', color: '#111', texture: 'np_a',
          intro: 'l_a0', quests: ['q_a1', 'q_a2'] },
        { id: 'np_b', name: 'Второй', title: 'т2', color: '#222', texture: 'np_b',
          requires: 'q_a1', intro: 'l_b0', quests: ['q_b1'] },
      ],
      quests: {
        q_a1: { npc: 'np_a', name: 'А1', desc: '', brief: '', done: '',
          lore: 'l_a1', reward: 10,
          goal: { metric: 'kills', scope: 'total', value: 50 } },
        q_a2: { npc: 'np_a', name: 'А2', desc: '', brief: '', done: '',
          lore: 'l_a2', reward: 20, requires: 'q_a1',
          goal: { metric: 'wave', scope: 'run', value: 10 } },
        q_b1: { npc: 'np_b', name: 'Б1', desc: '', brief: '', done: '',
          lore: 'l_b1', reward: 30,
          goal: { metric: 'ash', scope: 'run', value: 2000 } },
      },
      lore: {
        l_a0: { npc: 'np_a', title: 'вступление А', text: 'текст a0' },
        l_a1: { npc: 'np_a', title: 'А1', text: 'текст a1' },
        l_a2: { npc: 'np_a', title: 'А2', text: 'текст a2' },
        l_b0: { npc: 'np_b', title: 'вступление Б', text: 'текст b0' },
        l_b1: { npc: 'np_b', title: 'Б1', text: 'текст b1' },
      },
    },
  };
}

function profile(quests, lore) {
  return { relics: 0, quests: quests || {}, lore: lore || {} };
}

test('свежий профиль: открыт только первый персонаж и первый заказ цепочки', () => {
  const config = makeConfig();
  const p = profile();
  assert.equal(npcOpen(config, p, findNpc(config, 'np_a')), true);
  assert.equal(npcOpen(config, p, findNpc(config, 'np_b')), false);
  assert.equal(questState(config, p, 'q_a1'), AVAILABLE);
  // Второй заказ цепочки закрыт, пока не СДАН первый
  assert.equal(questState(config, p, 'q_a2'), LOCKED);
  // Заказ закрытого персонажа закрыт независимо от своей цепочки
  assert.equal(questState(config, p, 'q_b1'), LOCKED);
});

test('цепочка двигается сдачей, а не выполнением', () => {
  const config = makeConfig();
  const done = profile({ q_a1: { state: DONE, progress: 50 } });
  assert.equal(questState(config, done, 'q_a2'), LOCKED);
  assert.equal(npcOpen(config, done, findNpc(config, 'np_b')), false);

  const claimed = profile({ q_a1: { state: CLAIMED, progress: 50 } });
  assert.equal(questState(config, claimed, 'q_a2'), AVAILABLE);
  assert.equal(npcOpen(config, claimed, findNpc(config, 'np_b')), true);
  assert.equal(questState(config, claimed, 'q_b1'), AVAILABLE);
});

test('прогресс зажимается целью и не уезжает за 100%', () => {
  const config = makeConfig();
  const half = questProgress(config, profile({ q_a1: { state: ACTIVE, progress: 25 } }), 'q_a1');
  assert.deepEqual(half, { value: 25, target: 50, pct: 0.5 });

  // Сервер не даёт прогрессу перевалить цель, но клиент не должен на это
  // полагаться: шкала шириной 240% сломала бы вёрстку строки.
  const over = questProgress(config, profile({ q_a1: { state: DONE, progress: 120 } }), 'q_a1');
  assert.equal(over.value, 50);
  assert.equal(over.pct, 1);

  const none = questProgress(config, profile(), 'q_a1');
  assert.deepEqual(none, { value: 0, target: 50, pct: 0 });
});

test('диалог показывает только открытый лор и не спойлерит закрытые заказы', () => {
  const config = makeConfig();
  // Поговорил: выдан вступительный фрагмент, второй заказ ещё закрыт
  const fresh = npcView(config, profile({}, { l_a0: 1 }), 'np_a');
  assert.deepEqual(fresh.lore.map((l) => l.id), ['l_a0']);
  assert.deepEqual(fresh.quests.map((q) => q.id), ['q_a1']);
  assert.equal(fresh.quests[0].state, AVAILABLE);

  // Сдал первый: открылся его фрагмент и следующий заказ
  const after = npcView(config,
    profile({ q_a1: { state: CLAIMED, progress: 50 } }, { l_a0: 1, l_a1: 0 }), 'np_a');
  assert.deepEqual(after.lore.map((l) => l.id), ['l_a0', 'l_a1']);
  assert.deepEqual(after.quests.map((q) => q.id), ['q_a1', 'q_a2']);
  assert.equal(after.quests[0].state, CLAIMED);
  assert.equal(after.quests[1].state, AVAILABLE);
});

test('бейдж: горит на непрочитанном, на «можно взять» и на «можно сдать»', () => {
  const config = makeConfig();
  // Разговора не было — вступительный фрагмент ждёт
  assert.equal(lodgeHasNew(config, profile()), true);

  // Поговорил и взял единственный доступный заказ — брать и сдавать нечего
  assert.equal(lodgeHasNew(config,
    profile({ q_a1: { state: ACTIVE, progress: 3 } }, { l_a0: 1 })), false);

  // Заказ выполнен — пора идти сдавать
  assert.equal(lodgeHasNew(config,
    profile({ q_a1: { state: DONE, progress: 50 } }, { l_a0: 1 })), true);

  // Непрочитанный фрагмент сам по себе зажигает бейдж
  assert.equal(lodgeHasNew(config,
    profile({ q_a1: { state: ACTIVE, progress: 3 } }, { l_a0: 1, l_a1: 0 })), true);
});

test('заказ закрытого персонажа не зажигает бейдж', () => {
  const config = makeConfig();
  // np_b закрыт, его q_b1 доступным считаться не должен, иначе бейдж горел бы
  // с первой секунды и никогда не гас
  const p = profile({ q_a1: { state: ACTIVE, progress: 1 } }, { l_a0: 1 });
  assert.equal(questState(config, p, 'q_b1'), LOCKED);
  assert.equal(lodgeHasNew(config, p), false);
});

test('пустой конфиг и пустой профиль не роняют экран', () => {
  assert.equal(lodgeHasNew({}, null), false);
  assert.equal(npcView({}, null, 'np_a'), null);
  assert.equal(questState({}, null, 'q_a1'), LOCKED);
});
