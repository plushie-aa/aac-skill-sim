/**
 * Defense / Resilience / Aggressor Def Pen Break-Even Sweep View & SVG Chart.
 * Supports:
 *  - Offense Sweep (Build A vs B damage across Target Phys/Magic Def, Resilience, or Toughness)
 *  - Defender EHP Sweep (Defender A vs B EHP across Aggressor Def Pen, Magic Def Pen, or Crit Rate)
 *  - Optional dashed Crit & Non-Crit curve overlays on the SVG chart + full table comparison
 */

import {
    applyOverrides,
    resolveSkillRank,
    sweepDefenderEhp,
    sweepDefenderStat,
} from "../engine/index.js";
import {
    buildCustomSkill,
    escHtml,
    fmtDeltaPct,
    fmtInt,
    getActiveSkillObject,
    getContext,
    getEffectiveDefenderDisableAvoidance,
    getMatchingSkills,
    getSlotModifiers,
    state,
    ui,
} from "./state.js";

const OFFENSE_STAT_LABELS = {
    physicalDefense: "Target Physical Defense",
    magicDefense: "Target Magic Defense",
    resilience: "Target Resilience",
    toughness: "Target Toughness",
};

const DEFENDER_STAT_LABELS = {
    aggressorDefPen: "Aggressor Physical Def Pen",
    aggressorMagicDefPen: "Aggressor Magic Def Pen",
    aggressorCritRate: "Aggressor Crit Rate %",
};

export function renderSweepView(out) {
    const isDefSweep = state.sweepMode === "defender_ehp";
    const metric = document.getElementById("sweepMetric")?.value || "expected";
    const overlayOn = Boolean(state.sweepOverlayCritNonCrit);

    const headerBarHtml = `
        <div class="def-options-bar" style="margin-bottom:10px">
            <div class="seg-group" id="sweepModePills" title="Choose Offense Skill Sweep vs Defender EHP Break-Even Sweep">
                <button type="button" class="seg-btn ${!isDefSweep ? "active" : ""}" data-sweep-mode="offense">Offense Skill Sweep (Target Def / Resil / Tough)</button>
                <button type="button" class="seg-btn ${isDefSweep ? "active" : ""}" data-sweep-mode="defender_ehp">Defender A vs B EHP Sweep (Aggressor Pen / Crit)</button>
            </div>
            ${
                isDefSweep
                    ? `<div class="seg-group" id="sweepEhpKindPills" title="Which EHP type to plot for Defender A vs B">
                           <button type="button" class="seg-btn ${state.sweepEhpKind === "melee" ? "active" : ""}" data-sweep-ehp-kind="melee">Melee EHP</button>
                           <button type="button" class="seg-btn ${state.sweepEhpKind === "ranged" ? "active" : ""}" data-sweep-ehp-kind="ranged">Ranged EHP</button>
                           <button type="button" class="seg-btn ${state.sweepEhpKind === "magic" ? "active" : ""}" data-sweep-ehp-kind="magic">Magic EHP</button>
                       </div>`
                    : ""
            }
            <label class="def-opt-toggle" title="Overlay dashed Crit and Non-Crit curves alongside the primary curve">
                <input type="checkbox" id="sweepOverlayChk" ${overlayOn ? "checked" : ""} />
                <span>Show Crit &amp; Non-Crit Curves</span>
            </label>
        </div>
    `;

    // Sync the Sweep Stat dropdown options to the active sweep mode
    syncSweepStatSelect(isDefSweep);

    const stat = document.getElementById("sweepStat")?.value || (isDefSweep ? "aggressorDefPen" : "physicalDefense");
    const start = parseFloat(document.getElementById("sweepStart")?.value) || 0;
    const end = parseFloat(document.getElementById("sweepEnd")?.value) || (isDefSweep ? 15000 : 24000);
    const step = Math.max(1, parseFloat(document.getElementById("sweepStep")?.value) || (stat === "aggressorCritRate" ? 5 : 1000));
    const baseCtx = getContext();

    let points = [];
    let breakEvens = [];
    let statLabel = "";
    let subMeta = "";

    if (isDefSweep) {
        const disableAvoidance = getEffectiveDefenderDisableAvoidance();
        const res = sweepDefenderEhp(
            state.buildA,
            state.buildB,
            state.defender,
            { stat, ehpKind: state.sweepEhpKind, metric, start, end, step },
            {
                ...baseCtx,
                disableAvoidance,
                defenderAModifiers: getSlotModifiers("A"),
                defenderBModifiers: getSlotModifiers("B"),
                attackerModifiers: getSlotModifiers("defender"),
            }
        );
        points = res.points;
        breakEvens = res.breakEvens;
        statLabel = DEFENDER_STAT_LABELS[stat] || stat;
        const kindLbl = state.sweepEhpKind === "magic" ? "Magic EHP" : state.sweepEhpKind === "ranged" ? "Ranged EHP" : "Melee EHP";
        subMeta = `${kindLbl} vs ${state.defender.name} • ${metric === "normal" ? "Non-Crit" : metric === "crit" ? "Crit" : "Expected"}${disableAvoidance ? " • Avoidance Off" : ""}`;
    } else {
        const skill = state.isCustomSkill ? buildCustomSkill() : getActiveSkillObject(getMatchingSkills());
        if (!skill || skill.kind === "heal") {
            out.innerHTML = `${headerBarHtml}<p class="hint-inline">Select a damage skill above to run an Offense Defense / Resilience break-even sweep.</p>`;
            bindSweepHeaderEvents();
            return;
        }
        const reqRank = state.skillRanks[skill.id] ?? state.globalRankMode;
        const resolvedRank = resolveSkillRank(skill, reqRank);
        const rankTag =
            skill.id === "custom_skill"
                ? "Custom"
                : resolvedRank.availableRanks > 1
                  ? `Rank ${resolvedRank.selectedRank}/${resolvedRank.availableRanks}`
                  : `Rank ${resolvedRank.selectedRank}`;

        const effA = applyOverrides(state.buildA, {});
        const effB = applyOverrides(state.buildB, {});
        const sweepA = sweepDefenderStat(effA, effA, state.defender, skill, { stat, start, end, step, metric }, {
            ...baseCtx,
            attackerModifiers: getSlotModifiers("A"),
        });
        const sweepB = sweepDefenderStat(effB, effB, state.defender, skill, { stat, start, end, step, metric }, {
            ...baseCtx,
            attackerModifiers: getSlotModifiers("B"),
        });

        points = sweepA.points.map((pA, i) => {
            const pB = sweepB.points[i];
            const valA = pA.valueA;
            const valB = pB.valueA;
            const delta = valA - valB;
            const deltaPct = valB > 0 ? (delta / valB) * 100 : 0;
            const winner = Math.abs(delta) < 1e-6 ? "tie" : delta > 0 ? "A" : "B";
            return {
                statValue: pA.statValue,
                valueA: valA,
                valueB: valB,
                normalA: pA.normalA,
                normalB: pB.normalA,
                critA: pA.critA,
                critB: pB.critA,
                expectedA: pA.expectedA,
                expectedB: pB.expectedA,
                delta,
                deltaPct,
                winner,
            };
        });

        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            if ((prev.delta < 0 && curr.delta > 0) || (prev.delta > 0 && curr.delta < 0)) {
                const t = Math.abs(prev.delta) / (Math.abs(prev.delta) + Math.abs(curr.delta));
                breakEvens.push({
                    statValue: Math.round(prev.statValue + t * (curr.statValue - prev.statValue)),
                    fromWinner: prev.winner,
                    toWinner: curr.winner,
                });
            }
        }
        statLabel = OFFENSE_STAT_LABELS[stat] || stat;
        subMeta = `Skill: ${skill.name} (${rankTag} • ${metric === "normal" ? "Non-Crit" : metric === "crit" ? "Crit" : "Expected"})`;
    }

    const beText =
        breakEvens.length > 0
            ? breakEvens.map((b) => fmtInt(b.statValue)).join(" / ")
            : `None (${points[0]?.winner === "A" ? state.buildA.name : state.buildB.name} wins across entire range)`;

    const midPt = points[Math.floor(points.length / 2)] || points[0];
    const pctDiff = (a, b) => (b > 0 ? ((a - b) / b) * 100 : 0);
    const dCls = (d) => (d > 0.05 ? "delta-pos" : d < -0.05 ? "delta-neg" : "delta-tie");

    out.innerHTML = `
        ${headerBarHtml}
        <div class="kpi-row">
            <div class="kpi-card">
                <div class="kpi-label">Break-Even ${escHtml(statLabel)}</div>
                <div class="kpi-value">${escHtml(beText)}</div>
                <div class="kpi-sub">${escHtml(subMeta)}</div>
            </div>
            ${
                midPt
                    ? `<div class="kpi-card">
                           <div class="kpi-label">At ${fmtInt(midPt.statValue)} ${escHtml(statLabel)}</div>
                           <div class="kpi-value ${dCls(midPt.deltaPct)}">
                               ${midPt.winner === "A" ? escHtml(state.buildA.name) : midPt.winner === "B" ? escHtml(state.buildB.name) : "Tie"} (${fmtDeltaPct(midPt.deltaPct)})
                           </div>
                           <div class="kpi-sub">
                               Non-Crit: <span class="val-a">${fmtInt(midPt.normalA)}</span>/<span class="val-b">${fmtInt(midPt.normalB)}</span> (${fmtDeltaPct(pctDiff(midPt.normalA, midPt.normalB))})
                               &bull; Crit: <span class="val-a">${fmtInt(midPt.critA)}</span>/<span class="val-b">${fmtInt(midPt.critB)}</span> (${fmtDeltaPct(pctDiff(midPt.critA, midPt.critB))})
                           </div>
                       </div>`
                    : ""
            }
        </div>

        <div class="chart-container">${renderSvgChart(points, breakEvens, statLabel, { overlayCritNonCrit: overlayOn, metric })}</div>

        <div class="table-wrap">
            <table class="mobile-card-table">
                <thead>
                    <tr>
                        <th>${escHtml(statLabel)}</th>
                        <th>Non-Crit (<span class="val-a">A</span> / <span class="val-b">B</span> &middot; &Delta;)</th>
                        <th>Crit (<span class="val-a">A</span> / <span class="val-b">B</span> &middot; &Delta;)</th>
                        <th>Expected (<span class="val-a">A</span> / <span class="val-b">B</span> &middot; &Delta;)</th>
                        <th>Winner (${metric === "normal" ? "Non-Crit" : metric === "crit" ? "Crit" : "Expected"})</th>
                    </tr>
                </thead>
                <tbody>
                    ${points
                        .map((p) => {
                            const nd = pctDiff(p.normalA, p.normalB);
                            const cd = pctDiff(p.critA, p.critB);
                            const ed = pctDiff(p.expectedA, p.expectedB);
                            return `
                        <tr>
                            <td><strong>${escHtml(statLabel)}: ${fmtInt(p.statValue)}</strong></td>
                            <td data-label="Non-Crit (A / B)">
                                <div class="def-cmp-main">
                                    <span class="val-a">${fmtInt(p.normalA)}</span><span class="def-cmp-sep">/</span><span class="val-b">${fmtInt(p.normalB)}</span>
                                    <span class="def-cmp-delta ${dCls(nd)}">${fmtDeltaPct(nd)}</span>
                                </div>
                            </td>
                            <td data-label="Crit (A / B)">
                                <div class="def-cmp-main">
                                    <span class="val-a">${fmtInt(p.critA)}</span><span class="def-cmp-sep">/</span><span class="val-b">${fmtInt(p.critB)}</span>
                                    <span class="def-cmp-delta ${dCls(cd)}">${fmtDeltaPct(cd)}</span>
                                </div>
                            </td>
                            <td data-label="Expected (A / B)">
                                <div class="def-cmp-main">
                                    <span class="val-a">${fmtInt(p.expectedA)}</span><span class="def-cmp-sep">/</span><span class="val-b">${fmtInt(p.expectedB)}</span>
                                    <span class="def-cmp-delta ${dCls(ed)}">${fmtDeltaPct(ed)}</span>
                                </div>
                            </td>
                            <td data-label="Winner">${p.winner === "A" ? escHtml(state.buildA.name) : p.winner === "B" ? escHtml(state.buildB.name) : "Tie"}</td>
                        </tr>`;
                        })
                        .join("")}
                </tbody>
            </table>
        </div>
    `;

    bindSweepHeaderEvents();
}

function syncSweepStatSelect(isDefSweep) {
    const sel = document.getElementById("sweepStat");
    if (!sel) return;
    const expectedKey = isDefSweep ? "defender_ehp" : "offense";
    if (sel.dataset.sweepOptMode === expectedKey) return;
    sel.dataset.sweepOptMode = expectedKey;
    const endInp = document.getElementById("sweepEnd");
    const stepInp = document.getElementById("sweepStep");
    if (isDefSweep) {
        sel.innerHTML = `
            <option value="aggressorDefPen">Aggressor Phys Def Pen</option>
            <option value="aggressorMagicDefPen">Aggressor Magic Def Pen</option>
            <option value="aggressorCritRate">Aggressor Crit Rate %</option>
        `;
        sel.value = state.sweepEhpKind === "magic" ? "aggressorMagicDefPen" : "aggressorDefPen";
        if (endInp) endInp.value = "15000";
        if (stepInp) stepInp.value = "1000";
    } else {
        sel.innerHTML = `
            <option value="physicalDefense">Physical Defense</option>
            <option value="magicDefense">Magic Defense</option>
            <option value="resilience">Resilience</option>
            <option value="toughness">Toughness</option>
        `;
        if (endInp) endInp.value = "24000";
        if (stepInp) stepInp.value = "1000";
    }
}

function bindSweepHeaderEvents() {
    document.querySelectorAll("[data-sweep-mode]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.sweepMode = btn.dataset.sweepMode;
            syncSweepStatSelect(state.sweepMode === "defender_ehp");
            ui.renderSkillBrowser();
            ui.renderSimulation();
        });
    });
    document.querySelectorAll("[data-sweep-ehp-kind]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.sweepEhpKind = btn.dataset.sweepEhpKind;
            const sel = document.getElementById("sweepStat");
            if (sel && state.sweepMode === "defender_ehp") {
                if (state.sweepEhpKind === "magic" && sel.value === "aggressorDefPen") {
                    sel.value = "aggressorMagicDefPen";
                } else if (state.sweepEhpKind !== "magic" && sel.value === "aggressorMagicDefPen") {
                    sel.value = "aggressorDefPen";
                }
            }
            ui.renderSimulation();
        });
    });
    document.getElementById("sweepOverlayChk")?.addEventListener("change", (e) => {
        state.sweepOverlayCritNonCrit = Boolean(e.target.checked);
        ui.renderSimulation();
    });
}

export function renderSvgChart(points, breakEvens, statLabel, opts = {}) {
    if (points.length < 2) return "";
    const overlay = Boolean(opts.overlayCritNonCrit);
    const W = 860,
        H = 300;
    const padL = 66,
        padR = 24,
        padT = 28,
        padB = 42;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const minX = points[0].statValue;
    const maxX = points[points.length - 1].statValue;
    const allYs = overlay
        ? points.flatMap((p) => [p.valueA, p.valueB, p.normalA, p.normalB, p.critA, p.critB])
        : points.flatMap((p) => [p.valueA, p.valueB]);
    const maxY = Math.max(10, ...allYs) * 1.08;

    const sx = (x) => padL + ((x - minX) / Math.max(1, maxX - minX)) * plotW;
    const sy = (y) => padT + plotH - (y / maxY) * plotH;

    const buildPath = (getter) =>
        points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.statValue).toFixed(1)},${sy(getter(p)).toFixed(1)}`).join(" ");

    const pathA = buildPath((p) => p.valueA);
    const pathB = buildPath((p) => p.valueB);

    let overlayPaths = "";
    if (overlay) {
        const pNormA = buildPath((p) => p.normalA);
        const pNormB = buildPath((p) => p.normalB);
        const pCritA = buildPath((p) => p.critA);
        const pCritB = buildPath((p) => p.critB);
        overlayPaths = `
            <path d="${pNormA}" fill="none" stroke="#38bdf8" stroke-width="1.3" stroke-dasharray="3 3" opacity="0.48" />
            <path d="${pNormB}" fill="none" stroke="#f59e0b" stroke-width="1.3" stroke-dasharray="3 3" opacity="0.48" />
            <path d="${pCritA}" fill="none" stroke="#38bdf8" stroke-width="1.3" stroke-dasharray="7 3" opacity="0.58" />
            <path d="${pCritB}" fill="none" stroke="#f59e0b" stroke-width="1.3" stroke-dasharray="7 3" opacity="0.58" />
        `;
    }

    const gridLinesY = [0, 0.25, 0.5, 0.75, 1]
        .map((t) => {
            const yVal = maxY * t;
            const y = sy(yVal);
            return `
            <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#263042" stroke-width="1" />
            <text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="#93a1b8" font-size="11">${fmtInt(yVal)}</text>`;
        })
        .join("");

    const xTicks = [0, 0.25, 0.5, 0.75, 1]
        .map((t) => {
            const xVal = minX + (maxX - minX) * t;
            const x = sx(xVal);
            return `<text x="${x}" y="${H - 14}" text-anchor="middle" fill="#93a1b8" font-size="11">${fmtInt(xVal)}</text>`;
        })
        .join("");

    const beLines = breakEvens
        .map((b) => {
            const x = sx(b.statValue);
            return `
            <line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="#94a3b8" stroke-dasharray="4 4" stroke-width="1.5" />
            <text x="${x}" y="${padT - 8}" text-anchor="middle" fill="#e2e8f0" font-size="11" font-weight="600">BE: ${fmtInt(b.statValue)}</text>`;
        })
        .join("");

    const overlayLegend = overlay
        ? `<text x="360" y="9" fill="#93a1b8" font-size="10.5">Solid = ${opts.metric === "normal" ? "Non-Crit" : opts.metric === "crit" ? "Crit" : "Expected"} • Dashed = Crit / Dotted = Non-Crit</text>`
        : "";

    return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        ${gridLinesY}
        ${xTicks}
        ${beLines}
        ${overlayPaths}
        <path d="${pathA}" fill="none" stroke="#38bdf8" stroke-width="2.6" />
        <path d="${pathB}" fill="none" stroke="#f59e0b" stroke-width="2.6" />
        <text x="${W / 2}" y="${H - 1}" text-anchor="middle" fill="#93a1b8" font-size="11">${escHtml(statLabel)}</text>
        <g transform="translate(${padL + 10}, ${padT + 6})">
            <rect width="12" height="3" y="4" fill="#38bdf8" />
            <text x="18" y="9" fill="#e6ecf5" font-size="11.5">${escHtml(state.buildA.name)}</text>
            <rect width="12" height="3" x="170" y="4" fill="#f59e0b" />
            <text x="188" y="9" fill="#e6ecf5" font-size="11.5">${escHtml(state.buildB.name)}</text>
            ${overlayLegend}
        </g>
    </svg>`;
}
