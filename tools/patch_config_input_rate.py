#!/usr/bin/env python3
"""Патч: частота отправки ввода клиентом 30 → 60 Гц (один пакет на тик симуляции).

Зачем. Клиент предсказывает своё движение и пересобирает предсказание по
подтверждённому номеру ввода (`net/client.js`). Пока ввод шёл 30 Гц, а симуляция
крутилась на 60, один ввод хост применял ДВА тика, и сколько именно из них он
успел применить к моменту снапшота — клиенту неизвестно. Остаток в один тик
(≈1.7 px) при каждом снапшоте выглядел как мелкая дрожь на остановке.

При 60 Гц ввод и тик соотносятся один к одному, остаток падает до полпикселя.
Заодно вдвое сокращается задержка на управление: нажатие уезжает хосту не через
33 мс, а через 16.

Трафик: пакет ввода — 8 байт, то есть 480 Б/с на клиента вверх (было 240).
Бюджет 30 КБ/с из ТЗ — про снапшоты вниз, и его это не трогает.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_input_rate.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 39
INPUT_HZ = 60


def patch(cfg):
    changed = []
    net = cfg.setdefault("net", {})
    if net.get("input_hz") != INPUT_HZ:
        net["input_hz"] = INPUT_HZ
        changed.append(f"net.input_hz = {INPUT_HZ}")

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
