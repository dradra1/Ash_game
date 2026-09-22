// Экранные кнопки для тач-устройств: пауза. Стрельба в игре автоматическая,
// поэтому единственный боевой ввод — движение, и больше кнопок не нужно.
// На десктопе модуль не создаёт ни одного узла.

export function createTouchUi(root, config, t) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const coarse = !!(win && win.matchMedia && win.matchMedia('(pointer: coarse)').matches);

  if (!coarse) {
    return { coarse: false, setHandlers() {}, sync() {}, hide() {} };
  }

  const box = doc.createElement('div');
  box.className = 'touch-ui';
  box.style.display = 'none';

  const pauseBtn = doc.createElement('button');
  pauseBtn.type = 'button';
  pauseBtn.className = 'btn touch-btn touch-pause';
  pauseBtn.textContent = t('ui.touch.pause');
  pauseBtn.title = t('ui.touch.pause_title');
  pauseBtn.setAttribute('aria-label', t('ui.touch.pause_title'));
  box.appendChild(pauseBtn);
  root.appendChild(box);

  let handlers = {};
  let shown = false;

  pauseBtn.addEventListener('click', () => {
    if (handlers.onPause) handlers.onPause();
  });

  return {
    coarse: true,

    setHandlers(h) {
      handlers = h || {};
    },

    // Дёргается каждый кадр из draw(); стиль трогаем только по факту смены
    // состояния, иначе это запись в DOM на каждом кадре.
    sync(visible) {
      const on = !!visible;
      if (on === shown) return;
      shown = on;
      box.style.display = on ? '' : 'none';
    },

    hide() {
      this.sync(false);
    },
  };
}
