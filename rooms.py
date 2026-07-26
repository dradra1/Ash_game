"""Реестр комнат в памяти сервера.

Сервер — ТОЛЬКО релей: он не считает игру и ничего о ней не знает. Его задача —
свести игроков в комнату, отдать всем список участников и переслать сообщения
внутри комнаты. Вся симуляция живёт в браузере хоста (CLAUDE.md §2).

Комнаты приватные: попасть можно только по коду. Публичного матчмейкинга нет.
"""
import secrets
import threading
import time


class Room:
    __slots__ = ("code", "host_sid", "players", "created_at", "touched_at",
                 "state", "content_version", "arena", "danger", "curses",
                 "seed", "run_id")

    def __init__(self, code, content_version):
        self.code = code
        self.host_sid = None
        self.players = {}          # sid → {name, character, ready, user_id, ping, gone_at}
        self.created_at = time.time()
        self.touched_at = self.created_at
        self.state = "lobby"       # lobby | running | over
        self.content_version = content_version
        self.arena = None
        self.danger = 0
        self.curses = []
        self.seed = None
        self.run_id = None

    def public(self):
        """Снимок комнаты для клиентов: без sid — их знать никому не нужно."""
        host = self.host_sid
        return {
            "code": self.code,
            "state": self.state,
            "arena": self.arena,
            "danger": self.danger,
            "curses": list(self.curses),
            "content_version": self.content_version,
            "players": [
                {
                    "id": idx,
                    "name": p["name"],
                    "character": p["character"],
                    "ready": p["ready"],
                    "ping": p["ping"],
                    "host": sid == host,
                    "gone": p["gone_at"] is not None,
                }
                for idx, (sid, p) in enumerate(self.players.items())
            ],
        }

    def index_of(self, sid):
        for i, key in enumerate(self.players):
            if key == sid:
                return i
        return -1


class Rooms:
    def __init__(self, config_getter):
        self._rooms = {}
        self._by_sid = {}
        self._lock = threading.RLock()
        self._config = config_getter

    # --- настройки из конфига, чтобы не плодить константы в Python ---------
    def _net(self):
        return self._config().get("net", {})

    def _coop(self):
        return self._config().get("coop", {})

    def _new_code(self):
        net = self._net()
        alphabet = net.get("room_code_alphabet", "ACDEFGHJKLMNPQRTUVWXY3479")
        length = net.get("room_code_len", 6)
        for _ in range(50):
            code = "".join(secrets.choice(alphabet) for _ in range(length))
            if code not in self._rooms:
                return code
        raise RuntimeError("не удалось выделить код комнаты")

    # --- жизненный цикл ---------------------------------------------------
    def create(self, sid, name, user_id, character=None):
        with self._lock:
            self.leave(sid)
            code = self._new_code()
            room = Room(code, self._config().get("content_version", 1))
            room.host_sid = sid
            room.players[sid] = self._player(name, user_id, character)
            self._rooms[code] = room
            self._by_sid[sid] = code
            return room

    def join(self, sid, code, name, user_id, character=None):
        with self._lock:
            room = self._rooms.get((code or "").upper())
            if room is None:
                return None, "room_missing"
            if room.state != "lobby":
                # Вход после старта запрещён (ТЗ §2): досыпать игрока в идущую
                # симуляцию хоста нечем — он не знает состояния мира.
                return None, "run_started"
            if len(room.players) >= self._coop().get("max_players", 8):
                return None, "room_full"
            self.leave(sid)
            room.players[sid] = self._player(name, user_id, character)
            room.touched_at = time.time()
            self._by_sid[sid] = room.code
            return room, None

    def _player(self, name, user_id, character):
        return {"name": name, "user_id": user_id, "character": character,
                "ready": False, "ping": 0, "gone_at": None}

    def leave(self, sid):
        """Выход игрока. Возвращает (комната, был_ли_хостом) либо (None, False)."""
        with self._lock:
            code = self._by_sid.pop(sid, None)
            if code is None:
                return None, False
            room = self._rooms.get(code)
            if room is None:
                return None, False
            was_host = room.host_sid == sid
            room.players.pop(sid, None)
            room.touched_at = time.time()
            if not room.players:
                self._rooms.pop(code, None)
                return room, was_host
            if was_host:
                # Хост-миграции в v1 нет: забег завершается, результат сохраняется
                # всем участникам. Об этом честно предупреждено в лобби.
                room.state = "over"
            return room, was_host

    def mark_gone(self, sid):
        """Отвал без выхода: место держим reconnect_grace_sec, потом убираем."""
        with self._lock:
            room = self.of(sid)
            if room is None:
                return None
            p = room.players.get(sid)
            if p is not None:
                p["gone_at"] = time.time()
            room.touched_at = time.time()
            return room

    def rejoin(self, sid):
        with self._lock:
            room = self.of(sid)
            if room is None:
                return None
            p = room.players.get(sid)
            if p is not None:
                p["gone_at"] = None
            return room

    def of(self, sid):
        with self._lock:
            code = self._by_sid.get(sid)
            return self._rooms.get(code) if code else None

    def get(self, code):
        with self._lock:
            return self._rooms.get((code or "").upper())

    # --- лобби ------------------------------------------------------------
    def set_ready(self, sid, ready):
        with self._lock:
            room = self.of(sid)
            if room is None or sid not in room.players:
                return None
            room.players[sid]["ready"] = bool(ready)
            room.touched_at = time.time()
            return room

    def set_character(self, sid, character):
        with self._lock:
            room = self.of(sid)
            if room is None or sid not in room.players:
                return None
            room.players[sid]["character"] = character
            room.touched_at = time.time()
            return room

    def set_setup(self, sid, arena, danger, curses=None):
        """Арену, сложность и проклятия выбирает хост (обычно до лобби)."""
        with self._lock:
            room = self.of(sid)
            if room is None or room.host_sid != sid:
                return None
            if arena is not None:
                room.arena = arena
            if danger is not None:
                room.danger = int(danger)
            if curses is not None:
                room.curses = list(curses)
            room.touched_at = time.time()
            return room

    def start(self, sid, seed, run_id):
        with self._lock:
            room = self.of(sid)
            if room is None or room.host_sid != sid:
                return None, "not_host"
            if room.state != "lobby":
                return None, "run_started"
            room.state = "running"
            room.seed = seed
            room.run_id = run_id
            room.touched_at = time.time()
            return room, None

    def restart(self, sid, seed, run_id):
        """Хост перезапускает забег в той же комнате (пауза / поражение)."""
        with self._lock:
            room = self.of(sid)
            if room is None or room.host_sid != sid:
                return None, "not_host"
            if room.state not in ("running", "over"):
                return None, "not_running"
            room.state = "running"
            room.seed = seed
            room.run_id = run_id
            for p in room.players.values():
                p["ready"] = False
            room.touched_at = time.time()
            return room, None

    def touch(self, sid):
        room = self.of(sid)
        if room is not None:
            room.touched_at = time.time()
        return room

    def set_ping(self, sid, ping):
        with self._lock:
            room = self.of(sid)
            if room is not None and sid in room.players:
                room.players[sid]["ping"] = int(ping)

    # --- уборка -----------------------------------------------------------
    def sweep(self):
        """Убрать протухшие комнаты и отвалившихся игроков. Возвращает список
        (комната, событие) для рассылки."""
        out = []
        now = time.time()
        ttl = self._net().get("room_ttl_min", 30) * 60
        grace = self._net().get("reconnect_grace_sec", 30)
        with self._lock:
            for code in list(self._rooms):
                room = self._rooms[code]
                for sid in list(room.players):
                    p = room.players[sid]
                    if p["gone_at"] is not None and now - p["gone_at"] > grace:
                        room.players.pop(sid, None)
                        self._by_sid.pop(sid, None)
                        out.append((room, "player_dropped"))
                        if room.host_sid == sid:
                            room.state = "over"
                            out.append((room, "host_dropped"))
                if not room.players or now - room.touched_at > ttl:
                    self._rooms.pop(code, None)
                    for sid in list(room.players):
                        self._by_sid.pop(sid, None)
                    out.append((room, "room_closed"))
        return out

    def stats(self):
        with self._lock:
            return {"rooms": len(self._rooms),
                    "players": sum(len(r.players) for r in self._rooms.values())}
