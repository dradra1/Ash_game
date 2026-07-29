#!/usr/bin/env python3
"""Патч: новый архетип врага — рывок в упреждение назад («Багровый рвач»).

Поведение. Догоняет обычным шагом; на дистанции `charge.range` замирает и
КРАСНЕЕТ ровно `charge.windup` секунд, потом бьёт рывком. Бьёт не в игрока, а в
точку, где тот был `charge.lead` секунд назад: прицел снимается в середине
подготовки и больше не пересчитывается.

Отсюда единственное правило уклонения: не стоять на месте, пока он краснеет.
Отскок в последний момент не спасает и не нужен — рывок и так уйдёт в след.
Тем же обеспечивается честность в коопе: рывок целится в место, а не в игрока,
и клиенту незачем знать о нём что-либо, кроме флага telegraph в снапшоте.

Появляется с 9-й волны (`min_wave`), то есть «после 8-й» из постановки. Ставится
во все три арены: механика уклонения общая и от декораций не зависит.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_charger.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 45

ENEMY_ID = "e_lunger"

# Числа рывка держатся друг за друга, поэтому меняются вместе:
#   speed × duration = 620 × 0.45 ≈ 279 px — чуть больше range (260), то есть
#   рывок ДОЛЕТАЕТ до запомненной точки и немного проносит дальше.
#   lead (1.0) вдвое меньше windup (2.0): прицел снимается ровно на середине
#   подготовки, и у игрока есть целая секунда, чтобы уйти с этой точки.
ENEMY = {
    "name": "Багровый рвач",
    "texture": "e_lunger",
    "color": "#a33a34",
    "ai": "charger",
    "hp": 34,
    "damage": 8,
    "speed": 58,
    "size": 16,
    "sprite": 48,
    "ash": 5,
    "xp": 5,
    "score": 9,
    "arenas": ["ar_hive", "ar_ash", "ar_tomb"],
    "min_wave": 9,
    "max_wave": 20,
    "weight": 5,
    "knockback_resist": 0.35,
    "charge": {
        "range": 260,
        "windup": 2.0,
        "lead": 1.0,
        "speed": 620,
        "duration": 0.45,
        "recover": 0.7,
        "cooldown": 3.0,
        "damage_mult": 2.0,
    },
}

RENDER = {
    # Подготовка рывка: спрайт заливается этим цветом, доля заливки пульсирует.
    # Пульс, а не ровная заливка: неподвижный красный силуэт в толпе теряется,
    # а мигание видно боковым зрением — по нему и читается угроза.
    "telegraph_color": "#e03a2a",
    "telegraph_alpha": 0.72,
    "telegraph_pulse_hz": 4,
}


def patch(cfg):
    changed = []

    enemies = cfg.setdefault("enemies", {})
    if enemies.get(ENEMY_ID) != ENEMY:
        changed.append(f"enemies.{ENEMY_ID}")
        enemies[ENEMY_ID] = json.loads(json.dumps(ENEMY))

    # Пул арены: без этого враг существует в конфиге, но не спавнится никогда
    for arena_id in ENEMY["arenas"]:
        arena = cfg.get("arenas", {}).get(arena_id)
        if not arena:
            continue
        pool = arena.setdefault("enemy_pool", [])
        if ENEMY_ID not in pool:
            pool.append(ENEMY_ID)
            changed.append(f"arenas.{arena_id}.enemy_pool += {ENEMY_ID}")

    render = cfg.setdefault("render", {})
    for k, v in RENDER.items():
        if render.get(k) != v:
            changed.append(f"render.{k}: {render.get(k)!r} → {v!r}")
            render[k] = v

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
