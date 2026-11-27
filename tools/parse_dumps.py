#!/usr/bin/env python3
"""
Parse ArcheAge Classic in-game addon dumps into clean, engine-ready JSON data
files under js/data/.

Supports BOTH:
  1. Per-skillset guided dumps from Skill Dumper v0.8 (RECOMMENDED):
       addon/skill_dump_<tree>.txt           (clean naked Lv 55 dump)
       addon/skill_dump_<tree>_geared.txt    (optional 2-pt pair for Defense/Songcraft/Vitalism)
     Only skillsets with a per-tree dump file are updated; all other skillsets
     and enriched metadata (cooldownSec, castTimeSec, icon, Enlightened variants,
     Ode to Recovery live_buff_two_point ranks) are preserved untouched.

  2. Legacy full dumps:
       addon/skill_dump_1.txt (geared) + addon/skill_dump_2.txt (naked)

Usage:
    python tools/parse_dumps.py --status               # Show status of all 10 skillsets
    python tools/parse_dumps.py                        # Merge any addon/skill_dump_<tree>.txt files
    python tools/parse_dumps.py --trees battlerage     # Update specific tree(s) only
    python tools/parse_dumps.py --legacy               # Full legacy re-parse (all 10 trees)
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
ADDON_DIR = ROOT / "addon"
CATALOG_PATH = ROOT / "tools" / "skill_catalog.json"
OUT_DIR = ROOT / "js" / "data"
SKILLS_OUT_DIR = OUT_DIR / "skills"

SKILLSET_ORDER = [
    "battlerage",
    "witchcraft",
    "defense",
    "auramancy",
    "occultism",
    "archery",
    "sorcery",
    "shadowplay",
    "songcraft",
    "vitalism",
]

SAMPLE_SKILL_IDS = {
    "battlerage": "battlerage_precision_strike",
    "witchcraft": "witchcraft_earthen_grip",
    "defense": "defense_shield_slam",
    "auramancy": "auramancy_vicious_implosion",
    "occultism": "occultism_mana_stars",
    "archery": "archery_endless_arrows",
    "sorcery": "sorcery_arc_lightning",
    "shadowplay": "shadowplay_stalkers_mark",
    "songcraft": "songcraft_critical_discord",
    "vitalism": "vitalism_antithesis_heal",
}

FORMULA_OWNED_KEYS = {
    "id",
    "skillset",
    "name",
    "variant",
    "kind",
    "damageType",
    "scalingStat",
    "multiplierStat",
    "repeatCount",
    "flags",
    "skillId",
    "base",
    "scalingPct",
    "hits",
    "parseSource",
    "description",
    "bloodthirstPerStack",
    "backstabScalingPct",
    "rankCount",
    "ranks",
}

COLOR_TAG_RE = re.compile(r"\|c[0-9A-Fa-f]{8}|\|r|\|nc;|\|ni;")
FORMULA_RE = re.compile(
    r"\(\s*([0-9][0-9.,]*)\s*\+\s*([0-9][0-9.,]*)%\s*(Melee Attack|Ranged Attack|Magic Attack|Healing Power)\s*\)"
)
PERCENT_STAT_RE = re.compile(
    r"deal\s+([0-9][0-9.,]*)%\s+of\s+(Melee Attack|Ranged Attack|Magic Attack|Healing Power)"
)
FIRST_NUMBER_RE = re.compile(r"(?:restores\s*\+?|deals?\s+)([0-9][0-9,]*)", re.IGNORECASE)
LUA_STRING_RE = re.compile(r'"((?:\\.|[^"\\])*)"')

STAT_TO_MUL_KEY = {
    "meleeAttack": "melee_damage_mul",
    "rangedAttack": "ranged_damage_mul",
    "magicAttack": "spell_damage_mul",
    "healingPower": "heal_mul",
}

STAT_TO_ATK_KEY = {
    "meleeAttack": "melee_dps",
    "rangedAttack": "ranged_dps",
    "magicAttack": "spell_dps",
    "healingPower": "heal_dps",
}


def unescape_lua_string(s: str) -> str:
    """Decode a double-quoted Lua string produced by api.File:Write."""
    out: list[str] = []
    i = 0
    n = len(s)
    escapes = {
        "n": "\n",
        "r": "\r",
        "t": "\t",
        "\\": "\\",
        '"': '"',
        "'": "'",
        "b": "\b",
        "f": "\f",
    }
    while i < n:
        ch = s[i]
        if ch == "\\" and i + 1 < n:
            nxt = s[i + 1]
            if nxt in escapes:
                out.append(escapes[nxt])
                i += 2
            elif nxt == "u" and i + 5 < n:
                out.append(chr(int(s[i + 2 : i + 6], 16)))
                i += 6
            else:
                out.append(nxt)
                i += 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def clean_desc(text: str | None) -> str:
    if not text:
        return ""
    s = COLOR_TAG_RE.sub("", text)
    s = s.replace("#$second", "s").replace("#$minute", "m")
    return s.strip()


def parse_skill_dump(path: Path) -> tuple[dict[str, Any], dict[int, dict[str, Any]]]:
    raw = path.read_text(encoding="utf-8")
    meta_match = re.search(r'metaJson\s*=\s*"((?:\\.|[^"\\])*)"', raw)
    if not meta_match:
        raise ValueError(f"Could not locate metaJson in {path}")
    meta = json.loads(unescape_lua_string(meta_match.group(1)))

    chunks_match = re.search(r"skillChunks\s*=\s*\{([\s\S]*?)\n\s*\},?", raw)
    if not chunks_match:
        raise ValueError(f"Could not locate skillChunks in {path}")

    skill_map: dict[int, dict[str, Any]] = {}
    for cm in LUA_STRING_RE.finditer(chunks_match.group(1)):
        chunk = json.loads(unescape_lua_string(cm.group(1)))
        for item in chunk:
            skill_map[int(item["skillId"])] = item["tooltip"]
    return meta, skill_map


def parse_buff_dump(path: Path) -> list[dict[str, Any]]:
    raw = path.read_text(encoding="utf-8")
    m = re.search(r'buffsJson\s*=\s*"((?:\\.|[^"\\])*)"', raw)
    if not m:
        raise ValueError(f"Could not locate buffsJson in {path}")
    return json.loads(unescape_lua_string(m.group(1)))


def parse_skill_ranks_dump(path: Path) -> tuple[dict[str, Any], dict[int, list[dict[str, Any]]]] | None:
    if not path.exists():
        return None
    raw = path.read_text(encoding="utf-8")
    meta_match = re.search(r'metaJson\s*=\s*"((?:\\.|[^"\\])*)"', raw)
    if not meta_match:
        raise ValueError(f"Could not locate metaJson in {path}")
    meta = json.loads(unescape_lua_string(meta_match.group(1)))

    chunks_match = re.search(r"rankChunks\s*=\s*\{([\s\S]*)\}\s*,?\s*\}", raw)
    if not chunks_match:
        raise ValueError(f"Could not locate rankChunks in {path}")

    rank_map: dict[int, list[dict[str, Any]]] = {}
    for cm in LUA_STRING_RE.finditer(chunks_match.group(1)):
        chunk = json.loads(unescape_lua_string(cm.group(1)))
        for item in chunk:
            rank_map[int(item["skillId"])] = item.get("ranks", [])
    return meta, rank_map


def is_clean_naked_meta(meta: dict[str, Any]) -> tuple[bool, list[str]]:
    u = meta.get("player", {}).get("unitInfo", {})
    gs = float(u.get("gear_score", meta.get("player", {}).get("gearScore", 0)) or 0)
    issues: list[str] = []
    if gs > 0:
        issues.append(f"GS={int(gs)}")
    if meta.get("hasCostume"):
        issues.append("costume_equipped")
    for k in ("melee_damage_mul", "ranged_damage_mul", "spell_damage_mul", "heal_mul"):
        val = float(u.get(k, 0) or 0)
        if abs(val) > 1e-6:
            issues.append(f"{k}={val}%")
    return (len(issues) == 0), issues


def recover_raw_int(
    shown1: float,
    mul1: float,
    shown2: float | None,
    mul2: float | None,
    skill_id: int | None = None,
    field_label: str = "",
) -> int:
    """
    ArcheAge tooltips compute displayedBase = floor(rawBase * (1 + mul/100))
    and displayedPct = floor(rawPct * (1 + mul/100)).

    If either dump has mul == 0 (clean naked dump), prefer its exact integer value
    so geared costume enchants (e.g. Life Enlightenment +1 rank) cannot silently
    override the raw base tooltip. Also warns when two dumps disagree by > 2.
    """
    if shown1 == 0 and (shown2 is None or shown2 == 0):
        return 0
    f1 = 1.0 + mul1 / 100.0
    f2 = (1.0 + mul2 / 100.0) if mul2 is not None else None
    est1 = round(shown1 / f1)
    est2 = round(shown2 / f2) if (shown2 is not None and f2 is not None) else None

    if est2 is not None and abs(est1 - est2) > 2:
        print(
            f"  [WARN] Skill {skill_id} {field_label}: geared raw est ({est1}) != naked raw est ({est2}) "
            f"— possible +1 rank enchant (e.g. Life Enlightenment); preferring clean 0%-mul value!"
        )
        if abs(mul2 or 0.0) < 1e-6:
            return int(round(shown2))  # type: ignore[arg-type]
        if abs(mul1) < 1e-6:
            return int(round(shown1))

    # Exact 0%-mul dump takes priority with zero rounding ambiguity
    if abs(mul1) < 1e-6:
        return int(round(shown1))
    if shown2 is not None and mul2 is not None and abs(mul2) < 1e-6:
        return int(round(shown2))

    s1 = int(round(shown1))
    s2 = int(round(shown2)) if shown2 is not None else None

    candidates = range(max(0, est1 - 3), est1 + 4)
    if s2 is not None and f2 is not None:
        both_floor = [c for c in candidates if math.floor(c * f1) == s1 and math.floor(c * f2) == s2]
        if both_floor:
            return min(both_floor, key=lambda c: abs(c - shown1 / f1))
        both_round = [c for c in candidates if round(c * f1) == s1 and round(c * f2) == s2]
        if both_round:
            return min(both_round, key=lambda c: abs(c - shown1 / f1))

    floor_one = [c for c in candidates if math.floor(c * f1) == s1]
    if floor_one:
        return min(floor_one, key=lambda c: abs(c - shown1 / f1))
    return int(est1)


def extract_formula_from_desc(
    skill_id: int,
    desc1: str,
    desc2: str | None,
    scaling_stat: str,
    formula_index: int,
    parse_mode: str,
    u1: dict[str, Any],
    u2: dict[str, Any] | None,
    fallback_ratio: float | None = None,
) -> dict[str, Any]:
    if not desc1:
        raise ValueError(f"Empty description for Skill ID {skill_id}")

    mul_key = STAT_TO_MUL_KEY[scaling_stat]
    atk_key = STAT_TO_ATK_KEY[scaling_stat]
    mul1 = float(u1.get(mul_key, 0) or 0)
    mul2 = float(u2.get(mul_key, 0) or 0) if u2 is not None else None

    # Prefer the cleaner (0%-mul) description text for display when both are present
    display_desc = desc2 if (desc2 and mul2 is not None and abs(mul2) < 1e-6 and abs(mul1) > 1e-6) else desc1

    if parse_mode == "percent_of_stat":
        m1 = PERCENT_STAT_RE.search(desc1)
        m2 = PERCENT_STAT_RE.search(desc2) if desc2 else None
        if not m1:
            raise ValueError(f"percent_of_stat regex failed for skill {skill_id}: {desc1}")
        shown_pct1 = float(m1.group(1).replace(",", ""))
        shown_pct2 = float(m2.group(1).replace(",", "")) if m2 else None
        raw_pct = recover_raw_int(shown_pct1, mul1, shown_pct2, mul2, skill_id=skill_id, field_label="percentOfStat")
        return {
            "skillId": skill_id,
            "base": 0,
            "scalingPct": float(raw_pct),
            "parseSource": "percent_of_stat",
            "description": display_desc,
        }

    if parse_mode == "shadowsmite":
        m_bt = re.search(r"equal to\s+([0-9,]+)\s+times your stacked Bloodthirst", display_desc)
        m_bs = re.search(r"equal to\s+([0-9,]+)%\s+of Melee Attack", display_desc)
        bt_mult = int(m_bt.group(1).replace(",", "")) if m_bt else 210
        bs_pct = int(m_bs.group(1).replace(",", "")) if m_bs else 400
        return {
            "skillId": skill_id,
            "base": 0,
            "scalingPct": 0,
            "bloodthirstPerStack": bt_mult,
            "backstabScalingPct": bs_pct,
            "parseSource": "shadowsmite",
            "description": display_desc,
        }

    if parse_mode == "linear_two_point":
        m1 = FIRST_NUMBER_RE.search(desc1)
        if not m1:
            raise ValueError(f"linear_two_point failed for skill {skill_id}: D1={desc1}")
        v1 = float(m1.group(1).replace(",", "")) / (1.0 + mul1 / 100.0)
        atk1 = float(u1.get(atk_key, 0) or 0)

        if desc2 and u2 is not None and mul2 is not None:
            m2 = FIRST_NUMBER_RE.search(desc2)
            if not m2:
                raise ValueError(f"linear_two_point failed for skill {skill_id}: D2={desc2}")
            v2 = float(m2.group(1).replace(",", "")) / (1.0 + mul2 / 100.0)
            atk2 = float(u2.get(atk_key, 0) or 0)
            if abs(atk1 - atk2) >= 1e-6:
                ratio = (v1 - v2) / (atk1 - atk2)
                base = v1 - ratio * atk1
                return {
                    "skillId": skill_id,
                    "base": int(round(base)),
                    "scalingPct": round(ratio * 100.0, 2),
                    "parseSource": "linear_two_point",
                    "description": display_desc,
                }

        # Single-point fallback (e.g. naked-only per-skillset dump without _geared.txt pair)
        ratio = fallback_ratio if fallback_ratio is not None else 0.0
        base = v1 - ratio * atk1
        return {
            "skillId": skill_id,
            "base": int(round(base)),
            "scalingPct": round(ratio * 100.0, 2),
            "parseSource": "linear_two_point_preserved_ratio",
            "description": display_desc,
        }

    # Default: explicit "(shownBase + shownPct% Stat)" formula
    matches1 = list(FORMULA_RE.finditer(desc1))
    matches2 = list(FORMULA_RE.finditer(desc2)) if desc2 else []
    if len(matches1) <= formula_index:
        raise ValueError(f"Expected formula index {formula_index} in skill {skill_id}: {desc1}")

    f1_match = matches1[formula_index]
    shown_base1 = float(f1_match.group(1).replace(",", ""))
    shown_pct1 = float(f1_match.group(2).replace(",", ""))

    shown_base2 = None
    shown_pct2 = None
    if len(matches2) > formula_index and mul2 is not None:
        f2_match = matches2[formula_index]
        shown_base2 = float(f2_match.group(1).replace(",", ""))
        shown_pct2 = float(f2_match.group(2).replace(",", ""))

    raw_base = recover_raw_int(shown_base1, mul1, shown_base2, mul2, skill_id=skill_id, field_label="base")
    raw_pct = recover_raw_int(shown_pct1, mul1, shown_pct2, mul2, skill_id=skill_id, field_label="scalingPct")

    return {
        "skillId": skill_id,
        "base": raw_base,
        "scalingPct": raw_pct,
        "parseSource": "detailed_tooltip",
        "description": display_desc,
    }


def extract_formula_from_entry(
    skill_id: int,
    scaling_stat: str,
    formula_index: int,
    parse_mode: str,
    d1_map: dict[int, dict[str, Any]],
    d2_map: dict[int, dict[str, Any]] | None,
    u1: dict[str, Any],
    u2: dict[str, Any] | None,
    fallback_ratio: float | None = None,
) -> dict[str, Any]:
    desc1 = clean_desc(d1_map.get(skill_id, {}).get("description", ""))
    desc2 = clean_desc(d2_map.get(skill_id, {}).get("description", "")) if d2_map else None
    if not desc1 and desc2:
        # Swap so desc1 is populated
        return extract_formula_from_desc(
            skill_id, desc2, None, scaling_stat, formula_index, parse_mode, u2 or u1, None, fallback_ratio=fallback_ratio
        )
    if not desc1:
        raise ValueError(f"Skill ID {skill_id} not found in dump")
    return extract_formula_from_desc(
        skill_id, desc1, desc2, scaling_stat, formula_index, parse_mode, u1, u2, fallback_ratio=fallback_ratio
    )


def extract_ranks_for_skill_id(
    skill_id: int,
    scaling_stat: str,
    formula_index: int,
    parse_mode: str,
    d1_map: dict[int, dict[str, Any]],
    d2_map: dict[int, dict[str, Any]] | None,
    u1: dict[str, Any],
    u2: dict[str, Any] | None,
    rank_map: dict[int, list[dict[str, Any]]] | None,
    u_ranks: dict[str, Any] | None,
    fallback_ratio: float | None = None,
) -> list[dict[str, Any]]:
    base_res = extract_formula_from_entry(
        skill_id, scaling_stat, formula_index, parse_mode, d1_map, d2_map, u1, u2, fallback_ratio=fallback_ratio
    )
    eff_fallback_ratio = float(base_res.get("scalingPct", 0)) / 100.0

    raw_ranks = rank_map.get(skill_id, []) if rank_map else []
    if not raw_ranks or u_ranks is None:
        return [{"rank": 1, "label": "Rank 1", "arg2": 0, **base_res}]

    parsed_ranks: list[dict[str, Any]] = []
    seen_formula_keys: set[tuple[Any, ...]] = set()
    d1_desc = base_res["description"]

    for r in raw_ranks:
        r_desc = clean_desc(r.get("description", ""))
        arg2 = int(r.get("arg2", 0))
        if not r_desc:
            continue
        if r_desc == d1_desc:
            res = dict(base_res)
        else:
            try:
                res = extract_formula_from_desc(
                    skill_id,
                    r_desc,
                    None,
                    scaling_stat,
                    formula_index,
                    parse_mode,
                    u_ranks,
                    None,
                    fallback_ratio=eff_fallback_ratio,
                )
            except ValueError:
                continue

        dedup_key = (
            res.get("base"),
            res.get("scalingPct"),
            res.get("bloodthirstPerStack"),
            res.get("backstabScalingPct"),
            res.get("description"),
        )
        if dedup_key in seen_formula_keys:
            continue
        seen_formula_keys.add(dedup_key)

        rank_num = len(parsed_ranks) + 1
        parsed_ranks.append(
            {
                "rank": rank_num,
                "label": f"Rank {rank_num}",
                "arg2": arg2,
                **res,
            }
        )

    if not parsed_ranks:
        return [{"rank": 1, "label": "Rank 1", "arg2": 0, **base_res}]
    return parsed_ranks


def build_sample_character(meta1: dict[str, Any]) -> dict[str, Any]:
    u = meta1["player"]["unitInfo"]
    return {
        "name": "Dumped Live Character (AA Classic 1.3.6)",
        "source": "ingame_addon",
        "level": 55,
        "gearScore": u.get("gear_score", 0),
        "maxHealth": meta1["player"].get("maxHealth", 0),
        "maxMana": meta1["player"].get("maxMana", 0),
        "attributes": {
            "str": u.get("str", 0),
            "agi": u.get("dex", 0),
            "sta": u.get("sta", 0),
            "int": u.get("int", 0),
            "spi": u.get("spi", 0),
        },
        "offense": {
            "meleeAttack": u.get("melee_dps", 0),
            "rangedAttack": u.get("ranged_dps", 0),
            "magicAttack": u.get("spell_dps", 0),
            "healingPower": u.get("heal_dps", 0),
            "meleeAccuracyPct": u.get("melee_success_rate", 100),
            "rangedAccuracyPct": u.get("ranged_success_rate", 100),
            "magicAccuracyPct": u.get("spell_success_rate", 100),
            "meleeCritRatePct": u.get("melee_critical_rate", 0),
            "rangedCritRatePct": u.get("ranged_critical_rate", 0),
            "magicCritRatePct": u.get("spell_critical_rate", 0),
            "healCritRatePct": u.get("heal_critical_rate", 0),
            "meleeCritBonusPct": u.get("melee_critical_bonus", 50),
            "rangedCritBonusPct": u.get("ranged_critical_bonus", 50),
            "magicCritBonusPct": u.get("spell_critical_bonus", 50),
            "healCritBonusPct": u.get("heal_critical_bonus", 50),
            "meleeSkillDamagePct": u.get("melee_damage_mul", 0),
            "rangedSkillDamagePct": u.get("ranged_damage_mul", 0),
            "magicSkillDamagePct": u.get("spell_damage_mul", 0),
            "healingPct": u.get("heal_mul", 0),
            "backstabMeleeDamagePct": u.get("backattack_melee_damage_mul", 0),
            "backstabRangedDamagePct": u.get("backattack_ranged_damage_mul", 0),
            "backstabMagicDamagePct": u.get("backattack_spell_damage_mul", 0),
            "defensePenetration": u.get("ignore_armor", 0),
            "magicDefensePenetration": u.get("magic_penetration", 0),
            "shieldDefPenRatePct": u.get("ignore_shield_chance", 0),
            "shieldDefPenPct": u.get("ignore_shield_bonus_mul", 0),
            "focus": u.get("bulls_eye", 0),
            "castTimePct": u.get("casting_time", 100),
        },
        "defense": {
            "physicalDefense": u.get("armor", 0),
            "magicDefense": u.get("magic_resist", 0),
            "shieldPhysicalDefense": 0,
            "toughness": u.get("battle_resist", 0),
            "resilience": u.get("flexibility", 0),
            "evasionPct": u.get("dodge_rate", 0),
            "parryPct": u.get("melee_parry_rate", 0),
            "rangedParryPct": u.get("ranged_parry_rate", 0),
            "blockPct": u.get("block_rate", 0),
            "receivedMeleeDrPct": abs(u.get("incoming_melee_damage_mul", 0)),
            "receivedRangedDrPct": abs(u.get("incoming_ranged_damage_mul", 0)),
            "receivedMagicDrPct": abs(u.get("incoming_spell_damage_mul", 0)),
            "fixedMeleeDr": abs(u.get("incoming_melee_damage_val", 0)),
            "fixedRangedDr": abs(u.get("incoming_ranged_damage_val", 0)),
            "fixedMagicDr": abs(u.get("incoming_spell_damage_val", 0)),
            "receivedHealingPct": u.get("incoming_heal_mul", 0),
        },
    }


def load_existing_tree_json(tree: str) -> dict[str, Any] | None:
    p = SKILLS_OUT_DIR / f"{tree}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def build_tree_skills(
    tree: str,
    tree_specs: list[dict[str, Any]],
    d1_map: dict[int, dict[str, Any]],
    d2_map: dict[int, dict[str, Any]] | None,
    u1: dict[str, Any],
    u2: dict[str, Any] | None,
    rank_map: dict[int, list[dict[str, Any]]] | None,
    u_ranks: dict[str, Any] | None,
    existing_tree: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    existing_by_id: dict[str, dict[str, Any]] = {}
    existing_order: list[str] = []
    if existing_tree:
        for s in existing_tree.get("skills", []):
            existing_by_id[s["id"]] = s
            existing_order.append(s["id"])

    catalog_ids = {spec["id"] for spec in tree_specs}
    rebuilt_by_id: dict[str, dict[str, Any]] = {}

    for spec in tree_specs:
        existing = existing_by_id.get(spec["id"])

        # Preserve live-calibrated buff skills (e.g. Ode to Recovery 5-rank live_buff_two_point)
        if existing and existing.get("parseSource") == "live_buff_two_point":
            rebuilt_by_id[spec["id"]] = existing
            continue

        parse_mode = spec.get("parseMode", "detailed_tooltip")
        formula_index = spec.get("formulaIndex", 0)
        scaling_stat = spec["scalingStat"]
        mul_stat = STAT_TO_MUL_KEY[scaling_stat]
        fallback_ratio = (float(existing["scalingPct"]) / 100.0) if (existing and "scalingPct" in existing) else None

        entry: dict[str, Any] = {
            "id": spec["id"],
            "skillset": tree,
            "name": spec["name"],
            "variant": spec.get("variant", "base"),
            "kind": spec["kind"],
            "damageType": spec["damageType"],
            "scalingStat": scaling_stat,
            "multiplierStat": mul_stat,
        }
        if "repeatCount" in spec:
            entry["repeatCount"] = spec["repeatCount"]
        if "flags" in spec:
            entry["flags"] = dict(spec["flags"])
        elif existing and "flags" in existing:
            entry["flags"] = dict(existing["flags"])

        if "hits" in spec:
            per_hit_ranks = []
            for h in spec["hits"]:
                h_ranks = extract_ranks_for_skill_id(
                    h["skillId"],
                    scaling_stat,
                    formula_index,
                    parse_mode,
                    d1_map,
                    d2_map,
                    u1,
                    u2,
                    rank_map,
                    u_ranks,
                    fallback_ratio=fallback_ratio,
                )
                for hr in h_ranks:
                    hr["label"] = h["label"]
                per_hit_ranks.append(h_ranks)

            max_ranks = max(len(hr) for hr in per_hit_ranks)
            combined_ranks = []
            for r_idx in range(max_ranks):
                hits_at_rank = []
                for h_ranks in per_hit_ranks:
                    chosen = h_ranks[min(r_idx, len(h_ranks) - 1)]
                    hits_at_rank.append(
                        {
                            "skillId": chosen["skillId"],
                            "label": chosen["label"],
                            "base": chosen["base"],
                            "scalingPct": chosen["scalingPct"],
                            "parseSource": chosen["parseSource"],
                            "description": chosen["description"],
                        }
                    )
                combined_ranks.append(
                    {
                        "rank": r_idx + 1,
                        "label": f"Rank {r_idx + 1}",
                        "hits": hits_at_rank,
                        "description": hits_at_rank[0]["description"],
                    }
                )

            max_rank_obj = combined_ranks[-1]
            entry["hits"] = max_rank_obj["hits"]
            entry["description"] = max_rank_obj["description"]
            entry["rankCount"] = len(combined_ranks)
            entry["ranks"] = combined_ranks
        elif parse_mode == "static_formula":
            base_val = int(spec.get("staticBase", 0))
            pct_val = float(spec.get("staticScalingPct", 0))
            raw_tip = (d2_map or {}).get(spec["skillId"]) or d1_map.get(spec["skillId"]) or {}
            desc = clean_desc(raw_tip.get("description", ""))
            rank_obj = {
                "rank": 1,
                "label": "Rank 1",
                "skillId": spec["skillId"],
                "base": base_val,
                "scalingPct": pct_val,
                "parseSource": "static_formula",
                "description": desc,
            }
            entry.update(
                {
                    "skillId": spec["skillId"],
                    "base": base_val,
                    "scalingPct": pct_val,
                    "parseSource": "static_formula",
                    "description": desc,
                    "rankCount": 1,
                    "ranks": [rank_obj],
                }
            )
        else:
            parsed_ranks = extract_ranks_for_skill_id(
                spec["skillId"],
                scaling_stat,
                formula_index,
                parse_mode,
                d1_map,
                d2_map,
                u1,
                u2,
                rank_map,
                u_ranks,
                fallback_ratio=fallback_ratio,
            )
            max_rank_obj = parsed_ranks[-1]
            for k in (
                "skillId",
                "base",
                "scalingPct",
                "parseSource",
                "description",
                "bloodthirstPerStack",
                "backstabScalingPct",
            ):
                if k in max_rank_obj:
                    entry[k] = max_rank_obj[k]
            entry["rankCount"] = len(parsed_ranks)
            entry["ranks"] = parsed_ranks

        # Preserve ALL enriched UI/engine metadata (cooldownSec, castTimeSec, icon,
        # abilityLevel, gcdSec, gcdNote, fireIntervalSec, rankCritHints, etc.)
        if existing:
            for k, v in existing.items():
                if k not in FORMULA_OWNED_KEYS and k not in entry:
                    entry[k] = v

        rebuilt_by_id[spec["id"]] = entry

    # Reconstruct skill list preserving existing order + any non-catalog variants (e.g. Enlightened previews)
    # Also sync Enlightened preview variants whose parent base skill updated (e.g. *_hollow -> parent id)
    final_skills: list[dict[str, Any]] = []
    emitted: set[str] = set()
    if existing_order:
        for sid in existing_order:
            if sid in rebuilt_by_id:
                final_skills.append(rebuilt_by_id[sid])
                emitted.add(sid)
            elif sid not in catalog_ids:
                extra_entry = json.loads(json.dumps(existing_by_id[sid]))
                if extra_entry.get("parseSource") == "enlightened_preview_1_3_6" and extra_entry.get("base", 0) > 0:
                    parent_id = re.sub(r"_hollow(?:_.*)?$", "", sid)
                    parent = rebuilt_by_id.get(parent_id)
                    if parent and "base" in parent and "scalingPct" in parent:
                        extra_entry["base"] = parent["base"]
                        extra_entry["scalingPct"] = parent["scalingPct"]
                        if extra_entry.get("ranks"):
                            extra_entry["ranks"][0]["base"] = parent["base"]
                            extra_entry["ranks"][0]["scalingPct"] = parent["scalingPct"]
                final_skills.append(extra_entry)
                emitted.add(sid)
    for spec in tree_specs:
        if spec["id"] not in emitted:
            final_skills.append(rebuilt_by_id[spec["id"]])
            emitted.add(spec["id"])
    return final_skills


def summarize_skill_value(skill: dict[str, Any] | None) -> str:
    if not skill:
        return "(missing)"
    if "hits" in skill and skill["hits"]:
        h0 = skill["hits"][0]
        return f"{skill['name']}: {h0['base']} + {h0['scalingPct']}% (hit 1)"
    return f"{skill['name']}: {skill.get('base')} + {skill.get('scalingPct')}%"


def print_status() -> None:
    print(f"{'Skillset':<12} {'Per-Tree File':<36} {'JSON Lv':<10} {'Current JSON Sample'}")
    print("-" * 108)
    for tree in SKILLSET_ORDER:
        p_naked = ADDON_DIR / f"skill_dump_{tree}.txt"
        p_geared = ADDON_DIR / f"skill_dump_{tree}_geared.txt"
        if p_naked.exists():
            meta, smap = parse_skill_dump(p_naked)
            clean, issues = is_clean_naked_meta(meta)
            lv = meta.get("skillsetLevel")
            lv_tag = f"Lv{lv}" if lv is not None else "Lv?"
            g_tag = " +geared" if p_geared.exists() else ""
            file_str = (
                f"CLEAN {lv_tag} ({len(smap)} IDs){g_tag}"
                if clean
                else f"WARN {lv_tag}({','.join(issues)}){g_tag}"
            )
        else:
            file_str = "(none)"

        existing = load_existing_tree_json(tree)
        sample_str = "(no json)"
        json_lv = "-"
        if existing:
            sample_id = SAMPLE_SKILL_IDS.get(tree)
            skill = next((s for s in existing.get("skills", []) if s["id"] == sample_id), None)
            src = existing.get("dumpSource", "legacy")
            ex_lv = existing.get("skillsetLevel")
            if ex_lv is not None:
                json_lv = f"Lv{ex_lv}" + ("" if ex_lv >= 55 else " (!)")
            sample_str = f"[{src}] {summarize_skill_value(skill)}"

        print(f"{tree:<12} {file_str:<36} {json_lv:<10} {sample_str}")


def rebuild_index(game_version: str, has_rank_dump: bool) -> None:
    index_entries = []
    multi_rank_count = 0
    total_rank_entries = 0
    for tree in SKILLSET_ORDER:
        tree_file = SKILLS_OUT_DIR / f"{tree}.json"
        if not tree_file.exists():
            continue
        data = json.loads(tree_file.read_text(encoding="utf-8"))
        skills = data.get("skills", [])
        for s in skills:
            rc = int(s.get("rankCount", 1))
            if rc > 1:
                multi_rank_count += 1
            total_rank_entries += rc
        entry: dict[str, Any] = {
            "skillset": tree,
            "file": f"{tree}.json",
            "skillCount": len(skills),
        }
        if "dumpSource" in data:
            entry["dumpSource"] = data["dumpSource"]
        if "skillsetLevel" in data:
            entry["skillsetLevel"] = data["skillsetLevel"]
        if "isMaxLevel" in data:
            entry["isMaxLevel"] = data["isMaxLevel"]
        index_entries.append(entry)

    # Preserve non-class equipment active/proc skills file if present
    equip_file = SKILLS_OUT_DIR / "equipment.json"
    if equip_file.exists():
        eq_data = json.loads(equip_file.read_text(encoding="utf-8"))
        eq_skills = eq_data.get("skills", [])
        for s in eq_skills:
            rc = int(s.get("rankCount", 1))
            if rc > 1:
                multi_rank_count += 1
            total_rank_entries += rc
        index_entries.append({
            "skillset": "equipment",
            "label": eq_data.get("label", "Equip Effects"),
            "file": "equipment.json",
            "skillCount": len(eq_skills),
            "dumpSource": eq_data.get("dumpSource", "item_special_effects + set_bonus_procs"),
            "skillsetLevel": eq_data.get("skillsetLevel", 55),
            "isMaxLevel": True,
        })

    (SKILLS_OUT_DIR / "index.json").write_text(
        json.dumps(
            {
                "gameVersion": game_version,
                "hasRankDump": has_rank_dump,
                "multiRankSkillCount": multi_rank_count,
                "totalRankEntries": total_rank_entries,
                "skillsets": index_entries,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse AA Classic Skill Dumper files into js/data/.")
    parser.add_argument("--status", action="store_true", help="Show per-skillset dump and JSON status without writing.")
    parser.add_argument(
        "--trees",
        type=str,
        default="",
        help="Comma-separated list of skillsets to update (e.g. battlerage,sorcery). Other trees are preserved.",
    )
    parser.add_argument(
        "--legacy",
        action="store_true",
        help="Force full legacy re-parse from addon/skill_dump_1.txt + skill_dump_2.txt across all 10 skillsets.",
    )
    parser.add_argument(
        "--level",
        type=int,
        default=None,
        help="Optional override for skillsetLevel (1-55) when importing trees without a saved level.",
    )
    parser.add_argument(
        "--allow-downgrade",
        action="store_true",
        help="Allow a <55 dump to overwrite an existing Lv 55 skillset JSON.",
    )
    args = parser.parse_args()

    if args.status:
        print_status()
        return

    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    SKILLS_OUT_DIR.mkdir(parents=True, exist_ok=True)

    specs_by_tree: dict[str, list[dict[str, Any]]] = {t: [] for t in SKILLSET_ORDER}
    for spec in catalog["skills"]:
        specs_by_tree.setdefault(spec["skillset"], []).append(spec)

    ranks_data = parse_skill_ranks_dump(ADDON_DIR / "skill_ranks.txt")
    rank_map = ranks_data[1] if ranks_data else None
    u_ranks = ranks_data[0]["player"]["unitInfo"] if ranks_data else None

    per_tree_files = {t: ADDON_DIR / f"skill_dump_{t}.txt" for t in SKILLSET_ORDER if (ADDON_DIR / f"skill_dump_{t}.txt").exists()}

    # Determine which skillsets to update
    if args.trees.strip():
        requested = [t.strip().lower() for t in args.trees.split(",") if t.strip()]
        invalid = [t for t in requested if t not in specs_by_tree]
        if invalid:
            raise SystemExit(f"Unknown skillset(s): {', '.join(invalid)}. Valid: {', '.join(SKILLSET_ORDER)}")
        target_trees = requested
    elif (not args.legacy) and per_tree_files:
        target_trees = [t for t in SKILLSET_ORDER if t in per_tree_files]
    else:
        target_trees = list(SKILLSET_ORDER)

    # Load legacy dumps lazily only if needed
    legacy_loaded = False
    meta1: dict[str, Any] | None = None
    meta2: dict[str, Any] | None = None
    d1_legacy: dict[int, dict[str, Any]] | None = None
    d2_legacy: dict[int, dict[str, Any]] | None = None

    def ensure_legacy() -> tuple[dict[str, Any], dict[int, dict[str, Any]], dict[str, Any] | None, dict[int, dict[str, Any]] | None]:
        nonlocal legacy_loaded, meta1, meta2, d1_legacy, d2_legacy
        if not legacy_loaded:
            p1 = ADDON_DIR / "skill_dump_1.txt"
            p2 = ADDON_DIR / "skill_dump_2.txt"
            if p1.exists():
                meta1, d1_legacy = parse_skill_dump(p1)
            if p2.exists():
                meta2, d2_legacy = parse_skill_dump(p2)
            legacy_loaded = True
        if meta1 is None or d1_legacy is None:
            raise FileNotFoundError(f"Legacy dump {ADDON_DIR / 'skill_dump_1.txt'} not found")
        return meta1, d1_legacy, meta2, d2_legacy

    updated_trees: list[str] = []
    skipped_trees: list[str] = []
    for tree in target_trees:
        existing_tree = load_existing_tree_json(tree)
        p_naked = ADDON_DIR / f"skill_dump_{tree}.txt"
        p_geared = ADDON_DIR / f"skill_dump_{tree}_geared.txt"

        skillset_level: int | None = args.level
        if (not args.legacy) and p_naked.exists():
            m_naked, map_naked = parse_skill_dump(p_naked)
            clean, issues = is_clean_naked_meta(m_naked)
            u_naked = m_naked["player"]["unitInfo"]
            if skillset_level is None and m_naked.get("skillsetLevel") is not None:
                skillset_level = int(m_naked["skillsetLevel"])

            if p_geared.exists():
                m_geared, map_geared = parse_skill_dump(p_geared)
                u_geared = m_geared["player"]["unitInfo"]
                d1_map, u1 = map_geared, u_geared
                d2_map, u2 = map_naked, u_naked
                dump_source = f"per_skillset_pair ({p_naked.name} + {p_geared.name})"
            else:
                d1_map, u1 = map_naked, u_naked
                d2_map, u2 = None, None
                dump_source = f"per_skillset_naked ({p_naked.name})"

            existing_lv = existing_tree.get("skillsetLevel") if existing_tree else None
            if (
                existing_lv is not None
                and skillset_level is not None
                and skillset_level < existing_lv
                and not args.allow_downgrade
            ):
                print(
                    f"[{tree}] SKIPPED: dump is Lv{skillset_level} < existing Lv{existing_lv} "
                    f"(pass --allow-downgrade to overwrite)"
                )
                skipped_trees.append(tree)
                continue

            lv_note = f"Lv{skillset_level}" if skillset_level is not None else "Lv?"
            if skillset_level is not None and skillset_level < 55:
                lv_note += " (NOT MAX - re-dump at Lv55!)"
            status_note = "CLEAN naked" if clean else f"WARNING: {', '.join(issues)}"
            print(f"[{tree}] Merging {dump_source} [{lv_note} | {status_note}]")
        else:
            m1, ld1, m2, ld2 = ensure_legacy()
            d1_map, u1 = ld1, m1["player"]["unitInfo"]
            d2_map, u2 = ld2, (m2["player"]["unitInfo"] if m2 else None)
            dump_source = "legacy_dual_dump"
            print(f"[{tree}] Updating from legacy skill_dump_1.txt + skill_dump_2.txt")

        skills = build_tree_skills(
            tree,
            specs_by_tree[tree],
            d1_map,
            d2_map,
            u1,
            u2,
            rank_map,
            u_ranks,
            existing_tree,
        )

        tree_payload: dict[str, Any] = {
            "skillset": tree,
            "gameVersion": catalog["gameVersion"],
            "dumpSource": dump_source,
        }
        if skillset_level is not None:
            tree_payload["skillsetLevel"] = skillset_level
            tree_payload["isMaxLevel"] = skillset_level >= 55
        tree_payload["skillCount"] = len(skills)
        tree_payload["skills"] = skills
        (SKILLS_OUT_DIR / f"{tree}.json").write_text(json.dumps(tree_payload, indent=2) + "\n", encoding="utf-8")
        updated_trees.append(tree)
        sample_id = SAMPLE_SKILL_IDS.get(tree)
        sample_skill = next((s for s in skills if s["id"] == sample_id), None)
        print(f"  -> Saved {len(skills)} skills | {summarize_skill_value(sample_skill)}")

    rebuild_index(catalog["gameVersion"], rank_map is not None)
    print(f"\nDone! Updated {len(updated_trees)} skillset(s): {', '.join(updated_trees)}")


if __name__ == "__main__":
    main()
