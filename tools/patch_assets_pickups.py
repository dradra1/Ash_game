#!/usr/bin/env python3
"""Идемпотентно дописывает в tools/assets.json промпты пикапов (`pk_*`).

Пикап — это то, что лежит на полу и подбирается. До сих пор дроп праха рисовался
жёлтым кружком через `renderer.drawDot`: спрайта у пикапа не было вовсе, в
структуре `makePickup()` нет даже поля текстуры.

Живут в секции `world` рядом с завалами `dc_*` и ломаемыми `br_*` — инструмент и
ракурс те же (вид строго сверху), отличается назначение.

Размер `fit` — 16, ровно как `render.ash_size` в конфиге: `drawObject` рисует
картинку в натуральную величину, а `imageSmoothingEnabled=false` (CLAUDE.md §4)
превращает ужатие на канвасе в кашу. Кучка мелкая, поэтому силуэт важнее детали:
на 16 пикселях посреди боя читается только пятно нужного цвета и формы.

    tools/patch_assets_pickups.py --apply
    python3 tools/gen_objects.py --only pk_ash
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "tools", "assets.json")

PICKUPS = {
    "pk_ash": {
        "tool": "create_map_object",
        "gen": 64,
        "fit": 16,
        "view": "high top-down",
        "prompt": (
            "a small low conical heap of fine yellow ochre ash poured on dark "
            "ground, warm golden yellow grains, a few brighter specks catching "
            "the light near the top, loose scattered flecks around the base, "
            "no container, no vessel, seen from directly above"
        ),
    },
}


def patch(assets):
    world = assets.setdefault("world", {})
    changed = []
    for key, entry in PICKUPS.items():
        if world.get(key) != entry:
            world[key] = json.loads(json.dumps(entry))
            changed.append(key)
    return changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    with open(ASSETS, encoding="utf-8") as f:
        assets = json.load(f)
    changed = patch(assets)
    print(f"=== {ASSETS} ===")
    if not changed:
        print("  (без изменений)")
        return
    for c in changed:
        print(f"  + world.{c}")
    if a.apply:
        with open(ASSETS, "w", encoding="utf-8") as f:
            json.dump(assets, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("  записано")
    else:
        print("  (dry-run, передай --apply)")


if __name__ == "__main__":
    main()
