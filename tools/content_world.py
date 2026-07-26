"""Мир: 18 обычных врагов, 6 элит, 6 боссов, 3 арены, 14 персонажей, ачивки.

Элиты — не отдельные записи с нуля, а увеличенные версии обычных типов
(множители из `config.waves`), поэтому их описания короткие: важен базовый тип,
из которого элита растёт, и её собственный дроп.
"""

CHASE, SHOOTER, CHARGER, ORBITER, SPLITTER, BOMBER, SUMMONER, SUPPORT = (
    "chase", "shooter", "charger", "orbiter", "splitter", "bomber", "summoner", "support")


def ranged(cooldown, rng, keep, speed, ttl, size, texture):
    return {"cooldown": cooldown, "range": rng, "keep_dist": keep,
            "projectile": {"speed": speed, "ttl": ttl, "size": size, "texture": texture}}


# id: имя, текстура, цвет, ИИ, hp, урон, скорость, размер, спрайт, прах, xp, очки,
#     арены, min/max волна, вес, доп.
ENEMIES = {
    # --- Улей-Город: культисты, мутанты, бомберы ------------------------
    # ash=3, а не 2: проход M4 показал, что ранние смерти лечатся темпом набора
    # арсенала, а не живучестью (BALANCE.md §7). Правка жила только в конфиге и
    # была снесена очередным патчем — теперь она здесь, в источнике правды.
    "e_cultist": dict(name="Культист", color="#8a6a4a", ai=CHASE, hp=8, damage=3,
                      speed=92, size=14, ash=3, xp=1, score=2,
                      arenas=["ar_hive"], min_wave=1, max_wave=12, weight=10),
    "e_flesh": dict(name="Ком плоти", color="#9a4a5a", ai=CHASE, hp=26, damage=7,
                    speed=62, size=20, ash=3, xp=2, score=5, kb=0.6,
                    arenas=["ar_hive"], min_wave=2, max_wave=20, weight=6),
    "e_spitter": dict(name="Плевальщик", color="#6a8f4a", ai=SHOOTER, hp=12, damage=5,
                      speed=70, size=15, ash=3, xp=2, score=4,
                      attack=ranged(2.2, 300, 220, 260, 1.6, 6, "p_venom"),
                      arenas=["ar_hive"], min_wave=3, max_wave=20, weight=5),
    "e_hiverat": dict(name="Ульевая крыса", color="#7a6a5a", ai=CHASE, hp=5, damage=2,
                      speed=118, size=11, ash=2, xp=1, score=1,
                      arenas=["ar_hive"], min_wave=1, max_wave=8, weight=8),
    "e_zealot": dict(name="Одержимый", color="#c8703a", ai=CHARGER, hp=18, damage=8,
                     speed=84, size=16, ash=3, xp=2, score=5,
                     arenas=["ar_hive"], min_wave=4, max_wave=20, weight=6),
    "e_bomber": dict(name="Смертник", color="#a8442a", ai=BOMBER, hp=14, damage=16,
                     speed=100, size=16, ash=3, xp=3, score=7,
                     arenas=["ar_hive"], min_wave=5, max_wave=20, weight=4),
    "e_censerbearer": dict(name="Кадиленосец", color="#c8a35a", ai=SUPPORT, hp=22, damage=4,
                           speed=66, size=17, ash=3, xp=3, score=8,
                           arenas=["ar_hive"], min_wave=7, max_wave=20, weight=3),

    # --- Пепельные Пустоши: орда, дикари, метатели ----------------------
    "e_scavenger": dict(name="Падальщик", color="#8aa84a", ai=CHASE, hp=10, damage=4,
                        speed=104, size=14, ash=2, xp=1, score=3,
                        arenas=["ar_ash"], min_wave=1, max_wave=12, weight=10),
    "e_brute": dict(name="Верзила", color="#6d8f3a", ai=CHASE, hp=44, damage=11,
                    speed=56, size=24, sprite=64, ash=3, xp=4, score=12, kb=0.8,
                    arenas=["ar_ash"], min_wave=4, max_wave=20, weight=5),
    "e_slinger": dict(name="Метатель", color="#9a8a4a", ai=SHOOTER, hp=13, damage=6,
                      speed=76, size=15, ash=3, xp=2, score=5,
                      attack=ranged(1.9, 340, 250, 300, 1.5, 5, "p_slug"),
                      arenas=["ar_ash"], min_wave=2, max_wave=20, weight=6),
    "e_ashhound": dict(name="Пепельный пёс", color="#7a7060", ai=CHARGER, hp=12, damage=6,
                       speed=132, size=13, ash=2, xp=2, score=4,
                       arenas=["ar_ash"], min_wave=3, max_wave=20, weight=7),
    "e_chainganger": dict(name="Цепник", color="#8a5a3a", ai=CHASE, hp=30, damage=9,
                          speed=74, size=19, ash=3, xp=3, score=9,
                          arenas=["ar_ash"], min_wave=6, max_wave=20, weight=5),
    "e_scrapthrower": dict(name="Хламомёт", color="#a89a5a", ai=ORBITER, hp=20, damage=7,
                           speed=88, size=17, ash=3, xp=3, score=7,
                           attack=ranged(1.5, 280, 200, 320, 1.2, 6, "p_slug"),
                           arenas=["ar_ash"], min_wave=7, max_wave=20, weight=4),

    # --- Мёртвая Верфь: конструкты, дроны, рой ---------------------------
    "e_husk": dict(name="Литая шелуха", color="#5a6a6a", ai=CHASE, hp=16, damage=5,
                   speed=68, size=15, ash=3, xp=2, score=4, kb=0.7,
                   arenas=["ar_tomb"], min_wave=1, max_wave=14, weight=9),
    "e_drone": dict(name="Верфный дрон", color="#2fa8a0", ai=ORBITER, hp=14, damage=5,
                    speed=112, size=13, ash=3, xp=2, score=5,
                    attack=ranged(1.7, 300, 230, 380, 1.3, 5, "p_beam"),
                    arenas=["ar_tomb"], min_wave=2, max_wave=20, weight=7),
    "e_swarmlet": dict(name="Рой-мелочь", color="#4d8f6b", ai=SPLITTER, hp=7, damage=3,
                       speed=124, size=10, ash=1, xp=1, score=2,
                       arenas=["ar_tomb"], min_wave=1, max_wave=20, weight=9),
    "e_warden": dict(name="Сторожевой литой", color="#3a8a86", ai=CHASE, hp=56, damage=13,
                     speed=48, size=26, sprite=64, ash=3, xp=5, score=16, kb=0.9,
                     arenas=["ar_tomb"], min_wave=5, max_wave=20, weight=4),
    "e_hatcher": dict(name="Кладочник", color="#6aa88a", ai=SUMMONER, hp=34, damage=6,
                      speed=58, size=20, ash=3, xp=4, score=12,
                      arenas=["ar_tomb"], min_wave=6, max_wave=20, weight=3),
}

# Элита = обычный тип, раздутый множителями из config.waves. Здесь только
# от кого она растёт и на какой арене встречается.
ELITES = {
    "el_butcherling": ("e_flesh", "Мясничий выродок", "ar_hive"),
    "el_archzealot": ("e_zealot", "Архиодержимый", "ar_hive"),
    "el_warboss": ("e_brute", "Вожак-верзила", "ar_ash"),
    "el_houndmaster": ("e_ashhound", "Псарь", "ar_ash"),
    "el_ironwarden": ("e_warden", "Железный страж", "ar_tomb"),
    "el_broodqueen": ("e_hatcher", "Матка кладки", "ar_tomb"),
}

BOSSES = {
    "b_butcher": dict(name="Мясник Улья", color="#a83a3a", ai=CHASE, hp=900, damage=16,
                      speed=58, size=44, sprite=112, ash=60, xp=40, score=250, kb=0.95,
                      arenas=["ar_hive"],
                      phases=[{"hp_pct": 1.0, "pattern": "chase", "speed_mult": 1.0},
                              {"hp_pct": 0.6, "pattern": "charge", "speed_mult": 1.6,
                               "damage_mult": 1.25}]),
    "b_rift_father": dict(name="Отец Скверны", color="#7a2f8f", ai=SHOOTER, hp=2200, damage=20,
                          speed=46, size=52, sprite=128, ash=140, xp=90, score=600, kb=1.0,
                          arenas=["ar_hive"],
                          attack=ranged(1.6, 460, 300, 260, 2.2, 9, "p_warp"),
                          phases=[{"hp_pct": 1.0, "pattern": "shooter", "speed_mult": 1.0},
                                  {"hp_pct": 0.6, "pattern": "spiral", "speed_mult": 1.3,
                                   "cooldown_mult": 0.55}]),
    "b_iron_chief": dict(name="Железный Вожак", color="#6d8f3a", ai=CHARGER, hp=1000, damage=18,
                         speed=64, size=46, sprite=112, ash=65, xp=42, score=270, kb=0.95,
                         arenas=["ar_ash"],
                         phases=[{"hp_pct": 1.0, "pattern": "charge", "speed_mult": 1.0},
                                 {"hp_pct": 0.6, "pattern": "chase", "speed_mult": 1.7,
                                  "damage_mult": 1.3}]),
    "b_ash_titan": dict(name="Пепельный Титан", color="#a89a5a", ai=CHASE, hp=2600, damage=24,
                        speed=40, size=58, sprite=128, ash=150, xp=95, score=650, kb=1.0,
                        arenas=["ar_ash"],
                        phases=[{"hp_pct": 1.0, "pattern": "chase", "speed_mult": 1.0},
                                {"hp_pct": 0.6, "pattern": "charge", "speed_mult": 1.5,
                                 "damage_mult": 1.4}]),
    "b_cast_sentinel": dict(name="Литой Сторож", color="#2fa8a0", ai=SHOOTER, hp=1100, damage=17,
                            speed=44, size=48, sprite=112, ash=70, xp=45, score=290, kb=1.0,
                            arenas=["ar_tomb"],
                            attack=ranged(1.4, 420, 280, 420, 1.6, 7, "p_beam"),
                            phases=[{"hp_pct": 1.0, "pattern": "shooter", "speed_mult": 1.0},
                                    {"hp_pct": 0.6, "pattern": "spiral", "speed_mult": 1.2,
                                     "cooldown_mult": 0.5}]),
    "b_barrow_lord": dict(name="Курганный Владыка", color="#3a8a86", ai=SUMMONER, hp=2800, damage=22,
                          speed=42, size=56, sprite=128, ash=160, xp=100, score=700, kb=1.0,
                          arenas=["ar_tomb"],
                          attack=ranged(1.8, 440, 290, 300, 2.0, 8, "p_warp"),
                          phases=[{"hp_pct": 1.0, "pattern": "shooter", "speed_mult": 1.0},
                                  {"hp_pct": 0.6, "pattern": "spiral", "speed_mult": 1.4,
                                   "cooldown_mult": 0.6}]),
}

ARENAS = {
    "ar_hive": dict(name="Улей-Город",
                    desc="Ржавые плиты, трубы и вечный смог нижних ярусов.",
                    ground=["gr_hive_a"], ground_color="#1a1c22", decor=["dc_pipe"],
                    boss_mid="b_butcher", boss_final="b_rift_father",
                    unlock={"type": "default"}),
    "ar_ash": dict(name="Пепельные Пустоши",
                   desc="Пепел по колено, кости и обломки того, что летало.",
                   ground=["gr_ash_a"], ground_color="#221f1a", decor=["dc_bones"],
                   boss_mid="b_iron_chief", boss_final="b_ash_titan",
                   unlock={"type": "relics", "cost": 400}),
    "ar_tomb": dict(name="Мёртвая Верфь",
                    desc="Тёмный металл, зелёные руны и то, что ещё шевелится в трюмах.",
                    ground=["gr_tomb_a"], ground_color="#141a1c", decor=["dc_hull"],
                    boss_mid="b_cast_sentinel", boss_final="b_barrow_lord",
                    unlock={"type": "relics", "cost": 1000}),
}

# id: имя, описание, фракция, цвет, стартовое оружие, статы, веса левелапа,
#     уникальная механика, условие открытия, спрайт
CHARACTERS = {
    "ch_pilgrim": dict(name="Пилигрим", faction="cov", color="#c8a35a",
                       desc="Странник без особых даров. Ровные статы — чистый холст.",
                       start=["w_cleaver_1"], stats={}, weights={}, unique=None,
                       unlock={"type": "default"}),
    "ch_zealot": dict(name="Ревнитель", faction="cov", color="#d8b36a",
                      desc="Чем ближе к смерти, тем яростнее удары.",
                      start=["w_censer_1"], stats={"melee_dmg": 4, "max_hp_pct": -20},
                      weights={"melee_dmg": 2.0, "ranged_dmg": 0.3, "elem_dmg": 0.5},
                      unique={"type": "low_hp_haste", "threshold": 0.5, "value": 0.30},
                      unlock={"type": "relics", "cost": 150}),
    "ch_flagellant": dict(name="Флагеллант", faction="cov", color="#b08a4a",
                          desc="Режет себя, чтобы бить сильнее. Считает это сделкой.",
                          start=["w_scourge_1"],
                          stats={"damage_pct": 40, "armor": -1, "max_hp_pct": -15},
                          weights={"damage_pct": 2.0, "armor": 0.2},
                          unique={"type": "self_harm_stack", "per_sec": 1, "value": 2},
                          unlock={"type": "relics", "cost": 400,
                                  "achievement": "ac_wave10"}),
    "ch_conductor": dict(name="Хормейстер", faction="cov", color="#e0c07a",
                         desc="Сам бьёт слабо, зато рядом с ним бьют все.",
                         start=["w_censer_1"], stats={"damage_pct": -20},
                         weights={"max_hp": 1.5, "armor": 1.5},
                         unique={"type": "ally_aura", "radius": 300,
                                 "damage_pct": 10, "armor": 1},
                         unlock={"type": "relics", "cost": 800,
                                 "achievement": "ac_coop4"}),
    "ch_brute": dict(name="Громила", faction="scrap", color="#6d8f3a", sprite=64,
                     desc="Чем больше врагов, тем ему веселее.",
                     start=["w_hammer_1"],
                     stats={"max_hp_pct": 30, "move_speed_pct": -20},
                     weights={"melee_dmg": 2.0, "max_hp": 1.5, "ranged_dmg": 0.0},
                     unique={"type": "damage_per_enemy", "value": 1},
                     unlock={"type": "relics", "cost": 200}),
    "ch_scavenger": dict(name="Падальщик", faction="scrap", color="#8aa84a",
                         desc="Бьёт слабее, зато уходит богаче.",
                         start=["w_nailer_1"], stats={"tithe": 4, "damage_pct": -10},
                         weights={"tithe": 2.0, "luck": 1.8},
                         unique={"type": "crate_chance", "value": 2.0},
                         unlock={"type": "relics", "cost": 350}),
    "ch_artificer": dict(name="Артифекс", faction="forge", color="#a83a2a",
                         desc="Воюет чужими руками — точнее, манипуляторами.",
                         start=["w_turret_1"],
                         stats={"engineering": 5, "ranged_dmg": -5},
                         weights={"engineering": 2.5, "melee_dmg": 0.3},
                         unique={"type": "repair_between_waves"},
                         unlock={"type": "relics", "cost": 250}),
    "ch_censor": dict(name="Цензор", faction="forge", color="#c04a36",
                      desc="Судит издалека и не берёт ничего, что требует подойти.",
                      start=["w_carbine_1"], stats={"range": 2, "attack_speed_pct": -20},
                      weights={"ranged_dmg": 2.0, "range": 1.5, "melee_dmg": 0.0},
                      unique={"type": "no_melee"},
                      unlock={"type": "relics", "cost": 450}),
    "ch_thrall": dict(name="Невольник", faction="chit", color="#4d8f6b",
                      desc="Быстрый и слабый. Живёт тем, что отнимает.",
                      start=["w_claws_1"],
                      stats={"attack_speed_pct": 50, "damage_pct": -40},
                      weights={"attack_speed_pct": 2.0, "lifesteal_pct": 1.8},
                      unique={"type": "lifesteal_per_melee", "value": 3},
                      unlock={"type": "relics", "cost": 300}),
    "ch_broodmate": dict(name="Выводковый", faction="chit", color="#5aa87a",
                         desc="Носит на себе выводок, который дерётся сам.",
                         start=["w_sickle_1"],
                         stats={"move_speed_pct": 15, "armor": -2},
                         weights={"move_speed_pct": 1.8, "elem_dmg": 1.2},
                         unique={"type": "larva_companion", "per_levels": 5},
                         unlock={"type": "relics", "cost": 600}),
    "ch_hierophant": dict(name="Иерофант", faction="rift", color="#7a2f8f",
                          desc="Стихия слушается его охотнее, чем собственное тело.",
                          start=["w_rod_1"],
                          stats={"elem_dmg": 6, "melee_dmg": -4},
                          weights={"elem_dmg": 2.5, "melee_dmg": 0.2},
                          unique={"type": "elem_chain", "targets": 1},
                          unlock={"type": "relics", "cost": 400}),
    "ch_hollow": dict(name="Полый", faction="rift", color="#9a4aa8",
                      desc="Начинает без оружия. Зато выбор ему дают вдвое чаще.",
                      start=[], stats={"luck": 10},
                      weights={"luck": 2.0},
                      unique={"type": "double_levelup", "slots_lost": 2},
                      unlock={"type": "relics", "cost": 900,
                              "achievement": "ac_win_d2"}),
    "ch_warden": dict(name="Хранитель Гробниц", faction="tomb", color="#2fa8a0", sprite=64,
                      desc="Медленный и несокрушимый. Лечится только сам собой.",
                      start=["w_forgedrone_1"],
                      stats={"armor": 5, "move_speed_pct": -25},
                      weights={"armor": 2.0, "max_hp": 1.5, "move_speed_pct": 0.3},
                      unique={"type": "only_self_regen", "value": 1},
                      unlock={"type": "relics", "cost": 500}),
    "ch_mirrorblade": dict(name="Зеркальный клинок", faction="mirror", color="#4a7fc8",
                           desc="Хрупкий, но попасть по нему надо ещё суметь.",
                           start=["w_stilettos_1"],
                           stats={"crit_pct": 15, "dodge_pct": 10, "max_hp_pct": -25},
                           weights={"crit_pct": 2.0, "dodge_pct": 1.8, "max_hp": 0.4},
                           unique={"type": "crit_iframes", "value": 0.3, "cooldown": 2.0},
                           unlock={"type": "relics", "cost": 700}),
}

ACHIEVEMENTS = {
    "ac_wave10": ("Десятая волна", "Дойти до волны 10.", {"type": "reach_wave", "value": 10}),
    "ac_wave20": ("Двадцатая волна", "Дойти до волны 20.", {"type": "reach_wave", "value": 20}),
    "ac_first_win": ("Первый пепел", "Победить в забеге.", {"type": "wins", "value": 1}),
    "ac_win_d1": ("Ратное дело", "Победить на сложности «Ратник».", {"type": "win_danger", "value": 1}),
    "ac_win_d2": ("Крестовый поход", "Победить на сложности «Крестоносец».", {"type": "win_danger", "value": 2}),
    "ac_win_d3": ("Мученический венец", "Победить на сложности «Мученик».", {"type": "win_danger", "value": 3}),
    "ac_coop4": ("Плечом к плечу", "Победить в комнате из 4+ игроков.", {"type": "win_coop", "value": 4}),
    "ac_coop8": ("Полный хор", "Победить в комнате из 8 игроков.", {"type": "win_coop", "value": 8}),
    "ac_boss5": ("Разделочник", "Убить 5 боссов.", {"type": "bosses", "value": 5}),
    "ac_kills1000": ("Тысяча имён", "Убить 1000 врагов за всё время.", {"type": "kills", "value": 1000}),
}


def build_enemies(config_render_default=48):
    out = {}
    for eid, e in ENEMIES.items():
        rec = {
            "name": e["name"], "texture": eid, "color": e["color"], "ai": e["ai"],
            "hp": e["hp"], "damage": e["damage"], "speed": e["speed"], "size": e["size"],
            "sprite": e.get("sprite", config_render_default),
            "ash": e["ash"], "xp": e["xp"], "score": e["score"],
            "arenas": list(e["arenas"]), "min_wave": e["min_wave"],
            "max_wave": e["max_wave"], "weight": e["weight"],
        }
        if "kb" in e:
            rec["knockback_resist"] = e["kb"]
        if "attack" in e:
            rec["attack"] = e["attack"]
        out[eid] = rec
    return out


def build_elites(enemies, waves):
    """Элита выводится из базового типа множителями из config.waves."""
    out = {}
    for elid, (base_id, name, arena) in ELITES.items():
        base = enemies[base_id]
        rec = dict(base)
        rec.update({
            "name": name,
            "texture": elid,
            "elite": True,
            "of": base_id,
            "hp": round(base["hp"] * waves["elite_hp_mult"], 2),
            "damage": round(base["damage"] * waves["elite_dmg_mult"], 2),
            "size": round(base["size"] * waves["elite_size_mult"]),
            "sprite": 64,
            "ash": base["ash"] * waves["elite_ash_mult"],
            "xp": base["xp"] * 4,
            "score": base["score"] * 6,
            "arenas": [arena],
            "knockback_resist": max(base.get("knockback_resist", 0), 0.7),
        })
        out[elid] = rec
    return out


def build_bosses(default_sprite=112):
    out = {}
    for bid, b in BOSSES.items():
        rec = {
            "name": b["name"], "texture": bid, "color": b["color"], "ai": b["ai"],
            "hp": b["hp"], "damage": b["damage"], "speed": b["speed"], "size": b["size"],
            "sprite": b.get("sprite", default_sprite),
            "ash": b["ash"], "xp": b["xp"], "score": b["score"],
            "arenas": list(b["arenas"]), "boss": True,
            "knockback_resist": b.get("kb", 1.0),
            "phases": [dict(p) for p in b["phases"]],
        }
        if "attack" in b:
            rec["attack"] = b["attack"]
        out[bid] = rec
    return out


def build_arenas(enemies, elites):
    out = {}
    for aid, a in ARENAS.items():
        pool = [eid for eid, e in enemies.items() if aid in e["arenas"]]
        elite_pool = [eid for eid, e in elites.items() if aid in e["arenas"]]
        out[aid] = {
            "name": a["name"], "desc": a["desc"],
            "ground": list(a["ground"]), "ground_color": a["ground_color"],
            "decor": list(a["decor"]),
            "enemy_pool": pool, "elite_pool": elite_pool,
            "boss_mid": a["boss_mid"], "boss_final": a["boss_final"],
            "unlock": dict(a["unlock"]),
        }
    return out


def build_characters(default_sprite=48):
    out = {}
    for cid, c in CHARACTERS.items():
        out[cid] = {
            "name": c["name"], "desc": c["desc"], "faction": c["faction"],
            "texture": cid, "color": c["color"],
            "sprite": c.get("sprite", default_sprite),
            "start_weapons": list(c["start"]),
            "stats": dict(c["stats"]),
            "levelup_weights": dict(c["weights"]),
            "unique": c["unique"],
            "unlock": dict(c["unlock"]),
        }
    return out


def build_achievements():
    return {aid: {"name": n, "desc": d, "cond": dict(c)}
            for aid, (n, d, c) in ACHIEVEMENTS.items()}


def validate(characters, weapons, arenas, factions):
    problems = []
    for cid, c in characters.items():
        if c["faction"] not in factions:
            problems.append(f"{cid}: неизвестная фракция {c['faction']}")
        for w in c["start_weapons"]:
            if w not in weapons:
                problems.append(f"{cid}: стартовое оружие {w} не существует")
    for aid, a in arenas.items():
        if not a["enemy_pool"]:
            problems.append(f"{aid}: пустой пул врагов")
        for key in ("boss_mid", "boss_final"):
            if not a[key]:
                problems.append(f"{aid}: не задан {key}")
    # Баланс архетипов по ТЗ §3.2
    melee = sum(1 for c in characters.values()
                if c["start_weapons"] and weapons[c["start_weapons"][0]]["class"] == "melee")
    if melee < 4:
        problems.append(f"ближних персонажей всего {melee}, ожидалось не меньше 4")
    if problems:
        raise SystemExit("контент не сходится:\n  " + "\n  ".join(problems))
    return True
