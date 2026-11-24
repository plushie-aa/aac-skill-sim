/**
 * ArcheAge Classic 1.3.6 Build Economy & Gold Cost Estimation Engine.
 * Pure math (zero DOM dependencies). Classifies equipped gear by tier & grade,
 * socketed lunagems by archetype/slot, and lunafrosts, with full per-item,
 * per-gem, and per-frost gold override support.
 */

import { simulateSkillDamage } from "./damage.js";
import { computeEffectiveStats } from "./effective.js";
import { simulateSkillHeal } from "./healing.js";
import { applyModifiers, applyOverrides } from "./stats.js";

export const ECONOMY_GRADES = Object.freeze([
    { id: "Celestial", label: "Celestial" },
    { id: "Divine", label: "Divine" },
    { id: "Epic", label: "Epic" },
    { id: "Legendary", label: "Legendary" },
    { id: "Mythic", label: "Mythic" },
]);

const LOWER_GRADE_MULT = Object.freeze({
    Crude: 0.05,
    Basic: 0.05,
    Grand: 0.1,
    Rare: 0.2,
    Arcane: 0.35,
    Heroic: 0.55,
    Unique: 0.75,
    Eternal: 1.5,
});

export const ECONOMY_TIERS = Object.freeze([
    {
        id: "obsidian_t7_weapon",
        label: "Obsidian T7 Weapon / Shield / Bow",
        hint: "Lv 64 Obsidian T7 (e.g. Razor Visage, Kingsbane, Deathfletcher, Widowshroud)",
        defaults: { Celestial: 35000, Divine: 85000, Epic: 220000, Legendary: 600000, Mythic: 1250000 },
    },
    {
        id: "obsidian_t6_weapon",
        label: "Obsidian T6 Weapon / Shield / Bow",
        hint: "Lv 59–62 Obsidian T6 weapons, shields, offhands & bows",
        defaults: { Celestial: 18000, Divine: 45000, Epic: 120000, Legendary: 320000, Mythic: 700000 },
    },
    {
        id: "ayanad_weapon",
        label: "Ayanad Weapon / Shield / Bow",
        hint: "Crafted Ayanad weapons, shields & bows",
        defaults: { Celestial: 22000, Divine: 55000, Epic: 150000, Legendary: 420000, Mythic: 900000 },
    },
    {
        id: "boss_weapon",
        label: "World Boss Weapon / Shield / Bow",
        hint: "Red Dragon, Kraken, Leviathan, Searing Oath & world boss drops",
        defaults: { Celestial: 65000, Divine: 120000, Epic: 260000, Legendary: 650000, Mythic: 1400000 },
    },
    {
        id: "obsidian_t7_armor",
        label: "Obsidian T7 Armor Piece",
        hint: "Lv 63–64 Obsidian T7 armor slots",
        defaults: { Celestial: 12000, Divine: 25000, Epic: 65000, Legendary: 180000, Mythic: 420000 },
    },
    {
        id: "obsidian_t6_armor",
        label: "Obsidian T6 Armor Piece",
        hint: "Lv 59–61 Obsidian T6 armor (e.g. Cold Flames, Purehearted Goddess, Starbound)",
        defaults: { Celestial: 6000, Divine: 12000, Epic: 32000, Legendary: 95000, Mythic: 220000 },
    },
    {
        id: "ayanad_armor",
        label: "Ayanad Armor Piece",
        hint: "Crafted Ayanad Plate / Leather / Cloth armor pieces",
        defaults: { Celestial: 8000, Divine: 18000, Epic: 48000, Legendary: 135000, Mythic: 320000 },
    },
    {
        id: "delphinad_gear",
        label: "Delphinad / Epherium / T4–T5 Gear",
        hint: "Mid-tier crafted or T4–T5 Obsidian armor & weapons",
        defaults: { Celestial: 4000, Divine: 9000, Epic: 22000, Legendary: 60000, Mythic: 140000 },
    },
    {
        id: "enlightened_accessory",
        label: "Enlightened Accessory",
        hint: "Enlightened Ayanad / Arcanist / Berserker / Shadow rings, earrings & necklaces",
        defaults: { Celestial: 12000, Divine: 28000, Epic: 65000, Legendary: 160000, Mythic: 350000 },
    },
    {
        id: "ayanad_accessory",
        label: "Ayanad / Crafted Accessory",
        hint: "Crafted Ayanad & Delphinad rings, earrings & necklaces",
        defaults: { Celestial: 6000, Divine: 15000, Epic: 38000, Legendary: 95000, Mythic: 210000 },
    },
    {
        id: "quest_accessory",
        label: "Quest / Bound Accessory",
        hint: "Ynys Guardian Ring, Dream Ring, Evernight & Daeier Necklaces, Carmila's Memory",
        defaults: { Celestial: 0, Divine: 0, Epic: 0, Legendary: 0, Mythic: 0 },
    },
    {
        id: "instrument",
        label: "Instrument (Flute / Lute)",
        hint: "Obsidian, Ayanad, and Aria/Anthem flutes & lutes",
        defaults: { Celestial: 5000, Divine: 12000, Epic: 35000, Legendary: 95000, Mythic: 220000 },
    },
    {
        id: "cloak",
        label: "Erenor / Delphinad Cloak",
        hint: "Erenor, Delphinad, and guild cloaks",
        defaults: { Celestial: 10000, Divine: 22000, Epic: 55000, Legendary: 120000, Mythic: 250000 },
    },
    {
        id: "costume_undergarment",
        label: "Costume / Undergarments",
        hint: "Synthesized Basic Costumes & Undergarments",
        defaults: { Celestial: 4000, Divine: 8000, Epic: 18000, Legendary: 35000, Mythic: 65000 },
    },
    {
        id: "other_gear",
        label: "Other / Dungeon / Starter Gear",
        hint: "Fallback for unmatched items",
        defaults: { Celestial: 2000, Divine: 4500, Epic: 10000, Legendary: 25000, Mythic: 60000 },
    },
]);

export const ECONOMY_GEM_GROUPS = Object.freeze([
    {
        id: "helmet_toughness",
        label: "Helmet Toughness Gem (Hero / Mastery)",
        hint: "e.g. Vivid Earth Lunascale: Mastery (+Toughness in Head slot)",
        defaultGold: 100000,
    },
    {
        id: "skill_specific",
        label: "Skill-Specific Ancient Lunagem (+4%)",
        hint: "e.g. Lucid Ancient Sorcery / Battlerage / Vitalism skill gems",
        defaultGold: 15000,
    },
    {
        id: "offense_t3",
        label: "T3 Lucid Offense Lunagem",
        hint: "Focus, Def Pen, Magic Pen, Crit Dmg, Attack, Cast Time, Atk Speed",
        defaultGold: 6500,
    },
    {
        id: "defense_t3",
        label: "T3 Lucid Defense Lunagem",
        hint: "Physical Defense, Magic Defense, Block, Parry, Evasion, Move Speed",
        defaultGold: 4500,
    },
    {
        id: "pvp_tough_resil",
        label: "Toughness / Resilience Lunagem (Body)",
        hint: "Honor / Radiant Earth Resilience & Toughness gems (Chest / Legs / Feet)",
        defaultGold: 2500,
    },
    {
        id: "refined_t2",
        label: "T2 Vivid / Lunascale / Refined Gem",
        hint: "Lower-tier Vivid Lunascales or Refined gems",
        defaultGold: 1800,
    },
    {
        id: "other_gem",
        label: "Other Lunagem",
        hint: "Fallback for any other socketed lunagem",
        defaultGold: 1500,
    },
]);

export const ECONOMY_FROST_GROUPS = Object.freeze([
    {
        id: "erenor_charm_frost",
        label: "Erenor / Enlightenment Charm / Boss Frost",
        hint: "Erenor Lunafrosts & Costume Enlightenment Charms",
        defaultGold: 12000,
    },
    {
        id: "flawless_distorted_frost",
        label: "Flawless / Distorted / Honor Frost",
        hint: "Flawless, Distorted, Honor & Guild Lunafrosts",
        defaultGold: 4000,
    },
    {
        id: "standard_frost",
        label: "Astral Lunadrop / Standard Frost",
        hint: "Stat Lunadrops (STR/AGI/STA/INT/SPI) & basic frosts",
        defaultGold: 1000,
    },
]);

export function createDefaultEconomyPriceBook() {
    const tierGrades = {};
    for (const t of ECONOMY_TIERS) {
        tierGrades[t.id] = { ...t.defaults };
    }
    const gemGroups = {};
    for (const g of ECONOMY_GEM_GROUPS) {
        gemGroups[g.id] = g.defaultGold;
    }
    const frostGroups = {};
    for (const f of ECONOMY_FROST_GROUPS) {
        frostGroups[f.id] = f.defaultGold;
    }
    return {
        schemaVersion: 1,
        useAhPrices: true,
        tierGrades,
        gemGroups,
        frostGroups,
        itemOverrides: {}, // "Item Name|GradeName" -> gold
        gemOverrides: {}, // "Gem Name|SlotName" or "Gem Name" -> gold
        frostOverrides: {}, // "Frost Name" -> gold
    };
}

export const DEFAULT_ECONOMY_PRICE_BOOK = Object.freeze(createDefaultEconomyPriceBook());

function cleanGoldVal(v, fallback = 0) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.round(n);
}

export function normalizeEconomyPriceBook(raw = {}) {
    const base = createDefaultEconomyPriceBook();
    if (!raw || typeof raw !== "object") return base;

    if (typeof raw.useAhPrices === "boolean") {
        base.useAhPrices = raw.useAhPrices;
    }

    if (raw.tierGrades && typeof raw.tierGrades === "object") {
        for (const t of ECONOMY_TIERS) {
            const srcRow =
                raw.tierGrades[t.id] ||
                (t.id === "cloak" ? raw.tierGrades.cloak_glider : null);
            if (!srcRow || typeof srcRow !== "object") continue;
            for (const g of ECONOMY_GRADES) {
                if (srcRow[g.id] !== undefined) {
                    base.tierGrades[t.id][g.id] = cleanGoldVal(srcRow[g.id], base.tierGrades[t.id][g.id]);
                }
            }
        }
    }

    if (raw.gemGroups && typeof raw.gemGroups === "object") {
        for (const g of ECONOMY_GEM_GROUPS) {
            if (raw.gemGroups[g.id] !== undefined) {
                base.gemGroups[g.id] = cleanGoldVal(raw.gemGroups[g.id], base.gemGroups[g.id]);
            }
        }
    }

    if (raw.frostGroups && typeof raw.frostGroups === "object") {
        for (const f of ECONOMY_FROST_GROUPS) {
            if (raw.frostGroups[f.id] !== undefined) {
                base.frostGroups[f.id] = cleanGoldVal(raw.frostGroups[f.id], base.frostGroups[f.id]);
            }
        }
    }

    const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
    const copyOverrides = (src) => {
        const out = {};
        if (!src || typeof src !== "object" || Array.isArray(src)) return out;
        for (const [k, v] of Object.entries(src)) {
            if (!k || typeof k !== "string" || FORBIDDEN_KEYS.has(k)) continue;
            const cleaned = cleanGoldVal(v, -1);
            if (cleaned >= 0) out[k] = cleaned;
        }
        return out;
    };

    base.itemOverrides = copyOverrides(raw.itemOverrides);
    base.gemOverrides = copyOverrides(raw.gemOverrides);
    base.frostOverrides = copyOverrides(raw.frostOverrides);
    return base;
}

const WEAPON_SLOT_IDS = new Set([15, 16, 17]);
const ARMOR_SLOT_IDS = new Set([1, 2, 3, 4, 5, 7, 8]);
const ACCESSORY_SLOT_IDS = new Set([10, 11, 12, 13, 14]);
const QUEST_ACCESSORY_RE = /\b(ynys|dream ring|evernight necklace|daeier|carmil)/i;
const WORLD_BOSS_RE =
    /\b(red dragon|kraken|leviathan|anthalon|morpheus|rangora|hanure|meina|glenn|jola|searing oath|eyesplitter|tainted|black dragon)\b/i;

function buildCatalogLevelMap(catalog) {
    const map = new Map();
    if (!catalog || typeof catalog !== "object") return map;
    for (const key of ["weapons", "armors", "accessories"]) {
        const list = Array.isArray(catalog[key]) ? catalog[key] : [];
        for (const it of list) {
            if (!it?.name || !it.level) continue;
            const k = String(it.name).trim().toLowerCase();
            const lv = Number(it.level) || 0;
            if (lv > (map.get(k) || 0)) map.set(k, lv);
        }
    }
    return map;
}

export function classifyGearItemTier(item, catalogLevelMap = null) {
    if (!item || !item.name) return "other_gear";
    const slotId = Number(item.slotId);
    const name = String(item.name || "");
    const lower = name.toLowerCase();
    const lv =
        Number(item.level) ||
        (catalogLevelMap ? catalogLevelMap.get(lower.trim()) || 0 : 0);

    if (slotId === 0 || slotId === 9) return "costume_undergarment";
    if (slotId === 6) return "cloak";
    if (slotId === 18) return "instrument";

    if (ACCESSORY_SLOT_IDS.has(slotId)) {
        if (QUEST_ACCESSORY_RE.test(lower)) return "quest_accessory";
        if (lower.includes("enlightened")) return "enlightened_accessory";
        if (lower.includes("ayanad") || lower.includes("delphinad")) {
            return "ayanad_accessory";
        }
        return "other_gear";
    }

    if (WEAPON_SLOT_IDS.has(slotId)) {
        if (WORLD_BOSS_RE.test(lower)) return "boss_weapon";
        if (lower.includes("ayanad")) return "ayanad_weapon";
        if (lower.includes("delphinad") || lower.includes("epherium")) return "delphinad_gear";
        if (lv >= 63) return "obsidian_t7_weapon";
        if (lv >= 58) return "obsidian_t6_weapon";
        if (lv >= 50) return "delphinad_gear";
        return "obsidian_t6_weapon";
    }

    if (ARMOR_SLOT_IDS.has(slotId)) {
        if (lower.includes("ayanad")) return "ayanad_armor";
        if (lower.includes("delphinad") || lower.includes("epherium")) return "delphinad_gear";
        if (lv >= 63) return "obsidian_t7_armor";
        if (lv >= 58) return "obsidian_t6_armor";
        if (lv >= 50) return "delphinad_gear";
        return "obsidian_t6_armor";
    }

    return "other_gear";
}

export function classifyLunagemGroup(gem, slotName = "") {
    const name = String(gem?.name || "").toLowerCase();
    const text = String(gem?.text || "").toLowerCase();
    const slot = String(slotName || "").toLowerCase();
    const combined = `${name} ${text}`;

    // Helmet Toughness / Hero gem (e.g. Vivid Earth Lunascale: Mastery in Head)
    if (slot === "head" && (combined.includes("toughness") || name.includes("mastery"))) {
        return "helmet_toughness";
    }
    if (name.includes("ancient") || /increases?\s+[a-z' ]+\s+(damage|healing)/i.test(text)) {
        return "skill_specific";
    }
    if (combined.includes("toughness") || combined.includes("resilience") || name.includes("flexibility")) {
        return "pvp_tough_resil";
    }
    if (name.includes("vivid") || name.includes("lunascale")) {
        return "refined_t2";
    }
    if (
        combined.includes("focus") ||
        combined.includes("penetration") ||
        combined.includes("critical") ||
        combined.includes("attack") ||
        combined.includes("healing power") ||
        combined.includes("cast time") ||
        combined.includes("attack speed")
    ) {
        return "offense_t3";
    }
    if (
        combined.includes("defense") ||
        combined.includes("block") ||
        combined.includes("parry") ||
        combined.includes("evasion") ||
        combined.includes("move speed") ||
        combined.includes("max health")
    ) {
        return "defense_t3";
    }
    return "other_gem";
}

export function classifyLunafrostGroup(frost) {
    const name = String(frost?.name || "").toLowerCase();
    if (name.includes("erenor") || name.includes("charm")) return "erenor_charm_frost";
    if (name.includes("flawless") || name.includes("distorted") || name.includes("honor") || name.includes("vivid")) {
        return "flawless_distorted_frost";
    }
    return "standard_frost";
}

function resolveTierGradeGold(tierId, gradeName, priceBook) {
    const row = priceBook.tierGrades?.[tierId] || priceBook.tierGrades?.other_gear || {};
    const g = String(gradeName || "Divine").trim();
    if (row[g] !== undefined) return cleanGoldVal(row[g], 0);
    if (g === "Eternal") return Math.round(cleanGoldVal(row.Mythic, 0) * LOWER_GRADE_MULT.Eternal);
    const mult = LOWER_GRADE_MULT[g] ?? 0.5;
    return Math.round(cleanGoldVal(row.Celestial, 0) * mult);
}

export function itemOverrideKey(item) {
    const name = String(item?.name || "").trim();
    const grade = String(item?.gradeName || "").trim();
    return grade ? `${name}|${grade}` : name;
}

export function gemOverrideKey(gem, slotName = "") {
    const name = String(gem?.name || "").trim();
    const slot = String(slotName || "").trim();
    return slot ? `${name}|${slot}` : name;
}

const _ahIndexCache = new WeakMap();

function normalizeAhEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const gold = cleanGoldVal(raw.g ?? raw.gold, 0);
    if (gold <= 0) return null;
    const itemId = Number(raw.id ?? raw.itemId) || null;
    const vol30d = Number(raw.v30 ?? raw.vol30d) || 0;
    const latest = cleanGoldVal(raw.lat ?? raw.latest, gold);
    const avg7d = raw.a7 !== undefined || raw.avg7d !== undefined ? cleanGoldVal(raw.a7 ?? raw.avg7d, 0) : null;
    return {
        gold,
        itemId,
        src: String(raw.src || "30d"),
        vol30d,
        latest,
        avg7d,
    };
}

export function buildAhLookupIndex(ahPrices) {
    if (!ahPrices || typeof ahPrices !== "object") return null;
    const cached = _ahIndexCache.get(ahPrices);
    if (cached) return cached;

    const toMap = (section) => {
        const map = new Map();
        if (!section || typeof section !== "object" || Array.isArray(section)) return map;
        for (const [name, raw] of Object.entries(section)) {
            const norm = normalizeAhEntry(raw);
            if (!norm) continue;
            map.set(String(name).trim().toLowerCase(), { name: String(name).trim(), ...norm });
        }
        return map;
    };

    const idx = {
        source: String(ahPrices.source || "sermeatball.com"),
        syncedAt: ahPrices.syncedAt || null,
        items: toMap(ahPrices.items),
        gems: toMap(ahPrices.gems),
        frosts: toMap(ahPrices.frosts),
    };
    _ahIndexCache.set(ahPrices, idx);
    return idx;
}

const HIGH_REGRADE_GRADES = new Set(["Legendary", "Mythic", "Eternal"]);
const MID_HIGH_REGRADE_GRADES = new Set(["Celestial", "Divine", "Epic"]);
const SYNTH_HIGH_GRADES = new Set(["Unique", "Celestial", "Divine", "Epic", "Legendary", "Mythic", "Eternal"]);

/**
 * sermeatball.com aggregates all grades of an equipable item under one item_id.
 * Only auto-apply raw AH gear prices when they are grade-compatible (never letting
 * un-synthesized undergarments or Arcane/Heroic drop spam underprice Epic/Legendary/Mythic gear).
 */
export function shouldAutoApplyAhGearPrice(item, ahEntry, baselineGold = 0) {
    if (!ahEntry || !(ahEntry.gold > 0)) return false;
    const slotId = Number(item?.slotId);
    const gradeName = String(item?.gradeName || "Divine").trim();

    if ((slotId === 0 || slotId === 9) && SYNTH_HIGH_GRADES.has(gradeName)) {
        return false;
    }
    if (ACCESSORY_SLOT_IDS.has(slotId) && QUEST_ACCESSORY_RE.test(String(item?.name || ""))) {
        return false;
    }
    if (HIGH_REGRADE_GRADES.has(gradeName) && baselineGold > 0 && ahEntry.gold < baselineGold * 0.5) {
        return false;
    }
    if (MID_HIGH_REGRADE_GRADES.has(gradeName) && baselineGold > 0 && ahEntry.gold < baselineGold * 0.15) {
        return false;
    }
    return true;
}

export function estimateBuildCost(
    character,
    rawPriceBook = DEFAULT_ECONOMY_PRICE_BOOK,
    catalog = null,
    ahPrices = null
) {
    const priceBook = normalizeEconomyPriceBook(rawPriceBook);
    const catalogLevelMap = buildCatalogLevelMap(catalog);
    const ahIndex = buildAhLookupIndex(ahPrices);
    const useAh = priceBook.useAhPrices !== false && ahIndex !== null;
    const equipment = Array.isArray(character?.equipment) ? character.equipment : [];

    let baseGearGold = 0;
    let lunagemsGold = 0;
    let lunafrostsGold = 0;
    let weaponsGold = 0;
    let armorGold = 0;
    let accessoriesGold = 0;
    let totalGemsCount = 0;
    let totalFrostsCount = 0;
    let ahMatchedItems = 0;
    let ahMatchedGems = 0;
    let ahMatchedFrosts = 0;

    const slotBreakdown = [];

    for (const item of equipment) {
        if (!item || !item.name) continue;
        const slotId = Number(item.slotId);
        const slotName = String(item.slotName || `Slot ${slotId}`);
        // Exclude gliders from build gear cost estimates
        if (slotId === 19 || /^glider$/i.test(slotName.trim())) continue;
        const gradeName = String(item.gradeName || "Divine");
        const tierId = classifyGearItemTier(item, catalogLevelMap);
        const tierMeta = ECONOMY_TIERS.find((t) => t.id === tierId);
        const tierBaselineGold = resolveTierGradeGold(tierId, gradeName, priceBook);

        const ovKey = itemOverrideKey(item);
        const hasItemOverride = Object.prototype.hasOwnProperty.call(priceBook.itemOverrides, ovKey);
        const ahItemRaw = ahIndex ? ahIndex.items.get(String(item.name).trim().toLowerCase()) || null : null;
        const canApplyAhItem = !hasItemOverride && useAh && ahItemRaw && shouldAutoApplyAhGearPrice(item, ahItemRaw, tierBaselineGold);

        let baseGold = tierBaselineGold;
        let itemPriceSource = "tier";
        if (hasItemOverride) {
            baseGold = priceBook.itemOverrides[ovKey];
            itemPriceSource = "override";
        } else if (canApplyAhItem) {
            baseGold = ahItemRaw.gold;
            itemPriceSource = "ah";
            ahMatchedItems++;
        }

        const ahItemInfo = ahItemRaw
            ? {
                  ...ahItemRaw,
                  applied: itemPriceSource === "ah",
                  gradeSkipped: !hasItemOverride && useAh && !canApplyAhItem,
              }
            : null;

        // Lunagems
        const gemsDetail = [];
        let slotGemsGold = 0;
        const gems = Array.isArray(item.lunagems) ? item.lunagems : [];
        for (const g of gems) {
            if (!g || !g.name) continue;
            totalGemsCount++;
            const gSlotKey = gemOverrideKey(g, slotName);
            const gGlobalKey = String(g.name).trim();
            const groupId = classifyLunagemGroup(g, slotName);
            const groupMeta = ECONOMY_GEM_GROUPS.find((x) => x.id === groupId);
            const ahGemRaw = ahIndex ? ahIndex.gems.get(gGlobalKey.toLowerCase()) || null : null;

            let unitGold = priceBook.gemGroups[groupId] ?? 0;
            let isOverride = false;
            let isAhPrice = false;
            let priceSource = "group";

            if (Object.prototype.hasOwnProperty.call(priceBook.gemOverrides, gSlotKey)) {
                unitGold = priceBook.gemOverrides[gSlotKey];
                isOverride = true;
                priceSource = "override";
            } else if (Object.prototype.hasOwnProperty.call(priceBook.gemOverrides, gGlobalKey)) {
                unitGold = priceBook.gemOverrides[gGlobalKey];
                isOverride = true;
                priceSource = "override";
            } else if (useAh && ahGemRaw) {
                unitGold = ahGemRaw.gold;
                isAhPrice = true;
                priceSource = "ah";
                ahMatchedGems++;
            }

            slotGemsGold += unitGold;
            gemsDetail.push({
                name: g.name,
                text: g.text || "",
                groupId,
                groupLabel: groupMeta?.label || groupId,
                overrideKey: gSlotKey,
                unitGold,
                isOverride,
                isAhPrice,
                priceSource,
                ahInfo: ahGemRaw,
            });
        }

        // Lunafrost
        let slotFrostGold = 0;
        let frostInfo = null;
        if (item.lunafrost && item.lunafrost.name) {
            totalFrostsCount++;
            const fName = String(item.lunafrost.name).trim();
            const fGroupId = classifyLunafrostGroup(item.lunafrost);
            const fGroupMeta = ECONOMY_FROST_GROUPS.find((x) => x.id === fGroupId);
            const ahFrostRaw = ahIndex ? ahIndex.frosts.get(fName.toLowerCase()) || null : null;
            const isFrostOv = Object.prototype.hasOwnProperty.call(priceBook.frostOverrides, fName);
            let isAhFrost = false;
            let frostPriceSource = "group";

            if (isFrostOv) {
                slotFrostGold = priceBook.frostOverrides[fName];
                frostPriceSource = "override";
            } else if (useAh && ahFrostRaw) {
                slotFrostGold = ahFrostRaw.gold;
                isAhFrost = true;
                frostPriceSource = "ah";
                ahMatchedFrosts++;
            } else {
                slotFrostGold = priceBook.frostGroups[fGroupId] ?? 0;
            }

            frostInfo = {
                name: fName,
                text: item.lunafrost.text || "",
                groupId: fGroupId,
                groupLabel: fGroupMeta?.label || fGroupId,
                gold: slotFrostGold,
                isOverride: isFrostOv,
                isAhPrice: isAhFrost,
                priceSource: frostPriceSource,
                ahInfo: ahFrostRaw,
            };
        }

        const slotTotalGold = baseGold + slotGemsGold + slotFrostGold;
        baseGearGold += baseGold;
        lunagemsGold += slotGemsGold;
        lunafrostsGold += slotFrostGold;

        if (WEAPON_SLOT_IDS.has(slotId) || slotId === 18) weaponsGold += slotTotalGold;
        else if (ARMOR_SLOT_IDS.has(slotId)) armorGold += slotTotalGold;
        else accessoriesGold += slotTotalGold;

        slotBreakdown.push({
            slotId,
            slotName,
            itemName: item.name,
            type: item.type || "",
            gradeId: item.gradeId ?? null,
            gradeName,
            gradeColor: item.gradeColor || null,
            icon: item.icon || "",
            tierId,
            tierLabel: tierMeta?.label || tierId,
            overrideKey: ovKey,
            isItemOverride: hasItemOverride,
            isAhItem: itemPriceSource === "ah",
            priceSource: itemPriceSource,
            ahInfo: ahItemInfo,
            baseGold,
            gemsGold: slotGemsGold,
            gemsCount: gemsDetail.length,
            gemsDetail,
            frostGold: slotFrostGold,
            frostInfo,
            slotTotalGold,
        });
    }

    const totalGold = baseGearGold + lunagemsGold + lunafrostsGold;
    const gs = Number(character?.gearScore || character?.metadata?.gearScore) || 0;
    const goldPerGs = gs > 0 ? totalGold / gs : 0;

    return {
        name: character?.name || "Build",
        gearScore: gs,
        pieceCount: slotBreakdown.length,
        totalGemsCount,
        totalFrostsCount,
        ahMatchedItems,
        ahMatchedGems,
        ahMatchedFrosts,
        ahMatchedTotal: ahMatchedItems + ahMatchedGems + ahMatchedFrosts,
        totalGold,
        baseGearGold,
        lunagemsGold,
        lunafrostsGold,
        weaponsGold,
        armorGold,
        accessoriesGold,
        goldPerGs,
        slotBreakdown,
    };
}

export function compareBuildEconomy(
    buildA,
    buildB,
    defender,
    rawPriceBook = DEFAULT_ECONOMY_PRICE_BOOK,
    catalog = null,
    perfMetrics = null,
    ahPrices = null
) {
    const costA = estimateBuildCost(buildA, rawPriceBook, catalog, ahPrices);
    const costB = estimateBuildCost(buildB, rawPriceBook, catalog, ahPrices);
    const costDef = defender ? estimateBuildCost(defender, rawPriceBook, catalog, ahPrices) : null;

    const deltaGold = costA.totalGold - costB.totalGold;
    const deltaPct = costB.totalGold > 0 ? (deltaGold / costB.totalGold) * 100 : 0;
    const cheaper = Math.abs(deltaGold) < 1 ? "tie" : deltaGold < 0 ? "A" : "B";

    let goldPerPctDmg = null;
    if (perfMetrics && Number.isFinite(perfMetrics.dmgDeltaPct) && Math.abs(perfMetrics.dmgDeltaPct) >= 0.05) {
        // Positive when the more expensive build deals more damage
        if (deltaGold > 0 && perfMetrics.dmgDeltaPct > 0) {
            goldPerPctDmg = {
                upgradedSlot: "A",
                extraGold: deltaGold,
                gainPct: perfMetrics.dmgDeltaPct,
                goldPer1Pct: deltaGold / perfMetrics.dmgDeltaPct,
            };
        } else if (deltaGold < 0 && perfMetrics.dmgDeltaPct < 0) {
            const bGainPct =
                perfMetrics.dmgA > 0
                    ? ((perfMetrics.dmgB - perfMetrics.dmgA) / perfMetrics.dmgA) * 100
                    : Math.abs(perfMetrics.dmgDeltaPct);
            goldPerPctDmg = {
                upgradedSlot: "B",
                extraGold: Math.abs(deltaGold),
                gainPct: bGainPct,
                goldPer1Pct: bGainPct > 0 ? Math.abs(deltaGold) / bGainPct : null,
            };
        }
    }

    return {
        costA,
        costB,
        costDef,
        deltaGold,
        deltaPct,
        cheaper,
        goldPerPctDmg,
    };
}

const ADVISOR_UPGRADE_CANDIDATES = Object.freeze([
    {
        id: "gem_pdef",
        kind: "gem",
        name: "Lucid Wave Lunagem: Defense",
        groupId: "defense_t3",
        effectLabel: "+100 Physical Defense",
        apply: (ch) => applyOverrides(ch, { defense: { physicalDefense: (Number(ch.defense?.physicalDefense) || 0) + 100 } }),
    },
    {
        id: "gem_mdef",
        kind: "gem",
        name: "Lucid Wave Lunagem: Magic Defense",
        groupId: "defense_t3",
        effectLabel: "+100 Magic Defense",
        apply: (ch) => applyOverrides(ch, { defense: { magicDefense: (Number(ch.defense?.magicDefense) || 0) + 100 } }),
    },
    {
        id: "gem_tough_body",
        kind: "gem",
        name: "Radiant Earth Lunagem: Mastery",
        groupId: "pvp_tough_resil",
        effectLabel: "+353 Toughness (Body)",
        apply: (ch) => applyOverrides(ch, { defense: { toughness: (Number(ch.defense?.toughness) || 0) + 353 } }),
    },
    {
        id: "gem_resil_body",
        kind: "gem",
        name: "Radiant Earth Lunagem: Flexibility",
        groupId: "pvp_tough_resil",
        effectLabel: "+480 Resilience (Body)",
        apply: (ch) => applyOverrides(ch, { defense: { resilience: (Number(ch.defense?.resilience) || 0) + 480 } }),
    },
    {
        id: "gem_tough_head",
        kind: "gem",
        name: "Vivid Earth Lunascale: Mastery",
        slotName: "Head",
        groupId: "helmet_toughness",
        effectLabel: "+176 Toughness (Helmet)",
        apply: (ch) => applyOverrides(ch, { defense: { toughness: (Number(ch.defense?.toughness) || 0) + 176 } }),
    },
    {
        id: "gem_block",
        kind: "gem",
        name: "Lucid Earth Lunagem: Impenetrable",
        groupId: "defense_t3",
        requiresShield: true,
        effectLabel: "+2.0% Shield Block Rate",
        apply: (ch) => applyOverrides(ch, { defense: { blockPct: (Number(ch.defense?.blockPct) || 0) + 2 } }),
    },
    {
        id: "gem_defpen",
        kind: "gem",
        name: "Lucid Gale Lunagem: Pierce",
        groupId: "offense_t3",
        effectLabel: "+150 Defense Penetration",
        apply: (ch) => applyOverrides(ch, { offense: { defensePenetration: (Number(ch.offense?.defensePenetration) || 0) + 150 } }),
    },
    {
        id: "gem_mdefpen",
        kind: "gem",
        name: "Lucid Gale Lunagem: Breakthrough",
        groupId: "offense_t3",
        effectLabel: "+150 Magic Defense Penetration",
        apply: (ch) => applyOverrides(ch, { offense: { magicDefensePenetration: (Number(ch.offense?.magicDefensePenetration) || 0) + 150 } }),
    },
    {
        id: "gem_focus",
        kind: "gem",
        name: "Lucid Gale Lunagem: Focus",
        groupId: "offense_t3",
        effectLabel: "+480 Focus",
        apply: (ch) => applyOverrides(ch, { offense: { focus: (Number(ch.offense?.focus) || 0) + 480 } }),
    },
    {
        id: "gem_melee_atk",
        kind: "gem",
        name: "Lucid Fire Lunagem: Strong Blow",
        groupId: "offense_t3",
        effectLabel: "+6 Melee Attack",
        apply: (ch) => applyOverrides(ch, { offense: { meleeAttack: (Number(ch.offense?.meleeAttack) || 0) + 6 } }),
    },
    {
        id: "gem_ranged_atk",
        kind: "gem",
        name: "Lucid Fire Lunagem: Sharpshot",
        groupId: "offense_t3",
        effectLabel: "+6 Ranged Attack",
        apply: (ch) => applyOverrides(ch, { offense: { rangedAttack: (Number(ch.offense?.rangedAttack) || 0) + 6 } }),
    },
    {
        id: "gem_melee_cd",
        kind: "gem",
        name: "Lucid Gale Lunagem: Harbinger",
        groupId: "offense_t3",
        effectLabel: "+2.4% Melee Crit Damage",
        apply: (ch) => applyOverrides(ch, { offense: { meleeCritBonusPct: (Number(ch.offense?.meleeCritBonusPct) || 0) + 2.4 } }),
    },
    {
        id: "gem_ranged_cd",
        kind: "gem",
        name: "Lucid Gale Lunagem: Torrent",
        groupId: "offense_t3",
        effectLabel: "+2.4% Ranged Crit Damage",
        apply: (ch) => applyOverrides(ch, { offense: { rangedCritBonusPct: (Number(ch.offense?.rangedCritBonusPct) || 0) + 2.4 } }),
    },
    {
        id: "gem_magic_cd",
        kind: "gem",
        name: "Lucid Gale Lunagem: Destruction",
        groupId: "offense_t3",
        effectLabel: "+2.4% Magic Crit Damage",
        apply: (ch) => applyOverrides(ch, { offense: { magicCritBonusPct: (Number(ch.offense?.magicCritBonusPct) || 0) + 2.4 } }),
    },
    {
        id: "gem_heal_cd",
        kind: "gem",
        name: "Lucid Gale Lunagem: Mercy",
        groupId: "offense_t3",
        effectLabel: "+2.4% Heal Crit Damage",
        apply: (ch) => applyOverrides(ch, { offense: { healCritBonusPct: (Number(ch.offense?.healCritBonusPct) || 0) + 2.4 } }),
    },
    {
        id: "gem_heal_pwr",
        kind: "gem",
        name: "Lucid Gale Lunagem: Benevolence",
        groupId: "offense_t3",
        effectLabel: "+6 Healing Power",
        apply: (ch) => applyOverrides(ch, { offense: { healingPower: (Number(ch.offense?.healingPower) || 0) + 6 } }),
    },
    {
        id: "frost_erenor_hp",
        kind: "frost",
        name: "Erenor Earth Lunafrost",
        groupId: "erenor_charm_frost",
        effectLabel: "+335 Max Health",
        apply: (ch) => applyOverrides(ch, { maxHealth: (Number(ch.maxHealth) || 0) + 335 }),
    },
    {
        id: "frost_chest_dr",
        kind: "frost",
        name: "Honorbold Warrior's Lunafrost",
        uniqueSlotId: 2,
        groupId: "flawless_distorted_frost",
        effectLabel: "+3.0% Received Damage Reduction (Chest)",
        apply: (ch) =>
            applyOverrides(ch, {
                defense: {
                    receivedMeleeDrPct: (Number(ch.defense?.receivedMeleeDrPct) || 0) + 3,
                    receivedRangedDrPct: (Number(ch.defense?.receivedRangedDrPct) || 0) + 3,
                    receivedMagicDrPct: (Number(ch.defense?.receivedMagicDrPct) || 0) + 3,
                },
            }),
    },
    {
        id: "frost_block",
        kind: "frost",
        name: "Whole Barrier Lunafrost",
        uniqueSlotId: 16,
        groupId: "flawless_distorted_frost",
        requiresShield: true,
        effectLabel: "+2.0% Shield Block Rate (Shield)",
        apply: (ch) => applyOverrides(ch, { defense: { blockPct: (Number(ch.defense?.blockPct) || 0) + 2 } }),
    },
    {
        id: "frost_melee_cd",
        kind: "frost",
        name: "Flawless Assassin's Lunafrost",
        groupId: "flawless_distorted_frost",
        effectLabel: "+2.0% Melee Crit Damage",
        apply: (ch) => applyOverrides(ch, { offense: { meleeCritBonusPct: (Number(ch.offense?.meleeCritBonusPct) || 0) + 2 } }),
    },
    {
        id: "frost_magic_cd",
        kind: "frost",
        name: "Flawless Wave Lunafrost",
        groupId: "flawless_distorted_frost",
        effectLabel: "+2.0% Magic Crit Damage",
        apply: (ch) => applyOverrides(ch, { offense: { magicCritBonusPct: (Number(ch.offense?.magicCritBonusPct) || 0) + 2 } }),
    },
]);

/**
 * Gold-Efficiency Upgrade Advisor ("Gold per +1% EHP / Damage / Ode").
 * Evaluates realistic lunagem, lunafrost, and +1 grade weapon/armor upgrades
 * using the active Price Book + synced sermeatball.com AH prices, ranking upgrades
 * by cheapest gold spent per +1% gain on the chosen goal.
 */
export function computeGoldEfficiencyUpgrades(
    character,
    opponent,
    rawPriceBook = DEFAULT_ECONOMY_PRICE_BOOK,
    catalog = null,
    ahPrices = null,
    options = {}
) {
    const goal = options.goal || "melee_ehp"; // "melee_ehp" | "ranged_ehp" | "magic_ehp" | "offense_skill" | "ode_heal"
    const skill = options.skill || null;
    const charMods = Array.isArray(options.characterModifiers) ? options.characterModifiers : [];
    const oppMods = Array.isArray(options.opponentModifiers) ? options.opponentModifiers : [];
    const baseCtx = options.context || {};
    const constants = options.constants || {};
    const disableAvoidance = Boolean(options.disableAvoidance || baseCtx.disableAvoidance);

    const priceBook = normalizeEconomyPriceBook(rawPriceBook);
    const ahIndex = buildAhLookupIndex(ahPrices);
    const useAh = priceBook.useAhPrices !== false && ahIndex !== null;

    const effChar = charMods.length > 0 ? applyModifiers(character, charMods) : character;
    const effOpp = opponent ? (oppMods.length > 0 ? applyModifiers(opponent, oppMods) : opponent) : effChar;
    const cleanCtx = {
        ...baseCtx,
        disableAvoidance,
        attackerModifiers: null,
        defenderModifiers: null,
    };
    const ehpOpts = {
        isPvE: Boolean(baseCtx.isPvE),
        disableAvoidance,
    };

    const evalGoal = (candChar) => {
        if (goal === "melee_ehp" || goal === "ranged_ehp" || goal === "magic_ehp") {
            const kind = goal === "magic_ehp" ? "magic" : goal === "ranged_ehp" ? "ranged" : "melee";
            return computeEffectiveStats(candChar, effOpp, constants, ehpOpts).defense.ehp[kind].vsAttackerEhp;
        }
        if (goal === "ode_heal" && skill) {
            return simulateSkillHeal(candChar, effOpp, skill, cleanCtx, constants).expected;
        }
        if (goal === "offense_skill" && skill) {
            return skill.kind === "heal"
                ? simulateSkillHeal(candChar, effOpp, skill, cleanCtx, constants).expected
                : simulateSkillDamage(candChar, effOpp, skill, cleanCtx, constants).expected;
        }
        return 0;
    };

    const baseValue = evalGoal(effChar);
    if (!(baseValue > 0)) {
        return { goal, baseValue: 0, items: [] };
    }

    const hasShield = Boolean(
        effChar?.defense?.hasShield ||
            Number(effChar?.defense?.shieldPhysicalDefense) > 0 ||
            Number(effChar?.defense?.blockPct) > 0
    );

    const resolveCandidatePrice = (cand) => {
        if (cand.kind === "gem") {
            const slotKey = cand.slotName ? `${cand.name}|${cand.slotName}` : null;
            if (slotKey && Object.prototype.hasOwnProperty.call(priceBook.gemOverrides, slotKey)) {
                return { gold: priceBook.gemOverrides[slotKey], source: "override" };
            }
            if (Object.prototype.hasOwnProperty.call(priceBook.gemOverrides, cand.name)) {
                return { gold: priceBook.gemOverrides[cand.name], source: "override" };
            }
            const ahGem = useAh ? ahIndex.gems.get(cand.name.toLowerCase()) || null : null;
            if (ahGem && ahGem.gold > 0) {
                return { gold: ahGem.gold, source: "ah" };
            }
            return { gold: priceBook.gemGroups[cand.groupId] ?? 0, source: "group" };
        }
        if (cand.kind === "frost") {
            if (Object.prototype.hasOwnProperty.call(priceBook.frostOverrides, cand.name)) {
                return { gold: priceBook.frostOverrides[cand.name], source: "override" };
            }
            const ahFrost = useAh ? ahIndex.frosts.get(cand.name.toLowerCase()) || null : null;
            if (ahFrost && ahFrost.gold > 0) {
                return { gold: ahFrost.gold, source: "ah" };
            }
            return { gold: priceBook.frostGroups[cand.groupId] ?? 0, source: "group" };
        }
        return { gold: 0, source: "tier" };
    };

    const eqList = Array.isArray(character?.equipment) ? character.equipment : [];
    const eqBySlot = new Map(eqList.map((x) => [Number(x?.slotId), x]));

    const items = [];
    for (const cand of ADVISOR_UPGRADE_CANDIDATES) {
        if (cand.requiresShield && !hasShield) continue;
        if (cand.uniqueSlotId != null) {
            const slotEq = eqBySlot.get(cand.uniqueSlotId);
            const curFrostName = String(slotEq?.lunafrost?.name || "").trim().toLowerCase();
            if (curFrostName && curFrostName === cand.name.toLowerCase()) continue;
        }
        const nextChar = cand.apply(effChar);
        const nextVal = evalGoal(nextChar);
        const rawGain = nextVal - baseValue;
        const gainPct = (rawGain / baseValue) * 100;
        if (gainPct <= 0.005) continue;
        const { gold, source } = resolveCandidatePrice(cand);
        if (!(gold > 0)) continue;
        items.push({
            id: cand.id,
            kind: cand.kind,
            label: cand.name,
            effectLabel: cand.effectLabel,
            goldCost: gold,
            priceSource: source,
            rawGain,
            gainPct,
            goldPer1Pct: gold / gainPct,
        });
    }

    // Also evaluate +1 grade regrade on primary equipped Weapon (slot 15 / 17) when below Mythic
    const GRADE_STEP = { Celestial: "Divine", Divine: "Epic", Epic: "Legendary", Legendary: "Mythic" };
    const catalogLevelMap = buildCatalogLevelMap(catalog);
    const classifyWeaponStats = (eq) => {
        const typ = String(eq?.type || "").trim().toLowerCase();
        const nm = String(eq?.name || "").trim().toLowerCase();
        const isStaff = typ.includes("staff") || /\bstaff\b/.test(nm);
        const isScepter = typ.includes("scepter") || /\bscepter\b/.test(nm);
        const isObsKatana = typ.includes("obsidian katana") || (/\bkatana\b/.test(nm) && (Number(effChar.offense?.magicAttack) || 0) >= 400);
        const isClub = typ.includes("club") || /\b(club|greatclub|warclub)\b/.test(nm);
        const isObsShortspear = typ.includes("obsidian shortspear") || (/\bshortspear\b/.test(nm) && (Number(effChar.offense?.healingPower) || 0) >= 350);
        const stats = [];
        if (isStaff || isScepter || isObsKatana) stats.push("magicAttack");
        if (isClub || isObsShortspear) stats.push("healingPower");
        if (!isStaff && !isScepter) stats.push("meleeAttack");
        return stats.length > 0 ? stats : ["meleeAttack"];
    };
    for (const slotId of [15, 17]) {
        const eq = eqBySlot.get(slotId);
        if (!eq || !eq.name) continue;
        const curGrade = String(eq.gradeName || "").trim();
        const nextGrade = GRADE_STEP[curGrade];
        if (!nextGrade) continue;
        const tierId = classifyGearItemTier(eq, catalogLevelMap);
        const curTierGold = resolveTierGradeGold(tierId, curGrade, priceBook);
        const nextTierGold = resolveTierGradeGold(tierId, nextGrade, priceBook);
        const deltaGold = Math.max(0, nextTierGold - curTierGold);
        if (!(deltaGold > 0)) continue;

        // ArcheAge Classic ~8.5% weapon DPS jump per grade; weapon accounts for ~75% of total attack/healing (~+6.4% net)
        const netAtkBoost = 1 + 0.085 * 0.75;
        const offPatch = {};
        if (slotId === 17) {
            offPatch.rangedAttack = (Number(effChar.offense?.rangedAttack) || 0) * netAtkBoost;
        } else {
            for (const statKey of classifyWeaponStats(eq)) {
                offPatch[statKey] = (Number(effChar.offense?.[statKey]) || 0) * netAtkBoost;
            }
        }
        const upgraded = applyOverrides(effChar, { offense: offPatch });
        const nextVal = evalGoal(upgraded);
        const rawGain = nextVal - baseValue;
        const gainPct = (rawGain / baseValue) * 100;
        if (gainPct <= 0.05) continue;
        items.push({
            id: `regrade_${slotId}`,
            kind: "regrade",
            label: `${eq.name} (${curGrade} → ${nextGrade})`,
            effectLabel: `~+8.5% ${slotId === 17 ? "Bow" : eq.type || "Main Weapon"} DPS (~+6.4% net)`,
            goldCost: deltaGold,
            priceSource: "tier",
            rawGain,
            gainPct,
            goldPer1Pct: deltaGold / gainPct,
        });
    }

    items.sort((a, b) => a.goldPer1Pct - b.goldPer1Pct);
    return {
        goal,
        baseValue,
        items,
    };
}
