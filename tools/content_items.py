"""Предметы: 60+ штук, тиры I–IV.

Правила ТЗ §3.7, проверяются скриптом на входе:
  * тиры III–IV ОБЯЗАНЫ иметь минус — иначе поздняя лавка перестаёт быть выбором;
  * предметы НЕ запираются метапрогрессией, иначе стартовая лавка пустая;
  * кооп-предметы (`coop`) выпадают только в комнате больше одного игрока.

Категории эффектов: плоские и процентные статы, триггеры, экономика.
"""

# Триггеры: wave_end, on_crit, on_hit, on_kill, every, low_hp, aura
def trig(trigger, type_, **kw):
    out = {"trigger": trigger, "type": type_}
    out.update(kw)
    return out


# id: (имя, описание, тир, цена, теги, статы, эффект, только-кооп)
ITEMS = {
    # --- Тир I: дешёвая база, без минусов --------------------------------
    "it_rusty_nail": ("Ржавый гвоздь", "Мелочь, а колет.", 1, 10, ["primitive"],
                      {"melee_dmg": 2, "ranged_dmg": 1}, None),
    "it_lamp_oil": ("Лампадное масло", "Горит ровно и долго.", 1, 12, ["holy"],
                    {"attack_speed_pct": 5, "max_hp": -1}, None),
    "it_ash_pouch": ("Кисет с прахом", "Всё, что осталось от предшественника.", 1, 11, [],
                     {"tithe": 1}, None),
    "it_iron_plate": ("Латная пластина", "Тяжёлая, зато честная.", 1, 14, ["heavy"],
                      {"armor": 2, "move_speed_pct": -4}, None),
    "it_whetstone": ("Точильный камень", "Скрип по железу успокаивает.", 1, 12, ["blade"],
                     {"melee_dmg": 3}, None),
    "it_powder_horn": ("Пороховница", "Сухая. Пока что.", 1, 12, ["gun"],
                       {"ranged_dmg": 3}, None),
    "it_tallow": ("Свечное сало", "Мажут раны и петли.", 1, 10, ["holy"],
                  {"hp_regen": 1}, None),
    "it_scrap_charm": ("Оберег из хлама", "Работает, если верить.", 1, 11, ["primitive"],
                       {"luck": 3}, None),
    "it_worn_boots": ("Стоптанные башмаки", "Помнят больше дорог, чем ты.", 1, 11, [],
                      {"move_speed_pct": 5}, None),
    "it_cracked_lens": ("Треснувшая линза", "Двоится, зато далеко.", 1, 13, ["precise"],
                        {"range": 1, "crit_pct": 2}, None),
    "it_rag_wrap": ("Тряпичная намотка", "Не броня, но лучше, чем ничего.", 1, 10, [],
                    {"max_hp": 4}, None),
    "it_bone_charm": ("Костяной амулет", "Чей-то. Уже неважно.", 1, 12, ["primitive"],
                      {"crit_pct": 3}, None),
    "it_gear_bit": ("Обломок шестерни", "Зубьев не хватает, а крутится.", 1, 13, ["construct"],
                    {"engineering": 2}, None),
    "it_ember_shard": ("Уголёк", "Всё ещё тёплый.", 1, 12, ["warp"],
                       {"elem_dmg": 3}, None),
    "it_thin_blade": ("Тонкое лезвие", "Ломается, но успевает.", 1, 12, ["blade"],
                      {"attack_speed_pct": 4, "melee_dmg": 1}, None),

    # --- Тир II: первые компромиссы и триггеры ---------------------------
    "it_wax_seal": ("Восковая печать", "Каждая волна оставляет новый оттиск.", 2, 30, ["holy"],
                    {"armor": 1, "move_speed_pct": -3},
                    trig("wave_end", "add_stat", stat="damage_pct", value=2)),
    "it_grave_dust": ("Могильная пыль", "Липнет к ранам и к совести.", 2, 28, [],
                      {"lifesteal_pct": 3, "max_hp": -2}, None),
    "it_lens": ("Шлифованная линза", "Видит дальше, чем следовало бы.", 2, 26, ["precise"],
                {"range": 2, "crit_pct": 3}, None),
    "it_censer_coal": ("Кадильный уголь", "Тлеет даже под дождём.", 2, 24, ["holy"],
                       {"elem_dmg": 3, "attack_speed_pct": 4}, None),
    "it_pilgrim_boots": ("Сапоги пилигрима", "Стоптаны о семь дорог.", 2, 22, [],
                         {"move_speed_pct": 8, "armor": -1}, None),
    "it_chain_belt": ("Цепной пояс", "Звенит на каждом шаге.", 2, 27, ["blunt"],
                      {"knockback": 4, "melee_dmg": 4}, None),
    "it_tithe_ledger": ("Книга десятины", "Аккуратный почерк, страшные цифры.", 2, 29, [],
                        {"tithe": 2},
                        trig("wave_end", "give_ash", value=6)),
    "it_spare_barrel": ("Запасной ствол", "Меняют, пока не остыл.", 2, 26, ["gun"],
                        {"ranged_dmg": 5, "move_speed_pct": -2}, None),
    "it_nerve_stim": ("Нервный стимулятор", "Руки быстрее головы.", 2, 31, [],
                      {"attack_speed_pct": 9, "max_hp": -3}, None),
    "it_scrap_plating": ("Обшивка из хлама", "Гремит, но держит.", 2, 28, ["heavy", "construct"],
                         {"armor": 3, "attack_speed_pct": -4}, None),
    "it_carrion_hook": ("Крюк падальщика", "Тянет к себе всё, что упало.", 2, 25, [],
                        {"tithe": 1, "luck": 4}, None),
    "it_warp_sliver": ("Осколок разлома", "Холодный на ощупь и на слух.", 2, 30, ["warp"],
                       {"elem_dmg": 5, "hp_regen": -1}, None),
    "it_padded_hood": ("Подбитый капюшон", "Гасит и удары, и голоса.", 2, 27, [],
                       {"max_hp": 8, "dodge_pct": 2}, None),
    "it_oiled_gears": ("Промасленные шестерни", "Не скрипят — уже победа.", 2, 29, ["construct"],
                       {"engineering": 3, "attack_speed_pct": 3}, None),
    "it_blood_vial": ("Пузырёк крови", "Не спрашивай чьей.", 2, 32, [],
                      {"lifesteal_pct": 4},
                      trig("on_kill", "heal", value=0.2)),
    "it_hunters_mark": ("Метка охотника", "Ставится один раз.", 2, 26, ["precise"],
                        {"crit_pct": 6, "max_hp": -2}, None),
    "it_ash_filter": ("Пепельный фильтр", "Дышать всё ещё нечем, но реже.", 2, 24, [],
                      {"hp_regen": 2, "move_speed_pct": -2}, None),
    "it_split_shot": ("Разводной приклад", "Бьёт шире, целит хуже.", 2, 30, ["spread"],
                      {"ranged_dmg": 3, "range": -1, "attack_speed_pct": 6}, None),
    "it_iron_nails": ("Гвозди в подошве", "Идёшь громко, зато твёрдо.", 2, 25, ["primitive"],
                      {"melee_dmg": 5, "move_speed_pct": -3}, None),

    # --- Тир III: сильные, с обязательным минусом ------------------------
    "it_martyr_nail": ("Гвоздь мученика", "Боль — тоже форма молитвы.", 3, 55, ["holy"],
                       {"damage_pct": 12, "max_hp_pct": -10}, None),
    "it_bloodwick": ("Кровавый фитиль", "Питается тем, что проливает.", 3, 58, [],
                     {"lifesteal_pct": 6, "armor": -2},
                     trig("on_crit", "heal", value=1)),
    "it_furnace_heart": ("Сердце горнила", "Стучит вместо твоего.", 3, 62, ["heavy"],
                         {"max_hp": 12, "engineering": 3, "move_speed_pct": -8}, None),
    "it_mirror_shard": ("Зеркальный осколок", "Показывает удар до удара.", 3, 60, ["precise"],
                        {"dodge_pct": 8, "crit_pct": 5, "max_hp": -4}, None),
    "it_choir_scroll": ("Свиток хора", "Поют даже когда закрыт.", 3, 57, ["holy"],
                        {"damage_pct": 8, "attack_speed_pct": -5},
                        trig("wave_end", "add_stat", stat="max_hp", value=2)),
    "it_rust_crown": ("Ржавый венец", "Тяжелее, чем выглядит.", 3, 59, ["heavy"],
                      {"armor": 4, "max_hp": 10, "move_speed_pct": -9}, None),
    "it_thorn_mantle": ("Терновая мантия", "Колет и своего.", 3, 61, [],
                        {"melee_dmg": 8, "hp_regen": -2},
                        trig("on_hit", "thorns", value=3)),
    "it_leech_grub": ("Личинка-пиявка", "Шевелится под кожей.", 3, 63, ["warp"],
                      {"lifesteal_pct": 8, "max_hp_pct": -8}, None),
    "it_focus_prism": ("Фокусирующая призма", "Свет собирается в точку.", 3, 58, ["precise"],
                       {"range": 4, "crit_pct": 7, "attack_speed_pct": -6}, None),
    "it_scrap_engine": ("Хламовый движок", "Работает вопреки чертежу.", 3, 64, ["construct"],
                        {"engineering": 6, "elem_dmg": 4, "armor": -2}, None),
    "it_famine_bowl": ("Чаша голода", "Пустеет быстрее, чем наполняется.", 3, 56, [],
                       {"tithe": 4, "luck": 6, "max_hp": -6}, None),
    "it_storm_coil": ("Грозовая катушка", "Волосы дыбом на три шага вокруг.", 3, 62, ["warp"],
                      {"elem_dmg": 9, "hp_regen": -1, "move_speed_pct": -3}, None),
    "it_dead_weight": ("Мёртвый груз", "Держит на земле, когда несёт.", 3, 55, ["heavy"],
                       {"knockback": 8, "melee_dmg": 6, "dodge_pct": -4}, None),
    "it_pale_mask": ("Бледная маска", "Своё лицо начинаешь забывать.", 3, 60, ["precise"],
                     {"dodge_pct": 10, "damage_pct": 5, "max_hp": -8}, None),
    "it_ember_lung": ("Угольное лёгкое", "Каждый вдох — с искрой.", 3, 59, ["warp"],
                      {"elem_dmg": 7, "attack_speed_pct": 5, "armor": -3}, None),

    # --- Тир IV: определяют билд, минус ощутимый -------------------------
    "it_reliquary": ("Малый реликварий", "Внутри — чей-то палец. Помогает.", 4, 110, ["holy"],
                     {"damage_pct": 20, "armor": 3, "move_speed_pct": -10},
                     trig("wave_end", "heal", value=4)),
    "it_warp_tumor": ("Опухоль разлома", "Растёт. Ты стараешься не думать.", 4, 115, ["warp"],
                      {"elem_dmg": 10, "luck": 5, "max_hp_pct": -15}, None),
    "it_iron_lung": ("Железное лёгкое", "Дышит за тебя, решает за тебя.", 4, 120, ["heavy"],
                     {"max_hp": 25, "hp_regen": 2, "attack_speed_pct": -12}, None),
    "it_martyrs_crown": ("Венец мученика", "Носят недолго и не снимают.", 4, 125, ["holy"],
                         {"damage_pct": 25, "crit_pct": 8, "max_hp_pct": -20}, None),
    "it_gilded_ledger": ("Золочёная книга", "Считает даже то, чего нет.", 4, 118, [],
                         {"tithe": 8, "luck": 10, "damage_pct": -8},
                         trig("wave_end", "give_ash_pct", value=5)),
    "it_hollow_engine": ("Полый двигатель", "Гудит там, где должно быть сердце.", 4, 122, ["construct"],
                         {"engineering": 10, "attack_speed_pct": 10, "max_hp_pct": -12}, None),
    "it_second_skin": ("Вторая кожа", "Первая уже не годилась.", 4, 116, [],
                       {"armor": 6, "dodge_pct": 8, "damage_pct": -10}, None),
    "it_glass_edge": ("Стеклянное лезвие", "Разрежет что угодно. Один раз.", 4, 124, ["blade", "precise"],
                      {"crit_pct": 20, "melee_dmg": 12, "max_hp_pct": -25}, None),
    "it_wailing_core": ("Воющее ядро", "Слышно за две арены.", 4, 121, ["warp"],
                        {"elem_dmg": 14, "range": 3, "hp_regen": -3}, None),
    "it_ash_heart": ("Пепельное сердце", "Бьётся тихо и ровно.", 4, 119, [],
                     {"lifesteal_pct": 10, "max_hp": 15, "attack_speed_pct": -10}, None),

    # --- Кооп-предметы: выпадают только в комнате >1 ----------------------
    "it_choir_bell": ("Хоровой колокол", "Слышен всем, кто ещё стоит.", 2, 30, ["holy"],
                      {"damage_pct": 4},
                      trig("aura", "ally_stat", stat="damage_pct", value=5, radius=300), True),
    "it_shared_shroud": ("Общий саван", "Хватит на двоих. На троих — впритык.", 3, 58, [],
                         {"armor": 2, "move_speed_pct": -3},
                         trig("aura", "ally_stat", stat="armor", value=1, radius=260), True),
    "it_blood_pact": ("Кровный уговор", "Больно обоим, зато поровну.", 3, 60, [],
                      {"lifesteal_pct": 5, "max_hp": -6},
                      trig("aura", "ally_stat", stat="lifesteal_pct", value=3, radius=240), True),
    "it_lifting_hand": ("Поднимающая рука", "Тянет вверх, пока сама стоит.", 2, 28, ["holy"],
                        {"hp_regen": 1},
                        trig("ally_revive", "heal", value=6), True),
    "it_shared_purse": ("Общий кошель", "Дно у него одно на всех.", 4, 117, [],
                        {"tithe": 5, "damage_pct": -5},
                        trig("wave_end", "give_pot", value=12), True),
}


def build():
    out = {}
    for iid, row in ITEMS.items():
        name, desc, tier, price, tags, stats, effect = row[:7]
        coop_only = row[7] if len(row) > 7 else False
        out[iid] = {
            "name": name, "desc": desc, "texture": iid,
            "tier": tier, "price": price, "tags": list(tags),
            "stats": dict(stats), "effect": effect, "coop_only": coop_only,
        }
    return out


def validate(items):
    """Тиры III–IV обязаны иметь минус (ТЗ §3.7)."""
    bad = [i for i, it in items.items()
           if it["tier"] >= 3 and not any(v < 0 for v in it["stats"].values())]
    if bad:
        raise SystemExit("предметы тира III–IV без минуса: " + ", ".join(bad))
    locked = [i for i, it in items.items() if it.get("unlock")]
    if locked:
        raise SystemExit("предметы не запираются метапрогрессией: " + ", ".join(locked))
    return True


def counts():
    by_tier = {}
    coop = 0
    for row in ITEMS.values():
        by_tier[row[2]] = by_tier.get(row[2], 0) + 1
        if len(row) > 7 and row[7]:
            coop += 1
    return len(ITEMS), by_tier, coop
