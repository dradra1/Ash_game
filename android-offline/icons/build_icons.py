#!/usr/bin/env python3
"""Иконки APK из фирменной метки игры.

Источник один — `static/favicon.svg`, та же плита с жаровней, что стоит во
вкладке браузера. Держать рядом вторую копию арта незачем: разъедутся. SVG в
этом файле — не векторная графика, а пиксель-арт 32×32, выложенный прямоугольниками
по целым координатам, поэтому парсится напрямую и растеризуется точь-в-точь.

Всё масштабирование — NEAREST: пиксель-арт нельзя сглаживать (CLAUDE.md §4,
ASSETS.md §5).

    python3 build_icons.py

Пишет в ../app/src/main/res. Запускать после правки favicon.svg.
"""
import os
import re

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(os.path.dirname(HERE))
SVG = os.path.join(PROJECT, "static", "favicon.svg")
RES = os.path.join(HERE, "..", "app", "src", "main", "res")

DENSITIES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}

SRC_SIZE = 32          # сетка favicon.svg
FRAME = 5              # толщина рамки-обоймы в пикселях исходника (линии 2–4 и 27–29)
RIVET = 2              # заклёпка в углу обоймы, пикселей исходника
LAUNCHER_DP = 48       # обычная иконка запуска
ADAPTIVE_DP = 108      # холст адаптивной иконки
ADAPTIVE_SAFE = 66     # видимая зона внутри неё (система режет углы маской)
SPLASH_DP = 108        # splash-логотип: система тоже режет его по кругу

# Фон плиты в favicon.svg. На переднем слое адаптивной иконки он лишний —
# там должна остаться только жаровня, а подложку рисует ic_launcher_background.
PLATE_BG = (13, 15, 20)


def rasterize(path):
    """favicon.svg → Image 32×32. Понимает ровно то подмножество, которым он написан."""
    svg = open(path, encoding="utf-8").read()
    im = Image.new("RGBA", (SRC_SIZE, SRC_SIZE), (0, 0, 0, 0))
    px = im.load()
    for m in re.finditer(r"<rect([^>]*)/>", svg):
        attrs = m.group(1)

        def attr(name, default="0"):
            found = re.search(name + r'="([^"]+)"', attrs)
            return found.group(1) if found else default

        fill = attr("fill", "none")
        if fill == "none":
            continue
        x, y = int(attr("x")), int(attr("y"))
        w, h = int(attr("width")), int(attr("height"))
        c = fill.lstrip("#")
        rgb = (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), 255)
        for yy in range(y, min(SRC_SIZE, y + h)):
            for xx in range(x, min(SRC_SIZE, x + w)):
                px[xx, yy] = rgb
    return im


def inner(mark):
    """Содержимое без рамки, фон плиты — в прозрачность."""
    im = mark.crop((FRAME, FRAME, SRC_SIZE - FRAME, SRC_SIZE - FRAME)).convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a and (r, g, b) == PLATE_BG:
                px[x, y] = (0, 0, 0, 0)
    # Заклёпки по углам обоймы: часть рамки, а не жаровни. В плите они держат
    # композицию, на прозрачном фоне остаются четырьмя случайными точками.
    for cx in (0, im.width - RIVET):
        for cy in (0, im.height - RIVET):
            for y in range(cy, cy + RIVET):
                for x in range(cx, cx + RIVET):
                    px[x, y] = (0, 0, 0, 0)
    return im


def silhouette(im, threshold=40):
    """Белый силуэт по альфе — для monochrome-слоя адаптивной иконки."""
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    src, dst = im.load(), out.load()
    for y in range(im.height):
        for x in range(im.width):
            if src[x, y][3] > threshold:
                dst[x, y] = (255, 255, 255, 255)
    return out


def write(im, folder, name):
    d = os.path.join(RES, folder)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, name + ".png")
    im.save(path)
    print(f"  {folder}/{name}.png {im.size[0]}×{im.size[1]}")


def emit_scaled(im, prefix, name, dp):
    """Одна картинка во все плотности, размер задан в dp."""
    for density, k in DENSITIES.items():
        size = int(round(dp * k))
        write(im.resize((size, size), Image.NEAREST), f"{prefix}-{density}", name)


def emit_padded(content, prefix, name, canvas_dp, content_dp):
    """Содержимое по центру холста большего размера (адаптивная иконка, splash)."""
    for density, k in DENSITIES.items():
        canvas = int(round(canvas_dp * k))
        inner_px = int(round(content_dp * k))
        # Целочисленный масштаб исходника: 24 px арта в 66 dp влезают ×2, ×4, …
        scale = max(1, inner_px // content.width)
        art = content.resize((content.width * scale, content.height * scale), Image.NEAREST)
        im = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
        im.paste(art, ((canvas - art.width) // 2, (canvas - art.height) // 2), art)
        write(im, f"{prefix}-{density}", name)


ADAPTIVE_XML = """<?xml version="1.0" encoding="utf-8"?>
<!-- Сгенерировано icons/build_icons.py — руками не править. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_mono" />
</adaptive-icon>
"""


def emit_adaptive_xml():
    d = os.path.join(RES, "mipmap-anydpi-v26")
    os.makedirs(d, exist_ok=True)
    for name in ("ic_launcher", "ic_launcher_round"):
        path = os.path.join(d, name + ".xml")
        with open(path, "w", encoding="utf-8") as f:
            f.write(ADAPTIVE_XML)
        print(f"  mipmap-anydpi-v26/{name}.xml")


def main():
    if not os.path.exists(SVG):
        raise SystemExit(f"нет источника: {SVG}")
    mark = rasterize(SVG)
    core = inner(mark)

    print("иконка запуска (плита целиком):")
    emit_scaled(mark, "mipmap", "ic_launcher", LAUNCHER_DP)
    emit_scaled(mark, "mipmap", "ic_launcher_round", LAUNCHER_DP)

    print("адаптивная иконка (жаровня без рамки):")
    emit_padded(core, "mipmap", "ic_launcher_foreground", ADAPTIVE_DP, ADAPTIVE_SAFE)
    emit_padded(silhouette(core), "drawable", "ic_launcher_mono", ADAPTIVE_DP, ADAPTIVE_SAFE)
    emit_adaptive_xml()

    print("splash-логотип:")
    emit_padded(core, "drawable", "ic_splash_logo", SPLASH_DP, ADAPTIVE_SAFE)


if __name__ == "__main__":
    main()
