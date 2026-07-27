#!/usr/bin/env python3
"""Патч: у дропа праха появляется спрайт-кучка вместо жёлтого кружка.

Дроп рисовался сплошным кругом `render.ash_color` радиусом `ash_size/2` — единственная
сущность в мире без текстуры. Теперь это обычный объект мира: `render.ash_texture`
задаёт texture-id, `renderer.drawObject` сам падает на цветной квадрат, если PNG нет
(CLAUDE.md §3 п.3 — добавить графику значит положить файл).

`ash_size` 8 → 16: кучка в 8 пикселей рядом с персонажем в 48 не читается, а
кружок таким и был. 16 совпадает с `fit` промпта в tools/assets.json — картинка
рисуется пиксель-в-пиксель, без ужатия на канвасе.

`ash_color` остаётся: это фолбэк, пока текстура не загрузилась или отсутствует.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_ash_pickup.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 40

RENDER = {
    "ash_texture": "pk_ash",
    "ash_size": 16,
}


def patch(cfg):
    changed = []
    render = cfg.setdefault("render", {})
    for key, val in RENDER.items():
        if render.get(key) != val:
            render[key] = val
            changed.append(f"render.{key} = {val}")

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
