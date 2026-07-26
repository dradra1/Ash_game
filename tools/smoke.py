#!/usr/bin/env python3
"""Браузерная проверка игры: логин, запуск забега, движение, fps, ошибки консоли.

DoD этапов формулируется в терминах «залогиненный игрок видит, как оно бегает на 60 fps» —
проверять это надо в настоящем браузере, а не по HTTP-кодам.

    tools/smoke.py                       # прогон по умолчанию, 6 секунд
    tools/smoke.py --seconds 12 --shot scratch/game.png
    tools/smoke.py --url http://127.0.0.1:8150 --user testrunner --password pepel123

Выход 0 — всё сошлось; 1 — упало, с описанием. Скриншот пишется всегда.
"""
import argparse
import sys

from playwright.sync_api import sync_playwright


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8150")
    ap.add_argument("--user", default="smoke")
    ap.add_argument("--password", default="pepel123")
    ap.add_argument("--seconds", type=float, default=6.0)
    ap.add_argument("--shot", default="scratch/smoke.png")
    ap.add_argument("--min-fps", type=float, default=50.0)
    ap.add_argument("--autoplay", action="store_true",
                    help="прокликивать левелапы и лавку, чтобы забег шёл дальше")
    ap.add_argument("--expect-ui", default="",
                    help="через запятую: какие панели обязаны показаться (choice, shop)")
    a = ap.parse_args()

    errors, problems, bad_responses = [], [], []
    seen_ui = set()

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        # Сетевые ошибки ловим по URL ответа, а не по тексту консоли: браузер пишет
        # «Failed to load resource: 404» без адреса, и отличить отсутствующую текстуру
        # (штатное поведение) от сломанного эндпоинта по тексту нельзя.
        page.on("response", lambda r: bad_responses.append((r.status, r.url))
                if r.status >= 400 else None)
        page.on("console", lambda m: errors.append(m.text)
                if m.type == "error" and "Failed to load resource" not in m.text else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        # Регистрация (или вход, если такой игрок уже есть) — через API, не через форму:
        # форма — отдельная забота, здесь проверяется игра.
        page.goto(a.url + "/login")
        res = page.evaluate(
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
            }""", [a.user, a.password])
        if res >= 400:
            problems.append(f"вход не удался: HTTP {res}")

        page.goto(a.url + "/", wait_until="networkidle")

        # Кнопка «Играть» — ищем по тексту из конфига, чтобы не завязываться на разметку
        label = page.evaluate(
            """async () => {
                const c = await (await fetch('/api/config')).json();
                return c.i18n.ru['ui.menu.play'];
            }""")
        clicked = False
        for locator in (page.get_by_role("button", name=label),
                        page.get_by_text(label),
                        page.locator(f"text={label}")):
            try:
                locator.first.click(timeout=3000)
                clicked = True
                break
            except Exception:
                continue
        if not clicked:
            problems.append(f"не нашёл кликабельную кнопку «{label}»")

        page.wait_for_timeout(1500)

        # Позиция игрока до и после удержания клавиш — проверяем, что мир живой
        def pos():
            return page.evaluate(
                "() => { const r = globalThis.__RUN__; "
                "return r && r.state && r.state.players && r.state.players[0] "
                "? [r.state.players[0].x, r.state.players[0].y] : null; }")

        before = pos()
        page.keyboard.down("KeyD")
        page.keyboard.down("KeyS")
        if a.autoplay:
            # Прокликиваем левелапы и лавку: без этого соло-игра встаёт на паузе
            # и до лавки прогон не доходит.
            deadline = a.seconds * 1000
            step = 250
            waited = 0
            while waited < deadline:
                page.wait_for_timeout(step)
                waited += step
                for sel in (".choice", "#shop .btn.go"):
                    try:
                        node = page.locator(sel).first
                        if node.is_visible():
                            node.click(timeout=800)
                            seen_ui.add(sel)
                    except Exception:
                        pass
        else:
            page.wait_for_timeout(int(a.seconds * 1000))
        page.keyboard.up("KeyD")
        page.keyboard.up("KeyS")
        after = pos()

        fps = page.evaluate(
            "() => globalThis.__LOOP__ && globalThis.__LOOP__.stats "
            "? globalThis.__LOOP__.stats.fps : null")
        sim_ms = page.evaluate(
            "() => globalThis.__LOOP__ && globalThis.__LOOP__.stats "
            "? globalThis.__LOOP__.stats.simMs : null")

        page.screenshot(path=a.shot)
        browser.close()

    if before is None or after is None:
        problems.append("не видно globalThis.__RUN__.state.players[0] "
                        "(main.js должен выставлять __RUN__ и __LOOP__ для проверки)")
    elif abs(after[0] - before[0]) < 1 and abs(after[1] - before[1]) < 1:
        problems.append(f"игрок не сдвинулся при удержании WASD: {before} → {after}")

    if fps is None:
        problems.append("нет globalThis.__LOOP__.stats.fps")
    elif fps < a.min_fps:
        problems.append(f"fps {fps:.1f} ниже порога {a.min_fps}")

    # Отсутствующая текстура — штатное поведение (нет PNG → цветной прямоугольник),
    # а 409 на регистрации означает «игрок уже есть» и гасится входом.
    missing_textures = sorted({u.rsplit("/", 1)[-1] for s, u in bad_responses
                               if "/static/textures/" in u})
    real_bad = [(s, u) for s, u in bad_responses
                if "/static/textures/" not in u and "favicon" not in u
                and not (s == 409 and u.endswith("/api/register"))]
    if real_bad:
        problems.append("запросы с ошибкой: "
                        + " | ".join(f"{s} {u}" for s, u in real_bad[:5]))

    expect = [x.strip() for x in a.expect_ui.split(",") if x.strip()]
    alias = {"choice": ".choice", "shop": "#shop .btn.go"}
    for name in expect:
        if alias.get(name, name) not in seen_ui:
            problems.append(f"панель «{name}» так и не показалась за прогон")

    real_errors = [e for e in errors if "favicon" not in e.lower()]
    if real_errors:
        problems.append("ошибки в консоли: " + " | ".join(real_errors[:5]))

    print(f"позиция: {before} → {after}")
    print(f"fps: {fps if fps is None else round(fps, 1)}   "
          f"sim: {sim_ms if sim_ms is None else round(sim_ms, 3)} мс")
    print(f"скриншот: {a.shot}")
    if seen_ui:
        print(f"панели показались: {', '.join(sorted(seen_ui))}")
    if missing_textures:
        print(f"нет текстур (рисуются плейсхолдеры): {', '.join(missing_textures)}")
    if problems:
        print("\nПРОБЛЕМЫ:")
        for pr in problems:
            print(" -", pr)
        return 1
    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
