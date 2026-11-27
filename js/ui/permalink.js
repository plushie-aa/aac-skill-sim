/**
 * Shareable Comparison Permalinks (URL Hash encode/decode).
 * Encodes Build A, Build B, Defender (via DaruGear share code or savedId),
 * active mode tab, selected skill/tree, active modifiers/consumables, and
 * combat context flags into a compact URL hash for sharing on static hosts or locally.
 */

import { COMBAT_MODIFIERS } from "../engine/index.js";
import {
    extractDaruGearShareCode,
    fetchDaruGearBuild,
    normalizeBuildMetadata,
} from "../adapters/darugear.js";
import {
    getSlotChar,
    getSlotChipTokens,
    saveActiveMode,
    setSlotChar,
    setSlotModifiersFromTokens,
    state,
} from "./state.js";
import {
    applySavedBuildToSlot,
    importAndUnbakeDaruGearBuffs,
} from "./buildStore.js";

const VALID_MODES = new Set([
    "skills",
    "healing",
    "rotation",
    "defender",
    "sweep",
    "matrix",
    "gearbuilder",
    "skillbuilder",
    "economy",
]);

function encodeSlotRef(slotKey) {
    const ch = getSlotChar(slotKey);
    const meta = normalizeBuildMetadata(ch);
    const dgCode =
        meta.shareCode ||
        extractDaruGearShareCode(meta.darugearUrl || ch?.darugearUrl || ch?.shareUrl || "");
    if (dgCode && /^[A-Za-z0-9_-]{3,32}$/.test(dgCode)) {
        return `dg:${dgCode}`;
    }
    const savedId = state.loadedSavedId[slotKey];
    if (savedId && /^[a-z0-9_-]{1,80}$/i.test(savedId)) {
        return `id:${savedId}`;
    }
    return null;
}

function encodeSlotBuffTokens(slotKey) {
    const chips = getSlotChipTokens(slotKey);
    const cons = Object.values(state.consumables[slotKey] || {}).filter(Boolean);
    const all = [...chips, ...cons];
    return all.length > 0 ? all.slice(0, 32).join(",") : null;
}

export function buildComparisonPermalink() {
    const params = new URLSearchParams();
    if (state.mode && state.mode !== "skills") params.set("mode", state.mode);

    const refA = encodeSlotRef("A");
    const refB = encodeSlotRef("B");
    const refD = encodeSlotRef("defender");
    if (refA) params.set("a", refA);
    if (refB) params.set("b", refB);
    if (refD) params.set("d", refD);

    if (state.selectedTree && state.selectedTree !== "battlerage") {
        params.set("tree", state.selectedTree);
    }
    if (state.selectedSkillId) {
        params.set("skill", state.selectedSkillId);
    }

    const ma = encodeSlotBuffTokens("A");
    const mb = encodeSlotBuffTokens("B");
    const md = encodeSlotBuffTokens("defender");
    params.set("ma", ma || "");
    params.set("mb", mb || "");
    params.set("md", md || "");

    const ctxFlags = [];
    if (document.getElementById("ctxBackstab")?.checked) ctxFlags.push("bs");
    if (document.getElementById("ctxCC")?.checked) ctxFlags.push("cc");
    if (document.getElementById("ctxPvE")?.checked) ctxFlags.push("pve");
    if (state.defenderDisableAvoidance) ctxFlags.push("noav");
    if (ctxFlags.length > 0) params.set("ctx", ctxFlags.join(","));

    const hash = params.toString();
    const base = `${window.location.origin}${window.location.pathname}`;
    return hash ? `${base}#${hash}` : base;
}

function applySlotTokensAndConsumables(slotKey, rawCsv) {
    const tokens = String(rawCsv || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const chipTokens = [];
    const consMap = {};
    for (const tok of tokens) {
        const baseId = tok.split(":")[0];
        const mod = Object.prototype.hasOwnProperty.call(COMBAT_MODIFIERS, baseId)
            ? COMBAT_MODIFIERS[baseId]
            : null;
        if (!mod) continue;
        if (mod.category === "consumable" && mod.slot) {
            consMap[mod.slot] = mod.id;
        } else {
            chipTokens.push(tok);
        }
    }
    setSlotModifiersFromTokens(slotKey, chipTokens);
    state.consumables[slotKey] = consMap;
}

async function resolveSlotFromRef(slotKey, rawRef) {
    const ref = String(rawRef || "").trim();
    if (!ref) return false;

    if (ref.startsWith("id:")) {
        const sid = ref.slice(3).trim();
        const found = state.savedBuilds.find((b) => b.savedId === sid);
        if (found) return applySavedBuildToSlot(slotKey, found);
        return false;
    }

    const code = ref.startsWith("dg:") ? ref.slice(3).trim() : ref;
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(code)) return false;

    // 1. Check already-loaded saved builds for a matching DaruGear share code first (instant)
    const matchedSaved = state.savedBuilds.find((b) => {
        const sc =
            b.shareCode ||
            b.metadata?.shareCode ||
            extractDaruGearShareCode(b.darugearUrl || b.shareUrl || b.metadata?.darugearUrl || "");
        return sc && sc.toLowerCase() === code.toLowerCase();
    });
    if (matchedSaved) {
        return applySavedBuildToSlot(slotKey, matchedSaved);
    }

    // 2. Otherwise fetch directly from DaruGear (works on both serve.py and static hosts!)
    try {
        const fetched = await fetchDaruGearBuild(code);
        if (!fetched?.ok || !fetched.character) return false;
        const syncRes = await importAndUnbakeDaruGearBuffs(
            fetched.character,
            fetched.modifiers || [],
            fetched.consumables || {}
        );
        setSlotChar(slotKey, syncRes.character);
        setSlotModifiersFromTokens(slotKey, syncRes.tokens || []);
        state.consumables[slotKey] = { ...(syncRes.consumables || {}) };
        state.loadedSavedId[slotKey] = null;
        return true;
    } catch {
        return false;
    }
}

export async function applyComparisonPermalinkFromHash() {
    const rawHash = (window.location.hash || "").replace(/^#/, "").trim();
    if (!rawHash || !rawHash.includes("=")) return { applied: false };

    const params = new URLSearchParams(rawHash);
    const hasRelevant = ["a", "b", "d", "mode", "skill", "tree", "ma", "mb", "md", "ctx"].some((k) =>
        params.has(k)
    );
    if (!hasRelevant) return { applied: false };

    const mode = params.get("mode");
    if (mode && VALID_MODES.has(mode)) {
        state.mode = mode;
        saveActiveMode(mode);
        document.querySelectorAll(".mode-tab").forEach((t) => {
            t.classList.toggle("active", t.dataset.mode === state.mode);
        });
        document.getElementById("sweepControls")?.classList.toggle("hidden", state.mode !== "sweep");
    }

    const tree = params.get("tree");
    if (tree) state.selectedTree = tree;

    const skill = params.get("skill");
    if (skill) {
        state.selectedSkillId = skill;
        const foundSkill = state.allSkills.find((s) => s.id === skill);
        if (foundSkill) {
            if (!tree) state.selectedTree = foundSkill.skillset;
            if (foundSkill.variant && foundSkill.variant !== "base") {
                state.selectedVariant = "all";
            }
        }
    }

    await Promise.all([
        params.has("a") ? resolveSlotFromRef("A", params.get("a")) : Promise.resolve(false),
        params.has("b") ? resolveSlotFromRef("B", params.get("b")) : Promise.resolve(false),
        params.has("d") ? resolveSlotFromRef("defender", params.get("d")) : Promise.resolve(false),
    ]);

    if (params.has("ma")) applySlotTokensAndConsumables("A", params.get("ma"));
    if (params.has("mb")) applySlotTokensAndConsumables("B", params.get("mb"));
    if (params.has("md")) applySlotTokensAndConsumables("defender", params.get("md"));

    if (params.has("ctx")) {
        const flags = new Set(
            String(params.get("ctx") || "")
                .split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean)
        );
        const setChk = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.checked = val;
        };
        setChk("ctxBackstab", flags.has("bs"));
        setChk("ctxCC", flags.has("cc"));
        setChk("ctxPvE", flags.has("pve"));
        state.defenderDisableAvoidance = flags.has("noav");
    }

    return { applied: true };
}
