#!/usr/bin/env python3
"""Генерация UI-панелей и рамок по промптам из секции `ui` в tools/assets.json.

    python3 tools/gen_ui.py               всё, чего ещё нет в static/ui/
    python3 tools/gen_ui.py --only ui_btn

Кладёт PNG в `static/ui/<id>.png` — не в `static/textures/`: панели адресуются
из CSS, а не по texture-id из конфига, и смешивать их с игровыми спрайтами
значило бы врать реестру ASSETS.md §7.

Состояние в scratch/gen_ui_state.json, прогон возобновляемый. Глифы (`ui_glyphs`)
делает `gen_objects.py` — там уже есть и ужатие, и прозрачный фон.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PXL = os.path.join(ROOT, "tools", "pxl.py")
ASSETS = os.path.join(ROOT, "tools", "assets.json")
STATE = os.path.join(ROOT, "scratch", "gen_ui_state.json")
OUTDIR = os.path.join(ROOT, "static", "ui")
DOWNLOAD = "https://api.pixellab.ai/mcp/ui-assets/{oid}/download"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
INFLIGHT = 3
PACE = 6


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def pxl(*args, timeout=300):
    r = subprocess.run([sys.executable, PXL, *args], capture_output=True, text=True,
                       cwd=ROOT, timeout=timeout)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def load_state():
    if os.path.exists(STATE):
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_state(state):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def pending(only):
    with open(ASSETS, encoding="utf-8") as f:
        ui = json.load(f).get("ui", {})
    out = []
    for key, entry in ui.items():
        if only and key not in only:
            continue
        if os.path.exists(os.path.join(OUTDIR, f"{key}.png")):
            continue
        out.append((key, entry))
    return out


def create(key, entry):
    """-> ui_asset_id | False (сервис занят) | None (ошибка промпта)."""
    payload = {
        "description": entry["description"],
        "width": entry["width"],
        "height": entry["height"],
        "color_palette": entry.get("color_palette"),
        "no_background": True,
        "name": key,
    }
    code, out = pxl("call", "create_ui_asset", json.dumps(payload, ensure_ascii=False))
    low = out.lower()
    if "job slots" in low or "rate limit" in low or "concurrent background jobs" in low:
        return False
    m = UUID.search(out)
    if code != 0 or not m:
        log(f"  ! {key}: {out.strip()[:200]}")
        return None
    log(f"  + {key} ({entry['width']}x{entry['height']}) {m.group(0)}")
    return m.group(0)


def download(oid):
    req = urllib.request.Request(DOWNLOAD.format(oid=oid),
                                 headers={"User-Agent": "curl/8.0"})
    try:
        data = urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError as e:
        # 423 — ещё генерится, 404/410 — панель ещё не выложена или уже протухла.
        # Падать нельзя: один неудачный ответ обрывал весь прогон на середине.
        if e.code in (423, 404, 410):
            return None
        raise
    except urllib.error.URLError:
        return None
    return data if data.startswith(b"\x89PNG") else None


def trim(raw, path):
    """Обрезать прозрачные поля и сохранить.

    Обязательный шаг: pixellab оставляет вокруг панели от 12 до 61 px пустоты,
    причём у каждой свои. Под 9-slice это смертельно — срез задаётся в пикселях
    исходника, и с разными полями одно и то же число режет у одной панели рамку,
    а у другой пустоту.
    """
    from PIL import Image
    import io
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    box = im.getbbox()
    if box:
        im = im.crop(box)
    im.save(path)
    return im.size


def main():
    only = set()
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1:])

    todo = pending(only)
    if not todo:
        log("нечего генерировать")
        return
    os.makedirs(OUTDIR, exist_ok=True)
    state = load_state()
    log(f"старт: {len(todo)} панелей")

    done, failed = [], []
    deadline = time.time() + 3 * 3600

    while todo and time.time() < deadline:
        progressed = False
        for key, entry in todo:
            inflight = sum(1 for k in state if state[k].get("phase") == "wait")
            if inflight >= INFLIGHT:
                break
            st = state.setdefault(key, {"phase": "new"})
            if st["phase"] != "new":
                continue
            oid = create(key, entry)
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
            time.sleep(PACE)

        for key, entry in list(todo):
            st = state.get(key, {})
            if st.get("phase") == "failed":
                todo.remove((key, entry))
                continue
            if st.get("phase") != "wait":
                continue
            raw = download(st["oid"])
            if raw is None:
                continue
            trim(raw, os.path.join(OUTDIR, f"{key}.png"))
            st["phase"] = "done"
            save_state(state)
            done.append(key)
            todo.remove((key, entry))
            log(f"  = {key}.png  (осталось {len(todo)})")
            progressed = True

        if todo and not progressed:
            time.sleep(20)

    log(f"ИТОГ: готово {len(done)}, провал {len(failed)}, осталось {len(todo)}")
    if failed:
        log("провал: " + ", ".join(failed))
    if todo:
        sys.exit(1)


if __name__ == "__main__":
    main()
