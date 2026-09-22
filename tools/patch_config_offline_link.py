#!/usr/bin/env python3
"""Патч: подпись ссылки «Скачать офлайн-версию» в меню города.

Офлайн-APK (ветка offline, android-offline/) лежит в data/ и раздаётся
/download/apk-offline; ссылка в городе видна, только когда файл есть
(__BOOT__.offline_apk из app.py).

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_offline_link.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 57

I18N = {
    "ru": {
        "ui.menu.offline_apk": "Скачать офлайн-версию",
        "ui.menu.offline_apk_title": "Android-APK для одиночной игры без интернета",
    },
    "en": {
        "ui.menu.offline_apk": "Download offline version",
        "ui.menu.offline_apk_title": "Android APK for single-player without internet",
    },
}


def patch(cfg):
    changed = []

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
