/**
 * Economy & Build Cost Estimator Tab View.
 * Estimates gold cost for Build A, Build B, Defender, and all saved builds using
 * an editable Tier × Grade, Lunagem, Lunafrost, and per-item/per-gem override Price Book.
 */

import {
    ECONOMY_FROST_GROUPS,
    ECONOMY_GEM_GROUPS,
    ECONOMY_GRADES,
    ECONOMY_TIERS,
    applyModifiers,
    compareBuildEconomy,
    computeEffectiveStats,
    computeGoldEfficiencyUpgrades,
    createDefaultEconomyPriceBook,
    estimateBuildCost,
    getGearCatalog,
    inferBuildCategory,
    loadGearCatalog,
    normalizeEconomyPriceBook,
} from "../engine/index.js";
import {
    ECONOMY_AH_PRICES_STORAGE_KEY,
    escHtml,
    fmtDec,
    fmtDeltaPct,
    fmtInt,
    getActiveSkillObject,
    getContext,
    getEffectiveDefenderDisableAvoidance,
    getMatchingSkills,
    getSlotModifiers,
    renderGradedGearIconHtml,
    resolveGearGradeInfo,
    showToast,
    state,
    ui,
} from "./state.js";

export const ECONOMY_PRICES_STORAGE_KEY = "aac_damage_sim_economy_prices_v1";

const SLOT_DISPLAY_ORDER = [
    15, 16, 17, 18, // Weapons & Instrument
    1, 2, 3, 4, 5, 7, 8, // 7 Armor slots
    6, 0, 9, // Cloak, Costume, Undergarments
    10, 11, 12, 13, 14, // Accessories
];

let _catalogRequested = false;

export function loadEconomyPriceBookFromStorage() {
    try {
        const raw = localStorage.getItem(ECONOMY_PRICES_STORAGE_KEY);
        if (raw) {
            return normalizeEconomyPriceBook(JSON.parse(raw));
        }
    } catch {
        // Ignore storage errors
    }
    return createDefaultEconomyPriceBook();
}

export function saveEconomyPriceBook(nextBook) {
    const normalized = normalizeEconomyPriceBook(nextBook);
    state.economyPriceBook = normalized;
    try {
        localStorage.setItem(ECONOMY_PRICES_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
        // Ignore storage quota errors
    }
    if (state.diskApiAvailable && window.location.protocol !== "file:") {
        return fetch("/api/economy-prices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(normalized),
            keepalive: true,
        }).catch(() => {});
    }
    return Promise.resolve();
}

function persistEconomyAhPricesToLocalStorage(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    try {
        localStorage.setItem(ECONOMY_AH_PRICES_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
        // Ignore storage quota errors (AH snapshot is ~270 KB)
    }
}

function loadEconomyAhPricesFromLocalStorage() {
    try {
        const raw = localStorage.getItem(ECONOMY_AH_PRICES_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

export async function loadEconomyAhPricesFromDisk() {
    if (state.diskApiAvailable && window.location.protocol !== "file:") {
        try {
            const res = await fetch("/api/economy-ah-prices", { cache: "no-store" });
            if (res.ok) {
                const json = await res.json();
                if (json?.data && typeof json.data === "object") {
                    state.economyAhPrices = json.data;
                    persistEconomyAhPricesToLocalStorage(json.data);
                    return json.data;
                }
                state.economyAhPrices = null;
                return null;
            }
        } catch {
            // Fall through to localStorage / static JSON
        }
    }
    if (window.location.protocol !== "file:") {
        try {
            const res = await fetch("economy/ah_prices.json", { cache: "no-store" });
            if (res.ok) {
                const json = await res.json();
                if (json && typeof json === "object") {
                    state.economyAhPrices = json;
                    persistEconomyAhPricesToLocalStorage(json);
                    return json;
                }
            }
        } catch {
            // Fall back to localStorage backup
        }
    }
    const cached = loadEconomyAhPricesFromLocalStorage();
    if (cached) {
        state.economyAhPrices = cached;
        return cached;
    }
    return state.economyAhPrices || null;
}

export async function syncEconomyAhPricesFromServer() {
    if (!state.diskApiAvailable || state.economyAhSyncing) return null;
    state.economyAhSyncing = true;
    if (state.mode === "economy") ui.renderSimulation();
    try {
        const res = await fetch("/api/sync/economy-prices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || `HTTP ${res.status} syncing AH prices`);
        }
        await loadEconomyAhPricesFromDisk();
        return data;
    } finally {
        state.economyAhSyncing = false;
        if (state.mode === "economy") ui.renderSimulation();
    }
}

export async function loadEconomyPriceBookFromDisk() {
    if (state.diskApiAvailable && window.location.protocol !== "file:") {
        try {
            const res = await fetch("/api/economy-prices", { cache: "no-store" });
            if (res.ok) {
                const json = await res.json();
                if (json?.data && typeof json.data === "object") {
                    const normalized = normalizeEconomyPriceBook(json.data);
                    state.economyPriceBook = normalized;
                    try {
                        localStorage.setItem(ECONOMY_PRICES_STORAGE_KEY, JSON.stringify(normalized));
                    } catch {
                        // Ignore storage quota errors
                    }
                    await loadEconomyAhPricesFromDisk();
                    return;
                }
            }
        } catch {
            // Fall through to localStorage
        }
    }
    let loadedFromLocal = false;
    try {
        const raw = localStorage.getItem(ECONOMY_PRICES_STORAGE_KEY);
        if (raw) {
            state.economyPriceBook = normalizeEconomyPriceBook(JSON.parse(raw));
            loadedFromLocal = true;
        }
    } catch {
        // Ignore storage errors
    }
    if (!loadedFromLocal && window.location.protocol !== "file:") {
        try {
            const res = await fetch("economy/prices.json", { cache: "no-store" });
            if (res.ok) {
                const json = await res.json();
                if (json && typeof json === "object") {
                    const normalized = normalizeEconomyPriceBook(json);
                    state.economyPriceBook = normalized;
                    try {
                        localStorage.setItem(ECONOMY_PRICES_STORAGE_KEY, JSON.stringify(normalized));
                    } catch {
                        // Ignore storage quota errors
                    }
                    loadedFromLocal = true;
                }
            }
        } catch {
            // Fall back to defaults
        }
    }
    if (!loadedFromLocal) {
        state.economyPriceBook = createDefaultEconomyPriceBook();
    }
    await loadEconomyAhPricesFromDisk();
}

function fmtGold(val) {
    const n = Math.round(Number(val) || 0);
    return `${fmtInt(n)}g`;
}

function fmtGoldDelta(delta) {
    const n = Math.round(Number(delta) || 0);
    if (n === 0) return "0g";
    return `${n > 0 ? "+" : "-"}${fmtInt(Math.abs(n))}g`;
}

function fmtAhSourceLabel(src) {
    if (src === "30d") return "30d avg";
    if (src === "7d") return "7d avg";
    if (src === "latest") return "latest";
    if (src === "all_time") return "all-time avg";
    return src || "AH";
}

function fmtAhTooltip(ahInfo) {
    if (!ahInfo) return "";
    const parts = [`sermeatball.com AH (${fmtAhSourceLabel(ahInfo.src)}): ${fmtGold(ahInfo.gold)}`];
    if (ahInfo.latest && ahInfo.latest !== ahInfo.gold) parts.push(`Latest: ${fmtGold(ahInfo.latest)}`);
    if (ahInfo.vol30d > 0) parts.push(`30d Vol: ${fmtInt(ahInfo.vol30d)}`);
    return parts.join(" · ");
}

function sermeatballItemUrl(itemId) {
    return itemId
        ? `https://sermeatball.com/auction/item-price-history/${encodeURIComponent(itemId)}`
        : "https://sermeatball.com/auction/item-price-history";
}

function renderSlotCellHtml(entry, slotKey) {
    const slotLbl = slotKey === "A" ? "Build A" : "Build B";
    if (!entry) {
        return `<td class="econ-slot-cell econ-empty mct-full" data-label="${slotLbl}"><span class="skill-meta">&mdash; Empty &mdash;</span></td>`;
    }
    const gInfo = resolveGearGradeInfo(entry.gradeId, entry.gradeName, entry.gradeColor);
    const icHtml = renderGradedGearIconHtml({
        icon: entry.icon,
        name: entry.itemName,
        slotName: entry.slotName,
        gradeId: gInfo.id,
        gradeName: gInfo.name,
        gradeColor: gInfo.color,
        gemCount: entry.gemsCount,
    });
    const gemGroups = new Map();
    for (const g of entry.gemsDetail) {
        const k = `${g.overrideKey}::${g.unitGold}::${g.priceSource}`;
        const prev = gemGroups.get(k);
        if (prev) prev.count++;
        else gemGroups.set(k, { ...g, count: 1 });
    }
    const gemsChipsHtml = Array.from(gemGroups.values())
        .map((g) => {
            const cls = g.isOverride ? "is-override" : g.isAhPrice ? "is-ah" : "";
            const ahNote = g.isAhPrice && g.ahInfo ? ` · ${fmtAhTooltip(g.ahInfo)}` : "";
            const badge = g.isAhPrice ? `<span class="econ-ah-mini">AH</span>` : "";
            return `<button type="button" class="econ-gem-pill ${cls}" data-econ-edit-gem="${escHtml(g.overrideKey)}" data-econ-gem-cur="${g.unitGold}" title="${escHtml(`${g.name}${g.text ? ` (${g.text})` : ""} — ${g.groupLabel} (${fmtGold(g.unitGold)} each)${ahNote}. Click to override price.`)}">${g.count}&times; ${escHtml(g.name.replace(/^Lucid |^Vivid |^Radiant /i, ""))} <strong>${fmtGold(g.unitGold)}</strong>${badge}</button>`;
        })
        .join("");

    const frostHtml = entry.frostInfo
        ? (() => {
              const f = entry.frostInfo;
              const cls = f.isOverride ? "is-override" : f.isAhPrice ? "is-ah" : "";
              const ahNote = f.isAhPrice && f.ahInfo ? ` · ${fmtAhTooltip(f.ahInfo)}` : "";
              const badge = f.isAhPrice ? `<span class="econ-ah-mini">AH</span>` : "";
              return `<button type="button" class="econ-frost-pill ${cls}" data-econ-edit-frost="${escHtml(f.name)}" data-econ-frost-cur="${f.gold}" title="${escHtml(`${f.name} — ${f.groupLabel} (${fmtGold(f.gold)})${ahNote}. Click to override price.`)}">Frost: ${escHtml(f.name)} <strong>${fmtGold(f.gold)}</strong>${badge}</button>`;
          })()
        : "";

    let itemMetaSuffix = "";
    if (entry.isItemOverride) {
        itemMetaSuffix = ` &bull; <strong>Custom Price</strong>`;
    } else if (entry.isAhItem && entry.ahInfo) {
        itemMetaSuffix = ` &bull; <a class="econ-ah-badge" href="${escHtml(sermeatballItemUrl(entry.ahInfo.itemId))}" target="_blank" rel="noopener noreferrer" title="${escHtml(fmtAhTooltip(entry.ahInfo))}">AH (${escHtml(fmtAhSourceLabel(entry.ahInfo.src))})</a>`;
    } else if (entry.ahInfo && entry.ahInfo.gradeSkipped) {
        itemMetaSuffix = ` &bull; <button type="button" class="econ-ah-ref-btn" data-econ-apply-ah-item="${escHtml(entry.overrideKey)}" data-econ-apply-ah-gold="${entry.ahInfo.gold}" title="${escHtml(`${fmtAhTooltip(entry.ahInfo)}. Skipped automatically because sermeatball.com aggregates all grades. Click to apply as custom override.`)}">AH avg: ${fmtGold(entry.ahInfo.gold)}</button>`;
    }

    const inpCls = entry.isItemOverride ? "is-override" : entry.isAhItem ? "is-ah" : "";

    return `
    <td class="econ-slot-cell mct-full" data-label="${slotLbl}">
        <div class="econ-item-head">
            <div class="table-skill-cell">
                ${icHtml}
                <div>
                    <div class="skill-name" style="color:${escHtml(gInfo.color)}">${entry.gradeName ? `[${escHtml(entry.gradeName)}] ` : ""}${escHtml(entry.itemName)}</div>
                    <div class="skill-meta">${escHtml(entry.tierLabel)}${itemMetaSuffix}</div>
                </div>
            </div>
            <div class="econ-price-col">
                <div class="econ-base-input-wrap" title="Base item gold cost (editing saves an exact override for ${escHtml(entry.itemName)} [${escHtml(entry.gradeName)}])">
                    <span class="skill-meta">Gear:</span>
                    <input type="number" class="econ-inline-inp ${inpCls}" min="0" step="1000" value="${entry.baseGold}" data-econ-item-ov="${escHtml(entry.overrideKey)}" aria-label="${escHtml(entry.itemName)} gold price (${slotKey})" />
                    <span class="econ-g">g</span>
                </div>
                <div class="econ-slot-total">Total: <strong>${fmtGold(entry.slotTotalGold)}</strong></div>
            </div>
        </div>
        ${gemsChipsHtml || frostHtml ? `<div class="econ-sub-pills">${gemsChipsHtml}${frostHtml}</div>` : ""}
    </td>`;
}

function renderTierMatrixHtml(priceBook) {
    const headCells = ECONOMY_GRADES.map((g) => {
        const gInfo = resolveGearGradeInfo(null, g.label);
        return `<th style="color:${escHtml(gInfo.color)}"><span class="econ-grade-hdr"><img class="econ-grade-hdr-frame" src="assets/grade/grade${gInfo.id}.png" alt="" />${escHtml(g.label)}</span></th>`;
    }).join("");
    const bodyRows = ECONOMY_TIERS.map((tier) => {
        const row = priceBook.tierGrades[tier.id] || {};
        const cells = ECONOMY_GRADES.map((g) => {
            const val = row[g.id] ?? 0;
            return `<td data-label="${escHtml(g.label)}"><input type="number" class="econ-matrix-inp" min="0" step="1000" value="${val}" data-econ-tier="${escHtml(tier.id)}" data-econ-grade="${escHtml(g.id)}" /></td>`;
        }).join("");
        return `
        <tr>
            <td>
                <strong>${escHtml(tier.label)}</strong>
                <div class="skill-meta">${escHtml(tier.hint)}</div>
            </td>
            ${cells}
        </tr>`;
    }).join("");

    return `
    <div class="table-wrap">
        <table class="econ-price-table mobile-card-table mct-cols-3">
            <thead>
                <tr>
                    <th>Gear Tier / Category</th>
                    ${headCells}
                </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
        </table>
    </div>`;
}

function renderGemsAndFrostsHtml(priceBook, costA, costB, costDef) {
    const gemRows = ECONOMY_GEM_GROUPS.map((g) => {
        const val = priceBook.gemGroups[g.id] ?? g.defaultGold;
        return `
        <tr>
            <td>
                <strong>${escHtml(g.label)}</strong>
                <div class="skill-meta">${escHtml(g.hint)}</div>
            </td>
            <td style="width:160px">
                <div class="econ-base-input-wrap">
                    <input type="number" class="econ-matrix-inp" min="0" step="500" value="${val}" data-econ-gem-group="${escHtml(g.id)}" />
                    <span class="econ-g">g</span>
                </div>
            </td>
        </tr>`;
    }).join("");

    const frostRows = ECONOMY_FROST_GROUPS.map((f) => {
        const val = priceBook.frostGroups[f.id] ?? f.defaultGold;
        return `
        <tr>
            <td>
                <strong>${escHtml(f.label)}</strong>
                <div class="skill-meta">${escHtml(f.hint)}</div>
            </td>
            <td style="width:160px">
                <div class="econ-base-input-wrap">
                    <input type="number" class="econ-matrix-inp" min="0" step="500" value="${val}" data-econ-frost-group="${escHtml(f.id)}" />
                    <span class="econ-g">g</span>
                </div>
            </td>
        </tr>`;
    }).join("");

    // Collect unique socketed gems across active builds for quick per-gem override
    const activeGems = new Map();
    for (const c of [costA, costB, costDef].filter(Boolean)) {
        for (const sl of c.slotBreakdown) {
            for (const g of sl.gemsDetail) {
                const prev = activeGems.get(g.overrideKey);
                if (prev) prev.count++;
                else activeGems.set(g.overrideKey, { ...g, slotName: sl.slotName, count: 1 });
            }
        }
    }
    const activeGemRows = Array.from(activeGems.values())
        .sort((a, b) => b.unitGold - a.unitGold || a.name.localeCompare(b.name))
        .map(
            (g) => `
        <tr>
            <td>
                <strong>${escHtml(g.name)}</strong> <span class="stag stag-tree">${escHtml(g.slotName)}</span>
                <div class="skill-meta">${escHtml(g.text || g.groupLabel)} &bull; ${g.count}&times; socketed across active builds</div>
            </td>
            <td style="width:160px">
                <div class="econ-base-input-wrap">
                    <input type="number" class="econ-matrix-inp ${g.isOverride ? "is-override" : ""}" min="0" step="500" value="${g.unitGold}" data-econ-gem-ov="${escHtml(g.overrideKey)}" />
                    <span class="econ-g">g</span>
                </div>
            </td>
        </tr>`
        )
        .join("");

    return `
    <div class="econ-two-col">
        <div>
            <div class="stat-group-label" style="margin-bottom:6px">Lunagem Category Defaults</div>
            <div class="table-wrap">
                <table class="econ-price-table">
                    <thead><tr><th>Lunagem Archetype</th><th>Gold / Gem</th></tr></thead>
                    <tbody>${gemRows}</tbody>
                </table>
            </div>
            <div class="stat-group-label" style="margin:12px 0 6px">Lunafrost Category Defaults</div>
            <div class="table-wrap">
                <table class="econ-price-table">
                    <thead><tr><th>Lunafrost Tier</th><th>Gold / Frost</th></tr></thead>
                    <tbody>${frostRows}</tbody>
                </table>
            </div>
        </div>
        <div>
            <div class="stat-group-label" style="margin-bottom:6px">Socketed Gems on Active Builds (Quick Per-Gem Overrides)</div>
            ${
                activeGemRows
                    ? `<div class="table-wrap">
                        <table class="econ-price-table">
                            <thead><tr><th>Gem (Slot)</th><th>Gold / Gem</th></tr></thead>
                            <tbody>${activeGemRows}</tbody>
                        </table>
                    </div>`
                    : `<p class="hint-inline">No socketed lunagems detected on the active builds.</p>`
            }
        </div>
    </div>`;
}

function renderOverridesHtml(priceBook) {
    const rows = [];
    for (const [k, v] of Object.entries(priceBook.itemOverrides || {})) {
        const [itemName, grade] = k.split("|");
        const gCol = grade ? resolveGearGradeInfo(null, grade).color : null;
        rows.push({
            kind: "item",
            key: k,
            badge: "Gear",
            label: `${grade ? `[${grade}] ` : ""}${itemName}`,
            color: gCol,
            gold: v,
        });
    }
    for (const [k, v] of Object.entries(priceBook.gemOverrides || {})) {
        const [gemName, slot] = k.split("|");
        rows.push({ kind: "gem", key: k, badge: "Gem", label: `${gemName}${slot ? ` [${slot}]` : ""}`, color: null, gold: v });
    }
    for (const [k, v] of Object.entries(priceBook.frostOverrides || {})) {
        rows.push({ kind: "frost", key: k, badge: "Frost", label: k, color: null, gold: v });
    }

    if (rows.length === 0) {
        return `<p class="hint-inline">No exact item/gem/frost overrides yet. Edit any item's gold box or click any gem/frost pill in the Gear Cost Breakdown table above to set an exact price.</p>`;
    }

    return `
    <div class="table-wrap">
        <table class="econ-price-table">
            <thead>
                <tr>
                    <th style="width:70px">Type</th>
                    <th>Item / Gem / Frost</th>
                    <th style="width:150px">Custom Price</th>
                    <th style="width:70px"></th>
                </tr>
            </thead>
            <tbody>
                ${rows
                    .map(
                        (r) => `
                <tr>
                    <td><span class="stag stag-tree">${escHtml(r.badge)}</span></td>
                    <td><strong${r.color ? ` style="color:${escHtml(r.color)}"` : ""}>${escHtml(r.label)}</strong></td>
                    <td><strong>${fmtGold(r.gold)}</strong></td>
                    <td><button type="button" class="sm danger" data-econ-del-ov-kind="${escHtml(r.kind)}" data-econ-del-ov-key="${escHtml(r.key)}">Remove</button></td>
                </tr>`
                    )
                    .join("")}
            </tbody>
        </table>
    </div>`;
}

function renderAhPricesBrowserHtml(ahPrices) {
    if (!ahPrices || typeof ahPrices !== "object") {
        return `<p class="hint-inline">No Auction House prices synced yet. Click <strong>&#8635; Sync AH Prices</strong> above (or in <strong>Settings &rarr; Sync &amp; Backup</strong>) while running locally with <code>python tools/serve.py</code> to pull market prices from <a href="https://sermeatball.com/auction/item-price-history" target="_blank" rel="noopener noreferrer">sermeatball.com</a>.</p>`;
    }

    const q = String(state.economyAhQuery || "").trim().toLowerCase();
    const cat = state.economyAhCategory || "all";
    const rows = [];

    const pushSection = (sectionObj, kind, badge) => {
        if (!sectionObj || typeof sectionObj !== "object") return;
        for (const [name, entry] of Object.entries(sectionObj)) {
            if (!entry || !(entry.g > 0)) continue;
            if (q && !name.toLowerCase().includes(q)) continue;
            rows.push({
                kind,
                badge,
                name,
                gold: entry.g,
                latest: entry.lat ?? entry.g,
                vol30d: entry.v30 || 0,
                src: entry.src || "30d",
                itemId: entry.id || null,
            });
        }
    };

    if (cat === "all" || cat === "gems") pushSection(ahPrices.gems, "gems", "Lunagem");
    if (cat === "all" || cat === "frosts") pushSection(ahPrices.frosts, "frosts", "Lunafrost");
    if (cat === "all" || cat === "items") pushSection(ahPrices.items, "items", "Gear");

    rows.sort((a, b) => b.vol30d - a.vol30d || b.gold - a.gold || a.name.localeCompare(b.name));
    const shown = rows.slice(0, 120);
    const syncedTxt = ahPrices.syncedAt ? new Date(ahPrices.syncedAt).toLocaleString() : "Unknown";
    const counts = ahPrices.counts || {};

    return `
    <div class="econ-ah-toolbar">
        <input type="search" id="econAhSearchInput" value="${escHtml(state.economyAhQuery || "")}" placeholder="Search scraped AH items, lunagems &amp; lunafrosts..." style="flex:1;min-width:220px" />
        <div class="seg-group">
            <button type="button" class="seg-btn ${cat === "all" ? "active" : ""}" data-econ-ah-cat="all">All (${fmtInt(counts.total || 0)})</button>
            <button type="button" class="seg-btn ${cat === "gems" ? "active" : ""}" data-econ-ah-cat="gems">Lunagems (${fmtInt(counts.gems || 0)})</button>
            <button type="button" class="seg-btn ${cat === "frosts" ? "active" : ""}" data-econ-ah-cat="frosts">Lunafrosts (${fmtInt(counts.frosts || 0)})</button>
            <button type="button" class="seg-btn ${cat === "items" ? "active" : ""}" data-econ-ah-cat="items">Gear (${fmtInt(counts.items || 0)})</button>
        </div>
        <span class="hint-inline">Source: <a href="https://sermeatball.com/auction/item-price-history" target="_blank" rel="noopener noreferrer">sermeatball.com</a> &bull; Synced ${escHtml(syncedTxt)}</span>
    </div>
    <p class="hint-inline" style="margin:6px 0 8px">
        Showing <strong>${fmtInt(shown.length)}</strong> of <strong>${fmtInt(rows.length)}</strong> matching AH prices (sorted by 30d volume). Lunagems &amp; Lunafrosts apply directly; grade-aggregated gear prices auto-apply only when grade-compatible and never overwrite your custom overrides.
    </p>
    ${
        shown.length > 0
            ? `<div class="table-wrap">
                <table class="econ-price-table mobile-card-table mct-skip-rank">
                    <thead>
                        <tr>
                            <th style="width:90px">Type</th>
                            <th>Item Name</th>
                            <th style="width:120px">Market Price</th>
                            <th style="width:100px">Basis</th>
                            <th style="width:90px">30d Vol</th>
                            <th style="width:90px">History</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${shown
                            .map(
                                (r) => `
                        <tr>
                            <td><span class="stag stag-tree">${escHtml(r.badge)}</span></td>
                            <td><strong>${escHtml(r.name)}</strong></td>
                            <td data-label="Market Price"><strong style="color:#fbbf24">${fmtGold(r.gold)}</strong></td>
                            <td class="skill-meta" data-label="Basis">${escHtml(fmtAhSourceLabel(r.src))}${r.latest !== r.gold ? ` (lat ${fmtGold(r.latest)})` : ""}</td>
                            <td data-label="30d Vol">${r.vol30d > 0 ? fmtInt(r.vol30d) : "&mdash;"}</td>
                            <td data-label="History"><a class="econ-ah-badge" href="${escHtml(sermeatballItemUrl(r.itemId))}" target="_blank" rel="noopener noreferrer">Chart &nearr;</a></td>
                        </tr>`
                            )
                            .join("")}
                    </tbody>
                </table>
            </div>`
            : `<p class="hint-inline">No scraped AH items match "${escHtml(state.economyAhQuery || "")}".</p>`
    }`;
}

function resolveEconomyAdvisorSkill(goal) {
    const all = Array.isArray(state.allSkills) ? state.allSkills : [];
    const byId = new Map(all.map((s) => [s.id, s]));
    if (goal === "ode_heal") {
        return byId.get("songcraft_ode_to_recovery") || all.find((s) => s.kind === "heal") || null;
    }
    const active = getActiveSkillObject(getMatchingSkills());
    if (active && active.kind === "damage") return active;
    const cat = inferBuildCategory(state.buildA);
    if (cat === "mage") return byId.get("sorcery_arc_lightning") || byId.get("sorcery_flamebolt") || active;
    if (cat === "archer") return byId.get("archery_snipe") || byId.get("archery_charged_bolt") || active;
    return byId.get("battlerage_precision_strike") || byId.get("battlerage_tiger_strike") || active;
}

function renderUpgradeAdvisorHtml(priceBook, catalog, ahPrices, disableAvoid) {
    const catA = inferBuildCategory(state.buildA);
    const defaultGoal =
        catA === "healer"
            ? "ode_heal"
            : catA === "tank"
              ? "melee_ehp"
              : "offense_skill";
    const goal =
        state.economyAdvisorGoal && state.economyAdvisorGoal !== "auto"
            ? state.economyAdvisorGoal
            : defaultGoal;

    const skill = resolveEconomyAdvisorSkill(goal);
    const baseCtx = getContext();
    const res = computeGoldEfficiencyUpgrades(state.buildA, state.defender, priceBook, catalog, ahPrices, {
        goal,
        skill,
        characterModifiers: getSlotModifiers("A"),
        opponentModifiers: getSlotModifiers("defender"),
        context: baseCtx,
        disableAvoidance: disableAvoid,
    });

    const goalLabels = {
        melee_ehp: "Melee EHP",
        magic_ehp: "Magic EHP",
        ranged_ehp: "Ranged EHP",
        offense_skill: skill ? `${skill.name} (Dmg)` : "Skill Dmg",
        ode_heal: "Biggest Ode (/s)",
    };
    const unitSuffix = goal === "ode_heal" ? "/s" : "";

    const rowsHtml = res.items
        .slice(0, 12)
        .map((it, idx) => {
            const kindBadge =
                it.kind === "gem"
                    ? `<span class="stag stag-tree">Gem</span>`
                    : it.kind === "frost"
                      ? `<span class="stag stag-var">Frost</span>`
                      : `<span class="stag stag-anc">Regrade</span>`;
            const srcBadge =
                it.priceSource === "ah"
                    ? `<span class="econ-ah-mini">AH</span>`
                    : it.priceSource === "override"
                      ? `<span class="stag stag-tree">Custom</span>`
                      : "";
            const isTop = idx === 0;
            return `
            <tr class="${isTop ? "econ-advisor-top" : ""}">
                <td>${idx + 1}</td>
                <td>
                    ${kindBadge} <strong>${escHtml(it.label)}</strong> ${srcBadge}
                    <div class="skill-meta">${escHtml(it.effectLabel)}</div>
                </td>
                <td style="white-space:nowrap" data-label="Est. Cost"><strong>${fmtGold(it.goldCost)}</strong></td>
                <td class="delta-pos" style="white-space:nowrap" data-label="Raw Gain">+${fmtInt(it.rawGain)}${unitSuffix}</td>
                <td class="delta-pos" style="white-space:nowrap" data-label="% Gain"><strong>+${fmtDec(it.gainPct, 2)}%</strong></td>
                <td style="white-space:nowrap" data-label="Gold / +1%"><strong class="${isTop ? "delta-pos" : ""}">${fmtGold(it.goldPer1Pct)}</strong> <span class="skill-meta">/ +1%</span></td>
            </tr>`;
        })
        .join("");

    return `
    <div class="econ-section-box econ-advisor-box">
        <div class="econ-section-head">
            <div>
                <div class="stat-group-label" style="margin:0">Upgrade Value Advisor &mdash; Gold per +1% Gain (<span class="val-a">${escHtml(state.buildA.name)}</span>)</div>
                <span class="hint-inline">Ranks next Lunagem, Lunafrost &amp; +1 Grade upgrades by cheapest gold per +1% ${escHtml(goalLabels[goal] || goal)} (Base: <strong>${fmtInt(res.baseValue)}${unitSuffix}</strong> vs ${escHtml(state.defender.name)}).</span>
            </div>
            <div class="seg-group" id="econAdvisorGoalPills">
                <button type="button" class="seg-btn ${goal === "melee_ehp" ? "active" : ""}" data-econ-advisor-goal="melee_ehp">Melee EHP</button>
                <button type="button" class="seg-btn ${goal === "magic_ehp" ? "active" : ""}" data-econ-advisor-goal="magic_ehp">Magic EHP</button>
                <button type="button" class="seg-btn ${goal === "ranged_ehp" ? "active" : ""}" data-econ-advisor-goal="ranged_ehp">Ranged EHP</button>
                <button type="button" class="seg-btn ${goal === "offense_skill" ? "active" : ""}" data-econ-advisor-goal="offense_skill">Skill Dmg</button>
                <button type="button" class="seg-btn ${goal === "ode_heal" ? "active" : ""}" data-econ-advisor-goal="ode_heal">Biggest Ode</button>
            </div>
        </div>
        ${
            rowsHtml
                ? `<div class="table-wrap" style="margin-top:8px">
                    <table class="econ-price-table mobile-card-table mct-skip-rank">
                        <thead>
                            <tr>
                                <th style="width:36px">#</th>
                                <th>Candidate Upgrade</th>
                                <th style="width:110px">Est. Cost</th>
                                <th style="width:110px">Raw Gain</th>
                                <th style="width:90px">% Gain</th>
                                <th style="width:140px">Gold / +1%</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>`
                : `<p class="hint-inline" style="margin-top:8px">No priced upgrades improve this metric for ${escHtml(state.buildA.name)} (try another goal above).</p>`
        }
    </div>`;
}

export function renderEconomyView(out) {
    const catalog = getGearCatalog();
    if (!catalog && !_catalogRequested) {
        _catalogRequested = true;
        loadGearCatalog()
            .then(() => {
                if (state.mode === "economy") ui.renderSimulation();
            })
            .catch(() => {});
    }

    const priceBook = normalizeEconomyPriceBook(state.economyPriceBook || loadEconomyPriceBookFromStorage());
    state.economyPriceBook = priceBook;
    const ahPrices = state.economyAhPrices || null;

    const cmp = compareBuildEconomy(state.buildA, state.buildB, state.defender, priceBook, catalog, null, ahPrices);
    const { costA, costB, costDef, deltaGold, deltaPct, cheaper } = cmp;

    // EHP efficiency vs Defender/Target for extra context
    const effA = applyModifiers(state.buildA, getSlotModifiers("A"));
    const effB = applyModifiers(state.buildB, getSlotModifiers("B"));
    const effDef = applyModifiers(state.defender, getSlotModifiers("defender"));
    const disableAvoid = getEffectiveDefenderDisableAvoidance();
    const isPvE = Boolean(document.getElementById("ctxPvE")?.checked);
    const stA = computeEffectiveStats(effA, effDef, {}, { isPvE, disableAvoidance: disableAvoid });
    const stB = computeEffectiveStats(effB, effDef, {}, { isPvE, disableAvoidance: disableAvoid });
    const meleeEhpA = stA.defense.ehp.melee.vsAttackerEhp || 0;
    const meleeEhpB = stB.defense.ehp.melee.vsAttackerEhp || 0;
    const goldPer10kEhpA = meleeEhpA > 0 && costA.totalGold > 0 ? (costA.totalGold / meleeEhpA) * 10000 : 0;
    const goldPer10kEhpB = meleeEhpB > 0 && costB.totalGold > 0 ? (costB.totalGold / meleeEhpB) * 10000 : 0;

    // Build 20-slot comparison rows
    const mapA = new Map(costA.slotBreakdown.map((s) => [s.slotId, s]));
    const mapB = new Map(costB.slotBreakdown.map((s) => [s.slotId, s]));
    const activeSlotIds = SLOT_DISPLAY_ORDER.filter((id) => mapA.has(id) || mapB.has(id));
    for (const id of new Set([...mapA.keys(), ...mapB.keys()])) {
        if (!activeSlotIds.includes(id)) activeSlotIds.push(id);
    }

    const slotRowsHtml =
        activeSlotIds.length > 0
            ? activeSlotIds
                  .map((sid) => {
                      const eA = mapA.get(sid) || null;
                      const eB = mapB.get(sid) || null;
                      const slotName = eA?.slotName || eB?.slotName || `Slot ${sid}`;
                      const d = (eA?.slotTotalGold || 0) - (eB?.slotTotalGold || 0);
                      const dCls = d < 0 ? "delta-pos" : d > 0 ? "delta-neg" : "delta-tie";
                      return `
                      <tr>
                          <td class="econ-slot-name"><strong>${escHtml(slotName)}</strong></td>
                          ${renderSlotCellHtml(eA, "A")}
                          ${renderSlotCellHtml(eB, "B")}
                          <td class="${dCls} mct-full" data-label="Δ (A − B)" style="white-space:nowrap;font-weight:700">${fmtGoldDelta(d)}</td>
                      </tr>`;
                  })
                  .join("")
            : `<tr><td colspan="4" class="hint-inline">Neither Build A nor Build B has equipped gear data. Import a DaruGear build or equip items in the Gear Builder tab to estimate build cost.</td></tr>`;

    const activePbTab = state.economyPriceTab || "tiers";
    const ovCount =
        Object.keys(priceBook.itemOverrides || {}).length +
        Object.keys(priceBook.gemOverrides || {}).length +
        Object.keys(priceBook.frostOverrides || {}).length;
    const ahTotalCount = Number(ahPrices?.counts?.total || 0);

    const pbContentHtml =
        activePbTab === "gems"
            ? renderGemsAndFrostsHtml(priceBook, costA, costB, costDef)
            : activePbTab === "overrides"
              ? renderOverridesHtml(priceBook)
              : activePbTab === "ah"
                ? renderAhPricesBrowserHtml(ahPrices)
                : renderTierMatrixHtml(priceBook);

    // Saved builds leaderboard
    const savedCosts = (state.savedBuilds || [])
        .map((b) => ({
            id: b.savedId || b.name,
            est: estimateBuildCost(b, priceBook, catalog, ahPrices),
        }))
        .filter((x) => x.est.pieceCount > 0)
        .sort((a, b) => b.est.totalGold - a.est.totalGold);

    const leaderboardRowsHtml = savedCosts
        .map(
            ({ est }, idx) => `
        <tr>
            <td>${idx + 1}</td>
            <td><strong>${escHtml(est.name)}</strong></td>
            <td data-label="GS">${est.gearScore > 0 ? fmtInt(est.gearScore) : "&mdash;"}</td>
            <td data-label="Base Gear">${fmtGold(est.baseGearGold)}</td>
            <td data-label="Lunagems">${fmtGold(est.lunagemsGold)} <span class="skill-meta">(${est.totalGemsCount})</span></td>
            <td data-label="Lunafrosts">${fmtGold(est.lunafrostsGold)}</td>
            <td data-label="Total Gold"><strong>${fmtGold(est.totalGold)}</strong></td>
            <td data-label="Gold / GS">${est.goldPerGs > 0 ? `${fmtDec(est.goldPerGs, 1)}g/GS` : "&mdash;"}</td>
        </tr>`
        )
        .join("");

    const cheaperSummary =
        cheaper === "A"
            ? `${escHtml(state.buildA.name)} is cheaper`
            : cheaper === "B"
              ? `${escHtml(state.buildB.name)} is cheaper`
              : "Same estimated cost";
    const diffCls = cheaper === "A" ? "delta-pos" : cheaper === "B" ? "delta-neg" : "delta-tie";

    out.innerHTML = `
        <div class="econ-disclaimer-banner" role="note">
            <span class="econ-disclaimer-icon" aria-hidden="true">&#9888;</span>
            <span><strong>Note:</strong> Most of these estimates are very inaccurate &mdash; make sure to replace them with your own prices below if you want an accurate gear cost!</span>
        </div>
        <div class="kpi-row">
            <div class="kpi-card">
                <div class="kpi-label">Build A Estimated Cost (${escHtml(state.buildA.name)})</div>
                <div class="kpi-value val-a">${fmtGold(costA.totalGold)}</div>
                <div class="kpi-sub">
                    Gear ${fmtGold(costA.baseGearGold)} &bull; Gems ${fmtGold(costA.lunagemsGold)} (${costA.totalGemsCount}) &bull; Frosts ${fmtGold(costA.lunafrostsGold)}
                    ${costA.goldPerGs > 0 ? ` &bull; ${fmtDec(costA.goldPerGs, 1)}g/GS` : ""}
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">Build B Estimated Cost (${escHtml(state.buildB.name)})</div>
                <div class="kpi-value val-b">${fmtGold(costB.totalGold)}</div>
                <div class="kpi-sub">
                    Gear ${fmtGold(costB.baseGearGold)} &bull; Gems ${fmtGold(costB.lunagemsGold)} (${costB.totalGemsCount}) &bull; Frosts ${fmtGold(costB.lunafrostsGold)}
                    ${costB.goldPerGs > 0 ? ` &bull; ${fmtDec(costB.goldPerGs, 1)}g/GS` : ""}
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">Cost Comparison (A vs B)</div>
                <div class="kpi-value ${diffCls}">${fmtGoldDelta(deltaGold)} <span class="kpi-rate">(${fmtDeltaPct(deltaPct)})</span></div>
                <div class="kpi-sub">
                    ${cheaperSummary}
                    ${goldPer10kEhpA > 0 && goldPer10kEhpB > 0 ? ` &bull; Gold/10k Melee EHP: ${fmtGold(goldPer10kEhpA)} vs ${fmtGold(goldPer10kEhpB)}` : ""}
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">Target / Def Cost (${escHtml(state.defender.name)})</div>
                <div class="kpi-value">${fmtGold(costDef?.totalGold || 0)}</div>
                <div class="kpi-sub">
                    Gear ${fmtGold(costDef?.baseGearGold || 0)} &bull; Gems ${fmtGold(costDef?.lunagemsGold || 0)} (${costDef?.totalGemsCount || 0}) &bull; Frosts ${fmtGold(costDef?.lunafrostsGold || 0)}
                </div>
            </div>
        </div>

        <div class="econ-section-box">
            <div class="econ-section-head">
                <div>
                    <div class="stat-group-label" style="margin:0">Gear Cost Breakdown (<span class="val-a">Build A</span> vs <span class="val-b">Build B</span>)</div>
                    <span class="hint-inline">Edit any gear gold input directly, or click any gem / lunafrost pill to assign a custom market price.${
                        ahPrices?.syncedAt
                            ? ` &bull; AH snapshot (${fmtInt(ahTotalCount)} items, synced ${escHtml(new Date(ahPrices.syncedAt).toLocaleDateString())})`
                            : ""
                    }</span>
                </div>
                <div class="econ-head-actions">
                    <label class="econ-ah-toggle" title="Use synced sermeatball.com AH prices automatically for matching lunagems, lunafrosts &amp; grade-compatible gear (manual overrides always take priority)">
                        <input type="checkbox" id="econUseAhChk" ${priceBook.useAhPrices !== false ? "checked" : ""} ${ahTotalCount === 0 ? "disabled" : ""} />
                        <span>Use AH Prices${ahTotalCount > 0 ? ` (${fmtInt(ahTotalCount)})` : ""}</span>
                    </label>
                    <button type="button" class="sm primary" id="econSyncAhBtn" ${!state.diskApiAvailable || state.economyAhSyncing ? "disabled" : ""} title="${escHtml(
                        state.diskApiAvailable
                            ? "Manually scrape latest ArcheAge Classic AH price history from sermeatball.com (never runs automatically)"
                            : "Disabled on static hosting — run locally with `python tools/serve.py` to scrape live AH prices from sermeatball.com"
                    )}">${state.economyAhSyncing ? "Syncing AH..." : "&#8635; Sync AH Prices"}</button>
                    <button type="button" class="sm" id="econExportBtn">&darr; Export Prices (.json)</button>
                    <button type="button" class="sm" id="econImportBtn">&uarr; Import Prices (.json)</button>
                    <input type="file" id="econImportFile" accept=".json" class="hidden" />
                    <button type="button" class="sm danger" id="econResetBtn">Reset Default Prices</button>
                </div>
            </div>
            <div class="table-wrap" style="margin-top:8px">
                <table class="econ-compare-table mobile-card-table">
                    <thead>
                        <tr>
                            <th style="width:110px">Slot</th>
                            <th>Build A: ${escHtml(state.buildA.name)}</th>
                            <th>Build B: ${escHtml(state.buildB.name)}</th>
                            <th style="width:105px">&Delta; (A &minus; B)</th>
                        </tr>
                    </thead>
                    <tbody>${slotRowsHtml}</tbody>
                </table>
            </div>
        </div>

        ${renderUpgradeAdvisorHtml(priceBook, catalog, ahPrices, disableAvoid)}

        <div class="econ-section-box">
            <div class="econ-section-head">
                <div class="stat-group-label" style="margin:0">Market Price Book (Server / Custom Valuation)</div>
                <div class="seg-group" id="econPbTabs">
                    <button type="button" class="seg-btn ${activePbTab === "tiers" ? "active" : ""}" data-econ-tab="tiers">Gear Tiers &times; Grades</button>
                    <button type="button" class="seg-btn ${activePbTab === "gems" ? "active" : ""}" data-econ-tab="gems">Lunagems &amp; Frosts</button>
                    <button type="button" class="seg-btn ${activePbTab === "overrides" ? "active" : ""}" data-econ-tab="overrides">Exact Overrides (${ovCount})</button>
                    <button type="button" class="seg-btn ${activePbTab === "ah" ? "active" : ""}" data-econ-tab="ah">AH Prices (${fmtInt(ahTotalCount)})</button>
                </div>
            </div>
            <div style="margin-top:10px">${pbContentHtml}</div>
        </div>

        ${
            savedCosts.length > 0
                ? `
        <details class="econ-section-box econ-leaderboard">
            <summary class="stat-group-label" style="cursor:pointer;margin:0">All Saved Builds Cost Leaderboard (${savedCosts.length} builds with gear)</summary>
            <div class="table-wrap" style="margin-top:8px">
                <table class="mobile-card-table mct-skip-rank mct-cols-3">
                    <thead>
                        <tr>
                            <th style="width:36px">#</th>
                            <th>Build</th>
                            <th>GS</th>
                            <th>Base Gear</th>
                            <th>Lunagems</th>
                            <th>Lunafrosts</th>
                            <th>Total Est. Gold</th>
                            <th>Gold / GS</th>
                        </tr>
                    </thead>
                    <tbody>${leaderboardRowsHtml}</tbody>
                </table>
            </div>
        </details>`
                : ""
        }
    `;

    bindEconomyEvents(out, priceBook);
}

function bindEconomyEvents(out, priceBook) {
    // Sub-tabs
    out.querySelectorAll("[data-econ-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.economyPriceTab = btn.dataset.econTab;
            ui.renderSimulation();
        });
    });

    // Upgrade Value Advisor goal switcher
    out.querySelectorAll("[data-econ-advisor-goal]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.economyAdvisorGoal = btn.dataset.econAdvisorGoal;
            ui.renderSimulation();
        });
    });

    // Toggle Use AH Prices
    document.getElementById("econUseAhChk")?.addEventListener("change", (e) => {
        const useAh = Boolean(e.target.checked);
        saveEconomyPriceBook({ ...priceBook, useAhPrices: useAh });
        ui.renderSimulation();
        showToast(
            useAh ? "Using synced sermeatball.com AH prices where available" : "Disabled AH prices — using Tier/Group defaults & custom overrides",
            "ok"
        );
    });

    // Manual Opt-In Sync AH Prices button
    document.getElementById("econSyncAhBtn")?.addEventListener("click", async () => {
        if (!state.diskApiAvailable || state.economyAhSyncing) return;
        try {
            showToast("Syncing Auction House prices from sermeatball.com...", "ok");
            const data = await syncEconomyAhPricesFromServer();
            const c = data?.counts || {};
            showToast(
                `Synced ${(c.total || 0).toLocaleString()} AH prices (${c.gems || 0} gems, ${c.frosts || 0} frosts, ${c.items || 0} gear items)`,
                "ok"
            );
        } catch (err) {
            showToast(`AH price sync failed: ${err.message || err}`, "err");
        }
    });

    // Click grade-skipped AH avg reference pill -> apply as exact override
    out.querySelectorAll("[data-econ-apply-ah-item]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.dataset.econApplyAhItem;
            const val = Math.max(0, Math.round(Number(btn.dataset.econApplyAhGold) || 0));
            saveEconomyPriceBook({
                ...priceBook,
                itemOverrides: { ...(priceBook.itemOverrides || {}), [key]: val },
            });
            ui.renderSimulation();
            showToast(`Applied AH average ${fmtGold(val)} to ${key.replace("|", " [")}${key.includes("|") ? "]" : ""}`, "ok");
        });
    });

    // AH Prices browser search & category filters
    const ahSearchInp = document.getElementById("econAhSearchInput");
    if (ahSearchInp) {
        ahSearchInp.addEventListener("input", () => {
            const pos = ahSearchInp.selectionStart;
            state.economyAhQuery = ahSearchInp.value;
            ui.renderSimulation();
            const nextInp = document.getElementById("econAhSearchInput");
            if (nextInp) {
                nextInp.focus();
                if (typeof pos === "number") nextInp.setSelectionRange(pos, pos);
            }
        });
    }
    out.querySelectorAll("[data-econ-ah-cat]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.economyAhCategory = btn.dataset.econAhCat || "all";
            ui.renderSimulation();
        });
    });

    // Inline base item override
    out.querySelectorAll("[data-econ-item-ov]").forEach((inp) => {
        inp.addEventListener("change", () => {
            const key = inp.dataset.econItemOv;
            const val = Math.max(0, Math.round(Number(inp.value) || 0));
            const next = {
                ...priceBook,
                itemOverrides: { ...(priceBook.itemOverrides || {}), [key]: val },
            };
            saveEconomyPriceBook(next);
            ui.renderSimulation();
            showToast(`Set ${key.replace("|", " (")}${key.includes("|") ? ")" : ""} = ${fmtGold(val)}`, "ok");
        });
    });

    // Click gem pill -> prompt for exact gold price
    out.querySelectorAll("[data-econ-edit-gem]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.dataset.econEditGem;
            const cur = Number(btn.dataset.econGemCur) || 0;
            const raw = prompt(`Set gold price per gem for "${key.replace("|", " [")}${key.includes("|") ? "]" : ""}" (blank to clear override):`, String(cur));
            if (raw === null) return;
            const nextOverrides = { ...(priceBook.gemOverrides || {}) };
            if (raw.trim() === "") {
                delete nextOverrides[key];
                saveEconomyPriceBook({ ...priceBook, gemOverrides: nextOverrides });
                showToast(`Cleared custom gem price for ${key.split("|")[0]}`, "ok");
            } else {
                const val = Math.max(0, Math.round(Number(raw.replace(/,/g, "")) || 0));
                nextOverrides[key] = val;
                saveEconomyPriceBook({ ...priceBook, gemOverrides: nextOverrides });
                showToast(`Set ${key.split("|")[0]} = ${fmtGold(val)} / gem`, "ok");
            }
            ui.renderSimulation();
        });
    });

    // Click frost pill -> prompt for exact gold price
    out.querySelectorAll("[data-econ-edit-frost]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.dataset.econEditFrost;
            const cur = Number(btn.dataset.econFrostCur) || 0;
            const raw = prompt(`Set gold price for lunafrost "${key}" (blank to clear override):`, String(cur));
            if (raw === null) return;
            const nextOverrides = { ...(priceBook.frostOverrides || {}) };
            if (raw.trim() === "") {
                delete nextOverrides[key];
                saveEconomyPriceBook({ ...priceBook, frostOverrides: nextOverrides });
                showToast(`Cleared custom frost price for ${key}`, "ok");
            } else {
                const val = Math.max(0, Math.round(Number(raw.replace(/,/g, "")) || 0));
                nextOverrides[key] = val;
                saveEconomyPriceBook({ ...priceBook, frostOverrides: nextOverrides });
                showToast(`Set ${key} = ${fmtGold(val)}`, "ok");
            }
            ui.renderSimulation();
        });
    });

    // Tier × Grade matrix inputs
    out.querySelectorAll("[data-econ-tier][data-econ-grade]").forEach((inp) => {
        inp.addEventListener("change", () => {
            const tid = inp.dataset.econTier;
            const gid = inp.dataset.econGrade;
            const val = Math.max(0, Math.round(Number(inp.value) || 0));
            const nextTiers = { ...(priceBook.tierGrades || {}) };
            nextTiers[tid] = { ...(nextTiers[tid] || {}), [gid]: val };
            saveEconomyPriceBook({ ...priceBook, tierGrades: nextTiers });
            ui.renderSimulation();
        });
    });

    // Gem group defaults
    out.querySelectorAll("[data-econ-gem-group]").forEach((inp) => {
        inp.addEventListener("change", () => {
            const gid = inp.dataset.econGemGroup;
            const val = Math.max(0, Math.round(Number(inp.value) || 0));
            saveEconomyPriceBook({
                ...priceBook,
                gemGroups: { ...(priceBook.gemGroups || {}), [gid]: val },
            });
            ui.renderSimulation();
        });
    });

    // Active per-gem override inputs in Gems tab
    out.querySelectorAll("[data-econ-gem-ov]").forEach((inp) => {
        inp.addEventListener("change", () => {
            const key = inp.dataset.econGemOv;
            const val = Math.max(0, Math.round(Number(inp.value) || 0));
            saveEconomyPriceBook({
                ...priceBook,
                gemOverrides: { ...(priceBook.gemOverrides || {}), [key]: val },
            });
            ui.renderSimulation();
        });
    });

    // Frost group defaults
    out.querySelectorAll("[data-econ-frost-group]").forEach((inp) => {
        inp.addEventListener("change", () => {
            const fid = inp.dataset.econFrostGroup;
            const val = Math.max(0, Math.round(Number(inp.value) || 0));
            saveEconomyPriceBook({
                ...priceBook,
                frostGroups: { ...(priceBook.frostGroups || {}), [fid]: val },
            });
            ui.renderSimulation();
        });
    });

    // Delete override
    out.querySelectorAll("[data-econ-del-ov-kind]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const kind = btn.dataset.econDelOvKind;
            const key = btn.dataset.econDelOvKey;
            const mapKey = kind === "item" ? "itemOverrides" : kind === "gem" ? "gemOverrides" : "frostOverrides";
            const nextSub = { ...(priceBook[mapKey] || {}) };
            delete nextSub[key];
            saveEconomyPriceBook({ ...priceBook, [mapKey]: nextSub });
            ui.renderSimulation();
            showToast(`Removed override for ${key.split("|")[0]}`, "ok");
        });
    });

    // Export price book JSON
    document.getElementById("econExportBtn")?.addEventListener("click", () => {
        const blob = new Blob([JSON.stringify(priceBook, null, 2) + "\n"], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `aac-economy-prices-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast("Exported economy price book JSON", "ok");
    });

    // Import price book JSON
    const impFile = document.getElementById("econImportFile");
    document.getElementById("econImportBtn")?.addEventListener("click", () => impFile?.click());
    impFile?.addEventListener("change", async () => {
        const file = impFile.files?.[0];
        impFile.value = "";
        if (!file) return;
        try {
            const parsed = JSON.parse(await file.text());
            saveEconomyPriceBook(parsed);
            ui.renderSimulation();
            showToast(`Imported price book from ${file.name}`, "ok");
        } catch (err) {
            showToast(`Invalid price book JSON: ${err.message}`, "err");
        }
    });

    // Reset default prices
    document.getElementById("econResetBtn")?.addEventListener("click", () => {
        if (!confirm("Reset all Economy gear, gem, and frost prices (and custom overrides) back to defaults?")) return;
        saveEconomyPriceBook(createDefaultEconomyPriceBook());
        ui.renderSimulation();
        showToast("Reset Economy prices to AA Classic defaults", "ok");
    });
}
