// Лавка между волнами: 4 карточки, реролл, лок, инвентарь оружия со слиянием
// и продажей, сетка предметов, панель статов, кнопка «Готов».

import { buy, sell, merge, mergeable, rerollCost } from '../sim/shop.js';
import { refreshStats } from '../sim/player.js';
import { statsHtml } from './tooltip.js';

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

  function tierColor(tier) {
    return config.shop.tier_color[tier - 1] || '#9aa0a8';
  }

  function cardHtml(cfg, kind) {
    const head = `<div class="card-name" style="color:${tierColor(cfg.tier)}">${cfg.name}</div>`;
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
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const card = doc.createElement('div');
      card.className = 'card' + (s.sold ? ' sold' : '') + (s.locked ? ' locked' : '');
      if (!s.cfg) {
        card.classList.add('empty');
        slotsEl.appendChild(card);
        continue;
      }
      card.style.borderColor = tierColor(s.cfg.tier);
      card.innerHTML = cardHtml(s.cfg, s.kind)
        + `<div class="card-price">${s.sold ? t('ui.shop.sold') : s.price}</div>`;

      const lockBtn = doc.createElement('button');
      lockBtn.type = 'button';
      lockBtn.className = 'lock' + (s.locked ? ' on' : '');
      lockBtn.title = t('ui.shop.lock');
      lockBtn.textContent = s.locked ? '■' : '□';
      lockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        ctx.act('lock', i);
        renderSlots();
      });
      card.appendChild(lockBtn);

      if (!s.sold) {
        const idx = i;
        card.addEventListener('click', () => {
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

  function renderInventory() {
    const p = ctx.player();
    weaponsEl.innerHTML = '';
    const canMerge = mergeable(p, config);
    for (let i = 0; i < p.slots.length; i++) {
      const s = p.slots[i];
      const cell = doc.createElement('div');
      cell.className = 'inv-cell' + (s.cfg ? '' : ' empty');
      if (s.cfg) {
        cell.style.borderColor = tierColor(s.cfg.tier);
        cell.innerHTML = `<div class="inv-name">${s.cfg.name}</div>`;
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
      cell.style.borderColor = tierColor(cfg.tier);
      cell.innerHTML = `<div class="inv-name">${cfg.name}</div>`;
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
      html += `<div class="stat-row"><span style="color:${meta.color}">${meta.name}</span>`
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
    ctx.act('reroll');
    renderAll();
  });
  goBtn.addEventListener('click', () => {
    if (!ctx) return;
    tip.hide();
    panel.style.display = 'none';
    ctx.act('ready');
  });

  return {
    show(adapter) {
      ctx = adapter;
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
  };
}
