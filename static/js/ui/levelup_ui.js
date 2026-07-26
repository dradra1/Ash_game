// Модалка левелапа: config.level.choices вариантов улучшения статов.
//
// В соло игра ставится на паузу (это решает main.js по флагу pausesGame),
// в коопе модалка висит поверх боя и выбор можно отложить — очередь копится.

import { statsHtml } from './tooltip.js';

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

  function render(player, choices) {
    title.textContent = t('ui.levelup.title') + ' — ' + t('ui.hud.level') + ' ' + player.level;
    queueLabel.textContent = player.pendingLevels > 1
      ? t('ui.levelup.queue') + ': ' + (player.pendingLevels - 1)
      : t('ui.levelup.pick');
    for (let i = 0; i < cards.length; i++) {
      const c = choices[i];
      const suffix = c.kind === 'pct' ? '%' : '';
      cards[i].innerHTML =
        `<div class="choice-name" style="color:${c.color}">${c.name}</div>`
        + `<div class="choice-value">+${c.value}${suffix}</div>`;
      cards[i].style.borderColor = c.color;
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
    },
    get visible() {
      return panel.style.display !== 'none';
    },
  };
}

export { statsHtml };
