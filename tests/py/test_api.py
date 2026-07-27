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
def client(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    monkeypatch.setenv("ASH_DATA", str(data_dir))
    monkeypatch.setenv("ASH_REPO_CONFIG", str(_seed_copy(tmp_path)))

    # Удаляем модуль из кэша, чтобы каждый тест получал свежую БД.
    for mod in ["app", "db"]:
        if mod in os.sys.modules:
            del os.sys.modules[mod]

    import app

    with app.app.test_client() as c:
        yield c, app


def test_register_success(client):
    c, _ = client
    r = c.post("/api/register", json={"name": "Игрок", "password": "secret"})
    assert r.status_code == 201
    data = r.get_json()
    assert data["ok"] is True
    assert data["user"]["name"] == "Игрок"


def test_register_duplicate_name(client):
    c, _ = client
    c.post("/api/register", json={"name": "Игрок", "password": "secret"})
    r = c.post("/api/register", json={"name": "Игрок", "password": "secret"})
    assert r.status_code == 409
    assert r.get_json()["error"] == "name_taken"


def test_register_short_password(client):
    c, _ = client
    r = c.post("/api/register", json={"name": "Игрок", "password": "123"})
    assert r.status_code == 400
    assert r.get_json()["error"] == "short_password"


def test_login_valid(client):
    c, _ = client
    c.post("/api/register", json={"name": "Игрок", "password": "secret"})
    r = c.post("/api/login", json={"name": "Игрок", "password": "secret"})
    assert r.status_code == 200
    assert r.get_json()["ok"] is True


def test_login_invalid(client):
    c, _ = client
    c.post("/api/register", json={"name": "Игрок", "password": "secret"})
    r = c.post("/api/login", json={"name": "Игрок", "password": "wrong"})
    assert r.status_code == 401
    assert r.get_json()["error"] == "invalid_credentials"


def test_profile_unauthorized(client):
    c, _ = client
    r = c.get("/api/profile")
    assert r.status_code == 401
    assert r.get_json()["error"] == "auth_required"


def test_config_etag_and_304(client):
    c, app = client
    r1 = c.get("/api/config")
    assert r1.status_code == 200
    data = r1.get_json()
    assert "content_version" in data
    etag = r1.headers["ETag"]
    assert etag == f'"v{data["content_version"]}"'

    r2 = c.get("/api/config", headers={"If-None-Match": etag})
    assert r2.status_code == 304


def test_run_start_unique_seeds(client):
    c, _ = client
    c.post("/api/register", json={"name": "Игрок", "password": "secret"})
    r1 = c.post(
        "/api/run/start",
        json={"character": "ch_pilgrim", "arena": "ar_hive", "danger": 1},
    )
    r2 = c.post(
        "/api/run/start",
        json={"character": "ch_pilgrim", "arena": "ar_hive", "danger": 1},
    )
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.get_json()["run_id"] != r2.get_json()["run_id"]
    assert r1.get_json()["seed"] != r2.get_json()["seed"]


def test_run_finish_foreign_run(client):
    c, _ = client
    c.post("/api/register", json={"name": "Первый", "password": "secret"})
    start = c.post(
        "/api/run/start",
        json={"character": "ch_pilgrim", "arena": "ar_hive", "danger": 1},
    )
    run_id = start.get_json()["run_id"]

    c.post("/api/logout")
    c.post("/api/register", json={"name": "Второй", "password": "secret"})
    r = c.post("/api/run/finish", json={"run_id": run_id, "wave": 5, "score": 100})
    assert r.status_code == 403
    assert r.get_json()["error"] == "not_your_run"


def test_board_returns_list(client):
    c, _ = client
    c.post("/api/register", json={"name": "Игрок", "password": "secret"})
    r = c.get("/api/board?mode=solo")
    assert r.status_code == 200
    assert r.get_json() == []
