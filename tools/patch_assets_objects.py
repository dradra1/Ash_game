#!/usr/bin/env python3
"""Идемпотентно дописывает в tools/assets.json промпты объектов и иконок.

Секции: weapons (24 семейства без спрайта), projectiles (12), items (64),
stats (17), meta (4). Всё рисуется create_map_object в боковой проекции —
почему не create_ui_asset для иконок, объяснено ниже, над таблицей STATS.

Оружие в конфиге живёт семействами по 4 тира на одну текстуру: тир меняет числа,
а не спрайт, поэтому промпт один на семейство.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "tools", "assets.json")

# Оружие: боковая проекция, генерация 64 → игровой размер 32 (ASSETS.md §3).
# Клиент сам вращает спрайт к цели, поэтому рисуем строго горизонтально, рукоятью влево.
WEAPONS = {
    "w_chainblade":   "a heavy sword whose cutting edge is a running loop of toothed chain links, worn leather grip, rust and machine oil",
    "w_hammer":       "a two-handed maul with a blockish iron head banded in copper coils, faint sparks arcing across the striking face",
    "w_scourge":      "a flail whip: a short wooden handle with THREE separate long leather cords hanging loose from it, each cord knotted with iron barbs and ending in a spiked iron tip, the cords spread apart and clearly separate",
    "w_claws":        "a fist harness of four long curved bone claws, sinew bindings and iron rivets",
    "w_sickle":       "a blade curved like a crescent moon, its concave inner edge lined with saw teeth, joined to a short straight wooden handle at one horn of the crescent. ONE BLADE ONLY. NOT double-headed. NOT a pickaxe. NOT an anchor",
    "w_pike":         "a spear laid diagonally corner to corner across the frame, filling it: a broad polished steel leaf-shaped head with a crossbar beneath, pale wooden shaft wrapped in leather, the bright metal head standing out sharply against the dark",
    "w_stilettos":    "a matched pair of thin needle-point stilettos laid crossed, wire-wound grips",
    "w_spiker":       "a compact spike-driving pistol with a heavy piston head and a pressure hose",
    "w_shotgun":      "a sawn-off double-barrelled shotgun, cut stock, scarred wood and blued steel",
    "w_autocannon":   "a bulky belt-fed autocannon with a thick barrel shroud and a hanging ammunition belt",
    "w_longbarrel":   "a very long-barrelled marksman rifle with a simple tube sight and a folded bipod",
    "w_lance":        "a heavy crossbow loaded with a barbed harpoon, a coiled cable spool under the stock",
    "w_needler":      "a slim needle gun with a translucent magazine full of glass needles",
    "w_grapeshot":    "a squat wide-mouthed scattergun with a flared bell muzzle and a drum magazine",
    "w_plasmacutter": "an industrial cutting torch with a focusing nozzle and a glowing violet-white arc",
    "w_rod":          "a bent iron rod topped with a caged violet crystal, engraved sigil bands",
    "w_venomsprayer": "a pressurized sprayer with a glass tank of green bile and a fan nozzle",
    "w_stormcaster":  "a coil weapon of stacked copper rings with blue arcs crackling between the prongs",
    "w_sporegun":     "a fat organic gun of chitin plates with a wet muzzle and a pulsing spore bladder",
    "w_flamer":       "a flamethrower with a stubby nozzle, a lit pilot flame and a strapped fuel canister",
    "w_icelens":      "a brass frame holding a thick pale blue lens rimed with frost, hand grip below",
    "w_turret":       "a small tripod-mounted automatic turret with a stubby twin barrel and an ammunition box",
    "w_bonemine":     "a spherical mine of bound bone plates and iron bands with a trigger prong on top",
    "w_forgedrone":   "a small hovering drone of dull brass with a single lens, two dangling tool arms and a vent glow",
}

# Снаряды: крошечные, летят горизонтально вправо. Клиент поворачивает по вектору.
PROJECTILES = {
    "p_nail":    "a single bent iron nail in flight, point forward",
    "p_spike":   "a slim steel spike dart, point forward",
    "p_slug":    "a blunt lead slug with a faint smoke trail behind it",
    "p_beam":    "a short horizontal bolt of pale amber light with a bright core",
    "p_harpoon": "a barbed harpoon head trailing a thin taut cable",
    "p_plasma":  "a glowing violet-white plasma blob with a hot white centre",
    "p_warp":    "a jagged violet shard of unstable light with torn edges",
    "p_venom":   "a splattering droplet of thick green bile",
    "p_spark":   "a crackling blue electric arc, forked",
    "p_spore":   "a puffed cluster of pale green spores",
    "p_flame":   "a short tongue of orange flame, tapering",
    "p_ice":     "a pale blue ice shard with frosted facets",
}

# Предметы: иконка в боковой проекции, одиночный PNG, читается на #0d0f14.
ITEMS = {
    "it_rusty_nail":     "a plain straight rusted metal shaft with a small flat disc at the top end and a sharp taper at the bottom end, nothing else attached. NO HANDLE. NO CROSSPIECE. NO BLADE. NO HEAD OTHER THAN THE FLAT DISC. It is a simple fastener",
    "it_lamp_oil":       "a small clay flask of lamp oil with a cloth stopper",
    "it_ash_pouch":      "a drawstring leather pouch spilling grey ash",
    "it_iron_plate":     "a dented rectangular iron armour plate with rivets",
    "it_whetstone":      "a worn grey whetstone block with a leather strap",
    "it_powder_horn":    "a curved powder horn with a brass cap",
    "it_tallow":         "a lump of pale tallow with a short wick",
    "it_scrap_charm":    "a talisman of three irregular flat scrap-metal offcuts bound together with twisted copper wire, hanging from a loop of cord. NOT A FIGURE. NOT A ROBOT",
    "it_worn_boots":     "a pair of cracked leather boots, soles worn through",
    "it_cracked_lens":   "a round glass lens in a brass rim with a crack across it",
    "it_rag_wrap":       "a roll of stained cloth bandage wrapping",
    "it_bone_charm":     "a small carved bone charm on a leather thong",
    "it_gear_bit":       "a broken toothed gear fragment, oiled steel",
    "it_ember_shard":    "a glowing orange ember shard, cracked and hot",
    "it_thin_blade":     "a thin narrow blade with a wire-wound tang",
    "it_wax_seal":       "a red wax seal pressed onto a folded paper strip",
    "it_grave_dust":     "a small stoppered jar of fine grey grave dust",
    "it_lens":           "a polished round glass lens in a clean brass rim",
    "it_censer_coal":    "a smoking black coal held in small brass tongs",
    "it_pilgrim_boots":  "sturdy travelling boots with iron buckles and road dust",
    "it_chain_belt":     "a heavy iron chain belt with a hook clasp",
    "it_tithe_ledger":   "a thick ledger book with a metal clasp and paper tabs",
    "it_spare_barrel":   "a spare gun barrel, blued steel with a threaded end",
    "it_nerve_stim":     "a glass syringe of pale yellow stimulant with a brass plunger",
    "it_scrap_plating":  "a curved sheet of scrap plating lashed on with wire",
    "it_carrion_hook":   "a large rusted meat hook on a short chain",
    "it_warp_sliver":    "a thin violet crystal sliver glowing faintly",
    "it_padded_hood":    "a quilted padded hood of grey cloth",
    "it_oiled_gears":    "two meshed gears slick with dark oil",
    "it_blood_vial":     "a corked glass vial of dark red blood",
    "it_hunters_mark":   "a barbed iron arrowhead tied with red thread",
    "it_ash_filter":     "a round respirator filter cartridge clogged with grey ash",
    "it_split_shot":     "a forked wooden gun stock split into two prongs",
    "it_iron_nails":     "the underside of a leather boot sole with many short iron hobnails driven through it, the outline clearly boot-shaped with heel and toe",
    "it_martyr_nail":    "a long blackened nail wrapped in a scrap of bloodied cloth",
    "it_bloodwick":      "a candle with a dark red wick burning low",
    "it_furnace_heart":  "a fist-sized iron sphere with molten orange light in its seams",
    "it_mirror_shard":   "a triangular shard of cold silvered mirror glass",
    "it_choir_scroll":   "an unrolled paper scroll covered in dense script, wax seal at the end",
    "it_rust_crown":     "a plain circlet of rusted iron with blunt points",
    "it_thorn_mantle":   "a shoulder mantle of dark cloth stitched with iron thorns",
    "it_leech_grub":     "a fat pale grub with a ringed sucking mouth",
    "it_focus_prism":    "a clear angular prism splitting a thin beam of light",
    "it_scrap_engine":   "a small dirty machine motor: a cylindrical engine block with cooling fins, a short exhaust pipe angled upward, oil stains and welded patches",
    "it_famine_bowl":    "a shallow empty clay begging bowl, chipped at the rim",
    "it_storm_coil":     "a copper coil on an iron core with blue arcs at the tips",
    "it_dead_weight":    "a heavy dull grey lead block weight cast with a thick iron ring on top, a short length of chain hooked through the ring",
    "it_pale_mask":      "a featureless pale mask with narrow eye slits",
    "it_ember_lung":     "a bellows-like organ of scorched leather glowing orange inside",
    "it_reliquary":      "a small brass reliquary casket with a hinged lid and a glass window",
    "it_warp_tumor":     "a glistening violet growth of veined flesh",
    "it_iron_lung":      "a riveted iron lung canister with a breathing hose",
    "it_martyrs_crown":  "a crown of twisted barbed wire with dried blood on the barbs",
    "it_gilded_ledger":  "a ledger book bound in gold leaf with an ornate clasp",
    "it_hollow_engine":  "a hollow engine housing with nothing inside but cold green light",
    "it_second_skin":    "a loosely draped sheet of thin translucent pale skin hanging over an edge, soft irregular folds and a ragged torn hem",
    "it_glass_edge":     "a blade knapped from thick green bottle glass, cloth-wrapped grip",
    "it_wailing_core":   "a cracked metal sphere with a screaming mouth shape in its surface",
    "it_ash_heart":      "a heart-shaped lump of compacted grey ash, cracked and smouldering",
    "it_choir_bell":     "a small bronze hand bell with an engraved rim",
    "it_shared_shroud":  "a folded burial shroud of coarse grey linen",
    "it_blood_pact":     "a paper contract signed in blood with a bloody thumbprint",
    "it_lifting_hand":   "an open upturned mechanical hand of dull brass",
    "it_shared_purse":   "a fat leather purse tied with cord, coins showing at the mouth",
}

# Иконки статов: силуэтные пиктограммы, а не сцены.
#
# Инструмент — create_map_object, а не create_ui_asset вопреки ASSETS.md §6.8: тот
# рисует панели, стоит 20–40 генераций за штуку и не отдаёт меньше 192 px. На 21
# иконку это ~630 генераций ради картинок, которые всё равно ужимаются до 32 px.
# map_object даёт прозрачный фон, холст от 32 px и одну генерацию.
STATS = {
    "st_hp":     "a simple heart icon, dark red, thick outline",
    "st_regen":  "a heart icon with a small upward arrow beside it",
    "st_leech":  "a heart icon with a drop of blood falling from it",
    "st_dmg":    "a crossed sword and axe icon",
    "st_melee":  "a single cleaver blade icon",
    "st_ranged": "a simple side-view gun icon",
    "st_elem":   "a flame and lightning bolt combined icon",
    "st_aspd":   "a sword with three speed lines behind it",
    "st_crit":   "a starburst impact icon with a sharp centre",
    "st_engi":   "a gear with a small wrench across it",
    "st_range":  "a target ring with a horizontal arrow through it",
    "st_armor":  "a plain riveted shield icon",
    "st_dodge":  "a running boot with a curved dashed motion line",
    "st_speed":  "a winged boot icon",
    "st_luck":   "a four-leaf clover icon with a coin behind it",
    "st_tithe":  "a stack of coins with a small seal on top",
    "st_kb":     "a fist striking an object away with impact lines",
}

# Мета-улучшения: те же правила, но крупнее по смыслу — это карточки реликвария.
META = {
    "mu_ash":    "a heaped pile of grey ash with a faint ember glow",
    "mu_hp":     "a heart icon inside a riveted iron frame",
    "mu_luck":   "a pair of worn bone dice showing high pips",
    "mu_reroll": "two curved arrows chasing each other in a circle",
}


# Проекция по умолчанию боковая, но паре предметов она вредит: в профиль «стержень
# с навершием» модель неизбежно достраивает до инструмента — гвоздь выходит палицей,
# серп киркой. Сверху у них нет силуэта инструмента, и шаблон не срабатывает.
VIEW_OVERRIDE = {
    "it_rusty_nail": "high top-down",
    "w_sickle": "high top-down",
}


def main():
    with open(PATH, encoding="utf-8") as f:
        data = json.load(f)

    blocks = {
        "weapons":     (WEAPONS, {"tool": "create_map_object", "gen": 64, "fit": 32,
                                  "view": "side"}),
        "projectiles": (PROJECTILES, {"tool": "create_map_object", "gen": 32, "fit": 16,
                                      "view": "side"}),
        "items":       (ITEMS, {"tool": "create_map_object", "gen": 64, "fit": 32,
                                "view": "side"}),
        "stats":       (STATS, {"tool": "create_map_object", "gen": 64, "fit": 32,
                                "view": "side"}),
        "meta":        (META, {"tool": "create_map_object", "gen": 64, "fit": 32,
                               "view": "side"}),
    }

    added = 0
    for section, (prompts, meta) in blocks.items():
        target = data.setdefault(section, {})
        for key, prompt in prompts.items():
            entry = dict(meta, prompt=prompt)
            if key in VIEW_OVERRIDE:
                entry["view"] = VIEW_OVERRIDE[key]
            if target.get(key) == entry:
                continue
            target[key] = entry
            added += 1

    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"assets.json: добавлено/обновлено {added}; " + ", ".join(
        f"{s} {len(data[s])}" for s in blocks))


if __name__ == "__main__":
    main()
