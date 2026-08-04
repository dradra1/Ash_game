#!/usr/bin/env python3
"""Патч: Ловчий Дом — сюжет, персонажи и заказы.

Кладёт секцию `lodge` (данные строит tools/content_lodge.py — там же и тексты),
отдаёт под здание пустую площадку `wip_a` в городе и доливает подписи i18n.

Здание: `wip_a` был заглушкой «Стройка» с action `{"type": "none"}`. Теперь это
`lodge` с новым типом действия `quests` — он, как и `play`, никогда не бывает
закрытым: сюжет должен быть доступен с первого входа, иначе игрок не узнает,
что он вообще есть. Вторая заглушка `wip_c` остаётся резервом.

Список зданий ведёт tools/patch_config_city.py, поэтому замена wip_a → lodge
внесена и туда — иначе следующий прогон патча города вернул бы стройку на место
(та же история, что с персонажами в patch_config_characters10.py).

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_lodge.py --apply
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import content_lodge

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 55

LODGE_BUILDING = {
    "id": "lodge",
    "texture": "bl_lodge",
    "x": 64, "y": 104, "w": 160, "h": 160,
    "color": "#c8a35a",
    "name": "ui.city.lodge",
    "hint": "ui.city.lodge_hint",
    "action": {"type": "quests"},
}

I18N_RU = {
    "ui.city.lodge": "Ловчий Дом",
    "ui.city.lodge_hint": "Заказы, летопись и награды",

    "ui.lodge.title": "Ловчий Дом",
    "ui.lodge.quests": "Заказы",
    "ui.lodge.lore": "Летопись",
    "ui.lodge.take": "Взять заказ",
    "ui.lodge.claim": "Сдать заказ",
    "ui.lodge.available": "Доступен",
    "ui.lodge.active": "В работе",
    "ui.lodge.ready": "Готов к сдаче",
    "ui.lodge.claimed": "Сдан",
    "ui.lodge.reward": "Награда",
    "ui.lodge.locked": "Закрыт",
    "ui.lodge.locked_by": "Откроется за заказ",
    "ui.lodge.no_quests": "Заказов больше нет. Пока.",
    "ui.lodge.hint": "Поговори с каждым: у них есть работа и есть что рассказать.",

    "ui.error.unknown_quest": "Такого заказа нет",
    "ui.error.quest_not_available": "Заказ ещё не открыт",
    "ui.error.quest_taken": "Заказ уже взят",
    "ui.error.quest_not_done": "Заказ ещё не выполнен",
    "ui.error.quest_claimed": "Заказ уже сдан",

    "ui.result.quest_done": "заказ выполнен",
}

I18N_EN = {
    "ui.city.lodge": "Hunters' Lodge",
    "ui.city.lodge_hint": "Contracts, chronicle and rewards",

    "ui.lodge.title": "Hunters' Lodge",
    "ui.lodge.quests": "Contracts",
    "ui.lodge.lore": "Chronicle",
    "ui.lodge.take": "Take contract",
    "ui.lodge.claim": "Hand in",
    "ui.lodge.available": "Available",
    "ui.lodge.active": "In progress",
    "ui.lodge.ready": "Ready to hand in",
    "ui.lodge.claimed": "Handed in",
    "ui.lodge.reward": "Reward",
    "ui.lodge.locked": "Locked",
    "ui.lodge.locked_by": "Unlocked by contract",
    "ui.lodge.no_quests": "No more contracts. For now.",
    "ui.lodge.hint": "Talk to each of them: they have work, and they have stories.",

    "ui.error.unknown_quest": "No such contract",
    "ui.error.quest_not_available": "Contract not unlocked yet",
    "ui.error.quest_taken": "Contract already taken",
    "ui.error.quest_not_done": "Contract not completed yet",
    "ui.error.quest_claimed": "Contract already handed in",

    "ui.result.quest_done": "contract completed",
}


def patch_buildings(cfg, changed):
    city = cfg.get("city")
    if not isinstance(city, dict):
        return
    buildings = city.get("buildings")
    if not isinstance(buildings, list):
        return
    for i, b in enumerate(buildings):
        if not isinstance(b, dict):
            continue
        if b.get("id") == "lodge":
            if b != LODGE_BUILDING:
                buildings[i] = json.loads(json.dumps(LODGE_BUILDING))
                changed.append("city.buildings: lodge обновлён")
            return
    for i, b in enumerate(buildings):
        if isinstance(b, dict) and b.get("id") == "wip_a":
            buildings[i] = json.loads(json.dumps(LODGE_BUILDING))
            changed.append("city.buildings: wip_a → lodge")
            return
    buildings.insert(0, json.loads(json.dumps(LODGE_BUILDING)))
    changed.append("city.buildings: lodge добавлен")


def patch(cfg):
    changed = []

    content_lodge.validate(cfg)
    lodge = content_lodge.build()
    if cfg.get("lodge") != lodge:
        cfg["lodge"] = lodge
        changed.append("lodge: {} персонажей, {} заказов, {} фрагментов лора".format(
            len(lodge["npcs"]), len(lodge["quests"]), len(lodge["lore"])))

    patch_buildings(cfg, changed)

    i18n = cfg.setdefault("i18n", {})
    for lang, pairs in (("ru", I18N_RU), ("en", I18N_EN)):
        bucket = i18n.setdefault(lang, {})
        for key, val in pairs.items():
            if bucket.get(key) != val:
                bucket[key] = val
                changed.append(f"i18n.{lang}.{key}")

    if changed and cfg.get("content_version", 0) < CONTENT_VERSION:
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
        print(f"=== {path} ===")
        if not changed:
            print("  (без изменений)")
            continue
        for c in changed:
            print(f"  + {c}")
        if a.apply:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
                f.write("\n")
            print("  записано")
        else:
            print("  (dry-run, передай --apply)")


if __name__ == "__main__":
    main()
