/**
 * Direct DaruGear API Stat Calculator & Export Builder.
 *
 * Faithfully reproduces DaruGear's client-side `calculateTotalStats` (`ft`, `aa`, `kg`)
 * from the raw `GET https://154smechk6.execute-api.ap-southeast-2.amazonaws.com/default/gear/<shareCode>`
 * `{ slots, player }` JSON payload so any `https://darugear.com/?s=XXXXXX` link imports
 * complete gear, exact calculated stats, active buffs, AND skill builds with zero bookmarklet needed.
 */

import { extractSkillBuildFromDaruGearPlayerClass } from "../engine/skillbuilder.js";

export const SCALING_MAP = Object.freeze({
    0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1,
    10: 10, 11: 1, 12: 1,
    17: 10, 26: 10, 31: 10,
    33: 1000, 34: 1000, 35: 1000,
    51: 10, 52: 10, 53: 10, 54: 1, 56: 10, 57: 1, 58: 10,
    64: 1, 67: 5, 68: 5, 71: 10,
    77: 10, 78: 10, 81: 10, 82: 10, 83: 10, 86: 10, 87: 1, 88: 10, 89: 1.5,
    90: 1, 91: 1000, 94: 1, 96: 1, 97: 1, 98: 1,
    120: 10, 121: 10, 122: 10, 123: 10,
    142: 1, 143: 10, 144: 1, 145: 10, 146: 1, 147: 10, 148: 1, 149: 10,
    175: 1000, 176: 10, 179: 10, 180: 10, 181: 1, 182: 1, 183: 1, 184: 1, 185: 10,
    196: 10, 197: 10, 198: 10, 199: 10, 204: 10, 206: 10, 218: 1,
    994: 1, 995: 1, 996: 1, 997: 1, 998: 1, 999: 1,
});

function scaleValue(attrId, rawVal) {
    const div = SCALING_MAP[attrId] || 1;
    let s = (Number(rawVal) / div).toFixed(1);
    if (attrId == 998 || attrId == 999 || attrId == 87) {
        s = Math.round(Number(s)).toFixed(1);
    }
    return Number(s);
}

function addAttr(o, attrId, rawVal) {
    if (attrId == null || rawVal == null) return;
    const v = scaleValue(attrId, rawVal);
    if (!Number.isFinite(v)) return;
    o[attrId] = (o[attrId] || 0) + v;
}

function getPieceCount(setId, slots) {
    let count = 0;
    const seenEquipIds = new Set();
    for (const s of slots || []) {
        const eqSets = s?.item?.equipment?.seteffects;
        if (Array.isArray(eqSets) && eqSets.length > 0 && eqSets[0].equip_item_set_id == setId) {
            const eqId = s?.item?.equipment?.id;
            if (eqId != null) {
                if (!seenEquipIds.has(eqId)) {
                    seenEquipIds.add(eqId);
                    count += 1;
                }
            } else {
                count += 1;
            }
        }
        const lfSets = s?.item?.lunafrost?.seteffects;
        if (Array.isArray(lfSets) && lfSets.length > 0 && lfSets[0].equip_item_set_id == setId) {
            count += 1;
        }
    }
    return count;
}

function getCoverage(eq) {
    const sid = Array.isArray(eq?.slotid) ? eq.slotid : [];
    if (sid.includes(1)) return 15;
    if (sid.includes(2)) return 25;
    if (sid.includes(3) || sid.includes(4)) return 5;
    if (sid.includes(5) || sid.includes(8)) return 10;
    if (sid.includes(7)) return 20;
    if (sid.includes(10)) return 4;
    if (sid.includes(11) || sid.includes(12) || sid.includes(13) || sid.includes(14)) return 3;
    return 0;
}

function getArmorRatio(eq, stat) {
    if (eq.type === "Cloth") return stat === "pdef" ? 20 : stat === "mdef" ? 100 : 0;
    if (eq.type === "Leather") return stat === "pdef" || stat === "mdef" ? 60 : 0;
    if (eq.type === "Plate") return stat === "pdef" ? 120 : 0;
    return 0;
}

function normalizeTemper(v) {
    const n = Number(v);
    return !n || n < 100 || n > 115 ? 100 : n;
}

function calculateWearableMainStat(item, stat) {
    if (stat !== "pdef" && stat !== "mdef") return 0;
    const eq = item?.equipment;
    if (!eq || !item?.grade) return 0;
    const cov = getCoverage(eq);
    const ratio = getArmorRatio(eq, stat);
    let val = Math.floor(Math.pow(eq.level, 1.1) * 85 + 100) * (item.grade.main_mod / 100);
    val = val * ratio * 0.01;
    if (stat === "pdef") val *= normalizeTemper(item.ptemper) / 100;
    if (stat === "mdef") val *= normalizeTemper(item.mtemper) / 100;
    val = val * cov * 0.01;
    return Math.floor(val);
}

function weaponBaseCurve(level) {
    return level * 1.4 + 15 + level * Math.pow(2.2, (level / 100) * 3);
}

function calculateHoldableMainStat(item, stat) {
    const eq = item?.equipment;
    if (!eq || !item?.grade) return 0;
    const t = eq.type;
    if (t === "Magic Shield") return 0;
    const gm = item.grade.main_mod / 100;
    const pt = normalizeTemper(item.ptemper) / 100;
    const mt = normalizeTemper(item.mtemper) / 100;

    if (stat === "atk") {
        let r = 0;
        const base = weaponBaseCurve(eq.level) * gm;
        if (["Dagger", "Sword", "Katana", "Axe", "Shortspear", "Obsidian Katana", "Obsidian Shortspear", "Offhand Magic Dagger", "Offhand Dagger"].includes(t)) {
            r = base;
        } else if (["Club", "Scepter", "Offhand Healing Scepter"].includes(t)) {
            r = base * 0.9;
        } else if (t === "Scythe") {
            r = base * 1.16;
        } else if (["Greatclub", "Staff"].includes(t)) {
            r = base * 1.05;
        } else if (["Longspear", "Nodachi", "Greatsword", "GreatAxe", "Warclub"].includes(t)) {
            r = base * 1.2;
        }
        return r * pt;
    }
    if (stat === "matk") {
        let r = 0;
        const base = weaponBaseCurve(eq.level) * gm;
        if (t === "Scepter") r = base * 1.05;
        else if (t === "Staff") r = base * 1.2;
        else if (t === "Scythe") r = base * 1.16;
        else if (t === "Obsidian Katana") r = base * 1.05 * 0.95;
        else if (["Obsidian Magic Dagger", "Offhand Magic Dagger"].includes(t)) r = base * 1.05 * 0.1;
        return Math.floor(r * mt);
    }
    if (stat === "heal") {
        let r = 0;
        const base = weaponBaseCurve(eq.level) * gm;
        if (t === "Club") r = base * 1.05;
        else if (t === "Greatclub") r = base * 1.2;
        else if (t === "Scythe") r = base * 1.16;
        else if (t === "Obsidian Shortspear") r = base * 1.05 * 0.95;
        else if (t === "Offhand Healing Scepter") r = base * 1.05 * 0.1;
        return Math.floor(r * mt);
    }
    if (stat === "ratk") {
        if (t !== "Bow") return 0;
        return weaponBaseCurve(eq.level) * 0.85 * gm * pt;
    }
    if (stat === "pdef") {
        if (t !== "Shield") return 0;
        return Math.floor((Math.pow(eq.level, 1.1) * 85 + 100) * gm * 0.25 * pt);
    }
    return 0;
}

export function calculateItemMain(item, stat) {
    if (!item?.equipment || !item?.grade) return 0;
    const t = item.equipment.type;
    if (["Cloth", "Leather", "Plate"].includes(t)) {
        return calculateWearableMainStat(item, stat);
    }
    return calculateHoldableMainStat(item, stat);
}

const ITEM_BONUS_ATTR_META = Object.freeze({
    0: { label: "Strength", unit: "" },
    1: { label: "Agility", unit: "" },
    2: { label: "Stamina", unit: "" },
    3: { label: "Intelligence", unit: "" },
    4: { label: "Spirit", unit: "" },
    6: { label: "Max Health", unit: "" },
    7: { label: "Max Mana", unit: "" },
    8: { label: "Physical Defense", unit: "" },
    10: { label: "Move Speed", unit: "%" },
    11: { label: "Health Regen", unit: "" },
    12: { label: "Mana Regen", unit: "" },
    17: { label: "Melee Crit Dmg", unit: "%" },
    26: { label: "Ranged Crit Dmg", unit: "%" },
    31: { label: "Magic Crit Dmg", unit: "%" },
    33: { label: "Melee Attack", unit: "" },
    34: { label: "Ranged Attack", unit: "" },
    35: { label: "Magic Attack", unit: "" },
    51: { label: "Melee Skill Dmg", unit: "%" },
    52: { label: "Ranged Skill Dmg", unit: "%" },
    53: { label: "Magic Skill Dmg", unit: "%" },
    54: { label: "Attack Speed", unit: "" },
    55: { label: "Cast Speed", unit: "%" },
    56: { label: "Received Healing", unit: "%" },
    57: { label: "Defense Pen", unit: "" },
    58: { label: "Received Damage", unit: "%" },
    64: { label: "Magic Defense", unit: "" },
    67: { label: "Health Regen", unit: "" },
    68: { label: "Mana Regen", unit: "" },
    71: { label: "Cast Time", unit: "%" },
    74: { label: "Stealth Detection", unit: "%" },
    77: { label: "Melee Crit Rate", unit: "%" },
    78: { label: "Melee Accuracy", unit: "%" },
    81: { label: "Parry Rate", unit: "%" },
    82: { label: "Ranged Crit Rate", unit: "%" },
    83: { label: "Ranged Accuracy", unit: "%" },
    86: { label: "Magic Crit Rate", unit: "%" },
    87: { label: "Magic Attack", unit: "%" },
    88: { label: "Magic Accuracy", unit: "%" },
    89: { label: "Cast Delay Tol.", unit: "%" },
    90: { label: "Range", unit: "m" },
    94: { label: "Debuff Duration", unit: "%" },
    120: { label: "Healing Skill", unit: "%" },
    121: { label: "Melee Backstab", unit: "%" },
    122: { label: "Ranged Backstab", unit: "%" },
    123: { label: "Magic Backstab", unit: "%" },
    142: { label: "Fixed Melee DR", unit: "", negate: true },
    143: { label: "Recv Melee Dmg", unit: "%" },
    144: { label: "Fixed Ranged DR", unit: "", negate: true },
    145: { label: "Recv Ranged Dmg", unit: "%" },
    146: { label: "Fixed Magic DR", unit: "", negate: true },
    147: { label: "Recv Magic Dmg", unit: "%" },
    175: { label: "Healing Power", unit: "" },
    176: { label: "Crit Heal Bonus", unit: "%" },
    179: { label: "Block Rate", unit: "%" },
    180: { label: "Evasion Rate", unit: "%" },
    181: { label: "Focus", unit: "" },
    182: { label: "Toughness", unit: "" },
    183: { label: "Resilience", unit: "" },
    184: { label: "Magic Def Pen", unit: "" },
    185: { label: "Heal Crit Rate", unit: "%" },
    196: { label: "PvE Melee Skill Dmg", unit: "%" },
    197: { label: "PvE Ranged Skill Dmg", unit: "%" },
    198: { label: "PvE Magic Skill Dmg", unit: "%" },
    199: { label: "PvE Recv Dmg", unit: "%" },
    204: { label: "Shield Pen Rate", unit: "%" },
    206: { label: "Shield Pen", unit: "%" },
    218: { label: "Attack Speed", unit: "" },
    994: { label: "Physical Defense", unit: "%" },
    995: { label: "Max Health", unit: "%" },
    996: { label: "Max Mana", unit: "%" },
    997: { label: "Spirit", unit: "%" },
    998: { label: "Melee Attack", unit: "%" },
    999: { label: "Ranged Attack", unit: "%" },
});

function formatAttrVal(val, unit = "") {
    const sign = val > 0 ? "+" : "";
    const abs = Math.abs(val);
    const numStr =
        unit === "%" || Math.abs(val % 1) > 1e-4
            ? Number(val).toFixed(1)
            : Math.round(val).toLocaleString("en-US");
    return `${sign}${numStr}${unit}`;
}

function summarizeAttrMap(attrObj, { excludeIds = null } = {}) {
    const byId = new Map();
    for (const [aidStr, rawVal] of Object.entries(attrObj || {})) {
        const aid = Number(aidStr);
        if (excludeIds && excludeIds.has(aid)) continue;
        const meta = ITEM_BONUS_ATTR_META[aid];
        if (!meta) continue;
        const val = meta.negate ? -Number(rawVal) : Number(rawVal);
        if (!Number.isFinite(val) || Math.abs(val) < 0.05) continue;
        byId.set(aid, Number(((byId.get(aid) || 0) + val).toFixed(1)));
    }

    const consumed = new Set();
    const out = [];

    // Collapse identical Crit Damage across Melee/Ranged/Magic (17, 26, 31)
    if (byId.has(17) && byId.get(17) === byId.get(26) && byId.get(17) === byId.get(31)) {
        out.push({ label: "Crit Damage", value: byId.get(17), unit: "%" });
        [17, 26, 31].forEach((k) => consumed.add(k));
    }
    // Collapse identical Crit Rate across Melee/Ranged/Magic (77, 82, 86)
    if (byId.has(77) && byId.get(77) === byId.get(82) && byId.get(77) === byId.get(86)) {
        out.push({ label: "Crit Rate", value: byId.get(77), unit: "%" });
        [77, 82, 86].forEach((k) => consumed.add(k));
    }
    // Collapse identical Melee + Ranged Attack % (998, 999)
    if (byId.has(998) && byId.get(998) === byId.get(999)) {
        out.push({ label: "Melee/Ranged Atk", value: byId.get(998), unit: "%" });
        [998, 999].forEach((k) => consumed.add(k));
    }
    // Collapse identical Fixed Melee/Ranged/Magic DR (142, 144, 146)
    if (byId.has(142) && byId.get(142) === byId.get(144) && byId.get(142) === byId.get(146)) {
        out.push({ label: "Fixed DR", value: byId.get(142), unit: "" });
        [142, 144, 146].forEach((k) => consumed.add(k));
    }

    const byLabel = new Map();
    for (const [aid, val] of byId.entries()) {
        if (consumed.has(aid)) continue;
        const meta = ITEM_BONUS_ATTR_META[aid];
        const prev = byLabel.get(meta.label);
        if (prev) {
            prev.value = Number((prev.value + val).toFixed(1));
        } else {
            byLabel.set(meta.label, { label: meta.label, value: val, unit: meta.unit });
        }
    }
    for (const entry of byLabel.values()) {
        if (Math.abs(entry.value) >= 0.05) out.push(entry);
    }
    return out;
}

function inferEquipmentSetName(itemName) {
    const clean = String(itemName || "").trim();
    if (!clean) return "Item Set";
    const stripped = clean
        .replace(
            /\s+(Helm|Hood|Cap|Circlet|Cuirass|Shirt|Jerkin|Tunic|Tassets|Sash|Belt|Vambraces|Sleeves|Guards|Gauntlets|Gloves|Fists|Greaves|Pants|Breeches|Sabatons|Shoes|Boots|Cloak|Necklace|Earrings?|Ring)$/i,
            ""
        )
        .trim();
    return stripped ? `${stripped} Set` : `${clean} Set`;
}

/**
 * Verbatim AA Classic 1.3.6 (3.5) Set Bonus Proc & Extra Tier Descriptions
 * (sourced from aa-classic.com `set_data.bonuses`) for sets whose proc text or
 * non-numeric 7pc tiers are omitted from DaruGear's numeric `unit_attribute_id` rows.
 */
export const SET_BONUS_EXTRA_NOTES = Object.freeze({
    111: Object.freeze({
        4: "Proc — Anthalon's Necromantic Flame: Pulls all enemies within 20m toward you and inflicts 250–300 Magic Damage every second.",
        7: "Proc — Anthalon Mind Absorb: Teleports caster to up to 5 enemies, dealing 300–350 Magic Damage to each one and recovering an equal amount of mana.",
    }),
    174: Object.freeze({
        4: "Proc — Anthalon's Necromantic Flame: Pulls all enemies within 20m toward you and inflicts 250–300 Magic Damage every second.",
        7: "Proc — Anthalon Mind Absorb: Teleports caster to up to 5 enemies, dealing 300–350 Magic Damage to each one and recovering an equal amount of mana.",
    }),
    9000113: Object.freeze({
        4: "Proc — Anthalon's Necromantic Flame (on receiving damage): Pulls all enemies within 20m toward you and inflicts 250–300 Magic Damage every second.",
        7: "Proc — Primal Anthalon Mind Absorb (on dealing damage): Teleports caster to up to 5 enemies, dealing 300–350 Magic Damage to each one and recovering an equal amount of mana.",
    }),
    112: Object.freeze({
        4: "Proc — Yaksa Stab: Lunge forward and deal 900 Physical Damage.",
        7: "Proc — Yaksa Whirl Smash: Deals 500 Physical Damage with a weapon swing and 800 Physical Damage with a weapon smash.",
    }),
    113: Object.freeze({
        4: "Proc — Barrage: Launches an enemy into the air and shoots them up to 10 times, dealing 165 Ranged Damage each hit.",
        7: "Proc — Hand Cannon: Deals 1,200 Siege Damage to all targets within a 4m radius.",
    }),
    159: Object.freeze({
        4: "Proc — Barrage: Launches an enemy into the air and shoots them up to 10 times, dealing 165 Ranged Damage each hit.",
        7: "Proc — Nightmare Grinder: Shackles an enemy for 2s and inflicts 950 continuous Siege Damage.",
    }),
    446: Object.freeze({
        2: "Stuns all enemies hit by Titan's Talon.",
    }),
    169: Object.freeze({
        7: "Decreases the durations of debuffs -10% (Stun, Trip, Fear, Snare, Shackle, Silence, Sleep, Impale, Slow).",
    }),
    414: Object.freeze({
        7: "Increases Melee Critical Rate +0.4% per stack while Amplified Black Magic is active.",
    }),
    415: Object.freeze({
        7: "Increases Ranged Attack +3 per stack while Revealed Talisman is activated.",
    }),
    9000018: Object.freeze({
        7: "Increases Ranged Attack +3 per stack while Revealed Talisman is activated.",
    }),
    416: Object.freeze({
        7: "Increases Critical Healing Bonus and Magic Critical Damage +0.2% per stack while Tempting Melody is activated.",
    }),
    417: Object.freeze({
        7: "Increases Critical Healing Bonus and Magic Critical Damage +0.2% per stack while Tempting Melody is activated.",
    }),
});

/**
 * Normalize known DaruGear `set_effect.csv` attribute/sign bugs at runtime so both
 * freshly equipped sets and previously saved builds compute accurately:
 *  - Primal Kyrios 7pc (set 9000113, aid 58): +45 -> -45 (-4.5% received damage = +4.5% DR)
 *  - Flat Magic/Ranged/Melee Attack set bonuses (e.g. Tempting Melody 3pc set 416,
 *    Recollections 7pc set 196) where DaruGear mis-tagged flat ×1000 values (e.g. 10,802 = +10.8)
 *    as % attributes (aid 87/999/998) instead of flat attributes (aid 35/34/33).
 */
function normalizeSetEffectEntry(se) {
    let aid = se?.unit_attribute_id != null && Number.isFinite(Number(se.unit_attribute_id))
        ? Number(se.unit_attribute_id)
        : null;
    let rawVal = se?.calculated_value != null ? Number(se.calculated_value) : Number(se?.value);
    if (aid == null || !Number.isFinite(rawVal)) return { aid, rawVal };
    if (Number(se?.equip_item_set_id) === 9000113 && aid === 58 && rawVal > 0) {
        rawVal = -Math.abs(rawVal);
    }
    const bn = String(se?.buff_name || "");
    if (!bn.includes("%") && Math.abs(rawVal) >= 1000) {
        if (aid === 87) aid = 35;
        else if (aid === 999) aid = 34;
        else if (aid === 998) aid = 33;
    }
    return { aid, rawVal };
}

function buildSetEffectGroup(rawSetEffects, setName, sourceKind, allSlots) {
    if (!Array.isArray(rawSetEffects) || rawSetEffects.length === 0) return null;
    const setId = rawSetEffects[0]?.equip_item_set_id;
    if (setId == null) return null;
    const equippedCount = Array.isArray(allSlots) ? getPieceCount(setId, allSlots) : 1;
    const extraTierNotes = SET_BONUS_EXTRA_NOTES[Number(setId)] || null;

    // Group entries by num_pieces threshold ascending, deduplicating repeated attr IDs from lower tiers
    const byThreshold = new Map();
    for (const se of rawSetEffects) {
        const pcs = Number(se?.num_pieces) || 0;
        if (pcs <= 0) continue;
        if (!byThreshold.has(pcs)) byThreshold.set(pcs, []);
        byThreshold.get(pcs).push(se);
    }
    if (extraTierNotes) {
        for (const pcsKey of Object.keys(extraTierNotes)) {
            const pcs = Number(pcsKey);
            if (pcs > 0 && !byThreshold.has(pcs)) {
                byThreshold.set(pcs, []);
            }
        }
    }
    const sortedPcs = Array.from(byThreshold.keys()).sort((a, b) => a - b);
    if (sortedPcs.length === 0) return null;

    const seenAttrIds = new Set();
    const tiers = [];
    for (const pcs of sortedPcs) {
        const rows = byThreshold.get(pcs) || [];
        const tierAttrs = {};
        const fallbackNotes = [];
        for (const se of rows) {
            const { aid, rawVal } = normalizeSetEffectEntry(se);
            const hasAttr = aid != null;
            if (hasAttr && !seenAttrIds.has(aid)) {
                seenAttrIds.add(aid);
                if (ITEM_BONUS_ATTR_META[aid]) {
                    addAttr(tierAttrs, aid, rawVal);
                } else if (se.buff_name && !String(se.buff_name).includes("#{")) {
                    fallbackNotes.push(String(se.buff_name).trim());
                }
            }
            if (se.note && String(se.note).trim()) {
                fallbackNotes.push(String(se.note).trim());
            } else if (!hasAttr && se.buff_name && !String(se.buff_name).includes("#{")) {
                fallbackNotes.push(String(se.buff_name).trim());
            }
        }
        if (extraTierNotes?.[pcs]) {
            fallbackNotes.push(extraTierNotes[pcs]);
        }
        const entries = summarizeAttrMap(tierAttrs);
        const parts = entries.map((e) => `${e.label} ${formatAttrVal(e.value, e.unit)}`);
        for (const note of fallbackNotes) {
            if (!parts.includes(note)) parts.push(note);
        }
        if (parts.length === 0) {
            // Fallback to cleaned buff_name when all entries were non-numeric proc effects
            const rawName = String(rows[0]?.buff_name || "").replace(/#\{[^}]+\}/g, "").trim();
            if (rawName) parts.push(rawName);
        }
        tiers.push({
            numPieces: pcs,
            active: equippedCount >= pcs,
            entries,
            summary: parts.join(" · "),
        });
    }

    const maxPieces = sortedPcs[sortedPcs.length - 1];
    return {
        setId,
        name: setName,
        sourceKind, // "equipment" | "lunafrost"
        equippedCount,
        maxPieces,
        tiers,
    };
}

/**
 * Canonical AA Classic 1.3.6 Costume Enlightenment Charms (slot 0 lunafrosts).
 * Activates its 2-Set Enlightenment effect when 2+ Enlightened accessories/items are equipped
 * (or when the corresponding Enlightenment buff chip is toggled active).
 */
export const COSTUME_CHARM_DEFS = Object.freeze({
    9001611: {
        id: 9001611,
        element: "Life",
        name: "Life Charm",
        setName: "Life Enlightenment",
        modId: "enlightenment_life",
        shortDesc: "+1 Rank to 10 core skills",
        fullDesc:
            "Increases the rank of Precision Strike, Earthen Grip, Shield Slam, Thwart, Hell Spear, Deadeye, Freezing Earth, Stalker's Mark, [Perform] Ode to Recovery, and Renewal by +1 (does not affect Ancestral variants).",
    },
    9001678: {
        id: 9001678,
        element: "Flame",
        name: "Flame Charm",
        setName: "Flame Enlightenment",
        modId: "enlightenment_flame",
        shortDesc: "Recover 1% Max HP on Block/Parry/Evade",
        fullDesc: "Recover 1% of Max Health whenever you Block, Parry, or Evade an attack.",
    },
    9001676: {
        id: 9001676,
        element: "Gale",
        name: "Gale Charm",
        setName: "Gale Enlightenment",
        modId: "enlightenment_gale",
        shortDesc: "+3% Move Spd per Crit (up to 10x)",
        fullDesc: "Critical strikes increase Move Speed by +3%, stacking up to 10 times (+30% Move Speed).",
    },
    9001644: {
        id: 9001644,
        element: "Wave",
        name: "Wave Charm",
        setName: "Wave Enlightenment",
        modId: "enlightenment_wave",
        shortDesc: "Post-Cast Mana Regen +10",
        fullDesc: "Increases Post-Cast Mana Regeneration by +10.",
    },
    9001665: {
        id: 9001665,
        element: "Meadow",
        name: "Meadow Charm",
        setName: "Meadow Enlightenment",
        modId: "enlightenment_meadow",
        shortDesc: "Abyssal charges never decay",
        fullDesc: "Abyssal charges no longer decay over time.",
    },
    9001674: {
        id: 9001674,
        element: "Earth",
        name: "Earth Charm",
        setName: "Earth Enlightenment",
        modId: "enlightenment_earth",
        shortDesc: "+1 Max Abyssal Charge",
        fullDesc: "Increases Maximum Abyssal Charges by +1.",
    },
    9001684: {
        id: 9001684,
        element: "Lightning",
        name: "Lightning Charm",
        setName: "Lightning Enlightenment",
        modId: "enlightenment_lightning",
        shortDesc: "+50% Glide Spd, +4s Glider Recovery",
        fullDesc: "Increases gliding speed by +50% and glider recovery by +4 seconds.",
    },
});

const COSTUME_CHARM_BY_NAME = new Map(
    Object.values(COSTUME_CHARM_DEFS).map((c) => [c.name.toLowerCase(), c])
);

const EARRING_SLOT_IDS = new Set([11, 12]);
const RING_SLOT_IDS = new Set([13, 14]);

function inspectEnlightenedRingEarringPair(allSlots, element) {
    if (!Array.isArray(allSlots) || !element) {
        return { hasEarring: false, hasRing: false, count: 0 };
    }
    const earringRe = new RegExp(`^Enlightened\\s+(?:Ayanad\\s+)?${element}\\s+Earring\\b`, "i");
    const ringRe = new RegExp(`^Enlightened\\s+(?:Ayanad\\s+)?${element}\\s+Ring\\b`, "i");
    let hasEarring = false;
    let hasRing = false;
    for (const s of allSlots) {
        const sid = Number(s?.id ?? s?.item?.slotid);
        const name = String(s?.item?.equipment?.name || "").trim();
        if (!name) continue;
        if (EARRING_SLOT_IDS.has(sid) && earringRe.test(name)) hasEarring = true;
        else if (RING_SLOT_IDS.has(sid) && ringRe.test(name)) hasRing = true;
    }
    return {
        hasEarring,
        hasRing,
        count: (hasEarring ? 1 : 0) + (hasRing ? 1 : 0),
    };
}

function hasActiveModifierId(activeModifiers, modId) {
    if (!activeModifiers || !modId) return false;
    const list = activeModifiers instanceof Set ? Array.from(activeModifiers) : Array.isArray(activeModifiers) ? activeModifiers : [];
    for (const tok of list) {
        const base = String(tok || "").split(":")[0].trim();
        if (base === modId) return true;
    }
    return false;
}

/**
 * Resolve Costume Charm metadata & live 2-Set activation state from a lunafrost object,
 * equipped slots (requiring 1 matching-element Enlightened Earring [slot 11/12] +
 * 1 matching-element Enlightened Ring [slot 13/14]), and optional active simulator buffs.
 */
export function resolveCostumeCharmInfo(lunafrost, allSlots = null, activeModifiers = null) {
    if (!lunafrost) return null;
    const fid = Number(lunafrost.id);
    const fname = String(lunafrost.name || "").trim().toLowerCase();
    const def = (Number.isFinite(fid) && COSTUME_CHARM_DEFS[fid]) || COSTUME_CHARM_BY_NAME.get(fname) || null;
    if (!def) return null;

    const { hasEarring, hasRing, count: enlightenedCount } = inspectEnlightenedRingEarringPair(allSlots, def.element);
    const activeByGear = hasEarring && hasRing;
    const activeByBuff = hasActiveModifierId(activeModifiers, def.modId);
    const active = activeByGear || activeByBuff;
    let statusLabel;
    if (activeByGear) {
        statusLabel = "2/2 pc · Active";
    } else if (activeByBuff) {
        statusLabel = "Active (Buff)";
    } else if (hasEarring && !hasRing) {
        statusLabel = `1/2 pc (need Enlightened ${def.element} Ring)`;
    } else if (!hasEarring && hasRing) {
        statusLabel = `1/2 pc (need Enlightened ${def.element} Earring)`;
    } else {
        statusLabel = `0/2 pc (need Enlightened ${def.element} Earring + Ring)`;
    }

    return {
        ...def,
        hasEarring,
        hasRing,
        enlightenedCount,
        requiredPieces: 2,
        activeByGear,
        activeByBuff,
        active,
        statusLabel,
    };
}

/**
 * Canonical AA Classic 1.3.6 (3.5) T7 Obsidian Weapon, Bow & Instrument Special Effects
 * (sourced verbatim from aa-classic.com item proc_data for item IDs 40572–40625).
 * T7 Shields (40626–40627) and T7 Armor (40628–40687) have no hidden proc_data; their
 * passive equip bonuses are already stored in `equipeffects`.
 */
export const T7_OBSIDIAN_SPECIAL_EFFECTS = Object.freeze({
    40572: {
        text: "Basic Toxic Shot decreases target's Attack Speed -87 and Cast Time -8%.",
        shortText: "Toxic Shot: -87 Atk Spd & -8% Cast",
        engineFactored: false,
    },
    40573: {
        text: "Basic Toxic Shot decreases target's Attack Speed -87 and Cast Time -8%.",
        shortText: "Toxic Shot: -87 Atk Spd & -8% Cast",
        engineFactored: false,
    },
    40574: {
        text: "Using Basic Drop Back increases duration +0.5 sec.",
        shortText: "Basic Drop Back +0.5s duration",
        engineFactored: true,
        dropBackExtraDurationSec: 0.5,
    },
    40575: {
        text: "Using Basic Drop Back increases duration +0.5 sec.",
        shortText: "Basic Drop Back +0.5s duration",
        engineFactored: true,
        dropBackExtraDurationSec: 0.5,
    },
    40576: {
        text: "Grants melee attacks that hit a chance to generate Delirium.",
        shortText: "Proc: Generate Delirium",
        engineFactored: false,
    },
    40577: {
        text: "Grants melee attacks that hit a chance to generate Bloodthirst.",
        shortText: "Proc: Generate Bloodthirst",
        engineFactored: false,
    },
    40578: {
        text: "Grants melee attacks that hit a chance to generate Delirium.",
        shortText: "Proc: Generate Delirium",
        engineFactored: false,
    },
    40579: {
        text: "Grants melee attacks that hit a chance to generate Bloodthirst.",
        shortText: "Proc: Generate Bloodthirst",
        engineFactored: false,
    },
    40580: {
        text: "Using Basic Overwhelm increases range +2m.",
        shortText: "Basic Overwhelm +2m range",
        engineFactored: false,
    },
    40581: {
        text: "Using Basic Charge increases range +2m.",
        shortText: "Basic Charge +2m range",
        engineFactored: false,
    },
    40582: {
        text: "Decreases the duration of Fear on the wielder -15%.",
        shortText: "Fear Duration -15%",
        engineFactored: false,
    },
    40583: {
        text: "Damages a target when Basic Dissonance is cast, but does not grant the Dissonance effect.",
        shortText: "Basic Dissonance: Dmg only (no debuff)",
        engineFactored: true,
        dissonanceNoDebuff: true,
    },
    40584: {
        text: "Decreases the duration of Fear on the wielder -15%.",
        shortText: "Fear Duration -15%",
        engineFactored: false,
    },
    40585: {
        text: "Damages a target when Basic Dissonance is cast, but does not grant the Dissonance effect.",
        shortText: "Basic Dissonance: Dmg only (no debuff)",
        engineFactored: true,
        dissonanceNoDebuff: true,
    },
    40586: {
        text: "Grants melee attacks that hit a chance to generate Bloodthirst.",
        shortText: "Proc: Generate Bloodthirst",
        engineFactored: false,
    },
    40587: {
        text: "Using Basic Piercing Shot Staggers the target.",
        shortText: "Basic Piercing Shot Staggers",
        engineFactored: false,
    },
    40588: {
        text: "Grants melee attacks that hit a chance to generate Bloodthirst.",
        shortText: "Proc: Generate Bloodthirst",
        engineFactored: false,
    },
    40589: {
        text: "Using Basic Piercing Shot Staggers the target.",
        shortText: "Basic Piercing Shot Staggers",
        engineFactored: false,
    },
    40590: {
        text: "Casting Basic Imprison grants the Tenacity buff for 9 sec, increasing the damage dealt to all enemies within a 10m radius.",
        shortText: "Basic Imprison: 9s Tenacity (10m)",
        engineFactored: false,
    },
    40591: {
        text: "Casting Basic Imprison grants the Tenacity buff for 9 sec, increasing the damage dealt to all enemies within a 10m radius.",
        shortText: "Basic Imprison: 9s Tenacity (10m)",
        engineFactored: false,
    },
    40592: {
        text: "Using Basic Behind Enemy Lines increases range and damage radius +2m respectively.",
        shortText: "Basic Behind Enemy Lines +2m range/radius",
        engineFactored: false,
    },
    40593: {
        text: "Using Basic Behind Enemy Lines increases range and damage radius +2m respectively.",
        shortText: "Basic Behind Enemy Lines +2m range/radius",
        engineFactored: false,
    },
    40594: {
        text: "Casting Basic Resurgence on the same target multiple times increases the duration up to 35 seconds.",
        shortText: "Basic Resurgence stacks up to 35s",
        engineFactored: true,
        resurgenceStackMaxSec: 35,
    },
    40595: {
        text: "Casting Basic Resurgence on the same target multiple times increases the duration up to 35 seconds.",
        shortText: "Basic Resurgence stacks up to 35s",
        engineFactored: true,
        resurgenceStackMaxSec: 35,
    },
    40596: {
        text: "Casting Basic Resurgence on the same target multiple times increases the duration up to 35 seconds.",
        shortText: "Basic Resurgence stacks up to 35s",
        engineFactored: true,
        resurgenceStackMaxSec: 35,
    },
    40597: {
        text: "Casting Basic Resurgence on the same target multiple times increases the duration up to 35 seconds.",
        shortText: "Basic Resurgence stacks up to 35s",
        engineFactored: true,
        resurgenceStackMaxSec: 35,
    },
    40598: {
        text: "Casting Basic Infuse grants 1,746–1,786 Health to the target whose Mana was restored.",
        shortText: "Basic Infuse heals 1,746–1,786 HP",
        engineFactored: false,
    },
    40599: {
        text: "Casting Basic Infuse grants 1,746–1,786 Health to the target whose Mana was restored.",
        shortText: "Basic Infuse heals 1,746–1,786 HP",
        engineFactored: false,
    },
    40600: {
        text: "Casting Basic Infuse grants 1,746–1,786 Health to the target whose Mana was restored.",
        shortText: "Basic Infuse heals 1,746–1,786 HP",
        engineFactored: false,
    },
    40601: {
        text: "Casting Basic Infuse grants 1,746–1,786 Health to the target whose Mana was restored.",
        shortText: "Basic Infuse heals 1,746–1,786 HP",
        engineFactored: false,
    },
    40602: {
        text: "Grants ranged attacks that hit a chance to inflict the Feral Mark effect.",
        shortText: "Proc: Inflict Feral Mark",
        engineFactored: false,
    },
    40603: {
        text: "Grants ranged attacks that hit a chance to inflict the Feral Mark effect.",
        shortText: "Proc: Inflict Feral Mark",
        engineFactored: false,
    },
    40604: {
        text: "Using Basic Thwart grants a 50% chance to give 1 extra stack of Inspired.",
        shortText: "Basic Thwart: 50% +1 Inspired",
        engineFactored: false,
    },
    40605: {
        text: "Using Basic Thwart grants a 50% chance to give 1 extra stack of Inspired.",
        shortText: "Basic Thwart: 50% +1 Inspired",
        engineFactored: false,
    },
    40606: {
        text: "Grants ranged attacks that hit a chance to inflict the Feral Mark effect.",
        shortText: "Proc: Inflict Feral Mark",
        engineFactored: false,
    },
    40607: {
        text: "Using Basic Thwart grants a 50% chance to give 1 extra stack of Inspired.",
        shortText: "Basic Thwart: 50% +1 Inspired",
        engineFactored: false,
    },
    40608: {
        text: "Grants ranged attacks that hit a chance to inflict the Feral Mark effect.",
        shortText: "Proc: Inflict Feral Mark",
        engineFactored: false,
    },
    40609: {
        text: "Using Basic Thwart grants a 50% chance to give 1 extra stack of Inspired.",
        shortText: "Basic Thwart: 50% +1 Inspired",
        engineFactored: false,
    },
    40610: {
        text: "Using Basic Gods' Whip increases damage +8%.",
        shortText: "Basic Gods' Whip +8% Dmg",
        engineFactored: true,
        skillBonus: Object.freeze({
            skillId: "sorcery_gods_whip",
            variant: "base",
            kind: "damagePct",
            value: 8,
        }),
    },
    40611: {
        text: "Grants magic attacks that hit a chance to generate Mana Fountain.",
        shortText: "Proc: Generate Mana Fountain",
        engineFactored: false,
    },
    40612: {
        text: "Using Basic Spell Shield increases duration +2 sec.",
        shortText: "Basic Spell Shield +2s duration",
        engineFactored: false,
    },
    40613: {
        text: "Using Basic Spell Shield increases duration +2 sec.",
        shortText: "Basic Spell Shield +2s duration",
        engineFactored: false,
    },
    40614: {
        text: "Casting Basic Startling Strain Charms the target immediately, but does not Stun them.",
        shortText: "Basic Startling Strain: Instant Charm",
        engineFactored: true,
        startlingStrainImmediateCharm: true,
    },
    40615: {
        text: "Using Basic Frigid Tracks inflicts Glaciation damage on all enemies within a 4m radius.",
        shortText: "Basic Frigid Tracks: 4m AoE Glaciation",
        engineFactored: false,
    },
    40616: {
        text: "Casting Basic Startling Strain Charms the target immediately, but does not Stun them.",
        shortText: "Basic Startling Strain: Instant Charm",
        engineFactored: true,
        startlingStrainImmediateCharm: true,
    },
    40617: {
        text: "Using Basic Frigid Tracks inflicts Glaciation damage on all enemies within a 4m radius.",
        shortText: "Basic Frigid Tracks: 4m AoE Glaciation",
        engineFactored: false,
    },
    40618: {
        text: "Basic Stalker's Mark decreases target's defense -390.",
        shortText: "Basic Stalker's Mark: -390 PDef",
        engineFactored: true,
        stalkersMarkDefShred: 390,
    },
    40619: {
        text: "Fires additional arrows at all enemies within 5m of the target when using Basic Charged Bolt (Archery).",
        shortText: "Basic Charged Bolt: 5m AoE arrows",
        engineFactored: false,
    },
    40620: {
        text: "Basic Stalker's Mark decreases target's defense -390.",
        shortText: "Basic Stalker's Mark: -390 PDef",
        engineFactored: true,
        stalkersMarkDefShred: 390,
    },
    40621: {
        text: "Fires additional arrows at all enemies within 5m of the target when using Basic Charged Bolt (Archery).",
        shortText: "Basic Charged Bolt: 5m AoE arrows",
        engineFactored: false,
    },
    40622: {
        text: "Using Basic Stillness decreases Move Speed -10% for all enemies within range.",
        shortText: "Basic Stillness: -10% Move Spd",
        engineFactored: false,
    },
    40623: {
        text: "Using Basic Stillness decreases Move Speed -10% for all enemies within range.",
        shortText: "Basic Stillness: -10% Move Spd",
        engineFactored: false,
    },
    40624: {
        text: "Decreases the mana cost of performance skills (Songcraft) -8%.",
        shortText: "Songcraft Performances -8% Mana",
        engineFactored: false,
    },
    40625: {
        text: "Decreases the mana cost of performance skills (Songcraft) -8%.",
        shortText: "Songcraft Performances -8% Mana",
        engineFactored: false,
    },
});

/**
 * Runtime registry of all 500+ AA Classic item special effects (loaded from
 * `js/data/gear_catalog/item_special_effects.json`: Warrior Medal Instruments like
 * Aria of Archery / Anthem of Battlerage, Auroria Armor, T4–T7 Obsidian, Veiled Terror,
 * Hermit's Glare/Heart, World Bosses, Dungeon Gear, Dream Ring, Ayanad Earring, Hero Cloaks, etc.).
 * T7_OBSIDIAN_SPECIAL_EFFECTS always serves as a built-in synchronous fallback.
 */
const _registeredSpecialEffects = new Map();

export function registerItemSpecialEffects(effectsMap) {
    if (!effectsMap || typeof effectsMap !== "object") return 0;
    let count = 0;
    for (const [rawId, entry] of Object.entries(effectsMap)) {
        const id = Number(rawId);
        if (!Number.isFinite(id) || id <= 0 || !entry || typeof entry !== "object") continue;
        _registeredSpecialEffects.set(id, entry);
        count++;
    }
    return count;
}

function extractNumericItemId(itemOrId) {
    if (itemOrId == null) return 0;
    let rawId = itemOrId;
    if (typeof itemOrId === "object") {
        rawId =
            itemOrId.item?.equipment?.id ??
            itemOrId.equipment?.id ??
            itemOrId.itemId ??
            itemOrId.id;
    }
    const id = Number(rawId);
    return Number.isFinite(id) && id > 0 ? id : 0;
}

/**
 * Resolve any special equip / proc / use effect metadata for an item ID, catalog item,
 * DaruGear slot, or equipment summary entry. Covers all 524+ AA Classic special items
 * (T4–T7 Obsidian, Warrior Medal Instruments, Auroria Armor, World Boss, Dungeon & Accessory gear).
 */
export function getItemSpecialEffect(itemOrId) {
    const id = extractNumericItemId(itemOrId);
    if (!id) return null;
    if (_registeredSpecialEffects.has(id)) return _registeredSpecialEffects.get(id);
    const t7 = T7_OBSIDIAN_SPECIAL_EFFECTS[id];
    if (t7) return { label: "T7 Obsidian Effect", ...t7 };
    return null;
}

/**
 * Resolve the T7 Obsidian special effect metadata for an item ID, catalog item,
 * DaruGear slot, or equipment summary entry. Returns null for non-T7 items.
 */
export function getT7ObsidianSpecialEffect(itemOrId) {
    const id = extractNumericItemId(itemOrId);
    if (!id) return null;
    return T7_OBSIDIAN_SPECIAL_EFFECTS[id] || null;
}

/**
 * Collect all equipped special item effects (T4–T7 Obsidian, Warrior Medal Instruments,
 * Auroria Armor, Veiled Terror, Hermit's Glare, World Boss & Dungeon gear, etc.)
 * from either a character object (`character.equipment` + `character.rawDaruGear.slots`)
 * or a raw `slots` array.
 */
export function getEquippedSpecialEffects(characterOrSlots) {
    const out = [];
    const seenIds = new Set();
    const pushIfSpecial = (rawId, slotId, slotName, name) => {
        const id = Number(rawId);
        if (!Number.isFinite(id) || id <= 0 || seenIds.has(id)) return;
        const effect = getItemSpecialEffect(id);
        if (!effect) return;
        seenIds.add(id);
        out.push({
            itemId: id,
            slotId: slotId != null ? Number(slotId) : null,
            slotName: String(slotName || "Gear").trim(),
            name: String(name || "Special Item").trim(),
            effect,
        });
    };

    if (Array.isArray(characterOrSlots)) {
        for (const s of characterOrSlots) {
            const eq = s?.item?.equipment;
            if (eq) pushIfSpecial(eq.id, s.id, s.name, eq.name);
        }
        return out;
    }

    if (characterOrSlots && typeof characterOrSlots === "object") {
        if (Array.isArray(characterOrSlots.equipment)) {
            for (const eq of characterOrSlots.equipment) {
                if (eq) pushIfSpecial(eq.itemId ?? eq.id, eq.slotId, eq.slotName, eq.name);
            }
        }
        if (Array.isArray(characterOrSlots.rawDaruGear?.slots)) {
            for (const s of characterOrSlots.rawDaruGear.slots) {
                const eq = s?.item?.equipment;
                if (eq) pushIfSpecial(eq.id, s.id, s.name, eq.name);
            }
        }
    }
    return out;
}

/**
 * Backward-compatible alias for `getEquippedSpecialEffects`.
 */
export function getEquippedT7ObsidianEffects(characterOrSlots) {
    return getEquippedSpecialEffects(characterOrSlots);
}

/**
 * Compute all active Equipment Set, Erenor Lunafrost Set (3/4/6pc), Costume Charm
 * Enlightenment (2-Set), and special gear equip/proc/use effects across all equipped slots
 * for the Active Gear Buffs summary list.
 */
export function computeActiveSetEffectSummaries(slots, activeModifiers = null) {
    if (!Array.isArray(slots) || slots.length === 0) return [];
    const seenSetIds = new Set();
    const summaries = [];

    for (const s of slots) {
        const item = s?.item;
        const eq = item?.equipment;
        if (!eq) continue;

        const specialEff = getItemSpecialEffect(eq.id);
        if (specialEff && !seenSetIds.has(`sp:${eq.id}`)) {
            seenSetIds.add(`sp:${eq.id}`);
            const isT7 = Boolean(T7_OBSIDIAN_SPECIAL_EFFECTS[Number(eq.id)]);
            const tag = isT7 ? "T7 Effect" : specialEff.label || "Equip Effect";
            summaries.push({
                id: `${isT7 ? "t7" : "sp"}_${eq.id}`,
                name: `${String(eq.name || "Special Item").trim()} (${tag})`,
                category: isT7 ? "t7" : "special",
                engineFactored: Boolean(specialEff.engineFactored),
                stats: [specialEff.text],
                summary: specialEff.text,
            });
        }

        if (Array.isArray(eq.seteffects) && eq.seteffects.length > 0) {
            const sid = eq.seteffects[0]?.equip_item_set_id;
            if (sid != null && !seenSetIds.has(`eq:${sid}`)) {
                seenSetIds.add(`eq:${sid}`);
                const grp = buildSetEffectGroup(eq.seteffects, inferEquipmentSetName(eq.name), "equipment", slots);
                const activeTiers = grp ? grp.tiers.filter((t) => t.active && t.summary) : [];
                if (activeTiers.length > 0) {
                    summaries.push({
                        id: `set_${sid}`,
                        name: `${grp.name} (${grp.equippedCount}/${grp.maxPieces})`,
                        category: "set",
                        stats: activeTiers.map((t) => `${t.numPieces}pc: ${t.summary}`),
                        summary: activeTiers.map((t) => `${t.numPieces}pc: ${t.summary}`).join(" · "),
                    });
                }
            }
        }

        const charmInfo = item.lunafrost ? resolveCostumeCharmInfo(item.lunafrost, slots, activeModifiers) : null;
        if (charmInfo) {
            if (charmInfo.active && !seenSetIds.has(`charm:${charmInfo.id}`)) {
                seenSetIds.add(`charm:${charmInfo.id}`);
                summaries.push({
                    id: `charm_${charmInfo.id}`,
                    name: `${charmInfo.setName} (${charmInfo.activeByGear ? `${charmInfo.enlightenedCount}/2` : "Active"})`,
                    category: "charm",
                    stats: [charmInfo.fullDesc],
                    summary: charmInfo.fullDesc,
                });
            }
            continue;
        }

        if (Array.isArray(item.lunafrost?.seteffects) && item.lunafrost.seteffects.length > 0) {
            const sid = item.lunafrost.seteffects[0]?.equip_item_set_id;
            if (sid != null && !seenSetIds.has(`lf:${sid}`)) {
                seenSetIds.add(`lf:${sid}`);
                const lfName = String(item.lunafrost.name || "Lunafrost").trim();
                const grp = buildSetEffectGroup(item.lunafrost.seteffects, `${lfName} Set`, "lunafrost", slots);
                const activeTiers = grp ? grp.tiers.filter((t) => t.active && t.summary) : [];
                if (activeTiers.length > 0) {
                    summaries.push({
                        id: `lfset_${sid}`,
                        name: `${grp.name} (${grp.equippedCount}/${grp.maxPieces})`,
                        category: "erenor",
                        stats: activeTiers.map((t) => `${t.numPieces}pc: ${t.summary}`),
                        summary: activeTiers.map((t) => `${t.numPieces}pc: ${t.summary}`).join(" · "),
                    });
                }
            }
        }
    }

    return summaries;
}

const CORE_ATTR_AND_MAIN_IDS = new Set([0, 1, 2, 3, 4, 8, 33, 34, 35, 64, 175]);

/**
 * Compute all exact stats granted by a single equipped gear slot (base armor/weapon main stats,
 * primary attributes STR/AGI/STA/INT/SPI, distinct equip effects, lunafrost/lunagem/synthesis bonuses,
 * item & Erenor lunafrost set effects with live piece counts, and GS).
 */
export function computeGearItemGrantedStats(
    slotOrItem,
    slotIdOverride = null,
    allSlots = null,
    activeModifiers = null
) {
    const item = slotOrItem?.item !== undefined ? slotOrItem.item : slotOrItem;
    const eq = item?.equipment;
    if (!item || !eq) return null;

    const slotId = Number(slotIdOverride ?? slotOrItem?.id ?? item.slotid ?? -1);
    const oEquip = {};
    const oEnchant = {};
    const oAll = {};

    const addBoth = (targetObj, aid, val) => {
        addAttr(targetObj, aid, val);
        addAttr(oAll, aid, val);
    };

    if (Array.isArray(eq.equipeffects)) {
        const gid = item.grade?.id;
        let matching = eq.equipeffects.filter((e) => e.item_grade_id === gid);
        if (matching.length === 0 && gid === 1) {
            matching = eq.equipeffects.filter((e) => e.item_grade_id === 0);
        }
        for (const eff of matching) addBoth(oEquip, eff.unit_attribute_id, eff.value);
    }

    if (
        Array.isArray(eq.buff_json) &&
        eq.buff_json.length > 0 &&
        (!Array.isArray(eq.equipeffects) ||
            eq.equipeffects.length === 0 ||
            eq.buff_json[0].unit_attribute_id != eq.equipeffects[0].unit_attribute_id)
    ) {
        const seen = new Set();
        for (const eff of eq.buff_json) {
            if (seen.has(eff.unit_attribute_id)) continue;
            seen.add(eff.unit_attribute_id);
            addBoth(oEquip, eff.unit_attribute_id, eff.value);
        }
    }

    if (Array.isArray(eq.modifiers_json)) {
        for (const eff of eq.modifiers_json) addBoth(oEquip, eff.unit_attribute_id, eff.value);
    }

    if (item.lunafrost) {
        for (const eff of Array.isArray(item.lunafrost.effects) ? item.lunafrost.effects : []) {
            addBoth(oEnchant, eff.unit_attribute_id, eff.value);
        }
    }

    if (Array.isArray(item.lunagem)) {
        for (const g of item.lunagem) {
            for (const eff of Array.isArray(g?.effects) ? g.effects : []) {
                addBoth(oEnchant, eff.unit_attribute_id, eff.value);
            }
        }
    }

    if (Array.isArray(item.sythisis_stat) && eq.synth_percentage >= 0 && eq.synth_percentage <= 100) {
        for (const st of item.sythisis_stat) {
            if (!st) continue;
            const rawV =
                Number(st.minvalue) +
                (Number(st.maxvalue) - Number(st.minvalue)) * (eq.synth_percentage / 100);
            const div = SCALING_MAP[st.unit_attribute_id] || 1;
            let y = (rawV / div).toFixed(1);
            if (st.unit_attribute_id >= 0 && st.unit_attribute_id < 5) {
                y = Math.round(Number(y)).toFixed(1);
            }
            const numY = Number(y);
            oEnchant[st.unit_attribute_id] = (oEnchant[st.unit_attribute_id] || 0) + numY;
            oAll[st.unit_attribute_id] = (oAll[st.unit_attribute_id] || 0) + numY;
        }
    }

    const basePdef = calculateItemMain(item, "pdef") || 0;
    const baseMdef = calculateItemMain(item, "mdef") || 0;
    const baseAtk = slotId !== 16 ? calculateItemMain(item, "atk") || 0 : 0;
    const baseRatk = calculateItemMain(item, "ratk") || 0;
    const baseMatk = calculateItemMain(item, "matk") || 0;
    const baseHeal = calculateItemMain(item, "heal") || 0;

    const pdef = Math.round(basePdef + (oAll[8] || 0));
    const mdef = Math.round(baseMdef + (oAll[64] || 0));
    const meleeAttack = Number((baseAtk + (oAll[33] || 0)).toFixed(1));
    const rangedAttack = Number((baseRatk + (oAll[34] || 0)).toFixed(1));
    const magicAttack = Number((baseMatk + (oAll[35] || 0)).toFixed(1));
    const healingPower = Number((baseHeal + (oAll[175] || 0)).toFixed(1));

    const attributes = {
        str: Math.round((calculateItemStat(item, "str") || 0) + (oAll[0] || 0)),
        agi: Math.round((calculateItemStat(item, "dex") || 0) + (oAll[1] || 0)),
        sta: Math.round((calculateItemStat(item, "sta") || 0) + (oAll[2] || 0)),
        int: Math.round((calculateItemStat(item, "int") || 0) + (oAll[3] || 0)),
        spi: Math.round((calculateItemStat(item, "spi") || 0) + (oAll[4] || 0)),
    };

    const equipEffects = summarizeAttrMap(oEquip);
    const enchantBonuses = summarizeAttrMap(oEnchant, { excludeIds: CORE_ATTR_AND_MAIN_IDS });
    const bonuses = summarizeAttrMap(oAll, { excludeIds: CORE_ATTR_AND_MAIN_IDS });

    const setEffects = [];
    const equipNotes = [];
    const enchantNotes = [];
    const specialEffect = getItemSpecialEffect(eq.id);
    const t7Effect = getT7ObsidianSpecialEffect(eq.id);
    if (specialEffect) {
        equipNotes.push({
            name: specialEffect.label || (t7Effect ? "T7 Obsidian Effect" : "Equip Effect"),
            text: specialEffect.text,
            shortText: specialEffect.shortText,
            kind: t7Effect ? "t7" : "special",
            engineFactored: Boolean(specialEffect.engineFactored),
        });
    }
    if (Array.isArray(eq.seteffects) && eq.seteffects.length > 0) {
        const grp = buildSetEffectGroup(eq.seteffects, inferEquipmentSetName(eq.name), "equipment", allSlots);
        if (grp) setEffects.push(grp);
    }
    const charmInfo = item.lunafrost ? resolveCostumeCharmInfo(item.lunafrost, allSlots, activeModifiers) : null;
    if (charmInfo) {
        setEffects.push({
            setId: `charm_${charmInfo.id}`,
            name: `${charmInfo.name} · ${charmInfo.setName}`,
            sourceKind: "charm",
            equippedCount: charmInfo.enlightenedCount,
            maxPieces: 2,
            active: charmInfo.active,
            statusLabel: charmInfo.statusLabel,
            tiers: [
                {
                    numPieces: 2,
                    active: charmInfo.active,
                    entries: [],
                    summary: charmInfo.fullDesc,
                },
            ],
        });
    } else if (Array.isArray(item.lunafrost?.seteffects) && item.lunafrost.seteffects.length > 0) {
        const lfName = String(item.lunafrost.name || "Lunafrost").trim();
        const grp = buildSetEffectGroup(item.lunafrost.seteffects, `${lfName} Set`, "lunafrost", allSlots);
        if (grp) setEffects.push(grp);
    } else if (
        item.lunafrost &&
        (!Array.isArray(item.lunafrost.effects) || item.lunafrost.effects.length === 0) &&
        String(item.lunafrost.effect_text || "").trim()
    ) {
        enchantNotes.push({
            name: String(item.lunafrost.name || "Lunafrost").trim(),
            text: String(item.lunafrost.effect_text).replace(/\s+/g, " ").trim(),
        });
    }

    return {
        gearScore: calculateItemGearscore(item) || 0,
        main: {
            pdef,
            mdef,
            meleeAttack,
            rangedAttack,
            magicAttack,
            healingPower,
        },
        baseMain: {
            pdef: Math.round(basePdef),
            mdef: Math.round(baseMdef),
            meleeAttack: Number(baseAtk.toFixed(1)),
            rangedAttack: Number(baseRatk.toFixed(1)),
            magicAttack: Number(baseMatk.toFixed(1)),
            healingPower: Number(baseHeal.toFixed(1)),
        },
        attributes,
        equipEffects,
        equipNotes,
        enchantBonuses,
        enchantNotes,
        bonuses,
        setEffects,
        charmInfo,
        t7Effect,
    };
}

function getStatWeights(eq, statKey) {
    let total = 0;
    let count = 0;
    for (const k of ["str", "dex", "sta", "spi", "int"]) {
        const w = Number(eq[`${k}_weight`]) || 0;
        total += w;
        if (w > 0) count++;
    }
    return { statWeight: Number(eq[`${statKey}_weight`]) || 0, totalStatWeight: total, modifiersCount: count };
}

function calculateHoldableStat(item, statKey) {
    const eq = item.equipment;
    const mult = [
        "Club", "Bow", "Dagger", "Sword", "Katana", "Axe", "Scepter", "Shortspear",
        "Shield", "Magic Shield", "Obsidian Katana", "Obsidian Shortspear",
        "Offhand Magic Dagger", "Offhand Healing Scepter", "Offhand Dagger", "Lute", "Flute",
    ].includes(eq.type)
        ? 100
        : 150;
    const { statWeight, totalStatWeight, modifiersCount } = getStatWeights(eq, statKey);
    if (statWeight === 0 || totalStatWeight === 0) return 0;
    let r = modifiersCount === 1 ? 3 : modifiersCount === 2 ? 1.5 : 1;
    r = Math.pow(r, 1 / 1.1);
    const g = 3.5 * eq.level * r * 0.1;
    const et = ((modifiersCount * g * statWeight) / totalStatWeight) * item.grade.stat_mod * 0.01 + 0.5;
    return et < 1 ? 0 : Math.floor(et * mult * 0.01);
}

function calculateItemStat(item, statKey) {
    if (!item?.equipment || !item?.grade) return 0;
    const t = item.equipment.type;
    if (["Cloak", "Synthesis Gear"].includes(t)) return 0;
    if (!["Cloth", "Leather", "Plate", "Necklace", "Earring", "Ring"].includes(t)) {
        return calculateHoldableStat(item, statKey);
    }
    const { statWeight, totalStatWeight, modifiersCount } = getStatWeights(item.equipment, statKey);
    if (statWeight === 0 || totalStatWeight === 0) return 0;
    const cov = getCoverage(item.equipment);
    let g = modifiersCount === 1 ? 3 : modifiersCount === 2 ? 1.5 : 1;
    g = Math.pow(g, 1 / 1.1);
    const et = 3.5 * item.equipment.level * g * 0.9 * cov * 0.01;
    const l = ((modifiersCount * et * statWeight) / totalStatWeight) * item.grade.stat_mod * 0.01 + 0.5;
    return Math.floor(l);
}

function calculateItemGearscore(item) {
    let baseGs = 0;
    if (item?.equipment && item?.grade) {
        const eq = item.equipment;
        const t = eq.type;
        if (!["Synthesis Gear", "Glider"].includes(t)) {
            let slotGs;
            if (["Cloth", "Leather", "Plate", "Necklace", "Earring", "Ring", "Cloak"].includes(t)) {
                const sid = Array.isArray(eq.slotid) ? eq.slotid : [];
                if (sid.includes(1)) slotGs = 360;
                else if (sid.includes(2)) slotGs = 600;
                else if (sid.includes(3) || sid.includes(4)) slotGs = 120;
                else if (sid.includes(5) || sid.includes(8)) slotGs = 240;
                else if (sid.includes(7)) slotGs = 480;
                else if (sid.includes(10)) slotGs = 180;
                else if (sid.includes(6)) slotGs = 340;
                else slotGs = 120;
            } else {
                const oneHandLike = [
                    "Club", "Bow", "Dagger", "Sword", "Katana", "Axe", "Scepter", "Shortspear",
                    "Shield", "Magic Shield", "Obsidian Katana", "Obsidian Shortspear",
                    "Offhand Magic Dagger", "Offhand Healing Scepter", "Offhand Dagger",
                ];
                if (oneHandLike.includes(t)) slotGs = 800;
                else if (["Flute", "Lute"].includes(t)) slotGs = 200;
                else slotGs = 1200;
            }
            baseGs = (slotGs * eq.level * (item.grade.main_mod / 100)) / 100;
        }
    }
    let extra = 0;
    if (item?.lunafrost?.level) extra += Number(item.lunafrost.level) * 0.5;
    if (Array.isArray(item?.lunagem)) {
        for (const g of item.lunagem) extra += Number(g?.level) || 0;
    }
    return Number((baseGs + extra).toFixed(1));
}

/**
 * Exact DaruGear `kg.calculateTotalStats(player, slots)` implementation.
 */
export function calculateDaruGearStats(player, slots) {
    const n = {
        health: Number(player?.health ?? 8350),
        mana: Number(player?.mana ?? 5600),
        str: Number(player?.str ?? 158),
        dex: Number(player?.dex ?? 158),
        sta: Number(player?.sta ?? 158),
        spi: Number(player?.spi ?? 158),
        int: Number(player?.int ?? 158),
        gearscore: 0,
        atk: 0,
        matk: 0,
        ratk: 0,
        heal: 0,
        pdef: 0,
        mdef: 0,
    };

    const o = {};
    const appliedSets = [];

    // 1. Equipment & active buffs on player.equipment_buff
    // Fix DaruGear's Plate Set bug (#717 4pc / #740 7pc): DaruGear's setGearBuffs accidentally
    // overwrote unit_attribute_id 6 (+3%/+5% Max HP) with the entire Armor Grade Buff HP (double-counting
    // +9,267/+11,916 HP) and left id 8 (+3% PDef) as +3 flat PDef. Always apply AA Classic 3.5's real % buffs.
    if (Array.isArray(player?.equipment_buff)) {
        for (const b of player.equipment_buff) {
            const bid = Number(b?.id);
            if (bid === 740) {
                addAttr(o, 995, 5);
                addAttr(o, 994, 3);
                continue;
            }
            if (bid === 717) {
                addAttr(o, 995, 3);
                addAttr(o, 994, 3);
                continue;
            }
            for (const eff of Array.isArray(b?.data) ? b.data : []) {
                addAttr(o, eff.unit_attribute_id, eff.value);
            }
        }
    }

    // 2. Selected passives from player.playerclass (exact DaruGear remapping)
    const pc = player?.playerclass;
    if (pc) {
        const applyTreePassives = (treeObj, remapMelee96) => {
            for (const p of Array.isArray(treeObj?.Passive) ? treeObj.Passive : []) {
                if (!p?.selected || !Array.isArray(p.buff_data)) continue;
                for (const eff of p.buff_data) {
                    let aid = eff.unit_attribute_id;
                    if (aid == 4) aid = 997;
                    else if (aid == 7) aid = 996;
                    else if (remapMelee96 && aid == 96) aid = 998;
                    addAttr(o, aid, eff.value);
                }
            }
        };
        applyTreePassives(pc.skill1, true);
        applyTreePassives(pc.skill2, false);
        applyTreePassives(pc.skill3, false);
    }

    let hasMainhand = false;
    let hasShield = false;

    // 3. All equipped slots
    for (const slot of slots || []) {
        const item = slot?.item;
        const eq = item?.equipment;
        if (!eq) continue;

        n.gearscore += calculateItemGearscore(item) || 0;
        n.str += calculateItemStat(item, "str") || 0;
        n.dex += calculateItemStat(item, "dex") || 0;
        n.sta += calculateItemStat(item, "sta") || 0;
        n.spi += calculateItemStat(item, "spi") || 0;
        n.int += calculateItemStat(item, "int") || 0;

        if (slot.id != 16) n.atk += calculateItemMain(item, "atk") || 0;
        n.matk += calculateItemMain(item, "matk") || 0;
        n.ratk += calculateItemMain(item, "ratk") || 0;
        n.heal += calculateItemMain(item, "heal") || 0;
        n.pdef += calculateItemMain(item, "pdef") || 0;
        n.mdef += calculateItemMain(item, "mdef") || 0;

        if (slot.id == 15) hasMainhand = true;
        if (slot.id == 16 && ["Shield", "Magic Shield"].includes(eq.type)) hasShield = true;

        if (Array.isArray(eq.equipeffects)) {
            const gid = item.grade?.id;
            let matching = eq.equipeffects.filter((e) => e.item_grade_id === gid);
            if (matching.length === 0 && gid === 1) {
                matching = eq.equipeffects.filter((e) => e.item_grade_id === 0);
            }
            for (const eff of matching) {
                addAttr(o, eff.unit_attribute_id, eff.value);
            }
        }

        if (
            Array.isArray(eq.buff_json) &&
            eq.buff_json.length > 0 &&
            (!Array.isArray(eq.equipeffects) ||
                eq.equipeffects.length === 0 ||
                eq.buff_json[0].unit_attribute_id != eq.equipeffects[0].unit_attribute_id)
        ) {
            const seen = new Set();
            for (const eff of eq.buff_json) {
                if (seen.has(eff.unit_attribute_id)) continue;
                seen.add(eff.unit_attribute_id);
                addAttr(o, eff.unit_attribute_id, eff.value);
            }
        }

        if (Array.isArray(eq.modifiers_json)) {
            for (const eff of eq.modifiers_json) {
                addAttr(o, eff.unit_attribute_id, eff.value);
            }
        }

        if (Array.isArray(eq.seteffects) && eq.seteffects.length > 0) {
            const setId = eq.seteffects[0].equip_item_set_id;
            const pieceCnt = getPieceCount(setId, slots);
            for (const se of eq.seteffects) {
                const { aid, rawVal } = normalizeSetEffectEntry(se);
                if (
                    aid != null &&
                    pieceCnt >= se.num_pieces &&
                    !appliedSets.some(
                        (x) =>
                            x.unit_attribute_id === aid &&
                            x.equip_item_set_id === se.equip_item_set_id
                    )
                ) {
                    addAttr(o, aid, rawVal);
                    appliedSets.push({
                        unit_attribute_id: aid,
                        equip_item_set_id: se.equip_item_set_id,
                    });
                }
            }
        }

        if (item.lunafrost) {
            for (const eff of Array.isArray(item.lunafrost.effects) ? item.lunafrost.effects : []) {
                addAttr(o, eff.unit_attribute_id, eff.value);
            }
            if (Array.isArray(item.lunafrost.seteffects) && item.lunafrost.seteffects.length > 0) {
                const setId = item.lunafrost.seteffects[0].equip_item_set_id;
                const pieceCnt = getPieceCount(setId, slots);
                for (const se of item.lunafrost.seteffects) {
                    if (
                        pieceCnt >= se.num_pieces &&
                        !appliedSets.some(
                            (x) =>
                                x.unit_attribute_id === se.unit_attribute_id &&
                                x.equip_item_set_id === se.equip_item_set_id
                        )
                    ) {
                        addAttr(o, se.unit_attribute_id, se.calculated_value);
                        appliedSets.push({
                            unit_attribute_id: se.unit_attribute_id,
                            equip_item_set_id: se.equip_item_set_id,
                        });
                    }
                }
            }
        }

        if (Array.isArray(item.lunagem)) {
            for (const g of item.lunagem) {
                for (const eff of Array.isArray(g?.effects) ? g.effects : []) {
                    addAttr(o, eff.unit_attribute_id, eff.value);
                }
            }
        }

        if (Array.isArray(item.sythisis_stat) && eq.synth_percentage >= 0 && eq.synth_percentage <= 100) {
            for (const st of item.sythisis_stat) {
                const rawV = Number(st.minvalue) + (Number(st.maxvalue) - Number(st.minvalue)) * (eq.synth_percentage / 100);
                const div = SCALING_MAP[st.unit_attribute_id] || 1;
                let y = (rawV / div).toFixed(1);
                if (st.unit_attribute_id >= 0 && st.unit_attribute_id < 5) {
                    y = Math.round(Number(y)).toFixed(1);
                }
                o[st.unit_attribute_id] = (o[st.unit_attribute_id] || 0) + Number(y);
            }
        }
    }

    // 4. Final derived stats (exact DaruGear order of operations)
    n.str += o[0] || 0;
    n.dex += o[1] || 0;
    n.sta += o[2] || 0;
    n.spi += o[4] || 0;
    n.spi += Number(Math.round(n.spi * ((o[997] || 0) / 100)) || 0);
    n.int += o[3] || 0;

    n.health += o[6] || 0;
    n.mana += o[7] || 0;
    n.mana += Number(Math.round(n.mana * ((o[996] || 0) / 100)) || 0);

    n.pdef += o[8] || 0;
    n.pdef += Number(Math.round(n.pdef * ((o[994] || 0) / 100)) || 0);
    n.mdef += o[64] || 0;

    n.atk += o[33] || 0;
    n.matk += o[35] || 0;
    n.ratk += o[34] || 0;
    n.heal += o[175] || 0;

    let casttime = 100 + (o[71] || 0);
    if (casttime < 40) casttime = 40;
    n.casttime = Number(casttime.toFixed(1));

    n.attackspeed = (o[54] || 0) + (o[218] || 0);

    n.meleeAccuracy = Number(Math.min(0.01225 * (n.str + n.spi) + 90.8 + (o[78] || 0), 100).toFixed(1));
    n.magicAccuracy = Number(Math.min(0.01225 * (n.int + n.spi) + 90.8 + (o[88] || 0), 100).toFixed(1));
    n.rangedAccuracy = Number(Math.min(0.01225 * (n.dex + n.spi) + 90.8 + (o[83] || 0), 100).toFixed(1));

    n.meleeCritRate = Number((0.0275 * n.dex + (o[77] || 0)).toFixed(1));
    n.rangedCritRate = Number((0.01375 * (n.dex + n.int) + (o[82] || 0)).toFixed(1));
    n.magicCritRate = Number((0.0275 * n.int + (o[86] || 0)).toFixed(1));
    n.healCritRate = Number((0.0275 * n.spi + (o[185] || 0)).toFixed(1));

    n.meleeCritBonus = Number((50 + (o[17] || 0)).toFixed(1));
    n.rangedCritBonus = Number((50 + (o[26] || 0)).toFixed(1));
    n.magicCritBonus = Number((50 + (o[31] || 0)).toFixed(1));
    n.healCritBonus = Number((50 + (o[176] || 0)).toFixed(1));

    n.meleeBack = Number((o[121] || 0).toFixed(1));
    n.rangedBack = Number((o[122] || 0).toFixed(1));
    n.magicBack = Number((o[123] || 0).toFixed(1));

    n.meleeMul = Number((o[51] || 0).toFixed(1));
    n.rangedMul = Number((o[52] || 0).toFixed(1));
    n.magicMul = Number((o[53] || 0).toFixed(1));
    n.healMul = Number((o[120] || 0).toFixed(1));

    n.focus = Number((o[181] || 0).toFixed(0));
    n.shieldPenRate = Number((o[204] || 0).toFixed(1));
    n.shieldPen = Number((o[206] || 0).toFixed(1));
    n.defPen = Number((o[57] || 0).toFixed(0));
    n.magicDefPen = Number((o[184] || 0).toFixed(0));

    n.pdef = Math.round(n.pdef);
    n.mdef = Math.round(n.mdef) + n.spi;

    n.parry = hasMainhand ? Number((0.006 * n.sta + 0.00625 * n.str + (o[81] || 0)).toFixed(1)) : 0;
    n.shieldBlockRate = hasShield ? Number((0.0165 * n.str + (o[179] || 0)).toFixed(1)) : 0;
    n.evasion = Number((0.0109 * n.int + 0.0109 * n.dex + (o[180] || 0)).toFixed(1));

    n.resilience = Number((o[183] || 0).toFixed(0));
    n.toughness = Number((o[182] || 0).toFixed(0));

    // Note: in AA Classic / DaruGear, negative o[58]/o[143]/o[145]/o[147] means Damage Reduction (DR).
    // Negating gives positive DR% (and negative for vulnerability like Mirror Light +12% -> -12% DR).
    n.meleeIncomingMul = Number((-((o[58] || 0) + (o[143] || 0))).toFixed(1));
    n.rangedIncomingMul = Number((-((o[58] || 0) + (o[145] || 0))).toFixed(1));
    n.magicIncomingMul = Number((-((o[58] || 0) + (o[147] || 0))).toFixed(1));

    // In AA Classic / DaruGear, o[142] (Melee), o[144] (Ranged), and o[146] (Magic) are negative for Fixed DR
    // (e.g. -15 on Honorhewn Warden / Shield-Bearer / Last Line Lunafrosts & Cloak synthesis).
    // Negating each by its own damage type yields positive Fixed DR without cross-leaking or dropping Ranged/Magic.
    n.meleeIncomingFixed = Number(Math.max(0, Math.round((n.pdef / (n.pdef + 9000)) * 100 - (o[142] || 0))).toFixed(0));
    n.rangedIncomingFixed = Number(Math.max(0, Math.round((n.pdef / (n.pdef + 9000)) * 100 - (o[144] || 0))).toFixed(0));
    n.magicIncomingFixed = Number(Math.max(0, Math.round((n.mdef / (n.mdef + 9000)) * 100 - (o[146] || 0))).toFixed(0));
    n.receivedHealing = Number((o[56] || 0).toFixed(1));

    n.atk += n.str * 0.2;
    n.ratk += n.dex * 0.2;
    n.heal += n.spi * 0.2;
    n.matk += n.int * 0.2;
    n.mana += n.int * 12;
    n.health += n.sta * 12;
    n.health += Number(Math.round(n.health * ((o[995] || 0) / 100)) || 0);

    n.atk += n.atk * ((o[998] || 0) / 100);
    n.ratk += n.ratk * ((o[999] || 0) / 100);
    n.matk += n.matk * ((o[87] || 0) / 100);

    n.gearscore = Number(n.gearscore.toFixed(1));
    n.atk = Number(n.atk.toFixed(2));
    n.matk = Number(n.matk.toFixed(2));
    n.ratk = Number(n.ratk.toFixed(2));
    n.heal = Number(n.heal.toFixed(2));

    return n;
}

/**
 * Convert a raw DaruGear Share API payload `{ slots, player }` into the exact
 * bookmarklet-compatible export object consumed by `parseImportPayload` / `fromDaruGearExport`.
 */
export function buildDaruGearExportFromApiPayload(apiPayload, shareCode = null) {
    const slots = Array.isArray(apiPayload?.slots) ? apiPayload.slots : [];
    const player = apiPayload?.player || {};
    const code = shareCode || apiPayload?.hash || null;
    const darugearUrl = code ? `https://darugear.com/?s=${code}` : null;

    const stats = calculateDaruGearStats(player, slots);
    const skillBuild = extractSkillBuildFromDaruGearPlayerClass(player.playerclass);
    const className = skillBuild?.className || player.playerclass?.class_name || player.playerclass?.name || null;
    const title = player.title?.name ? String(player.title.name).trim() : null;
    const name = className
        ? code
            ? `${className} (${code})`
            : className
        : code
          ? `DaruGear (${code})`
          : "DaruGear Build";

    // Equipment list (same format as bookmarklet)
    const equipment = [];
    for (const s of slots) {
        if (!s?.item?.equipment) continue;
        const it = s.item;
        const eq = it.equipment;
        const gr = it.grade || {};
        const cleanIcon = eq.img ? String(eq.img).replace(/\\/g, "/").replace(/^\/+/, "") : null;
        const lf =
            it.lunafrost && (it.lunafrost.name || it.lunafrost.effect_text)
                ? {
                      name: String(it.lunafrost.name || "").trim(),
                      text: String(it.lunafrost.effect_text || "").replace(/\s+/g, " ").trim(),
                  }
                : null;
        const gems = Array.isArray(it.lunagem)
            ? it.lunagem
                  .filter((g) => g && g.id !== 0 && (g.name || g.effect_text))
                  .map((g) => ({
                      name: String(g.name || "").trim(),
                      text: String(g.effect_text || "").replace(/\s+/g, " ").trim(),
                  }))
            : [];
        const synPct = Number.isFinite(Number(eq.synth_percentage)) ? Number(eq.synth_percentage) : 100;
        const synthStats = [];
        for (const st of Array.isArray(it.sythisis_stat) ? it.sythisis_stat : []) {
            if (!st || !st.display_text) continue;
            const minV = Number(st.minvalue) || 0;
            const maxV = Number(st.maxvalue) || minV;
            const rawV = minV + (maxV - minV) * (synPct / 100);
            const dt = String(st.display_text).split("\n")[0].replace(/[+%]+$/, "").trim();
            const isPctStat = /rate|bonus|damage|speed|time|reduction|parry|block|evasion|healing|accuracy|backstab/i.test(dt);
            const div = SCALING_MAP[st.unit_attribute_id] || 1;
            const scaledV = rawV / div;
            const fmtV =
                Math.abs(scaledV - Math.round(scaledV)) < 0.05
                    ? String(Math.round(scaledV))
                    : scaledV.toFixed(1);
            const sign = scaledV >= 0 ? "+" : "";
            synthStats.push(`${dt} ${sign}${fmtV}${isPctStat && !/healing power/i.test(dt) ? "%" : ""}`);
        }
        const gradeId = Number(gr.id) || 0;
        const CANONICAL_GRADE_COLORS = {
            0: "#8c8c8c",
            1: "#b0b0b0",
            2: "#52d669",
            3: "#4da3ff",
            4: "#d96ef5",
            5: "#f2c94c",
            6: "#f07b42",
            7: "#ff5c6a",
            8: "#d9a466",
            9: "#f0f6ff",
            10: "#ffb326",
            11: "#ef233c",
            12: "#e85dff",
        };
        const eqEntry = {
            slotId: Number(s.id),
            slotName: String(s.name || `Slot ${s.id}`).trim(),
            ...(Number(eq.id) > 0 ? { itemId: Number(eq.id) } : {}),
            name: String(eq.name || "").trim(),
            type: String(eq.type || "").trim(),
            icon: cleanIcon,
            gradeId,
            gradeName: String(gr.name || "").trim(),
            gradeColor: CANONICAL_GRADE_COLORS[gradeId] || (gr.colour ? String(gr.colour).trim() : null),
        };
        if (Number(it.ptemper) > 100) eqEntry.ptemper = Number(it.ptemper);
        if (Number(it.mtemper) > 100) eqEntry.mtemper = Number(it.mtemper);
        if (lf) eqEntry.lunafrost = lf;
        if (gems.length > 0) eqEntry.lunagems = gems;
        if (synthStats.length > 0) eqEntry.synthStats = synthStats;
        equipment.push(eqEntry);
    }

    // Weapon archetype & Shield PDef
    const mhSlot = slots.find((s) => s && s.id == 15);
    const ohSlot = slots.find((s) => s && s.id == 16);
    const mhType = mhSlot?.item?.equipment?.type || "";
    const ohItem = ohSlot?.item || null;
    const ohType = ohItem?.equipment?.type || "";
    let hasShield = false;
    let shieldPdef = 0;
    let equipmentType = null;

    if (ohType === "Shield" || ohType === "Magic Shield") {
        hasShield = true;
        equipmentType = ohType === "Magic Shield" ? "magic_shield" : "shield";
        if (ohType === "Shield") {
            shieldPdef = calculateItemMain(ohItem, "pdef") || 0;
        }
    } else if (ohItem?.equipment) {
        equipmentType = "dual_wield";
    } else if (
        ["Greatclub", "Staff", "Longspear", "Nodachi", "Greatsword", "GreatAxe", "Warclub", "Scythe"].includes(mhType)
    ) {
        equipmentType = "two_hand";
    }

    // Active buffs list (same deduplication/tagging as bookmarklet)
    const seenBuff = new Set();
    const darugearBuffs = [];
    const titleBuffId = player.title ? player.title.buff_id || player.title.id || null : null;
    const optIds = new Set(
        (Array.isArray(player.buff) ? player.buff : []).map((b) => String(b?.id || b?.buff_id || b?.name || ""))
    );
    const allRawBuffs = [
        ...(Array.isArray(player.buff) ? player.buff : []),
        ...(Array.isArray(player.equipment_buff) ? player.equipment_buff : []),
    ];
    for (const b of allRawBuffs) {
        if (!b || !b.name) continue;
        const rawId = b.buff_id || b.id || null;
        const bName = String(b.name).trim();
        const key = `${rawId || ""}:${bName.toLowerCase()}`;
        if (seenBuff.has(key)) continue;
        seenBuff.add(key);
        const isTitle = Boolean(title && bName === title) || Boolean(titleBuffId && rawId == titleBuffId);
        const isOptional = Boolean(b.is_optional) || optIds.has(String(b.id || b.buff_id || b.name));
        const entry = {
            id: rawId ? Number(rawId) || null : null,
            name: bName,
            isOptional: isTitle ? false : isOptional,
        };
        if (isTitle) entry.isTitle = true;
        darugearBuffs.push(entry);
    }

    const passives = skillBuild?.passives || [];
    const dualWieldRangedParry =
        equipmentType === "dual_wield" &&
        passives.some((p) => String(p).toLowerCase() === "dual-wield proficiency");

    return {
        schemaVersion: 1,
        source: "darugear",
        metadata: {
            source: "darugear",
            darugearUrl,
            shareCode: code,
            className,
            title,
            equipmentType,
            gearScore: stats.gearscore,
            darugearBuffs,
            passives,
            importedAt: new Date().toISOString(),
        },
        shareUrl: darugearUrl,
        darugearUrl,
        shareCode: code,
        className,
        title,
        equipmentType,
        darugearBuffs,
        passives,
        ...(skillBuild ? { skillBuild } : {}),
        rawDaruGear: {
            slots,
            player: {
                version: player?.version ?? 1.3,
                health: Number(player?.health ?? 8350),
                mana: Number(player?.mana ?? 5600),
                str: Number(player?.str ?? 158),
                dex: Number(player?.dex ?? 158),
                sta: Number(player?.sta ?? 158),
                spi: Number(player?.spi ?? 158),
                int: Number(player?.int ?? 158),
                title: player?.title || null,
            },
        },
        equipment,
        name,
        level: 55,
        gearScore: stats.gearscore,
        maxHealth: stats.health,
        maxMana: stats.mana,
        baseAttributes: {
            str: Math.round(Number(player?.str ?? 158)),
            agi: Math.round(Number(player?.dex ?? 158)),
            sta: Math.round(Number(player?.sta ?? 158)),
            int: Math.round(Number(player?.int ?? 158)),
            spi: Math.round(Number(player?.spi ?? 158)),
        },
        attributes: {
            str: stats.str,
            int: stats.int,
            agi: stats.dex,
            spi: stats.spi,
            sta: stats.sta,
        },
        offense: {
            meleeAttack: stats.atk,
            rangedAttack: stats.ratk,
            magicAttack: stats.matk,
            healingPower: stats.heal,
            meleeAccuracyPct: stats.meleeAccuracy,
            rangedAccuracyPct: stats.rangedAccuracy,
            magicAccuracyPct: stats.magicAccuracy,
            meleeCritRatePct: stats.meleeCritRate,
            rangedCritRatePct: stats.rangedCritRate,
            magicCritRatePct: stats.magicCritRate,
            healCritRatePct: stats.healCritRate,
            meleeCritBonusPct: stats.meleeCritBonus,
            rangedCritBonusPct: stats.rangedCritBonus,
            magicCritBonusPct: stats.magicCritBonus,
            healCritBonusPct: stats.healCritBonus,
            meleeSkillDamagePct: stats.meleeMul,
            rangedSkillDamagePct: stats.rangedMul,
            magicSkillDamagePct: stats.magicMul,
            healingPct: stats.healMul,
            backstabMeleeDamagePct: stats.meleeBack,
            backstabRangedDamagePct: stats.rangedBack,
            backstabMagicDamagePct: stats.magicBack,
            focus: stats.focus,
            shieldDefPenRatePct: stats.shieldPenRate,
            shieldDefPenPct: stats.shieldPen,
            defensePenetration: stats.defPen,
            magicDefensePenetration: stats.magicDefPen,
            attackSpeed: stats.attackspeed,
            castTimePct: stats.casttime,
        },
        defense: {
            physicalDefense: stats.pdef,
            magicDefense: stats.mdef,
            shieldPhysicalDefense: shieldPdef,
            hasShield,
            dualWieldRangedParry,
            parryPct: stats.parry,
            blockPct: stats.shieldBlockRate,
            evasionPct: stats.evasion,
            resilience: stats.resilience,
            toughness: stats.toughness,
            receivedMeleeDrPct: stats.meleeIncomingMul,
            receivedRangedDrPct: stats.rangedIncomingMul,
            receivedMagicDrPct: stats.magicIncomingMul,
            fixedMeleeDr: stats.meleeIncomingFixed,
            fixedRangedDr: stats.rangedIncomingFixed,
            fixedMagicDr: stats.magicIncomingFixed,
            receivedHealingPct: stats.receivedHealing,
        },
    };
}
