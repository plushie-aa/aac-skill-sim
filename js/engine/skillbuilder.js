/**
 * ArcheAge Classic 1.3.6 / 3.5 Skill Builder Engine & Passive Math.
 *
 * Features:
 *  - Exact 10-skillset / 28-point Skill Builder rules matching live AA Classic & DaruGear
 *  - 120-class name resolution (tree combo <-> class name)
 *  - Zero double-counting passive stat math:
 *      * Sheet-baked static passives apply strictly as (selectedNow - bakedPassives) deltas
 *      * Always-on combat passives (Weapon Mastery, Aranzeb's Infusion, Feral Claws,
 *        Absorb Damage, DW Ranged Parry, and -10%/-20% skillset CD reductions) apply directly
 *      * Deduplicates Weapon Mastery / Aranzeb's Infusion / Feral Claws with Buffs chips
 *  - Direct DaruGear `player.playerclass` import parser
 */

import { DEFAULT_CONSTANTS } from "./constants.js";
import { applyAttributeDelta, applyOverrides, clamp, registerSkillBuildApplier } from "./stats.js";

export const MAX_SKILL_POINTS = 28;

export const SKILL_TREE_ID_TO_SLUG = Object.freeze({
    1: "battlerage",
    2: "witchcraft",
    3: "defense",
    4: "auramancy",
    5: "occultism",
    6: "archery",
    7: "sorcery",
    8: "shadowplay",
    9: "songcraft",
    10: "vitalism",
});

export const SKILL_TREE_SLUG_TO_ID = Object.freeze({
    battlerage: 1,
    witchcraft: 2,
    defense: 3,
    auramancy: 4,
    occultism: 5,
    archery: 6,
    sorcery: 7,
    shadowplay: 8,
    songcraft: 9,
    vitalism: 10,
});

let _sbData = null;
let _passiveByNameLower = new Map();
let _passiveByKey = new Map();
let _activeByNameLower = new Map();
let _classKeyToName = new Map();
let _classNameToTrees = new Map();

export function initSkillBuilderData(data) {
    if (!data || typeof data !== "object" || !data.trees) return;
    _sbData = data;
    _passiveByNameLower = new Map();
    _passiveByKey = new Map();
    _activeByNameLower = new Map();
    _classKeyToName = new Map();
    _classNameToTrees = new Map();

    for (const [slug, tree] of Object.entries(data.trees)) {
        for (const p of tree.passives || []) {
            const entry = { ...p, treeSlug: slug, treeName: tree.name };
            _passiveByNameLower.set(p.name.toLowerCase(), entry);
            _passiveByKey.set(p.key, entry);
        }
        for (const a of tree.actives || []) {
            _activeByNameLower.set(`${slug}:${a.name.toLowerCase()}`, { ...a, treeSlug: slug });
            if (!_activeByNameLower.has(a.name.toLowerCase())) {
                _activeByNameLower.set(a.name.toLowerCase(), { ...a, treeSlug: slug });
            }
        }
    }

    for (const [k, name] of Object.entries(data.classes || {})) {
        _classKeyToName.set(k, name);
        const parts = k
            .replace(/^name_/, "")
            .split("_")
            .map((x) => SKILL_TREE_ID_TO_SLUG[Number(x)])
            .filter(Boolean);
        if (parts.length === 3) {
            _classNameToTrees.set(name.toLowerCase(), parts);
        }
    }
}

export function getSkillBuilderData() {
    return _sbData;
}

/**
 * Synchronize Skill Breakdown ancestral entries (`state.allSkills`) from the canonical
 * Skill Builder dataset (`skill_builder_data.json`) so both views share a single source
 * of truth for ancestral element names, icons, and metadata.
 */
export function syncSkillBreakdownAncestralsFromBuilder(allSkills = [], sbData = _sbData) {
    if (!Array.isArray(allSkills) || !sbData || !sbData.trees) return 0;
    const bySimId = new Map();
    for (const tree of Object.values(sbData.trees)) {
        for (const act of tree.actives || []) {
            for (const v of act.ancestrals || []) {
                const ids = Array.isArray(v.simSkillIds) ? [...v.simSkillIds] : [];
                if (v.simSkillId && !ids.includes(v.simSkillId)) ids.push(v.simSkillId);
                for (const sid of ids) {
                    bySimId.set(sid, {
                        baseName: act.name,
                        elementId: v.id,
                        element: v.element,
                        icon: v.icon ? String(v.icon).replace(/^assets\/icons\//i, "") : null,
                    });
                }
            }
        }
    }
    let synced = 0;
    for (const sk of allSkills) {
        if (!sk || sk.variant !== "ancestral") continue;
        const canon = bySimId.get(sk.id);
        if (!canon) continue;
        // Preserve any explicit role suffix after '·' (e.g. "Heal", "AoE Heal", "AoE Damage", "per sec")
        const suffixMatch = String(sk.name || "").match(/\([^)]*·\s*([^)]+)\)\s*$/);
        const roleSuffix = suffixMatch ? suffixMatch[1].trim() : null;
        sk.name = roleSuffix
            ? `${canon.baseName} (${canon.element} · ${roleSuffix})`
            : `${canon.baseName} (${canon.element})`;
        if (canon.icon) sk.icon = canon.icon;
        sk.ancestralElement = canon.elementId;
        synced++;
    }
    return synced;
}

export function getPassiveMeta(nameOrKey) {
    if (!nameOrKey) return null;
    const raw = String(nameOrKey).trim();
    return _passiveByKey.get(raw) || _passiveByNameLower.get(raw.toLowerCase()) || null;
}

export function resolveClassName(trees = []) {
    const ids = Array.from(
        new Set(
            (trees || [])
                .map((t) => (typeof t === "number" ? t : SKILL_TREE_SLUG_TO_ID[String(t || "").toLowerCase()]))
                .filter((id) => Number.isFinite(id) && id >= 1 && id <= 10)
        )
    ).sort((a, b) => a - b);
    if (ids.length !== 3) return null;
    const key = `name_${ids.join("_")}`;
    return _classKeyToName.get(key) || null;
}

export function treesForClassName(className) {
    if (!className) return null;
    const found = _classNameToTrees.get(String(className).trim().toLowerCase());
    return found ? [...found] : null;
}

function inferDefaultTreesForCharacter(character) {
    const cls = character?.metadata?.className || character?.className;
    const byClass = treesForClassName(cls);
    if (byClass) return byClass;

    // Infer from metadata.passives if any are recorded
    const rawPassives = Array.isArray(character?.metadata?.passives) ? character.metadata.passives : [];
    const inferredFromPassives = [];
    for (const pn of rawPassives) {
        const meta = getPassiveMeta(pn);
        if (meta && !inferredFromPassives.includes(meta.treeSlug)) {
            inferredFromPassives.push(meta.treeSlug);
        }
    }

    const off = character?.offense || {};
    const mAtk = Number(off.meleeAttack) || 0;
    const rAtk = Number(off.rangedAttack) || 0;
    const magAtk = Number(off.magicAttack) || 0;
    const hPwr = Number(off.healingPower) || 0;
    let fallback = ["battlerage", "auramancy", "shadowplay"]; // Darkrunner
    if (hPwr >= mAtk && hPwr >= rAtk && hPwr >= magAtk && hPwr > 200) {
        fallback = ["auramancy", "songcraft", "vitalism"]; // Cleric
    } else if (magAtk >= mAtk && magAtk >= rAtk && magAtk > 200) {
        fallback = ["sorcery", "shadowplay", "songcraft"]; // Spellsinger
    } else if (rAtk >= mAtk && rAtk > 200) {
        fallback = ["archery", "shadowplay", "songcraft"]; // Ebonsong
    }

    const merged = [...inferredFromPassives];
    for (const slug of fallback) {
        if (merged.length >= 3) break;
        if (!merged.includes(slug)) merged.push(slug);
    }
    return merged.slice(0, 3);
}

/**
 * Normalize or construct a SkillBuild object for a character.
 * Preserves `bakedPassives` so DaruGear-imported stats are never double-counted.
 */
export function normalizeSkillBuild(rawSkillBuild, character = null) {
    const validTrees = new Set(Object.keys(SKILL_TREE_SLUG_TO_ID));
    let trees = Array.isArray(rawSkillBuild?.trees)
        ? rawSkillBuild.trees.map((t) => String(t || "").toLowerCase()).filter((t) => validTrees.has(t))
        : [];
    trees = Array.from(new Set(trees));
    if (trees.length < 3) {
        const defaults = inferDefaultTreesForCharacter(character);
        for (const d of defaults) {
            if (trees.length >= 3) break;
            if (!trees.includes(d)) trees.push(d);
        }
    }
    trees = trees.slice(0, 3);
    const treeSet = new Set(trees);

    const activeSkills = Array.isArray(rawSkillBuild?.activeSkills)
        ? Array.from(new Set(rawSkillBuild.activeSkills.map((k) => String(k || "").trim()).filter(Boolean)))
        : [];

    // Canonicalize passive names to exact display names matching skill_builder_data.json
    const canonPassive = (p) => {
        const meta = getPassiveMeta(p);
        return meta ? meta.name : String(p || "").trim();
    };

    const rawPassives = Array.isArray(rawSkillBuild?.passives)
        ? rawSkillBuild.passives
        : Array.isArray(character?.metadata?.passives)
          ? character.metadata.passives
          : [];
    const passives = Array.from(
        new Set(
            rawPassives
                .map(canonPassive)
                .filter((pn) => {
                    const m = getPassiveMeta(pn);
                    return m ? treeSet.has(m.treeSlug) : Boolean(pn);
                })
        )
    );

    const rawBaked = Array.isArray(rawSkillBuild?.bakedPassives)
        ? rawSkillBuild.bakedPassives
        : Array.isArray(character?.metadata?.passives)
          ? character.metadata.passives
          : [];
    const bakedPassives = Array.from(
        new Set(
            rawBaked
                .map(canonPassive)
                .filter((pn) => {
                    const m = getPassiveMeta(pn);
                    return !m || m.effectKind === "sheet";
                })
        )
    );

    const hatredTree =
        rawSkillBuild?.hatredTree && treeSet.has(String(rawSkillBuild.hatredTree).toLowerCase())
            ? String(rawSkillBuild.hatredTree).toLowerCase()
            : null;

    const actSet = new Set(activeSkills);
    const ancestralChoices = {};
    if (rawSkillBuild?.ancestralChoices && typeof rawSkillBuild.ancestralChoices === "object") {
        for (const [skKey, elemId] of Object.entries(rawSkillBuild.ancestralChoices)) {
            if (!actSet.has(skKey) || !elemId) continue;
            const slug = skKey.split("_")[0];
            if (!treeSet.has(slug)) continue;
            ancestralChoices[skKey] = String(elemId).toLowerCase();
        }
    }

    return {
        trees,
        activeSkills,
        passives,
        bakedPassives,
        ancestralChoices,
        hatredTree,
        className: resolveClassName(trees) || character?.metadata?.className || character?.className || null,
    };
}

export function getTreePointsSpent(skillBuild, treeSlug) {
    if (!skillBuild || !_sbData?.trees?.[treeSlug]) return 0;
    const tree = _sbData.trees[treeSlug];
    const actSet = new Set(skillBuild.activeSkills || []);
    const pasSet = new Set((skillBuild.passives || []).map((p) => String(p).toLowerCase()));
    let pts = 0;
    for (const a of tree.actives || []) {
        if (actSet.has(a.key)) pts += a.points || 1;
    }
    for (const p of tree.passives || []) {
        if (pasSet.has(p.name.toLowerCase()) || pasSet.has(p.key.toLowerCase())) {
            pts += p.points || 1;
        }
    }
    return pts;
}

export function getTotalPointsSpent(skillBuild) {
    if (!skillBuild) return 0;
    return (skillBuild.trees || []).reduce((sum, slug) => sum + getTreePointsSpent(skillBuild, slug), 0);
}

/**
 * Check if a passive is unlocked in a tree.
 * Matches AA Classic 3.5 / DaruGear: total points spent in the tree (excluding this passive if already picked)
 * must meet or exceed `passive.reqPoints`.
 */
export function isPassiveUnlocked(skillBuild, treeSlug, passive) {
    if (!skillBuild || !passive) return false;
    const pasSet = new Set((skillBuild.passives || []).map((p) => String(p).toLowerCase()));
    const alreadySelected = pasSet.has(passive.name.toLowerCase()) || pasSet.has(passive.key.toLowerCase());
    const pts = getTreePointsSpent(skillBuild, treeSlug);
    const ptsWithoutSelf = alreadySelected ? Math.max(0, pts - (passive.points || 1)) : pts;
    return ptsWithoutSelf >= (passive.reqPoints || 0);
}

/**
 * Cascade-deselect passives in `treeSlug` from highest reqPoints downward
 * if their prerequisite point threshold is no longer satisfied.
 */
export function cascadeInvalidPassives(skillBuild, treeSlug) {
    const tree = _sbData?.trees?.[treeSlug];
    if (!tree) return skillBuild;
    const next = {
        ...skillBuild,
        activeSkills: [...(skillBuild.activeSkills || [])],
        passives: [...(skillBuild.passives || [])],
    };
    const sortedPassives = [...(tree.passives || [])].sort((a, b) => (b.reqPoints || 0) - (a.reqPoints || 0));
    let changed = true;
    while (changed) {
        changed = false;
        for (const p of sortedPassives) {
            const idx = next.passives.findIndex(
                (n) => n.toLowerCase() === p.name.toLowerCase() || n.toLowerCase() === p.key.toLowerCase()
            );
            if (idx < 0) continue;
            const ptsNow = getTreePointsSpent(next, treeSlug);
            const ptsWithoutSelf = ptsNow - (p.points || 1);
            if (ptsWithoutSelf < (p.reqPoints || 0)) {
                next.passives.splice(idx, 1);
                changed = true;
                break;
            }
        }
    }
    return next;
}

export function toggleActiveSkill(skillBuild, treeSlug, skillKey) {
    const next = {
        ...skillBuild,
        activeSkills: [...(skillBuild.activeSkills || [])],
        passives: [...(skillBuild.passives || [])],
        ancestralChoices: { ...(skillBuild.ancestralChoices || {}) },
    };
    const idx = next.activeSkills.indexOf(skillKey);
    if (idx >= 0) {
        next.activeSkills.splice(idx, 1);
        delete next.ancestralChoices[skillKey];
        return { skillBuild: cascadeInvalidPassives(next, treeSlug), changed: true, reason: null };
    }
    if (getTotalPointsSpent(next) >= MAX_SKILL_POINTS) {
        return { skillBuild: next, changed: false, reason: `Max ${MAX_SKILL_POINTS} skill points reached` };
    }
    next.activeSkills.push(skillKey);
    return { skillBuild: next, changed: true, reason: null };
}

/**
 * Select an Ancestral elemental variant (or `"base"` / `null` for Base) on an active skill.
 * If the skill isn't selected yet, auto-selects it (enforcing the 28-pt cap).
 */
export function setAncestralVariant(skillBuild, treeSlug, skillKey, variantId) {
    const tree = _sbData?.trees?.[treeSlug];
    const act = tree?.actives?.find((a) => a.key === skillKey);
    if (!act || !Array.isArray(act.ancestrals) || act.ancestrals.length === 0) {
        return { skillBuild, changed: false, reason: "Skill has no Ancestral variants" };
    }
    const next = {
        ...skillBuild,
        activeSkills: [...(skillBuild.activeSkills || [])],
        passives: [...(skillBuild.passives || [])],
        ancestralChoices: { ...(skillBuild.ancestralChoices || {}) },
    };

    const cleanId = variantId && variantId !== "base" ? String(variantId).toLowerCase() : null;
    if (cleanId && !act.ancestrals.some((v) => v.id === cleanId)) {
        return { skillBuild, changed: false, reason: "Unknown Ancestral variant" };
    }

    if (!next.activeSkills.includes(skillKey)) {
        if (!cleanId) return { skillBuild: next, changed: false, reason: null };
        if (getTotalPointsSpent(next) >= MAX_SKILL_POINTS) {
            return { skillBuild: next, changed: false, reason: `Max ${MAX_SKILL_POINTS} skill points reached` };
        }
        next.activeSkills.push(skillKey);
    }

    if (!cleanId) {
        delete next.ancestralChoices[skillKey];
    } else {
        next.ancestralChoices[skillKey] = cleanId;
    }
    return { skillBuild: next, changed: true, reason: null };
}

export function togglePassiveSkill(skillBuild, treeSlug, passiveNameOrKey) {
    const meta = getPassiveMeta(passiveNameOrKey);
    if (!meta || meta.treeSlug !== treeSlug) {
        return { skillBuild, changed: false, reason: "Unknown passive" };
    }
    const next = {
        ...skillBuild,
        activeSkills: [...(skillBuild.activeSkills || [])],
        passives: [...(skillBuild.passives || [])],
    };
    const idx = next.passives.findIndex(
        (n) => n.toLowerCase() === meta.name.toLowerCase() || n.toLowerCase() === meta.key.toLowerCase()
    );
    if (idx >= 0) {
        next.passives.splice(idx, 1);
        return { skillBuild: cascadeInvalidPassives(next, treeSlug), changed: true, reason: null };
    }
    if (!isPassiveUnlocked(next, treeSlug, meta)) {
        return {
            skillBuild: next,
            changed: false,
            reason: `Requires ${meta.reqPoints} points in ${meta.treeName}`,
        };
    }
    if (getTotalPointsSpent(next) >= MAX_SKILL_POINTS) {
        return { skillBuild: next, changed: false, reason: `Max ${MAX_SKILL_POINTS} skill points reached` };
    }
    next.passives.push(meta.name);
    return { skillBuild: next, changed: true, reason: null };
}

export function setSkillBuildTree(skillBuild, slotIndex, newTreeSlug) {
    const slug = String(newTreeSlug || "").toLowerCase();
    if (!SKILL_TREE_SLUG_TO_ID[slug]) return skillBuild;
    const trees = [...(skillBuild.trees || [])];
    const oldSlug = trees[slotIndex];
    if (oldSlug === slug) return skillBuild;

    // If the chosen tree is already in another slot, swap the two slots cleanly
    const existingIdx = trees.indexOf(slug);
    if (existingIdx >= 0) {
        trees[existingIdx] = oldSlug;
        trees[slotIndex] = slug;
        return {
            ...skillBuild,
            trees,
            className: resolveClassName(trees),
        };
    }

    trees[slotIndex] = slug;
    const removedTree = _sbData?.trees?.[oldSlug];
    const removedActKeys = new Set((removedTree?.actives || []).map((a) => a.key));
    const removedPasNames = new Set((removedTree?.passives || []).map((p) => p.name.toLowerCase()));

    const nextActives = (skillBuild.activeSkills || []).filter((k) => !removedActKeys.has(k));
    const nextPassives = (skillBuild.passives || []).filter((p) => !removedPasNames.has(String(p).toLowerCase()));
    const nextHatred = skillBuild.hatredTree === oldSlug ? null : skillBuild.hatredTree;
    const nextAncestrals = {};
    for (const [k, v] of Object.entries(skillBuild.ancestralChoices || {})) {
        if (!removedActKeys.has(k)) nextAncestrals[k] = v;
    }

    return {
        ...skillBuild,
        trees,
        activeSkills: nextActives,
        passives: nextPassives,
        ancestralChoices: nextAncestrals,
        hatredTree: nextHatred,
        className: resolveClassName(trees),
    };
}

export function toggleHatredTree(skillBuild, treeSlug) {
    const slug = String(treeSlug || "").toLowerCase();
    return {
        ...skillBuild,
        hatredTree: skillBuild.hatredTree === slug ? null : slug,
    };
}

/**
 * Parse a DaruGear `player.playerclass` object (from bookmarklet or DaruGear Share API)
 * into our normalized SkillBuild schema.
 */
export function extractSkillBuildFromDaruGearPlayerClass(pc) {
    if (!pc || typeof pc !== "object") return null;
    const trees = [];
    const activeSkills = [];
    const passives = [];
    let hatredTree = null;

    for (const k of ["skill1", "skill2", "skill3"]) {
        const sk = pc[k];
        if (!sk) continue;
        const tid = Number(sk.treeid ?? sk.id ?? sk.ability_id);
        const slug = SKILL_TREE_ID_TO_SLUG[tid];
        if (!slug) continue;
        if (!trees.includes(slug)) trees.push(slug);
        if (sk.is_hatred) hatredTree = slug;

        const treeData = _sbData?.trees?.[slug];
        const actByName = new Map((treeData?.actives || []).map((a) => [a.name.toLowerCase(), a.key]));

        for (const a of Array.isArray(sk.Actives) ? sk.Actives : []) {
            if (!a || a.selected !== true) continue;
            const nm = String(a.skill_name || a.name || "").trim();
            if (!nm) continue;
            const key =
                actByName.get(nm.toLowerCase()) ||
                `${slug}_${nm.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
            if (!activeSkills.includes(key)) activeSkills.push(key);
        }

        for (const p of Array.isArray(sk.Passive) ? sk.Passive : []) {
            if (!p || p.selected !== true) continue;
            const nm = String(p.name || "").trim();
            if (!nm) continue;
            const meta = getPassiveMeta(nm);
            const canonical = meta ? meta.name : nm;
            if (!passives.includes(canonical)) passives.push(canonical);
        }
    }

    if (trees.length === 0) return null;

    const bakedPassives = passives.filter((pn) => {
        const m = getPassiveMeta(pn);
        return !m || m.effectKind === "sheet";
    });

    return {
        trees,
        activeSkills,
        passives,
        bakedPassives,
        hatredTree,
        className: resolveClassName(trees) || pc.class_name || pc.name || null,
    };
}

/**
 * Apply Skill Builder passives to a character without double-counting DaruGear-baked sheet passives.
 *
 *  1. Static sheet passives: applies delta = (selectedSheetPassives - bakedPassives)
 *     - Added sheet passives add their stats cleanly
 *     - Removed baked sheet passives reverse their stats symmetrically
 *  2. Always-on combat passives (never baked into DaruGear sheet):
 *     - Weapon Mastery (+15% Battlerage), Aranzeb's Infusion (+15% Sorcery), Feral Claws (+15% Archery)
 *       (auto-deduplicated if the corresponding Buffs chip is already active!)
 *     - Absorb Damage (Auramancy: 7% received dmg -> HP = +7% effective received DR)
 *     - Dual-Wield Proficiency: sets `dualWieldRangedParry` when Dual Wield
 *     - Skillset Cooldown Reductions (-10% Battlerage / -20% Witchcraft, Defense, Occultism, Shadowplay, Vitalism)
 */
export function applySkillBuildPassives(character, activeModifierIds = []) {
    const sb = character?.skillBuild;
    if (!sb || !_sbData || character?._skillBuildApplied) {
        return {
            character,
            summary: {
                addedSheet: [],
                removedSheet: [],
                combatPassives: [],
                linkedProcs: [],
                totalPoints: sb ? getTotalPointsSpent(sb) : 0,
                className: sb ? resolveClassName(sb.trees) || sb.className : character?.metadata?.className || character?.className || null,
            },
        };
    }

    const out = applyOverrides(character, {});
    const activeModSet = new Set(
        (activeModifierIds || []).map((t) => (typeof t === "string" ? t.split(":")[0] : t?.id || ""))
    );

    const selectedMeta = [];
    const selectedSet = new Set();
    for (const pn of sb.passives || []) {
        const m = getPassiveMeta(pn);
        if (m && !selectedSet.has(m.name)) {
            selectedSet.add(m.name);
            selectedMeta.push(m);
        }
    }

    const bakedSet = new Set();
    const bakedMeta = [];
    for (const pn of sb.bakedPassives || []) {
        const m = getPassiveMeta(pn);
        if (m && m.effectKind === "sheet" && !bakedSet.has(m.name)) {
            bakedSet.add(m.name);
            bakedMeta.push(m);
        }
    }

    const addedSheet = selectedMeta.filter((m) => m.effectKind === "sheet" && !bakedSet.has(m.name));
    const removedSheet = bakedMeta.filter((m) => !selectedSet.has(m.name));
    const combatPassives = [];
    const linkedProcs = [];

    const applySheetDelta = (meta, sign) => {
        if (meta.addMaxHealth) {
            out.maxHealth = Math.max(1, (Number(out.maxHealth) || 0) + meta.addMaxHealth * sign);
        }
        if (meta.mulMaxMana) {
            const factor = Number(meta.mulMaxMana) || 1;
            const intMana = (Number(out.attributes?.int) || 0) * 12;
            const baseMana = Math.max(0, (Number(out.maxMana) || 0) - intMana);
            const nextBase = sign > 0 ? baseMana * factor : baseMana / factor;
            out.maxMana = Math.max(0, Math.round(nextBase + intMana));
        }
        if (meta.mulAttributePct) {
            for (const [attrK, pct] of Object.entries(meta.mulAttributePct)) {
                const cur = Number(out.attributes?.[attrK]) || 0;
                const factor = 1 + (Number(pct) || 0) / 100;
                const delta = sign > 0 ? cur * (factor - 1) : -(cur - cur / factor);
                applyAttributeDelta(out, { [attrK]: delta }, 1);
            }
        }
        if (meta.addOffense) {
            for (const [k, delta] of Object.entries(meta.addOffense)) {
                out.offense[k] = (Number(out.offense[k]) || 0) + Number(delta) * sign;
            }
        }
        if (meta.mulOffense) {
            for (const [k, factor] of Object.entries(meta.mulOffense)) {
                const f = Number(factor) || 1;
                const cur = Number(out.offense[k]) || 0;
                out.offense[k] = sign > 0 ? cur * f : cur / f;
            }
        }
        if (meta.addDefense) {
            for (const [k, delta] of Object.entries(meta.addDefense)) {
                out.defense[k] = (Number(out.defense[k]) || 0) + Number(delta) * sign;
            }
        }
    };

    for (const m of removedSheet) applySheetDelta(m, -1);
    for (const m of addedSheet) applySheetDelta(m, +1);

    // Always-on combat passives (never baked by DaruGear)
    const skillsetBonuses = { ...(out.skillsetDamageBonusPct || {}) };
    const skillsetCdr = { ...(out.skillsetCooldownReductionPct || {}) };
    const activeFlags = { ...(out._activeBuffFlags || {}) };

    let hasDwProfSelected = false;
    for (const m of selectedMeta) {
        if (m.grantsDwRangedParry) {
            hasDwProfSelected = true;
            const eqType = out.metadata?.equipmentType;
            if (eqType === "dual_wield" || (!out.defense.hasShield && eqType !== "two_hand")) {
                out.defense.dualWieldRangedParry = true;
                combatPassives.push(m);
            }
        }
        if (m.skillsetDamageBonusPct) {
            const alreadyViaChip = m.dedupBuffId && activeModSet.has(m.dedupBuffId);
            if (!alreadyViaChip) {
                for (const [tree, pct] of Object.entries(m.skillsetDamageBonusPct)) {
                    skillsetBonuses[tree] = (skillsetBonuses[tree] || 0) + Number(pct);
                }
            }
            combatPassives.push(m);
        }
        if (m.cooldownReduction) {
            for (const [tree, pct] of Object.entries(m.cooldownReduction)) {
                skillsetCdr[tree] = Math.min(50, (skillsetCdr[tree] || 0) + Number(pct));
            }
            combatPassives.push(m);
        }
        if (m.absorbDamagePct) {
            // ArcheAge "damage converted to HP" (e.g. Auramancy Absorb Damage 7%) restores HP AFTER a hit
            // rather than reducing incoming damage — do NOT add to received DR%.
            const pct = Number(m.absorbDamagePct) || 0;
            activeFlags.absorbDamagePct = (Number(activeFlags.absorbDamagePct) || 0) + pct;
            combatPassives.push(m);
        }
        if (m.linkedBuffId) {
            linkedProcs.push(m);
        }
    }

    // If Dual-Wield Proficiency was baked on import and subsequently unchecked, turn off DW ranged parry
    if (!hasDwProfSelected && bakedSet.has("Dual-Wield Proficiency")) {
        out.defense.dualWieldRangedParry = false;
    }

    // Clamp key stats to AA Classic 3.5 bounds
    out.offense.castTimePct = clamp(Number(out.offense.castTimePct ?? 100), 40, 200);
    out.offense.meleeAccuracyPct = clamp(Number(out.offense.meleeAccuracyPct ?? 100), 0, 100);
    out.offense.rangedAccuracyPct = clamp(Number(out.offense.rangedAccuracyPct ?? 100), 0, 100);
    out.offense.magicAccuracyPct = clamp(Number(out.offense.magicAccuracyPct ?? 100), 0, 100);
    const maxCb = DEFAULT_CONSTANTS.maxCritBonusPct;
    out.offense.meleeCritBonusPct = Math.min(maxCb, Math.max(0, Number(out.offense.meleeCritBonusPct) || 0));
    out.offense.rangedCritBonusPct = Math.min(maxCb, Math.max(0, Number(out.offense.rangedCritBonusPct) || 0));
    out.offense.magicCritBonusPct = Math.min(maxCb, Math.max(0, Number(out.offense.magicCritBonusPct) || 0));
    out.offense.healCritBonusPct = Math.min(maxCb, Math.max(0, Number(out.offense.healCritBonusPct) || 0));
    out.defense.physicalDefense = Math.max(0, Number(out.defense.physicalDefense) || 0);
    out.defense.magicDefense = Math.max(0, Number(out.defense.magicDefense) || 0);
    out.defense.evasionPct = Math.max(0, Number(out.defense.evasionPct) || 0);
    out.defense.parryPct = Math.max(0, Number(out.defense.parryPct) || 0);

    out.skillsetDamageBonusPct = skillsetBonuses;
    out.skillsetCooldownReductionPct = skillsetCdr;
    out._activeBuffFlags = activeFlags;
    out._skillBuildApplied = true;

    return {
        character: out,
        summary: {
            addedSheet,
            removedSheet,
            combatPassives,
            linkedProcs,
            totalPoints: getTotalPointsSpent(sb),
            className: resolveClassName(sb.trees) || sb.className || null,
        },
    };
}

registerSkillBuildApplier(applySkillBuildPassives);

const FORBIDDEN_PRESET_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function slugifySkillPresetId(raw) {
    const s = String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^[-_]+|[-_]+$/g, "");
    return (s || `skill-build-${Date.now()}`).slice(0, 64);
}

/**
 * Sanitize a reusable Skill Build preset loaded from disk/localStorage.
 */
export function normalizeSavedSkillPreset(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const name = String(raw.name || "").trim();
    if (!name) return null;
    const id = slugifySkillPresetId(raw.id || name);
    const rawAnc = raw.ancestralChoices && typeof raw.ancestralChoices === "object" && !Array.isArray(raw.ancestralChoices)
        ? raw.ancestralChoices
        : {};
    const cleanAnc = {};
    for (const [k, v] of Object.entries(rawAnc)) {
        if (FORBIDDEN_PRESET_KEYS.has(k)) continue;
        if (typeof v === "string" && v.trim()) cleanAnc[k] = v.trim();
    }
    const norm = normalizeSkillBuild(
        {
            trees: Array.isArray(raw.trees) ? raw.trees : undefined,
            activeSkills: Array.isArray(raw.activeSkills) ? raw.activeSkills : [],
            passives: Array.isArray(raw.passives) ? raw.passives : [],
            ancestralChoices: cleanAnc,
            hatredTree: raw.hatredTree || null,
            bakedPassives: [],
        },
        null
    );
    const className = resolveClassName(norm.trees) || raw.className || norm.className || "Custom Class";
    return {
        id,
        name: name.slice(0, 80),
        className,
        trees: [...norm.trees],
        activeSkills: [...norm.activeSkills],
        passives: [...norm.passives],
        ancestralChoices: { ...(norm.ancestralChoices || {}) },
        hatredTree: norm.hatredTree || null,
        totalPoints: getTotalPointsSpent(norm),
        updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : new Date().toISOString(),
    };
}

/**
 * Snapshot a Skill Build into a portable, reusable preset (omitting character-specific bakedPassives
 * so applying it to another character never double-counts sheet passives).
 */
export function extractSkillBuildPreset(skillBuild, { id = null, name = null } = {}) {
    const norm = normalizeSkillBuild(skillBuild, null);
    const className = resolveClassName(norm.trees) || norm.className || "Custom Class";
    const pts = getTotalPointsSpent(norm);
    const cleanName = String(name || "").trim() || `${className} (${pts}p)`;
    return normalizeSavedSkillPreset({
        id: id || slugifySkillPresetId(cleanName),
        name: cleanName,
        className,
        trees: norm.trees,
        activeSkills: norm.activeSkills,
        passives: norm.passives,
        ancestralChoices: norm.ancestralChoices,
        hatredTree: norm.hatredTree,
        updatedAt: new Date().toISOString(),
    });
}

/**
 * Apply a saved Skill Build preset onto a character, preserving that character's own `bakedPassives`
 * so zero sheet passives are double-counted.
 */
export function applySkillBuildPresetToCharacter(character, preset) {
    const clean = normalizeSavedSkillPreset(preset);
    if (!clean) return normalizeSkillBuild(character?.skillBuild || null, character);
    const existingBaked = Array.isArray(character?.skillBuild?.bakedPassives)
        ? [...character.skillBuild.bakedPassives]
        : normalizeSkillBuild(null, character).bakedPassives;
    return normalizeSkillBuild(
        {
            trees: [...clean.trees],
            activeSkills: [...clean.activeSkills],
            passives: [...clean.passives],
            ancestralChoices: { ...(clean.ancestralChoices || {}) },
            hatredTree: clean.hatredTree || null,
            bakedPassives: existingBaked,
        },
        character
    );
}
