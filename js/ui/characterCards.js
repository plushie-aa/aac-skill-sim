/**
 * Character Cards (Build A, Build B, Target / Aggressor), Post-Buff Stat Panels,
 * Equipped Gear Inspector, and Build A vs. B Live Diff Strip.
 */

import {
    ARMOR_TYPES,
    BUILD_CATEGORIES,
    COMBAT_MODIFIERS,
    CONSUMABLE_SLOTS,
    applyModifiers,
    applyOverrides,
    computeCharacterGearBuffSummaries,
    computeEffectiveStats,
    computeGearItemGrantedStats,
    defenseMitigationPct,
    ensureCharacterRawDaruGear,
    estimateBuildCost,
    getGearCatalog,
    getTotalPointsSpent,
    inferBuildArmorType,
    inferBuildCategory,
    normalizeEconomyPriceBook,
    parseModifierToken,
    resilienceCritBonusReductionPct,
    resilienceCritRateReductionPct,
    resolveClassName,
    toughnessMitigationPct,
} from "../engine/index.js";
import { normalizeBuildMetadata, normalizeEquipmentList } from "../adapters/darugear.js";
import {
    applyCategoryDefaultLoadoutToSlot,
    cap,
    cloneBuildSlot,
    escHtml,
    fmtDec,
    fmtInt,
    getAllBuildCategories,
    getEffectiveDefenderDisableAvoidance,
    getEquippedWeaponProcIds,
    getSlotChar,
    getSlotChipTokens,
    getSlotModifiers,
    renderGradedGearIconHtml,
    renderItemGrantedStatsHtml,
    resolveGearGradeInfo,
    sanitizeHexColor,
    sanitizeSafeDaruGearUrl,
    sanitizeSafeIconUrl,
    saveCustomBuffLoadouts,
    setSlotModifiersFromTokens,
    showToast,
    slotUsesDefenseFields,
    slugifyBuildId,
    state,
    swapBuildSlots,
    switchAppMode,
    ui,
} from "./state.js";
import {
    applySavedBuildToSlot,
    computeSlotCharacterFingerprint,
    createBlankBuildForSlot,
    deleteSavedBuildFromStore,
    downloadSlotBuildJson,
    isSlotDirty,
    resetSlotToSaved,
    saveBuildToStore,
    serializeSlotBuild,
} from "./buildStore.js";
import { loadEconomyPriceBookFromStorage } from "./economyView.js";
import {
    deleteCustomBuffById,
    handleFetchBuffById,
    openBuffPullModal,
    openImportModal,
} from "./modals.js";

// ============================================================================
// Field & Formatting Metadata
// ============================================================================
const OFFENSE_FIELDS_MAIN = [
    ["meleeAttack", "Melee Atk"],
    ["rangedAttack", "Ranged Atk"],
    ["magicAttack", "Magic Atk"],
    ["healingPower", "Heal Power"],
    ["meleeCritRatePct", "Melee Crit %"],
    ["meleeCritBonusPct", "Melee Crit Dmg%"],
    ["rangedCritRatePct", "Ranged Crit %"],
    ["rangedCritBonusPct", "Ranged Crit Dmg%"],
    ["magicCritRatePct", "Magic Crit %"],
    ["magicCritBonusPct", "Magic Crit Dmg%"],
    ["healCritRatePct", "Heal Crit %"],
    ["healCritBonusPct", "Heal Crit Dmg%"],
    ["defensePenetration", "Def Pen"],
    ["magicDefensePenetration", "Magic Def Pen"],
    ["meleeSkillDamagePct", "Melee Skill %"],
    ["rangedSkillDamagePct", "Ranged Skill %"],
    ["magicSkillDamagePct", "Magic Skill %"],
    ["healingPct", "Healing %"],
    ["focus", "Focus"],
    ["attackSpeed", "Attack Spd"],
    ["castTimePct", "Cast Time %"],
    ["meleeAccuracyPct", "Melee Acc %"],
    ["rangedAccuracyPct", "Ranged Acc %"],
    ["magicAccuracyPct", "Magic Acc %"],
];

const OFFENSE_FIELDS_EXTRA = [
    ["shieldDefPenRatePct", "Shield Pen Rate%"],
    ["shieldDefPenPct", "Shield Pen %"],
    ["backstabMeleeDamagePct", "Backstab Melee%"],
    ["backstabRangedDamagePct", "Backstab Rng%"],
    ["backstabMagicDamagePct", "Backstab Mag%"],
];

const DEFENSE_FIELDS_MAIN = [
    ["physicalDefense", "Physical Def"],
    ["magicDefense", "Magic Def"],
    ["toughness", "Toughness"],
    ["resilience", "Resilience"],
    ["evasionPct", "Evasion %"],
    ["parryPct", "Parry %"],
    ["blockPct", "Block %"],
    ["shieldPhysicalDefense", "Shield PDef"],
    ["receivedMeleeDrPct", "Melee DR %"],
    ["receivedRangedDrPct", "Ranged DR %"],
    ["receivedMagicDrPct", "Magic DR %"],
    ["receivedHealingPct", "Recv Heal %"],
];

const DEFENSE_FIELDS_EXTRA = [
    ["fixedMeleeDr", "Fixed Melee DR"],
    ["fixedRangedDr", "Fixed Rng DR"],
    ["fixedMagicDr", "Fixed Magic DR"],
    ["rangedParryPct", "Ranged Parry %"],
];

const BUFFED_STAT_DEFS = [
    { group: "core", section: "root", key: "maxHealth", label: "Max HP", fmt: "int" },
    { group: "offense", section: "offense", key: "meleeAttack", label: "Melee Atk", fmt: "num" },
    { group: "offense", section: "offense", key: "rangedAttack", label: "Ranged Atk", fmt: "num" },
    { group: "offense", section: "offense", key: "magicAttack", label: "Magic Atk", fmt: "num" },
    { group: "offense", section: "offense", key: "healingPower", label: "Heal Power", fmt: "num" },
    { group: "offense", section: "offense", key: "meleeCritRatePct", label: "Melee Crit", fmt: "pct" },
    { group: "offense", section: "offense", key: "meleeCritBonusPct", label: "Melee Crit Dmg", fmt: "pct" },
    { group: "offense", section: "offense", key: "rangedCritRatePct", label: "Ranged Crit", fmt: "pct" },
    { group: "offense", section: "offense", key: "rangedCritBonusPct", label: "Ranged Crit Dmg", fmt: "pct" },
    { group: "offense", section: "offense", key: "magicCritRatePct", label: "Magic Crit", fmt: "pct" },
    { group: "offense", section: "offense", key: "magicCritBonusPct", label: "Magic Crit Dmg", fmt: "pct" },
    { group: "offense", section: "offense", key: "healCritRatePct", label: "Heal Crit", fmt: "pct" },
    { group: "offense", section: "offense", key: "healCritBonusPct", label: "Heal Crit Dmg", fmt: "pct" },
    { group: "offense", section: "offense", key: "defensePenetration", label: "Def Pen", fmt: "int" },
    { group: "offense", section: "offense", key: "magicDefensePenetration", label: "Magic Def Pen", fmt: "int" },
    { group: "offense", section: "offense", key: "meleeSkillDamagePct", label: "Melee Skill", fmt: "pct" },
    { group: "offense", section: "offense", key: "rangedSkillDamagePct", label: "Ranged Skill", fmt: "pct" },
    { group: "offense", section: "offense", key: "magicSkillDamagePct", label: "Magic Skill", fmt: "pct" },
    { group: "offense", section: "offense", key: "healingPct", label: "Healing %", fmt: "pct" },
    { group: "offense", section: "offense", key: "focus", label: "Focus", fmt: "int" },
    { group: "offense", section: "offense", key: "attackSpeed", label: "Attack Spd", fmt: "int" },
    { group: "offense", section: "offense", key: "castTimePct", label: "Cast Time", fmt: "pct" },
    { group: "offense", section: "offense", key: "shieldDefPenRatePct", label: "Shield Pen Rate", fmt: "pct" },
    { group: "offense", section: "offense", key: "shieldDefPenPct", label: "Shield Pen %", fmt: "pct" },
    { group: "offense", section: "offense", key: "backstabMeleeDamagePct", label: "Backstab Melee", fmt: "pct" },
    { group: "offense", section: "offense", key: "backstabRangedDamagePct", label: "Backstab Rng", fmt: "pct" },
    { group: "offense", section: "offense", key: "backstabMagicDamagePct", label: "Backstab Mag", fmt: "pct" },
    { group: "offense", section: "offense", key: "meleeAccuracyPct", label: "Melee Acc", fmt: "pct" },
    { group: "offense", section: "offense", key: "rangedAccuracyPct", label: "Ranged Acc", fmt: "pct" },
    { group: "offense", section: "offense", key: "magicAccuracyPct", label: "Magic Acc", fmt: "pct" },
    { group: "defense", section: "defense", key: "physicalDefense", label: "Physical Def", fmt: "int" },
    { group: "defense", section: "defense", key: "magicDefense", label: "Magic Def", fmt: "int" },
    { group: "defense", section: "defense", key: "toughness", label: "Toughness", fmt: "int" },
    { group: "defense", section: "defense", key: "resilience", label: "Resilience", fmt: "int" },
    { group: "defense", section: "defense", key: "evasionPct", label: "Evasion", fmt: "pct" },
    { group: "defense", section: "defense", key: "parryPct", label: "Parry", fmt: "pct" },
    { group: "defense", section: "defense", key: "rangedParryPct", label: "Ranged Parry", fmt: "pct" },
    { group: "defense", section: "defense", key: "blockPct", label: "Block", fmt: "pct" },
    { group: "defense", section: "defense", key: "receivedMeleeDrPct", label: "Melee DR", fmt: "pct" },
    { group: "defense", section: "defense", key: "receivedRangedDrPct", label: "Ranged DR", fmt: "pct" },
    { group: "defense", section: "defense", key: "receivedMagicDrPct", label: "Magic DR", fmt: "pct" },
    { group: "defense", section: "defense", key: "fixedMeleeDr", label: "Fixed Melee DR", fmt: "int" },
    { group: "defense", section: "defense", key: "fixedRangedDr", label: "Fixed Rng DR", fmt: "int" },
    { group: "defense", section: "defense", key: "fixedMagicDr", label: "Fixed Magic DR", fmt: "int" },
    { group: "defense", section: "defense", key: "receivedHealingPct", label: "Recv Heal", fmt: "pct" },
];

const BUFFED_ATTR_DEFS = [
    ["str", "Bonus STR"],
    ["agi", "Bonus AGI"],
    ["sta", "Bonus STA"],
    ["int", "Bonus INT"],
    ["spi", "Bonus SPI"],
];

const EQUIP_TYPE_LABELS = {
    dual_wield: "Dual Wield",
    shield: "Shield",
    magic_shield: "Magic Shield",
    two_hand: "2H Weapon",
};

function fmtCleanNum(n, maxDecimals = 1) {
    const num = Number(n) || 0;
    const roundedInt = Math.round(num);
    if (Math.abs(num - roundedInt) < 0.05) {
        return roundedInt.toLocaleString();
    }
    return num.toLocaleString(undefined, {
        minimumFractionDigits: maxDecimals,
        maximumFractionDigits: maxDecimals,
    });
}

function fmtBuffedValue(val, fmt) {
    if (fmt === "int") return fmtInt(val);
    if (fmt === "pct") return `${fmtCleanNum(val, 1)}%`;
    return fmtCleanNum(val, 1);
}

function fmtBuffedDelta(delta, fmt) {
    const sign = delta > 0 ? "+" : "";
    if (fmt === "int") return `${sign}${fmtInt(delta)}`;
    if (fmt === "pct") return `${sign}${fmtCleanNum(delta, 1)}%`;
    return `${sign}${fmtCleanNum(delta, 1)}`;
}

function slotDisplayLabel(slot) {
    if (slot === "defender") {
        return state.mode === "defender" ? "Aggressor" : "Target / Def";
    }
    return `Build ${slot}`;
}

// ============================================================================
// Buffed Stats & Effective Offense / EHP Tiles
// ============================================================================
function buildDefSummaryInnerHtml(baseChar, buffedChar) {
    const bPdef = defenseMitigationPct(baseChar.defense.physicalDefense);
    const ePdef = defenseMitigationPct(buffedChar.defense.physicalDefense);
    const bMdef = defenseMitigationPct(baseChar.defense.magicDefense);
    const eMdef = defenseMitigationPct(buffedChar.defense.magicDefense);
    const bTough = toughnessMitigationPct(baseChar.defense.toughness);
    const eTough = toughnessMitigationPct(buffedChar.defense.toughness);
    const bResCR = resilienceCritRateReductionPct(baseChar.defense.resilience);
    const eResCR = resilienceCritRateReductionPct(buffedChar.defense.resilience);
    const bResCD = resilienceCritBonusReductionPct(baseChar.defense.resilience);
    const eResCD = resilienceCritBonusReductionPct(buffedChar.defense.resilience);

    const fmtPart = (label, eff, base, suffix = "%") => {
        const d = eff - base;
        if (Math.abs(d) >= 0.05) {
            const cls = d > 0 ? "delta-pos" : "delta-neg";
            return `${label} <strong class="${cls}">${fmtDec(eff)}${suffix}</strong> <span class="${cls}">(${d > 0 ? "+" : ""}${fmtDec(d)}${suffix})</span>`;
        }
        return `${label} ${fmtDec(eff)}${suffix}`;
    };

    const resChanged = Math.abs(eResCR - bResCR) >= 0.05 || Math.abs(eResCD - bResCD) >= 0.05;
    const resCls = eResCR >= bResCR ? "delta-pos" : "delta-neg";
    const resStr = resChanged
        ? `Resil <strong class="${resCls}">-${fmtDec(eResCR)}% CR / -${fmtDec(eResCD)}% CD</strong>`
        : `Resil -${fmtDec(eResCR)}% CR / -${fmtDec(eResCD)}% CD`;

    return `${fmtPart("PDef", ePdef, bPdef)} &bull; ${fmtPart("MDef", eMdef, bMdef)} &bull; ${fmtPart("Tough", eTough, bTough)} &bull; ${resStr}`;
}

function buildEffectiveStatsTilesHtml(useDefFields, buffed, opponent, eff, disableAvoidance) {
    if (useDefFields) {
        const eh = eff.defense.ehp;
        const hr = eff.defense.healingReceived;
        return `
        <div class="eff-stats-box">
            <div class="eff-stats-hdr">
                <span>Effective Survivability (EHP)</span>
                <span>vs ${escHtml(opponent.name)}${disableAvoidance ? " · No Avoid" : ""}</span>
            </div>
            <div class="eff-stats-grid">
                <div class="eff-stat-tile eff-highlight" title="Effective HP against ${escHtml(opponent.name)} Physical Melee (Def + Tough + Melee DR + Crit/Resil${disableAvoidance ? "; Avoidance disabled" : " + Evasion/Parry/Block"})">
                    <span class="eff-stat-k">Melee EHP</span>
                    <span class="eff-stat-v">${fmtInt(eh.melee.vsAttackerEhp)}</span>
                    <span class="eff-stat-sub">${fmtDec(eh.melee.vsAttackerDrPct)}% DR &bull; ${fmtDec(eh.melee.vsAttackerCritFactor, 2)}&times; Crit &bull; ${disableAvoidance ? "No Avoid" : `${fmtDec(eh.melee.vsAttackerAvoidancePct)}% Av`}</span>
                </div>
                <div class="eff-stat-tile" title="Effective HP against ${escHtml(opponent.name)} Physical Ranged (Def + Tough + Ranged DR + Crit/Resil${disableAvoidance ? "; Avoidance disabled" : " + Ranged Evasion/Parry/Block"})">
                    <span class="eff-stat-k">Ranged EHP</span>
                    <span class="eff-stat-v">${fmtInt(eh.ranged.vsAttackerEhp)}</span>
                    <span class="eff-stat-sub">${fmtDec(eh.ranged.vsAttackerDrPct)}% DR &bull; ${fmtDec(eh.ranged.vsAttackerCritFactor, 2)}&times; Crit &bull; ${disableAvoidance ? "No Avoid" : `${fmtDec(eh.ranged.vsAttackerAvoidancePct)}% Av`}</span>
                </div>
                <div class="eff-stat-tile" title="Effective HP against ${escHtml(opponent.name)} Magic (MDef + Tough + Magic DR + Crit/Resil; zero avoidance)">
                    <span class="eff-stat-k">Magic EHP</span>
                    <span class="eff-stat-v">${fmtInt(eh.magic.vsAttackerEhp)}</span>
                    <span class="eff-stat-sub">${fmtDec(eh.magic.vsAttackerDrPct)}% DR &bull; ${fmtDec(eh.magic.vsAttackerCritFactor, 2)}&times; Crit</span>
                </div>
                <div class="eff-stat-tile eff-heal" title="Neutral received healing efficiency & Melee EHP restored per 1,000 raw heal (ignores attacker)">
                    <span class="eff-stat-k">Heal Efficiency</span>
                    <span class="eff-stat-v">${fmtDec(hr.healMultiplier, 2)}&times; (${hr.receivedHealingPct >= 0 ? "+" : ""}${fmtDec(hr.receivedHealingPct)}%)</span>
                    <span class="eff-stat-sub">${fmtInt(hr.effectiveHpPer1kHealMelee)} Melee EHP / 1k heal</span>
                </div>
            </div>
        </div>`;
    }

    const eo = eff.offense;
    const cat = inferBuildCategory(buffed);
    const hideOffSpec = Boolean(state.settings?.hideOffSpecTiles);
    const allOffTiles = [
        {
            cats: ["melee", "tank"],
            html: `<div class="eff-stat-tile ${cat === "melee" || cat === "tank" ? "eff-highlight" : ""}" title="Melee Atk × Skill Dmg% × Expected Crit × Accuracy">
                <span class="eff-stat-k">Eff. Melee Atk</span>
                <span class="eff-stat-v">${fmtInt(eo.melee.selfEffectiveAttack)}</span>
                <span class="eff-stat-sub">vs ${escHtml(opponent.name)}: ${fmtInt(eo.melee.vsTargetEffectiveAttack)}</span>
            </div>`,
        },
        {
            cats: ["archer"],
            html: `<div class="eff-stat-tile ${cat === "archer" ? "eff-highlight" : ""}" title="Ranged Atk × Skill Dmg% × Expected Crit × Accuracy">
                <span class="eff-stat-k">Eff. Ranged Atk</span>
                <span class="eff-stat-v">${fmtInt(eo.ranged.selfEffectiveAttack)}</span>
                <span class="eff-stat-sub">vs ${escHtml(opponent.name)}: ${fmtInt(eo.ranged.vsTargetEffectiveAttack)}</span>
            </div>`,
        },
        {
            cats: ["mage", "tank", "healer"],
            html: `<div class="eff-stat-tile ${cat === "mage" ? "eff-highlight" : ""}" title="Magic Atk × Skill Dmg% × Expected Crit × Accuracy">
                <span class="eff-stat-k">Eff. Magic Atk</span>
                <span class="eff-stat-v">${fmtInt(eo.magic.selfEffectiveAttack)}</span>
                <span class="eff-stat-sub">vs ${escHtml(opponent.name)}: ${fmtInt(eo.magic.vsTargetEffectiveAttack)}</span>
            </div>`,
        },
        {
            cats: ["healer"],
            html: `<div class="eff-stat-tile eff-heal ${cat === "healer" ? "eff-highlight" : ""}" title="Healing Power × Outgoing Heal% × Expected Crit Heal">
                <span class="eff-stat-k">Eff. Heal Power</span>
                <span class="eff-stat-v">${fmtInt(eo.healing.selfEffectiveHealingPower)}</span>
                <span class="eff-stat-sub">${fmtInt(eo.healing.castAdjustedHealingPower)} / cast (${fmtDec(eo.healing.castTimePct)}%)</span>
            </div>`,
        },
    ];
    const visibleTiles = hideOffSpec ? allOffTiles.filter((t) => t.cats.includes(cat)) : allOffTiles;
    return `
    <div class="eff-stats-box">
        <div class="eff-stats-hdr">
            <span>Effective Offense &amp; Speed</span>
            <span>GCD ${fmtDec(eo.speed.effectiveGcdSec, 2)}s (${fmtDec(eo.speed.attackSpeedGcdPct, 0)}%)</span>
        </div>
        <div class="eff-stats-grid">
            ${(visibleTiles.length > 0 ? visibleTiles : allOffTiles).map((t) => t.html).join("")}
        </div>
    </div>`;
}

function buildBuffedStatsContent(slotKey, useDefFields) {
    const base = getSlotChar(slotKey);
    const modIds = getSlotModifiers(slotKey);
    const buffed = applyModifiers(base, modIds);
    const view = state.buffedStatsView[slotKey] || "changed";

    const rows = [];
    let changedCount = 0;

    for (const def of BUFFED_STAT_DEFS) {
        const baseVal = def.section === "root" ? Number(base[def.key]) || 0 : Number(base[def.section]?.[def.key]) || 0;
        const effVal = def.section === "root" ? Number(buffed[def.key]) || 0 : Number(buffed[def.section]?.[def.key]) || 0;
        const delta = effVal - baseVal;
        const changed = Math.abs(delta) >= 0.01;
        if (changed) changedCount++;

        const belongsToRole =
            def.group === "core" || (useDefFields ? def.group === "defense" : def.group === "offense");
        if (view === "changed" && !changed) continue;
        if (view === "all" && !belongsToRole && !changed) continue;

        rows.push({
            label: def.label,
            valStr: fmtBuffedValue(effVal, def.fmt),
            deltaStr: changed ? fmtBuffedDelta(delta, def.fmt) : "",
            deltaCls: delta > 0 ? "delta-pos" : delta < 0 ? "delta-neg" : "",
            changed,
        });
    }

    for (const [key, label] of [
        ["pveDamageBonusPct", "PvE Dmg"],
        ["pveReceivedDrPct", "PvE Recv DR"],
    ]) {
        const bVal = Number(base[key]) || 0;
        const eVal = Number(buffed[key]) || 0;
        if (Math.abs(eVal - bVal) >= 0.01 || eVal !== 0) {
            const d = eVal - bVal;
            if (Math.abs(d) >= 0.01) changedCount++;
            rows.push({
                label,
                valStr: `+${fmtCleanNum(eVal, 1)}%`,
                deltaStr: Math.abs(d) >= 0.01 ? fmtBuffedDelta(d, "pct") : "",
                deltaCls: d > 0 ? "delta-pos" : d < 0 ? "delta-neg" : "",
                changed: Math.abs(d) >= 0.01,
            });
        }
    }

    for (const [tree, bonus] of Object.entries(buffed.skillsetDamageBonusPct || {})) {
        if (!bonus) continue;
        changedCount++;
        rows.push({
            label: `${cap(tree)} Dmg`,
            valStr: `+${fmtCleanNum(bonus, 1)}%`,
            deltaStr: `+${fmtCleanNum(bonus, 1)}%`,
            deltaCls: bonus > 0 ? "delta-pos" : "delta-neg",
            changed: true,
        });
    }

    const attrPills = [];
    for (const [ak, lbl] of BUFFED_ATTR_DEFS) {
        const d = (Number(buffed.attributes?.[ak]) || 0) - (Number(base.attributes?.[ak]) || 0);
        if (Math.abs(d) >= 0.01) {
            attrPills.push(`<span class="buffed-attr-pill">${lbl} ${d > 0 ? "+" : ""}${fmtInt(d)}</span>`);
        }
    }

    const defChanged =
        Math.abs((buffed.defense.physicalDefense || 0) - (base.defense.physicalDefense || 0)) >= 0.01 ||
        Math.abs((buffed.defense.magicDefense || 0) - (base.defense.magicDefense || 0)) >= 0.01 ||
        Math.abs((buffed.defense.toughness || 0) - (base.defense.toughness || 0)) >= 0.01 ||
        Math.abs((buffed.defense.resilience || 0) - (base.defense.resilience || 0)) >= 0.01;

    const showMitStrip = useDefFields || defChanged || view === "all";
    const mitStripHtml = showMitStrip
        ? `<div class="buffed-mit-strip">${buildDefSummaryInnerHtml(base, buffed)}</div>`
        : "";

    const isPvE = Boolean(document.getElementById("ctxPvE")?.checked);
    const disableAvoidance = getEffectiveDefenderDisableAvoidance();
    const opponent =
        slotKey === "defender"
            ? applyModifiers(state.buildA, getSlotModifiers("A"))
            : applyModifiers(state.defender, getSlotModifiers("defender"));
    const eff = computeEffectiveStats(buffed, opponent, {}, { isPvE, disableAvoidance });
    const effStatsHtml = buildEffectiveStatsTilesHtml(useDefFields, buffed, opponent, eff, disableAvoidance);

    const attrHtml = attrPills.length > 0 ? `<div class="buffed-attr-row">${attrPills.join("")}</div>` : "";
    const gridHtml =
        rows.length === 0
            ? `<div class="buffed-empty">No buffs or consumables active &mdash; switch to <strong>All</strong> or toggle a buff above to preview post-buff stats.</div>`
            : `<div class="buffed-grid">${rows
                  .map(
                      (r) => `
                <div class="buffed-stat-item ${r.changed ? (r.deltaCls === "delta-neg" ? "is-neg" : "is-changed") : ""}">
                    <span class="buffed-stat-lbl">${escHtml(r.label)}</span>
                    <span class="buffed-stat-val">
                        <strong>${escHtml(r.valStr)}</strong>
                        ${r.deltaStr ? `<span class="buffed-delta ${r.deltaCls}">${escHtml(r.deltaStr)}</span>` : ""}
                    </span>
                </div>`
                  )
                  .join("")}</div>`;

    const badgeHtml =
        changedCount > 0
            ? `<span class="buffed-badge">${changedCount} stat${changedCount === 1 ? "" : "s"} changed</span>`
            : `<span class="buffed-badge muted">Base</span>`;

    return {
        badgeHtml,
        bodyHtml: `${attrHtml}${gridHtml}${mitStripHtml}${effStatsHtml}`,
        effStatsHtml,
        changedCount,
        hasBuffs: modIds.length > 0,
        defSummaryHtml: buildDefSummaryInnerHtml(base, buffed),
    };
}

function buildSummaryActiveBuffsHtml(slotKey) {
    const ch = getSlotChar(slotKey);
    const useDefFields = slotUsesDefenseFields(slotKey);
    const modSet = state.modifiers[slotKey] || new Set();
    const consMap = state.consumables[slotKey] || {};
    const pills = [];

    for (const modId of modSet) {
        const m = COMBAT_MODIFIERS[modId];
        if (!m) continue;
        const shortLabel = m.name.split(" (")[0];
        let extra = "";
        if (Array.isArray(m.ranks) && m.ranks.length > 1) {
            const r = state.modifierRanks[slotKey]?.[m.id] ?? m.defaultRank ?? m.ranks[m.ranks.length - 1].rank;
            extra = ` R${r}`;
        } else if (m.maxStacks && m.maxStacks > 1) {
            const st = state.modifierStacks[slotKey]?.[m.id] || m.defaultStacks || m.maxStacks;
            extra = ` ${st}${m.stackUnit === "s" ? "s" : "x"}`;
        } else if (m.category === "weapon_proc" && m.shortEffect) {
            extra = ` ${m.shortEffect}`;
        }
        const safeIc = sanitizeSafeIconUrl(m.icon);
        const ic = safeIc ? `<img class="chip-icon" src="${escHtml(safeIc)}" alt="" loading="lazy" />` : "";
        const pillCls = m.isDebuff ? "is-debuff" : m.category === "weapon_proc" ? "is-proc" : "";
        pills.push(
            `<span class="summary-buff-pill ${pillCls}" title="${escHtml(m.description || m.name)}">${ic}<span>${escHtml(shortLabel)}${escHtml(extra)}</span><button type="button" class="summary-buff-rm" data-sum-rm-mod="${escHtml(m.id)}" title="Remove ${escHtml(shortLabel)}">&times;</button></span>`
        );
    }

    for (const [consSlot, cid] of Object.entries(consMap)) {
        if (!cid) continue;
        const m = COMBAT_MODIFIERS[cid];
        if (!m) continue;
        const safeIc = sanitizeSafeIconUrl(m.icon);
        const ic = safeIc ? `<img class="chip-icon" src="${escHtml(safeIc)}" alt="" loading="lazy" />` : "";
        pills.push(
            `<span class="summary-buff-pill is-cons" title="${escHtml(m.description || m.name)}">${ic}<span>${escHtml(m.name)}</span><button type="button" class="summary-buff-rm" data-sum-rm-cons="${escHtml(consSlot)}" title="Remove ${escHtml(m.name)}">&times;</button></span>`
        );
    }

    const equippedProcIds = getEquippedWeaponProcIds(ch);
    const roleSide = useDefFields ? "defender" : "attacker";
    const quickProcBtnsHtml = Array.from(equippedProcIds)
        .map((id) => COMBAT_MODIFIERS[id])
        .filter((m) => m && (m.side === roleSide || m.side === "both") && !modSet.has(m.id))
        .map((m) => {
            const shortLabel = m.name.split(" (")[0];
            return `<button type="button" class="sm sum-proc-btn" data-sum-toggle-proc="${escHtml(m.id)}" title="${escHtml(m.description)}">&#9876; ${escHtml(shortLabel)}</button>`;
        })
        .join("");

    return `
        ${pills.length > 0 ? pills.join("") : `<span class="hint-inline">No buffs active</span>`}
        <span class="summary-quick-actions">
            ${quickProcBtnsHtml}
            <button type="button" class="sm" data-goto-tab="buffs">+ Buffs</button>
        </span>
    `;
}

function setCardTab(card, slotKey, nextTab) {
    state.cardTab[slotKey] = nextTab;
    card.querySelectorAll("[data-card-tab]").forEach((b) => {
        b.classList.toggle("active", b.dataset.cardTab === nextTab);
    });
    card.querySelectorAll("[data-card-pane]").forEach((p) => {
        p.classList.toggle("hidden", p.dataset.cardPane !== nextTab);
    });
}

function bindSummaryBuffQuickActions(card, slotKey) {
    card.querySelectorAll("[data-sum-rm-mod]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.modifiers[slotKey].delete(btn.dataset.sumRmMod);
            renderCharacterCards();
            ui.renderSimulation();
        });
    });
    card.querySelectorAll("[data-sum-rm-cons]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const cs = btn.dataset.sumRmCons;
            if (state.consumables[slotKey]) delete state.consumables[slotKey][cs];
            renderCharacterCards();
            ui.renderSimulation();
        });
    });
    card.querySelectorAll("[data-sum-toggle-proc]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.modifiers[slotKey].add(btn.dataset.sumToggleProc);
            renderCharacterCards();
            ui.renderSimulation();
        });
    });
    card.querySelectorAll("[data-goto-tab]").forEach((btn) => {
        btn.addEventListener("click", () => setCardTab(card, slotKey, btn.dataset.gotoTab));
    });
}

export function updateBuffedStatsPanel(slotKey, cascade = true) {
    const card = document.querySelector(`.char-card[data-slot="${slotKey}"]`);
    if (!card) return;
    const useDefFields = slotUsesDefenseFields(slotKey);
    const info = buildBuffedStatsContent(slotKey, useDefFields);

    const defEl = card.querySelector("[data-def-summary]");
    if (defEl) defEl.innerHTML = info.defSummaryHtml;

    const sumEffEl = card.querySelector("[data-summary-eff]");
    if (sumEffEl) sumEffEl.innerHTML = info.effStatsHtml;

    const sumBuffsEl = card.querySelector("[data-summary-buffs]");
    if (sumBuffsEl) {
        sumBuffsEl.innerHTML = buildSummaryActiveBuffsHtml(slotKey);
        bindSummaryBuffQuickActions(card, slotKey);
    }

    const buffCnt =
        (state.modifiers[slotKey]?.size || 0) +
        Object.values(state.consumables[slotKey] || {}).filter(Boolean).length;
    const buffTabCnt = card.querySelector('[data-card-tab-cnt="buffs"]');
    if (buffTabCnt) {
        buffTabCnt.textContent = String(buffCnt);
        buffTabCnt.classList.toggle("hidden", buffCnt === 0);
    }

    const box = card.querySelector(`details[data-buffed-box="${slotKey}"]`);
    if (!box) return;

    const badgeWrap = box.querySelector("[data-buffed-badge]");
    if (badgeWrap) badgeWrap.innerHTML = info.badgeHtml;

    const bodyEl = box.querySelector("[data-buffed-body]");
    if (bodyEl) bodyEl.innerHTML = info.bodyHtml;

    if (state.buffedStatsOpen[slotKey] === null) {
        box.open = info.hasBuffs;
    }

    const curView = state.buffedStatsView[slotKey] || "changed";
    box.querySelectorAll("[data-buffed-view]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.buffedView === curView);
    });

    if (cascade) {
        if (slotKey === "defender") {
            updateBuffedStatsPanel("A", false);
            updateBuffedStatsPanel("B", false);
        } else if (slotKey === "A") {
            updateBuffedStatsPanel("defender", false);
        }
    }
}

// ============================================================================
// Equipped Gear Drawer & Inspector
// ============================================================================
function groupLunagems(gems = []) {
    const map = new Map();
    for (const g of gems || []) {
        const key = `${g.name || ""}|${g.text || ""}`;
        const existing = map.get(key);
        if (existing) existing.count += 1;
        else map.set(key, { name: g.name || "", text: g.text || "", count: 1 });
    }
    return Array.from(map.values());
}

function gearItemFingerprint(item) {
    if (!item) return "";
    return JSON.stringify({
        n: item.name,
        g: item.gradeId,
        pt: item.ptemper || 0,
        mt: item.mtemper || 0,
        lf: item.lunafrost?.name || "",
        gm: (item.lunagems || []).map((x) => x.name),
    });
}

function renderGearSectionHtml(slotKey, ch, otherSlotGearById) {
    const eq = normalizeEquipmentList(ch.equipment);
    if (eq.length === 0) return "";

    const displayOrder = [15, 16, 17, 18, 1, 2, 3, 4, 5, 7, 8, 6, 0, 9, 10, 11, 12, 13, 14, 19];
    const orderIdx = (id) => {
        const i = displayOrder.indexOf(id);
        return i >= 0 ? i : 100 + id;
    };
    const sorted = [...eq].sort((a, b) => orderIdx(a.slotId) - orderIdx(b.slotId));
    const selSlotId = state.selectedGearSlot[slotKey];
    const selectedItem = selSlotId != null ? sorted.find((it) => it.slotId === selSlotId) || null : null;

    const tilesHtml = sorted
        .map((it) => {
            const gemCount = Array.isArray(it.lunagems) ? it.lunagems.length : 0;
            const otherIt = otherSlotGearById ? otherSlotGearById.get(it.slotId) : undefined;
            const differs =
                otherSlotGearById && otherSlotGearById.size > 0
                    ? gearItemFingerprint(it) !== gearItemFingerprint(otherIt)
                    : false;
            const gradeTag = it.gradeName ? `[${it.gradeName}] ` : "";
            const tipParts = [`${it.slotName}: ${gradeTag}${it.name}`];
            if (it.type) tipParts.push(`(${it.type})`);
            if (it.ptemper > 100) tipParts.push(`P-Temper ${it.ptemper}%`);
            if (it.mtemper > 100) tipParts.push(`M-Temper ${it.mtemper}%`);
            if (it.lunafrost?.text) tipParts.push(`Frost: ${it.lunafrost.text}`);
            if (gemCount > 0) tipParts.push(`${gemCount} gem${gemCount === 1 ? "" : "s"}`);
            const shortFallback = (it.slotName || "EQ").slice(0, 2);
            const frameId = Math.max(0, Math.min(12, Number(it.gradeId) || 0));

            const safeColor = sanitizeHexColor(it.gradeColor, "#94a3b8");
            const safeIcon = sanitizeSafeIconUrl(it.icon);
            return `
            <button type="button" class="gear-tile ${selectedItem && selectedItem.slotId === it.slotId ? "selected" : ""}" style="--grade-color:${escHtml(safeColor)}" data-gear-slot="${it.slotId}" title="${escHtml(tipParts.join(" • "))}">
                ${safeIcon ? `<img class="gear-item-img" src="${escHtml(safeIcon)}" alt="${escHtml(it.name)}" loading="lazy" />` : `<span class="gear-tile-fallback">${escHtml(shortFallback)}</span>`}
                <img class="gear-grade-frame" src="assets/grade/grade${frameId}.png" alt="" loading="lazy" />
                ${differs ? `<span class="gear-diff-dot" title="Differs from other build">&Delta;</span>` : ""}
                ${gemCount > 0 ? `<span class="gear-gem-badge">${gemCount}</span>` : ""}
            </button>`;
        })
        .join("");

    let inspectorHtml = "";
    if (selectedItem) {
        const groupedGems = groupLunagems(selectedItem.lunagems);
        const tempers = [];
        if (selectedItem.ptemper > 100) tempers.push(`P-Temper ${selectedItem.ptemper}%`);
        if (selectedItem.mtemper > 100) tempers.push(`M-Temper ${selectedItem.mtemper}%`);
        let rawSlotMatch = null;
        let rawSlotsList = null;
        if (Array.isArray(ch.rawDaruGear?.slots)) {
            rawSlotsList = ch.rawDaruGear.slots;
            rawSlotMatch =
                rawSlotsList.find((s) => Number(s.id) === Number(selectedItem.slotId)) || null;
        } else {
            const cat = getGearCatalog();
            if (cat) {
                const recon = ensureCharacterRawDaruGear(ch, cat);
                rawSlotsList = recon.slots;
                rawSlotMatch =
                    rawSlotsList.find((s) => Number(s.id) === Number(selectedItem.slotId)) || null;
            }
        }
        const inspStatsHtml = rawSlotMatch?.item
            ? renderItemGrantedStatsHtml(
                  computeGearItemGrantedStats(rawSlotMatch, selectedItem.slotId, rawSlotsList, getSlotModifiers(slotKey))
              )
            : "";
        inspectorHtml = `
        <div class="gear-inspector" style="--grade-color:${escHtml(sanitizeHexColor(selectedItem.gradeColor, "#94a3b8"))}">
            <div class="gear-insp-head">
                ${
                    selectedItem.icon
                        ? renderGradedGearIconHtml({
                              icon: selectedItem.icon,
                              name: selectedItem.name,
                              slotName: selectedItem.slotName,
                              gradeId: selectedItem.gradeId,
                              gradeName: selectedItem.gradeName,
                              gradeColor: selectedItem.gradeColor,
                          })
                        : ""
                }
                <div>
                    <div class="gear-insp-title">${selectedItem.gradeName ? `[${escHtml(selectedItem.gradeName)}] ` : ""}${escHtml(selectedItem.name)}</div>
                    <div class="gear-insp-sub">${escHtml(selectedItem.slotName)}${selectedItem.type ? ` &bull; ${escHtml(selectedItem.type)}` : ""}</div>
                </div>
                <button type="button" class="gear-insp-close" data-action="closeGearInsp" title="Close item details">&times;</button>
            </div>
            ${inspStatsHtml}
            ${tempers.length > 0 ? `<div class="gear-insp-tags">${tempers.map((t) => `<span class="gear-insp-tag">${escHtml(t)}</span>`).join("")}</div>` : ""}
            ${selectedItem.lunafrost ? `<div class="gear-insp-frost"><strong>Lunafrost:</strong> ${escHtml(selectedItem.lunafrost.name)}${selectedItem.lunafrost.text ? ` &mdash; ${escHtml(selectedItem.lunafrost.text)}` : ""}</div>` : ""}
            ${
                groupedGems.length > 0
                    ? `<div class="gear-insp-gems">${groupedGems
                          .map(
                              (g) =>
                                  `<div><strong>${g.count}&times;</strong> ${escHtml(g.name)}${g.text ? ` <span class="skill-meta">(${escHtml(g.text)})</span>` : ""}</div>`
                          )
                          .join("")}</div>`
                    : ""
            }
            ${
                Array.isArray(selectedItem.synthStats) && selectedItem.synthStats.length > 0
                    ? `<div class="gear-insp-synth">${selectedItem.synthStats
                          .map((s) => `<span class="gear-insp-synth-pill">${escHtml(s)}</span>`)
                          .join("")}</div>`
                    : ""
            }
        </div>`;
    }

    const gearBuffs = computeCharacterGearBuffSummaries(ch, getGearCatalog(), getSlotModifiers(slotKey));
    const gearBuffsHtml =
        gearBuffs.length > 0
            ? `<div class="card-gear-buffs">
                   <div class="card-gear-buffs-lbl">Active Gear, Set &amp; Grade Buffs</div>
                   <div class="gb-buff-list">
                       ${gearBuffs
                           .map(
                               (b) => `
                           <div class="gb-buff-item cat-${escHtml(b.category)}">
                               <div class="gb-buff-name"${b.gradeColor ? ` style="color:${escHtml(b.gradeColor)}"` : ""}>${escHtml(b.name)}</div>
                               ${b.summary ? `<div class="gb-buff-stats">${escHtml(b.summary)}</div>` : ""}
                           </div>`
                           )
                           .join("")}
                   </div>
               </div>`
            : "";

    return `
    <details class="gear-box" data-gear-box="${slotKey}" ${state.gearOpen[slotKey] ? "open" : ""}>
        <summary>
            <span>Equipped Gear<span class="gear-count-badge">${sorted.length} item${sorted.length === 1 ? "" : "s"}</span></span>
            <span class="hint-inline">Click item for gems &amp; enchants</span>
        </summary>
        <div class="gear-grid">${tilesHtml}</div>
        ${inspectorHtml}
        ${gearBuffsHtml}
    </details>`;
}

// ============================================================================
// Character Card Rendering Sub-Builders
// ============================================================================
function syncCompactBuildsToggleBtn() {
    const btn = document.getElementById("toggleCompactBuildsBtn");
    if (!btn) return;
    btn.innerHTML = state.buildsCollapsed ? "Expand Builds &#9662;" : "Compact Builds &#9652;";
    btn.classList.toggle("primary", Boolean(state.buildsCollapsed));
}

function renderCompactBuildPills(grid, slots) {
    grid.innerHTML = slots
        .map((slot) => {
            const ch = getSlotChar(slot.key);
            const loadedSaved = state.loadedSavedId[slot.key];
            const buffCnt =
                (state.modifiers[slot.key]?.size || 0) +
                Object.values(state.consumables[slot.key] || {}).filter(Boolean).length;
            const optsHtml = state.savedBuilds
                .map((b) => {
                    const gsTag = b.gearScore ? ` (${fmtInt(b.gearScore)} GS)` : "";
                    const sel = loadedSaved === b.savedId ? "selected" : "";
                    return `<option value="${escHtml(b.savedId)}" ${sel}>${escHtml(b.name || b.savedId)}${gsTag}</option>`;
                })
                .join("");
            return `
            <div class="compact-build-pill ${slot.cardCls}" data-compact-slot="${slot.key}">
                <span class="badge ${slot.badgeCls}">${slot.badge}</span>
                <select class="compact-build-select" data-compact-preset="${slot.key}" title="Switch ${slot.badge}">
                    <option value="">${escHtml(ch.name)}${ch.gearScore ? ` (${fmtInt(ch.gearScore)} GS)` : ""}</option>
                    ${optsHtml}
                </select>
                <span class="compact-build-meta">${buffCnt > 0 ? `${buffCnt} buff${buffCnt === 1 ? "" : "s"}` : `${fmtInt(ch.maxHealth)} HP`}</span>
                <button type="button" class="sm" data-compact-expand="${slot.key}" title="Expand builds">Edit</button>
            </div>`;
        })
        .join("");

    grid.querySelectorAll("[data-compact-preset]").forEach((sel) => {
        sel.addEventListener("change", (e) => {
            const slot = sel.dataset.compactPreset;
            const id = e.target.value;
            if (!id) return;
            const found = state.savedBuilds.find((b) => b.savedId === id);
            if (found) applySavedBuildToSlot(slot, found);
            renderCharacterCards();
            ui.renderSimulation();
        });
    });
    grid.querySelectorAll("[data-compact-expand]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.buildsCollapsed = false;
            renderCharacterCards();
        });
    });
}

function buildModifierCatalog() {
    const weaponProcMods = Object.values(COMBAT_MODIFIERS).filter((m) => m.category === "weapon_proc");
    const enlightenmentMods = Object.values(COMBAT_MODIFIERS).filter((m) => m.category === "enlightenment");
    const nonConsMods = Object.values(COMBAT_MODIFIERS).filter(
        (m) => m.category !== "consumable" && m.category !== "weapon_proc" && m.category !== "enlightenment"
    );
    const consumablesBySlot = {};
    for (const cs of CONSUMABLE_SLOTS) {
        consumablesBySlot[cs.id] = Object.values(COMBAT_MODIFIERS).filter(
            (m) => m.category === "consumable" && m.slot === cs.id
        );
    }
    return {
        attackerProcs: weaponProcMods.filter((m) => m.side === "attacker" || m.side === "both"),
        defenderProcs: weaponProcMods.filter((m) => m.side === "defender"),
        enlightenmentMods,
        offensiveBuffs: nonConsMods.filter((m) => !m.isDebuff && (m.side === "attacker" || m.side === "both")),
        defensiveBuffs: nonConsMods.filter((m) => !m.isDebuff && m.side === "defender"),
        offensiveDebuffs: nonConsMods.filter((m) => m.isDebuff && (m.side === "attacker" || m.side === "both")),
        defensiveDebuffs: nonConsMods.filter((m) => m.isDebuff && m.side === "defender"),
        consumablesBySlot,
    };
}

function renderModChipHtml(m, slotKey, modSet, equippedProcIds = null) {
    const isActive = modSet.has(m.id);
    const isRanked = Array.isArray(m.ranks) && m.ranks.length > 1;
    const isStackable = !isRanked && Boolean(m.maxStacks && m.maxStacks > 1);
    const isProc = m.category === "weapon_proc";
    const isEnl = m.category === "enlightenment";
    const isEquippedProc = isProc && Boolean(equippedProcIds && equippedProcIds.has(m.id));
    const shortLabel = m.name.split(" (")[0];
    const safeIcon = sanitizeSafeIconUrl(m.icon);
    const iconHtml = safeIcon ? `<img class="chip-icon" src="${escHtml(safeIcon)}" alt="" loading="lazy" />` : "";

    let ctrlHtml = "";
    let tooltip = isEquippedProc ? `${m.description} [Matches equipped weapon]` : m.description;
    if (isRanked) {
        const maxRank = m.ranks[m.ranks.length - 1].rank;
        const curRank = state.modifierRanks[slotKey]?.[m.id] ?? m.defaultRank ?? maxRank;
        const curEntry = m.ranks.find((r) => r.rank === curRank) || m.ranks[m.ranks.length - 1];
        tooltip = `${m.name} — Rank ${curEntry.rank}: ${curEntry.summary}`;
        ctrlHtml = isActive
            ? `<span class="chip-rank-wrap" title="Select ${escHtml(shortLabel)} rank">
                <span class="chip-rank-pill">R${curEntry.rank} &#9662;</span>
                <select class="chip-rank-select" data-rank-mod="${escHtml(m.id)}" aria-label="${escHtml(shortLabel)} rank">
                    ${m.ranks
                        .map(
                            (r) =>
                                `<option value="${r.rank}" ${r.rank === curEntry.rank ? "selected" : ""}>R${r.rank} &mdash; ${escHtml(r.summary)}</option>`
                        )
                        .join("")}
                </select>
            </span>`
            : `<span class="chip-stack-hint">R1-${maxRank}</span>`;
    } else if (isStackable) {
        const curStacks = state.modifierStacks[slotKey]?.[m.id] || m.defaultStacks || m.maxStacks || 1;
        const unitSuffix = m.stackUnit === "s" ? "s" : "";
        ctrlHtml = isActive
            ? `<span class="chip-stepper"><button type="button" class="chip-step-btn" data-step="-1" title="Decrease stacks">&minus;</button><span class="chip-stack-val">${curStacks}${unitSuffix}</span><button type="button" class="chip-step-btn" data-step="1" title="Increase stacks">+</button></span>`
            : `<span class="chip-stack-hint">1-${m.maxStacks}${unitSuffix}</span>`;
    } else if ((isProc || isEnl) && m.shortEffect) {
        ctrlHtml = `<span class="chip-proc-tag">${escHtml(m.shortEffect)}</span>`;
    }

    const delHtml = m.isCustom
        ? `<button type="button" class="chip-del-btn" data-del-mod="${escHtml(m.id)}" title="${state.diskApiAvailable ? "Remove custom buff from disk & browser backup" : "Remove custom buff from browser storage"}">&times;</button>`
        : "";
    const extraSearch = isProc
        ? `weapon proc ${m.shortEffect || ""} ${(m.weaponTypes || []).join(" ")}`
        : isEnl
          ? `enlightenment charm costume 2-set ${m.shortEffect || ""}`
          : "";
    const searchBlob = `${m.name} ${m.description || ""} ${extraSearch}`.toLowerCase();
    const curFilter = (state.buffFilter[slotKey] || "").trim().toLowerCase();
    const hiddenByFilter =
        (Boolean(state.buffActiveOnly[slotKey]) && !isActive) || (curFilter && !searchBlob.includes(curFilter));

    return `<span class="chip ${m.isDebuff ? "chip-debuff" : ""} ${isProc ? "chip-proc" : ""} ${isEnl ? "chip-enl" : ""} ${isEquippedProc ? "chip-equipped-proc" : ""} ${isActive ? "active" : ""} ${isRanked ? "chip-ranked" : ""} ${isStackable ? "chip-stackable" : ""} ${hiddenByFilter ? "chip-hidden" : ""}" data-mod="${escHtml(m.id)}" data-search="${escHtml(searchBlob)}" title="${escHtml(tooltip)}">${iconHtml}<span class="chip-lbl">${escHtml(shortLabel)}</span>${ctrlHtml}${delHtml}</span>`;
}

function renderCardBuffsPaneHtml(slotKey, ch, modSet, consMap, activeConsList, useDefFields, modCatalog) {
    const procsList = useDefFields
        ? [...modCatalog.defenderProcs, ...modCatalog.attackerProcs]
        : [...modCatalog.attackerProcs, ...modCatalog.defenderProcs];
    const buffGroups = useDefFields
        ? [
              { label: "Defensive Buffs", side: "defender", list: modCatalog.defensiveBuffs },
              { label: "Offensive & Raid Buffs", side: "attacker", list: modCatalog.offensiveBuffs },
          ]
        : [
              { label: "Offensive & Raid Buffs", side: "attacker", list: modCatalog.offensiveBuffs },
              { label: "Defensive Buffs", side: "defender", list: modCatalog.defensiveBuffs },
          ];
    const debuffGroups = useDefFields
        ? [
              { label: "Defensive & Shred Debuffs", side: "defender", list: modCatalog.defensiveDebuffs },
              { label: "Offensive & Charm Debuffs", side: "attacker", list: modCatalog.offensiveDebuffs },
          ]
        : [
              { label: "Offensive & Charm Debuffs", side: "attacker", list: modCatalog.offensiveDebuffs },
              { label: "Defensive & Shred Debuffs", side: "defender", list: modCatalog.defensiveDebuffs },
          ];
    const equippedProcIds = getEquippedWeaponProcIds(ch);

    const consSummaryHtml =
        activeConsList.length > 0
            ? `<div class="cons-summary">${activeConsList
                  .map((m) => {
                      const safeIc = sanitizeSafeIconUrl(m.icon);
                      const icHtml = safeIc
                          ? `<img class="cons-summary-icon" src="${escHtml(safeIc)}" alt="" loading="lazy" />`
                          : "";
                      return `<div class="cons-summary-row">${icHtml}<span><strong>${escHtml(m.name)}</strong>: ${escHtml(m.shortStats || m.description)}</span></div>`;
                  })
                  .join("")}</div>`
            : "";

    return `
        <div class="buff-toolbar">
            <div class="buff-filter-row">
                <input type="text" class="buff-filter-input" data-buff-filter="${slotKey}" value="${escHtml(state.buffFilter[slotKey] || "")}" placeholder="Filter buffs &amp; debuffs..." autocomplete="off" />
                <button type="button" class="sm buff-tb-btn ${state.buffActiveOnly[slotKey] ? "active" : ""}" data-action="toggleActiveOnly" title="Show only active buffs &amp; debuffs">Active (${modSet.size})</button>
                <button type="button" class="sm buff-tb-btn ${state.buffsCollapsed[slotKey] ? "active" : ""}" data-action="toggleBuffCollapse" title="Collapse or expand buff chip lists">${state.buffsCollapsed[slotKey] ? "Show" : "Hide"}</button>
            </div>
            <div class="buff-presets-row">
                <span class="buff-presets-lbl">Saved Presets:</span>
                ${
                    state.customBuffLoadouts.length > 0
                        ? state.customBuffLoadouts
                              .map(
                                  (p) =>
                                      `<span class="buff-preset-custom" data-buff-preset="${escHtml(p.id)}" title="Click to apply saved preset '${escHtml(p.label)}' (from buffs/loadouts.json)"><span>${escHtml(p.label)}</span><button type="button" class="buff-preset-ren" data-upd-preset="${escHtml(p.id)}" title="Overwrite '${escHtml(p.label)}' with current active buffs &amp; consumables">&#8635;</button><button type="button" class="buff-preset-ren" data-ren-preset="${escHtml(p.id)}" title="Rename preset">&#9998;</button><button type="button" class="buff-preset-del" data-del-preset="${escHtml(p.id)}" title="Delete preset">&times;</button></span>`
                              )
                              .join("")
                        : `<span class="hint-inline">None saved yet</span>`
                }
                <button type="button" class="buff-preset-btn buff-preset-save" data-action="saveBuffPreset" title="Save current active buffs &amp; consumables as a reusable preset in buffs/loadouts.json">+ Save Set</button>
                <button type="button" class="buff-preset-btn" data-action="clearAllBuffs" title="Clear all active buffs, debuffs &amp; consumables on this card">Clear</button>
            </div>
        </div>
        <div class="buff-sections-wrap ${state.buffsCollapsed[slotKey] ? "hidden" : ""}" data-buff-sections="${slotKey}">
            <div>
                <div class="stat-group-header">
                    <div class="stat-group-label proc-label">Weapon Procs</div>
                    <span class="hint-inline">Hidden passives</span>
                </div>
                <div class="mod-chips">
                    ${procsList.map((m) => renderModChipHtml(m, slotKey, modSet, equippedProcIds)).join("")}
                </div>
            </div>
            <div style="margin-top:8px">
                <div class="stat-group-header">
                    <div class="stat-group-label enl-label">Enlightenment (2-Set)</div>
                    <span class="hint-inline">Costume Charm + 2x Enlightened Ayanad (pick 1)</span>
                </div>
                <div class="mod-chips">
                    ${modCatalog.enlightenmentMods.map((m) => renderModChipHtml(m, slotKey, modSet)).join("")}
                </div>
            </div>
            ${buffGroups
                .map(
                    (grp) => `
            <div style="margin-top:8px">
                <div class="stat-group-header">
                    <div class="stat-group-label">${grp.label}</div>
                    <button type="button" class="sm chip-add-id-btn" data-action="pullBuff" data-pull-side="${grp.side}" data-pull-debuff="false" ${state.diskApiAvailable ? "" : "disabled"} title="${state.diskApiAvailable ? "Pull a buff from aa-classic.com by Buff ID" : "Disabled on static hosting — run locally with python tools/serve.py"}">+ ID</button>
                </div>
                <div class="mod-chips">
                    ${grp.list.map((m) => renderModChipHtml(m, slotKey, modSet)).join("")}
                </div>
            </div>`
                )
                .join("")}
            ${debuffGroups
                .map(
                    (grp) => `
            <div style="margin-top:8px">
                <div class="stat-group-header">
                    <div class="stat-group-label debuff-label">${grp.label}</div>
                    <button type="button" class="sm chip-add-id-btn" data-action="pullBuff" data-pull-side="${grp.side}" data-pull-debuff="true" ${state.diskApiAvailable ? "" : "disabled"} title="${state.diskApiAvailable ? "Pull a debuff from aa-classic.com by Buff ID" : "Disabled on static hosting — run locally with python tools/serve.py"}">+ ID</button>
                </div>
                <div class="mod-chips">
                    ${grp.list.map((m) => renderModChipHtml(m, slotKey, modSet)).join("")}
                </div>
            </div>`
                )
                .join("")}
        </div>
        <details class="consumables-box" data-cons-box="${slotKey}" ${state.consumablesOpen[slotKey] ? "open" : ""}>
            <summary>
                <span>Food &amp; Consumables${activeConsList.length > 0 ? `<span class="cons-badge">${activeConsList.length} active</span>` : ""}</span>
                ${activeConsList.length > 0 ? `<button type="button" class="sm" data-action="clearConsumables">Clear</button>` : ""}
            </summary>
            <div class="consumables-grid">
                ${CONSUMABLE_SLOTS.map((cs) => {
                    const curVal = consMap[cs.id] || "";
                    const opts = modCatalog.consumablesBySlot[cs.id] || [];
                    const curMod = curVal ? COMBAT_MODIFIERS[curVal] : null;
                    const wideCls = cs.id === "spellbook" ? "cons-slot-wide" : "";
                    const slotIcon = sanitizeSafeIconUrl(curMod?.icon || cs.icon || "");
                    return `
                    <div class="cons-slot ${wideCls}">
                        <label>${escHtml(cs.label)}</label>
                        <div class="cons-select-row">
                            ${slotIcon ? `<img class="cons-slot-icon ${curVal ? "active" : ""}" src="${escHtml(slotIcon)}" alt="" loading="lazy" />` : ""}
                            <select data-cons-slot="${cs.id}" class="${curVal ? "has-val" : ""}" title="${escHtml(curMod ? curMod.description : `Select ${cs.label}`)}">
                                <option value="">None</option>
                                ${opts
                                    .map(
                                        (m) =>
                                            `<option value="${escHtml(m.id)}" ${m.id === curVal ? "selected" : ""}>${escHtml(m.optionLabel || m.name)}</option>`
                                    )
                                    .join("")}
                            </select>
                        </div>
                    </div>`;
                }).join("")}
            </div>
            ${consSummaryHtml}
        </details>`;
}

function renderCharacterCardHtml(slot, modCatalog) {
    const ch = getSlotChar(slot.key);
    const modSet = state.modifiers[slot.key];
    const consMap = state.consumables[slot.key] || {};
    const activeConsList = Object.values(consMap)
        .filter(Boolean)
        .map((id) => COMBAT_MODIFIERS[id])
        .filter(Boolean);
    const useDefFields = slotUsesDefenseFields(slot.key);
    const mainFields = useDefFields ? DEFENSE_FIELDS_MAIN : OFFENSE_FIELDS_MAIN;
    const extraFields = useDefFields ? DEFENSE_FIELDS_EXTRA : OFFENSE_FIELDS_EXTRA;
    const section = useDefFields ? "defense" : "offense";

    const buffedInfo = buildBuffedStatsContent(slot.key, useDefFields);
    const buffedOpen =
        state.buffedStatsOpen[slot.key] === null ? buffedInfo.hasBuffs : Boolean(state.buffedStatsOpen[slot.key]);
    const buffedView = state.buffedStatsView[slot.key] || "changed";

    const loadedSaved = state.loadedSavedId[slot.key];
    const buildOptionsHtml = state.savedBuilds
        .map((b) => {
            const gsTag = b.gearScore ? ` (${fmtInt(b.gearScore)} GS)` : "";
            const sel = loadedSaved === b.savedId ? "selected" : "";
            return `<option value="${escHtml(b.savedId)}" ${sel}>${escHtml(b.name || b.savedId)}${gsTag}</option>`;
        })
        .join("");

    const meta = normalizeBuildMetadata(ch);
    const safeDgHref = sanitizeSafeDaruGearUrl(meta.darugearUrl);
    const dgLabel = meta.shareCode ? `DaruGear: ${meta.shareCode}` : "DaruGear Link";
    const dgOptBuffs = (Array.isArray(meta.darugearBuffs) ? meta.darugearBuffs : []).filter((b) => b.isOptional);
    const liveGearBuffs = computeCharacterGearBuffSummaries(ch, getGearCatalog(), getSlotModifiers(slot.key)).filter(
        (b) => b.category !== "title"
    );
    const dgBuffsBarHtml =
        dgOptBuffs.length > 0 || liveGearBuffs.length > 0
            ? `<div class="darugear-buffs-bar" title="Active DaruGear optional buffs and Armor Set / Grade / Weapon gear buffs">
                ${dgOptBuffs.length > 0 ? `<span class="dg-buff-hdr">DaruGear buffs:</span>` : `<span class="dg-buff-hdr">Gear buffs:</span>`}
                ${dgOptBuffs
                    .map((b) => {
                        const idTag = b.id ? ` #${b.id}` : "";
                        const canPullThis = Boolean(b.id && state.diskApiAvailable);
                        const clickable = canPullThis ? `data-dg-pull-id="${escHtml(b.id)}"` : "disabled";
                        const syncedCls = b.unbaked ? "dg-buff-synced" : "dg-buff-opt";
                        const tipText = b.unbaked
                            ? `${b.name}${idTag} — auto-imported & accounted for in base stats (toggle on/off in the buffs section below).`
                            : `${b.name}${idTag} — active on DaruGear (baked into base stats)${canPullThis ? ". Click to pull by Buff ID." : b.id ? " (start tools/serve.py to pull by Buff ID)" : ""}`;
                        return `<button type="button" class="dg-buff-pill ${syncedCls}" ${clickable} title="${escHtml(tipText)}">${escHtml(b.name)}${b.id ? `<span class="dg-buff-id">#${escHtml(b.id)}</span>` : ""}${b.unbaked ? `<span class="dg-buff-chk" aria-hidden="true">&#10003;</span>` : ""}</button>`;
                    })
                    .join("")}
                ${
                    liveGearBuffs.length > 0
                        ? `<details class="dg-gear-details">
                            <summary>${liveGearBuffs.map((b) => escHtml(b.name)).join(" · ")}</summary>
                            <div class="dg-gear-list gb-buff-list">
                                ${liveGearBuffs
                                    .map((b) => {
                                        const safeColor = sanitizeHexColor(b.gradeColor, "");
                                        return `
                                    <div class="gb-buff-item cat-${escHtml(b.category)}">
                                        <div class="gb-buff-name"${safeColor ? ` style="color:${escHtml(safeColor)}"` : ""}>${escHtml(b.name)}</div>
                                        ${b.summary ? `<div class="gb-buff-stats">${escHtml(b.summary)}</div>` : ""}
                                    </div>`;
                                    })
                                    .join("")}
                            </div>
                        </details>`
                        : ""
                }
            </div>`
            : "";

    const otherGearMap = (() => {
        if (slot.key === "A" && Array.isArray(state.buildB.equipment) && state.buildB.equipment.length > 0) {
            return new Map(normalizeEquipmentList(state.buildB.equipment).map((x) => [x.slotId, x]));
        }
        if (slot.key === "B" && Array.isArray(state.buildA.equipment) && state.buildA.equipment.length > 0) {
            return new Map(normalizeEquipmentList(state.buildA.equipment).map((x) => [x.slotId, x]));
        }
        return null;
    })();
    const gearHtml = renderGearSectionHtml(slot.key, ch, otherGearMap);

    const activeCardTab = state.cardTab[slot.key] || "summary";
    const totalBuffCnt = modSet.size + activeConsList.length;
    const eqCount = Array.isArray(ch.equipment) ? ch.equipment.length : 0;
    const sbObj = ch.skillBuild || null;
    const sbPts = sbObj ? getTotalPointsSpent(sbObj) : 0;
    const sbClass = sbObj ? resolveClassName(sbObj.trees) || sbObj.className : meta.className;
    const sbBtnLabel = sbObj
        ? `Skills: ${sbClass || "Custom"} (${sbPts}p)`
        : sbClass
          ? `Skills: ${sbClass}`
          : "+ Skill Build";
    const equipLabel = meta.equipmentType ? EQUIP_TYPE_LABELS[meta.equipmentType] || meta.equipmentType : "";
    const explicitCat = meta.category || null;
    const allCategories = getAllBuildCategories();
    const inferredCat = inferBuildCategory(ch);
    const inferredArmor = inferBuildArmorType(ch);
    const armorMeta = ARMOR_TYPES.find((a) => a.id === inferredArmor) || ARMOR_TYPES[0];
    const autoBaseCat = inferBuildCategory({ ...ch, category: null, metadata: { ...(ch.metadata || {}), category: null } });
    const autoCatMeta = allCategories.find((c) => c.id === autoBaseCat) || BUILD_CATEGORIES[0];
    const explicitMissing = explicitCat && !allCategories.some((c) => c.id === explicitCat);
    const catSelectHtml = `<select class="build-cat-select" data-action="setCategory" title="Build archetype category (used for Category &amp; Armor Default Buff Loadouts &amp; Off-Spec tile filtering)">
        <option value="" ${!explicitCat ? "selected" : ""}>Auto: ${escHtml(autoCatMeta.label)}</option>
        ${allCategories
            .map(
                (c) => `<option value="${escHtml(c.id)}" ${explicitCat === c.id ? "selected" : ""}>${escHtml(c.label)}</option>`
            )
            .join("")}
        ${explicitMissing ? `<option value="${escHtml(explicitCat)}" selected>${escHtml(explicitCat)}</option>` : ""}
    </select>`;

    const summaryMetaHtml = `
        <div class="build-meta-bar">
            ${catSelectHtml}
            <span class="build-meta-pill armor-${escHtml(armorMeta.id)}" title="Detected dominant armor type (used for Plate / Leather / Cloth default buff variants)">${escHtml(armorMeta.label)}</span>
            ${
                safeDgHref
                    ? `<a class="darugear-link-pill" href="${escHtml(safeDgHref)}" target="_blank" rel="noopener noreferrer" title="${escHtml(safeDgHref)}">${escHtml(dgLabel)} &#8599;</a>`
                    : ""
            }
            ${equipLabel ? `<span class="build-meta-pill">${escHtml(equipLabel)}</span>` : ""}
            ${meta.title ? `<span class="build-meta-pill" title="Equipped Title on DaruGear">${escHtml(meta.title)}</span>` : ""}
            ${meta.gearScore > 0 ? `<span class="build-meta-pill">${fmtInt(meta.gearScore)} GS</span>` : ""}
            <button type="button" class="sm sb-quick-pill" data-action="openSkillBuilder" title="Open Skill Builder &amp; Passives for this build">${escHtml(sbBtnLabel)}</button>
            <button type="button" class="sm gb-quick-pill" data-action="openGearBuilder" title="Open DaruGear-style 20-Slot Gear Builder for this build">&#9881; Gear Builder</button>
        </div>`;

    return `
    <div class="char-card ${slot.cardCls}" data-slot="${slot.key}">
        <div class="card-header">
            <div class="card-title-row">
                <span class="badge ${slot.badgeCls}">${slot.badge}</span>
                <input class="card-name-input" data-field="name" value="${escHtml(ch.name)}" />
            </div>
            <div class="card-actions">
                <button type="button" class="sm dirty-reset-btn ${isSlotDirty(slot.key) ? "" : "hidden"}" data-action="resetSaved" title="Build modified in memory — click to reset to saved baseline">&#8634; Reset</button>
                <button type="button" class="sm primary" data-action="import">Import</button>
                <details class="card-menu">
                    <summary title="More build actions">&ctdot;</summary>
                    <div class="card-menu-pop">
                        <button type="button" class="card-menu-item" data-action="newBlankBuild">+ New Blank Build (.json)</button>
                        ${slot.key === "B" ? `<button type="button" class="card-menu-item" data-action="copyA">Copy Build A &rarr; B</button>` : ""}
                        <button type="button" class="card-menu-item" data-action="saveDisk">${state.diskApiAvailable ? "Save to Disk (builds/)" : "Save to Browser"}</button>
                        <button type="button" class="card-menu-item" data-action="download">&darr; Download .json</button>
                        <button type="button" class="card-menu-item" data-action="export">Copy JSON to Clipboard</button>
                        <button type="button" class="card-menu-item" data-action="editDarugear">${safeDgHref ? "Edit DaruGear Link" : "+ Attach DaruGear Link"}</button>
                        ${loadedSaved ? `<button type="button" class="card-menu-item danger" data-action="deleteSaved">Delete Saved Build</button>` : ""}
                    </div>
                </details>
            </div>
        </div>
        <div class="preset-row">
            <div class="preset-select-wrap">
                <select data-action="preset">
                    <option value="">${state.savedBuilds.length > 0 ? "Load build from disk..." : "No saved builds in builds/"}</option>
                    ${buildOptionsHtml}
                </select>
            </div>
            <div class="stat-field" style="gap:4px">
                <label>Max HP</label>
                <input type="number" data-root="maxHealth" value="${ch.maxHealth}" step="500" />
            </div>
        </div>
        <div class="card-tabs" role="tablist">
            <button type="button" class="card-tab-btn ${activeCardTab === "summary" ? "active" : ""}" data-card-tab="summary">Summary</button>
            <button type="button" class="card-tab-btn ${activeCardTab === "stats" ? "active" : ""}" data-card-tab="stats">Stats</button>
            <button type="button" class="card-tab-btn ${activeCardTab === "buffs" ? "active" : ""}" data-card-tab="buffs">Buffs<span class="card-tab-cnt ${totalBuffCnt === 0 ? "hidden" : ""}" data-card-tab-cnt="buffs">${totalBuffCnt}</span></button>
            <button type="button" class="card-tab-btn ${activeCardTab === "gear" ? "active" : ""}" data-card-tab="gear">Gear${eqCount > 0 ? `<span class="card-tab-cnt">${eqCount}</span>` : ""}</button>
        </div>

        <div class="card-tab-pane ${activeCardTab !== "summary" ? "hidden" : ""}" data-card-pane="summary">
            ${summaryMetaHtml}
            <div data-summary-eff>${buffedInfo.effStatsHtml}</div>
            ${useDefFields ? `<div class="hint-inline" data-def-summary>${buffedInfo.defSummaryHtml}</div>` : ""}
            <div class="summary-active-buffs" data-summary-buffs>${buildSummaryActiveBuffsHtml(slot.key)}</div>
        </div>

        <div class="card-tab-pane ${activeCardTab !== "stats" ? "hidden" : ""}" data-card-pane="stats">
            ${
                useDefFields
                    ? `<div class="def-equip-row">
                           <label class="def-flag-toggle" title="Block rate and Shield Physical Defense only apply when a shield is equipped">
                               <input type="checkbox" data-def-flag="hasShield" ${ch.defense.hasShield ? "checked" : ""} />
                               <span>Shield Equipped</span>
                           </label>
                           <label class="def-flag-toggle" title="Dual-Wield Proficiency passive: allows Parry to apply against ranged attacks">
                               <input type="checkbox" data-def-flag="dualWieldRangedParry" ${ch.defense.dualWieldRangedParry ? "checked" : ""} />
                               <span>DW Ranged Parry</span>
                           </label>
                       </div>`
                    : ""
            }
            <div class="stat-grid">
                ${mainFields
                    .map(
                        ([f, lbl]) => `
                    <div class="stat-field">
                        <label>${lbl}</label>
                        <input type="number" step="any" data-sec="${section}" data-key="${f}" value="${ch[section][f] ?? 0}" />
                    </div>`
                    )
                    .join("")}
            </div>
            <details class="more-stats">
                <summary>More ${useDefFields ? "defense" : "offense"} stats</summary>
                <div class="stat-grid">
                    ${extraFields
                        .map(
                            ([f, lbl]) => `
                        <div class="stat-field">
                            <label>${lbl}</label>
                            <input type="number" step="any" data-sec="${section}" data-key="${f}" value="${ch[section][f] ?? 0}" />
                        </div>`
                        )
                        .join("")}
                </div>
            </details>
            <details class="buffed-stats-box" data-buffed-box="${slot.key}" ${buffedOpen ? "open" : ""}>
                <summary>
                    <span>Stats After Buffs<span data-buffed-badge>${buffedInfo.badgeHtml}</span></span>
                    <span class="buffed-view-toggle">
                        <button type="button" class="buffed-view-btn ${buffedView === "changed" ? "active" : ""}" data-buffed-view="changed">Changed</button>
                        <button type="button" class="buffed-view-btn ${buffedView === "all" ? "active" : ""}" data-buffed-view="all">All</button>
                    </span>
                </summary>
                <div data-buffed-body>${buffedInfo.bodyHtml}</div>
            </details>
        </div>

        <div class="card-tab-pane ${activeCardTab !== "buffs" ? "hidden" : ""}" data-card-pane="buffs">
            ${renderCardBuffsPaneHtml(slot.key, ch, modSet, consMap, activeConsList, useDefFields, modCatalog)}
        </div>

        <div class="card-tab-pane ${activeCardTab !== "gear" ? "hidden" : ""}" data-card-pane="gear">
            ${gearHtml || `<div class="hint-inline">No equipment imported yet. Use <strong>Import</strong> from DaruGear or the <strong>Gear Builder</strong> tab to edit gear and lunagems.</div>`}
            ${dgBuffsBarHtml}
        </div>
    </div>`;
}

// ============================================================================
// Character Card Event Binding (Decomposed by Domain)
// ============================================================================
function bindCardModifierEvents(card, slot) {
    card.querySelectorAll(".chip-rank-select").forEach((sel) => {
        sel.addEventListener("click", (e) => e.stopPropagation());
        sel.addEventListener("change", (e) => {
            e.stopPropagation();
            const id = sel.dataset.rankMod;
            const mod = COMBAT_MODIFIERS[id];
            const rk = parseInt(sel.value, 10);
            if (mod && Number.isFinite(rk)) {
                state.modifierRanks[slot][id] = rk;
                const entry = mod.ranks?.find((r) => r.rank === rk);
                const pillEl = sel.closest(".chip-rank-wrap")?.querySelector(".chip-rank-pill");
                if (pillEl) pillEl.innerHTML = `R${rk} &#9662;`;
                const chipEl = sel.closest(".chip");
                if (chipEl && entry) {
                    chipEl.title = `${mod.name} — Rank ${entry.rank}: ${entry.summary}`;
                }
                updateBuffedStatsPanel(slot);
                ui.renderSimulation();
            }
        });
    });

    card.querySelectorAll(".chip[data-mod]").forEach((chip) => {
        chip.addEventListener("click", (e) => {
            if (e.target.closest(".chip-rank-wrap")) return;
            const id = chip.dataset.mod;
            if (e.target.closest(".chip-del-btn")) {
                e.stopPropagation();
                deleteCustomBuffById(id);
                return;
            }
            const mod = COMBAT_MODIFIERS[id];
            const set = state.modifiers[slot];
            const isRanked = Array.isArray(mod?.ranks) && mod.ranks.length > 1;
            const stepBtn = e.target.closest(".chip-step-btn");
            if (stepBtn && mod?.maxStacks > 1) {
                e.stopPropagation();
                const delta = parseInt(stepBtn.dataset.step, 10) || 0;
                const cur = state.modifierStacks[slot][id] || mod.defaultStacks || mod.maxStacks;
                const next = Math.max(1, Math.min(mod.maxStacks, cur + delta));
                state.modifierStacks[slot][id] = next;
                const valEl = chip.querySelector(".chip-stack-val");
                if (valEl) valEl.textContent = `${next}${mod.stackUnit === "s" ? "s" : ""}`;
                updateBuffedStatsPanel(slot);
                ui.renderSimulation();
                return;
            }

            let replacedExclusive = false;
            if (set.has(id)) {
                set.delete(id);
            } else {
                if (mod?.exclusiveGroup) {
                    for (const existingId of Array.from(set)) {
                        if (
                            existingId !== id &&
                            COMBAT_MODIFIERS[existingId]?.exclusiveGroup === mod.exclusiveGroup
                        ) {
                            set.delete(existingId);
                            replacedExclusive = true;
                        }
                    }
                }
                set.add(id);
                if (isRanked && state.modifierRanks[slot][id] == null) {
                    state.modifierRanks[slot][id] =
                        mod.defaultRank ?? mod.ranks[mod.ranks.length - 1].rank;
                } else if (mod?.maxStacks > 1 && !state.modifierStacks[slot][id]) {
                    state.modifierStacks[slot][id] = mod.defaultStacks || mod.maxStacks;
                }
            }
            if (isRanked || mod?.maxStacks > 1 || replacedExclusive) {
                renderCharacterCards();
            } else {
                chip.classList.toggle("active");
                if (state.buffActiveOnly[slot] && !chip.classList.contains("active")) {
                    chip.classList.add("chip-hidden");
                }
                const actBtn = card.querySelector('[data-action="toggleActiveOnly"]');
                if (actBtn) actBtn.textContent = `Active (${set.size})`;
                updateBuffedStatsPanel(slot);
            }
            ui.renderSimulation();
        });
    });

    card.querySelectorAll("[data-dg-pull-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const bid = btn.dataset.dgPullId;
            openBuffPullModal(null, null);
            if (bid) {
                document.getElementById("buffIdInput").value = bid;
                handleFetchBuffById();
            }
        });
    });

    card.querySelectorAll('[data-action="pullBuff"]').forEach((btn) => {
        btn.addEventListener("click", () => {
            openBuffPullModal(btn.dataset.pullSide || null, btn.dataset.pullDebuff === "true");
        });
    });

    const applyDomBuffFilter = () => {
        const q = (state.buffFilter[slot] || "").trim().toLowerCase();
        const actOnly = Boolean(state.buffActiveOnly[slot]);
        card.querySelectorAll(".chip[data-mod]").forEach((chEl) => {
            const isAct = chEl.classList.contains("active");
            const blob = chEl.dataset.search || "";
            chEl.classList.toggle("chip-hidden", Boolean((actOnly && !isAct) || (q && !blob.includes(q))));
        });
        const actBtn = card.querySelector('[data-action="toggleActiveOnly"]');
        if (actBtn) {
            actBtn.textContent = `Active (${state.modifiers[slot].size})`;
            actBtn.classList.toggle("active", actOnly);
        }
    };

    card.querySelector(`input[data-buff-filter="${slot}"]`)?.addEventListener("input", (e) => {
        state.buffFilter[slot] = e.target.value;
        if (state.buffsCollapsed[slot] && e.target.value.trim()) {
            state.buffsCollapsed[slot] = false;
            card.querySelector(`[data-buff-sections="${slot}"]`)?.classList.remove("hidden");
        }
        applyDomBuffFilter();
    });

    card.querySelector('[data-action="toggleActiveOnly"]')?.addEventListener("click", () => {
        state.buffActiveOnly[slot] = !state.buffActiveOnly[slot];
        if (state.buffsCollapsed[slot] && state.buffActiveOnly[slot]) {
            state.buffsCollapsed[slot] = false;
            card.querySelector(`[data-buff-sections="${slot}"]`)?.classList.remove("hidden");
        }
        applyDomBuffFilter();
    });

    const collapseBtn = card.querySelector('[data-action="toggleBuffCollapse"]');
    collapseBtn?.addEventListener("click", () => {
        state.buffsCollapsed[slot] = !state.buffsCollapsed[slot];
        card.querySelector(`[data-buff-sections="${slot}"]`)?.classList.toggle("hidden", state.buffsCollapsed[slot]);
        collapseBtn.textContent = state.buffsCollapsed[slot] ? "Show" : "Hide";
        collapseBtn.classList.toggle("active", state.buffsCollapsed[slot]);
    });
}

function bindCardBuffPresetEvents(card, slot) {
    card.querySelectorAll("[data-buff-preset]").forEach((el) => {
        el.addEventListener("click", (e) => {
            const delBtn = e.target.closest("[data-del-preset]");
            if (delBtn) {
                e.stopPropagation();
                const delId = delBtn.dataset.delPreset;
                const target = state.customBuffLoadouts.find((p) => p.id === delId);
                state.customBuffLoadouts = state.customBuffLoadouts.filter((p) => p.id !== delId);
                saveCustomBuffLoadouts(state.customBuffLoadouts);
                renderCharacterCards();
                showToast(`Deleted preset "${target?.label || delId}"`, "ok");
                return;
            }
            const renBtn = e.target.closest("[data-ren-preset]");
            if (renBtn) {
                e.stopPropagation();
                const target = state.customBuffLoadouts.find((p) => p.id === renBtn.dataset.renPreset);
                if (!target) return;
                const nextName = prompt("Rename buff preset:", target.label || "");
                if (!nextName || !nextName.trim()) return;
                target.label = nextName.trim().slice(0, 32);
                saveCustomBuffLoadouts(state.customBuffLoadouts);
                renderCharacterCards();
                showToast(`Renamed preset to "${target.label}"`, "ok");
                return;
            }
            const updBtn = e.target.closest("[data-upd-preset]");
            if (updBtn) {
                e.stopPropagation();
                const target = state.customBuffLoadouts.find((p) => p.id === updBtn.dataset.updPreset);
                if (!target) return;
                const tokens = getSlotChipTokens(slot);
                const cons = { ...(state.consumables[slot] || {}) };
                if (tokens.length === 0 && Object.keys(cons).length === 0) {
                    showToast("Activate at least one buff or consumable before updating this preset", "err");
                    return;
                }
                target.tokens = tokens;
                target.consumables = cons;
                saveCustomBuffLoadouts(state.customBuffLoadouts);
                renderCharacterCards();
                showToast(`Updated preset "${target.label}" (${tokens.length} buffs, ${Object.keys(cons).length} consumables)`, "ok");
                return;
            }
            const preset = state.customBuffLoadouts.find((p) => p.id === el.dataset.buffPreset);
            if (!preset) return;
            setSlotModifiersFromTokens(slot, Array.isArray(preset.tokens) ? preset.tokens : []);
            state.consumables[slot] =
                preset.consumables && typeof preset.consumables === "object" ? { ...preset.consumables } : {};
            renderCharacterCards();
            ui.renderSimulation();
            showToast(`Applied "${preset.label}" preset to ${slotDisplayLabel(slot)}`, "ok");
        });
    });

    card.querySelector('[data-action="clearAllBuffs"]')?.addEventListener("click", () => {
        setSlotModifiersFromTokens(slot, []);
        state.consumables[slot] = {};
        renderCharacterCards();
        ui.renderSimulation();
        showToast(`Cleared buffs & consumables on ${slotDisplayLabel(slot)}`, "ok");
    });

    card.querySelector('[data-action="saveBuffPreset"]')?.addEventListener("click", () => {
        const tokens = getSlotChipTokens(slot);
        const cons = { ...(state.consumables[slot] || {}) };
        if (tokens.length === 0 && Object.keys(cons).length === 0) {
            showToast("Activate at least one buff or consumable before saving a preset", "err");
            return;
        }
        const label = prompt("Name this buff & consumable preset (e.g. 'Plate Mage'):", "");
        if (!label || !label.trim()) return;
        const cleanLabel = label.trim().slice(0, 32);
        const id = `custom_${slugifyBuildId(cleanLabel)}_${Date.now().toString(36)}`;
        state.customBuffLoadouts.push({ id, label: cleanLabel, tokens, consumables: cons });
        saveCustomBuffLoadouts(state.customBuffLoadouts);
        renderCharacterCards();
        showToast(`Saved preset "${cleanLabel}" to buffs/loadouts.json`, "ok");
    });
}

function bindCharacterCardEvents(card, slot) {
    card.querySelectorAll("[data-card-tab]").forEach((tabBtn) => {
        tabBtn.addEventListener("click", () => setCardTab(card, slot, tabBtn.dataset.cardTab));
    });
    bindSummaryBuffQuickActions(card, slot);

    card.querySelectorAll(".card-menu-item").forEach((mItem) => {
        mItem.addEventListener("click", () => {
            const det = mItem.closest("details.card-menu");
            if (det) det.open = false;
        });
    });

    const syncDirtyBtn = () => {
        const btn = card.querySelector('[data-action="resetSaved"]');
        if (btn) btn.classList.toggle("hidden", !isSlotDirty(slot));
    };

    card.querySelector('[data-action="resetSaved"]')?.addEventListener("click", () => {
        resetSlotToSaved(slot);
    });

    card.querySelector('input[data-field="name"]').addEventListener("input", (e) => {
        getSlotChar(slot).name = e.target.value;
        syncDirtyBtn();
        ui.renderSimulation();
    });

    card.querySelector('input[data-root="maxHealth"]').addEventListener("input", (e) => {
        getSlotChar(slot).maxHealth = parseFloat(e.target.value) || 1;
        syncDirtyBtn();
        updateBuffedStatsPanel(slot);
        ui.renderSimulation();
    });

    card.querySelectorAll("input[data-sec]").forEach((inp) => {
        inp.addEventListener("input", (e) => {
            getSlotChar(slot)[e.target.dataset.sec][e.target.dataset.key] = parseFloat(e.target.value) || 0;
            syncDirtyBtn();
            updateBuffedStatsPanel(slot);
            ui.renderSimulation();
        });
    });

    card.querySelectorAll("input[data-def-flag]").forEach((cb) => {
        cb.addEventListener("change", (e) => {
            getSlotChar(slot).defense[e.target.dataset.defFlag] = Boolean(e.target.checked);
            syncDirtyBtn();
            updateBuffedStatsPanel(slot);
            ui.renderSimulation();
        });
    });

    card.querySelector('select[data-action="setCategory"]')?.addEventListener("change", (e) => {
        const nextCat = String(e.target.value || "").trim() || null;
        const ch = getSlotChar(slot);
        const updatedMeta = normalizeBuildMetadata({
            ...ch,
            category: nextCat,
            metadata: { ...(ch.metadata || {}), category: nextCat },
        });
        ch.metadata = updatedMeta;
        ch.category = updatedMeta.category || null;
        const applied = applyCategoryDefaultLoadoutToSlot(slot);
        renderCharacterCards();
        ui.renderSimulation();
        const resolvedId = inferBuildCategory(ch);
        const catLabel = getAllBuildCategories().find((c) => c.id === resolvedId)?.label || resolvedId || "Auto";
        showToast(
            applied.applied
                ? `Category set to ${catLabel} & applied "${applied.label}" buffs`
                : `Category set to ${nextCat ? catLabel : `Auto (${catLabel})`} (save build to persist)`,
            "ok"
        );
    });

    card.querySelector('select[data-action="preset"]').addEventListener("change", (e) => {
        const id = e.target.value;
        if (!id) return;
        const found = state.savedBuilds.find((b) => b.savedId === id);
        if (found) applySavedBuildToSlot(slot, found);
        renderCharacterCards();
        ui.renderSimulation();
    });

    card.querySelector('[data-action="deleteSaved"]')?.addEventListener("click", async () => {
        const id = state.loadedSavedId[slot];
        if (!id) return;
        const found = state.savedBuilds.find((b) => b.savedId === id);
        const label = found?.name || id;
        if (!confirm(`Delete saved build "${label}"${state.diskApiAvailable ? ` (builds/${id}.json)` : ""}?`)) {
            return;
        }
        try {
            await deleteSavedBuildFromStore(id);
            renderCharacterCards();
            showToast(`Deleted saved build "${label}"`, "ok");
        } catch (err) {
            showToast(`Delete failed: ${err.message}`, "err");
        }
    });

    card.querySelector('[data-action="import"]').addEventListener("click", () => openImportModal(slot));
    card.querySelectorAll('[data-action="newBlankBuild"]').forEach((btn) => {
        btn.addEventListener("click", async () => {
            const nextName = prompt("Name for the new blank character build:", "New Character");
            if (nextName === null) return;
            const cleanName = String(nextName).trim();
            if (!cleanName) {
                showToast("Build name cannot be empty", "warn");
                return;
            }
            try {
                await createBlankBuildForSlot(slot, {
                    name: cleanName,
                    saveToStore: true,
                    openGearBuilder: true,
                });
            } catch (err) {
                showToast(`Could not create blank build: ${err.message || err}`, "err");
            }
        });
    });
    card.querySelectorAll('[data-action="openGearBuilder"]').forEach((btn) => {
        btn.addEventListener("click", () => {
            state.gearBuilderSlot = slot;
            switchAppMode("gearbuilder", { scrollToSim: true });
        });
    });
    card.querySelectorAll('[data-action="openSkillBuilder"]').forEach((btn) => {
        btn.addEventListener("click", () => {
            state.skillBuilderSlot = slot;
            switchAppMode("skillbuilder", { scrollToSim: true });
        });
    });

    card.querySelector('[data-action="editDarugear"]')?.addEventListener("click", () => {
        const ch = getSlotChar(slot);
        const curMeta = normalizeBuildMetadata(ch);
        const nextUrl = prompt(
            "Enter DaruGear URL for this build's metadata (leave blank to clear):",
            curMeta.darugearUrl || ""
        );
        if (nextUrl === null) return;
        const trimmed = nextUrl.trim();
        const updatedMeta = normalizeBuildMetadata({
            ...ch,
            shareUrl: trimmed || null,
            darugearUrl: trimmed || null,
            shareCode: null,
            metadata: { ...(ch.metadata || {}), darugearUrl: trimmed || null, shareCode: null },
        });
        ch.metadata = updatedMeta;
        ch.shareUrl = updatedMeta.darugearUrl;
        ch.darugearUrl = updatedMeta.darugearUrl;
        ch.shareCode = updatedMeta.shareCode;
        if (updatedMeta.darugearUrl && ch.source === "manual") {
            ch.source = "darugear";
            ch.metadata.source = "darugear";
        }
        renderCharacterCards();
        showToast(
            updatedMeta.darugearUrl
                ? "Updated DaruGear URL metadata (click Save to write to disk)"
                : "Cleared DaruGear URL metadata",
            "ok"
        );
    });

    card.querySelector('[data-action="saveDisk"]').addEventListener("click", async () => {
        const ch = getSlotChar(slot);
        try {
            const res = await saveBuildToStore(ch, getSlotChipTokens(slot), state.consumables[slot] || {});
            state.loadedSavedId[slot] = res.id;
            state.slotBaselineFp[slot] = computeSlotCharacterFingerprint(ch);
            renderCharacterCards();
            showToast(
                res.mode === "disk"
                    ? `Saved to ${res.filename}`
                    : `Saved "${ch.name}" to browser storage (use ↓ .json to download)`,
                "ok"
            );
        } catch (err) {
            showToast(`Save failed: ${err.message}`, "err");
        }
    });

    card.querySelector('[data-action="download"]').addEventListener("click", () => downloadSlotBuildJson(slot));
    card.querySelector('[data-action="export"]').addEventListener("click", async () => {
        const json = JSON.stringify(serializeSlotBuild(slot), null, 2);
        try {
            await navigator.clipboard.writeText(json);
            showToast(`Copied ${getSlotChar(slot).name} JSON to clipboard`, "ok");
        } catch {
            prompt("Copy build JSON:", json);
        }
    });

    card.querySelector('[data-action="copyA"]')?.addEventListener("click", () => {
        state.buildB = applyOverrides(state.buildA, { name: `${state.buildA.name} (Copy)` });
        state.modifiers.B = new Set(state.modifiers.A);
        state.modifierStacks.B = { ...state.modifierStacks.A };
        state.modifierRanks.B = { ...state.modifierRanks.A };
        state.consumables.B = { ...state.consumables.A };
        state.buffedStatsView.B = state.buffedStatsView.A;
        state.loadedSavedId.B = null;
        renderCharacterCards();
        ui.renderSimulation();
    });

    bindCardModifierEvents(card, slot);
    bindCardBuffPresetEvents(card, slot);

    const gearBox = card.querySelector(`details[data-gear-box="${slot}"]`);
    if (gearBox) {
        gearBox.addEventListener("toggle", () => {
            state.gearOpen[slot] = gearBox.open;
        });
        gearBox.querySelectorAll(".gear-tile[data-gear-slot]").forEach((tile) => {
            tile.addEventListener("click", () => {
                const sid = parseInt(tile.dataset.gearSlot, 10);
                state.selectedGearSlot[slot] = state.selectedGearSlot[slot] === sid ? null : sid;
                renderCharacterCards();
            });
        });
        gearBox.querySelector('[data-action="closeGearInsp"]')?.addEventListener("click", () => {
            state.selectedGearSlot[slot] = null;
            renderCharacterCards();
        });
    }

    const consBox = card.querySelector(`details[data-cons-box="${slot}"]`);
    if (consBox) {
        consBox.addEventListener("toggle", () => {
            state.consumablesOpen[slot] = consBox.open;
        });
    }

    card.querySelector('[data-action="clearConsumables"]')?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.consumables[slot] = {};
        renderCharacterCards();
        ui.renderSimulation();
    });

    card.querySelectorAll("select[data-cons-slot]").forEach((sel) => {
        sel.addEventListener("change", () => {
            const csId = sel.dataset.consSlot;
            if (sel.value) state.consumables[slot][csId] = sel.value;
            else delete state.consumables[slot][csId];
            renderCharacterCards();
            ui.renderSimulation();
        });
    });

    const buffedBox = card.querySelector(`details[data-buffed-box="${slot}"]`);
    if (buffedBox) {
        buffedBox.querySelector("summary")?.addEventListener("click", (e) => {
            if (e.target.closest(".buffed-view-toggle")) return;
            state.buffedStatsOpen[slot] = !buffedBox.open;
        });
        buffedBox.querySelectorAll("[data-buffed-view]").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                state.buffedStatsView[slot] = btn.dataset.buffedView;
                buffedBox.open = true;
                state.buffedStatsOpen[slot] = true;
                updateBuffedStatsPanel(slot);
            });
        });
    }
}

export function renderCharacterCards() {
    const grid = document.getElementById("charGrid");
    const isDefMode =
        state.mode === "defender" ||
        (state.mode === "matrix" &&
            state.matrixViewScope !== "all_vs_all" &&
            (state.matrixMode === "defense_ehp" || state.matrixMode === "defense_skill"));
    const slots = [
        { key: "A", badge: isDefMode ? "Defender A" : "Build A", badgeCls: "badge-a", cardCls: "card-a" },
        { key: "B", badge: isDefMode ? "Defender B" : "Build B", badgeCls: "badge-b", cardCls: "card-b" },
        { key: "defender", badge: isDefMode ? "Aggressor" : "Target / Def", badgeCls: "badge-def", cardCls: "card-def" },
    ];

    syncCompactBuildsToggleBtn();
    grid.classList.toggle("is-compact", Boolean(state.buildsCollapsed));

    if (state.buildsCollapsed) {
        renderCompactBuildPills(grid, slots);
        return;
    }

    const modCatalog = buildModifierCatalog();
    grid.innerHTML = slots.map((slot) => renderCharacterCardHtml(slot, modCatalog)).join("");
    grid.querySelectorAll(".char-card").forEach((card) => {
        bindCharacterCardEvents(card, card.dataset.slot);
    });
}

// ============================================================================
// Build A vs. B Live Diff Strip
// ============================================================================
export function renderBuildDiffStrip() {
    const host = document.getElementById("buildDiffStrip");
    if (!host) return;

    const effA = applyModifiers(state.buildA, getSlotModifiers("A"));
    const effB = applyModifiers(state.buildB, getSlotModifiers("B"));
    const effDef = applyModifiers(state.defender, getSlotModifiers("defender"));
    const isPvE = Boolean(document.getElementById("ctxPvE")?.checked);
    const isDefMode = state.mode === "defender";
    const disableAvoidance = getEffectiveDefenderDisableAvoidance();

    const calcA = computeEffectiveStats(effA, effDef, {}, { isPvE, disableAvoidance });
    const calcB = computeEffectiveStats(effB, effDef, {}, { isPvE, disableAvoidance });

    const diffs = [];
    const pushDiff = (label, valA, valB, fmt, opts = {}) => {
        const d = valA - valB;
        const eps = fmt === "sec" ? 0.005 : 0.05;
        if (Math.abs(d) < eps) return;
        const aBetter = opts.lowerBetter ? d < 0 : d > 0;
        const fmtOne = (v) => {
            if (fmt === "int") return fmtInt(v);
            if (fmt === "pct") return `${fmtCleanNum(v, 1)}%`;
            if (fmt === "sec") return `${fmtDec(v, 2)}s`;
            return fmtCleanNum(v, 1);
        };
        const deltaStr = fmt === "sec" ? `${d > 0 ? "+" : ""}${fmtDec(d, 2)}s` : fmtBuffedDelta(d, fmt);
        diffs.push({
            label,
            aStr: fmtOne(valA),
            bStr: fmtOne(valB),
            deltaStr,
            cls: aBetter ? "delta-pos" : "delta-neg",
            isEff: Boolean(opts.isEff),
        });
    };

    if (isDefMode) {
        pushDiff("Melee EHP", calcA.defense.ehp.melee.vsAttackerEhp, calcB.defense.ehp.melee.vsAttackerEhp, "int", { isEff: true });
        pushDiff("Ranged EHP", calcA.defense.ehp.ranged.vsAttackerEhp, calcB.defense.ehp.ranged.vsAttackerEhp, "int", { isEff: true });
        pushDiff("Magic EHP", calcA.defense.ehp.magic.vsAttackerEhp, calcB.defense.ehp.magic.vsAttackerEhp, "int", { isEff: true });
    } else if (state.mode === "healing") {
        pushDiff("Eff. Heal Power", calcA.offense.healing.selfEffectiveHealingPower, calcB.offense.healing.selfEffectiveHealingPower, "int", { isEff: true });
        pushDiff("Eff. Heal / Cast", calcA.offense.healing.castAdjustedHealingPower, calcB.offense.healing.castAdjustedHealingPower, "int", { isEff: true });
        pushDiff("Eff. GCD", calcA.offense.speed.effectiveGcdSec, calcB.offense.speed.effectiveGcdSec, "sec", { isEff: true, lowerBetter: true });
    } else {
        pushDiff("Eff. Melee Atk", calcA.offense.melee.vsTargetEffectiveAttack, calcB.offense.melee.vsTargetEffectiveAttack, "int", { isEff: true });
        pushDiff("Eff. Ranged Atk", calcA.offense.ranged.vsTargetEffectiveAttack, calcB.offense.ranged.vsTargetEffectiveAttack, "int", { isEff: true });
        pushDiff("Eff. Magic Atk", calcA.offense.magic.vsTargetEffectiveAttack, calcB.offense.magic.vsTargetEffectiveAttack, "int", { isEff: true });
        pushDiff("Eff. Heal Power", calcA.offense.healing.selfEffectiveHealingPower, calcB.offense.healing.selfEffectiveHealingPower, "int", { isEff: true });
        pushDiff("Eff. GCD", calcA.offense.speed.effectiveGcdSec, calcB.offense.speed.effectiveGcdSec, "sec", { isEff: true, lowerBetter: true });
    }

    const primaryGroup = isDefMode ? "defense" : "offense";
    const secondaryGroup = isDefMode ? "offense" : "defense";
    for (const grp of ["core", primaryGroup, secondaryGroup]) {
        for (const def of BUFFED_STAT_DEFS) {
            if (def.group !== grp) continue;
            const vA = def.section === "root" ? Number(effA[def.key]) || 0 : Number(effA[def.section]?.[def.key]) || 0;
            const vB = def.section === "root" ? Number(effB[def.key]) || 0 : Number(effB[def.section]?.[def.key]) || 0;
            pushDiff(def.label, vA, vB, def.fmt, { lowerBetter: def.key === "castTimePct" });
        }
    }

    const modsAList = getSlotModifiers("A");
    const modsBList = getSlotModifiers("B");
    const modSetA = new Set(modsAList);
    const modSetB = new Set(modsBList);
    const fmtModTokName = (tok) => {
        const parsed = parseModifierToken(tok);
        const mod = COMBAT_MODIFIERS[parsed.id];
        if (!mod) return tok;
        const baseName = mod.name.split(" (")[0];
        if (parsed.rank != null) return `${baseName} R${parsed.rank}`;
        if (parsed.stacks != null && mod.maxStacks > 1) return `${baseName} ×${parsed.stacks}`;
        return baseName;
    };
    const buffsOnlyA = modsAList.filter((t) => !modSetB.has(t)).map(fmtModTokName);
    const buffsOnlyB = modsBList.filter((t) => !modSetA.has(t)).map(fmtModTokName);
    const buffDiffCount = buffsOnlyA.length + buffsOnlyB.length;

    const eqA = normalizeEquipmentList(state.buildA.equipment);
    const eqB = normalizeEquipmentList(state.buildB.equipment);
    const catalog = getGearCatalog();
    const econPriceBook = normalizeEconomyPriceBook(state.economyPriceBook || loadEconomyPriceBookFromStorage());
    const econAhPrices = state.economyAhPrices || null;
    const costA = estimateBuildCost(state.buildA, econPriceBook, catalog, econAhPrices);
    const costB = estimateBuildCost(state.buildB, econPriceBook, catalog, econAhPrices);
    const costDelta = Math.round(costA.totalGold - costB.totalGold);
    const showCostDelta = (costA.totalGold > 0 || costB.totalGold > 0) && Math.abs(costDelta) >= 1;
    const costSlotMapA = new Map(costA.slotBreakdown.map((s) => [Number(s.slotId), s]));
    const costSlotMapB = new Map(costB.slotBreakdown.map((s) => [Number(s.slotId), s]));

    const fmtGearSlotMeta = (it) => {
        if (!it) return "";
        const bits = [];
        const tmp = Math.max(Number(it.ptemper) || 0, Number(it.mtemper) || 0);
        if (tmp > 100) bits.push(`${tmp}%`);
        if (Array.isArray(it.lunagems) && it.lunagems.length > 0) bits.push(`${it.lunagems.length}g`);
        if (it.lunafrost?.name) bits.push(it.lunafrost.name.replace(/\s+Lunafrost|\s+Lunadrop/i, ""));
        return bits.join(" · ");
    };

    const gearDiffs = [];
    if (eqA.length > 0 && eqB.length > 0) {
        const mapA = new Map(eqA.map((x) => [x.slotId, x]));
        const mapB = new Map(eqB.map((x) => [x.slotId, x]));
        const allSlotIds = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort((a, b) => a - b);
        for (const sid of allSlotIds) {
            const itA = mapA.get(sid);
            const itB = mapB.get(sid);
            if (gearItemFingerprint(itA) !== gearItemFingerprint(itB)) {
                const gA = itA ? resolveGearGradeInfo(itA.gradeId, itA.gradeName, itA.gradeColor) : null;
                const gB = itB ? resolveGearGradeInfo(itB.gradeId, itB.gradeName, itB.gradeColor) : null;
                const cA = costSlotMapA.get(sid)?.slotTotalGold ?? null;
                const cB = costSlotMapB.get(sid)?.slotTotalGold ?? null;
                gearDiffs.push({
                    slotId: sid,
                    slotName: itA?.slotName || itB?.slotName || `Slot ${sid}`,
                    lblA: itA ? `${itA.gradeName ? `[${itA.gradeName}] ` : ""}${itA.name}` : "Empty",
                    lblB: itB ? `${itB.gradeName ? `[${itB.gradeName}] ` : ""}${itB.name}` : "Empty",
                    colorA: gA?.color || null,
                    colorB: gB?.color || null,
                    metaA: fmtGearSlotMeta(itA),
                    metaB: fmtGearSlotMeta(itB),
                    costA: cA,
                    costB: cB,
                    costDelta: cA !== null || cB !== null ? (cA || 0) - (cB || 0) : null,
                });
            }
        }
    }

    // Stat Migration diff (when persisted baseAttributes differ between Build A and B)
    const migDiffParts = [];
    const baA = state.buildA.baseAttributes;
    const baB = state.buildB.baseAttributes;
    if (baA && baB) {
        for (const [k, lbl] of [
            ["str", "STR"],
            ["agi", "AGI"],
            ["sta", "STA"],
            ["int", "INT"],
            ["spi", "SPI"],
        ]) {
            const dA = Math.round((Number(baA[k]) || 158) - 158);
            const dB = Math.round((Number(baB[k]) || 158) - 158);
            if (dA !== dB) {
                migDiffParts.push(`${lbl} ${dA >= 0 ? "+" : ""}${dA} vs ${dB >= 0 ? "+" : ""}${dB}`);
            }
        }
    }

    const totalDiffCount = diffs.length + gearDiffs.length + buffDiffCount;
    const costChipHtml = showCostDelta
        ? `<span class="diff-inline-chip diff-cost-chip" title="Estimated Gold Cost: ${escHtml(state.buildA.name)} ${fmtInt(costA.totalGold)}g vs ${escHtml(state.buildB.name)} ${fmtInt(costB.totalGold)}g"><span class="diff-pill-k">Cost</span> <strong class="${costDelta < 0 ? "delta-pos" : "delta-neg"}">${costDelta > 0 ? "+" : "-"}${fmtInt(Math.abs(costDelta))}g</strong></span>`
        : "";
    const inlinePreviewPills =
        costChipHtml +
        diffs
            .filter((d) => !d.isEff)
            .slice(0, 4)
            .map(
                (d) =>
                    `<span class="diff-inline-chip"><span class="diff-pill-k">${escHtml(d.label)}</span> <strong class="${d.cls}">${escHtml(d.deltaStr)}</strong></span>`
            )
            .join("");

    const gearDiffTableHtml =
        gearDiffs.length > 0
            ? `<div class="diff-gear-table-wrap">
                   <table class="diff-gear-table mobile-card-table">
                       <thead>
                           <tr>
                               <th style="width:105px">Changed Slot (${gearDiffs.length})</th>
                               <th>Build A: ${escHtml(state.buildA.name)}</th>
                               <th>Build B: ${escHtml(state.buildB.name)}</th>
                               <th style="width:92px">&Delta; Gold</th>
                           </tr>
                       </thead>
                       <tbody>
                           ${gearDiffs
                               .map((g) => {
                                   const dGoldStr =
                                       g.costDelta === null
                                           ? "&mdash;"
                                           : g.costDelta === 0
                                             ? "0g"
                                             : `${g.costDelta > 0 ? "+" : "-"}${fmtInt(Math.abs(g.costDelta))}g`;
                                   const dGoldCls =
                                       g.costDelta === null || g.costDelta === 0
                                           ? "delta-tie"
                                           : g.costDelta < 0
                                             ? "delta-pos"
                                             : "delta-neg";
                                   return `
                           <tr>
                               <td><strong>${escHtml(g.slotName)}</strong></td>
                               <td class="mct-full" data-label="Build A">
                                   <div class="diff-gear-name"${g.colorA ? ` style="color:${escHtml(g.colorA)}"` : ""}>${escHtml(g.lblA)}</div>
                                   ${g.metaA || g.costA !== null ? `<div class="diff-gear-meta">${escHtml(g.metaA)}${g.costA !== null ? `${g.metaA ? " · " : ""}<span class="gb-pd-gold">${fmtInt(g.costA)}g</span>` : ""}</div>` : ""}
                               </td>
                               <td class="mct-full" data-label="Build B">
                                   <div class="diff-gear-name"${g.colorB ? ` style="color:${escHtml(g.colorB)}"` : ""}>${escHtml(g.lblB)}</div>
                                   ${g.metaB || g.costB !== null ? `<div class="diff-gear-meta">${escHtml(g.metaB)}${g.costB !== null ? `${g.metaB ? " · " : ""}<span class="gb-pd-gold">${fmtInt(g.costB)}g</span>` : ""}</div>` : ""}
                               </td>
                               <td class="${dGoldCls} mct-full" data-label="Δ Gold" style="font-weight:700;white-space:nowrap">${dGoldStr}</td>
                           </tr>`;
                               })
                               .join("")}
                       </tbody>
                   </table>
               </div>`
            : "";

    host.innerHTML = `
        <details class="build-diff-details" ${state.buildDiffOpen ? "open" : ""}>
            <summary>
                <span class="diff-summary-left">
                    <span class="diff-chevron" aria-hidden="true">${state.buildDiffOpen ? "&#9662;" : "&#9656;"}</span>
                    <span>Build A vs. B Diff</span>
                    <span class="diff-count-badge">${totalDiffCount > 0 ? `${diffs.length} stat${diffs.length === 1 ? "" : "s"}${gearDiffs.length > 0 ? ` • ${gearDiffs.length} gear` : ""}${buffDiffCount > 0 ? ` • ${buffDiffCount} buff${buffDiffCount === 1 ? "" : "s"}` : ""}` : "Identical"}</span>
                </span>
                ${
                    !state.buildDiffOpen && inlinePreviewPills
                        ? `<span class="diff-inline-preview">${inlinePreviewPills}</span>`
                        : `<span class="hint-inline"><span class="val-a">${escHtml(state.buildA.name)}</span> vs <span class="val-b">${escHtml(state.buildB.name)}</span> (post-buff)${showCostDelta ? ` &bull; <strong class="${costDelta < 0 ? "delta-pos" : "delta-neg"}">${costDelta > 0 ? "+" : "-"}${fmtInt(Math.abs(costDelta))}g</strong>` : ""}</span>`
                }
                <span class="diff-quick-actions">
                    <button type="button" class="sm" id="toggleBuildDiffBtn" title="Expand or collapse the Build A vs. B stat &amp; gear diff pills">${state.buildDiffOpen ? "Hide Diff &#9652;" : "Show Diff &#9662;"}</button>
                    <button type="button" class="sm" id="swapAandBQuickBtn" title="Swap Build A and Build B (stats, gear &amp; active buffs)">Swap A &harr; B</button>
                    <button type="button" class="sm" id="swapAandTargetQuickBtn" title="Swap Build A and the 3rd card (Target / Aggressor)">Swap A &harr; Target</button>
                    <button type="button" class="sm" id="cloneAtoBQuickBtn" title="Copy Build A stats, equipment, and buffs into Build B as a baseline">Clone A &rarr; B</button>
                </span>
            </summary>
            ${
                showCostDelta || migDiffParts.length > 0
                    ? `<div class="diff-pills-wrap">
                        ${showCostDelta ? `<span class="diff-pill diff-cost-chip"><span class="diff-pill-k">Est. Gold Cost:</span> <span class="val-a">${fmtInt(costA.totalGold)}g</span> <span class="diff-pill-vs">vs</span> <span class="val-b">${fmtInt(costB.totalGold)}g</span> <strong class="${costDelta < 0 ? "delta-pos" : "delta-neg"}">(${costDelta > 0 ? "+" : "-"}${fmtInt(Math.abs(costDelta))}g)</strong></span>` : ""}
                        ${migDiffParts.length > 0 ? `<span class="diff-pill"><span class="diff-pill-k">Stat Migration:</span> ${escHtml(migDiffParts.join(" · "))}</span>` : ""}
                       </div>`
                    : ""
            }
            ${
                buffDiffCount > 0
                    ? `<div class="diff-pills-wrap">
                        ${buffsOnlyA.length > 0 ? `<span class="diff-pill diff-buff-a"><span class="diff-pill-k">Only on A:</span> <span class="val-a">${escHtml(buffsOnlyA.join(", "))}</span></span>` : ""}
                        ${buffsOnlyB.length > 0 ? `<span class="diff-pill diff-buff-b"><span class="diff-pill-k">Only on B:</span> <span class="val-b">${escHtml(buffsOnlyB.join(", "))}</span></span>` : ""}
                       </div>`
                    : ""
            }
            ${gearDiffTableHtml}
            ${
                diffs.length > 0
                    ? `<div class="diff-pills-wrap">${diffs
                          .map(
                              (d) =>
                                  `<span class="diff-pill ${d.isEff ? "diff-eff" : ""}">
                                      <span class="diff-pill-k">${escHtml(d.label)}:</span>
                                      <span class="val-a">${escHtml(d.aStr)}</span>
                                      <span class="diff-pill-vs">vs</span>
                                      <span class="val-b">${escHtml(d.bStr)}</span>
                                      <strong class="${d.cls}">(${escHtml(d.deltaStr)})</strong>
                                  </span>`
                          )
                          .join("")}</div>`
                    : gearDiffs.length === 0 && buffDiffCount === 0
                      ? `<div class="hint-inline" style="margin-top:6px">Build A and Build B currently have identical post-buff stats.</div>`
                      : ""
            }
        </details>
    `;

    const det = host.querySelector("details");
    const toggleDiffBtn = document.getElementById("toggleBuildDiffBtn");
    const chevronEl = host.querySelector(".diff-chevron");
    const syncDiffChrome = () => {
        if (!det) return;
        state.buildDiffOpen = det.open;
        try {
            localStorage.setItem("aac_damage_sim_diff_open_v1", det.open ? "1" : "0");
        } catch {
            // Ignore storage errors
        }
        if (chevronEl) chevronEl.innerHTML = det.open ? "&#9662;" : "&#9656;";
        if (toggleDiffBtn) toggleDiffBtn.innerHTML = det.open ? "Hide Diff &#9652;" : "Show Diff &#9662;";
    };
    det?.addEventListener("toggle", syncDiffChrome);
    toggleDiffBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (det) {
            det.open = !det.open;
            syncDiffChrome();
        }
    });
    document.getElementById("swapAandBQuickBtn")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        swapBuildSlots("A", "B");
    });
    document.getElementById("swapAandTargetQuickBtn")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        swapBuildSlots("A", "defender");
    });
    document.getElementById("cloneAtoBQuickBtn")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        cloneBuildSlot("A", "B");
    });
}
