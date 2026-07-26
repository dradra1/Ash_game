#!/usr/bin/env python3
"""Раскладка арен: вариации пола, декали и препятствия.

Идемпотентно, пишет сразу в обе копии конфига (CLAUDE.md §3.2): репо-сид
`config/game_config.json` и живой `data/game_config.json`.

    python3 tools/patch_config_arenas.py

Чего добавляет:
  arena.*          — параметры генерации: размер тайла, чанки, разброс, лимиты
  arenas.<id>.ground / ground_weights   — список вариаций пола и их веса
  arenas.<id>.decals                    — плоские пятна, запекаются в пол
  arenas.<id>.props                     — препятствия: texture, радиус, размер

Веса подобраны так, чтобы доминировал самый спокойный тайл, а выразительные
(решётка, руны, ржавая плита) шли редкими пятнами: пол должен давать фактуру и
не спорить со спрайтами (ASSETS.md §1).
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGETS = [
    os.path.join(ROOT, "config", "game_config.json"),
    os.path.join(ROOT, "data", "game_config.json"),
]

# Параметры генерации раскладки. Живут в arena, а не в arenas.<id>: они общие,
# различается только содержимое таблиц.
ARENA = {
    "tile_size": 32,
    "chunk_tiles": 7,              # 7 тайлов = чанк 224 px
    # Растушёвка границ чанков: у края тайл с этой вероятностью берёт вариацию
    # соседа. Без неё зоны стыкуются прямыми линиями и пол читается шахматкой.
    "tile_feather": 0.55,
    # Крапина внутри зоны выключена: она по определению даёт ОДИНОЧНЫЕ тайлы,
    # а один тайл другого тона посреди ровного пола читается как артефакт,
    # а не как фактура. Разнообразие даёт растушёвка границ, и её достаточно.
    "tile_scatter": 0.0,
    "props_max": 26,               # 44 превращали арену в свалку без единого просвета
    "props_min_gap": 118,          # просвет между завалами: орда должна проходить
    "props_center_clear": 240,     # чистый круг в центре — там стартуют игроки
    "props_wall_margin": 96,       # отступ от стен, чтобы кольцо спавна было проходимо
    "props_attempts_per_prop": 14,
    "decals_max": 90,
    "spawn_clear": 26,             # радиус проверки «точка спавна не в завале»
}

GROUND = {
    "ar_hive": {
        "ground": ["gr_hive_a", "gr_hive_b", "gr_hive_c", "gr_hive_d", "gr_hive_e"],
        "ground_weights": [10, 5, 6, 4, 2],
    },
    "ar_ash": {
        "ground": ["gr_ash_a", "gr_ash_b", "gr_ash_c", "gr_ash_d", "gr_ash_e"],
        # Пепел светлее прочих арен (открытое небо против нижних ярусов), поэтому
        # доминанта — самая тёмная вариация, а светлые идут редкими проплешинами.
        "ground_weights": [12, 6, 4, 3, 1],
    },
    "ar_tomb": {
        "ground": ["gr_tomb_a", "gr_tomb_b", "gr_tomb_c", "gr_tomb_d", "gr_tomb_e"],
        "ground_weights": [10, 4, 3, 5, 2],
    },
}

# r — радиус коллизии, size — сторона спрайта. Спрайт всегда крупнее коллайдера:
# у завала есть «пола», по которой ходят, иначе он читается больше, чем мешает.
PROPS = {
    "ar_hive": [
        {"texture": "dc_pipe", "r": 30, "size": 96, "weight": 4},
        {"texture": "dc_girder", "r": 26, "size": 88, "weight": 3},
        {"texture": "dc_container", "r": 34, "size": 104, "weight": 2},
        {"texture": "dc_vent", "r": 20, "size": 64, "weight": 1},
    ],
    "ar_ash": [
        {"texture": "dc_bones", "r": 28, "size": 96, "weight": 4},
        {"texture": "dc_wreck", "r": 34, "size": 112, "weight": 2},
        {"texture": "dc_scrap", "r": 24, "size": 80, "weight": 3},
        {"texture": "dc_rock", "r": 22, "size": 72, "weight": 3},
    ],
    "ar_tomb": [
        {"texture": "dc_hull", "r": 34, "size": 112, "weight": 3},
        {"texture": "dc_monolith", "r": 22, "size": 80, "weight": 3},
        {"texture": "dc_cradle", "r": 30, "size": 96, "weight": 2},
        {"texture": "dc_slabs", "r": 24, "size": 80, "weight": 3},
    ],
}

# Альфа низкая намеренно: декаль — тональная вариация пола, а не клякса на нём.
# dcl_paint и dcl_verdigris в таблицы не вошли: модель рисует их кислотно-яркими
# (оранжевый треугольник, салатовое пятно), а светлое пятно на тёмном полу спорит
# со спрайтами. PNG лежат в static/textures, но конфигом не используются.
DECALS = {
    "ar_hive": [
        {"texture": "dcl_oil", "size": 64, "alpha": 0.55, "weight": 4},
        {"texture": "dcl_soot", "size": 56, "alpha": 0.45, "weight": 4},
        {"texture": "dcl_scorch", "size": 56, "alpha": 0.4, "weight": 2},
    ],
    "ar_ash": [
        {"texture": "dcl_burn", "size": 64, "alpha": 0.5, "weight": 4},
        {"texture": "dcl_drift", "size": 72, "alpha": 0.35, "weight": 4},
        {"texture": "dcl_crack", "size": 56, "alpha": 0.45, "weight": 3},
    ],
    "ar_tomb": [
        {"texture": "dcl_rune", "size": 64, "alpha": 0.45, "weight": 2},
        {"texture": "dcl_scorch", "size": 56, "alpha": 0.45, "weight": 4},
        {"texture": "dcl_soot", "size": 56, "alpha": 0.4, "weight": 3},
    ],
}


def patch(cfg):
    """Возвращает True, если конфиг изменился."""
    changed = False

    # Радиус, с которым прах выталкивается из завала: ровно по краю он визуально
    # тонет в спрайте, пары пикселей запаса хватает.
    if cfg.setdefault("sim", {}).get("pickup_radius") != 6:
        cfg["sim"]["pickup_radius"] = 6
        changed = True

    arena = cfg.setdefault("arena", {})
    for k, v in ARENA.items():
        if arena.get(k) != v:
            arena[k] = v
            changed = True

    for aid, arena_cfg in cfg.get("arenas", {}).items():
        for key, table in (("props", PROPS), ("decals", DECALS)):
            want = table.get(aid)
            if want is not None and arena_cfg.get(key) != want:
                arena_cfg[key] = want
                changed = True
        want_ground = GROUND.get(aid)
        if want_ground:
            for k, v in want_ground.items():
                if arena_cfg.get(k) != v:
                    arena_cfg[k] = v
                    changed = True

    return changed


def main():
    loaded = []
    for path in TARGETS:
        if not os.path.exists(path):
            print(f"{path}: нет файла, пропуск")
            continue
        with open(path, encoding="utf-8") as f:
            loaded.append((path, json.load(f)))

    dirty = [(p, c) for p, c in loaded if patch(c)]
    if not dirty:
        print("уже применено")
        return

    # Версия общая на обе копии, а не «своя +1» у каждой: по content_version хост
    # и клиент сверяют конфиг, и разъехавшиеся номера дали бы вечную перезагрузку
    # конфига в лобби на ровном месте.
    version = max(c.get("content_version", 0) for _, c in loaded) + 1
    for path, cfg in dirty:
        cfg["content_version"] = version
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"{path}: обновлено, content_version={version}")


if __name__ == "__main__":
    main()
