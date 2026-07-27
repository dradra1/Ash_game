#!/usr/bin/env python3
"""Идемпотентно дописывает в tools/assets.json промпты ломаемых объектов (`br_*`).

Ломаемые живут в секции `world` рядом с завалами `dc_*`: инструмент и ракурс у них
те же (вид строго сверху), отличается только назначение — эти разбиваются.

Размер `fit` — 32, ровно как `sprite` в config.breakables. Текстура рисуется
пиксель-в-пиксель: 48 или 64 пришлось бы ужимать уже на канвасе, а
`imageSmoothingEnabled=false` (CLAUDE.md §4) превращает такое ужатие в кашу.

    tools/patch_assets_breakables.py --apply
    tools/gen_props.py --prefix br_          сгенерировать кандидатов
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "tools", "assets.json")

# Силуэт важнее детали: объект видно 32 пикселями посреди боя, и игрок должен с
# одного взгляда понять, что разбить ради лечения, а что — ради залпа в кучу.
# Отсюда контрастные формы: приземистый ящик, высокая урна, шар на цепи, шип.
BREAKABLES = {
    "br_reliquary": {
        "tool": "create_1_direction_object",
        "gen": 128,
        "fit": 32,
        "view": "top-down",
        "prompt": (
            "a small squat brass reliquary casket with a cracked hinged lid, "
            "warm golden light leaking out through the crack, wax seals and "
            "torn paper strips stuck to the tarnished sides, standing on a low "
            "stone step, seen from directly above"
        ),
    },
    "br_ash_urn": {
        "tool": "create_1_direction_object",
        "gen": 128,
        "fit": 32,
        "view": "top-down",
        "prompt": (
            "a tall narrow grey stone funerary urn with a chipped rim, heaped "
            "pale ash spilling over the lip, soot stains down the belly, iron "
            "band around the neck, seen from directly above"
        ),
    },
    "br_censer": {
        "tool": "create_1_direction_object",
        "gen": 128,
        "fit": 32,
        "view": "top-down",
        "prompt": (
            "a heavy round pierced brass incense burner hanging from a short "
            "chain over a low tripod, pale blue smoke curling out of the "
            "perforations, glowing embers visible inside, seen from directly above"
        ),
    },
    "br_lodestone": {
        "tool": "create_1_direction_object",
        "gen": 128,
        "fit": 32,
        "view": "top-down",
        "prompt": (
            "a jagged violet crystal shard driven into a rusted iron socket, "
            "purple glow along the fractures, bent nails and scrap metal stuck "
            "to it as if pulled in, seen from directly above"
        ),
    },
}


def patch(assets):
    world = assets.setdefault("world", {})
    changed = []
    for key, entry in BREAKABLES.items():
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
