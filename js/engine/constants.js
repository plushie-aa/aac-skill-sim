/**
 * ArcheAge Classic 1.3.6 (3.5) verified combat & healing constants.
 * Verified against live client unitInfo observations and DaruGear 1.3.6 formulas.
 */

let _appVersion = "";

export function getAppVersion() {
    return _appVersion;
}

export function setAppVersion(rawVersion) {
    const clean = String(rawVersion || "").trim().replace(/^v/i, "");
    if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(clean)) {
        _appVersion = clean;
    }
    return _appVersion;
}

export const DEFAULT_CONSTANTS = Object.freeze({
    gameVersion: "ArcheAge Classic 1.3.6 (3.5)",
    level: 55,

    // Verified live against AA Classic 1.3.6 unitInfo:
    // armor=3975 -> 33.4737% (3975 / (3975 + 7900))
    // magic_resist=11612 -> 59.5121% (11612 / (11612 + 7900))
    defenseK: 7900,

    // Confirmed from DaruGear AA Classic 1.3.6 tooltips
    toughnessK: 8000,
    resilienceCritRateK: 32000,
    resilienceCritBonusK: 18000,
    focusNegationPctPerPoint: 0.0027,

    // Critical hit bounds
    baseCritBonusPct: 50,
    maxCritBonusPct: 300,
    minEffectiveCritBonusPct: 0,

    // Classic 3.5 shield block negates 100% of blocked physical hit (0.0 multiplier).
    // Configurable if testing partial-block rules.
    shieldBlockDamageMultiplier: 0.0,

    // Avoidance roll model:
    //  - "additive": AA Classic single-roll priority table (Evade -> Parry -> Block)
    //  - "multiplicative": Independent sequential rolls (1 - Ev) * (1 - Pa) * (1 - Bl)
    avoidanceModel: "additive",

    // Confirmed live from Dump 1 vs Dump 2:
    // Holy Bolt, Antithesis (Damage), and Skewer scale with heal_mul, not spell_damage_mul.
    vitalismDamageUsesHealMul: true,

    // Floor for non-avoided damaging hits
    minFinalDamage: 1,

    // Base Global Cooldown (seconds) and AA Classic Attack Speed scaling:
    // GCD% = 100 / (1 + attackSpeedScale * attackSpeedRating)
    // e.g. 0 -> 100% (1.00s GCD), 177 (Dual Wield) -> 85.0% (0.85s), 500 (Berserk) -> 66.7% (0.67s)
    baseGcdSec: 1.0,
    attackSpeedScale: 0.001,
});

const NUMERIC_CONSTANT_BOUNDS = Object.freeze({
    level: [1, 100],
    defenseK: [1, 1000000],
    toughnessK: [1, 1000000],
    resilienceCritRateK: [1, 1000000],
    resilienceCritBonusK: [1, 1000000],
    focusNegationPctPerPoint: [0, 1],
    baseCritBonusPct: [0, 500],
    maxCritBonusPct: [0, 1000],
    minEffectiveCritBonusPct: [0, 500],
    shieldBlockDamageMultiplier: [0, 1],
    minFinalDamage: [0, 10000],
    baseGcdSec: [0.05, 10],
    attackSpeedScale: [0, 0.05],
});

let _runtimeOverrides = {};

export function setRuntimeConstantsOverrides(overrides = {}) {
    if (!overrides || typeof overrides !== "object") {
        _runtimeOverrides = {};
        return;
    }
    const clean = {};
    for (const [k, v] of Object.entries(overrides)) {
        if (!(k in DEFAULT_CONSTANTS) || v == null || v === "") continue;
        if (k === "avoidanceModel") {
            if (v === "additive" || v === "multiplicative") clean[k] = v;
        } else if (typeof DEFAULT_CONSTANTS[k] === "boolean") {
            clean[k] = Boolean(v);
        } else if (typeof DEFAULT_CONSTANTS[k] === "number") {
            const n = Number(v);
            if (Number.isFinite(n)) {
                const bounds = NUMERIC_CONSTANT_BOUNDS[k];
                clean[k] = bounds ? Math.min(bounds[1], Math.max(bounds[0], n)) : n;
            }
        }
    }
    _runtimeOverrides = clean;
}

export function getRuntimeConstantsOverrides() {
    return { ..._runtimeOverrides };
}

export function mergeConstants(overrides = {}) {
    const base = { ...DEFAULT_CONSTANTS, ..._runtimeOverrides };
    if (!overrides || typeof overrides !== "object") {
        return base;
    }
    return { ...base, ...overrides };
}
