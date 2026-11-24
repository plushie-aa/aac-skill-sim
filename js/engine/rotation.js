/**
 * ArcheAge Classic 1.3.6 Rotation / Burst Combo Simulator & Exact Kill Probability Engine.
 * Pure math (zero DOM dependencies).
 *
 * Uses exact discrete probability convolution (binned at 25-unit resolution) across every
 * individual hit in the queued skill sequence to compute:
 *  - Exact Total Expected Damage / Healing, All-Normal Floor, and All-Crit Ceiling
 *  - Exact Kill Probability (or Full Top-Off Probability for healing) against Target Max HP
 *  - Exact P10 / Median (P50) / P90 burst quantiles (zero Monte Carlo jitter)
 *  - Execution timeline driven by each build's real Attack Speed GCD and Cast Time %
 *  - Window DPS / HPS and Time-to-Kill (TTK)
 */

import { mergeConstants } from "./constants.js";
import {
    SKILL_DEBUFF_GRANTS,
    SKILL_STATUS_GRANTS,
    evaluateActiveSkillCombos,
} from "./combos.js";
import { simulateSkillDamage } from "./damage.js";
import { simulateSkillHeal } from "./healing.js";
import { COMBAT_MODIFIERS, applyModifiers, resolveSkillTiming } from "./stats.js";

const PMF_BIN_SIZE = 25;

function convolvePmf(pmf, outcomes) {
    const filtered = outcomes.filter((o) => o.p > 1e-12);
    if (filtered.length === 0) return pmf;

    const next = new Map();
    for (const [bin, pAcc] of pmf.entries()) {
        for (const o of filtered) {
            const deltaBin = Math.round(Math.max(0, o.val) / PMF_BIN_SIZE);
            const targetBin = bin + deltaBin;
            next.set(targetBin, (next.get(targetBin) || 0) + pAcc * o.p);
        }
    }
    return next;
}

function summarizePmf(pmf, targetThreshold) {
    const entries = Array.from(pmf.entries()).sort((a, b) => a[0] - b[0]);
    if (entries.length === 0) {
        return { p10: 0, median: 0, p90: 0, probAtLeastThresholdPct: 0, pmfEntries: [] };
    }

    let cum = 0;
    let p10 = entries[0][0] * PMF_BIN_SIZE;
    let median = entries[0][0] * PMF_BIN_SIZE;
    let p90 = entries[entries.length - 1][0] * PMF_BIN_SIZE;
    let got10 = false;
    let got50 = false;
    let got90 = false;
    let probReach = 0;

    for (const [bin, p] of entries) {
        const val = bin * PMF_BIN_SIZE;
        cum += p;
        if (!got10 && cum >= 0.1) {
            p10 = val;
            got10 = true;
        }
        if (!got50 && cum >= 0.5) {
            median = val;
            got50 = true;
        }
        if (!got90 && cum >= 0.9) {
            p90 = val;
            got90 = true;
        }
        if (val >= targetThreshold) {
            probReach += p;
        }
    }

    return {
        p10,
        median,
        p90,
        probAtLeastThresholdPct: Math.min(100, Math.max(0, probReach * 100)),
    };
}

function getHitOutcomes(hit, isHeal) {
    if (isHeal) {
        const pCrit = Math.min(1, Math.max(0, (Number(hit.breakdown?.critRatePct) || 0) / 100));
        return [
            { val: hit.normal, p: 1 - pCrit },
            { val: hit.crit, p: pCrit },
        ];
    }

    const av = hit.breakdown?.avoidance || {};
    const pConnect = Math.min(1, Math.max(0, (Number(av.connectPct) || 0) / 100));
    const pBlock = Math.min(1, Math.max(0, (Number(av.blockPct) || 0) / 100));
    const pZero = Math.max(0, 1 - pConnect - pBlock);
    const critRate = Math.min(1, Math.max(0, (Number(hit.breakdown?.effectiveCritRatePct) || 0) / 100));
    const pNormal = pConnect * (1 - critRate);
    const pCrit = pConnect * critRate;

    const spChance = Math.min(1, Math.max(0, (Number(hit.breakdown?.shieldPenProcChancePct) || 0) / 100));
    const outcomes = [
        { val: 0, p: pZero },
        { val: hit.blocked || 0, p: pBlock },
    ];

    if (spChance > 0 && hit.normalShieldPen != null && hit.critShieldPen != null) {
        outcomes.push(
            { val: hit.normal, p: pNormal * (1 - spChance) },
            { val: hit.normalShieldPen, p: pNormal * spChance },
            { val: hit.crit, p: pCrit * (1 - spChance) },
            { val: hit.critShieldPen, p: pCrit * spChance }
        );
    } else {
        outcomes.push(
            { val: hit.normal, p: pNormal },
            { val: hit.crit, p: pCrit }
        );
    }

    return outcomes;
}

/**
 * Simulate an ordered skill rotation for one attacker/healer against one target.
 *
 * @param {object} actor - Character stats (unbuffed; modifiers applied via context)
 * @param {object} target - Defender / heal target stats
 * @param {Array<{ skill: object, rank?: number|null, isBackstab?: boolean, targetIsCCd?: boolean, within8m?: boolean, targetBelow30Pct?: boolean, comboBonusPct?: number, delaySec?: number }>} steps
 * @param {object} context - Shared combat context (attackerModifiers, defenderModifiers, bloodthirstStacks, mettleStacks, isPvE, skillRanks, etc.)
 * @param {object} customConstants
 */
export function simulateRotation(actor, target, steps = [], context = {}, customConstants = {}) {
    const constants = mergeConstants(customConstants);
    const effActor = context.attackerModifiers
        ? applyModifiers(actor, context.attackerModifiers)
        : actor;
    const effTarget = context.defenderModifiers
        ? applyModifiers(target, context.defenderModifiers)
        : target;
    const targetMaxHp = Math.max(1, Number(effTarget.maxHealth) || 1);
    const targetAbsorbShield = Math.max(0, Number(context.targetAbsorbShield) || 0);
    const effectiveKillHp = targetMaxHp + targetAbsorbShield;

    // Strip modifiers before per-step calls since we already applied them once
    const stepBaseCtx = {
        ...context,
        attackerModifiers: null,
        defenderModifiers: null,
    };

    const existingAttModIds = new Set(
        (Array.isArray(context.attackerModifiers) ? context.attackerModifiers : []).map((t) =>
            String(t).split(":")[0]
        )
    );

    let elapsedSec = 0;
    let totalNormal = 0;
    let totalCrit = 0;
    let totalExpected = 0;
    let totalDamageExpected = 0;
    let totalHealExpected = 0;
    let killStepIndex = -1;
    let killTimestampSec = null;

    let damagePmf = new Map([[0, 1]]);
    let healPmf = new Map([[0, 1]]);
    let damageStepCount = 0;
    let healStepCount = 0;
    let totalCastTimeSec = 0;
    let totalCastTimeSavedSec = 0;

    // Active cast-time-removing combo buffs, statuses (Resurgence/Shocked/Impaled/Freezing/Slowed/Tripped/Stunned),
    // and target debuffs (Stalker's Mark, Enervate, Dissonance, Wallop) across the timeline
    const activeComboEffects = [];
    const activeStatuses = [];
    const activeDebuffs = [];
    const existingDefModIds = new Set(
        (Array.isArray(context.defenderModifiers) ? context.defenderModifiers : []).map((t) =>
            String(t).split(":")[0]
        )
    );
    const autoCombosEnabled = !context.disableAutoCombos;
    const triggeredCombos = [];
    const stepResults = [];

    for (let i = 0; i < (steps || []).length; i++) {
        const step = steps[i];
        if (!step || !step.skill) continue;

        const skill = step.skill;
        const isUtility = skill.kind === "utility";
        const isHeal = skill.kind === "heal";
        const startSec = elapsedSec;

        // 1. Detect active cast-time-removing combo buff for this skill
        const hasBaseCast = Number(skill.castTimeSec) > 0;
        const activeCastCombo = hasBaseCast
            ? activeComboEffects.find(
                  (eff) =>
                      eff.expiresAtSec > startSec + 1e-6 &&
                      Array.isArray(eff.removesCastTimeFor) &&
                      eff.removesCastTimeFor.includes(skill.id)
              ) || null
            : null;

        // 2. Detect active damage/heal combo multipliers, next-skill crit procs, and auto-CC bypass
        const autoStatusEval = autoCombosEnabled
            ? evaluateActiveSkillCombos(skill, activeStatuses, startSec)
            : { comboBonusPct: 0, bonusCritRatePct: 0, autoCCLabel: null, matchedLabels: [], consumedStatuses: [] };

        // 3. Apply any active rotation-applied target debuffs (e.g. Stalker's Mark, Dissonance, Wallop)
        const liveDebuffs = autoCombosEnabled
            ? activeDebuffs.filter((d) => d.expiresAtSec > startSec + 1e-6 && !existingDefModIds.has(d.id))
            : [];
        let stepTarget = effTarget;
        if (liveDebuffs.length > 0 && !isUtility) {
            const nextDef = { ...(effTarget.defense || {}) };
            for (const deb of liveDebuffs) {
                for (const [k, delta] of Object.entries(deb.addDefense || {})) {
                    nextDef[k] = (Number(nextDef[k]) || 0) + Number(delta);
                }
            }
            if (nextDef.physicalDefense < 0) nextDef.physicalDefense = 0;
            if (nextDef.magicDefense < 0) nextDef.magicDefense = 0;
            stepTarget = { ...effTarget, defense: nextDef };
        }

        const manualInstant = step.noCastTime === true;
        const removeCastTime =
            hasBaseCast &&
            (Boolean(step.offGcd) ||
                manualInstant ||
                (Boolean(activeCastCombo) && step.noCastTime !== false));
        const castRemovedBy = removeCastTime
            ? Boolean(step.offGcd)
                ? "Off-GCD"
                : activeCastCombo
                  ? activeCastCombo.label
                  : "Manual Instant"
            : null;

        const comboGcdOverride =
            activeCastCombo &&
            step.gcdOverrideSec == null &&
            activeCastCombo.overrideGcdSecBySkill &&
            activeCastCombo.overrideGcdSecBySkill[skill.id] != null
                ? Number(activeCastCombo.overrideGcdSecBySkill[skill.id])
                : null;

        const manualComboPct =
            step.comboBonusPct != null
                ? Number(step.comboBonusPct) || 0
                : Number(stepBaseCtx.comboBonusPct) || 0;
        const effectiveComboPct = manualComboPct + autoStatusEval.comboBonusPct;
        const baseIsCCd = step.targetIsCCd != null ? Boolean(step.targetIsCCd) : Boolean(stepBaseCtx.targetIsCCd);
        const effectiveIsCCd = baseIsCCd || Boolean(autoStatusEval.autoCCLabel);
        const stepIsBackstab = step.isBackstab != null ? Boolean(step.isBackstab) : Boolean(stepBaseCtx.isBackstab);

        const stepCtx = {
            ...stepBaseCtx,
            isBackstab: stepIsBackstab,
            targetIsCCd: effectiveIsCCd,
            within8m: step.within8m != null ? Boolean(step.within8m) : Boolean(stepBaseCtx.within8m),
            targetBelow30Pct:
                step.targetBelow30Pct != null ? Boolean(step.targetBelow30Pct) : Boolean(stepBaseCtx.targetBelow30Pct),
            comboBonusPct: effectiveComboPct,
            targetStatuses: [],
            bonusCritRatePct: (Number(stepBaseCtx.bonusCritRatePct) || 0) + autoStatusEval.bonusCritRatePct,
            offGcd: Boolean(step.offGcd),
            removeCastTime,
            castRemovedBy,
            ...(step.gcdOverrideSec != null && step.gcdOverrideSec !== ""
                ? { gcdOverrideSec: Number(step.gcdOverrideSec) }
                : comboGcdOverride != null
                  ? { gcdOverrideSec: comboGcdOverride }
                  : {}),
            ...(step.rank != null ? { skillRank: step.rank } : {}),
        };

        // Optional per-step weapon proc (e.g. Staff +10k M.Pen on Arc Lightning only)
        const stepProcId =
            step.weaponProc && COMBAT_MODIFIERS[step.weaponProc] ? String(step.weaponProc) : null;
        const stepProcMod = stepProcId ? COMBAT_MODIFIERS[stepProcId] : null;
        const stepActor =
            stepProcId && !existingAttModIds.has(stepProcId)
                ? applyModifiers(effActor, [stepProcId])
                : effActor;

        let res;
        if (isUtility) {
            const dps = resolveSkillTiming(skill, stepActor, 0, constants, stepCtx);
            res = {
                skillId: skill.id,
                skillName: skill.name,
                skillset: skill.skillset,
                variant: skill.variant || "base",
                selectedRank: 1,
                selectedRankLabel: "Rank 1",
                availableRanks: 1,
                description: skill.description || "",
                kind: "utility",
                damageType: "utility",
                scalingStat: skill.scalingStat || "magicAttack",
                hitCount: 0,
                normal: 0,
                crit: 0,
                expected: 0,
                dps,
                perHit: [],
                breakdown: {},
            };
        } else {
            res = isHeal
                ? simulateSkillHeal(stepActor, stepTarget, skill, stepCtx, constants)
                : simulateSkillDamage(stepActor, stepTarget, skill, stepCtx, constants);
        }

        const extraDelay = Math.max(0, Number(step.delaySec) || 0);
        const baseExecSec =
            res.dps && Number.isFinite(res.dps.execTimeSec)
                ? Math.max(0, res.dps.execTimeSec)
                : constants.baseGcdSec || 1.0;
        const execSec = baseExecSec + extraDelay;
        const castSec = Number(res.dps?.effectiveCastTimeSec) || 0;
        const postGcdSec = Number(res.dps?.postCastDelaySec) || 0;
        const castEndSec = startSec + castSec;
        const endSec = startSec + execSec;
        elapsedSec = endSec;

        totalCastTimeSec += castSec;
        if (res.dps?.castTimeRemoved && res.dps.castTimeSavedSec > 0) {
            totalCastTimeSavedSec += res.dps.castTimeSavedSec;
            triggeredCombos.push({
                stepIndex: stepResults.length,
                skillId: skill.id,
                skillName: skill.name,
                by: res.dps.castRemovedBy,
                savedSec: res.dps.castTimeSavedSec,
            });
        }

        // Consume single-use status buffs (e.g. Gale Overwhelm +100% Crit)
        if (autoStatusEval.consumedStatuses.length > 0) {
            for (const cName of autoStatusEval.consumedStatuses) {
                const idx = activeStatuses.findIndex((st) => st.status === cName);
                if (idx >= 0) activeStatuses.splice(idx, 1);
            }
        }

        // Register any cast-time-removing combo buff granted by this skill (active from endSec)
        if (skill.comboEffect && Number(skill.comboEffect.durationSec) > 0) {
            const effId = skill.comboEffect.id || skill.id;
            const prevIdx = activeComboEffects.findIndex((e) => e.id === effId);
            const nextEff = {
                ...skill.comboEffect,
                id: effId,
                sourceSkillId: skill.id,
                startedAtSec: endSec,
                expiresAtSec: endSec + Number(skill.comboEffect.durationSec),
            };
            if (prevIdx >= 0) activeComboEffects[prevIdx] = nextEff;
            else activeComboEffects.push(nextEff);
        }

        // Register status effects granted by this skill (active from castEndSec / impact)
        const grantedStatuses = [];
        if (autoCombosEnabled) {
            const grants = SKILL_STATUS_GRANTS[skill.id] || [];
            const liveStatusSet = new Set(
                activeStatuses.filter((st) => st.expiresAtSec > startSec + 1e-6).map((st) => st.status)
            );
            for (const g of grants) {
                if (g.requiresBackstab && !stepIsBackstab) continue;
                if (Array.isArray(g.requiresAny) && !g.requiresAny.some((req) => liveStatusSet.has(req))) {
                    continue;
                }
                const impactAt = castSec > 0 ? castEndSec : endSec;
                const prevIdx = activeStatuses.findIndex((st) => st.status === g.status);
                const nextSt = {
                    ...g,
                    sourceSkillId: skill.id,
                    startedAtSec: impactAt,
                    expiresAtSec: impactAt + Number(g.durationSec || 0),
                };
                if (prevIdx >= 0) activeStatuses[prevIdx] = nextSt;
                else activeStatuses.push(nextSt);
                grantedStatuses.push(g.label);
            }

            const debGrant = SKILL_DEBUFF_GRANTS[skill.id];
            if (debGrant) {
                const impactAt = castSec > 0 ? castEndSec : endSec;
                const prevIdx = activeDebuffs.findIndex((d) => d.id === debGrant.id);
                const nextDeb = {
                    ...debGrant,
                    sourceSkillId: skill.id,
                    startedAtSec: impactAt,
                    expiresAtSec: impactAt + Number(debGrant.durationSec || 0),
                };
                if (prevIdx >= 0) activeDebuffs[prevIdx] = nextDeb;
                else activeDebuffs.push(nextDeb);
                grantedStatuses.push(debGrant.label);
            }
        }

        if (!isUtility) {
            totalNormal += res.normal;
            totalCrit += res.crit;
            totalExpected += res.expected;

            if (isHeal) {
                healStepCount++;
                totalHealExpected += res.expected;
                for (const h of res.perHit || []) {
                    healPmf = convolvePmf(healPmf, getHitOutcomes(h, true));
                }
            } else {
                damageStepCount++;
                totalDamageExpected += res.expected;
                for (const h of res.perHit || []) {
                    damagePmf = convolvePmf(damagePmf, getHitOutcomes(h, false));
                }
                if (killStepIndex < 0 && totalDamageExpected >= effectiveKillHp) {
                    killStepIndex = stepResults.length;
                    killTimestampSec = castSec > 0 ? castEndSec : endSec;
                }
            }
        }

        stepResults.push({
            index: stepResults.length,
            skill,
            step,
            result: res,
            isHeal,
            isUtility,
            weaponProcId: stepProcId,
            weaponProcLabel: stepProcMod
                ? `${stepProcMod.name.split(" (")[0]}${stepProcMod.shortEffect ? ` (${stepProcMod.shortEffect})` : ""}`
                : null,
            startSec,
            castEndSec,
            endSec,
            castSec,
            postGcdSec,
            durationSec: execSec,
            castTimeRemoved: Boolean(res.dps?.castTimeRemoved),
            castTimeSavedSec: Number(res.dps?.castTimeSavedSec) || 0,
            castRemovedBy: res.dps?.castRemovedBy || null,
            autoComboTriggered: Boolean(activeCastCombo && removeCastTime && !step.offGcd),
            autoComboBonusPct: autoStatusEval.comboBonusPct,
            autoComboLabels: autoStatusEval.matchedLabels,
            autoCCLabel: !baseIsCCd ? autoStatusEval.autoCCLabel : null,
            activeDebuffLabels: liveDebuffs.map((d) => d.label),
            grantedStatuses,
            grantedComboEffect: skill.comboEffect || null,
            cumulativeExpected: isHeal ? totalHealExpected : totalDamageExpected,
        });
    }

    const mode = healStepCount > 0 && damageStepCount === 0 ? "heal" : "damage";
    const primaryExpected = mode === "heal" ? totalHealExpected : totalDamageExpected;
    const primaryPmf = mode === "heal" ? healPmf : damagePmf;
    const distThreshold = mode === "damage" ? effectiveKillHp : targetMaxHp;
    const dist = summarizePmf(primaryPmf, distThreshold);
    const totalDurationSec = Math.max(0, elapsedSec);
    const windowRate = totalDurationSec > 0 ? primaryExpected / totalDurationSec : 0;
    const pctOfTargetHp = (primaryExpected / targetMaxHp) * 100;
    const estimatedTtkSec = mode === "damage" && windowRate > 0 ? effectiveKillHp / windowRate : null;

    return {
        mode,
        stepCount: stepResults.length,
        steps: stepResults,
        totalDurationSec,
        totalCastTimeSec,
        totalCastTimeSavedSec,
        triggeredCombos,
        totalNormal,
        totalCrit,
        totalExpected: primaryExpected,
        totalDamageExpected,
        totalHealExpected,
        windowRate, // Window DPS (damage) or Window HPS (heal)
        pctOfTargetHp,
        targetMaxHp,
        targetAbsorbShield,
        effectiveKillHp: distThreshold,
        killProbPct: dist.probAtLeastThresholdPct, // Kill probability (damage) or 100% top-off prob (heal)
        quantiles: {
            p10: dist.p10,
            median: dist.median,
            p90: dist.p90,
        },
        killStepIndex,
        killTimestampSec,
        estimatedTtkSec,
    };
}

/**
 * Side-by-side rotation comparison between Build A and Build B against one target.
 */
export function compareRotations(buildA, buildB, target, steps, contextA = {}, contextB = {}, customConstants = {}) {
    const resultA = simulateRotation(buildA, target, steps, contextA, customConstants);
    const resultB = simulateRotation(buildB, target, steps, contextB, customConstants);
    const deltaExpected = resultA.totalExpected - resultB.totalExpected;
    const deltaExpectedPct = resultB.totalExpected > 0 ? (deltaExpected / resultB.totalExpected) * 100 : 0;
    const deltaRate = resultA.windowRate - resultB.windowRate;
    const deltaRatePct = resultB.windowRate > 0 ? (deltaRate / resultB.windowRate) * 100 : 0;
    const winner =
        Math.abs(deltaExpected) < 1e-6 ? "tie" : deltaExpected > 0 ? "A" : "B";

    return {
        resultA,
        resultB,
        deltaExpected,
        deltaExpectedPct,
        deltaRate,
        deltaRatePct,
        winner,
    };
}

/**
 * Side-by-side defensive combo/rotation comparison:
 * One Attacker executes the exact same skill sequence against Defender A vs Defender B.
 */
export function compareDefendersRotation(
    attacker,
    defenderA,
    defenderB,
    steps,
    contextVsA = {},
    contextVsB = {},
    customConstants = {}
) {
    const resultVsA = simulateRotation(attacker, defenderA, steps, contextVsA, customConstants);
    const resultVsB = simulateRotation(attacker, defenderB, steps, contextVsB, customConstants);

    const hpPctA = resultVsA.pctOfTargetHp;
    const hpPctB = resultVsB.pctOfTargetHp;
    const deltaExpected = resultVsA.totalExpected - resultVsB.totalExpected;
    const deltaExpectedPct = resultVsB.totalExpected > 0 ? (deltaExpected / resultVsB.totalExpected) * 100 : 0;
    const deltaHpPct = hpPctB > 0 ? ((hpPctA - hpPctB) / hpPctB) * 100 : 0;
    const survivalProbA = Math.max(0, Math.min(100, 100 - resultVsA.killProbPct));
    const survivalProbB = Math.max(0, Math.min(100, 100 - resultVsB.killProbPct));

    const tankierByHpPct = Math.abs(hpPctA - hpPctB) < 1e-4 ? "tie" : hpPctA < hpPctB ? "A" : "B";
    const tankierByRaw = Math.abs(deltaExpected) < 1e-4 ? "tie" : deltaExpected < 0 ? "A" : "B";

    return {
        resultVsA,
        resultVsB,
        deltaExpected,
        deltaExpectedPct,
        deltaHpPct,
        survivalProbA,
        survivalProbB,
        tankierByHpPct,
        tankierByRaw,
    };
}
