// Лавка между волнами: 4 карточки, реролл, лок, инвентарь оружия со слиянием
// и продажей, сетка предметов, панель статов, кнопка «Готов».
// Геймпад: фокус слота + buy/lock/merge/reroll/ready через input.consumePressed.

import { mergeable } from '../sim/shop.js';
import { statsHtml, iconHtml } from './tooltip.js';

export function createShopUi(root, config, t, tip) {
  const doc = root.ownerDocument;

  const panel = doc.createElement('div');
  panel.id = 'shop';
  panel.className = 'modal wide';
  panel.style.display = 'none';

  panel.innerHTML =
    '<div class="modal-title"></div>'
    + '<div class="shop-top"><div class="ash"></div>'
    + '<button type="button" class="btn reroll"></button>'
    + '<button type="button" class="btn go"></button></div>'
    + '<div class="shop-slots"></div>'
    + '<div class="shop-cols">'
    + '<div class="col"><div class="col-title"></div><div class="inv-weapons"></div></div>'
    + '<div class="col"><div class="col-title"></div><div class="inv-items"></div></div>'
    + '<div class="col"><div class="col-title"></div><div class="stat-list"></div></div>'
    + '</div>';
  root.appendChild(panel);

  const q = (sel) => panel.querySelector(sel);
  const titleEl = q('.modal-title');
  const ashEl = q('.ash');
  const rerollBtn = q('.reroll');
  const goBtn = q('.go');
  const slotsEl = q('.shop-slots');
  const cols = panel.querySelectorAll('.col-title');
  const weaponsEl = q('.inv-weapons');
  const itemsEl = q('.inv-items');
  const statsEl = q('.stat-list');

  cols[0].textContent = t('ui.shop.inventory');
  cols[1].textContent = t('ui.shop.items');
  cols[2].textContent = t('ui.shop.stats');

  // Адаптер: UI не знает, своя это лавка или чужая, полученная по сети.
  // У хоста и в соло действия применяются сразу, у клиента — уезжают событием.
  let ctx = null;   // {slots, player, wave, rerollCost, act(kind, a, b)}
  let focusSlot = 0;

  function slotCount() {
    if (!ctx) return 0;
    const slots = ctx.slots();
    return slots ? slots.length : 0;
  }

  function clampFocus() {
    const n = slotCount();
    if (n <= 0) {
      focusSlot = 0;
      return;
    }
    if (focusSlot < 0) focusSlot = 0;
    if (focusSlot >= n) focusSlot = n - 1;
  }

  function tierColor(tier) {
    return config.shop.tier_color[tier - 1] || '#9aa0a8';
  }

  function cardHtml(cfg, kind) {
    const head = iconHtml(cfg.texture, 'icon-lg')
      + `<div class="card-name" style="color:${tierColor(cfg.tier)}">${cfg.name}</div>`;
    const tierRow = `<div class="card-tier">${'I'.repeat(cfg.tier).replace('IIII', 'IV')}</div>`;
    if (kind === 'weapon') {
      return head + tierRow
        + `<div class="card-line">${t('ui.class.' + cfg.class)}</div>`
        + `<div class="card-line">${Math.round(cfg.damage)} / ${cfg.cooldown.toFixed(2)}с</div>`;
    }
    return head + tierRow + statsHtml(config, cfg.stats)
      + (cfg.desc ? `<div class="card-desc">${cfg.desc}</div>` : '');
  }

  function renderSlots() {
    slotsEl.innerHTML = '';
    const slots = ctx.slots();
    clampFocus();
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const card = doc.createElement('div');
      card.className = 'card'
        + (s.sold ? ' sold' : '')
        + (s.locked ? ' locked' : '')
        + (i === focusSlot ? ' focused' : '');
      if (!s.cfg) {
        card.classList.add('empty');
        slotsEl.appendChild(card);
        continue;
      }
      card.style.setProperty('--accent', tierColor(s.cfg.tier));
      card.innerHTML = cardHtml(s.cfg, s.kind)
        + `<div class="card-price">${s.sold ? t('ui.shop.sold') : s.price}</div>`;

      const lockBtn = doc.createElement('button');
      lockBtn.type = 'button';
      lockBtn.className = 'lock' + (s.locked ? ' on' : '');
      lockBtn.title = t('ui.shop.lock');
      // Замок — рисованная иконка вместо литералов ■/□: они выпадали из
      // пиксельного оформления и в разных шрифтах выглядели по-разному.
      lockBtn.innerHTML = iconHtml(s.locked ? 'ui_lock_on' : 'ui_lock_off', 'icon-sm');
      lockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        focusSlot = i;
        ctx.act('lock', i);
        renderSlots();
      });
      card.appendChild(lockBtn);

      if (!s.sold) {
        const idx = i;
        card.addEventListener('click', () => {
          focusSlot = idx;
          const res = ctx.act('buy', idx);
          if (res === 'poor') flash(card, t('ui.shop.cant_afford'));
          else if (res === 'full') flash(card, t('ui.shop.slots_full'));
          else renderAll();
        });
      }
      if (s.kind === 'item') {
        tip.bind(card, () => cardHtml(s.cfg, s.kind));
      }
      slotsEl.appendChild(card);
    }
  }

  function flash(node, text) {
    const old = node.getAttribute('data-msg');
    node.setAttribute('data-msg', text);
    node.classList.add('warn');
    doc.defaultView.setTimeout(() => {
      node.classList.remove('warn');
      if (old === null) node.removeAttribute('data-msg');
    }, 900);
  }

  function focusedCard() {
    return slotsEl.children[focusSlot] || null;
  }

  function doBuy() {
    const slots = ctx.slots();
    const s = slots[focusSlot];
    if (!s || s.sold || !s.cfg) return;
    const res = ctx.act('buy', focusSlot);
    const card = focusedCard();
    if (res === 'poor' && card) flash(card, t('ui.shop.cant_afford'));
    else if (res === 'full' && card) flash(card, t('ui.shop.slots_full'));
    else renderAll();
  }

  function doLock() {
    const slots = ctx.slots();
    const s = slots[focusSlot];
    if (!s || !s.cfg) return;
    ctx.act('lock', focusSlot);
    renderSlots();
  }

  function doMerge() {
    const p = ctx.player();
    const id = mergeable(p, config);
    if (!id) return;
    ctx.act('merge', id);
    renderAll();
  }

  function doReroll() {
    ctx.act('reroll');
    renderAll();
  }

  function doReady() {
    tip.hide();
    panel.style.display = 'none';
    ctx.act('ready');
  }

  function renderInventory() {
    const p = ctx.player();
    weaponsEl.innerHTML = '';
    const canMerge = mergeable(p, config);
    for (let i = 0; i < p.slots.length; i++) {
      const s = p.slots[i];
      const cell = doc.createElement('div');
      cell.className = 'inv-cell' + (s.cfg ? '' : ' empty');
      if (s.cfg) {
        cell.style.setProperty('--accent', tierColor(s.cfg.tier));
        cell.innerHTML = iconHtml(s.cfg.texture, 'icon-sm')
          + `<div class="inv-name">${s.cfg.name}</div>`;
        const sellBtn = doc.createElement('button');
        sellBtn.type = 'button';
        sellBtn.className = 'mini';
        sellBtn.textContent = t('ui.shop.sell');
        const idx = i;
        sellBtn.addEventListener('click', () => {
          ctx.act('sell_weapon', idx);
          renderAll();
        });
        cell.appendChild(sellBtn);
        if (canMerge === s.id) {
          const mergeBtn = doc.createElement('button');
          mergeBtn.type = 'button';
          mergeBtn.className = 'mini merge';
          mergeBtn.textContent = t('ui.shop.merge');
          mergeBtn.addEventListener('click', () => {
            ctx.act('merge', s.id);
            renderAll();
          });
          cell.appendChild(mergeBtn);
        }
        tip.bind(cell, () => cardHtml(s.cfg, 'weapon'));
      }
      weaponsEl.appendChild(cell);
    }

    itemsEl.innerHTML = '';
    for (let i = 0; i < p.items.length; i++) {
      const cfg = config.items[p.items[i]];
      const cell = doc.createElement('div');
      cell.className = 'inv-cell small';
      cell.style.setProperty('--accent', tierColor(cfg.tier));
      cell.innerHTML = iconHtml(cfg.texture, 'icon-sm')
        + `<div class="inv-name">${cfg.name}</div>`;
      const idx = i;
      const sellBtn = doc.createElement('button');
      sellBtn.type = 'button';
      sellBtn.className = 'mini';
      sellBtn.textContent = t('ui.shop.sell');
      sellBtn.addEventListener('click', () => {
        ctx.act('sell_item', idx);
        renderAll();
      });
      cell.appendChild(sellBtn);
      tip.bind(cell, () => cardHtml(cfg, 'item'));
      itemsEl.appendChild(cell);
    }
  }

  function renderStats() {
    const p = ctx.player();
    let html = '';
    const order = config.stats.order;
    for (let i = 0; i < order.length; i++) {
      const key = order[i];
      const meta = config.stats.meta[key];
      const v = p.stats[key];
      if (v === 0) continue;
      const suffix = meta.kind === 'pct' ? '%' : '';
      // Иконка живёт внутри span с названием, а не рядом: .stat-row — это flex
      // со space-between, и третий ребёнок растащил бы строку по краям.
      html += `<div class="stat-row"><span style="color:${meta.color}">`
        + `${iconHtml(meta.texture, 'icon-xs')}${meta.name}</span>`
        + `<span>${Math.round(v * 100) / 100}${suffix}</span></div>`;
    }
    statsEl.innerHTML = html;
  }

  function renderTop() {
    const p = ctx.player();
    titleEl.textContent = t('ui.shop.title') + ' — ' + t('ui.hud.wave') + ' ' + ctx.wave();
    ashEl.textContent = t('ui.hud.ash') + ': ' + Math.floor(p.ash);
    const cost = ctx.rerollCost();
    rerollBtn.textContent = t('ui.shop.reroll') + ' (' + cost + ')';
    rerollBtn.disabled = p.ash < cost;
    goBtn.textContent = t('ui.shop.go');
  }

  function renderAll() {
    if (!ctx) return;
    renderTop();
    renderSlots();
    renderInventory();
    renderStats();
  }

  rerollBtn.addEventListener('click', () => {
    if (!ctx) return;
    doReroll();
  });
  goBtn.addEventListener('click', () => {
    if (!ctx) return;
    doReady();
  });

  return {
    show(adapter) {
      ctx = adapter;
      focusSlot = 0;
      renderAll();
      panel.style.display = '';
    },
    hide() {
      tip.hide();
      panel.style.display = 'none';
    },
    get visible() {
      return panel.style.display !== 'none';
    },
    refresh: renderAll,

    handleInput(input) {
      if (!ctx || panel.style.display === 'none') return;
      const n = slotCount();
      if (input.consumePressed('GamepadFocusPrev') && n > 0) {
        focusSlot = (focusSlot - 1 + n) % n;
        renderSlots();
      }
      if (input.consumePressed('GamepadFocusNext') && n > 0) {
        focusSlot = (focusSlot + 1) % n;
        renderSlots();
      }
      if (input.consumePressed('GamepadBuy')) doBuy();
      if (input.consumePressed('GamepadLock')) doLock();
      if (input.consumePressed('GamepadMerge')) doMerge();
      if (input.consumePressed('GamepadReroll')) doReroll();
      if (input.consumePressed('GamepadReady')) doReady();
    },
  };
}
