Project: /opt/sites/ash-and-iron. Read AGENTS.md first and follow it strictly.

Это новый пустой проект. Ты пишешь **только серверную часть каркаса (этап M0)**.

## Задача

Flask + Flask-SocketIO бэкенд для браузерной игры «Прах и Железо». Сервер **не считает
игру** — он обслуживает аккаунты, отдаёт конфиг, хранит мету и (позже) релеит сообщения
комнат. Никакой игровой логики, никаких тиков, никаких потоков симуляции.

## Файлы, которые ты создаёшь (и только они)

- `app.py` — Flask-приложение, auth, REST API, инициализация SocketIO
- `db.py` — SQLite: подключение, миграция схемы, хелперы
- `requirements.txt`
- `Dockerfile`
- `docker-compose.yml`
- `nginx/ash-and-iron.conf`
- `templates/login.html`, `templates/index.html`
- `static/css/style.css`
- `tests/py/test_api.py`

**Не трогай** `config/game_config.json`, `CLAUDE.md`, `AGENTS.md`, `README.md`, `tools/`,
`specs/`, и **ничего внутри `static/js/`** — там параллельно работает другой исполнитель.
Не добавляй зависимостей сверх перечисленных ниже. Не переформатируй чужой код.

## Требования

### 1. `db.py` — SQLite

Путь к БД: `os.environ.get("ASH_DATA", "data")` + `/users.db`. Каталог создать при старте.
`sqlite3` с `check_same_thread=False`, `row_factory = sqlite3.Row`, WAL.
Схема создаётся идемпотентно (`CREATE TABLE IF NOT EXISTS`) при импорте/`init_db()`:

```sql
users        (id INTEGER PK, name TEXT UNIQUE NOT NULL, pw_hash TEXT NOT NULL,
              relics INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL)
unlocks      (user_id INTEGER, kind TEXT, item_id TEXT, at REAL,
              PRIMARY KEY (user_id, kind, item_id))          -- kind: faction|character|weapon|arena
upgrades     (user_id INTEGER, upgrade_id TEXT, rank INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (user_id, upgrade_id))
achievements (user_id INTEGER, ach_id TEXT, at REAL, PRIMARY KEY (user_id, ach_id))
runs         (id INTEGER PK, run_id TEXT UNIQUE NOT NULL, user_id INTEGER NOT NULL,
              seed INTEGER NOT NULL, room TEXT, players INTEGER NOT NULL DEFAULT 1,
              character TEXT, arena TEXT, danger INTEGER,
              wave INTEGER DEFAULT 0, win INTEGER DEFAULT 0, bosses INTEGER DEFAULT 0,
              time_sec REAL DEFAULT 0, kills INTEGER DEFAULT 0, score INTEGER DEFAULT 0,
              relics INTEGER DEFAULT 0, flagged INTEGER DEFAULT 0,
              started_at REAL NOT NULL, finished_at REAL)
```
Индексы: `runs(user_id)`, `runs(score DESC)`, `runs(finished_at)`.

Эта схема — финальная, под будущий этап меты. Не упрощай её.

### 2. Конфиг

- Репо-конфиг `config/game_config.json` — **сид первого запуска**. При старте, если
  `<ASH_DATA>/game_config.json` не существует — скопировать туда репо-конфиг.
- Живой конфиг читается из `<ASH_DATA>/game_config.json` и держится в памяти
  (`load_config()`), с функцией `reload_config()`.
- `GET /api/config` → живой конфиг целиком, JSON. Поддержи `ETag` = `"v<content_version>"`
  и ответ `304` при совпадении `If-None-Match`.

### 3. Auth

- `secret_key`: читается из `<ASH_DATA>/secret_key`, при отсутствии генерируется
  `secrets.token_hex(32)` и записывается (chmod 600).
- `POST /api/register` `{name, password}` → создаёт юзера (`generate_password_hash`),
  логинит, `{ok: true, user: {...}}`. Валидация: имя `^[A-Za-z0-9_А-Яа-яЁё-]{3,20}$`,
  пароль ≥ 6 символов, имя занято → 409.
- `POST /api/login` `{name, password}` → `check_password_hash`; неверно → 401.
- `POST /api/logout` → чистит сессию.
- `GET /`: не залогинен → редирект на `/login`; залогинен → `render_template("index.html")`.
- `GET /login` → `templates/login.html` (форма входа и регистрации, шлёт JSON на `/api/*`).
- Декоратор `@login_required` для всех `/api/*` кроме register/login/config.
- `socketio.on("connect")`: без сессии → `return False`.

### 4. REST API (M0-объём)

- `GET  /api/profile` → `{name, relics, unlocks: {faction: [...], character: [...],
  weapon: [...], arena: [...]}, upgrades: {id: rank}, achievements: [...],
  best: {wave, score}}`
- `POST /api/run/start` `{character, arena, danger, room?}` → создаёт запись в `runs`,
  возвращает `{run_id, seed}`. **Сид выдаёт сервер**: `secrets.randbits(32)`.
  `run_id` — `secrets.token_urlsafe(12)`.
- `POST /api/run/finish` `{run_id, wave, win, bosses, time_sec, kills, score}` →
  обновляет запись, возвращает `{relics_gained: 0, unlocks: [], achievements: []}`.
  **На этом этапе начисление реликвий не реализуем** — оставь функцию
  `award_relics(run) -> int`, возвращающую 0, с комментарием `# M6`. Чужой `run_id`
  или уже завершённый → 403/409.
- `GET  /api/board?mode=solo|coop&danger=&character=` → топ-20 из `runs`
  (`flagged=0`), поля `{name, character, danger, wave, score, finished_at}`.

Все ответы — JSON. Ошибки — `{"error": "<ключ>"}` с осмысленным HTTP-кодом.

### 5. Шаблоны

- `templates/login.html` — тёмная страница входа, вкладки «Вход»/«Регистрация», fetch
  на `/api/login` и `/api/register`, показ ошибки, редирект на `/` при успехе.
- `templates/index.html` — страница игры. Обязательный контракт (по нему пишется клиент):
  ```html
  <canvas id="game"></canvas>
  <div id="ui"></div>
  <script>window.__BOOT__ = {{ boot|tojson }};</script>
  <script type="module" src="/static/js/main.js"></script>
  ```
  где `boot` = `{"name": <имя юзера>}`. Больше в шаблоне ничего игрового быть не должно —
  весь UI строит клиентский JS.
- `static/css/style.css` — сброс полей, `background:#0d0f14`, `color:#c9c4b8`,
  canvas на весь экран, `image-rendering: pixelated`. Без фреймворков.

### 6. Docker и nginx

- `requirements.txt`: `flask>=3.0`, `flask-socketio>=5.3`, `simple-websocket>=1.0`,
  `werkzeug>=3.0`. Больше ничего.
- `Dockerfile`: `python:3.12-slim`, копия проекта, `EXPOSE 8150`, `CMD ["python","app.py"]`.
- `docker-compose.yml`: сервис `ash_and_iron`, `container_name: ash_and_iron`,
  порт `127.0.0.1:8150:8150`, volume `./data:/app/data`, `environment: ASH_DATA=/app/data`,
  `restart: unless-stopped`.
- `app.py` в конце: `socketio.run(app, host="0.0.0.0", port=8150, allow_unsafe_werkzeug=True)`.
- `nginx/ash-and-iron.conf` — server-блок для `ash.sanyago.space`, `proxy_pass` на
  `http://127.0.0.1:8150`, апгрейд WebSocket (`Upgrade`/`Connection`), `proxy_read_timeout 3600`.
  Только HTTP-блок с комментарием, что TLS навешивает certbot.

### 7. Тесты `tests/py/test_api.py` (pytest)

Через `app.test_client()`, с временным `ASH_DATA` (tmp_path, monkeypatch env перед импортом).
Покрыть: регистрация → успех; повтор имени → 409; короткий пароль → 400; логин верный/
неверный; `/api/profile` без сессии → 401; `/api/config` отдаёт `content_version` и
возвращает 304 на повторный запрос с ETag; `/api/run/start` возвращает разные сиды;
`/api/run/finish` с чужим `run_id` → 403; `/api/board` возвращает список.

## Жёсткие ограничения (нарушение = переделка)

- **Никакого хардкода** названий, чисел баланса и texture-id — всё в `config/game_config.json`.
  На сервере из конфига пока читается только `content_version`; не дублируй игровые числа в Python.
- Никакой игровой симуляции на сервере. Никаких фоновых тиков и `start_background_task`.
- Один процесс, один воркер. Не добавляй gunicorn/eventlet/gevent — только threading-режим.
- Запрещённые слова (Warhammer, Space Marine, Imperium, bolter, chainsword и т.п.) не должны
  появляться нигде, включая комментарии — см. AGENTS.md §1.
- Комментарии и тексты интерфейса — по-русски.

## Приёмка

- `cd /opt/sites/ash-and-iron && python3 -m pytest tests/py -q` — все тесты зелёные.
- `python3 -c "import app"` не падает.
- В конце отчитайся: список созданных файлов + вывод pytest.
