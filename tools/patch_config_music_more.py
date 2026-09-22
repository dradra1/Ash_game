#!/usr/bin/env python3
"""Патч: ещё четыре боевые темы — в ротации волн их теперь семь.

Было три боевых трека, и два из них — короткие лупы (57 и 25 с) при волнах по
20–60 с: за забег одна и та же тема звучала по семь раз и всегда с начала.
Новые — длинные (96–198 с), все CC0 с opengameart.org, перекодированы в Ogg
Vorbis q2 и выровнены под −18 LUFS тем же двухпроходным loudnorm, что и
остальные (tools/normalize_audio.py, CREDITS.md). Порядок тем на забег
перемешивается от сида (engine/audio.js: waveMusicOrder), а прерванная тема
продолжается с того же места.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_music_more.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 58

TRACKS = {
    "mu_wave_d": {
        "src": "/static/audio/mu_wave_d.ogg",
        "title": "Battle Theme A",
        "author": "cynicmusic",
        "license": "CC0",
        "url": "https://opengameart.org/content/battle-theme-a",
        "loop": True,
        "gain": 1.0,
    },
    "mu_wave_e": {
        "src": "/static/audio/mu_wave_e.ogg",
        "title": "Determined Pursuit (epic orchestra loop)",
        "author": "Emma_MA",
        "license": "CC0",
        "url": "https://opengameart.org/content/determined-pursuit-epic-orchestra-loop",
        "loop": True,
        "gain": 1.0,
    },
    "mu_wave_f": {
        "src": "/static/audio/mu_wave_f.ogg",
        "title": "Realm of Torment",
        "author": "vitalezzz",
        "license": "CC0",
        "url": "https://opengameart.org/content/realm-of-torment",
        "loop": True,
        "gain": 1.0,
    },
    "mu_wave_g": {
        "src": "/static/audio/mu_wave_g.ogg",
        "title": "Open Warfare",
        "author": "Ruskerdax",
        "license": "CC0",
        "url": "https://opengameart.org/content/open-warfare",
        "loop": True,
        "gain": 1.0,
    },
}

WAVE_PLAYLIST = ["mu_wave_a", "mu_wave_b", "mu_wave_c",
                 "mu_wave_d", "mu_wave_e", "mu_wave_f", "mu_wave_g"]


def patch(cfg):
    changed = []
    audio = cfg.setdefault("audio", {})
    tracks = audio.setdefault("tracks", {})
    for tid, want in TRACKS.items():
        if tracks.get(tid) != want:
            tracks[tid] = dict(want)
            changed.append(f"audio.tracks.{tid}")
    pl = audio.setdefault("playlist", {})
    if pl.get("wave") != WAVE_PLAYLIST:
        pl["wave"] = list(WAVE_PLAYLIST)
        changed.append("audio.playlist.wave")

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
