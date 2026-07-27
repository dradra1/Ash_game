// Настройки звука: громкость музыки и эффектов, немой режим, список треков.
//
// Список авторов здесь не украшение: чужие ассеты берутся только под CC0/CC-BY с
// указанием авторства (CLAUDE.md §6), и это то самое место, где авторство видит
// игрок. Данные — из config.audio.tracks, дублировать их в коде нельзя.

export function createAudioUi(root, config, t, audio) {
  const doc = root.ownerDocument;

  const panel = doc.createElement('div');
  panel.id = 'audio-settings';
  panel.className = 'modal';
  panel.style.display = 'none';
  panel.innerHTML =
    '<div class="modal-title"></div>'
    + '<div class="audio-rows"></div>'
    + '<div class="col-title credits-title"></div>'
    + '<div class="audio-credits"></div>'
    + '<div class="pause-actions">'
    + '<button type="button" class="btn back"></button>'
    + '</div>';
  root.appendChild(panel);

  const titleEl = panel.querySelector('.modal-title');
  const rowsEl = panel.querySelector('.audio-rows');
  const creditsTitle = panel.querySelector('.credits-title');
  const creditsEl = panel.querySelector('.audio-credits');
  const backBtn = panel.querySelector('.back');

  let onClose = null;

  function slider(labelKey, get, set) {
    const row = doc.createElement('div');
    row.className = 'audio-row';
    const label = doc.createElement('span');
    label.className = 'audio-label';
    label.textContent = t(labelKey);
    const input = doc.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '5';
    input.value = String(Math.round(get() * 100));
    const value = doc.createElement('span');
    value.className = 'audio-value';
    value.textContent = input.value + '%';
    input.addEventListener('input', () => {
      const v = Number(input.value) / 100;
      set(v);
      value.textContent = input.value + '%';
    });
    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(value);
    return row;
  }

  function render() {
    titleEl.textContent = t('ui.audio.title');
    backBtn.textContent = t('ui.common.back');
    creditsTitle.textContent = t('ui.audio.credits');

    rowsEl.innerHTML = '';
    rowsEl.appendChild(slider('ui.audio.music',
      () => audio.musicVolume, (v) => audio.setMusicVolume(v)));
    rowsEl.appendChild(slider('ui.audio.sfx',
      () => audio.sfxVolume, (v) => audio.setSfxVolume(v)));

    const muteRow = doc.createElement('div');
    muteRow.className = 'audio-row';
    const muteBtn = doc.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = 'btn mini' + (audio.muted ? ' active' : '');
    muteBtn.textContent = t('ui.audio.muted');
    muteBtn.addEventListener('click', () => {
      audio.setMuted(!audio.muted);
      muteBtn.classList.toggle('active', audio.muted);
    });
    muteRow.appendChild(muteBtn);
    rowsEl.appendChild(muteRow);

    creditsEl.innerHTML = '';
    const list = audio.credits();
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const row = doc.createElement('div');
      row.className = 'inv-cell small';
      row.innerHTML = `<span class="inv-name">${c.title}</span>`
        + `<span class="meta-sub">${c.author} · ${c.license}</span>`;
      creditsEl.appendChild(row);
    }
  }

  backBtn.addEventListener('click', () => {
    panel.style.display = 'none';
    if (onClose) onClose();
  });

  return {
    show(close) {
      onClose = close || null;
      render();
      panel.style.display = '';
    },
    hide() { panel.style.display = 'none'; },
    get visible() { return panel.style.display !== 'none'; },
    refresh: render,
  };
}
