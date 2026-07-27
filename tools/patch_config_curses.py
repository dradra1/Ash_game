#!/usr/bin/env python3
"""Патч: 5 тиров сложности, проклятия, ачивки-отмычки, i18n прерана.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_curses.py --apply
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 8

DANGER = [
    {
        "id": 0, "name": "Послушник",
        "hp_mult": 0.8, "dmg_mult": 0.8, "density": 0.85,
        "elite_from": 6, "price_mult": 1.0, "reward_mult": 1.0,
        "ash_mult": 1.0, "bosses_final": 1,
    },
    {
        "id": 1, "name": "Ратник",
        "hp_mult": 1.0, "dmg_mult": 1.0, "density": 1.0,
        "elite_from": 4, "price_mult": 1.0, "reward_mult": 1.35,
        "ash_mult": 0.9, "bosses_final": 1,
    },
    {
        "id": 2, "name": "Крестоносец",
        "hp_mult": 1.3, "dmg_mult": 1.2, "density": 1.25,
        "elite_from": 3, "price_mult": 1.1, "reward_mult": 1.8,
        "ash_mult": 0.75, "bosses_final": 1,
    },
    {
        "id": 3, "name": "Мученик",
        "hp_mult": 1.6, "dmg_mult": 1.45, "density": 1.5,
        "elite_from": 2, "price_mult": 1.2, "reward_mult": 2.4,
        "elite_wave_every": 5,
        "ash_mult": 0.6, "bosses_final": 2,
    },
    {
        "id": 4, "name": "Анафема",
        "hp_mult": 2.0, "dmg_mult": 1.8, "density": 1.8,
        "elite_from": 1, "price_mult": 1.35, "reward_mult": 3.2,
        "elite_wave_every": 4,
        "ash_mult": 0.45, "bosses_final": 2,
    },
]

ACHIEVEMENTS_ADD = {
    "ac_kills100": {
        "name": "Сотня имён",
        "desc": "Убить 100 врагов за всё время.",
        "cond": {"type": "kills", "value": 100},
    },
    "ac_kills500": {
        "name": "Пятьсот имён",
        "desc": "Убить 500 врагов за всё время.",
        "cond": {"type": "kills", "value": 500},
    },
    "ac_ash_gained_5k": {
        "name": "Пепельный мешок",
        "desc": "Собрать 5000 праха за всё время.",
        "cond": {"type": "ash_gained", "value": 5000},
    },
    "ac_dmg_taken_5k": {
        "name": "Изрубленное тело",
        "desc": "Получить 5000 урона за всё время.",
        "cond": {"type": "damage_taken", "value": 5000},
    },
    "ac_losses_5": {
        "name": "Пять падений",
        "desc": "Проиграть 5 забегов.",
        "cond": {"type": "losses", "value": 5},
    },
    "ac_bosses10": {
        "name": "Десять голов",
        "desc": "Убить 10 боссов за всё время.",
        "cond": {"type": "bosses", "value": 10},
    },
    "ac_shop_buys_50": {
        "name": "Торговец пеплом",
        "desc": "Купить 50 товаров в лавке за всё время.",
        "cond": {"type": "shop_buys", "value": 50},
    },
    "ac_win_d4": {
        "name": "Анафема снята",
        "desc": "Победить на сложности «Анафема».",
        "cond": {"type": "win_danger", "value": 4},
    },
}

CURSES = {
    "cu_double_tempo": {
        "name": "Двойной темп",
        "desc": "Скорость игроков и врагов ×2.",
        "unlock_achievement": "ac_kills100",
        "effects": {
            "player_move_speed_mult": 2,
            "enemy_speed_mult": 2,
        },
    },
    "cu_swarm": {
        "name": "Рой",
        "desc": "Плотность спавна ×1.75, опыт с врагов ×1.25.",
        "unlock_achievement": "ac_kills500",
        "effects": {
            "density_mult": 1.75,
            "xp_mult": 1.25,
        },
    },
    "cu_ashless_tithe": {
        "name": "Десятина без праха",
        "desc": "Прах на пол не падает; 0.5 праха за каждое убийство.",
        "unlock_achievement": "ac_kills1000",
        "effects": {
            # Не `tithe`: десятина теперь платит раз в волну, и +0.5 к ней никто
            # бы не заметил. ash_per_kill идёт прямо в котёл, минуя пол.
            "ash_drop_zero": True,
            "ash_per_kill": 0.5,
        },
    },
    "cu_free_market": {
        "name": "Милость лавки",
        "desc": "Прах не падает; всё в лавке бесплатно; +1 бесплатный реролл.",
        "unlock_achievement": "ac_ash_gained_5k",
        "effects": {
            "ash_drop_zero": True,
            "shop_free": True,
            "free_rerolls": 1,
        },
    },
    "cu_blood_gold": {
        "name": "Кровавое золото",
        "desc": "Урон врагов +1000%, дроп праха ×5.",
        "unlock_achievement": "ac_dmg_taken_5k",
        "effects": {
            "enemy_dmg_mult": 11,
            "ash_drop_mult": 5,
        },
    },
    "cu_glass_vow": {
        "name": "Стеклянный обет",
        "desc": "Макс. HP ×0.5, урон +75%.",
        "unlock_achievement": "ac_losses_5",
        "effects": {
            "max_hp_mult": 0.5,
            "damage_pct": 75,
        },
    },
    "cu_short_rite": {
        "name": "Ускоренный обряд",
        "desc": "Длина волны ×0.65, плотность ×1.3.",
        "unlock_achievement": "ac_bosses10",
        "effects": {
            "wave_len_mult": 0.65,
            "density_mult": 1.3,
        },
    },
    "cu_iron_tithe": {
        "name": "Железная десятина",
        "desc": "Цены ×2, +2 к десятине, больше реликвий.",
        "unlock_achievement": "ac_shop_buys_50",
        "effects": {
            "shop_price_mult": 2,
            "tithe": 2,
            "reward_mult": 1.25,
        },
    },
}

I18N_RU = {
    "ui.setup.title": "Настройка забега",
    "ui.setup.next": "Далее",
    "ui.setup.back": "Назад",
    "ui.setup.start": "Начать",
    "ui.setup.create": "Создать комнату",
    "ui.setup.curses": "Проклятия",
    "ui.setup.curses_hint": "Можно не выбирать или взять все открытые.",
    "ui.setup.curse_locked": "Откроется за ачивку",
    "ui.setup.none": "Без проклятий",
    "ui.meta.curses": "Проклятия",
    "ui.meta.unlocks_curse": "Открывает проклятие",
}

I18N_EN = {
    "ui.setup.title": "Run setup",
    "ui.setup.next": "Next",
    "ui.setup.back": "Back",
    "ui.setup.start": "Start",
    "ui.setup.create": "Create room",
    "ui.setup.curses": "Curses",
    "ui.setup.curses_hint": "Pick none, or every unlocked curse.",
    "ui.setup.curse_locked": "Unlocked by achievement",
    "ui.setup.none": "No curses",
    "ui.meta.curses": "Curses",
    "ui.meta.unlocks_curse": "Unlocks curse",
}


def patch(cfg):
    changed = []

    if cfg.get("content_version", 0) < CONTENT_VERSION:
        cfg["content_version"] = CONTENT_VERSION
        changed.append("content_version")

    danger = cfg.get("danger") or []
    need_danger = (
        len(danger) != len(DANGER)
        or any(d.get("ash_mult") is None for d in danger)
        or any(d.get("bosses_final") is None for d in danger)
        or not any(d.get("id") == 4 for d in danger)
    )
    if need_danger:
        cfg["danger"] = [dict(d) for d in DANGER]
        changed.append("danger")

    ach = cfg.setdefault("achievements", {})
    for aid, entry in ACHIEVEMENTS_ADD.items():
        if aid not in ach:
            ach[aid] = entry
            changed.append("ach:" + aid)

    want_curses = {
        k: {
            "name": v["name"],
            "desc": v["desc"],
            "unlock_achievement": v["unlock_achievement"],
            "effects": dict(v["effects"]),
        }
        for k, v in CURSES.items()
    }
    if cfg.get("curses") != want_curses:
        cfg["curses"] = want_curses
        changed.append("curses")

    i18n = cfg.setdefault("i18n", {})
    for lang, pairs in (("ru", I18N_RU), ("en", I18N_EN)):
        bucket = i18n.setdefault(lang, {})
        for key, val in pairs.items():
            if bucket.get(key) != val:
                bucket[key] = val
                changed.append(lang + ":" + key)

    return changed


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save(path, cfg):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.apply and not args.dry_run:
        ap.error("укажите --apply или --dry-run")

    for path in (REPO, LIVE):
        if not os.path.isfile(path) and path == LIVE:
            print("skip live (нет файла):", path)
            continue
        if not os.path.isfile(path):
            print("missing:", path, file=sys.stderr)
            return 1
        cfg = load(path)
        changed = patch(cfg)
        print(path, "→", ", ".join(changed) if changed else "ok (no changes)")
        if args.apply and changed:
            save(path, cfg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
