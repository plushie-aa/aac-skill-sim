#!/usr/bin/env python3
"""
Compile DaruGear v3.5 CSV dumps into compact, fast-loading JSON catalogs
under js/data/gear_catalog/ for the in-app Gear Builder.
"""

import csv
import json
import os
import re
from collections import defaultdict
from pathlib import Path

DL_DIR = Path(os.environ.get("DARUGEAR_CSV_DIR", "tools/darugear_cache/v35"))
OUT_DIR = Path("js/data/gear_catalog")
ICONS_DIR = Path("assets/icons")

SLOTS = [
    {"id": 0, "name": "Costume", "group": "left"},
    {"id": 1, "name": "Head", "group": "left"},
    {"id": 2, "name": "Chest", "group": "left"},
    {"id": 3, "name": "Waist", "group": "left"},
    {"id": 4, "name": "Wrists", "group": "left"},
    {"id": 5, "name": "Hands", "group": "left"},
    {"id": 6, "name": "Cloak", "group": "left"},
    {"id": 7, "name": "Legs", "group": "left"},
    {"id": 8, "name": "Feet", "group": "left"},
    {"id": 9, "name": "Undergarments", "group": "left"},
    {"id": 10, "name": "Neck", "group": "right"},
    {"id": 11, "name": "Earring", "group": "right"},
    {"id": 12, "name": "Earring", "group": "right"},
    {"id": 13, "name": "Ring", "group": "right"},
    {"id": 14, "name": "Ring", "group": "right"},
    {"id": 15, "name": "Right Hand Weapon", "group": "weapons"},
    {"id": 16, "name": "Left Hand Weapon", "group": "weapons"},
    {"id": 17, "name": "Ranged Weapon", "group": "weapons"},
    {"id": 18, "name": "Instrument", "group": "weapons"},
    {"id": 19, "name": "Back", "group": "right"},
]

# Exact DaruGear v1.3 / 3.5 `bi` grade table
GRADES = [
    {"id": 0, "name": "Crude", "colour": "#8c8c8c", "main_mod": 80, "stat_mod": 80, "luna_count_l": 0, "luna_count_m": 0, "luna_count_s": 0, "luna_count_xs": 0, "luna_count_xxs": 0},
    {"id": 1, "name": "Basic", "colour": "#b0b0b0", "main_mod": 100, "stat_mod": 100, "luna_count_l": 0, "luna_count_m": 0, "luna_count_s": 0, "luna_count_xs": 0, "luna_count_xxs": 0},
    {"id": 2, "name": "Grand", "colour": "#52d669", "main_mod": 105, "stat_mod": 108, "luna_count_l": 1, "luna_count_m": 1, "luna_count_s": 1, "luna_count_xs": 1, "luna_count_xxs": 1},
    {"id": 3, "name": "Rare", "colour": "#4da3ff", "main_mod": 110, "stat_mod": 116, "luna_count_l": 2, "luna_count_m": 1, "luna_count_s": 1, "luna_count_xs": 1, "luna_count_xxs": 1},
    {"id": 4, "name": "Arcane", "colour": "#d96ef5", "main_mod": 115, "stat_mod": 124, "luna_count_l": 3, "luna_count_m": 2, "luna_count_s": 1, "luna_count_xs": 1, "luna_count_xxs": 1},
    {"id": 5, "name": "Heroic", "colour": "#f2c94c", "main_mod": 120, "stat_mod": 132, "luna_count_l": 4, "luna_count_m": 3, "luna_count_s": 2, "luna_count_xs": 2, "luna_count_xxs": 2},
    {"id": 6, "name": "Unique", "colour": "#f07b42", "main_mod": 125, "stat_mod": 140, "luna_count_l": 5, "luna_count_m": 4, "luna_count_s": 3, "luna_count_xs": 2, "luna_count_xxs": 2},
    {"id": 7, "name": "Celestial", "colour": "#ff5c6a", "main_mod": 135, "stat_mod": 150, "luna_count_l": 6, "luna_count_m": 5, "luna_count_s": 4, "luna_count_xs": 3, "luna_count_xxs": 3},
    {"id": 8, "name": "Divine", "colour": "#d9a466", "main_mod": 150, "stat_mod": 160, "luna_count_l": 7, "luna_count_m": 6, "luna_count_s": 5, "luna_count_xs": 4, "luna_count_xxs": 4},
    {"id": 9, "name": "Epic", "colour": "#f0f6ff", "main_mod": 170, "stat_mod": 170, "luna_count_l": 7, "luna_count_m": 6, "luna_count_s": 5, "luna_count_xs": 4, "luna_count_xxs": 4},
    {"id": 10, "name": "Legendary", "colour": "#ffb326", "main_mod": 190, "stat_mod": 185, "luna_count_l": 7, "luna_count_m": 6, "luna_count_s": 5, "luna_count_xs": 4, "luna_count_xxs": 4},
    {"id": 11, "name": "Mythic", "colour": "#ef233c", "main_mod": 200, "stat_mod": 200, "luna_count_l": 8, "luna_count_m": 7, "luna_count_s": 6, "luna_count_xs": 5, "luna_count_xxs": 4},
    {"id": 12, "name": "Eternal", "colour": "#e85dff", "main_mod": 210, "stat_mod": 210, "luna_count_l": 8, "luna_count_m": 7, "luna_count_s": 6, "luna_count_xs": 5, "luna_count_xxs": 4},
]

ATTR_META = {
    0: ("Strength", 1, ""),
    1: ("Agility", 1, ""),
    2: ("Stamina", 1, ""),
    3: ("Intelligence", 1, ""),
    4: ("Spirit", 1, ""),
    6: ("Max Health", 1, ""),
    7: ("Max Mana", 1, ""),
    8: ("Physical Defense", 1, ""),
    10: ("Move Speed", 10, "%"),
    11: ("Health Regen", 1, ""),
    12: ("Mana Regen", 1, ""),
    17: ("Melee Critical Damage", 10, "%"),
    26: ("Ranged Critical Damage", 10, "%"),
    31: ("Magic Critical Damage", 10, "%"),
    33: ("Melee Attack", 1000, ""),
    34: ("Ranged Attack", 1000, ""),
    35: ("Magic Attack", 1000, ""),
    51: ("Melee Skill Damage", 10, "%"),
    52: ("Ranged Skill Damage", 10, "%"),
    53: ("Magic Skill Damage", 10, "%"),
    54: ("Attack Speed", 1, ""),
    56: ("Received Healing", 10, "%"),
    57: ("Defense Penetration", 1, ""),
    58: ("Received Damage", 10, "%"),
    64: ("Magic Defense", 1, ""),
    67: ("Cont. Health Regen", 5, ""),
    68: ("Cont. Mana Regen", 5, ""),
    71: ("Cast Time", 10, "%"),
    77: ("Melee Critical Rate", 10, "%"),
    78: ("Melee Accuracy", 10, "%"),
    81: ("Parry Rate", 10, "%"),
    82: ("Ranged Critical Rate", 10, "%"),
    83: ("Ranged Accuracy", 10, "%"),
    86: ("Magic Critical Rate", 10, "%"),
    87: ("Magic Attack %", 1, "%"),
    88: ("Magic Accuracy", 10, "%"),
    89: ("Cast Delay Tolerance", 1.5, "%"),
    90: ("Aggro", 1, "%"),
    94: ("Stealth Detection", 1, "%"),
    120: ("Healing", 10, "%"),
    121: ("Backstab Melee Damage", 10, "%"),
    122: ("Backstab Ranged Damage", 10, "%"),
    123: ("Backstab Magic Damage", 10, "%"),
    142: ("Fixed Received Damage", 1, ""),
    143: ("Received Melee Damage", 10, "%"),
    144: ("Fixed Received Ranged", 1, ""),
    145: ("Received Ranged Damage", 10, "%"),
    146: ("Fixed Received Magic", 1, ""),
    147: ("Received Magic Damage", 10, "%"),
    149: ("Received Siege Damage", 10, "%"),
    175: ("Healing Power", 1000, ""),
    176: ("Critical Heal Bonus", 10, "%"),
    179: ("Shield Block Rate", 10, "%"),
    180: ("Evasion", 10, "%"),
    181: ("Focus", 1, ""),
    182: ("Toughness", 1, ""),
    183: ("Resilience", 1, ""),
    184: ("Magic Defense Pen", 1, ""),
    185: ("Critical Heal Rate", 10, "%"),
    196: ("PvE Received Damage", 10, "%"),
    197: ("PvE Melee Skill Dmg", 10, "%"),
    198: ("PvE Ranged Skill Dmg", 10, "%"),
    199: ("PvE Magic Skill Dmg", 10, "%"),
    204: ("Shield Def Pen Rate", 10, "%"),
    206: ("Shield Def Pen", 10, "%"),
    218: ("Attack Speed", 1, ""),
    994: ("Physical Defense %", 1, "%"),
    995: ("Max Health %", 1, "%"),
    996: ("Max Mana %", 1, "%"),
    997: ("Spirit %", 1, "%"),
    998: ("Melee Attack %", 1, "%"),
    999: ("Ranged Attack %", 1, "%"),
}

HOLDABLE_TYPE = {
    1: "Sword", 2: "Dagger", 3: "Greatsword", 4: "Dagger-special", 5: "Sword", 6: "Sword",
    7: "Katana", 8: "Nodachi", 9: "Katana", 10: "Axe", 11: "GreatAxe", 12: "Club",
    13: "Greatclub", 14: "Scepter", 15: "Shortspear", 16: "Longspear", 17: "Staff",
    18: "Scepter", 19: "Bow", 20: "special", 21: "Lute", 22: "Drum-special", 23: "Flute",
    24: "Shield", 25: "Obsidian Katana", 26: "Obsidian Shortspear",
    27: "Offhand Magic Dagger", 28: "Offhand Healing Scepter", 29: "Magic Shield",
    30: "Offhand Dagger", 9000003: "Warclub", 9000007: "Scythe",
}

WEAPON_SLOTS = {
    "Sword": [15, 16], "Dagger": [15, 16], "Greatsword": [15], "Katana": [15, 16],
    "Nodachi": [15], "Axe": [15, 16], "GreatAxe": [15], "Club": [15], "Greatclub": [15],
    "Scepter": [15], "Shortspear": [15], "Longspear": [15], "Staff": [15], "Bow": [17],
    "Lute": [18], "Flute": [18], "Shield": [16], "Obsidian Katana": [15],
    "Obsidian Shortspear": [15], "Offhand Healing Scepter": [16], "Offhand Magic Dagger": [16],
    "Magic Shield": [16], "Offhand Dagger": [16], "Warclub": [15], "Scythe": [15],
}

ARMOR_TYPE = {1: "Cloth", 2: "Leather", 3: "Plate", 4: "Cloak", 5: "Synthesis Gear"}
ARMOR_SLOTS_MAP = {31: [0], 1: [1], 3: [2], 4: [3], 5: [7], 6: [5], 7: [8], 8: [4], 9: [6], 13: [9]}
ACC_TYPE = {2: "Necklace", 10: "Earring", 11: "Ring"}
ACC_SLOTS_MAP = {2: [10], 10: [11, 12], 11: [13, 14]}

def da_get_slots(g):
    m = {
        1: [15, 16], 2: [15], 13: [15], 3: [17], 4: [16], 20: [16], 5: [1], 34: [1],
        6: [2], 23: [2], 7: [5], 8: [8], 9: [6], 10: [6], 11: [15, 16, 17, 18],
        12: [15, 16], 14: [17, 18, 9], 15: [1, 2, 3, 4, 5, 7, 8], 16: [1, 3, 4],
        17: [2, 7], 18: [5], 19: [8], 21: [1, 2, 3, 4, 5, 7, 8, 9],
        36: [1, 2, 3, 4, 5, 7, 8, 9], 22: [9], 24: [7], 25: [15, 16], 26: [2, 7, 8],
        27: [10, 11, 12, 13, 14, 18], 31: [4], 32: [3], 35: [15, 16],
        99: list(range(1, 21)), 8000003: [0], 9000003: [10], 9000004: [10, 11, 12, 13, 14],
    }
    return m.get(g, [])

def da_limit_name(g):
    if g == 36:
        return ["Ayanad", "Erenor"]
    if g in (9000003, 9000004):
        return ["Enlightened"]
    return []

def da_limit_type(g):
    oneh = ["Club", "Dagger", "Sword", "Katana", "Axe", "Scepter", "Shortspear", "Obsidian Katana", "Obsidian Shortspear", "Offhand Magic Dagger", "Offhand Healing Scepter", "Offhand Dagger"]
    twoh = ["Greatclub", "Staff", "Longspear", "Nodachi", "Greatsword", "GreatAxe", "Warclub", "Scythe"]
    shields = ["Shield", "Magic Shield"]
    offhands = ["Offhand Magic Dagger", "Offhand Healing Scepter", "Offhand Dagger"]
    if g == 1: return oneh
    if g in (2, 13): return twoh
    if g in (4, 20): return shields
    if g == 11: return oneh + ["Bow", "Flute", "Lute"]
    if g == 12: return oneh
    if g == 14: return ["Bow", "Flute", "Lute", "Synthesis Gear"]
    if g == 25: return shields + oneh
    if g == 35: return shields + offhands + twoh
    return []

def clean_aa_text(s):
    if not s:
        return ""
    s = re.sub(r"\|c[0-9a-fA-F]{8}|\|nc;|\|ni;|\|nn;|\|r", "", str(s))
    return re.sub(r"\s+", " ", s).strip()

def parse_int(v, default=0):
    try:
        if v is None or v == "":
            return default
        return int(float(v))
    except Exception:
        return default

def parse_float(v, default=0.0):
    try:
        if v is None or v == "":
            return default
        return float(v)
    except Exception:
        return default

def clean_icon(fn):
    if not fn:
        return ""
    png = str(fn).replace("\\", "/").replace(".dds", ".png").lstrip("/")
    if (ICONS_DIR / png).exists():
        return "assets/icons/" + png
    return png  # UI resolves local or https://darugear.com/assets/icons/<png>

def parse_attr_list(raw_json):
    if not raw_json:
        return []
    try:
        arr = json.loads(raw_json)
    except Exception:
        return []
    out = []
    if not isinstance(arr, list):
        return out
    for it in arr:
        if not isinstance(it, dict):
            continue
        aid = it.get("unit_attribute_id")
        val = it.get("value")
        if aid is None or val is None:
            continue
        try:
            out.append({"unit_attribute_id": int(aid), "value": float(val) if float(val) % 1 else int(float(val))})
        except Exception:
            continue
    return out

def format_effects_text(effects, special_text=""):
    parts = []
    for e in effects:
        aid = e["unit_attribute_id"]
        val = e["value"]
        lbl, div, unit = ATTR_META.get(aid, (f"Stat #{aid}", 1, ""))
        scaled = val / div
        num_s = str(int(round(scaled))) if abs(scaled - round(scaled)) < 0.05 else f"{scaled:.1f}"
        sign = "+" if scaled >= 0 else ""
        parts.append(f"{lbl} {sign}{num_s}{unit}")
    sp = clean_aa_text(special_text)
    if sp:
        parts.append(sp)
    return "; ".join(parts)

def parse_synth_slots(raw_json):
    if not raw_json:
        return []
    try:
        arr = json.loads(raw_json)
    except Exception:
        return []
    out = []
    if not isinstance(arr, list):
        return out
    for it in arr:
        if isinstance(it, dict) and it.get("grade") is not None and it.get("max_unit_modifier_num") is not None:
            out.append({"grade": int(it["grade"]), "max_unit_modifier_num": int(it["max_unit_modifier_num"])})
    return out

def compile_gear_catalog(dl_dir=None, out_dir=None, icons_dir=None):
    global DL_DIR, OUT_DIR, ICONS_DIR
    if dl_dir is not None:
        DL_DIR = Path(dl_dir)
    if out_dir is not None:
        OUT_DIR = Path(out_dir)
    if icons_dir is not None:
        ICONS_DIR = Path(icons_dir)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Equip effects indexed by item_id
    equip_effects = defaultdict(list)
    with open(DL_DIR / "equip_effect.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            iid = parse_int(r.get("item_id"))
            aid = r.get("unit_attribute_id")
            val = r.get("value")
            if not iid or aid in (None, "") or val in (None, ""):
                continue
            equip_effects[iid].append({
                "item_grade_id": parse_int(r.get("item_grade_id")),
                "unit_attribute_id": parse_int(aid),
                "value": parse_float(val) if parse_float(val) % 1 else parse_int(val),
            })

    # 2. Set effects indexed by equip_item_set_id
    set_effects = defaultdict(list)
    with open(DL_DIR / "set_effect.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            sid = parse_int(r.get("equip_item_set_id"))
            aid = r.get("unit_attribute_id")
            val = r.get("value")
            if not sid or aid in (None, "") or val in (None, ""):
                continue
            set_effects[sid].append({
                "equip_item_set_id": sid,
                "num_pieces": parse_int(r.get("num_pieces")),
                "unit_attribute_id": parse_int(aid),
                "value": parse_float(val) if parse_float(val) % 1 else parse_int(val),
                "linear_level_bonus": parse_float(r.get("linear_level_bonus")),
                "buff_name": clean_aa_text(r.get("buff_name")),
            })

    # 3. Synthesis pools indexed by cat_id -> grade -> deduplicated stat options
    synth_pools = defaultdict(lambda: defaultdict(list))
    synth_seen = set()
    with open(DL_DIR / "synth.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            cid = parse_int(r.get("cat_id"))
            gr = parse_int(r.get("grade"))
            aid = parse_int(r.get("unit_attribute_id"), -1)
            mn = parse_float(r.get("minvalue"))
            mx = parse_float(r.get("maxvalue"))
            if not cid or aid < 0 or (mn == 0 and mx == 0):
                continue
            dedup = (cid, gr, aid, mn, mx)
            if dedup in synth_seen:
                continue
            synth_seen.add(dedup)
            lbl, div, unit = ATTR_META.get(aid, (f"Stat #{aid}", 1, ""))
            lo_s = str(int(round(mn / div))) if abs((mn / div) - round(mn / div)) < 0.05 else f"{mn / div:.1f}"
            hi_s = str(int(round(mx / div))) if abs((mx / div) - round(mx / div)) < 0.05 else f"{mx / div:.1f}"
            synth_pools[str(cid)][str(gr)].append({
                "unit_attribute_id": aid,
                "minvalue": mn if mn % 1 else int(mn),
                "maxvalue": mx if mx % 1 else int(mx),
                "display_text": f"{lbl} ({lo_s}~{hi_s}{unit})",
            })

    # 4. Equipment Buffs (33 rows for dn.setGearBuffs)
    equipment_buffs = []
    with open(DL_DIR / "equipment_buffs.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            bid = parse_int(r.get("id"))
            if not bid:
                continue
            raw_bj = []
            try:
                raw_bj = json.loads(r.get("buff_json") or "[]")
            except Exception:
                raw_bj = []
            cleaned = []
            for entry in raw_bj:
                if not isinstance(entry, dict) or entry.get("unit_attribute_id") is None:
                    continue
                cleaned.append({
                    "unit_attribute_id": parse_int(entry.get("unit_attribute_id")),
                    "value": parse_float(entry.get("value")),
                    "linear_level_bonus": parse_float(entry.get("linear_level_bonus")),
                })
            equipment_buffs.append({
                "id": bid,
                "name": clean_aa_text(r.get("name")),
                "img": clean_icon(r.get("icon_filename")),
                "data": cleaned,
            })

    # 5. Titles
    titles = []
    with open(DL_DIR / "titles.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            tid = parse_int(r.get("id"))
            nm = (r.get("name") or "").strip()
            if not tid or not nm:
                continue
            data = parse_attr_list(r.get("data"))
            titles.append({
                "id": tid,
                "buff_id": parse_int(r.get("buff_id")) or None,
                "name": nm,
                "img": clean_icon(r.get("icon")),
                "data": data,
                "effect_text": format_effects_text(data),
            })
    titles.sort(key=lambda x: (0 if x["data"] else 1, x["name"].lower()))

    # 6. Lunagems
    lunagems = []
    with open(DL_DIR / "data_gems2.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            gid = parse_int(r.get("id"))
            nm = (r.get("name") or "").strip()
            if not gid or not nm or "DO NOT TRANSLATE" in nm:
                continue
            grp = parse_int(r.get("equip_slot_group_id"))
            slots = da_get_slots(grp)
            if not slots:
                continue
            effects = parse_attr_list(r.get("modifiers_json"))
            spec = clean_aa_text(r.get("special_text_effect"))
            lunagems.append({
                "id": gid,
                "name": nm,
                "level": parse_int(r.get("level")),
                "gradeid": parse_int(r.get("gradeid")),
                "img": clean_icon(r.get("icon_filename")),
                "slotid": slots,
                "limit_type": da_limit_type(grp),
                "effects": effects,
                "effect_text": format_effects_text(effects, spec),
            })
    lunagems.sort(key=lambda x: (-x["gradeid"], -x["level"], x["name"].lower()))

    # 7. Lunafrosts
    lunafrosts = []
    with open(DL_DIR / "Lunafrost.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            fid = parse_int(r.get("id"))
            nm = (r.get("name") or "").strip()
            if not fid or not nm or "DO NOT TRANSLATE" in nm:
                continue
            grp = parse_int(r.get("equip_slot_group_id"))
            slots = da_get_slots(grp)
            if not slots:
                continue
            effects = parse_attr_list(r.get("modifiers_json"))
            spec = clean_aa_text(r.get("special_text_effect"))
            eiset = parse_int(r.get("eiset_id"))
            entry = {
                "id": fid,
                "name": nm,
                "level": parse_int(r.get("level")),
                "gradeid": parse_int(r.get("gradeid")),
                "img": clean_icon(r.get("icon_filename")),
                "slotid": slots,
                "limit_name": da_limit_name(grp),
                "limit_type": da_limit_type(grp),
                "effects": effects,
                "effect_text": format_effects_text(effects, spec),
            }
            if eiset and eiset in set_effects:
                entry["eiset_id"] = eiset
            lunafrosts.append(entry)
    lunafrosts.sort(key=lambda x: (-x["gradeid"], -x["level"], x["name"].lower()))

    def build_item_obj(iid, name, item_type, level, min_g, max_g, slotids, icon, weights, eiset_id, buff_json, mod_json, synth_cat, synth_slots):
        obj = {
            "id": iid,
            "name": name,
            "type": item_type,
            "level": level,
            "mingrade": min_g,
            "maxgrade": max_g,
            "slotid": slotids,
            "img": clean_icon(icon),
        }
        if any(weights):
            obj["w"] = weights  # [str, dex, sta, spi, int]
        eq_eff = equip_effects.get(iid)
        if eq_eff:
            obj["equipeffects"] = eq_eff
        if eiset_id and eiset_id in set_effects:
            obj["eiset_id"] = eiset_id
        if buff_json:
            obj["buff_json"] = buff_json
        if mod_json:
            obj["modifiers_json"] = mod_json
        if synth_cat and str(synth_cat) in synth_pools:
            obj["synth_cat_id"] = synth_cat
        if synth_slots:
            obj["synth_slot_count"] = synth_slots
        return obj

    # 8. Weapons (slots 15..18)
    weapons = []
    seen_w = set()
    with open(DL_DIR / "Weapon_2.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            hid = parse_int(r.get("holdable_id"))
            wtype = HOLDABLE_TYPE.get(hid)
            slotids = WEAPON_SLOTS.get(wtype)
            nm = (r.get("name") or "").strip()
            lvl = parse_int(r.get("level"))
            iid = parse_int(r.get("id"))
            if not slotids or not nm or "DO NOT TRANSLATE" in nm or lvl < 10 or iid in seen_w:
                continue
            seen_w.add(iid)
            weapons.append(build_item_obj(
                iid, nm, wtype, lvl,
                parse_int(r.get("min_grade"), 1), parse_int(r.get("max_grade"), 11),
                slotids, r.get("icon_filename"),
                [parse_int(r.get("str_weight")), parse_int(r.get("dex_weight")), parse_int(r.get("sta_weight")), parse_int(r.get("spi_weight")), parse_int(r.get("int_weight"))],
                parse_int(r.get("eiset_id")),
                parse_attr_list(r.get("buff_json")),
                parse_attr_list(r.get("modifiers_json")),
                parse_int(r.get("synth_cat_id")),
                parse_synth_slots(r.get("synth_slot_count")),
            ))
    weapons.sort(key=lambda x: (-x["level"], x["name"].lower()))

    # 9. Armor (slots 0..9)
    armors = []
    seen_a = set()
    armor_csv = DL_DIR / "armor.csv" if (DL_DIR / "armor.csv").exists() else DL_DIR / "armor_1.csv"
    with open(armor_csv, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            st_id = parse_int(r.get("slot_type_id"))
            slotids = ARMOR_SLOTS_MAP.get(st_id)
            nm = (r.get("name") or "").strip()
            lvl = parse_int(r.get("level"))
            iid = parse_int(r.get("id"))
            if not slotids or not nm or "DO NOT TRANSLATE" in nm or (lvl < 20 and st_id != 31) or iid in seen_a:
                continue
            seen_a.add(iid)
            tid = parse_int(r.get("type_id"), 1)
            if slotids[0] == 6:
                tid = 4
            elif slotids[0] == 9:
                tid = 5
            atype = ARMOR_TYPE.get(tid, "Cloth")
            armors.append(build_item_obj(
                iid, nm, atype, lvl,
                parse_int(r.get("min_grade"), 1), parse_int(r.get("max_grade"), 11),
                slotids, r.get("icon_filename"),
                [parse_int(r.get("str_weight")), parse_int(r.get("dex_weight")), parse_int(r.get("sta_weight")), parse_int(r.get("spi_weight")), parse_int(r.get("int_weight"))],
                parse_int(r.get("eiset_id")),
                parse_attr_list(r.get("buff_json")),
                parse_attr_list(r.get("modifiers_json")),
                parse_int(r.get("synth_cat_id")),
                parse_synth_slots(r.get("synth_slot_count")),
            ))
    armors.sort(key=lambda x: (-x["level"], x["name"].lower()))

    # 10. Accessories (slots 10..14) + Gliders (slot 19)
    accs = []
    seen_ac = set()
    with open(DL_DIR / "accessory_2.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            st_id = parse_int(r.get("slot_type_id"))
            slotids = ACC_SLOTS_MAP.get(st_id)
            nm = (r.get("name") or "").strip()
            iid = parse_int(r.get("id"))
            if not slotids or not nm or "DO NOT TRANSLATE" in nm or iid in seen_ac:
                continue
            seen_ac.add(iid)
            accs.append(build_item_obj(
                iid, nm, ACC_TYPE.get(st_id, "Accessory"), parse_int(r.get("level")),
                parse_int(r.get("min_grade"), 1), parse_int(r.get("max_grade"), 11),
                slotids, r.get("icon_filename"),
                [parse_int(r.get("str_weight")), parse_int(r.get("dex_weight")), parse_int(r.get("sta_weight")), parse_int(r.get("spi_weight")), parse_int(r.get("int_weight"))],
                parse_int(r.get("eiset_id")),
                parse_attr_list(r.get("buff_json")),
                parse_attr_list(r.get("stat_json")),
                parse_int(r.get("synth_cat_id")),
                parse_synth_slots(r.get("synth_slot_count")),
            ))
    with open(DL_DIR / "gliders.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            nm = (r.get("name") or "").strip()
            iid = parse_int(r.get("id"))
            if not nm or "DO NOT TRANSLATE" in nm or iid in seen_ac:
                continue
            seen_ac.add(iid)
            accs.append(build_item_obj(
                iid, nm, "Glider", parse_int(r.get("level"), 50),
                parse_int(r.get("min_grade"), 1), parse_int(r.get("max_grade"), 9),
                [19], r.get("icon_filename"),
                [0, 0, 0, 0, 0],
                0,
                [],
                parse_attr_list(r.get("stat_json")),
                0, [],
            ))
    accs.sort(key=lambda x: (-x["level"], x["name"].lower()))

    meta = {
        "version": 1,
        "slots": SLOTS,
        "grades": GRADES,
        "equipmentBuffs": equipment_buffs,
        "titles": titles,
        "lunagems": lunagems,
        "lunafrosts": lunafrosts,
        "setEffects": {str(k): v for k, v in set_effects.items()},
        "synthPools": {k: dict(v) for k, v in synth_pools.items()},
    }

    def dump_compact(path, obj):
        raw = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(raw, encoding="utf-8")
        tmp.replace(path)
        print(f"Wrote {path} ({len(raw):,} bytes)")

    dump_compact(OUT_DIR / "meta.json", meta)
    dump_compact(OUT_DIR / "items_weapons.json", weapons)
    dump_compact(OUT_DIR / "items_armor.json", armors)
    dump_compact(OUT_DIR / "items_acc.json", accs)
    counts = {
        "weapons": len(weapons),
        "armors": len(armors),
        "accessories": len(accs),
        "totalItems": len(weapons) + len(armors) + len(accs),
        "lunagems": len(lunagems),
        "lunafrosts": len(lunafrosts),
        "titles": len(titles),
        "equipmentBuffs": len(equipment_buffs),
        "setEffects": len(set_effects),
        "synthCategories": len(synth_pools),
    }
    print(
        f"Totals: weapons={counts['weapons']}, armor={counts['armors']}, "
        f"acc+gliders={counts['accessories']}, gems={counts['lunagems']}, "
        f"frosts={counts['lunafrosts']}, titles={counts['titles']}"
    )
    return counts


def main():
    compile_gear_catalog()


if __name__ == "__main__":
    main()
