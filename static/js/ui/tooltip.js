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
    out += `<div class="stat" style="color:${v > 0 ? meta.color : '#a8564a'}">`
      + `${sign}${Math.abs(v)}${suffix} ${meta.name}</div>`;
  }
  return out;
}
