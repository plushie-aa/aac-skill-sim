/**
 * ArcheAge Classic 1.3.6 Skill Rank Resolution Helpers.
 * Pure functions (zero DOM dependencies).
 */

/**
 * Return the normalized array of ranks for any skill object.
 */
export function getSkillRanks(skill) {
    if (!skill) return [];
    if (Array.isArray(skill.ranks) && skill.ranks.length > 0) {
        return skill.ranks;
    }

    const fallback = {
        rank: 1,
        label: "Rank 1",
        description: skill.description || "",
    };
    if (Array.isArray(skill.hits) && skill.hits.length > 0) {
        fallback.hits = skill.hits;
    } else {
        fallback.base = Number(skill.base) || 0;
        fallback.scalingPct = Number(skill.scalingPct) || 0;
        if (skill.parseSource) fallback.parseSource = skill.parseSource;
        if (skill.bloodthirstPerStack != null) fallback.bloodthirstPerStack = skill.bloodthirstPerStack;
        if (skill.backstabScalingPct != null) fallback.backstabScalingPct = skill.backstabScalingPct;
    }
    return [fallback];
}

/**
 * Pick the requested rank from a skill (supports numeric rank, "max", "min",
 * or per-skill map via context.skillRanks[skill.id]) and return a resolved
 * skill view with that rank's base, scalingPct, hits, and description.
 */
export function resolveSkillRank(skill, requestedRank) {
    const ranks = getSkillRanks(skill);
    if (ranks.length === 0) {
        return {
            skill,
            selectedRank: 1,
            selectedRankLabel: "Rank 1",
            availableRanks: 1,
            rankSpec: null,
        };
    }

    let chosen = ranks[ranks.length - 1]; // Default: max available rank
    if (requestedRank === "min") {
        chosen = ranks[0];
    } else if (requestedRank != null && requestedRank !== "" && requestedRank !== "max") {
        const num = Number(requestedRank);
        if (Number.isFinite(num)) {
            const exact = ranks.find((r) => Number(r.rank) === num);
            if (exact) {
                chosen = exact;
            } else {
                const idx = Math.max(0, Math.min(ranks.length - 1, Math.round(num) - 1));
                chosen = ranks[idx];
            }
        }
    }

    const resolved = {
        ...skill,
        description: chosen.description ?? skill.description,
    };

    if (chosen.flags && typeof chosen.flags === "object") {
        resolved.flags = { ...(skill.flags || {}), ...chosen.flags };
    }

    if (Array.isArray(chosen.hits) && chosen.hits.length > 0) {
        resolved.hits = chosen.hits;
    } else {
        resolved.base = chosen.base ?? skill.base ?? 0;
        resolved.scalingPct = chosen.scalingPct ?? skill.scalingPct ?? 0;
        if (chosen.parseSource) resolved.parseSource = chosen.parseSource;
        if (chosen.bloodthirstPerStack != null) resolved.bloodthirstPerStack = chosen.bloodthirstPerStack;
        if (chosen.backstabScalingPct != null) resolved.backstabScalingPct = chosen.backstabScalingPct;
    }

    const rankNum = Number(chosen.rank) || 1;
    return {
        skill: resolved,
        selectedRank: rankNum,
        selectedRankLabel: chosen.label || `Rank ${rankNum}`,
        availableRanks: ranks.length,
        rankSpec: chosen,
    };
}

/**
 * Determine the requested rank for a given skill from a simulation context.
 * Per-skill override (context.skillRanks[skill.id]) takes precedence over context.skillRank.
 */
export function getRequestedRankFromContext(skill, context = {}) {
    if (context?.skillRanks && skill?.id && context.skillRanks[skill.id] != null) {
        return context.skillRanks[skill.id];
    }
    return context?.skillRank;
}

/**
 * Multi-stage skills that players weave / cast individually across a rotation
 * (auto-advancing stage 1 -> 2 -> ... -> N when added to a rotation or repeated).
 */
export const STAGED_WEAVE_SKILL_IDS = new Set([
    "sorcery_gods_whip",
    "vitalism_fervent_healing",
    "battlerage_tiger_strike_lightning",
    "battlerage_whirlwind_slash",
    "vitalism_skewer_multi",
]);

/**
 * Return the individual cast stages for any multi-hit / multi-cast skill,
 * or an empty array for single-hit skills.
 */
export function getSkillStages(skill) {
    if (!skill) return [];
    const hasHitsArr = Array.isArray(skill.hits) && skill.hits.length > 1;
    const repeatCount = Math.max(1, Number(skill.repeatCount) || 1);
    if (!hasHitsArr && repeatCount <= 1) return [];

    const count = hasHitsArr ? skill.hits.length : repeatCount;
    const rawTotalGcd =
        skill.gcdSec != null && Number.isFinite(Number(skill.gcdSec))
            ? Math.max(0, Number(skill.gcdSec))
            : skill.flags?.noGcd
              ? 0
              : 1.0;
    const rawCast = Math.max(0, Number(skill.castTimeSec) || 0);

    const resolveStageTiming = (idx) => {
        if (skill.id === "sorcery_gods_whip") {
            return { gcdSec: 0, castTimeSec: 0 };
        }
        if (skill.id === "vitalism_fervent_healing") {
            return { gcdSec: 0.4, castTimeSec: 0 };
        }
        if (skill.id === "battlerage_tiger_strike_lightning") {
            return { gcdSec: 0.4, castTimeSec: 0 };
        }
        if (skill.id === "sorcery_flamebolt") {
            return idx === 0
                ? { gcdSec: 0.4, castTimeSec: rawCast }
                : { gcdSec: 0.3, castTimeSec: 0 };
        }
        const perStageGcd = rawTotalGcd > 0 ? Math.round((rawTotalGcd / count) * 1000) / 1000 : 0;
        return { gcdSec: perStageGcd, castTimeSec: idx === 0 ? rawCast : 0 };
    };

    if (hasHitsArr) {
        return skill.hits.map((h, idx) => {
            const t = resolveStageTiming(idx);
            return {
                index: idx,
                label: h.label || `Cast ${idx + 1}`,
                base: Number(h.base) || 0,
                scalingPct: Number(h.scalingPct) || 0,
                gcdSec: t.gcdSec,
                castTimeSec: t.castTimeSec,
            };
        });
    }

    const prefix = skill.kind === "heal" ? "Cast" : "Strike";
    return Array.from({ length: count }, (_, idx) => {
        const t = resolveStageTiming(idx);
        return {
            index: idx,
            label: `${prefix} ${idx + 1}`,
            base: Number(skill.base) || 0,
            scalingPct: Number(skill.scalingPct) || 0,
            gcdSec: t.gcdSec,
            castTimeSec: t.castTimeSec,
        };
    });
}

/**
 * Build a derived single-stage skill view for `stageIndex` (0..N-1) so damage/healing
 * engines evaluate only that stage's exact formula, GCD, and cast time while preserving
 * `skill.id` for combos, status grants, and skill-specific lunagems.
 */
export function buildStageSkillView(skill, stageIndex) {
    const stages = getSkillStages(skill);
    if (stages.length === 0) return skill;
    const idx = Math.max(0, Math.min(stages.length - 1, Math.floor(Number(stageIndex) || 0)));
    const st = stages[idx];

    const hasHitsArr = Array.isArray(skill.hits) && skill.hits.length > 1;
    const nextSkill = {
        ...skill,
        gcdSec: st.gcdSec,
        castTimeSec: st.castTimeSec,
        repeatCount: 1,
        _stageIndex: idx,
        _stageCount: stages.length,
        _stageLabel: st.label,
    };

    if (hasHitsArr) {
        nextSkill.hits = [skill.hits[idx]];
        if (Array.isArray(skill.ranks) && skill.ranks.length > 0) {
            nextSkill.ranks = skill.ranks.map((r) =>
                Array.isArray(r.hits) && r.hits[idx] ? { ...r, hits: [r.hits[idx]] } : r
            );
        }
    } else if (Array.isArray(skill.ranks) && skill.ranks.length > 0) {
        nextSkill.ranks = skill.ranks.map((r) => ({ ...r }));
    }

    if (st.gcdSec === 0) {
        nextSkill.flags = { ...(skill.flags || {}), noGcd: true };
    }

    return nextSkill;
}
