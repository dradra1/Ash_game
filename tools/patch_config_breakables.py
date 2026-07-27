#!/usr/bin/env python3
"""Патч: ломаемые мини-ивенты на аренах.

Что это. На каждой волне на арене встают несколько объектов, которые можно разбить
оружием ради разовой выгоды: подлечиться, получить прах, расшвырять толпу или,
наоборот, стянуть её в кучу под залп. Точки раскладки детерминированы сидом арены,
поэтому по сети ничего не передаётся — кооп-клиент строит ту же раскладку сам.

Как устроено. Объекты живут в ПУЛЕ ВРАГОВ с `ai: "static"`. Так им бесплатно
достаются HP, наведение оружия, урон от всех снарядов, снапшот и кооп-синхронизация,
и не приходится заводить второй пул со своей сеткой и своими сетевыми сообщениями.
От врагов их отличают `breakable: true` (не идут в убийства, очки и опыт) и `reward`.

Коллизий у них нет намеренно: иначе разрушение меняло бы проходимость арены, и
клиенту пришлось бы синхронно перестраивать индекс препятствий, а до тех пор
предсказание движения выдёргивало бы игрока в месте уже снесённой бочки.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_breakables.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 30

# Параметры раскладки. Отступ от центра меньше, чем у завалов: мини-ивент должен
# попадаться на глаза, а не стоять по углам.
ARENA = {
    "breakables_max": 5,
    "breakables_prop_gap": 22,
    "breakables_min_gap": 240,
    "breakables_wall_margin": 120,
    "breakables_center_clear": 170,
}

# hp намеренно низкий и НЕ растёт с волной (scaleHp множит на hp_growth, поэтому
# базу держим маленькой): разбить объект должно быть делом одного-двух ударов,
# иначе игрок тратит на бочку окно, в котором его едят.
BREAKABLES = {
    "br_reliquary": {
        "name": "Треснувший реликварий",
        "texture": "br_reliquary",
        "color": "#c8a35a",
        "ai": "static",
        "breakable": True,
        "hp": 12,
        "damage": 0,
        "speed": 0,
        "size": 16,
        "sprite": 32,
        "ash": 0,
        "xp": 0,
        "score": 0,
        "knockback_resist": 1.0,
        "reward": {"type": "heal", "value": 10},
    },
    "br_ash_urn": {
        "name": "Урна с прахом",
        "texture": "br_ash_urn",
        "color": "#9aa0a8",
        "ai": "static",
        "breakable": True,
        "hp": 12,
        "damage": 0,
        "speed": 0,
        "size": 16,
        "sprite": 32,
        "ash": 0,
        "xp": 0,
        "score": 0,
        "knockback_resist": 1.0,
        "reward": {"type": "ash", "value": 10},
    },
    "br_censer": {
        "name": "Гулкое кадило",
        "texture": "br_censer",
        "color": "#6a9fc8",
        "ai": "static",
        "breakable": True,
        "hp": 16,
        "damage": 0,
        "speed": 0,
        "size": 16,
        "sprite": 32,
        "ash": 0,
        "xp": 0,
        "score": 0,
        "knockback_resist": 1.0,
        # Расшвыривает толпу: окно на передышку
        "reward": {"type": "push", "value": 26, "radius": 220},
    },
    "br_lodestone": {
        "name": "Тяговый камень",
        "texture": "br_lodestone",
        "color": "#7a2f8f",
        "ai": "static",
        "breakable": True,
        "hp": 16,
        "damage": 0,
        "speed": 0,
        "size": 16,
        "sprite": 32,
        "ash": 0,
        "xp": 0,
        "score": 0,
        "knockback_resist": 1.0,
        # Наоборот, стягивает: подарок для веерного оружия и наказание для зевак
        "reward": {"type": "pull", "value": 22, "radius": 240},
    },
}

# Что и с каким весом встречается на арене. Веса одинаковые: пусть все четыре
# вида попадаются, а редкость задаётся числом точек, а не перекосом таблицы.
PER_ARENA = [
    {"type": "br_reliquary", "r": 14, "weight": 10},
    {"type": "br_ash_urn", "r": 14, "weight": 10},
    {"type": "br_censer", "r": 14, "weight": 8},
    {"type": "br_lodestone", "r": 14, "weight": 8},
]


def patch(cfg):
    changed = []

    arena = cfg.setdefault("arena", {})
    for k, v in ARENA.items():
        if arena.get(k) != v:
            arena[k] = v
            changed.append(f"arena.{k} = {v}")

    br = cfg.setdefault("breakables", {})
    for key, entry in BREAKABLES.items():
        if br.get(key) != entry:
            br[key] = json.loads(json.dumps(entry))
            changed.append(f"breakables.{key}")

    for arena_id, a in cfg.get("arenas", {}).items():
        want = json.loads(json.dumps(PER_ARENA))
        if a.get("breakables") != want:
            a["breakables"] = want
            changed.append(f"arenas.{arena_id}.breakables")

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
