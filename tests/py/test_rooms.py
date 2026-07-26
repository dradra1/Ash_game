"""Реестр комнат: вход, лимиты, отвал, уборка. Симуляции здесь нет — только релей."""
import time

import pytest

from rooms import Rooms


def make_rooms(**overrides):
    cfg = {
        "content_version": 1,
        "net": {"room_code_len": 6, "room_code_alphabet": "ACDEFGH3479",
                "room_ttl_min": 30, "reconnect_grace_sec": 30},
        "coop": {"max_players": 8},
    }
    cfg["net"].update(overrides.pop("net", {}))
    cfg["coop"].update(overrides.pop("coop", {}))
    return Rooms(lambda: cfg)


def test_create_gives_code_and_host():
    r = make_rooms()
    room = r.create("sid1", "Игрок", 1)
    assert len(room.code) == 6
    assert room.host_sid == "sid1"
    pub = room.public()
    assert len(pub["players"]) == 1
    assert pub["players"][0]["host"] is True
    assert pub["state"] == "lobby"


def test_codes_are_unique():
    r = make_rooms()
    codes = {r.create(f"sid{i}", "И", 1).code for i in range(30)}
    assert len(codes) == 30


def test_join_by_code():
    r = make_rooms()
    room = r.create("host", "Хост", 1)
    joined, err = r.join("guest", room.code, "Гость", 2)
    assert err is None
    assert len(joined.players) == 2
    assert joined.public()["players"][1]["host"] is False


def test_join_is_case_insensitive():
    r = make_rooms()
    room = r.create("host", "Хост", 1)
    _joined, err = r.join("guest", room.code.lower(), "Гость", 2)
    assert err is None


def test_join_unknown_code():
    r = make_rooms()
    room, err = r.join("guest", "ZZZZZZ", "Гость", 2)
    assert room is None
    assert err == "room_missing"


def test_room_is_full_at_max_players():
    r = make_rooms(coop={"max_players": 3})
    room = r.create("host", "Хост", 1)
    assert r.join("a", room.code, "A", 2)[1] is None
    assert r.join("b", room.code, "B", 3)[1] is None
    room2, err = r.join("c", room.code, "C", 4)
    assert room2 is None
    assert err == "room_full"


def test_no_join_after_start():
    r = make_rooms()
    room = r.create("host", "Хост", 1)
    r.start("host", 123, "run1")
    room2, err = r.join("late", room.code, "Опоздавший", 2)
    assert room2 is None
    assert err == "run_started"


def test_only_host_starts_and_configures():
    r = make_rooms()
    room = r.create("host", "Хост", 1)
    r.join("guest", room.code, "Гость", 2)
    assert r.set_setup("guest", "ar_hive", 2) is None, "не-хост не настраивает забег"
    assert r.set_setup("host", "ar_hive", 2) is not None
    assert room.arena == "ar_hive" and room.danger == 2
    assert r.start("guest", 1, "x")[1] == "not_host"
    assert r.start("host", 1, "x")[1] is None


def test_leaving_guest_keeps_run_alive():
    r = make_rooms()
    room = r.create("host", "Хост", 1)
    r.join("guest", room.code, "Гость", 2)
    r.start("host", 1, "run")
    left, was_host = r.leave("guest")
    assert was_host is False
    assert left.state == "running", "выход не-хоста не должен ломать забег"
    assert len(left.players) == 1


def test_host_leaving_ends_the_run():
    r = make_rooms()
    room = r.create("host", "Хост", 1)
    r.join("guest", room.code, "Гость", 2)
    r.start("host", 1, "run")
    left, was_host = r.leave("host")
    assert was_host is True
    # Хост-миграции в v1 нет: забег завершается, участники получают результат
    assert left.state == "over"


def test_last_player_out_removes_room():
    r = make_rooms()
    room = r.create("host", "Хост", 1)
    code = room.code
    r.leave("host")
    assert r.get(code) is None


def test_ready_and_character_round_trip():
    r = make_rooms()
    room = r.create("host", "Хост", 1)
    r.set_character("host", "ch_zealot")
    r.set_ready("host", True)
    p = room.public()["players"][0]
    assert p["character"] == "ch_zealot"
    assert p["ready"] is True


def test_gone_player_is_kept_during_grace_then_dropped():
    r = make_rooms(net={"reconnect_grace_sec": 0.05})
    room = r.create("host", "Хост", 1)
    r.join("guest", room.code, "Гость", 2)
    r.mark_gone("guest")
    assert len(room.players) == 2, "место держится на время грейса"
    assert room.public()["players"][1]["gone"] is True

    r.rejoin("guest")
    assert room.public()["players"][1]["gone"] is False, "переподключение возвращает в бой"

    r.mark_gone("guest")
    time.sleep(0.1)
    r.sweep()
    assert len(room.players) == 1, "после грейса игрок убирается"


def test_sweep_closes_stale_rooms():
    r = make_rooms(net={"room_ttl_min": 0})
    room = r.create("host", "Хост", 1)
    code = room.code
    room.touched_at -= 1
    r.sweep()
    assert r.get(code) is None


def test_sweep_keeps_active_rooms():
    r = make_rooms()
    room = r.create("host", "Хост", 1)
    r.sweep()
    assert r.get(room.code) is not None


def test_creating_twice_leaves_the_old_room():
    r = make_rooms()
    first = r.create("sid", "И", 1)
    second = r.create("sid", "И", 1)
    assert first.code != second.code
    assert r.get(first.code) is None, "старая комната опустела и закрылась"


def test_public_snapshot_hides_sids():
    r = make_rooms()
    room = r.create("host", "Хост", 1)
    blob = repr(room.public())
    assert "host" in blob
    assert "sid" not in blob.replace("sids", "")
