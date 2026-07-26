#!/usr/bin/env python3
"""Скачивание вариаций tiles-pro и превью швов для приёмки пола арены.

create_tiles_pro отдаёт 16 вариаций за джоб, и выбирать надо не по одной картинке,
а по тому, как тайл выглядит замощённым: одиночный тайл почти всегда смотрится
нормально, а швы и повтор видны только на сетке.

    python3 tools/fetch_tiles.py <tile_id> <outdir>
    python3 tools/fetch_tiles.py <tile_id> <outdir> --pick 12 --as gr_hive_a

`--pick N --as <texture_id>` кладёт выбранную вариацию сразу в static/textures.

Найдено на первой партии: выигрывает не самый красивый тайл, а самый **незаметный**.
Тайл с узнаваемыми метками при замощении читается как обои — повтор бьёт в глаза
каждые 32 px. Пол должен давать фактуру и не спорить со спрайтами (ASSETS.md §1:
всё читается на очень тёмном).
"""
import argparse
import io
import os
import urllib.error
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEXDIR = os.path.join(ROOT, "static", "textures")
ACCOUNT = "293713e8-6231-46a8-88e7-f4d06fa90282"
URL = ("https://backblaze.pixellab.ai/file/pixellab-tiles/"
       "{acc}/{tid}/tile_{i}.png")
COUNT = 16


def fetch(tid, i):
    req = urllib.request.Request(URL.format(acc=ACCOUNT, tid=tid, i=i),
                                 headers={"User-Agent": "curl/8.0"})
    try:
        return Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=60).read()))
    except urllib.error.HTTPError:
        return None


def seam_preview(tiles, path, reps=3, scale=3, cols=8):
    """Каждую вариацию — замощённой reps×reps: только так видно швы и повтор."""
    side = tiles[0][1].width
    cell = side * reps * scale
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell, rows * cell), (13, 15, 20, 255))
    for n, (_, im) in enumerate(tiles):
        patch = Image.new("RGBA", (side * reps, side * reps))
        for y in range(reps):
            for x in range(reps):
                patch.paste(im, (x * side, y * side))
        sheet.paste(patch.resize((cell, cell), Image.NEAREST),
                    ((n % cols) * cell, (n // cols) * cell))
    sheet.save(path)
    return sheet.size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tile_id")
    ap.add_argument("outdir")
    ap.add_argument("--pick", type=int, help="номер вариации")
    ap.add_argument("--as", dest="texture_id", help="texture-id для static/textures")
    a = ap.parse_args()

    os.makedirs(a.outdir, exist_ok=True)
    tiles = []
    for i in range(COUNT):
        im = fetch(a.tile_id, i)
        if im is None:
            continue
        im = im.convert("RGBA")
        im.save(os.path.join(a.outdir, f"tile_{i}.png"))
        tiles.append((i, im))
    if not tiles:
        raise SystemExit("ни одной вариации не скачалось: набор ещё не готов?")
    print(f"скачано {len(tiles)} вариаций, {tiles[0][1].width}px")

    prev = os.path.join(a.outdir, "seams.png")
    print(f"превью швов: {prev} {seam_preview(tiles, prev)}")

    if a.pick is not None:
        if not a.texture_id:
            raise SystemExit("--pick без --as: не знаю, под каким texture-id сохранять")
        src = os.path.join(a.outdir, f"tile_{a.pick}.png")
        if not os.path.exists(src):
            raise SystemExit(f"вариации {a.pick} нет среди скачанных")
        dst = os.path.join(TEXDIR, f"{a.texture_id}.png")
        Image.open(src).convert("RGBA").save(dst)
        print(f"выбрано: tile_{a.pick} → {dst}")


if __name__ == "__main__":
    main()
