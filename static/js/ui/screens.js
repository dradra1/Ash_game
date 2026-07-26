// Экраны: menu (соло / кооп / вход по коду) и game (панель скрыта, играет canvas).
// Все тексты — только через t(key) из config.i18n.

export function createScreens(root, config, t) {
  const doc = root.ownerDocument;

  const panel = doc.createElement('div');
  panel.id = 'screen-menu';
  panel.className = 'menu';

  const title = doc.createElement('div');
  title.className = 'menu-title';
  title.textContent = t('ui.menu.play');
  panel.appendChild(title);

  const playBtn = doc.createElement('button');
  playBtn.type = 'button';
  playBtn.id = 'btn-play';
  playBtn.className = 'btn';
  playBtn.textContent = t('ui.menu.solo');
  panel.appendChild(playBtn);

  const coopBtn = doc.createElement('button');
  coopBtn.type = 'button';
  coopBtn.id = 'btn-coop';
  coopBtn.className = 'btn';
  coopBtn.textContent = t('ui.menu.coop');
  panel.appendChild(coopBtn);

  const metaBtn = doc.createElement('button');
  metaBtn.type = 'button';
  metaBtn.id = 'btn-meta';
  metaBtn.className = 'btn';
  metaBtn.textContent = t('ui.menu.reliquary');
  panel.appendChild(metaBtn);

  const adminBtn = doc.createElement('button');
  adminBtn.type = 'button';
  adminBtn.id = 'btn-admin';
  adminBtn.className = 'btn';
  adminBtn.textContent = t('ui.admin.title');
  adminBtn.style.display = 'none';
  panel.appendChild(adminBtn);

  const joinRow = doc.createElement('div');
  joinRow.className = 'join-row';
  const codeInput = doc.createElement('input');
  codeInput.id = 'join-code';
  codeInput.maxLength = config.net.room_code_len;
  codeInput.placeholder = t('ui.lobby.code');
  const joinBtn = doc.createElement('button');
  joinBtn.type = 'button';
  joinBtn.id = 'btn-join';
  joinBtn.className = 'btn';
  joinBtn.textContent = t('ui.lobby.ready');
  joinRow.appendChild(codeInput);
  joinRow.appendChild(joinBtn);
  panel.appendChild(joinRow);

  const logoutBtn = doc.createElement('button');
  logoutBtn.type = 'button';
  logoutBtn.id = 'btn-logout';
  logoutBtn.className = 'btn';
  logoutBtn.textContent = t('ui.menu.logout');
  panel.appendChild(logoutBtn);

  const errEl = doc.createElement('div');
  errEl.className = 'error';
  panel.appendChild(errEl);

  root.appendChild(panel);

  let handlers = {};

  playBtn.addEventListener('click', () => handlers.onPlay && handlers.onPlay());
  coopBtn.addEventListener('click', () => handlers.onCoop && handlers.onCoop());
  metaBtn.addEventListener('click', () => handlers.onMeta && handlers.onMeta());
  adminBtn.addEventListener('click', () => handlers.onAdmin && handlers.onAdmin());
  logoutBtn.addEventListener('click', () => handlers.onLogout && handlers.onLogout());
  joinBtn.addEventListener('click', async () => {
    if (!handlers.onJoin) return;
    errEl.textContent = '';
    const res = await handlers.onJoin(codeInput.value.trim().toUpperCase());
    if (res && res.error) errEl.textContent = t('ui.error.' + res.error);
  });

  const screens = {
    current: 'menu',

    show(name, data) {
      screens.current = name;
      if (name === 'menu') {
        panel.style.display = '';
        errEl.textContent = '';
        if (data) handlers = data;
        if (data && data.invited) codeInput.value = data.invited;
        adminBtn.style.display = data && data.onAdmin ? '' : 'none';
      } else {
        panel.style.display = 'none';
      }
    },
  };

  return screens;
}
