"""Метапрогрессия: начисление реликвий, проверки забегов, ачивки, покупки.

Главное, что здесь проверяется, — что сервер НЕ верит клиенту: реликвии считает
сам, подделанные итоги помечает флагом, баланс списывает атомарно.
"""
import json
import os

import pytest


def _seed_copy(tmp_path):
    """Копия репо-сида на выброс: приложение не должно писать в рабочую копию."""
    import pathlib
    import shutil
    src = pathlib.Path(__file__).resolve().parents[2] / "config" / "game_config.json"
    dst = tmp_path / "seed_game_config.json"
    shutil.copyfile(src, dst)
    return dst


@pytest.fixture
def app_env(tmp_path, monkeypatch):
    monkeypatch.setenv("ASH_DATA", str(tmp_path))
    monkeypatch.setenv("ASH_REPO_CONFIG", str(_seed_copy(tmp_path)))
    import importlib
    import db as db_mod
    import meta as meta_mod
    import app as app_mod
    importlib.reload(db_mod)
    importlib.reload(meta_mod)
    importlib.reload(app_mod)
    app_mod.app.config["TESTING"] = True
    return app_mod, db_mod, meta_mod


@pytest.fixture
def client(app_env):
    app_mod, _db, _meta = app_env
    c = app_mod.app.test_client()
    c.post("/api/register", json={"name": "metatester", "password": "pepel123"})
    return c


def cfg(app_env):
    return app_env[0].get_config()


# --- Формула начисления ---------------------------------------------------

def test_relics_follow_the_config_formula(app_env):
    _app, _db, meta = app_env
    c = cfg(app_env)
    f = c["meta"]["relic_formula"]
    run = {"danger": 1, "character": None, "arena": None, "id": 1, "started_at": 0,
           "curses": "[]"}
    got = meta.award_relics(c, run, wave=20, win=True, bosses=2, players=1)
    expect = round((f["per_wave"] * 20 + f["win"] + f["per_boss"] * 2)
                   * c["danger"][1]["reward_mult"])
    assert got == expect


def test_curse_reward_mult_boosts_relics(app_env):
    _app, _db, meta = app_env
    c = cfg(app_env)
    base_run = {"danger": 1, "id": 1, "started_at": 0, "curses": "[]"}
    cursed = {"danger": 1, "id": 1, "started_at": 0,
              "curses": '["cu_iron_tithe"]'}
    plain = meta.award_relics(c, base_run, 10, True, 1, 1)
    boosted = meta.award_relics(c, cursed, 10, True, 1, 1)
    assert boosted > plain
    assert abs(boosted / plain - 1.25) < 0.02


def test_five_danger_tiers_exist(app_env):
    c = cfg(app_env)
    assert len(c["danger"]) == 5
    assert c["danger"][4]["id"] == 4
    assert c["danger"][3]["bosses_final"] == 2
    assert "curses" in c and "cu_double_tempo" in c["curses"]


def test_higher_danger_pays_more(app_env):
    _app, _db, meta = app_env
    c = cfg(app_env)
    run0 = {"danger": 0, "id": 1, "started_at": 0}
    run3 = {"danger": 3, "id": 1, "started_at": 0}
    assert (meta.award_relics(c, run3, 10, False, 1, 1)
            > meta.award_relics(c, run0, 10, False, 1, 1))


def test_danger_reward_follows_the_configured_step(app_env):
    """Множитель реликвий за сложность — геометрическая прогрессия от одной ручки.

    До этого пять чисел стояли в таблице сами по себе (1.0 / 1.35 / 1.8 / 2.4 / 3.2)
    и правились на глаз. Теперь meta.relic_formula.danger_step задаёт шаг, а
    danger[i].reward_mult обязан быть step^i — иначе таблица и ручка разъехались.
    """
    c = cfg(app_env)
    step = c["meta"]["relic_formula"]["danger_step"]
    assert step > 1, "шаг обязан РАСТИТЬ награду с ростом сложности"
    for i, d in enumerate(c["danger"]):
        assert abs(d["reward_mult"] - step ** i) < 1e-4, f"сложность {i}"


def test_each_danger_step_pays_exactly_the_step(app_env):
    _app, _db, meta = app_env
    c = cfg(app_env)
    step = c["meta"]["relic_formula"]["danger_step"]
    # Волна побольше, чтобы округление до целых не съедало разницу
    pay = [meta.award_relics(c, {"danger": i, "id": 1, "started_at": 0}, 20, True, 2, 1)
           for i in range(len(c["danger"]))]
    for i in range(1, len(pay)):
        assert pay[i] > pay[i - 1], f"сложность {i} платит не больше предыдущей"
        assert abs(pay[i] / pay[i - 1] - step) < 0.01, f"шаг между {i - 1} и {i}"


def test_coop_gives_a_small_bonus_not_a_farm(app_env):
    _app, _db, meta = app_env
    c = cfg(app_env)
    run = {"danger": 1, "id": 1, "started_at": 0}
    solo = meta.award_relics(c, run, 10, False, 1, 1)
    eight = meta.award_relics(c, run, 10, False, 1, 8)
    assert eight > solo
    assert eight < solo * 1.5, "кооп не должен быть фермой реликвий"


# --- Плаузибилити ---------------------------------------------------------

def make_run(**kw):
    base = {"danger": 1, "character": "ch_pilgrim", "arena": "ar_hive",
            "id": 1, "started_at": 0, "players": 1}
    base.update(kw)
    return base


def test_honest_run_passes(app_env):
    _app, _db, meta = app_env
    c = cfg(app_env)
    need = meta.min_run_time(c, 10)
    assert meta.check_run(c, make_run(), wave=10, win=False, bosses=1,
                          time_sec=need + 60, kills=300, score=900, players=1) == []


def test_too_fast_is_flagged(app_env):
    _app, _db, meta = app_env
    c = cfg(app_env)
    reasons = meta.check_run(c, make_run(), wave=20, win=True, bosses=2,
                             time_sec=5, kills=100, score=500, players=1)
    assert "too_fast" in reasons


def test_mid_wave_death_is_not_too_fast(app_env):
    """Смерть посреди волны W: время ≈ полные 1..W-1 + intro текущей."""
    _app, _db, meta = app_env
    c = cfg(app_env)
    wave = 8
    need = meta.min_run_time(c, wave)
    reasons = meta.check_run(c, make_run(), wave=wave, win=False, bosses=1,
                             time_sec=need + 2, kills=200, score=600, players=1)
    assert "too_fast" not in reasons


def test_impossible_kill_count_is_flagged(app_env):
    _app, _db, meta = app_env
    c = cfg(app_env)
    need = meta.min_run_time(c, 5)
    reasons = meta.check_run(c, make_run(), wave=5, win=False, bosses=0,
                             time_sec=need + 10, kills=999999, score=100, players=1)
    assert "too_many_kills" in reasons


def test_impossible_score_is_flagged(app_env):
    _app, _db, meta = app_env
    c = cfg(app_env)
    need = meta.min_run_time(c, 5)
    reasons = meta.check_run(c, make_run(), wave=5, win=False, bosses=0,
                             time_sec=need + 10, kills=10, score=10 ** 9, players=1)
    assert "score_too_high" in reasons


def test_win_before_the_last_wave_is_flagged(app_env):
    _app, _db, meta = app_env
    c = cfg(app_env)
    need = meta.min_run_time(c, 3)
    reasons = meta.check_run(c, make_run(), wave=3, win=True, bosses=0,
                             time_sec=need + 10, kills=10, score=10, players=1)
    assert "win_before_last_wave" in reasons


def test_wave_beyond_the_run_is_flagged(app_env):
    _app, _db, meta = app_env
    c = cfg(app_env)
    reasons = meta.check_run(c, make_run(), wave=999, win=False, bosses=0,
                             time_sec=10 ** 6, kills=1, score=1, players=1)
    assert "wave_out_of_range" in reasons


# --- Сквозной путь через API ---------------------------------------------

def start_run(client, **kw):
    body = {"character": "ch_pilgrim", "arena": "ar_hive", "danger": 1}
    body.update(kw)
    return client.post("/api/run/start", json=body).get_json()


def backdate(db_mod, run_id, seconds):
    """Отодвинуть старт забега в прошлое.

    Сервер проверяет, что игровое время не обгоняет реальное — иначе клиент мог бы
    заявить получасовой забег через секунду после старта. В тестах забег
    начинается и заканчивается мгновенно, поэтому дату старта двигаем руками.
    """
    import time
    conn = db_mod.get_db()
    try:
        conn.execute("UPDATE runs SET started_at = ? WHERE run_id = ?",
                     (time.time() - seconds, run_id))
        conn.commit()
    finally:
        conn.close()


def test_finish_awards_relics_and_they_persist(client, app_env):
    started = start_run(client)
    c = cfg(app_env)
    need = app_env[2].min_run_time(c, 8)
    backdate(app_env[1], started["run_id"], need + 60)
    res = client.post("/api/run/finish", json={
        "run_id": started["run_id"], "wave": 8, "win": False, "bosses": 1,
        "time_sec": need + 30, "kills": 200, "score": 700,
    }).get_json()
    assert res["relics_gained"] > 0
    assert "flagged" not in res

    profile = client.get("/api/profile").get_json()
    assert profile["relics"] == res["relics_gained"]


def test_faked_result_is_flagged_but_still_pays(client, app_env):
    started = start_run(client)
    # Даже если дать «настоящее» время — числа всё равно невозможные
    backdate(app_env[1], started["run_id"], 3600)
    res = client.post("/api/run/finish", json={
        "run_id": started["run_id"], "wave": 20, "win": True, "bosses": 2,
        "time_sec": 3, "kills": 10 ** 6, "score": 10 ** 9,
    }).get_json()
    assert res["relics_gained"] > 0, "реликвии начисляются по серверной формуле"
    assert res.get("flagged"), "подделанный забег должен быть помечен"
    assert client.get("/api/profile").get_json()["relics"] == res["relics_gained"]

    board = client.get("/api/board?mode=solo").get_json()
    assert all(r["score"] < 10 ** 9 for r in board), "помеченный забег не идёт в лидерборд"


def test_achievement_is_granted_by_the_server(client, app_env):
    started = start_run(client)
    c = cfg(app_env)
    need = app_env[2].min_run_time(c, 10)
    backdate(app_env[1], started["run_id"], need + 60)
    res = client.post("/api/run/finish", json={
        "run_id": started["run_id"], "wave": 10, "win": False, "bosses": 1,
        "time_sec": need + 20, "kills": 250, "score": 800,
    }).get_json()
    assert "ac_wave10" in res["achievements"]
    profile = client.get("/api/profile").get_json()
    assert any(a["id"] == "ac_wave10" for a in profile["achievements"])


def test_kills100_and_damage_taken_achievements(client, app_env):
    started = start_run(client)
    c = cfg(app_env)
    need = app_env[2].min_run_time(c, 5)
    backdate(app_env[1], started["run_id"], need + 60)
    res = client.post("/api/run/finish", json={
        "run_id": started["run_id"], "wave": 5, "win": False, "bosses": 0,
        "time_sec": need + 20, "kills": 120, "score": 400,
        "damage_taken": 5000, "ash_gained": 100, "shop_buys": 0,
    }).get_json()
    assert "ac_kills100" in res["achievements"]
    assert "ac_dmg_taken_5k" in res["achievements"]


def test_losses_achievement(client, app_env):
    c = cfg(app_env)
    for _ in range(5):
        started = start_run(client)
        need = app_env[2].min_run_time(c, 3)
        backdate(app_env[1], started["run_id"], need + 30)
        client.post("/api/run/finish", json={
            "run_id": started["run_id"], "wave": 3, "win": False, "bosses": 0,
            "time_sec": need + 10, "kills": 20, "score": 50,
        })
    profile = client.get("/api/profile").get_json()
    assert any(a["id"] == "ac_losses_5" for a in profile["achievements"])


# --- Покупки --------------------------------------------------------------

def give_relics(app_env, client, amount):
    _app, db_mod, _meta = app_env
    uid = client.get("/api/profile").get_json()
    db_mod.add_relics(1, amount)
    return uid


def test_unlock_requires_relics(client, app_env):
    res = client.post("/api/meta/unlock", json={"kind": "faction", "id": "scrap"})
    assert res.status_code == 402
    assert res.get_json()["error"] == "not_enough_relics"


def test_unlock_spends_exactly_the_config_price(client, app_env):
    c = cfg(app_env)
    price = c["factions"]["scrap"]["unlock"]["cost"]
    give_relics(app_env, client, price + 5)
    res = client.post("/api/meta/unlock", json={"kind": "faction", "id": "scrap"}).get_json()
    assert res["spent"] == price
    profile = client.get("/api/profile").get_json()
    assert profile["relics"] == 5
    assert "scrap" in profile["unlocks"]["faction"]


def test_cannot_buy_the_same_thing_twice(client, app_env):
    c = cfg(app_env)
    give_relics(app_env, client, c["factions"]["scrap"]["unlock"]["cost"] * 3)
    client.post("/api/meta/unlock", json={"kind": "faction", "id": "scrap"})
    again = client.post("/api/meta/unlock", json={"kind": "faction", "id": "scrap"})
    assert again.status_code == 409


def test_default_content_is_not_purchasable(client, app_env):
    give_relics(app_env, client, 10000)
    res = client.post("/api/meta/unlock", json={"kind": "arena", "id": "ar_hive"})
    assert res.status_code == 400, "стартовая арена не продаётся"


def test_character_needs_its_faction_first(client, app_env):
    c = cfg(app_env)
    give_relics(app_env, client, 100000)
    # Громила из Драка-Орды: без открытой фракции покупать нечего
    res = client.post("/api/meta/unlock", json={"kind": "character", "id": "ch_brute"})
    assert res.status_code == 409
    client.post("/api/meta/unlock", json={"kind": "faction", "id": "scrap"})
    ok = client.post("/api/meta/unlock", json={"kind": "character", "id": "ch_brute"})
    assert ok.status_code == 200


def test_upgrade_ranks_up_and_stops_at_max(client, app_env):
    c = cfg(app_env)
    up = c["meta"]["upgrades"][0]
    give_relics(app_env, client, sum(up["price"]) + 1000)
    for expected in range(1, up["max_ranks"] + 1):
        res = client.post("/api/meta/unlock",
                          json={"kind": "upgrade", "id": up["id"]}).get_json()
        assert res["rank"] == expected
    over = client.post("/api/meta/unlock", json={"kind": "upgrade", "id": up["id"]})
    assert over.status_code == 409


def test_relics_never_go_negative(client, app_env):
    c = cfg(app_env)
    price = c["factions"]["scrap"]["unlock"]["cost"]
    give_relics(app_env, client, price - 1)
    res = client.post("/api/meta/unlock", json={"kind": "faction", "id": "scrap"})
    assert res.status_code == 402
    assert client.get("/api/profile").get_json()["relics"] == price - 1


# --- Арены ----------------------------------------------------------------

def test_arena_can_be_unlocked_for_relics(client, app_env):
    """Регресс: механизм открытия арен работал, а купить их было нечем.

    Цена в конфиге, kind "arena" на сервере и профильные unlocks.arena существовали
    с самого начала, но в Реликварии не было вкладки арен — то есть до этой покупки
    игрок не мог добраться никак. Тест держит серверную половину; вкладку добавили
    в ui/meta_ui.js.
    """
    c = cfg(app_env)
    price = c["arenas"]["ar_ash"]["unlock"]["cost"]
    give_relics(app_env, client, price)
    res = client.post("/api/meta/unlock", json={"kind": "arena", "id": "ar_ash"})
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["spent"] == price
    profile = client.get("/api/profile").get_json()
    assert "ar_ash" in profile["unlocks"]["arena"]
    assert profile["relics"] == 0


def test_arena_prices_are_the_declared_ones(app_env):
    c = cfg(app_env)
    assert c["arenas"]["ar_ash"]["unlock"]["cost"] == 300
    assert c["arenas"]["ar_tomb"]["unlock"]["cost"] == 600
    assert (c["arenas"]["ar_hive"]["unlock"]["type"] == "default"), "первая арена бесплатна"


def test_arena_needs_the_full_price(client, app_env):
    c = cfg(app_env)
    price = c["arenas"]["ar_tomb"]["unlock"]["cost"]
    give_relics(app_env, client, price - 1)
    res = client.post("/api/meta/unlock", json={"kind": "arena", "id": "ar_tomb"})
    assert res.status_code == 402
    assert client.get("/api/profile").get_json()["relics"] == price - 1
