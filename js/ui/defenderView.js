/**
 * Defender A vs Defender B Survivability & Crit/Non-Crit EHP Comparison View.
 */

import { applyModifiers, compareDefenders, compareDefendersRotation, computeEffectiveStats } from "../engine/index.js";
import { renderStatWeightsBox } from "./skillsView.js";
import {
    escHtml,
    fmtDec,
    fmtDeltaPct,
    fmtInt,
    formatRankTag,
    getContext,
    getFilteredSkills,
    getSlotModifiers,
    skillIconUrl,
    state,
    switchAppMode,
    ui,
} from "./state.js";

const pctDiff = (a, b) => (b > 0 ? ((a - b) / b) * 100 : 0);
const ehpCls = (d) => (d > 0.05 ? "delta-pos" : d < -0.05 ? "delta-neg" : "delta-tie");
const hpLossCls = (d) => (d < -0.05 ? "delta-pos" : d > 0.05 ? "delta-neg" : "delta-tie");

function computeDefenderSkillRows(skills, baseCtx, manualDisableAvoid) {
    return skills.map((skill) => {
        const ctxVsA = {
            ...baseCtx,
            disableAvoidance: manualDisableAvoid,
            attackerModifiers: getSlotModifiers("defender"),
            defenderModifiers: getSlotModifiers("A"),
        };
        const ctxVsB = {
            ...baseCtx,
            disableAvoidance: manualDisableAvoid,
            attackerModifiers: getSlotModifiers("defender"),
            defenderModifiers: getSlotModifiers("B"),
        };
        const resVsA = compareDefenders(state.defender, state.buildA, state.buildA, [skill], ctxVsA).rows[0].resultVsA;
        const resVsB = compareDefenders(state.defender, state.buildB, state.buildB, [skill], ctxVsB).rows[0].resultVsA;

        const diff = resVsA.expected - resVsB.expected;
        const diffPct = pctDiff(resVsA.expected, resVsB.expected);
        const hpA = resVsA.pctOfDefenderHp.expected;
        const hpB = resVsB.pctOfDefenderHp.expected;
        const hpDiffPct = pctDiff(hpA, hpB);

        const normalDiffPct = pctDiff(resVsA.normal, resVsB.normal);
        const normalHpA = resVsA.pctOfDefenderHp.normal;
        const normalHpB = resVsB.pctOfDefenderHp.normal;
        const normalHpDiffPct = pctDiff(normalHpA, normalHpB);

        const critDiffPct = pctDiff(resVsA.crit, resVsB.crit);
        const critHpA = resVsA.pctOfDefenderHp.crit;
        const critHpB = resVsB.pctOfDefenderHp.crit;
        const critHpDiffPct = pctDiff(critHpA, critHpB);

        const tankier = Math.abs(hpA - hpB) < 1e-6 ? "tie" : hpA < hpB ? "A" : "B";
        return {
            skill,
            resVsA,
            resVsB,
            diff,
            diffPct,
            hpDiffPct,
            normalDiffPct,
            normalHpA,
            normalHpB,
            normalHpDiffPct,
            critDiffPct,
            critHpA,
            critHpB,
            critHpDiffPct,
            tankier,
        };
    });
}

function renderDefenderEhpSection({
    effAttacker,
    effDefA,
    effDefB,
    ehpA,
    ehpB,
    effectiveDisableAvoid,
    manualDisableAvoid,
    primaryRaw,
    avgDiffPct,
    avgHpDiffPct,
    avgNonCritHpDiffPct,
    avgCritHpDiffPct,
}) {
    const meleeEhpDiff = pctDiff(ehpA.ehp.melee.vsAttackerEhp, ehpB.ehp.melee.vsAttackerEhp);
    const meleeNonCritEhpDiff = pctDiff(ehpA.ehp.melee.vsAttackerNonCritEhp, ehpB.ehp.melee.vsAttackerNonCritEhp);
    const meleeCritEhpDiff = pctDiff(ehpA.ehp.melee.vsAttackerCritEhp, ehpB.ehp.melee.vsAttackerCritEhp);

    const rangedEhpDiff = pctDiff(ehpA.ehp.ranged.vsAttackerEhp, ehpB.ehp.ranged.vsAttackerEhp);
    const rangedNonCritEhpDiff = pctDiff(ehpA.ehp.ranged.vsAttackerNonCritEhp, ehpB.ehp.ranged.vsAttackerNonCritEhp);
    const rangedCritEhpDiff = pctDiff(ehpA.ehp.ranged.vsAttackerCritEhp, ehpB.ehp.ranged.vsAttackerCritEhp);

    const magicEhpDiff = pctDiff(ehpA.ehp.magic.vsAttackerEhp, ehpB.ehp.magic.vsAttackerEhp);
    const magicNonCritEhpDiff = pctDiff(ehpA.ehp.magic.vsAttackerNonCritEhp, ehpB.ehp.magic.vsAttackerNonCritEhp);
    const magicCritEhpDiff = pctDiff(ehpA.ehp.magic.vsAttackerCritEhp, ehpB.ehp.magic.vsAttackerCritEhp);

    const healEffMeleeDiff = pctDiff(
        ehpA.healingReceived.effectiveHpPer1kHealMelee,
        ehpB.healingReceived.effectiveHpPer1kHealMelee
    );
    const healEffMagicDiff = pctDiff(
        ehpA.healingReceived.effectiveHpPer1kHealMagic,
        ehpB.healingReceived.effectiveHpPer1kHealMagic
    );

    const fmtAvoidLabel = (e) => {
        if (effectiveDisableAvoid) return "Disabled";
        const parts = [];
        if (e.vsAttackerEvadePct > 0.05) parts.push(`E ${fmtDec(e.vsAttackerEvadePct)}%`);
        if (e.vsAttackerParryPct > 0.05) parts.push(`P ${fmtDec(e.vsAttackerParryPct)}%`);
        if (e.vsAttackerBlockPct > 0.05) parts.push(`B ${fmtDec(e.vsAttackerBlockPct)}%`);
        return parts.length > 0 ? parts.join(" + ") : "0%";
    };

    const fmtEhpRow = (title, sub, eA, eB, nonCritDiff, critDiff, expDiff, showAvoid) => {
        const avoidMeta = showAvoid ? ` &middot; Av: ${fmtAvoidLabel(eA)} / ${fmtAvoidLabel(eB)}` : "";
        return `
        <tr>
            <td>
                <strong>${title}</strong>
                <div class="skill-meta">${sub}</div>
                <div class="skill-meta">Mit DR: ${fmtDec(eA.vsAttackerDrPct)}% vs ${fmtDec(eB.vsAttackerDrPct)}%${avoidMeta}</div>
            </td>
            <td data-label="Non-Crit EHP (A / B)">
                <div class="def-cmp-main">
                    <span class="val-a">${fmtInt(eA.vsAttackerNonCritEhp)}</span>
                    <span class="def-cmp-sep">/</span>
                    <span class="val-b">${fmtInt(eB.vsAttackerNonCritEhp)}</span>
                    <span class="def-cmp-delta ${ehpCls(nonCritDiff)}">${fmtDeltaPct(nonCritDiff)}</span>
                </div>
                <div class="skill-meta">0% crit (pure mit${showAvoid && !effectiveDisableAvoid ? " + avoid" : ""})</div>
            </td>
            <td data-label="Crit EHP (A / B)">
                <div class="def-cmp-main">
                    <span class="val-a">${fmtInt(eA.vsAttackerCritEhp)}</span>
                    <span class="def-cmp-sep">/</span>
                    <span class="val-b">${fmtInt(eB.vsAttackerCritEhp)}</span>
                    <span class="def-cmp-delta ${ehpCls(critDiff)}">${fmtDeltaPct(critDiff)}</span>
                </div>
                <div class="skill-meta">Crit hit: ${fmtDec(eA.vsAttackerCritHitMult, 2)}&times; vs ${fmtDec(eB.vsAttackerCritHitMult, 2)}&times;</div>
            </td>
            <td class="mct-full" data-label="Expected EHP (A / B)">
                <div class="def-cmp-main">
                    <span class="val-a">${fmtInt(eA.vsAttackerEhp)}</span>
                    <span class="def-cmp-sep">/</span>
                    <span class="val-b">${fmtInt(eB.vsAttackerEhp)}</span>
                    <span class="def-cmp-delta ${ehpCls(expDiff)}">${fmtDeltaPct(expDiff)}</span>
                </div>
                <div class="skill-meta">${fmtDec(eA.vsAttackerCritFactor, 2)}&times; vs ${fmtDec(eB.vsAttackerCritFactor, 2)}&times; (${fmtDec(eA.vsAttackerEffCritRatePct, 0)}% vs ${fmtDec(eB.vsAttackerEffCritRatePct, 0)}% CR)</div>
            </td>
        </tr>`;
    };

    const extraAvoidNote =
        !manualDisableAvoid && effectiveDisableAvoid
            ? `<span class="hint-inline">(Avoidance is currently bypassed by active Backstab / Target CC'd / CC Debuff)</span>`
            : "";

    const primaryMetricDiff = primaryRaw ? avgDiffPct : avgHpDiffPct;
    const primaryWinnerTxt =
        primaryMetricDiff < -0.05
            ? `${escHtml(state.buildA.name)} is tankier`
            : primaryMetricDiff > 0.05
              ? `${escHtml(state.buildB.name)} is tankier`
              : "Equal";

    const flameRowHtml =
        ehpA.ehp.melee.flameEnlightenment?.active || ehpB.ehp.melee.flameEnlightenment?.active
            ? (() => {
                  const fA = ehpA.ehp.melee.flameEnlightenment;
                  const fB = ehpB.ehp.melee.flameEnlightenment;
                  const fmtFlame = (f) =>
                      f?.active
                          ? `+${fmtInt(f.healPerAvoid)} HP/avoid <span class="skill-meta">(~+${fmtInt(f.expectedHealPerHit)} HP/melee hit)</span>`
                          : `<span class="skill-meta">Inactive</span>`;
                  const dExp = (fA?.expectedHealPerHit || 0) - (fB?.expectedHealPerHit || 0);
                  return `
                    <tr>
                        <td><strong>Flame Enlightenment (2-Set)</strong> <span class="skill-meta">(Recover 1% Max HP on Block / Parry / Evade)</span></td>
                        <td class="val-a">${fmtFlame(fA)}</td>
                        <td class="val-b">${fmtFlame(fB)}</td>
                        <td class="${ehpCls(dExp)}">${dExp >= 0 ? "+" : ""}${fmtInt(dExp)} HP/hit</td>
                    </tr>`;
              })()
            : "";

    const absorbRowHtml =
        effDefA._activeBuffFlags?.absorbDamagePct > 0 || effDefB._activeBuffFlags?.absorbDamagePct > 0
            ? (() => {
                  const aPct = Number(effDefA._activeBuffFlags?.absorbDamagePct) || 0;
                  const bPct = Number(effDefB._activeBuffFlags?.absorbDamagePct) || 0;
                  return `
                    <tr>
                        <td><strong>Absorb Damage (Auramancy)</strong> <span class="skill-meta">(Post-hit sustain: converts % of taken damage to HP; does not add DR)</span></td>
                        <td class="val-a">${aPct > 0 ? `${fmtDec(aPct, 0)}% taken dmg &rarr; HP` : `<span class="skill-meta">Inactive</span>`}</td>
                        <td class="val-b">${bPct > 0 ? `${fmtDec(bPct, 0)}% taken dmg &rarr; HP` : `<span class="skill-meta">Inactive</span>`}</td>
                        <td class="${ehpCls(aPct - bPct)}">${aPct === bPct ? "Tie" : `${aPct - bPct > 0 ? "+" : ""}${fmtDec(aPct - bPct, 0)}%`}</td>
                    </tr>`;
              })()
            : "";

    return `
        <div class="def-options-bar">
            <label class="def-opt-toggle" title="Ignore Evasion, Parry, and Shield Block in both the EHP cards and the Incoming Skill table (useful for guaranteed-hit / CC / pure mitigation comparisons)">
                <input type="checkbox" id="defDisableAvoidChk" ${manualDisableAvoid ? "checked" : ""} />
                <span>Disable Avoidance (Ignore Evasion / Parry / Block)</span>
            </label>
            ${extraAvoidNote}
            <span class="hint-inline">EHP compares <strong>Non-Crit</strong> (0% crit), <strong>Crit</strong> (100% crit vs Resilience), &amp; <strong>Expected</strong> (avg crit rate &amp; bonus${effectiveDisableAvoid ? "" : " &middot; E/P/B = 0% dmg"})</span>
        </div>
        <div class="kpi-row">
            <div class="kpi-card">
                <div class="kpi-label">Survivability Comparison (${primaryRaw ? "Raw Damage Taken" : "% HP Lost"})</div>
                <div class="kpi-value ${hpLossCls(primaryMetricDiff)}">${primaryWinnerTxt}</div>
                <div class="kpi-sub">
                    Avg: <strong class="${hpLossCls(primaryMetricDiff)}">${fmtDeltaPct(primaryMetricDiff)}</strong>
                    &bull; Non-Crit: <strong class="${hpLossCls(avgNonCritHpDiffPct)}">${fmtDeltaPct(avgNonCritHpDiffPct)}</strong>
                    &bull; Crit: <strong class="${hpLossCls(avgCritHpDiffPct)}">${fmtDeltaPct(avgCritHpDiffPct)}</strong>
                    <span class="skill-meta">(${primaryRaw ? `% HP ${fmtDeltaPct(avgHpDiffPct)}` : `raw ${fmtDeltaPct(avgDiffPct)}`})</span>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">Physical Melee EHP (vs ${escHtml(effAttacker.name)})</div>
                <div class="kpi-value"><span class="val-a">${fmtInt(ehpA.ehp.melee.vsAttackerEhp)}</span> / <span class="val-b">${fmtInt(ehpB.ehp.melee.vsAttackerEhp)}</span> <span class="kpi-rate ${ehpCls(meleeEhpDiff)}">(${fmtDeltaPct(meleeEhpDiff)})</span></div>
                <div class="kpi-sub">
                    Non-Crit: <span class="val-a">${fmtInt(ehpA.ehp.melee.vsAttackerNonCritEhp)}</span>/<span class="val-b">${fmtInt(ehpB.ehp.melee.vsAttackerNonCritEhp)}</span> <strong class="${ehpCls(meleeNonCritEhpDiff)}">(${fmtDeltaPct(meleeNonCritEhpDiff)})</strong>
                    &bull; Crit: <span class="val-a">${fmtInt(ehpA.ehp.melee.vsAttackerCritEhp)}</span>/<span class="val-b">${fmtInt(ehpB.ehp.melee.vsAttackerCritEhp)}</span> <strong class="${ehpCls(meleeCritEhpDiff)}">(${fmtDeltaPct(meleeCritEhpDiff)})</strong>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">Magic EHP (vs ${escHtml(effAttacker.name)})</div>
                <div class="kpi-value"><span class="val-a">${fmtInt(ehpA.ehp.magic.vsAttackerEhp)}</span> / <span class="val-b">${fmtInt(ehpB.ehp.magic.vsAttackerEhp)}</span> <span class="kpi-rate ${ehpCls(magicEhpDiff)}">(${fmtDeltaPct(magicEhpDiff)})</span></div>
                <div class="kpi-sub">
                    Non-Crit: <span class="val-a">${fmtInt(ehpA.ehp.magic.vsAttackerNonCritEhp)}</span>/<span class="val-b">${fmtInt(ehpB.ehp.magic.vsAttackerNonCritEhp)}</span> <strong class="${ehpCls(magicNonCritEhpDiff)}">(${fmtDeltaPct(magicNonCritEhpDiff)})</strong>
                    &bull; Crit: <span class="val-a">${fmtInt(ehpA.ehp.magic.vsAttackerCritEhp)}</span>/<span class="val-b">${fmtInt(ehpB.ehp.magic.vsAttackerCritEhp)}</span> <strong class="${ehpCls(magicCritEhpDiff)}">(${fmtDeltaPct(magicCritEhpDiff)})</strong>
                </div>
            </div>
        </div>
        <div class="ehp-compare-box">
            <div class="stat-group-label">Effective HP (EHP): Non-Crit vs Crit vs Expected (vs ${escHtml(effAttacker.name)}${effectiveDisableAvoid ? " &bull; Avoidance Disabled" : ""})</div>
            <div class="table-wrap">
                <table class="mobile-card-table">
                    <thead>
                        <tr>
                            <th>EHP Type</th>
                            <th>Non-Crit EHP (<span class="val-a">A</span> / <span class="val-b">B</span> &middot; &Delta;)</th>
                            <th>Crit EHP (<span class="val-a">A</span> / <span class="val-b">B</span> &middot; &Delta;)</th>
                            <th>Expected EHP (<span class="val-a">A</span> / <span class="val-b">B</span> &middot; &Delta;)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${fmtEhpRow(
                            "Physical Melee EHP",
                            `Def + Tough + Melee DR + Resil${effectiveDisableAvoid ? "" : " + Evasion/Parry/Block"}`,
                            ehpA.ehp.melee,
                            ehpB.ehp.melee,
                            meleeNonCritEhpDiff,
                            meleeCritEhpDiff,
                            meleeEhpDiff,
                            true
                        )}
                        ${fmtEhpRow(
                            "Physical Ranged EHP",
                            `Shield &amp; DW Ranged Parry rules${effectiveDisableAvoid ? "; Avoidance off" : ""}`,
                            ehpA.ehp.ranged,
                            ehpB.ehp.ranged,
                            rangedNonCritEhpDiff,
                            rangedCritEhpDiff,
                            rangedEhpDiff,
                            true
                        )}
                        ${fmtEhpRow(
                            "Magic EHP",
                            "MDef + Tough + Magic DR + Resil; no avoidance",
                            ehpA.ehp.magic,
                            ehpB.ehp.magic,
                            magicNonCritEhpDiff,
                            magicCritEhpDiff,
                            magicEhpDiff,
                            false
                        )}
                    </tbody>
                </table>
            </div>
            <div class="table-wrap" style="margin-top:8px">
                <table class="mobile-card-table mct-cols-3">
                    <thead>
                        <tr>
                            <th>Resilience &amp; Healing Efficiency</th>
                            <th>${escHtml(state.buildA.name)} (A)</th>
                            <th>${escHtml(state.buildB.name)} (B)</th>
                            <th>A vs B</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><strong>Resilience Crit Defense</strong> <span class="skill-meta">(Crit Rate / Crit Damage reduction)</span></td>
                            <td class="val-a" data-label="Build A">-${fmtDec(ehpA.critDefense.critRateReductionPct)}% CR / -${fmtDec(ehpA.critDefense.critBonusReductionPct)}% CD</td>
                            <td class="val-b" data-label="Build B">-${fmtDec(ehpB.critDefense.critRateReductionPct)}% CR / -${fmtDec(ehpB.critDefense.critBonusReductionPct)}% CD</td>
                            <td class="delta-tie" data-label="A vs B">${ehpA.critDefense.resilience - ehpB.critDefense.resilience >= 0 ? "+" : ""}${fmtInt(ehpA.critDefense.resilience - ehpB.critDefense.resilience)} Resil</td>
                        </tr>
                        <tr>
                            <td><strong>Healing Efficiency (Melee)</strong> <span class="skill-meta">(Melee EHP restored per 1,000 raw heal; neutral)</span></td>
                            <td class="val-a" data-label="Build A">${fmtInt(ehpA.healingReceived.effectiveHpPer1kHealMelee)} EHP <span class="skill-meta">(${fmtDec(ehpA.healingReceived.healMultiplier, 2)}&times;)</span></td>
                            <td class="val-b" data-label="Build B">${fmtInt(ehpB.healingReceived.effectiveHpPer1kHealMelee)} EHP <span class="skill-meta">(${fmtDec(ehpB.healingReceived.healMultiplier, 2)}&times;)</span></td>
                            <td class="${ehpCls(healEffMeleeDiff)}" data-label="A vs B">${fmtDeltaPct(healEffMeleeDiff)}</td>
                        </tr>
                        <tr>
                            <td><strong>Healing Efficiency (Magic)</strong> <span class="skill-meta">(Magic EHP restored per 1,000 raw heal; neutral)</span></td>
                            <td class="val-a" data-label="Build A">${fmtInt(ehpA.healingReceived.effectiveHpPer1kHealMagic)} EHP <span class="skill-meta">(${fmtDec(ehpA.healingReceived.healMultiplier, 2)}&times;)</span></td>
                            <td class="val-b" data-label="Build B">${fmtInt(ehpB.healingReceived.effectiveHpPer1kHealMagic)} EHP <span class="skill-meta">(${fmtDec(ehpB.healingReceived.healMultiplier, 2)}&times;)</span></td>
                            <td class="${ehpCls(healEffMagicDiff)}" data-label="A vs B">${fmtDeltaPct(healEffMagicDiff)}</td>
                        </tr>
                        ${flameRowHtml}
                        ${absorbRowHtml}
                    </tbody>
                </table>
            </div>
        </div>`;
}

function renderDefenderComboSection({ effAttacker, baseCtx, manualDisableAvoid, primaryRaw }) {
    const skillById = new Map((state.allSkills || []).map((s) => [s.id, s]));
    const savedCombos = Array.isArray(state.customRotations) ? state.customRotations : [];
    const activeRotSteps = Array.isArray(state.rotationSteps) ? state.rotationSteps : [];

    let selectedComboId = state.defenderComboId || "__active__";
    let selectedComboObj = null;
    if (selectedComboId === "__active__") {
        if (activeRotSteps.length === 0 && savedCombos.length > 0) {
            selectedComboObj = savedCombos[0];
            selectedComboId = selectedComboObj.id;
            state.defenderComboId = selectedComboId;
        }
    } else {
        selectedComboObj = savedCombos.find((c) => c.id === selectedComboId) || null;
        if (!selectedComboObj) {
            selectedComboId = activeRotSteps.length > 0 ? "__active__" : savedCombos[0]?.id || "__active__";
            selectedComboObj = savedCombos.find((c) => c.id === selectedComboId) || null;
            state.defenderComboId = selectedComboId;
        }
    }

    const rawComboSteps =
        selectedComboId === "__active__" ? activeRotSteps : selectedComboObj?.steps || [];
    const resolvedComboSteps = rawComboSteps
        .map((st, idx) => {
            const sk = skillById.get(st.skillId);
            return sk ? { ...st, skill: sk, rawIndex: idx } : null;
        })
        .filter(Boolean);

    const defComboShield = Math.max(0, Number(state.defenderComboShield) || 0);
    const defComboCtxVsA = {
        ...baseCtx,
        disableAvoidance: manualDisableAvoid,
        targetAbsorbShield: defComboShield,
        attackerModifiers: getSlotModifiers("defender"),
        defenderModifiers: getSlotModifiers("A"),
    };
    const defComboCtxVsB = {
        ...baseCtx,
        disableAvoidance: manualDisableAvoid,
        targetAbsorbShield: defComboShield,
        attackerModifiers: getSlotModifiers("defender"),
        defenderModifiers: getSlotModifiers("B"),
    };

    const comboCmp =
        resolvedComboSteps.length > 0
            ? compareDefendersRotation(
                  state.defender,
                  state.buildA,
                  state.buildB,
                  resolvedComboSteps,
                  defComboCtxVsA,
                  defComboCtxVsB
              )
            : null;

    if (!comboCmp || comboCmp.resultVsA.stepCount === 0) {
        return {
            selectedComboId,
            savedCombos,
            html: `
            <div class="def-combo-box">
                <div class="def-combo-header">
                    <div class="stat-group-label" style="margin:0">Incoming Combo / Burst Survivability (vs ${escHtml(effAttacker.name)})</div>
                    <button type="button" class="sm primary" id="defComboEditBtn">Build Combo in Rotation Tab &rarr;</button>
                </div>
                <p class="hint-inline" style="margin:6px 0 0">No saved combos yet. Create a combo in the <strong>Rotation / Burst Combo</strong> tab to compare how Defender A vs Defender B survive a full incoming skill sequence (exact death &amp; survival probability).</p>
            </div>`,
        };
    }

    const activeComboLabel = (() => {
        if (state.activeRotationId) {
            const found = savedCombos.find((c) => c.id === state.activeRotationId);
            if (found) return `Active Rotation (${found.label} · ${activeRotSteps.length} steps)`;
        }
        return `Active Rotation (${activeRotSteps.length} step${activeRotSteps.length === 1 ? "" : "s"})`;
    })();

    const comboOptionsHtml = [
        activeRotSteps.length > 0
            ? `<option value="__active__" ${selectedComboId === "__active__" ? "selected" : ""}>${escHtml(activeComboLabel)}</option>`
            : "",
        ...savedCombos.map(
            (c) =>
                `<option value="${escHtml(c.id)}" ${selectedComboId === c.id ? "selected" : ""}>${escHtml(c.label)} (${(c.steps || []).length} steps)</option>`
        ),
    ]
        .filter(Boolean)
        .join("");

    const cA = comboCmp.resultVsA;
    const cB = comboCmp.resultVsB;
    const comboPrimaryDiff = primaryRaw ? comboCmp.deltaExpectedPct : comboCmp.deltaHpPct;
    const comboWinner = primaryRaw ? comboCmp.tankierByRaw : comboCmp.tankierByHpPct;
    const comboWinnerTxt =
        comboWinner === "A"
            ? `${escHtml(state.buildA.name)} survives better`
            : comboWinner === "B"
              ? `${escHtml(state.buildB.name)} survives better`
              : "Equal";
    const survDiff = comboCmp.survivalProbA - comboCmp.survivalProbB;
    const p90HpA = cA.targetMaxHp > 0 ? (cA.quantiles.p90 / cA.targetMaxHp) * 100 : 0;
    const p90HpB = cB.targetMaxHp > 0 ? (cB.quantiles.p90 / cB.targetMaxHp) * 100 : 0;
    const ttdA = cA.estimatedTtkSec != null ? `${fmtDec(cA.estimatedTtkSec, 2)}s` : "&mdash;";
    const ttdB = cB.estimatedTtkSec != null ? `${fmtDec(cB.estimatedTtkSec, 2)}s` : "&mdash;";
    const killStepTxt = (res) =>
        res.killStepIndex >= 0
            ? `Kills @ step ${res.killStepIndex + 1} (${fmtDec(res.killTimestampSec, 2)}s)`
            : "Survives avg";

    const stepRowsHtml = cA.steps
        .map((sA, idx) => {
            const sB = cB.steps[idx];
            const skIcon = skillIconUrl(sA.skill);
            if (sA.isUtility) {
                const isEq = sA.skill.skillset === "equipment";
                const uCls = isEq
                    ? "stag-equip"
                    : sA.skill.utilityRole === "cc"
                      ? "stag-cc"
                      : sA.skill.utilityRole === "debuff"
                        ? "stag-debuff-role"
                        : "stag-util";
                const uLbl = isEq
                    ? sA.skill.utilityRole === "cc"
                        ? "EQUIP CC"
                        : "EQUIP"
                    : sA.skill.utilityRole === "cc"
                      ? "CC"
                      : sA.skill.utilityRole === "debuff"
                        ? "DEBUFF"
                        : "UTILITY";
                const uSummary =
                    sA.grantedStatuses?.length > 0
                        ? `Applies ${sA.grantedStatuses.join(", ")}`
                        : sA.grantedComboEffect?.summary || sA.skill.utilitySummary || "Applies combo setup / status";
                return `
                <tr class="def-combo-util-row">
                    <td>${idx + 1}</td>
                    <td>
                        <div class="table-skill-cell">
                            ${skIcon ? `<img class="table-skill-icon" src="${escHtml(skIcon)}" alt="" loading="lazy" />` : ""}
                            <div>
                                <div class="skill-name">${escHtml(sA.skill.name)} <span class="stag ${uCls}">${uLbl}</span></div>
                                <div class="skill-meta">@ ${fmtDec(sA.startSec, 2)}s &rarr; ${fmtDec(sA.endSec, 2)}s</div>
                            </div>
                        </div>
                    </td>
                    <td colspan="3" class="skill-meta">${escHtml(uSummary)}</td>
                </tr>`;
            }
            const expA = sA.result.expected;
            const expB = sB ? sB.result.expected : 0;
            const hpStepA = cA.targetMaxHp > 0 ? (expA / cA.targetMaxHp) * 100 : 0;
            const hpStepB = cB.targetMaxHp > 0 ? (expB / cB.targetMaxHp) * 100 : 0;
            const stepRawDiff = pctDiff(expA, expB);
            const stepHpDiff = pctDiff(hpStepA, hpStepB);
            const stepMainDiff = primaryRaw ? stepRawDiff : stepHpDiff;

            const cumA = sA.cumulativeExpected;
            const cumB = sB ? sB.cumulativeExpected : 0;
            const cumHpA = cA.targetMaxHp > 0 ? (cumA / cA.targetMaxHp) * 100 : 0;
            const cumHpB = cB.targetMaxHp > 0 ? (cumB / cB.targetMaxHp) * 100 : 0;

            const avA = sA.result.breakdown?.avoidance;
            const avB = sB?.result?.breakdown?.avoidance;
            const hitInfo =
                avA && avB ? `${fmtDec(avA.connectPct, 0)}% / ${fmtDec(avB.connectPct, 0)}% Hit` : "Guaranteed";
            const crA = sA.result.breakdown?.effectiveCritRatePct ?? 0;
            const crB = sB?.result?.breakdown?.effectiveCritRatePct ?? 0;
            const tags = [
                ...(sA.autoComboLabels || []).map((l) => `<span class="stag stag-autocombo">&#10022; ${escHtml(l)}</span>`),
                sA.autoCCLabel ? `<span class="stag stag-autocc">&#10022; ${escHtml(sA.autoCCLabel)}</span>` : "",
                sA.weaponProcLabel ? `<span class="stag stag-proc">&#9876; ${escHtml(sA.weaponProcLabel)}</span>` : "",
            ]
                .filter(Boolean)
                .join(" ");

            return `
            <tr>
                <td class="def-combo-step-num">${idx + 1}</td>
                <td>
                    <div class="table-skill-cell">
                        ${skIcon ? `<img class="table-skill-icon" src="${escHtml(skIcon)}" alt="" loading="lazy" />` : ""}
                        <div>
                            <div class="skill-name">${escHtml(sA.skill.name)} ${tags}</div>
                            <div class="skill-meta">@ ${fmtDec(sA.startSec, 2)}s &rarr; ${fmtDec(sA.endSec, 2)}s &bull; ${sA.skill.damageType}</div>
                        </div>
                    </div>
                </td>
                <td data-label="Step Expected (A / B)" title="Raw delta: ${fmtDeltaPct(stepRawDiff)} | % HP delta: ${fmtDeltaPct(stepHpDiff)}">
                    <div class="def-cmp-main">
                        <span class="val-a">${fmtInt(expA)}</span>
                        <span class="def-cmp-sep">/</span>
                        <span class="val-b">${fmtInt(expB)}</span>
                        <span class="def-cmp-delta ${hpLossCls(stepMainDiff)}">${fmtDeltaPct(stepMainDiff)}</span>
                    </div>
                    <div class="skill-meta">${fmtDec(hpStepA)}% vs ${fmtDec(hpStepB)}% HP</div>
                </td>
                <td data-label="Cumulative Taken">
                    <div class="def-cmp-main">
                        <span class="val-a">${fmtInt(cumA)}</span>
                        <span class="def-cmp-sep">/</span>
                        <span class="val-b">${fmtInt(cumB)}</span>
                    </div>
                    <div class="skill-meta">${fmtDec(cumHpA)}% vs ${fmtDec(cumHpB)}% Max HP</div>
                </td>
                <td class="skill-meta mct-full" data-label="Hit / Crit (A / B)">
                    <div>${hitInfo}</div>
                    <div>Crit: ${fmtDec(crA, 0)}% / ${fmtDec(crB, 0)}%</div>
                </td>
            </tr>`;
        })
        .join("");

    return {
        selectedComboId,
        savedCombos,
        html: `
        <div class="def-combo-box">
            <div class="def-combo-header">
                <div class="stat-group-label" style="margin:0">Incoming Combo / Burst Survivability (${escHtml(effAttacker.name)} &rarr; <span class="val-a">A</span> vs <span class="val-b">B</span>)</div>
                <div class="def-combo-controls">
                    <label class="def-combo-ctrl">
                        <span>Combo</span>
                        <select id="defComboSelect">${comboOptionsHtml}</select>
                    </label>
                    <label class="def-combo-ctrl" title="Optional absorb shield HP on both defenders (e.g. Insulating Lens / Conversion Shield)">
                        <span>Shield HP</span>
                        <input type="number" id="defComboShieldInput" min="0" step="500" value="${defComboShield}" style="width:82px" />
                    </label>
                    <button type="button" class="sm" id="defComboEditBtn" title="Open &amp; customize this combo in the Rotation Builder tab">Edit Combo &rarr;</button>
                </div>
            </div>
            <div class="kpi-row def-combo-kpis">
                <div class="kpi-card">
                    <div class="kpi-label">Combo Survivability (${primaryRaw ? "Raw Taken" : "% HP Lost"})</div>
                    <div class="kpi-value ${hpLossCls(comboPrimaryDiff)}">${comboWinnerTxt}</div>
                    <div class="kpi-sub">
                        <span class="val-a">${fmtInt(cA.totalExpected)}</span> (<span class="val-a">${fmtDec(cA.pctOfTargetHp)}%</span>) /
                        <span class="val-b">${fmtInt(cB.totalExpected)}</span> (<span class="val-b">${fmtDec(cB.pctOfTargetHp)}%</span>)
                        <strong class="${hpLossCls(comboPrimaryDiff)}">(${fmtDeltaPct(comboPrimaryDiff)})</strong>
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Exact Survival Probability</div>
                    <div class="kpi-value">
                        <span class="val-a">${fmtDec(comboCmp.survivalProbA)}%</span> / <span class="val-b">${fmtDec(comboCmp.survivalProbB)}%</span>
                        <span class="kpi-rate ${ehpCls(survDiff)}">(${survDiff >= 0 ? "+" : ""}${fmtDec(survDiff)}pp)</span>
                    </div>
                    <div class="kpi-sub">
                        Death Prob: <span class="val-a">${fmtDec(cA.killProbPct)}%</span> vs <span class="val-b">${fmtDec(cB.killProbPct)}%</span>
                        ${defComboShield > 0 ? ` &bull; +${fmtInt(defComboShield)} shield` : ""}
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Burst Taken (P50 / P90)</div>
                    <div class="kpi-value">
                        <span class="val-a">${fmtInt(cA.quantiles.median)}</span> / <span class="val-b">${fmtInt(cB.quantiles.median)}</span>
                    </div>
                    <div class="kpi-sub">
                        P90: <span class="val-a">${fmtInt(cA.quantiles.p90)}</span> (${fmtDec(p90HpA)}%) vs <span class="val-b">${fmtInt(cB.quantiles.p90)}</span> (${fmtDec(p90HpB)}%)
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Window &amp; Est. Time-to-Die</div>
                    <div class="kpi-value">
                        <span class="val-a">${ttdA}</span> / <span class="val-b">${ttdB}</span>
                    </div>
                    <div class="kpi-sub">
                        ${fmtDec(cA.totalDurationSec, 2)}s window &bull; A: ${killStepTxt(cA)} &bull; B: ${killStepTxt(cB)}
                    </div>
                </div>
            </div>
            <details class="def-combo-steps-details" open>
                <summary>Per-Step Incoming Combo Breakdown (${cA.stepCount} step${cA.stepCount === 1 ? "" : "s"})</summary>
                <div class="table-wrap" style="margin-top:6px">
                    <table class="mobile-card-table mct-skip-rank">
                        <thead>
                            <tr>
                                <th style="width:28px">#</th>
                                <th>Incoming Step</th>
                                <th>Step Expected (<span class="val-a">A</span> / <span class="val-b">B</span> &middot; &Delta;${primaryRaw ? " Raw" : "% HP"})</th>
                                <th>Cumulative Taken</th>
                                <th>Hit / Crit (<span class="val-a">A</span> / <span class="val-b">B</span>)</th>
                            </tr>
                        </thead>
                        <tbody>${stepRowsHtml}</tbody>
                    </table>
                </div>
            </details>
        </div>`,
    };
}

function renderDefenderSkillsTable(rows, primaryRaw) {
    const fmtSkillTakenCell = (label, dmgA, dmgB, hpA, hpB, hpDiff, rawDiff, full = false) => {
        const mainDiff = primaryRaw ? rawDiff : hpDiff;
        return `
        <td class="${full ? "mct-full" : ""}" data-label="${label}" title="Raw dmg delta: ${fmtDeltaPct(rawDiff)} | % HP lost delta: ${fmtDeltaPct(hpDiff)}">
            <div class="def-cmp-main">
                <span class="val-a">${fmtInt(dmgA)}</span>
                <span class="def-cmp-sep">/</span>
                <span class="val-b">${fmtInt(dmgB)}</span>
                <span class="def-cmp-delta ${hpLossCls(mainDiff)}">${fmtDeltaPct(mainDiff)}</span>
            </div>
            <div class="skill-meta">${fmtDec(hpA)}% vs ${fmtDec(hpB)}% HP</div>
        </td>`;
    };

    const bodyHtml = rows
        .map((r) => {
            const skIcon = skillIconUrl(r.skill);
            const avA = r.resVsA.breakdown?.avoidance;
            const hitTxt = avA ? ` &bull; ${fmtDec(avA.connectPct)}% Hit` : "";
            return `
            <tr class="skill-row ${r.skill.id === state.selectedSkillId ? "selected" : ""}" data-skill-id="${escHtml(r.skill.id)}">
                <td>
                    <div class="table-skill-cell">
                        ${skIcon ? `<img class="table-skill-icon" src="${escHtml(skIcon)}" alt="" loading="lazy" />` : ""}
                        <div>
                            <div class="skill-name">${escHtml(r.skill.name)}</div>
                            <div class="skill-meta">${escHtml(r.skill.skillset)} &bull; ${formatRankTag(r.resVsA)} &bull; ${r.skill.damageType}${hitTxt}</div>
                        </div>
                    </div>
                </td>
                ${fmtSkillTakenCell("Non-Crit (A / B)", r.resVsA.normal, r.resVsB.normal, r.normalHpA, r.normalHpB, r.normalHpDiffPct, r.normalDiffPct)}
                ${fmtSkillTakenCell("Crit (A / B)", r.resVsA.crit, r.resVsB.crit, r.critHpA, r.critHpB, r.critHpDiffPct, r.critDiffPct)}
                ${fmtSkillTakenCell("Expected Avg (A / B)", r.resVsA.expected, r.resVsB.expected, r.resVsA.pctOfDefenderHp.expected, r.resVsB.pctOfDefenderHp.expected, r.hpDiffPct, r.diffPct, true)}
            </tr>`;
        })
        .join("");

    return `
        <div class="table-wrap">
            <table class="mobile-card-table">
                <thead>
                    <tr>
                        <th>Incoming Skill</th>
                        <th>Non-Crit Hit (<span class="val-a">A</span> / <span class="val-b">B</span> &middot; &Delta;${primaryRaw ? " Raw" : "% HP"})</th>
                        <th>Crit Hit (<span class="val-a">A</span> / <span class="val-b">B</span> &middot; &Delta;${primaryRaw ? " Raw" : "% HP"})</th>
                        <th>Expected Avg (<span class="val-a">A</span> / <span class="val-b">B</span> &middot; &Delta;${primaryRaw ? " Raw" : "% HP"})</th>
                    </tr>
                </thead>
                <tbody>${bodyHtml}</tbody>
            </table>
        </div>`;
}

export function renderDefenderComparison(out) {
    const skills = getFilteredSkills().filter((s) => s.kind !== "heal");
    if (skills.length === 0) {
        out.innerHTML = `<p class="hint-inline">No damage skills match the current filter.</p>`;
        return;
    }

    const baseCtx = getContext();
    const hasCCStatus = Array.from(state.targetComboStatuses || []).some((s) =>
        ["impaled", "tripped", "stunned"].includes(s)
    );
    const manualDisableAvoid = Boolean(state.defenderDisableAvoidance);
    const effectiveDisableAvoid = Boolean(
        manualDisableAvoid || baseCtx.isBackstab || baseCtx.targetIsCCd || hasCCStatus
    );

    const rows = computeDefenderSkillRows(skills, baseCtx, manualDisableAvoid);
    const avgDiffPct = rows.reduce((s, r) => s + r.diffPct, 0) / rows.length;
    const avgHpDiffPct = rows.reduce((s, r) => s + r.hpDiffPct, 0) / rows.length;
    const avgNonCritHpDiffPct = rows.reduce((s, r) => s + r.normalHpDiffPct, 0) / rows.length;
    const avgCritHpDiffPct = rows.reduce((s, r) => s + r.critHpDiffPct, 0) / rows.length;

    const effAttacker = applyModifiers(state.defender, getSlotModifiers("defender"));
    const effDefA = applyModifiers(state.buildA, getSlotModifiers("A"));
    const effDefB = applyModifiers(state.buildB, getSlotModifiers("B"));
    const ehpOpts = { isPvE: baseCtx.isPvE, disableAvoidance: effectiveDisableAvoid };
    const ehpA = computeEffectiveStats(effDefA, effAttacker, {}, ehpOpts).defense;
    const ehpB = computeEffectiveStats(effDefB, effAttacker, {}, ehpOpts).defense;

    const primaryRaw = state.settings?.defenderPrimaryMetric === "raw";

    const ehpSectionHtml = renderDefenderEhpSection({
        effAttacker,
        effDefA,
        effDefB,
        ehpA,
        ehpB,
        effectiveDisableAvoid,
        manualDisableAvoid,
        primaryRaw,
        avgDiffPct,
        avgHpDiffPct,
        avgNonCritHpDiffPct,
        avgCritHpDiffPct,
    });
    const comboSection = renderDefenderComboSection({
        effAttacker,
        baseCtx,
        manualDisableAvoid,
        primaryRaw,
    });
    const skillsTableHtml = renderDefenderSkillsTable(rows, primaryRaw);

    out.innerHTML = `
        ${ehpSectionHtml}
        ${comboSection.html}
        ${renderStatWeightsBox(null, "defense", baseCtx, {
            ehpKind: state.statWeightsDefKind || "melee",
            disableAvoidance: effectiveDisableAvoid,
        })}
        ${skillsTableHtml}
    `;

    document.getElementById("defDisableAvoidChk")?.addEventListener("change", (e) => {
        state.defenderDisableAvoidance = Boolean(e.target.checked);
        ui.updateBuffedStatsPanel("A");
        ui.updateBuffedStatsPanel("B");
        ui.updateBuffedStatsPanel("defender");
        ui.renderSimulation();
    });

    document.getElementById("defComboSelect")?.addEventListener("change", (e) => {
        state.defenderComboId = e.target.value || "__active__";
        ui.renderSimulation();
    });

    document.getElementById("defComboShieldInput")?.addEventListener("change", (e) => {
        state.defenderComboShield = Math.max(0, Number(e.target.value) || 0);
        ui.renderSimulation();
    });

    document.getElementById("defComboEditBtn")?.addEventListener("click", () => {
        if (comboSection.selectedComboId && comboSection.selectedComboId !== "__active__") {
            const chosen = comboSection.savedCombos.find((c) => c.id === comboSection.selectedComboId);
            if (chosen) {
                state.activeRotationId = chosen.id;
                state.rotationSteps = (chosen.steps || []).map((s) => ({ ...s }));
            }
        }
        switchAppMode("rotation", { renderCards: true });
    });

    out.querySelectorAll("[data-sw-tier]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.statWeightsTierFilter = btn.dataset.swTier;
            ui.renderSimulation();
        });
    });

    out.querySelectorAll("[data-sw-defkind]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.statWeightsDefKind = btn.dataset.swDefkind;
            ui.renderSimulation();
        });
    });

    out.querySelectorAll("tr.skill-row").forEach((tr) => {
        tr.addEventListener("click", () => {
            if (!state.isCustomSkill) {
                state.selectedSkillId = tr.dataset.skillId;
                ui.renderSkillBrowser();
                ui.renderSimulation();
            }
        });
    });
}
