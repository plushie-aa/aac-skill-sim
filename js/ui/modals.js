/**
 * Import Build Modal & Pull Buff by AA Classic ID Modal.
 */

import {
    COMBAT_MODIFIERS,
    registerCustomModifiers,
    unregisterCustomModifier,
} from "../engine/index.js";
import {
    escHtml,
    fmtInt,
    loadCustomBuffsFromLocalStorage,
    loadDeletedBuffIdsFromLocalStorage,
    persistActiveCustomBuffsToLocalStorage,
    persistCustomBuffsToLocalStorage,
    persistDeletedBuffIdsToLocalStorage,
    sanitizeSafeIconUrl,
    showToast,
    state,
    ui,
} from "./state.js";

export function openImportModal(slot) {
    state.importSlot = slot;
    document.getElementById("importModalTitle").textContent =
        slot === "defender" ? "Import Target / Defender (DaruGear URL or JSON)" : `Import Build ${slot} (DaruGear URL or JSON)`;
    document.getElementById("importNameInput").value = "";
    document.getElementById("importDarugearInput").value = "";
    document.getElementById("importTextarea").value = "";
    document.getElementById("importFileInput").value = "";
    document.getElementById("importFeedback").innerHTML = "";
    const saveLbl = document.getElementById("importSaveDiskLabel");
    if (saveLbl) {
        saveLbl.innerHTML = state.diskApiAvailable
            ? `Also save build to disk (<code>builds/&lt;name&gt;.json</code>)`
            : `Also save build to browser storage (use <code>&darr; .json</code> to download to disk)`;
    }
    document.getElementById("importModal").classList.add("open");
    document.getElementById("importDarugearInput").focus();
}

export function closeImportModal() {
    document.getElementById("importModal").classList.remove("open");
    state.importSlot = null;
}

let buffPullState = {
    fetchedMod: null,
    fetchedRaw: null,
    defaultSide: null,
    defaultDebuff: null,
};

export async function loadCustomBuffs() {
    if (state.diskApiAvailable && window.location.protocol !== "file:") {
        try {
            const res = await fetch("/api/buffs", { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                if (data?.ok && Array.isArray(data.buffs)) {
                    registerCustomModifiers(data.buffs);
                    persistCustomBuffsToLocalStorage(data.buffs);
                    return;
                }
            }
        } catch {
            // Fall back to localStorage / static manifest when /api/buffs is unavailable
        }
    }

    const deletedIds = loadDeletedBuffIdsFromLocalStorage();
    const localBuffs = loadCustomBuffsFromLocalStorage().filter((b) => b?.id && !deletedIds.has(b.id));
    let staticBuffs = [];

    if (window.location.protocol !== "file:") {
        try {
            const idxRes = await fetch("buffs/_index.json", { cache: "no-store" });
            if (idxRes.ok) {
                const idx = await idxRes.json();
                const files = Array.isArray(idx?.files) ? idx.files : [];
                const loaded = await Promise.all(
                    files.map(async (fname) => {
                        try {
                            const r = await fetch(`buffs/${fname}`, { cache: "no-store" });
                            return r.ok ? await r.json() : null;
                        } catch {
                            return null;
                        }
                    })
                );
                staticBuffs = loaded.filter((b) => b?.id && !deletedIds.has(b.id));
            }
        } catch {
            // No static custom buffs directory
        }
    }

    const byId = new Map();
    for (const b of staticBuffs) byId.set(b.id, b);
    for (const b of localBuffs) byId.set(b.id, b);
    const merged = Array.from(byId.values());
    if (merged.length > 0) {
        registerCustomModifiers(merged);
    }
    persistActiveCustomBuffsToLocalStorage();
}

export async function deleteCustomBuffById(modId) {
    const mod = COMBAT_MODIFIERS[modId];
    if (!mod || !mod.isCustom) return;
    if (state.diskApiAvailable) {
        try {
            const res = await fetch(`/api/buffs/${encodeURIComponent(modId)}`, { method: "DELETE" });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err.error || "Failed to delete custom buff", "err");
                return;
            }
        } catch {
            showToast("Failed to reach local server to delete custom buff", "err");
            return;
        }
    } else {
        const deletedIds = loadDeletedBuffIdsFromLocalStorage();
        deletedIds.add(modId);
        persistDeletedBuffIdsToLocalStorage(deletedIds);
    }

    unregisterCustomModifier(modId);
    persistActiveCustomBuffsToLocalStorage();
    for (const s of ["A", "B", "defender"]) {
        state.modifiers[s].delete(modId);
        delete state.modifierStacks[s][modId];
        delete state.modifierRanks[s][modId];
    }
    ui.renderCharacterCards();
    ui.renderSimulation();
    showToast(`Removed custom buff "${mod.name}"`, "ok");
}

function summarizeBuffStatPills(mod) {
    const pills = [];
    if (mod.addMaxHealth)
        pills.push({ text: `Max HP ${mod.addMaxHealth > 0 ? "+" : ""}${fmtInt(mod.addMaxHealth)}`, util: false });
    if (mod.addAttributes) {
        for (const [k, v] of Object.entries(mod.addAttributes)) {
            pills.push({ text: `${k.toUpperCase()} ${v > 0 ? "+" : ""}${v}`, util: false });
        }
    }
    const pushMap = (obj, isMul) => {
        if (!obj) return;
        for (const [k, v] of Object.entries(obj)) {
            if (isMul) {
                const pct = Math.round((v - 1) * 1000) / 10;
                pills.push({ text: `${k} ${pct >= 0 ? "+" : ""}${pct}%`, util: false });
            } else {
                const isPct = k.endsWith("Pct");
                pills.push({ text: `${k} ${v > 0 ? "+" : ""}${v}${isPct ? "%" : ""}`, util: false });
            }
        }
    };
    pushMap(mod.addOffense, false);
    pushMap(mod.mulOffense, true);
    pushMap(mod.addDefense, false);
    pushMap(mod.mulDefense, true);
    if (mod.pveDamageBonusPct) pills.push({ text: `PvE Dmg +${mod.pveDamageBonusPct}%`, util: false });
    if (mod.pveReceivedDrPct) pills.push({ text: `PvE DR +${mod.pveReceivedDrPct}%`, util: false });
    if (mod.maxStacks > 1) pills.push({ text: `Stackable 1-${mod.maxStacks}${mod.stackUnit || "x"}`, util: false });
    if (Array.isArray(mod.unmappedModifiers)) {
        for (const u of mod.unmappedModifiers) {
            pills.push({ text: u, util: true });
        }
    }
    return pills;
}

function extractEditableStatJson(mod) {
    const out = {};
    for (const k of [
        "addMaxHealth",
        "addAttributes",
        "addOffense",
        "mulOffense",
        "addDefense",
        "mulDefense",
        "pveDamageBonusPct",
        "pveReceivedDrPct",
        "maxStacks",
        "defaultStacks",
        "stackUnit",
    ]) {
        if (mod[k] !== undefined) out[k] = mod[k];
    }
    return out;
}

export function openBuffPullModal(defaultSide = null, defaultDebuff = null) {
    buffPullState = {
        fetchedMod: null,
        fetchedRaw: null,
        defaultSide,
        defaultDebuff,
    };
    const idInput = document.getElementById("buffIdInput");
    const fetchBtn = document.getElementById("buffFetchBtn");
    const fb = document.getElementById("buffFetchFeedback");
    idInput.value = "";
    document.getElementById("buffPreviewArea").classList.add("hidden");
    document.getElementById("buffSaveBtn").disabled = true;

    const canPull = Boolean(state.diskApiAvailable);
    idInput.disabled = !canPull;
    fetchBtn.disabled = !canPull;
    fb.innerHTML = canPull
        ? ""
        : `<div class="msg-warn">Live AA Classic Buff Pull is disabled in static hosting mode because <code>aa-classic.com</code> requires the local Python proxy (<code>python tools/serve.py</code>).</div>`;

    document.getElementById("buffImportModal").classList.add("open");
    if (canPull) setTimeout(() => idInput.focus(), 30);
}

export function closeBuffPullModal() {
    document.getElementById("buffImportModal").classList.remove("open");
}

export function renderBuffPullPreview() {
    const mod = buffPullState.fetchedMod;
    const raw = buffPullState.fetchedRaw;
    if (!mod) return;

    const previewArea = document.getElementById("buffPreviewArea");
    previewArea.classList.remove("hidden");

    const iconEl = document.getElementById("buffPreviewIcon");
    const iconUrl = sanitizeSafeIconUrl(mod.remoteIcon || mod.icon || "");
    if (iconUrl) {
        iconEl.src = iconUrl;
        iconEl.classList.remove("hidden");
    } else {
        iconEl.classList.add("hidden");
    }

    document.getElementById("buffPreviewName").value = mod.name || "";
    document.getElementById("buffPreviewIdTag").textContent = `#${mod.aacBuffId || raw?.id || "?"}`;
    document.getElementById("buffPreviewDesc").textContent = mod.description || raw?.description || "";
    document.getElementById("buffPreviewSide").value = mod.side || "attacker";
    document.getElementById("buffPreviewKind").value = mod.isDebuff ? "debuff" : "buff";

    const pills = summarizeBuffStatPills(mod);
    const statsEl = document.getElementById("buffPreviewStats");
    if (pills.length > 0) {
        statsEl.innerHTML = pills
            .map((p) => `<span class="buff-stat-pill ${p.util ? "util" : ""}">${escHtml(p.text)}</span>`)
            .join("");
    } else {
        statsEl.innerHTML = `<span class="msg-warn">AA Classic reports empty static modifiers (likely a tick/scripted buff). Expand "Edit stat JSON" below to enter custom stat values before saving.</span>`;
    }

    const jsonBox = document.getElementById("buffPreviewJson");
    jsonBox.value = JSON.stringify(extractEditableStatJson(mod), null, 2);
    document.getElementById("buffSaveBtn").disabled = false;
}

export async function handleFetchBuffById() {
    if (!state.diskApiAvailable) return;
    const rawInput = document.getElementById("buffIdInput").value.trim();
    const fb = document.getElementById("buffFetchFeedback");
    const fetchBtn = document.getElementById("buffFetchBtn");
    if (!rawInput) {
        fb.innerHTML = `<div class="msg-error">Enter a numeric AA Classic buff ID or URL (e.g. 1668).</div>`;
        return;
    }

    fetchBtn.disabled = true;
    fb.innerHTML = `<div class="hint-inline">Fetching from aa-classic.com&hellip;</div>`;
    try {
        const res = await fetch(`/api/buffs/fetch?id=${encodeURIComponent(rawInput)}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        buffPullState.fetchedMod = data.buff;
        buffPullState.fetchedRaw = data.raw || null;
        if (
            buffPullState.defaultSide &&
            !data.buff.addOffense &&
            !data.buff.mulOffense &&
            !data.buff.addDefense &&
            !data.buff.mulDefense
        ) {
            buffPullState.fetchedMod.side = buffPullState.defaultSide;
        }
        if (buffPullState.defaultDebuff === true && !data.raw?.kind) {
            buffPullState.fetchedMod.isDebuff = true;
        }
        fb.innerHTML = "";
        renderBuffPullPreview();
    } catch (err) {
        document.getElementById("buffPreviewArea").classList.add("hidden");
        document.getElementById("buffSaveBtn").disabled = true;
        fb.innerHTML = `<div class="msg-error">${escHtml(err.message)} (requires <code>python tools/serve.py</code>)</div>`;
    } finally {
        fetchBtn.disabled = false;
    }
}

export async function handleSavePulledBuff() {
    if (!state.diskApiAvailable) return;
    const baseMod = buffPullState.fetchedMod;
    if (!baseMod) return;
    const fb = document.getElementById("buffFetchFeedback");
    const saveBtn = document.getElementById("buffSaveBtn");

    const ALLOWED_CUSTOM_BUFF_STAT_KEYS = new Set([
        "addOffense",
        "mulOffense",
        "addDefense",
        "mulDefense",
        "addAttributes",
        "addMaxHealth",
        "pveDamageBonusPct",
        "pveReceivedDrPct",
        "maxStacks",
        "defaultStacks",
        "stackUnit",
    ]);

    let customStats = {};
    try {
        const rawJson = document.getElementById("buffPreviewJson").value.trim();
        if (rawJson) {
            const parsed = JSON.parse(rawJson);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error("Stat JSON must be a JSON object (e.g. { \"addOffense\": { ... } })");
            }
            for (const [k, v] of Object.entries(parsed)) {
                if (ALLOWED_CUSTOM_BUFF_STAT_KEYS.has(k)) {
                    customStats[k] = v;
                }
            }
        }
    } catch (err) {
        fb.innerHTML = `<div class="msg-error">Invalid stat JSON: ${escHtml(err.message)}</div>`;
        return;
    }

    const name = document.getElementById("buffPreviewName").value.trim() || baseMod.name;
    const side = document.getElementById("buffPreviewSide").value || "attacker";
    const isDebuff = document.getElementById("buffPreviewKind").value === "debuff";

    const modToSave = {
        id: baseMod.id,
        aacBuffId: baseMod.aacBuffId,
        name,
        side,
        isCustom: true,
        description: baseMod.description,
        icon: baseMod.icon,
        unmappedModifiers: baseMod.unmappedModifiers,
        ...customStats,
    };
    if (isDebuff) modToSave.isDebuff = true;

    saveBtn.disabled = true;
    try {
        const res = await fetch("/api/buffs/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                modifier: modToSave,
                rawIcon: buffPullState.fetchedRaw?.icon || "",
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        registerCustomModifiers([data.buff]);
        persistActiveCustomBuffsToLocalStorage();
        ui.renderCharacterCards();
        ui.renderSimulation();
        closeBuffPullModal();
        showToast(`Imported "${data.buff.name}" -> ${data.filename}`, "ok");
    } catch (err) {
        fb.innerHTML = `<div class="msg-error">Save failed: ${escHtml(err.message)}</div>`;
    } finally {
        saveBtn.disabled = false;
    }
}
