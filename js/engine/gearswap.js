/**
 * ArcheAge Classic 1.3.6 Gear Swap Engine (Lunagems & Costume / Undergarment Synthesis).
 * Pure math (zero DOM dependencies). Parses DaruGear lunagem & synthesis stat lines and
 * applies exact reversible stat deltas so Build A vs Build B quick comparisons stay 100% synced.
 */

import { getEquippedSpecialEffects } from "../adapters/darugear_calc.js";
import { applyAttributeDelta } from "./stats.js";

export const LUNAGEM_SWAP_PRESETS = Object.freeze([
    {
        id: "pdef",
        label: "Physical Defense",
        gemName: "Lucid Wave Lunagem: Defense",
        defaultValue: 100,
        unit: "",
        formatText: (v) => `Physical Defense Increase +${v}`,
        slots: ["Head", "Chest", "Waist", "Wrists", "Hands", "Legs", "Feet"],
        buildDelta: (v) => ({ addDefense: { physicalDefense: v } }),
    },
    {
        id: "mdef",
        label: "Magic Defense",
        gemName: "Lucid Earth Lunagem: Magic Defense",
        defaultValue: 100,
        unit: "",
        formatText: (v) => `Magic Defense Increase +${v}`,
        slots: ["Head", "Chest", "Waist", "Wrists", "Hands", "Legs", "Feet"],
        buildDelta: (v) => ({ addDefense: { magicDefense: v } }),
    },
    {
        id: "toughness_hat",
        label: "Toughness (Hat / Hero)",
        gemName: "Hero's Earth Lunagem: Mastery",
        defaultValue: 170,
        unit: "",
        formatText: (v) => `Toughness +${v}`,
        slots: ["Head", "Legs", "Feet"],
        buildDelta: (v) => ({ addDefense: { toughness: v } }),
    },
    {
        id: "toughness_t3",
        label: "Toughness (Radiant T3)",
        gemName: "Radiant Earth Lunagem: Mastery",
        defaultValue: 353,
        unit: "",
        formatText: (v) => `Toughness ${v}`,
        slots: ["Head", "Legs", "Feet"],
        buildDelta: (v) => ({ addDefense: { toughness: v } }),
    },
    {
        id: "resilience_t3",
        label: "Resilience (Radiant T3)",
        gemName: "Radiant Earth Lunagem: Flexibility",
        defaultValue: 480,
        unit: "",
        formatText: (v) => `Resilience ${v}`,
        slots: ["Chest", "Head"],
        buildDelta: (v) => ({ addDefense: { resilience: v } }),
    },
    {
        id: "evasion",
        label: "Evasion %",
        gemName: "Lucid Earth Lunagem: Finesse",
        defaultValue: 3.0,
        unit: "%",
        formatText: (v) => `Evasion Increase ${v}%`,
        slots: ["Hands", "Feet"],
        buildDelta: (v) => ({ addDefense: { evasionPct: v } }),
    },
    {
        id: "parry",
        label: "Parry Rate %",
        gemName: "Lucid Earth Lunagem: Parry",
        defaultValue: 3.0,
        unit: "%",
        formatText: (v) => `Parry Rate +${v}%`,
        slots: ["Hands", "Wrists"],
        buildDelta: (v) => ({ addDefense: { parryPct: v } }),
    },
    {
        id: "block",
        label: "Shield Block %",
        gemName: "Lucid Earth Lunagem: Block",
        defaultValue: 2.0,
        unit: "%",
        formatText: (v) => `Shield Block Rate +${v}%`,
        slots: ["Left Hand Weapon", "Shield"],
        buildDelta: (v) => ({ addDefense: { blockPct: v } }),
    },
    {
        id: "cast_time",
        label: "Cast Time -%",
        gemName: "Lucid Gale Lunagem: Torrent",
        defaultValue: 1.0,
        unit: "%",
        formatText: (v) => `Cast Time Decrease -${v}%`,
        slots: ["Undergarments", "Head"],
        buildDelta: (v) => ({ addOffense: { castTimePct: -Math.abs(v) } }),
    },
    {
        id: "focus",
        label: "Focus",
        gemName: "Lucid Gale Lunagem: Focus",
        defaultValue: 360,
        unit: "",
        formatText: (v) => `Focus +${v}`,
        slots: ["Right Hand Weapon", "Left Hand Weapon"],
        buildDelta: (v) => ({ addOffense: { focus: v } }),
    },
    {
        id: "heal_crit_bonus",
        label: "Crit Heal Bonus %",
        gemName: "Lucid Gale Lunagem: Benevolence",
        defaultValue: 6.0,
        unit: "%",
        formatText: (v) => `Critical Heal Bonus Increase ${v}%`,
        slots: ["Right Hand Weapon", "Left Hand Weapon", "Hands", "Undergarments"],
        buildDelta: (v) => ({ addOffense: { healCritBonusPct: v } }),
    },
    {
        id: "melee_crit_bonus",
        label: "Melee Crit Damage %",
        gemName: "Lucid Gale Lunagem: Fury (Melee)",
        defaultValue: 6.0,
        unit: "%",
        formatText: (v) => `Melee Critical Damage +${v}%`,
        slots: ["Right Hand Weapon", "Left Hand Weapon", "Hands"],
        buildDelta: (v) => ({ addOffense: { meleeCritBonusPct: v } }),
    },
    {
        id: "ranged_crit_bonus",
        label: "Ranged Crit Damage %",
        gemName: "Lucid Gale Lunagem: Fury (Ranged)",
        defaultValue: 6.0,
        unit: "%",
        formatText: (v) => `Ranged Critical Damage +${v}%`,
        slots: ["Ranged Weapon", "Right Hand Weapon"],
        buildDelta: (v) => ({ addOffense: { rangedCritBonusPct: v } }),
    },
    {
        id: "magic_crit_bonus",
        label: "Magic Crit Damage %",
        gemName: "Lucid Gale Lunagem: Fury (Magic)",
        defaultValue: 6.0,
        unit: "%",
        formatText: (v) => `Magic Critical Damage +${v}%`,
        slots: ["Right Hand Weapon", "Left Hand Weapon", "Hands"],
        buildDelta: (v) => ({ addOffense: { magicCritBonusPct: v } }),
    },
    {
        id: "def_pen",
        label: "Defense Penetration",
        gemName: "Lucid Flame Lunagem: Penetration",
        defaultValue: 100,
        unit: "",
        formatText: (v) => `Defense Penetration +${v}`,
        slots: ["Right Hand Weapon", "Left Hand Weapon", "Ranged Weapon"],
        buildDelta: (v) => ({ addOffense: { defensePenetration: v } }),
    },
    {
        id: "mdef_pen",
        label: "Magic Def Penetration",
        gemName: "Lucid Flame Lunagem: Magic Pen",
        defaultValue: 100,
        unit: "",
        formatText: (v) => `Magic Defense Penetration +${v}`,
        slots: ["Right Hand Weapon", "Left Hand Weapon"],
        buildDelta: (v) => ({ addOffense: { magicDefensePenetration: v } }),
    },
    {
        id: "healing_power",
        label: "Healing Power",
        gemName: "Lucid Life Lunagem: Healing",
        defaultValue: 12,
        unit: "",
        formatText: (v) => `Increase Healing Power +${v}`,
        slots: ["Right Hand Weapon", "Left Hand Weapon"],
        buildDelta: (v) => ({ addOffense: { healingPower: v } }),
    },
    // Skill-Specific Wrists / Waist Lunagems (automatically applied to matching skills in combat simulation)
    {
        id: "gem_arc_lightning",
        label: "Skill: Arc Lightning Dmg %",
        gemName: "Lucid Ancient Sorcery Lunagem",
        defaultValue: 4,
        unit: "%",
        formatText: (v) => `Increases Arc Lightning damage +${v}%.`,
        slots: ["Wrists", "Waist"],
        buildDelta: () => ({}),
    },
    {
        id: "gem_flamebolt",
        label: "Skill: Flamebolt Dmg %",
        gemName: "Lucid Ancient Sorcery Lunagem",
        defaultValue: 3,
        unit: "%",
        formatText: (v) => `Increases Flamebolt damage +${v}%.`,
        slots: ["Wrists", "Waist"],
        buildDelta: () => ({}),
    },
    {
        id: "gem_chain_lightning",
        label: "Skill: Chain Lightning Dmg %",
        gemName: "Lucid Ancient Sorcery Lunagem",
        defaultValue: 4,
        unit: "%",
        formatText: (v) => `Increases Chain Lightning damage +${v}%.`,
        slots: ["Wrists", "Waist"],
        buildDelta: () => ({}),
    },
    {
        id: "gem_meteor_strike",
        label: "Skill: Meteor Strike Dmg %",
        gemName: "Lucid Ancient Sorcery Lunagem",
        defaultValue: 4,
        unit: "%",
        formatText: (v) => `Increases Meteor Strike damage +${v}%.`,
        slots: ["Wrists", "Waist"],
        buildDelta: () => ({}),
    },
    {
        id: "gem_precision_strike",
        label: "Skill: Precision Strike Dmg %",
        gemName: "Lucid Eternal Battlerage Lunagem",
        defaultValue: 4,
        unit: "%",
        formatText: (v) => `Increases Precision Strike damage +${v}%.`,
        slots: ["Wrists", "Waist"],
        buildDelta: () => ({}),
    },
    {
        id: "gem_snipe",
        label: "Skill: Snipe Dmg %",
        gemName: "Lucid Eternal Archery Lunagem",
        defaultValue: 4,
        unit: "%",
        formatText: (v) => `Increases Snipe damage +${v}%.`,
        slots: ["Wrists", "Waist"],
        buildDelta: () => ({}),
    },
    {
        id: "gem_endless_arrows",
        label: "Skill: Endless Arrows Dmg %",
        gemName: "Lucid Eternal Archery Lunagem",
        defaultValue: 3,
        unit: "%",
        formatText: (v) => `Increases Endless Arrows damage +${v}%.`,
        slots: ["Wrists", "Waist"],
        buildDelta: () => ({}),
    },
    {
        id: "gem_antithesis_heal",
        label: "Skill: Antithesis Healing %",
        gemName: "Lucid Eternal Vitalism Lunagem",
        defaultValue: 4,
        unit: "%",
        formatText: (v) => `Increases Antithesis healing +${v}%.`,
        slots: ["Wrists", "Waist"],
        buildDelta: () => ({}),
    },
    {
        id: "gem_mend_heal",
        label: "Skill: Mend Healing %",
        gemName: "Lucid Eternal Vitalism Lunagem",
        defaultValue: 4,
        unit: "%",
        formatText: (v) => `Increases Mend healing +${v}%.`,
        slots: ["Wrists", "Waist"],
        buildDelta: () => ({}),
    },
]);

export const COSTUME_SYNTH_PRESETS = Object.freeze([
    {
        id: "pdef",
        label: "Physical Defense",
        defaultValue: 1100,
        unit: "",
        formatText: (v) => `Physical Defense Increase +${v}`,
        buildDelta: (v) => ({ addDefense: { physicalDefense: v } }),
    },
    {
        id: "mdef",
        label: "Magic Defense",
        defaultValue: 1100,
        unit: "",
        formatText: (v) => `Magic Defense Increase +${v}`,
        buildDelta: (v) => ({ addDefense: { magicDefense: v } }),
    },
    {
        id: "resilience",
        label: "Resilience",
        defaultValue: 835,
        unit: "",
        formatText: (v) => `Resilience +${v}`,
        buildDelta: (v) => ({ addDefense: { resilience: v } }),
    },
    {
        id: "toughness",
        label: "Toughness",
        defaultValue: 650,
        unit: "",
        formatText: (v) => `Toughness +${v}`,
        buildDelta: (v) => ({ addDefense: { toughness: v } }),
    },
    {
        id: "recv_all_dr",
        label: "Received Damage -%",
        defaultValue: 3.2,
        unit: "%",
        formatText: (v) => `Decrease Received Damage -${v}%`,
        buildDelta: (v) => ({
            addDefense: {
                receivedMeleeDrPct: Math.abs(v),
                receivedRangedDrPct: Math.abs(v),
                receivedMagicDrPct: Math.abs(v),
            },
        }),
    },
    {
        id: "recv_melee_dr",
        label: "Received Melee Damage -%",
        defaultValue: 2.8,
        unit: "%",
        formatText: (v) => `Received Melee Damage -${v}%`,
        buildDelta: (v) => ({ addDefense: { receivedMeleeDrPct: Math.abs(v) } }),
    },
    {
        id: "recv_ranged_dr",
        label: "Received Ranged Damage -%",
        defaultValue: 2.8,
        unit: "%",
        formatText: (v) => `Received Ranged Damage -${v}%`,
        buildDelta: (v) => ({ addDefense: { receivedRangedDrPct: Math.abs(v) } }),
    },
    {
        id: "recv_magic_dr",
        label: "Received Magic Damage -%",
        defaultValue: 2.8,
        unit: "%",
        formatText: (v) => `Received Magic Damage -${v}%`,
        buildDelta: (v) => ({ addDefense: { receivedMagicDrPct: Math.abs(v) } }),
    },
    {
        id: "max_hp",
        label: "Max Health",
        defaultValue: 1500,
        unit: "",
        formatText: (v) => `Max Health +${v}`,
        buildDelta: (v) => ({ addMaxHealth: v }),
    },
    {
        id: "heal_crit_rate",
        label: "Heal Critical Rate %",
        defaultValue: 4.6,
        unit: "%",
        formatText: (v) => `Increases Heal Critical Rate +${v}%`,
        buildDelta: (v) => ({ addOffense: { healCritRatePct: v } }),
    },
    {
        id: "heal_crit_bonus",
        label: "Heal Critical Bonus %",
        defaultValue: 13.0,
        unit: "%",
        formatText: (v) => `Critical Heal Bonus Increase +${v}%`,
        buildDelta: (v) => ({ addOffense: { healCritBonusPct: v } }),
    },
    {
        id: "healing_power",
        label: "Healing Power",
        defaultValue: 65,
        unit: "",
        formatText: (v) => `Increase Healing Power +${v}`,
        buildDelta: (v) => ({ addOffense: { healingPower: v } }),
    },
    {
        id: "cast_time",
        label: "Cast Time -%",
        defaultValue: 3.2,
        unit: "%",
        formatText: (v) => `Cast Time Decrease -${v}%`,
        buildDelta: (v) => ({ addOffense: { castTimePct: -Math.abs(v) } }),
    },
    {
        id: "recv_heal",
        label: "Received Healing %",
        defaultValue: 8.0,
        unit: "%",
        formatText: (v) => `Received Healing +${v}%`,
        buildDelta: (v) => ({ addDefense: { receivedHealingPct: v } }),
    },
    {
        id: "melee_atk",
        label: "Melee Attack",
        defaultValue: 65,
        unit: "",
        formatText: (v) => `Melee Attack +${v}`,
        buildDelta: (v) => ({ addOffense: { meleeAttack: v } }),
    },
    {
        id: "ranged_atk",
        label: "Ranged Attack",
        defaultValue: 65,
        unit: "",
        formatText: (v) => `Ranged Attack +${v}`,
        buildDelta: (v) => ({ addOffense: { rangedAttack: v } }),
    },
    {
        id: "magic_atk",
        label: "Magic Attack",
        defaultValue: 65,
        unit: "",
        formatText: (v) => `Magic Attack +${v}`,
        buildDelta: (v) => ({ addOffense: { magicAttack: v } }),
    },
    {
        id: "melee_crit_rate",
        label: "Melee Crit Rate %",
        defaultValue: 4.6,
        unit: "%",
        formatText: (v) => `Melee Critical Rate +${v}%`,
        buildDelta: (v) => ({ addOffense: { meleeCritRatePct: v } }),
    },
    {
        id: "melee_crit_bonus",
        label: "Melee Crit Damage %",
        defaultValue: 13.0,
        unit: "%",
        formatText: (v) => `Melee Critical Damage +${v}%`,
        buildDelta: (v) => ({ addOffense: { meleeCritBonusPct: v } }),
    },
    {
        id: "ranged_crit_rate",
        label: "Ranged Crit Rate %",
        defaultValue: 4.6,
        unit: "%",
        formatText: (v) => `Ranged Critical Rate +${v}%`,
        buildDelta: (v) => ({ addOffense: { rangedCritRatePct: v } }),
    },
    {
        id: "ranged_crit_bonus",
        label: "Ranged Crit Damage %",
        defaultValue: 13.0,
        unit: "%",
        formatText: (v) => `Ranged Critical Damage +${v}%`,
        buildDelta: (v) => ({ addOffense: { rangedCritBonusPct: v } }),
    },
    {
        id: "magic_crit_rate",
        label: "Magic Crit Rate %",
        defaultValue: 4.6,
        unit: "%",
        formatText: (v) => `Magic Critical Rate +${v}%`,
        buildDelta: (v) => ({ addOffense: { magicCritRatePct: v } }),
    },
    {
        id: "magic_crit_bonus",
        label: "Magic Crit Damage %",
        defaultValue: 13.0,
        unit: "%",
        formatText: (v) => `Magic Critical Damage +${v}%`,
        buildDelta: (v) => ({ addOffense: { magicCritBonusPct: v } }),
    },
    {
        id: "def_pen",
        label: "Defense Penetration",
        defaultValue: 835,
        unit: "",
        formatText: (v) => `Defense Penetration +${v}`,
        buildDelta: (v) => ({ addOffense: { defensePenetration: v } }),
    },
    {
        id: "mdef_pen",
        label: "Magic Def Penetration",
        defaultValue: 835,
        unit: "",
        formatText: (v) => `Magic Defense Penetration +${v}`,
        buildDelta: (v) => ({ addOffense: { magicDefensePenetration: v } }),
    },
    {
        id: "focus",
        label: "Focus",
        defaultValue: 650,
        unit: "",
        formatText: (v) => `Focus +${v}`,
        buildDelta: (v) => ({ addOffense: { focus: v } }),
    },
]);

/**
 * Parse a DaruGear lunagem or synthesis stat string into an engine stat delta.
 * Returns { addOffense, addDefense, addAttributes, addMaxHealth, recognized, value }.
 */
export function parseGearStatLine(text) {
    const raw = String(text || "").trim();
    const out = { addOffense: {}, addDefense: {}, addAttributes: {}, addMaxHealth: 0, recognized: false, value: 0 };
    if (!raw) return out;

    const numMatch = raw.match(/([+-]?\d+(?:\.\d+)?)\s*%?/);
    if (!numMatch) return out;
    const rawNum = parseFloat(numMatch[1]);
    if (!Number.isFinite(rawNum)) return out;
    const absVal = Math.abs(rawNum);
    const low = raw.toLowerCase();
    out.value = absVal;

    const setDef = (k, v) => {
        out.addDefense[k] = (out.addDefense[k] || 0) + v;
        out.recognized = true;
    };
    const setOff = (k, v) => {
        out.addOffense[k] = (out.addOffense[k] || 0) + v;
        out.recognized = true;
    };
    const setAttr = (k, v) => {
        out.addAttributes[k] = (out.addAttributes[k] || 0) + v;
        out.recognized = true;
    };

    if (low.includes("magic defense penetration")) {
        setOff("magicDefensePenetration", absVal);
    } else if (low.includes("defense penetration")) {
        setOff("defensePenetration", absVal);
    } else if (low.includes("physical defense")) {
        setDef("physicalDefense", absVal);
    } else if (low.includes("magic defense")) {
        setDef("magicDefense", absVal);
    } else if (low.includes("toughness")) {
        setDef("toughness", absVal);
    } else if (low.includes("resilience")) {
        setDef("resilience", absVal);
    } else if (low.includes("received melee damage")) {
        setDef("receivedMeleeDrPct", absVal);
    } else if (low.includes("received ranged damage")) {
        setDef("receivedRangedDrPct", absVal);
    } else if (low.includes("received magic damage")) {
        setDef("receivedMagicDrPct", absVal);
    } else if (low.includes("received damage")) {
        setDef("receivedMeleeDrPct", absVal);
        setDef("receivedRangedDrPct", absVal);
        setDef("receivedMagicDrPct", absVal);
    } else if (low.includes("received healing")) {
        setDef("receivedHealingPct", rawNum >= 0 ? absVal : -absVal);
    } else if (low.includes("evasion")) {
        setDef("evasionPct", absVal);
    } else if (low.includes("parry")) {
        setDef("parryPct", absVal);
    } else if (low.includes("block")) {
        setDef("blockPct", absVal);
    } else if (low.includes("cast time")) {
        setOff("castTimePct", -absVal);
    } else if (low.includes("attack speed")) {
        setOff("attackSpeed", absVal);
    } else if (low.includes("focus")) {
        setOff("focus", absVal);
    } else if (low.includes("heal") && low.includes("crit") && (low.includes("bonus") || low.includes("damage"))) {
        setOff("healCritBonusPct", absVal);
    } else if (low.includes("heal") && low.includes("crit") && low.includes("rate")) {
        setOff("healCritRatePct", absVal);
    } else if (low.includes("healing power")) {
        setOff("healingPower", absVal);
    } else if (low.includes("melee") && low.includes("crit") && (low.includes("damage") || low.includes("bonus"))) {
        setOff("meleeCritBonusPct", absVal);
    } else if (low.includes("melee") && low.includes("crit") && low.includes("rate")) {
        setOff("meleeCritRatePct", absVal);
    } else if (low.includes("ranged") && low.includes("crit") && (low.includes("damage") || low.includes("bonus"))) {
        setOff("rangedCritBonusPct", absVal);
    } else if (low.includes("ranged") && low.includes("crit") && low.includes("rate")) {
        setOff("rangedCritRatePct", absVal);
    } else if (low.includes("magic") && low.includes("crit") && (low.includes("damage") || low.includes("bonus"))) {
        setOff("magicCritBonusPct", absVal);
    } else if (low.includes("magic") && low.includes("crit") && low.includes("rate")) {
        setOff("magicCritRatePct", absVal);
    } else if (low.includes("melee attack")) {
        setOff("meleeAttack", absVal);
    } else if (low.includes("ranged attack")) {
        setOff("rangedAttack", absVal);
    } else if (low.includes("magic attack")) {
        setOff("magicAttack", absVal);
    } else if (low.includes("max health") || low.includes("maximum health")) {
        out.addMaxHealth += absVal;
        out.recognized = true;
    } else if (/\bstrength\b/.test(low)) {
        setAttr("str", absVal);
    } else if (/\bagility\b/.test(low)) {
        setAttr("agi", absVal);
    } else if (/\bstamina\b/.test(low)) {
        setAttr("sta", absVal);
    } else if (/\bintelligence\b/.test(low)) {
        setAttr("int", absVal);
    } else if (/\bspirit\b/.test(low)) {
        setAttr("spi", absVal);
    }

    return out;
}

function roundStat(n) {
    return Math.round(n * 100) / 100;
}

/**
 * Purely add (sign = +1) or subtract (sign = -1) a parsed gear stat delta on a character.
 */
export function applyGearDelta(character, delta, sign = 1) {
    if (!delta) return character;
    const next = {
        ...character,
        attributes: { ...(character.attributes || {}) },
        offense: { ...(character.offense || {}) },
        defense: { ...(character.defense || {}) },
    };

    if (delta.addMaxHealth) {
        next.maxHealth = Math.max(1, roundStat((Number(next.maxHealth) || 0) + sign * Number(delta.addMaxHealth)));
    }
    if (delta.addMaxMana) {
        next.maxMana = Math.max(0, roundStat((Number(next.maxMana) || 0) + sign * Number(delta.addMaxMana)));
    }

    for (const [k, v] of Object.entries(delta.addOffense || {})) {
        const updated = roundStat((Number(next.offense[k]) || 0) + sign * Number(v));
        if (k === "castTimePct") {
            next.offense[k] = Math.min(200, Math.max(40, updated));
        } else if (k === "defensePenetration" || k === "magicDefensePenetration" || k === "focus") {
            next.offense[k] = Math.max(0, updated);
        } else {
            next.offense[k] = updated;
        }
    }

    for (const [k, v] of Object.entries(delta.addDefense || {})) {
        const updated = roundStat((Number(next.defense[k]) || 0) + sign * Number(v));
        if (
            k === "physicalDefense" ||
            k === "magicDefense" ||
            k === "toughness" ||
            k === "resilience" ||
            k === "evasionPct" ||
            k === "parryPct" ||
            k === "blockPct"
        ) {
            next.defense[k] = Math.max(0, updated);
        } else {
            next.defense[k] = updated;
        }
    }

    if (delta.addAttributes && Object.keys(delta.addAttributes).length > 0) {
        applyAttributeDelta(next, delta.addAttributes, sign, roundStat);
        next.maxHealth = Math.max(1, Number(next.maxHealth) || 1);
        next.maxMana = Math.max(0, Number(next.maxMana) || 0);
        next.defense.magicDefense = Math.max(0, Number(next.defense.magicDefense) || 0);
        next.defense.evasionPct = Math.max(0, Number(next.defense.evasionPct) || 0);
        next.defense.parryPct = Math.max(0, Number(next.defense.parryPct) || 0);
        next.defense.blockPct = Math.max(0, Number(next.defense.blockPct) || 0);
    }

    return next;
}

/**
 * Swap all lunagems in a given equipment slot (e.g. Head slotId=1: Physical Defense -> Magic Defense / Toughness).
 * Subtracts existing slot lunagems' parsed stats and adds `count * perGemValue` of the replacement preset.
 * Pure function: returns { character, oldCount, newCount, slotName, newGemText }.
 */
export function swapSlotLunagems(character, slotId, presetId, { count = null, perGemValue = null } = {}) {
    const preset = LUNAGEM_SWAP_PRESETS.find((p) => p.id === presetId);
    if (!preset) {
        throw new Error(`Unknown lunagem preset: ${presetId}`);
    }

    const eqList = Array.isArray(character?.equipment)
        ? character.equipment.map((item) => ({
              ...item,
              lunagems: Array.isArray(item.lunagems) ? item.lunagems.map((g) => ({ ...g })) : [],
              synthStats: Array.isArray(item.synthStats) ? [...item.synthStats] : [],
          }))
        : [];

    let slotIdx = eqList.findIndex((item) => Number(item.slotId) === Number(slotId));
    if (slotIdx < 0) {
        const fallbackName = Number(slotId) === 1 ? "Head" : Number(slotId) === 2 ? "Chest" : Number(slotId) === 7 ? "Legs" : `Slot ${slotId}`;
        eqList.push({
            slotId: Number(slotId),
            slotName: fallbackName,
            name: fallbackName,
            gradeId: 9,
            gradeName: "Epic",
            lunagems: [],
            synthStats: [],
        });
        slotIdx = eqList.length - 1;
    }

    const slot = eqList[slotIdx];
    const oldGems = Array.isArray(slot.lunagems) ? slot.lunagems : [];
    const targetCount = Math.max(0, Math.min(10, count != null ? Math.round(Number(count)) : Math.max(1, oldGems.length)));
    const gemVal = perGemValue != null && Number.isFinite(Number(perGemValue))
        ? Math.max(0, Number(perGemValue))
        : preset.defaultValue;

    // 1. Subtract old lunagems
    let updated = { ...character, equipment: eqList };
    for (const g of oldGems) {
        const parsed = parseGearStatLine(g?.text || g?.name || "");
        if (parsed.recognized) {
            updated = applyGearDelta(updated, parsed, -1);
        }
    }

    // 2. Add replacement lunagems
    const newGemText = preset.formatText(gemVal);
    const newDelta = preset.buildDelta(gemVal);
    const nextGems = [];
    for (let i = 0; i < targetCount; i++) {
        updated = applyGearDelta(updated, newDelta, +1);
        nextGems.push({ name: preset.gemName, text: newGemText });
    }

    eqList[slotIdx] = { ...slot, lunagems: nextGems };
    updated.equipment = eqList;

    return {
        character: updated,
        slotName: slot.slotName || `Slot ${slotId}`,
        oldCount: oldGems.length,
        newCount: targetCount,
        newGemText,
    };
}

/**
 * Swap one synthesis stat line on Costume (slotId=0) or Undergarments (slotId=9) or Cloak (slotId=6).
 * Pure function: subtracts old line's parsed stat and adds the replacement preset's stat.
 */
export function swapEquipmentSynthStat(character, slotId, statIndex, presetId, customValue = null) {
    const preset = COSTUME_SYNTH_PRESETS.find((p) => p.id === presetId);
    if (!preset) {
        throw new Error(`Unknown synthesis stat preset: ${presetId}`);
    }

    const eqList = Array.isArray(character?.equipment)
        ? character.equipment.map((item) => ({
              ...item,
              lunagems: Array.isArray(item.lunagems) ? item.lunagems.map((g) => ({ ...g })) : [],
              synthStats: Array.isArray(item.synthStats) ? [...item.synthStats] : [],
          }))
        : [];

    let slotIdx = eqList.findIndex((item) => Number(item.slotId) === Number(slotId));
    if (slotIdx < 0) {
        const fallbackName = Number(slotId) === 0 ? "Costume" : Number(slotId) === 9 ? "Undergarments" : `Slot ${slotId}`;
        eqList.push({
            slotId: Number(slotId),
            slotName: fallbackName,
            name: fallbackName,
            gradeId: 11,
            gradeName: "Mythic",
            lunagems: [],
            synthStats: [],
        });
        slotIdx = eqList.length - 1;
    }

    const slot = eqList[slotIdx];
    const synthStats = Array.isArray(slot.synthStats) ? [...slot.synthStats] : [];
    const oldLine = statIndex >= 0 && statIndex < synthStats.length ? synthStats[statIndex] : null;
    const val = customValue != null && Number.isFinite(Number(customValue))
        ? Math.max(0, Number(customValue))
        : preset.defaultValue;

    let updated = { ...character, equipment: eqList };
    if (oldLine) {
        const parsedOld = parseGearStatLine(oldLine);
        if (parsedOld.recognized) {
            updated = applyGearDelta(updated, parsedOld, -1);
        }
    }

    const newLine = preset.formatText(val);
    const newDelta = preset.buildDelta(val);
    updated = applyGearDelta(updated, newDelta, +1);

    if (statIndex >= 0 && statIndex < synthStats.length) {
        synthStats[statIndex] = newLine;
    } else {
        synthStats.push(newLine);
    }

    eqList[slotIdx] = { ...slot, synthStats };
    updated.equipment = eqList;

    return {
        character: updated,
        slotName: slot.slotName || `Slot ${slotId}`,
        oldLine,
        newLine,
    };
}

// ============================================================================
// 1-to-1 Armor Grade, Armor Type (Plate <-> Leather <-> Cloth), Armor Tier & Weapon Grade Swaps
// Formulas verified 1:1 against live DaruGear 1.3.6 (3.5) & aa-classic.com buff data.
// ============================================================================

export const ARCHEAGE_GRADES = Object.freeze([
    { id: 0, name: "Crude", color: "#8c8c8c", mainMod: 80, statMod: 80 },
    { id: 1, name: "Basic", color: "#b0b0b0", mainMod: 100, statMod: 100 },
    { id: 2, name: "Grand", color: "#52d669", mainMod: 105, statMod: 108 },
    { id: 3, name: "Rare", color: "#4da3ff", mainMod: 110, statMod: 116 },
    { id: 4, name: "Arcane", color: "#d96ef5", mainMod: 115, statMod: 124 },
    { id: 5, name: "Heroic", color: "#f2c94c", mainMod: 120, statMod: 132 },
    { id: 6, name: "Unique", color: "#f07b42", mainMod: 125, statMod: 140 },
    { id: 7, name: "Celestial", color: "#ff5c6a", mainMod: 135, statMod: 150 },
    { id: 8, name: "Divine", color: "#d9a466", mainMod: 150, statMod: 160 },
    { id: 9, name: "Epic", color: "#f0f6ff", mainMod: 170, statMod: 170 },
    { id: 10, name: "Legendary", color: "#ffb326", mainMod: 190, statMod: 185 },
    { id: 11, name: "Mythic", color: "#ef233c", mainMod: 200, statMod: 200 },
    { id: 12, name: "Eternal", color: "#e85dff", mainMod: 210, statMod: 210 },
]);

export const ARMOR_TIERS = Object.freeze([
    { id: "epherium", label: "Epherium / Obs T4 (Lv 50)", shortLabel: "Epherium (Lv50)", level: 50 },
    { id: "delphinad", label: "Delphinad / Obs T5 (Lv 56)", shortLabel: "Delphinad (Lv56)", level: 56 },
    { id: "obsidian_t6", label: "Obsidian T6 (Lv 59)", shortLabel: "Obsidian T6 (Lv59)", level: 59 },
    { id: "ayanad", label: "Ayanad (Lv 62)", shortLabel: "Ayanad (Lv62)", level: 62 },
    { id: "obsidian_t7", label: "Obsidian T7 / Boss (Lv 64)", shortLabel: "Obsidian T7 (Lv64)", level: 64 },
    { id: "erenor", label: "Erenor (Lv 66)", shortLabel: "Erenor (Lv66)", level: 66 },
]);

export const ARMOR_SLOTS = Object.freeze([
    { slotId: 1, slotName: "Head", coverage: 15, names: { Plate: "Helm", Leather: "Cap", Cloth: "Hood" } },
    { slotId: 2, slotName: "Chest", coverage: 25, names: { Plate: "Cuirass", Leather: "Jerkin", Cloth: "Shirt" } },
    { slotId: 3, slotName: "Waist", coverage: 5, names: { Plate: "Tassets", Leather: "Belt", Cloth: "Sash" } },
    { slotId: 4, slotName: "Wrists", coverage: 5, names: { Plate: "Vambraces", Leather: "Guards", Cloth: "Sleeves" } },
    { slotId: 5, slotName: "Hands", coverage: 10, names: { Plate: "Gauntlets", Leather: "Fists", Cloth: "Gloves" } },
    { slotId: 7, slotName: "Legs", coverage: 20, names: { Plate: "Greaves", Leather: "Breeches", Cloth: "Pants" } },
    { slotId: 8, slotName: "Feet", coverage: 10, names: { Plate: "Sabatons", Leather: "Boots", Cloth: "Shoes" } },
]);

const ARMOR_SLOT_BY_ID = new Map(ARMOR_SLOTS.map((s) => [s.slotId, s]));

export const ARMOR_TYPE_RATIOS = Object.freeze({
    Plate: { pdefRatio: 120, mdefRatio: 0, hpScale: 1.1 },
    Leather: { pdefRatio: 60, mdefRatio: 60, hpScale: 1.0 },
    Cloth: { pdefRatio: 20, mdefRatio: 100, hpScale: 0.9 },
});

// Exact AA Classic 1.3.6 (3.5) Armor Grade Buff tables (darugear.com v35/equipment_buffs.csv, buffs 6418..6441)
const GRADE_BUFF_TABLE = Object.freeze({
    Cloth: {
        hpLinear: { 4: 54, 5: 94, 6: 135, 7: 202, 8: 283, 9: 378, 10: 486, 11: 607, 12: 742 },
        manaLinear: { 4: 44, 5: 77, 6: 110, 7: 165, 8: 231, 9: 308, 10: 396, 11: 495, 12: 605 },
        critRatePct: { 4: 0, 5: 2.0, 6: 2.3, 7: 2.7, 8: 3.2, 9: 3.7, 10: 4.3, 11: 5.0, 12: 5.8 },
        defPen: { 4: 0, 5: 0, 6: 0, 7: 100, 8: 150, 9: 200, 10: 250, 11: 300, 12: 350 },
    },
    Leather: {
        hpLinear: { 4: 60, 5: 105, 6: 150, 7: 225, 8: 315, 9: 420, 10: 540, 11: 675, 12: 825 },
        manaLinear: { 4: 40, 5: 70, 6: 100, 7: 150, 8: 210, 9: 280, 10: 360, 11: 450, 12: 550 },
        critBonusPct: { 4: 0, 5: 5.0, 6: 6.0, 7: 7.2, 8: 8.6, 9: 10.3, 10: 12.4, 11: 15.0, 12: 18.2 },
        attackSpeed: { 4: 0, 5: 0, 6: 0, 7: 31, 8: 42, 9: 53, 10: 64, 11: 75, 12: 86 },
    },
    Plate: {
        hpLinear: { 4: 66, 5: 115, 6: 165, 7: 247, 8: 346, 9: 462, 10: 594, 11: 742, 12: 907 },
        manaLinear: { 4: 36, 5: 63, 6: 90, 7: 135, 8: 189, 9: 252, 10: 324, 11: 405, 12: 495 },
        parryBlockPct: { 4: 0, 5: 2.0, 6: 2.3, 7: 2.7, 8: 3.2, 9: 3.7, 10: 4.3, 11: 5.0, 12: 5.7 },
        recvDrPct: { 4: 0, 5: 0, 6: 0, 7: 2.0, 8: 2.5, 9: 3.0, 10: 3.5, 11: 4.0, 12: 4.5 },
    },
});

export function getGradeById(gradeId) {
    const id = Math.max(0, Math.min(12, Math.round(Number(gradeId) || 0)));
    return ARCHEAGE_GRADES[id] || ARCHEAGE_GRADES[9];
}

export function getArmorTierById(tierId) {
    return ARMOR_TIERS.find((t) => t.id === tierId) || ARMOR_TIERS.find((t) => t.id === "ayanad");
}

function normalizeArmorType(raw) {
    const s = String(raw || "").trim().toLowerCase();
    if (s.includes("plate")) return "Plate";
    if (s.includes("leather")) return "Leather";
    if (s.includes("cloth")) return "Cloth";
    return null;
}

/**
 * Infer an armor item's tier level (50..66) from its explicit tierLevel or item name.
 */
export function inferArmorTierLevel(item, fallbackLevel = 62) {
    if (item && Number.isFinite(Number(item.tierLevel)) && Number(item.tierLevel) > 0) {
        return Number(item.tierLevel);
    }
    const nm = String(item?.name || "").toLowerCase();
    if (!nm) return fallbackLevel;
    if (nm.includes("erenor")) return 66;
    if (nm.includes("ayanad")) return 62;
    if (nm.includes("delphinad")) return 56;
    if (nm.includes("epherium")) return 50;
    if (
        nm.includes("purehearted") ||
        nm.includes("mahra") ||
        nm.includes("illion") ||
        nm.includes("ehno") ||
        nm.includes("talisman") ||
        nm.includes("glory") ||
        nm.includes("red dragon") ||
        nm.includes("leviathan") ||
        nm.includes("kraken") ||
        nm.includes("anthalon")
    ) {
        return 64;
    }
    if (nm.includes("shadow warrior") || nm.includes("starbound") || nm.includes("screaming")) {
        return 59;
    }
    return fallbackLevel;
}

function tierIdFromLevel(level) {
    let best = ARMOR_TIERS[3]; // ayanad
    let bestDiff = Infinity;
    for (const t of ARMOR_TIERS) {
        const diff = Math.abs(t.level - level);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = t;
        }
    }
    return best.id;
}

/**
 * Exact DaruGear 1.3.6 per-piece Armor Physical & Magic Defense formula:
 * Math.floor(Math.floor(level^1.1 * 85 + 100) * (mainMod/100) * (ratio/100) * (temper/100) * (coverage/100))
 */
export function computeArmorPieceDefense({
    level = 62,
    gradeId = 9,
    armorType = "Cloth",
    coverage = 25,
    ptemper = 100,
    mtemper = 100,
}) {
    const grade = getGradeById(gradeId);
    const ratios = ARMOR_TYPE_RATIOS[normalizeArmorType(armorType) || "Cloth"];
    const basePool = Math.floor(Math.pow(Number(level) || 62, 1.1) * 85 + 100);
    const pt = Number(ptemper) > 0 ? Number(ptemper) : 100;
    const mt = Number(mtemper) > 0 ? Number(mtemper) : 100;
    const physicalDefense = Math.floor(
        basePool * (grade.mainMod / 100) * (ratios.pdefRatio / 100) * (pt / 100) * (coverage / 100)
    );
    const magicDefense = Math.floor(
        basePool * (grade.mainMod / 100) * (ratios.mdefRatio / 100) * (mt / 100) * (coverage / 100)
    );
    return { physicalDefense, magicDefense };
}

/**
 * Exact DaruGear 1.3.6 single-stat attribute budget per armor piece (e.g. Ayanad Wave Chest Epic = 225, 7pc = 810).
 */
export function computeArmorPieceAttrBudget({ level = 62, gradeId = 9, coverage = 25 }) {
    const grade = getGradeById(gradeId);
    const G = Math.pow(3, 1 / 1.1);
    const et = 3.5 * (Number(level) || 62) * G * 0.9 * (coverage / 100);
    return Math.floor(et * (grade.statMod / 100) + 0.5);
}

/**
 * Compute Complete Armor Set & Armor Grade Buff effects from a list of equipped armor pieces.
 * Returns { armorType, count, minGradeId, setPdefMul, setHpMul, gradeBuffHp, delta }.
 */
export function computeArmorSetAndGradeBuff(armorPieces, defaultLevel = 62, { includeBlock = true } = {}) {
    const counts = { Plate: [], Leather: [], Cloth: [] };
    for (const p of armorPieces || []) {
        const t = normalizeArmorType(p?.type);
        if (t && counts[t]) counts[t].push(p);
    }

    let activeType = null;
    let activePieces = [];
    for (const t of ["Plate", "Leather", "Cloth"]) {
        if (counts[t].length >= 4 && counts[t].length > activePieces.length) {
            activeType = t;
            activePieces = counts[t];
        }
    }

    const delta = { addOffense: {}, addDefense: {}, addMaxHealth: 0 };
    if (!activeType || activePieces.length < 4) {
        return {
            armorType: null,
            count: 0,
            minGradeId: null,
            setPdefMul: 1,
            setHpMul: 1,
            gradeBuffHp: 0,
            delta,
        };
    }

    const count = activePieces.length;
    const minGradeId = activePieces.reduce(
        (mn, p) => Math.min(mn, Math.max(0, Math.min(12, Math.round(Number(p.gradeId) || 0)))),
        12
    );

    // 1. Complete Armor Set Buff (4pc / 7pc)
    let setPdefMul = 1;
    let setHpMul = 1;
    if (activeType === "Leather") {
        delta.addDefense.evasionPct = 3.0;
    } else if (activeType === "Plate") {
        setPdefMul = 1.03;
        setHpMul = count >= 7 ? 1.05 : 1.03;
    }

    // 2. Armor Grade Buff (Arcane 4 .. Eternal 12) — Exact DaruGear `dn.get_buff_hp_mana` formula:
    //    sum over qualifying pieces of (0.310118 - 0.000959369 * lv + 0.000680281 * lv^2) * linear_level_bonus
    let gradeBuffHp = 0;
    let gradeBuffMana = 0;
    if (minGradeId >= 4) {
        const tbl = GRADE_BUFF_TABLE[activeType];
        const hpLin = tbl.hpLinear[minGradeId] || 0;
        const manaLin = tbl.manaLinear[minGradeId] || 0;
        let hpSum = 0;
        let manaSum = 0;
        for (const p of activePieces) {
            const lv = inferArmorTierLevel(p, defaultLevel);
            const poly = 0.310118 - 959369e-9 * lv + 680281e-9 * lv * lv;
            hpSum += poly * hpLin;
            manaSum += poly * manaLin;
        }
        gradeBuffHp = Math.round(hpSum);
        gradeBuffMana = Math.round(manaSum);
        delta.addMaxHealth = gradeBuffHp;
        delta.addMaxMana = gradeBuffMana;

        if (activeType === "Cloth") {
            const cr = tbl.critRatePct[minGradeId] || 0;
            const pen = tbl.defPen[minGradeId] || 0;
            if (cr) {
                delta.addOffense.meleeCritRatePct = cr;
                delta.addOffense.rangedCritRatePct = cr;
                delta.addOffense.magicCritRatePct = cr;
                delta.addOffense.healCritRatePct = cr;
            }
            if (pen) {
                delta.addOffense.defensePenetration = pen;
                delta.addOffense.magicDefensePenetration = pen;
            }
        } else if (activeType === "Leather") {
            const cb = tbl.critBonusPct[minGradeId] || 0;
            const as = tbl.attackSpeed[minGradeId] || 0;
            if (cb) {
                delta.addOffense.meleeCritBonusPct = cb;
                delta.addOffense.rangedCritBonusPct = cb;
                delta.addOffense.magicCritBonusPct = cb;
                delta.addOffense.healCritBonusPct = cb;
            }
            if (as) {
                delta.addOffense.attackSpeed = as;
            }
        } else if (activeType === "Plate") {
            const pb = tbl.parryBlockPct[minGradeId] || 0;
            const dr = tbl.recvDrPct[minGradeId] || 0;
            if (pb) {
                delta.addDefense.parryPct = pb;
                if (includeBlock) delta.addDefense.blockPct = pb;
            }
            if (dr) {
                delta.addDefense.receivedMeleeDrPct = dr;
                delta.addDefense.receivedRangedDrPct = dr;
                delta.addDefense.receivedMagicDrPct = dr;
            }
        }
    }

    return {
        armorType: activeType,
        count,
        minGradeId: minGradeId >= 4 ? minGradeId : null,
        setPdefMul,
        setHpMul,
        gradeBuffHp,
        gradeBuffMana,
        delta,
    };
}

function cloneEquipmentList(character) {
    if (!Array.isArray(character?.equipment)) return [];
    return character.equipment.map((item) => ({
        ...item,
        lunagems: Array.isArray(item.lunagems) ? item.lunagems.map((g) => ({ ...g })) : [],
        synthStats: Array.isArray(item.synthStats) ? [...item.synthStats] : [],
        ...(item.lunafrost ? { lunafrost: { ...item.lunafrost } } : {}),
    }));
}

function getOrBuildArmorAttrWeights(character) {
    if (character?._armorAttrWeights && typeof character._armorAttrWeights === "object") {
        return character._armorAttrWeights;
    }
    const attrs = character?.attributes || {};
    const keys = ["str", "agi", "sta", "int", "spi"];
    const baseStat = 158; // Level 55 base attribute floor
    const excess = {};
    let totalExcess = 0;
    for (const k of keys) {
        const val = Math.max(0, (Number(attrs[k]) || 0) - baseStat);
        excess[k] = val;
        totalExcess += val;
    }
    const weights = {};
    if (totalExcess > 0) {
        for (const k of keys) weights[k] = excess[k] / totalExcess;
    } else {
        const totalRaw = keys.reduce((s, k) => s + Math.max(0, Number(attrs[k]) || 0), 0);
        for (const k of keys) {
            weights[k] = totalRaw > 0 ? Math.max(0, Number(attrs[k]) || 0) / totalRaw : k === "sta" ? 1 : 0;
        }
    }
    return weights;
}

function ensureArmorPieces(eqList, fallbackType = "Cloth", fallbackGradeId = 9, fallbackLevel = 62) {
    const out = [...eqList];
    const existing = out.filter((it) => ARMOR_SLOT_BY_ID.has(Number(it.slotId)));
    if (existing.length > 0) return out;
    const g = getGradeById(fallbackGradeId);
    const tierShort = getArmorTierById(tierIdFromLevel(fallbackLevel)).shortLabel.split(" ")[0];
    for (const s of ARMOR_SLOTS) {
        out.push({
            slotId: s.slotId,
            slotName: s.slotName,
            name: `${tierShort} ${fallbackType} ${s.names[fallbackType]}`,
            type: fallbackType,
            gradeId: g.id,
            gradeName: g.name,
            gradeColor: g.color,
            tierLevel: fallbackLevel,
            ptemper: 100,
            mtemper: 100,
            lunagems: [],
            synthStats: [],
        });
    }
    return out;
}

function syncArmorSetMetadataBuffs(character, setBuff) {
    if (!character?.metadata || !Array.isArray(character.metadata.darugearBuffs)) return character;
    const cleaned = character.metadata.darugearBuffs.filter((b) => {
        const nm = String(b?.name || "").toLowerCase();
        return (
            !/^(complete )?(cloth|leather|plate) set$/.test(nm) &&
            !/^(arcane|heroic|unique|celestial|divine|epic|legendary|mythic|eternal) (cloth|leather|plate) armor$/.test(nm)
        );
    });
    if (setBuff?.armorType) {
        cleaned.push({
            id: null,
            name: setBuff.count >= 7 ? `Complete ${setBuff.armorType} Set` : `${setBuff.armorType} Set`,
            isOptional: false,
        });
        if (setBuff.minGradeId != null && setBuff.minGradeId >= 4) {
            const g = getGradeById(setBuff.minGradeId);
            cleaned.push({
                id: null,
                name: `${g.name} ${setBuff.armorType} Armor`,
                isOptional: false,
            });
        }
    }
    return {
        ...character,
        metadata: {
            ...character.metadata,
            darugearBuffs: cleaned,
        },
    };
}

function renameArmorPieceForType(oldName, slotSpec, targetType) {
    if (!oldName || !slotSpec) return oldName;
    const targetSuffix = slotSpec.names[targetType];
    if (!targetSuffix) return oldName;
    const allSuffixes = [
        "Helm", "Cap", "Hood", "Helmet", "Hat",
        "Cuirass", "Jerkin", "Shirt", "Robe", "Tunic", "Chestguard",
        "Tassets", "Belt", "Sash", "Waistguard",
        "Vambraces", "Guards", "Sleeves", "Bracers", "Shadows",
        "Gauntlets", "Fists", "Gloves", "Grips",
        "Greaves", "Breeches", "Pants", "Legguards",
        "Sabatons", "Boots", "Shoes",
    ];
    let updated = String(oldName).replace(/\b(Plate|Leather|Cloth)\b/gi, targetType);
    for (const suf of allSuffixes) {
        const re = new RegExp(`\\b${suf}\\b$`, "i");
        if (re.test(updated)) {
            return updated.replace(re, targetSuffix);
        }
    }
    return `${updated} (${targetType})`;
}

/**
 * Inspect a character's current armor pieces, dominant type, grades, and detected tier.
 */
export function inspectArmorState(character, { tierId = null } = {}) {
    const eq = Array.isArray(character?.equipment) ? character.equipment : [];
    const pieces = eq.filter((it) => ARMOR_SLOT_BY_ID.has(Number(it.slotId)));

    const levels = pieces.map((p) => inferArmorTierLevel(p, 62));
    const detectedLevel =
        levels.length > 0 ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : 62;
    const resolvedTier = tierId ? getArmorTierById(tierId) : getArmorTierById(tierIdFromLevel(detectedLevel));

    const typeCounts = { Plate: 0, Leather: 0, Cloth: 0 };
    const gradeCounts = new Map();
    for (const p of pieces) {
        const t = normalizeArmorType(p.type);
        if (t) typeCounts[t]++;
        const gid = Math.max(0, Math.min(12, Math.round(Number(p.gradeId) || 9)));
        gradeCounts.set(gid, (gradeCounts.get(gid) || 0) + 1);
    }

    let dominantType = "Cloth";
    if (typeCounts.Plate >= typeCounts.Leather && typeCounts.Plate >= typeCounts.Cloth && typeCounts.Plate > 0) {
        dominantType = "Plate";
    } else if (typeCounts.Leather >= typeCounts.Cloth && typeCounts.Leather > 0) {
        dominantType = "Leather";
    } else if (pieces.length === 0) {
        const pd = Number(character?.defense?.physicalDefense) || 0;
        const md = Number(character?.defense?.magicDefense) || 0;
        if (pd > md * 1.6) dominantType = "Plate";
        else if (md > pd * 1.4) dominantType = "Cloth";
        else dominantType = "Leather";
    }

    const setBuff = computeArmorSetAndGradeBuff(pieces, resolvedTier.level);
    const gradeSummary = Array.from(gradeCounts.entries())
        .sort((a, b) => b[0] - a[0])
        .map(([gid, cnt]) => `${cnt}× ${getGradeById(gid).name}`)
        .join(", ");

    return {
        pieces,
        pieceCount: pieces.length,
        hasEquipment: pieces.length > 0,
        dominantType,
        typeCounts,
        detectedTierId: resolvedTier.id,
        detectedTierLevel: resolvedTier.level,
        detectedTierLabel: resolvedTier.shortLabel,
        gradeSummary: gradeSummary || "Default (7× Epic)",
        setBuff,
    };
}

/**
 * Shared reversible armor transform helper: compares oldPieces -> newPieces and applies exact
 * PDef/MDef, Complete Set Buff (% PDef / % Max HP / Evasion), Armor Grade Buff (stats + HP),
 * and optional attribute budget deltas.
 */
function applyArmorPiecesTransition(character, oldEqList, newEqList, { defaultLevel = 62, scaleAttributes = false } = {}) {
    const oldArmor = oldEqList.filter((it) => ARMOR_SLOT_BY_ID.has(Number(it.slotId)));
    const newArmor = newEqList.filter((it) => ARMOR_SLOT_BY_ID.has(Number(it.slotId)));

    const hasShield = Boolean(
        character?.defense?.hasShield ||
            (Number(character?.defense?.shieldPhysicalDefense) || 0) > 0 ||
            oldEqList.some(
                (it) => Number(it.slotId) === 16 && String(it.type || "").toLowerCase().includes("shield")
            )
    );
    const oldSetBuff = computeArmorSetAndGradeBuff(oldArmor, defaultLevel, { includeBlock: hasShield });
    const newSetBuff = computeArmorSetAndGradeBuff(newArmor, defaultLevel, { includeBlock: hasShield });
    const attrWeights = getOrBuildArmorAttrWeights(character);

    let updated = {
        ...character,
        attributes: { ...(character.attributes || {}) },
        offense: { ...(character.offense || {}) },
        defense: { ...(character.defense || {}) },
        _armorAttrWeights: attrWeights,
    };

    // 1. Remove old Complete Plate Set % multipliers cleanly first (exact round-trip!)
    if (oldSetBuff.setPdefMul !== 1) {
        updated.defense.physicalDefense = roundStat(
            (Number(updated.defense.physicalDefense) || 0) / oldSetBuff.setPdefMul
        );
    }
    if (oldSetBuff.setHpMul !== 1) {
        updated.maxHealth = roundStat((Number(updated.maxHealth) || 0) / oldSetBuff.setHpMul);
    }

    // 2. Subtract old Armor Set + Grade Buff flat stats & HP
    updated = applyGearDelta(updated, oldSetBuff.delta, -1);

    // 3. Apply per-piece PDef/MDef & optional attribute deltas
    let deltaPdef = 0;
    let deltaMdef = 0;
    let oldAttrTotal = 0;
    let newAttrTotal = 0;

    for (const slotSpec of ARMOR_SLOTS) {
        const oldP = oldArmor.find((it) => Number(it.slotId) === slotSpec.slotId);
        const newP = newArmor.find((it) => Number(it.slotId) === slotSpec.slotId);
        if (oldP) {
            const lv = inferArmorTierLevel(oldP, defaultLevel);
            const dOld = computeArmorPieceDefense({
                level: lv,
                gradeId: oldP.gradeId,
                armorType: oldP.type,
                coverage: slotSpec.coverage,
                ptemper: oldP.ptemper,
                mtemper: oldP.mtemper,
            });
            deltaPdef -= dOld.physicalDefense;
            deltaMdef -= dOld.magicDefense;
            if (scaleAttributes) {
                oldAttrTotal += computeArmorPieceAttrBudget({
                    level: lv,
                    gradeId: oldP.gradeId,
                    coverage: slotSpec.coverage,
                });
            }
        }
        if (newP) {
            const lv = inferArmorTierLevel(newP, defaultLevel);
            const dNew = computeArmorPieceDefense({
                level: lv,
                gradeId: newP.gradeId,
                armorType: newP.type,
                coverage: slotSpec.coverage,
                ptemper: newP.ptemper,
                mtemper: newP.mtemper,
            });
            deltaPdef += dNew.physicalDefense;
            deltaMdef += dNew.magicDefense;
            if (scaleAttributes) {
                newAttrTotal += computeArmorPieceAttrBudget({
                    level: lv,
                    gradeId: newP.gradeId,
                    coverage: slotSpec.coverage,
                });
            }
        }
    }

    updated = applyGearDelta(
        updated,
        { addDefense: { physicalDefense: deltaPdef, magicDefense: deltaMdef } },
        +1
    );

    if (scaleAttributes && Math.abs(newAttrTotal - oldAttrTotal) > 0) {
        const attrDiff = newAttrTotal - oldAttrTotal;
        const addAttributes = {};
        for (const [k, w] of Object.entries(attrWeights)) {
            const v = roundStat(attrDiff * w);
            if (Math.abs(v) >= 0.01) addAttributes[k] = v;
        }
        updated = applyGearDelta(updated, { addAttributes }, +1);
    }

    // 4. Add new Armor Set + Grade Buff flat stats & HP
    updated = applyGearDelta(updated, newSetBuff.delta, +1);

    // 5. Apply new Complete Plate Set % multipliers last (symmetric with Step 1!)
    if (newSetBuff.setPdefMul !== 1) {
        updated.defense.physicalDefense = roundStat(
            (Number(updated.defense.physicalDefense) || 0) * newSetBuff.setPdefMul
        );
    }
    if (newSetBuff.setHpMul !== 1) {
        updated.maxHealth = roundStat((Number(updated.maxHealth) || 0) * newSetBuff.setHpMul);
    }

    updated.defense.physicalDefense = Math.max(0, Math.round(updated.defense.physicalDefense));
    updated.defense.magicDefense = Math.max(0, Math.round(updated.defense.magicDefense));
    updated.maxHealth = Math.max(1, Math.round(updated.maxHealth));
    updated.equipment = newEqList;
    updated = syncArmorSetMetadataBuffs(updated, newSetBuff);

    return {
        character: updated,
        oldSetBuff,
        newSetBuff,
        piecePdefDelta: deltaPdef,
        pieceMdefDelta: deltaMdef,
        attrBudgetDelta: newAttrTotal - oldAttrTotal,
    };
}

/**
 * Shift all (or selected) armor pieces by `deltaGrades` (e.g. -1 for Legendary -> Epic, +1 for Epic -> Legendary)
 * OR set all targeted armor pieces to `targetGradeId`.
 * Pure & reversible.
 */
export function shiftArmorGrades(
    character,
    { deltaGrades = 0, targetGradeId = null, slotIds = null, tierId = null, scaleAttributes = true } = {}
) {
    const info = inspectArmorState(character, { tierId });
    const baseLevel = tierId ? getArmorTierById(tierId).level : info.detectedTierLevel;
    const oldEq = ensureArmorPieces(cloneEquipmentList(character), info.dominantType, 9, baseLevel);
    const targetSlots = new Set(
        Array.isArray(slotIds) && slotIds.length > 0 ? slotIds.map(Number) : ARMOR_SLOTS.map((s) => s.slotId)
    );

    let changedCount = 0;
    const newEq = oldEq.map((item) => {
        if (!targetSlots.has(Number(item.slotId))) return item;
        const curId = Math.max(0, Math.min(12, Math.round(Number(item.gradeId) || 9)));
        const nextId =
            targetGradeId != null
                ? Math.max(4, Math.min(12, Math.round(Number(targetGradeId))))
                : Math.max(4, Math.min(12, curId + Math.round(Number(deltaGrades) || 0)));
        if (nextId !== curId) changedCount++;
        const nextGrade = getGradeById(nextId);
        return {
            ...item,
            gradeId: nextGrade.id,
            gradeName: nextGrade.name,
            gradeColor: nextGrade.color,
            ...(tierId ? { tierLevel: baseLevel } : {}),
        };
    });

    const res = applyArmorPiecesTransition(character, oldEq, newEq, {
        defaultLevel: baseLevel,
        scaleAttributes,
    });
    return { ...res, changedCount };
}

/**
 * 1-to-1 Armor Type swap (e.g. Ayanad Wave Plate -> Ayanad Wave Cloth, or Leather -> Plate)
 * preserving each piece's exact grade, tempers, tier level, and primary suffix attributes, while
 * swapping PDef/MDef ratios, Complete Armor Set Buff, and Armor Grade Buff.
 */
export function swapArmorType(
    character,
    targetArmorType,
    { slotIds = null, tierId = null, renamePieces = true } = {}
) {
    const nextType = normalizeArmorType(targetArmorType);
    if (!nextType) throw new Error(`Unknown armor type: ${targetArmorType}`);

    const info = inspectArmorState(character, { tierId });
    const baseLevel = tierId ? getArmorTierById(tierId).level : info.detectedTierLevel;
    const oldEq = ensureArmorPieces(cloneEquipmentList(character), info.dominantType, 9, baseLevel);
    const targetSlots = new Set(
        Array.isArray(slotIds) && slotIds.length > 0 ? slotIds.map(Number) : ARMOR_SLOTS.map((s) => s.slotId)
    );

    let changedCount = 0;
    const newEq = oldEq.map((item) => {
        const slotSpec = ARMOR_SLOT_BY_ID.get(Number(item.slotId));
        if (!slotSpec || !targetSlots.has(slotSpec.slotId)) return item;
        const prevType = normalizeArmorType(item.type) || info.dominantType;
        if (prevType !== nextType) changedCount++;
        return {
            ...item,
            type: nextType,
            name: renamePieces && prevType !== nextType ? renameArmorPieceForType(item.name, slotSpec, nextType) : item.name,
            ...(tierId ? { tierLevel: baseLevel } : {}),
        };
    });

    const res = applyArmorPiecesTransition(character, oldEq, newEq, {
        defaultLevel: baseLevel,
        scaleAttributes: false,
    });
    return { ...res, targetArmorType: nextType, changedCount };
}

/**
 * 1-to-1 Armor Tier swap (e.g. Delphinad -> Ayanad -> Obsidian T7 -> Erenor) at the same grades & armor types.
 */
export function swapArmorTier(
    character,
    newTierId,
    { slotIds = null, fromTierId = null, scaleAttributes = true } = {}
) {
    const newTier = getArmorTierById(newTierId);
    const info = inspectArmorState(character, { tierId: fromTierId });
    const oldLevel = fromTierId ? getArmorTierById(fromTierId).level : info.detectedTierLevel;
    const oldEq = ensureArmorPieces(cloneEquipmentList(character), info.dominantType, 9, oldLevel).map((item) =>
        ARMOR_SLOT_BY_ID.has(Number(item.slotId))
            ? { ...item, tierLevel: fromTierId ? oldLevel : inferArmorTierLevel(item, oldLevel) }
            : item
    );
    const targetSlots = new Set(
        Array.isArray(slotIds) && slotIds.length > 0 ? slotIds.map(Number) : ARMOR_SLOTS.map((s) => s.slotId)
    );

    let changedCount = 0;
    const newEq = oldEq.map((item) => {
        if (!ARMOR_SLOT_BY_ID.has(Number(item.slotId)) || !targetSlots.has(Number(item.slotId))) return item;
        if (item.tierLevel !== newTier.level) changedCount++;
        return { ...item, tierLevel: newTier.level };
    });

    const res = applyArmorPiecesTransition(character, oldEq, newEq, {
        defaultLevel: oldLevel,
        scaleAttributes,
    });
    return { ...res, oldLevel, newTier, changedCount };
}

const WEAPON_SLOT_IDS = new Set([15, 16, 17]);

/**
 * Shift Weapon & Shield grades (Right Hand 15, Left Hand/Shield 16, Ranged Bow 17) by `deltaGrades`
 * or set to `targetGradeId`, scaling base Weapon Attack & Shield Physical Defense by exact AA Classic 1.3.6 `mainMod` ratio.
 */
export function shiftWeaponGrades(
    character,
    { deltaGrades = 0, targetGradeId = null, slotIds = [15, 16, 17] } = {}
) {
    const targetSet = new Set(slotIds.map(Number).filter((id) => WEAPON_SLOT_IDS.has(id)));
    const oldEq = cloneEquipmentList(character);
    let updated = {
        ...character,
        attributes: { ...(character.attributes || {}) },
        offense: { ...(character.offense || {}) },
        defense: { ...(character.defense || {}) },
    };

    const changes = [];
    const newEq = oldEq.map((item) => {
        const sid = Number(item.slotId);
        if (!targetSet.has(sid)) return item;
        const curId = Math.max(0, Math.min(12, Math.round(Number(item.gradeId) || 9)));
        const nextId =
            targetGradeId != null
                ? Math.max(4, Math.min(12, Math.round(Number(targetGradeId))))
                : Math.max(4, Math.min(12, curId + Math.round(Number(deltaGrades) || 0)));
        if (nextId === curId) return item;

        const oldG = getGradeById(curId);
        const newG = getGradeById(nextId);
        const ratio = newG.mainMod / oldG.mainMod;
        const typeLow = String(item.type || "").toLowerCase();
        const nameLow = String(item.name || "").toLowerCase();

        if (sid === 16 && (typeLow.includes("shield") || nameLow.includes("shield") || Number(updated.defense.shieldPhysicalDefense) > 0)) {
            const curShieldDef = Number(updated.defense.shieldPhysicalDefense) || 0;
            if (curShieldDef > 0) {
                const nextShieldDef = Math.round(curShieldDef * ratio);
                const diff = nextShieldDef - curShieldDef;
                updated.defense.shieldPhysicalDefense = nextShieldDef;
                updated.defense.physicalDefense = Math.max(0, Math.round((Number(updated.defense.physicalDefense) || 0) + diff));
                changes.push(`${item.name}: Shield PDef ${diff >= 0 ? "+" : ""}${diff}`);
            }
        } else if (sid === 17) {
            // Bow scales Ranged Attack (~72% of total Ranged Attack comes from weapon base; rest from AGI/lunagems/buffs)
            const agiContrib = (Number(updated.attributes.agi) || 0) * 0.2;
            const estWeaponAtk = Math.max(0, (Number(updated.offense.rangedAttack) || 0) - agiContrib);
            const diff = roundStat(estWeaponAtk * (ratio - 1));
            updated.offense.rangedAttack = roundStat((Number(updated.offense.rangedAttack) || 0) + diff);
            changes.push(`${item.name}: Ranged Atk ${diff >= 0 ? "+" : ""}${diff}`);
        } else if (sid === 15) {
            // Right Hand Weapon: scale relevant attack stat(s) (Club/Greatclub -> Healing Power + Melee, Staff/Scepter -> Magic + Melee, else Melee)
            const strContrib = (Number(updated.attributes.str) || 0) * 0.2;
            const intContrib = (Number(updated.attributes.int) || 0) * 0.2;
            const spiContrib = (Number(updated.attributes.spi) || 0) * 0.2;
            const isHealWep = typeLow.includes("club") || nameLow.includes("club") || nameLow.includes("dawn") || (Number(updated.offense.healingPower) || 0) > (Number(updated.offense.meleeAttack) || 0) * 1.1;
            const isMagicWep = typeLow.includes("staff") || typeLow.includes("scepter") || nameLow.includes("staff") || nameLow.includes("scepter") || (Number(updated.offense.magicAttack) || 0) > (Number(updated.offense.meleeAttack) || 0) * 1.1;
            const estMelee = Math.max(0, (Number(updated.offense.meleeAttack) || 0) - strContrib);
            const dMelee = roundStat(estMelee * (ratio - 1));
            updated.offense.meleeAttack = roundStat((Number(updated.offense.meleeAttack) || 0) + dMelee);
            if (isHealWep) {
                const estHeal = Math.max(0, (Number(updated.offense.healingPower) || 0) - spiContrib);
                const dHeal = roundStat(estHeal * (ratio - 1));
                updated.offense.healingPower = roundStat((Number(updated.offense.healingPower) || 0) + dHeal);
                changes.push(`${item.name}: Heal Pwr ${dHeal >= 0 ? "+" : ""}${dHeal}`);
            } else if (isMagicWep) {
                const estMag = Math.max(0, (Number(updated.offense.magicAttack) || 0) - intContrib);
                const dMag = roundStat(estMag * (ratio - 1));
                updated.offense.magicAttack = roundStat((Number(updated.offense.magicAttack) || 0) + dMag);
                changes.push(`${item.name}: Magic Atk ${dMag >= 0 ? "+" : ""}${dMag}`);
            } else {
                changes.push(`${item.name}: Melee Atk ${dMelee >= 0 ? "+" : ""}${dMelee}`);
            }
        }

        return {
            ...item,
            gradeId: newG.id,
            gradeName: newG.name,
            gradeColor: newG.color,
        };
    });

    updated.equipment = newEq;
    return { character: updated, changes, changedCount: changes.length };
}

// ============================================================================
// Skill-Specific Lunagem / Equipment Bonus Parser (e.g. "Increases Arc Lightning damage +4%.")
// ============================================================================

const GENERIC_NON_SKILL_PHRASES = new Set([
    "skill",
    "melee",
    "ranged",
    "magic",
    "spell",
    "melee skill",
    "ranged skill",
    "magic skill",
    "received",
    "received melee",
    "received ranged",
    "received magic",
    "incoming",
    "backstab",
    "backstab melee",
    "backstab ranged",
    "backstab magic",
    "critical",
    "crit",
    "melee critical",
    "ranged critical",
    "magic critical",
    "heal critical",
    "all",
    "pve",
    "pvp",
    "siege",
    "attack",
    "healing",
    "heal",
    "outgoing",
]);

function normalizeSkillMatchKey(raw) {
    return String(raw || "")
        .toLowerCase()
        .replace(/\([^)]*\)/g, " ")
        .replace(/^hollow\s+/i, "")
        .replace(/['’`]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/**
 * Parse a single equipment lunagem / lunafrost / synth line for a skill-specific bonus.
 * Examples:
 *  - "Increases Arc Lightning damage +4%." -> { skillKey: "arc lightning", kind: "damagePct", value: 4 }
 *  - "Increases Antithesis healing +4%." -> { skillKey: "antithesis", kind: "healingPct", value: 4 }
 *  - "Increases Precision Strike Critical Damage +5%." -> { skillKey: "precision strike", kind: "critBonusPct", value: 5 }
 */
export function parseSkillSpecificBonusLine(text) {
    const raw = String(text || "").trim();
    if (!raw || !raw.includes("%")) return null;

    const patterns = [
        {
            kind: "critBonusPct",
            re: /^(?:increases?\s+)?(.+?)\s+crit(?:ical)?\s+(?:damage|bonus)\s*(?:increase\s*)?[+]?(\d+(?:\.\d+)?)%/i,
        },
        {
            kind: "critRatePct",
            re: /^(?:increases?\s+)?(.+?)\s+crit(?:ical)?\s+(?:rate|chance)\s*(?:increase\s*)?[+]?(\d+(?:\.\d+)?)%/i,
        },
        {
            kind: "healingPct",
            re: /^(?:increases?\s+)?(.+?)\s+(?:skill\s+)?heal(?:ing)?\s*(?:increase\s*)?[+]?(\d+(?:\.\d+)?)%/i,
        },
        {
            kind: "damagePct",
            re: /^(?:increases?\s+)?(.+?)\s+(?:skill\s+)?damage\s*(?:increase\s*)?[+]?(\d+(?:\.\d+)?)%/i,
        },
    ];

    for (const { kind, re } of patterns) {
        const m = raw.match(re);
        if (!m) continue;
        const skillNameRaw = m[1].replace(/\b(the|your|of)\b/gi, " ").trim();
        const skillKey = normalizeSkillMatchKey(skillNameRaw);
        const value = parseFloat(m[2]);
        if (!skillKey || !Number.isFinite(value) || value <= 0) continue;
        if (GENERIC_NON_SKILL_PHRASES.has(skillKey)) continue;
        return {
            skillKey,
            skillNameRaw,
            kind,
            value,
            raw,
        };
    }
    return null;
}

/**
 * Inspect `character.equipment` (lunagems, lunafrost, synthStats) and equipped T7 Obsidian
 * special effects, summing any skill-specific bonuses that apply to `skill`
 * (e.g. 4x "Increases Arc Lightning damage +4%." = +16%, or Jade Despair #40610 +8% Basic Gods' Whip).
 */
export function getEquipmentSkillBonus(character, skill) {
    const empty = {
        damagePct: 0,
        healingPct: 0,
        critRatePct: 0,
        critBonusPct: 0,
        count: 0,
        summary: "",
        sources: [],
    };
    const eqList = Array.isArray(character?.equipment) ? character.equipment : [];
    const specialEffects = getEquippedSpecialEffects(character);
    if ((eqList.length === 0 && specialEffects.length === 0) || !skill?.name) return empty;

    const targetKey = normalizeSkillMatchKey(skill.name);
    if (!targetKey) return empty;

    let damagePct = 0;
    let healingPct = 0;
    let critRatePct = 0;
    let critBonusPct = 0;
    const grouped = new Map();

    const addBonus = (slotName, kind, value) => {
        if (kind === "damagePct" && skill.kind !== "heal") {
            damagePct += value;
        } else if (kind === "healingPct" && skill.kind === "heal") {
            healingPct += value;
        } else if (kind === "critRatePct") {
            critRatePct += value;
        } else if (kind === "critBonusPct") {
            critBonusPct += value;
        } else {
            return;
        }
        const gKey = `${slotName}|${kind}|${value}`;
        const prev = grouped.get(gKey) || { slotName, kind, value, count: 0 };
        prev.count += 1;
        grouped.set(gKey, prev);
    };

    const considerLine = (slotName, lineText) => {
        const parsed = parseSkillSpecificBonusLine(lineText);
        if (!parsed) return;
        if (parsed.skillKey !== targetKey) return;
        addBonus(slotName, parsed.kind, parsed.value);
    };

    for (const item of eqList) {
        if (!item) continue;
        const slotName = item.slotName || "Gear";
        if (Array.isArray(item.lunagems)) {
            for (const g of item.lunagems) {
                if (g?.text) considerLine(slotName, g.text);
            }
        }
        if (item.lunafrost?.text) {
            considerLine(slotName, item.lunafrost.text);
        }
        if (Array.isArray(item.synthStats)) {
            for (const line of item.synthStats) {
                considerLine(slotName, line);
            }
        }
    }

    const skillVariant = skill.variant || "base";
    for (const sp of specialEffects) {
        const bonusList = Array.isArray(sp.effect?.skillBonuses)
            ? sp.effect.skillBonuses
            : sp.effect?.skillBonus
              ? [sp.effect.skillBonus]
              : [];
        for (const sb of bonusList) {
            if (!sb) continue;
            if (sb.skillId && skill.id !== sb.skillId) continue;
            if (sb.variant && skillVariant !== sb.variant) continue;
            if (!["damagePct", "healingPct", "critRatePct", "critBonusPct"].includes(sb.kind)) continue;
            const isT7 = sp.effect?.label === "T7 Obsidian Effect";
            addBonus(isT7 ? `${sp.name} (T7)` : sp.name, sb.kind, Number(sb.value) || 0);
        }
    }

    const sources = Array.from(grouped.values());
    const count = sources.reduce((s, x) => s + x.count, 0);
    const summary = sources
        .map((s) => `${s.count}× ${s.slotName} (+${s.value}%)`)
        .join(", ");

    return {
        damagePct: roundStat(damagePct),
        healingPct: roundStat(healingPct),
        critRatePct: roundStat(critRatePct),
        critBonusPct: roundStat(critBonusPct),
        count,
        summary,
        sources,
    };
}

// ============================================================================
// Weapon Archetype 1-to-1 Swaps (2H <-> Dual Wield <-> 1H + Phys/Magic Shield)
// Exact AA Classic 1.3.6 equip passives:
//  - 2H (buff 8227): +5% Melee/Magic Skill Dmg, +5% Healing, -7% Cast Time, +50% Shield Pen Rate & +50% Shield Pen
//  - Dual Wield (buff 4899): +177 Attack Speed (+17.7%)
//  - Shield (buff 8226): +200 Phys Def, +200 Magic Def, +350 Max HP, +350 Max Mana + Shield Def & Block
// ============================================================================

export const WEAPON_ARCHETYPES = Object.freeze([
    {
        id: "two_hand",
        label: "2H Weapon (Staff / Nodachi / Longspear / Greatclub)",
        shortLabel: "2H Weapon",
        summary: "+5% Skill/Heal, -7% Cast, +50% Shield Pen, exact 2H/1H Weapon Atk (1.20× Melee / 1.143× Magic & Heal)",
    },
    {
        id: "dual_wield",
        label: "Dual Wield (1H + Offhand Weapon)",
        shortLabel: "Dual Wield",
        summary: "+177 Attack Speed (+17.7% GCD/Anim), 1H Weapon Atk",
    },
    {
        id: "shield_phys",
        label: "1H + Physical Shield",
        shortLabel: "1H + Phys Shield",
        summary: "+200 PDef/MDef, +350 HP/Mana, +Shield PDef & +10% Block (Equip Shield #16559)",
    },
    {
        id: "shield_magic",
        label: "1H + Magic Shield",
        shortLabel: "1H + Magic Shield",
        summary: "+200 PDef/MDef, +350 HP/Mana, +Shield MDef & +10% Block (Equip Shield #16559)",
    },
]);

const TWO_HAND_WEAPON_KEYWORDS = [
    "staff",
    "greatstaff",
    "nodachi",
    "longspear",
    "greatsword",
    "greataxe",
    "greatclub",
    "scythe",
    "warclub",
];

// Exact DaruGear `aa.calculateHoldableMainStat` 2H / 1H weapon multipliers:
//  - Melee:   2H (Longspear/Nodachi/Greatsword/GreatAxe/Warclub = 1.20) vs 1H (Sword/Katana/Axe/Dagger/Shortspear = 1.00) -> 1.20x
//  - Magic:   2H Staff (1.20) vs 1H Scepter (1.05) -> 1.20 / 1.05 = 8/7 (1.142857x); vs Obsidian Katana (1.05 * 0.95 = 0.9975) -> 1.2030x
//  - Healing: 2H Greatclub (1.20) vs 1H Club (1.05) -> 1.20 / 1.05 = 8/7 (1.142857x); vs Obsidian Shortspear (1.05 * 0.95 = 0.9975) -> 1.2030x
function computeExactTwoHandRatio(primaryStat, mhText = "") {
    if (primaryStat === "magicAttack") {
        if (mhText.includes("katana")) return 1.2 / (1.05 * 0.95);
        if (mhText.includes("scythe")) return 1.16 / 1.05;
        return 1.2 / 1.05;
    }
    if (primaryStat === "healingPower") {
        if (mhText.includes("shortspear")) return 1.2 / (1.05 * 0.95);
        if (mhText.includes("scythe")) return 1.16 / 1.05;
        return 1.2 / 1.05;
    }
    if (mhText.includes("scythe")) return 1.16 / 1.0;
    return 1.2 / 1.0;
}

/**
 * Exact DaruGear `aa.calculateHoldableMainStat(..., "pdef")` Shield Physical Defense formula:
 * Math.floor((level^1.1 * 85 + 100) * (grade.mainMod / 100) * 0.25 * (temper / 100))
 * (DaruGear returns 0 for Magic Shield main stat since its MDef comes from equip effects;
 * we scale Magic Shield default MDef from the same level/grade base.)
 */
function computeDefaultShieldDefense(gradeId = 9, isMagicShield = false, level = 62, temper = 100) {
    const g = getGradeById(gradeId);
    const t = !temper || temper < 100 || temper > 115 ? 100 : Number(temper);
    const physDef = Math.floor(
        (Math.pow(Number(level) || 62, 1.1) * 85 + 100) * (g.mainMod / 100) * 0.25 * (t / 100)
    );
    return isMagicShield ? Math.floor(physDef * 0.9) : physDef;
}

/**
 * Detect the build's current weapon setup archetype, mainhand grade, and dominant weapon stat.
 */
export function inspectWeaponArchetype(character) {
    const eq = Array.isArray(character?.equipment) ? character.equipment : [];
    const mh = eq.find((it) => Number(it.slotId) === 15) || null;
    const oh = eq.find((it) => Number(it.slotId) === 16) || null;
    const rawEqType = String(character?.metadata?.equipmentType || "").toLowerCase();
    const mhText = `${mh?.type || ""} ${mh?.name || ""}`.toLowerCase();
    const ohText = `${oh?.type || ""} ${oh?.name || ""}`.toLowerCase();

    let archetype = "dual_wield";
    if (rawEqType === "two_hand" || (!oh && TWO_HAND_WEAPON_KEYWORDS.some((k) => mhText.includes(k)))) {
        archetype = "two_hand";
    } else if (
        rawEqType === "magic_shield" ||
        (ohText.includes("shield") && (ohText.includes("magic") || ohText.includes("mist") || ohText.includes("v2")))
    ) {
        archetype = "shield_magic";
    } else if (
        rawEqType === "shield" ||
        ohText.includes("shield") ||
        Boolean(character?.defense?.hasShield) ||
        Number(character?.defense?.shieldPhysicalDefense) > 0
    ) {
        archetype = Number(character?.defense?.shieldPhysicalDefense) > 0 ? "shield_phys" : "shield_magic";
    } else if (rawEqType === "dual_wield" || (mh && oh)) {
        archetype = "dual_wield";
    }

    const gradeId = Number(mh?.gradeId ?? oh?.gradeId ?? 9) || 9;
    const weaponLevel = inferArmorTierLevel(oh || mh, 62);
    const weaponTemper = Number(oh?.ptemper ?? mh?.ptemper ?? 100) || 100;
    const off = character?.offense || {};
    const mAtk = Number(off.meleeAttack) || 0;
    const magAtk = Number(off.magicAttack) || 0;
    const hPwr = Number(off.healingPower) || 0;
    let primaryStat = "meleeAttack";
    if (magAtk >= mAtk && magAtk >= hPwr) primaryStat = "magicAttack";
    else if (hPwr >= mAtk && hPwr >= magAtk) primaryStat = "healingPower";

    const exactTwoHandRatio = computeExactTwoHandRatio(primaryStat, mhText);
    const currentShieldPdef = Number(character?.defense?.shieldPhysicalDefense) || 0;
    const currentShieldMdef =
        Number(character?.metadata?._swapShieldMdef) ||
        (archetype === "shield_magic" ? computeDefaultShieldDefense(gradeId, true, weaponLevel, weaponTemper) : 0);
    const currentShieldBlock =
        Number(character?.metadata?._swapShieldBlockPct) ||
        (archetype.startsWith("shield") ? Math.min(15, Number(character?.defense?.blockPct) || 10) : 0);

    return {
        archetype,
        gradeId,
        gradeName: getGradeById(gradeId).name,
        weaponLevel,
        weaponTemper,
        primaryStat,
        exactTwoHandRatio,
        mainHandName: mh?.name || null,
        offHandName: oh?.name || null,
        currentShieldPdef,
        currentShieldMdef,
        currentShieldBlock,
    };
}

/**
 * 1-to-1 reversible Weapon Archetype swap (2H <-> Dual Wield <-> 1H + Phys Shield <-> 1H + Magic Shield).
 * Swaps exact AA Classic 1.3.6 equip passives (#8227 2H, #4899 DW, #16559 Shield) + exact DaruGear 2H/1H
 * weapon-only attack ratio (excluding STR/INT/SPI attribute contributions).
 */
export function swapWeaponArchetype(character, targetArchetype, options = {}) {
    const info = inspectWeaponArchetype(character);
    const fromArch = info.archetype;
    const toArch = WEAPON_ARCHETYPES.some((a) => a.id === targetArchetype) ? targetArchetype : fromArch;
    const next = JSON.parse(JSON.stringify(character || {}));
    if (!next.offense || typeof next.offense !== "object") next.offense = {};
    if (!next.defense || typeof next.defense !== "object") next.defense = {};
    if (!next.attributes || typeof next.attributes !== "object") next.attributes = {};
    if (!next.metadata || typeof next.metadata !== "object") next.metadata = {};

    if (fromArch === toArch) {
        return { character: next, fromArchetype: fromArch, toArchetype: toArch, changed: false, summary: "Already equipped" };
    }

    const gradeId = Number(options.shieldGradeId ?? info.gradeId ?? 9) || 9;
    const shieldLevel = Number(options.shieldLevel ?? info.weaponLevel ?? 62) || 62;
    const shieldTemper = Number(options.shieldTemper ?? info.weaponTemper ?? 100) || 100;
    const includeWeaponAtkScale = options.includeWeaponAtkScale !== false;
    const defaultRatio = info.exactTwoHandRatio || 1.2 / 1.05;
    const twoHandAtkRatio = Math.max(
        1.0,
        Math.min(1.4, Number(options.twoHandAtkRatio ?? defaultRatio) || defaultRatio)
    );
    const newShieldBlock = Number.isFinite(Number(options.shieldBlockPct)) ? Number(options.shieldBlockPct) : 10;

    // 1. Remove old archetype equip passive
    if (fromArch === "two_hand") {
        next.offense.meleeSkillDamagePct = roundStat((Number(next.offense.meleeSkillDamagePct) || 0) - 5);
        next.offense.magicSkillDamagePct = roundStat((Number(next.offense.magicSkillDamagePct) || 0) - 5);
        next.offense.healingPct = roundStat((Number(next.offense.healingPct) || 0) - 5);
        next.offense.castTimePct = roundStat((Number(next.offense.castTimePct) || 100) + 7);
        next.offense.shieldDefPenRatePct = Math.max(0, roundStat((Number(next.offense.shieldDefPenRatePct) || 0) - 50));
        next.offense.shieldDefPenPct = Math.max(0, roundStat((Number(next.offense.shieldDefPenPct) || 0) - 50));
    } else if (fromArch === "dual_wield") {
        next.offense.attackSpeed = roundStat((Number(next.offense.attackSpeed) || 0) - 177);
    } else if (fromArch === "shield_phys" || fromArch === "shield_magic") {
        const prevPdef =
            fromArch === "shield_phys"
                ? info.currentShieldPdef || computeDefaultShieldDefense(gradeId, false, shieldLevel, shieldTemper)
                : 0;
        const prevMdef =
            fromArch === "shield_magic"
                ? info.currentShieldMdef || computeDefaultShieldDefense(gradeId, true, shieldLevel, shieldTemper)
                : 0;
        const prevBlk = info.currentShieldBlock || 10;
        next.maxHealth = Math.max(1, roundStat((Number(next.maxHealth) || 0) - 350));
        next.maxMana = Math.max(0, roundStat((Number(next.maxMana) || 0) - 350));
        next.defense.physicalDefense = Math.max(0, roundStat((Number(next.defense.physicalDefense) || 0) - 200 - prevPdef));
        next.defense.magicDefense = Math.max(0, roundStat((Number(next.defense.magicDefense) || 0) - 200 - prevMdef));
        next.defense.shieldPhysicalDefense = 0;
        next.defense.blockPct = Math.max(0, roundStat((Number(next.defense.blockPct) || 0) - prevBlk));
        next.defense.hasShield = false;
        delete next.metadata._swapShieldMdef;
        delete next.metadata._swapShieldBlockPct;
    }

    // 2. Apply new archetype equip passive
    if (toArch === "two_hand") {
        next.offense.meleeSkillDamagePct = roundStat((Number(next.offense.meleeSkillDamagePct) || 0) + 5);
        next.offense.magicSkillDamagePct = roundStat((Number(next.offense.magicSkillDamagePct) || 0) + 5);
        next.offense.healingPct = roundStat((Number(next.offense.healingPct) || 0) + 5);
        next.offense.castTimePct = Math.max(40, roundStat((Number(next.offense.castTimePct) || 100) - 7));
        next.offense.shieldDefPenRatePct = roundStat((Number(next.offense.shieldDefPenRatePct) || 0) + 50);
        next.offense.shieldDefPenPct = roundStat((Number(next.offense.shieldDefPenPct) || 0) + 50);
        next.defense.hasShield = false;
        next.defense.shieldPhysicalDefense = 0;
        next.metadata.equipmentType = "two_hand";
    } else if (toArch === "dual_wield") {
        next.offense.attackSpeed = roundStat((Number(next.offense.attackSpeed) || 0) + 177);
        next.defense.hasShield = false;
        next.defense.shieldPhysicalDefense = 0;
        next.metadata.equipmentType = "dual_wield";
    } else if (toArch === "shield_phys" || toArch === "shield_magic") {
        const isMag = toArch === "shield_magic";
        const addPdef = !isMag
            ? Number.isFinite(Number(options.shieldPhysDef))
                ? Number(options.shieldPhysDef)
                : computeDefaultShieldDefense(gradeId, false, shieldLevel, shieldTemper)
            : 0;
        const addMdef = isMag
            ? Number.isFinite(Number(options.shieldMagicDef))
                ? Number(options.shieldMagicDef)
                : computeDefaultShieldDefense(gradeId, true, shieldLevel, shieldTemper)
            : 0;
        next.maxHealth = roundStat((Number(next.maxHealth) || 0) + 350);
        next.maxMana = roundStat((Number(next.maxMana) || 0) + 350);
        next.defense.physicalDefense = roundStat((Number(next.defense.physicalDefense) || 0) + 200 + addPdef);
        next.defense.magicDefense = roundStat((Number(next.defense.magicDefense) || 0) + 200 + addMdef);
        next.defense.shieldPhysicalDefense = addPdef;
        next.defense.blockPct = roundStat((Number(next.defense.blockPct) || 0) + newShieldBlock);
        next.defense.hasShield = true;
        next.metadata.equipmentType = isMag ? "magic_shield" : "shield";
        next.metadata._swapShieldMdef = addMdef;
        next.metadata._swapShieldBlockPct = newShieldBlock;
    }

    // 3. Reversible 2H <-> 1H weapon-only attack power scaling (excludes attribute attack STR/INT/SPI * 0.2!)
    if (includeWeaponAtkScale && twoHandAtkRatio > 1.0001) {
        const was2H = fromArch === "two_hand";
        const is2H = toArch === "two_hand";
        if (was2H !== is2H) {
            const pStat = options.primaryStat || info.primaryStat;
            const curVal = Number(next.offense[pStat]) || 0;
            const attrKey = pStat === "magicAttack" ? "int" : pStat === "healingPower" ? "spi" : "str";
            const attrContrib = (Number(next.attributes[attrKey]) || 0) * 0.2;
            const weaponOnly = Math.max(0, curVal - attrContrib);
            if (weaponOnly > 0) {
                const scaledWeapon = is2H ? weaponOnly * twoHandAtkRatio : weaponOnly / twoHandAtkRatio;
                next.offense[pStat] = roundStat(attrContrib + scaledWeapon);
            }
        }
    }

    const toLabel = WEAPON_ARCHETYPES.find((a) => a.id === toArch)?.shortLabel || toArch;
    const fromLabel = WEAPON_ARCHETYPES.find((a) => a.id === fromArch)?.shortLabel || fromArch;
    return {
        character: next,
        fromArchetype: fromArch,
        toArchetype: toArch,
        changed: true,
        summary: `${fromLabel} → ${toLabel}`,
    };
}
