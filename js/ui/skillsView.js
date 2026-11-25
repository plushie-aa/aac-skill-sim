/**
 * Single-Skill & Healing Comparison View (Build A vs Build B) + Waterfall Breakdown.
 */

import {
    applyModifiers,
    compareBuilds,
    computeEffectiveStats,
    computeStatWeights,
    defenseMitigationPct,
    toughnessMitigationPct,
} from "../engine/index.js";
import {
    escHtml,
    fmtDec,
    fmtDeltaPct,
    fmtInt,
    formatGcdSummaryText,
    formatRankTag,
    getContext,
    getFilteredSkills,
    getSlotModifiers,
    skillIconUrl,
    state,
    ui,
} from "./state.js";

export function renderBuildComparison(out) {
    const skills = getFilteredSkills();

    if (skills.length === 0) {
        out.innerHTML = `<p class="hint-inline">No skills match the current filter.</p>`;
        return;
    }

    const antiHealPct = state.mode === "healing" ? Number(state.healingAntiHealPct) || 0 : 0;
    const baseCtx = { ...getContext(), ...(antiHealPct !== 0 ? { antiHealPct } : {}) };
    const rows = skills.map((skill) => {
        const ctxA = { ...baseCtx, attackerModifiers: getSlotModifiers("A") };
        const ctxB = { ...baseCtx, attackerModifiers: getSlotModifiers("B") };
        const cmpA = compareBuilds(state.buildA, state.buildA, state.defender, [skill], ctxA).rows[0].resultA;
        const cmpB = compareBuilds(state.buildB, state.buildB, state.defender, [skill], ctxB).rows[0].resultA;
        const delta = cmpA.expected - cmpB.expected;
        const deltaPct = cmpB.expected > 0 ? (delta / cmpB.expected) * 100 : 0;
        const winner = Math.abs(delta) < 1e-6 ? "tie" : delta > 0 ? "A" : "B";
        return { skill, resultA: cmpA, resultB: cmpB, delta, deltaPct, winner };
    });

    if (!state.isCustomSkill && (!state.selectedSkillId || !rows.some((r) => r.skill.id === state.selectedSkillId))) {
        state.selectedSkillId = rows[0].skill.id;
    }

    const winsA = rows.filter((r) => r.winner === "A").length;
    const winsB = rows.filter((r) => r.winner === "B").length;
    const avgDeltaPct = rows.reduce((s, r) => s + r.deltaPct, 0) / rows.length;
    const topA = rows.reduce((best, r) => (r.resultA.expected > best.resultA.expected ? r : best), rows[0]);

    const selectedRow = rows.find((r) => r.skill.id === state.selectedSkillId) || rows[0];
    const isHealMode = rows.every((r) => r.resultA.kind === "heal");
    const rateUnit = isHealMode ? "HPS" : "DPS";
    const effDefender = applyModifiers(state.defender, getSlotModifiers("defender"));
    const effBuildA = applyModifiers(state.buildA, getSlotModifiers("A"));
    const effBuildB = applyModifiers(state.buildB, getSlotModifiers("B"));
    const calcA = computeEffectiveStats(effBuildA, effDefender, {}, { isPvE: baseCtx.isPvE });
    const calcB = computeEffectiveStats(effBuildB, effDefender, {}, { isPvE: baseCtx.isPvE });

    const fmtRateCell = (res) => {
        const d = res.dps;
        if (!d) return "&mdash;";
        if (d.isOffGcd) {
            const sust = d.sustained != null ? `${fmtInt(d.sustained)}/s` : "Off-GCD";
            const sub = d.cooldownSec > 0 ? `Off-GCD &bull; ${fmtDec(d.cooldownSec, 0)}s CD` : "Off-GCD instant";
            return `<div><strong>${sust}</strong></div><div class="skill-meta">${sub}</div>`;
        }
        if (d.cycleReason === "duration") {
            return `<div><strong>${fmtInt(d.sustained)}/s</strong></div><div class="skill-meta">${fmtDec(d.cycleTimeSec, 0)}s HoT &bull; ${fmtDec(d.gcdSec, 2)}s GCD</div>`;
        }
        const hasCdDiff = d.cycleTimeSec > d.execTimeSec + 0.05 && d.burst != null;
        if (hasCdDiff) {
            const castPart =
                d.effectiveCastTimeSec > 0
                    ? ` (${fmtDec(d.effectiveCastTimeSec, 2)}s+${fmtDec(d.postCastDelaySec, 2)}s)`
                    : "";
            return `<div><strong>${fmtInt(d.sustained)}/s</strong></div><div class="skill-meta">${fmtInt(d.burst)}/s cast${castPart}</div>`;
        }
        const subTag =
            d.effectiveCastTimeSec > 0
                ? `${fmtDec(d.effectiveCastTimeSec, 2)}s cast + ${fmtDec(d.postCastDelaySec, 2)}s GCD`
                : d.gcdKind === "rapid"
                  ? `No GCD &bull; ${fmtDec(d.effectiveFireIntervalSec, 2)}s/hit`
                  : d.isReducedGcd
                    ? `${fmtDec(d.gcdSec, 2)}s GCD`
                    : "";
        return `<div><strong>${d.sustained != null ? `${fmtInt(d.sustained)}/s` : "&mdash;"}</strong></div>${subTag ? `<div class="skill-meta">${subTag}</div>` : ""}`;
    };

    const thirdKpiHtml = isHealMode
        ? (() => {
              const ha = calcA.offense.healing;
              const hb = calcB.offense.healing;
              const diffPct =
                  hb.selfEffectiveHealingPower > 0
                      ? ((ha.selfEffectiveHealingPower - hb.selfEffectiveHealingPower) /
                            hb.selfEffectiveHealingPower) *
                        100
                      : 0;
              const effRecvHealPct = ha.targetRecvHealPct + antiHealPct;
              const antiHealNote = antiHealPct !== 0 ? ` (incl. ${antiHealPct}% Anti-Heal)` : "";
              return `
              <div class="kpi-card">
                  <div class="kpi-label">Effective Healing Power (A vs B)</div>
                  <div class="kpi-value"><span class="val-a">${fmtInt(ha.selfEffectiveHealingPower)}</span> / <span class="val-b">${fmtInt(hb.selfEffectiveHealingPower)}</span> <span class="kpi-rate ${diffPct > 0.05 ? "delta-pos" : diffPct < -0.05 ? "delta-neg" : "delta-tie"}">(${fmtDeltaPct(diffPct)})</span></div>
                  <div class="kpi-sub">Cast-adj: ${fmtInt(ha.castAdjustedHealingPower)} vs ${fmtInt(hb.castAdjustedHealingPower)} &bull; Target Recv Heal ${effRecvHealPct >= 0 ? "+" : ""}${fmtDec(effRecvHealPct)}%${antiHealNote}</div>
              </div>`;
          })()
        : `
          <div class="kpi-card">
              <div class="kpi-label">Target Effective Mitigation &amp; EHP</div>
              <div class="kpi-value">${fmtDec(defenseMitigationPct(effDefender.defense.physicalDefense))}% P / ${fmtDec(defenseMitigationPct(effDefender.defense.magicDefense))}% M</div>
              <div class="kpi-sub">Tough ${fmtDec(toughnessMitigationPct(effDefender.defense.toughness))}% &bull; ${effDefender.defense.hasShield ? "Shield On" : "No Shield"}${effDefender.defense.dualWieldRangedParry ? " &bull; DW Parry" : ""} &bull; Melee EHP ${fmtInt(calcA.defense ? computeEffectiveStats(effDefender, effBuildA, {}, { isPvE: baseCtx.isPvE }).defense.ehp.melee.vsAttackerEhp : 0)}</div>
          </div>`;

    const healAntiHealBarHtml = isHealMode
        ? `<div class="heal-antiheal-bar">
               <span class="hint-inline"><strong>Target Anti-Heal Debuff:</strong></span>
               <div class="seg-group" id="healAntiHealPills">
                   <button type="button" class="seg-btn ${antiHealPct === 0 ? "active" : ""}" data-anti-heal="0">None (0%)</button>
                   <button type="button" class="seg-btn ${antiHealPct === -30 ? "active" : ""}" data-anti-heal="-30" title="Mirror Light / Distress: -30% Received Healing">Mirror Light (&minus;30%)</button>
                   <button type="button" class="seg-btn ${antiHealPct === -60 ? "active" : ""}" data-anti-heal="-60" title="Stalker's Mark / Inflicted Anti-Heal: -60% Received Healing">Stalker&rsquo;s Mark (&minus;60%)</button>
               </div>
               <span class="hint-inline">Effective target Received Healing: <strong>${(calcA.offense.healing.targetRecvHealPct + antiHealPct) >= 0 ? "+" : ""}${fmtDec(calcA.offense.healing.targetRecvHealPct + antiHealPct)}%</strong></span>
           </div>`
        : "";

    out.innerHTML = `
        ${healAntiHealBarHtml}
        <div class="kpi-row">
            <div class="kpi-card">
                <div class="kpi-label">${rows.length === 1 ? "Expected Advantage" : "Average Expected Advantage"}</div>
                <div class="kpi-value ${avgDeltaPct > 0.05 ? "delta-pos" : avgDeltaPct < -0.05 ? "delta-neg" : "delta-tie"}">
                    ${avgDeltaPct > 0.05 ? escHtml(state.buildA.name) : avgDeltaPct < -0.05 ? escHtml(state.buildB.name) : "Tie"}
                    (${fmtDeltaPct(avgDeltaPct)})
                </div>
                <div class="kpi-sub">Build A wins ${winsA} &bull; Build B wins ${winsB} (${rows.length} ${rows.length === 1 ? "skill" : "skills"})</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">${rows.length === 1 ? `Expected &amp; Avg ${rateUnit} (${escHtml(state.buildA.name)})` : `Highest Expected (${escHtml(state.buildA.name)})`}</div>
                <div class="kpi-value val-a">${fmtInt(topA.resultA.expected)} <span class="kpi-rate">&bull; ${fmtInt(topA.resultA.dps?.sustained ?? 0)} ${rateUnit}</span></div>
                <div class="kpi-sub">${escHtml(topA.skill.name)} (${formatRankTag(topA.resultA)}${topA.resultA.breakdown?.avoidance ? ` &bull; ${fmtDec(topA.resultA.breakdown.avoidance.connectPct)}% Hit` : ""} &bull; ${formatGcdSummaryText(topA.resultA.dps)} &bull; ${fmtDec(topA.resultA.kind === "heal" ? topA.resultA.pctOfTargetHp.expected : topA.resultA.pctOfDefenderHp.expected)}% HP)</div>
            </div>
            ${thirdKpiHtml}
        </div>

        <div class="table-wrap">
            <table class="mobile-card-table mct-cols-3">
                <thead>
                    <tr>
                        <th>Skill</th>
                        <th>A Normal</th>
                        <th>A Crit</th>
                        <th>A Expected</th>
                        <th>A Avg ${rateUnit}</th>
                        <th>B Normal</th>
                        <th>B Crit</th>
                        <th>B Expected</th>
                        <th>B Avg ${rateUnit}</th>
                        <th>A vs B</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows
                        .map((r) => {
                            const isSel = r.skill.id === selectedRow.skill.id;
                            const dCls = r.deltaPct > 0.05 ? "delta-pos" : r.deltaPct < -0.05 ? "delta-neg" : "delta-tie";
                            const hpPctA =
                                r.resultA.kind === "heal"
                                    ? r.resultA.pctOfTargetHp.expected
                                    : r.resultA.pctOfDefenderHp.expected;
                            const skIcon = skillIconUrl(r.skill);
                            const avA = r.resultA.breakdown?.avoidance;
                            const hitTag = avA
                                ? avA.totalAvoidancePct > 0.05 || avA.missPct > 0.05
                                    ? ` &bull; ${fmtDec(avA.connectPct)}% Hit`
                                    : avA.bypassReason
                                      ? ` &bull; 100% Hit`
                                      : ` &bull; ${fmtDec(avA.connectPct)}% Hit`
                                : "";
                            const gemA = Number(r.resultA.breakdown?.skillGemBonusPct) || 0;
                            const gemB = Number(r.resultB.breakdown?.skillGemBonusPct) || 0;
                            const gemBadge =
                                gemA > 0 || gemB > 0
                                    ? ` <span class="stag stag-gem" title="Skill-specific Lunagem bonus automatically read from equipped gear">&#128142; ${gemA === gemB ? `+${fmtDec(gemA, 0)}% gem` : `A +${fmtDec(gemA, 0)}% / B +${fmtDec(gemB, 0)}%`}</span>`
                                    : "";
                            const comboPctA = Number(r.resultA.breakdown?.comboBonusPct) || 0;
                            const comboLbls = r.resultA.breakdown?.comboLabels || [];
                            const comboTag =
                                comboPctA > 0
                                    ? ` <span class="stag stag-autocombo" title="Active Target Combo Debuff">${comboLbls.length ? escHtml(comboLbls.join(", ")) : `+${fmtDec(comboPctA, 0)}% Combo`}</span>`
                                    : "";
                            const secA = r.resultA.secondary;
                            const secTag = secA
                                ? ` <span class="stag stag-dot" title="${escHtml(secA.label)}: +${fmtInt(secA.expected)} expected (+${fmtInt(secA.normal)} norm)">+${escHtml(secA.shortLabel || "DoT")}</span>`
                                : "";
                            return `
                            <tr class="skill-row ${isSel ? "selected" : ""}" data-skill-id="${escHtml(r.skill.id)}">
                                <td>
                                    <div class="table-skill-cell">
                                        ${skIcon ? `<img class="table-skill-icon" src="${escHtml(skIcon)}" alt="" loading="lazy" />` : ""}
                                        <div>
                                            <div class="skill-name">${escHtml(r.skill.name)}${gemBadge}${comboTag}${secTag}</div>
                                            <div class="skill-meta">
                                                ${escHtml(r.skill.skillset)} &bull; ${formatRankTag(r.resultA)} &bull; ${r.skill.kind === "heal" ? "Heal" : r.skill.damageType}
                                                ${r.resultA.hitCount > 1 ? ` &bull; ${r.resultA.hitCount} hits` : ""}${hitTag}
                                                &bull; ${fmtDec(hpPctA)}% HP
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td data-label="A Normal">${fmtInt(r.resultA.normal)}</td>
                                <td data-label="A Crit">${fmtInt(r.resultA.crit)}</td>
                                <td class="val-a" data-label="A Expected">${fmtInt(r.resultA.expected)}</td>
                                <td class="val-a" data-label="A Avg ${rateUnit}">${fmtRateCell(r.resultA)}</td>
                                <td data-label="B Normal">${fmtInt(r.resultB.normal)}</td>
                                <td data-label="B Crit">${fmtInt(r.resultB.crit)}</td>
                                <td class="val-b" data-label="B Expected">${fmtInt(r.resultB.expected)}</td>
                                <td class="val-b" data-label="B Avg ${rateUnit}">${fmtRateCell(r.resultB)}</td>
                                <td class="${dCls}" data-label="A vs B">${fmtDeltaPct(r.deltaPct)}</td>
                            </tr>`;
                        })
                        .join("")}
                </tbody>
            </table>
        </div>

        ${renderBreakdownBox(selectedRow)}
        ${renderStatWeightsBox(selectedRow.skill, isHealMode ? "healing" : "offense", baseCtx)}
    `;

    out.querySelectorAll("tr.skill-row").forEach((tr) => {
        tr.addEventListener("click", () => {
            if (!state.isCustomSkill) {
                state.selectedSkillId = tr.dataset.skillId;
                ui.renderSkillBrowser();
            }
            ui.renderSimulation();
        });
    });

    out.querySelectorAll("[data-sw-tier]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.statWeightsTierFilter = btn.dataset.swTier;
            ui.renderSimulation();
        });
    });

    out.querySelectorAll("[data-anti-heal]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.healingAntiHealPct = Number(btn.dataset.antiHeal) || 0;
            ui.renderSimulation();
        });
    });
}

export function renderStatWeightsBox(skill, mode, baseCtx, extraOpts = {}) {
    const isDef = mode === "defense";
    const ehpKind = extraOpts.ehpKind || state.statWeightsDefKind || "melee";
    const res = computeStatWeights(state.buildA, state.defender, {
        mode,
        skill,
        ehpKind,
        context: baseCtx,
        buildModifiers: getSlotModifiers("A"),
        opponentModifiers: getSlotModifiers("defender"),
        disableAvoidance: Boolean(extraOpts.disableAvoidance),
    });

    const tierFilter = state.statWeightsTierFilter || "all";
    const filtered =
        tierFilter === "all"
            ? res.items
            : res.items.filter((it) => it.tier === tierFilter || (tierFilter === "synth" && it.tier === "attr"));
    const maxPct = Math.max(0.01, ...filtered.map((it) => it.gainPct));
    const unitLabel = isDef ? `${ehpKind[0].toUpperCase() + ehpKind.slice(1)} EHP` : mode === "healing" ? "Expected Heal" : "Expected Dmg";
    const subjectLabel = isDef
        ? `${escHtml(state.buildA.name)} defending vs ${escHtml(state.defender.name)}`
        : `${escHtml(state.buildA.name)} &mdash; ${escHtml(skill?.name || "")} vs ${escHtml(state.defender.name)}`;

    const defKindToggle = isDef
        ? `<div class="sw-pill-group">
               ${["melee", "ranged", "magic"]
                   .map(
                       (k) =>
                           `<button type="button" class="sw-pill ${ehpKind === k ? "active" : ""}" data-sw-defkind="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`
                   )
                   .join("")}
           </div>`
        : "";

    return `
    <div class="stat-weights-panel">
        <div class="sw-header">
            <div>
                <div class="stat-group-label" style="margin:0">Stat Weights &mdash; Next Best Gem / Synth Upgrade</div>
                <div class="hint-inline">${subjectLabel} &bull; Base ${unitLabel}: <strong>${fmtInt(res.baseValue)}</strong></div>
            </div>
            <div class="sw-controls">
                ${defKindToggle}
                <div class="sw-pill-group">
                    <button type="button" class="sw-pill ${tierFilter === "all" ? "active" : ""}" data-sw-tier="all">All</button>
                    <button type="button" class="sw-pill ${tierFilter === "gem" ? "active" : ""}" data-sw-tier="gem">1&times; Gem</button>
                    <button type="button" class="sw-pill ${tierFilter === "synth" ? "active" : ""}" data-sw-tier="synth">1&times; Synth</button>
                </div>
            </div>
        </div>
        <div class="sw-grid">
            ${filtered
                .map((it, idx) => {
                    const barW = Math.max(2, Math.min(100, (it.gainPct / maxPct) * 100));
                    const tierBadge =
                        it.tier === "gem"
                            ? `<span class="sw-tier sw-tier-gem">Gem</span>`
                            : it.tier === "synth"
                              ? `<span class="sw-tier sw-tier-synth">Synth</span>`
                              : `<span class="sw-tier sw-tier-attr">Attr</span>`;
                    const isTop = idx === 0 && it.gainPct > 0.01;
                    return `
                    <div class="sw-row ${isTop ? "sw-top" : ""}">
                        <div class="sw-label">
                            ${tierBadge}
                            <strong>${escHtml(it.deltaLabel)}</strong>
                            <span>${escHtml(it.label)}</span>
                        </div>
                        <div class="sw-bar-wrap">
                            <div class="sw-bar" style="width:${barW.toFixed(1)}%"></div>
                        </div>
                        <div class="sw-val">
                            <span class="${it.gainPct > 0.05 ? "delta-pos" : "delta-tie"}">${it.gainPct >= 0 ? "+" : ""}${fmtDec(it.gainPct, 2)}%</span>
                            <span class="skill-meta">(+${fmtInt(it.gainAbs)})</span>
                        </div>
                    </div>`;
                })
                .join("")}
        </div>
    </div>`;
}

export function renderBreakdownBox(row) {
    const isHeal = row.resultA.kind === "heal";
    const rankLabel = formatRankTag(row.resultA);
    const fmtCastTimingRow = (d) => {
        if (!d) return "&mdash;";
        const gcdLabel = formatGcdSummaryText(d);
        if (d.rawCastTimeSec > 0) {
            if (d.castTimeRemoved) {
                return `&#9889; Instant (${escHtml(d.castRemovedBy || "Combo")}) + ${gcdLabel} = ${fmtDec(d.execTimeSec, 2)}s`;
            }
            return `${fmtDec(d.rawCastTimeSec, 1)}s &times; ${fmtDec(d.castTimePct, 0)}% = <strong>${fmtDec(d.effectiveCastTimeSec, 2)}s cast</strong> + ${gcdLabel} = ${fmtDec(d.execTimeSec, 2)}s`;
        }
        return `Instant + ${gcdLabel}`;
    };
    const fmtBreakdownRate = (d) => {
        if (!d) return "&mdash;";
        const gcdLabel = formatGcdSummaryText(d);
        if (d.isOffGcd) {
            return d.sustained != null
                ? `${fmtInt(d.sustained)}/s (${fmtDec(d.cycleTimeSec)}s CD) &bull; ${gcdLabel}`
                : gcdLabel;
        }
        if (d.cycleReason === "duration") {
            return `${fmtInt(d.sustained)}/s (${fmtDec(d.cycleTimeSec, 0)}s HoT/DoT) &bull; ${gcdLabel}`;
        }
        if (d.cycleTimeSec > d.execTimeSec + 0.05 && d.burst != null) {
            return `${fmtInt(d.burst)}/s burst (${fmtDec(d.execTimeSec, 2)}s) &bull; ${fmtInt(d.sustained)}/s (${fmtDec(d.cycleTimeSec)}s CD)`;
        }
        return `${d.sustained != null ? `${fmtInt(d.sustained)}/s` : "&mdash;"} (${fmtDec(d.execTimeSec, 2)}s cycle &bull; ${gcdLabel})`;
    };
    const renderSide = (title, res, colorCls) => {
        const b = res.breakdown;
        if (isHeal) {
            const hpsStr = fmtBreakdownRate(res.dps);
            const gemRow =
                b.skillGemBonusPct > 0
                    ? `<div class="wf-row"><span class="wf-k">Skill Lunagems</span><span class="wf-v delta-pos">+${fmtDec(b.skillGemBonusPct)}% (${escHtml(b.skillGemSummary)})</span></div>`
                    : "";
            const comboRow =
                b.comboBonusPct > 0
                    ? `<div class="wf-row"><span class="wf-k">Combo Debuff / Bonus</span><span class="wf-v delta-pos">+${fmtDec(b.comboBonusPct)}%${b.comboLabels?.length ? ` (${escHtml(b.comboLabels.join(", "))})` : ""}</span></div>`
                    : "";
            return `
            <div class="waterfall-card">
                <h4 class="${colorCls}">${escHtml(title)} &mdash; ${escHtml(row.skill.name)} (${escHtml(rankLabel)})</h4>
                <div class="wf-row"><span class="wf-k">Raw Formula</span><span class="wf-v">${b.rawBase} + ${b.rawScalingPct}% of ${fmtDec(b.healingPower)} HPwr</span></div>
                <div class="wf-row"><span class="wf-k">Outgoing Healing %</span><span class="wf-v">+${fmtDec(b.outgoingHealingPct)}%</span></div>
                ${gemRow}
                ${comboRow}
                <div class="wf-row"><span class="wf-k">Target Received Healing % (incl. Anti-Heal)</span><span class="wf-v">${b.receivedHealingPct >= 0 ? "+" : ""}${fmtDec(b.receivedHealingPct)}%</span></div>
                <div class="wf-row"><span class="wf-k">Crit Heal Rate / Bonus</span><span class="wf-v">${fmtDec(b.critRatePct)}% / +${fmtDec(b.critBonusPct)}%</span></div>
                <div class="wf-row"><span class="wf-k">Normal / Crit / Expected</span><span class="wf-v">${fmtInt(res.normal)} / ${fmtInt(res.crit)} / ${fmtInt(res.expected)}</span></div>
                <div class="wf-row"><span class="wf-k">Cast Time &amp; GCD</span><span class="wf-v">${fmtCastTimingRow(res.dps)}</span></div>
                <div class="wf-row"><span class="wf-k">Average HPS</span><span class="wf-v">${hpsStr}</span></div>
                ${res.perHit.length > 1 ? `<div class="wf-row"><span class="wf-k">Per-Cast Expected</span><span class="wf-v">${res.perHit.map((h) => fmtInt(h.expected)).join(" + ")}</span></div>` : ""}
            </div>`;
        }
        const wf = b.mitigationWaterfall;
        const av = b.avoidance;
        const dpsStr = fmtBreakdownRate(res.dps);
        const avoidDetailStr = av.bypassReason
            ? `0.0% (${escHtml(av.bypassReason)})`
            : `${fmtDec(av.totalAvoidancePct)}% (E ${fmtDec(av.rawEvadePct)}% + P ${fmtDec(av.rawParryPct)}%${!av.parryApplies && row.skill.scalingStat === "rangedAttack" ? " no DW" : ""} + B ${fmtDec(av.rawBlockPct)}%${!av.hasShield ? " no shield" : ""}; Focus -${fmtDec(av.focusNegationPct)}%)`;
        const gemRowLbl = String(b.skillGemSummary || "").includes("(T7)")
            ? "Skill Bonus (Gear / Gems)"
            : "Skill Lunagems";
        const gemRow =
            b.skillGemBonusPct > 0
                ? `<div class="wf-row"><span class="wf-k">${gemRowLbl}</span><span class="wf-v delta-pos">+${fmtDec(b.skillGemBonusPct)}% (${escHtml(b.skillGemSummary)})</span></div>`
                : "";
        const comboRow =
            b.comboBonusPct > 0
                ? `<div class="wf-row"><span class="wf-k">Combo Debuff / Bonus</span><span class="wf-v delta-pos">+${fmtDec(b.comboBonusPct)}%${b.comboLabels?.length ? ` (${escHtml(b.comboLabels.join(", "))})` : ""}</span></div>`
                : "";
        const treeBonusRow =
            b.treeBonusPct > 0
                ? `<div class="wf-row"><span class="wf-k">Skillset Passive</span><span class="wf-v delta-pos">&times;${fmtDec(1 + b.treeBonusPct / 100, 2)} (+${fmtDec(b.treeBonusPct, 0)}% mult)</span></div>`
                : "";
        const enlRow = b.lifeEnlightenmentNote
            ? `<div class="wf-row"><span class="wf-k">Life Enlightenment (2-Set)</span><span class="wf-v delta-pos">${escHtml(b.lifeEnlightenmentNote)}</span></div>`
            : "";
        const t7Row = b.t7EffectNote
            ? `<div class="wf-row"><span class="wf-k">T7 Obsidian Effect</span><span class="wf-v delta-pos">${escHtml(b.t7EffectNote)}</span></div>`
            : "";
        const secRow = res.secondary
            ? `<div class="wf-row"><span class="wf-k">+ Secondary: ${escHtml(res.secondary.label)}</span><span class="wf-v delta-pos">+${fmtInt(res.secondary.expected)} exp (+${fmtInt(res.secondary.normal)} norm${res.secondary.canCrit ? ` / +${fmtInt(res.secondary.crit)} crit` : ", no crit"})</span></div>`
            : "";
        return `
        <div class="waterfall-card">
            <h4 class="${colorCls}">${escHtml(title)} &mdash; ${escHtml(row.skill.name)} (${escHtml(rankLabel)})</h4>
            <div class="wf-row"><span class="wf-k">Raw Formula</span><span class="wf-v">${b.rawBase} + ${b.rawScalingPct}% of ${fmtDec(b.attackPower)} (+${fmtDec(b.skillDamagePct)}% Dmg)</span></div>
            ${enlRow}
            ${t7Row}
            ${treeBonusRow}
            ${gemRow}
            ${comboRow}
            <div class="wf-row"><span class="wf-k">Pre-Mitigation (per hit)</span><span class="wf-v">${fmtInt(wf.preMitigation)}</span></div>
            <div class="wf-row"><span class="wf-k">Defense (${fmtInt(b.effectiveDefense)} eff, -${fmtDec(b.defenseMitigationPct)}%)</span><span class="wf-v">-${fmtInt(wf.removedByDefense)}</span></div>
            <div class="wf-row"><span class="wf-k">Toughness (-${fmtDec(b.toughnessMitigationPct)}%)</span><span class="wf-v">-${fmtInt(wf.removedByToughness)}</span></div>
            <div class="wf-row"><span class="wf-k">Received Type DR (${fmtDec(b.receivedDrPct)}%) &amp; Fixed DR (${fmtInt(b.fixedDr)})</span><span class="wf-v">-${fmtInt(wf.removedByReceivedDr + wf.removedByFixedDr)}</span></div>
            <div class="wf-row"><span class="wf-k">Eff. Crit Rate / Bonus (after Resilience)</span><span class="wf-v">${fmtDec(b.effectiveCritRatePct)}% / +${fmtDec(b.effectiveCritBonusPct)}%</span></div>
            <div class="wf-row"><span class="wf-k">Accuracy / Miss</span><span class="wf-v">${fmtDec(av.accuracyPct)}% Acc (${fmtDec(av.missPct)}% Miss)</span></div>
            <div class="wf-row"><span class="wf-k">Avoidance</span><span class="wf-v">${avoidDetailStr}</span></div>
            <div class="wf-row"><span class="wf-k">Final Hit (Connect) Rate</span><span class="wf-v">${fmtDec(av.connectPct)}%</span></div>
            ${secRow}
            <div class="wf-row"><span class="wf-k">Cast Time &amp; GCD</span><span class="wf-v">${fmtCastTimingRow(res.dps)}</span></div>
            <div class="wf-row"><span class="wf-k">Average DPS</span><span class="wf-v">${dpsStr}</span></div>
            ${res.perHit.length > 1 ? `<div class="wf-row"><span class="wf-k">Per-Hit Expected</span><span class="wf-v">${res.perHit.map((h) => fmtInt(h.expected)).join(" + ")}</span></div>` : ""}
        </div>`;
    };

    return `
    <div class="breakdown-box">
        <div class="stat-group-label">Detailed Breakdown &mdash; ${escHtml(row.skill.name)} (${escHtml(rankLabel)})</div>
        <div class="hint-inline">${escHtml(row.resultA.description || row.skill.description || "")}</div>
        <div class="breakdown-grid">
            ${renderSide(state.buildA.name, row.resultA, "val-a")}
            ${renderSide(state.buildB.name, row.resultB, "val-b")}
        </div>
    </div>`;
}
