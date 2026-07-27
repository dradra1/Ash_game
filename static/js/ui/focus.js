// Навигация по меню геймпадом.
//
// Зачем отдельный модуль. Опрос геймпада живёт в игровом цикле (`input.poll()` в
// update), а цикл существует только во время забега — до старта и после смерти его
// нет вовсе. Поэтому в главном меню, лобби, настройках и на экране результата
// геймпад не работал в принципе: игра запускалась мышью, дальше — падом. Здесь
// свой rAF-цикл, который крутится всегда и опрашивает пад, когда открыта панель.
//
// Фокус — НАСТОЯЩИЙ DOM-фокус (`el.focus()`), а не своя подсветка. Так бесплатно
// работают Tab и Enter с клавиатуры, скринридер и прокрутка к элементу, а паду
// остаётся только двигать фокус и нажимать `click()`.
//
// Панель не регистрируется вручную: модуль сам находит видимую (`.menu`, `.modal`)
// в корне интерфейса. Иначе каждый новый экран пришлось бы не забыть подключить —
// а забывают всегда.

const PANELS = '.menu, .modal';
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select, [tabindex]';
// У кого свой разбор пада: лавка (см. shop_ui.handleInput) читает те же кнопки
// по-своему, и две схемы на одном экране дрались бы за нажатия.
const SKIP_PANELS = { shop: 1 };
// Кнопка «назад» у панелей называется по-разному, общего атрибута нет.
const CANCEL = '.btn.back, .btn.cancel, .btn.resume';

function visible(el) {
  return !!el && el.style.display !== 'none' && el.offsetParent !== null;
}

export function createFocusNav(root, input) {
  const doc = root.ownerDocument;
  let raf = 0;
  let lastPanel = null;

  function activePanel() {
    const list = root.querySelectorAll(PANELS);
    let found = null;
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (SKIP_PANELS[el.id]) continue;
      if (visible(el)) found = el;      // при наложении верхняя — последняя в DOM
    }
    return found;
  }

  function items(panel) {
    const all = panel.querySelectorAll(FOCUSABLE);
    const out = [];
    for (let i = 0; i < all.length; i++) {
      if (all[i].offsetParent !== null) out.push(all[i]);
    }
    return out;
  }

  function move(panel, delta) {
    const list = items(panel);
    if (!list.length) return;
    let idx = list.indexOf(doc.activeElement);
    // Фокуса в панели нет (только открылась или он остался на прошлом экране) —
    // заходим с края, а не с середины: по «вниз» — на первый, по «вверх» — на последний.
    if (idx < 0) idx = delta > 0 ? -1 : 0;
    const next = list[(idx + delta + list.length) % list.length];
    next.focus();
  }

  // Ползунок под фокусом забирает «влево-вправо» себе. Иначе громкость падом не
  // выставить вовсе: горизонталь уводила бы фокус на соседнюю строку, а экран
  // настроек звука ради ползунков и существует.
  function slide(delta) {
    const el = doc.activeElement;
    if (!el || el.tagName !== 'INPUT' || el.type !== 'range') return false;
    const step = Number(el.step) || 1;
    const min = Number(el.min) || 0;
    const max = el.max === '' ? 100 : Number(el.max);
    const next = Math.max(min, Math.min(max, Number(el.value) + step * delta));
    if (next === Number(el.value)) return true;   // упёрлись в край, но фокус держим
    el.value = String(next);
    el.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
    return true;
  }

  function activate(panel) {
    const el = doc.activeElement;
    if (el && panel.contains(el) && typeof el.click === 'function') el.click();
  }

  function cancel(panel) {
    const btn = panel.querySelector(CANCEL);
    if (btn && btn.offsetParent !== null) btn.click();
  }

  function tick() {
    raf = globalThis.requestAnimationFrame(tick);
    const panel = activePanel();
    if (!panel) {
      lastPanel = null;
      return;
    }
    // Опрашиваем пад сами: игрового цикла может не быть вовсе. Когда он есть,
    // лишний poll безвреден — фронт кнопки ловится по прошлому состоянию, а не
    // по числу опросов.
    input.poll();

    // Панель сменилась — фокус со старой уже не имеет смысла, уводим на первый
    // элемент новой, иначе первое же нажатие уйдёт в невидимую кнопку.
    if (panel !== lastPanel) {
      lastPanel = panel;
      const list = items(panel);
      if (list.length && !panel.contains(doc.activeElement)) list[0].focus();
    }

    if (input.consumePressed('GamepadFocusPrev') && !slide(-1)) move(panel, -1);
    if (input.consumePressed('GamepadFocusNext') && !slide(1)) move(panel, 1);
    if (input.consumePressed('GamepadFocusUp')) move(panel, -1);
    if (input.consumePressed('GamepadFocusDown')) move(panel, 1);
    if (input.consumePressed('GamepadBuy')) activate(panel);
    if (input.consumePressed('GamepadCancel')) cancel(panel);
  }

  return {
    start() {
      if (!raf) raf = globalThis.requestAnimationFrame(tick);
    },
    stop() {
      if (raf) globalThis.cancelAnimationFrame(raf);
      raf = 0;
    },
    get panel() { return activePanel(); },
  };
}
