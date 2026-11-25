"""
Generate `js/data/gear_catalog/item_special_effects.json` from the audited AA Classic
item database dump (`aac_gear_audit.json`), attaching structured combat engine hooks
for all stat/damage/healing/cast-time/buff-rank/rotation-affecting items.
"""
import json
import re
from pathlib import Path

AUDIT_PATH = Path(
    r"C:\Users\abcde\.gemini\antigravity\brain\3989cf34-b93d-470a-bb19-1b5242a95a15\scratch\aac_gear_audit.json"
)
OUT_PATH = Path("js/data/gear_catalog/item_special_effects.json")

COLOR_RE = re.compile(r"\|c[0-9a-fA-F]{8}|\|[a-zA-Z0-9#_-]+;|\|r")
PLACEHOLDER_RE = re.compile(r"#\{[^}]+\}")
DIM_DESTROYER_RE = re.compile(
    r"(?:Activates|Grants(?: the)?)\s+Dimensional Destroyer(?:\s+buff)?\s+in\s+(?:Lv)?50\+?\s*(?:level\s+)?dungeons\.?",
    re.I,
)

SKIP_PHRASES = (
    "trade pack",
    "taming skills enabled",
    "proficiencies +",
    "become enlightened, become kapiros",
    "whispers in your ear",
    "enchant the lost ayanad",
    "explosive kegs",
    "breathe in water",
    "grants....",
    "health to your spouse",
    "protects against dragon attacks",
)

# Structured engine-factored hooks (keyed by item ID)
ENGINE_HOOKS = {
    # --- T7 Obsidian combat hooks ---
    40574: {"dropBackExtraDurationSec": 0.5, "shortText": "Basic Drop Back +0.5s duration"},
    40575: {"dropBackExtraDurationSec": 0.5, "shortText": "Basic Drop Back +0.5s duration"},
    40583: {"dissonanceNoDebuff": True, "shortText": "Basic Dissonance: Dmg only (no debuff)"},
    40585: {"dissonanceNoDebuff": True, "shortText": "Basic Dissonance: Dmg only (no debuff)"},
    40594: {"resurgenceStackMaxSec": 35, "shortText": "Basic Resurgence stacks up to 35s"},
    40595: {"resurgenceStackMaxSec": 35, "shortText": "Basic Resurgence stacks up to 35s"},
    40596: {"resurgenceStackMaxSec": 35, "shortText": "Basic Resurgence stacks up to 35s"},
    40597: {"resurgenceStackMaxSec": 35, "shortText": "Basic Resurgence stacks up to 35s"},
    40610: {
        "shortText": "Basic Gods' Whip +8% Dmg",
        "skillBonuses": [{"skillId": "sorcery_gods_whip", "variant": "base", "kind": "damagePct", "value": 8}],
    },
    40614: {"startlingStrainImmediateCharm": True, "shortText": "Basic Startling Strain: Instant Charm"},
    40616: {"startlingStrainImmediateCharm": True, "shortText": "Basic Startling Strain: Instant Charm"},
    40618: {"stalkersMarkDefShred": 390, "shortText": "Basic Stalker's Mark: -390 PDef"},
    40620: {"stalkersMarkDefShred": 390, "shortText": "Basic Stalker's Mark: -390 PDef"},

    # --- T4-T6 Obsidian v2 combat hooks (same procs as T7) ---
    35536: {"dissonanceNoDebuff": True, "shortText": "Basic Dissonance: Dmg only (no debuff)"},
    35548: {"dissonanceNoDebuff": True, "shortText": "Basic Dissonance: Dmg only (no debuff)"},
    35560: {"dissonanceNoDebuff": True, "shortText": "Basic Dissonance: Dmg only (no debuff)"},
    9001122: {"dissonanceNoDebuff": True, "shortText": "Basic Dissonance: Dmg only (no debuff)"},
    35538: {"resurgenceStackMaxSec": 35, "shortText": "Basic Resurgence stacks up to 35s"},
    35550: {"resurgenceStackMaxSec": 35, "shortText": "Basic Resurgence stacks up to 35s"},
    35562: {"resurgenceStackMaxSec": 35, "shortText": "Basic Resurgence stacks up to 35s"},
    9001126: {"resurgenceStackMaxSec": 35, "shortText": "Basic Resurgence stacks up to 35s"},
    35543: {"startlingStrainImmediateCharm": True, "shortText": "Basic Startling Strain: Instant Charm"},
    35555: {"startlingStrainImmediateCharm": True, "shortText": "Basic Startling Strain: Instant Charm"},
    35567: {"startlingStrainImmediateCharm": True, "shortText": "Basic Startling Strain: Instant Charm"},
    9001138: {"startlingStrainImmediateCharm": True, "shortText": "Basic Startling Strain: Instant Charm"},

    # --- Warrior Medal Instruments (+1 Skill Rank) ---
    35570: {
        "shortText": "Basic Battle Focus +1 Rank (+5% M.CD, +2% Parry)",
        "buffRankBonus": {
            "modifierId": "battle_focus",
            "addOffense": {"meleeCritBonusPct": 5},
            "addDefense": {"parryPct": 2},
            "note": "Anthem of Battlerage (+1 Battle Focus): +5% Melee Crit Dmg, +2% Parry",
        },
    },
    35571: {
        "shortText": "Basic Freerunner +1 Rank (+20 AGI)",
        "buffRankBonus": {
            "modifierId": "freerunner",
            "addAttributes": {"agi": 20},
            "note": "Croon of Shadowplay (+1 Freerunner): +20 AGI",
        },
    },
    35574: {
        "shortText": "Basic Health Lift +1 Rank (+484 Max HP)",
        "buffRankBonus": {
            "modifierId": "health_lift",
            "addMaxHealth": 484,
            "note": "Ballad of Auramancy (+1 Health Lift): +484 Max HP",
        },
    },
    35575: {
        "shortText": "Basic Insulating Lens +1 Rank (+100 PDef)",
        "buffRankBonus": {
            "modifierId": "insulating_lens",
            "addDefense": {"physicalDefense": 100},
            "note": "Fantasia of Sorcery (+1 Insulating Lens): +100 Phys Def",
        },
    },
    35578: {
        "shortText": "Basic Aranzeb's Boon +1 Rank (+5 All Stats)",
        "buffRankBonus": {
            "modifierId": "aranzebs_boon",
            "addAttributes": {"str": 5, "agi": 5, "sta": 5, "int": 5, "spi": 5},
            "note": "Ode of Vitalism (+1 Aranzeb's Boon): +5 All Stats",
        },
    },

    # --- Veiled Terror GreatAxes (+5% / +10% to 4 core melee skills) ---
    26514: {
        "shortText": "Triple Slash/Prec. Strike/Rapid/Smite +5% Dmg",
        "skillBonuses": [
            {"skillId": "battlerage_triple_slash", "variant": "base", "kind": "damagePct", "value": 5},
            {"skillId": "battlerage_precision_strike", "variant": "base", "kind": "damagePct", "value": 5},
            {"skillId": "shadowplay_rapid_strike", "variant": "base", "kind": "damagePct", "value": 5},
            {"skillId": "shadowplay_shadowsmite", "variant": "base", "kind": "damagePct", "value": 5},
        ],
    },
    9001463: {
        "shortText": "Triple Slash/Prec. Strike/Rapid/Smite +5% Dmg",
        "skillBonuses": [
            {"skillId": "battlerage_triple_slash", "variant": "base", "kind": "damagePct", "value": 5},
            {"skillId": "battlerage_precision_strike", "variant": "base", "kind": "damagePct", "value": 5},
            {"skillId": "shadowplay_rapid_strike", "variant": "base", "kind": "damagePct", "value": 5},
            {"skillId": "shadowplay_shadowsmite", "variant": "base", "kind": "damagePct", "value": 5},
        ],
    },
    9001464: {
        "shortText": "Triple Slash/Prec. Strike/Rapid/Smite +10% Dmg",
        "skillBonuses": [
            {"skillId": "battlerage_triple_slash", "variant": "base", "kind": "damagePct", "value": 10},
            {"skillId": "battlerage_precision_strike", "variant": "base", "kind": "damagePct", "value": 10},
            {"skillId": "shadowplay_rapid_strike", "variant": "base", "kind": "damagePct", "value": 10},
            {"skillId": "shadowplay_shadowsmite", "variant": "base", "kind": "damagePct", "value": 10},
        ],
    },

    # --- Hermit's Glare (Instant Basic Sunder Earth) ---
    35745: {
        "shortText": "Basic Sunder Earth: Instant Cast",
        "skillBonuses": [{"skillId": "battlerage_sunder_earth", "variant": "base", "kind": "removeCastTime", "value": 1}],
    },
}

# Auroria Armor combat-affecting pairs
AURORIA_HOOKS = [
    ([27011, 39283], "Basic Endless Arrows +10% Dmg", [{"skillId": "archery_endless_arrows", "variant": "base", "kind": "damagePct", "value": 10}]),
    ([27008, 39282], "Basic Rapid Strike +10% Dmg", [{"skillId": "shadowplay_rapid_strike", "variant": "base", "kind": "damagePct", "value": 10}]),
    ([27015, 39256], "Basic Charged Bolt +10% Dmg", [{"skillId": "archery_charged_bolt", "variant": "base", "kind": "damagePct", "value": 10}]),
    ([26990, 39269], "Basic Flamebolt +10% Dmg", [{"skillId": "sorcery_flamebolt", "variant": "base", "kind": "damagePct", "value": 10}]),
    ([26978, 39265], "Basic Arc Lightning -10% Cast Time", [{"skillId": "sorcery_arc_lightning", "variant": "base", "kind": "castTimePct", "value": -10}]),
    ([26981, 39266], "Basic Freezing Arrow -10% Cast Time", [{"skillId": "sorcery_freezing_arrow", "variant": "base", "kind": "castTimePct", "value": -10}]),
    ([26985, 39309], "Basic Fervent Healing +7% Heal", [{"skillId": "vitalism_fervent_healing", "variant": "base", "kind": "healingPct", "value": 7}]),
    (
        [26991, 39311],
        "Antithesis -10% Cast Time",
        [
            {"skillId": "vitalism_antithesis_heal", "variant": "base", "kind": "castTimePct", "value": -10},
            {"skillId": "vitalism_antithesis_damage", "variant": "base", "kind": "castTimePct", "value": -10},
        ],
    ),
    ([26982, 39308], "Basic Mend -1.0s Cast Time", [{"skillId": "vitalism_mend", "variant": "base", "kind": "castTimeSec", "value": -1.0}]),
    ([26994, 39312], "Basic Skewer +10% Dmg", [{"skillId": "vitalism_skewer", "variant": "base", "kind": "damagePct", "value": 10}]),
    ([27034, 39185], "Basic Precision Strike +8% Dmg", [{"skillId": "battlerage_precision_strike", "variant": "base", "kind": "damagePct", "value": 8}]),
    ([39290, 39297], "Basic Critical Discord +8% Dmg", [{"skillId": "songcraft_critical_discord", "variant": "base", "kind": "damagePct", "value": 8}]),
    ([39287, 39294], "Basic Rhythmic Renewal -1.0s Cast", [{"skillId": "songcraft_rhythmic_renewal", "variant": "base", "kind": "castTimeSec", "value": -1.0}]),
    ([26992, 39241], "Basic Mana Stars +10% Dmg", [{"skillId": "occultism_mana_stars", "variant": "base", "kind": "damagePct", "value": 10}]),
    ([27013, 39199], "Basic Dahuta's Breath +15% Dmg", [{"skillId": "witchcraft_dahutas_breath", "variant": "base", "kind": "damagePct", "value": 15}]),
    ([27020, 39209], "Basic Boastful Roar +10% Dmg", [{"skillId": "defense_boastful_roar", "variant": "base", "kind": "damagePct", "value": 10}]),
]
for ids, short_txt, bonuses in AURORIA_HOOKS:
    for iid in ids:
        ENGINE_HOOKS[iid] = {"shortText": short_txt, "skillBonuses": bonuses}

SHORT_TEXT_OVERRIDES = {
    35572: "Basic Intensity +1 Rank",
    35573: "Basic Bull Rush +1 Rank",
    35576: "Basic Retribution +1 Rank",
    35577: "Basic Insidious Whisper +1 Rank",
    35579: "Basic Hummingbird Ditty +1 Rank",
    28802: "Proc: -PDef & -MDef (stacks 5x)",
    9001915: "Proc: -PDef & -MDef (stacks 5x)",
    39146: "Proc: -175 PDef & -MDef (stacks 4x)",
    9001916: "Proc: -175 PDef & -MDef (stacks 4x)",
    33154: "Use: +70% All Crit Rate (2s)",
    9001917: "Use: +70% All Crit Rate (2s)",
    39055: "Use: +35% All Crit Rate (2s)",
    9001923: "Use: +35% All Crit Rate (2s)",
}


def clean_text(raw):
    if not raw:
        return ""
    s = COLOR_RE.sub("", str(raw))
    # Fix placeholder artifacts cleanly
    s = re.sub(r"#\{buff_total_min_heal\}-#\{buff_total_max_heal\}", "periodic", s)
    s = re.sub(r"#\{buff_total_min_damage\}-#\{buff_total_max_damage\}", "continuous", s)
    s = re.sub(r"#\{min_damage\}-#\{max_damage\}", "AoE", s)
    s = re.sub(r"for\s+#\{duration\}", "temporarily", s)
    s = re.sub(r"for\s+#\{buff_duration\}", "", s)
    s = re.sub(r"\+#\{buff_ua_melee_speed_mul\}", "(Attack Speed boost)", s)
    s = PLACEHOLDER_RE.sub("", s)
    s = re.sub(r"\b(\d+)\s*-\s*(\d+)\b", r"\1–\2", s)
    s = re.sub(r"\s*([.,;:])", r"\1", s)
    s = re.sub(r"\.(?=[A-Z])", ". ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def make_short(text, label, max_len=54):
    t = re.sub(r"^(?:Use|Proc|Equip):\s*", "", text).strip()
    first = re.split(r"(?<=[.!])\s+", t)[0]
    first = re.sub(
        r"\s*\((?:Archery|Battlerage|Defense|Auramancy|Sorcery|Occultism|Witchcraft|Vitalism|Songcraft|Shadowplay)\)",
        "",
        first,
    )
    first = re.sub(r"^Increases the damage of\s+", "", first)
    first = re.sub(r"^Increases the rank of\s+", "", first)
    first = re.sub(r"^Increases the duration of\s+", "", first)
    first = re.sub(r"^Decreases the cooldown of\s+", "CD ", first)
    first = re.sub(r"^Decreases the Cast Time of\s+", "Cast ", first)
    first = re.sub(r"^Increases\s+", "", first)
    first = re.sub(r"^Decreases\s+", "", first)
    first = re.sub(r"\.$", "", first).strip()
    prefix = "Use: " if label == "Use Effect" else ("Proc: " if label == "Proc Effect" else "")
    full = prefix + first
    if len(full) <= max_len:
        return full
    return full[: max_len - 1].rstrip(" ,;:-") + "…"


def main():
    audit = json.load(open(AUDIT_PATH, encoding="utf-8"))
    out = {}
    stats = {"total": 0, "factored": 0, "t7": 0, "instruments": 0, "auroria": 0}

    for x in audit["with_effects"]:
        iid = int(x["id"])
        typ = x.get("type") or ""
        name = x.get("name") or ""
        if typ == "Glider" or "dawnsdrop" in name.lower():
            continue

        be_raw = clean_text(x.get("buff_effect"))
        pr_raw = clean_text(x.get("proc_desc"))
        us_raw = clean_text(x.get("skill_desc"))

        be_clean = DIM_DESTROYER_RE.sub("", be_raw).strip()
        if any(p in be_clean.lower() for p in SKIP_PHRASES):
            be_clean = ""
        if any(p in us_raw.lower() for p in SKIP_PHRASES):
            us_raw = ""

        has_local = bool(x.get("has_local_eq") or x.get("has_local_buff") or x.get("has_local_mod"))
        keep_be = ""
        if be_clean:
            if not has_local or iid in ENGINE_HOOKS:
                keep_be = be_clean
            elif any(
                k in be_clean.lower()
                for k in (
                    "interruption",
                    "stealth",
                    "debuffed with stun",
                    "for allies",
                    "rank of",
                    "removes the cast time",
                    "adds +",
                    "critical discord",
                    "converts ",
                    "swimming speed",
                )
            ):
                keep_be = be_clean

        # Avoid duplicating plain T7 text if it's already in proc_desc
        is_t7 = 40572 <= iid <= 40625
        if is_t7:
            keep_be = ""
        elif has_local and "hero cloak" in name.lower():
            keep_be = re.sub(r"^Increases Stamina \+100\.\s*", "", keep_be).strip()

        parts = []
        kinds = []
        if keep_be:
            parts.append(keep_be)
            kinds.append("equip")
        if pr_raw:
            parts.append(("Proc: " if parts else "") + pr_raw)
            kinds.append("proc")
        if us_raw:
            parts.append(("Use: " if parts else "") + us_raw)
            kinds.append("use")

        if not parts:
            continue

        full_text = " ".join(parts).strip()
        if is_t7:
            label = "T7 Obsidian Effect"
        elif kinds == ["proc"]:
            label = "Proc Effect"
        elif kinds == ["use"]:
            label = "Use Effect"
        elif kinds == ["equip"]:
            label = "Equip Effect"
        else:
            label = "Special Effect"

        hook = ENGINE_HOOKS.get(iid)
        entry = {
            "label": label,
            "text": full_text,
            "shortText": (
                (hook.get("shortText") if hook else None)
                or SHORT_TEXT_OVERRIDES.get(iid)
                or make_short(full_text, label)
            ),
            "engineFactored": bool(hook),
        }
        if hook:
            for k, v in hook.items():
                if k != "shortText":
                    entry[k] = v

        out[str(iid)] = entry
        stats["total"] += 1
        if entry["engineFactored"]:
            stats["factored"] += 1
        if is_t7:
            stats["t7"] += 1
        if 35570 <= iid <= 35579:
            stats["instruments"] += 1
        if "auroria" in name.lower():
            stats["auroria"] += 1

    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"Wrote {OUT_PATH} ({size_kb:.1f} KB) -> {stats}")


if __name__ == "__main__":
    main()
