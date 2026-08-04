// Ловчий Дом: зал с персонажами и диалог с выдачей заказов.
//
// Две картины в одной панели, как вкладки в реликварии: зал (галерея
// персонажей) и разговор (портрет, летопись, список заказов). Отдельными
// экранами их делать нельзя — focus.js ищет ровно одну видимую панель `.modal`,
// а две вложенные дали бы навигации падом два конкурирующих корня.
//
// Портрет рисуется без арифметики в JS: idle-лист персонажа — это 4 квадратных
// кадра столбиком (S, E, N, W), поэтому background-size шириной в сторону кадра
// и позиция 0 0 показывают ровно южный кадр — тот же приём, что у .tip-face в
// tooltip.js. Ходьбы у этих спрайтов нет и не нужно: они стоят.

import {
  npcList, npcOpen, npcView, questTable,
  AVAILABLE, ACTIVE, DONE, CLAIMED,
} from './lodge_state.js';

const FACE_HALL = 64;      // сторона кадра в зале: 48 → 64 не целое, но
const FACE_DIALOG = 96;    // ужимает браузер, а не мы; pixelated держит сетку

function faceStyle(texture, size) {
  if (!texture) return '';
  return `background-image:url(/static/textures/${texture}.png);`
    + `background-size:${size}px auto;`;
}

export function createLodgeUi(root, config, t, api) {
  const doc = root.ownerDocument;

  const panel = doc.createElement('div');
  panel.id = 'lodge';
  panel.className = 'modal wide';
  panel.style.display = 'none';
  panel.innerHTML =
    '<div class="modal-title"></div>'
    + '<div class="shop-top"><div class="ash relics"></div>'
    + '<button type="button" class="btn back"></button></div>'
    + '<div class="lodge-body"></div>';
  root.appendChild(panel);

  const titleEl = panel.querySelector('.modal-title');
  const relicsEl = panel.querySelector('.relics');
  const backBtn = panel.querySelector('.back');
  const bodyEl = panel.querySelector('.lodge-body');

  let profile = null;
  let onBack = null;
  let openNpc = null;     // null — зал, иначе id персонажа
  let busy = false;

  // Кнопка «Назад» из диалога возвращает в зал, из зала — в город. Так же
  // ведёт себя `.btn.back` под геймпадом (focus.js ищет её по классу).
  backBtn.addEventListener('click', () => {
    if (openNpc) {
      openNpc = null;
      render();
      return;
    }
    panel.style.display = 'none';
    if (onBack) onBack();
  });

  function flash(text) {
    relicsEl.textContent = text;
    doc.defaultView.setTimeout(renderTop, 1600);
  }

  function renderTop() {
    titleEl.textContent = openNpc
      ? (nameOf(openNpc) || t('ui.lodge.title'))
      : t('ui.lodge.title');
    relicsEl.textContent = t('ui.meta.relics') + ': '
      + ((profile && profile.relics) || 0);
    backBtn.textContent = t('ui.common.back');
  }

  function nameOf(npcId) {
    const list = npcList(config);
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === npcId) return list[i].name;
    }
    return '';
  }

  // --- зал ------------------------------------------------------------

  function renderHall() {
    bodyEl.innerHTML = '';

    const hint = doc.createElement('div');
    hint.className = 'modal-sub lodge-hint';
    hint.textContent = t('ui.lodge.hint');
    bodyEl.appendChild(hint);

    const hall = doc.createElement('div');
    hall.className = 'lodge-hall';
    bodyEl.appendChild(hall);

    const seen = (profile && profile.lore) || {};
    for (const npc of npcList(config)) {
      const open = npcOpen(config, profile, npc);
      const card = doc.createElement(open ? 'button' : 'div');
      card.className = 'npc' + (open ? '' : ' locked-out');
      card.style.setProperty('--accent', npc.color || '#3a3f4a');
      if (open) card.type = 'button';

      const face = doc.createElement('div');
      face.className = 'npc-face';
      face.setAttribute('style', faceStyle(npc.texture, FACE_HALL));
      card.appendChild(face);

      const name = doc.createElement('div');
      name.className = 'npc-name';
      name.style.color = npc.color || '#c9c4b8';
      name.textContent = open ? npc.name : '???';
      card.appendChild(name);

      const title = doc.createElement('div');
      title.className = 'npc-title';
      // Закрытому персонажу показываем не имя, а условие: иначе игрок видит
      // тёмный силуэт и не понимает, чего от него хотят.
      title.textContent = open ? npc.title : lockHint(npc);
      card.appendChild(title);

      if (open) {
        const view = npcView(config, profile, npc.id);
        const mark = marker(view, npc, seen);
        if (mark) {
          const badge = doc.createElement('span');
          badge.className = 'badge new';
          badge.textContent = mark;
          card.appendChild(badge);
        }
        card.addEventListener('click', () => talk(npc.id));
      }
      hall.appendChild(card);
    }
  }

  function lockHint(npc) {
    const q = questTable(config)[npc.requires];
    return q ? t('ui.lodge.locked_by') + ': «' + q.name + '»' : t('ui.lodge.locked');
  }

  // Что подсветить на карточке персонажа: сдать важнее, чем взять, взять —
  // важнее, чем прочитать. Одна метка, а не три: три превращают зал в ёлку.
  function marker(view, npc, seen) {
    if (!view) return '';
    for (const q of view.quests) {
      if (q.state === DONE) return t('ui.lodge.ready');
    }
    for (const q of view.quests) {
      if (q.state === AVAILABLE) return t('ui.lodge.available');
    }
    if (npc.intro && !(npc.intro in seen)) return t('ui.city.new');
    return '';
  }

  // --- диалог ---------------------------------------------------------

  function renderDialog() {
    const view = npcView(config, profile, openNpc);
    bodyEl.innerHTML = '';
    if (!view) return;

    const head = doc.createElement('div');
    head.className = 'dlg-head';
    head.style.setProperty('--accent', view.npc.color || '#3a3f4a');

    const face = doc.createElement('div');
    face.className = 'dlg-face';
    face.setAttribute('style', faceStyle(view.npc.texture, FACE_DIALOG));
    head.appendChild(face);

    const who = doc.createElement('div');
    who.className = 'dlg-who';
    who.innerHTML = `<div class="dlg-name" style="color:${view.npc.color}"></div>`
      + '<div class="dlg-title"></div>';
    who.querySelector('.dlg-name').textContent = view.npc.name;
    who.querySelector('.dlg-title').textContent = view.npc.title;
    head.appendChild(who);
    bodyEl.appendChild(head);

    const cols = doc.createElement('div');
    cols.className = 'dlg-cols';
    bodyEl.appendChild(cols);

    // Летопись слева: фрагменты в порядке открытия, последний — свежий.
    const loreCol = doc.createElement('div');
    loreCol.className = 'dlg-col dlg-lore';
    loreCol.innerHTML = `<div class="col-title">${t('ui.lodge.lore')}</div>`;
    for (const frag of view.lore) {
      const el = doc.createElement('div');
      el.className = 'lore-frag';
      const h = doc.createElement('b');
      h.textContent = frag.title;
      const p = doc.createElement('p');
      p.textContent = frag.text;
      el.appendChild(h);
      el.appendChild(p);
      loreCol.appendChild(el);
    }
    cols.appendChild(loreCol);

    const questCol = doc.createElement('div');
    questCol.className = 'dlg-col dlg-quests';
    questCol.innerHTML = `<div class="col-title">${t('ui.lodge.quests')}</div>`;
    if (!view.quests.length) {
      const empty = doc.createElement('div');
      empty.className = 'meta-line dim';
      empty.textContent = t('ui.lodge.no_quests');
      questCol.appendChild(empty);
    }
    for (const q of view.quests) questCol.appendChild(questRow(q));
    cols.appendChild(questCol);
  }

  function questRow(q) {
    const row = doc.createElement('div');
    row.className = 'quest-row quest-' + q.state;

    const name = doc.createElement('div');
    name.className = 'quest-name';
    name.textContent = q.def.name;
    row.appendChild(name);

    const desc = doc.createElement('div');
    desc.className = 'quest-desc';
    desc.textContent = q.def.desc;
    row.appendChild(desc);

    // Реплика: до взятия — как заказ предлагают, после сдачи — как принимают.
    const say = doc.createElement('div');
    say.className = 'quest-say';
    say.textContent = q.state === CLAIMED ? q.def.done : q.def.brief;
    row.appendChild(say);

    // Полоса прогресса только у взятых: у ещё не взятого прогресса нет, и
    // пустая шкала читалась бы как «уже начато, но ноль».
    if (q.state === ACTIVE || q.state === DONE) {
      const bar = doc.createElement('div');
      bar.className = 'quest-bar';
      const fill = doc.createElement('i');
      fill.style.width = Math.round(q.pct * 100) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);

      const num = doc.createElement('div');
      num.className = 'quest-num';
      num.textContent = q.value + ' / ' + q.target;
      row.appendChild(num);
    }

    const foot = doc.createElement('div');
    foot.className = 'quest-foot';
    const price = doc.createElement('span');
    price.className = 'price';
    price.textContent = t('ui.lodge.reward') + ': ' + q.def.reward;
    foot.appendChild(price);
    row.appendChild(foot);

    if (q.state === AVAILABLE) {
      row.appendChild(mkAction(t('ui.lodge.take'), () => take(q.id)));
    } else if (q.state === DONE) {
      row.appendChild(mkAction(t('ui.lodge.claim'), () => claim(q.id), 'go'));
    } else {
      const tag = doc.createElement('span');
      tag.className = q.state === CLAIMED ? 'owned-tag' : 'quest-tag';
      tag.textContent = q.state === CLAIMED
        ? t('ui.lodge.claimed') : t('ui.lodge.active');
      row.appendChild(tag);
    }
    return row;
  }

  function mkAction(text, fn, extra) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'mini buy' + (extra ? ' ' + extra : '');
    btn.textContent = text;
    btn.addEventListener('click', fn);
    return btn;
  }

  // --- действия -------------------------------------------------------

  async function talk(npcId) {
    if (busy) return;
    busy = true;
    // Разговор открывает вступительный фрагмент и гасит бейджи — «поговорил»
    // и есть «прочитал», отдельной кнопки в UI нет.
    await api.talk(npcId);
    profile = await api.profile();
    busy = false;
    openNpc = npcId;
    render();
  }

  async function take(questId) {
    if (busy) return;
    busy = true;
    const res = await api.take(questId);
    busy = false;
    if (res && res.ok) {
      profile = await api.profile();
      render();
    } else if (res && res.error) {
      flash(t('ui.error.' + res.error) || res.error);
    }
  }

  async function claim(questId) {
    if (busy) return;
    busy = true;
    const res = await api.claim(questId);
    busy = false;
    if (res && res.ok) {
      profile = await api.profile();
      render();
    } else if (res && res.error) {
      flash(t('ui.error.' + res.error) || res.error);
    }
  }

  function render() {
    renderTop();
    if (openNpc) renderDialog();
    else renderHall();
  }

  return {
    async show(back) {
      onBack = back || null;
      openNpc = null;
      profile = await api.profile();
      render();
      panel.style.display = '';
    },
    hide() { panel.style.display = 'none'; },
    get visible() { return panel.style.display !== 'none'; },
  };
}
