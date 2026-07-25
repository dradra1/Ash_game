Project: /opt/sites/ash-and-iron. Read AGENTS.md first and follow it strictly.

Это новый пустой проект. Ты пишешь **только клиентский каркас движка (этап M0)**.

## Задача

Фундамент браузерного движка для арена-рогалика-автошутера: цикл с фиксированным шагом,
детерминированный ГПСЧ, пулы, spatial hash, ввод, рендер, ленивые спрайты, абстракция
транспорта и дебаг-оверлей. Симуляции боя ещё нет — на выходе управляемый квадрат на арене,
но **вся инфраструктура уже правильной формы**, потому что поверх неё сразу пойдёт бой и кооп.

Vanilla ES-модули, без сборщика, без npm, без TypeScript, без фреймворков. Импорты —
относительные, **с расширением `.js`**. Браузер грузит их напрямую.

## Файлы, которые ты создаёшь (и только они)

```
static/js/main.js
static/js/engine/loop.js  rng.js  pool.js  grid.js  input.js  sprites.js  render.js
static/js/net/transport.js
static/js/sim/run.js
static/js/ui/debug.js  screens.js
tests/js/rng.test.js  pool.test.js  grid.test.js  loop.test.js
```

**Не трогай** `app.py`, `db.py`, `templates/`, `static/css/`, `Dockerfile`,
`docker-compose.yml`, `config/game_config.json`, `tools/`, `tests/py/`, `*.md` — там
параллельно работает другой исполнитель. Не добавляй файлов сверх списка.

## Контракт модулей (соблюдать точно — на эти API пишется вся игра)

### `engine/rng.js`
```js
export function createRng(seed)   // mulberry32
// → { seed, next(), float(), range(a, b), int(a, b), pick(arr), weighted(arr, weightOf), fork() }
```
`next()` — сырое uint32. `float()` ∈ [0,1). `int(a,b)` — целое включительно.
`weighted(arr, weightOf)` — выбор по весу (`weightOf(item, i)` → число). `fork()` — новый
независимый поток от текущего состояния. **Детерминированность обязательна**: одинаковый
сид → одинаковая последовательность. Никаких `Math.random()` во всём проекте.

### `engine/pool.js`
```js
export function createPool(capacity, factory, reset)
// → { items, count, capacity, spawn(), release(i), clear() }
```
Плотный массив `items` длиной `capacity`, заполненный заранее через `factory()`.
`spawn()` → объект `items[count++]` (предварительно прогнанный через `reset(obj)`), либо
`null` при переполнении — **не расти**. `release(i)` — swap-remove с последним живым.
Итерация вызывающим кодом: `for (let i = 0; i < pool.count; i++)`. **Ноль аллокаций
после создания пула.**

### `engine/grid.js`
```js
export function createGrid(cellSize, width, height)
// → { clear(), insert(id, x, y), query(x, y, radius, out), queryRect(x, y, w, h, out), cellSize }
```
Uniform spatial hash. `out` — заранее выделенный `Int32Array`, метод возвращает число
записанных элементов (не больше `out.length`). **Никаких аллокаций в `insert`/`query`** —
внутренние бакеты выделяются один раз в `createGrid` (плоские `Int32Array`: массив
счётчиков + массив элементов фиксированной ёмкости на ячейку, переполнение ячейки просто
отбрасывает лишнее).

### `engine/loop.js`
```js
export function createLoop({ dt, maxCatchup, update, render })
// → { start(), stop(), running, stats }
```
Accumulator с фиксированным шагом: накопил ≥ dt → `update(dt)`, максимум `maxCatchup`
догоняющих шагов за кадр (остаток отбрасывается, чтобы вкладка из фона не отматывала час).
`render(alpha)` — раз в кадр, `alpha` ∈ [0,1) — доля до следующего шага, для интерполяции.
`stats` = `{ fps, simMs, renderMs, steps, frame }`, обновляется скользящим средним
(окно ~30 кадров), без аллокаций.

### `engine/input.js`
```js
export function createInput(canvas)
// → { move: {x, y}, down(code), pressed(code), consumePressed(code), touch, destroy() }
```
WASD + стрелки → `move` (нормализованный вектор, длина ≤ 1, объект переиспользуется —
не создавать новый на кадр). Виртуальный джойстик на touch-устройствах (левая половина
экрана — джойстик, правая — тап). `pressed` — «нажали в этом кадре» (сбрасывается вызовом
`consumePressed`). Коды клавиш — `event.code` (`KeyR`, `Space`, `Escape`, `F3`).
`preventDefault` для стрелок, пробела и F3.

### `engine/sprites.js`
```js
export function getSprite(textureId)          // → {img, ready, failed} | null; ленивая загрузка
export function drawSheet(ctx, textureId, dir, frame, x, y, size)  // → true если нарисовано
```
Путь: `/static/textures/<textureId>.png`. Файла нет → `failed`, `drawSheet` возвращает
`false`, и вызывающий рисует цветной прямоугольник (см. `render.js`). Конвенция листа:
4 строки сверху вниз **S, E, N, W**; кадр квадратный, сторона = высота листа / 4; число
кадров выводится из ширины. Кэш по textureId, повторных запросов к несуществующему файлу
не делать.

### `engine/render.js`
```js
export function createRenderer(canvas, config)
// → { camera, resize(), begin(), end(), follow(x, y, dt), worldToScreen(x, y, out),
//     drawArena(arena), drawEntity(textureId, dir, frame, x, y, size, color),
//     drawRect(x, y, w, h, color), drawText(text, x, y, color, align), ctx }
```
- `imageSmoothingEnabled = false`, целочисленный масштаб, devicePixelRatio учтён.
- Камера следует за целью с запаздыванием `config.arena.camera_lag`, кламп по границам арены.
- `drawEntity` пробует `drawSheet`, при неудаче рисует прямоугольник цветом `color`
  (плейсхолдер по правилу «нет PNG → цветной квадрат»).
- Никаких `shadowBlur`, `filter`, `globalCompositeOperation` в горячем пути.

### `net/transport.js`
```js
export const CH = { INPUT: 'input', SNAPSHOT: 'snapshot', EVENT: 'event', LOBBY: 'lobby' };
export function createLocalTransport()     // соло: комната из одного, петля вызовов
export function createSocketTransport(url) // кооп: заглушка M3
// оба → { role, id, send(ch, payload, toId?), on(ch, cb), off(ch, cb), close(), isHost }
```
`LocalTransport` — полноценный, не заглушка: `send` немедленно доставляет подписчикам
той же стороны (петля host↔client в одном процессе), `isHost === true`, `id = 0`.
`SocketTransport` — тот же интерфейс, но методы бросают `new Error('M3')`; каркас
(конструктор, поля, подписки) уже на месте.

**Критично**: код симуляции обязан работать через транспорт и **не знать**, соло это или
кооп. Никаких `if (solo)` в `sim/`.

### `sim/run.js`
```js
export function createRun({ config, seed, transport, players })
// → { state, step(dt), applyInput(playerId, input), snapshot(), stats }
```
M0-объём: состояние забега `{ wave: 1, phase: 'wave', time: 0, seed, players: [...] }`,
игроки — объекты `{ id, name, character, x, y, vx, vy, hp, maxHp, dir, alive }`.
`step(dt)` двигает игроков по последнему вводу со скоростью `config.player.move_speed`,
клампит по границам арены, обновляет `dir` (0=S,1=E,2=N,3=W) по вектору движения.
Ввод приходит **только через транспорт** (`transport.on(CH.INPUT, …)`), не напрямую из
`input.js`. Весь рандом — из `createRng(seed)`, `Math.random()` запрещён.

### `ui/debug.js`
```js
export function createDebug(loop, transport)  // → { visible, toggle(), draw(ctx, extra) }
```
Оверлей по `F3`: fps, мс sim / render, число шагов, число сущностей, КБ/с (пока 0),
пинг (пока 0), роль (`хост`/`клиент`), сид забега. Моноширинный шрифт, полупрозрачная
подложка, левый верхний угол.

### `ui/screens.js`
```js
export function createScreens(root, config, t)   // t(key) — переводчик из config.i18n
// → { show(name, data), current }
```
M0: экраны `menu` (кнопка «Играть» → `ui.menu.play`) и `game` (прячет DOM-панель, играет
canvas). Тексты **только** через `t('ui.menu.play')` — ни одной русской строки в JS.

### `main.js`
Точка входа: `GET /api/config` (с `credentials: 'same-origin'`) → `GET /api/profile` →
собирает `t()` из `config.i18n.ru` → `createScreens` → по «Играть» делает
`POST /api/run/start` с `{character, arena, danger}` (первые доступные из конфига) →
получает `{run_id, seed}` → поднимает `createLocalTransport()`, `createRun`,
`createRenderer`, `createInput`, `createLoop` и запускает.
Каждый кадр: собрать `input.move` → `transport.send(CH.INPUT, …)` → `run.step` в `update`,
отрисовать арену и игроков в `render`. `F3` переключает оверлей.
`window.__BOOT__.name` — имя игрока.

## Тесты `tests/js/` (запускаются `node --test tests/js/`)

Модули `engine/` не должны зависеть от DOM на уровне импорта — тестируемые (`rng`, `pool`,
`grid`, `loop`) обязаны импортироваться в node без `window`/`document`. Если нужен доступ
к глобалям — только внутри функций, лениво.
- `rng.test.js`: один сид → одинаковая последовательность; разные сиды → разные;
  `int(a,b)` в границах; `pick` не выходит за массив; `weighted` уважает нулевой вес.
- `pool.test.js`: `spawn` до потолка → затем `null`; `release` — swap-remove, `count` падает;
  повторный `spawn` переиспользует объект (сравнение по ссылке), после 10000 циклов
  количество созданных объектов равно `capacity`.
- `grid.test.js`: точки в радиусе находятся, за радиусом — нет; `query` не выходит за
  `out.length`; повторный `clear`+`insert` не течёт.
- `loop.test.js`: при подставном таймере накопитель делает ровно ожидаемое число шагов и
  не превышает `maxCatchup`.

## Жёсткие ограничения (нарушение = переделка)

- **Ноль аллокаций в горячем цикле**: никаких `map/filter/forEach/reduce`, литералов
  объектов и массивов, замыканий и `...spread` внутри `step`/`render`. Только `for`,
  переиспользуемые буферы и объекты out-параметров.
- Коллизии и поиск соседей — только через `grid.js`. Никаких O(N²).
- **Никакого хардкода** чисел баланса, названий и texture-id — всё берётся из
  `config/game_config.json` (клиент получает его из `/api/config`). Числа вроде размера
  арены, скорости, dt — из конфига, не из констант в JS.
- Все видимые тексты — через `t('ui.*')` из `config.i18n`. Ни одной русской строки в коде
  (комментарии по-русски — можно и нужно).
- Никакого `Math.random()` в `sim/`.
- Запрещённые слова (Warhammer, Space Marine, Imperium, bolter, chainsword и т.п.) не
  должны появляться нигде, включая комментарии — см. AGENTS.md §1.

## Приёмка

- `cd /opt/sites/ash-and-iron && node --test tests/js/` — все тесты зелёные.
- `node --input-type=module -e "import('./static/js/engine/rng.js').then(m=>console.log(m.createRng(1).int(1,6)))"` работает.
- Ни один файл вне списка выше не изменён (`git status` покажет только твои файлы).
- В конце отчитайся: список созданных файлов + вывод `node --test`.
