#!/usr/bin/env python3
"""Графика экрана «город»: здания, руины, тайлы земли, декор и сборка фона.

    python3 tools/gen_city_assets.py gen                  здания, руины, декор
    python3 tools/gen_city_assets.py gen --only bl_gate bl_forge
    python3 tools/gen_city_assets.py gen --force bl_gate  перерисовать конкретный id
    python3 tools/gen_city_assets.py tiles                земля (create_tiles_pro)
    python3 tools/gen_city_assets.py compose              собрать bg_city.png
    python3 tools/gen_city_assets.py check                размеры и альфа готовых PNG

Полный прогон с нуля: `tiles`, `gen`, `compose` — именно в этом порядке, фону
нужна готовая земля.

Инструмент — `create_image_pixflux`: нужен ОДИН статичный кадр с прозрачным фоном.
`create_character` тут не годится (он делает 4-направленный лист гуманоида),
`create_map_object` рисует в изометрии (см. шапку tools/gen_props.py), а
`create_1_direction_object` стоит 20 генераций за объект — за 24 ассета это 480
генераций вместо 24.

Скрипт идемпотентен: PNG уже лежит в static/textures/ → генерация пропускается,
запрос к pixellab не уходит. Порядок генерации = приоритет из спека: рабочие
здания → тайлы земли → декор → руины → резерв. Если баланс кончится, встанем
на наименее важном.

Pillow берётся из системного python3 (как в tools/gen_props.py) — это инструмент
сборки, а не рантайм-зависимость сервера, в requirements.txt ему не место.
"""
import argparse
import io
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PXL = os.path.join(ROOT, "tools", "pxl.py")
TEXDIR = os.path.join(ROOT, "static", "textures")
STATE = os.path.join(ROOT, "scratch", "gen_city_state.json")
DOWNLOAD = "https://api.pixellab.ai/mcp/images/{jid}/download"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

INFLIGHT = 3          # больше pixellab не держит в фоне без отказа «job slots»
PACE = 4              # пауза между постановками задач, с

# Стилевой блок ASSETS.md §1 — дословно, целиком, в каждом промпте.
STYLE = ("2D pixel art, high top-down view, dark grimdark gothic sci-fi, "
         "limited palette, rust and ash tones, readable silhouette on very dark "
         "background")
OBJECT = "transparent background, single object, centered"

BG_COLOR = (13, 15, 20, 255)   # #0d0f14 — фон арены и города

# Руины пришлось переписывать дважды. И «collapsed <здание>», и «ruined shell of a
# <здание>» модель читает как «<здание>» с прилагательным и рисует целый дом —
# в первой партии половина руин вышла крепче живого оригинала. Работает только
# смена ПОДЛЕЖАЩЕГО: рисуем не здание, а груду камня на его месте, и лишь потом
# поясняем, чем эта груда была. Силуэт при этом обязан угадываться — иначе игрок
# не поймёт, что здесь откроется.
RUIN = ("heap of rubble and broken stone walls where a {what} once stood, "
        "no roof at all, two jagged wall stumps still standing, blackened snapped "
        "timbers scattered across the foundation, empty doorway boarded with "
        "planks, dead weeds in the cracks, abandoned for years, "
        "no light, no fire, no glow, no colour accent, grey ash and soot tones")
# Приписка «soot-blackened very dark stone, darker than the surrounding night»
# в хвосте пробовалась и откатана: модель уводит камень в бледно-голубой и
# заодно возвращает крыши на место. Тон руин правится сборкой, а не промптом.


def asset(body, w, h, alpha=True, seamless=False):
    return {"body": body, "w": w, "h": h, "alpha": alpha, "seamless": seamless}


# --- реестр -----------------------------------------------------------------
# Порядок словаря = порядок генерации = приоритет при нехватке баланса.

BUILDINGS = {
    # Ловчий Дом занял площадку резервного bl_wip_a (patch_config_lodge.py).
    # Доска с листами у двери — единственный опознавательный знак: без неё
    # контора не отличается от таверны, у обеих дверь, фонарь и черепица.
    "bl_lodge": (
        "narrow two-storey gothic guild office of dark timber and grey stone, "
        "steep slate roof, iron-banded door under a hanging lantern with pale "
        "ochre flame, large notice board beside the door thick with nailed paper "
        "sheets and red wax seals, mounted beast skull over the lintel, coiled "
        "chains and traps hanging under the eaves, accent color #c8a35a",
        "narrow two-storey guild office of dark timber and grey stone",
    ),
    "bl_tavern": (
        "squat stone tavern with a sagging tiled roof, iron-banded oak door, "
        "hanging lantern with warm green flame, ale barrels and a bone-carved "
        "signboard by the entrance, smoke curling from a crooked chimney, "
        "accent color #c8a35a",
        "squat stone tavern with a sagging tiled roof",
    ),
    # «racks of blades along the wall» модель поняла как приказ показать стену
    # изнутри и нарисовала комнату без крыши. Отсюда «closed building seen from
    # outside» и печь, вынесенная в фасад.
    "bl_forge": (
        "cramped weaponsmith workshop of blackened brick with a steep tiled roof, "
        "closed building seen from outside, open furnace mouth glowing orange in "
        "the front wall, anvil and quench barrel by the door, riveted iron chimney "
        "venting sparks, accent color #d2652a",
        "weaponsmith workshop of blackened brick with a steep tiled roof",
    ),
    "bl_chapel": (
        "narrow gothic chapel of pale weathered stone, tall arched window of "
        "dark glass, guttering candles on the steps, hanging censers on chains "
        "flanking the door, steep slate roof, accent color #7fb0c8",
        "narrow gothic chapel of pale weathered stone",
    ),
    "bl_crypt": (
        "half-sunken crypt of cracked black stone, rusted iron grate door "
        "hanging open, wax-sealed scrolls nailed to the frame, dead thorn vines "
        "over the roof, faint violet glow from within, accent color #8a5bc8",
        "half-sunken crypt of cracked black stone",
    ),
    # «dark basalt» + жаровня дали фиолетовый камень, и обелиск слился по цвету
    # с криптой (#8a5bc8). Акцент у него костяной, а не лиловый — говорим прямо.
    "bl_obelisk": (
        "tall cracked obelisk of soot-stained weathered grey granite on a stepped "
        "plinth, dense engraved rows of names, chained brazier with a small orange "
        "flame at its base, rusted votive plates leaning against the steps, dark "
        "muted stone, not white, no purple, no violet, accent color #b8b0a0",
        "tall cracked obelisk of weathered grey granite on a stepped plinth",
    ),
    "bl_gate": (
        "heavy fortified city gate of riveted iron and stone, raised portcullis, "
        "twin squat watch towers, torn banners, deep red glow of the wasteland "
        "beyond the archway, accent color #9c2b2b",
        "heavy fortified city gate of riveted iron and stone",
    ),
    # Раздел арен занял площадку резервного здания wip_b: по спеку меню резерву
    # меняют текстуру и action, а место в композиции остаётся прежним.
    "bl_waystation": (
        "squat way-station of dark timber and grey stone, wide arched doorway, "
        "weathered route maps and land charts nailed to the wall beside it, tall "
        "iron signpost with three carved direction arrows, hanging lantern with "
        "pale flame, low slate roof, accent color #5f8f6b",
        "squat way-station of dark timber and grey stone",
    ),
}

# Резерв: место в городе занято, содержимое появится позже. Один общий акцент —
# стройки не должны перетягивать взгляд с шести рабочих зданий. Руин у них нет.
WIP = {
    "bl_wip_a": "unfinished stone building shell in wooden scaffolding, bare roof "
                "rafters, stacked timber and stone blocks at the base, tarpaulin "
                "over one wall, no light inside, accent color #6b6156",
    "bl_wip_c": "stump of a round tower, first two courses of dark stone laid, "
                "wooden crane frame above it, coiled rope and a heap of rubble, "
                "no light inside, accent color #6b6156",
}
# bl_wip_b снят с довольствия: его площадку занял раздел арен (bl_waystation).
# Сам PNG оставлен на диске — пригодится, когда резерв понадобится снова.

# Земля идёт НЕ через create_image_pixflux, а через create_tiles_pro (ASSETS.md
# §6.7) — тем же путём, что пол арен. «seamless tileable texture» в промпте
# одиночной картинки ничего не гарантирует: первая попытка дала полосатый шум,
# который при замощении читался как забор. Обязателен `tile_view: "top-down"`:
# при дефолтном `low top-down` тайл приходит с перспективой и пустой нижней
# третью, то есть это верх стены, а не пол.
#
# `variation` — номер выбранной вариации из 16. Правило выбора — из
# tools/fetch_tiles.py: выигрывает самый НЕЗАМЕТНЫЙ тайл, повтор каждые 32 px
# не должен бросаться в глаза.
TILES = {
    "gr_city_stone": {
        "body": "worn cobblestone pavement slabs, cracked mortar, soot in the "
                "gaps, dark grimdark gothic, limited palette, rust and ash tones, "
                "very dark",
        "variation": 0,
    },
    "gr_city_dirt": {
        "body": "packed grey dirt and ash with scattered gravel, dark grimdark "
                "gothic sci-fi, limited palette, rust and ash tones, very dark",
        "variation": 1,
    },
}

DECOR = {
    "dc_city_wall": ("segment of a high fortress wall of rough dark stone with "
                     "iron ties and a narrow slit window", 64, 96),
    "dc_city_lamp": ("wrought iron street lamp on a post, dirty glass, pale flame "
                     "inside", 32, 64),
    "dc_city_barrel": ("stack of two banded wooden barrels, damp and rotting", 32, 32),
    "dc_city_cart": ("broken handcart with a snapped axle and one missing wheel, "
                     "loaded with scrap iron", 64, 48),
    "dc_city_tree": ("dead leafless tree, black bark, thin bare branches", 48, 64),
    "dc_city_bones": ("small pile of animal bones and a cracked skull in the ash",
                      32, 32),
    "dc_city_banner": ("long tattered cloth banner on an iron pole, faded ochre, "
                       "frayed edges", 32, 64),
}

BUILDING_PX = 160


def registry():
    """id → спека генерации, в порядке приоритета. Тайлы земли сюда не входят:
    у них свой инструмент и свой режим (`tiles`)."""
    out = {}
    for tid, (body, _short) in BUILDINGS.items():
        out[tid] = asset(body, BUILDING_PX, BUILDING_PX)
    for tid, (body, w, h) in DECOR.items():
        out[tid] = asset(body, w, h)
    for tid, (_body, short) in BUILDINGS.items():
        out[tid + "_ruin"] = asset(RUIN.format(what=short), BUILDING_PX, BUILDING_PX)
    for tid, body in WIP.items():
        out[tid] = asset(body, BUILDING_PX, BUILDING_PX)
    return out


# --- сборка фона ------------------------------------------------------------

BG_W, BG_H = 1024, 576
COMPOSE_SEED = 0x21C17          # фон обязан собираться одинаково при каждом прогоне

# ЗЕРКАЛО КОНФИГА: это те же координаты, что в city.buildings[].x/y секции `city`
# (tools/patch_config_city.py). Здесь они нужны только чтобы не завалить площадки
# декором — в конфиг из этого файла ничего не уходит. Правишь там — правь и тут.
PADS = [
    (64, 104), (248, 104), (432, 104), (616, 104), (800, 104),
    (64, 336), (248, 336), (432, 336), (616, 336),
]
PAD_W = PAD_H = BUILDING_PX

WALL_W, WALL_H = 64, 96

# Декор: (texture-id, x, y) — левый верхний угол в координатах фона. Это данные
# сборки, а не контента: в конфиг они не идут и коду недоступны.
#
# Свободного места ровно две полосы — между рядами зданий (y 264…336) и под нижним
# рядом (y 496…576). Всё остальное занято площадками и стеной, поэтому координаты
# подобраны так, чтобы hits_pad() ничего не отбрасывал.
DECOR_PLACES = [
    # полоса между рядами
    ("dc_city_banner", 64, 268),
    ("dc_city_lamp", 112, 268),
    ("dc_city_barrel", 200, 284),
    ("dc_city_barrel", 232, 296),
    ("dc_city_tree", 288, 268),
    ("dc_city_cart", 384, 276),
    ("dc_city_lamp", 496, 268),
    ("dc_city_bones", 592, 292),
    ("dc_city_tree", 688, 268),
    ("dc_city_banner", 800, 268),
    ("dc_city_lamp", 880, 268),
    # полоса под нижним рядом — дорога к вратам
    ("dc_city_tree", 96, 504),
    ("dc_city_lamp", 160, 504),
    ("dc_city_cart", 264, 512),
    ("dc_city_banner", 352, 504),
    ("dc_city_barrel", 400, 528),
    ("dc_city_barrel", 432, 536),
    ("dc_city_bones", 528, 532),
    ("dc_city_bones", 616, 528),
    ("dc_city_cart", 704, 512),
    ("dc_city_lamp", 832, 504),
    ("dc_city_tree", 896, 504),
]

# Пятна грунта поверх мостовой: (x, y, w, h) в тайлах 32×32.
DIRT_PATCHES = [
    (2, 9, 6, 4), (12, 8, 5, 5), (21, 9, 6, 4),
    (7, 14, 4, 3), (17, 15, 5, 3), (26, 13, 4, 4),
    (5, 3, 3, 2), (24, 3, 3, 2),
]


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def pxl(*args, timeout=300):
    r = subprocess.run([sys.executable, PXL, *args], capture_output=True,
                       text=True, cwd=ROOT, timeout=timeout)
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


def prompt_of(spec):
    parts = [spec["body"], STYLE]
    if spec["alpha"]:
        parts.insert(1, OBJECT)
    return ", ".join(parts)


def submit(tid, spec):
    """-> job_id | False (заняты слоты, повторить) | None (ошибка промпта)."""
    payload = {
        "description": prompt_of(spec),
        "width": spec["w"],
        "height": spec["h"],
        "no_background": bool(spec["alpha"]),
        "view": "high top-down",
    }
    code, out = pxl("call", "create_image_pixflux",
                    json.dumps(payload, ensure_ascii=False))
    low = out.lower()
    if "job slots" in low or "rate limit" in low or "concurrent" in low:
        return False
    m = UUID.search(out)
    if code != 0 or not m:
        log(f"  ! {tid}: {out.strip()[:200]}")
        return None
    log(f"  + {tid} {spec['w']}x{spec['h']} → {m.group(0)}")
    return m.group(0)


def poll(jid):
    """-> 'done' | 'wait' | 'fail'."""
    code, out = pxl("call", "get_image", json.dumps({"job_id": jid}))
    low = out.lower()
    if code != 0:
        return "fail"
    if "status: completed" in low:
        return "done"
    if "processing" in low or "pending" in low or "queued" in low:
        return "wait"
    return "fail"


def download(jid):
    req = urllib.request.Request(DOWNLOAD.format(jid=jid),
                                 headers={"User-Agent": "curl/8.0"})
    try:
        data = urllib.request.urlopen(req, timeout=90).read()
    except (urllib.error.HTTPError, urllib.error.URLError):
        return None
    return data if data.startswith(b"\x89PNG") else None


def store(tid, spec, raw):
    """Сохранить ровно в заявленном размере и с нужным альфа-режимом."""
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    if im.size != (spec["w"], spec["h"]):
        # NEAREST и ничего кроме: пиксель-арт интерполировать нельзя.
        im = im.resize((spec["w"], spec["h"]), Image.NEAREST)
    if not spec["alpha"]:
        flat = Image.new("RGBA", im.size, BG_COLOR)
        flat.alpha_composite(im)
        im = flat.convert("RGB")
    path = os.path.join(TEXDIR, tid + ".png")
    im.save(path)
    return path


def cmd_tiles(args):
    """Земля через create_tiles_pro: джоб отдаёт 16 вариаций, ставим выбранную.

    Скачиванием и превью швов занимается tools/fetch_tiles.py — он для этого и
    написан, второй такой же код здесь не нужен.
    """
    from fetch_tiles import COUNT  # noqa: F401  — проверка, что модуль на месте
    outroot = os.path.join(ROOT, "scratch", "city_tiles")
    state = load_state()
    rc = 0
    for tid, spec in TILES.items():
        if args.only and tid not in args.only:
            continue
        if os.path.exists(os.path.join(TEXDIR, tid + ".png")) and tid not in args.force:
            log(f"  = {tid} уже на месте")
            continue
        payload = {
            "description": spec["body"],
            "tile_type": "square_topdown",
            "tile_size": 32,
            "tile_view": "top-down",
        }
        code, out = pxl("call", "create_tiles_pro",
                        json.dumps(payload, ensure_ascii=False))
        m = UUID.search(out)
        if code != 0 or not m:
            log(f"  ! {tid}: {out.strip()[:200]}")
            rc = 1
            continue
        job = m.group(0)
        state[tid] = job
        save_state(state)
        log(f"  + {tid} → {job}, ждём набор")

        deadline = time.time() + 900
        status = ""
        while time.time() < deadline:
            _, got = pxl("call", "get_tiles_pro", json.dumps({"tile_id": job}))
            low = got.lower()
            if "status: completed" in low:
                status = "done"
                break
            if "status: failed" in low:
                status = "failed"
                break
            time.sleep(8)
        if status != "done":
            # Инференс tiles_pro отдаёт 502 заметно чаще одиночных картинок:
            # два из трёх наборов мостовой упали именно так. Лечится повтором.
            log(f"  ! {tid}: набор не собрался ({status or 'таймаут'}) — повтори")
            rc = 1
            continue

        outdir = os.path.join(outroot, tid)
        r = subprocess.run(
            [sys.executable, os.path.join(ROOT, "tools", "fetch_tiles.py"), job,
             outdir, "--pick", str(spec["variation"]), "--as", tid],
            capture_output=True, text=True, cwd=ROOT, timeout=600)
        print((r.stdout or "") + (r.stderr or ""), end="")
        if r.returncode != 0:
            rc = 1
        else:
            log(f"  ✓ {tid} ← вариация {spec['variation']}")
    return rc


def cmd_gen(args):
    reg = registry()
    todo = []
    for tid, spec in reg.items():
        if args.only and tid not in args.only:
            continue
        if os.path.exists(os.path.join(TEXDIR, tid + ".png")) and tid not in args.force:
            continue
        todo.append((tid, spec))
    if not todo:
        log("нечего генерировать — все PNG на месте")
        return 0

    os.makedirs(TEXDIR, exist_ok=True)
    state = load_state()
    log(f"старт: {len(todo)} ассетов (≈{len(todo)} генераций)")

    queue = list(todo)
    active = {}                      # job_id → (tid, spec)
    done, failed = [], []
    deadline = time.time() + args.timeout

    while (queue or active) and time.time() < deadline:
        while queue and len(active) < INFLIGHT:
            tid, spec = queue[0]
            jid = submit(tid, spec)
            if jid is False:
                break                # слоты заняты — подождём круг опроса
            queue.pop(0)
            if jid is None:
                failed.append(tid)
                continue
            active[jid] = (tid, spec)
            state[tid] = jid
            save_state(state)
            time.sleep(PACE)

        if not active:
            if queue:
                time.sleep(PACE)
                continue
            break

        time.sleep(PACE)
        for jid in list(active):
            tid, spec = active[jid]
            st = poll(jid)
            if st == "wait":
                continue
            del active[jid]
            if st == "fail":
                log(f"  ! {tid}: джоб не дошёл до completed")
                failed.append(tid)
                continue
            raw = download(jid)
            if raw is None:
                log(f"  ! {tid}: не скачался")
                failed.append(tid)
                continue
            path = store(tid, spec, raw)
            log(f"  ✓ {tid} → {os.path.relpath(path, ROOT)}")
            done.append(tid)

    log(f"готово: {len(done)}, ошибок: {len(failed)}"
        + (f" ({', '.join(failed)})" if failed else ""))
    if queue:
        log(f"не дошли (таймаут): {', '.join(t for t, _ in queue)}")
    return 1 if failed or queue else 0


# --- compose ----------------------------------------------------------------

def load_tex(tid, required=True):
    path = os.path.join(TEXDIR, tid + ".png")
    if not os.path.exists(path):
        if required:
            sys.exit(f"нет {os.path.relpath(path, ROOT)} — сначала прогони `gen`")
        return None
    return Image.open(path).convert("RGBA")


def tile_fill(canvas, tex, x0, y0, x1, y1):
    tw, th = tex.size
    y = y0
    while y < y1:
        x = x0
        while x < x1:
            canvas.alpha_composite(tex, (x, y))
            x += tw
        y += th


def hits_pad(x, y, w, h):
    for px, py in PADS:
        if x < px + PAD_W and px < x + w and y < py + PAD_H and py < y + h:
            return True
    return False


def vignette(canvas, depth=0.85, band=96):
    """Затемнение к #0d0f14 по краям: верхняя панель города (реликвии слева,
    выход справа) обязана читаться поверх фона."""
    px = canvas.load()
    r, g, b, _ = BG_COLOR
    for y in range(BG_H):
        dy = min(y, BG_H - 1 - y)
        for x in range(BG_W):
            d = min(x, BG_W - 1 - x, dy)
            if d >= band:
                continue
            k = depth * (1.0 - d / band) ** 2
            cr, cg, cb, ca = px[x, y]
            px[x, y] = (int(cr + (r - cr) * k), int(cg + (g - cg) * k),
                        int(cb + (b - cb) * k), ca)


def cmd_compose(args):
    stone = load_tex("gr_city_stone")
    dirt = load_tex("gr_city_dirt")
    wall = load_tex("dc_city_wall")

    canvas = Image.new("RGBA", (BG_W, BG_H), BG_COLOR)
    tile_fill(canvas, stone, 0, 0, BG_W, BG_H)

    for tx, ty, tw, th in DIRT_PATCHES:
        tile_fill(canvas, dirt, tx * 32, ty * 32, (tx + tw) * 32, (ty + th) * 32)

    # Стена: верхний край и обе боковины. Ставится ДО декора — декор лепится к ней.
    # Каждый второй сегмент зеркалится: шестнадцать одинаковых секций подряд
    # читались как обои, а отражение ломает ритм бесплатно и без второго ассета.
    wall_flip = wall.transpose(Image.FLIP_LEFT_RIGHT)
    for i, x in enumerate(range(0, BG_W, WALL_W)):
        canvas.alpha_composite(wall if i % 2 == 0 else wall_flip, (x, 0))
    for i, y in enumerate(range(WALL_H, BG_H, WALL_H)):
        canvas.alpha_composite(wall if i % 2 == 0 else wall_flip, (0, y))
        canvas.alpha_composite(wall_flip if i % 2 == 0 else wall, (BG_W - WALL_W, y))

    rng = random.Random(COMPOSE_SEED)
    skipped = []
    for tid, x, y in DECOR_PLACES:
        tex = load_tex(tid, required=False)
        if tex is None:
            skipped.append(tid)
            continue
        w, h = tex.size
        if hits_pad(x, y, w, h):
            skipped.append(f"{tid}@{x},{y} (площадка)")
            continue
        canvas.alpha_composite(tex, (x, y))

    # rng тратится на мелкую сажу поверх мостовой: пятна должны быть, но
    # выписывать их руками — сотня лишних строк координат. Сид фиксирован, так что
    # фон собирается побайтово одинаково при каждом прогоне.
    px = canvas.load()
    for _ in range(140):
        x = rng.randrange(0, BG_W)
        y = rng.randrange(WALL_H, BG_H)
        if hits_pad(x, y, 3, 3):
            continue
        cr, cg, cb, ca = px[x, y]
        px[x, y] = (max(0, cr - 18), max(0, cg - 18), max(0, cb - 16), ca)

    vignette(canvas)

    out = os.path.join(TEXDIR, "bg_city.png")
    canvas.convert("RGB").save(out)
    log(f"собран {os.path.relpath(out, ROOT)} — {canvas.size[0]}x{canvas.size[1]}")
    if skipped:
        log("пропущено: " + ", ".join(skipped))
    return 0


def cmd_check(args):
    reg = registry()
    for tid in TILES:
        reg[tid] = asset("", 32, 32, alpha=False, seamless=True)
    bad = 0
    for tid, spec in reg.items():
        path = os.path.join(TEXDIR, tid + ".png")
        if not os.path.exists(path):
            print(f"{tid:22s} — НЕТ ФАЙЛА")
            bad += 1
            continue
        im = Image.open(path)
        size_ok = im.size == (spec["w"], spec["h"])
        has_a = im.mode == "RGBA" and im.getchannel("A").getextrema()[0] < 255
        alpha_ok = has_a if spec["alpha"] else True
        mark = "ok " if size_ok and alpha_ok else "BAD"
        print(f"{tid:22s} {mark} {im.size[0]}x{im.size[1]} {im.mode}"
              f" alpha={'yes' if has_a else 'no'}")
        if not (size_ok and alpha_ok):
            bad += 1
    bg = os.path.join(TEXDIR, "bg_city.png")
    if os.path.exists(bg):
        im = Image.open(bg)
        ok = im.size == (BG_W, BG_H)
        print(f"{'bg_city':22s} {'ok ' if ok else 'BAD'} {im.size[0]}x{im.size[1]} {im.mode}")
        if not ok:
            bad += 1
    else:
        print(f"{'bg_city':22s} — НЕТ ФАЙЛА")
        bad += 1
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("gen")
    p.add_argument("--only", nargs="*", default=[])
    p.add_argument("--force", nargs="*", default=[])
    p.add_argument("--timeout", type=int, default=3 * 3600)

    p = sub.add_parser("tiles")
    p.add_argument("--only", nargs="*", default=[])
    p.add_argument("--force", nargs="*", default=[])

    sub.add_parser("compose")
    sub.add_parser("check")

    a = ap.parse_args()
    if a.cmd == "gen":
        return cmd_gen(a)
    if a.cmd == "tiles":
        return cmd_tiles(a)
    if a.cmd == "compose":
        return cmd_compose(a)
    return cmd_check(a)


if __name__ == "__main__":
    sys.exit(main())
