// Экран итогов забега: победа или поражение, добытая статистика, реликвии,
// новые ачивки и открытия. Числа берутся из ответа сервера, а не считаются здесь:
// реликвии начисляет сервер (ТЗ §3.10).

export function createResultUi(root, config, t) {
  const doc = root.ownerDocument;

  const panel = doc.createElement('div');
  panel.id = 'result';
  panel.className = 'modal';
  panel.style.display = 'none';
  panel.innerHTML =
    '<div class="modal-title"></div>'
    + '<div class="result-rows"></div>'
    + '<div class="result-awards"></div>'
    + '<div class="shop-top"><div class="ash"></div>'
    + '<button type="button" class="btn again"></button>'
    + '<button type="button" class="btn back"></button></div>';
  root.appendChild(panel);

  const titleEl = panel.querySelector('.modal-title');
  const rowsEl = panel.querySelector('.result-rows');
  const awardsEl = panel.querySelector('.result-awards');
  const relicsEl = panel.querySelector('.ash');
  const againBtn = panel.querySelector('.again');
  const backBtn = panel.querySelector('.back');

  let handlers = {};

  againBtn.addEventListener('click', () => {
    panel.style.display = 'none';
    if (handlers.onAgain) handlers.onAgain();
  });
  backBtn.addEventListener('click', () => {
    panel.style.display = 'none';
    if (handlers.onBack) handlers.onBack();
  });

  function row(label, value) {
    return `<div class="stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function formatTime(sec) {
    const s = Math.round(sec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  return {
    // state — состояние забега, award — ответ /api/run/finish
    show(state, award, h) {
      handlers = h || {};
      againBtn.textContent = t('ui.result.again');
      backBtn.textContent = t('ui.result.menu');
      const win = !!state.win;
      titleEl.textContent = win ? t('ui.result.victory') : t('ui.result.defeat');
      titleEl.style.color = win ? '#a8d07a' : '#c34b4b';

      againBtn.style.display = handlers.canRestart === false ? 'none' : '';

      rowsEl.innerHTML =
        row(t('ui.result.wave'), state.wave + ' / ' + config.run.waves)
        + row(t('ui.result.kills'), state.kills || 0)
        + row(t('ui.result.score'), state.score || 0)
        + row(t('ui.result.time'), formatTime(state.time || 0))
        + row(t('ui.hud.boss'), state.bosses || 0);

      const gained = (award && award.relics_gained) || 0;
      relicsEl.textContent = t('ui.result.relics') + ': ' + gained;

      let html = '';
      if (award && award.flagged && award.flagged.length) {
        html += `<div class="result-flag">${t('ui.result.flagged')}</div>`;
      }
      const achs = (award && award.achievements) || [];
      for (let i = 0; i < achs.length; i++) {
        const a = config.achievements[achs[i]];
        if (a) html += `<div class="result-award">★ ${a.name} — ${a.desc}</div>`;
      }
      // Выполненные заказы — рядом с ачивками, но своим значком: награду за
      // них ещё надо забрать у персонажа, и строка должна об этом напоминать.
      const quests = (award && award.quests_done) || [];
      const table = (config.lodge && config.lodge.quests) || {};
      for (let i = 0; i < quests.length; i++) {
        const q = table[quests[i]];
        if (q) html += `<div class="result-award quest">✦ ${q.name} — ${t('ui.result.quest_done')}</div>`;
      }
      awardsEl.innerHTML = html;
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
