#!/usr/bin/env python3
"""Скриншот каждой арены в живой игре: пол, декали, препятствия.

Приёмка арен по одиночным PNG невозможна в принципе — пол собирается чанками на
старте забега, а завалы расставляет генератор. Смотреть надо то, что видит игрок.

    .venv/bin/python tools/shot_arenas.py
    .venv/bin/python tools/shot_arenas.py --arena ar_tomb --seconds 4

Тестовому игроку выдаются открытия арен напрямую в БД: `ar_ash` и `ar_tomb`
заперты за 400 и 1000 реликвий, и проходить ради скриншота двадцать волн незачем.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def grant_all(name, cfg):
    """Открыть тестовому игроку весь контент. Идемпотентно.

    Арены, персонажи и оружие заперты за сотни реликвий. Для приёмки графики
    проходить ради каждого скриншота по двадцать волн незачем.
    """
    user = db.get_user_by_name(name)
    if not user:
        return False
    for kind in ("arena", "character", "faction", "weapon"):
        for item_id in cfg.get(kind + "s", {}):
            db.add_unlock(user["id"], kind, item_id)
    return True


def login(page, url, user, password):
    page.goto(url + "/login")
    return page.evaluate(
        """async ([u, pw]) => {
            let r = await fetch('/api/register', {method:'POST',
                headers:{'Content-Type':'application/json'},
                body: JSON.stringify({name:u, password:pw})});
            if (r.status === 409) {
                r = await fetch('/api/login', {method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({name:u, password:pw})});
            }
            return r.status;
        }""", [user, password])


def pick_in_grid(page, name):
    """Клик по ячейке визарда с данной подписью."""
    cell = page.locator("#run-setup .setup-grid button", has_text=name).first
    cell.click(timeout=4000)


def run_arena(page, url, arena_name, seconds, shot, character="", burst=0):
    page.goto(url + "/", wait_until="networkidle")
    page.locator("#btn-play").click(timeout=5000)
    page.wait_for_selector("#run-setup", timeout=5000)

    nxt = page.locator("#run-setup .setup-nav .btn").nth(1)
    # шаг 1 — персонаж (годится предвыбранный), шаг 2 — арена, дальше до конца
    if character:
        pick_in_grid(page, character)
        page.wait_for_timeout(150)
    nxt.click()
    page.wait_for_timeout(200)
    pick_in_grid(page, arena_name)
    page.wait_for_timeout(150)
    while page.locator("#run-setup").is_visible():
        nxt.click()
        page.wait_for_timeout(200)

    # Дать волне начаться и врагам разойтись, потом отойти от центра: стартовая
    # точка нарочно расчищена, и препятствий рядом с ней не будет.
    page.wait_for_timeout(int(seconds * 1000))
    page.keyboard.down("KeyD")
    page.wait_for_timeout(900)
    page.keyboard.up("KeyD")
    page.wait_for_timeout(300)

    if burst:
        # Замах длится доли секунды: одиночный кадр почти всегда попадает в паузу
        # между ударами. Серия с шагом в кадр ловит саму анимацию.
        out = []
        base = shot[:-4]
        for i in range(burst):
            page.wait_for_timeout(110)
            p = f"{base}_{i}.png"
            page.screenshot(path=p)
            out.append(p)
        return out
    page.screenshot(path=shot)
    return shot


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8150")
    ap.add_argument("--user", default="smoke")
    ap.add_argument("--password", default="pepel123")
    ap.add_argument("--seconds", type=float, default=2.5)
    ap.add_argument("--arena", default="", help="только одна арена по id")
    ap.add_argument("--character", default="", help="имя персонажа в визарде")
    ap.add_argument("--burst", type=int, default=0, help="серия кадров подряд: ловит замах")
    ap.add_argument("--outdir", default="scratch")
    a = ap.parse_args()

    import json
    import urllib.request
    cfg = json.load(urllib.request.urlopen(a.url + "/api/config"))
    arenas = cfg["arenas"]
    want = [a.arena] if a.arena else list(arenas)

    os.makedirs(a.outdir, exist_ok=True)
    errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("console", lambda m: errors.append(m.text)
                if m.type == "error" and "Failed to load resource" not in m.text else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        code = login(page, a.url, a.user, a.password)
        if code >= 400:
            raise SystemExit(f"вход не удался: HTTP {code}")
        if not grant_all(a.user, cfg):
            print("! игрока нет в БД, запертый контент будет недоступен")
        page.reload(wait_until="networkidle")

        for aid in want:
            shot = os.path.join(a.outdir, f"arena_{aid}.png")
            got = run_arena(page, a.url, arenas[aid]["name"], a.seconds, shot,
                            a.character, a.burst)
            print(f"{aid}: {got}")

        browser.close()

    if errors:
        print("\nОШИБКИ КОНСОЛИ:")
        for e in errors[:10]:
            print(" -", e)
        raise SystemExit(1)
    print("ошибок консоли нет")


if __name__ == "__main__":
    main()
