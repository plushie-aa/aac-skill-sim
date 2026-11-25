/**
 * ArcheAge Classic 1.3.6 Single-Skill Damage Engine.
 * Pure math (zero DOM dependencies). Computes Normal, Crit, Blocked,
 * Shield-Pen-Proc, Expected (Average) damage, and a full mitigation breakdown.
 */

import { getEquippedT7ObsidianEffects } from "../adapters/darugear_calc.js";
import { mergeConstants } from "./constants.js";
import { evaluateManualComboStatuses } from "./combos.js";
import { getEquipmentSkillBonus } from "./gearswap.js";
import { getRequestedRankFromContext, resolveSkillRank } from "./skills.js";
import {
    applyModifiers,
    clamp,
    defenseMitigationPct,
    defenseMultiplier,
    focusAvoidanceNegationPct,
    resilienceCritBonusReductionPct,
    resilienceCritRateReductionPct,
    resolveSkillTiming,
    toughnessMitigationPct,
    toughnessMultiplier,
} from "./stats.js";

function resolveOffenseProfile(attacker, skill, constants) {
    const off = attacker.offense || {};
    const scalingStat = skill.scalingStat || "meleeAttack";
    const damageType = skill.damageType || "physical";

    const attackPower = Number(off[scalingStat]) || 0;

    // Multiplier stat: confirmed live that Vitalism damage skills scale with healingPct (heal_mul)
    let skillDamagePct = 0;
    if (scalingStat === "meleeAttack") {
        skillDamagePct = Number(off.meleeSkillDamagePct) || 0;
    } else if (scalingStat === "rangedAttack") {
        skillDamagePct = Number(off.rangedSkillDamagePct) || 0;
    } else if (scalingStat === "magicAttack") {
        skillDamagePct = Number(off.magicSkillDamagePct) || 0;
    } else if (scalingStat === "healingPower") {
        skillDamagePct = constants.vitalismDamageUsesHealMul
            ? Number(off.healingPct) || 0
            : Number(off.magicSkillDamagePct) || 0;
    }

    // Skillset-specific passive bonus (e.g. Weapon Mastery +15%, Aranzeb's Infusion +15%, Feral Claws +15%)
    // Applied multiplicatively with Skill Damage % (same bucket behavior as skill-specific lunagems)
    const treeBonusPct = Number(attacker.skillsetDamageBonusPct?.[skill.skillset]) || 0;

    // Accuracy, Crit Rate, Crit Bonus, Backstab Damage follow combat attack category
    // (Vitalism magic damage skills roll Magic Accuracy & Magic Crit, not Heal Crit)
    let accuracyPct, critRatePct, critBonusPct, backstabDamagePct;
    if (damageType === "magic") {
        accuracyPct = Number(off.magicAccuracyPct ?? 100);
        critRatePct = Number(off.magicCritRatePct) || 0;
        critBonusPct = Number(off.magicCritBonusPct ?? constants.baseCritBonusPct);
        backstabDamagePct = Number(off.backstabMagicDamagePct) || 0;
    } else if (scalingStat === "rangedAttack") {
        accuracyPct = Number(off.rangedAccuracyPct ?? 100);
        critRatePct = Number(off.rangedCritRatePct) || 0;
        critBonusPct = Number(off.rangedCritBonusPct ?? constants.baseCritBonusPct);
        backstabDamagePct = Number(off.backstabRangedDamagePct) || 0;
    } else {
        accuracyPct = Number(off.meleeAccuracyPct ?? 100);
        critRatePct = Number(off.meleeCritRatePct) || 0;
        critBonusPct = Number(off.meleeCritBonusPct ?? constants.baseCritBonusPct);
        backstabDamagePct = Number(off.backstabMeleeDamagePct) || 0;
    }

    const defPen =
        damageType === "magic"
            ? Number(off.magicDefensePenetration) || 0
            : Number(off.defensePenetration) || 0;

    return {
        attackPower,
        skillDamagePct,
        treeBonusPct,
        accuracyPct,
        critRatePct,
        critBonusPct,
        backstabDamagePct,
        defPen,
        shieldDefPenRatePct: damageType === "physical" ? Number(off.shieldDefPenRatePct) || 0 : 0,
        shieldDefPenPct: damageType === "physical" ? Number(off.shieldDefPenPct) || 0 : 0,
        focus: Number(off.focus) || 0,
    };
}

function resolveDefenseProfile(defender, skill) {
    const def = defender.defense || {};
    const damageType = skill.damageType || "physical";
    const scalingStat = skill.scalingStat || "meleeAttack";
    const isRanged = scalingStat === "rangedAttack";

    const hasShield =
        typeof def.hasShield === "boolean"
            ? def.hasShield
            : Number(def.shieldPhysicalDefense) > 0 || Number(def.blockPct) > 0;
    const canParryRanged = Boolean(def.dualWieldRangedParry || Number(def.rangedParryPct) > 0);

    const defense =
        damageType === "magic"
            ? Number(def.magicDefense) || 0
            : Number(def.physicalDefense) || 0;

    let receivedDrPct = 0;
    let fixedDr = 0;
    if (damageType === "magic") {
        receivedDrPct = Number(def.receivedMagicDrPct) || 0;
        fixedDr = Number(def.fixedMagicDr) || 0;
    } else if (isRanged) {
        receivedDrPct = Number(def.receivedRangedDrPct) || 0;
        fixedDr = Number(def.fixedRangedDr) || 0;
    } else {
        receivedDrPct = Number(def.receivedMeleeDrPct) || 0;
        fixedDr = Number(def.fixedMeleeDr) || 0;
    }

    const effectiveParryStat = isRanged
        ? canParryRanged
            ? Number(def.rangedParryPct) > 0
                ? Number(def.rangedParryPct)
                : Number(def.parryPct) || 0
            : 0
        : Number(def.parryPct) || 0;

    return {
        defense,
        hasShield,
        canParryRanged,
        shieldPhysicalDefense:
            damageType === "physical" && hasShield ? Number(def.shieldPhysicalDefense) || 0 : 0,
        toughness: Number(def.toughness) || 0,
        resilience: Number(def.resilience) || 0,
        evasionPct: Number(def.evasionPct) || 0,
        parryPct: effectiveParryStat,
        blockPct: hasShield ? Number(def.blockPct) || 0 : 0,
        receivedDrPct,
        fixedDr,
    };
}

function computeAvoidanceTable(offense, defense, skill, context, constants) {
    const unavoidable = Boolean(skill.flags?.unavoidable);
    const isMagic = skill.damageType === "magic";
    const isRanged = skill.scalingStat === "rangedAttack";
    const isBackstab = Boolean(context.isBackstab);
    const targetIsCCd = Boolean(context.targetIsCCd);
    const disableAvoidance = Boolean(context.disableAvoidance);

    const accuracyPct = clamp(Number(offense.accuracyPct ?? 100), 0, 100);
    const pMiss = (100 - accuracyPct) / 100;
    const pOnTarget = 1 - pMiss;

    const focusNeg = focusAvoidanceNegationPct(offense.focus, constants.focusNegationPctPerPoint);

    // No avoidance stats apply to magic damage, backstabs, CC'd targets, unavoidable skills, or when disabled
    const avoidanceBypassed = unavoidable || isMagic || isBackstab || targetIsCCd || disableAvoidance;
    let bypassReason = null;
    if (isMagic) bypassReason = "Magic damage ignores avoidance";
    else if (disableAvoidance) bypassReason = "Avoidance disabled";
    else if (unavoidable) bypassReason = "Skill ignores avoidance";
    else if (isBackstab) bypassReason = "Backstab ignores avoidance";
    else if (targetIsCCd) bypassReason = "Target CC'd ignores avoidance";

    const evadeApplies = !avoidanceBypassed && defense.evasionPct > 0;
    const parryApplies = !avoidanceBypassed && (!isRanged || defense.canParryRanged) && defense.parryPct > 0;
    const blockApplies = !avoidanceBypassed && defense.hasShield && defense.blockPct > 0;

    // Formula: avoidance = max(0, evasion - focus) + max(0, parry - focus) + max(0, block - focus)
    // Focus is only subtracted from stats that actually apply!
    const effEvadePct = evadeApplies ? Math.max(0, defense.evasionPct - focusNeg) : 0;
    const effParryPct = parryApplies ? Math.max(0, defense.parryPct - focusNeg) : 0;
    const effBlockPct = blockApplies ? Math.max(0, defense.blockPct - focusNeg) : 0;

    // Allocate avoidance within [0, 1] in priority order (Evade -> Parry -> Block)
    let rEvade = 0;
    let rParry = 0;
    let rBlock = 0;
    let remAvoid = 1.0;
    if (constants.avoidanceModel === "multiplicative") {
        const pEv = clamp(effEvadePct / 100, 0, 1);
        const pPa = clamp(effParryPct / 100, 0, 1);
        const pBl = clamp(effBlockPct / 100, 0, 1);
        rEvade = pEv;
        remAvoid *= 1 - pEv;
        rParry = remAvoid * pPa;
        remAvoid *= 1 - pPa;
        rBlock = remAvoid * pBl;
        remAvoid *= 1 - pBl;
    } else {
        rEvade = Math.min(remAvoid, effEvadePct / 100);
        remAvoid -= rEvade;
        rParry = Math.min(remAvoid, effParryPct / 100);
        remAvoid -= rParry;
        rBlock = Math.min(remAvoid, effBlockPct / 100);
        remAvoid -= rBlock;
    }

    const miss = pMiss;
    const evade = pOnTarget * rEvade;
    const parry = pOnTarget * rParry;
    const block = pOnTarget * rBlock;
    const connect = pOnTarget * Math.max(0, remAvoid);

    return {
        accuracyPct,
        focusNegationPct: focusNeg,
        evadeApplies,
        parryApplies,
        blockApplies,
        hasShield: defense.hasShield,
        canParryRanged: defense.canParryRanged,
        bypassReason,
        rawEvadePct: effEvadePct,
        rawParryPct: effParryPct,
        rawBlockPct: effBlockPct,
        totalAvoidancePct: Math.min(100, (rEvade + rParry + rBlock) * 100),
        miss,
        evade,
        parry,
        block,
        connect,
    };
}

function simulateSingleHit(attacker, defender, skill, hitSpec, context, constants) {
    const off = resolveOffenseProfile(attacker, skill, constants);
    const def = resolveDefenseProfile(defender, skill);
    const flags = skill.flags || {};

    // 1. Raw base & scaling (+ Life Enlightenment +1 Rank on eligible base skills)
    let rawBase = Number(hitSpec.base) || 0;
    let rawScalingPct = Number(hitSpec.scalingPct) || 0;
    let lifeEnlightenmentBonusCritDmg = 0;
    let lifeEnlightenmentBackstabCritRate = 0;
    let lifeEnlightenmentNote = null;

    if (attacker?._activeBuffFlags?.lifeEnlightenment && (skill.variant || "base") === "base") {
        if (skill.id === "battlerage_precision_strike") {
            // Live Dump 1 vs Dump 2 verified: R6 (864, +60% CD, +34% backstab) -> R7 (921, +65% CD, +36% backstab)
            rawBase += 57;
            lifeEnlightenmentBonusCritDmg = 5;
            lifeEnlightenmentBackstabCritRate = 2;
            lifeEnlightenmentNote = "Life Enlightenment (+1 Rank): +57 Base, +5% Crit Dmg, +2% Backstab Crit";
        } else if (
            skill.id === "witchcraft_earthen_grip" ||
            skill.id === "defense_shield_slam" ||
            skill.id === "occultism_hell_spear" ||
            skill.id === "sorcery_freezing_earth" ||
            skill.id === "shadowplay_stalkers_mark"
        ) {
            lifeEnlightenmentNote =
                skill.id === "shadowplay_stalkers_mark"
                    ? "Life Enlightenment (+1 Rank): +10 expiry dmg/hit"
                    : "Life Enlightenment (+1 Rank active)";
        }
    }

    if (hitSpec.parseSource === "shadowsmite" || skill.parseSource === "shadowsmite") {
        const stacks = Math.max(0, Number(context.bloodthirstStacks ?? 0));
        const perStack = Number(hitSpec.bloodthirstPerStack ?? flags.bloodthirstBasePerStack ?? 210);
        rawBase = stacks * perStack;
        rawScalingPct = context.isBackstab
            ? Number(hitSpec.backstabScalingPct ?? flags.backstabMeleeAttackPct ?? 400)
            : 0;
    }

    const rawBeforeMultipliers = rawBase + off.attackPower * (rawScalingPct / 100);

    // 2. Attacker multipliers (Skill Damage %, Skill-Specific Lunagems, Range penalty, Backstab %, Combo %, PvE %)
    const skillGem = getEquipmentSkillBonus(attacker, skill);
    const manualCombo = evaluateManualComboStatuses(skill, context.targetStatuses);
    const effectiveContext = manualCombo.triggersAutoCC
        ? { ...context, targetIsCCd: true }
        : context;
    const totalComboBonusPct = (Number(context.comboBonusPct) || 0) + manualCombo.comboBonusPct;

    const skillDmgMult = 1 + off.skillDamagePct / 100;
    const treeBonusMult = 1 + (off.treeBonusPct || 0) / 100;
    const skillGemMult = 1 + skillGem.damagePct / 100;
    const rangeMult =
        effectiveContext.within8m && flags.rangePenaltyBelow8mPct
            ? 1 + flags.rangePenaltyBelow8mPct / 100
            : 1;
    const backstabMult = effectiveContext.isBackstab ? 1 + off.backstabDamagePct / 100 : 1;
    const comboMult = 1 + totalComboBonusPct / 100;
    const pveSkillBonus = (flags.pveBonusPct || 0) + (Number(attacker.pveDamageBonusPct) || 0);
    const pveMult = effectiveContext.isPvE && pveSkillBonus ? 1 + pveSkillBonus / 100 : 1;

    const preMitigation =
        rawBeforeMultipliers *
        skillDmgMult *
        treeBonusMult *
        skillGemMult *
        rangeMult *
        backstabMult *
        comboMult *
        pveMult;

    // 3. Defense & Penetration (+ optional T7 Deathfletcher Stalker's Mark shred + Shield Defense Penetration proc)
    let t7DefenseShred = 0;
    let t7EffectNote = null;
    if (
        skill.damageType === "physical" &&
        !context._deathfletcherRotationApplied &&
        defender?._activeBuffFlags?.stalkersMark
    ) {
        const t7List = getEquippedT7ObsidianEffects(attacker);
        const df = t7List.find((e) => Number(e.effect?.stalkersMarkDefShred) > 0);
        if (df) {
            t7DefenseShred = Number(df.effect.stalkersMarkDefShred);
            t7EffectNote = `${df.name} (T7): Stalker's Mark -${t7DefenseShred} PDef`;
        }
    }
    const effectiveDefense = Math.max(0, def.defense - t7DefenseShred - off.defPen);
    const defMultNormal = defenseMultiplier(effectiveDefense, constants.defenseK);
    const defMitPctNormal = defenseMitigationPct(effectiveDefense, constants.defenseK);

    const hasShieldPen =
        def.shieldPhysicalDefense > 0 && off.shieldDefPenRatePct > 0 && off.shieldDefPenPct > 0;
    const shieldPenProcChance = hasShieldPen ? clamp(off.shieldDefPenRatePct, 0, 100) / 100 : 0;
    const ignoredShieldDef = hasShieldPen ? def.shieldPhysicalDefense * (off.shieldDefPenPct / 100) : 0;
    const effectiveDefenseShieldPen = Math.max(0, def.defense - t7DefenseShred - off.defPen - ignoredShieldDef);
    const defMultShieldPen = defenseMultiplier(effectiveDefenseShieldPen, constants.defenseK);
    const avgDefMult =
        (1 - shieldPenProcChance) * defMultNormal + shieldPenProcChance * defMultShieldPen;

    // 4. Toughness (PvP DR) & Defender Received Type % DR (+ PvE Received DR from food buffs in PvE)
    const toughMult = context.isPvE ? 1 : toughnessMultiplier(def.toughness, constants.toughnessK);
    const toughMitPct = context.isPvE ? 0 : toughnessMitigationPct(def.toughness, constants.toughnessK);
    const totalReceivedDrPct = def.receivedDrPct + (context.isPvE ? Number(defender.pveReceivedDrPct) || 0 : 0);
    const receivedDrMult = Math.max(0, 1 - totalReceivedDrPct / 100);

    // 5. Normal hit (regular & shield-pen proc)
    const afterPctMitNormal = preMitigation * defMultNormal * toughMult * receivedDrMult;
    const normalHit = Math.max(constants.minFinalDamage, afterPctMitNormal - def.fixedDr);

    const afterPctMitShieldPen = preMitigation * defMultShieldPen * toughMult * receivedDrMult;
    const normalHitShieldPen = Math.max(constants.minFinalDamage, afterPctMitShieldPen - def.fixedDr);

    // 6. Critical hit vs. Resilience
    const resCritRateRed = context.isPvE
        ? 0
        : resilienceCritRateReductionPct(def.resilience, constants.resilienceCritRateK);
    const resCritBonusRed = context.isPvE
        ? 0
        : resilienceCritBonusReductionPct(def.resilience, constants.resilienceCritBonusK);

    let bonusCritRate = (Number(effectiveContext.bonusCritRatePct) || 0) + skillGem.critRatePct;
    if (effectiveContext.isBackstab && flags.backstabCritRateBonusPct) {
        bonusCritRate += flags.backstabCritRateBonusPct + lifeEnlightenmentBackstabCritRate;
    }
    if (effectiveContext.targetBelow30Pct && flags.executeCritRateBonusPct) {
        bonusCritRate += flags.executeCritRateBonusPct;
    }

    const bonusCritDmg =
        (Number(flags.critDamageBonusPct) || 0) +
        (Number(effectiveContext.bonusCritDamagePct) || 0) +
        skillGem.critBonusPct +
        lifeEnlightenmentBonusCritDmg;

    const effectiveCritRatePct = clamp(off.critRatePct + bonusCritRate - resCritRateRed, 0, 100);
    const cappedCritBonus = Math.min(constants.maxCritBonusPct, off.critBonusPct + bonusCritDmg);
    const effectiveCritBonusPct = Math.max(constants.minEffectiveCritBonusPct, cappedCritBonus - resCritBonusRed);
    const critMult = 1 + effectiveCritBonusPct / 100;

    const critHit = Math.max(constants.minFinalDamage, afterPctMitNormal * critMult - def.fixedDr);
    const critHitShieldPen = Math.max(constants.minFinalDamage, afterPctMitShieldPen * critMult - def.fixedDr);

    // 7. Avoidance combat table & Expected (Average) hit
    const avoidance = computeAvoidanceTable(off, def, skill, effectiveContext, constants);
    const pCrit = avoidance.connect * (effectiveCritRatePct / 100);
    const pNormal = avoidance.connect * (1 - effectiveCritRatePct / 100);

    const avgNormalWhenConnect =
        (1 - shieldPenProcChance) * normalHit + shieldPenProcChance * normalHitShieldPen;
    const avgCritWhenConnect =
        (1 - shieldPenProcChance) * critHit + shieldPenProcChance * critHitShieldPen;
    const blockedHit = avgNormalWhenConnect * constants.shieldBlockDamageMultiplier;

    const expectedHit =
        pNormal * avgNormalWhenConnect +
        pCrit * avgCritWhenConnect +
        avoidance.block * blockedHit;

    // 8. Step-by-step mitigation waterfall (for non-crit hit)
    const afterDefense = preMitigation * avgDefMult;
    const afterToughness = afterDefense * toughMult;
    const afterReceivedDr = afterToughness * receivedDrMult;
    const afterFixedDr = Math.max(constants.minFinalDamage, afterReceivedDr - def.fixedDr);

    return {
        label: hitSpec.label || skill.name,
        skillId: hitSpec.skillId ?? skill.skillId,
        normal: normalHit,
        crit: critHit,
        normalShieldPen: hasShieldPen ? normalHitShieldPen : null,
        critShieldPen: hasShieldPen ? critHitShieldPen : null,
        blocked: blockedHit,
        expected: expectedHit,
        breakdown: {
            rawBase,
            rawScalingPct,
            attackPower: off.attackPower,
            skillDamagePct: off.skillDamagePct,
            treeBonusPct: off.treeBonusPct || 0,
            skillGemBonusPct: skillGem.damagePct,
            skillGemSummary: skillGem.summary,
            lifeEnlightenmentNote,
            t7DefenseShred,
            t7EffectNote,
            comboBonusPct: totalComboBonusPct,
            comboLabels: manualCombo.matchedLabels,
            comboAutoCCLabel: manualCombo.autoCCLabel,
            preMitigation,
            effectiveDefense,
            defenseMitigationPct: defMitPctNormal,
            shieldPenProcChancePct: shieldPenProcChance * 100,
            effectiveDefenseShieldPen: hasShieldPen ? effectiveDefenseShieldPen : null,
            toughnessMitigationPct: toughMitPct,
            receivedDrPct: def.receivedDrPct,
            fixedDr: def.fixedDr,
            effectiveCritRatePct,
            effectiveCritBonusPct,
            resilienceCritRateRedPct: resCritRateRed,
            resilienceCritBonusRedPct: resCritBonusRed,
            avoidance: {
                accuracyPct: avoidance.accuracyPct,
                missPct: avoidance.miss * 100,
                evadePct: avoidance.evade * 100,
                parryPct: avoidance.parry * 100,
                blockPct: avoidance.block * 100,
                rawEvadePct: avoidance.rawEvadePct,
                rawParryPct: avoidance.rawParryPct,
                rawBlockPct: avoidance.rawBlockPct,
                totalAvoidancePct: avoidance.totalAvoidancePct,
                connectPct: avoidance.connect * 100,
                focusNegationPct: avoidance.focusNegationPct,
                evadeApplies: avoidance.evadeApplies,
                parryApplies: avoidance.parryApplies,
                blockApplies: avoidance.blockApplies,
                hasShield: avoidance.hasShield,
                canParryRanged: avoidance.canParryRanged,
                bypassReason: avoidance.bypassReason,
            },
            mitigationWaterfall: {
                preMitigation,
                removedByDefense: preMitigation - afterDefense,
                removedByToughness: afterDefense - afterToughness,
                removedByReceivedDr: afterToughness - afterReceivedDr,
                removedByFixedDr: afterReceivedDr - afterFixedDr,
                finalNonCrit: afterFixedDr,
            },
        },
    };
}

/**
 * Live-verified secondary DoT / Bleed / Poison / Bloodthirst Finisher effects
 * (values from clean Lv 55 / Lv 52 in-game tooltips). Opt-in via `context.includeSecondaryEffects`.
 */
const SECONDARY_SKILL_EFFECTS = Object.freeze({
    sorcery_arc_lightning: {
        kind: "dot",
        label: "Shock DoT (8s)",
        damageType: "magic",
        scalingStat: "magicAttack",
        flatBase: 386,
        canCrit: false,
    },
    archery_piercing_shot: {
        kind: "dot",
        label: "Bleed DoT (14s)",
        damageType: "magic",
        scalingStat: "rangedAttack",
        flatBase: 847,
        canCrit: false,
    },
    shadowplay_toxic_shot: {
        kind: "dot",
        label: "Poison DoT (6s)",
        damageType: "magic",
        scalingStat: "rangedAttack",
        flatBase: 406,
        canCrit: false,
    },
    shadowplay_wallop: {
        kind: "bloodthirst_finisher",
        label: "4th-Hit Bloodthirst Finisher",
        damageType: "physical",
        scalingStat: "meleeAttack",
        perStack: 192,
        bonusStacks: 3, // first 3 hits grant +3 Bloodthirst
        canCrit: true,
    },
    shadowplay_stalkers_mark: {
        kind: "mark_expiry",
        label: "Mark Expiry Burst",
        damageType: "physical",
        scalingStat: "rangedAttack",
        perHit: 80,
        defaultHits: 5,
        canCrit: false,
    },
});

function simulateSecondaryEffect(attacker, defender, skill, context, constants) {
    const spec = SECONDARY_SKILL_EFFECTS[skill.id];
    if (!spec) return null;

    const syntheticSkill = {
        ...skill,
        damageType: spec.damageType,
        scalingStat: spec.scalingStat,
    };
    const off = resolveOffenseProfile(attacker, syntheticSkill, constants);
    const def = resolveDefenseProfile(defender, syntheticSkill);

    let rawBase = 0;
    let label = spec.label;
    if (spec.kind === "dot") {
        rawBase = spec.flatBase;
    } else if (spec.kind === "bloodthirst_finisher") {
        const stacks = Math.max(0, Number(context.bloodthirstStacks ?? 0)) + (spec.bonusStacks || 0);
        rawBase = stacks * spec.perStack;
        label = `${spec.label} (${stacks}x BT)`;
    } else if (spec.kind === "mark_expiry") {
        const perHit = spec.perHit + (attacker?._activeBuffFlags?.lifeEnlightenment ? 10 : 0);
        const hits = Math.max(1, Number(context.stalkersMarkHits ?? spec.defaultHits));
        rawBase = perHit * hits;
        label = `${spec.label} (${hits} hits × ${perHit})`;
    }
    if (rawBase <= 0) return null;

    const skillDmgMult = 1 + off.skillDamagePct / 100;
    const preMit = rawBase * skillDmgMult;
    const effDef = Math.max(0, def.defense - off.defPen);
    const defMult = defenseMultiplier(effDef, constants.defenseK);
    const toughMult = context.isPvE ? 1 : toughnessMultiplier(def.toughness, constants.toughnessK);
    const totalRecvDr = def.receivedDrPct + (context.isPvE ? Number(defender.pveReceivedDrPct) || 0 : 0);
    const recDrMult = Math.max(0, 1 - totalRecvDr / 100);

    const normal = Math.max(constants.minFinalDamage, preMit * defMult * toughMult * recDrMult);
    let crit = normal;
    let expected = normal;
    if (spec.canCrit) {
        const resCR = context.isPvE ? 0 : resilienceCritRateReductionPct(def.resilience, constants.resilienceCritRateK);
        const resCB = context.isPvE ? 0 : resilienceCritBonusReductionPct(def.resilience, constants.resilienceCritBonusK);
        const effCR = clamp(off.critRatePct - resCR, 0, 100);
        const effCB = Math.max(constants.minEffectiveCritBonusPct, Math.min(constants.maxCritBonusPct, off.critBonusPct) - resCB);
        crit = normal * (1 + effCB / 100);
        expected = normal * (1 - effCR / 100) + crit * (effCR / 100);
    }

    return {
        label,
        shortLabel: spec.kind === "dot" ? "DoT" : "Finisher",
        kind: spec.kind,
        damageType: spec.damageType,
        canCrit: Boolean(spec.canCrit),
        rawBase,
        normal,
        crit,
        expected,
    };
}

/**
 * Simulate a skill (single-hit or multi-hit) from attacker against defender.
 */
export function simulateSkillDamage(attacker, defender, skill, context = {}, customConstants = {}) {
    const constants = mergeConstants(customConstants);
    const {
        skill: rankedSkill,
        selectedRank,
        selectedRankLabel,
        availableRanks,
    } = resolveSkillRank(skill, getRequestedRankFromContext(skill, context));

    const effAttacker =
        context.attackerModifiers || (attacker?.skillBuild && !attacker?._skillBuildApplied)
            ? applyModifiers(attacker, context.attackerModifiers || [])
            : attacker;
    const effDefender =
        context.defenderModifiers || (defender?.skillBuild && !defender?._skillBuildApplied)
            ? applyModifiers(defender, context.defenderModifiers || [])
            : defender;

    const repeatCount = Math.max(1, Number(rankedSkill.repeatCount) || 1);
    let hitSpecs;
    if (Array.isArray(rankedSkill.hits) && rankedSkill.hits.length > 0) {
        hitSpecs = rankedSkill.hits;
    } else if (repeatCount > 1) {
        hitSpecs = Array.from({ length: repeatCount }, (_, i) => ({
            ...rankedSkill,
            label: `Hit ${i + 1}`,
        }));
    } else {
        hitSpecs = [rankedSkill];
    }

    const perHit = hitSpecs.map((h) =>
        simulateSingleHit(effAttacker, effDefender, rankedSkill, h, context, constants)
    );

    const secondary = context.includeSecondaryEffects
        ? simulateSecondaryEffect(effAttacker, effDefender, rankedSkill, context, constants)
        : null;

    const totalNormal = perHit.reduce((sum, h) => sum + h.normal, 0) + (secondary ? secondary.normal : 0);
    const totalCrit = perHit.reduce((sum, h) => sum + h.crit, 0) + (secondary ? secondary.crit : 0);
    const totalBlocked = perHit.reduce((sum, h) => sum + h.blocked, 0);
    const totalExpected = perHit.reduce((sum, h) => sum + h.expected, 0) + (secondary ? secondary.expected : 0);
    const defenderMaxHp = Math.max(1, Number(effDefender.maxHealth) || 1);

    // Average DPS calculation (factoring in Accuracy, Avoidance, Crits, per-skill GCD / No-GCD, Cast Time, and Cooldown)
    const dps = resolveSkillTiming(rankedSkill, effAttacker, totalExpected, constants, context);

    return {
        skillId: rankedSkill.id,
        skillName: rankedSkill.name,
        skillset: rankedSkill.skillset,
        variant: rankedSkill.variant || "base",
        selectedRank,
        selectedRankLabel,
        availableRanks,
        description: rankedSkill.description || "",
        kind: "damage",
        damageType: rankedSkill.damageType,
        scalingStat: rankedSkill.scalingStat,
        hitCount: perHit.length,
        normal: totalNormal,
        crit: totalCrit,
        blocked: totalBlocked,
        expected: totalExpected,
        secondary,
        dps,
        pctOfDefenderHp: {
            normal: (totalNormal / defenderMaxHp) * 100,
            crit: (totalCrit / defenderMaxHp) * 100,
            expected: (totalExpected / defenderMaxHp) * 100,
        },
        perHit,
        breakdown: perHit[0].breakdown,
    };
}
