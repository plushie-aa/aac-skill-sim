/**
 * DaruGear-Style 20-Slot Gear Builder View:
 *  - Authentic 20-slot paperdoll (Armor left, Live Stats center, Accessories right, Weapons bottom)
 *  - Instant item search + type filters across all 7,000+ AA Classic 3.5 items
 *  - Grade, Physical/Magic Temper (100-115%), Lunafrost, Lunagem sockets (+ Fill All),
 *    Synthesis % & Synthesis Stat pickers, and Title selector
 *  - Exact live recalculation via DaruGear formulas (`recomputeGearBuffs` + `calculateDaruGearStats`)
 */

import {
    COSTUME_CHARM_DEFS,
    GEAR_TEMPLATE_SLOT_GROUPS,
    STAT_MIGRATION_MAX_DELTA,
    STAT_MIGRATION_MIN_DELTA,
    applyGearTemplateToSlots,
    applyLunafrostToEligibleSlots,
    applyModifiers,
    applyStatMigrationTransfer,
    buildAhLookupIndex,
    computeActiveSetEffectSummaries,
    computeEffectiveStats,
    computeGearItemGrantedStats,
    createEmptyGearSlots,
    describeGearBuffEffects,
    ensureCharacterRawDaruGear,
    equipArmorSetPreset,
    equipCatalogItemInSlot,
    estimateBuildCost,
    extractGearTemplateFromSlots,
    fillAllSlotLunagems,
    filterItemsForSlot,
    filterLunafrostsForSlot,
    filterLunagemsForSlot,
    getArmorSetPresets,
    getAvailableSynthPool,
    getGearCatalog,
    getItemTypesForSlot,
    getMaxSocketsForSlotAndGrade,
    getPlayerStatMigration,
    getSynthPoolIndexForStat,
    getSynthSlotCountForGrade,
    getT7ObsidianSpecialEffect,
    loadGearCatalog,
    normalizeEconomyPriceBook,
    recalculateCharacterFromGearBuilder,
    recomputeGearBuffs,
    resetPlayerStatMigration,
    resolveCostumeCharmInfo,
    resolveGearIconUrl,
    setGearPlayerTitle,
    setPlayerStatMigration,
    setSlotItemGrade,
    setSlotItemLunafrost,
    setSlotItemLunagem,
    setSlotItemSynthPercent,
    setSlotItemSynthStat,
    setSlotItemTemper,
    unequipGearSlot,
} from "../engine/index.js";
import { fetchDaruGearBuild } from "../adapters/darugear.js";
import { computeSlotCharacterFingerprint, createBlankBuildForSlot, saveBuildToStore } from "./buildStore.js";
import { loadEconomyPriceBookFromStorage } from "./economyView.js";
import {
    escHtml,
    fmtDec,
    fmtInt,
    getEffectiveDefenderDisableAvoidance,
    getSlotChar,
    getSlotChipTokens,
    getSlotModifiers,
    renderItemGrantedStatsHtml,
    saveCustomGearTemplates,
    setSlotChar,
    showToast,
    state,
    switchAppMode,
    ui,
} from "./state.js";

let _loadingCatalog = false;

const TEMPERABLE_TYPES = new Set([
    "Cloth", "Leather", "Plate", "Shield", "Bow",
    "Dagger", "Sword", "Katana", "Axe", "Shortspear", "Club", "Scepter",
    "Obsidian Katana", "Obsidian Shortspear", "Offhand Magic Dagger",
    "Offhand Healing Scepter", "Offhand Dagger",
    "Longspear", "Nodachi", "Greatsword", "GreatAxe", "Warclub",
    "Greatclub", "Staff", "Scythe",
]);

function getActiveGearState(slotKey, catalog) {
    const ch = getSlotChar(slotKey);
    const { slots, player, reconstructed } = ensureCharacterRawDaruGear(ch, catalog);
    if (!ch.rawDaruGear) {
        ch.rawDaruGear = { slots, player };
    }
    return { ch, slots, player, reconstructed };
}

function commitGearChange(slotKey, nextSlots, nextPlayer, catalog, toastMsg = null) {
    const ch = getSlotChar(slotKey);
    const { character: updatedChar } = recalculateCharacterFromGearBuilder(ch, nextSlots, nextPlayer, catalog);
    setSlotChar(slotKey, updatedChar);
    state.loadedSavedId[slotKey] = null;
    ui.updateBuffedStatsPanel(slotKey);
    ui.renderCharacterCards();
    ui.renderSimulation();
    if (toastMsg) showToast(toastMsg, "ok");
}

const PICKER_EQUIP_EFFECT_LABELS = Object.freeze({
    6: "Max HP",
    7: "Max Mana",
    8: "Phys Def",
    10: "Move Spd",
    17: "Melee Crit Dmg",
    26: "Ranged Crit Dmg",
    31: "Magic Crit Dmg",
    33: "Melee Atk",
    34: "Ranged Atk",
    35: "Magic Atk",
    51: "Melee Skill Dmg",
    52: "Ranged Skill Dmg",
    53: "Magic Skill Dmg",
    54: "Atk Spd",
    56: "Recv Heal",
    57: "Def Pen",
    58: "Recv Dmg",
    64: "Magic Def",
    71: "Cast Time",
    77: "Melee Crit",
    81: "Parry",
    82: "Ranged Crit",
    86: "Magic Crit",
    120: "Healing %",
    143: "Recv Melee Dmg",
    145: "Recv Ranged Dmg",
    147: "Recv Magic Dmg",
    175: "Heal Power",
    176: "Heal Crit Dmg",
    179: "Block",
    180: "Evasion",
    181: "Focus",
    182: "Toughness",
    183: "Resilience",
    184: "Magic Def Pen",
    185: "Heal Crit",
    204: "Shield Pen Rate",
    206: "Shield Def Pen",
});

function formatCatalogItemVariantHint(it) {
    if (!it || typeof it !== "object") return "";
    const parts = [];
    const wArr = Array.isArray(it.w) ? it.w : null;
    const weights = [
        ["STR", Number(wArr ? wArr[0] : it.str_weight) || 0],
        ["AGI", Number(wArr ? wArr[1] : it.dex_weight) || 0],
        ["STA", Number(wArr ? wArr[2] : it.sta_weight) || 0],
        ["SPI", Number(wArr ? wArr[3] : it.spi_weight) || 0],
        ["INT", Number(wArr ? wArr[4] : it.int_weight) || 0],
    ].filter(([, w]) => w > 0);
    const totalW = weights.reduce((s, [, w]) => s + w, 0);
    if (totalW > 0) {
        if (weights.length === 1) {
            parts.push(`Pure ${weights[0][0]}`);
        } else {
            parts.push(weights.map(([k, w]) => `${Math.round((w / totalW) * 100)}% ${k}`).join(" / "));
        }
    }

    if (Array.isArray(it.equipeffects) && it.equipeffects.length > 0) {
        const seenAttr = new Set();
        const effLabels = [];
        for (const ef of it.equipeffects) {
            const aid = Number(ef?.unit_attribute_id);
            if (!aid || seenAttr.has(aid)) continue;
            seenAttr.add(aid);
            const lbl = PICKER_EQUIP_EFFECT_LABELS[aid];
            if (lbl) effLabels.push(lbl);
            if (effLabels.length >= 2) break;
        }
        if (effLabels.length > 0) {
            parts.push(`+${effLabels.join(", ")}`);
        }
    }
    const t7 = getT7ObsidianSpecialEffect(it.id);
    if (t7?.shortText) {
        parts.push(`★ ${t7.shortText}`);
    }
    return parts.join(" · ");
}

function fmtCompactGold(val) {
    const n = Math.round(Number(val) || 0);
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}Mg`;
    if (n >= 10_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")}kg`;
    return `${fmtInt(n)}g`;
}

function renderItemResultsHtml(slotId, query, typeFilter, catalog, ahIndex = null) {
    const matches = filterItemsForSlot(slotId, { query, typeFilter, limit: 80 }, catalog);
    if (matches.length === 0) {
        return `<div class="hint-inline" style="padding:8px">No items match your search.</div>`;
    }
    const showAh = slotId !== 19 && ahIndex !== null;
    // Detect duplicate names in results so we highlight variant IDs when needed
    const nameCounts = new Map();
    for (const it of matches) {
        const k = String(it.name || "").toLowerCase();
        nameCounts.set(k, (nameCounts.get(k) || 0) + 1);
    }
    return matches
        .map((it) => {
            const ic = resolveGearIconUrl(it.img);
            const gMax = catalog.gradeById.get(it.maxgrade);
            const ahEntry = showAh ? ahIndex.items.get(String(it.name || "").trim().toLowerCase()) || null : null;
            const variantHint = formatCatalogItemVariantHint(it);
            const isDup = (nameCounts.get(String(it.name || "").toLowerCase()) || 0) > 1;
            return `
            <div class="gb-item-row" data-gb-equip-id="${it.id}">
                <span class="gb-item-ic">
                    ${ic ? `<img src="${escHtml(ic)}" alt="" loading="lazy" data-img-fb="hide" />` : ""}
                </span>
                <div class="gb-item-info">
                    <div class="gb-item-name">${escHtml(it.name)}${isDup ? ` <span class="gb-item-id-tag">#${it.id}</span>` : ""}</div>
                    <div class="gb-item-meta">${escHtml(it.type)} &bull; Lv ${it.level}${gMax ? ` &bull; up to ${escHtml(gMax.name)}` : ""}${ahEntry ? ` &bull; <span class="gb-ah-hint">AH ${fmtInt(ahEntry.gold)}g</span>` : ""}</div>
                    ${variantHint ? `<div class="gb-item-variant-hint">${escHtml(variantHint)}</div>` : ""}
                </div>
                <button type="button" class="sm primary" data-gb-equip-id="${it.id}">Equip</button>
            </div>`;
        })
        .join("");
}

export function renderGearBuilderView(out) {
    const catalog = getGearCatalog();
    if (!catalog) {
        out.innerHTML = `<div class="gb-loading">Loading ArcheAge Classic 3.5 Gear Catalog (7,000+ items, gems, frosts &amp; synthesis pools)...</div>`;
        if (!_loadingCatalog) {
            _loadingCatalog = true;
            loadGearCatalog()
                .then(() => {
                    _loadingCatalog = false;
                    if (state.mode === "gearbuilder") ui.renderSimulation();
                })
                .catch((err) => {
                    _loadingCatalog = false;
                    out.innerHTML = `<div class="msg-error">Failed to load Gear Catalog: ${escHtml(err.message)}</div>`;
                });
        }
        return;
    }

    const slotKey = ["A", "B", "defender"].includes(state.gearBuilderSlot) ? state.gearBuilderSlot : "A";
    const selSlotId = Number.isFinite(Number(state.gearBuilderSelectedSlotId))
        ? Number(state.gearBuilderSelectedSlotId)
        : 15; // Default to Right Hand Weapon
    const { ch, slots, player } = getActiveGearState(slotKey, catalog);
    const gearBuffs = recomputeGearBuffs(slots, player, catalog);

    const slotMods = getSlotModifiers(slotKey);
    const oppSlot = slotKey === "defender" ? "A" : "defender";
    const effSelf = applyModifiers(ch, slotMods);
    const effOpp = applyModifiers(getSlotChar(oppSlot), getSlotModifiers(oppSlot));
    const isPvE = Boolean(document.getElementById("ctxPvE")?.checked);
    const disAvoid = getEffectiveDefenderDisableAvoidance();
    const effStats = computeEffectiveStats(effSelf, effOpp, {}, { isPvE, disableAvoidance: disAvoid });

    const existingCode = ch.shareCode || ch.metadata?.shareCode || "";
    const curTitleId = player?.title?.id ? Number(player.title.id) : 0;

    // Live Economy Cost Estimate (reuses Economy price book + synced AH prices)
    const priceBook = normalizeEconomyPriceBook(state.economyPriceBook || loadEconomyPriceBookFromStorage());
    const ahPrices = state.economyAhPrices || null;
    const ahIndex = priceBook.useAhPrices !== false && ahPrices ? buildAhLookupIndex(ahPrices) : null;
    const buildCost = estimateBuildCost(ch, priceBook, catalog, ahPrices);
    const slotCostById = new Map(buildCost.slotBreakdown.map((entry) => [Number(entry.slotId), entry]));

    const bySlotId = new Map(slots.map((s) => [Number(s.id), s]));
    const leftSlotIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const rightSlotIds = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

    const renderPaperdollSlot = (sid) => {
        const s = bySlotId.get(sid) || { id: sid, name: `Slot ${sid}`, item: null };
        const it = s.item;
        const isSel = sid === selSlotId;
        const frameId = it ? Math.max(0, Math.min(12, Number(it.grade?.id) || 0)) : 0;
        const canonicalGrade = it ? catalog.gradeById.get(frameId) || it.grade : null;
        const gColor = canonicalGrade?.colour || "#475569";
        const ic = it?.equipment?.img ? resolveGearIconUrl(it.equipment.img) : "";
        const maxS = it ? getMaxSocketsForSlotAndGrade(sid, it.grade) : 0;
        const filledS = it && Array.isArray(it.lunagem) ? it.lunagem.filter((g) => g && g.id !== 0).length : 0;
        const tempStr =
            it && (Number(it.ptemper) > 100 || Number(it.mtemper) > 100)
                ? `${Math.max(Number(it.ptemper) || 100, Number(it.mtemper) || 100)}%`
                : "";
        const slotCost = slotCostById.get(sid) || null;
        const charmInfo = sid === 0 && it?.lunafrost ? resolveCostumeCharmInfo(it.lunafrost, slots, slotMods) : null;
        const costumeEnchantPillHtml =
            sid === 0 && it?.lunafrost
                ? charmInfo
                    ? `<div class="gb-pd-charm ${charmInfo.active ? "is-active" : "is-inactive"}" title="${escHtml(`${charmInfo.name} (${charmInfo.statusLabel}): ${charmInfo.fullDesc}`)}">&#10022; ${escHtml(charmInfo.name)} <span class="gb-pd-charm-st">${charmInfo.active ? (charmInfo.activeByGear ? `${charmInfo.enlightenedCount}/2` : "Active") : `${charmInfo.enlightenedCount}/2`}</span></div>`
                    : `<div class="gb-pd-charm is-active" title="${escHtml(`${it.lunafrost.name}${it.lunafrost.effect_text ? ` — ${it.lunafrost.effect_text}` : ""}`)}">&#10022; ${escHtml(it.lunafrost.name)}</div>`
                : "";
        const costTooltip = slotCost
            ? ` — Est. ${fmtInt(slotCost.slotTotalGold)}g (Gear ${fmtInt(slotCost.baseGold)}g${slotCost.gemsGold > 0 ? `, Gems ${fmtInt(slotCost.gemsGold)}g` : ""}${slotCost.frostGold > 0 ? `, Frost ${fmtInt(slotCost.frostGold)}g` : ""})`
            : "";
        return `
        <div class="gb-pd-slot ${isSel ? "active" : ""} ${it ? "filled" : "empty"} ${charmInfo?.active ? "has-active-charm" : ""}" data-gb-select-slot="${sid}" style="${it ? `border-color:${escHtml(gColor)}` : ""}" title="${it ? `${escHtml(canonicalGrade?.name || "")} ${escHtml(it.equipment.name)} (${escHtml(s.name)})${charmInfo ? ` · ${escHtml(charmInfo.name)} (${escHtml(charmInfo.statusLabel)})` : ""}${escHtml(costTooltip)}` : `Empty ${escHtml(s.name)} — click to equip`}">
            <span class="gb-pd-icon ${it ? "has-grade" : ""}">
                ${ic ? `<img src="${escHtml(ic)}" alt="" loading="lazy" data-img-fb="hide" />` : `<span class="gb-pd-empty-lbl">${escHtml(s.name.slice(0, 2))}</span>`}
                ${it ? `<img class="gear-grade-frame" src="assets/grade/grade${frameId}.png" alt="" loading="lazy" />` : ""}
            </span>
            <div class="gb-pd-text">
                <div class="gb-pd-slotname">${escHtml(s.name)}</div>
                <div class="gb-pd-itemname" style="${it ? `color:${escHtml(gColor)}` : ""}">${it ? escHtml(it.equipment.name) : "Empty"}</div>
                ${
                    it
                        ? `<div class="gb-pd-sub">${escHtml(canonicalGrade?.name || "")}${tempStr ? ` &middot; ${tempStr}` : ""}${maxS > 0 ? ` &middot; ${filledS}/${maxS}g` : ""}${it.lunafrost && sid !== 0 ? " &middot; LF" : ""}${slotCost ? ` &middot; <span class="gb-pd-gold">${fmtCompactGold(slotCost.slotTotalGold)}</span>` : ""}</div>`
                        : ""
                }
                ${costumeEnchantPillHtml}
            </div>
            ${it ? `<button type="button" class="gb-pd-rm" data-gb-unequip="${sid}" title="Unequip ${escHtml(s.name)}">&times;</button>` : ""}
        </div>`;
    };

    // Active Slot Inspector (Right Column)
    const activeSlot = bySlotId.get(selSlotId) || { id: selSlotId, name: `Slot ${selSlotId}`, item: null };
    const activeItem = activeSlot.item;
    const itemTypes = getItemTypesForSlot(selSlotId, catalog);
    const curTypeFilter =
        state.gearBuilderTypeFilter && (state.gearBuilderTypeFilter === "all" || itemTypes.includes(state.gearBuilderTypeFilter))
            ? state.gearBuilderTypeFilter
            : "all";
    const curSearch = state.gearBuilderSearch || "";
    const keepGemsFrost = state.gearBuilderKeepGems !== false;

    let equippedEditorHtml = "";
    if (activeItem?.equipment) {
        const eq = activeItem.equipment;
        const gObj = activeItem.grade || catalog.gradeById.get(9);
        const validGrades = catalog.grades.filter((g) => g.id >= (eq.mingrade ?? 0) && g.id <= (eq.maxgrade ?? 12));
        const isTemperable = TEMPERABLE_TYPES.has(eq.type);

        // Lunafrost picker (with Erenor Lunafrost set-bonus labels & 1-click Apply Set action)
        const validFrosts = filterLunafrostsForSlot(selSlotId, activeItem, catalog);
        const curFrostId = activeItem.lunafrost?.id ? Number(activeItem.lunafrost.id) : 0;
        const ERENOR_FROST_SET_HINTS = {
            454: "Set 3/4/6pc: Tough +452, Resil +560, Melee Crit Dmg +18.6%",
            455: "Set 3/4/6pc: Tough +452, Resil +560, Ranged Crit Rate +4.1%",
            456: "Set 3/4/6pc: Tough +452, Resil +560, Recv Dmg -4.1%",
            457: "Set 3/4/6pc: Tough +452, Resil +560, Magic Skill Dmg +4.1%",
            458: "Set 3/4/6pc: Tough +452, Resil +560, Crit Heal Rate +4.1%",
        };
        const curFrostMeta = curFrostId ? catalog.frostById?.get(curFrostId) : null;
        const isCurErenorFrost = Boolean(curFrostMeta && ERENOR_FROST_SET_HINTS[curFrostMeta.eiset_id]);
        const eligibleForCurFrost = isCurErenorFrost
            ? slots.filter(
                  (s) =>
                      s?.item?.equipment &&
                      filterLunafrostsForSlot(s.id, s.item, catalog).some((f) => Number(f.id) === curFrostId)
              ).length
            : 0;
        const curFrostCharm = activeItem.lunafrost ? resolveCostumeCharmInfo(activeItem.lunafrost, slots, slotMods) : null;
        const curFrostFullDescHtml = curFrostCharm
            ? `<div class="gb-frost-full-desc ${curFrostCharm.active ? "is-active" : "is-inactive"}">
                   <div class="gb-frost-desc-head">
                       <span>&#10022; ${escHtml(curFrostCharm.setName)} (2-Set)</span>
                       <span class="gb-is-set-cnt">${escHtml(curFrostCharm.statusLabel)}</span>
                   </div>
                   <div class="gb-frost-desc-body">${escHtml(curFrostCharm.fullDesc)}</div>
               </div>`
            : activeItem.lunafrost && String(activeItem.lunafrost.effect_text || "").trim()
              ? `<div class="gb-frost-full-desc is-plain">
                     <div class="gb-frost-desc-body"><strong>${escHtml(activeItem.lunafrost.name)}:</strong> ${escHtml(String(activeItem.lunafrost.effect_text).replace(/\s+/g, " ").trim())}</div>
                 </div>`
              : "";
        const frostSectionHtml =
            validFrosts.length > 0
                ? `<div class="gb-ed-block">
                       <div class="gb-ed-hdr-row">
                           <label class="gb-ed-lbl">${selSlotId === 0 ? "Costume Charm / Lunastone" : "Lunafrost / Enchant"}</label>
                           ${
                               isCurErenorFrost && eligibleForCurFrost > 1
                                   ? `<button type="button" class="sm primary" id="gbApplyErenorFrostAllBtn" title="Apply ${escHtml(curFrostMeta.name)} to all ${eligibleForCurFrost} eligible equipped Ayanad/Erenor armor slots">Apply to All ${eligibleForCurFrost} Eligible</button>`
                                   : ""
                           }
                       </div>
                       <select id="gbFrostSel" class="gb-full-sel">
                           <option value="">None</option>
                           ${validFrosts
                               .map((f) => {
                                   const charmDef = COSTUME_CHARM_DEFS[Number(f.id)] || null;
                                   if (charmDef) {
                                       return `<option value="${f.id}" ${f.id === curFrostId ? "selected" : ""}>${escHtml(charmDef.name)} — ${escHtml(charmDef.shortDesc)}</option>`;
                                   }
                                   const setHint = f.eiset_id && ERENOR_FROST_SET_HINTS[f.eiset_id]
                                       ? ` · ${ERENOR_FROST_SET_HINTS[f.eiset_id]}`
                                       : "";
                                   const cleanText = f.effect_text ? String(f.effect_text).replace(/\s+/g, " ").trim() : "";
                                   const effStr = cleanText ? ` — ${cleanText}` : "";
                                   return `<option value="${f.id}" ${f.id === curFrostId ? "selected" : ""}>${escHtml(f.name)}${escHtml(effStr)}${escHtml(setHint)}</option>`;
                               })
                               .join("")}
                       </select>
                       ${curFrostFullDescHtml}
                   </div>`
                : "";

        // Lunagems socket picker
        const maxSockets = getMaxSocketsForSlotAndGrade(selSlotId, gObj);
        const validGems = maxSockets > 0 ? filterLunagemsForSlot(selSlotId, activeItem, catalog) : [];
        let gemsSectionHtml = "";
        if (maxSockets > 0 && validGems.length > 0) {
            const gemOptsBase = (selectedId) =>
                `<option value="">Empty Socket</option>` +
                validGems
                    .map(
                        (g) =>
                            `<option value="${g.id}" ${g.id === selectedId ? "selected" : ""}>${escHtml(g.name)}${g.effect_text ? ` (${escHtml(g.effect_text.slice(0, 46))})` : ""}</option>`
                    )
                    .join("");
            const curGems = Array.isArray(activeItem.lunagem) ? activeItem.lunagem : [];
            const socketRows = Array.from({ length: maxSockets }, (_, idx) => {
                const gid = curGems[idx]?.id ? Number(curGems[idx].id) : 0;
                return `
                <div class="gb-sock-row">
                    <span class="gb-sock-num">#${idx + 1}</span>
                    <select class="gb-sock-sel" data-gb-sock="${idx}">${gemOptsBase(gid)}</select>
                </div>`;
            }).join("");

            gemsSectionHtml = `
            <div class="gb-ed-block">
                <div class="gb-ed-hdr-row">
                    <label class="gb-ed-lbl">Lunagems (${curGems.filter((g) => g && g.id !== 0).length} / ${maxSockets} sockets)</label>
                    <div class="gb-fill-row">
                        <select id="gbFillGemSel" class="gb-fill-sel">
                            <option value="">Clear All</option>
                            ${validGems
                                .map(
                                    (g) =>
                                        `<option value="${g.id}">${escHtml(g.name)}${g.effect_text ? ` (${escHtml(g.effect_text.slice(0, 34))})` : ""}</option>`
                                )
                                .join("")}
                        </select>
                        <button type="button" class="sm primary" id="gbFillAllGemsBtn">Fill All</button>
                    </div>
                </div>
                <div class="gb-sockets-list">${socketRows}</div>
            </div>`;
        }

        // Synthesis stats picker (uses unique pool index so Cloak High/Low stat tiers never collide!)
        const synthCount = getSynthSlotCountForGrade(eq, gObj?.id);
        const synthPool = synthCount > 0 ? getAvailableSynthPool(eq, gObj?.id, catalog) : [];
        let synthSectionHtml = "";
        if (synthCount > 0 && synthPool.length > 0) {
            const curSynths = Array.isArray(activeItem.sythisis_stat) ? activeItem.sythisis_stat : [];
            const pickedAttrIds = new Set(curSynths.filter(Boolean).map((st) => Number(st.unit_attribute_id)));
            const synPct = Number.isFinite(Number(eq.synth_percentage)) ? Number(eq.synth_percentage) : 100;
            // Count occurrences of each unit_attribute_id so duplicate tiers (e.g. Cloak High vs Low) get clear labels
            const attrCounts = new Map();
            for (const opt of synthPool) {
                const aid = Number(opt.unit_attribute_id);
                attrCounts.set(aid, (attrCounts.get(aid) || 0) + 1);
            }
            const attrSeen = new Map();
            const poolOptionLabels = synthPool.map((opt) => {
                const aid = Number(opt.unit_attribute_id);
                const total = attrCounts.get(aid) || 1;
                const occ = attrSeen.get(aid) || 0;
                attrSeen.set(aid, occ + 1);
                if (total === 2) {
                    return `${opt.display_text} [${occ === 0 ? "High" : "Low"}]`;
                }
                if (total > 2) {
                    return `${opt.display_text} [Tier ${occ + 1}]`;
                }
                return opt.display_text;
            });

            const synthRows = Array.from({ length: synthCount }, (_, idx) => {
                const curSt = curSynths[idx] || null;
                const curAttr = curSt ? Number(curSt.unit_attribute_id) : -1;
                const matchedPoolIdx = curSt ? getSynthPoolIndexForStat(curSt, synthPool) : -1;
                const customPreservedOpt =
                    curSt && matchedPoolIdx < 0
                        ? `<option value="__keep__" selected>${escHtml(String(curSt.display_text || "Custom Stat").replace(/\s+/g, " "))} (Imported)</option>`
                        : "";
                return `
                <div class="gb-sock-row">
                    <span class="gb-sock-num">S${idx + 1}</span>
                    <select class="gb-sock-sel" data-gb-synth-line="${idx}">
                        <option value="">None</option>
                        ${customPreservedOpt}
                        ${synthPool
                            .map((opt, poolIdx) => {
                                const aid = Number(opt.unit_attribute_id);
                                const isSel = poolIdx === matchedPoolIdx;
                                const disabled = !isSel && aid !== curAttr && pickedAttrIds.has(aid) ? "disabled" : "";
                                return `<option value="idx:${poolIdx}" ${isSel ? "selected" : ""} ${disabled}>${escHtml(poolOptionLabels[poolIdx])}</option>`;
                            })
                            .join("")}
                    </select>
                </div>`;
            }).join("");

            synthSectionHtml = `
            <div class="gb-ed-block">
                <div class="gb-ed-hdr-row">
                    <label class="gb-ed-lbl">Synthesis Stats (${synthCount} lines)</label>
                    <label class="gs-inline-field" title="Synthesis roll percentage (0% = min roll, 100% = max roll)">
                        Roll %
                        <input type="number" id="gbSynthPctInp" min="0" max="100" step="5" value="${synPct}" style="width:68px" />
                    </label>
                </div>
                <div class="gb-sockets-list">${synthRows}</div>
            </div>`;
        }

        const ic = resolveGearIconUrl(eq.img);
        const eqFrameId = Math.max(0, Math.min(12, Number(gObj?.id) || 0));
        const canonicalGObj = catalog.gradeById.get(eqFrameId) || gObj;
        const eqColor = canonicalGObj?.colour || "#475569";
        const activeSlotCost = slotCostById.get(selSlotId) || null;
        const activeItemStatsHtml = renderItemGrantedStatsHtml(
            computeGearItemGrantedStats(activeSlot, selSlotId, slots, slotMods)
        );
        const activeSlotCostHtml = activeSlotCost
            ? `<div class="gb-slot-cost-bar">
                   <div class="gb-slot-cost-main">
                       <span class="gb-slot-cost-lbl">Est. Slot Cost</span>
                       <strong class="gb-slot-cost-total">${fmtInt(activeSlotCost.slotTotalGold)}g</strong>
                   </div>
                   <div class="gb-slot-cost-parts">
                       Gear <strong>${fmtInt(activeSlotCost.baseGold)}g</strong>${activeSlotCost.isAhItem ? ` <span class="econ-ah-mini">AH</span>` : ""}${activeSlotCost.gemsCount > 0 ? ` &middot; Gems <strong>${fmtInt(activeSlotCost.gemsGold)}g</strong> (${activeSlotCost.gemsCount})` : ""}${activeSlotCost.frostInfo ? ` &middot; Frost <strong>${fmtInt(activeSlotCost.frostGold)}g</strong>` : ""}
                       <button type="button" class="gb-cost-edit-link" data-gb-open-economy title="Open Economy tab to edit prices or sync AH">Edit prices &nearr;</button>
                   </div>
               </div>`
            : "";
        equippedEditorHtml = `
        <div class="gb-equipped-card" style="border-color:${escHtml(eqColor)}">
            <div class="gb-eq-top">
                <span class="gb-eq-ic has-grade">
                    ${ic ? `<img src="${escHtml(ic)}" alt="" />` : ""}
                    <img class="gear-grade-frame" src="assets/grade/grade${eqFrameId}.png" alt="" />
                </span>
                <div class="gb-eq-title">
                    <div class="gb-eq-name" style="color:${escHtml(eqColor)}">${escHtml(canonicalGObj?.name || "")} ${escHtml(eq.name)}</div>
                    <div class="gb-item-meta">${escHtml(activeSlot.name)} &bull; ${escHtml(eq.type)} &bull; Lv ${eq.level}</div>
                </div>
                <button type="button" class="sm danger" id="gbUnequipCurBtn">Unequip</button>
            </div>
            ${activeItemStatsHtml}
            ${activeSlotCostHtml}
            <div class="gb-ed-controls-row">
                <label class="gs-inline-field">
                    Grade
                    <select id="gbGradeSel">
                        ${validGrades
                            .map(
                                (g) =>
                                    `<option value="${g.id}" ${g.id === gObj?.id ? "selected" : ""} style="color:${escHtml(g.colour)}">${escHtml(g.name)} (${g.main_mod}%)</option>`
                            )
                            .join("")}
                    </select>
                </label>
                ${
                    isTemperable
                        ? `<label class="gs-inline-field" title="Physical Defense / Melee & Ranged Attack temper (100-115%)">
                               P.Temper
                               <input type="number" id="gbPTemperInp" min="100" max="115" step="1" value="${Number(activeItem.ptemper) || 100}" style="width:68px" />%
                           </label>
                           <label class="gs-inline-field" title="Magic Defense / Magic Attack / Healing Power temper (100-115%)">
                               M.Temper
                               <input type="number" id="gbMTemperInp" min="100" max="115" step="1" value="${Number(activeItem.mtemper) || 100}" style="width:68px" />%
                           </label>`
                        : ""
                }
            </div>
            ${frostSectionHtml}
            ${gemsSectionHtml}
            ${synthSectionHtml}
        </div>`;
    } else {
        equippedEditorHtml = `
        <div class="gb-empty-notice">
            <strong>${escHtml(activeSlot.name)}</strong> is empty &mdash; search and click <strong>Equip</strong> below to select an item.
        </div>`;
    }

    const typeFilterPillsHtml =
        itemTypes.length > 1
            ? `<div class="gb-type-pills">
                   <button type="button" class="sw-pill ${curTypeFilter === "all" ? "active" : ""}" data-gb-type="all">All</button>
                   ${itemTypes
                       .map(
                           (t) =>
                               `<button type="button" class="sw-pill ${curTypeFilter === t ? "active" : ""}" data-gb-type="${escHtml(t)}">${escHtml(t)}</button>`
                       )
                       .join("")}
               </div>`
            : "";

    const titleName = player?.title?.name || ch.metadata?.title || null;
    const describedBuffs = [
        ...gearBuffs
            .map((b) =>
                describeGearBuffEffects({
                    ...b,
                    isTitle: Boolean(titleName && b.name === titleName),
                })
            )
            .filter(Boolean),
        ...computeActiveSetEffectSummaries(slots, slotMods),
    ];
    const activeGearBuffRows = describedBuffs
        .map(
            (b) => `
            <div class="gb-buff-item cat-${escHtml(b.category)}">
                <div class="gb-buff-name">${escHtml(b.name)}</div>
                ${b.summary ? `<div class="gb-buff-stats">${escHtml(b.summary)}</div>` : ""}
            </div>`
        )
        .join("");

    // Stat Migration state & UI
    const mig = getPlayerStatMigration(player);
    const MIG_STATS = [
        { key: "str", label: "STR" },
        { key: "agi", label: "AGI" },
        { key: "sta", label: "STA" },
        { key: "int", label: "INT" },
        { key: "spi", label: "SPI" },
    ];
    const activeMigParts = MIG_STATS.filter((s) => mig.deltas[s.key] !== 0).map(
        (s) => `${s.label} ${mig.deltas[s.key] > 0 ? "+" : ""}${mig.deltas[s.key]}`
    );
    const migSummaryPill =
        activeMigParts.length > 0
            ? activeMigParts.join(" · ")
            : "Default (0)";
    const migBalanceCls = mig.net === 0 ? "is-balanced" : "is-unbalanced";
    const migBalanceTxt =
        mig.net === 0
            ? `Balanced (${mig.gained} migrated)`
            : `Net ${mig.net > 0 ? "+" : ""}${mig.net} (${mig.totalBase}/790)`;
    const migRowsHtml = MIG_STATS.map((s) => {
        const d = mig.deltas[s.key];
        const baseVal = mig.base[s.key];
        const totVal = Math.round(Number(effSelf.attributes?.[s.key]) || 0);
        const valCls = d > 0 ? "delta-pos" : d < 0 ? "delta-neg" : "";
        return `
        <div class="gb-mig-row">
            <span class="gb-mig-lbl">${s.label}</span>
            <div class="gb-mig-ctrl">
                <button type="button" class="sm gb-mig-step" data-gb-mig-step="${s.key}" data-gb-mig-delta="-10" title="Subtract 10 ${s.label}">&minus;10</button>
                <input type="number" class="gb-mig-inp ${valCls}" data-gb-mig-inp="${s.key}" min="${STAT_MIGRATION_MIN_DELTA}" max="${STAT_MIGRATION_MAX_DELTA}" step="5" value="${d}" aria-label="${s.label} migration delta" />
                <button type="button" class="sm gb-mig-step" data-gb-mig-step="${s.key}" data-gb-mig-delta="10" title="Add 10 ${s.label}">+10</button>
            </div>
            <span class="gb-mig-totals" title="Base Lv55 + Migration = ${baseVal}; Total with gear/buffs = ${totVal}">${baseVal} &rarr; <strong>${fmtInt(totVal)}</strong></span>
        </div>`;
    }).join("");

    const migStatOpts = (selected) =>
        MIG_STATS.map(
            (s) => `<option value="${s.key}" ${selected === s.key ? "selected" : ""}>${s.label}</option>`
        ).join("");

    const migBoxHtml = `
    <details class="gb-mig-box" id="gbMigDetails" ${state.gearBuilderMigOpen ? "open" : ""}>
        <summary>
            <span class="gb-mig-sum-title">Stat Migration</span>
            <span class="gb-mig-sum-pill ${migBalanceCls}">${escHtml(migSummaryPill)}</span>
        </summary>
        <div class="gb-mig-body">
            <div class="gb-mig-list">${migRowsHtml}</div>
            <div class="gb-mig-transfer">
                <span>Move</span>
                <input type="number" id="gbMigAmtInp" min="1" max="300" step="5" value="${Number(state.gearBuilderMigAmt) || 50}" style="width:46px" />
                <select id="gbMigFromSel" aria-label="Migrate from stat">${migStatOpts(state.gearBuilderMigFrom || "int")}</select>
                <span>&rarr;</span>
                <select id="gbMigToSel" aria-label="Migrate to stat">${migStatOpts(state.gearBuilderMigTo || "sta")}</select>
                <button type="button" class="sm primary" id="gbMigTransferBtn">Move</button>
            </div>
            <div class="gb-mig-presets">
                <button type="button" class="sm" data-gb-mig-preset="str">+300 STR</button>
                <button type="button" class="sm" data-gb-mig-preset="agi">+300 AGI</button>
                <button type="button" class="sm" data-gb-mig-preset="sta">+300 STA</button>
                <button type="button" class="sm" data-gb-mig-preset="int">+300 INT</button>
                <button type="button" class="sm" data-gb-mig-preset="spi">+300 SPI</button>
                <button type="button" class="sm" id="gbMigResetBtn">Reset</button>
            </div>
            <div class="gb-mig-foot ${migBalanceCls}">
                <span>Pool: <strong>${mig.totalBase} / 790</strong> &middot; ${escHtml(migBalanceTxt)}</span>
            </div>
        </div>
    </details>`;

    // Grouped Armor Set Presets for 1-click full armor swaps (preserves tempers & compatible gems/frosts)
    const armorSetPresets = getArmorSetPresets(catalog);
    const presetGroups = [];
    const presetGroupMap = new Map();
    for (const p of armorSetPresets) {
        if (!presetGroupMap.has(p.group)) {
            const arr = [];
            presetGroupMap.set(p.group, arr);
            presetGroups.push({ group: p.group, items: arr });
        }
        presetGroupMap.get(p.group).push(p);
    }
    const lastPickedArmorSet = state.gearBuilderArmorSetId || "";
    const lastPickedArmorGrade = state.gearBuilderArmorSetGrade || "";
    const armorSetOptgroupsHtml = presetGroups
        .map(
            (g) =>
                `<optgroup label="${escHtml(g.group)}">${g.items
                    .map(
                        (p) =>
                            `<option value="${escHtml(p.id)}" ${lastPickedArmorSet === p.id ? "selected" : ""}>${escHtml(p.label)}</option>`
                    )
                    .join("")}</optgroup>`
        )
        .join("");

    // Custom Multi-Slot Gear Templates (builds/gear-templates.json + localStorage fallback)
    const customTemplates = Array.isArray(state.customGearTemplates) ? state.customGearTemplates : [];
    const selTplId = customTemplates.some((t) => t.id === state.gearBuilderTemplateId)
        ? state.gearBuilderTemplateId
        : customTemplates[0]?.id || "";
    const selTplObj = customTemplates.find((t) => t.id === selTplId) || null;
    const tplGradeMode = state.gearBuilderTemplateGradeMode || "template";
    const tplKeepGems = Boolean(state.gearBuilderTemplateKeepGems);
    const tplDrawerOpen = Boolean(state.gearBuilderTplDrawerOpen);

    const equippedSlotIds = slots.filter((s) => Boolean(s?.item?.equipment)).map((s) => Number(s.id));
    const activeTplSelectedSet = new Set(
        Array.isArray(state.gearBuilderTplSelectedSlots) ? state.gearBuilderTplSelectedSlots : equippedSlotIds
    );
    const tplSelectedCount = equippedSlotIds.filter((sid) => activeTplSelectedSet.has(sid)).length;

    const tplSlotChecklistHtml = tplDrawerOpen
        ? slots
              .map((s) => {
                  const sid = Number(s.id);
                  const it = s.item;
                  const hasItem = Boolean(it?.equipment);
                  const checked = hasItem && activeTplSelectedSet.has(sid);
                  const frameId = hasItem ? Math.max(0, Math.min(12, Number(it.grade?.id) || 0)) : 0;
                  const gColor = hasItem ? (catalog.gradeById.get(frameId)?.colour || "#cbd5e1") : "#64748b";
                  const gemCnt =
                      hasItem && Array.isArray(it.lunagem)
                          ? it.lunagem.filter((g) => g && Number(g.id) > 0).length
                          : 0;
                  const metaBits = [];
                  if (gemCnt > 0) metaBits.push(`${gemCnt}g`);
                  if (it?.lunafrost) metaBits.push("LF");
                  if (hasItem && Array.isArray(it.sythisis_stat) && it.sythisis_stat.some(Boolean)) metaBits.push("Synth");
                  return `
                  <label class="gb-tpl-slot-item ${hasItem ? "" : "is-empty"} ${checked ? "is-checked" : ""}">
                      <input type="checkbox" data-gb-tpl-slot="${sid}" ${checked ? "checked" : ""} ${hasItem ? "" : "disabled"} />
                      <span class="gb-tpl-slot-body">
                          <span class="gb-tpl-slot-name">${escHtml(s.name)}</span>
                          <span class="gb-tpl-slot-itemname" style="color:${escHtml(gColor)}">${hasItem ? escHtml(it.equipment.name) : "Empty"}</span>
                          ${metaBits.length > 0 ? `<span class="gb-tpl-slot-meta">${escHtml(metaBits.join(" · "))}</span>` : ""}
                      </span>
                  </label>`;
              })
              .join("")
        : "";

    const tplDrawerHtml = tplDrawerOpen
        ? `<div class="gb-tpl-drawer" id="gbTplDrawer">
               <div class="gb-tpl-drawer-head">
                   <span class="gb-ed-lbl">Save Equipped Slots as Custom Template (${state.diskApiAvailable ? "builds/gear-templates.json" : "browser storage"})</span>
                   <div class="gb-tpl-pills">
                       ${GEAR_TEMPLATE_SLOT_GROUPS.map(
                           (grp) =>
                               `<button type="button" class="sm" data-gb-tpl-group="${escHtml(grp.id)}">${escHtml(grp.label)}</button>`
                       ).join("")}
                       <button type="button" class="sm" data-gb-tpl-group="none">None</button>
                   </div>
               </div>
               <div class="gb-tpl-inputs">
                   <input type="text" id="gbTplNameInp" class="gb-tpl-name-inp" placeholder="Template name (e.g. Epic Healer Obsidian + Erenor Frosts)" value="${escHtml(state.gearBuilderTplName || "")}" autocomplete="off" />
                   <input type="text" id="gbTplNotesInp" class="gb-tpl-notes-inp" placeholder="Optional note (e.g. 5pc T7 SPI + Life Waist/Wrists)" value="${escHtml(state.gearBuilderTplNotes || "")}" autocomplete="off" />
               </div>
               <div class="gb-tpl-slot-grid">${tplSlotChecklistHtml}</div>
               <div class="gb-tpl-drawer-foot">
                   <span class="hint-inline" id="gbTplCountHint">Capturing <strong>${tplSelectedCount}</strong> equipped slot${tplSelectedCount === 1 ? "" : "s"} (item, grade, temper, gems, frost &amp; synth)</span>
                   <div class="gb-tpl-drawer-actions">
                       <button type="button" class="sm" id="gbTplCancelBtn">Cancel</button>
                       <button type="button" class="sm primary" id="gbTplSaveCommitBtn" ${tplSelectedCount === 0 ? "disabled" : ""}>Save Template</button>
                   </div>
               </div>
           </div>`
        : "";

    out.innerHTML = `
        <div class="gb-toolbar">
            <div class="sb-toolbar-row">
                <div class="seg-group" id="gbSlotPills">
                    <button type="button" class="seg-btn ${slotKey === "A" ? "active" : ""}" data-gb-slot="A">Build A: ${escHtml(state.buildA.name)}</button>
                    <button type="button" class="seg-btn ${slotKey === "B" ? "active" : ""}" data-gb-slot="B">Build B: ${escHtml(state.buildB.name)}</button>
                    <button type="button" class="seg-btn ${slotKey === "defender" ? "active" : ""}" data-gb-slot="defender">Target: ${escHtml(state.defender.name)}</button>
                </div>
                <div class="sb-class-summary">
                    <label class="gs-inline-field" title="Select character Title (applies exact AA Classic Title stats)">
                        Title
                        <select id="gbTitleSel" style="max-width:210px">
                            <option value="">No Title</option>
                            ${catalog.titles
                                .map(
                                    (t) =>
                                        `<option value="${t.id}" ${t.id === curTitleId ? "selected" : ""}>${escHtml(t.name)}${t.effect_text ? ` (${escHtml(t.effect_text.slice(0, 38))})` : ""}</option>`
                                )
                                .join("")}
                        </select>
                    </label>
                    ${slotKey === "A" ? `<button type="button" class="sm" id="gbCopyAtoBBtn" title="Copy Build A's full 20-slot gear & title into Build B">Copy Gear A &rarr; B</button>` : ""}
                    ${existingCode ? `<button type="button" class="sm primary" id="gbSyncDgBtn" data-dg-code="${escHtml(existingCode)}" title="Load exact raw gear, tempers, gems, frosts &amp; synthesis from DaruGear (${escHtml(existingCode)})">&#8635; Pull ${escHtml(existingCode)}</button>` : ""}
                    <button type="button" class="sm" id="gbNewBlankBuildBtn" title="Create a brand-new blank Lv 55 character (${state.diskApiAvailable ? "creates a new builds/*.json with no gear equipped" : "saves a blank build to browser storage"})">+ New Blank Build</button>
                    <button type="button" class="sm primary" id="gbSaveBuildBtn" title="Save this modified build snapshot (${state.diskApiAvailable ? "writes to builds/*.json" : "saves to browser storage"})">Save As Build</button>
                    <button type="button" class="sm danger" id="gbClearGearBtn">Clear Gear</button>
                </div>
            </div>
            ${
                armorSetPresets.length > 0
                    ? `<div class="gb-set-swap-row">
                           <label class="gb-set-swap-lbl" for="gbArmorSetSel">Swap Armor Set</label>
                           <select id="gbArmorSetSel" class="gb-set-swap-sel" title="Swap all 7 crafted/dungeon armor slots or all 5 Obsidian armor slots (Head/Chest/Hands/Legs/Feet) while keeping tempers &amp; compatible gems/frosts">
                               <option value="">Choose an armor set&hellip;</option>
                               ${armorSetOptgroupsHtml}
                           </select>
                           <select id="gbArmorSetGradeSel" class="gb-set-grade-sel" title="Keep each slot's existing grade, or apply a uniform grade to the swapped armor set">
                               <option value="" ${lastPickedArmorGrade === "" ? "selected" : ""}>Keep Slot Grades</option>
                               <option value="7" ${lastPickedArmorGrade === "7" ? "selected" : ""}>Celestial</option>
                               <option value="8" ${lastPickedArmorGrade === "8" ? "selected" : ""}>Divine</option>
                               <option value="9" ${lastPickedArmorGrade === "9" ? "selected" : ""}>Epic</option>
                               <option value="10" ${lastPickedArmorGrade === "10" ? "selected" : ""}>Legendary</option>
                               <option value="11" ${lastPickedArmorGrade === "11" ? "selected" : ""}>Mythic</option>
                           </select>
                           <button type="button" class="sm primary" id="gbArmorSetApplyBtn">Swap Set</button>
                       </div>`
                    : ""
            }
            <div class="gb-set-swap-row gb-tpl-row">
                <label class="gb-set-swap-lbl" for="gbTemplateSel">Gear Templates</label>
                <select id="gbTemplateSel" class="gb-set-swap-sel" title="${selTplObj?.notes ? escHtml(selTplObj.notes) : "Apply a saved custom multi-slot gear template (armor, weapons, accessories, gems, frosts & synth)"}">
                    ${
                        customTemplates.length > 0
                            ? customTemplates
                                  .map(
                                      (t) =>
                                          `<option value="${escHtml(t.id)}" ${t.id === selTplId ? "selected" : ""}>${escHtml(t.name)} (${t.slotCount} slot${t.slotCount === 1 ? "" : "s"})${t.notes ? ` — ${escHtml(t.notes)}` : ""}</option>`
                                  )
                                  .join("")
                            : `<option value="">No custom templates yet — click + Save Template</option>`
                    }
                </select>
                <select id="gbTemplateGradeSel" class="gb-set-grade-sel" title="Use the template's saved grades, keep this build's slot grades, or override all template slots to a uniform grade">
                    <option value="template" ${tplGradeMode === "template" ? "selected" : ""}>Template Grades</option>
                    <option value="keep" ${tplGradeMode === "keep" ? "selected" : ""}>Keep Slot Grades</option>
                    <option value="7" ${tplGradeMode === "7" ? "selected" : ""}>Celestial</option>
                    <option value="8" ${tplGradeMode === "8" ? "selected" : ""}>Divine</option>
                    <option value="9" ${tplGradeMode === "9" ? "selected" : ""}>Epic</option>
                    <option value="10" ${tplGradeMode === "10" ? "selected" : ""}>Legendary</option>
                    <option value="11" ${tplGradeMode === "11" ? "selected" : ""}>Mythic</option>
                </select>
                <label class="gb-tpl-chk" title="Preserve this build's existing compatible lunagems &amp; lunafrosts instead of applying the template's gems/frosts">
                    <input type="checkbox" id="gbTemplateKeepGemsChk" ${tplKeepGems ? "checked" : ""} />
                    <span>Keep Target Gems</span>
                </label>
                <button type="button" class="sm primary" id="gbTemplateApplyBtn" ${selTplObj ? "" : "disabled"}>Apply</button>
                <button type="button" class="sm" id="gbTemplateToggleSaveBtn">${tplDrawerOpen ? "Close" : "+ Save Template"}</button>
                ${selTplObj ? `<button type="button" class="sm danger" id="gbTemplateDeleteBtn" title="Delete '${escHtml(selTplObj.name)}'">&times;</button>` : ""}
            </div>
            ${tplDrawerHtml}
        </div>

        <div class="gb-workspace">
            <!-- Left: DaruGear 20-Slot Paperdoll + Live Stats -->
            <div class="gb-paperdoll-panel">
                <div class="gb-pd-main">
                    <div class="gb-pd-col">
                        ${leftSlotIds.map(renderPaperdollSlot).join("")}
                    </div>
                    <div class="gb-pd-center">
                        <div class="gb-gs-banner">
                            <span class="gb-gs-lbl">Gear Score</span>
                            <strong class="gb-gs-val">${fmtInt(effSelf.gearScore)}</strong>
                        </div>
                        <button type="button" class="gb-cost-banner" data-gb-open-economy title="Estimated build cost from Economy Price Book${ahIndex ? " + sermeatball.com AH prices" : ""}. Click to open Economy tab.">
                            <div class="gb-cost-banner-top">
                                <span class="gb-gs-lbl">Est. Build Cost</span>
                                <strong class="gb-cost-val">${fmtInt(buildCost.totalGold)}g</strong>
                            </div>
                            <div class="gb-cost-banner-sub">
                                Gear ${fmtCompactGold(buildCost.baseGearGold)} &middot; Gems ${fmtCompactGold(buildCost.lunagemsGold)} &middot; Frosts ${fmtCompactGold(buildCost.lunafrostsGold)}
                            </div>
                        </button>
                        <div class="gb-stat-mini-grid">
                            <div><span>Max HP</span><strong>${fmtInt(effSelf.maxHealth)}</strong></div>
                            <div><span>Max Mana</span><strong>${fmtInt(effSelf.maxMana)}</strong></div>
                            <div><span>Melee Atk</span><strong>${fmtInt(effSelf.offense.meleeAttack)}</strong></div>
                            <div><span>Ranged Atk</span><strong>${fmtInt(effSelf.offense.rangedAttack)}</strong></div>
                            <div><span>Magic Atk</span><strong>${fmtInt(effSelf.offense.magicAttack)}</strong></div>
                            <div><span>Heal Power</span><strong>${fmtInt(effSelf.offense.healingPower)}</strong></div>
                            <div><span>Phys Def</span><strong>${fmtInt(effSelf.defense.physicalDefense)}</strong></div>
                            <div><span>Magic Def</span><strong>${fmtInt(effSelf.defense.magicDefense)}</strong></div>
                            <div><span>Tough / Resil</span><strong>${fmtInt(effSelf.defense.toughness)} / ${fmtInt(effSelf.defense.resilience)}</strong></div>
                            <div><span>Focus / Cast</span><strong>${fmtInt(effSelf.offense.focus)} / ${fmtDec(effSelf.offense.castTimePct, 0)}%</strong></div>
                            <div><span>Def / M.Pen</span><strong>${fmtInt(effSelf.offense.defensePenetration)} / ${fmtInt(effSelf.offense.magicDefensePenetration)}</strong></div>
                            <div><span>Atk Spd</span><strong>${fmtInt(effSelf.offense.attackSpeed)}</strong></div>
                            <div><span>Melee EHP</span><strong class="val-a">${fmtInt(effStats.defense.ehp.melee.vsAttackerEhp)}</strong></div>
                            <div><span>Magic EHP</span><strong class="val-a">${fmtInt(effStats.defense.ehp.magic.vsAttackerEhp)}</strong></div>
                        </div>
                        <div class="gb-attr-strip">
                            <span>STR <strong>${fmtInt(effSelf.attributes.str)}</strong></span>
                            <span>AGI <strong>${fmtInt(effSelf.attributes.agi)}</strong></span>
                            <span>STA <strong>${fmtInt(effSelf.attributes.sta)}</strong></span>
                            <span>INT <strong>${fmtInt(effSelf.attributes.int)}</strong></span>
                            <span>SPI <strong>${fmtInt(effSelf.attributes.spi)}</strong></span>
                        </div>
                        ${migBoxHtml}
                        <div class="gb-buffs-wrap">
                            <div class="sb-section-lbl">Active Gear, Set &amp; Grade Buffs</div>
                            <div class="gb-buff-list">${activeGearBuffRows || `<span class="hint-inline">None</span>`}</div>
                        </div>
                    </div>
                    <div class="gb-pd-col">
                        ${rightSlotIds.map(renderPaperdollSlot).join("")}
                    </div>
                </div>
            </div>

            <!-- Right: Slot Editor & Item Picker -->
            <div class="gb-editor-panel">
                <div class="gb-editor-title">
                    <strong>Editing Slot: ${escHtml(activeSlot.name)}</strong>
                    <span class="hint-inline">Changes recalculate stats live across all simulator tabs</span>
                </div>
                ${equippedEditorHtml}
                <div class="gb-picker-box">
                    <div class="gb-picker-hdr">
                        <input type="text" id="gbItemSearchInp" class="gb-search-inp" placeholder="Search ${escHtml(activeSlot.name)} (e.g. Ayanad, Erenor, Obsidian, Delphinad)..." value="${escHtml(curSearch)}" autocomplete="off" />
                        <label class="gs-inline-field" style="cursor:pointer" title="Carry over compatible lunagems & lunafrost when equipping a replacement item">
                            <input type="checkbox" id="gbKeepGemsChk" ${keepGemsFrost ? "checked" : ""} />
                            Keep gems/frost
                        </label>
                    </div>
                    ${typeFilterPillsHtml}
                    <div class="gb-item-results" id="gbItemResults">
                        ${renderItemResultsHtml(selSlotId, curSearch, curTypeFilter, catalog, ahIndex)}
                    </div>
                </div>
            </div>
        </div>
    `;

    document.getElementById("gbNewBlankBuildBtn")?.addEventListener("click", async () => {
        const nextName = prompt("Name for the new blank character build:", "New Character");
        if (nextName === null) return;
        const cleanName = String(nextName).trim();
        if (!cleanName) {
            showToast("Build name cannot be empty", "warn");
            return;
        }
        try {
            await createBlankBuildForSlot(slotKey, {
                name: cleanName,
                saveToStore: true,
                openGearBuilder: false,
                catalog,
            });
        } catch (err) {
            showToast(`Could not create blank build: ${err.message || err}`, "err");
        }
    });

    document.getElementById("gbSaveBuildBtn")?.addEventListener("click", async () => {
        const curChar = getSlotChar(slotKey);
        const suggested = curChar?.name || `Build ${slotKey}`;
        const nextName = prompt("Save build snapshot as:", suggested);
        if (nextName === null) return;
        const cleanName = String(nextName).trim();
        if (!cleanName) {
            showToast("Build name cannot be empty", "warn");
            return;
        }
        try {
            const toSave = { ...curChar, name: cleanName };
            const res = await saveBuildToStore(toSave, getSlotChipTokens(slotKey), state.consumables[slotKey] || {});
            if (res?.ok && res.build) {
                const savedChar = { ...res.build, rawDaruGear: curChar.rawDaruGear };
                setSlotChar(slotKey, savedChar);
                state.loadedSavedId[slotKey] = res.id;
                state.slotBaselineFp[slotKey] = computeSlotCharacterFingerprint(savedChar);
                ui.renderCharacterCards();
                ui.renderSimulation();
                showToast(`Saved "${cleanName}" (${res.mode === "disk" ? res.filename : "browser storage"})`, "ok");
            }
        } catch (err) {
            showToast(`Save failed: ${err.message || err}`, "err");
        }
    });

    // Bind Build Slot Switcher & Economy shortcut buttons
    out.querySelectorAll("[data-gb-open-economy]").forEach((btn) => {
        btn.addEventListener("click", () => {
            switchAppMode("economy");
        });
    });
    out.querySelectorAll("[data-gb-slot]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.gearBuilderSlot = btn.dataset.gbSlot;
            ui.renderSimulation();
        });
    });

    // Bind Paperdoll Slot Selection & Quick Unequip
    out.querySelectorAll("[data-gb-select-slot]").forEach((el) => {
        el.addEventListener("click", (e) => {
            const rmBtn = e.target.closest("[data-gb-unequip]");
            if (rmBtn) {
                e.stopPropagation();
                const sid = parseInt(rmBtn.dataset.gbUnequip, 10);
                const nextSlots = unequipGearSlot(slots, sid);
                commitGearChange(slotKey, nextSlots, player, catalog, `Unequipped ${bySlotId.get(sid)?.name || "slot"}`);
                return;
            }
            const nextSid = parseInt(el.dataset.gbSelectSlot, 10);
            if (nextSid !== state.gearBuilderSelectedSlotId) {
                state.gearBuilderSelectedSlotId = nextSid;
                state.gearBuilderTypeFilter = "all";
                state.gearBuilderSearch = "";
                ui.renderSimulation();
            }
            if (typeof window !== "undefined" && window.innerWidth <= 768) {
                requestAnimationFrame(() => {
                    document.querySelector(".gb-editor-panel")?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                    });
                });
            }
        });
    });

    // Bind Title Selector
    document.getElementById("gbTitleSel")?.addEventListener("change", (e) => {
        const tid = e.target.value ? parseInt(e.target.value, 10) : null;
        const nextPlayer = setGearPlayerTitle(player, tid, catalog);
        commitGearChange(slotKey, slots, nextPlayer, catalog, `Title → ${nextPlayer.title?.name || "None"}`);
    });

    // Bind Stat Migration Controls
    document.getElementById("gbMigDetails")?.addEventListener("toggle", (e) => {
        state.gearBuilderMigOpen = Boolean(e.currentTarget.open);
    });
    out.querySelectorAll("[data-gb-mig-inp]").forEach((inp) => {
        inp.addEventListener("change", () => {
            const k = inp.dataset.gbMigInp;
            const val = parseInt(inp.value, 10);
            if (!Number.isFinite(val)) return;
            state.gearBuilderMigOpen = true;
            const nextPlayer = setPlayerStatMigration(player, { [k]: val });
            commitGearChange(slotKey, slots, nextPlayer, catalog);
        });
    });
    out.querySelectorAll("[data-gb-mig-step]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const k = btn.dataset.gbMigStep;
            const step = parseInt(btn.dataset.gbMigDelta, 10) || 0;
            state.gearBuilderMigOpen = true;
            const nextVal = (mig.deltas[k] || 0) + step;
            const nextPlayer = setPlayerStatMigration(player, { [k]: nextVal });
            commitGearChange(slotKey, slots, nextPlayer, catalog);
        });
    });
    document.getElementById("gbMigAmtInp")?.addEventListener("change", (e) => {
        state.gearBuilderMigAmt = Math.max(1, Math.min(300, parseInt(e.target.value, 10) || 50));
    });
    document.getElementById("gbMigFromSel")?.addEventListener("change", (e) => {
        state.gearBuilderMigFrom = e.target.value;
    });
    document.getElementById("gbMigToSel")?.addEventListener("change", (e) => {
        state.gearBuilderMigTo = e.target.value;
    });
    document.getElementById("gbMigTransferBtn")?.addEventListener("click", () => {
        const fromStat = document.getElementById("gbMigFromSel")?.value || state.gearBuilderMigFrom || "int";
        const toStat = document.getElementById("gbMigToSel")?.value || state.gearBuilderMigTo || "sta";
        const amt = Math.max(1, Math.min(300, parseInt(document.getElementById("gbMigAmtInp")?.value, 10) || 50));
        state.gearBuilderMigFrom = fromStat;
        state.gearBuilderMigTo = toStat;
        state.gearBuilderMigAmt = amt;
        state.gearBuilderMigOpen = true;
        if (fromStat === toStat) {
            showToast("Choose two different stats to migrate between", "warn");
            return;
        }
        const nextPlayer = applyStatMigrationTransfer(player, fromStat, toStat, amt);
        commitGearChange(
            slotKey,
            slots,
            nextPlayer,
            catalog,
            `Migrated ${amt} ${fromStat.toUpperCase()} → ${toStat.toUpperCase()}`
        );
    });
    const MIG_PRESETS = {
        str: { str: 300, agi: 0, sta: 0, int: -150, spi: -150 },
        agi: { str: 0, agi: 300, sta: 0, int: -150, spi: -150 },
        sta: { str: 0, agi: -150, sta: 300, int: -150, spi: 0 },
        int: { str: -150, agi: 0, sta: 0, int: 300, spi: -150 },
        spi: { str: -150, agi: -150, sta: 0, int: 0, spi: 300 },
    };
    out.querySelectorAll("[data-gb-mig-preset]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const pKey = btn.dataset.gbMigPreset;
            const deltas = MIG_PRESETS[pKey];
            if (!deltas) return;
            state.gearBuilderMigOpen = true;
            const nextPlayer = setPlayerStatMigration(player, deltas);
            commitGearChange(
                slotKey,
                slots,
                nextPlayer,
                catalog,
                `Applied +300 ${pKey.toUpperCase()} stat migration preset`
            );
        });
    });
    document.getElementById("gbMigResetBtn")?.addEventListener("click", () => {
        state.gearBuilderMigOpen = true;
        const nextPlayer = resetPlayerStatMigration(player);
        commitGearChange(slotKey, slots, nextPlayer, catalog, "Reset stat migration to Lv 55 base (158 all)");
    });

    // Bind Swap Armor Set bar
    const armorSetSel = document.getElementById("gbArmorSetSel");
    const armorSetGradeSel = document.getElementById("gbArmorSetGradeSel");
    armorSetSel?.addEventListener("change", () => {
        state.gearBuilderArmorSetId = armorSetSel.value || "";
    });
    armorSetGradeSel?.addEventListener("change", () => {
        state.gearBuilderArmorSetGrade = armorSetGradeSel.value || "";
    });
    document.getElementById("gbArmorSetApplyBtn")?.addEventListener("click", () => {
        const presetId = armorSetSel?.value || "";
        if (!presetId) {
            showToast("Choose an armor set from the dropdown first", "err");
            return;
        }
        state.gearBuilderArmorSetId = presetId;
        const gradeVal = armorSetGradeSel?.value || "";
        state.gearBuilderArmorSetGrade = gradeVal;
        const keep = state.gearBuilderKeepGems !== false;
        const { slots: nextSlots, preset, swappedCount } = equipArmorSetPreset(
            slots,
            presetId,
            {
                keepGemsFrost: keep,
                ...(gradeVal ? { gradeId: parseInt(gradeVal, 10) } : {}),
            },
            catalog
        );
        if (!preset || swappedCount === 0) {
            showToast("Could not resolve armor set items", "err");
            return;
        }
        const suffix = swappedCount === 5 ? " (Waist & Wrists kept)" : "";
        commitGearChange(
            slotKey,
            nextSlots,
            player,
            catalog,
            `Swapped ${swappedCount} armor slots to ${preset.label}${suffix}!`
        );
    });

    // Bind Custom Multi-Slot Gear Templates bar & Save Template drawer
    const tplSel = document.getElementById("gbTemplateSel");
    const tplGradeSel = document.getElementById("gbTemplateGradeSel");
    const tplKeepGemsChk = document.getElementById("gbTemplateKeepGemsChk");
    tplSel?.addEventListener("change", () => {
        state.gearBuilderTemplateId = tplSel.value || "";
        ui.renderSimulation();
    });
    tplGradeSel?.addEventListener("change", () => {
        state.gearBuilderTemplateGradeMode = tplGradeSel.value || "template";
    });
    tplKeepGemsChk?.addEventListener("change", () => {
        state.gearBuilderTemplateKeepGems = Boolean(tplKeepGemsChk.checked);
    });
    document.getElementById("gbTemplateApplyBtn")?.addEventListener("click", () => {
        const tid = tplSel?.value || selTplId;
        const tpl = customTemplates.find((t) => t.id === tid);
        if (!tpl) {
            showToast("Choose a saved gear template first", "err");
            return;
        }
        state.gearBuilderTemplateId = tpl.id;
        const gMode = tplGradeSel?.value || "template";
        const keepTarget = Boolean(tplKeepGemsChk?.checked);
        const { slots: nextSlots, appliedCount, missingSlots } = applyGearTemplateToSlots(
            slots,
            tpl,
            { gradeMode: gMode, keepExistingGemsFrost: keepTarget },
            catalog
        );
        if (appliedCount === 0) {
            showToast("Could not resolve any items from that template", "err");
            return;
        }
        const missNote = missingSlots.length > 0 ? ` (${missingSlots.length} slot skipped)` : "";
        commitGearChange(
            slotKey,
            nextSlots,
            player,
            catalog,
            `Applied template "${tpl.name}" (${appliedCount} slot${appliedCount === 1 ? "" : "s"})${missNote}!`
        );
    });
    document.getElementById("gbTemplateToggleSaveBtn")?.addEventListener("click", () => {
        state.gearBuilderTplDrawerOpen = !state.gearBuilderTplDrawerOpen;
        if (state.gearBuilderTplDrawerOpen) {
            if (!state.gearBuilderTplName) {
                state.gearBuilderTplName = `${ch.name || "Custom"} Gear`;
            }
            if (!Array.isArray(state.gearBuilderTplSelectedSlots)) {
                state.gearBuilderTplSelectedSlots = [...equippedSlotIds];
            }
        }
        ui.renderSimulation();
    });
    document.getElementById("gbTemplateDeleteBtn")?.addEventListener("click", async () => {
        const tid = tplSel?.value || selTplId;
        const tpl = customTemplates.find((t) => t.id === tid);
        if (!tpl) return;
        if (!confirm(`Delete custom gear template "${tpl.name}"?`)) return;
        const nextList = customTemplates.filter((t) => t.id !== tpl.id);
        state.gearBuilderTemplateId = nextList[0]?.id || "";
        await saveCustomGearTemplates(nextList);
        ui.renderSimulation();
        showToast(`Deleted gear template "${tpl.name}"`, "ok");
    });

    // Save Custom Template drawer bindings
    const tplNameInp = document.getElementById("gbTplNameInp");
    const tplNotesInp = document.getElementById("gbTplNotesInp");
    tplNameInp?.addEventListener("input", () => {
        state.gearBuilderTplName = tplNameInp.value;
    });
    tplNotesInp?.addEventListener("input", () => {
        state.gearBuilderTplNotes = tplNotesInp.value;
    });
    const syncTplDrawerCountUi = () => {
        const checkedIds = Array.from(out.querySelectorAll("input[data-gb-tpl-slot]:checked")).map((el) =>
            parseInt(el.dataset.gbTplSlot, 10)
        );
        state.gearBuilderTplSelectedSlots = checkedIds;
        const hint = document.getElementById("gbTplCountHint");
        if (hint) {
            hint.innerHTML = `Capturing <strong>${checkedIds.length}</strong> equipped slot${checkedIds.length === 1 ? "" : "s"} (item, grade, temper, gems, frost &amp; synth)`;
        }
        const saveBtn = document.getElementById("gbTplSaveCommitBtn");
        if (saveBtn) saveBtn.disabled = checkedIds.length === 0;
        out.querySelectorAll("input[data-gb-tpl-slot]").forEach((cb) => {
            cb.closest(".gb-tpl-slot-item")?.classList.toggle("is-checked", Boolean(cb.checked));
        });
    };
    out.querySelectorAll("input[data-gb-tpl-slot]").forEach((cb) => {
        cb.addEventListener("change", syncTplDrawerCountUi);
    });
    out.querySelectorAll("button[data-gb-tpl-group]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const gid = btn.dataset.gbTplGroup;
            let picked = [];
            if (gid === "none") {
                picked = [];
            } else if (gid === "all_equipped") {
                picked = [...equippedSlotIds];
            } else {
                const grp = GEAR_TEMPLATE_SLOT_GROUPS.find((g) => g.id === gid);
                const allow = new Set(grp?.slotIds || []);
                picked = equippedSlotIds.filter((sid) => allow.has(sid));
            }
            const pickSet = new Set(picked);
            out.querySelectorAll("input[data-gb-tpl-slot]").forEach((cb) => {
                if (cb.disabled) return;
                const sid = parseInt(cb.dataset.gbTplSlot, 10);
                cb.checked = pickSet.has(sid);
            });
            syncTplDrawerCountUi();
        });
    });
    document.getElementById("gbTplCancelBtn")?.addEventListener("click", () => {
        state.gearBuilderTplDrawerOpen = false;
        ui.renderSimulation();
    });
    document.getElementById("gbTplSaveCommitBtn")?.addEventListener("click", async () => {
        const cleanName = String(tplNameInp?.value ?? state.gearBuilderTplName ?? "").trim();
        if (!cleanName) {
            showToast("Enter a name for the custom gear template", "err");
            tplNameInp?.focus();
            return;
        }
        const chosenIds = Array.from(out.querySelectorAll("input[data-gb-tpl-slot]:checked")).map((el) =>
            parseInt(el.dataset.gbTplSlot, 10)
        );
        if (chosenIds.length === 0) {
            showToast("Select at least one equipped slot to save", "err");
            return;
        }
        const notes = String(tplNotesInp?.value ?? state.gearBuilderTplNotes ?? "").trim();
        const extracted = extractGearTemplateFromSlots(slots, {
            name: cleanName,
            notes,
            slotIds: chosenIds,
        });
        if (!extracted) {
            showToast("No equipped items found in the selected slots", "err");
            return;
        }
        const nextList = [extracted, ...customTemplates.filter((t) => t.id !== extracted.id)];
        state.gearBuilderTemplateId = extracted.id;
        state.gearBuilderTplDrawerOpen = false;
        state.gearBuilderTplName = "";
        state.gearBuilderTplNotes = "";
        await saveCustomGearTemplates(nextList);
        ui.renderSimulation();
        showToast(
            `Saved gear template "${extracted.name}" (${extracted.slotCount} slots → ${state.diskApiAvailable ? "builds/gear-templates.json" : "browser storage"})`,
            "ok"
        );
    });

    // Bind Copy Gear A -> B
    document.getElementById("gbCopyAtoBBtn")?.addEventListener("click", () => {
        commitGearChange("B", slots, player, catalog, `Copied ${ch.name}'s full 20-slot gear into Build B`);
    });

    // Bind Clear Gear
    document.getElementById("gbClearGearBtn")?.addEventListener("click", () => {
        const emptySlots = createEmptyGearSlots(catalog);
        commitGearChange(slotKey, emptySlots, player, catalog, `Cleared all gear slots on ${ch.name}`);
    });

    // Bind Pull Exact Raw Gear from DaruGear
    document.getElementById("gbSyncDgBtn")?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        if (!btn) return;
        const code = btn.dataset.dgCode;
        btn.disabled = true;
        try {
            const fetched = await fetchDaruGearBuild(code);
            if (!fetched.ok || !fetched.character?.rawDaruGear) {
                showToast(fetched.error || "Failed to pull gear from DaruGear", "err");
                return;
            }
            const { slots: dgSlots, player: dgPlayer } = fetched.character.rawDaruGear;
            commitGearChange(
                slotKey,
                dgSlots,
                dgPlayer,
                catalog,
                `Synced exact 20-slot gear & synthesis from DaruGear (${code})!`
            );
        } finally {
            if (btn.isConnected) btn.disabled = false;
        }
    });

    // Bind Active Item Editor controls
    document.getElementById("gbUnequipCurBtn")?.addEventListener("click", () => {
        const nextSlots = unequipGearSlot(slots, selSlotId);
        commitGearChange(slotKey, nextSlots, player, catalog, `Unequipped ${activeSlot.name}`);
    });
    document.getElementById("gbGradeSel")?.addEventListener("change", (e) => {
        const gid = parseInt(e.target.value, 10);
        const nextSlots = setSlotItemGrade(slots, selSlotId, gid, catalog);
        commitGearChange(slotKey, nextSlots, player, catalog);
    });
    document.getElementById("gbPTemperInp")?.addEventListener("change", (e) => {
        const nextSlots = setSlotItemTemper(slots, selSlotId, parseInt(e.target.value, 10), null);
        commitGearChange(slotKey, nextSlots, player, catalog);
    });
    document.getElementById("gbMTemperInp")?.addEventListener("change", (e) => {
        const nextSlots = setSlotItemTemper(slots, selSlotId, null, parseInt(e.target.value, 10));
        commitGearChange(slotKey, nextSlots, player, catalog);
    });
    document.getElementById("gbFrostSel")?.addEventListener("change", (e) => {
        const fid = e.target.value ? parseInt(e.target.value, 10) : null;
        const nextSlots = setSlotItemLunafrost(slots, selSlotId, fid, catalog);
        commitGearChange(slotKey, nextSlots, player, catalog);
    });
    document.getElementById("gbApplyErenorFrostAllBtn")?.addEventListener("click", () => {
        const fid = activeItem?.lunafrost?.id ? Number(activeItem.lunafrost.id) : null;
        if (!fid) return;
        const { slots: nextSlots, appliedCount } = applyLunafrostToEligibleSlots(slots, fid, catalog);
        commitGearChange(
            slotKey,
            nextSlots,
            player,
            catalog,
            `Applied ${activeItem.lunafrost.name} to ${appliedCount} eligible armor slots!`
        );
    });
    out.querySelectorAll("[data-gb-sock]").forEach((sel) => {
        sel.addEventListener("change", () => {
            const idx = parseInt(sel.dataset.gbSock, 10);
            const gid = sel.value ? parseInt(sel.value, 10) : null;
            const nextSlots = setSlotItemLunagem(slots, selSlotId, idx, gid, catalog);
            commitGearChange(slotKey, nextSlots, player, catalog);
        });
    });
    document.getElementById("gbFillAllGemsBtn")?.addEventListener("click", () => {
        const sel = document.getElementById("gbFillGemSel");
        const gid = sel?.value ? parseInt(sel.value, 10) : null;
        const nextSlots = fillAllSlotLunagems(slots, selSlotId, gid, catalog);
        commitGearChange(
            slotKey,
            nextSlots,
            player,
            catalog,
            gid ? `Filled all ${activeSlot.name} sockets!` : `Cleared all ${activeSlot.name} sockets`
        );
    });
    document.getElementById("gbSynthPctInp")?.addEventListener("change", (e) => {
        const nextSlots = setSlotItemSynthPercent(slots, selSlotId, parseFloat(e.target.value));
        commitGearChange(slotKey, nextSlots, player, catalog);
    });
    out.querySelectorAll("[data-gb-synth-line]").forEach((sel) => {
        sel.addEventListener("change", () => {
            const idx = parseInt(sel.dataset.gbSynthLine, 10);
            const val = sel.value || null;
            if (val === "__keep__") return;
            const nextSlots = setSlotItemSynthStat(slots, selSlotId, idx, val, catalog);
            commitGearChange(slotKey, nextSlots, player, catalog);
        });
    });

    // Bind Item Search (live DOM list update so typing never loses input focus!)
    const bindItemEquipButtons = () => {
        const resEl = document.getElementById("gbItemResults");
        if (!resEl) return;
        resEl.querySelectorAll("button[data-gb-equip-id]").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const itemId = parseInt(btn.dataset.gbEquipId, 10);
                const catItem = catalog.itemById.get(itemId);
                if (!catItem) return;
                const keep = document.getElementById("gbKeepGemsChk")?.checked !== false;
                const nextSlots = equipCatalogItemInSlot(slots, selSlotId, catItem, { keepGemsFrost: keep }, catalog);
                commitGearChange(slotKey, nextSlots, player, catalog, `Equipped ${catItem.name}`);
            });
        });
    };
    bindItemEquipButtons();

    const searchInp = document.getElementById("gbItemSearchInp");
    searchInp?.addEventListener("input", () => {
        state.gearBuilderSearch = searchInp.value;
        const resEl = document.getElementById("gbItemResults");
        if (resEl) {
            resEl.innerHTML = renderItemResultsHtml(selSlotId, state.gearBuilderSearch, curTypeFilter, catalog, ahIndex);
            bindItemEquipButtons();
        }
    });
    document.getElementById("gbKeepGemsChk")?.addEventListener("change", (e) => {
        state.gearBuilderKeepGems = Boolean(e.target.checked);
    });
    out.querySelectorAll("[data-gb-type]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.gearBuilderTypeFilter = btn.dataset.gbType;
            ui.renderSimulation();
        });
    });
}
