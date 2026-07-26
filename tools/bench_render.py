#!/usr/bin/env python3
"""Замер рендера в браузере: спрайты против плейсхолдеров, под нагрузкой волны.

Зачем отдельно от bench_sim.js: тот гоняет чистую симуляцию в node и рендера не
видит вовсе. А бюджет CLAUDE.md §4 делит кадр на sim ≤ 6 мс и render ≤ 6 мс, и
переход врагов с цветных прямоугольников (fillRect) на анимированные спрайт-листы
(drawImage) бьёт именно во вторую половину.

Приём: во втором прогоне блокируются запросы к /static/textures/, все спрайты
падают в failed и клиент рисует плейсхолдеры (CLAUDE.md §3.3). Разница двух
прогонов — цена спрайтов, без единой правки кода.

    python3 tools/bench_render.py --url http://127.0.0.1:8151 --wave 20
"""
import argparse
import statistics
import sys

from playwright.sync_api import sync_playwright


def run(pw, url, wave, seconds, block_textures):
    browser = pw.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    if block_textures:
        page.route("**/static/textures/**", lambda route: route.abort())

    page.goto(url + "/login")
    page.evaluate("""async () => {
        let r = await fetch('/api/register', {method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({name:'benchrender', password:'pepel123'})});
        if (r.status === 409) await fetch('/api/login', {method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({name:'benchrender', password:'pepel123'})});
    }""")
    page.goto(url + "/", wait_until="networkidle")
    page.locator("#btn-play").first.click(timeout=5000)
    page.wait_for_timeout(2000)

    # Прыгаем на позднюю волну: там максимальная плотность врагов.
    page.evaluate(f"""() => {{
        const r = globalThis.__RUN__;
        if (r && r.startWave) r.startWave({wave});
    }}""")
    page.wait_for_timeout(3000)

    samples = []
    for _ in range(int(seconds * 2)):
        page.wait_for_timeout(500)
        # Подпитываем HP: иначе игрок гибнет на второй волне, забег сбрасывается
        # и плотность врагов не успевает вырасти — мерить будет нечего.
        s = page.evaluate("""() => {
            const l = globalThis.__LOOP__, r = globalThis.__RUN__;
            if (!l || !r) return null;
            if (r.state && r.state.players) {
                for (let i = 0; i < r.state.players.length; i++) {
                    const p = r.state.players[i];
                    if (p && p.maxHp) p.hp = p.maxHp;
                }
            }
            return {fps: l.stats.fps, render: l.stats.renderMs, sim: l.stats.simMs,
                    enemies: r.enemyPool ? r.enemyPool.count : 0,
                    projs: r.projPool ? r.projPool.count : 0};
        }""")
        if s and s["enemies"] > 0:
            samples.append(s)
    browser.close()
    return samples


def report(label, s):
    if not s:
        print(f"{label}: нет выборок (враги не появились?)")
        return None
    r = sorted(x["render"] for x in s)
    print(f"{label}:")
    print(f"  враги  медиана {statistics.median(x['enemies'] for x in s):.0f}"
          f"  максимум {max(x['enemies'] for x in s)}")
    print(f"  снаряды медиана {statistics.median(x['projs'] for x in s):.0f}")
    print(f"  render мс — среднее {statistics.mean(r):.3f}"
          f"  медиана {statistics.median(r):.3f}  максимум {max(r):.3f}")
    print(f"  fps    медиана {statistics.median(x['fps'] for x in s):.1f}")
    return statistics.median(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8151")
    ap.add_argument("--wave", type=int, default=20)
    ap.add_argument("--seconds", type=float, default=12.0)
    a = ap.parse_args()

    with sync_playwright() as pw:
        with_spr = run(pw, a.url, a.wave, a.seconds, block_textures=False)
        without = run(pw, a.url, a.wave, a.seconds, block_textures=True)

    m1 = report("со спрайтами", with_spr)
    m2 = report("плейсхолдеры (текстуры заблокированы)", without)
    if m1 is not None and m2 is not None:
        print(f"\nцена спрайтов: {m1 - m2:+.3f} мс к медиане рендера")
    if m1 is not None:
        verdict = "УКЛАДЫВАЕМСЯ" if m1 <= 6 else "ВЫХОД ЗА БЮДЖЕТ"
        print(f"бюджет рендера 6 мс: {verdict} (медиана {m1:.3f})")
        if m1 > 6:
            sys.exit(1)


if __name__ == "__main__":
    main()
