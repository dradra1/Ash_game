"""Админ API: вайтлист и запись секций конфига."""
import json
import os

import pytest


@pytest.fixture
def client(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    monkeypatch.setenv("ASH_DATA", str(data_dir))

    for mod in ["app", "db"]:
        if mod in os.sys.modules:
            del os.sys.modules[mod]

    import app

    # Вайтлист для тестов
    cfg = app.get_config()
    cfg.setdefault("admin", {})["whitelist"] = ["dradra1"]
    app._loaded_config = cfg

    with app.app.test_client() as c:
        yield c, app


def _register(c, name="dradra1", password="secret1"):
    return c.post("/api/register", json={"name": name, "password": password})


def test_admin_me_whitelist(client):
    c, _ = client
    _register(c, "dradra1")
    r = c.get("/api/admin/me")
    assert r.status_code == 200
    assert r.get_json()["admin"] is True

    c.post("/api/logout")
    _register(c, "normal_user", "secret1")
    r = c.get("/api/admin/me")
    assert r.status_code == 200
    assert r.get_json()["admin"] is False


def test_admin_config_forbidden_for_non_admin(client):
    c, _ = client
    _register(c, "normal_user", "secret1")
    r = c.get("/api/admin/config")
    assert r.status_code == 403


def test_admin_config_get_and_put(client):
    c, app = client
    _register(c, "dradra1")
    r = c.get("/api/admin/config")
    assert r.status_code == 200
    data = r.get_json()
    assert "characters" in data
    assert "weapons" in data

    # Меняем стат персонажа
    chars = json.loads(json.dumps(data["characters"]))
    first = next(iter(chars))
    chars[first].setdefault("stats", {})
    chars[first]["stats"]["max_hp"] = 99

    r = c.put("/api/admin/config", json={"section": "characters", "data": chars})
    assert r.status_code == 200
    assert r.get_json()["ok"] is True
    assert app.get_config()["characters"][first]["stats"]["max_hp"] == 99


def test_admin_rejects_forbidden_word(client):
    c, _ = client
    _register(c, "dradra1")
    r = c.get("/api/admin/config")
    chars = r.get_json()["characters"]
    first = next(iter(chars))
    chars[first]["name"] = "Warhammer Scout"
    r = c.put("/api/admin/config", json={"section": "characters", "data": chars})
    assert r.status_code == 400
    assert r.get_json()["error"] == "forbidden_word"


def test_boot_includes_admin_flag(client):
    c, _ = client
    _register(c, "dradra1")
    r = c.get("/")
    assert r.status_code == 200
    assert b'"admin": true' in r.data or b'"admin":true' in r.data
