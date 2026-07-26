#!/usr/bin/env python3
"""Идемпотентно дописывает в tools/assets.json секцию `ui`: панели, кнопки, рамки.

Генерация — `python3 tools/gen_ui.py`. Файлы кладутся в `static/ui/`, а НЕ в
`static/textures/`: на texture-id из конфига они не завязаны, их адресует CSS.

Инструмент — `create_ui_asset` (ASSETS.md §6 п. 8). Иконки им не делаются: он
стоит 20–40 генераций за штуку и не отдаёт меньше 192 px. Мелкие глифы (замок,
галочка, стрелка) идут через `create_map_object` в секции `ui_glyphs` — одна
генерация, прозрачный фон, ужатие до 32 px.

**Всё рисуется под 9-slice.** Отсюда требования к промптам: рамка одинаковой
толщины по всем четырём сторонам, углы читаемые и симметричные, середина пустая
и ровная — CSS растянет её на любой размер, и любой рисунок в центре размажет.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "tools", "assets.json")

# Общая гамма: та же, что у мира (ASSETS.md §1) — тусклая сталь, ржавчина, охра.
PALETTE = "dark gunmetal grey, cold steel, rust brown, tarnished brass and dull ochre gold"
# Без капса про «одну рамку» модель уверенно выдаёт ЛИСТ ВИДЖЕТОВ — набор кнопок,
# ползунков и чекбоксов на одном холсте, — либо иллюстрацию меню с текстом внутри.
# Так провалились три панели из двенадцати в первом заходе.
NINE = ("ONE SINGLE FRAME filling the ENTIRE canvas from edge to edge. "
        "NOT A UI KIT. NOT A SET OF WIDGETS. NOT A SPRITE SHEET. "
        "NO TEXT, NO LETTERS, NO ICONS, NO BUTTONS INSIDE, NO ILLUSTRATION. "
        "Border of even thickness on all four sides, symmetrical readable corners, "
        "the centre is COMPLETELY FLAT AND EMPTY, "
        "designed to be stretched as a nine-slice frame")

UI = {
    "ui_panel": (256, 256,
                 "a heavy dark iron panel frame for a grimdark sci-fi game menu, riveted steel border "
                 "with a thin tarnished brass inlay and small corner bolts, deep shadowed recess inside"),
    "ui_tooltip": (384, 256,
                   "a small plain dark steel tooltip frame, thin single brass hairline border, "
                   "very restrained, no ornament"),
    "ui_btn": (384, 192,
               "a dark steel push button plate for a grimdark sci-fi interface, bevelled riveted edge, "
               "dull brass rim, unlit and calm"),
    "ui_btn_hover": (384, 192,
                     "a dark steel push button plate, bevelled riveted edge, rim lit with warm ochre "
                     "lamplight, slightly brighter than resting state"),
    "ui_btn_go": (384, 192,
                  "a dark steel push button plate with a muted moss-green lit rim and green bevel glow, "
                  "confirmation button, riveted edge"),
    "ui_btn_danger": (384, 192,
                      "a dark steel push button plate with a dried blood red lit rim and red bevel glow, "
                      "warning button, riveted edge"),
    "ui_cell": (384, 192,
                "a plain dark recessed slot plate, thin steel border, shallow inner shadow, "
                "very simple, for a list row"),
    "ui_card": (288, 384,
                "a tall dark steel card frame with a thin brass edge and a small notch at the top centre, "
                "shallow recess inside, for an item card"),
    "ui_tab": (256, 192,
               "a dark steel tab plate with a bevelled top edge, unlit, muted"),
    "ui_tab_active": (256, 192,
                      "a dark steel tab plate with a bevelled top edge lit with warm ochre gold, selected"),
    "ui_bar_frame": (384, 192,
                     "a narrow dark iron gauge housing, riveted rail along the top and bottom edges, "
                     "hollow inside, for a horizontal status bar"),
    "ui_slot": (192, 192,
                "a small square dark steel socket frame with bolted corners, hollow centre, "
                "for a weapon icon slot"),
}

# Глифы: create_map_object, одна генерация, ужатие до 32 px
GLYPHS = {
    "ui_lock_on": "a closed heavy iron padlock, shackle down, worn metal",
    "ui_lock_off": "an open iron padlock, shackle swung up and free, worn metal",
    "ui_check": "a simple thick check mark tick, muted moss green, clean shape",
    "ui_star": "a simple five pointed star, dull ochre gold, flat and clean",
    "ui_arrow": "a simple solid triangular arrow head pointing RIGHT, dull steel, flat and clean",
    "ui_copy": "two small overlapping rectangular plates, a copy symbol, dull steel, flat",
}


def main():
    with open(PATH, encoding="utf-8") as f:
        data = json.load(f)

    changed = 0
    ui = data.setdefault("ui", {})
    for key, (w, h, desc) in UI.items():
        want = {
            "tool": "create_ui_asset",
            "width": w,
            "height": h,
            "description": f"{desc}, {NINE}",
            "color_palette": PALETTE,
        }
        if ui.get(key) != want:
            ui[key] = want
            changed += 1

    glyphs = data.setdefault("ui_glyphs", {})
    for key, prompt in GLYPHS.items():
        want = {
            "tool": "create_map_object",
            "gen": 64,
            "fit": 32,
            "view": "high top-down",
            "prompt": prompt,
        }
        if glyphs.get(key) != want:
            glyphs[key] = want
            changed += 1

    if not changed:
        print("уже применено")
        return
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{PATH}: записано {changed} (ui {len(ui)}, ui_glyphs {len(glyphs)})")


if __name__ == "__main__":
    main()
