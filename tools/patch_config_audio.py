#!/usr/bin/env python3
"""Патч: секция музыки config.audio.tracks.

Все треки — CC0 (public domain) с opengameart.org. CC0 не требует указания
авторства юридически, но авторы всё равно перечислены и в CREDITS.md, и на экране
настроек звука: это условие, под которым разрешено брать чужие ассеты (CLAUDE.md §6),
и просто приличия. Если когда-нибудь добавится трек под CC-BY — поля те же,
меняется только license, а UI уже умеет его показывать.

Файлы лежат в static/audio/, перекодированы в ogg vorbis q2 (исходники были до
350 кбит/с и весили 14 МБ на трек — для браузерной игры неприемлемо) и выровнены
по громкости под −18 LUFS (tools/normalize_audio.py). Поэтому `gain` у всех 1.0:
поправка на разницу мастеринга больше не нужна, ключ остаётся на случай трека,
который выпадет из ряда и которого нельзя будет тронуть.

    tools/patch_config_audio.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 31

OGA = "https://opengameart.org/content/"

TRACKS = {
    "mu_menu": {
        "src": "/static/audio/mu_menu.ogg",
        "title": "EmptyCity",
        "author": "yd",
        "license": "CC0",
        "url": OGA + "emptycity-background-music",
        "loop": True,
        "gain": 1.0,
    },
    "mu_wave_a": {
        "src": "/static/audio/mu_wave_a.ogg",
        "title": "Post Apocalyptic Wastelands",
        "author": "SubspaceAudio (Juhani Junkala)",
        "license": "CC0",
        "url": OGA + "horror-atmosphere",
        "loop": True,
        "gain": 1.0,
    },
    "mu_wave_b": {
        "src": "/static/audio/mu_wave_b.ogg",
        "title": "Dark Shrine Loop",
        "author": "qubodup",
        "license": "CC0",
        "url": OGA + "dark-shrine-loop",
        "loop": True,
        "gain": 1.0,
    },
    "mu_wave_c": {
        "src": "/static/audio/mu_wave_c.ogg",
        "title": "Fast fight / battle music",
        "author": "XCVG",
        "license": "CC0",
        "url": OGA + "fast-fight-battle-music-looped",
        "loop": True,
        "gain": 1.0,
    },
    "mu_boss": {
        "src": "/static/audio/mu_boss.ogg",
        "title": "Boss Battle #2 (Symphonic Metal)",
        "author": "nene",
        "license": "CC0",
        "url": OGA + "boss-battle-2-symphonic-metal",
        "loop": True,
        "gain": 1.0,
    },
}

# Какой трек где играет. Боевые чередуются по номеру волны, чтобы за забег
# не приелся один и тот же луп.
PLAYLIST = {
    "menu": "mu_menu",
    "wave": ["mu_wave_a", "mu_wave_b", "mu_wave_c"],
    "boss": "mu_boss",
    "shop": "mu_menu",
}


def patch(cfg):
    changed = []
    audio = cfg.setdefault("audio", {})

    if audio.get("tracks") != TRACKS:
        audio["tracks"] = json.loads(json.dumps(TRACKS))
        changed.append("audio.tracks")
    if audio.get("playlist") != PLAYLIST:
        audio["playlist"] = json.loads(json.dumps(PLAYLIST))
        changed.append("audio.playlist")
    if "music_volume" not in audio:
        audio["music_volume"] = 0.5
        changed.append("audio.music_volume")

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
