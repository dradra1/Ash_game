#!/usr/bin/env python3
"""Идемпотентно дописывает в tools/assets.json промпты 15 врагов, 6 элит и 6 боссов.

Реестр промптов, а не игровой конфиг: сюда кладётся только то, что нужно генератору
(силуэт, материалы, акцент). Числа баланса живут в game_config.json и здесь не дублируются.

accent каждого юнита равен его `color` из конфига — плейсхолдер-прямоугольник, который
рисует клиент до загрузки PNG, обязан совпадать со спрайтом по цвету.

Правила промпта — ASSETS.md §1–§3, запрещённые слова — CLAUDE.md §1 (фильтр в pxl.py).
Поле silhouette — для человека при приёмке контактного листа, в модель не уходит.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "tools", "assets.json")

# size — что просим у pixellab, fit — до чего ужимаем лист (= `sprite` из game_config).
# ASSETS.md §3: генерируем крупнее игрового размера и ужимаем.
ENEMIES = {
    # --- Улей: ковенант и скверна ---
    "e_hiverat": {
        "accent": "#7a6a5a", "size": 64, "fit": 48,
        "body_type": "quadruped", "template": "cat",
        "silhouette": "низкий четвероногий, длинный голый хвост — единственный зверь Улья",
        "prompt": "mangy oversized hive rat, matted grey-brown fur in clumps, bald scabbed "
                  "tail, chipped yellow incisors, one ear torn away, patches of raw pink "
                  "skin, accent color #7a6a5a",
        "attack": "biting forward, low to the ground",
    },
    "e_zealot": {
        "accent": "#c8703a", "size": 64, "fit": 48,
        "silhouette": "перекошенный вперёд, одна рука вдвое толще другой",
        "prompt": "possessed penitent charging headlong, one arm swollen into a knot of "
                  "extra fingers, a second eye opened on the cheek, rags of a burnt orange "
                  "robe, hooks and chains sunk into the shoulders, accent color #c8703a",
        "attack": "swinging the swollen arm in a wide hook",
    },
    "e_bomber": {
        "accent": "#a8442a", "size": 64, "fit": 48,
        "silhouette": "сгорблен под связкой труб на спине, руки связаны за спиной",
        "prompt": "gaunt suicide runner hunched under a strapped bundle of rusty pipe "
                  "charges, head wrapped in stained red cloth, bare wire fuses trailing "
                  "behind, arms bound behind the back, accent color #a8442a",
        "attack": "lunging forward, charges sparking",
    },
    "e_censerbearer": {
        "accent": "#c8a35a", "size": 64, "fit": 48,
        "silhouette": "прямой, с длинной цепью и дымящим шаром на отлёте",
        "prompt": "robed lay-brother swinging a heavy brass incense burner on a long chain, "
                  "deep cowl over a blank face, wax-sealed paper strips pinned to the robe, "
                  "thick smoke pouring from the burner, accent color #c8a35a",
        "attack": "whirling the censer overhead on its chain",
    },
    # --- Пепел: Драка-Орда ---
    "e_scavenger": {
        "accent": "#8aa84a", "size": 64, "fit": 48,
        "silhouette": "щуплый и сутулый, наплечник из дорожного знака",
        "prompt": "small wiry scrapper in mismatched sheet-metal plates lashed with wire, "
                  "a road-sign shoulder guard, bandaged face, short jagged blade, stooped "
                  "and eager, accent color #8aa84a",
        "attack": "slashing with a short jagged blade",
    },
    "e_brute": {
        "accent": "#6d8f3a", "size": 96, "fit": 64,
        "silhouette": "громадный сутулый, кулаки крупнее головы, шлем крошечный",
        "prompt": "huge stooping brute in riveted sheet-iron plate, fists larger than the "
                  "head, a tiny helmet welded from a road sign, a tyre strapped across the "
                  "chest as armour, nails hammered through the knuckles, accent color #6d8f3a",
        "attack": "hammering down with both fists",
    },
    "e_slinger": {
        "accent": "#9a8a4a", "size": 64, "fit": 48,
        "silhouette": "тощий, раскрученная петля пращи над головой",
        "prompt": "lean raider whirling a leather sling loaded with a jagged iron nut, "
                  "scrap-plate kilt, goggles cut from bottle glass, a satchel of scrap shot "
                  "at the hip, accent color #9a8a4a",
        "attack": "releasing the sling forward",
    },
    "e_ashhound": {
        "accent": "#7a7060", "size": 64, "fit": 48,
        "body_type": "quadruped", "template": "dog",
        "silhouette": "поджарый четвероногий с клетчатым намордником",
        "prompt": "lean ash-grey war hound, ribs showing through singed hide, an iron "
                  "muzzle-cage riveted to the skull, spiked collar of scrap plate, docked "
                  "ears, accent color #7a7060",
        "attack": "leaping forward, jaws wide",
    },
    "e_chainganger": {
        "accent": "#8a5a3a", "size": 64, "fit": 48,
        "silhouette": "коренастый, длинная провисшая цепь сбоку, наплечник только один",
        "prompt": "heavy raider swinging a length of anchor chain, iron collar and shackles "
                  "still locked on the wrists, bare scarred torso, plate strapped over one "
                  "shoulder only, accent color #8a5a3a",
        "attack": "sweeping the anchor chain in a low arc",
    },
    "e_scrapthrower": {
        "accent": "#a89a5a", "size": 64, "fit": 48,
        "silhouette": "кривоногий, мешок за плечом, рука отведена на замах",
        "prompt": "bandy-legged scrapper carrying a sack of jagged metal offcuts, one arm "
                  "wound back to throw, welding visor of smoked glass, layered scrap-plate "
                  "apron, accent color #a89a5a",
        "attack": "hurling a jagged metal offcut",
    },
    # --- Курган: литые и хитин ---
    "e_husk": {
        "accent": "#5a6a6a", "size": 64, "fit": 48,
        "silhouette": "поникший, голова свешена набок, одна линза тлеет",
        "prompt": "hollow cast-metal husk of a servant construct, dull unpolished plating "
                  "pitted with corrosion, one dim green lens still lit in an empty "
                  "faceplate, engraved bands around the limbs, slack shuffling stance, "
                  "accent color #5a6a6a",
        "attack": "swinging a stiff arm downward",
    },
    "e_drone": {
        "accent": "#2fa8a0", "size": 64, "fit": 48,
        "silhouette": "купол без ног, три висящих манипулятора, одна широкая линза",
        "prompt": "compact armoured shipyard drone hovering low, domed hull of dull "
                  "green-grey metal, three dangling segmented manipulator arms, a single "
                  "wide green lens, vents glowing underneath. IT HOVERS. NO LEGS. NO FEET. "
                  "accent color #2fa8a0",
        "attack": "extending the manipulator arms forward",
    },
    "e_swarmlet": {
        "accent": "#4d8f6b", "size": 64, "fit": 48,
        "body_type": "quadruped", "template": "cat",
        "silhouette": "плоский и длинный, ниже всех, клиновидная безглазая голова",
        "prompt": "small low segmented chitin crawler, sickle legs, flat wedge head with no "
                  "eyes, dull green-brown plates with faint bioluminescence in the joints, "
                  "accent color #4d8f6b",
        "attack": "striking forward with the wedge head",
    },
    "e_warden": {
        "accent": "#3a8a86", "size": 96, "fit": 64,
        "silhouette": "широкий и неподвижный, плечи выше головы, две глубокие линзы",
        "prompt": "heavy sentinel construct of dull cast metal, broad engraved chest plate, "
                  "hunched immobile shoulders, two green lenses set deep in a featureless "
                  "faceplate, thick riveted limbs, accent color #3a8a86",
        "attack": "driving a riveted fist forward",
    },
    "e_hatcher": {
        "accent": "#6aa88a", "size": 64, "fit": 48,
        "silhouette": "раздутое брюхо волочится, тонкие серповидные передние лапы",
        "prompt": "bloated chitin brood-carrier, a sagging translucent egg sac slung under "
                  "the abdomen, thin sickle forelimbs, low hunched carriage, pale green glow "
                  "between the plates, accent color #6aa88a",
        "attack": "rearing up and splitting the egg sac open",
    },
}

ELITES = {
    "el_butcherling": {
        "accent": "#9a4a5a", "size": 96, "fit": 64,
        "silhouette": "без шеи, два тесака вместо кистей, фартук",
        "prompt": "towering slab of fused mutant flesh in a stained leather apron, two "
                  "mismatched arms ending in cleavers, no neck at all, a split grinning "
                  "mouth across the chest, hooks and chains sunk into the shoulders, "
                  "accent color #9a4a5a",
        "attack": "bringing both cleavers down together",
    },
    "el_archzealot": {
        "accent": "#c8703a", "size": 96, "fit": 64,
        "silhouette": "высокий, ленты-полотнища прибиты к спине, рука-плеть",
        "prompt": "tall possessed champion in scorched plate over swollen mutated flesh, "
                  "three burning eyes in a blank helm, one arm grown into a barbed lash, "
                  "tattered orange banner-strips nailed to the back, accent color #c8703a",
        "attack": "cracking the barbed lash forward",
    },
    "el_warboss": {
        "accent": "#6d8f3a", "size": 96, "fit": 64,
        "silhouette": "самый широкий силуэт Пепла, рогатый шлем из труб",
        "prompt": "massive scrapper chieftain in layered riveted plate cut from road signs "
                  "and boiler steel, a horned helm welded from pipe, an anchor chain wrapped "
                  "around one huge fist, scrap trophies hanging from the belt, "
                  "accent color #6d8f3a",
        "attack": "swinging the chain-wrapped fist across",
    },
    "el_houndmaster": {
        "accent": "#7a7060", "size": 96, "fit": 64,
        "silhouette": "худой в плаще из шкур, мотки поводков через плечо",
        "prompt": "gaunt houndmaster in a hide cloak of stitched pelts, an iron muzzle-cage "
                  "hanging at the belt, a barbed goad in one hand, coiled chain leashes over "
                  "the shoulder, ash-grey wrappings, accent color #7a7060",
        "attack": "thrusting the barbed goad forward",
    },
    "el_ironwarden": {
        "accent": "#3a8a86", "size": 96, "fit": 64,
        "silhouette": "щит сросся с предплечьем, четыре линзы в ряд",
        "prompt": "tall cast-iron warden construct, deeply engraved armour bands, a heavy "
                  "slab shield fused to one forearm, four green lenses in a blank faceplate, "
                  "verdigris streaking the dull metal, accent color #3a8a86",
        "attack": "slamming forward behind the slab shield",
    },
    "el_broodqueen": {
        "accent": "#6aa88a", "size": 96, "fit": 64,
        "silhouette": "длинное брюхо волочится, четыре поднятых серпа, венец из шипов",
        "prompt": "broad chitin brood matriarch, a long segmented abdomen dragging behind, "
                  "four sickle forelimbs raised, a crown of blunt spines, heavy "
                  "bioluminescent glow in every plate joint, accent color #6aa88a",
        "attack": "sweeping all four sickle forelimbs inward",
    },
}

BOSSES = {
    "b_butcher": {
        "accent": "#a83a3a", "size": 128, "fit": 112,
        "silhouette": "голова утоплена в плечи, крюк-якорь и тесак",
        "prompt": "colossal butcher of fused flesh and bolted iron, a blood-slick leather "
                  "apron, a meat hook the size of an anchor in one hand and a great cleaver "
                  "in the other, head sunk into the shoulders, chains piercing the back, "
                  "accent color #a83a3a",
        "attack": "burying the anchor hook forward and dragging it back",
    },
    "b_rift_father": {
        "accent": "#7a2f8f", "size": 160, "fit": 128,
        "silhouette": "асимметричная гора лишних рук и глаз, распахнутая грудь",
        "prompt": "vast corrupted patriarch of writhing extra limbs and open eyes across the "
                  "torso, tattered violet vestments, a wet split maw where the chest should "
                  "be, glistening asymmetric mutation, accent color #7a2f8f",
        "attack": "opening the chest maw and spraying bile forward",
    },
    "b_iron_chief": {
        "accent": "#6d8f3a", "size": 128, "fit": 112,
        "silhouette": "рука-таран из поршней, знамёна из дорожных знаков за спиной",
        "prompt": "enormous scrapper warlord clad in welded boiler plate and tyre armour, "
                  "one arm a piston-driven iron ram, a horned scrap helm, banners of "
                  "stripped road signs on the back, accent color #6d8f3a",
        "attack": "driving the piston ram forward",
    },
    "b_ash_titan": {
        "accent": "#a89a5a", "size": 160, "fit": 128,
        "silhouette": "бесформенная громада с тлеющими трещинами, руки-глыбы",
        "prompt": "towering titan of compacted ash, slag and scavenged girders, molten cracks "
                  "glowing dull orange through its crust, arms ending in wrecking masses of "
                  "fused scrap, accent color #a89a5a",
        "attack": "bringing a wrecking mass of scrap down",
    },
    "b_cast_sentinel": {
        "accent": "#2fa8a0", "size": 128, "fit": 112,
        "silhouette": "саркофаг на суставчатых ногах, длинный ствол-излучатель",
        "prompt": "immense cast-metal sentinel on heavy jointed legs, an engraved sarcophagus "
                  "torso, a long barrelled emitter fused to one arm, a row of green lenses "
                  "across a blank faceplate, accent color #2fa8a0",
        "attack": "bracing and firing the arm emitter",
    },
    "b_barrow_lord": {
        "accent": "#3a8a86", "size": 160, "fit": 128,
        "silhouette": "иссохшая вытянутая фигура в саване, посох-крюк",
        "prompt": "gaunt towering barrow lord of tarnished cast metal, a tattered burial "
                  "shroud over engraved plating, a long crook-staff of verdigris bronze, cold "
                  "green light in deep hollow eye sockets, accent color #3a8a86",
        "attack": "raising the crook-staff and calling the dead up",
    },
}


def main():
    with open(PATH, encoding="utf-8") as f:
        data = json.load(f)

    added = 0
    for section, block in (("enemies", ENEMIES), ("elites", ELITES), ("bosses", BOSSES)):
        target = data.setdefault(section, {})
        for key, entry in block.items():
            if target.get(key) == entry:
                continue
            target[key] = entry
            added += 1

    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"assets.json: записей добавлено/обновлено {added}; "
          f"enemies {len(data['enemies'])}, elites {len(data['elites'])}, "
          f"bosses {len(data['bosses'])}")


if __name__ == "__main__":
    main()
