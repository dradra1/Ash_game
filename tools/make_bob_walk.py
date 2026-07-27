#!/usr/bin/env python3
"""Сборка walk-листа из idle-листа лёгкой процедурной анимацией «покачивания».

Зачем. pixellab генерирует ходьбу, ПЕРЕРИСОВЫВАЯ персонажа, и на сложных силуэтах
теряет дизайн: у b_rift_father вместо закованного в броню патриарха с раскрытой
грудью выходила мелкая фигура в рясе с голыми ногами, а на «страшной» походке ещё
и с полётом в воздухе. Повороты (rotations) при этом отличные и полностью
совпадают с idle-листом — портит именно шаг анимации.

Здесь ходьба собирается из САМОГО idle-листа: кадры отличаются вертикальным
покачиванием и микро-наклоном. Дизайн не меняется ни на пиксель, а тяжёлому
боссу «переваливающийся» шаг идёт больше, чем перебор ног.

Раскладка листа — из ASSETS.md §5: строки сверху вниз S,E,N,W, сторона кадра
равна высоте/4, число кадров выводится из ширины.

    python3 tools/make_bob_walk.py b_rift_father
    python3 tools/make_bob_walk.py b_rift_father --frames 4 --bob 3
"""
import argparse
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEXDIR = os.path.join(ROOT, "static", "textures")

# Смещения по кадрам как доли от --bob: вверх, вниз, вверх, вниз с полушагом.
# Несимметрично специально — симметричный синус читается как «парит», а не «идёт».
BOB_CYCLE = [0.0, -1.0, 0.0, 0.6]
# Боковой снос: даёт перевалку с ноги на ногу
SWAY_CYCLE = [0.0, 0.35, 0.0, -0.35]


def build(texture, frames, bob, sway):
    src = os.path.join(TEXDIR, f"{texture}.png")
    if not os.path.exists(src):
        raise SystemExit(f"нет idle-листа: {src}")
    idle = Image.open(src).convert("RGBA")
    side = idle.height // 4
    if idle.height % 4 or idle.width != side:
        raise SystemExit(
            f"{texture}.png не похож на idle-лист: {idle.width}x{idle.height}, "
            f"ожидалось квадрат×4 (сторона {side})")

    out = Image.new("RGBA", (side * frames, side * 4), (0, 0, 0, 0))
    for row in range(4):
        cell = idle.crop((0, row * side, side, (row + 1) * side))
        for f in range(frames):
            dy = round(bob * BOB_CYCLE[f % len(BOB_CYCLE)])
            dx = round(sway * SWAY_CYCLE[f % len(SWAY_CYCLE)])
            # Север и юг качаем только по вертикали: в анфас боковой снос читается
            # как рывок вбок, а не как шаг.
            if row in (0, 2):
                dx = 0
            frame = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            frame.paste(cell, (dx, dy))
            out.paste(frame, (f * side, row * side))

    dst = os.path.join(TEXDIR, f"{texture}_walk.png")
    out.save(dst)
    return dst, out.size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("textures", nargs="+")
    ap.add_argument("--frames", type=int, default=4)
    ap.add_argument("--bob", type=float, default=3.0, help="размах качания, пикселей")
    ap.add_argument("--sway", type=float, default=2.0, help="боковой снос, пикселей")
    a = ap.parse_args()
    for tex in a.textures:
        dst, size = build(tex, a.frames, a.bob, a.sway)
        print(f"{dst}  {size[0]}x{size[1]}")


if __name__ == "__main__":
    main()
