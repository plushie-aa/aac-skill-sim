/**
 * Skill Browser, Rank Selector / Inline Rank Editor, and Target Combo Debuff Bar.
 */

import {
    TARGET_COMBO_STATUSES,
    getSkillComboOptions,
    getSkillRanks,
    resolveSkillRank,
} from "../engine/index.js";
import {
    cap,
    escHtml,
    formatFormulaShort,
    formatSkillCastBadge,
    formatSkillComboBadge,
    formatSkillGcdBadge,
    formatSkillMetaShort,
    getActiveSkillObject,
    getEffectiveSkill,
    getMatchingSkills,
    getModePool,
    saveCustomRanksToStorage,
    skillIconUrl,
    state,
    ui,
} from "./state.js";

function getSkillTypeBadge(skill, longPhysical = false) {
    if (skill.kind === "utility") return { cls: "stag-util", label: "Utility" };
    if (skill.kind === "heal") return { cls: "stag-heal", label: "Heal" };
    if (skill.damageType === "magic") return { cls: "stag-magic", label: "Magic" };
    return { cls: "stag-phys", label: longPhysical ? "Physical" : "Phys" };
}

function shouldHideSkillContextBars() {
    return (
        state.mode === "rotation" ||
        state.mode === "gearbuilder" ||
        state.mode === "skillbuilder" ||
        state.mode === "economy" ||
        (state.mode === "sweep" && state.sweepMode === "defender_ehp") ||
        (state.mode === "matrix" &&
            (state.matrixViewScope === "all_vs_all"
                ? state.matrixAllMetric !== "selected_skill"
                : state.matrixMode === "offense_rotation" || state.matrixMode === "defense_ehp"))
    );
}

export function syncSweepStatToSkill(skill) {
    if (state.mode !== "sweep" || !skill) return;
    const statSel = document.getElementById("sweepStat");
    if (statSel && (statSel.value === "physicalDefense" || statSel.value === "magicDefense")) {
        statSel.value = skill.damageType === "magic" ? "magicDefense" : "physicalDefense";
    }
}

export function loadSkillIntoCustomEditor(skill) {
    if (!skill) return;
    const reqRank = state.skillRanks[skill.id] ?? state.globalRankMode;
    const { skill: resolved, selectedRankLabel } = resolveSkillRank(skill, reqRank);

    document.getElementById("customSkillName").value = `${resolved.name} (${selectedRankLabel} Custom)`;

    let kindVal = "physical_melee";
    if (resolved.kind === "heal") kindVal = "heal";
    else if (resolved.damageType === "magic" && resolved.scalingStat === "healingPower") kindVal = "magic_heal";
    else if (resolved.damageType === "magic") kindVal = "magic_spell";
    else if (resolved.scalingStat === "rangedAttack") kindVal = "physical_ranged";
    document.getElementById("customSkillKind").value = kindVal;

    if (Array.isArray(resolved.hits) && resolved.hits.length > 0) {
        const avgBase = resolved.hits.reduce((s, h) => s + (Number(h.base) || 0), 0) / resolved.hits.length;
        const avgPct = resolved.hits.reduce((s, h) => s + (Number(h.scalingPct) || 0), 0) / resolved.hits.length;
        document.getElementById("customSkillBase").value = Math.round(avgBase);
        document.getElementById("customSkillPct").value = Math.round(avgPct * 10) / 10;
        document.getElementById("customSkillHits").value = resolved.hits.length;
    } else {
        document.getElementById("customSkillBase").value = Number(resolved.base) || 0;
        document.getElementById("customSkillPct").value = Number(resolved.scalingPct) || 0;
        document.getElementById("customSkillHits").value = Math.max(1, Number(resolved.repeatCount) || 1);
    }

    document.getElementById("customSkillUnavoidable").checked = Boolean(resolved.flags?.unavoidable);
    state.isCustomSkill = true;
    renderSkillBrowser();
    ui.renderSimulation();
}

function renderSkillCardHtml(skill, activeSkill, showTreeTag) {
    const isAct = activeSkill && skill.id === activeSkill.id;
    const reqRank = state.skillRanks[skill.id] ?? state.globalRankMode;
    const resolved = resolveSkillRank(skill, reqRank);
    const { cls: typeCls, label: typeTxt } = getSkillTypeBadge(skill, false);
    const rankBadge =
        resolved.availableRanks > 1
            ? `<span class="stag stag-rank">R${resolved.selectedRank}/${resolved.availableRanks}</span>`
            : "";
    const varBadge =
        skill.variant && skill.variant !== "base"
            ? `<span class="stag ${skill.variant === "hollow" ? "stag-hollow" : "stag-var"}">${escHtml(skill.variant)}</span>`
            : "";
    const treeBadge = showTreeTag
        ? `<span class="stag stag-tree">${escHtml(skill.skillset)}</span>`
        : "";
    const metaLine = formatSkillMetaShort(skill);
    const skIcon = skillIconUrl(skill);

    return `
    <button type="button" class="skill-card ${isAct ? "active" : ""}" data-skill-id="${escHtml(skill.id)}">
        <div class="skill-card-top">
            <span class="skill-card-title-wrap">
                ${skIcon ? `<img class="skill-card-icon" src="${escHtml(skIcon)}" alt="" loading="lazy" />` : ""}
                <span class="skill-card-name">${escHtml(skill.name)}</span>
            </span>
            <span class="stag ${typeCls}">${typeTxt}</span>
        </div>
        <div class="skill-card-tags">
            ${treeBadge}${varBadge}${rankBadge}${formatSkillCastBadge(skill)}${formatSkillGcdBadge(skill)}${formatSkillComboBadge(skill)}
        </div>
        <div class="skill-card-formula">${escHtml(formatFormulaShort(skill, resolved.rankSpec))}</div>
        ${metaLine ? `<div class="skill-card-meta-line">${escHtml(metaLine)}</div>` : ""}
    </button>`;
}

export function renderSkillBrowser() {
    const browserEl = document.getElementById("skillBrowser");
    if (browserEl) {
        const hideSkillBrowser = shouldHideSkillContextBars();
        browserEl.classList.toggle("hidden", hideSkillBrowser);
        const shouldCollapsePicker =
            Boolean(state.skillPickerCollapsed) &&
            !state.isCustomSkill &&
            !state.searchQuery.trim() &&
            state.scope !== "all";
        browserEl.classList.toggle("picker-collapsed", shouldCollapsePicker);
        if (hideSkillBrowser) return;
    }

    const modePool = getModePool();
    const variantPool =
        state.selectedVariant === "all"
            ? modePool
            : modePool.filter((s) => (s.variant || "base") === state.selectedVariant);

    const availableTrees = state.skillsetsMeta.filter((m) =>
        modePool.some((s) => s.skillset === m.skillset)
    );
    if (
        state.selectedTree !== "all" &&
        !availableTrees.some((t) => t.skillset === state.selectedTree)
    ) {
        state.selectedTree = "all";
    }

    // 1. Skillset Pill Bar
    const pillsEl = document.getElementById("skillsetPills");
    const treeButtons = [
        `<button type="button" class="tree-pill ${!state.isCustomSkill && state.selectedTree === "all" ? "active" : ""}" data-tree="all">All <span class="pill-count">${variantPool.length}</span></button>`,
        ...availableTrees.map((t) => {
            const cnt = variantPool.filter((s) => s.skillset === t.skillset).length;
            const isAct = !state.isCustomSkill && state.selectedTree === t.skillset;
            const lvBadge =
                t.isMaxLevel === false && t.skillsetLevel
                    ? ` <span class="pill-lv-warn" title="Dumped at Skillset Lv ${t.skillsetLevel} (not yet Lv 55 max rank)">Lv${t.skillsetLevel}</span>`
                    : "";
            return `<button type="button" class="tree-pill ${isAct ? "active" : ""}" data-tree="${t.skillset}">${cap(t.skillset)}${lvBadge} <span class="pill-count">${cnt}</span></button>`;
        }),
        `<button type="button" class="tree-pill custom-pill ${state.isCustomSkill ? "active" : ""}" data-tree="__custom__">+ Custom</button>`,
    ];
    pillsEl.innerHTML = treeButtons.join("");

    pillsEl.querySelectorAll(".tree-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
            const tree = btn.dataset.tree;
            if (tree === "__custom__") {
                state.isCustomSkill = true;
            } else {
                state.isCustomSkill = false;
                state.selectedTree = tree;
                if (state.searchQuery) {
                    state.searchQuery = "";
                    document.getElementById("skillSearch").value = "";
                    document.getElementById("clearSearchBtn").classList.add("hidden");
                }
            }
            renderSkillBrowser();
            ui.renderSimulation();
        });
    });

    // 2. Variant & Scope Segmented Controls
    document.querySelectorAll("#variantPills .seg-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.variant === state.selectedVariant);
    });

    const matching = getMatchingSkills();
    const scopeGroup = document.getElementById("scopePills");
    scopeGroup.classList.toggle(
        "hidden",
        state.mode === "sweep" || state.mode === "rotation" || state.isCustomSkill
    );
    document.getElementById("compareAllScopeBtn").textContent = `Compare All (${matching.length})`;
    document.querySelectorAll("#scopePills .seg-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.scope === state.scope);
    });

    // Toggle Custom Panel vs Cards + Rank Bar
    document.getElementById("customSkillBar").classList.toggle("hidden", !state.isCustomSkill);
    document.getElementById("skillCardsWrap").classList.toggle("hidden", state.isCustomSkill);
    document.getElementById("rankBar").classList.toggle("hidden", state.isCustomSkill);

    if (state.isCustomSkill) return;

    // 3. Visual Skill Cards Grid
    const activeSkill = getActiveSkillObject(matching);
    const showTreeTag = state.selectedTree === "all" || state.searchQuery.trim().length > 0;
    const gridEl = document.getElementById("skillCardsGrid");

    if (matching.length === 0) {
        gridEl.innerHTML = `<div class="hint-inline" style="padding:8px 4px;grid-column:1/-1">No skills match your search or variant filter. Try switching Variant to <strong>All</strong> or clearing the search box.</div>`;
    } else {
        gridEl.innerHTML = matching.map((s) => renderSkillCardHtml(s, activeSkill, showTreeTag)).join("");
        gridEl.querySelectorAll(".skill-card").forEach((card) => {
            card.addEventListener("click", () => {
                if (state.selectedSkillId !== card.dataset.skillId) {
                    state.rankEditorOpen = false;
                }
                state.selectedSkillId = card.dataset.skillId;
                const chosen = getEffectiveSkill(state.allSkills.find((x) => x.id === state.selectedSkillId));
                syncSweepStatToSkill(chosen);
                renderSkillBrowser();
                ui.renderSimulation();
            });
        });
    }

    // 4. Dedicated Skill Rank Selector Bar
    renderRankBar(activeSkill);
}

function renderRankEditorHtml(skill, activeRankSpec, suggestedRankNum, isMultiHit) {
    const initBase = isMultiHit
        ? Math.round(activeRankSpec.hits.reduce((s, h) => s + (Number(h.base) || 0), 0))
        : Number(activeRankSpec?.base ?? skill.base ?? 0);
    const initPct = isMultiHit
        ? Math.round(activeRankSpec.hits.reduce((s, h) => s + (Number(h.scalingPct) || 0), 0) * 10) / 10
        : Number(activeRankSpec?.scalingPct ?? skill.scalingPct ?? 0);
    const initCritDmg = activeRankSpec?.flags?.critDamageBonusPct ?? skill.flags?.critDamageBonusPct ?? "";
    const initBackstabCrit = activeRankSpec?.flags?.backstabCritRateBonusPct ?? skill.flags?.backstabCritRateBonusPct ?? "";
    const initLabel = activeRankSpec?.label || `Rank ${suggestedRankNum}`;

    return `
        <div class="rank-editor" id="inlineRankEditor">
            <div class="rank-editor-fields">
                <div class="control-item">
                    <label for="reRankNum">Rank #</label>
                    <input type="number" id="reRankNum" min="1" max="20" value="${suggestedRankNum}" style="width:58px" />
                </div>
                <div class="control-item">
                    <label for="reLabel">Label</label>
                    <input type="text" id="reLabel" value="${escHtml(initLabel)}" style="width:140px" />
                </div>
                <div class="control-item">
                    <label for="reBase">Base</label>
                    <input type="number" id="reBase" step="any" value="${initBase}" style="width:82px" />
                </div>
                <div class="control-item">
                    <label for="rePct">Scaling %</label>
                    <input type="number" id="rePct" step="any" value="${initPct}" style="width:82px" />
                </div>
                ${
                    skill.kind !== "heal"
                        ? `
                <div class="control-item">
                    <label for="reCritDmg">Crit Dmg +%</label>
                    <input type="number" id="reCritDmg" step="1" placeholder="auto" value="${initCritDmg}" style="width:66px" />
                </div>
                <div class="control-item">
                    <label for="reBackstabCrit">Backstab Crit +%</label>
                    <input type="number" id="reBackstabCrit" step="1" placeholder="auto" value="${initBackstabCrit}" style="width:66px" />
                </div>`
                        : ""
                }
            </div>
            <div class="rank-editor-actions">
                <span class="rank-hint" id="reHint">
                    ${
                        Array.isArray(skill.rankCritHints) && skill.rankCritHints.length > 0
                            ? `AA Classic has ${skill.rankCritHints.length} documented crit-bonus ranks for ${escHtml(skill.name)} &mdash; change Rank # to auto-fill its Crit Dmg / Backstab Crit %.`
                            : `Enter exact tooltip numbers from in-game; saved in your browser (localStorage) for all 4 modes.`
                    }
                </span>
                <div class="rank-bar-actions">
                    ${
                        activeRankSpec?.isUserRank
                            ? `<button type="button" class="sm danger" id="reDeleteBtn">Delete Rank ${activeRankSpec.rank}</button>`
                            : ""
                    }
                    <button type="button" class="sm" id="reCancelBtn">Cancel</button>
                    <button type="button" class="sm primary" id="reSaveBtn">Save Rank</button>
                </div>
            </div>
        </div>`;
}

function bindRankEditorEvents(skill, activeRankSpec) {
    const rankNumInp = document.getElementById("reRankNum");
    const labelInp = document.getElementById("reLabel");
    const critDmgInp = document.getElementById("reCritDmg");
    const bsCritInp = document.getElementById("reBackstabCrit");
    const hintEl = document.getElementById("reHint");

    rankNumInp.addEventListener("input", () => {
        const rn = parseInt(rankNumInp.value, 10);
        if (!Number.isFinite(rn) || rn < 1) return;
        labelInp.value = `Rank ${rn}`;
        if (Array.isArray(skill.rankCritHints)) {
            const hint = skill.rankCritHints.find((h) => Number(h.rank) === rn);
            if (hint) {
                if (critDmgInp && hint.critDamageBonusPct != null) critDmgInp.value = hint.critDamageBonusPct;
                if (bsCritInp && hint.backstabCritRateBonusPct != null) bsCritInp.value = hint.backstabCritRateBonusPct;
                if (hintEl) {
                    hintEl.textContent = `AA Classic Rank ${rn} crit bonus auto-filled: +${hint.critDamageBonusPct ?? 0}% Crit Dmg${hint.backstabCritRateBonusPct != null ? `, +${hint.backstabCritRateBonusPct}% Backstab Crit` : ""}.`;
                }
            }
        }
    });

    document.getElementById("reCancelBtn").addEventListener("click", () => {
        state.rankEditorOpen = false;
        renderRankBar(skill);
    });

    const delBtn = document.getElementById("reDeleteBtn");
    if (delBtn && activeRankSpec?.isUserRank) {
        delBtn.addEventListener("click", () => {
            const list = (state.customRanks[skill.id] || []).filter(
                (r) => Number(r.rank) !== Number(activeRankSpec.rank)
            );
            if (list.length > 0) state.customRanks[skill.id] = list;
            else delete state.customRanks[skill.id];
            delete state.skillRanks[skill.id];
            saveCustomRanksToStorage(state.customRanks);
            state.rankEditorOpen = false;
            renderSkillBrowser();
            ui.renderSimulation();
        });
    }

    document.getElementById("reSaveBtn").addEventListener("click", () => {
        const rn = Math.max(1, parseInt(rankNumInp.value, 10) || 1);
        const lbl = labelInp.value.trim() || `Rank ${rn}`;
        const baseVal = parseFloat(document.getElementById("reBase").value) || 0;
        const pctVal = parseFloat(document.getElementById("rePct").value) || 0;
        const flagsOverride = {};
        if (critDmgInp && critDmgInp.value !== "") {
            flagsOverride.critDamageBonusPct = parseFloat(critDmgInp.value) || 0;
        }
        if (bsCritInp && bsCritInp.value !== "") {
            flagsOverride.backstabCritRateBonusPct = parseFloat(bsCritInp.value) || 0;
        }

        const newRank = {
            rank: rn,
            label: lbl,
            base: baseVal,
            scalingPct: pctVal,
            description: `User-saved ${lbl}: ${baseVal} + ${pctVal}% ${skill.scalingStat}.`,
            isUserRank: true,
        };
        if (Object.keys(flagsOverride).length > 0) {
            newRank.flags = flagsOverride;
        }

        const existing = (state.customRanks[skill.id] || []).filter((r) => Number(r.rank) !== rn);
        existing.push(newRank);
        existing.sort((a, b) => Number(a.rank) - Number(b.rank));
        state.customRanks[skill.id] = existing;
        state.skillRanks[skill.id] = rn;
        saveCustomRanksToStorage(state.customRanks);
        state.rankEditorOpen = false;
        renderSkillBrowser();
        ui.renderSimulation();
    });
}

export function renderRankBar(skill) {
    const bar = document.getElementById("rankBar");
    if (!skill) {
        bar.innerHTML = `<div class="hint-inline">Select a skill above to configure its rank.</div>`;
        return;
    }

    const ranks = getSkillRanks(skill);
    const reqRank = state.skillRanks[skill.id] ?? state.globalRankMode;
    const resolved = resolveSkillRank(skill, reqRank);
    const activeRankSpec = resolved.rankSpec || ranks[ranks.length - 1];
    const { cls: typeCls, label: typeTxt } = getSkillTypeBadge(skill, true);
    const metaLine = formatSkillMetaShort(skill);
    const hasUserRanks = Array.isArray(state.customRanks[skill.id]) && state.customRanks[skill.id].length > 0;
    const isMultiHit = Array.isArray(activeRankSpec?.hits) && activeRankSpec.hits.length > 0;
    const showGlobalRankToggle = state.scope === "all" && state.mode !== "sweep";
    const suggestedRankNum = activeRankSpec ? Number(activeRankSpec.rank) : ranks.length + 1;

    const editorHtml = state.rankEditorOpen
        ? renderRankEditorHtml(skill, activeRankSpec, suggestedRankNum, isMultiHit)
        : "";

    const rankSkIcon = skillIconUrl(skill);
    bar.innerHTML = `
        <div class="rank-bar-header">
            <div class="rank-bar-title">
                ${rankSkIcon ? `<img class="rank-skill-icon" src="${escHtml(rankSkIcon)}" alt="" loading="lazy" />` : ""}
                <strong>${escHtml(skill.name)}</strong>
                <span class="stag stag-tree">${escHtml(skill.skillset)}</span>
                <span class="stag ${typeCls}">${typeTxt}</span>
                ${skill.variant && skill.variant !== "base" ? `<span class="stag ${skill.variant === "hollow" ? "stag-hollow" : "stag-var"}">${escHtml(skill.variant)}</span>` : ""}
                ${formatSkillCastBadge(skill)}
                ${formatSkillGcdBadge(skill)}
                ${formatSkillComboBadge(skill)}
                ${metaLine ? `<span class="hint-inline">&bull; ${escHtml(metaLine)}</span>` : ""}
                <span class="hint-inline">&bull; ${escHtml(formatFormulaShort(skill, resolved.rankSpec))}</span>
            </div>
            <div class="rank-bar-actions">
                ${
                    state.scope !== "all"
                        ? `<button type="button" class="sm ${state.skillPickerCollapsed ? "primary" : ""}" id="toggleSkillPickerBtn" title="Collapse or expand the skill picker grid above">${state.skillPickerCollapsed ? "Change Skill &#9662;" : "Hide Skills &#9652;"}</button>`
                        : ""
                }
                ${
                    showGlobalRankToggle
                        ? `<div class="seg-group" title="Set default rank for all skills">
                               <button type="button" class="seg-btn ${state.globalRankMode === "min" ? "active" : ""}" data-global-rank="min">All: Rank 1</button>
                               <button type="button" class="seg-btn ${state.globalRankMode === "max" ? "active" : ""}" data-global-rank="max">All: Max</button>
                           </div>`
                        : ""
                }
                <button type="button" class="sm ${state.rankEditorOpen ? "primary" : ""}" id="toggleRankEditorBtn">+ Add / Edit Rank</button>
                ${hasUserRanks ? `<button type="button" class="sm danger" id="resetSkillRanksBtn" title="Remove user-saved ranks for this skill">Reset Ranks</button>` : ""}
                <button type="button" class="sm" id="customizeSkillBtn" title="Copy this skill into the standalone Custom Formula editor">Customize Formula</button>
            </div>
        </div>
        <div class="rank-pills-row">
            <span class="rank-label">Skill Rank:</span>
            <div class="pill-bar">
                ${ranks
                    .map((r, idx) => {
                        const isMax = idx === ranks.length - 1 && ranks.length > 1;
                        const isAct = Number(r.rank) === resolved.selectedRank;
                        const label = r.label || (isMax ? `Rank ${r.rank} (Max)` : `Rank ${r.rank}`);
                        return `
                        <button type="button" class="rank-pill ${isAct ? "active" : ""} ${r.isUserRank ? "user-rank" : ""}" data-rank="${r.rank}" title="${r.isUserRank ? "Saved custom rank (localStorage)" : "Parsed from live AA Classic client"}">
                            <span>${escHtml(label)}</span>
                            <span class="rank-formula">${escHtml(formatFormulaShort(skill, r))}</span>
                        </button>`;
                    })
                    .join("")}
            </div>
            ${
                ranks.length === 1 && !state.rankEditorOpen
                    ? `<span class="rank-hint">Click <strong>+ Add / Edit Rank</strong> to add any rank's live tooltip values (saved automatically).</span>`
                    : ""
            }
        </div>
        ${editorHtml}
    `;

    bar.querySelectorAll(".rank-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.skillRanks[skill.id] = Number(btn.dataset.rank);
            renderSkillBrowser();
            ui.renderSimulation();
        });
    });

    document.getElementById("toggleSkillPickerBtn")?.addEventListener("click", () => {
        state.skillPickerCollapsed = !state.skillPickerCollapsed;
        renderSkillBrowser();
    });

    bar.querySelectorAll("[data-global-rank]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.globalRankMode = btn.dataset.globalRank;
            state.skillRanks = {};
            renderSkillBrowser();
            ui.renderSimulation();
        });
    });

    document.getElementById("toggleRankEditorBtn")?.addEventListener("click", () => {
        state.rankEditorOpen = !state.rankEditorOpen;
        renderRankBar(skill);
    });

    document.getElementById("resetSkillRanksBtn")?.addEventListener("click", () => {
        delete state.customRanks[skill.id];
        delete state.skillRanks[skill.id];
        saveCustomRanksToStorage(state.customRanks);
        state.rankEditorOpen = false;
        renderSkillBrowser();
        ui.renderSimulation();
    });

    document.getElementById("customizeSkillBtn")?.addEventListener("click", () => {
        loadSkillIntoCustomEditor(skill);
    });

    if (state.rankEditorOpen) {
        bindRankEditorEvents(skill, activeRankSpec);
    }
}

export function renderComboStatusBar() {
    const bar = document.getElementById("comboStatusBar");
    if (!bar) return;
    if (shouldHideSkillContextBars() || state.allSkills.length === 0) {
        bar.classList.add("hidden");
        return;
    }
    bar.classList.remove("hidden");

    const matching = getMatchingSkills();
    const activeSkill = getActiveSkillObject(matching);
    const skillCombos = activeSkill ? getSkillComboOptions(activeSkill) : [];
    const activeSet = state.targetComboStatuses || new Set();

    const ordered = [];
    const seen = new Set();
    for (const c of skillCombos) {
        const meta = TARGET_COMBO_STATUSES.find((s) => s.id === c.status);
        if (meta && !seen.has(meta.id)) {
            ordered.push({ meta, combo: c });
            seen.add(meta.id);
        }
    }
    for (const sid of activeSet) {
        if (seen.has(sid)) continue;
        const meta = TARGET_COMBO_STATUSES.find((s) => s.id === sid);
        if (meta) {
            ordered.push({ meta, combo: null });
            seen.add(meta.id);
        }
    }
    const showAll = Boolean(state.comboStatusesExpanded) || skillCombos.length === 0;
    if (showAll) {
        for (const meta of TARGET_COMBO_STATUSES) {
            if (seen.has(meta.id)) continue;
            if (state.mode === "healing" && meta.id !== "resurgence") continue;
            ordered.push({ meta, combo: null });
            seen.add(meta.id);
        }
    }

    const pillsHtml = ordered
        .map(({ meta, combo }) => {
            const isAct = activeSet.has(meta.id);
            const isRel = Boolean(combo);
            const bonusTxt = combo
                ? ` +${combo.comboBonusPct}%${activeSkill?.kind === "heal" ? " Heal" : ""}`
                : "";
            const ccTag = meta.isCC ? " · CC" : "";
            const tip = `${meta.label}${meta.source ? ` (${meta.source})` : ""}${combo ? ` — ${combo.label}` : ""}${meta.isCC ? " — also bypasses physical avoidance" : ""}`;
            return `<button type="button" class="combo-pill ${isRel ? "relevant" : ""} ${isAct ? "active" : ""}" data-combo-status="${escHtml(meta.id)}" title="${escHtml(tip)}">${isRel ? "&#9889; " : ""}${escHtml(meta.label)}${escHtml(bonusTxt)}${escHtml(ccTag)}</button>`;
        })
        .join("");

    const remainingCount = TARGET_COMBO_STATUSES.length - ordered.length;
    const expandBtnHtml =
        skillCombos.length > 0 && state.mode !== "healing"
            ? `<button type="button" class="sm" id="toggleAllComboStatusesBtn">${state.comboStatusesExpanded ? "Less &#9652;" : `All Debuffs (+${remainingCount}) &#9662;`}</button>`
            : "";
    const clearBtnHtml =
        activeSet.size > 0
            ? `<button type="button" class="sm" id="clearComboStatusesBtn">Clear (${activeSet.size})</button>`
            : "";

    bar.innerHTML = `
        <span class="combo-status-lbl" title="Toggle debuffs/statuses on the target to apply ArcheAge skill combo multipliers in Skill Breakdown, Healing, Sweep &amp; Defender modes">Target Combo Debuffs:</span>
        ${pillsHtml}
        ${expandBtnHtml}
        ${clearBtnHtml}
    `;

    bar.querySelectorAll("[data-combo-status]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const sid = btn.dataset.comboStatus;
            if (state.targetComboStatuses.has(sid)) state.targetComboStatuses.delete(sid);
            else state.targetComboStatuses.add(sid);
            ui.renderSimulation();
        });
    });
    document.getElementById("toggleAllComboStatusesBtn")?.addEventListener("click", () => {
        state.comboStatusesExpanded = !state.comboStatusesExpanded;
        renderComboStatusBar();
    });
    document.getElementById("clearComboStatusesBtn")?.addEventListener("click", () => {
        state.targetComboStatuses.clear();
        ui.renderSimulation();
    });
}
