/**
 * ArcheAge Classic 1.3.6 (3.5) Rotation Status, Debuff & Damage/Heal Combo Registry.
 * Pure data + helpers (zero DOM dependencies).
 *
 * Models live AA Classic combo interactions automatically across a Rotation timeline:
 *  - Status grants (Resurgence, Snared, Slowed, Shaken, Freezing, Shocked, Stunned, Tripped, Impaled)
 *  - Auto-CC avoidance bypass when target is Stunned / Tripped / Impaled
 *  - Auto-debuff application (Stalker's Mark / Enervate -60% Recv Heal, Dissonance -320 MDef, Wallop -480 PDef)
 *  - Auto damage & healing combo multipliers (Resurgence -> Mend +30%, Shocked/Impaled -> Arc Lightning +43%/+45%,
 *    Freezing -> Chain Lightning +30% / Flamebolt +12%, Slowed -> Piercing Shot +26%, Tripped/Shaken melee combos)
 */

export const SKILL_STATUS_GRANTS = Object.freeze({
    vitalism_resurgence: [{ status: "resurgence", label: "Resurgence", durationSec: 10.0, targetSide: "ally" }],

    battlerage_charge: [{ status: "snared", label: "Snared", durationSec: 3.5 }],
    battlerage_behind_enemy_lines: [{ status: "snared", label: "Snared", durationSec: 3.5 }],
    battlerage_triple_slash: [{ status: "shaken", label: "Shaken", durationSec: 3.0 }],
    battlerage_triple_slash_lightning: [{ status: "shaken", label: "Shaken", durationSec: 3.0 }],
    battlerage_triple_slash_quake: [{ status: "shaken", label: "Shaken", durationSec: 3.0 }],
    battlerage_whirlwind_slash: [
        { status: "tripped", label: "Tripped", durationSec: 2.5, isCC: true, requiresAny: ["slowed", "shaken"] },
    ],

    defense_shield_slam: [{ status: "stunned", label: "Stunned", durationSec: 2.0, isCC: true }],
    defense_bull_rush: [
        { status: "tripped", label: "Tripped", durationSec: 2.5, isCC: true, requiresAny: ["stunned"] },
    ],

    shadowplay_overwhelm: [{ status: "stunned", label: "Stunned", durationSec: 1.4, isCC: true }],
    shadowplay_overwhelm_gale: [
        { status: "stunned", label: "Stunned", durationSec: 1.4, isCC: true },
        {
            status: "gale_overwhelm_crit",
            label: "Flame Overwhelm (+100% Crit)",
            durationSec: 6.0,
            requiresBackstab: true,
            consumesOnUse: true,
        },
    ],
    shadowplay_toxic_shot: [{ status: "poisoned", label: "Poisoned", durationSec: 10.0 }],

    archery_charged_bolt: [{ status: "slowed", label: "Slowed", durationSec: 2.5 }],
    archery_charged_bolt_short: [{ status: "slowed", label: "Slowed", durationSec: 2.5 }],
    archery_charged_bolt_fast: [{ status: "slowed", label: "Slowed", durationSec: 2.5 }],
    archery_snipe: [{ status: "tripped", label: "Tripped", durationSec: 3.0, isCC: true, requiresAny: ["snared"] }],

    sorcery_freezing_arrow: [{ status: "freezing", label: "Freezing", durationSec: 4.0 }],
    sorcery_freezing_earth: [{ status: "freezing", label: "Freezing", durationSec: 4.0 }],
    sorcery_frigid_tracks: [{ status: "freezing", label: "Freezing", durationSec: 4.0 }],
    sorcery_chain_lightning: [{ status: "shocked", label: "Shocked", durationSec: 8.0 }],
    sorcery_chain_lightning_flame: [{ status: "shocked", label: "Shocked", durationSec: 8.0 }],
    sorcery_chain_lightning_wave: [{ status: "shocked", label: "Shocked", durationSec: 8.0 }],
    sorcery_gods_whip: [{ status: "shocked", label: "Shocked", durationSec: 8.0 }],
    sorcery_flamebolt_lightning: [{ status: "shocked", label: "Shocked", durationSec: 8.0 }],
    sorcery_meteor_strike_lightning: [{ status: "shocked", label: "Shocked", durationSec: 8.0 }],

    occultism_hell_spear: [{ status: "impaled", label: "Impaled", durationSec: 2.5, isCC: true }],
    occultism_hell_spear_single: [{ status: "impaled", label: "Impaled", durationSec: 2.5, isCC: true }],
    occultism_hell_spear_flame: [{ status: "impaled", label: "Impaled", durationSec: 2.5, isCC: true }],
    vitalism_skewer: [{ status: "impaled", label: "Impaled", durationSec: 2.5, isCC: true }],
    vitalism_skewer_multi: [{ status: "impaled", label: "Impaled", durationSec: 2.5, isCC: true }],

    auramancy_comets_boon_hollow: [{ status: "slowed", label: "Slowed", durationSec: 3.0 }],
    witchcraft_focal_concussion: [{ status: "stunned", label: "Stunned", durationSec: 1.5, isCC: true }],
    witchcraft_focal_concussion_hollow: [{ status: "stunned", label: "Stunned", durationSec: 1.5, isCC: true }],
    songcraft_critical_discord_hollow: [{ status: "charmed", label: "Charmed", durationSec: 8.0 }],
});

export const SKILL_DEBUFF_GRANTS = Object.freeze({
    shadowplay_stalkers_mark: {
        id: "stalkers_mark",
        label: "Stalker's Mark (-60% Heal)",
        durationSec: 12.0,
        addDefense: { receivedHealingPct: -60 },
    },
    witchcraft_enervate: {
        id: "enervate",
        label: "Enervate (-60% Heal)",
        durationSec: 5.0,
        addDefense: { receivedHealingPct: -60 },
    },
    songcraft_dissonance: {
        id: "dissonance",
        label: "Dissonance (-320 MDef)",
        durationSec: 6.0,
        addDefense: { magicDefense: -320 },
    },
    shadowplay_wallop: {
        id: "wallop_shred",
        label: "Wallop (-480 PDef)",
        durationSec: 5.0,
        addDefense: { physicalDefense: -480 },
    },
});

export const TARGET_COMBO_STATUSES = Object.freeze([
    { id: "shocked", label: "Shocked", source: "Chain Lightning / Gods' Whip", isCC: false },
    { id: "freezing", label: "Freezing", source: "Freezing Arrow / Earth / Frigid Tracks", isCC: false },
    { id: "impaled", label: "Impaled", source: "Hell Spear / Skewer", isCC: true },
    { id: "tripped", label: "Tripped", source: "Whirlwind / Bull Rush / Meteor", isCC: true },
    { id: "shaken", label: "Shaken", source: "Triple Slash", isCC: false },
    { id: "slowed", label: "Slowed", source: "Charged Bolt / Comet's Boon", isCC: false },
    { id: "snared", label: "Snared", source: "Charge / Earthen Grip / Freezing Earth", isCC: false },
    { id: "stunned", label: "Stunned", source: "Overwhelm / Shield Slam / Focal Concussion", isCC: true },
    { id: "burning", label: "Burning", source: "Flamebolt", isCC: false },
    { id: "bleeding", label: "Bleeding", source: "Piercing Shot / Pin Down", isCC: false },
    { id: "poisoned", label: "Poisoned", source: "Toxic Shot", isCC: false },
    { id: "distressed", label: "Distressed", source: "Boastful Roar / Leech", isCC: false },
    { id: "charmed", label: "Charmed", source: "Startling Strain / Hollow Crit Discord", isCC: false },
    { id: "resurgence", label: "Resurgence", source: "Vitalism Ally HoT", isCC: false, targetSide: "ally" },
]);

const TARGET_STATUS_BY_ID = new Map(TARGET_COMBO_STATUSES.map((s) => [s.id, s]));

export const SKILL_COMBO_BONUSES = Object.freeze({
    vitalism_mend: [
        { requires: "resurgence", comboBonusPct: 30, label: "Resurgence +30% Heal" },
    ],
    vitalism_antithesis_heal: [
        { requires: "resurgence", comboBonusPct: 15, label: "Resurgence +15% Heal" },
    ],
    vitalism_skewer: [
        { requires: "charmed", comboBonusPct: 20, label: "Charmed +20%" },
        { requires: "distressed", comboBonusPct: 18, label: "Distressed +18%" },
    ],
    vitalism_skewer_multi: [
        { requires: "charmed", comboBonusPct: 20, label: "Charmed +20%" },
        { requires: "distressed", comboBonusPct: 18, label: "Distressed +18%" },
    ],
    sorcery_arc_lightning: [
        { requires: "impaled", comboBonusPct: 45, label: "Impaled +45%" },
        { requires: "shocked", comboBonusPct: 43, label: "Shocked +43%" },
    ],
    sorcery_chain_lightning: [
        { requires: "freezing", comboBonusPct: 30, label: "Freezing +30%" },
    ],
    sorcery_chain_lightning_flame: [
        { requires: "freezing", comboBonusPct: 30, label: "Freezing +30%" },
    ],
    sorcery_chain_lightning_wave: [
        { requires: "freezing", comboBonusPct: 30, label: "Freezing +30%" },
    ],
    sorcery_flamebolt: [
        { requires: "freezing", comboBonusPct: 12, label: "Freezing +12%" },
    ],
    sorcery_flamebolt_flame: [
        { requires: "freezing", comboBonusPct: 12, label: "Freezing +12%" },
    ],
    sorcery_flamebolt_lightning: [
        { requires: "shocked", comboBonusPct: 12, label: "Shocked +12%" },
    ],
    sorcery_freezing_arrow: [
        { requires: "burning", comboBonusPct: 16, label: "Burning +16%" },
        { requires: "shocked", comboBonusPct: 14, label: "Shocked +14%" },
    ],
    sorcery_freezing_earth: [
        { requires: "burning", comboBonusPct: 20, label: "Burning +20%" },
    ],
    sorcery_meteor_strike: [
        { requires: "burning", comboBonusPct: 30, label: "Burning +30%" },
        { requires: "freezing", comboBonusPct: 25, label: "Freezing +25%" },
    ],
    sorcery_meteor_strike_wave: [
        { requires: "burning", comboBonusPct: 30, label: "Burning +30%" },
        { requires: "freezing", comboBonusPct: 25, label: "Freezing +25%" },
    ],
    sorcery_meteor_strike_lightning: [
        { requires: "burning", comboBonusPct: 30, label: "Burning +30%" },
        { requires: "freezing", comboBonusPct: 25, label: "Freezing +25%" },
    ],
    sorcery_gods_whip: [
        { requires: "shocked", comboBonusPct: 14, label: "Shocked +14%" },
        { requires: "freezing", comboBonusPct: 12, label: "Freezing +12%" },
    ],
    archery_piercing_shot: [
        { requires: "slowed", comboBonusPct: 26, label: "Slowed +26%" },
        { requires: "bleeding", comboBonusPct: 16, label: "Bleeding +16%" },
    ],
    archery_charged_bolt: [
        { requires: "poisoned", comboBonusPct: 17, label: "Poisoned +17%" },
        { requires: "shocked", comboBonusPct: 14, label: "Shocked +14%" },
    ],
    archery_charged_bolt_short: [
        { requires: "poisoned", comboBonusPct: 17, label: "Poisoned +17%" },
        { requires: "shocked", comboBonusPct: 14, label: "Shocked +14%" },
    ],
    archery_charged_bolt_fast: [
        { requires: "poisoned", comboBonusPct: 17, label: "Poisoned +17%" },
        { requires: "shocked", comboBonusPct: 14, label: "Shocked +14%" },
    ],
    archery_concussive_arrow: [
        { requires: "snared", comboBonusPct: 18, label: "Snared +18%" },
        { requires: "slowed", comboBonusPct: 14, label: "Slowed +14%" },
    ],
    archery_concussive_arrow_charge: [
        { requires: "snared", comboBonusPct: 18, label: "Snared +18%" },
        { requires: "slowed", comboBonusPct: 14, label: "Slowed +14%" },
    ],
    archery_concussive_arrow_smoke: [
        { requires: "snared", comboBonusPct: 18, label: "Snared +18%" },
        { requires: "slowed", comboBonusPct: 14, label: "Slowed +14%" },
    ],
    archery_snipe: [
        { requires: "snared", comboBonusPct: 18, label: "Snared +18%" },
        { requires: "slowed", comboBonusPct: 14, label: "Slowed +14%" },
    ],
    battlerage_whirlwind_slash: [
        { requires: "tripped", comboBonusPct: 26, label: "Tripped +26%" },
        { requires: "shaken", comboBonusPct: 26, label: "Shaken +26%" },
    ],
    battlerage_triple_slash: [
        { requires: "tripped", comboBonusPct: 20, label: "Tripped +20%" },
        { requires: "snared", comboBonusPct: 12, label: "Snared +12%" },
    ],
    battlerage_triple_slash_lightning: [
        { requires: "tripped", comboBonusPct: 20, label: "Tripped +20%" },
        { requires: "snared", comboBonusPct: 12, label: "Snared +12%" },
    ],
    battlerage_triple_slash_quake: [
        { requires: "tripped", comboBonusPct: 20, label: "Tripped +20%" },
        { requires: "snared", comboBonusPct: 12, label: "Snared +12%" },
    ],
    battlerage_precision_strike: [
        { requires: "bleeding", comboBonusPct: 20, label: "Bleeding +20%" },
        { requires: "distressed", comboBonusPct: 18, label: "Distressed +18%" },
    ],
    battlerage_sunder_earth: [
        { requires: "shaken", comboBonusPct: 20, label: "Shaken +20%" },
        { requires: "tripped", comboBonusPct: 20, label: "Tripped +20%" },
    ],
    battlerage_tiger_strike: [
        { requires: "snared", comboBonusPct: 18, label: "Snared +18%" },
    ],
    battlerage_charge: [
        { requires: "slowed", comboBonusPct: 15, label: "Slowed +15%" },
    ],
    shadowplay_shadowsmite: [
        { requires: "tripped", comboBonusPct: 30, label: "Tripped +30%" },
        { requires: "distressed", comboBonusPct: 24, label: "Distressed +24%" },
    ],
    shadowplay_pin_down: [
        { requires: "bleeding", comboBonusPct: 24, label: "Bleeding +24%" },
        { requires: "stunned", comboBonusPct: 18, label: "Stunned +18%" },
    ],
    shadowplay_overwhelm: [
        { requires: "poisoned", comboBonusPct: 16, label: "Poisoned +16%" },
    ],
    shadowplay_overwhelm_gale: [
        { requires: "poisoned", comboBonusPct: 16, label: "Poisoned +16%" },
    ],
    shadowplay_wallop: [
        { requires: "bleeding", comboBonusPct: 20, label: "Bleeding +20%" },
        { requires: "tripped", comboBonusPct: 20, label: "Tripped +20%" },
    ],
    defense_shield_slam: [
        { requires: "shaken", comboBonusPct: 20, label: "Shaken +20%" },
    ],
    defense_bull_rush: [
        { requires: "stunned", comboBonusPct: 24, label: "Stunned +24%" },
    ],
    defense_boastful_roar: [
        { requires: "shaken", comboBonusPct: 25, label: "Shaken +25%" },
    ],
    occultism_mana_stars: [
        { requires: "distressed", comboBonusPct: 15, label: "Distressed +15%" },
    ],
    occultism_summon_wraith: [
        { requires: "impaled", comboBonusPct: 20, label: "Impaled +20%" },
    ],
});

/**
 * Return the list of combo status rules applicable to a given skill (for contextual UI pills).
 */
export function getSkillComboOptions(skill) {
    const rules = SKILL_COMBO_BONUSES[skill?.id] || [];
    return rules.map((r) => {
        const meta = TARGET_STATUS_BY_ID.get(r.requires);
        return {
            status: r.requires,
            comboBonusPct: r.comboBonusPct,
            label: r.label,
            statusLabel: meta?.label || r.requires,
            source: meta?.source || "",
            isCC: Boolean(meta?.isCC),
        };
    });
}

/**
 * Evaluate manually toggled Target Combo Statuses (for single-skill breakdown / healing / sweep / defender).
 * Takes `targetStatuses` (array or Set of status IDs like ["shocked", "impaled"]).
 * Stacks all matching combo bonuses for `skill` (e.g. Shocked +43% & Impaled +45% = +88%) and detects auto-CC statuses.
 */
export function evaluateManualComboStatuses(skill, targetStatuses) {
    const list = Array.isArray(targetStatuses)
        ? targetStatuses
        : targetStatuses instanceof Set
          ? Array.from(targetStatuses)
          : [];
    if (list.length === 0) {
        return { comboBonusPct: 0, matchedLabels: [], triggersAutoCC: false, autoCCLabel: null };
    }
    const activeSet = new Set(list.map((s) => String(s || "").toLowerCase()));
    const rules = SKILL_COMBO_BONUSES[skill?.id] || [];

    let comboBonusPct = 0;
    const matchedLabels = [];
    for (const rule of rules) {
        if (activeSet.has(rule.requires)) {
            comboBonusPct += rule.comboBonusPct;
            matchedLabels.push(rule.label);
        }
    }

    let autoCCLabel = null;
    if (skill?.kind === "damage") {
        for (const sid of activeSet) {
            const meta = TARGET_STATUS_BY_ID.get(sid);
            if (meta?.isCC) {
                autoCCLabel = meta.label;
                break;
            }
        }
    }

    return {
        comboBonusPct,
        matchedLabels,
        triggersAutoCC: Boolean(autoCCLabel),
        autoCCLabel,
    };
}

/**
 * Evaluate active statuses at `atSec` for a given skill ID.
 * Returns { comboBonusPct, bonusCritRatePct, autoCCLabel, matchedLabels, consumedStatuses }.
 */
export function evaluateActiveSkillCombos(skill, activeStatuses, atSec) {
    const live = (activeStatuses || []).filter((st) => st.expiresAtSec > atSec + 1e-6);
    const hasStatus = (name) => live.some((st) => st.status === name);

    let comboBonusPct = 0;
    let bonusCritRatePct = 0;
    const matchedLabels = [];
    const consumedStatuses = [];

    const rules = SKILL_COMBO_BONUSES[skill?.id] || [];
    for (const rule of rules) {
        if (hasStatus(rule.requires)) {
            comboBonusPct += rule.comboBonusPct;
            matchedLabels.push(rule.label);
        }
    }

    // Gale Overwhelm backstab next-skill +100% Crit Rate
    if (skill?.kind !== "utility" && hasStatus("gale_overwhelm_crit")) {
        bonusCritRatePct += 100;
        matchedLabels.push("Gale Overwhelm +100% Crit");
        consumedStatuses.push("gale_overwhelm_crit");
    }

    // Auto-CC detection for physical/melee/ranged damage skills
    const ccStatus =
        skill?.kind === "damage"
            ? live.find((st) => st.isCC) || null
            : null;

    return {
        comboBonusPct,
        bonusCritRatePct,
        autoCCLabel: ccStatus ? ccStatus.label : null,
        matchedLabels,
        consumedStatuses,
    };
}
