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
    battlerage_lasso: [{ status: "pulled", label: "Pulled (Lasso)", durationSec: 1.5, isCC: true }],
    battlerage_terrifying_roar: [{ status: "weakened", label: "Weakened (+CC Dur)", durationSec: 6.0 }],
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
    defense_mocking_howl: [{ status: "distressed", label: "Distressed", durationSec: 6.0 }],
    defense_imprison: [{ status: "imprisoned", label: "Imprisoned", durationSec: 14.0 }],
    defense_fortress: [{ status: "pushed", label: "Pushed (Fortress)", durationSec: 1.5 }],

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
    shadowplay_pin_down: [{ status: "bleeding", label: "Bleeding", durationSec: 14.0, requiresBackstab: true }],

    archery_piercing_shot: [{ status: "bleeding", label: "Bleeding", durationSec: 14.0 }],
    archery_charged_bolt: [{ status: "slowed", label: "Slowed", durationSec: 2.5 }],
    archery_charged_bolt_short: [{ status: "slowed", label: "Slowed", durationSec: 2.5 }],
    archery_charged_bolt_fast: [{ status: "slowed", label: "Slowed", durationSec: 2.5 }],
    archery_snipe: [{ status: "tripped", label: "Tripped", durationSec: 3.0, isCC: true, requiresAny: ["snared"] }],
    archery_snare: [{ status: "snared", label: "Snared", durationSec: 3.5 }],

    sorcery_flamebolt: [{ status: "burning", label: "Burning", durationSec: 4.0 }],
    sorcery_flamebolt_flame: [{ status: "burning", label: "Burning", durationSec: 4.0 }],
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
    occultism_stillness: [{ status: "silenced", label: "Silenced", durationSec: 3.5 }],
    occultism_telekinesis: [{ status: "telekinesis", label: "Telekinesis (CC)", durationSec: 10.0, isCC: true }],

    vitalism_skewer: [{ status: "impaled", label: "Impaled", durationSec: 2.5, isCC: true }],
    vitalism_skewer_multi: [{ status: "impaled", label: "Impaled", durationSec: 2.5, isCC: true }],
    vitalism_mirror_light: [{ status: "snared", label: "Snared", durationSec: 3.0 }],
    vitalism_whirlwind_blessing: [{ status: "slowed", label: "Slowed (Whirlwind)", durationSec: 30.0 }],

    auramancy_comets_boon_hollow: [{ status: "slowed", label: "Slowed", durationSec: 3.0 }],
    auramancy_thwart: [{ status: "shaken", label: "Shaken", durationSec: 3.0 }],
    auramancy_leech: [{ status: "asleep", label: "Asleep (Leech)", durationSec: 4.5, isCC: true }],

    witchcraft_earthen_grip: [{ status: "snared", label: "Snared", durationSec: 6.0 }],
    witchcraft_earthen_grip_aoe: [{ status: "snared", label: "Snared", durationSec: 6.0 }],
    witchcraft_focal_concussion: [{ status: "stunned", label: "Stunned", durationSec: 1.5, isCC: true }],
    witchcraft_focal_concussion_hollow: [{ status: "stunned", label: "Stunned", durationSec: 1.5, isCC: true }],
    witchcraft_bubble_trap: [{ status: "bubbled", label: "Bubbled (CC)", durationSec: 5.4, isCC: true }],
    witchcraft_bubble_trap_mist: [{ status: "bubbled", label: "Bubbled (Mist CC)", durationSec: 5.0, isCC: true }],
    witchcraft_insidious_whisper: [{ status: "feared", label: "Feared", durationSec: 2.8, isCC: true }],
    witchcraft_lassitude: [
        { status: "drowsy", label: "Lassitude (Drowsy)", durationSec: 2.0 },
        { status: "asleep", label: "Asleep (Lassitude)", delaySec: 2.0, durationSec: 3.5, isCC: true },
    ],
    witchcraft_banshee_wail: [
        { status: "feared", label: "Feared", durationSec: 2.8, isCC: true },
        { status: "stunned", label: "Stunned (Banshee)", delaySec: 2.8, durationSec: 2.0, isCC: true },
    ],
    witchcraft_banshee_wail_stone: [
        { status: "feared", label: "Feared", durationSec: 2.8, isCC: true },
        { status: "slowed", label: "Slowed (-40%)", durationSec: 2.8 },
    ],
    witchcraft_banshee_wail_mist: [
        { status: "feared", label: "Feared (Phantasm)", durationSec: 2.8, isCC: true },
        { status: "stunned", label: "Stunned (Phantasm)", delaySec: 2.8, durationSec: 2.0, isCC: true },
    ],
    witchcraft_purge: [{ status: "purged", label: "Purged (-1 Buff)", durationSec: 1.0 }],

    songcraft_critical_discord_hollow: [{ status: "charmed", label: "Charmed", durationSec: 8.0 }],
    songcraft_startling_strain: [
        { status: "stunned", label: "Stunned", durationSec: 2.0, isCC: true },
        { status: "charmed", label: "Charmed", delaySec: 2.0, durationSec: 12.0 },
    ],
    songcraft_startling_strain_wave: [{ status: "charmed", label: "Charmed", durationSec: 24.0 }],
    songcraft_quickstep: [
        { status: "slowed", label: "Slowed (Charmed Quickstep)", durationSec: 15.0, requiresAny: ["charmed"], waitForStatus: "charmed" },
    ],
    songcraft_alarm_call_stone: [{ status: "asleep", label: "Asleep (Alarm Call)", durationSec: 9.0, isCC: true }],

    // Equip Effects / Set Procs & Item Actives
    equip_corrupted_kyrios_pull: [{ status: "pulled", label: "Pulled (Kyrios 4pc)", durationSec: 1.5, isCC: true }],
    equip_grimghast_nightmare_grinder: [{ status: "shackled", label: "Shackled (Grimghast 7pc)", durationSec: 2.0 }],
    equip_titans_talon_stun: [{ status: "stunned", label: "Stunned (Titan's Talon 2pc)", durationSec: 2.0, isCC: true }],
    equip_kraken_spear_pull: [
        { status: "pulled", label: "Pulled (Kraken Pillager)", durationSec: 1.5, isCC: true },
        { status: "slowed", label: "Slowed (Kraken Pillager)", durationSec: 6.0 },
    ],
    equip_kraken_scepter_snare: [
        { status: "snared", label: "Snared (Kraken Sovereign)", durationSec: 3.0 },
        { status: "slowed", label: "Slowed (Kraken Sovereign)", durationSec: 6.0 },
    ],
    equip_kraken_shield_ink: [{ status: "slowed", label: "Slowed (Kraken Ink)", durationSec: 10.0 }],
    equip_red_dragon_roar_trip: [{ status: "tripped", label: "Tripped (RD Roar)", durationSec: 3.0, isCC: true }],
    equip_cometshard_staff_trip: [{ status: "tripped", label: "Tripped (Cometshard)", durationSec: 1.0, isCC: true }],
    equip_red_dragon_wing_reaper: [{ status: "slowed", label: "Slowed (Wing-Reaper)", durationSec: 3.0 }],
    equip_titans_pain_shock: [{ status: "shocked", label: "Shocked (Titan's Pain)", durationSec: 8.0 }],
    equip_berserker_plate_trip: [{ status: "tripped", label: "Tripped (Berserker Plate)", durationSec: 2.0, isCC: true }],
    equip_berserker_fangs_root: [{ status: "snared", label: "Snared (Berserker Fangs)", delaySec: 3.0, durationSec: 3.0 }],
    equip_fangbane_silence: [{ status: "silenced", label: "Silenced (Fangbane)", durationSec: 2.0 }],
    equip_glory_sash_bind: [{ status: "snared", label: "Snared (Glory Sash)", durationSec: 2.0 }],
    equip_jolas_grudge_stun: [{ status: "stunned", label: "Stunned (Jola's Grudge)", durationSec: 5.0, isCC: true }],
    equip_ayanad_earring_crit: [
        { status: "ayanad_crit_buff", label: "Great Ayanad (+70% Crit)", durationSec: 2.0, targetSide: "self", bonusCritRatePct: 70 },
    ],
    equip_pioneer_earring_crit: [
        { status: "pioneer_crit_buff", label: "Pioneer Earring (+35% Crit)", durationSec: 2.0, targetSide: "self", bonusCritRatePct: 35 },
    ],
    equip_honor_abeyance_stun: [{ status: "stunned", label: "Stunned (Honor Sword)", durationSec: 2.0, isCC: true }],
    equip_honor_perdition_impale: [{ status: "impaled", label: "Impaled (Honor Spear)", durationSec: 2.0, isCC: true }],
    equip_honor_silent_greataxe: [{ status: "silenced", label: "Silenced (Honor Greataxe)", durationSec: 4.0 }],
    equip_honor_entangling_bow: [{ status: "snared", label: "Snared (Honor Bow)", durationSec: 4.0 }],
    equip_honor_withering_club: [{ status: "distressed", label: "Distressed (Honor Club)", durationSec: 7.0 }],
    equip_honor_binding_shield: [{ status: "slowed", label: "Slowed (Honor Shield)", durationSec: 4.0 }],
    equip_suns_glare_blind: [{ status: "blinded", label: "Blinded (-25% Melee Acc)", durationSec: 6.0 }],
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
    defense_mocking_howl: {
        id: "distressed",
        label: "Distressed (-60% Heal)",
        durationSec: 6.0,
        addDefense: { receivedHealingPct: -60 },
    },
    archery_snare: {
        id: "archery_snare_debuff",
        label: "Snare (-15% Evd/Blk/Pry)",
        durationSec: 3.5,
        addDefense: { evasionPct: -15, blockPct: -15, parryPct: -15 },
    },
    auramancy_thwart_stone: {
        id: "thwart_stone_debuff",
        label: "Stone Thwart (+20 Recv Dmg)",
        durationSec: 5.0,
        addDefense: { fixedMeleeDr: -20, fixedRangedDr: -20, fixedMagicDr: -20 },
    },
    vitalism_mirror_light: {
        id: "mirror_light_enemy",
        label: "Mirror Light (+12% Dmg, -30% Heal)",
        durationSec: 15.0,
        addDefense: {
            receivedMeleeDrPct: -12,
            receivedRangedDrPct: -12,
            receivedMagicDrPct: -12,
            receivedHealingPct: -30,
        },
    },
    songcraft_bulwark_ballad: {
        id: "charm_unguarded",
        label: "Charm: Unguarded (-50% PDef/MDef)",
        durationSec: 15.0,
        requiresAny: ["charmed"],
        waitForStatus: "charmed",
        mulDefense: { physicalDefense: 0.5, magicDefense: 0.5 },
    },
    songcraft_quickstep: {
        id: "charm_unpleasant_sensation",
        label: "Charm: Quickstep (-10% Blk/Evd)",
        durationSec: 15.0,
        requiresAny: ["charmed"],
        waitForStatus: "charmed",
        addDefense: { blockPct: -10, evasionPct: -10 },
    },
    songcraft_bloody_chantey: {
        id: "charm_lethargy",
        label: "Charm: Lethargy (-20% Enemy Dmg)",
        durationSec: 15.0,
        requiresAny: ["charmed"],
        waitForStatus: "charmed",
    },
    equip_wicked_whisper_supreme: {
        id: "wicked_whisper",
        label: "Wicked Whisper (-850 PDef/MDef)",
        durationSec: 8.0,
        addDefense: { physicalDefense: -850, magicDefense: -850 },
    },
    equip_wicked_whisper_prime: {
        id: "wicked_whisper",
        label: "Wicked Whisper (-675 PDef/MDef)",
        durationSec: 6.0,
        addDefense: { physicalDefense: -675, magicDefense: -675 },
    },
    equip_wicked_whisper_superior: {
        id: "wicked_whisper",
        label: "Wicked Whisper (-500 PDef/MDef)",
        durationSec: 5.0,
        addDefense: { physicalDefense: -500, magicDefense: -500 },
    },
    equip_ynys_ring_shred: {
        id: "ynys_ring_shred",
        label: "Ynys Ring 4x (-700 PDef/MDef)",
        durationSec: 5.0,
        addDefense: { physicalDefense: -700, magicDefense: -700 },
    },
    equip_mistsong_malice_antiheal: {
        id: "mistsong_malice",
        label: "Mistsong Malice (-10% Heal)",
        durationSec: 6.0,
        addDefense: { receivedHealingPct: -10 },
    },
    equip_honor_withering_club: {
        id: "distressed",
        label: "Distressed (-60% Heal)",
        durationSec: 7.0,
        addDefense: { receivedHealingPct: -60 },
    },
    equip_honor_dominating_staff: {
        id: "enervate",
        label: "Dominating Staff (-50% Heal)",
        durationSec: 5.0,
        addDefense: { receivedHealingPct: -50 },
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

/**
 * Extra debuffs & status effects users can toggle rotation-wide or apply on any individual
 * rotation step (e.g. Delirium passive 5% Bleed proc, Puncture -2,000 P.Def, or teammate combos).
 */
export const ROTATION_EXTRA_EFFECTS = Object.freeze([
    {
        id: "bleeding",
        kind: "status",
        status: "bleeding",
        label: "Bleeding (Delirium / Bleed)",
        shortLabel: "Bleeding",
        durationSec: 14.0,
        isCC: false,
    },
    {
        id: "puncture",
        kind: "debuff",
        debuffId: "puncture",
        label: "Puncture (-2,000 P.Def)",
        shortLabel: "Puncture (-2k PDef)",
        durationSec: 5.0,
        addDefense: { physicalDefense: -2000 },
    },
    {
        id: "shocked",
        kind: "status",
        status: "shocked",
        label: "Shocked",
        shortLabel: "Shocked",
        durationSec: 8.0,
        isCC: false,
    },
    {
        id: "freezing",
        kind: "status",
        status: "freezing",
        label: "Freezing",
        shortLabel: "Freezing",
        durationSec: 4.0,
        isCC: false,
    },
    {
        id: "burning",
        kind: "status",
        status: "burning",
        label: "Burning",
        shortLabel: "Burning",
        durationSec: 5.0,
        isCC: false,
    },
    {
        id: "poisoned",
        kind: "status",
        status: "poisoned",
        label: "Poisoned",
        shortLabel: "Poisoned",
        durationSec: 10.0,
        isCC: false,
    },
    {
        id: "distressed",
        kind: "status",
        status: "distressed",
        label: "Distressed",
        shortLabel: "Distressed",
        durationSec: 4.0,
        isCC: false,
    },
    {
        id: "shaken",
        kind: "status",
        status: "shaken",
        label: "Shaken",
        shortLabel: "Shaken",
        durationSec: 3.0,
        isCC: false,
    },
    {
        id: "slowed",
        kind: "status",
        status: "slowed",
        label: "Slowed",
        shortLabel: "Slowed",
        durationSec: 3.0,
        isCC: false,
    },
    {
        id: "snared",
        kind: "status",
        status: "snared",
        label: "Snared",
        shortLabel: "Snared",
        durationSec: 3.5,
        isCC: false,
    },
    {
        id: "charmed",
        kind: "status",
        status: "charmed",
        label: "Charmed",
        shortLabel: "Charmed",
        durationSec: 8.0,
        isCC: false,
    },
    {
        id: "stunned",
        kind: "status",
        status: "stunned",
        label: "Stunned (CC)",
        shortLabel: "Stunned",
        durationSec: 2.0,
        isCC: true,
    },
    {
        id: "tripped",
        kind: "status",
        status: "tripped",
        label: "Tripped (CC)",
        shortLabel: "Tripped",
        durationSec: 2.5,
        isCC: true,
    },
    {
        id: "impaled",
        kind: "status",
        status: "impaled",
        label: "Impaled (CC)",
        shortLabel: "Impaled",
        durationSec: 2.5,
        isCC: true,
    },
    {
        id: "resurgence",
        kind: "status",
        status: "resurgence",
        label: "Resurgence (Ally HoT)",
        shortLabel: "Resurgence",
        durationSec: 10.0,
        isCC: false,
        targetSide: "ally",
    },
    {
        id: "dissonance",
        kind: "debuff",
        debuffId: "dissonance",
        label: "Dissonance (-320 M.Def)",
        shortLabel: "Dissonance (-320 MDef)",
        durationSec: 6.0,
        addDefense: { magicDefense: -320 },
    },
    {
        id: "wallop_shred",
        kind: "debuff",
        debuffId: "wallop_shred",
        label: "Wallop (-480 P.Def)",
        shortLabel: "Wallop (-480 PDef)",
        durationSec: 5.0,
        addDefense: { physicalDefense: -480 },
    },
    {
        id: "stalkers_mark",
        kind: "debuff",
        debuffId: "stalkers_mark",
        label: "Stalker's Mark (-60% Heal)",
        shortLabel: "Stalker's Mark (-60% Heal)",
        durationSec: 12.0,
        addDefense: { receivedHealingPct: -60 },
    },
    {
        id: "enervate",
        kind: "debuff",
        debuffId: "enervate",
        label: "Enervate (-60% Heal)",
        shortLabel: "Enervate (-60% Heal)",
        durationSec: 5.0,
        addDefense: { receivedHealingPct: -60 },
    },
    {
        id: "pulled",
        kind: "status",
        status: "pulled",
        label: "Pulled (Kyrios / Lasso / Kraken)",
        shortLabel: "Pulled",
        durationSec: 1.5,
        isCC: true,
    },
    {
        id: "feared",
        kind: "status",
        status: "feared",
        label: "Feared (CC)",
        shortLabel: "Feared",
        durationSec: 2.8,
        isCC: true,
    },
    {
        id: "asleep",
        kind: "status",
        status: "asleep",
        label: "Asleep (CC)",
        shortLabel: "Asleep",
        durationSec: 3.5,
        isCC: true,
    },
    {
        id: "bubbled",
        kind: "status",
        status: "bubbled",
        label: "Bubbled (CC)",
        shortLabel: "Bubbled",
        durationSec: 5.4,
        isCC: true,
    },
    {
        id: "silenced",
        kind: "status",
        status: "silenced",
        label: "Silenced (Stillness / Fangbane)",
        shortLabel: "Silenced",
        durationSec: 3.5,
        isCC: false,
    },
    {
        id: "shackled",
        kind: "status",
        status: "shackled",
        label: "Shackled",
        shortLabel: "Shackled",
        durationSec: 2.0,
        isCC: false,
    },
    {
        id: "mirror_light_enemy",
        kind: "debuff",
        debuffId: "mirror_light_enemy",
        label: "Mirror Light (+12% Dmg, -30% Heal)",
        shortLabel: "Mirror Light (+12% Dmg)",
        durationSec: 15.0,
        addDefense: {
            receivedMeleeDrPct: -12,
            receivedRangedDrPct: -12,
            receivedMagicDrPct: -12,
            receivedHealingPct: -30,
        },
    },
    {
        id: "charm_unguarded",
        kind: "debuff",
        debuffId: "charm_unguarded",
        label: "Charm: Unguarded (-50% PDef/MDef)",
        shortLabel: "Unguarded (-50% Def)",
        durationSec: 15.0,
        mulDefense: { physicalDefense: 0.5, magicDefense: 0.5 },
    },
    {
        id: "wicked_whisper",
        kind: "debuff",
        debuffId: "wicked_whisper",
        label: "Wicked Whisper (-850 PDef/MDef)",
        shortLabel: "Wicked Whisper (-850)",
        durationSec: 8.0,
        addDefense: { physicalDefense: -850, magicDefense: -850 },
    },
]);

const ROTATION_EXTRA_EFFECT_BY_ID = new Map(ROTATION_EXTRA_EFFECTS.map((e) => [e.id, e]));

export function getRotationExtraEffect(id) {
    return ROTATION_EXTRA_EFFECT_BY_ID.get(String(id || "").toLowerCase()) || null;
}

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
    const live = (activeStatuses || []).filter(
        (st) =>
            (st.startedAtSec == null || st.startedAtSec <= atSec + 1e-6) &&
            st.expiresAtSec > atSec + 1e-6
    );
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

    // Gale Overwhelm backstab next-skill +100% Crit Rate (single-use)
    if (skill?.kind !== "utility" && hasStatus("gale_overwhelm_crit")) {
        bonusCritRatePct += 100;
        matchedLabels.push("Gale Overwhelm +100% Crit");
        consumedStatuses.push("gale_overwhelm_crit");
    }

    // Duration-based self crit buffs (e.g. Great Ayanad Earring +70% Crit for 2s, Pioneer +35% for 2s)
    if (skill?.kind !== "utility") {
        for (const st of live) {
            if (Number(st.bonusCritRatePct) > 0 && st.status !== "gale_overwhelm_crit") {
                bonusCritRatePct += Number(st.bonusCritRatePct);
                matchedLabels.push(st.label || `+${st.bonusCritRatePct}% Crit`);
                if (st.consumesOnUse) consumedStatuses.push(st.status);
            }
        }
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
