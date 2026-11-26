/**
 * Rotation / Burst Combo (TTK & Exact Kill Probability) View + Skill Picker Modal.
 * Supports per-step Weapon Procs (e.g. Staff +10k M.Pen on Arc Lightning only)
 * and Target Absorb Shield HP pool (e.g. Insulating Lens / Conversion Shield).
 */

import {
    COMBAT_MODIFIERS,
    ROTATION_EXTRA_EFFECTS,
    STAGED_WEAVE_SKILL_IDS,
    compareRotations,
    getGearCatalog,
    getRotationExtraEffect,
    getSkillStages,
} from "../engine/index.js";
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

const QUICK_ROTATION_EFFECT_IDS = [
    "bleeding",
    "puncture",
    "shocked",
    "freezing",
    "burning",
    "distressed",
];

function getUtilityRoleBadge(skill) {
    if (!skill) return { cls: "stag-util", label: "UTILITY", roleText: "Combo Buff" };
    if (skill.skillset === "equipment") {
        const isCc = skill.utilityRole === "cc";
        return {
            cls: "stag-equip",
            label: isCc ? "EQUIP CC" : "EQUIP",
            roleText: isCc ? "Equip CC" : "Equip Debuff",
        };
    }
    if (skill.utilityRole === "cc") return { cls: "stag-cc", label: "CC", roleText: "CC" };
    if (skill.utilityRole === "debuff") return { cls: "stag-debuff-role", label: "DEBUFF", roleText: "Debuff" };
    return { cls: "stag-util", label: "UTILITY", roleText: "Combo Buff" };
}

const EQUIP_SET_NAME_FALLBACKS = Object.freeze({
    111: ["corrupted kyrios", "anthalon"],
    174: ["corrupted kyrios", "anthalon"],
    9000113: ["primal kyrios", "primal anthalon"],
    159: ["grimghast"],
});

export function isEquipSkillActiveOnChar(skill, char) {
    if (!skill || skill.skillset !== "equipment" || !char) return false;
    const matchItems = Array.isArray(skill.equipMatchItemIds) ? skill.equipMatchItemIds.map(Number) : [];
    const matchSets = Array.isArray(skill.equipMatchSetIds) ? skill.equipMatchSetIds.map(Number) : [];
    if (matchItems.length === 0 && matchSets.length === 0) return false;

    const catalog = getGearCatalog();
    const rawSlots = Array.isArray(char.rawDaruGear?.slots) ? char.rawDaruGear.slots : [];
    const summaryEq = Array.isArray(char.equipment) ? char.equipment : [];

    // Normalize equipped items from rawDaruGear.slots (when hydrated) and/or char.equipment (always present on saved builds)
    const equippedBySlot = new Map();
    const pushEntry = (slotKey, itemId, name, eisetId, setEffects) => {
        const key = slotKey != null ? `slot:${slotKey}` : `id:${itemId || name}`;
        if (!itemId && !name) return;
        const prev = equippedBySlot.get(key);
        if (!prev || (!prev.setEffects?.length && setEffects?.length) || (!prev.eisetId && eisetId)) {
            equippedBySlot.set(key, {
                itemId: Number.isFinite(Number(itemId)) && Number(itemId) > 0 ? Number(itemId) : null,
                name: String(name || "").trim(),
                eisetId: Number.isFinite(Number(eisetId)) && Number(eisetId) > 0 ? Number(eisetId) : null,
                setEffects: Array.isArray(setEffects) ? setEffects : [],
            });
        }
    };

    for (const eq of summaryEq) {
        if (!eq) continue;
        const iid = Number(eq.itemId ?? eq.id);
        const catItem = Number.isFinite(iid) && catalog?.itemById ? catalog.itemById.get(iid) : null;
        pushEntry(eq.slotId ?? eq.slotName, iid, eq.name || catItem?.name, eq.eiset_id ?? catItem?.eiset_id, eq.set_effects);
    }
    for (const sl of rawSlots) {
        const eq = sl?.item?.equipment;
        if (!eq) continue;
        const iid = Number(eq.id);
        const catItem = Number.isFinite(iid) && catalog?.itemById ? catalog.itemById.get(iid) : null;
        pushEntry(sl.id ?? sl.name, iid, eq.name || catItem?.name, eq.eiset_id ?? catItem?.eiset_id, eq.set_effects);
    }

    if (equippedBySlot.size === 0) return false;

    if (matchItems.length > 0) {
        for (const entry of equippedBySlot.values()) {
            if (entry.itemId && matchItems.includes(entry.itemId)) return true;
        }
    }

    if (matchSets.length > 0) {
        const minPcs = Math.max(1, Number(skill.equipMatchMinPieces) || 1);
        const fallbackNeedles = matchSets.flatMap((sid) => EQUIP_SET_NAME_FALLBACKS[sid] || []);
        let count = 0;
        for (const entry of equippedBySlot.values()) {
            const matchedBySetArr =
                entry.setEffects.length > 0 &&
                entry.setEffects.some((se) => matchSets.includes(Number(se?.equip_item_set_id)));
            const matchedBySetId = entry.eisetId != null && matchSets.includes(entry.eisetId);
            const lowName = entry.name.toLowerCase();
            const matchedByName =
                !matchedBySetArr &&
                !matchedBySetId &&
                fallbackNeedles.length > 0 &&
                fallbackNeedles.some((needle) => lowName.includes(needle));
            if (matchedBySetArr || matchedBySetId || matchedByName) {
                count++;
            }
        }
        if (count >= minPcs) return true;
    }
    return false;
}

function cloneRotationStep(s) {
    const out = { ...s };
    if (Array.isArray(s?.appliedDebuffs)) {
        out.appliedDebuffs = s.appliedDebuffs.slice();
    }
    return out;
}

function createRotationStepForSkill(skill) {
    const step = {
        skillId: skill.id,
        isBackstab: false,
        targetIsCCd: false,
        targetBelow30Pct: false,
        comboBonusPct: 0,
        delaySec: 0,
        travelTimeSec: 0,
        weaponProc: "",
        appliedDebuffs: [],
    };
    if (STAGED_WEAVE_SKILL_IDS.has(skill.id) && getSkillStages(skill).length > 1) {
        step.stageIndex = "auto";
    }
    return step;
}

function getNextAutoStagePreview(skill, steps) {
    const stages = getSkillStages(skill);
    if (stages.length <= 1 || !STAGED_WEAVE_SKILL_IDS.has(skill.id)) return null;
    let cursor = 0;
    for (const st of steps || []) {
        if (st?.skillId !== skill.id) continue;
        if (st.stageIndex === "all") {
            cursor = 0;
        } else if (st.stageIndex === "auto" || st.stageIndex == null || st.stageIndex === "") {
            cursor = (cursor + 1) % stages.length;
        } else if (Number.isFinite(Number(st.stageIndex))) {
            const n = Math.max(0, Math.min(stages.length - 1, Math.floor(Number(st.stageIndex))));
            cursor = (n + 1) % stages.length;
        }
    }
    return { index: cursor, count: stages.length, stage: stages[cursor] };
}

export function syncRotationsToDisk() {
    const payload = {
        activeId: state.activeRotationId || null,
        combos: state.customRotations.map((r) => ({
            id: r.id,
            label: r.label,
            initialEffects: Array.isArray(r.initialEffects) ? r.initialEffects.slice() : [],
            steps: (r.steps || []).map(cloneRotationStep),
        })),
        initialEffects: Array.isArray(state.rotationInitialEffects) ? state.rotationInitialEffects.slice() : [],
        steps: state.rotationSteps.map(cloneRotationStep),
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
            initialEffects: Array.isArray(r.initialEffects) ? r.initialEffects.map(String) : [],
            steps: Array.isArray(r.steps) ? r.steps.map(cloneRotationStep) : [],
        }));

    const diskActiveId = typeof disk.activeId === "string" ? disk.activeId : null;
    const matched = diskActiveId
        ? state.customRotations.find((r) => r.id === diskActiveId) || null
        : null;
    if (matched) {
        state.activeRotationId = matched.id;
        state.rotationSteps = matched.steps.map(cloneRotationStep);
        state.rotationInitialEffects = (matched.initialEffects || []).slice();
    } else if (Array.isArray(disk.steps)) {
        state.activeRotationId = null;
        state.rotationSteps = disk.steps.map(cloneRotationStep);
        state.rotationInitialEffects = Array.isArray(disk.initialEffects) ? disk.initialEffects.map(String) : [];
    } else if (state.customRotations.length > 0) {
        state.activeRotationId = state.customRotations[0].id;
        state.rotationSteps = state.customRotations[0].steps.map(cloneRotationStep);
        state.rotationInitialEffects = (state.customRotations[0].initialEffects || []).slice();
    } else {
        state.activeRotationId = null;
        state.rotationSteps = [];
        state.rotationInitialEffects = [];
    }
    state.rotationsUpdatedAt = Number(disk.updatedAt) || 0;
}

export function persistRotationState({ edited = true } = {}) {
    if (edited && state.activeRotationId) {
        const active = state.customRotations.find((r) => r.id === state.activeRotationId);
        if (active) {
            active.steps = state.rotationSteps.map(cloneRotationStep);
            active.initialEffects = Array.isArray(state.rotationInitialEffects)
                ? state.rotationInitialEffects.slice()
                : [];
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
    const rotationInitialEffects = Array.isArray(state.rotationInitialEffects)
        ? state.rotationInitialEffects
        : [];
    const ctxA = {
        ...baseCtx,
        targetAbsorbShield,
        rotationInitialEffects,
        attackerModifiers: getSlotModifiers("A"),
    };
    const ctxB = {
        ...baseCtx,
        targetAbsorbShield,
        rotationInitialEffects,
        attackerModifiers: getSlotModifiers("B"),
    };
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

    const activeCustomRot = state.activeRotationId
        ? state.customRotations.find((p) => p.id === state.activeRotationId) || null
        : null;

    const stepsBuilderHtml =
        state.rotationSteps.length === 0
            ? `<div class="hint-inline">${activeCustomRot ? `Rotation <strong>${escHtml(activeCustomRot.label)}</strong> is empty.` : "Queue is empty."} Pick a saved rotation above or click <strong>+ Add Skill&hellip;</strong> to build a burst rotation!</div>`
            : `<div class="rot-steps-list">${state.rotationSteps
                  .map((st, idx) => {
                      const sk = skillById.get(st.skillId);
                      if (!sk) return "";
                      const srA = stepResByRawIdx.get(idx) || null;
                      const effSk = srA?.skill || sk;
                      const stages = getSkillStages(sk);
                      const hasStages = stages.length > 1;
                      const resolvedStageIdx = srA?.stageIndex != null ? srA.stageIndex : null;
                      const resolvedStageLbl = srA?.stageLabel || null;
                      const curStageSelectVal =
                          st.stageIndex === "auto" || (st.stageIndex == null && srA?.stageMode === "auto")
                              ? "auto"
                              : st.stageIndex === "all" || resolvedStageIdx == null
                                ? "all"
                                : String(resolvedStageIdx);
                      const stageBadgeHtml =
                          hasStages && resolvedStageIdx != null
                              ? `<span class="stag stag-stage" title="Cast stage ${resolvedStageIdx + 1} of ${stages.length} (${escHtml(resolvedStageLbl)})">${escHtml(resolvedStageLbl)} (${resolvedStageIdx + 1}/${stages.length})</span>`
                              : "";
                      const stageSelectHtml = hasStages
                          ? `<label class="rot-flag-stage" title="Pick cast stage for this multi-cast skill (Auto progresses 1→${stages.length} across repeated steps in the rotation)">
                                 Stage
                                 <select class="rot-stage-sel" data-rot-stage="${idx}">
                                     <option value="auto" ${curStageSelectVal === "auto" ? "selected" : ""}>Auto${resolvedStageIdx != null && curStageSelectVal === "auto" ? ` (${resolvedStageIdx + 1}/${stages.length})` : ""}</option>
                                     <option value="all" ${curStageSelectVal === "all" ? "selected" : ""}>All (${stages.length} hits)</option>
                                     ${stages
                                         .map(
                                             (sg) =>
                                                 `<option value="${sg.index}" ${curStageSelectVal === String(sg.index) ? "selected" : ""}>${sg.index + 1}/${stages.length}: ${escHtml(sg.label)} (${sg.base ? `${sg.base}+` : ""}${sg.scalingPct}%)</option>`
                                         )
                                         .join("")}
                                 </select>
                             </label>`
                          : "";
                      const skIcon = skillIconUrl(sk);
                      const isUtilSk = effSk.kind === "utility";
                      const isHealSk = effSk.kind === "heal";
                      const hasCast = Number(effSk.castTimeSec) > 0;
                      const hasCustomGcd = effSk.gcdSec != null && Number.isFinite(Number(effSk.gcdSec));
                      const baseSkillGcd = hasCustomGcd ? Number(effSk.gcdSec) : effSk.flags?.noGcd ? 0 : 1.0;
                      const isInherentOffGcd =
                          baseSkillGcd === 0 && !hasCast && !(Number(effSk.fireIntervalSec) > 0);
                      const utilMeta = isUtilSk ? getUtilityRoleBadge(effSk) : null;
                      const typeCls = isUtilSk
                          ? utilMeta.cls
                          : isHealSk
                            ? "stag-heal"
                            : sk.damageType === "magic"
                              ? "stag-magic"
                              : "stag-phys";
                      const typeTxt = isUtilSk
                          ? utilMeta.label
                          : isHealSk
                            ? "HEAL"
                            : sk.damageType === "magic"
                              ? "MAGIC"
                              : "PHYS";
                      const utilGrantBadge =
                          isUtilSk && !effSk.comboEffect?.summary && effSk.utilitySummary
                              ? `<span class="stag ${effSk.utilityRole === "cc" ? "stag-cc-sub" : "stag-combo"}" title="${escHtml(effSk.description || effSk.utilitySummary)}">&#10022; ${escHtml(effSk.utilitySummary)}</span>`
                              : "";
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
                      const stepExtraIds = Array.isArray(st.appliedDebuffs) ? st.appliedDebuffs : [];
                      const stepExtraBadges = stepExtraIds
                          .map((eid) => {
                              const eff = getRotationExtraEffect(eid);
                              if (!eff) return "";
                              return `<span class="stag stag-extradep" title="Random/proc debuff applied by this step upon hit (${escHtml(eff.label)}) — click × to remove">+${escHtml(eff.shortLabel)}<button type="button" class="rot-eff-rm" data-rot-rm-debuff="${idx}" data-eff-id="${escHtml(eff.id)}" aria-label="Remove ${escHtml(eff.shortLabel)}">&times;</button></span>`;
                          })
                          .join("");
                      const availableStepDebuffs = ROTATION_EXTRA_EFFECTS.filter(
                          (eff) => !stepExtraIds.includes(eff.id)
                      );
                      const stepDebuffAddHtml =
                          availableStepDebuffs.length > 0
                              ? `<select class="rot-debuff-sel" data-rot-add-debuff="${idx}" title="Enable a random/proc debuff applied by this step (e.g. Delirium applying Bleeding, Puncture, etc.)">
                                     <option value="">+ Apply Debuff&hellip;</option>
                                     ${availableStepDebuffs
                                         .map(
                                             (eff) =>
                                                 `<option value="${escHtml(eff.id)}">${escHtml(eff.label)}</option>`
                                         )
                                         .join("")}
                                 </select>`
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
                      const activeTargetEffs = Array.isArray(srA?.activeTargetEffects) ? srA.activeTargetEffects : [];
                      const activeBuffEffs = Array.isArray(srA?.activeComboBuffs) ? srA.activeComboBuffs : [];
                      const activeEffectsStripHtml =
                          activeTargetEffs.length > 0 || activeBuffEffs.length > 0
                              ? `<div class="rot-active-effs" title="Active target debuffs/statuses and combo buffs with remaining duration when this step hits">
                                     <span class="rot-active-effs-lbl">Active @ ${fmtDec(srA?.startSec || 0, 2)}s:</span>
                                     ${activeTargetEffs
                                         .map((ef) => {
                                             const durStr = ef.isPermanent
                                                 ? "&#8734;"
                                                 : `${fmtDec(ef.remainingSec, 1)}s`;
                                             const cls = ef.isCC
                                                 ? "rot-ae-cc"
                                                 : ef.kind === "debuff"
                                                   ? "rot-ae-debuff"
                                                   : "rot-ae-status";
                                             return `<span class="rot-ae-chip ${cls}">${escHtml(ef.label)} <em>${durStr}</em></span>`;
                                         })
                                         .join("")}
                                     ${activeBuffEffs
                                         .map(
                                             (bf) =>
                                                 `<span class="rot-ae-chip rot-ae-buff">${escHtml(bf.label)} <em>${fmtDec(bf.remainingSec, 1)}s</em></span>`
                                         )
                                         .join("")}
                                 </div>`
                              : "";
                      return `
                      <div class="rot-step-row ${isUtilSk ? "rot-step-util" : ""} ${hasAnyComboHit ? "rot-step-combo-hit" : ""}" data-rot-idx="${idx}">
                          <div class="rot-step-main">
                              <span class="rot-drag-handle" title="Drag to reorder skill" aria-label="Drag to reorder">&#8942;&#8942;</span>
                              <span class="rot-step-num">${idx + 1}</span>
                              ${skIcon ? `<img class="rot-step-icon" src="${escHtml(skIcon)}" alt="" loading="lazy" />` : ""}
                              <strong>${escHtml(sk.name)}</strong>
                              ${stageBadgeHtml}
                              <span class="stag ${typeCls}">${typeTxt}</span>
                              ${formatSkillCastBadge(effSk, srA)}
                              ${formatSkillGcdBadge(effSk)}
                              ${formatSkillComboBadge(effSk)}
                              ${utilGrantBadge}
                              ${procBadge}${stepExtraBadges}${autoComboBadges}${autoCcBadge}${activeDebBadges}
                          </div>
                          ${activeEffectsStripHtml}
                          <div class="rot-step-flags">
                              ${stageSelectHtml}
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
                              <label class="rot-flag-chk ${isInherentOffGcd ? "is-inherent" : ""}" title="${isInherentOffGcd ? "Inherently Off-GCD (0.00s GCD)" : "Weave off-GCD / animation-cancel this step (0.00s GCD & cast footprint)"}">
                                  <input type="checkbox" data-rot-flag="offGcd" ${isInherentOffGcd || st.offGcd ? "checked" : ""} ${isInherentOffGcd ? "disabled" : ""} /> Off-GCD
                              </label>
                              <label class="rot-flag-num" title="Fine-grained extra delay / weave time in seconds (0.01s precision, e.g. 0.05s or 0.25s)">
                                  +Delay <input type="number" step="0.01" min="0" max="10" data-rot-num="delaySec" value="${Number(st.delaySec) || 0}" />s
                              </label>
                              <label class="rot-flag-num" title="Projectile travel time in seconds before hit lands (delays impact &amp; combo application without delaying next cast GCD)">
                                  +Travel <input type="number" step="0.01" min="0" max="10" data-rot-num="travelTimeSec" value="${Number(st.travelTimeSec) || 0}" />s
                              </label>
                              ${stepDebuffAddHtml}
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
                const stageShort = s.stageIndex != null ? ` #${s.stageIndex + 1}` : "";
                const stageTip = s.stageIndex != null ? ` [${s.stageLabel} (${s.stageIndex + 1}/${s.stageCount})]` : "";
                if (isOffGcdStep) {
                    const utilSummary =
                        s.grantedStatuses?.length > 0
                            ? `Applies ${s.grantedStatuses.join(", ")}`
                            : s.grantedComboEffect?.summary || s.skill.utilitySummary || "Utility";
                    const tip = s.isUtility
                        ? `${s.skill.name}${stageTip}: Off-GCD @ ${fmtDec(s.startSec, 2)}s (0.00s) • ${utilSummary}`
                        : `${s.skill.name}${stageTip}: Off-GCD @ ${fmtDec(s.startSec, 2)}s (0.00s) • Expected ${fmtInt(s.result.expected)}`;
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
                const travelTip =
                    s.travelTimeSec > 0.001
                        ? ` • Travel +${fmtDec(s.travelTimeSec, 2)}s (lands @ ${fmtDec(s.impactSec, 2)}s)`
                        : "";
                const utilTipSummary =
                    s.grantedStatuses?.length > 0
                        ? `Applies ${s.grantedStatuses.join(", ")}`
                        : s.grantedComboEffect?.summary || s.skill.utilitySummary || "Utility";
                const tip = s.isUtility
                    ? `${s.skill.name}${stageTip}: ${fmtDec(s.startSec, 2)}s → ${fmtDec(s.endSec, 2)}s (${timeSummary})${travelTip} • ${utilTipSummary}`
                    : `${s.skill.name}${stageTip}: ${fmtDec(s.startSec, 2)}s → ${fmtDec(s.endSec, 2)}s (${timeSummary})${travelTip}${procTip} • Expected ${fmtInt(s.result.expected)}`;
                if (hasSplitCast) {
                    const castPct = Math.min(95, Math.max(5, (s.castSec / s.durationSec) * 100));
                    const gcdPct = 100 - castPct;
                    return `<div class="rot-tl-seg seg-split ${isKillStep ? "seg-kill" : ""}" style="width:${wPct.toFixed(2)}%" title="${escHtml(tip)}">
                        <div class="rot-tl-cast" style="width:${castPct.toFixed(1)}%">${escHtml(s.skill.name)}${stageShort} (${fmtDec(s.castSec, 2)}s)</div>
                        <div class="rot-tl-gcd ${cls}" style="width:${gcdPct.toFixed(1)}%">+${fmtDec(s.postGcdSec, 2)}s</div>
                    </div>`;
                }
                const prefix = s.weaponProcId ? "&#9876; " : s.castTimeRemoved ? "&#9889; " : "";
                return `<div class="rot-tl-seg ${cls} ${comboCls} ${isKillStep ? "seg-kill" : ""}" style="width:${wPct.toFixed(2)}%" title="${escHtml(tip)}">${prefix}${escHtml(s.skill.name)}${stageShort} (${fmtDec(s.durationSec, 2)}s)</div>`;
            })
            .join("");
        const travelTailSec = Number(res.totalTravelTailSec) || 0;
        const travelTailPct = travelTailSec > 0.005 ? (travelTailSec / maxDur) * 100 : 0;
        const padPct = Math.max(0, ((maxDur - res.totalDurationSec) / maxDur) * 100);
        const castMeta =
            res.totalCastTimeSec > 0.005 || res.totalCastTimeSavedSec > 0.005
                ? ` &bull; Cast ${fmtDec(res.totalCastTimeSec, 2)}s${res.totalCastTimeSavedSec > 0.005 ? ` <span class="delta-pos">(&#9889; -${fmtDec(res.totalCastTimeSavedSec, 2)}s saved)</span>` : ""}`
                : "";
        const travelMeta =
            travelTailSec > 0.005
                ? ` &bull; <span class="val-b">+${fmtDec(travelTailSec, 2)}s travel</span>`
                : "";
        return `
        <div class="rot-tl-row">
            <div class="rot-tl-meta">
                <strong class="${valCls}">${escHtml(label)}</strong>
                <span class="hint-inline">Total window: <strong>${fmtDec(res.totalDurationSec, 2)}s</strong> &bull; ${fmtInt(res.windowRate)} ${rateUnit}${castMeta}${travelMeta}${!isHeal && res.killTimestampSec != null ? ` &bull; Expected kill at <strong>${fmtDec(res.killTimestampSec, 2)}s</strong>` : ""}</span>
            </div>
            <div class="rot-tl-track">
                ${segs}
                ${travelTailPct > 0.2 ? `<div class="rot-tl-seg seg-travel" style="width:${travelTailPct.toFixed(2)}%" title="Projectile travel tail (+${fmtDec(travelTailSec, 2)}s until last hit lands)">+${fmtDec(travelTailSec, 2)}s travel</div>` : ""}
                ${padPct > 0.5 ? `<div class="rot-tl-pad" style="width:${padPct.toFixed(2)}%"></div>` : ""}
            </div>
        </div>`;
    };

    const effectSpansA = Array.isArray(rA.effectSpans) ? rA.effectSpans : [];
    const debuffTimelineHtml =
        effectSpansA.length === 0
            ? ""
            : `<div class="rot-debuff-tl">
                   <div class="rot-debuff-tl-hdr">Active Debuffs, Statuses &amp; Combo Buffs (${escHtml(state.buildA.name)} Timeline)</div>
                   <div class="rot-debuff-tl-rows">
                       ${effectSpansA
                           .map((sp) => {
                               const startClamped = Math.max(0, Math.min(maxDur, sp.startSec));
                               const endClamped = sp.isPermanent ? maxDur : Math.max(startClamped, Math.min(maxDur, sp.endSec));
                               const leftPct = (startClamped / maxDur) * 100;
                               const widthPct = Math.max(3, ((endClamped - startClamped) / maxDur) * 100);
                               const persistsPast = !sp.isPermanent && sp.endSec > maxDur + 0.05;
                               const durLabel = sp.isPermanent
                                   ? "Full rotation"
                                   : `${fmtDec(sp.startSec, 2)}s–${fmtDec(sp.endSec, 2)}s (${fmtDec(sp.durationSec, 1)}s)${persistsPast ? " →" : ""}`;
                               const barCls = sp.isCC
                                   ? "dtl-cc"
                                   : sp.kind === "debuff"
                                     ? "dtl-debuff"
                                     : sp.kind === "combo_buff"
                                       ? "dtl-buff"
                                       : "dtl-status";
                               return `
                               <div class="rot-dtl-row" title="${escHtml(sp.label)}: ${escHtml(durLabel)}">
                                   <div class="rot-dtl-head">
                                       <span class="rot-dtl-lbl">${escHtml(sp.label)}</span>
                                       <span class="rot-dtl-dur">${escHtml(durLabel)}</span>
                                   </div>
                                   <div class="rot-dtl-track">
                                       <div class="rot-dtl-bar ${barCls}" style="left:${leftPct.toFixed(2)}%;width:${Math.min(100 - leftPct, widthPct).toFixed(2)}%">
                                           <span class="rot-dtl-bar-txt">${escHtml(durLabel)}</span>
                                       </div>
                                   </div>
                               </div>`;
                           })
                           .join("")}
                   </div>
               </div>`;

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
                    <span class="rot-leg-item"><span class="rot-leg-swatch sw-travel"></span>Travel Time</span>
                </div>
            </div>
            ${buildTimelineHtml(state.buildA.name, rA, "seg-a", "val-a")}
            ${buildTimelineHtml(state.buildB.name, rB, "seg-b", "val-b")}
            ${debuffTimelineHtml}
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
                            if (Number(sA.step.delaySec)) flagBadges.push(`+${fmtDec(Number(sA.step.delaySec), 2)}s delay`);
                            if (sA.travelTimeSec > 0.001) flagBadges.push(`+${fmtDec(sA.travelTimeSec, 2)}s travel`);
                            const fmtWin = (stRes) => {
                                const impactLine =
                                    stRes.travelTimeSec > 0.001
                                        ? `<div class="skill-meta">Impact @ ${fmtDec(stRes.impactSec, 2)}s (+${fmtDec(stRes.travelTimeSec, 2)}s travel)</div>`
                                        : "";
                                if (stRes.durationSec <= 1e-6) {
                                    return `<div>@${fmtDec(stRes.startSec, 2)}s</div><div class="skill-meta">Off-GCD (0.00s)</div>${impactLine}`;
                                }
                                const sub =
                                    stRes.castSec > 1e-6
                                        ? `${fmtDec(stRes.castSec, 2)}s cast + ${fmtDec(stRes.postGcdSec, 2)}s GCD`
                                        : stRes.castTimeRemoved
                                          ? `&#9889; ${fmtDec(stRes.postGcdSec, 2)}s GCD (-${fmtDec(stRes.castTimeSavedSec, 2)}s)`
                                          : `${fmtDec(stRes.durationSec, 2)}s GCD`;
                                return `<div>${fmtDec(stRes.startSec, 2)}s&ndash;${fmtDec(stRes.endSec, 2)}s</div><div class="skill-meta">${sub}</div>${impactLine}`;
                            };
                            const hitCritStr = (res) =>
                                res.kind === "utility"
                                    ? "&mdash;"
                                    : res.kind === "heal"
                                      ? `100% / ${fmtDec(res.breakdown.critRatePct)}%`
                                      : `${fmtDec(res.breakdown.avoidance.connectPct)}% / ${fmtDec(res.breakdown.effectiveCritRatePct)}%`;
                            const utilRoleTxt = sA.isUtility ? getUtilityRoleBadge(sk).roleText : "";
                            return `
                            <tr class="${sA.isUtility ? "rot-util-tr" : ""}">
                                <td>
                                    <div class="table-skill-cell">
                                        <span class="rot-step-num">${i + 1}</span>
                                        ${skIcon ? `<img class="table-skill-icon" src="${escHtml(skIcon)}" alt="" loading="lazy" />` : ""}
                                        <div>
                                            <div class="skill-name">${escHtml(sk.name)}${sA.stageIndex != null ? ` <span class="stag stag-stage">${escHtml(sA.stageLabel)} (${sA.stageIndex + 1}/${sA.stageCount})</span>` : ""}</div>
                                            <div class="skill-meta">${sA.isUtility ? escHtml(utilRoleTxt) : formatRankTag(sA.result)}${flagBadges.length > 0 ? ` &bull; ${escHtml(flagBadges.join(" • "))}` : ""}</div>
                                        </div>
                                    </div>
                                </td>
                                <td data-label="A Window">${fmtWin(sA)}</td>
                                <td class="val-a" data-label="A Expected">${sA.isUtility ? `<span class="skill-meta">${escHtml(utilRoleTxt)}</span>` : fmtInt(sA.result.expected)}</td>
                                <td data-label="A Hit / Crit">${hitCritStr(sA.result)}</td>
                                <td data-label="B Window">${fmtWin(sB)}</td>
                                <td class="val-b" data-label="B Expected">${sB.isUtility ? `<span class="skill-meta">${escHtml(utilRoleTxt)}</span>` : fmtInt(sB.result.expected)}</td>
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

    const activeInitSet = new Set(rotationInitialEffects);
    const pillIds = Array.from(new Set([...QUICK_ROTATION_EFFECT_IDS, ...rotationInitialEffects]));
    const moreInitEffects = ROTATION_EXTRA_EFFECTS.filter((eff) => !pillIds.includes(eff.id));
    const initDebuffsBarHtml = `
        <div class="rot-procs-bar">
            <span class="buff-presets-lbl" title="Toggle random/proc debuffs active across this rotation (e.g. Delirium Bleed proc, Puncture, or teammate setups). You can also apply debuffs on individual steps below.">Random / Proc Debuffs:</span>
            ${pillIds
                .map((eid) => {
                    const eff = getRotationExtraEffect(eid);
                    if (!eff) return "";
                    const isOn = activeInitSet.has(eff.id);
                    return `<button type="button" class="rot-proc-pill ${isOn ? "active" : ""}" data-rot-init-eff="${escHtml(eff.id)}" title="${escHtml(eff.label)} — click to ${isOn ? "disable" : "enable"} for this rotation">${escHtml(eff.id === "bleeding" ? "Bleeding (Delirium)" : eff.shortLabel)}</button>`;
                })
                .join("")}
            ${
                moreInitEffects.length > 0
                    ? `<select class="rot-debuff-sel" id="rotAddInitEffSel" title="Enable another target debuff or combo status for this rotation">
                           <option value="">+ More Debuffs&hellip;</option>
                           ${moreInitEffects
                               .map((eff) => `<option value="${escHtml(eff.id)}">${escHtml(eff.label)}</option>`)
                               .join("")}
                       </select>`
                    : ""
            }
            ${
                rotationInitialEffects.length > 0
                    ? `<button type="button" class="buff-preset-btn" id="rotClearInitEffBtn" title="Clear all enabled rotation debuffs">Clear Debuffs</button>`
                    : ""
            }
        </div>`;

    out.innerHTML = `
        <div class="rot-builder">
            <div class="rot-top-bar">
                <div class="rot-presets-row">
                    <span class="buff-presets-lbl">Rotations:</span>
                    ${state.customRotations
                        .map(
                            (p) =>
                                `<span class="buff-preset-custom ${state.activeRotationId === p.id ? "active" : ""}" data-rot-preset="${escHtml(p.id)}" title="${state.activeRotationId === p.id ? (state.diskApiAvailable ? "Active rotation — edits auto-save to combos/combos.json + browser storage" : "Active rotation — edits auto-save to browser storage") : state.diskApiAvailable ? "Load rotation from combos/combos.json" : "Load saved rotation from browser storage"}"><span>${escHtml(p.label)}</span><button type="button" class="buff-preset-ren" data-ren-rot="${escHtml(p.id)}" title="Rename rotation">&#9998;</button><button type="button" class="buff-preset-del" data-del-rot="${escHtml(p.id)}" title="Delete rotation">&times;</button></span>`
                        )
                        .join("")}
                    <button type="button" class="buff-preset-btn buff-preset-save" id="newRotationBtn" title="Create a new empty skill rotation">+ New Rotation</button>
                    <button type="button" class="buff-preset-btn" id="saveRotationBtn" title="${activeCustomRot ? "Save a duplicate copy of the current rotation" : "Save the current skill queue as a named rotation"}">${activeCustomRot ? "+ Save Copy" : "+ Save Rotation"}</button>
                    <button type="button" class="buff-preset-btn" id="clearRotationBtn" title="Remove all steps from the current rotation">Clear</button>
                    <span class="rot-save-status" id="rotSaveStatus" title="${state.diskApiAvailable ? "Rotations read from and auto-save to combos/combos.json (with browser localStorage backup)" : "Rotations auto-save to browser localStorage"}">${state.rotLastSavedAt ? (state.diskApiAvailable ? "&#10003; Saved to combos.json (+ backup)" : "&#10003; Saved to browser storage") : state.diskApiAvailable ? "combos/combos.json" : "Browser storage"}</span>
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
            ${initDebuffsBarHtml}
            ${stepsBuilderHtml}
        </div>
        ${resultsHtml}
    `;

    // Bind Random / Proc Debuffs rotation-wide controls
    out.querySelectorAll("[data-rot-init-eff]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const eid = btn.dataset.rotInitEff;
            if (!getRotationExtraEffect(eid)) return;
            const cur = Array.isArray(state.rotationInitialEffects) ? state.rotationInitialEffects.slice() : [];
            const pos = cur.indexOf(eid);
            if (pos >= 0) cur.splice(pos, 1);
            else cur.push(eid);
            state.rotationInitialEffects = cur;
            persistRotationState();
            ui.renderSimulation();
        });
    });
    document.getElementById("rotAddInitEffSel")?.addEventListener("change", (e) => {
        const eid = e.target.value;
        if (!eid || !getRotationExtraEffect(eid)) return;
        const cur = Array.isArray(state.rotationInitialEffects) ? state.rotationInitialEffects.slice() : [];
        if (!cur.includes(eid)) cur.push(eid);
        state.rotationInitialEffects = cur;
        persistRotationState();
        ui.renderSimulation();
    });
    document.getElementById("rotClearInitEffBtn")?.addEventListener("click", () => {
        state.rotationInitialEffects = [];
        persistRotationState();
        ui.renderSimulation();
    });

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
                    state.rotationSteps = next ? next.steps.map(cloneRotationStep) : [];
                    state.rotationInitialEffects = next && Array.isArray(next.initialEffects) ? next.initialEffects.slice() : [];
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
            state.rotationSteps = (found.steps || []).map(cloneRotationStep);
            state.rotationInitialEffects = Array.isArray(found.initialEffects) ? found.initialEffects.slice() : [];
            persistRotationState({ edited: false });
            ui.renderSimulation();
        });
    });

    document.getElementById("newRotationBtn")?.addEventListener("click", () => {
        const existingLabels = new Set(state.customRotations.map((r) => String(r.label || "").toLowerCase()));
        let defaultName = "New Rotation";
        let suffix = 2;
        while (existingLabels.has(defaultName.toLowerCase())) {
            defaultName = `New Rotation ${suffix++}`;
        }
        const label = prompt("Name your new rotation:", defaultName);
        if (!label || !label.trim()) return;
        const cleanLabel = label.trim().slice(0, 32);
        const id = `rot_${slugifyBuildId(cleanLabel)}_${Date.now().toString(36)}`;
        state.customRotations.push({
            id,
            label: cleanLabel,
            initialEffects: [],
            steps: [],
        });
        state.activeRotationId = id;
        state.rotationSteps = [];
        state.rotationInitialEffects = [];
        persistRotationState({ edited: false });
        ui.renderSimulation();
        showToast(`Created new rotation "${cleanLabel}" — click + Add Skill… to add steps`, "ok");
    });

    document.getElementById("saveRotationBtn")?.addEventListener("click", () => {
        if (state.rotationSteps.length === 0) {
            showToast("Add at least one skill before saving a rotation copy", "err");
            return;
        }
        const label = prompt("Name this rotation:", activeCustomRot ? `${activeCustomRot.label} Copy` : "");
        if (!label || !label.trim()) return;
        const cleanLabel = label.trim().slice(0, 32);
        const id = `rot_${slugifyBuildId(cleanLabel)}_${Date.now().toString(36)}`;
        state.customRotations.push({
            id,
            label: cleanLabel,
            initialEffects: Array.isArray(state.rotationInitialEffects) ? state.rotationInitialEffects.slice() : [],
            steps: state.rotationSteps.map(cloneRotationStep),
        });
        state.activeRotationId = id;
        persistRotationState({ edited: false });
        ui.renderSimulation();
        showToast(
            state.diskApiAvailable
                ? `Saved rotation "${cleanLabel}" to combos/combos.json`
                : `Saved rotation "${cleanLabel}" to browser storage`,
            "ok"
        );
    });

    document.getElementById("clearRotationBtn")?.addEventListener("click", () => {
        state.rotationSteps = [];
        persistRotationState({ edited: true });
        ui.renderSimulation();
    });

    const addSelBtn = document.getElementById("addSelectedSkillRotBtn");
    if (addSelBtn && selectedSkillObj) {
        addSelBtn.addEventListener("click", () => {
            const nextPreview = getNextAutoStagePreview(selectedSkillObj, state.rotationSteps);
            state.rotationSteps.push(createRotationStepForSkill(selectedSkillObj));
            persistRotationState();
            ui.renderSimulation();
            if (nextPreview) {
                showToast(
                    `Added #${state.rotationSteps.length} ${selectedSkillObj.name} (${nextPreview.stage.label} — ${nextPreview.index + 1}/${nextPreview.count})`,
                    "ok"
                );
            }
        });
    }

    document.getElementById("openRotSkillPickerBtn")?.addEventListener("click", openRotSkillPickerModal);

    out.querySelectorAll(".rot-step-row").forEach((row) => {
        const idx = parseInt(row.dataset.rotIdx, 10);
        row.querySelectorAll("[data-rot-stage]").forEach((sel) => {
            sel.addEventListener("change", () => {
                const v = sel.value;
                if (v === "auto" || v === "all") {
                    state.rotationSteps[idx].stageIndex = v;
                } else {
                    const num = parseInt(v, 10);
                    state.rotationSteps[idx].stageIndex = Number.isFinite(num) ? num : "all";
                }
                persistRotationState();
                ui.renderSimulation();
            });
        });
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
        row.querySelectorAll("[data-rot-add-debuff]").forEach((sel) => {
            sel.addEventListener("change", () => {
                const eid = sel.value || "";
                if (!eid || !getRotationExtraEffect(eid)) return;
                const list = Array.isArray(state.rotationSteps[idx].appliedDebuffs)
                    ? state.rotationSteps[idx].appliedDebuffs.slice()
                    : [];
                if (!list.includes(eid)) list.push(eid);
                state.rotationSteps[idx].appliedDebuffs = list;
                persistRotationState();
                ui.renderSimulation();
            });
        });
        row.querySelectorAll("[data-rot-rm-debuff]").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const eid = btn.dataset.effId;
                const list = Array.isArray(state.rotationSteps[idx].appliedDebuffs)
                    ? state.rotationSteps[idx].appliedDebuffs.filter((x) => x !== eid)
                    : [];
                state.rotationSteps[idx].appliedDebuffs = list;
                persistRotationState();
                ui.renderSimulation();
            });
        });
        row.querySelectorAll("[data-rot-num]").forEach((inp) => {
            const parseNum = () => {
                const raw = parseFloat(inp.value);
                if (!Number.isFinite(raw)) return 0;
                const field = inp.dataset.rotNum;
                if (field === "delaySec" || field === "travelTimeSec") {
                    return Math.max(0, Math.round(raw * 1000) / 1000);
                }
                return raw;
            };
            inp.addEventListener("input", () => {
                state.rotationSteps[idx][inp.dataset.rotNum] = parseNum();
                persistRotationState();
            });
            inp.addEventListener("change", () => {
                state.rotationSteps[idx][inp.dataset.rotNum] = parseNum();
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
                    const dupStep = cloneRotationStep(state.rotationSteps[idx]);
                    const dupSkill = skillById.get(dupStep.skillId);
                    const dupStages = dupSkill ? getSkillStages(dupSkill) : [];
                    if (
                        dupStages.length > 1 &&
                        dupStep.stageIndex != null &&
                        dupStep.stageIndex !== "auto" &&
                        dupStep.stageIndex !== "all" &&
                        Number.isFinite(Number(dupStep.stageIndex))
                    ) {
                        dupStep.stageIndex = (Math.floor(Number(dupStep.stageIndex)) + 1) % dupStages.length;
                    }
                    state.rotationSteps.splice(idx + 1, 0, dupStep);
                } else if (act === "del") {
                    state.rotationSteps.splice(idx, 1);
                }
                persistRotationState();
                ui.renderSimulation();
            });
        });
    });

    // Pointer-based drag-and-drop reordering for rotation steps (works on both desktop mouse & mobile touch)
    const stepsListEl = out.querySelector(".rot-steps-list");
    if (stepsListEl && state.rotationSteps.length > 1) {
        const startStepDrag = (e, rowEl, fromIdx) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            const startY = e.clientY;
            let dragging = false;
            let dropIdx = fromIdx;
            const allRows = Array.from(stepsListEl.querySelectorAll(".rot-step-row"));

            const clearDropIndicators = () => {
                for (const r of allRows) {
                    r.classList.remove("rot-drop-before", "rot-drop-after");
                }
            };

            const onMove = (ev) => {
                if (!dragging) {
                    if (Math.abs(ev.clientY - startY) < 6) return;
                    dragging = true;
                    rowEl.classList.add("is-dragging");
                    stepsListEl.classList.add("is-reordering");
                }
                if (ev.cancelable) ev.preventDefault();
                clearDropIndicators();

                let targetPos = allRows.length;
                for (let rIdx = 0; rIdx < allRows.length; rIdx++) {
                    const rect = allRows[rIdx].getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    if (ev.clientY < midY) {
                        targetPos = rIdx;
                        break;
                    }
                }
                dropIdx = targetPos;
                if (targetPos < allRows.length) {
                    if (targetPos !== fromIdx && targetPos !== fromIdx + 1) {
                        allRows[targetPos].classList.add("rot-drop-before");
                    }
                } else if (allRows.length > 0 && fromIdx !== allRows.length - 1) {
                    allRows[allRows.length - 1].classList.add("rot-drop-after");
                }
            };

            const onEnd = () => {
                document.removeEventListener("pointermove", onMove);
                document.removeEventListener("pointerup", onEnd);
                document.removeEventListener("pointercancel", onEnd);
                rowEl.classList.remove("is-dragging");
                stepsListEl.classList.remove("is-reordering");
                clearDropIndicators();

                if (dragging && dropIdx !== fromIdx && dropIdx !== fromIdx + 1) {
                    const [moved] = state.rotationSteps.splice(fromIdx, 1);
                    const adjusted = dropIdx > fromIdx ? dropIdx - 1 : dropIdx;
                    state.rotationSteps.splice(adjusted, 0, moved);
                    persistRotationState();
                    ui.renderSimulation();
                }
            };

            document.addEventListener("pointermove", onMove, { passive: false });
            document.addEventListener("pointerup", onEnd);
            document.addEventListener("pointercancel", onEnd);
        };

        stepsListEl.querySelectorAll(".rot-step-row").forEach((rowEl) => {
            const fromIdx = parseInt(rowEl.dataset.rotIdx, 10);
            const handle = rowEl.querySelector(".rot-drag-handle");
            if (handle) {
                handle.addEventListener("pointerdown", (e) => {
                    e.preventDefault();
                    startStepDrag(e, rowEl, fromIdx);
                });
            }
            const mainHdr = rowEl.querySelector(".rot-step-main");
            if (mainHdr) {
                mainHdr.addEventListener("pointerdown", (e) => {
                    if (e.pointerType !== "mouse") return;
                    if (e.target.closest("button, input, select, label, a, .rot-drag-handle")) return;
                    startStepDrag(e, rowEl, fromIdx);
                });
            }
        });
    }
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
            const hay = `${s.name} ${s.skillset} ${s.variant || ""} ${s.damageType || ""} ${s.kind || ""} ${s.utilityRole || ""} ${s.utilitySummary || ""} ${s.equipSource || ""} ${s.description || ""}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    };

    const allFiltered = state.allSkills.filter(matchesFilter);
    const treeLabelByKey = new Map(
        state.skillsetsMeta.map((t) => [t.skillset, t.label || (t.skillset === "equipment" ? "Equip Effects" : cap(t.skillset))])
    );
    treeBar.innerHTML = [
        `<button type="button" class="pill ${state.rotPickerTree === "all" ? "active" : ""}" data-rp-tree="all">All <span class="pill-count">${allFiltered.length}</span></button>`,
        ...state.skillsetsMeta.map((t) => {
            const k = t.skillset;
            const cnt = (state.skillsByTree[k] || []).filter(matchesFilter).length;
            const lbl = treeLabelByKey.get(k) || cap(k);
            const eqCls = k === "equipment" ? " pill-equip" : "";
            return `<button type="button" class="pill${eqCls} ${state.rotPickerTree === k ? "active" : ""}" data-rp-tree="${escHtml(k)}">${escHtml(lbl)} <span class="pill-count">${cnt}</span></button>`;
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
            let list = (state.skillsByTree[treeKey] || []).filter(matchesFilter);
            if (list.length === 0) return "";
            if (treeKey === "equipment") {
                list = list.slice().sort((a, b) => {
                    const aEq = (isEquipSkillActiveOnChar(a, state.buildA) ? 2 : 0) + (isEquipSkillActiveOnChar(a, state.buildB) ? 1 : 0);
                    const bEq = (isEquipSkillActiveOnChar(b, state.buildA) ? 2 : 0) + (isEquipSkillActiveOnChar(b, state.buildB) ? 1 : 0);
                    return bEq - aEq;
                });
            }
            const hdrLabel = treeLabelByKey.get(treeKey) || cap(treeKey);
            return `
            <div class="rot-picker-tree-sec">
                <div class="rot-picker-tree-hdr">${escHtml(hdrLabel)} (${list.length})</div>
                <div class="rot-picker-grid">
                    ${list
                        .map((s) => {
                            const skIcon = skillIconUrl(s);
                            const isUtil = s.kind === "utility";
                            const isHeal = s.kind === "heal";
                            const isEquip = s.skillset === "equipment";
                            const utilMeta = isUtil ? getUtilityRoleBadge(s) : null;
                            const typeCls = isUtil
                                ? utilMeta.cls
                                : isHeal
                                  ? "stag-heal"
                                  : s.damageType === "magic"
                                    ? "stag-magic"
                                    : "stag-phys";
                            const typeTxt = isUtil
                                ? utilMeta.label
                                : isHeal
                                  ? "HEAL"
                                  : s.damageType === "magic"
                                    ? "MAGIC"
                                    : "PHYS";
                            const varBadge =
                                s.variant && s.variant !== "base"
                                    ? `<span class="stag ${s.variant === "hollow" ? "stag-hollow" : "stag-var"}">${escHtml(cap(s.variant))}</span>`
                                    : "";
                            const eqOnA = isEquip && isEquipSkillActiveOnChar(s, state.buildA);
                            const eqOnB = isEquip && isEquipSkillActiveOnChar(s, state.buildB);
                            const equippedBadge =
                                eqOnA || eqOnB
                                    ? `<span class="stag stag-equipped-hit" title="Currently equipped on ${eqOnA && eqOnB ? "Build A & Build B" : eqOnA ? "Build A" : "Build B"}">&#10003; Equipped (${eqOnA && eqOnB ? "A+B" : eqOnA ? "A" : "B"})</span>`
                                    : "";
                            const castStr = s.castTimeSec > 0 ? `${s.castTimeSec}s cast` : "Instant";
                            const cdStr = s.cooldownSec > 0 ? `${s.cooldownSec}s CD` : "No CD";
                            const nextStagePreview = getNextAutoStagePreview(s, state.rotationSteps);
                            const stageCardBadge = nextStagePreview
                                ? `<span class="stag stag-stage">Next: ${escHtml(nextStagePreview.stage.label)} (${nextStagePreview.index + 1}/${nextStagePreview.count})</span>`
                                : "";
                            return `
                            <button type="button" class="rot-picker-card ${isEquip ? "rot-picker-card-equip" : isUtil ? "rot-picker-card-util" : ""}" data-rp-add="${escHtml(s.id)}" title="${escHtml(s.description || s.name)}">
                                ${skIcon ? `<img class="rot-picker-card-icon" src="${escHtml(skIcon)}" alt="" loading="lazy" />` : ""}
                                <div class="rot-picker-card-info">
                                    <div class="rot-picker-card-top">
                                        <span class="rot-picker-card-name">${escHtml(s.name)}</span>
                                    </div>
                                    <div class="rot-picker-card-tags">
                                        <span class="stag ${typeCls}">${typeTxt}</span>
                                        ${equippedBadge}
                                        ${varBadge}
                                        ${stageCardBadge}
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
            const nextPreview = getNextAutoStagePreview(sk, state.rotationSteps);
            state.rotationSteps.push(createRotationStepForSkill(sk));
            persistRotationState();
            ui.renderSimulation();
            renderRotSkillPicker();
            const stageSuffix = nextPreview
                ? ` (${nextPreview.stage.label} — ${nextPreview.index + 1}/${nextPreview.count})`
                : "";
            showToast(`Added #${state.rotationSteps.length} ${sk.name}${stageSuffix}`, "ok");
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
    const qStageCursor = new Map();
    const qCounts = new Map();
    for (const st of state.rotationSteps) {
        qCounts.set(st.skillId, (qCounts.get(st.skillId) || 0) + 1);
    }
    queueEl.innerHTML = `<span class="buff-presets-lbl">Queue (${state.rotationSteps.length}):</span>${state.rotationSteps
        .map((st, idx) => {
            const sk = skillById.get(st.skillId);
            let stageTag = "";
            if (sk) {
                const stages = getSkillStages(sk);
                if (stages.length > 1) {
                    if (st.stageIndex === "auto" || (st.stageIndex == null && STAGED_WEAVE_SKILL_IDS.has(sk.id) && (qCounts.get(sk.id) || 0) > 1)) {
                        const c = qStageCursor.get(sk.id) || 0;
                        stageTag = ` #${c + 1}`;
                        qStageCursor.set(sk.id, (c + 1) % stages.length);
                    } else if (st.stageIndex !== "all" && st.stageIndex != null && Number.isFinite(Number(st.stageIndex))) {
                        const n = Math.max(0, Math.min(stages.length - 1, Math.floor(Number(st.stageIndex))));
                        stageTag = ` #${n + 1}`;
                        qStageCursor.set(sk.id, (n + 1) % stages.length);
                    }
                }
            }
            return `<span class="rot-picker-q-chip">${idx + 1}. ${escHtml(sk ? sk.name : st.skillId)}${stageTag}</span>`;
        })
        .join("")}`;
}
