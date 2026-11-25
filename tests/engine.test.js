import {
    ARMOR_SLOTS,
    COMBAT_MODIFIERS,
    CONSUMABLE_SLOTS,
    COSTUME_CHARM_DEFS,
    DEFAULT_CONSTANTS,
    T7_OBSIDIAN_SPECIAL_EFFECTS,
    applyGearTemplateToSlots,
    applyLunafrostToEligibleSlots,
    applyModifiers,
    applyOverrides,
    applySkillBuildPresetToCharacter,
    applyStatMigrationTransfer,
    attackSpeedGcdPct,
    classifyGearItemTier,
    classifyLunagemGroup,
    compareBuildEconomy,
    compareBuilds,
    compareDefenders,
    compareDefendersRotation,
    compareRotations,
    computeActiveSetEffectSummaries,
    computeAllVsAllMatrix,
    computeArmorPieceDefense,
    computeArmorSetAndGradeBuff,
    computeCharacterGearBuffSummaries,
    computeEffectiveStats,
    computeGearItemGrantedStats,
    computeGoldEfficiencyUpgrades,
    computeMatchupMatrix,
    computeStatWeights,
    createBlankGearBuild,
    createDefaultCharacter,
    createDefaultEconomyPriceBook,
    createDefaultRawPlayer,
    createEmptyGearSlots,
    defenseMitigationPct,
    describeGearBuffEffects,
    effectiveGcdSec,
    ensureCharacterRawDaruGear,
    equipArmorSetPreset,
    equipCatalogItemInSlot,
    estimateBuildCost,
    extractGearTemplateFromSlots,
    extractSkillBuildFromDaruGearPlayerClass,
    extractSkillBuildPreset,
    fillAllSlotLunagems,
    filterItemsForSlot,
    filterLunagemsForSlot,
    findModifierForDaruGearBuff,
    getArmorSetPresets,
    getAvailableSynthPool,
    getEquipmentSkillBonus,
    getEquippedT7ObsidianEffects,
    getPlayerStatMigration,
    getSkillComboOptions,
    getSynthPoolIndexForStat,
    getSynthSlotCountForGrade,
    getT7ObsidianSpecialEffect,
    getTotalPointsSpent,
    inferBuildArmorType,
    inferBuildCategory,
    initSkillBuilderData,
    inspectWeaponArchetype,
    loadGearCatalog,
    normalizeEconomyPriceBook,
    normalizeGearTemplate,
    normalizeSavedSkillPreset,
    normalizeSkillBuild,
    parseGearStatLine,
    parseSkillSpecificBonusLine,
    recalculateCharacterFromGearBuilder,
    recomputeGearBuffs,
    registerCustomModifiers,
    resolveCostumeCharmInfo,
    resetPlayerStatMigration,
    resilienceCritBonusReductionPct,
    resilienceCritRateReductionPct,
    resolveClassName,
    resolveGearIconUrl,
    setAncestralVariant,
    setPlayerStatMigration,
    setRuntimeConstantsOverrides,
    syncSkillBreakdownAncestralsFromBuilder,
    setGearPlayerTitle,
    setSkillBuildTree,
    setSlotItemGrade,
    setSlotItemLunafrost,
    setSlotItemSynthStat,
    setSlotItemTemper,
    shouldAutoApplyAhGearPrice,
    shiftArmorGrades,
    shiftWeaponGrades,
    simulateRotation,
    simulateSkillDamage,
    simulateSkillHeal,
    swapArmorTier,
    swapArmorType,
    swapEquipmentSynthStat,
    swapSlotLunagems,
    swapWeaponArchetype,
    sweepDefenderEhp,
    sweepDefenderStat,
    toggleActiveSkill,
    togglePassiveSkill,
    toughnessMitigationPct,
    treesForClassName,
    unapplyModifiers,
    unregisterCustomModifier,
} from "../js/engine/index.js";
import { fromInGameUnitInfo, getDaruGearBookmarkletHref, normalizeBuildMetadata, parseImportPayload } from "../js/adapters/darugear.js";
import { buildDaruGearExportFromApiPayload, calculateDaruGearStats } from "../js/adapters/darugear_calc.js";

function assert(condition, message) {
    if (!condition) {
        throw new Error("Assertion failed: " + message);
    }
}

function assertApprox(actual, expected, tolerance, label) {
    if (Math.abs(actual - expected) > tolerance) {
        throw new Error(
            `${label}: expected ${expected} (±${tolerance}), got ${actual}`
        );
    }
}

async function loadJson(relativePath) {
    const res = await fetch(relativePath, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to fetch ${relativePath}: ${res.status}`);
    return res.json();
}

export async function runAllTests() {
    const results = [];
    async function test(name, fn) {
        try {
            await fn();
            results.push({ name, pass: true });
        } catch (err) {
            results.push({ name, pass: false, error: err.message });
        }
    }

    const sampleChar = await loadJson("../js/data/sample_character.json");
    const battlerage = await loadJson("../js/data/skills/battlerage.json");
    const archery = await loadJson("../js/data/skills/archery.json");
    const auramancy = await loadJson("../js/data/skills/auramancy.json");
    const defense = await loadJson("../js/data/skills/defense.json");
    const occultism = await loadJson("../js/data/skills/occultism.json");
    const sorcery = await loadJson("../js/data/skills/sorcery.json");
    const shadowplay = await loadJson("../js/data/skills/shadowplay.json");
    const songcraft = await loadJson("../js/data/skills/songcraft.json");
    const vitalism = await loadJson("../js/data/skills/vitalism.json");
    const witchcraft = await loadJson("../js/data/skills/witchcraft.json");

    const findSkill = (treeData, id) => treeData.skills.find((s) => s.id === id);

    // 1. Live AA Classic 1.3.6 Defense Curve K=7900
    await test("Defense mitigation matches live unitInfo to 4 decimals (K=7900)", () => {
        assertApprox(defenseMitigationPct(3975), 33.4737, 0.001, "Physical Defense 3975");
        assertApprox(defenseMitigationPct(11612), 59.5121, 0.001, "Magic Defense 11612");
    });

    // 2. Live Tooltip Exact Match Verification across Melee, Ranged, Magic, Vitalism Heal & Vitalism Damage (Lv 55 per-skillset dumps)
    await test("Pre-mitigation skill values match live AA Classic 1.3.6 Lv 55 skill dumps", () => {
        const dummy = createDefaultCharacter({
            defense: {
                physicalDefense: 0,
                magicDefense: 0,
                toughness: 0,
                resilience: 0,
                evasionPct: 0,
                parryPct: 0,
                blockPct: 0,
                receivedMeleeDrPct: 0,
                receivedRangedDrPct: 0,
                receivedMagicDrPct: 0,
                fixedMeleeDr: 0,
                fixedRangedDr: 0,
                fixedMagicDr: 0,
                receivedHealingPct: 0,
            },
        });

        const ps = simulateSkillDamage(sampleChar, dummy, findSkill(battlerage, "battlerage_precision_strike"));
        assertApprox(ps.breakdown.preMitigation, 4106.11, 5, "Precision Strike Lv55 live tooltip");

        const se = simulateSkillDamage(sampleChar, dummy, findSkill(battlerage, "battlerage_sunder_earth"));
        assertApprox(se.breakdown.preMitigation, 2945.26, 5, "Sunder Earth Lv55 live tooltip");

        const snipe = simulateSkillDamage(sampleChar, dummy, findSkill(archery, "archery_snipe"));
        assertApprox(snipe.breakdown.preMitigation, 2955.37, 5, "Snipe live tooltip");

        const meteor = simulateSkillDamage(sampleChar, dummy, findSkill(sorcery, "sorcery_meteor_strike"));
        assertApprox(meteor.breakdown.preMitigation, 2424.17, 5, "Meteor Strike Lv55 live tooltip");

        const arc = simulateSkillDamage(sampleChar, dummy, findSkill(sorcery, "sorcery_arc_lightning"));
        assertApprox(arc.breakdown.preMitigation, 1349.77, 5, "Arc Lightning Lv55 (898 + 624%) live tooltip");

        const holyBolt = simulateSkillDamage(sampleChar, dummy, findSkill(vitalism, "vitalism_holy_bolt"));
        assertApprox(holyBolt.breakdown.preMitigation, 2670, 5, "Holy Bolt live tooltip (heal_mul)");

        const antiDmg = simulateSkillDamage(sampleChar, dummy, findSkill(vitalism, "vitalism_antithesis_damage"));
        assertApprox(antiDmg.breakdown.preMitigation, 5675, 5, "Antithesis Damage live tooltip (heal_mul)");

        const antiHeal = simulateSkillHeal(sampleChar, dummy, findSkill(vitalism, "vitalism_antithesis_heal"));
        assertApprox(antiHeal.normal, 7885, 5, "Antithesis Heal live tooltip");

        const mend = simulateSkillHeal(sampleChar, dummy, findSkill(vitalism, "vitalism_mend"));
        assertApprox(mend.normal, 8519, 5, "Mend live tooltip (2-point linear solve)");
    });

    // 3. Defense Pen Floor & Shield Def Pen
    await test("Defense Penetration clamps at 0 and Shield Def Pen procs increase expected damage", () => {
        const skill = findSkill(battlerage, "battlerage_sunder_earth");
        const attackerOverPen = createDefaultCharacter({
            offense: { meleeAttack: 1000, defensePenetration: 99999, meleeCritRatePct: 0 },
        });
        const defender = createDefaultCharacter({
            defense: {
                physicalDefense: 5000,
                shieldPhysicalDefense: 2500,
                toughness: 0,
                resilience: 0,
                evasionPct: 0,
                parryPct: 0,
                blockPct: 0,
            },
        });
        const resOver = simulateSkillDamage(attackerOverPen, defender, skill);
        assert(resOver.breakdown.effectiveDefense === 0, "Effective defense must floor at 0");
        assertApprox(resOver.normal, resOver.breakdown.preMitigation, 0.01, "0 effDef = 0% defense mitigation");

        const attackerNoShieldPen = createDefaultCharacter({
            offense: { meleeAttack: 1000, defensePenetration: 1000, shieldDefPenRatePct: 0, shieldDefPenPct: 0, meleeCritRatePct: 0 },
        });
        const attackerWithShieldPen = applyOverrides(attackerNoShieldPen, {
            offense: { shieldDefPenRatePct: 50, shieldDefPenPct: 50 },
        });
        const rNo = simulateSkillDamage(attackerNoShieldPen, defender, skill);
        const rYes = simulateSkillDamage(attackerWithShieldPen, defender, skill);
        assert(rYes.expected > rNo.expected, "Shield Def Pen should raise expected damage vs shield defender");
    });

    // 4. Toughness, Resilience & PvE Toggle
    await test("Toughness & Resilience mitigate PvP damage and are skipped in PvE", () => {
        const skill = findSkill(vitalism, "vitalism_holy_bolt");
        const attacker = createDefaultCharacter({
            offense: { healingPower: 1000, magicCritRatePct: 50, magicCritBonusPct: 100 },
        });
        const defender = createDefaultCharacter({
            defense: { magicDefense: 0, toughness: 8000, resilience: 18000, fixedMagicDr: 0 },
        });
        const pvp = simulateSkillDamage(attacker, defender, skill, { isPvE: false });
        const pve = simulateSkillDamage(attacker, defender, skill, { isPvE: true });

        assertApprox(pvp.breakdown.toughnessMitigationPct, 50, 0.01, "8000 Toughness = 50% DR");
        assertApprox(pvp.breakdown.resilienceCritBonusRedPct, 50, 0.01, "18000 Resilience = -50% crit bonus");
        assertApprox(pvp.breakdown.effectiveCritBonusPct, 50, 0.01, "100% - 50% = 50% effective crit bonus");
        assert(pve.normal > pvp.normal * 2.5, "PvE ignores Toughness and applies Holy Bolt +40% PvE bonus");
    });

    // 5. Avoidance, Focus, Unavoidable & Backstab
    await test("Avoidance respects Focus, Unavoidable flags, Backstab bypass, and Shadowsmite scaling", () => {
        const attacker = createDefaultCharacter({
            offense: { meleeAttack: 1000, meleeCritRatePct: 30, meleeCritBonusPct: 100, focus: 2000 },
        });
        const defender = createDefaultCharacter({
            defense: { physicalDefense: 4000, toughness: 0, resilience: 0, evasionPct: 10, parryPct: 20, blockPct: 25 },
        });

        const tiger = simulateSkillDamage(attacker, defender, findSkill(battlerage, "battlerage_tiger_strike"));
        assert(tiger.breakdown.avoidance.connectPct === 100, "Tiger Strike is unavoidable");

        const psFront = simulateSkillDamage(attacker, defender, findSkill(battlerage, "battlerage_precision_strike"), {
            isBackstab: false,
        });
        const psBack = simulateSkillDamage(attacker, defender, findSkill(battlerage, "battlerage_precision_strike"), {
            isBackstab: true,
        });
        assert(psFront.breakdown.avoidance.parryPct > 0 && psFront.breakdown.avoidance.blockPct > 0, "Front melee can be parried/blocked");
        assert(
            psBack.breakdown.avoidance.evadePct === 0 &&
                psBack.breakdown.avoidance.parryPct === 0 &&
                psBack.breakdown.avoidance.blockPct === 0,
            "Backstab bypasses ALL avoidance (evasion, parry & block)"
        );
        assertApprox(
            psBack.breakdown.effectiveCritRatePct - psFront.breakdown.effectiveCritRatePct,
            34,
            0.01,
            "Precision Strike Lv55 backstab adds +34% crit rate"
        );

        const smiteFront = simulateSkillDamage(attacker, defender, findSkill(shadowplay, "shadowplay_shadowsmite"), {
            bloodthirstStacks: 10,
            isBackstab: false,
        });
        const smiteBack = simulateSkillDamage(attacker, defender, findSkill(shadowplay, "shadowplay_shadowsmite"), {
            bloodthirstStacks: 10,
            isBackstab: true,
        });
        assert(smiteBack.normal > smiteFront.normal * 2, "Shadowsmite backstab adds +400% Melee Attack");
    });

    // 6. Multi-hit skills & Fixed DR per hit
    await test("Multi-hit skills sum all hits and apply Fixed DR per hit", () => {
        const attacker = createDefaultCharacter({ offense: { magicAttack: 1000, magicCritRatePct: 0 } });
        const defNoFixed = createDefaultCharacter({ defense: { magicDefense: 0, toughness: 0, fixedMagicDr: 0 } });
        const defWithFixed = createDefaultCharacter({ defense: { magicDefense: 0, toughness: 0, fixedMagicDr: 50 } });

        const gw1 = simulateSkillDamage(attacker, defNoFixed, findSkill(sorcery, "sorcery_gods_whip"));
        const gw2 = simulateSkillDamage(attacker, defWithFixed, findSkill(sorcery, "sorcery_gods_whip"));
        assert(gw1.hitCount === 5, "Gods' Whip has 5 hits");
        assertApprox(gw1.normal - gw2.normal, 250, 0.01, "50 Fixed DR x 5 hits = 250 reduced");
    });

    // 7. Healing & Anti-Heal (unaffected by Resilience)
    await test("Healing ignores Resilience, applies anti-heal debuffs, and sums Fervent Healing 5 casts", () => {
        const healer = createDefaultCharacter({
            offense: { healingPower: 1400, healingPct: 15, healCritRatePct: 50, healCritBonusPct: 120 },
        });
        const targetLowRes = createDefaultCharacter({ defense: { resilience: 0, receivedHealingPct: 10 } });
        const targetHighRes = createDefaultCharacter({ defense: { resilience: 15000, receivedHealingPct: 10 } });

        const anti = findSkill(vitalism, "vitalism_antithesis_heal");
        const h1 = simulateSkillHeal(healer, targetLowRes, anti);
        const h2 = simulateSkillHeal(healer, targetHighRes, anti);
        assertApprox(h1.expected, h2.expected, 0.001, "Resilience must not reduce friendly heals");

        const hMarked = simulateSkillHeal(healer, targetLowRes, anti, { defenderModifiers: ["stalkers_mark"] });
        assert(hMarked.normal < h1.normal * 0.5, "Stalker's Mark (-60% received healing) strongly reduces heal");

        const fervent = simulateSkillHeal(healer, targetLowRes, findSkill(vitalism, "vitalism_fervent_healing"));
        assert(fervent.hitCount === 5, "Fervent Healing has 5 consecutive casts");
        assert(fervent.perHit[4].normal > fervent.perHit[0].normal * 1.9, "Cast 5 is ~2x Cast 1");

        const ode = findSkill(songcraft, "songcraft_ode_to_recovery");
        assert(ode && ode.kind === "heal" && ode.ranks.length === 5, "Ode to Recovery has all 5 live AA Classic ranks");
        const odeDummy = createDefaultCharacter({ defense: { receivedHealingPct: 0 } });
        assertApprox(simulateSkillHeal(sampleChar, odeDummy, ode, { skillRank: 1 }).normal, 254, 2, "Ode R1 live tooltip");
        assertApprox(simulateSkillHeal(sampleChar, odeDummy, ode, { skillRank: 2 }).normal, 422.5, 2, "Ode R2 live tooltip");
        assertApprox(simulateSkillHeal(sampleChar, odeDummy, ode, { skillRank: 3 }).normal, 633, 2, "Ode R3 live tooltip");
        assertApprox(simulateSkillHeal(sampleChar, odeDummy, ode, { skillRank: 4 }).normal, 885, 2, "Ode R4 live tooltip");
        assertApprox(simulateSkillHeal(sampleChar, odeDummy, ode, { skillRank: 5 }).normal, 1178.5, 2, "Ode R5 live tooltip");
        const odeBase = simulateSkillHeal(healer, targetLowRes, ode, { skillRank: 5 });
        const odeBuffed = simulateSkillHeal(healer, targetLowRes, ode, {
            skillRank: 5,
            attackerModifiers: ["ode_to_recovery_r5"],
            defenderModifiers: ["ode_to_recovery_ally"],
        });
        assert(odeBuffed.normal > odeBase.normal * 1.4, "Ode R5 (+130 HPwr) + Life Ode Ally (+42.9% Recv Heal) boost healing");
    });

    // 8. Build A vs Build B Comparison & Break-Even Sweep (Ser Meatball+)
    await test("Build A vs Build B comparison & Defense break-even sweep detect crossover point", () => {
        const buildA_HighAtk = createDefaultCharacter({
            name: "Crit/Attack Build",
            offense: { meleeAttack: 1250, defensePenetration: 500, meleeCritRatePct: 45, meleeCritBonusPct: 180 },
        });
        const buildB_HighPen = createDefaultCharacter({
            name: "Def Pen Build",
            offense: { meleeAttack: 1050, defensePenetration: 4500, meleeCritRatePct: 35, meleeCritBonusPct: 140 },
        });
        const defender = createDefaultCharacter({
            defense: { physicalDefense: 8000, toughness: 3000, resilience: 4000, evasionPct: 0, parryPct: 0, blockPct: 0 },
        });
        const ps = findSkill(battlerage, "battlerage_precision_strike");

        const cmp = compareBuilds(buildA_HighAtk, buildB_HighPen, defender, [ps]);
        assert(cmp.rows.length === 1, "Comparison returns 1 row");

        const sweep = sweepDefenderStat(buildA_HighAtk, buildB_HighPen, defender, ps, {
            stat: "physicalDefense",
            start: 0,
            end: 20000,
            step: 1000,
        });
        assert(sweep.points.length === 21, "Sweep has 21 points (0..20000 step 1000)");
        assert(sweep.points[0].winner === "A", "High Attack build should win at 0 Defense");
        // Flat Def Pen reaches peak relative value around Defense == DefPen (5,000)
        const at5k = sweep.points.find((p) => p.statValue === 5000);
        assert(at5k && at5k.winner === "B", "High Def Pen build should win at 5,000 Defense");
        assert(sweep.points[sweep.points.length - 1].winner === "A", "High Attack build overtakes again at 20,000 Defense");
        assert(sweep.breakEvens.length === 2, "Should detect dual break-even Defense crossovers (entering & exiting Def Pen sweet spot)");

        const defA = applyOverrides(defender, { defense: { physicalDefense: 12000 } });
        const defB = applyOverrides(defender, { defense: { physicalDefense: 4000 } });
        const defCmp = compareDefenders(buildA_HighAtk, defA, defB, [ps]);
        assert(defCmp.summary.tankierOverall === "A", "Higher defense build should be tankier");
    });

    // 9. Modifiers immutability check
    await test("applyModifiers applies Zeal & Puncture without mutating original characters", () => {
        const base = createDefaultCharacter({ offense: { meleeCritBonusPct: 100 }, defense: { physicalDefense: 5000 } });
        const buffed = applyModifiers(base, ["zeal", "puncture"]);
        assert(base.offense.meleeCritBonusPct === 100, "Original attacker must not be mutated");
        assert(base.defense.physicalDefense === 5000, "Original defender must not be mutated");
        assert(buffed.offense.meleeCritBonusPct === 175, "Zeal adds +75% crit bonus");
        assert(buffed.defense.physicalDefense === 3000, "Puncture reduces physical defense by 2000");
        assert(Object.keys(COMBAT_MODIFIERS).length >= 20, "COMBAT_MODIFIERS populated");
    });

    // 10. DaruGear & In-Game Import Adapter
    await test("DaruGear import adapter parses bookmarklet JSON, rejects raw URLs gracefully, and builds bookmarklet href", () => {
        const rawUrlRes = parseImportPayload("https://darugear.com/?s=SAMPLE1");
        assert(!rawUrlRes.ok && rawUrlRes.error.includes("bookmarklet"), "Raw DaruGear URL should return helpful bookmarklet guidance");

        const dgPayload = JSON.stringify({
            schemaVersion: 1,
            source: "darugear",
            shareUrl: "https://darugear.com/?s=SAMPLE1",
            shareCode: "SAMPLE1",
            className: "Darkrunner",
            title: "Desert Fox",
            gearScore: 6850,
            darugearBuffs: [
                { id: 4899, name: "Equip Dual Weapons", isOptional: false },
                { id: 16541, name: "Andrion II's Blessing", isOptional: true },
                { id: 6614, name: "Desert Fox", isOptional: false, isTitle: true },
            ],
            maxHealth: 28500,
            offense: { meleeAttack: 1320, meleeCritRatePct: 48, meleeCritBonusPct: 195, defensePenetration: 2400 },
            defense: { physicalDefense: 7200, magicDefense: 6100, toughness: 3400, resilience: 4800, blockPct: 18 },
        });
        const parsed = parseImportPayload(dgPayload);
        assert(parsed.ok, "Valid DaruGear JSON should parse cleanly");
        assert(parsed.character.name === "DaruGear (SAMPLE1)", "Share code populates build name");
        assert(parsed.character.metadata?.darugearUrl === "https://darugear.com/?s=SAMPLE1", "metadata.darugearUrl preserved");
        assert(parsed.character.metadata?.shareCode === "SAMPLE1", "metadata.shareCode preserved");
        assert(parsed.character.metadata?.className === "Darkrunner", "metadata.className preserved");
        assert(parsed.character.metadata?.title === "Desert Fox", "metadata.title preserved");
        assert(parsed.character.metadata?.gearScore === 6850, "metadata.gearScore preserved");
        assert(
            Array.isArray(parsed.character.metadata?.darugearBuffs) &&
                parsed.character.metadata.darugearBuffs.length === 3 &&
                parsed.character.metadata.darugearBuffs[0].id === 16541 &&
                parsed.character.metadata.darugearBuffs[0].isOptional === true,
            "metadata.darugearBuffs preserved & sorted with optional buffs first"
        );
        assert(parsed.character.offense.meleeAttack === 1320, "Melee attack preserved");
        assert(parsed.character.defense.resilience === 4800, "Resilience preserved");
        assert(parsed.warnings.length === 1, "Should warn when blockPct > 0 without shieldPhysicalDefense");

        // Auto-extract shareCode from metadata.darugearUrl even when shareCode is omitted
        const urlOnlyParsed = parseImportPayload(
            JSON.stringify({
                name: "URL Only Build",
                metadata: { darugearUrl: "https://darugear.com/?s=SAMPLE2" },
                offense: { healingPower: 1200 },
            })
        );
        assert(urlOnlyParsed.ok && urlOnlyParsed.character.shareCode === "SAMPLE2", "Auto-extracts shareCode from metadata.darugearUrl");

        const href = getDaruGearBookmarkletHref();
        assert(href.startsWith("javascript:"), "Bookmarklet href starts with javascript:");
        const decodedBookmarklet = decodeURIComponent(href.slice("javascript:".length));
        assert(decodedBookmarklet.includes("https://darugear.com/"), "Bookmarklet URL string is not stripped by minification");
        // Compile-check the generated bookmarklet JS so syntax errors are caught immediately
        new Function(decodedBookmarklet);
    });

    // 11. Skill Rank Resolution (single rank, multi-rank, max default, per-skill map)
    await test("Skill rank selection resolves requested rank, defaults to max, and supports per-skill overrides", () => {
        const multiRankSkill = {
            id: "test_arc_lightning",
            skillset: "sorcery",
            name: "Arc Lightning",
            variant: "base",
            kind: "damage",
            damageType: "magic",
            scalingStat: "magicAttack",
            base: 815,
            scalingPct: 654,
            ranks: [
                { rank: 1, label: "Rank 1", base: 192, scalingPct: 400, description: "Arc Rank 1" },
                { rank: 5, label: "Rank 5", base: 465, scalingPct: 537, description: "Arc Rank 5" },
                { rank: 9, label: "Rank 9", base: 815, scalingPct: 654, description: "Arc Rank 9" },
            ],
        };
        const attacker = createDefaultCharacter({ offense: { magicAttack: 1000, magicCritRatePct: 0 } });
        const dummy = createDefaultCharacter({ defense: { magicDefense: 0, physicalDefense: 0, toughness: 0, resilience: 0, fixedMagicDr: 0, fixedMeleeDr: 0 } });

        const rDefault = simulateSkillDamage(attacker, dummy, multiRankSkill);
        assert(rDefault.selectedRank === 9 && rDefault.availableRanks === 3, "Defaults to highest rank (9)");
        assertApprox(rDefault.normal, 815 + 6540, 0.01, "Rank 9 formula matches 815 + 654%");

        const r1 = simulateSkillDamage(attacker, dummy, multiRankSkill, { skillRank: 1 });
        assert(r1.selectedRank === 1 && r1.description === "Arc Rank 1", "Rank 1 selected cleanly");
        assertApprox(r1.normal, 192 + 4000, 0.01, "Rank 1 formula matches 192 + 400%");

        const r5 = simulateSkillDamage(attacker, dummy, multiRankSkill, {
            skillRank: 1,
            skillRanks: { test_arc_lightning: 5 },
        });
        assert(r5.selectedRank === 5, "Per-skill skillRanks map overrides global skillRank");
        assertApprox(r5.normal, 465 + 5370, 0.01, "Rank 5 formula matches 465 + 537%");

        // Verify per-rank flags override (e.g. Precision Strike Rank 1 +35% CD / +24% Backstab vs Rank 8 +70% / +38%)
        const rankFlagSkill = {
            id: "test_ps_ranks",
            skillset: "battlerage",
            name: "Precision Strike",
            variant: "base",
            kind: "damage",
            damageType: "physical",
            scalingStat: "meleeAttack",
            flags: { critDamageBonusPct: 35, backstabCritRateBonusPct: 24 },
            ranks: [
                { rank: 1, label: "Rank 1", base: 576, scalingPct: 360, flags: { critDamageBonusPct: 35, backstabCritRateBonusPct: 24 } },
                { rank: 8, label: "Rank 8", base: 920, scalingPct: 360, flags: { critDamageBonusPct: 70, backstabCritRateBonusPct: 38 } },
            ],
        };
        const meleeAtk = createDefaultCharacter({ offense: { meleeAttack: 1000, meleeCritRatePct: 20, meleeCritBonusPct: 100 } });
        const psR1 = simulateSkillDamage(meleeAtk, dummy, rankFlagSkill, { skillRank: 1, isBackstab: true });
        const psR8 = simulateSkillDamage(meleeAtk, dummy, rankFlagSkill, { skillRank: 8, isBackstab: true });
        assertApprox(psR1.breakdown.effectiveCritRatePct, 44, 0.01, "PS Rank 1 backstab crit rate = 20 + 24 = 44%");
        assertApprox(psR8.breakdown.effectiveCritRatePct, 58, 0.01, "PS Rank 8 backstab crit rate = 20 + 38 = 58%");
        assertApprox(psR8.breakdown.effectiveCritBonusPct - psR1.breakdown.effectiveCritBonusPct, 35, 0.01, "PS Rank 8 adds +35% more crit dmg than Rank 1");

        // Verify parsed JSON skills expose ranks[] and enriched AA Classic metadata
        const psSkill = findSkill(battlerage, "battlerage_precision_strike");
        assert(Array.isArray(psSkill.ranks) && psSkill.ranks.length >= 1, "Parsed skills include ranks[]");
        assert(psSkill.abilityLevel === 35 && psSkill.cooldownSec === 21, "Precision Strike has AA Classic Lv 35 / 21s CD metadata");
        assert(Array.isArray(psSkill.rankCritHints) && psSkill.rankCritHints.length === 8, "Precision Strike has 8 rankCritHints from aa-classic.com");

        const antiSkill = findSkill(vitalism, "vitalism_antithesis_heal");
        assert(antiSkill.ranks.length === 2, "Antithesis has 2 live-verified AA Classic ranks");
    });

    // 12. AA Classic Food & Consumable Buffs
    await test("Food, Spellbook, Potion, Vaughn's, Combat Manual, and Judge's Longing modifiers apply accurately", () => {
        const base = createDefaultCharacter({
            maxHealth: 20000,
            offense: {
                meleeAttack: 1000,
                magicAttack: 1000,
                healingPower: 1000,
                meleeSkillDamagePct: 0,
                healingPct: 0,
                focus: 1000,
            },
            defense: {
                physicalDefense: 5000,
                magicDefense: 5000,
                toughness: 2000,
                resilience: 3000,
                evasionPct: 10,
                fixedMeleeDr: 0,
                receivedMeleeDrPct: 0,
            },
        });

        // Kingdom's Shadow + Judge's Longing (Mercurial Movement) + Bulwark of Resilience + Combat Manual: Temper
        const tankBuffed = applyModifiers(base, [
            "kingdoms_shadow",
            "judges_mercurial_movement",
            "bulwark_resilience",
            "combat_manual_temper",
        ]);
        assert(tankBuffed.defense.physicalDefense === 5810, "Kingdom's Shadow adds +810 Phys Def");
        assert(tankBuffed.defense.magicDefense === 5810, "Kingdom's Shadow adds +810 Magic Def");
        assert(tankBuffed.defense.resilience === 4800, "Mercurial Movement (+600) + Bulwark of Resilience (+1200) = +1800 Resilience");
        assert(tankBuffed.defense.fixedMeleeDr === 48, "Bulwark adds +48 Fixed DR");
        assert(tankBuffed.defense.receivedMeleeDrPct === 5, "Combat Manual: Temper adds +5% Received DR");

        // Assorted Pigglewiggle: Golden Bacon + Authority of Power + Vaughn's Potent Stout + Combat Manual: Flame + Judge's Deadly Concentration
        const dpsBuffed = applyModifiers(base, [
            "pigglewiggle_bacon",
            "authority_power",
            "vaughns_potent_stout",
            "combat_manual_flame",
            "judges_deadly_concentration",
        ]);
        assert(dpsBuffed.maxHealth === 21300, "Golden Bacon adds +1300 Max HP");
        assertApprox(dpsBuffed.offense.meleeAttack, (1000 + 12 + 69) * 1.15, 0.01, "Golden Bacon (+12) + Authority (+69) x 1.15 Power");
        assert(dpsBuffed.offense.meleeSkillDamagePct === 17, "Authority (+3%) + Vaughn's Stout (+10%) + CM Flame (+4%) = +17% Skill Dmg");
        assert(dpsBuffed.offense.focus === 1600, "Deadly Concentration adds +600 Focus");
        assert(dpsBuffed.defense.evasionPct === 15, "Vaughn's Stout adds +5% Evasion");
        assert(dpsBuffed.pveDamageBonusPct === 6 && dpsBuffed.pveReceivedDrPct === 4, "Golden Bacon adds +6% PvE Dmg and -4% PvE Recv Dmg");

        // Vaughn's Soothing Tonic + Authority of Wisdom + Porcine Delight
        const healBuffed = applyModifiers(base, [
            "pigglewiggle_delight",
            "authority_wisdom",
            "vaughns_soothing_tonic",
        ]);
        assertApprox(healBuffed.offense.healingPower, (1000 + 12) * 1.15, 0.01, "Porcine Delight (+12 HPwr) x 1.15 Wisdom");
        assert(healBuffed.offense.healingPct === 10, "Vaughn's Soothing Tonic adds +10% Healing");
        assert(healBuffed.defense.magicDefense === 5060, "Porcine Delight (+60 SPI) adds +60 Magic Defense");

        // Verify PvE food bonuses affect PvE damage but not PvP damage
        const ps = findSkill(battlerage, "battlerage_precision_strike");
        const pvpHit = simulateSkillDamage(base, base, ps, { isPvE: false, attackerModifiers: ["jujube_sparkling_wine"], defenderModifiers: ["jujube_juice"] });
        const pvpNoFood = simulateSkillDamage(base, base, ps, { isPvE: false });
        assertApprox(pvpHit.normal, pvpNoFood.normal, 0.01, "Jujube PvE bonuses do not alter PvP damage");

        const pveWine = simulateSkillDamage(base, base, ps, { isPvE: true, attackerModifiers: ["jujube_sparkling_wine"] });
        const pveBase = simulateSkillDamage(base, base, ps, { isPvE: true });
        assertApprox(pveWine.normal / pveBase.normal, 1.06, 0.005, "Jujube Sparkling Wine adds +6% PvE damage");

        // Verify Jujube is a separate slot from Pigglewiggle and stacks with Pigglewiggle
        const slotIds = CONSUMABLE_SLOTS.map((s) => s.id);
        assert(slotIds.includes("food") && slotIds.includes("jujube"), "CONSUMABLE_SLOTS separates food and jujube");
        assert(COMBAT_MODIFIERS.pigglewiggle_delight.slot === "food", "Pigglewiggle uses food slot");
        assert(COMBAT_MODIFIERS.jujube_juice.slot === "jujube" && COMBAT_MODIFIERS.jujube_both.slot === "jujube", "Jujube drinks use jujube slot");

        const stackedFoodAndJujube = applyModifiers(base, ["pigglewiggle_delight", "jujube_both"]);
        assert(stackedFoodAndJujube.maxHealth === 22600, "Porcine Delight (+1300) + Jujube Juice/Wine (+1300) = +2600 Max HP");
        assert(stackedFoodAndJujube.pveDamageBonusPct === 12, "Pigglewiggle (+6%) + Jujube (+6%) = +12% PvE Dmg");
        assert(stackedFoodAndJujube.pveReceivedDrPct === 8, "Pigglewiggle (+4%) + Jujube (+4%) = +8% PvE DR");

        // Verify every consumable provides descriptive optionLabel and shortStats
        for (const [id, mod] of Object.entries(COMBAT_MODIFIERS)) {
            if (mod.slot) {
                assert(typeof mod.optionLabel === "string" && mod.optionLabel.length > 0, `${id} has optionLabel`);
                assert(typeof mod.shortStats === "string" && mod.shortStats.length > 0, `${id} has shortStats`);
            }
        }
    });

    // 13. Raid/Class Buffs, Stackable Rhythm/Intensity, Shaken & Songcraft Charm Debuffs + Icons
    await test("Intensity, Battle Focus, Rhythm stacks, Spell Shield, Health Lift, Boon, General Title, Shaken & Charm debuffs apply accurately", () => {
        const base = createDefaultCharacter({
            maxHealth: 20000,
            offense: {
                meleeAttack: 1000,
                rangedAttack: 1000,
                magicAttack: 1000,
                healingPower: 1000,
                rangedCritRatePct: 30,
                meleeCritBonusPct: 150,
                meleeSkillDamagePct: 10,
                rangedSkillDamagePct: 10,
                magicSkillDamagePct: 10,
                meleeAccuracyPct: 100,
            },
            defense: {
                physicalDefense: 8000,
                magicDefense: 6000,
                parryPct: 10,
                blockPct: 20,
                evasionPct: 15,
                receivedMagicDrPct: 10,
                receivedHealingPct: 0,
            },
        });

        // Stackable Rhythm (8 stacks = +56 Magic Atk & Heal Power) + Intensity (5s = +30% Ranged Crit) + Battle Focus (+30% Melee CD, +34% Parry)
        const offBuffed = applyModifiers(base, ["rhythm_stacks:8", "intensity:5", "battle_focus"]);
        assert(offBuffed.offense.magicAttack === 1056 && offBuffed.offense.healingPower === 1056, "Rhythm x8 adds +56 Magic Atk & Heal Power");
        assert(offBuffed.offense.rangedCritRatePct === 60, "Intensity 5s adds +30% Ranged Crit Rate");
        assert(offBuffed.offense.meleeCritBonusPct === 180, "Battle Focus R4 adds +30% Melee Crit Damage");
        assert(offBuffed.defense.parryPct === 44, "Battle Focus R4 adds +34% Parry");

        // Rhythm default (15 stacks = +105) + Health Lift (+3054) + Aranzeb's Boon (+35 all) + General Title (+25 all)
        const raidBuffed = applyModifiers(base, ["rhythm_stacks", "health_lift", "aranzebs_boon", "general_title"]);
        assertApprox(raidBuffed.offense.healingPower, 1000 + 105 + (35 + 25) * 0.2, 0.01, "Rhythm x15 (+105) + Boon/General (+60 SPI -> +12) = +117 HPwr");
        assert(raidBuffed.maxHealth === 20000 + 3054 + (35 + 25) * 12, "Health Lift (+3054) + 60 STA (+720) = +3774 Max HP");
        assert(raidBuffed.defense.magicDefense === 6060, "Boon (+35 SPI) + General (+25 SPI) = +60 Magic Defense");

        // Spell Shield (-32% Recv Magic Dmg, -32% Recv Heal)
        const shielded = applyModifiers(base, ["spell_shield"]);
        assert(shielded.defense.receivedMagicDrPct === 42, "Spell Shield R5 adds +32% Received Magic DR");
        assert(shielded.defense.receivedHealingPct === -32, "Spell Shield R5 reduces Received Healing by -32%");

        // Shaken (-24% Skill Dmg) + Charm: Lethargy (-20% Skill Dmg, -10% Acc)
        const debuffedAtk = applyModifiers(base, ["shaken", "charm_lethargy"]);
        assert(debuffedAtk.offense.meleeSkillDamagePct === 10 - 24 - 20, "Shaken (-24%) + Charm: Lethargy (-20%) reduce Skill Damage");
        assert(debuffedAtk.offense.meleeAccuracyPct === 90, "Charm: Lethargy reduces Accuracy by -10%");

        // Charm: Unguarded (-50% Phys & Magic Def) + Weakened Energy (-10% Recv Heal) + Unpleasant Sensation (-10% Block & Evasion)
        const charmedDef = applyModifiers(base, ["charm_unguarded", "charm_weakened_energy", "charm_unpleasant_sensation"]);
        assert(charmedDef.defense.physicalDefense === 4000, "Charm: Unguarded halves Physical Defense");
        assert(charmedDef.defense.magicDefense === 3000, "Charm: Unguarded halves Magic Defense");
        assert(charmedDef.defense.receivedHealingPct === -10, "Charm: Weakened Energy reduces Received Healing by -10%");
        assert(charmedDef.defense.blockPct === 10 && charmedDef.defense.evasionPct === 5, "Charm: Unpleasant Sensation reduces Block & Evasion by -10%");

        // Magic Shield R5 (Liberation + Spell Shield combo), Insulating Lens R7, Purge - Ally, Refreshment R8
        const comboDef = applyModifiers(base, ["spell_shield", "magic_shield", "insulating_lens", "purge_ally", "refreshment"]);
        assert(comboDef.defense.magicDefense === 6000 + 2840 + 540, "Magic Shield R5 (+2840) + Purge (+540) add +3380 Magic Defense");
        assert(comboDef.defense.physicalDefense === 8000 + 1300, "Insulating Lens R7 adds +1300 Physical Defense");
        assert(comboDef.maxHealth === 20000 + 3398, "Refreshment R8 adds +3398 Max Health");

        // Frenzy x5 (+150 Melee/Magic Atk + flat +21% Magic DR), Bloody Chantey (+26%), Deadeye (+120), Double Recurve (+12%), Freerunner (+220 AGI), Summon Crows (-30% Acc)
        const fullClassBuffs = applyModifiers(base, ["frenzy:5", "bloody_chantey", "deadeye", "double_recurve", "freerunner", "summon_crows"]);
        assert(fullClassBuffs.offense.meleeAttack === 1150 && fullClassBuffs.offense.magicAttack === 1150, "Frenzy x5 adds +150 Melee & Magic Attack");
        assert(fullClassBuffs.defense.receivedMagicDrPct === 31, "Frenzy adds flat +21% Magic DR regardless of stack count");
        assert(fullClassBuffs.offense.meleeSkillDamagePct === 36, "Bloody Chantey Max adds +26% Skill Damage");
        assertApprox(fullClassBuffs.offense.rangedAttack, 1000 + 120 + 220 * 0.2, 0.01, "Deadeye (+120) + Freerunner (+44) add +164 Ranged Attack");
        assertApprox(fullClassBuffs.offense.rangedCritRatePct, 30 + 12 + 220 * 0.01375, 0.01, "Double Recurve (+12%) + Freerunner (+3.025%) add Ranged Crit");
        assertApprox(fullClassBuffs.offense.meleeCritRatePct, 25 + 220 * 0.0275, 0.01, "Freerunner (+220 AGI) adds +6.05% Melee Crit");
        assert(fullClassBuffs.offense.meleeAccuracyPct === 70, "Summon Crows reduces Physical Accuracy by -30%");

        // Verify EVERY modifier (buffs, debuffs, AND consumables) has a local icon path
        for (const [id, mod] of Object.entries(COMBAT_MODIFIERS)) {
            assert(typeof mod.icon === "string" && mod.icon.startsWith("assets/icons/"), `${id} has local icon path`);
        }

        // Verify per-rank buff selection (`id:rank`) and stackable Delirium / Feral Aura
        const rankedLow = applyModifiers(base, [
            "battle_focus:1",
            "magic_circle:1",
            "ode_to_recovery_r5:3",
            "health_lift:2",
            "shaken:1",
            "spell_shield:2",
            "magic_shield:3",
            "redoubt:3",
            "delirium_5:3",
            "feral_aura_30:10",
        ]);
        assert(rankedLow.offense.meleeCritBonusPct === 150 + 15 + 15, "Battle Focus R1 (+15%) + Delirium x3 (+15%) = +30% Melee Crit Dmg");
        assert(rankedLow.defense.parryPct === 10 + 28 - 5, "Battle Focus R1 (+28%) + Feral Aura x10 (-5%) = +23% Parry");
        assert(rankedLow.offense.magicAttack === 1093, "Magic Circle R1 adds +93 Magic Attack");
        assert(rankedLow.offense.healingPower === 1080, "Ode to Recovery R3 adds +80 Healing Power");
        assert(rankedLow.maxHealth === 21288, "Health Lift R2 adds +1288 Max HP");
        assert(rankedLow.offense.meleeSkillDamagePct === 10 - 10 + 6, "Shaken R1 (-10%) + Delirium x3 (+6%) = -4% net");
        assert(rankedLow.defense.receivedMagicDrPct === 30, "Spell Shield R2 adds +20% Magic DR");
        assert(rankedLow.defense.magicDefense === 7960, "Magic Shield R3 adds +1960 Magic Def");
        assert(rankedLow.defense.blockPct === 20 + 38 - 5, "Redoubt R3 (+38%) + Feral Aura x10 (-5%) = +33% Block");
        assert(rankedLow.defense.physicalDefense === 7600, "Feral Aura x10 reduces Phys Def by -400");

        const rankedMax = applyModifiers(base, ["magic_circle", "redoubt"]);
        assert(rankedMax.offense.magicAttack === 1187, "Magic Circle defaults to max Rank 5 (+187 Magic Attack)");
        assert(rankedMax.defense.blockPct === 75, "Redoubt defaults to max Rank 5 (+55% Block)");

        // Mutually exclusive buffs: Health Lift & Refreshment cannot stack
        const hpBase = createDefaultCharacter({ maxHealth: 20000 });
        const hlThenRef = applyModifiers(hpBase, ["health_lift", "refreshment"]);
        assert(hlThenRef.maxHealth === 23398, "Health Lift + Refreshment keeps only Refreshment (+3,398 Max HP)");
        const refThenHl = applyModifiers(hpBase, ["refreshment", "health_lift"]);
        assert(refThenHl.maxHealth === 23054, "Refreshment + Health Lift keeps only Health Lift (+3,054 Max HP)");
    });

    // 14. Avoidance Rules (Shield, DW Ranged Parry, Backstab, Magic, Unavoidable), Accuracy & Average DPS
    await test("Avoidance formula, Shield/DW-Parry gates, Magic/Backstab/Unavoidable bypass, Accuracy & Avg DPS", () => {
        const meleeAttacker = createDefaultCharacter({
            offense: { meleeAttack: 1000, meleeCritRatePct: 0, meleeAccuracyPct: 100, focus: 2000 },
        });
        const rangedAttacker = createDefaultCharacter({
            offense: { rangedAttack: 1000, rangedCritRatePct: 0, rangedAccuracyPct: 100, focus: 2000 },
        });
        const mageAttacker = createDefaultCharacter({
            offense: { magicAttack: 1000, magicCritRatePct: 0, magicAccuracyPct: 100, castTimePct: 50, focus: 0 },
        });
        // Focus 2000 * 0.0027 = 5.4% negation per applicable avoidance stat
        const focusNeg = 2000 * 0.0027;

        // Defender WITH shield & NO dual-wield ranged parry
        const shieldDef = createDefaultCharacter({
            defense: {
                physicalDefense: 0,
                magicDefense: 0,
                toughness: 0,
                resilience: 0,
                evasionPct: 10,
                parryPct: 20,
                blockPct: 25,
                hasShield: true,
                dualWieldRangedParry: false,
            },
        });
        // Defender WITHOUT shield (even with blockPct=25 or Redoubt, block must NOT apply!)
        const noShieldDef = applyOverrides(shieldDef, { defense: { hasShield: false } });
        // Defender WITH Dual-Wield Ranged Parry & NO shield
        const dwDef = applyOverrides(shieldDef, { defense: { hasShield: false, dualWieldRangedParry: true } });

        const ps = findSkill(battlerage, "battlerage_precision_strike");
        const psVsShield = simulateSkillDamage(meleeAttacker, shieldDef, ps);
        const expEv = 10 - focusNeg;
        const expPa = 20 - focusNeg;
        const expBl = 25 - focusNeg;
        assertApprox(psVsShield.breakdown.avoidance.rawEvadePct, expEv, 0.01, "Evade = evasion - focus");
        assertApprox(psVsShield.breakdown.avoidance.rawParryPct, expPa, 0.01, "Parry = parry - focus");
        assertApprox(psVsShield.breakdown.avoidance.rawBlockPct, expBl, 0.01, "Block = block - focus when shield equipped");
        assertApprox(psVsShield.breakdown.avoidance.totalAvoidancePct, expEv + expPa + expBl, 0.01, "Total avoidance sums applicable stats");

        const psNoShield = simulateSkillDamage(meleeAttacker, noShieldDef, ps);
        assert(psNoShield.breakdown.avoidance.rawBlockPct === 0 && !psNoShield.breakdown.avoidance.blockApplies, "Block does NOT apply without shield");
        assertApprox(psNoShield.breakdown.avoidance.totalAvoidancePct, expEv + expPa, 0.01, "Without shield, focus is not subtracted from non-applicable block");

        // Ranged attack (Piercing Shot): Parry does NOT apply without DW passive, DOES apply with DW passive
        const piercing = findSkill(archery, "archery_piercing_shot");
        const rngNoDw = simulateSkillDamage(rangedAttacker, shieldDef, piercing);
        assert(rngNoDw.breakdown.avoidance.rawParryPct === 0 && !rngNoDw.breakdown.avoidance.parryApplies, "Parry does not apply to ranged without DW passive");
        assertApprox(rngNoDw.breakdown.avoidance.totalAvoidancePct, expEv + expBl, 0.01, "Ranged vs shield without DW uses evade + block only");

        const rngDw = simulateSkillDamage(rangedAttacker, dwDef, piercing);
        assert(rngDw.breakdown.avoidance.parryApplies, "Parry applies to ranged when Dual-Wield Ranged Parry is enabled");
        assertApprox(rngDw.breakdown.avoidance.rawParryPct, expPa, 0.01, "DW ranged parry uses parry - focus");
        assertApprox(rngDw.breakdown.avoidance.totalAvoidancePct, expEv + expPa, 0.01, "DW without shield uses evade + parry only");

        // Concussive Arrow & Tiger Strike ignore avoidance
        const concussive = findSkill(archery, "archery_concussive_arrow");
        const concRes = simulateSkillDamage(rangedAttacker, shieldDef, concussive);
        assert(concRes.breakdown.avoidance.totalAvoidancePct === 0 && concRes.breakdown.avoidance.connectPct === 100, "Concussive Arrow ignores avoidance");

        // Magic ignores avoidance
        const arc = findSkill(sorcery, "sorcery_arc_lightning");
        const arcRes = simulateSkillDamage(mageAttacker, shieldDef, arc);
        assert(arcRes.breakdown.avoidance.totalAvoidancePct === 0 && arcRes.breakdown.avoidance.connectPct === 100, "Magic damage ignores all avoidance");

        // Accuracy reduces connectPct and expected damage proportionally (even on magic & unavoidable)
        const lowAccMelee = applyOverrides(meleeAttacker, { offense: { meleeAccuracyPct: 80 } });
        const psLowAcc = simulateSkillDamage(lowAccMelee, noShieldDef, ps);
        assertApprox(psLowAcc.breakdown.avoidance.missPct, 20, 0.01, "80% accuracy = 20% miss");
        assertApprox(psLowAcc.expected, psNoShield.expected * 0.8, 0.05, "80% accuracy scales expected damage to 80%");

        const lowAccMage = applyOverrides(mageAttacker, { offense: { magicAccuracyPct: 90 } });
        const arcLowAcc = simulateSkillDamage(lowAccMage, shieldDef, arc);
        assertApprox(arcLowAcc.breakdown.avoidance.connectPct, 90, 0.01, "90% magic accuracy = 90% connect");

        // Arcadian Sea Keeper's Curse (Kraken Shield): -30% Melee & Ranged Accuracy (no Magic Accuracy penalty)
        const cursedMelee = applyModifiers(meleeAttacker, ["arcadian_sea_keepers_curse"]);
        const cursedRanged = applyModifiers(rangedAttacker, ["arcadian_sea_keepers_curse"]);
        const cursedMage = applyModifiers(mageAttacker, ["arcadian_sea_keepers_curse"]);
        assertApprox(cursedMelee.offense.meleeAccuracyPct, 70, 0.01, "Arcadian Sea Keeper's Curse reduces Melee Acc by -30%");
        assertApprox(cursedRanged.offense.rangedAccuracyPct, 70, 0.01, "Arcadian Sea Keeper's Curse reduces Ranged Acc by -30%");
        assertApprox(cursedMage.offense.magicAccuracyPct, 100, 0.01, "Arcadian Sea Keeper's Curse does not reduce Magic Acc");
        const psCursed = simulateSkillDamage(cursedMelee, noShieldDef, ps);
        assertApprox(psCursed.breakdown.avoidance.missPct, 30, 0.01, "Kraken Shield debuff causes 30% miss on melee");
        assertApprox(psCursed.expected, psNoShield.expected * 0.7, 0.05, "Kraken Shield debuff reduces melee expected damage to 70%");

        // Average DPS uses expected damage, effective cast time, and cooldown
        assert(psNoShield.dps && psNoShield.dps.sustained > 0 && psNoShield.dps.burst > psNoShield.dps.sustained, "Precision Strike (21s CD) computes burst & sustained DPS");
        assertApprox(psNoShield.dps.sustained, psNoShield.expected / 21, 0.01, "Sustained DPS = expected / 21s CD");
        // Arc Lightning has 2.0s base cast * 50% castTimePct = 1.0s cast + 1.0s post-cast GCD = 2.0s exec
        assertApprox(arcRes.dps.effectiveCastTimeSec, (arc.castTimeSec || 0) * 0.5, 0.01, "Cast Time % scales effective cast time");
        assertApprox(arcRes.dps.execTimeSec, (arc.castTimeSec || 0) * 0.5 + 1.0, 0.01, "ArcheAge casted skill exec = effectiveCastTime + post-cast GCD");
        assertApprox(arcRes.dps.burst, arcRes.expected / ((arc.castTimeSec || 0) * 0.5 + 1.0), 0.05, "Burst DPS = expected / (effCastTime + GCD)");
    });

    // 15. Dungeon & Boss Buffs (Watcher's Daggers, Blooddrinker Blossom, Berserk 1668, Supreme Doomshadow Nodachi) + Custom Buff Registry
    await test("Dungeon/Boss buffs (Watcher's Daggers, Blooddrinker, Berserk 1668, Doomshadow) & custom buff registration", () => {
        const base = createDefaultCharacter({
            offense: { meleeAttack: 1000, meleeCritRatePct: 20, meleeSkillDamagePct: 10, rangedSkillDamagePct: 10 },
            defense: { physicalDefense: 10000, receivedMeleeDrPct: 10, receivedRangedDrPct: 10, receivedMagicDrPct: 10 },
        });

        // Dark Watcher's Dagger (6143): +1%/s up to +20% Melee Crit Rate
        const dwdFull = applyModifiers(base, ["dark_watchers_dagger"]);
        const dwdHalf = applyModifiers(base, ["dark_watchers_dagger:10"]);
        assertApprox(dwdFull.offense.meleeCritRatePct, 40, 0.01, "Dark Watcher's Dagger defaults to 20s (+20% Melee Crit)");
        assertApprox(dwdHalf.offense.meleeCritRatePct, 30, 0.01, "Dark Watcher's Dagger at 10s adds +10% Melee Crit");

        // Sapphire Watcher's Dagger (9000507): +1.25%/s up to +25% Melee Crit Rate
        const swdFull = applyModifiers(base, ["sapphire_watchers_dagger"]);
        const swdHalf = applyModifiers(base, ["sapphire_watchers_dagger:10"]);
        assertApprox(swdFull.offense.meleeCritRatePct, 45, 0.01, "Sapphire Watcher's Dagger defaults to 20s (+25% Melee Crit)");
        assertApprox(swdHalf.offense.meleeCritRatePct, 32.5, 0.01, "Sapphire Watcher's Dagger at 10s adds +12.5% Melee Crit");

        // Berserk (1668): +50% Melee & Ranged Skill Dmg, +15% Received Damage (-15% DR)
        const berserk = applyModifiers(base, ["berserk_1668"]);
        assertApprox(berserk.offense.meleeSkillDamagePct, 60, 0.01, "Berserk 1668 adds +50% Melee Skill Dmg");
        assertApprox(berserk.offense.rangedSkillDamagePct, 60, 0.01, "Berserk 1668 adds +50% Ranged Skill Dmg");
        assertApprox(berserk.defense.receivedMeleeDrPct, -5, 0.01, "Berserk 1668 adds +15% Received Melee Dmg (-15% DR)");
        assertApprox(berserk.defense.receivedMagicDrPct, -5, 0.01, "Berserk 1668 adds +15% Received Magic Dmg (-15% DR)");

        // Supreme Doomshadow Nodachi (18169 Pervasive Black Magic): +10% Melee Attack, -8% Physical Defense
        const doom = applyModifiers(base, ["doomshadow_nodachi"]);
        assertApprox(doom.offense.meleeAttack, 1100, 0.01, "Supreme Doomshadow Nodachi multiplies Melee Attack by 1.10");
        assertApprox(doom.defense.physicalDefense, 9200, 0.01, "Supreme Doomshadow Nodachi multiplies Physical Defense by 0.92");

        // Blooddrinker Blossom (6148 / 9000512): -21% Received Damage (+21% DR)
        const bdb = applyModifiers(base, ["blooddrinker_blossom"]);
        assertApprox(bdb.defense.receivedMeleeDrPct, 31, 0.01, "Blooddrinker Blossom adds +21% Melee DR");
        assertApprox(bdb.defense.receivedRangedDrPct, 31, 0.01, "Blooddrinker Blossom adds +21% Ranged DR");
        assertApprox(bdb.defense.receivedMagicDrPct, 31, 0.01, "Blooddrinker Blossom adds +21% Magic DR");

        // Custom buff runtime registration + unregistration (does not clobber built-ins)
        registerCustomModifiers([
            { id: "zeal", name: "Should not overwrite built-in", side: "attacker", addOffense: { meleeAttack: 99999 } },
            { id: "test_custom_buff_99999", name: "Test Pulled Buff", side: "attacker", addOffense: { magicAttack: 123 } },
        ]);
        assert(COMBAT_MODIFIERS.zeal.addOffense.meleeAttack === undefined, "Built-in modifiers are protected from overwrite");
        const withCustom = applyModifiers(base, ["test_custom_buff_99999"]);
        assertApprox(withCustom.offense.magicAttack, base.offense.magicAttack + 123, 0.01, "Registered custom buff applies cleanly");
        assert(unregisterCustomModifier("zeal") === false, "Built-in modifiers cannot be unregistered");
        assert(unregisterCustomModifier("test_custom_buff_99999") === true, "Custom buff unregisters cleanly");
        assert(!COMBAT_MODIFIERS.test_custom_buff_99999, "Unregistered custom buff is removed");
    });

    // 16. DaruGear Baked-In Buff Auto-Matching & Exact Unbaking (unapplyModifiers round-trip)
    await test("unapplyModifiers reverses additive, attribute, maxHP, and multiplicative buffs cleanly & DaruGear matcher works", () => {
        registerCustomModifiers([
            {
                id: "test_andrion_16541",
                aacBuffId: 16541,
                name: "Andrion II's Blessing",
                side: "both",
                addOffense: { meleeAttack: 10, rangedAttack: 10, magicAttack: 10, healingPower: 10 },
                addDefense: { receivedMeleeDrPct: 6, receivedRangedDrPct: 6, receivedMagicDrPct: 6 },
            },
        ]);

        // Matcher tests (ID, custom aacBuffId, consumable name)
        assert(findModifierForDaruGearBuff({ id: 16541, name: "Andrion II's Blessing" })?.id === "test_andrion_16541", "Matches custom buff by aacBuffId");
        assert(findModifierForDaruGearBuff({ id: 1668, name: "Berserk" })?.id === "berserk_1668", "Matches known built-in by AA Classic buff ID");
        assert(findModifierForDaruGearBuff({ id: 18169, name: "Pervasive Black Magic" })?.id === "doomshadow_nodachi", "Matches Supreme Doomshadow Nodachi by buff ID 18169");
        assert(findModifierForDaruGearBuff({ id: null, name: "Kingdom's Shadow" })?.id === "kingdoms_shadow", "Matches consumable by name");

        // Exact DaruGear unbake test (sample dual-wield healer build with Andrion II's Blessing)
        const darugearBaked = createDefaultCharacter({
            maxHealth: 26564,
            attributes: { str: 51, agi: 186, sta: 768, int: 121, spi: 1368 },
            offense: { meleeAttack: 703.85, rangedAttack: 422.06, magicAttack: 34.2, healingPower: 1282.1 },
            defense: { physicalDefense: 5949, magicDefense: 14403, receivedMeleeDrPct: 25.4, receivedRangedDrPct: 16.6, receivedMagicDrPct: 22.6 },
        });
        const unbaked = unapplyModifiers(darugearBaked, ["test_andrion_16541"]);
        assertApprox(unbaked.offense.meleeAttack, 693.85, 0.001, "Unbaked Melee Attack subtracts +10");
        assertApprox(unbaked.offense.healingPower, 1272.1, 0.001, "Unbaked Healing Power subtracts +10");
        assertApprox(unbaked.defense.receivedMeleeDrPct, 19.4, 0.001, "Unbaked Melee DR subtracts +6%");
        const reapplied = applyModifiers(unbaked, ["test_andrion_16541"]);
        assertApprox(reapplied.offense.meleeAttack, 703.85, 0.001, "Re-applying buff restores exact DaruGear Melee Attack");
        assertApprox(reapplied.offense.healingPower, 1282.1, 0.001, "Re-applying buff restores exact DaruGear Healing Power");
        assertApprox(reapplied.defense.receivedMeleeDrPct, 25.4, 0.001, "Re-applying buff restores exact DaruGear Melee DR");

        // Complex multi-buff round-trip: Health Lift + Aranzeb's Boon (attributes) + Doomshadow Nodachi (multiplicative)
        const origBase = createDefaultCharacter({
            maxHealth: 22000,
            attributes: { str: 400, agi: 300, sta: 500, int: 200, spi: 250 },
            offense: { meleeAttack: 1150, magicAttack: 820, healingPower: 640, meleeCritRatePct: 35 },
            defense: { physicalDefense: 7500, magicDefense: 6200, evasionPct: 12, parryPct: 14 },
        });
        const comboTokens = ["health_lift", "aranzebs_boon", "doomshadow_nodachi"];
        const comboBuffed = applyModifiers(origBase, comboTokens);
        const comboRecovered = unapplyModifiers(comboBuffed, comboTokens);
        assertApprox(comboRecovered.maxHealth, origBase.maxHealth, 0.01, "Round-trip recovers exact Max HP");
        assertApprox(comboRecovered.offense.meleeAttack, origBase.offense.meleeAttack, 0.01, "Round-trip recovers exact Melee Attack across attr + multiplicative");
        assertApprox(comboRecovered.defense.physicalDefense, origBase.defense.physicalDefense, 0.01, "Round-trip recovers exact Physical Defense across multiplicative");
        assertApprox(comboRecovered.defense.magicDefense, origBase.defense.magicDefense, 0.01, "Round-trip recovers exact Magic Defense across SPI attr");
        assertApprox(comboRecovered.offense.meleeCritRatePct, origBase.offense.meleeCritRatePct, 0.01, "Round-trip recovers exact Melee Crit across AGI attr");

        unregisterCustomModifier("test_andrion_16541");
    });

    // 17. Attack Speed / GCD Scaling, Effective Stats (Offense, Healing Power & EHP), & Deeper DaruGear Scraping
    await test("Attack Speed GCD scaling, Effective Stats (Attack/Healing/EHP), and Deeper DaruGear Import", () => {
        // Attack Speed -> GCD % & effective GCD seconds (AA Classic 100 / (1 + 0.001 * rating))
        assertApprox(attackSpeedGcdPct(0), 100, 0.01, "0 Attack Speed = 100% GCD");
        assertApprox(attackSpeedGcdPct(177), 100 / 1.177, 0.05, "177 Attack Speed (Dual Wield) = 85.0% GCD");
        assertApprox(effectiveGcdSec(500, 1.0), 1 / 1.5, 0.01, "500 Attack Speed (Berserk) = 0.67s GCD");

        // Instant skill Burst DPS scales up with Attack Speed (Dual Wield & Berserk)
        const baseMelee = createDefaultCharacter({ offense: { meleeAttack: 1000, meleeCritRatePct: 0, attackSpeed: 0 } });
        const dwMelee = applyOverrides(baseMelee, { offense: { attackSpeed: 177 } });
        const dummy = createDefaultCharacter({ defense: { physicalDefense: 0, toughness: 0, evasionPct: 0, parryPct: 0, blockPct: 0 } });
        const ps = findSkill(battlerage, "battlerage_precision_strike");
        const psBase = simulateSkillDamage(baseMelee, dummy, ps);
        const psDw = simulateSkillDamage(dwMelee, dummy, ps);
        assertApprox(psBase.dps.gcdSec, 1.0, 0.01, "Base GCD = 1.0s");
        assertApprox(psDw.dps.gcdSec, 1 / 1.177, 0.01, "DW GCD = 0.85s");
        assertApprox(psDw.dps.burst / psBase.dps.burst, 1.177, 0.01, "DW +177 Attack Speed boosts burst DPS by +17.7%");

        // Berserk (+500 Attack Speed) & Supreme Doomshadow Nodachi (+250 Attack Speed)
        const withBerserk = applyModifiers(baseMelee, ["berserk_1668"]);
        assert(withBerserk.offense.attackSpeed === 500, "Berserk 1668 adds +500 Attack Speed rating");
        const withDoom = applyModifiers(baseMelee, ["doomshadow_nodachi"]);
        assert(withDoom.offense.attackSpeed === 250, "Supreme Doomshadow Nodachi adds +250 Attack Speed rating");

        // Effective Stats: Effective Healing Power (self, cast-adjusted, on-target)
        const healer = createDefaultCharacter({
            offense: { healingPower: 1200, healingPct: 10, healCritRatePct: 50, healCritBonusPct: 100, castTimePct: 60, attackSpeed: 177 },
        });
        const healTarget = createDefaultCharacter({
            maxHealth: 30000,
            defense: { physicalDefense: 7900, magicDefense: 7900, toughness: 8000, resilience: 4000, receivedMeleeDrPct: 20, receivedMagicDrPct: 10, receivedHealingPct: 15, evasionPct: 10, parryPct: 10, blockPct: 20, hasShield: true },
        });
        const effHealer = computeEffectiveStats(healer, healTarget);
        // 1200 * 1.10 * (1 + 0.5 * 1.0) = 1980
        assertApprox(effHealer.offense.healing.selfEffectiveHealingPower, 1980, 0.1, "Effective Healing Power = 1200 * 1.10 * 1.50 = 1980");
        assertApprox(effHealer.offense.healing.castAdjustedHealingPower, 1980 / 0.6, 0.5, "Cast-adjusted Effective Healing Power divides by castTimePct/100");
        assertApprox(effHealer.offense.healing.onTargetEffectiveHealingPower, 1980 * 1.15, 0.5, "On-target Effective Healing Power factors Target Received Healing %");
        assertApprox(effHealer.offense.speed.effectiveGcdSec, 1 / 1.177, 0.01, "Effective stats reports exact GCD");

        // Effective Stats: Effective HP (EHP) for Melee, Ranged, Magic + Healing Efficiency
        const effTank = computeEffectiveStats(healTarget, baseMelee);
        assert(effTank.defense.ehp.melee.ehp > effTank.defense.ehp.ranged.ehp, "Melee EHP > Ranged EHP when defender has Parry without DW Ranged Parry");
        assert(effTank.defense.ehp.ranged.ehp > effTank.defense.ehp.magic.ehp, "Ranged EHP > Magic EHP when defender has Shield Block + Evasion");
        assertApprox(effTank.defense.healingReceived.healMultiplier, 1.15, 0.001, "Recv Heal +15% = 1.15x heal multiplier");
        assert(effTank.defense.healingReceived.effectiveHpPer1kHealMelee > 4000, "1k raw heal yields high Melee EHP on armored tank");

        // Deeper DaruGear import: Shield PDef, Dual-Wield Proficiency -> dualWieldRangedParry, Weapon Mastery auto-activation
        const dgDwParsed = parseImportPayload(
            JSON.stringify({
                schemaVersion: 1,
                source: "darugear",
                name: "DW Darkrunner",
                equipmentType: "dual_wield",
                passives: ["Dual-Wield Proficiency", "Weapon Mastery", "Reckless Charge"],
                offense: { meleeAttack: 1300, attackSpeed: 177 },
                defense: { physicalDefense: 6000, parryPct: 18 },
            })
        );
        assert(dgDwParsed.ok, "DaruGear DW build parses cleanly");
        assert(dgDwParsed.character.offense.attackSpeed === 177, "DaruGear attackSpeed preserved");
        assert(dgDwParsed.character.defense.dualWieldRangedParry === true, "Dual-Wield + Dual-Wield Proficiency auto-enables dualWieldRangedParry");
        assert(dgDwParsed.character.defense.hasShield === false, "Dual-Wield sets hasShield=false");
        assert(Array.isArray(dgDwParsed.modifiers) && dgDwParsed.modifiers.includes("weapon_mastery"), "Weapon Mastery passive auto-activates weapon_mastery modifier");

        // Equipment import normalization (backslashes, grades, tempers, lunafrost, lunagems, synthStats)
        const dgWithGear = parseImportPayload(
            JSON.stringify({
                schemaVersion: 1,
                source: "darugear",
                name: "Geared Cleric",
                equipment: [
                    {
                        slotId: 6,
                        slotName: "Cloak",
                        name: "Erenor Bastion Cloak",
                        type: "Cloak",
                        icon: "/assets/icons/costume_cp\\nu_m_cp_cloth283.png",
                        gradeId: 11,
                        gradeName: "Mythic",
                        gradeColor: "#c90b0b",
                        synthStats: ["Spirit +102", "Received Damage -3.5%"],
                    },
                    {
                        slotId: 15,
                        slotName: "Right Hand Weapon",
                        name: "Nui's Dawn",
                        type: "Club",
                        icon: "/assets/icons/icon_item_mace_1h_0087.png",
                        gradeId: 9,
                        gradeName: "Epic",
                        mtemper: 114,
                        lunafrost: { name: "Flawless Healing", text: "Healing Power +18" },
                        lunagems: [{ name: "Lucid Gale Lunagem", text: "Crit Heal Bonus +6%" }],
                    },
                ],
                offense: { healingPower: 1200 },
            })
        );
        assert(dgWithGear.ok && dgWithGear.character.equipment?.length === 2, "Equipment list normalized & preserved");
        assert(dgWithGear.character.equipment[0].icon === "assets/icons/costume_cp/nu_m_cp_cloth283.png", "Backslashes normalized in gear icon paths");
        assert(dgWithGear.character.equipment[1].gradeColor === "#f0f6ff" && dgWithGear.character.equipment[1].mtemper === 114, "Epic uses crisp white-silver grade color & temper preserved");
        assert(dgWithGear.character.equipment[1].lunagems.length === 1 && dgWithGear.character.equipment[0].synthStats.length === 2, "Lunagems & synthesis stats preserved");
        const messySynth = parseImportPayload(
            JSON.stringify({
                name: "Synth Cleanup",
                equipment: [{ slotId: 0, name: "Costume", gradeId: 11, synthStats: ["Decrease Received Damage %\n-2.8 ~ -3.2 +-3.2%"] }],
                offense: { healingPower: 1000 },
            })
        );
        assert(messySynth.character.equipment[0].synthStats[0] === "Decrease Received Damage -3.2%", "Multi-line DaruGear synth stat cleaned up");
    });

    // 18. Rotation / Burst Combo Simulator & Exact Kill Probability
    await test("Rotation / Combo Simulator computes exact timeline, DPS/HPS, quantiles, and Kill Probability", () => {
        const drSlow = createDefaultCharacter({
            offense: { meleeAttack: 1300, meleeCritRatePct: 45, meleeCritBonusPct: 180, defensePenetration: 2000, focus: 3500, attackSpeed: 0 },
        });
        const drFast = applyOverrides(drSlow, { offense: { attackSpeed: 177 } });
        const target = createDefaultCharacter({
            maxHealth: 22000,
            defense: { physicalDefense: 6500, toughness: 3000, resilience: 4000, evasionPct: 10, parryPct: 12, blockPct: 0, receivedMeleeDrPct: 8 },
        });

        const steps = [
            { skill: findSkill(battlerage, "battlerage_charge"), isBackstab: false, targetIsCCd: false },
            { skill: findSkill(battlerage, "battlerage_triple_slash"), isBackstab: false, targetIsCCd: true },
            { skill: findSkill(battlerage, "battlerage_precision_strike"), isBackstab: true, targetIsCCd: true },
            { skill: findSkill(shadowplay, "shadowplay_shadowsmite"), isBackstab: true, targetIsCCd: true },
        ];

        const cmp = compareRotations(drFast, drSlow, target, steps, { bloodthirstStacks: 10 }, { bloodthirstStacks: 10 });
        const rFast = cmp.resultA;
        const rSlow = cmp.resultB;

        assert(rFast.stepCount === 4 && rFast.mode === "damage", "4-step damage rotation simulated");
        const sumSteps = rFast.steps.reduce((acc, s) => acc + s.result.expected, 0);
        assertApprox(rFast.totalExpected, sumSteps, 0.01, "Total expected equals sum of step expected damages");
        assertApprox(rSlow.totalDurationSec, 4.0, 0.01, "Slow (0 Attack Speed) 4 instant skills = 4.00s");
        assertApprox(rFast.totalDurationSec, 4 / 1.177, 0.02, "Dual Wield (177 Attack Speed) compresses 4 instant skills to 3.40s");
        assertApprox(rFast.windowRate / rSlow.windowRate, 1.177, 0.01, "Faster Attack Speed boosts Window DPS by +17.7%");
        assert(
            rFast.quantiles.p10 <= rFast.quantiles.median &&
                rFast.quantiles.median <= rFast.quantiles.p90 &&
                rFast.quantiles.p90 <= rFast.totalCrit + 50,
            "Burst quantiles are monotonic and bounded by All-Crit ceiling"
        );

        // Kill probability boundary checks: 100% vs low HP target, 0% vs huge HP target, intermediate vs realistic HP
        const lowHpTarget = applyOverrides(target, { maxHealth: 1000 });
        const hugeHpTarget = applyOverrides(target, { maxHealth: 200000 });
        const rLow = simulateRotation(drFast, lowHpTarget, steps, { bloodthirstStacks: 10 });
        const rHuge = simulateRotation(drFast, hugeHpTarget, steps, { bloodthirstStacks: 10 });
        assertApprox(rLow.killProbPct, 100, 0.5, "Kill probability is ~100% vs 1,000 HP target");
        assertApprox(rHuge.killProbPct, 0, 0.01, "Kill probability is 0% vs 200,000 HP target");

        const midTarget = applyOverrides(target, { maxHealth: Math.round(rFast.quantiles.median) });
        const rMid = simulateRotation(drFast, midTarget, steps, { bloodthirstStacks: 10 });
        assert(rMid.killProbPct > 25 && rMid.killProbPct < 85, "Kill probability at median HP lies strictly between 25% and 85%");

        // Healing rotation mode & Cast Time compression
        const healerSlow = createDefaultCharacter({
            offense: { healingPower: 1200, healCritRatePct: 45, healCritBonusPct: 120, castTimePct: 100, attackSpeed: 0 },
        });
        const healerFast = applyOverrides(healerSlow, { offense: { castTimePct: 60, attackSpeed: 177 } });
        const healSteps = [
            { skill: findSkill(vitalism, "vitalism_antithesis_heal") },
            { skill: findSkill(vitalism, "vitalism_fervent_healing") },
            { skill: findSkill(vitalism, "vitalism_mend") },
        ];
        const healCmp = compareRotations(healerFast, healerSlow, target, healSteps);
        assert(healCmp.resultA.mode === "heal", "Healing rotation sets mode === 'heal'");
        assert(healCmp.resultA.totalDurationSec < healCmp.resultB.totalDurationSec, "Faster Cast Time + Attack Speed shortens healing combo window");
        assert(healCmp.resultA.windowRate > healCmp.resultB.windowRate, "Faster Cast Time + Attack Speed increases Window HPS");
    });

    // 19. Per-Skill No-GCD, Reduced-GCD, Rapid-Fire, Off-GCD Rotation Weaving & Lightning/Quake Triple Slash
    await test("Per-skill No-GCD, Reduced-GCD (Resurgence, Rapid Strike), Rapid-Fire (Endless Arrows/Mana Stars) & Off-GCD Rotation Weaving", () => {
        const baseActor = createDefaultCharacter({
            offense: { meleeAttack: 1000, rangedAttack: 1000, magicAttack: 1000, healingPower: 1200, attackSpeed: 0, castTimePct: 100 },
        });
        const dwActor = applyOverrides(baseActor, { offense: { attackSpeed: 177 } });
        const target = createDefaultCharacter({
            maxHealth: 25000,
            defense: { physicalDefense: 0, magicDefense: 0, toughness: 0, resilience: 0, evasionPct: 0, parryPct: 0, blockPct: 0 },
        });

        // 1. True Off-GCD: Revitalizing Cheer (0s GCD, 45s CD)
        const cheer = findSkill(defense, "defense_revitalizing_cheer");
        const cheerRes = simulateSkillHeal(baseActor, target, cheer);
        assert(cheerRes.dps.isOffGcd === true && cheerRes.dps.gcdSec === 0 && cheerRes.dps.execTimeSec === 0, "Revitalizing Cheer is true Off-GCD (0.00s)");
        assert(cheerRes.dps.burst === null, "Off-GCD instant sets burst to null (never Infinity/NaN)");
        assertApprox(cheerRes.dps.sustained, cheerRes.expected / 45, 0.01, "Revitalizing Cheer sustained HPS divides by 45s CD");

        // 2. Reduced GCD + HoT duration: Resurgence (0.5s base GCD, 10s HoT)
        const resurgence = findSkill(vitalism, "vitalism_resurgence");
        const resBase = simulateSkillHeal(baseActor, target, resurgence);
        const resDw = simulateSkillHeal(dwActor, target, resurgence);
        assert(resBase.dps.isReducedGcd === true && resBase.dps.baseGcdSec === 0.5, "Resurgence has 0.5s reduced base GCD");
        assertApprox(resBase.dps.gcdSec, 0.5, 0.001, "Resurgence effective GCD = 0.50s at 0 Atk Spd");
        assertApprox(resDw.dps.gcdSec, 0.5 / 1.177, 0.005, "Resurgence reduced GCD scales with Attack Speed (0.425s at 177 Atk Spd)");
        assert(resBase.dps.cycleReason === "duration" && resBase.dps.cycleTimeSec === 10, "Resurgence sustained HPS uses 10s HoT duration");
        assertApprox(resBase.dps.sustained, resBase.expected / 10, 0.01, "Resurgence sustained HPS = expected / 10s");

        // 3. No-GCD Rapid-Fire: Endless Arrows (0.2s/arrow) & Mana Stars (0.3s/star) vs Flame Endless Arrows (0.6s)
        const ea = findSkill(archery, "archery_endless_arrows");
        const eaFlame = findSkill(archery, "archery_endless_arrows_flame");
        const ms = findSkill(occultism, "occultism_mana_stars");
        const eaRes = simulateSkillDamage(baseActor, target, ea);
        const eaDwRes = simulateSkillDamage(dwActor, target, ea);
        const eaFlameRes = simulateSkillDamage(baseActor, target, eaFlame);
        const msRes = simulateSkillDamage(baseActor, target, ms);
        assert(eaRes.dps.isNoGcd && eaRes.dps.gcdKind === "rapid" && eaRes.dps.gcdSec === 0, "Endless Arrows has No GCD (rapid-fire)");
        assertApprox(eaRes.dps.execTimeSec, 0.2, 0.001, "Endless Arrows fires at 0.20s/arrow base");
        assertApprox(eaDwRes.dps.execTimeSec, 0.2 / 1.177, 0.005, "Endless Arrows fire interval scales with Attack Speed");
        assertApprox(eaRes.dps.sustained, eaRes.expected / 0.2, 0.1, "Endless Arrows DPS = 5 arrows/sec at base Atk Spd");
        assert(eaFlameRes.dps.isReducedGcd && eaFlameRes.dps.baseGcdSec === 0.6, "Flame Endless Arrows has 0.60s GCD");
        assert(msRes.dps.isNoGcd && msRes.dps.gcdKind === "rapid" && Math.abs(msRes.dps.execTimeSec - 0.3) < 0.001, "Mana Stars has No GCD with 0.30s fire interval");

        // 4. Reduced-GCD filler: Rapid Strike (0.4s)
        const rs = findSkill(shadowplay, "shadowplay_rapid_strike");
        const rsRes = simulateSkillDamage(baseActor, target, rs);
        assert(rsRes.dps.isReducedGcd && Math.abs(rsRes.dps.execTimeSec - 0.4) < 0.001, "Rapid Strike has 0.40s reduced GCD");

        // 5. Rotation timeline respects 0s Off-GCD, 0.5s Resurgence, and sequential Cast + GCD
        const healRot = simulateRotation(baseActor, target, [
            { skill: cheer },       // 0.00s (Off-GCD)
            { skill: resurgence },  // 0.50s (Reduced GCD)
            { skill: findSkill(vitalism, "vitalism_antithesis_heal") }, // 2.00s cast + 1.00s GCD = 3.00s
        ]);
        assertApprox(healRot.steps[0].durationSec, 0.0, 0.001, "Revitalizing Cheer adds 0.00s to rotation timeline");
        assertApprox(healRot.steps[1].durationSec, 0.5, 0.001, "Resurgence adds 0.50s to rotation timeline");
        assertApprox(healRot.steps[2].castSec, 2.0, 0.001, "Antithesis has 2.00s cast time");
        assertApprox(healRot.steps[2].postGcdSec, 1.0, 0.001, "Antithesis has 1.00s post-cast GCD");
        assertApprox(healRot.totalDurationSec, 3.5, 0.001, "Cheer (0s) + Resurgence (0.5s) + Antithesis (2.0s cast + 1.0s GCD) = 3.50s total");

        const ps = findSkill(battlerage, "battlerage_precision_strike");
        const rotWithOverride = simulateRotation(baseActor, target, [
            { skill: ps },
            { skill: ps, offGcd: true },
        ]);
        assertApprox(rotWithOverride.totalDurationSec, 1.0, 0.001, "Per-step offGcd: true override collapses 2nd Precision Strike to 0.00s");

        // 6. Triple Slash Ancestral variants: Lightning (fast 1.2s) & Quake (AoE 1.8s), NO Flame
        const tsLight = findSkill(battlerage, "battlerage_triple_slash_lightning");
        const tsQuake = findSkill(battlerage, "battlerage_triple_slash_quake");
        const tsFlame = findSkill(battlerage, "battlerage_triple_slash_flame");
        assert(tsLight && tsLight.name === "Triple Slash (Lightning)" && tsLight.gcdSec === 1.2, "Triple Slash (Lightning) exists with 1.2s chain GCD");
        assert(tsQuake && tsQuake.name === "Triple Slash (Quake)" && tsQuake.gcdSec === 1.8, "Triple Slash (Quake) exists with 1.8s chain GCD");
        assert(!tsFlame, "Misnamed Triple Slash (Flame) does not exist");
    });

    // 20. Cast Time + GCD Sequencing & Cast-Time-Removing Combos (Spell Shield -> Antithesis, Drop Back, Frigid Tracks)
    await test("Cast Time + GCD sequencing and Cast-Time-Removing Combos (Spell Shield -> Antithesis, Drop Back, Frigid Tracks)", () => {
        const healer = createDefaultCharacter({
            offense: { healingPower: 1300, healCritRatePct: 40, healCritBonusPct: 120, castTimePct: 60, attackSpeed: 177 },
        });
        const mage = createDefaultCharacter({
            offense: { magicAttack: 1200, magicCritRatePct: 35, magicCritBonusPct: 150, castTimePct: 100, attackSpeed: 0 },
        });
        const target = createDefaultCharacter({ maxHealth: 25000 });

        const spellShield = findSkill(auramancy, "auramancy_spell_shield");
        const dropBack = findSkill(shadowplay, "shadowplay_drop_back");
        const dropBackWave = findSkill(shadowplay, "shadowplay_drop_back_wave");
        const frigidTracks = findSkill(sorcery, "sorcery_frigid_tracks");
        const antithesis = findSkill(vitalism, "vitalism_antithesis_heal");
        const mend = findSkill(vitalism, "vitalism_mend");
        const concussive = findSkill(archery, "archery_concussive_arrow");
        const critDiscord = findSkill(songcraft, "songcraft_critical_discord");
        const freezingArrow = findSkill(sorcery, "sorcery_freezing_arrow");
        const flamebolt = findSkill(sorcery, "sorcery_flamebolt");
        const sunderEarth = findSkill(battlerage, "battlerage_sunder_earth");

        assert(spellShield && spellShield.kind === "utility" && spellShield.gcdSec === 0, "Spell Shield utility skill exists and is Off-GCD");
        assert(dropBack && dropBack.kind === "utility" && dropBack.gcdSec === 0.5, "Base Drop Back utility skill exists with 0.5s reduced GCD");
        assert(dropBackWave && dropBackWave.kind === "utility" && dropBackWave.variant === "ancestral" && dropBackWave.gcdSec === 0.5, "Wave Drop Back ancestral utility skill exists with 0.5s reduced GCD");
        assert(frigidTracks && frigidTracks.kind === "utility" && frigidTracks.gcdSec === 0.5, "Frigid Tracks utility skill exists with 0.5s reduced GCD");

        // 1. Hard-casted Antithesis (2.0s * 60% = 1.20s cast + 0.85s DW GCD = 2.05s) vs Spell Shield -> Antithesis (0s + 0.85s = 0.85s)
        const dwGcd = 1 / 1.177;
        const hardAnti = simulateRotation(healer, target, [{ skill: antithesis }]);
        const comboAnti = simulateRotation(healer, target, [{ skill: spellShield }, { skill: antithesis }]);
        assertApprox(hardAnti.steps[0].castSec, 1.2, 0.005, "Hard-casted Antithesis at 60% Cast Time = 1.20s cast");
        assertApprox(hardAnti.totalDurationSec, 1.2 + dwGcd, 0.01, "Hard-casted Antithesis total = 1.20s cast + 0.85s DW GCD");
        assert(comboAnti.mode === "heal", "Utility step + Heal step preserves mode === 'heal'");
        assertApprox(comboAnti.steps[0].durationSec, 0.0, 0.001, "Spell Shield takes 0.00s (Off-GCD)");
        assert(comboAnti.steps[1].castTimeRemoved && comboAnti.steps[1].castRemovedBy === "Spell Shield", "Spell Shield automatically removes Antithesis cast time");
        assertApprox(comboAnti.steps[1].castSec, 0.0, 0.001, "Combo Antithesis has 0.00s cast time");
        assertApprox(comboAnti.steps[1].durationSec, dwGcd, 0.01, "Combo Antithesis takes only its 0.85s DW GCD");
        assertApprox(comboAnti.totalCastTimeSavedSec, 1.2, 0.005, "Spell Shield -> Antithesis saves 1.20s of cast time");
        assertApprox(comboAnti.totalExpected, hardAnti.totalExpected, 0.01, "Utility step adds 0 heal and preserves exact Antithesis expected heal");

        // 2. Base Drop Back removes Flamebolt & Sunder Earth cast times (NOT Mend), while Wave Drop Back removes Mend, Concussive Arrow & Critical Discord (NOT Flamebolt)
        const baseDbRot = simulateRotation(mage, target, [
            { skill: dropBack },     // 0.00 -> 0.50s (expires 3.00s)
            { skill: flamebolt },    // 0.50 -> 1.50s (Instant via Drop Back!)
            { skill: sunderEarth },  // 1.50 -> 2.50s (Instant via Drop Back!)
            { skill: mend },         // 2.50 -> 6.50s (NOT affected by base Drop Back -> 3.0s cast + 1.0s GCD!)
        ]);
        assert(baseDbRot.steps[1].castTimeRemoved && baseDbRot.steps[1].castRemovedBy === "Drop Back", "Base Drop Back removes Flamebolt cast time");
        assert(baseDbRot.steps[2].castTimeRemoved && baseDbRot.steps[2].castRemovedBy === "Drop Back", "Base Drop Back removes Sunder Earth cast time");
        assert(!baseDbRot.steps[3].castTimeRemoved && Math.abs(baseDbRot.steps[3].castSec - 3.0) < 0.001, "Base Drop Back does NOT remove Mend cast time");

        const waveDbRot = simulateRotation(mage, target, [
            { skill: dropBackWave }, // 0.00 -> 0.50s (buff expires at 3.00s)
            { skill: mend },         // starts at 0.50s (< 3.00s) -> Instant via Wave Drop Back! 0.50 -> 1.50s
            { skill: concussive },   // starts at 1.50s (< 3.00s) -> Instant via Wave Drop Back! 1.50 -> 2.50s
            { skill: critDiscord, delaySec: 1.0 }, // starts at 2.50s (< 3.00s) -> Instant via Wave Drop Back! 2.50 -> 4.50s
            { skill: mend },         // starts at 4.50s (> 3.00s expired!) -> Hard-casted 3.0s + 1.0s = 4.0s
        ]);
        assert(waveDbRot.steps[1].castTimeRemoved && waveDbRot.steps[1].castRemovedBy === "Wave Drop Back", "Wave Drop Back removes Mend 3.0s cast time");
        assertApprox(waveDbRot.steps[1].durationSec, 1.0, 0.001, "Instant Mend takes 1.00s GCD at 0 Atk Spd");
        assert(waveDbRot.steps[2].castTimeRemoved && waveDbRot.steps[2].castRemovedBy === "Wave Drop Back", "Wave Drop Back removes Concussive Arrow cast time");
        assert(waveDbRot.steps[3].castTimeRemoved && waveDbRot.steps[3].castRemovedBy === "Wave Drop Back", "Wave Drop Back removes Critical Discord cast time");
        assert(!waveDbRot.steps[4].castTimeRemoved && Math.abs(waveDbRot.steps[4].castSec - 3.0) < 0.001, "After Wave Drop Back's 2.5s window expires, Mend reverts to 3.0s hard cast");

        const waveNotFlame = simulateRotation(mage, target, [{ skill: dropBackWave }, { skill: flamebolt }]);
        assert(!waveNotFlame.steps[1].castTimeRemoved && Math.abs(waveNotFlame.steps[1].castSec - 1.0) < 0.001, "Wave Drop Back does NOT remove Flamebolt cast time");

        // 3. Frigid Tracks -> Freezing Arrow (removes 2.0s cast)
        const ftFreeze = simulateRotation(mage, target, [{ skill: frigidTracks }, { skill: freezingArrow }]);
        assert(ftFreeze.steps[1].castTimeRemoved && ftFreeze.steps[1].castRemovedBy === "Frigid Tracks", "Frigid Tracks removes Freezing Arrow cast time");
        assertApprox(ftFreeze.totalDurationSec, 1.5, 0.001, "Frigid Tracks (0.5s) + Instant Freezing Arrow (1.0s) = 1.50s total (vs 3.0s hard-cast)");

        // 4. Manual per-step Instant (noCastTime: true) override
        const manualInst = simulateRotation(mage, target, [{ skill: freezingArrow, noCastTime: true }]);
        assert(manualInst.steps[0].castTimeRemoved && manualInst.steps[0].castRemovedBy === "Manual Instant", "Manual noCastTime: true removes cast time");
        assertApprox(manualInst.totalDurationSec, 1.0, 0.001, "Manual Instant Freezing Arrow takes 1.00s GCD");
    });

    // 21. Automatic Damage, Healing, CC & Debuff Combos in Rotations
    await test("Automatic rotation combos: Resurgence -> Mend (+30%), Shocked/Impaled -> Arc Lightning, Slowed -> Piercing Shot, Auto-CC & Debuffs", () => {
        const actor = createDefaultCharacter({
            offense: { meleeAttack: 1200, rangedAttack: 1200, magicAttack: 1200, healingPower: 1200, meleeCritRatePct: 0, rangedCritRatePct: 0, magicCritRatePct: 0, healCritRatePct: 0, focus: 0 },
        });
        const target = createDefaultCharacter({
            maxHealth: 30000,
            defense: { physicalDefense: 4000, magicDefense: 4000, toughness: 0, resilience: 0, evasionPct: 25, parryPct: 20, blockPct: 0 },
        });

        // 1. Resurgence -> Mend (+30% Heal combo)
        const resurgence = findSkill(vitalism, "vitalism_resurgence");
        const mend = findSkill(vitalism, "vitalism_mend");
        const mendSolo = simulateRotation(actor, target, [{ skill: mend }]);
        const mendCombo = simulateRotation(actor, target, [{ skill: resurgence }, { skill: mend }]);
        assertApprox(mendCombo.steps[1].result.normal / mendSolo.steps[0].result.normal, 1.3, 0.001, "Resurgence -> Mend boosts Mend healing by +30%");
        assert(mendCombo.steps[1].autoComboLabels.includes("Resurgence +30% Heal"), "Resurgence -> Mend reports auto-combo label");

        // 2. Chain Lightning (Shocked) -> Arc Lightning (+43%) vs Hell Spear (Impaled) -> Arc Lightning (+45%)
        const chain = findSkill(sorcery, "sorcery_chain_lightning");
        const arc = findSkill(sorcery, "sorcery_arc_lightning");
        const hellSpear = findSkill(occultism, "occultism_hell_spear");
        const arcSolo = simulateRotation(actor, target, [{ skill: arc }]);
        const arcShock = simulateRotation(actor, target, [{ skill: chain }, { skill: arc }]);
        const arcImpale = simulateRotation(actor, target, [{ skill: hellSpear }, { skill: arc }]);
        assertApprox(arcShock.steps[1].result.normal / arcSolo.steps[0].result.normal, 1.43, 0.002, "Chain Lightning (Shocked) -> Arc Lightning deals +43% damage");
        assertApprox(arcImpale.steps[1].result.normal / arcSolo.steps[0].result.normal, 1.45, 0.002, "Hell Spear (Impaled) -> Arc Lightning deals +45% damage");

        // 3. Charged Bolt (Slowed) -> Piercing Shot (+26%)
        const chargedBolt = findSkill(archery, "archery_charged_bolt");
        const piercing = findSkill(archery, "archery_piercing_shot");
        const psSolo = simulateRotation(actor, target, [{ skill: piercing }]);
        const psCombo = simulateRotation(actor, target, [{ skill: chargedBolt }, { skill: piercing }]);
        assertApprox(psCombo.steps[1].result.normal / psSolo.steps[0].result.normal, 1.26, 0.002, "Charged Bolt (Slowed) -> Piercing Shot deals +26% damage");

        // 4. Auto-CC avoidance bypass (Overwhelm Stun -> Precision Strike connects 100% vs 45% evasion/parry target)
        const overwhelm = findSkill(shadowplay, "shadowplay_overwhelm");
        const precStrike = findSkill(battlerage, "battlerage_precision_strike");
        const psFront = simulateRotation(actor, target, [{ skill: precStrike }]);
        const psAfterStun = simulateRotation(actor, target, [{ skill: overwhelm }, { skill: precStrike }]);
        assert(psFront.steps[0].result.breakdown.avoidance.connectPct < 60, "Un-CC'd front Precision Strike loses connect % to evasion/parry");
        assertApprox(psAfterStun.steps[1].result.breakdown.avoidance.connectPct, 100, 0.01, "Overwhelm Stun automatically bypasses avoidance on Precision Strike");
        assert(psAfterStun.steps[1].autoCCLabel === "Stunned", "Auto-CC reports Stunned status");

        // 5. Auto-debuff application (Dissonance -320 MDef boosts subsequent Arc Lightning)
        const dissonance = findSkill(songcraft, "songcraft_dissonance");
        const arcDebuffed = simulateRotation(actor, target, [{ skill: dissonance }, { skill: arc }]);
        assert(arcDebuffed.steps[1].result.normal > arcSolo.steps[0].result.normal, "Dissonance (-320 MDef) increases subsequent magic skill damage");
        assertApprox(arcDebuffed.steps[1].result.breakdown.effectiveDefense, 4000 - 320, 0.01, "Dissonance reduces target Magic Defense by -320");
    });

    // 22. Quick Compare Gear Swapper: Hat Lunagems (PDef <-> MDef <-> Toughness) & Costume Synthesis Stats
    await test("Gear Swapper parses DaruGear stat lines and accurately swaps Hat Lunagems and Costume synthesis stats", () => {
        const parsedPdef = parseGearStatLine("Physical Defense Increase +100.0");
        assert(parsedPdef.recognized && parsedPdef.addDefense.physicalDefense === 100, "Parses Physical Defense lunagem");
        const parsedDr = parseGearStatLine("Decrease Received Damage -3.2%");
        assert(parsedDr.recognized && parsedDr.addDefense.receivedMeleeDrPct === 3.2 && parsedDr.addDefense.receivedMagicDrPct === 3.2, "Parses Received Damage -3.2% synthesis stat");
        const parsedCast = parseGearStatLine("Cast Time Decrease -1.0%");
        assert(parsedCast.recognized && parsedCast.addOffense.castTimePct === -1.0, "Parses Cast Time -1.0% lunagem");

        const sampleHealer = createDefaultCharacter({
            name: "Sample Shield Healer",
            maxHealth: 28150,
            offense: { healingPower: 1210, healCritRatePct: 48.5, castTimePct: 61.6 },
            defense: { physicalDefense: 11292, magicDefense: 14553, toughness: 3552, resilience: 5042, receivedMeleeDrPct: 22.6, receivedRangedDrPct: 13.8, receivedMagicDrPct: 19.8 },
            equipment: [
                {
                    slotId: 0,
                    slotName: "Costume",
                    name: "Healing Basic Costume",
                    synthStats: [
                        "Physical Defense Increase +1100",
                        "Resilience +835",
                        "Decrease Received Damage -3.2%",
                    ],
                },
                {
                    slotId: 1,
                    slotName: "Head",
                    name: "Purehearted Goddess Hood",
                    lunagems: [
                        { name: "Lucid Wave Lunagem: Defense", text: "Physical Defense Increase +100.0" },
                        { name: "Lucid Wave Lunagem: Defense", text: "Physical Defense Increase +100.0" },
                    ],
                },
            ],
        });

        // Swap Hat 2x PDef (+100) -> 2x MDef (+100) -> 2x Hero Toughness (+170) -> back to 2x PDef (+100)
        const hatMdef = swapSlotLunagems(sampleHealer, 1, "mdef", { count: 2, perGemValue: 100 });
        assert(sampleHealer.defense.physicalDefense === 11292, "Original character is never mutated");
        assert(hatMdef.character.defense.physicalDefense === 11092, "Swapping Hat PDef->MDef subtracts 200 PDef");
        assert(hatMdef.character.defense.magicDefense === 14753, "Swapping Hat PDef->MDef adds 200 MDef");

        const hatTough = swapSlotLunagems(hatMdef.character, 1, "toughness_hat", { count: 2, perGemValue: 170 });
        assert(hatTough.character.defense.magicDefense === 14553, "Swapping Hat MDef->Toughness subtracts 200 MDef");
        assert(hatTough.character.defense.toughness === 3892, "Swapping Hat MDef->Toughness adds 340 Toughness");

        const hatBack = swapSlotLunagems(hatTough.character, 1, "pdef", { count: 2, perGemValue: 100 });
        assert(hatBack.character.defense.physicalDefense === 11292 && hatBack.character.defense.toughness === 3552, "Round-trip Hat swap recovers exact baseline stats");

        // Swap Costume line 0: Physical Defense +1100 -> Toughness +650
        const costSwap = swapEquipmentSynthStat(sampleHealer, 0, 0, "toughness", 650);
        assert(costSwap.character.defense.physicalDefense === 10192, "Costume swap subtracts 1100 PDef");
        assert(costSwap.character.defense.toughness === 4202, "Costume swap adds 650 Toughness");
        assert(costSwap.character.equipment[0].synthStats[0] === "Toughness +650", "Costume equipment synthStats[] updated in sync");
    });

    // 23. AA Classic 1.3.6 Enlightened (Hollow) Skills & Combat Buffs
    await test("Enlightened Hollow buffs & skills: Hollow Frenzy, Hollow Deadeye -> Instant Snipe, 15x Rhythm -> Instant Hollow Critical Discord, Throw Dagger, Focal Concussion & Comet's Boon", () => {
        const baseActor = createDefaultCharacter({
            offense: {
                meleeAttack: 1000,
                rangedAttack: 1000,
                magicAttack: 1200,
                attackSpeed: 0,
                focus: 2000,
                castTimePct: 100,
                meleeCritRatePct: 0,
                rangedCritRatePct: 0,
                magicCritRatePct: 0,
            },
            defense: { receivedMeleeDrPct: 10, receivedRangedDrPct: 10, receivedMagicDrPct: 10 },
        });
        const target = createDefaultCharacter({
            maxHealth: 30000,
            defense: { physicalDefense: 0, magicDefense: 0, toughness: 0, resilience: 0, evasionPct: 25, parryPct: 20, blockPct: 0 },
        });

        // 1. Hollow Frenzy (5 stacks = +150 Melee/Magic Atk, +200 Atk Spd, +1500 Focus, -15% DR) & mutual exclusivity with Frenzy
        const hf5 = applyModifiers(baseActor, ["frenzy:10", "hollow_frenzy:5"]);
        assertApprox(hf5.offense.meleeAttack, 1150, 0.01, "Hollow Frenzy 5x overrides base Frenzy and adds +150 Melee Atk");
        assertApprox(hf5.offense.magicAttack, 1350, 0.01, "Hollow Frenzy 5x adds +150 Magic Atk");
        assertApprox(hf5.offense.attackSpeed, 200, 0.01, "Hollow Frenzy 5x adds +200 Attack Speed");
        assertApprox(hf5.offense.focus, 3500, 0.01, "Hollow Frenzy 5x adds +1,500 Focus");
        assertApprox(hf5.defense.receivedMeleeDrPct, -5, 0.01, "Hollow Frenzy 5x applies +15% Received Melee Damage (-15% DR)");
        assertApprox(hf5.defense.receivedMagicDrPct, -5, 0.01, "Hollow Frenzy 5x does not inherit base Frenzy +21% Magic DR");

        // 2. Hollow Deadeye (100 stacks = +160 Ranged Atk + Instant Snipe) & mutual exclusivity with base Deadeye
        const hd50 = applyModifiers(baseActor, ["deadeye:6", "hollow_deadeye:50"]);
        const hd100 = applyModifiers(baseActor, ["deadeye:6", "hollow_deadeye:100"]);
        assertApprox(hd50.offense.rangedAttack, 1080, 0.01, "Hollow Deadeye 50x overrides base Deadeye and adds +80 Ranged Atk");
        assertApprox(hd100.offense.rangedAttack, 1160, 0.01, "Hollow Deadeye 100x adds +160 Ranged Atk");
        const snipe = findSkill(archery, "archery_snipe");
        const snipe50 = simulateSkillDamage(hd50, target, snipe);
        const snipe100 = simulateSkillDamage(hd100, target, snipe);
        assert(!snipe50.dps.castTimeRemoved && Math.abs(snipe50.dps.effectiveCastTimeSec - 1.5) < 0.001, "Snipe still hard-casts 1.5s at 50 stacks of Hollow Deadeye");
        assert(snipe100.dps.castTimeRemoved && snipe100.dps.effectiveCastTimeSec === 0, "Snipe becomes Instant Cast at 100 stacks of Hollow Deadeye");
        assert(snipe100.dps.castRemovedBy === "Hollow Deadeye (100x)", "Snipe cast removal credits Hollow Deadeye (100x)");

        // 2b. Utility combo step archery_hollow_deadeye -> archery_snipe removes cast time in rotation
        const hdSkill = findSkill(archery, "archery_hollow_deadeye");
        const hdRot = simulateRotation(baseActor, target, [{ skill: hdSkill }, { skill: snipe }]);
        assert(hdSkill && hdSkill.variant === "hollow" && hdSkill.kind === "utility", "Hollow Deadeye utility skill exists");
        assert(hdRot.steps[1].castTimeRemoved && hdRot.steps[1].castRemovedBy === "Hollow Deadeye (100x)", "Hollow Deadeye rotation step makes Snipe instant");

        // 3. Hollow Critical Discord (4.0s cast normally -> Instant at 15x Rhythm)
        const hcd = findSkill(songcraft, "songcraft_critical_discord_hollow");
        const r14 = applyModifiers(baseActor, ["rhythm_stacks:14"]);
        const r15 = applyModifiers(baseActor, ["rhythm_stacks:15"]);
        const hcd14 = simulateSkillDamage(r14, target, hcd);
        const hcd15 = simulateSkillDamage(r15, target, hcd);
        assert(hcd && hcd.variant === "hollow" && hcd.castTimeSec === 4.0, "Hollow Critical Discord exists with 4.0s base cast time");
        assert(!hcd14.dps.castTimeRemoved && Math.abs(hcd14.dps.effectiveCastTimeSec - 4.0) < 0.001, "Hollow Critical Discord hard-casts 4.0s at 14x Rhythm");
        assert(hcd15.dps.castTimeRemoved && hcd15.dps.effectiveCastTimeSec === 0 && hcd15.dps.castRemovedBy === "15x Rhythm", "Hollow Critical Discord becomes Instant at 15x Rhythm");

        // 4. Hollow Throw Dagger Ranged (Dagger) vs Magic (Scepter) scaling
        const htdRng = findSkill(shadowplay, "shadowplay_throw_dagger_hollow_ranged");
        const htdMag = findSkill(shadowplay, "shadowplay_throw_dagger_hollow_magic");
        assert(htdRng && htdMag && htdRng.variant === "hollow" && htdMag.variant === "hollow", "Both Hollow Throw Dagger variants exist");
        const resRng = simulateSkillDamage(baseActor, target, htdRng, { targetIsCCd: true });
        const resMag = simulateSkillDamage(baseActor, target, htdMag);
        assert(resMag.normal > resRng.normal, "With 1200 Magic Atk > 1000 Ranged Atk, Hollow Throw Dagger (Scepter) hits harder than (Dagger)");

        // 5. Hollow Focal Concussion auto-Stun CC bypass & Hollow Comet's Boon Slowed -> Piercing Shot (+26%)
        const hfc = findSkill(witchcraft, "witchcraft_focal_concussion_hollow");
        const hcb = findSkill(auramancy, "auramancy_comets_boon_hollow");
        const ps = findSkill(battlerage, "battlerage_precision_strike");
        const piercing = findSkill(archery, "archery_piercing_shot");
        const hfcRot = simulateRotation(baseActor, target, [{ skill: hfc }, { skill: ps }]);
        assertApprox(hfcRot.steps[1].result.breakdown.avoidance.connectPct, 100, 0.01, "Hollow Focal Concussion Stun bypasses avoidance on Precision Strike");
        assert(hfcRot.steps[1].autoCCLabel === "Stunned", "Hollow Focal Concussion sets Stunned CC status");

        const piercingSolo = simulateRotation(baseActor, target, [{ skill: piercing }]);
        const hcbRot = simulateRotation(baseActor, target, [{ skill: hcb }, { skill: piercing }]);
        assertApprox(hcbRot.steps[1].result.normal / piercingSolo.steps[0].result.normal, 1.26, 0.002, "Hollow Comet's Boon Slowed triggers Piercing Shot +26% combo");

        // 6. Verify remaining Hollow skills (Ollo's Hammer, Absorb Lifeforce, Searing Rain) are present
        assert(Boolean(findSkill(defense, "defense_ollos_hammer_hollow")), "Hollow Ollo's Hammer loaded");
        assert(Boolean(findSkill(occultism, "occultism_absorb_lifeforce_hollow")), "Hollow Absorb Lifeforce loaded");
        assert(Boolean(findSkill(sorcery, "sorcery_searing_rain_hollow")), "Hollow Searing Rain loaded");

        // 7. Archery Abyssal skills: Serpent's Sight (utility, 1.0s cast, 10s CD) & Fang Bolt (312% Ranged Atk)
        const serpentSight = findSkill(archery, "archery_serpents_sight");
        const fangBolt = findSkill(archery, "archery_fang_bolt");
        assert(
            serpentSight && serpentSight.variant === "abyssal" && serpentSight.kind === "utility" && serpentSight.castTimeSec === 1.0 && serpentSight.cooldownSec === 10.0,
            "Serpent's Sight exists as Abyssal utility (1.0s cast, 10s CD)"
        );
        assert(
            fangBolt && fangBolt.variant === "abyssal" && fangBolt.kind === "damage" && fangBolt.scalingPct === 312,
            "Fang Bolt exists as Abyssal damage skill (312% Ranged Atk)"
        );
        const fbRes = simulateSkillDamage(baseActor, target, fangBolt, { targetIsCCd: true });
        assertApprox(fbRes.normal, 3120, 0.5, "Fang Bolt deals 312% of 1000 Ranged Attack = 3,120 vs 0-def target");
        const ssRot = simulateRotation(baseActor, target, [
            { skill: serpentSight },
            { skill: fangBolt, targetIsCCd: true },
            { skill: fangBolt, targetIsCCd: true },
        ]);
        assertApprox(ssRot.totalDurationSec, 4.0, 0.01, "Serpent's Sight (1s cast + 1s GCD) + 2x Fang Bolt (2s) = 4.0s total");
        assertApprox(ssRot.totalExpected, 6240, 2.0, "Serpent's Sight + 2x Fang Bolt deals 6,240 expected damage");
    });

    // 24. 1-to-1 Armor Grade Shifts, Armor Type Swaps (Ayanad Wave Plate <-> Cloth), Tier & Weapon Grade Swaps
    await test("1-to-1 Gear Swaps: exact DaruGear 1.3.6 Ayanad Wave Plate <-> Cloth, Legendary -> Epic armor grade reduction & round-trip", () => {
        // 1. Verify exact DaruGear 1.3.6 per-piece & 7-piece defense formulas
        const sumSet = (level, gradeId, armorType) =>
            ARMOR_SLOTS.reduce(
                (acc, s) => {
                    const d = computeArmorPieceDefense({ level, gradeId, armorType, coverage: s.coverage, ptemper: 100, mtemper: 100 });
                    acc.p += d.physicalDefense;
                    acc.m += d.magicDefense;
                    return acc;
                },
                { p: 0, m: 0 }
            );
        const epicCloth = sumSet(62, 9, "Cloth");
        const epicPlate = sumSet(62, 9, "Plate");
        const legPlate = sumSet(62, 10, "Plate");
        const legCloth = sumSet(62, 10, "Cloth");
        const epicLeather = sumSet(62, 9, "Leather");
        assertApprox(epicCloth.p, 2466, 3, "Epic Ayanad Cloth 7pc PDef matches live DaruGear (~2,466)");
        assertApprox(epicCloth.m, 12332, 3, "Epic Ayanad Cloth 7pc MDef matches live DaruGear (~12,332)");
        assertApprox(epicPlate.p, 14800, 3, "Epic Ayanad Plate 7pc PDef matches live DaruGear (~14,800)");
        assert(epicPlate.m === 0 && legPlate.m === 0, "Plate armor has 0 base MDef");
        assertApprox(legPlate.p, 16541, 3, "Legendary Ayanad Plate 7pc PDef matches live DaruGear (~16,541)");
        assertApprox(epicLeather.p, 7399, 3, "Epic Ayanad Leather 7pc PDef matches live DaruGear (~7,399)");
        assertApprox(epicLeather.m, 7399, 3, "Epic Ayanad Leather 7pc MDef matches live DaruGear (~7,399)");

        // 2. Build a realistic 7pc Legendary Ayanad Wave Plate character
        const ayanadWavePlate = createDefaultCharacter({
            name: "Wave Mage",
            maxHealth: 26000,
            attributes: { str: 158, agi: 158, sta: 458, int: 1140, spi: 158 },
            offense: { magicAttack: 1100, magicCritRatePct: 25.0, defensePenetration: 500, magicDefensePenetration: 500 },
            defense: {
                physicalDefense: Math.round(legPlate.p * 1.03), // Complete Plate Set +3%
                magicDefense: 158,
                shieldPhysicalDefense: 4000,
                hasShield: true,
                parryPct: 9.3,
                blockPct: 14.3,
                receivedMeleeDrPct: 13.5,
                receivedRangedDrPct: 13.5,
                receivedMagicDrPct: 13.5,
            },
            equipment: [
                ...ARMOR_SLOTS.map((s) => ({
                    slotId: s.slotId,
                    slotName: s.slotName,
                    name: `Ayanad Wave ${s.names.Plate}`,
                    type: "Plate",
                    gradeId: 10,
                    gradeName: "Legendary",
                    gradeColor: "#ffb326",
                    ptemper: 100,
                    mtemper: 100,
                })),
                {
                    slotId: 16,
                    slotName: "Left Hand Weapon",
                    name: "Ayanad Wave Shield",
                    type: "Shield",
                    gradeId: 9,
                    gradeName: "Epic",
                    gradeColor: "#f0f6ff",
                },
            ],
        });

        // 2a. Swap Ayanad Wave Plate (Legendary) -> Ayanad Wave Cloth (Legendary)
        const toCloth = swapArmorType(ayanadWavePlate, "Cloth");
        assert(toCloth.changedCount === 7, "All 7 Plate armor pieces swapped to Cloth");
        assert(toCloth.character.equipment[1].name === "Ayanad Wave Shirt", "Ayanad Wave Cuirass renamed to Ayanad Wave Shirt");
        assertApprox(toCloth.character.defense.physicalDefense, legCloth.p, 1, "Legendary Ayanad Wave Cloth PDef matches 7pc Cloth (removed +3% Plate bonus)");
        assertApprox(toCloth.character.defense.magicDefense, 158 + legCloth.m, 1, "Legendary Ayanad Wave Cloth MDef adds exact 7pc Cloth MDef");
        assertApprox(toCloth.character.offense.magicCritRatePct, 25.0 + 4.3, 0.01, "Legendary Cloth Armor buff grants +4.3% Crit Rate");
        assert(toCloth.character.offense.magicDefensePenetration === 750, "Legendary Cloth Armor buff grants +250 Magic Def Pen");
        assertApprox(toCloth.character.defense.receivedMeleeDrPct, 10.0, 0.01, "Legendary Plate -3.5% Received DR removed when swapping to Cloth");
        assertApprox(toCloth.character.defense.parryPct, 5.0, 0.01, "Legendary Plate +4.3% Parry removed when swapping to Cloth");

        // 2b. Exact round-trip Cloth -> Plate recovers original stats
        const backToPlate = swapArmorType(toCloth.character, "Plate");
        assertApprox(backToPlate.character.defense.physicalDefense, ayanadWavePlate.defense.physicalDefense, 1, "Round-trip Plate -> Cloth -> Plate recovers PDef");
        assertApprox(backToPlate.character.defense.magicDefense, ayanadWavePlate.defense.magicDefense, 1, "Round-trip Plate -> Cloth -> Plate recovers MDef");
        assertApprox(backToPlate.character.maxHealth, ayanadWavePlate.maxHealth, 2, "Round-trip Plate -> Cloth -> Plate recovers Max HP");
        assertApprox(backToPlate.character.offense.magicCritRatePct, 25.0, 0.01, "Round-trip recovers Magic Crit Rate");
        assertApprox(backToPlate.character.defense.receivedMeleeDrPct, 13.5, 0.01, "Round-trip recovers Received DR%");

        // 3. Reduce all armor by 1 grade (Legendary -> Epic) & round-trip (+1 Grade -> Legendary)
        const down1 = shiftArmorGrades(ayanadWavePlate, { deltaGrades: -1 });
        assert(down1.changedCount === 7, "All 7 armor pieces reduced from Legendary to Epic");
        assert(down1.character.equipment[0].gradeId === 9 && down1.character.equipment[0].gradeName === "Epic", "Equipment grade updated to Epic");
        assertApprox(down1.character.defense.physicalDefense, Math.round(epicPlate.p * 1.03), 1, "Epic Ayanad Wave Plate PDef drops to 7pc Epic Plate * 1.03");
        assertApprox(down1.character.defense.receivedMeleeDrPct, 13.0, 0.01, "Plate Grade Buff DR drops -0.5% (3.5% -> 3.0%)");
        assert(down1.character.attributes.int < ayanadWavePlate.attributes.int, "Armor INT attribute decreases when dropping Legendary -> Epic");
        assert(down1.character.maxHealth < ayanadWavePlate.maxHealth, "Max HP decreases when dropping Legendary -> Epic");

        // 3b. Non-shield Plate user should NOT gain phantom Block % on grade shift
        const noShieldPlate = applyOverrides(ayanadWavePlate, {
            defense: { hasShield: false, shieldPhysicalDefense: 0, blockPct: 0 },
            equipment: ayanadWavePlate.equipment.filter((it) => it.slotId !== 16),
        });
        const noShieldDown = shiftArmorGrades(noShieldPlate, { deltaGrades: -1 });
        assert(noShieldDown.character.defense.blockPct === 0, "Non-shield Plate user keeps 0% Block on grade shift (no phantom Block)");

        const up1 = shiftArmorGrades(down1.character, { deltaGrades: +1 });
        assertApprox(up1.character.defense.physicalDefense, ayanadWavePlate.defense.physicalDefense, 1, "Round-trip -1 Grade -> +1 Grade recovers exact PDef");
        assertApprox(up1.character.attributes.int, ayanadWavePlate.attributes.int, 0.5, "Round-trip -1 Grade -> +1 Grade recovers INT");
        assertApprox(up1.character.maxHealth, ayanadWavePlate.maxHealth, 2, "Round-trip -1 Grade -> +1 Grade recovers Max HP");

        // 4. Tier swap (Ayanad -> Erenor) & Shield +1 Grade swap (Epic 170 -> Legendary 190)
        const toErenor = swapArmorTier(ayanadWavePlate, "erenor");
        assert(toErenor.character.defense.physicalDefense > ayanadWavePlate.defense.physicalDefense, "Upgrading Ayanad -> Erenor increases PDef");
        const shieldUp = shiftWeaponGrades(ayanadWavePlate, { deltaGrades: +1, slotIds: [16] });
        assertApprox(shieldUp.character.defense.shieldPhysicalDefense, Math.round(4000 * (190 / 170)), 1, "Shield +1 Grade scales Shield PDef by 190/170");
    });

    // 25. Target Combo Debuffs in Single-Skill Breakdown & Skill-Specific Lunagems (e.g. 4x Arc Lightning +4%)
    await test("Target Combo Debuffs (Shocked/Impaled -> Arc Lightning, Resurgence -> Mend) & Skill-Specific Lunagems (4x Arc Lightning +4% = +16%)", () => {
        const arc = findSkill(sorcery, "sorcery_arc_lightning");
        const flamebolt = findSkill(sorcery, "sorcery_flamebolt");
        const mend = findSkill(vitalism, "vitalism_mend");
        const precStrike = findSkill(battlerage, "battlerage_precision_strike");

        // 1. Parse skill-specific lunagems cleanly and reject generic non-skill damage stats
        const parsedArc = parseSkillSpecificBonusLine("Increases Arc Lightning damage +4%.");
        assert(parsedArc && parsedArc.skillKey === "arc lightning" && parsedArc.kind === "damagePct" && parsedArc.value === 4, "Parses Lucid Ancient Sorcery Lunagem (Arc Lightning +4%)");
        const parsedAnti = parseSkillSpecificBonusLine("Increases Antithesis healing +4%.");
        assert(parsedAnti && parsedAnti.skillKey === "antithesis" && parsedAnti.kind === "healingPct" && parsedAnti.value === 4, "Parses Antithesis healing lunagem");
        assert(parseSkillSpecificBonusLine("Increase Ranged Skill Damage +3.2%") === null, "Ignores generic Ranged Skill Damage (already in offense stats)");
        assert(parseSkillSpecificBonusLine("Decrease Received Damage -3.2%") === null, "Ignores generic Received Damage");

        // 2. Sample Mage with 4x Arc Lightning +4% Wrists gems
        const mageNoGems = createDefaultCharacter({
            offense: { magicAttack: 1200, magicCritRatePct: 0, meleeAttack: 1200, meleeCritRatePct: 0, healingPower: 1200, healCritRatePct: 0, focus: 0 },
        });
        const mageArcGems = {
            ...mageNoGems,
            equipment: [
                {
                    slotId: 4,
                    slotName: "Wrists",
                    name: "Ayanad Wave Vambraces",
                    lunagems: [
                        { name: "Lucid Ancient Sorcery Lunagem", text: "Increases Arc Lightning damage +4%." },
                        { name: "Lucid Ancient Sorcery Lunagem", text: "Increases Arc Lightning damage +4%." },
                        { name: "Lucid Ancient Sorcery Lunagem", text: "Increases Arc Lightning damage +4%." },
                        { name: "Lucid Ancient Sorcery Lunagem", text: "Increases Arc Lightning damage +4%." },
                    ],
                },
            ],
        };
        const target = createDefaultCharacter({
            maxHealth: 30000,
            defense: { physicalDefense: 0, magicDefense: 0, toughness: 0, resilience: 0, evasionPct: 25, parryPct: 20, blockPct: 0 },
        });

        const gemInfo = getEquipmentSkillBonus(mageArcGems, arc);
        assert(gemInfo.damagePct === 16 && gemInfo.count === 4, "4x Arc Lightning +4% gems sum to +16%");
        assert(getEquipmentSkillBonus(mageArcGems, flamebolt).damagePct === 0, "Arc Lightning gems do not affect Flamebolt");

        const arcBase = simulateSkillDamage(mageNoGems, target, arc);
        const arcGems = simulateSkillDamage(mageArcGems, target, arc);
        assertApprox(arcGems.normal / arcBase.normal, 1.16, 0.001, "4x Arc Lightning Wrists gems boost Arc Lightning damage by exact +16%");
        assert(arcGems.breakdown.skillGemBonusPct === 16, "Breakdown exposes skillGemBonusPct = 16");

        // 3. Target Combo Debuffs in regular single-skill simulation: Shocked (+43%) & Impaled (+45%)
        const arcComboOpts = getSkillComboOptions(arc);
        assert(arcComboOpts.some((c) => c.status === "shocked" && c.comboBonusPct === 43), "Arc Lightning combo options include Shocked +43%");
        assert(arcComboOpts.some((c) => c.status === "impaled" && c.comboBonusPct === 45), "Arc Lightning combo options include Impaled +45%");

        const arcShocked = simulateSkillDamage(mageNoGems, target, arc, { targetStatuses: ["shocked"] });
        const arcImpaled = simulateSkillDamage(mageNoGems, target, arc, { targetStatuses: ["impaled"] });
        const arcBoth = simulateSkillDamage(mageNoGems, target, arc, { targetStatuses: ["shocked", "impaled"] });
        assertApprox(arcShocked.normal / arcBase.normal, 1.43, 0.001, "Shocked combo debuff boosts Arc Lightning by +43%");
        assertApprox(arcImpaled.normal / arcBase.normal, 1.45, 0.001, "Impaled combo debuff boosts Arc Lightning by +45%");
        assertApprox(arcBoth.normal / arcBase.normal, 1.88, 0.001, "Shocked (+43%) + Impaled (+45%) stack together on Arc Lightning (+88%)");
        assert(
            arcBoth.breakdown.comboLabels.includes("Shocked +43%") && arcBoth.breakdown.comboLabels.includes("Impaled +45%"),
            "Breakdown reports both Impaled +45% and Shocked +43% labels"
        );

        // 3b. Both Shocked + Impaled also stack in Rotation mode (Hell Spear -> Chain Lightning -> Arc Lightning)
        const hellSpear = findSkill(occultism, "occultism_hell_spear");
        const chainLightning = findSkill(sorcery, "sorcery_chain_lightning");
        const rotBoth = simulateRotation(mageNoGems, target, [
            { skill: hellSpear },
            { skill: chainLightning },
            { skill: arc },
        ]);
        assertApprox(rotBoth.steps[2].result.normal / arcBase.normal, 1.88, 0.002, "Rotation Hell Spear -> Chain Lightning -> Arc Lightning stacks Impaled +45% and Shocked +43% (+88%)");

        // 4. Combining 4x Arc Lightning gems (+16%) AND Shocked (+43%) stacks cleanly (1.16 * 1.43 = 1.6588x)
        const arcGemsShocked = simulateSkillDamage(mageArcGems, target, arc, { targetStatuses: ["shocked"] });
        assertApprox(arcGemsShocked.normal / arcBase.normal, 1.16 * 1.43, 0.002, "Arc Lightning gems (+16%) + Shocked (+43%) stack cleanly");

        // 5. CC combo debuff (Stunned/Tripped/Impaled) automatically bypasses physical avoidance in single-skill sim
        const psNormal = simulateSkillDamage(mageNoGems, target, precStrike);
        const psImpaled = simulateSkillDamage(mageNoGems, target, precStrike, { targetStatuses: ["impaled"] });
        assert(psNormal.breakdown.avoidance.connectPct < 60, "Un-CC'd Precision Strike loses connect % to evasion/parry");
        assertApprox(psImpaled.breakdown.avoidance.connectPct, 100, 0.01, "Impaled combo debuff auto-bypasses physical avoidance");

        // 6. Healing combo debuff (Resurgence -> Mend +30%)
        const mendBase = simulateSkillHeal(mageNoGems, target, mend);
        const mendResurg = simulateSkillHeal(mageNoGems, target, mend, { targetStatuses: ["resurgence"] });
        assertApprox(mendResurg.normal / mendBase.normal, 1.30, 0.001, "Resurgence combo status boosts Mend healing by +30%");

        // 7. Swapping Wrists lunagems via Quick Swap preset (gem_arc_lightning) enables +16% immediately
        const swapped = swapSlotLunagems(mageNoGems, 4, "gem_arc_lightning", { count: 4, perGemValue: 4 });
        const arcAfterSwap = simulateSkillDamage(swapped.character, target, arc);
        assertApprox(arcAfterSwap.normal / arcBase.normal, 1.16, 0.001, "Swapping 4x Arc Lightning gems into Wrists boosts Arc Lightning by +16%");
    });

    // 26. Exact EHP vs simulateSkillDamage Algebraic Identity (Shield Block = 0% dmg, Backstab ignores avoidance, Neutral Healing Eff & Disable Avoidance)
    await test("Defender EHP matches simulateSkillDamage identically (Shield Block = 0% dmg, Backstab ignores avoidance, Neutral Healing Eff & Disable Avoidance)", () => {
        const attacker = createDefaultCharacter({
            offense: {
                meleeAttack: 1300,
                rangedAttack: 1300,
                magicAttack: 1300,
                meleeCritRatePct: 48,
                meleeCritBonusPct: 210,
                rangedCritRatePct: 45,
                rangedCritBonusPct: 215,
                magicCritRatePct: 42,
                magicCritBonusPct: 195,
                defensePenetration: 2400,
                magicDefensePenetration: 1800,
                shieldDefPenRatePct: 25,
                shieldDefPenPct: 50,
                focus: 2000,
            },
        });
        const shieldDef = createDefaultCharacter({
            maxHealth: 28000,
            defense: {
                physicalDefense: 11500,
                magicDefense: 13500,
                shieldPhysicalDefense: 4000,
                hasShield: true,
                toughness: 3500,
                resilience: 4800,
                evasionPct: 15,
                parryPct: 12,
                blockPct: 18,
                receivedMeleeDrPct: 18,
                receivedRangedDrPct: 12,
                receivedMagicDrPct: 16,
                fixedMeleeDr: 0,
                fixedRangedDr: 0,
                fixedMagicDr: 0,
                receivedHealingPct: 8,
            },
        });

        const meleeSkill = {
            id: "test_melee",
            skillset: "battlerage",
            name: "Test Melee",
            kind: "damage",
            damageType: "physical",
            scalingStat: "meleeAttack",
            base: 0,
            scalingPct: 1000,
        };
        const rangedSkill = {
            id: "test_ranged",
            skillset: "archery",
            name: "Test Ranged",
            kind: "damage",
            damageType: "physical",
            scalingStat: "rangedAttack",
            base: 0,
            scalingPct: 1000,
        };
        const magicSkill = {
            id: "test_magic",
            skillset: "sorcery",
            name: "Test Magic",
            kind: "damage",
            damageType: "magic",
            scalingStat: "magicAttack",
            base: 0,
            scalingPct: 1000,
        };

        // 1. With Avoidance ON: EHP must match maxHealth / (expected / preMitigation) to < 0.01% across Melee, Ranged, Magic
        const effOn = computeEffectiveStats(shieldDef, attacker, {}, { disableAvoidance: false }).defense;
        const simM = simulateSkillDamage(attacker, shieldDef, meleeSkill);
        const simR = simulateSkillDamage(attacker, shieldDef, rangedSkill);
        const simMg = simulateSkillDamage(attacker, shieldDef, magicSkill);
        const exactMeleeEhp = shieldDef.maxHealth / (simM.expected / simM.breakdown.preMitigation);
        const exactRangedEhp = shieldDef.maxHealth / (simR.expected / simR.breakdown.preMitigation);
        const exactMagicEhp = shieldDef.maxHealth / (simMg.expected / simMg.breakdown.preMitigation);
        assert(simM.blocked === 0 && simR.blocked === 0, "AA Classic 3.5 Shield Block totally negates hit (0% damage)");
        assertApprox(effOn.ehp.melee.vsAttackerEhp, exactMeleeEhp, 1.0, "Melee EHP matches simulateSkillDamage exact identity (Shield Block = 0% dmg & Shield Pen)");
        assertApprox(effOn.ehp.ranged.vsAttackerEhp, exactRangedEhp, 1.0, "Ranged EHP matches simulateSkillDamage exact identity");
        assertApprox(effOn.ehp.magic.vsAttackerEhp, exactMagicEhp, 1.0, "Magic EHP matches simulateSkillDamage exact identity");

        // 1b. Backstab ignores Evasion, Parry, and Shield Block (100% connect rate)
        const simBackstab = simulateSkillDamage(attacker, shieldDef, meleeSkill, { isBackstab: true });
        assertApprox(simBackstab.breakdown.avoidance.connectPct, 100, 0.01, "Backstab ignores Evasion, Parry, and Shield Block");

        // 2. With Disable Avoidance ON: avoidance drops to 0% in BOTH EHP and simulateSkillDamage, and identity still holds
        const effOff = computeEffectiveStats(shieldDef, attacker, {}, { disableAvoidance: true }).defense;
        const simMOff = simulateSkillDamage(attacker, shieldDef, meleeSkill, { disableAvoidance: true });
        const simROff = simulateSkillDamage(attacker, shieldDef, rangedSkill, { disableAvoidance: true });
        assert(effOff.ehp.melee.vsAttackerAvoidancePct === 0 && effOff.ehp.ranged.vsAttackerAvoidancePct === 0, "Disable Avoidance zeroes EHP avoidance");
        assertApprox(simMOff.breakdown.avoidance.connectPct, 100, 0.01, "Disable Avoidance gives 100% connect rate on melee skill");
        assert(effOff.ehp.melee.vsAttackerEhp < effOn.ehp.melee.vsAttackerEhp, "Disabling avoidance lowers Melee EHP for shield/evasion build");
        const exactMeleeOffEhp = shieldDef.maxHealth / (simMOff.expected / simMOff.breakdown.preMitigation);
        const exactRangedOffEhp = shieldDef.maxHealth / (simROff.expected / simROff.breakdown.preMitigation);
        assertApprox(effOff.ehp.melee.vsAttackerEhp, exactMeleeOffEhp, 1.0, "Melee EHP (avoidance disabled) matches simulateSkillDamage exact identity");
        assertApprox(effOff.ehp.ranged.vsAttackerEhp, exactRangedOffEhp, 1.0, "Ranged EHP (avoidance disabled) matches simulateSkillDamage exact identity");

        // 2b. Non-Crit EHP and Crit EHP exact identities vs simulateSkillDamage normal & crit hits (Magic has 0 avoidance & 0 Shield Pen)
        const exactMagicNonCritEhp = shieldDef.maxHealth / (simMg.normal / simMg.breakdown.preMitigation);
        const exactMagicCritEhp = shieldDef.maxHealth / (simMg.crit / simMg.breakdown.preMitigation);
        assertApprox(effOn.ehp.magic.vsAttackerNonCritEhp, exactMagicNonCritEhp, 1.0, "Magic Non-Crit EHP matches simulateSkillDamage.normal exact identity");
        assertApprox(effOn.ehp.magic.vsAttackerCritEhp, exactMagicCritEhp, 1.0, "Magic Crit EHP matches simulateSkillDamage.crit exact identity");
        assert(
            effOn.ehp.melee.vsAttackerCritEhp < effOn.ehp.melee.vsAttackerEhp &&
                effOn.ehp.melee.vsAttackerEhp < effOn.ehp.melee.vsAttackerNonCritEhp,
            "Ordering holds: Crit EHP < Expected EHP < Non-Crit EHP"
        );

        // 3. Healing Efficiency ignores the attacker (uses neutral rawDmgMult regardless of attacker Def Pen / Crit)
        const effNoAttacker = computeEffectiveStats(shieldDef, null, {}, { disableAvoidance: false }).defense;
        assertApprox(
            effOn.healingReceived.effectiveHpPer1kHealMelee,
            effNoAttacker.healingReceived.effectiveHpPer1kHealMelee,
            0.5,
            "Healing Efficiency (Melee) ignores attacker Def Pen / Crit"
        );
        assertApprox(
            effOn.healingReceived.effectiveHpPer1kHealMagic,
            effNoAttacker.healingReceived.effectiveHpPer1kHealMagic,
            0.5,
            "Healing Efficiency (Magic) ignores attacker Def Pen / Crit"
        );
    });

    // 27. AA Classic 1.3.6 Weapon Hidden Passive Procs (Staff, Longspear/Shortspear, Katana, Dagger, Scepter, Sword, Shield)
    await test("AA Classic 1.3.6 weapon hidden passive procs apply exact stats & combat math", () => {
        const attacker = createDefaultCharacter({
            offense: {
                meleeAttack: 1200,
                magicAttack: 1200,
                meleeCritRatePct: 35,
                meleeCritBonusPct: 180,
                magicCritRatePct: 35,
                magicCritBonusPct: 180,
                defensePenetration: 1500,
                magicDefensePenetration: 1500,
                attackSpeed: 0,
                castTimePct: 100,
                focus: 3000,
            },
        });
        const defender = createDefaultCharacter({
            maxHealth: 30000,
            defense: {
                physicalDefense: 11000,
                magicDefense: 11000,
                toughness: 3000,
                resilience: 5000,
                evasionPct: 10,
                parryPct: 15,
                blockPct: 20,
                hasShield: true,
            },
        });

        const magicSkill = {
            id: "test_wp_magic",
            name: "Test Magic",
            skillset: "sorcery",
            kind: "damage",
            damageType: "magic",
            scalingStat: "magicAttack",
            base: 500,
            scalingPct: 500,
            castTimeSec: 2.0,
            gcdSec: 1.0,
        };
        const meleeSkill = {
            id: "test_wp_melee",
            name: "Test Melee",
            skillset: "battlerage",
            kind: "damage",
            damageType: "physical",
            scalingStat: "meleeAttack",
            base: 500,
            scalingPct: 500,
            castTimeSec: 0,
            gcdSec: 1.0,
        };

        // 1. Staff proc: +10,000 Magic Defense Penetration (1500 + 10000 = 11500 > 11000 MDef -> 0 eff MDef)
        const staffAtk = applyModifiers(attacker, ["weapon_proc_staff"]);
        assert(staffAtk.offense.magicDefensePenetration === 11500, "Staff proc adds +10,000 Magic Defense Penetration");
        const simMagicBase = simulateSkillDamage(attacker, defender, magicSkill);
        const simMagicStaff = simulateSkillDamage(staffAtk, defender, magicSkill);
        assert(simMagicStaff.breakdown.effectiveDefense === 0, "Staff proc completely penetrates 11,000 Magic Defense when total pen >= 11,000");
        assert(simMagicStaff.expected > simMagicBase.expected * 1.9, "Staff proc dramatically increases expected magic damage against high MDef");

        // 2. Longspear / Shortspear proc: +10,000 Physical Defense Penetration
        const spearAtk = applyModifiers(attacker, ["weapon_proc_spear"]);
        assert(spearAtk.offense.defensePenetration === 11500, "Spear proc adds +10,000 Physical Defense Penetration");
        const simMeleeBase = simulateSkillDamage(attacker, defender, meleeSkill);
        const simMeleeSpear = simulateSkillDamage(spearAtk, defender, meleeSkill);
        assert(simMeleeSpear.breakdown.effectiveDefense === 0, "Spear proc completely penetrates 11,000 Physical Defense when total pen >= 11,000");
        assert(simMeleeSpear.expected > simMeleeBase.expected * 1.9, "Spear proc dramatically increases expected melee damage against high PDef");

        // 3. Katana / Nodachi proc: +100% Melee Crit Rate (35 + 100 - ~13.5% Resil = 100% effective crit in BOTH damage.js and effective.js)
        const katanaAtk = applyModifiers(attacker, ["weapon_proc_katana"]);
        assert(katanaAtk.offense.meleeCritRatePct === 135, "Katana proc adds +100% Melee Critical Rate");
        const simMeleeKatana = simulateSkillDamage(katanaAtk, defender, meleeSkill);
        const effMeleeKatana = computeEffectiveStats(katanaAtk, defender).offense.melee;
        assertApprox(simMeleeKatana.breakdown.effectiveCritRatePct, 100, 0.01, "Katana proc guarantees 100% melee crit rate even vs Resilience");
        assertApprox(effMeleeKatana.vsTargetEffCritRatePct, 100, 0.01, "Effective offense matches 100% melee crit rate vs Resilience");

        // 4. Dagger proc: +176 Attack Speed (+17.6% GCD speedup)
        const daggerAtk = applyModifiers(attacker, ["weapon_proc_dagger"]);
        assert(daggerAtk.offense.attackSpeed === 176, "Dagger proc adds +176 Attack Speed");
        const simMeleeDagger = simulateSkillDamage(daggerAtk, defender, meleeSkill);
        assertApprox(simMeleeDagger.dps.gcdSec, 1 / 1.176, 0.002, "Dagger proc reduces 1.0s GCD to ~0.850s");

        // 5. Scepter proc: -8% Cast Time
        const scepterAtk = applyModifiers(attacker, ["weapon_proc_scepter"]);
        assert(scepterAtk.offense.castTimePct === 92, "Scepter proc reduces Cast Time by -8% (100% -> 92%)");
        const simMagicScepter = simulateSkillDamage(scepterAtk, defender, magicSkill);
        assertApprox(simMagicScepter.dps.effectiveCastTimeSec, 1.84, 0.002, "Scepter proc reduces 2.0s cast time to 1.84s");

        // 6. Sword / Greatsword proc (+100% Parry) & Shield proc (+100% Block)
        const swordDef = applyModifiers(defender, ["weapon_proc_sword"]);
        assert(swordDef.defense.parryPct === 115, "Sword/Greatsword proc adds +100% Melee Parry Rate");
        const simVsSword = simulateSkillDamage(attacker, swordDef, meleeSkill);
        assertApprox(simVsSword.breakdown.avoidance.connectPct, 0, 0.01, "Sword/Greatsword proc yields 0% melee connect rate");

        const shieldDef = applyModifiers(defender, ["weapon_proc_shield"]);
        assert(shieldDef.defense.blockPct === 120, "Shield proc adds +100% Shield Block Rate");
        const simVsShield = simulateSkillDamage(attacker, shieldDef, meleeSkill);
        assertApprox(simVsShield.breakdown.avoidance.connectPct, 0, 0.01, "Shield proc yields 0% melee connect rate");
    });

    // 28. Per-Step Rotation Weapon Procs, Target Absorb Shield, Weapon Archetype Swaps, EHP Sweep & Matchup Matrix
    await test("Per-step rotation procs, absorb shield, weapon archetype swaps, defender EHP sweep & matchup matrix", () => {
        const mageA = createDefaultCharacter({
            name: "Mage A (Staff)",
            maxHealth: 28000,
            metadata: { equipmentType: "dual_wield" },
            offense: {
                magicAttack: 1300,
                magicCritRatePct: 45,
                magicCritBonusPct: 190,
                magicDefensePenetration: 2000,
                magicSkillDamagePct: 15,
                attackSpeed: 177,
                castTimePct: 75,
            },
            defense: {
                physicalDefense: 14000,
                magicDefense: 4000,
                toughness: 3000,
                resilience: 6000,
            },
        });
        const mageB = createDefaultCharacter({
            name: "Mage B (High Tough Cloth)",
            maxHealth: 28000,
            metadata: { equipmentType: "two_hand" },
            offense: {
                magicAttack: 1200,
                magicCritRatePct: 35,
                magicCritBonusPct: 160,
                magicDefensePenetration: 5000,
                magicSkillDamagePct: 20,
                castTimePct: 68,
            },
            defense: {
                physicalDefense: 6000,
                magicDefense: 12000,
                toughness: 5000,
                resilience: 4500,
            },
        });
        const nuke = {
            id: "test_nuke",
            name: "Arc Lightning",
            skillset: "sorcery",
            kind: "damage",
            damageType: "magic",
            scalingStat: "magicAttack",
            base: 1000,
            scalingPct: 600,
            castTimeSec: 2.0,
            gcdSec: 1.0,
        };

        // 1. Per-step weapon proc applies ONLY to step 2 (not step 1)
        const rotNoProc = simulateRotation(mageA, mageB, [{ skill: nuke }, { skill: nuke }]);
        const rotStep2Proc = simulateRotation(mageA, mageB, [
            { skill: nuke },
            { skill: nuke, weaponProc: "weapon_proc_staff" },
        ]);
        assertApprox(rotStep2Proc.steps[0].result.expected, rotNoProc.steps[0].result.expected, 0.01, "Step 1 unaffected by Step 2 weaponProc");
        assert(rotStep2Proc.steps[1].result.expected > rotNoProc.steps[1].result.expected * 1.5, "Step 2 gets +10,000 MDef Pen from per-step Staff Proc");
        assert(rotStep2Proc.steps[1].weaponProcId === "weapon_proc_staff", "Step 2 reports weaponProcId");

        // 2. Target Absorb Shield increases effectiveKillHp, raises TTK, and lowers Kill Probability
        const rotWithShield = simulateRotation(mageA, mageB, [{ skill: nuke }, { skill: nuke, weaponProc: "weapon_proc_staff" }], {
            targetAbsorbShield: 8000,
        });
        assert(rotWithShield.targetAbsorbShield === 8000 && rotWithShield.effectiveKillHp === 36000, "Absorb shield adds to effectiveKillHp");
        assert(rotWithShield.estimatedTtkSec > rotStep2Proc.estimatedTtkSec, "Absorb shield increases estimated TTK");
        assert(rotWithShield.killProbPct <= rotStep2Proc.killProbPct, "Absorb shield reduces or caps kill probability");

        // 3. Reversible Weapon Archetype 1-to-1 Swaps (DW -> 2H -> Phys Shield -> DW)
        const info0 = inspectWeaponArchetype(mageA);
        assert(info0.archetype === "dual_wield", "Detects dual_wield archetype");
        const to2H = swapWeaponArchetype(mageA, "two_hand", { twoHandAtkRatio: 1.15 });
        assert(to2H.changed && to2H.character.offense.attackSpeed === 0, "DW -> 2H removes +177 Attack Speed");
        assert(to2H.character.offense.magicSkillDamagePct === 20, "DW -> 2H adds +5% Magic Skill Damage");
        assert(to2H.character.offense.castTimePct === 68, "DW -> 2H reduces Cast Time by -7%");
        assert(to2H.character.offense.shieldDefPenRatePct === 50 && to2H.character.offense.shieldDefPenPct === 50, "DW -> 2H adds +50% Shield Def Pen");
        const intAttrAtk = (mageA.attributes.int || 0) * 0.2;
        assertApprox(to2H.character.offense.magicAttack, intAttrAtk + (1300 - intAttrAtk) * 1.15, 0.1, "DW -> 2H scales weapon-only Magic Attack by 1.15x (excluding INT*0.2)");

        const toShield = swapWeaponArchetype(to2H.character, "shield_phys", { twoHandAtkRatio: 1.15 });
        assert(toShield.character.defense.hasShield === true && toShield.character.defense.shieldPhysicalDefense > 2000, "2H -> Phys Shield enables shield & Shield PDef");
        assert(toShield.character.maxHealth === 28350, "Equip Shield #8226 adds +350 Max HP");

        const backToDw = swapWeaponArchetype(toShield.character, "dual_wield", { twoHandAtkRatio: 1.15 });
        assertApprox(backToDw.character.offense.magicAttack, 1300, 0.2, "Reversible swap returns Magic Attack to 1300");
        assertApprox(backToDw.character.offense.attackSpeed, 177, 0.1, "Reversible swap restores +177 Attack Speed");
        assertApprox(backToDw.character.defense.physicalDefense, 14000, 1, "Reversible swap restores Physical Defense");
        assert(backToDw.character.maxHealth === 28000 && !backToDw.character.defense.hasShield, "Reversible swap restores HP & clears shield");

        // 4. Aggressor Def Pen EHP Sweep (Plate High-Def A vs Toughness Cloth B crosses over as Phys Def Pen climbs)
        const meleeAgg = createDefaultCharacter({
            name: "Melee Aggressor",
            offense: { meleeAttack: 1400, meleeCritRatePct: 50, meleeCritBonusPct: 180, focus: 3000 },
        });
        const ehpSweep = sweepDefenderEhp(mageA, mageB, meleeAgg, {
            stat: "aggressorDefPen",
            ehpKind: "melee",
            start: 0,
            end: 15000,
            step: 1000,
        });
        assert(ehpSweep.points.length === 16, "EHP sweep produces 16 points from 0..15,000");
        assert(ehpSweep.points[0].expectedA > ehpSweep.points[0].expectedB, "High-Def Plate wins Melee EHP at 0 Def Pen");
        assert(ehpSweep.points[15].expectedB > ehpSweep.points[15].expectedA, "High-Toughness wins Melee EHP at 15,000 Def Pen");
        assert(ehpSweep.breakEvens.length === 1, "EHP sweep detects exact Def Pen break-even crossover");

        // 5. Multi-Opponent Matchup Matrix across Offense Skill, Offense Rotation & Defense EHP
        const matrixOff = computeMatchupMatrix(mageA, mageB, [mageA, mageB, meleeAgg], {
            matrixMode: "offense_skill",
            skill: nuke,
        });
        assert(matrixOff.rows.length === 3 && matrixOff.summary.count === 3, "Offense Skill Matrix evaluates all 3 opponents");
        const matrixDef = computeMatchupMatrix(mageA, mageB, [mageA, mageB, meleeAgg], {
            matrixMode: "defense_ehp",
            ehpKind: "melee",
        });
        assert(matrixDef.rows.length === 3 && matrixDef.summary.winsA === 3, "Defense Melee EHP Matrix reports high-PDef A winning all 3");
    });

    // 29. All-vs-All N×N Matchup Matrix (Rock-Paper-Scissors antisymmetry, Non-Crit/Crit, Defender EHP, Signature Skill)
    await test("All-vs-All N×N matrix computes exact antisymmetric 1v1 trade ratios, signature skills & EHP", () => {
        const plateMage = createDefaultCharacter({
            name: "Plate Mage",
            maxHealth: 35000,
            offense: { magicAttack: 1400, magicCritRatePct: 45, magicCritBonusPct: 180, magicDefensePenetration: 2000 },
            defense: { physicalDefense: 17000, magicDefense: 2000, toughness: 3500, resilience: 5000 },
        });
        const clothMage = createDefaultCharacter({
            name: "Cloth Mage",
            maxHealth: 26000,
            offense: { magicAttack: 1400, magicCritRatePct: 45, magicCritBonusPct: 180, magicDefensePenetration: 2000 },
            defense: { physicalDefense: 4000, magicDefense: 15000, toughness: 3500, resilience: 5000 },
        });
        const leatherArcher = createDefaultCharacter({
            name: "Leather Archer",
            maxHealth: 28000,
            offense: { rangedAttack: 1300, rangedCritRatePct: 50, rangedCritBonusPct: 190, defensePenetration: 3000, focus: 3000 },
            defense: { physicalDefense: 10000, magicDefense: 10000, toughness: 3500, resilience: 5000, evasionPct: 20 },
        });

        const entries = [
            { id: "pm", name: "Plate Mage", character: plateMage },
            { id: "cm", name: "Cloth Mage", character: clothMage },
            { id: "la", name: "Leather Archer", character: leatherArcher },
        ];

        // 1. Trade ratio is strictly antisymmetric: ratio(i, j) * ratio(j, i) === 1
        const mTrade = computeAllVsAllMatrix(entries, { metric: "trade_ratio", hitMode: "expected" });
        assert(mTrade.rows.length === 3 && mTrade.rows[0].cells.length === 3, "3x3 matrix dimensions");
        for (let i = 0; i < 3; i++) {
            assert(mTrade.rows[i].cells[i].isMirror === true, "Diagonal is mirror");
            for (let j = i + 1; j < 3; j++) {
                const rIJ = mTrade.rows[i].cells[j].ratio;
                const rJI = mTrade.rows[j].cells[i].ratio;
                assertApprox(rIJ * rJI, 1.0, 1e-6, `Antisymmetry (${i},${j}) * (${j},${i}) === 1`);
            }
        }
        // Rock-Paper-Scissors: Cloth Mage beats Plate Mage; Plate Mage beats Leather Archer; Leather Archer beats Cloth Mage
        assert(mTrade.rows[1].cells[0].ratio > 1.5, "Cloth Mage beats Plate Mage in 1v1 trade ratio");
        assert(mTrade.rows[0].cells[2].ratio > 1.1, "Plate Mage beats Leather Archer in 1v1 trade ratio");
        assert(mTrade.rows[2].cells[1].ratio > 1.1, "Leather Archer beats Cloth Mage in 1v1 trade ratio");

        // 2. Non-Crit vs Crit Defender EHP matrix (Rows = Defenders, Cols = Attackers)
        const mEhpNorm = computeAllVsAllMatrix(entries, { metric: "defender_ehp", hitMode: "normal" });
        const mEhpCrit = computeAllVsAllMatrix(entries, { metric: "defender_ehp", hitMode: "crit" });
        assert(
            mEhpCrit.rows[1].cells[0].primaryVal < mEhpNorm.rows[1].cells[0].primaryVal,
            "Crit EHP < Non-Crit EHP in Defender EHP matrix"
        );
        // Cloth Mage (Row 1) has much higher Magic EHP vs Plate Mage (Col 0) than Plate Mage (Row 0) has vs Cloth Mage (Col 1)
        assert(
            mEhpNorm.rows[1].cells[0].primaryVal > mEhpNorm.rows[0].cells[1].primaryVal,
            "Cloth Mage (Row) Magic EHP vs Plate Mage (Col) exceeds Plate Mage (Row) Magic EHP vs Cloth Mage (Col)"
        );
        // Shield defender row avgScore strictly exceeds Dual-Wield defender row avgScore (even when both have identical magic offense!)
        const shieldHealer = createDefaultCharacter({
            maxHealth: 28000,
            offense: { healingPower: 1200, magicDefPen: 200, magicCritRatePct: 7, magicCritBonusPct: 50 },
            defense: { physicalDefense: 11300, magicDefense: 14500, shieldPhysicalDefense: 4000, blockPct: 10, hasShield: true, toughness: 3550, resilience: 5000, receivedMeleeDrPct: 22, receivedRangedDrPct: 14, receivedMagicDrPct: 20 },
        });
        const dwHealer = createDefaultCharacter({
            maxHealth: 26500,
            offense: { healingPower: 1270, magicDefPen: 200, magicCritRatePct: 7, magicCritBonusPct: 50 },
            defense: { physicalDefense: 5950, magicDefense: 14400, shieldPhysicalDefense: 0, blockPct: 0, hasShield: false, toughness: 3550, resilience: 5000, receivedMeleeDrPct: 19, receivedRangedDrPct: 11, receivedMagicDrPct: 17 },
        });
        const tankyHealer = createDefaultCharacter({
            maxHealth: 28000,
            offense: { healingPower: 1270, magicDefPen: 200, magicCritRatePct: 12.6, magicCritBonusPct: 50 },
            defense: { physicalDefense: 11300, magicDefense: 15000, shieldPhysicalDefense: 4000, blockPct: 11.5, hasShield: true, toughness: 4580, resilience: 5000, receivedMeleeDrPct: 23, receivedRangedDrPct: 20, receivedMagicDrPct: 18 },
        });
        const meleeBrawler = createDefaultCharacter({
            maxHealth: 28000,
            offense: { meleeAttack: 1300, defensePenetration: 2500, meleeCritRatePct: 45, meleeCritBonusPct: 150, focus: 3500 },
            defense: { physicalDefense: 7000, magicDefense: 6000, toughness: 3200, resilience: 4000 },
        });
        const ehpCmp = computeAllVsAllMatrix(
            [
                { id: "sh", name: "Shield Healer", character: shieldHealer },
                { id: "dw", name: "DW Healer", character: dwHealer },
                { id: "tk", name: "Tanky Healer", character: tankyHealer },
                { id: "la", name: "Leather Archer", character: leatherArcher },
                { id: "mb", name: "Melee Brawler", character: meleeBrawler },
            ],
            { metric: "defender_ehp", hitMode: "expected" }
        );
        assert(
            ehpCmp.rows[2].avgScore > ehpCmp.rows[0].avgScore && ehpCmp.rows[0].avgScore > ehpCmp.rows[1].avgScore,
            `Defender EHP row avg ranks Tanky Healer (${Math.round(ehpCmp.rows[2].avgScore)}) > Shield Healer (${Math.round(ehpCmp.rows[0].avgScore)}) > DW Healer (${Math.round(ehpCmp.rows[1].avgScore)})`
        );
    });

    // 30. DaruGear 1.3.6 Cross-Check Fixes (Attributes, 40% Cast Floor, In-Game Import, Exact Swaps, Multiplicative Passives, Additive % Attack Buffs)
    await test("DaruGear 1.3.6 formula parity: attributes, 40% cast floor, signed DR/atkSpd import, exact swaps, multiplicative passives & additive % buffs", () => {
        // 1. Exact DaruGear primary attribute conversions + symmetric apply/unapply round-trip
        const base = createDefaultCharacter({
            maxHealth: 20000,
            maxMana: 10000,
            attributes: { str: 200, agi: 200, sta: 200, int: 200, spi: 200 },
            offense: {
                meleeAttack: 1000,
                rangedAttack: 1000,
                magicAttack: 1000,
                healingPower: 1000,
                meleeAccuracyPct: 96,
                rangedAccuracyPct: 96,
                magicAccuracyPct: 96,
                meleeCritRatePct: 20,
                rangedCritRatePct: 20,
                magicCritRatePct: 20,
                healCritRatePct: 20,
            },
            defense: {
                magicDefense: 4000,
                evasionPct: 5,
                parryPct: 5,
                blockPct: 10,
                hasShield: true,
            },
        });
        const awakened = applyModifiers(base, ["combat_manual_awaken"]); // +50 all attributes
        assertApprox(awakened.maxHealth, 20600, 0.01, "STA +50 adds +600 Max HP");
        assertApprox(awakened.maxMana, 10600, 0.01, "INT +50 adds +600 Max Mana");
        assertApprox(awakened.offense.meleeCritRatePct, 20 + 50 * 0.0275, 0.001, "AGI +50 adds +1.375% Melee Crit");
        assertApprox(awakened.offense.rangedCritRatePct, 20 + 100 * 0.01375, 0.001, "AGI+INT (+100) adds +1.375% Ranged Crit");
        assertApprox(awakened.offense.magicCritRatePct, 20 + 50 * 0.0275, 0.001, "INT +50 adds +1.375% Magic Crit");
        assertApprox(awakened.offense.healCritRatePct, 20 + 50 * 0.0275, 0.001, "SPI +50 adds +1.375% Heal Crit");
        assertApprox(awakened.defense.evasionPct, 5 + 100 * 0.0109, 0.001, "AGI+INT (+100) adds +1.09% Evasion");
        assertApprox(awakened.defense.parryPct, 5 + 50 * (0.00625 + 0.006), 0.001, "STR+STA (+50 each) adds +0.6125% Parry");
        assertApprox(awakened.defense.blockPct, 10 + 50 * 0.0165, 0.001, "STR +50 adds +0.825% Shield Block");
        assertApprox(awakened.offense.meleeAccuracyPct, 96 + 100 * 0.01225, 0.001, "STR+SPI (+100) adds +1.225% Melee Accuracy");
        const roundTrip = unapplyModifiers(awakened, ["combat_manual_awaken"]);
        assertApprox(roundTrip.defense.parryPct, 5, 0.001, "unapplyModifiers restores exact Parry %");
        assertApprox(roundTrip.defense.evasionPct, 5, 0.001, "unapplyModifiers restores exact Evasion %");
        assertApprox(roundTrip.defense.blockPct, 10, 0.001, "unapplyModifiers restores exact Block %");
        assertApprox(roundTrip.offense.rangedCritRatePct, 20, 0.001, "unapplyModifiers restores exact Ranged Crit %");
        assertApprox(roundTrip.offense.meleeAccuracyPct, 96, 0.001, "unapplyModifiers restores exact Melee Accuracy %");

        // 2. Cast Time 40% hard floor (matching DaruGear & AA Classic 3.5)
        const fastCaster = createDefaultCharacter({ offense: { castTimePct: 25, magicAttack: 1000 } });
        const arc = findSkill(sorcery, "sorcery_arc_lightning");
        const fastRes = simulateSkillDamage(fastCaster, base, arc);
        assertApprox(fastRes.dps.castTimePct, 40, 0.001, "Cast Time clamps at 40% minimum floor");
        assertApprox(fastRes.dps.effectiveCastTimeSec, arc.castTimeSec * 0.4, 0.001, "Effective cast time respects 40% floor");
        assertApprox(computeEffectiveStats(fastCaster).offense.speed.castTimePct, 40, 0.001, "Effective stats Cast Time clamps at 40%");

        // 3. In-game unitInfo attackSpeed & signed incoming DR + DaruGear negative DR preservation
        const nakedInGame = fromInGameUnitInfo({
            player: {
                maxHealth: 10246,
                maxMana: 7000,
                unitInfo: {
                    attack_anim_speed: 0,
                    attack_anim_speed_mul: 100,
                    incoming_melee_damage_mul: -15,
                    incoming_ranged_damage_mul: 12,
                    incoming_spell_damage_mul: -6,
                    incoming_melee_damage_val: -29,
                },
            },
        });
        assert(nakedInGame.offense.attackSpeed === 0, "Naked attack_anim_speed=0 (mul=100) imports as 0 attackSpeed");
        assert(nakedInGame.defense.receivedMeleeDrPct === 15, "incoming_melee_damage_mul=-15 imports as +15% DR");
        assert(nakedInGame.defense.receivedRangedDrPct === -12, "incoming_ranged_damage_mul=+12 imports as -12% DR (vulnerability)");
        assert(nakedInGame.defense.fixedMeleeDr === 29, "incoming_melee_damage_val=-29 imports as +29 Fixed DR");
        const dgNeg = parseImportPayload({ offense: { meleeAttack: 1000 }, defense: { receivedMeleeDrPct: -15 } });
        assert(dgNeg.ok && dgNeg.character.defense.receivedMeleeDrPct === -15, "DaruGear import preserves negative DR without Math.abs");

        // 4. Exact DaruGear Armor Grade Buff quadratic HP/Mana & Shield Defense & 2H/1H ratios
        const mk7 = (type) => ARMOR_SLOTS.map((s) => ({ slotId: s.slotId, type, gradeId: 9, tierLevel: 62 }));
        assert(computeArmorSetAndGradeBuff(mk7("Cloth"), 62).gradeBuffHp === 7582, "7pc Epic Ayanad Cloth Grade Buff HP === 7582");
        assert(computeArmorSetAndGradeBuff(mk7("Leather"), 62).gradeBuffHp === 8425, "7pc Epic Ayanad Leather Grade Buff HP === 8425");
        assert(computeArmorSetAndGradeBuff(mk7("Plate"), 62).gradeBuffHp === 9267, "7pc Epic Ayanad Plate Grade Buff HP === 9267");

        const meleeDw = createDefaultCharacter({
            attributes: { str: 1000 },
            offense: { meleeAttack: 1200, attackSpeed: 177 },
            metadata: { equipmentType: "dual_wield" },
        });
        assertApprox(inspectWeaponArchetype(meleeDw).exactTwoHandRatio, 1.2, 0.001, "Melee 2H/1H exact ratio is 1.20x");
        const melee2H = swapWeaponArchetype(meleeDw, "two_hand");
        // Weapon-only = 1200 - 200 (STR*0.2) = 1000 -> 1000 * 1.20 = 1200 -> total 1400
        assertApprox(melee2H.character.offense.meleeAttack, 1400, 0.1, "Melee DW -> 2H scales weapon-only attack by 1.20x");
        const meleeShield = swapWeaponArchetype(melee2H.character, "shield_phys");
        // Exact DaruGear Ayanad Lv62 Epic (170%) 100% temper shield PDef: floor((62^1.1*85+100)*1.7*0.25) = 3426
        assert(meleeShield.character.defense.shieldPhysicalDefense === 3426, "Default Ayanad Epic Shield PDef === 3426");

        // 5. Multiplicative skillset passive (Weapon Mastery +15% * Melee Skill Dmg +20% = 1.38x)
        const wmAtt = createDefaultCharacter({
            offense: { meleeAttack: 1000, meleeSkillDamagePct: 20, meleeCritRatePct: 0 },
        });
        const zeroDef = createDefaultCharacter({
            defense: { physicalDefense: 0, toughness: 0, resilience: 0, evasionPct: 0, parryPct: 0, blockPct: 0 },
        });
        const psSkill = findSkill(battlerage, "battlerage_precision_strike");
        const psNoWm = simulateSkillDamage(wmAtt, zeroDef, psSkill);
        const psWithWm = simulateSkillDamage(wmAtt, zeroDef, psSkill, { attackerModifiers: ["weapon_mastery"] });
        assertApprox(psWithWm.normal / psNoWm.normal, 1.15, 0.001, "Weapon Mastery +15% multiplies Skill Damage % (1.20 * 1.15 = 1.38x)");

        // 6. Additive stacking of multiple % attack buffs (Bulwark of Power +15% + Doomshadow +10% = 1.25x, matching DaruGear)
        const stackedPct = applyModifiers(base, ["bulwark_power", "doomshadow_nodachi"]);
        assertApprox(stackedPct.offense.meleeAttack, 1000 * 1.25, 0.01, "Bulwark Power (+15%) + Doomshadow (+10%) stack additively to 1.25x");
        const unstackedPct = unapplyModifiers(stackedPct, ["bulwark_power", "doomshadow_nodachi"]);
        assertApprox(unstackedPct.offense.meleeAttack, 1000, 0.01, "unapplyModifiers cleanly inverts additive % attack buffs");

        // 7. Zero crit bonus preserved in effective.js (?? 50 instead of || 50) & 300% Crit Bonus cap BEFORE Resilience
        const zeroCbAtt = createDefaultCharacter({ offense: { meleeCritRatePct: 100, meleeCritBonusPct: 0 } });
        const defNoRes = createDefaultCharacter({ defense: { resilience: 0, physicalDefense: 0, toughness: 0 } });
        const effZeroCb = computeEffectiveStats(defNoRes, zeroCbAtt).defense.ehp.melee;
        assertApprox(effZeroCb.vsAttackerEffCritBonusPct, 0, 0.001, "Explicit 0% attacker crit bonus stays 0% (not coerced to 50%)");

        const overCapAtt = createDefaultCharacter({
            offense: { meleeAttack: 1000, meleeCritRatePct: 100, meleeCritBonusPct: 280 },
        });
        const buffedOverCap = applyModifiers(overCapAtt, ["zeal"]); // 280 + 75 = 355 -> capped at 300% on sheet
        assertApprox(buffedOverCap.offense.meleeCritBonusPct, 300, 0.001, "Buffed sheet Crit Bonus caps at 300%");
        const defRes18k = createDefaultCharacter({ defense: { resilience: 18000, physicalDefense: 0, toughness: 0 } }); // -50% crit bonus
        // 280% + Precision Strike (+60%) = 340% -> capped to 300% BEFORE Resilience -> 300% - 50% = 250%
        const psOverCap = simulateSkillDamage(overCapAtt, defRes18k, psSkill);
        assertApprox(psOverCap.breakdown.effectiveCritBonusPct, 250, 0.01, "300% Crit Bonus cap applies BEFORE Resilience (-50% -> 250%)");
    });

    // 31. Buff ID Fixes, All 7 Enlightenments, Secondary DoTs/Finishers, Stat Weights, & All-vs-All Saved Combos
    await test("Buff ID map fixes, all 7 Enlightenments, secondary DoTs/Finishers, Stat Weights, and All-vs-All Saved Combos", () => {
        // 1. Fixed DaruGear Buff ID Map (Spellbooks, Pigglewiggle, Jujube, Potions, Vaughn's, Manuals, Judge's, Enlightenments)
        assert(findModifierForDaruGearBuff({ id: 9000053, name: "Spellbook: Bulwark Focus" })?.id === "bulwark_focus", "Bulwark Focus maps via #9000053");
        assert(findModifierForDaruGearBuff({ id: 9000060, name: "Spellbook: Authority Power" })?.id === "authority_power", "Authority Power maps via #9000060");
        assert(findModifierForDaruGearBuff({ id: 9000140, name: "Pigglewiggle Bacon" })?.id === "pigglewiggle_bacon", "Pigglewiggle Bacon maps via #9000140");
        assert(findModifierForDaruGearBuff({ id: 16859, name: "Jujube Juice" })?.id === "jujube_juice", "Jujube Juice maps via #16859");
        assert(findModifierForDaruGearBuff({ id: 20588, name: "Kingdom's Shadow" })?.id === "kingdoms_shadow", "Kingdom's Shadow R3 maps via #20588");
        assert(findModifierForDaruGearBuff({ id: 674, name: "Kingdom's Heart" })?.id === "kingdoms_heart", "Kingdom's Heart R3 maps via #674");
        assert(findModifierForDaruGearBuff({ id: 8000056, name: "Vaughn's Potent Stout" })?.id === "vaughns_potent_stout", "Vaughn's Potent Stout maps via #8000056");
        assert(findModifierForDaruGearBuff({ id: 19938, name: "Awaken" })?.id === "combat_manual_awaken", "Combat Manual Awaken maps via #19938");
        assert(findModifierForDaruGearBuff({ id: 20552, name: "Mercurial Movement" })?.id === "judges_mercurial_movement", "Mercurial Movement maps via #20552");
        assert(findModifierForDaruGearBuff({ id: 9001051, name: "Life Enlightenment" })?.id === "enlightenment_life", "Life Enlightenment maps via #9001051");
        assert(findModifierForDaruGearBuff({ id: 9001050, name: "Flame Enlightenment" })?.id === "enlightenment_flame", "Flame Enlightenment maps via #9001050");

        // 2. All 7 Enlightenments registered & mutually exclusive + Costume lunafrost auto-detect
        const enlIds = [
            "enlightenment_life",
            "enlightenment_flame",
            "enlightenment_gale",
            "enlightenment_wave",
            "enlightenment_meadow",
            "enlightenment_earth",
            "enlightenment_lightning",
        ];
        for (const eid of enlIds) {
            assert(COMBAT_MODIFIERS[eid]?.exclusiveGroup === "enlightenment_2set", `${eid} exists in enlightenment_2set group`);
        }
        const dgLife = parseImportPayload({
            name: "Costume Life Test",
            offense: { meleeAttack: 1200 },
            equipment: [
                {
                    slotId: 0,
                    slotName: "Costume",
                    name: "Mythic Costume",
                    lunafrost: "Life Charm: Precision Strike +1 Rank",
                },
            ],
        });
        assert(dgLife.ok && dgLife.modifiers?.includes("enlightenment_life"), "Costume Life Charm lunafrost auto-activates enlightenment_life");

        // 3. Life Enlightenment (+1 Rank Precision Strike: 864 -> 921 base, +65% CD, +36% backstab; Deadeye +20 Ranged Atk)
        const baseMele = createDefaultCharacter({
            maxHealth: 25000,
            offense: { meleeAttack: 1000, rangedAttack: 1000, meleeCritRatePct: 50, meleeCritBonusPct: 100 },
            defense: { physicalDefense: 0, magicDefense: 0, toughness: 0, resilience: 0, evasionPct: 20, parryPct: 15, blockPct: 15, hasShield: true },
        });
        const ps = findSkill(battlerage, "battlerage_precision_strike");
        const psBase = simulateSkillDamage(baseMele, baseMele, ps, { isBackstab: true });
        const psLife = simulateSkillDamage(baseMele, baseMele, ps, { isBackstab: true, attackerModifiers: ["enlightenment_life"] });
        assert(psLife.breakdown.rawBase === psBase.breakdown.rawBase + 57, "Life Enlightenment adds +57 base to Precision Strike");
        assertApprox(psLife.breakdown.effectiveCritBonusPct - psBase.breakdown.effectiveCritBonusPct, 5, 0.01, "Life Enlightenment adds +5% Crit Damage to Precision Strike");
        assertApprox(psLife.breakdown.effectiveCritRatePct - psBase.breakdown.effectiveCritRatePct, 2, 0.01, "Life Enlightenment adds +2% Backstab Crit Rate to Precision Strike");
        assert(Boolean(psLife.breakdown.lifeEnlightenmentNote), "Precision Strike breakdown includes lifeEnlightenmentNote");

        const deadeyeNoLife = applyModifiers(baseMele, ["deadeye"]);
        const deadeyeWithLife = applyModifiers(baseMele, ["deadeye", "enlightenment_life"]);
        assertApprox(deadeyeWithLife.offense.rangedAttack - deadeyeNoLife.offense.rangedAttack, 20, 0.01, "Life Enlightenment boosts Deadeye by +20 Ranged Attack");

        // 4. Flame Enlightenment (2-Set): 1% Max HP per Block/Parry/Evade
        const flameChar = applyModifiers(baseMele, ["enlightenment_flame"]);
        const flameEhp = computeEffectiveStats(flameChar, baseMele).defense.ehp.melee;
        assert(flameEhp.flameEnlightenment.active === true, "Flame Enlightenment flagged active on melee EHP");
        assertApprox(flameEhp.flameEnlightenment.healPerAvoid, 250, 0.1, "Flame Enlightenment heals 1% of 25,000 HP = 250 HP per avoid");
        assert(flameEhp.flameEnlightenment.expectedHealPerHit > 0, "Flame Enlightenment computes positive expected heal per incoming hit");

        // 5. Optional Secondary DoT / Bleed / Bloodthirst Finisher Damage
        const arc = findSkill(sorcery, "sorcery_arc_lightning");
        const wallop = findSkill(shadowplay, "shadowplay_wallop");
        const stalker = findSkill(shadowplay, "shadowplay_stalkers_mark");
        const mage = createDefaultCharacter({ offense: { magicAttack: 1000, magicCritRatePct: 0, meleeAttack: 1000, meleeCritRatePct: 0, rangedAttack: 1000, rangedCritRatePct: 0 } });
        const dummy = createDefaultCharacter({ maxHealth: 20000, defense: { physicalDefense: 0, magicDefense: 0, toughness: 0, resilience: 0 } });

        const arcNoSec = simulateSkillDamage(mage, dummy, arc, { includeSecondaryEffects: false });
        const arcWithSec = simulateSkillDamage(mage, dummy, arc, { includeSecondaryEffects: true });
        assert(arcNoSec.secondary === null && arcWithSec.secondary !== null, "Arc Lightning secondary Shock DoT is opt-in");
        assertApprox(arcWithSec.expected - arcNoSec.expected, 386, 1, "Arc Lightning adds 386 Shock DoT on 0-MDef dummy");

        const wallopWithSec = simulateSkillDamage(mage, dummy, wallop, { includeSecondaryEffects: true, bloodthirstStacks: 10 });
        assert(wallopWithSec.secondary && wallopWithSec.secondary.rawBase === 13 * 192, "Wallop 4th-hit Bloodthirst finisher scales with (10 + 3) * 192");

        const smBase = simulateSkillDamage(mage, dummy, stalker, { includeSecondaryEffects: true });
        const smLife = simulateSkillDamage(mage, dummy, stalker, { includeSecondaryEffects: true, attackerModifiers: ["enlightenment_life"] });
        assert(smBase.secondary.rawBase === 400 && smLife.secondary.rawBase === 450, "Stalker's Mark expiry burst scales 80 -> 90 per hit with Life Enlightenment");

        // 6. Stat Weights Marginal Upgrade Calculator (Offense, Healing, Defense)
        const swOff = computeStatWeights(
            createDefaultCharacter({ offense: { meleeAttack: 1200, meleeCritRatePct: 40, meleeCritBonusPct: 160 } }),
            createDefaultCharacter({ defense: { physicalDefense: 10000, toughness: 3000, resilience: 4000, evasionPct: 10 } }),
            { mode: "offense", skill: ps }
        );
        assert(swOff.items.length >= 8 && swOff.items[0].gainPct >= swOff.items[swOff.items.length - 1].gainPct, "Offense Stat Weights sorted descending by % gain");
        assert(swOff.items.some((i) => i.id === "gem_pen" && i.gainPct > 0), "Offense Stat Weights includes Defense Pen gem with positive gain");
        assert(swOff.items.some((i) => i.id === "attr_main" && i.gainPct > 0), "Offense Stat Weights +50 STR yields positive gain");

        const swHeal = computeStatWeights(
            createDefaultCharacter({ offense: { healingPower: 1100, healCritRatePct: 35, healCritBonusPct: 140 } }),
            createDefaultCharacter({ maxHealth: 25000 }),
            { mode: "healing", skill: findSkill(vitalism, "vitalism_antithesis_heal") }
        );
        assert(swHeal.items.some((i) => i.id === "synth_healpct" && i.gainPct > 0) && swHeal.items.some((i) => i.id === "attr_spi" && i.gainPct > 0), "Healing Stat Weights +3.2% Outgoing Healing and +50 SPI yield positive gains");

        const swDef = computeStatWeights(
            createDefaultCharacter({ maxHealth: 28000, defense: { physicalDefense: 9000, toughness: 3000, resilience: 4000, hasShield: true, blockPct: 12 } }),
            createDefaultCharacter({ offense: { meleeAttack: 1300, meleeCritRatePct: 45, meleeCritBonusPct: 200, defensePenetration: 2000 } }),
            { mode: "defense", ehpKind: "melee" }
        );
        assert(swDef.items.length >= 8 && swDef.items[0].gainPct > 0, "Defense Stat Weights returns ranked EHP upgrades");
        assert(swDef.items.some((i) => i.id === "synth_hp" && i.gainPct > 0) && swDef.items.some((i) => i.id === "attr_sta" && i.gainPct > 0), "Defense Stat Weights +1500 HP and +50 STA yield positive EHP gains");

        // 7. All-vs-All Matchup Matrix with metric: "saved_combo"
        const drCombo = {
            id: "dr_test",
            label: "DR Burst",
            steps: [
                { skill: findSkill(battlerage, "battlerage_charge") },
                { skill: ps, isBackstab: true, targetIsCCd: true },
            ],
        };
        const mEntries = [
            {
                id: "b1",
                name: "Darkrunner",
                character: createDefaultCharacter({ maxHealth: 20000, offense: { meleeAttack: 1400, meleeCritRatePct: 45, meleeCritBonusPct: 200 } }),
                combo: drCombo,
            },
            {
                id: "b2",
                name: "Tank",
                character: createDefaultCharacter({ maxHealth: 35000, defense: { physicalDefense: 14000, toughness: 4000, resilience: 5000 } }),
                combo: drCombo,
            },
        ];
        const comboMat = computeAllVsAllMatrix(mEntries, { metric: "saved_combo", hitMode: "expected" });
        assert(comboMat.rows.length === 2, "Saved Combo All-vs-All Matrix builds 2x2 grid");
        assert(comboMat.rows[0].cells[1].comboName === "DR Burst" && comboMat.rows[0].cells[1].dmg > 0 && comboMat.rows[0].cells[1].durationSec > 0, "Saved Combo cell reports comboName, dmg, durationSec, and killProbPct");
        assert(comboMat.rows[0].cells[0].pctHp > comboMat.rows[0].cells[1].pctHp, "Darkrunner deals higher % HP to squishy mirror than to 35k HP Tank");
    });

    // 32. Skill Builder (120 Classes, 28-pt Unlock/Cascade Rules, Zero Double-Counting Passive Deltas, Combat Passives & DaruGear playerclass Import)
    await test("Skill Builder: 120 classes, 28-pt thresholds/cascade, baked passive deltas (0 double-count), combat/CD passives, & DaruGear import", async () => {
        const sbData = await loadJson("../js/data/skill_builder_data.json");
        initSkillBuilderData(sbData);

        // 1. Class resolution (both directions)
        assert(resolveClassName(["battlerage", "auramancy", "shadowplay"]) === "Darkrunner", "Battlerage + Auramancy + Shadowplay resolves to Darkrunner");
        assert(resolveClassName(["vitalism", "songcraft", "auramancy"]) === "Cleric", "Order-independent resolution to Cleric");
        const clericTrees = treesForClassName("Cleric");
        assert(Array.isArray(clericTrees) && clericTrees.join(",") === "auramancy,songcraft,vitalism", "Reverse lookup Cleric -> auramancy,songcraft,vitalism");

        // 2. Unlock thresholds & cascade deselection
        let sb = normalizeSkillBuild({ trees: ["battlerage", "auramancy", "shadowplay"], activeSkills: [], passives: [], bakedPassives: [] });
        const lockTry = togglePassiveSkill(sb, "battlerage", "Weapon Maneuvers");
        assert(!lockTry.changed, "Cannot select 2-pt passive Weapon Maneuvers with 0 points in Battlerage");
        sb = toggleActiveSkill(sb, "battlerage", "battlerage_triple_slash").skillBuild;
        sb = toggleActiveSkill(sb, "battlerage", "battlerage_charge").skillBuild;
        const okTry = togglePassiveSkill(sb, "battlerage", "Weapon Maneuvers");
        assert(okTry.changed && okTry.skillBuild.passives.includes("Weapon Maneuvers"), "Weapon Maneuvers unlocks at 2 points in Battlerage");
        const afterRemove = toggleActiveSkill(okTry.skillBuild, "battlerage", "battlerage_charge").skillBuild;
        assert(!afterRemove.passives.includes("Weapon Maneuvers"), "Removing 2nd active cascades and deselects Weapon Maneuvers");
        assert(getTotalPointsSpent(afterRemove) === 1, "Total points updates to 1 after cascade");

        // 3. Tree swap clears removed tree skills & updates className
        const swapped = setSkillBuildTree(okTry.skillBuild, 0, "defense");
        assert(swapped.className === "Nightblade", "Swapping Battlerage -> Defense updates Darkrunner -> Nightblade");
        assert(!swapped.passives.includes("Weapon Maneuvers"), "Swapping out Battlerage clears Battlerage passives");

        // 4. Zero double-counting for DaruGear-baked sheet passives + live delta on add/remove
        const healerBase = createDefaultCharacter({
            maxHealth: 25000,
            attributes: { spi: 1000 },
            offense: { healingPower: 1200, healCritBonusPct: 125, castTimePct: 80 },
            defense: { physicalDefense: 8000, magicDefense: 10000, receivedMeleeDrPct: 10 },
            skillBuild: {
                trees: ["auramancy", "songcraft", "vitalism"],
                activeSkills: [],
                passives: ["Invigorated Healing", "Absorb Damage", "Joyous Spirit"],
                bakedPassives: ["Invigorated Healing"], // already baked into healCritBonusPct = 125
                hatredTree: null,
            },
        });
        const healerEff = applyModifiers(healerBase, []);
        assertApprox(healerEff.offense.healCritBonusPct, 125, 0.01, "Baked Invigorated Healing is NOT double-counted (stays 125%)");
        assertApprox(healerEff.defense.receivedMeleeDrPct, 10, 0.01, "Absorb Damage does NOT increase Received DR% (stays 10%)");
        assert(healerEff._activeBuffFlags?.absorbDamagePct === 7, "Absorb Damage records 7% post-hit damage-to-HP sustain flag");
        assert(healerEff.skillsetCooldownReductionPct.vitalism === 20, "Joyous Spirit applies -20% Vitalism cooldown reduction");

        // Unchecking baked Invigorated Healing subtracts 25% Crit Heal Bonus cleanly; adding Defiance adds +500 MDef
        const healerEdited = {
            ...healerBase,
            skillBuild: {
                ...healerBase.skillBuild,
                passives: ["Defiance", "Joyous Spirit"],
            },
        };
        const healerEditedEff = applyModifiers(healerEdited, []);
        assertApprox(healerEditedEff.offense.healCritBonusPct, 100, 0.01, "Unchecking baked Invigorated Healing subtracts -25% Crit Heal Bonus (125% -> 100%)");
        assertApprox(healerEditedEff.defense.magicDefense, 10500, 0.01, "Checking unbaked Defiance adds +500 Magic Defense (10000 -> 10500)");

        // 5. Weapon Mastery (+15% mult) & Attack Speed Training (-10% Battlerage CD) in live skill simulation + deduplication
        const brChar = createDefaultCharacter({
            offense: { meleeAttack: 1000, meleeSkillDamagePct: 20, meleeCritRatePct: 0 },
            skillBuild: {
                trees: ["battlerage", "auramancy", "shadowplay"],
                activeSkills: [],
                passives: ["Weapon Mastery", "Attack Speed Training"],
                bakedPassives: [],
                hatredTree: null,
            },
        });
        const dummy = createDefaultCharacter({ defense: { physicalDefense: 0, toughness: 0, resilience: 0 } });
        const ps = findSkill(battlerage, "battlerage_precision_strike");
        const psNoSb = simulateSkillDamage(createDefaultCharacter({ offense: { meleeAttack: 1000, meleeSkillDamagePct: 20, meleeCritRatePct: 0 } }), dummy, ps);
        const psWithSb = simulateSkillDamage(brChar, dummy, ps);
        const psWithSbAndChip = simulateSkillDamage(brChar, dummy, ps, { attackerModifiers: ["weapon_mastery"] });
        assertApprox(psWithSb.normal / psNoSb.normal, 1.15, 0.001, "Skill Builder Weapon Mastery boosts Precision Strike by exact +15% mult");
        assertApprox(psWithSbAndChip.normal, psWithSb.normal, 0.1, "Weapon Mastery in Skill Builder + Buff chip deduplicates (no double +15%)");
        assertApprox(psWithSb.dps.cooldownSec, ps.cooldownSec * 0.9, 0.01, "Attack Speed Training reduces Precision Strike cooldown by -10%");

        // 6. Direct DaruGear playerclass import parser
        const parsedDg = extractSkillBuildFromDaruGearPlayerClass({
            class_name: "Darkrunner",
            skill1: {
                treeid: 1,
                is_hatred: true,
                Actives: [{ skill_name: "Triple Slash", selected: true }, { skill_name: "Charge", selected: true }, { skill_name: "Whirlwind Slash", selected: false }],
                Passive: [{ name: "Weapon Maneuvers", selected: true }, { name: "Weapon Mastery", selected: true }],
            },
            skill2: { treeid: 4, is_hatred: false, Actives: [{ skill_name: "Teleportation", selected: true }], Passive: [{ name: "Absorb Damage", selected: true }] },
            skill3: { treeid: 8, is_hatred: false, Actives: [{ skill_name: "Shadowstep", selected: true }], Passive: [] },
        });
        assert(parsedDg && parsedDg.className === "Darkrunner", "Parses DaruGear playerclass -> Darkrunner");
        assert(parsedDg.hatredTree === "battlerage", "Preserves Hatred tree flag from DaruGear");
        assert(parsedDg.activeSkills.length === 4 && parsedDg.passives.length === 3, "Imports exact selected actives (4) & passives (3)");
        assert(parsedDg.bakedPassives.includes("Weapon Maneuvers") && !parsedDg.bakedPassives.includes("Weapon Mastery"), "Only static sheet passives go into bakedPassives (combat passives stay live)");

        // 7. Ancestral skill variant selection (auto-select active, switch elements, clear on deselect & tree swap)
        let sbAnc = normalizeSkillBuild({ trees: ["sorcery", "shadowplay", "songcraft"], activeSkills: [], passives: [], bakedPassives: [] });
        const ancPick = setAncestralVariant(sbAnc, "sorcery", "sorcery_flamebolt", "lightning");
        assert(ancPick.changed && ancPick.skillBuild.activeSkills.includes("sorcery_flamebolt") && ancPick.skillBuild.ancestralChoices.sorcery_flamebolt === "lightning", "Selecting Lightning Flamebolt auto-selects active skill and stores elemental choice");
        const ancSwitch = setAncestralVariant(ancPick.skillBuild, "sorcery", "sorcery_flamebolt", "flame");
        assert(ancSwitch.changed && ancSwitch.skillBuild.ancestralChoices.sorcery_flamebolt === "flame", "Switching Flamebolt Ancestral to Flame updates choice");
        const ancBackBase = setAncestralVariant(ancSwitch.skillBuild, "sorcery", "sorcery_flamebolt", "base");
        assert(ancBackBase.changed && !ancBackBase.skillBuild.ancestralChoices.sorcery_flamebolt && ancBackBase.skillBuild.activeSkills.includes("sorcery_flamebolt"), "Switching back to Base clears ancestral choice while keeping active skill selected");
        const ancDeselect = toggleActiveSkill(ancSwitch.skillBuild, "sorcery", "sorcery_flamebolt").skillBuild;
        assert(!ancDeselect.ancestralChoices.sorcery_flamebolt, "Deselecting active skill clears its Ancestral choice");
    });

    // 33. Direct DaruGear Share API Stat Calculator (Zero-Bookmarklet URL Import)
    await test("Direct DaruGear Share API stat calculator (weapons, armor, shield, lunagems, synth, buffs, passives, & skillBuild)", () => {
        const rawApi = {
            hash: "TEST99",
            player: {
                health: 8350,
                mana: 5600,
                str: 158,
                dex: 158,
                sta: 158,
                spi: 158,
                int: 158,
                title: { id: 181, name: "Desert Fox", data: [] },
                buff: [],
                equipment_buff: [
                    {
                        id: 16559,
                        name: "Equip Shield",
                        is_optional: false,
                        data: [
                            { unit_attribute_id: 8, value: 200 },
                            { unit_attribute_id: 64, value: 200 },
                            { unit_attribute_id: 6, value: 350 },
                        ],
                    },
                ],
                playerclass: {
                    class_name: "Paladin",
                    skill1: {
                        treeid: 1,
                        is_hatred: false,
                        Actives: [{ skill_name: "Triple Slash", selected: true }, { skill_name: "Precision Strike", selected: true }],
                        Passive: [{ name: "Weapon Maneuvers", selected: true, buff_data: [{ unit_attribute_id: 96, value: 5 }] }],
                    },
                    skill2: {
                        treeid: 3,
                        is_hatred: false,
                        Actives: [{ skill_name: "Shield Slam", selected: true }],
                        Passive: [{ name: "Shield of Steel", selected: true, buff_data: [{ unit_attribute_id: 8, value: 900 }] }],
                    },
                    skill3: {
                        treeid: 10,
                        is_hatred: false,
                        Actives: [{ skill_name: "Antithesis", selected: true }],
                        Passive: [{ name: "Invigorated Healing", selected: true, buff_data: [{ unit_attribute_id: 176, value: 250 }] }],
                    },
                },
            },
            slots: [
                {
                    id: 15,
                    name: "Right Hand Weapon",
                    item: {
                        ptemper: 100,
                        mtemper: 100,
                        grade: { id: 9, name: "Epic", colour: "#f0f6ff", main_mod: 170, stat_mod: 120 },
                        equipment: {
                            name: "Ayanad Earth Shortspear",
                            type: "Shortspear",
                            level: 62,
                            slotid: [15],
                            str_weight: 0, dex_weight: 0, sta_weight: 100, spi_weight: 0, int_weight: 0,
                            equipeffects: [],
                            seteffects: [],
                            buff_json: [],
                            modifiers_json: [],
                        },
                        lunagem: [
                            { id: 1, name: "Focus Gem", level: 25, effect_text: "Focus +360", effects: [{ unit_attribute_id: 181, value: 360 }] },
                        ],
                    },
                },
                {
                    id: 16,
                    name: "Left Hand Weapon",
                    item: {
                        ptemper: 100,
                        mtemper: 100,
                        grade: { id: 9, name: "Epic", colour: "#f0f6ff", main_mod: 170, stat_mod: 120 },
                        equipment: {
                            name: "Ayanad Earth Shield",
                            type: "Shield",
                            level: 62,
                            slotid: [16],
                            str_weight: 0, dex_weight: 0, sta_weight: 100, spi_weight: 0, int_weight: 0,
                            equipeffects: [],
                            seteffects: [],
                            buff_json: [],
                            modifiers_json: [],
                        },
                        lunagem: [],
                    },
                },
                {
                    id: 0,
                    name: "Costume",
                    item: {
                        grade: { id: 11, name: "Mythic", colour: "#ef233c", main_mod: 100, stat_mod: 100 },
                        equipment: {
                            name: "Mythic Costume",
                            type: "Synthesis Gear",
                            level: 1,
                            slotid: [0],
                            synth_percentage: 100,
                            equipeffects: [],
                            seteffects: [],
                            buff_json: [],
                            modifiers_json: [],
                        },
                        sythisis_stat: [
                            { unit_attribute_id: 58, minvalue: -28, maxvalue: -32, display_text: "Decrease Received Damage %\n-2.8 ~ -3.2" },
                            { unit_attribute_id: 183, minvalue: 700, maxvalue: 835, display_text: "Resilience\n+700 ~ +835" },
                        ],
                    },
                },
            ],
        };

        const exp = buildDaruGearExportFromApiPayload(rawApi, "TEST99");
        assert(exp.className === "Paladin" && exp.shareCode === "TEST99", "Builds export with className Paladin & shareCode TEST99");
        assert(exp.equipmentType === "shield" && exp.defense.hasShield === true, "Detects Shield equipmentType & hasShield");
        assert(exp.defense.shieldPhysicalDefense === 3426, "Computes exact Ayanad Epic Shield PDef (3426)");
        assert(exp.defense.physicalDefense === 3426 + 200 + 900, "Sums Shield PDef + Equip Shield (+200) + Shield of Steel (+900)");
        assert(exp.offense.focus === 360, "Applies Lunagem Focus +360");
        assertApprox(exp.offense.healCritBonusPct, 75, 0.01, "Applies Invigorated Healing (+25% over 50% base -> 75%)");
        assertApprox(exp.defense.receivedMeleeDrPct, 3.2, 0.01, "Applies Costume synth -3.2% Received Damage as +3.2% DR");
        assert(exp.defense.resilience === 835, "Applies Costume synth +835 Resilience");
        assert(exp.skillBuild && exp.skillBuild.activeSkills.length === 4 && exp.skillBuild.passives.length === 3, "Extracts complete skillBuild from playerclass");

        // Also verifies parseImportPayload accepts raw { slots, player } directly
        const viaParser = parseImportPayload(rawApi);
        assert(viaParser.ok && viaParser.character.defense.shieldPhysicalDefense === 3426, "parseImportPayload converts raw DaruGear API payload seamlessly");

        // Magic Shield (e.g. Widowshroud) has Block Rate > 0% and 0 Shield PDef -> should NOT emit false-positive shieldPhysicalDefense warning
        const magicShieldApi = {
            player: { ...rawApi.player },
            slots: [
                rawApi.slots[0],
                {
                    id: 16,
                    name: "Left Hand Weapon",
                    item: {
                        ptemper: 0,
                        mtemper: 0,
                        grade: { id: 9, name: "Epic", colour: "#f0f6ff", main_mod: 170, stat_mod: 170 },
                        equipment: {
                            name: "Widowshroud",
                            type: "Magic Shield",
                            level: 64,
                            slotid: [16],
                            str_weight: 0, dex_weight: 0, sta_weight: 100, spi_weight: 0, int_weight: 0,
                            equipeffects: [
                                { item_grade_id: 9, unit_attribute_id: 64, value: 4311 },
                                { item_grade_id: 9, unit_attribute_id: 58, value: -32 },
                            ],
                            seteffects: [],
                            buff_json: [],
                            modifiers_json: [],
                        },
                        lunagem: [{ id: 2, name: "Block Gem", level: 25, effect_text: "Block +3%", effects: [{ unit_attribute_id: 179, value: 30 }] }],
                    },
                },
            ],
        };
        const msParsed = parseImportPayload(magicShieldApi);
        assert(
            msParsed.ok &&
                msParsed.character.metadata.equipmentType === "magic_shield" &&
                msParsed.character.defense.blockPct > 0 &&
                msParsed.character.defense.shieldPhysicalDefense === 0 &&
                msParsed.warnings.length === 0,
            "Magic Shield (Widowshroud) imports with blockPct > 0, shieldPhysicalDefense === 0, and zero false-positive warnings"
        );

        // Negative unit_attribute_id 142 (-48 Fixed DR from Bulwark of Toughness) produces positive Fixed DR & unbakes cleanly >= 0
        const bulwarkApi = {
            player: {
                ...rawApi.player,
                equipment_buff: [
                    ...rawApi.player.equipment_buff,
                    { id: 9000054, name: "Bulwark of Toughness", is_optional: true, data: [{ unit_attribute_id: 142, value: -48 }, { unit_attribute_id: 182, value: 1255 }] },
                ],
            },
            slots: rawApi.slots,
        };
        const bwExp = buildDaruGearExportFromApiPayload(bulwarkApi, "BW01");
        const baseExp = buildDaruGearExportFromApiPayload(rawApi, "BW00");
        assert(
            bwExp.defense.fixedMeleeDr === baseExp.defense.fixedMeleeDr + 48,
            "DaruGear o[142] (-48) adds +48 positive Fixed DR cleanly"
        );
        const bwUnbaked = unapplyModifiers(parseImportPayload(bulwarkApi).character, ["bulwark_toughness"]);
        assert(
            bwUnbaked.defense.fixedMeleeDr === baseExp.defense.fixedMeleeDr && bwUnbaked.defense.fixedMeleeDr >= 0,
            "Unbaking Bulwark of Toughness restores exact non-negative Fixed DR"
        );
    });

    // 34. DaruGear-Style 20-Slot Gear Builder (Catalog, 7pc Armor Set/Grade Buffs, 2H/Shield Exclusion, Tempers, Gems, & Live Recalc)
    await test("Gear Builder: 20-slot catalog, 7pc Ayanad Plate set/grade buffs, 2H/Shield mutual exclusion, tempers, Fill All gems, & live recalc", async () => {
        const catalog = await loadGearCatalog("../js/data/gear_catalog");
        assert(catalog && catalog.allItems.length > 6000, "Loads 6,000+ AA Classic 3.5 items from gear_catalog");
        assert(catalog.lunagems.length > 200 && catalog.lunafrosts.length > 300 && catalog.titles.length > 200, "Loads lunagems, lunafrosts, and titles");

        let slots = createEmptyGearSlots(catalog);
        let player = createDefaultRawPlayer(null);

        // 1. Equip 7pc Epic Ayanad Wave Plate armor -> triggers Complete Plate Set (#740) + Epic Plate Grade Buff (#6439, +9,267 HP)
        for (const sid of [1, 2, 3, 4, 5, 7, 8]) {
            const matches = filterItemsForSlot(sid, { query: "Ayanad Wave", typeFilter: "Plate" }, catalog);
            assert(matches.length > 0, `Found Ayanad Wave Plate item for slot ${sid}`);
            slots = equipCatalogItemInSlot(slots, sid, matches[0], { gradeId: 9 }, catalog);
        }

        // 2. Equip Epic Ayanad Wave Scepter (slot 15) + Epic Ayanad Wave Shield (slot 16)
        const scepters = filterItemsForSlot(15, { query: "Ayanad Wave", typeFilter: "Scepter" }, catalog);
        const shields = filterItemsForSlot(16, { query: "Ayanad Wave", typeFilter: "Shield" }, catalog);
        assert(scepters.length > 0 && shields.length > 0, "Found Ayanad Wave Scepter and Shield");
        slots = equipCatalogItemInSlot(slots, 15, scepters[0], { gradeId: 9 }, catalog);
        slots = equipCatalogItemInSlot(slots, 16, shields[0], { gradeId: 9 }, catalog);

        const buffs = recomputeGearBuffs(slots, player, catalog);
        const plateSetBuff = buffs.find((b) => b.id === 740);
        const plateGradeBuff = buffs.find((b) => b.id === 6439);
        assert(Boolean(plateSetBuff), "7pc Plate activates Complete Plate Set (#740)");
        assert(
            plateSetBuff.data.some((d) => d.unit_attribute_id === 995 && d.value === 5) &&
                plateSetBuff.data.some((d) => d.unit_attribute_id === 994 && d.value === 3),
            "Complete Plate Set (#740) applies +5% Max Health (995) and +3% Physical Defense (994)"
        );
        assert(Boolean(plateGradeBuff), "7pc Epic Plate activates Epic Plate Armor Grade Buff (#6439)");
        assert(
            plateGradeBuff.data.some((d) => d.unit_attribute_id === 6 && d.value === 9267),
            "7pc Epic Ayanad Plate Grade Buff (#6439) computes exact +9,267 Max HP"
        );
        assert(buffs.some((b) => b.id === 16559), "Shield activates Equip Shield (#16559)");

        // 3. Fill all 7 sockets on Scepter with a valid weapon lunagem + Temper to 110%
        const wepGems = filterLunagemsForSlot(15, slots.find((s) => s.id === 15).item, catalog);
        const mPenGem = wepGems.find((g) => /magic defense penetration/i.test(g.effect_text)) || wepGems[0];
        slots = fillAllSlotLunagems(slots, 15, mPenGem.id, catalog);
        slots = setSlotItemTemper(slots, 15, 100, 110);
        const scepterItem = slots.find((s) => s.id === 15).item;
        assert(scepterItem.lunagem.length === 7 && scepterItem.lunagem.every((g) => g.id === mPenGem.id), "Epic 1H Weapon fills all 7 lunagem sockets");

        const baseChar = createDefaultCharacter({ name: "Plate Mage Builder" });
        const { character: built } = recalculateCharacterFromGearBuilder(baseChar, slots, player, catalog);
        assert(built.defense.hasShield === true && built.defense.shieldPhysicalDefense === 3426, "Recalculated Shield PDef === 3426");
        assert(built.defense.physicalDefense > 12000 && built.maxHealth > 20000, "Recalculated 7pc Epic Plate + Shield PDef & Max HP cleanly");
        assert(built.offense.magicAttack > 800, "Recalculated 110% tempered Epic Ayanad Scepter Magic Attack cleanly");

        // 4. Equipping a 2H Staff in slot 15 auto-unequips Shield in slot 16 and switches buff #16559 -> #8227
        const staffs = filterItemsForSlot(15, { query: "Ayanad Wave", typeFilter: "Staff" }, catalog);
        assert(staffs.length > 0, "Found Ayanad Wave Staff");
        const slots2H = equipCatalogItemInSlot(slots, 15, staffs[0], { gradeId: 10 }, catalog);
        assert(slots2H.find((s) => s.id === 16).item === null, "Equipping 2H Staff auto-clears Left Hand Shield slot");
        const buffs2H = recomputeGearBuffs(slots2H, player, catalog);
        assert(buffs2H.some((b) => b.id === 8227) && !buffs2H.some((b) => b.id === 16559), "2H Staff swaps Equip Shield (#16559) -> Equip Two-Handed Weapon (#8227)");
        const { character: built2H } = recalculateCharacterFromGearBuilder(built, slots2H, player, catalog);
        assert(built2H.offense.magicAttack > built.offense.magicAttack, "Legendary 2H Staff yields higher Magic Attack than Epic 1H Scepter");
        assert(built2H.defense.hasShield === false, "2H Staff sets hasShield = false");

        // 5. Title selection applies cleanly
        const titleWithStats = catalog.titles.find((t) => Array.isArray(t.data) && t.data.length > 0);
        if (titleWithStats) {
            player = setGearPlayerTitle(player, titleWithStats.id, catalog);
            const buffsWithTitle = recomputeGearBuffs(slots2H, player, catalog);
            assert(buffsWithTitle.some((b) => b.name === titleWithStats.name), "Selected Title adds its buff to recomputeGearBuffs");
        }

        // 6. Legacy build reconstruction preserves Cloak/Costume synth stats (+104 STA = +1,248 HP) and Stat Migration
        const legacyChar = createDefaultCharacter({
            name: "Legacy Synth Build",
            attributes: { str: 8, agi: 158, sta: 262, int: 158, spi: 8 },
            equipment: [
                {
                    slotId: 0,
                    slotName: "Costume",
                    name: "Magic Basic Costume",
                    type: "Synthesis Gear",
                    gradeId: 11,
                    synthStats: ["Decrease Received Damage -3.2%", "Resilience +835"],
                },
                {
                    slotId: 6,
                    slotName: "Cloak",
                    name: "Erenor Flaming Hatchetblade Cloak",
                    type: "Cloak",
                    gradeId: 11,
                    synthStats: ["Stamina +104"],
                },
            ],
        });
        const rec = ensureCharacterRawDaruGear(legacyChar, catalog);
        assert(rec.reconstructed === true, "Reconstructs legacy build without rawDaruGear");
        assert(rec.player.str === 8 && rec.player.spi === 8 && rec.player.sta === 158, "Preserves DaruGear stat migration (str: 8, spi: 8, sta: 158)");
        const { character: recBuilt } = recalculateCharacterFromGearBuilder(legacyChar, rec.slots, rec.player, catalog);
        assert(recBuilt.attributes.sta === 262, "Preserves Cloak Stamina +104 synth stat (158 + 104 = 262 STA)");
        assert(recBuilt.defense.resilience === 835, "Preserves Costume Resilience +835 synth stat");
        assertApprox(recBuilt.defense.receivedMeleeDrPct, 3.2, 0.01, "Preserves Costume Decrease Received Damage -3.2% synth stat");

        // 7. DaruGear URL API import fixes DaruGear's #740 Complete Plate Set double-count bug identically to Gear Builder
        const rawBuggedPlateApi = {
            player: {
                health: 8350,
                mana: 5600,
                str: 158,
                dex: 158,
                sta: 158,
                spi: 158,
                int: 158,
                equipment_buff: [
                    { id: 740, name: "Complete Plate Set", data: [{ unit_attribute_id: 6, value: 9267 }, { unit_attribute_id: 8, value: 3 }] },
                    { id: 6439, name: "Epic Plate Armor", data: [{ unit_attribute_id: 6, value: 9267 }, { unit_attribute_id: 7, value: 5055 }] },
                    { id: 16559, name: "Equip Shield", data: [{ unit_attribute_id: 6, value: 350 }, { unit_attribute_id: 8, value: 200 }] },
                ],
            },
            slots,
        };
        const apiFixedExp = buildDaruGearExportFromApiPayload(rawBuggedPlateApi, "PL740");
        assert(
            apiFixedExp.maxHealth === built.maxHealth,
            "DaruGear URL import fixes #740 Complete Plate Set double-counted HP to match Gear Builder identically"
        );

        // 8. Gear buff stat breakdown helper formats Epic Plate Armor, Complete Plate Set, and Equip Shield cleanly
        const described = buffs.map((b) => describeGearBuffEffects(b));
        const descPlateGrade = described.find((d) => d.id === 6439);
        const descPlateSet = described.find((d) => d.id === 740);
        assert(
            descPlateGrade &&
                descPlateGrade.summary.includes("Max HP +9,267") &&
                descPlateGrade.summary.includes("Recv Dmg -3%"),
            "describeGearBuffEffects formats Epic Plate Armor exact HP & Recv DR stats"
        );
        assert(
            descPlateSet &&
                descPlateSet.summary.includes("Max HP +5%") &&
                descPlateSet.summary.includes("Phys Def +3%"),
            "describeGearBuffEffects formats Complete Plate Set +5% Max HP & +3% Phys Def"
        );
        const fallbackSummaries = computeCharacterGearBuffSummaries(built, null);
        assert(
            fallbackSummaries.some((s) => s.name === "Epic Plate Armor" && s.summary.includes("Max HP +9,267")) &&
                fallbackSummaries.some((s) => s.name === "Complete Plate Set" && s.summary.includes("Max HP +5%")),
            "computeCharacterGearBuffSummaries works cleanly even before Gear Catalog loads"
        );

        // 9. Stat Migration helpers update base stats & recalculate Max HP / Attack / Crit live
        const { character: beforeMig } = recalculateCharacterFromGearBuilder(built2H, slots2H, player, catalog);
        const baseMig = getPlayerStatMigration(player);
        assert(baseMig.net === 0 && baseMig.totalBase === 790, "Default player starts balanced at 790 base stat pool");
        const migSta = setPlayerStatMigration(player, { sta: 300, int: -150, agi: -150 });
        const migStaInfo = getPlayerStatMigration(migSta);
        assert(
            migStaInfo.net === 0 && migStaInfo.deltas.sta === 300 && migStaInfo.deltas.int === -150 && migStaInfo.deltas.agi === -150,
            "setPlayerStatMigration sets exact balanced +300 STA / -150 INT / -150 AGI deltas"
        );
        const { character: staBuilt } = recalculateCharacterFromGearBuilder(built2H, slots2H, migSta, catalog);
        assert(staBuilt.attributes.sta === beforeMig.attributes.sta + 300, "Migrating +300 STA adds exactly +300 Stamina");
        assert(staBuilt.maxHealth > beforeMig.maxHealth + 3500, "Migrating +300 STA increases Max HP by >= +3,600 HP (with +5% Plate Set bonus)");

        const moved = applyStatMigrationTransfer(migSta, "str", "sta", 50); // STA already at max +300 (458), should clamp cleanly!
        assert(getPlayerStatMigration(moved).deltas.sta === 300, "applyStatMigrationTransfer clamps destination at +300 max migration");
        const movedValid = applyStatMigrationTransfer(player, "int", "str", 120);
        const mvInfo = getPlayerStatMigration(movedValid);
        assert(mvInfo.deltas.int === -120 && mvInfo.deltas.str === 120 && mvInfo.net === 0, "applyStatMigrationTransfer moves 120 INT -> STR keeping pool balanced");

        const resetP = resetPlayerStatMigration(movedValid);
        assert(getPlayerStatMigration(resetP).gained === 0 && getPlayerStatMigration(resetP).lost === 0, "resetPlayerStatMigration restores all 5 stats to 158 (0 delta)");
    });

    // 35. Formula overrides, multiplicative avoidance model, build categories & defensive combo comparison
    await test("Formula overrides, multiplicative avoidance model, build categories & defensive combo comparison", async () => {
        // 1. inferBuildCategory across archetypes + explicit override
        const meleeBuild = createDefaultCharacter({ offense: { meleeAttack: 1650, rangedAttack: 300, magicAttack: 250, healingPower: 100 } });
        const mageBuild = createDefaultCharacter({ offense: { meleeAttack: 250, rangedAttack: 200, magicAttack: 1700, healingPower: 100 } });
        const archerBuild = createDefaultCharacter({ offense: { meleeAttack: 300, rangedAttack: 1550, magicAttack: 180, healingPower: 80 } });
        const healerBuild = createDefaultCharacter({ offense: { meleeAttack: 250, rangedAttack: 180, magicAttack: 320, healingPower: 1450 } });
        const tankBuild = createDefaultCharacter({
            offense: { meleeAttack: 850, rangedAttack: 200, magicAttack: 650, healingPower: 120 },
            defense: { hasShield: true, physicalDefense: 14000, magicDefense: 9000 },
            metadata: { className: "Skullknight" },
        });
        const overrideBuild = createDefaultCharacter({
            offense: { meleeAttack: 1600 },
            metadata: { category: "tank" },
        });
        assert(inferBuildCategory(meleeBuild) === "melee", "Infers Melee archetype from dominant meleeAttack");
        assert(inferBuildCategory(mageBuild) === "mage", "Infers Mage archetype from dominant magicAttack");
        assert(inferBuildCategory(archerBuild) === "archer", "Infers Archer archetype from dominant rangedAttack");
        assert(inferBuildCategory(healerBuild) === "healer", "Infers Healer archetype from dominant healingPower");
        assert(inferBuildCategory(tankBuild) === "tank", "Infers Tank archetype for Skullknight with shield");
        assert(inferBuildCategory(overrideBuild) === "tank", "Respects explicit metadata.category override");

        // 2. Runtime formula overrides + Multiplicative Avoidance model exact EHP <-> simulateSkillDamage identity
        const att = createDefaultCharacter({
            offense: {
                meleeAttack: 1450,
                meleeCritRatePct: 50,
                meleeCritBonusPct: 220,
                focus: 2000,
                defensePenetration: 2000,
            },
        });
        const defA = createDefaultCharacter({
            name: "Shield Tank",
            maxHealth: 34000,
            defense: {
                physicalDefense: 13000,
                magicDefense: 11000,
                shieldPhysicalDefense: 3500,
                hasShield: true,
                toughness: 3800,
                resilience: 5200,
                evasionPct: 20,
                parryPct: 20,
                blockPct: 25,
                receivedMeleeDrPct: 18,
                receivedMagicDrPct: 15,
            },
        });
        const defB = createDefaultCharacter({
            name: "Cloth Glass",
            maxHealth: 24000,
            defense: {
                physicalDefense: 5500,
                magicDefense: 14500,
                hasShield: false,
                toughness: 3200,
                resilience: 4200,
                evasionPct: 8,
                parryPct: 6,
                blockPct: 0,
                receivedMeleeDrPct: 8,
                receivedMagicDrPct: 16,
            },
        });
        const meleeSkill = {
            id: "test_melee_35",
            skillset: "battlerage",
            name: "Test Slash",
            kind: "damage",
            damageType: "physical",
            scalingStat: "meleeAttack",
            base: 1000,
            scalingPct: 550,
        };

        const addEhp = computeEffectiveStats(defA, att).defense.ehp.melee.vsAttackerEhp;
        const addSim = simulateSkillDamage(att, defA, meleeSkill);
        try {
            // Switch globally to multiplicative avoidance + higher Defense K (6000)
            setRuntimeConstantsOverrides({ avoidanceModel: "multiplicative", defenseK: 6000 });
            const multEhp = computeEffectiveStats(defA, att).defense.ehp.melee.vsAttackerEhp;
            const multSim = simulateSkillDamage(att, defA, meleeSkill);
            const expectedMultEhp = defA.maxHealth / (multSim.expected / multSim.breakdown.preMitigation);
            assertApprox(multEhp, expectedMultEhp, 1.0, "Multiplicative avoidance + custom defenseK preserves exact EHP <-> simulateSkillDamage identity");
            assert(multEhp !== addEhp && multSim.expected !== addSim.expected, "Runtime formula overrides visibly change both EHP and skill damage");
            // With multiplicative independent rolls (after focus): connect = (1-E)*(1-P)*(1-B) > 1 - (E+P+B)
            assert(
                multSim.breakdown.avoidance.connectPct > addSim.breakdown.avoidance.connectPct,
                "Multiplicative avoidance has higher connect rate than additive single-roll when E, P, B > 0"
            );
        } finally {
            setRuntimeConstantsOverrides({});
        }
        // Verify reset cleanly restores default values
        const restoredEhp = computeEffectiveStats(defA, att).defense.ehp.melee.vsAttackerEhp;
        assertApprox(restoredEhp, addEhp, 0.01, "Resetting runtime formula overrides restores AA Classic 3.5 default EHP identically");

        // 3. Defensive Combo Comparison (compareDefendersRotation)
        const comboSteps = [
            { skill: meleeSkill, isBackstab: false, targetIsCCd: false },
            { skill: meleeSkill, isBackstab: false, targetIsCCd: false },
            { skill: meleeSkill, isBackstab: true, targetIsCCd: true },
        ];
        const defCombo = compareDefendersRotation(att, defA, defB, comboSteps, {}, {});
        assert(defCombo.tankierByHpPct === "A", "Shield Tank (A) is tankier by % HP Lost against melee burst combo");
        assert(defCombo.tankierByRaw === "A", "Shield Tank (A) takes less raw combo damage than Cloth Glass (B)");
        assert(defCombo.resultVsA.pctOfTargetHp < defCombo.resultVsB.pctOfTargetHp, "A loses smaller % of Max HP than B");
        assertApprox(defCombo.survivalProbA + defCombo.resultVsA.killProbPct, 100, 0.01, "Survival % + Death % = 100% for Defender A");
        assertApprox(defCombo.survivalProbB + defCombo.resultVsB.killProbPct, 100, 0.01, "Survival % + Death % = 100% for Defender B");
        assert(defCombo.survivalProbA >= defCombo.survivalProbB, "Tankier defender has >= survival probability");

        // Verify disableAvoidance propagates cleanly into compareDefendersRotation
        const defComboNoAvoid = compareDefendersRotation(
            att,
            defA,
            defB,
            comboSteps,
            { disableAvoidance: true },
            { disableAvoidance: true }
        );
        assert(
            defComboNoAvoid.resultVsA.totalExpected > defCombo.resultVsA.totalExpected,
            "Disabling avoidance increases incoming combo damage on shield/evasion Defender A"
        );
    });

    // 36. Unified Ancestral Data (Skill Builder <-> Skill Breakdown names, icons & Precision Strike / Tiger Strike / Shield Slam parity)
    await test("Unified Ancestral Data: Skill Builder & Skill Breakdown share exact elements & icons", async () => {
        const sbRes = await fetch("../js/data/skill_builder_data.json", { cache: "no-store" });
        const sbData = await sbRes.json();
        const brRes = await fetch("../js/data/skills/battlerage.json", { cache: "no-store" });
        const brSkills = (await brRes.json()).skills;
        const defRes = await fetch("../js/data/skills/defense.json", { cache: "no-store" });
        const defSkills = (await defRes.json()).skills;

        // Every ancestral entry in Skill Builder has a local icon path
        let totalAncs = 0;
        for (const tree of Object.values(sbData.trees)) {
            for (const act of tree.actives || []) {
                for (const v of act.ancestrals || []) {
                    totalAncs++;
                    assert(
                        typeof v.icon === "string" && v.icon.startsWith("assets/icons/icon_skill_"),
                        `Skill Builder ancestral ${act.name} (${v.element}) has local icon: ${v.icon}`
                    );
                }
            }
        }
        assert(totalAncs >= 60, `Loaded all ${totalAncs} Skill Builder ancestrals with icons`);

        // Specific user-reported fixes: Tiger Strike (Lightning / Life), Precision Strike (Lightning=fight36 / Gale=fight37), Shield Slam (Gale / Quake)
        const tsLight = brSkills.find((s) => s.id === "battlerage_tiger_strike_lightning");
        const tsLife = brSkills.find((s) => s.id === "battlerage_tiger_strike_earth");
        assert(tsLight.name === "Tiger Strike (Lightning)" && tsLight.icon === "icon_skill_fight38.png", "Tiger Strike (Lightning) has exact name & icon");
        assert(tsLife.name === "Tiger Strike (Life)" && tsLife.icon === "icon_skill_fight39.png", "Tiger Strike (Life) has exact name & Life icon");

        const psLight = brSkills.find((s) => s.id === "battlerage_precision_strike_lightning");
        const psGale = brSkills.find((s) => s.id === "battlerage_precision_strike_gale");
        assert(psLight.icon === "icon_skill_fight36.png" && psLight.flags?.executeCritRateBonusPct === 34, "Precision Strike (Lightning) uses blue lightning icon (fight36) & <30% HP crit bonus");
        assert(psGale.icon === "icon_skill_fight37.png" && psGale.flags?.backstabCritRateBonusPct === 34, "Precision Strike (Gale) uses green wind icon (fight37) & backstab / kill reset");

        const ssGale = defSkills.find((s) => s.id === "defense_shield_slam_quick");
        const ssQuake = defSkills.find((s) => s.id === "defense_shield_slam_arc");
        assert(ssGale.name === "Shield Slam (Gale)" && ssGale.icon === "icon_skill_adamant33.png", "Shield Slam (Gale) matches Skill Builder");
        assert(ssQuake.name === "Shield Slam (Quake)" && ssQuake.icon === "icon_skill_adamant34.png", "Shield Slam (Quake) matches Skill Builder");

        // Runtime sync helper overrides drifted names/icons cleanly from Skill Builder data
        const drifted = [
            { id: "defense_shield_slam_quick", variant: "ancestral", name: "Shield Slam (Old Name)", icon: "wrong.png" },
            { id: "vitalism_antithesis_wave_heal", variant: "ancestral", name: "Antithesis (Old · AoE Heal)", icon: "wrong.png" },
        ];
        const syncedCnt = syncSkillBreakdownAncestralsFromBuilder(drifted, sbData);
        assert(syncedCnt === 2, "syncSkillBreakdownAncestralsFromBuilder synced both drifted entries");
        assert(drifted[0].name === "Shield Slam (Gale)" && drifted[0].icon === "icon_skill_adamant33.png", "Sync restores Shield Slam (Gale) name & icon");
        assert(drifted[1].name === "Antithesis (Quake · AoE Heal)" && drifted[1].icon === "icon_skill_love34.png", "Sync preserves role suffix (AoE Heal) while restoring Quake element & icon");

        // Thwart / Inspired (Hearten) 1-3 stacks (#127) and Drum Buff "To the arena!" (#5700)
        const baseDummy = createDefaultCharacter();
        const thw1 = applyModifiers(baseDummy, ["inspired_thwart:1"]);
        const thw3 = applyModifiers(baseDummy, ["inspired_thwart:3"]);
        assertApprox(thw1.offense.attackSpeed - baseDummy.offense.attackSpeed, 53, 0.01, "Thwart / Inspired 1 stack grants +53 Attack Speed");
        assertApprox(thw3.offense.attackSpeed - baseDummy.offense.attackSpeed, 159, 0.01, "Thwart / Inspired 3 stacks grants +159 Attack Speed");
        assert(findModifierForDaruGearBuff({ id: 127, name: "Inspired" })?.id === "inspired_thwart", "DaruGear buff #127 resolves to inspired_thwart");

        const drummed = applyModifiers(baseDummy, ["drum_to_the_arena_5700"]);
        assertApprox(drummed.offense.meleeAttack - baseDummy.offense.meleeAttack, 5, 0.01, "Drum buff (#5700) grants +5 Melee Attack");
        assertApprox(drummed.offense.rangedAttack - baseDummy.offense.rangedAttack, 5, 0.01, "Drum buff (#5700) grants +5 Ranged Attack");
        assertApprox(drummed.offense.magicAttack - baseDummy.offense.magicAttack, 5, 0.01, "Drum buff (#5700) grants +5 Magic Attack");
        assertApprox(drummed.defense.receivedMeleeDrPct - baseDummy.defense.receivedMeleeDrPct, 2, 0.01, "Drum buff (#5700) grants +2% Melee DR");
        assertApprox(drummed.defense.receivedRangedDrPct - baseDummy.defense.receivedRangedDrPct, 2, 0.01, "Drum buff (#5700) grants +2% Ranged DR");
        assertApprox(drummed.defense.receivedMagicDrPct - baseDummy.defense.receivedMagicDrPct, 2, 0.01, "Drum buff (#5700) grants +2% Magic DR");
        assert(findModifierForDaruGearBuff({ id: 5700, name: "To the arena!" })?.id === "drum_to_the_arena_5700", "DaruGear buff #5700 resolves to drum_to_the_arena_5700");
    });

    // 37. Reliability & Security Guards: Sweep Point Cap, Formula Override Clamping & Live Curve Propagation
    await test("Sweep point cap prevents browser freeze, formula overrides clamp K >= 1, and curve helpers follow live overrides", () => {
        const a = createDefaultCharacter({ name: "Sample A", offense: { meleeAttack: 1100 } });
        const b = createDefaultCharacter({ name: "Sample B", offense: { meleeAttack: 1000, defensePenetration: 2000 } });
        const def = createDefaultCharacter({ name: "Sample Def", defense: { physicalDefense: 8000 } });
        const dummySkill = {
            id: "test_strike",
            name: "Test Strike",
            skillset: "battlerage",
            kind: "damage",
            damageType: "physical",
            scalingStat: "meleeAttack",
            base: 500,
            scalingPct: 200,
        };

        // 1. Extreme sweep range (step=1 across 0..24000) is capped cleanly <= 251 points
        const cappedOff = sweepDefenderStat(a, b, def, dummySkill, {
            stat: "physicalDefense",
            start: 0,
            end: 24000,
            step: 1,
        });
        assert(cappedOff.points.length >= 2 && cappedOff.points.length <= 251, `Offense sweep capped to ${cappedOff.points.length} points (<= 251)`);

        const cappedDef = sweepDefenderEhp(def, def, a, {
            stat: "aggressorDefPen",
            ehpKind: "melee",
            start: 0,
            end: 100000,
            step: 1,
        });
        assert(cappedDef.points.length >= 2 && cappedDef.points.length <= 251, `Defender EHP sweep capped to ${cappedDef.points.length} points (<= 251)`);

        // 2. Live formula overrides propagate to standalone curve helpers (used by Character Cards & KPIs)
        try {
            setRuntimeConstantsOverrides({
                defenseK: 5000,
                toughnessK: 4000,
                resilienceCritRateK: 16000,
                resilienceCritBonusK: 9000,
            });
            assertApprox(defenseMitigationPct(5000), 50.0, 0.001, "defenseMitigationPct reflects live defenseK override (5000/(5000+5000) = 50%)");
            assertApprox(toughnessMitigationPct(4000), 50.0, 0.001, "toughnessMitigationPct reflects live toughnessK override");
            assertApprox(resilienceCritRateReductionPct(16000), 50.0, 0.001, "resilienceCritRateReductionPct reflects live override");
            assertApprox(resilienceCritBonusReductionPct(9000), 50.0, 0.001, "resilienceCritBonusReductionPct reflects live override");

            // 3. Zero / negative K overrides are clamped safely (>= 1) and never produce NaN or Infinity
            setRuntimeConstantsOverrides({
                defenseK: 0,
                toughnessK: -500,
                resilienceCritRateK: -10,
                resilienceCritBonusK: 0,
                shieldBlockDamageMultiplier: 5,
            });
            assert(Number.isFinite(defenseMitigationPct(0)) && defenseMitigationPct(0) === 0, "defenseK=0 clamped safely (no NaN at 0 def)");
            assert(Number.isFinite(toughnessMitigationPct(1000)) && toughnessMitigationPct(1000) > 0, "Negative toughnessK clamped safely");
            assert(Number.isFinite(resilienceCritRateReductionPct(1000)), "Negative resilienceCritRateK clamped safely");
            assert(Number.isFinite(resilienceCritBonusReductionPct(0)), "Zero resilienceCritBonusK clamped safely");
            const clampedSim = simulateSkillDamage(a, def, dummySkill);
            assert(Number.isFinite(clampedSim.expected) && clampedSim.expected > 0, "simulateSkillDamage remains finite under extreme overrides");
        } finally {
            setRuntimeConstantsOverrides({});
        }

        // 4. Armor type detection (inferBuildArmorType) for Plate / Leather / Cloth buff variants
        const plateChar = createDefaultCharacter({
            equipment: [
                { slotId: 1, type: "Plate", name: "Ayanad Lake Helm" },
                { slotId: 2, type: "Plate", name: "Ayanad Lake Cuirass" },
                { slotId: 7, type: "Plate", name: "Ayanad Lake Greaves" },
                { slotId: 8, type: "Cloth", name: "Cloth Shoes" },
            ],
        });
        const leatherChar = createDefaultCharacter({
            equipment: [
                { slotId: 2, type: "Leather", name: "Ayanad Flame Jerkin" },
                { slotId: 7, type: "Leather", name: "Ayanad Flame Breeches" },
            ],
        });
        const clothChar = createDefaultCharacter({
            equipment: [
                { slotId: 2, type: "Cloth", name: "Ayanad Wave Shirt" },
                { slotId: 7, type: "Cloth", name: "Ayanad Wave Pants" },
            ],
        });
        const unequippedPlate = createDefaultCharacter({ defense: { physicalDefense: 12000, magicDefense: 4000 } });
        const unequippedCloth = createDefaultCharacter({ defense: { physicalDefense: 4000, magicDefense: 11000 } });
        const explicitArmor = createDefaultCharacter({ metadata: { armorType: "leather" }, defense: { physicalDefense: 15000, magicDefense: 2000 } });
        assert(inferBuildArmorType(plateChar) === "plate", "inferBuildArmorType detects Plate majority from equipment");
        assert(inferBuildArmorType(leatherChar) === "leather", "inferBuildArmorType detects Leather majority from equipment");
        assert(inferBuildArmorType(clothChar) === "cloth", "inferBuildArmorType detects Cloth majority from equipment");
        assert(inferBuildArmorType(unequippedPlate) === "plate", "inferBuildArmorType falls back to Plate from high PDef/MDef ratio");
        assert(inferBuildArmorType(unequippedCloth) === "cloth", "inferBuildArmorType falls back to Cloth from high MDef/PDef ratio");
        assert(inferBuildArmorType(explicitArmor) === "leather", "inferBuildArmorType respects explicit metadata.armorType override");
        const customArchChar = createDefaultCharacter({ metadata: { category: "raid_bard" } });
        assert(inferBuildCategory(customArchChar) === "raid_bard", "inferBuildCategory respects custom user-added archetype slugs");
    });

    // 38. Economy Engine: Gear Tier × Grade Classification, Helmet Toughness Gems, Overrides & Build Cost Comparison
    await test("Economy estimator prices Legendary T7 Obsidian weapons, Helmet Toughness gems, lunafrosts, and custom overrides accurately", () => {
        const pb = createDefaultEconomyPriceBook();
        const mockCatalog = {
            weapons: [{ name: "Razor Visage", level: 64 }],
            armors: [{ name: "Ayanad Lake Helm", level: 62 }],
            accessories: [],
        };

        const expensiveBuild = createDefaultCharacter({
            name: "Sample High-End Build",
            gearScore: 7000,
            equipment: [
                {
                    slotId: 15,
                    slotName: "Right Hand Weapon",
                    type: "Nodachi",
                    name: "Razor Visage",
                    gradeName: "Legendary",
                    lunafrost: { name: "Erenor Earth Lunafrost", text: "Max Health +335" },
                    lunagems: [
                        { name: "Lucid Gale Lunagem: Focus", text: "Focus +480" },
                        { name: "Lucid Gale Lunagem: Focus", text: "Focus +480" },
                    ],
                },
                {
                    slotId: 1,
                    slotName: "Head",
                    type: "Plate",
                    name: "Ayanad Lake Helm",
                    gradeName: "Epic",
                    lunagems: [
                        { name: "Vivid Earth Lunascale: Mastery", text: "Toughness 176.0" },
                        { name: "Vivid Earth Lunascale: Mastery", text: "Toughness 176.0" },
                    ],
                },
                {
                    slotId: 19,
                    slotName: "Glider",
                    type: "Glider",
                    name: "Enhanced Ezi's Glider: Speed",
                    gradeName: "Unique",
                    lunagems: [],
                },
            ],
        });

        const budgetBuild = createDefaultCharacter({
            name: "Sample Budget Build",
            gearScore: 5500,
            equipment: [
                {
                    slotId: 15,
                    slotName: "Right Hand Weapon",
                    type: "Nodachi",
                    name: "Delphinad Flame Nodachi",
                    gradeName: "Divine",
                    lunagems: [],
                },
            ],
        });

        assert(
            classifyGearItemTier(expensiveBuild.equipment[0], new Map([["razor visage", 64]])) === "obsidian_t7_weapon",
            "Lv 64 Razor Visage classifies as obsidian_t7_weapon"
        );
        assert(
            classifyLunagemGroup({ name: "Vivid Earth Lunascale: Mastery", text: "Toughness 176.0" }, "Head") === "helmet_toughness",
            "Head Toughness lunascale classifies as helmet_toughness"
        );

        const estExp = estimateBuildCost(expensiveBuild, pb, mockCatalog);
        assert(estExp.pieceCount === 2 && !estExp.slotBreakdown.some((s) => s.slotId === 19), "Glider slot (19) is excluded from build cost breakdown and total");
        // Razor Visage Legendary (600,000) + Ayanad Armor Epic (48,000) = 648,000 base
        assert(estExp.baseGearGold === 648000, `Expected 648,000g base gear, got ${estExp.baseGearGold}`);
        // 2x Focus T3 (6,500 * 2 = 13,000) + 2x Helmet Toughness (100,000 * 2 = 200,000) = 213,000 gems
        assert(estExp.lunagemsGold === 213000, `Expected 213,000g lunagems, got ${estExp.lunagemsGold}`);
        // 1x Erenor Frost = 12,000
        assert(estExp.lunafrostsGold === 12000, `Expected 12,000g lunafrosts, got ${estExp.lunafrostsGold}`);
        assert(estExp.totalGold === 873000, `Expected 873,000g total, got ${estExp.totalGold}`);

        // Custom per-item & per-gem overrides take precedence
        const customPb = {
            ...pb,
            itemOverrides: { "Razor Visage|Legendary": 750000 },
            gemOverrides: { "Vivid Earth Lunascale: Mastery|Head": 125000 },
        };
        const estCustom = estimateBuildCost(expensiveBuild, customPb, mockCatalog);
        assert(estCustom.baseGearGold === 798000, `Custom item override applied (750k + 48k = 798k), got ${estCustom.baseGearGold}`);
        assert(estCustom.lunagemsGold === 263000, `Custom gem override applied (250k + 13k = 263k), got ${estCustom.lunagemsGold}`);

        const cmp = compareBuildEconomy(expensiveBuild, budgetBuild, null, pb, mockCatalog);
        assert(cmp.cheaper === "B" && cmp.deltaGold > 800000, "compareBuildEconomy identifies budget build as cheaper");

        // Bound quest accessories default to 0g
        const questAccBuild = createDefaultCharacter({
            name: "Quest Accessories",
            equipment: [
                { slotId: 12, slotName: "Ring", name: "Holy Ynys Guardian Ring", gradeName: "Epic" },
                { slotId: 13, slotName: "Ring", name: "Flawless Dream Ring", gradeName: "Celestial" },
                { slotId: 14, slotName: "Neck", name: "Archeum Evernight Necklace (Rank 12)", gradeName: "Legendary" },
                { slotId: 14, slotName: "Neck", name: "Archeum Daeier Necklace (Rank 11)", gradeName: "Epic" },
                { slotId: 10, slotName: "Earring", name: "Carmila's Memory", gradeName: "Epic" },
            ],
        });
        const estQuest = estimateBuildCost(questAccBuild, pb, mockCatalog);
        assert(
            estQuest.baseGearGold === 0 && estQuest.totalGold === 0 && estQuest.slotBreakdown.every((s) => s.tierId === "quest_accessory" && s.baseGold === 0),
            `Expected all quest accessories (Ynys, Dream Ring, Evernight, Daeier, Carmila's Memory) to default to 0g, got ${estQuest.totalGold}`
        );
    });

    // 39. Economy AH Market Integration: sermeatball.com Price Layering, Grade Safety & Manual Override Priority
    await test("Economy AH price layer applies scraped lunagems/frosts/grade-safe gear while preserving manual overrides", () => {
        const pb = createDefaultEconomyPriceBook();
        const mockAh = {
            source: "sermeatball.com",
            syncedAt: "2026-11-24T00:00:00Z",
            gems: {
                "Lucid Wave Lunagem: Defense": { g: 1026, id: 101, src: "30d", v30: 276 },
            },
            frosts: {
                "Flawless Assassin's Lunafrost": { g: 341, id: 102, src: "30d", v30: 19 },
            },
            items: {
                "Ayanad Earth Greaves": { g: 48750, id: 201, src: "30d", v30: 2 },
                "Auroria Wildborn Boots": { g: 36, id: 202, src: "30d", v30: 7 },
                "Healing Black Cat Undergarments": { g: 401, id: 203, src: "30d", v30: 5 },
                "Searing Oath": { g: 1357, id: 204, src: "30d", v30: 16 },
            },
        };

        // Grade safety checks
        assert(
            shouldAutoApplyAhGearPrice({ slotId: 7, gradeName: "Epic" }, { gold: 48750 }, 48000) === true,
            "Epic Ayanad armor AH price (48,750g) auto-applies"
        );
        assert(
            shouldAutoApplyAhGearPrice({ slotId: 8, gradeName: "Legendary" }, { gold: 36 }, 95000) === false,
            "Low-grade Auroria AH avg (36g) is safely skipped for Legendary piece"
        );
        assert(
            shouldAutoApplyAhGearPrice({ slotId: 9, gradeName: "Mythic" }, { gold: 401 }, 65000) === false,
            "Un-synthesized undergarment AH avg (401g) is safely skipped for Mythic undergarments"
        );
        assert(
            shouldAutoApplyAhGearPrice({ slotId: 15, gradeName: "Heroic" }, { gold: 1357 }, 35750) === true,
            "Heroic boss drop AH price (1,357g) auto-applies for Heroic grade"
        );

        const sampleBuild = createDefaultCharacter({
            name: "AH Test Build",
            equipment: [
                {
                    slotId: 7,
                    slotName: "Legs",
                    type: "Plate",
                    name: "Ayanad Earth Greaves",
                    gradeName: "Epic",
                    lunafrost: { name: "Flawless Assassin's Lunafrost", text: "Melee Crit +2%" },
                    lunagems: [
                        { name: "Lucid Wave Lunagem: Defense", text: "Physical Defense +220" },
                        { name: "Lucid Wave Lunagem: Defense", text: "Physical Defense +220" },
                    ],
                },
                {
                    slotId: 9,
                    slotName: "Undergarments",
                    type: "Undergarments",
                    name: "Healing Black Cat Undergarments",
                    gradeName: "Mythic",
                    lunagems: [],
                },
            ],
        });

        const estAh = estimateBuildCost(sampleBuild, pb, null, mockAh);
        // Ayanad Earth Greaves uses AH 48,750g; Mythic Undergarments skips 401g AH and keeps tier default 65,000g
        assert(estAh.baseGearGold === 48750 + 65000, `Expected 113,750g base gear with AH, got ${estAh.baseGearGold}`);
        assert(estAh.lunagemsGold === 2052, `Expected 2x 1,026g = 2,052g AH lunagems, got ${estAh.lunagemsGold}`);
        assert(estAh.lunafrostsGold === 341, `Expected 341g AH lunafrost, got ${estAh.lunafrostsGold}`);
        assert(estAh.slotBreakdown[0].isAhItem === true, "Ayanad Earth Greaves marked as AH-priced");
        assert(estAh.slotBreakdown[1].ahInfo?.gradeSkipped === true, "Mythic Undergarments marked gradeSkipped with AH ref");

        // Manual overrides take priority over AH prices
        const ovPb = {
            ...pb,
            itemOverrides: { "Ayanad Earth Greaves|Epic": 55000 },
            gemOverrides: { "Lucid Wave Lunagem: Defense|Legs": 1500 },
        };
        const estOv = estimateBuildCost(sampleBuild, ovPb, null, mockAh);
        assert(estOv.baseGearGold === 55000 + 65000, "Manual item override wins over AH price");
        assert(estOv.lunagemsGold === 3000, "Manual gem override wins over AH price");

        // useAhPrices: false cleanly falls back to Tier/Group defaults
        const noAhEst = estimateBuildCost(sampleBuild, { ...pb, useAhPrices: false }, null, mockAh);
        assert(noAhEst.baseGearGold === 48000 + 65000, "Disabling useAhPrices falls back to tier matrix");
        assert(noAhEst.lunagemsGold === 9000, "Disabling useAhPrices falls back to gem group defaults (2x 4,500g)");
        assert(noAhEst.lunafrostsGold === 4000, "Disabling useAhPrices falls back to frost group default (4,000g)");
    });

    // 40. Gear Builder Exact itemId & Persisted baseAttributes (Stat Migration Accuracy)
    await test("Gear Builder preserves exact Stat Migration via baseAttributes, matches duplicate Obsidian items by itemId, and strips baked Spirit Growth in fallback", async () => {
        const catalog = await loadGearCatalog();
        assert(catalog && catalog.itemById.has(40668) && catalog.itemById.has(40671), "Catalog contains duplicate-name Illion Helm variants 40668 and 40671");

        // 1. Exact itemId selects 40671 (30/70 STR/STA + Max Health) instead of first name match 40668 (75/25 STR/STA + Melee Atk)
        const charWithIds = createDefaultCharacter({
            name: "Obsidian Variant Test",
            baseAttributes: { str: 158, agi: 8, sta: 458, int: 8, spi: 158 },
            attributes: { str: 218, agi: 8, sta: 598, int: 8, spi: 158 },
            equipment: [
                { slotId: 1, slotName: "Head", itemId: 40671, name: "Illion Helm", type: "Plate", gradeId: 10, gradeName: "Legendary" },
            ],
        });
        const rec = ensureCharacterRawDaruGear(charWithIds, catalog);
        const headSlot = rec.slots.find((s) => Number(s.id) === 1);
        assert(headSlot?.item?.equipment?.id === 40671, `Expected exact Illion Helm variant 40671, got ${headSlot?.item?.equipment?.id}`);
        const mig = getPlayerStatMigration(rec.player);
        assert(
            mig.deltas.str === 0 && mig.deltas.agi === -150 && mig.deltas.sta === 300 && mig.deltas.int === -150 && mig.deltas.spi === 0 && mig.net === 0,
            `Expected exact balanced migration (AGI -150, STA +300, INT -150), got ${JSON.stringify(mig.deltas)}`
        );

        // 2. Recalculating from Gear Builder preserves baseAttributes on the returned character
        const { character: afterRecalc } = recalculateCharacterFromGearBuilder(charWithIds, rec.slots, rec.player, catalog);
        assert(
            afterRecalc.baseAttributes?.str === 158 && afterRecalc.baseAttributes?.sta === 458 && afterRecalc.baseAttributes?.agi === 8,
            `recalculateCharacterFromGearBuilder preserved baseAttributes: ${JSON.stringify(afterRecalc.baseAttributes)}`
        );

        // 3. Legacy fallback (no baseAttributes) strips baked Spirit Growth (+9% SPI) before inferring migration
        const legacyHealer = createDefaultCharacter({
            name: "Legacy Healer Fallback",
            attributes: { str: 8, agi: 158, sta: 158, int: 8, spi: Math.round(458 * 1.09) },
            skillBuild: { trees: ["vitalism", "songcraft", "auramancy"], passives: ["Spirit Growth"], bakedPassives: ["Spirit Growth"] },
            equipment: [
                { slotId: 19, slotName: "Back", name: "Glider Companion: Sloth", type: "Glider", gradeId: 0, gradeName: "Crude" },
            ],
        });
        const recLegacy = ensureCharacterRawDaruGear(legacyHealer, catalog);
        const legMig = getPlayerStatMigration(recLegacy.player);
        assert(
            legMig.deltas.spi === 300 && legMig.net === 0,
            `Legacy fallback with Spirit Growth inferred exact +300 SPI migration (net 0), got spi=${legMig.deltas.spi}, net=${legMig.net}`
        );
    });

    // 41. All-vs-All Matrix Healing Output ("Biggest Ode") & Heal-Combo Scoring Fix
    await test("All-vs-All Matrix Healing Output ranks Biggest Ode accurately by healing power/crit & ally received healing, and scores heal combos as % HP instead of 0% kill", () => {
        const odeSkill = findSkill(songcraft, "songcraft_ode_to_recovery");
        const bigHealer = createDefaultCharacter({
            name: "Big Ode Healer",
            maxHealth: 26000,
            offense: { healingPower: 1600, healCritRatePct: 60, healCritBonusPct: 140, healingPct: 10 },
            defense: { receivedHealingPct: 5 },
        });
        const midHealer = createDefaultCharacter({
            name: "Mid Healer",
            maxHealth: 28000,
            offense: { healingPower: 1100, healCritRatePct: 40, healCritBonusPct: 110, healingPct: 4 },
            defense: { receivedHealingPct: 0 },
        });
        const recvTank = createDefaultCharacter({
            name: "High Recv Heal Tank",
            maxHealth: 42000,
            offense: { healingPower: 50, meleeAttack: 500 },
            defense: { receivedHealingPct: 20 },
        });

        const entries = [
            { id: "big", name: "Big Ode Healer", character: bigHealer, role: "healer" },
            { id: "mid", name: "Mid Healer", character: midHealer, role: "healer" },
            { id: "tank", name: "High Recv Heal Tank", character: recvTank, role: "tank" },
        ];

        const odeMat = computeAllVsAllMatrix(entries, {
            metric: "healing_output",
            hitMode: "expected",
            healSkill: odeSkill,
        });
        assert(odeMat.rows[0].avgScore > odeMat.rows[1].avgScore && odeMat.rows[1].avgScore > odeMat.rows[2].avgScore,
            `Biggest Ode ranks Big Healer (${Math.round(odeMat.rows[0].avgScore)}/s) > Mid Healer (${Math.round(odeMat.rows[1].avgScore)}/s) > Tank (${Math.round(odeMat.rows[2].avgScore)}/s)`
        );
        // Ally with +20% Received Healing receives 1.2x larger Ode tick than ally with 0% Received Healing
        const odeOnTank = odeMat.rows[0].cells[2].primaryVal;
        const odeOnMid = odeMat.rows[0].cells[1].primaryVal;
        assertApprox(odeOnTank / odeOnMid, 1.2, 1e-4, "Ally with +20% Received Healing receives exactly 1.2x Ode tick");
        assertApprox(odeMat.rows[0].cells[2].fullDurHeal, odeOnTank * 15, 0.5, "Full 15s Ode song total equals 15 × per-sec tick");

        // Saved Combo with a Heal combo must score % Ally HP (> 0), NOT 0% kill chance!
        const healCombo = {
            id: "test_heal_combo",
            label: "Healer Save",
            steps: [
                { skill: findSkill(vitalism, "vitalism_antithesis_heal") },
                { skill: findSkill(vitalism, "vitalism_fervent_healing") },
            ],
        };
        const hcMat = computeAllVsAllMatrix(
            entries.map((e) => ({ ...e, combo: healCombo })),
            { metric: "saved_combo", hitMode: "expected" }
        );
        assert(hcMat.rows[0].isHealRow === true, "Heal combo row flagged as isHealRow");
        assert(hcMat.rows[0].cells[0].isHealCombo === true && hcMat.rows[0].cells[0].outcome === "heal", "Heal combo cell uses heal outcome (not loss)");
        assert(hcMat.rows[0].avgScore > 30, `Heal combo avgScore reports positive % HP healed (got ${hcMat.rows[0].avgScore.toFixed(1)}%), not 0% kill`);
    });

    // 42. Gold-per-+1%-Gain Upgrade Advisor & Anti-Heal Matrix Context
    await test("Economy Upgrade Advisor ranks upgrades by cheapest Gold per +1% gain across EHP/Ode/Skill goals, and Anti-Heal scales Healing Output Matrix", () => {
        const pb = createDefaultEconomyPriceBook();
        const mockAh = {
            gems: {
                "Radiant Earth Lunagem: Mastery": { g: 10, id: 1, src: "30d" },
                "Lucid Wave Lunagem: Defense": { g: 1025, id: 2, src: "30d" },
                "Lucid Gale Lunagem: Mercy": { g: 1326, id: 3, src: "30d" },
                "Lucid Gale Lunagem: Benevolence": { g: 652, id: 4, src: "30d" },
            },
            frosts: {},
            items: {},
        };

        const healer = createDefaultCharacter({
            name: "Advisor Healer",
            maxHealth: 28000,
            offense: { healingPower: 1200, healCritRatePct: 50, healCritBonusPct: 120, healingPct: 5 },
            defense: { physicalDefense: 10000, magicDefense: 14000, toughness: 3500, resilience: 4500, blockPct: 10, hasShield: true, receivedHealingPct: 10 },
            equipment: [
                { slotId: 15, slotName: "Right Hand Weapon", name: "Ayanad Life Club", type: "Club", gradeName: "Epic" },
            ],
        });
        const meleeAtt = createDefaultCharacter({
            name: "Advisor Attacker",
            maxHealth: 30000,
            offense: { meleeAttack: 1300, defensePenetration: 2000, meleeCritRatePct: 50, meleeCritBonusPct: 160, focus: 3500 },
            defense: { receivedHealingPct: 10 },
        });

        // 1. Melee EHP advisor: sorted strictly ascending by goldPer1Pct; cheap Radiant Toughness (10g AH) beats Helmet Toughness (100,000g)
        const ehpAdv = computeGoldEfficiencyUpgrades(healer, meleeAtt, pb, null, mockAh, { goal: "melee_ehp" });
        assert(ehpAdv.items.length >= 4, `Expected >= 4 EHP upgrades, got ${ehpAdv.items.length}`);
        for (let i = 1; i < ehpAdv.items.length; i++) {
            assert(ehpAdv.items[i].goldPer1Pct >= ehpAdv.items[i - 1].goldPer1Pct - 1e-6, "Advisor items sorted ascending by goldPer1Pct");
        }
        assert(
            ehpAdv.items[0].id === "gem_tough_body" && ehpAdv.items[0].priceSource === "ah",
            `Cheapest EHP upgrade uses AH Radiant Toughness (10g), got ${ehpAdv.items[0]?.id} (${ehpAdv.items[0]?.priceSource})`
        );

        // 2. Biggest Ode advisor includes Benevolence, Mercy, and Epic->Legendary Weapon regrade
        const odeSkill = findSkill(songcraft, "songcraft_ode_to_recovery");
        const odeAdv = computeGoldEfficiencyUpgrades(healer, meleeAtt, pb, null, mockAh, { goal: "ode_heal", skill: odeSkill });
        assert(
            odeAdv.items.some((x) => x.id === "gem_heal_cd") &&
                odeAdv.items.some((x) => x.id === "gem_heal_pwr") &&
                odeAdv.items.some((x) => x.kind === "regrade"),
            "Ode advisor includes heal crit gem, healing power gem, and weapon grade regrade"
        );

        // 3. Anti-Heal context (-60% Stalker's Mark) reduces Healing Output Matrix ticks accurately (1.10 -> 0.50 received mult)
        const baseOde = computeAllVsAllMatrix(
            [{ id: "h", name: "Healer", character: healer, role: "healer" }],
            { metric: "healing_output", hitMode: "expected", healSkill: odeSkill, context: {} }
        );
        const stalkerOde = computeAllVsAllMatrix(
            [{ id: "h", name: "Healer", character: healer, role: "healer" }],
            { metric: "healing_output", hitMode: "expected", healSkill: odeSkill, context: { antiHealPct: -60 } }
        );
        assertApprox(
            stalkerOde.rows[0].avgScore / baseOde.rows[0].avgScore,
            0.5 / 1.1,
            1e-4,
            "Stalker's Mark (-60% anti-heal) scales +10% Recv Heal ally Ode output by exact 0.50 / 1.10 ratio"
        );
    });

    // 43. Security Hardening & Bug-Fix Regressions
    await test("Security hardening blocks bad custom buff IDs, prototype keys & untrusted icon URLs; custom categories & advisor filters behave accurately", () => {
        // 1. registerCustomModifiers rejects XSS-like IDs and prototype keys
        const badMods = registerCustomModifiers([
            { id: 'evil" onmouseover="alert(1)', name: "Bad", side: "attacker" },
            { id: "__proto__", name: "Proto", side: "attacker" },
            { id: "constructor", name: "Ctor", side: "attacker" },
            { id: "valid_custom_buff_99", name: "Valid Custom", side: "attacker", addOffense: { meleeAttack: 10 } },
        ]);
        assert(badMods.length === 1 && badMods[0].id === "valid_custom_buff_99", `Expected only 1 valid custom buff registered, got ${badMods.length}`);
        assert(!Object.prototype.hasOwnProperty.call(COMBAT_MODIFIERS, 'evil" onmouseover="alert(1)'), "XSS-like modifier ID rejected");
        unregisterCustomModifier("valid_custom_buff_99");

        // 2. normalizeEconomyPriceBook ignores prototype-pollution keys
        const cleanPb = normalizeEconomyPriceBook({
            itemOverrides: JSON.parse('{"__proto__": 123, "constructor": 456, "Ayanad Sword|Epic": 50000}'),
        });
        assert(!Object.prototype.hasOwnProperty.call(cleanPb.itemOverrides, "__proto__"), "__proto__ override stripped");
        assert(!Object.prototype.hasOwnProperty.call(cleanPb.itemOverrides, "constructor"), "constructor override stripped");
        assert(cleanPb.itemOverrides["Ayanad Sword|Epic"] === 50000, "Valid item override preserved");

        // 3. resolveGearIconUrl allows local & trusted game hosts, rejects untrusted external hosts & javascript:
        assert(resolveGearIconUrl("assets/icons/foo.png") === "assets/icons/foo.png", "Local icon allowed");
        assert(resolveGearIconUrl("https://darugear.com/assets/icons/foo.png").startsWith("https://darugear.com/"), "darugear.com icon allowed");
        assert(resolveGearIconUrl("https://evil.example/tracker.png") === "", "Untrusted external icon host blocked");
        assert(resolveGearIconUrl("javascript:alert(1)") === "", "javascript: icon URL blocked");

        // 4. normalizeBuildMetadata preserves custom build category slugs
        const customMeta = normalizeBuildMetadata({ category: "raid_bard", name: "Bard" });
        assert(customMeta.category === "raid_bard", `Custom build category preserved (got ${customMeta.category})`);
        const badMeta = normalizeBuildMetadata({ category: "__proto__" });
        assert(!badMeta.category, "Forbidden category key rejected");

        // 5. Upgrade Advisor skips already-equipped unique single-slot frosts & won't recommend melee sword regrade for Ode
        const swordTank = createDefaultCharacter({
            name: "Sword Tank",
            maxHealth: 30000,
            offense: { meleeAttack: 1100, healingPower: 300 },
            defense: { physicalDefense: 12000, magicDefense: 10000, toughness: 3500, resilience: 4500, blockPct: 15, hasShield: true },
            equipment: [
                { slotId: 2, slotName: "Chest", name: "Obsidian Cuirass", type: "Plate", gradeName: "Epic", lunafrost: { name: "Honorbold Warrior's Lunafrost" } },
                { slotId: 15, slotName: "Right Hand Weapon", name: "Ayanad Flame Sword", type: "Sword", gradeName: "Epic" },
                { slotId: 16, slotName: "Left Hand Weapon", name: "Obsidian Shield", type: "Shield", gradeName: "Epic", lunafrost: { name: "Whole Barrier Lunafrost" } },
            ],
        });
        const pb = createDefaultEconomyPriceBook();
        const ehpAdv = computeGoldEfficiencyUpgrades(swordTank, swordTank, pb, null, null, { goal: "melee_ehp" });
        assert(!ehpAdv.items.some((x) => x.id === "frost_chest_dr"), "Already-equipped Honorbold Warrior's Lunafrost is skipped");
        assert(!ehpAdv.items.some((x) => x.id === "frost_block"), "Already-equipped Whole Barrier Lunafrost is skipped");

        const odeSkill = findSkill(songcraft, "songcraft_ode_to_recovery");
        const odeAdv = computeGoldEfficiencyUpgrades(swordTank, swordTank, pb, null, null, { goal: "ode_heal", skill: odeSkill });
        assert(!odeAdv.items.some((x) => x.kind === "regrade"), "Melee Sword regrade is NOT recommended for Biggest Ode");
    });

    // 44. GitHub Pages Example Builds Manifest & Anonymized Gear Integrity
    await test("example-builds/ manifest loads all 5 anonymized starter archetypes with valid Gear Builder & Economy coverage", async () => {
        const idxRes = await fetch("../example-builds/_index.json", { cache: "no-store" });
        assert(idxRes.ok, "example-builds/_index.json should be served cleanly");
        const idx = await idxRes.json();
        assert(Array.isArray(idx.files) && idx.files.length === 5, `Expected 5 example build files, got ${idx.files?.length}`);

        const catalog = await loadGearCatalog("../js/data/gear_catalog");
        const pb = createDefaultEconomyPriceBook();
        const seenCats = new Set();

        for (const fname of idx.files) {
            const res = await fetch(`../example-builds/${fname}`, { cache: "no-store" });
            assert(res.ok, `Failed loading example-builds/${fname}`);
            const raw = await res.json();
            assert(
                raw.isExample === true || String(raw.name || "").startsWith("Example:"),
                `${fname} identified as example build`
            );
            assert(!raw.shareCode && !raw.darugearUrl && !raw.shareUrl, `${fname} contains zero personal DaruGear links/codes`);

            const parsed = parseImportPayload(raw);
            assert(parsed.ok, `parseImportPayload succeeded for ${fname}`);
            const cat = inferBuildCategory(parsed.character);
            seenCats.add(cat);

            const cost = estimateBuildCost(parsed.character, pb, catalog, null);
            assert(cost.totalGold > 50000, `${fname} has positive Economy estimate (got ${cost.totalGold}g)`);

            const { slots, player } = ensureCharacterRawDaruGear(parsed.character, catalog);
            const recalc = recalculateCharacterFromGearBuilder(parsed.character, slots, player, catalog);
            assert(recalc.character.maxHealth > 15000 && recalc.character.gearScore > 4000, `${fname} reconstructs cleanly in Gear Builder (HP=${recalc.character.maxHealth}, GS=${recalc.character.gearScore})`);
        }

        for (const reqCat of ["melee", "mage", "archer", "healer", "tank"]) {
            assert(seenCats.has(reqCat), `example-builds/ covers archetype "${reqCat}"`);
        }
    });

    // 45. Gods' Whip Inherent Off-GCD, Rotation Random/Proc Debuffs (Delirium Bleed / Puncture), Fine-Grained Delay & Travel Time
    await test("Gods' Whip inherent Off-GCD, rotation & per-step random debuffs (Delirium Bleed / Puncture), fine-grained delay & travel time", () => {
        const godsWhip = findSkill(sorcery, "sorcery_gods_whip");
        const flamebolt = findSkill(sorcery, "sorcery_flamebolt");
        const freezingEarth = findSkill(sorcery, "sorcery_freezing_earth");
        const tripleSlash = findSkill(battlerage, "battlerage_triple_slash");
        const precStrike = findSkill(battlerage, "battlerage_precision_strike");

        const att = createDefaultCharacter({
            offense: { meleeAttack: 1200, magicAttack: 1200, attackSpeed: 0, castTimePct: 100, meleeCritRatePct: 0, magicCritRatePct: 0 },
        });
        const def = createDefaultCharacter({
            maxHealth: 25000,
            defense: { physicalDefense: 6000, magicDefense: 4000, toughness: 0, resilience: 0 },
        });

        // 1. Gods' Whip is inherently Off-GCD (0.00s GCD without step.offGcd flag)
        const gwRot = simulateRotation(att, def, [{ skill: godsWhip }]);
        assert(gwRot.steps[0].result.dps.isOffGcd === true, "Gods' Whip is inherently Off-GCD");
        assertApprox(gwRot.steps[0].durationSec, 0, 0.0001, "Gods' Whip has 0.00s GCD execution footprint");
        const gwDelayRot = simulateRotation(att, def, [{ skill: godsWhip, delaySec: 0.05, travelTimeSec: 0.35 }]);
        assertApprox(gwDelayRot.steps[0].durationSec, 0.05, 0.0001, "Fine-grained 0.05s delay preserved on Gods' Whip");
        assertApprox(gwDelayRot.steps[0].impactSec, 0.35, 0.0001, "0.35s travel time sets Gods' Whip impact at 0.35s");
        assertApprox(gwDelayRot.totalDurationSec, 0.35, 0.0001, "Total window includes 0.35s travel tail");
        assertApprox(gwDelayRot.totalTravelTailSec, 0.30, 0.0001, "Travel tail beyond 0.05s cast window is 0.30s");

        // 2. Rotation-wide & per-step random debuffs (Delirium Bleed + Puncture -2k PDef)
        const basePrec = simulateRotation(att, def, [
            { skill: tripleSlash, targetIsCCd: true },
            { skill: precStrike, targetIsCCd: true },
        ]);
        const initBleedPrec = simulateRotation(
            att,
            def,
            [{ skill: precStrike, targetIsCCd: true }],
            { rotationInitialEffects: ["bleeding"] }
        );
        const noBleedPrec = simulateRotation(att, def, [{ skill: precStrike, targetIsCCd: true }]);
        assertApprox(
            initBleedPrec.steps[0].result.expected / noBleedPrec.steps[0].result.expected,
            1.2,
            0.005,
            "Rotation-wide Bleeding (Delirium) grants +20% combo damage to Precision Strike"
        );
        const stepDebuffRot = simulateRotation(att, def, [
            { skill: tripleSlash, targetIsCCd: true, appliedDebuffs: ["bleeding", "puncture"] },
            { skill: precStrike, targetIsCCd: true },
        ]);
        assertApprox(
            stepDebuffRot.steps[0].result.expected,
            basePrec.steps[0].result.expected,
            0.5,
            "Step 1 applying Bleeding + Puncture does not retroactively boost Step 1 itself"
        );
        assert(
            stepDebuffRot.steps[1].autoComboLabels.some((l) => l.includes("Bleeding")),
            "Step 2 receives Bleeding combo from Step 1's appliedDebuffs"
        );
        assert(
            stepDebuffRot.steps[1].activeDebuffLabels.some((l) => l.includes("Puncture")),
            "Step 2 receives Puncture (-2,000 PDef) from Step 1's appliedDebuffs"
        );
        assert(
            stepDebuffRot.steps[1].result.expected > basePrec.steps[1].result.expected * 1.25,
            "Bleeding (+20%) + Puncture (-2k PDef) substantially increases Step 2 Precision Strike damage"
        );

        // 3. Travel time delays combo status arrival until projectile impact
        const fastProjRot = simulateRotation(att, def, [
            { skill: flamebolt, noCastTime: true, travelTimeSec: 0.40 },
            { skill: freezingEarth },
        ]);
        const slowProjRot = simulateRotation(att, def, [
            { skill: flamebolt, noCastTime: true, travelTimeSec: 1.50 },
            { skill: freezingEarth },
        ]);
        assert(
            fastProjRot.steps[1].autoComboLabels.some((l) => l.includes("Burning")),
            "0.40s travel Flamebolt lands before 1.00s GCD Freezing Earth and triggers Burning +20%"
        );
        assert(
            !slowProjRot.steps[1].autoComboLabels.some((l) => l.includes("Burning")),
            "1.50s travel Flamebolt is still mid-air at 1.00s so instant Freezing Earth does not trigger Burning"
        );
    });

    // 46. Multi-Stage Cast Progression Across Rotations (Gods' Whip, Fervent Healing, Lightning Tiger Strike)
    await test("Multi-stage cast progression across rotations (Gods' Whip 1-5, Fervent Healing 1.0x-2.0x, Lightning Tiger Strike 1-3)", () => {
        const godsWhip = findSkill(sorcery, "sorcery_gods_whip");
        const flameboltFlame = findSkill(sorcery, "sorcery_flamebolt_flame");
        const fervent = findSkill(vitalism, "vitalism_fervent_healing");
        const lts = findSkill(battlerage, "battlerage_tiger_strike_lightning");

        const actor = createDefaultCharacter({
            offense: {
                meleeAttack: 1000,
                magicAttack: 1000,
                healingPower: 1000,
                attackSpeed: 0,
                castTimePct: 100,
                meleeCritRatePct: 0,
                magicCritRatePct: 0,
                healCritRatePct: 0,
            },
        });
        const target = createDefaultCharacter({
            maxHealth: 40000,
            defense: { physicalDefense: 0, magicDefense: 0, toughness: 0, resilience: 0 },
        });

        // 1. Gods' Whip 5-step interleaved weave auto-progresses Strike 1 -> Strike 5 (even with legacy null stageIndex!)
        const weave = simulateRotation(
            actor,
            target,
            [
                { skill: godsWhip },
                { skill: flameboltFlame, offGcd: true },
                { skill: godsWhip },
                { skill: flameboltFlame, offGcd: true },
                { skill: godsWhip },
                { skill: flameboltFlame, offGcd: true },
                { skill: godsWhip },
                { skill: flameboltFlame, offGcd: true },
                { skill: godsWhip },
            ],
            { disableAutoCombos: true }
        );
        const whipSteps = weave.steps.filter((s) => s.skill.id === "sorcery_gods_whip");
        assert(whipSteps.length === 5, "5 interleaved Gods' Whip steps resolved");
        for (let i = 0; i < 5; i++) {
            assert(whipSteps[i].stageIndex === i, `Gods' Whip #${i + 1} resolves to stageIndex ${i}`);
            assert(whipSteps[i].result.hitCount === 1, `Gods' Whip #${i + 1} evaluates 1 strike, not all 5`);
            if (i > 0) {
                assert(
                    whipSteps[i].result.expected > whipSteps[i - 1].result.expected,
                    `Gods' Whip Strike ${i + 1} (${whipSteps[i].result.expected.toFixed(0)}) > Strike ${i} (${whipSteps[i - 1].result.expected.toFixed(0)})`
                );
            }
        }
        const fullWhip = simulateRotation(actor, target, [{ skill: godsWhip, stageIndex: "all" }], { disableAutoCombos: true });
        const sumWeaveWhips = whipSteps.reduce((acc, s) => acc + s.result.expected, 0);
        assertApprox(sumWeaveWhips, fullWhip.totalExpected, 2.0, "Sum of 5 individual Gods' Whip stages matches full 5-strike Gods' Whip");

        // 2. Fervent Healing 5-stage escalating heals (1.00x -> 2.00x, 0.40s GCD per cast)
        const fervRot = simulateRotation(
            actor,
            target,
            Array.from({ length: 5 }, () => ({ skill: fervent, stageIndex: "auto" }))
        );
        assertApprox(fervRot.totalDurationSec, 2.0, 0.01, "5 individual Fervent Healing stages take 5 x 0.40s = 2.00s");
        for (let i = 1; i < 5; i++) {
            assert(
                fervRot.steps[i].result.expected > fervRot.steps[i - 1].result.expected,
                `Fervent Healing Cast ${i + 1} heals more than Cast ${i}`
            );
        }
        assertApprox(
            fervRot.steps[4].result.expected / fervRot.steps[0].result.expected,
            2.0,
            0.01,
            "Fervent Healing Cast 5 (2.00x) heals for 2.0x of Cast 1 (1.00x)"
        );

        // 3. Lightning Tiger Strike 3-stage casts (0.40s per dash, 1/3 each) + explicit stage lock
        const ltsRot = simulateRotation(
            actor,
            target,
            [
                { skill: lts, stageIndex: "auto" },
                { skill: lts, stageIndex: "auto" },
                { skill: lts, stageIndex: "auto" },
            ],
            { disableAutoCombos: true }
        );
        const fullLts = simulateRotation(actor, target, [{ skill: lts, stageIndex: "all" }], { disableAutoCombos: true });
        assertApprox(ltsRot.totalDurationSec, 1.2, 0.01, "3 individual Lightning Tiger Strike dashes = 1.20s");
        assertApprox(ltsRot.totalExpected, fullLts.totalExpected, 2.0, "3 individual Lightning Tiger Strike stages sum to full 3-hit skill");

        const lockedStrike5 = simulateRotation(actor, target, [{ skill: godsWhip, stageIndex: 4 }], { disableAutoCombos: true });
        assert(lockedStrike5.steps[0].stageIndex === 4, "Explicit stageIndex: 4 locks to Strike 5");
        assertApprox(lockedStrike5.totalExpected, whipSteps[4].result.expected, 1.0, "Locked Strike 5 matches 5th auto-stage strike");

        // 4. Active debuffs/statuses & remaining durations snapshot + merged effectSpans timeline
        const dropBack = findSkill(shadowplay, "shadowplay_drop_back");
        const tracked = simulateRotation(
            actor,
            target,
            [
                { skill: dropBack },
                { skill: godsWhip, stageIndex: "auto", delaySec: 0.1 },
                { skill: flameboltFlame, offGcd: true },
                { skill: godsWhip, stageIndex: "auto", delaySec: 0.1 },
            ],
            { rotationInitialEffects: ["bleeding"] }
        );
        const step4 = tracked.steps[3];
        const shockedAt4 = step4.activeTargetEffects.find((e) => e.id === "shocked");
        const burningAt4 = step4.activeTargetEffects.find((e) => e.id === "burning");
        const bleedAt4 = step4.activeTargetEffects.find((e) => e.id === "bleeding");
        assert(shockedAt4 && shockedAt4.remainingSec > 7.5 && shockedAt4.remainingSec <= 8.0, `Shocked active with ~7.9s remaining at step 4 (got ${shockedAt4?.remainingSec})`);
        assert(burningAt4 && burningAt4.remainingSec > 3.5 && burningAt4.remainingSec <= 4.0, `Burning active with ~3.9s remaining at step 4 (got ${burningAt4?.remainingSec})`);
        assert(bleedAt4 && bleedAt4.isPermanent === true, "Rotation-wide Bleeding marked permanent in activeTargetEffects");
        assert(step4.activeComboBuffs.some((b) => b.id === "drop_back" && b.remainingSec > 2.0), "Drop Back combo buff remaining duration tracked at step 4");
        assert(
            tracked.effectSpans.some((sp) => sp.id === "shocked") &&
                tracked.effectSpans.some((sp) => sp.id === "burning") &&
                tracked.effectSpans.some((sp) => sp.id === "bleeding" && sp.isPermanent),
            "Merged effectSpans includes Shocked, Burning, and permanent Bleeding"
        );
    });

    // 47. Upgrading Costume / Synthesis Gear Grade Preserves & Scales Synthesis Stats
    await test("Upgrading costume grade (Legendary -> Mythic) preserves all synthesis stats and scales values to Mythic pool", async () => {
        const catalog = await loadGearCatalog("../js/data/gear_catalog");
        const costumeItems = filterItemsForSlot(0, { query: "Costume" }, catalog);
        const costume = costumeItems.find((it) => Number(it.synth_cat_id) > 0 && Number(it.maxgrade) >= 11);
        assert(Boolean(costume), "Found synthesizable Costume up to Mythic in catalog");

        let slots = createEmptyGearSlots();
        slots = equipCatalogItemInSlot(slots, 0, costume, { gradeId: 10 }, catalog); // Legendary
        const legPool = getAvailableSynthPool(slots[0].item.equipment, 10, catalog);
        const legCount = getSynthSlotCountForGrade(slots[0].item.equipment, 10);
        assert(legCount >= 3 && legPool.length >= legCount, `Legendary costume has ${legCount} synth lines`);

        const pickedAttrIds = legPool.slice(0, legCount).map((p) => Number(p.unit_attribute_id));
        for (let i = 0; i < pickedAttrIds.length; i++) {
            slots = setSlotItemSynthStat(slots, 0, i, pickedAttrIds[i], catalog);
        }
        const beforeMaxes = slots[0].item.sythisis_stat.map((st) => Number(st?.maxvalue ?? st?.max ?? 0));

        // Upgrade Legendary (10) -> Mythic (11)
        const mythicSlots = setSlotItemGrade(slots, 0, 11, catalog);
        const mythicItem = mythicSlots[0].item;
        assert(mythicItem.grade.id === 11, "Costume grade upgraded to Mythic (11)");
        for (let i = 0; i < pickedAttrIds.length; i++) {
            const st = mythicItem.sythisis_stat[i];
            assert(st && Number(st.unit_attribute_id) === pickedAttrIds[i], `Synth line #${i + 1} attribute preserved after Legendary -> Mythic upgrade`);
            const afterMax = Number(st.maxvalue ?? st.max ?? 0);
            assert(afterMax >= beforeMaxes[i], `Mythic synth line #${i + 1} value (${afterMax}) >= Legendary (${beforeMaxes[i]})`);
        }
        assert(
            mythicItem.sythisis_stat.slice(0, pickedAttrIds.length).some((st, i) => Number(st.maxvalue ?? st.max ?? 0) > beforeMaxes[i]),
            "At least one synthesis line scaled strictly higher at Mythic"
        );

        // Downgrade Mythic (11) -> Legendary (10) also keeps all stats
        const backToLeg = setSlotItemGrade(mythicSlots, 0, 10, catalog);
        for (let i = 0; i < pickedAttrIds.length; i++) {
            assert(
                Number(backToLeg[0].item.sythisis_stat[i]?.unit_attribute_id) === pickedAttrIds[i],
                `Round-trip Mythic -> Legendary preserves synth line #${i + 1}`
            );
        }
    });

    // 48. Per-Item Granted Stats Calculator (PDef/MDef, Weapon Atk, Attributes, Bonus Effects)
    await test("computeGearItemGrantedStats computes accurate Phys/Magic Def, Weapon Atk, Attributes, and Bonus Stats for any gear slot", async () => {
        const catalog = await loadGearCatalog("../js/data/gear_catalog");
        let slots = createEmptyGearSlots();

        // 1. Plate Chest (Phys Def + STR/STA + Gear Score)
        const chestItem = filterItemsForSlot(2, { query: "Ayanad", typeFilter: "Plate" }, catalog)[0];
        assert(Boolean(chestItem), "Found Ayanad Plate Chest");
        slots = equipCatalogItemInSlot(slots, 2, chestItem, { gradeId: 9, ptemper: 110 }, catalog);
        const chestStats = computeGearItemGrantedStats(slots[2], 2);
        assert(chestStats && chestStats.main.pdef > 3500, `Plate Chest grants >3,500 Phys Def (got ${chestStats?.main?.pdef})`);
        assert(chestStats.main.mdef === 0, "Plate Chest grants 0 Magic Def");
        const chestAttrSum = Object.values(chestStats.attributes).reduce((a, b) => a + b, 0);
        assert(chestAttrSum > 50, `Plate Chest grants primary attributes (sum=${chestAttrSum})`);
        assert(chestStats.gearScore > 400, `Plate Chest computes Gear Score (got ${chestStats.gearScore})`);

        // 2. Staff Weapon (Melee Atk + Magic Atk + INT)
        const staffItem = filterItemsForSlot(15, { query: "Ayanad Wave", typeFilter: "Staff" }, catalog)[0];
        assert(Boolean(staffItem), "Found Ayanad Wave Staff");
        slots = equipCatalogItemInSlot(slots, 15, staffItem, { gradeId: 10, mtemper: 112 }, catalog);
        const staffStats = computeGearItemGrantedStats(slots[15], 15);
        assert(staffStats.main.meleeAttack > 400, `Ayanad Staff grants Melee Atk (got ${staffStats.main.meleeAttack})`);
        assert(staffStats.main.magicAttack > 500, `Ayanad Staff grants Magic Atk (got ${staffStats.main.magicAttack})`);
        assert(staffStats.attributes.int > 40, `Ayanad Staff grants INT (got ${staffStats.attributes.int})`);
    });

    // 49. Equip Effects, Item Set Effects, and Erenor Lunafrost Set Effects (3/4/6pc)
    await test("Item equip effects, equipment set effects (4/7pc), and Erenor Lunafrost sets (3/4/6pc) compute and render cleanly", async () => {
        const catalog = await loadGearCatalog("../js/data/gear_catalog");
        let slots = createEmptyGearSlots();

        // 1. Obsidian Club equip effect (Crit Heal Bonus %)
        const obsClub = filterItemsForSlot(15, { query: "Cursed Obsidian Club" }, catalog)[0];
        assert(Boolean(obsClub), "Found Cursed Obsidian Club");
        slots = equipCatalogItemInSlot(slots, 15, obsClub, { gradeId: 9 }, catalog); // Epic
        const clubStats = computeGearItemGrantedStats(slots[15], 15, slots);
        assert(
            clubStats.equipEffects.some((e) => e.label === "Crit Heal Bonus" && e.value >= 9.5),
            `Cursed Obsidian Club Epic exposes Crit Heal Bonus equip effect (got ${JSON.stringify(clubStats.equipEffects)})`
        );

        // 2. Equip 6 pieces of Ayanad Flame Plate + apply Erenor Flame Lunafrost (43154) across all 6 eligible slots
        const armorSlots = [1, 2, 3, 4, 5, 7];
        for (const sid of armorSlots) {
            const it = filterItemsForSlot(sid, { query: "Ayanad Flame", typeFilter: "Plate" }, catalog)[0];
            assert(Boolean(it), `Found Ayanad Flame Plate for slot ${sid}`);
            slots = equipCatalogItemInSlot(slots, sid, it, { gradeId: 9 }, catalog);
        }
        const { slots: withErenor, appliedCount } = applyLunafrostToEligibleSlots(slots, 43154, catalog);
        assert(appliedCount === 6, `Erenor Flame Lunafrost applied to all 6 eligible Ayanad slots (got ${appliedCount})`);

        const chestGranted = computeGearItemGrantedStats(withErenor[2], 2, withErenor);
        const armorSet = chestGranted.setEffects.find((s) => s.sourceKind === "equipment");
        const erenorSet = chestGranted.setEffects.find((s) => s.sourceKind === "lunafrost");
        assert(armorSet && armorSet.equippedCount === 6, `Ayanad Flame Set tracks 6/7 pieces (got ${armorSet?.equippedCount})`);
        assert(
            armorSet.tiers.some((t) => t.numPieces === 4 && t.active && t.summary.includes("Crit Damage")),
            `Ayanad Flame 4pc Crit Damage tier active (${armorSet?.tiers?.[0]?.summary})`
        );
        assert(
            armorSet.tiers.some((t) => t.numPieces === 7 && !t.active),
            "Ayanad Flame 7pc tier inactive at 6 pieces"
        );
        assert(erenorSet && erenorSet.equippedCount === 6 && erenorSet.maxPieces === 6, "Erenor Flame Lunafrost Set tracks 6/6 pieces");
        assert(
            erenorSet.tiers.every((t) => t.active) && erenorSet.tiers.some((t) => t.numPieces === 6 && t.summary.includes("Melee Crit Dmg")),
            `Erenor Flame 3/4/6pc tiers all active with Melee Crit Dmg (${JSON.stringify(erenorSet.tiers.map((t) => t.summary))})`
        );

        // 3. Active Set Summaries include both Ayanad Flame Set & Erenor Flame Lunafrost Set, and stats reflect +18.6% Melee Crit Dmg
        const activeSets = computeActiveSetEffectSummaries(withErenor);
        assert(activeSets.some((s) => s.category === "set" && s.name.includes("Ayanad Flame")), "Active summaries include Ayanad Flame Set");
        assert(activeSets.some((s) => s.category === "erenor" && s.name.includes("Erenor Flame")), "Active summaries include Erenor Flame Lunafrost Set");

        const calcNoErenor = calculateDaruGearStats(createDefaultRawPlayer(), slots);
        const calcWithErenor = calculateDaruGearStats(createDefaultRawPlayer(), withErenor);
        assertApprox(calcWithErenor.toughness - calcNoErenor.toughness, 452, 1, "6pc Erenor Flame grants +452 Toughness");
        assertApprox(calcWithErenor.resilience - calcNoErenor.resilience, 560, 1, "6pc Erenor Flame grants +560 Resilience");
        assertApprox(calcWithErenor.meleeCritBonus - calcNoErenor.meleeCritBonus, 18.6, 0.2, "6pc Erenor Flame grants +18.6% Melee Crit Damage");
        assertApprox(calcWithErenor.atk - calcNoErenor.atk, 60, 0.5, "6x Erenor Flame Lunafrost grants +60 base Melee Attack");
    });

    // 50. Quick Armor Set Preset Swapper (Ayanad 7pc, T7/T6 Obsidian 5pc, Dungeon Gear 7pc, Delphinad 7pc — no Enlightened Ayanad)
    await test("Armor Set Preset Swapper resolves Ayanad, T7/T6 Obsidian, Dungeon Gear, and Delphinad sets (excluding Enlightened Ayanad)", async () => {
        const catalog = await loadGearCatalog("../js/data/gear_catalog");
        const presets = getArmorSetPresets(catalog);
        const byId = new Map(presets.map((p) => [p.id, p]));

        // 1. All 5 active groups resolve & Enlightened Ayanad is excluded
        const groups = new Set(presets.map((p) => p.group));
        assert(groups.has("Ayanad Armor (7pc)"), "Ayanad Armor (7pc) preset group present");
        assert(groups.has("T7 Obsidian Armor (5pc)"), "T7 Obsidian Armor (5pc) preset group present");
        assert(groups.has("T6 Obsidian Armor (5pc)"), "T6 Obsidian Armor (5pc) preset group present");
        assert(groups.has("Dungeon Gear (7pc)"), "Dungeon Gear (7pc) preset group present");
        assert(groups.has("Delphinad Armor (7pc)"), "Delphinad Armor (7pc) preset group present");
        assert(!groups.has("Enlightened Ayanad (7pc)"), "Enlightened Ayanad is excluded from armor set presets");
        assert(!presets.some((p) => p.id.startsWith("enlightened_ayanad")), "No enlightened_ayanad preset IDs exist");

        for (const reqId of [
            "ayanad_leather_flame",
            "ayanad_cloth_life",
            "t7_cloth_spirit",
            "t7_cloth_mage",
            "t6_cloth_healer",
            "dungeon_mistsong_cloth_mage",
            "dungeon_mistsong_cloth_healer",
            "dungeon_mistsong_leather_archer",
            "dungeon_serpentis_cloth_mage",
            "dungeon_serpentis_leather",
            "dungeon_serpentis_plate",
            "dungeon_greater_cloth",
            "dungeon_hellforged_cloth_mage",
            "dungeon_gha_plate",
        ]) {
            assert(byId.has(reqId), `Preset '${reqId}' resolved from catalog`);
        }

        // 2. Equip 7pc Leather Ayanad Flame at Epic (9), add Toughness gems on Legs (7) + custom temper on Chest (2)
        let slots = createEmptyGearSlots();
        const flameRes = equipArmorSetPreset(slots, "ayanad_leather_flame", { gradeId: 9 }, catalog);
        assert(flameRes.swappedCount === 7, `Leather Ayanad Flame swapped 7 slots (got ${flameRes.swappedCount})`);
        slots = flameRes.slots;
        assert(slots[2].item.equipment.name.startsWith("Ayanad Flame "), "Chest is Ayanad Flame Leather");
        assert(slots[2].item.grade.id === 9, "Explicit Epic grade applied to Chest");
        slots[2].item.ptemper = 112;
        slots[3].item.grade = { ...catalog.gradeById.get(10) }; // Legendary Waist
        const legGems = filterLunagemsForSlot(7, slots[7].item, catalog);
        const toughGem = legGems.find((g) => /Toughness/i.test(`${g.name || ""} ${g.effect_text || ""}`));
        assert(Boolean(toughGem), "Found Toughness lunagem for Legs");
        slots = fillAllSlotLunagems(slots, 7, toughGem.id, catalog);
        const legGemCountBefore = slots[7].item.lunagem.filter((g) => g && g.id === toughGem.id).length;
        assert(legGemCountBefore >= 4, `Socketed ${legGemCountBefore} Toughness gems on Legs`);

        // 3. Swap to 7pc Cloth Ayanad Life keeping existing grades, tempers, and compatible gems
        const lifeRes = equipArmorSetPreset(slots, "ayanad_cloth_life", {}, catalog);
        assert(lifeRes.swappedCount === 7, "Cloth Ayanad Life swapped all 7 slots");
        assert(lifeRes.slots[2].item.equipment.type === "Cloth" && lifeRes.slots[2].item.equipment.name.startsWith("Ayanad Life "), "Chest swapped to Ayanad Life Cloth");
        assert(lifeRes.slots[2].item.ptemper === 112, "Existing Chest temper (112%) preserved across set swap");
        assert(lifeRes.slots[3].item.grade.id === 10, "Existing Legendary grade on Waist preserved when Keep Slot Grades is used");
        assert(
            lifeRes.slots[7].item.lunagem.filter((g) => g && g.id === toughGem.id).length === legGemCountBefore,
            "Compatible Toughness lunagems on Legs preserved across Leather -> Cloth swap"
        );

        // 4. Swap to 5pc T7 Obsidian Spirit Cloth (Ehnoïr 75% SPI): leaves Waist (3) & Wrists (4) untouched!
        const waistBeforeId = lifeRes.slots[3].item.equipment.id;
        const wristsBeforeId = lifeRes.slots[4].item.equipment.id;
        const t7SpiritRes = equipArmorSetPreset(lifeRes.slots, "t7_cloth_spirit", { gradeId: 10 }, catalog);
        assert(t7SpiritRes.swappedCount === 5, `T7 Obsidian Spirit Cloth swapped 5 slots (got ${t7SpiritRes.swappedCount})`);
        assert(t7SpiritRes.slots[3].item.equipment.id === waistBeforeId, "5pc Obsidian swap leaves Waist untouched");
        assert(t7SpiritRes.slots[4].item.equipment.id === wristsBeforeId, "5pc Obsidian swap leaves Wrists untouched");
        const t7SpiritChestStats = computeGearItemGrantedStats(t7SpiritRes.slots[2], 2, t7SpiritRes.slots);
        assert(t7SpiritChestStats.attributes.spi > t7SpiritChestStats.attributes.int, "T7 Spirit Cloth Chest grants primary SPI");

        // 5. Swap to 5pc T7 Obsidian Mage Cloth, 5pc T6 Obsidian Healer Cloth, and 7pc Dungeon Gear (Mistsong + Hellforged)
        const t7MageRes = equipArmorSetPreset(t7SpiritRes.slots, "t7_cloth_mage", { gradeId: 10 }, catalog);
        assert(t7MageRes.swappedCount === 5, "T7 Obsidian Mage Cloth swapped 5 slots");
        const t7MageChestStats = computeGearItemGrantedStats(t7MageRes.slots[2], 2, t7MageRes.slots);
        assert(t7MageChestStats.attributes.int > t7MageChestStats.attributes.spi, "T7 Mage Cloth Chest grants primary INT");

        const t6HealerRes = equipArmorSetPreset(t7MageRes.slots, "t6_cloth_healer", { gradeId: 9 }, catalog);
        assert(t6HealerRes.swappedCount === 5, "T6 Obsidian Healer Cloth swapped 5 slots");
        assert(t6HealerRes.slots[2].item.equipment.name.startsWith("Purehearted Goddess"), "T6 Healer Cloth Chest is Purehearted Goddess");
        assert(t6HealerRes.slots[3].item.equipment.id === waistBeforeId, "T6 Obsidian 5pc swap still leaves Waist untouched");

        const mistsongRes = equipArmorSetPreset(t6HealerRes.slots, "dungeon_mistsong_cloth_mage", { gradeId: 9 }, catalog);
        assert(mistsongRes.swappedCount === 7, "Dungeon Mistsong Cloth Mage swapped all 7 slots");
        assert(mistsongRes.slots[2].item.equipment.name === "Tempting Melody Shirt", `Mistsong Chest is Tempting Melody Shirt (got ${mistsongRes.slots[2].item.equipment.name})`);

        const hellforgedRes = equipArmorSetPreset(mistsongRes.slots, "dungeon_hellforged_cloth_mage", { gradeId: 11 }, catalog);
        assert(hellforgedRes.swappedCount === 7, "Dungeon Hellforged Mage swapped all 7 slots");
        assert(hellforgedRes.slots[2].item.grade.id === 7, `Hellforged grade safely clamps to Celestial (7) maxgrade (got ${hellforgedRes.slots[2].item.grade.id})`);
    });

    // 51. Create Blank Gear Build (.json with zero equipped gear, clean Lv 55 base stats)
    await test("createBlankGearBuild creates a clean naked Lv 55 character ready to save as JSON and equip sets", async () => {
        const catalog = await loadGearCatalog("../js/data/gear_catalog");
        const blank = createBlankGearBuild("Fresh Healer", {}, catalog);
        assert(blank.name === "Fresh Healer", "Blank build retains requested name");
        assert(blank.level === 55, "Blank build starts at Lv 55");
        assert(blank.source === "gearbuilder" && blank.metadata?.source === "gearbuilder", "Blank build source is gearbuilder");
        assert(blank.gearScore === 0, `Blank build has 0 Gear Score (got ${blank.gearScore})`);
        assert(Array.isArray(blank.equipment) && blank.equipment.length === 0, "Blank build has 0 equipped items");
        assert(blank.shareCode === null && blank.darugearUrl === null, "Blank build has no DaruGear share code or URL");
        assert(blank.rawDaruGear.slots.every((s) => s.item === null), "All 20 raw Gear Builder slots are empty");
        assert(
            blank.attributes.str === 158 && blank.attributes.agi === 158 && blank.attributes.sta === 158 && blank.attributes.int === 158 && blank.attributes.spi === 158,
            "Blank build has exact Lv 55 base attributes (158 all)"
        );

        // Round-trip through JSON export/import (parseImportPayload + ensureCharacterRawDaruGear) and equip a Dungeon set
        const serialized = JSON.parse(JSON.stringify({ ...blank, rawDaruGear: undefined }));
        const parsed = parseImportPayload(serialized);
        assert(parsed.ok && parsed.character.name === "Fresh Healer", "Blank build JSON round-trips through parseImportPayload");
        assert((parsed.character.equipment || []).length === 0, "Parsed blank build still has 0 equipped items");
        const { slots, player } = ensureCharacterRawDaruGear(parsed.character, catalog);
        assert(slots.every((s) => s.item === null), "Reconstructed blank build has all 20 slots empty");

        const { slots: gearedSlots } = equipArmorSetPreset(slots, "dungeon_mistsong_cloth_healer", { gradeId: 9 }, catalog);
        const { character: geared } = recalculateCharacterFromGearBuilder(parsed.character, gearedSlots, player, catalog);
        assert(geared.equipment.length === 7 && geared.gearScore > 1800, `Blank build equips 7pc Mistsong Healer cleanly (${geared.gearScore} GS)`);
        assert(geared.attributes.spi > 400, `Mistsong Healer grants Spirit (got ${geared.attributes.spi})`);
    });

    // 52. Customizable Multi-Slot Gear Templates (extract, normalize, apply with grade/gem modes & partial preservation)
    await test("Custom multi-slot Gear Templates extract, serialize, and apply items, grades, tempers, gems, frosts, and synth stats accurately", async () => {
        const catalog = await loadGearCatalog("../js/data/gear_catalog");

        // 1. Build a customized mixed set: 7pc Ayanad Life at Epic, then swap 5pc T7 Spirit Cloth at Legendary (leaving Life Waist & Wrists at Epic),
        //    add custom Chest temper (111%), Erenor Life Lunafrost (43158) on Waist/Wrists, Toughness gems on Legs, and Mythic Costume with synth stats
        let src = createEmptyGearSlots();
        src = equipArmorSetPreset(src, "ayanad_cloth_life", { gradeId: 9 }, catalog).slots;
        src = equipArmorSetPreset(src, "t7_cloth_spirit", { gradeId: 10 }, catalog).slots;
        src[2].item.ptemper = 111;
        src = applyLunafrostToEligibleSlots(src, 43158, catalog).slots;
        const legGems = filterLunagemsForSlot(7, src[7].item, catalog);
        const toughGem = legGems.find((g) => /Toughness/i.test(`${g.name || ""} ${g.effect_text || ""}`));
        assert(Boolean(toughGem), "Found Toughness gem for Legs");
        src = fillAllSlotLunagems(src, 7, toughGem.id, catalog);
        const legGemCount = src[7].item.lunagem.filter((g) => g && g.id === toughGem.id).length;

        const costume = filterItemsForSlot(0, { query: "Costume" }, catalog).find(
            (it) => Number(it.synth_cat_id) > 0 && Number(it.maxgrade) >= 11
        );
        src = equipCatalogItemInSlot(src, 0, costume, { gradeId: 11 }, catalog);
        const synthPool = getAvailableSynthPool(src[0].item.equipment, 11, catalog);
        const synthA = Number(synthPool[0].unit_attribute_id);
        const synthB = Number(synthPool[1].unit_attribute_id);
        src = setSlotItemSynthStat(src, 0, 0, synthA, catalog);
        src = setSlotItemSynthStat(src, 0, 1, synthB, catalog);

        // 2. Extract partial 8-slot template (Costume + 7 Armor slots) & JSON round-trip + prototype-pollution safety
        const tpl = extractGearTemplateFromSlots(src, {
            name: "Mixed Healer Obsidian + Life",
            notes: "5pc T7 SPI + 2pc Life + Mythic Costume",
            slotIds: [0, 1, 2, 3, 4, 5, 7, 8],
        });
        assert(tpl && tpl.slotCount === 8 && tpl.id === "mixed-healer-obsidian-life", `Extracted 8-slot template (got ${tpl?.slotCount})`);
        const roundTripped = normalizeGearTemplate(
            JSON.parse(JSON.stringify({ ...tpl, slots: { ...tpl.slots, __proto__: { itemId: 1 } } }))
        );
        assert(roundTripped && roundTripped.slotCount === 8 && !Object.prototype.hasOwnProperty.call(roundTripped.slots, "__proto__"), "normalizeGearTemplate round-trips cleanly and blocks __proto__");

        // 3. Apply onto a character that already has a Main Hand weapon equipped (slot 15 must stay untouched!)
        let target = createEmptyGearSlots();
        const obsClub = filterItemsForSlot(15, { query: "Cursed Obsidian Club" }, catalog)[0];
        target = equipCatalogItemInSlot(target, 15, obsClub, { gradeId: 10 }, catalog);
        const applied = applyGearTemplateToSlots(target, roundTripped, { gradeMode: "template" }, catalog);
        assert(applied.appliedCount === 8 && applied.missingSlots.length === 0, `Applied all 8 template slots (got ${applied.appliedCount})`);
        assert(applied.slots[15].item?.equipment?.id === obsClub.id, "Untouched weapon slot (15) preserved when applying partial template");
        assert(applied.slots[2].item.grade.id === 10 && applied.slots[3].item.grade.id === 9, "Mixed Legendary (Chest) + Epic (Waist) template grades restored exactly");
        assert(applied.slots[2].item.ptemper === 111, "Template Chest temper (111%) restored");
        assert(applied.slots[3].item.lunafrost?.id === 43158, "Template Erenor Life Lunafrost on Waist restored");
        assert(
            applied.slots[7].item.lunagem.filter((g) => g && g.id === toughGem.id).length === legGemCount,
            `Template Legs Toughness gems (${legGemCount}) restored`
        );
        assert(
            Number(applied.slots[0].item.sythisis_stat[0]?.unit_attribute_id) === synthA &&
                Number(applied.slots[0].item.sythisis_stat[1]?.unit_attribute_id) === synthB,
            "Template Mythic Costume synthesis stats restored"
        );

        // 4. Uniform grade override (Divine = 8) & keepExistingGemsFrost mode
        const divineOverride = applyGearTemplateToSlots(
            applied.slots,
            roundTripped,
            { gradeMode: 8, keepExistingGemsFrost: true },
            catalog
        );
        assert(divineOverride.slots[2].item.grade.id === 8 && divineOverride.slots[3].item.grade.id === 8, "Uniform Divine (8) grade override applied to template slots");
        assert(
            divineOverride.slots[7].item.lunagem.filter((g) => g && g.id === toughGem.id).length >= 3,
            "keepExistingGemsFrost preserves compatible target gems on Legs"
        );
    });

    // 53. Costume Enlightenment Charms: full un-truncated effects, active highlighting (2x Enlightened or Buff), and Earth/Wave/Meadow stub fix
    await test("Costume Enlightenment Charms display full un-truncated effects and activate via 2x Enlightened accessories or buff chip", async () => {
        const catalog = await loadGearCatalog("../js/data/gear_catalog");
        assert(Object.keys(COSTUME_CHARM_DEFS).length === 7, "All 7 Costume Enlightenment Charms defined");

        let slots = createEmptyGearSlots();
        const costume = filterItemsForSlot(0, { query: "Costume" }, catalog)[0];
        assert(Boolean(costume), "Found Costume in catalog");
        slots = equipCatalogItemInSlot(slots, 0, costume, { gradeId: 10 }, catalog);
        slots = setSlotItemLunafrost(slots, 0, 9001611, catalog); // Life Charm

        // 1. With 0 Enlightened accessories and no buff: inactive (0/2), full un-truncated text present
        const inactiveStats = computeGearItemGrantedStats(slots[0], 0, slots, []);
        const charmSet0 = inactiveStats.setEffects.find((s) => s.sourceKind === "charm");
        assert(Boolean(charmSet0) && !charmSet0.active && charmSet0.equippedCount === 0, "Life Charm is inactive at 0/2 Enlightened pieces");
        assert(
            charmSet0.tiers[0].summary.includes("Precision Strike") && charmSet0.tiers[0].summary.includes("Renewal"),
            "Life Charm summary includes full un-truncated 10-skill list"
        );
        assert(!computeActiveSetEffectSummaries(slots, []).some((s) => s.category === "charm"), "Inactive charm omitted from Active Set Summaries");

        // 2. Activating via Buff chip highlights charm active even with 0 Enlightened gear
        const buffActiveStats = computeGearItemGrantedStats(slots[0], 0, slots, ["enlightenment_life"]);
        assert(buffActiveStats.charmInfo?.active && buffActiveStats.charmInfo?.activeByBuff, "Life Charm activates when enlightenment_life buff is active");
        assert(
            computeActiveSetEffectSummaries(slots, ["enlightenment_life"]).some((s) => s.category === "charm" && s.name.includes("Life Enlightenment")),
            "Buff-activated Life Charm appears in Active Set Summaries"
        );

        // 3. Mismatched Enlightened Flame accessories do NOT activate Life Charm (requires matching Life accessories!)
        const flameEarring = filterItemsForSlot(11, { query: "Enlightened Ayanad Flame" }, catalog)[0];
        const flameRing = filterItemsForSlot(13, { query: "Enlightened Ayanad Flame" }, catalog)[0];
        assert(Boolean(flameEarring) && Boolean(flameRing), "Found Enlightened Ayanad Flame Earring & Ring");
        let flameAccSlots = equipCatalogItemInSlot(slots, 11, flameEarring, { gradeId: 9 }, catalog);
        flameAccSlots = equipCatalogItemInSlot(flameAccSlots, 13, flameRing, { gradeId: 9 }, catalog);
        const mismatchStats = computeGearItemGrantedStats(flameAccSlots[0], 0, flameAccSlots, []);
        assert(
            !mismatchStats.charmInfo?.active && mismatchStats.charmInfo?.enlightenedCount === 0,
            "Life Charm stays inactive (0/2) when only Enlightened Flame accessories are equipped"
        );
        // Switching to Flame Charm with those same Flame accessories activates immediately (2/2)!
        const flameMatchSlots = setSlotItemLunafrost(flameAccSlots, 0, 9001678, catalog);
        const flameMatchStats = computeGearItemGrantedStats(flameMatchSlots[0], 0, flameMatchSlots, []);
        assert(
            flameMatchStats.charmInfo?.active && flameMatchStats.charmInfo?.activeByGear && flameMatchStats.charmInfo?.enlightenedCount === 2,
            "Flame Charm activates (2/2) with 2x Enlightened Ayanad Flame accessories"
        );

        // 4. Must specifically be 1 matching Earring + 1 matching Ring (2x Rings or Necklace+Ring does NOT activate!)
        const lifeNeck = filterItemsForSlot(10, { query: "Enlightened Ayanad Life" }, catalog)[0];
        const lifeEarring = filterItemsForSlot(11, { query: "Enlightened Ayanad Life" }, catalog)[0];
        const lifeRing = filterItemsForSlot(13, { query: "Enlightened Ayanad Life" }, catalog)[0];
        assert(Boolean(lifeNeck) && Boolean(lifeEarring) && Boolean(lifeRing), "Found Enlightened Ayanad Life Necklace, Earring & Ring");

        let twoRingsSlots = equipCatalogItemInSlot(slots, 10, lifeNeck, { gradeId: 9 }, catalog);
        twoRingsSlots = equipCatalogItemInSlot(twoRingsSlots, 13, lifeRing, { gradeId: 9 }, catalog);
        twoRingsSlots = equipCatalogItemInSlot(twoRingsSlots, 14, lifeRing, { gradeId: 9 }, catalog);
        const twoRingsInfo = computeGearItemGrantedStats(twoRingsSlots[0], 0, twoRingsSlots, []).charmInfo;
        assert(
            !twoRingsInfo?.active && twoRingsInfo?.enlightenedCount === 1 && !twoRingsInfo?.hasEarring && twoRingsInfo?.hasRing,
            "Life Charm stays inactive (1/2) with Necklace + 2x Life Rings and 0 Life Earrings"
        );

        let twoEarringsSlots = equipCatalogItemInSlot(slots, 11, lifeEarring, { gradeId: 9 }, catalog);
        twoEarringsSlots = equipCatalogItemInSlot(twoEarringsSlots, 12, lifeEarring, { gradeId: 9 }, catalog);
        const twoEarringsInfo = computeGearItemGrantedStats(twoEarringsSlots[0], 0, twoEarringsSlots, []).charmInfo;
        assert(
            !twoEarringsInfo?.active && twoEarringsInfo?.enlightenedCount === 1 && twoEarringsInfo?.hasEarring && !twoEarringsInfo?.hasRing,
            "Life Charm stays inactive (1/2) with 2x Life Earrings and 0 Life Rings"
        );

        slots = equipCatalogItemInSlot(slots, 11, lifeEarring, { gradeId: 9 }, catalog);
        slots = equipCatalogItemInSlot(slots, 13, lifeRing, { gradeId: 9 }, catalog);
        const gearActiveStats = computeGearItemGrantedStats(slots[0], 0, slots, []);
        assert(
            gearActiveStats.charmInfo?.active && gearActiveStats.charmInfo?.activeByGear && gearActiveStats.charmInfo?.enlightenedCount === 2,
            "Life Charm activates automatically with 1x Enlightened Life Earring + 1x Enlightened Life Ring (2/2)"
        );
        assert(
            gearActiveStats.setEffects.some((s) => s.sourceKind === "charm" && s.active && s.tiers[0].active),
            "Active Life Charm set block and tier both marked active"
        );

        // 5. Earth Charm (9001674) replaces DaruGear's broken 1pc stub & activates only with 2x Enlightened Ayanad Earth
        const earthEarring = filterItemsForSlot(11, { query: "Enlightened Ayanad Earth" }, catalog)[0];
        const earthRing = filterItemsForSlot(13, { query: "Enlightened Ayanad Earth" }, catalog)[0];
        let earthSlots = setSlotItemLunafrost(slots, 0, 9001674, catalog);
        assert(!computeGearItemGrantedStats(earthSlots[0], 0, earthSlots, []).charmInfo?.active, "Earth Charm stays inactive with Life accessories");
        earthSlots = equipCatalogItemInSlot(earthSlots, 11, earthEarring, { gradeId: 9 }, catalog);
        earthSlots = equipCatalogItemInSlot(earthSlots, 13, earthRing, { gradeId: 9 }, catalog);
        const earthStats = computeGearItemGrantedStats(earthSlots[0], 0, earthSlots, []);
        const earthSet = earthStats.setEffects.find((s) => s.sourceKind === "charm");
        assert(earthSet && earthSet.name.includes("Earth Enlightenment") && earthSet.maxPieces === 2 && earthSet.active, "Earth Charm resolves cleanly as active 2-Set Earth Enlightenment with 2x Enlightened Earth");
        assert(resolveCostumeCharmInfo(earthSlots[0].item.lunafrost, earthSlots)?.fullDesc.includes("Maximum Abyssal Charges"), "Earth Charm exposes full un-truncated Abyssal Charge description");
    });

    // 54. Cloak Synthesis Stat Selection (High vs Low tiers with duplicate unit_attribute_id never collide or downgrade)
    await test("Cloak synthesis stat selection distinguishes High vs Low tiers and preserves exact rolls across edits & grade upgrades", async () => {
        const catalog = await loadGearCatalog("../js/data/gear_catalog");
        const cloak = filterItemsForSlot(6, { query: "Erenor Arrowflash Cloak" }, catalog)[0];
        assert(Boolean(cloak), "Found Erenor Arrowflash Cloak in catalog");

        let slots = createEmptyGearSlots();
        slots = equipCatalogItemInSlot(slots, 6, cloak, { gradeId: 9 }, catalog); // Epic (3 synth lines)
        const epicPool = getAvailableSynthPool(slots[6].item.equipment, 9, catalog);
        const strHighIdx = epicPool.findIndex((p) => Number(p.unit_attribute_id) === 0);
        const strLowIdx = epicPool.findIndex((p, i) => i > strHighIdx && Number(p.unit_attribute_id) === 0);
        const staHighIdx = epicPool.findIndex((p) => Number(p.unit_attribute_id) === 2);
        const staLowIdx = epicPool.findIndex((p, i) => i > staHighIdx && Number(p.unit_attribute_id) === 2);
        assert(strHighIdx >= 0 && strLowIdx > strHighIdx && staHighIdx >= 0 && staLowIdx > staHighIdx, "Erenor Cloak Epic pool has distinct High & Low tiers for STR and STA");

        // 1. Select High STR on S1, then Low STA on S2 — S1 MUST stay High STR (not silently downgraded to Low!)
        slots = setSlotItemSynthStat(slots, 6, 0, `idx:${strHighIdx}`, catalog);
        slots = setSlotItemSynthStat(slots, 6, 1, `idx:${staLowIdx}`, catalog);
        assert(
            Number(slots[6].item.sythisis_stat[0].maxvalue) === Number(epicPool[strHighIdx].maxvalue),
            `S1 stays High STR (${slots[6].item.sythisis_stat[0].maxvalue}) after editing S2`
        );
        assert(
            Number(slots[6].item.sythisis_stat[1].maxvalue) === Number(epicPool[staLowIdx].maxvalue),
            `S2 keeps Low STA (${slots[6].item.sythisis_stat[1].maxvalue})`
        );
        assert(getSynthPoolIndexForStat(slots[6].item.sythisis_stat[0], epicPool) === strHighIdx, "S1 resolves back to exact High STR pool index");
        assert(getSynthPoolIndexForStat(slots[6].item.sythisis_stat[1], epicPool) === staLowIdx, "S2 resolves back to exact Low STA pool index");

        // 2. Switch S1 from High STR -> Low STR explicitly
        slots = setSlotItemSynthStat(slots, 6, 0, `idx:${strLowIdx}`, catalog);
        assert(
            Number(slots[6].item.sythisis_stat[0].maxvalue) === Number(epicPool[strLowIdx].maxvalue),
            "Switching S1 to Low STR selects exact Low STR roll"
        );
        slots = setSlotItemSynthStat(slots, 6, 0, `idx:${strHighIdx}`, catalog);

        // 3. Upgrade Epic (9) -> Mythic (11): S1 stays High STR tier and S2 stays Low STA tier, both scaling higher!
        const mythicSlots = setSlotItemGrade(slots, 6, 11, catalog);
        const mythicPool = getAvailableSynthPool(mythicSlots[6].item.equipment, 11, catalog);
        const mStrHigh = mythicPool.find((p) => Number(p.unit_attribute_id) === 0);
        const mStaEntries = mythicPool.filter((p) => Number(p.unit_attribute_id) === 2);
        assert(
            Number(mythicSlots[6].item.sythisis_stat[0].maxvalue) === Number(mStrHigh.maxvalue),
            `Mythic upgrade preserves S1 as High STR (${mythicSlots[6].item.sythisis_stat[0].maxvalue} === ${mStrHigh.maxvalue})`
        );
        assert(
            Number(mythicSlots[6].item.sythisis_stat[1].maxvalue) === Number(mStaEntries[1].maxvalue),
            `Mythic upgrade preserves S2 as Low STA (${mythicSlots[6].item.sythisis_stat[1].maxvalue} === ${mStaEntries[1].maxvalue})`
        );
    });

    // 55. Enlightened Accessory 3-Piece Sets (Berserker, Shadow, Arcanist +100% Mana, Oracle -30% Cast)
    await test("Enlightened Berserker, Shadow, Arcanist, and Oracle 3-piece accessory sets resolve, deduplicate pieces, and apply exact bonuses", async () => {
        const catalog = await loadGearCatalog("../js/data/gear_catalog");

        // 1. Enlightened Berserker (Necklace + Earring + Ring = 3/3; 2x Ring + 1x Earring = 2/3 inactive!)
        const bNeck = catalog.itemById.get(9002024);
        const bEar = catalog.itemById.get(9002022);
        const bRing = catalog.itemById.get(9002023);
        assert(Boolean(bNeck && bEar && bRing), "Found all 3 Enlightened Berserker accessories");

        let bDupSlots = createEmptyGearSlots();
        bDupSlots = equipCatalogItemInSlot(bDupSlots, 11, bEar, { gradeId: 9 }, catalog);
        bDupSlots = equipCatalogItemInSlot(bDupSlots, 13, bRing, { gradeId: 9 }, catalog);
        bDupSlots = equipCatalogItemInSlot(bDupSlots, 14, bRing, { gradeId: 9 }, catalog);
        const bDupSet = computeGearItemGrantedStats(bDupSlots[11], 11, bDupSlots).setEffects[0];
        assert(bDupSet && bDupSet.name === "Enlightened Berserker Set" && bDupSet.equippedCount === 2 && !bDupSet.tiers[0].active, "2x Berserker Rings + 1x Earring counts as 2/3 (inactive)");

        let bFull = equipCatalogItemInSlot(bDupSlots, 10, bNeck, { gradeId: 9 }, catalog);
        const bFullSet = computeGearItemGrantedStats(bFull[10], 10, bFull).setEffects[0];
        assert(
            bFullSet && bFullSet.equippedCount === 3 && bFullSet.tiers[0].active && bFullSet.tiers[0].summary.includes("Berserker's Instinct"),
            `3pc Enlightened Berserker activates Berserker's Instinct (${bFullSet?.tiers?.[0]?.summary})`
        );
        assert(
            computeActiveSetEffectSummaries(bFull).some((s) => s.name.includes("Enlightened Berserker Set")),
            "3pc Enlightened Berserker appears in Active Set Summaries"
        );
        // Toggleable Berserker's Instinct proc modifier adds +1,000 Attack Speed
        const baseChar = createDefaultCharacter({ offense: { attackSpeed: 0 } });
        const withInstinct = applyModifiers(baseChar, ["berserkers_instinct"]);
        assert(withInstinct.offense.attackSpeed === 1000, "Berserker's Instinct proc adds +1,000 Attack Speed");

        // 2. Enlightened Shadow (3pc: Ethereal Shift + Shadow Veil)
        let shSlots = createEmptyGearSlots();
        shSlots = equipCatalogItemInSlot(shSlots, 10, catalog.itemById.get(9001930), { gradeId: 9 }, catalog);
        shSlots = equipCatalogItemInSlot(shSlots, 11, catalog.itemById.get(9001928), { gradeId: 9 }, catalog);
        shSlots = equipCatalogItemInSlot(shSlots, 13, catalog.itemById.get(9001929), { gradeId: 9 }, catalog);
        const shSet = computeGearItemGrantedStats(shSlots[10], 10, shSlots).setEffects[0];
        assert(
            shSet && shSet.equippedCount === 3 && shSet.tiers[0].active && shSet.tiers[0].summary.includes("Shadow Veil"),
            "3pc Enlightened Shadow activates Ethereal Shift + Shadow Veil"
        );

        // 3. Enlightened Arcanist (3pc: Max Mana +100% [NOT +100 flat!] + Arcane Absorption)
        let arc2 = createEmptyGearSlots();
        arc2 = equipCatalogItemInSlot(arc2, 10, catalog.itemById.get(9001927), { gradeId: 9 }, catalog);
        arc2 = equipCatalogItemInSlot(arc2, 11, catalog.itemById.get(9001925), { gradeId: 9 }, catalog);
        const arc3 = equipCatalogItemInSlot(arc2, 13, catalog.itemById.get(9001926), { gradeId: 9 }, catalog);
        const mana2 = calculateDaruGearStats(createDefaultRawPlayer(), arc2).mana;
        const mana3 = calculateDaruGearStats(createDefaultRawPlayer(), arc3).mana;
        assert(mana3 - mana2 >= 5000, `3pc Enlightened Arcanist applies +100% Max Mana (not +100 flat): ${mana2} -> ${mana3}`);
        const arcSet = computeGearItemGrantedStats(arc3[10], 10, arc3).setEffects[0];
        assert(
            arcSet && arcSet.tiers[0].summary.includes("Max Mana +100.0%") && arcSet.tiers[0].summary.includes("Arcane Absorption"),
            `3pc Enlightened Arcanist shows Max Mana +100.0% + Arcane Absorption (${arcSet?.tiers?.[0]?.summary})`
        );

        // 4. Enlightened Oracle (3pc: Cast Time -30% + Fate's Edict Mana Cost -20%)
        let oraSlots = createEmptyGearSlots();
        oraSlots = equipCatalogItemInSlot(oraSlots, 10, catalog.itemById.get(9001933), { gradeId: 9 }, catalog);
        oraSlots = equipCatalogItemInSlot(oraSlots, 11, catalog.itemById.get(9001931), { gradeId: 9 }, catalog);
        oraSlots = equipCatalogItemInSlot(oraSlots, 13, catalog.itemById.get(9001932), { gradeId: 9 }, catalog);
        const oraSet = computeGearItemGrantedStats(oraSlots[10], 10, oraSlots).setEffects[0];
        assert(
            oraSet && oraSet.equippedCount === 3 && oraSet.tiers[0].active && oraSet.tiers[0].summary.includes("Cast Time -30.0%") && oraSet.tiers[0].summary.includes("Mana Cost -20%"),
            `3pc Enlightened Oracle shows Cast Time -30.0% + Mana Cost -20% (${oraSet?.tiers?.[0]?.summary})`
        );
    });

    // 56. Saved Skill Build Presets (extract, normalize, apply preserving target bakedPassives)
    await test("Saved Skill Build presets extract, sanitize, and apply across characters while preserving target bakedPassives", async () => {
        const sbData = await (await fetch("../js/data/skill_builder_data.json")).json();
        initSkillBuilderData(sbData);

        let sb = normalizeSkillBuild(
            {
                trees: ["battlerage", "shadowplay", "auramancy"],
                activeSkills: [
                    "battlerage_triple_slash",
                    "battlerage_charge",
                    "battlerage_whirlwind_slash",
                    "battlerage_precision_strike",
                    "battlerage_sunder_earth",
                    "battlerage_tiger_strike",
                    "battlerage_battle_focus",
                    "battlerage_frenzy",
                    "shadowplay_overwhelm",
                    "shadowplay_shadowsmite",
                ],
                passives: ["Reckless Charge", "Dual-Wield Proficiency", "Weapon Mastery"],
                ancestralChoices: { battlerage_tiger_strike: "lightning" },
                hatredTree: "battlerage",
                bakedPassives: ["Reckless Charge"],
            },
            null
        );

        // 1. Extract preset & round-trip through JSON + prototype-pollution safety
        const preset = extractSkillBuildPreset(sb, { name: "Raid Darkrunner" });
        assert(preset && preset.id === "raid-darkrunner" && preset.className === "Darkrunner", `Extracted Darkrunner preset (got ${preset?.className})`);
        assert(preset.totalPoints === getTotalPointsSpent(sb), `Preset tracks total points (${preset.totalPoints})`);
        assert(preset.ancestralChoices?.battlerage_tiger_strike === "lightning" && preset.hatredTree === "battlerage", "Preset preserves Ancestrals & Abyssal/Hatred tree");
        assert(!("bakedPassives" in preset), "Portable preset omits character-specific bakedPassives");

        const sanitized = normalizeSavedSkillPreset(
            JSON.parse(JSON.stringify({ ...preset, ancestralChoices: { ...preset.ancestralChoices, __proto__: "bad" } }))
        );
        assert(
            sanitized && !Object.prototype.hasOwnProperty.call(sanitized.ancestralChoices, "__proto__"),
            "normalizeSavedSkillPreset strips __proto__ keys cleanly"
        );

        // 2. Apply preset onto a different character that has its own bakedPassives (must NOT overwrite target's bakedPassives!)
        const targetChar = createDefaultCharacter({
            name: "Other Melee",
            skillBuild: {
                trees: ["battlerage", "defense", "auramancy"],
                activeSkills: [],
                passives: [],
                bakedPassives: ["Deflect and Retaliate"],
            },
        });
        const applied = applySkillBuildPresetToCharacter(targetChar, sanitized);
        assert(applied.className === "Darkrunner", "Target character adopts preset class (Darkrunner)");
        assert(applied.passives.includes("Weapon Mastery") && applied.ancestralChoices.battlerage_tiger_strike === "lightning", "Target receives preset passives & Ancestral choices");
        assert(
            applied.bakedPassives.length === 1 && applied.bakedPassives[0] === "Deflect and Retaliate",
            "Target character preserves its own bakedPassives (zero double-counting)"
        );
    });

    // 57. T7 Obsidian Special Effect Texts & Combat Math Hooks
    await test("T7 Obsidian special texts cover all 54 weapons/bows/instruments and factor combat-affecting effects", async () => {
        const catalog = await loadGearCatalog();
        const t7Ids = Object.keys(T7_OBSIDIAN_SPECIAL_EFFECTS).map(Number);
        assert(t7Ids.length === 54, `All 54 T7 Obsidian special effects registered (got ${t7Ids.length})`);
        for (let id = 40572; id <= 40625; id++) {
            const eff = getT7ObsidianSpecialEffect(id);
            assert(
                eff && typeof eff.text === "string" && eff.text.length > 10 && typeof eff.shortText === "string" && eff.shortText.length > 4,
                `T7 item #${id} has verbatim text & shortText`
            );
        }

        // 1. Jade Despair (#40610) displays full text and boosts Basic Gods' Whip by exactly +8% (while #40611 Mana Fountain does not)
        const baseChar = createBlankGearBuild(catalog, { name: "T7 Mage" });
        const player = createDefaultRawPlayer();
        const def = createDefaultCharacter({
            name: "Target Dummy",
            defense: { physicalDefense: 5000, magicDefense: 5000, toughness: 0, resilience: 0 },
        });

        let scep40610Slots = createEmptyGearSlots();
        scep40610Slots = equipCatalogItemInSlot(scep40610Slots, 15, catalog.itemById.get(40610), { gradeId: 9 }, catalog);
        const granted40610 = computeGearItemGrantedStats(scep40610Slots[15], 15, scep40610Slots);
        assert(
            granted40610.equipNotes.some((n) => n.kind === "t7" && n.engineFactored && n.text.includes("Basic Gods' Whip increases damage +8%")),
            `Jade Despair #40610 shows Gods' Whip +8% text in Granted Stats (${granted40610.equipNotes.map((n) => n.text).join("; ")})`
        );
        const activeSum40610 = computeActiveSetEffectSummaries(scep40610Slots);
        assert(
            activeSum40610.some((s) => s.category === "t7" && s.summary.includes("Basic Gods' Whip increases damage +8%")),
            "Jade Despair #40610 appears in Active Gear Buffs summary"
        );

        let scep40611Slots = createEmptyGearSlots();
        scep40611Slots = equipCatalogItemInSlot(scep40611Slots, 15, catalog.itemById.get(40611), { gradeId: 9 }, catalog);
        const mage40610 = recalculateCharacterFromGearBuilder(baseChar, scep40610Slots, player, catalog).character;
        const mage40611 = recalculateCharacterFromGearBuilder(baseChar, scep40611Slots, player, catalog).character;
        // Align magicAttack so only the T7 special effect differs
        mage40611.offense = { ...mage40610.offense };
        const godsWhip = {
            id: "sorcery_gods_whip",
            name: "Gods' Whip",
            skillset: "sorcery",
            variant: "base",
            kind: "damage",
            damageType: "magic",
            scalingStat: "magicAttack",
            base: 700,
            scalingPct: 240,
        };
        const whip40610 = simulateSkillDamage(mage40610, def, godsWhip);
        const whip40611 = simulateSkillDamage(mage40611, def, godsWhip);
        assert(whip40610.breakdown.skillGemBonusPct === 8, `Jade Despair #40610 adds +8% skill bonus to Gods' Whip (got ${whip40610.breakdown.skillGemBonusPct}%)`);
        assert(whip40611.breakdown.skillGemBonusPct === 0, `Jade Despair #40611 (Mana Fountain) adds +0% to Gods' Whip (got ${whip40611.breakdown.skillGemBonusPct}%)`);
        assertApprox(whip40610.normal / whip40611.normal, 1.08, 0.005, "Jade Despair #40610 increases Base Gods' Whip damage by exactly 1.08x");

        // 2. Deathfletcher (#40618) shreds -390 PDef on Basic Stalker's Mark (single-skill + rotation, no double-shred)
        let bowSlots = createEmptyGearSlots();
        bowSlots = equipCatalogItemInSlot(bowSlots, 17, catalog.itemById.get(40618), { gradeId: 9 }, catalog);
        const archerDf = recalculateCharacterFromGearBuilder(baseChar, bowSlots, player, catalog).character;
        archerDf.offense.rangedAttack = 1000;
        const archerPlain = createDefaultCharacter({ name: "Plain Archer", offense: { ...archerDf.offense } });
        const markedDef = applyModifiers(def, ["stalkers_mark"]);
        const physShot = {
            id: "archery_charged_bolt",
            name: "Charged Bolt",
            skillset: "archery",
            variant: "base",
            kind: "damage",
            damageType: "physical",
            scalingStat: "rangedAttack",
            base: 500,
            scalingPct: 200,
        };
        const singleDf = simulateSkillDamage(archerDf, markedDef, physShot);
        const singlePlain = simulateSkillDamage(archerPlain, markedDef, physShot);
        assert(
            singleDf.breakdown.t7DefenseShred === 390 && singleDf.breakdown.effectiveDefense === singlePlain.breakdown.effectiveDefense - 390,
            `Deathfletcher #40618 shreds -390 PDef vs Stalker's Marked target (${singleDf.breakdown.effectiveDefense} vs ${singlePlain.breakdown.effectiveDefense})`
        );
        assert(singleDf.normal > singlePlain.normal, "Deathfletcher -390 PDef shred increases physical damage");

        const stalkersMarkSkill = {
            id: "shadowplay_stalkers_mark",
            name: "Stalker's Mark",
            skillset: "shadowplay",
            variant: "base",
            kind: "damage",
            damageType: "physical",
            scalingStat: "rangedAttack",
            base: 237,
            scalingPct: 100,
        };
        const rotDf = simulateRotation(
            archerDf,
            def,
            [{ skill: stalkersMarkSkill }, { skill: physShot }]
        );
        const rotPlain = simulateRotation(
            archerPlain,
            def,
            [{ skill: stalkersMarkSkill }, { skill: physShot }]
        );
        assert(
            rotDf.steps[1].result.breakdown.effectiveDefense === rotPlain.steps[1].result.breakdown.effectiveDefense - 390,
            `Rotation Stalker's Mark with Deathfletcher shreds -390 PDef on follow-up shot (${rotDf.steps[1].result.breakdown.effectiveDefense} vs ${rotPlain.steps[1].result.breakdown.effectiveDefense})`
        );
        // Zero double-shred if Defender ALSO has stalkers_mark chip active
        const rotDfMarked = simulateRotation(
            archerDf,
            markedDef,
            [{ skill: stalkersMarkSkill }, { skill: physShot }]
        );
        assert(
            rotDfMarked.steps[1].result.breakdown.effectiveDefense === rotDf.steps[1].result.breakdown.effectiveDefense,
            "Deathfletcher -390 PDef does not double-count when stalkers_mark chip is also toggled"
        );

        // 3. Insanity Point (#40574) extends Basic Drop Back combo window from 2.5s to 3.0s
        let dagSlots = createEmptyGearSlots();
        dagSlots = equipCatalogItemInSlot(dagSlots, 16, catalog.itemById.get(40574), { gradeId: 9 }, catalog);
        const mageIp = recalculateCharacterFromGearBuilder(baseChar, dagSlots, player, catalog).character;
        const dropBackSkill = {
            id: "shadowplay_drop_back",
            name: "Drop Back",
            skillset: "shadowplay",
            variant: "base",
            kind: "utility",
            gcdSec: 0.5,
            comboEffect: {
                id: "drop_back",
                label: "Drop Back",
                durationSec: 2.5,
                removesCastTimeFor: ["sorcery_flamebolt"],
            },
        };
        const rotIp = simulateRotation(mageIp, def, [{ skill: dropBackSkill }]);
        const dbSpan = rotIp.effectSpans.find((e) => e.id === "drop_back");
        assert(dbSpan && Math.abs(dbSpan.durationSec - 3.0) < 1e-6, `Insanity Point #40574 extends Drop Back to 3.0s (got ${dbSpan?.durationSec}s)`);

        // 4. Moonsong Razor (#40583) suppresses Dissonance debuff & Lidless Rage (#40614) grants instant Charmed on Startling Strain
        let katSlots = createEmptyGearSlots();
        katSlots = equipCatalogItemInSlot(katSlots, 15, catalog.itemById.get(40583), { gradeId: 9 }, catalog);
        const katChar = recalculateCharacterFromGearBuilder(baseChar, katSlots, player, catalog).character;
        const dissSkill = {
            id: "songcraft_dissonance",
            name: "Dissonance",
            skillset: "songcraft",
            variant: "base",
            kind: "damage",
            damageType: "magic",
            scalingStat: "magicAttack",
            base: 400,
            scalingPct: 120,
        };
        const rotKat = simulateRotation(katChar, def, [{ skill: dissSkill }]);
        assert(
            !rotKat.effectSpans.some((e) => e.id === "dissonance"),
            "Moonsong Razor #40583 casts Basic Dissonance without granting the Dissonance debuff"
        );

        let staffSlots = createEmptyGearSlots();
        staffSlots = equipCatalogItemInSlot(staffSlots, 15, catalog.itemById.get(40614), { gradeId: 9 }, catalog);
        const staffChar = recalculateCharacterFromGearBuilder(baseChar, staffSlots, player, catalog).character;
        const strainSkill = {
            id: "songcraft_startling_strain",
            name: "Startling Strain",
            skillset: "songcraft",
            variant: "base",
            kind: "utility",
        };
        const rotStaff = simulateRotation(staffChar, def, [{ skill: strainSkill }]);
        assert(
            rotStaff.effectSpans.some((e) => e.id === "charmed") && !rotStaff.effectSpans.some((e) => e.id === "stunned"),
            "Lidless Rage #40614 makes Basic Startling Strain immediately apply Charmed instead of Stunned"
        );
    });

    return results;
}
