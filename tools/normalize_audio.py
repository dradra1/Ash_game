#!/usr/bin/env python3
"""Выравнивание громкости музыкальных треков по EBU R128.

Зачем. Треки взяты у разных авторов с разным мастерингом, и разброс интегральной
громкости между ними — 19 LU: `mu_wave_c` звучит на −10.9 LUFS, `mu_menu` на −29.8.
Вход в волну из меню воспринимался как удар, а не как смена темы.

Почему не хватило ручки `gain` в конфиге. Она может только приглушить: чтобы
подтянуть `mu_menu` до общего уровня, нужен множитель около 4, а громкость
`<audio>` ограничена единицей. Приглушать всё до самого тихого — значит утопить
музыку под синтезированными эффектами. Поэтому уровень правится в самих файлах, а
`gain` остаётся тем, чем и был: поправкой на редкое исключение.

Как. Двухпроходный `loudnorm`: первый проход измеряет, второй применяет линейную
нормализацию с уже известными числами. Однопроходный режим работает динамически и
плющит тихие места — для музыки это слышно.

CC0 разрешает модификацию, но факт правки обязан быть записан: см. CREDITS.md.

    tools/normalize_audio.py             показать замер и план
    tools/normalize_audio.py --apply     перекодировать
    tools/normalize_audio.py --check     только замер (после применения)
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.path.join(ROOT, "static", "audio")
BACKUP = os.path.join(ROOT, "scratch", "audio_orig")

# −18 LUFS: заметно ниже потолка, чтобы пики после ресемплинга не упирались в
# клиппинг, и достаточно громко, чтобы музыка не терялась под эффектами.
TARGET_I = -18.0
TARGET_TP = -1.5
TARGET_LRA = 11.0
# q2 — тот же битрейт, что у остальных файлов (см. ASSETS.md §9): исходники шли до
# 350 кбит/с, а браузерной игре это не нужно.
QUALITY = "2"


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def measure(path):
    """Интегральная громкость, LRA и true peak. -> dict | None"""
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", path,
             "-af", "ebur128=peak=true", "-f", "null", "-"])
    out = r.stderr
    tail = out[out.rfind("Summary:"):] if "Summary:" in out else out
    def grab(label):
        m = re.search(label + r":\s*(-?\d+(?:\.\d+)?)", tail)
        return float(m.group(1)) if m else None
    i = grab("I")
    if i is None:
        return None
    return {"I": i, "LRA": grab("LRA"), "TP": grab("Peak")}


def analyse(path):
    """Первый проход loudnorm: числа для линейной нормализации. -> dict | None"""
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", path,
             "-af", (f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}"
                     ":print_format=json"),
             "-f", "null", "-"])
    start = r.stderr.rfind("{")
    end = r.stderr.rfind("}")
    if start < 0 or end < 0:
        return None
    try:
        return json.loads(r.stderr[start:end + 1])
    except ValueError:
        return None


def normalize(path, stats):
    """Второй проход: применить измеренное. Пишет рядом, потом подменяет файл."""
    tmp = path + ".norm.ogg"
    flt = (f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}"
           f":measured_I={stats['input_i']}"
           f":measured_TP={stats['input_tp']}"
           f":measured_LRA={stats['input_lra']}"
           f":measured_thresh={stats['input_thresh']}"
           f":offset={stats['target_offset']}"
           ":linear=true:print_format=summary")
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-y", "-i", path,
             "-af", flt, "-c:a", "libvorbis", "-q:a", QUALITY, tmp])
    if r.returncode != 0 or not os.path.exists(tmp):
        print(r.stderr[-800:])
        if os.path.exists(tmp):
            os.remove(tmp)
        return False
    os.makedirs(BACKUP, exist_ok=True)
    keep = os.path.join(BACKUP, os.path.basename(path))
    if not os.path.exists(keep):
        shutil.copyfile(path, keep)      # оригинал не восстановить перекодированием
    os.replace(tmp, path)
    return True


def tracks():
    if not os.path.isdir(AUDIO):
        return []
    return sorted(os.path.join(AUDIO, f) for f in os.listdir(AUDIO)
                  if f.endswith(".ogg"))


def report(files, header):
    print(header)
    print(f"  {'трек':<16}{'I, LUFS':>10}{'LRA, LU':>10}{'TP, dBFS':>10}")
    values = []
    for p in files:
        m = measure(p)
        if not m:
            print(f"  {os.path.basename(p):<16}{'—':>10}")
            continue
        values.append(m["I"])
        print(f"  {os.path.basename(p):<16}{m['I']:>10.1f}"
              f"{(m['LRA'] if m['LRA'] is not None else 0):>10.1f}"
              f"{(m['TP'] if m['TP'] is not None else 0):>10.1f}")
    if values:
        spread = max(values) - min(values)
        print(f"  разброс: {spread:.1f} LU")
    return values


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--check", action="store_true", help="только замер")
    a = ap.parse_args()

    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg не найден")
    files = tracks()
    if not files:
        sys.exit(f"нет ogg-файлов в {AUDIO}")

    report(files, f"=== замер, цель I = {TARGET_I} LUFS ===")
    if a.check:
        return
    if not a.apply:
        print("\n(dry-run, передай --apply)")
        return

    print("\n=== нормализация ===")
    for p in files:
        stats = analyse(p)
        if not stats:
            print(f"  ! {os.path.basename(p)}: замер не удался")
            continue
        ok = normalize(p, stats)
        print(f"  {'=' if ok else '!'} {os.path.basename(p)}"
              f"  {float(stats['input_i']):.1f} → {TARGET_I} LUFS")

    print()
    report(files, "=== после ===")
    print(f"\nоригиналы: {BACKUP}")


if __name__ == "__main__":
    main()
