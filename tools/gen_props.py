#!/usr/bin/env python3
"""Генерация препятствий арен (`dc_*`) через create_1_direction_object.

Почему не `create_map_object`, которым сделано всё остальное: он рисует крупные
объекты в ИЗОМЕТРИИ, что бы ни стояло в `view` и в промпте. Первая партия из 12
завалов вышла изометрической целиком, у трёх ещё и с непрозрачным фоном. Это тот
самый случай из ASSETS.md §6 п. 6 — ракурс лечится сменой инструмента, а не третьей
переформулировкой. У `create_1_direction_object` есть `view: "top-down"` (другой
перечень значений!), и он даёт честный вид сверху с первой попытки.

Платим за это генерациями: 20 за объект против 1, зато объект приходит пачкой из
4 кандидатов, и брак виден до установки.

    python3 tools/gen_props.py                      сгенерировать и собрать лист
    python3 tools/gen_props.py --prefix br_         то же для ломаемых объектов
    python3 tools/gen_props.py --install dc_pipe:1 dc_bones:3 ...

Состояние в scratch/gen_props_state.json — прогон возобновляемый.
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
STATE = os.path.join(ROOT, "scratch", "gen_props_state.json")
FRAMES = os.path.join(ROOT, "scratch", "props_frames")
TEXDIR = os.path.join(ROOT, "static", "textures")
SHEET = os.path.join(ROOT, "scratch", "props_candidates.png")

ACCOUNT = "293713e8-6231-46a8-88e7-f4d06fa90282"
FRAME_URL = ("https://backblaze.pixellab.ai/file/pixellab-characters/objects/"
             "{acc}/{oid}/rotations/frame_{i}.png")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

GEN = 128            # 128 → 4 кандидата в одной постановке
NCAND = 4
FILL = 0.92
INFLIGHT = 4
PACE = 5
BG = (13, 15, 20, 255)

# Вид сверху задаётся параметром, поэтому из стилевого блока убран «high top-down
# view» — иначе два указания на ракурс спорят между собой.
STYLE = ("2D pixel art, dark grimdark gothic sci-fi, limited palette, "
         "rust and ash tones, muted and dark, reads on a very dark background")


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def pxl(*args, timeout=300):
    r = subprocess.run([sys.executable, PXL, *args], capture_output=True,
                       text=True, timeout=timeout)
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


def props(prefix="dc_"):
    """Только объёмные объекты: декали плоские и делаются другим инструментом.

    Префикс — потому что тем же путём идут ломаемые `br_*`: инструмент, ракурс и
    приёмка у них те же, отличается только назначение.
    """
    with open(ASSETS, encoding="utf-8") as f:
        world = json.load(f).get("world", {})
    return {k: v for k, v in world.items() if k.startswith(prefix)}


def create(key, entry):
    """-> object_id | False (сервис занят, зайти позже) | None (ошибка промпта)."""
    payload = {
        "description": f"{entry['prompt']}, {STYLE}",
        "view": "top-down",
        "size": entry.get("gen", GEN),
    }
    code, out = pxl("call", "create_1_direction_object",
                    json.dumps(payload, ensure_ascii=False))
    low = out.lower()
    if "job slots" in low or "rate limit" in low or "concurrent background jobs" in low:
        return False
    m = UUID.search(out)
    if code != 0 or not m:
        log(f"  ! {key}: {out.strip()[:200]}")
        return None
    log(f"  + {key} {m.group(0)}")
    return m.group(0)


def fetch_frame(oid, i):
    req = urllib.request.Request(FRAME_URL.format(acc=ACCOUNT, oid=oid, i=i),
                                 headers={"User-Agent": "curl/8.0"})
    try:
        data = urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError:
        return None
    return data if data.startswith(b"\x89PNG") else None


def grab(key, oid):
    """Скачать всех кандидатов. -> True, если объект готов."""
    got = []
    for i in range(NCAND):
        raw = fetch_frame(oid, i)
        if raw is None:
            return False
        got.append((i, raw))
    os.makedirs(FRAMES, exist_ok=True)
    for i, raw in got:
        with open(os.path.join(FRAMES, f"{key}_{i}.png"), "wb") as f:
            f.write(raw)
    return True


def shrink(path, fit):
    """Вписать в fit×fit, сохранив пропорции (ASSETS.md §3: fill 0.92, LANCZOS)."""
    im = Image.open(path).convert("RGBA")
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


def sheet(keys, path=SHEET):
    """Контактный лист «строка = препятствие, столбец = кандидат»."""
    from PIL import ImageDraw
    cell = GEN + 8
    label = 14
    img = Image.new("RGBA", (cell * NCAND + 110, (cell + label) * len(keys)), BG)
    d = ImageDraw.Draw(img)
    for r, key in enumerate(keys):
        y = r * (cell + label)
        d.text((4, y + cell // 2), key, fill=(200, 195, 180))
        for i in range(NCAND):
            p = os.path.join(FRAMES, f"{key}_{i}.png")
            if not os.path.exists(p):
                continue
            im = Image.open(p).convert("RGBA")
            img.alpha_composite(im, (110 + i * cell + 4, y + 4))
            d.text((110 + i * cell + 4, y + cell), str(i), fill=(140, 140, 140))
    img.save(path)
    return img.size


def install(pairs):
    table = {}
    for prefix in ("dc_", "br_"):
        table.update(props(prefix))
    for spec in pairs:
        key, _, idx = spec.partition(":")
        src = os.path.join(FRAMES, f"{key}_{idx}.png")
        if not os.path.exists(src):
            raise SystemExit(f"{key}: нет кандидата {idx}")
        fit = table[key]["fit"]
        shrink(src, fit).save(os.path.join(TEXDIR, f"{key}.png"))
        print(f"{key}_{idx} -> static/textures/{key}.png {fit}px")


def main():
    if "--install" in sys.argv:
        install(sys.argv[sys.argv.index("--install") + 1:])
        return

    prefix = "dc_"
    if "--prefix" in sys.argv:
        prefix = sys.argv[sys.argv.index("--prefix") + 1]
    sheet_path = SHEET if prefix == "dc_" else SHEET.replace(
        "props_candidates", prefix.rstrip("_") + "_candidates")

    table = props(prefix)
    state = load_state()
    todo = [k for k in table if state.get(k, {}).get("phase") != "done"]
    if not todo:
        log(f"все кандидаты скачаны, лист: {sheet(sorted(table), sheet_path)}")
        return
    log(f"старт: {len(todo)} препятствий")

    deadline = time.time() + 3 * 3600
    while todo and time.time() < deadline:
        progressed = False
        for key in list(todo):
            inflight = sum(1 for k in state if state[k].get("phase") == "wait")
            if inflight >= INFLIGHT:
                break
            st = state.setdefault(key, {"phase": "new"})
            if st["phase"] != "new":
                continue
            oid = create(key, table[key])
            if oid is False:
                break
            if oid is None:
                st["phase"] = "failed"
                save_state(state)
                todo.remove(key)
                progressed = True
                continue
            st.update(phase="wait", oid=oid)
            save_state(state)
            progressed = True
            time.sleep(PACE)

        for key in list(todo):
            st = state.get(key, {})
            if st.get("phase") != "wait":
                if st.get("phase") == "failed":
                    todo.remove(key)
                continue
            if grab(key, st["oid"]):
                st["phase"] = "done"
                save_state(state)
                todo.remove(key)
                log(f"  = {key}: {NCAND} кандидатов (осталось {len(todo)})")
                progressed = True

        if todo and not progressed:
            time.sleep(20)

    log(f"кандидаты в {FRAMES}")
    log(f"лист: {sheet_path} {sheet(sorted(table), sheet_path)}")


if __name__ == "__main__":
    main()
