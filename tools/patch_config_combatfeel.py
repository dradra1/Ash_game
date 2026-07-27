#!/usr/bin/env python3
"""Патч: ощущение боя — поза покоя оружия и цена стата дальности.

  render.weapon_rest_dist / weapon_rest_spread
        Оружие рисуется ВСЕГДА, веером вокруг игрока, а не только в момент замаха.
        Замах короче перезарядки в разы (пика: 0.18 с анимации против 1.05 с
        кулдауна — спрайт был на экране 17% времени), из-за чего игрок стоял с
        пустыми руками и «вздрагивал» оружием. dist — вынос от центра в долях
        радиуса замаха, spread — угол между соседними стволами в радианах.

  stats.range_melee_cooldown_pct  0.35 → 0.12
        Каждое очко дальности удлиняло перезарядку ближнего боя на 35% при выгоде
        всего в 10 px (range_step_px 20 × range_melee_factor 0.5). Стат лежит в
        пуле улучшений с весом 5 и шагами до 3, поэтому пара взятий разгоняла пику
        с 1.05 с до 2+ с на удар — это и есть «оружие блокируется перед атакой».
        Налог остаётся (дальнобойный тесак не должен быть бесплатным), но перестаёт
        превращать оружие в неиграбельное.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_combatfeel.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 23

RENDER_SET = {
    "weapon_rest_dist": 0.55,
    "weapon_rest_spread": 0.42,
}

STATS_SET = {
    "range_melee_cooldown_pct": 0.12,
}


def patch(cfg):
    changed = []

    render = cfg.setdefault("render", {})
    for k, v in RENDER_SET.items():
        if render.get(k) != v:
            render[k] = v
            changed.append(f"render.{k} = {v}")

    stats = cfg.setdefault("stats", {})
    for k, v in STATS_SET.items():
        if stats.get(k) != v:
            stats[k] = v
            changed.append(f"stats.{k} = {v}")

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
