#!/usr/bin/env python3
"""Патч: мобильный режим — зум камеры под маленький вьюпорт, вид джойстика,
подписи экранных кнопок.

`render.min_view_units` — сколько мировых единиц обязано помещаться по короткой
стороне экрана. Пока условие не выполнено, рендер уменьшает целочисленный
масштаб мир→device-px (engine/render.js). На десктопе 1920×1080 условие
выполняется сразу, поэтому масштаб там остаётся прежним.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_touch.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 56

# 500 подобрано под телефон 1080 device-px по ширине: масштаб 2 даёт 540 юнитов
# обзора (условие выполнено), масштаб 3 — только 360 (не выполнено, снижаем).
RENDER = {
    "min_view_units": 500,
    "joystick": {
        "ring_color": "#c9c4b8",
        "ring_alpha": 0.3,
        "ring_width": 2,
        "thumb_color": "#c8a35a",
        "thumb_alpha": 0.55,
        # Радиус шляпки; ход джойстика — прежний render.joystick_radius
        "thumb_radius": 16,
    },
}

I18N = {
    "ru": {
        # Глиф на кнопке паузы: подпись словом не влезает в тап-таргет 44 px
        "ui.touch.pause": "❙❙",
        "ui.touch.pause_title": "Пауза",
        "ui.pause.debug": "Отладка",
    },
    "en": {
        "ui.touch.pause": "❙❙",
        "ui.touch.pause_title": "Pause",
        "ui.pause.debug": "Debug",
    },
}


def patch(cfg):
    changed = []

    render = cfg.setdefault("render", {})
    for key, want in RENDER.items():
        if render.get(key) != want:
            render[key] = json.loads(json.dumps(want))
            changed.append(f"render.{key}")

    i18n = cfg.setdefault("i18n", {})
    for lang, pairs in I18N.items():
        table = i18n.setdefault(lang, {})
        for key, value in pairs.items():
            if table.get(key) != value:
                table[key] = value
                changed.append(f"i18n.{lang}.{key}")

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
