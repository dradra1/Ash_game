#!/usr/bin/env python3
"""Патч: единая громкость треков и длительности фейдов.

**Громкость.** Файлы выровнены по EBU R128 под −18 LUFS
(`tools/normalize_audio.py`), разброс между треками упал с 18.9 LU до 0.6 LU.
Поправки `gain` в конфиге после этого не нужны и вредны: они подбирались на глаз к
СТАРЫМ файлам, и оставить их — значит снова развести громкости. Все `gain` = 1.0.

Сам ключ остаётся: он для будущего исключения (трек, который выпадает из ряда, а
перекодировать его нельзя), просто сейчас исключений нет.

**Фейды.** Длительности были константами в `engine/audio.js`. Теперь:
  - `fade_ms` — обычная смена темы (лавка, меню, босс);
  - `wave_fade_ms` — вход в волну, вдвое с лишним длиннее: игрок выходит из лавки,
    и тема боя должна набрать громкость, а не включиться разом.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_audio_levels.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 43

AUDIO = {
    "fade_ms": 800,
    "wave_fade_ms": 2000,
}
TRACK_GAIN = 1.0


def patch(cfg):
    changed = []
    audio = cfg.setdefault("audio", {})
    for key, val in AUDIO.items():
        if audio.get(key) != val:
            audio[key] = val
            changed.append(f"audio.{key} = {val}")

    for tid, track in (audio.get("tracks") or {}).items():
        if track.get("gain") != TRACK_GAIN:
            track["gain"] = TRACK_GAIN
            changed.append(f"audio.tracks.{tid}.gain = {TRACK_GAIN}")

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
