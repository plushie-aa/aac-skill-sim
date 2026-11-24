/**
 * Interactive ArcheAge Classic 1.3.6 / 3.5 Skill Builder View:
 *  - 3-Skillset / 28-Point ArcheAge calculator with live 120-Class name resolution
 *  - Exact passive threshold unlocking (2/4/6/7/8/9/10 pts) & cascade deselection
 *  - Zero double-counting passive delta math (Baked on DaruGear vs +Added / -Removed / Combat / Proc)
 *  - Direct 1-click DaruGear URL / Share-Code / JSON skill import
 */

import {
    COMBAT_MODIFIERS,
    MAX_SKILL_POINTS,
    applyModifiers,
    applySkillBuildPassives,
    computeEffectiveStats,
    getSkillBuilderData,
    getTotalPointsSpent,
    getTreePointsSpent,
    isPassiveUnlocked,
    normalizeSkillBuild,
    resolveClassName,
    setAncestralVariant,
    setSkillBuildTree,
    toggleActiveSkill,
    toggleHatredTree,
    togglePassiveSkill,
} from "../engine/index.js";
import { fetchDaruGearSkillBuild } from "../adapters/darugear.js";
import {
    escHtml,
    fmtDec,
    fmtInt,
    getEffectiveDefenderDisableAvoidance,
    getSlotChar,
    getSlotModifiers,
    showToast,
    state,
    switchAppMode,
    ui,
} from "./state.js";

function ensureSlotSkillBuild(slot) {
    const ch = getSlotChar(slot);
    if (!ch.skillBuild) {
        ch.skillBuild = normalizeSkillBuild(null, ch);
    } else {
        ch.skillBuild = normalizeSkillBuild(ch.skillBuild, ch);
    }
    return ch.skillBuild;
}

function syncBuildClassMetadata(ch) {
    if (!ch?.skillBuild) return;
    const cls = resolveClassName(ch.skillBuild.trees);
    if (cls) {
        ch.className = cls;
        if (!ch.metadata || typeof ch.metadata !== "object") ch.metadata = {};
        ch.metadata.className = cls;
    }
    if (!ch.metadata || typeof ch.metadata !== "object") ch.metadata = {};
    ch.metadata.passives = [...(ch.skillBuild.passives || [])];
}

export function renderSkillBuilderView(out) {
    const sbData = getSkillBuilderData();
    if (!sbData || !sbData.trees) {
        out.innerHTML = `<p class="hint-inline">Loading ArcheAge Classic Skill Builder dataset...</p>`;
        return;
    }

    const slot = ["A", "B", "defender"].includes(state.skillBuilderSlot) ? state.skillBuilderSlot : "A";
    const ch = getSlotChar(slot);
    const sb = ensureSlotSkillBuild(slot);
    const totalPts = getTotalPointsSpent(sb);
    const className = resolveClassName(sb.trees) || sb.className || "Custom Class";
    const slotMods = getSlotModifiers(slot);
    const activeModIds = state.modifiers[slot] || new Set();

    const passiveEval = applySkillBuildPassives(
        { ...ch, _skillBuildApplied: false },
        slotMods
    );
    const sum = passiveEval.summary;

    // Live post-buff stats preview (comparing against opponent card)
    const oppSlot = slot === "defender" ? "A" : "defender";
    const effSelf = applyModifiers(ch, slotMods);
    const effOpp = applyModifiers(getSlotChar(oppSlot), getSlotModifiers(oppSlot));
    const isPvE = Boolean(document.getElementById("ctxPvE")?.checked);
    const disAvoid = getEffectiveDefenderDisableAvoidance();
    const effStats = computeEffectiveStats(effSelf, effOpp, {}, { isPvE, disableAvoidance: disAvoid });

    const existingCode = ch.shareCode || ch.metadata?.shareCode || "";
    const slotLabelMap = {
        A: `Build A (${ch.name})`,
        B: `Build B (${ch.name})`,
        defender: `Target / Def (${ch.name})`,
    };
    const bakedSet = new Set((sb.bakedPassives || []).map((p) => String(p).toLowerCase()));
    const selectedActSet = new Set(sb.activeSkills || []);
    const selectedPasSet = new Set((sb.passives || []).map((p) => String(p).toLowerCase()));

    const treeOrder = sbData.treeOrder || Object.keys(sbData.trees);

    const renderTreeCol = (treeSlug, colIdx) => {
        const tree = sbData.trees[treeSlug];
        if (!tree) return "";
        const treePts = getTreePointsSpent(sb, treeSlug);
        const isHatred = sb.hatredTree === treeSlug;

        const treeOpts = treeOrder
            .map((slug) => {
                const t = sbData.trees[slug];
                const inOtherSlot = sb.trees.includes(slug) && slug !== treeSlug;
                return `<option value="${escHtml(slug)}" ${slug === treeSlug ? "selected" : ""}>${escHtml(t.name)}${inOtherSlot ? " (swap)" : ""}</option>`;
            })
            .join("");

        const ancMap = sb.ancestralChoices || {};
        const activesHtml = (tree.actives || [])
            .map((sk) => {
                const isSel = selectedActSet.has(sk.key);
                const ancList = Array.isArray(sk.ancestrals) ? sk.ancestrals : [];
                const hasAnc = ancList.length > 0;
                const activeAncId = isSel ? ancMap[sk.key] || null : null;
                const activeAnc = activeAncId ? ancList.find((v) => v.id === activeAncId) : null;
                const displayIcon = (activeAnc && activeAnc.icon) ? activeAnc.icon : sk.icon;
                const tip = activeAnc
                    ? `${sk.name} (${activeAnc.element} Ancestral)\n${activeAnc.desc || sk.desc || ""}`
                    : `${sk.name} (Lv ${sk.level})${hasAnc ? ` • Ancestrals: ${ancList.map((v) => v.element).join(" / ")}` : ""}\n${sk.desc || ""}`;
                const initials = sk.name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((w) => w[0] || "")
                    .join("")
                    .toUpperCase();
                const ancCls = activeAnc ? `sb-anc-${activeAnc.id}` : "";
                const ancBadgeCorner = hasAnc && !isSel
                    ? `<span class="sb-anc-dot" title="Has Ancestral variants (${escHtml(ancList.map((v) => v.element).join(" / "))})">&#10022;</span>`
                    : activeAnc
                      ? `<span class="sb-anc-elem-tag sb-el-${escHtml(activeAnc.id)}">${escHtml(activeAnc.short || activeAnc.element.slice(0, 2))}</span>`
                      : "";
                const ancBarHtml =
                    hasAnc && isSel
                        ? `<div class="sb-anc-bar" role="group" aria-label="Ancestral variant for ${escHtml(sk.name)}">
                               <button type="button" class="sb-anc-pip ${!activeAnc ? "active" : ""}" data-sb-anc-set="base" data-sb-act="${escHtml(sk.key)}" data-sb-tree="${escHtml(treeSlug)}" title="Base ${escHtml(sk.name)}">B</button>
                               ${ancList
                                   .map(
                                       (v) =>
                                           `<button type="button" class="sb-anc-pip sb-el-${escHtml(v.id)} ${activeAncId === v.id ? "active" : ""}" data-sb-anc-set="${escHtml(v.id)}" data-sb-act="${escHtml(sk.key)}" data-sb-tree="${escHtml(treeSlug)}" title="${escHtml(sk.name)} (${escHtml(v.element)} Ancestral)\n${escHtml(v.desc || "")}">${escHtml(v.short || v.element.slice(0, 2))}</button>`
                                   )
                                   .join("")}
                           </div>`
                        : "";
                return `
                <div class="sb-skill-tile ${isSel ? "selected" : ""} ${ancCls}">
                    <button type="button" class="sb-skill-btn ${isSel ? "selected" : ""}" data-sb-act="${escHtml(sk.key)}" data-sb-tree="${escHtml(treeSlug)}" title="${escHtml(tip)}">
                        <span class="sb-icon-box">
                            ${
                                displayIcon
                                    ? `<img src="${escHtml(displayIcon)}" alt="" loading="lazy" data-img-fb="next" /><span class="sb-icon-fb" style="display:none">${escHtml(initials)}</span>`
                                    : `<span class="sb-icon-fb">${escHtml(initials)}</span>`
                            }
                            ${ancBadgeCorner}
                            <span class="sb-lv-tag">${sk.level}</span>
                        </span>
                        <span class="sb-skill-lbl">${escHtml(sk.name)}</span>
                    </button>
                    ${ancBarHtml}
                </div>`;
            })
            .join("");

        const passivesHtml = (tree.passives || [])
            .map((p) => {
                const isSel = selectedPasSet.has(p.name.toLowerCase()) || selectedPasSet.has(p.key.toLowerCase());
                const unlocked = isPassiveUnlocked(sb, treeSlug, p);
                const isBaked = bakedSet.has(p.name.toLowerCase());
                const isLocked = !isSel && !unlocked;

                let statusBadge = "";
                if (p.effectKind === "sheet") {
                    if (isSel && isBaked) {
                        statusBadge = `<span class="sb-tag sb-tag-baked" title="Already baked into DaruGear base stats (unchecking removes its stats)">Baked</span>`;
                    } else if (isSel && !isBaked) {
                        statusBadge = `<span class="sb-tag sb-tag-added" title="Added above base stats &mdash; live delta active!">+Delta</span>`;
                    } else if (!isSel && isBaked) {
                        statusBadge = `<span class="sb-tag sb-tag-removed" title="Was baked on DaruGear import &mdash; stats subtracted!">&minus;Removed</span>`;
                    }
                } else if (p.effectKind === "combat") {
                    statusBadge = `<span class="sb-tag sb-tag-combat" title="Always-on combat/CD passive applied directly in simulation">${isSel ? "Active" : "Combat"}</span>`;
                } else if (p.effectKind === "proc") {
                    const hasLinked = p.linkedBuffId && COMBAT_MODIFIERS[p.linkedBuffId];
                    const buffOn = hasLinked && activeModIds.has(p.linkedBuffId);
                    statusBadge = hasLinked
                        ? `<span class="sb-tag sb-tag-proc ${buffOn ? "is-on" : ""}" data-sb-toggle-buff="${escHtml(p.linkedBuffId)}" title="Click to toggle ${escHtml(COMBAT_MODIFIERS[p.linkedBuffId].name)} in Buffs">${buffOn ? "Buff ON" : "+Buff"}</span>`
                        : `<span class="sb-tag sb-tag-proc">Proc</span>`;
                }

                const initials = p.name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((w) => w[0] || "")
                    .join("")
                    .toUpperCase();
                const tip = `${p.name} (Requires ${p.reqPoints} pts in ${tree.name})\n${p.shortEffect ? `[${p.shortEffect}]\n` : ""}${p.desc || ""}`;

                return `
                <div class="sb-passive-row ${isSel ? "selected" : ""} ${isLocked ? "locked" : ""}" data-sb-pas="${escHtml(p.name)}" data-sb-tree="${escHtml(treeSlug)}" title="${escHtml(tip)}" role="button" tabindex="0">
                    <span class="sb-req-pill ${unlocked || isSel ? "unlocked" : ""}">${p.reqPoints}p</span>
                    <span class="sb-pas-icon">
                        ${
                            p.icon
                                ? `<img src="${escHtml(p.icon)}" alt="" loading="lazy" data-img-fb="next" /><span class="sb-icon-fb" style="display:none">${escHtml(initials)}</span>`
                                : `<span class="sb-icon-fb">${escHtml(initials)}</span>`
                        }
                    </span>
                    <div class="sb-pas-text">
                        <div class="sb-pas-name">${escHtml(p.name)}</div>
                        <div class="sb-pas-eff">${escHtml(p.shortEffect || p.desc.slice(0, 48))}</div>
                    </div>
                    <div class="sb-pas-status">${statusBadge}</div>
                </div>`;
            })
            .join("");

        return `
        <div class="sb-tree-col">
            <div class="sb-tree-hdr">
                <select class="sb-tree-sel" data-sb-tree-slot="${colIdx}" aria-label="Skillset ${colIdx + 1}">
                    ${treeOpts}
                </select>
                <span class="sb-tree-pts ${treePts >= 10 ? "is-high" : ""}">${treePts} pts</span>
                <button type="button" class="sm sb-hatred-btn ${isHatred ? "active" : ""}" data-sb-hatred="${escHtml(treeSlug)}" title="Toggle Abyssal / Hatred skillset (mutually exclusive across your 3 trees)">
                    ${isHatred ? "&#9733; Abyssal" : "Abyssal"}
                </button>
            </div>
            <div class="sb-section-lbl">Active Skills (12)</div>
            <div class="sb-actives-grid">${activesHtml}</div>
            <div class="sb-section-lbl">Passives (Unlock at 2 / 4 / 6 / 7 / 8 / 9 / 10 pts)</div>
            <div class="sb-passives-list">${passivesHtml}</div>
        </div>`;
    };

    const impactBadges = [];
    for (const m of sum.addedSheet) {
        impactBadges.push(`<span class="sb-impact-pill is-add">+ ${escHtml(m.name)}: ${escHtml(m.shortEffect)}</span>`);
    }
    for (const m of sum.removedSheet) {
        impactBadges.push(`<span class="sb-impact-pill is-rem">&minus; ${escHtml(m.name)}: ${escHtml(m.shortEffect)} (removed from base)</span>`);
    }
    for (const m of sum.combatPassives) {
        impactBadges.push(`<span class="sb-impact-pill is-combat">&#9876; ${escHtml(m.name)}: ${escHtml(m.shortEffect)}</span>`);
    }
    for (const [skKey, elemId] of Object.entries(sb.ancestralChoices || {})) {
        const slug = skKey.split("_")[0];
        const act = sbData.trees?.[slug]?.actives?.find((a) => a.key === skKey);
        const anc = act?.ancestrals?.find((v) => v.id === elemId);
        if (act && anc) {
            const jumpAttr = anc.simSkillId
                ? ` data-sb-jump-skill="${escHtml(anc.simSkillId)}" data-sb-jump-tree="${escHtml(slug)}" style="cursor:pointer" title="Click to inspect ${escHtml(act.name)} (${escHtml(anc.element)}) in Skill Breakdown"`
                : ` title="${escHtml(anc.desc || "")}"`;
            impactBadges.push(
                `<span class="sb-impact-pill is-anc sb-el-${escHtml(anc.id)}"${jumpAttr}>&#10022; ${escHtml(act.name)} (${escHtml(anc.element)})</span>`
            );
        }
    }

    const bakedCount = (sb.bakedPassives || []).length;

    out.innerHTML = `
        <div class="sb-toolbar">
            <div class="sb-toolbar-row">
                <div class="seg-group" id="sbSlotPills" title="Choose which character card's Skill Build to edit">
                    <button type="button" class="seg-btn ${slot === "A" ? "active" : ""}" data-sb-slot="A">Build A: ${escHtml(state.buildA.name)}</button>
                    <button type="button" class="seg-btn ${slot === "B" ? "active" : ""}" data-sb-slot="B">Build B: ${escHtml(state.buildB.name)}</button>
                    <button type="button" class="seg-btn ${slot === "defender" ? "active" : ""}" data-sb-slot="defender">Target: ${escHtml(state.defender.name)}</button>
                </div>
                <div class="sb-class-summary">
                    <span class="sb-class-badge">${escHtml(className)}</span>
                    <span class="sb-pts-badge ${totalPts >= MAX_SKILL_POINTS ? "is-max" : ""}">${totalPts} / ${MAX_SKILL_POINTS} pts</span>
                    ${slot === "A" ? `<button type="button" class="sm" id="sbCopyAtoBBtn" title="Copy Build A's skillsets, active skills, and passives into Build B">Copy Skills A &rarr; B</button>` : ""}
                    <button type="button" class="sm danger" id="sbClearPtsBtn" title="Clear all selected active skills and passives for this slot">Reset Points</button>
                </div>
            </div>
            <div class="sb-toolbar-row sb-import-row">
                <span class="sb-import-lbl">Import Skills from DaruGear:</span>
                <input type="text" id="sbDaruGearUrlInp" class="sb-dg-input" placeholder="Paste https://darugear.com/?s=XXXXXX, share code, or DaruGear JSON..." value="${escHtml(state.skillBuilderImportInput || "")}" />
                <button type="button" class="sm primary" id="sbImportDgBtn">Import Skills</button>
                ${
                    existingCode
                        ? `<button type="button" class="sm" id="sbSyncOwnDgBtn" data-dg-code="${escHtml(existingCode)}" title="Fetch exact selected skills &amp; passives from this build's DaruGear link (${escHtml(existingCode)})">&#8635; Pull ${escHtml(existingCode)}</button>`
                        : ""
                }
                <span class="hint-inline">
                    ${bakedCount > 0 ? `${bakedCount} sheet passive${bakedCount === 1 ? "" : "s"} baked in base stats (0 double-counting).` : "All selected sheet &amp; combat passives apply live."}
                </span>
            </div>
        </div>

        <div class="sb-impact-bar">
            <div class="sb-impact-header">
                <strong>Live Passive Effects on ${escHtml(slotLabelMap[slot])}</strong>
                <span class="sb-live-stats-inline">
                    <span>Melee: <strong>${fmtInt(effSelf.offense.meleeAttack)}</strong> (${fmtDec(effSelf.offense.meleeCritRatePct)}% CR)</span>
                    <span>Ranged: <strong>${fmtInt(effSelf.offense.rangedAttack)}</strong> (${fmtDec(effSelf.offense.rangedCritRatePct)}% CR)</span>
                    <span>Magic: <strong>${fmtInt(effSelf.offense.magicAttack)}</strong> (${fmtDec(effSelf.offense.magicCritRatePct)}% CR)</span>
                    <span>Cast: <strong>${fmtDec(effSelf.offense.castTimePct, 0)}%</strong></span>
                    <span>HP: <strong>${fmtInt(effSelf.maxHealth)}</strong></span>
                    <span>PDef / MDef: <strong>${fmtInt(effSelf.defense.physicalDefense)}</strong> / <strong>${fmtInt(effSelf.defense.magicDefense)}</strong></span>
                    <span>Melee EHP: <strong>${fmtInt(effStats.defense.ehp.melee.vsAttackerEhp)}</strong></span>
                </span>
            </div>
            <div class="sb-impact-pills">
                ${
                    impactBadges.length > 0
                        ? impactBadges.join("")
                        : `<span class="hint-inline">No passive deltas or always-on combat passives active yet &mdash; select active skills to unlock passives below (or import from DaruGear above).</span>`
                }
            </div>
        </div>

        <div class="sb-trees-grid">
            ${sb.trees.map((slug, idx) => renderTreeCol(slug, idx)).join("")}
        </div>
    `;

    // Bind Slot Switcher
    out.querySelectorAll("[data-sb-slot]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.skillBuilderSlot = btn.dataset.sbSlot;
            ui.renderSimulation();
        });
    });

    const commitSkillBuild = (nextSb, toastMsg = null) => {
        ch.skillBuild = normalizeSkillBuild(nextSb, ch);
        syncBuildClassMetadata(ch);
        ui.updateBuffedStatsPanel(slot);
        ui.renderCharacterCards();
        ui.renderSimulation();
        if (toastMsg) showToast(toastMsg, "ok");
    };

    // Bind Tree Dropdowns
    out.querySelectorAll("[data-sb-tree-slot]").forEach((sel) => {
        sel.addEventListener("change", () => {
            const idx = parseInt(sel.dataset.sbTreeSlot, 10);
            const nextSb = setSkillBuildTree(sb, idx, sel.value);
            commitSkillBuild(nextSb, `Updated ${ch.name} → ${resolveClassName(nextSb.trees) || "Custom"}`);
        });
    });

    // Bind Hatred Toggle
    out.querySelectorAll("[data-sb-hatred]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const nextSb = toggleHatredTree(sb, btn.dataset.sbHatred);
            commitSkillBuild(nextSb);
        });
    });

    // Bind Active Skill Clicks
    out.querySelectorAll(".sb-skill-btn[data-sb-act]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const res = toggleActiveSkill(sb, btn.dataset.sbTree, btn.dataset.sbAct);
            if (!res.changed) {
                if (res.reason) showToast(res.reason, "err");
                return;
            }
            commitSkillBuild(res.skillBuild);
        });
    });

    // Bind Ancestral Variant Selector Pips
    out.querySelectorAll("[data-sb-anc-set]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const res = setAncestralVariant(sb, btn.dataset.sbTree, btn.dataset.sbAct, btn.dataset.sbAncSet);
            if (!res.changed) {
                if (res.reason) showToast(res.reason, "err");
                return;
            }
            commitSkillBuild(res.skillBuild);
        });
    });

    // Click an Ancestral summary pill -> jump straight to that Ancestral skill in Skill Breakdown
    out.querySelectorAll("[data-sb-jump-skill]").forEach((pill) => {
        pill.addEventListener("click", () => {
            const sid = pill.dataset.sbJumpSkill;
            const tree = pill.dataset.sbJumpTree;
            if (!sid) return;
            state.isCustomSkill = false;
            state.selectedTree = tree || "all";
            state.selectedVariant = "ancestral";
            state.selectedSkillId = sid;
            switchAppMode("skills");
        });
    });

    // Bind Passive Clicks (plus linked proc buff toggle)
    out.querySelectorAll("[data-sb-pas]").forEach((row) => {
        const handleActivate = (e) => {
            const buffBtn = e.target.closest("[data-sb-toggle-buff]");
            if (buffBtn) {
                e.stopPropagation();
                const modId = buffBtn.dataset.sbToggleBuff;
                const set = state.modifiers[slot];
                if (set.has(modId)) set.delete(modId);
                else set.add(modId);
                ui.renderCharacterCards();
                ui.renderSimulation();
                showToast(
                    `${set.has(modId) ? "Enabled" : "Disabled"} ${COMBAT_MODIFIERS[modId]?.name || modId} on ${slotLabelMap[slot]}`,
                    "ok"
                );
                return;
            }
            const res = togglePassiveSkill(sb, row.dataset.sbTree, row.dataset.sbPas);
            if (!res.changed) {
                if (res.reason) showToast(res.reason, "err");
                return;
            }
            commitSkillBuild(res.skillBuild);
        };
        row.addEventListener("click", handleActivate);
        row.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleActivate(e);
            }
        });
    });

    // Copy A -> B
    document.getElementById("sbCopyAtoBBtn")?.addEventListener("click", () => {
        const bakedB = Array.isArray(state.buildB.skillBuild?.bakedPassives)
            ? [...state.buildB.skillBuild.bakedPassives]
            : normalizeSkillBuild(null, state.buildB).bakedPassives;
        state.buildB.skillBuild = normalizeSkillBuild(
            {
                trees: [...sb.trees],
                activeSkills: [...sb.activeSkills],
                passives: [...sb.passives],
                ancestralChoices: { ...(sb.ancestralChoices || {}) },
                hatredTree: sb.hatredTree,
                bakedPassives: bakedB,
            },
            state.buildB
        );
        syncBuildClassMetadata(state.buildB);
        ui.renderCharacterCards();
        ui.renderSimulation();
        showToast(`Copied ${className} skill build (${totalPts} pts) into Build B`, "ok");
    });

    // Clear Points
    document.getElementById("sbClearPtsBtn")?.addEventListener("click", () => {
        commitSkillBuild(
            {
                ...sb,
                activeSkills: [],
                passives: [],
                ancestralChoices: {},
                hatredTree: null,
            },
            `Cleared skill points for ${ch.name}`
        );
    });

    // DaruGear Skill Import (URL / Share Code / JSON)
    const runDaruGearImport = async (rawInput, isSameBuildSync = false) => {
        const importBtn = document.getElementById("sbImportDgBtn");
        const syncBtn = document.getElementById("sbSyncOwnDgBtn");
        if (importBtn) importBtn.disabled = true;
        if (syncBtn) syncBtn.disabled = true;
        try {
            const res = await fetchDaruGearSkillBuild(rawInput);
            if (!res.ok) {
                showToast(res.error || "Failed to import skills from DaruGear", "err");
                return;
            }
            // Keep this character's existing bakedPassives unless syncing the same DaruGear build
            const keepBaked = isSameBuildSync
                ? res.skillBuild.bakedPassives
                : Array.isArray(sb.bakedPassives)
                  ? [...sb.bakedPassives]
                  : [];
            const mergedSb = {
                ...res.skillBuild,
                bakedPassives: keepBaked,
            };
            const pts = getTotalPointsSpent(mergedSb);
            commitSkillBuild(
                mergedSb,
                `Imported ${res.className || "Skill Build"} (${pts} pts, ${mergedSb.passives.length} passives) from DaruGear${res.shareCode ? ` (${res.shareCode})` : ""}!`
            );
        } finally {
            if (importBtn) importBtn.disabled = false;
            if (syncBtn) syncBtn.disabled = false;
        }
    };

    const urlInp = document.getElementById("sbDaruGearUrlInp");
    urlInp?.addEventListener("input", () => {
        state.skillBuilderImportInput = urlInp.value;
    });
    document.getElementById("sbImportDgBtn")?.addEventListener("click", () => {
        const val = document.getElementById("sbDaruGearUrlInp")?.value || "";
        const sameCode = existingCode && val.includes(existingCode);
        runDaruGearImport(val, Boolean(sameCode));
    });
    document.getElementById("sbSyncOwnDgBtn")?.addEventListener("click", (e) => {
        const code = e.currentTarget.dataset.dgCode;
        if (code) runDaruGearImport(code, true);
    });
}
