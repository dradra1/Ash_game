// Реликварий: счётчик реликвий, дерево фракций, карточки персонажей,
// стеллаж оружия, постоянные улучшения, прогресс ачивок.
//
// Экран только ОТОБРАЖАЕТ то, что разрешил сервер: цена, баланс и сама покупка
// проверяются в /api/meta/unlock. Здесь ничего не начисляется.

import { statsHtml, iconHtml } from './tooltip.js';

export function createMetaUi(root, config, t, api) {
  const doc = root.ownerDocument;

  const panel = doc.createElement('div');
  panel.id = 'reliquary';
  panel.className = 'modal wide';
  panel.style.display = 'none';
  panel.innerHTML =
    '<div class="modal-title"></div>'
    + '<div class="shop-top"><div class="ash relics"></div>'
    + '<button type="button" class="btn back"></button></div>'
    + '<div class="meta-tabs"></div>'
    + '<div class="meta-body"></div>';
  root.appendChild(panel);

  const titleEl = panel.querySelector('.modal-title');
  const relicsEl = panel.querySelector('.relics');
  const backBtn = panel.querySelector('.back');
  const tabsEl = panel.querySelector('.meta-tabs');
  const bodyEl = panel.querySelector('.meta-body');

  backBtn.textContent = t('ui.common.back');

  const TABS = [
    ['factions', 'ui.meta.factions'],
    ['characters', 'ui.select.character'],
    ['weapons', 'ui.shop.inventory'],
    ['upgrades', 'ui.meta.upgrades'],
    ['achievements', 'ui.meta.achievements'],
  ];
  let tab = 'factions';
  let profile = null;
  let onBack = null;
  let busy = false;

  function owns(kind, id) {
    return !!(profile && profile.unlocks && profile.unlocks[kind]
      && profile.unlocks[kind].indexOf(id) >= 0);
  }

  function isDefault(entry) {
    return !!(entry.unlock && entry.unlock.type === 'default');
  }

  function hasAch(id) {
    return !!(profile && profile.achievements
      && profile.achievements.some((a) => a.id === id));
  }

  // Цена с учётом скидки за ачивку — ровно та же формула, что на сервере
  function priceOf(kind, id) {
    const entry = kind === 'weapon' ? config.weapons[id]
      : kind === 'character' ? config.characters[id]
        : kind === 'arena' ? config.arenas[id] : config.factions[id];
    if (!entry || isDefault(entry)) return null;
    const unlock = entry.unlock || {};
    let cost = kind === 'weapon'
      ? config.meta.weapon_unlock_price[String(unlock.tier || 1)]
      : unlock.cost;
    if (cost === undefined || cost === null) return null;
    if (unlock.achievement && hasAch(unlock.achievement)) {
      cost = Math.round(cost * config.meta.achievement_discount);
    }
    return cost;
  }

  async function buy(kind, id) {
    if (busy) return;
    busy = true;
    const res = await api.unlock(kind, id);
    busy = false;
    if (res && res.ok) {
      profile = await api.profile();
      render();
    } else if (res && res.error) {
      flash(t('ui.error.' + res.error) || res.error);
    }
  }

  function flash(text) {
    relicsEl.textContent = text;
    doc.defaultView.setTimeout(renderTop, 1400);
  }

  function card(opts) {
    const el = doc.createElement('div');
    el.className = 'meta-card' + (opts.owned ? ' owned' : '')
      + (opts.locked ? ' locked-out' : '');
    el.style.borderColor = opts.color || '#3a3f4a';
    let html = iconHtml(opts.icon, 'icon-lg')
      + `<div class="meta-name" style="color:${opts.color || '#c9c4b8'}">`
      + `${opts.name}</div>`;
    if (opts.sub) html += `<div class="meta-sub">${opts.sub}</div>`;
    if (opts.body) html += opts.body;
    html += '<div class="meta-foot">'
      + (opts.owned ? `<span class="owned-tag">${t('ui.meta.owned')}</span>`
        : opts.price !== null && opts.price !== undefined
          ? `<span class="price">${opts.price}</span>` : '')
      + '</div>';
    el.innerHTML = html;
    if (!opts.owned && opts.price !== null && opts.price !== undefined && !opts.locked) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'mini buy';
      btn.textContent = t('ui.meta.unlock');
      btn.addEventListener('click', opts.onBuy);
      el.appendChild(btn);
    }
    return el;
  }

  function renderFactions() {
    for (const id in config.factions) {
      const f = config.factions[id];
      const owned = isDefault(f) || owns('faction', id);
      const chars = Object.keys(config.characters)
        .filter((c) => config.characters[c].faction === id).length;
      bodyEl.appendChild(card({
        name: f.name, color: f.color, owned,
        sub: f.desc,
        body: `<div class="meta-line">${t('ui.select.character')}: ${chars}</div>`,
        price: priceOf('faction', id),
        onBuy: () => buy('faction', id),
      }));
    }
  }

  function renderCharacters() {
    for (const id in config.characters) {
      const c = config.characters[id];
      const f = config.factions[c.faction];
      const factionOpen = isDefault(f) || owns('faction', c.faction);
      const owned = isDefault(c) || owns('character', id);
      const need = (c.unlock || {}).achievement;
      let body = `<div class="meta-line">${f.name}</div>`;
      if (Object.keys(c.stats).length) body += statsHtml(config, c.stats);
      if (need) {
        body += `<div class="meta-line${hasAch(need) ? ' done' : ''}">`
          + `${config.achievements[need] ? config.achievements[need].name : need}`
          + `${hasAch(need) ? ' ✓ −50%' : ''}</div>`;
      }
      bodyEl.appendChild(card({
        name: c.name, color: c.color, owned,
        sub: c.desc, body,
        locked: !factionOpen && !owned,
        price: priceOf('character', id),
        onBuy: () => buy('character', id),
      }));
    }
  }

  function renderWeapons() {
    // Стеллаж: показываем только первый тир каждого семейства — открывается
    // семейство целиком, тиры дальше добываются слиянием в лавке.
    for (const id in config.weapons) {
      const w = config.weapons[id];
      if (w.tier !== 1) continue;
      const owned = isDefault(w) || owns('weapon', id);
      bodyEl.appendChild(card({
        name: w.name, color: config.shop.tier_color[0],
        icon: w.texture,
        owned,
        sub: t('ui.class.' + w.class),
        body: `<div class="meta-line">${Math.round(w.damage)} / ${w.cooldown.toFixed(2)}с</div>`
          + `<div class="meta-line">${w.tags.join(', ')}</div>`,
        price: priceOf('weapon', id),
        onBuy: () => buy('weapon', id),
      }));
    }
  }

  function renderUpgrades() {
    const ranks = (profile && profile.upgrades) || {};
    for (const up of config.meta.upgrades) {
      const rank = ranks[up.id] || 0;
      const maxed = rank >= up.max_ranks;
      const price = maxed ? null : up.price[Math.min(rank, up.price.length - 1)];
      bodyEl.appendChild(card({
        name: up.name, color: '#c8a35a', owned: maxed,
        icon: up.texture,
        sub: `+${up.step} ${up.stat}`,
        body: `<div class="meta-line">${t('ui.meta.rank')}: ${rank} / ${up.max_ranks}</div>`,
        price,
        onBuy: () => buy('upgrade', up.id),
      }));
    }
  }

  function renderAchievements() {
    for (const id in config.achievements) {
      const a = config.achievements[id];
      const done = hasAch(id);
      bodyEl.appendChild(card({
        name: a.name, color: done ? '#a8d07a' : '#7a7568',
        owned: done, sub: a.desc,
      }));
    }
  }

  function renderTop() {
    titleEl.textContent = t('ui.menu.reliquary');
    relicsEl.textContent = t('ui.meta.relics') + ': '
      + ((profile && profile.relics) || 0);
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const [key, label] of TABS) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'btn tab' + (tab === key ? ' active' : '');
      btn.textContent = t(label);
      btn.addEventListener('click', () => { tab = key; render(); });
      tabsEl.appendChild(btn);
    }
  }

  function render() {
    renderTop();
    renderTabs();
    bodyEl.innerHTML = '';
    if (tab === 'factions') renderFactions();
    else if (tab === 'characters') renderCharacters();
    else if (tab === 'weapons') renderWeapons();
    else if (tab === 'upgrades') renderUpgrades();
    else renderAchievements();
  }

  backBtn.addEventListener('click', () => {
    panel.style.display = 'none';
    if (onBack) onBack();
  });

  return {
    async show(back) {
      onBack = back;
      profile = await api.profile();
      render();
      panel.style.display = '';
    },
    hide() { panel.style.display = 'none'; },
    get visible() { return panel.style.display !== 'none'; },
  };
}
