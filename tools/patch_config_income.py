#!/usr/bin/env python3
"""Патч: кривая дохода праха по волнам и масштаб десятины.

Цель заказчика — сколько игрок ПОЛУЧАЕТ за волну:

    волна   1    2    7    13   20
    прах   ~50  ~80  ~200 ~600 ~800

Промежуточные значения — линейной интерполяцией между опорными точками
(economy.wave_income_target). Мерить так: `node tools/playtest.js --god`,
колонка «доход».

Почему нужна поволновая поправка. Убийств за волну растёт почти квадратично
(волна 1 — шесть врагов, волна 16 — под три сотни), а цель растёт почти линейно.
Без калибровки первые волны нищие (12 праха при цели 50 — не хватает даже на
предмет первого тира), а поздние ломают лавку (3182 при цели 686).

Второй разгон — стат «десятина». Он прибавлялся ПЛОСКО к каждому убийству:
при 40 накопленной десятины враг ценой 3 приносил 43. Теперь это доля от праха
врага (stats.tithe_scale), и стат остаётся полезным, но не подменяет собой всю
экономику.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_income.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 28

WAVES = 20
# Опорные точки из ТЗ: волна → прах за волну
ANCHORS = [(1, 50), (2, 80), (7, 200), (13, 600), (20, 800)]

# Десятина как доля от праха врага
TITHE_SCALE = 0.04

# Поправка дохода по волнам. Значения подобраны прогонами playtest: делим цель на
# измеренный доход при множителе 1.0 и сглаживаем. Пересчитывать после любой правки
# спавна, цен или живучести врагов — доход считается от числа убийств.
# Волны 10 и 20 — боссовые: босс приносит 60–160 праха сверх толпы, поэтому там
# множитель заметно ниже соседних, иначе волна выбивается горбом.
WAVE_ASH_MULT = [
    4.30, 2.75, 1.83, 1.60, 1.17, 0.83, 0.72,   # 1..7
    0.79, 0.73, 0.46, 0.88, 0.87, 0.96,         # 8..13
    0.88, 0.82, 0.78, 0.75, 0.75, 0.66, 0.46,   # 14..20
]


def target_curve():
    """Целевой доход по волнам: линейная интерполяция между опорными точками."""
    out = []
    for w in range(1, WAVES + 1):
        lo = max((a for a in ANCHORS if a[0] <= w), key=lambda a: a[0])
        hi = min((a for a in ANCHORS if a[0] >= w), key=lambda a: a[0], default=lo)
        if lo[0] == hi[0]:
            out.append(float(lo[1]))
        else:
            k = (w - lo[0]) / (hi[0] - lo[0])
            out.append(round(lo[1] + (hi[1] - lo[1]) * k, 1))
    return out


def patch(cfg):
    changed = []

    econ = cfg.setdefault("economy", {})
    want_target = target_curve()
    if econ.get("wave_income_target") != want_target:
        econ["wave_income_target"] = want_target
        changed.append("economy.wave_income_target")
    if econ.get("wave_ash_mult") != WAVE_ASH_MULT:
        econ["wave_ash_mult"] = list(WAVE_ASH_MULT)
        changed.append("economy.wave_ash_mult")

    stats = cfg.setdefault("stats", {})
    if stats.get("tithe_scale") != TITHE_SCALE:
        stats["tithe_scale"] = TITHE_SCALE
        changed.append(f"stats.tithe_scale = {TITHE_SCALE}")

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
