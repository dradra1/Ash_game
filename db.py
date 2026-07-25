import os
import sqlite3
import time

DATA_DIR = os.environ.get("ASH_DATA", "data")
DB_PATH = os.path.join(DATA_DIR, "users.db")


def _ensure_dir():
    os.makedirs(DATA_DIR, exist_ok=True)


def get_db() -> sqlite3.Connection:
    _ensure_dir()
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    _ensure_dir()
    conn = get_db()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                pw_hash TEXT NOT NULL,
                relics INTEGER NOT NULL DEFAULT 0,
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS unlocks (
                user_id INTEGER,
                kind TEXT,
                item_id TEXT,
                at REAL,
                PRIMARY KEY (user_id, kind, item_id)
            );

            CREATE TABLE IF NOT EXISTS upgrades (
                user_id INTEGER,
                upgrade_id TEXT,
                rank INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, upgrade_id)
            );

            CREATE TABLE IF NOT EXISTS achievements (
                user_id INTEGER,
                ach_id TEXT,
                at REAL,
                PRIMARY KEY (user_id, ach_id)
            );

            CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY,
                run_id TEXT UNIQUE NOT NULL,
                user_id INTEGER NOT NULL,
                seed INTEGER NOT NULL,
                room TEXT,
                players INTEGER NOT NULL DEFAULT 1,
                character TEXT,
                arena TEXT,
                danger INTEGER,
                wave INTEGER DEFAULT 0,
                win INTEGER DEFAULT 0,
                bosses INTEGER DEFAULT 0,
                time_sec REAL DEFAULT 0,
                kills INTEGER DEFAULT 0,
                score INTEGER DEFAULT 0,
                relics INTEGER DEFAULT 0,
                flagged INTEGER DEFAULT 0,
                started_at REAL NOT NULL,
                finished_at REAL
            );

            CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id);
            CREATE INDEX IF NOT EXISTS idx_runs_score ON runs(score DESC);
            CREATE INDEX IF NOT EXISTS idx_runs_finished ON runs(finished_at);
            """
        )
        conn.commit()
    finally:
        conn.close()


def get_user_by_name(name: str) -> sqlite3.Row | None:
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM users WHERE name = ?", (name,)).fetchone()
        return row
    finally:
        conn.close()


def create_user(name: str, pw_hash: str) -> int:
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT INTO users (name, pw_hash, created_at) VALUES (?, ?, ?)",
            (name, pw_hash, time.time()),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def get_user_unlocks(user_id: int) -> dict:
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT kind, item_id FROM unlocks WHERE user_id = ?", (user_id,)
        ).fetchall()
        result = {"faction": [], "character": [], "weapon": [], "arena": []}
        for row in rows:
            result.setdefault(row["kind"], []).append(row["item_id"])
        return result
    finally:
        conn.close()


def get_user_upgrades(user_id: int) -> dict:
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT upgrade_id, rank FROM upgrades WHERE user_id = ?", (user_id,)
        ).fetchall()
        return {row["upgrade_id"]: row["rank"] for row in rows}
    finally:
        conn.close()


def get_user_achievements(user_id: int) -> list:
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT ach_id, at FROM achievements WHERE user_id = ?", (user_id,)
        ).fetchall()
        return [{"id": row["ach_id"], "at": row["at"]} for row in rows]
    finally:
        conn.close()


def get_user_best(user_id: int) -> dict:
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT MAX(wave) as wave, MAX(score) as score FROM runs "
            "WHERE user_id = ? AND flagged = 0",
            (user_id,),
        ).fetchone()
        return {"wave": row["wave"] or 0, "score": row["score"] or 0}
    finally:
        conn.close()


def start_run(
    user_id: int,
    run_id: str,
    seed: int,
    character: str,
    arena: str,
    danger: int,
    room: str | None,
    players: int = 1,
) -> dict:
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO runs (run_id, user_id, seed, room, players, character, arena, danger, started_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (run_id, user_id, seed, room, players, character, arena, danger, time.time()),
        )
        conn.commit()
        return {"run_id": run_id, "seed": seed}
    finally:
        conn.close()


def get_run(run_id: str) -> sqlite3.Row | None:
    conn = get_db()
    try:
        return conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    finally:
        conn.close()


def finish_run(
    run_id: str,
    wave: int,
    win: int,
    bosses: int,
    time_sec: float,
    kills: int,
    score: int,
    relics_gained: int,
):
    conn = get_db()
    try:
        conn.execute(
            "UPDATE runs SET wave = ?, win = ?, bosses = ?, time_sec = ?, kills = ?, "
            "score = ?, relics = ?, finished_at = ? WHERE run_id = ?",
            (wave, win, bosses, time_sec, kills, score, relics_gained, time.time(), run_id),
        )
        conn.commit()
    finally:
        conn.close()


def add_relics(user_id: int, amount: int):
    conn = get_db()
    try:
        conn.execute(
            "UPDATE users SET relics = relics + ? WHERE id = ?", (amount, user_id)
        )
        conn.commit()
    finally:
        conn.close()


# Инициализируем схему при импорте модуля.
init_db()
