/**
 * DaruGear & In-Game Addon Import Adapter + Bookmarklet Generator.
 *
 * Accepts:
 *  1. DaruGear bookmarklet JSON ({ schemaVersion: 1, source: "darugear", ... })
 *  2. Normalized damage-sim CharacterStats JSON (e.g. sample_character.json or saved builds)
 *  3. Raw in-game addon skill_dump_*.txt (Lua table with metaJson containing player.unitInfo)
 */

import { createDefaultCharacter } from "../engine/stats.js";
import {
    extractSkillBuildFromDaruGearPlayerClass,
    normalizeSkillBuild,
} from "../engine/skillbuilder.js";
import { buildDaruGearExportFromApiPayload } from "./darugear_calc.js";

function num(val, fallback = 0) {
    if (typeof val === "number" && Number.isFinite(val)) return val;
    if (typeof val === "string") {
        const cleaned = val.replace(/[,%\s]/g, "").trim();
        const parsed = parseFloat(cleaned);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

/**
 * Convert an in-game AA Classic unitInfo snapshot (from skill_dump_*.txt)
 * into a normalized CharacterStats object.
 */
export function fromInGameUnitInfo(meta) {
    const player = meta?.player || {};
    const u = player.unitInfo || {};
    return createDefaultCharacter({
        name: meta?.dumpLabel ? `In-Game Dump (${meta.dumpLabel})` : "In-Game Character",
        source: "ingame_addon",
        level: 55,
        gearScore: num(u.gear_score, 0),
        maxHealth: num(player.maxHealth, 20000),
        maxMana: num(player.maxMana, 10000),
        attributes: {
            str: num(u.str, 0),
            agi: num(u.dex, 0),
            sta: num(u.sta, 0),
            int: num(u.int, 0),
            spi: num(u.spi, 0),
        },
        offense: {
            meleeAttack: num(u.melee_dps, 0),
            rangedAttack: num(u.ranged_dps, 0),
            magicAttack: num(u.spell_dps, 0),
            healingPower: num(u.heal_dps, 0),
            meleeAccuracyPct: num(u.melee_success_rate, 100),
            rangedAccuracyPct: num(u.ranged_success_rate, 100),
            magicAccuracyPct: num(u.spell_success_rate, 100),
            meleeCritRatePct: num(u.melee_critical_rate, 0),
            rangedCritRatePct: num(u.ranged_critical_rate, 0),
            magicCritRatePct: num(u.spell_critical_rate, 0),
            healCritRatePct: num(u.heal_critical_rate, 0),
            meleeCritBonusPct: num(u.melee_critical_bonus, 50),
            rangedCritBonusPct: num(u.ranged_critical_bonus, 50),
            magicCritBonusPct: num(u.spell_critical_bonus, 50),
            healCritBonusPct: num(u.heal_critical_bonus, 50),
            meleeSkillDamagePct: num(u.melee_damage_mul, 0),
            rangedSkillDamagePct: num(u.ranged_damage_mul, 0),
            magicSkillDamagePct: num(u.spell_damage_mul, 0),
            healingPct: num(u.heal_mul, 0),
            backstabMeleeDamagePct: num(u.backattack_melee_damage_mul, 0),
            backstabRangedDamagePct: num(u.backattack_ranged_damage_mul, 0),
            backstabMagicDamagePct: num(u.backattack_spell_damage_mul, 0),
            defensePenetration: num(u.ignore_armor, 0),
            magicDefensePenetration: num(u.magic_penetration, 0),
            shieldDefPenRatePct: num(u.ignore_shield_chance, 0),
            shieldDefPenPct: num(u.ignore_shield_bonus_mul, 0),
            focus: num(u.bulls_eye, 0),
            attackSpeed:
                u.attack_anim_speed != null
                    ? num(u.attack_anim_speed, 0)
                    : num(u.attack_anim_speed_mul, 100) > 0
                      ? Math.round((100 / num(u.attack_anim_speed_mul, 100) - 1) * 1000)
                      : 0,
            castTimePct: num(u.casting_time, 100),
        },
        defense: {
            physicalDefense: num(u.armor, 0),
            magicDefense: num(u.magic_resist, 0),
            shieldPhysicalDefense: 0,
            toughness: num(u.battle_resist, 0),
            resilience: num(u.flexibility, 0),
            evasionPct: num(u.dodge_rate, 0),
            parryPct: num(u.melee_parry_rate, 0),
            rangedParryPct: num(u.ranged_parry_rate, 0),
            blockPct: num(u.block_rate, 0),
            // In live AA Classic unitInfo, negative incoming_*_damage_mul/val means damage reduction,
            // while positive means increased damage taken (vulnerability). Negate instead of Math.abs().
            receivedMeleeDrPct: -num(u.incoming_melee_damage_mul, 0),
            receivedRangedDrPct: -num(u.incoming_ranged_damage_mul, 0),
            receivedMagicDrPct: -num(u.incoming_spell_damage_mul, 0),
            fixedMeleeDr: -num(u.incoming_melee_damage_val, 0),
            fixedRangedDr: -num(u.incoming_ranged_damage_val, 0),
            fixedMagicDr: -num(u.incoming_spell_damage_val, 0),
            receivedHealingPct: num(u.incoming_heal_mul, 0),
        },
    });
}

export function extractDaruGearShareCode(url) {
    if (!url || typeof url !== "string") return null;
    try {
        const parsed = new URL(url.trim());
        const code = parsed.searchParams.get("s");
        return code ? code.trim() : null;
    } catch {
        const m = String(url).match(/[?&]s=([A-Za-z0-9_-]+)/);
        return m ? m[1] : null;
    }
}

function normalizeDaruGearBuffs(rawList) {
    if (!Array.isArray(rawList)) return [];
    const seen = new Set();
    const out = [];
    for (const item of rawList) {
        if (!item) continue;
        if (typeof item === "string") {
            const nm = item.trim();
            if (!nm) continue;
            const key = nm.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ id: null, name: nm, isOptional: true });
            continue;
        }
        if (typeof item === "object" && item.name) {
            const nm = String(item.name).trim();
            if (!nm) continue;
            const idNum = item.id != null && item.id !== "" ? Number(item.id) : null;
            const id = Number.isFinite(idNum) && idNum > 0 ? idNum : null;
            const key = `${id || ""}:${nm.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const entry = {
                id,
                name: nm,
                isOptional: Boolean(item.isOptional),
            };
            if (item.isTitle) entry.isTitle = true;
            if (item.unbaked) entry.unbaked = true;
            if (typeof item.mappedModId === "string" && item.mappedModId.trim()) {
                entry.mappedModId = item.mappedModId.trim();
            }
            out.push(entry);
        }
    }
    out.sort((a, b) => (b.isOptional ? 2 : b.isTitle ? 1 : 0) - (a.isOptional ? 2 : a.isTitle ? 1 : 0));
    return out;
}

export function normalizeBuildMetadata(data = {}) {
    const metaIn = data.metadata && typeof data.metadata === "object" ? data.metadata : {};
    const darugearUrl =
        (typeof metaIn.darugearUrl === "string" && metaIn.darugearUrl.trim()) ||
        (typeof data.darugearUrl === "string" && data.darugearUrl.trim()) ||
        (typeof metaIn.shareUrl === "string" && metaIn.shareUrl.trim()) ||
        (typeof data.shareUrl === "string" && data.shareUrl.trim()) ||
        null;
    const shareCode =
        (typeof metaIn.shareCode === "string" && metaIn.shareCode.trim()) ||
        (typeof data.shareCode === "string" && data.shareCode.trim()) ||
        extractDaruGearShareCode(darugearUrl) ||
        null;
    const className =
        (typeof metaIn.className === "string" && metaIn.className.trim()) ||
        (typeof data.className === "string" && data.className.trim()) ||
        null;
    const title =
        (typeof metaIn.title === "string" && metaIn.title.trim()) ||
        (typeof data.title === "string" && data.title.trim()) ||
        null;
    const darugearBuffs = normalizeDaruGearBuffs(metaIn.darugearBuffs ?? data.darugearBuffs);
    const rawPassives = metaIn.passives ?? data.passives;
    const passives = Array.isArray(rawPassives)
        ? Array.from(new Set(rawPassives.map((p) => String(p || "").trim()).filter(Boolean)))
        : [];
    const equipmentType =
        (typeof metaIn.equipmentType === "string" && metaIn.equipmentType.trim()) ||
        (typeof data.equipmentType === "string" && data.equipmentType.trim()) ||
        null;
    const rawCat = String(metaIn.category ?? data.category ?? "").trim().toLowerCase();
    const category =
        rawCat && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(rawCat) && !["__proto__", "constructor", "prototype"].includes(rawCat)
            ? rawCat
            : null;
    const gearScore = num(metaIn.gearScore ?? data.gearScore, 0);
    const source = metaIn.source || data.source || (darugearUrl ? "darugear" : "manual");
    const importedAt = metaIn.importedAt || data.importedAt || null;

    return {
        source,
        darugearUrl,
        shareCode,
        className,
        ...(category ? { category } : {}),
        ...(title ? { title } : {}),
        ...(equipmentType ? { equipmentType } : {}),
        gearScore,
        ...(darugearBuffs.length > 0 ? { darugearBuffs } : {}),
        ...(passives.length > 0 ? { passives } : {}),
        ...(importedAt ? { importedAt } : {}),
    };
}

export const ARCHEAGE_GRADE_COLORS = Object.freeze({
    0: "#8c8c8c", // Crude
    1: "#b0b0b0", // Basic
    2: "#52d669", // Grand
    3: "#4da3ff", // Rare
    4: "#d96ef5", // Arcane
    5: "#f2c94c", // Heroic
    6: "#f07b42", // Unique
    7: "#ff5c6a", // Celestial
    8: "#d9a466", // Divine
    9: "#f0f6ff", // Epic (crisp silver-white)
    10: "#ffb326", // Legendary
    11: "#ef233c", // Mythic
    12: "#e85dff", // Eternal
});

function cleanSynthStatText(raw) {
    let s = String(raw || "").trim();
    if (!s) return "";
    // Clean up DaruGear multi-line display_text like "Decrease Received Damage %\n-2.8 ~ -3.2 +-3.2%"
    const nlIdx = s.indexOf("\n");
    if (nlIdx >= 0) {
        const label = s.slice(0, nlIdx).replace(/[+%]+$/, "").trim();
        const tail = s.slice(nlIdx + 1).trim();
        const m = tail.match(/([+-]+-?\d+(?:\.\d+)?%?)\s*$/);
        if (m) {
            const val = m[1].replace(/^\+-/, "-").replace(/^\+\+/, "+");
            return `${label} ${val}`.trim();
        }
        s = `${label} ${tail}`.trim();
    }
    return s.replace(/\+-/g, "-").replace(/\s+/g, " ").trim();
}

function normalizeIconPath(raw) {
    if (!raw || typeof raw !== "string") return null;
    let s = raw.trim().replace(/\\/g, "/");
    if (s.startsWith("/assets/icons/")) s = s.slice(1);
    else if (s.startsWith("https://darugear.com/assets/icons/")) {
        s = "assets/icons/" + s.slice("https://darugear.com/assets/icons/".length);
    } else if (s.startsWith("https://aa-classic.com/game/icons/")) {
        s = "assets/icons/" + s.slice("https://aa-classic.com/game/icons/".length);
    } else if (!s.startsWith("assets/icons/") && !s.startsWith("http")) {
        s = "assets/icons/" + s.replace(/^\/+/, "");
    }
    return s;
}

export function normalizeEquipmentList(rawList) {
    if (!Array.isArray(rawList)) return [];
    const out = [];
    for (const item of rawList) {
        if (!item || typeof item !== "object" || !item.name) continue;
        const slotId = Number.isFinite(Number(item.slotId)) ? Number(item.slotId) : out.length;
        const gradeId = Number.isFinite(Number(item.gradeId)) ? Number(item.gradeId) : 0;
        const gradeColor =
            ARCHEAGE_GRADE_COLORS[gradeId] ||
            (typeof item.gradeColor === "string" && item.gradeColor.trim()) ||
            "#94a3b8";

        const lunafrost =
            typeof item.lunafrost === "string" && item.lunafrost.trim()
                ? { name: item.lunafrost.trim(), text: item.lunafrost.trim() }
                : item.lunafrost && typeof item.lunafrost === "object" && (item.lunafrost.name || item.lunafrost.text)
                  ? {
                        name: String(item.lunafrost.name || "").trim(),
                        text: String(item.lunafrost.text || "").trim(),
                    }
                  : null;

        const lunagems = Array.isArray(item.lunagems)
            ? item.lunagems
                  .filter((g) => g && typeof g === "object" && (g.name || g.text))
                  .map((g) => ({
                      name: String(g.name || "").trim(),
                      text: String(g.text || "").trim(),
                  }))
            : [];

        const synthStats = Array.isArray(item.synthStats)
            ? item.synthStats.map((s) => cleanSynthStatText(s)).filter(Boolean)
            : [];

        const itemId = Number(item.itemId);
        const entry = {
            slotId,
            slotName: String(item.slotName || `Slot ${slotId}`).trim(),
            ...(Number.isFinite(itemId) && itemId > 0 ? { itemId: Math.round(itemId) } : {}),
            name: String(item.name).trim(),
            type: String(item.type || "").trim(),
            icon: normalizeIconPath(item.icon),
            gradeId,
            gradeName: String(item.gradeName || "").trim(),
            gradeColor,
        };
        const pt = Number(item.ptemper) || 0;
        const mt = Number(item.mtemper) || 0;
        if (pt > 100) entry.ptemper = pt;
        if (mt > 100) entry.mtemper = mt;
        if (lunafrost) entry.lunafrost = lunafrost;
        if (lunagems.length > 0) entry.lunagems = lunagems;
        if (synthStats.length > 0) entry.synthStats = synthStats;
        out.push(entry);
    }
    out.sort((a, b) => a.slotId - b.slotId);
    return out;
}

const SKILLSET_PASSIVE_TO_MOD = Object.freeze({
    "weapon mastery": "weapon_mastery",
    "aranzeb's infusion": "aranzebs_infusion",
    "feral claws": "feral_claws",
});

const ENLIGHTENMENT_CHARM_PATTERNS = Object.freeze([
    { modId: "enlightenment_life", re: /\blife\s+(?:charm|enlightenment)\b/i },
    { modId: "enlightenment_flame", re: /\bflame\s+(?:charm|enlightenment)\b/i },
    { modId: "enlightenment_gale", re: /\bgale\s+(?:charm|enlightenment)\b/i },
    { modId: "enlightenment_wave", re: /\bwave\s+(?:charm|enlightenment)\b/i },
    { modId: "enlightenment_meadow", re: /\bmeadow\s+(?:charm|enlightenment)\b/i },
    { modId: "enlightenment_earth", re: /\bearth\s+(?:charm|enlightenment)\b/i },
    { modId: "enlightenment_lightning", re: /\blightning\s+(?:charm|enlightenment)\b/i },
]);

function detectEnlightenmentFromEquipmentOrBuffs(equipment = [], darugearBuffs = []) {
    for (const b of darugearBuffs || []) {
        const txt = String(b?.name || "");
        for (const pat of ENLIGHTENMENT_CHARM_PATTERNS) {
            if (pat.re.test(txt)) return pat.modId;
        }
    }
    for (const item of equipment || []) {
        if (!item?.lunafrost) continue;
        const txt = `${item.lunafrost.name || ""} ${item.lunafrost.text || ""}`;
        for (const pat of ENLIGHTENMENT_CHARM_PATTERNS) {
            if (pat.re.test(txt)) return pat.modId;
        }
    }
    return null;
}

/**
 * Normalize a DaruGear bookmarklet export object into CharacterStats.
 */
export function fromDaruGearExport(data) {
    const warnings = [];
    const off = data.offense || {};
    const def = data.defense || {};
    const attr = data.attributes || {};
    const metadata = normalizeBuildMetadata(data);

    const equipment = normalizeEquipmentList(data.equipment);
    const hasMagicShield =
        metadata.equipmentType === "magic_shield" ||
        equipment.some(
            (it) => Number(it.slotId) === 16 && String(it.type || "").trim().toLowerCase() === "magic shield"
        );

    if (num(def.blockPct, 0) > 0 && num(def.shieldPhysicalDefense, 0) === 0 && !hasMagicShield) {
        warnings.push(
            "Defender has Block Rate > 0% but shieldPhysicalDefense is 0; set Shield Physical Defense manually if testing Shield Defense Penetration."
        );
    }

    const label = data.name || (metadata.shareCode ? `DaruGear (${metadata.shareCode})` : "DaruGear Build");
    const rawSkillBuild =
        data.skillBuild ||
        extractSkillBuildFromDaruGearPlayerClass(data.player?.playerclass || data.playerclass) ||
        null;

    const rawBaseAttr = data.baseAttributes || data.rawDaruGear?.player || null;
    const baseAttributes =
        rawBaseAttr && typeof rawBaseAttr === "object" && Number.isFinite(Number(rawBaseAttr.str))
            ? {
                  str: Math.round(num(rawBaseAttr.str, 158)),
                  agi: Math.round(num(rawBaseAttr.agi ?? rawBaseAttr.dex, 158)),
                  sta: Math.round(num(rawBaseAttr.sta, 158)),
                  int: Math.round(num(rawBaseAttr.int, 158)),
                  spi: Math.round(num(rawBaseAttr.spi, 158)),
              }
            : null;

    const character = createDefaultCharacter({
        name: label,
        source: metadata.source || "darugear",
        shareUrl: metadata.darugearUrl,
        darugearUrl: metadata.darugearUrl,
        shareCode: metadata.shareCode,
        className: metadata.className,
        metadata,
        ...(equipment.length > 0 ? { equipment } : {}),
        ...(rawSkillBuild ? { skillBuild: normalizeSkillBuild(rawSkillBuild, { metadata }) } : {}),
        ...(data.rawDaruGear ? { rawDaruGear: data.rawDaruGear } : {}),
        ...(baseAttributes ? { baseAttributes } : {}),
        level: num(data.level, 55),
        gearScore: metadata.gearScore,
        maxHealth: num(data.maxHealth, 20000),
        maxMana: num(data.maxMana, 10000),
        attributes: {
            str: num(attr.str, 158),
            agi: num(attr.agi, 158),
            sta: num(attr.sta, 158),
            int: num(attr.int, 158),
            spi: num(attr.spi, 158),
        },
        offense: {
            meleeAttack: num(off.meleeAttack, 0),
            rangedAttack: num(off.rangedAttack, 0),
            magicAttack: num(off.magicAttack, 0),
            healingPower: num(off.healingPower, 0),
            meleeAccuracyPct: num(off.meleeAccuracyPct, 100),
            rangedAccuracyPct: num(off.rangedAccuracyPct, 100),
            magicAccuracyPct: num(off.magicAccuracyPct, 100),
            meleeCritRatePct: num(off.meleeCritRatePct, 0),
            rangedCritRatePct: num(off.rangedCritRatePct, 0),
            magicCritRatePct: num(off.magicCritRatePct, 0),
            healCritRatePct: num(off.healCritRatePct, 0),
            meleeCritBonusPct: num(off.meleeCritBonusPct, 50),
            rangedCritBonusPct: num(off.rangedCritBonusPct, 50),
            magicCritBonusPct: num(off.magicCritBonusPct, 50),
            healCritBonusPct: num(off.healCritBonusPct, 50),
            meleeSkillDamagePct: num(off.meleeSkillDamagePct, 0),
            rangedSkillDamagePct: num(off.rangedSkillDamagePct, 0),
            magicSkillDamagePct: num(off.magicSkillDamagePct, 0),
            healingPct: num(off.healingPct, 0),
            backstabMeleeDamagePct: num(off.backstabMeleeDamagePct, 0),
            backstabRangedDamagePct: num(off.backstabRangedDamagePct, 0),
            backstabMagicDamagePct: num(off.backstabMagicDamagePct, 0),
            defensePenetration: num(off.defensePenetration, 0),
            magicDefensePenetration: num(off.magicDefensePenetration, 0),
            shieldDefPenRatePct: num(off.shieldDefPenRatePct, 0),
            shieldDefPenPct: num(off.shieldDefPenPct, 0),
            focus: num(off.focus, 0),
            attackSpeed: num(off.attackSpeed, 0),
            castTimePct: num(off.castTimePct, 100),
        },
        defense: {
            physicalDefense: num(def.physicalDefense, 0),
            magicDefense: num(def.magicDefense, 0),
            shieldPhysicalDefense: num(def.shieldPhysicalDefense, 0),
            toughness: num(def.toughness, 0),
            resilience: num(def.resilience, 0),
            evasionPct: num(def.evasionPct, 0),
            parryPct: num(def.parryPct, 0),
            rangedParryPct: num(def.rangedParryPct, 0),
            blockPct: num(def.blockPct, 0),
            hasShield:
                typeof def.hasShield === "boolean"
                    ? def.hasShield
                    : metadata.equipmentType === "shield" ||
                      metadata.equipmentType === "magic_shield" ||
                      num(def.shieldPhysicalDefense, 0) > 0 ||
                      num(def.blockPct, 0) > 0,
            dualWieldRangedParry:
                typeof def.dualWieldRangedParry === "boolean"
                    ? def.dualWieldRangedParry
                    : (metadata.equipmentType === "dual_wield" &&
                          (metadata.passives || []).some(
                              (p) => p.toLowerCase() === "dual-wield proficiency"
                          )) ||
                      num(def.rangedParryPct, 0) > 0,
            receivedMeleeDrPct: num(def.receivedMeleeDrPct, 0),
            receivedRangedDrPct: num(def.receivedRangedDrPct, 0),
            receivedMagicDrPct: num(def.receivedMagicDrPct, 0),
            fixedMeleeDr: num(def.fixedMeleeDr, 0),
            fixedRangedDr: num(def.fixedRangedDr, 0),
            fixedMagicDr: num(def.fixedMagicDr, 0),
            receivedHealingPct: num(def.receivedHealingPct, 0),
        },
    });

    let modifiers = Array.isArray(data.modifiers)
        ? data.modifiers.filter((id) => typeof id === "string")
        : null;
    // Auto-activate skillset-specific damage passives & Costume Enlightenment Charms from DaruGear
    if (!modifiers) {
        const autoMods = [];
        if (Array.isArray(metadata.passives) && metadata.passives.length > 0) {
            for (const pName of metadata.passives) {
                const modId = SKILLSET_PASSIVE_TO_MOD[pName.toLowerCase()];
                if (modId && !autoMods.includes(modId)) autoMods.push(modId);
            }
        }
        const detectedEnl = detectEnlightenmentFromEquipmentOrBuffs(equipment, metadata.darugearBuffs);
        if (detectedEnl && !autoMods.includes(detectedEnl)) autoMods.push(detectedEnl);
        if (autoMods.length > 0) modifiers = autoMods;
    }
    const consumables =
        data.consumables && typeof data.consumables === "object" && !Array.isArray(data.consumables)
            ? { ...data.consumables }
            : null;

    return { ok: true, character, warnings, modifiers, consumables, savedId: data.savedId || null };
}

function isLocalLoopbackOrigin() {
    if (typeof window === "undefined" || !window.location) return false;
    const proto = String(window.location.protocol || "").toLowerCase();
    if (proto !== "http:" && proto !== "https:") return false;
    const host = String(window.location.hostname || "").toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

/**
 * Fetch a full DaruGear build (gear, exact calculated stats, buffs, AND skill build)
 * directly from a `https://darugear.com/?s=XXXXXX` URL or bare share code, with zero bookmarklet needed.
 */
export async function fetchDaruGearBuild(urlOrCode) {
    const raw = String(urlOrCode || "").trim();
    if (!raw) {
        return { ok: false, error: "Enter a DaruGear URL (https://darugear.com/?s=...) or share code." };
    }
    const code = extractDaruGearShareCode(raw) || (/^[A-Za-z0-9_-]{3,32}$/.test(raw) ? raw : null);
    if (!code) {
        return { ok: false, error: "Could not find a valid DaruGear share code (expected ?s=XXXXXX)." };
    }

    let apiPayload = null;
    let lastError = null;
    if (isLocalLoopbackOrigin()) {
        try {
            const res = await fetch(`/api/darugear/build?code=${encodeURIComponent(code)}`, { cache: "no-store" });
            const json = await res.json();
            if (res.ok && json?.ok && json.data) {
                apiPayload = json.data;
            } else if (json?.error) {
                lastError = json.error;
            }
        } catch (err) {
            lastError = err.message;
        }
    }

    if (!apiPayload) {
        try {
            const res = await fetch(
                `https://154smechk6.execute-api.ap-southeast-2.amazonaws.com/default/gear/${encodeURIComponent(code)}`
            );
            if (res.ok) {
                apiPayload = await res.json();
            } else {
                lastError = `HTTP ${res.status}`;
            }
        } catch (err) {
            lastError = lastError || err.message;
        }
    }

    if (!apiPayload || !apiPayload.player) {
        return { ok: false, error: lastError || `Could not load DaruGear build "${code}".` };
    }

    const exportObj = buildDaruGearExportFromApiPayload(apiPayload, code);
    const parsed = fromDaruGearExport(exportObj);
    return {
        ...parsed,
        shareCode: code,
        rawExport: exportObj,
    };
}

/**
 * Fetch a DaruGear share build's `playerclass` (3 skillsets, selected actives, passives, Hatred)
 * from either a full `https://darugear.com/?s=...` URL or a bare share code.
 * Uses local `/api/darugear/skills` proxy when served via `serve.py`, with direct API fallback.
 */
export async function fetchDaruGearSkillBuild(urlOrCode) {
    const raw = String(urlOrCode || "").trim();
    if (!raw) return { ok: false, error: "Enter a DaruGear URL (https://darugear.com/?s=...) or share code." };

    // Also allow pasting raw JSON containing `playerclass` or `skillBuild`
    if (raw.startsWith("{")) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed.skillBuild) {
                const sb = normalizeSkillBuild(parsed.skillBuild, parsed);
                return { ok: true, shareCode: parsed.shareCode || null, skillBuild: sb, className: sb.className };
            }
            const pc = parsed.player?.playerclass || parsed.playerclass || (parsed.skill1 ? parsed : null);
            if (pc) {
                const sb = extractSkillBuildFromDaruGearPlayerClass(pc);
                if (sb) return { ok: true, shareCode: parsed.shareCode || null, skillBuild: sb, className: sb.className };
            }
            return { ok: false, error: "JSON does not contain a DaruGear skillBuild or playerclass." };
        } catch (err) {
            return { ok: false, error: `Invalid JSON: ${err.message}` };
        }
    }

    const code = extractDaruGearShareCode(raw) || (/^[A-Za-z0-9_-]{3,32}$/.test(raw) ? raw : null);
    if (!code) {
        return { ok: false, error: "Could not find a valid DaruGear share code (expected ?s=XXXXXX)." };
    }

    let playerclass = null;
    let lastError = null;
    if (isLocalLoopbackOrigin()) {
        try {
            const res = await fetch(`/api/darugear/skills?code=${encodeURIComponent(code)}`, { cache: "no-store" });
            const json = await res.json();
            if (res.ok && json?.ok && json.playerclass) {
                playerclass = json.playerclass;
            } else if (json?.error) {
                lastError = json.error;
            }
        } catch (err) {
            lastError = err.message;
        }
    }

    if (!playerclass) {
        try {
            const res = await fetch(
                `https://154smechk6.execute-api.ap-southeast-2.amazonaws.com/default/gear/${encodeURIComponent(code)}`
            );
            if (res.ok) {
                const data = await res.json();
                playerclass = data?.player?.playerclass || null;
            } else {
                lastError = `HTTP ${res.status}`;
            }
        } catch (err) {
            lastError = lastError || err.message;
        }
    }

    if (!playerclass) {
        return { ok: false, error: lastError || `Could not load skills for DaruGear code "${code}".` };
    }

    const skillBuild = extractSkillBuildFromDaruGearPlayerClass(playerclass);
    if (!skillBuild) {
        return { ok: false, error: `DaruGear build "${code}" did not contain selected skillsets.` };
    }

    return {
        ok: true,
        shareCode: code,
        skillBuild,
        className: skillBuild.className,
    };
}

/**
 * Parse any supported paste/file input into a normalized CharacterStats object.
 */
export function parseImportPayload(rawInput) {
    if (rawInput && typeof rawInput === "object") {
        if (rawInput.player?.unitInfo) {
            return { ok: true, character: fromInGameUnitInfo(rawInput), warnings: [] };
        }
        if (Array.isArray(rawInput.slots) && rawInput.player && !rawInput.offense) {
            return fromDaruGearExport(buildDaruGearExportFromApiPayload(rawInput, rawInput.hash || null));
        }
        return fromDaruGearExport(rawInput);
    }

    const text = String(rawInput || "").trim();
    if (!text) {
        return { ok: false, error: "Empty input. Paste DaruGear bookmarklet JSON or a saved build JSON." };
    }

    // 1. Check if user pasted a raw DaruGear URL instead of bookmarklet JSON
    if (/^https?:\/\/(www\.)?darugear\.com/i.test(text)) {
        return {
            ok: false,
            error:
                "You pasted a DaruGear link. Open that link on darugear.com, click the 'Export to Damage Sim' bookmarklet, then paste the copied JSON here.",
        };
    }

    // 2. Check if user pasted raw skill_dump_*.txt (Lua table with metaJson = "...")
    const luaMetaMatch = text.match(/metaJson\s*=\s*"((?:\\.|[^"\\])*)"/);
    if (luaMetaMatch) {
        try {
            const unescaped = JSON.parse('"' + luaMetaMatch[1] + '"');
            const meta = JSON.parse(unescaped);
            if (meta?.player?.unitInfo) {
                return { ok: true, character: fromInGameUnitInfo(meta), warnings: [] };
            }
        } catch (err) {
            return { ok: false, error: "Failed to parse skill_dump metaJson: " + err.message };
        }
    }

    // 3. Standard JSON (DaruGear bookmarklet output or saved CharacterStats JSON)
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object") {
            return { ok: false, error: "JSON must be an object." };
        }
        if (parsed.player?.unitInfo) {
            return { ok: true, character: fromInGameUnitInfo(parsed), warnings: [] };
        }
        if (parsed.offense || parsed.defense) {
            return fromDaruGearExport(parsed);
        }
        return {
            ok: false,
            error: "Unrecognized JSON format. Expected offense/defense fields from the DaruGear bookmarklet.",
        };
    } catch (err) {
        return { ok: false, error: "Invalid JSON: " + err.message };
    }
}

/**
 * Readable source of the DaruGear bookmarklet scraper.
 * Runs directly on https://darugear.com/ — cycles through the 4 stat tabs
 * (Core, Attack, Defense, Regen/Misc), extracts every stat, restores the original
 * tab, and copies a clean versioned JSON object to the clipboard.
 */
export function getDaruGearBookmarkletSource() {
    return `void((async function(){
  if(!location.hostname.includes('darugear.com')){
    alert('Run this bookmarklet on https://darugear.com/');
    return;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const parseNum = s => {
    if(!s) return 0;
    const m = String(s).replace(/,/g,'').match(/-?\\d+(?:\\.\\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  };
  const readTablePairs = root => {
    const map = {};
    if(!root) return map;
    root.querySelectorAll('tr').forEach(tr => {
      const cells = Array.from(tr.querySelectorAll('td,th')).map(c => (c.textContent || '').trim());
      for(let i = 0; i + 1 < cells.length; i += 2){
        const rawKey = cells[i].replace(/:\\s*$/, '').trim().toLowerCase();
        if(rawKey && !(rawKey in map)) map[rawKey] = cells[i + 1];
      }
    });
    return map;
  };

  const panel = document.querySelector('app-player-stats') || document.body;
  const tabs = Array.from(panel.querySelectorAll('[role="tab"]'));
  const origIdx = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');

  const topMap = readTablePairs(panel);
  const tabMaps = {};
  for(let i = 0; i < tabs.length; i++){
    const tName = (tabs[i].textContent || '').trim().toLowerCase();
    tabs[i].click();
    await wait(620);
    const activeBody = panel.querySelector('.mat-mdc-tab-body-active, .mat-tab-body-active') || panel;
    tabMaps[tName] = readTablePairs(activeBody);
  }
  if(origIdx >= 0 && tabs[origIdx]) tabs[origIdx].click();

  const pickTab = key => {
    for(const [k, v] of Object.entries(tabMaps)) if(k.includes(key)) return v;
    return {};
  };
  const core = pickTab('core');
  const atk = pickTab('attack');
  const def = pickTab('defense');
  const regen = pickTab('regen');

  const n = (map, label, fb = 0) => {
    const v = map[label.toLowerCase()];
    return v !== undefined ? parseNum(v) : fb;
  };

  const params = new URLSearchParams(location.search);
  const shareCode = params.get('s') || null;
  const className = (core['class'] || '').trim() || null;
  const name = className
    ? (shareCode ? (className + ' (' + shareCode + ')') : className)
    : (shareCode ? ('DaruGear (' + shareCode + ')') : 'DaruGear Build');

  const collectNgComponents = () => {
    const visited = new WeakSet();
    const seenObj = new WeakSet();
    const comps = [];
    const walk = (arr, depth) => {
      if(!Array.isArray(arr) || visited.has(arr) || depth > 16) return;
      visited.add(arr);
      for(let i = 0; i < arr.length; i++){
        const v = arr[i];
        if(!v) continue;
        if(Array.isArray(v)){
          walk(v, depth + 1);
        } else if(typeof v === 'object' && !(v instanceof Node) && !(v instanceof Window)){
          if(!seenObj.has(v)){
            seenObj.add(v);
            if(Array.isArray(v.slots) || v.calculated_stats || (v.player && typeof v.player === 'object') || (v.playerStatsService && v.playerStatsService.calculationService)){
              comps.push(v);
            }
          }
        }
      }
    };
    const allEls = document.querySelectorAll('*');
    for(let i = 0; i < allEls.length; i++){
      const ctx = allEls[i].__ngContext__;
      if(Array.isArray(ctx)) walk(ctx, 0);
    }
    return comps;
  };

  const ngComps = collectNgComponents();
  let slotsComp = ngComps.find(c => Array.isArray(c.slots) && c.slots.length >= 10) || null;
  const statsComp = ngComps.find(c => c.calculated_stats && typeof c.calculated_stats === 'object') || null;
  const svcComp = ngComps.find(c => c.playerStatsService && c.playerStatsService.calculationService) || null;
  let playerObj = (ngComps.find(c => c.player && c.player.playerclass) || ngComps.find(c => c.player && (Array.isArray(c.player.equipment_buff) || Array.isArray(c.player.buff))) || {}).player || null;

  let apiFallback = null;
  if((!slotsComp || !playerObj) && shareCode){
    try {
      const apiRes = await fetch('https://154smechk6.execute-api.ap-southeast-2.amazonaws.com/default/gear/' + encodeURIComponent(shareCode));
      if(apiRes.ok) apiFallback = await apiRes.json();
    } catch (e) {}
  }
  if(!slotsComp && apiFallback && Array.isArray(apiFallback.slots)){
    slotsComp = { slots: apiFallback.slots };
  }
  if(!playerObj && apiFallback && apiFallback.player){
    playerObj = apiFallback.player;
  }

  const readActiveBuffs = async () => {
    const buffsEl = document.querySelector('app-player-buffs');
    const seen = new Set();
    const list = [];
    let titleName = null;
    const pushBuff = (b) => {
      if(!b || !b.name) return;
      const key = (b.id || '') + ':' + b.name.toLowerCase();
      if(seen.has(key)) return;
      seen.add(key);
      list.push(b);
    };
    try {
      if(playerObj){
        const p = playerObj;
        if(p.title && p.title.name) titleName = String(p.title.name).trim();
        const titleBuffId = p.title ? (p.title.buff_id || p.title.id || null) : null;
        const optIds = new Set((Array.isArray(p.buff) ? p.buff : []).map(b => String(b.id || b.buff_id || b.name)));
        const all = [].concat(Array.isArray(p.buff) ? p.buff : [], Array.isArray(p.equipment_buff) ? p.equipment_buff : []);
        for(const b of all){
          if(!b || !b.name) continue;
          const rawId = b.buff_id || b.id || null;
          const isTitle = Boolean(titleName && b.name === titleName) || Boolean(titleBuffId && rawId === titleBuffId);
          const isOptional = Boolean(b.is_optional) || optIds.has(String(b.id || b.buff_id || b.name));
          const entry = {
            id: rawId ? (Number(rawId) || null) : null,
            name: String(b.name).trim(),
            isOptional: isTitle ? false : isOptional
          };
          if(isTitle) entry.isTitle = true;
          pushBuff(entry);
        }
      }
    } catch (e) {}

    if(!titleName){
      const statLabels = Array.from(panel.querySelectorAll('span.stat-label'));
      const tLbl = statLabels.find(s => (s.textContent || '').trim().toLowerCase() === 'title:');
      const tVal = tLbl && tLbl.parentElement && tLbl.parentElement.querySelector('.mat-mdc-select-min-line, .mat-select-min-line');
      if(tVal && tVal.textContent.trim() && tVal.textContent.trim().toLowerCase() !== 'none'){
        titleName = tVal.textContent.trim();
      }
    }

    if(list.length === 0 && buffsEl){
      const spans = Array.from(buffsEl.querySelectorAll(':scope > div > span:not([mattooltip="Add Buff"])'));
      for(const sp of spans){
        if(sp.querySelector('button.add_buff')) continue;
        sp.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        sp.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await wait(45);
        const tip = buffsEl.querySelector('app-buff-tooltip') || document.querySelector('app-buff-tooltip');
        const nm = tip && tip.querySelector('#slot-name, mat-card-title');
        const idEl = tip && tip.querySelector('i.stat-label');
        const idMatch = idEl ? (idEl.textContent || '').match(/(\\d+)/) : null;
        const isOpt = Boolean(sp.querySelector('img[src*="appoint_icon"]'));
        if(nm && nm.textContent.trim()){
          const bName = nm.textContent.trim();
          const isTitle = Boolean(titleName && bName.toLowerCase() === titleName.toLowerCase());
          const entry = {
            id: idMatch ? parseInt(idMatch[1], 10) : null,
            name: bName,
            isOptional: isTitle ? false : isOpt
          };
          if(isTitle) entry.isTitle = true;
          pushBuff(entry);
        }
        sp.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        sp.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      }
    }

    list.sort((a, b) => (b.isOptional ? 2 : b.isTitle ? 1 : 0) - (a.isOptional ? 2 : a.isTitle ? 1 : 0));
    return { buffs: list, title: titleName };
  };

  const dgActive = await readActiveBuffs();

  const readGearAndPassives = () => {
    let attackSpeedRating = n(core, 'Attack Speed', 0);
    let hasShield = false;
    let shieldPdef = 0;
    let equipmentType = null;
    const passives = [];
    const equipment = [];
    let skillBuild = null;
    try {
      if(statsComp && statsComp.calculated_stats && Number.isFinite(Number(statsComp.calculated_stats.attackspeed))){
        attackSpeedRating = Number(statsComp.calculated_stats.attackspeed);
      }

      const slotsArr = Array.isArray(slotsComp && slotsComp.slots) ? slotsComp.slots : [];
      slotsArr.forEach(s => {
        if(!s || !s.item || !s.item.equipment) return;
        const it = s.item;
        const eq = it.equipment;
        const gr = it.grade || {};
        const cleanIcon = eq.img ? String(eq.img).replace(/\\\\/g, '/').replace(/^\\//, '') : null;
        const lf = it.lunafrost && (it.lunafrost.name || it.lunafrost.effect_text)
          ? { name: String(it.lunafrost.name || '').trim(), text: String(it.lunafrost.effect_text || '').replace(/\\s+/g, ' ').trim() }
          : null;
        const gems = Array.isArray(it.lunagem)
          ? it.lunagem.filter(g => g && (g.name || g.effect_text)).map(g => ({
              name: String(g.name || '').trim(),
              text: String(g.effect_text || '').replace(/\\s+/g, ' ').trim()
            }))
          : [];
        const synPct = Number.isFinite(Number(eq.synth_percentage)) ? Number(eq.synth_percentage) : 100;
        const synList = Array.isArray(it.sythisis_stat) ? it.sythisis_stat : [];
        const synthStats = [];
        synList.forEach(st => {
          if(!st || !st.display_text) return;
          const minV = Number(st.minvalue) || 0;
          const maxV = Number(st.maxvalue) || minV;
          const rawV = minV + (maxV - minV) * (synPct / 100);
          const dt = String(st.display_text).split('\\n')[0].replace(/[+%]+$/, '').trim();
          const isPctStat = /rate|bonus|damage|speed|time|reduction|parry|block|evasion|healing|accuracy|backstab/i.test(dt);
          let scaledV = rawV;
          if(Math.abs(rawV) >= 10000 && !/health|mana/i.test(dt)) scaledV = rawV / 1000;
          else if(isPctStat && Math.abs(rawV) > 20) scaledV = rawV / 10;
          const fmtV = Math.abs(scaledV - Math.round(scaledV)) < 0.05 ? String(Math.round(scaledV)) : scaledV.toFixed(1);
          const sign = scaledV >= 0 ? '+' : '';
          synthStats.push(dt + ' ' + sign + fmtV + (isPctStat && !/healing power/i.test(dt) ? '%' : ''));
        });
        const eqEntry = {
          slotId: Number(s.id),
          slotName: String(s.name || ('Slot ' + s.id)).trim(),
          name: String(eq.name || '').trim(),
          type: String(eq.type || '').trim(),
          icon: cleanIcon,
          gradeId: Number(gr.id) || 0,
          gradeName: String(gr.name || '').trim(),
          gradeColor: gr.colour ? String(gr.colour).trim() : null
        };
        if(Number(it.ptemper) > 100) eqEntry.ptemper = Number(it.ptemper);
        if(Number(it.mtemper) > 100) eqEntry.mtemper = Number(it.mtemper);
        if(lf) eqEntry.lunafrost = lf;
        if(gems.length > 0) eqEntry.lunagems = gems;
        if(synthStats.length > 0) eqEntry.synthStats = synthStats;
        equipment.push(eqEntry);
      });

      const mhSlot = slotsArr.find(s => s && s.id === 15);
      const ohSlot = slotsArr.find(s => s && s.id === 16);
      const mhType = mhSlot && mhSlot.item && mhSlot.item.equipment && mhSlot.item.equipment.type ? String(mhSlot.item.equipment.type) : '';
      const ohItem = ohSlot && ohSlot.item ? ohSlot.item : null;
      const ohType = ohItem && ohItem.equipment && ohItem.equipment.type ? String(ohItem.equipment.type) : '';

      if(ohType === 'Shield' || ohType === 'Magic Shield'){
        hasShield = true;
        equipmentType = ohType === 'Magic Shield' ? 'magic_shield' : 'shield';
        if(ohType === 'Shield'){
          try {
            const calcSvc = svcComp && svcComp.playerStatsService && svcComp.playerStatsService.calculationService;
            if(calcSvc && typeof calcSvc.calculateItemMain === 'function'){
              shieldPdef = Number(calcSvc.calculateItemMain(ohItem, 'pdef')) || 0;
            }
          } catch (e) {}
          if(!shieldPdef && ohItem.equipment && ohItem.grade){
            const pt = (!ohItem.ptemper || ohItem.ptemper < 100 || ohItem.ptemper > 115) ? 100 : Number(ohItem.ptemper);
            shieldPdef = Math.floor(((Math.pow(Number(ohItem.equipment.level) || 50, 1.1) * 85 + 100) * ((Number(ohItem.grade.main_mod) || 100) / 100) * 0.25) * (pt / 100));
          }
        }
      } else if(ohItem && ohItem.equipment){
        equipmentType = 'dual_wield';
      } else if(mhType && ['Greatclub','Staff','Longspear','Nodachi','Greatsword','GreatAxe','Warclub','Scythe'].includes(mhType)){
        equipmentType = 'two_hand';
      }

      const pc = playerObj && playerObj.playerclass;
      const TREE_ID_MAP = {1:'battlerage',2:'witchcraft',3:'defense',4:'auramancy',5:'occultism',6:'archery',7:'sorcery',8:'shadowplay',9:'songcraft',10:'vitalism'};
      if(pc){
        const sbTrees = [];
        const sbActives = [];
        const sbPassives = [];
        let sbHatred = null;
        ['skill1','skill2','skill3'].forEach(k => {
          const sk = pc[k];
          if(!sk) return;
          const slug = TREE_ID_MAP[Number(sk.treeid || sk.id)] || null;
          if(slug && !sbTrees.includes(slug)) sbTrees.push(slug);
          if(slug && sk.is_hatred) sbHatred = slug;
          const acts = Array.isArray(sk.Actives) ? sk.Actives : [];
          acts.forEach(a => {
            if(a && a.selected === true && (a.skill_name || a.name) && slug){
              const nm = String(a.skill_name || a.name).trim();
              const key = slug + '_' + nm.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
              if(!sbActives.includes(key)) sbActives.push(key);
            }
          });
          const arr = Array.isArray(sk.Passive) ? sk.Passive : [];
          arr.forEach(p => {
            if(p && p.selected === true && p.name){
              const pn = String(p.name).trim();
              if(!passives.includes(pn)) passives.push(pn);
              if(!sbPassives.includes(pn)) sbPassives.push(pn);
            }
          });
        });
        if(sbTrees.length > 0){
          skillBuild = {
            trees: sbTrees,
            activeSkills: sbActives,
            passives: sbPassives,
            bakedPassives: sbPassives.slice(),
            hatredTree: sbHatred,
            className: pc.class_name || pc.name || className || null
          };
        }
      }
    } catch (e) {}

    const dualWieldRangedParry = equipmentType === 'dual_wield' && passives.some(p => p.toLowerCase() === 'dual-wield proficiency');
    return { attackSpeedRating, hasShield, shieldPdef, equipmentType, passives, skillBuild, equipment, dualWieldRangedParry };
  };

  const dgGear = readGearAndPassives();

  const out = {
    schemaVersion: 1,
    source: 'darugear',
    metadata: {
      source: 'darugear',
      darugearUrl: location.href,
      shareCode,
      className,
      title: dgActive.title,
      equipmentType: dgGear.equipmentType,
      gearScore: n(topMap, 'Equipment Points'),
      darugearBuffs: dgActive.buffs,
      passives: dgGear.passives,
      importedAt: new Date().toISOString()
    },
    shareUrl: location.href,
    darugearUrl: location.href,
    shareCode,
    className,
    title: dgActive.title,
    equipmentType: dgGear.equipmentType,
    darugearBuffs: dgActive.buffs,
    passives: dgGear.passives,
    ...(dgGear.skillBuild ? { skillBuild: dgGear.skillBuild } : {}),
    equipment: dgGear.equipment,
    name,
    level: 55,
    gearScore: n(topMap, 'Equipment Points'),
    maxHealth: n(topMap, 'Health', 20000),
    maxMana: n(topMap, 'Mana', 10000),
    attributes: {
      str: n(core, 'Strength'),
      int: n(core, 'Intelligence'),
      agi: n(core, 'Agility'),
      spi: n(core, 'Spirit'),
      sta: n(core, 'Stamina')
    },
    offense: {
      meleeAttack: n(core, 'Melee Attack'),
      rangedAttack: n(core, 'Ranged Attack'),
      magicAttack: n(core, 'Magic Attack'),
      healingPower: n(core, 'Healing Power'),
      meleeAccuracyPct: n(atk, 'Melee Accuracy', 100),
      rangedAccuracyPct: n(atk, 'Ranged Accuracy', 100),
      magicAccuracyPct: n(atk, 'Magic Accuracy', 100),
      meleeCritRatePct: n(atk, 'Melee Critical Rate'),
      rangedCritRatePct: n(atk, 'Ranged Critical Rate'),
      magicCritRatePct: n(atk, 'Magic Critical Rate'),
      healCritRatePct: n(atk, 'Critical Heal Rate'),
      meleeCritBonusPct: n(atk, 'Melee Critical Bonus', 50),
      rangedCritBonusPct: n(atk, 'Ranged Critical Bonus', 50),
      magicCritBonusPct: n(atk, 'Magic Critical Bonus', 50),
      healCritBonusPct: n(atk, 'Critical Heal Bonus', 50),
      meleeSkillDamagePct: n(atk, 'Melee Skill Damage'),
      rangedSkillDamagePct: n(atk, 'Ranged Skill Damage'),
      magicSkillDamagePct: n(atk, 'Magic Skill Damage'),
      healingPct: n(atk, 'Healing'),
      backstabMeleeDamagePct: n(atk, 'Backstab Melee Damage'),
      backstabRangedDamagePct: n(atk, 'Backstab Ranged Damage'),
      backstabMagicDamagePct: n(atk, 'Backstab Magic Damage'),
      focus: n(atk, 'Focus'),
      shieldDefPenRatePct: n(atk, 'Shield Defense Penetration Rate'),
      shieldDefPenPct: n(atk, 'Shield Defense Penetration'),
      defensePenetration: n(atk, 'Defense Penetration'),
      magicDefensePenetration: n(atk, 'Magic Defense Penetration'),
      attackSpeed: dgGear.attackSpeedRating,
      castTimePct: n(core, 'Cast Time', 100)
    },
    defense: {
      physicalDefense: n(core, 'Physical Defense'),
      magicDefense: n(core, 'Magic Defense'),
      shieldPhysicalDefense: dgGear.shieldPdef,
      hasShield: dgGear.hasShield,
      dualWieldRangedParry: dgGear.dualWieldRangedParry,
      parryPct: n(def, 'Parry Rate'),
      blockPct: n(def, 'Shield Block Rate'),
      evasionPct: n(def, 'Evasion'),
      resilience: n(def, 'Resilience'),
      toughness: n(def, 'Toughness'),
      receivedMeleeDrPct: n(def, 'Melee Damage Reduction'),
      receivedRangedDrPct: n(def, 'Ranged Damage Reduction'),
      receivedMagicDrPct: n(def, 'Magic Damage Reduction'),
      fixedMeleeDr: n(def, 'Fixed Melee Damage Reduction'),
      fixedRangedDr: n(def, 'Fixed Ranged Damage Reduction'),
      fixedMagicDr: n(def, 'Fixed Magic Damage Reduction'),
      receivedHealingPct: n(regen, 'Received Healing')
    }
  };

  const jsonStr = JSON.stringify(out, null, 2);
  try {
    await navigator.clipboard.writeText(jsonStr);
    const toast = document.createElement('div');
    toast.textContent = 'Copied ' + name + ' (' + dgGear.equipment.length + ' gear, ' + dgActive.buffs.length + ' buffs) for Damage Sim!';
    Object.assign(toast.style, {
      position:'fixed', top:'16px', right:'16px', zIndex:999999,
      background:'#10b981', color:'#06281e', fontWeight:'700',
      padding:'12px 18px', borderRadius:'8px', boxShadow:'0 8px 24px rgba(0,0,0,0.4)',
      fontFamily:'system-ui,sans-serif', fontSize:'14px'
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  } catch (e) {
    prompt('Copy this JSON into Damage Sim:', jsonStr);
  }
})());`;
}

export function getDaruGearBookmarkletHref() {
    const src = getDaruGearBookmarkletSource()
        .replace(/\s+/g, " ")
        .trim();
    return "javascript:" + encodeURIComponent(src);
}
