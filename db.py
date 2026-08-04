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

            -- Заказы Ловчего Дома. state: active | done | claimed.
            -- Строка появляется в момент, когда игрок берёт заказ у персонажа:
            -- прогресс считается только с этого момента, задним числом история
            -- забегов не зачитывается (иначе «убей 50 крыс» закрывался бы в
            -- ту же секунду и разговор терял смысл).
            CREATE TABLE IF NOT EXISTS quests (
                user_id INTEGER,
                quest_id TEXT,
                state TEXT NOT NULL DEFAULT 'active',
                progress INTEGER NOT NULL DEFAULT 0,
                taken_at REAL,
                done_at REAL,
                claimed_at REAL,
                PRIMARY KEY (user_id, quest_id)
            );

            -- Открытые фрагменты лора. seen гасит бейдж «новое» на здании.
            CREATE TABLE IF NOT EXISTS lore (
                user_id INTEGER,
                lore_id TEXT,
                at REAL,
                seen INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, lore_id)
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
                curses TEXT DEFAULT '[]',
                wave INTEGER DEFAULT 0,
                win INTEGER DEFAULT 0,
                bosses INTEGER DEFAULT 0,
                time_sec REAL DEFAULT 0,
                kills INTEGER DEFAULT 0,
                score INTEGER DEFAULT 0,
                relics INTEGER DEFAULT 0,
                damage_taken INTEGER DEFAULT 0,
                ash_gained INTEGER DEFAULT 0,
                shop_buys INTEGER DEFAULT 0,
                flagged INTEGER DEFAULT 0,
                started_at REAL NOT NULL,
                finished_at REAL
            );

            CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id);
            CREATE INDEX IF NOT EXISTS idx_runs_score ON runs(score DESC);
            CREATE INDEX IF NOT EXISTS idx_runs_finished ON runs(finished_at);
            """
        )
        _migrate_runs(conn)
        conn.commit()
    finally:
        conn.close()


def _migrate_runs(conn):
    """Добавить колонки в существующие БД без потери данных."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(runs)").fetchall()}
    for name, decl in (
        ("curses", "TEXT DEFAULT '[]'"),
        ("damage_taken", "INTEGER DEFAULT 0"),
        ("ash_gained", "INTEGER DEFAULT 0"),
        ("shop_buys", "INTEGER DEFAULT 0"),
        # Убийства по типам врагов, JSON {enemy_id: count}. Нужны заказам вида
        # «убить 50 ульевых крыс»: суммарный kills на такое не отвечает.
        ("kills_by_type", "TEXT DEFAULT '{}'"),
    ):
        if name not in cols:
            conn.execute(f"ALTER TABLE runs ADD COLUMN {name} {decl}")


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
    curses: str | None = None,
) -> dict:
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO runs (run_id, user_id, seed, room, players, character, arena, danger, "
            "curses, started_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (run_id, user_id, seed, room, players, character, arena, danger,
             curses if curses is not None else "[]", time.time()),
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
    damage_taken: int = 0,
    ash_gained: int = 0,
    shop_buys: int = 0,
    kills_by_type: str = "{}",
):
    conn = get_db()
    try:
        conn.execute(
            "UPDATE runs SET wave = ?, win = ?, bosses = ?, time_sec = ?, kills = ?, "
            "score = ?, relics = ?, damage_taken = ?, ash_gained = ?, shop_buys = ?, "
            "kills_by_type = ?, finished_at = ? WHERE run_id = ?",
            (wave, win, bosses, time_sec, kills, score, relics_gained,
             damage_taken, ash_gained, shop_buys, kills_by_type, time.time(), run_id),
        )
        conn.commit()
    finally:
        conn.close()


def flag_run(run_id: str, reasons: str):
    """Пометить подозрительный забег: в лидерборд он не попадёт (ТЗ §2)."""
    conn = get_db()
    try:
        conn.execute("UPDATE runs SET flagged = 1 WHERE run_id = ?", (run_id,))
        conn.commit()
    finally:
        conn.close()


def add_unlock(user_id: int, kind: str, item_id: str) -> bool:
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT OR IGNORE INTO unlocks (user_id, kind, item_id, at) VALUES (?, ?, ?, ?)",
            (user_id, kind, item_id, time.time()),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def has_unlock(user_id: int, kind: str, item_id: str) -> bool:
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT 1 FROM unlocks WHERE user_id = ? AND kind = ? AND item_id = ?",
            (user_id, kind, item_id),
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def set_upgrade_rank(user_id: int, upgrade_id: str, rank: int):
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO upgrades (user_id, upgrade_id, rank) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id, upgrade_id) DO UPDATE SET rank = excluded.rank",
            (user_id, upgrade_id, rank),
        )
        conn.commit()
    finally:
        conn.close()


def add_achievement(user_id: int, ach_id: str) -> bool:
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT OR IGNORE INTO achievements (user_id, ach_id, at) VALUES (?, ?, ?)",
            (user_id, ach_id, time.time()),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def spend_relics(user_id: int, amount: int) -> bool:
    """Атомарное списание: условие в самом UPDATE, чтобы два запроса подряд
    не увели баланс в минус."""
    conn = get_db()
    try:
        cur = conn.execute(
            "UPDATE users SET relics = relics - ? WHERE id = ? AND relics >= ?",
            (amount, user_id, amount),
        )
        conn.commit()
        return cur.rowcount > 0
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


# --- Ловчий Дом: заказы и лор ---------------------------------------------

def get_user_quests(user_id: int) -> dict:
    """{quest_id: {state, progress}} — всё, что игрок когда-либо брал."""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT quest_id, state, progress FROM quests WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        return {r["quest_id"]: {"state": r["state"], "progress": r["progress"]}
                for r in rows}
    finally:
        conn.close()


def take_quest(user_id: int, quest_id: str) -> bool:
    """Взять заказ. False, если он уже брался — повторный приём обнулил бы прогресс."""
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT OR IGNORE INTO quests (user_id, quest_id, state, progress, taken_at) "
            "VALUES (?, ?, 'active', 0, ?)",
            (user_id, quest_id, time.time()),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def set_quest_progress(conn, user_id: int, quest_id: str, progress: int, done: bool):
    """Обновить прогресс активного заказа. Работает на переданном соединении:
    зовётся пачкой внутри одной транзакции завершения забега."""
    if done:
        conn.execute(
            "UPDATE quests SET progress = ?, state = 'done', done_at = ? "
            "WHERE user_id = ? AND quest_id = ? AND state = 'active'",
            (progress, time.time(), user_id, quest_id),
        )
    else:
        conn.execute(
            "UPDATE quests SET progress = ? "
            "WHERE user_id = ? AND quest_id = ? AND state = 'active'",
            (progress, user_id, quest_id),
        )


def claim_quest(user_id: int, quest_id: str) -> bool:
    """Пометить заказ сданным. Условие state='done' прямо в UPDATE: два запроса
    подряд не выдадут награду дважды."""
    conn = get_db()
    try:
        cur = conn.execute(
            "UPDATE quests SET state = 'claimed', claimed_at = ? "
            "WHERE user_id = ? AND quest_id = ? AND state = 'done'",
            (time.time(), user_id, quest_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def get_user_lore(user_id: int) -> dict:
    """{lore_id: seen} — открытые фрагменты и признак «прочитан»."""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT lore_id, seen FROM lore WHERE user_id = ?", (user_id,)
        ).fetchall()
        return {r["lore_id"]: int(r["seen"]) for r in rows}
    finally:
        conn.close()


def add_lore(user_id: int, lore_id: str) -> bool:
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT OR IGNORE INTO lore (user_id, lore_id, at, seen) VALUES (?, ?, ?, 0)",
            (user_id, lore_id, time.time()),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def mark_lore_seen(user_id: int, lore_ids):
    conn = get_db()
    try:
        conn.executemany(
            "UPDATE lore SET seen = 1 WHERE user_id = ? AND lore_id = ?",
            [(user_id, lid) for lid in lore_ids],
        )
        conn.commit()
    finally:
        conn.close()


# Инициализируем схему при импорте модуля.
init_db()
