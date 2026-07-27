// Преран-мастер: персонаж (соло) → арена → сложность → проклятия.
// Для коопа персонаж остаётся в лобби; здесь хост задаёт карту/danger/curses.

import { characterTipHtml } from './tooltip.js';

export function createSetupUi(root, config, t, tip) {
  const doc = root.ownerDocument;

  const panel = doc.createElement('div');
  panel.id = 'run-setup';
  panel.className = 'modal wide';
  panel.style.display = 'none';
  panel.innerHTML =
    '<div class="modal-title"></div>'
    + '<div class="modal-sub setup-hint"></div>'
    + '<div class="setup-body"></div>'
    + '<div class="shop-top setup-nav">'
    + '<button type="button" class="btn back"></button>'
    + '<button type="button" class="btn go next"></button>'
    + '</div>';
  root.appendChild(panel);

  const titleEl = panel.querySelector('.modal-title');
  const hintEl = panel.querySelector('.setup-hint');
  const bodyEl = panel.querySelector('.setup-body');
  const backBtn = panel.querySelector('.back');
  const nextBtn = panel.querySelector('.next');

  let mode = 'solo';       // solo | coop
  let step = 0;
  let profile = null;
  let onConfirm = null;
  let onCancel = null;

  const pick = {
    character: null,
    arena: null,
    danger: 0,
    curses: [],
  };

  function hasAch(id) {
    return !!(profile && profile.achievements
      && profile.achievements.some((a) => a.id === id));
  }

  function curseUnlocked(cid) {
    const c = config.curses && config.curses[cid];
    if (!c) return false;
    return hasAch(c.unlock_achievement);
  }

  function unlockedCurseCount() {
    let n = 0;
    const curses = config.curses || {};
    for (const id in curses) if (curseUnlocked(id)) n += 1;
    return n;
  }

  function steps() {
    const base = mode === 'solo'
      ? ['character', 'arena', 'danger']
      : ['arena', 'danger'];
    if (unlockedCurseCount() > 0) base.push('curses');
    return base;
  }

  function ownsArena(id) {
    const a = config.arenas[id];
    if (!a) return false;
    if (a.unlock && a.unlock.type === 'default') return true;
    return !!(profile && profile.unlocks && profile.unlocks.arena
      && profile.unlocks.arena.indexOf(id) >= 0);
  }

  function ownsCharacter(id) {
    const c = config.characters[id];
    if (!c) return false;
    if (c.unlock && c.unlock.type === 'default') return true;
    const f = config.factions[c.faction];
    const facOk = !f || (f.unlock && f.unlock.type === 'default')
      || (profile && profile.unlocks && profile.unlocks.faction
        && profile.unlocks.faction.indexOf(c.faction) >= 0);
    if (!facOk) return false;
    return !!(profile && profile.unlocks && profile.unlocks.character
      && profile.unlocks.character.indexOf(id) >= 0);
  }

  function firstOpen(kind) {
    if (kind === 'character') {
      for (const id in config.characters) if (ownsCharacter(id)) return id;
      for (const id in config.characters) return id;
    }
    if (kind === 'arena') {
      for (const id in config.arenas) if (ownsArena(id)) return id;
      for (const id in config.arenas) return id;
    }
    return null;
  }

  function toggleCurse(id) {
    if (!curseUnlocked(id)) return;
    const i = pick.curses.indexOf(id);
    if (i >= 0) pick.curses.splice(i, 1);
    else pick.curses.push(id);
    render();
  }

  // kind === 'character' включает подсказку с внешностью, статами и стартовым
  // оружием: до этого визард показывал только имя и строчку настроения.
  function renderChoiceGrid(entries, selected, onPick, isLocked, kind) {
    bodyEl.innerHTML = '';
    const grid = doc.createElement('div');
    grid.className = 'setup-grid';
    for (const id in entries) {
      const e = entries[id];
      const locked = isLocked && isLocked(id);
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'inv-cell' + (selected === id || selected === e.id ? ' locked' : '')
        + (locked ? ' empty' : '');
      btn.disabled = !!locked;
      const color = e.color || '#c9c4b8';
      btn.innerHTML = `<span class="inv-name" style="color:${color}">${e.name}</span>`
        + (e.desc ? `<span class="meta-sub">${e.desc}</span>` : '');
      if (!locked) {
        btn.addEventListener('click', () => onPick(id, e));
      }
      if (kind === 'character' && tip) {
        tip.bind(btn, () => characterTipHtml(config, id, t));
      }
      grid.appendChild(btn);
    }
    bodyEl.appendChild(grid);
  }

  function renderCurses() {
    bodyEl.innerHTML = '';
    // На остальных шагах в подсказке стоит НАЗВАНИЕ шага («Персонаж», «Арена»),
    // а здесь стояло только пояснение — единственный экран мастера без заголовка.
    hintEl.textContent = t('ui.setup.curses');
    const note = doc.createElement('div');
    note.className = 'meta-sub';
    note.textContent = t('ui.setup.curses_hint');
    bodyEl.appendChild(note);
    const grid = doc.createElement('div');
    grid.className = 'setup-grid';
    const curses = config.curses || {};
    for (const id in curses) {
      const c = curses[id];
      const open = curseUnlocked(id);
      const on = pick.curses.indexOf(id) >= 0;
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'inv-cell' + (on ? ' locked' : '') + (!open ? ' empty' : '');
      btn.disabled = !open;
      const ach = config.achievements[c.unlock_achievement];
      const lockHint = open ? ''
        : `<span class="meta-sub">${t('ui.setup.curse_locked')}: `
          + `${ach ? ach.name : c.unlock_achievement}</span>`;
      btn.innerHTML = `<span class="inv-name">${c.name}</span>`
        + `<span class="meta-sub">${c.desc}</span>${lockHint}`;
      if (open) btn.addEventListener('click', () => toggleCurse(id));
      grid.appendChild(btn);
    }
    bodyEl.appendChild(grid);
  }

  function render() {
    const list = steps();
    const kind = list[step];
    titleEl.textContent = t('ui.setup.title');
    hintEl.textContent = '';

    if (kind === 'character') {
      hintEl.textContent = t('ui.select.character');
      renderChoiceGrid(config.characters, pick.character, (id) => {
        pick.character = id;
        render();
      }, (id) => !ownsCharacter(id), 'character');
    } else if (kind === 'arena') {
      hintEl.textContent = t('ui.select.arena');
      renderChoiceGrid(config.arenas, pick.arena, (id) => {
        pick.arena = id;
        render();
      }, (id) => !ownsArena(id));
    } else if (kind === 'danger') {
      hintEl.textContent = t('ui.select.danger');
      bodyEl.innerHTML = '';
      const grid = doc.createElement('div');
      grid.className = 'setup-grid';
      for (let i = 0; i < config.danger.length; i++) {
        const d = config.danger[i];
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'inv-cell' + (pick.danger === d.id ? ' locked' : '');
        const ash = d.ash_mult != null ? d.ash_mult : 1;
        const bosses = d.bosses_final != null ? d.bosses_final : 1;
        btn.innerHTML = `<span class="inv-name">${d.name}</span>`
          + `<span class="meta-sub">HP×${d.hp_mult} · прах×${ash}`
          + (bosses > 1 ? ` · боссов×${bosses}` : '') + '</span>';
        btn.addEventListener('click', () => { pick.danger = d.id; render(); });
        grid.appendChild(btn);
      }
      bodyEl.appendChild(grid);
    } else {
      renderCurses();
    }

    const last = step >= list.length - 1;
    backBtn.textContent = step === 0 ? t('ui.common.back') : t('ui.setup.back');
    nextBtn.textContent = last
      ? (mode === 'solo' ? t('ui.setup.start') : t('ui.setup.create'))
      : t('ui.setup.next');
  }

  backBtn.addEventListener('click', () => {
    if (step === 0) {
      panel.style.display = 'none';
      if (onCancel) onCancel();
      return;
    }
    step -= 1;
    render();
  });

  nextBtn.addEventListener('click', () => {
    const list = steps();
    if (step < list.length - 1) {
      step += 1;
      render();
      return;
    }
    panel.style.display = 'none';
    if (onConfirm) {
      onConfirm({
        character: pick.character,
        arena: pick.arena,
        danger: pick.danger,
        curses: pick.curses.slice(),
        mode,
      });
    }
  });

  return {
    async show(opts) {
      mode = opts.mode || 'solo';
      onConfirm = opts.onConfirm || null;
      onCancel = opts.onCancel || null;
      profile = opts.profile || null;
      step = 0;
      pick.character = firstOpen('character');
      pick.arena = firstOpen('arena');
      pick.danger = config.danger[0] ? config.danger[0].id : 0;
      pick.curses = [];
      render();
      panel.style.display = '';
    },
    hide() { panel.style.display = 'none'; },
    get visible() { return panel.style.display !== 'none'; },
  };
}
