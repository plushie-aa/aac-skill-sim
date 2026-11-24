/**
 * ArcheAge Classic 1.3.6 Effective Stats Calculator.
 * Pure math (zero DOM dependencies).
 *
 * Computes:
 *  - Effective Offense Power: Melee / Ranged / Magic Effective Attack (self & vs opponent),
 *    Effective Healing Power (expected, cast-speed adjusted, and target received-healing adjusted),
 *    and Effective Speed (Attack Speed GCD & Cast Speed multiplier).
 *  - Effective Defense / Survivability (EHP): Melee / Ranged / Magic Effective HP (neutral & vs opponent),
 *    Total Damage Reduction %, Avoidance %, Resilience Crit Defense, and Healing Received Efficiency.
 */

import { mergeConstants } from "./constants.js";
import {
    attackSpeedGcdPct,
    clamp,
    defenseMitigationPct,
    defenseMultiplier,
    effectiveGcdSec,
    focusAvoidanceNegationPct,
    resilienceCritBonusReductionPct,
    resilienceCritRateReductionPct,
    toughnessMitigationPct,
    toughnessMultiplier,
} from "./stats.js";

function computeAvoidanceAllocation({
    kind,
    evasionPct,
    parryPct,
    rangedParryPct,
    blockPct,
    hasShield,
    dualWieldRangedParry,
    focus,
    disableAvoidance,
    constants,
}) {
    const isMagic = kind === "magic";
    if (isMagic || disableAvoidance) {
        return {
            evadePct: 0,
            parryPct: 0,
            blockPct: 0,
            totalAvoidancePct: 0,
            rEvade: 0,
            rParry: 0,
            rBlock: 0,
            rConnect: 1,
        };
    }
    const focusNeg = focusAvoidanceNegationPct(focus, constants.focusNegationPctPerPoint);
    const ev = Number(evasionPct) > 0 ? Math.max(0, Number(evasionPct) - focusNeg) : 0;
    const canParry = kind === "melee" || Boolean(dualWieldRangedParry || Number(rangedParryPct) > 0);
    const parryVal =
        kind === "ranged" && Number(rangedParryPct) > 0 ? Number(rangedParryPct) : Number(parryPct) || 0;
    const pa = canParry && parryVal > 0 ? Math.max(0, parryVal - focusNeg) : 0;
    const bl = Boolean(hasShield) && Number(blockPct) > 0 ? Math.max(0, Number(blockPct) - focusNeg) : 0;

    // Exact same priority allocation as damage.js: Evade -> Parry -> Block
    let rEvade = 0;
    let rParry = 0;
    let rBlock = 0;
    let rem = 1.0;
    if (constants.avoidanceModel === "multiplicative") {
        const pEv = clamp(ev / 100, 0, 1);
        const pPa = clamp(pa / 100, 0, 1);
        const pBl = clamp(bl / 100, 0, 1);
        rEvade = pEv;
        rem *= 1 - pEv;
        rParry = rem * pPa;
        rem *= 1 - pPa;
        rBlock = rem * pBl;
        rem *= 1 - pBl;
    } else {
        rEvade = Math.min(rem, ev / 100);
        rem -= rEvade;
        rParry = Math.min(rem, pa / 100);
        rem -= rParry;
        rBlock = Math.min(rem, bl / 100);
        rem -= rBlock;
    }
    const rConnect = Math.max(0, rem);

    return {
        evadePct: rEvade * 100,
        parryPct: rParry * 100,
        blockPct: rBlock * 100,
        totalAvoidancePct: Math.min(100, (rEvade + rParry + rBlock) * 100),
        rEvade,
        rParry,
        rBlock,
        rConnect,
    };
}

function computeOffenseEffectiveLine({
    baseAttack,
    skillDmgPct,
    critRatePct,
    critBonusPct,
    accuracyPct,
    defPen,
    shieldDefPenRatePct,
    shieldDefPenPct,
    focus,
    kind, // "melee" | "ranged" | "magic"
    opponent,
    constants,
    isPvE,
    disableAvoidance,
}) {
    const atk = Math.max(0, Number(baseAttack) || 0);
    const skillMult = Math.max(0, 1 + (Number(skillDmgPct) || 0) / 100);
    const rawCr = Math.max(0, Number(critRatePct) || 0);
    const cr = clamp(rawCr, 0, 100);
    const cb = clamp(Number(critBonusPct) || 0, 0, constants.maxCritBonusPct);
    const acc = clamp(Number(accuracyPct ?? 100), 0, 100);
    const selfCritMult = 1 + (cr / 100) * (cb / 100);
    const selfEffectiveAttack = atk * skillMult * selfCritMult * (acc / 100);

    let vsTargetEffectiveAttack = selfEffectiveAttack;
    let vsTargetMitPct = 0;
    let vsTargetAvoidPct = 0;
    let vsTargetEffCritRatePct = cr;
    let vsTargetEffCritBonusPct = cb;

    if (opponent && opponent.defense) {
        const d = opponent.defense;
        const isMagic = kind === "magic";
        const hasShield =
            typeof d.hasShield === "boolean"
                ? d.hasShield
                : Number(d.shieldPhysicalDefense) > 0 || Number(d.blockPct) > 0;
        const rawDef = isMagic ? Number(d.magicDefense) || 0 : Number(d.physicalDefense) || 0;
        const effDef = Math.max(0, rawDef - (Number(defPen) || 0));
        const defMultNormal = defenseMultiplier(effDef, constants.defenseK);

        const shieldDef = !isMagic && hasShield ? Number(d.shieldPhysicalDefense) || 0 : 0;
        const spRate = !isMagic && shieldDef > 0 ? clamp(Number(shieldDefPenRatePct) || 0, 0, 100) / 100 : 0;
        const spPct = !isMagic && shieldDef > 0 ? Math.max(0, Number(shieldDefPenPct) || 0) : 0;
        const effDefSp = Math.max(0, rawDef - (Number(defPen) || 0) - shieldDef * (spPct / 100));
        const defMult =
            spRate > 0 && spPct > 0
                ? (1 - spRate) * defMultNormal + spRate * defenseMultiplier(effDefSp, constants.defenseK)
                : defMultNormal;

        const toughMult = isPvE ? 1 : toughnessMultiplier(d.toughness, constants.toughnessK);
        const rawRecDr =
            (kind === "melee"
                ? Number(d.receivedMeleeDrPct) || 0
                : kind === "ranged"
                  ? Number(d.receivedRangedDrPct) || 0
                  : Number(d.receivedMagicDrPct) || 0) +
            (isPvE ? Number(opponent.pveReceivedDrPct) || 0 : 0);
        const recDrMult = Math.max(0, 1 - rawRecDr / 100);

        const resCR = isPvE ? 0 : resilienceCritRateReductionPct(d.resilience, constants.resilienceCritRateK);
        const resCB = isPvE ? 0 : resilienceCritBonusReductionPct(d.resilience, constants.resilienceCritBonusK);
        vsTargetEffCritRatePct = clamp(rawCr - resCR, 0, 100);
        vsTargetEffCritBonusPct = Math.max(constants.minEffectiveCritBonusPct, cb - resCB);
        const targetCritMult = 1 + (vsTargetEffCritRatePct / 100) * (vsTargetEffCritBonusPct / 100);

        // Exact AA Classic avoidance + Shield Block (0.0x in AA Classic 3.5: total negation)
        const av = computeAvoidanceAllocation({
            kind,
            evasionPct: d.evasionPct,
            parryPct: d.parryPct,
            rangedParryPct: d.rangedParryPct,
            blockPct: d.blockPct,
            hasShield,
            dualWieldRangedParry: d.dualWieldRangedParry,
            focus,
            disableAvoidance,
            constants,
        });
        vsTargetAvoidPct = av.totalAvoidancePct;

        const expectedHitFactor =
            (acc / 100) * (av.rConnect * targetCritMult + av.rBlock * constants.shieldBlockDamageMultiplier);
        const totalMitMult = defMult * toughMult * recDrMult;
        vsTargetMitPct = (1 - totalMitMult) * 100;
        vsTargetEffectiveAttack = atk * skillMult * totalMitMult * expectedHitFactor;
    }

    return {
        baseAttack: atk,
        skillDmgPct: Number(skillDmgPct) || 0,
        critRatePct: cr,
        critBonusPct: cb,
        accuracyPct: acc,
        selfEffectiveAttack,
        vsTargetEffectiveAttack,
        vsTargetMitPct,
        vsTargetAvoidPct,
        vsTargetEffCritRatePct,
        vsTargetEffCritBonusPct,
    };
}

function computeDefenseEhpLine({
    maxHealth,
    defense,
    shieldPhysicalDefense,
    toughness,
    resilience,
    receivedDrPct,
    pveReceivedDrPct,
    evasionPct,
    parryPct,
    rangedParryPct,
    blockPct,
    hasShield,
    dualWieldRangedParry,
    kind, // "melee" | "ranged" | "magic"
    attacker,
    constants,
    isPvE,
    disableAvoidance,
    flameEnlightenment = false,
}) {
    const hp = Math.max(1, Number(maxHealth) || 1);
    const isMagic = kind === "magic";
    const resolvedHasShield =
        typeof hasShield === "boolean"
            ? hasShield
            : Number(shieldPhysicalDefense) > 0 || Number(blockPct) > 0;
    const effShieldDef = !isMagic && resolvedHasShield ? Number(shieldPhysicalDefense) || 0 : 0;

    const calcFor = (defPen, spRatePct, spPct, focus, attCritRate, attCritBonus, attAcc) => {
        const effDef = Math.max(0, (Number(defense) || 0) - defPen);
        const defMultNormal = defenseMultiplier(effDef, constants.defenseK);
        const defMitPct = defenseMitigationPct(effDef, constants.defenseK);

        const spRate = !isMagic && effShieldDef > 0 ? clamp(spRatePct || 0, 0, 100) / 100 : 0;
        const ignoredShield = spRate > 0 && spPct > 0 ? effShieldDef * (spPct / 100) : 0;
        const effDefSp = Math.max(0, (Number(defense) || 0) - defPen - ignoredShield);
        const defMult =
            spRate > 0 && spPct > 0
                ? (1 - spRate) * defMultNormal + spRate * defenseMultiplier(effDefSp, constants.defenseK)
                : defMultNormal;

        const toughMult = isPvE ? 1 : toughnessMultiplier(toughness, constants.toughnessK);
        const toughMitPct = isPvE ? 0 : toughnessMitigationPct(toughness, constants.toughnessK);
        const recDr = (Number(receivedDrPct) || 0) + (isPvE ? Number(pveReceivedDrPct) || 0 : 0);
        const recDrMult = Math.max(0.01, 1 - recDr / 100);

        const av = computeAvoidanceAllocation({
            kind,
            evasionPct,
            parryPct,
            rangedParryPct,
            blockPct,
            hasShield: resolvedHasShield,
            dualWieldRangedParry,
            focus,
            disableAvoidance,
            constants,
        });

        // Crit mitigation factor from Resilience when an attacker profile is provided
        let critFactor = 1;
        let effCritRatePct = 0;
        let effCritBonusPct = 0;
        if (attCritRate != null && attCritBonus != null) {
            const resCR = isPvE ? 0 : resilienceCritRateReductionPct(resilience, constants.resilienceCritRateK);
            const resCB = isPvE ? 0 : resilienceCritBonusReductionPct(resilience, constants.resilienceCritBonusK);
            effCritRatePct = clamp(attCritRate - resCR, 0, 100);
            effCritBonusPct = Math.max(
                constants.minEffectiveCritBonusPct,
                Math.min(constants.maxCritBonusPct, attCritBonus) - resCB
            );
            critFactor = 1 + (effCritRatePct / 100) * (effCritBonusPct / 100);
        }

        const pOnTarget = clamp(attAcc / 100, 0.05, 1);
        const mitMult = defMult * toughMult * recDrMult;
        const critHitMult = 1 + effCritBonusPct / 100;
        // Exact damage.js identity: blocked hits deal constants.shieldBlockDamageMultiplier (0.0x in AA Classic 3.5)
        const expectedHitFactor =
            pOnTarget * (av.rConnect * critFactor + av.rBlock * constants.shieldBlockDamageMultiplier);
        const expectedDmgMult = mitMult * expectedHitFactor;
        const noCritDmgMult = mitMult * pOnTarget * (av.rConnect + av.rBlock * constants.shieldBlockDamageMultiplier);
        const critDmgMult =
            mitMult * pOnTarget * (av.rConnect * critHitMult + av.rBlock * constants.shieldBlockDamageMultiplier);

        const mitigationDrPct = (1 - mitMult) * 100;
        const totalDrPct = (1 - noCritDmgMult) * 100;
        const effectiveDrPct = (1 - expectedDmgMult) * 100;
        const ehp = hp / Math.max(0.005, expectedDmgMult);
        const nonCritEhp = hp / Math.max(0.005, noCritDmgMult);
        const critEhp = hp / Math.max(0.005, critDmgMult);

        const flameHealPerAvoid = hp * 0.01;
        const pAvoid = pOnTarget * (av.rEvade + av.rParry + av.rBlock);
        const flameExpectedHealPerHit = Boolean(flameEnlightenment) ? pAvoid * flameHealPerAvoid : 0;

        return {
            ehp,
            nonCritEhp,
            critEhp,
            critHitMult,
            totalDrPct,
            mitigationDrPct,
            effectiveDrPct,
            defMitPct,
            toughMitPct,
            receivedDrPct: recDr,
            avoidancePct: av.totalAvoidancePct,
            evadePct: av.evadePct,
            parryPct: av.parryPct,
            blockPct: av.blockPct,
            critFactor,
            effCritRatePct,
            effCritBonusPct,
            rawDmgMult: noCritDmgMult,
            critDmgMult,
            expectedDmgMult,
            flameEnlightenment: {
                active: Boolean(flameEnlightenment),
                healPerAvoid: Boolean(flameEnlightenment) ? flameHealPerAvoid : 0,
                expectedHealPerHit: flameExpectedHealPerHit,
            },
        };
    };

    const neutral = calcFor(0, 0, 0, 0, null, null, 100);

    let vsAttacker = neutral;
    if (attacker && attacker.offense) {
        const ao = attacker.offense;
        const pen = isMagic ? Number(ao.magicDefensePenetration) || 0 : Number(ao.defensePenetration) || 0;
        const spRate = isMagic ? 0 : Number(ao.shieldDefPenRatePct) || 0;
        const spPct = isMagic ? 0 : Number(ao.shieldDefPenPct) || 0;
        const foc = Number(ao.focus) || 0;
        const cr =
            kind === "melee"
                ? Number(ao.meleeCritRatePct) || 0
                : kind === "ranged"
                  ? Number(ao.rangedCritRatePct) || 0
                  : Number(ao.magicCritRatePct) || 0;
        const cb =
            kind === "melee"
                ? Number(ao.meleeCritBonusPct ?? constants.baseCritBonusPct)
                : kind === "ranged"
                  ? Number(ao.rangedCritBonusPct ?? constants.baseCritBonusPct)
                  : Number(ao.magicCritBonusPct ?? constants.baseCritBonusPct);
        const acc =
            kind === "melee"
                ? Number(ao.meleeAccuracyPct ?? 100)
                : kind === "ranged"
                  ? Number(ao.rangedAccuracyPct ?? 100)
                  : Number(ao.magicAccuracyPct ?? 100);
        vsAttacker = calcFor(pen, spRate, spPct, foc, cr, cb, acc);
    }

    return {
        ehp: neutral.ehp,
        nonCritEhp: neutral.nonCritEhp,
        critEhp: neutral.critEhp,
        vsAttackerEhp: vsAttacker.ehp,
        vsAttackerNonCritEhp: vsAttacker.nonCritEhp,
        vsAttackerCritEhp: vsAttacker.critEhp,
        vsAttackerCritHitMult: vsAttacker.critHitMult,
        totalDrPct: neutral.totalDrPct,
        vsAttackerDrPct: vsAttacker.mitigationDrPct,
        vsAttackerNoCritDrPct: vsAttacker.totalDrPct,
        vsAttackerEffectiveDrPct: vsAttacker.effectiveDrPct,
        vsAttackerCritFactor: vsAttacker.critFactor,
        vsAttackerEffCritRatePct: vsAttacker.effCritRatePct,
        vsAttackerEffCritBonusPct: vsAttacker.effCritBonusPct,
        defMitPct: neutral.defMitPct,
        toughMitPct: neutral.toughMitPct,
        receivedDrPct: neutral.receivedDrPct,
        avoidancePct: neutral.avoidancePct,
        vsAttackerAvoidancePct: vsAttacker.avoidancePct,
        vsAttackerEvadePct: vsAttacker.evadePct,
        vsAttackerParryPct: vsAttacker.parryPct,
        vsAttackerBlockPct: vsAttacker.blockPct,
        rawDmgMult: neutral.rawDmgMult,
        vsAttackerCritDmgMult: vsAttacker.critDmgMult,
        vsAttackerDmgMult: vsAttacker.expectedDmgMult,
        flameEnlightenment: vsAttacker.flameEnlightenment,
    };
}

/**
 * Compute all Effective Offense & Defense stats for a (buffed) character,
 * optionally against an opponent (Target for offense builds, or Attacker for defense builds).
 */
export function computeEffectiveStats(character, opponent = null, customConstants = {}, options = {}) {
    const constants = mergeConstants(customConstants);
    const isPvE = Boolean(options.isPvE);
    const disableAvoidance = Boolean(options.disableAvoidance);
    const off = character?.offense || {};
    const def = character?.defense || {};
    const maxHealth = Math.max(1, Number(character?.maxHealth) || 1);

    const melee = computeOffenseEffectiveLine({
        baseAttack: off.meleeAttack,
        skillDmgPct: off.meleeSkillDamagePct,
        critRatePct: off.meleeCritRatePct,
        critBonusPct: off.meleeCritBonusPct,
        accuracyPct: off.meleeAccuracyPct,
        defPen: off.defensePenetration,
        shieldDefPenRatePct: off.shieldDefPenRatePct,
        shieldDefPenPct: off.shieldDefPenPct,
        focus: off.focus,
        kind: "melee",
        opponent,
        constants,
        isPvE,
        disableAvoidance,
    });

    const ranged = computeOffenseEffectiveLine({
        baseAttack: off.rangedAttack,
        skillDmgPct: off.rangedSkillDamagePct,
        critRatePct: off.rangedCritRatePct,
        critBonusPct: off.rangedCritBonusPct,
        accuracyPct: off.rangedAccuracyPct,
        defPen: off.defensePenetration,
        shieldDefPenRatePct: off.shieldDefPenRatePct,
        shieldDefPenPct: off.shieldDefPenPct,
        focus: off.focus,
        kind: "ranged",
        opponent,
        constants,
        isPvE,
        disableAvoidance,
    });

    const magic = computeOffenseEffectiveLine({
        baseAttack: off.magicAttack,
        skillDmgPct: off.magicSkillDamagePct,
        critRatePct: off.magicCritRatePct,
        critBonusPct: off.magicCritBonusPct,
        accuracyPct: off.magicAccuracyPct,
        defPen: off.magicDefensePenetration,
        shieldDefPenRatePct: 0,
        shieldDefPenPct: 0,
        focus: off.focus,
        kind: "magic",
        opponent,
        constants,
        isPvE,
        disableAvoidance,
    });

    // Effective Healing Power (expected, cast-speed adjusted, and on-target with Target Recv Heal %)
    const baseHpwr = Math.max(0, Number(off.healingPower) || 0);
    const healPct = Number(off.healingPct) || 0;
    const healCR = clamp(Number(off.healCritRatePct) || 0, 0, 100);
    const healCB = clamp(Number(off.healCritBonusPct) || 0, 0, constants.maxCritBonusPct);
    const castTimePct = clamp(Number(off.castTimePct ?? 100), 40, 200);
    const healCritMult = 1 + (healCR / 100) * (healCB / 100);
    const healOutMult = Math.max(0, 1 + healPct / 100);
    const selfEffectiveHealingPower = baseHpwr * healOutMult * healCritMult;
    const castAdjustedHealingPower = selfEffectiveHealingPower / (castTimePct / 100);
    const targetRecvHealPct = Number(opponent?.defense?.receivedHealingPct) || 0;
    const onTargetEffectiveHealingPower =
        selfEffectiveHealingPower * Math.max(0, 1 + targetRecvHealPct / 100);

    // Speed stats
    const attackSpeed = Number(off.attackSpeed ?? 0) || 0;
    const gcdPct = attackSpeedGcdPct(attackSpeed, constants.attackSpeedScale);
    const gcdSec = effectiveGcdSec(attackSpeed, constants.baseGcdSec, constants.attackSpeedScale);
    const speed = {
        attackSpeed,
        attackSpeedGcdPct: gcdPct,
        effectiveGcdSec: gcdSec,
        castTimePct,
        castSpeedMult: 100 / castTimePct,
    };

    // Effective HP (Defense survivability)
    const hasFlameEnlightenment = Boolean(character?._activeBuffFlags?.flameEnlightenment);
    const ehpMelee = computeDefenseEhpLine({
        maxHealth,
        defense: def.physicalDefense,
        shieldPhysicalDefense: def.shieldPhysicalDefense,
        toughness: def.toughness,
        resilience: def.resilience,
        receivedDrPct: def.receivedMeleeDrPct,
        pveReceivedDrPct: character?.pveReceivedDrPct,
        evasionPct: def.evasionPct,
        parryPct: def.parryPct,
        rangedParryPct: def.rangedParryPct,
        blockPct: def.blockPct,
        hasShield: def.hasShield,
        dualWieldRangedParry: def.dualWieldRangedParry,
        kind: "melee",
        attacker: opponent,
        constants,
        isPvE,
        disableAvoidance,
        flameEnlightenment: hasFlameEnlightenment,
    });
    const ehpRanged = computeDefenseEhpLine({
        maxHealth,
        defense: def.physicalDefense,
        shieldPhysicalDefense: def.shieldPhysicalDefense,
        toughness: def.toughness,
        resilience: def.resilience,
        receivedDrPct: def.receivedRangedDrPct,
        pveReceivedDrPct: character?.pveReceivedDrPct,
        evasionPct: def.evasionPct,
        parryPct: def.parryPct,
        rangedParryPct: def.rangedParryPct,
        blockPct: def.blockPct,
        hasShield: def.hasShield,
        dualWieldRangedParry: def.dualWieldRangedParry,
        kind: "ranged",
        attacker: opponent,
        constants,
        isPvE,
        disableAvoidance,
        flameEnlightenment: hasFlameEnlightenment,
    });
    const ehpMagic = computeDefenseEhpLine({
        maxHealth,
        defense: def.magicDefense,
        shieldPhysicalDefense: 0,
        toughness: def.toughness,
        resilience: def.resilience,
        receivedDrPct: def.receivedMagicDrPct,
        pveReceivedDrPct: character?.pveReceivedDrPct,
        evasionPct: 0,
        parryPct: 0,
        rangedParryPct: 0,
        blockPct: 0,
        hasShield: false,
        dualWieldRangedParry: false,
        kind: "magic",
        attacker: opponent,
        constants,
        isPvE,
        disableAvoidance,
    });

    const recvHealPct = Number(def.receivedHealingPct) || 0;
    const healMultiplier = Math.max(0, 1 + recvHealPct / 100);

    return {
        offense: {
            melee,
            ranged,
            magic,
            healing: {
                baseHealingPower: baseHpwr,
                healingPct: healPct,
                critRatePct: healCR,
                critBonusPct: healCB,
                castTimePct,
                selfEffectiveHealingPower,
                castAdjustedHealingPower,
                onTargetEffectiveHealingPower,
                targetRecvHealPct,
            },
            speed,
        },
        defense: {
            maxHealth,
            disableAvoidance,
            ehp: {
                melee: ehpMelee,
                ranged: ehpRanged,
                magic: ehpMagic,
            },
            healingReceived: {
                receivedHealingPct: recvHealPct,
                healMultiplier,
                // Healing efficiency is defender-intrinsic (ignores attacker Def Pen / Focus / Crit)
                effectiveHpPer1kHealMelee: (1000 * healMultiplier) / Math.max(0.01, ehpMelee.rawDmgMult),
                effectiveHpPer1kHealRanged: (1000 * healMultiplier) / Math.max(0.01, ehpRanged.rawDmgMult),
                effectiveHpPer1kHealMagic: (1000 * healMultiplier) / Math.max(0.01, ehpMagic.rawDmgMult),
            },
            critDefense: {
                resilience: Number(def.resilience) || 0,
                critRateReductionPct: isPvE
                    ? 0
                    : resilienceCritRateReductionPct(def.resilience, constants.resilienceCritRateK),
                critBonusReductionPct: isPvE
                    ? 0
                    : resilienceCritBonusReductionPct(def.resilience, constants.resilienceCritBonusK),
            },
        },
    };
}
