#!/usr/bin/env python3
"""Генерация врагов, элит и боссов по промптам из tools/assets.json.

Три фазы на юнита: create_character (v3) → animate_character (walk) → сборка листов.
Состояние пишется в scratch/gen_units_state.json, поэтому прогон возобновляемый:
после обрыва повтор не создаёт персонажа заново и не тратит кредиты дважды.

    python3 tools/gen_units.py                 всё, чего нет в static/textures
    python3 tools/gen_units.py e_hiverat e_brute   только указанные

Почему системный python3, а не .venv: сборке листов нужен Pillow, он есть в системном
интерпретаторе. В .venv лежат только зависимости сервера (CLAUDE.md §5), и тащить туда
Pillow ради тулинга смысла нет — в Docker он всё равно не поедет.

Листы атаки не генерируются: render.js умеет только idle и <texture>_walk (altId),
_attack ниоткуда не читается и был бы мёртвым весом.
"""
import json
import os
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PXL = os.path.join(ROOT, "tools", "pxl.py")
ASSETS = os.path.join(ROOT, "tools", "assets.json")
STATE = os.path.join(ROOT, "scratch", "gen_units_state.json")
TEXDIR = os.path.join(ROOT, "static", "textures")
DIRS = ["south", "east", "north", "west"]
SECTIONS = ("enemies", "elites", "bosses")
POLL = 40
DEADLINE = 6 * 3600


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def pxl(*args, timeout=900):
    r = subprocess.run([sys.executable, PXL, *args], capture_output=True, text=True,
                       cwd=ROOT, timeout=timeout)
    return r.returncode, r.stdout + r.stderr


def load_state():
    if os.path.exists(STATE):
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_state(state):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def units(only):
    """Юниты, которым нужен спрайт: из assets.json, минус уже лежащие в textures."""
    with open(ASSETS, encoding="utf-8") as f:
        data = json.load(f)
    style = data["style"]
    out = []
    for sec in SECTIONS:
        for key, entry in data.get(sec, {}).items():
            if only and key not in only:
                continue
            if not only and os.path.exists(os.path.join(TEXDIR, f"{key}.png")):
                continue
            out.append((key, entry, style))
    return out


def slots_busy(text):
    """«Зайди позже», а не отказ: pixellab при этом ничего не списывает и не создаёт.

    Формулировок у одной и той же преграды три, и они не пересекаются по словам:
    «need N job slots», «rate limit exceeded» и «429: Maximum 10 concurrent
    background jobs allowed». Ловить надо все — иначе прогон выкашивает пол-очереди
    на ровном месте, приняв занятость сервиса за ошибку промпта.
    """
    low = text.lower()
    return ("job slots" in low or "rate limit" in low
            or "concurrent background jobs" in low)


def create(key, entry, style):
    """Поставить создание персонажа. -> cid | False (нет слотов) | None (ошибка)."""
    # v3 умеет только гуманоидов: на quadruped он отвечает «v3 mode does not support
    # quadruped body type». Зверям остаётся standard (1 генерация, грубее) либо pro
    # (20–40). Начинаем со standard и смотрим глазами — лестница качества из
    # описания animate_character: template → v3 → pro.
    quad = entry.get("body_type") == "quadruped"
    payload = {
        "description": f"{entry['prompt']}, {style}",
        "name": key,
        "mode": entry.get("mode", "standard" if quad else "v3"),
        "size": entry["size"],
        "view": "high top-down",
        "outline": "single color outline",
        "detail": "high detail",
        "body_type": entry.get("body_type", "humanoid"),
    }
    if payload["body_type"] == "quadruped":
        payload["template"] = entry["template"]
    code, out = pxl("call", "create_character", json.dumps(payload, ensure_ascii=False))
    if slots_busy(out):
        return False
    m = re.search(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})", out)
    if code != 0 or not m:
        log(f"  ! create {key}: {out.strip()[:200]}")
        return None
    log(f"  + создаю {key} ({entry['size']}px) {m.group(1)}")
    return m.group(1)


def status(cid):
    """-> ('completed'|'pending'|'error', сколько направлений walk готово)"""
    code, out = pxl("get", cid)
    if code != 0:
        return "error", 0
    state = "completed" if "status: completed" in out else "pending"
    found, current = set(), None
    for line in out.splitlines():
        head = re.match(r"\s{2}(\S+) — \d+ dir", line)
        if head:
            current = head.group(1).lower()
            continue
        body = re.match(r"\s{4}(south|east|north|west):\s*http", line)
        if body and current and ("walk" in current or "run" in current):
            found.add(body.group(1))
    return state, len(found)


def animate(key, cid, entry):
    """Поставить ходьбу. Четвероногим — беговой шаблон (ASSETS.md §6.4)."""
    tpl = "running-4-frames" if entry.get("body_type") == "quadruped" else "walking-4-frames"
    payload = {
        "character_id": cid,
        "template_animation_id": tpl,
        "animation_name": "walk",
        "directions": DIRS,
    }
    code, out = pxl("call", "animate_character", json.dumps(payload, ensure_ascii=False))
    if slots_busy(out):
        return False
    if code != 0 or "error:" in out.lower():
        log(f"  ! animate {key}: {out.strip()[:200]}")
        return None
    log(f"  + ходьба {key} ({tpl})")
    return True


def sheets(key, cid, entry):
    code, out = pxl("sheets", cid, key, "--fit", str(entry["fit"]))
    ok = code == 0 and os.path.exists(os.path.join(TEXDIR, f"{key}_walk.png"))
    log(f"  = листы {key}: {'ok' if ok else 'ПРОВАЛ ' + out.strip()[-200:]}")
    return ok


def main():
    only = set(sys.argv[1:])
    todo = units(only)
    if not todo:
        log("нечего генерировать")
        return
    state = load_state()
    log(f"старт: {len(todo)} юнитов — {', '.join(k for k, _, _ in todo)}")

    deadline = time.time() + DEADLINE
    done, failed = [], []

    while todo and time.time() < deadline:
        progressed = False
        busy = False          # сервис занят — новых постановок в этом проходе больше нет
        for key, entry, style in list(todo):
            st = state.setdefault(key, {"phase": "new"})

            if st["phase"] == "new":
                if busy:
                    continue  # молчим, а не долбим API одним и тем же отказом 27 раз
                cid = create(key, entry, style)
                if cid is False:
                    busy = True
                    continue
                if cid is None:
                    failed.append(key); todo.remove((key, entry, style)); continue
                st.update(phase="creating", cid=cid)
                save_state(state); progressed = True

            elif st["phase"] == "creating":
                ph, _ = status(st["cid"])
                if ph == "completed":
                    st["phase"] = "created"; save_state(state); progressed = True
                    log(f"  · {key} отрисован")

            elif st["phase"] == "created":
                if busy:
                    continue
                res = animate(key, st["cid"], entry)
                if res is False:
                    busy = True
                    continue
                if res is None:
                    failed.append(key); todo.remove((key, entry, style)); continue
                st["phase"] = "animating"; save_state(state); progressed = True

            elif st["phase"] == "animating":
                _, n = status(st["cid"])
                if n >= 4:
                    st["phase"] = "sheets"; save_state(state); progressed = True

            if st["phase"] == "sheets":
                ok = sheets(key, st["cid"], entry)
                st["phase"] = "done" if ok else "sheets"
                save_state(state)
                if ok:
                    done.append(key); todo.remove((key, entry, style))
                    progressed = True

        if todo and not progressed:
            time.sleep(POLL)

    log(f"ИТОГ: готово {len(done)}, провал {len(failed)}, осталось {len(todo)}")
    if failed:
        log("провал: " + ", ".join(failed))
    if todo:
        log("не дождались: " + ", ".join(k for k, _, _ in todo))
        sys.exit(1)


if __name__ == "__main__":
    main()
