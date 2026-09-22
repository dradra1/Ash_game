#!/usr/bin/env python3
"""Браузерная проверка игры: логин, запуск забега, движение, fps, ошибки консоли.

DoD этапов формулируется в терминах «залогиненный игрок видит, как оно бегает на 60 fps» —
проверять это надо в настоящем браузере, а не по HTTP-кодам.

    tools/smoke.py                       # прогон по умолчанию, 6 секунд
    tools/smoke.py --seconds 12 --shot scratch/game.png
    tools/smoke.py --url http://127.0.0.1:8150 --user testrunner --password pepel123
    tools/smoke.py --mobile              # телефон 360×800 dpr 3: тач, зум, пауза

Выход 0 — всё сошлось; 1 — упало, с описанием. Скриншот пишется всегда.
"""
import argparse
import sys

from playwright.sync_api import sync_playwright

# Синтетическое касание канваса: playwright умеет только tap, а виртуальному
# джойстику нужен полноценный touchstart→touchmove→touchend (engine/input.js).
TOUCH_JS = """([phase, x, y]) => {
  const c = document.getElementById('game');
  const t = new Touch({ identifier: 1, target: c, clientX: x, clientY: y });
  const list = phase === 'end' ? [] : [t];
  const type = phase === 'start' ? 'touchstart'
    : phase === 'move' ? 'touchmove' : 'touchend';
  c.dispatchEvent(new TouchEvent(type, {
    bubbles: true, cancelable: true,
    touches: list, targetTouches: list, changedTouches: [t],
  }));
}"""


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
    ap.add_argument("--mobile", action="store_true",
                    help="профиль телефона: тач-джойстик вместо WASD, проверка зума и паузы")
    a = ap.parse_args()

    errors, problems, bad_responses = [], [], []
    seen_ui = set()
    zoom = None
    pause_ok = None

    # Телефон 360×800 при dpr 3 — самый частый профиль. Ожидаемый зум считается
    # по той же формуле, что в engine/render.js: s = 2 device-px на мировую
    # единицу при minView 500, значит в CSS-пикселях 2/3.
    if a.mobile:
        page_kwargs = {
            "viewport": {"width": 360, "height": 800},
            "device_scale_factor": 3,
            "is_mobile": True,
            "has_touch": True,
        }
        expect_zoom = 2 / 3
    else:
        page_kwargs = {"viewport": {"width": 1280, "height": 800}}
        # Десктоп обязан остаться ровно таким, каким был до мобильного режима.
        expect_zoom = 1.0

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(**page_kwargs)
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

        # Забег начинают Врата — здание города с action `play` (ui/city_ui.js).
        # Отдельной кнопки «Играть» нет с тех пор, как меню стало экраном города:
        # у зданий подпись лежит в aria-label, отсюда поиск по роли и имени.
        # Старые селекторы оставлены запасными на случай отката меню.
        label, gate = page.evaluate(
            """async () => {
                const c = await (await fetch('/api/config')).json();
                const b = (c.city.buildings || []).find(
                    (x) => x.action && x.action.type === 'play');
                return [c.i18n.ru['ui.menu.play'],
                        b ? c.i18n.ru[b.name] : ''];
            }""")
        clicked = False
        for locator in (page.get_by_role("button", name=gate),
                        page.locator("#btn-play"),
                        page.get_by_role("button", name=label),
                        page.get_by_text(label)):
            try:
                locator.first.click(timeout=3000)
                clicked = True
                break
            except Exception:
                continue
        if not clicked:
            problems.append(f"не нашёл кликабельное здание «{gate}» (и кнопку «{label}»)")

        # «Играть» больше не запускает забег сразу: сначала преран-мастер
        # (персонаж → арена → сложность → проклятия). Прокликиваем «Дальше»,
        # принимая значения по умолчанию, пока панель не уйдёт с экрана.
        for _ in range(6):
            page.wait_for_timeout(400)
            try:
                nxt = page.locator("#run-setup .btn.next")
                if not nxt.is_visible():
                    break
                nxt.click(timeout=2000)
            except Exception:
                break

        page.wait_for_timeout(1500)

        # Позиция игрока до и после удержания клавиш — проверяем, что мир живой
        def pos():
            return page.evaluate(
                "() => { const r = globalThis.__RUN__; "
                "return r && r.state && r.state.players && r.state.players[0] "
                "? [r.state.players[0].x, r.state.players[0].y] : null; }")

        before = pos()
        if a.mobile:
            # Левая половина экрана — джойстик; палец уезжает вправо-вниз, то же
            # направление, что даёт связка D+S на клавиатуре.
            page.evaluate(TOUCH_JS, ["start", 60, 620])
            page.evaluate(TOUCH_JS, ["move", 110, 660])
        else:
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
        if a.mobile:
            page.evaluate(TOUCH_JS, ["end", 110, 660])
        else:
            page.keyboard.up("KeyD")
            page.keyboard.up("KeyS")
        after = pos()

        zoom = page.evaluate(
            "() => globalThis.__RENDER__ ? globalThis.__RENDER__.view.zoom : null")

        # Кнопку паузы жмём последней: она останавливает забег.
        if a.mobile:
            try:
                btn = page.locator(".touch-pause")
                pause_ok = btn.is_visible()
                if pause_ok:
                    btn.tap()
                    page.wait_for_timeout(400)
                    pause_ok = page.locator("#pause").is_visible()
            except Exception as e:
                pause_ok = False
                problems.append(f"кнопка паузы: {e}")

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

    if zoom is None:
        problems.append("нет globalThis.__RENDER__.view.zoom")
    elif abs(zoom - expect_zoom) > 1e-6:
        problems.append(f"зум камеры {zoom:.4f}, ожидался {expect_zoom:.4f}")

    if a.mobile and not pause_ok:
        problems.append("экранная кнопка паузы не открыла меню паузы")

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
          f"sim: {sim_ms if sim_ms is None else round(sim_ms, 3)} мс   "
          f"зум: {zoom if zoom is None else round(zoom, 4)}")
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
