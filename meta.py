"""Метапрогрессия: реликвии, открытия, ачивки, валидация забегов, лидерборды.

Ключевое правило ТЗ §3.10: **реликвии начисляет сервер по своей формуле**, а не
по числу от клиента. Клиент присылает итог забега, сервер сам решает, сколько
это стоит и не врёт ли клиент. Всё, что не сходится, помечается флагом и не
попадает в лидерборд.
"""
import db


# --- Начисление -----------------------------------------------------------

def relic_formula(config, wave, win, bosses, players):
    """relics = (per_wave*волна + win*победа + per_boss*боссы) * reward_mult * coop_mult"""
    meta = config["meta"]["relic_formula"]
    danger_list = config["danger"]
    return meta, danger_list


def award_relics(config, run_row, wave, win, bosses, players):
    f = config["meta"]["relic_formula"]
    danger = run_row["danger"] if run_row["danger"] is not None else 0
    danger = max(0, min(danger, len(config["danger"]) - 1))
    reward_mult = config["danger"][danger]["reward_mult"]
    coop_mult = 1 + f["coop_per_player"] * max(0, players - 1)
    base = f["per_wave"] * wave + f["win"] * (1 if win else 0) + f["per_boss"] * bosses
    return int(round(base * reward_mult * coop_mult))


def first_clear_bonus(config, conn, user_id, run_row, win):
    """Разовый бонус за первое прохождение персонажа / арены / сложности."""
    if not win:
        return 0
    bonus = config["meta"].get("first_clear_bonus", 0)
    if bonus <= 0:
        return 0
    total = 0
    for column, value in (("character", run_row["character"]),
                          ("arena", run_row["arena"]),
                          ("danger", run_row["danger"])):
        if value is None:
            continue
        row = conn.execute(
            f"SELECT COUNT(*) AS n FROM runs WHERE user_id = ? AND win = 1 "
            f"AND flagged = 0 AND {column} = ? AND id != ?",
            (user_id, value, run_row["id"]),
        ).fetchone()
        if row["n"] == 0:
            total += bonus
    return total


# --- Плаузибилити-проверки ------------------------------------------------
# Ресимуляции нет и быть не может: мир считает браузер. Поэтому проверяем не
# «так ли всё было», а «могло ли так быть в принципе» (ТЗ §2).

def min_run_time(config, wave):
    """Сумма длительностей пройденных волн — быстрее физически не бывает."""
    r = config["run"]
    total = 0.0
    for w in range(1, max(1, wave) + 1):
        boss = r["boss_waves"].get(str(w))
        if boss and boss.get("len"):
            length = boss["len"]
        else:
            length = min(r["wave_len_cap"], r["wave_len_base"] + r["wave_len_step"] * (w - 1))
            if boss and boss.get("len_bonus"):
                length += boss["len_bonus"]
        total += length + r["wave_intro_sec"] + r["wave_end_collect_sec"]
    return total


def max_plausible_kills(config, wave, players):
    """Потолок убийств: бюджет спавна на каждой волне при максимальной плотности."""
    w = config["waves"]
    density = max(d["density"] for d in config["danger"])
    per_player = 1 + config["coop"]["budget_per_player"] * max(0, players - 1)
    total = 0.0
    for n in range(1, max(1, wave) + 1):
        r = config["run"]
        boss = r["boss_waves"].get(str(n))
        if boss and boss.get("len"):
            length = boss["len"]
        else:
            length = min(r["wave_len_cap"], r["wave_len_base"] + r["wave_len_step"] * (n - 1))
            if boss and boss.get("len_bonus"):
                length += boss["len_bonus"]
        total += (w["budget_base"] + w["budget_per_wave"] * n) * density * per_player * length
    return int(total * KILL_SLACK)


def max_plausible_score(config, kills):
    """Потолок очков: самый дорогой враг, помноженный на потолок убийств."""
    best = 0
    for src in (config["enemies"], config["bosses"]):
        for e in src.values():
            best = max(best, e.get("score", 0))
    return int(kills * best * SCORE_SLACK) + 1000


def check_run(config, run_row, wave, win, bosses, time_sec, kills, score, players):
    """Возвращает список причин, по которым забег выглядит невозможным."""
    reasons = []
    waves_total = config["run"]["waves"]

    if wave < 0 or wave > waves_total:
        reasons.append("wave_out_of_range")
    if win and wave < waves_total:
        reasons.append("win_before_last_wave")
    if bosses < 0 or bosses > MAX_BOSSES_PER_RUN:
        reasons.append("boss_count")

    need = min_run_time(config, min(wave, waves_total))
    if time_sec + TIME_SLACK < need:
        reasons.append("too_fast")

    cap_kills = max_plausible_kills(config, min(wave, waves_total), players)
    if kills > cap_kills:
        reasons.append("too_many_kills")

    cap_score = max_plausible_score(config, cap_kills)
    if score > cap_score:
        reasons.append("score_too_high")

    started = run_row["started_at"]
    if started:
        import time as _t
        wall = _t.time() - started
        # Игровое время не может обгонять реальное: клиент не умеет ускорять мир
        if time_sec > wall + WALL_SLACK:
            reasons.append("faster_than_wall_clock")

    return reasons


# --- Ачивки ---------------------------------------------------------------

def check_achievements(config, conn, user_id):
    """Пересчитать ачивки по таблице runs. Возвращает список только что выданных."""
    earned = set(r["ach_id"] for r in conn.execute(
        "SELECT ach_id FROM achievements WHERE user_id = ?", (user_id,)).fetchall())

    stats = conn.execute(
        "SELECT COALESCE(MAX(wave), 0) AS best_wave, "
        "COALESCE(SUM(win), 0) AS wins, "
        "COALESCE(SUM(bosses), 0) AS bosses, "
        "COALESCE(SUM(kills), 0) AS kills, "
        "COALESCE(MAX(CASE WHEN win = 1 THEN danger END), -1) AS best_danger, "
        "COALESCE(MAX(CASE WHEN win = 1 THEN players END), 0) AS best_coop "
        "FROM runs WHERE user_id = ? AND flagged = 0", (user_id,)).fetchone()

    fresh = []
    for aid, ach in config.get("achievements", {}).items():
        if aid in earned:
            continue
        cond = ach["cond"]
        kind, value = cond["type"], cond["value"]
        ok = (
            (kind == "reach_wave" and stats["best_wave"] >= value)
            or (kind == "wins" and stats["wins"] >= value)
            or (kind == "win_danger" and stats["best_danger"] >= value)
            or (kind == "win_coop" and stats["best_coop"] >= value)
            or (kind == "bosses" and stats["bosses"] >= value)
            or (kind == "kills" and stats["kills"] >= value)
        )
        if ok:
            fresh.append(aid)
    return fresh


# --- Открытия -------------------------------------------------------------

def unlock_price(config, kind, item_id, has_achievement):
    """Цена открытия и требуемая ачивка. None — открывать нечего."""
    if kind == "faction":
        entry = config["factions"].get(item_id)
    elif kind == "character":
        entry = config["characters"].get(item_id)
    elif kind == "arena":
        entry = config["arenas"].get(item_id)
    elif kind == "weapon":
        entry = config["weapons"].get(item_id)
    else:
        return None, None
    if entry is None:
        return None, None

    unlock = entry.get("unlock") or {}
    if unlock.get("type") == "default":
        return None, None

    if kind == "weapon":
        tier = str(unlock.get("tier", 1))
        cost = config["meta"]["weapon_unlock_price"].get(tier)
        if cost is None:
            return None, None
    else:
        cost = unlock.get("cost")
        if cost is None:
            return None, None

    need_ach = unlock.get("achievement")
    if need_ach and has_achievement(need_ach):
        cost = int(round(cost * config["meta"]["achievement_discount"]))
    return int(cost), need_ach


def requirements_met(config, kind, item_id, unlocks):
    """Персонаж требует открытой фракции — иначе покупка бессмысленна."""
    if kind != "character":
        return True
    ch = config["characters"].get(item_id)
    if not ch:
        return False
    faction = ch["faction"]
    fac = config["factions"].get(faction) or {}
    if (fac.get("unlock") or {}).get("type") == "default":
        return True
    return faction in unlocks.get("faction", [])


def upgrade_price(config, upgrade_id, rank):
    for up in config["meta"].get("upgrades", []):
        if up["id"] != upgrade_id:
            continue
        if rank >= up["max_ranks"]:
            return None, up
        prices = up["price"]
        return int(prices[min(rank, len(prices) - 1)]), up
    return None, None


# Запасы на округление и на то, что клиент считает время своим таймером
TIME_SLACK = 5.0
WALL_SLACK = 30.0
KILL_SLACK = 1.5
SCORE_SLACK = 1.2
MAX_BOSSES_PER_RUN = 4
