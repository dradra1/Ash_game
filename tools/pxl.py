#!/usr/bin/env python3
"""CLI к pixellab поверх её MCP-эндпоинта (JSON-RPC over HTTP+SSE).

Нужен, потому что MCP-сервер pixellab зарегистрирован не во всех сессиях, а генерация
ассетов должна работать всегда. Тот же токен, тот же тулсет.

    tools/pxl.py balance
    tools/pxl.py tools                            список инструментов и их параметров
    tools/pxl.py call create_character '{"description": "...", "size": 64}'
    tools/pxl.py call create_character @spec.json
    tools/pxl.py wait <character_id> [--timeout 900]
    tools/pxl.py get <character_id>

Токен: env PIXELLAB_TOKEN, иначе data/.pixellab_token (в .gitignore).

ПРАВОВОЙ ФИЛЬТР (CLAUDE.md §1): любой промпт со словом из BANNED отклоняется до
отправки. Не ослаблять — это защита проекта от претензий Games Workshop.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ENDPOINT = "https://api.pixellab.ai/mcp"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Слова и иконография из §0 ТЗ. Проверяется по всему JSON аргументов, регистронезависимо.
BANNED = [
    r"warhammer", r"\b40\s*000\b", r"\b40k\b", r"space\s*marine", r"astartes",
    r"imperium", r"imperial\s+guard", r"god[\s-]?emperor", r"\bemperor\b",
    r"\borks?\b", r"tyranid", r"necron", r"\beldar\b", r"adeptus", r"mechanicus",
    r"inquisit", r"\bbolter\b", r"bolt\s*gun", r"chainsword", r"servo[\s-]?skull",
    r"aquila", r"double[\s-]?headed\s+eagle", r"two[\s-]?headed\s+eagle",
    r"skull\s+and\s+cog", r"cog\s+and\s+skull", r"grey\s+knight", r"ultramarine",
    r"blood\s+angel", r"dark\s+angel", r"space\s+wolf", r"sisters\s+of\s+battle",
    r"primarch", r"\bxenos\b", r"\bwarp\s+storm\b", r"lasgun", r"\bmeltagun\b",
    r"power\s+fist", r"terminator\s+armou?r", r"\bcommissar\b",
]


def guard(payload):
    """Отклонить промпт с защищённым названием. Возвращает список нарушений."""
    blob = json.dumps(payload, ensure_ascii=False).lower()
    return [p for p in BANNED if re.search(p, blob)]


def token():
    t = os.environ.get("PIXELLAB_TOKEN")
    if t:
        return t.strip()
    path = os.path.join(ROOT, "data", ".pixellab_token")
    if os.path.exists(path):
        with open(path) as f:
            return f.read().strip()
    sys.exit("нет токена: задай PIXELLAB_TOKEN или положи data/.pixellab_token")


def rpc(method, params=None, timeout=180):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method,
                       "params": params or {}}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, method="POST", headers={
        "Authorization": f"Bearer {token()}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:500]}")
    # ответ приходит как SSE: "event: message\ndata: {...}"
    for line in raw.splitlines():
        if line.startswith("data: "):
            msg = json.loads(line[6:])
            if "error" in msg:
                sys.exit(f"RPC error: {json.dumps(msg['error'], ensure_ascii=False)}")
            return msg.get("result", {})
    sys.exit(f"неразобранный ответ: {raw[:500]}")


def call(name, args, timeout=180):
    bad = guard(args)
    if bad:
        sys.exit(f"ЗАПРЕЩЁННЫЕ СЛОВА в промпте ({', '.join(bad)}) — см. CLAUDE.md §1. "
                 f"Переформулируй в оригинальных терминах.")
    res = rpc("tools/call", {"name": name, "arguments": args}, timeout=timeout)
    out = "\n".join(c.get("text", "") for c in res.get("content", []))
    if res.get("isError"):
        sys.exit(f"pixellab: {out}")
    return out


def load_args(spec):
    if spec.startswith("@"):
        with open(spec[1:]) as f:
            return json.load(f)
    return json.loads(spec) if spec else {}


def cmd_wait(args):
    """Ждать готовности персонажа/объекта: опрашиваем, пока не пропадёт 'pending'."""
    deadline = time.time() + args.timeout
    getter = {"character": "get_character", "object": "get_object"}[args.kind]
    key = {"character": "character_id", "object": "object_id"}[args.kind]
    delay = 5
    while time.time() < deadline:
        out = call(getter, {key: args.id})
        low = out.lower()
        if "pending" not in low and "processing" not in low and "in progress" not in low:
            print(out)
            return
        print(f"  … ждём ({int(deadline - time.time())} с осталось)", file=sys.stderr)
        time.sleep(delay)
        delay = min(delay * 1.4, 30)
    sys.exit(f"таймаут ожидания {args.id}: висит в pending. "
             f"Если >15 мин — удалить и перегенерировать (ASSETS.md).")


def cmd_sheets(args):
    """Собрать спрайт-листы персонажа: спека строится из get_character автоматически.

    Разбирает вывод get_character (idle-ротации + группы анимаций с их uuid по
    направлениям) и зовёт tools/fetch_anim_sheets.py. Вручную это 50+ повторов
    копирования uuid — ровно то, на чём делают опечатки.
    """
    out = call("get_character", {"character_id": args.id})
    if "status: completed" not in out:
        sys.exit(f"персонаж ещё не готов:\n{out.splitlines()[0]}")

    m = re.search(r"rotations/([0-9a-f-]{36})/([0-9a-f-]{36})/rotations/", out)
    acc = cid = None
    m = re.search(r"pixellab-characters/([0-9a-f-]{36})/([0-9a-f-]{36})/", out)
    if m:
        acc, cid = m.group(1), m.group(2)
    if not acc:
        sys.exit("не нашёл account/cid в ответе get_character")

    spec = {"texture_id": args.texture_id, "account": acc, "cid": cid,
            "idle": True, "fit": args.fit, "outdir": args.outdir}

    # Строки вида: "  <имя> — 4 dir (…), Nf … [group: …]" и следом "    <dir>: <url>, …"
    current = None
    for line in out.splitlines():
        head = re.match(r"\s{2}(\S+) — \d+ dir", line)
        if head:
            name = head.group(1).lower()
            current = "walk" if "walk" in name or "run" in name else "attack"
            spec.setdefault(current, {})
            continue
        body = re.match(r"\s{4}(south|east|north|west):\s*(\S+)", line)
        if body and current:
            urls = [u.strip() for u in line.split(":", 1)[1].split(",") if u.strip()]
            uid = re.search(r"animations/([0-9a-f-]{36})/", body.group(2))
            if uid:
                spec[current][body.group(1)] = [uid.group(1), len(urls)]

    for kind in ("walk", "attack"):
        dirs = spec.get(kind)
        if dirs and len(dirs) < 4:
            print(f"пропускаю {kind}: есть только {sorted(dirs)}", file=sys.stderr)
            spec.pop(kind)

    tmp = os.path.join(ROOT, "scratch")
    os.makedirs(tmp, exist_ok=True)
    path = os.path.join(tmp, f"spec_{args.texture_id}.json")
    with open(path, "w") as f:
        json.dump(spec, f, ensure_ascii=False, indent=2)

    have = [k for k in ("walk", "attack") if k in spec]
    print(f"спека: {path} (idle{''.join(' + ' + h for h in have)})")
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from fetch_anim_sheets import build
    build(spec, spec["outdir"])


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("balance")
    sub.add_parser("tools")

    p = sub.add_parser("call")
    p.add_argument("tool")
    p.add_argument("args", nargs="?", default="{}", help="JSON или @файл.json")
    p.add_argument("--timeout", type=int, default=180)

    p = sub.add_parser("get")
    p.add_argument("id")
    p.add_argument("--kind", choices=["character", "object"], default="character")

    p = sub.add_parser("wait")
    p.add_argument("id")
    p.add_argument("--kind", choices=["character", "object"], default="character")
    p.add_argument("--timeout", type=int, default=900)

    p = sub.add_parser("sheets", help="собрать idle/walk/attack листы персонажа")
    p.add_argument("id")
    p.add_argument("texture_id")
    p.add_argument("--fit", type=int, default=48)
    p.add_argument("--outdir", default="static/textures/")

    a = ap.parse_args()

    if a.cmd == "balance":
        print(call("get_balance", {}))
    elif a.cmd == "tools":
        for t in rpc("tools/list").get("tools", []):
            props = t.get("inputSchema", {}).get("properties", {})
            req = set(t.get("inputSchema", {}).get("required", []))
            names = ", ".join(f"{k}*" if k in req else k for k in props)
            print(f"{t['name']}({names})")
    elif a.cmd == "call":
        print(call(a.tool, load_args(a.args), timeout=a.timeout))
    elif a.cmd == "get":
        key = "character_id" if a.kind == "character" else "object_id"
        getter = "get_character" if a.kind == "character" else "get_object"
        print(call(getter, {key: a.id}))
    elif a.cmd == "wait":
        cmd_wait(a)
    elif a.cmd == "sheets":
        cmd_sheets(a)


if __name__ == "__main__":
    main()
