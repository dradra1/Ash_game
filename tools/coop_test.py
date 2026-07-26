#!/usr/bin/env python3
"""Сквозная проверка коопа: N настоящих браузеров в одной комнате.

DoD этапа M3 формулируется как «4 игрока проходят волны без рассинхронов и рывков
при пинге 80 мс, ≤30 КБ/с на клиента» — это проверяется только реальными клиентами,
которые говорят через сервер.

    tools/coop_test.py                       # 4 игрока, 40 секунд
    tools/coop_test.py --players 8 --seconds 60 --latency 80

--latency добавляет каждому не-хосту односторонюю задержку сети (мс) через CDP,
чтобы увидеть работу интерполяции и предсказания, а не идеальный localhost.
"""
import argparse
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8150"


def login(page, url, name, password):
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
        }""", [name, password])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=BASE)
    ap.add_argument("--players", type=int, default=4)
    ap.add_argument("--seconds", type=float, default=40)
    ap.add_argument("--latency", type=float, default=80, help="односторонняя задержка, мс")
    ap.add_argument("--shot", default="scratch/coop.png")
    ap.add_argument("--password", default="pepel123")
    a = ap.parse_args()

    problems = []
    errors = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox"])
        pages = []
        for i in range(a.players):
            ctx = browser.new_context(viewport={"width": 900, "height": 620})
            page = ctx.new_page()
            page.on("pageerror", lambda e, i=i: errors.append(f"игрок {i}: {e}"))
            page.on("console", lambda m, i=i: errors.append(f"игрок {i}: {m.text}")
                    if m.type == "error" and "Failed to load resource" not in m.text else None)
            st = login(page, a.url, f"coop{i}", a.password)
            if st >= 400:
                problems.append(f"игрок {i}: вход не удался ({st})")
            page.goto(a.url + "/", wait_until="networkidle")
            pages.append(page)

        host = pages[0]

        # Хост открывает комнату
        code = host.evaluate("""async () => {
            const res = await globalThis.__COOP__.create();
            return res && res.room ? res.room.code : null;
        }""")
        if not code:
            problems.append("хост не смог создать комнату")
            browser.close()
            return report(problems, errors, None)
        print(f"комната: {code}")

        # Остальные входят по коду
        for i, page in enumerate(pages[1:], start=1):
            res = page.evaluate("""async (code) => {
                const r = await globalThis.__COOP__.join(code);
                return r && r.error ? r.error : 'ok';
            }""", code)
            if res != "ok":
                problems.append(f"игрок {i} не вошёл: {res}")

        host.wait_for_timeout(600)
        seen = host.evaluate("() => globalThis.__COOP__.lobby.room.players.length")
        if seen != a.players:
            problems.append(f"в лобби {seen} игроков вместо {a.players}")

        # Задержка сети — только не-хостам: у хоста симуляция локальная
        if a.latency > 0:
            for page in pages[1:]:
                cdp = page.context.new_cdp_session(page)
                cdp.send("Network.enable")
                cdp.send("Network.emulateNetworkConditions", {
                    "offline": False,
                    "latency": a.latency,
                    "downloadThroughput": -1,
                    "uploadThroughput": -1,
                })

        # Все готовы, хост стартует
        for page in pages:
            page.evaluate("() => globalThis.__COOP__.lobby.ready(true)")
        host.wait_for_timeout(400)
        host.evaluate("() => globalThis.__COOP__.lobby.start()")
        host.wait_for_timeout(1500)

        # Бегаем в разные стороны, чтобы позиции реально расходились
        keys = ["KeyD", "KeyA", "KeyS", "KeyW"]
        for i, page in enumerate(pages):
            page.keyboard.down(keys[i % len(keys)])

        waited = 0
        step = 500
        while waited < a.seconds * 1000:
            host.wait_for_timeout(step)
            waited += step
            for page in pages:
                try:
                    node = page.locator(".choice").first
                    if node.is_visible():
                        node.click(timeout=500)
                except Exception:
                    pass
                try:
                    node = page.locator("#shop .btn.go").first
                    if node.is_visible():
                        node.click(timeout=500)
                except Exception:
                    pass

        for i, page in enumerate(pages):
            page.keyboard.up(keys[i % len(keys)])

        # Сверяем миры: у хоста авторитет, у клиентов — интерполяция
        host_state = host.evaluate("""() => {
            const r = globalThis.__RUN__;
            return {wave: r.state.wave, phase: r.state.phase,
                    players: r.state.players.map(p => [Math.round(p.x), Math.round(p.y)]),
                    enemies: r.enemyPool ? r.enemyPool.count : 0,
                    kbs: globalThis.__NET__ ? globalThis.__NET__.stats.kbs : 0};
        }""")
        print(f"хост: волна {host_state['wave']} ({host_state['phase']}), "
              f"врагов {host_state['enemies']}, исходящих "
              f"{host_state['kbs']:.1f} КБ/с")

        max_drift = 0
        for i, page in enumerate(pages[1:], start=1):
            cs = page.evaluate("""() => {
                const r = globalThis.__RUN__;
                const n = globalThis.__NET__;
                return {wave: r.state.wave, phase: r.state.phase,
                        players: r.state.players.map(p => [Math.round(p.x), Math.round(p.y)]),
                        enemies: n && n.enemies ? n.enemies.count : 0,
                        kbs: n && n.stats ? n.stats.kbs : 0,
                        snaps: n && n.stats ? n.stats.snaps : 0,
                        lost: n && n.stats ? n.stats.lost : 0,
                        fps: globalThis.__LOOP__.stats.fps};
            }""")
            print(f"игрок {i}: волна {cs['wave']}, врагов {cs['enemies']}, "
                  f"снапшотов {cs['snaps']} (потеряно {cs['lost']}), "
                  f"{cs['kbs']:.1f} КБ/с, {cs['fps']:.0f} fps")

            if cs["snaps"] == 0:
                problems.append(f"игрок {i} не получил ни одного снапшота")
            if cs["wave"] != host_state["wave"]:
                problems.append(f"игрок {i}: волна {cs['wave']} против {host_state['wave']} у хоста")
            if cs["fps"] < 50:
                problems.append(f"игрок {i}: {cs['fps']:.0f} fps")
            if cs["kbs"] > 30:
                problems.append(f"игрок {i}: {cs['kbs']:.1f} КБ/с при бюджете 30")
            # расхождение позиции своего персонажа между клиентом и хостом
            if i < len(host_state["players"]) and i < len(cs["players"]):
                hx, hy = host_state["players"][i]
                cx, cy = cs["players"][i]
                drift = ((hx - cx) ** 2 + (hy - cy) ** 2) ** 0.5
                max_drift = max(max_drift, drift)

        print(f"максимальное расхождение позиции клиент↔хост: {max_drift:.0f} px")
        if max_drift > 120:
            problems.append(f"расхождение {max_drift:.0f} px — предсказание не сходится")

        host.screenshot(path=a.shot)
        browser.close()

    return report(problems, errors, a.shot)


def report(problems, errors, shot):
    real = [e for e in errors if "favicon" not in e.lower()
            and "/static/textures/" not in e]
    if shot:
        print(f"скриншот хоста: {shot}")
    if real:
        problems.append("ошибки в консоли: " + " | ".join(real[:5]))
    if problems:
        print("\nПРОБЛЕМЫ:")
        for p in problems:
            print(" -", p)
        return 1
    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
