#!/usr/bin/env python3
"""
AA Classic Buff ID Importer for the ArcheAge Classic 1.3.6 Damage & Healing Simulator.

Fetches buff definitions directly from `https://aa-classic.com/data/buffs/<id>.json`,
downloads their icons locally into `assets/icons/`, translates AA Classic modifier
attributes into the simulator's COMBAT_MODIFIERS schema, and saves them into
`<repo>/buffs/<slug>.json` (+ updates `buffs/_index.json`).

Usage:
    python tools/import_buff.py 1668
    python tools/import_buff.py 1668 6148 18169 --dry-run
    python tools/import_buff.py https://aa-classic.com/database/buffs/4846 --side attacker --debuff
    python tools/import_buff.py 18409 --name "Dimensional Destroyer (Dungeon)"
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

MAX_REMOTE_BYTES = 2 * 1024 * 1024  # 2 MB cap for remote buff JSON / icon downloads

REPO_ROOT = Path(__file__).resolve().parent.parent
BUFFS_DIR = REPO_ROOT / "buffs"
ICONS_DIR = REPO_ROOT / "assets" / "icons"

AAC_BUFF_URL = "https://aa-classic.com/data/buffs/{buff_id}.json"
AAC_ICON_URL = "https://aa-classic.com/game/icons/{icon_path}"
DARUGEAR_ICON_URL = "https://darugear.com/assets/icons/{icon_path}"
USER_AGENT = "AAClassic-DamageSim-BuffImporter/1.0"

VALID_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,79}$")
BUFF_ID_EXTRACT_RE = re.compile(r"(?:buffs/)?(\d+)(?:\.json)?/?$", re.IGNORECASE)
AA_COLOR_RE = re.compile(r"\|(?:c[0-9a-fA-F]{8}|n[a-zA-Z];|r)")


def parse_buff_id(raw: str | int) -> int:
    """Extract a positive integer AA Classic buff ID from an ID string or URL."""
    s = str(raw or "").strip()
    if s.isdigit():
        bid = int(s)
        if bid > 0:
            return bid
    m = BUFF_ID_EXTRACT_RE.search(s)
    if m:
        bid = int(m.group(1))
        if bid > 0:
            return bid
    raise ValueError(f"Could not parse a numeric AA Classic buff ID from: {raw!r}")


def slugify_buff_id(raw: str, buff_id: int | None = None) -> str:
    s = re.sub(r"[^a-z0-9_]+", "_", (raw or "").strip().lower())
    s = re.sub(r"_{2,}", "_", s).strip("_")
    if not s:
        s = f"aac_buff_{buff_id}" if buff_id else "custom_buff"
    if buff_id and not s.endswith(f"_{buff_id}"):
        s = f"{s}_{buff_id}"
    return s[:80]


def clean_aa_text(text: str, duration_text: str | None = None) -> str:
    s = str(text or "")
    s = AA_COLOR_RE.sub("", s)
    if duration_text:
        s = s.replace("#{duration}", str(duration_text))
    s = re.sub(r"\s+", " ", s).strip()
    return s


ALLOWED_REMOTE_HOSTS = {"aa-classic.com", "www.aa-classic.com", "darugear.com", "www.darugear.com"}
RESERVED_BUFF_IDS = {"loadouts"}


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        p = urllib.parse.urlparse(newurl)
        if p.scheme.lower() != "https" or (p.hostname or "").lower() not in ALLOWED_REMOTE_HOSTS:
            raise ValueError(f"Blocked redirect to untrusted target: {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_SAFE_OPENER = urllib.request.build_opener(_SafeRedirectHandler())


def _http_get_bytes(url: str, timeout: float = 15.0, max_bytes: int = MAX_REMOTE_BYTES) -> bytes:
    p = urllib.parse.urlparse(url)
    if p.scheme.lower() != "https" or (p.hostname or "").lower() not in ALLOWED_REMOTE_HOSTS:
        raise ValueError(f"Blocked request to untrusted host: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with _SAFE_OPENER.open(req, timeout=timeout) as resp:
        data = resp.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError(f"Remote response exceeded {max_bytes} byte safety limit: {url}")
    return data


def fetch_aac_buff_raw(buff_id: int, timeout: float = 15.0) -> dict[str, Any]:
    """Fetch raw JSON from https://aa-classic.com/data/buffs/<id>.json."""
    url = AAC_BUFF_URL.format(buff_id=buff_id)
    try:
        raw_bytes = _http_get_bytes(url, timeout=timeout)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise ValueError(f"AA Classic buff ID {buff_id} was not found (HTTP 404 at {url})") from exc
        raise RuntimeError(f"HTTP {exc.code} fetching {url}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error fetching {url}: {exc.reason}") from exc

    try:
        data = json.loads(raw_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Invalid JSON returned from {url}: {exc}") from exc

    if not isinstance(data, dict) or not data.get("id"):
        raise RuntimeError(f"Unexpected payload from {url}")
    return data


def _sanitize_icon_relpath(icon_name: str) -> str | None:
    """Validate an AA Classic raster icon relative path (e.g. 'icon_skill_buff09.png' or 'aac/foo.png')."""
    rel = str(icon_name or "").strip().replace("\\", "/").lstrip("/")
    if not rel or ".." in rel.split("/"):
        return None
    if not re.match(r"^[A-Za-z0-9_./-]+$", rel):
        return None
    if not rel.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        return None
    return rel


def _is_valid_raster_image(data: bytes) -> bool:
    """Verify downloaded icon bytes match PNG, JPEG, or WebP magic headers."""
    if not data or len(data) < 12:
        return False
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return True
    if data.startswith(b"\xff\xd8\xff"):
        return True
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return True
    return False


def download_aac_icon(icon_name: str, timeout: float = 15.0) -> str | None:
    """Download icon from aa-classic.com (or darugear.com fallback) into assets/icons/<rel> if missing."""
    rel = _sanitize_icon_relpath(icon_name)
    if not rel:
        return None
    if rel.startswith("assets/icons/"):
        rel = rel[len("assets/icons/"):]

    dest = (ICONS_DIR / rel).resolve()
    if ICONS_DIR.resolve() not in dest.parents:
        return None

    if not dest.exists() or dest.stat().st_size == 0:
        urls = [
            AAC_ICON_URL.format(icon_path=rel),
            DARUGEAR_ICON_URL.format(icon_path=rel),
        ]
        downloaded = False
        for url in urls:
            try:
                data = _http_get_bytes(url, timeout=timeout)
                if _is_valid_raster_image(data):
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    fd, tmp_name = tempfile.mkstemp(dir=str(dest.parent), prefix=f".{dest.stem}.", suffix=".tmp")
                    try:
                        with os.fdopen(fd, "wb") as fh:
                            fh.write(data)
                        os.replace(tmp_name, dest)
                    except Exception:
                        try:
                            os.unlink(tmp_name)
                        except OSError:
                            pass
                        raise
                    downloaded = True
                    break
            except Exception:
                continue
        if not downloaded:
            return None

    return f"assets/icons/{rel}"


def cache_equipment_icons(equipment_list: list[Any], timeout: float = 10.0) -> int:
    """Download any missing gear icons referenced by a build's equipment array into assets/icons/."""
    if not isinstance(equipment_list, list):
        return 0
    seen: set[str] = set()
    cached = 0
    for item in equipment_list:
        if not isinstance(item, dict):
            continue
        icon = str(item.get("icon") or "").strip().replace("\\", "/")
        if not icon:
            continue
        if icon.startswith("/assets/icons/"):
            icon = icon[1:]
        if not icon.startswith("assets/icons/"):
            continue
        rel = icon[len("assets/icons/"):]
        if rel in seen:
            continue
        seen.add(rel)
        if download_aac_icon(rel, timeout=timeout):
            cached += 1
    return cached


def _num(val: Any) -> float:
    try:
        n = float(val)
        return round(n, 6)
    except (TypeError, ValueError):
        return 0.0


def _mod_amount(m: dict[str, Any]) -> tuple[float, bool]:
    """
    Return (effective_numeric_value, is_percent_type).

    In AA Classic buff JSON:
      - type == "percent" (type_id == 1): `value` is a direct percentage multiplier
        (e.g. armor: -8 -> -8% Physical Defense; mainhand_dps: +10 -> +10% Attack).
      - type == "value" (type_id == 0): `display_value` (or `value * unit_multiplier`)
        gives the human value (e.g. value=500, unit_multiplier=0.1, unit_suffix="%" -> +50.0%).
    """
    mtype = str(m.get("type") or "").lower()
    is_pct_type = mtype == "percent" or m.get("type_id") == 1
    if is_pct_type:
        return _num(m.get("value")), True

    if m.get("display_value") is not None:
        return _num(m.get("display_value")), False

    raw_val = _num(m.get("value"))
    mult = _num(m.get("unit_multiplier") if m.get("unit_multiplier") is not None else 1)
    return round(raw_val * mult, 6), False


def _add_dict(target: dict[str, float], key: str, delta: float) -> None:
    if not delta:
        return
    cur = target.get(key, 0.0)
    nxt = round(cur + delta, 4)
    if abs(nxt) < 1e-9:
        target.pop(key, None)
    else:
        target[key] = int(nxt) if float(nxt).is_integer() else nxt


def _mul_dict(target: dict[str, float], key: str, pct: float) -> None:
    if not pct:
        return
    factor = round(1.0 + pct / 100.0, 6)
    cur = target.get(key, 1.0)
    target[key] = round(cur * factor, 4)


def convert_aac_buff(
    raw: dict[str, Any],
    *,
    local_icon: str | None = None,
    side_override: str | None = None,
    debuff_override: bool | None = None,
    name_override: str | None = None,
    custom_id: str | None = None,
) -> dict[str, Any]:
    """
    Translate an AA Classic `data/buffs/<id>.json` object into a simulator COMBAT_MODIFIERS entry.
    """
    buff_id = int(raw["id"])
    raw_name = str(name_override or raw.get("name") or f"Buff {buff_id}").strip()
    kind = str(raw.get("kind") or "").lower()
    is_debuff = debuff_override if debuff_override is not None else (kind == "debuff" or raw.get("kind_id") == 2)
    duration_text = raw.get("duration_text") or (
        f"{int(raw['duration'] / 1000)}s" if isinstance(raw.get("duration"), (int, float)) and raw["duration"] > 0 else None
    )
    clean_desc = clean_aa_text(raw.get("description") or "", duration_text)

    add_attrs: dict[str, float] = {}
    add_off: dict[str, float] = {}
    mul_off: dict[str, float] = {}
    add_def: dict[str, float] = {}
    mul_def: dict[str, float] = {}
    add_max_hp = 0.0
    pve_dmg_vals: list[float] = []
    pve_dr_vals: list[float] = []
    unmapped: list[str] = []

    # Track weapon-percent melee attack modifiers so melee_dps_inc + mainhand_dps + offhand_dps
    # on items like Doomshadow Nodachi don't triple-multiply Melee Attack.
    melee_atk_pct_seen: list[float] = []
    attack_speed_seen: list[float] = []

    modifiers = raw.get("modifiers") or []
    for m in modifiers:
        if not isinstance(m, dict):
            continue
        attr = str(m.get("attribute") or "").strip().lower()
        val, is_pct_type = _mod_amount(m)
        disp_label = f"{m.get('name') or attr} {m.get('display') or val}".strip()

        # --- Core attributes ---
        if attr in ("str", "strength"):
            _add_dict(add_attrs, "str", val)
        elif attr in ("agi", "agility"):
            _add_dict(add_attrs, "agi", val)
        elif attr in ("sta", "stamina"):
            _add_dict(add_attrs, "sta", val)
        elif attr in ("int", "intelligence"):
            _add_dict(add_attrs, "int", val)
        elif attr in ("spi", "spirit"):
            _add_dict(add_attrs, "spi", val)
        elif attr in ("max_health", "max_health_add", "health_max"):
            if is_pct_type:
                unmapped.append(f"{disp_label} (% Max HP)")
            else:
                add_max_hp += val

        # --- Attack Power / Healing Power ---
        elif attr in ("melee_dps_inc", "mainhand_dps", "offhand_dps"):
            if is_pct_type:
                melee_atk_pct_seen.append(val)
            else:
                # Avoid double counting offhand_dps flat if mainhand_dps is present
                if attr != "offhand_dps":
                    _add_dict(add_off, "meleeAttack", val)
        elif attr in ("ranged_dps_inc", "ranged_dps"):
            if is_pct_type:
                _mul_dict(mul_off, "rangedAttack", val)
            else:
                _add_dict(add_off, "rangedAttack", val)
        elif attr in ("spell_dps_inc", "magic_dps_inc", "magic_dps"):
            if is_pct_type:
                _mul_dict(mul_off, "magicAttack", val)
            else:
                _add_dict(add_off, "magicAttack", val)
        elif attr in ("heal_dps_inc", "healing_power", "heal_dps"):
            if is_pct_type:
                _mul_dict(mul_off, "healingPower", val)
            else:
                # AA Classic's buff JSON occasionally omits the 0.001 milli-DPS unit_multiplier on heal_dps_inc
                # (e.g. Andrion II's Blessing buff 16541 exports value=10000, unit_multiplier=1 for +10 Healing Power)
                heal_val = val
                if attr == "heal_dps_inc" and _num(m.get("unit_multiplier") or 1) == 1 and abs(heal_val) >= 1000:
                    heal_val = round(heal_val / 1000.0, 4)
                _add_dict(add_off, "healingPower", heal_val)

        # --- Skill Damage % & Healing % ---
        elif attr == "melee_damage_mul":
            _add_dict(add_off, "meleeSkillDamagePct", val)
        elif attr == "ranged_damage_mul":
            _add_dict(add_off, "rangedSkillDamagePct", val)
        elif attr in ("spell_damage_mul", "magic_damage_mul"):
            _add_dict(add_off, "magicSkillDamagePct", val)
        elif attr in ("heal_mul", "healing_mul", "outgoing_heal_mul"):
            _add_dict(add_off, "healingPct", val)
        elif attr == "backattack_melee_damage_mul":
            _add_dict(add_off, "backstabMeleeDamagePct", val)
        elif attr == "backattack_ranged_damage_mul":
            _add_dict(add_off, "backstabRangedDamagePct", val)
        elif attr in ("backattack_spell_damage_mul", "backattack_magic_damage_mul"):
            _add_dict(add_off, "backstabMagicDamagePct", val)
        elif attr in ("melee_damage_mul_anti_npc", "ranged_damage_mul_anti_npc", "spell_damage_mul_anti_npc"):
            pve_dmg_vals.append(val)

        # --- Crit Rate & Crit Damage ---
        elif attr in ("melee_critical_mul", "melee_crit_rate"):
            _add_dict(add_off, "meleeCritRatePct", val)
        elif attr in ("ranged_critical_mul", "ranged_crit_rate"):
            _add_dict(add_off, "rangedCritRatePct", val)
        elif attr in ("spell_critical_mul", "magic_crit_rate"):
            _add_dict(add_off, "magicCritRatePct", val)
        elif attr in ("heal_critical_mul", "heal_crit_rate"):
            _add_dict(add_off, "healCritRatePct", val)
        elif attr in ("melee_critical_bonus_mul", "melee_crit_bonus"):
            _add_dict(add_off, "meleeCritBonusPct", val)
        elif attr in ("ranged_critical_bonus_mul", "ranged_crit_bonus"):
            _add_dict(add_off, "rangedCritBonusPct", val)
        elif attr in ("spell_critical_bonus_mul", "magic_crit_bonus"):
            _add_dict(add_off, "magicCritBonusPct", val)
        elif attr in ("heal_critical_bonus_mul", "heal_crit_bonus"):
            _add_dict(add_off, "healCritBonusPct", val)

        # --- Penetration, Focus, Accuracy, Cast Time ---
        elif attr == "ignore_armor":
            _add_dict(add_off, "defensePenetration", val)
        elif attr == "ignore_magic_resist":
            _add_dict(add_off, "magicDefensePenetration", val)
        elif attr in ("ignore_shield_chance", "ignore_shield_rate"):
            _add_dict(add_off, "shieldDefPenRatePct", val)
        elif attr in ("ignore_shield_bonus_mul", "ignore_shield_bonus"):
            _add_dict(add_off, "shieldDefPenPct", val)
        elif attr in ("anti_avoid", "focus", "focus_add"):
            _add_dict(add_off, "focus", val)
        elif attr == "melee_anti_miss_mul":
            _add_dict(add_off, "meleeAccuracyPct", val)
        elif attr == "ranged_anti_miss_mul":
            _add_dict(add_off, "rangedAccuracyPct", val)
        elif attr in ("spell_anti_miss_mul", "magic_anti_miss_mul"):
            _add_dict(add_off, "magicAccuracyPct", val)
        elif attr == "casting_time_mul":
            _add_dict(add_off, "castTimePct", val)
        elif attr in ("attack_anim_speed_mul", "global_cooldown_mul"):
            # AA Classic Attack Speed rating = raw value (e.g. +50.0% = +500 rating, +25.0% = +250)
            raw_rating = _num(m.get("value")) if m.get("value") is not None else round(val * 10, 4)
            attack_speed_seen.append(raw_rating)

        # --- Defense, Toughness, Resilience, Avoidance ---
        elif attr == "armor":
            if is_pct_type:
                _mul_dict(mul_def, "physicalDefense", val)
            else:
                _add_dict(add_def, "physicalDefense", val)
        elif attr == "magic_resist":
            if is_pct_type:
                _mul_dict(mul_def, "magicDefense", val)
            else:
                _add_dict(add_def, "magicDefense", val)
        elif attr in ("battle_resist", "toughness"):
            _add_dict(add_def, "toughness", val)
        elif attr in ("flexibility", "resilience"):
            _add_dict(add_def, "resilience", val)
        elif attr in ("dodge_mul", "evasion_mul"):
            _add_dict(add_def, "evasionPct", val)
        elif attr in ("melee_parry_mul", "parry_mul"):
            _add_dict(add_def, "parryPct", val)
        elif attr == "ranged_parry_mul":
            _add_dict(add_def, "rangedParryPct", val)
        elif attr == "block_mul":
            _add_dict(add_def, "blockPct", val)

        # --- Received Damage & Healing ---
        elif attr == "incoming_damage_mul":
            # AA Classic: -21% Received Dmg => +21% Received DR; +15% Received Dmg => -15% DR
            _add_dict(add_def, "receivedMeleeDrPct", -val)
            _add_dict(add_def, "receivedRangedDrPct", -val)
            _add_dict(add_def, "receivedMagicDrPct", -val)
        elif attr == "incoming_melee_damage_mul":
            _add_dict(add_def, "receivedMeleeDrPct", -val)
        elif attr == "incoming_ranged_damage_mul":
            _add_dict(add_def, "receivedRangedDrPct", -val)
        elif attr in ("incoming_spell_damage_mul", "incoming_magic_damage_mul"):
            _add_dict(add_def, "receivedMagicDrPct", -val)
        elif attr == "incoming_melee_damage_add":
            _add_dict(add_def, "fixedMeleeDr", -val)
        elif attr == "incoming_ranged_damage_add":
            _add_dict(add_def, "fixedRangedDr", -val)
        elif attr in ("incoming_spell_damage_add", "incoming_magic_damage_add"):
            _add_dict(add_def, "fixedMagicDr", -val)
        elif attr == "incoming_heal_mul":
            _add_dict(add_def, "receivedHealingPct", val)
        elif attr in ("incoming_damage_mul_anti_npc", "incoming_melee_damage_mul_anti_npc"):
            pve_dr_vals.append(-val)

        else:
            unmapped.append(disp_label)

    if melee_atk_pct_seen:
        # Take the unique melee % value (e.g. +10% across melee_dps_inc/mainhand_dps/offhand_dps)
        _mul_dict(mul_off, "meleeAttack", melee_atk_pct_seen[0])
    if attack_speed_seen:
        _add_dict(add_off, "attackSpeed", attack_speed_seen[0])

    # Auto-detect side
    has_off = bool(add_off or mul_off or pve_dmg_vals)
    has_def = bool(add_def or mul_def or pve_dr_vals)
    has_shared = bool(add_attrs or add_max_hp)
    if side_override in ("attacker", "defender", "both"):
        side = side_override
    elif (has_off and has_def) or (has_shared and not has_off and not has_def):
        side = "both"
    elif has_def and not has_off:
        side = "defender"
    else:
        side = "attacker"

    # Stacking: AA Classic only stacks modifier values when stack_rule == "multiple" (stack_rule_id == 4)
    stack_rule = str(raw.get("stack_rule") or "").lower()
    max_stack = int(raw.get("max_stack") or 1)
    is_stackable = max_stack > 1 and (stack_rule == "multiple" or raw.get("stack_rule_id") == 4)

    mod_id = slugify_buff_id(custom_id or raw_name, None if custom_id else buff_id)
    if not VALID_ID_RE.match(mod_id):
        mod_id = f"aac_buff_{buff_id}"

    desc_parts = []
    if clean_desc:
        desc_parts.append(clean_desc)
    meta_bits = [f"AA Classic buff {buff_id}"]
    if duration_text:
        meta_bits.append(str(duration_text))
    if unmapped:
        meta_bits.append("Utility: " + ", ".join(unmapped[:4]))
    desc_parts.append(f"({'; '.join(meta_bits)})")

    out: dict[str, Any] = {
        "id": mod_id,
        "aacBuffId": buff_id,
        "name": raw_name,
        "side": side,
        "isCustom": True,
        "description": " ".join(desc_parts).strip(),
    }
    if is_debuff:
        out["isDebuff"] = True
    if local_icon:
        out["icon"] = local_icon
    elif raw.get("icon"):
        rel = _sanitize_icon_relpath(raw["icon"])
        if rel:
            out["icon"] = f"assets/icons/{rel}"
            out["remoteIcon"] = AAC_ICON_URL.format(icon_path=rel)
    if is_stackable:
        out["maxStacks"] = max_stack
        out["defaultStacks"] = max_stack
        out["stackUnit"] = "x"
    if add_max_hp:
        out["addMaxHealth"] = int(add_max_hp) if float(add_max_hp).is_integer() else add_max_hp
    if add_attrs:
        out["addAttributes"] = add_attrs
    if add_off:
        out["addOffense"] = add_off
    if mul_off:
        out["mulOffense"] = mul_off
    if add_def:
        out["addDefense"] = add_def
    if mul_def:
        out["mulDefense"] = mul_def
    if pve_dmg_vals:
        v = pve_dmg_vals[0]
        out["pveDamageBonusPct"] = int(v) if float(v).is_integer() else v
    if pve_dr_vals:
        v = pve_dr_vals[0]
        out["pveReceivedDrPct"] = int(v) if float(v).is_integer() else v
    if unmapped:
        out["unmappedModifiers"] = unmapped

    return out


def list_saved_buffs() -> list[dict[str, Any]]:
    if not BUFFS_DIR.exists():
        return []
    buffs: list[dict[str, Any]] = []
    for path in sorted(BUFFS_DIR.glob("*.json")):
        if path.name.startswith("_") or not VALID_ID_RE.match(path.stem):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not data.get("id"):
                continue
            data["isCustom"] = True
            data.setdefault("filename", f"buffs/{path.name}")
            buffs.append(data)
        except (OSError, json.JSONDecodeError):
            continue
    return buffs


def _atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.stem}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def rebuild_buffs_index() -> list[str]:
    BUFFS_DIR.mkdir(parents=True, exist_ok=True)
    files = [
        p.name
        for p in sorted(BUFFS_DIR.glob("*.json"))
        if not p.name.startswith("_") and p.name != "loadouts.json" and VALID_ID_RE.match(p.stem)
    ]
    _atomic_write_json(BUFFS_DIR / "_index.json", {"files": files})
    return files


def save_custom_buff(mod: dict[str, Any]) -> dict[str, Any]:
    mod_id = slugify_buff_id(str(mod.get("id") or mod.get("name") or ""), None)
    if not VALID_ID_RE.match(mod_id) or mod_id in RESERVED_BUFF_IDS:
        raise ValueError(f"Invalid or reserved buff ID slug: {mod_id!r}")

    BUFFS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = (BUFFS_DIR / f"{mod_id}.json").resolve()
    if out_path.parent != BUFFS_DIR.resolve():
        raise ValueError("Invalid buff destination path")

    saved = dict(mod)
    saved["id"] = mod_id
    saved["isCustom"] = True
    saved["filename"] = f"buffs/{mod_id}.json"
    saved["savedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    _atomic_write_json(out_path, saved)
    rebuild_buffs_index()
    return saved


def delete_custom_buff(mod_id: str) -> bool:
    if not VALID_ID_RE.match(mod_id) or mod_id in RESERVED_BUFF_IDS:
        raise ValueError("Invalid or reserved buff ID")
    target = (BUFFS_DIR / f"{mod_id}.json").resolve()
    if target.parent != BUFFS_DIR.resolve():
        raise ValueError("Invalid buff path")
    if not target.exists():
        return False
    target.unlink()
    rebuild_buffs_index()
    return True


def fetch_and_convert_buff(
    raw_id_or_url: str | int,
    *,
    download_icon: bool = True,
    side_override: str | None = None,
    debuff_override: bool | None = None,
    name_override: str | None = None,
    custom_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Fetch an AA Classic buff by ID/URL, optionally download its icon, and return (mod, raw)."""
    buff_id = parse_buff_id(raw_id_or_url)
    raw = fetch_aac_buff_raw(buff_id)
    local_icon = download_aac_icon(raw.get("icon") or "") if download_icon else None
    mod = convert_aac_buff(
        raw,
        local_icon=local_icon,
        side_override=side_override,
        debuff_override=debuff_override,
        name_override=name_override,
        custom_id=custom_id,
    )
    return mod, raw


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Fetch AA Classic buffs by buff ID and import them into the Damage Simulator."
    )
    parser.add_argument(
        "buff_ids",
        nargs="+",
        help="One or more AA Classic buff IDs or URLs (e.g. 1668 6148 https://aa-classic.com/database/buffs/18169)",
    )
    parser.add_argument("--side", choices=["attacker", "defender", "both"], help="Override target side")
    parser.add_argument("--debuff", action="store_true", help="Force mark as debuff")
    parser.add_argument("--buff", action="store_true", help="Force mark as buff (not debuff)")
    parser.add_argument("--name", help="Override display name (when importing a single buff)")
    parser.add_argument("--id", dest="custom_id", help="Override saved modifier ID slug (single buff)")
    parser.add_argument("--no-icon", action="store_true", help="Skip downloading the buff icon locally")
    parser.add_argument("--dry-run", action="store_true", help="Print parsed JSON without saving to buffs/")
    args = parser.parse_args(argv)

    debuff_override: bool | None = None
    if args.debuff:
        debuff_override = True
    elif args.buff:
        debuff_override = False

    if len(args.buff_ids) > 1 and (args.name or args.custom_id):
        print("Warning: --name and --id apply only when importing a single buff.", file=sys.stderr)

    exit_code = 0
    for item in args.buff_ids:
        try:
            mod, raw = fetch_and_convert_buff(
                item,
                download_icon=not args.no_icon and not args.dry_run,
                side_override=args.side,
                debuff_override=debuff_override,
                name_override=args.name if len(args.buff_ids) == 1 else None,
                custom_id=args.custom_id if len(args.buff_ids) == 1 else None,
            )
            if args.dry_run:
                print(json.dumps(mod, indent=2, ensure_ascii=False))
            else:
                saved = save_custom_buff(mod)
                stat_keys = [
                    k
                    for k in ("addOffense", "mulOffense", "addDefense", "mulDefense", "addAttributes", "addMaxHealth", "pveDamageBonusPct")
                    if k in saved
                ]
                print(f"[OK] #{saved['aacBuffId']} {saved['name']} -> {saved['filename']} (side={saved['side']}, stats={stat_keys or ['none - tick/scripted']})")
                if saved.get("unmappedModifiers"):
                    print(f"     Unmapped utility stats: {', '.join(saved['unmappedModifiers'])}")
                if not stat_keys and not raw.get("modifiers"):
                    print("     Note: AA Classic buff has empty static modifiers (likely tick/scripted); edit the saved JSON to add custom stats.")
        except Exception as exc:
            print(f"[ERR] {item}: {exc}", file=sys.stderr)
            exit_code = 1

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
