#!/usr/bin/env python3
"""Синхронизация репо-конфига в живой (data/game_config.json).

Репо-конфиг `config/game_config.json` — только сид первого запуска. Живой лежит в
`data/` и переживает перезапуски, поэтому правка репо-конфига сама по себе на игру
не влияет — классический источник «почему изменения не применились».

    tools/sync_config.py            # показать различие ключей верхнего уровня
    tools/sync_config.py --apply    # влить репо-конфиг в живой

На этапе разработки, пока живой конфиг никто не правит руками, `--apply` безопасен.
Когда появятся правки на лету, содержательные изменения накатываются идемпотентными
`tools/patch_config_*.py` сразу в обе копии (см. CLAUDE.md §3.2).
"""
import argparse
import json
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(ROOT, "config", "game_config.json")
LIVE = os.path.join(os.environ.get("ASH_DATA", os.path.join(ROOT, "data")), "game_config.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    repo = json.load(open(REPO, encoding="utf-8"))
    if not os.path.exists(LIVE):
        print(f"живого конфига нет ({LIVE}) — будет создан при старте приложения")
        live = {}
    else:
        live = json.load(open(LIVE, encoding="utf-8"))

    only_repo = sorted(set(repo) - set(live))
    only_live = sorted(set(live) - set(repo))
    differing = sorted(k for k in set(repo) & set(live) if repo[k] != live[k])

    print(f"репо  content_version={repo.get('content_version')}  секций {len(repo)}")
    print(f"живой content_version={live.get('content_version')}  секций {len(live)}")
    if only_repo:
        print("  только в репо:", ", ".join(only_repo))
    if only_live:
        print("  только в живом:", ", ".join(only_live))
    if differing:
        print("  различаются:", ", ".join(differing))
    if not (only_repo or only_live or differing):
        print("  конфиги совпадают")
        return

    if a.apply:
        os.makedirs(os.path.dirname(LIVE), exist_ok=True)
        shutil.copyfile(REPO, LIVE)
        print("влито. Перезапусти контейнер: docker compose restart")
    else:
        print("\nчтобы влить: tools/sync_config.py --apply")


if __name__ == "__main__":
    main()
