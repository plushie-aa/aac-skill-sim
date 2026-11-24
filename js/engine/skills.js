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
