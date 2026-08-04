import json
import os
import re
import secrets
import time
from typing import Optional
from functools import wraps
from pathlib import Path

from flask import (
    Flask,
    Response,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
)
from flask_socketio import SocketIO, join_room, leave_room
from werkzeug.security import check_password_hash, generate_password_hash

import db
import lodge
import meta
from rooms import Rooms

APP_ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("ASH_DATA", "data"))
# Репо-сид переопределяется переменной окружения по одной причине: админская запись
# конфига зеркалит его обратно в сид (см. /api/admin/config), а тесты гоняют
# настоящее приложение. Без подмены каждый прогон pytest переписывал бы
# config/game_config.json в рабочей копии и накручивал content_version — ровно это
# и происходило, пока drift не всплыл в git diff.
REPO_CONFIG = Path(os.environ.get("ASH_REPO_CONFIG")
                   or APP_ROOT / "config" / "game_config.json")
LIVE_CONFIG = DATA_DIR / "game_config.json"
SECRET_KEY_FILE = DATA_DIR / "secret_key"

app = Flask(__name__)
# Кука сессии — только same-site: авторизация в сокете идёт по этой же куке, и «*» в CORS
# позволил бы чужому сайту открыть сокет от имени залогиненного игрока.
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")
socketio = SocketIO(app, async_mode="threading")

_NAME_RE = re.compile(r"^[A-Za-z0-9_А-Яа-яЁё-]{3,20}$")

_loaded_config: dict = {}


def _ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _init_secret_key() -> bytes:
    _ensure_data_dir()
    if SECRET_KEY_FILE.exists():
        return SECRET_KEY_FILE.read_bytes()
    key = secrets.token_hex(32).encode()
    SECRET_KEY_FILE.write_bytes(key)
    os.chmod(SECRET_KEY_FILE, 0o600)
    return key


app.secret_key = _init_secret_key()


def _write_live_config(cfg: dict) -> None:
    LIVE_CONFIG.write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _merge_missing_i18n(live: dict, repo: dict) -> bool:
    """Доливает отсутствующие ключи i18n из репо — защита от сырых ui.* на экране."""
    changed = False
    repo_i18n = repo.get("i18n") or {}
    live_i18n = live.setdefault("i18n", {})
    for lang, repo_dict in repo_i18n.items():
        if not isinstance(repo_dict, dict):
            continue
        live_dict = live_i18n.setdefault(lang, {})
        for key, value in repo_dict.items():
            if key not in live_dict:
                live_dict[key] = value
                changed = True
    return changed


def _copy_config_if_needed():
    """Сид + промоут: volume data/ переживает rebuild и иначе остаётся на старой версии."""
    _ensure_data_dir()
    if not REPO_CONFIG.exists():
        return False
    repo = json.loads(REPO_CONFIG.read_text(encoding="utf-8"))
    if not LIVE_CONFIG.exists():
        _write_live_config(repo)
        return True

    live = json.loads(LIVE_CONFIG.read_text(encoding="utf-8"))
    repo_ver = int(repo.get("content_version") or 0)
    live_ver = int(live.get("content_version") or 0)
    if repo_ver > live_ver:
        # Репо впереди (после деплоя патчей) — вливаем сид в живой конфиг.
        _write_live_config(repo)
        return True
    if _merge_missing_i18n(live, repo):
        _write_live_config(live)
        return True
    return False


def load_config() -> dict:
    global _loaded_config
    _copy_config_if_needed()
    _loaded_config = json.loads(LIVE_CONFIG.read_text(encoding="utf-8"))
    return _loaded_config


def reload_config() -> dict:
    return load_config()


def get_config() -> dict:
    return _loaded_config


def _config_for_client() -> dict:
    """Живой конфиг + недостающие i18n из репо (на случай отстающего volume)."""
    if _copy_config_if_needed():
        load_config()
    cfg = dict(get_config())
    if not REPO_CONFIG.exists():
        return cfg
    repo = json.loads(REPO_CONFIG.read_text(encoding="utf-8"))
    repo_ver = int(repo.get("content_version") or 0)
    live_ver = int(cfg.get("content_version") or 0)
    # Volume отстал от образа — отдаём репо целиком (и пишем его в live выше).
    if repo_ver > live_ver:
        return repo
    # Версии равны, но ключи i18n могли не доехать — доливаем из репо.
    live_i18n = cfg.get("i18n") or {}
    repo_i18n = repo.get("i18n") or {}
    i18n = {}
    for lang in set(live_i18n) | set(repo_i18n):
        base = dict(repo_i18n.get(lang) or {})
        base.update(live_i18n.get(lang) or {})
        i18n[lang] = base
    if i18n:
        cfg["i18n"] = i18n
    return cfg


load_config()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "auth_required"}), 401
        return view(*args, **kwargs)

    return wrapped


def is_admin_user(user) -> bool:
    if user is None:
        return False
    whitelist = (get_config().get("admin") or {}).get("whitelist") or []
    return user["name"] in whitelist


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "auth_required"}), 401
        user = current_user()
        if not is_admin_user(user):
            return jsonify({"error": "forbidden"}), 403
        return view(*args, **kwargs)

    return wrapped


_FORBIDDEN_WORDS = (
    "warhammer", "40000", "40 000", "40k", "space marine", "astartes",
    "imperium", "emperor", "ork", "tyranid", "necron", "eldar", "adeptus",
    "mechanicus", "inquisition", "inquisitor", "bolter", "chainsword",
    "servo-skull", "aquila", "double-headed eagle", "skull and cog",
)


def _contains_forbidden(obj) -> Optional[str]:
    """Вернуть запрещённое слово, если оно встретилось в строках объекта."""
    stack = [obj]
    while stack:
        cur = stack.pop()
        if isinstance(cur, dict):
            stack.extend(cur.values())
            stack.extend(cur.keys())
        elif isinstance(cur, (list, tuple)):
            stack.extend(cur)
        elif isinstance(cur, str):
            low = cur.lower()
            for w in _FORBIDDEN_WORDS:
                if w in low:
                    return w
    return None


def current_user() -> db.sqlite3.Row | None:
    uid = session.get("user_id")
    if uid is None:
        return None
    conn = db.get_db()
    try:
        return conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    finally:
        conn.close()


@app.route("/")
def root():
    if "user_id" not in session:
        return redirect("/login")
    user = current_user()
    if user is None:
        session.clear()
        return redirect("/login")
    return render_template(
        "index.html",
        boot={"name": user["name"], "admin": is_admin_user(user)},
    )


@app.route("/favicon.ico")
def favicon():
    return send_from_directory(
        APP_ROOT / "static",
        "favicon.ico",
        mimetype="image/vnd.microsoft.icon",
    )


@app.route("/login")
def login_page():
    if "user_id" in session and current_user() is not None:
        return redirect("/")
    return render_template("login.html")


@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    password = data.get("password") or ""

    if not _NAME_RE.match(name):
        return jsonify({"error": "invalid_name"}), 400
    if len(password) < 6:
        return jsonify({"error": "short_password"}), 400

    existing = db.get_user_by_name(name)
    if existing is not None:
        return jsonify({"error": "name_taken"}), 409

    pw_hash = generate_password_hash(password)
    user_id = db.create_user(name, pw_hash)
    session["user_id"] = user_id
    return jsonify({"ok": True, "user": {"id": user_id, "name": name}}), 201


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    password = data.get("password") or ""

    user = db.get_user_by_name(name)
    if user is None or not check_password_hash(user["pw_hash"], password):
        return jsonify({"error": "invalid_credentials"}), 401

    session["user_id"] = user["id"]
    return jsonify({"ok": True, "user": {"id": user["id"], "name": user["name"]}})


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/config")
def api_config():
    cfg = _config_for_client()
    etag = f'"v{cfg.get("content_version", 0)}"'
    if request.headers.get("If-None-Match") == etag:
        return Response(status=304)
    return Response(
        json.dumps(cfg, ensure_ascii=False),
        mimetype="application/json",
        headers={"ETag": etag, "Cache-Control": "no-store"},
    )


@app.route("/api/profile")
@login_required
def api_profile():
    user = current_user()
    if user is None:
        session.clear()
        return jsonify({"error": "auth_required"}), 401

    return jsonify(
        {
            "name": user["name"],
            "relics": user["relics"],
            "unlocks": db.get_user_unlocks(user["id"]),
            "upgrades": db.get_user_upgrades(user["id"]),
            "achievements": db.get_user_achievements(user["id"]),
            "best": db.get_user_best(user["id"]),
            # Заказы и лор едут вместе с профилем, а не отдельным запросом:
            # бейдж «новое» на здании города рисуется из тех же данных, что и
            # сам Ловчий Дом, а профиль город и так перечитывает при каждом
            # возврате в меню.
            "quests": db.get_user_quests(user["id"]),
            "lore": db.get_user_lore(user["id"]),
            "admin": is_admin_user(user),
        }
    )


@app.route("/api/admin/me")
@login_required
def api_admin_me():
    user = current_user()
    return jsonify({"admin": is_admin_user(user)})


@app.route("/api/admin/config", methods=["GET"])
@admin_required
def api_admin_config_get():
    cfg = get_config()
    return jsonify({
        "characters": cfg.get("characters", {}),
        "weapons": cfg.get("weapons", {}),
        "achievements": cfg.get("achievements", {}),
        "curses": cfg.get("curses", {}),
        "meta": {"upgrades": (cfg.get("meta") or {}).get("upgrades", [])},
        "content_version": cfg.get("content_version"),
    })


@app.route("/api/admin/config", methods=["PUT"])
@admin_required
def api_admin_config_put():
    data = request.get_json(silent=True) or {}
    section = data.get("section")
    payload = data.get("data")
    if section not in ("characters", "weapons", "achievements", "curses", "meta.upgrades"):
        return jsonify({"error": "bad_section"}), 400
    if payload is None:
        return jsonify({"error": "missing_data"}), 400

    forbidden = _contains_forbidden(payload)
    if forbidden:
        return jsonify({"error": "forbidden_word", "word": forbidden}), 400

    cfg = get_config()
    if section == "meta.upgrades":
        if not isinstance(payload, list):
            return jsonify({"error": "bad_data"}), 400
        cfg.setdefault("meta", {})["upgrades"] = payload
    else:
        if not isinstance(payload, dict):
            return jsonify({"error": "bad_data"}), 400
        cfg[section] = payload

    cfg["content_version"] = int(cfg.get("content_version") or 0) + 1

    text = json.dumps(cfg, ensure_ascii=False, indent=2) + "\n"
    LIVE_CONFIG.write_text(text, encoding="utf-8")
    # Зеркало в репо-сид, чтобы патчи и деплой не расходились
    try:
        REPO_CONFIG.write_text(text, encoding="utf-8")
    except OSError:
        pass

    reload_config()
    return jsonify({"ok": True, "content_version": get_config()["content_version"],
                    "config": {
                        "characters": get_config().get("characters", {}),
                        "weapons": get_config().get("weapons", {}),
                        "achievements": get_config().get("achievements", {}),
                        "curses": get_config().get("curses", {}),
                        "meta": {"upgrades": get_config().get("meta", {}).get("upgrades", [])},
                    }})


@app.route("/api/admin/relics", methods=["POST"])
@admin_required
def api_admin_relics():
    """Чит: насыпать себе реликвий, чтобы проверять метапрогрессию без забегов.

    Единственный чит, который нельзя было сделать функцией в `sim/run.js`:
    реликвии начисляет сервер по своей формуле (ТЗ §3.10). Сумма берётся из
    конфига, тело запроса не читается вовсе — иначе «чит на 1000» превратился бы
    в «чит на сколько попросишь», и уже не важно, что кнопка админская.
    """
    user = current_user()
    amount = int((get_config().get("meta") or {}).get("cheat_relics") or 0)
    if amount <= 0:
        return jsonify({"error": "disabled"}), 400
    db.add_relics(user["id"], amount)
    return jsonify({"ok": True, "granted": amount,
                    "relics": current_user()["relics"]})


@app.route("/api/run/start", methods=["POST"])
@login_required
def run_start():
    user = current_user()
    if user is None:
        session.clear()
        return jsonify({"error": "auth_required"}), 401

    data = request.get_json(silent=True) or {}
    character = data.get("character")
    arena = data.get("arena")
    danger = data.get("danger")
    room = data.get("room")
    players = data.get("players", 1)
    curses = data.get("curses") or []

    if not character or not arena or danger is None:
        return jsonify({"error": "missing_fields"}), 400

    run_id = secrets.token_urlsafe(12)
    seed = secrets.randbits(32)
    return jsonify(
        db.start_run(
            user_id=user["id"],
            run_id=run_id,
            seed=seed,
            character=character,
            arena=arena,
            danger=int(danger),
            room=room,
            players=int(players),
            curses=json.dumps(list(curses)),
        )
    )


@app.route("/api/run/finish", methods=["POST"])
@login_required
def run_finish():
    user = current_user()
    if user is None:
        session.clear()
        return jsonify({"error": "auth_required"}), 401

    data = request.get_json(silent=True) or {}
    run_id = data.get("run_id")
    if not run_id:
        return jsonify({"error": "missing_run_id"}), 400

    run = db.get_run(run_id)
    if run is None or run["user_id"] != user["id"]:
        return jsonify({"error": "not_your_run"}), 403
    if run["finished_at"] is not None:
        return jsonify({"error": "already_finished"}), 409

    wave = max(0, int(data.get("wave", 0)))
    win = 1 if data.get("win") else 0
    bosses = max(0, int(data.get("bosses", 0)))
    time_sec = max(0.0, float(data.get("time_sec", 0)))
    kills = max(0, int(data.get("kills", 0)))
    score = max(0, int(data.get("score", 0)))
    damage_taken = max(0, int(data.get("damage_taken", 0)))
    ash_gained = max(0, int(data.get("ash_gained", 0)))
    shop_buys = max(0, int(data.get("shop_buys", 0)))
    players = run["players"] or 1

    cfg = get_config()
    # Плаузибилити-проверки: подозрительное помечается флагом и не идёт в
    # лидерборд, но реликвии всегда считает сервер по своей формуле.
    reasons = meta.check_run(cfg, run, wave, win, bosses, time_sec, kills, score, players)

    cap = meta.kills_cap(cfg, run, min(wave, cfg["run"]["waves"]), players)
    kills_by_type, kbt_reason = lodge.sanitize_kills_by_type(
        cfg, data.get("kills_by_type"), cap)
    if kbt_reason:
        reasons.append(kbt_reason)

    relics = meta.award_relics(cfg, run, wave, win, bosses, players)
    db.finish_run(run_id, wave, win, bosses, time_sec, kills, score, relics,
                  damage_taken, ash_gained, shop_buys,
                  json.dumps(kills_by_type, ensure_ascii=False))
    if reasons:
        db.flag_run(run_id, ",".join(reasons))

    summary = {
        "wave": wave, "win": win, "bosses": bosses, "kills": kills,
        "damage_taken": damage_taken, "ash_gained": ash_gained,
        "shop_buys": shop_buys, "kills_by_type": kills_by_type,
    }

    conn = db.get_db()
    try:
        run_after = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
        relics += meta.first_clear_bonus(cfg, conn, user["id"], run_after, win)
        fresh = meta.check_achievements(cfg, conn, user["id"])
        # Заказы двигаются по УЖЕ обновлённой строке: флаг подозрительности к
        # этому моменту проставлен, и флагнутый забег прогресса не даёт.
        quests_done = lodge.apply_run(cfg, conn, user["id"], run_after, summary)
        conn.commit()
    finally:
        conn.close()

    if relics:
        db.add_relics(user["id"], relics)
    for aid in fresh:
        db.add_achievement(user["id"], aid)

    out = {"relics_gained": relics, "unlocks": [], "achievements": fresh,
           "quests_done": quests_done}
    if reasons:
        out["flagged"] = reasons
    return jsonify(out)


@app.route("/api/meta/unlock", methods=["POST"])
@login_required
def api_meta_unlock():
    """Покупка открытия. Баланс и цена проверяются ТОЛЬКО здесь: клиент лишь
    отображает то, что ему разрешил сервер."""
    user = current_user()
    if user is None:
        session.clear()
        return jsonify({"error": "auth_required"}), 401

    data = request.get_json(silent=True) or {}
    kind = data.get("kind")
    item_id = data.get("id")
    if kind not in ("faction", "character", "weapon", "arena", "upgrade"):
        return jsonify({"error": "bad_kind"}), 400
    if not item_id:
        return jsonify({"error": "bad_id"}), 400

    cfg = get_config()
    uid = user["id"]

    if kind == "upgrade":
        ranks = db.get_user_upgrades(uid)
        rank = ranks.get(item_id, 0)
        price, up = meta.upgrade_price(cfg, item_id, rank)
        if up is None:
            return jsonify({"error": "bad_id"}), 400
        if price is None:
            return jsonify({"error": "max_rank"}), 409
        if not db.spend_relics(uid, price):
            return jsonify({"error": "not_enough_relics"}), 402
        db.set_upgrade_rank(uid, item_id, rank + 1)
        return jsonify({"ok": True, "kind": kind, "id": item_id,
                        "rank": rank + 1, "spent": price,
                        "relics": user["relics"] - price})

    if db.has_unlock(uid, kind, item_id):
        return jsonify({"error": "already_owned"}), 409

    earned = {a["id"] for a in db.get_user_achievements(uid)}
    price, need_ach = meta.unlock_price(cfg, kind, item_id, lambda a: a in earned)
    if price is None:
        return jsonify({"error": "not_unlockable"}), 400

    unlocks = db.get_user_unlocks(uid)
    if not meta.requirements_met(cfg, kind, item_id, unlocks):
        return jsonify({"error": "faction_locked"}), 409

    if not db.spend_relics(uid, price):
        return jsonify({"error": "not_enough_relics"}), 402
    db.add_unlock(uid, kind, item_id)
    return jsonify({"ok": True, "kind": kind, "id": item_id, "spent": price,
                    "relics": user["relics"] - price})


@app.route("/api/lodge/talk", methods=["POST"])
@login_required
def api_lodge_talk():
    """Разговор с персонажем: открывает вступительный фрагмент и гасит бейджи.

    Открытый фрагмент помечается прочитанным ровно здесь — «поговорил» и есть
    «прочитал». Отдельной кнопки «отметить прочитанным» в UI нет и не нужно.
    """
    user = current_user()
    if user is None:
        session.clear()
        return jsonify({"error": "auth_required"}), 401

    data = request.get_json(silent=True) or {}
    npc_id = data.get("npc_id")
    cfg = get_config()
    npc = next((n for n in lodge.npcs(cfg) if n["id"] == npc_id), None)
    if npc is None:
        return jsonify({"error": "unknown_npc"}), 400

    user_quests = db.get_user_quests(user["id"])
    if not lodge.npc_open(cfg, user_quests, npc):
        return jsonify({"error": "quest_not_available"}), 409

    intro = lodge.intro_lore(cfg, user["id"], npc_id)
    mine = [lid for lid, l in lodge.lore(cfg).items() if l.get("npc") == npc_id]
    db.mark_lore_seen(user["id"], mine)
    return jsonify({"ok": True, "lore": intro})


@app.route("/api/lodge/take", methods=["POST"])
@login_required
def api_lodge_take():
    user = current_user()
    if user is None:
        session.clear()
        return jsonify({"error": "auth_required"}), 401

    data = request.get_json(silent=True) or {}
    quest_id = data.get("quest_id")
    cfg = get_config()
    if quest_id not in lodge.quests(cfg):
        return jsonify({"error": "unknown_quest"}), 400

    user_quests = db.get_user_quests(user["id"])
    if quest_id in user_quests:
        return jsonify({"error": "quest_taken"}), 409
    if not lodge.quest_available(cfg, user_quests, quest_id):
        return jsonify({"error": "quest_not_available"}), 409
    if not db.take_quest(user["id"], quest_id):
        return jsonify({"error": "quest_taken"}), 409
    return jsonify({"ok": True, "quest_id": quest_id})


@app.route("/api/lodge/claim", methods=["POST"])
@login_required
def api_lodge_claim():
    """Сдача заказа. Реликвии начисляет сервер по числу из конфига (CLAUDE.md §3.8)."""
    user = current_user()
    if user is None:
        session.clear()
        return jsonify({"error": "auth_required"}), 401

    data = request.get_json(silent=True) or {}
    quest_id = data.get("quest_id")
    cfg = get_config()

    relics, lore_id, err = lodge.claim(cfg, user["id"], quest_id)
    if err:
        code = 400 if err == "unknown_quest" else 409
        return jsonify({"error": err}), code
    return jsonify({"ok": True, "quest_id": quest_id, "relics": relics,
                    "lore": lore_id})


@app.route("/api/board")
@login_required
def api_board():
    mode = request.args.get("mode", "solo")
    danger = request.args.get("danger", "")
    character = request.args.get("character", "")

    conditions = ["r.flagged = 0", "r.finished_at IS NOT NULL"]
    params = []

    if mode == "solo":
        conditions.append("r.players = 1")
    elif mode == "coop":
        conditions.append("r.players > 1")

    if danger != "":
        conditions.append("r.danger = ?")
        params.append(int(danger))
    if character != "":
        conditions.append("r.character = ?")
        params.append(character)

    where = " AND ".join(conditions)
    query = (
        f"SELECT u.name, r.character, r.danger, r.wave, r.score, r.finished_at "
        f"FROM runs r JOIN users u ON r.user_id = u.id "
        f"WHERE {where} "
        f"ORDER BY r.score DESC LIMIT 20"
    )

    conn = db.get_db()
    try:
        rows = conn.execute(query, params).fetchall()
        return jsonify(
            [
                {
                    "name": row["name"],
                    "character": row["character"],
                    "danger": row["danger"],
                    "wave": row["wave"],
                    "score": row["score"],
                    "finished_at": row["finished_at"],
                }
                for row in rows
            ]
        )
    finally:
        conn.close()


# --- Комнаты: сервер только релеит, симуляции здесь нет -------------------

rooms = Rooms(get_config)


def _sid():
    return request.sid


def _broadcast(room, event="room"):
    """Разослать состояние комнаты всем её участникам."""
    socketio.emit("room:state", {"event": event, "room": room.public()}, room=room.code)


@socketio.on("connect")
def on_connect():
    if "user_id" not in session:
        return False
    user = current_user()
    if user is None:
        return False
    rooms.rejoin(_sid())


@socketio.on("disconnect")
def on_disconnect():
    # Отвал: держим место reconnect_grace_sec, уборщик добьёт (ТЗ §2)
    room = rooms.mark_gone(_sid())
    if room is not None:
        _broadcast(room, "player_gone")


def _me():
    user = current_user()
    return user["name"] if user else None, session.get("user_id")


@socketio.on("room:create")
def on_room_create(data):
    name, uid = _me()
    if name is None:
        return {"error": "auth_required"}
    room = rooms.create(_sid(), name, uid, (data or {}).get("character"))
    join_room(room.code)
    _broadcast(room, "created")
    return {"ok": True, "room": room.public(), "you": room.index_of(_sid())}


@socketio.on("room:join")
def on_room_join(data):
    name, uid = _me()
    if name is None:
        return {"error": "auth_required"}
    code = (data or {}).get("code", "")
    room, err = rooms.join(_sid(), code, name, uid, (data or {}).get("character"))
    if err:
        return {"error": err}
    join_room(room.code)
    _broadcast(room, "joined")
    return {"ok": True, "room": room.public(), "you": room.index_of(_sid())}


@socketio.on("room:leave")
def on_room_leave(_data=None):
    room, _was_host = rooms.leave(_sid())
    if room is not None:
        leave_room(room.code)
        _broadcast(room, "left")
    return {"ok": True}


@socketio.on("room:ready")
def on_room_ready(data):
    room = rooms.set_ready(_sid(), (data or {}).get("ready", True))
    if room is None:
        return {"error": "no_room"}
    _broadcast(room, "ready")
    return {"ok": True}


@socketio.on("room:character")
def on_room_character(data):
    room = rooms.set_character(_sid(), (data or {}).get("character"))
    if room is None:
        return {"error": "no_room"}
    _broadcast(room, "character")
    return {"ok": True}


@socketio.on("room:setup")
def on_room_setup(data):
    d = data or {}
    room = rooms.set_setup(_sid(), d.get("arena"), d.get("danger"), d.get("curses"))
    if room is None:
        return {"error": "not_host"}
    _broadcast(room, "setup")
    return {"ok": True}


@socketio.on("room:start")
def on_room_start(_data=None):
    """Старт забега. Сид выдаёт сервер — как и в соло, клиент его не выбирает."""
    user = current_user()
    if user is None:
        return {"error": "auth_required"}
    room = rooms.of(_sid())
    if room is None:
        return {"error": "no_room"}
    if room.host_sid != _sid():
        return {"error": "not_host"}

    run_id = secrets.token_urlsafe(12)
    seed = secrets.randbits(32)
    db.start_run(user_id=user["id"], run_id=run_id, seed=seed,
                 character=room.players[_sid()].get("character"),
                 arena=room.arena, danger=room.danger, room=room.code,
                 players=len(room.players),
                 curses=json.dumps(list(room.curses or [])))
    room, err = rooms.start(_sid(), seed, run_id)
    if err:
        return {"error": err}
    socketio.emit("room:start", {"seed": seed, "run_id": run_id,
                                 "room": room.public()}, room=room.code)
    return {"ok": True, "seed": seed, "run_id": run_id}


@socketio.on("room:restart")
def on_room_restart(_data=None):
    """Перезапуск забега в той же комнате (хост)."""
    user = current_user()
    if user is None:
        return {"error": "auth_required"}
    room = rooms.of(_sid())
    if room is None:
        return {"error": "no_room"}
    if room.host_sid != _sid():
        return {"error": "not_host"}

    run_id = secrets.token_urlsafe(12)
    seed = secrets.randbits(32)
    db.start_run(user_id=user["id"], run_id=run_id, seed=seed,
                 character=room.players[_sid()].get("character"),
                 arena=room.arena, danger=room.danger, room=room.code,
                 players=len(room.players),
                 curses=json.dumps(list(room.curses or [])))
    room, err = rooms.restart(_sid(), seed, run_id)
    if err:
        return {"error": err}
    socketio.emit("room:start", {"seed": seed, "run_id": run_id,
                                 "room": room.public(), "restart": True},
                  room=room.code)
    return {"ok": True, "seed": seed, "run_id": run_id}


# --- Релей игрового трафика ----------------------------------------------
# Сервер не разбирает содержимое: он пересылает байты внутри комнаты.

@socketio.on("net:input")
def on_net_input(payload):
    room = rooms.of(_sid())
    if room is None or room.host_sid is None:
        return
    # Ввод идёт адресно хосту, а не всей комнате
    socketio.emit("net:input", payload, to=room.host_sid)


@socketio.on("net:snapshot")
def on_net_snapshot(payload):
    room = rooms.of(_sid())
    if room is None or room.host_sid != _sid():
        return          # снапшоты шлёт только хост
    rooms.touch(_sid())
    # Адресный снапшот: {"to": индекс игрока, "b": байты}. Сервер по-прежнему не
    # разбирает содержимое — читает только конверт, чтобы найти получателя.
    if isinstance(payload, dict) and "to" in payload:
        target = room.sid_at(payload.get("to"))
        if target is None or target == room.host_sid:
            return      # хост себе снапшоты не шлёт, а мёртвый индекс — не адрес
        socketio.emit("net:snapshot", payload.get("b"), to=target)
        return
    socketio.emit("net:snapshot", payload, room=room.code, include_self=False)


@socketio.on("net:event")
def on_net_event(payload):
    room = rooms.of(_sid())
    if room is None:
        return
    rooms.touch(_sid())
    if room.host_sid == _sid():
        socketio.emit("net:event", payload, room=room.code, include_self=False)
    else:
        socketio.emit("net:event", payload, to=room.host_sid)


@socketio.on("net:ping")
def on_net_ping(data):
    d = data or {}
    if "ping" in d:
        rooms.set_ping(_sid(), d["ping"])
    return {"t": d.get("t")}


def _sweeper():
    """Периодическая уборка протухших комнат. Это не игровой цикл — раз в 5 с."""
    while True:
        socketio.sleep(5)
        try:
            for room, event in rooms.sweep():
                if room.players:
                    _broadcast(room, event)
        except Exception:
            pass


socketio.start_background_task(_sweeper)


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=8150, allow_unsafe_werkzeug=True)
