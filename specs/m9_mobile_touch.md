# M9. Мобильный режим: тач-управление и зум под маленький вьюпорт

Проект: `/opt/sites/ash-and-iron`. **Сначала прочитай `CLAUDE.md` и следуй ему строго.**

## Задача

ТЗ (`prompt_ash_and_iron.md:577-581`) требует мобильный режим, DoD этапа M7 — «на телефоне
играется». Сейчас не играется: виртуальный джойстик в `engine/input.js` считает вектор, но
никем не рисуется; кнопки паузы на тач-устройстве нет вообще; камера на телефоне показывает
вчетверо меньше арены, чем на десктопе; тултипы висят на `mousemove`; DOM-меню не свёрстаны
под узкий экран. Этот этап всё это закрывает. Игра должна остаться **байт-в-байт прежней на
десктопе** — мобильный режим включается только по `(pointer: coarse)` и по размеру вьюпорта.

Ключи конфига уже добавлены скриптом `tools/patch_config_touch.py` (content_version 56):
`render.min_view_units` = 500, `render.joystick` = `{ring_color, ring_alpha, ring_width,
thumb_color, thumb_alpha, thumb_radius}`, `render.joystick_radius` = 48 (был раньше),
i18n-ключи `ui.touch.pause`, `ui.touch.pause_title`, `ui.pause.debug` в `ru` и `en`.
**Конфиг не патчить, скрипт не трогать, новых ключей не добавлять.**

## Файлы, которые можно менять

- `static/js/engine/render.js` — формула масштаба
- `static/js/engine/input.js` — потребление тапа
- `static/js/ui/hud.js` — отрисовка джойстика
- `static/js/ui/touch_ui.js` — **новый файл**, экранная кнопка паузы
- `static/js/ui/pause_ui.js` — кнопка «Отладка» в меню паузы
- `static/js/ui/tooltip.js` — тултип по долгому нажатию
- `static/js/main.js` — проводка перечисленного
- `static/css/style.css` — портретная вёрстка
- `templates/index.html`, `templates/login.html` — метатег viewport

Больше **ничего не трогать**. Ни одного нового файла, кроме `ui/touch_ui.js`. Никаких
зависимостей, сборщиков, npm, TypeScript (CLAUDE.md §5). Не переформатировать соседний код.

---

## 1. `engine/render.js` — целочисленный масштаб, отвязанный от dpr

Сейчас мир рисуется через `setTransform(dpr,…)` (`render.js:57`) и затем
`ctx.scale(view.zoom, view.zoom)` (`render.js:61`), то есть итоговый масштаб мир→device-px
равен `dpr * view.zoom`. Правило «целочисленный масштаб» из CLAUDE.md §4 относится именно к
этому произведению, а не к `view.zoom` по отдельности. Значит `view.zoom` **разрешено делать
дробным**, если `dpr * view.zoom` осталось целым — и именно так мы получаем более широкий
обзор на телефоне, не ломая пиксель-арт.

Рядом с `viewRef` (`render.js:23`) добавь:

```js
  // Сколько мировых единиц обязано помещаться по короткой стороне экрана
  const minView = (config.render && config.render.min_view_units) || 0;
```

и замени тело `resize()` (`render.js:29-39`) на:

```js
  function resize() {
    dpr = globalThis.devicePixelRatio || 1;
    const w = canvas.clientWidth || globalThis.innerWidth || arenaW;
    const h = canvas.clientHeight || globalThis.innerHeight || arenaH;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    view.w = w;
    view.h = h;

    // Масштаб мир→device-px обязан быть целым: иначе пиксель спрайта размазывается
    // по границе физического пикселя. view.zoom при этом дробное — оно живёт в
    // CSS-пикселях, а целочисленность нужна произведению dpr * zoom (см. begin()).
    let s = Math.max(1, Math.round(dpr * Math.max(1, Math.floor(h / viewRef))));
    // Вьюпорт телефона короче десктопного обзора, и при масштабе «как есть» игрок
    // видит вчетверо меньше арены. Снижаем масштаб, пока по короткой стороне не
    // наберётся minView мировых единиц.
    const short = Math.min(canvas.width, canvas.height);
    while (s > 1 && short / s < minView) s--;

    view.zoom = s / dpr;
    ctx.imageSmoothingEnabled = false;
  }
```

Больше в `render.js` не менять ничего: `clampCamera`, `worldToScreen`, `drawArena`, `drawProps`
уже считают через `view.w / view.zoom` и с дробным зумом работают как есть.

Контрольные значения (проверь арифметикой, они же уйдут в тест):
`viewRef` = 900, `minView` = 500.

| вьюпорт CSS | dpr | s | view.zoom |
|---|---|---|---|
| 1920×1080 (десктоп) | 1 | 1 | **1** — как было |
| 1280×720 (десктоп) | 1 | 1 | **1** — как было |
| 3840×2160 (4K) | 1 | 2 | **2** — как было |
| 360×800 (телефон) | 3 | 2 | 0.6667 |
| 360×800 (телефон) | 2 | 1 | 0.5 |

---

## 2. `engine/input.js` — потребление тапа

`touch.tap` выставляется в `onTouchStart` (`input.js:121`) и никогда не сбрасывается: сейчас
это мёртвый флаг, который после первого касания навсегда остаётся `true`. Добавь в
возвращаемый объект (рядом с `consumePressed`, `input.js:261`):

```js
    // Тап по правой половине: читает и сбрасывает флаг. Стрельба автоматическая,
    // поэтому тап — не «выстрел», а «закрыть подсказку».
    consumeTap() {
      if (touch.tap) {
        touch.tap = false;
        return true;
      }
      return false;
    },
```

Больше в `input.js` ничего не менять.

---

## 3. `ui/hud.js` — отрисовка джойстика

HUD рисуется после `renderer.end()` в экранных CSS-пикселях, а `touch.x/touch.y` — это
`clientX/clientY`, тоже CSS-пиксели. Значит координаты совпадают напрямую, пересчёт не нужен.

Сигнатура `draw` (`hud.js:34`) становится `draw(ctx, run, me, view, touch, move)`. Оба новых
аргумента необязательные — при их отсутствии поведение прежнее.

В самом конце `draw`, перед `ctx.restore()` (`hud.js:135`), добавь вызов `joystick(ctx, touch,
move)` и рядом с `bar`/`label` объяви функцию:

```js
  // Виртуальный джойстик: кольцо в точке касания, шляпка по вектору движения.
  // Никаких shadowBlur/filter (CLAUDE.md §4), ноль аллокаций — всё из готовых объектов.
  function joystick(ctx, touch, move) {
    if (!touch || !touch.active) return;
    const j = config.render.joystick;
    const r = config.render.joystick_radius;
    const prev = ctx.globalAlpha;

    ctx.globalAlpha = j.ring_alpha;
    ctx.strokeStyle = j.ring_color;
    ctx.lineWidth = j.ring_width;
    ctx.beginPath();
    ctx.arc(touch.x, touch.y, r, 0, TAU);
    ctx.stroke();

    ctx.globalAlpha = j.thumb_alpha;
    ctx.fillStyle = j.thumb_color;
    ctx.beginPath();
    ctx.arc(touch.x + (move ? move.x : 0) * r, touch.y + (move ? move.y : 0) * r,
      j.thumb_radius, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = prev;
  }
```

`const TAU = Math.PI * 2;` объяви рядом с `FONT`/`XP_H` в конце файла.

---

## 4. `ui/touch_ui.js` — новый модуль, экранная кнопка паузы

Кнопка живёт в DOM внутри `#ui` (контейнер `pointer-events: none`, дети `auto` —
`style.css:63-77`), поэтому канвасный хит-тест не нужен и с тач-джойстиком она не конфликтует:
джойстик слушает `canvas`, кнопка перехватывает своё касание сама.

```js
// Экранные кнопки для тач-устройств: пауза. Стрельба в игре автоматическая,
// поэтому единственный боевой ввод — движение, и больше кнопок не нужно.
// На десктопе модуль не создаёт ни одного узла.

export function createTouchUi(root, config, t) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const coarse = !!(win && win.matchMedia && win.matchMedia('(pointer: coarse)').matches);

  if (!coarse) {
    return { coarse: false, setHandlers() {}, sync() {}, hide() {} };
  }

  const box = doc.createElement('div');
  box.className = 'touch-ui';
  box.style.display = 'none';

  const pauseBtn = doc.createElement('button');
  pauseBtn.type = 'button';
  pauseBtn.className = 'btn touch-btn touch-pause';
  pauseBtn.textContent = t('ui.touch.pause');
  pauseBtn.title = t('ui.touch.pause_title');
  pauseBtn.setAttribute('aria-label', t('ui.touch.pause_title'));
  box.appendChild(pauseBtn);
  root.appendChild(box);

  let handlers = {};
  let shown = false;

  pauseBtn.addEventListener('click', () => {
    if (handlers.onPause) handlers.onPause();
  });

  return {
    coarse: true,

    setHandlers(h) {
      handlers = h || {};
    },

    // Дёргается каждый кадр из draw(); стиль трогаем только по факту смены
    // состояния, иначе это запись в DOM на каждом кадре.
    sync(visible) {
      const on = !!visible;
      if (on === shown) return;
      shown = on;
      box.style.display = on ? '' : 'none';
    },

    hide() {
      this.sync(false);
    },
  };
}
```

---

## 5. `ui/pause_ui.js` — пункт «Отладка»

На телефоне нет клавиши F3, а без дебаг-оверлея мобильный рендер нечем профилировать.
Добавь в разметку панели (`pause_ui.js:11-19`) четвёртой кнопкой, перед `.menu`:

```
'<button type="button" class="btn debug"></button>'
```

По образцу `audioBtn`: получить узел, повесить `click` → `handlers.onDebug`, в `show()`
поставить `debugBtn.textContent = t('ui.pause.debug')` и
`debugBtn.style.display = handlers.onDebug ? '' : 'none'`. На десктопе `onDebug` не передаётся,
и кнопки там нет — меню паузы выглядит ровно как раньше.

---

## 6. `ui/tooltip.js` — подсказка по долгому нажатию

Обычный тап по карточке лавки должен покупать, а не показывать подсказку, поэтому на тач-
устройствах тултип вешается на **долгое нажатие** (350 мс), а не на тап.

В `createTooltip` определи один раз:

```js
  const win = doc.defaultView;
  const coarse = !!(win && win.matchMedia && win.matchMedia('(pointer: coarse)').matches);
```

и перепиши `bind` (`tooltip.js:26-30`) так, чтобы на `coarse` вместо мышиных слушателей
вешались:

- `pointerdown` (только `e.pointerType !== 'mouse'`): запомнить `e.clientX/e.clientY`, завести
  `win.setTimeout(..., LONG_PRESS_MS)`, по срабатыванию — `show(contentFn(), x, y)`;
- `pointermove`: если палец уехал дальше `MOVE_CANCEL_PX` от точки нажатия — снять таймер;
- `pointerup`, `pointercancel`, `pointerleave`: снять таймер (сам тултип не прячем — его
  закроет следующее касание).

Плюс один общий слушатель на документе, регистрируемый в `createTooltip` при `coarse`:
`doc.addEventListener('pointerdown', hide, true)` — любое следующее касание убирает подсказку.
Capture-фаза здесь обязательна: `pointerdown` цели сработает после, и долгое нажатие по
соседней карточке покажет уже новую подсказку.

Константы модуля рядом с остальными:
```js
const LONG_PRESS_MS = 350;
const MOVE_CANCEL_PX = 12;
```

На не-`coarse` устройствах `bind` остаётся ровно прежним (`mouseenter`/`mousemove`/`mouseleave`).

---

## 7. `main.js` — проводка

1. Импорт `createTouchUi` из `./ui/touch_ui.js` рядом с остальными импортами `ui/`.
2. Рядом с `const pauseUi = createPauseUi(...)` (`main.js:106`):
   ```js
   const touchUi = createTouchUi(uiRoot, config, t);
   ```
   а сразу после объявления `handleEsc` — `touchUi.setHandlers({ onPause: handleEsc });`
   (объявление функции всплывает, порядок безопасен).
3. В `openPauseMenu()` (`main.js:308`) добавь в объект обработчиков:
   ```js
   // F3 с телефона недоступен, поэтому оверлей открывается из паузы
   onDebug: touchUi.coarse ? () => debug.toggle() : null,
   ```
4. В `draw()`, сразу после `hud.draw(...)` (`main.js:777`), передай тач-состояние и покажи
   кнопку:
   ```js
   hud.draw(renderer.ctx, netClient || run, me, renderer.view, input.touch, input.move);
   touchUi.sync(!pauseUi.visible && !shopUi.visible && !resultUi.visible && !levelUi.visible);
   ```
   (`draw()` работает только пока идёт забег, поэтому вне забега кнопки не будет.)
   Если у `levelUi` нет геттера `visible` — не выдумывай его, убери этот член из условия.
5. Тап по правой половине гасит подсказку. В `update()` рядом с
   `if (input.consumePressed('F3')) debug.toggle();` (`main.js:381`):
   ```js
   if (input.consumeTap()) tip.hide();
   ```
6. Пересчёт рендера при повороте экрана. Расширь существующий слушатель (`main.js:1023`):
   ```js
   const onViewportChange = () => { if (renderer) renderer.resize(); };
   globalThis.addEventListener('resize', onViewportChange);
   globalThis.addEventListener('orientationchange', onViewportChange);
   if (globalThis.visualViewport) {
     globalThis.visualViewport.addEventListener('resize', onViewportChange);
   }
   ```
7. Точка входа для аппаратной кнопки «Назад» Android-оболочки. Рядом с той же проводкой:
   ```js
   // Аппаратная «Назад» в APK-оболочке: во время забега — пауза, иначе false,
   // и приложение уходит в фон. Возвращаемое значение читает MainActivity.
   globalThis.__ashBack = () => {
     if (!run && !netClient) return false;
     const st = world();
     if (!st || st.phase === PHASE_OVER || resultUi.visible) return false;
     handleEsc();
     return true;
   };
   ```

---

## 8. `static/css/style.css` — портретная вёрстка и тач-цели

Добавь **в конец файла** один блок. Ничего из существующих правил не переписывай и не удаляй —
компактный режим города (`style.css:703`) остаётся как есть, он уже делает ровно то, что нужно.

```css
/* --- Мобильный режим -------------------------------------------------------
   Включается по грубому указателю и узкому экрану. Десктоп сюда не попадает.  */
```

Требования блока:

1. **Кнопка паузы.** `.touch-ui` — фиксированный слой; `.touch-btn` — квадрат не меньше
   48×48 px со скином `ui_btn` (тот же `border-image`, что у `.btn`, `style.css:272`).
   `.touch-pause` прижата к правому верхнему углу с отступом
   `calc(8px + env(safe-area-inset-top))` / `calc(8px + env(safe-area-inset-right))`.
   Глиф крупный (≈20px), по центру.
2. **Чёлка и вырезы.** `#ui` и `.modal`, `.menu` получают
   `padding` с `env(safe-area-inset-*)` — под вырезом не должно оказаться ни кнопки, ни текста.
3. **Канвас не должен скроллиться и подсвечиваться:** `#game { touch-action: none; }`,
   `body { -webkit-tap-highlight-color: transparent; -webkit-user-select: none; user-select: none; }`.
   Это ставится безусловно, не внутри медиазапроса.
4. **Портрет `@media (orientation: portrait) and (max-width: 700px)`:**
   - `.modal`, `.menu` — во всю ширину минус отступы, `max-height: 100%`, `overflow-y: auto`,
     позиционирование потоком, а не абсолютом;
   - лавка `.shop`, выбор уровня `.choice`, мета `.meta-card`, Ловчий Дом, лобби, сетап,
     результат — в **одну колонку** (`grid-template-columns: 1fr` / `flex-direction: column`),
     карточки во всю ширину;
   - любой `.btn`, `.tab`, `.inv-cell`, `.choice`, `.meta-card`, `.city-b` — `min-height: 44px`
     (тап-цель); шрифт не меньше 13px;
   - тултип `.tooltip` — `max-width: calc(100vw - 16px)`, чтобы не уезжал за экран;
   - `.auth-box` — `width: 100%; max-width: 360px`, поля ввода `min-height: 44px`,
     `font-size: 16px` (иначе Android зумит страницу при фокусе);
   - расширь существующий компактный медиазапрос города так, чтобы он срабатывал и в портрете
     (добавь условие в его список, не создавай копию правил).

**Точные селекторы бери из файла**, не выдумывай классы: пройди по `static/js/ui/*.js` и
посмотри, какие классы там реально создаются. Если класса нет — правило не пиши.

---

## 9. Шаблоны

В `templates/index.html:5` и `templates/login.html:5` заменить метатег на:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
```

---

## Ограничения (повтор — нарушение блокирует приёмку)

- Никакого хардкода текстов, чисел баланса и texture-id в коде: подписи только через
  `t('ui.…')`, цвета и размеры джойстика только из `config.render.joystick*` (CLAUDE.md §3.1, §3.4).
- Бюджет кадра: рендер ≤ 6 мс, ноль аллокаций в горячем цикле, никаких `shadowBlur`/`filter`
  (CLAUDE.md §4). `touchUi.sync` обязан быть no-op при неизменном состоянии.
- Vanilla ES-модули, никаких зависимостей и сборщиков (CLAUDE.md §5).
- Поведение на десктопе не меняется: `view.zoom` на 1920×1080 dpr 1 остаётся ровно 1, в меню
  паузы нет новой кнопки, тултипы работают по мыши как раньше.

## Приёмка

```bash
cd /opt/sites/ash-and-iron
node --test tests/js/*.test.js
node tools/bench_sim.js
.venv/bin/python -m pytest tests/py -q
```

Всё должно пройти. Дополнительно проверь руками арифметику §1 по таблице контрольных значений.

В конце отчёта перечисли изменённые файлы и приложи вывод команд приёмки.
