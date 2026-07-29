#!/usr/bin/env python3
"""Патч: синергии оружия — бонусы за 2/4/6 одетых стволов одного класса.

Что меняется в правилах боя. Каждое оружие имеет класс (`class`: melee, ranged,
elem, engi). За 2, 4 и 6 стволов ОДНОГО класса в слотах игрок получает бонусы;
пороги кумулятивны (6 = бонусы 2+4+6). Каждый слот считается за штуку, включая
дубликаты одного id до слияния; после слияния двух стволов в один счёт падает —
это осознанно, как в Brotato.

За 2 и 4 — статовые прибавки (имена обязаны существовать в `stats.order`; они
складываются в `synergy.mods` и участвуют в resolveStats наравне с предметами).
За 6 — «интересное», статом не выразимое, поэтому это ссылка на запись в
`specials`: числа оттуда читает код боя (sim/weapon.js, sim/turret.js):

  melee_sweep   — удары ближнего оружия дальше (range_mult) и шире (arc_mult);
  extra_shot    — дальнее оружие выпускает +shots снарядов за выстрел;
  extra_pierce  — стихийные снаряды пробивают +pierce целей;
  extra_turret  — каждый инженерный ствол ставит +turrets установок сверх
                  engineering.copies (пул: 8 игроков × 6 слотов × (3+1) = 192
                  при max_turrets = 200 — влезает).

Почему ручкой в конфиге, а не в коде. Пороги, бонусы и числа спецов — правила
контента и баланса: CLAUDE.md §3.1 запрещает держать их в коде. Выключатель
`enabled` возвращает прежнее поведение целиком.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_synergies.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 52

SYNERGIES = {
    # Механика целиком. false — никаких бонусов, ветка в коде одна и та же.
    "enabled": True,
    # Порядок классов здесь — порядок строк панели «Синергии» в лавке.
    # Пороги кумулятивны: за 6 действуют бонусы 2, 4 и 6 одновременно.
    "classes": {
        "melee": {
            "2": {"melee_dmg": 3},
            "4": {"attack_speed_pct": 8},
            "6": {"special": "melee_sweep"},
        },
        "ranged": {
            "2": {"ranged_dmg": 3},
            "4": {"damage_pct": 6},
            "6": {"special": "extra_shot"},
        },
        "elem": {
            "2": {"elem_dmg": 4},
            "4": {"crit_pct": 10},
            "6": {"special": "extra_pierce"},
        },
        "engi": {
            "2": {"engineering": 4},
            "4": {"engineering": 8},
            "6": {"special": "extra_turret"},
        },
    },
    # Бонусы шестого порога: статом не выразить, числа читает код боя.
    "specials": {
        "melee_sweep": {"range_mult": 1.4, "arc_mult": 1.3},
        "extra_shot": {"shots": 1, "spread": 10},
        "extra_pierce": {"pierce": 1},
        "extra_turret": {"turrets": 1},
    },
}

I18N = {
    "ru": {
        "ui.shop.synergies": "Синергии",
        "ui.synergy.special.melee_sweep":
            "Веер ударов: +40% дальности и +30% ширины дуги ближнего оружия",
        "ui.synergy.special.extra_shot":
            "Дальнее оружие выпускает +1 снаряд за выстрел",
        "ui.synergy.special.extra_pierce":
            "Стихийные снаряды пробивают +1 цель",
        "ui.synergy.special.extra_turret":
            "Каждый инженерный ствол ставит +1 установку",
    },
    "en": {
        "ui.shop.synergies": "Synergies",
        "ui.synergy.special.melee_sweep":
            "Sweeping blows: +40% range and +30% arc width for melee weapons",
        "ui.synergy.special.extra_shot":
            "Ranged weapons fire +1 projectile per shot",
        "ui.synergy.special.extra_pierce":
            "Elemental projectiles pierce +1 target",
        "ui.synergy.special.extra_turret":
            "Each engineering weapon deploys +1 turret",
    },
}


def patch(cfg):
    changed = []

    syn = cfg.setdefault("synergies", {})
    for k, v in SYNERGIES.items():
        if syn.get(k) != v:
            changed.append(f"synergies.{k}: {syn.get(k)!r} → {v!r}")
            syn[k] = v

    for lang, strings in I18N.items():
        d = cfg.setdefault("i18n", {}).setdefault(lang, {})
        for k, v in strings.items():
            if d.get(k) != v:
                changed.append(f"i18n.{lang}.{k}: {d.get(k)!r} → {v!r}")
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
