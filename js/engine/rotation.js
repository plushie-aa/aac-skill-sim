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

import { getEquippedSpecialEffects } from "../adapters/darugear_calc.js";
import { mergeConstants } from "./constants.js";
import {
    SKILL_DEBUFF_GRANTS,
    SKILL_STATUS_GRANTS,
    evaluateActiveSkillCombos,
    getRotationExtraEffect,
} from "./combos.js";
import { simulateSkillDamage } from "./damage.js";
import { simulateSkillHeal } from "./healing.js";
import { STAGED_WEAVE_SKILL_IDS, buildStageSkillView, getSkillStages } from "./skills.js";
import { COMBAT_MODIFIERS, applyModifiers, clamp, resolveSkillTiming } from "./stats.js";

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
    const effActor =
        context.attackerModifiers || (actor?.skillBuild && !actor?._skillBuildApplied)
            ? applyModifiers(actor, context.attackerModifiers || [])
            : actor;
    const effTarget =
        context.defenderModifiers || (target?.skillBuild && !target?._skillBuildApplied)
            ? applyModifiers(target, context.defenderModifiers || [])
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
    let maxImpactSec = 0;
    let totalDamageNormal = 0;
    let totalDamageCrit = 0;
    let totalHealNormal = 0;
    let totalHealCrit = 0;
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
    // and target debuffs (Stalker's Mark, Enervate, Dissonance, Wallop, Puncture) across the timeline
    const activeComboEffects = [];
    const activeStatuses = [];
    const activeDebuffs = [];
    const effectHistory = [];
    const existingDefModIds = new Set(
        (Array.isArray(context.defenderModifiers) ? context.defenderModifiers : []).map((t) =>
            String(t).split(":")[0]
        )
    );

    const recordEffectSpan = ({ id, label, kind, isCC = false, startSec, endSec, durationSec = 0 }) => {
        if (!id || !label) return;
        const isPermanent = !Number.isFinite(endSec);
        const key = `${kind}:${id}`;
        const existing = effectHistory.find(
            (sp) => sp.key === key && (sp.isPermanent || isPermanent || sp.endSec >= startSec - 1e-6)
        );
        if (existing) {
            existing.startSec = Math.min(existing.startSec, startSec);
            if (isPermanent || existing.isPermanent) {
                existing.isPermanent = true;
                existing.endSec = Number.POSITIVE_INFINITY;
                existing.durationSec = Number.POSITIVE_INFINITY;
            } else {
                existing.endSec = Math.max(existing.endSec, endSec);
                existing.durationSec = Math.max(0, existing.endSec - existing.startSec);
            }
            existing.refreshCount = (existing.refreshCount || 1) + 1;
        } else {
            effectHistory.push({
                key,
                id,
                label,
                kind,
                isCC: Boolean(isCC),
                startSec,
                endSec: isPermanent ? Number.POSITIVE_INFINITY : endSec,
                durationSec: isPermanent ? Number.POSITIVE_INFINITY : Math.max(0, Number(durationSec) || endSec - startSec),
                isPermanent,
                refreshCount: 1,
            });
        }
    };

    const registerExtraEffect = (effId, startedAtSec, expiresAtSec, sourceSkillId = "rotation_proc") => {
        const eff = getRotationExtraEffect(effId);
        if (!eff) return null;
        if (eff.kind === "debuff") {
            const prevIdx = activeDebuffs.findIndex((d) => d.id === eff.debuffId);
            const nextDeb = {
                id: eff.debuffId,
                label: eff.shortLabel || eff.label,
                durationSec: eff.durationSec,
                addDefense: eff.addDefense || {},
                mulDefense: eff.mulDefense || {},
                sourceSkillId,
                startedAtSec,
                expiresAtSec,
            };
            if (prevIdx >= 0) activeDebuffs[prevIdx] = nextDeb;
            else activeDebuffs.push(nextDeb);
            recordEffectSpan({
                id: nextDeb.id,
                label: nextDeb.label,
                kind: "debuff",
                startSec: startedAtSec,
                endSec: expiresAtSec,
                durationSec: eff.durationSec,
            });
            return nextDeb.label;
        }
        const prevIdx = activeStatuses.findIndex((st) => st.status === eff.status);
        const nextSt = {
            status: eff.status,
            label: eff.shortLabel || eff.label,
            durationSec: eff.durationSec,
            isCC: Boolean(eff.isCC),
            targetSide: eff.targetSide,
            sourceSkillId,
            startedAtSec,
            expiresAtSec,
        };
        if (prevIdx >= 0) activeStatuses[prevIdx] = nextSt;
        else activeStatuses.push(nextSt);
        recordEffectSpan({
            id: nextSt.status,
            label: nextSt.label,
            kind: "status",
            isCC: nextSt.isCC,
            startSec: startedAtSec,
            endSec: expiresAtSec,
            durationSec: eff.durationSec,
        });
        return nextSt.label;
    };

    const initialEffects = Array.isArray(context.rotationInitialEffects) ? context.rotationInitialEffects : [];
    for (const effId of initialEffects) {
        registerExtraEffect(effId, 0, Number.POSITIVE_INFINITY, "rotation_initial");
    }

    const autoCombosEnabled = !context.disableAutoCombos;
    const triggeredCombos = [];
    const stepResults = [];

    // Count occurrences of each skill across the rotation so repeated weave skills
    // (e.g. Gods' Whip, Fervent Healing, Lightning Tiger Strike) auto-progress stage-by-stage.
    const skillOccurrences = new Map();
    for (const s of steps || []) {
        if (s?.skill?.id) {
            skillOccurrences.set(s.skill.id, (skillOccurrences.get(s.skill.id) || 0) + 1);
        }
    }
    const autoStageCursor = new Map();

    for (let i = 0; i < (steps || []).length; i++) {
        const step = steps[i];
        if (!step || !step.skill) continue;

        const rawSkill = step.skill;
        const stages = getSkillStages(rawSkill);
        let resolvedStageIndex = null;
        let stageMode = null;
        if (stages.length > 1) {
            if (step.stageIndex === "all") {
                resolvedStageIndex = null;
                stageMode = "all";
                autoStageCursor.set(rawSkill.id, 0);
            } else if (step.stageIndex === "auto") {
                resolvedStageIndex = autoStageCursor.get(rawSkill.id) || 0;
                stageMode = "auto";
                autoStageCursor.set(rawSkill.id, (resolvedStageIndex + 1) % stages.length);
            } else if (
                step.stageIndex != null &&
                step.stageIndex !== "" &&
                Number.isFinite(Number(step.stageIndex))
            ) {
                resolvedStageIndex = Math.max(0, Math.min(stages.length - 1, Math.floor(Number(step.stageIndex))));
                stageMode = "fixed";
                autoStageCursor.set(rawSkill.id, (resolvedStageIndex + 1) % stages.length);
            } else if (STAGED_WEAVE_SKILL_IDS.has(rawSkill.id) && (skillOccurrences.get(rawSkill.id) || 0) > 1) {
                resolvedStageIndex = autoStageCursor.get(rawSkill.id) || 0;
                stageMode = "auto";
                autoStageCursor.set(rawSkill.id, (resolvedStageIndex + 1) % stages.length);
            } else {
                resolvedStageIndex = null;
                stageMode = "all";
            }
        }
        const skill = resolvedStageIndex != null ? buildStageSkillView(rawSkill, resolvedStageIndex) : rawSkill;
        const stageLabel = resolvedStageIndex != null ? stages[resolvedStageIndex]?.label || null : null;

        const isUtility = skill.kind === "utility";
        const isHeal = skill.kind === "heal";
        const startSec = elapsedSec;
        const travelTimeSec = Math.max(0, Number(step.travelTimeSec) || 0);

        // 1. Detect active cast-time-removing combo buff for this skill (evaluated at button press startSec)
        const hasBaseCast = Number(skill.castTimeSec) > 0;
        const activeCastCombo = hasBaseCast
            ? activeComboEffects.find(
                  (eff) =>
                      eff.expiresAtSec > startSec + 1e-6 &&
                      Array.isArray(eff.removesCastTimeFor) &&
                      eff.removesCastTimeFor.includes(skill.id)
              ) || null
            : null;

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

        // Optional per-step weapon proc (e.g. Staff +10k M.Pen on Arc Lightning only)
        const stepProcId =
            step.weaponProc && COMBAT_MODIFIERS[step.weaponProc] ? String(step.weaponProc) : null;
        const stepProcMod = stepProcId ? COMBAT_MODIFIERS[stepProcId] : null;
        let stepActor =
            stepProcId && !existingAttModIds.has(stepProcId)
                ? applyModifiers(effActor, [stepProcId])
                : effActor;

        // Apply active combo buffs that temporarily modify cast time (e.g. Startling Strain -20% Cast Time for 5s)
        const activeCastDeltaPct = activeComboEffects
            .filter((eff) => eff.expiresAtSec > startSec + 1e-6 && Number(eff.castTimeDeltaPct))
            .reduce((acc, eff) => acc + Number(eff.castTimeDeltaPct), 0);
        if (Math.abs(activeCastDeltaPct) > 1e-6) {
            const curCastPct = Number(stepActor?.offense?.castTimePct ?? 100);
            stepActor = {
                ...stepActor,
                offense: {
                    ...(stepActor.offense || {}),
                    castTimePct: Math.max(40, curCastPct + activeCastDeltaPct),
                },
            };
        }

        // Evaluate active statuses at step start + travel time (preserves cast-start combo windows),
        // and target defense debuffs at hit time (cast end + travel time) so delayed debuffs like
        // Charmed Bulwark Ballad apply when a cast-time spell lands.
        const comboEvalSec = startSec + travelTimeSec;
        const clampedCastPct = clamp(Number(stepActor?.offense?.castTimePct ?? 100), 40, 200);
        const estCastSec = removeCastTime
            ? 0
            : Math.max(0, (Number(skill.castTimeSec) || 0) * (clampedCastPct / 100));
        const debuffEvalSec = startSec + estCastSec + travelTimeSec;

        // 2. Detect active damage/heal combo multipliers, next-skill crit procs, and auto-CC bypass
        const liveStatusesAtStep = autoCombosEnabled
            ? activeStatuses.filter(
                  (st) =>
                      (st.startedAtSec == null || st.startedAtSec <= comboEvalSec + 1e-6) &&
                      st.expiresAtSec > comboEvalSec + 1e-6
              )
            : [];
        const autoStatusEval = autoCombosEnabled
            ? evaluateActiveSkillCombos(skill, activeStatuses, comboEvalSec)
            : { comboBonusPct: 0, bonusCritRatePct: 0, autoCCLabel: null, matchedLabels: [], consumedStatuses: [] };

        // 3. Apply any active rotation-applied target debuffs (e.g. Stalker's Mark, Dissonance, Wallop, Puncture, Charmed Bulwark)
        const liveDebuffs = autoCombosEnabled
            ? activeDebuffs.filter(
                  (d) =>
                      (d.startedAtSec == null || d.startedAtSec <= debuffEvalSec + 1e-6) &&
                      d.expiresAtSec > debuffEvalSec + 1e-6 &&
                      !existingDefModIds.has(d.id)
              )
            : [];

        // Snapshot every live status/debuff on target and active self/combo buff with exact remaining duration
        const liveTargetStatuses = liveStatusesAtStep.filter((st) => st.targetSide !== "self");
        const liveSelfStatuses = liveStatusesAtStep.filter((st) => st.targetSide === "self");
        const activeTargetEffects = [
            ...liveTargetStatuses.map((st) => {
                const isPermanent = !Number.isFinite(st.expiresAtSec);
                return {
                    id: st.status,
                    label: st.label,
                    kind: "status",
                    isCC: Boolean(st.isCC),
                    remainingSec: isPermanent ? null : Math.max(0, st.expiresAtSec - comboEvalSec),
                    durationSec: Number(st.durationSec) || 0,
                    isPermanent,
                };
            }),
            ...liveDebuffs.map((d) => {
                const isPermanent = !Number.isFinite(d.expiresAtSec);
                return {
                    id: d.id,
                    label: d.label,
                    kind: "debuff",
                    isCC: false,
                    remainingSec: isPermanent ? null : Math.max(0, d.expiresAtSec - debuffEvalSec),
                    durationSec: Number(d.durationSec) || 0,
                    isPermanent,
                };
            }),
        ];
        const activeComboBuffs = [
            ...activeComboEffects
                .filter((eff) => eff.expiresAtSec > startSec + 1e-6)
                .map((eff) => ({
                    id: eff.id,
                    label: eff.label || eff.summary || eff.id,
                    remainingSec: Math.max(0, eff.expiresAtSec - startSec),
                    durationSec: Number(eff.durationSec) || 0,
                })),
            ...liveSelfStatuses.map((st) => {
                const isPermanent = !Number.isFinite(st.expiresAtSec);
                return {
                    id: st.status,
                    label: st.label,
                    remainingSec: isPermanent ? null : Math.max(0, st.expiresAtSec - comboEvalSec),
                    durationSec: Number(st.durationSec) || 0,
                };
            }),
        ];
        let stepTarget = effTarget;
        if (liveDebuffs.length > 0 && !isUtility) {
            const nextDef = { ...(effTarget.defense || {}) };
            for (const deb of liveDebuffs) {
                for (const [k, delta] of Object.entries(deb.addDefense || {})) {
                    nextDef[k] = (Number(nextDef[k]) || 0) + Number(delta);
                }
            }
            for (const deb of liveDebuffs) {
                for (const [k, factor] of Object.entries(deb.mulDefense || {})) {
                    const f = Number(factor);
                    if (Number.isFinite(f)) {
                        nextDef[k] = (Number(nextDef[k]) || 0) * f;
                    }
                }
            }
            if (nextDef.physicalDefense < 0) nextDef.physicalDefense = 0;
            if (nextDef.magicDefense < 0) nextDef.magicDefense = 0;
            if (nextDef.evasionPct < 0) nextDef.evasionPct = 0;
            if (nextDef.parryPct < 0) nextDef.parryPct = 0;
            if (nextDef.blockPct < 0) nextDef.blockPct = 0;
            stepTarget = { ...effTarget, defense: nextDef };
        }

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
            _deathfletcherRotationApplied: liveDebuffs.some((d) => d.id === "deathfletcher_mark"),
            ...(step.gcdOverrideSec != null && step.gcdOverrideSec !== ""
                ? { gcdOverrideSec: Number(step.gcdOverrideSec) }
                : comboGcdOverride != null
                  ? { gcdOverrideSec: comboGcdOverride }
                  : {}),
            ...(step.rank != null ? { skillRank: step.rank } : {}),
        };

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
        const launchSec = castSec > 0 ? castEndSec : startSec;
        const impactSec = launchSec + travelTimeSec;
        elapsedSec = endSec;
        if (impactSec > maxImpactSec) maxImpactSec = impactSec;

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

        const actorT7Effects = getEquippedSpecialEffects(stepActor);
        const isBaseVariant = (skill.variant || "base") === "base";

        // Register any cast-time-removing combo buff granted by this skill (active from endSec)
        if (skill.comboEffect && Number(skill.comboEffect.durationSec) > 0) {
            const effId = skill.comboEffect.id || skill.id;
            const prevIdx = activeComboEffects.findIndex((e) => e.id === effId);
            let comboDurationSec = Number(skill.comboEffect.durationSec);
            let comboLabel = skill.comboEffect.label || skill.comboEffect.summary || skill.name;
            if (isBaseVariant && skill.id === "shadowplay_drop_back") {
                const ip = actorT7Effects.find((e) => Number(e.effect?.dropBackExtraDurationSec) > 0);
                if (ip) {
                    comboDurationSec += Number(ip.effect.dropBackExtraDurationSec);
                    comboLabel = `${comboLabel} (+${ip.effect.dropBackExtraDurationSec}s ${ip.name})`;
                }
            }
            const nextEff = {
                ...skill.comboEffect,
                id: effId,
                label: comboLabel,
                durationSec: comboDurationSec,
                sourceSkillId: skill.id,
                startedAtSec: endSec,
                expiresAtSec: endSec + comboDurationSec,
            };
            if (prevIdx >= 0) activeComboEffects[prevIdx] = nextEff;
            else activeComboEffects.push(nextEff);
            recordEffectSpan({
                id: effId,
                label: comboLabel,
                kind: "combo_buff",
                startSec: endSec,
                endSec: nextEff.expiresAtSec,
                durationSec: comboDurationSec,
            });
        }

        // Register status effects & debuffs granted by this skill (active from impactSec)
        const grantedStatuses = [];
        const appliedExtraEffects = [];
        if (autoCombosEnabled) {
            let grants = SKILL_STATUS_GRANTS[skill.id] || [];
            if (isBaseVariant && skill.id === "songcraft_startling_strain") {
                const lr = actorT7Effects.find((e) => Boolean(e.effect?.startlingStrainImmediateCharm));
                if (lr) {
                    grants = [
                        ...grants.filter((g) => g.status !== "stunned" && g.status !== "charmed"),
                        {
                            status: "charmed",
                            label: `Charmed (${lr.name})`,
                            durationSec: 12.0,
                            isCC: false,
                        },
                    ];
                }
            }
            const liveStatusSet = new Set(
                activeStatuses
                    .filter(
                        (st) =>
                            (st.startedAtSec == null || st.startedAtSec <= comboEvalSec + 1e-6) &&
                            st.expiresAtSec > comboEvalSec + 1e-6
                    )
                    .map((st) => st.status)
            );
            const resolveRequiredStatusStart = (reqList, waitStatusId) => {
                if (!Array.isArray(reqList) || reqList.length === 0) return impactSec;
                if (reqList.some((req) => liveStatusSet.has(req))) return impactSec;
                if (waitStatusId) {
                    const pending = activeStatuses.find(
                        (st) =>
                            st.status === waitStatusId &&
                            st.expiresAtSec > impactSec + 1e-6 &&
                            Number(st.startedAtSec) > comboEvalSec
                    );
                    if (pending) return Math.max(impactSec, Number(pending.startedAtSec));
                }
                return null;
            };
            for (const g of grants) {
                if (g.requiresBackstab && !stepIsBackstab) continue;
                const reqStart = resolveRequiredStatusStart(g.requiresAny, g.waitForStatus);
                if (reqStart == null) continue;
                const grantStartSec = reqStart + (Number(g.delaySec) || 0);
                const prevIdx = activeStatuses.findIndex((st) => st.status === g.status);
                let grantDurationSec = Number(g.durationSec || 0);
                if (
                    isBaseVariant &&
                    skill.id === "vitalism_resurgence" &&
                    g.status === "resurgence" &&
                    prevIdx >= 0 &&
                    activeStatuses[prevIdx].expiresAtSec > grantStartSec
                ) {
                    const nd = actorT7Effects.find((e) => Number(e.effect?.resurgenceStackMaxSec) > 0);
                    if (nd) {
                        const remaining = Math.max(0, activeStatuses[prevIdx].expiresAtSec - grantStartSec);
                        grantDurationSec = Math.min(Number(nd.effect.resurgenceStackMaxSec), remaining + grantDurationSec);
                    }
                }
                const nextSt = {
                    ...g,
                    durationSec: grantDurationSec,
                    sourceSkillId: skill.id,
                    startedAtSec: grantStartSec,
                    expiresAtSec: grantStartSec + grantDurationSec,
                };
                if (prevIdx >= 0) activeStatuses[prevIdx] = nextSt;
                else activeStatuses.push(nextSt);
                recordEffectSpan({
                    id: g.status,
                    label: g.label,
                    kind: g.targetSide === "self" ? "combo_buff" : "status",
                    isCC: Boolean(g.isCC),
                    startSec: grantStartSec,
                    endSec: nextSt.expiresAtSec,
                    durationSec: grantDurationSec,
                });
                grantedStatuses.push(g.label);
            }

            const rawDebGrant = SKILL_DEBUFF_GRANTS[skill.id];
            const debGrants = Array.isArray(rawDebGrant) ? rawDebGrant : rawDebGrant ? [rawDebGrant] : [];
            const skipDissonanceDebuff =
                isBaseVariant &&
                skill.id === "songcraft_dissonance" &&
                actorT7Effects.some((e) => Boolean(e.effect?.dissonanceNoDebuff));
            if (debGrants.length > 0 && !skipDissonanceDebuff) {
                for (const debGrant of debGrants) {
                    const reqStart = resolveRequiredStatusStart(debGrant.requiresAny, debGrant.waitForStatus);
                    if (reqStart == null) continue;
                    const debStartSec = reqStart + (Number(debGrant.delaySec) || 0);
                    const prevIdx = activeDebuffs.findIndex((d) => d.id === debGrant.id);
                    const nextDeb = {
                        ...debGrant,
                        sourceSkillId: skill.id,
                        startedAtSec: debStartSec,
                        expiresAtSec: debStartSec + Number(debGrant.durationSec || 0),
                    };
                    if (prevIdx >= 0) activeDebuffs[prevIdx] = nextDeb;
                    else activeDebuffs.push(nextDeb);
                    recordEffectSpan({
                        id: debGrant.id,
                        label: debGrant.label,
                        kind: "debuff",
                        startSec: debStartSec,
                        endSec: nextDeb.expiresAtSec,
                        durationSec: Number(debGrant.durationSec || 0),
                    });
                    grantedStatuses.push(debGrant.label);
                }
            }

            // T7 Deathfletcher (40618 / 40620): Basic Stalker's Mark decreases target's Physical Defense -390
            if (isBaseVariant && skill.id === "shadowplay_stalkers_mark") {
                const df = actorT7Effects.find((e) => Number(e.effect?.stalkersMarkDefShred) > 0);
                if (df) {
                    const shred = Number(df.effect.stalkersMarkDefShred);
                    const dfDur = Number(debGrants[0]?.durationSec || 12.0);
                    const dfDeb = {
                        id: "deathfletcher_mark",
                        label: `${df.name} (-${shred} PDef)`,
                        durationSec: dfDur,
                        addDefense: { physicalDefense: -shred },
                        sourceSkillId: skill.id,
                        startedAtSec: impactSec,
                        expiresAtSec: impactSec + dfDur,
                    };
                    const prevDfIdx = activeDebuffs.findIndex((d) => d.id === dfDeb.id);
                    if (prevDfIdx >= 0) activeDebuffs[prevDfIdx] = dfDeb;
                    else activeDebuffs.push(dfDeb);
                    recordEffectSpan({
                        id: dfDeb.id,
                        label: dfDeb.label,
                        kind: "debuff",
                        startSec: impactSec,
                        endSec: dfDeb.expiresAtSec,
                        durationSec: dfDeb.durationSec,
                    });
                    grantedStatuses.push(dfDeb.label);
                }
            }

            // Optional user-enabled random/proc debuffs applied on this step (e.g. Delirium -> Bleeding, Puncture)
            const stepExtraList = Array.isArray(step.appliedDebuffs) ? step.appliedDebuffs : [];
            for (const effId of stepExtraList) {
                const eff = getRotationExtraEffect(effId);
                if (!eff) continue;
                const lbl = registerExtraEffect(
                    eff.id,
                    impactSec,
                    impactSec + Number(eff.durationSec || 10),
                    skill.id
                );
                if (lbl) {
                    appliedExtraEffects.push(lbl);
                    if (!grantedStatuses.includes(lbl)) grantedStatuses.push(lbl);
                }
            }
        }

        if (!isUtility) {
            totalExpected += res.expected;

            if (isHeal) {
                healStepCount++;
                totalHealNormal += res.normal;
                totalHealCrit += res.crit;
                totalHealExpected += res.expected;
                for (const h of res.perHit || []) {
                    healPmf = convolvePmf(healPmf, getHitOutcomes(h, true));
                }
            } else {
                damageStepCount++;
                totalDamageNormal += res.normal;
                totalDamageCrit += res.crit;
                totalDamageExpected += res.expected;
                for (const h of res.perHit || []) {
                    damagePmf = convolvePmf(damagePmf, getHitOutcomes(h, false));
                }
                if (res.secondary && Number(res.secondary.expected) > 0) {
                    const secNorm = Math.max(0, Number(res.secondary.normal) || 0);
                    const secCrit = Math.max(secNorm, Number(res.secondary.crit) || secNorm);
                    const secExp = Math.max(secNorm, Number(res.secondary.expected) || secNorm);
                    if (res.secondary.canCrit && secCrit > secNorm + 1e-6) {
                        const pSecCrit = clamp((secExp - secNorm) / (secCrit - secNorm), 0, 1);
                        damagePmf = convolvePmf(damagePmf, [
                            { val: secNorm, p: 1 - pSecCrit },
                            { val: secCrit, p: pSecCrit },
                        ]);
                    } else {
                        damagePmf = convolvePmf(damagePmf, [{ val: secExp, p: 1 }]);
                    }
                }
                if (killStepIndex < 0 && totalDamageExpected >= effectiveKillHp) {
                    killStepIndex = stepResults.length;
                    killTimestampSec = impactSec;
                }
            }
        }

        stepResults.push({
            index: stepResults.length,
            skill,
            rawSkill,
            step,
            stageIndex: resolvedStageIndex,
            stageCount: stages.length,
            stageLabel,
            stageMode,
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
            impactSec,
            travelTimeSec,
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
            activeTargetEffects,
            activeComboBuffs,
            grantedStatuses,
            appliedExtraEffects,
            grantedComboEffect: skill.comboEffect || null,
            cumulativeExpected: isHeal ? totalHealExpected : totalDamageExpected,
        });
    }

    const effectSpans = effectHistory
        .map(({ key: _k, ...rest }) => rest)
        .sort((a, b) => a.startSec - b.startSec);

    const mode = healStepCount > 0 && damageStepCount === 0 ? "heal" : "damage";
    const primaryNormal = mode === "heal" ? totalHealNormal : totalDamageNormal;
    const primaryCrit = mode === "heal" ? totalHealCrit : totalDamageCrit;
    const primaryExpected = mode === "heal" ? totalHealExpected : totalDamageExpected;
    const primaryPmf = mode === "heal" ? healPmf : damagePmf;
    const distThreshold = mode === "damage" ? effectiveKillHp : targetMaxHp;
    const dist = summarizePmf(primaryPmf, distThreshold);
    const totalCastWindowSec = Math.max(0, elapsedSec);
    const totalDurationSec = Math.max(totalCastWindowSec, maxImpactSec);
    const totalTravelTailSec = Math.max(0, maxImpactSec - totalCastWindowSec);
    const windowRate = totalDurationSec > 0 ? primaryExpected / totalDurationSec : 0;
    const pctOfTargetHp = (primaryExpected / targetMaxHp) * 100;
    const estimatedTtkSec = mode === "damage" && windowRate > 0 ? effectiveKillHp / windowRate : null;

    return {
        mode,
        stepCount: stepResults.length,
        steps: stepResults,
        effectSpans,
        totalDurationSec,
        totalCastWindowSec,
        totalTravelTailSec,
        totalCastTimeSec,
        totalCastTimeSavedSec,
        triggeredCombos,
        totalNormal: primaryNormal,
        totalCrit: primaryCrit,
        totalExpected: primaryExpected,
        totalDamageNormal,
        totalDamageCrit,
        totalHealNormal,
        totalHealCrit,
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
