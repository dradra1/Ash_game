#!/usr/bin/env python3
"""Патч: всё получение реликвий ×1.6 и админский чит на реликвии.

**Множитель.** `meta.relic_formula.gain_mult` — одна ручка на всё начисление:
`meta.award_relics` умножает на неё итог формулы, `meta.first_clear_bonus` — разовый
бонус за первое прохождение. Правкой per_wave/win/per_boss по отдельности это делать
нельзя: бонус за первый клир живёт в другом ключе, и «всё получение» оказалось бы не
всем. Базовые числа при этом остаются читаемыми, а следующее «а давай ещё ×N» —
правка одной строки.

  было (сложность 0, соло, победа на 20-й волне): 3*20 + 25 + 8*боссы
  стало: то же ×1.6

**Чит.** `meta.cheat_relics` — сколько насыпает `POST /api/admin/relics`. Число живёт
на сервере, потому что реликвии начисляет сервер (ТЗ §3.10): в теле запроса сумма не
принимается, иначе кнопка «+1000» стала бы кнопкой «+сколько угодно».

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_meta_gain.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 42

GAIN_MULT = 1.6
CHEAT_RELICS = 1000

TEXTS = {
    "ru": {
        "ui.cheat.relics": f"+{CHEAT_RELICS} реликвий",
        "ui.error.cheat_relics": "Реликвии не начислились",
    },
    "en": {
        "ui.cheat.relics": f"+{CHEAT_RELICS} relics",
        "ui.error.cheat_relics": "Could not grant relics",
    },
}


def patch(cfg):
    changed = []

    meta = cfg.setdefault("meta", {})
    formula = meta.setdefault("relic_formula", {})
    if formula.get("gain_mult") != GAIN_MULT:
        formula["gain_mult"] = GAIN_MULT
        changed.append(f"meta.relic_formula.gain_mult = {GAIN_MULT}")
    if meta.get("cheat_relics") != CHEAT_RELICS:
        meta["cheat_relics"] = CHEAT_RELICS
        changed.append(f"meta.cheat_relics = {CHEAT_RELICS}")

    i18n = cfg.setdefault("i18n", {})
    for lang, pairs in TEXTS.items():
        d = i18n.setdefault(lang, {})
        for k, v in pairs.items():
            if d.get(k) != v:
                d[k] = v
                changed.append(f"i18n.{lang}.{k}")

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
