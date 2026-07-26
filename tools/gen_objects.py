#!/usr/bin/env python3
"""Генерация оружия, снарядов, предметов и иконок по промптам из tools/assets.json.

Один объект = create_map_object → скачивание → ужатие до игрового размера.
Состояние в scratch/gen_objects_state.json: прогон возобновляемый, повтор после
обрыва не создаёт объект заново.

    python3 tools/gen_objects.py                    все секции объектов
    python3 tools/gen_objects.py weapons stats      только указанные секции
    python3 tools/gen_objects.py --only w_hammer    один texture-id

Статус объекта не опрашивается: эндпоинт скачивания отдаёт 423, пока идёт генерация,
и это дешевле лишнего RPC. Объекты живут 8 часов — качаем сразу.

Ужатие: вписываем bbox в fit×fit с заполнением 0.92 и LANCZOS — те же числа, что у
спрайт-листов (ASSETS.md §3), иначе иконки в лавке выпадают из масштаба. Пропорции
сохраняются: длинноствол не должен превратиться в квадрат.
"""
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PXL = os.path.join(ROOT, "tools", "pxl.py")
ASSETS = os.path.join(ROOT, "tools", "assets.json")
STATE = os.path.join(ROOT, "scratch", "gen_objects_state.json")
TEXDIR = os.path.join(ROOT, "static", "textures")
DOWNLOAD = "https://api.pixellab.ai/mcp/map-objects/{oid}/download"
SECTIONS = ("weapons", "projectiles", "items", "stats", "meta")
FILL = 0.92
INFLIGHT = 4
PACE = 6
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def pxl(*args, timeout=300):
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


def pending(sections, only):
    with open(ASSETS, encoding="utf-8") as f:
        data = json.load(f)
    style = data["style"]
    out = []
    for sec in sections:
        for key, entry in data.get(sec, {}).items():
            if only and key not in only:
                continue
            if os.path.exists(os.path.join(TEXDIR, f"{key}.png")):
                continue
            out.append((key, entry, style))
    return out


def create(key, entry, style):
    """-> object_id | False (подождать) | None (настоящая ошибка)

    «job slots» и «rate limit exceeded» — это «зайди позже», а не отказ: pixellab
    ничего не списывает и не создаёт. Ловить их надо одинаково, иначе прогон
    выкашивает пол-очереди на ровном месте.
    """
    gen = entry["gen"]
    payload = {
        "description": f"{entry['prompt']}, {style}",
        "width": gen,
        "height": gen,
        "view": entry.get("view", "side"),
        "outline": "single color outline",
        "detail": "high detail",
    }
    code, out = pxl("call", "create_map_object", json.dumps(payload, ensure_ascii=False))
    if "job slots" in out or "rate limit" in out.lower():
        return False
    m = UUID.search(out)
    if code != 0 or not m:
        log(f"  ! create {key}: {out.strip()[:200]}")
        return None
    log(f"  + {key} ({gen}px) {m.group(0)}")
    return m.group(0)


def download(oid):
    """-> bytes | None, если объект ещё генерится (423) или не отдался."""
    req = urllib.request.Request(DOWNLOAD.format(oid=oid),
                                 headers={"User-Agent": "curl/8.0"})
    try:
        data = urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError as e:
        if e.code == 423:
            return None
        raise
    return data if data.startswith(b"\x89PNG") else None


def shrink(raw, fit):
    """Вписать объект в fit×fit, сохранив пропорции."""
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    box = im.getbbox()
    if box:
        im = im.crop(box)
    inner = max(2, round(fit * FILL))
    scale = inner / max(im.width, im.height)
    w = max(1, round(im.width * scale))
    h = max(1, round(im.height * scale))
    im = im.resize((w, h), Image.LANCZOS)
    canvas = Image.new("RGBA", (fit, fit), (0, 0, 0, 0))
    canvas.paste(im, ((fit - w) // 2, (fit - h) // 2))
    return canvas


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    only = set()
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1:])
        args = []
    sections = [a for a in args if a in SECTIONS] or list(SECTIONS)

    todo = pending(sections, only)
    if not todo:
        log("нечего генерировать")
        return
    state = load_state()
    log(f"старт: {len(todo)} объектов из секций {', '.join(sections)}")

    done, failed = [], []
    deadline = time.time() + 6 * 3600

    while todo and time.time() < deadline:
        progressed = False

        # добираем очередь до INFLIGHT
        for key, entry, style in todo:
            inflight = sum(1 for k in state if state[k].get("phase") == "wait")
            if inflight >= INFLIGHT:
                break
            st = state.setdefault(key, {"phase": "new"})
            if st["phase"] != "new":
                continue
            oid = create(key, entry, style)
            if oid is False:
                break
            if oid is None:
                st["phase"] = "failed"
                save_state(state)
                failed.append(key)
                progressed = True
                continue
            st.update(phase="wait", oid=oid)
            save_state(state)
            progressed = True
            time.sleep(PACE)  # не упираться в rate limit на каждой второй постановке

        # забираем готовое
        for key, entry, style in list(todo):
            st = state.get(key, {})
            if st.get("phase") == "failed":
                todo.remove((key, entry, style))
                continue
            if st.get("phase") != "wait":
                continue
            raw = download(st["oid"])
            if raw is None:
                continue
            shrink(raw, entry["fit"]).save(os.path.join(TEXDIR, f"{key}.png"))
            st["phase"] = "done"
            save_state(state)
            done.append(key)
            todo.remove((key, entry, style))
            log(f"  = {key}.png {entry['fit']}px  (осталось {len(todo)})")
            progressed = True

        if todo and not progressed:
            time.sleep(15)

    log(f"ИТОГ: готово {len(done)}, провал {len(failed)}, осталось {len(todo)}")
    if failed:
        log("провал: " + ", ".join(failed))
    if todo:
        sys.exit(1)


if __name__ == "__main__":
    main()
