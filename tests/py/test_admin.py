"""Админ API: вайтлист и запись секций конфига."""
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
def client(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    monkeypatch.setenv("ASH_DATA", str(data_dir))
    # Админская запись конфига зеркалит его в репо-сид. Без подмены пути тест
    # переписывал бы config/game_config.json в рабочей копии и накручивал
    # content_version на каждом прогоне.
    monkeypatch.setenv("ASH_REPO_CONFIG", str(_seed_copy(tmp_path)))

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


def test_admin_write_does_not_touch_working_copy(client):
    """Регресс: запись конфига переписывала config/game_config.json в репозитории.

    Приложение зеркалит живой конфиг в репо-сид, чтобы патчи и деплой не расходились.
    Путь до сида был константой, а тесты гоняют настоящее приложение — и каждый
    прогон pytest дописывал рабочей копии +1 к content_version, засоряя git diff.
    Теперь сид переопределяется через ASH_REPO_CONFIG, и тронуть репозиторий тест
    не может даже случайно.
    """
    import pathlib

    c, app = client
    repo = pathlib.Path(__file__).resolve().parents[2] / "config" / "game_config.json"
    before = repo.read_bytes()

    _register(c, "dradra1")
    chars = c.get("/api/admin/config").get_json()["characters"]
    first = next(iter(chars))
    chars[first].setdefault("stats", {})["max_hp"] = 77
    assert c.put("/api/admin/config",
                 json={"section": "characters", "data": chars}).status_code == 200

    assert repo.read_bytes() == before, "тест переписал рабочую копию конфига"
    # А подменённый сид обновиться обязан: механизм зеркалирования должен работать
    seed = json.loads(pathlib.Path(os.environ["ASH_REPO_CONFIG"]).read_text(encoding="utf-8"))
    assert seed["characters"][first]["stats"]["max_hp"] == 77
