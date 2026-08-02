// Общий тултип для карточек лавки и инвентаря. Один узел на всю игру.

export function createTooltip(root) {
  const doc = root.ownerDocument;
  const el = doc.createElement('div');
  el.className = 'tooltip';
  el.style.display = 'none';
  root.appendChild(el);

  function show(html, x, y) {
    el.innerHTML = html;
    el.style.display = '';
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = doc.defaultView.innerWidth;
    const vh = doc.defaultView.innerHeight;
    el.style.left = Math.min(x + 14, vw - w - 8) + 'px';
    el.style.top = (y + h + 20 > vh ? y - h - 10 : y + 16) + 'px';
  }

  function hide() {
    el.style.display = 'none';
  }

  // Навесить тултип на элемент: содержимое считается лениво
  function bind(node, contentFn) {
    node.addEventListener('mouseenter', (e) => show(contentFn(), e.clientX, e.clientY));
    node.addEventListener('mousemove', (e) => show(contentFn(), e.clientX, e.clientY));
    node.addEventListener('mouseleave', hide);
  }

  return { show, hide, bind, el };
}

// Иконка одиночного PNG (оружие, предмет, стат, мета-улучшение) для DOM-экранов.
// Нет файла — onerror убирает узел: по CLAUDE.md §3.3 отсутствие текстуры это
// штатный случай, подпись остаётся, вёрстка не едет.
export function iconHtml(textureId, cls) {
  if (!textureId) return '';
  const c = cls ? ' ' + cls : '';
  return `<img src="/static/textures/${textureId}.png" class="icon${c}" alt="" onerror="this.remove()">`;
}

// Карточка персонажа для подсказки: как выглядит, чем отличается, с чем начинает.
// Одна на оба экрана выбора — лобби и соло-визард показывали только имя, хотя всё
// это лежит в config.characters и просто не доходило до игрока.
//
// Спрайт вырезается из листа стойки: лист — 4 строки (S,E,N,W) по стороне,
// равной высоте/4 (конвенция ASSETS.md §5, та же арифметика, что в engine/sprites.js).
// Берём кадр 0 строки 0 — вид с юга, лицом к игроку.
export function characterTipHtml(config, id, t) {
  const c = config.characters[id];
  if (!c) return '';
  const face = c.texture
    ? `<div class="tip-face" style="background-image:url(/static/textures/${c.texture}.png)"></div>`
    : '';
  let weapons = '';
  const start = c.start_weapons || [];
  for (let i = 0; i < start.length; i++) {
    const w = config.weapons[start[i]];
    if (w) weapons += `<div class="card-line">${iconHtml(w.texture, 'icon-xs')}${w.name}</div>`;
  }
  // Уникальная особенность — отдельной строкой над статами: у половины
  // персонажей она решает больше, чем все их цифры вместе.
  const uniq = uniqueHtml(c, t);
  return `<div class="tip-head">${face}`
    + `<div class="card-name" style="color:${c.color}">${c.name}</div></div>`
    + (c.desc ? `<div class="card-desc">${c.desc}</div>` : '')
    + uniq
    + `<div class="col-title">${t('ui.select.traits')}</div>`
    + statsHtml(config, c.stats)
    + (weapons ? `<div class="col-title">${t('ui.select.start_weapons')}</div>${weapons}` : '');
}

// Строка уникальной особенности персонажа. Текста в коде нет: описание лежит
// в i18n под ключом ui.unique.<type>, ключ приходит из config.characters.
// Особенности без описания (объявленные, но не реализованные движком) молчат —
// обещать игроку то, чего нет, хуже, чем не сказать ничего.
export function uniqueHtml(character, t) {
  const u = character && character.unique;
  if (!u || !u.type) return '';
  const key = 'ui.unique.' + u.type;
  const text = t(key);
  if (text === key) return '';
  return `<div class="col-title">${t('ui.select.unique')}</div>`
    + `<div class="card-line uniq">${text}</div>`;
}

// Разметка описания статов сущности: «+4 Ближний урон», «−20% Здоровье»
export function statsHtml(config, stats) {
  if (!stats) return '';
  let out = '';
  for (const key in stats) {
    const pctKey = key.length > 4 && key.slice(-4) === '_pct';
    const base = pctKey && !config.stats.meta[key] ? key.slice(0, -4) : key;
    const meta = config.stats.meta[base];
    if (!meta) continue;
    const v = stats[key];
    const sign = v > 0 ? '+' : '−';
    const suffix = meta.kind === 'pct' || (pctKey && !config.stats.meta[key]) ? '%' : '';
    const icon = iconHtml(meta.texture, 'icon-xs');
    out += `<div class="stat" style="color:${v > 0 ? meta.color : '#a8564a'}">`
      + `${icon}${icon ? ' ' : ''}${sign}${Math.abs(v)}${suffix} ${meta.name}</div>`;
  }
  return out;
}
