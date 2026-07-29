#!/usr/bin/env python3
"""Патч: теговые синергии — бонусы за 2/4/6 стволов с общим ТЕГОМ оружия.

Дополняет классовые синергии (`tools/patch_config_synergies.py`). У каждого
оружия кроме класса есть 1–3 тега (`tags`: precise, heavy, spread, gun, blade,
warp, primitive, construct, blunt, holy), и ствол участвует сразу во всех своих
сетах: класс + каждый тег. Счёт и пороги — те же правила: каждый слот за штуку,
дубликаты считаются, пороги кумулятивны.

Темы сетов (все числа — здесь, код оперирует ключами):

  precise    крит: за 6 — НОВЫЙ спец crit_boost, криты бьют в mult раз сильнее
             (пер-игрока множитель поверх stats.crit_mult, sim/weapon.js);
  heavy      урон и отброс, за 6 — процентный отброс (knockback_pct умножает
             stats.knockback штатным механизмом resolveStats);
  spread     веер: за 6 — +1 снаряд (тот же extra_shot; теперь он действует на
             ЛЮБОЕ стреляющее оружие, не только класс ranged — у spread есть и
             стихийные стволы);
  gun        дальность и темп огня, чисто статами;
  blade      темп и уклонение, за 6 — тот же веер ударов, что у melee;
  warp       дальность и стихийный урон, за 6 — то же пробитие, что у elem;
  primitive  дешёвое, но крепкое: здоровье, броня, регенерация;
  construct  постройки, за 6 — та же +1 установка; construct ⊂ engi, поэтому
             полный сет даёт +2 установки на ствол — и пул раздувается:
             8 игроков × 6 слотов × (3+2) = 240, поэтому max_turrets 200 → 264;
  blunt      дробящее: отброс и броня;
  holy       регенерация и вампиризм.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_synergy_tags.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 53

TAG_SYNERGIES = {
    # Порядок тегов здесь — порядок строк в панели «Синергии» под классами.
    "precise": {
        "2": {"crit_pct": 5},
        "4": {"crit_pct": 10},
        "6": {"special": "crit_boost"},
    },
    "heavy": {
        "2": {"knockback": 6},
        "4": {"damage_pct": 8},
        "6": {"damage_pct": 12, "knockback_pct": 50},
    },
    "spread": {
        "2": {"attack_speed_pct": 5},
        "4": {"range": 10},
        "6": {"special": "extra_shot"},
    },
    "gun": {
        "2": {"range": 8},
        "4": {"attack_speed_pct": 8},
        "6": {"range": 20, "attack_speed_pct": 10},
    },
    "blade": {
        "2": {"attack_speed_pct": 4},
        "4": {"dodge_pct": 5},
        "6": {"special": "melee_sweep"},
    },
    "warp": {
        "2": {"range": 6},
        "4": {"elem_dmg": 8},
        "6": {"special": "extra_pierce"},
    },
    "primitive": {
        "2": {"max_hp": 8},
        "4": {"armor": 4},
        "6": {"max_hp": 16, "hp_regen": 1},
    },
    "construct": {
        "2": {"engineering": 4},
        "4": {"engineering": 6},
        "6": {"special": "extra_turret"},
    },
    "blunt": {
        "2": {"knockback": 5},
        "4": {"armor": 6},
        "6": {"knockback_pct": 50, "armor": 8},
    },
    "holy": {
        "2": {"hp_regen": 1},
        "4": {"lifesteal_pct": 8},
        "6": {"hp_regen": 2, "lifesteal_pct": 12},
    },
}

NEW_SPECIALS = {
    # Пер-игрока множитель урона крита поверх config.stats.crit_mult.
    "crit_boost": {"mult": 1.5},
}

# construct даёт вторую лишнюю установку на ствол поверх engi-сета:
# 8 игроков × 6 слотов × (3 + 2) = 240, плюс запас под deploy_copies.
MAX_TURRETS = 264

I18N = {
    "ru": {
        "ui.tag.precise": "точное",
        "ui.tag.heavy": "тяжёлое",
        "ui.tag.spread": "веерное",
        "ui.tag.gun": "огнестрельное",
        "ui.tag.blade": "клинковое",
        "ui.tag.warp": "варповое",
        "ui.tag.primitive": "примитивное",
        "ui.tag.construct": "конструкции",
        "ui.tag.blunt": "дробящее",
        "ui.tag.holy": "освящённое",
        "ui.synergy.special.crit_boost":
            "Критические удары бьют в полтора раза сильнее",
    },
    "en": {
        "ui.tag.precise": "precise",
        "ui.tag.heavy": "heavy",
        "ui.tag.spread": "spread",
        "ui.tag.gun": "firearms",
        "ui.tag.blade": "blades",
        "ui.tag.warp": "warp",
        "ui.tag.primitive": "primitive",
        "ui.tag.construct": "constructs",
        "ui.tag.blunt": "blunt",
        "ui.tag.holy": "holy",
        "ui.synergy.special.crit_boost":
            "Critical hits deal 50% more damage",
    },
}


def patch(cfg):
    changed = []

    syn = cfg.setdefault("synergies", {})
    if syn.get("tags") != TAG_SYNERGIES:
        changed.append(f"synergies.tags: {syn.get('tags')!r} → {TAG_SYNERGIES!r}")
        syn["tags"] = TAG_SYNERGIES
    specials = syn.setdefault("specials", {})
    for k, v in NEW_SPECIALS.items():
        if specials.get(k) != v:
            changed.append(f"synergies.specials.{k}: {specials.get(k)!r} → {v!r}")
            specials[k] = v

    eng = cfg.setdefault("engineering", {})
    if eng.get("max_turrets") != MAX_TURRETS:
        changed.append(
            f"engineering.max_turrets: {eng.get('max_turrets')!r} → {MAX_TURRETS!r}")
        eng["max_turrets"] = MAX_TURRETS

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
