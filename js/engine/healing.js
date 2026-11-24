/**
 * ArcheAge Classic 1.3.6 Single-Skill Healing Engine.
 * Pure math (zero DOM dependencies). Computes Normal Heal, Crit Heal,
 * Expected (Average) Heal, % of Target Max HP, and supports anti-heal debuffs
 * and multi-cast skills like Fervent Healing (casts 1-5).
 */

import { mergeConstants } from "./constants.js";
import { evaluateManualComboStatuses } from "./combos.js";
import { getEquipmentSkillBonus } from "./gearswap.js";
import { getRequestedRankFromContext, resolveSkillRank } from "./skills.js";
import { applyModifiers, clamp, resolveSkillTiming } from "./stats.js";

function simulateSingleHealHit(caster, target, skill, hitSpec, context, constants) {
    const off = caster.offense || {};
    const def = target.defense || {};
    const flags = skill.flags || {};

    const healingPower = Number(off.healingPower) || 0;
    const rawBase = Number(hitSpec.base) || 0;
    const rawScalingPct = Number(hitSpec.scalingPct) || 0;

    // Optional Mettle contribution (e.g. Revitalizing Cheer: +50% of stacked Mettle)
    const mettleBonus =
        flags.mettleScalePct && context.mettleStacks
            ? Number(context.mettleStacks) * (flags.mettleScalePct / 100)
            : 0;

    const rawHeal = rawBase + healingPower * (rawScalingPct / 100) + mettleBonus;

    // Outgoing healing multiplier, skill-specific lunagems & combo multiplier (e.g. Resurgence -> Mend +30%)
    const skillGem = getEquipmentSkillBonus(caster, skill);
    const manualCombo = evaluateManualComboStatuses(skill, context.targetStatuses);
    const totalComboBonusPct = (Number(context.comboBonusPct) || 0) + manualCombo.comboBonusPct;

    const outgoingHealingPct =
        (Number(off.healingPct) || 0) + (Number(context.bonusHealingPct) || 0);
    const outgoingMult = Math.max(0, 1 + outgoingHealingPct / 100);
    const skillGemMult = Math.max(0, 1 + skillGem.healingPct / 100);
    const comboMult = Math.max(0, 1 + totalComboBonusPct / 100);

    // Target received healing % + anti-heal debuffs (e.g. Stalker's Mark -60%, Mirror Light -30%)
    const receivedHealingPct =
        (Number(def.receivedHealingPct) || 0) + (Number(context.antiHealPct) || 0);
    const receivedMult = Math.max(0, 1 + receivedHealingPct / 100);

    const normalHeal = rawHeal * outgoingMult * skillGemMult * comboMult * receivedMult;

    // Friendly heals are NOT reduced by target Resilience
    const critRatePct = clamp(
        (Number(off.healCritRatePct) || 0) + (Number(context.bonusCritRatePct) || 0) + skillGem.critRatePct,
        0,
        100
    );
    const critBonusPct = Math.min(
        constants.maxCritBonusPct,
        Math.max(
            0,
            (Number(off.healCritBonusPct) || 0) + (Number(context.bonusCritDamagePct) || 0) + skillGem.critBonusPct
        )
    );
    const critMult = 1 + critBonusPct / 100;

    const critHeal = normalHeal * critMult;
    const expectedHeal =
        normalHeal * (1 - critRatePct / 100) + critHeal * (critRatePct / 100);

    return {
        label: hitSpec.label || skill.name,
        skillId: hitSpec.skillId ?? skill.skillId,
        normal: normalHeal,
        crit: critHeal,
        expected: expectedHeal,
        breakdown: {
            rawBase,
            rawScalingPct,
            healingPower,
            mettleBonus,
            rawHeal,
            outgoingHealingPct,
            skillGemBonusPct: skillGem.healingPct,
            skillGemSummary: skillGem.summary,
            comboBonusPct: totalComboBonusPct,
            comboLabels: manualCombo.matchedLabels,
            receivedHealingPct,
            critRatePct,
            critBonusPct,
        },
    };
}

/**
 * Simulate a healing skill (single cast or multi-cast like Fervent Healing)
 * from caster onto target.
 */
export function simulateSkillHeal(caster, target, skill, context = {}, customConstants = {}) {
    const constants = mergeConstants(customConstants);
    const {
        skill: rankedSkill,
        selectedRank,
        selectedRankLabel,
        availableRanks,
    } = resolveSkillRank(skill, getRequestedRankFromContext(skill, context));

    const effCaster =
        context.attackerModifiers || (caster?.skillBuild && !caster?._skillBuildApplied)
            ? applyModifiers(caster, context.attackerModifiers || [])
            : caster;
    const effTarget =
        context.defenderModifiers || (target?.skillBuild && !target?._skillBuildApplied)
            ? applyModifiers(target, context.defenderModifiers || [])
            : target;

    const repeatCount = Math.max(1, Number(rankedSkill.repeatCount) || 1);
    let hitSpecs;
    if (Array.isArray(rankedSkill.hits) && rankedSkill.hits.length > 0) {
        hitSpecs = rankedSkill.hits;
    } else if (repeatCount > 1) {
        hitSpecs = Array.from({ length: repeatCount }, (_, i) => ({
            ...rankedSkill,
            label: `Cast ${i + 1}`,
        }));
    } else {
        hitSpecs = [rankedSkill];
    }

    const perHit = hitSpecs.map((h) =>
        simulateSingleHealHit(effCaster, effTarget, rankedSkill, h, context, constants)
    );

    const totalNormal = perHit.reduce((sum, h) => sum + h.normal, 0);
    const totalCrit = perHit.reduce((sum, h) => sum + h.crit, 0);
    const totalExpected = perHit.reduce((sum, h) => sum + h.expected, 0);
    const targetMaxHp = Math.max(1, Number(effTarget.maxHealth) || 1);

    const dps = resolveSkillTiming(rankedSkill, effCaster, totalExpected, constants, context);

    return {
        skillId: rankedSkill.id,
        skillName: rankedSkill.name,
        skillset: rankedSkill.skillset,
        variant: rankedSkill.variant || "base",
        selectedRank,
        selectedRankLabel,
        availableRanks,
        description: rankedSkill.description || "",
        kind: "heal",
        damageType: "heal",
        scalingStat: "healingPower",
        hitCount: perHit.length,
        normal: totalNormal,
        crit: totalCrit,
        expected: totalExpected,
        dps,
        pctOfTargetHp: {
            normal: (totalNormal / targetMaxHp) * 100,
            crit: (totalCrit / targetMaxHp) * 100,
            expected: (totalExpected / targetMaxHp) * 100,
        },
        perHit,
        breakdown: perHit[0].breakdown,
    };
}
