/**
 * Quick Gear Swap Modal:
 *  - Tab 1: 1-to-1 Armor Grade, Armor Type (Plate/Leather/Cloth), Armor Tier,
 *           Weapon Setup Archetype (2H <-> Dual Wield <-> 1H + Phys/Magic Shield), & Weapon Grade Swaps
 *  - Tab 2: Lunagems (Hat & Any Slot)
 *  - Tab 3: Costume / Undergarment / Cloak Synthesis Swaps
 */

import {
    ARCHEAGE_GRADES,
    ARMOR_SLOTS,
    ARMOR_TIERS,
    COSTUME_SYNTH_PRESETS,
    LUNAGEM_SWAP_PRESETS,
    WEAPON_ARCHETYPES,
    applyModifiers,
    computeEffectiveStats,
    getGradeById,
    inspectArmorState,
    inspectWeaponArchetype,
    parseGearStatLine,
    shiftArmorGrades,
    shiftWeaponGrades,
    simulateSkillDamage,
    simulateSkillHeal,
    swapArmorTier,
    swapArmorType,
    swapEquipmentSynthStat,
    swapSlotLunagems,
    swapWeaponArchetype,
} from "../engine/index.js";
import {
    buildCustomSkill,
    escHtml,
    fmtDec,
    fmtDeltaPct,
    fmtInt,
    getActiveSkillObject,
    getContext,
    getEffectiveDefenderDisableAvoidance,
    getMatchingSkills,
    getSlotModifiers,
    showToast,
    state,
    ui,
} from "./state.js";

const GEM_SWAP_SLOTS = [
    { slotId: 1, label: "Head (Hat)" },
    { slotId: 2, label: "Chest" },
    { slotId: 7, label: "Legs" },
    { slotId: 8, label: "Feet" },
    { slotId: 4, label: "Wrists" },
    { slotId: 5, label: "Hands" },
    { slotId: 9, label: "Undergarments" },
    { slotId: 15, label: "Right Hand Weapon" },
    { slotId: 16, label: "Left Hand / Shield" },
    { slotId: 17, label: "Ranged Weapon" },
];

const SYNTH_SWAP_SLOTS = [
    { slotId: 0, label: "Costume" },
    { slotId: 9, label: "Undergarments" },
    { slotId: 6, label: "Cloak" },
];

export function openGearSwapModal(targetSlot = "B") {
    state.gearSwapTargetSlot = targetSlot === "A" ? "A" : "B";
    renderGearSwapModal();
    document.getElementById("gearSwapModal").classList.add("open");
}

export function closeGearSwapModal() {
    document.getElementById("gearSwapModal").classList.remove("open");
}

function getBuildForSwapSlot(slot) {
    return slot === "A" ? state.buildA : state.buildB;
}

function setBuildForSwapSlot(slot, nextChar) {
    if (slot === "A") state.buildA = nextChar;
    else state.buildB = nextChar;
    state.loadedSavedId[slot] = null;
}

export function renderGearSwapModal() {
    const bodyEl = document.getElementById("gearSwapBody");
    const previewEl = document.getElementById("gearSwapPreview");
    if (!bodyEl || !previewEl) return;

    const slot = state.gearSwapTargetSlot === "A" ? "A" : "B";
    const ch = getBuildForSwapSlot(slot);
    const eqList = Array.isArray(ch.equipment) ? ch.equipment : [];
    const activeTab = state.gearSwapTab || "armor";

    document.querySelectorAll("#gsTargetSlotPills .seg-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.gsSlot === slot);
    });

    const findEq = (sid) => eqList.find((item) => Number(item.slotId) === Number(sid)) || null;
    const armorInfo = inspectArmorState(ch);
    const wepInfo = inspectWeaponArchetype(ch);
    const tierOverrideId = state.gearSwapTierId || armorInfo.detectedTierId;
    const scaleAttrs = state.gearSwapScaleAttrs !== false;
    const scaleWepAtk = state.gearSwapScaleWeaponAtk !== false;
    const defaultTwoHandRatio = wepInfo.exactTwoHandRatio || 1.2 / 1.05;
    const twoHandRatio =
        state.gearSwapTwoHandRatio != null && Number.isFinite(Number(state.gearSwapTwoHandRatio))
            ? Number(state.gearSwapTwoHandRatio)
            : defaultTwoHandRatio;
    const selectedPieces =
        state.gearSwapSelectedArmorSlots instanceof Set && state.gearSwapSelectedArmorSlots.size > 0
            ? state.gearSwapSelectedArmorSlots
            : new Set(ARMOR_SLOTS.map((s) => s.slotId));

    const tabBarHtml = `
        <div class="gs-mode-tabs" id="gsModeTabs">
            <button type="button" class="seg-btn ${activeTab === "armor" ? "active" : ""}" data-gs-tab="armor">1-to-1 Armor, Weapons &amp; Grades</button>
            <button type="button" class="seg-btn ${activeTab === "gems" ? "active" : ""}" data-gs-tab="gems">Lunagems (Hat &amp; Slots)</button>
            <button type="button" class="seg-btn ${activeTab === "synth" ? "active" : ""}" data-gs-tab="synth">Costume / Synthesis</button>
        </div>
    `;

    let tabContentHtml = "";

    if (activeTab === "armor") {
        const gradeOptsHtml = ARCHEAGE_GRADES.filter((g) => g.id >= 4)
            .map(
                (g) =>
                    `<option value="${g.id}" ${g.id === 9 ? "selected" : ""}>${escHtml(g.name)} (${g.mainMod}% Def / ${g.statMod}% Stat)</option>`
            )
            .join("");

        const tierOptsHtml = ARMOR_TIERS.map(
            (t) =>
                `<option value="${escHtml(t.id)}" ${t.id === tierOverrideId ? "selected" : ""}>${escHtml(t.label)}</option>`
        ).join("");

        const setBuffLabel = armorInfo.setBuff?.armorType
            ? `${armorInfo.setBuff.minGradeId != null ? getGradeById(armorInfo.setBuff.minGradeId).name + " " : ""}${armorInfo.setBuff.armorType} (${armorInfo.setBuff.count}pc)`
            : "Mixed (<4pc matching)";

        const pieceCheckboxesHtml = ARMOR_SLOTS.map((s) => {
            const piece = findEq(s.slotId);
            const gLabel = piece ? getGradeById(piece.gradeId).name : "Epic";
            const tLabel = piece?.type || armorInfo.dominantType;
            const checked = selectedPieces.has(s.slotId) ? "checked" : "";
            return `
                <label class="gs-piece-chk">
                    <input type="checkbox" class="gs-armor-slot-chk" value="${s.slotId}" ${checked} />
                    <span><strong>${escHtml(s.slotName)}</strong> (${escHtml(gLabel)} ${escHtml(tLabel)})</span>
                </label>`;
        }).join("");

        const weaponSlots = [15, 16, 17].map((sid) => findEq(sid)).filter(Boolean);
        const wepRowsHtml =
            weaponSlots.length === 0
                ? `<div class="hint-inline">No weapons or shield recorded in equipment list.</div>`
                : weaponSlots
                      .map((w) => {
                          const g = getGradeById(w.gradeId);
                          return `
                          <div class="gs-wep-row">
                              <span>
                                  <strong>${escHtml(w.slotName || "Weapon")}:</strong> ${escHtml(w.name)}
                                  <span style="color:${escHtml(g.color)};font-weight:700">[${escHtml(g.name)}]</span>
                              </span>
                              <div class="gs-hat-btns">
                                  <button type="button" class="sm" data-wep-shift="-1" data-wep-slot="${w.slotId}">&minus;1 Grade</button>
                                  <button type="button" class="sm" data-wep-shift="1" data-wep-slot="${w.slotId}">+1 Grade</button>
                              </div>
                          </div>`;
                      })
                      .join("");

        const currentArchMeta = WEAPON_ARCHETYPES.find((a) => a.id === wepInfo.archetype);
        const wepArchBtnsHtml = WEAPON_ARCHETYPES.map(
            (a) => `
            <button type="button" class="sm gs-type-btn ${wepInfo.archetype === a.id ? "active-type" : ""}" data-wep-arch-swap="${escHtml(a.id)}" title="${escHtml(a.summary)}">
                ${escHtml(a.shortLabel)}
            </button>`
        ).join("");

        // Live Side-by-Side "What-If" Preview Tables (computed in memory without mutating Build A/B)
        const slotMods = getSlotModifiers(slot);
        const defMods = getSlotModifiers("defender");
        const effDefNow = applyModifiers(state.defender, defMods);
        const baseCtx = getContext();
        const isPvENow = Boolean(baseCtx.isPvE);
        const disAvoidNow = getEffectiveDefenderDisableAvoidance();
        const selSkill = state.isCustomSkill ? buildCustomSkill() : getActiveSkillObject(getMatchingSkills());
        const simSkillFor = (candChar) => {
            if (!selSkill) return { exp: 0, dps: 0, isHeal: false };
            const simFn = selSkill.kind === "heal" ? simulateSkillHeal : simulateSkillDamage;
            const r = simFn(
                candChar,
                state.defender,
                selSkill,
                { ...baseCtx, attackerModifiers: slotMods, defenderModifiers: defMods },
                {}
            );
            return { exp: r.expected, dps: r.dps?.sustained ?? 0, isHeal: selSkill.kind === "heal" };
        };
        const evalCandidate = (candChar) => {
            const effC = applyModifiers(candChar, slotMods);
            const st = computeEffectiveStats(effC, effDefNow, {}, { isPvE: isPvENow, disableAvoidance: disAvoidNow });
            const sk = simSkillFor(candChar);
            return {
                eff: effC,
                meleeEhp: st.defense.ehp.melee.vsAttackerEhp,
                magicEhp: st.defense.ehp.magic.vsAttackerEhp,
                gcdSec: st.offense.speed.effectiveGcdSec,
                skillExp: sk.exp,
                skillDps: sk.dps,
                isHeal: sk.isHeal,
            };
        };
        const baseEval = evalCandidate(ch);
        const fmtWhatIfDelta = (val, base) => {
            const pct = base > 0 ? ((val - base) / base) * 100 : 0;
            const cls = pct > 0.05 ? "delta-pos" : pct < -0.05 ? "delta-neg" : "delta-tie";
            return `<span class="${cls}">${fmtDeltaPct(pct)}</span>`;
        };
        const allArmorIds = Array.from(selectedPieces);
        const armorWhatIfRows = ["Cloth", "Leather", "Plate"]
            .map((tName) => {
                const isCur = armorInfo.dominantType === tName;
                const cand = isCur
                    ? ch
                    : swapArmorType(ch, tName, { slotIds: allArmorIds, tierId: tierOverrideId, renamePieces: true })
                          .character;
                const ev = isCur ? baseEval : evalCandidate(cand);
                return `
                <tr class="${isCur ? "gs-whatif-cur" : ""}">
                    <td><strong>${tName}</strong>${isCur ? ` <span class="stag stag-rank">Current</span>` : ""}</td>
                    <td>${fmtInt(ev.eff.defense.physicalDefense)}</td>
                    <td>${fmtInt(ev.eff.defense.magicDefense)}</td>
                    <td>${fmtInt(ev.eff.maxHealth)}</td>
                    <td>${fmtInt(ev.meleeEhp)} <span class="skill-meta">(${fmtWhatIfDelta(ev.meleeEhp, baseEval.meleeEhp)})</span></td>
                    <td>${fmtInt(ev.magicEhp)} <span class="skill-meta">(${fmtWhatIfDelta(ev.magicEhp, baseEval.magicEhp)})</span></td>
                    <td>${isCur ? `<span class="skill-meta">Active</span>` : `<button type="button" class="sm" data-armor-type-swap="${tName}">Apply</button>`}</td>
                </tr>`;
            })
            .join("");

        const weaponWhatIfRows = WEAPON_ARCHETYPES.map((arch) => {
            const isCur = wepInfo.archetype === arch.id;
            const cand = isCur
                ? ch
                : swapWeaponArchetype(ch, arch.id, {
                      includeWeaponAtkScale: scaleWepAtk,
                      twoHandAtkRatio: twoHandRatio,
                  }).character;
            const ev = isCur ? baseEval : evalCandidate(cand);
            const domAtk = Math.max(
                ev.eff.offense.meleeAttack || 0,
                ev.eff.offense.rangedAttack || 0,
                ev.eff.offense.magicAttack || 0,
                ev.eff.offense.healingPower || 0
            );
            return `
            <tr class="${isCur ? "gs-whatif-cur" : ""}">
                <td><strong>${escHtml(arch.shortLabel)}</strong>${isCur ? ` <span class="stag stag-rank">Current</span>` : ""}</td>
                <td>${fmtInt(domAtk)}</td>
                <td>${fmtDec(ev.gcdSec, 2)}s / ${fmtDec(ev.eff.offense.castTimePct, 0)}%</td>
                <td>${fmtInt(ev.skillExp)} <span class="skill-meta">(${fmtWhatIfDelta(ev.skillExp, baseEval.skillExp)})</span></td>
                <td>${fmtInt(ev.meleeEhp)} <span class="skill-meta">(${fmtWhatIfDelta(ev.meleeEhp, baseEval.meleeEhp)})</span></td>
                <td>${fmtInt(ev.magicEhp)} <span class="skill-meta">(${fmtWhatIfDelta(ev.magicEhp, baseEval.magicEhp)})</span></td>
                <td>${isCur ? `<span class="skill-meta">Active</span>` : `<button type="button" class="sm" data-wep-arch-swap="${escHtml(arch.id)}">Apply</button>`}</td>
            </tr>`;
        }).join("");

        tabContentHtml = `
            <div class="gs-section gs-whatif-section">
                <details class="gs-more-gems" open>
                    <summary><strong>Quick &ldquo;What-If&rdquo; Side-by-Side Comparison (No-Commit Preview &rarr; 1-Click Apply)</strong></summary>
                    <div class="hint-inline" style="margin:6px 0">
                        Compares every Armor Type &amp; Weapon Setup for <span class="${slot === "A" ? "val-a" : "val-b"}"><strong>${escHtml(ch.name)}</strong></span> vs <strong>${escHtml(effDefNow.name)}</strong>${selSkill ? ` (skill: <strong>${escHtml(selSkill.name)}</strong>)` : ""} without overwriting until you click Apply.
                    </div>
                    <div class="gs-whatif-grid">
                        <div class="table-wrap">
                            <table class="gs-whatif-table">
                                <thead>
                                    <tr>
                                        <th>Armor Type</th>
                                        <th>PDef</th>
                                        <th>MDef</th>
                                        <th>Max HP</th>
                                        <th>Melee EHP</th>
                                        <th>Magic EHP</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>${armorWhatIfRows}</tbody>
                            </table>
                        </div>
                        <div class="table-wrap">
                            <table class="gs-whatif-table">
                                <thead>
                                    <tr>
                                        <th>Weapon Setup</th>
                                        <th>Top Atk/HPwr</th>
                                        <th>GCD / Cast</th>
                                        <th>${selSkill ? escHtml(selSkill.name.slice(0, 16)) : "Skill"} Exp</th>
                                        <th>Melee EHP</th>
                                        <th>Magic EHP</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>${weaponWhatIfRows}</tbody>
                            </table>
                        </div>
                    </div>
                </details>
            </div>

            <div class="gs-section">
                <div class="gs-sec-hdr">
                    <strong>1. Armor Grade Swapper (1-to-1) &mdash; <span class="${slot === "A" ? "val-a" : "val-b"}">${escHtml(ch.name)}</span></strong>
                    <label class="gs-inline-field" title="Armor base level tier used for exact DaruGear defense & attribute scaling">
                        Tier
                        <select id="gsArmorTierSel">${tierOptsHtml}</select>
                    </label>
                </div>
                <div class="gs-armor-summary">
                    <span class="gs-armor-pill">${escHtml(armorInfo.gradeSummary)}</span>
                    <span class="gs-armor-pill">${escHtml(armorInfo.dominantType)}</span>
                    <span class="gs-armor-pill">Set Buff: ${escHtml(setBuffLabel)}</span>
                    <span class="hint-inline">Exact AA Classic 1.3.6 grade multipliers (PDef/MDef + Grade Buff + HP + Attributes)</span>
                </div>
                <div class="gs-hat-bar">
                    <div class="gs-hat-btns">
                        <button type="button" class="sm primary" id="gsArmorDown1Btn">&minus;1 Grade (All Armor)</button>
                        <button type="button" class="sm primary" id="gsArmorUp1Btn">+1 Grade (All Armor)</button>
                    </div>
                    <label class="gs-inline-field">
                        Set All To
                        <select id="gsArmorSetGradeSel">${gradeOptsHtml}</select>
                    </label>
                    <button type="button" class="sm" id="gsArmorSetGradeBtn">Apply Grade</button>
                    <label class="gs-inline-field" style="cursor:pointer" title="Scale armor primary attributes (STR/AGI/STA/INT/SPI) using exact 1.3.6 statMod">
                        <input type="checkbox" id="gsScaleAttrsChk" ${scaleAttrs ? "checked" : ""} />
                        Scale attributes
                    </label>
                </div>
            </div>

            <div class="gs-section">
                <div class="gs-sec-hdr">
                    <strong>2. Armor Type &amp; Tier 1-to-1 Swap (e.g. Ayanad Wave Plate &harr; Cloth / Leather)</strong>
                    <span class="hint-inline">Swaps PDef/MDef ratios, Complete Set Buff &amp; Grade Buff while keeping grades, tempers &amp; suffix stats</span>
                </div>
                <div class="gs-hat-bar">
                    <div class="gs-hat-btns">
                        <button type="button" class="sm gs-type-btn ${armorInfo.dominantType === "Cloth" ? "active-type" : ""}" data-armor-type-swap="Cloth">
                            Swap &rarr; Cloth (20% PDef / 100% MDef)
                        </button>
                        <button type="button" class="sm gs-type-btn ${armorInfo.dominantType === "Leather" ? "active-type" : ""}" data-armor-type-swap="Leather">
                            Swap &rarr; Leather (60% PDef / 60% MDef)
                        </button>
                        <button type="button" class="sm gs-type-btn ${armorInfo.dominantType === "Plate" ? "active-type" : ""}" data-armor-type-swap="Plate">
                            Swap &rarr; Plate (120% PDef / 0% MDef)
                        </button>
                    </div>
                </div>
                <div class="gs-hat-bar">
                    <label class="gs-inline-field">
                        1-to-1 Tier Swap (keep grade &amp; type)
                        <select id="gsSwapTierTargetSel">${tierOptsHtml}</select>
                    </label>
                    <button type="button" class="sm" id="gsSwapTierBtn">Swap Armor Tier</button>
                </div>
                <details class="gs-more-gems">
                    <summary>Target Specific Armor Pieces Only (${selectedPieces.size}/7 selected &mdash; useful for 4pc/3pc hybrids)</summary>
                    <div class="gs-armor-grid">${pieceCheckboxesHtml}</div>
                </details>
            </div>

            <div class="gs-section">
                <div class="gs-sec-hdr">
                    <strong>3. Weapon Setup Swap (2H &harr; Dual Wield &harr; 1H + Shield)</strong>
                    <span class="gs-armor-pill">Current: ${escHtml(currentArchMeta?.shortLabel || wepInfo.archetype)} (${escHtml(wepInfo.gradeName)})</span>
                </div>
                <div class="hint-inline" style="margin-bottom:6px">
                    Swaps exact AA Classic 1.3.6 equip passives: <strong>2H</strong> (#8227: +5% Skill/Heal, -7% Cast, +50% Shield Pen) &harr; <strong>DW</strong> (#4899: +177 Atk Spd) &harr; <strong>Shield</strong> (#8226: +200 Def/MDef, +350 HP, +Shield Def &amp; +10% Block).
                </div>
                <div class="gs-hat-bar">
                    <div class="gs-hat-btns">${wepArchBtnsHtml}</div>
                    <label class="gs-inline-field" style="cursor:pointer" title="Scale dominant weapon attack power by 2H/1H ratio when swapping between 2H and 1H setups">
                        <input type="checkbox" id="gsScaleWepAtkChk" ${scaleWepAtk ? "checked" : ""} />
                        2H/1H Atk Ratio
                        <input type="number" id="gsTwoHandRatioInp" step="0.001" min="1.00" max="1.35" value="${twoHandRatio.toFixed(3)}" style="width:68px" />
                    </label>
                </div>
            </div>

            <div class="gs-section">
                <div class="gs-sec-hdr">
                    <strong>4. Weapon &amp; Shield Grade Swap (&minus;1 / +1 Grade)</strong>
                    <div class="gs-hat-btns">
                        <button type="button" class="sm" id="gsWepAllDownBtn">&minus;1 Grade (All Weapons)</button>
                        <button type="button" class="sm" id="gsWepAllUpBtn">+1 Grade (All Weapons)</button>
                    </div>
                </div>
                <div class="gs-wep-list">${wepRowsHtml}</div>
            </div>
        `;
    } else if (activeTab === "gems") {
        const hatItem = findEq(1);
        const hatGems = Array.isArray(hatItem?.lunagems) ? hatItem.lunagems : [];
        const hatCount = Math.max(1, hatGems.length || 2);
        const hatGemSummary =
            hatGems.length > 0
                ? `${hatGems.length}× ${hatGems[0].text || hatGems[0].name}`
                : "No lunagems recorded (will add fresh)";

        const gemSlotId = Number(state.gearSwapGemSlotId ?? 1);
        const selGemItem = findEq(gemSlotId);
        const selGemList = Array.isArray(selGemItem?.lunagems) ? selGemItem.lunagems : [];
        const selGemCount = Math.max(1, selGemList.length || 2);
        const selGemSummary =
            selGemList.length > 0 ? selGemList.map((g) => g.text || g.name).join(" • ") : "None";

        tabContentHtml = `
            <div class="gs-section">
                <div class="gs-sec-hdr">
                    <strong>Head (Hat) Lunagem Quick Compare &mdash; <span class="${slot === "A" ? "val-a" : "val-b"}">${escHtml(ch.name)}</span></strong>
                    <span class="hint-inline">${escHtml(hatItem ? `${hatItem.name}: ` : "")}${escHtml(hatGemSummary)}</span>
                </div>
                <div class="gs-hat-bar">
                    <label class="gs-inline-field">
                        Hat Sockets
                        <input type="number" id="gsHatCount" min="1" max="8" value="${hatCount}" />
                    </label>
                    <div class="gs-hat-btns">
                        <button type="button" class="sm" data-hat-swap="pdef" data-hat-val="100">Hat &rarr; Phys Def (+100/gem)</button>
                        <button type="button" class="sm" data-hat-swap="mdef" data-hat-val="100">Hat &rarr; Magic Def (+100/gem)</button>
                        <button type="button" class="sm" data-hat-swap="toughness_hat" data-hat-val="170">Hat &rarr; Toughness (+170/gem)</button>
                        <button type="button" class="sm" data-hat-swap="toughness_t3" data-hat-val="353">Hat &rarr; Toughness (+353/gem)</button>
                    </div>
                </div>
                <details class="gs-more-gems" open>
                    <summary>Swap Lunagems on Any Slot (${escHtml(GEM_SWAP_SLOTS.find((x) => x.slotId === gemSlotId)?.label || "Head")}: ${selGemList.length} gems)</summary>
                    <div class="gs-any-gem-row">
                        <label class="gs-inline-field">
                            Slot
                            <select id="gsAnySlotSel">
                                ${GEM_SWAP_SLOTS.map((s) => `<option value="${s.slotId}" ${s.slotId === gemSlotId ? "selected" : ""}>${escHtml(s.label)}</option>`).join("")}
                            </select>
                        </label>
                        <label class="gs-inline-field">
                            Lunagem Type
                            <select id="gsAnyGemPreset">
                                ${LUNAGEM_SWAP_PRESETS.map((p) => `<option value="${escHtml(p.id)}" data-def="${p.defaultValue}">${escHtml(p.label)} (+${p.defaultValue}${p.unit})</option>`).join("")}
                            </select>
                        </label>
                        <label class="gs-inline-field">
                            Count
                            <input type="number" id="gsAnyGemCount" min="0" max="10" value="${selGemCount}" />
                        </label>
                        <label class="gs-inline-field">
                            Per Gem
                            <input type="number" step="any" id="gsAnyGemVal" value="${LUNAGEM_SWAP_PRESETS[0].defaultValue}" />
                        </label>
                        <button type="button" class="sm primary" id="gsApplyAnyGemBtn">Apply Slot Gems</button>
                    </div>
                    <div class="hint-inline" style="margin-top:4px">Current gems: ${escHtml(selGemSummary)}</div>
                </details>
            </div>
        `;
    } else {
        const synthSlotId = Number(state.gearSwapSynthSlotId ?? 0);
        const selSynthItem = findEq(synthSlotId);
        const synthLines = Array.isArray(selSynthItem?.synthStats) ? selSynthItem.synthStats : [];
        const synthOptionsHtml = COSTUME_SYNTH_PRESETS.map(
            (p) => `<option value="${escHtml(p.id)}" data-def="${p.defaultValue}">${escHtml(p.label)} (${p.defaultValue}${p.unit})</option>`
        ).join("");
        const synthRowsHtml =
            synthLines.length === 0
                ? `<div class="hint-inline">No synthesis stats on ${escHtml(selSynthItem?.name || "this slot")}. Add one below to test a stat!</div>`
                : synthLines
                      .map((line, idx) => {
                          const parsed = parseGearStatLine(line);
                          return `
                          <div class="gs-synth-row" data-synth-idx="${idx}">
                              <div class="gs-synth-cur">
                                  <span class="gs-synth-line">${escHtml(line)}</span>
                                  ${!parsed.recognized ? `<span class="stag stag-var" title="Stat not recognized for automatic subtraction; replacement will still be added">custom</span>` : ""}
                              </div>
                              <div class="gs-synth-ctrl">
                                  <select class="gs-synth-sel" data-synth-sel="${idx}">${synthOptionsHtml}</select>
                                  <input type="number" step="any" class="gs-synth-val" data-synth-val="${idx}" value="${COSTUME_SYNTH_PRESETS[0].defaultValue}" />
                                  <button type="button" class="sm primary" data-synth-apply="${idx}">Swap</button>
                              </div>
                          </div>`;
                      })
                      .join("");

        tabContentHtml = `
            <div class="gs-section">
                <div class="gs-sec-hdr">
                    <strong>Costume / Undergarment / Cloak Synthesis Swapper &mdash; <span class="${slot === "A" ? "val-a" : "val-b"}">${escHtml(ch.name)}</span></strong>
                    <div class="seg-group" id="gsSynthSlotPills">
                        ${SYNTH_SWAP_SLOTS.map(
                            (s) =>
                                `<button type="button" class="seg-btn ${s.slotId === synthSlotId ? "active" : ""}" data-gs-synth-slot="${s.slotId}">${escHtml(s.label)}</button>`
                        ).join("")}
                    </div>
                </div>
                <div class="hint-inline">${escHtml(selSynthItem ? `${selSynthItem.name} (${selSynthItem.gradeName || "Synthesis"})` : "No item equipped in this slot")}</div>
                <div class="gs-synth-list">${synthRowsHtml}</div>
                <div class="gs-synth-add-row">
                    <span class="hint-inline">Add extra stat line:</span>
                    <select id="gsSynthAddSel">${synthOptionsHtml}</select>
                    <input type="number" step="any" id="gsSynthAddVal" value="${COSTUME_SYNTH_PRESETS[0].defaultValue}" />
                    <button type="button" class="sm" id="gsSynthAddBtn">+ Add Stat</button>
                </div>
            </div>
        `;
    }

    bodyEl.innerHTML = `${tabBarHtml}${tabContentHtml}`;

    // Bind Tab Switcher
    bodyEl.querySelectorAll("[data-gs-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.gearSwapTab = btn.dataset.gsTab;
            renderGearSwapModal();
        });
    });

    const commitGearSwap = (nextChar, msg) => {
        setBuildForSwapSlot(slot, nextChar);
        ui.renderCharacterCards();
        ui.renderSimulation();
        renderGearSwapModal();
        showToast(msg, "ok");
    };

    const getActiveArmorSlotIds = () => {
        const checked = Array.from(bodyEl.querySelectorAll(".gs-armor-slot-chk:checked")).map((el) =>
            parseInt(el.value, 10)
        );
        return checked.length > 0 ? checked : ARMOR_SLOTS.map((s) => s.slotId);
    };

    // Bind Tab 1: Armor, Weapon Setup & Grade Swaps
    const tierSel = document.getElementById("gsArmorTierSel");
    if (tierSel) {
        tierSel.addEventListener("change", () => {
            state.gearSwapTierId = tierSel.value;
            renderGearSwapModal();
        });
    }
    const scaleChk = document.getElementById("gsScaleAttrsChk");
    if (scaleChk) {
        scaleChk.addEventListener("change", () => {
            state.gearSwapScaleAttrs = scaleChk.checked;
        });
    }
    bodyEl.querySelectorAll(".gs-armor-slot-chk").forEach((chk) => {
        chk.addEventListener("change", () => {
            state.gearSwapSelectedArmorSlots = new Set(getActiveArmorSlotIds());
        });
    });

    const runGradeShift = (opts, label) => {
        const tid = document.getElementById("gsArmorTierSel")?.value || tierOverrideId;
        const doAttrs = document.getElementById("gsScaleAttrsChk")?.checked !== false;
        const sids = getActiveArmorSlotIds();
        const res = shiftArmorGrades(getBuildForSwapSlot(slot), {
            ...opts,
            slotIds: sids,
            tierId: tid,
            scaleAttributes: doAttrs,
        });
        commitGearSwap(
            res.character,
            `Build ${slot} ${label} (${res.changedCount} pcs: PDef ${res.piecePdefDelta >= 0 ? "+" : ""}${res.piecePdefDelta}, MDef ${res.pieceMdefDelta >= 0 ? "+" : ""}${res.pieceMdefDelta})`
        );
    };
    document.getElementById("gsArmorDown1Btn")?.addEventListener("click", () => {
        runGradeShift({ deltaGrades: -1 }, "Armor −1 Grade");
    });
    document.getElementById("gsArmorUp1Btn")?.addEventListener("click", () => {
        runGradeShift({ deltaGrades: +1 }, "Armor +1 Grade");
    });
    document.getElementById("gsArmorSetGradeBtn")?.addEventListener("click", () => {
        const gid = parseInt(document.getElementById("gsArmorSetGradeSel")?.value, 10);
        const gName = getGradeById(gid).name;
        runGradeShift({ targetGradeId: gid }, `Armor → ${gName}`);
    });

    bodyEl.querySelectorAll("[data-armor-type-swap]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const targetType = btn.dataset.armorTypeSwap;
            const tid = document.getElementById("gsArmorTierSel")?.value || tierOverrideId;
            const sids = getActiveArmorSlotIds();
            const res = swapArmorType(getBuildForSwapSlot(slot), targetType, {
                slotIds: sids,
                tierId: tid,
                renamePieces: true,
            });
            commitGearSwap(res.character, `Build ${slot} Armor → ${targetType} (${res.changedCount} pcs swapped)`);
        });
    });

    document.getElementById("gsSwapTierBtn")?.addEventListener("click", () => {
        const fromTid = document.getElementById("gsArmorTierSel")?.value || tierOverrideId;
        const toTid = document.getElementById("gsSwapTierTargetSel")?.value || "ayanad";
        const doAttrs = document.getElementById("gsScaleAttrsChk")?.checked !== false;
        const sids = getActiveArmorSlotIds();
        const res = swapArmorTier(getBuildForSwapSlot(slot), toTid, {
            slotIds: sids,
            fromTierId: fromTid,
            scaleAttributes: doAttrs,
        });
        state.gearSwapTierId = toTid;
        commitGearSwap(res.character, `Build ${slot} Armor Tier → ${res.newTier.shortLabel}`);
    });

    // Weapon Setup Archetype Swap bindings
    document.getElementById("gsScaleWepAtkChk")?.addEventListener("change", (e) => {
        state.gearSwapScaleWeaponAtk = Boolean(e.target.checked);
        renderGearSwapModal();
    });
    document.getElementById("gsTwoHandRatioInp")?.addEventListener("change", (e) => {
        state.gearSwapTwoHandRatio = Math.max(1, Math.min(1.35, parseFloat(e.target.value) || defaultTwoHandRatio));
        renderGearSwapModal();
    });
    bodyEl.querySelectorAll("[data-wep-arch-swap]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const targetArch = btn.dataset.wepArchSwap;
            const includeWeaponAtkScale = document.getElementById("gsScaleWepAtkChk")?.checked !== false;
            const ratio = parseFloat(document.getElementById("gsTwoHandRatioInp")?.value) || defaultTwoHandRatio;
            const res = swapWeaponArchetype(getBuildForSwapSlot(slot), targetArch, {
                includeWeaponAtkScale,
                twoHandAtkRatio: ratio,
            });
            if (!res.changed) {
                showToast(`Build ${slot} is already using that weapon setup`, "ok");
                return;
            }
            commitGearSwap(res.character, `Build ${slot} Weapon Setup: ${res.summary}`);
        });
    });

    document.getElementById("gsWepAllDownBtn")?.addEventListener("click", () => {
        const res = shiftWeaponGrades(getBuildForSwapSlot(slot), { deltaGrades: -1, slotIds: [15, 16, 17] });
        commitGearSwap(res.character, res.changes.length ? `Build ${slot} Weapons −1 Grade` : "No weapon grade changes");
    });
    document.getElementById("gsWepAllUpBtn")?.addEventListener("click", () => {
        const res = shiftWeaponGrades(getBuildForSwapSlot(slot), { deltaGrades: +1, slotIds: [15, 16, 17] });
        commitGearSwap(res.character, res.changes.length ? `Build ${slot} Weapons +1 Grade` : "No weapon grade changes");
    });
    bodyEl.querySelectorAll("[data-wep-shift]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const delta = parseInt(btn.dataset.wepShift, 10);
            const sid = parseInt(btn.dataset.wepSlot, 10);
            const res = shiftWeaponGrades(getBuildForSwapSlot(slot), { deltaGrades: delta, slotIds: [sid] });
            commitGearSwap(res.character, res.changes[0] || `Build ${slot} Weapon ${delta > 0 ? "+1" : "−1"} Grade`);
        });
    });

    // Bind Tab 2: Hat & Any-Slot Lunagems
    bodyEl.querySelectorAll("[data-hat-swap]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const presetId = btn.dataset.hatSwap;
            const perGem = parseFloat(btn.dataset.hatVal);
            const cnt = Math.max(0, Math.min(8, parseInt(document.getElementById("gsHatCount")?.value, 10) || 2));
            const res = swapSlotLunagems(getBuildForSwapSlot(slot), 1, presetId, { count: cnt, perGemValue: perGem });
            commitGearSwap(res.character, `Build ${slot} Hat → ${cnt}× ${res.newGemText}`);
        });
    });
    const anySlotSel = document.getElementById("gsAnySlotSel");
    if (anySlotSel) {
        anySlotSel.addEventListener("change", () => {
            state.gearSwapGemSlotId = parseInt(anySlotSel.value, 10);
            renderGearSwapModal();
        });
    }
    const anyPresetSel = document.getElementById("gsAnyGemPreset");
    const anyValInp = document.getElementById("gsAnyGemVal");
    if (anyPresetSel && anyValInp) {
        anyPresetSel.addEventListener("change", () => {
            const p = LUNAGEM_SWAP_PRESETS.find((x) => x.id === anyPresetSel.value);
            if (p) anyValInp.value = p.defaultValue;
        });
    }
    document.getElementById("gsApplyAnyGemBtn")?.addEventListener("click", () => {
        const sid = parseInt(document.getElementById("gsAnySlotSel")?.value, 10);
        const pid = document.getElementById("gsAnyGemPreset")?.value;
        const cnt = parseInt(document.getElementById("gsAnyGemCount")?.value, 10);
        const val = parseFloat(document.getElementById("gsAnyGemVal")?.value);
        const res = swapSlotLunagems(getBuildForSwapSlot(slot), sid, pid, {
            count: Number.isFinite(cnt) ? cnt : 1,
            perGemValue: Number.isFinite(val) ? val : null,
        });
        commitGearSwap(res.character, `Build ${slot} ${res.slotName} → ${res.newCount}× ${res.newGemText}`);
    });

    // Bind Tab 3: Synthesis Slot Tabs & Per-Line Swap buttons
    const synthSlotId = Number(state.gearSwapSynthSlotId ?? 0);
    bodyEl.querySelectorAll("[data-gs-synth-slot]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.gearSwapSynthSlotId = parseInt(btn.dataset.gsSynthSlot, 10);
            renderGearSwapModal();
        });
    });
    bodyEl.querySelectorAll(".gs-synth-sel").forEach((sel) => {
        sel.addEventListener("change", () => {
            const idx = sel.dataset.synthSel;
            const valEl = bodyEl.querySelector(`[data-synth-val="${idx}"]`);
            const p = COSTUME_SYNTH_PRESETS.find((x) => x.id === sel.value);
            if (p && valEl) valEl.value = p.defaultValue;
        });
    });
    bodyEl.querySelectorAll("[data-synth-apply]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.synthApply, 10);
            const sel = bodyEl.querySelector(`[data-synth-sel="${idx}"]`);
            const valEl = bodyEl.querySelector(`[data-synth-val="${idx}"]`);
            const pid = sel?.value;
            const val = parseFloat(valEl?.value);
            const res = swapEquipmentSynthStat(
                getBuildForSwapSlot(slot),
                synthSlotId,
                idx,
                pid,
                Number.isFinite(val) ? val : null
            );
            commitGearSwap(res.character, `Build ${slot} ${res.slotName}: ${res.newLine}`);
        });
    });
    const addSel = document.getElementById("gsSynthAddSel");
    const addVal = document.getElementById("gsSynthAddVal");
    if (addSel && addVal) {
        addSel.addEventListener("change", () => {
            const p = COSTUME_SYNTH_PRESETS.find((x) => x.id === addSel.value);
            if (p) addVal.value = p.defaultValue;
        });
    }
    document.getElementById("gsSynthAddBtn")?.addEventListener("click", () => {
        const pid = document.getElementById("gsSynthAddSel")?.value;
        const val = parseFloat(document.getElementById("gsSynthAddVal")?.value);
        const res = swapEquipmentSynthStat(
            getBuildForSwapSlot(slot),
            synthSlotId,
            -1,
            pid,
            Number.isFinite(val) ? val : null
        );
        commitGearSwap(res.character, `Added to Build ${slot} ${res.slotName}: ${res.newLine}`);
    });

    // Live A vs B Impact Preview Strip (uses 3rd build as aggressor for Melee/Ranged/Magic EHP)
    const effA = applyModifiers(state.buildA, getSlotModifiers("A"));
    const effB = applyModifiers(state.buildB, getSlotModifiers("B"));
    const effDef = applyModifiers(state.defender, getSlotModifiers("defender"));
    const isPvE = Boolean(document.getElementById("ctxPvE")?.checked);
    const disableAvoidance = getEffectiveDefenderDisableAvoidance();
    const defA = computeEffectiveStats(effA, effDef, {}, { isPvE, disableAvoidance });
    const defB = computeEffectiveStats(effB, effDef, {}, { isPvE, disableAvoidance });

    const fmtCmpChip = (label, vA, vB, lowerBetter = false) => {
        const diff = vB - vA;
        const pct = Math.abs(vA) > 1e-6 ? (diff / vA) * 100 : 0;
        const good = lowerBetter ? diff < -0.01 : diff > 0.01;
        const bad = lowerBetter ? diff > 0.01 : diff < -0.01;
        const cls = good ? "delta-pos" : bad ? "delta-neg" : "delta-tie";
        return `<div class="gs-prev-kpi">
            <span class="gs-prev-lbl">${escHtml(label)}</span>
            <span class="gs-prev-vals"><span class="val-a">${fmtInt(vA)}</span> &rarr; <span class="val-b">${fmtInt(vB)}</span> <strong class="${cls}">(${fmtDeltaPct(pct)})</strong></span>
        </div>`;
    };

    const keyStatDeltas = [];
    const checkDelta = (lbl, a, b, unit = "") => {
        const d = Math.round((b - a) * 100) / 100;
        if (Math.abs(d) > 0.005) {
            keyStatDeltas.push(`${lbl} ${d > 0 ? "+" : ""}${d}${unit}`);
        }
    };
    checkDelta("PDef", effA.defense.physicalDefense, effB.defense.physicalDefense);
    checkDelta("MDef", effA.defense.magicDefense, effB.defense.magicDefense);
    checkDelta("HP", effA.maxHealth, effB.maxHealth);
    checkDelta("Tough", effA.defense.toughness, effB.defense.toughness);
    checkDelta("Resil", effA.defense.resilience, effB.defense.resilience);
    checkDelta("Melee DR", effA.defense.receivedMeleeDrPct, effB.defense.receivedMeleeDrPct, "%");
    checkDelta("Magic DR", effA.defense.receivedMagicDrPct, effB.defense.receivedMagicDrPct, "%");
    checkDelta("Evasion", effA.defense.evasionPct, effB.defense.evasionPct, "%");
    checkDelta("Parry", effA.defense.parryPct, effB.defense.parryPct, "%");
    checkDelta("Block", effA.defense.blockPct, effB.defense.blockPct, "%");
    checkDelta("Melee Atk", effA.offense.meleeAttack, effB.offense.meleeAttack);
    checkDelta("Ranged Atk", effA.offense.rangedAttack, effB.offense.rangedAttack);
    checkDelta("Magic Atk", effA.offense.magicAttack, effB.offense.magicAttack);
    checkDelta("HPwr", effA.offense.healingPower, effB.offense.healingPower);
    checkDelta("Atk Spd", effA.offense.attackSpeed, effB.offense.attackSpeed);
    checkDelta("Def Pen", effA.offense.defensePenetration, effB.offense.defensePenetration);
    checkDelta("MDef Pen", effA.offense.magicDefensePenetration, effB.offense.magicDefensePenetration);
    checkDelta("Shield Pen", effA.offense.shieldDefPenRatePct, effB.offense.shieldDefPenRatePct, "%");
    checkDelta("Crit Rate", effA.offense.magicCritRatePct, effB.offense.magicCritRatePct, "%");
    checkDelta("Crit Dmg", effA.offense.rangedCritBonusPct, effB.offense.rangedCritBonusPct, "%");
    checkDelta("Cast Time", effA.offense.castTimePct, effB.offense.castTimePct, "%");

    const aggLabel = escHtml(effDef.name || "Aggressor");
    previewEl.innerHTML = `
        <div class="gs-prev-row">
            ${fmtCmpChip(`Melee EHP vs ${aggLabel}`, defA.defense.ehp.melee.vsAttackerEhp, defB.defense.ehp.melee.vsAttackerEhp)}
            ${fmtCmpChip(`Ranged EHP vs ${aggLabel}`, defA.defense.ehp.ranged.vsAttackerEhp, defB.defense.ehp.ranged.vsAttackerEhp)}
            ${fmtCmpChip(`Magic EHP vs ${aggLabel}`, defA.defense.ehp.magic.vsAttackerEhp, defB.defense.ehp.magic.vsAttackerEhp)}
            ${fmtCmpChip("Eff. Heal Power (A → B)", defA.offense.healing.selfEffectiveHealingPower, defB.offense.healing.selfEffectiveHealingPower)}
        </div>
        <div class="hint-inline">
            ${keyStatDeltas.length > 0 ? `<strong>B vs A Deltas:</strong> ${escHtml(keyStatDeltas.join(" • "))}` : `EHP calculated against 3rd build (${aggLabel}) as aggressor${disableAvoidance ? " (Avoidance off)" : ""} — apply a 1-to-1 Armor, Weapon Setup, Grade, Lunagem, or Costume swap above to compare!`}
        </div>
    `;
}
