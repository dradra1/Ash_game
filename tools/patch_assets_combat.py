#!/usr/bin/env python3
"""Идемпотентно дописывает в tools/assets.json боевые ассеты: следы удара и снаряды.

Генерация — `python3 tools/gen_objects.py fx projectiles`.

**Следы удара** (`fx_*`) рисуются lineless и почти белыми. Причины обе прикладные:
обводка у полупрозрачного следа даёт видимый контур «наклейки», а цвет клиент
приглушает через globalAlpha — тёмный след на тёмном полу не читался бы вовсе.
След показывает СЕКТОР удара, поэтому он шире клинка (render.fx_scale = 1.7).

**Снаряды**: 18 стреляющих семейств делили 12 спрайтов — `p_slug` на четверых,
`p_beam` на троих. Шесть недостающих дорисованы, чтобы в бою было видно, чей
выстрел летит. Боковая проекция, летят ВПРАВО: клиент вращает спрайт по вектору
скорости (shape.spin = heading).
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "tools", "assets.json")

TRAIL = ("a motion trail of a weapon swing, pale bone-white with a faint ochre core, "
         "fading to nothing at the thin end, NO WEAPON, NO BLADE, NO HAND, no object, "
         "just the streak of light left in the air, flat, clean edges, on transparent background")

FX = {
    "fx_slash": (64, f"a single narrow crescent arc sweeping left to right, thick at the middle and tapering to points at both ends, {TRAIL}"),
    "fx_slash_wide": (72, f"a broad wide crescent arc covering almost a half circle, sweeping and tapering at both ends, {TRAIL}"),
    "fx_thrust": (64, f"a straight sharp streak pointing right, widest at the left and narrowing to a point at the right, {TRAIL}"),
    "fx_lash": (72, f"a long thin S-curved whip trail snapping through the air, {TRAIL}"),
    "fx_claw": (64, f"three parallel curved slash marks side by side, like a claw rake, {TRAIL}"),
    "fx_impact": (64, f"an expanding shockwave ring with short radial spikes bursting outward from the centre, {TRAIL}"),
}

# Снаряд летит вправо; 16 px в игре, генерация 32 (как у уже готовых p_*).
PROJECTILES = {
    "p_bolt": "a short bright energy bolt flying to the right, glowing pale blue core with a hot white tip and a faint tail",
    "p_grape": "a single small round lead shotgun pellet in flight, dull grey metal sphere with a highlight",
    "p_shard": "a jagged torn scrap metal fragment tumbling in flight, rusty edges, irregular shape",
    "p_shell": "a heavy blunt autocannon shell in flight pointing right, thick brass casing with a dark steel nose",
    "p_needle": "a very thin translucent glass needle flying point-first to the right, pale and slender",
    "p_rivet": "a short thick steel rivet flying head-first to the right, blunt cylindrical body, dull metal",
}


def main():
    with open(PATH, encoding="utf-8") as f:
        data = json.load(f)

    changed = 0
    fx = data.setdefault("fx", {})
    for key, (fit, prompt) in FX.items():
        want = {
            "tool": "create_map_object",
            "gen": fit * 2,
            "fit": fit,
            "view": "high top-down",
            "outline": "lineless",
            "shading": "flat shading",
            "detail": "low detail",
            "prompt": prompt,
        }
        if fx.get(key) != want:
            fx[key] = want
            changed += 1

    proj = data.setdefault("projectiles", {})
    for key, prompt in PROJECTILES.items():
        want = {
            "tool": "create_map_object",
            "gen": 32,
            "fit": 16,
            "view": "side",
            "prompt": prompt,
        }
        if proj.get(key) != want:
            proj[key] = want
            changed += 1

    if not changed:
        print("уже применено")
        return
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{PATH}: записано {changed} записей (fx {len(fx)}, projectiles {len(proj)})")


if __name__ == "__main__":
    main()
