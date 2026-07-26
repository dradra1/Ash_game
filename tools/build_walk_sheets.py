#!/usr/bin/env python3
"""Сборка idle+walk листов для юнитов, у которых анимация уже сгенерирована.

Нужен отдельно от генератора, потому что сборке требуется Pillow: он есть в системном
python3, но не в .venv, где живут только зависимости сервера (CLAUDE.md §5).

    python3 tools/build_walk_sheets.py                все ch_*/e_* проекта
    python3 tools/build_walk_sheets.py ch_brute       только указанные

Соответствие texture-id → character-id берётся из list_characters по имени персонажа,
поэтому список нигде не дублируется и не разъезжается.
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PXL = os.path.join(ROOT, "tools", "pxl.py")
TEXDIR = os.path.join(ROOT, "static", "textures")
OURS = re.compile(r"^(ch|e|el|b)_")


def pxl(*args, timeout=600):
    r = subprocess.run([sys.executable, PXL, *args], capture_output=True, text=True,
                       cwd=ROOT, timeout=timeout)
    return r.returncode, r.stdout + r.stderr


def roster():
    """texture-id → (character-id, есть ли анимация). Чужие проекты в аккаунте пропускаем."""
    out = {}
    for offset in range(0, 200, 10):
        code, text = pxl("call", "list_characters", f'{{"offset": {offset}}}')
        rows = re.findall(r"^\s+([0-9a-f-]{36}) \| (\S+) \| .*?(\| \d+anim)?$",
                          text, re.M)
        if not rows:
            break
        for cid, name, anim in rows:
            if OURS.match(name):
                out[name] = (cid, bool(anim))
    return out


def fit_for(texture):
    """Размер листа = размер уже лежащего idle-листа; по умолчанию 48."""
    path = os.path.join(TEXDIR, f"{texture}.png")
    if os.path.exists(path):
        from PIL import Image
        return Image.open(path).width
    return 48


def main():
    want = set(sys.argv[1:])
    units = roster()
    ok = bad = skip = 0
    for texture, (cid, has_anim) in sorted(units.items()):
        if want and texture not in want:
            continue
        if not has_anim:
            print(f"  · {texture}: анимации нет, пропуск")
            skip += 1
            continue
        fit = fit_for(texture)
        code, out = pxl("sheets", cid, texture, "--fit", str(fit))
        built = os.path.exists(os.path.join(TEXDIR, f"{texture}_walk.png"))
        if code == 0 and built:
            print(f"  = {texture}: листы собраны, {fit}px")
            ok += 1
        else:
            print(f"  ! {texture}: {out.strip()[-200:]}")
            bad += 1
    print(f"ИТОГ: собрано {ok}, провал {bad}, без анимации {skip}")
    if bad:
        sys.exit(1)


if __name__ == "__main__":
    main()
