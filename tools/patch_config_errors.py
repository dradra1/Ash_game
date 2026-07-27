#!/usr/bin/env python3
"""Патч: текст ошибки «забег не запустился».

Мастер настройки прячет свою панель до того, как забег реально начнётся, поэтому
любая осечка старта выглядит для игрока как «нажал „Дальше“ и вернулся в главное
меню» — без единого слова о причине. Именно так проявлялась поломка с проклятиями.
Сам сбой починен, но молчание — отдельный дефект: следующая осечка (протухшая
сессия, упавший сервер) выглядела бы так же загадочно.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_errors.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 36

TEXTS = {
    "ru": {"ui.error.run_start": "Забег не запустился — попробуй ещё раз"},
    "en": {"ui.error.run_start": "Could not start the run — try again"},
}


def patch(cfg):
    changed = []
    i18n = cfg.setdefault("i18n", {})
    for lang, pairs in TEXTS.items():
        d = i18n.setdefault(lang, {})
        for k, v in pairs.items():
            if d.get(k) != v:
                d[k] = v
                changed.append(f"i18n.{lang}.{k}")

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
