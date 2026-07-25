#!/usr/bin/env python3
"""Скачивание готовых map-object'ов pixellab в static/textures/<texture_id>.png.

Аргументы — пары `<texture_id>:<object_id>` (id берётся из create_map_object).
Объекты живут в pixellab 8 часов — качать сразу после генерации.

  python3 tools/fetch_map_objects.py b_dv_hq:c40cd9ac-... b_dv_house:ec7f9438-...
"""
import os
import sys
import time
import urllib.request

URL = "https://api.pixellab.ai/mcp/map-objects/{oid}/download"
OUTDIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                      "static", "textures")


def fetch(texture_id, object_id, tries=20):
    """423 Locked = объект ещё генерится, ждём и пробуем снова."""
    req = urllib.request.Request(URL.format(oid=object_id),
                                 headers={"User-Agent": "curl/8.0"})
    for attempt in range(tries):
        try:
            data = urllib.request.urlopen(req, timeout=60).read()
            break
        except urllib.error.HTTPError as e:
            if e.code != 423 or attempt == tries - 1:
                raise
            time.sleep(10)
    if not data.startswith(b"\x89PNG"):
        raise SystemExit(f"{texture_id}: не PNG (объект ещё не готов или удалён)")
    path = os.path.join(OUTDIR, f"{texture_id}.png")
    with open(path, "wb") as f:
        f.write(data)
    print(f"{path}: {len(data)} байт")


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        tex, _, oid = arg.partition(":")
        fetch(tex, oid)
