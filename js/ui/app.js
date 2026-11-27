/**
 * Application bootstrap, mode routing, and global modal/event wiring.
 * Feature rendering lives in dedicated view modules (characterCards, skillBrowser,
 * buildStore, skillsView, rotationView, defenderView, sweepView, matrixView, etc.).
 */

import {
    getTotalPointsSpent,
    initSkillBuilderData,
    registerItemSpecialEffects,
    syncSkillBreakdownAncestralsFromBuilder,
} from "../engine/index.js";
import {
    fetchDaruGearBuild,
    getDaruGearBookmarkletHref,
    normalizeBuildMetadata,
    parseImportPayload,
} from "../adapters/darugear.js";
import {
    applyCategoryDefaultLoadoutToSlot,
    buildCustomSkill,
    cloneBuildSlot,
    escHtml,
    fmtInt,
    getActiveSkillObject,
    getMatchingSkills,
    getSlotChipTokens,
    loadBuffLoadoutsFromDisk,
    loadGearTemplatesFromDisk,
    loadSkillBuildsFromDisk,
    saveActiveMode,
    setSlotChar,
    setSlotModifiersFromTokens,
    showToast,
    state,
    ui,
} from "./state.js";
import {
    applySavedBuildToSlot,
    createBlankBuildForSlot,
    hydrateDefaultSlotsFromDisk,
    importAndUnbakeDaruGearBuffs,
    loadSavedBuilds,
    saveBuildToStore,
} from "./buildStore.js";
import {
    renderBuildDiffStrip,
    renderCharacterCards,
    updateBuffedStatsPanel,
} from "./characterCards.js";
import {
    renderComboStatusBar,
    renderSkillBrowser,
    syncSweepStatToSkill,
} from "./skillBrowser.js";
import { renderBuildComparison } from "./skillsView.js";
import { renderDefenderComparison } from "./defenderView.js";
import { renderSweepView } from "./sweepView.js";
import {
    closeRotSkillPickerModal,
    loadRotationsFromDisk,
    persistRotationState,
    renderRotationView,
    renderRotSkillPicker,
    renderRotSkillPickerQueue,
} from "./rotationView.js";
import {
    closeBuffPullModal,
    closeImportModal,
    handleFetchBuffById,
    handleSavePulledBuff,
    loadCustomBuffs,
    openBuffPullModal,
    openImportModal,
} from "./modals.js";
import { renderMatrixView } from "./matrixView.js";
import { renderGearBuilderView } from "./gearBuilderView.js";
import { bindSettingsModalEvents, closeSettingsModal, syncStaticModeControls } from "./settingsModal.js";
import { renderSkillBuilderView } from "./skillBuilderView.js";
import { loadEconomyPriceBookFromDisk, renderEconomyView } from "./economyView.js";
import { applyComparisonPermalinkFromHash, buildComparisonPermalink } from "./permalink.js";

// ============================================================================
// Data Loading
// ============================================================================
async function loadGameData() {
    const [idxRes, sbRes, spRes] = await Promise.all([
        fetch("js/data/skills/index.json", { cache: "no-store" }),
        fetch("js/data/skill_builder_data.json", { cache: "no-store" }).catch(() => null),
        fetch("js/data/gear_catalog/item_special_effects.json", { cache: "no-store" }).catch(() => null),
    ]);
    if (sbRes && sbRes.ok) {
        try {
            initSkillBuilderData(await sbRes.json());
        } catch {
            // Keep skill builder gracefully disabled if dataset fails to parse
        }
    }
    if (spRes && spRes.ok) {
        try {
            registerItemSpecialEffects(await spRes.json());
        } catch {
            // Fall back gracefully to built-in T7 special effects if dataset fails to parse
        }
    }
    const idx = await idxRes.json();
    state.skillsetsMeta = idx.skillsets || [];
    state.hasRankDump = Boolean(idx.hasRankDump);

    const treeDatas = await Promise.all(
        state.skillsetsMeta.map((s) =>
            fetch(`js/data/skills/${s.file}`, { cache: "no-store" }).then((r) => r.json())
        )
    );

    state.skillsByTree = {};
    state.allSkills = [];
    for (const td of treeDatas) {
        state.skillsByTree[td.skillset] = td.skills;
        state.allSkills.push(...td.skills);
    }
    syncSkillBreakdownAncestralsFromBuilder(state.allSkills);

    renderSkillBrowser();
}

// ============================================================================
// Combat Context Visibility & Mode Dispatch
// ============================================================================
function updateCombatControlsVisibility() {
    const bar = document.getElementById("contextControls");
    if (!bar) return;
    if (
        state.mode === "rotation" ||
        state.mode === "gearbuilder" ||
        state.mode === "skillbuilder" ||
        state.mode === "economy" ||
        (state.mode === "matrix" &&
            (state.matrixViewScope === "all_vs_all"
                ? state.matrixAllMetric !== "selected_skill"
                : state.matrixMode === "offense_rotation"))
    ) {
        bar.classList.add("hidden");
        return;
    }
    bar.classList.remove("hidden");

    const matching = getMatchingSkills();
    const activeSkill = state.isCustomSkill ? buildCustomSkill() : getActiveSkillObject(matching);
    const isAllScope = state.scope === "all" && state.mode !== "sweep";
    const isHealMode = state.mode === "healing" || activeSkill?.kind === "heal";

    const setCtrlVisible = (inputId, visible) => {
        const el = document.getElementById(inputId);
        const wrap = el?.closest(".control-item");
        if (wrap) wrap.classList.toggle("hidden", !visible);
    };

    const usesBloodthirst =
        !isHealMode &&
        (activeSkill?.parseSource === "shadowsmite" ||
            Boolean(activeSkill?.flags?.bloodthirstBasePerStack) ||
            String(activeSkill?.id || "").includes("throw_dagger") ||
            String(activeSkill?.id || "") === "shadowplay_wallop" ||
            (isAllScope && (state.selectedTree === "all" || state.selectedTree === "shadowplay")));

    const usesMettle =
        Boolean(activeSkill?.flags?.mettleScalePct) ||
        String(activeSkill?.id || "").includes("boastful_roar") ||
        (isAllScope && (state.selectedTree === "all" || state.selectedTree === "defense"));

    const usesWithin8m =
        !isHealMode &&
        (Boolean(activeSkill?.flags?.rangePenaltyBelow8mPct) ||
            (isAllScope && (state.selectedTree === "all" || state.selectedTree === "archery")));

    const usesBelow30 =
        !isHealMode &&
        (Boolean(activeSkill?.flags?.executeCritRateBonusPct) || isAllScope);

    setCtrlVisible("ctxBackstab", !isHealMode);
    setCtrlVisible("ctxCC", !isHealMode);
    setCtrlVisible("ctxWithin8m", usesWithin8m);
    setCtrlVisible("ctxBelow30", usesBelow30);
    setCtrlVisible("ctxBloodthirst", usesBloodthirst);
    setCtrlVisible("ctxMettle", usesMettle);
}

const MODE_RENDERERS = {
    skills: renderBuildComparison,
    healing: renderBuildComparison,
    rotation: renderRotationView,
    defender: renderDefenderComparison,
    sweep: renderSweepView,
    matrix: renderMatrixView,
    gearbuilder: renderGearBuilderView,
    skillbuilder: renderSkillBuilderView,
    economy: renderEconomyView,
};

function renderSimulation() {
    renderBuildDiffStrip();
    updateCombatControlsVisibility();
    renderComboStatusBar();
    const out = document.getElementById("simOutput");
    if (state.allSkills.length === 0) {
        out.innerHTML = "<p>Loading skill data...</p>";
        return;
    }

    const renderer = MODE_RENDERERS[state.mode];
    if (renderer) renderer(out);
}

// ============================================================================
// Event Wiring Helpers
// ============================================================================
function registerUiBridge() {
    ui.renderCharacterCards = renderCharacterCards;
    ui.renderSimulation = renderSimulation;
    ui.renderSkillBrowser = renderSkillBrowser;
    ui.updateBuffedStatsPanel = updateBuffedStatsPanel;
    ui.openImportModal = openImportModal;
    ui.closeImportModal = closeImportModal;
    ui.openBuffPullModal = openBuffPullModal;
    ui.closeBuffPullModal = closeBuffPullModal;
    ui.applySavedBuildToSlot = applySavedBuildToSlot;
    ui.importAndUnbakeDaruGearBuffs = importAndUnbakeDaruGearBuffs;
    ui.loadSavedBuilds = loadSavedBuilds;
    ui.loadCustomBuffs = loadCustomBuffs;
    ui.hydrateDefaultSlotsFromDisk = hydrateDefaultSlotsFromDisk;
}

function bindBookmarkletButtons() {
    const href = getDaruGearBookmarkletHref();
    const bmLink = document.getElementById("bookmarkletLink");
    bmLink.setAttribute("href", href);
    bmLink.addEventListener("click", (e) => {
        e.preventDefault();
        alert("Drag this button up to your browser bookmarks bar, then click it while viewing any build on darugear.com!");
    });
    document.getElementById("copyBookmarkletBtn").addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(href);
            alert("Bookmarklet URL copied! Create a new bookmark and paste this as its URL.");
        } catch {
            prompt("Copy bookmarklet URL:", href);
        }
    });
}

function bindModeAndSkillControls() {
    // Sync initial mode tab & controls from persisted mode
    document.querySelectorAll(".mode-tab").forEach((t) => {
        t.classList.toggle("active", t.dataset.mode === state.mode);
    });
    document.getElementById("sweepControls").classList.toggle("hidden", state.mode !== "sweep");
    if (state.mode === "healing") {
        document.getElementById("customSkillKind").value = "heal";
    }

    document.querySelectorAll(".mode-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".mode-tab").forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");
            state.mode = tab.dataset.mode;
            saveActiveMode(state.mode);

            document.getElementById("sweepControls").classList.toggle("hidden", state.mode !== "sweep");

            if (state.mode === "healing") {
                document.getElementById("customSkillKind").value = "heal";
            } else if (document.getElementById("customSkillKind").value === "heal") {
                document.getElementById("customSkillKind").value = "physical_melee";
            }

            renderSkillBrowser();
            if (state.mode === "sweep" && !state.isCustomSkill) {
                syncSweepStatToSkill(getActiveSkillObject(getMatchingSkills()));
            }
            renderCharacterCards();
            renderSimulation();
        });
    });

    // Search input (instant cross-tree search)
    const searchInput = document.getElementById("skillSearch");
    const clearSearchBtn = document.getElementById("clearSearchBtn");
    searchInput.addEventListener("input", () => {
        state.searchQuery = searchInput.value;
        state.isCustomSkill = false;
        clearSearchBtn.classList.toggle("hidden", !state.searchQuery);
        renderSkillBrowser();
        renderSimulation();
    });
    clearSearchBtn.addEventListener("click", () => {
        state.searchQuery = "";
        searchInput.value = "";
        clearSearchBtn.classList.add("hidden");
        renderSkillBrowser();
        renderSimulation();
        searchInput.focus();
    });

    // Variant filter segmented buttons
    document.querySelectorAll("#variantPills .seg-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.selectedVariant = btn.dataset.variant;
            state.isCustomSkill = false;
            renderSkillBrowser();
            renderSimulation();
        });
    });

    // Scope toggle (Selected Skill vs Compare All)
    document.querySelectorAll("#scopePills .seg-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.scope = btn.dataset.scope;
            renderSkillBrowser();
            renderSimulation();
        });
    });

    // Back to skill list from Custom Skill editor
    document.getElementById("backToSkillsBtn").addEventListener("click", () => {
        state.isCustomSkill = false;
        renderSkillBrowser();
        renderSimulation();
    });

    // Combat context, custom skill, and sweep controls
    const contextInputIds = [
        "ctxBackstab",
        "ctxCC",
        "ctxWithin8m",
        "ctxBelow30",
        "ctxPvE",
        "ctxSecondaryEffects",
        "ctxComboPct",
        "ctxBloodthirst",
        "ctxMettle",
        "customSkillName",
        "customSkillKind",
        "customSkillBase",
        "customSkillPct",
        "customSkillHits",
        "customSkillUnavoidable",
        "sweepStat",
        "sweepMetric",
        "sweepStart",
        "sweepEnd",
        "sweepStep",
    ];
    for (const id of contextInputIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.addEventListener("change", () => {
            if (id === "ctxBackstab" || id === "ctxCC" || id === "ctxPvE") {
                updateBuffedStatsPanel("A", false);
                updateBuffedStatsPanel("B", false);
                updateBuffedStatsPanel("defender", false);
            }
            renderSimulation();
        });
        if (el.type === "number" || el.type === "text") {
            el.addEventListener("input", renderSimulation);
        }
    }
}

function bindImportModalEvents() {
    document.getElementById("importCancelBtn").addEventListener("click", closeImportModal);
    document.getElementById("importModal").addEventListener("click", (e) => {
        if (e.target.id === "importModal") closeImportModal();
    });
    document.getElementById("importCreateBlankBtn")?.addEventListener("click", async () => {
        const slot = state.importSlot || "A";
        const nameInput = document.getElementById("importNameInput");
        const saveChk = document.getElementById("importSaveDiskCheck");
        const fb = document.getElementById("importFeedback");
        let cleanName = (nameInput?.value || "").trim();
        if (!cleanName) {
            const prompted = prompt("Name for the new blank character build:", "New Character");
            if (prompted === null) return;
            cleanName = String(prompted).trim();
        }
        if (!cleanName) {
            if (fb) fb.innerHTML = `<div class="msg-error">Please enter a build name.</div>`;
            return;
        }
        try {
            closeImportModal();
            await createBlankBuildForSlot(slot, {
                name: cleanName,
                saveToStore: saveChk ? Boolean(saveChk.checked) : true,
                openGearBuilder: true,
            });
        } catch (err) {
            showToast(`Could not create blank build: ${err.message || err}`, "err");
        }
    });

    const fileInput = document.getElementById("importFileInput");
    document.getElementById("importFileBtn").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const fb = document.getElementById("importFeedback");
        try {
            const text = await file.text();
            document.getElementById("importTextarea").value = text;
            const parsed = parseImportPayload(text);
            const nameInput = document.getElementById("importNameInput");
            const dgInput = document.getElementById("importDarugearInput");
            if (parsed.ok) {
                if (!nameInput.value.trim()) {
                    nameInput.value = parsed.character.name || file.name.replace(/\.(json|txt)$/i, "");
                }
                const meta = normalizeBuildMetadata(parsed.character);
                if (meta.darugearUrl && !dgInput.value.trim()) {
                    dgInput.value = meta.darugearUrl;
                }
            }
            fb.innerHTML = `<div class="msg-ok">Loaded file <code>${escHtml(file.name)}</code>. Click <strong>Import Build</strong> to apply.</div>`;
        } catch (err) {
            fb.innerHTML = `<div class="msg-error">Failed to read file: ${escHtml(err.message)}</div>`;
        }
    });

    document.getElementById("importTextarea").addEventListener("input", () => {
        const raw = document.getElementById("importTextarea").value.trim();
        if (!raw.startsWith("{")) return;
        const parsed = parseImportPayload(raw);
        if (!parsed.ok) return;
        const dgInput = document.getElementById("importDarugearInput");
        const meta = normalizeBuildMetadata(parsed.character);
        if (meta.darugearUrl && !dgInput.value.trim()) {
            dgInput.value = meta.darugearUrl;
        }
    });

    const handleFetchDaruGearUrlIntoModal = async () => {
        const dgInput = document.getElementById("importDarugearInput");
        const nameInput = document.getElementById("importNameInput");
        const ta = document.getElementById("importTextarea");
        const fb = document.getElementById("importFeedback");
        const btn = document.getElementById("importFetchDgBtn");
        const rawUrl = (dgInput?.value || "").trim() || (ta?.value || "").trim();
        if (!rawUrl) {
            fb.innerHTML = `<div class="msg-error">Paste a DaruGear URL (https://darugear.com/?s=...) or share code first.</div>`;
            return null;
        }
        if (btn) btn.disabled = true;
        fb.innerHTML = `<div class="hint-inline">Fetching gear, stats, buffs &amp; skills from DaruGear...</div>`;
        try {
            const fetched = await fetchDaruGearBuild(rawUrl);
            if (!fetched.ok) {
                fb.innerHTML = `<div class="msg-error">${escHtml(fetched.error || "Failed to fetch DaruGear build")}</div>`;
                return null;
            }
            if (ta && fetched.rawExport) ta.value = JSON.stringify(fetched.rawExport, null, 2);
            if (nameInput && !nameInput.value.trim()) nameInput.value = fetched.character.name || "";
            if (dgInput && fetched.character.darugearUrl) dgInput.value = fetched.character.darugearUrl;
            const eqCnt = fetched.character.equipment?.length || 0;
            const sbPts = fetched.character.skillBuild ? getTotalPointsSpent(fetched.character.skillBuild) : 0;
            const cls = fetched.character.className || "Build";
            fb.innerHTML = `<div class="msg-ok">Fetched <strong>${escHtml(cls)}</strong> (${fmtInt(fetched.character.gearScore)} GS, ${eqCnt} gear, ${sbPts} skill pts) from DaruGear! Click <strong>Import Build</strong> to apply.</div>`;
            return fetched;
        } finally {
            if (btn) btn.disabled = false;
        }
    };

    document.getElementById("importFetchDgBtn")?.addEventListener("click", handleFetchDaruGearUrlIntoModal);
    document.getElementById("importDarugearInput")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleFetchDaruGearUrlIntoModal();
        }
    });

    document.getElementById("importApplyBtn").addEventListener("click", async () => {
        const slot = state.importSlot;
        const raw = document.getElementById("importTextarea").value.trim();
        const customName = document.getElementById("importNameInput").value.trim();
        const customDarugearUrl = document.getElementById("importDarugearInput").value.trim();
        const saveToDisk = document.getElementById("importSaveDiskCheck").checked;
        const fb = document.getElementById("importFeedback");

        let res = null;
        if (!raw && customDarugearUrl) {
            res = await handleFetchDaruGearUrlIntoModal();
            if (!res) return;
        } else if (raw && !raw.startsWith("{") && (/darugear\.com/i.test(raw) || /^[A-Za-z0-9_-]{4,16}$/.test(raw))) {
            document.getElementById("importDarugearInput").value = raw;
            res = await handleFetchDaruGearUrlIntoModal();
            if (!res) return;
        } else {
            res = parseImportPayload(raw);
        }
        if (!res.ok) {
            fb.innerHTML = `<div class="msg-error">${escHtml(res.error)}</div>`;
            return;
        }
        if (customName) res.character.name = customName;

        const metaSource = customDarugearUrl
            ? {
                  ...res.character,
                  shareUrl: customDarugearUrl,
                  darugearUrl: customDarugearUrl,
                  shareCode: null,
                  metadata: {
                      ...(res.character.metadata || {}),
                      darugearUrl: customDarugearUrl,
                      shareCode: null,
                  },
              }
            : res.character;
        const meta = normalizeBuildMetadata(metaSource);
        if (!customDarugearUrl && !meta.importedAt) meta.importedAt = new Date().toISOString();
        res.character.metadata = meta;
        res.character.shareUrl = meta.darugearUrl;
        res.character.darugearUrl = meta.darugearUrl;
        res.character.shareCode = meta.shareCode;

        const syncRes = await importAndUnbakeDaruGearBuffs(
            res.character,
            res.modifiers || [],
            res.consumables || {}
        );
        res.character = syncRes.character;
        if (syncRes.warnings.length > 0) res.warnings.push(...syncRes.warnings);

        setSlotChar(slot, res.character);
        if (res.modifiers || syncRes.tokens.length > 0) setSlotModifiersFromTokens(slot, syncRes.tokens);
        if (res.consumables || Object.keys(syncRes.consumables).length > 0) {
            state.consumables[slot] = { ...syncRes.consumables };
        }
        const catApplied = applyCategoryDefaultLoadoutToSlot(slot);

        const unbakeNote =
            (syncRes.unbakedNames.length > 0 ? ` • imported & unbaked ${syncRes.unbakedNames.join(", ")}` : "") +
            (catApplied.applied ? ` • applied ${catApplied.category} default buffs (${catApplied.label})` : "");

        let saveNote = "";
        if (saveToDisk) {
            try {
                const saved = await saveBuildToStore(
                    res.character,
                    getSlotChipTokens(slot),
                    state.consumables[slot] || {}
                );
                state.loadedSavedId[slot] = saved.id;
                saveNote =
                    saved.mode === "disk"
                        ? `Saved to ${saved.filename}${unbakeNote}`
                        : `Saved "${res.character.name}" to browser storage${unbakeNote}`;
            } catch (err) {
                fb.innerHTML = `<div class="msg-warn">Imported build, but failed to save: ${escHtml(err.message)}</div>`;
                renderCharacterCards();
                renderSimulation();
                return;
            }
        } else {
            state.loadedSavedId[slot] = res.savedId || null;
            if (unbakeNote) saveNote = `Imported ${res.character.name}${unbakeNote}`;
            if (state.diskApiAvailable && Array.isArray(res.character.equipment) && res.character.equipment.length > 0) {
                fetch("/api/icons/cache", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ equipment: res.character.equipment }),
                })
                    .then(() => renderCharacterCards())
                    .catch(() => {});
            }
        }

        renderCharacterCards();
        renderSimulation();
        if (res.warnings.length > 0) {
            fb.innerHTML = `<div class="msg-ok">Imported ${escHtml(res.character.name)}!${saveNote ? ` (${escHtml(saveNote)})` : ""}</div><div class="msg-warn">${escHtml(res.warnings.join(" "))}</div>`;
        } else {
            closeImportModal();
            if (saveNote) showToast(saveNote, "ok");
        }
    });
}

function bindAuxiliaryModalEvents() {
    // Buff Pull Modal
    document.getElementById("openBuffPullBtn").addEventListener("click", () => openBuffPullModal());
    document.getElementById("buffCancelBtn").addEventListener("click", closeBuffPullModal);
    document.getElementById("buffImportModal").addEventListener("click", (e) => {
        if (e.target.id === "buffImportModal") closeBuffPullModal();
    });
    document.getElementById("buffFetchBtn").addEventListener("click", handleFetchBuffById);
    document.getElementById("buffIdInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleFetchBuffById();
        }
    });
    document.getElementById("buffSaveBtn").addEventListener("click", handleSavePulledBuff);

    // Rotation Skill Picker Modal
    document.getElementById("rotPickerDoneBtn").addEventListener("click", closeRotSkillPickerModal);
    document.getElementById("rotSkillPickerModal").addEventListener("click", (e) => {
        if (e.target.id === "rotSkillPickerModal") closeRotSkillPickerModal();
    });
    document.getElementById("rotPickerSearch").addEventListener("input", (e) => {
        state.rotPickerQuery = e.target.value;
        renderRotSkillPicker();
    });
    document.querySelectorAll("#rotPickerVariantPills .seg-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.rotPickerVariant = btn.dataset.rpVariant;
            renderRotSkillPicker();
        });
    });
    document.getElementById("rotPickerUndoBtn").addEventListener("click", () => {
        if (state.rotationSteps.length === 0) return;
        state.rotationSteps.pop();
        persistRotationState();
        renderSimulation();
        renderRotSkillPickerQueue();
    });

    // Topbar share link, compact toggle & Settings Modal
    document.getElementById("copyShareLinkBtn")?.addEventListener("click", async () => {
        const url = buildComparisonPermalink();
        const hashIdx = url.indexOf("#");
        if (hashIdx !== -1 && window.history?.replaceState) {
            window.history.replaceState(null, "", url.slice(hashIdx));
        }
        try {
            await navigator.clipboard.writeText(url);
            showToast("Copied shareable comparison link to clipboard!", "ok");
        } catch {
            prompt("Copy shareable comparison link:", url);
        }
    });
    document.getElementById("toggleCompactBuildsBtn")?.addEventListener("click", () => {
        state.buildsCollapsed = !state.buildsCollapsed;
        renderCharacterCards();
    });
    bindSettingsModalEvents();

    // Global capture-phase image fallback handler (replaces inline onerror= for strict CSP)
    document.addEventListener(
        "error",
        (e) => {
            const img = e.target;
            if (!img || img.tagName !== "IMG") return;
            const fbMode = img.dataset?.imgFb;
            if (!fbMode) return;
            img.style.display = "none";
            if (fbMode === "next" && img.nextElementSibling) {
                img.nextElementSibling.style.display = "flex";
            }
        },
        true
    );

    // Global click-outside dropdown close, Escape modal dismissal & `/` skill search shortcut
    document.addEventListener("click", (e) => {
        document.querySelectorAll("details.card-menu[open], details.topbar-menu[open]").forEach((det) => {
            if (!det.contains(e.target)) det.open = false;
        });
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            if (document.getElementById("importModal")?.classList.contains("open")) closeImportModal();
            if (document.getElementById("buffImportModal")?.classList.contains("open")) closeBuffPullModal();
            if (document.getElementById("rotSkillPickerModal")?.classList.contains("open")) closeRotSkillPickerModal();
            if (document.getElementById("settingsModal")?.classList.contains("open")) closeSettingsModal();
            return;
        }
        if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const tag = String(document.activeElement?.tagName || "").toUpperCase();
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable) {
                return;
            }
            const searchEl = document.getElementById("skillSearch");
            const browserEl = document.getElementById("skillBrowser");
            if (searchEl && browserEl && !browserEl.classList.contains("hidden")) {
                e.preventDefault();
                searchEl.focus();
                searchEl.select();
            }
        }
    });

    window.addEventListener("hashchange", async () => {
        const res = await applyComparisonPermalinkFromHash();
        if (res.applied) {
            renderSkillBrowser();
            renderCharacterCards();
            renderSimulation();
            showToast("Loaded comparison from share link", "ok");
        }
    });
}

// ============================================================================
// Styled Dark-Mode Number Input Steppers (replaces native OS up/down arrows)
// ============================================================================
function initNumberSteppers() {
    const enhanceInput = (inp) => {
        if (!inp || inp.type !== "number") return;
        if (inp.dataset.noStepper === "true" || inp.classList.contains("gb-mig-inp")) return;
        if (inp.parentElement?.classList.contains("num-spin-wrap")) return;
        if (!inp.parentNode) return;

        const wrap = document.createElement("span");
        wrap.className = "num-spin-wrap";
        if (
            inp.classList.contains("econ-matrix-inp") ||
            inp.closest(".settings-field") ||
            inp.closest(".custom-skill-form") ||
            inp.closest(".modal-form")
        ) {
            wrap.classList.add("is-block");
        }

        const btns = document.createElement("span");
        btns.className = "num-spin-btns";

        const makeBtn = (dir, glyph, aria) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = `num-spin-btn ${dir > 0 ? "num-spin-up" : "num-spin-down"}`;
            b.tabIndex = -1;
            b.setAttribute("aria-label", aria);
            b.innerHTML = glyph;
            b.addEventListener("mousedown", (e) => e.preventDefault());
            b.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (inp.disabled || inp.readOnly) return;
                const stepAttr = inp.getAttribute("step");
                const step =
                    stepAttr && stepAttr !== "any" && Number.isFinite(parseFloat(stepAttr))
                        ? parseFloat(stepAttr)
                        : 1;
                const min = inp.min !== "" && Number.isFinite(parseFloat(inp.min)) ? parseFloat(inp.min) : -Infinity;
                const max = inp.max !== "" && Number.isFinite(parseFloat(inp.max)) ? parseFloat(inp.max) : Infinity;
                const cur = Number.isFinite(parseFloat(inp.value)) ? parseFloat(inp.value) : 0;
                let next = Math.round((cur + dir * step) * 1e6) / 1e6;
                if (next < min) next = min;
                if (next > max) next = max;
                inp.value = String(next);
                inp.dispatchEvent(new Event("input", { bubbles: true }));
                inp.dispatchEvent(new Event("change", { bubbles: true }));
            });
            return b;
        };

        btns.appendChild(makeBtn(1, "&#9652;", "Increase value"));
        btns.appendChild(makeBtn(-1, "&#9662;", "Decrease value"));

        inp.parentNode.insertBefore(wrap, inp);
        wrap.appendChild(inp);
        wrap.appendChild(btns);
    };

    const scanNode = (root) => {
        if (!root || root.nodeType !== 1) return;
        if (root.matches?.('input[type="number"]')) {
            enhanceInput(root);
        }
        root.querySelectorAll?.('input[type="number"]').forEach(enhanceInput);
    };

    scanNode(document.body);
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === 1 && !node.classList?.contains("num-spin-wrap")) {
                    scanNode(node);
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// ============================================================================
// Bootstrap
// ============================================================================
async function init() {
    initNumberSteppers();
    registerUiBridge();
    bindBookmarkletButtons();
    bindModeAndSkillControls();
    bindImportModalEvents();
    bindAuxiliaryModalEvents();

    // Resolve game data & server capability (serve.py vs static host) first so static mode
    // skips /api/* probes and cleanly disables server-only features on startup.
    await Promise.all([loadGameData(), loadSavedBuilds()]);
    syncStaticModeControls();
    await Promise.all([
        loadCustomBuffs(),
        loadRotationsFromDisk(),
        loadBuffLoadoutsFromDisk(),
        loadGearTemplatesFromDisk(),
        loadSkillBuildsFromDisk(),
        loadEconomyPriceBookFromDisk(),
    ]);
    hydrateDefaultSlotsFromDisk();
    const linkRes = await applyComparisonPermalinkFromHash();
    renderSkillBrowser();
    renderCharacterCards();
    renderSimulation();
    if (linkRes.applied) {
        showToast("Loaded shared comparison from URL link", "ok");
    }
}

init();
