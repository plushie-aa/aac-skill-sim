/**
 * Rotation / Burst Combo (TTK & Exact Kill Probability) View + Skill Picker Modal.
 * Supports per-step Weapon Procs (e.g. Staff +10k M.Pen on Arc Lightning only)
 * and Target Absorb Shield HP pool (e.g. Insulating Lens / Conversion Shield).
 */

import { COMBAT_MODIFIERS, compareRotations } from "../engine/index.js";
import {
    ROTATIONS_STORAGE_KEY,
    cap,
    escHtml,
    fmtDec,
    fmtDeltaPct,
    fmtInt,
    formatFormulaShort,
    formatGcdSummaryText,
    formatRankTag,
    formatSkillCastBadge,
    formatSkillComboBadge,
    formatSkillGcdBadge,
    getContext,
    getSlotModifiers,
    showToast,
    skillIconUrl,
    slugifyBuildId,
    state,
    ui,
} from "./state.js";

const STEP_WEAPON_PROC_OPTIONS = [
    { id: "", label: "No Proc" },
    { id: "weapon_proc_staff", label: "Staff (+10k M.Pen)" },
    { id: "weapon_proc_spear", label: "Spear (+10k P.Pen)" },
    { id: "weapon_proc_katana", label: "Katana (+100% Crit)" },
    { id: "weapon_proc_dagger", label: "Dagger (+17.6% Spd)" },
    { id: "weapon_proc_scepter", label: "Scepter (-8% Cast)" },
];

export function syncRotationsToDisk() {
    const payload = {
        activeId: state.activeRotationId || null,
        combos: state.customRotations.map((r) => ({
            id: r.id,
            label: r.label,
            steps: (r.steps || []).map((s) => ({ ...s })),
        })),
        steps: state.rotationSteps.map((s) => ({ ...s })),
        updatedAt: state.rotationsUpdatedAt || Date.now(),
    };
    try {
        localStorage.setItem(ROTATIONS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
        // Ignore storage quota errors
    }
    if (!state.diskApiAvailable || window.location.protocol === "file:") {
        return Promise.resolve();
    }
    return fetch("/api/rotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
    }).catch(() => {});
}

export async function loadRotationsFromDisk() {
    let disk = null;
    if (state.diskApiAvailable && window.location.protocol !== "file:") {
        try {
            const res = await fetch("/api/rotations", { cache: "no-store" });
            if (res.ok) {
                const json = await res.json();
                if (json?.data && typeof json.data === "object") {
                    disk = json.data;
                    try {
                        localStorage.setItem(ROTATIONS_STORAGE_KEY, JSON.stringify(disk));
                    } catch {
                        // Ignore storage quota errors
                    }
                }
            }
        } catch {
            // Fall through to localStorage / static JSON
        }
    }
    if (!disk) {
        try {
            const raw = localStorage.getItem(ROTATIONS_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object") disk = parsed;
            }
        } catch {
            // Ignore corrupted localStorage
        }
    }
    if (!disk && window.location.protocol !== "file:") {
        try {
            const res = await fetch("combos/combos.json", { cache: "no-store" });
            if (res.ok) {
                const parsed = await res.json();
                if (parsed && typeof parsed === "object") {
                    disk = parsed;
                    try {
                        localStorage.setItem(ROTATIONS_STORAGE_KEY, JSON.stringify(disk));
                    } catch {
                        // Ignore storage quota errors
                    }
                }
            }
        } catch {
            // No combos file on disk yet
        }
    }
    if (!disk) return;

    const list = Array.isArray(disk.combos)
        ? disk.combos
        : Array.isArray(disk.customRotations)
          ? disk.customRotations
          : [];
    state.customRotations = list
        .filter((r) => r && typeof r === "object" && r.id)
        .map((r) => ({
            id: String(r.id),
            label: String(r.label || r.id),
            steps: Array.isArray(r.steps) ? r.steps.map((s) => ({ ...s })) : [],
        }));

    const diskActiveId = typeof disk.activeId === "string" ? disk.activeId : null;
    const matched = diskActiveId
        ? state.customRotations.find((r) => r.id === diskActiveId) || null
        : null;
    if (matched) {
        state.activeRotationId = matched.id;
        state.rotationSteps = matched.steps.map((s) => ({ ...s }));
    } else if (Array.isArray(disk.steps)) {
        state.activeRotationId = null;
        state.rotationSteps = disk.steps.map((s) => ({ ...s }));
    } else if (state.customRotations.length > 0) {
        state.activeRotationId = state.customRotations[0].id;
        state.rotationSteps = state.customRotations[0].steps.map((s) => ({ ...s }));
    } else {
        state.activeRotationId = null;
        state.rotationSteps = [];
    }
    state.rotationsUpdatedAt = Number(disk.updatedAt) || 0;
}

export function persistRotationState({ edited = true } = {}) {
    if (edited && state.activeRotationId) {
        const active = state.customRotations.find((r) => r.id === state.activeRotationId);
        if (active) {
            active.steps = state.rotationSteps.map((s) => ({ ...s }));
        }
    }
    const now = Date.now();
    state.rotationsUpdatedAt = now;
    state.rotLastSavedAt = now;
    syncRotationsToDisk();
    const statusEl = document.getElementById("rotSaveStatus");
    if (statusEl) {
        statusEl.textContent = state.diskApiAvailable
            ? "✓ Saved to combos.json (+ browser backup)"
            : "✓ Saved to browser storage";
        statusEl.classList.add("saved-flash");
    }
}

export function renderRotationView(out) {
    const skillById = new Map(state.allSkills.map((s) => [s.id, s]));
    const resolvedSteps = state.rotationSteps
        .map((st, idx) => {
            const skill = skillById.get(st.skillId);
            return skill ? { ...st, skill, rawIndex: idx } : null;
        })
        .filter(Boolean);

    const baseCtx = getContext();
    const targetAbsorbShield = Math.max(0, Number(state.rotationTargetShield) || 0);
    const ctxA = { ...baseCtx, targetAbsorbShield, attackerModifiers: getSlotModifiers("A") };
    const ctxB = { ...baseCtx, targetAbsorbShield, attackerModifiers: getSlotModifiers("B") };
    const cmp = compareRotations(state.buildA, state.buildB, state.defender, resolvedSteps, ctxA, ctxB);
    const rA = cmp.resultA;
    const rB = cmp.resultB;
    const isHeal = rA.mode === "heal";
    const rateUnit = isHeal ? "HPS" : "DPS";
    const probLabel = isHeal ? "Full Top-Off Chance" : "Kill Probability";

    const selectedSkillObj = skillById.get(state.selectedSkillId) || state.allSkills[0] || null;

    const stepResByRawIdx = new Map();
    rA.steps.forEach((sr) => {
        if (sr.step?.rawIndex != null) stepResByRawIdx.set(sr.step.rawIndex, sr);
    });

    const stepsBuilderHtml =
        state.rotationSteps.length === 0
            ? `<div class="hint-inline">Queue is empty. Pick a saved combo above or click <strong>+ Add Skill&hellip;</strong> to simulate a burst rotation!</div>`
            : `<div class="rot-steps-list">${state.rotationSteps
                  .map((st, idx) => {
                      const sk = skillById.get(st.skillId);
                      if (!sk) return "";
                      const srA = stepResByRawIdx.get(idx) || null;
                      const skIcon = skillIconUrl(sk);
                      const isUtilSk = sk.kind === "utility";
                      const isHealSk = sk.kind === "heal";
                      const hasCast = Number(sk.castTimeSec) > 0;
                      const typeCls = isUtilSk
                          ? "stag-util"
                          : isHealSk
                            ? "stag-heal"
                            : sk.damageType === "magic"
                              ? "stag-magic"
                              : "stag-phys";
                      const typeTxt = isUtilSk
                          ? "UTILITY"
                          : isHealSk
                            ? "HEAL"
                            : sk.damageType === "magic"
                              ? "MAGIC"
                              : "PHYS";
                      const autoComboBadges = (srA?.autoComboLabels || [])
                          .map(
                              (lbl) =>
                                  `<span class="stag stag-autocombo" title="Automatically triggered by an earlier skill's status in this combo">&#10022; ${escHtml(lbl)}</span>`
                          )
                          .join("");
                      const autoCcBadge = srA?.autoCCLabel
                          ? `<span class="stag stag-autocc" title="Target is ${escHtml(srA.autoCCLabel)} from an earlier skill — avoidance automatically bypassed">&#10022; CC: ${escHtml(srA.autoCCLabel)}</span>`
                          : "";
                      const activeDebBadges = (srA?.activeDebuffLabels || [])
                          .map(
                              (lbl) =>
                                  `<span class="stag stag-debuff" title="Target debuff active from an earlier skill in this combo">${escHtml(lbl)}</span>`
                          )
                          .join("");
                      const procBadge = srA?.weaponProcLabel
                          ? `<span class="stag stag-proc" title="Per-step weapon hidden passive proc applied ONLY to this step">&#9876; ${escHtml(srA.weaponProcLabel)}</span>`
                          : "";
                      const hasAnyComboHit = Boolean(
                          srA?.autoComboTriggered ||
                              (srA?.autoComboLabels && srA.autoComboLabels.length > 0) ||
                              srA?.autoCCLabel
                      );
                      const curProc = st.weaponProc || "";
                      const procSelectHtml =
                          !isHealSk && !isUtilSk
                              ? `<label class="rot-flag-proc" title="Apply a single-step Weapon Proc to this skill only (e.g. Staff +10k M.Pen on Arc Lightning)">
                                     &#9876;
                                     <select class="rot-proc-sel" data-rot-proc="${idx}">
                                         ${STEP_WEAPON_PROC_OPTIONS.map(
                                             (opt) =>
                                                 `<option value="${escHtml(opt.id)}" ${curProc === opt.id ? "selected" : ""}>${escHtml(opt.label)}</option>`
                                         ).join("")}
                                     </select>
                                 </label>`
                              : "";
                      return `
                      <div class="rot-step-row ${isUtilSk ? "rot-step-util" : ""} ${hasAnyComboHit ? "rot-step-combo-hit" : ""}" data-rot-idx="${idx}">
                          <div class="rot-step-main">
                              <span class="rot-step-num">${idx + 1}</span>
                              ${skIcon ? `<img class="rot-step-icon" src="${escHtml(skIcon)}" alt="" loading="lazy" />` : ""}
                              <strong>${escHtml(sk.name)}</strong>
                              <span class="stag ${typeCls}">${typeTxt}</span>
                              ${formatSkillCastBadge(sk, srA)}
                              ${formatSkillGcdBadge(sk)}
                              ${formatSkillComboBadge(sk)}
                              ${procBadge}${autoComboBadges}${autoCcBadge}${activeDebBadges}
                          </div>
                          <div class="rot-step-flags">
                              ${
                                  !isHealSk && !isUtilSk
                                      ? `<label class="rot-flag-chk" title="Attack from behind (bypasses avoidance, triggers backstab bonuses)">
                                             <input type="checkbox" data-rot-flag="isBackstab" ${st.isBackstab ? "checked" : ""} /> Backstab
                                         </label>
                                         <label class="rot-flag-chk" title="Target is tripped/stunned/CC'd (bypasses avoidance)">
                                             <input type="checkbox" data-rot-flag="targetIsCCd" ${st.targetIsCCd ? "checked" : ""} /> CC'd
                                         </label>
                                         <label class="rot-flag-chk" title="Target below 30% HP (triggers execute bonuses)">
                                             <input type="checkbox" data-rot-flag="targetBelow30Pct" ${st.targetBelow30Pct ? "checked" : ""} /> &lt;30%
                                         </label>
                                         <label class="rot-flag-num" title="Skill combo bonus %">
                                             Combo% <input type="number" step="5" data-rot-num="comboBonusPct" value="${Number(st.comboBonusPct) || 0}" />
                                         </label>
                                         ${procSelectHtml}`
                                      : ""
                              }
                              ${
                                  hasCast && !srA?.autoComboTriggered
                                      ? `<label class="rot-flag-chk" title="Remove this skill's cast time (simulate an instant-cast proc/combo manually)">
                                             <input type="checkbox" data-rot-flag="noCastTime" ${st.noCastTime ? "checked" : ""} /> Instant
                                         </label>`
                                      : ""
                              }
                              <label class="rot-flag-chk" title="Weave off-GCD / animation-cancel this step (0.00s GCD &amp; cast footprint)">
                                  <input type="checkbox" data-rot-flag="offGcd" ${st.offGcd ? "checked" : ""} /> Off-GCD
                              </label>
                              <label class="rot-flag-num" title="Extra delay/weave time in seconds">
                                  +Delay <input type="number" step="0.1" min="0" max="10" data-rot-num="delaySec" value="${Number(st.delaySec) || 0}" />s
                              </label>
                          </div>
                          <div class="rot-step-actions">
                              <button type="button" class="sm" data-rot-act="up" ${idx === 0 ? "disabled" : ""} title="Move up">&uarr;</button>
                              <button type="button" class="sm" data-rot-act="down" ${idx === state.rotationSteps.length - 1 ? "disabled" : ""} title="Move down">&darr;</button>
                              <button type="button" class="sm" data-rot-act="dup" title="Duplicate step">&#10697;</button>
                              <button type="button" class="sm danger-sm" data-rot-act="del" title="Remove step">&times;</button>
                          </div>
                      </div>`;
                  })
                  .join("")}</div>`;

    const maxDur = Math.max(0.1, rA.totalDurationSec, rB.totalDurationSec);
    const buildTimelineHtml = (label, res, segCls, valCls) => {
        if (res.stepCount === 0) return "";
        const segs = res.steps
            .map((s) => {
                const isOffGcdStep = s.durationSec <= 1e-6;
                const isKillStep = !isHeal && !s.isUtility && s.index === res.killStepIndex;
                const cls = s.isUtility ? "seg-util" : s.isHeal ? "seg-heal" : segCls;
                if (isOffGcdStep) {
                    const tip = s.isUtility
                        ? `${s.skill.name}: Off-GCD @ ${fmtDec(s.startSec, 2)}s (0.00s) • ${s.grantedComboEffect?.summary || "Utility"}`
                        : `${s.skill.name}: Off-GCD @ ${fmtDec(s.startSec, 2)}s (0.00s) • Expected ${fmtInt(s.result.expected)}`;
                    return `<div class="rot-tl-seg ${s.isUtility ? "seg-util-offgcd" : "seg-offgcd"} ${isKillStep ? "seg-kill" : ""}" title="${escHtml(tip)}">&#9889;</div>`;
                }
                const wPct = (s.durationSec / maxDur) * 100;
                const hasSplitCast = s.castSec > 1e-6 && s.postGcdSec > 1e-6;
                const comboCls = s.castTimeRemoved ? "seg-instant-combo" : "";
                const timeSummary =
                    s.castSec > 1e-6
                        ? `${fmtDec(s.castSec, 2)}s cast + ${fmtDec(s.postGcdSec, 2)}s GCD`
                        : s.castTimeRemoved
                          ? `${fmtDec(s.durationSec, 2)}s GCD • Instant via ${s.castRemovedBy} (saved ${fmtDec(s.castTimeSavedSec, 2)}s)`
                          : `${fmtDec(s.durationSec, 2)}s • ${formatGcdSummaryText(s.result.dps)}`;
                const procTip = s.weaponProcLabel ? ` • ⚔ ${s.weaponProcLabel}` : "";
                const tip = s.isUtility
                    ? `${s.skill.name}: ${fmtDec(s.startSec, 2)}s → ${fmtDec(s.endSec, 2)}s (${timeSummary}) • ${s.grantedComboEffect?.summary || "Utility"}`
                    : `${s.skill.name}: ${fmtDec(s.startSec, 2)}s → ${fmtDec(s.endSec, 2)}s (${timeSummary})${procTip} • Expected ${fmtInt(s.result.expected)}`;
                if (hasSplitCast) {
                    const castPct = Math.min(95, Math.max(5, (s.castSec / s.durationSec) * 100));
                    const gcdPct = 100 - castPct;
                    return `<div class="rot-tl-seg seg-split ${isKillStep ? "seg-kill" : ""}" style="width:${wPct.toFixed(2)}%" title="${escHtml(tip)}">
                        <div class="rot-tl-cast" style="width:${castPct.toFixed(1)}%">${escHtml(s.skill.name)} (${fmtDec(s.castSec, 2)}s)</div>
                        <div class="rot-tl-gcd ${cls}" style="width:${gcdPct.toFixed(1)}%">+${fmtDec(s.postGcdSec, 2)}s</div>
                    </div>`;
                }
                const prefix = s.weaponProcId ? "&#9876; " : s.castTimeRemoved ? "&#9889; " : "";
                return `<div class="rot-tl-seg ${cls} ${comboCls} ${isKillStep ? "seg-kill" : ""}" style="width:${wPct.toFixed(2)}%" title="${escHtml(tip)}">${prefix}${escHtml(s.skill.name)} (${fmtDec(s.durationSec, 2)}s)</div>`;
            })
            .join("");
        const padPct = Math.max(0, ((maxDur - res.totalDurationSec) / maxDur) * 100);
        const castMeta =
            res.totalCastTimeSec > 0.005 || res.totalCastTimeSavedSec > 0.005
                ? ` &bull; Cast ${fmtDec(res.totalCastTimeSec, 2)}s${res.totalCastTimeSavedSec > 0.005 ? ` <span class="delta-pos">(&#9889; -${fmtDec(res.totalCastTimeSavedSec, 2)}s saved)</span>` : ""}`
                : "";
        return `
        <div class="rot-tl-row">
            <div class="rot-tl-meta">
                <strong class="${valCls}">${escHtml(label)}</strong>
                <span class="hint-inline">Total window: <strong>${fmtDec(res.totalDurationSec, 2)}s</strong> &bull; ${fmtInt(res.windowRate)} ${rateUnit}${castMeta}${!isHeal && res.killTimestampSec != null ? ` &bull; Expected kill at <strong>${fmtDec(res.killTimestampSec, 2)}s</strong>` : ""}</span>
            </div>
            <div class="rot-tl-track">
                ${segs}
                ${padPct > 0.5 ? `<div class="rot-tl-pad" style="width:${padPct.toFixed(2)}%"></div>` : ""}
            </div>
        </div>`;
    };

    const probCls = (p) => (p >= 75 ? "delta-pos" : p >= 35 ? "val-b" : "delta-neg");
    const shieldNote =
        !isHeal && targetAbsorbShield > 0
            ? ` (+${fmtInt(targetAbsorbShield)} Shield = ${fmtInt(rA.effectiveKillHp)} eff HP)`
            : "";

    const resultsHtml =
        rA.stepCount === 0
            ? ""
            : `
        <div class="kpi-row">
            <div class="kpi-card">
                <div class="kpi-label">Rotation Advantage (Total Expected)</div>
                <div class="kpi-value ${cmp.deltaExpectedPct > 0.05 ? "delta-pos" : cmp.deltaExpectedPct < -0.05 ? "delta-neg" : "delta-tie"}">
                    ${cmp.deltaExpectedPct > 0.05 ? escHtml(state.buildA.name) : cmp.deltaExpectedPct < -0.05 ? escHtml(state.buildB.name) : "Tie"}
                    (${fmtDeltaPct(cmp.deltaExpectedPct)})
                </div>
                <div class="kpi-sub">Window ${rateUnit}: ${fmtInt(rA.windowRate)} vs ${fmtInt(rB.windowRate)} (${fmtDeltaPct(cmp.deltaRatePct)})</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">${escHtml(state.buildA.name)} &mdash; ${probLabel}</div>
                <div class="kpi-value ${probCls(rA.killProbPct)}">${fmtDec(rA.killProbPct, 1)}% <span class="kpi-rate">&bull; ${fmtInt(rA.totalExpected)}</span></div>
                <div class="kpi-sub">${fmtDec(rA.totalDurationSec, 2)}s window &bull; ${fmtInt(rA.windowRate)} ${rateUnit} &bull; ${fmtDec(rA.pctOfTargetHp)}% HP${!isHeal && rA.estimatedTtkSec != null ? ` &bull; Est. TTK ${fmtDec(rA.estimatedTtkSec, 2)}s` : ""}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">${escHtml(state.buildB.name)} &mdash; ${probLabel}</div>
                <div class="kpi-value ${probCls(rB.killProbPct)}">${fmtDec(rB.killProbPct, 1)}% <span class="kpi-rate">&bull; ${fmtInt(rB.totalExpected)}</span></div>
                <div class="kpi-sub">${fmtDec(rB.totalDurationSec, 2)}s window &bull; ${fmtInt(rB.windowRate)} ${rateUnit} &bull; ${fmtDec(rB.pctOfTargetHp)}% HP${!isHeal && rB.estimatedTtkSec != null ? ` &bull; Est. TTK ${fmtDec(rB.estimatedTtkSec, 2)}s` : ""}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">Burst Spread (P10 / Median / P90 / Max Crit)</div>
                <div class="kpi-value" style="font-size:14px"><span class="val-a">A:</span> ${fmtInt(rA.quantiles.p10)} / ${fmtInt(rA.quantiles.median)} / ${fmtInt(rA.quantiles.p90)}</div>
                <div class="kpi-sub"><span class="val-b">B:</span> ${fmtInt(rB.quantiles.p10)} / ${fmtInt(rB.quantiles.median)} / ${fmtInt(rB.quantiles.p90)} &bull; Max Crit: ${fmtInt(rA.totalCrit)} vs ${fmtInt(rB.totalCrit)}</div>
            </div>
        </div>

        <div class="rot-timeline-box">
            <div class="rot-tl-legend-row">
                <div class="stat-group-label" style="margin:0">Execution Timeline (Cast Time + Attack Speed GCD &amp; Instant Combos)</div>
                <div class="rot-tl-legend">
                    <span class="rot-leg-item"><span class="rot-leg-swatch sw-cast"></span>Cast Time</span>
                    <span class="rot-leg-item"><span class="rot-leg-swatch sw-gcd"></span>GCD</span>
                    <span class="rot-leg-item"><span class="rot-leg-swatch sw-combo"></span>Instant Combo</span>
                    <span class="rot-leg-item"><span class="rot-leg-swatch sw-offgcd"></span>Off-GCD</span>
                </div>
            </div>
            ${buildTimelineHtml(state.buildA.name, rA, "seg-a", "val-a")}
            ${buildTimelineHtml(state.buildB.name, rB, "seg-b", "val-b")}
        </div>

        <div class="table-wrap">
            <table class="mobile-card-table">
                <thead>
                    <tr>
                        <th># &amp; Skill</th>
                        <th>A Window</th>
                        <th>A Expected</th>
                        <th>A Hit / Crit</th>
                        <th>B Window</th>
                        <th>B Expected</th>
                        <th>B Hit / Crit</th>
                        <th>A vs B</th>
                    </tr>
                </thead>
                <tbody>
                    ${rA.steps
                        .map((sA, i) => {
                            const sB = rB.steps[i];
                            const sk = sA.skill;
                            const skIcon = skillIconUrl(sk);
                            const dPct =
                                sB.result.expected > 0
                                    ? ((sA.result.expected - sB.result.expected) / sB.result.expected) * 100
                                    : 0;
                            const dCls = dPct > 0.05 ? "delta-pos" : dPct < -0.05 ? "delta-neg" : "delta-tie";
                            const flagBadges = [];
                            if (sA.weaponProcLabel) flagBadges.push(`⚔ ${sA.weaponProcLabel}`);
                            if (sA.step.isBackstab) flagBadges.push("Backstab");
                            if (sA.step.targetIsCCd) flagBadges.push("CC'd");
                            else if (sA.autoCCLabel) flagBadges.push(`Auto-CC (${sA.autoCCLabel})`);
                            if (sA.step.targetBelow30Pct) flagBadges.push("<30% HP");
                            if (Number(sA.step.comboBonusPct)) flagBadges.push(`+${sA.step.comboBonusPct}% Manual`);
                            for (const lbl of sA.autoComboLabels || []) flagBadges.push(`✦ ${lbl}`);
                            for (const lbl of sA.activeDebuffLabels || []) flagBadges.push(lbl);
                            if (sA.castTimeRemoved) flagBadges.push(`⚡ Instant (${sA.castRemovedBy})`);
                            else if (sA.castSec > 1e-6) flagBadges.push(`${sk.castTimeSec}s cast`);
                            if (sA.grantedComboEffect?.summary) flagBadges.push(sA.grantedComboEffect.summary);
                            else if (sA.grantedStatuses?.length > 0)
                                flagBadges.push(`Applies ${sA.grantedStatuses.join(", ")}`);
                            if (sA.step.offGcd || sA.result.dps?.isOffGcd) flagBadges.push("Off-GCD");
                            else if (sA.result.dps?.gcdKind === "rapid") flagBadges.push("No GCD");
                            else if (sA.result.dps?.isReducedGcd) flagBadges.push(`${sA.result.dps.baseGcdSec}s GCD`);
                            if (Number(sA.step.delaySec)) flagBadges.push(`+${sA.step.delaySec}s delay`);
                            const fmtWin = (stRes) => {
                                if (stRes.durationSec <= 1e-6) {
                                    return `<div>@${fmtDec(stRes.startSec, 2)}s</div><div class="skill-meta">Off-GCD (0.00s)</div>`;
                                }
                                const sub =
                                    stRes.castSec > 1e-6
                                        ? `${fmtDec(stRes.castSec, 2)}s cast + ${fmtDec(stRes.postGcdSec, 2)}s GCD`
                                        : stRes.castTimeRemoved
                                          ? `&#9889; ${fmtDec(stRes.postGcdSec, 2)}s GCD (-${fmtDec(stRes.castTimeSavedSec, 2)}s)`
                                          : `${fmtDec(stRes.durationSec, 2)}s GCD`;
                                return `<div>${fmtDec(stRes.startSec, 2)}s&ndash;${fmtDec(stRes.endSec, 2)}s</div><div class="skill-meta">${sub}</div>`;
                            };
                            const hitCritStr = (res) =>
                                res.kind === "utility"
                                    ? "&mdash;"
                                    : res.kind === "heal"
                                      ? `100% / ${fmtDec(res.breakdown.critRatePct)}%`
                                      : `${fmtDec(res.breakdown.avoidance.connectPct)}% / ${fmtDec(res.breakdown.effectiveCritRatePct)}%`;
                            return `
                            <tr class="${sA.isUtility ? "rot-util-tr" : ""}">
                                <td>
                                    <div class="table-skill-cell">
                                        <span class="rot-step-num">${i + 1}</span>
                                        ${skIcon ? `<img class="table-skill-icon" src="${escHtml(skIcon)}" alt="" loading="lazy" />` : ""}
                                        <div>
                                            <div class="skill-name">${escHtml(sk.name)}</div>
                                            <div class="skill-meta">${sA.isUtility ? "Utility" : formatRankTag(sA.result)}${flagBadges.length > 0 ? ` &bull; ${escHtml(flagBadges.join(" • "))}` : ""}</div>
                                        </div>
                                    </div>
                                </td>
                                <td data-label="A Window">${fmtWin(sA)}</td>
                                <td class="val-a" data-label="A Expected">${sA.isUtility ? `<span class="skill-meta">Combo Buff</span>` : fmtInt(sA.result.expected)}</td>
                                <td data-label="A Hit / Crit">${hitCritStr(sA.result)}</td>
                                <td data-label="B Window">${fmtWin(sB)}</td>
                                <td class="val-b" data-label="B Expected">${sB.isUtility ? `<span class="skill-meta">Combo Buff</span>` : fmtInt(sB.result.expected)}</td>
                                <td data-label="B Hit / Crit">${hitCritStr(sB.result)}</td>
                                <td class="${sA.isUtility ? "delta-tie" : dCls}" data-label="A vs B">${sA.isUtility ? "&mdash;" : fmtDeltaPct(dPct)}</td>
                            </tr>`;
                        })
                        .join("")}
                    <tr class="rot-total-row">
                        <td>Total (${rA.stepCount} steps &bull; Target HP ${fmtInt(rA.targetMaxHp)}${shieldNote})</td>
                        <td data-label="A Time">${fmtDec(rA.totalDurationSec, 2)}s</td>
                        <td class="val-a" data-label="A Total">${fmtInt(rA.totalExpected)} (${fmtDec(rA.pctOfTargetHp)}%)</td>
                        <td data-label="A ${rateUnit}">${fmtInt(rA.windowRate)} ${rateUnit}</td>
                        <td data-label="B Time">${fmtDec(rB.totalDurationSec, 2)}s</td>
                        <td class="val-b" data-label="B Total">${fmtInt(rB.totalExpected)} (${fmtDec(rB.pctOfTargetHp)}%)</td>
                        <td data-label="B ${rateUnit}">${fmtInt(rB.windowRate)} ${rateUnit}</td>
                        <td class="${cmp.deltaExpectedPct > 0.05 ? "delta-pos" : cmp.deltaExpectedPct < -0.05 ? "delta-neg" : "delta-tie"}" data-label="A vs B">${fmtDeltaPct(cmp.deltaExpectedPct)}</td>
                    </tr>
                </tbody>
            </table>
        </div>`;

    const activeCustomRot = state.activeRotationId
        ? state.customRotations.find((p) => p.id === state.activeRotationId) || null
        : null;

    out.innerHTML = `
        <div class="rot-builder">
            <div class="rot-top-bar">
                <div class="rot-presets-row">
                    <span class="buff-presets-lbl">Combos:</span>
                    ${state.customRotations
                        .map(
                            (p) =>
                                `<span class="buff-preset-custom ${state.activeRotationId === p.id ? "active" : ""}" data-rot-preset="${escHtml(p.id)}" title="${state.activeRotationId === p.id ? (state.diskApiAvailable ? "Active combo — edits auto-save to combos/combos.json + browser storage" : "Active combo — edits auto-save to browser storage") : state.diskApiAvailable ? "Load combo from combos/combos.json" : "Load saved combo from browser storage"}"><span>${escHtml(p.label)}</span><button type="button" class="buff-preset-ren" data-ren-rot="${escHtml(p.id)}" title="Rename combo">&#9998;</button><button type="button" class="buff-preset-del" data-del-rot="${escHtml(p.id)}" title="Delete combo">&times;</button></span>`
                        )
                        .join("")}
                    <button type="button" class="buff-preset-btn buff-preset-save" id="saveRotationBtn">${activeCustomRot ? "+ Save Copy" : "+ Save Combo"}</button>
                    <button type="button" class="buff-preset-btn" id="clearRotationBtn">Clear</button>
                    <span class="rot-save-status" id="rotSaveStatus" title="${state.diskApiAvailable ? "Combos read from and auto-save to combos/combos.json (with browser localStorage backup)" : "Combos auto-save to browser localStorage"}">${state.rotLastSavedAt ? (state.diskApiAvailable ? "&#10003; Saved to combos.json (+ backup)" : "&#10003; Saved to browser storage") : state.diskApiAvailable ? "combos/combos.json" : "Browser storage"}</span>
                </div>
                <div class="rot-add-row">
                    <label class="rot-shield-field" title="Add an absorb shield HP pool on the target (e.g. Insulating Lens ~3,500, Protective Wings, or Conversion Shield) to include in Kill Probability &amp; TTK">
                        <span>Target Shield</span>
                        <input type="number" id="rotTargetShieldInput" min="0" max="50000" step="500" value="${targetAbsorbShield}" />
                        <span class="rot-shield-presets">
                            <button type="button" class="sm" data-rot-shield="0" title="No absorb shield">0</button>
                            <button type="button" class="sm" data-rot-shield="3500" title="Insulating Lens (~3,500 absorb)">Lens</button>
                            <button type="button" class="sm" data-rot-shield="6000" title="Heavy absorb shield (6,000)">6k</button>
                        </span>
                    </label>
                    ${
                        selectedSkillObj
                            ? `<button type="button" class="sm" id="addSelectedSkillRotBtn" title="Append the currently selected skill">+ Add ${escHtml(selectedSkillObj.name)}</button>`
                            : ""
                    }
                    <button type="button" class="sm primary" id="openRotSkillPickerBtn">+ Add Skill&hellip;</button>
                </div>
            </div>
            ${stepsBuilderHtml}
        </div>
        ${resultsHtml}
    `;

    // Bind Target Absorb Shield controls
    const shieldInp = document.getElementById("rotTargetShieldInput");
    if (shieldInp) {
        shieldInp.addEventListener("change", () => {
            state.rotationTargetShield = Math.max(0, parseInt(shieldInp.value, 10) || 0);
            ui.renderSimulation();
        });
    }
    out.querySelectorAll("[data-rot-shield]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.rotationTargetShield = Math.max(0, parseInt(btn.dataset.rotShield, 10) || 0);
            ui.renderSimulation();
        });
    });

    // Bind Rotation Builder events
    out.querySelectorAll("[data-rot-preset]").forEach((el) => {
        el.addEventListener("click", (e) => {
            const renBtn = e.target.closest("[data-ren-rot]");
            if (renBtn) {
                e.stopPropagation();
                const renId = renBtn.dataset.renRot;
                const target = state.customRotations.find((r) => r.id === renId);
                if (!target) return;
                const nextName = prompt("Rename combo:", target.label);
                if (!nextName || !nextName.trim()) return;
                target.label = nextName.trim().slice(0, 32);
                persistRotationState({ edited: false });
                ui.renderSimulation();
                showToast(`Renamed combo to "${target.label}"`, "ok");
                return;
            }
            const delBtn = e.target.closest("[data-del-rot]");
            if (delBtn) {
                e.stopPropagation();
                const delId = delBtn.dataset.delRot;
                state.customRotations = state.customRotations.filter((r) => r.id !== delId);
                if (state.activeRotationId === delId) {
                    const next = state.customRotations[0] || null;
                    state.activeRotationId = next ? next.id : null;
                    state.rotationSteps = next ? next.steps.map((s) => ({ ...s })) : [];
                }
                persistRotationState({ edited: false });
                ui.renderSimulation();
                showToast("Deleted combo", "ok");
                return;
            }
            const pid = el.dataset.rotPreset;
            const found = state.customRotations.find((p) => p.id === pid);
            if (!found) return;
            state.activeRotationId = found.id;
            state.rotationSteps = (found.steps || []).map((s) => ({ ...s }));
            persistRotationState({ edited: false });
            ui.renderSimulation();
        });
    });

    document.getElementById("saveRotationBtn")?.addEventListener("click", () => {
        if (state.rotationSteps.length === 0) {
            showToast("Add at least one skill before saving a combo", "err");
            return;
        }
        const label = prompt("Name this combo / rotation:", activeCustomRot ? `${activeCustomRot.label} Copy` : "");
        if (!label || !label.trim()) return;
        const cleanLabel = label.trim().slice(0, 32);
        const id = `rot_${slugifyBuildId(cleanLabel)}_${Date.now().toString(36)}`;
        state.customRotations.push({
            id,
            label: cleanLabel,
            steps: state.rotationSteps.map((s) => ({ ...s })),
        });
        state.activeRotationId = id;
        persistRotationState({ edited: false });
        ui.renderSimulation();
        showToast(`Saved combo "${cleanLabel}" to combos/combos.json`, "ok");
    });

    document.getElementById("clearRotationBtn")?.addEventListener("click", () => {
        state.rotationSteps = [];
        persistRotationState({ edited: true });
        ui.renderSimulation();
    });

    const addSelBtn = document.getElementById("addSelectedSkillRotBtn");
    if (addSelBtn && selectedSkillObj) {
        addSelBtn.addEventListener("click", () => {
            state.rotationSteps.push({
                skillId: selectedSkillObj.id,
                isBackstab: false,
                targetIsCCd: false,
                targetBelow30Pct: false,
                comboBonusPct: 0,
                delaySec: 0,
                weaponProc: "",
            });
            persistRotationState();
            ui.renderSimulation();
        });
    }

    document.getElementById("openRotSkillPickerBtn")?.addEventListener("click", openRotSkillPickerModal);

    out.querySelectorAll(".rot-step-row").forEach((row) => {
        const idx = parseInt(row.dataset.rotIdx, 10);
        row.querySelectorAll("[data-rot-flag]").forEach((cb) => {
            cb.addEventListener("change", () => {
                state.rotationSteps[idx][cb.dataset.rotFlag] = Boolean(cb.checked);
                persistRotationState();
                ui.renderSimulation();
            });
        });
        row.querySelectorAll("[data-rot-proc]").forEach((sel) => {
            sel.addEventListener("change", () => {
                const val = sel.value || "";
                if (val && COMBAT_MODIFIERS[val]) {
                    state.rotationSteps[idx].weaponProc = val;
                } else {
                    delete state.rotationSteps[idx].weaponProc;
                }
                persistRotationState();
                ui.renderSimulation();
            });
        });
        row.querySelectorAll("[data-rot-num]").forEach((inp) => {
            inp.addEventListener("input", () => {
                state.rotationSteps[idx][inp.dataset.rotNum] = parseFloat(inp.value) || 0;
                persistRotationState();
            });
            inp.addEventListener("change", () => {
                state.rotationSteps[idx][inp.dataset.rotNum] = parseFloat(inp.value) || 0;
                persistRotationState();
                ui.renderSimulation();
            });
        });
        row.querySelectorAll("[data-rot-act]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const act = btn.dataset.rotAct;
                if (act === "up" && idx > 0) {
                    const tmp = state.rotationSteps[idx - 1];
                    state.rotationSteps[idx - 1] = state.rotationSteps[idx];
                    state.rotationSteps[idx] = tmp;
                } else if (act === "down" && idx < state.rotationSteps.length - 1) {
                    const tmp = state.rotationSteps[idx + 1];
                    state.rotationSteps[idx + 1] = state.rotationSteps[idx];
                    state.rotationSteps[idx] = tmp;
                } else if (act === "dup") {
                    state.rotationSteps.splice(idx + 1, 0, { ...state.rotationSteps[idx] });
                } else if (act === "del") {
                    state.rotationSteps.splice(idx, 1);
                }
                persistRotationState();
                ui.renderSimulation();
            });
        });
    });
}

export function openRotSkillPickerModal() {
    state.rotPickerQuery = "";
    const searchEl = document.getElementById("rotPickerSearch");
    if (searchEl) searchEl.value = "";
    renderRotSkillPicker();
    document.getElementById("rotSkillPickerModal").classList.add("open");
    if (searchEl) setTimeout(() => searchEl.focus(), 30);
}

export function closeRotSkillPickerModal() {
    document.getElementById("rotSkillPickerModal").classList.remove("open");
}

export function renderRotSkillPicker() {
    const treeBar = document.getElementById("rotPickerTreePills");
    const bodyEl = document.getElementById("rotPickerBody");
    const queueEl = document.getElementById("rotPickerQueue");
    const undoBtn = document.getElementById("rotPickerUndoBtn");
    if (!treeBar || !bodyEl || !queueEl) return;

    const q = (state.rotPickerQuery || "").trim().toLowerCase();
    const variant = state.rotPickerVariant || "all";

    document.querySelectorAll("#rotPickerVariantPills .seg-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.rpVariant === variant);
    });

    const matchesFilter = (s) => {
        if (variant !== "all" && (s.variant || "base") !== variant) return false;
        if (q) {
            const hay = `${s.name} ${s.skillset} ${s.variant || ""} ${s.damageType || ""} ${s.kind || ""}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    };

    const allFiltered = state.allSkills.filter(matchesFilter);
    treeBar.innerHTML = [
        `<button type="button" class="pill ${state.rotPickerTree === "all" ? "active" : ""}" data-rp-tree="all">All <span class="pill-count">${allFiltered.length}</span></button>`,
        ...state.skillsetsMeta.map((t) => {
            const k = t.skillset;
            const cnt = (state.skillsByTree[k] || []).filter(matchesFilter).length;
            return `<button type="button" class="pill ${state.rotPickerTree === k ? "active" : ""}" data-rp-tree="${escHtml(k)}">${escHtml(cap(k))} <span class="pill-count">${cnt}</span></button>`;
        }),
    ].join("");
    treeBar.querySelectorAll("[data-rp-tree]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.rotPickerTree = btn.dataset.rpTree;
            renderRotSkillPicker();
        });
    });

    const treesToShow =
        state.rotPickerTree === "all"
            ? state.skillsetsMeta.map((t) => t.skillset)
            : [state.rotPickerTree];

    const sectionsHtml = treesToShow
        .map((treeKey) => {
            const list = (state.skillsByTree[treeKey] || []).filter(matchesFilter);
            if (list.length === 0) return "";
            return `
            <div class="rot-picker-tree-sec">
                <div class="rot-picker-tree-hdr">${escHtml(cap(treeKey))} (${list.length})</div>
                <div class="rot-picker-grid">
                    ${list
                        .map((s) => {
                            const skIcon = skillIconUrl(s);
                            const isUtil = s.kind === "utility";
                            const isHeal = s.kind === "heal";
                            const typeCls = isUtil
                                ? "stag-util"
                                : isHeal
                                  ? "stag-heal"
                                  : s.damageType === "magic"
                                    ? "stag-magic"
                                    : "stag-phys";
                            const typeTxt = isUtil
                                ? "UTILITY"
                                : isHeal
                                  ? "HEAL"
                                  : s.damageType === "magic"
                                    ? "MAGIC"
                                    : "PHYS";
                            const varBadge =
                                s.variant && s.variant !== "base"
                                    ? `<span class="stag ${s.variant === "hollow" ? "stag-hollow" : "stag-var"}">${escHtml(cap(s.variant))}</span>`
                                    : "";
                            const castStr = s.castTimeSec > 0 ? `${s.castTimeSec}s cast` : "Instant";
                            const cdStr = s.cooldownSec > 0 ? `${s.cooldownSec}s CD` : "No CD";
                            return `
                            <button type="button" class="rot-picker-card ${isUtil ? "rot-picker-card-util" : ""}" data-rp-add="${escHtml(s.id)}" title="${escHtml(s.description || s.name)}">
                                ${skIcon ? `<img class="rot-picker-card-icon" src="${escHtml(skIcon)}" alt="" loading="lazy" />` : ""}
                                <div class="rot-picker-card-info">
                                    <div class="rot-picker-card-top">
                                        <span class="rot-picker-card-name">${escHtml(s.name)}</span>
                                    </div>
                                    <div class="rot-picker-card-tags">
                                        <span class="stag ${typeCls}">${typeTxt}</span>
                                        ${varBadge}
                                        ${formatSkillCastBadge(s)}
                                        ${formatSkillGcdBadge(s)}
                                    </div>
                                    <div class="rot-picker-card-meta">${escHtml(formatFormulaShort(s))} &bull; ${castStr} &bull; ${cdStr}</div>
                                </div>
                                <span class="rot-picker-plus">+</span>
                            </button>`;
                        })
                        .join("")}
                </div>
            </div>`;
        })
        .filter(Boolean)
        .join("");

    bodyEl.innerHTML =
        sectionsHtml || `<div class="hint-inline">No skills match "${escHtml(state.rotPickerQuery)}".</div>`;

    bodyEl.querySelectorAll("[data-rp-add]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const sid = btn.dataset.rpAdd;
            const sk = state.allSkills.find((x) => x.id === sid);
            if (!sk) return;
            state.rotationSteps.push({
                skillId: sid,
                isBackstab: false,
                targetIsCCd: false,
                targetBelow30Pct: false,
                comboBonusPct: 0,
                delaySec: 0,
                weaponProc: "",
            });
            persistRotationState();
            ui.renderSimulation();
            renderRotSkillPickerQueue();
            showToast(`Added #${state.rotationSteps.length} ${sk.name}`, "ok");
        });
    });

    renderRotSkillPickerQueue();
    if (undoBtn) undoBtn.disabled = state.rotationSteps.length === 0;
}

export function renderRotSkillPickerQueue() {
    const queueEl = document.getElementById("rotPickerQueue");
    const undoBtn = document.getElementById("rotPickerUndoBtn");
    if (!queueEl) return;
    if (undoBtn) undoBtn.disabled = state.rotationSteps.length === 0;

    if (state.rotationSteps.length === 0) {
        queueEl.innerHTML = `<span class="hint-inline">Current combo: empty &mdash; click any skill above to add it.</span>`;
        return;
    }
    const skillById = new Map(state.allSkills.map((s) => [s.id, s]));
    queueEl.innerHTML = `<span class="buff-presets-lbl">Queue (${state.rotationSteps.length}):</span>${state.rotationSteps
        .map((st, idx) => {
            const sk = skillById.get(st.skillId);
            return `<span class="rot-picker-q-chip">${idx + 1}. ${escHtml(sk ? sk.name : st.skillId)}</span>`;
        })
        .join("")}`;
}
