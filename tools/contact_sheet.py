#!/usr/bin/env python3
"""Контактный лист для визуальной приёмки партии ассетов.

Кладёт спрайты на фон арены (#0d0f14) с подписями, чтобы можно было посмотреть партию
целиком и сравнить силуэты. Без этого шага партия не считается принятой (ASSETS.md §6).

    tools/contact_sheet.py static/textures/ch_*.png -o scratch/sheet.png --scale 3
    tools/contact_sheet.py static/textures/ch_*.png -o scratch/mob.png --game-size 32

--game-size: дополнительно ужать каждый спрайт до игрового размера перед показом —
так проверяется читаемость силуэта в бою, а не в увеличении.
"""
import argparse
import os

from PIL import Image, ImageDraw

BG = (13, 15, 20, 255)  # #0d0f14 — фон арены
LABEL = (170, 165, 150, 255)
GRID = (32, 36, 44, 255)


def is_sheet(path, img):
    """Лист или одиночная иконка.

    По одному размеру не отличить: квадрат 32×32 формально сходится за лист 4×4,
    и иконка оружия превращалась в свой левый верхний уголок. Признак листа —
    либо суффикс анимации в имени, либо высота ровно вчетверо больше ширины (idle).
    """
    name = os.path.basename(path)
    if "_walk" in name or "_attack" in name:
        return True
    return img.height == img.width * 4


def load(path, game_size):
    img = Image.open(path).convert("RGBA")
    if is_sheet(path, img):
        side = img.height // 4
        cols = max(1, img.width // side)
        if cols > 1:  # это лист анимации — берём первый кадр каждого направления
            strip = Image.new("RGBA", (side, side * 4), (0, 0, 0, 0))
            for r in range(4):
                strip.paste(img.crop((0, r * side, side, (r + 1) * side)), (0, r * side))
            img = strip
    if game_size:
        w, h = img.size
        rows = 4 if h == w * 4 else 1
        k = game_size / (h / rows)
        img = img.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("-o", "--out", default="scratch/contact_sheet.png")
    ap.add_argument("--scale", type=int, default=3, help="увеличение при показе")
    ap.add_argument("--game-size", type=int, default=0, help="ужать до игрового размера")
    ap.add_argument("--cols", type=int, default=0)
    a = ap.parse_args()

    tiles = []
    for path in a.files:
        if not os.path.exists(path):
            continue
        tiles.append((os.path.splitext(os.path.basename(path))[0], load(path, a.game_size)))
    if not tiles:
        raise SystemExit("нет файлов")

    cw = max(t.width for _, t in tiles) * a.scale
    ch = max(t.height for _, t in tiles) * a.scale
    pad, label_h = 10, 14
    cols = a.cols or min(8, len(tiles))
    rows = (len(tiles) + cols - 1) // cols
    W = cols * (cw + pad) + pad
    H = rows * (ch + pad + label_h) + pad

    sheet = Image.new("RGBA", (W, H), BG)
    d = ImageDraw.Draw(sheet)
    for i, (name, img) in enumerate(tiles):
        c, r = i % cols, i // cols
        x = pad + c * (cw + pad)
        y = pad + r * (ch + pad + label_h)
        d.rectangle([x - 1, y - 1, x + cw, y + ch], outline=GRID)
        big = img.resize((img.width * a.scale, img.height * a.scale), Image.NEAREST)
        sheet.alpha_composite(big, (x + (cw - big.width) // 2, y + (ch - big.height) // 2))
        d.text((x, y + ch + 2), name, fill=LABEL)

    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    sheet.save(a.out)
    print(f"{a.out}: {len(tiles)} шт., {W}×{H}")


if __name__ == "__main__":
    main()
