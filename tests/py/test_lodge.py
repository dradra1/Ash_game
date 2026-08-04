"""Ловчий Дом: цепочки заказов, прогресс по итогам забега, сдача.

Два уровня. Чистые функции lodge.py гоняются напрямую с поддельной строкой
забега — там проверяются метрики и фильтры целей. Сквозной путь (взять →
играть → сдать) идёт через HTTP, потому что именно там живут проверки прав,
атомарность сдачи и запись в БД.
"""
import json
import os
import pathlib
import shutil

import pytest


def _seed_copy(tmp_path):
    src = pathlib.Path(__file__).resolve().parents[2] / "config" / "game_config.json"
    dst = tmp_path / "seed_game_config.json"
    shutil.copyfile(src, dst)
    return dst


@pytest.fixture
def client(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    monkeypatch.setenv("ASH_DATA", str(data_dir))
    monkeypatch.setenv("ASH_REPO_CONFIG", str(_seed_copy(tmp_path)))
    for mod in ["app", "db", "lodge"]:
        if mod in os.sys.modules:
            del os.sys.modules[mod]
    import app

    with app.app.test_client() as c:
        c.post("/api/register", json={"name": "Ловчий", "password": "secret"})
        yield c, app


# --- вспомогательное --------------------------------------------------------

def _finish(c, app, wave=1, danger=0, curses=None, arena="ar_hive", **body):
    """Провести забег целиком. Возвращает тело ответа /api/run/finish.

    started_at отодвигается назад намеренно: честный забег до волны 10 длится
    минут семь игрового времени, а тест живёт миллисекунды — без сдвига любой
    осмысленный забег ловит faster_than_wall_clock и помечается флагом, после
    чего прогресса не даёт вовсе. Проверять на этом фоне логику заказов
    невозможно, а сама проверка стены отдельно протестирована в test_meta.
    """
    import db
    import meta

    start = c.post("/api/run/start", json={
        "character": "ch_pilgrim", "arena": arena, "danger": danger,
        "curses": curses or [],
    })
    run_id = start.get_json()["run_id"]

    conn = db.get_db()
    conn.execute("UPDATE runs SET started_at = started_at - 100000 WHERE run_id = ?",
                 (run_id,))
    conn.commit()
    conn.close()

    cfg = app.get_config()
    payload = {
        "run_id": run_id,
        "wave": wave,
        "time_sec": meta.min_run_time(cfg, wave) + 10,
    }
    payload.update(body)
    return c.post("/api/run/finish", json=payload).get_json()


def _quests(c):
    return c.get("/api/profile").get_json()["quests"]


def _relics(c):
    return c.get("/api/profile").get_json()["relics"]


def _unlock_tracker(c, app):
    """Пройти вводный заказ Магистра — без него Загонщик закрыт."""
    assert c.post("/api/lodge/take", json={"quest_id": "q_master_1"}).status_code == 200
    _finish(c, app, wave=5)
    assert c.post("/api/lodge/claim", json={"quest_id": "q_master_1"}).status_code == 200


# --- контент ----------------------------------------------------------------

def test_content_matches_config(client):
    """Цели заказов ссылаются на существующих врагов, арены и проклятия."""
    import sys
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "tools"))
    import content_lodge

    c, app = client
    assert content_lodge.validate(app.get_config()) is True


# --- чистые функции ---------------------------------------------------------

class FakeRun(dict):
    """Строка забега: sqlite3.Row умеет .keys(), словарь тоже."""

    def keys(self):
        return list(super().keys())


def _row(**over):
    row = FakeRun({
        "danger": 0, "arena": "ar_hive", "character": "ch_pilgrim",
        "players": 1, "curses": "[]", "flagged": 0,
    })
    row.update(over)
    return row


def test_filter_danger_and_arena():
    import lodge

    summary = {"win": 1}
    assert lodge.filter_ok(_row(danger=4), summary, {"danger_min": 4}) is True
    assert lodge.filter_ok(_row(danger=3), summary, {"danger_min": 4}) is False
    assert lodge.filter_ok(_row(arena="ar_tomb"), summary, {"arena": "ar_tomb"}) is True
    assert lodge.filter_ok(_row(arena="ar_hive"), summary, {"arena": "ar_tomb"}) is False
    # Пустой фильтр пропускает всё
    assert lodge.filter_ok(_row(), summary, None) is True


def test_filter_curses():
    import lodge

    row = _row(curses=json.dumps(["cu_glass_vow", "cu_swarm"]))
    assert lodge.filter_ok(row, {"win": 1}, {"curse": "cu_glass_vow"}) is True
    assert lodge.filter_ok(row, {"win": 1}, {"curse": "cu_iron_tithe"}) is False
    assert lodge.filter_ok(row, {"win": 1}, {"curse_min": 2}) is True
    assert lodge.filter_ok(_row(), {"win": 1}, {"curse_min": 1}) is False


def test_filter_damage_taken_max():
    import lodge

    goal = {"damage_taken_max": 0}
    assert lodge.filter_ok(_row(), {"damage_taken": 0}, goal) is True
    assert lodge.filter_ok(_row(), {"damage_taken": 1}, goal) is False


def test_run_scope_is_all_or_nothing():
    """scope run: копить по кускам нечего — либо забег дотянул, либо нет."""
    import lodge

    goal = {"metric": "ash", "scope": "run", "value": 2000}
    assert lodge.run_delta(goal, _row(), {"ash_gained": 1999}) == 0
    assert lodge.run_delta(goal, _row(), {"ash_gained": 2000}) == 2000
    # Перебор не даёт больше цели: прогресс всё равно зажат сверху
    assert lodge.run_delta(goal, _row(), {"ash_gained": 9999}) == 2000


def test_total_scope_accumulates():
    import lodge

    goal = {"metric": "kills_type", "scope": "total", "value": 50,
            "target": "e_hiverat"}
    summary = {"kills_by_type": {"e_hiverat": 12, "e_cultist": 40}}
    assert lodge.run_delta(goal, _row(), summary) == 12
    # Чужой тип в тот же словарь вклада не даёт
    assert lodge.run_delta(goal, _row(), {"kills_by_type": {"e_cultist": 99}}) == 0


def test_sanitize_kills_by_type(client):
    import lodge

    c, app = client
    cfg = app.get_config()
    clean, reason = lodge.sanitize_kills_by_type(
        cfg, {"e_hiverat": 10, "b_butcher": 1, "e_нет_такого": 5, "e_cultist": -3}, 100)
    assert clean == {"e_hiverat": 10, "b_butcher": 1}
    assert reason is None

    # Сумма выше потолка убийств — забег подозрительный
    _, reason = lodge.sanitize_kills_by_type(cfg, {"e_hiverat": 500}, 100)
    assert reason == "kills_by_type_mismatch"

    assert lodge.sanitize_kills_by_type(cfg, "не словарь", 100) == ({}, None)


# --- цепочки ----------------------------------------------------------------

def test_take_respects_chain(client):
    c, app = client
    # Второй заказ Магистра закрыт, пока не сдан первый
    r = c.post("/api/lodge/take", json={"quest_id": "q_master_2"})
    assert r.status_code == 409
    assert r.get_json()["error"] == "quest_not_available"

    # Заказ Загонщика закрыт вместе с самим Загонщиком
    r = c.post("/api/lodge/take", json={"quest_id": "q_tracker_1"})
    assert r.status_code == 409

    r = c.post("/api/lodge/take", json={"quest_id": "q_master_1"})
    assert r.status_code == 200
    # Повторный приём не обнуляет прогресс
    assert c.post("/api/lodge/take", json={"quest_id": "q_master_1"}).status_code == 409


def test_unknown_quest(client):
    c, _ = client
    assert c.post("/api/lodge/take", json={"quest_id": "нет"}).status_code == 400
    assert c.post("/api/lodge/claim", json={"quest_id": "нет"}).status_code == 400


def test_talk_locked_npc(client):
    c, _ = client
    assert c.post("/api/lodge/talk", json={"npc_id": "np_master"}).status_code == 200
    r = c.post("/api/lodge/talk", json={"npc_id": "np_guest"})
    assert r.status_code == 409
    assert c.post("/api/lodge/talk", json={"npc_id": "нет"}).status_code == 400


def test_talk_opens_intro_lore_and_marks_seen(client):
    c, _ = client
    assert c.get("/api/profile").get_json()["lore"] == {}
    r = c.post("/api/lodge/talk", json={"npc_id": "np_master"})
    assert r.get_json()["lore"] == "l_master_0"
    # Разговор он же прочтение: бейдж «новое» гаснет сразу
    assert c.get("/api/profile").get_json()["lore"] == {"l_master_0": 1}


# --- прогресс ---------------------------------------------------------------

def test_untaken_quest_gets_no_progress(client):
    c, app = client
    _finish(c, app, wave=5)
    assert _quests(c) == {}


def test_run_goal_completes_and_claim_pays_once(client):
    c, app = client
    c.post("/api/lodge/take", json={"quest_id": "q_master_1"})

    # Волна 4 — недобор, заказ остаётся в работе
    _finish(c, app, wave=4)
    assert _quests(c)["q_master_1"]["state"] == "active"

    _finish(c, app, wave=5)
    assert _quests(c)["q_master_1"] == {"state": "done", "progress": 5}

    before = _relics(c)
    reward = app.get_config()["lodge"]["quests"]["q_master_1"]["reward"]
    r = c.post("/api/lodge/claim", json={"quest_id": "q_master_1"})
    assert r.status_code == 200
    assert r.get_json()["relics"] == reward
    assert _relics(c) == before + reward
    # Фрагмент лора открылся сдачей
    assert "l_master_1" in c.get("/api/profile").get_json()["lore"]

    # Повторная сдача не платит второй раз
    again = c.post("/api/lodge/claim", json={"quest_id": "q_master_1"})
    assert again.status_code == 409
    assert again.get_json()["error"] == "quest_claimed"
    assert _relics(c) == before + reward


def test_claim_before_done(client):
    c, _ = client
    c.post("/api/lodge/take", json={"quest_id": "q_master_1"})
    r = c.post("/api/lodge/claim", json={"quest_id": "q_master_1"})
    assert r.status_code == 409
    assert r.get_json()["error"] == "quest_not_done"


def test_kills_by_type_accumulates_across_runs(client):
    c, app = client
    _unlock_tracker(c, app)
    c.post("/api/lodge/take", json={"quest_id": "q_tracker_1"})

    _finish(c, app, wave=3, kills=30, kills_by_type={"e_hiverat": 30})
    assert _quests(c)["q_tracker_1"] == {"state": "active", "progress": 30}

    # Второй забег добирает остаток; прогресс зажат целью, а не 60
    out = _finish(c, app, wave=3, kills=30, kills_by_type={"e_hiverat": 30})
    assert _quests(c)["q_tracker_1"] == {"state": "done", "progress": 50}
    assert "q_tracker_1" in out["quests_done"]


def test_danger_filter_gates_progress(client):
    c, app = client
    _unlock_tracker(c, app)
    # Открываем цепочку Загонщика до последнего заказа — «крысы на Анафеме»
    for qid, kills in (("q_tracker_1", {"e_hiverat": 50}),
                       ("q_tracker_2", {"e_ashhound": 30}),
                       ("q_tracker_3", {"e_hatcher": 10})):
        c.post("/api/lodge/take", json={"quest_id": qid})
        _finish(c, app, wave=3, danger=4, kills=90, kills_by_type=kills)
        assert c.post("/api/lodge/claim", json={"quest_id": qid}).status_code == 200

    c.post("/api/lodge/take", json={"quest_id": "q_tracker_4"})
    # Мученик — не Анафема: фильтр danger_min не пускает
    _finish(c, app, wave=3, danger=3, kills=50, kills_by_type={"e_hiverat": 50})
    assert _quests(c)["q_tracker_4"] == {"state": "active", "progress": 0}

    _finish(c, app, wave=3, danger=4, kills=50, kills_by_type={"e_hiverat": 50})
    assert _quests(c)["q_tracker_4"]["state"] == "done"


def test_flagged_run_gives_no_progress(client):
    c, app = client
    c.post("/api/lodge/take", json={"quest_id": "q_master_1"})
    # Победа раньше последней волны — забег помечается флагом
    out = _finish(c, app, wave=5, win=1)
    assert "win_before_last_wave" in out["flagged"]
    assert _quests(c)["q_master_1"] == {"state": "active", "progress": 0}


def test_kills_by_type_mismatch_flags_run(client):
    c, app = client
    c.post("/api/lodge/take", json={"quest_id": "q_master_1"})
    out = _finish(c, app, wave=1, kills=1, kills_by_type={"e_hiverat": 10 ** 6})
    assert "kills_by_type_mismatch" in out["flagged"]


def test_kills_by_type_stored_in_run(client):
    c, app = client
    import db

    _finish(c, app, wave=3, kills=12, kills_by_type={"e_hiverat": 12, "мусор": 5})
    conn = db.get_db()
    row = conn.execute("SELECT kills_by_type FROM runs ORDER BY id DESC LIMIT 1").fetchone()
    conn.close()
    # Неизвестный ключ отброшен молча, известный записан
    assert json.loads(row["kills_by_type"]) == {"e_hiverat": 12}
