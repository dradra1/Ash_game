#!/usr/bin/env python3
"""Контент этапа M2: оружие с тирами I–IV, предметы, боссы, поля лавки и левелапа.

Идемпотентен, накатывается СРАЗУ В ОБЕ КОПИИ конфига (репо-сид и живой в data/),
как требует CLAUDE.md §3.2. Повторный запуск ничего не ломает и не дублирует.

    tools/patch_config_m2.py            показать, что изменится
    tools/patch_config_m2.py --apply    записать
"""
import argparse
import copy
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")), "game_config.json")

# --- Оружие -----------------------------------------------------------------
# Тир задаётся один раз базой, остальные три получаются множителями: так вся
# линейка остаётся согласованной, а балансить нужно одно число, а не четыре.
TIER_DAMAGE = [1.0, 1.70, 2.80, 4.50]
TIER_PRICE = [1.0, 2.30, 4.50, 8.00]
TIER_COOLDOWN = [1.0, 0.97, 0.94, 0.90]
TIER_RANGE = [1.0, 1.04, 1.08, 1.12]
TIER_NAMES = ["", "Точёный ", "Освящённый ", "Заклятый "]

# id → база тира I. `open` — открыто ли на старте (иначе покупается за реликвии).
WEAPONS = {
    "w_cleaver": {
        "name": "Ржавый тесак", "class": "melee", "tags": ["blade", "primitive"],
        "damage": 10, "cooldown": 0.90, "range": 105, "knockback": 6, "crit_pct": 5,
        "scaling": {"melee_dmg": 1.0, "damage_pct": 1.0},
        "shape": {"type": "arc", "angle": 80}, "price": 12, "open": True,
    },
    "w_hammer": {
        "name": "Силовой молот", "class": "melee", "tags": ["blunt", "heavy"],
        "damage": 22, "cooldown": 1.60, "range": 100, "knockback": 18, "crit_pct": 2,
        "scaling": {"melee_dmg": 1.4, "damage_pct": 1.0},
        "shape": {"type": "arc", "angle": 110}, "price": 25, "open": True,
    },
    "w_censer": {
        "name": "Кадило-цеп", "class": "melee", "tags": ["blunt", "holy"],
        "damage": 9, "cooldown": 0.85, "range": 110, "knockback": 10, "crit_pct": 3,
        "scaling": {"melee_dmg": 1.0, "damage_pct": 1.0},
        "shape": {"type": "arc", "angle": 120}, "price": 15, "open": True,
    },
    "w_claws": {
        "name": "Костяные когти", "class": "melee", "tags": ["blade", "primitive"],
        "damage": 5, "cooldown": 0.42, "range": 85, "knockback": 2, "crit_pct": 8,
        "scaling": {"melee_dmg": 0.8, "damage_pct": 1.0},
        "shape": {"type": "arc", "angle": 60}, "price": 14, "open": True,
    },
    "w_pike": {
        "name": "Копьё-пика", "class": "melee", "tags": ["blade", "precise"],
        "damage": 14, "cooldown": 1.05, "range": 160, "knockback": 8, "crit_pct": 6,
        "scaling": {"melee_dmg": 1.1, "damage_pct": 1.0},
        "shape": {"type": "arc", "angle": 35}, "price": 18, "open": True,
    },
    "w_nailer": {
        "name": "Гвоздомёт", "class": "ranged", "tags": ["gun", "primitive", "spread"],
        "damage": 6, "cooldown": 0.55, "range": 280, "knockback": 3, "crit_pct": 4,
        "scaling": {"ranged_dmg": 1.0, "damage_pct": 1.0},
        "shape": {"type": "projectile", "count": 1, "spread": 6, "speed": 420,
                  "pierce": 0, "ttl": 1.1, "size": 4, "texture": "p_nail"},
        "price": 14, "open": True,
    },
    "w_shotgun": {
        "name": "Обрез", "class": "ranged", "tags": ["gun", "spread", "heavy"],
        "damage": 5, "cooldown": 1.20, "range": 200, "knockback": 7, "crit_pct": 3,
        "scaling": {"ranged_dmg": 0.7, "damage_pct": 1.0},
        "shape": {"type": "projectile", "count": 5, "spread": 34, "speed": 380,
                  "pierce": 0, "ttl": 0.55, "size": 4, "texture": "p_slug"},
        "price": 22, "open": True,
    },
    "w_carbine": {
        "name": "Лучевой карабин", "class": "ranged", "tags": ["gun", "precise"],
        "damage": 11, "cooldown": 1.05, "range": 360, "knockback": 2, "crit_pct": 8,
        "scaling": {"ranged_dmg": 1.0, "damage_pct": 1.0},
        "shape": {"type": "projectile", "count": 1, "spread": 0, "speed": 620,
                  "pierce": 1, "ttl": 1.0, "size": 4, "texture": "p_beam"},
        "price": 20, "open": True,
    },
    "w_rod": {
        "name": "Жезл разлома", "class": "elem", "tags": ["warp", "precise"],
        "damage": 13, "cooldown": 1.30, "range": 300, "knockback": 4, "crit_pct": 5,
        "scaling": {"elem_dmg": 1.2, "damage_pct": 1.0},
        "shape": {"type": "projectile", "count": 1, "spread": 0, "speed": 340,
                  "pierce": 2, "ttl": 1.4, "size": 6, "texture": "p_warp"},
        "price": 26, "open": True,
    },
    "w_lance": {
        "name": "Гарпунный арбалет", "class": "ranged", "tags": ["precise", "heavy"],
        "damage": 26, "cooldown": 1.80, "range": 420, "knockback": 14, "crit_pct": 12,
        "scaling": {"ranged_dmg": 1.3, "damage_pct": 1.0},
        "shape": {"type": "projectile", "count": 1, "spread": 0, "speed": 700,
                  "pierce": 3, "ttl": 1.2, "size": 5, "texture": "p_harpoon"},
        "price": 34, "open": False, "unlock_tier": 2,
    },
    "w_flamer": {
        "name": "Огнемёт", "class": "elem", "tags": ["warp", "spread"],
        "damage": 4, "cooldown": 0.22, "range": 170, "knockback": 1, "crit_pct": 1,
        "scaling": {"elem_dmg": 0.6, "damage_pct": 1.0},
        "shape": {"type": "projectile", "count": 2, "spread": 22, "speed": 260,
                  "pierce": 1, "ttl": 0.55, "size": 7, "texture": "p_flame"},
        "price": 30, "open": False, "unlock_tier": 2,
    },
    "w_stormcaster": {
        "name": "Грозорассеиватель", "class": "elem", "tags": ["warp", "spread"],
        "damage": 9, "cooldown": 0.95, "range": 260, "knockback": 5, "crit_pct": 6,
        "scaling": {"elem_dmg": 1.0, "damage_pct": 1.0},
        "shape": {"type": "projectile", "count": 3, "spread": 50, "speed": 430,
                  "pierce": 1, "ttl": 0.9, "size": 5, "texture": "p_spark"},
        "price": 32, "open": False, "unlock_tier": 3,
    },
}

# --- Предметы ---------------------------------------------------------------
# Правило ТЗ: тиры III–IV ОБЯЗАНЫ иметь минус. Проверяется в самом скрипте.
ITEMS = {
    "it_rusty_nail": {"name": "Ржавый гвоздь", "desc": "Мелочь, а колет.", "tier": 1,
                      "price": 10, "tags": ["primitive"],
                      "stats": {"melee_dmg": 2, "ranged_dmg": 1}},
    "it_lamp_oil": {"name": "Лампадное масло", "desc": "Горит ровно и долго.", "tier": 1,
                    "price": 12, "tags": ["holy"],
                    "stats": {"attack_speed_pct": 5, "max_hp": -1}},
    "it_ash_pouch": {"name": "Кисет с прахом", "desc": "Всё, что осталось от предшественника.",
                     "tier": 1, "price": 11, "tags": [], "stats": {"tithe": 1}},
    "it_iron_plate": {"name": "Латная пластина", "desc": "Тяжёлая, зато честная.", "tier": 1,
                      "price": 14, "tags": ["heavy"],
                      "stats": {"armor": 2, "move_speed_pct": -4}},
    "it_wax_seal": {"name": "Восковая печать", "desc": "Каждая волна оставляет новый оттиск.",
                    "tier": 2, "price": 30, "tags": ["holy"],
                    "stats": {"armor": 1, "move_speed_pct": -3},
                    "effect": {"trigger": "wave_end", "type": "add_stat",
                               "stat": "damage_pct", "value": 2}},
    "it_grave_dust": {"name": "Могильная пыль", "desc": "Липнет к ранам и к совести.",
                      "tier": 2, "price": 28, "tags": [],
                      "stats": {"lifesteal_pct": 3, "max_hp": -2}},
    "it_lens": {"name": "Шлифованная линза", "desc": "Видит дальше, чем следовало бы.",
                "tier": 2, "price": 26, "tags": ["precise"],
                "stats": {"range": 2, "crit_pct": 3}},
    "it_censer_coal": {"name": "Кадильный уголь", "desc": "Тлеет даже под дождём.",
                       "tier": 2, "price": 24, "tags": ["holy"],
                       "stats": {"elem_dmg": 3, "attack_speed_pct": 4}},
    "it_pilgrim_boots": {"name": "Сапоги пилигрима", "desc": "Стоптаны о семь дорог.",
                         "tier": 2, "price": 22, "tags": [],
                         "stats": {"move_speed_pct": 8, "armor": -1}},
    "it_martyr_nail": {"name": "Гвоздь мученика", "desc": "Боль — тоже форма молитвы.",
                       "tier": 3, "price": 55, "tags": ["holy"],
                       "stats": {"damage_pct": 12, "max_hp_pct": -10}},
    "it_bloodwick": {"name": "Кровавый фитиль", "desc": "Питается тем, что проливает.",
                     "tier": 3, "price": 58, "tags": [],
                     "stats": {"lifesteal_pct": 6, "armor": -2},
                     "effect": {"trigger": "on_crit", "type": "heal", "value": 1}},
    "it_furnace_heart": {"name": "Сердце горнила", "desc": "Стучит вместо твоего.",
                         "tier": 3, "price": 62, "tags": ["heavy"],
                         "stats": {"max_hp": 12, "engineering": 3, "move_speed_pct": -8}},
    "it_mirror_shard": {"name": "Зеркальный осколок", "desc": "Показывает удар до удара.",
                        "tier": 3, "price": 60, "tags": ["precise"],
                        "stats": {"dodge_pct": 8, "crit_pct": 5, "max_hp": -4}},
    "it_reliquary": {"name": "Малый реликварий", "desc": "Внутри — чей-то палец. Помогает.",
                     "tier": 4, "price": 110, "tags": ["holy"],
                     "stats": {"damage_pct": 20, "armor": 3, "move_speed_pct": -10},
                     "effect": {"trigger": "wave_end", "type": "heal", "value": 4}},
    "it_warp_tumor": {"name": "Опухоль разлома", "desc": "Растёт. Ты стараешься не думать.",
                      "tier": 4, "price": 115, "tags": ["warp"],
                      "stats": {"elem_dmg": 10, "luck": 5, "max_hp_pct": -15}},
    "it_iron_lung": {"name": "Железное лёгкое", "desc": "Дышит за тебя, решает за тебя.",
                     "tier": 4, "price": 120, "tags": ["heavy"],
                     "stats": {"max_hp": 25, "hp_regen": 2, "attack_speed_pct": -12}},
}

COOP_ITEMS = {
    "it_choir_bell": {"name": "Хоровой колокол", "desc": "Слышен всем, кто ещё стоит.",
                      "tier": 2, "price": 30, "tags": ["holy"], "coop_only": True,
                      "stats": {"damage_pct": 4},
                      "effect": {"trigger": "aura", "type": "ally_stat",
                                 "stat": "damage_pct", "value": 5, "radius": 300}},
    "it_shared_shroud": {"name": "Общий саван", "desc": "Хватит на двоих. На троих — впритык.",
                         "tier": 3, "price": 58, "tags": [], "coop_only": True,
                         "stats": {"armor": 2, "move_speed_pct": -3},
                         "effect": {"trigger": "aura", "type": "ally_stat",
                                    "stat": "armor", "value": 1, "radius": 260}},
}

# --- Боссы ------------------------------------------------------------------
BOSSES = {
    "b_butcher": {
        "name": "Мясник Улья", "texture": "b_butcher", "color": "#a83a3a", "ai": "chase",
        "hp": 900, "damage": 16, "speed": 58, "size": 44, "sprite": 112,
        "ash": 60, "xp": 40, "score": 250, "knockback_resist": 0.95,
        "arenas": ["ar_hive"], "boss": True,
        "phases": [
            {"hp_pct": 1.0, "pattern": "chase", "speed_mult": 1.0},
            {"hp_pct": 0.6, "pattern": "charge", "speed_mult": 1.6, "damage_mult": 1.25},
        ],
    },
    "b_rift_father": {
        "name": "Отец Скверны", "texture": "b_rift_father", "color": "#7a2f8f", "ai": "shooter",
        "hp": 2200, "damage": 20, "speed": 46, "size": 52, "sprite": 128,
        "ash": 140, "xp": 90, "score": 600, "knockback_resist": 1.0,
        "arenas": ["ar_hive"], "boss": True,
        "attack": {"cooldown": 1.6, "range": 460, "keep_dist": 300,
                   "projectile": {"speed": 260, "ttl": 2.2, "size": 9, "texture": "p_warp"}},
        "phases": [
            {"hp_pct": 1.0, "pattern": "shooter", "speed_mult": 1.0},
            {"hp_pct": 0.6, "pattern": "spiral", "speed_mult": 1.3, "cooldown_mult": 0.55},
        ],
    },
}


def build_weapons():
    """Развернуть базы в полные линейки тиров I–IV со связкой next_tier."""
    out = {}
    for fam, base in WEAPONS.items():
        for tier in range(1, 5):
            wid = f"{fam}_{tier}"
            w = {
                "name": TIER_NAMES[tier - 1] + base["name"].lower()
                        if tier > 1 else base["name"],
                "texture": fam,
                "tier": tier,
                "class": base["class"],
                "tags": list(base["tags"]),
                "damage": round(base["damage"] * TIER_DAMAGE[tier - 1], 2),
                "cooldown": round(base["cooldown"] * TIER_COOLDOWN[tier - 1], 3),
                "range": round(base["range"] * TIER_RANGE[tier - 1]),
                "knockback": base["knockback"],
                "crit_pct": base["crit_pct"],
                "scaling": dict(base["scaling"]),
                "shape": copy.deepcopy(base["shape"]),
                "price": round(base["price"] * TIER_PRICE[tier - 1]),
            }
            if w["name"][0].islower():
                w["name"] = w["name"][0].upper() + w["name"][1:]
            if tier < 4:
                w["next_tier"] = f"{fam}_{tier + 1}"
            if base.get("open"):
                w["unlock"] = {"type": "default"}
            else:
                w["unlock"] = {"type": "relics", "tier": base.get("unlock_tier", 1)}
            out[wid] = w
    return out


def build_items():
    out = {}
    for iid, it in list(ITEMS.items()) + list(COOP_ITEMS.items()):
        entry = {
            "name": it["name"],
            "desc": it["desc"],
            "texture": iid,
            "tier": it["tier"],
            "price": it["price"],
            "tags": list(it.get("tags", [])),
            "stats": dict(it["stats"]),
            "effect": it.get("effect"),
            "coop_only": it.get("coop_only", False),
        }
        out[iid] = entry
    return out


def validate(items):
    """Тиры III–IV обязаны иметь минус (правило ТЗ §3.7) — ловим на входе."""
    bad = []
    for iid, it in items.items():
        if it["tier"] >= 3 and not any(v < 0 for v in it["stats"].values()):
            bad.append(iid)
    if bad:
        raise SystemExit(f"предметы тира III–IV без минуса: {', '.join(bad)}")


def patch(cfg):
    changed = []

    weapons = build_weapons()
    if cfg.get("weapons") != weapons:
        cfg["weapons"] = weapons
        changed.append(f"оружие: {len(weapons)} записей ({len(WEAPONS)} линеек × 4 тира)")

    items = build_items()
    validate(items)
    if cfg.get("items") != items:
        cfg["items"] = items
        changed.append(f"предметы: {len(items)}")

    if cfg.get("bosses") != BOSSES:
        cfg["bosses"] = BOSSES
        changed.append(f"боссы: {len(BOSSES)}")

    arena = cfg["arenas"]["ar_hive"]
    if arena.get("boss_mid") != "b_butcher" or arena.get("boss_final") != "b_rift_father":
        arena["boss_mid"] = "b_butcher"
        arena["boss_final"] = "b_rift_father"
        changed.append("боссы прописаны в арене ar_hive")

    # Стартовое оружие персонажей — на новые id с тиром
    starts = {"ch_pilgrim": ["w_cleaver_1"], "ch_zealot": ["w_censer_1"],
              "ch_censor": ["w_carbine_1"]}
    for cid, sw in starts.items():
        if cid in cfg["characters"] and cfg["characters"][cid].get("start_weapons") != sw:
            cfg["characters"][cid]["start_weapons"] = sw
            changed.append(f"стартовое оружие {cid}")

    shop = cfg["shop"]
    extra_shop = {
        "boss_wave_skip": True,        # после боссовой волны лавка тоже открывается
        "min_price": 1,
        "refresh_on_open": True,
    }
    for k, v in extra_shop.items():
        if shop.get(k) != v:
            shop[k] = v
            changed.append(f"shop.{k}")

    lvl = cfg["level"]
    if lvl.get("max_rerolls_per_level") != 0:
        lvl["max_rerolls_per_level"] = 0
        changed.append("level.max_rerolls_per_level")

    ui = {
        "ui.shop.stats": "Статы",
        "ui.shop.inventory": "Оружие",
        "ui.shop.items": "Предметы",
        "ui.shop.locked": "Закреплено",
        "ui.shop.sold": "Продано",
        "ui.shop.cant_afford": "Не хватает праха",
        "ui.shop.slots_full": "Слоты оружия заняты",
        "ui.levelup.queue": "Ещё выборов",
        "ui.hud.boss": "Босс",
        "ui.result.kills": "Убийств",
        "ui.result.score": "Очки",
        "ui.result.time": "Время",
    }
    ui_en = {
        "ui.shop.stats": "Stats",
        "ui.shop.inventory": "Weapons",
        "ui.shop.items": "Items",
        "ui.shop.locked": "Locked",
        "ui.shop.sold": "Sold",
        "ui.shop.cant_afford": "Not enough ash",
        "ui.shop.slots_full": "Weapon slots are full",
        "ui.levelup.queue": "More choices",
        "ui.hud.boss": "Boss",
        "ui.result.kills": "Kills",
        "ui.result.score": "Score",
        "ui.result.time": "Time",
    }
    for k, v in ui.items():
        if cfg["i18n"]["ru"].get(k) != v:
            cfg["i18n"]["ru"][k] = v
            changed.append(f"i18n.ru {k}")
    for k, v in ui_en.items():
        if cfg["i18n"]["en"].get(k) != v:
            cfg["i18n"]["en"][k] = v

    if cfg.get("content_version", 1) < 2 and changed:
        cfg["content_version"] = 2
        changed.append("content_version → 2")

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
        label = "репо" if path == REPO else "живой"
        if not changed:
            print(f"{label}: уже накачен")
            continue
        print(f"{label}: {len(changed)} изменений")
        for c in changed[:8]:
            print("  -", c)
        if len(changed) > 8:
            print(f"  … и ещё {len(changed) - 8}")
        if a.apply:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
                f.write("\n")
            print(f"  записано в {path}")

    if not a.apply:
        print("\nчтобы применить: tools/patch_config_m2.py --apply")


if __name__ == "__main__":
    main()
