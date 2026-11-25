/**
 * Shared application state, storage helpers, formatting utilities,
 * slot accessors, and UI callback bridge for the ArcheAge Classic Skill Simulator.
 */

import {
    ARCHEAGE_GRADES,
    ARMOR_TYPES,
    BUILD_CATEGORIES,
    COMBAT_MODIFIERS,
    createDefaultCharacter,
    getSkillRanks,
    inferBuildArmorType,
    inferBuildCategory,
    normalizeGearTemplate,
    normalizeSavedSkillPreset,
    parseModifierToken,
    setRuntimeConstantsOverrides,
} from "../engine/index.js";
import { normalizeEquipmentList } from "../adapters/darugear.js";

export const CUSTOM_RANKS_STORAGE_KEY = "aac_damage_sim_custom_ranks_v1";
export const SAVED_BUILDS_STORAGE_KEY = "aac_damage_sim_saved_builds_v1";
export const DELETED_BUILDS_STORAGE_KEY = "aac_damage_sim_deleted_builds_v1";
export const ACTIVE_MODE_STORAGE_KEY = "aac_damage_sim_mode_v1";
export const SIM_SETTINGS_STORAGE_KEY = "aac_sim_settings_v1";
export const BUFF_LOADOUTS_STORAGE_KEY = "aac_damage_sim_buff_loadouts_v1";
export const GEAR_TEMPLATES_STORAGE_KEY = "aac_damage_sim_gear_templates_v1";
export const SKILL_BUILDS_STORAGE_KEY = "aac_damage_sim_skill_builds_v1";
export const CUSTOM_BUFFS_STORAGE_KEY = "aac_damage_sim_custom_buffs_v1";
export const DELETED_BUFFS_STORAGE_KEY = "aac_damage_sim_deleted_buffs_v1";
export const ROTATIONS_STORAGE_KEY = "aac_damage_sim_rotations_v1";
export const ECONOMY_AH_PRICES_STORAGE_KEY = "aac_damage_sim_economy_ah_prices_v1";

/**
 * True only when served from a local loopback host where `tools/serve.py` may exist.
 * Remote static hosts (such as GitHub Pages `*.github.io`) always return false so the
 * app never issues `/api/*` probes and relies strictly on browser `localStorage`.
 */
export function isLocalDiskApiHost() {
    if (typeof window === "undefined" || !window.location) return false;
    const proto = String(window.location.protocol || "").toLowerCase();
    if (proto !== "http:" && proto !== "https:") return false;
    const host = String(window.location.hostname || "").toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

export const DEFAULT_SIM_SETTINGS = Object.freeze({
    advancedMode: false,
    numberFormat: "exact", // "exact" | "abbrev"
    decimalPlaces: 1, // 0 | 1 | 2
    defenderPrimaryMetric: "hp_pct", // "hp_pct" | "raw"
    hideOffSpecTiles: false,
    autoApplyCategoryLoadouts: false,
    customCategories: [], // [{ id, label, hint, isCustom: true }]
    categoryDefaultLoadouts: {
        melee: "__keep__",
        mage: "__keep__",
        archer: "__keep__",
        healer: "__keep__",
        tank: "__keep__",
    },
    formulaOverrides: {},
});

export function slugifyCategoryId(raw) {
    const cleaned = String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/_{2,}/g, "_")
        .replace(/^[-_]+|[-_]+$/g, "");
    return cleaned.slice(0, 48);
}

export function getAllBuildCategories(settingsObj = null) {
    const s = settingsObj || state.settings || DEFAULT_SIM_SETTINGS;
    const custom = Array.isArray(s.customCategories) ? s.customCategories : [];
    return [...BUILD_CATEGORIES, ...custom];
}

export function normalizeSimSettings(raw = {}) {
    const src = raw && typeof raw === "object" ? raw : {};
    const catIn = src.categoryDefaultLoadouts && typeof src.categoryDefaultLoadouts === "object"
        ? src.categoryDefaultLoadouts
        : {};
    const formulaIn = src.formulaOverrides && typeof src.formulaOverrides === "object"
        ? { ...src.formulaOverrides }
        : {};

    const builtinIds = new Set(BUILD_CATEGORIES.map((c) => c.id));
    const seenCustom = new Set();
    const customCategories = [];
    if (Array.isArray(src.customCategories)) {
        for (const item of src.customCategories) {
            if (!item || typeof item !== "object") continue;
            const label = String(item.label || item.name || "").trim().slice(0, 40);
            const id = slugifyCategoryId(item.id || label);
            if (!label || !id || builtinIds.has(id) || seenCustom.has(id)) continue;
            seenCustom.add(id);
            customCategories.push({
                id,
                label,
                hint: String(item.hint || "Custom archetype").trim().slice(0, 80) || "Custom archetype",
                isCustom: true,
            });
        }
    }

    const allCats = [...BUILD_CATEGORIES, ...customCategories];
    const normalizedCatMap = {};
    for (const cat of allCats) {
        const baseVal = catIn[cat.id];
        normalizedCatMap[cat.id] = typeof baseVal === "string" && baseVal ? baseVal : "__keep__";
        for (const armor of ARMOR_TYPES) {
            const k = `${cat.id}:${armor.id}`;
            const v = catIn[k];
            if (typeof v === "string" && v && v !== "__inherit__") {
                normalizedCatMap[k] = v;
            }
        }
    }
    const dec = Number(src.decimalPlaces);
    return {
        advancedMode: Boolean(src.advancedMode),
        numberFormat: src.numberFormat === "abbrev" ? "abbrev" : "exact",
        decimalPlaces: Number.isFinite(dec) && dec >= 0 && dec <= 2 ? Math.round(dec) : 1,
        defenderPrimaryMetric: src.defenderPrimaryMetric === "raw" ? "raw" : "hp_pct",
        hideOffSpecTiles: Boolean(src.hideOffSpecTiles),
        autoApplyCategoryLoadouts: Boolean(src.autoApplyCategoryLoadouts),
        customCategories,
        categoryDefaultLoadouts: normalizedCatMap,
        formulaOverrides: formulaIn,
    };
}

export function loadSimSettings() {
    try {
        const raw = localStorage.getItem(SIM_SETTINGS_STORAGE_KEY);
        if (raw) {
            return normalizeSimSettings(JSON.parse(raw));
        }
    } catch {
        // Ignore storage errors
    }
    return normalizeSimSettings({});
}

export function saveSimSettings(nextSettings) {
    const normalized = normalizeSimSettings(nextSettings);
    state.settings = normalized;
    setRuntimeConstantsOverrides(normalized.formulaOverrides);
    try {
        localStorage.setItem(SIM_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
        // Ignore storage errors
    }
    return normalized;
}

/**
 * Runtime UI action bridge populated by app.js during bootstrap so
 * view modules stay decoupled with zero circular dependency hazards.
 */
export const ui = {
    renderCharacterCards: () => {},
    renderSimulation: () => {},
    renderSkillBrowser: () => {},
    updateBuffedStatsPanel: () => {},
    openGearSwapModal: () => {},
    closeGearSwapModal: () => {},
    renderGearSwapModal: () => {},
    openImportModal: () => {},
    closeImportModal: () => {},
    openBuffPullModal: () => {},
    closeBuffPullModal: () => {},
    applySavedBuildToSlot: () => {},
};

export function loadSavedMode() {
    try {
        const raw = localStorage.getItem(ACTIVE_MODE_STORAGE_KEY);
        if (
            raw &&
            ["skills", "healing", "rotation", "defender", "sweep", "matrix", "gearbuilder", "skillbuilder", "economy"].includes(
                raw
            )
        ) {
            return raw;
        }
    } catch {
        // Ignore storage errors
    }
    return "skills";
}

export function saveActiveMode(mode) {
    try {
        localStorage.setItem(ACTIVE_MODE_STORAGE_KEY, mode);
    } catch {
        // Ignore storage errors
    }
}

/**
 * Switch the active simulator mode tab, persist it, sync tab highlight & sweep toolbar,
 * and re-render the affected views.
 */
export function switchAppMode(nextMode, { renderCards = false, scrollToSim = false } = {}) {
    state.mode = nextMode;
    saveActiveMode(nextMode);
    document.querySelectorAll(".mode-tab").forEach((t) => {
        t.classList.toggle("active", t.dataset.mode === nextMode);
    });
    document.getElementById("sweepControls")?.classList.toggle("hidden", nextMode !== "sweep");
    if (renderCards) ui.renderCharacterCards();
    ui.renderSkillBrowser();
    ui.renderSimulation();
    if (scrollToSim) {
        document.getElementById("simOutput")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
}

export function saveCustomBuffLoadouts(list) {
    const clean = Array.isArray(list) ? list : [];
    try {
        localStorage.setItem(BUFF_LOADOUTS_STORAGE_KEY, JSON.stringify(clean));
    } catch {
        // Ignore storage quota errors
    }
    if (state.diskApiAvailable && window.location.protocol !== "file:") {
        return fetch("/api/buff-loadouts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ loadouts: clean }),
            keepalive: true,
        }).catch(() => {});
    }
    return Promise.resolve();
}

export function saveCustomGearTemplates(list) {
    const clean = (Array.isArray(list) ? list : []).map(normalizeGearTemplate).filter(Boolean);
    state.customGearTemplates = clean;
    try {
        localStorage.setItem(GEAR_TEMPLATES_STORAGE_KEY, JSON.stringify(clean));
    } catch {
        // Ignore storage quota errors
    }
    if (state.diskApiAvailable && window.location.protocol !== "file:") {
        return fetch("/api/gear-templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ templates: clean }),
            keepalive: true,
        }).catch(() => {});
    }
    return Promise.resolve();
}

export async function loadGearTemplatesFromDisk() {
    if (state.diskApiAvailable && window.location.protocol !== "file:") {
        try {
            const res = await fetch("/api/gear-templates", { cache: "no-store" });
            if (res.ok) {
                const json = await res.json();
                if (Array.isArray(json?.templates)) {
                    const clean = json.templates.map(normalizeGearTemplate).filter(Boolean);
                    state.customGearTemplates = clean;
                    try {
                        localStorage.setItem(GEAR_TEMPLATES_STORAGE_KEY, JSON.stringify(clean));
                    } catch {
                        // Ignore storage quota errors
                    }
                    return;
                }
            }
        } catch {
            // Fall through to localStorage
        }
    }
    try {
        const raw = localStorage.getItem(GEAR_TEMPLATES_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                state.customGearTemplates = parsed.map(normalizeGearTemplate).filter(Boolean);
                return;
            }
        }
    } catch {
        // Ignore storage errors
    }
    state.customGearTemplates = [];
}

export function saveCustomSkillBuilds(list) {
    const clean = (Array.isArray(list) ? list : []).map(normalizeSavedSkillPreset).filter(Boolean);
    state.customSkillBuilds = clean;
    try {
        localStorage.setItem(SKILL_BUILDS_STORAGE_KEY, JSON.stringify(clean));
    } catch {
        // Ignore storage quota errors
    }
    if (state.diskApiAvailable && window.location.protocol !== "file:") {
        return fetch("/api/skill-builds", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ skillBuilds: clean }),
            keepalive: true,
        }).catch(() => {});
    }
    return Promise.resolve();
}

export async function loadSkillBuildsFromDisk() {
    if (state.diskApiAvailable && window.location.protocol !== "file:") {
        try {
            const res = await fetch("/api/skill-builds", { cache: "no-store" });
            if (res.ok) {
                const json = await res.json();
                if (Array.isArray(json?.skillBuilds)) {
                    const clean = json.skillBuilds.map(normalizeSavedSkillPreset).filter(Boolean);
                    state.customSkillBuilds = clean;
                    try {
                        localStorage.setItem(SKILL_BUILDS_STORAGE_KEY, JSON.stringify(clean));
                    } catch {
                        // Ignore storage quota errors
                    }
                    return;
                }
            }
        } catch {
            // Fall through to localStorage
        }
    }
    try {
        const raw = localStorage.getItem(SKILL_BUILDS_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                state.customSkillBuilds = parsed.map(normalizeSavedSkillPreset).filter(Boolean);
                return;
            }
        }
    } catch {
        // Ignore storage errors
    }
    state.customSkillBuilds = [];
}

export async function loadBuffLoadoutsFromDisk() {
    if (state.diskApiAvailable && window.location.protocol !== "file:") {
        try {
            const res = await fetch("/api/buff-loadouts", { cache: "no-store" });
            if (res.ok) {
                const json = await res.json();
                if (Array.isArray(json?.loadouts)) {
                    state.customBuffLoadouts = json.loadouts;
                    try {
                        localStorage.setItem(BUFF_LOADOUTS_STORAGE_KEY, JSON.stringify(json.loadouts));
                    } catch {
                        // Ignore storage quota errors
                    }
                    return;
                }
            }
        } catch {
            // Fall through to localStorage / static JSON
        }
    }

    // Static hosting (GitHub Pages) or offline fallback: prefer browser localStorage
    try {
        const raw = localStorage.getItem(BUFF_LOADOUTS_STORAGE_KEY);
        if (raw !== null) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                state.customBuffLoadouts = parsed;
                return;
            }
        }
    } catch {
        // Ignore corrupted localStorage
    }

    if (window.location.protocol === "file:") return;
    try {
        const res = await fetch("buffs/loadouts.json", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (Array.isArray(json?.loadouts)) {
            state.customBuffLoadouts = json.loadouts;
            try {
                localStorage.setItem(BUFF_LOADOUTS_STORAGE_KEY, JSON.stringify(json.loadouts));
            } catch {
                // Ignore storage quota errors
            }
        }
    } catch {
        // Leave empty if file cannot be read
    }
}

export function loadCustomRanksFromStorage() {
    try {
        const raw = localStorage.getItem(CUSTOM_RANKS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

export function saveCustomRanksToStorage(map) {
    try {
        localStorage.setItem(CUSTOM_RANKS_STORAGE_KEY, JSON.stringify(map));
    } catch {
        // Ignore quota/storage errors in restricted contexts
    }
}

export function slugifyBuildId(raw) {
    const cleaned = String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^[-_]+|[-_]+$/g, "");
    return (cleaned || `build-${Date.now()}`).slice(0, 80);
}

export function loadSavedBuildsFromLocalStorage() {
    try {
        const raw = localStorage.getItem(SAVED_BUILDS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function persistSavedBuildsToLocalStorage(list) {
    try {
        localStorage.setItem(SAVED_BUILDS_STORAGE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
    } catch {
        // Ignore quota/storage errors
    }
}

export function loadDeletedBuildIdsFromLocalStorage() {
    try {
        const raw = localStorage.getItem(DELETED_BUILDS_STORAGE_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string" && x) : []);
    } catch {
        return new Set();
    }
}

export function persistDeletedBuildIdsToLocalStorage(idSet) {
    try {
        localStorage.setItem(DELETED_BUILDS_STORAGE_KEY, JSON.stringify(Array.from(idSet || [])));
    } catch {
        // Ignore quota/storage errors
    }
}

export function loadCustomBuffsFromLocalStorage() {
    try {
        const raw = localStorage.getItem(CUSTOM_BUFFS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function persistCustomBuffsToLocalStorage(list) {
    try {
        localStorage.setItem(CUSTOM_BUFFS_STORAGE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
    } catch {
        // Ignore quota/storage errors
    }
}

export function persistActiveCustomBuffsToLocalStorage() {
    const list = Object.values(COMBAT_MODIFIERS)
        .filter((m) => m && m.isCustom)
        .map((m) => ({ ...m }));
    persistCustomBuffsToLocalStorage(list);
}

export function loadDeletedBuffIdsFromLocalStorage() {
    try {
        const raw = localStorage.getItem(DELETED_BUFFS_STORAGE_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string" && x) : []);
    } catch {
        return new Set();
    }
}

export function persistDeletedBuffIdsToLocalStorage(idSet) {
    try {
        localStorage.setItem(DELETED_BUFFS_STORAGE_KEY, JSON.stringify(Array.from(idSet || [])));
    } catch {
        // Ignore quota/storage errors
    }
}

let toastTimer = null;
export function showToast(message, tone = "ok") {
    const bar = document.getElementById("toastBar");
    if (!bar) return;
    bar.textContent = message;
    bar.className = `toast-bar toast-${tone}`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        bar.classList.add("hidden");
    }, 3400);
}

export const state = {
    mode: loadSavedMode(), // "skills" | "healing" | "rotation" | "defender" | "sweep" | "matrix"
    skillsetsMeta: [],
    hasRankDump: false,
    skillsByTree: {},
    allSkills: [],
    buildA: createDefaultCharacter({ name: "Build A" }),
    buildB: createDefaultCharacter({ name: "Build B" }),
    defender: createDefaultCharacter({ name: "Target / Defender" }),
    modifiers: {
        A: new Set(),
        B: new Set(),
        defender: new Set(),
    },
    modifierStacks: {
        A: {},
        B: {},
        defender: {},
    },
    modifierRanks: {
        A: {},
        B: {},
        defender: {},
    },
    consumables: {
        A: {},
        B: {},
        defender: {},
    },
    consumablesOpen: {
        A: false,
        B: false,
        defender: false,
    },
    buffedStatsOpen: {
        A: null, // null = auto (open when buffs active, closed otherwise)
        B: null,
        defender: null,
    },
    buffedStatsView: {
        A: "changed", // "changed" | "all"
        B: "changed",
        defender: "changed",
    },
    buffFilter: {
        A: "",
        B: "",
        defender: "",
    },
    targetComboStatuses: new Set(),
    comboStatusesExpanded: false,
    defenderDisableAvoidance: false,
    defenderComboId: "__active__", // "__active__" or a saved combo id from state.customRotations
    defenderComboShield: 0,
    settings: loadSimSettings(),
    cardTab: { A: "summary", B: "summary", defender: "summary" }, // "summary" | "stats" | "buffs" | "gear"
    buildsCollapsed: typeof window !== "undefined" && window.innerWidth <= 768,
    skillPickerCollapsed: false,
    buffActiveOnly: {
        A: false,
        B: false,
        defender: false,
    },
    buffsCollapsed: {
        A: false,
        B: false,
        defender: false,
    },
    gearOpen: {
        A: true,
        B: true,
        defender: false,
    },
    selectedGearSlot: {
        A: null,
        B: null,
        defender: null,
    },
    customBuffLoadouts: [],
    customGearTemplates: [],
    customSkillBuilds: [],
    skillBuilderPresetId: "",
    gearBuilderTemplateId: "",
    gearBuilderTemplateGradeMode: "template",
    gearBuilderTemplateKeepGems: false,
    gearBuilderTplDrawerOpen: false,
    gearBuilderTplName: "",
    gearBuilderTplNotes: "",
    gearBuilderTplSelectedSlots: null,
    customRotations: [], // Loaded strictly from combos/combos.json
    activeRotationId: null,
    rotationSteps: [],
    rotationInitialEffects: [], // Extra debuffs/statuses toggled active for the whole rotation (e.g. Delirium Bleed, Puncture)
    rotationTargetShield: 0, // Target absorb shield HP pool for Rotation TTK / Kill Prob
    rotationsUpdatedAt: 0,
    rotLastSavedAt: 0,
    rotPickerTree: "all",
    rotPickerVariant: "all",
    rotPickerQuery: "",
    gearSwapTargetSlot: "B",
    gearSwapTab: "armor",
    gearSwapGemSlotId: 1, // Default: Head (Hat)
    gearSwapSynthSlotId: 0, // Default: Costume
    gearSwapTierId: null,
    gearSwapScaleAttrs: true,
    gearSwapSelectedArmorSlots: null,
    gearSwapTwoHandRatio: 1.15,
    gearSwapScaleWeaponAtk: true,
    sweepMode: "offense", // "offense" | "defender_ehp"
    sweepEhpKind: "melee", // "melee" | "ranged" | "magic"
    sweepOverlayCritNonCrit: true, // Overlay dashed Crit & Non-Crit curves on SVG chart
    matrixViewScope: "all_vs_all", // "ab_vs_roster" | "all_vs_all"
    matrixMode: "offense_skill", // "offense_skill" | "offense_rotation" | "defense_ehp" | "defense_skill"
    matrixAllMetric: "trade_ratio", // "trade_ratio" | "signature_skill" | "defender_ehp" | "healing_output" | "selected_skill" | "saved_combo"
    matrixAllComboId: "__auto__", // "__auto__" | specific saved combo id
    matrixAllHealSkillId: "songcraft_ode_to_recovery", // Default: Biggest Ode (Ode to Recovery per sec)
    matrixAllHealersOnly: false,
    matrixAllRowRole: "all", // "all" | "melee" | "mage" | "archer" | "healer" | "tank"
    matrixAllColRole: "all", // "all" | "melee" | "mage" | "archer" | "healer" | "tank"
    healingAntiHealPct: 0, // 0 | -30 (Mirror Light) | -60 (Stalker's Mark)
    matrixAllHitMode: "expected", // "expected" | "normal" | "crit"
    statWeightsTierFilter: "all", // "all" | "gem" | "synth"
    statWeightsDefKind: "melee", // "melee" | "ranged" | "magic"
    skillBuilderSlot: "A", // "A" | "B" | "defender"
    skillBuilderImportInput: "",
    gearBuilderSlot: "A", // "A" | "B" | "defender"
    gearBuilderSelectedSlotId: 15, // Default: Right Hand Weapon
    gearBuilderSearch: "",
    gearBuilderTypeFilter: "all",
    gearBuilderKeepGems: true,
    gearBuilderMigOpen: false,
    gearBuilderMigFrom: "int",
    gearBuilderMigTo: "sta",
    gearBuilderMigAmt: 50,
    matrixAllSortByRank: true,
    matrixEhpKind: "melee", // "melee" | "ranged" | "magic"
    matrixSelectedIds: null, // null = all saved builds; Set<string> otherwise
    matrixBuffMode: (() => {
        try {
            return localStorage.getItem("aac_damage_sim_matrix_buff_mode_v1") || "auto_preset";
        } catch {
            return "auto_preset";
        }
    })(), // "auto_preset" | "card3" | "none" | "saved" | "preset:<id>"
    matrixOppBuffOverrides: (() => {
        try {
            const raw = localStorage.getItem("aac_damage_sim_matrix_opp_buffs_v1");
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
            return {};
        }
    })(),
    matrixSearch: "",
    buildDiffOpen: (() => {
        try {
            return localStorage.getItem("aac_damage_sim_diff_open_v1") === "1";
        } catch {
            return false;
        }
    })(),
    diskApiAvailable: false,
    savedBuilds: [],
    loadedSavedId: {
        A: null,
        B: null,
        defender: null,
    },
    slotBaselineFp: {
        A: null,
        B: null,
        defender: null,
    },
    economyPriceBook: null,
    economyAhPrices: null,
    economyAhQuery: "",
    economyAhCategory: "all", // "all" | "gems" | "frosts" | "items"
    economyAhSyncing: false,
    economyAdvisorGoal: "auto", // "auto" | "melee_ehp" | "magic_ehp" | "ranged_ehp" | "offense_skill" | "ode_heal"
    economyPriceTab: "tiers", // "tiers" | "gems" | "overrides" | "ah"
    selectedTree: "battlerage",
    selectedVariant: "base", // "all" | "base" | "abyssal" | "ancestral" | "hollow"
    searchQuery: "",
    scope: "single", // "single" | "all"
    isCustomSkill: false,
    selectedSkillId: "battlerage_precision_strike",
    globalRankMode: "max", // "max" | "min"
    skillRanks: {}, // { [skillId]: rankNumber }
    customRanks: loadCustomRanksFromStorage(), // { [skillId]: Array<RankSpec> }
    rankEditorOpen: false,
    importSlot: null,
};

// Apply persisted formula overrides to the engine immediately at startup
setRuntimeConstantsOverrides(state.settings?.formulaOverrides || {});

// ============================================================================
// Formatting Helpers
// ============================================================================
export const fmtIntExact = (n) => Math.round(Number(n) || 0).toLocaleString();
export const fmtInt = (n) => {
    const v = Number(n) || 0;
    if (state.settings?.numberFormat === "abbrev") {
        const abs = Math.abs(v);
        if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
        if (abs >= 10_000) return `${(v / 1_000).toFixed(1)}k`;
    }
    return Math.round(v).toLocaleString();
};
export const fmtDec = (n, d) => {
    const places = d === undefined ? (state.settings?.decimalPlaces ?? 1) : d;
    return (Number(n) || 0).toFixed(places);
};
export const fmtDeltaPct = (pct) => {
    const places = state.settings?.decimalPlaces ?? 1;
    const threshold = places === 0 ? 0.5 : places === 2 ? 0.005 : 0.05;
    if (Math.abs(pct) < threshold) return `${(0).toFixed(places)}%`;
    return `${pct > 0 ? "+" : ""}${pct.toFixed(places)}%`;
};

/**
 * Apply the user-configured default buff loadout for a slot's build category
 * (inferred or explicitly overridden via character.metadata.category).
 *
 * Loadout values:
 *  - "__keep__": leave the build's existing buffs untouched
 *  - "__clear__": clear all active modifiers & consumables
 *  - <loadoutId>: apply matching preset from state.customBuffLoadouts
 */
export function applyCategoryDefaultLoadoutToSlot(slot, { force = false } = {}) {
    const settings = state.settings || DEFAULT_SIM_SETTINGS;
    if (!force && !settings.autoApplyCategoryLoadouts) return { applied: false };
    const ch = getSlotChar(slot);
    if (!ch) return { applied: false };
    const cat = inferBuildCategory(ch);
    const armorType = inferBuildArmorType(ch);
    const map = settings.categoryDefaultLoadouts || {};
    const armorSpecific = map[`${cat}:${armorType}`];
    const usedArmorVariant = Boolean(armorSpecific && armorSpecific !== "__inherit__");
    const loadoutId = usedArmorVariant ? armorSpecific : map[cat] || "__keep__";
    if (!loadoutId || loadoutId === "__keep__") {
        return { applied: false, category: cat, armorType };
    }
    if (loadoutId === "__clear__") {
        state.modifiers[slot] = new Set();
        state.modifierStacks[slot] = {};
        state.modifierRanks[slot] = {};
        state.consumables[slot] = {};
        return {
            applied: true,
            category: cat,
            armorType,
            matchedArmorVariant: usedArmorVariant,
            label: "No Buffs (Cleared)",
        };
    }
    const preset = (state.customBuffLoadouts || []).find((p) => p.id === loadoutId);
    if (!preset) return { applied: false, category: cat, armorType };
    if (Array.isArray(preset.tokens)) {
        setSlotModifiersFromTokens(slot, preset.tokens);
    } else {
        state.modifiers[slot] = new Set();
        state.modifierStacks[slot] = {};
        state.modifierRanks[slot] = {};
    }
    state.consumables[slot] =
        preset.consumables && typeof preset.consumables === "object"
            ? { ...preset.consumables }
            : {};
    return {
        applied: true,
        category: cat,
        armorType,
        matchedArmorVariant: usedArmorVariant,
        label: preset.label || preset.id,
    };
}

export function escHtml(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const TRUSTED_EXTERNAL_ICON_HOSTS = new Set([
    "darugear.com",
    "www.darugear.com",
    "aa-classic.com",
    "www.aa-classic.com",
]);

export function sanitizeSafeIconUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    const s = rawUrl.replace(/\\/g, "/").trim();
    if (!s || s.includes("..")) return "";
    if (s.startsWith("assets/")) return s;
    if (/^https?:\/\//i.test(s)) {
        try {
            const u = new URL(s);
            if ((u.protocol === "https:" || u.protocol === "http:") && TRUSTED_EXTERNAL_ICON_HOSTS.has(u.hostname.toLowerCase())) {
                return u.href;
            }
        } catch {
            return "";
        }
    }
    return "";
}

export function sanitizeSafeDaruGearUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return null;
    const s = rawUrl.trim();
    if (!s) return null;
    try {
        const u = new URL(s);
        const host = u.hostname.toLowerCase();
        if ((u.protocol === "https:" || u.protocol === "http:") && (host === "darugear.com" || host === "www.darugear.com")) {
            return u.href;
        }
    } catch {
        return null;
    }
    return null;
}

export function sanitizeHexColor(rawColor, fallback = "") {
    if (rawColor && /^#[0-9a-f]{3,8}$/i.test(String(rawColor).trim())) {
        return String(rawColor).trim();
    }
    return fallback;
}

export function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

const GRADE_BY_NAME_LC = new Map(
    ARCHEAGE_GRADES.map((g) => [String(g.name || "").toLowerCase(), g])
);

export function resolveGearGradeInfo(gradeId, gradeName, explicitColor = null) {
    let g = null;
    if (gradeId != null && gradeId !== "" && Number.isFinite(Number(gradeId))) {
        const clamped = Math.max(0, Math.min(12, Math.round(Number(gradeId))));
        g = ARCHEAGE_GRADES[clamped] || null;
    }
    if (!g && gradeName) {
        g = GRADE_BY_NAME_LC.get(String(gradeName).trim().toLowerCase()) || null;
    }
    const id = g ? g.id : 0;
    const name = g ? g.name : String(gradeName || "");
    const color =
        explicitColor && /^#[0-9a-f]{3,8}$/i.test(String(explicitColor).trim())
            ? String(explicitColor).trim()
            : g?.color || "#cbd5e1";
    return { id, name, color };
}

/**
 * Shared ArcheAge gear icon tile with official grade frame decoration (`assets/grade/gradeN.png`).
 * Reused across Character Card Gear Inspector and Economy Build Cost views.
 */
export function renderGradedGearIconHtml({
    icon = "",
    name = "",
    slotName = "",
    gradeId = null,
    gradeName = "",
    gradeColor = null,
    gemCount = 0,
    extraClass = "",
} = {}) {
    const info = resolveGearGradeInfo(gradeId, gradeName, gradeColor);
    const safeIcon = sanitizeSafeIconUrl(icon);
    const shortFallback = String(slotName || name || "EQ").slice(0, 2);
    return `<span class="gear-insp-icon-wrap ${extraClass}" style="--grade-color:${escHtml(info.color)}">${
        safeIcon
            ? `<img class="gear-insp-icon" src="${escHtml(safeIcon)}" alt="${escHtml(name)}" loading="lazy" />`
            : `<span class="gear-tile-fallback">${escHtml(shortFallback)}</span>`
    }<img class="gear-grade-frame" src="assets/grade/grade${info.id}.png" alt="" loading="lazy" />${
        gemCount > 0 ? `<span class="gear-gem-badge">${gemCount}</span>` : ""
    }</span>`;
}

// ============================================================================
// Slot Helpers (Build A, Build B, Target / Aggressor)
// ============================================================================
export function getSlotChar(slot) {
    if (slot === "A") return state.buildA;
    if (slot === "B") return state.buildB;
    return state.defender;
}

export function setSlotChar(slot, charObj) {
    if (slot === "A") state.buildA = charObj;
    else if (slot === "B") state.buildB = charObj;
    else state.defender = charObj;
}

export function setSlotModifiersFromTokens(slot, tokens = []) {
    state.modifiers[slot] = new Set();
    state.modifierStacks[slot] = {};
    state.modifierRanks[slot] = {};
    for (const tok of tokens || []) {
        const { id, stacks, rank, mod } = parseModifierToken(tok);
        if (!mod) continue;
        if (mod.exclusiveGroup) {
            for (const existingId of Array.from(state.modifiers[slot])) {
                if (COMBAT_MODIFIERS[existingId]?.exclusiveGroup === mod.exclusiveGroup && existingId !== id) {
                    state.modifiers[slot].delete(existingId);
                }
            }
        }
        state.modifiers[slot].add(id);
        if (Array.isArray(mod.ranks) && mod.ranks.length > 0 && rank != null) {
            state.modifierRanks[slot][id] = rank;
        } else if (mod.maxStacks && mod.maxStacks > 1) {
            state.modifierStacks[slot][id] = stacks;
        }
    }
}

export function getSlotChipTokens(slot) {
    const out = [];
    for (const id of state.modifiers[slot] || []) {
        const mod = COMBAT_MODIFIERS[id];
        if (mod && Array.isArray(mod.ranks) && mod.ranks.length > 1) {
            const maxRank = mod.ranks[mod.ranks.length - 1].rank;
            const r = state.modifierRanks[slot]?.[id] ?? mod.defaultRank ?? maxRank;
            out.push(`${id}:${r}`);
        } else if (mod && mod.maxStacks && mod.maxStacks > 1) {
            const st = state.modifierStacks[slot]?.[id] || mod.defaultStacks || mod.maxStacks;
            out.push(`${id}:${st}`);
        } else {
            out.push(id);
        }
    }
    return out;
}

export function getSlotModifiers(slot) {
    const chips = getSlotChipTokens(slot);
    const cons = Object.values(state.consumables[slot] || {}).filter(Boolean);
    return [...chips, ...cons];
}

export function slotUsesDefenseFields(slotKey) {
    if (state.mode === "defender") {
        return slotKey !== "defender";
    }
    if (
        state.mode === "matrix" &&
        state.matrixViewScope !== "all_vs_all" &&
        (state.matrixMode === "defense_ehp" || state.matrixMode === "defense_skill")
    ) {
        return slotKey !== "defender";
    }
    return slotKey === "defender";
}

export function getEffectiveDefenderDisableAvoidance() {
    const hasCCStatus = Array.from(state.targetComboStatuses || []).some((s) =>
        ["impaled", "tripped", "stunned"].includes(s)
    );
    return Boolean(
        ((state.mode === "defender" || state.mode === "matrix" || state.mode === "sweep") &&
            state.defenderDisableAvoidance) ||
            document.getElementById("ctxBackstab")?.checked ||
            document.getElementById("ctxCC")?.checked ||
            hasCCStatus
    );
}

export function getEquippedWeaponProcIds(ch) {
    const matched = new Set();
    if (!ch) return matched;
    const eq = normalizeEquipmentList(ch.equipment);
    const weaponItems = eq.filter((it) => it.slotId === 15 || it.slotId === 16);
    const weaponTexts = weaponItems.map((it) => `${it.type || ""} ${it.name || ""}`.toLowerCase());
    const hasBerserker3pc =
        eq.some((it) => it.slotId === 10 && /enlightened\s+berserker\s+necklace/i.test(it.name || "")) &&
        eq.some((it) => (it.slotId === 11 || it.slotId === 12) && /enlightened\s+berserker\s+earring/i.test(it.name || "")) &&
        eq.some((it) => (it.slotId === 13 || it.slotId === 14) && /enlightened\s+berserker\s+ring/i.test(it.name || ""));

    for (const mod of Object.values(COMBAT_MODIFIERS)) {
        if (mod.category !== "weapon_proc") continue;
        if (mod.id === "weapon_proc_shield" && ch.defense?.hasShield) {
            matched.add(mod.id);
            continue;
        }
        if (mod.id === "berserkers_instinct" && hasBerserker3pc) {
            matched.add(mod.id);
            continue;
        }
        const types = Array.isArray(mod.weaponTypes) ? mod.weaponTypes : [];
        if (types.some((t) => weaponTexts.some((txt) => txt.includes(t)))) {
            matched.add(mod.id);
        }
    }
    return matched;
}

export function cloneBuildSlot(fromSlot, toSlot) {
    const srcChar = getSlotChar(fromSlot);
    const cloned = JSON.parse(JSON.stringify(srcChar));
    const baseName = String(cloned.name || `Build ${fromSlot}`).replace(/\s*\(Test\)\s*$/i, "");
    cloned.name = `${baseName} (Test)`;
    setSlotChar(toSlot, cloned);
    state.modifiers[toSlot] = new Set(state.modifiers[fromSlot]);
    state.modifierStacks[toSlot] = { ...state.modifierStacks[fromSlot] };
    state.modifierRanks[toSlot] = { ...state.modifierRanks[fromSlot] };
    state.consumables[toSlot] = { ...state.consumables[fromSlot] };
    state.loadedSavedId[toSlot] = null;
    ui.renderCharacterCards();
    ui.renderSimulation();
    if (document.getElementById("gearSwapModal")?.classList.contains("open")) {
        ui.renderGearSwapModal();
    }
    showToast(`Cloned ${srcChar.name} → ${cloned.name}`, "ok");
}

/**
 * Swap two build slots cleanly (character stats, equipment, active buffs, stacks, ranks, consumables, loadedSavedId).
 */
export function swapBuildSlots(slot1, slot2) {
    if (!slot1 || !slot2 || slot1 === slot2) return;
    const c1 = getSlotChar(slot1);
    const c2 = getSlotChar(slot2);
    setSlotChar(slot1, c2);
    setSlotChar(slot2, c1);

    const swapMapKey = (obj) => {
        const tmp = obj[slot1];
        obj[slot1] = obj[slot2];
        obj[slot2] = tmp;
    };
    swapMapKey(state.modifiers);
    swapMapKey(state.modifierStacks);
    swapMapKey(state.modifierRanks);
    swapMapKey(state.consumables);
    swapMapKey(state.loadedSavedId);
    swapMapKey(state.selectedGearSlot);

    ui.renderCharacterCards();
    ui.renderSimulation();
    if (document.getElementById("gearSwapModal")?.classList.contains("open")) {
        ui.renderGearSwapModal();
    }
    const labelOf = (s) => (s === "defender" ? "Target / Def" : `Build ${s}`);
    showToast(`Swapped ${labelOf(slot1)} (${c2.name}) ↔ ${labelOf(slot2)} (${c1.name})`, "ok");
}

// ============================================================================
// Shared Skill Formatting & Context Helpers
// ============================================================================
export function getModeForceKind() {
    if (state.mode === "healing") return "heal";
    if (state.mode === "sweep" || state.mode === "defender") return "damage";
    if (state.mode === "matrix" && state.matrixMode === "defense_skill") return "damage";
    return null;
}

export function getContext() {
    return {
        isBackstab: Boolean(document.getElementById("ctxBackstab")?.checked),
        targetIsCCd: Boolean(document.getElementById("ctxCC")?.checked),
        within8m: Boolean(document.getElementById("ctxWithin8m")?.checked),
        targetBelow30Pct: Boolean(document.getElementById("ctxBelow30")?.checked),
        isPvE: Boolean(document.getElementById("ctxPvE")?.checked),
        includeSecondaryEffects: Boolean(document.getElementById("ctxSecondaryEffects")?.checked),
        comboBonusPct: parseFloat(document.getElementById("ctxComboPct")?.value) || 0,
        targetStatuses: Array.from(state.targetComboStatuses || []),
        bloodthirstStacks: parseInt(document.getElementById("ctxBloodthirst")?.value, 10) || 0,
        mettleStacks: parseInt(document.getElementById("ctxMettle")?.value, 10) || 0,
        skillRank: state.globalRankMode,
        skillRanks: { ...state.skillRanks },
        attackerModifiers: getSlotModifiers("A"),
        defenderModifiers: getSlotModifiers("defender"),
    };
}

export function buildCustomSkill() {
    const name = document.getElementById("customSkillName").value.trim() || "Custom Skill";
    const kindSel = document.getElementById("customSkillKind").value;
    const base = parseFloat(document.getElementById("customSkillBase").value) || 0;
    const scalingPct = parseFloat(document.getElementById("customSkillPct").value) || 0;
    const repeatCount = Math.max(1, parseInt(document.getElementById("customSkillHits").value, 10) || 1);
    const unavoidable = document.getElementById("customSkillUnavoidable").checked;

    const map = {
        physical_melee: { kind: "damage", damageType: "physical", scalingStat: "meleeAttack" },
        physical_ranged: { kind: "damage", damageType: "physical", scalingStat: "rangedAttack" },
        magic_spell: { kind: "damage", damageType: "magic", scalingStat: "magicAttack" },
        magic_heal: { kind: "damage", damageType: "magic", scalingStat: "healingPower" },
        heal: { kind: "heal", damageType: "heal", scalingStat: "healingPower" },
    };
    const cfg = map[kindSel] || map.physical_melee;

    return {
        id: "custom_skill",
        skillset: "custom",
        name,
        variant: "custom",
        kind: cfg.kind,
        damageType: cfg.damageType,
        scalingStat: cfg.scalingStat,
        base,
        scalingPct,
        repeatCount,
        flags: { unavoidable },
        ranks: [
            {
                rank: 1,
                label: "Custom",
                base,
                scalingPct,
                description: `Custom formula: ${base} + ${scalingPct}% ${cfg.scalingStat}${repeatCount > 1 ? ` x${repeatCount} hits` : ""}`,
            },
        ],
        description: `Custom formula: ${base} + ${scalingPct}% ${cfg.scalingStat}${repeatCount > 1 ? ` x${repeatCount} hits` : ""}`,
    };
}

export function formatFormulaShort(skill, rankSpec) {
    if (skill?.kind === "utility") {
        return skill.comboEffect?.summary || "Utility / Combo Enabler";
    }
    const src = rankSpec || skill;
    const statShort =
        {
            meleeAttack: "Melee",
            rangedAttack: "Ranged",
            magicAttack: "Magic",
            healingPower: "HPwr",
        }[skill.scalingStat] || "";

    if (src.parseSource === "shadowsmite" || skill.parseSource === "shadowsmite") {
        const bt = src.bloodthirstPerStack ?? skill.bloodthirstPerStack ?? 210;
        const bs = src.backstabScalingPct ?? skill.backstabScalingPct ?? 400;
        return `BT×${bt} (+${bs}% Backstab)`;
    }

    if (Array.isArray(src.hits) && src.hits.length > 0) {
        const totalBase = src.hits.reduce((s, h) => s + (Number(h.base) || 0), 0);
        const totalPct = src.hits.reduce((s, h) => s + (Number(h.scalingPct) || 0), 0);
        return `${src.hits.length} hits · ${fmtInt(totalBase)} + ${Math.round(totalPct)}% ${statShort}`.trim();
    }

    const base = Number(src.base) || 0;
    const pct = Number(src.scalingPct) || 0;
    const repeat = Math.max(1, Number(skill.repeatCount) || 1);
    const repeatTxt = repeat > 1 ? `${repeat}× ` : "";
    if (base > 0) {
        return `${repeatTxt}${fmtInt(base)} + ${pct}% ${statShort}`.trim();
    }
    return `${repeatTxt}${pct}% ${statShort}`.trim();
}

export function getEffectiveSkill(rawSkill) {
    if (!rawSkill) return null;
    const extras = state.customRanks[rawSkill.id];
    if (!Array.isArray(extras) || extras.length === 0) {
        return rawSkill;
    }
    const byRank = new Map();
    for (const r of getSkillRanks(rawSkill)) {
        byRank.set(Number(r.rank), r);
    }
    for (const ur of extras) {
        byRank.set(Number(ur.rank), { ...ur, isUserRank: true });
    }
    const merged = Array.from(byRank.values()).sort((a, b) => Number(a.rank) - Number(b.rank));
    return {
        ...rawSkill,
        ranks: merged,
        rankCount: merged.length,
    };
}

export function skillIconUrl(skill) {
    if (!skill?.icon) return "";
    const clean = String(skill.icon).replace(/\\/g, "/");
    return clean.startsWith("assets/") ? clean : `assets/icons/${clean}`;
}

export function formatRankTag(res) {
    if (!res) return "";
    if (res.skillId === "custom_skill") return "Custom";
    return res.availableRanks > 1
        ? `Rank ${res.selectedRank}/${res.availableRanks}`
        : `Rank ${res.selectedRank || 1}`;
}

export function formatSkillCastBadge(skill, stepRes = null) {
    if (!skill) return "";
    const baseCast = Number(skill.castTimeSec) || 0;
    if (baseCast <= 0) return "";
    if (stepRes?.castTimeRemoved) {
        const by = stepRes.castRemovedBy || "Combo";
        return `<span class="stag stag-instant-combo" title="Cast time (${baseCast}s base) removed by ${escHtml(by)} — instant cast!">&#9889; Instant (${escHtml(by)})</span>`;
    }
    return `<span class="stag stag-cast" title="Base cast time (${baseCast}s, scaled by Cast Time %; executes before post-cast GCD)">${baseCast}s cast</span>`;
}

export function formatSkillComboBadge(skill) {
    if (!skill?.comboEffect?.summary) return "";
    return `<span class="stag stag-combo" title="${escHtml(skill.description || skill.comboEffect.summary)}">&#10022; ${escHtml(skill.comboEffect.summary)}</span>`;
}

export function formatSkillGcdBadge(skill) {
    if (!skill) return "";
    const tip = skill.gcdNote ? ` title="${escHtml(skill.gcdNote)}"` : "";
    const hasCustomGcd = skill.gcdSec != null && Number.isFinite(Number(skill.gcdSec));
    const baseGcd = hasCustomGcd ? Number(skill.gcdSec) : skill.flags?.noGcd ? 0 : 1.0;
    if (baseGcd === 0) {
        if (Number(skill.fireIntervalSec) > 0) {
            return `<span class="stag stag-nogcd"${tip}>No GCD &middot; ${Number(skill.fireIntervalSec)}s/hit</span>`;
        }
        return `<span class="stag stag-nogcd"${tip}>No GCD</span>`;
    }
    if (baseGcd < 0.999) {
        return `<span class="stag stag-lowgcd"${tip}>${baseGcd}s GCD</span>`;
    }
    if (baseGcd > 1.001) {
        return `<span class="stag stag-chaingcd"${tip}>${baseGcd}s chain</span>`;
    }
    return "";
}

export function formatGcdSummaryText(d) {
    if (!d) return "";
    if (d.isOffGcd) return "Off-GCD (0s)";
    if (d.gcdKind === "rapid") return `No GCD (${fmtDec(d.effectiveFireIntervalSec, 2)}s/hit)`;
    if (d.isReducedGcd) return `${fmtDec(d.gcdSec, 2)}s reduced GCD`;
    if (d.isChainGcd) return `${fmtDec(d.gcdSec, 2)}s chain GCD`;
    return `${fmtDec(d.gcdSec, 2)}s GCD`;
}

export function formatSkillMetaShort(skill) {
    const parts = [];
    if (skill.abilityLevel != null) parts.push(`Lv ${skill.abilityLevel}`);
    if (skill.castTimeSec != null) {
        parts.push(skill.castTimeSec > 0 ? `${skill.castTimeSec}s cast` : "Instant");
    }
    if (skill.gcdSec === 0 || (skill.gcdSec == null && skill.flags?.noGcd)) {
        parts.push(Number(skill.fireIntervalSec) > 0 ? `No GCD (${skill.fireIntervalSec}s/hit)` : "No GCD");
    } else if (skill.gcdSec != null && Math.abs(Number(skill.gcdSec) - 1.0) > 1e-6) {
        parts.push(`${skill.gcdSec}s GCD`);
    }
    if (skill.cooldownSec != null && skill.cooldownSec > 0) {
        parts.push(`${skill.cooldownSec}s CD`);
    }
    return parts.join(" · ");
}

export function getModePool() {
    const forceKind = getModeForceKind();
    let list = state.allSkills.map(getEffectiveSkill);
    if (forceKind) {
        list = list.filter((s) => s.kind === forceKind);
    } else if (state.mode !== "rotation") {
        list = list.filter((s) => s.kind !== "utility");
    }
    return list;
}

export function getMatchingSkills() {
    let list = getModePool();

    if (state.selectedVariant !== "all") {
        list = list.filter((s) => (s.variant || "base") === state.selectedVariant);
    }

    const q = state.searchQuery.trim().toLowerCase();
    if (q) {
        return list.filter(
            (s) =>
                s.name.toLowerCase().includes(q) ||
                s.skillset.toLowerCase().includes(q) ||
                (s.variant || "base").toLowerCase().includes(q) ||
                (s.damageType || "").toLowerCase().includes(q)
        );
    }

    if (state.selectedTree !== "all") {
        list = list.filter((s) => s.skillset === state.selectedTree);
    }
    return list;
}

export function getActiveSkillObject(matching) {
    if (state.isCustomSkill) return buildCustomSkill();
    let active = matching.find((s) => s.id === state.selectedSkillId);
    if (!active && matching.length > 0) {
        active = matching[0];
        state.selectedSkillId = active.id;
    }
    if (!active) {
        const modePool = getModePool();
        active = modePool.find((s) => s.id === state.selectedSkillId) || modePool[0] || null;
        if (active) state.selectedSkillId = active.id;
    }
    return active;
}

export function getFilteredSkills() {
    if (state.isCustomSkill) return [buildCustomSkill()];
    const matching = getMatchingSkills();
    if (state.scope === "single" && state.mode !== "defender") {
        const active = getActiveSkillObject(matching);
        return active ? [active] : [];
    }
    return matching;
}

/**
 * Render a clean, responsive summary of all calculated stats granted by a single
 * equipped gear piece (Phys/Magic Def, Melee/Ranged/Magic Atk, Heal Power, STR/AGI/STA/INT/SPI,
 * and aggregated equip/frost/gem/synthesis bonus effects).
 */
export function renderItemGrantedStatsHtml(granted) {
    if (!granted) return "";
    const mainEntries = [];
    const m = granted.main || {};
    if (m.pdef > 0) mainEntries.push({ lbl: "Phys Def", val: fmtInt(m.pdef), cls: "is-def" });
    if (m.mdef > 0) mainEntries.push({ lbl: "Magic Def", val: fmtInt(m.mdef), cls: "is-def" });
    if (m.meleeAttack > 0) mainEntries.push({ lbl: "Melee Atk", val: fmtDec(m.meleeAttack, 1), cls: "is-atk" });
    if (m.rangedAttack > 0) mainEntries.push({ lbl: "Ranged Atk", val: fmtDec(m.rangedAttack, 1), cls: "is-atk" });
    if (m.magicAttack > 0) mainEntries.push({ lbl: "Magic Atk", val: fmtDec(m.magicAttack, 1), cls: "is-atk" });
    if (m.healingPower > 0) mainEntries.push({ lbl: "Heal Power", val: fmtDec(m.healingPower, 1), cls: "is-heal" });

    const a = granted.attributes || {};
    const attrEntries = [
        ["STR", a.str],
        ["AGI", a.agi],
        ["STA", a.sta],
        ["INT", a.int],
        ["SPI", a.spi],
    ].filter(([, v]) => Number(v) !== 0);

    const equipEffects = Array.isArray(granted.equipEffects) ? granted.equipEffects : [];
    const enchantBonuses = Array.isArray(granted.enchantBonuses)
        ? granted.enchantBonuses
        : Array.isArray(granted.bonuses)
          ? granted.bonuses
          : [];
    const enchantNotes = Array.isArray(granted.enchantNotes) ? granted.enchantNotes : [];
    const setEffects = Array.isArray(granted.setEffects) ? granted.setEffects : [];
    const gs = Number(granted.gearScore) || 0;
    if (
        mainEntries.length === 0 &&
        attrEntries.length === 0 &&
        equipEffects.length === 0 &&
        enchantBonuses.length === 0 &&
        enchantNotes.length === 0 &&
        setEffects.length === 0 &&
        gs <= 0
    ) {
        return "";
    }

    const fmtBonusVal = (b) => {
        const sign = b.value > 0 ? "+" : "";
        const numStr =
            b.unit === "%" || Math.abs(b.value % 1) > 1e-4
                ? fmtDec(b.value, 1)
                : fmtInt(b.value);
        return `${sign}${numStr}${b.unit || ""}`;
    };

    const setBlocksHtml =
        setEffects.length > 0
            ? `<div class="gb-is-sets-wrap">
                   ${setEffects
                       .map((grp) => {
                           const kindCls =
                               grp.sourceKind === "charm"
                                   ? `is-charm ${grp.active ? "is-active" : "is-inactive"}`
                                   : grp.sourceKind === "lunafrost"
                                     ? "is-erenor"
                                     : "";
                           const cntText = grp.statusLabel || `${grp.equippedCount}/${grp.maxPieces} pc`;
                           return `
                   <div class="gb-is-set-block ${kindCls}">
                       <div class="gb-is-set-head">
                           <span class="gb-is-set-name">${grp.sourceKind === "charm" ? "&#10022; " : ""}${escHtml(grp.name)}</span>
                           <span class="gb-is-set-cnt">${escHtml(cntText)}</span>
                       </div>
                       <div class="gb-is-set-tiers">
                           ${(grp.tiers || [])
                               .map(
                                   (t) =>
                                       `<div class="gb-is-set-tier ${t.active ? "is-active" : "is-inactive"}"><span class="gb-is-tier-pc">${t.numPieces}pc</span><span>${escHtml(t.summary)}</span></div>`
                               )
                               .join("")}
                       </div>
                   </div>`;
                       })
                       .join("")}
               </div>`
            : "";

    const enchantNotesHtml =
        enchantNotes.length > 0
            ? `<div class="gb-is-notes-wrap">${enchantNotes
                  .map(
                      (n) =>
                          `<div class="gb-is-note"><strong>${escHtml(n.name)}:</strong> <span>${escHtml(n.text)}</span></div>`
                  )
                  .join("")}</div>`
            : "";

    return `
    <div class="gb-item-stats-box">
        <div class="gb-item-stats-head">
            <span class="gb-item-stats-lbl">Granted Stats</span>
            ${gs > 0 ? `<span class="gb-item-gs-pill">${fmtDec(gs, 1).replace(/\.0$/, "")} GS</span>` : ""}
        </div>
        ${
            mainEntries.length > 0
                ? `<div class="gb-is-main-row">${mainEntries
                      .map(
                          (e) =>
                              `<span class="gb-is-chip ${e.cls}"><span>${escHtml(e.lbl)}</span><strong>${escHtml(e.val)}</strong></span>`
                      )
                      .join("")}</div>`
                : ""
        }
        ${
            attrEntries.length > 0
                ? `<div class="gb-is-attr-row">${attrEntries
                      .map(
                          ([k, v]) =>
                              `<span class="gb-is-attr-chip">${escHtml(k)} <strong>${v > 0 ? "+" : ""}${fmtInt(v)}</strong></span>`
                      )
                      .join("")}</div>`
                : ""
        }
        ${
            equipEffects.length > 0
                ? `<div class="gb-is-sub-sec">
                       <div class="gb-is-sub-lbl">Equip Effects</div>
                       <div class="gb-is-equip-row">${equipEffects
                           .map(
                               (b) =>
                                   `<span class="gb-is-equip-chip">${escHtml(b.label)} <strong>${escHtml(fmtBonusVal(b))}</strong></span>`
                           )
                           .join("")}</div>
                   </div>`
                : ""
        }
        ${
            enchantBonuses.length > 0
                ? `<div class="gb-is-sub-sec">
                       <div class="gb-is-sub-lbl">Frost / Gems / Synth</div>
                       <div class="gb-is-bonus-row">${enchantBonuses
                           .map(
                               (b) =>
                                   `<span class="gb-is-bonus-chip">${escHtml(b.label)} <strong>${escHtml(fmtBonusVal(b))}</strong></span>`
                           )
                           .join("")}</div>
                   </div>`
                : ""
        }
        ${enchantNotesHtml}
        ${setBlocksHtml}
    </div>`;
}
