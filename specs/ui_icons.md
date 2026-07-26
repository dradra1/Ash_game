Project: /opt/sites/ash-and-iron. Read CLAUDE.md first and follow it strictly.

## Задача

В `game_config.json` у оружия, предметов, статов и мета-улучшений давно проставлены
texture-id (`w_*`, `it_*`, `st_*`, `mu_*`), и PNG для них лежат в `static/textures/`.
Но экраны лавки, левелапа и реликвария сделаны на DOM и текстур не касаются вообще —
графика есть, её никто не показывает. Надо привязать.

Речь только об одиночных PNG. Спрайт-листы юнитов (`ch_*`, `e_*`) — это 4 строки
S,E,N,W, их так показывать нельзя, и в этой задаче они не трогаются.

## Файлы

- `static/js/ui/tooltip.js` — общий помощник `iconHtml` + иконки в `statsHtml`.
- `static/js/ui/shop_ui.js` — карточки лавки, инвентарь, панель статов.
- `static/js/ui/levelup_ui.js` — карточки выбора при левелапе.
- `static/js/ui/meta_ui.js` — карточки реликвария.
- `static/css/style.css` — размеры иконок.

Больше ничего не трогать. Не трогать `static/js/engine/`, `static/js/sim/`,
`static/js/net/`. Не создавать новых файлов и модулей. Не добавлять зависимостей.
Не переформатировать соседний код. Не менять тексты и ключи `t(...)`.

## Требования

1. В `static/js/ui/tooltip.js` добавить экспорт:

       export function iconHtml(textureId, cls)

   - если `textureId` пустой — вернуть пустую строку `''`;
   - иначе вернуть разметку `<img>` с `src="/static/textures/<textureId>.png"`,
     классом `icon` плюс переданным `cls` (если он задан), пустым `alt=""`
     и обработчиком `onerror`, который убирает узел из разметки;
   - **почему onerror**: по CLAUDE.md §3.3 отсутствие файла — это нормальный
     сценарий, а не ошибка. Нет PNG — иконка молча исчезает, подпись остаётся,
     вёрстка не ломается и в консоль ничего не сыплется.

2. `statsHtml` в том же файле: перед текстом каждой строки стата подставить
   `iconHtml(meta.texture, 'icon-xs')`. Цвет, знак, суффикс и порядок не менять.

3. `static/js/ui/shop_ui.js`:
   - `cardHtml` — в начало карточки (перед `.card-name`) добавить
     `iconHtml(cfg.texture, 'icon-lg')`. Работает и для оружия, и для предметов:
     поле `texture` есть у обоих.
   - `renderInventory`, ячейка оружия — перед `.inv-name` добавить
     `iconHtml(s.cfg.texture, 'icon-sm')`.
   - `renderInventory`, ячейка предмета — перед `.inv-name` добавить
     `iconHtml(cfg.texture, 'icon-sm')`.
   - `renderStats` — в начало `.stat-row` добавить `iconHtml(meta.texture, 'icon-xs')`.
   - Импорт `iconHtml` добавить к существующему импорту `statsHtml` из `./tooltip.js`.

4. `static/js/ui/levelup_ui.js`: в карточке выбора перед `.choice-name` добавить
   `iconHtml(c.texture, 'icon-lg')`. Поле `texture` у варианта уже заполняется
   в `static/js/sim/level.js` — брать его, ничего не вычислять заново.

5. `static/js/ui/meta_ui.js`: у фабрики карточек `card(opts)` поддержать необязательное
   поле `opts.icon` — texture-id, который рисуется в начале карточки через
   `iconHtml(opts.icon, 'icon-lg')`. Передавать его:
   - в `renderWeapons` — `icon: w.texture`;
   - в `renderUpgrades` — `icon: up.texture`.
   В `renderFactions`, `renderCharacters` и `renderAchievements` поле не передавать.

6. `static/css/style.css` — добавить правила:
   - `.icon` — `display: inline-block; vertical-align: middle; image-rendering: pixelated;`
     (`pixelated` обязателен: без него браузер сглаживает пиксель-арт в кашу);
   - `.icon-lg` — 32×32, `.icon-sm` — 20×20, `.icon-xs` — 14×14;
   - у `.icon-sm` и `.icon-xs` — небольшой отступ справа, чтобы иконка не липла
     к подписи.
   Существующие правила не переписывать, добавить рядом.

## Ограничения

- Vanilla ES-модули, никаких сборщиков, TypeScript и npm-зависимостей (CLAUDE.md §5).
- Никакого хардкода texture-id в коде: все id берутся из конфига (CLAUDE.md §3.1).
  В коде допустимы только имена CSS-классов и путь `/static/textures/`.
- Все подписи — по-прежнему через `t('ui...')`, новых строк текста не вводить
  (CLAUDE.md §3.4).
- Это UI на DOM, вне горячего цикла кадра — но лишних перерисовок не добавлять,
  разметка собирается там же, где собиралась.

## Приёмка

- `node --test tests/js/*.test.js` проходит (106 тестов).
- `.venv/bin/python -m pytest tests/py -q` проходит (46 тестов).
- В `static/js/ui/` нет ни одного литерала вида `w_`, `it_`, `st_`, `mu_`.
- `grep -c "iconHtml" static/js/ui/shop_ui.js` — не меньше 4.

В конце отчитайся: какие файлы изменены и вывод обеих тестовых команд.
