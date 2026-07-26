#!/usr/bin/env python3
"""Идемпотентно дописывает в tools/assets.json секцию `world`: препятствия и декали арен.

Генерация — `python3 tools/gen_objects.py world` (тот же пайплайн, что у оружия
и предметов: create_map_object → скачивание → ужатие до игрового размера).

Два правила, из которых собраны промпты:

1. **Препятствие должно читаться как препятствие, а не как декорация.** Игрок
   узнаёт, что сюда не пройти, за доли секунды и боковым зрением. Поэтому у всех
   завалов сплошная тёмная масса в центре и рваный контур — силуэт «куча», а не
   «предмет». Размер коллайдера в конфиге меньше спрайта: у завала есть пола,
   по которой ходят.

2. **Низкий профиль.** Y-сортировки в рендере нет и не будет (не по бюджету),
   препятствия рисуются под сущностями. Высокая башня, сквозь которую просвечивает
   игрок, выглядела бы сломанной, а груда обломков — нет.

Декали плоские: они запекаются в холст пола и не имеют ни коллизии, ни объёма.
Им нужен низкий контраст — это пятно на полу, а не объект на нём.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "tools", "assets.json")

# fit — игровой размер, он же `size` в config.arenas.<id>.props. Генерация вдвое
# крупнее и ужимается (ASSETS.md §3).
PROPS = {
    "dc_pipe": (96, "a tangled heap of burst industrial pipes and broken conduit, rusted iron, torn insulation wrap, dark sludge pooling between them, seen from above as a low impassable pile"),
    "dc_girder": (88, "a collapsed roof girder snapped in two, buckled steel beam half buried in rubble and broken masonry, seen from above as a low impassable heap"),
    "dc_container": (104, "a crushed cargo container lying on its side, dented ribbed steel walls, peeling paint, spilled crates jammed underneath, seen from above as a low solid block"),
    "dc_vent": (64, "a squat rusted ventilation stack with a bent grille cowl and soot-blackened mouth, bolted to a low concrete base, seen from above"),
    "dc_bones": (96, "a heaped drift of huge pale weathered bones, cracked ribs and long limb bones tangled together and half sunk in grey ash, seen from above as a low impassable mound"),
    "dc_wreck": (112, "the broken nose section of a crashed flying machine, torn dark hull plating, snapped ribs of the frame, buried at an angle in ash, seen from above as a low solid mass"),
    "dc_scrap": (80, "a heap of rusted scrap metal, crumpled sheet plate, coiled wire and torn machine parts welded into a low mound by rust, seen from above"),
    "dc_rock": (72, "a cluster of jagged dark volcanic rock outcrops pushing up through grey ash, sharp angular facets, seen from above as a low impassable clump"),
    "dc_hull": (112, "a torn section of a ship hull lying on the deck, dark tarnished metal plating, exposed frame ribs, verdigris streaks in the seams, seen from above as a low solid mass"),
    "dc_monolith": (80, "a squat toppled stone marker slab, dark engraved surface with worn carved lines and dim green glow in the grooves, cracked base, seen from above"),
    "dc_cradle": (96, "a heavy dark metal cargo cradle frame, thick angled struts and clamp arms, empty and half collapsed, seen from above as a low impassable frame"),
    "dc_slabs": (80, "a fallen stack of dark engraved stone slabs, tumbled and cracked apart, faint teal patina in the carved lines, seen from above as a low pile"),
}

# Декаль — плоское пятно. Формулировка важнее всего: на «scorch mark» и «stencil
# markings» модель уверенно рисует СИМВОЛ (красную вспышку, оранжевый треугольник),
# а не грязь на полу. Работает только «пятно/налёт вещества такого-то цвета» плюс
# прямой запрет свечения — светящаяся декаль на тёмном полу кричит громче боссов.
FLAT = ("a completely flat stain lying on the ground, NO HEIGHT, NO VOLUME, NO SHADOW, "
        "NO GLOW, NO LIGHT, NO SYMBOL, NO ICON, not an object, seen straight from "
        "directly above, soft irregular ragged edges, very low contrast, desaturated, dark")
DECALS = {
    "dcl_oil": (64, f"a spilled patch of near-black oil soaked into the floor, {FLAT}"),
    "dcl_soot": (56, f"a smudged patch of black soot and grey ash ground into the floor, {FLAT}"),
    "dcl_paint": (48, f"a worn patch where dull ochre paint has flaked away to bare grey metal, blotchy and uneven, {FLAT}"),
    "dcl_burn": (64, f"a patch of blackened scorched ground fading to grey ash at the ragged edges, {FLAT}"),
    "dcl_drift": (72, f"a thin patch of dark grey ash dusted unevenly over the ground, barely visible, {FLAT}"),
    "dcl_crack": (56, f"a patch of dry ground split by thin dark hairline cracks, cracks are DARK GREY, unlit, no lava, no molten rock, {FLAT}"),
    "dcl_rune": (64, f"a patch of worn carved lines scratched into the floor, dull unlit grey-green grooves, {FLAT}"),
    "dcl_verdigris": (56, f"a dull desaturated grey-green patch of corrosion crusted on metal, muted and dark, {FLAT}"),
    "dcl_scorch": (56, f"a sooty grey-black smear radiating outward in uneven streaks, {FLAT}"),
}


def entry(fit, prompt, gen, flat=False):
    e = {
        "tool": "create_map_object",
        "gen": gen,
        "fit": fit,
        "view": "high top-down",
        "prompt": prompt,
    }
    if flat:
        # Пятно на полу: контур и объёмный шейдинг делают из него наклейку
        e["outline"] = "lineless"
        e["shading"] = "flat shading"
        e["detail"] = "low detail"
    return e


def main():
    with open(PATH, encoding="utf-8") as f:
        data = json.load(f)

    world = data.setdefault("world", {})
    changed = 0
    for key, (fit, prompt) in PROPS.items():
        # Генерация вдвое крупнее игрового размера, но не больше 400 (лимит API)
        want = entry(fit, prompt, min(400, fit * 2))
        if world.get(key) != want:
            world[key] = want
            changed += 1
    for key, (fit, prompt) in DECALS.items():
        want = entry(fit, prompt, min(400, fit * 2), flat=True)
        if world.get(key) != want:
            world[key] = want
            changed += 1

    if not changed:
        print("уже применено")
        return
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{PATH}: записано {changed} записей, всего в world {len(world)}")


if __name__ == "__main__":
    main()
