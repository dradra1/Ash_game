#!/usr/bin/env python3
"""Патч: десятина платит прах в начале волны, а не долей от дропа.

**Было.** `tithe` — доля от праха каждого убитого:
`ash = e.ash * (1 + tithe * stats.tithe_scale)`, `tithe_scale = 0.04`. Стат, который
нельзя ни увидеть, ни посчитать: прибавка растворялась в дропе, а её вклад зависел
от сложности, номера волны и проклятий разом.

**Стало.** Плоская выплата в котёл на старте каждой волны, равная сумме стата по
участникам (`run.payTithe`). `tithe_scale` остаётся единственной ручкой масштаба и
становится 1.0 — «сколько стата, столько праха».

Все источники десятины удвоены: при плоской выплате прежние 1–8 были бы неразличимы
на фоне дохода волны (цель ТЗ — 50 прахов на первой волне, 600 на тринадцатой).
Даже с удвоением стат остаётся ранним: полный набор даёт около 40 за волну.
Это осознанный выбор — см. BALANCE.md.

**Проклятия.** «Десятина без праха» больше не даёт `tithe` (при новой механике это
была бы +0.5 в начале волны, то есть ничто), а начисляет 0.5 праха прямо в котёл за
каждое убийство — новый эффект `ash_per_kill`. Пол при этом остаётся пустым:
`ash_drop_zero` теперь запрещает дроп и врагам, и ломаемым урнам.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_tithe.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 41

TITHE_SCALE = 1.0

# Источники десятины ×2. Зеркалятся в генераторах tools/content_items.py и
# tools/content_world.py — иначе следующий прогон patch_config_content.py откатит.
CHARACTER_TITHE = {"ch_scavenger": 8}
ITEM_TITHE = {
    "it_ash_pouch": 2,
    "it_carrion_hook": 2,
    "it_tithe_ledger": 4,
    "it_famine_bowl": 8,
    "it_gilded_ledger": 16,
    "it_shared_purse": 10,
}

CURSE_EFFECTS = {
    # tithe убран намеренно: +0.5 к выплате раз в волну не заметил бы никто.
    "cu_ashless_tithe": {"ash_drop_zero": True, "ash_per_kill": 0.5},
    "cu_iron_tithe": {"shop_price_mult": 2, "tithe": 2, "reward_mult": 1.25},
}

CURSE_DESC = {
    "ru": {
        "cu_ashless_tithe": "Прах на пол не падает; 0.5 праха за каждое убийство.",
        "cu_iron_tithe": "Цены ×2, +2 к десятине, больше реликвий.",
    },
}

STAT_DESC = {
    "tithe": "Прах в начале каждой волны — столько, сколько накоплено стата.",
}


def patch(cfg):
    changed = []

    stats = cfg.setdefault("stats", {})
    if stats.get("tithe_scale") != TITHE_SCALE:
        stats["tithe_scale"] = TITHE_SCALE
        changed.append(f"stats.tithe_scale = {TITHE_SCALE}")

    meta = stats.setdefault("meta", {})
    for key, desc in STAT_DESC.items():
        entry = meta.get(key)
        if entry is not None and entry.get("desc") != desc:
            entry["desc"] = desc
            changed.append(f"stats.meta.{key}.desc")

    chars = cfg.get("characters") or {}
    for cid, val in CHARACTER_TITHE.items():
        c = chars.get(cid)
        if not c:
            continue
        st = c.setdefault("stats", {})
        if st.get("tithe") != val:
            st["tithe"] = val
            changed.append(f"characters.{cid}.stats.tithe = {val}")

    items = cfg.get("items") or {}
    for iid, val in ITEM_TITHE.items():
        it = items.get(iid)
        if not it:
            continue
        st = it.setdefault("stats", {})
        if st.get("tithe") != val:
            st["tithe"] = val
            changed.append(f"items.{iid}.stats.tithe = {val}")

    curses = cfg.get("curses") or {}
    for cid, effects in CURSE_EFFECTS.items():
        c = curses.get(cid)
        if not c:
            continue
        if c.get("effects") != effects:
            c["effects"] = json.loads(json.dumps(effects))
            changed.append(f"curses.{cid}.effects")

    for lang, pairs in CURSE_DESC.items():
        if lang != "ru":
            continue
        for cid, desc in pairs.items():
            c = curses.get(cid)
            if c is not None and c.get("desc") != desc:
                c["desc"] = desc
                changed.append(f"curses.{cid}.desc")

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
