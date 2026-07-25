#!/usr/bin/env python3
"""Сборка walk/attack спрайт-листов юнита из backblaze-URL кадров pixellab.

Обходит баг zip-экспорта (v3-анимации по направлениям не попадают в архив).
Источник — прямые URL кадров из get_character (публичный backblaze).

Спека (JSON на stdin или файл):
  {
    "texture_id": "unit_d_slave",
    "account": "293713e8-...",
    "cid": "37389987-...",
    "walk":   {"south": ["uuid", 4], "east": ["uuid", 4], ...},
    "attack": {"south": ["uuid", 6], "east": ["uuid", 6], ...},
    "fit": 48,         # (опц.) нормализовать холст до 48px с заполнением FILL —
                       # нужно для pro-режима, он рисует на холсте вдвое больше
    "fill": 0.68       # (опц.) доля холста под спрайтом, по умолчанию FILL
  }
Кадры каждой анимации нумеруются 0..N-1: .../animations/<uuid>/<dir>/<i>.png
Пишет <texture_id>_walk.png и <texture_id>_attack.png (4 строки S,E,N,W).
"""
import io
import json
import sys
import urllib.request

from PIL import Image

ROWS = ["south", "east", "north", "west"]
BASE = "https://backblaze.pixellab.ai/file/pixellab-characters/{acc}/{cid}/animations/{uuid}/{d}/{i}.png"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
    with urllib.request.urlopen(req) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGBA")


# Доля холста под спрайтом. 0.92, а не 0.68 как в RTS-проекте: там спрайты были 32 px и
# запас под анимацию был нужен, здесь игровой размер 48 и каждый пиксель на счету —
# при 0.68 персонаж занимает ~22 px и силуэт разваливается (проверено на ch_censor).
FILL = 0.92

ROT = "https://backblaze.pixellab.ai/file/pixellab-characters/{acc}/{cid}/rotations/{d}.png"


def crop_to(frames, fit, fill=FILL):
    """Привести все кадры юнита к холсту fit×fit с заполнением fill.

    pro-режим pixellab рисует спрайт на холсте вдвое больше запрошенного размера —
    без нормализации юнит на карте выглядит вдвое мельче соседей. Рамка общая на
    все кадры (idle+walk+attack) и симметрична относительно центра холста, иначе
    анимация начинает дёргаться. fill повторяет заполнение обычных листов
    pixellab (~2/3 холста), чтобы новые спрайты были в масштабе старых.
    """
    side = frames[0].width
    c = side / 2
    half = 1
    for fr in frames:
        box = fr.getbbox()
        if not box:
            continue
        x0, y0, x1, y1 = box
        half = max(half, c - x0, c - y0, x1 - c, y1 - c)
    inner = max(2, round(fit * fill) // 2 * 2)  # чётное — центрируется без сдвига
    box = (int(c - half), int(c - half), int(c + half), int(c + half))
    off = (fit - inner) // 2
    out = []
    for fr in frames:
        canvas = Image.new("RGBA", (fit, fit), (0, 0, 0, 0))
        # LANCZOS, а не NEAREST: при ужатии 124→48 NEAREST выбрасывает опорные пиксели
        # силуэта (маска, ствол, контур), LANCZOS их сохраняет. Сравнение — в истории M0.
        canvas.paste(fr.crop(box).resize((inner, inner), Image.LANCZOS), (off, off))
        out.append(canvas)
    return out


def build(spec, outdir):
    acc, cid = spec["account"], spec["cid"]
    fit = spec.get("fit")
    idle, cells = None, {}

    if spec.get("idle"):
        idle = [fetch(ROT.format(acc=acc, cid=cid, d=d)) for d in ROWS]
    for kind in ("walk", "attack"):
        anim = spec.get(kind)
        if not anim:
            continue
        cells[kind] = {d: [fetch(BASE.format(acc=acc, cid=cid, uuid=anim[d][0], d=d, i=i))
                           for i in range(anim[d][1])] for d in ROWS}

    if fit:  # общая рамка на весь юнит — все листы в одном масштабе
        flat = list(idle or [])
        for per_dir in cells.values():
            for frs in per_dir.values():
                flat += frs
        cropped = crop_to(flat, fit, spec.get("fill", FILL))
        it = iter(cropped)
        if idle:
            idle = [next(it) for _ in idle]
        for per_dir in cells.values():
            for d in ROWS:
                per_dir[d] = [next(it) for _ in per_dir[d]]

    if idle:
        side = idle[0].width
        sheet = Image.new("RGBA", (side, side * 4), (0, 0, 0, 0))
        for r, fr in enumerate(idle):
            if fr.size != (side, side):
                fr = fr.resize((side, side), Image.NEAREST)
            sheet.paste(fr, (0, r * side))
        out = f"{outdir.rstrip('/')}/{spec['texture_id']}.png"
        sheet.save(out)
        print(f"{out}: idle, {side}px")
    for kind, suffix in (("walk", "_walk"), ("attack", "_attack")):
        per_dir = cells.get(kind)
        if not per_dir:
            continue
        cols = max(len(frs) for frs in per_dir.values())
        side = per_dir[ROWS[0]][0].width
        sheet = Image.new("RGBA", (side * cols, side * 4), (0, 0, 0, 0))
        for r, d in enumerate(ROWS):
            for c, fr in enumerate(per_dir[d]):
                if fr.size != (side, side):
                    fr = fr.resize((side, side), Image.NEAREST)
                sheet.paste(fr, (c * side, r * side))
        out = f"{outdir.rstrip('/')}/{spec['texture_id']}{suffix}.png"
        sheet.save(out)
        print(f"{out}: {cols} кадр(ов), {side}px")


if __name__ == "__main__":
    spec = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else json.load(sys.stdin)
    build(spec, spec.get("outdir", "static/textures/"))
