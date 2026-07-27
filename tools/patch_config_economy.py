#!/usr/bin/env python3
"""Патч: экономика, хил на волне и вампиризм.

Что меняется и почему:

  coop.ash_share_target   заменяет coop.ash_per_player. Старая константа была
                          независимой компенсацией деления котла, но кооп уже
                          множит число врагов на budget_per_player, и эти два
                          множителя перемножались: при 8 игроках доля на брата
                          выходила ~3.4 дохода соло. Теперь economy.dropMultiplier
                          считает компенсацию как N / budgetScale, а этот ключ —
                          единственная ручка (1.0 = «как соло»).

  run.heal_on_wave_pct    доля максимума HP, которая возвращается всем в начале
                          каждой волны (соло и кооп). 1.0 — полное восстановление.
                          Заодно поднимает выбывших, поэтому coop.revive_hp_pct
                          больше не читается и удаляется.

  stats.lifesteal_heal    сколько HP лечит сработавший вампиризм. Сам lifesteal_pct
                          стал ШАНСОМ в процентах на каждое попадание, а не долей
                          урона добивающего удара.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_economy.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 21

COOP_SET = {"ash_share_target": 1.0}
COOP_DROP = ["ash_per_player", "revive_hp_pct"]

RUN_SET = {"heal_on_wave_pct": 1.0}

STATS_SET = {"lifesteal_heal": 3}


def patch(cfg):
    changed = []

    coop = cfg.setdefault("coop", {})
    for k, v in COOP_SET.items():
        if coop.get(k) != v:
            coop[k] = v
            changed.append(f"coop.{k} = {v}")
    for k in COOP_DROP:
        if k in coop:
            del coop[k]
            changed.append(f"coop.{k} удалён (больше не читается)")

    run = cfg.setdefault("run", {})
    for k, v in RUN_SET.items():
        if run.get(k) != v:
            run[k] = v
            changed.append(f"run.{k} = {v}")

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
