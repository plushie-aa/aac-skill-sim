/**
 * Multi-Opponent Matchup Matrix View:
 *  1. All vs All (N×N Grid): Compares every selected build/class against every other build
 *     irrespective of Build A / Build B (1v1 Trade Ratio, Signature Skill % HP, Defender EHP, Selected Skill).
 *  2. Build A vs B (vs Roster): Compares Build A vs Build B against every selected opponent build.
 *
 * Both views share consistent, transparent Buff Preset controls (Auto-Match Saved Presets,
 * Uniform 3rd Card / Saved Preset / Base Stats, plus per-build overrides persisted in localStorage).
 */

import {
    computeAllVsAllMatrix,
    computeMatchupMatrix,
    inferBuildCategory,
    inspectArmorState,
} from "../engine/index.js";
import {
    buildCustomSkill,
    escHtml,
    fmtDec,
    fmtDeltaPct,
    fmtInt,
    getActiveSkillObject,
    getContext,
    getEffectiveDefenderDisableAvoidance,
    getMatchingSkills,
    getSlotChipTokens,
    getSlotModifiers,
    setSlotModifiersFromTokens,
    showToast,
    state,
    ui,
} from "./state.js";

function saveMatrixBuffPrefs() {
    try {
        localStorage.setItem("aac_damage_sim_matrix_buff_mode_v1", state.matrixBuffMode || "auto_preset");
        localStorage.setItem(
            "aac_damage_sim_matrix_opp_buffs_v1",
            JSON.stringify(state.matrixOppBuffOverrides || {})
        );
    } catch {
        // Ignore storage errors
    }
}

function extractBuildSavedTokensAndCons(buildObj) {
    const tokens = Array.isArray(buildObj?.modifiers) ? [...buildObj.modifiers] : [];
    const consumables =
        buildObj?.consumables && typeof buildObj.consumables === "object"
            ? { ...buildObj.consumables }
            : {};
    const modifiers = [...tokens, ...Object.values(consumables).filter(Boolean)];
    return { tokens, consumables, modifiers };
}

function detectBuildArchetype(buildObj) {
    const armorInfo = inspectArmorState(buildObj);
    const armor = String(armorInfo.dominantType || "").toLowerCase(); // "plate" | "leather" | "cloth"
    const cat = inferBuildCategory(buildObj);
    if (["melee", "mage", "archer", "healer", "tank"].includes(cat)) {
        return { armor, role: cat };
    }
    const off = buildObj?.offense || {};
    const mAtk = Number(off.meleeAttack) || 0;
    const rAtk = Number(off.rangedAttack) || 0;
    const magAtk = Number(off.magicAttack) || 0;
    const hPwr = Number(off.healingPower) || 0;

    let role = "melee";
    let maxVal = mAtk;
    if (rAtk > maxVal) {
        role = "archer";
        maxVal = rAtk;
    }
    if (magAtk > maxVal) {
        role = "mage";
        maxVal = magAtk;
    }
    if (hPwr > maxVal) {
        role = "healer";
        maxVal = hPwr;
    }
    return { armor, role };
}

const ROLE_KEYWORDS = {
    mage: ["mage", "sorc", "magic", "caster", "spellsong", "spellsinger"],
    archer: ["archer", "ranged", "bow", "howler", "primeval", "ebonsong"],
    melee: ["melee", "darkrunner", "shadowblade", "blade", "battlerage"],
    healer: ["healer", "cleric", "vitalism", "heal", "templar", "hierophant"],
    tank: ["tank", "skullknight", "abolisher", "dreambreaker", "initiator"],
};

const SIGNATURE_SKILL_IDS_BY_ROLE = {
    mage: ["sorcery_arc_lightning", "sorcery_flamebolt"],
    archer: ["archery_snipe", "archery_concussive_arrow", "archery_charged_bolt"],
    melee: ["battlerage_precision_strike", "battlerage_tiger_strike"],
    healer: ["vitalism_skewer", "vitalism_holy_bolt"],
};

const ROLE_SKILLSETS = {
    mage: new Set(["sorcery", "occultism", "malediction"]),
    archer: new Set(["archery"]),
    melee: new Set(["battlerage"]),
    healer: new Set(["vitalism"]),
    tank: new Set(["defense", "occultism"]),
};

function resolveComboStepsForMatrix(combo, skillById) {
    if (!combo || !Array.isArray(combo.steps)) return null;
    const steps = combo.steps
        .map((st, idx) => {
            const sk = st.skill || skillById.get(st.skillId);
            return sk ? { ...st, skill: sk, rawIndex: idx } : null;
        })
        .filter(Boolean);
    if (steps.length === 0) return null;
    return { id: combo.id || "combo", label: combo.label || combo.id || "Combo", steps };
}

function findBestSavedComboForRole(role, savedCombos, skillById) {
    if (!Array.isArray(savedCombos) || savedCombos.length === 0) return null;
    const roleWords = ROLE_KEYWORDS[role] || [role];
    const targetTrees = ROLE_SKILLSETS[role] || new Set();
    let best = null;
    let bestScore = 0;

    for (const c of savedCombos) {
        const resolved = resolveComboStepsForMatrix(c, skillById);
        if (!resolved) continue;
        const lbl = `${c.id || ""} ${c.label || ""}`.toLowerCase();
        const labelMatch = roleWords.some((w) => lbl.includes(w));
        const treeHits = resolved.steps.filter((s) => targetTrees.has(String(s.skill?.skillset || "").toLowerCase())).length;
        const score = (labelMatch ? 20 : 0) + treeHits * 5;
        if (score > bestScore) {
            bestScore = score;
            best = resolved;
        }
    }
    return best;
}

function killProbHeatStyle(killProbPct) {
    const p = Math.max(0, Math.min(100, Number(killProbPct) || 0));
    if (p >= 80) {
        const alpha = (0.18 + ((p - 80) / 20) * 0.24).toFixed(3);
        return `background:rgba(34,197,94,${alpha});color:#dcfce7;`;
    }
    if (p >= 40) {
        const alpha = (0.12 + ((p - 40) / 40) * 0.16).toFixed(3);
        return `background:rgba(245,158,11,${alpha});color:#fef3c7;`;
    }
    const alpha = (0.1 + ((40 - p) / 40) * 0.16).toFixed(3);
    return `background:rgba(244,63,94,${alpha});color:#fecdd3;`;
}

function findSignatureSkillForRole(role, skillById) {
    const candidates = SIGNATURE_SKILL_IDS_BY_ROLE[role] || SIGNATURE_SKILL_IDS_BY_ROLE.melee;
    for (const id of candidates) {
        const sk = skillById.get(id);
        if (sk) return sk;
    }
    return null;
}

function findBestPresetForBuild(buildObj, presets) {
    if (!Array.isArray(presets) || presets.length === 0) return null;
    const { armor, role } = detectBuildArchetype(buildObj);
    const roleWords = ROLE_KEYWORDS[role] || [role];
    let best = null;
    let bestScore = 0;

    for (const p of presets) {
        const lbl = String(p.label || "").toLowerCase();
        const matchesRole = roleWords.some((w) => lbl.includes(w));
        const matchesArmor = armor && lbl.includes(armor);
        if (!matchesRole) continue;
        const score = (matchesRole ? 10 : 0) + (matchesArmor ? 5 : 0);
        if (score > bestScore) {
            bestScore = score;
            best = p;
        }
    }
    return best;
}

function resolveOpponentBuffs(buildObj, matrixBuffMode, overrideVal) {
    const presets = Array.isArray(state.customBuffLoadouts) ? state.customBuffLoadouts : [];
    const effectiveSpec = overrideVal && overrideVal !== "__matrix__" ? overrideVal : matrixBuffMode;

    if (effectiveSpec === "none") {
        return { tokens: [], consumables: {}, modifiers: [], label: "None", count: 0, isAuto: false, unmatched: false };
    }

    if (effectiveSpec === "card3") {
        const tokens = getSlotChipTokens("defender");
        const consumables = { ...(state.consumables.defender || {}) };
        const modifiers = getSlotModifiers("defender");
        return {
            tokens,
            consumables,
            modifiers,
            label: "3rd Card",
            count: modifiers.length,
            isAuto: false,
            unmatched: false,
        };
    }

    if (effectiveSpec === "saved") {
        const saved = extractBuildSavedTokensAndCons(buildObj);
        return {
            ...saved,
            label: "Build Saved",
            count: saved.modifiers.length,
            isAuto: false,
            unmatched: false,
        };
    }

    if (effectiveSpec && effectiveSpec.startsWith("preset:")) {
        const pid = effectiveSpec.slice("preset:".length);
        const found = presets.find((p) => p.id === pid);
        if (found) {
            const tokens = Array.isArray(found.tokens) ? [...found.tokens] : [];
            const consumables =
                found.consumables && typeof found.consumables === "object" ? { ...found.consumables } : {};
            const modifiers = [...tokens, ...Object.values(consumables).filter(Boolean)];
            return {
                tokens,
                consumables,
                modifiers,
                label: found.label,
                count: modifiers.length,
                isAuto: false,
                unmatched: false,
            };
        }
        return { tokens: [], consumables: {}, modifiers: [], label: "None", count: 0, isAuto: false, unmatched: true };
    }

    const matched = findBestPresetForBuild(buildObj, presets);
    if (matched) {
        const tokens = Array.isArray(matched.tokens) ? [...matched.tokens] : [];
        const consumables =
            matched.consumables && typeof matched.consumables === "object" ? { ...matched.consumables } : {};
        const modifiers = [...tokens, ...Object.values(consumables).filter(Boolean)];
        return {
            tokens,
            consumables,
            modifiers,
            label: matched.label,
            count: modifiers.length,
            isAuto: true,
            unmatched: false,
        };
    }

    return {
        tokens: [],
        consumables: {},
        modifiers: [],
        label: "No Preset Match",
        count: 0,
        isAuto: true,
        unmatched: true,
    };
}

function fmtCompactNum(n) {
    const v = Number(n) || 0;
    if (v >= 1000000) return `${(v / 1000000).toFixed(2)}M`;
    if (v >= 10000) return `${Math.round(v / 1000)}k`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return fmtInt(v);
}

function shortBuildColLabel(name) {
    const s = String(name || "").trim();
    if (s.length <= 13) return s;
    const words = s.split(/\s+/);
    if (words.length >= 2 && words[0].length <= 12) {
        return `${words[0]} ${words[1].slice(0, 3)}.`;
    }
    return `${s.slice(0, 11)}…`;
}

function tradeRatioHeatStyle(ratio) {
    if (!Number.isFinite(ratio) || ratio <= 0) return "";
    const log2 = Math.log2(ratio); // 0 = even, +1 = 2x, -1 = 0.5x
    const intensity = Math.min(1, Math.abs(log2) / 1.6);
    if (ratio > 1.05) {
        const alpha = (0.09 + intensity * 0.28).toFixed(3);
        return `background:rgba(34,197,94,${alpha});color:#dcfce7;`;
    }
    if (ratio < 0.95) {
        const alpha = (0.09 + intensity * 0.28).toFixed(3);
        return `background:rgba(244,63,94,${alpha});color:#ffe4e6;`;
    }
    return `background:rgba(148,163,184,0.08);color:#cbd5e1;`;
}

function pctHpHeatStyle(pctHp) {
    const clamped = Math.max(0, Math.min(60, Number(pctHp) || 0));
    const t = clamped / 60;
    if (t >= 0.45) {
        const alpha = (0.1 + (t - 0.45) * 0.45).toFixed(3);
        return `background:rgba(34,197,94,${alpha});color:#dcfce7;`;
    }
    if (t >= 0.2) {
        const alpha = (0.08 + t * 0.2).toFixed(3);
        return `background:rgba(245,158,11,${alpha});color:#fef3c7;`;
    }
    return `background:rgba(244,63,94,0.12);color:#fecdd3;`;
}

function ehpHeatStyle(ehp, minEhp, maxEhp) {
    const span = Math.max(1, maxEhp - minEhp);
    const t = Math.max(0, Math.min(1, (ehp - minEhp) / span));
    if (t >= 0.55) {
        const alpha = (0.08 + (t - 0.55) * 0.45).toFixed(3);
        return `background:rgba(56,189,248,${alpha});color:#e0f2fe;`;
    }
    if (t <= 0.3) {
        const alpha = (0.1 + (0.3 - t) * 0.45).toFixed(3);
        return `background:rgba(244,63,94,${alpha});color:#ffe4e6;`;
    }
    return `background:rgba(148,163,184,0.07);color:#e2e8f0;`;
}

function healValHeatStyle(val, minVal, maxVal) {
    const span = Math.max(1, maxVal - minVal);
    const t = Math.max(0, Math.min(1, (val - minVal) / span));
    if (t >= 0.55) {
        const alpha = (0.1 + (t - 0.55) * 0.45).toFixed(3);
        return `background:rgba(16,185,129,${alpha});color:#d1fae5;`;
    }
    if (t >= 0.2) {
        const alpha = (0.07 + t * 0.14).toFixed(3);
        return `background:rgba(20,184,166,${alpha});color:#ccfbf1;`;
    }
    return `background:rgba(148,163,184,0.06);color:#94a3b8;`;
}

function healPctHeatStyle(pctHp) {
    const clamped = Math.max(0, Math.min(160, Number(pctHp) || 0));
    const t = clamped / 160;
    const alpha = (0.1 + t * 0.28).toFixed(3);
    return `background:rgba(16,185,129,${alpha});color:#d1fae5;`;
}

const HEAL_SKILL_PRIORITY = [
    "songcraft_ode_to_recovery",
    "songcraft_ode_to_recovery_life",
    "vitalism_antithesis_heal",
    "vitalism_fervent_healing",
    "vitalism_mend",
    "vitalism_resurgence",
    "songcraft_healing_hymn",
];

function getSortedHealSkills(allSkills) {
    const heals = (allSkills || []).filter((s) => s && s.kind === "heal");
    const prioIdx = new Map(HEAL_SKILL_PRIORITY.map((id, idx) => [id, idx]));
    return heals.sort((a, b) => {
        const pa = prioIdx.has(a.id) ? prioIdx.get(a.id) : 999;
        const pb = prioIdx.has(b.id) ? prioIdx.get(b.id) : 999;
        if (pa !== pb) return pa - pb;
        return String(a.name || "").localeCompare(String(b.name || ""));
    });
}

export function renderMatrixView(out) {
    const saved = Array.isArray(state.savedBuilds) ? state.savedBuilds : [];
    if (saved.length === 0) {
        out.innerHTML = `<p class="hint-inline">No saved builds found in <code>builds/</code>. Save or import builds to run a Matchup Matrix.</p>`;
        return;
    }

    const scope = state.matrixViewScope || "all_vs_all"; // "all_vs_all" | "ab_vs_roster"
    const isAllVsAll = scope === "all_vs_all";
    const mode = state.matrixMode || "offense_skill";
    const isDefense = !isAllVsAll && (mode === "defense_ehp" || mode === "defense_skill");
    const isRot = !isAllVsAll && mode === "offense_rotation";
    const allMetric = state.matrixAllMetric || "trade_ratio";
    const allHitMode = state.matrixAllHitMode || "expected";
    const disableAvoidance = getEffectiveDefenderDisableAvoidance();
    const presets = Array.isArray(state.customBuffLoadouts) ? state.customBuffLoadouts : [];
    const buffMode = state.matrixBuffMode || (presets.length > 0 ? "auto_preset" : "card3");
    const overrides = state.matrixOppBuffOverrides || {};
    const card3BuffCnt = getSlotModifiers("defender").length;

    const q = (state.matrixSearch || "").trim().toLowerCase();
    const filteredSaved = saved.filter((b) => {
        if (!q) return true;
        const hay = `${b.name || ""} ${b.savedId || ""} ${b.className || ""} ${b.metadata?.className || ""} ${b.metadata?.equipmentType || ""}`.toLowerCase();
        return hay.includes(q);
    });

    const selectedSet =
        state.matrixSelectedIds instanceof Set
            ? state.matrixSelectedIds
            : new Set(saved.map((b) => b.savedId || b.name));

    const skillById = new Map(state.allSkills.map((s) => [s.id, s]));
    const healSkills = getSortedHealSkills(state.allSkills);
    const selectedHealSkillId = state.matrixAllHealSkillId || "songcraft_ode_to_recovery";
    const selectedHealSkill =
        skillById.get(selectedHealSkillId) ||
        healSkills[0] ||
        null;
    const healersOnlyRows = Boolean(state.matrixAllHealersOnly);
    const savedCombos = Array.isArray(state.customRotations) ? state.customRotations : [];
    const allComboId = state.matrixAllComboId || "__auto__";
    const resolvedUniformCombo = (() => {
        if (allMetric !== "saved_combo" || allComboId === "__auto__") return null;
        if (allComboId === "__current__") {
            return resolveComboStepsForMatrix({ id: "__current__", label: "Active Rotation Queue", steps: state.rotationSteps }, skillById);
        }
        const found = savedCombos.find((c) => c.id === allComboId);
        return found ? resolveComboStepsForMatrix(found, skillById) : null;
    })();
    const resolvedByOppId = new Map();
    const activeEntries = filteredSaved
        .filter((b) => selectedSet.has(b.savedId || b.name))
        .map((b) => {
            const id = b.savedId || b.name;
            const resolvedBuffs = resolveOpponentBuffs(b, buffMode, overrides[id]);
            resolvedByOppId.set(id, resolvedBuffs);
            const arch = detectBuildArchetype(b);
            const engRole = arch.role === "mage" ? "magic" : arch.role === "archer" ? "ranged" : arch.role;
            return {
                id,
                name: b.name || id,
                character: b,
                modifiers: resolvedBuffs.modifiers,
                role: engRole,
                displayRole: arch.role,
                armor: arch.armor,
                signatureSkill: findSignatureSkillForRole(arch.role, skillById),
                combo:
                    allMetric === "saved_combo"
                        ? resolvedUniformCombo || findBestSavedComboForRole(arch.role, savedCombos, skillById)
                        : null,
                buffLabel: resolvedBuffs.label,
                buffCount: resolvedBuffs.count,
            };
        });

    const buildById = new Map(saved.map((b) => [b.savedId || b.name, b]));
    const unmatchedCount = Array.from(resolvedByOppId.values()).filter((r) => r.unmatched).length;
    const overrideCount = Object.keys(overrides).filter((k) => overrides[k] && overrides[k] !== "__matrix__").length;

    const matrixBuffOptionsHtml = [
        `<option value="auto_preset" ${buffMode === "auto_preset" ? "selected" : ""}>Auto-Match Saved Presets (${presets.length} saved)</option>`,
        `<option value="card3" ${buffMode === "card3" ? "selected" : ""}>Uniform: 3rd Card Buffs (${card3BuffCnt} active)</option>`,
        `<option value="none" ${buffMode === "none" ? "selected" : ""}>None (Base Stats Only)</option>`,
        ...presets.map((p) => {
            const cnt = (p.tokens?.length || 0) + Object.values(p.consumables || {}).filter(Boolean).length;
            const val = `preset:${p.id}`;
            return `<option value="${escHtml(val)}" ${buffMode === val ? "selected" : ""}>Uniform Preset: ${escHtml(p.label)} (${cnt})</option>`;
        }),
        `<option value="saved" ${buffMode === "saved" ? "selected" : ""}>Each Build's Saved Buffs (raw)</option>`,
    ].join("");

    const buildRowBuffSelectHtml = (oppId, oppBuild, resolved) => {
        const curOv = overrides[oppId] || "__matrix__";
        const defLabel = `${resolved.isAuto ? "Auto: " : ""}${resolved.label} (${resolved.count})`;
        const savedCnt = extractBuildSavedTokensAndCons(oppBuild).modifiers.length;
        const warnCls = resolved.unmatched ? "is-unmatched" : curOv !== "__matrix__" ? "is-override" : "";
        return `
        <select class="matrix-row-buff-sel ${warnCls}" data-matrix-row-buff="${escHtml(oppId)}" title="Buffs applied to ${escHtml(oppBuild.name)} in the matrix">
            <option value="__matrix__" ${curOv === "__matrix__" ? "selected" : ""}>${escHtml(defLabel)}</option>
            <option value="none" ${curOv === "none" ? "selected" : ""}>None (0)</option>
            <option value="card3" ${curOv === "card3" ? "selected" : ""}>3rd Card (${card3BuffCnt})</option>
            ${presets
                .map((p) => {
                    const cnt = (p.tokens?.length || 0) + Object.values(p.consumables || {}).filter(Boolean).length;
                    const val = `preset:${p.id}`;
                    return `<option value="${escHtml(val)}" ${curOv === val ? "selected" : ""}>${escHtml(p.label)} (${cnt})</option>`;
                })
                .join("")}
            <option value="saved" ${curOv === "saved" ? "selected" : ""}>Build Saved (${savedCnt})</option>
        </select>`;
    };

    const rosterPillsHtml = filteredSaved
        .map((b) => {
            const id = b.savedId || b.name;
            const checked = selectedSet.has(id);
            const gs = b.gearScore ? ` (${fmtInt(b.gearScore)})` : "";
            const resolved = resolvedByOppId.get(id) || resolveOpponentBuffs(b, buffMode, overrides[id]);
            return `
            <div class="matrix-opp-item ${checked ? "active" : ""}">
                <label class="matrix-opp-chk ${checked ? "active" : ""}">
                    <input type="checkbox" data-matrix-opp="${escHtml(id)}" ${checked ? "checked" : ""} />
                    <span>${escHtml(b.name || id)}${gs}</span>
                </label>
                ${isAllVsAll && checked ? buildRowBuffSelectHtml(id, b, resolved) : ""}
            </div>`;
        })
        .join("");

    const skill = state.isCustomSkill ? buildCustomSkill() : getActiveSkillObject(getMatchingSkills());
    const matrixAntiHealPct = allMetric === "healing_output" ? Number(state.healingAntiHealPct) || 0 : 0;
    const baseCtx = {
        ...getContext(),
        targetAbsorbShield: Math.max(0, Number(state.rotationTargetShield) || 0),
        ...(matrixAntiHealPct !== 0 ? { antiHealPct: matrixAntiHealPct } : {}),
    };
    const rowRoleFilter = state.matrixAllRowRole || "all";
    const colRoleFilter = state.matrixAllColRole || "all";
    const matchesRoleFilter = (entry, filterVal) => {
        if (!filterVal || filterVal === "all") return true;
        const r = entry?.displayRole || (entry?.role === "magic" ? "mage" : entry?.role === "ranged" ? "archer" : entry?.role);
        if (filterVal === "healer") {
            return r === "healer" || (Number(entry?.eff?.offense?.healingPower) || 0) >= 400;
        }
        return r === filterVal;
    };

    let bodyHtml = "";

    if (isAllVsAll) {
        if (activeEntries.length < 2) {
            bodyHtml = `<p class="hint-inline">Select at least 2 builds in the Roster above to generate an All-vs-All N&times;N Matchup Matrix.</p>`;
        } else if (allMetric === "selected_skill" && !skill) {
            bodyHtml = `<p class="hint-inline">Select a skill above to run the All-vs-All Selected Skill grid.</p>`;
        } else if (allMetric === "saved_combo" && savedCombos.length === 0 && state.rotationSteps.length === 0) {
            bodyHtml = `<p class="hint-inline">No saved combos found in <code>combos/combos.json</code>. Save a combo in the <strong>Rotation / Combo</strong> tab first.</p>`;
        } else if (allMetric === "healing_output" && !selectedHealSkill) {
            bodyHtml = `<p class="hint-inline">No healing skills loaded to evaluate Healing Output.</p>`;
        } else {
            const res = computeAllVsAllMatrix(activeEntries, {
                metric: allMetric,
                hitMode: allHitMode,
                selectedSkill: skill,
                healSkill: selectedHealSkill,
                selectedCombo: resolvedUniformCombo,
                context: baseCtx,
                disableAvoidance,
            });

            // Optionally sort rows & columns together by overall performance rank
            const orderIndices = res.rows.map((_, i) => i);
            if (state.matrixAllSortByRank) {
                orderIndices.sort((ia, ib) => {
                    const ra = res.rows[ia];
                    const rb = res.rows[ib];
                    if (allMetric === "saved_combo") {
                        // Keep builds with no matching combo at the bottom
                        if (ra.hasNoComboRow !== rb.hasNoComboRow) return ra.hasNoComboRow ? 1 : -1;
                        // In Auto-Match mode, keep DPS kill-chance rows grouped above Heal-combo rows so scales don't collide
                        if (!resolvedUniformCombo && ra.isHealRow !== rb.isHealRow) return ra.isHealRow ? 1 : -1;
                    }
                    // Higher avgScore is always stronger (highest Defender EHP = tankiest, highest Heal = biggest Ode, highest trade ratio / dmg = strongest)
                    return rb.avgScore - ra.avgScore;
                });
            }

            const orderedEntriesAll = orderIndices.map((idx) => res.entries[idx]);
            const effectiveRowFilter =
                allMetric === "healing_output" && healersOnlyRows && rowRoleFilter === "all"
                    ? "healer"
                    : rowRoleFilter;
            const visibleColPositions = orderedEntriesAll
                .map((e, pos) => (matchesRoleFilter(e, colRoleFilter) ? pos : -1))
                .filter((pos) => pos >= 0);
            const orderedEntries = visibleColPositions.map((pos) => orderedEntriesAll[pos]);
            const orderedRows = orderIndices
                .map((rowIdx) => {
                    const r = res.rows[rowIdx];
                    const visibleCells = visibleColPositions.map((pos) => r.cells[orderIndices[pos]]);
                    let avgScore = r.avgScore;
                    let wins = r.wins;
                    let losses = r.losses;
                    let ties = r.ties;
                    if (colRoleFilter !== "all" && visibleCells.length > 0 && !r.hasNoComboRow) {
                        if (allMetric === "trade_ratio") {
                            const valid = visibleCells.filter((c) => !c.isMirror);
                            wins = 0;
                            losses = 0;
                            ties = 0;
                            for (const c of valid) {
                                if (c.ratio > 1.05) wins++;
                                else if (c.ratio < 0.95) losses++;
                                else ties++;
                            }
                            avgScore =
                                valid.length > 0
                                    ? Math.exp(
                                          valid.reduce((s, c) => s + Math.log(Math.max(0.05, Math.min(20, c.ratio))), 0) /
                                              valid.length
                                      )
                                    : 1;
                        } else {
                            const valid = visibleCells.filter((c) => !c.noCombo);
                            if (allMetric === "saved_combo" && !r.isHealRow) {
                                wins = 0;
                                losses = 0;
                                ties = 0;
                                for (const c of valid) {
                                    if ((Number(c.killProbPct) || 0) >= 50) wins++;
                                    else losses++;
                                }
                            }
                            avgScore =
                                valid.length > 0
                                    ? valid.reduce((s, c) => s + (Number(c.primaryVal) || 0), 0) / valid.length
                                    : 0;
                        }
                    }
                    return {
                        ...r,
                        cells: visibleCells,
                        avgScore,
                        wins,
                        losses,
                        ties,
                    };
                })
                .filter((r) => matchesRoleFilter(r.attacker, effectiveRowFilter));
            if (colRoleFilter !== "all" && state.matrixAllSortByRank) {
                orderedRows.sort((ra, rb) => {
                    if (allMetric === "saved_combo") {
                        if (ra.hasNoComboRow !== rb.hasNoComboRow) return ra.hasNoComboRow ? 1 : -1;
                        if (!resolvedUniformCombo && ra.isHealRow !== rb.isHealRow) return ra.isHealRow ? 1 : -1;
                    }
                    return rb.avgScore - ra.avgScore;
                });
            }

            let minEhp = Infinity;
            let maxEhp = 0;
            if (allMetric === "defender_ehp") {
                for (const r of orderedRows) {
                    for (const c of r.cells) {
                        if (c.primaryVal < minEhp) minEhp = c.primaryVal;
                        if (c.primaryVal > maxEhp) maxEhp = c.primaryVal;
                    }
                }
            }

            let minHeal = Infinity;
            let maxHeal = 0;
            if (allMetric === "healing_output") {
                for (const r of orderedRows) {
                    for (const c of r.cells) {
                        if (c.primaryVal < minHeal) minHeal = c.primaryVal;
                        if (c.primaryVal > maxHeal) maxHeal = c.primaryVal;
                    }
                }
            }

            const topBuild = orderedRows[0]?.attacker;
            const topRow = orderedRows[0];
            const botRow = orderedRows[orderedRows.length - 1];
            const isOdeSkill = selectedHealSkill?.id === "songcraft_ode_to_recovery";
            const isPerSecHeal = Boolean(selectedHealSkill?.flags?.perTickFormula);
            const bestRecvHealEntry =
                allMetric === "healing_output"
                    ? [...orderedEntries].sort(
                          (a, b) =>
                              (Number(b.eff?.defense?.receivedHealingPct) || 0) -
                              (Number(a.eff?.defense?.receivedHealingPct) || 0)
                      )[0]
                    : null;

            const metricSubtitle =
                allMetric === "trade_ratio"
                    ? `1v1 Trade Ratio = (% Target HP dealt by Row per 500% primary attack) &divide; (% Row HP dealt back by Col) &bull; Green &gt; 1.05&times; (Row favored), Red &lt; 0.95&times; (Col favored)`
                    : allMetric === "saved_combo"
                      ? `Full Saved Combo evaluation (${resolvedUniformCombo ? `Uniform: ${escHtml(resolvedUniformCombo.label)}` : "Auto-matched per role from combos/combos.json"}) &bull; ${allHitMode === "expected" ? "Damage combos: Kill % (Green &ge;80%, Gold 40–79%, Red &lt;40%); Heal combos: +Heal % of Ally HP (Emerald)" : "Primary: % Target HP dealt/healed; Sub: total output &amp; duration"}`
                      : allMetric === "signature_skill"
                        ? `Each Attacker's signature nuke (Mage: Arc Lightning, Archer: Snipe, Melee: Precision Strike, Healer: Skewer) as % of Defender Max HP`
                        : allMetric === "defender_ehp"
                          ? `Defender (Row) EHP against Attacker (Column)'s primary damage type (Magic vs Mages/Healers, Ranged vs Archers, Melee vs Melees/Tanks) &bull; Avg = Row build's average EHP across all attackers`
                          : allMetric === "healing_output"
                            ? `Healer (Row) ${escHtml(selectedHealSkill.name)} output onto Ally Target (Column) &mdash; includes caster Healing Power, Heal Crit, Outgoing Healing % &amp; Ally Received Healing %${isPerSecHeal ? " (hover any cell for full 15s song total)" : ""}`
                            : `Selected Skill (${skill?.name || "None"}) as % of Defender Max HP`;

            const roleBadgeTxt = (e) => {
                const rMap = { magic: "Mage", ranged: "Archer", melee: "Melee", healer: "Healer", tank: "Tank" };
                const r = rMap[e.role] || e.role;
                const a = e.armor ? `${e.armor[0].toUpperCase() + e.armor.slice(1)} ` : "";
                return `${a}${r}`;
            };

            const colHdrHtml = orderedEntries
                .map((e) => {
                    const tip = `${e.name} • ${roleBadgeTxt(e)}${e.gearScore ? ` • ${fmtInt(e.gearScore)} GS` : ""} • Buffs: ${e.buffLabel} (${e.buffCount})`;
                    return `<th class="nxn-col-hdr" title="${escHtml(tip)}">
                        <div class="nxn-col-name">${escHtml(shortBuildColLabel(e.name))}</div>
                        <div class="nxn-col-meta">${escHtml(roleBadgeTxt(e))}</div>
                    </th>`;
                })
                .join("");

            const gridRowsHtml = orderedRows
                .map((r, rankIdx) => {
                    const att = r.attacker;
                    const attTip = `${att.name} • ${roleBadgeTxt(att)} • Buffs: ${att.buffLabel} (${att.buffCount})`;
                    const cellsHtml = r.cells
                        .map((c) => {
                            if (c.isMirror && allMetric === "trade_ratio") {
                                return `<td class="nxn-cell nxn-mirror" title="Mirror matchup (${escHtml(att.name)})">&mdash;</td>`;
                            }
                            if (allMetric === "trade_ratio") {
                                const style = tradeRatioHeatStyle(c.ratio);
                                const pctEdge = (c.ratio - 1) * 100;
                                const tip = `${att.name} vs ${c.defenderName}: ${c.ratio.toFixed(2)}× trade ratio (${fmtDeltaPct(pctEdge)}) | ${att.name} deals ${fmtDec(c.fwdPctHp)}% HP (${fmtInt(c.fwdDmg)}) vs ${c.defenderName} deals ${fmtDec(c.revPctHp)}% HP (${fmtInt(c.revDmg)}). Click to load this 1v1!`;
                                return `<td class="nxn-cell nxn-clickable" style="${style}" data-nxn-att="${escHtml(att.id)}" data-nxn-def="${escHtml(c.defenderId)}" title="${escHtml(tip)}">
                                    <div class="nxn-val">${c.ratio.toFixed(2)}&times;</div>
                                    <div class="nxn-sub">${fmtDec(c.fwdPctHp, 0)}% / ${fmtDec(c.revPctHp, 0)}%</div>
                                </td>`;
                            }
                            if (allMetric === "defender_ehp") {
                                const style = ehpHeatStyle(c.primaryVal, minEhp, maxEhp);
                                const colAttId = c.attackerId || c.defenderId;
                                const colAttName = c.attackerName || c.defenderName;
                                const tip = `${att.name} ${c.ehpKind.toUpperCase()} EHP vs ${colAttName}: ${fmtInt(c.primaryVal)} (DR ${fmtDec(c.mitDrPct)}%${c.ehpKind !== "magic" ? `, Avoid ${fmtDec(c.avoidPct)}%` : ""}). Click to load ${colAttName} → Build A & ${att.name} → Target!`;
                                return `<td class="nxn-cell nxn-clickable ${c.isMirror ? "nxn-mirror-soft" : ""}" style="${style}" data-nxn-att="${escHtml(colAttId)}" data-nxn-def="${escHtml(att.id)}" title="${escHtml(tip)}">
                                    <div class="nxn-val">${fmtCompactNum(c.primaryVal)}</div>
                                    <div class="nxn-sub">${fmtDec(c.mitDrPct, 0)}% DR</div>
                                </td>`;
                            }
                            if (allMetric === "healing_output") {
                                const style = healValHeatStyle(c.primaryVal, minHeal, maxHeal);
                                const unit = c.isPerSec ? "/s" : "";
                                const primaryTxt =
                                    c.primaryVal >= 10000
                                        ? `${fmtCompactNum(c.primaryVal)}${unit}`
                                        : `${fmtInt(c.primaryVal)}${unit}`;
                                const subTxt = `+${fmtDec(c.pctHp, 1)}% HP`;
                                const durNote =
                                    c.fullDurHeal != null
                                        ? ` · Full ${c.durationSec}s Song: ${fmtInt(c.fullDurHeal)}`
                                        : "";
                                const recvNote =
                                    c.recvHealPct !== 0
                                        ? ` · Ally Recv Heal: ${c.recvHealPct > 0 ? "+" : ""}${fmtDec(c.recvHealPct, 1)}%`
                                        : "";
                                const tip = `${att.name} → ${c.defenderName} (${c.skillName}): ${fmtInt(c.primaryVal)}${unit} (${fmtDec(c.pctHp, 1)}% Ally HP) | Normal ${fmtInt(c.normalHeal)}${unit}, Crit ${fmtInt(c.critHeal)}${unit}, Expected ${fmtInt(c.expectedHeal)}${unit}${durNote}${recvNote}. Click to load in Simulator!`;
                                return `<td class="nxn-cell nxn-clickable ${c.isMirror ? "nxn-mirror-soft" : ""}" style="${style}" data-nxn-att="${escHtml(att.id)}" data-nxn-def="${escHtml(c.defenderId)}" title="${escHtml(tip)}">
                                    <div class="nxn-val">${primaryTxt}</div>
                                    <div class="nxn-sub">${subTxt}</div>
                                </td>`;
                            }
                            if (allMetric === "saved_combo") {
                                if (c.noCombo) {
                                    return `<td class="nxn-cell nxn-mirror" title="No saved combo matched for ${escHtml(att.name)}">&mdash;</td>`;
                                }
                                const style = c.isHealCombo
                                    ? healPctHeatStyle(c.pctHp)
                                    : allHitMode === "expected"
                                      ? killProbHeatStyle(c.killProbPct)
                                      : pctHpHeatStyle(c.pctHp);
                                const kindWord = c.isHealCombo ? "heal" : "dmg";
                                const primaryTxt = c.isHealCombo
                                    ? `+${fmtDec(c.pctHp, 0)}% HP`
                                    : allHitMode === "expected"
                                      ? `${fmtDec(c.killProbPct, 0)}%`
                                      : `${fmtDec(c.pctHp, 0)}%`;
                                const subTxt = c.isHealCombo
                                    ? `+${fmtCompactNum(c.dmg)} &middot; ${fmtCompactNum(c.windowRate)}/s`
                                    : allHitMode === "expected"
                                      ? `${fmtDec(c.pctHp, 0)}% HP &middot; ${fmtCompactNum(c.windowRate)}/s`
                                      : `${fmtCompactNum(c.dmg)} &middot; ${fmtCompactNum(c.windowRate)}/s`;
                                const tip = `${att.name} → ${c.defenderName} [${c.comboName}]: ${fmtInt(c.dmg)} ${kindWord} (${fmtDec(c.pctHp)}% Target HP) in ${fmtDec(c.durationSec, 2)}s (${fmtInt(c.windowRate)} ${c.isHealCombo ? "HPS" : "DPS"})${c.isHealCombo ? " (Healing Combo)" : ` • Kill Chance: ${fmtDec(c.killProbPct, 1)}%`}. Click to load this 1v1!`;
                                return `<td class="nxn-cell nxn-clickable ${c.isMirror ? "nxn-mirror-soft" : ""}" style="${style}" data-nxn-att="${escHtml(att.id)}" data-nxn-def="${escHtml(c.defenderId)}" title="${escHtml(tip)}">
                                    <div class="nxn-val">${primaryTxt}</div>
                                    <div class="nxn-sub">${subTxt}</div>
                                </td>`;
                            }
                            const style = pctHpHeatStyle(c.pctHp);
                            const tip = `${att.name} → ${c.defenderName} (${c.skillName}): ${fmtInt(c.dmg)} dmg (${fmtDec(c.pctHp)}% Target HP). Click to load this 1v1!`;
                            return `<td class="nxn-cell nxn-clickable ${c.isMirror ? "nxn-mirror-soft" : ""}" style="${style}" data-nxn-att="${escHtml(att.id)}" data-nxn-def="${escHtml(c.defenderId)}" title="${escHtml(tip)}">
                                <div class="nxn-val">${fmtDec(c.pctHp, 1)}%</div>
                                <div class="nxn-sub">${fmtCompactNum(c.dmg)}</div>
                            </td>`;
                        })
                        .join("");

                    const avgHtml =
                        allMetric === "trade_ratio"
                            ? `<div class="nxn-val ${r.avgScore > 1.05 ? "delta-pos" : r.avgScore < 0.95 ? "delta-neg" : "delta-tie"}">${r.avgScore.toFixed(2)}&times;</div>
                               <div class="nxn-sub">${r.wins}W-${r.losses}L${r.ties ? `-${r.ties}T` : ""}</div>`
                            : allMetric === "saved_combo"
                              ? r.hasNoComboRow
                                  ? `<div class="nxn-val">&mdash;</div><div class="nxn-sub">No Combo</div>`
                                  : r.isHealRow
                                    ? `<div class="nxn-val delta-pos">+${fmtDec(r.avgScore, 0)}%</div><div class="nxn-sub">Avg Heal</div>`
                                    : allHitMode === "expected"
                                      ? `<div class="nxn-val">${fmtDec(r.avgScore, 0)}%</div><div class="nxn-sub">Avg Kill%</div>`
                                      : `<div class="nxn-val">${fmtDec(r.avgScore, 0)}%</div><div class="nxn-sub">Avg HP</div>`
                              : allMetric === "defender_ehp"
                                ? `<div class="nxn-val">${fmtCompactNum(r.avgScore)}</div><div class="nxn-sub">Avg EHP</div>`
                                : allMetric === "healing_output"
                                  ? `<div class="nxn-val delta-pos">${r.avgScore >= 10000 ? fmtCompactNum(r.avgScore) : fmtInt(r.avgScore)}${isPerSecHeal ? "/s" : ""}</div><div class="nxn-sub">${isOdeSkill ? "Avg Ode/s" : isPerSecHeal ? "Avg / sec" : "Avg Heal"}</div>`
                                  : `<div class="nxn-val">${fmtDec(r.avgScore, 1)}%</div><div class="nxn-sub">Avg HP</div>`;

                    const comboMetaNote =
                        allMetric === "saved_combo" && att.combo?.label
                            ? ` &bull; ${escHtml(att.combo.label)}`
                            : "";

                    return `
                    <tr>
                        <th class="nxn-row-hdr" title="${escHtml(attTip)}">
                            <div class="nxn-row-top">
                                <span class="nxn-rank-num">${rankIdx + 1}</span>
                                <span class="nxn-row-name">${escHtml(att.name)}</span>
                            </div>
                            <div class="nxn-row-meta">${escHtml(roleBadgeTxt(att))} &bull; <span class="${att.buffCount === 0 ? "nxn-nobuff" : ""}">${escHtml(att.buffLabel)} (${att.buffCount})</span>${comboMetaNote}</div>
                        </th>
                        ${cellsHtml}
                        <td class="nxn-cell nxn-avg-cell">${avgHtml}</td>
                    </tr>`;
                })
                .join("");

            const topHealStr = topRow
                ? `${topRow.avgScore >= 10000 ? fmtCompactNum(topRow.avgScore) : fmtInt(topRow.avgScore)}${isPerSecHeal ? "/s" : ""}`
                : "0";
            const topHeal15s =
                topRow && isPerSecHeal && selectedHealSkill?.flags?.durationSec
                    ? ` · ${fmtCompactNum(topRow.avgScore * selectedHealSkill.flags.durationSec)}/${selectedHealSkill.flags.durationSec}s`
                    : "";

            const topLabel = !topBuild
                ? "None"
                : allMetric === "trade_ratio"
                  ? `${topBuild.name} (${topRow.avgScore.toFixed(2)}× · ${topRow.wins}W-${topRow.losses}L)`
                  : allMetric === "saved_combo"
                    ? `${topBuild.name} (${topRow.isHealRow ? `+${fmtDec(topRow.avgScore, 0)}% avg Heal` : `${fmtDec(topRow.avgScore, 0)}% ${allHitMode === "expected" ? "avg Kill%" : "avg HP"}`})`
                    : allMetric === "defender_ehp"
                      ? `${topBuild.name} (${fmtCompactNum(topRow.avgScore)} avg EHP)`
                      : allMetric === "healing_output"
                        ? `${topBuild.name} (${topHealStr} avg${topHeal15s})`
                        : `${topBuild.name} (${fmtDec(topRow.avgScore, 1)}% avg HP)`;

            const botLabel = !botRow
                ? "None"
                : allMetric === "trade_ratio"
                  ? `${botRow.attacker.name} (${botRow.avgScore.toFixed(2)}× · ${botRow.wins}W-${botRow.losses}L)`
                  : allMetric === "saved_combo"
                    ? `${botRow.attacker.name} (${botRow.hasNoComboRow ? "No Combo" : botRow.isHealRow ? `+${fmtDec(botRow.avgScore, 0)}% avg Heal` : `${fmtDec(botRow.avgScore, 0)}% ${allHitMode === "expected" ? "avg Kill%" : "avg HP"}`})`
                    : allMetric === "defender_ehp"
                      ? `${botRow.attacker.name} (${fmtCompactNum(botRow.avgScore)} avg EHP)`
                      : allMetric === "healing_output" && bestRecvHealEntry
                        ? `${bestRecvHealEntry.name} (${(Number(bestRecvHealEntry.eff?.defense?.receivedHealingPct) || 0) >= 0 ? "+" : ""}${fmtDec(Number(bestRecvHealEntry.eff?.defense?.receivedHealingPct) || 0, 1)}% Recv. Heal)`
                        : `${botRow.attacker.name} (${fmtDec(botRow.avgScore, 1)}% avg HP)`;

            const cornerHdrText =
                allMetric === "defender_ehp"
                    ? "Defender (Row) &darr; &nbsp;/&nbsp; Attacker (Col) &rarr;"
                    : allMetric === "healing_output"
                      ? "Healer (Row) &darr; &nbsp;/&nbsp; Ally Target (Col) &rarr;"
                      : "Attacker (Row) &darr; &nbsp;/&nbsp; Defender (Col) &rarr;";

            bodyHtml = `
                <div class="kpi-row">
                    <div class="kpi-card">
                        <div class="kpi-label">All-vs-All Matrix (${orderedRows.length}&times;${orderedEntries.length})</div>
                        <div class="kpi-value" style="font-size:15px">${allMetric === "trade_ratio" ? "1v1 Trade Ratio" : allMetric === "saved_combo" ? `Saved Combo (${resolvedUniformCombo ? escHtml(resolvedUniformCombo.label) : "Auto-Match Role"})` : allMetric === "signature_skill" ? "Signature Skill (% HP)" : allMetric === "defender_ehp" ? "Defender EHP" : allMetric === "healing_output" ? escHtml(isOdeSkill ? "Biggest Ode — Ode to Recovery" : selectedHealSkill.name) : escHtml(skill?.name || "Selected Skill")}</div>
                        <div class="kpi-sub">Hit Mode: <strong>${allHitMode === "normal" ? "Non-Crit" : allHitMode === "crit" ? "Crit" : "Expected"}</strong>${disableAvoidance && allMetric !== "healing_output" ? " &bull; Avoidance Off" : ""} &bull; Independent of Build A / B</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-label">${allMetric === "defender_ehp" ? "#1 Tankiest Build" : allMetric === "healing_output" ? (isOdeSkill ? "#1 Biggest Ode" : `#1 Highest Heal`) : "#1 Overall in Grid"}</div>
                        <div class="kpi-value delta-pos" style="font-size:15px">${escHtml(topLabel)}</div>
                        <div class="kpi-sub">${allMetric === "defender_ehp" ? "Click any cell to load Col Attacker &rarr; Build A &amp; Row Defender &rarr; Target" : allMetric === "healing_output" ? "Click any cell to load Row Healer &rarr; Build A &amp; Col Ally &rarr; Target" : "Click any cell to load Row &rarr; Build A &amp; Col &rarr; Target (with buffs)"}</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-label">${allMetric === "defender_ehp" ? "Squishiest Build" : allMetric === "healing_output" ? "Highest Recv. Healing Ally" : "Toughest Overall Position"}</div>
                        <div class="kpi-value ${allMetric === "healing_output" ? "val-a" : "delta-neg"}" style="font-size:15px">${escHtml(botLabel)}</div>
                        <div class="kpi-sub">Edit per-build buff presets inside <strong>Roster &amp; Buffs</strong> above</div>
                    </div>
                </div>
                <div class="hint-inline" style="margin-bottom:6px">${metricSubtitle}</div>
                ${
                    orderedRows.length > 0 && orderedEntries.length > 0
                        ? `<div class="nxn-table-wrap">
                    <table class="nxn-table">
                        <thead>
                            <tr>
                                <th class="nxn-corner-hdr">${cornerHdrText}</th>
                                ${colHdrHtml}
                                <th class="nxn-col-hdr nxn-avg-hdr">Avg</th>
                            </tr>
                        </thead>
                        <tbody>${gridRowsHtml}</tbody>
                    </table>
                </div>`
                        : `<p class="hint-inline">No builds match the current Row/Column role filter. Reset Rows or Columns back to <strong>All</strong> to view the grid.</p>`
                }`;
        }
    } else {
        // Build A vs Build B (vs Roster)
        const resolvedSteps = state.rotationSteps
            .map((st, idx) => {
                const sk = skillById.get(st.skillId);
                return sk ? { ...st, skill: sk, rawIndex: idx } : null;
            })
            .filter(Boolean);

        const canRun =
            activeEntries.length > 0 &&
            (mode === "defense_ehp" || (isRot ? resolvedSteps.length > 0 : Boolean(skill)));

        const matrix = canRun
            ? computeMatchupMatrix(state.buildA, state.buildB, activeEntries, {
                  matrixMode: mode,
                  skill,
                  rotationSteps: resolvedSteps,
                  ehpKind: state.matrixEhpKind || "melee",
                  context: baseCtx,
                  modifiersA: getSlotModifiers("A"),
                  modifiersB: getSlotModifiers("B"),
                  disableAvoidance,
              })
            : null;

        const lowerBetter = mode === "defense_skill";
        const dCls = (d) =>
            lowerBetter
                ? d < -0.05
                    ? "delta-pos"
                    : d > 0.05
                      ? "delta-neg"
                      : "delta-tie"
                : d > 0.05
                  ? "delta-pos"
                  : d < -0.05
                    ? "delta-neg"
                    : "delta-tie";

        const modeDesc =
            mode === "offense_skill"
                ? `Skill: ${skill ? skill.name : "None selected"}`
                : mode === "offense_rotation"
                  ? `Rotation: ${resolvedSteps.length} step${resolvedSteps.length === 1 ? "" : "s"}`
                  : mode === "defense_ehp"
                    ? `${state.matrixEhpKind === "magic" ? "Magic" : state.matrixEhpKind === "ranged" ? "Ranged" : "Melee"} EHP vs every Aggressor${disableAvoidance ? " (Avoidance Off)" : ""}`
                    : `Incoming ${skill ? skill.name : "Skill"} (% HP Lost) from every Aggressor`;

        if (!canRun) {
            const reason =
                activeEntries.length === 0
                    ? "Select at least one opponent build below to compute the Matchup Matrix."
                    : isRot
                      ? "Your Rotation queue is empty — add skills in the Rotation / Combo tab to run an Offense Rotation Matrix."
                      : "Select a skill above to run the Matchup Matrix.";
            bodyHtml = `<p class="hint-inline">${reason}</p>`;
        } else {
            const sum = matrix.summary;
            const winnerName =
                sum.overallWinner === "A"
                    ? state.buildA.name
                    : sum.overallWinner === "B"
                      ? state.buildB.name
                      : "Tie";

            const colHeaders = isRot
                ? `<th>Opponent</th>
                   <th class="matrix-buff-cell">Buffs Applied</th>
                   <th>Non-Crit (<span class="val-a">A</span> / <span class="val-b">B</span>)</th>
                   <th>Crit (<span class="val-a">A</span> / <span class="val-b">B</span>)</th>
                   <th>Expected Burst (<span class="val-a">A</span> / <span class="val-b">B</span> &middot; &Delta;)</th>
                   <th>Kill % (<span class="val-a">A</span> / <span class="val-b">B</span>)</th>
                   <th>Winner</th>`
                : `<th>${isDefense ? "Aggressor" : "Target"}</th>
                   <th class="matrix-buff-cell">Buffs Applied</th>
                   <th>Non-Crit (<span class="val-a">A</span> / <span class="val-b">B</span> &middot; &Delta;)</th>
                   <th>Crit (<span class="val-a">A</span> / <span class="val-b">B</span> &middot; &Delta;)</th>
                   <th>Expected (<span class="val-a">A</span> / <span class="val-b">B</span> &middot; &Delta;)</th>
                   <th>Winner</th>`;

            const rowsHtml = matrix.rows
                .map((r) => {
                    const oppBuild = buildById.get(r.opponentId);
                    const resolvedBuffs = resolvedByOppId.get(r.opponentId) || { label: "None", count: 0 };
                    const winTxt =
                        r.winner === "A"
                            ? `<span class="val-a">${escHtml(state.buildA.name)}</span>`
                            : r.winner === "B"
                              ? `<span class="val-b">${escHtml(state.buildB.name)}</span>`
                              : `<span class="delta-tie">Tie</span>`;
                    const arch = oppBuild ? detectBuildArchetype(oppBuild) : null;
                    const metaParts = [];
                    if (r.gearScore) metaParts.push(`${fmtInt(r.gearScore)} GS`);
                    if (arch?.armor) metaParts.push(arch.armor[0].toUpperCase() + arch.armor.slice(1));
                    if (r.opponentMeta?.className) metaParts.push(r.opponentMeta.className);
                    const metaLine =
                        metaParts.length > 0 ? `<div class="skill-meta">${escHtml(metaParts.join(" · "))}</div>` : "";
                    const buffCellHtml = `<td class="matrix-buff-cell">${buildRowBuffSelectHtml(r.opponentId, oppBuild || { name: r.opponentName }, resolvedBuffs)}</td>`;

                    if (isRot) {
                        return `
                        <tr class="skill-row" data-matrix-load="${escHtml(r.opponentId)}" title="Click row to load ${escHtml(r.opponentName)} + its applied buffs into Card 3">
                            <td>
                                <div class="skill-name">${escHtml(r.opponentName)}</div>
                                ${metaLine}
                            </td>
                            ${buffCellHtml}
                            <td>
                                <div class="def-cmp-main">
                                    <span class="val-a">${fmtInt(r.normalA)}</span><span class="def-cmp-sep">/</span><span class="val-b">${fmtInt(r.normalB)}</span>
                                    <span class="def-cmp-delta ${dCls(r.normalDeltaPct)}">${fmtDeltaPct(r.normalDeltaPct)}</span>
                                </div>
                            </td>
                            <td>
                                <div class="def-cmp-main">
                                    <span class="val-a">${fmtInt(r.critA)}</span><span class="def-cmp-sep">/</span><span class="val-b">${fmtInt(r.critB)}</span>
                                    <span class="def-cmp-delta ${dCls(r.critDeltaPct)}">${fmtDeltaPct(r.critDeltaPct)}</span>
                                </div>
                            </td>
                            <td>
                                <div class="def-cmp-main">
                                    <span class="val-a">${fmtInt(r.expectedA)}</span><span class="def-cmp-sep">/</span><span class="val-b">${fmtInt(r.expectedB)}</span>
                                    <span class="def-cmp-delta ${dCls(r.expectedDeltaPct)}">${fmtDeltaPct(r.expectedDeltaPct)}</span>
                                </div>
                            </td>
                            <td>
                                <div class="def-cmp-main">
                                    <span class="val-a">${fmtDec(r.killProbA, 0)}%</span><span class="def-cmp-sep">/</span><span class="val-b">${fmtDec(r.killProbB, 0)}%</span>
                                </div>
                                ${r.ttkA != null ? `<div class="skill-meta">TTK ${fmtDec(r.ttkA, 1)}s / ${fmtDec(r.ttkB, 1)}s</div>` : ""}
                            </td>
                            <td>${winTxt}</td>
                        </tr>`;
                    }

                    const hpSub = (hpA, hpB) =>
                        hpA != null && hpB != null
                            ? `<div class="skill-meta">${fmtDec(hpA)}% vs ${fmtDec(hpB)}% HP</div>`
                            : "";
                    return `
                    <tr class="skill-row" data-matrix-load="${escHtml(r.opponentId)}" title="Click row to load ${escHtml(r.opponentName)} + its applied buffs into Card 3">
                        <td>
                            <div class="skill-name">${escHtml(r.opponentName)}</div>
                            ${metaLine}
                        </td>
                        ${buffCellHtml}
                        <td>
                            <div class="def-cmp-main">
                                <span class="val-a">${fmtInt(r.normalA)}</span><span class="def-cmp-sep">/</span><span class="val-b">${fmtInt(r.normalB)}</span>
                                <span class="def-cmp-delta ${dCls(r.normalDeltaPct)}">${fmtDeltaPct(r.normalDeltaPct)}</span>
                            </div>
                            ${hpSub(r.normalHpA, r.normalHpB)}
                        </td>
                        <td>
                            <div class="def-cmp-main">
                                <span class="val-a">${fmtInt(r.critA)}</span><span class="def-cmp-sep">/</span><span class="val-b">${fmtInt(r.critB)}</span>
                                <span class="def-cmp-delta ${dCls(r.critDeltaPct)}">${fmtDeltaPct(r.critDeltaPct)}</span>
                            </div>
                            ${hpSub(r.critHpA, r.critHpB)}
                        </td>
                        <td>
                            <div class="def-cmp-main">
                                <span class="val-a">${fmtInt(r.expectedA)}</span><span class="def-cmp-sep">/</span><span class="val-b">${fmtInt(r.expectedB)}</span>
                                <span class="def-cmp-delta ${dCls(r.expectedDeltaPct)}">${fmtDeltaPct(r.expectedDeltaPct)}</span>
                            </div>
                            ${hpSub(r.expectedHpA ?? r.pctHpA, r.expectedHpB ?? r.pctHpB)}
                        </td>
                        <td>${winTxt}</td>
                    </tr>`;
                })
                .join("");

            bodyHtml = `
            <div class="kpi-row">
                <div class="kpi-card">
                    <div class="kpi-label">Overall Roster Advantage (${sum.count} builds)</div>
                    <div class="kpi-value ${dCls(sum.avgExpectedDeltaPct)}">${escHtml(winnerName)} (${fmtDeltaPct(sum.avgExpectedDeltaPct)})</div>
                    <div class="kpi-sub">
                        Avg: <strong class="${dCls(sum.avgExpectedDeltaPct)}">${fmtDeltaPct(sum.avgExpectedDeltaPct)}</strong>
                        &bull; Non-Crit: <strong class="${dCls(sum.avgNormalDeltaPct)}">${fmtDeltaPct(sum.avgNormalDeltaPct)}</strong>
                        &bull; Crit: <strong class="${dCls(sum.avgCritDeltaPct)}">${fmtDeltaPct(sum.avgCritDeltaPct)}</strong>
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Matchup Record (A vs B)</div>
                    <div class="kpi-value"><span class="val-a">${sum.winsA}W</span> &ndash; <span class="val-b">${sum.winsB}L</span>${sum.ties > 0 ? ` <span class="kpi-rate">(${sum.ties}T)</span>` : ""}</div>
                    <div class="kpi-sub">${escHtml(modeDesc)}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Biggest Edges</div>
                    <div class="kpi-value" style="font-size:13.5px">
                        <span class="val-a">Best A:</span> ${sum.bestForA ? `${escHtml(sum.bestForA.opponentName)} (${fmtDeltaPct(sum.bestForA.expectedDeltaPct)})` : "&mdash;"}
                    </div>
                    <div class="kpi-sub">
                        <span class="val-b">Best B:</span> ${sum.bestForB ? `${escHtml(sum.bestForB.opponentName)} (${fmtDeltaPct(sum.bestForB.expectedDeltaPct)})` : "&mdash;"}
                    </div>
                </div>
            </div>

            <div class="table-wrap">
                <table>
                    <thead><tr>${colHeaders}</tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
            <div class="hint-inline" style="margin-top:6px">Tip: Click any row to load that opponent <strong>with its exact matrix buff preset</strong> into the 3rd card so detailed views match 1-to-1.</div>`;
        }
    }

    const comboSelectHtml =
        allMetric === "saved_combo"
            ? `<label class="gs-inline-field" title="Choose auto-matched role combos or evaluate one specific saved combo across every build">
                   Combo
                   <select id="matrixAllComboSel">
                       <option value="__auto__" ${allComboId === "__auto__" ? "selected" : ""}>Auto-Match Role (${savedCombos.length} saved)</option>
                       ${state.rotationSteps.length > 0 ? `<option value="__current__" ${allComboId === "__current__" ? "selected" : ""}>Active Rotation Queue (${state.rotationSteps.length} steps)</option>` : ""}
                       ${savedCombos
                           .map(
                               (c) =>
                                   `<option value="${escHtml(c.id)}" ${allComboId === c.id ? "selected" : ""}>${escHtml(c.label || c.id)} (${c.steps?.length || 0} steps)</option>`
                           )
                           .join("")}
                   </select>
               </label>`
            : "";

    const ROLE_FILTER_OPTS = [
        ["all", "All Roles"],
        ["melee", "Melees"],
        ["mage", "Mages"],
        ["archer", "Archers"],
        ["healer", "Healers"],
        ["tank", "Tanks"],
    ];
    const rowAxisLabel =
        allMetric === "defender_ehp" ? "Defenders" : allMetric === "healing_output" ? "Healers" : "Rows";
    const colAxisLabel =
        allMetric === "defender_ehp" ? "Attackers" : allMetric === "healing_output" ? "Allies" : "Cols";
    const roleFilterControlsHtml = `
        <label class="gs-inline-field" title="Filter which archetypes appear as rows in the N×N matrix">
            ${rowAxisLabel}
            <select id="matrixAllRowRoleSel">
                ${ROLE_FILTER_OPTS.map(([v, l]) => `<option value="${v}" ${rowRoleFilter === v ? "selected" : ""}>${l}</option>`).join("")}
            </select>
        </label>
        <label class="gs-inline-field" title="Filter which archetypes appear as columns in the N×N matrix">
            ${colAxisLabel}
            <select id="matrixAllColRoleSel">
                ${ROLE_FILTER_OPTS.map(([v, l]) => `<option value="${v}" ${colRoleFilter === v ? "selected" : ""}>${l}</option>`).join("")}
            </select>
        </label>`;

    const healSelectHtml =
        allMetric === "healing_output"
            ? `<label class="gs-inline-field" title="Choose a healing skill (defaults to Ode to Recovery per sec for Biggest Ode)">
                   Heal Skill
                   <select id="matrixAllHealSkillSel">
                       ${healSkills
                           .map(
                               (s) =>
                                   `<option value="${escHtml(s.id)}" ${selectedHealSkill?.id === s.id ? "selected" : ""}>${escHtml(s.id === "songcraft_ode_to_recovery" ? "Biggest Ode — Ode to Recovery (per sec)" : s.name)}</option>`
                           )
                           .join("")}
                   </select>
               </label>
               <div class="seg-group" id="matrixAntiHealPills" title="Apply PvP Anti-Heal debuff to all ally targets in the matrix">
                   <button type="button" class="seg-btn ${matrixAntiHealPct === 0 ? "active" : ""}" data-matrix-anti-heal="0">0% Anti-Heal</button>
                   <button type="button" class="seg-btn ${matrixAntiHealPct === -30 ? "active" : ""}" data-matrix-anti-heal="-30" title="Mirror Light (-30% Received Healing)">&minus;30% Mirror</button>
                   <button type="button" class="seg-btn ${matrixAntiHealPct === -60 ? "active" : ""}" data-matrix-anti-heal="-60" title="Stalker's Mark (-60% Received Healing)">&minus;60% Stalker</button>
               </div>
               <label class="def-opt-toggle" title="Quick shortcut: show only Healer builds as rows while keeping selected allies as columns">
                   <input type="checkbox" id="matrixHealersOnlyChk" ${healersOnlyRows || rowRoleFilter === "healer" ? "checked" : ""} />
                   <span>Healers Only</span>
               </label>`
            : "";

    const subControlsHtml = isAllVsAll
        ? `<div class="seg-group" id="matrixAllMetricPills">
               <button type="button" class="seg-btn ${allMetric === "trade_ratio" ? "active" : ""}" data-matrix-all-metric="trade_ratio" title="Antisymmetric 1v1 stat-trade advantage: Row's % HP pressure into Col divided by Col's % HP pressure into Row">1v1 Trade Ratio</button>
               <button type="button" class="seg-btn ${allMetric === "saved_combo" ? "active" : ""}" data-matrix-all-metric="saved_combo" title="Evaluate full saved combos (from combos/combos.json) across every matchup: Kill %, Expected Damage/Heal, % HP & Window DPS">Saved Combos</button>
               <button type="button" class="seg-btn ${allMetric === "signature_skill" ? "active" : ""}" data-matrix-all-metric="signature_skill" title="Real AA Classic signature nuke per role (Arc Lightning / Snipe / Precision Strike / Skewer)">Signature Skill (% HP)</button>
               <button type="button" class="seg-btn ${allMetric === "defender_ehp" ? "active" : ""}" data-matrix-all-metric="defender_ehp" title="Defender (Row) EHP against Attacker (Col)'s primary damage type">Defender EHP</button>
               <button type="button" class="seg-btn ${allMetric === "healing_output" ? "active" : ""}" data-matrix-all-metric="healing_output" title="Biggest Ode &amp; Healing Output: compare Healer (Row) Ode to Recovery / Antithesis / Mend onto every Ally (Col)">Healing Output (Ode)</button>
               <button type="button" class="seg-btn ${allMetric === "selected_skill" ? "active" : ""}" data-matrix-all-metric="selected_skill" title="Evaluate the single selected skill above for every Attacker vs every Defender">Selected Skill</button>
           </div>
           ${comboSelectHtml}
           ${healSelectHtml}
           ${roleFilterControlsHtml}
           <div class="seg-group" id="matrixAllHitPills" title="Compare Expected, Non-Crit, or Crit across the entire N×N grid">
               <button type="button" class="seg-btn ${allHitMode === "expected" ? "active" : ""}" data-matrix-all-hit="expected">Expected</button>
               <button type="button" class="seg-btn ${allHitMode === "normal" ? "active" : ""}" data-matrix-all-hit="normal">Non-Crit</button>
               <button type="button" class="seg-btn ${allHitMode === "crit" ? "active" : ""}" data-matrix-all-hit="crit">Crit</button>
           </div>
           <label class="def-opt-toggle" title="Sort rows and columns by overall average performance in the grid">
               <input type="checkbox" id="matrixSortRankChk" ${state.matrixAllSortByRank ? "checked" : ""} />
               <span>Sort by Rank</span>
           </label>
           <label class="def-opt-toggle" title="Ignore Evasion, Parry, and Shield Block across all N×N matchups">
               <input type="checkbox" id="matrixDisableAvoidChk" ${state.defenderDisableAvoidance ? "checked" : ""} />
               <span>Disable Avoidance</span>
           </label>`
        : `<div class="seg-group" id="matrixModePills">
               <button type="button" class="seg-btn ${mode === "offense_skill" ? "active" : ""}" data-matrix-mode="offense_skill">Offense: Skill</button>
               <button type="button" class="seg-btn ${mode === "offense_rotation" ? "active" : ""}" data-matrix-mode="offense_rotation">Offense: Rotation</button>
               <button type="button" class="seg-btn ${mode === "defense_ehp" ? "active" : ""}" data-matrix-mode="defense_ehp">Defense: EHP</button>
               <button type="button" class="seg-btn ${mode === "defense_skill" ? "active" : ""}" data-matrix-mode="defense_skill">Defense: Incoming Skill</button>
           </div>
           ${
               mode === "defense_ehp"
                   ? `<div class="seg-group" id="matrixEhpKindPills">
                          <button type="button" class="seg-btn ${state.matrixEhpKind === "melee" ? "active" : ""}" data-matrix-ehp="melee">Melee EHP</button>
                          <button type="button" class="seg-btn ${state.matrixEhpKind === "ranged" ? "active" : ""}" data-matrix-ehp="ranged">Ranged EHP</button>
                          <button type="button" class="seg-btn ${state.matrixEhpKind === "magic" ? "active" : ""}" data-matrix-ehp="magic">Magic EHP</button>
                      </div>`
                   : ""
           }
           ${
               isDefense
                   ? `<label class="def-opt-toggle" title="Ignore Evasion, Parry, and Shield Block across all matchups">
                          <input type="checkbox" id="matrixDisableAvoidChk" ${state.defenderDisableAvoidance ? "checked" : ""} />
                          <span>Disable Avoidance</span>
                      </label>`
                   : ""
           }`;

    out.innerHTML = `
        <div class="matrix-controls-box">
            <div class="matrix-bar-top">
                <div class="seg-group" id="matrixScopePills">
                    <button type="button" class="seg-btn ${isAllVsAll ? "active" : ""}" data-matrix-scope="all_vs_all" title="Compare every saved build/class against every other build in an N×N grid (independent of Build A / B)">All vs All (N&times;N Grid)</button>
                    <button type="button" class="seg-btn ${!isAllVsAll ? "active" : ""}" data-matrix-scope="ab_vs_roster" title="Compare Build A vs Build B across every opponent in your roster">Build A vs B (vs Roster)</button>
                </div>
                <label class="gs-inline-field" title="Standardize which buffs apply to every build in the matrix so matchups are apples-to-apples">
                    ${isAllVsAll ? "Build Buffs" : "Opponent Buffs"}
                    <select id="matrixBuffModeSel">${matrixBuffOptionsHtml}</select>
                </label>
                ${
                    overrideCount > 0
                        ? `<button type="button" class="sm" id="matrixResetOverridesBtn" title="Clear all per-build buff overrides">Reset ${overrideCount} Override${overrideCount === 1 ? "" : "s"}</button>`
                        : ""
                }
            </div>
            <div class="matrix-bar-top">${subControlsHtml}</div>
            ${
                unmatchedCount > 0
                    ? `<div class="hint-inline" style="color:#fde68a">&#9888; ${unmatchedCount} build${unmatchedCount === 1 ? " has" : "s have"} no matching saved preset (e.g. Healer/Tank) and are using 0 buffs &mdash; assign a preset in <strong>Roster &amp; Buffs</strong> below or save a matching preset in <strong>Buffs</strong>.</div>`
                    : ""
            }
            <details class="matrix-roster-details">
                <summary>
                    <span>${isAllVsAll ? "Roster &amp; Per-Build Buffs" : "Opponent Roster"} (${activeEntries.length}/${saved.length} selected)</span>
                    <span class="matrix-roster-btns">
                        <input type="text" id="matrixSearchInp" class="matrix-search-inp" value="${escHtml(state.matrixSearch || "")}" placeholder="Filter builds..." />
                        <button type="button" class="sm" id="matrixSelectAllBtn">All</button>
                        <button type="button" class="sm" id="matrixSelectNoneBtn">None</button>
                    </span>
                </summary>
                <div class="matrix-roster-grid">${rosterPillsHtml}</div>
            </details>
        </div>
        ${bodyHtml}
    `;

    // Bind Controls
    out.querySelectorAll("[data-matrix-scope]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.matrixViewScope = btn.dataset.matrixScope;
            ui.renderCharacterCards();
            ui.renderSkillBrowser();
            ui.renderSimulation();
        });
    });
    out.querySelectorAll("[data-matrix-all-metric]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.matrixAllMetric = btn.dataset.matrixAllMetric;
            ui.renderSkillBrowser();
            ui.renderSimulation();
        });
    });
    out.querySelectorAll("[data-matrix-all-hit]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.matrixAllHitMode = btn.dataset.matrixAllHit;
            ui.renderSimulation();
        });
    });
    document.getElementById("matrixAllComboSel")?.addEventListener("change", (e) => {
        state.matrixAllComboId = e.target.value;
        ui.renderSimulation();
    });
    document.getElementById("matrixAllHealSkillSel")?.addEventListener("change", (e) => {
        state.matrixAllHealSkillId = e.target.value;
        ui.renderSimulation();
    });
    document.getElementById("matrixHealersOnlyChk")?.addEventListener("change", (e) => {
        const on = Boolean(e.target.checked);
        state.matrixAllHealersOnly = on;
        state.matrixAllRowRole = on ? "healer" : "all";
        ui.renderSimulation();
    });
    document.getElementById("matrixAllRowRoleSel")?.addEventListener("change", (e) => {
        state.matrixAllRowRole = e.target.value || "all";
        if (state.matrixAllRowRole !== "healer") state.matrixAllHealersOnly = false;
        ui.renderSimulation();
    });
    document.getElementById("matrixAllColRoleSel")?.addEventListener("change", (e) => {
        state.matrixAllColRole = e.target.value || "all";
        ui.renderSimulation();
    });
    out.querySelectorAll("[data-matrix-anti-heal]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.healingAntiHealPct = Number(btn.dataset.matrixAntiHeal) || 0;
            ui.renderSimulation();
        });
    });
    document.getElementById("matrixSortRankChk")?.addEventListener("change", (e) => {
        state.matrixAllSortByRank = Boolean(e.target.checked);
        ui.renderSimulation();
    });
    out.querySelectorAll("[data-matrix-mode]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.matrixMode = btn.dataset.matrixMode;
            ui.renderCharacterCards();
            ui.renderSkillBrowser();
            ui.renderSimulation();
        });
    });
    out.querySelectorAll("[data-matrix-ehp]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.matrixEhpKind = btn.dataset.matrixEhp;
            ui.renderSimulation();
        });
    });
    document.getElementById("matrixBuffModeSel")?.addEventListener("change", (e) => {
        state.matrixBuffMode = e.target.value;
        saveMatrixBuffPrefs();
        ui.renderSimulation();
    });
    document.getElementById("matrixResetOverridesBtn")?.addEventListener("click", () => {
        state.matrixOppBuffOverrides = {};
        saveMatrixBuffPrefs();
        ui.renderSimulation();
    });
    document.getElementById("matrixDisableAvoidChk")?.addEventListener("change", (e) => {
        state.defenderDisableAvoidance = Boolean(e.target.checked);
        ui.updateBuffedStatsPanel("A");
        ui.updateBuffedStatsPanel("B");
        ui.updateBuffedStatsPanel("defender");
        ui.renderSimulation();
    });

    const searchInp = document.getElementById("matrixSearchInp");
    if (searchInp) {
        searchInp.addEventListener("click", (e) => e.stopPropagation());
        searchInp.addEventListener("input", () => {
            state.matrixSearch = searchInp.value;
            ui.renderSimulation();
        });
    }
    document.getElementById("matrixSelectAllBtn")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.matrixSelectedIds = new Set(saved.map((b) => b.savedId || b.name));
        ui.renderSimulation();
    });
    document.getElementById("matrixSelectNoneBtn")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.matrixSelectedIds = new Set();
        ui.renderSimulation();
    });

    out.querySelectorAll("[data-matrix-opp]").forEach((cb) => {
        cb.addEventListener("change", () => {
            const nextSet = new Set(selectedSet);
            const id = cb.dataset.matrixOpp;
            if (cb.checked) nextSet.add(id);
            else nextSet.delete(id);
            state.matrixSelectedIds = nextSet;
            ui.renderSimulation();
        });
    });

    out.querySelectorAll("[data-matrix-row-buff]").forEach((sel) => {
        sel.addEventListener("click", (e) => e.stopPropagation());
        sel.addEventListener("change", (e) => {
            e.stopPropagation();
            const oppId = sel.dataset.matrixRowBuff;
            const val = sel.value;
            if (!state.matrixOppBuffOverrides) state.matrixOppBuffOverrides = {};
            if (val === "__matrix__") delete state.matrixOppBuffOverrides[oppId];
            else state.matrixOppBuffOverrides[oppId] = val;
            saveMatrixBuffPrefs();
            ui.renderSimulation();
        });
    });

    // Click an N×N cell -> load Attacker Row into Build A & Defender Col into Target (Card 3) with their exact matrix buffs
    out.querySelectorAll("[data-nxn-att]").forEach((td) => {
        td.addEventListener("click", () => {
            const attId = td.dataset.nxnAtt;
            const defId = td.dataset.nxnDef;
            const attBuild = buildById.get(attId);
            const defBuild = buildById.get(defId);
            if (!attBuild || !defBuild) return;
            const attBuffs = resolvedByOppId.get(attId);
            const defBuffs = resolvedByOppId.get(defId);

            ui.applySavedBuildToSlot("A", attBuild);
            if (attBuffs) {
                setSlotModifiersFromTokens("A", attBuffs.tokens);
                state.consumables.A = { ...attBuffs.consumables };
            }
            ui.applySavedBuildToSlot("defender", defBuild);
            if (defBuffs) {
                setSlotModifiersFromTokens("defender", defBuffs.tokens);
                state.consumables.defender = { ...defBuffs.consumables };
            }
            ui.renderCharacterCards();
            ui.renderSimulation();
            showToast(`Loaded 1v1: ${attBuild.name} (Build A) vs ${defBuild.name} (Target) with applied presets`, "ok");
        });
    });

    // Click a Build A vs B row -> load opponent into Card 3 with exact applied buffs
    out.querySelectorAll("[data-matrix-load]").forEach((tr) => {
        tr.addEventListener("click", (e) => {
            if (e.target.closest("select, button, input")) return;
            const id = tr.dataset.matrixLoad;
            const found = buildById.get(id);
            if (!found) return;
            const resolved = resolvedByOppId.get(id);
            ui.applySavedBuildToSlot("defender", found);
            if (resolved) {
                setSlotModifiersFromTokens("defender", resolved.tokens);
                state.consumables.defender = { ...resolved.consumables };
            }
            ui.renderCharacterCards();
            ui.renderSimulation();
            showToast(
                `Loaded "${found.name}" into 3rd card${resolved ? ` with ${resolved.label} (${resolved.count} buffs)` : ""}`,
                "ok"
            );
        });
    });
}
