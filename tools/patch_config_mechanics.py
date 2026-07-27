#!/usr/bin/env python3
"""Патч экономики праха и редкости левелапа + админ-вайтлист.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_mechanics.py --apply
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 5

# Расширение steps[3] → steps[5] для редкостей common…legendary
STEPS_MAP = {
    (2, 3, 4): [2, 3, 4, 5, 7],
    (1, 1, 2): [1, 1, 2, 2, 3],
    (1, 2, 2): [1, 1, 2, 2, 3],
    (3, 4, 6): [2, 3, 4, 6, 8],
    (1, 2, 3): [1, 1, 2, 3, 4],
    (3, 4, 5): [2, 3, 4, 5, 7],
    (2, 3, 5): [1, 2, 3, 4, 6],
}

# Выровнять прах у врагов: поздние типы не дают заметно больше за килл
ASH_CAP = {
    "e_cultist": 3, "e_flesh": 3, "e_spitter": 3, "e_hiverat": 2, "e_zealot": 3,
    "e_bomber": 3, "e_censerbearer": 3, "e_scavenger": 2, "e_brute": 3,
    "e_slinger": 3, "e_ashhound": 2, "e_chainganger": 3, "e_scrapthrower": 3,
    "e_husk": 3, "e_drone": 3, "e_swarmlet": 1, "e_warden": 3, "e_hatcher": 3,
}

I18N_RU = {
    "ui.rarity.common": "Обычный",
    "ui.rarity.uncommon": "Необычный",
    "ui.rarity.rare": "Редкий",
    "ui.rarity.epic": "Эпический",
    "ui.rarity.legendary": "Легендарный",
    "ui.pause.restart": "Начать заново",
    "ui.pause.menu": "В главное меню",
    "ui.result.again": "Начать заново",
    "ui.result.menu": "В главное меню",
    "ui.result.flagged": "Результат отмечен проверкой — в таблицу рекордов не попадёт",
    "ui.admin.title": "Админ",
    "ui.admin.save": "Сохранить",
    "ui.admin.saved": "Сохранено",
    "ui.cheat.ash": "+100 праха",
    "ui.cheat.level": "+уровень",
    "ui.cheat.god": "Бессмертие",
    "ui.cheat.kill": "Убить всех",
    "ui.cheat.skip": "Скип волны",
    "ui.cheat.relics": "+1000 реликвий",
    "ui.levelup.queue": "Ещё выборов",
}

I18N_EN = {
    "ui.rarity.common": "Common",
    "ui.rarity.uncommon": "Uncommon",
    "ui.rarity.rare": "Rare",
    "ui.rarity.epic": "Epic",
    "ui.rarity.legendary": "Legendary",
    "ui.pause.restart": "Restart",
    "ui.pause.menu": "Main menu",
    "ui.result.again": "Restart",
    "ui.result.menu": "Main menu",
    "ui.result.flagged": "Result flagged by checks — excluded from the leaderboard",
    "ui.admin.title": "Admin",
    "ui.admin.save": "Save",
    "ui.admin.saved": "Saved",
    "ui.cheat.ash": "+100 ash",
    "ui.cheat.level": "+level",
    "ui.cheat.god": "God mode",
    "ui.cheat.kill": "Kill all",
    "ui.cheat.skip": "Skip wave",
    "ui.cheat.relics": "+1000 relics",
}


def expand_steps(steps):
    key = tuple(steps)
    if key in STEPS_MAP:
        return list(STEPS_MAP[key])
    if len(steps) >= 5:
        return list(steps[:5])
    # Линейная экстраполяция
    out = list(steps)
    while len(out) < 5:
        out.append(out[-1] + max(1, out[-1] - out[-2] if len(out) > 1 else 1))
    return out


def patch(cfg):
    changed = []

    # --- admin whitelist ---
    admin = cfg.setdefault("admin", {})
    wl = list(admin.get("whitelist") or [])
    if "dradra1" not in wl:
        wl.append("dradra1")
        admin["whitelist"] = wl
        changed.append("admin.whitelist += dradra1")

    # --- coop levelup timer ---
    coop = cfg.setdefault("coop", {})
    if coop.get("levelup_timer") != 90:
        coop["levelup_timer"] = 90
        changed.append("coop.levelup_timer → 90")
    if coop.get("levelup_pauses") is not True:
        coop["levelup_pauses"] = True
        changed.append("coop.levelup_pauses → true")

    # --- level rarities ---
    level = cfg.setdefault("level", {})
    rarities = [
        {"id": "common", "weight": 50},
        {"id": "uncommon", "weight": 25},
        {"id": "rare", "weight": 15},
        {"id": "epic", "weight": 7},
        {"id": "legendary", "weight": 3},
    ]
    if level.get("rarities") != rarities:
        level["rarities"] = rarities
        changed.append("level.rarities")
    colors = ["#9aa0a8", "#6a9fc8", "#a86ac8", "#e0a03a", "#e85a3a"]
    if level.get("rarity_colors") != colors:
        level["rarity_colors"] = colors
        changed.append("level.rarity_colors")
    if level.get("luck_rarity_shift") != 0.015:
        level["luck_rarity_shift"] = 0.015
        changed.append("level.luck_rarity_shift")

    pool = level.get("pool") or {}
    for key, entry in pool.items():
        steps = entry.get("steps") or []
        new_steps = expand_steps(steps)
        if steps != new_steps:
            entry["steps"] = new_steps
            changed.append(f"level.pool.{key}.steps")

    # --- ash flatten ---
    enemies = cfg.get("enemies") or {}
    for eid, ash in ASH_CAP.items():
        e = enemies.get(eid)
        if e and e.get("ash") != ash:
            e["ash"] = ash
            changed.append(f"enemies.{eid}.ash → {ash}")

    # Пересчитать элитный прах при elite_ash_mult
    waves = cfg.setdefault("waves", {})
    if waves.get("elite_ash_mult") != 3:
        waves["elite_ash_mult"] = 3
        changed.append("waves.elite_ash_mult → 3")

    for eid, e in enemies.items():
        if not e.get("elite"):
            continue
        base_id = e.get("of")
        base = enemies.get(base_id) if base_id else None
        if base:
            want = base.get("ash", 1) * waves["elite_ash_mult"]
            if e.get("ash") != want:
                e["ash"] = want
                changed.append(f"enemies.{eid}.ash → {want}")

    # --- shop inflation ---
    shop = cfg.setdefault("shop", {})
    if shop.get("inflation_pct") != 0.18:
        shop["inflation_pct"] = 0.18
        changed.append("shop.inflation_pct → 0.18")
    if shop.get("inflation_flat") != 2:
        shop["inflation_flat"] = 2
        changed.append("shop.inflation_flat → 2")

    # --- i18n ---
    i18n = cfg.setdefault("i18n", {})
    ru = i18n.setdefault("ru", {})
    en = i18n.setdefault("en", {})
    for k, v in I18N_RU.items():
        if ru.get(k) != v:
            ru[k] = v
            changed.append(f"i18n.ru.{k}")
    for k, v in I18N_EN.items():
        if en.get(k) != v:
            en[k] = v
            changed.append(f"i18n.en.{k}")

    if changed and cfg.get("content_version") != CONTENT_VERSION:
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
