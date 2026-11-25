/**
 * Settings Modal, Preferences, Formula Overrides, Workspace Backup & Live DaruGear Sync Controller:
 *  - Display & Rounding (Advanced Options, Off-Spec tile filter, Exact vs Abbreviated numbers,
 *    Decimal places, Defender Primary Metric)
 *  - Archetype / Category Default Buff Loadouts (Melee, Mage, Archer, Healer, Tank)
 *  - Live Combat Formula Overrides (Defense/Toughness/Resilience K, Focus, Block Mult, Max Crit,
 *    Additive vs Multiplicative Avoidance Model) + 1-click Reset to AA Classic 3.5 Defaults
 *  - Workspace Full Backup Export & Restore (.json)
 *  - Live DaruGear Resync (Gear Catalog, Skills, Saved Builds, Resync All)
 */

import {
    APP_VERSION,
    ARMOR_TYPES,
    BUILD_CATEGORIES,
    COMBAT_MODIFIERS,
    DEFAULT_CONSTANTS,
    initSkillBuilderData,
    registerCustomModifiers,
    reloadGearCatalog,
    syncSkillBreakdownAncestralsFromBuilder,
} from "../engine/index.js";
import {
    extractDaruGearShareCode,
    fetchDaruGearBuild,
    normalizeBuildMetadata,
    normalizeEquipmentList,
} from "../adapters/darugear.js";
import {
    applyCategoryDefaultLoadoutToSlot,
    escHtml,
    getAllBuildCategories,
    getSlotChar,
    loadBuffLoadoutsFromDisk,
    loadDeletedBuffIdsFromLocalStorage,
    loadDeletedBuildIdsFromLocalStorage,
    normalizeSimSettings,
    persistActiveCustomBuffsToLocalStorage,
    persistDeletedBuffIdsToLocalStorage,
    persistDeletedBuildIdsToLocalStorage,
    persistSavedBuildsToLocalStorage,
    saveCustomBuffLoadouts,
    saveSimSettings,
    setSlotChar,
    showToast,
    slugifyCategoryId,
    state,
    ui,
} from "./state.js";
import {
    loadEconomyAhPricesFromDisk,
    loadEconomyPriceBookFromStorage,
    saveEconomyPriceBook,
} from "./economyView.js";
import { loadRotationsFromDisk, syncRotationsToDisk } from "./rotationView.js";

let _syncBusy = false;
let _lastStatus = null;
let _activeSettingsTab = "general";

const FORMULA_FIELD_SPECS = [
    { inputId: "settingsFormulaDefenseK", key: "defenseK", min: 100, max: 100000 },
    { inputId: "settingsFormulaToughnessK", key: "toughnessK", min: 50, max: 100000 },
    { inputId: "settingsFormulaResilCrK", key: "resilienceCritRateK", min: 100, max: 200000 },
    { inputId: "settingsFormulaResilCdK", key: "resilienceCritBonusK", min: 100, max: 200000 },
    { inputId: "settingsFormulaFocusPerPt", key: "focusNegationPctPerPoint", min: 0, max: 1 },
    { inputId: "settingsFormulaBlockMult", key: "shieldBlockDamageMultiplier", min: 0, max: 1 },
    { inputId: "settingsFormulaMaxCritBonus", key: "maxCritBonusPct", min: 50, max: 1000 },
];

export function applyAdvancedMode(enabled) {
    const isAdv = Boolean(enabled);
    document.body.classList.toggle("simple-mode", !isAdv);
    const chk = document.getElementById("settingsAdvancedModeChk");
    if (chk) chk.checked = isAdv;
    updateSettingsButtonTooltip();
}

function countActiveFormulaOverrides(overrides = {}) {
    if (!overrides || typeof overrides !== "object") return 0;
    let count = 0;
    for (const [k, v] of Object.entries(overrides)) {
        if (v === undefined || v === null || v === "") continue;
        if (k === "avoidanceModel") {
            if (v !== DEFAULT_CONSTANTS.avoidanceModel) count++;
        } else if (k in DEFAULT_CONSTANTS) {
            const numV = Number(v);
            if (Number.isFinite(numV) && Math.abs(numV - Number(DEFAULT_CONSTANTS[k])) > 1e-9) {
                count++;
            }
        }
    }
    return count;
}

function updateSettingsButtonTooltip() {
    const s = state.settings || {};
    const ovCount = countActiveFormulaOverrides(s.formulaOverrides);
    const topBtn = document.getElementById("openSettingsBtn");
    if (topBtn) {
        const modeTxt = s.advancedMode ? "Advanced View" : "Simple View";
        const ovTxt = ovCount > 0 ? ` · ${ovCount} formula override${ovCount === 1 ? "" : "s"} active` : "";
        topBtn.title = `Settings, Display, Buff Defaults, Formulas & DaruGear Sync (${modeTxt}${ovTxt})`;
        topBtn.classList.toggle("has-overrides", ovCount > 0);
    }
    const badge = document.getElementById("settingsFormulaBadge");
    if (badge) {
        badge.classList.toggle("hidden", ovCount === 0);
        badge.textContent = `${ovCount} Formula Override${ovCount === 1 ? "" : "s"} Active`;
    }
    const statusEl = document.getElementById("settingsFormulaStatus");
    if (statusEl) {
        statusEl.textContent =
            ovCount > 0
                ? `${ovCount} custom override${ovCount === 1 ? "" : "s"} currently active.`
                : "Using AA Classic 3.5 default constants.";
    }
}

function setActiveSettingsTab(tabId) {
    _activeSettingsTab = tabId || "general";
    document.querySelectorAll("[data-settings-tab]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.settingsTab === _activeSettingsTab);
    });
    document.querySelectorAll("[data-settings-pane]").forEach((pane) => {
        pane.classList.toggle("hidden", pane.dataset.settingsPane !== _activeSettingsTab);
    });
    if (_activeSettingsTab === "buffs") {
        renderCategoryLoadoutsGrid();
    } else if (_activeSettingsTab === "sync") {
        renderBackupMeta();
        refreshSyncStatus();
    }
}

function renderCategoryLoadoutsGrid() {
    const grid = document.getElementById("settingsCatLoadoutsGrid");
    if (!grid) return;
    const loadouts = Array.isArray(state.customBuffLoadouts) ? state.customBuffLoadouts : [];
    const savedMap = state.settings?.categoryDefaultLoadouts || {};
    const allCats = getAllBuildCategories();

    const buildPresetOptions = (selectedVal) =>
        loadouts
            .map((p) => {
                const cnt = (p.tokens?.length || 0) + Object.values(p.consumables || {}).filter(Boolean).length;
                return `<option value="${escHtml(p.id)}" ${selectedVal === p.id ? "selected" : ""}>${escHtml(p.label)} (${cnt} buffs)</option>`;
            })
            .join("");

    grid.innerHTML = allCats
        .map((cat) => {
            const currentVal = savedMap[cat.id] || "__keep__";
            const armorColsHtml = ARMOR_TYPES.map((armor) => {
                const key = `${cat.id}:${armor.id}`;
                const curArmorVal = savedMap[key] || "__inherit__";
                const isOverridden = curArmorVal !== "__inherit__";
                return `
            <label class="settings-armor-cell ${isOverridden ? "has-override" : ""}">
                <span class="settings-armor-lbl armor-${escHtml(armor.id)}">${escHtml(armor.label)}</span>
                <select class="settings-armor-select" data-cat-loadout="${escHtml(key)}">
                    <option value="__inherit__" ${curArmorVal === "__inherit__" ? "selected" : ""}>Use ${escHtml(cat.label)} default</option>
                    <option value="__keep__" ${curArmorVal === "__keep__" ? "selected" : ""}>Keep build&rsquo;s own</option>
                    <option value="__clear__" ${curArmorVal === "__clear__" ? "selected" : ""}>No Buffs (Clear)</option>
                    ${buildPresetOptions(curArmorVal)}
                </select>
            </label>`;
            }).join("");

            return `
        <div class="settings-cat-card ${cat.isCustom ? "is-custom-cat" : ""}">
            <div class="settings-cat-row">
                <div class="settings-cat-info">
                    <div class="settings-cat-title-row">
                        <strong>${escHtml(cat.label)}</strong>
                        ${cat.isCustom ? `<span class="stag stag-var">Custom</span>` : ""}
                    </div>
                    <span class="settings-cat-hint">${escHtml(cat.hint || "Custom archetype")}</span>
                </div>
                <div class="settings-cat-ctrl-row">
                    <select class="settings-cat-select" data-cat-loadout="${escHtml(cat.id)}" title="Fallback default buff loadout for ${escHtml(cat.label)} builds when no Plate/Leather/Cloth variant is set">
                        <option value="__keep__" ${currentVal === "__keep__" ? "selected" : ""}>Keep build&rsquo;s own buffs</option>
                        <option value="__clear__" ${currentVal === "__clear__" ? "selected" : ""}>No Buffs (Clear all)</option>
                        ${buildPresetOptions(currentVal)}
                    </select>
                    ${
                        cat.isCustom
                            ? `<button type="button" class="sm danger" data-del-custom-cat="${escHtml(cat.id)}" title="Remove custom archetype">&times;</button>`
                            : ""
                    }
                </div>
            </div>
            <div class="settings-armor-grid">
                ${armorColsHtml}
            </div>
        </div>`;
        })
        .join("");

    grid.querySelectorAll("[data-cat-loadout]").forEach((sel) => {
        sel.addEventListener("change", () => {
            const key = sel.dataset.catLoadout;
            const nextVal = sel.value || (key.includes(":") ? "__inherit__" : "__keep__");
            const nextMap = { ...(state.settings.categoryDefaultLoadouts || {}) };
            if (key.includes(":") && nextVal === "__inherit__") {
                delete nextMap[key];
            } else {
                nextMap[key] = nextVal;
            }
            saveSimSettings({
                ...state.settings,
                categoryDefaultLoadouts: nextMap,
            });
            const cell = sel.closest(".settings-armor-cell");
            if (cell) cell.classList.toggle("has-override", nextVal !== "__inherit__");
            const [catId, armorId] = key.split(":");
            const catLbl = getAllBuildCategories().find((c) => c.id === catId)?.label || catId;
            const armorLbl = armorId ? `${ARMOR_TYPES.find((a) => a.id === armorId)?.label || armorId} ` : "";
            const optLbl = sel.options[sel.selectedIndex]?.textContent || nextVal;
            showToast(`Default buffs for ${armorLbl}${catLbl}: ${optLbl}`, "ok");
        });
    });

    grid.querySelectorAll("[data-del-custom-cat]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const catId = btn.dataset.delCustomCat;
            const curCustom = Array.isArray(state.settings.customCategories) ? state.settings.customCategories : [];
            const found = curCustom.find((c) => c.id === catId);
            const nextCustom = curCustom.filter((c) => c.id !== catId);
            const nextMap = { ...(state.settings.categoryDefaultLoadouts || {}) };
            delete nextMap[catId];
            for (const armor of ARMOR_TYPES) delete nextMap[`${catId}:${armor.id}`];
            saveSimSettings({
                ...state.settings,
                customCategories: nextCustom,
                categoryDefaultLoadouts: nextMap,
            });
            renderCategoryLoadoutsGrid();
            ui.renderCharacterCards();
            showToast(`Removed custom archetype "${found?.label || catId}"`, "ok");
        });
    });
}

function addCustomArchetypeFromInputs() {
    const nameInp = document.getElementById("settingsNewCatName");
    const hintInp = document.getElementById("settingsNewCatHint");
    const label = String(nameInp?.value || "").trim().slice(0, 40);
    const hint = String(hintInp?.value || "").trim().slice(0, 80) || "Custom archetype";
    if (!label) {
        showToast("Enter a name for the custom archetype (e.g. Raid Bard or Offensive Healer)", "warn");
        nameInp?.focus();
        return;
    }
    const id = slugifyCategoryId(label);
    if (!id) {
        showToast("Archetype name must contain letters or numbers", "warn");
        return;
    }
    const existing = getAllBuildCategories();
    if (existing.some((c) => c.id === id)) {
        showToast(`An archetype named "${label}" already exists`, "warn");
        return;
    }
    const nextCustom = [
        ...(Array.isArray(state.settings.customCategories) ? state.settings.customCategories : []),
        { id, label, hint, isCustom: true },
    ];
    saveSimSettings({
        ...state.settings,
        customCategories: nextCustom,
    });
    if (nameInp) nameInp.value = "";
    if (hintInp) hintInp.value = "";
    renderCategoryLoadoutsGrid();
    ui.renderCharacterCards();
    showToast(`Added custom archetype "${label}" (now selectable on every Character Card)`, "ok");
}

function autoFillCategoryLoadoutsFromPresets() {
    const loadouts = Array.isArray(state.customBuffLoadouts) ? state.customBuffLoadouts : [];
    if (loadouts.length === 0) {
        showToast("No saved buff presets found to match.", "warn");
        return;
    }
    const roleMatchers = {
        melee: /\b(melee|darkrunner|shadowblade|battlerage)\b/i,
        mage: /\b(mage|sorc|magic|spellsinger|spellsong|caster)\b/i,
        archer: /\b(archer|ranged|primeval|ebonsong|bow)\b/i,
        healer: /\b(healer|cleric|templar|vitalism|heal)\b/i,
        tank: /\b(tank|skullknight|abolisher|dreambreaker|initiator)\b/i,
    };
    const allCats = getAllBuildCategories();
    const customCats = allCats.filter((c) => c.isCustom);
    const nextMap = { ...(state.settings.categoryDefaultLoadouts || {}) };
    let matchedCount = 0;

    for (const preset of loadouts) {
        const lbl = String(preset?.label || preset?.id || "");
        const lowerLbl = lbl.toLowerCase();
        // Check custom archetypes first (more specific labels like "Offensive Healer" / "Raid Bard")
        let matchedCat = customCats.find((c) => lowerLbl.includes(c.label.toLowerCase()));
        if (!matchedCat) {
            matchedCat = BUILD_CATEGORIES.find((c) => roleMatchers[c.id]?.test(lbl));
        }
        if (!matchedCat) continue;
        const matchedArmor = ARMOR_TYPES.find((a) => new RegExp(`\\b${a.id}\\b`, "i").test(lbl));
        if (matchedArmor) {
            const key = `${matchedCat.id}:${matchedArmor.id}`;
            nextMap[key] = preset.id;
            matchedCount++;
        } else if (!nextMap[matchedCat.id] || nextMap[matchedCat.id] === "__keep__") {
            nextMap[matchedCat.id] = preset.id;
            matchedCount++;
        }
    }

    if (matchedCount === 0) {
        showToast("No preset labels matched Category / Plate / Leather / Cloth names.", "warn");
        return;
    }
    saveSimSettings({
        ...state.settings,
        categoryDefaultLoadouts: nextMap,
    });
    renderCategoryLoadoutsGrid();
    showToast(`Auto-matched ${matchedCount} default buff slot${matchedCount === 1 ? "" : "s"} from saved presets`, "ok");
}

function syncSettingsControlsFromState() {
    const s = state.settings || normalizeSimSettings({});
    applyAdvancedMode(s.advancedMode);

    const hideOff = document.getElementById("settingsHideOffSpecChk");
    if (hideOff) hideOff.checked = Boolean(s.hideOffSpecTiles);

    const numFmt = document.getElementById("settingsNumberFormat");
    if (numFmt) numFmt.value = s.numberFormat || "exact";

    const decSel = document.getElementById("settingsDecimalPlaces");
    if (decSel) decSel.value = String(s.decimalPlaces ?? 1);

    const defMetric = document.getElementById("settingsDefMetric");
    if (defMetric) defMetric.value = s.defenderPrimaryMetric || "hp_pct";

    const autoCat = document.getElementById("settingsAutoApplyCatBuffsChk");
    if (autoCat) autoCat.checked = Boolean(s.autoApplyCategoryLoadouts);

    const ov = s.formulaOverrides || {};
    const avoidSel = document.getElementById("settingsFormulaAvoidModel");
    if (avoidSel) avoidSel.value = ov.avoidanceModel || DEFAULT_CONSTANTS.avoidanceModel;

    for (const spec of FORMULA_FIELD_SPECS) {
        const inp = document.getElementById(spec.inputId);
        if (!inp) continue;
        const val = ov[spec.key];
        inp.value = val !== undefined && val !== null && val !== "" ? String(val) : "";
    }

    renderCategoryLoadoutsGrid();
    renderBackupMeta();
    updateSettingsButtonTooltip();
}

function renderBackupMeta() {
    const el = document.getElementById("settingsBackupMeta");
    if (!el) return;
    const buildsCnt = state.savedBuilds.length;
    const loadoutsCnt = (state.customBuffLoadouts || []).length;
    const combosCnt = (state.customRotations || []).length;
    const customBuffsCnt = Object.values(COMBAT_MODIFIERS).filter((m) => m.isCustom).length;
    const econOvCnt =
        Object.keys(state.economyPriceBook?.itemOverrides || {}).length +
        Object.keys(state.economyPriceBook?.gemOverrides || {}).length +
        Object.keys(state.economyPriceBook?.frostOverrides || {}).length;
    const storageModeTxt = state.diskApiAvailable
        ? "Local disk + browser localStorage backup"
        : "Browser localStorage only (static / GitHub Pages)";
    el.innerHTML = `<div>Includes <strong>${buildsCnt}</strong> build${buildsCnt === 1 ? "" : "s"} &middot; <strong>${loadoutsCnt}</strong> buff preset${loadoutsCnt === 1 ? "" : "s"} &middot; <strong>${combosCnt}</strong> saved combo${combosCnt === 1 ? "" : "s"} &middot; <strong>${customBuffsCnt}</strong> custom buff${customBuffsCnt === 1 ? "" : "s"} &middot; Economy Price Book (${econOvCnt} override${econOvCnt === 1 ? "" : "s"}) + all settings</div><div class="settings-ts">Storage: <strong>${storageModeTxt}</strong></div>`;
}

function handleFormulaInputChange() {
    const nextOv = {};
    const avoidSel = document.getElementById("settingsFormulaAvoidModel");
    if (avoidSel && avoidSel.value && avoidSel.value !== DEFAULT_CONSTANTS.avoidanceModel) {
        nextOv.avoidanceModel = avoidSel.value;
    }
    for (const spec of FORMULA_FIELD_SPECS) {
        const inp = document.getElementById(spec.inputId);
        if (!inp) continue;
        const raw = String(inp.value || "").trim();
        if (raw === "") continue;
        const n = Number(raw);
        if (!Number.isFinite(n)) continue;
        const clamped = Math.max(spec.min, Math.min(spec.max, n));
        if (Math.abs(clamped - Number(DEFAULT_CONSTANTS[spec.key])) > 1e-9) {
            nextOv[spec.key] = clamped;
        }
    }
    saveSimSettings({ ...state.settings, formulaOverrides: nextOv });
    updateSettingsButtonTooltip();
    ui.renderCharacterCards();
    ui.renderSimulation();
}

export function buildWorkspaceBackupPayload() {
    const customBuffs = Object.values(COMBAT_MODIFIERS)
        .filter((m) => m && m.isCustom)
        .map((m) => {
            const copy = { ...m };
            delete copy.isCustom;
            return copy;
        });
    return {
        schemaVersion: 1,
        appVersion: APP_VERSION,
        type: "aac-sim-workspace-backup",
        exportedAt: new Date().toISOString(),
        settings: normalizeSimSettings(state.settings),
        builds: Array.isArray(state.savedBuilds) ? state.savedBuilds : [],
        buffLoadouts: Array.isArray(state.customBuffLoadouts) ? state.customBuffLoadouts : [],
        customBuffs,
        rotations: {
            activeId: state.activeRotationId || null,
            combos: Array.isArray(state.customRotations) ? state.customRotations : [],
            steps: Array.isArray(state.rotationSteps) ? state.rotationSteps : [],
            updatedAt: state.rotationsUpdatedAt || Date.now(),
        },
        economyPriceBook: state.economyPriceBook || loadEconomyPriceBookFromStorage(),
    };
}

function handleExportWorkspaceBackup() {
    const payload = buildWorkspaceBackupPayload();
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `aac-sim-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(
        `Exported workspace backup (${payload.builds.length} builds, ${payload.buffLoadouts.length} buff presets, ${payload.rotations.combos.length} combos)`,
        "ok"
    );
}

async function handleImportWorkspaceBackupFile(file) {
    if (!file) return;
    let parsed = null;
    try {
        const text = await file.text();
        parsed = JSON.parse(text);
    } catch (err) {
        showToast(`Invalid backup JSON: ${err.message}`, "err");
        return;
    }
    if (!parsed || typeof parsed !== "object") {
        showToast("Backup file must be a JSON object", "err");
        return;
    }
    const buildsIn = Array.isArray(parsed.builds) ? parsed.builds : [];
    const loadoutsIn = Array.isArray(parsed.buffLoadouts) ? parsed.buffLoadouts : null;
    const customBuffsIn = Array.isArray(parsed.customBuffs) ? parsed.customBuffs : [];
    const rotationsIn = parsed.rotations && typeof parsed.rotations === "object" ? parsed.rotations : null;
    const settingsIn = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : null;
    const economyIn = parsed.economyPriceBook && typeof parsed.economyPriceBook === "object" ? parsed.economyPriceBook : null;

    if (!buildsIn.length && !loadoutsIn && !customBuffsIn.length && !rotationsIn && !settingsIn && !economyIn) {
        showToast("No recognizable backup sections found in this JSON file", "err");
        return;
    }

    appendSyncLog(`Restoring workspace backup from "${file.name}"...`);
    let restoredBuilds = 0;
    let restoredBuffs = 0;

    try {
        // 1. Settings
        if (settingsIn) {
            saveSimSettings(settingsIn);
            syncSettingsControlsFromState();
            appendSyncLog("Restored simulator settings & formula overrides.", "ok");
        }

        // 2. Custom buffs
        if (customBuffsIn.length > 0) {
            const registered = registerCustomModifiers(customBuffsIn);
            const delBuffs = loadDeletedBuffIdsFromLocalStorage();
            let delBuffsChanged = false;
            for (const m of registered) {
                if (delBuffs.delete(m.id)) delBuffsChanged = true;
            }
            if (delBuffsChanged) persistDeletedBuffIdsToLocalStorage(delBuffs);
            persistActiveCustomBuffsToLocalStorage();
            if (state.diskApiAvailable) {
                for (const mod of customBuffsIn) {
                    if (!mod || !mod.id) continue;
                    try {
                        const res = await fetch("/api/buffs/import", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ modifier: mod }),
                        });
                        if (res.ok) restoredBuffs++;
                    } catch {
                        // Non-fatal
                    }
                }
                if (typeof ui.loadCustomBuffs === "function") {
                    await ui.loadCustomBuffs();
                }
            } else {
                restoredBuffs = registered.length;
            }
            appendSyncLog(`Restored ${restoredBuffs} custom buff(s).`, "ok");
        }

        // 3. Buff loadouts
        if (loadoutsIn) {
            state.customBuffLoadouts = loadoutsIn;
            await saveCustomBuffLoadouts(loadoutsIn);
            if (state.diskApiAvailable) {
                await loadBuffLoadoutsFromDisk().catch(() => {});
            }
            renderCategoryLoadoutsGrid();
            appendSyncLog(`Restored ${loadoutsIn.length} buff preset loadout(s).`, "ok");
        }

        // 4. Rotations / Combos
        if (rotationsIn) {
            const combos = Array.isArray(rotationsIn.combos) ? rotationsIn.combos : [];
            state.customRotations = combos;
            state.activeRotationId = rotationsIn.activeId || (combos[0]?.id ?? null);
            state.rotationSteps = Array.isArray(rotationsIn.steps)
                ? rotationsIn.steps
                : combos[0]?.steps
                  ? combos[0].steps.map((s) => ({ ...s }))
                  : [];
            state.rotationsUpdatedAt = Date.now();
            await syncRotationsToDisk();
            if (state.diskApiAvailable) {
                await loadRotationsFromDisk().catch(() => {});
            }
            appendSyncLog(`Restored ${combos.length} saved combo(s).`, "ok");
        }

        // 5. Saved builds
        if (buildsIn.length > 0) {
            if (state.diskApiAvailable) {
                for (const b of buildsIn) {
                    if (!b || typeof b !== "object") continue;
                    try {
                        const res = await fetch("/api/builds", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(b),
                        });
                        if (res.ok) restoredBuilds++;
                    } catch {
                        // Non-fatal
                    }
                }
                if (typeof ui.loadSavedBuilds === "function") {
                    await ui.loadSavedBuilds();
                }
            } else {
                const delBuilds = loadDeletedBuildIdsFromLocalStorage();
                let delBuildsChanged = false;
                const byId = new Map(state.savedBuilds.map((b) => [b.savedId, b]));
                for (const b of buildsIn) {
                    if (b && b.savedId) {
                        byId.set(b.savedId, b);
                        if (delBuilds.delete(b.savedId)) delBuildsChanged = true;
                        restoredBuilds++;
                    }
                }
                if (delBuildsChanged) persistDeletedBuildIdsToLocalStorage(delBuilds);
                state.savedBuilds = Array.from(byId.values());
                persistSavedBuildsToLocalStorage(state.savedBuilds);
            }
            appendSyncLog(`Restored ${restoredBuilds} saved build(s).`, "ok");
        }

        // 6. Economy Price Book
        if (economyIn) {
            await saveEconomyPriceBook(economyIn);
            appendSyncLog("Restored Economy Price Book (tier matrix, gem/frost prices & custom overrides).", "ok");
        }

        renderBackupMeta();
        ui.renderCharacterCards();
        ui.renderSimulation();
        showToast(
            `Workspace backup restored (${restoredBuilds} builds, ${loadoutsIn ? loadoutsIn.length : 0} presets, ${rotationsIn?.combos?.length || 0} combos)`,
            "ok"
        );
    } catch (err) {
        appendSyncLog(`Restore error: ${err.message || err}`, "err");
        showToast(`Backup restore failed: ${err.message || err}`, "err");
    }
}

function fmtSyncTime(iso) {
    if (!iso) return "Never synced via Settings";
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return String(iso);
        return d.toLocaleString();
    } catch {
        return String(iso);
    }
}

function appendSyncLog(msg, kind = "info") {
    const log = document.getElementById("settingsSyncLog");
    if (!log) return;
    log.classList.remove("hidden");
    const ts = new Date().toLocaleTimeString();
    const row = document.createElement("div");
    row.className = `settings-log-line ${kind}`;
    row.textContent = `[${ts}] ${msg}`;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
}

function clearSyncLog() {
    const log = document.getElementById("settingsSyncLog");
    if (!log) return;
    log.innerHTML = "";
}

export function syncStaticModeControls() {
    const hasLocalApi = Boolean(state.diskApiAvailable);

    const pullBtn = document.getElementById("openBuffPullBtn");
    if (pullBtn) {
        pullBtn.disabled = !hasLocalApi;
        pullBtn.title = hasLocalApi
            ? "Fetch any ArcheAge Classic buff by ID from aa-classic.com and save it locally"
            : "Disabled on static hosting — run locally with `python tools/serve.py` to pull live buffs from aa-classic.com";
    }

    const staticNotice = document.getElementById("settingsSyncStaticNotice");
    if (staticNotice) {
        staticNotice.classList.toggle("hidden", hasLocalApi);
    }

    const disableSync = _syncBusy || !hasLocalApi;
    for (const id of [
        "settingsResyncAllBtn",
        "settingsResyncGearBtn",
        "settingsResyncSkillsBtn",
        "settingsResyncBuildsBtn",
        "settingsResyncEconomyBtn",
        "settingsVersionInput",
    ]) {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = disableSync;
            if (!hasLocalApi) {
                el.title =
                    id === "settingsResyncEconomyBtn"
                        ? "Disabled on static hosting — run locally with `python tools/serve.py` to scrape live AH prices from sermeatball.com"
                        : "Disabled on static hosting — run locally with `python tools/serve.py` to resync DaruGear data";
            }
        }
    }
}

function setSyncButtonsDisabled(disabled) {
    _syncBusy = disabled;
    syncStaticModeControls();
}

function getVersionOverride() {
    const inp = document.getElementById("settingsVersionInput");
    const v = String(inp?.value || "").trim();
    return v || null;
}

function renderSyncStatusCards(status) {
    _lastStatus = status;
    const gearMeta = document.getElementById("settingsGearMeta");
    const skillsMeta = document.getElementById("settingsSkillsMeta");
    const buildsMeta = document.getElementById("settingsBuildsMeta");

    if (gearMeta) {
        const g = status?.gearCatalog || {};
        const c = g.counts || {};
        const countTxt = c.totalItems
            ? `${c.totalItems.toLocaleString()} items (${(c.weapons || 0).toLocaleString()} weapons, ${(c.armors || 0).toLocaleString()} armor, ${(c.accessories || 0).toLocaleString()} acc/gliders) · ${c.lunagems || 0} gems · ${c.lunafrosts || 0} frosts · ${c.titles || 0} titles`
            : "Catalog not built yet";
        gearMeta.innerHTML = `<div>${escHtml(countTxt)}</div><div class="settings-ts">Version: <strong>${escHtml(g.version || "v35")}</strong> &middot; Last synced: ${escHtml(fmtSyncTime(g.syncedAt))}</div>`;
    }

    if (skillsMeta) {
        const s = status?.skills || {};
        const c = s.counts || {};
        const countTxt = c.actives
            ? `${c.trees || 10} trees · ${c.actives} actives · ${c.passives || 0} passives · ${c.ancestrals || 0} AA Classic ancestrals · ${c.classes || 120} classes`
            : "Skill catalog not built yet";
        skillsMeta.innerHTML = `<div>${escHtml(countTxt)}</div><div class="settings-ts">Version: <strong>${escHtml(s.version || "v35")}</strong> &middot; Last synced: ${escHtml(fmtSyncTime(s.syncedAt))}</div>`;
    }

    if (buildsMeta) {
        const b = status?.builds || {};
        const syncable = b.syncable ?? state.savedBuilds.filter((x) => extractShareCode(x)).length;
        const total = b.total ?? state.savedBuilds.length;
        buildsMeta.innerHTML = `<div><strong>${syncable}</strong> of <strong>${total}</strong> saved builds linked to DaruGear share codes (preserves custom names, categories, active buffs &amp; consumables)</div><div class="settings-ts">Last synced: ${escHtml(fmtSyncTime(b.syncedAt))}</div>`;
    }

    const econMeta = document.getElementById("settingsEconomyMeta");
    if (econMeta) {
        const e = status?.economy || {};
        const c = e.counts || {};
        const countTxt = c.total
            ? `${Number(c.total).toLocaleString()} priced items (${Number(c.items || 0).toLocaleString()} gear · ${c.gems || 0} gems · ${c.frosts || 0} frosts)${
                  c.buildsTotalGems
                      ? ` — covers ${c.buildsMatchedGems || 0}/${c.buildsTotalGems} build gems & ${c.buildsMatchedFrosts || 0}/${c.buildsTotalFrosts || 0} frosts`
                      : ""
              }`
            : "Not synced yet (click Sync AH Prices to scrape sermeatball.com)";
        econMeta.innerHTML = `<div>${escHtml(countTxt)}</div><div class="settings-ts">Source: <strong>${escHtml(e.source || "sermeatball.com")}</strong> &middot; Last synced: ${escHtml(fmtSyncTime(e.syncedAt))}</div>`;
    }
}

function extractShareCode(build) {
    if (!build) return null;
    const direct = build.shareCode || build.metadata?.shareCode;
    if (direct && /^[A-Za-z0-9_-]{3,32}$/.test(String(direct).trim())) {
        return String(direct).trim();
    }
    return extractDaruGearShareCode(build.darugearUrl || build.shareUrl || build.metadata?.darugearUrl || "");
}

async function refreshSyncStatus() {
    if (state.diskApiAvailable && window.location.protocol !== "file:") {
        try {
            const res = await fetch("/api/sync/status", { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                if (data?.ok) {
                    renderSyncStatusCards(data);
                    return data;
                }
            }
        } catch {
            // Fall through to static sync_status.json
        }
    }
    if (window.location.protocol !== "file:") {
        try {
            const res = await fetch("js/data/sync_status.json", { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                if (data && typeof data === "object") {
                    renderSyncStatusCards(data);
                    return data;
                }
            }
        } catch {
            // Leave empty status
        }
    }
    renderSyncStatusCards(_lastStatus || {});
    return null;
}

async function runSyncGearCatalog() {
    const ver = getVersionOverride();
    appendSyncLog(`Downloading DaruGear gear CSVs${ver ? ` (${ver})` : " (auto-detecting latest version)"}...`);
    const res = await fetch("/api/sync/gear-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ver ? { version: ver } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status} syncing gear catalog`);
    }
    const c = data.counts || {};
    appendSyncLog(
        `Gear catalog compiled (${data.version}): ${(c.totalItems || 0).toLocaleString()} items, ${c.lunagems || 0} gems, ${c.lunafrosts || 0} frosts, ${c.titles || 0} titles.`,
        "ok"
    );
    await reloadGearCatalog();
    appendSyncLog("Reloaded Gear Catalog in memory.", "ok");
    return data;
}

async function runSyncSkills() {
    const ver = getVersionOverride();
    appendSyncLog(`Downloading DaruGear skill CSVs${ver ? ` (${ver})` : " (auto-detecting latest version)"}...`);
    const res = await fetch("/api/sync/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ver ? { version: ver } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status} syncing skills`);
    }
    const c = data.counts || {};
    appendSyncLog(
        `Skills updated (${data.version}): ${c.actives || 0} actives, ${c.passives || 0} passives, ${c.ancestrals || 0} AA Classic ancestrals, ${c.classes || 0} classes.`,
        "ok"
    );
    const sbRes = await fetch(`js/data/skill_builder_data.json?t=${Date.now()}`, { cache: "no-store" });
    if (sbRes.ok) {
        const sbJson = await sbRes.json();
        initSkillBuilderData(sbJson);
        syncSkillBreakdownAncestralsFromBuilder(state.allSkills, sbJson);
        appendSyncLog("Reloaded Skill Builder & ancestral data in memory.", "ok");
    }
    return data;
}

async function runSyncSavedBuilds() {
    // Reload latest saved builds list from disk first
    let builds = [...state.savedBuilds];
    try {
        const res = await fetch("/api/builds", { cache: "no-store" });
        if (res.ok) {
            const d = await res.json();
            if (d?.ok && Array.isArray(d.builds)) {
                builds = d.builds;
                state.savedBuilds = d.builds;
            }
        }
    } catch {
        // Use in-memory savedBuilds
    }

    const targets = builds
        .map((b) => ({ build: b, code: extractShareCode(b) }))
        .filter((x) => Boolean(x.code));

    if (targets.length === 0) {
        appendSyncLog("No saved builds have a DaruGear share code to resync.", "warn");
        return { updated: 0, total: builds.length, failed: 0 };
    }

    appendSyncLog(`Resyncing ${targets.length} saved build(s) from DaruGear...`);
    let updated = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
        const { build: oldBuild, code } = targets[i];
        const displayName = oldBuild.name || oldBuild.savedId || code;
        appendSyncLog(`(${i + 1}/${targets.length}) Pulling ${displayName} (${code})...`);
        try {
            const fetched = await fetchDaruGearBuild(code);
            if (!fetched.ok || !fetched.character) {
                failed++;
                appendSyncLog(`  ✗ ${displayName} (${code}): ${fetched.error || "Fetch failed"}`, "err");
                continue;
            }
            const rawFresh = fetched.character;
            // Unbake optional DaruGear buffs (matching Import modal 1:1) so saved modifiers & consumables
            // are NEVER double-counted on top of DaruGear's baked base stats!
            const syncRes =
                typeof ui.importAndUnbakeDaruGearBuffs === "function"
                    ? await ui.importAndUnbakeDaruGearBuffs(
                          rawFresh,
                          Array.isArray(oldBuild.modifiers) ? oldBuild.modifiers : [],
                          oldBuild.consumables && typeof oldBuild.consumables === "object"
                              ? oldBuild.consumables
                              : {}
                      )
                    : {
                          character: rawFresh,
                          tokens: Array.isArray(oldBuild.modifiers) ? [...oldBuild.modifiers] : [],
                          consumables:
                              oldBuild.consumables && typeof oldBuild.consumables === "object"
                                  ? { ...oldBuild.consumables }
                                  : {},
                          unbakedNames: [],
                      };
            const fresh = syncRes.character;
            const preservedMeta = normalizeBuildMetadata({
                ...fresh,
                metadata: {
                    ...(oldBuild.metadata || {}),
                    ...(fresh.metadata || {}),
                    category: oldBuild.metadata?.category ?? oldBuild.category ?? null,
                    shareCode: code,
                    darugearUrl: `https://darugear.com/?s=${code}`,
                },
            });
            const payload = {
                schemaVersion: 1,
                savedId: oldBuild.savedId,
                name: oldBuild.name || fresh.name,
                source: preservedMeta.source || "darugear",
                metadata: preservedMeta,
                shareUrl: preservedMeta.darugearUrl,
                darugearUrl: preservedMeta.darugearUrl,
                shareCode: code,
                className: fresh.className || oldBuild.className || null,
                level: fresh.level || 55,
                gearScore: fresh.gearScore,
                maxHealth: fresh.maxHealth,
                maxMana: fresh.maxMana,
                ...(fresh.baseAttributes ? { baseAttributes: { ...fresh.baseAttributes } } : {}),
                attributes: fresh.attributes,
                offense: fresh.offense,
                defense: fresh.defense,
                modifiers: Array.isArray(syncRes.tokens) ? [...syncRes.tokens] : [],
                consumables:
                    syncRes.consumables && typeof syncRes.consumables === "object"
                        ? { ...syncRes.consumables }
                        : {},
                equipment: normalizeEquipmentList(fresh.equipment),
            };
            if (rawFresh.skillBuild) {
                payload.skillBuild = rawFresh.skillBuild;
            } else if (oldBuild.skillBuild) {
                payload.skillBuild = oldBuild.skillBuild;
            }

            const saveRes = await fetch("/api/builds", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const saveData = await saveRes.json().catch(() => ({}));
            if (!saveRes.ok || !saveData.ok) {
                failed++;
                appendSyncLog(`  ✗ Failed saving ${displayName}: ${saveData.error || saveRes.status}`, "err");
                continue;
            }

            const savedObj = saveData.build || payload;
            const hydratedForSlot = { ...savedObj, rawDaruGear: rawFresh.rawDaruGear };
            state.savedBuilds = [
                savedObj,
                ...state.savedBuilds.filter((b) => b.savedId !== savedObj.savedId),
            ];

            for (const slotKey of ["A", "B", "defender"]) {
                const cur = getSlotChar(slotKey);
                if (
                    state.loadedSavedId[slotKey] === savedObj.savedId ||
                    (cur && cur.savedId === savedObj.savedId)
                ) {
                    setSlotChar(slotKey, hydratedForSlot);
                    state.modifiers[slotKey] = new Set(Array.isArray(savedObj.modifiers) ? savedObj.modifiers : []);
                    state.consumables[slotKey] =
                        savedObj.consumables && typeof savedObj.consumables === "object"
                            ? { ...savedObj.consumables }
                            : {};
                    ui.updateBuffedStatsPanel(slotKey);
                }
            }

            updated++;
            const unbakedInfo =
                syncRes.unbakedNames && syncRes.unbakedNames.length > 0
                    ? ` (unbaked ${syncRes.unbakedNames.length} buff${syncRes.unbakedNames.length === 1 ? "" : "s"})`
                    : "";
            appendSyncLog(
                `  ✓ ${displayName} (${code}): ${Math.round(fresh.gearScore)} GS, ${Math.round(fresh.maxHealth).toLocaleString()} base HP${unbakedInfo}`,
                "ok"
            );
        } catch (err) {
            failed++;
            appendSyncLog(`  ✗ ${displayName} (${code}): ${err.message || err}`, "err");
        }
    }

    try {
        await fetch("/api/sync/builds-complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updated, total: targets.length }),
        });
    } catch {
        // Non-fatal
    }

    appendSyncLog(
        `Finished resyncing saved builds: ${updated} updated${failed > 0 ? `, ${failed} failed` : ""}.`,
        failed > 0 ? "warn" : "ok"
    );
    return { updated, total: targets.length, failed };
}

async function runSyncEconomyPrices() {
    appendSyncLog("Scraping ArcheAge Classic Auction House price history from sermeatball.com...");
    const res = await fetch("/api/sync/economy-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status} syncing AH prices`);
    }
    const c = data.counts || {};
    appendSyncLog(
        `Saved ${(c.total || 0).toLocaleString()} AH prices -> ${data.filename || "economy/ah_prices.json"} (${(c.items || 0).toLocaleString()} gear, ${c.gems || 0} lunagems, ${c.frosts || 0} lunafrosts).`,
        "ok"
    );
    if (c.buildsTotalItems || c.buildsTotalGems) {
        appendSyncLog(
            `Saved builds match: ${c.buildsMatchedItems || 0}/${c.buildsTotalItems || 0} gear items, ${c.buildsMatchedGems || 0}/${c.buildsTotalGems || 0} lunagems, ${c.buildsMatchedFrosts || 0}/${c.buildsTotalFrosts || 0} lunafrosts.`,
            "ok"
        );
    }
    await loadEconomyAhPricesFromDisk();
    appendSyncLog("Reloaded AH market prices in Economy tab (manual overrides preserved).", "ok");
    return data;
}

export function openSettingsModal(initialTab = null) {
    const modal = document.getElementById("settingsModal");
    if (!modal) return;
    syncSettingsControlsFromState();
    syncStaticModeControls();
    if (initialTab) setActiveSettingsTab(initialTab);
    else setActiveSettingsTab(_activeSettingsTab);
    modal.classList.add("open");
    refreshSyncStatus();
}

export function closeSettingsModal() {
    if (_syncBusy) return;
    const modal = document.getElementById("settingsModal");
    if (modal) modal.classList.remove("open");
}

async function handleSyncAction(actionFn, doneToast) {
    if (_syncBusy || !state.diskApiAvailable) return;
    setSyncButtonsDisabled(true);
    clearSyncLog();
    try {
        await actionFn();
        await refreshSyncStatus();
        renderBackupMeta();
        ui.renderCharacterCards();
        ui.renderSimulation();
        showToast(doneToast, "ok");
    } catch (err) {
        appendSyncLog(`Error: ${err.message || err}`, "err");
        showToast(err.message || "DaruGear resync failed", "err");
    } finally {
        setSyncButtonsDisabled(false);
    }
}

export function bindSettingsModalEvents() {
    // Sync DOM controls & body class from persisted settings immediately on boot
    syncSettingsControlsFromState();

    // Settings tab pills
    document.querySelectorAll("[data-settings-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
            setActiveSettingsTab(btn.dataset.settingsTab);
        });
    });

    const creditsVerEl = document.getElementById("creditsVersionPill");
    if (creditsVerEl) creditsVerEl.textContent = `v${APP_VERSION}`;

    // Display & Rounding
    document.getElementById("settingsAdvancedModeChk")?.addEventListener("change", (e) => {
        const isAdv = Boolean(e.target.checked);
        saveSimSettings({ ...state.settings, advancedMode: isAdv });
        applyAdvancedMode(isAdv);
        showToast(
            isAdv ? "Advanced Options ON — showing all stats & math details" : "Simple View ON — hiding secondary stats for readability",
            "ok"
        );
    });

    document.getElementById("settingsHideOffSpecChk")?.addEventListener("change", (e) => {
        const hide = Boolean(e.target.checked);
        saveSimSettings({ ...state.settings, hideOffSpecTiles: hide });
        ui.renderCharacterCards();
        showToast(
            hide ? "Hiding off-spec attack tiles on Character Cards" : "Showing all 4 attack/healing tiles on Character Cards",
            "ok"
        );
    });

    document.getElementById("settingsNumberFormat")?.addEventListener("change", (e) => {
        const fmt = e.target.value === "abbrev" ? "abbrev" : "exact";
        saveSimSettings({ ...state.settings, numberFormat: fmt });
        ui.renderCharacterCards();
        ui.renderSimulation();
        showToast(
            fmt === "abbrev" ? "Number format: Abbreviated (e.g. 548.9k)" : "Number format: Exact (e.g. 548,912)",
            "ok"
        );
    });

    document.getElementById("settingsDecimalPlaces")?.addEventListener("change", (e) => {
        const dec = Number(e.target.value);
        saveSimSettings({ ...state.settings, decimalPlaces: dec });
        ui.renderCharacterCards();
        ui.renderSimulation();
    });

    document.getElementById("settingsDefMetric")?.addEventListener("change", (e) => {
        const metric = e.target.value === "raw" ? "raw" : "hp_pct";
        saveSimSettings({ ...state.settings, defenderPrimaryMetric: metric });
        ui.renderSimulation();
        showToast(
            metric === "raw" ? "Defender primary metric: Raw Damage Taken" : "Defender primary metric: % of Max HP Lost",
            "ok"
        );
    });

    // Category Default Buff Loadouts
    document.getElementById("settingsAutoApplyCatBuffsChk")?.addEventListener("change", (e) => {
        const enabled = Boolean(e.target.checked);
        saveSimSettings({ ...state.settings, autoApplyCategoryLoadouts: enabled });
        showToast(
            enabled ? "Auto-apply category default buffs ON" : "Auto-apply category default buffs OFF",
            "ok"
        );
    });

    document.getElementById("settingsApplyCatNowBtn")?.addEventListener("click", () => {
        const appliedSlots = [];
        for (const slotKey of ["A", "B", "defender"]) {
            const res = applyCategoryDefaultLoadoutToSlot(slotKey, { force: true });
            if (res.applied) {
                const tag = res.matchedArmorVariant && res.armorType ? `${res.armorType} ${res.category}` : res.category;
                appliedSlots.push(`${slotKey === "defender" ? "Slot 3" : `Build ${slotKey}`} (${tag} → ${res.label})`);
            }
        }
        ui.renderCharacterCards();
        ui.renderSimulation();
        if (appliedSlots.length > 0) {
            showToast(`Applied defaults: ${appliedSlots.join(" • ")}`, "ok");
        } else {
            showToast("All active slots' categories are currently set to 'Keep build's own buffs'", "warn");
        }
    });

    document.getElementById("settingsAutoFillCatBtn")?.addEventListener("click", autoFillCategoryLoadoutsFromPresets);
    document.getElementById("settingsAddCatBtn")?.addEventListener("click", addCustomArchetypeFromInputs);
    document.getElementById("settingsNewCatName")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addCustomArchetypeFromInputs();
        }
    });

    // Formula Overrides
    document.getElementById("settingsFormulaAvoidModel")?.addEventListener("change", handleFormulaInputChange);
    for (const spec of FORMULA_FIELD_SPECS) {
        document.getElementById(spec.inputId)?.addEventListener("change", handleFormulaInputChange);
    }

    document.getElementById("settingsFormulaResetBtn")?.addEventListener("click", () => {
        saveSimSettings({ ...state.settings, formulaOverrides: {} });
        syncSettingsControlsFromState();
        ui.renderCharacterCards();
        ui.renderSimulation();
        showToast("Reset all combat formulas to AA Classic 3.5 defaults", "ok");
    });

    // Workspace Backup Export & Import
    document.getElementById("settingsExportBackupBtn")?.addEventListener("click", handleExportWorkspaceBackup);
    document.getElementById("settingsImportBackupBtn")?.addEventListener("click", () => {
        const fileInp = document.getElementById("settingsImportBackupFile");
        if (fileInp) {
            fileInp.value = "";
            fileInp.click();
        }
    });
    document.getElementById("settingsImportBackupFile")?.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (file) handleImportWorkspaceBackupFile(file);
    });

    // Modal open/close & Sync actions
    document.getElementById("openSettingsBtn")?.addEventListener("click", () => openSettingsModal());
    document.getElementById("settingsCloseBtn")?.addEventListener("click", closeSettingsModal);
    document.getElementById("settingsModal")?.addEventListener("click", (e) => {
        if (e.target.id === "settingsModal") closeSettingsModal();
    });

    document.getElementById("settingsResyncGearBtn")?.addEventListener("click", () =>
        handleSyncAction(runSyncGearCatalog, "Stored Gear Catalog resynced from DaruGear!")
    );
    document.getElementById("settingsResyncSkillsBtn")?.addEventListener("click", () =>
        handleSyncAction(runSyncSkills, "Stored Skills resynced from DaruGear!")
    );
    document.getElementById("settingsResyncBuildsBtn")?.addEventListener("click", () =>
        handleSyncAction(runSyncSavedBuilds, "Saved Builds resynced from DaruGear!")
    );
    document.getElementById("settingsResyncEconomyBtn")?.addEventListener("click", () =>
        handleSyncAction(runSyncEconomyPrices, "Auction House prices synced from sermeatball.com!")
    );
    document.getElementById("settingsResyncAllBtn")?.addEventListener("click", () =>
        handleSyncAction(async () => {
            await runSyncGearCatalog();
            await runSyncSkills();
            await runSyncSavedBuilds();
        }, "Full DaruGear resync complete (Gear, Skills & Saved Builds)!")
    );
}
