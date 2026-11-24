#!/usr/bin/env python3
"""
Enrich js/data/skills/*.json with:
1. Public AA Classic 1.3.6 metadata (abilityLevel, cooldownSec, castTimeSec, icon,
   and hidden rank-tooltip crit bonuses) from tools/aaclassic_meta.json.
2. Live-verified secondary ranks captured from the user's second in-game dump
   (Vitalism & Auramancy skills where two distinct live ranks were measured).

Non-destructive: preserves all exact Detailed Tooltip formulas in js/data/skills/*.json.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = ROOT / "js" / "data" / "skills"
META_PATH = ROOT / "tools" / "aaclassic_meta.json"

# Secondary live ranks verified directly from the user's alt dump (2-point linear solve
# against skill_dump_1.txt heal_dps=208.034/mul=5% and skill_dump_2.txt heal_dps=42.2/mul=0%).
LIVE_ALT_RANKS: dict[str, dict[str, Any]] = {
    "vitalism_holy_bolt": {
        "base": 906,
        "scalingPct": 90,
        "label": "Lower Rank (Live Alt)",
        "source": "live_alt_dump",
    },
    "vitalism_antithesis_heal": {
        "base": 421,
        "scalingPct": 440,
        "label": "Lower Rank (Live Alt)",
        "source": "live_alt_dump",
    },
    "vitalism_antithesis_damage": {
        "base": 1320,
        "scalingPct": 240,
        "label": "Lower Rank (Live Alt)",
        "source": "live_alt_dump",
    },
    "vitalism_antithesis_mist_heal": {
        "base": 421,
        "scalingPct": 440,
        "label": "Lower Rank (Live Alt)",
        "source": "live_alt_dump",
    },
    "vitalism_antithesis_wave_heal": {
        "base": 264,
        "scalingPct": 320,
        "label": "Lower Rank (Live Alt)",
        "source": "live_alt_dump",
    },
    "vitalism_antithesis_wave_damage": {
        "base": 792,
        "scalingPct": 160,
        "label": "Lower Rank (Live Alt)",
        "source": "live_alt_dump",
    },
    "vitalism_resurgence": {
        "base": 617,
        "scalingPct": 300,
        "label": "Lower Rank (Live Alt)",
        "source": "live_alt_dump",
    },
    "vitalism_skewer": {
        "base": 1461,
        "scalingPct": 263,
        "label": "Lower Rank (Live Alt)",
        "source": "live_alt_dump",
    },
    "vitalism_mend": {
        "base": 792,
        "scalingPct": 450,
        "label": "Lower Rank (Live Alt)",
        "source": "live_alt_dump",
    },
    "auramancy_vicious_implosion": {
        "base": 792,
        "scalingPct": 200,
        "label": "Lower Rank (Live Alt)",
        "source": "live_alt_dump",
    },
}

CRIT_DMG_RE = re.compile(r"Critical Damage\s*\+?\|c[0-9A-Fa-f]{8}([0-9]+)%\|r", re.I)
BACKSTAB_CRIT_RE = re.compile(r"Backstabbing increases Melee Critical Rate\s*\|c[0-9A-Fa-f]{8}\+?([0-9]+)%\|r", re.I)
EXEC_CRIT_RE = re.compile(r"Melee Critical(?: Hit)? Rate\s*\+?\|c[0-9A-Fa-f]{8}\+?([0-9]+)%\|r\s*when attacking targets", re.I)


def extract_rank_crit_hints(meta_entry: dict[str, Any]) -> list[dict[str, Any]]:
    hints: list[dict[str, Any]] = []
    for b in meta_entry.get("appliedBuffs", []):
        if b.get("kind") != "hidden":
            continue
        desc = b.get("description") or ""
        m_cd = CRIT_DMG_RE.search(desc)
        m_bs = BACKSTAB_CRIT_RE.search(desc)
        m_ex = EXEC_CRIT_RE.search(desc)
        if m_cd or m_bs or m_ex:
            h: dict[str, Any] = {"rank": len(hints) + 1}
            if m_cd:
                h["critDamageBonusPct"] = int(m_cd.group(1))
            if m_bs:
                h["backstabCritRateBonusPct"] = int(m_bs.group(1))
            if m_ex:
                h["executeCritRateBonusPct"] = int(m_ex.group(1))
            hints.append(h)
    return hints


def main() -> None:
    meta_all = json.loads(META_PATH.read_text(encoding="utf-8"))["skills"]
    idx = json.loads((SKILLS_DIR / "index.json").read_text(encoding="utf-8"))

    total_skills = 0
    multi_rank_skills = 0
    total_ranks = 0
    enriched_count = 0

    for entry in idx["skillsets"]:
        tree_path = SKILLS_DIR / entry["file"]
        tree_data = json.loads(tree_path.read_text(encoding="utf-8"))

        for skill in tree_data["skills"]:
            total_skills += 1
            sid = skill.get("skillId")
            if sid is None and skill.get("hits"):
                sid = skill["hits"][0].get("skillId")

            if sid is not None and str(sid) in meta_all:
                m = meta_all[str(sid)]
                skill["abilityLevel"] = m.get("abilityLevel")
                skill["cooldownSec"] = round((m.get("cooldownMs") or 0) / 1000.0, 2)
                skill["castTimeSec"] = round((m.get("castTimeMs") or 0) / 1000.0, 2)
                if m.get("icon"):
                    skill["icon"] = m["icon"]
                hints = extract_rank_crit_hints(m)
                if len(hints) >= 2:
                    skill["rankCritHints"] = hints
                enriched_count += 1

            # Merge live-verified secondary rank for Vitalism & Auramancy skills
            alt = LIVE_ALT_RANKS.get(skill["id"])
            if alt:
                existing_ranks = skill.get("ranks") or []
                # Keep the Lv 55 Healer rank as the highest rank (Rank 2 / Lv 55 Max)
                lv55_rank = existing_ranks[-1] if existing_ranks else {
                    "skillId": skill.get("skillId"),
                    "base": skill.get("base", 0),
                    "scalingPct": skill.get("scalingPct", 0),
                    "parseSource": skill.get("parseSource", "detailed_tooltip"),
                    "description": skill.get("description", ""),
                }
                skill["ranks"] = [
                    {
                        "rank": 1,
                        "label": "Rank 1 (Alt Dump)",
                        "skillId": skill.get("skillId"),
                        "base": alt["base"],
                        "scalingPct": alt["scalingPct"],
                        "parseSource": alt["source"],
                        "description": f"Live AA Classic alt dump: {alt['base']} + {alt['scalingPct']}% {skill['scalingStat']}.",
                    },
                    {
                        **lv55_rank,
                        "rank": 2,
                        "label": "Max (Lv 55 Dump)",
                    },
                ]
                skill["rankCount"] = 2
            else:
                if not skill.get("ranks"):
                    skill["rankCount"] = 1
                else:
                    skill["rankCount"] = len(skill["ranks"])

            if skill["rankCount"] > 1:
                multi_rank_skills += 1
            total_ranks += skill["rankCount"]

        tree_path.write_text(json.dumps(tree_data, indent=2) + "\n", encoding="utf-8")

    idx["hasMetadata"] = True
    idx["metadataSource"] = "https://aa-classic.com/data/skills/<id>.json"
    idx["multiRankSkillCount"] = multi_rank_skills
    idx["totalRankEntries"] = total_ranks
    (SKILLS_DIR / "index.json").write_text(json.dumps(idx, indent=2) + "\n", encoding="utf-8")

    print(
        f"Enriched {enriched_count}/{total_skills} skills with AA Classic metadata; "
        f"{multi_rank_skills} multi-rank skills ({total_ranks} total rank entries)."
    )


if __name__ == "__main__":
    main()
