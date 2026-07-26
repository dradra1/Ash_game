// Модалка левелапа: config.level.choices вариантов улучшения статов.
// Показывается в фазе LEVELUP (конец волны) для всех игроков.
// Редкость карточки — от ordinary до legendary, цвет из конфига.

import { statsHtml, iconHtml } from './tooltip.js';

export function createLevelUpUi(root, config, t) {
  const doc = root.ownerDocument;

  const panel = doc.createElement('div');
  panel.id = 'levelup';
  panel.className = 'modal';
  panel.style.display = 'none';

  const title = doc.createElement('div');
  title.className = 'modal-title';
  panel.appendChild(title);

  const queueLabel = doc.createElement('div');
  queueLabel.className = 'modal-sub';
  panel.appendChild(queueLabel);

  const row = doc.createElement('div');
  row.className = 'choice-row';
  panel.appendChild(row);
  root.appendChild(panel);

  const cards = [];
  let onPick = null;

  for (let i = 0; i < config.level.choices; i++) {
    const card = doc.createElement('button');
    card.type = 'button';
    card.className = 'choice';
    const idx = i;
    card.addEventListener('click', () => {
      if (onPick) onPick(idx);
    });
    row.appendChild(card);
    cards.push(card);
  }

  function rarityLabel(id) {
    return t('ui.rarity.' + id);
  }

  function render(player, choices) {
    title.textContent = t('ui.levelup.title') + ' — ' + t('ui.hud.level') + ' ' + player.level;
    queueLabel.textContent = player.pendingLevels > 1
      ? t('ui.levelup.queue') + ': ' + (player.pendingLevels - 1)
      : t('ui.levelup.pick');
    for (let i = 0; i < cards.length; i++) {
      const c = choices[i];
      if (!c) {
        cards[i].style.display = 'none';
        continue;
      }
      cards[i].style.display = '';
      const suffix = c.kind === 'pct' ? '%' : '';
      const rarity = c.rarity || 'common';
      const border = c.color || '#9aa0a8';
      cards[i].innerHTML =
        iconHtml(c.texture, 'icon-lg')
        + `<div class="choice-rarity" style="color:${border}">${rarityLabel(rarity)}</div>`
        + `<div class="choice-name">${c.name}</div>`
        + `<div class="choice-value">+${c.value}${suffix}</div>`;
      cards[i].style.borderColor = border;
    }
  }

  return {
    show(player, choices, pick) {
      onPick = pick;
      render(player, choices);
      panel.style.display = '';
    },
    hide() {
      panel.style.display = 'none';
      onPick = null;
    },
    refresh(player, choices) {
      if (panel.style.display === 'none') return;
      render(player, choices);
    },
    get visible() {
      return panel.style.display !== 'none';
    },
  };
}

export { statsHtml };
