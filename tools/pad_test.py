#!/usr/bin/env python3
"""Проверка навигации по меню геймпадом — без геймпада.

Настоящего пада на сервере нет, а проверять надо именно его: `ui/focus.js` читает
`navigator.getGamepads()`, и всё поведение висит на фронтах кнопок. Поэтому в
странице подменяется сам API — фейковый пад, кнопками которого управляет тест.
Это честнее ручной проверки: фронты воспроизводимы, и регрессия видна в CI.

    tools/pad_test.py
    tools/pad_test.py --url http://127.0.0.1:8150 --shot scratch/pad.png

Выход 0 — навигация работает; 1 — с описанием, что именно не сошлось.
"""
import argparse
import sys

from playwright.sync_api import sync_playwright

# Standard Gamepad Mapping, те же индексы, что в config.input.gamepad_buttons
A, B, UP, DOWN, LEFT, RIGHT = 0, 1, 12, 13, 14, 15

INIT = """
window.__PAD__ = { buttons: new Array(17).fill(0), axes: [0, 0, 0, 0] };
navigator.getGamepads = () => [{
  connected: true, index: 0, id: 'fake-pad',
  axes: window.__PAD__.axes,
  buttons: window.__PAD__.buttons.map((v) => ({ pressed: !!v, value: v ? 1 : 0 })),
}];
"""


def tap(page, idx):
    """Нажать и отпустить: focus.js ловит ФРОНТ, удержание ничего не даёт."""
    page.evaluate(f"() => {{ window.__PAD__.buttons[{idx}] = 1; }}")
    page.wait_for_timeout(120)
    page.evaluate(f"() => {{ window.__PAD__.buttons[{idx}] = 0; }}")
    page.wait_for_timeout(120)


def focus_id(page):
    return page.evaluate("() => document.activeElement && document.activeElement.id")


def focus_label(page):
    """Здания города — кнопки без id, узнаются по aria-label."""
    return page.evaluate(
        "() => document.activeElement"
        " && document.activeElement.getAttribute('aria-label')")


def walk_to(page, pred, limit=24):
    """Идти «вниз», пока не встретится нужный элемент. -> дошли ли."""
    for _ in range(limit):
        if pred(page):
            return True
        tap(page, DOWN)
    return pred(page)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8150")
    ap.add_argument("--user", default="smoke")
    ap.add_argument("--password", default="pepel123")
    ap.add_argument("--shot", default="scratch/pad.png")
    a = ap.parse_args()

    problems, errors = [], []

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("console", lambda m: errors.append(m.text) if m.type == "error"
                and "Failed to load resource" not in m.text else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.add_init_script(INIT)

        page.goto(a.url + "/login")
        page.evaluate(
            """async ([u, pw]) => {
                let r = await fetch('/api/register', {method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({name:u, password:pw})});
                if (r.status === 409) await fetch('/api/login', {method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({name:u, password:pw})});
            }""", [a.user, a.password])
        page.goto(a.url + "/", wait_until="networkidle")
        page.wait_for_timeout(600)

        # 1. Крестовина двигает фокус по пунктам меню.
        # Первой в городе стоит «Кооп»: отдельной кнопки «Играть» нет с тех пор,
        # как меню стало экраном города — забег начинают Врата, а это здание, а
        # не кнопка верхней панели (ui/city_ui.js).
        first = focus_id(page)
        if first != "btn-coop":
            problems.append(f"фокус при открытии меню не на первой кнопке: {first}")
        tap(page, DOWN)
        moved = focus_id(page)
        if moved == first:
            problems.append(f"«вниз» не сдвинул фокус: {moved}")
        tap(page, UP)
        if focus_id(page) != first:
            problems.append(f"«вверх» не вернул фокус: {focus_id(page)}")

        # 2. A нажимает — доходим до настроек звука и открываем их
        if not walk_to(page, lambda pg: focus_id(pg) == "btn-audio", 8):
            problems.append("до кнопки звука фокус не дошёл")
        tap(page, A)
        if not page.locator("#audio-settings").is_visible():
            problems.append("A не открыл настройки звука")

        # 3. Влево-вправо на ползунке меняет громкость, а не уводит фокус
        before = page.evaluate(
            "() => document.querySelectorAll('#audio-settings input')[0].value")
        tap(page, RIGHT)
        after = page.evaluate(
            "() => document.querySelectorAll('#audio-settings input')[0].value")
        if before == after:
            problems.append(f"ползунок музыки не сдвинулся падом: {before} → {after}")

        page.screenshot(path=a.shot)

        # 4. B — назад
        tap(page, B)
        if page.locator("#audio-settings").is_visible():
            problems.append("B не закрыл настройки")
        if not page.locator("#screen-menu").is_visible():
            problems.append("после B не вернулись в меню")

        # 5. Здания города тоже под падом: доходим до Ловчего Дома и заходим в
        # него. Зал и диалог — обычная панель `.modal` с кнопкой `.btn.back`,
        # поэтому focus.js подхватывает их без единой строчки в lodge_ui.js;
        # проверяем, что это действительно так, а не на словах.
        lodge_name = page.evaluate(
            """async () => {
                const c = await (await fetch('/api/config')).json();
                const b = (c.city.buildings || []).find(
                    (x) => x.action && x.action.type === 'quests');
                return b ? c.i18n.ru[b.name] : '';
            }""")
        if lodge_name:
            if not walk_to(page, lambda pg: (focus_label(pg) or "") == lodge_name):
                problems.append(f"до здания «{lodge_name}» фокус не дошёл")
            else:
                tap(page, A)
                if not page.locator("#lodge").is_visible():
                    problems.append("A не открыл Ловчий Дом")
                # В зале фокус должен встать на первого персонажа, а не улететь
                if not walk_to(page, lambda pg: page.evaluate(
                        "() => !!(document.activeElement"
                        " && document.activeElement.closest('#lodge .npc'))"), 6):
                    problems.append("в зале Ловчего Дома фокус не встал на персонажа")
                else:
                    tap(page, A)
                    if page.locator("#lodge .dlg-head").count() == 0:
                        problems.append("A не открыл диалог с персонажем")
                    tap(page, B)
                    if page.locator("#lodge .dlg-head").count() != 0:
                        problems.append("B не вернул из диалога в зал")
                tap(page, B)
                if page.locator("#lodge").is_visible():
                    problems.append("B не закрыл Ловчий Дом")

        browser.close()

    for e in errors:
        problems.append(f"ошибка в консоли: {e}")
    print(f"скриншот: {a.shot}")
    if problems:
        print("\nПРОБЛЕМЫ:")
        for pr in problems:
            print(f" - {pr}")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
