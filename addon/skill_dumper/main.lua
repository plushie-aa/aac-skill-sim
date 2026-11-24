local api = require("api")
local michaelClientLib = require("skill_dumper/lib/michael_client")

local skill_dumper_addon = {
    name = "Skill Dumper",
    author = "Plushie",
    version = "0.1.0",
    desc = "dumps skill tooltips for damage sim"
}

-- ============================================================================
-- Configuration
-- ============================================================================
local MAX_SKILL_ID = 65000
local IDS_PER_FRAME = 500
local CHUNK_SIZE = 25

local TARGET_SKILLS = {
    -- 1: Battlerage
    ["triple slash"] = "Battlerage",
    ["charge"] = "Battlerage",
    ["whirlwind slash"] = "Battlerage",
    ["soulbound blades"] = "Battlerage",
    ["sunder earth"] = "Battlerage",
    ["lasso"] = "Battlerage",
    ["terrifying roar"] = "Battlerage",
    ["rising hatred"] = "Shared",
    ["bondbreaker"] = "Battlerage",
    ["precision strike"] = "Battlerage",
    ["frenzy"] = "Battlerage",
    ["battle focus"] = "Battlerage",
    ["tiger strike"] = "Battlerage",
    ["behind enemy lines"] = "Battlerage",
    ["swordfall"] = "Battlerage",

    -- 2: Witchcraft
    ["earthen grip"] = "Witchcraft",
    ["enervate"] = "Witchcraft",
    ["bubble trap"] = "Witchcraft",
    ["devour hope"] = "Witchcraft",
    ["insidious whisper"] = "Witchcraft",
    ["purge"] = "Witchcraft",
    ["play dead"] = "Witchcraft",
    ["courageous action"] = "Witchcraft",
    ["lassitude"] = "Witchcraft",
    ["banshee wail"] = "Witchcraft",
    ["focal concussion"] = "Witchcraft",
    ["dahuta's breath"] = "Witchcraft",
    ["fiend's knell"] = "Witchcraft",
    ["stonesight"] = "Witchcraft",

    -- 3: Defense
    ["shield slam"] = "Defense",
    ["refreshment"] = "Defense",
    ["bull rush"] = "Defense",
    ["shield throw"] = "Defense",
    ["boastful roar"] = "Defense",
    ["toughen"] = "Defense",
    ["revitalizing cheer"] = "Defense",
    ["redoubt"] = "Defense",
    ["ollo's hammer"] = "Defense",
    ["mocking howl"] = "Defense",
    ["imprison"] = "Defense",
    ["invincibility"] = "Defense",
    ["fortress"] = "Defense",
    ["cruel binding"] = "Defense",

    -- 4: Auramancy
    ["thwart"] = "Auramancy",
    ["comet's boon"] = "Auramancy",
    ["spell shield"] = "Auramancy",
    ["crushing grasp"] = "Auramancy",
    ["vicious implosion"] = "Auramancy",
    ["teleportation"] = "Auramancy",
    ["health lift"] = "Auramancy",
    ["meditate"] = "Auramancy",
    ["shrug it off"] = "Auramancy",
    ["liberation"] = "Auramancy",
    ["leech"] = "Auramancy",
    ["protective wings"] = "Auramancy",
    ["mirror warp"] = "Auramancy",
    ["abyssal wave"] = "Auramancy",

    -- 5: Occultism
    ["mana stars"] = "Occultism",
    ["mana force"] = "Occultism",
    ["hell spear"] = "Occultism",
    ["cursed thorns"] = "Occultism",
    ["absorb lifeforce"] = "Occultism",
    ["summon crows"] = "Occultism",
    ["crippling mire"] = "Occultism",
    ["telekinesis"] = "Occultism",
    ["retribution"] = "Occultism",
    ["stillness"] = "Occultism",
    ["urgency"] = "Occultism",
    ["summon wraith"] = "Occultism",
    ["death's vengeance"] = "Occultism",
    ["shadow circle"] = "Occultism",

    -- 6: Archery
    ["charged bolt"] = "Archery",
    ["piercing shot"] = "Archery",
    ["endless arrows"] = "Archery",
    ["serpent's sight"] = "Archery",
    ["double recurve"] = "Archery",
    ["deadeye"] = "Archery",
    ["snare"] = "Archery",
    ["float"] = "Archery",
    ["boneyard"] = "Archery",
    ["concussive arrow"] = "Archery",
    ["missile rain"] = "Archery",
    ["intensity"] = "Archery",
    ["snipe"] = "Archery",
    ["hunting pack"] = "Archery",

    -- 7: Sorcery
    ["flamebolt"] = "Sorcery",
    ["freezing arrow"] = "Sorcery",
    ["insulating lens"] = "Sorcery",
    ["void leap"] = "Sorcery",
    ["arc lightning"] = "Sorcery",
    ["freezing earth"] = "Sorcery",
    ["searing rain"] = "Sorcery",
    ["frigid tracks"] = "Sorcery",
    ["magic circle"] = "Sorcery",
    ["chain lightning"] = "Sorcery",
    ["flame barrier"] = "Sorcery",
    ["meteor strike"] = "Sorcery",
    ["gods' whip"] = "Sorcery",
    ["serpent strike"] = "Sorcery",

    -- 8: Shadowplay
    ["rapid strike"] = "Shadowplay",
    ["overwhelm"] = "Shadowplay",
    ["drop back"] = "Shadowplay",
    ["venom blades"] = "Shadowplay",
    ["wallop"] = "Shadowplay",
    ["stalker's mark"] = "Shadowplay",
    ["stealth"] = "Shadowplay",
    ["toxic shot"] = "Shadowplay",
    ["pin down"] = "Shadowplay",
    ["shadowsmite"] = "Shadowplay",
    ["freerunner"] = "Shadowplay",
    ["shadow step"] = "Shadowplay",
    ["throw dagger"] = "Shadowplay",
    ["assassination"] = "Shadowplay",

    -- 9: Songcraft
    ["critical discord"] = "Songcraft",
    ["startling strain"] = "Songcraft",
    ["[perform] quickstep"] = "Songcraft",
    ["quickstep"] = "Songcraft",
    ["abyssal echoes"] = "Songcraft",
    ["dissonance"] = "Songcraft",
    ["healing hymn"] = "Songcraft",
    ["hummingbird ditty"] = "Songcraft",
    ["[perform] ode to recovery"] = "Songcraft",
    ["ode to recovery"] = "Songcraft",
    ["rhythmic renewal"] = "Songcraft",
    ["[perform] bulwark ballad"] = "Songcraft",
    ["bulwark ballad"] = "Songcraft",
    ["[perform] bloody chantey"] = "Songcraft",
    ["bloody chantey"] = "Songcraft",
    ["alarm call"] = "Songcraft",
    ["[perform] grief's cadence"] = "Songcraft",
    ["grief's cadence"] = "Songcraft",
    ["polymorphic resonance"] = "Songcraft",

    -- 10: Vitalism
    ["holy bolt"] = "Vitalism",
    ["mirror light"] = "Vitalism",
    ["antithesis"] = "Vitalism",
    ["abyssal petrification"] = "Vitalism",
    ["resurgence"] = "Vitalism",
    ["revive"] = "Vitalism",
    ["skewer"] = "Vitalism",
    ["mend"] = "Vitalism",
    ["aranzeb's boon"] = "Vitalism",
    ["renewal"] = "Vitalism",
    ["fervent healing"] = "Vitalism",
    ["infuse"] = "Vitalism",
    ["whirlwind's blessing"] = "Vitalism",
    ["defy death"] = "Vitalism",

    -- Basic attacks
    ["basic arrow"] = "Basic",
    ["basic bow"] = "Basic",
    ["melee attack"] = "Basic",
}

local PASSIVE_BUFF_IDS = {
    479, 480, 481, 482, 483, 486, 488, 490, 494, 498,
    533, 536, 539, 558, 560, 621, 753, 781, 783, 793,
    805, 806, 811, 812, 830, 831, 863, 888, 889, 927,
    962, 963, 964, 971, 1124, 1156, 1173, 1548, 2610, 2621,
    2753, 2784, 2910, 2926, 2927, 2970, 3172, 3779, 3840, 7542,
    7544, 7545, 7546, 7549, 7550, 7551, 7553, 7554, 7561, 7563,
    7564, 7565, 7566, 7567, 7570, 7572, 7574, 7577, 7585, 7586,
    18372, 18373, 18406, 18411, 18412, 18413, 18414, 18415, 18416, 18417
}

-- Ode to Recovery (Ranks 1-5), Life Ode (Ranks 1-5), Abyssal Ode, and Songcraft aura buffs
local ODE_BUFF_IDS = {
    833, 834, 835, 13783, 13784,
    21452, 21453, 21445, 21454, 21455,
    18503, 20323,
    662, 664, 663, 13786, 13785,
    2190, 2191, 2192, 13787, 13788,
    4541, 9001309
}

-- ============================================================================
-- Logging & Safe Execution Helpers
-- ============================================================================
local statusLabel = nil
local statusPreviewLabel = nil

local function logInfo(msg)
    pcall(function()
        if api and api.Log and api.Log.Info then
            api.Log:Info("[Skill Dumper] " .. tostring(msg))
        end
    end)
end

local function logErr(msg)
    pcall(function()
        if api and api.Log and api.Log.Err then
            api.Log:Err("[Skill Dumper] " .. tostring(msg))
        end
    end)
end

local function setStatus(msg, preview)
    pcall(function()
        if statusLabel and statusLabel.SetText then
            statusLabel:SetText(tostring(msg or ""))
        end
        if statusPreviewLabel and statusPreviewLabel.SetText then
            statusPreviewLabel:SetText(tostring(preview or ""))
        end
    end)
end

local function safeCall(tag, fn)
    local ok, err = pcall(fn)
    if not ok then
        local msg = "ERR(" .. tostring(tag) .. "): " .. tostring(err)
        logErr(msg)
        setStatus(msg)
    end
    return ok, err
end

-- ============================================================================
-- Minimal Self-Contained JSON Encoder (Lua 5.1 safe, cycle & userdata safe)
-- ============================================================================
local escapeMap = {
    ["\\"] = "\\\\",
    ["\""] = "\\\"",
    ["\b"] = "\\b",
    ["\f"] = "\\f",
    ["\n"] = "\\n",
    ["\r"] = "\\r",
    ["\t"] = "\\t",
}

local function escapeStr(s)
    return s:gsub("[%z\1-\31\\\"]", function(c)
        return escapeMap[c] or string.format("\\u%04x", string.byte(c))
    end)
end

local function isArray(tbl)
    local count = 0
    local maxIdx = 0
    for k, _ in pairs(tbl) do
        if type(k) ~= "number" or k < 1 or math.floor(k) ~= k then
            return false
        end
        count = count + 1
        if k > maxIdx then maxIdx = k end
    end
    return count > 0 and maxIdx == count
end

local function jsonEncode(val, depth, seen)
    depth = depth or 0
    if depth > 8 then return "null" end

    local t = type(val)
    if t == "nil" then
        return "null"
    elseif t == "boolean" then
        return val and "true" or "false"
    elseif t == "number" then
        if val ~= val or val == math.huge or val == -math.huge then
            return "null"
        end
        if math.floor(val) == val and math.abs(val) < 1e15 then
            return string.format("%.0f", val)
        end
        return tostring(val)
    elseif t == "string" then
        return "\"" .. escapeStr(val) .. "\""
    elseif t == "table" then
        seen = seen or {}
        if seen[val] then return "null" end
        seen[val] = true

        local parts = {}
        if isArray(val) then
            for i = 1, #val do
                parts[#parts + 1] = jsonEncode(val[i], depth + 1, seen)
            end
            seen[val] = nil
            return "[" .. table.concat(parts, ",") .. "]"
        else
            for k, v in pairs(val) do
                local vt = type(v)
                if vt ~= "function" and vt ~= "userdata" and vt ~= "thread" then
                    local keyStr = "\"" .. escapeStr(tostring(k)) .. "\""
                    parts[#parts + 1] = keyStr .. ":" .. jsonEncode(v, depth + 1, seen)
                end
            end
            seen[val] = nil
            return "{" .. table.concat(parts, ",") .. "}"
        end
    else
        return "null"
    end
end

-- ============================================================================
-- Introspection & Multi-Signature Skill Probing
-- ============================================================================
local activeSkillFetcher = nil
local activeSkillCallMode = "unknown"
local lastProbeResults = {}

local function inspectObject(obj)
    local info = { objType = type(obj), keys = {}, metaKeys = {}, keyCount = 0, metaKeyCount = 0 }
    pcall(function()
        if type(obj) == "table" then
            for k, v in pairs(obj) do
                info.keys[tostring(k)] = type(v)
                info.keyCount = info.keyCount + 1
            end
        end
    end)
    pcall(function()
        if getmetatable then
            local mt = getmetatable(obj)
            info.mtType = type(mt)
            if type(mt) == "table" then
                info.metaIndexType = type(mt.__index)
                if type(mt.__index) == "table" then
                    for k, v in pairs(mt.__index) do
                        info.metaKeys[tostring(k)] = type(v)
                        info.metaKeyCount = info.metaKeyCount + 1
                    end
                end
            end
        else
            info.mtType = "no_getmetatable"
        end
    end)
    return info
end

local function joinKeyNames(map, maxCount)
    local arr = {}
    if type(map) == "table" then
        for k, _ in pairs(map) do
            arr[#arr + 1] = tostring(k)
        end
    end
    table.sort(arr)
    if maxCount and #arr > maxCount then
        local sliced = {}
        for i = 1, maxCount do sliced[i] = arr[i] end
        sliced[#sliced + 1] = "...(" .. tostring(#arr) .. " total)"
        return table.concat(sliced, ", ")
    end
    return table.concat(arr, ", ")
end

local function collectGlobalsDiag()
    local res = { sik = {}, x2 = {}, skillRelated = {} }
    pcall(function()
        if type(_G) ~= "table" then
            res.noGlobalTable = true
            return
        end
        for k, v in pairs(_G) do
            if type(k) == "string" then
                local up = string.upper(k)
                local valRepr = (type(v) == "number" or type(v) == "string" or type(v) == "boolean") and v or type(v)
                if k:sub(1, 4) == "SIK_" then
                    res.sik[k] = valRepr
                elseif k:sub(1, 2) == "X2" then
                    res.x2[k] = valRepr
                elseif up:find("SKILL", 1, true) or up:find("ABILITY", 1, true) then
                    res.skillRelated[k] = valRepr
                end
            end
        end
    end)
    return res
end

local function isValidSkillResult(res)
    if type(res) == "table" then
        for _ in pairs(res) do return true end
        return false
    elseif type(res) == "string" and res ~= "" then
        return true
    end
    return false
end

local function buildCandidateFetchers()
    local candidates = {}
    local function add(name, fn)
        candidates[#candidates + 1] = { name = name, fn = fn }
    end

    if api and api.Skill then
        local masks = { 2147483647, 1048575, 65535, 4095, 1023, 255, 127, 63, 31, 15, 7, 3, 2, 1, -1, 0 }
        -- Try 3-arg (id, itemLevel=0, sikMask) first
        for _, m in ipairs(masks) do
            local maskVal = m
            add("api.Skill:GetSkillTooltip(id, 0, " .. tostring(maskVal) .. ")", function(id)
                return api.Skill:GetSkillTooltip(id, 0, maskVal)
            end)
        end
        -- Try 2-arg (id, sikMask) next
        for _, m in ipairs(masks) do
            local maskVal = m
            add("api.Skill:GetSkillTooltip(id, " .. tostring(maskVal) .. ")", function(id)
                return api.Skill:GetSkillTooltip(id, maskVal)
            end)
        end
        -- Try boolean / 1-arg / 3-arg with itemLevel=1
        add("api.Skill:GetSkillTooltip(id, true)", function(id) return api.Skill:GetSkillTooltip(id, true) end)
        add("api.Skill:GetSkillTooltip(id, 0, true)", function(id) return api.Skill:GetSkillTooltip(id, 0, true) end)
        add("api.Skill:GetSkillTooltip(id, 1, 65535)", function(id) return api.Skill:GetSkillTooltip(id, 1, 65535) end)
        add("api.Skill:GetSkillTooltip(id)", function(id) return api.Skill:GetSkillTooltip(id) end)
    end
    return candidates
end

local function probeSkillApi()
    activeSkillFetcher = nil
    activeSkillCallMode = "unknown"
    lastProbeResults = {}

    local directCheck = {}
    local probeNames = { "GetSkillTooltip", "GetSkillInfo", "GetSkillName", "GetSkillDesc" }
    for _, fname in ipairs(probeNames) do
        local okF, fval = pcall(function() return api and api.Skill and api.Skill[fname] end)
        directCheck[fname] = okF and type(fval) or ("ERR:" .. tostring(fval))
    end

    -- Test across known player skill IDs (10752 Flamebolt, 10534 Antithesis, 18132 Triple Slash, 12823 Flute)
    local probeIds = { 10752, 10534, 18132, 11918, 12823 }
    local candidates = buildCandidateFetchers()

    local bestScore = -1
    local bestCand = nil
    local bestEntry = nil

    for _, cand in ipairs(candidates) do
        local entry = { mode = cand.name, ok = false, resType = "nil", err = nil, hitId = nil, keyCount = 0 }
        for _, pid in ipairs(probeIds) do
            local ok, res = pcall(function() return cand.fn(pid) end)
            entry.ok = ok
            if not ok then
                entry.err = tostring(res)
                break
            end
            entry.resType = type(res)
            if type(res) == "table" then
                local objInfo = inspectObject(res)
                if objInfo.keyCount > 0 then
                    entry.hitId = pid
                    entry.keyCount = objInfo.keyCount
                    entry.sampleKeys = objInfo.keys
                    entry.sampleName = res.name
                    entry.sampleDesc = type(res.description) == "string" and res.description:sub(1, 140) or nil

                    local score = objInfo.keyCount
                    if type(res.name) == "string" and res.name ~= "" then
                        score = score + 100
                    end
                    if score > bestScore then
                        bestScore = score
                        bestCand = cand
                        bestEntry = entry
                    end
                    break
                end
            end
        end
        lastProbeResults[#lastProbeResults + 1] = entry
    end

    if bestCand and bestEntry then
        activeSkillFetcher = bestCand.fn
        activeSkillCallMode = bestCand.name
        logInfo("BEST MODE: " .. bestCand.name
            .. " | hitId=" .. tostring(bestEntry.hitId)
            .. " | keys(" .. tostring(bestEntry.keyCount) .. ")=[" .. joinKeyNames(bestEntry.sampleKeys, 30) .. "]"
            .. " | name=" .. tostring(bestEntry.sampleName))
        if bestEntry.sampleDesc then
            logInfo("SAMPLE DESC: " .. tostring(bestEntry.sampleDesc))
        end
    else
        logErr("No working skill API mode found during probe!")
    end

    return directCheck
end

local function safeGetSkillTooltip(skillId)
    if not activeSkillFetcher then
        return nil
    end
    local ok, res = pcall(function() return activeSkillFetcher(skillId) end)
    if ok and isValidSkillResult(res) then
        return res
    end
    return nil
end

local function safeGetBuffTooltip(buffId)
    if not (api and api.Ability and api.Ability.GetBuffTooltip) then
        return nil
    end
    local ok, res = pcall(function() return api.Ability:GetBuffTooltip(buffId, 0) end)
    if ok and type(res) == "table" and res.name and res.name ~= "" then
        return res
    end
    local ok2, res2 = pcall(function() return api.Ability.GetBuffTooltip(buffId) end)
    if ok2 and type(res2) == "table" and res2.name and res2.name ~= "" then
        return res2
    end
    return nil
end

local function collectPlayerSnapshot()
    local snap = {}
    pcall(function()
        if api.Unit then
            if api.Unit.UnitInfo then
                local ok, v = pcall(function() return api.Unit:UnitInfo("player") end)
                if ok then snap.unitInfo = v end
            end
            if api.Unit.UnitModifierInfo then
                local ok, v = pcall(function() return api.Unit:UnitModifierInfo("player") end)
                if ok then snap.modifierInfo = v end
            end
            if api.Unit.UnitClass then
                local ok, v = pcall(function() return api.Unit:UnitClass("player") end)
                if ok then snap.unitClass = v end
            end
            if api.Unit.UnitMaxHealth then
                local ok, v = pcall(function() return api.Unit:UnitMaxHealth("player") end)
                if ok then snap.maxHealth = v end
            end
            if api.Unit.UnitMaxMana then
                local ok, v = pcall(function() return api.Unit:UnitMaxMana("player") end)
                if ok then snap.maxMana = v end
            end
            if api.Unit.UnitGearScore then
                local ok, v = pcall(function() return api.Unit:UnitGearScore("player") end)
                if ok then snap.gearScore = v end
            end
            if api.Unit.GetUnitId and api.Unit.GetUnitInfoById then
                local okId, uid = pcall(function() return api.Unit:GetUnitId("player") end)
                if okId and uid then
                    local okInfo, uby = pcall(function() return api.Unit:GetUnitInfoById(uid) end)
                    if okInfo and uby then snap.unitInfoById = uby end
                end
            end
        end

        local activeBuffs = {}
        if api.Unit and api.Unit.UnitBuffCount and api.Unit.UnitBuff then
            local okC, count = pcall(function() return api.Unit:UnitBuffCount("player") end)
            if okC and type(count) == "number" then
                for i = 1, count do
                    local okB, b = pcall(function() return api.Unit:UnitBuff("player", i) end)
                    if okB and b then
                        activeBuffs[#activeBuffs + 1] = b
                    end
                end
            end
        end
        snap.activeBuffs = activeBuffs

        local weapons = {}
        local apparel = {}
        if api.Equipment and api.Equipment.GetEquippedItemTooltipInfo and EQUIP_SLOT then
            local slots = {
                mainhand = EQUIP_SLOT.MAINHAND,
                offhand = EQUIP_SLOT.OFFHAND,
                ranged = EQUIP_SLOT.RANGED,
                musical = EQUIP_SLOT.MUSICAL,
            }
            for label, slotId in pairs(slots) do
                if slotId then
                    local okI, info = pcall(function() return api.Equipment:GetEquippedItemTooltipInfo(slotId) end)
                    if okI and info then
                        weapons[label] = info
                    end
                end
            end

            local extraSlots = {
                costume = EQUIP_SLOT.COSPLAY,
                undergarment = EQUIP_SLOT.UNDERPANTS,
            }
            for label, slotId in pairs(extraSlots) do
                if slotId then
                    local okI, info = pcall(function() return api.Equipment:GetEquippedItemTooltipInfo(slotId) end)
                    if okI and info then
                        apparel[label] = info
                    end
                end
            end
        end
        snap.weapons = weapons
        snap.apparel = apparel
    end)
    return snap
end

-- ============================================================================
-- Skill Matching Logic
-- ============================================================================
local function normalizeName(rawName)
    if type(rawName) ~= "string" then return "" end
    local s = rawName:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
    s = s:gsub("^%s*(.-)%s*$", "%1")
    return string.lower(s)
end

local function matchTargetSkill(tooltip)
    if type(tooltip) ~= "table" then
        return nil
    end

    local rawName = tooltip.name or tooltip.skillName or tooltip.title
    if type(rawName) == "string" and rawName ~= "" then
        local norm = normalizeName(rawName)
        if TARGET_SKILLS[norm] then
            return TARGET_SKILLS[norm]
        end
        local noPerform = norm:gsub("^%[perform%]%s*", "")
        if TARGET_SKILLS[noPerform] then
            return TARGET_SKILLS[noPerform]
        end
        local beforeColon = norm:match("^([^:]+):")
        if beforeColon and TARGET_SKILLS[beforeColon] then
            return TARGET_SKILLS[beforeColon]
        end
        return nil
    end

    -- Fallback when tooltip has no .name field (e.g. description-only mode):
    -- capture player learnable skills (skillPoints > 0) and Abyssal/combat skills
    local sp = tooltip.skillPoints
    local desc = type(tooltip.description) == "string" and tooltip.description or ""
    if type(sp) == "number" and sp > 0 then
        return "PlayerSkill"
    end
    if desc ~= "" and (desc:find("Abyssal Charge", 1, true) or desc:find("Abyssal Charges", 1, true)) then
        return "Abyssal"
    end
    return nil
end

-- ============================================================================
-- Chunked Non-Blocking Scanner
-- ============================================================================
local mainWindow = nil
local MICHAEL_CLIENT_TITLE = "Skill Dumper"
local dumpBtn1 = nil
local dumpBtn2 = nil
local buffBtn = nil
local debugBtn = nil
local rankBtn = nil
local cleanCheckLabel = nil
local cleanCheckDetailLabel = nil
local guideLabel = nil
local underMaxLabel = nil
local modeToggleBtn = nil
local checkGearBtn = nil
local levelLabel = nil
local levelMinus5Btn = nil
local levelMinus1Btn = nil
local levelPlus1Btn = nil
local levelMaxBtn = nil
local treeButtons = {}
local treeDumpStatus = {}       -- [treeKey] = "ok" | "warn" | nil (naked mode)
local treeDumpLevel = {}        -- [treeKey] = number (1..55) | nil
local treeGearedStatus = {}     -- [treeKey] = true | nil (geared 2-pt mode)
local dumpMode = "naked"        -- "naked" | "geared"
local selectedSkillsetLevel = 55

-- Per-skillset canonical skill IDs (exact match to tools/skill_catalog.json — 116 IDs across all 10 trees)
local SKILLSET_ORDER = {
    "battlerage", "witchcraft",
    "defense", "auramancy",
    "occultism", "archery",
    "sorcery", "shadowplay",
    "songcraft", "vitalism",
}

local SKILLSET_CONFIG = {
    battlerage = {
        label = "Battlerage",
        sampleId = 12026,
        sampleName = "Precision Strike",
        ids = { 10644, 11918, 12026, 13282, 13315, 18131, 18132, 23587, 32040, 32049, 34120, 36401, 36402, 36403, 36404, 36405, 36406, 36446, 36447, 36448, 36449 },
    },
    witchcraft = {
        label = "Witchcraft",
        sampleId = 14376,
        sampleName = "Earthen Grip",
        ids = { 10159, 11353, 11443, 14376, 36450 },
    },
    defense = {
        label = "Defense",
        sampleId = 10399,
        sampleName = "Shield Slam",
        needsTwoPoint = true,
        ids = { 10399, 10501, 12046, 18757, 36456, 36457 },
    },
    auramancy = {
        label = "Auramancy",
        sampleId = 18222,
        sampleName = "Vicious Implosion",
        ids = { 10710, 18222, 34090 },
    },
    occultism = {
        label = "Occultism",
        sampleId = 14810,
        sampleName = "Mana Stars",
        ids = { 10135, 10201, 10434, 11395, 11441, 12759, 14810, 23591, 36586, 36587, 36620, 36623, 36627 },
    },
    archery = {
        label = "Archery",
        sampleId = 16210,
        sampleName = "Endless Arrows",
        ids = { 11933, 13281, 13564, 14760, 14835, 16210, 23592, 34288, 36468, 36469, 36470, 36471, 36472, 36473, 39663 },
    },
    sorcery = {
        label = "Sorcery",
        sampleId = 10670,
        sampleName = "Arc Lightning",
        ids = { 10151, 10664, 10667, 10670, 10752, 11939, 11967, 14774, 23593, 23646, 23647, 23648, 23649, 24894, 24895, 34291, 36474, 36475, 36476, 36477, 36478, 36479 },
    },
    shadowplay = {
        label = "Shadowplay",
        sampleId = 10648,
        sampleName = "Stalker's Mark",
        ids = { 10481, 10496, 10648, 12029, 12139, 13344, 18125, 23594, 36588 },
    },
    songcraft = {
        label = "Songcraft",
        sampleId = 11973,
        sampleName = "Critical Discord",
        needsTwoPoint = true,
        ids = { 10724, 11943, 11948, 11973, 17413 },
    },
    vitalism = {
        label = "Vitalism",
        sampleId = 10534,
        sampleName = "Antithesis",
        needsTwoPoint = true,
        ids = { 10534, 10547, 10720, 13286, 14929, 14930, 14931, 14932, 14933, 33345, 36630, 36631, 36632, 36635, 36637, 36638, 36639 },
    },
}

-- Canonical combat & healing skill IDs across all 10 skillsets (base, multi-hit, abyssal, ancestral)
local CANONICAL_SKILL_IDS = {}
for _, tk in ipairs(SKILLSET_ORDER) do
    for _, sid in ipairs(SKILLSET_CONFIG[tk].ids) do
        CANONICAL_SKILL_IDS[#CANONICAL_SKILL_IDS + 1] = sid
    end
end

local scanState = {
    active = false,
    outputFile = "skill_dump_1.txt",
    label = "geared",
    currentId = 1,
    totalValidTooltips = 0,
    matchedSkills = {},
    sampleTooltipKeys = nil,
    directSkillFields = nil,
}

local function setButtonsEnabled(enabled)
    local btns = {
        dumpBtn1, dumpBtn2, buffBtn, debugBtn, rankBtn,
        modeToggleBtn, checkGearBtn,
        levelMinus5Btn, levelMinus1Btn, levelPlus1Btn, levelMaxBtn,
    }
    for _, tk in ipairs(SKILLSET_ORDER) do
        btns[#btns + 1] = treeButtons[tk]
    end
    for _, b in ipairs(btns) do
        if b and b.Enable then
            pcall(function() b:Enable(enabled) end)
        end
    end
end

local function finishSkillScan()
    safeCall("finishSkillScan", function()
        scanState.active = false

        local meta = {
            schemaVersion = 3,
            dumpLabel = scanState.label,
            maxSkillIdScanned = MAX_SKILL_ID,
            skillCallMode = activeSkillCallMode,
            directSkillFields = scanState.directSkillFields,
            probeResults = lastProbeResults,
            totalValidTooltipsSeen = scanState.totalValidTooltips,
            matchedCount = #scanState.matchedSkills,
            sampleTooltipKeys = scanState.sampleTooltipKeys,
            apiTopKeys = inspectObject(api),
            apiSkillInfo = inspectObject(api and api.Skill or nil),
            apiAbilityInfo = inspectObject(api and api.Ability or nil),
            globalsDiag = collectGlobalsDiag(),
            player = collectPlayerSnapshot(),
        }

        local chunks = {}
        local buf = {}
        for i = 1, #scanState.matchedSkills do
            buf[#buf + 1] = scanState.matchedSkills[i]
            if #buf >= CHUNK_SIZE or i == #scanState.matchedSkills then
                chunks[#chunks + 1] = jsonEncode(buf)
                buf = {}
            end
        end

        local filePayload = {
            metaJson = jsonEncode(meta),
            chunkCount = #chunks,
            skillChunks = chunks,
        }

        local ok, err = pcall(function()
            api.File:Write(scanState.outputFile, filePayload)
        end)

        setButtonsEnabled(true)

        if ok then
            local msg = string.format(
                "Saved %d skills (%d valid) to %s [%s]",
                #scanState.matchedSkills,
                scanState.totalValidTooltips,
                scanState.outputFile,
                activeSkillCallMode
            )
            setStatus(msg)
            logInfo(msg)
            logInfo("Path: Documents/AAClassic/Addon/" .. scanState.outputFile)
        else
            setStatus("Write error: " .. tostring(err))
            logErr("Failed writing file: " .. tostring(err))
        end
    end)
end

local function onUpdate(dt)
    if not scanState.active then
        return
    end

    safeCall("onUpdate", function()
        local startId = scanState.currentId
        local endId = math.min(startId + IDS_PER_FRAME - 1, MAX_SKILL_ID)

        for id = startId, endId do
            local tooltip = safeGetSkillTooltip(id)
            if tooltip ~= nil then
                scanState.totalValidTooltips = scanState.totalValidTooltips + 1
                if not scanState.sampleTooltipKeys then
                    scanState.sampleTooltipKeys = (type(tooltip) == "table") and inspectObject(tooltip).keys or type(tooltip)
                end
                local tree = matchTargetSkill(tooltip)
                if tree then
                    scanState.matchedSkills[#scanState.matchedSkills + 1] = {
                        skillId = id,
                        skillset = tree,
                        tooltip = tooltip,
                    }
                end
            end
        end

        scanState.currentId = endId + 1

        if scanState.currentId > MAX_SKILL_ID then
            finishSkillScan()
        elseif (endId % 5000) == 0 or endId == MAX_SKILL_ID then
            local pct = math.floor((endId / MAX_SKILL_ID) * 100)
            local msg = string.format(
                "Scanning %d%% (%d/%d) | valid=%d matched=%d",
                pct, endId, MAX_SKILL_ID, scanState.totalValidTooltips, #scanState.matchedSkills
            )
            setStatus(msg)
            logInfo(msg)
        end
    end)
end

local function startSkillScan(outputFile, label)
    safeCall("startSkillScan", function()
        if scanState.active then
            logInfo("Scan already in progress...")
            return
        end

        scanState.outputFile = outputFile
        scanState.label = label
        scanState.currentId = 1
        scanState.totalValidTooltips = 0
        scanState.matchedSkills = {}
        scanState.sampleTooltipKeys = nil

        setButtonsEnabled(false)
        setStatus("Probing skill API...")
        logInfo("Button clicked: " .. label .. " -> " .. outputFile)

        scanState.directSkillFields = probeSkillApi()

        if not activeSkillFetcher then
            logErr("No working skill API detected. Writing diagnostics to " .. outputFile)
            finishSkillScan()
            return
        end

        scanState.active = true
        setStatus("Scanning 1.." .. tostring(MAX_SKILL_ID) .. " via " .. activeSkillCallMode)
        logInfo("Starting scan 1.." .. tostring(MAX_SKILL_ID) .. " via " .. activeSkillCallMode)
    end)
end

local function dumpOdeBuffs(outFile, label)
    safeCall("dumpOdeBuffs", function()
        if scanState.active then return end
        setButtonsEnabled(false)
        setStatus("Dumping Ode to Recovery buffs (" .. label .. ")...")
        logInfo("Dumping Ode to Recovery buffs (" .. label .. ") -> " .. outFile)

        local playerSnap = collectPlayerSnapshot()
        local odeBuffs = {}
        for _, buffId in ipairs(ODE_BUFF_IDS) do
            local tip = safeGetBuffTooltip(buffId)
            if tip then
                odeBuffs[#odeBuffs + 1] = {
                    buffId = buffId,
                    tooltip = tip,
                }
            end
        end

        -- Also resolve tooltips for all currently active buffs on the player
        -- (play Ode to Recovery right before clicking to capture live active buff values!)
        local activeBuffTooltips = {}
        if playerSnap.activeBuffs then
            for i, b in ipairs(playerSnap.activeBuffs) do
                local bid = type(b) == "table" and b.buff_id or nil
                local tip = bid and safeGetBuffTooltip(bid) or nil
                local unitTip = nil
                pcall(function()
                    if api.Unit and api.Unit.UnitBuffTooltip then
                        unitTip = api.Unit:UnitBuffTooltip("player", i)
                    end
                end)
                activeBuffTooltips[#activeBuffTooltips + 1] = {
                    index = i,
                    buff = b,
                    abilityTooltip = tip,
                    unitBuffTooltip = unitTip,
                }
            end
        end

        local odeSkillTip = nil
        pcall(function()
            odeSkillTip = api.Skill:GetSkillTooltip(10724, 0)
        end)

        local payload = {
            metaJson = jsonEncode({
                schemaVersion = 1,
                label = label,
                odeBuffCount = #odeBuffs,
                activeBuffCount = #activeBuffTooltips,
                odeSkillTooltip = odeSkillTip,
                player = playerSnap,
            }),
            odeBuffsJson = jsonEncode(odeBuffs),
            activeBuffsJson = jsonEncode(activeBuffTooltips),
        }

        local ok, err = pcall(function()
            api.File:Write(outFile, payload)
        end)

        setButtonsEnabled(true)

        if ok then
            local msg = string.format(
                "Saved %d Ode buffs + %d active buffs to %s",
                #odeBuffs, #activeBuffTooltips, outFile
            )
            setStatus(msg)
            logInfo(msg)
            logInfo("Path: Documents/AAClassic/Addon/" .. outFile)
        else
            setStatus("Ode dump write error: " .. tostring(err))
            logErr("Ode dump write error: " .. tostring(err))
        end
    end)
end

local function dumpPassiveBuffs()
    safeCall("dumpPassiveBuffs", function()
        if scanState.active then return end
        setButtonsEnabled(false)
        setStatus("Dumping passive buffs...")
        logInfo("Dumping passive buffs...")

        local buffs = {}
        for _, buffId in ipairs(PASSIVE_BUFF_IDS) do
            local tip = safeGetBuffTooltip(buffId)
            if tip then
                buffs[#buffs + 1] = {
                    buffId = buffId,
                    tooltip = tip,
                }
            end
        end

        local outFile = "buff_dump.txt"
        local payload = {
            metaJson = jsonEncode({
                schemaVersion = 3,
                count = #buffs,
                apiAbilityInfo = inspectObject(api and api.Ability or nil),
            }),
            buffsJson = jsonEncode(buffs),
        }

        local ok, err = pcall(function()
            api.File:Write(outFile, payload)
        end)

        setButtonsEnabled(true)

        if ok then
            local msg = string.format("Saved %d passive buffs to %s", #buffs, outFile)
            setStatus(msg)
            logInfo(msg)
        else
            setStatus("Buff write error: " .. tostring(err))
            logErr("Buff write error: " .. tostring(err))
        end
    end)
end

local function probeNamedMethods(obj, names)
    local found = {}
    if not obj then return found end
    for _, name in ipairs(names) do
        local ok, v = pcall(function() return obj[name] end)
        if ok and v ~= nil then
            found[name] = type(v)
        end
    end
    return found
end

local function probeRankApis()
    local res = {}

    local skillMethods = {
        "GetSkillTooltip", "GetSkillInfo", "GetSkillName", "GetSkillDesc", "GetSkillLevel",
        "GetSkillMaxLevel", "GetSkillRank", "GetSkillByLevel", "GetSkillTooltipByLevel",
        "GetSkillIcon", "GetSkillCooldown", "GetSkillCost", "GetLearnSkillInfo",
        "GetActiveSkillInfo", "GetSkillData", "GetSkillList", "GetSkillSet",
        "GetCombatSkillTooltip", "GetSkillGrade", "GetSkillReqLevel", "GetSkillId",
        "GetBuffTooltip", "GetSkillDetail", "GetSkillEffect", "GetSkillDamage",
    }
    local abilityMethods = {
        "GetBuffTooltip", "GetSkillTooltip", "GetSkillInfo", "GetAbilitySkillInfo",
        "GetActiveSkillList", "GetSkillList", "GetAbilitySkills", "GetLearnSkillInfo",
        "GetSkillLevel", "GetSkillMaxLevel", "GetAbilityLevel", "GetAbilityInfo",
        "GetAbilityName", "GetAbilityIndex", "GetActiveAbility", "GetMyAbility",
        "GetAllSkillList", "GetSkillPoints", "GetSkillRank", "GetNextSkillInfo",
        "GetPassiveSkillList", "GetComboSkillList", "GetSuccessorSkillList",
        "GetAncestralSkillList", "GetAbyssalSkillList", "GetSkillByAbility",
        "GetSkillTooltipByLevel", "GetSkillTooltipInfo", "GetSkillData",
        "IsSkillLearned", "GetSkillIdByLevel", "GetSkillLevelList",
    }
    local unitMethods = {
        "UnitInfo", "UnitModifierInfo", "UnitClass", "UnitLevel", "UnitAbilityLevel",
        "UnitSkillLevel", "UnitAbilities", "GetUnitAbility", "GetAbilityLevel",
    }

    res.apiSkillMethods = probeNamedMethods(api and api.Skill or nil, skillMethods)
    res.apiAbilityMethods = probeNamedMethods(api and api.Ability or nil, abilityMethods)
    res.apiUnitMethods = probeNamedMethods(api and api.Unit or nil, unitMethods)
    res.apiPlayerMethods = probeNamedMethods(api and api.Player or nil, abilityMethods)

    -- Check global X2 namespaces directly (even when _G isn't iterable)
    local x2Names = { "X2Skill", "X2Ability", "X2Unit", "X2Player", "X2Buff", "X2Item" }
    res.x2Globals = {}
    for _, gname in ipairs(x2Names) do
        local ok, gval = pcall(function()
            if gname == "X2Skill" then return X2Skill
            elseif gname == "X2Ability" then return X2Ability
            elseif gname == "X2Unit" then return X2Unit
            elseif gname == "X2Player" then return X2Player
            elseif gname == "X2Buff" then return X2Buff
            elseif gname == "X2Item" then return X2Item
            end
        end)
        if ok and gval ~= nil then
            res.x2Globals[gname] = {
                objType = type(gval),
                skillMethods = probeNamedMethods(gval, skillMethods),
                abilityMethods = probeNamedMethods(gval, abilityMethods),
            }
        else
            res.x2Globals[gname] = "nil"
        end
    end

    -- Try invoking any discovered non-GetSkillTooltip methods on sample skill IDs (10670 Arc Lightning, 10534 Antithesis, 12026 Precision Strike)
    res.methodTests = {}
    local function tryCall(label, fn)
        local ok, out = pcall(fn)
        if not ok then
            res.methodTests[label] = { ok = false, err = tostring(out) }
        elseif type(out) == "table" then
            res.methodTests[label] = { ok = true, type = "table", sample = out }
        else
            res.methodTests[label] = { ok = true, type = type(out), val = out }
        end
    end

    for mname, mtype in pairs(res.apiSkillMethods) do
        if mtype == "function" and mname ~= "GetSkillTooltip" then
            tryCall("api.Skill:" .. mname .. "(10670)", function() return api.Skill[mname](api.Skill, 10670) end)
            tryCall("api.Skill:" .. mname .. "(10670, 5)", function() return api.Skill[mname](api.Skill, 10670, 5) end)
        end
    end
    for mname, mtype in pairs(res.apiAbilityMethods) do
        if mtype == "function" and mname ~= "GetBuffTooltip" then
            tryCall("api.Ability:" .. mname .. "(1)", function() return api.Ability[mname](api.Ability, 1) end)
            tryCall("api.Ability:" .. mname .. "(10670)", function() return api.Ability[mname](api.Ability, 10670) end)
            tryCall("api.Ability:" .. mname .. "(10670, 5)", function() return api.Ability[mname](api.Ability, 10670, 5) end)
        end
    end

    -- Also test 3-arg and 4-arg GetSkillTooltip combinations on 10670 (Arc Lightning) & 10534 (Antithesis)
    res.tooltipArgProbes = {}
    local argPatterns = {
        { "id, 0, 1", function(id) return api.Skill:GetSkillTooltip(id, 0, 1) end },
        { "id, 0, 5", function(id) return api.Skill:GetSkillTooltip(id, 0, 5) end },
        { "id, 0, 9", function(id) return api.Skill:GetSkillTooltip(id, 0, 9) end },
        { "id, 0, 55", function(id) return api.Skill:GetSkillTooltip(id, 0, 55) end },
        { "id, 1, 1", function(id) return api.Skill:GetSkillTooltip(id, 1, 1) end },
        { "id, 1, 9", function(id) return api.Skill:GetSkillTooltip(id, 1, 9) end },
        { "id, 5, 0", function(id) return api.Skill:GetSkillTooltip(id, 5, 0) end },
        { "id, 9, 0", function(id) return api.Skill:GetSkillTooltip(id, 9, 0) end },
        { "id, 0, 0, 1", function(id) return api.Skill:GetSkillTooltip(id, 0, 0, 1) end },
        { "id, 0, 0, 9", function(id) return api.Skill:GetSkillTooltip(id, 0, 0, 9) end },
        { "id, 0, 0, 55", function(id) return api.Skill:GetSkillTooltip(id, 0, 0, 55) end },
    }
    for _, pat in ipairs(argPatterns) do
        local ok, tip = pcall(function() return pat[2](10670) end)
        res.tooltipArgProbes[pat[1]] = ok and type(tip) == "table" and (tip.description or "no_desc") or ("ERR:" .. tostring(tip))
    end

    return res
end

local function runDebugDiagnostics()
    safeCall("runDebugDiagnostics", function()
        if scanState.active then return end
        setButtonsEnabled(false)
        setStatus("Running v0.6 API & Rank probes...")
        logInfo("=== Running Skill Dumper v0.6 API & Rank Probes ===")

        local directFields = probeSkillApi()
        local rankProbes = probeRankApis()

        local diag = {
            schemaVersion = 4,
            directSkillFields = directFields,
            rankProbes = rankProbes,
            probeResults = lastProbeResults,
            apiTop = inspectObject(api),
            apiSkill = inspectObject(api and api.Skill or nil),
            apiAbility = inspectObject(api and api.Ability or nil),
            apiUnit = inspectObject(api and api.Unit or nil),
            apiPlayer = inspectObject(api and api.Player or nil),
            globalsDiag = collectGlobalsDiag(),
        }

        local outFile = "skill_debug.txt"
        local ok, err = pcall(function()
            api.File:Write(outFile, { debugJson = jsonEncode(diag) })
        end)

        setButtonsEnabled(true)

        if ok then
            local msg = "v0.6 diagnostics written to " .. outFile
            setStatus(msg)
            logInfo(msg)
            logInfo("api.Skill methods: " .. joinKeyNames(rankProbes.apiSkillMethods, 30))
            logInfo("api.Ability methods: " .. joinKeyNames(rankProbes.apiAbilityMethods, 30))
        else
            setStatus("Debug write error: " .. tostring(err))
            logErr("Debug write error: " .. tostring(err))
        end
    end)
end

local function dumpSkillRanks()
    safeCall("dumpSkillRanks", function()
        if scanState.active then return end
        setButtonsEnabled(false)
        setStatus("Dumping skill ranks (lvl 0..55)...")
        logInfo("Probing skill ranks across " .. tostring(#CANONICAL_SKILL_IDS) .. " canonical skill IDs...")

        local chunks = {}
        local buf = {}
        local totalRanks = 0
        local multiRankSkills = 0

        for idx, sid in ipairs(CANONICAL_SKILL_IDS) do
            local seenDesc = {}
            local ranks = {}
            for lvl = 0, 55 do
                local ok, tip = pcall(function() return api.Skill:GetSkillTooltip(sid, lvl) end)
                if ok and type(tip) == "table" and type(tip.description) == "string" and tip.description ~= "" then
                    if not seenDesc[tip.description] then
                        seenDesc[tip.description] = true
                        ranks[#ranks + 1] = {
                            arg2 = lvl,
                            rankIndex = #ranks + 1,
                            description = tip.description,
                        }
                        totalRanks = totalRanks + 1
                    end
                end
            end
            if #ranks > 1 then
                multiRankSkills = multiRankSkills + 1
            end
            buf[#buf + 1] = {
                skillId = sid,
                rankCount = #ranks,
                ranks = ranks,
            }
            if #buf >= 15 or idx == #CANONICAL_SKILL_IDS then
                chunks[#chunks + 1] = jsonEncode(buf)
                buf = {}
            end
        end

        local outFile = "skill_ranks.txt"
        local payload = {
            metaJson = jsonEncode({
                schemaVersion = 1,
                skillCount = #CANONICAL_SKILL_IDS,
                totalDistinctRanks = totalRanks,
                multiRankSkills = multiRankSkills,
                player = collectPlayerSnapshot(),
            }),
            chunkCount = #chunks,
            rankChunks = chunks,
        }

        local ok, err = pcall(function()
            api.File:Write(outFile, payload)
        end)

        setButtonsEnabled(true)

        if ok then
            local msg = string.format(
                "Saved %d ranks (%d multi-rank skills) to %s",
                totalRanks, multiRankSkills, outFile
            )
            setStatus(msg)
            logInfo(msg)
            logInfo("Path: Documents/AAClassic/Addon/" .. outFile)
        else
            setStatus("Rank write error: " .. tostring(err))
            logErr("Rank write error: " .. tostring(err))
        end
    end)
end

-- ============================================================================
-- Per-Skillset Guided Swap Dumper
-- ============================================================================
local function stripColors(s)
    if type(s) ~= "string" then return "" end
    return s:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|nc;", ""):gsub("|ni;", "")
end

local function extractFormulaPreview(tip)
    if type(tip) ~= "table" or type(tip.description) ~= "string" then
        return "(no tooltip)"
    end
    local clean = stripColors(tip.description)
    local paren = clean:match("%(%s*[0-9][0-9.,]*%s*%+%s*[0-9][0-9.,]*%%[^%)]*%)")
    if paren then
        return paren
    end
    local short = clean:gsub("\n", " "):sub(1, 52)
    return short
end

local function inspectCleanState(snap)
    snap = snap or collectPlayerSnapshot()
    local u = snap.unitInfo or {}
    local gs = tonumber(u.gear_score or snap.gearScore or 0) or 0
    local mMul = tonumber(u.melee_damage_mul or 0) or 0
    local rMul = tonumber(u.ranged_damage_mul or 0) or 0
    local sMul = tonumber(u.spell_damage_mul or 0) or 0
    local hMul = tonumber(u.heal_mul or 0) or 0
    local hasMul = (mMul ~= 0) or (rMul ~= 0) or (sMul ~= 0) or (hMul ~= 0)
    local hasCostume = (snap.apparel and snap.apparel.costume ~= nil) or false
    local hasUndergarment = (snap.apparel and snap.apparel.undergarment ~= nil) or false
    local buffCount = (snap.activeBuffs and #snap.activeBuffs) or 0

    local issues = {}
    local gearIssues = {}
    if gs > 0 then
        issues[#issues + 1] = "GS " .. tostring(gs)
        gearIssues[#gearIssues + 1] = "GS " .. tostring(gs)
    end
    if hasCostume then
        issues[#issues + 1] = "Costume(+1 rank)"
        gearIssues[#gearIssues + 1] = "Costume(+1 rank)"
    end
    if hasUndergarment then
        issues[#issues + 1] = "Undergarment"
        gearIssues[#gearIssues + 1] = "Undergarment"
    end
    local mulDetail = ""
    if hasMul then
        mulDetail = string.format("Mul>0: M:%.1f%%  R:%.1f%%  S:%.1f%%  H:%.1f%%", mMul, rMul, sMul, hMul)
        issues[#issues + 1] = mulDetail
    end

    local isCleanNaked = (#issues == 0)
    local summary
    local detail
    if isCleanNaked then
        summary = string.format("CLEAN: GS 0 | 0%% Skill Dmg | %d buffs", buffCount)
        detail = "Ready to dump raw unmodified tooltips!"
    else
        summary = (#gearIssues > 0) and ("WARN: " .. table.concat(gearIssues, " | ")) or "WARN: Active skill dmg/heal % buff!"
        detail = (mulDetail ~= "") and (mulDetail .. " (unequip all!)") or "Unequip all gear & costume before dumping!"
    end

    return {
        snapshot = snap,
        isCleanNaked = isCleanNaked,
        gearScore = gs,
        hasMul = hasMul,
        hasCostume = hasCostume,
        hasUndergarment = hasUndergarment,
        buffCount = buffCount,
        issues = issues,
        summary = summary,
        detail = detail,
    }
end

local function loadExistingTreeStatuses()
    if not (api and api.File and api.File.Read) then
        return
    end
    for _, tk in ipairs(SKILLSET_ORDER) do
        local ok, data = pcall(function() return api.File:Read("skill_dump_" .. tk .. ".txt") end)
        if ok and type(data) == "table" and type(data.metaJson) == "string" then
            if data.metaJson:find('"isCleanNaked":true', 1, true) then
                treeDumpStatus[tk] = "ok"
            else
                treeDumpStatus[tk] = "warn"
            end
            local lvStr = data.metaJson:match('"skillsetLevel"%s*:%s*(%d+)')
            if lvStr then
                treeDumpLevel[tk] = tonumber(lvStr)
            end
        end
        local okG, dataG = pcall(function() return api.File:Read("skill_dump_" .. tk .. "_geared.txt") end)
        if okG and type(dataG) == "table" and dataG.metaJson then
            treeGearedStatus[tk] = true
        end
    end
end

local function setSelectedLevel(newLv)
    local lv = math.floor(tonumber(newLv) or 55)
    if lv < 1 then lv = 1 end
    if lv > 55 then lv = 55 end
    selectedSkillsetLevel = lv
    if levelLabel then
        if lv == 55 then
            levelLabel:SetText("Skillset Lv: 55 (MAX)")
            levelLabel.style:SetColor(0.55, 1.0, 0.65, 1)
        else
            levelLabel:SetText("Skillset Lv: " .. tostring(lv) .. " (<55)")
            levelLabel.style:SetColor(1.0, 0.78, 0.35, 1)
        end
    end
end

local function refreshGuidedUi(clean)
    safeCall("refreshGuidedUi", function()
        clean = clean or inspectCleanState()
        if cleanCheckLabel then
            cleanCheckLabel:SetText(clean.summary)
            if clean.isCleanNaked then
                cleanCheckLabel.style:SetColor(0.55, 1.0, 0.65, 1)
            else
                cleanCheckLabel.style:SetColor(1.0, 0.78, 0.35, 1)
            end
        end
        if cleanCheckDetailLabel then
            cleanCheckDetailLabel:SetText(clean.detail or "")
            if clean.isCleanNaked then
                cleanCheckDetailLabel.style:SetColor(0.70, 0.90, 0.75, 1)
            else
                cleanCheckDetailLabel.style:SetColor(1.0, 0.86, 0.55, 1)
            end
        end

        setSelectedLevel(selectedSkillsetLevel)

        if modeToggleBtn then
            if dumpMode == "naked" then
                modeToggleBtn:SetText("Mode: NAKED Raw (click -> GEARED 2-Pt)")
            else
                modeToggleBtn:SetText("Mode: GEARED 2-Pt Pair (click -> NAKED Raw)")
            end
        end

        local okMaxCount = 0
        local remaining = {}
        local underMax = {}
        for _, tk in ipairs(SKILLSET_ORDER) do
            local cfg = SKILLSET_CONFIG[tk]
            local st = treeDumpStatus[tk]
            local lv = treeDumpLevel[tk]
            local isLv55 = (lv == nil or lv >= 55)
            if st == "ok" and isLv55 then
                okMaxCount = okMaxCount + 1
            elseif st ~= nil and lv ~= nil and lv < 55 then
                underMax[#underMax + 1] = cfg.label .. "(" .. tostring(lv) .. ")"
            else
                remaining[#remaining + 1] = cfg.label
            end

            local btn = treeButtons[tk]
            if btn then
                local suffix = cfg.needsTwoPoint and " *" or ""
                local prefix
                if dumpMode == "geared" then
                    prefix = treeGearedStatus[tk] and "[G] " or "[ ] "
                else
                    local lvTag = lv and tostring(lv) or "OK"
                    if st == "ok" then
                        prefix = "[" .. lvTag .. "] "
                    elseif st == "warn" then
                        prefix = "[!" .. lvTag .. "] "
                    else
                        prefix = "[ ] "
                    end
                end
                btn:SetText(prefix .. cfg.label .. suffix)
            end
        end

        if guideLabel then
            if okMaxCount >= #SKILLSET_ORDER then
                guideLabel:SetText("Lv55 Progress: 10/10 DONE! Copy skill_dump_*.txt to damage-sim/addon/.")
                guideLabel.style:SetColor(0.55, 1.0, 0.65, 1)
            else
                local batch = {}
                for i = 1, math.min(3, #remaining) do
                    batch[#batch + 1] = remaining[i]
                end
                local msg
                if #batch > 0 then
                    msg = string.format("Lv55: %d/10  |  Next swap: %s", okMaxCount, table.concat(batch, " + "))
                else
                    msg = string.format("Lv55: %d/10  |  All remaining trees dumped below Lv55", okMaxCount)
                end
                guideLabel:SetText(msg)
                guideLabel.style:SetColor(0.75, 0.90, 1.0, 1)
            end
        end

        if underMaxLabel then
            if #underMax > 0 then
                underMaxLabel:SetText("Re-dump once Lv55: " .. table.concat(underMax, ", "))
                underMaxLabel.style:SetColor(1.0, 0.80, 0.40, 1)
            else
                underMaxLabel:SetText("Tip: Detailed Skill Tooltips ON; unequip gear + costume before clicking.")
                underMaxLabel.style:SetColor(0.70, 0.76, 0.82, 1)
            end
        end
    end)
end

local function dumpSingleSkillset(treeKey)
    safeCall("dumpSingleSkillset:" .. tostring(treeKey), function()
        if scanState.active then
            logInfo("Full scan in progress; wait for it to finish.")
            return
        end
        local cfg = SKILLSET_CONFIG[treeKey]
        if not cfg then return end

        if not activeSkillFetcher then
            probeSkillApi()
        end
        if not activeSkillFetcher then
            setStatus("Skill API probe failed! Run Debug API.")
            return
        end

        local clean = inspectCleanState()
        local isGearedMode = (dumpMode == "geared")
        local outFile = isGearedMode
            and ("skill_dump_" .. treeKey .. "_geared.txt")
            or ("skill_dump_" .. treeKey .. ".txt")

        local matched = {}
        local samplePreview = "(missing)"
        for _, sid in ipairs(cfg.ids) do
            local tip = safeGetSkillTooltip(sid)
            if tip ~= nil then
                matched[#matched + 1] = {
                    skillId = sid,
                    skillset = cfg.label,
                    tooltip = tip,
                }
                if sid == cfg.sampleId then
                    samplePreview = extractFormulaPreview(tip)
                end
            end
        end

        local meta = {
            schemaVersion = 4,
            dumpType = "single_skillset",
            skillset = treeKey,
            skillsetLabel = cfg.label,
            skillsetLevel = selectedSkillsetLevel,
            isMaxLevel = (selectedSkillsetLevel >= 55),
            dumpMode = dumpMode,
            isCleanNaked = clean.isCleanNaked,
            hasCostume = clean.hasCostume,
            hasUndergarment = clean.hasUndergarment,
            hasMul = clean.hasMul,
            cleanIssues = clean.issues,
            skillCallMode = activeSkillCallMode,
            matchedCount = #matched,
            expectedCount = #cfg.ids,
            sampleSkill = cfg.sampleName .. ": " .. samplePreview,
            player = clean.snapshot,
        }

        local chunks = {}
        local buf = {}
        for i = 1, #matched do
            buf[#buf + 1] = matched[i]
            if #buf >= CHUNK_SIZE or i == #matched then
                chunks[#chunks + 1] = jsonEncode(buf)
                buf = {}
            end
        end

        local ok, err = pcall(function()
            api.File:Write(outFile, {
                metaJson = jsonEncode(meta),
                chunkCount = #chunks,
                skillChunks = chunks,
            })
        end)

        if not ok then
            setStatus("Write error (" .. outFile .. "): " .. tostring(err))
            logErr("Failed writing " .. outFile .. ": " .. tostring(err))
            return
        end

        if isGearedMode then
            treeGearedStatus[treeKey] = true
        else
            treeDumpStatus[treeKey] = clean.isCleanNaked and "ok" or "warn"
            treeDumpLevel[treeKey] = selectedSkillsetLevel
        end

        refreshGuidedUi(clean)

        local previewLine = cfg.sampleName .. ": " .. samplePreview
        if (not isGearedMode) and (not clean.isCleanNaked) then
            local warnMsg = string.format(
                "[!] Saved %s Lv%d (%d/%d) -> %s (WITH GEAR/COSTUME!)",
                cfg.label, selectedSkillsetLevel, #matched, #cfg.ids, outFile
            )
            setStatus(warnMsg, previewLine)
            if statusLabel then statusLabel.style:SetColor(1.0, 0.78, 0.35, 1) end
            if statusPreviewLabel then statusPreviewLabel.style:SetColor(1.0, 0.85, 0.55, 1) end
            logErr(warnMsg .. " | " .. previewLine)
        else
            local lvNote = (selectedSkillsetLevel < 55) and (" [Lv" .. tostring(selectedSkillsetLevel) .. " <55]") or " [Lv55]"
            local okMsg = string.format(
                "[OK] %s%s (%d/%d) -> %s",
                cfg.label, lvNote, #matched, #cfg.ids, outFile
            )
            setStatus(okMsg, previewLine)
            if statusLabel then
                if selectedSkillsetLevel < 55 then
                    statusLabel.style:SetColor(1.0, 0.85, 0.45, 1)
                else
                    statusLabel.style:SetColor(0.55, 1.0, 0.65, 1)
                end
            end
            if statusPreviewLabel then statusPreviewLabel.style:SetColor(0.80, 0.92, 1.0, 1) end
            logInfo(okMsg .. " | " .. previewLine)
        end
    end)
end

-- ============================================================================
-- UI Construction
-- ============================================================================
local function makeButton(id, parent, text, x, y, w, h)
    local btn = api.Interface:CreateWidget("button", id, parent)
    btn:AddAnchor("TOPLEFT", parent, x, y)
    btn:SetText(text)
    api.Interface:ApplyButtonSkin(btn, BUTTON_BASIC.DEFAULT)
    -- ApplyButtonSkin enables auto-resize and resets extent; disable it so buttons align uniformly
    pcall(function()
        if btn.SetAutoResize then btn:SetAutoResize(false) end
    end)
    btn:SetExtent(w, h)
    btn:Show(true)
    return btn
end

local function makeLabel(id, parent, text, x, y, w, h, fontSize)
    local lbl = api.Interface:CreateWidget("label", id, parent)
    lbl:AddAnchor("TOPLEFT", parent, x, y)
    lbl:SetExtent(w, h)
    lbl:SetText(text)
    lbl.style:SetAlign(ALIGN.LEFT)
    lbl.style:SetFontSize(fontSize or 13)
    lbl.style:SetColor(0.95, 0.95, 0.95, 1)
    lbl:Show(true)
    return lbl
end

local function createMainWindow()
    mainWindow = api.Interface:CreateWindow("SkillDumperMainWindow", "Skill Dumper", 580, 672)
    mainWindow:AddAnchor("CENTER", "UIParent", 0, 0)
    mainWindow:SetHandler("OnCloseByEsc", function()
        safeCall("OnCloseByEsc", function()
            if mainWindow then mainWindow:Show(false) end
        end)
    end)

    -- 1. Check button on the LEFT + 2 short clean lines on the RIGHT (never collides!)
    checkGearBtn = makeButton("skillDumperCheckGear", mainWindow, "Check", 24, 46, 84, 30)
    checkGearBtn:SetHandler("OnClick", function()
        refreshGuidedUi()
    end)

    cleanCheckLabel = makeLabel(
        "skillDumperCleanCheck", mainWindow,
        "Checking gear & costume state...",
        122, 46, 434, 20, 13
    )
    cleanCheckDetailLabel = makeLabel(
        "skillDumperCleanCheckDetail", mainWindow,
        "",
        122, 66, 434, 18, 11
    )

    -- 2. Guided swap step instruction (2 clean single-line labels)
    guideLabel = makeLabel(
        "skillDumperGuide", mainWindow,
        "Lv55: 0/10  |  Next swap: Battlerage + Witchcraft + Defense",
        24, 98, 532, 20, 12
    )
    underMaxLabel = makeLabel(
        "skillDumperUnderMax", mainWindow,
        "Tip: Detailed Skill Tooltips ON; unequip gear + costume before clicking.",
        24, 120, 532, 18, 11
    )
    underMaxLabel.style:SetColor(0.70, 0.76, 0.82, 1)

    -- 3. Mode toggle (NAKED raw vs GEARED 2-pt pair)
    modeToggleBtn = makeButton(
        "skillDumperModeBtn", mainWindow,
        "Mode: NAKED Raw (click -> GEARED 2-Pt)",
        24, 150, 532, 30
    )
    modeToggleBtn:SetHandler("OnClick", function()
        dumpMode = (dumpMode == "naked") and "geared" or "naked"
        refreshGuidedUi()
    end)

    -- 4. Skillset Level Selector (generous 90px pitch so buttons never touch even at min skin width!)
    levelLabel = makeLabel(
        "skillDumperLevelLabel", mainWindow,
        "Skillset Lv: 55 (MAX)",
        24, 198, 166, 22, 13
    )
    levelMinus5Btn = makeButton("skillDumperLvM5", mainWindow, "-5", 200, 194, 78, 30)
    levelMinus5Btn:SetHandler("OnClick", function() setSelectedLevel(selectedSkillsetLevel - 5) end)

    levelMinus1Btn = makeButton("skillDumperLvM1", mainWindow, "-1", 290, 194, 78, 30)
    levelMinus1Btn:SetHandler("OnClick", function() setSelectedLevel(selectedSkillsetLevel - 1) end)

    levelPlus1Btn = makeButton("skillDumperLvP1", mainWindow, "+1", 380, 194, 78, 30)
    levelPlus1Btn:SetHandler("OnClick", function() setSelectedLevel(selectedSkillsetLevel + 1) end)

    levelMaxBtn = makeButton("skillDumperLvMax", mainWindow, "Max 55", 470, 194, 86, 30)
    levelMaxBtn:SetHandler("OnClick", function() setSelectedLevel(55) end)

    -- 5. 2x5 Grid of 10 Skillset Buttons (42px row pitch & 20px column gap)
    local gridHeader = makeLabel(
        "skillDumperGridHdr", mainWindow,
        "Per-Skillset Instant Dump (click each equipped skillset):",
        24, 240, 532, 20, 12
    )
    gridHeader.style:SetColor(0.82, 0.86, 0.92, 1)

    treeButtons = {}
    local startY = 266
    local rowH = 42
    local colW = 256
    local colGap = 20
    for idx, tk in ipairs(SKILLSET_ORDER) do
        local treeKey = tk
        local col = (idx - 1) % 2
        local row = math.floor((idx - 1) / 2)
        local x = 24 + col * (colW + colGap)
        local y = startY + row * rowH
        local cfg = SKILLSET_CONFIG[treeKey]
        local suffix = cfg.needsTwoPoint and " *" or ""
        local btn = makeButton("skillDumperTree_" .. treeKey, mainWindow, "[ ] " .. cfg.label .. suffix, x, y, colW, 30)
        btn:SetHandler("OnClick", function()
            dumpSingleSkillset(treeKey)
        end)
        treeButtons[treeKey] = btn
    end

    local starNote = makeLabel(
        "skillDumperStarNote", mainWindow,
        "* Optional GEARED 2-pt dump for Revitalizing Cheer / Rhythmic Renewal / Mend",
        24, 476, 532, 18, 11
    )
    starNote.style:SetColor(0.68, 0.74, 0.80, 1)

    -- 6. Legacy & Ode Utility Buttons (clearly separated section)
    local toolsHeader = makeLabel(
        "skillDumperToolsHdr", mainWindow,
        "Other Tools (Full Scan / Ode Buffs / Debug):",
        24, 506, 532, 20, 12
    )
    toolsHeader.style:SetColor(0.82, 0.86, 0.92, 1)

    dumpBtn1 = makeButton("skillDumperBtn1", mainWindow, "Full Geared (dump_1)", 24, 532, 256, 30)
    dumpBtn1:SetHandler("OnClick", function()
        startSkillScan("skill_dump_1.txt", "geared")
    end)

    dumpBtn2 = makeButton("skillDumperBtn2", mainWindow, "Full Naked (dump_2)", 300, 532, 256, 30)
    dumpBtn2:SetHandler("OnClick", function()
        startSkillScan("skill_dump_2.txt", "naked")
    end)

    buffBtn = makeButton("skillDumperBtn3", mainWindow, "Ode Geared", 24, 574, 168, 30)
    buffBtn:SetHandler("OnClick", function()
        dumpOdeBuffs("ode_dump_1.txt", "geared")
    end)

    rankBtn = makeButton("skillDumperBtn5", mainWindow, "Ode No-Wpn", 206, 574, 168, 30)
    rankBtn:SetHandler("OnClick", function()
        dumpOdeBuffs("ode_dump_2.txt", "no_weapon")
    end)

    debugBtn = makeButton("skillDumperBtn4", mainWindow, "Debug API", 388, 574, 168, 30)
    debugBtn:SetHandler("OnClick", function()
        runDebugDiagnostics()
    end)

    -- 7. Status & Signature Skill Preview (2 clean single-line labels)
    statusLabel = makeLabel(
        "skillDumperStatus", mainWindow,
        "Ready. Set Skillset Lv if <55, then click any equipped skillset.",
        24, 618, 532, 20, 12
    )
    statusLabel.style:SetColor(0.6, 1, 0.6, 1)

    statusPreviewLabel = makeLabel(
        "skillDumperStatusPreview", mainWindow,
        "",
        24, 640, 532, 20, 12
    )
    statusPreviewLabel.style:SetColor(0.80, 0.92, 1.0, 1)

    loadExistingTreeStatuses()
    refreshGuidedUi()
    mainWindow:Show(false)
end

local function openMainWindow()
    safeCall("openMainWindow", function()
        if not mainWindow then
            createMainWindow()
        end
        if mainWindow then
            refreshGuidedUi()
            mainWindow:Show(true)
        end
    end)
end

local function toggleMainWindow()
    safeCall("toggleMainWindow", function()
        if not mainWindow then
            createMainWindow()
        end
        if mainWindow then
            local show = not mainWindow:IsVisible()
            if show then
                refreshGuidedUi()
            end
            mainWindow:Show(show)
        end
    end)
end

-- ============================================================================
-- Addon Lifecycle
-- ============================================================================
local function OnLoad()
    safeCall("OnLoad", function()
        logInfo("Loading Skill Dumper v0.1.0 (Per-Skillset Swap Guide)...")
        createMainWindow()

        pcall(function()
            local configMenu = michaelClientLib.initializeMichaelClient()
            if configMenu and configMenu.michaelClient then
                configMenu.michaelClient:AddAddon(MICHAEL_CLIENT_TITLE, function()
                    openMainWindow()
                end)
            end
        end)

        api.On("UPDATE", onUpdate)
        logInfo("Loaded v0.1.0 (hidden). Open via Addon Settings or ESC -> Addon Options -> Skill Dumper.")
    end)
end

local function OnUnload()
    safeCall("OnUnload", function()
        scanState.active = false

        pcall(function()
            api.On("UPDATE", function() return end)
        end)

        pcall(function()
            michaelClientLib.removeAddon(MICHAEL_CLIENT_TITLE)
        end)

        if mainWindow then
            pcall(function()
                mainWindow:Show(false)
                api.Interface:Free(mainWindow)
            end)
            mainWindow = nil
        end

        statusLabel = nil
        statusPreviewLabel = nil
        cleanCheckLabel = nil
        cleanCheckDetailLabel = nil
        guideLabel = nil
        underMaxLabel = nil
        modeToggleBtn = nil
        checkGearBtn = nil
        levelLabel = nil
        levelMinus5Btn = nil
        levelMinus1Btn = nil
        levelPlus1Btn = nil
        levelMaxBtn = nil
        treeButtons = {}
        dumpBtn1 = nil
        dumpBtn2 = nil
        buffBtn = nil
        debugBtn = nil
        rankBtn = nil
        logInfo("Unloaded v0.1.0")
    end)
end

skill_dumper_addon.OnLoad = OnLoad
skill_dumper_addon.OnUnload = OnUnload
skill_dumper_addon.OnSettingToggle = toggleMainWindow

return skill_dumper_addon
