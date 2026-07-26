"""Оружие: 28 семейств, каждое разворачивается в тиры I–IV.

Данные, а не логика. Балансится одна база на семейство, тиры получаются
множителями — иначе четыре числа на каждое из 28 названий пришлось бы держать
в голове одновременно.

`open: True` — открыто на старте (10 штук по ТЗ §3.4). Остальные покупаются за
реликвии, цена зависит от `unlock_tier` (meta.weapon_unlock_price).
"""

TIER_DAMAGE = [1.0, 1.70, 2.80, 4.50]
TIER_PRICE = [1.0, 2.30, 4.50, 8.00]
TIER_COOLDOWN = [1.0, 0.97, 0.94, 0.90]
TIER_RANGE = [1.0, 1.04, 1.08, 1.12]
TIER_PREFIX = ["", "Точёный ", "Освящённый ", "Заклятый "]

MELEE = "melee"
RANGED = "ranged"
ELEM = "elem"
ENGI = "engi"


def arc(angle):
    return {"type": "arc", "angle": angle}


def shot(**kw):
    base = {"type": "projectile", "count": 1, "spread": 0, "speed": 420,
            "pierce": 0, "ttl": 1.1, "size": 4, "texture": "p_nail"}
    base.update(kw)
    return base


WEAPONS = {
    # --- Ближнее (9) ------------------------------------------------------
    "w_cleaver": dict(name="Ржавый тесак", cls=MELEE, tags=["blade", "primitive"],
                      damage=10, cooldown=0.90, range=105, knockback=6, crit=5,
                      scaling={"melee_dmg": 1.0, "damage_pct": 1.0},
                      shape=arc(80), price=12, open=True),
    "w_chainblade": dict(name="Цепной клинок", cls=MELEE, tags=["blade", "heavy"],
                         damage=16, cooldown=1.10, range=115, knockback=9, crit=7,
                         scaling={"melee_dmg": 1.2, "damage_pct": 1.0},
                         shape=arc(95), price=24, unlock_tier=1),
    "w_hammer": dict(name="Силовой молот", cls=MELEE, tags=["blunt", "heavy"],
                     damage=22, cooldown=1.60, range=100, knockback=18, crit=2,
                     scaling={"melee_dmg": 1.4, "damage_pct": 1.0},
                     shape=arc(110), price=25, open=True),
    "w_censer": dict(name="Кадило-цеп", cls=MELEE, tags=["blunt", "holy"],
                     damage=9, cooldown=0.85, range=110, knockback=10, crit=3,
                     scaling={"melee_dmg": 1.0, "damage_pct": 1.0},
                     shape=arc(120), price=15, open=True),
    "w_scourge": dict(name="Шипастый бич", cls=MELEE, tags=["blade", "primitive"],
                      damage=8, cooldown=0.62, range=150, knockback=4, crit=9,
                      scaling={"melee_dmg": 0.9, "damage_pct": 1.0},
                      shape=arc(50), price=20, unlock_tier=1),
    "w_claws": dict(name="Костяные когти", cls=MELEE, tags=["blade", "primitive"],
                    damage=5, cooldown=0.42, range=85, knockback=2, crit=8,
                    scaling={"melee_dmg": 0.8, "damage_pct": 1.0},
                    shape=arc(60), price=14, open=True),
    "w_sickle": dict(name="Серп-пила", cls=MELEE, tags=["blade", "spread"],
                     damage=11, cooldown=0.78, range=120, knockback=5, crit=6,
                     scaling={"melee_dmg": 1.0, "damage_pct": 1.0},
                     shape=arc(160), price=22, unlock_tier=2),
    "w_pike": dict(name="Копьё-пика", cls=MELEE, tags=["blade", "precise"],
                   damage=14, cooldown=1.05, range=160, knockback=8, crit=6,
                   scaling={"melee_dmg": 1.1, "damage_pct": 1.0},
                   shape=arc(35), price=18, open=True),
    "w_stilettos": dict(name="Парные стилеты", cls=MELEE, tags=["blade", "precise"],
                        damage=6, cooldown=0.38, range=90, knockback=1, crit=18,
                        scaling={"melee_dmg": 0.85, "damage_pct": 1.0},
                        shape=arc(55), price=26, unlock_tier=2),

    # --- Дальнее (9) ------------------------------------------------------
    "w_nailer": dict(name="Гвоздомёт", cls=RANGED, tags=["gun", "primitive", "spread"],
                     damage=6, cooldown=0.55, range=280, knockback=3, crit=4,
                     scaling={"ranged_dmg": 1.0, "damage_pct": 1.0},
                     shape=shot(spread=6, speed=420, ttl=1.1), price=14, open=True),
    "w_spiker": dict(name="Шпилевик", cls=RANGED, tags=["gun", "precise"],
                     damage=9, cooldown=0.70, range=320, knockback=3, crit=7,
                     scaling={"ranged_dmg": 1.0, "damage_pct": 1.0},
                     shape=shot(speed=520, pierce=1, ttl=1.0, texture="p_spike"),
                     price=19, unlock_tier=1),
    "w_shotgun": dict(name="Обрез", cls=RANGED, tags=["gun", "spread", "heavy"],
                      damage=5, cooldown=1.20, range=200, knockback=7, crit=3,
                      scaling={"ranged_dmg": 0.7, "damage_pct": 1.0},
                      shape=shot(count=5, spread=34, speed=380, ttl=0.55, texture="p_slug"),
                      price=22, open=True),
    "w_autocannon": dict(name="Автопушка", cls=RANGED, tags=["gun", "heavy"],
                         damage=7, cooldown=0.28, range=260, knockback=2, crit=3,
                         scaling={"ranged_dmg": 0.8, "damage_pct": 1.0},
                         shape=shot(spread=12, speed=460, ttl=0.9, texture="p_slug"),
                         price=28, unlock_tier=2),
    "w_carbine": dict(name="Лучевой карабин", cls=RANGED, tags=["gun", "precise"],
                      damage=11, cooldown=1.05, range=360, knockback=2, crit=8,
                      scaling={"ranged_dmg": 1.0, "damage_pct": 1.0},
                      shape=shot(speed=620, pierce=1, ttl=1.0, texture="p_beam"),
                      price=20, open=True),
    "w_longbarrel": dict(name="Длинноствол", cls=RANGED, tags=["gun", "precise", "heavy"],
                         damage=30, cooldown=2.10, range=460, knockback=10, crit=15,
                         scaling={"ranged_dmg": 1.4, "damage_pct": 1.0},
                         shape=shot(speed=760, pierce=2, ttl=1.1, texture="p_beam"),
                         price=38, unlock_tier=3),
    "w_lance": dict(name="Гарпунный арбалет", cls=RANGED, tags=["precise", "heavy"],
                    damage=26, cooldown=1.80, range=420, knockback=14, crit=12,
                    scaling={"ranged_dmg": 1.3, "damage_pct": 1.0},
                    shape=shot(speed=700, pierce=3, ttl=1.2, texture="p_harpoon"),
                    price=34, unlock_tier=2),
    "w_needler": dict(name="Игломёт", cls=RANGED, tags=["gun", "spread", "precise"],
                      damage=4, cooldown=0.20, range=240, knockback=1, crit=10,
                      scaling={"ranged_dmg": 0.6, "damage_pct": 1.0},
                      shape=shot(spread=9, speed=560, ttl=0.7, texture="p_spike"),
                      price=30, unlock_tier=2),
    "w_grapeshot": dict(name="Картечница", cls=RANGED, tags=["gun", "spread", "heavy"],
                        damage=6, cooldown=1.45, range=230, knockback=9, crit=4,
                        scaling={"ranged_dmg": 0.75, "damage_pct": 1.0},
                        shape=shot(count=8, spread=56, speed=400, ttl=0.6, texture="p_slug"),
                        price=36, unlock_tier=3),

    # --- Стихийное (7) ----------------------------------------------------
    "w_plasmacutter": dict(name="Плазменный резак", cls=ELEM, tags=["warp", "precise"],
                           damage=15, cooldown=1.00, range=200, knockback=3, crit=6,
                           scaling={"elem_dmg": 1.1, "damage_pct": 1.0},
                           shape=shot(speed=380, pierce=4, ttl=0.8, size=7, texture="p_plasma"),
                           price=30, unlock_tier=2),
    "w_rod": dict(name="Жезл разлома", cls=ELEM, tags=["warp", "precise"],
                  damage=13, cooldown=1.30, range=300, knockback=4, crit=5,
                  scaling={"elem_dmg": 1.2, "damage_pct": 1.0},
                  shape=shot(speed=340, pierce=2, ttl=1.4, size=6, texture="p_warp"),
                  price=26, open=True),
    "w_venomsprayer": dict(name="Ядо-распылитель", cls=ELEM, tags=["warp", "spread"],
                           damage=5, cooldown=0.35, range=190, knockback=1, crit=2,
                           scaling={"elem_dmg": 0.7, "damage_pct": 1.0},
                           shape=shot(count=3, spread=40, speed=280, ttl=0.65, size=6,
                                      texture="p_venom"),
                           price=27, unlock_tier=2),
    "w_stormcaster": dict(name="Грозорассеиватель", cls=ELEM, tags=["warp", "spread"],
                          damage=9, cooldown=0.95, range=260, knockback=5, crit=6,
                          scaling={"elem_dmg": 1.0, "damage_pct": 1.0},
                          shape=shot(count=3, spread=50, speed=430, ttl=0.9, size=5,
                                     texture="p_spark"),
                          price=32, unlock_tier=3),
    "w_sporegun": dict(name="Споровая пушка", cls=ELEM, tags=["warp", "spread", "heavy"],
                       damage=12, cooldown=1.55, range=240, knockback=6, crit=3,
                       scaling={"elem_dmg": 1.15, "damage_pct": 1.0},
                       shape=shot(count=2, spread=24, speed=250, pierce=2, ttl=1.3, size=9,
                                  texture="p_spore"),
                       price=33, unlock_tier=3),
    "w_flamer": dict(name="Огнемёт", cls=ELEM, tags=["warp", "spread"],
                     damage=4, cooldown=0.22, range=170, knockback=1, crit=1,
                     scaling={"elem_dmg": 0.6, "damage_pct": 1.0},
                     shape=shot(count=2, spread=22, speed=260, pierce=1, ttl=0.55, size=7,
                                texture="p_flame"),
                     price=30, unlock_tier=1),
    "w_icelens": dict(name="Ледяная линза", cls=ELEM, tags=["warp", "precise"],
                      damage=18, cooldown=1.40, range=340, knockback=12, crit=9,
                      scaling={"elem_dmg": 1.3, "damage_pct": 1.0},
                      shape=shot(speed=480, pierce=2, ttl=1.1, size=6, texture="p_ice"),
                      price=35, unlock_tier=3),

    # --- Инженерное (3), скейлится от engineering -------------------------
    "w_turret": dict(name="Автотурель", cls=ENGI, tags=["construct", "gun"],
                     damage=8, cooldown=0.60, range=270, knockback=2, crit=4,
                     scaling={"engineering": 1.5, "damage_pct": 1.0},
                     shape=shot(speed=440, ttl=1.0, texture="p_slug"),
                     price=24, open=True),
    "w_bonemine": dict(name="Костяная мина", cls=ENGI, tags=["construct", "heavy"],
                       damage=26, cooldown=2.20, range=150, knockback=16, crit=2,
                       scaling={"engineering": 1.8, "damage_pct": 1.0},
                       shape=arc(360), price=29, unlock_tier=2),
    "w_forgedrone": dict(name="Литейный дрон", cls=ENGI, tags=["construct", "precise"],
                         damage=10, cooldown=0.85, range=300, knockback=2, crit=7,
                         scaling={"engineering": 1.6, "damage_pct": 1.0},
                         shape=shot(speed=500, pierce=1, ttl=1.0, texture="p_beam"),
                         price=31, unlock_tier=3),
}


def build(round_):
    """Развернуть базы в полные линейки тиров со связкой next_tier."""
    out = {}
    for fam, b in WEAPONS.items():
        for tier in range(1, 5):
            name = b["name"] if tier == 1 else TIER_PREFIX[tier - 1] + b["name"].lower()
            if name and name[0].islower():
                name = name[0].upper() + name[1:]
            w = {
                "name": name,
                "texture": fam,
                "tier": tier,
                "class": b["cls"],
                "tags": list(b["tags"]),
                "damage": round_(b["damage"] * TIER_DAMAGE[tier - 1], 2),
                "cooldown": round_(b["cooldown"] * TIER_COOLDOWN[tier - 1], 3),
                "range": int(round(b["range"] * TIER_RANGE[tier - 1])),
                "knockback": b["knockback"],
                "crit_pct": b["crit"],
                "scaling": dict(b["scaling"]),
                "shape": {k: v for k, v in b["shape"].items()},
                "price": int(round(b["price"] * TIER_PRICE[tier - 1])),
            }
            if tier < 4:
                w["next_tier"] = f"{fam}_{tier + 1}"
            w["unlock"] = ({"type": "default"} if b.get("open")
                           else {"type": "relics", "tier": b.get("unlock_tier", 1)})
            out[f"{fam}_{tier}"] = w
    return out


def counts():
    by_class = {}
    opened = 0
    for b in WEAPONS.values():
        by_class[b["cls"]] = by_class.get(b["cls"], 0) + 1
        if b.get("open"):
            opened += 1
    return len(WEAPONS), by_class, opened
