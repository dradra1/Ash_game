Project: /opt/sites/ash-and-iron. Read AGENTS.md first and follow it strictly.

Каркас M0 уже готов: `engine/loop.js`, `rng.js`, `pool.js`, `grid.js`, `input.js`,
`sprites.js`, `render.js`, `net/transport.js`, `sim/run.js`, `ui/debug.js`, `ui/screens.js`.
**Прочитай их перед тем, как писать** — ты расширяешь этот код, а не начинаешь заново.
API этих модулей менять нельзя (кроме `sim/run.js`, который ты дописываешь).

## Задача (этап M1 — ядро боя)

Собрать боевое ядро автошутера: игрок бегает, оружие бьёт само по ближайшей цели, враги
спавнятся волнами и идут на игроков, из убитых падает прах, копится опыт, волна кончается
по таймеру. Босса, лавки и левелапа на этом этапе нет.

## Файлы, которые ты создаёшь или дописываешь (и только они)

```
static/js/sim/run.js         — дописать: фазы волны, таймер, реестр сущностей
static/js/sim/player.js      — новый
static/js/sim/enemy.js       — новый
static/js/sim/spawn.js       — новый
static/js/sim/weapon.js      — новый
static/js/sim/projectile.js  — новый
static/js/sim/pickup.js      — новый
static/js/ui/hud.js          — новый
tests/js/spawn.test.js  weapon.test.js  enemy.test.js   — новые
```
Также разрешено дописать `static/js/engine/render.js` и `static/js/main.js` — ровно
настолько, насколько нужно, чтобы отрисовать новые сущности и подключить HUD.
**Не трогай** `app.py`, `db.py`, `templates/`, `config/game_config.json`, `tools/`,
`tests/py/`, `*.md`, `specs/`.

**Конфиг менять нельзя.** Если тебе нужно число, которого нет в `config/game_config.json` —
не выдумывай константу в JS: напиши об этом в финальном отчёте, я добавлю поле в конфиг.

## Требования

### 1. Модель сущностей — пулы, не массивы объектов

Все враги, снаряды и подборы живут в `createPool` из `engine/pool.js` с ёмкостью из
конфига (`sim.max_enemies_base`, `sim.max_projectiles`, `sim.max_pickups`). Переполнение —
**деградация, а не рост**: `spawn()` вернул `null` → просто не создаём сущность.
Итерация — только `for (let i = 0; i < pool.count; i++)`. Внутри `step` — ни одного
литерала объекта/массива, ни одного `map/filter/forEach`, ни одного замыкания.

### 2. `sim/player.js`

Движение по вводу со скоростью `config.player.move_speed * (1 + move_speed_pct/100)`,
кламп по арене с учётом `arena.wall_padding`. HP, `iframes` после получения урона
(`config.player.iframes`), смерть (`alive = false`). Подбор праха касанием в радиусе
`config.player.pickup_radius`, притяжение с `sim.pickup_magnet_radius`. Направление
`dir` (0=S,1=E,2=N,3=W) по вектору движения — для выбора строки спрайт-листа.
Резолв статов на этом этапе минимальный: база из `config.player.base` + модификаторы
персонажа (`characters[id].stats`). Полный резолв придёт в M2 — вынеси его в функцию
`resolveStats(character, config)`, чтобы M2 её расширил, а не переписал.

### 3. `sim/weapon.js`

Слоты оружия (`config.run.weapon_slots`, но на M1 хватит стартового оружия персонажа).
Каждое оружие: кулдаун `cooldown / (1 + attack_speed_pct/100)`, поиск **ближайшего живого
врага** в радиусе `range` **через `grid.query`** (никакого перебора всех врагов), по
готовности — атака.
- `class: "melee"`, `shape.type: "arc"` — мгновенный урон всем врагам в секторе `angle`
  градусов в сторону цели в пределах `range`; отбрасывание `knockback`.
- `class: "ranged"`, `shape.type: "projectile"` — выпускает `shape.count` снарядов со
  скоростью `shape.speed`, разбросом `shape.spread` градусов, `pierce`, `ttl`.
- Урон: `(damage + melee_dmg|ranged_dmg|elem_dmg по class) * (1 + damage_pct/100)`,
  крит по `crit_pct` с множителем `stats.crit_mult`. Все коэффициенты — из конфига.
Цель ищется не каждый кадр: перевыбор цели по `waves.retarget_interval`, между
перевыборами оружие бьёт по сохранённой цели, если она жива и в радиусе.

### 4. `sim/projectile.js`

Полёт по прямой, `ttl`, попадание по врагу (`grid`), `pierce` (сколько врагов пробивает),
удаление при выходе за арену. Снаряды врагов — отдельный флаг `hostile`, бьют игрока.

### 5. `sim/enemy.js`

Типы из `config.enemies`. Архетипы ИИ на M1 — два: `chase` (идти на цель по прямой) и
`shooter` (держать дистанцию `attack.keep_dist`, стрелять по `attack.cooldown`).
**Выбор цели — ближайший живой игрок, пересчёт раз в `waves.retarget_interval` секунд**,
а не каждый кадр. Контактный урон при пересечении с игроком с внутренним кулдауном.
Отбрасывание с учётом `knockback_resist`. Смерть → дроп праха (`ash`) и начисление XP.
Скейлинг по волне — строго по формулам конфига:
```
hp    = base_hp    * (1 + waves.hp_growth    * (wave-1)) * danger.hp_mult  * (1 + coop.hp_per_player * (N-1))
dmg   = base_dmg   * (1 + waves.dmg_growth   * (wave-1)) * danger.dmg_mult
speed = base_speed * (1 + waves.speed_growth * (wave-1)),  потолок waves.speed_cap
```

### 6. `sim/spawn.js`

Бюджет спавна в секунду:
`(waves.budget_base + waves.budget_per_wave * wave) * danger.density * (1 + coop.budget_per_player * (N-1))`.
Пачками с интервалом `waves.pack_interval`, размер пачки
`waves.pack_size_base + waves.pack_size_per_wave * wave`. Точка спавна — за краем арены
(`arena.spawn_margin`), но **не ближе `arena.min_spawn_dist` к любому живому игроку**.
Пул врагов — `arenas[id].enemy_pool`, отфильтрованный по `min_wave`/`max_wave`, выбор по
`weight` через `rng.weighted`. Потолок живых врагов:
`min(sim.max_enemies_cap, sim.max_enemies_base + sim.max_enemies_per_player * (N-1))`.

### 7. `sim/pickup.js`

Прах: падает с врага, лежит, притягивается к игроку в радиусе магнита, подбирается.
Слияние стопок при переполнении `sim.max_pickups` (стопка ×`sim.pickup_stack_merge`).
В конце волны весь оставшийся прах собирается автоматически за
`run.wave_end_collect_sec`.

### 8. `sim/run.js` — фазы забега

Фазы: `intro` (`run.wave_intro_sec`) → `wave` → `collect` (`run.wave_end_collect_sec`) →
`shop` (на M1 — пустая заглушка, сразу следующая волна) → …
Длительность волны: `min(run.wave_len_cap, run.wave_len_base + run.wave_len_step * (wave-1))`.
Конец волны: живые враги исчезают, прах собирается. XP и уровень: `xp_to_next(level) =
round(level.xp_formula.base + level.xp_formula.k * level ** level.xp_formula.pow)` —
уровень растёт, выбор улучшений придёт в M2 (пока просто счётчик уровня).
Смерть игрока: `alive = false`; в соло — конец забега, экран итогов, `POST /api/run/finish`.

### 9. `ui/hud.js`

Полоса HP с числом, номер и таймер волны, счётчик праха, полоса опыта с уровнем, иконки
оружия с кулдаунами. Тексты — **только** через `t('ui.hud.*')`. Рисуется на том же canvas
поверх мира (не DOM).

### 10. Рендер новых сущностей

`render.js` дополняется отрисовкой врагов, снарядов и праха через `drawEntity` (спрайт по
`texture`, при отсутствии PNG — прямоугольник цветом `color` из конфига). Размер спрайта —
поле `sprite` сущности, иначе `config.render.sprite_default`. Под игроком — эллипс цветом
игрока (`render.player_ring`), над головой — плашка с именем (`render.nameplate`).

## Тесты `tests/js/` (`node --test tests/js/`)

Тестируемые модули не должны требовать DOM при импорте.
- `spawn.test.js`: бюджет растёт по формуле; точка спавна никогда не ближе
  `min_spawn_dist` к игроку; потолок живых врагов не превышается; при `danger` 0 и 3
  плотность отличается ровно на `density`.
- `weapon.test.js`: кулдаун уменьшается от `attack_speed_pct`; урон считается по формуле
  с `damage_pct`; крит с шансом 100% даёт ровно `crit_mult`; цель не перевыбирается чаще
  `retarget_interval`.
- `enemy.test.js`: скейлинг hp/damage/speed по волне совпадает с формулой; потолок
  скорости `speed_cap` соблюдается; кооп-множитель HP применяется по числу игроков.

## Жёсткие ограничения

- **Ноль аллокаций в горячем цикле.** Это главное требование этапа: бюджет симуляции
  6 мс при 450 врагах и 600 снарядах. Никаких временных объектов на кадр.
- Поиск соседей и коллизии — **только** через `engine/grid.js`. Никаких O(N²).
- Весь рандом — из `engine/rng.js` от сида забега. `Math.random()` в `sim/` запрещён.
- Никакого хардкода чисел баланса, названий и texture-id — всё из конфига.
- Симуляция не знает, соло это или кооп: ввод приходит через `net/transport.js`,
  число игроков берётся из состояния забега. Никаких `if (solo)`.
- Все видимые тексты — через `t('ui.*')`. Ни одной русской строки в JS (комментарии — можно).
- Запрещённые слова (см. AGENTS.md §1) не должны появляться нигде, включая комментарии.

## Приёмка

- `node --test tests/js/` — все тесты зелёные, включая тесты из M0.
- Ни один файл вне списка не изменён.
- В отчёте: список файлов, вывод `node --test`, и **отдельным пунктом** — каких полей
  тебе не хватило в конфиге (если пришлось бы хардкодить).
