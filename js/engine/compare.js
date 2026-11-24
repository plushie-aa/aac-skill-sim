/**
 * Build A vs. Build B comparison engine:
 * - Head-to-head Attacker A vs. Attacker B across skills
 * - Head-to-head Healer A vs. Healer B across healing skills
 * - Head-to-head Defender A vs. Defender B survivability
 * - Ser Meatball-style Defender stat sweeps (Defense, Resilience, Toughness)
 *   with exact break-even crossover points using real AA Classic skill formulas.
 */

import { simulateSkillDamage } from "./damage.js";
import { computeEffectiveStats } from "./effective.js";
import { simulateSkillHeal } from "./healing.js";
import { compareRotations, simulateRotation } from "./rotation.js";
import { applyModifiers, applyOverrides } from "./stats.js";

function computeDelta(valA, valB) {
    const delta = valA - valB;
    const deltaPct = valB > 0 ? ((valA - valB) / valB) * 100 : valA > 0 ? 100 : 0;
    let winner = "tie";
    if (Math.abs(delta) > 1e-6) {
        winner = delta > 0 ? "A" : "B";
    }
    return { delta, deltaPct, winner };
}

/**
 * Compare Attacker A vs. Attacker B (supports both damage and heal skills).
 */
export function compareBuilds(buildA, buildB, target, skills, context = {}, constants = {}) {
    const rows = skills.map((skill) => {
        const simFn = skill.kind === "heal" ? simulateSkillHeal : simulateSkillDamage;
        const resultA = simFn(buildA, target, skill, context, constants);
        const resultB = simFn(buildB, target, skill, context, constants);

        const expectedDiff = computeDelta(resultA.expected, resultB.expected);
        const normalDiff = computeDelta(resultA.normal, resultB.normal);
        const critDiff = computeDelta(resultA.crit, resultB.crit);

        return {
            skillId: skill.id,
            skillName: skill.name,
            skillset: skill.skillset,
            variant: skill.variant || "base",
            kind: skill.kind,
            resultA,
            resultB,
            deltaExpected: expectedDiff.delta,
            deltaExpectedPct: expectedDiff.deltaPct,
            deltaNormalPct: normalDiff.deltaPct,
            deltaCritPct: critDiff.deltaPct,
            winner: expectedDiff.winner,
        };
    });

    const avgDeltaPct =
        rows.length > 0
            ? rows.reduce((s, r) => s + r.deltaExpectedPct, 0) / rows.length
            : 0;
    const winsA = rows.filter((r) => r.winner === "A").length;
    const winsB = rows.filter((r) => r.winner === "B").length;

    return {
        buildAName: buildA.name || "Build A",
        buildBName: buildB.name || "Build B",
        targetName: target.name || "Target",
        summary: {
            skillCount: rows.length,
            winsA,
            winsB,
            ties: rows.length - winsA - winsB,
            avgDeltaExpectedPct: avgDeltaPct,
            overallWinner: Math.abs(avgDeltaPct) < 1e-6 ? "tie" : avgDeltaPct > 0 ? "A" : "B",
        },
        rows,
    };
}

/**
 * Flip the comparison around: same Attacker hitting Defender A vs. Defender B.
 * Here, taking LESS expected damage wins.
 */
export function compareDefenders(attacker, defenderA, defenderB, skills, context = {}, constants = {}) {
    const dmgSkills = skills.filter((s) => s.kind !== "heal");
    const rows = dmgSkills.map((skill) => {
        const resA = simulateSkillDamage(attacker, defenderA, skill, context, constants);
        const resB = simulateSkillDamage(attacker, defenderB, skill, context, constants);

        // Positive mitigation advantage = Defender A takes less damage than Defender B
        const dmgDiff = resA.expected - resB.expected;
        const dmgDiffPct = resB.expected > 0 ? (dmgDiff / resB.expected) * 100 : 0;
        let tankier = "tie";
        if (Math.abs(dmgDiff) > 1e-6) {
            tankier = dmgDiff < 0 ? "A" : "B";
        }

        return {
            skillId: skill.id,
            skillName: skill.name,
            skillset: skill.skillset,
            resultVsA: resA,
            resultVsB: resB,
            deltaDamageTaken: dmgDiff,
            deltaDamageTakenPct: dmgDiffPct,
            tankier,
        };
    });

    const avgDiffPct =
        rows.length > 0
            ? rows.reduce((s, r) => s + r.deltaDamageTakenPct, 0) / rows.length
            : 0;

    return {
        attackerName: attacker.name || "Attacker",
        defenderAName: defenderA.name || "Defender A",
        defenderBName: defenderB.name || "Defender B",
        summary: {
            skillCount: rows.length,
            avgDeltaDamageTakenPct: avgDiffPct,
            tankierOverall: Math.abs(avgDiffPct) < 1e-6 ? "tie" : avgDiffPct < 0 ? "A" : "B",
        },
        rows,
    };
}

const MAX_SWEEP_POINTS = 250;

function normalizeSweepRange(startRaw, endRaw, stepRaw, defaultEnd, defaultStep) {
    const startNum = Number(startRaw ?? 0);
    const endNum = Number(endRaw ?? defaultEnd);
    const stepNum = Number(stepRaw ?? defaultStep);
    const start = Number.isFinite(startNum) ? Math.max(0, startNum) : 0;
    const end = Number.isFinite(endNum) ? Math.max(start, endNum) : Math.max(start, defaultEnd);
    let step = Number.isFinite(stepNum) ? Math.max(1, stepNum) : Math.max(1, defaultStep);
    const span = end - start;
    if (span > 0 && span / step > MAX_SWEEP_POINTS) {
        step = Math.ceil(span / MAX_SWEEP_POINTS);
    }
    return { start, end, step };
}

/**
 * Sweep a defender stat (e.g. "physicalDefense", "magicDefense", "resilience", "toughness")
 * across [start..end] with step, comparing Build A vs. Build B on a concrete skill
 * and finding exact linear-interpolated break-even crossover values.
 */
export function sweepDefenderStat(
    buildA,
    buildB,
    baseDefender,
    skill,
    sweepConfig = {},
    context = {},
    constants = {}
) {
    const stat = sweepConfig.stat || (skill.damageType === "magic" ? "magicDefense" : "physicalDefense");
    const { start, end, step } = normalizeSweepRange(
        sweepConfig.start,
        sweepConfig.end,
        sweepConfig.step,
        24000,
        1000
    );
    const metric = sweepConfig.metric || "expected"; // "expected" | "normal" | "crit"

    const points = [];
    for (let x = start; x <= end; x += step) {
        const defAtX = applyOverrides(baseDefender, { defense: { [stat]: x } });
        const resA = simulateSkillDamage(buildA, defAtX, skill, context, constants);
        const resB = simulateSkillDamage(buildB, defAtX, skill, context, constants);

        const valA = resA[metric];
        const valB = resB[metric];
        const diff = computeDelta(valA, valB);

        points.push({
            statValue: x,
            valueA: valA,
            valueB: valB,
            normalA: resA.normal,
            normalB: resB.normal,
            critA: resA.crit,
            critB: resB.crit,
            expectedA: resA.expected,
            expectedB: resB.expected,
            delta: diff.delta,
            deltaPct: diff.deltaPct,
            winner: diff.winner,
        });
    }

    // Detect break-even crossover points via sign changes in (valueA - valueB)
    const breakEvens = detectSweepBreakEvens(points);

    return {
        stat,
        metric,
        skillId: skill.id,
        skillName: skill.name,
        buildAName: buildA.name || "Build A",
        buildBName: buildB.name || "Build B",
        points,
        breakEvens,
    };
}

function detectSweepBreakEvens(points) {
    const breakEvens = [];
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        if (prev.delta === 0) {
            breakEvens.push({
                statValue: prev.statValue,
                fromWinner: i >= 2 ? points[i - 2].winner : "tie",
                toWinner: curr.winner,
            });
        } else if ((prev.delta < 0 && curr.delta > 0) || (prev.delta > 0 && curr.delta < 0)) {
            const t = Math.abs(prev.delta) / (Math.abs(prev.delta) + Math.abs(curr.delta));
            const crossX = prev.statValue + t * (curr.statValue - prev.statValue);
            breakEvens.push({
                statValue: Math.round(crossX),
                fromWinner: prev.winner,
                toWinner: curr.winner,
            });
        }
    }
    return breakEvens;
}

/**
 * Sweep an Aggressor offensive stat (e.g. Defense Penetration 0..15,000 or Crit Rate 0..100%)
 * and compare Defender A vs Defender B EHP (Non-Crit, Crit, Expected) with break-even crossovers.
 */
export function sweepDefenderEhp(
    defenderA,
    defenderB,
    baseAttacker,
    sweepConfig = {},
    context = {},
    constants = {}
) {
    const stat = sweepConfig.stat || "aggressorDefPen"; // "aggressorDefPen" | "aggressorMagicDefPen" | "aggressorCritRate"
    const kind =
        sweepConfig.ehpKind ||
        (stat === "aggressorMagicDefPen" ? "magic" : "melee"); // "melee" | "ranged" | "magic"
    const metric = sweepConfig.metric || "expected"; // "expected" | "normal" | "crit"
    const { start, end, step } = normalizeSweepRange(
        sweepConfig.start,
        sweepConfig.end,
        sweepConfig.step,
        stat === "aggressorCritRate" ? 100 : 15000,
        stat === "aggressorCritRate" ? 5 : 1000
    );

    const effDefA = Array.isArray(context.defenderAModifiers)
        ? applyModifiers(defenderA, context.defenderAModifiers)
        : defenderA;
    const effDefB = Array.isArray(context.defenderBModifiers)
        ? applyModifiers(defenderB, context.defenderBModifiers)
        : defenderB;
    const effAttBase = Array.isArray(context.attackerModifiers)
        ? applyModifiers(baseAttacker, context.attackerModifiers)
        : baseAttacker;

    const ehpOpts = {
        isPvE: Boolean(context.isPvE),
        disableAvoidance: Boolean(context.disableAvoidance),
    };

    const points = [];
    for (let x = start; x <= end; x += step) {
        let attAtX = effAttBase;
        if (stat === "aggressorDefPen") {
            attAtX = applyOverrides(effAttBase, { offense: { defensePenetration: x } });
        } else if (stat === "aggressorMagicDefPen") {
            attAtX = applyOverrides(effAttBase, { offense: { magicDefensePenetration: x } });
        } else if (stat === "aggressorCritRate") {
            attAtX = applyOverrides(effAttBase, {
                offense: {
                    meleeCritRatePct: x,
                    rangedCritRatePct: x,
                    magicCritRatePct: x,
                },
            });
        }

        const lineA = computeEffectiveStats(effDefA, attAtX, constants, ehpOpts).defense.ehp[kind];
        const lineB = computeEffectiveStats(effDefB, attAtX, constants, ehpOpts).defense.ehp[kind];

        const nonCritA = lineA.vsAttackerNonCritEhp;
        const nonCritB = lineB.vsAttackerNonCritEhp;
        const critA = lineA.vsAttackerCritEhp;
        const critB = lineB.vsAttackerCritEhp;
        const expectedA = lineA.vsAttackerEhp;
        const expectedB = lineB.vsAttackerEhp;

        const valA = metric === "normal" ? nonCritA : metric === "crit" ? critA : expectedA;
        const valB = metric === "normal" ? nonCritB : metric === "crit" ? critB : expectedB;
        const diff = computeDelta(valA, valB);

        points.push({
            statValue: x,
            valueA: valA,
            valueB: valB,
            normalA: nonCritA,
            normalB: nonCritB,
            critA,
            critB,
            expectedA,
            expectedB,
            delta: diff.delta,
            deltaPct: diff.deltaPct,
            winner: diff.winner,
        });
    }

    return {
        stat,
        ehpKind: kind,
        metric,
        buildAName: defenderA.name || "Defender A",
        buildBName: defenderB.name || "Defender B",
        attackerName: baseAttacker.name || "Aggressor",
        points,
        breakEvens: detectSweepBreakEvens(points),
    };
}

/**
 * Multi-Opponent Matchup Matrix: evaluate Build A vs Build B across an array of saved builds.
 * Supports:
 *  - "offense_skill": Build A & B attack every opponent with `skill` (Non-Crit / Crit / Expected)
 *  - "offense_rotation": Build A & B execute `rotationSteps` against every opponent (Expected / Kill% / TTK)
 *  - "defense_ehp": Defender A & B defend against every opponent as Aggressor (Melee/Ranged/Magic EHP)
 *  - "defense_skill": Defender A & B take `skill` from every opponent as Aggressor (% HP lost)
 */
export function computeMatchupMatrix(buildA, buildB, opponents = [], options = {}) {
    const matrixMode = options.matrixMode || "offense_skill";
    const skill = options.skill || null;
    const rotationSteps = Array.isArray(options.rotationSteps) ? options.rotationSteps : [];
    const ehpKind = options.ehpKind || "melee"; // "melee" | "ranged" | "magic"
    const baseCtx = options.context || {};
    const modsA = Array.isArray(options.modifiersA) ? options.modifiersA : [];
    const modsB = Array.isArray(options.modifiersB) ? options.modifiersB : [];
    const constants = options.constants || {};
    const disableAvoidance = Boolean(options.disableAvoidance);

    const effA = applyModifiers(buildA, modsA);
    const effB = applyModifiers(buildB, modsB);

    const rows = (opponents || []).map((oppEntry) => {
        const oppRaw = oppEntry.character || oppEntry;
        const oppMods = Array.isArray(oppEntry.modifiers) ? oppEntry.modifiers : [];
        const oppId = oppEntry.id || oppRaw.savedId || oppRaw.name;
        const effOpp = oppMods.length > 0 ? applyModifiers(oppRaw, oppMods) : oppRaw;

        if (matrixMode === "offense_rotation") {
            const cmp = compareRotations(
                buildA,
                buildB,
                oppRaw,
                rotationSteps,
                { ...baseCtx, attackerModifiers: modsA, defenderModifiers: oppMods },
                { ...baseCtx, attackerModifiers: modsB, defenderModifiers: oppMods },
                constants
            );
            const rA = cmp.resultA;
            const rB = cmp.resultB;
            const expDiff = computeDelta(rA.totalExpected, rB.totalExpected);
            const normDiff = computeDelta(rA.totalNormal, rB.totalNormal);
            const critDiff = computeDelta(rA.totalCrit, rB.totalCrit);
            return {
                opponentId: oppId,
                opponentName: oppRaw.name || oppId,
                opponentMeta: oppRaw.metadata || {},
                gearScore: oppRaw.gearScore || oppRaw.metadata?.gearScore || 0,
                normalA: rA.totalNormal,
                normalB: rB.totalNormal,
                normalDeltaPct: normDiff.deltaPct,
                critA: rA.totalCrit,
                critB: rB.totalCrit,
                critDeltaPct: critDiff.deltaPct,
                expectedA: rA.totalExpected,
                expectedB: rB.totalExpected,
                expectedDeltaPct: expDiff.deltaPct,
                killProbA: rA.killProbPct,
                killProbB: rB.killProbPct,
                ttkA: rA.estimatedTtkSec,
                ttkB: rB.estimatedTtkSec,
                winner: expDiff.winner,
            };
        }

        if (matrixMode === "defense_ehp") {
            const ehpOpts = { isPvE: Boolean(baseCtx.isPvE), disableAvoidance };
            const lA = computeEffectiveStats(effA, effOpp, constants, ehpOpts).defense.ehp[ehpKind];
            const lB = computeEffectiveStats(effB, effOpp, constants, ehpOpts).defense.ehp[ehpKind];
            const expDiff = computeDelta(lA.vsAttackerEhp, lB.vsAttackerEhp);
            const normDiff = computeDelta(lA.vsAttackerNonCritEhp, lB.vsAttackerNonCritEhp);
            const critDiff = computeDelta(lA.vsAttackerCritEhp, lB.vsAttackerCritEhp);
            return {
                opponentId: oppId,
                opponentName: oppRaw.name || oppId,
                opponentMeta: oppRaw.metadata || {},
                gearScore: oppRaw.gearScore || oppRaw.metadata?.gearScore || 0,
                normalA: lA.vsAttackerNonCritEhp,
                normalB: lB.vsAttackerNonCritEhp,
                normalDeltaPct: normDiff.deltaPct,
                critA: lA.vsAttackerCritEhp,
                critB: lB.vsAttackerCritEhp,
                critDeltaPct: critDiff.deltaPct,
                expectedA: lA.vsAttackerEhp,
                expectedB: lB.vsAttackerEhp,
                expectedDeltaPct: expDiff.deltaPct,
                winner: expDiff.winner,
            };
        }

        if (matrixMode === "defense_skill" && skill) {
            const ctxA = { ...baseCtx, disableAvoidance, attackerModifiers: oppMods, defenderModifiers: modsA };
            const ctxB = { ...baseCtx, disableAvoidance, attackerModifiers: oppMods, defenderModifiers: modsB };
            const resA = simulateSkillDamage(oppRaw, buildA, skill, ctxA, constants);
            const resB = simulateSkillDamage(oppRaw, buildB, skill, ctxB, constants);
            const hpPctDiff = (a, b) => (b > 0 ? ((a - b) / b) * 100 : 0);
            const expHpDiff = hpPctDiff(resA.pctOfDefenderHp.expected, resB.pctOfDefenderHp.expected);
            const normHpDiff = hpPctDiff(resA.pctOfDefenderHp.normal, resB.pctOfDefenderHp.normal);
            const critHpDiff = hpPctDiff(resA.pctOfDefenderHp.crit, resB.pctOfDefenderHp.crit);
            const winner = Math.abs(expHpDiff) < 0.05 ? "tie" : expHpDiff < 0 ? "A" : "B";
            return {
                opponentId: oppId,
                opponentName: oppRaw.name || oppId,
                opponentMeta: oppRaw.metadata || {},
                gearScore: oppRaw.gearScore || oppRaw.metadata?.gearScore || 0,
                normalA: resA.normal,
                normalB: resB.normal,
                normalHpA: resA.pctOfDefenderHp.normal,
                normalHpB: resB.pctOfDefenderHp.normal,
                normalDeltaPct: normHpDiff,
                critA: resA.crit,
                critB: resB.crit,
                critHpA: resA.pctOfDefenderHp.crit,
                critHpB: resB.pctOfDefenderHp.crit,
                critDeltaPct: critHpDiff,
                expectedA: resA.expected,
                expectedB: resB.expected,
                expectedHpA: resA.pctOfDefenderHp.expected,
                expectedHpB: resB.pctOfDefenderHp.expected,
                expectedDeltaPct: expHpDiff,
                winner,
                lowerIsBetter: true,
            };
        }

        // Default: "offense_skill"
        const simFn = skill?.kind === "heal" ? simulateSkillHeal : simulateSkillDamage;
        const resA = skill ? simFn(buildA, oppRaw, skill, { ...baseCtx, attackerModifiers: modsA, defenderModifiers: oppMods }, constants) : null;
        const resB = skill ? simFn(buildB, oppRaw, skill, { ...baseCtx, attackerModifiers: modsB, defenderModifiers: oppMods }, constants) : null;
        const expDiff = computeDelta(resA?.expected || 0, resB?.expected || 0);
        const normDiff = computeDelta(resA?.normal || 0, resB?.normal || 0);
        const critDiff = computeDelta(resA?.crit || 0, resB?.crit || 0);
        return {
            opponentId: oppId,
            opponentName: oppRaw.name || oppId,
            opponentMeta: oppRaw.metadata || {},
            gearScore: oppRaw.gearScore || oppRaw.metadata?.gearScore || 0,
            normalA: resA?.normal || 0,
            normalB: resB?.normal || 0,
            normalDeltaPct: normDiff.deltaPct,
            critA: resA?.crit || 0,
            critB: resB?.crit || 0,
            critDeltaPct: critDiff.deltaPct,
            expectedA: resA?.expected || 0,
            expectedB: resB?.expected || 0,
            expectedDeltaPct: expDiff.deltaPct,
            pctHpA: resA?.pctOfDefenderHp?.expected ?? resA?.pctOfTargetHp?.expected ?? 0,
            pctHpB: resB?.pctOfDefenderHp?.expected ?? resB?.pctOfTargetHp?.expected ?? 0,
            winner: expDiff.winner,
        };
    });

    const n = rows.length;
    const winsA = rows.filter((r) => r.winner === "A").length;
    const winsB = rows.filter((r) => r.winner === "B").length;
    const ties = n - winsA - winsB;
    const avgExpectedDeltaPct = n > 0 ? rows.reduce((s, r) => s + r.expectedDeltaPct, 0) / n : 0;
    const avgNormalDeltaPct = n > 0 ? rows.reduce((s, r) => s + r.normalDeltaPct, 0) / n : 0;
    const avgCritDeltaPct = n > 0 ? rows.reduce((s, r) => s + r.critDeltaPct, 0) / n : 0;

    const lowerBetter = matrixMode === "defense_skill";
    const sorted = [...rows].sort((a, b) =>
        lowerBetter ? a.expectedDeltaPct - b.expectedDeltaPct : b.expectedDeltaPct - a.expectedDeltaPct
    );
    const overallWinner =
        Math.abs(avgExpectedDeltaPct) < 0.05
            ? "tie"
            : (lowerBetter ? avgExpectedDeltaPct < 0 : avgExpectedDeltaPct > 0)
              ? "A"
              : "B";

    return {
        matrixMode,
        ehpKind,
        buildAName: buildA.name || "Build A",
        buildBName: buildB.name || "Build B",
        rows,
        summary: {
            count: n,
            winsA,
            winsB,
            ties,
            avgExpectedDeltaPct,
            avgNormalDeltaPct,
            avgCritDeltaPct,
            overallWinner,
            bestForA: sorted[0] || null,
            bestForB: sorted[sorted.length - 1] || null,
        },
    };
}

function detectPrimaryOffenseKind(character) {
    const off = character?.offense || {};
    const mAtk = Number(off.meleeAttack) || 0;
    const rAtk = Number(off.rangedAttack) || 0;
    const magAtk = Number(off.magicAttack) || 0;
    const hPwr = Number(off.healingPower) || 0;
    let role = "melee";
    let best = mAtk;
    if (rAtk > best) {
        role = "ranged";
        best = rAtk;
    }
    if (magAtk > best) {
        role = "magic";
        best = magAtk;
    }
    if (hPwr > best) {
        role = "healer";
        best = hPwr;
    }
    return role;
}

function createNormalizedBenchmarkSkill(role) {
    if (role === "magic") {
        return {
            id: "__bench_magic",
            name: "Magic Benchmark (500%)",
            skillset: "sorcery",
            kind: "damage",
            damageType: "magic",
            scalingStat: "magicAttack",
            base: 0,
            scalingPct: 500,
        };
    }
    if (role === "ranged") {
        return {
            id: "__bench_ranged",
            name: "Ranged Benchmark (500%)",
            skillset: "archery",
            kind: "damage",
            damageType: "physical",
            scalingStat: "rangedAttack",
            base: 0,
            scalingPct: 500,
        };
    }
    if (role === "healer") {
        return {
            id: "__bench_vitalism",
            name: "Vitalism Benchmark (500%)",
            skillset: "vitalism",
            kind: "damage",
            damageType: "magic",
            scalingStat: "healingPower",
            base: 0,
            scalingPct: 500,
        };
    }
    return {
        id: "__bench_melee",
        name: "Melee Benchmark (500%)",
        skillset: "battlerage",
        kind: "damage",
        damageType: "physical",
        scalingStat: "meleeAttack",
        base: 0,
        scalingPct: 500,
    };
}

/**
 * All-vs-All N×N Class/Build Matchup Matrix (independent of Build A / Build B).
 * Compares every entry in `entries` against every other entry in `entries`.
 *
 * Metrics:
 *  - "trade_ratio": Antisymmetric 1v1 stat-trade ratio = (% HP dealt by Row per 500% primary attack) / (% HP dealt by Col)
 *  - "signature_skill": Real signature skill per role (Arc Lightning / Snipe / Precision Strike / Skewer), reporting % HP & dmg
 *  - "defender_ehp": Row defender's exact EHP against Column attacker's primary damage type (Avg = Row defender's avg EHP across all attackers)
 *  - "healing_output": Row healer's exact healing output (e.g. Ode to Recovery / sec, Antithesis, Mend) onto Column ally target (accounting for Received Healing %)
 *  - "selected_skill": Single user-selected skill, Row attacking Col
 */
export function computeAllVsAllMatrix(entries = [], options = {}) {
    const metric = options.metric || "trade_ratio"; // "trade_ratio" | "signature_skill" | "defender_ehp" | "healing_output" | "selected_skill" | "saved_combo"
    const hitMode = options.hitMode || "expected"; // "expected" | "normal" | "crit"
    const selectedSkill = options.selectedSkill || null;
    const healSkill = options.healSkill || (selectedSkill?.kind === "heal" ? selectedSkill : null);
    const selectedCombo = options.selectedCombo || null;
    const baseCtx = options.context || {};
    const disableAvoidance = Boolean(options.disableAvoidance);
    const constants = options.constants || {};

    const prepared = (entries || []).map((entry) => {
        const raw = entry.character || entry;
        const mods = Array.isArray(entry.modifiers) ? entry.modifiers : [];
        const eff = mods.length > 0 ? applyModifiers(raw, mods) : raw;
        const role = entry.role || detectPrimaryOffenseKind(eff);
        const ehpKind = role === "magic" || role === "healer" ? "magic" : role === "ranged" ? "ranged" : "melee";
        const benchSkill = createNormalizedBenchmarkSkill(role);
        const sigSkill = entry.signatureSkill || benchSkill;
        return {
            id: entry.id || raw.savedId || raw.name,
            name: entry.name || raw.name || entry.id,
            raw,
            eff,
            modifiers: mods,
            role,
            ehpKind,
            benchSkill,
            sigSkill,
            combo: entry.combo || null,
            armor: entry.armor || "",
            gearScore: raw.gearScore || raw.metadata?.gearScore || 0,
            className: raw.metadata?.className || raw.className || "",
            buffLabel: entry.buffLabel || "",
            buffCount: entry.buffCount ?? mods.length,
        };
    });

    const n = prepared.length;
    const stepCtx = {
        ...baseCtx,
        disableAvoidance,
        attackerModifiers: null,
        defenderModifiers: null,
    };
    const ehpOpts = {
        isPvE: Boolean(baseCtx.isPvE),
        disableAvoidance,
    };

    // Precompute directional benchmark results for trade_ratio
    const dirGrid = Array.from({ length: n }, () => Array(n).fill(null));
    if (metric === "trade_ratio") {
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const sim = simulateSkillDamage(prepared[i].eff, prepared[j].eff, prepared[i].benchSkill, stepCtx, constants);
                const dmg = sim[hitMode];
                const pctHp = sim.pctOfDefenderHp[hitMode];
                dirGrid[i][j] = { dmg, pctHp };
            }
        }
    }

    const rows = prepared.map((att, i) => {
        let wins = 0;
        let losses = 0;
        let ties = 0;
        let scoreSum = 0;
        let scoreCount = 0;

        const cells = prepared.map((def, j) => {
            if (i === j && metric === "trade_ratio") {
                return {
                    isMirror: true,
                    defenderId: def.id,
                    defenderName: def.name,
                    primaryVal: 1,
                    secondaryVal: null,
                    ratio: 1,
                    outcome: "mirror",
                };
            }

            if (metric === "trade_ratio") {
                const fwd = dirGrid[i][j];
                const rev = dirGrid[j][i];
                const ratio = rev.pctHp > 1e-6 ? fwd.pctHp / rev.pctHp : fwd.pctHp > 0 ? 9.99 : 1;
                const outcome = ratio > 1.05 ? "win" : ratio < 0.95 ? "loss" : "tie";
                if (outcome === "win") wins++;
                else if (outcome === "loss") losses++;
                else ties++;
                scoreSum += Math.log(Math.max(0.05, Math.min(20, ratio)));
                scoreCount++;
                return {
                    isMirror: false,
                    defenderId: def.id,
                    defenderName: def.name,
                    primaryVal: ratio,
                    fwdPctHp: fwd.pctHp,
                    revPctHp: rev.pctHp,
                    fwdDmg: fwd.dmg,
                    revDmg: rev.dmg,
                    ratio,
                    outcome,
                };
            }

            if (metric === "defender_ehp") {
                // Row = Defender (`att` slot entry at index i), Col = Attacker (`def` slot entry at index j)
                const rowDef = att;
                const colAtt = def;
                const ehpLine = computeEffectiveStats(rowDef.eff, colAtt.eff, constants, ehpOpts).defense.ehp[colAtt.ehpKind];
                const ehp =
                    hitMode === "normal"
                        ? ehpLine.vsAttackerNonCritEhp
                        : hitMode === "crit"
                          ? ehpLine.vsAttackerCritEhp
                          : ehpLine.vsAttackerEhp;
                scoreSum += ehp;
                scoreCount++;
                return {
                    isMirror: i === j,
                    attackerId: colAtt.id,
                    attackerName: colAtt.name,
                    defenderId: rowDef.id,
                    defenderName: rowDef.name,
                    primaryVal: ehp,
                    ehpKind: colAtt.ehpKind,
                    mitDrPct: ehpLine.vsAttackerDrPct,
                    avoidPct: ehpLine.vsAttackerAvoidancePct,
                    outcome: "neutral",
                };
            }

            if (metric === "healing_output" && healSkill) {
                const sim = simulateSkillHeal(att.eff, def.eff, healSkill, stepCtx, constants);
                const healVal = sim[hitMode];
                const pctHp = sim.pctOfTargetHp[hitMode];
                const isPerSec = Boolean(healSkill.flags?.perTickFormula);
                const durSec = Number(healSkill.flags?.durationSec) || 0;
                const fullDurHeal = isPerSec && durSec > 0 ? healVal * durSec : null;
                const recvHealPct = Number(def.eff.defense?.receivedHealingPct) || 0;
                scoreSum += healVal;
                scoreCount++;
                return {
                    isMirror: i === j,
                    defenderId: def.id,
                    defenderName: def.name,
                    skillId: healSkill.id,
                    skillName: healSkill.name,
                    primaryVal: healVal,
                    normalHeal: sim.normal,
                    critHeal: sim.crit,
                    expectedHeal: sim.expected,
                    pctHp,
                    isPerSec,
                    durationSec: durSec,
                    fullDurHeal,
                    recvHealPct,
                    outcome: "heal",
                };
            }

            if (metric === "saved_combo") {
                const combo = selectedCombo || att.combo;
                if (!combo || !Array.isArray(combo.steps) || combo.steps.length === 0) {
                    return {
                        isMirror: i === j,
                        defenderId: def.id,
                        defenderName: def.name,
                        comboName: "No Combo",
                        noCombo: true,
                        isHealCombo: false,
                        primaryVal: 0,
                        killProbPct: 0,
                        dmg: 0,
                        pctHp: 0,
                        durationSec: 0,
                        windowRate: 0,
                        killTimestampSec: null,
                        outcome: "neutral",
                    };
                }
                const rot = simulateRotation(att.eff, def.eff, combo.steps, stepCtx, constants);
                const dmg =
                    hitMode === "normal"
                        ? rot.totalNormal
                        : hitMode === "crit"
                          ? rot.totalCrit
                          : rot.totalExpected;
                const defHp = Math.max(1, Number(def.eff.maxHealth) || 1);
                const pctHp = (dmg / defHp) * 100;
                const isHealCombo = rot.mode === "heal";
                const primaryVal = isHealCombo ? pctHp : hitMode === "expected" ? rot.killProbPct : pctHp;
                if (!isHealCombo) {
                    if (rot.killProbPct >= 50) wins++;
                    else losses++;
                }
                scoreSum += primaryVal;
                scoreCount++;
                return {
                    isMirror: i === j,
                    defenderId: def.id,
                    defenderName: def.name,
                    comboName: combo.label || combo.id || "Combo",
                    noCombo: false,
                    isHealCombo,
                    primaryVal,
                    killProbPct: isHealCombo ? 0 : rot.killProbPct,
                    dmg,
                    pctHp,
                    durationSec: rot.totalDurationSec,
                    windowRate: rot.windowRate,
                    killTimestampSec: isHealCombo ? null : rot.killTimestampSec,
                    outcome: isHealCombo
                        ? "heal"
                        : rot.killProbPct >= 80
                          ? "win"
                          : rot.killProbPct < 40
                            ? "loss"
                            : "tie",
                };
            }

            // "signature_skill" or "selected_skill"
            const sk = metric === "selected_skill" && selectedSkill ? selectedSkill : att.sigSkill;
            const sim =
                sk.kind === "heal"
                    ? simulateSkillHeal(att.eff, def.eff, sk, stepCtx, constants)
                    : simulateSkillDamage(att.eff, def.eff, sk, stepCtx, constants);
            const dmg = sim[hitMode];
            const pctHp =
                sk.kind === "heal" ? sim.pctOfTargetHp[hitMode] : sim.pctOfDefenderHp[hitMode];
            scoreSum += pctHp;
            scoreCount++;
            return {
                isMirror: i === j,
                defenderId: def.id,
                defenderName: def.name,
                skillName: sk.name,
                primaryVal: pctHp,
                dmg,
                pctHp,
                outcome: "neutral",
            };
        });

        const avgScore =
            scoreCount > 0
                ? metric === "trade_ratio"
                    ? Math.exp(scoreSum / scoreCount) // Geometric mean of trade ratios!
                    : scoreSum / scoreCount
                : 0;

        const isHealRow =
            metric === "healing_output" ||
            (metric === "saved_combo" && cells.some((c) => c.isHealCombo));
        const hasNoComboRow =
            metric === "saved_combo" && cells.length > 0 && cells.every((c) => c.noCombo);

        return {
            attacker: att,
            cells,
            wins,
            losses,
            ties,
            avgScore,
            isHealRow,
            hasNoComboRow,
        };
    });

    return {
        metric,
        hitMode,
        entries: prepared,
        rows,
    };
}

/**
 * Marginal Stat Weights ("What's My Next Best Gem / Synth Upgrade?").
 * Perturbs the buffed character by realistic AA Classic 1.3.6 1x Gem and 1x Synth increments
 * using `applyModifiers` (preserving exact caps, attribute conversions, and formulas),
 * and ranks every candidate upgrade by % gain on Expected Damage/Heal or EHP.
 */
export function computeStatWeights(build, opponent, options = {}) {
    const mode = options.mode || (options.skill?.kind === "heal" ? "healing" : "offense"); // "offense" | "healing" | "defense"
    const skill = options.skill || null;
    const ehpKind = options.ehpKind || "melee"; // "melee" | "ranged" | "magic"
    const baseCtx = options.context || {};
    const buildMods = Array.isArray(options.buildModifiers) ? options.buildModifiers : [];
    const oppMods = Array.isArray(options.opponentModifiers) ? options.opponentModifiers : [];
    const constants = options.constants || {};
    const disableAvoidance = Boolean(options.disableAvoidance);

    const effBuild = buildMods.length > 0 ? applyModifiers(build, buildMods) : build;
    const effOpp = oppMods.length > 0 ? applyModifiers(opponent, oppMods) : opponent;
    const cleanCtx = {
        ...baseCtx,
        disableAvoidance,
        attackerModifiers: null,
        defenderModifiers: null,
    };

    const evalMetric = (candidateChar) => {
        if (mode === "defense") {
            const ehp = computeEffectiveStats(candidateChar, effOpp, constants, {
                isPvE: Boolean(baseCtx.isPvE),
                disableAvoidance,
            }).defense.ehp[ehpKind];
            return {
                primary: ehp.vsAttackerEhp,
                secondary: ehp.vsAttackerCritEhp,
                rate: null,
            };
        }
        if (mode === "healing" && skill) {
            const sim = simulateSkillHeal(candidateChar, effOpp, skill, cleanCtx, constants);
            return {
                primary: sim.expected,
                secondary: sim.crit,
                rate: sim.dps?.sustained ?? null,
            };
        }
        if (skill) {
            const sim = simulateSkillDamage(candidateChar, effOpp, skill, cleanCtx, constants);
            return {
                primary: sim.expected,
                secondary: sim.crit,
                rate: sim.dps?.sustained ?? null,
            };
        }
        return { primary: 0, secondary: 0, rate: null };
    };

    const baseResult = evalMetric(effBuild);
    const candidates = [];

    if (mode === "defense") {
        const isMagic = ehpKind === "magic";
        candidates.push(
            { id: "gem_tough", label: "Toughness", deltaLabel: "+353", tier: "gem", mod: { addDefense: { toughness: 353 } } },
            { id: "gem_resil", label: "Resilience", deltaLabel: "+480", tier: "gem", mod: { addDefense: { resilience: 480 } } },
            isMagic
                ? { id: "gem_mdef", label: "Magic Defense", deltaLabel: "+100", tier: "gem", mod: { addDefense: { magicDefense: 100 } } }
                : { id: "gem_pdef", label: "Physical Defense", deltaLabel: "+100", tier: "gem", mod: { addDefense: { physicalDefense: 100 } } },
            { id: "synth_tough", label: "Toughness", deltaLabel: "+650", tier: "synth", mod: { addDefense: { toughness: 650 } } },
            { id: "synth_resil", label: "Resilience", deltaLabel: "+835", tier: "synth", mod: { addDefense: { resilience: 835 } } },
            isMagic
                ? { id: "synth_mdef", label: "Magic Defense", deltaLabel: "+1,100", tier: "synth", mod: { addDefense: { magicDefense: 1100 } } }
                : { id: "synth_pdef", label: "Physical Defense", deltaLabel: "+1,100", tier: "synth", mod: { addDefense: { physicalDefense: 1100 } } },
            {
                id: "synth_dr",
                label: isMagic ? "Received Magic DR" : ehpKind === "ranged" ? "Received Ranged DR" : "Received Melee DR",
                deltaLabel: "+2.8%",
                tier: "synth",
                mod: {
                    addDefense: isMagic
                        ? { receivedMagicDrPct: 2.8 }
                        : ehpKind === "ranged"
                          ? { receivedRangedDrPct: 2.8 }
                          : { receivedMeleeDrPct: 2.8 },
                },
            },
            { id: "synth_hp", label: "Max Health", deltaLabel: "+1,500", tier: "synth", mod: { addMaxHealth: 1500 } },
            { id: "attr_sta", label: "Stamina", deltaLabel: "+50 STA", tier: "attr", mod: { addAttributes: { sta: 50 } } }
        );
        if (!isMagic && !disableAvoidance) {
            candidates.push({
                id: "gem_evade",
                label: "Evasion Rate",
                deltaLabel: "+3.0%",
                tier: "gem",
                mod: { addDefense: { evasionPct: 3.0 } },
            });
            if (ehpKind === "melee" || effBuild.defense?.dualWieldRangedParry) {
                candidates.push({
                    id: "gem_parry",
                    label: "Parry Rate",
                    deltaLabel: "+3.0%",
                    tier: "gem",
                    mod: { addDefense: { parryPct: 3.0 } },
                });
            }
            if (effBuild.defense?.hasShield) {
                candidates.push({
                    id: "gem_block",
                    label: "Shield Block",
                    deltaLabel: "+2.0%",
                    tier: "gem",
                    mod: { addDefense: { blockPct: 2.0 } },
                });
            }
        }
    } else if (mode === "healing") {
        candidates.push(
            { id: "gem_hpwr", label: "Healing Power", deltaLabel: "+12", tier: "gem", mod: { addOffense: { healingPower: 12 } } },
            { id: "gem_hcb", label: "Crit Heal Bonus", deltaLabel: "+6.0%", tier: "gem", mod: { addOffense: { healCritBonusPct: 6.0 } } },
            { id: "gem_hskill", label: "Skill Healing %", deltaLabel: "+4.0%", tier: "gem", mod: { addOffense: { healingPct: 4.0 } } },
            { id: "synth_hpwr", label: "Healing Power", deltaLabel: "+65", tier: "synth", mod: { addOffense: { healingPower: 65 } } },
            { id: "synth_hcr", label: "Crit Heal Rate", deltaLabel: "+4.6%", tier: "synth", mod: { addOffense: { healCritRatePct: 4.6 } } },
            { id: "synth_hcb", label: "Crit Heal Bonus", deltaLabel: "+14.0%", tier: "synth", mod: { addOffense: { healCritBonusPct: 14.0 } } },
            { id: "synth_healpct", label: "Outgoing Healing", deltaLabel: "+3.2%", tier: "synth", mod: { addOffense: { healingPct: 3.2 } } },
            { id: "attr_spi", label: "Spirit", deltaLabel: "+50 SPI", tier: "attr", mod: { addAttributes: { spi: 50 } } }
        );
    } else {
        const sc = skill?.scalingStat || "meleeAttack";
        const isMagic = skill?.damageType === "magic" || sc === "magicAttack";
        const isRanged = sc === "rangedAttack";
        const isHealDmg = sc === "healingPower";
        const atkKey = isHealDmg ? "healingPower" : isMagic ? "magicAttack" : isRanged ? "rangedAttack" : "meleeAttack";
        const atkLabel = isHealDmg ? "Healing Power" : isMagic ? "Magic Attack" : isRanged ? "Ranged Attack" : "Melee Attack";
        const crKey = isHealDmg ? "healCritRatePct" : isMagic ? "magicCritRatePct" : isRanged ? "rangedCritRatePct" : "meleeCritRatePct";
        const cbKey = isHealDmg ? "healCritBonusPct" : isMagic ? "magicCritBonusPct" : isRanged ? "rangedCritBonusPct" : "meleeCritBonusPct";
        const dmgKey = isMagic ? "magicSkillDamagePct" : isRanged ? "rangedSkillDamagePct" : "meleeSkillDamagePct";
        const penKey = isMagic ? "magicDefensePenetration" : "defensePenetration";
        const penLabel = isMagic ? "Magic Def Pen" : "Defense Pen";
        const attrKey = isHealDmg ? "spi" : isMagic ? "int" : isRanged ? "agi" : "str";
        const attrName = isHealDmg ? "Spirit" : isMagic ? "Intelligence" : isRanged ? "Agility" : "Strength";
        const attrShort = attrKey.toUpperCase();

        candidates.push(
            { id: "gem_pen", label: penLabel, deltaLabel: "+100", tier: "gem", mod: { addOffense: { [penKey]: 100 } } },
            { id: "gem_cb", label: "Crit Damage", deltaLabel: "+6.0%", tier: "gem", mod: { addOffense: { [cbKey]: 6.0 } } },
            { id: "gem_atk", label: atkLabel, deltaLabel: "+12", tier: "gem", mod: { addOffense: { [atkKey]: 12 } } },
            { id: "gem_skill", label: "Skill Damage %", deltaLabel: "+3.0%", tier: "gem", mod: { addOffense: { [dmgKey]: 3.0 } } },
            { id: "synth_atk", label: atkLabel, deltaLabel: "+65", tier: "synth", mod: { addOffense: { [atkKey]: 65 } } },
            { id: "synth_pen", label: penLabel, deltaLabel: "+500", tier: "synth", mod: { addOffense: { [penKey]: 500 } } },
            { id: "synth_cr", label: "Crit Rate", deltaLabel: "+4.6%", tier: "synth", mod: { addOffense: { [crKey]: 4.6 } } },
            { id: "synth_cb", label: "Crit Damage", deltaLabel: "+14.0%", tier: "synth", mod: { addOffense: { [cbKey]: 14.0 } } },
            { id: "synth_dmg", label: "Skill Damage %", deltaLabel: "+3.2%", tier: "synth", mod: { addOffense: { [dmgKey]: 3.2 } } },
            { id: "attr_main", label: attrName, deltaLabel: `+50 ${attrShort}`, tier: "attr", mod: { addAttributes: { [attrKey]: 50 } } }
        );
        if (!isMagic && !disableAvoidance) {
            candidates.push({
                id: "gem_focus",
                label: "Focus",
                deltaLabel: "+360",
                tier: "gem",
                mod: { addOffense: { focus: 360 } },
            });
        }
    }

    const items = candidates.map((c) => {
        const nextChar = applyModifiers(effBuild, [c.mod]);
        const nextRes = evalMetric(nextChar);
        const gainAbs = nextRes.primary - baseResult.primary;
        const gainPct = baseResult.primary > 0 ? (gainAbs / baseResult.primary) * 100 : 0;
        const rateGainPct =
            baseResult.rate && nextRes.rate && baseResult.rate > 0
                ? ((nextRes.rate - baseResult.rate) / baseResult.rate) * 100
                : null;
        return {
            id: c.id,
            label: c.label,
            deltaLabel: c.deltaLabel,
            tier: c.tier,
            baseVal: baseResult.primary,
            nextVal: nextRes.primary,
            gainAbs,
            gainPct,
            rateGainPct,
        };
    });

    items.sort((a, b) => b.gainPct - a.gainPct);
    const maxGainPct = items.reduce((m, it) => Math.max(m, it.gainPct), 0);

    return {
        mode,
        ehpKind,
        skillName: skill?.name || null,
        buildName: effBuild.name || "Build A",
        opponentName: effOpp.name || "Target",
        baseValue: baseResult.primary,
        maxGainPct,
        items,
    };
}
