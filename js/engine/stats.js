/**
 * Character stat normalization, overrides, toggleable AA Classic buffs/debuffs,
 * and core mitigation curve helpers.
 */

import { getEquippedSpecialEffects } from "../adapters/darugear_calc.js";
import { DEFAULT_CONSTANTS, mergeConstants } from "./constants.js";

export const BUILD_CATEGORIES = Object.freeze([
    { id: "melee", label: "Melee", hint: "Battlerage / Physical Melee DPS" },
    { id: "mage", label: "Mage", hint: "Sorcery / Malediction / Magic DPS" },
    { id: "archer", label: "Archer", hint: "Archery / Ranged Physical DPS" },
    { id: "healer", label: "Healer", hint: "Vitalism / Support & Healing" },
    { id: "tank", label: "Tank", hint: "Shield / Initiator / Bruiser Tank" },
]);

export const ARMOR_TYPES = Object.freeze([
    { id: "plate", label: "Plate" },
    { id: "leather", label: "Leather" },
    { id: "cloth", label: "Cloth" },
]);

const VALID_CATEGORY_IDS = new Set(BUILD_CATEGORIES.map((c) => c.id));
const VALID_CUSTOM_CATEGORY_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const VALID_ARMOR_TYPE_IDS = new Set(ARMOR_TYPES.map((a) => a.id));
const ARMOR_SLOT_IDS = new Set([1, 2, 3, 4, 5, 7, 8]);

/**
 * Resolve a build's dominant armor type ("plate" | "leather" | "cloth").
 * Respects an explicit `character.metadata.armorType` override; otherwise counts equipped
 * armor pieces across the 7 armor slots and falls back to PDef/MDef ratio when unequipped.
 */
export function inferBuildArmorType(character) {
    const explicit = String(character?.metadata?.armorType || character?.armorType || "")
        .trim()
        .toLowerCase();
    if (VALID_ARMOR_TYPE_IDS.has(explicit)) return explicit;

    const eq = Array.isArray(character?.equipment) ? character.equipment : [];
    const counts = { plate: 0, leather: 0, cloth: 0 };
    let armorPieces = 0;
    for (const item of eq) {
        if (!item || !ARMOR_SLOT_IDS.has(Number(item.slotId))) continue;
        armorPieces++;
        const raw = `${item.type || ""} ${item.armorType || ""}`.toLowerCase();
        if (raw.includes("plate")) counts.plate++;
        else if (raw.includes("leather")) counts.leather++;
        else if (raw.includes("cloth")) counts.cloth++;
    }
    if (counts.plate >= counts.leather && counts.plate >= counts.cloth && counts.plate > 0) {
        return "plate";
    }
    if (counts.leather >= counts.cloth && counts.leather > 0) {
        return "leather";
    }
    if (counts.cloth > 0) {
        return "cloth";
    }
    if (armorPieces === 0) {
        const pd = Number(character?.defense?.physicalDefense) || 0;
        const md = Number(character?.defense?.magicDefense) || 0;
        if (pd > md * 1.6) return "plate";
        if (md > pd * 1.4) return "cloth";
        return "leather";
    }
    return "cloth";
}

/**
 * Resolve a build's archetype category ("melee" | "mage" | "archer" | "healer" | "tank").
 * Respects an explicit `character.metadata.category` override; otherwise infers cleanly from
 * attack/healing power, shield + defense profile, and class name.
 */
export function inferBuildCategory(character) {
    const explicit = String(character?.metadata?.category || character?.category || "")
        .trim()
        .toLowerCase();
    if (VALID_CATEGORY_IDS.has(explicit) || VALID_CUSTOM_CATEGORY_RE.test(explicit)) return explicit;

    const off = character?.offense || {};
    const def = character?.defense || {};
    const mAtk = Number(off.meleeAttack) || 0;
    const rAtk = Number(off.rangedAttack) || 0;
    const mgAtk = Number(off.magicAttack) || 0;
    const hPow = Number(off.healingPower) || 0;
    const maxAtk = Math.max(mAtk, rAtk, mgAtk);
    const cls = String(character?.className || character?.metadata?.className || "").toLowerCase();
    const hasShield = Boolean(def.hasShield || Number(def.shieldPhysicalDefense) > 0 || Number(def.blockPct) >= 12);

    if (hPow >= 350 && hPow >= maxAtk * 0.75) return "healer";
    if (hasShield && maxAtk < 700 && hPow < 350) {
        return "tank";
    }
    if (/\b(cleric|templar|hierophant|caretaker|oracle|confessor|assassin|soothsayer|paladin)\b/.test(cls) && hPow >= 250) {
        return "healer";
    }
    if (
        /\b(skullknight|dreambreaker|abolisher|nightcloak|hexblade|doomlord|defiler|bastion|stone arrow|blighter)\b/.test(cls) &&
        (hasShield ? maxAtk < 1100 : maxAtk < 700)
    ) {
        return "tank";
    }
    if (mgAtk >= mAtk && mgAtk >= rAtk && mgAtk > 150) return "mage";
    if (rAtk >= mAtk && rAtk >= mgAtk && rAtk > 150) return "archer";
    if (mAtk > 150) return "melee";
    if (hasShield || Number(def.physicalDefense) > 10000) return "tank";
    return "melee";
}

export function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
}

export function createDefaultCharacter(overrides = {}) {
    const base = {
        name: "Unnamed Build",
        source: "manual",
        level: 55,
        gearScore: 0,
        maxHealth: 20000,
        maxMana: 10000,
        attributes: {
            str: 158,
            agi: 158,
            sta: 158,
            int: 158,
            spi: 158,
        },
        offense: {
            meleeAttack: 1000,
            rangedAttack: 1000,
            magicAttack: 1000,
            healingPower: 1000,

            meleeAccuracyPct: 100,
            rangedAccuracyPct: 100,
            magicAccuracyPct: 100,

            meleeCritRatePct: 25,
            rangedCritRatePct: 25,
            magicCritRatePct: 25,
            healCritRatePct: 25,

            meleeCritBonusPct: 100,
            rangedCritBonusPct: 100,
            magicCritBonusPct: 100,
            healCritBonusPct: 100,

            meleeSkillDamagePct: 0,
            rangedSkillDamagePct: 0,
            magicSkillDamagePct: 0,
            healingPct: 0,

            backstabMeleeDamagePct: 0,
            backstabRangedDamagePct: 0,
            backstabMagicDamagePct: 0,

            defensePenetration: 0,
            magicDefensePenetration: 0,
            shieldDefPenRatePct: 0,
            shieldDefPenPct: 0,
            focus: 0,
            attackSpeed: 0,
            castTimePct: 100,
        },
        defense: {
            physicalDefense: 5000,
            magicDefense: 5000,
            shieldPhysicalDefense: 0,
            toughness: 2500,
            resilience: 3000,

            evasionPct: 5,
            parryPct: 5,
            rangedParryPct: 0,
            blockPct: 0,
            hasShield: false,
            dualWieldRangedParry: false,

            receivedMeleeDrPct: 0,
            receivedRangedDrPct: 0,
            receivedMagicDrPct: 0,

            fixedMeleeDr: 0,
            fixedRangedDr: 0,
            fixedMagicDr: 0,

            receivedHealingPct: 0,
        },
    };

    const merged = applyOverrides(base, overrides);
    const ovDef = overrides?.defense || {};
    if (ovDef.hasShield === undefined) {
        merged.defense.hasShield =
            Number(merged.defense.shieldPhysicalDefense) > 0 || Number(merged.defense.blockPct) > 0;
    }
    if (ovDef.dualWieldRangedParry === undefined) {
        merged.defense.dualWieldRangedParry = Number(merged.defense.rangedParryPct) > 0;
    }
    return merged;
}

/**
 * Pure deep merge of partial overrides into a character sheet (never mutates input).
 */
export function applyOverrides(character, overrides = {}) {
    const src = character || {};
    const ov = overrides || {};
    return {
        ...src,
        ...ov,
        attributes: {
            ...(src.attributes || {}),
            ...(ov.attributes || {}),
        },
        offense: {
            ...(src.offense || {}),
            ...(ov.offense || {}),
        },
        defense: {
            ...(src.defense || {}),
            ...(ov.defense || {}),
        },
    };
}

/**
 * Toggleable AA Classic 1.3.6 combat buffs, passives, and debuffs.
 * All values verified against live buff_dump.txt / skill_dump_1.txt.
 */
export const COMBAT_MODIFIERS = {
    // --- Attacker Offensive Buffs / Procs ---
    zeal: {
        id: "zeal",
        name: "Zeal (Songcraft)",
        side: "attacker",
        icon: "assets/icons/icon_skill_romance03.png",
        description: "+5% all Crit Rates, +75% all Crit Damage/Heal for 6s",
        addOffense: {
            meleeCritRatePct: 5,
            rangedCritRatePct: 5,
            magicCritRatePct: 5,
            healCritRatePct: 5,
            meleeCritBonusPct: 75,
            rangedCritBonusPct: 75,
            magicCritBonusPct: 75,
            healCritBonusPct: 75,
        },
    },
    delirium_5: {
        id: "delirium_5",
        name: "Delirium (Battlerage)",
        side: "attacker",
        icon: "assets/icons/icon_skill_fight31.png",
        maxStacks: 5,
        defaultStacks: 5,
        stackUnit: "x",
        description: "+2% Melee Skill Damage, +5% Melee Crit Damage per stack (1-5 stacks, up to +10% / +25%; AA Classic buff 11344)",
        addOffense: {
            meleeSkillDamagePct: 2,
            meleeCritBonusPct: 5,
        },
    },
    battle_focus: {
        id: "battle_focus",
        name: "Battle Focus (Battlerage)",
        side: "both",
        icon: "assets/icons/icon_skill_buff02.png",
        description: "Increases Melee Crit Damage and Melee Parry Rate for 20s (Ranks 1-4)",
        ranks: [
            { rank: 1, summary: "+15% Melee CD, +28% Parry", addOffense: { meleeCritBonusPct: 15 }, addDefense: { parryPct: 28 } },
            { rank: 2, summary: "+20% Melee CD, +30% Parry", addOffense: { meleeCritBonusPct: 20 }, addDefense: { parryPct: 30 } },
            { rank: 3, summary: "+25% Melee CD, +32% Parry", addOffense: { meleeCritBonusPct: 25 }, addDefense: { parryPct: 32 } },
            { rank: 4, summary: "+30% Melee CD, +34% Parry", addOffense: { meleeCritBonusPct: 30 }, addDefense: { parryPct: 34 } },
        ],
    },
    frenzy: {
        id: "frenzy",
        name: "Frenzy (Battlerage)",
        side: "both",
        exclusiveGroup: "frenzy_buff",
        icon: "assets/icons/icon_skill_buff09.png",
        maxStacks: 10,
        defaultStacks: 5,
        stackUnit: "x",
        description: "+30 Melee & Magic Attack per hit taken (1-10 stacks, up to +300) and -21% Received Magic Damage (AA Classic buff 182)",
        addOffense: {
            meleeAttack: 30,
            magicAttack: 30,
        },
        flatAddDefense: {
            receivedMagicDrPct: 21,
        },
    },
    hollow_frenzy: {
        id: "hollow_frenzy",
        name: "Hollow Frenzy (Battlerage)",
        side: "both",
        exclusiveGroup: "frenzy_buff",
        icon: "assets/icons/icon_hollow_frenzy.png",
        maxStacks: 5,
        defaultStacks: 5,
        stackUnit: "x",
        description: "Enlightened Hollow: +30 Melee & Magic Attack, +40 Attack Speed, +300 Focus, and +3% Received Damage (+5% Move Spd) per stack (1-5 stacks, up to +150 Atk / +200 Atk Spd / +1,500 Focus / -15% DR; AA Classic 1.3.6)",
        addOffense: {
            meleeAttack: 30,
            magicAttack: 30,
            attackSpeed: 40,
            focus: 300,
        },
        addDefense: {
            receivedMeleeDrPct: -3,
            receivedRangedDrPct: -3,
            receivedMagicDrPct: -3,
        },
    },
    bloody_chantey: {
        id: "bloody_chantey",
        name: "Bloody Chantey (Songcraft)",
        side: "attacker",
        icon: "assets/icons/icon_skill_buff83.png",
        description: "Songcraft Perform: increases Melee, Ranged & Magic Skill Damage at max ramp (Ranks 1-2)",
        ranks: [
            { rank: 1, summary: "+24% Skill Dmg (16-24%)", addOffense: { meleeSkillDamagePct: 24, rangedSkillDamagePct: 24, magicSkillDamagePct: 24 } },
            { rank: 2, summary: "+26% Skill Dmg (18-26%)", addOffense: { meleeSkillDamagePct: 26, rangedSkillDamagePct: 26, magicSkillDamagePct: 26 } },
        ],
    },
    deadeye: {
        id: "deadeye",
        name: "Deadeye (Archery)",
        side: "attacker",
        exclusiveGroup: "deadeye_buff",
        icon: "assets/icons/icon_skill_wild21.png",
        description: "Increases Ranged Attack while standing still (Ranks 1-6)",
        ranks: [
            { rank: 1, summary: "+20 Ranged Atk", addOffense: { rangedAttack: 20 } },
            { rank: 2, summary: "+40 Ranged Atk", addOffense: { rangedAttack: 40 } },
            { rank: 3, summary: "+60 Ranged Atk", addOffense: { rangedAttack: 60 } },
            { rank: 4, summary: "+80 Ranged Atk", addOffense: { rangedAttack: 80 } },
            { rank: 5, summary: "+100 Ranged Atk", addOffense: { rangedAttack: 100 } },
            { rank: 6, summary: "+120 Ranged Atk", addOffense: { rangedAttack: 120 } },
        ],
    },
    hollow_deadeye: {
        id: "hollow_deadeye",
        name: "Hollow Deadeye (Archery)",
        side: "attacker",
        exclusiveGroup: "deadeye_buff",
        icon: "assets/icons/icon_hollow_deadeye.png",
        maxStacks: 100,
        defaultStacks: 100,
        stackUnit: "x",
        description: "Enlightened Hollow: Ramps while moving up to +160 Ranged Attack at 100 stacks (+1.6/stack). At 100 stacks, makes Snipe Instant Cast (60s; AA Classic 1.3.6)",
        addOffense: {
            rangedAttack: 1.6,
        },
    },
    double_recurve: {
        id: "double_recurve",
        name: "Double Recurve (Archery)",
        side: "attacker",
        icon: "assets/icons/icon_skill_buff54.png",
        description: "Increases Ranged Critical Rate for 10s (Ranks 1-5)",
        ranks: [
            { rank: 1, summary: "+7% Ranged Crit", addOffense: { rangedCritRatePct: 7 } },
            { rank: 2, summary: "+8% Ranged Crit", addOffense: { rangedCritRatePct: 8 } },
            { rank: 3, summary: "+9% Ranged Crit", addOffense: { rangedCritRatePct: 9 } },
            { rank: 4, summary: "+11% Ranged Crit", addOffense: { rangedCritRatePct: 11 } },
            { rank: 5, summary: "+12% Ranged Crit", addOffense: { rangedCritRatePct: 12 } },
        ],
    },
    freerunner: {
        id: "freerunner",
        name: "Freerunner (Shadowplay)",
        side: "both",
        icon: "assets/icons/icon_skill_buff70.png",
        description: "Increases Agility, Move Speed, and Attack Speed (+64) for 30s (Ranks 1-4)",
        ranks: [
            { rank: 1, summary: "+160 AGI, +64 Atk Spd", addAttributes: { agi: 160 }, addOffense: { attackSpeed: 64 } },
            { rank: 2, summary: "+180 AGI, +64 Atk Spd", addAttributes: { agi: 180 }, addOffense: { attackSpeed: 64 } },
            { rank: 3, summary: "+200 AGI, +64 Atk Spd", addAttributes: { agi: 200 }, addOffense: { attackSpeed: 64 } },
            { rank: 4, summary: "+220 AGI, +64 Atk Spd", addAttributes: { agi: 220 }, addOffense: { attackSpeed: 64 } },
        ],
    },
    intensity: {
        id: "intensity",
        name: "Intensity (Archery)",
        side: "attacker",
        icon: "assets/icons/icon_skill_buff56.png",
        maxStacks: 5,
        defaultStacks: 5,
        stackUnit: "s",
        description: "+6% Ranged Crit Rate per second over 5s (up to +30%; adjust 1-5s stacks)",
        addOffense: {
            rangedCritRatePct: 6,
        },
    },
    rhythm_stacks: {
        id: "rhythm_stacks",
        name: "Rhythm / Disciplined Perf. (Songcraft)",
        side: "attacker",
        icon: "assets/icons/icon_skill_buff279.png",
        maxStacks: 15,
        defaultStacks: 15,
        stackUnit: "x",
        description: "+7 Magic Attack & +7 Healing Power per stack, up to 15 stacks (+105 max; AA Classic buff 15031)",
        addOffense: {
            magicAttack: 7,
            healingPower: 7,
        },
    },
    weapon_mastery: {
        id: "weapon_mastery",
        name: "Weapon Mastery (Battlerage)",
        side: "attacker",
        icon: "assets/icons/icon_skill_fight30.png",
        description: "+15% Battlerage skill damage",
        skillsetDamageBonusPct: { battlerage: 15 },
    },
    aranzebs_infusion: {
        id: "aranzebs_infusion",
        name: "Aranzeb's Infusion (Sorcery)",
        side: "attacker",
        icon: "assets/icons/icon_skill_magic25.png",
        description: "+15% Sorcery skill damage",
        skillsetDamageBonusPct: { sorcery: 15 },
    },
    feral_claws: {
        id: "feral_claws",
        name: "Feral Claws (Archery)",
        side: "attacker",
        icon: "assets/icons/icon_skill_wild26.png",
        description: "+15% Archery skill damage",
        skillsetDamageBonusPct: { archery: 15 },
    },
    overpowered_spell_locus: {
        id: "overpowered_spell_locus",
        name: "Overpowered Spell Locus (Occultism)",
        side: "attacker",
        icon: "assets/icons/icon_skill_death24.png",
        description: "+15% all Skill Damage (non-healing)",
        addOffense: {
            meleeSkillDamagePct: 15,
            rangedSkillDamagePct: 15,
            magicSkillDamagePct: 15,
        },
    },
    float: {
        id: "float",
        name: "Float (Archery)",
        side: "attacker",
        icon: "assets/icons/icon_skill_wild05.png",
        description: "+30% Ranged Damage",
        addOffense: {
            rangedSkillDamagePct: 30,
        },
    },
    piercing: {
        id: "piercing",
        name: "Piercing (Shadowplay)",
        side: "attacker",
        icon: "assets/icons/icon_skill_vocation12.png",
        description: "+10% Melee & Ranged Crit Rate",
        addOffense: {
            meleeCritRatePct: 10,
            rangedCritRatePct: 10,
        },
    },
    reprisal: {
        id: "reprisal",
        name: "Reprisal (Occultism)",
        side: "attacker",
        icon: "assets/icons/icon_skill_death08.png",
        description: "+20% Melee, Ranged & Magic Crit Rate",
        addOffense: {
            meleeCritRatePct: 20,
            rangedCritRatePct: 20,
            magicCritRatePct: 20,
        },
    },
    intensified_harm: {
        id: "intensified_harm",
        name: "Intensified Harm (Occultism)",
        side: "attacker",
        icon: "assets/icons/icon_skill_death15.png",
        description: "+25% Melee, Ranged & Magic Crit Damage",
        addOffense: {
            meleeCritBonusPct: 25,
            rangedCritBonusPct: 25,
            magicCritBonusPct: 25,
        },
    },
    magic_circle: {
        id: "magic_circle",
        name: "Magic Circle (Sorcery)",
        side: "attacker",
        icon: "assets/icons/icon_skill_magic15.png",
        description: "Increases Magic Attack & Magic Crit Rate while inside the circle (Ranks 1-5)",
        ranks: [
            { rank: 1, summary: "+93 Magic Atk, +5% Crit", addOffense: { magicAttack: 93, magicCritRatePct: 5 } },
            { rank: 2, summary: "+117 Magic Atk, +7% Crit", addOffense: { magicAttack: 117, magicCritRatePct: 7 } },
            { rank: 3, summary: "+141 Magic Atk, +9% Crit", addOffense: { magicAttack: 141, magicCritRatePct: 9 } },
            { rank: 4, summary: "+163 Magic Atk, +11% Crit", addOffense: { magicAttack: 163, magicCritRatePct: 11 } },
            { rank: 5, summary: "+187 Magic Atk, +13% Crit", addOffense: { magicAttack: 187, magicCritRatePct: 13 } },
        ],
    },
    ode_to_recovery_r5: {
        id: "ode_to_recovery_r5",
        name: "Ode to Recovery (Songcraft)",
        side: "attacker",
        icon: "assets/icons/icon_skill_buff78.png",
        description: "Increases Healing Power while performing Ode to Recovery (Ranks 1-5; Life Ode R5 grants +169)",
        ranks: [
            { rank: 1, summary: "+30 Healing Power", addOffense: { healingPower: 30 } },
            { rank: 2, summary: "+55 Healing Power", addOffense: { healingPower: 55 } },
            { rank: 3, summary: "+80 Healing Power", addOffense: { healingPower: 80 } },
            { rank: 4, summary: "+105 Healing Power", addOffense: { healingPower: 105 } },
            { rank: 5, summary: "+130 Healing Power", addOffense: { healingPower: 130 } },
        ],
    },
    inspired_thwart: {
        id: "inspired_thwart",
        aacBuffId: 127,
        name: "Thwart / Inspired (Hearten)",
        side: "both",
        icon: "assets/icons/icon_skill_buff43.png",
        maxStacks: 3,
        defaultStacks: 3,
        stackUnit: "x",
        description: "Auramancy Thwart / Hearten passive (AA Classic buff 127): +53 Attack Speed per stack (1-3 stacks, up to +159 Atk Spd / +15.9% GCD speed; also boosts Vicious Implosion & reduces Vitalism CDs)",
        addOffense: {
            attackSpeed: 53,
        },
    },
    drum_to_the_arena_5700: {
        id: "drum_to_the_arena_5700",
        aacBuffId: 5700,
        name: "Drum Buff: To the arena! (War Drum)",
        side: "both",
        icon: "assets/icons/icon_item_0993.png",
        description: "War Drum buff ('To the arena!', AA Classic buff 5700; 30m): +5 Melee, Ranged & Magic Attack and -2% Received Damage",
        addOffense: {
            meleeAttack: 5,
            rangedAttack: 5,
            magicAttack: 5,
        },
        addDefense: {
            receivedMeleeDrPct: 2,
            receivedRangedDrPct: 2,
            receivedMagicDrPct: 2,
        },
    },
    dark_watchers_dagger: {
        id: "dark_watchers_dagger",
        name: "Dark Watcher's Dagger (Dungeon)",
        side: "attacker",
        icon: "assets/icons/icon_skill_buff56.png",
        maxStacks: 20,
        defaultStacks: 20,
        stackUnit: "s",
        description: "Gradually increases Melee Crit Rate +1%/s up to +20% over 20s (AA Classic buff 6143)",
        addOffense: {
            meleeCritRatePct: 1,
        },
    },
    sapphire_watchers_dagger: {
        id: "sapphire_watchers_dagger",
        name: "Sapphire Watcher's Dagger (Dungeon)",
        side: "attacker",
        icon: "assets/icons/icon_skill_buff56.png",
        maxStacks: 20,
        defaultStacks: 20,
        stackUnit: "s",
        description: "Gradually increases Melee Crit Rate +1.25%/s up to +25% over 20s (AA Classic buff 9000507)",
        addOffense: {
            meleeCritRatePct: 1.25,
        },
    },
    berserk_1668: {
        id: "berserk_1668",
        name: "Berserk (Buff 1668)",
        side: "both",
        icon: "assets/icons/icon_skill_buff09.png",
        description: "+50% Melee & Ranged Skill Damage, +500 Attack Speed (+50% GCD/Anim Spd), +15% Received Damage for 10s (AA Classic buff 1668)",
        addOffense: {
            meleeSkillDamagePct: 50,
            rangedSkillDamagePct: 50,
            attackSpeed: 500,
        },
        addDefense: {
            receivedMeleeDrPct: -15,
            receivedRangedDrPct: -15,
            receivedMagicDrPct: -15,
        },
    },
    doomshadow_nodachi: {
        id: "doomshadow_nodachi",
        name: "Supreme Doomshadow Nodachi (Pervasive Black Magic)",
        side: "both",
        icon: "assets/icons/icon_skill_buff60.png",
        description: "Pervasive Black Magic: +10% Melee Attack, +250 Attack Speed (+25% GCD/Anim Spd), -8% Physical Defense for 18s (AA Classic buff 18169)",
        addOffense: {
            attackSpeed: 250,
        },
        mulOffense: {
            meleeAttack: 1.1,
        },
        mulDefense: {
            physicalDefense: 0.92,
        },
    },

    // --- Raid / Shared Buffs (Both Offense & Defense) ---
    health_lift: {
        id: "health_lift",
        name: "Health Lift (Auramancy)",
        side: "both",
        exclusiveGroup: "max_hp_buff",
        icon: "assets/icons/icon_skill_buff39.png",
        description: "Increases Max Health for 30m (Ranks 1-6; mutually exclusive with Refreshment)",
        ranks: [
            { rank: 1, summary: "+974 Max HP", addMaxHealth: 974 },
            { rank: 2, summary: "+1,288 Max HP", addMaxHealth: 1288 },
            { rank: 3, summary: "+1,602 Max HP", addMaxHealth: 1602 },
            { rank: 4, summary: "+2,086 Max HP", addMaxHealth: 2086 },
            { rank: 5, summary: "+2,570 Max HP", addMaxHealth: 2570 },
            { rank: 6, summary: "+3,054 Max HP", addMaxHealth: 3054 },
        ],
    },
    refreshment: {
        id: "refreshment",
        name: "Refreshment (Defense)",
        side: "both",
        exclusiveGroup: "max_hp_buff",
        icon: "assets/icons/icon_skill_buff32.png",
        description: "Increases Max Health for 30m (Ranks 1-8; mutually exclusive with Health Lift; Bear's Vigor increases R8 to +4,077)",
        ranks: [
            { rank: 1, summary: "+386 Max HP", addMaxHealth: 386 },
            { rank: 2, summary: "+734 Max HP", addMaxHealth: 734 },
            { rank: 3, summary: "+1,082 Max HP", addMaxHealth: 1082 },
            { rank: 4, summary: "+1,430 Max HP", addMaxHealth: 1430 },
            { rank: 5, summary: "+1,778 Max HP", addMaxHealth: 1778 },
            { rank: 6, summary: "+2,318 Max HP", addMaxHealth: 2318 },
            { rank: 7, summary: "+2,858 Max HP", addMaxHealth: 2858 },
            { rank: 8, summary: "+3,398 Max HP", addMaxHealth: 3398 },
        ],
    },
    aranzebs_boon: {
        id: "aranzebs_boon",
        name: "Aranzeb's Boon (Vitalism)",
        side: "both",
        icon: "assets/icons/icon_skill_buff116.png",
        description: "Increases All Attributes (STR/AGI/STA/INT/SPI) for 30m (Ranks 1-5)",
        ranks: [
            { rank: 1, summary: "+15 All Stats", addAttributes: { str: 15, agi: 15, sta: 15, int: 15, spi: 15 } },
            { rank: 2, summary: "+20 All Stats", addAttributes: { str: 20, agi: 20, sta: 20, int: 20, spi: 20 } },
            { rank: 3, summary: "+25 All Stats", addAttributes: { str: 25, agi: 25, sta: 25, int: 25, spi: 25 } },
            { rank: 4, summary: "+30 All Stats", addAttributes: { str: 30, agi: 30, sta: 30, int: 30, spi: 30 } },
            { rank: 5, summary: "+35 All Stats", addAttributes: { str: 35, agi: 35, sta: 35, int: 35, spi: 35 } },
        ],
    },
    general_title: {
        id: "general_title",
        name: "General Title (PvP)",
        side: "both",
        icon: "assets/icons/icon_item_1500.png",
        description: "+25 All Attributes (STR/AGI/STA/INT/SPI) (AA Classic buff 6605)",
        addAttributes: { str: 25, agi: 25, sta: 25, int: 25, spi: 25 },
    },
    hummingbird_ditty: {
        id: "hummingbird_ditty",
        name: "Hummingbird Ditty (Songcraft)",
        side: "attacker",
        icon: "assets/icons/icon_skill_romance01.png",
        description: "Reduces Cast Time for 30m (Ranks 1-6; AA Classic buff 13782 at Rank 6)",
        ranks: [
            { rank: 1, summary: "-6% Cast Time", addOffense: { castTimePct: -6 } },
            { rank: 2, summary: "-7% Cast Time", addOffense: { castTimePct: -7 } },
            { rank: 3, summary: "-8% Cast Time", addOffense: { castTimePct: -8 } },
            { rank: 4, summary: "-9% Cast Time", addOffense: { castTimePct: -9 } },
            { rank: 5, summary: "-10% Cast Time", addOffense: { castTimePct: -10 } },
            { rank: 6, summary: "-11% Cast Time", addOffense: { castTimePct: -11 } },
        ],
    },
    startling_strain_life: {
        id: "startling_strain_life",
        name: "Startling Strain (Life · Songcraft)",
        side: "attacker",
        icon: "assets/icons/icon_skill_romance35.png",
        description: "-20% Cast Time (5s) and +30% Perform Effects received (28s)",
        addOffense: { castTimePct: -20 },
    },
    dragons_wrath: {
        id: "dragons_wrath",
        name: "Dragon's Wrath (Red Dragon Use)",
        side: "both",
        icon: "assets/icons/icon_skill_buff09.png",
        description: "Enraged Red Dragon Weapon Use: +50 STR, AGI, and INT for 10s (3m CD)",
        addAttributes: { str: 50, agi: 50, int: 50 },
    },

    // --- Attacker & Shared Debuffs ---
    shaken: {
        id: "shaken",
        name: "Shaken (Debuff)",
        side: "attacker",
        isDebuff: true,
        icon: "assets/icons/icon_skill_buff122.png",
        description: "Decreases Melee, Ranged & Magic Skill Damage (Ranks 1-8; also reduces Move & Attack Speed)",
        ranks: [
            { rank: 1, summary: "-10% Skill Dmg", addOffense: { meleeSkillDamagePct: -10, rangedSkillDamagePct: -10, magicSkillDamagePct: -10 } },
            { rank: 2, summary: "-12% Skill Dmg", addOffense: { meleeSkillDamagePct: -12, rangedSkillDamagePct: -12, magicSkillDamagePct: -12 } },
            { rank: 3, summary: "-14% Skill Dmg", addOffense: { meleeSkillDamagePct: -14, rangedSkillDamagePct: -14, magicSkillDamagePct: -14 } },
            { rank: 4, summary: "-16% Skill Dmg", addOffense: { meleeSkillDamagePct: -16, rangedSkillDamagePct: -16, magicSkillDamagePct: -16 } },
            { rank: 5, summary: "-18% Skill Dmg", addOffense: { meleeSkillDamagePct: -18, rangedSkillDamagePct: -18, magicSkillDamagePct: -18 } },
            { rank: 6, summary: "-20% Skill Dmg", addOffense: { meleeSkillDamagePct: -20, rangedSkillDamagePct: -20, magicSkillDamagePct: -20 } },
            { rank: 7, summary: "-22% Skill Dmg", addOffense: { meleeSkillDamagePct: -22, rangedSkillDamagePct: -22, magicSkillDamagePct: -22 } },
            { rank: 8, summary: "-24% Skill Dmg", addOffense: { meleeSkillDamagePct: -24, rangedSkillDamagePct: -24, magicSkillDamagePct: -24 } },
        ],
    },
    summon_crows: {
        id: "summon_crows",
        name: "Summon Crows (Occultism)",
        side: "attacker",
        isDebuff: true,
        icon: "assets/icons/icon_skill_buff46.png",
        description: "-30% Melee & Ranged Accuracy for 5s (AA Classic skill 11395)",
        addOffense: {
            meleeAccuracyPct: -30,
            rangedAccuracyPct: -30,
        },
    },
    arcadian_sea_keepers_curse: {
        id: "arcadian_sea_keepers_curse",
        name: "Arcadian Sea Keeper's Curse (Kraken Shield)",
        side: "attacker",
        isDebuff: true,
        icon: "assets/icons/icon_skill_vocation10.png",
        description: "Kraken Shield (Arcadian Sea Guardian): -30% Melee & Ranged Accuracy (also -20% Move Spd & -10% Stealth Detection; AA Classic buff 4846)",
        addOffense: {
            meleeAccuracyPct: -30,
            rangedAccuracyPct: -30,
        },
    },
    charm_lethargy: {
        id: "charm_lethargy",
        name: "Charm: Lethargy (Bloody Chantey)",
        side: "attacker",
        isDebuff: true,
        icon: "assets/icons/icon_skill_buff84.png",
        description: "Charmed Bloody Chantey: -20% Melee/Ranged/Magic Skill Damage, -10% Accuracy (AA Classic buffs 847 / 15040)",
        addOffense: {
            meleeSkillDamagePct: -20,
            rangedSkillDamagePct: -20,
            magicSkillDamagePct: -20,
            meleeAccuracyPct: -10,
            rangedAccuracyPct: -10,
            magicAccuracyPct: -10,
        },
    },

    // --- Defender Debuffs (Shreds / Vulnerability / Anti-Heal / Charm) ---
    charm_unguarded: {
        id: "charm_unguarded",
        name: "Charm: Unguarded (Bulwark Ballad)",
        side: "defender",
        isDebuff: true,
        icon: "assets/icons/icon_skill_buff73.png",
        description: "Charmed Bulwark Ballad: -50% Physical Defense & -50% Magic Defense (AA Classic buff 853)",
        mulDefense: {
            physicalDefense: 0.5,
            magicDefense: 0.5,
        },
    },
    charm_weakened_energy: {
        id: "charm_weakened_energy",
        name: "Charm: Weakened Energy (Ode)",
        side: "defender",
        isDebuff: true,
        icon: "assets/icons/icon_skill_buff79.png",
        description: "Charmed Ode to Recovery: -10% Received Healing (AA Classic buff 15039; tooltip reads -15%)",
        addDefense: {
            receivedHealingPct: -10,
        },
    },
    charm_unpleasant_sensation: {
        id: "charm_unpleasant_sensation",
        name: "Charm: Unpleasant Sensation (Quickstep)",
        side: "defender",
        isDebuff: true,
        icon: "assets/icons/icon_skill_romance30.png",
        description: "Charmed Quickstep: -10% Shield Block & -10% Evasion (AA Classic buff 15051; also -50% Move Spd)",
        addDefense: {
            blockPct: -10,
            evasionPct: -10,
        },
    },
    puncture: {
        id: "puncture",
        name: "Puncture (Battlerage)",
        side: "defender",
        isDebuff: true,
        icon: "assets/icons/icon_skill_fight24.png",
        description: "-2000 Physical Defense for 5s",
        addDefense: { physicalDefense: -2000 },
    },
    feral_aura_30: {
        id: "feral_aura_30",
        name: "Feral Aura (Archery)",
        side: "defender",
        isDebuff: true,
        icon: "assets/icons/icon_skill_buff266.png",
        maxStacks: 30,
        defaultStacks: 30,
        stackUnit: "x",
        description: "-40 Physical Defense & -0.5% Evasion/Block/Parry per stack (1-30 stacks, up to -1,200 / -15%; AA Classic buff 11219)",
        addDefense: {
            physicalDefense: -40,
            evasionPct: -0.5,
            parryPct: -0.5,
            rangedParryPct: -0.5,
            blockPct: -0.5,
        },
    },
    dissonance: {
        id: "dissonance",
        name: "Dissonance (Songcraft)",
        side: "both",
        isDebuff: true,
        icon: "assets/icons/icon_skill_buff76.png",
        description: "-20% Skill Damage, -320 Magic Defense (AA Classic buff 777)",
        addOffense: {
            meleeSkillDamagePct: -20,
            rangedSkillDamagePct: -20,
            magicSkillDamagePct: -20,
        },
        addDefense: { magicDefense: -320 },
    },
    stalkers_mark: {
        id: "stalkers_mark",
        name: "Stalker's Mark (Shadowplay)",
        side: "defender",
        isDebuff: true,
        icon: "assets/icons/icon_skill_buff57.png",
        description: "-60% Received Healing",
        addDefense: { receivedHealingPct: -60 },
    },
    enervate: {
        id: "enervate",
        name: "Enervate (Witchcraft)",
        side: "defender",
        isDebuff: true,
        icon: "assets/icons/icon_skill_buff21.png",
        description: "-60% Received Healing",
        addDefense: { receivedHealingPct: -60 },
    },
    distressed: {
        id: "distressed",
        name: "Distressed (Boastful Roar)",
        side: "both",
        isDebuff: true,
        icon: "assets/icons/icon_skill_buff123.png",
        description: "-60% Received Healing, -20% Skill Damage",
        addOffense: {
            meleeSkillDamagePct: -20,
            rangedSkillDamagePct: -20,
            magicSkillDamagePct: -20,
        },
        addDefense: { receivedHealingPct: -60 },
    },
    mirror_light_enemy: {
        id: "mirror_light_enemy",
        name: "Mirror Light - Enemy (Vitalism)",
        side: "defender",
        isDebuff: true,
        icon: "assets/icons/icon_skill_buff91.png",
        description: "+12% Received Damage, -30% Received Healing",
        addDefense: {
            receivedMeleeDrPct: -12,
            receivedRangedDrPct: -12,
            receivedMagicDrPct: -12,
            receivedHealingPct: -30,
        },
    },
    flawless_dream_ring: {
        id: "flawless_dream_ring",
        name: "Flawless Dream Ring Shred (1–5x)",
        side: "defender",
        isDebuff: true,
        icon: "assets/icons/icon_item_ring_0037.png",
        description: "Flawless Dream Ring on-hit shred: -175 Physical & Magic Defense per stack (up to 5x = -875; Dream/Ynys Ring caps at 4x = -700)",
        maxStacks: 5,
        defaultStacks: 5,
        perStackDefense: { physicalDefense: -175, magicDefense: -175 },
    },
    mirror_light_ally: {
        id: "mirror_light_ally",
        name: "Mirror Light - Ally (Vitalism)",
        side: "defender",
        icon: "assets/icons/icon_skill_buff92.png",
        description: "+15% Received Healing",
        addDefense: { receivedHealingPct: 15 },
    },
    ode_to_recovery_ally: {
        id: "ode_to_recovery_ally",
        name: "Life Ode - Ally (Songcraft)",
        side: "defender",
        icon: "assets/icons/icon_skill_buff78.png",
        description: "Increases Received Healing on allies (Life Ode Ranks 1-5; base tick values)",
        ranks: [
            { rank: 1, summary: "+11.7% Recv Heal (11.7-16.9%)", addDefense: { receivedHealingPct: 11.7 } },
            { rank: 2, summary: "+19.5% Recv Heal (19.5-29.9%)", addDefense: { receivedHealingPct: 19.5 } },
            { rank: 3, summary: "+27.3% Recv Heal (27.3-42.9%)", addDefense: { receivedHealingPct: 27.3 } },
            { rank: 4, summary: "+35.1% Recv Heal (35.1-55.9%)", addDefense: { receivedHealingPct: 35.1 } },
            { rank: 5, summary: "+42.9% Recv Heal (42.9-68.9%)", addDefense: { receivedHealingPct: 42.9 } },
        ],
    },

    // --- Defender Defensive Buffs ---
    spell_shield: {
        id: "spell_shield",
        name: "Spell Shield (Auramancy)",
        side: "defender",
        icon: "assets/icons/icon_skill_buff42.png",
        description: "Decreases Received Magic Damage and Received Healing by an equal amount for 8s (Ranks 1-5)",
        ranks: [
            { rank: 1, summary: "-16% Magic Dmg, -16% Heal", addDefense: { receivedMagicDrPct: 16, receivedHealingPct: -16 } },
            { rank: 2, summary: "-20% Magic Dmg, -20% Heal", addDefense: { receivedMagicDrPct: 20, receivedHealingPct: -20 } },
            { rank: 3, summary: "-24% Magic Dmg, -24% Heal", addDefense: { receivedMagicDrPct: 24, receivedHealingPct: -24 } },
            { rank: 4, summary: "-28% Magic Dmg, -28% Heal", addDefense: { receivedMagicDrPct: 28, receivedHealingPct: -28 } },
            { rank: 5, summary: "-32% Magic Dmg, -32% Heal", addDefense: { receivedMagicDrPct: 32, receivedHealingPct: -32 } },
        ],
    },
    magic_shield: {
        id: "magic_shield",
        name: "Magic Shield (Liberation + Spell Shield)",
        side: "defender",
        icon: "assets/icons/icon_skill_buff127.png",
        description: "Liberation + Spell Shield combo: increases Magic Defense for 20s (Ranks 1-5)",
        ranks: [
            { rank: 1, summary: "+1,240 Magic Def", addDefense: { magicDefense: 1240 } },
            { rank: 2, summary: "+1,580 Magic Def", addDefense: { magicDefense: 1580 } },
            { rank: 3, summary: "+1,960 Magic Def", addDefense: { magicDefense: 1960 } },
            { rank: 4, summary: "+2,380 Magic Def", addDefense: { magicDefense: 2380 } },
            { rank: 5, summary: "+2,840 Magic Def", addDefense: { magicDefense: 2840 } },
        ],
    },
    insulating_lens: {
        id: "insulating_lens",
        name: "Insulating Lens (Sorcery)",
        side: "defender",
        icon: "assets/icons/icon_skill_buff58.png",
        description: "Increases Physical Defense + damage absorb shield for 40s (Ranks 1-7)",
        ranks: [
            { rank: 1, summary: "+700 Phys Def", addDefense: { physicalDefense: 700 } },
            { rank: 2, summary: "+800 Phys Def", addDefense: { physicalDefense: 800 } },
            { rank: 3, summary: "+900 Phys Def", addDefense: { physicalDefense: 900 } },
            { rank: 4, summary: "+1,000 Phys Def", addDefense: { physicalDefense: 1000 } },
            { rank: 5, summary: "+1,100 Phys Def", addDefense: { physicalDefense: 1100 } },
            { rank: 6, summary: "+1,200 Phys Def", addDefense: { physicalDefense: 1200 } },
            { rank: 7, summary: "+1,300 Phys Def", addDefense: { physicalDefense: 1300 } },
        ],
    },
    purge_ally: {
        id: "purge_ally",
        name: "Purge - Ally (Witchcraft)",
        side: "defender",
        icon: "assets/icons/icon_skill_buff17.png",
        description: "+540 Magic Defense for 3m (AA Classic buff 11)",
        addDefense: {
            magicDefense: 540,
        },
    },
    redoubt: {
        id: "redoubt",
        name: "Redoubt (Defense)",
        side: "defender",
        exclusiveGroup: "redoubt",
        icon: "assets/icons/icon_skill_buff29.png",
        description: "Increases Shield Block Rate (Ranks 1-5; AA Classic buffs 328-13617)",
        ranks: [
            { rank: 1, summary: "+25% Block", addDefense: { blockPct: 25 } },
            { rank: 2, summary: "+31% Block", addDefense: { blockPct: 31 } },
            { rank: 3, summary: "+38% Block", addDefense: { blockPct: 38 } },
            { rank: 4, summary: "+46% Block", addDefense: { blockPct: 46 } },
            { rank: 5, summary: "+55% Block", addDefense: { blockPct: 55 } },
        ],
    },
    redoubt_gale: {
        id: "redoubt_gale",
        name: "Redoubt (Gale · Defense)",
        side: "defender",
        exclusiveGroup: "redoubt",
        icon: "assets/icons/icon_skill_adamant35.png",
        description: "+38% Shield Block Rate, Push/Knockback immunity, no Move Speed penalty (20s; requires Shield)",
        addDefense: { blockPct: 38 },
    },
    redoubt_life: {
        id: "redoubt_life",
        name: "Redoubt (Life · Defense)",
        side: "defender",
        exclusiveGroup: "redoubt",
        icon: "assets/icons/icon_skill_adamant36.png",
        description: "+40% Physical Defense, immune to Push/Trip (20s; works without Shield)",
        mulDefense: { physicalDefense: 1.4 },
    },
    bulwark_ballad: {
        id: "bulwark_ballad",
        name: "Bulwark Ballad (Songcraft)",
        side: "defender",
        icon: "assets/icons/icon_skill_buff72.png",
        description: "Songcraft Perform: increases Physical & Magic Defense at max ramp (Ranks 1-2)",
        ranks: [
            { rank: 1, summary: "+1,440 PDef/MDef (960-1,440)", addDefense: { physicalDefense: 1440, magicDefense: 1440 } },
            { rank: 2, summary: "+2,400 PDef/MDef (1,600-2,400)", addDefense: { physicalDefense: 2400, magicDefense: 2400 } },
        ],
    },
    sunder_earth_ally: {
        id: "sunder_earth_ally",
        name: "Earth Energy (Sunder Earth)",
        side: "defender",
        icon: "assets/icons/icon_skill_love16.png",
        description: "-30% Received Damage",
        addDefense: {
            receivedMeleeDrPct: 30,
            receivedRangedDrPct: 30,
            receivedMagicDrPct: 30,
        },
    },
    blooddrinker_blossom: {
        id: "blooddrinker_blossom",
        name: "Blooddrinker Blossom (Dungeon Shield)",
        side: "defender",
        icon: "assets/icons/icon_skill_buff56.png",
        description: "-21% Received Damage for 9s (12s Sapphire; AA Classic buffs 6148 / 9000512)",
        addDefense: {
            receivedMeleeDrPct: 21,
            receivedRangedDrPct: 21,
            receivedMagicDrPct: 21,
        },
    },
    mitigation: {
        id: "mitigation",
        name: "Mitigation (Witchcraft)",
        side: "defender",
        icon: "assets/icons/icon_skill_illusion23.png",
        description: "-30% Received Melee Damage",
        addDefense: { receivedMeleeDrPct: 30 },
    },
    loophole: {
        id: "loophole",
        name: "Loophole (Shadowplay)",
        side: "defender",
        icon: "assets/icons/icon_skill_vocation29.png",
        description: "-30% Received Ranged Damage",
        addDefense: { receivedRangedDrPct: 30 },
    },
    disciplined_performance: {
        id: "disciplined_performance",
        name: "Disciplined Perf. -30% Magic (Songcraft)",
        side: "defender",
        icon: "assets/icons/icon_skill_romance31.png",
        description: "-30% Received Magic Damage for 3s on Magic Crit (AA Classic buff 7575)",
        addDefense: { receivedMagicDrPct: 30 },
    },
    reckless_charge: {
        id: "reckless_charge",
        name: "Reckless Charge (Battlerage)",
        side: "defender",
        icon: "assets/icons/icon_skill_fight04.png",
        description: "-15% Received Melee & Ranged Damage (+40% Move Speed) for 3s after Charge, Behind Enemy Lines, or Tiger Strike",
        addDefense: { receivedMeleeDrPct: 15, receivedRangedDrPct: 15 },
    },
    supplemental_block: {
        id: "supplemental_block",
        name: "Supplemental Block (Defense)",
        side: "defender",
        icon: "assets/icons/icon_skill_adamant14.png",
        description: "+15% Shield Block Rate for 5s after blocking an attack",
        addDefense: { blockPct: 15 },
    },
    inspiration_cloak: {
        id: "inspiration_cloak",
        name: "Inspiration Cloak (Auramancy)",
        side: "defender",
        icon: "assets/icons/icon_skill_will26.png",
        description: "-100 Received Melee, Ranged, and Magic Damage (Fixed DR) for 4s after taking a hit",
        addDefense: { fixedMeleeDr: 100, fixedRangedDr: 100, fixedMagicDr: 100 },
    },
    consecutive_evasion: {
        id: "consecutive_evasion",
        name: "Consecutive Evasion (Shadowplay)",
        side: "defender",
        icon: "assets/icons/icon_skill_vocation15.png",
        description: "+18% Evasion for 7s after successfully evading an attack",
        addDefense: { evasionPct: 18 },
    },

    // =========================================================================
    // AA Classic 1.3.6 Weapon Hidden Passive Procs
    // All values verified directly against aa-classic.com/data/buffs/<id>.json
    // =========================================================================
    weapon_proc_staff: {
        id: "weapon_proc_staff",
        name: "Staff Proc (2H Staff)",
        shortEffect: "+10k M.Pen",
        side: "attacker",
        category: "weapon_proc",
        aacBuffId: 17943,
        weaponTypes: ["staff"],
        icon: "assets/icons/icon_item_staff_2h_0058.png",
        description: "2H Staff hidden passive proc: +10,000 Magic Defense Penetration on next magic attack (AA Classic buff 17943)",
        addOffense: {
            magicDefensePenetration: 10000,
        },
    },
    weapon_proc_spear: {
        id: "weapon_proc_spear",
        name: "Spear Proc (Longspear / Shortspear)",
        shortEffect: "+10k P.Pen",
        side: "attacker",
        category: "weapon_proc",
        aacBuffId: 3920,
        weaponTypes: ["longspear", "shortspear", "spear"],
        icon: "assets/icons/icon_item_spear_1h_0091.png",
        description: "Longspear & Shortspear hidden passive proc (Spear Puncture): +10,000 Physical Defense Penetration on next melee attack (AA Classic buff 3920)",
        addOffense: {
            defensePenetration: 10000,
        },
    },
    weapon_proc_katana: {
        id: "weapon_proc_katana",
        name: "Katana / Nodachi Proc (Guaranteed Crit)",
        shortEffect: "+100% M.Crit",
        side: "attacker",
        category: "weapon_proc",
        aacBuffId: 3912,
        weaponTypes: ["katana", "nodachi"],
        icon: "assets/icons/icon_item_blade_1h_0013.png",
        description: "Katana & Nodachi hidden passive proc: +100% Melee Critical Rate on next melee attack (AA Classic buff 3912)",
        addOffense: {
            meleeCritRatePct: 100,
        },
    },
    weapon_proc_dagger: {
        id: "weapon_proc_dagger",
        name: "Dagger Proc (Attack Speed)",
        shortEffect: "+17.6% Spd",
        side: "attacker",
        category: "weapon_proc",
        aacBuffId: 3904,
        weaponTypes: ["dagger"],
        icon: "assets/icons/icon_item_dagger_0094.png",
        description: "Dagger hidden passive proc (Attack Speed Boost): +176 Attack Speed (+17.6% GCD & Animation Speed) for 7s (AA Classic buff 3904)",
        addOffense: {
            attackSpeed: 176,
        },
    },
    weapon_proc_scepter: {
        id: "weapon_proc_scepter",
        name: "Scepter Proc (Cast Speed)",
        shortEffect: "-8% Cast",
        side: "attacker",
        category: "weapon_proc",
        aacBuffId: 17945,
        weaponTypes: ["scepter"],
        icon: "assets/icons/icon_item_staff_1h_0063.png",
        description: "1H Scepter hidden passive proc: -8.0% Cast Time for 7s (AA Classic buff 17945)",
        addOffense: {
            castTimePct: -8,
        },
    },
    weapon_proc_sword: {
        id: "weapon_proc_sword",
        name: "Sword / Greatsword Proc (Parry)",
        shortEffect: "+100% Parry",
        side: "defender",
        category: "weapon_proc",
        aacBuffId: 3907,
        weaponTypes: ["sword", "greatsword", "longsword", "warclub"],
        icon: "assets/icons/icon_item_sword_2h_0076.png",
        description: "Sword, Greatsword & Warclub hidden passive proc: +100% Melee Parry Rate on next hit (AA Classic buff 3907)",
        addDefense: {
            parryPct: 100,
        },
    },
    weapon_proc_shield: {
        id: "weapon_proc_shield",
        name: "Shield Proc (Block)",
        shortEffect: "+100% Block",
        side: "defender",
        category: "weapon_proc",
        aacBuffId: 4626,
        weaponTypes: ["shield"],
        icon: "assets/icons/icon_item_shield_0101.png",
        description: "Shield hidden passive proc (Block Arrow): +100% Shield Block Rate on next hit (requires Shield Equipped; AA Classic buff 4626)",
        addDefense: {
            blockPct: 100,
        },
    },
    berserkers_instinct: {
        id: "berserkers_instinct",
        name: "Berserker's Instinct (3pc Set)",
        shortEffect: "+1,000 Atk Spd",
        side: "attacker",
        category: "weapon_proc",
        aacBuffId: 9000756,
        weaponTypes: [],
        icon: "assets/icons/icon_skill_fight06.png",
        description: "Enlightened Berserker 3-Piece Set proc (AA Classic buff 9000756): Taking damage triggers +1,000 Attack Speed for 30s (3m cooldown).",
        addOffense: {
            attackSpeed: 1000,
        },
    },

    // =========================================================================
    // AA Classic 1.3.6 Costume Charm / Enlightenment 2-Set Bonuses (mutually exclusive)
    // All 7 Charms verified directly against aa-classic.com items & buffs 9001046..9001052
    // =========================================================================
    enlightenment_life: {
        id: "enlightenment_life",
        name: "Life Enlightenment (2-Set)",
        shortEffect: "+1 Rank (10 skills)",
        side: "both",
        category: "enlightenment",
        exclusiveGroup: "enlightenment_2set",
        aacBuffId: 9001051,
        charmItemId: 9001611,
        icon: "assets/icons/icon_skill_love16.png",
        description: "Life Charm + 2x Enlightened Ayanad (buff 9001051): +1 Rank to Precision Strike (+57 base, +5% CD, +2% Backstab Crit), Earthen Grip, Shield Slam, Thwart, Hell Spear, Deadeye (+20 Rng Atk), Freezing Earth, Stalker's Mark (+10/hit), Ode to Recovery & Renewal. Does not affect Ancestral variants.",
    },
    enlightenment_flame: {
        id: "enlightenment_flame",
        name: "Flame Enlightenment (2-Set)",
        shortEffect: "1% HP on Avoid",
        side: "both",
        category: "enlightenment",
        exclusiveGroup: "enlightenment_2set",
        aacBuffId: 9001050,
        charmItemId: 9001678,
        icon: "assets/icons/icon_item_1152.png",
        description: "Flame Charm + 2x Enlightened Ayanad (buff 9001050): Recover 1% of Max Health whenever you Block, Parry, or Evade an attack (Oct 10, 2026 patch).",
    },
    enlightenment_gale: {
        id: "enlightenment_gale",
        name: "Gale Enlightenment (2-Set)",
        shortEffect: "+3% Spd/Crit",
        side: "both",
        category: "enlightenment",
        exclusiveGroup: "enlightenment_2set",
        aacBuffId: 9001049,
        charmItemId: 9001676,
        maxStacks: 10,
        defaultStacks: 10,
        stackUnit: "x",
        icon: "assets/icons/icon_skill_buff70.png",
        description: "Gale Charm + 2x Enlightened Ayanad (buff 9001049): Critical strikes increase Move Speed +3%, stacking up to 10x (+30% Move Speed).",
    },
    enlightenment_wave: {
        id: "enlightenment_wave",
        name: "Wave Enlightenment (2-Set)",
        shortEffect: "+10 Mana Regen",
        side: "both",
        category: "enlightenment",
        exclusiveGroup: "enlightenment_2set",
        aacBuffId: 9001046,
        charmItemId: 9001644,
        icon: "assets/icons/icon_skill_buff42.png",
        description: "Wave Charm + 2x Enlightened Ayanad (buff 9001046): Increases Post-Cast Mana Regeneration +10.",
    },
    enlightenment_meadow: {
        id: "enlightenment_meadow",
        name: "Meadow Enlightenment (2-Set)",
        shortEffect: "No Abyssal Decay",
        side: "both",
        category: "enlightenment",
        exclusiveGroup: "enlightenment_2set",
        aacBuffId: 9001047,
        charmItemId: 9001665,
        icon: "assets/icons/icon_skill_buff116.png",
        description: "Meadow Charm + 2x Enlightened Ayanad (buff 9001047): Abyssal charges no longer decay over time.",
    },
    enlightenment_earth: {
        id: "enlightenment_earth",
        name: "Earth Enlightenment (2-Set)",
        shortEffect: "+1 Max Abyssal",
        side: "both",
        category: "enlightenment",
        exclusiveGroup: "enlightenment_2set",
        aacBuffId: 9001052,
        charmItemId: 9001674,
        icon: "assets/icons/icon_skill_buff32.png",
        description: "Earth Charm + 2x Enlightened Ayanad (buff 9001052): Increases Maximum Abyssal Charges +1 (item tooltip; 1.3.6 notes list +2).",
    },
    enlightenment_lightning: {
        id: "enlightenment_lightning",
        name: "Lightning Enlightenment (2-Set)",
        shortEffect: "+50% Glide Spd",
        side: "both",
        category: "enlightenment",
        exclusiveGroup: "enlightenment_2set",
        aacBuffId: 9001048,
        charmItemId: 9001684,
        icon: "assets/icons/icon_skill_buff58.png",
        description: "Lightning Charm + 2x Enlightened Ayanad (buff 9001048): Increases gliding speed +50% and glider recovery +4 seconds.",
    },

    // =========================================================================
    // AA Classic 1.3.6 Food, Potions, Spellbooks & Combat Consumables
    // All values verified directly against aa-classic.com/data/buffs/<id>.json
    // =========================================================================

    // --- Rank 3 Alchemy Potions (1 active at a time) ---
    kingdoms_shadow: {
        id: "kingdoms_shadow",
        name: "Kingdom's Shadow",
        optionLabel: "Kingdom's Shadow (+810 Phys & Magic Def)",
        shortStats: "+810 PDef & MDef",
        side: "both",
        category: "consumable",
        slot: "potion_r3",
        icon: "assets/icons/icon_item_3558.png",
        description: "+810 Physical & Magic Defense (buff 20588, 30m)",
        addDefense: { physicalDefense: 810, magicDefense: 810 },
    },
    kingdoms_heart: {
        id: "kingdoms_heart",
        name: "Kingdom's Heart",
        optionLabel: "Kingdom's Heart (+1,800 Phys Def)",
        shortStats: "+1,800 PDef",
        side: "both",
        category: "consumable",
        slot: "potion_r3",
        icon: "assets/icons/icon_item_0550.png",
        description: "+1,800 Physical Defense (buff 674, 30m)",
        addDefense: { physicalDefense: 1800 },
    },
    ancient_library_relic: {
        id: "ancient_library_relic",
        name: "Ancient Library Relic",
        optionLabel: "Ancient Library Relic (+1,800 Magic Def)",
        shortStats: "+1,800 MDef",
        side: "both",
        category: "consumable",
        slot: "potion_r3",
        icon: "assets/icons/icon_item_0546.png",
        description: "+1,800 Magic Defense (buff 2354, 30m)",
        addDefense: { magicDefense: 1800 },
    },

    // --- Pigglewiggle Food (stacks with Jujube!) ---
    pigglewiggle_bacon: {
        id: "pigglewiggle_bacon",
        name: "Golden Bacon",
        optionLabel: "Golden Bacon (+60 STR, +1300 HP, PvE)",
        shortStats: "+60 STR, +1300 HP, +6% PvE Dmg, -4% PvE DR",
        side: "both",
        category: "consumable",
        slot: "food",
        icon: "assets/icons/icon_item_0449.png",
        description: "Assorted Pigglewiggle: +60 STR (+12 Melee Atk), +1,300 Max HP, +6% PvE Skill Dmg, -4% PvE Recv Dmg (buff 9000140)",
        addMaxHealth: 1300,
        addAttributes: { str: 60 },
        pveDamageBonusPct: 6,
        pveReceivedDrPct: 4,
    },
    pigglewiggle_ham: {
        id: "pigglewiggle_ham",
        name: "Royal Ham",
        optionLabel: "Royal Ham (+60 AGI, +1300 HP, PvE)",
        shortStats: "+60 AGI, +1300 HP, +6% PvE Dmg, -4% PvE DR",
        side: "both",
        category: "consumable",
        slot: "food",
        icon: "assets/icons/icon_item_0446.png",
        description: "Assorted Pigglewiggle: +60 AGI (+12 Rng Atk, +1.7% Crit), +1,300 Max HP, +6% PvE Skill Dmg, -4% PvE Recv Dmg (buff 9000141)",
        addMaxHealth: 1300,
        addAttributes: { agi: 60 },
        pveDamageBonusPct: 6,
        pveReceivedDrPct: 4,
    },
    pigglewiggle_delight: {
        id: "pigglewiggle_delight",
        name: "Porcine Delight",
        optionLabel: "Porcine Delight (+60 SPI / Heal Pwr, +1300 HP)",
        shortStats: "+60 SPI (+12 HPwr, +60 MDef), +1300 HP, PvE",
        side: "both",
        category: "consumable",
        slot: "food",
        icon: "assets/icons/icon_item_0447.png",
        description: "Assorted Pigglewiggle: +60 SPI (+12 Healing Power, +60 MDef, +1.7% Heal Crit), +1,300 Max HP, +6% PvE Dmg, -4% PvE DR (buff 9000142)",
        addMaxHealth: 1300,
        addAttributes: { spi: 60 },
        pveDamageBonusPct: 6,
        pveReceivedDrPct: 4,
    },
    pigglewiggle_sausage: {
        id: "pigglewiggle_sausage",
        name: "Imperial Sausage",
        optionLabel: "Imperial Sausage (+60 INT / Magic, +1300 HP)",
        shortStats: "+60 INT (+12 Magic Atk), +1300 HP, PvE",
        side: "both",
        category: "consumable",
        slot: "food",
        icon: "assets/icons/icon_item_0448.png",
        description: "Assorted Pigglewiggle: +60 INT (+12 Magic Atk, +1.7% Magic Crit), +1,300 Max HP, +6% PvE Dmg, -4% PvE DR (buff 9000143)",
        addMaxHealth: 1300,
        addAttributes: { int: 60 },
        pveDamageBonusPct: 6,
        pveReceivedDrPct: 4,
    },
    pigglewiggle_grand_feast: {
        id: "pigglewiggle_grand_feast",
        name: "Pigglewiggle's Grand Feast",
        optionLabel: "Grand Feast (+70 STR & AGI, +1300 HP, PvE)",
        shortStats: "+70 STR & AGI, +1300 HP, +6% PvE Dmg, -4% PvE DR",
        side: "both",
        category: "consumable",
        slot: "food",
        icon: "assets/icons/aac/buff_icon_pigfeast.png",
        description: "+70 STR & AGI, +1,300 Max HP, +6% PvE Skill Dmg, -4% PvE Recv Dmg (buff 9000050)",
        addMaxHealth: 1300,
        addAttributes: { str: 70, agi: 70 },
        pveDamageBonusPct: 6,
        pveReceivedDrPct: 4,
    },
    pigglewiggle_stew: {
        id: "pigglewiggle_stew",
        name: "Pigglewiggle's Stew",
        optionLabel: "Stew (+70 INT & SPI, +1300 HP, PvE)",
        shortStats: "+70 INT & SPI, +1300 HP, +6% PvE Dmg, -4% PvE DR",
        side: "both",
        category: "consumable",
        slot: "food",
        icon: "assets/icons/aac/buff_icon_pigstew.png",
        description: "+70 INT & SPI, +1,300 Max HP, +6% PvE Skill Dmg, -4% PvE Recv Dmg (buff 9000051)",
        addMaxHealth: 1300,
        addAttributes: { int: 70, spi: 70 },
        pveDamageBonusPct: 6,
        pveReceivedDrPct: 4,
    },

    // --- Jujube Drinks (separate category — stacks with Pigglewiggle!) ---
    jujube_juice: {
        id: "jujube_juice",
        name: "Jujube Juice",
        optionLabel: "Jujube Juice (+1,300 HP, -4% PvE DR)",
        shortStats: "+1,300 HP, -4% PvE DR",
        side: "both",
        category: "consumable",
        slot: "jujube",
        icon: "assets/icons/icon_item_2880.png",
        description: "+1,300 Max HP, -4% PvE Received Damage (buff 16859, 30m)",
        addMaxHealth: 1300,
        pveReceivedDrPct: 4,
    },
    jujube_sparkling_wine: {
        id: "jujube_sparkling_wine",
        name: "Jujube Sparkling Wine",
        optionLabel: "Jujube Sparkling Wine (+6% PvE Dmg, +1,300 MP)",
        shortStats: "+6% PvE Dmg",
        side: "both",
        category: "consumable",
        slot: "jujube",
        icon: "assets/icons/icon_item_2881.png",
        description: "+6% PvE Skill Damage, +1,300 Max Mana (buff 16860, 30m)",
        pveDamageBonusPct: 6,
    },
    jujube_both: {
        id: "jujube_both",
        name: "Jujube Juice + Sparkling Wine",
        optionLabel: "Juice + Wine (+1,300 HP, +6% PvE Dmg, -4% PvE DR)",
        shortStats: "+1,300 HP, +6% PvE Dmg, -4% PvE DR",
        side: "both",
        category: "consumable",
        slot: "jujube",
        icon: "assets/icons/icon_item_2880.png",
        description: "Both Jujube drinks combined: +1,300 Max HP, +6% PvE Skill Damage, -4% PvE Received Damage",
        addMaxHealth: 1300,
        pveDamageBonusPct: 6,
        pveReceivedDrPct: 4,
    },

    // --- Vaughn's Brews ---
    vaughns_potent_stout: {
        id: "vaughns_potent_stout",
        name: "Vaughn's Potent Stout",
        optionLabel: "Potent Stout (+10% Skill Dmg, +5% Evasion)",
        shortStats: "+10% Skill Dmg, +5% Evasion",
        side: "both",
        category: "consumable",
        slot: "vaughn",
        icon: "assets/icons/icon_item_0196.png",
        description: "+10% Skill Damage (Melee/Ranged/Magic), +5% Evasion (buff 8000056; Hangover -100 Focus curable)",
        addOffense: {
            meleeSkillDamagePct: 10,
            rangedSkillDamagePct: 10,
            magicSkillDamagePct: 10,
        },
        addDefense: { evasionPct: 5 },
    },
    vaughns_soothing_tonic: {
        id: "vaughns_soothing_tonic",
        name: "Vaughn's Soothing Tonic",
        optionLabel: "Soothing Tonic (+10% Healing, +5% Evasion)",
        shortStats: "+10% Healing, +5% Evasion",
        side: "both",
        category: "consumable",
        slot: "vaughn",
        icon: "assets/icons/icon_item_0196.png",
        description: "+10% Healing, +5% Evasion (buff 8000057; Hangover -100 Focus curable)",
        addOffense: { healingPct: 10 },
        addDefense: { evasionPct: 5 },
    },

    // --- Spellbook: Bulwark (5 variants — +48 Fixed DR, +3% Skill Dmg + specialty) ---
    bulwark_resilience: {
        id: "bulwark_resilience",
        name: "Bulwark of Resilience",
        optionLabel: "Bulwark: Resilience (+1200 Resil, +48 Fixed DR, +3% Dmg)",
        shortStats: "+1200 Resil, +48 Fixed DR, +3% Dmg",
        side: "both",
        category: "consumable",
        slot: "spellbook",
        icon: "assets/icons/aac/icon_item_bulwark.png",
        description: "+1,200 Resilience, +48 Fixed DR (all), +3% Skill Dmg (buff 9000052)",
        addOffense: { meleeSkillDamagePct: 3, rangedSkillDamagePct: 3, magicSkillDamagePct: 3 },
        addDefense: { resilience: 1200, fixedMeleeDr: 48, fixedRangedDr: 48, fixedMagicDr: 48 },
    },
    bulwark_focus: {
        id: "bulwark_focus",
        name: "Bulwark of Focus",
        optionLabel: "Bulwark: Focus (+1400 Focus, +48 Fixed DR, +3% Dmg)",
        shortStats: "+1400 Focus, +48 Fixed DR, +3% Dmg",
        side: "both",
        category: "consumable",
        slot: "spellbook",
        icon: "assets/icons/aac/icon_item_bulwark.png",
        description: "+1,400 Focus, +48 Fixed DR (all), +3% Skill Dmg (buff 9000053)",
        addOffense: { focus: 1400, meleeSkillDamagePct: 3, rangedSkillDamagePct: 3, magicSkillDamagePct: 3 },
        addDefense: { fixedMeleeDr: 48, fixedRangedDr: 48, fixedMagicDr: 48 },
    },
    bulwark_toughness: {
        id: "bulwark_toughness",
        name: "Bulwark of Toughness",
        optionLabel: "Bulwark: Toughness (+1255 Tough, +48 Fixed DR, +3% Dmg)",
        shortStats: "+1255 Tough, +48 Fixed DR, +3% Dmg",
        side: "both",
        category: "consumable",
        slot: "spellbook",
        icon: "assets/icons/aac/icon_item_bulwark.png",
        description: "+1,255 Toughness, +48 Fixed DR (all), +3% Skill Dmg (buff 9000054)",
        addOffense: { meleeSkillDamagePct: 3, rangedSkillDamagePct: 3, magicSkillDamagePct: 3 },
        addDefense: { toughness: 1255, fixedMeleeDr: 48, fixedRangedDr: 48, fixedMagicDr: 48 },
    },
    bulwark_power: {
        id: "bulwark_power",
        name: "Bulwark of Power",
        optionLabel: "Bulwark: Power (+15% Melee/Rng Atk, +48 Fixed DR, +3% Dmg)",
        shortStats: "+15% Melee/Rng Atk, +48 Fixed DR, +3% Dmg",
        side: "both",
        category: "consumable",
        slot: "spellbook",
        icon: "assets/icons/aac/icon_item_bulwark.png",
        description: "+15% Melee & Ranged Attack, +48 Fixed DR (all), +3% Skill Dmg (buff 9000055)",
        addOffense: { meleeSkillDamagePct: 3, rangedSkillDamagePct: 3, magicSkillDamagePct: 3 },
        mulOffense: { meleeAttack: 1.15, rangedAttack: 1.15 },
        addDefense: { fixedMeleeDr: 48, fixedRangedDr: 48, fixedMagicDr: 48 },
    },
    bulwark_wisdom: {
        id: "bulwark_wisdom",
        name: "Bulwark of Wisdom",
        optionLabel: "Bulwark: Wisdom (+15% Magic/Heal Pwr, +48 Fixed DR, +3% Dmg)",
        shortStats: "+15% Magic/Heal Pwr, +48 Fixed DR, +3% Dmg",
        side: "both",
        category: "consumable",
        slot: "spellbook",
        icon: "assets/icons/aac/icon_item_bulwark.png",
        description: "+15% Magic Attack & Healing Power, +48 Fixed DR (all), +3% Skill Dmg (buff 9000056)",
        addOffense: { meleeSkillDamagePct: 3, rangedSkillDamagePct: 3, magicSkillDamagePct: 3 },
        mulOffense: { magicAttack: 1.15, healingPower: 1.15 },
        addDefense: { fixedMeleeDr: 48, fixedRangedDr: 48, fixedMagicDr: 48 },
    },

    // --- Spellbook: Authority (5 variants — +69 Atk, +3% Skill Dmg + specialty) ---
    authority_resilience: {
        id: "authority_resilience",
        name: "Authority of Resilience",
        optionLabel: "Authority: Resilience (+1200 Resil, +69 Atk, +3% Dmg)",
        shortStats: "+1200 Resil, +69 Atk, +3% Dmg",
        side: "both",
        category: "consumable",
        slot: "spellbook",
        icon: "assets/icons/aac/icon_item_authority.png",
        description: "+1,200 Resilience, +69 Melee/Ranged/Magic Atk, +3% Skill Dmg (buff 9000057)",
        addOffense: {
            meleeAttack: 69,
            rangedAttack: 69,
            magicAttack: 69,
            meleeSkillDamagePct: 3,
            rangedSkillDamagePct: 3,
            magicSkillDamagePct: 3,
        },
        addDefense: { resilience: 1200 },
    },
    authority_focus: {
        id: "authority_focus",
        name: "Authority of Focus",
        optionLabel: "Authority: Focus (+1400 Focus, +69 Atk, +3% Dmg)",
        shortStats: "+1400 Focus, +69 Atk, +3% Dmg",
        side: "both",
        category: "consumable",
        slot: "spellbook",
        icon: "assets/icons/aac/icon_item_authority.png",
        description: "+1,400 Focus, +69 Melee/Ranged/Magic Atk, +3% Skill Dmg (buff 9000058)",
        addOffense: {
            focus: 1400,
            meleeAttack: 69,
            rangedAttack: 69,
            magicAttack: 69,
            meleeSkillDamagePct: 3,
            rangedSkillDamagePct: 3,
            magicSkillDamagePct: 3,
        },
    },
    authority_toughness: {
        id: "authority_toughness",
        name: "Authority of Toughness",
        optionLabel: "Authority: Toughness (+1255 Tough, +69 Atk, +3% Dmg)",
        shortStats: "+1255 Tough, +69 Atk, +3% Dmg",
        side: "both",
        category: "consumable",
        slot: "spellbook",
        icon: "assets/icons/aac/icon_item_authority.png",
        description: "+1,255 Toughness, +69 Melee/Ranged/Magic Atk, +3% Skill Dmg (buff 9000059)",
        addOffense: {
            meleeAttack: 69,
            rangedAttack: 69,
            magicAttack: 69,
            meleeSkillDamagePct: 3,
            rangedSkillDamagePct: 3,
            magicSkillDamagePct: 3,
        },
        addDefense: { toughness: 1255 },
    },
    authority_power: {
        id: "authority_power",
        name: "Authority of Power",
        optionLabel: "Authority: Power (+15% Melee/Rng Atk, +69 Atk, +3% Dmg)",
        shortStats: "+15% Melee/Rng Atk, +69 Atk, +3% Dmg",
        side: "both",
        category: "consumable",
        slot: "spellbook",
        icon: "assets/icons/aac/icon_item_authority.png",
        description: "+15% Melee & Ranged Attack, +69 Melee/Ranged/Magic Atk, +3% Skill Dmg (buff 9000060)",
        addOffense: {
            meleeAttack: 69,
            rangedAttack: 69,
            magicAttack: 69,
            meleeSkillDamagePct: 3,
            rangedSkillDamagePct: 3,
            magicSkillDamagePct: 3,
        },
        mulOffense: { meleeAttack: 1.15, rangedAttack: 1.15 },
    },
    authority_wisdom: {
        id: "authority_wisdom",
        name: "Authority of Wisdom",
        optionLabel: "Authority: Wisdom (+15% Magic/Heal Pwr, +69 Atk, +3% Dmg)",
        shortStats: "+15% Magic/Heal Pwr, +69 Atk, +3% Dmg",
        side: "both",
        category: "consumable",
        slot: "spellbook",
        icon: "assets/icons/aac/icon_item_authority.png",
        description: "+15% Magic Attack & Healing Power, +69 Melee/Ranged/Magic Atk, +3% Skill Dmg (buff 9000061)",
        addOffense: {
            meleeAttack: 69,
            rangedAttack: 69,
            magicAttack: 69,
            meleeSkillDamagePct: 3,
            rangedSkillDamagePct: 3,
            magicSkillDamagePct: 3,
        },
        mulOffense: { magicAttack: 1.15, healingPower: 1.15 },
    },
    spellbook_brick_wall: {
        id: "spellbook_brick_wall",
        name: "Spellbook: Brick Wall",
        optionLabel: "Brick Wall (-15% Received Dmg)",
        shortStats: "-15% Received Dmg",
        side: "both",
        category: "consumable",
        slot: "spellbook",
        icon: "assets/icons/aac/icon_item_bulwark.png",
        description: "Spellbook: Brick Wall: -15% Received Melee, Ranged, and Magic Damage (30m)",
        addDefense: {
            receivedMeleeDrPct: 15,
            receivedRangedDrPct: 15,
            receivedMagicDrPct: 15,
        },
    },

    // --- Combat Manual (1 active at a time) ---
    combat_manual_flame: {
        id: "combat_manual_flame",
        name: "Combat Manual: Flame",
        optionLabel: "Flame (+4% Skill Dmg & Healing)",
        shortStats: "+4% Skill Dmg & Healing",
        side: "both",
        category: "consumable",
        slot: "manual",
        icon: "assets/icons/icon_item_1152.png",
        description: "+4% Skill Damage (all), +4% Healing (buff 19939, 30m)",
        addOffense: {
            meleeSkillDamagePct: 4,
            rangedSkillDamagePct: 4,
            magicSkillDamagePct: 4,
            healingPct: 4,
        },
    },
    combat_manual_temper: {
        id: "combat_manual_temper",
        name: "Combat Manual: Temper",
        optionLabel: "Temper (-5% Received Dmg)",
        shortStats: "-5% Received Dmg",
        side: "both",
        category: "consumable",
        slot: "manual",
        icon: "assets/icons/icon_item_1153.png",
        description: "-5% Received Damage (all types) (buff 19940, 30m)",
        addDefense: {
            receivedMeleeDrPct: 5,
            receivedRangedDrPct: 5,
            receivedMagicDrPct: 5,
        },
    },
    combat_manual_awaken: {
        id: "combat_manual_awaken",
        name: "Combat Manual: Awaken",
        optionLabel: "Awaken (+50 All Stats)",
        shortStats: "+50 All Stats",
        side: "both",
        category: "consumable",
        slot: "manual",
        icon: "assets/icons/icon_item_1154.png",
        description: "+50 All Stats (STR, AGI, STA, INT, SPI) (buff 19938, 30m)",
        addAttributes: { str: 50, agi: 50, sta: 50, int: 50, spi: 50 },
    },

    // --- Judge's Longing (1 active at a time) ---
    judges_deadly_concentration: {
        id: "judges_deadly_concentration",
        name: "Deadly Concentration",
        optionLabel: "Deadly Concentration (+600 Focus)",
        shortStats: "+600 Focus",
        side: "both",
        category: "consumable",
        slot: "talisman",
        icon: "assets/icons/icon_skill_doping02.png",
        description: "Judge's Longing: +600 Focus (buff 20553, 30m)",
        addOffense: { focus: 600 },
    },
    judges_mercurial_movement: {
        id: "judges_mercurial_movement",
        name: "Mercurial Movement",
        optionLabel: "Mercurial Movement (+600 Resilience)",
        shortStats: "+600 Resilience",
        side: "both",
        category: "consumable",
        slot: "talisman",
        icon: "assets/icons/icon_skill_doping01.png",
        description: "Judge's Longing: +600 Resilience (buff 20552, 30m)",
        addDefense: { resilience: 600 },
    },
};

export const BUILTIN_MODIFIER_IDS = new Set(Object.keys(COMBAT_MODIFIERS));

const CUSTOM_MODIFIER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Register custom/imported buff definitions (loaded from `buffs/*.json` or `/api/buffs`)
 * directly into COMBAT_MODIFIERS without overwriting built-in entries.
 */
export function registerCustomModifiers(modList = []) {
    const registered = [];
    for (const raw of modList || []) {
        if (!raw || typeof raw !== "object" || !raw.id) continue;
        const id = String(raw.id).trim();
        if (
            !id ||
            !CUSTOM_MODIFIER_ID_RE.test(id) ||
            FORBIDDEN_OBJECT_KEYS.has(id.toLowerCase()) ||
            BUILTIN_MODIFIER_IDS.has(id)
        ) {
            continue;
        }
        const safeIcon = (() => {
            if (!raw.icon || typeof raw.icon !== "string") return undefined;
            const s = raw.icon.replace(/\\/g, "/").trim();
            if (!s || s.includes("..")) return undefined;
            if (s.startsWith("assets/")) return s;
            if (/^https:\/\//i.test(s)) {
                try {
                    const u = new URL(s);
                    const h = u.hostname.toLowerCase();
                    if (h === "darugear.com" || h === "www.darugear.com" || h === "aa-classic.com" || h === "www.aa-classic.com") {
                        return u.href;
                    }
                } catch {
                    return undefined;
                }
            }
            return undefined;
        })();
        COMBAT_MODIFIERS[id] = {
            ...raw,
            id,
            ...(safeIcon ? { icon: safeIcon } : { icon: undefined }),
            isCustom: true,
        };
        registered.push(COMBAT_MODIFIERS[id]);
    }
    return registered;
}

/**
 * Remove a custom/imported modifier from COMBAT_MODIFIERS (built-ins cannot be removed).
 */
export function unregisterCustomModifier(id) {
    if (!id || FORBIDDEN_OBJECT_KEYS.has(String(id).toLowerCase()) || BUILTIN_MODIFIER_IDS.has(id)) return false;
    if (!Object.prototype.hasOwnProperty.call(COMBAT_MODIFIERS, id)) return false;
    delete COMBAT_MODIFIERS[id];
    return true;
}

export const CONSUMABLE_SLOTS = Object.freeze([
    { id: "food", label: "Pigglewiggle (Food)", icon: "assets/icons/aac/buff_icon_pigfeast.png" },
    { id: "jujube", label: "Jujube (Drink)", icon: "assets/icons/icon_item_2880.png" },
    { id: "spellbook", label: "Spellbook", icon: "assets/icons/aac/icon_item_bulwark.png" },
    { id: "potion_r3", label: "Potion (R3)", icon: "assets/icons/icon_item_3558.png" },
    { id: "vaughn", label: "Vaughn's Brew", icon: "assets/icons/icon_item_0196.png" },
    { id: "manual", label: "Combat Manual", icon: "assets/icons/icon_item_1152.png" },
    { id: "talisman", label: "Judge's Longing", icon: "assets/icons/icon_item_3595.png" },
]);

/**
 * Parse a modifier token (`"zeal"`, `"rhythm_stacks:12"`, or `"battle_focus:2"`)
 * into `{ id, stacks, rank, rankEntry, mod, effective }`.
 */
export function parseModifierToken(token) {
    if (token && typeof token === "object") {
        return { id: token.id || "__inline__", stacks: 1, rank: null, rankEntry: null, mod: token, effective: token };
    }
    const raw = String(token || "");
    const colonIdx = raw.indexOf(":");
    const id = colonIdx >= 0 ? raw.slice(0, colonIdx) : raw;
    const mod = Object.prototype.hasOwnProperty.call(COMBAT_MODIFIERS, id) ? COMBAT_MODIFIERS[id] : null;
    if (!mod) return { id, stacks: 1, rank: null, rankEntry: null, mod: null, effective: null };

    const paramVal = colonIdx >= 0 ? parseInt(raw.slice(colonIdx + 1), 10) : NaN;

    if (Array.isArray(mod.ranks) && mod.ranks.length > 0) {
        const defaultRank = mod.defaultRank ?? mod.ranks[mod.ranks.length - 1].rank;
        const targetRank = Number.isFinite(paramVal) ? paramVal : defaultRank;
        const rankEntry =
            mod.ranks.find((r) => r.rank === targetRank) || mod.ranks[mod.ranks.length - 1];
        return {
            id,
            stacks: 1,
            rank: rankEntry.rank,
            rankEntry,
            mod,
            effective: { ...mod, ...rankEntry },
        };
    }

    if (mod.maxStacks && mod.maxStacks > 1) {
        const fallback = mod.defaultStacks || mod.maxStacks;
        const stacks = Number.isFinite(paramVal) ? clamp(paramVal, 1, mod.maxStacks) : fallback;
        return { id, stacks, rank: null, rankEntry: null, mod, effective: mod };
    }

    return { id, stacks: 1, rank: null, rankEntry: null, mod, effective: mod };
}

/**
 * Resolve a list of modifier tokens while enforcing `exclusiveGroup`
 * (e.g. Health Lift vs Refreshment — if both appear, only the last one applies).
 */
function resolveExclusiveModifierTokens(modifierIds = []) {
    const parsedList = [];
    const lastIdxByGroup = new Map();
    for (const token of modifierIds || []) {
        const parsed = parseModifierToken(token);
        if (!parsed.effective) continue;
        const idx = parsedList.length;
        parsedList.push(parsed);
        const grp = parsed.mod?.exclusiveGroup || parsed.effective?.exclusiveGroup;
        if (grp) lastIdxByGroup.set(grp, idx);
    }
    return parsedList.filter((p, idx) => {
        const grp = p.mod?.exclusiveGroup || p.effective?.exclusiveGroup;
        return !grp || lastIdxByGroup.get(grp) === idx;
    });
}

/**
 * Exact DaruGear / AA Classic 1.3.6 primary attribute -> derived stat conversion delta.
 * Applies `sign = +1` (applyModifiers) or `sign = -1` (unapplyModifiers) symmetrically.
 *
 * Formulas verified 1:1 against darugear.com/main-AWKUQU5L.js & live unitInfo:
 *  - STR: +0.2 Melee Atk, +0.01225% Melee Acc, +0.00625% Parry (if armed), +0.0165% Block (if shield)
 *  - AGI: +0.2 Ranged Atk, +0.01225% Ranged Acc, +0.0275% Melee Crit, +0.01375% Ranged Crit, +0.0109% Evasion
 *  - STA: +12 Max HP, +0.006% Parry (if armed)
 *  - INT: +0.2 Magic Atk, +12 Max Mana, +0.01225% Magic Acc, +0.0275% Magic Crit, +0.01375% Ranged Crit, +0.0109% Evasion
 *  - SPI: +0.2 Healing Power, +1.0 Magic Def, +0.0275% Heal Crit, +0.01225% Melee/Ranged/Magic Acc
 */
export function applyAttributeDelta(out, attrDelta = {}, sign = 1, roundFn = (x) => x) {
    if (!attrDelta || typeof attrDelta !== "object") return;
    const dStr = (Number(attrDelta.str) || 0) * sign;
    const dAgi = (Number(attrDelta.agi) || 0) * sign;
    const dSta = (Number(attrDelta.sta) || 0) * sign;
    const dInt = (Number(attrDelta.int) || 0) * sign;
    const dSpi = (Number(attrDelta.spi) || 0) * sign;

    const oldStr = Number(out.attributes?.str) || 0;
    const oldAgi = Number(out.attributes?.agi) || 0;
    const oldSta = Number(out.attributes?.sta) || 0;
    const oldInt = Number(out.attributes?.int) || 0;
    const oldSpi = Number(out.attributes?.spi) || 0;

    const newStr = oldStr + dStr;
    const newAgi = oldAgi + dAgi;
    const newSta = oldSta + dSta;
    const newInt = oldInt + dInt;
    const newSpi = oldSpi + dSpi;

    const hasMainhand =
        Number(out.defense?.parryPct) > 0 ||
        (Array.isArray(out.equipment) && out.equipment.some((it) => Number(it?.slotId) === 15)) ||
        Number(out.offense?.meleeAttack) > 50 ||
        Number(out.offense?.magicAttack) > 50 ||
        Number(out.offense?.healingPower) > 50;
    const hasShield = Boolean(
        out.defense?.hasShield ||
            Number(out.defense?.shieldPhysicalDefense) > 0 ||
            Number(out.defense?.blockPct) > 0
    );

    // Apply Accuracy deltas respecting AA Classic's 100% hard cap so unbaking never dips a 100%-capped build below 100%
    const applyAccDelta = (offKey, oldPrimary, oldSpirit, newPrimary, newSpirit) => {
        const oldAttrAcc = Math.min(100, 90.8 + 0.01225 * (oldPrimary + oldSpirit));
        const newAttrAcc = Math.min(100, 90.8 + 0.01225 * (newPrimary + newSpirit));
        const accDelta = newAttrAcc - oldAttrAcc;
        if (Math.abs(accDelta) > 1e-9) {
            out.offense[offKey] = roundFn(clamp((Number(out.offense[offKey] ?? 100)) + accDelta, 0, 100));
        }
    };

    if (dStr) {
        out.attributes.str = roundFn(newStr);
        out.offense.meleeAttack = roundFn((Number(out.offense.meleeAttack) || 0) + dStr * 0.2);
        if (hasMainhand) {
            out.defense.parryPct = roundFn((Number(out.defense.parryPct) || 0) + dStr * 0.00625);
        }
        if (hasShield) {
            out.defense.blockPct = roundFn((Number(out.defense.blockPct) || 0) + dStr * 0.0165);
        }
    }
    if (dAgi) {
        out.attributes.agi = roundFn(newAgi);
        out.offense.rangedAttack = roundFn((Number(out.offense.rangedAttack) || 0) + dAgi * 0.2);
        out.offense.meleeCritRatePct = roundFn((Number(out.offense.meleeCritRatePct) || 0) + dAgi * 0.0275);
        out.offense.rangedCritRatePct = roundFn((Number(out.offense.rangedCritRatePct) || 0) + dAgi * 0.01375);
        out.defense.evasionPct = roundFn((Number(out.defense.evasionPct) || 0) + dAgi * 0.0109);
    }
    if (dSta) {
        out.attributes.sta = roundFn(newSta);
        out.maxHealth = roundFn((Number(out.maxHealth) || 0) + dSta * 12);
        if (hasMainhand) {
            out.defense.parryPct = roundFn((Number(out.defense.parryPct) || 0) + dSta * 0.006);
        }
    }
    if (dInt) {
        out.attributes.int = roundFn(newInt);
        out.maxMana = roundFn((Number(out.maxMana) || 0) + dInt * 12);
        out.offense.magicAttack = roundFn((Number(out.offense.magicAttack) || 0) + dInt * 0.2);
        out.offense.magicCritRatePct = roundFn((Number(out.offense.magicCritRatePct) || 0) + dInt * 0.0275);
        out.offense.rangedCritRatePct = roundFn((Number(out.offense.rangedCritRatePct) || 0) + dInt * 0.01375);
        out.defense.evasionPct = roundFn((Number(out.defense.evasionPct) || 0) + dInt * 0.0109);
    }
    if (dSpi) {
        out.attributes.spi = roundFn(newSpi);
        out.offense.healingPower = roundFn((Number(out.offense.healingPower) || 0) + dSpi * 0.2);
        out.offense.healCritRatePct = roundFn((Number(out.offense.healCritRatePct) || 0) + dSpi * 0.0275);
        out.defense.magicDefense = roundFn((Number(out.defense.magicDefense) || 0) + dSpi * 1.0);
    }

    if (dStr || dSpi) applyAccDelta("meleeAccuracyPct", oldStr, oldSpi, newStr, newSpi);
    if (dAgi || dSpi) applyAccDelta("rangedAccuracyPct", oldAgi, oldSpi, newAgi, newSpi);
    if (dInt || dSpi) applyAccDelta("magicAccuracyPct", oldInt, oldSpi, newInt, newSpi);
}

let _skillBuildApplier = null;

export function registerSkillBuildApplier(fn) {
    _skillBuildApplier = typeof fn === "function" ? fn : null;
}

/**
 * Applies a list of modifier IDs (from COMBAT_MODIFIERS, optionally `"id:stacks"` or `"id:rank"`)
 * to a character, returning a new character object plus skillset & PvE bonuses.
 */
export function applyModifiers(character, modifierIds = []) {
    const baseChar =
        _skillBuildApplier && character?.skillBuild && !character?._skillBuildApplied
            ? _skillBuildApplier(character, modifierIds).character
            : character;
    const out = applyOverrides(baseChar, {});
    const skillsetBonuses = { ...(baseChar.skillsetDamageBonusPct || {}) };
    const skillsetCdr = { ...(baseChar.skillsetCooldownReductionPct || {}) };
    const skillCdr = { ...(baseChar.skillCooldownReductionPct || {}) };
    const skillCastDelta = { ...(baseChar.skillCastTimeDeltaSec || {}) };
    let pveDamageBonusPct = Number(baseChar.pveDamageBonusPct) || 0;
    let pveReceivedDrPct = Number(baseChar.pveReceivedDrPct) || 0;
    const pendingMulOffense = [];
    const pendingMulDefense = [];
    const activeBuffFlags = { ...(baseChar._activeBuffFlags || {}) };

    const resolvedTokens = resolveExclusiveModifierTokens(modifierIds);
    const activeIdsSet = new Set(resolvedTokens.map((t) => t.id));

    for (const { id, effective: mod, stacks } of resolvedTokens) {
        if (id === "rhythm_stacks" && stacks >= 15) {
            activeBuffFlags.rhythm15 = true;
        }
        if (id === "hollow_deadeye" && stacks >= 100) {
            activeBuffFlags.hollowDeadeye100 = true;
        }
        if (id === "stalkers_mark") {
            activeBuffFlags.stalkersMark = true;
        }
        if (mod.category === "enlightenment") {
            const enlKey = id.replace(/^enlightenment_/, "");
            activeBuffFlags.enlightenment = enlKey;
            activeBuffFlags[`${enlKey}Enlightenment`] = true;
            if (id === "enlightenment_gale") {
                activeBuffFlags.galeMoveSpeedPct = stacks * 3;
            }
        }

        if (mod.addMaxHealth) {
            out.maxHealth = (Number(out.maxHealth) || 0) + mod.addMaxHealth * stacks;
        }
        if (mod.addAttributes) {
            applyAttributeDelta(out, mod.addAttributes, stacks);
        }
        if (mod.addOffense) {
            for (const [k, delta] of Object.entries(mod.addOffense)) {
                out.offense[k] = (Number(out.offense[k]) || 0) + delta * stacks;
            }
        }
        if (mod.mulOffense) {
            pendingMulOffense.push(mod.mulOffense);
        }
        if (mod.addDefense) {
            for (const [k, delta] of Object.entries(mod.addDefense)) {
                out.defense[k] = (Number(out.defense[k]) || 0) + delta * stacks;
            }
        }
        if (mod.flatAddDefense) {
            for (const [k, delta] of Object.entries(mod.flatAddDefense)) {
                out.defense[k] = (Number(out.defense[k]) || 0) + delta;
            }
        }
        if (mod.mulDefense) {
            pendingMulDefense.push(mod.mulDefense);
        }
        if (mod.skillsetDamageBonusPct) {
            for (const [tree, delta] of Object.entries(mod.skillsetDamageBonusPct)) {
                skillsetBonuses[tree] = (skillsetBonuses[tree] || 0) + delta * stacks;
            }
        }
        if (mod.pveDamageBonusPct) {
            pveDamageBonusPct += mod.pveDamageBonusPct * stacks;
        }
        if (mod.pveReceivedDrPct) {
            pveReceivedDrPct += mod.pveReceivedDrPct * stacks;
        }
    }

    // Life Enlightenment (+1 Rank) buff-side synergy: Deadeye gains +20 Ranged Attack per rank
    if (activeBuffFlags.lifeEnlightenment && activeIdsSet.has("deadeye")) {
        out.offense.rangedAttack = (Number(out.offense.rangedAttack) || 0) + 20;
    }

    // Warrior Medal Instruments & gear +1 Skill Rank buff-side synergies
    // (e.g. Anthem of Battlerage -> Battle Focus +5% Melee CD & +2% Parry, Croon -> Freerunner +20 AGI,
    //  Ballad -> Health Lift +484 Max HP, Fantasia -> Insulating Lens +100 PDef, Ode -> Aranzeb's Boon +5 All Stats)
    for (const sp of getEquippedSpecialEffects(baseChar)) {
        const brb = sp.effect?.buffRankBonus;
        if (!brb || !brb.modifierId || !activeIdsSet.has(brb.modifierId)) continue;
        if (brb.addMaxHealth) {
            out.maxHealth = (Number(out.maxHealth) || 0) + Number(brb.addMaxHealth);
        }
        if (brb.addAttributes) {
            applyAttributeDelta(out, brb.addAttributes, 1);
        }
        if (brb.addOffense) {
            for (const [k, delta] of Object.entries(brb.addOffense)) {
                out.offense[k] = (Number(out.offense[k]) || 0) + Number(delta);
            }
        }
        if (brb.addDefense) {
            for (const [k, delta] of Object.entries(brb.addDefense)) {
                out.defense[k] = (Number(out.defense[k]) || 0) + Number(delta);
            }
        }
    }

    // Apply % offense buffs additively per stat key, matching DaruGear's `stat *= (1 + sumPct / 100)`
    // e.g. Bulwark of Power (+15%) + Doomshadow (+10%) = 1 + 0.15 + 0.10 = 1.25x
    const offMulSums = {};
    for (const mulMap of pendingMulOffense) {
        for (const [k, factor] of Object.entries(mulMap)) {
            offMulSums[k] = (offMulSums[k] || 0) + (Number(factor) - 1);
        }
    }
    for (const [k, deltaSum] of Object.entries(offMulSums)) {
        out.offense[k] = (Number(out.offense[k]) || 0) * Math.max(0, 1 + deltaSum);
    }

    // Apply % defense buffs/debuffs additively per stat key, matching DaruGear's `pdef *= (1 + o[994] / 100)`
    const defMulSums = {};
    for (const mulMap of pendingMulDefense) {
        for (const [k, factor] of Object.entries(mulMap)) {
            defMulSums[k] = (defMulSums[k] || 0) + (Number(factor) - 1);
        }
    }
    for (const [k, deltaSum] of Object.entries(defMulSums)) {
        out.defense[k] = (Number(out.defense[k]) || 0) * Math.max(0, 1 + deltaSum);
    }

    // Enforce AA Classic 3.5 Critical Damage Bonus cap (respecting runtime Formula Overrides, applied before Resilience)
    const maxCb = mergeConstants().maxCritBonusPct;
    out.offense.meleeCritBonusPct = Math.min(maxCb, Number(out.offense.meleeCritBonusPct) || 0);
    out.offense.rangedCritBonusPct = Math.min(maxCb, Number(out.offense.rangedCritBonusPct) || 0);
    out.offense.magicCritBonusPct = Math.min(maxCb, Number(out.offense.magicCritBonusPct) || 0);
    out.offense.healCritBonusPct = Math.min(maxCb, Number(out.offense.healCritBonusPct) || 0);

    // Floor defenses and avoidance rates at 0 (note: received*DrPct may go negative for vulnerability like Mirror Light +12%)
    out.defense.physicalDefense = Math.max(0, out.defense.physicalDefense);
    out.defense.magicDefense = Math.max(0, out.defense.magicDefense);
    out.defense.toughness = Math.max(0, out.defense.toughness);
    out.defense.resilience = Math.max(0, out.defense.resilience);
    out.defense.fixedMeleeDr = Math.max(0, out.defense.fixedMeleeDr);
    out.defense.fixedRangedDr = Math.max(0, out.defense.fixedRangedDr);
    out.defense.fixedMagicDr = Math.max(0, out.defense.fixedMagicDr);
    out.defense.evasionPct = Math.max(0, out.defense.evasionPct);
    out.defense.parryPct = Math.max(0, out.defense.parryPct);
    out.defense.rangedParryPct = Math.max(0, out.defense.rangedParryPct);
    out.defense.blockPct = Math.max(0, out.defense.blockPct);

    out.skillsetDamageBonusPct = skillsetBonuses;
    out.skillsetCooldownReductionPct = skillsetCdr;
    out.skillCooldownReductionPct = skillCdr;
    out.skillCastTimeDeltaSec = skillCastDelta;
    out.pveDamageBonusPct = pveDamageBonusPct;
    out.pveReceivedDrPct = pveReceivedDrPct;
    out._activeBuffFlags = activeBuffFlags;
    if (baseChar._skillBuildApplied) out._skillBuildApplied = true;
    return out;
}

const KNOWN_AAC_BUFF_ID_MAP = Object.freeze({
    1668: "berserk_1668",
    4846: "arcadian_sea_keepers_curse",
    6143: "dark_watchers_dagger",
    127: "inspired_thwart",
    5700: "drum_to_the_arena_5700",
    9000507: "sapphire_watchers_dagger",
    6148: "blooddrinker_blossom",
    9000512: "blooddrinker_blossom",
    18169: "doomshadow_nodachi",
    6605: "general_title",
    11: "purge_ally",
    777: "dissonance",
    847: "charm_lethargy",
    15040: "charm_lethargy",
    853: "charm_unguarded",
    15039: "charm_weakened_energy",
    15051: "charm_unpleasant_sensation",
    15031: "rhythm_stacks",
    11219: "feral_aura_30",
    17943: "weapon_proc_staff",
    3920: "weapon_proc_spear",
    3912: "weapon_proc_katana",
    3904: "weapon_proc_dagger",
    17945: "weapon_proc_scepter",
    3907: "weapon_proc_sword",
    4626: "weapon_proc_shield",
    // Enlightenment 2-set buffs (aa-classic.com 9001046..9001052)
    9001046: "enlightenment_wave",
    9001047: "enlightenment_meadow",
    9001048: "enlightenment_lightning",
    9001049: "enlightenment_gale",
    9001050: "enlightenment_flame",
    9001051: "enlightenment_life",
    9001052: "enlightenment_earth",
    // Pigglewiggle food (aa-classic.com 9000140..9000143, 9000050..9000051)
    9000140: "pigglewiggle_bacon",
    9000141: "pigglewiggle_ham",
    9000142: "pigglewiggle_delight",
    9000143: "pigglewiggle_sausage",
    9000050: "pigglewiggle_grand_feast",
    9000051: "pigglewiggle_stew",
    // Jujube drinks
    16859: "jujube_juice",
    16860: "jujube_sparkling_wine",
    // Rank 3 Alchemy potions
    20588: "kingdoms_shadow",
    674: "kingdoms_heart",
    2354: "ancient_library_relic",
    // Vaughn's Brews
    8000056: "vaughns_potent_stout",
    8000057: "vaughns_soothing_tonic",
    // Combat Manuals
    19938: "combat_manual_awaken",
    19939: "combat_manual_flame",
    19940: "combat_manual_temper",
    // Judge's Longing
    20552: "judges_mercurial_movement",
    20553: "judges_deadly_concentration",
    // Spellbooks: Bulwark (9000052..9000056) & Authority (9000057..9000061)
    9000052: "bulwark_resilience",
    9000053: "bulwark_focus",
    9000054: "bulwark_toughness",
    9000055: "bulwark_power",
    9000056: "bulwark_wisdom",
    9000057: "authority_resilience",
    9000058: "authority_focus",
    9000059: "authority_toughness",
    9000060: "authority_power",
    9000061: "authority_wisdom",
});

function normalizeBuffMatchName(raw) {
    return String(raw || "")
        .toLowerCase()
        .replace(/\([^)]*\)/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/**
 * Find an existing built-in, consumable, or custom modifier in COMBAT_MODIFIERS
 * matching a DaruGear buff entry `{ id, name }`.
 */
export function findModifierForDaruGearBuff(dgBuff) {
    if (!dgBuff || typeof dgBuff !== "object") return null;
    const rawId = dgBuff.id != null ? Number(dgBuff.id) : null;
    const bid = Number.isFinite(rawId) && rawId > 0 ? rawId : null;

    // 1. Direct match by known AA Classic Buff ID table
    if (bid && KNOWN_AAC_BUFF_ID_MAP[bid] && COMBAT_MODIFIERS[KNOWN_AAC_BUFF_ID_MAP[bid]]) {
        return COMBAT_MODIFIERS[KNOWN_AAC_BUFF_ID_MAP[bid]];
    }

    // 2. Direct match by custom/registered modifier `aacBuffId`
    if (bid) {
        for (const mod of Object.values(COMBAT_MODIFIERS)) {
            if (Number(mod.aacBuffId) === bid) return mod;
        }
    }

    // 3. Normalized name match
    const targetName = normalizeBuffMatchName(dgBuff.name);
    if (!targetName) return null;
    for (const mod of Object.values(COMBAT_MODIFIERS)) {
        const modFull = normalizeBuffMatchName(mod.name);
        if (modFull === targetName) return mod;
        if (mod.optionLabel && normalizeBuffMatchName(mod.optionLabel) === targetName) return mod;
    }
    return null;
}

function roundStat(v) {
    return Math.round(v * 10000) / 10000;
}

/**
 * Mathematical inverse of `applyModifiers`: subtracts/divides out the stat contributions
 * of modifiers that were already baked into an imported character snapshot (e.g. DaruGear),
 * so those modifiers can be toggled on/off cleanly without double-counting.
 */
export function unapplyModifiers(character, modifierIds = []) {
    const out = applyOverrides(character, {});
    const resolved = resolveExclusiveModifierTokens(modifierIds);

    // 1. Undo combined additive % offense & defense multipliers first (exact inverse of applyModifiers)
    const offMulSums = {};
    const defMulSums = {};
    for (const { effective: mod } of resolved) {
        if (mod.mulOffense) {
            for (const [k, factor] of Object.entries(mod.mulOffense)) {
                offMulSums[k] = (offMulSums[k] || 0) + (Number(factor) - 1);
            }
        }
        if (mod.mulDefense) {
            for (const [k, factor] of Object.entries(mod.mulDefense)) {
                defMulSums[k] = (defMulSums[k] || 0) + (Number(factor) - 1);
            }
        }
    }
    for (const [k, deltaSum] of Object.entries(offMulSums)) {
        const totalMul = 1 + deltaSum;
        if (totalMul > 1e-6 && Number.isFinite(totalMul)) {
            out.offense[k] = roundStat((Number(out.offense[k]) || 0) / totalMul);
        }
    }
    for (const [k, deltaSum] of Object.entries(defMulSums)) {
        const totalMul = 1 + deltaSum;
        if (totalMul > 1e-6 && Number.isFinite(totalMul)) {
            out.defense[k] = roundStat((Number(out.defense[k]) || 0) / totalMul);
        }
    }

    // 2. Undo additive maxHealth, attributes (+ derived stats), offense, and defense modifiers
    for (let i = resolved.length - 1; i >= 0; i--) {
        const { effective: mod, stacks } = resolved[i];
        if (mod.addMaxHealth) {
            out.maxHealth = roundStat((Number(out.maxHealth) || 0) - mod.addMaxHealth * stacks);
        }
        if (mod.addAttributes) {
            applyAttributeDelta(out, mod.addAttributes, -stacks, roundStat);
        }
        if (mod.addOffense) {
            for (const [k, delta] of Object.entries(mod.addOffense)) {
                out.offense[k] = roundStat((Number(out.offense[k]) || 0) - delta * stacks);
            }
        }
        if (mod.addDefense) {
            for (const [k, delta] of Object.entries(mod.addDefense)) {
                out.defense[k] = roundStat((Number(out.defense[k]) || 0) - delta * stacks);
            }
        }
        if (mod.flatAddDefense) {
            for (const [k, delta] of Object.entries(mod.flatAddDefense)) {
                out.defense[k] = roundStat((Number(out.defense[k]) || 0) - delta);
            }
        }
    }

    // Clamp non-negative base stats at 0 (received*DrPct may legitimately remain negative)
    out.maxHealth = Math.max(0, out.maxHealth);
    out.offense.meleeAttack = Math.max(0, out.offense.meleeAttack);
    out.offense.rangedAttack = Math.max(0, out.offense.rangedAttack);
    out.offense.magicAttack = Math.max(0, out.offense.magicAttack);
    out.offense.healingPower = Math.max(0, out.offense.healingPower);
    out.defense.physicalDefense = Math.max(0, out.defense.physicalDefense);
    out.defense.magicDefense = Math.max(0, out.defense.magicDefense);
    out.defense.toughness = Math.max(0, out.defense.toughness);
    out.defense.resilience = Math.max(0, out.defense.resilience);
    out.defense.fixedMeleeDr = Math.max(0, out.defense.fixedMeleeDr);
    out.defense.fixedRangedDr = Math.max(0, out.defense.fixedRangedDr);
    out.defense.fixedMagicDr = Math.max(0, out.defense.fixedMagicDr);
    out.defense.evasionPct = Math.max(0, out.defense.evasionPct);
    out.defense.parryPct = Math.max(0, out.defense.parryPct);
    out.defense.rangedParryPct = Math.max(0, out.defense.rangedParryPct);
    out.defense.blockPct = Math.max(0, out.defense.blockPct);

    return out;
}

// ============================================================================
// Core ArcheAge Classic Mitigation Curve Functions
// ============================================================================

export function defenseMitigationPct(defense, defenseK = mergeConstants().defenseK) {
    const d = Math.max(0, Number(defense) || 0);
    const k = Math.max(1e-6, Number(defenseK) || DEFAULT_CONSTANTS.defenseK);
    return (d / (d + k)) * 100;
}

export function defenseMultiplier(defense, defenseK = mergeConstants().defenseK) {
    const d = Math.max(0, Number(defense) || 0);
    const k = Math.max(1e-6, Number(defenseK) || DEFAULT_CONSTANTS.defenseK);
    return k / (d + k);
}

export function toughnessMitigationPct(toughness, toughnessK = mergeConstants().toughnessK) {
    const t = Math.max(0, Number(toughness) || 0);
    const k = Math.max(1e-6, Number(toughnessK) || DEFAULT_CONSTANTS.toughnessK);
    return (t / (t + k)) * 100;
}

export function toughnessMultiplier(toughness, toughnessK = mergeConstants().toughnessK) {
    const t = Math.max(0, Number(toughness) || 0);
    const k = Math.max(1e-6, Number(toughnessK) || DEFAULT_CONSTANTS.toughnessK);
    return k / (t + k);
}

export function resilienceCritRateReductionPct(resilience, k = mergeConstants().resilienceCritRateK) {
    const r = Math.max(0, Number(resilience) || 0);
    const denomK = Math.max(1e-6, Number(k) || DEFAULT_CONSTANTS.resilienceCritRateK);
    return (r / (r + denomK)) * 100;
}

export function resilienceCritBonusReductionPct(resilience, k = mergeConstants().resilienceCritBonusK) {
    const r = Math.max(0, Number(resilience) || 0);
    const denomK = Math.max(1e-6, Number(k) || DEFAULT_CONSTANTS.resilienceCritBonusK);
    return (r / (r + denomK)) * 100;
}

export function focusAvoidanceNegationPct(focus, perPoint = mergeConstants().focusNegationPctPerPoint) {
    const rate = Math.max(0, Number(perPoint) || 0);
    return Math.max(0, Number(focus) || 0) * rate;
}

/**
 * AA Classic 1.3.6 Attack Speed % (GCD / animation delay multiplier; lower % = faster).
 * Matches DaruGear's exact formula: 100 / (1 + 0.001 * attackSpeedRating).
 * e.g. 0 -> 100%, 177 (Equip Dual Weapons) -> 85.0%, 500 (Berserk) -> 66.7%.
 */
export function attackSpeedGcdPct(attackSpeed, scale = mergeConstants().attackSpeedScale) {
    const rating = clamp(Number(attackSpeed) || 0, -500, 3000);
    const s = Math.max(0, Number(scale) || 0);
    const denom = Math.max(0.25, 1 + s * rating);
    return 100 / denom;
}

/**
 * Effective Global Cooldown in seconds given AA Classic Attack Speed rating.
 */
export function effectiveGcdSec(
    attackSpeed,
    baseGcdSec = mergeConstants().baseGcdSec,
    scale = mergeConstants().attackSpeedScale
) {
    const base =
        baseGcdSec != null && Number.isFinite(Number(baseGcdSec))
            ? Math.max(0, Number(baseGcdSec))
            : mergeConstants().baseGcdSec;
    return base * (attackSpeedGcdPct(attackSpeed, scale) / 100);
}

/**
 * Resolve per-skill GCD, rapid-fire interval, cast time, cooldown, and burst/sustained
 * rate metrics. Handles:
 *  - True Off-GCD skills (gcdSec === 0, no fireIntervalSec) -> 0s rotation footprint, burst = null
 *  - No-GCD rapid-fire skills (gcdSec === 0, fireIntervalSec > 0, e.g. Endless Arrows / Mana Stars)
 *  - Reduced-GCD skills (0 < gcdSec < baseGcdSec, e.g. Resurgence 0.5s, Rapid Strike 0.4s)
 *  - Multi-hit reduced-GCD chains (e.g. Triple Slash 1.5s, Fervent Healing 2.0s)
 *  - Inherently Off-GCD instant skills (gcdSec === 0, e.g. Gods' Whip, Spell Shield, Hollow Deadeye)
 *  - Optional per-step overrides in rotation context (context.offGcd / context.gcdOverrideSec)
 */
export function resolveSkillTiming(skill, actor, totalExpected, constants = DEFAULT_CONSTANTS, context = {}) {
    const defaultGcd = Number(constants.baseGcdSec) || 1.0;
    const scale = Number(constants.attackSpeedScale) || 0.001;
    const castTimePct = clamp(Number(actor?.offense?.castTimePct ?? 100), 40, 200);
    const attackSpeed = Number(actor?.offense?.attackSpeed ?? 0) || 0;
    const gcdPct = attackSpeedGcdPct(attackSpeed, scale);

    const flags = skill?.flags || {};
    const forcedOffGcd = Boolean(context?.offGcd);
    const hasOverrideGcd =
        !forcedOffGcd &&
        context?.gcdOverrideSec != null &&
        context.gcdOverrideSec !== "" &&
        Number.isFinite(Number(context.gcdOverrideSec));

    let baseGcdSec;
    if (forcedOffGcd) {
        baseGcdSec = 0;
    } else if (hasOverrideGcd) {
        baseGcdSec = Math.max(0, Number(context.gcdOverrideSec));
    } else if (skill?.gcdSec != null && Number.isFinite(Number(skill.gcdSec))) {
        baseGcdSec = Math.max(0, Number(skill.gcdSec));
    } else if (flags.noGcd) {
        baseGcdSec = 0;
    } else {
        baseGcdSec = defaultGcd;
    }

    const fireIntervalBaseSec =
        !forcedOffGcd &&
        !hasOverrideGcd &&
        skill?.fireIntervalSec != null &&
        Number.isFinite(Number(skill.fireIntervalSec)) &&
        Number(skill.fireIntervalSec) > 0
            ? Number(skill.fireIntervalSec)
            : 0;

    const gcdSec = baseGcdSec > 0 ? effectiveGcdSec(attackSpeed, baseGcdSec, scale) : 0;
    const effectiveFireIntervalSec =
        fireIntervalBaseSec > 0 ? effectiveGcdSec(attackSpeed, fireIntervalBaseSec, scale) : 0;
    let rawCastTimeSec = Math.max(0, Number(skill?.castTimeSec) || 0);
    if (rawCastTimeSec > 0 && skill?.id && actor?.skillCastTimeDeltaSec?.[skill.id]) {
        rawCastTimeSec = Math.max(0, rawCastTimeSec + Number(actor.skillCastTimeDeltaSec[skill.id]));
    }
    let gearCastTimePctDelta = 0;
    let gearInstantBy = null;
    if (rawCastTimeSec > 0 && skill?.id) {
        const skillVariant = skill.variant || "base";
        for (const sp of getEquippedSpecialEffects(actor)) {
            const bonusList = Array.isArray(sp.effect?.skillBonuses)
                ? sp.effect.skillBonuses
                : sp.effect?.skillBonus
                  ? [sp.effect.skillBonus]
                  : [];
            for (const sb of bonusList) {
                if (!sb) continue;
                if (sb.skillId && skill.id !== sb.skillId) continue;
                if (sb.variant && skillVariant !== sb.variant) continue;
                if (sb.kind === "removeCastTime") {
                    gearInstantBy = sp.name;
                } else if (sb.kind === "castTimeSec") {
                    rawCastTimeSec = Math.max(0, rawCastTimeSec + (Number(sb.value) || 0));
                } else if (sb.kind === "castTimePct") {
                    gearCastTimePctDelta += Number(sb.value) || 0;
                }
            }
        }
    }
    const effectiveCastTimePct = Math.max(40, castTimePct + gearCastTimePctDelta);
    const unmodifiedCastTimeSec = rawCastTimeSec * (effectiveCastTimePct / 100);
    const autoInstantByRhythm =
        Boolean(flags.instantAtRhythm15) && Boolean(actor?._activeBuffFlags?.rhythm15);
    const autoInstantByHollowDeadeye =
        skill?.id === "archery_snipe" && Boolean(actor?._activeBuffFlags?.hollowDeadeye100);
    const castTimeRemoved =
        rawCastTimeSec > 0 &&
        (forcedOffGcd ||
            Boolean(context?.removeCastTime) ||
            Boolean(gearInstantBy) ||
            autoInstantByRhythm ||
            autoInstantByHollowDeadeye);
    const effectiveCastTimeSec = castTimeRemoved ? 0 : unmodifiedCastTimeSec;
    const castTimeSavedSec = castTimeRemoved ? unmodifiedCastTimeSec : 0;
    const castRemovedBy = castTimeRemoved
        ? context?.castRemovedBy ||
          gearInstantBy ||
          (autoInstantByRhythm
              ? "15x Rhythm"
              : autoInstantByHollowDeadeye
                ? "Hollow Deadeye (100x)"
                : forcedOffGcd
                  ? "Off-GCD"
                  : "Instant Combo")
        : null;
    const rawCooldownSec = Math.max(0, Number(skill?.cooldownSec) || 0);
    const cdrPct = Math.max(
        0,
        Math.min(
            50,
            (Number(actor?.skillsetCooldownReductionPct?.[skill?.skillset]) || 0) +
                (Number(actor?.skillCooldownReductionPct?.[skill?.id]) || 0)
        )
    );
    const cooldownSec = rawCooldownSec > 0 ? rawCooldownSec * (1 - cdrPct / 100) : 0;

    // ArcheAge executes Cast Time first, then triggers the post-cast GCD (or rapid-fire interval).
    // Removing a skill's cast time (e.g. Spell Shield -> Antithesis, Drop Back -> Flamebolt/Mend,
    // Frigid Tracks -> Freezing Arrow) eliminates effectiveCastTimeSec so only postCastDelaySec remains.
    const postCastDelaySec = Math.max(gcdSec, effectiveFireIntervalSec);
    const execTimeSec = effectiveCastTimeSec + postCastDelaySec;

    const isNoGcd = baseGcdSec === 0;
    const isOffGcd = isNoGcd && effectiveCastTimeSec === 0 && effectiveFireIntervalSec === 0;
    const isReducedGcd = baseGcdSec > 0 && baseGcdSec < defaultGcd - 1e-6;
    const isChainGcd = baseGcdSec > defaultGcd + 1e-6;

    let gcdKind = "standard";
    if (isOffGcd) gcdKind = "none";
    else if (isNoGcd && effectiveFireIntervalSec > 0) gcdKind = "rapid";
    else if (isNoGcd) gcdKind = "none";
    else if (isReducedGcd) gcdKind = "reduced";
    else if (isChainGcd) gcdKind = "chain";

    // Sustained cycle time: cooldown if > 0; else HoT/DoT total duration (if non-per-tick); else execTimeSec
    const isTotalOverTime =
        (flags.isHot || flags.isDot) &&
        !flags.perTickFormula &&
        Number(flags.durationSec) > 0;
    let cycleTimeSec = execTimeSec;
    let cycleReason = "exec";
    if (cooldownSec > 0 && cooldownSec >= execTimeSec) {
        cycleTimeSec = cooldownSec;
        cycleReason = "cooldown";
    } else if (isTotalOverTime && Number(flags.durationSec) > execTimeSec) {
        cycleTimeSec = Number(flags.durationSec);
        cycleReason = "duration";
    }

    const burst = execTimeSec > 0 ? totalExpected / execTimeSec : null;
    const sustained = cycleTimeSec > 0 ? totalExpected / cycleTimeSec : null;

    return {
        burst,
        sustained,
        execTimeSec,
        postCastDelaySec,
        cycleTimeSec,
        cycleReason,
        rawCastTimeSec,
        unmodifiedCastTimeSec,
        castTimePct,
        effectiveCastTimeSec,
        castTimeRemoved,
        castTimeSavedSec,
        castRemovedBy,
        baseGcdSec,
        gcdSec,
        fireIntervalBaseSec,
        effectiveFireIntervalSec,
        attackSpeed,
        attackSpeedGcdPct: gcdPct,
        cooldownSec,
        isNoGcd,
        isOffGcd,
        isReducedGcd,
        isChainGcd,
        gcdKind,
        gcdNote: skill?.gcdNote || "",
    };
}
