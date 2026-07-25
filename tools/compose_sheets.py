#!/usr/bin/env python3
"""Сборка спрайт-листов юнита из zip-архива персонажа pixellab.

Конвенция (см. ASSETS.md, drawUnitSprite в client.js):
  <texture>.png        — idle, 4 строки × 1 кадр
  <texture>_walk.png   — 4 строки × N кадров
  <texture>_attack.png — 4 строки × M кадров
Строки сверху вниз: S, E, N, W. Кадры квадратные (сторона = высота листа / 4).

Структура zip: <name>/rotations/<dir>.png,
               <name>/animations/<slug>/<dir>/frame_NNN.png

Использование:
  compose_sheets.py <character.zip> <texture_id> <outdir> [--walk SLUG] [--attack SLUG]

Без --walk/--attack слаги ищутся сами: «walk» в имени → _walk, остальное → _attack.
"""
import argparse
import io
import re
import sys
import zipfile

from PIL import Image

ROWS = ["south", "east", "north", "west"]


def load(zf, name):
    return Image.open(io.BytesIO(zf.read(name))).convert("RGBA")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zip")
    ap.add_argument("texture_id")
    ap.add_argument("outdir")
    ap.add_argument("--walk")
    ap.add_argument("--attack")
    args = ap.parse_args()

    zf = zipfile.ZipFile(args.zip)
    names = zf.namelist()

    rotations = {}
    for n in names:
        m = re.search(r"rotations/(\w[\w-]*)\.png$", n)
        if m:
            rotations[m.group(1)] = n

    anims = {}  # slug -> {dir -> [frame paths sorted]}
    for n in names:
        m = re.search(r"animations/([^/]+)/([^/]+)/frame_(\d+)\.png$", n)
        if m:
            anims.setdefault(m.group(1), {}).setdefault(m.group(2), []).append(n)
    for dirs in anims.values():
        for frames in dirs.values():
            frames.sort()

    walk = args.walk or next((s for s in anims if "walk" in s.lower()), None)
    attack = args.attack or next((s for s in anims if s != walk), None)

    missing = [d for d in ROWS if d not in rotations]
    if missing:
        sys.exit(f"нет ротаций: {missing}; есть {sorted(rotations)}")

    side = load(zf, rotations["south"]).width

    def sheet(frame_names_by_row, out_name):
        cols = max(len(v) for v in frame_names_by_row.values())
        img = Image.new("RGBA", (side * cols, side * 4), (0, 0, 0, 0))
        for r, d in enumerate(ROWS):
            for c, fn in enumerate(frame_names_by_row[d]):
                fr = load(zf, fn)
                if fr.size != (side, side):
                    fr = fr.resize((side, side), Image.NEAREST)
                img.paste(fr, (c * side, r * side))
        img.save(f"{args.outdir.rstrip('/')}/{out_name}")
        print(f"{out_name}: {cols} кадр(ов), {side}px")

    sheet({d: [rotations[d]] for d in ROWS}, f"{args.texture_id}.png")

    for slug, suffix in ((walk, "_walk"), (attack, "_attack")):
        if not slug:
            print(f"пропуск {suffix}: анимация не найдена ({sorted(anims)})")
            continue
        dirs = anims[slug]
        miss = [d for d in ROWS if d not in dirs]
        if miss:
            print(f"пропуск {suffix} ({slug}): нет направлений {miss}")
            continue
        sheet(dirs, f"{args.texture_id}{suffix}.png")


if __name__ == "__main__":
    main()
