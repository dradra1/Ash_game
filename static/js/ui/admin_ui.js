// Админ-панель: редактирование живого конфига (персонажи, оружие, улучшения, ачивки).
// Доступ только по вайтлисту на сервере. Читы в забеге — отдельно в pause_ui.

export function createAdminUi(root, config, t, api) {
  const doc = root.ownerDocument;

  const panel = doc.createElement('div');
  panel.id = 'admin';
  panel.className = 'modal wide';
  panel.style.display = 'none';
  panel.innerHTML =
    '<div class="modal-title"></div>'
    + '<div class="shop-top">'
    + '<button type="button" class="btn save"></button>'
    + '<button type="button" class="btn back"></button></div>'
    + '<div class="meta-tabs"></div>'
    + '<div class="meta-body admin-body"></div>'
    + '<div class="error admin-err"></div>';
  root.appendChild(panel);

  const titleEl = panel.querySelector('.modal-title');
  const saveBtn = panel.querySelector('.save');
  const backBtn = panel.querySelector('.back');
  const tabsEl = panel.querySelector('.meta-tabs');
  const bodyEl = panel.querySelector('.meta-body');
  const errEl = panel.querySelector('.admin-err');

  titleEl.textContent = t('ui.admin.title');
  saveBtn.textContent = t('ui.admin.save');
  backBtn.textContent = t('ui.common.back');

  const TABS = [
    ['characters', 'ui.select.character'],
    ['weapons', 'ui.shop.inventory'],
    ['upgrades', 'ui.meta.upgrades'],
    ['achievements', 'ui.meta.achievements'],
    ['curses', 'ui.meta.curses'],
  ];

  let tab = 'characters';
  let onBack = null;
  let live = null;
  let draft = null;
  let busy = false;
  let selectedId = null;

  function setErr(msg) {
    errEl.textContent = msg || '';
  }

  for (let i = 0; i < TABS.length; i++) {
    const [id, key] = TABS[i];
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'btn tab';
    b.dataset.tab = id;
    b.textContent = t(key);
    b.addEventListener('click', () => {
      tab = id;
      selectedId = null;
      render();
    });
    tabsEl.appendChild(b);
  }

  backBtn.addEventListener('click', () => {
    panel.style.display = 'none';
    if (onBack) onBack();
  });

  saveBtn.addEventListener('click', async () => {
    if (busy || !draft) return;
    busy = true;
    setErr('');
    try {
      const section = tab === 'upgrades' ? 'meta.upgrades' : tab;
      const payload = tab === 'upgrades'
        ? draft.meta.upgrades
        : draft[tab];
      const res = await api.save(section, payload);
      if (res && res.error) setErr(res.error);
      else {
        live = res.config || live;
        setErr(t('ui.admin.saved'));
      }
    } catch (e) {
      setErr(String(e.message || e));
    }
    busy = false;
  });

  function sectionData() {
    if (tab === 'upgrades') return draft.meta.upgrades;
    return draft[tab];
  }

  function idsOf(data) {
    if (Array.isArray(data)) {
      return data.map((x, i) => x.id || String(i));
    }
    return Object.keys(data);
  }

  function getEntry(id) {
    const data = sectionData();
    if (Array.isArray(data)) {
      return data.find((x) => x.id === id) || data[Number(id)];
    }
    return data[id];
  }

  function editableFields(entry) {
    if (!entry || typeof entry !== 'object') return [];
    const out = [];
    if (tab === 'characters') {
      const stats = entry.stats || {};
      for (const k in stats) out.push(['stats.' + k, stats[k]]);
      const lw = entry.levelup_weights || {};
      for (const k in lw) out.push(['levelup_weights.' + k, lw[k]]);
    } else if (tab === 'weapons') {
      const keys = ['damage', 'cooldown', 'range', 'knockback', 'crit_pct', 'price', 'tier'];
      for (let i = 0; i < keys.length; i++) {
        if (entry[keys[i]] !== undefined) out.push([keys[i], entry[keys[i]]]);
      }
    } else if (tab === 'upgrades') {
      const keys = ['stat', 'step', 'max_ranks'];
      for (let i = 0; i < keys.length; i++) {
        if (entry[keys[i]] !== undefined) out.push([keys[i], entry[keys[i]]]);
      }
      if (Array.isArray(entry.price)) {
        for (let i = 0; i < entry.price.length; i++) {
          out.push(['price.' + i, entry.price[i]]);
        }
      }
    } else if (tab === 'achievements') {
      out.push(['name', entry.name || '']);
      out.push(['desc', entry.desc || '']);
      if (entry.cond) {
        out.push(['cond.type', entry.cond.type || '']);
        out.push(['cond.value', entry.cond.value]);
      }
    } else if (tab === 'curses') {
      out.push(['name', entry.name || '']);
      out.push(['desc', entry.desc || '']);
      out.push(['unlock_achievement', entry.unlock_achievement || '']);
    }
    return out;
  }

  function setField(entry, path, value) {
    const parts = path.split('.');
    if (parts.length === 1) {
      const num = Number(value);
      entry[parts[0]] = (value !== '' && !Number.isNaN(num) && String(num) === String(value).trim())
        ? num : value;
      return;
    }
    let cur = entry;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] === undefined || cur[parts[i]] === null) {
        cur[parts[i]] = {};
      }
      cur = cur[parts[i]];
    }
    const last = parts[parts.length - 1];
    const num = Number(value);
    cur[last] = (value !== '' && !Number.isNaN(num) && String(num) === String(value).trim())
      ? num : value;
  }

  function render() {
    for (let i = 0; i < tabsEl.children.length; i++) {
      const b = tabsEl.children[i];
      b.classList.toggle('active', b.dataset.tab === tab);
    }
    bodyEl.innerHTML = '';
    if (!draft) {
      bodyEl.textContent = t('ui.common.loading');
      return;
    }
    const data = sectionData();
    const ids = idsOf(data);
    if (!selectedId && ids.length) selectedId = ids[0];

    const list = doc.createElement('div');
    list.className = 'admin-list';
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'btn mini' + (id === selectedId ? ' active' : '');
      const entry = getEntry(id);
      b.textContent = (entry && entry.name) ? (id + ' — ' + entry.name) : id;
      b.addEventListener('click', () => { selectedId = id; render(); });
      list.appendChild(b);
    }
    bodyEl.appendChild(list);

    const entry = getEntry(selectedId);
    if (!entry) return;
    const form = doc.createElement('div');
    form.className = 'admin-form';
    const fields = editableFields(entry);
    for (let i = 0; i < fields.length; i++) {
      const [path, val] = fields[i];
      const row = doc.createElement('label');
      row.className = 'admin-field';
      row.textContent = path;
      const input = doc.createElement('input');
      input.type = 'text';
      input.value = val === undefined || val === null ? '' : String(val);
      input.addEventListener('change', () => setField(entry, path, input.value));
      row.appendChild(input);
      form.appendChild(row);
    }
    bodyEl.appendChild(form);
  }

  return {
    async show(back) {
      onBack = back;
      setErr('');
      panel.style.display = '';
      try {
        live = await api.load();
        draft = JSON.parse(JSON.stringify(live));
      } catch (e) {
        setErr(String(e.message || e));
        draft = JSON.parse(JSON.stringify({
          characters: config.characters,
          weapons: config.weapons,
          achievements: config.achievements,
          curses: config.curses || {},
          meta: { upgrades: config.meta.upgrades },
        }));
      }
      render();
    },
    hide() { panel.style.display = 'none'; },
    get visible() { return panel.style.display !== 'none'; },
  };
}
