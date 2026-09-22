#!/usr/bin/env bash
# Собрать офлайн-веб в offline/build/web/: index.html + static/ + конфиг.
# Итог — самодостаточный сайт без сервера: его раздаёт WebViewAssetLoader в
# android-offline/, а для проверки на десктопе — любой статический сервер:
#   python3 -m http.server -d offline/build/web 8199
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/offline/build/web"
# Живой конфиг сайта (том data/ основного чекаута) бывает новее репо-сида —
# берём копию с бОльшим content_version, как делает _config_for_client в app.py.
LIVE="${ASH_LIVE_CONFIG:-/opt/sites/ash-and-iron/data/game_config.json}"

rm -rf "$OUT"
mkdir -p "$OUT/static/offline"
cp "$ROOT/offline/index.html" "$OUT/index.html"
rsync -a --exclude 'vendor/' "$ROOT/static/" "$OUT/static/"

python3 - "$ROOT/config/game_config.json" "$LIVE" "$OUT/static/offline/game_config.json" <<'PY'
import json, sys, pathlib
repo, live, out = (pathlib.Path(p) for p in sys.argv[1:])
cfg = json.loads(repo.read_text(encoding="utf-8"))
if live.exists():
    lv = json.loads(live.read_text(encoding="utf-8"))
    if int(lv.get("content_version") or 0) >= int(cfg.get("content_version") or 0):
        # i18n доливается из репо, как в app.py: живой том мог отстать по ключам
        for lang, d in (cfg.get("i18n") or {}).items():
            lv.setdefault("i18n", {}).setdefault(lang, {})
            for k, v in d.items():
                lv["i18n"][lang].setdefault(k, v)
        cfg = lv
out.write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")
print("config content_version", cfg.get("content_version"))
PY
du -sh "$OUT"
