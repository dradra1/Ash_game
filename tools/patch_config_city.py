#!/usr/bin/env python3
"""Патч: экран «город» — секция city (фон, здания, действия) и i18n подписи.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2). Здания сливаются
по id: новые добавляются, у существующих обновляется всё, КРОМЕ координат
x/y/w/h — их могли подвинуть вручную под готовый фон, и патч не должен
эту подгонку затирать.

    tools/patch_config_city.py --apply
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 51

CITY_W = 1024
CITY_H = 576


def building(bid, texture, x, y, color, name, hint, action, locked=None):
    b = {"id": bid, "texture": texture}
    if locked:
        b["texture_locked"] = locked
    b["x"] = x
    b["y"] = y
    b["w"] = 160
    b["h"] = 160
    b["color"] = color
    b["name"] = name
    b["hint"] = hint
    b["action"] = action
    return b


# Порядок — порядок обхода табом: слева направо, сверху вниз
BUILDINGS = [
    building("wip_a", "bl_wip_a", 64, 104, "#6b6156",
             "ui.city.soon", "ui.city.soon_hint", {"type": "none"}),
    building("tavern", "bl_tavern", 248, 104, "#c8a35a",
             "ui.city.tavern", "ui.city.tavern_hint",
             {"type": "meta", "tabs": ["factions", "characters"]},
             locked="bl_tavern_ruin"),
    building("forge", "bl_forge", 432, 104, "#d2652a",
             "ui.city.forge", "ui.city.forge_hint",
             {"type": "meta", "tabs": ["weapons"]},
             locked="bl_forge_ruin"),
    building("chapel", "bl_chapel", 616, 104, "#7fb0c8",
             "ui.city.chapel", "ui.city.chapel_hint",
             {"type": "meta", "tabs": ["upgrades"]},
             locked="bl_chapel_ruin"),
    # Площадка бывшего резерва wip_b: раздел арен въехал в готовое место, как и
    # задумывалось — сменились текстура, подписи и action, композиция цела.
    building("waystation", "bl_waystation", 800, 104, "#5f8f6b",
             "ui.city.waystation", "ui.city.waystation_hint",
             {"type": "meta", "tabs": ["arenas"]},
             locked="bl_waystation_ruin"),
    building("wip_c", "bl_wip_c", 64, 336, "#6b6156",
             "ui.city.soon", "ui.city.soon_hint", {"type": "none"}),
    building("crypt", "bl_crypt", 248, 336, "#8a5bc8",
             "ui.city.crypt", "ui.city.crypt_hint",
             {"type": "meta", "tabs": ["curses"]},
             locked="bl_crypt_ruin"),
    building("gate", "bl_gate", 432, 336, "#9c2b2b",
             "ui.city.gate", "ui.city.gate_hint", {"type": "play"}),
    building("obelisk", "bl_obelisk", 616, 336, "#b8b0a0",
             "ui.city.obelisk", "ui.city.obelisk_hint",
             {"type": "meta", "tabs": ["achievements"]},
             locked="bl_obelisk_ruin"),
]

I18N_RU = {
    "ui.city.title": "Город",
    "ui.city.tavern": "Таверна",
    "ui.city.tavern_hint": "Фракции и персонажи",
    "ui.city.forge": "Оружейная",
    "ui.city.forge_hint": "Оружие и снаряжение",
    "ui.city.chapel": "Часовня",
    "ui.city.chapel_hint": "Постоянные улучшения",
    "ui.city.crypt": "Крипта",
    "ui.city.crypt_hint": "Проклятия забега",
    "ui.city.obelisk": "Обелиск",
    "ui.city.obelisk_hint": "Ачивки и звания",
    "ui.city.waystation": "Путевая палата",
    "ui.city.waystation_hint": "Арены и земли",
    "ui.city.gate": "Врата",
    "ui.city.gate_hint": "Отправиться в забег",
    "ui.city.soon": "Стройка",
    "ui.city.soon_hint": "Здесь ещё строят. Скоро откроется.",
    "ui.city.locked": "Закрыто",
    "ui.city.new": "Новое",
}

I18N_EN = {
    "ui.city.title": "City",
    "ui.city.tavern": "Tavern",
    "ui.city.tavern_hint": "Factions and characters",
    "ui.city.forge": "Armoury",
    "ui.city.forge_hint": "Weapons and gear",
    "ui.city.chapel": "Chapel",
    "ui.city.chapel_hint": "Permanent upgrades",
    "ui.city.crypt": "Crypt",
    "ui.city.crypt_hint": "Run curses",
    "ui.city.obelisk": "Obelisk",
    "ui.city.obelisk_hint": "Achievements and titles",
    "ui.city.waystation": "Wayfarer's Hall",
    "ui.city.waystation_hint": "Arenas and lands",
    "ui.city.gate": "Gate",
    "ui.city.gate_hint": "Set out on a run",
    "ui.city.soon": "Under construction",
    "ui.city.soon_hint": "Still being built. Opens soon.",
    "ui.city.locked": "Locked",
    "ui.city.new": "New",
}

# Координаты, которые патч не трогает у уже стоящих зданий
KEEP_COORDS = ("x", "y", "w", "h")


def merge_buildings(existing):
    by_id = {}
    for b in existing or []:
        if isinstance(b, dict) and b.get("id"):
            by_id[b["id"]] = b
    out = []
    for want in BUILDINGS:
        b = json.loads(json.dumps(want))
        cur = by_id.get(want["id"])
        if cur:
            for k in KEEP_COORDS:
                if k in cur:
                    b[k] = cur[k]
        out.append(b)
    return out


def patch(cfg):
    changed = []

    if cfg.get("content_version", 0) < CONTENT_VERSION:
        cfg["content_version"] = CONTENT_VERSION
        changed.append("content_version")

    city = cfg.get("city") or {}
    want = {
        "background": "bg_city",
        "width": CITY_W,
        "height": CITY_H,
        "buildings": merge_buildings(city.get("buildings")),
    }
    if city != want:
        cfg["city"] = want
        changed.append("city")

    i18n = cfg.setdefault("i18n", {})
    for lang, pairs in (("ru", I18N_RU), ("en", I18N_EN)):
        bucket = i18n.setdefault(lang, {})
        for key, val in pairs.items():
            if bucket.get(key) != val:
                bucket[key] = val
                changed.append(lang + ":" + key)

    return changed


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save(path, cfg):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.apply and not args.dry_run:
        ap.error("укажите --apply или --dry-run")

    for path in (REPO, LIVE):
        if not os.path.isfile(path) and path == LIVE:
            print("skip live (нет файла):", path)
            continue
        if not os.path.isfile(path):
            print("missing:", path, file=sys.stderr)
            return 1
        cfg = load(path)
        changed = patch(cfg)
        print(path, "→", ", ".join(changed) if changed else "ok (no changes)")
        if args.apply and changed:
            save(path, cfg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
