#!/usr/bin/env python3
"""Патч: секция input для геймпада (deadzone + кнопки Standard Gamepad).

Нумерация — Standard Gamepad Mapping: 0=A, 1=B, 2=X, 3=Y, 4=LB, 9=Start,
12–15 — крестовина (вверх, вниз, влево, вправо).

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_gamepad.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 32

INPUT = {
    "gamepad_deadzone": 0.25,
    "gamepad_buttons": {
        "buy": 0,
        # B — «назад» в меню: единственная кнопка, которую игрок ищет вслепую.
        "cancel": 1,
        "lock": 2,
        "merge": 3,
        "reroll": 4,
        "ready": 9,
        # Крестовина целиком: вверх/вниз для списков меню (ui/focus.js),
        # влево/вправо для слотов лавки (shop_ui.handleInput).
        "focus_up": 12,
        "focus_down": 13,
        "focus_prev": 14,
        "focus_next": 15,
    },
}


def patch(cfg):
    changed = []
    want = INPUT
    cur = cfg.get("input")
    if cur != want:
        cfg["input"] = {
            "gamepad_deadzone": want["gamepad_deadzone"],
            "gamepad_buttons": dict(want["gamepad_buttons"]),
        }
        changed.append("input")

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
