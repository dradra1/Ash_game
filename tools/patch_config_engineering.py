#!/usr/bin/env python3
"""Патч: механика инженерии — оружие класса `engi` стоит копиями на арене.

Что меняется в правилах боя. Оружие ИНЖЕНЕРНОГО КЛАССА (список — в
`engineering.classes`) не стреляет в руках: вместо него на арене появляется
`engineering.copies` его копий в случайных точках. Бьют они тем же шагом слота,
что и оружие в руках (`stepSlot` в sim/weapon.js), по статам ХОЗЯИНА — предметы,
левелапы и стат «инженерия» продолжают работать.

Всё остальное оружие — ближнее, дальнобойное, стихийное — работает как работало,
из рук игрока. Инженерия это свойство класса, а не режим забега.

Почему ручкой в конфиге, а не в коде. Это правило контента и баланса, а не деталь
движка: список классов, число копий и радиус установки — ровно те значения,
которые CLAUDE.md §3.1 запрещает держать в коде. На отдельном оружии есть два
перекрытия: `deploy` (разворачивать или нет, сильнее класса) и `deploy_copies`
(сколько копий).

Точки выбираются из rng ЗАБЕГА: раскладка обязана совпасть у хоста и у повторного
прогона того же сида, потому что сервер валидирует результат по сиду. Кооп-клиент
получает готовый список (MSG_TURRET) — сам он его вывести не может, так как не
крутит симуляцию и не знает, сколько раз дёрнули генератор.

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_engineering.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 47

ENGINEERING = {
    # Механика целиком. false возвращает прежнее поведение (оружие бьёт с рук) —
    # ветка одна и та же, отдельного «режима без инженерии» в коде не существует.
    "enabled": True,
    # КАКИЕ КЛАССЫ оружия разворачиваются в установки. Всё остальное бьёт с рук,
    # как било: инженерия — свойство класса, а не режим забега.
    #
    # Здесь была правка после боевого бага: гейт стоял на всём забеге, и в
    # установки уезжал КАЖДЫЙ ствол — тесак, обрез, посох. Игрок оставался с
    # пустыми руками, а весь его урон разъезжался по случайным точкам карты.
    #
    # Перекрытие на отдельном оружии — поле `deploy` (true/false) в самом стволе;
    # оно сильнее класса.
    "classes": ["engi"],
    # Сколько копий каждого такого оружия встаёт на арену.
    "copies": 3,
    # Потолок пула установок. 8 игроков × 6 слотов × 3 копии = 144; запас нужен,
    # потому что перекрытие deploy_copies на оружии может быть и больше трёх.
    # Переполнение — деградация (лишние копии не рождаются), а не рост.
    "max_turrets": 200,
    # Отступ от стен: установка вплотную к краю простреливает полэкрана в никуда.
    "place_margin": 96,
    # Радиус, который должен быть свободен от завала под точку установки.
    "place_clear": 20,
    # Сколько раз ищем чистое место, прежде чем поставить как есть. Зацикливаться
    # на поиске в горячем пути нельзя, а турель в завале стреляет не хуже.
    "place_attempts": 12,
    # Множители дальности и урона установки против того же оружия в руках.
    #
    # Ровно 1.0: установка бьёт тем же оружием и теми же статами, что и рука.
    # Ручки заведены на будущее — если окажется, что стационарная точка должна
    # брать дальностью, крутить надо здесь, а не в коде. Доход при 1.0 сходится
    # с соло в пределах 4% (BALANCE.md), так что трогать их сейчас нечего.
    "range_mult": 1.0,
    "damage_mult": 1.0,
}

RENDER = {
    # Размер спрайта установки на полу. Крупнее оружия в руке: это постройка,
    # и её надо видеть с другого конца арены.
    "turret_size": 30,
    # Метка на полу под установкой цветом хозяина — в коопе иначе не понять,
    # чьи это три копии тесака.
    "turret_ring": True,
    "turret_ring_radius": 11,
    "turret_ring_width": 2,
}


def patch(cfg):
    changed = []

    eng = cfg.setdefault("engineering", {})
    for k, v in ENGINEERING.items():
        if eng.get(k) != v:
            changed.append(f"engineering.{k}: {eng.get(k)!r} → {v!r}")
            eng[k] = v

    render = cfg.setdefault("render", {})
    for k, v in RENDER.items():
        if render.get(k) != v:
            changed.append(f"render.{k}: {render.get(k)!r} → {v!r}")
            render[k] = v

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
