"""Ловчий Дом: доступность персонажей и заказов, прогресс, сдача.

Разделение с meta.py то же, что между ачивкой и заказом. Ачивка пересчитывается
по всей истории агрегатным SQL и выдаётся задним числом. Заказ игрок берёт
руками у персонажа, и с этого момента прогресс копится ВПЕРЁД, по одному забегу
за раз. Поэтому здесь нет пересчёта по таблице runs: есть строка `quests` с
накопленным числом, которую двигает завершение забега.

Награду (реликвии) начисляет сервер по числу из конфига — правило CLAUDE.md §3.8.
Число от клиента не принимается ни в каком виде.

Схема цели заказа описана в tools/content_lodge.py — там же и сами заказы.

ОГРАНИЧЕНИЕ КООПА (существующее, не внесено этим модулем): в кооп-забеге
`/api/run/finish` шлёт только хост, поэтому прогресс заказов идёт только ему —
ровно как сейчас с реликвиями и ачивками. Правится вместе с ними, не отдельно.
"""
import json

import db


def _lodge(config):
    return config.get("lodge") or {}


def quests(config):
    return _lodge(config).get("quests") or {}


def npcs(config):
    return _lodge(config).get("npcs") or []


def lore(config):
    return _lodge(config).get("lore") or {}


def _claimed(user_quests, quest_id):
    return (user_quests.get(quest_id) or {}).get("state") == "claimed"


def npc_open(config, user_quests, npc):
    """Персонаж появляется в зале, когда сдан заказ из его `requires`."""
    req = npc.get("requires")
    return not req or _claimed(user_quests, req)


def quest_available(config, user_quests, quest_id):
    """Заказ можно ВЗЯТЬ: он ещё не брался, персонаж открыт, предыдущий сдан."""
    q = quests(config).get(quest_id)
    if not q or quest_id in user_quests:
        return False
    for npc in npcs(config):
        if npc["id"] == q["npc"]:
            if not npc_open(config, user_quests, npc):
                return False
            break
    else:
        return False
    req = q.get("requires")
    return not req or _claimed(user_quests, req)


# --- вычисление прогресса --------------------------------------------------

def _run_curses(run_row):
    raw = run_row["curses"] if "curses" in run_row.keys() else None
    if not raw:
        return []
    try:
        ids = json.loads(raw) if isinstance(raw, str) else list(raw)
        return [str(c) for c in ids]
    except (TypeError, ValueError):
        return []


def filter_ok(run_row, summary, flt):
    """Проходит ли забег фильтр цели. Пустой фильтр пропускает всё.

    Всё, кроме damage_taken_max, читается из строки `runs`: персонаж, арена,
    сложность, проклятия и число игроков уже записаны туда на старте забега и
    клиентом при завершении не пересылаются — подделать их из браузера нельзя.
    """
    if not flt:
        return True
    if flt.get("win") and not summary.get("win"):
        return False
    if "danger_min" in flt and (run_row["danger"] or 0) < flt["danger_min"]:
        return False
    if "arena" in flt and run_row["arena"] != flt["arena"]:
        return False
    if "character" in flt and run_row["character"] != flt["character"]:
        return False
    if "players_min" in flt and (run_row["players"] or 1) < flt["players_min"]:
        return False
    if "damage_taken_max" in flt and summary.get("damage_taken", 0) > flt["damage_taken_max"]:
        return False
    if "curse" in flt or "curse_min" in flt:
        active = _run_curses(run_row)
        if "curse" in flt and flt["curse"] not in active:
            return False
        if "curse_min" in flt and len(active) < flt["curse_min"]:
            return False
    return True


def metric_value(goal, summary):
    """Вклад одного забега в метрику цели."""
    metric = goal.get("metric")
    if metric == "runs":
        return 1
    if metric == "wave":
        return summary.get("wave", 0)
    if metric == "kills":
        return summary.get("kills", 0)
    if metric == "ash":
        return summary.get("ash_gained", 0)
    if metric == "bosses":
        return summary.get("bosses", 0)
    if metric == "shop_buys":
        return summary.get("shop_buys", 0)
    if metric == "kills_type":
        return int((summary.get("kills_by_type") or {}).get(goal.get("target"), 0))
    return 0


def run_delta(goal, run_row, summary):
    """Сколько единиц прогресса даёт этот забег.

    scope run — цель либо взята целиком (2000 праха за спуск), либо не взята
    вовсе: накапливать по кускам тут нечего. scope total — обычное сложение.
    """
    if not filter_ok(run_row, summary, goal.get("filter")):
        return 0
    value = metric_value(goal, summary)
    if goal.get("scope") == "run":
        return goal["value"] if value >= goal["value"] else 0
    return value


def apply_run(config, conn, user_id, run_row, summary):
    """Продвинуть активные заказы игрока по итогам забега.

    Возвращает id заказов, которые именно этим забегом стали выполненными —
    экран итогов показывает их рядом с ачивками.
    """
    if run_row is None or run_row["flagged"]:
        # Подозрительный забег не идёт ни в лидерборд, ни в агрегаты ачивок —
        # и в заказы тоже не идёт.
        return []

    rows = conn.execute(
        "SELECT quest_id, progress FROM quests WHERE user_id = ? AND state = 'active'",
        (user_id,),
    ).fetchall()
    table = quests(config)

    fresh = []
    for row in rows:
        q = table.get(row["quest_id"])
        if not q:
            continue          # заказ выпилен из конфига — строка ждёт своего часа
        goal = q["goal"]
        delta = run_delta(goal, run_row, summary)
        if not delta:
            continue
        progress = min(goal["value"], row["progress"] + delta)
        done = progress >= goal["value"]
        db.set_quest_progress(conn, user_id, row["quest_id"], progress, done)
        if done:
            fresh.append(row["quest_id"])
    return fresh


# --- сдача -----------------------------------------------------------------

def claim(config, user_id, quest_id):
    """Сдать выполненный заказ. -> (relics, lore_id, error).

    Списание состояния атомарно (`WHERE state='done'` внутри UPDATE), поэтому
    два одновременных запроса не выдадут награду дважды.
    """
    q = quests(config).get(quest_id)
    if not q:
        return 0, None, "unknown_quest"
    state = (db.get_user_quests(user_id).get(quest_id) or {}).get("state")
    if state is None:
        return 0, None, "quest_not_available"
    if state == "claimed":
        return 0, None, "quest_claimed"
    if state != "done":
        return 0, None, "quest_not_done"
    if not db.claim_quest(user_id, quest_id):
        return 0, None, "quest_claimed"

    relics = int(q.get("reward") or 0)
    if relics:
        db.add_relics(user_id, relics)
    lore_id = q.get("lore")
    if lore_id:
        db.add_lore(user_id, lore_id)
    return relics, lore_id, None


def intro_lore(config, user_id, npc_id):
    """Открыть вступительный фрагмент персонажа. -> lore_id | None."""
    for npc in npcs(config):
        if npc["id"] == npc_id:
            lid = npc.get("intro")
            if lid and db.add_lore(user_id, lid):
                return lid
            return lid if lid else None
    return None


# --- санитизация убийств по типам ------------------------------------------

def sanitize_kills_by_type(config, raw, kills_cap):
    """Привести словарь убийств к доверенному виду. -> (dict, reason | None).

    Неизвестные ключи и мусорные значения выбрасываются молча: их появление
    объясняется расхождением версий конфига, а не жульничеством. А вот сумма
    больше уже проверенного потолка убийств — повод пометить забег.
    """
    if not isinstance(raw, dict):
        return {}, None
    known = set(config.get("enemies") or {}) | set(config.get("bosses") or {})
    out = {}
    total = 0
    for key, val in raw.items():
        if key not in known:
            continue
        try:
            n = int(val)
        except (TypeError, ValueError):
            continue
        if n <= 0:
            continue
        out[key] = n
        total += n
    reason = "kills_by_type_mismatch" if total > kills_cap else None
    return out, reason
