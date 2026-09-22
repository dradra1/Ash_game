// Меню паузы (ESC): продолжить, начать заново, выйти в меню.
// В коопе пауза глобальная — хост-авторитет; рестарт доступен только хосту.

export function createPauseUi(root, config, t) {
  const doc = root.ownerDocument;

  const panel = doc.createElement('div');
  panel.id = 'pause';
  panel.className = 'modal';
  panel.style.display = 'none';
  panel.innerHTML =
    '<div class="modal-title"></div>'
    + '<div class="pause-actions">'
    + '<button type="button" class="btn resume"></button>'
    + '<button type="button" class="btn restart"></button>'
    + '<button type="button" class="btn audio"></button>'
    + '<button type="button" class="btn debug"></button>'
    + '<button type="button" class="btn menu"></button>'
    + '</div>'
    + '<div class="pause-cheats" style="display:none"></div>';
  root.appendChild(panel);

  const titleEl = panel.querySelector('.modal-title');
  const resumeBtn = panel.querySelector('.resume');
  const restartBtn = panel.querySelector('.restart');
  const menuBtn = panel.querySelector('.menu');
  const audioBtn = panel.querySelector('.audio');
  const debugBtn = panel.querySelector('.debug');
  const cheatsEl = panel.querySelector('.pause-cheats');

  let handlers = {};

  resumeBtn.addEventListener('click', () => {
    if (handlers.onResume) handlers.onResume();
  });
  restartBtn.addEventListener('click', () => {
    if (handlers.onRestart) handlers.onRestart();
  });
  menuBtn.addEventListener('click', () => {
    if (handlers.onMenu) handlers.onMenu();
  });
  audioBtn.addEventListener('click', () => {
    if (handlers.onAudio) handlers.onAudio();
  });
  debugBtn.addEventListener('click', () => {
    if (handlers.onDebug) handlers.onDebug();
  });

  return {
    show(h) {
      handlers = h || {};
      titleEl.textContent = t('ui.common.pause');
      resumeBtn.textContent = t('ui.common.resume');
      restartBtn.textContent = t('ui.pause.restart');
      menuBtn.textContent = t('ui.pause.menu');
      audioBtn.textContent = t('ui.pause.audio');
      audioBtn.style.display = handlers.onAudio ? '' : 'none';
      debugBtn.textContent = t('ui.pause.debug');
      debugBtn.style.display = handlers.onDebug ? '' : 'none';
      restartBtn.style.display = handlers.canRestart === false ? 'none' : '';
      panel.style.display = '';
    },
    hide() {
      panel.style.display = 'none';
    },
    get visible() {
      return panel.style.display !== 'none';
    },
    // Читы для админа: кнопки добавляются снаружи
    cheatsRoot: cheatsEl,
    showCheats(on) {
      cheatsEl.style.display = on ? '' : 'none';
    },
  };
}
