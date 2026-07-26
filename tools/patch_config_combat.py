#!/usr/bin/env python3
"""Бой: анимации замаха, VFX и вид снарядов.

Идемпотентно, в обе копии конфига (CLAUDE.md §3.2).

    python3 tools/patch_config_combat.py

Что добавляет:
  render.weapon_size / weapon_reach   — как рисуется оружие в руке
  render.fx_alpha / fx_scale          — след удара
  render.impact                       — искры попадания
  weapons.*.shape.anim / anim_time    — тип и длительность замаха (ближний бой)
  weapons.*.shape.fx                  — спрайт следа удара
  weapons.*.shape.spin                — как повёрнут снаряд в полёте
  weapons.*.color                     — запасной цвет снаряда без спрайта

Про anim: тип кривой один на семейство, все четыре тира дерутся одинаково —
тир меняет числа, а не хват. Значения понимает engine/weapon_anim.js.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGETS = [
    os.path.join(ROOT, "config", "game_config.json"),
    os.path.join(ROOT, "data", "game_config.json"),
]

RENDER = {
    "weapon_size": 26,        # оружие мельче персонажа (48), иначе перекрывает его
    "weapon_reach": 0.95,     # вынос замаха в долях размера спрайта персонажа
    "fx_alpha": 0.85,
    "fx_scale": 1.7,          # след шире оружия: он показывает сектор, а не клинок
    # Спрайт снаряда крупнее его радиуса коллизии: 4 px хитбокса в спрайте
    # не видно вовсе, а увеличивать хитбокс значит менять баланс.
    "projectile_scale": 3.2,
    "impact": {
        "count": 4,
        "count_crit": 9,
        "color": "#c9a06a",
        "color_crit": "#e0a03a",
        "speed": 90,
        "life": 0.22,
        "size": 2,
    },
}

# Семейство → (кривая замаха, длительность, спрайт следа).
# Кривые описаны в engine/weapon_anim.js; длительность подобрана под кулдаун
# семейства — молот бьёт редко и тяжело, когти часто и коротко.
MELEE = {
    "w_cleaver":    ("sweep", 0.20, "fx_slash"),
    "w_sickle":     ("sweep", 0.24, "fx_slash_wide"),
    "w_hammer":     ("slam", 0.34, "fx_impact"),
    "w_censer":     ("slam", 0.30, "fx_slash_wide"),
    "w_pike":       ("thrust", 0.18, "fx_thrust"),
    "w_stilettos":  ("thrust", 0.14, "fx_thrust"),
    "w_bonemine":   ("spin", 0.40, "fx_slash_wide"),
    "w_scourge":    ("lash", 0.26, "fx_lash"),
    "w_claws":      ("rip", 0.18, "fx_claw"),
    "w_chainblade": ("saw", 0.22, "fx_slash"),
}

# Как снаряд повёрнут в полёте:
#   heading — по вектору скорости (стрелы, гарпуны, гвозди);
#   none    — без поворота, для круглых (шар плазмы вращать бессмысленно, и это
#             экономит трансформ на 600 снарядах — см. бюджет §4);
#   spin    — крутится сам по себе (пилы, диски).
SPIN = {
    "p_nail": "heading", "p_spike": "heading", "p_harpoon": "heading",
    "p_slug": "heading", "p_beam": "heading", "p_shard": "heading",
    "p_bolt": "heading", "p_dart": "heading", "p_shell": "heading",
    "p_flame": "none", "p_plasma": "none", "p_spore": "none",
    "p_venom": "none", "p_ice": "none", "p_warp": "spin", "p_spark": "none",
    "p_grape": "none", "p_rivet": "heading", "p_disc": "spin",
    "p_needle": "heading", "p_ember": "none",
}

# Свой снаряд каждому стволу. Сейчас 18 семейств делят 12 спрайтов: p_slug на
# четверых, p_beam на троих — в бою не отличить, чей выстрел летит.
PROJECTILE = {
    "w_nailer": "p_nail",
    "w_spiker": "p_spike",
    "w_shotgun": "p_grape",
    "w_autocannon": "p_shell",
    "w_carbine": "p_bolt",
    "w_longbarrel": "p_slug",
    "w_lance": "p_harpoon",
    "w_needler": "p_needle",
    "w_grapeshot": "p_shard",
    "w_plasmacutter": "p_plasma",
    "w_rod": "p_warp",
    "w_venomsprayer": "p_venom",
    "w_stormcaster": "p_spark",
    "w_sporegun": "p_spore",
    "w_icelens": "p_ice",
    "w_flamer": "p_flame",
    "w_turret": "p_rivet",
    "w_forgedrone": "p_beam",
}

# Запасной цвет: рисуется кружком, пока PNG не загрузился или отсутствует.
# Без него `w.color` не было ни у одного оружия и ВСЕ снаряды были золотыми.
COLOR = {
    "w_nailer": "#b9b2a2", "w_spiker": "#c2b8a4", "w_shotgun": "#d0a25c",
    "w_autocannon": "#c98f4a", "w_carbine": "#8fd0e0", "w_longbarrel": "#d8cba8",
    "w_lance": "#a8b8c8", "w_needler": "#cfe0ec", "w_grapeshot": "#d0a25c",
    "w_plasmacutter": "#d8a8ff", "w_rod": "#a86ad0", "w_venomsprayer": "#8fd06a",
    "w_stormcaster": "#7fc0f0", "w_sporegun": "#a8c07a", "w_icelens": "#a8dcf0",
    "w_flamer": "#f0a03a", "w_turret": "#c2b8a4", "w_forgedrone": "#8fd0e0",
}


def family(weapon_id):
    """w_cleaver_3 → w_cleaver. Тиры делят и текстуру, и повадку."""
    return weapon_id.rsplit("_", 1)[0]


def patch(cfg):
    changed = False

    render = cfg.setdefault("render", {})
    for k, v in RENDER.items():
        if render.get(k) != v:
            render[k] = v
            changed = True

    for wid, w in cfg.get("weapons", {}).items():
        fam = family(wid)
        shape = w.get("shape")
        if not shape:
            continue

        if shape.get("type") == "arc":
            anim = MELEE.get(fam)
            if anim:
                kind, secs, fx = anim
                for key, val in (("anim", kind), ("anim_time", secs), ("fx", fx)):
                    if shape.get(key) != val:
                        shape[key] = val
                        changed = True
        else:
            tex = PROJECTILE.get(fam)
            if tex and shape.get("texture") != tex:
                shape["texture"] = tex
                changed = True
            spin = SPIN.get(shape.get("texture"))
            if spin and shape.get("spin") != spin:
                shape["spin"] = spin
                changed = True

        color = COLOR.get(fam)
        if color and w.get("color") != color:
            w["color"] = color
            changed = True

    return changed


def main():
    loaded = []
    for path in TARGETS:
        if not os.path.exists(path):
            print(f"{path}: нет файла, пропуск")
            continue
        with open(path, encoding="utf-8") as f:
            loaded.append((path, json.load(f)))

    dirty = [(p, c) for p, c in loaded if patch(c)]
    if not dirty:
        print("уже применено")
        return
    version = max(c.get("content_version", 0) for _, c in loaded) + 1
    for path, cfg in dirty:
        cfg["content_version"] = version
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"{path}: обновлено, content_version={version}")


if __name__ == "__main__":
    main()
