#!/usr/bin/env python3
"""
Opt-in Auction House price scraper for ArcheAge Classic via sermeatball.com.

Fetches market price history summaries from:
    https://api.sermeatball.com/auction/market-items
    (backing https://sermeatball.com/auction/item-price-history)

Saves a compact snapshot to `<repo>/economy/ah_prices.json` and records sync
metadata in `<repo>/js/data/sync_status.json`. Never modifies the user's
manual overrides in `<repo>/economy/prices.json`.

Usage (manual CLI):
    python -B tools/economy_sync.py
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime
import json
import os
import tempfile
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

TOOLS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOLS_DIR.parent
ECONOMY_DIR = REPO_ROOT / "economy"
AH_PRICES_PATH = ECONOMY_DIR / "ah_prices.json"
BUILDS_DIR = REPO_ROOT / "builds"
GEAR_CATALOG_DIR = REPO_ROOT / "js" / "data" / "gear_catalog"
SYNC_STATUS_PATH = REPO_ROOT / "js" / "data" / "sync_status.json"

SERMEATBALL_API_BASE = "https://api.sermeatball.com"
SERMEATBALL_PAGE_URL = "https://sermeatball.com/auction/item-price-history"
MAX_REMOTE_BYTES = 8 * 1024 * 1024  # 8 MB safety cap per API page
PAGE_LIMIT = 200
MAX_PAGES_PER_CATEGORY = 30
REQUEST_TIMEOUT = 15

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AAC-DamageSim/1.0",
    "Accept": "application/json",
    "Origin": "https://sermeatball.com",
    "Referer": SERMEATBALL_PAGE_URL,
}

# Category IDs on api.sermeatball.com/auction/categories:
#   1 = Weapons, 2 = Armor, 3 = Accessories, 4 = Instruments, 5 = Costumes
#   12 = Lunagems, 13 = Lunadrops & Lunafrost
GEAR_CATEGORIES = (1, 2, 3, 4, 5)
GEM_CATEGORY = 12
FROST_CATEGORY = 13


def _atomic_write_json(path: Path, payload: object) -> None:
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


def _http_get_json(path: str, params: dict | None = None) -> object:
    url = SERMEATBALL_API_BASE + path
    if params:
        url += "?" + urlencode(params)
    req = Request(url, headers=HEADERS)
    try:
        with urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            raw = resp.read(MAX_REMOTE_BYTES + 1)
    except HTTPError as exc:
        raise RuntimeError(f"sermeatball.com returned HTTP {exc.code} for {path}") from exc
    except URLError as exc:
        raise RuntimeError(f"Failed to reach api.sermeatball.com: {exc.reason}") from exc
    if len(raw) > MAX_REMOTE_BYTES:
        raise RuntimeError(f"Remote response exceeded {MAX_REMOTE_BYTES} byte limit: {url}")
    return json.loads(raw.decode("utf-8"))


def _copper_to_gold(copper_val) -> int | None:
    if copper_val is None:
        return None
    try:
        num = float(copper_val)
    except (TypeError, ValueError):
        return None
    if num <= 0:
        return None
    gold = int(round(num / 10000.0))
    return gold if gold >= 1 else None


def _build_entry(row: dict) -> dict | None:
    """
    Convert a sermeatball.com market-items row (units in copper, 10000c = 1g)
    into a compact gold price entry, preferring 30-day average > 7-day average >
    latest > all-time average.
    """
    if not isinstance(row, dict):
        return None

    avg30 = _copper_to_gold(row.get("avg_30d_copper"))
    avg7 = _copper_to_gold(row.get("avg_7d_copper"))
    latest = _copper_to_gold(row.get("latest_copper"))
    all_time = _copper_to_gold(row.get("all_time_copper"))

    if avg30 is not None:
        gold, src = avg30, "30d"
    elif avg7 is not None:
        gold, src = avg7, "7d"
    elif latest is not None:
        gold, src = latest, "latest"
    elif all_time is not None:
        gold, src = all_time, "all_time"
    else:
        return None

    entry: dict = {"g": gold, "src": src}
    item_id = row.get("item_id")
    if isinstance(item_id, int) and item_id > 0:
        entry["id"] = item_id
    vol30 = row.get("volume_30d")
    if vol30 is not None:
        try:
            v_int = int(round(float(vol30)))
            if v_int > 0:
                entry["v30"] = v_int
        except (TypeError, ValueError):
            pass
    if latest is not None and latest != gold:
        entry["lat"] = latest
    if avg7 is not None and avg7 != gold:
        entry["a7"] = avg7
    return entry


def _fetch_priced_category(cat_id: int) -> list[dict]:
    """Paginate priced rows for a single sermeatball.com auction category."""
    rows: list[dict] = []
    offset = 0
    for _ in range(MAX_PAGES_PER_CATEGORY):
        page = _http_get_json(
            "/auction/market-items",
            {
                "category_id": cat_id,
                "sort": "latest",
                "direction": "desc",
                "limit": PAGE_LIMIT,
                "offset": offset,
            },
        )
        if not isinstance(page, dict):
            break
        batch = page.get("rows")
        if not isinstance(batch, list) or not batch:
            break

        priced_in_batch = 0
        for row in batch:
            if not isinstance(row, dict):
                continue
            if any(
                row.get(k) is not None and float(row.get(k) or 0) > 0
                for k in ("avg_30d_copper", "avg_7d_copper", "latest_copper", "all_time_copper")
            ):
                rows.append(row)
                priced_in_batch += 1

        # Sorted by latest desc: once latest_copper is null and no priced rows appear, remaining rows are vendor/unpriced.
        if batch[-1].get("latest_copper") is None and priced_in_batch == 0:
            break

        offset += len(batch)
        total = int(page.get("total") or 0)
        if offset >= total:
            break
    return rows


def _count_saved_build_matches(items_map: dict, gems_map: dict, frosts_map: dict) -> dict:
    item_lower = {k.lower() for k in items_map}
    gem_lower = {k.lower() for k in gems_map}
    frost_lower = {k.lower() for k in frosts_map}

    build_items: set[str] = set()
    build_gems: set[str] = set()
    build_frosts: set[str] = set()

    if BUILDS_DIR.exists():
        for p in BUILDS_DIR.glob("*.json"):
            if p.name.startswith("_"):
                continue
            try:
                b = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(b, dict):
                continue
            for eq in (b.get("equipment") or []):
                if not isinstance(eq, dict):
                    continue
                if eq.get("slotId") == 19 or str(eq.get("slotName") or "").strip().lower() == "glider":
                    continue
                nm = str(eq.get("name") or "").strip()
                if nm:
                    build_items.add(nm.lower())
                for g in (eq.get("lunagems") or []):
                    if isinstance(g, dict) and g.get("name"):
                        build_gems.add(str(g["name"]).strip().lower())
                lf = eq.get("lunafrost")
                if isinstance(lf, dict) and lf.get("name"):
                    build_frosts.add(str(lf["name"]).strip().lower())

    return {
        "buildsMatchedItems": len(build_items & item_lower),
        "buildsTotalItems": len(build_items),
        "buildsMatchedGems": len(build_gems & gem_lower),
        "buildsTotalGems": len(build_gems),
        "buildsMatchedFrosts": len(build_frosts & frost_lower),
        "buildsTotalFrosts": len(build_frosts),
    }


def _record_sync_status(synced_at: str, counts: dict) -> None:
    status = {}
    if SYNC_STATUS_PATH.exists():
        try:
            loaded = json.loads(SYNC_STATUS_PATH.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                status = loaded
        except Exception:
            status = {}
    status["economy"] = {
        "source": "sermeatball.com",
        "sourceUrl": SERMEATBALL_PAGE_URL,
        "syncedAt": synced_at,
        "counts": counts,
    }
    _atomic_write_json(SYNC_STATUS_PATH, status)


def read_ah_prices_snapshot() -> dict | None:
    if not AH_PRICES_PATH.exists():
        return None
    try:
        data = json.loads(AH_PRICES_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def sync_economy_prices() -> dict:
    """
    Scrape current Auction House price history summaries from sermeatball.com
    for gear, lunagems, and lunafrosts, and persist to economy/ah_prices.json.
    """
    cat_ids = list(GEAR_CATEGORIES) + [GEM_CATEGORY, FROST_CATEGORY]
    raw_by_cat: dict[int, list[dict]] = {}

    with ThreadPoolExecutor(max_workers=3) as pool:
        futs = {pool.submit(_fetch_priced_category, cid): cid for cid in cat_ids}
        for fut in as_completed(futs):
            cid = futs[fut]
            raw_by_cat[cid] = fut.result()

    items_map: dict[str, dict] = {}
    gems_map: dict[str, dict] = {}
    frosts_map: dict[str, dict] = {}

    def _insert(target: dict, name: str, entry: dict) -> None:
        existing = target.get(name)
        if existing is None or (entry.get("v30", 0) > existing.get("v30", 0)):
            target[name] = entry

    for cid in GEAR_CATEGORIES:
        for row in raw_by_cat.get(cid, []):
            name = str(row.get("item_name") or "").strip()
            if not name:
                continue
            entry = _build_entry(row)
            if entry:
                _insert(items_map, name, entry)

    for row in raw_by_cat.get(GEM_CATEGORY, []):
        name = str(row.get("item_name") or "").strip()
        if not name:
            continue
        entry = _build_entry(row)
        if entry:
            _insert(gems_map, name, entry)

    for row in raw_by_cat.get(FROST_CATEGORY, []):
        name = str(row.get("item_name") or "").strip()
        if not name:
            continue
        entry = _build_entry(row)
        if entry:
            _insert(frosts_map, name, entry)

    synced_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    build_matches = _count_saved_build_matches(items_map, gems_map, frosts_map)
    counts = {
        "items": len(items_map),
        "gems": len(gems_map),
        "frosts": len(frosts_map),
        "total": len(items_map) + len(gems_map) + len(frosts_map),
        **build_matches,
    }

    snapshot = {
        "schemaVersion": 1,
        "source": "sermeatball.com",
        "sourceUrl": SERMEATBALL_PAGE_URL,
        "syncedAt": synced_at,
        "counts": counts,
        "gems": dict(sorted(gems_map.items())),
        "frosts": dict(sorted(frosts_map.items())),
        "items": dict(sorted(items_map.items())),
    }

    _atomic_write_json(AH_PRICES_PATH, snapshot)
    _record_sync_status(synced_at, counts)

    return {
        "ok": True,
        "source": "sermeatball.com",
        "filename": "economy/ah_prices.json",
        "syncedAt": synced_at,
        "counts": counts,
    }


def main() -> None:
    res = sync_economy_prices()
    c = res["counts"]
    print(
        f"Synced {c['total']:,} AH prices from {res['source']} -> {res['filename']} "
        f"({c['items']:,} gear, {c['gems']} lunagems, {c['frosts']} lunafrosts)."
    )
    print(
        f"Saved builds coverage: "
        f"{c['buildsMatchedItems']}/{c['buildsTotalItems']} gear items, "
        f"{c['buildsMatchedGems']}/{c['buildsTotalGems']} lunagems, "
        f"{c['buildsMatchedFrosts']}/{c['buildsTotalFrosts']} lunafrosts."
    )


if __name__ == "__main__":
    main()
