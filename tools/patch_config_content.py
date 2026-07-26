#!/usr/bin/env python3
"""Единый контент-патч: оружие, предметы, враги, элиты, боссы, арены, персонажи.

Идемпотентен, пишет СРАЗУ В ОБЕ КОПИИ конфига — репо-сид и живой в data/
(CLAUDE.md §3.2). Данные лежат отдельно в tools/content_*.py: этот файл только
собирает их, проверяет на связность и записывает.

    tools/patch_config_content.py            показать, что изменится
    tools/patch_config_content.py --apply    записать

Заменяет собой прежний tools/patch_config_m2.py: держать два скрипта, которые
переписывают одни и те же секции, — верный способ получить расхождение.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import content_items
import content_weapons
import content_world

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 3


def patch(cfg):
    changed = []

    weapons = content_weapons.build(round)
    items = content_items.build()
    content_items.validate(items)

    enemies = content_world.build_enemies(cfg["render"]["sprite_default"])
    elites = content_world.build_elites(enemies, cfg["waves"])
    bosses = content_world.build_bosses()
    arenas = content_world.build_arenas(enemies, elites)
    characters = content_world.build_characters(cfg["render"]["sprite_default"])
    achievements = content_world.build_achievements()
    content_world.validate(characters, weapons, arenas, cfg["factions"])

    # Элиты кладутся в enemies рядом с обычными: движок работает с ними одинаково,
    # различает по флагу `elite`. Отдельная секция потребовала бы второй ветки кода.
    all_enemies = dict(enemies)
    all_enemies.update(elites)

    for key, value, label in (
        ("weapons", weapons, f"оружие: {len(weapons)} записей "
                             f"({len(content_weapons.WEAPONS)} семейств × 4 тира)"),
        ("items", items, f"предметы: {len(items)}"),
        ("enemies", all_enemies, f"враги: {len(enemies)} обычных + {len(elites)} элит"),
        ("bosses", bosses, f"боссы: {len(bosses)}"),
        ("arenas", arenas, f"арены: {len(arenas)}"),
        ("characters", characters, f"персонажи: {len(characters)}"),
        ("achievements", achievements, f"ачивки: {len(achievements)}"),
    ):
        if cfg.get(key) != value:
            cfg[key] = value
            changed.append(label)

    if cfg.get("content_version") != CONTENT_VERSION and changed:
        cfg["content_version"] = CONTENT_VERSION
        changed.append(f"content_version → {CONTENT_VERSION}")

    return changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    targets = [REPO] + ([LIVE] if os.path.exists(LIVE) else [])
    for path in targets:
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)
        changed = patch(cfg)
        label = "репо " if path == REPO else "живой"
        if not changed:
            print(f"{label}: уже накачен")
            continue
        print(f"{label}: {len(changed)} изменений")
        for c in changed:
            print("  -", c)
        if a.apply:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
                f.write("\n")

    if not a.apply:
        print("\nчтобы применить: tools/patch_config_content.py --apply")
        return

    with open(REPO, encoding="utf-8") as f:
        cfg = json.load(f)
    nfam, by_class, opened = content_weapons.counts()
    nitems, by_tier, coop_items = content_items.counts()
    print(f"\nитого: {nfam} семейств оружия {by_class}, открыто на старте {opened}")
    print(f"       {nitems} предметов по тирам {by_tier}, кооп-только {coop_items}")
    print(f"       {len(cfg['enemies'])} записей врагов, {len(cfg['bosses'])} боссов, "
          f"{len(cfg['arenas'])} арен, {len(cfg['characters'])} персонажей")


if __name__ == "__main__":
    main()
