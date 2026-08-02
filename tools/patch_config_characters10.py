#!/usr/bin/env python3
"""Десять персонажей с особенностями лоадаута + тексты к ним.

Особенности читает static/js/sim/unique.js: число слотов, счёт синергий,
ассортимент и цены лавки, запрет дубликатов, слияние. Сами записи персонажей
берутся из tools/content_world.py — источника правды, чтобы следующий прогон
patch_config_content.py их не откатил.

    .venv/bin/python tools/patch_config_characters10.py            dry-run
    .venv/bin/python tools/patch_config_characters10.py --apply    записать в обе копии
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import content_world  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 54

NEW_CHARACTERS = [
    "ch_oathkeeper", "ch_junkbaron", "ch_calibrator", "ch_swarmcarrier",
    "ch_riftbound", "ch_manyfaced", "ch_reliquary", "ch_barrowsmith",
    "ch_discordant", "ch_twinsoul",
]

I18N = {
    "ru": {
        "ui.select.unique": "Особенность",
        "ui.shop.no_duplicates": "Двух одинаковых носить нельзя",
        "ui.unique.single_oath":
            "Один слот оружия. Ствол в нём считается за шесть в своих сетах — все "
            "синергии открыты сразу. Покупка заменяет прежнее оружие с возвратом праха.",
        "ui.unique.many_slots":
            "Десять слотов оружия, но лавка торгует только тирами 1–2.",
        "ui.unique.tag_lock":
            "Лавка предлагает только огнестрел, зато пороги синергий срабатывают "
            "на 1/3/5 вместо 2/4/6.",
        "ui.unique.class_lock":
            "Лавка предлагает только ближнее оружие. Каждый одетый ствол даёт "
            "+4% скорости атаки и +3% урона.",
        "ui.unique.few_heavy":
            "Три слота оружия, но каждый ствол считается в синергиях за два.",
        "ui.unique.distinct_tags":
            "+5% урона и +3% скорости за каждый разный тег оружия в лоадауте. "
            "Одинаковые теги не складываются.",
        "ui.unique.synergy_memory_seals":
            "Пять слотов. Проданное и слитое оружие остаётся печатью и продолжает "
            "считаться в синергиях — до восьми печатей.",
        "ui.unique.high_tier":
            "Четыре слота. Лавка торгует тирами на два выше положенного по волне, "
            "но оружие дороже на 70%.",
        "ui.unique.no_twins":
            "Двух одинаковых стволов носить нельзя, слияние недоступно. Зато любой "
            "сет, в котором есть хоть один ствол, работает на шестом пороге.",
        "ui.unique.paired_buy":
            "Каждая покупка оружия кладёт бесплатную вторую копию в свободный слот. "
            "Слияние недоступно: пару не разорвать.",
    },
    "en": {
        "ui.select.unique": "Trait",
        "ui.shop.no_duplicates": "No two identical weapons",
        "ui.unique.single_oath":
            "One weapon slot. That weapon counts as six in its own sets — every "
            "synergy is open at once. A purchase replaces it and refunds the ash.",
        "ui.unique.many_slots":
            "Ten weapon slots, but the shop only sells tiers 1–2.",
        "ui.unique.tag_lock":
            "The shop offers guns only, but synergy thresholds trigger at 1/3/5 "
            "instead of 2/4/6.",
        "ui.unique.class_lock":
            "The shop offers melee weapons only. Each equipped weapon grants "
            "+4% attack speed and +3% damage.",
        "ui.unique.few_heavy":
            "Three weapon slots, but each weapon counts twice in synergies.",
        "ui.unique.distinct_tags":
            "+5% damage and +3% speed per distinct weapon tag in the loadout. "
            "Repeated tags add nothing.",
        "ui.unique.synergy_memory_seals":
            "Five slots. Sold and merged weapons leave a seal and keep counting "
            "towards synergies — up to eight seals.",
        "ui.unique.high_tier":
            "Four slots. The shop sells two tiers above the wave, but weapons "
            "cost 70% more.",
        "ui.unique.no_twins":
            "No two identical weapons, no merging. In exchange every set holding "
            "at least one weapon works at the sixth threshold.",
        "ui.unique.paired_buy":
            "Every weapon purchase drops a free second copy into a free slot. "
            "Merging is unavailable: the pair stays whole.",
    },
}


def patch(cfg):
    changed = []

    # Персонажи собираются генератором целиком, берём из него только новых:
    # трогать существующие записи этот патч не должен.
    built = content_world.build_characters(cfg["render"]["sprite_default"])
    content_world.validate(built, cfg["weapons"], cfg["arenas"], cfg["factions"])
    chars = cfg.setdefault("characters", {})
    for cid in NEW_CHARACTERS:
        entry = built[cid]
        if chars.get(cid) != entry:
            action = "обновлён" if cid in chars else "добавлен"
            changed.append(f"characters.{cid}: {action} ({entry['name']})")
            chars[cid] = entry

    # Залётные +99 HP у Артифекса: след теста админки (tests/py/test_admin.py),
    # который однажды отработал по живому конфигу. В content_world.py их нет.
    art = chars.get("ch_artificer")
    if art and art.get("stats") != built["ch_artificer"]["stats"]:
        changed.append(f"characters.ch_artificer.stats: {art['stats']!r} → "
                       f"{built['ch_artificer']['stats']!r}")
        art["stats"] = built["ch_artificer"]["stats"]

    for lang, strings in I18N.items():
        d = cfg.setdefault("i18n", {}).setdefault(lang, {})
        for k, v in strings.items():
            if d.get(k) != v:
                changed.append(f"i18n.{lang}.{k}")
                d[k] = v

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
