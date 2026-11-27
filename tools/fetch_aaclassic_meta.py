#!/usr/bin/env python3
"""
Fetch public static skill metadata (cooldowns, cast times, unlock levels,
and applied buff rank metadata) from https://aa-classic.com/data/skills/<id>.json
for all canonical skill IDs in tools/skill_catalog.json, and save to
tools/aaclassic_meta.json for offline/reproducible parsing.
"""

from __future__ import annotations

import concurrent.futures
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "tools" / "skill_catalog.json"
OUT_PATH = ROOT / "tools" / "aaclassic_meta.json"
BASE_URL = "https://aa-classic.com/data/skills/{sid}.json"
MAX_META_BYTES = 2 * 1024 * 1024
ALLOWED_META_HOSTS = {"aa-classic.com", "www.aa-classic.com"}


class _SafeMetaRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        p = urllib.parse.urlparse(newurl)
        if p.scheme.lower() != "https" or (p.hostname or "").lower() not in ALLOWED_META_HOSTS:
            raise ValueError(f"Blocked redirect to untrusted host: {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_SAFE_META_OPENER = urllib.request.build_opener(_SafeMetaRedirectHandler())


def fetch_one(sid: int) -> tuple[int, dict[str, Any] | None]:
    url = BASE_URL.format(sid=sid)
    req = urllib.request.Request(url, headers={"User-Agent": "damage-sim-meta-fetcher/1.0"})
    try:
        with _SAFE_META_OPENER.open(req, timeout=15) as resp:
            if resp.status != 200:
                return sid, None
            raw = resp.read(MAX_META_BYTES + 1)
            if len(raw) > MAX_META_BYTES:
                return sid, None
            data = json.loads(raw.decode("utf-8"))
            return sid, {
                "id": data.get("id", sid),
                "name": data.get("name"),
                "ability": data.get("ability"),
                "abilityLevel": data.get("ability_level"),
                "cooldownMs": data.get("cooldown_time") or 0,
                "cooldownText": data.get("cooldown_text"),
                "castTimeMs": data.get("casting_time") or 0,
                "castTimeText": data.get("casting_text"),
                "icon": data.get("icon"),
                "appliedBuffs": [
                    {
                        "buffId": b.get("buff_id"),
                        "name": b.get("name"),
                        "kind": b.get("kind"),
                        "durationMs": b.get("duration") or 0,
                        "description": b.get("description") or "",
                    }
                    for b in (data.get("applied_buffs") or [])
                ],
            }
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return sid, None


def main() -> None:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    sids: set[int] = set()
    for spec in catalog["skills"]:
        if "skillId" in spec:
            sids.add(int(spec["skillId"]))
        for h in spec.get("hits", []):
            sids.add(int(h["skillId"]))

    ordered_ids = sorted(sids)
    results: dict[str, dict[str, Any]] = {}
    missing: list[int] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        for sid, meta in pool.map(fetch_one, ordered_ids):
            if meta is not None:
                results[str(sid)] = meta
            else:
                missing.append(sid)

    payload = {
        "source": "https://aa-classic.com/data/skills/<id>.json",
        "fetchedCount": len(results),
        "missingIds": missing,
        "skills": results,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Fetched metadata for {len(results)}/{len(ordered_ids)} skill IDs (missing: {len(missing)}).")

    # Report any skills with hidden rank-tooltip buffs
    multi_buff_skills = []
    for sid_str, meta in results.items():
        hidden_rank_buffs = [
            b for b in meta["appliedBuffs"]
            if b.get("kind") == "hidden" and b.get("description")
        ]
        if len(hidden_rank_buffs) >= 2:
            multi_buff_skills.append((sid_str, meta["name"], len(hidden_rank_buffs)))
    print(f"Skills with >=2 hidden tooltip buffs: {len(multi_buff_skills)}")
    for row in multi_buff_skills:
        print(" ", row)


if __name__ == "__main__":
    main()
