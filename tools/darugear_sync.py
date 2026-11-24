#!/usr/bin/env python3
"""
Live DaruGear resync helpers for the ArcheAge Classic Skill Simulator:
  - Auto-detects the latest DaruGear extract_dump version (e.g. v35)
  - Downloads and compiles the complete 20-slot Gear Catalog (items, gems, frosts,
    synthesis pools, set effects, equipment buffs, and titles)
  - Downloads and merges Skill Builder data (actives, passives, classes) while
    preserving local AA Classic Ancestral variants and simulator effect mappings
  - Tracks sync status & timestamps in js/data/sync_status.json
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import datetime
import json
import os
import re
import tempfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

MAX_CSV_BYTES = 25 * 1024 * 1024  # 25 MB safety cap per remote CSV/bundle

import build_gear_catalog

TOOLS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOLS_DIR.parent
CACHE_ROOT = TOOLS_DIR / "darugear_cache"
GEAR_OUT_DIR = REPO_ROOT / "js" / "data" / "gear_catalog"
SKILL_BUILDER_PATH = REPO_ROOT / "js" / "data" / "skill_builder_data.json"
SYNC_STATUS_PATH = REPO_ROOT / "js" / "data" / "sync_status.json"
ICONS_DIR = REPO_ROOT / "assets" / "icons"
BUILDS_DIR = REPO_ROOT / "builds"

DEFAULT_VERSION = "v35"
USER_AGENT = "AAC-DamageSim/1.0"

GEAR_CSV_FILES = [
    "Weapon_2.csv",
    "armor.csv",
    "accessory_2.csv",
    "gliders.csv",
    "equip_effect.csv",
    "set_effect.csv",
    "synth.csv",
    "Lunafrost.csv",
    "data_gems2.csv",
    "titles.csv",
    "equipment_buffs.csv",
]

SKILL_CSV_FILES = [
    "skills_active.csv",
    "skills_passive.csv",
    "skills_classes.csv",
]

TREE_ID_TO_SLUG = {
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
}


def _http_get_bytes(url: str, timeout: int = 20, max_bytes: int = MAX_CSV_BYTES) -> bytes:
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urlopen(req, timeout=timeout) as resp:
        data = resp.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise RuntimeError(f"Remote response exceeded {max_bytes} byte safety limit: {url}")
    return data


def _clean_aa_text(raw: str) -> str:
    if not raw:
        return ""
    s = str(raw)
    s = re.sub(r"\|c[0-9a-fA-F]{6,8}", "", s)
    s = re.sub(r"\|[a-zA-Z]{1,3};?", "", s)
    s = re.sub(r"#\{[^}]+\}", "", s)
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()


def _resolve_icon(raw_fn: str) -> str:
    if not raw_fn:
        return ""
    png = str(raw_fn).replace("\\", "/").replace(".dds", ".png").lstrip("/")
    if (ICONS_DIR / png).exists():
        return "assets/icons/" + png
    return f"https://darugear.com/assets/icons/{png}"


def _slugify_key(tree_slug: str, name: str) -> str:
    clean = re.sub(r"[^a-z0-9]+", "_", (name or "").strip().lower()).strip("_")
    return f"{tree_slug}_{clean}" if clean else tree_slug


def _read_sync_status() -> dict:
    if SYNC_STATUS_PATH.exists():
        try:
            data = json.loads(SYNC_STATUS_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    return {}


def _write_sync_status(status: dict) -> None:
    SYNC_STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(status, indent=2, ensure_ascii=False) + "\n"
    fd, tmp_name = tempfile.mkstemp(dir=str(SYNC_STATUS_PATH.parent), prefix=".sync_status.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp_name, SYNC_STATUS_PATH)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def detect_latest_darugear_version() -> str:
    """Inspect https://darugear.com/ bundle for the active vXX extract_dump path."""
    try:
        html = _http_get_bytes("https://darugear.com/", timeout=10).decode("utf-8", errors="ignore")
        m_js = re.search(r'src="(main-[A-Za-z0-9_-]+\.js)"', html)
        if m_js:
            js_txt = _http_get_bytes(f"https://darugear.com/{m_js.group(1)}", timeout=15).decode(
                "utf-8", errors="ignore"
            )
            versions = re.findall(r"extract_dump/(v\d+)/", js_txt)
            if versions:
                # Pick highest numeric version (e.g. v35 > v30)
                versions.sort(key=lambda v: int(v[1:]), reverse=True)
                return versions[0]
    except Exception:
        pass
    return DEFAULT_VERSION


def _download_csv_batch(version: str, filenames: list[str]) -> Path:
    cache_dir = CACHE_ROOT / version
    cache_dir.mkdir(parents=True, exist_ok=True)

    # Some CSVs (data_gems2.csv, skills_active.csv, skills_passive.csv, skills_classes.csv)
    # live at /assets/extract_dump/<fn> rather than /assets/extract_dump/<version>/<fn>.
    # Try versioned path first so future patch overrides win, then fall back to root extract_dump/.
    def fetch_one(fn: str):
        candidates = [
            f"https://darugear.com/assets/extract_dump/{version}/{fn}",
            f"https://darugear.com/assets/extract_dump/{fn}",
        ]
        last_err = None
        for url in candidates:
            try:
                data = _http_get_bytes(url, timeout=25)
                if not data or len(data) < 20:
                    raise RuntimeError(f"Empty response downloading {url}")
                fd, tmp_name = tempfile.mkstemp(dir=str(cache_dir), prefix=f".{fn}.", suffix=".tmp")
                try:
                    with os.fdopen(fd, "wb") as fh:
                        fh.write(data)
                    os.replace(tmp_name, cache_dir / fn)
                except Exception:
                    try:
                        os.unlink(tmp_name)
                    except OSError:
                        pass
                    raise
                return fn, len(data), url
            except HTTPError as exc:
                last_err = exc
                if exc.code == 404:
                    continue
                raise
            except Exception as exc:
                last_err = exc
                raise
        raise RuntimeError(f"{last_err or 'HTTP 404'} (tried {candidates[0]} and {candidates[1]})")

    errors = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(fetch_one, fn): fn for fn in filenames}
        for fut in as_completed(futs):
            fn = futs[fut]
            try:
                fut.result()
            except Exception as exc:
                errors.append(f"{fn}: {exc}")
    if errors:
        raise RuntimeError("Failed downloading DaruGear CSV(s): " + "; ".join(errors))
    return cache_dir


def sync_gear_catalog(version: str | None = None) -> dict:
    ver = (version or "").strip() or detect_latest_darugear_version()
    if not re.match(r"^v\d+$", ver):
        raise ValueError(f"Invalid DaruGear version tag: {ver!r}")

    cache_dir = _download_csv_batch(ver, GEAR_CSV_FILES)
    counts = build_gear_catalog.compile_gear_catalog(
        dl_dir=cache_dir,
        out_dir=GEAR_OUT_DIR,
        icons_dir=ICONS_DIR,
    )
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    status = _read_sync_status()
    status["gearCatalog"] = {
        "version": ver,
        "syncedAt": now_iso,
        "counts": counts,
    }
    _write_sync_status(status)
    return {
        "ok": True,
        "version": ver,
        "syncedAt": now_iso,
        "counts": counts,
    }


def sync_skills(version: str | None = None) -> dict:
    ver = (version or "").strip() or detect_latest_darugear_version()
    if not re.match(r"^v\d+$", ver):
        raise ValueError(f"Invalid DaruGear version tag: {ver!r}")

    cache_dir = _download_csv_batch(ver, SKILL_CSV_FILES)

    # Load existing skill_builder_data.json to preserve local Ancestral variants, simSkillId links, & passive mappings
    existing = {}
    if SKILL_BUILDER_PATH.exists():
        try:
            existing = json.loads(SKILL_BUILDER_PATH.read_text(encoding="utf-8"))
        except Exception:
            existing = {}

    existing_trees = existing.get("trees") if isinstance(existing.get("trees"), dict) else {}

    # Index existing actives & passives by (tree_slug, normalized_name)
    ex_actives_by_tree = {}
    ex_passives_by_tree = {}
    for slug, t_obj in existing_trees.items():
        act_map = {}
        for a in list(t_obj.get("actives") or []) + list(t_obj.get("hatredActives") or []):
            act_map[str(a.get("name") or "").strip().lower()] = a
        ex_actives_by_tree[slug] = act_map

        pas_map = {}
        for p in list(t_obj.get("passives") or []) + list(t_obj.get("hatredPassives") or []):
            pas_map[str(p.get("name") or "").strip().lower()] = p
        ex_passives_by_tree[slug] = pas_map

    # Parse skills_classes.csv (keeps DaruGear's "name_1_4_8" keys expected by skillbuilder.js)
    classes_map = {}
    with open(cache_dir / "skills_classes.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            k = (r.get("key") or "").strip()
            nm = (r.get("class_name") or "").strip()
            if k and nm:
                classes_map[k] = nm

    # Parse skills_active.csv (ability_id 1..10; skill_points > 0 = 12 base actives, skill_points == 0 = 3 hatred actives)
    new_actives = {slug: [] for slug in TREE_ID_TO_SLUG.values()}
    new_hatred_actives = {slug: [] for slug in TREE_ID_TO_SLUG.values()}
    with open(cache_dir / "skills_active.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            aid = int(float(r.get("ability_id") or 0))
            lvl = int(float(r.get("ability_level") or 1))
            pts = int(float(r.get("skill_points") or 0))
            name = (r.get("skill_name") or "").strip()
            slug = TREE_ID_TO_SLUG.get(aid)
            if not name or not slug:
                continue
            is_hatred = pts == 0

            prev = ex_actives_by_tree.get(slug, {}).get(name.lower())
            entry = {
                "key": (prev.get("key") if prev else None) or _slugify_key(slug, name),
                "name": name,
                "level": lvl,
                "points": pts,
                "icon": _resolve_icon(r.get("icon_filename") or ""),
                "desc": _clean_aa_text(r.get("skill_desc") or ""),
            }
            if prev:
                for keep_k in ("simSkillId", "ancestrals"):
                    if keep_k in prev:
                        entry[keep_k] = prev[keep_k]
            if is_hatred:
                new_hatred_actives[slug].append(entry)
            else:
                new_actives[slug].append(entry)

    # Parse skills_passive.csv (ability_id 1..10 only — skip >10 racial passives; skill_points > 0 = 7 normal, 0 = 1 hatred)
    new_passives = {slug: [] for slug in TREE_ID_TO_SLUG.values()}
    new_hatred_passives = {slug: [] for slug in TREE_ID_TO_SLUG.values()}
    with open(cache_dir / "skills_passive.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            aid = int(float(r.get("ability_id") or 0))
            req_pts = int(float(r.get("req_points") or 0))
            pts = int(float(r.get("skill_points") or 0))
            name = (r.get("name") or "").strip()
            slug = TREE_ID_TO_SLUG.get(aid)
            if not name or not slug:
                continue
            is_hatred = pts == 0

            raw_data = []
            try:
                parsed_d = json.loads(r.get("data") or "[]")
                if isinstance(parsed_d, list):
                    raw_data = parsed_d
            except Exception:
                raw_data = []

            prev = ex_passives_by_tree.get(slug, {}).get(name.lower())
            desc_parts = [_clean_aa_text(d.get("buff_name") or "") for d in raw_data if isinstance(d, dict) and d.get("buff_name")]
            desc_txt = " ".join(dict.fromkeys(p for p in desc_parts if p))

            entry = dict(prev) if isinstance(prev, dict) else {}
            entry["key"] = entry.get("key") or _slugify_key(slug, name)
            entry["name"] = name
            entry["reqPoints"] = req_pts
            entry["points"] = pts
            entry["buffId"] = int(float(r.get("buff_id") or 0))
            entry["icon"] = _resolve_icon(r.get("icon") or "")
            if desc_txt:
                entry["desc"] = desc_txt
            elif "desc" not in entry:
                entry["desc"] = ""
            if raw_data:
                entry["buffData"] = [
                    {
                        "unit_attribute_id": int(d["unit_attribute_id"]),
                        "value": d["value"],
                    }
                    for d in raw_data
                    if isinstance(d, dict) and d.get("unit_attribute_id") is not None and d.get("value") is not None
                ]

            if is_hatred:
                new_hatred_passives[slug].append(entry)
            else:
                new_passives[slug].append(entry)

    # Assemble updated skill_builder_data.json
    trees_out = {}
    total_actives = 0
    total_passives = 0
    total_ancestrals = 0
    for tid, slug in TREE_ID_TO_SLUG.items():
        prev_tree = existing_trees.get(slug, {})
        acts = sorted(new_actives[slug], key=lambda x: (x["level"], x["name"]))
        h_acts = sorted(new_hatred_actives[slug], key=lambda x: (x["level"], x["name"]))
        passives = sorted(new_passives[slug], key=lambda x: (x["reqPoints"], x["name"]))
        h_passives = sorted(new_hatred_passives[slug], key=lambda x: (x["reqPoints"], x["name"]))

        total_actives += len(acts) + len(h_acts)
        total_passives += len(passives) + len(h_passives)
        for a in acts:
            total_ancestrals += len(a.get("ancestrals") or [])

        trees_out[slug] = {
            "id": tid,
            "slug": slug,
            "name": prev_tree.get("name") or slug.capitalize(),
            "actives": acts,
            "passives": passives,
            "hatredActives": h_acts if h_acts else (prev_tree.get("hatredActives") or []),
            "hatredPassives": h_passives if h_passives else (prev_tree.get("hatredPassives") or []),
        }

    out_doc = {
        "version": existing.get("version", 1),
        "maxSkillPoints": existing.get("maxSkillPoints", 28),
        "treeOrder": existing.get("treeOrder") or list(TREE_ID_TO_SLUG.values()),
        "trees": trees_out,
        "classes": classes_map,
    }

    SKILL_BUILDER_PATH.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(out_doc, indent=2, ensure_ascii=False) + "\n"
    fd, tmp_name = tempfile.mkstemp(dir=str(SKILL_BUILDER_PATH.parent), prefix=".skill_builder_data.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp_name, SKILL_BUILDER_PATH)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise

    counts = {
        "trees": len(trees_out),
        "actives": total_actives,
        "passives": total_passives,
        "ancestrals": total_ancestrals,
        "classes": len(classes_map),
    }
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    status = _read_sync_status()
    status["skills"] = {
        "version": ver,
        "syncedAt": now_iso,
        "counts": counts,
    }
    _write_sync_status(status)
    return {
        "ok": True,
        "version": ver,
        "syncedAt": now_iso,
        "counts": counts,
    }


def get_sync_status() -> dict:
    status = _read_sync_status()

    # Live inspect local gear catalog counts
    gear_counts = {}
    meta_p = GEAR_OUT_DIR / "meta.json"
    if meta_p.exists():
        try:
            m = json.loads(meta_p.read_text(encoding="utf-8"))
            w_cnt = len(json.loads((GEAR_OUT_DIR / "items_weapons.json").read_text(encoding="utf-8")))
            a_cnt = len(json.loads((GEAR_OUT_DIR / "items_armor.json").read_text(encoding="utf-8")))
            ac_cnt = len(json.loads((GEAR_OUT_DIR / "items_acc.json").read_text(encoding="utf-8")))
            gear_counts = {
                "weapons": w_cnt,
                "armors": a_cnt,
                "accessories": ac_cnt,
                "totalItems": w_cnt + a_cnt + ac_cnt,
                "lunagems": len(m.get("lunagems") or []),
                "lunafrosts": len(m.get("lunafrosts") or []),
                "titles": len(m.get("titles") or []),
                "equipmentBuffs": len(m.get("equipmentBuffs") or []),
            }
        except Exception:
            pass

    # Live inspect local skill builder counts
    skill_counts = {}
    if SKILL_BUILDER_PATH.exists():
        try:
            sb = json.loads(SKILL_BUILDER_PATH.read_text(encoding="utf-8"))
            trees = sb.get("trees") or {}
            a_tot = 0
            p_tot = 0
            anc_tot = 0
            for t_obj in trees.values():
                acts = list(t_obj.get("actives") or []) + list(t_obj.get("hatredActives") or [])
                pas = list(t_obj.get("passives") or []) + list(t_obj.get("hatredPassives") or [])
                a_tot += len(acts)
                p_tot += len(pas)
                for a in acts:
                    anc_tot += len(a.get("ancestrals") or [])
            skill_counts = {
                "trees": len(trees),
                "actives": a_tot,
                "passives": p_tot,
                "ancestrals": anc_tot,
                "classes": len(sb.get("classes") or sb.get("classNames") or {}),
            }
        except Exception:
            pass

    # Count saved builds with DaruGear share codes
    total_builds = 0
    syncable_builds = 0
    if BUILDS_DIR.exists():
        for p in BUILDS_DIR.glob("*.json"):
            if p.name.startswith("_"):
                continue
            try:
                b = json.loads(p.read_text(encoding="utf-8"))
                if not isinstance(b, dict):
                    continue
                total_builds += 1
                code = b.get("shareCode") or (b.get("metadata") or {}).get("shareCode")
                url = b.get("darugearUrl") or b.get("shareUrl") or (b.get("metadata") or {}).get("darugearUrl")
                if code or (isinstance(url, str) and "darugear.com" in url):
                    syncable_builds += 1
            except Exception:
                continue

    econ_status = status.get("economy") or {}
    econ_counts = econ_status.get("counts") or {}
    econ_synced_at = econ_status.get("syncedAt")
    ah_file = REPO_ROOT / "economy" / "ah_prices.json"
    if ah_file.exists():
        try:
            ah_data = json.loads(ah_file.read_text(encoding="utf-8"))
            if isinstance(ah_data, dict):
                if isinstance(ah_data.get("counts"), dict):
                    econ_counts = ah_data["counts"]
                if ah_data.get("syncedAt"):
                    econ_synced_at = ah_data["syncedAt"]
        except Exception:
            pass

    return {
        "ok": True,
        "defaultVersion": DEFAULT_VERSION,
        "gearCatalog": {
            "version": (status.get("gearCatalog") or {}).get("version", DEFAULT_VERSION),
            "syncedAt": (status.get("gearCatalog") or {}).get("syncedAt"),
            "counts": gear_counts,
        },
        "skills": {
            "version": (status.get("skills") or {}).get("version", DEFAULT_VERSION),
            "syncedAt": (status.get("skills") or {}).get("syncedAt"),
            "counts": skill_counts,
        },
        "builds": {
            "total": total_builds,
            "syncable": syncable_builds,
            "syncedAt": (status.get("builds") or {}).get("syncedAt"),
        },
        "economy": {
            "source": econ_status.get("source") or "sermeatball.com",
            "syncedAt": econ_synced_at,
            "counts": econ_counts,
        },
    }


def record_builds_synced(updated_count: int, total_count: int) -> dict:
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    status = _read_sync_status()
    status["builds"] = {
        "syncedAt": now_iso,
        "updated": int(updated_count),
        "total": int(total_count),
    }
    _write_sync_status(status)
    return status["builds"]
