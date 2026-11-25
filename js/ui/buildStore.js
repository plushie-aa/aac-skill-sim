/**
 * Saved Build Persistence (disk /api/builds + localStorage fallback),
 * Slot Hydration, JSON Export/Download, and DaruGear Optional Buff Unbaking.
 */

import {
    COMBAT_MODIFIERS,
    applyOverrides,
    createBlankGearBuild,
    findModifierForDaruGearBuff,
    getGearCatalog,
    loadGearCatalog,
    registerCustomModifiers,
    unapplyModifiers,
} from "../engine/index.js";
import {
    normalizeBuildMetadata,
    normalizeEquipmentList,
    parseImportPayload,
} from "../adapters/darugear.js";
import {
    applyCategoryDefaultLoadoutToSlot,
    getSlotChar,
    getSlotChipTokens,
    isLocalDiskApiHost,
    loadDeletedBuildIdsFromLocalStorage,
    loadSavedBuildsFromLocalStorage,
    persistActiveCustomBuffsToLocalStorage,
    persistDeletedBuildIdsToLocalStorage,
    persistSavedBuildsToLocalStorage,
    setSlotChar,
    setSlotModifiersFromTokens,
    showToast,
    slugifyBuildId,
    state,
    switchAppMode,
    ui,
} from "./state.js";

async function loadBuildsManifestFromDir(dirName) {
    try {
        const res = await fetch(`${dirName}/_index.json`, { cache: "no-store" });
        if (!res.ok) return [];
        const manifest = await res.json();
        const files = Array.isArray(manifest?.files) ? manifest.files : [];
        const loaded = await Promise.all(
            files.map(async (f) => {
                try {
                    const r = await fetch(`${dirName}/${f}`, { cache: "no-store" });
                    if (!r.ok) return null;
                    const data = await r.json();
                    if (data && typeof data === "object") {
                        data.savedId = data.savedId || f.replace(/\.json$/i, "");
                        data.filename = data.filename || `${dirName}/${f}`;
                        if (dirName === "example-builds") data.isExample = true;
                        return data;
                    }
                } catch {
                    return null;
                }
                return null;
            })
        );
        return loaded.filter(Boolean);
    } catch {
        return [];
    }
}

async function loadStaticBuildsManifest() {
    // On GitHub Pages / non-loopback static hosts, load tracked `example-builds/` directly
    // (personal `builds/` is gitignored and not deployed to Pages, so this avoids 404 probes).
    if (!isLocalDiskApiHost()) {
        return loadBuildsManifestFromDir("example-builds");
    }
    const localStatic = await loadBuildsManifestFromDir("builds");
    if (localStatic.length > 0) return localStatic;
    return loadBuildsManifestFromDir("example-builds");
}

export async function loadSavedBuilds() {
    if (isLocalDiskApiHost()) {
        try {
            const res = await fetch("/api/builds", { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                if (data && data.ok && Array.isArray(data.builds)) {
                    state.diskApiAvailable = true;
                    state.savedBuilds = data.builds;
                    // Mirror disk builds into browser localStorage backup
                    persistSavedBuildsToLocalStorage(state.savedBuilds);
                    return;
                }
            }
        } catch {
            // Local static server without /api/builds; fall back to localStorage + static seed
        }
    }

    // GitHub Pages / static hosting mode: never call /api/* — persist strictly via localStorage
    state.diskApiAvailable = false;
    const deletedIds = loadDeletedBuildIdsFromLocalStorage();
    const localOnly = loadSavedBuildsFromLocalStorage().filter((b) => b?.savedId && !deletedIds.has(b.savedId));
    const diskStatic = await loadStaticBuildsManifest();
    const byId = new Map();
    for (const b of diskStatic) {
        if (b?.savedId && !deletedIds.has(b.savedId)) byId.set(b.savedId, b);
    }
    for (const b of localOnly) byId.set(b.savedId, b);
    state.savedBuilds = Array.from(byId.values()).sort((a, b) =>
        String(b.savedAt || "").localeCompare(String(a.savedAt || ""))
    );
    persistSavedBuildsToLocalStorage(state.savedBuilds);
}

/**
 * Automatically match or pull (via /api/buffs/import) every optional DaruGear buff
 * that was active on DaruGear when the build was exported, subtract ("unbake") its
 * stat contributions from the imported character's base stats so nothing is double-counted,
 * and activate the corresponding simulator buff chip or consumable slot so it can be toggled off.
 */
export async function importAndUnbakeDaruGearBuffs(
    character,
    existingTokens = [],
    existingConsumables = {}
) {
    const ch = applyOverrides(character, {});
    const meta = normalizeBuildMetadata(ch);
    const dgBuffs = Array.isArray(meta.darugearBuffs)
        ? meta.darugearBuffs.map((b) => ({ ...b }))
        : [];
    const tokens = Array.isArray(existingTokens) ? [...existingTokens] : [];
    const consumables =
        existingConsumables && typeof existingConsumables === "object"
            ? { ...existingConsumables }
            : {};
    const tokenBaseIds = new Set(tokens.map((t) => String(t).split(":")[0]));

    const tokensToUnbake = [];
    const unbakedNames = [];
    const pulledNames = [];
    const warnings = [];

    for (const b of dgBuffs) {
        if (!b.isOptional) continue;

        let mod = findModifierForDaruGearBuff(b);
        if (!mod && b.id && state.diskApiAvailable) {
            try {
                const res = await fetch("/api/buffs/import", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ buffId: b.id }),
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.ok && data.buff) {
                    registerCustomModifiers([data.buff]);
                    persistActiveCustomBuffsToLocalStorage();
                    mod = COMBAT_MODIFIERS[data.buff.id] || data.buff;
                    pulledNames.push(mod.name);
                } else if (data.error) {
                    warnings.push(`Could not auto-pull DaruGear buff "${b.name}" (#${b.id}): ${data.error}`);
                }
            } catch (err) {
                warnings.push(`Could not auto-pull DaruGear buff "${b.name}" (#${b.id}): ${err.message}`);
            }
        }

        if (!mod) {
            if (!b.unbaked) {
                warnings.push(
                    `DaruGear buff "${b.name}"${b.id ? ` (#${b.id})` : ""} could not be matched automatically (stats remain baked into base).`
                );
            }
            continue;
        }

        // Match exact Rank N from DaruGear buff name (e.g. "Health Lift (Rank 5)", "Magic Shield (Rank 2)")
        // so ranked buffs unbake and activate at their true DaruGear rank instead of defaulting to max rank.
        let modToken = mod.id;
        if (Array.isArray(mod.ranks) && mod.ranks.length > 0) {
            const rankMatch = String(b.name || "").match(/\bRank\s+(\d+)\b/i);
            if (rankMatch) {
                const rNum = Number(rankMatch[1]);
                if (mod.ranks.some((r) => Number(r.rank) === rNum)) {
                    modToken = `${mod.id}:${rNum}`;
                }
            }
        }

        const alreadyActive =
            mod.category === "consumable" && mod.slot
                ? consumables[mod.slot] === mod.id
                : tokenBaseIds.has(mod.id);

        if (!alreadyActive) {
            if (mod.category === "consumable" && mod.slot) {
                consumables[mod.slot] = mod.id;
            } else {
                tokens.push(modToken);
                tokenBaseIds.add(mod.id);
            }
        }

        if (!b.unbaked) {
            tokensToUnbake.push(modToken);
            b.unbaked = true;
            unbakedNames.push(mod.name);
        }
        b.mappedModId = mod.id;
    }

    let nextChar = ch;
    if (tokensToUnbake.length > 0) {
        nextChar = unapplyModifiers(ch, tokensToUnbake);
    }
    meta.darugearBuffs = dgBuffs;
    nextChar.metadata = meta;
    nextChar.shareUrl = meta.darugearUrl;
    nextChar.darugearUrl = meta.darugearUrl;
    nextChar.shareCode = meta.shareCode;
    nextChar.className = meta.className;

    return {
        character: nextChar,
        tokens,
        consumables,
        unbakedNames,
        pulledNames,
        warnings,
    };
}

export function computeSlotCharacterFingerprint(ch) {
    if (!ch || typeof ch !== "object") return "";
    return JSON.stringify({
        name: ch.name || "",
        gearScore: Number(ch.gearScore) || 0,
        maxHealth: Number(ch.maxHealth) || 0,
        maxMana: Number(ch.maxMana) || 0,
        baseAttributes: ch.baseAttributes || null,
        attributes: ch.attributes || {},
        offense: ch.offense || {},
        defense: ch.defense || {},
        category: ch.metadata?.category || null,
        equipment: (Array.isArray(ch.equipment) ? ch.equipment : []).map((it) => ({
            slotId: it.slotId,
            name: it.name,
            gradeId: it.gradeId,
            gradeName: it.gradeName,
            temper: it.temper,
            lunafrost: it.lunafrost?.name || "",
            lunagems: (it.lunagems || []).map((g) => g.name),
            synthStats: it.synthStats || [],
        })),
        skillBuild: ch.skillBuild || null,
    });
}

export function isSlotDirty(slot) {
    if (!state.loadedSavedId[slot] || !state.slotBaselineFp?.[slot]) return false;
    const ch = getSlotChar(slot);
    return computeSlotCharacterFingerprint(ch) !== state.slotBaselineFp[slot];
}

export function resetSlotToSaved(slot) {
    const savedId = state.loadedSavedId[slot];
    if (!savedId) return false;
    const found = state.savedBuilds.find((b) => b.savedId === savedId);
    if (!found) return false;
    const ok = applySavedBuildToSlot(slot, found);
    if (ok) {
        ui.renderCharacterCards();
        ui.renderSimulation();
        showToast(
            `Reset ${slot === "defender" ? "Target / Defender" : `Build ${slot}`} to saved "${found.name || found.savedId}"`,
            "ok"
        );
    }
    return ok;
}

export function applySavedBuildToSlot(slot, buildObj) {
    if (!buildObj) return false;
    const parsed = parseImportPayload(buildObj);
    if (!parsed.ok) return false;
    setSlotChar(slot, parsed.character);
    setSlotModifiersFromTokens(slot, parsed.modifiers || []);
    state.consumables[slot] = { ...(parsed.consumables || {}) };
    state.loadedSavedId[slot] = buildObj.savedId || null;
    state.slotBaselineFp[slot] = computeSlotCharacterFingerprint(parsed.character);

    // Auto-apply category default buff loadout if enabled in Settings
    applyCategoryDefaultLoadoutToSlot(slot);

    // Auto-sync any optional DaruGear buffs that are either not yet unbaked OR whose custom buff needs pulling
    const needsSync = (parsed.character.metadata?.darugearBuffs || []).some(
        (b) => b.isOptional && (!b.unbaked || !findModifierForDaruGearBuff(b))
    );
    if (needsSync) {
        importAndUnbakeDaruGearBuffs(
            parsed.character,
            parsed.modifiers || [],
            parsed.consumables || {}
        ).then((syncRes) => {
            if (syncRes.unbakedNames.length === 0 && syncRes.pulledNames.length === 0) return;
            // Only apply if this build is still loaded in the slot
            if (state.loadedSavedId[slot] !== (buildObj.savedId || null)) return;
            setSlotChar(slot, syncRes.character);
            state.slotBaselineFp[slot] = computeSlotCharacterFingerprint(syncRes.character);
            setSlotModifiersFromTokens(slot, syncRes.tokens);
            state.consumables[slot] = { ...syncRes.consumables };
            applyCategoryDefaultLoadoutToSlot(slot);
            ui.renderCharacterCards();
            ui.renderSimulation();
            if (syncRes.pulledNames.length > 0) {
                showToast(`Auto-imported DaruGear buff: ${syncRes.pulledNames.join(", ")}`, "ok");
            }
        });
    }
    return true;
}

export function hydrateDefaultSlotsFromDisk() {
    if (state.savedBuilds.length === 0) return;
    const byId = (id) => state.savedBuilds.find((b) => b.savedId === id);

    const pickA = byId("melee-crit-build") || byId("example-darkrunner-melee") || state.savedBuilds[0];
    const pickB =
        byId("melee-def-pen-build") ||
        byId("example-spellsinger-mage") ||
        state.savedBuilds[1] ||
        state.savedBuilds[0];
    const pickDef =
        byId("leather-target-6-2k-gs") ||
        byId("example-skullknight-tank") ||
        state.savedBuilds[state.savedBuilds.length - 1];

    if (pickA) applySavedBuildToSlot("A", pickA);
    if (pickB) applySavedBuildToSlot("B", pickB);
    if (pickDef) applySavedBuildToSlot("defender", pickDef);
}

export function buildExportPayload(character, modifiersArr = [], consumablesObj = {}) {
    const clean = applyOverrides(character, {});
    const metadata = normalizeBuildMetadata(clean);
    const out = {
        schemaVersion: clean.schemaVersion || 1,
        name: clean.name,
        source: metadata.source,
        metadata,
        shareUrl: metadata.darugearUrl,
        darugearUrl: metadata.darugearUrl,
        shareCode: metadata.shareCode,
        className: metadata.className,
        level: clean.level,
        gearScore: metadata.gearScore,
        maxHealth: clean.maxHealth,
        maxMana: clean.maxMana,
        ...(clean.rawDaruGear?.player
            ? {
                  baseAttributes: {
                      str: Math.round(Number(clean.rawDaruGear.player.str ?? 158)),
                      agi: Math.round(Number(clean.rawDaruGear.player.dex ?? 158)),
                      sta: Math.round(Number(clean.rawDaruGear.player.sta ?? 158)),
                      int: Math.round(Number(clean.rawDaruGear.player.int ?? 158)),
                      spi: Math.round(Number(clean.rawDaruGear.player.spi ?? 158)),
                  },
              }
            : clean.baseAttributes
              ? { baseAttributes: { ...clean.baseAttributes } }
              : {}),
        attributes: clean.attributes,
        offense: clean.offense,
        defense: clean.defense,
        modifiers: Array.isArray(modifiersArr) ? [...modifiersArr] : [],
        consumables: consumablesObj && typeof consumablesObj === "object" ? { ...consumablesObj } : {},
    };
    const eq = normalizeEquipmentList(clean.equipment);
    if (eq.length > 0 || clean.source === "gearbuilder") out.equipment = eq;
    if (clean.skillBuild && typeof clean.skillBuild === "object") {
        out.skillBuild = {
            trees: Array.isArray(clean.skillBuild.trees) ? [...clean.skillBuild.trees] : [],
            className: clean.skillBuild.className || metadata.className || null,
            activeSkills: Array.isArray(clean.skillBuild.activeSkills) ? [...clean.skillBuild.activeSkills] : [],
            passives: Array.isArray(clean.skillBuild.passives) ? [...clean.skillBuild.passives] : [],
            ancestralChoices:
                clean.skillBuild.ancestralChoices && typeof clean.skillBuild.ancestralChoices === "object"
                    ? { ...clean.skillBuild.ancestralChoices }
                    : {},
            hatredTree: clean.skillBuild.hatredTree || null,
            bakedPassives: Array.isArray(clean.skillBuild.bakedPassives) ? [...clean.skillBuild.bakedPassives] : [],
        };
    }
    if (clean.savedId) out.savedId = clean.savedId;
    return out;
}

/**
 * Create a brand-new blank Lv 55 character build (no armor/weapons equipped), load it into
 * `slotKey`, clear active buffs/consumables, and optionally save it immediately to disk/browser
 * storage as a new `.json` build.
 */
export async function createBlankBuildForSlot(
    slotKey,
    { name = null, saveToStore = true, openGearBuilder = false, catalog = null } = {}
) {
    const cleanName = String(name ?? "").trim();
    if (!cleanName) return null;
    const cat = catalog || getGearCatalog() || (await loadGearCatalog());
    const blankChar = createBlankGearBuild(cleanName, {}, cat);

    let activeChar = blankChar;
    let savedRes = null;
    if (saveToStore) {
        savedRes = await saveBuildToStore(blankChar, [], {});
        if (savedRes?.ok && savedRes.build) {
            activeChar = { ...savedRes.build, rawDaruGear: blankChar.rawDaruGear };
        }
    }

    setSlotChar(slotKey, activeChar);
    setSlotModifiersFromTokens(slotKey, []);
    state.consumables[slotKey] = {};
    state.loadedSavedId[slotKey] = savedRes?.ok ? savedRes.id : null;
    state.slotBaselineFp[slotKey] = savedRes?.ok ? computeSlotCharacterFingerprint(activeChar) : null;

    ui.renderCharacterCards();
    if (openGearBuilder) {
        state.gearBuilderSlot = slotKey;
        switchAppMode("gearbuilder", { scrollToSim: true });
    } else {
        ui.renderSimulation();
    }

    if (savedRes?.ok) {
        showToast(
            `Created blank build "${cleanName}" (${savedRes.mode === "disk" ? savedRes.filename : "browser storage"})`,
            "ok"
        );
    } else {
        showToast(`Created blank build "${cleanName}" (unsaved — click Save As Build to write .json)`, "ok");
    }
    return { ok: true, character: activeChar, saved: savedRes };
}

export function serializeSlotBuild(slot) {
    return buildExportPayload(
        getSlotChar(slot),
        getSlotChipTokens(slot),
        state.consumables[slot] || {}
    );
}

export async function saveBuildToStore(character, modifiersArr = [], consumablesObj = {}) {
    const payload = buildExportPayload(character, modifiersArr, consumablesObj);
    const id = slugifyBuildId(payload.name);
    payload.savedId = id;

    // Clear any prior static-mode deletion tombstone if re-saving this build ID
    const deletedIds = loadDeletedBuildIdsFromLocalStorage();
    if (deletedIds.delete(id)) {
        persistDeletedBuildIdsToLocalStorage(deletedIds);
    }

    if (state.diskApiAvailable) {
        const res = await fetch("/api/builds", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        const saved = data.build || payload;
        state.savedBuilds = [
            saved,
            ...state.savedBuilds.filter((b) => b.savedId !== saved.savedId),
        ];
        // Always mirror disk builds to browser localStorage backup
        persistSavedBuildsToLocalStorage(state.savedBuilds);
        return { ok: true, mode: "disk", id: data.id, filename: data.filename, build: saved };
    }

    // GitHub Pages / static hosting: store exclusively in browser localStorage
    payload.filename = `${id}.json`;
    payload.savedAt = new Date().toISOString();
    state.savedBuilds = [
        payload,
        ...state.savedBuilds.filter((b) => b.savedId !== id),
    ];
    persistSavedBuildsToLocalStorage(state.savedBuilds);
    return { ok: true, mode: "local", id, filename: payload.filename, build: payload };
}

export async function deleteSavedBuildFromStore(buildId) {
    if (!buildId) return false;
    if (state.diskApiAvailable) {
        const res = await fetch(`/api/builds/${encodeURIComponent(buildId)}`, {
            method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
    } else {
        const deletedIds = loadDeletedBuildIdsFromLocalStorage();
        deletedIds.add(buildId);
        persistDeletedBuildIdsToLocalStorage(deletedIds);
    }
    state.savedBuilds = state.savedBuilds.filter((b) => b.savedId !== buildId);
    persistSavedBuildsToLocalStorage(state.savedBuilds);
    for (const s of ["A", "B", "defender"]) {
        if (state.loadedSavedId[s] === buildId) state.loadedSavedId[s] = null;
    }
    return true;
}

export function downloadSlotBuildJson(slot) {
    const payload = serializeSlotBuild(slot);
    const slug = slugifyBuildId(payload.name);
    const filename = `${slug}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Downloaded ${filename}`, "ok");
}
