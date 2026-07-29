// Город — точка входа в игру: фон-картинка, поверх неё кликабельные здания.
// Каждое здание — кнопка с действием из config.city.buildings: meta (раздел
// реликвария), play (настройка забега), none (резерв, «скоро»).
//
// cityState — чистая функция «конфиг + профиль → состояние зданий», без DOM:
// её гоняют node-тесты. createCity — экран поверх неё.
//
// В коде нет ни одного id здания: резерв и разделы различаются только по
// action.type и списку вкладок (CLAUDE.md §3.1 — контент живёт в конфиге).

// Та же проверка, что hasAch в meta_ui.js: ачивки в профиле — список объектов
function hasAch(profile, id) {
  return !!(profile && profile.achievements
    && profile.achievements.some((a) => a.id === id));
}

function owns(profile, kind, id) {
  return !!(profile && profile.unlocks && profile.unlocks[kind]
    && profile.unlocks[kind].indexOf(id) >= 0);
}

function isDefault(entry) {
  return !!(entry && entry.unlock && entry.unlock.type === 'default');
}

// Цена с учётом скидки за ачивку — ровно та же формула, что priceOf в meta_ui.js.
// Расходиться с ней нельзя: бейдж «Новое» обещает покупку, которую реликварий
// потом не даст.
function priceOf(config, profile, kind, id) {
  const entry = kind === 'weapon' ? config.weapons[id]
    : kind === 'character' ? config.characters[id]
      : kind === 'arena' ? config.arenas[id]
        : config.factions[id];
  if (!entry || isDefault(entry)) return null;
  const unlock = entry.unlock || {};
  let cost = kind === 'weapon'
    ? config.meta.weapon_unlock_price[String(unlock.tier || 1)]
    : unlock.cost;
  if (cost === undefined || cost === null) return null;
  if (unlock.achievement && hasAch(profile, unlock.achievement)) {
    cost = Math.round(cost * config.meta.achievement_discount);
  }
  return cost;
}

function dictAffordable(config, profile, relics, dict, kind) {
  for (const id in dict) {
    const entry = dict[id];
    if (isDefault(entry) || owns(profile, kind, id)) continue;
    const price = priceOf(config, profile, kind, id);
    if (price !== null && relics >= price) return true;
  }
  return false;
}

// «Есть ли во вкладке хоть одна строка контента» — по вкладке, не по зданию
const HAS_CONTENT = {
  factions: (config) => !!(config.factions && Object.keys(config.factions).length),
  characters: (config) => !!(config.characters && Object.keys(config.characters).length),
  weapons: (config) => !!(config.weapons && Object.keys(config.weapons).length),
  arenas: (config) => !!(config.arenas && Object.keys(config.arenas).length),
  upgrades: (config) => !!(config.meta && config.meta.upgrades
    && config.meta.upgrades.length),
  achievements: (config) => !!(config.achievements
    && Object.keys(config.achievements).length),
  // Та же логика, что anyCurseUnlocked в meta_ui.js: раздел открывается
  // первой ачивкой-отмычкой
  curses: (config, profile) => {
    const curses = config.curses || {};
    for (const id in curses) {
      if (hasAch(profile, curses[id].unlock_achievement)) return true;
    }
    return false;
  },
};

// «Можно ли прямо сейчас что-то купить во вкладке» — по вкладке, не по зданию
const CAN_AFFORD = {
  factions: (config, profile, relics) =>
    dictAffordable(config, profile, relics, config.factions || {}, 'faction'),
  characters: (config, profile, relics) => {
    for (const id in (config.characters || {})) {
      const c = config.characters[id];
      if (isDefault(c) || owns(profile, 'character', id)) continue;
      // Персонаж закрытой фракции недоступен — как locked в renderCharacters
      const f = config.factions[c.faction];
      if (!(isDefault(f) || owns(profile, 'faction', c.faction))) continue;
      const price = priceOf(config, profile, 'character', id);
      if (price !== null && relics >= price) return true;
    }
    return false;
  },
  weapons: (config, profile, relics) => {
    for (const id in (config.weapons || {})) {
      // Открывается семейство целиком — продаётся только первый тир
      if (config.weapons[id].tier !== 1) continue;
      const w = config.weapons[id];
      if (isDefault(w) || owns(profile, 'weapon', id)) continue;
      const price = priceOf(config, profile, 'weapon', id);
      if (price !== null && relics >= price) return true;
    }
    return false;
  },
  upgrades: (config, profile, relics) => {
    const ranks = (profile && profile.upgrades) || {};
    const ups = (config.meta && config.meta.upgrades) || [];
    for (const up of ups) {
      const rank = ranks[up.id] || 0;
      if (rank >= up.max_ranks) continue;
      const price = up.price[Math.min(rank, up.price.length - 1)];
      if (relics >= price) return true;
    }
    return false;
  },
  arenas: (config, profile, relics) =>
    dictAffordable(config, profile, relics, config.arenas || {}, 'arena'),
  achievements: () => false,
  curses: () => false,
};

export function cityState(config, profile) {
  const city = config && config.city;
  if (!city || !Array.isArray(city.buildings)) return [];
  const relics = (profile && profile.relics) || 0;
  const out = [];
  for (const b of city.buildings) {
    const action = b.action || { type: 'none' };
    const reserved = action.type === 'none';
    let locked = false;
    let unlockable = false;
    if (action.type === 'meta') {
      const tabs = action.tabs || [];
      let anyContent = false;
      for (const tab of tabs) {
        const fn = HAS_CONTENT[tab];
        if (fn && fn(config, profile)) { anyContent = true; break; }
      }
      locked = !anyContent;
      if (!locked) {
        for (const tab of tabs) {
          const fn = CAN_AFFORD[tab];
          if (fn && fn(config, profile, relics)) { unlockable = true; break; }
        }
      }
    }
    out.push({
      id: b.id,
      locked,
      reserved,
      unlockable: reserved ? false : unlockable,
      // В профиле пока нет отметок «просмотрено» — поле добавляется отдельной
      // задачей, до её появления бейдж «Новое» по новизне не горит
      hasNew: false,
      texture: locked && b.texture_locked ? b.texture_locked : b.texture,
      x: b.x, y: b.y, w: b.w, h: b.h,
      color: b.color,
      name: b.name,
      hint: b.hint,
      action,
    });
  }
  return out;
}

// --- экран -----------------------------------------------------------------

export function createCity(root, config, profile, t, on) {
  const doc = root.ownerDocument;
  const city = config.city || {};
  const W = city.width || 1;
  const H = city.height || 1;

  // id и класс menu сохранены от старого меню: на них завязаны focus.js
  // (навигация падом ищет `.menu`) и сквозные инструменты.
  const panel = doc.createElement('div');
  panel.id = 'screen-menu';
  panel.className = 'menu city-screen';
  panel.style.display = 'none';
  panel.setAttribute('aria-label', t('ui.city.title'));

  const cityEl = doc.createElement('div');
  cityEl.className = 'city';
  // Размеры фона — только из конфига: CSS считает aspect-ratio и ширину
  // через эти переменные, чисел 1024×576 в стилях нет
  cityEl.style.setProperty('--city-w', W);
  cityEl.style.setProperty('--city-h', H);

  const bg = doc.createElement('img');
  bg.className = 'city-bg';
  bg.loading = 'lazy';
  bg.alt = '';
  bg.src = '/static/textures/' + city.background + '.png';
  // Нет PNG — тёмная подложка контейнера, а не сломанная иконка (§3.3)
  bg.addEventListener('error', () => { bg.style.display = 'none'; });
  cityEl.appendChild(bg);

  // --- верхняя панель: реликвии слева, действия справа ---
  const top = doc.createElement('div');
  top.className = 'city-top';

  const relicsEl = doc.createElement('div');
  relicsEl.className = 'city-relics';
  top.appendChild(relicsEl);

  const actions = doc.createElement('div');
  actions.className = 'city-actions';
  top.appendChild(actions);

  function mkBtn(id, text, fn) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.id = id;
    btn.className = 'btn';
    btn.textContent = text;
    btn.addEventListener('click', fn);
    return btn;
  }

  actions.appendChild(mkBtn('btn-coop', t('ui.menu.coop'),
    () => on.coop && on.coop()));

  const joinRow = doc.createElement('div');
  joinRow.className = 'join-row city-join';
  const codeInput = doc.createElement('input');
  codeInput.id = 'join-code';
  codeInput.maxLength = config.net.room_code_len;
  codeInput.placeholder = t('ui.lobby.code');
  joinRow.appendChild(codeInput);
  actions.appendChild(joinRow);

  const errEl = doc.createElement('div');
  errEl.className = 'city-error';

  async function doJoin() {
    if (!on.join) return;
    errEl.textContent = '';
    const res = await on.join(codeInput.value.trim().toUpperCase());
    if (res && res.error) errEl.textContent = t('ui.error.' + res.error);
  }
  joinRow.appendChild(mkBtn('btn-join', t('ui.lobby.ready'), doJoin));
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin();
  });

  actions.appendChild(mkBtn('btn-audio', t('ui.audio.title'),
    () => on.audio && on.audio()));

  const adminBtn = mkBtn('btn-admin', t('ui.admin.title'),
    () => on.admin && on.admin());
  adminBtn.style.display = 'none';
  actions.appendChild(adminBtn);

  actions.appendChild(mkBtn('btn-logout', t('ui.menu.logout'),
    () => on.logout && on.logout()));

  top.appendChild(errEl);
  cityEl.appendChild(top);

  // --- здания: разметка строится один раз, show() только обновляет состояние ---
  const buttons = [];
  for (const b of (city.buildings || [])) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'city-b';
    // Плашка у крайних домов прижимается к краю, чтобы не вылезать за
    // контейнер. Считается один раз по координатам фона, не на каждый hover.
    const cx = b.x + b.w / 2;
    if (cx < W / 3) btn.classList.add('tip-left');
    else if (cx > W * 2 / 3) btn.classList.add('tip-right');
    // Положение — в процентах от размеров фона через переменные: в компактном
    // режиме CSS отменяет их классом, инлайн-пикселей нет
    btn.style.setProperty('--l', (b.x / W * 100) + '%');
    btn.style.setProperty('--t', (b.y / H * 100) + '%');
    btn.style.setProperty('--w', (b.w / W * 100) + '%');
    btn.style.setProperty('--h', (b.h / H * 100) + '%');
    btn.style.setProperty('--accent', b.color);

    const img = doc.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    // Нет PNG — цветная подложка кнопки с подписью (§3.3), как iconHtml.
    // Заливка включается КЛАССОМ и только при осечке: у зданий силуэт с альфой,
    // и цветной прямоугольник под ним превратил бы город в набор плашек.
    img.addEventListener('error', () => {
      img.style.display = 'none';
      btn.classList.add('no-tex');
    });
    img.addEventListener('load', () => { btn.classList.remove('no-tex'); });
    btn.appendChild(img);

    const label = doc.createElement('span');
    label.className = 'city-label';
    label.textContent = t(b.name);
    btn.appendChild(label);

    const tip = doc.createElement('span');
    tip.className = 'city-tip';
    const tipName = doc.createElement('b');
    tipName.textContent = t(b.name);
    const tipHint = doc.createElement('i');
    tipHint.textContent = t(b.hint);
    tip.appendChild(tipName);
    tip.appendChild(tipHint);
    btn.appendChild(tip);

    const badge = doc.createElement('span');
    badge.className = 'badge';
    btn.appendChild(badge);

    // Резерв: экран не меняется, только плашка «скоро» на пару секунд —
    // снимается по таймеру или по уходу мыши/фокуса
    let tm = 0;
    const unpoke = () => btn.classList.remove('poke');
    btn.addEventListener('mouseleave', unpoke);
    btn.addEventListener('blur', unpoke);

    btn.addEventListener('click', () => {
      const a = b.action || {};
      if (a.type === 'meta') {
        if (on.meta) on.meta(a.tabs);
      } else if (a.type === 'play') {
        if (on.play) on.play();
      } else {
        btn.classList.add('poke');
        doc.defaultView.clearTimeout(tm);
        tm = doc.defaultView.setTimeout(unpoke, 2000);
      }
    });

    cityEl.appendChild(btn);
    buttons.push({ btn, img, badge });
  }

  panel.appendChild(cityEl);
  root.appendChild(panel);

  return {
    show(prof) {
      const states = cityState(config, prof);
      relicsEl.textContent = t('ui.meta.relics') + ': '
        + ((prof && prof.relics) || 0);
      for (let i = 0; i < buttons.length; i++) {
        const s = states[i];
        const { btn, img, badge } = buttons[i];
        btn.disabled = s.locked;
        btn.setAttribute('aria-label',
          t(s.name) + (s.locked ? ' — ' + t('ui.city.locked') : ''));
        const src = '/static/textures/' + s.texture + '.png';
        if (img.getAttribute('src') !== src) {
          img.style.display = '';
          img.src = src;
        }
        if (s.locked) {
          badge.className = 'badge locked';
          badge.textContent = t('ui.city.locked');
        } else if (s.unlockable || s.hasNew) {
          badge.className = 'badge new';
          badge.textContent = t('ui.city.new');
        } else {
          badge.className = 'badge';
          badge.textContent = '';
        }
      }
      errEl.textContent = '';
      panel.style.display = '';
    },
    hide() { panel.style.display = 'none'; },
    get visible() { return panel.style.display !== 'none'; },

    // Причина осечки старта забега (screens.error) и ошибка входа по коду
    error(text) { errEl.textContent = text || ''; },
    // Админка видна не всем — флаг приходит с каждым show('menu', data)
    setAdminVisible(flag) { adminBtn.style.display = flag ? '' : 'none'; },
    // Приглашение по ссылке подставляется в поле кода комнаты
    setCode(code) { codeInput.value = code || ''; },
  };
}
