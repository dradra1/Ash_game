// Экраны M0: menu (кнопка «Играть») и game (панель скрыта, играет canvas).
// Все тексты — только через t(key) из config.i18n.

export function createScreens(root, config, t) {
  const doc = root.ownerDocument;

  const panel = doc.createElement('div');
  panel.id = 'screen-menu';

  const playBtn = doc.createElement('button');
  playBtn.type = 'button';
  playBtn.id = 'btn-play';
  playBtn.textContent = t('ui.menu.play');
  panel.appendChild(playBtn);
  root.appendChild(panel);

  let onPlay = null;
  playBtn.addEventListener('click', () => {
    if (onPlay) onPlay();
  });

  const screens = {
    current: 'menu',

    show(name, data) {
      screens.current = name;
      if (name === 'menu') {
        panel.style.display = '';
        if (data && data.onPlay) onPlay = data.onPlay;
      } else if (name === 'game') {
        panel.style.display = 'none';
      }
    },
  };

  return screens;
}
