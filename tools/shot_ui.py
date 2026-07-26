#!/usr/bin/env python3
"""Скриншоты экранов интерфейса: меню, настройка забега, реликварий, лавка, пауза.

Скин натянут через border-image, и его нельзя принимать по отдельным PNG: 9-slice
проверяется только на живом элементе — растянулась ли середина ровно, не съел ли
срез рамку, читается ли текст поверх.

    .venv/bin/python tools/shot_ui.py
    .venv/bin/python tools/shot_ui.py --only shop
"""
import argparse
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402


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


def grant(name, cfg, relics=5000):
    user = db.get_user_by_name(name)
    if not user:
        return False
    for kind in ("arena", "character", "faction", "weapon"):
        for item_id in cfg.get(kind + "s", {}):
            db.add_unlock(user["id"], kind, item_id)
    db.add_relics(user["id"], relics)     # чтобы в реликварии были живые цены
    return True


def shot(page, path, sel=None):
    page.wait_for_timeout(350)
    if sel:
        node = page.locator(sel).first
        node.screenshot(path=path)
    else:
        page.screenshot(path=path)
    print(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8150")
    ap.add_argument("--user", default="smoke")
    ap.add_argument("--password", default="pepel123")
    ap.add_argument("--outdir", default="scratch/ui")
    ap.add_argument("--only", default="")
    a = ap.parse_args()

    cfg = json.load(urllib.request.urlopen(a.url + "/api/config"))
    os.makedirs(a.outdir, exist_ok=True)
    errors = []
    want = set(a.only.split(",")) if a.only else None

    def need(name):
        return want is None or name in want

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("console", lambda m: errors.append(m.text)
                if m.type == "error" and "Failed to load resource" not in m.text else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        if login(page, a.url, a.user, a.password) >= 400:
            raise SystemExit("вход не удался")
        grant(a.user, cfg)
        page.goto(a.url + "/", wait_until="networkidle")

        if need("menu"):
            shot(page, f"{a.outdir}/menu.png")

        if need("setup"):
            page.locator("#btn-play").click()
            page.wait_for_selector("#run-setup")
            shot(page, f"{a.outdir}/setup.png", "#run-setup")
            page.locator("#run-setup .setup-nav .btn").first.click()   # назад в меню
            page.wait_for_timeout(200)

        if need("meta"):
            page.goto(a.url + "/", wait_until="networkidle")
            page.locator("#btn-meta").click()
            page.wait_for_selector("#reliquary")
            shot(page, f"{a.outdir}/meta.png", "#reliquary")

        if need("shop") or need("hud"):
            # Лавка открывается между волнами: проще дойти читом «пропустить волну»
            page.goto(a.url + "/", wait_until="networkidle")
            page.locator("#btn-play").click()
            page.wait_for_selector("#run-setup")
            nxt = page.locator("#run-setup .setup-nav .btn").nth(1)
            while page.locator("#run-setup").is_visible():
                nxt.click()
                page.wait_for_timeout(180)
            page.wait_for_timeout(2500)
            if need("hud"):
                shot(page, f"{a.outdir}/hud.png")
            if need("pause"):
                # Пауза снимается ВО ВРЕМЯ ВОЛНЫ, а не поверх лавки: два модала
                # рядом накладываются рамками и снимок выглядит сломанным, хотя
                # каждый по отдельности в порядке.
                page.keyboard.press("Escape")
                page.wait_for_timeout(400)
                if page.locator("#pause").is_visible():
                    shot(page, f"{a.outdir}/pause.png")
                page.keyboard.press("Escape")
                page.wait_for_timeout(300)
            if need("shop"):
                page.evaluate("() => globalThis.__RUN__ && globalThis.__RUN__.cheatSkipWave()")
                page.wait_for_timeout(1500)
                if page.locator("#shop").is_visible():
                    shot(page, f"{a.outdir}/shop.png", "#shop")
                else:
                    print("! лавка не открылась (нужен админ для чита?)")

        browser.close()

    if errors:
        print("\nОШИБКИ КОНСОЛИ:")
        for e in errors[:10]:
            print(" -", e)
        raise SystemExit(1)
    print("ошибок консоли нет")


if __name__ == "__main__":
    main()
