/**
 * DaruGear-Compatible 20-Slot Gear Builder Engine.
 *
 * Manages the full AA Classic 3.5 equipment, grade, temper, lunafrost, lunagem,
 * synthesis stat, title, and set/grade/weapon-archetype buff model using the exact
 * DaruGear formulas (`dn.setGearBuffs` + `calculateDaruGearStats`).
 */

import {
    SCALING_MAP,
    buildDaruGearExportFromApiPayload,
    calculateDaruGearStats,
    computeActiveSetEffectSummaries,
    registerItemSpecialEffects,
} from "../adapters/darugear_calc.js";
import { normalizeEquipmentList } from "../adapters/darugear.js";
import { ARCHEAGE_GRADES, computeArmorSetAndGradeBuff } from "./gearswap.js";
import { normalizeSkillBuild } from "./skillbuilder.js";

const TWO_HAND_TYPES = new Set([
    "Greatclub",
    "Staff",
    "Longspear",
    "Nodachi",
    "Greatsword",
    "GreatAxe",
    "Warclub",
    "Scythe",
]);

const SHIELD_TYPES = new Set(["Shield", "Magic Shield"]);

const GRADE_BUFF_IDS = Object.freeze({
    Cloth: { 4: 6418, 5: 6419, 6: 6420, 7: 6421, 8: 6422, 9: 6423, 10: 6424, 11: 6425 },
    Leather: { 4: 6426, 5: 6427, 6: 6428, 7: 6429, 8: 6430, 9: 6431, 10: 6432, 11: 6433 },
    Plate: { 4: 6434, 5: 6435, 6: 6436, 7: 6437, 8: 6438, 9: 6439, 10: 6440, 11: 6441 },
});

let _catalog = null;
let _catalogPromise = null;

export function initGearCatalog({ meta, weapons = [], armors = [], accs = [] }) {
    if (!meta) return null;
    const allItems = [...weapons, ...armors, ...accs];
    const itemById = new Map();
    const itemsBySlot = new Map();
    for (const s of meta.slots || []) itemsBySlot.set(s.id, []);

    for (const it of allItems) {
        itemById.set(it.id, it);
        for (const sid of it.slotid || []) {
            if (itemsBySlot.has(sid)) itemsBySlot.get(sid).push(it);
        }
    }

    const gradeById = new Map((meta.grades || []).map((g) => [g.id, g]));
    const gemById = new Map((meta.lunagems || []).map((g) => [g.id, g]));
    const frostById = new Map((meta.lunafrosts || []).map((f) => [f.id, f]));
    const titleById = new Map((meta.titles || []).map((t) => [t.id, t]));
    const equipBuffById = new Map((meta.equipmentBuffs || []).map((b) => [b.id, b]));

    _catalog = {
        meta,
        slots: meta.slots || [],
        grades: meta.grades || [],
        lunagems: meta.lunagems || [],
        lunafrosts: meta.lunafrosts || [],
        titles: meta.titles || [],
        equipmentBuffs: meta.equipmentBuffs || [],
        setEffects: meta.setEffects || {},
        synthPools: meta.synthPools || {},
        allItems,
        itemById,
        itemsBySlot,
        gradeById,
        gemById,
        frostById,
        titleById,
        equipBuffById,
    };
    return _catalog;
}

export function getGearCatalog() {
    return _catalog;
}

export async function reloadGearCatalog(basePath = "js/data/gear_catalog") {
    _catalog = null;
    _catalogPromise = null;
    const bust = `?t=${Date.now()}`;
    _catalogPromise = Promise.all([
        fetch(`${basePath}/meta.json${bust}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`${basePath}/items_weapons.json${bust}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`${basePath}/items_armor.json${bust}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`${basePath}/items_acc.json${bust}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`${basePath}/item_special_effects.json${bust}`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
    ])
        .then(([meta, weapons, armors, accs, specialEffects]) => {
            if (specialEffects) registerItemSpecialEffects(specialEffects);
            return initGearCatalog({ meta, weapons, armors, accs });
        })
        .catch((err) => {
            _catalogPromise = null;
            throw err;
        });
    return _catalogPromise;
}

export async function loadGearCatalog(basePath = "js/data/gear_catalog") {
    if (_catalog) return _catalog;
    if (_catalogPromise) return _catalogPromise;
    _catalogPromise = Promise.all([
        fetch(`${basePath}/meta.json`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`${basePath}/items_weapons.json`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`${basePath}/items_armor.json`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`${basePath}/items_acc.json`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`${basePath}/item_special_effects.json`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
    ])
        .then(([meta, weapons, armors, accs, specialEffects]) => {
            if (specialEffects) registerItemSpecialEffects(specialEffects);
            return initGearCatalog({ meta, weapons, armors, accs });
        })
        .catch((err) => {
            _catalogPromise = null;
            throw err;
        });
    return _catalogPromise;
}

const TRUSTED_ICON_HOSTS = new Set(["darugear.com", "www.darugear.com", "aa-classic.com", "www.aa-classic.com"]);

export function resolveGearIconUrl(rawImg) {
    if (!rawImg) return "";
    const s = String(rawImg).replace(/\\/g, "/").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) {
        try {
            const u = new URL(s);
            if ((u.protocol === "https:" || u.protocol === "http:") && TRUSTED_ICON_HOSTS.has(u.hostname.toLowerCase())) {
                return u.href;
            }
        } catch {
            return "";
        }
        return "";
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return "";
    if (s.includes("..")) return "";
    if (s.startsWith("assets/icons/")) return s;
    if (s.startsWith("/assets/icons/")) return `https://darugear.com${s}`;
    return `https://darugear.com/assets/icons/${s.replace(/^\/+/, "")}`;
}

export function createEmptyGearSlots(catalog = _catalog) {
    const slotDefs = catalog?.slots || [];
    return slotDefs.map((s) => ({ id: s.id, name: s.name, item: null }));
}

export function createDefaultRawPlayer(existing = null) {
    return {
        version: 1.3,
        health: Number(existing?.health ?? 8350),
        mana: Number(existing?.mana ?? 5600),
        str: Number(existing?.str ?? 158),
        dex: Number(existing?.dex ?? 158),
        sta: Number(existing?.sta ?? 158),
        spi: Number(existing?.spi ?? 158),
        int: Number(existing?.int ?? 158),
        title: existing?.title || null,
        buff: [],
        equipment_buff: [],
        playerclass: null,
    };
}

/**
 * Expand a compact catalog item into the full DaruGear `item.equipment` object
 * expected by `calculateDaruGearStats`.
 */
/**
 * Canonical AA Classic 1.3.6 Enlightened Accessory 3-Piece Set patches for items whose
 * set effects are missing or have wrong stat types in DaruGear's CSV extract:
 *  - Enlightened Berserker (9002022/9002023/9002024): Buff 9000752 / proc 9000756
 *  - Enlightened Shadow    (9001928/9001929/9001930): Buff 9000754 + Nov 24, 2026 Shadow Veil
 *  - Enlightened Arcanist  (9001925/9001926/9001927): Buff 9000755 (Max Mana +100% [996], not +100 flat [7]!)
 *  - Enlightened Oracle    (9001931/9001932/9001933): Buff 9000753 (Cast Time -30% + Mana Cost -20%)
 */
const ENLIGHTENED_ACC_SET_OVERRIDES = Object.freeze({
    9002022: 9000752,
    9002023: 9000752,
    9002024: 9000752,
    9001928: 9000754,
    9001929: 9000754,
    9001930: 9000754,
    9001925: 9000076,
    9001926: 9000076,
    9001927: 9000076,
    9001931: 9000075,
    9001932: 9000075,
    9001933: 9000075,
});

const ENLIGHTENED_ACC_SET_DEFS = Object.freeze({
    9000752: [
        {
            equip_item_set_id: 9000752,
            num_pieces: 3,
            unit_attribute_id: null,
            value: 0,
            linear_level_bonus: 0,
            calculated_value: 0,
            note: "Taking damage can trigger Berserker's Instinct (+1,000 Attack Speed for 30s, 3m CD).",
        },
    ],
    9000754: [
        {
            equip_item_set_id: 9000754,
            num_pieces: 3,
            unit_attribute_id: null,
            value: 0,
            linear_level_bonus: 0,
            calculated_value: 0,
            note: "Ethereal Shift: +30% Move Speed while stealthed & +30s mount stealth duration. Shadow Veil: untargetable for 1.5s when Stealth ends/breaks (10s CD); killing a player resets Stealth CD.",
        },
    ],
    9000076: [
        {
            equip_item_set_id: 9000076,
            num_pieces: 3,
            unit_attribute_id: 996, // Max Mana % (+100%)
            value: 100,
            linear_level_bonus: 0,
            calculated_value: 100,
            note: "Arcane Absorption: 50% of incoming damage converted to mana burn.",
        },
    ],
    9000075: [
        {
            equip_item_set_id: 9000075,
            num_pieces: 3,
            unit_attribute_id: 71, // Cast Time (-30.0%)
            value: -300,
            linear_level_bonus: 0,
            calculated_value: -300,
            note: "Fate's Edict: Mana Cost -20%.",
        },
    ],
});

export function hydrateCatalogEquipment(compactItem, catalog = _catalog) {
    if (!compactItem) return null;
    const w = Array.isArray(compactItem.w) ? compactItem.w : [0, 0, 0, 0, 0];
    const level = Number(compactItem.level) || 50;
    const overrideSetId = ENLIGHTENED_ACC_SET_OVERRIDES[Number(compactItem.id)] || null;
    const effectiveSetId = overrideSetId ?? compactItem.eiset_id ?? null;
    const rawSetEffects =
        overrideSetId && ENLIGHTENED_ACC_SET_DEFS[overrideSetId]
            ? ENLIGHTENED_ACC_SET_DEFS[overrideSetId]
            : effectiveSetId
              ? catalog?.setEffects?.[String(effectiveSetId)] || []
              : [];
    const seteffects = rawSetEffects.map((se) => ({
        ...se,
        calculated_value:
            se.calculated_value != null
                ? se.calculated_value
                : (Number(se.value) || 0) + ((Number(se.linear_level_bonus) || 0) * level) / 100,
    }));

    return {
        id: compactItem.id,
        name: compactItem.name,
        type: compactItem.type,
        level,
        mingrade: Number(compactItem.mingrade ?? 1),
        maxgrade: Number(compactItem.maxgrade ?? 11),
        slotid: Array.isArray(compactItem.slotid) ? [...compactItem.slotid] : [],
        img: compactItem.img || "",
        str_weight: Number(w[0] ?? compactItem.str_weight ?? 0),
        dex_weight: Number(w[1] ?? compactItem.dex_weight ?? 0),
        sta_weight: Number(w[2] ?? compactItem.sta_weight ?? 0),
        spi_weight: Number(w[3] ?? compactItem.spi_weight ?? 0),
        int_weight: Number(w[4] ?? compactItem.int_weight ?? 0),
        equipeffects: Array.isArray(compactItem.equipeffects) ? compactItem.equipeffects : [],
        seteffects,
        buff_json: Array.isArray(compactItem.buff_json) ? compactItem.buff_json : [],
        modifiers_json: Array.isArray(compactItem.modifiers_json) ? compactItem.modifiers_json : [],
        synth_cat_id: compactItem.synth_cat_id || 0,
        synth_percentage: 100,
        synth_slot_count: Array.isArray(compactItem.synth_slot_count) ? compactItem.synth_slot_count : [],
    };
}

export function getMaxSocketsForSlotAndGrade(slotId, gradeObj) {
    if (!gradeObj) return 0;
    const sid = Number(slotId);
    if (sid === 9) return Number(gradeObj.luna_count_xxs) || 0;
    if (sid === 3 || sid === 4) return Number(gradeObj.luna_count_xs) || 0;
    if (sid === 5 || sid === 8) return Number(gradeObj.luna_count_s) || 0;
    if (sid === 1 || sid === 7) return Number(gradeObj.luna_count_m) || 0;
    if ([2, 15, 16, 17, 18].includes(sid)) return Number(gradeObj.luna_count_l) || 0;
    return 0;
}

export function getSynthSlotCountForGrade(equipment, gradeId) {
    if (!equipment || !Array.isArray(equipment.synth_slot_count)) return 0;
    const found = equipment.synth_slot_count.find((x) => Number(x.grade) === Number(gradeId));
    return found ? Number(found.max_unit_modifier_num) || 0 : 0;
}

export function getAvailableSynthPool(equipment, gradeId, catalog = _catalog) {
    if (!equipment?.synth_cat_id || !catalog?.synthPools) return [];
    const byGrade = catalog.synthPools[String(equipment.synth_cat_id)];
    if (!byGrade) return [];
    return byGrade[String(gradeId)] || [];
}

export function filterItemsForSlot(slotId, { query = "", typeFilter = "all", limit = 120 } = {}, catalog = _catalog) {
    const list = catalog?.itemsBySlot?.get(Number(slotId)) || [];
    const q = String(query || "").trim().toLowerCase();
    const t = String(typeFilter || "all");
    const out = [];
    for (const it of list) {
        if (t !== "all" && it.type !== t) continue;
        if (q && !it.name.toLowerCase().includes(q) && !it.type.toLowerCase().includes(q)) continue;
        out.push(it);
        if (out.length >= limit) break;
    }
    return out;
}

export function getItemTypesForSlot(slotId, catalog = _catalog) {
    const list = catalog?.itemsBySlot?.get(Number(slotId)) || [];
    const types = Array.from(new Set(list.map((it) => it.type).filter(Boolean)));
    const order = ["Cloth", "Leather", "Plate", "Cloak", "Synthesis Gear"];
    types.sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1;
        if (ib >= 0) return 1;
        return a.localeCompare(b);
    });
    return types;
}

export function filterLunafrostsForSlot(slotId, item, catalog = _catalog) {
    const list = catalog?.lunafrosts || [];
    const sid = Number(slotId);
    const iType = item?.equipment?.type || "";
    const iName = item?.equipment?.name || "";
    return list.filter((f) => {
        if (!Array.isArray(f.slotid) || !f.slotid.includes(sid)) return false;
        if (Array.isArray(f.limit_type) && f.limit_type.length > 0 && iType && !f.limit_type.includes(iType)) {
            return false;
        }
        if (Array.isArray(f.limit_name) && f.limit_name.length > 0 && iName) {
            if (!f.limit_name.some((kw) => iName.includes(kw))) return false;
        }
        return true;
    });
}

export function filterLunagemsForSlot(slotId, item, catalog = _catalog) {
    const list = catalog?.lunagems || [];
    const sid = Number(slotId);
    const iType = item?.equipment?.type || "";
    return list.filter((g) => {
        if (!Array.isArray(g.slotid) || !g.slotid.includes(sid)) return false;
        if (Array.isArray(g.limit_type) && g.limit_type.length > 0 && iType && !g.limit_type.includes(iType)) {
            return false;
        }
        return true;
    });
}

function hydrateLunafrost(frostMeta, itemLevel, catalog = _catalog) {
    if (!frostMeta) return null;
    const rawSet = frostMeta.eiset_id ? catalog?.setEffects?.[String(frostMeta.eiset_id)] || [] : [];
    const seteffects = rawSet.map((se) => ({
        ...se,
        calculated_value: (Number(se.value) || 0) + ((Number(se.linear_level_bonus) || 0) * (itemLevel || 50)) / 100,
    }));
    return {
        id: frostMeta.id,
        name: frostMeta.name,
        level: frostMeta.level,
        gradeid: frostMeta.gradeid,
        img: frostMeta.img,
        effect_text: frostMeta.effect_text || "",
        effects: Array.isArray(frostMeta.effects) ? frostMeta.effects : [],
        seteffects,
    };
}

function hydrateLunagem(gemMeta) {
    if (!gemMeta) return null;
    return {
        id: gemMeta.id,
        name: gemMeta.name,
        level: gemMeta.level,
        gradeid: gemMeta.gradeid,
        img: gemMeta.img,
        effect_text: gemMeta.effect_text || "",
        effects: Array.isArray(gemMeta.effects) ? gemMeta.effects : [],
    };
}

function normalizeItemSockets(slotId, item) {
    const maxS = getMaxSocketsForSlotAndGrade(slotId, item.grade);
    const cur = Array.isArray(item.lunagem) ? item.lunagem.filter((g) => g && g.id !== 0) : [];
    const padded = cur.slice(0, maxS);
    while (padded.length < maxS) {
        padded.push({ id: 0, name: "", level: 0, gradeid: 0, effect_text: "", effects: [] });
    }
    item.lunagem = padded;
}

/**
 * Find the exact index in `pool` corresponding to an existing synthesis stat entry `stat`.
 * Handles Cloak pools where the same `unit_attribute_id` has multiple tiers (e.g. High vs Low roll).
 */
export function getSynthPoolIndexForStat(stat, pool) {
    if (!stat || !Array.isArray(pool) || pool.length === 0) return -1;
    const aid = Number(stat.unit_attribute_id);
    if (!Number.isFinite(aid)) return -1;

    // 1. Exact (attrId, minvalue, maxvalue) match
    const sMin = Number(stat.minvalue);
    const sMax = Number(stat.maxvalue);
    const exactIdx = pool.findIndex(
        (p) =>
            Number(p.unit_attribute_id) === aid &&
            Number(p.minvalue) === sMin &&
            Number(p.maxvalue) === sMax
    );
    if (exactIdx >= 0) return exactIdx;

    // Collect all pool indices sharing this unit_attribute_id (ordered highest magnitude first in catalog)
    const sameAttrIndices = [];
    for (let i = 0; i < pool.length; i++) {
        if (Number(pool[i].unit_attribute_id) === aid) sameAttrIndices.push(i);
    }
    if (sameAttrIndices.length === 0) return -1;
    if (sameAttrIndices.length === 1) return sameAttrIndices[0];

    // 2. Preserve explicit tier index (0 = High/Primary, 1 = Low/Secondary) across grade upgrades
    if (Number.isInteger(stat._poolTierIdx) && stat._poolTierIdx >= 0 && stat._poolTierIdx < sameAttrIndices.length) {
        return sameAttrIndices[stat._poolTierIdx];
    }

    // 3. Match closest roll range midpoint / maxvalue if numeric value is available
    if (Number.isFinite(sMax)) {
        let bestIdx = sameAttrIndices[0];
        let bestDist = Infinity;
        for (const idx of sameAttrIndices) {
            const p = pool[idx];
            const dist = Math.abs(Math.abs(Number(p.maxvalue)) - Math.abs(sMax));
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = idx;
            }
        }
        return bestIdx;
    }

    // 4. Default to first (highest-magnitude) entry
    return sameAttrIndices[0];
}

function tagSynthPoolEntry(pool, poolIdx) {
    const entry = pool?.[poolIdx];
    if (!entry) return null;
    const aid = Number(entry.unit_attribute_id);
    let tierIdx = 0;
    for (let i = 0; i < poolIdx; i++) {
        if (Number(pool[i].unit_attribute_id) === aid) tierIdx++;
    }
    return { ...entry, _poolTierIdx: tierIdx };
}

function normalizeItemSynthSlots(item, catalog = _catalog, reset = false) {
    const count = getSynthSlotCountForGrade(item.equipment, item.grade?.id);
    const pool = getAvailableSynthPool(item.equipment, item.grade?.id, catalog);
    if (count <= 0 || pool.length === 0) {
        item.sythisis_stat = [];
        return;
    }
    const existing = !reset && Array.isArray(item.sythisis_stat) ? item.sythisis_stat.slice(0, count) : [];
    const usedAttrIds = new Set();
    const out = [];
    for (let i = 0; i < count; i++) {
        const prev = existing[i];
        if (prev && prev.unit_attribute_id != null) {
            const aid = Number(prev.unit_attribute_id);
            if (!usedAttrIds.has(aid)) {
                const matchedIdx = getSynthPoolIndexForStat(prev, pool);
                if (matchedIdx >= 0) {
                    usedAttrIds.add(aid);
                    out.push(tagSynthPoolEntry(pool, matchedIdx));
                    continue;
                }
                // Preserve imported/custom synthesis stat lines not present in the catalog pool
                usedAttrIds.add(aid);
                out.push({ ...prev });
                continue;
            }
        }
        out.push(null);
    }
    item.sythisis_stat = out;
}

/**
 * Exact DaruGear `dn.setGearBuffs(slots, player)` recomputation:
 * Computes Armor Set Buff (4pc/7pc), Armor Grade Buff (4pc+ quadratic HP/Mana),
 * Weapon Archetype Buff (2H #8227, Dual Wield #4899, Shield #16559), and Title buff.
 */
export function recomputeGearBuffs(slots, player, catalog = _catalog) {
    const byId = catalog?.equipBuffById;
    if (!byId) return [];

    const cloneBuff = (id) => {
        const b = byId.get(id);
        if (!b) return null;
        return {
            id: b.id,
            name: b.name,
            icon: b.img,
            is_debuff: false,
            is_optional: false,
            data: (b.data || []).map((d) => ({ ...d })),
        };
    };

    const clothAll = [];
    const leatherAll = [];
    const plateAll = [];
    const clothQual = [];
    const leatherQual = [];
    const plateQual = [];
    const buffs = [];

    for (const s of slots || []) {
        const eq = s?.item?.equipment;
        const gid = Number(s?.item?.grade?.id ?? 0);
        if (!eq) continue;
        if (s.id > 0 && s.id <= 8 && s.id !== 6) {
            const rec = { level: Number(eq.level) || 50, grade: gid };
            if (eq.type === "Cloth") {
                clothAll.push(rec);
                if (gid >= 4) clothQual.push(rec);
            } else if (eq.type === "Leather") {
                leatherAll.push(rec);
                if (gid >= 4) leatherQual.push(rec);
            } else if (eq.type === "Plate") {
                plateAll.push(rec);
                if (gid >= 4) plateQual.push(rec);
            }
        }
        if (s.id === 15 && TWO_HAND_TYPES.has(eq.type)) {
            const b = cloneBuff(8227);
            if (b) buffs.push(b);
        } else if (s.id === 16 && SHIELD_TYPES.has(eq.type)) {
            const b = cloneBuff(16559);
            if (b) buffs.push(b);
        } else if (s.id === 16) {
            const b = cloneBuff(4899);
            if (b) buffs.push(b);
        }
    }

    if (clothAll.length === 7) buffs.push(cloneBuff(714));
    else if (clothAll.length >= 4) buffs.push(cloneBuff(713));
    else if (leatherAll.length === 7) buffs.push(cloneBuff(716));
    else if (leatherAll.length >= 4) buffs.push(cloneBuff(715));
    else if (plateAll.length === 7) {
        const b = cloneBuff(740);
        if (b) {
            // AA Classic 3.5 Complete Plate Set (7pc): +5% Max Health (995) & +3% Physical Defense (994)
            // (DaruGear's CSV stores these as raw ids 6 & 8 and its setGearBuffs accidentally clobbered id 6 with Grade Buff HP.)
            b.data = b.data.map((d) =>
                d.unit_attribute_id === 6
                    ? { ...d, unit_attribute_id: 995 }
                    : d.unit_attribute_id === 8
                      ? { ...d, unit_attribute_id: 994 }
                      : d
            );
            buffs.push(b);
        }
    } else if (plateAll.length >= 4) {
        const b = cloneBuff(717);
        if (b) {
            // AA Classic 3.5 Plate Set (4pc): +3% Max Health (995) & +3% Physical Defense (994)
            b.data = b.data.map((d) =>
                d.unit_attribute_id === 6
                    ? { ...d, unit_attribute_id: 995 }
                    : d.unit_attribute_id === 8
                      ? { ...d, unit_attribute_id: 994 }
                      : d
            );
            buffs.push(b);
        }
    }

    // Armor Grade Buff (exact DaruGear priority: Cloth -> Leather -> Plate, min grade >= 4 across >= 4 pieces)
    let gradeBuffId = null;
    let gradePieces = null;
    for (const [aType, arr] of [
        ["Cloth", clothQual],
        ["Leather", leatherQual],
        ["Plate", plateQual],
    ]) {
        if (arr.length >= 4) {
            const minG = Math.min(11, Math.min(...arr.map((x) => x.grade)));
            gradeBuffId = GRADE_BUFF_IDS[aType]?.[minG] || null;
            gradePieces = arr;
        }
    }

    if (gradeBuffId && gradePieces) {
        const gb = cloneBuff(gradeBuffId);
        if (gb) {
            let hp = 0;
            let mp = 0;
            for (const eff of gb.data) {
                if (eff.unit_attribute_id === 6) {
                    for (const p of gradePieces) {
                        const lvl = p.level;
                        hp += (0.310118 - 959369e-9 * lvl + 680281e-9 * lvl * lvl) * (eff.linear_level_bonus || 0);
                    }
                } else if (eff.unit_attribute_id === 7) {
                    for (const p of gradePieces) {
                        const lvl = p.level;
                        mp += (0.310118 - 959369e-9 * lvl + 680281e-9 * lvl * lvl) * (eff.linear_level_bonus || 0);
                    }
                }
            }
            hp = Math.round(hp);
            mp = Math.round(mp);
            for (const eff of gb.data) {
                if (eff.unit_attribute_id === 6) eff.value = hp;
                else if (eff.unit_attribute_id === 7) eff.value = mp;
            }
            buffs.push(gb);
        }
    }

    const filtered = buffs.filter(Boolean);

    // Title buff
    if (player?.title && Array.isArray(player.title.data) && player.title.data.length > 0) {
        filtered.push({
            id: player.title.buff_id || player.title.id,
            name: player.title.name,
            icon: player.title.img || "",
            is_debuff: false,
            is_optional: false,
            data: player.title.data.map((d) => ({ ...d })),
        });
    }

    return filtered;
}

function cloneSlots(slots) {
    return (slots || []).map((s) => ({
        id: s.id,
        name: s.name,
        item: s.item
            ? {
                  ...s.item,
                  grade: s.item.grade ? { ...s.item.grade } : null,
                  equipment: s.item.equipment ? { ...s.item.equipment } : null,
                  lunafrost: s.item.lunafrost ? { ...s.item.lunafrost } : null,
                  lunagem: Array.isArray(s.item.lunagem) ? s.item.lunagem.map((g) => (g ? { ...g } : g)) : [],
                  sythisis_stat: Array.isArray(s.item.sythisis_stat)
                      ? s.item.sythisis_stat.map((st) => (st ? { ...st } : null))
                      : [],
              }
            : null,
    }));
}

export function equipCatalogItemInSlot(slots, slotId, catalogItem, options = {}, catalog = _catalog) {
    const next = cloneSlots(slots);
    const sid = Number(slotId);
    const slot = next.find((s) => Number(s.id) === sid);
    if (!slot || !catalogItem) return next;

    const existing = slot.item;
    const eq = hydrateCatalogEquipment(catalogItem, catalog);
    const defaultGradeId = Math.max(
        eq.mingrade,
        Math.min(eq.maxgrade, Number(options.gradeId ?? existing?.grade?.id ?? (eq.maxgrade >= 9 ? 9 : eq.maxgrade)))
    );
    const gradeObj = catalog?.gradeById?.get(defaultGradeId) || catalog?.grades?.[9];

    const keepExisting = Boolean(options.keepGemsFrost);
    if (keepExisting && existing?.equipment?.synth_percentage != null) {
        eq.synth_percentage = Number(existing.equipment.synth_percentage);
    }
    const newItem = {
        slotid: sid,
        ptemper: Number(options.ptemper ?? existing?.ptemper ?? 100),
        mtemper: Number(options.mtemper ?? existing?.mtemper ?? 100),
        grade: gradeObj ? { ...gradeObj } : null,
        equipment: eq,
        lunafrost: keepExisting && existing?.lunafrost ? { ...existing.lunafrost } : null,
        lunagem: keepExisting && Array.isArray(existing?.lunagem) ? existing.lunagem.map((g) => ({ ...g })) : [],
        sythisis_stat:
            keepExisting && Array.isArray(existing?.sythisis_stat)
                ? existing.sythisis_stat.map((st) => (st ? { ...st } : null))
                : [],
    };

    // Validate kept lunafrost/lunagems against new item's type/name rules
    if (newItem.lunafrost) {
        const validFrosts = filterLunafrostsForSlot(sid, newItem, catalog);
        if (!validFrosts.some((f) => f.id === newItem.lunafrost.id)) {
            newItem.lunafrost = null;
        }
    }
    if (newItem.lunagem.length > 0) {
        const validGems = new Set(filterLunagemsForSlot(sid, newItem, catalog).map((g) => g.id));
        newItem.lunagem = newItem.lunagem.filter((g) => g && g.id !== 0 && validGems.has(g.id));
    }

    normalizeItemSockets(sid, newItem);
    normalizeItemSynthSlots(newItem, catalog, !keepExisting);
    slot.item = newItem;

    // Mutual exclusion between 2H weapon in slot 15 and offhand/shield in slot 16
    if (sid === 15 && TWO_HAND_TYPES.has(eq.type)) {
        const oh = next.find((s) => s.id === 16);
        if (oh) oh.item = null;
    } else if (sid === 16) {
        const mh = next.find((s) => s.id === 15);
        if (mh?.item?.equipment && TWO_HAND_TYPES.has(mh.item.equipment.type)) {
            mh.item = null;
        }
    }

    return next;
}

/**
 * Build the categorized catalog of swappable Armor Set Presets
 * (Ayanad 7pc, T7 Obsidian 5pc, T6 Obsidian 5pc, Dungeon Gear 7pc, Delphinad 7pc)
 * directly from the loaded Gear Catalog so every preset maps to real catalog item IDs.
 */
const ARMOR_SET_SLOTS_7 = [1, 2, 3, 4, 5, 7, 8];
const ARMOR_SET_SLOTS_5 = [1, 2, 5, 7, 8];

const CRAFTED_PREFIXES_BY_TYPE = Object.freeze({
    Cloth: ["Earth", "Lake", "Life", "Meadow", "Ocean", "Stone", "Wave"],
    Leather: ["Desert", "Earth", "Flame", "Gale", "Lightning", "Squall", "Typhoon"],
    Plate: ["Desert", "Earth", "Flame", "Lake", "Quake", "Sunset", "Wave"],
});

const T7_OBSIDIAN_VARIANTS = Object.freeze([
    { id: "t7_cloth_mage", armorType: "Cloth", variantIdx: 0, label: "Cloth — T7 Obsidian Mage (Ehnoïr · 75% INT)" },
    { id: "t7_cloth_tanky_mage", armorType: "Cloth", variantIdx: 1, label: "Cloth — T7 Obsidian Tanky Mage (Ehnoïr · 60% INT)" },
    { id: "t7_cloth_spirit", armorType: "Cloth", variantIdx: 2, label: "Cloth — T7 Obsidian Spirit (Ehnoïr · 75% SPI)" },
    { id: "t7_cloth_healer", armorType: "Cloth", variantIdx: 3, label: "Cloth — T7 Obsidian Healer (Ehnoïr · 60% SPI)" },
    { id: "t7_leather_melee", armorType: "Leather", variantIdx: 0, label: "Leather — T7 Obsidian Melee (Mahra Tali · 75% STR)" },
    { id: "t7_leather_bruiser", armorType: "Leather", variantIdx: 1, label: "Leather — T7 Obsidian Bruiser (Mahra Tali · 60% STR)" },
    { id: "t7_leather_archer", armorType: "Leather", variantIdx: 2, label: "Leather — T7 Obsidian Archer (Mahra Tali · 75% AGI)" },
    { id: "t7_leather_tanky_archer", armorType: "Leather", variantIdx: 3, label: "Leather — T7 Obsidian Tanky Archer (Mahra Tali · 60% AGI)" },
    { id: "t7_plate_dps", armorType: "Plate", variantIdx: 0, label: "Plate — T7 Obsidian Melee (Illion · 75% STR)" },
    { id: "t7_plate_bruiser", armorType: "Plate", variantIdx: 1, label: "Plate — T7 Obsidian Bruiser (Illion · 70% STA)" },
    { id: "t7_plate_parry", armorType: "Plate", variantIdx: 2, label: "Plate — T7 Obsidian Parry (Illion · 75% STR)" },
    { id: "t7_plate_tank", armorType: "Plate", variantIdx: 3, label: "Plate — T7 Obsidian Tank (Illion · 70% STA)" },
]);

const T6_OBSIDIAN_VARIANTS = Object.freeze([
    { id: "t6_cloth_mage", armorType: "Cloth", prefix: "Cold Flames", label: "Cloth — T6 Obsidian Mage (Cold Flames)" },
    { id: "t6_cloth_healer", armorType: "Cloth", prefix: "Purehearted Goddess", label: "Cloth — T6 Obsidian Healer (Purehearted Goddess)" },
    { id: "t6_leather_melee", armorType: "Leather", prefix: "Screaming Shadow", label: "Leather — T6 Obsidian Melee (Screaming Shadow)" },
    { id: "t6_leather_archer", armorType: "Leather", prefix: "Dashing Evanescence", label: "Leather — T6 Obsidian Archer (Dashing Evanescence)" },
    { id: "t6_plate_melee", armorType: "Plate", prefix: "Brutal Annihilator", label: "Plate — T6 Obsidian Melee (Brutal Annihilator)" },
    { id: "t6_plate_tank", armorType: "Plate", prefix: "Starbound Conviction", label: "Plate — T6 Obsidian Tank (Starbound Conviction)" },
]);

const DUNGEON_ARMOR_VARIANTS = Object.freeze([
    // Mistsong Summit (Lv 55, 7pc)
    { id: "dungeon_mistsong_cloth_mage", armorType: "Cloth", eisetId: 416, label: "Cloth — Mistsong Mage (Tempting Melody · INT)" },
    { id: "dungeon_mistsong_cloth_healer", armorType: "Cloth", eisetId: 417, label: "Cloth — Mistsong Healer (Enchanting Melody · SPI)" },
    { id: "dungeon_mistsong_leather_tank", armorType: "Leather", eisetId: 415, label: "Leather — Mistsong Talisman (STA)" },
    { id: "dungeon_mistsong_leather_archer", armorType: "Leather", eisetId: 9000018, label: "Leather — Mistsong Flexible Talisman (AGI)" },
    { id: "dungeon_mistsong_plate", armorType: "Plate", eisetId: 414, label: "Plate — Mistsong Hexbane (STR/STA)" },
    // Serpentis (Lv 53, 7pc)
    { id: "dungeon_serpentis_cloth_mage", armorType: "Cloth", eisetId: 167, label: "Cloth — Serpentis Shadowsong (STA/INT)" },
    { id: "dungeon_serpentis_cloth_healer", armorType: "Cloth", eisetId: 386, label: "Cloth — Serpentis Distorted Chanter's (SPI/STA)" },
    { id: "dungeon_serpentis_leather", armorType: "Leather", eisetId: 168, label: "Leather — Serpentis Dark Watcher (AGI/STR)" },
    { id: "dungeon_serpentis_plate", armorType: "Plate", eisetId: 169, label: "Plate — Serpentis Scarlet Reaper (STA/STR)" },
    // Kyrios / Anthalon (7pc)
    { id: "dungeon_primal_kyrios", armorType: "Cloth", eisetId: 9000113, label: "Cloth — Primal Kyrios (STA/INT)" },
    { id: "dungeon_corrupted_kyrios", armorType: "Cloth", eisetId: 111, label: "Cloth — Corrupted Kyrios (INT)" },
    // Greater Dungeons (Lv 52, 7pc)
    { id: "dungeon_greater_cloth", armorType: "Cloth", eisetId: 196, label: "Cloth — Greater Dungeon Recollections" },
    { id: "dungeon_greater_leather", armorType: "Leather", eisetId: 195, label: "Leather — Greater Dungeon Ephemeral Memory" },
    { id: "dungeon_greater_plate", armorType: "Plate", eisetId: 194, label: "Plate — Greater Dungeon Ardent Oath" },
    // Hellforged Dungeon Catch-Up (Lv 52, Celestial max, 7pc)
    { id: "dungeon_hellforged_cloth_mage", armorType: "Cloth", eisetId: 9000016, label: "Cloth — Hellforged Mage (INT/STA)" },
    { id: "dungeon_hellforged_cloth_healer", armorType: "Cloth", eisetId: 9000017, label: "Cloth — Hellforged Priest (SPI/STA)" },
    { id: "dungeon_hellforged_leather_melee", armorType: "Leather", eisetId: 9000014, label: "Leather — Hellforged Warrior (STR/STA)" },
    { id: "dungeon_hellforged_leather_archer", armorType: "Leather", eisetId: 9000015, label: "Leather — Hellforged Ranger (AGI/STA)" },
    { id: "dungeon_hellforged_plate", armorType: "Plate", eisetId: 9000013, label: "Plate — Hellforged Plate (STA/STR)" },
    // Greater Howling Abyss / Classic Dungeons (Lv 44, 7pc)
    { id: "dungeon_gha_cloth", armorType: "Cloth", eisetId: 160, label: "Cloth — GHA Fallen Martyr's" },
    { id: "dungeon_gha_leather", armorType: "Leather", eisetId: 161, label: "Leather — GHA High Inquisitor's" },
    { id: "dungeon_gha_plate", armorType: "Plate", eisetId: 162, label: "Plate — GHA Corrupt Paladin's" },
]);

export function getArmorSetPresets(catalog = _catalog) {
    if (!catalog?.itemsBySlot) return [];
    const presets = [];

    const resolveCraftedSet = (tierPrefix, groupLabel, idPrefix) => {
        for (const armorType of ["Leather", "Cloth", "Plate"]) {
            for (const sub of CRAFTED_PREFIXES_BY_TYPE[armorType]) {
                const namePrefix = `${tierPrefix} ${sub} `;
                const slotItems = {};
                let ok = true;
                for (const sid of ARMOR_SET_SLOTS_7) {
                    const list = catalog.itemsBySlot.get(sid) || [];
                    const found = list.find(
                        (it) => it.type === armorType && typeof it.name === "string" && it.name.startsWith(namePrefix)
                    );
                    if (!found) {
                        ok = false;
                        break;
                    }
                    slotItems[sid] = found;
                }
                if (ok) {
                    presets.push({
                        id: `${idPrefix}_${armorType.toLowerCase()}_${sub.toLowerCase()}`,
                        group: groupLabel,
                        armorType,
                        slotCount: 7,
                        label: `${armorType} — ${tierPrefix} ${sub}`,
                        slotItems,
                    });
                }
            }
        }
    };

    // 1. Ayanad (7pc)
    resolveCraftedSet("Ayanad", "Ayanad Armor (7pc)", "ayanad");

    // 2. T7 Obsidian (5pc: Head, Chest, Hands, Legs, Feet)
    for (const v of T7_OBSIDIAN_VARIANTS) {
        const slotItems = {};
        let ok = true;
        for (const sid of ARMOR_SET_SLOTS_5) {
            const list = (catalog.itemsBySlot.get(sid) || [])
                .filter((it) => it.type === v.armorType && Number(it.level) === 64 && Number(it.id) < 9000000)
                .sort((a, b) => Number(a.id) - Number(b.id));
            const picked = list[v.variantIdx];
            if (!picked) {
                ok = false;
                break;
            }
            slotItems[sid] = picked;
        }
        if (ok) {
            presets.push({
                id: v.id,
                group: "T7 Obsidian Armor (5pc)",
                armorType: v.armorType,
                slotCount: 5,
                label: v.label,
                slotItems,
            });
        }
    }

    // 3. T6 Obsidian (5pc: Head, Chest, Hands, Legs, Feet)
    for (const v of T6_OBSIDIAN_VARIANTS) {
        const slotItems = {};
        let ok = true;
        for (const sid of ARMOR_SET_SLOTS_5) {
            const list = (catalog.itemsBySlot.get(sid) || [])
                .filter(
                    (it) =>
                        it.type === v.armorType &&
                        Number(it.level) === 59 &&
                        Number(it.id) < 9000000 &&
                        typeof it.name === "string" &&
                        it.name.startsWith(v.prefix)
                )
                .sort((a, b) => Number(a.id) - Number(b.id));
            const picked = list[0];
            if (!picked) {
                ok = false;
                break;
            }
            slotItems[sid] = picked;
        }
        if (ok) {
            presets.push({
                id: v.id,
                group: "T6 Obsidian Armor (5pc)",
                armorType: v.armorType,
                slotCount: 5,
                label: v.label,
                slotItems,
            });
        }
    }

    // 4. Dungeon Gear (7pc: Mistsong, Serpentis, Kyrios, Greater Dungeons, Hellforged, GHA)
    for (const v of DUNGEON_ARMOR_VARIANTS) {
        const slotItems = {};
        let ok = true;
        for (const sid of ARMOR_SET_SLOTS_7) {
            const list = (catalog.itemsBySlot.get(sid) || [])
                .filter((it) => it.type === v.armorType && Number(it.eiset_id) === Number(v.eisetId))
                .sort((a, b) => Number(a.id) - Number(b.id));
            const picked = list[0];
            if (!picked) {
                ok = false;
                break;
            }
            slotItems[sid] = picked;
        }
        if (ok) {
            presets.push({
                id: v.id,
                group: "Dungeon Gear (7pc)",
                armorType: v.armorType,
                slotCount: 7,
                label: v.label,
                slotItems,
            });
        }
    }

    // 5. Delphinad (7pc)
    resolveCraftedSet("Delphinad", "Delphinad Armor (7pc)", "delphinad");

    return presets;
}

/**
 * Swap all armor slots belonging to `presetId` (7 slots for crafted sets, 5 slots for Obsidian sets)
 * while preserving each slot's existing grade (unless `options.gradeId` is passed), temper, and
 * compatible lunafrosts/lunagems.
 */
export function equipArmorSetPreset(slots, presetId, options = {}, catalog = _catalog) {
    const presets = getArmorSetPresets(catalog);
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return { slots: cloneSlots(slots), preset: null, swappedCount: 0 };

    let next = cloneSlots(slots);
    const keepGemsFrost = options.keepGemsFrost !== false;
    const explicitGradeId =
        options.gradeId != null && options.gradeId !== "" && Number.isFinite(Number(options.gradeId))
            ? Number(options.gradeId)
            : null;
    let swappedCount = 0;

    for (const [sidStr, catItem] of Object.entries(preset.slotItems)) {
        const sid = Number(sidStr);
        next = equipCatalogItemInSlot(
            next,
            sid,
            catItem,
            {
                keepGemsFrost,
                ...(explicitGradeId != null ? { gradeId: explicitGradeId } : {}),
            },
            catalog
        );
        swappedCount++;
    }

    return { slots: next, preset, swappedCount };
}

export const GEAR_TEMPLATE_SLOT_GROUPS = Object.freeze([
    { id: "all_equipped", label: "All Equipped", slotIds: null },
    { id: "armor_7", label: "Armor (7pc)", slotIds: [1, 2, 3, 4, 5, 7, 8] },
    { id: "obsidian_5", label: "Obsidian (5pc)", slotIds: [1, 2, 5, 7, 8] },
    { id: "weapons", label: "Weapons & Inst.", slotIds: [15, 16, 17, 18] },
    { id: "accessories", label: "Accessories & Cloak", slotIds: [6, 10, 11, 12, 13, 14] },
    { id: "costume_under", label: "Costume & Under", slotIds: [0, 9] },
]);

const FORBIDDEN_TEMPLATE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function slugifyTemplateId(raw) {
    const s = String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^[-_]+|[-_]+$/g, "");
    return (s || `template-${Date.now()}`).slice(0, 64);
}

/**
 * Sanitize a gear template loaded from disk/localStorage so it is safe and schema-consistent.
 */
export function normalizeGearTemplate(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const name = String(raw.name || "").trim();
    if (!name) return null;
    const id = slugifyTemplateId(raw.id || name);
    const rawSlots = raw.slots && typeof raw.slots === "object" && !Array.isArray(raw.slots) ? raw.slots : {};
    const slots = {};
    for (const [k, v] of Object.entries(rawSlots)) {
        if (FORBIDDEN_TEMPLATE_KEYS.has(k)) continue;
        const sid = Number(k);
        if (!Number.isInteger(sid) || sid < 0 || sid > 19) continue;
        if (!v || typeof v !== "object" || Array.isArray(v)) continue;
        if (v.empty) {
            slots[String(sid)] = { empty: true };
            continue;
        }
        const itemId = Number(v.itemId);
        const itemName = String(v.itemName || "").trim();
        if (!(Number.isFinite(itemId) && itemId > 0) && !itemName) continue;
        const entry = {
            ...(Number.isFinite(itemId) && itemId > 0 ? { itemId } : {}),
            ...(itemName ? { itemName } : {}),
            ...(v.gradeId != null && Number.isFinite(Number(v.gradeId)) ? { gradeId: Number(v.gradeId) } : {}),
            ...(v.ptemper != null && Number.isFinite(Number(v.ptemper)) ? { ptemper: Number(v.ptemper) } : {}),
            ...(v.mtemper != null && Number.isFinite(Number(v.mtemper)) ? { mtemper: Number(v.mtemper) } : {}),
            ...(v.lunafrostId != null && Number.isFinite(Number(v.lunafrostId)) && Number(v.lunafrostId) > 0
                ? { lunafrostId: Number(v.lunafrostId) }
                : {}),
            ...(Array.isArray(v.lunagemIds)
                ? {
                      lunagemIds: v.lunagemIds
                          .slice(0, 10)
                          .map((gid) => (Number.isFinite(Number(gid)) && Number(gid) > 0 ? Number(gid) : 0)),
                  }
                : {}),
            ...(v.synthPct != null && Number.isFinite(Number(v.synthPct))
                ? { synthPct: Math.max(0, Math.min(100, Number(v.synthPct))) }
                : {}),
            ...(Array.isArray(v.synthAttrIds)
                ? {
                      synthAttrIds: v.synthAttrIds
                          .slice(0, 8)
                          .map((aid) => (aid != null && Number.isFinite(Number(aid)) && Number(aid) > 0 ? Number(aid) : null)),
                  }
                : {}),
        };
        slots[String(sid)] = entry;
    }
    const slotCount = Object.keys(slots).length;
    if (slotCount === 0) return null;
    return {
        id,
        name: name.slice(0, 80),
        notes: String(raw.notes || "").trim().slice(0, 160),
        updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : new Date().toISOString(),
        slotCount,
        slots,
    };
}

/**
 * Snapshot selected slots from a 20-slot Gear Builder state into a compact, portable Gear Template
 * preserving item ID/name, grade, tempers, lunafrost, lunagems, and synthesis % / stats.
 */
export function extractGearTemplateFromSlots(
    slots,
    { id = null, name = "Custom Template", notes = "", slotIds = null, includeEmpty = false } = {}
) {
    const cleanName = String(name || "").trim() || "Custom Template";
    const allowedSet =
        Array.isArray(slotIds) && slotIds.length > 0 ? new Set(slotIds.map((x) => Number(x))) : null;
    const outSlots = {};

    for (const s of slots || []) {
        const sid = Number(s?.id);
        if (!Number.isInteger(sid) || sid < 0 || sid > 19) continue;
        if (allowedSet && !allowedSet.has(sid)) continue;
        const it = s.item;
        if (!it?.equipment) {
            if (includeEmpty && allowedSet) {
                outSlots[String(sid)] = { empty: true };
            }
            continue;
        }
        const eq = it.equipment;
        const lunagemIds = Array.isArray(it.lunagem)
            ? it.lunagem.map((g) => (g && Number(g.id) > 0 ? Number(g.id) : 0))
            : [];
        const hasAnyGem = lunagemIds.some((g) => g > 0);
        const synthAttrIds = Array.isArray(it.sythisis_stat)
            ? it.sythisis_stat.map((st) =>
                  st && Number(st.unit_attribute_id) > 0 ? Number(st.unit_attribute_id) : null
              )
            : [];
        const hasAnySynth = synthAttrIds.some((a) => a != null);

        outSlots[String(sid)] = {
            itemId: Number(eq.id) || 0,
            itemName: String(eq.name || ""),
            gradeId: Number(it.grade?.id ?? 9),
            ptemper: Number(it.ptemper ?? 100),
            mtemper: Number(it.mtemper ?? 100),
            ...(it.lunafrost && Number(it.lunafrost.id) > 0 ? { lunafrostId: Number(it.lunafrost.id) } : {}),
            ...(hasAnyGem ? { lunagemIds } : {}),
            ...(eq.synth_percentage != null ? { synthPct: Number(eq.synth_percentage) } : {}),
            ...(hasAnySynth ? { synthAttrIds } : {}),
        };
    }

    return normalizeGearTemplate({
        id: id || slugifyTemplateId(cleanName),
        name: cleanName,
        notes,
        updatedAt: new Date().toISOString(),
        slots: outSlots,
    });
}

/**
 * Apply a saved custom Gear Template onto a 20-slot Gear Builder state.
 * Only slots defined in `template.slots` are modified; all other slots stay untouched.
 *
 * Options:
 * - `gradeMode`: `"template"` (default, use template slot grades), `"keep"` (keep target build's
 *    existing grade per slot), or an explicit grade ID (`7`..`11`).
 * - `keepExistingGemsFrost`: `false` (default, apply template's saved lunagems & lunafrost) or
 *    `true` (preserve target build's compatible gems/frosts instead of overwriting with template's).
 * - `applyTemper`: `true` (default) to apply saved tempers from the template.
 */
export function applyGearTemplateToSlots(slots, template, options = {}, catalog = _catalog) {
    const cleanTpl = normalizeGearTemplate(template);
    if (!cleanTpl || !catalog?.itemsBySlot) {
        return { slots: cloneSlots(slots), template: null, appliedCount: 0, missingSlots: [] };
    }

    let next = cloneSlots(slots);
    const gradeMode = options.gradeMode ?? "template";
    const explicitGradeId =
        gradeMode !== "template" && gradeMode !== "keep" && gradeMode !== "" && Number.isFinite(Number(gradeMode))
            ? Number(gradeMode)
            : null;
    const keepExistingGemsFrost = Boolean(options.keepExistingGemsFrost);
    const applyTemper = options.applyTemper !== false;

    let appliedCount = 0;
    const missingSlots = [];

    const orderedEntries = Object.entries(cleanTpl.slots).sort((a, b) => Number(a[0]) - Number(b[0]));
    for (const [sidStr, entry] of orderedEntries) {
        const sid = Number(sidStr);
        if (entry.empty) {
            next = unequipGearSlot(next, sid);
            appliedCount++;
            continue;
        }

        const slotList = catalog.itemsBySlot.get(sid) || [];
        let catItem = null;
        if (entry.itemId && catalog.itemById?.has(entry.itemId)) {
            const candidate = catalog.itemById.get(entry.itemId);
            if (!Array.isArray(candidate.slotid) || candidate.slotid.includes(sid)) {
                catItem = candidate;
            }
        }
        if (!catItem && entry.itemName) {
            const lower = entry.itemName.toLowerCase();
            catItem = slotList.find((it) => String(it.name || "").toLowerCase() === lower) || null;
        }
        if (!catItem) {
            missingSlots.push(sid);
            continue;
        }

        const equipOpts = {
            keepGemsFrost: keepExistingGemsFrost,
            ...(applyTemper && entry.ptemper != null ? { ptemper: entry.ptemper } : {}),
            ...(applyTemper && entry.mtemper != null ? { mtemper: entry.mtemper } : {}),
        };
        if (explicitGradeId != null) {
            equipOpts.gradeId = explicitGradeId;
        } else if (gradeMode === "template" && entry.gradeId != null) {
            equipOpts.gradeId = entry.gradeId;
        }
        // When gradeMode === "keep", omit gradeId so equipCatalogItemInSlot preserves target slot's existing grade

        next = equipCatalogItemInSlot(next, sid, catItem, equipOpts, catalog);

        if (!keepExistingGemsFrost) {
            if (entry.lunafrostId) {
                next = setSlotItemLunafrost(next, sid, entry.lunafrostId, catalog);
            }
            if (Array.isArray(entry.lunagemIds) && entry.lunagemIds.length > 0) {
                const slotObj = next.find((s) => Number(s.id) === sid);
                const maxS = slotObj?.item ? getMaxSocketsForSlotAndGrade(sid, slotObj.item.grade) : 0;
                const validGemIds = slotObj?.item
                    ? new Set(filterLunagemsForSlot(sid, slotObj.item, catalog).map((g) => Number(g.id)))
                    : new Set();
                for (let idx = 0; idx < Math.min(entry.lunagemIds.length, maxS); idx++) {
                    const gid = Number(entry.lunagemIds[idx]) || 0;
                    if (gid > 0 && validGemIds.has(gid)) {
                        next = setSlotItemLunagem(next, sid, idx, gid, catalog);
                    }
                }
            }
        }

        if (entry.synthPct != null) {
            next = setSlotItemSynthPercent(next, sid, entry.synthPct);
        }
        if (Array.isArray(entry.synthAttrIds) && entry.synthAttrIds.length > 0) {
            for (let i = 0; i < entry.synthAttrIds.length; i++) {
                const aid = entry.synthAttrIds[i];
                if (aid != null) {
                    next = setSlotItemSynthStat(next, sid, i, aid, catalog);
                }
            }
        }

        appliedCount++;
    }

    return { slots: next, template: cleanTpl, appliedCount, missingSlots };
}

export function unequipGearSlot(slots, slotId) {
    const next = cloneSlots(slots);
    const slot = next.find((s) => Number(s.id) === Number(slotId));
    if (slot) slot.item = null;
    return next;
}

export function setSlotItemGrade(slots, slotId, gradeId, catalog = _catalog) {
    const next = cloneSlots(slots);
    const sid = Number(slotId);
    const slot = next.find((s) => Number(s.id) === sid);
    if (!slot?.item) return next;
    const gradeObj = catalog?.gradeById?.get(Number(gradeId));
    if (!gradeObj) return next;
    slot.item.grade = { ...gradeObj };
    normalizeItemSockets(sid, slot.item);
    normalizeItemSynthSlots(slot.item, catalog, false);
    return next;
}

export function setSlotItemTemper(slots, slotId, ptemper, mtemper) {
    const next = cloneSlots(slots);
    const slot = next.find((s) => Number(s.id) === Number(slotId));
    if (!slot?.item) return next;
    if (ptemper != null) slot.item.ptemper = Math.max(100, Math.min(115, Math.round(Number(ptemper) || 100)));
    if (mtemper != null) slot.item.mtemper = Math.max(100, Math.min(115, Math.round(Number(mtemper) || 100)));
    return next;
}

export function setSlotItemLunafrost(slots, slotId, frostId, catalog = _catalog) {
    const next = cloneSlots(slots);
    const slot = next.find((s) => Number(s.id) === Number(slotId));
    if (!slot?.item) return next;
    if (!frostId) {
        slot.item.lunafrost = null;
        return next;
    }
    const frostMeta = catalog?.frostById?.get(Number(frostId));
    slot.item.lunafrost = frostMeta ? hydrateLunafrost(frostMeta, slot.item.equipment?.level, catalog) : null;
    return next;
}

/**
 * Apply a Lunafrost (e.g. an Erenor Set Lunafrost) to all equipped slots eligible for it.
 * Returns { slots, appliedCount }.
 */
export function applyLunafrostToEligibleSlots(slots, frostId, catalog = _catalog) {
    const next = cloneSlots(slots);
    const frostMeta = catalog?.frostById?.get(Number(frostId));
    if (!frostMeta) return { slots: next, appliedCount: 0 };
    let appliedCount = 0;
    for (const s of next) {
        if (!s?.item?.equipment) continue;
        const valid = filterLunafrostsForSlot(s.id, s.item, catalog);
        if (!valid.some((f) => Number(f.id) === Number(frostMeta.id))) continue;
        s.item.lunafrost = hydrateLunafrost(frostMeta, s.item.equipment.level, catalog);
        appliedCount++;
    }
    return { slots: next, appliedCount };
}

export function setSlotItemLunagem(slots, slotId, socketIdx, gemId, catalog = _catalog) {
    const next = cloneSlots(slots);
    const sid = Number(slotId);
    const slot = next.find((s) => Number(s.id) === sid);
    if (!slot?.item) return next;
    normalizeItemSockets(sid, slot.item);
    if (socketIdx < 0 || socketIdx >= slot.item.lunagem.length) return next;
    if (!gemId) {
        slot.item.lunagem[socketIdx] = { id: 0, name: "", level: 0, gradeid: 0, effect_text: "", effects: [] };
        return next;
    }
    const gemMeta = catalog?.gemById?.get(Number(gemId));
    if (gemMeta) {
        slot.item.lunagem[socketIdx] = hydrateLunagem(gemMeta);
    }
    return next;
}

export function fillAllSlotLunagems(slots, slotId, gemId, catalog = _catalog) {
    const next = cloneSlots(slots);
    const sid = Number(slotId);
    const slot = next.find((s) => Number(s.id) === sid);
    if (!slot?.item) return next;
    normalizeItemSockets(sid, slot.item);
    const gemMeta = gemId ? catalog?.gemById?.get(Number(gemId)) : null;
    slot.item.lunagem = slot.item.lunagem.map(() =>
        gemMeta
            ? hydrateLunagem(gemMeta)
            : { id: 0, name: "", level: 0, gradeid: 0, effect_text: "", effects: [] }
    );
    return next;
}

export function setSlotItemSynthPercent(slots, slotId, pct) {
    const next = cloneSlots(slots);
    const slot = next.find((s) => Number(s.id) === Number(slotId));
    if (!slot?.item?.equipment) return next;
    slot.item.equipment.synth_percentage = Math.max(0, Math.min(100, Number(pct) || 0));
    return next;
}

export function setSlotItemSynthStat(slots, slotId, lineIdx, attrOrSpec, catalog = _catalog) {
    const next = cloneSlots(slots);
    const sid = Number(slotId);
    const slot = next.find((s) => Number(s.id) === sid);
    if (!slot?.item) return next;
    normalizeItemSynthSlots(slot.item, catalog, false);
    if (lineIdx < 0 || lineIdx >= slot.item.sythisis_stat.length) return next;
    if (attrOrSpec === "__keep__") return next;
    if (attrOrSpec == null || attrOrSpec === "") {
        slot.item.sythisis_stat[lineIdx] = null;
        return next;
    }
    const pool = getAvailableSynthPool(slot.item.equipment, slot.item.grade?.id, catalog);

    let pickedIdx = -1;
    if (typeof attrOrSpec === "string" && attrOrSpec.startsWith("idx:")) {
        const idx = parseInt(attrOrSpec.slice(4), 10);
        if (Number.isInteger(idx) && idx >= 0 && idx < pool.length) pickedIdx = idx;
    } else if (attrOrSpec && typeof attrOrSpec === "object" && Number.isInteger(attrOrSpec.poolIdx)) {
        const idx = attrOrSpec.poolIdx;
        if (idx >= 0 && idx < pool.length) pickedIdx = idx;
    } else {
        const targetAid = Number(attrOrSpec);
        pickedIdx = pool.findIndex((p) => Number(p.unit_attribute_id) === targetAid);
    }

    slot.item.sythisis_stat[lineIdx] = pickedIdx >= 0 ? tagSynthPoolEntry(pool, pickedIdx) : null;
    return next;
}

export const STAT_MIGRATION_BASE = 158;
export const STAT_MIGRATION_MIN_DELTA = -158; // Base stat floor = 0
export const STAT_MIGRATION_MAX_DELTA = 300; // AA Classic 3.5 max single-stat migration (+300 -> 458 base)

const MIG_STAT_TO_PLAYER_KEY = Object.freeze({
    str: "str",
    agi: "dex",
    sta: "sta",
    int: "int",
    spi: "spi",
});

export function getPlayerStatMigration(player) {
    const p = createDefaultRawPlayer(player);
    const base = {
        str: Math.round(Number(p.str) || 0),
        agi: Math.round(Number(p.dex) || 0),
        sta: Math.round(Number(p.sta) || 0),
        int: Math.round(Number(p.int) || 0),
        spi: Math.round(Number(p.spi) || 0),
    };
    const deltas = {
        str: base.str - STAT_MIGRATION_BASE,
        agi: base.agi - STAT_MIGRATION_BASE,
        sta: base.sta - STAT_MIGRATION_BASE,
        int: base.int - STAT_MIGRATION_BASE,
        spi: base.spi - STAT_MIGRATION_BASE,
    };
    let gained = 0;
    let lost = 0;
    for (const v of Object.values(deltas)) {
        if (v > 0) gained += v;
        else if (v < 0) lost += -v;
    }
    return {
        base,
        deltas,
        gained,
        lost,
        net: gained - lost,
        totalBase: base.str + base.agi + base.sta + base.int + base.spi,
    };
}

export function setPlayerStatMigration(player, nextDeltas = {}) {
    const next = createDefaultRawPlayer(player);
    for (const [statKey, playerKey] of Object.entries(MIG_STAT_TO_PLAYER_KEY)) {
        if (nextDeltas[statKey] === undefined || nextDeltas[statKey] === null) continue;
        const raw = Number(nextDeltas[statKey]);
        if (!Number.isFinite(raw)) continue;
        const clampedDelta = Math.max(
            STAT_MIGRATION_MIN_DELTA,
            Math.min(STAT_MIGRATION_MAX_DELTA, Math.round(raw))
        );
        next[playerKey] = STAT_MIGRATION_BASE + clampedDelta;
    }
    return next;
}

export function applyStatMigrationTransfer(player, fromStat, toStat, amount) {
    const fromKey = MIG_STAT_TO_PLAYER_KEY[fromStat];
    const toKey = MIG_STAT_TO_PLAYER_KEY[toStat];
    const amt = Math.max(0, Math.round(Number(amount) || 0));
    const next = createDefaultRawPlayer(player);
    if (!fromKey || !toKey || fromKey === toKey || amt === 0) return next;
    const curFrom = Math.round(Number(next[fromKey]) || 0);
    const curTo = Math.round(Number(next[toKey]) || 0);
    const maxTake = Math.max(0, curFrom - (STAT_MIGRATION_BASE + STAT_MIGRATION_MIN_DELTA));
    const maxGive = Math.max(0, STAT_MIGRATION_BASE + STAT_MIGRATION_MAX_DELTA - curTo);
    const actual = Math.min(amt, maxTake, maxGive);
    next[fromKey] = curFrom - actual;
    next[toKey] = curTo + actual;
    return next;
}

export function resetPlayerStatMigration(player) {
    return setPlayerStatMigration(player, { str: 0, agi: 0, sta: 0, int: 0, spi: 0 });
}

export function setGearPlayerTitle(player, titleId, catalog = _catalog) {
    const next = createDefaultRawPlayer(player);
    if (!titleId) {
        next.title = null;
        return next;
    }
    const tMeta = catalog?.titleById?.get(Number(titleId));
    next.title = tMeta ? { ...tMeta, data: (tMeta.data || []).map((d) => ({ ...d })) } : null;
    return next;
}

const SYNTH_LABEL_TO_ATTR_ID = [
    [/backstab\s+melee\s+damage/i, 121],
    [/backstab\s+ranged\s+damage/i, 122],
    [/backstab\s+magic\s+damage/i, 123],
    [/melee\s+critical\s+(?:damage|bonus)/i, 17],
    [/ranged\s+critical\s+(?:damage|bonus)/i, 26],
    [/magic\s+critical\s+(?:damage|bonus)/i, 31],
    [/critical\s+heal\s+(?:bonus|damage)/i, 176],
    [/melee\s+critical\s+rate/i, 77],
    [/ranged\s+critical\s+rate/i, 82],
    [/magic\s+critical\s+rate/i, 86],
    [/critical\s+heal\s+rate|heal\s+critical\s+rate/i, 185],
    [/melee\s+skill\s+damage/i, 51],
    [/ranged\s+skill\s+damage/i, 52],
    [/magic\s+skill\s+damage/i, 53],
    [/melee\s+attack/i, 33],
    [/ranged\s+attack/i, 34],
    [/magic\s+attack/i, 35],
    [/healing\s+power/i, 175],
    [/received\s+healing/i, 56],
    [/received\s+melee\s+damage/i, 143],
    [/received\s+ranged\s+damage/i, 145],
    [/received\s+magic\s+damage/i, 147],
    [/received\s+damage/i, 58],
    [/magic\s+defense\s+penetration/i, 184],
    [/defense\s+penetration/i, 57],
    [/physical\s+defense/i, 8],
    [/magic\s+defense/i, 64],
    [/max\s+health/i, 6],
    [/max\s+mana/i, 7],
    [/resilience/i, 183],
    [/toughness/i, 182],
    [/focus/i, 181],
    [/evasion/i, 180],
    [/parry/i, 81],
    [/block/i, 179],
    [/cast\s+time/i, 71],
    [/attack\s+speed/i, 54],
    [/move\s+speed/i, 10],
    [/^strength\b/i, 0],
    [/^agility\b/i, 1],
    [/^stamina\b/i, 2],
    [/^intelligence\b/i, 3],
    [/^spirit\b/i, 4],
];

function parseSynthStatLine(rawLine) {
    const s = String(rawLine || "").trim();
    if (!s) return null;
    // Handle multi-line DaruGear display_text e.g. "Stamina \n108.0 ~ 123.0 +110" or single-line "Stamina +104"
    const nlIdx = s.indexOf("\n");
    const labelPart = nlIdx >= 0 ? s.slice(0, nlIdx).trim() : s;
    const valMatch = s.match(/([+-]?[+-]?\d+(?:\.\d+)?)\s*%?\s*$/);
    if (!valMatch) return null;
    const cleanedNum = valMatch[1].replace(/^\+-/, "-").replace(/^\+\+/, "+");
    const value = Number(cleanedNum);
    if (!Number.isFinite(value)) return null;
    const label = (nlIdx >= 0 ? labelPart : s.slice(0, valMatch.index))
        .replace(/[+%]+$/, "")
        .replace(/\s+/g, " ")
        .trim();
    return { label, value };
}

function reconstructSynthStatsForItem(item, rawSynthLines, catalog) {
    if (!item?.equipment || !Array.isArray(rawSynthLines) || rawSynthLines.length === 0) return;
    const pool = getAvailableSynthPool(item.equipment, item.grade?.id, catalog);
    const usedAttrIds = new Set();
    const reconstructed = [];

    for (const rawLine of rawSynthLines) {
        const parsed = parseSynthStatLine(rawLine);
        if (!parsed) continue;
        const lblLower = parsed.label.toLowerCase();

        // 1. Try matching against the item's own synthesis pool
        let poolMatch = pool.find((p) => {
            if (usedAttrIds.has(Number(p.unit_attribute_id))) return false;
            const pLbl = String(p.display_text || "")
                .split("\n")[0]
                .replace(/[+%]+$/, "")
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();
            return pLbl === lblLower || (lblLower && pLbl.includes(lblLower)) || (pLbl && lblLower.includes(pLbl));
        });

        // 2. Fallback to canonical label -> unit_attribute_id mapping
        let attrId = poolMatch ? Number(poolMatch.unit_attribute_id) : null;
        if (attrId == null) {
            for (const [re, aid] of SYNTH_LABEL_TO_ATTR_ID) {
                if (re.test(parsed.label)) {
                    attrId = aid;
                    break;
                }
            }
            if (attrId != null && !poolMatch) {
                poolMatch = pool.find((p) => Number(p.unit_attribute_id) === attrId && !usedAttrIds.has(attrId));
            }
        }
        if (attrId == null) continue;
        usedAttrIds.add(attrId);

        const div = SCALING_MAP[attrId] || 1;
        // Received damage / cast time reductions are stored negative in DaruGear
        let signedVal = parsed.value;
        if ((attrId === 58 || attrId === 143 || attrId === 145 || attrId === 147 || attrId === 71) && signedVal > 0 && /decrease/i.test(parsed.label)) {
            signedVal = -signedVal;
        }
        const rawScaled = Math.round(signedVal * div * 100) / 100;

        // Pick the closest-range pool entry when multiple tiers share the same attrId (e.g. Cloak High vs Low roll)
        const sameAttrEntries = pool
            .map((p, idx) => ({ p, idx }))
            .filter(({ p }) => Number(p.unit_attribute_id) === attrId);
        if (sameAttrEntries.length > 1) {
            sameAttrEntries.sort((a, b) => {
                const da = Math.abs(Math.abs(Number(a.p.maxvalue)) - Math.abs(rawScaled));
                const db = Math.abs(Math.abs(Number(b.p.maxvalue)) - Math.abs(rawScaled));
                return da - db;
            });
            poolMatch = tagSynthPoolEntry(pool, sameAttrEntries[0].idx);
        } else if (sameAttrEntries.length === 1) {
            poolMatch = tagSynthPoolEntry(pool, sameAttrEntries[0].idx);
        }

        if (poolMatch) {
            const pMin = Number(poolMatch.minvalue);
            const pMax = Number(poolMatch.maxvalue);
            const lo = Math.min(pMin, pMax);
            const hi = Math.max(pMin, pMax);
            // If exact value matches the pool's 100% roll (within rounding tolerance), keep the pool entry cleanly
            if (Math.abs(rawScaled - pMax) <= Math.max(1, Math.abs(div) * 0.15)) {
                reconstructed.push({ ...poolMatch });
            } else if (rawScaled >= lo - 0.5 && rawScaled <= hi + 0.5) {
                reconstructed.push({ ...poolMatch, minvalue: rawScaled, maxvalue: rawScaled });
            } else {
                // Exact stat value outside pool range (e.g. different cloak grade/tier): preserve exact value!
                reconstructed.push({ ...poolMatch, minvalue: rawScaled, maxvalue: rawScaled });
            }
        } else {
            reconstructed.push({
                cat_id: item.equipment.synth_cat_id || 0,
                grade: item.grade?.id || 0,
                unit_attribute_id: attrId,
                minvalue: rawScaled,
                maxvalue: rawScaled,
                display_text: `${parsed.label}\n${signedVal}`,
            });
        }
    }

    if (reconstructed.length > 0) {
        const expectedLen = Math.max(reconstructed.length, getSynthSlotCountForGrade(item.equipment, item.grade?.id));
        const padded = reconstructed.slice(0, expectedLen);
        while (padded.length < expectedLen) padded.push(null);
        item.sythisis_stat = padded;
        item.equipment.synth_percentage = 100;
    }
}

/**
 * Ensure a character has a 20-slot `rawDaruGear` state ready for editing.
 * If it already has `rawDaruGear.slots`, normalizes sockets/synth slots.
 * Otherwise reconstructs slots from `character.equipment` by matching item names in the catalog.
 */
export function ensureCharacterRawDaruGear(character, catalog = _catalog) {
    if (character?.rawDaruGear?.slots && Array.isArray(character.rawDaruGear.slots)) {
        const slots = createEmptyGearSlots(catalog);
        const byId = new Map(character.rawDaruGear.slots.map((s) => [Number(s.id), s]));
        for (const s of slots) {
            const src = byId.get(s.id);
            if (src?.item?.equipment) {
                s.item = cloneSlots([src])[0].item;
                // Ensure grade has full socket counts & equipment has synth_slot_count if missing
                const gObj = catalog?.gradeById?.get(Number(s.item.grade?.id));
                if (gObj) s.item.grade = { ...gObj };
                if (s.item.equipment.id && catalog?.itemById?.has(s.item.equipment.id)) {
                    const catIt = catalog.itemById.get(s.item.equipment.id);
                    if (!s.item.equipment.synth_slot_count?.length && catIt.synth_slot_count?.length) {
                        s.item.equipment.synth_slot_count = catIt.synth_slot_count;
                    }
                    if (!s.item.equipment.synth_cat_id && catIt.synth_cat_id) {
                        s.item.equipment.synth_cat_id = catIt.synth_cat_id;
                    }
                }
                const overrideSetId = ENLIGHTENED_ACC_SET_OVERRIDES[Number(s.item.equipment.id)];
                if (overrideSetId && ENLIGHTENED_ACC_SET_DEFS[overrideSetId]) {
                    s.item.equipment.seteffects = ENLIGHTENED_ACC_SET_DEFS[overrideSetId].map((se) => ({ ...se }));
                }
                normalizeItemSockets(s.id, s.item);
            }
        }
        const player = createDefaultRawPlayer(character.rawDaruGear.player);
        return { slots, player, reconstructed: false };
    }

    // Reconstruct from character.equipment summary (e.g. older saved builds)
    let slots = createEmptyGearSlots(catalog);
    const eqList = Array.isArray(character?.equipment) ? character.equipment : [];
    for (const eq of eqList) {
        const sid = Number(eq.slotId);
        const slotList = catalog?.itemsBySlot?.get(sid) || [];
        const targetName = String(eq.name || "").trim().toLowerCase();
        const byExactId = eq.itemId && catalog?.itemById?.get(Number(eq.itemId));
        const matched =
            byExactId ||
            slotList.find((it) => it.name.toLowerCase() === targetName) ||
            slotList.find((it) => targetName && it.name.toLowerCase().includes(targetName));
        if (!matched) continue;
        slots = equipCatalogItemInSlot(
            slots,
            sid,
            matched,
            {
                gradeId: eq.gradeId,
                ptemper: eq.ptemper || 100,
                mtemper: eq.mtemper || 100,
            },
            catalog
        );
        const slotObj = slots.find((s) => s.id === sid);
        if (!slotObj?.item) continue;
        if (eq.lunafrost?.name) {
            const lfLower = eq.lunafrost.name.toLowerCase();
            const lf = filterLunafrostsForSlot(sid, slotObj.item, catalog).find(
                (f) => f.name.toLowerCase() === lfLower
            );
            if (lf) slots = setSlotItemLunafrost(slots, sid, lf.id, catalog);
        }
        if (Array.isArray(eq.lunagems) && eq.lunagems.length > 0) {
            const validGems = filterLunagemsForSlot(sid, slotObj.item, catalog);
            eq.lunagems.forEach((g, idx) => {
                const gn = String(g.name || "").trim().toLowerCase();
                const gt = String(g.text || "").trim().toLowerCase();
                const found =
                    validGems.find((vg) => vg.name.toLowerCase() === gn && (!gt || vg.effect_text.toLowerCase().includes(gt.slice(0, 12)))) ||
                    validGems.find((vg) => vg.name.toLowerCase() === gn);
                if (found) slots = setSlotItemLunagem(slots, sid, idx, found.id, catalog);
            });
        }
        if (Array.isArray(eq.synthStats) && eq.synthStats.length > 0) {
            const freshSlot = slots.find((s) => s.id === sid);
            if (freshSlot?.item) {
                reconstructSynthStatsForItem(freshSlot.item, eq.synthStats, catalog);
            }
        }
    }

    let player = createDefaultRawPlayer(null);
    const titleName = character?.metadata?.title || character?.title;
    if (titleName && catalog?.titles) {
        const tm = catalog.titles.find((t) => t.name.toLowerCase() === String(titleName).trim().toLowerCase());
        if (tm) player = setGearPlayerTitle(player, tm.id, catalog);
    }

    // Use persisted exact Stat Migration (baseAttributes) when available; otherwise infer from total - gearOnly
    const persistedBase = character?.baseAttributes;
    if (
        persistedBase &&
        typeof persistedBase === "object" &&
        Number.isFinite(Number(persistedBase.str))
    ) {
        const clampBase = (v) => {
            const n = Number(v);
            return Number.isFinite(n) ? Math.max(0, Math.min(500, Math.round(n))) : 158;
        };
        player.str = clampBase(persistedBase.str);
        player.dex = clampBase(persistedBase.agi ?? persistedBase.dex);
        player.sta = clampBase(persistedBase.sta);
        player.int = clampBase(persistedBase.int);
        player.spi = clampBase(persistedBase.spi);
    } else if (character?.attributes && eqList.length > 0) {
        const cleanForProbe = cloneSlots(slots);
        for (const s of cleanForProbe) {
            if (s.item && Array.isArray(s.item.sythisis_stat)) {
                s.item.sythisis_stat = s.item.sythisis_stat.filter(Boolean);
            }
        }
        const probePlayer = {
            ...player,
            str: 0,
            dex: 0,
            sta: 0,
            spi: 0,
            int: 0,
            equipment_buff: recomputeGearBuffs(cleanForProbe, player, catalog),
            buff: [],
            playerclass: null,
        };
        const gearOnly = calculateDaruGearStats(probePlayer, cleanForProbe);
        const bakedPassives = Array.isArray(character?.skillBuild?.bakedPassives)
            ? character.skillBuild.bakedPassives.map((p) => String(p).toLowerCase())
            : [];
        const spiDiv = bakedPassives.includes("spirit growth") ? 1.09 : 1;
        const inferBase = (charVal, gearVal, mult = 1) => {
            const c = Number(charVal);
            if (!Number.isFinite(c) || c <= 0) return 158;
            const unscaled = mult !== 1 ? c / mult : c;
            const diff = Math.round(unscaled - (Number(gearVal) || 0));
            return Math.max(0, Math.min(500, diff));
        };
        player.str = inferBase(character.attributes.str, gearOnly.str);
        player.dex = inferBase(character.attributes.agi, gearOnly.dex);
        player.sta = inferBase(character.attributes.sta, gearOnly.sta);
        player.int = inferBase(character.attributes.int, gearOnly.int);
        player.spi = inferBase(character.attributes.spi, gearOnly.spi, spiDiv);
    }

    return { slots, player, reconstructed: true };
}

/**
 * Recalculate a character's complete stats from its 20 Gear Builder slots + Title.
 * Computes pure gear/title/set/grade/weapon-archetype stats (without baking skill passives),
 * and sets `skillBuild.bakedPassives = []` so Skill Builder passives apply live with zero double-counting!
 */
export function recalculateCharacterFromGearBuilder(character, slots, player, catalog = _catalog) {
    const normalizedSlots = cloneSlots(slots);
    for (const s of normalizedSlots) {
        if (s.item) {
            const gObj = catalog?.gradeById?.get(Number(s.item.grade?.id));
            if (gObj) s.item.grade = { ...gObj };
        }
    }
    const cleanSlots = cloneSlots(normalizedSlots);
    for (const s of cleanSlots) {
        if (s.item && Array.isArray(s.item.sythisis_stat)) {
            s.item.sythisis_stat = s.item.sythisis_stat.filter(Boolean);
        }
    }

    const gearBuffs = recomputeGearBuffs(cleanSlots, player, catalog);
    const calcPlayer = {
        ...createDefaultRawPlayer(player),
        equipment_buff: gearBuffs,
        buff: [],
        playerclass: null,
    };

    const shareCode = character?.shareCode || character?.metadata?.shareCode || null;
    const rawExport = buildDaruGearExportFromApiPayload({ slots: cleanSlots, player: calcPlayer }, shareCode);

    // Preserve user's build name & Skill Build (clearing bakedPassives since gear calc ran with playerclass: null!)
    const prevSb = normalizeSkillBuild(character?.skillBuild || null, character);
    const nextSkillBuild = {
        ...prevSb,
        bakedPassives: [],
    };

    const preservedName = character?.name || rawExport.name;
    const nextMeta = {
        ...(character?.metadata || {}),
        ...rawExport.metadata,
        className: nextSkillBuild.className || character?.metadata?.className || rawExport.className,
        passives: [...(nextSkillBuild.passives || [])],
    };

    const updatedChar = {
        ...character,
        name: preservedName,
        className: nextMeta.className,
        gearScore: rawExport.gearScore,
        maxHealth: rawExport.maxHealth,
        maxMana: rawExport.maxMana,
        pveDamageBonusPct: rawExport.pveDamageBonusPct || 0,
        pveMeleeDamageBonusPct: rawExport.pveMeleeDamageBonusPct || 0,
        pveRangedDamageBonusPct: rawExport.pveRangedDamageBonusPct || 0,
        pveMagicDamageBonusPct: rawExport.pveMagicDamageBonusPct || 0,
        pveReceivedDrPct: rawExport.pveReceivedDrPct || 0,
        baseAttributes: { ...rawExport.baseAttributes },
        attributes: { ...rawExport.attributes },
        offense: { ...rawExport.offense },
        defense: { ...rawExport.defense },
        equipment: normalizeEquipmentList(rawExport.equipment),
        metadata: nextMeta,
        skillBuild: nextSkillBuild,
        rawDaruGear: {
            slots: normalizedSlots,
            player: createDefaultRawPlayer(player),
        },
    };
    delete updatedChar._skillBuildApplied;

    return {
        character: updatedChar,
        gearBuffs,
    };
}

/**
 * Create a brand-new, completely blank Lv 55 character build with all 20 gear slots empty,
 * default un-migrated base attributes (158 all), 0 Gear Score, no DaruGear link, and exact
 * naked stats computed from the DaruGear engine.
 */
export function createBlankGearBuild(name = "New Build", options = {}, catalog = _catalog) {
    const cleanName = String(name || "").trim() || "New Build";
    const emptySlots = createEmptyGearSlots(catalog);
    const blankPlayer = createDefaultRawPlayer(options.player || null);
    const seed = {
        schemaVersion: 1,
        name: cleanName,
        level: 55,
        source: "gearbuilder",
        shareUrl: null,
        darugearUrl: null,
        shareCode: null,
        className: null,
        gearScore: 0,
        equipment: [],
        skillBuild: null,
        metadata: {
            source: "gearbuilder",
            darugearUrl: null,
            shareCode: null,
            className: null,
            gearScore: 0,
            ...(options.category ? { category: options.category } : {}),
        },
    };
    const { character } = recalculateCharacterFromGearBuilder(seed, emptySlots, blankPlayer, catalog);
    character.source = "gearbuilder";
    character.shareUrl = null;
    character.darugearUrl = null;
    character.shareCode = null;
    character.equipment = [];
    character.metadata = {
        ...(character.metadata || {}),
        source: "gearbuilder",
        darugearUrl: null,
        shareCode: null,
        gearScore: 0,
    };
    delete character.metadata.darugearBuffs;
    delete character.savedId;
    return character;
}

const GEAR_BUFF_ATTR_META = Object.freeze({
    0: ["STR", 1, ""],
    1: ["AGI", 1, ""],
    2: ["STA", 1, ""],
    3: ["INT", 1, ""],
    4: ["SPI", 1, ""],
    6: ["Max HP", 1, ""],
    7: ["Max Mana", 1, ""],
    8: ["Phys Def", 1, ""],
    10: ["Move Spd", 10, "%"],
    11: ["HP Regen", 1, ""],
    12: ["Mana Regen", 1, ""],
    17: ["Melee Crit Dmg", 10, "%"],
    26: ["Ranged Crit Dmg", 10, "%"],
    31: ["Magic Crit Dmg", 10, "%"],
    33: ["Melee Atk", 1000, ""],
    34: ["Ranged Atk", 1000, ""],
    35: ["Magic Atk", 1000, ""],
    51: ["Melee Skill Dmg", 10, "%"],
    52: ["Ranged Skill Dmg", 10, "%"],
    53: ["Magic Skill Dmg", 10, "%"],
    54: ["Atk Spd", 1, ""],
    56: ["Recv Healing", 10, "%"],
    57: ["Def Pen", 1, ""],
    58: ["Recv Dmg", 10, "%"],
    64: ["Magic Def", 1, ""],
    71: ["Cast Time", 10, "%"],
    77: ["Melee Crit Rate", 10, "%"],
    78: ["Melee Acc", 10, "%"],
    81: ["Parry", 10, "%"],
    82: ["Ranged Crit Rate", 10, "%"],
    83: ["Ranged Acc", 10, "%"],
    86: ["Magic Crit Rate", 10, "%"],
    87: ["Magic Atk", 1, "%"],
    88: ["Magic Acc", 10, "%"],
    89: ["Cast Delay Tol.", 1.5, "%"],
    120: ["Healing", 10, "%"],
    142: ["Fixed DR", 1, ""],
    143: ["Recv Melee Dmg", 10, "%"],
    145: ["Recv Ranged Dmg", 10, "%"],
    147: ["Recv Magic Dmg", 10, "%"],
    175: ["Heal Power", 1000, ""],
    176: ["Heal Crit Dmg", 10, "%"],
    179: ["Block", 10, "%"],
    180: ["Evasion", 10, "%"],
    181: ["Focus", 1, ""],
    182: ["Toughness", 1, ""],
    183: ["Resilience", 1, ""],
    184: ["Magic Def Pen", 1, ""],
    185: ["Heal Crit Rate", 10, "%"],
    204: ["Shield Pen Rate", 10, "%"],
    206: ["Shield Def Pen", 10, "%"],
    218: ["Atk Spd", 1, ""],
    994: ["Phys Def", 1, "%"],
    995: ["Max HP", 1, "%"],
    996: ["Max Mana", 1, "%"],
    997: ["SPI", 1, "%"],
    998: ["Melee Atk", 1, "%"],
    999: ["Ranged Atk", 1, "%"],
});

function fmtBuffNum(val, unit) {
    const sign = val > 0 ? "+" : "";
    const abs = Math.abs(val);
    if (unit === "%") {
        const str = Math.abs(abs - Math.round(abs)) < 0.05 ? String(Math.round(val)) : val.toFixed(1);
        return `${val > 0 ? "+" : ""}${str}%`;
    }
    const rounded = Math.abs(abs - Math.round(abs)) < 0.05 ? Math.round(val) : Number(val.toFixed(1));
    return `${sign}${rounded.toLocaleString("en-US")}`;
}

/**
 * Format a single DaruGear `equipment_buff` object into a readable stat breakdown:
 * `{ id, name, icon, category, stats: [...], summary }`.
 */
export function describeGearBuffEffects(buff) {
    if (!buff) return null;
    const bid = Number(buff.id) || 0;
    const name = String(buff.name || "").trim();
    const rawData = Array.isArray(buff.data) ? buff.data : [];

    // Aggregate scaled values by attrId
    const byId = new Map();
    for (const eff of rawData) {
        const aid = Number(eff?.unit_attribute_id);
        const rawV = Number(eff?.value);
        if (!Number.isFinite(aid) || !Number.isFinite(rawV) || rawV === 0) continue;
        const meta = GEAR_BUFF_ATTR_META[aid];
        const div = meta ? meta[1] : SCALING_MAP[aid] || 1;
        const scaled = Number((rawV / div).toFixed(1));
        if (scaled === 0) continue;
        byId.set(aid, Number(((byId.get(aid) || 0) + scaled).toFixed(1)));
    }

    const stats = [];
    const consumed = new Set();

    // Collapse identical Melee/Ranged/Magic/Heal Crit Rate (77, 82, 86, 185)
    if (
        byId.has(77) &&
        byId.get(77) === byId.get(82) &&
        byId.get(77) === byId.get(86) &&
        (!byId.has(185) || byId.get(77) === byId.get(185))
    ) {
        stats.push(`Crit Rate ${fmtBuffNum(byId.get(77), "%")}`);
        [77, 82, 86, 185].forEach((k) => consumed.add(k));
    }

    // Collapse identical Melee/Ranged/Magic/Heal Crit Damage (17, 26, 31, 176)
    if (
        byId.has(17) &&
        byId.get(17) === byId.get(26) &&
        byId.get(17) === byId.get(31) &&
        (!byId.has(176) || byId.get(17) === byId.get(176))
    ) {
        stats.push(`Crit Dmg ${fmtBuffNum(byId.get(17), "%")}`);
        [17, 26, 31, 176].forEach((k) => consumed.add(k));
    }

    // Collapse identical Recv Melee/Ranged/Magic Dmg (143, 145, 147)
    if (byId.has(143) && byId.get(143) === byId.get(145) && byId.get(143) === byId.get(147)) {
        stats.push(`Recv Dmg ${fmtBuffNum(byId.get(143), "%")}`);
        [143, 145, 147].forEach((k) => consumed.add(k));
    }

    // Collapse identical Def Pen + Magic Def Pen (57, 184)
    if (byId.has(57) && byId.get(57) === byId.get(184)) {
        stats.push(`Def / MDef Pen ${fmtBuffNum(byId.get(57), "")}`);
        consumed.add(57);
        consumed.add(184);
    }

    // Collapse identical Parry + Block (81, 179)
    if (byId.has(81) && byId.get(81) === byId.get(179)) {
        stats.push(`Parry / Block ${fmtBuffNum(byId.get(81), "%")}`);
        consumed.add(81);
        consumed.add(179);
    }

    // Collapse identical Melee + Magic Skill Dmg + Healing (51, 53, 120) on 2H buff
    if (byId.has(51) && byId.get(51) === byId.get(53) && byId.get(51) === byId.get(120)) {
        stats.push(`Melee/Magic Dmg & Heal ${fmtBuffNum(byId.get(51), "%")}`);
        [51, 53, 120].forEach((k) => consumed.add(k));
    }

    for (const [aid, val] of byId.entries()) {
        if (consumed.has(aid)) continue;
        const meta = GEAR_BUFF_ATTR_META[aid];
        if (!meta) continue;
        stats.push(`${meta[0]} ${fmtBuffNum(val, meta[2])}`);
    }

    // Add well-known AA Classic 3.5 non-numeric set notes when helpful
    if (bid === 714) stats.push("Debuff Dur -30%");
    else if (bid === 716) stats.push("Range +3m");
    else if (bid === 715) stats.push("Range +2m");

    let category = "gear";
    if (bid >= 6418 && bid <= 6441) category = "grade";
    else if ([713, 714, 715, 716, 717, 740].includes(bid)) category = "set";
    else if ([8227, 4899, 16559].includes(bid)) category = "weapon";
    else if (buff.isTitle) category = "title";

    return {
        id: bid,
        name,
        icon: buff.icon || "",
        category,
        stats,
        summary: stats.join(" · "),
    };
}

/**
 * Compute active Gear, Armor Set, Armor Grade, Weapon Archetype, and Title buffs
 * with exact stat breakdowns for any character (works both with and without the Gear Catalog loaded).
 */
export function computeCharacterGearBuffSummaries(character, catalog = _catalog, activeModifiers = null) {
    if (!character) return [];

    // Fast path: when Gear Catalog is loaded, use exact recomputeGearBuffs + active item/Erenor/Charm sets
    if (catalog?.equipBuffById) {
        const { slots, player } = ensureCharacterRawDaruGear(character, catalog);
        const rawBuffs = recomputeGearBuffs(slots, player, catalog);
        const titleName = player?.title?.name || character?.metadata?.title || null;
        const baseSummaries = rawBuffs
            .map((b) =>
                describeGearBuffEffects({
                    ...b,
                    isTitle: Boolean(titleName && b.name === titleName),
                })
            )
            .filter(Boolean);
        const setSummaries = computeActiveSetEffectSummaries(slots, activeModifiers);
        return [...baseSummaries, ...setSummaries];
    }

    // Zero-latency fallback before Gear Catalog loads (e.g. Character Cards on first paint)
    const out = [];
    const eqList = normalizeEquipmentList(character.equipment);
    const armorPieces = eqList.filter((it) => it.slotId >= 1 && it.slotId <= 8 && it.slotId !== 6);
    const mh = eqList.find((it) => it.slotId === 15);
    const oh = eqList.find((it) => it.slotId === 16);

    // 1. Weapon Archetype buff
    const eqType = character.metadata?.equipmentType;
    if (oh && SHIELD_TYPES.has(oh.type) || eqType === "shield" || eqType === "magic_shield") {
        out.push({
            id: 16559,
            name: "Equip Shield",
            category: "weapon",
            stats: ["Max HP +350", "Max Mana +350", "Phys Def +200", "Magic Def +200"],
            summary: "Max HP +350 · Max Mana +350 · Phys Def +200 · Magic Def +200",
        });
    } else if ((mh && TWO_HAND_TYPES.has(mh.type)) || eqType === "two_hand") {
        out.push({
            id: 8227,
            name: "Equip Two-Handed Weapon",
            category: "weapon",
            stats: ["Melee/Magic Dmg & Heal +5%", "Cast Time -7%", "Shield Pen Rate +50%", "Shield Def Pen +50%"],
            summary: "Melee/Magic Dmg & Heal +5% · Cast Time -7% · Shield Pen Rate +50% · Shield Def Pen +50%",
        });
    } else if (oh || eqType === "dual_wield") {
        out.push({
            id: 4899,
            name: "Equip Dual Weapons",
            category: "weapon",
            stats: ["Atk Spd +177"],
            summary: "Atk Spd +177",
        });
    }

    // 2. Armor Set (4pc / 7pc) + Armor Grade Buff (Arcane..Eternal)
    const setInfo = computeArmorSetAndGradeBuff(armorPieces, 62, { includeBlock: true });
    if (setInfo.armorType && setInfo.count >= 4) {
        const isFull = setInfo.count >= 7;
        const setName = `${isFull ? "Complete " : ""}${setInfo.armorType} Set`;
        const setStats = [];
        if (setInfo.armorType === "Cloth") {
            setStats.push("Move Spd +3%", `Cast Delay Tol. +${isFull ? "66.7" : "33.3"}%`);
            if (isFull) setStats.push("Debuff Dur -30%");
        } else if (setInfo.armorType === "Leather") {
            setStats.push("Evasion +3%", isFull ? "Range +3m" : "Range +2m");
        } else if (setInfo.armorType === "Plate") {
            setStats.push(`Max HP +${isFull ? "5" : "3"}%`, "Phys Def +3%");
        }
        out.push({
            id: setInfo.armorType === "Plate" ? (isFull ? 740 : 717) : setInfo.armorType === "Leather" ? (isFull ? 716 : 715) : isFull ? 714 : 713,
            name: setName,
            category: "set",
            stats: setStats,
            summary: setStats.join(" · "),
        });

        if (setInfo.minGradeId != null && setInfo.minGradeId >= 4) {
            const gDef = ARCHEAGE_GRADES.find((g) => g.id === setInfo.minGradeId);
            const gName = `${gDef?.name || "Grade"} ${setInfo.armorType} Armor`;
            const gStats = [];
            if (setInfo.gradeBuffHp) gStats.push(`Max HP ${fmtBuffNum(setInfo.gradeBuffHp, "")}`);
            if (setInfo.gradeBuffMana) gStats.push(`Max Mana ${fmtBuffNum(setInfo.gradeBuffMana, "")}`);
            const ao = setInfo.delta?.addOffense || {};
            const ad = setInfo.delta?.addDefense || {};
            if (ao.meleeCritRatePct) gStats.push(`Crit Rate ${fmtBuffNum(ao.meleeCritRatePct, "%")}`);
            if (ao.defensePenetration) gStats.push(`Def / MDef Pen ${fmtBuffNum(ao.defensePenetration, "")}`);
            if (ao.meleeCritBonusPct) gStats.push(`Crit Dmg ${fmtBuffNum(ao.meleeCritBonusPct, "%")}`);
            if (ao.attackSpeed) gStats.push(`Atk Spd ${fmtBuffNum(ao.attackSpeed, "")}`);
            if (ad.parryPct) gStats.push(`Parry / Block ${fmtBuffNum(ad.parryPct, "%")}`);
            if (ad.receivedMeleeDrPct) gStats.push(`Recv Dmg ${fmtBuffNum(-ad.receivedMeleeDrPct, "%")}`);
            out.push({
                id: GRADE_BUFF_IDS[setInfo.armorType]?.[setInfo.minGradeId] || 0,
                name: gName,
                category: "grade",
                gradeColor: gDef?.color || null,
                stats: gStats,
                summary: gStats.join(" · "),
            });
        }
    }

    // 3. Title (if present in metadata)
    const titleName = character.metadata?.title || character.title;
    if (titleName) {
        out.push({
            id: 0,
            name: String(titleName),
            category: "title",
            stats: ["Title"],
            summary: "Title",
        });
    }

    return out;
}
