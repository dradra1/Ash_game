#!/usr/bin/env python3
"""Патч: описания статов, названия мета-улучшений, теги оружия и недостающие строки UI.

Закрывает три дыры, найденные при обходе интерфейса:

  stats.meta.<key>.desc   у всех 17 статов были name/texture/kind/color и НИ ОДНОГО
                          описания, поэтому в лавке нельзя было понять, что стат
                          делает. Формулировки прямо называют механику и единицы,
                          включая неочевидные: дальность удорожает замах ближнего
                          оружия, вампиризм — это шанс, а не доля урона.

  meta.upgrades[].stat_name / .desc
                          раздел «Улучшения» рисовал сырой ключ конфига: игрок
                          видел «+5 start_ash_pct». Перевода не существовало нигде —
                          этих ключей нет в stats.meta.

  i18n.ru['tag.*']        теги оружия показывались списком английских id
                          (blade, primitive, holy…).

  i18n.ru прочее          строки, которых не хватало новому UI (ui.shop.buy_merge,
                          ui.shop.current, ui.lobby.copied) и единицы измерения,
                          зашитые прямо в JS (ui.unit.sec).

Идемпотентен, пишет в обе копии конфига (CLAUDE.md §3.2).

    tools/patch_config_texts.py --apply
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")),
                    "game_config.json")

CONTENT_VERSION = 22

# Описания статов. Пишем механику, а не настроение: игрок принимает по ним решения.
STAT_DESC = {
    "max_hp": "Предел здоровья. Прибавка лечит сразу на свою величину. "
              "В начале каждой волны здоровье восстанавливается полностью.",
    "hp_regen": "Здоровье в секунду. Копится дробно и выдаётся целыми единицами. "
                "В лавке и на выборе улучшения не идёт.",
    "lifesteal_pct": "Шанс в процентах вылечиться на 3 здоровья при ЛЮБОМ попадании, "
                     "а не только при добивании. Не срабатывает на полном здоровье.",
    "damage_pct": "Общая прибавка к урону всего оружия в процентах. "
                  "Считается после плоских прибавок.",
    "melee_dmg": "Плоская прибавка к урону оружия ближнего боя.",
    "ranged_dmg": "Плоская прибавка к урону стрелкового оружия.",
    "elem_dmg": "Плоская прибавка к урону стихийного оружия.",
    "attack_speed_pct": "Сокращает перезарядку всего оружия в процентах.",
    "crit_pct": "Шанс критического удара в процентах. Складывается с собственным "
                "шансом оружия. Крит наносит двойной урон.",
    "engineering": "Усиливает установки и дронов — оружие, которое бьёт само.",
    "range": "Дальность оружия. Ближнему бою даёт лишь половину прибавки И "
             "УДЛИНЯЕТ ЕГО ПЕРЕЗАРЯДКУ — тяжёлым стволам берите с оглядкой.",
    "armor": "Снижает входящий урон. Отдача убывает с ростом, потолок — 80%.",
    "dodge_pct": "Шанс полностью уклониться от удара, в процентах. Потолок — 60%.",
    "move_speed_pct": "Скорость передвижения в процентах. Главный защитный стат жанра: "
                      "уклоняться выгоднее, чем терпеть.",
    "luck": "Сдвигает находки к высоким тирам — и в лавке, и на выборе улучшения.",
    "tithe": "Прибавка к праху с каждого убитого врага.",
    "knockback": "Сила отбрасывания врагов при попадании. Боссы сопротивляются.",
}

# Названия и пояснения мета-улучшений: в конфиге лежит только английский ключ stat
UPGRADE_TEXT = {
    "start_ash_pct": ("Стартовый прах", "Процент праха, с которым начинается забег."),
    "start_hp": ("Стартовое здоровье", "Прибавка к пределу здоровья на старте забега."),
    "start_luck": ("Стартовая удача", "Прибавка к удаче на старте забега."),
    "reroll_discount_pct": ("Скидка на реролл",
                            "Процент скидки на пересбор ассортимента лавки."),
}

# Теги оружия — показываются в реликварии списком
TAGS = {
    "tag.blade": "клинковое",
    "tag.blunt": "дробящее",
    "tag.construct": "механизм",
    "tag.gun": "огнестрел",
    "tag.heavy": "тяжёлое",
    "tag.holy": "священное",
    "tag.precise": "точное",
    "tag.primitive": "примитивное",
    "tag.spread": "веерное",
    "tag.warp": "разломное",
}

STRINGS = {
    "ui.shop.buy_merge": "Купить и объединить",
    "ui.shop.current": "Сейчас",
    "ui.lobby.copied": "Ссылка скопирована",
    "ui.unit.sec": "с",
    "ui.select.traits": "Особенности",
    "ui.select.start_weapons": "Стартовое оружие",
    "ui.audio.title": "Звук",
    "ui.audio.music": "Музыка",
    "ui.audio.sfx": "Эффекты",
    "ui.audio.muted": "Без звука",
    "ui.audio.credits": "Треки и авторы",
    "ui.pause.audio": "Звук",
}

# Английский словарь: ключи обязаны существовать в обоих языках, иначе en-локаль
# начнёт эхом печатать ключи (main.js падает на fallback «показать сам ключ»).
STRINGS_EN = {
    "ui.shop.buy_merge": "Buy and merge",
    "ui.shop.current": "Now",
    "ui.lobby.copied": "Link copied",
    "ui.unit.sec": "s",
    "ui.select.traits": "Traits",
    "ui.select.start_weapons": "Starting weapons",
    "ui.audio.title": "Sound",
    "ui.audio.music": "Music",
    "ui.audio.sfx": "Effects",
    "ui.audio.muted": "Muted",
    "ui.audio.credits": "Tracks and authors",
    "ui.pause.audio": "Sound",
}


def patch(cfg):
    changed = []

    meta = cfg.setdefault("stats", {}).setdefault("meta", {})
    for key, desc in STAT_DESC.items():
        entry = meta.get(key)
        if entry is None:
            continue                      # стат отсутствует в этой копии — не выдумываем
        if entry.get("desc") != desc:
            entry["desc"] = desc
            changed.append(f"stats.meta.{key}.desc")

    for up in cfg.get("meta", {}).get("upgrades", []):
        text = UPGRADE_TEXT.get(up.get("stat"))
        if not text:
            continue
        if up.get("stat_name") != text[0]:
            up["stat_name"] = text[0]
            changed.append(f"meta.upgrades[{up.get('id')}].stat_name")
        if up.get("desc") != text[1]:
            up["desc"] = text[1]
            changed.append(f"meta.upgrades[{up.get('id')}].desc")

    i18n = cfg.setdefault("i18n", {})
    ru = i18n.setdefault("ru", {})
    en = i18n.setdefault("en", {})
    for k, v in list(TAGS.items()) + list(STRINGS.items()):
        if ru.get(k) != v:
            ru[k] = v
            changed.append(f"i18n.ru[{k}]")
    for k, v in list(TAGS.items()) + list(STRINGS_EN.items()):
        if en.get(k) != v:
            en[k] = v
            changed.append(f"i18n.en[{k}]")

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
        print(f"  правок: {len(changed)}")
        for c in changed[:6]:
            print(f"  + {c}")
        if len(changed) > 6:
            print(f"  … и ещё {len(changed) - 6}")
        if a.apply:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
                f.write("\n")
            print("  записано")
        else:
            print("  (dry-run, передай --apply)")


if __name__ == "__main__":
    main()
