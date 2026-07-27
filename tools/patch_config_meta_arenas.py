#!/usr/bin/env python3
"""Патч: цены арен в реликвиях и множитель реликвий от сложности.

Две вещи.

**Арены.** Цены были 400 и 1000, стали 300 и 600. Сам механизм открытия работал и
раньше: `arenas.*.unlock` = {relics, cost}, сервер знает `kind: "arena"`
(`meta.unlock_price`), профиль хранит `unlocks.arena`, преран-мастер показывает
закрытые арены серыми. Не работало ровно одно — в Реликварии не было вкладки арен,
то есть купить их было НЕЧЕМ. Вкладка добавлена отдельно, в `ui/meta_ui.js`.

**Множитель реликвий за сложность.** `danger[i].reward_mult` существовал и раньше
(1.0 / 1.35 / 1.8 / 2.4 / 3.2), но числа были подобраны на глаз. Теперь это
геометрическая прогрессия с шагом `meta.relic_formula.danger_step`: множитель
уровня i равен step^i. При шаге 1.2 это 1.0 / 1.2 / 1.44 / 1.73 / 2.07 — **ниже**
прежних значений, то есть высокие сложности стали давать меньше реликвий, чем до
патча. Это осознанный выбор шага, а не побочный эффект: одна ручка вместо пяти
разрозненных чисел.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_meta_arenas.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 38

# Арена → цена в реликвиях. Первая арена открыта по умолчанию и в таблице не нужна.
ARENA_COST = {
    "ar_ash": 300,
    "ar_tomb": 600,
}

# Шаг прогрессии множителя реликвий по уровням сложности.
DANGER_STEP = 1.2

TEXTS = {
    "ru": {
        "ui.meta.arenas": "Арены",
        "ui.meta.arena_enemies": "Врагов в пуле",
        "ui.select.relic_mult": "реликвии",
    },
    "en": {
        "ui.meta.arenas": "Arenas",
        "ui.meta.arena_enemies": "Enemy pool",
        "ui.select.relic_mult": "relics",
    },
}


def patch(cfg):
    changed = []

    arenas = cfg.get("arenas") or {}
    for arena_id, cost in ARENA_COST.items():
        a = arenas.get(arena_id)
        if not a:
            continue
        unlock = a.setdefault("unlock", {"type": "relics"})
        if unlock.get("type") != "relics":
            continue
        if unlock.get("cost") != cost:
            unlock["cost"] = cost
            changed.append(f"arenas.{arena_id}.unlock.cost = {cost}")

    meta = cfg.setdefault("meta", {}).setdefault("relic_formula", {})
    if meta.get("danger_step") != DANGER_STEP:
        meta["danger_step"] = DANGER_STEP
        changed.append(f"meta.relic_formula.danger_step = {DANGER_STEP}")

    # Множитель выводится ИЗ шага, а не задаётся руками: иначе таблица и ручка
    # разъедутся при первой же правке одной из них.
    for i, d in enumerate(cfg.get("danger") or []):
        want = round(DANGER_STEP ** i, 4)
        if d.get("reward_mult") != want:
            d["reward_mult"] = want
            changed.append(f"danger[{i}].reward_mult = {want}")

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
