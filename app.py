import json
import os
import re
import secrets
import time
from functools import wraps
from pathlib import Path

from flask import (
    Flask,
    Response,
    jsonify,
    redirect,
    render_template,
    request,
    session,
)
from flask_socketio import SocketIO, join_room, leave_room
from werkzeug.security import check_password_hash, generate_password_hash

import db
from rooms import Rooms

APP_ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("ASH_DATA", "data"))
REPO_CONFIG = APP_ROOT / "config" / "game_config.json"
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


def _copy_config_if_needed():
    _ensure_data_dir()
    if not LIVE_CONFIG.exists() and REPO_CONFIG.exists():
        LIVE_CONFIG.write_bytes(REPO_CONFIG.read_bytes())


def load_config() -> dict:
    global _loaded_config
    _copy_config_if_needed()
    _loaded_config = json.loads(LIVE_CONFIG.read_text(encoding="utf-8"))
    return _loaded_config


def reload_config() -> dict:
    return load_config()


def get_config() -> dict:
    return _loaded_config


load_config()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "auth_required"}), 401
        return view(*args, **kwargs)

    return wrapped


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
    return render_template("index.html", boot={"name": user["name"]})


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
    cfg = get_config()
    etag = f'"v{cfg.get("content_version", 0)}"'
    if request.headers.get("If-None-Match") == etag:
        return Response(status=304)
    return Response(
        json.dumps(cfg, ensure_ascii=False),
        mimetype="application/json",
        headers={"ETag": etag},
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
        }
    )


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
        )
    )


def award_relics(run: db.sqlite3.Row) -> int:
    # M6: формула начисления реликвий будет реализована позже.
    return 0


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

    wave = int(data.get("wave", 0))
    win = 1 if data.get("win") else 0
    bosses = int(data.get("bosses", 0))
    time_sec = float(data.get("time_sec", 0))
    kills = int(data.get("kills", 0))
    score = int(data.get("score", 0))

    relics_gained = award_relics(run)
    db.finish_run(run_id, wave, win, bosses, time_sec, kills, score, relics_gained)
    if relics_gained:
        db.add_relics(user["id"], relics_gained)

    return jsonify({"relics_gained": relics_gained, "unlocks": [], "achievements": []})


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
    room = rooms.set_setup(_sid(), d.get("arena"), d.get("danger"))
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
                 players=len(room.players))
    room, err = rooms.start(_sid(), seed, run_id)
    if err:
        return {"error": err}
    socketio.emit("room:start", {"seed": seed, "run_id": run_id,
                                 "room": room.public()}, room=room.code)
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
