#!/usr/bin/env python3
"""
Local static server + JSON build persistence for the ArcheAge Classic Damage Simulator.

Drop-in replacement for `python -m http.server 8765 --bind 127.0.0.1` that also
exposes a localhost-only API to save, list, and delete imported/custom builds
directly as JSON files inside `<repo>/builds/`.

Usage:
    python tools/serve.py
    python tools/serve.py --port 8765
"""

import argparse
import datetime
import json
import os
import re
import sys
import tempfile
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import darugear_sync  # noqa: E402
import economy_sync  # noqa: E402
import import_buff  # noqa: E402

REPO_ROOT = TOOLS_DIR.parent
BUILDS_DIR = REPO_ROOT / "builds"
GEAR_TEMPLATES_FILE = BUILDS_DIR / "gear-templates.json"
SKILL_BUILDS_FILE = BUILDS_DIR / "skill-builds.json"
NON_CHARACTER_BUILD_FILES = {GEAR_TEMPLATES_FILE.name, SKILL_BUILDS_FILE.name}
EXAMPLE_BUILDS_DIR = REPO_ROOT / "example-builds"
COMBOS_FILE = REPO_ROOT / "combos" / "combos.json"
BUFF_LOADOUTS_FILE = REPO_ROOT / "buffs" / "loadouts.json"
ECONOMY_PRICES_FILE = REPO_ROOT / "economy" / "prices.json"
MAX_BODY_BYTES = 512 * 1024  # 512 KB cap per JSON payload
MAX_REMOTE_JSON_BYTES = 2 * 1024 * 1024  # 2 MB cap on remote DaruGear responses
MAX_ICON_CACHE_BATCH = 60
VALID_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,79}$")
ALLOWED_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
BLOCKED_STATIC_TOP_DIRS = {"tools", ".git"}
ALLOWED_REMOTE_API_HOSTS = {"154smechk6.execute-api.ap-southeast-2.amazonaws.com"}
TRUSTED_ICON_HOSTS = {"darugear.com", "www.darugear.com", "aa-classic.com", "www.aa-classic.com"}


class _SafeHttpsRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlparse(newurl)
        if parsed.scheme.lower() != "https" or (parsed.hostname or "").lower() not in ALLOWED_REMOTE_API_HOSTS:
            raise ValueError(f"Blocked redirect to untrusted target: {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_SAFE_OPENER = build_opener(_SafeHttpsRedirectHandler())


def _sanitize_icon_url(raw: str) -> str | None:
    s = str(raw or "").replace("\\", "/").strip()
    if not s or ".." in s.split("/"):
        return None
    if s.startswith("assets/"):
        return s
    if s.lower().startswith("https://"):
        parsed = urlparse(s)
        if parsed.scheme.lower() == "https" and (parsed.hostname or "").lower() in TRUSTED_ICON_HOSTS:
            return s
    return None


def slugify_build_id(raw: str) -> str:
    s = re.sub(r"[^a-z0-9_-]+", "-", (raw or "").strip().lower())
    s = re.sub(r"-{2,}", "-", s).strip("-_")
    if not s:
        s = "build-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
    return s[:80]


def atomic_write_json(path: Path, payload: object) -> None:
    """Atomically write JSON using a unique temp file to prevent concurrent-request collisions."""
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


def rebuild_builds_index() -> list[str]:
    """Keep builds/_index.json in sync for static hosts (e.g. GitHub Pages)."""
    BUILDS_DIR.mkdir(parents=True, exist_ok=True)
    files = [
        p.name
        for p in sorted(BUILDS_DIR.glob("*.json"))
        if not p.name.startswith("_") and p.name not in NON_CHARACTER_BUILD_FILES and VALID_ID_RE.match(p.stem)
    ]
    atomic_write_json(BUILDS_DIR / "_index.json", {"files": files})
    return files


def _load_builds_from_dir(target_dir: Path, rel_prefix: str, *, is_example: bool = False) -> list[dict]:
    if not target_dir.exists():
        return []
    builds = []
    for path in sorted(target_dir.glob("*.json")):
        if path.name in NON_CHARACTER_BUILD_FILES or not VALID_ID_RE.match(path.stem):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                continue
            data.setdefault("savedId", path.stem)
            data.setdefault("filename", f"{rel_prefix}/{path.name}")
            if is_example:
                data.setdefault("isExample", True)
            if "savedAt" not in data:
                mtime = datetime.datetime.fromtimestamp(
                    path.stat().st_mtime, tz=datetime.timezone.utc
                )
                data["savedAt"] = mtime.isoformat()
            builds.append(data)
        except (OSError, json.JSONDecodeError):
            continue
    builds.sort(key=lambda b: str(b.get("savedAt", "")), reverse=True)
    return builds


def list_saved_builds() -> list[dict]:
    personal = _load_builds_from_dir(BUILDS_DIR, "builds")
    if personal:
        return personal
    return _load_builds_from_dir(EXAMPLE_BUILDS_DIR, "example-builds", is_example=True)


def _extract_host_and_port(host_header: str) -> tuple[str, int | None]:
    raw = (host_header or "").strip().lower()
    if not raw:
        return "", None
    if raw.startswith("["):
        end = raw.find("]")
        if end == -1:
            return "", None
        host = raw[1:end]
        rest = raw[end + 1 :]
        if rest.startswith(":"):
            try:
                return host, int(rest[1:])
            except ValueError:
                return "", None
        return host, None
    if ":" in raw:
        host, port_str = raw.rsplit(":", 1)
        try:
            return host, int(port_str)
        except ValueError:
            return "", None
    return raw, None


def _is_blocked_static_path(url_path: str, resolved_path: Path | None = None) -> bool:
    clean = unquote(url_path or "").replace("\\", "/")
    parts = [p for p in clean.split("/") if p]
    if parts:
        # Strip trailing dots/spaces (Windows NTFS silently strips them on open)
        first = parts[0].rstrip(". ").lower()
        if first in BLOCKED_STATIC_TOP_DIRS:
            return True
        if any(p.startswith(".") or p.rstrip(". ").lower() in BLOCKED_STATIC_TOP_DIRS for p in parts):
            return True
    if resolved_path is not None:
        try:
            rp = resolved_path.resolve()
            root = REPO_ROOT.resolve()
            if root not in rp.parents and rp != root:
                return True
            for blocked_dir in BLOCKED_STATIC_TOP_DIRS:
                bd = (root / blocked_dir).resolve()
                if rp == bd or bd in rp.parents:
                    return True
        except OSError:
            return True
    return False


APP_CSP_POLICY = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' https://darugear.com https://aa-classic.com; "
    "connect-src 'self' https://154smechk6.execute-api.ap-southeast-2.amazonaws.com; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'none'"
)
TEST_RUNNER_CSP_POLICY = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'none'"
)


class SimRequestHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".svg": "image/svg+xml",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(REPO_ROOT), **kwargs)

    def end_headers(self):
        path_lower = urlparse(self.path).path.lower()
        if not path_lower.startswith("/api/") and (
            path_lower in ("/", "/version")
            or path_lower.endswith((".html", ".js", ".mjs", ".css", ".json", ".md"))
        ):
            self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        if path_lower == "/" or path_lower.endswith(".html"):
            csp = TEST_RUNNER_CSP_POLICY if path_lower == "/tests/run-tests.html" else APP_CSP_POLICY
            self.send_header("Content-Security-Policy", csp)
        super().end_headers()

    def list_directory(self, path):
        self.send_error(HTTPStatus.FORBIDDEN, "Directory listing is disabled")
        return None

    def _send_json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _check_host_allowed(self) -> bool:
        """Prevent DNS rebinding by requiring a valid local Host header matching this server's port."""
        host_hdr = (self.headers.get("Host") or "").strip()
        if not host_hdr:
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "Missing Host header"})
            return False
        hostname, port = _extract_host_and_port(host_hdr)
        if hostname not in ALLOWED_LOCAL_HOSTS:
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "Forbidden Host header"})
            return False
        server_port = getattr(self.server, "server_port", None)
        if server_port is not None:
            effective_port = port if port is not None else 80
            if effective_port != server_port:
                self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "Forbidden Host port"})
                return False
        return True

    def _check_same_origin_mutation(self, *, require_json: bool = False) -> bool:
        """
        Block cross-origin and cross-port localhost CSRF:
        - Reject missing or DNS-rebound Host headers
        - Reject cross-site AND same-site (cross-port localhost) Sec-Fetch-Site headers
        - Require Origin (when present) to match allowed local host AND exact server port
        - Require Content-Type: application/json on POST routes (blocks text/plain simple requests)
        """
        if not self._check_host_allowed():
            return False

        sec_fetch_site = (self.headers.get("Sec-Fetch-Site") or "").strip().lower()
        if sec_fetch_site and sec_fetch_site not in ("same-origin", "none"):
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "Cross-origin requests are not allowed"})
            return False

        origin = (self.headers.get("Origin") or "").strip()
        if origin:
            parsed_origin = urlparse(origin)
            origin_scheme = (parsed_origin.scheme or "").lower()
            origin_host = (parsed_origin.hostname or "").lower()
            origin_port = parsed_origin.port or (443 if origin_scheme == "https" else 80)
            server_port = getattr(self.server, "server_port", None)
            if (
                origin_scheme not in ("http", "https")
                or origin_host not in ALLOWED_LOCAL_HOSTS
                or (server_port is not None and origin_port != server_port)
            ):
                self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "Cross-origin requests are not allowed"})
                return False

        if require_json:
            ctype = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
            if ctype != "application/json":
                self._send_json(
                    HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                    {"ok": False, "error": "Content-Type must be application/json"},
                )
                return False

        return True

    def do_HEAD(self):
        if not self._check_host_allowed():
            return
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/") or _is_blocked_static_path(parsed.path, Path(self.translate_path(self.path))):
            self.send_error(HTTPStatus.FORBIDDEN, "Access denied")
            return
        super().do_HEAD()

    def do_GET(self):
        if not self._check_host_allowed():
            return
        parsed = urlparse(self.path)
        if parsed.path == "/api/builds":
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "mode": "disk",
                    "dir": "builds",
                    "builds": list_saved_builds(),
                },
            )
            return
        if parsed.path == "/api/rotations":
            data = None
            if COMBOS_FILE.exists():
                try:
                    loaded = json.loads(COMBOS_FILE.read_text(encoding="utf-8"))
                    if isinstance(loaded, dict):
                        data = loaded
                except (OSError, json.JSONDecodeError):
                    data = None
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "mode": "disk",
                    "filename": "combos/combos.json",
                    "data": data,
                },
            )
            return
        if parsed.path == "/api/buff-loadouts":
            loadouts = []
            if BUFF_LOADOUTS_FILE.exists():
                try:
                    loaded = json.loads(BUFF_LOADOUTS_FILE.read_text(encoding="utf-8"))
                    if isinstance(loaded, list):
                        loadouts = loaded
                    elif isinstance(loaded, dict) and isinstance(loaded.get("loadouts"), list):
                        loadouts = loaded["loadouts"]
                except (OSError, json.JSONDecodeError):
                    loadouts = []
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "mode": "disk",
                    "filename": "buffs/loadouts.json",
                    "loadouts": loadouts,
                },
            )
            return
        if parsed.path == "/api/gear-templates":
            templates = []
            if GEAR_TEMPLATES_FILE.exists():
                try:
                    loaded = json.loads(GEAR_TEMPLATES_FILE.read_text(encoding="utf-8"))
                    if isinstance(loaded, list):
                        templates = loaded
                    elif isinstance(loaded, dict) and isinstance(loaded.get("templates"), list):
                        templates = loaded["templates"]
                except (OSError, json.JSONDecodeError):
                    templates = []
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "mode": "disk",
                    "filename": "builds/gear-templates.json",
                    "templates": templates,
                },
            )
            return
        if parsed.path == "/api/skill-builds":
            skill_builds = []
            if SKILL_BUILDS_FILE.exists():
                try:
                    loaded = json.loads(SKILL_BUILDS_FILE.read_text(encoding="utf-8"))
                    if isinstance(loaded, list):
                        skill_builds = loaded
                    elif isinstance(loaded, dict) and isinstance(loaded.get("skillBuilds"), list):
                        skill_builds = loaded["skillBuilds"]
                except (OSError, json.JSONDecodeError):
                    skill_builds = []
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "mode": "disk",
                    "filename": "builds/skill-builds.json",
                    "skillBuilds": skill_builds,
                },
            )
            return
        if parsed.path == "/api/economy-prices":
            data = None
            if ECONOMY_PRICES_FILE.exists():
                try:
                    loaded = json.loads(ECONOMY_PRICES_FILE.read_text(encoding="utf-8"))
                    if isinstance(loaded, dict):
                        data = loaded
                except (OSError, json.JSONDecodeError):
                    data = None
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "mode": "disk",
                    "filename": "economy/prices.json",
                    "data": data,
                },
            )
            return
        if parsed.path == "/api/economy-ah-prices":
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "mode": "disk",
                    "filename": "economy/ah_prices.json",
                    "data": economy_sync.read_ah_prices_snapshot(),
                },
            )
            return
        if parsed.path == "/api/buffs":
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "mode": "disk",
                    "dir": "buffs",
                    "buffs": import_buff.list_saved_buffs(),
                },
            )
            return
        if parsed.path == "/api/buffs/fetch":
            if not self._check_same_origin_mutation(require_json=False):
                return
            qs = parse_qs(parsed.query)
            raw_id = (qs.get("id") or [""])[0].strip()
            if not raw_id:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Missing ?id=<buff_id> parameter"})
                return
            try:
                mod, raw = import_buff.fetch_and_convert_buff(raw_id, download_icon=False)
            except ValueError as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                return
            except Exception as exc:
                self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": str(exc)})
                return
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "buff": mod,
                    "raw": {
                        "id": raw.get("id"),
                        "name": raw.get("name"),
                        "kind": raw.get("kind"),
                        "duration_text": raw.get("duration_text"),
                        "icon": raw.get("icon"),
                        "max_stack": raw.get("max_stack"),
                        "stack_rule": raw.get("stack_rule"),
                        "description": import_buff.clean_aa_text(raw.get("description") or "", raw.get("duration_text")),
                        "modifiers": raw.get("modifiers") or [],
                    },
                },
            )
            return
        if parsed.path == "/api/sync/status":
            self._send_json(HTTPStatus.OK, darugear_sync.get_sync_status())
            return
        if parsed.path in ("/api/darugear/skills", "/api/darugear/build"):
            if not self._check_same_origin_mutation(require_json=False):
                return
            qs = parse_qs(parsed.query)
            raw_code = (qs.get("code") or [""])[0].strip()
            if "s=" in raw_code:
                m_code = re.search(r"[?&]s=([A-Za-z0-9_-]{3,32})", raw_code)
                if m_code:
                    raw_code = m_code.group(1)
            if not re.match(r"^[A-Za-z0-9_-]{3,32}$", raw_code):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid DaruGear share code"})
                return
            api_url = f"https://154smechk6.execute-api.ap-southeast-2.amazonaws.com/default/gear/{raw_code}"
            try:
                req = Request(api_url, headers={"User-Agent": "AAC-DamageSim/1.0", "Accept": "application/json"})
                with _SAFE_OPENER.open(req, timeout=12) as resp:
                    raw_bytes = resp.read(MAX_REMOTE_JSON_BYTES + 1)
                if len(raw_bytes) > MAX_REMOTE_JSON_BYTES:
                    raise ValueError("Remote DaruGear response exceeded size limit")
                payload = json.loads(raw_bytes.decode("utf-8"))
            except Exception as exc:
                self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": f"Failed to fetch DaruGear build '{raw_code}': {exc}"})
                return
            if parsed.path == "/api/darugear/build":
                if not isinstance(payload, dict) or not isinstance(payload.get("player"), dict):
                    self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": f"Invalid or empty DaruGear build '{raw_code}'"})
                    return
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "ok": True,
                        "shareCode": raw_code,
                        "data": payload,
                    },
                )
                return
            player = payload.get("player") if isinstance(payload, dict) else None
            pc = player.get("playerclass") if isinstance(player, dict) else None
            if not isinstance(pc, dict):
                self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": f"No skill build (playerclass) found in DaruGear build '{raw_code}'"})
                return
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "shareCode": raw_code,
                    "className": pc.get("class_name") or pc.get("name"),
                    "playerclass": pc,
                },
            )
            return
        if _is_blocked_static_path(parsed.path, Path(self.translate_path(self.path))):
            self.send_error(HTTPStatus.FORBIDDEN, "Access denied")
            return
        super().do_GET()

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid Content-Length"})
            return None

        if length <= 0 or length > MAX_BODY_BYTES:
            self._send_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"ok": False, "error": f"Payload must be between 1 and {MAX_BODY_BYTES} bytes"},
            )
            return None

        try:
            body = self.rfile.read(length)
            return json.loads(body.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": f"Invalid JSON: {exc}"})
            return None

    def _read_optional_json_body(self) -> tuple[dict | None, bool]:
        raw_hdr = (self.headers.get("Content-Length") or "0").strip()
        try:
            length = int(raw_hdr)
        except ValueError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid Content-Length"})
            return None, False
        if length <= 0:
            return {}, True
        payload = self._read_json_body()
        if payload is None:
            return None, False
        if not isinstance(payload, dict):
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Expected JSON object"})
            return None, False
        return payload, True

    def do_POST(self):
        if not self._check_same_origin_mutation(require_json=True):
            return
        parsed = urlparse(self.path)
        if parsed.path == "/api/rotations":
            payload = self._read_json_body()
            if payload is None:
                return
            if not isinstance(payload, dict):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Expected JSON object"})
                return
            combos_list = payload.get("combos")
            if not isinstance(combos_list, list):
                combos_list = payload.get("customRotations") if isinstance(payload.get("customRotations"), list) else []
            out_data = {
                "activeId": payload.get("activeId"),
                "combos": combos_list,
                "steps": payload.get("steps") if isinstance(payload.get("steps"), list) else [],
                "initialEffects": payload.get("initialEffects") if isinstance(payload.get("initialEffects"), list) else [],
                "updatedAt": payload.get("updatedAt") or int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000),
            }
            try:
                atomic_write_json(COMBOS_FILE, out_data)
            except OSError as exc:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": f"Write failed: {exc}"})
                return
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "mode": "disk",
                    "filename": "combos/combos.json",
                    "updatedAt": out_data["updatedAt"],
                },
            )
            return
        if parsed.path == "/api/buff-loadouts":
            payload = self._read_json_body()
            if payload is None:
                return
            loadouts = payload if isinstance(payload, list) else (payload.get("loadouts") if isinstance(payload, dict) else None)
            if not isinstance(loadouts, list):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Expected loadouts array"})
                return
            try:
                atomic_write_json(BUFF_LOADOUTS_FILE, {"loadouts": loadouts})
            except OSError as exc:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": f"Write failed: {exc}"})
                return
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "mode": "disk",
                    "filename": "buffs/loadouts.json",
                    "count": len(loadouts),
                },
            )
            return
        if parsed.path == "/api/gear-templates":
            payload = self._read_json_body()
            if payload is None:
                return
            templates = payload if isinstance(payload, list) else (payload.get("templates") if isinstance(payload, dict) else None)
            if not isinstance(templates, list):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Expected templates array"})
                return
            try:
                atomic_write_json(GEAR_TEMPLATES_FILE, {"templates": templates})
            except OSError as exc:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": f"Write failed: {exc}"})
                return
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "mode": "disk",
                    "filename": "builds/gear-templates.json",
                    "count": len(templates),
                },
            )
            return
        if parsed.path == "/api/skill-builds":
            payload = self._read_json_body()
            if payload is None:
                return
            skill_builds = (
                payload
                if isinstance(payload, list)
                else (payload.get("skillBuilds") if isinstance(payload, dict) else None)
            )
            if not isinstance(skill_builds, list):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Expected skillBuilds array"})
                return
            try:
                atomic_write_json(SKILL_BUILDS_FILE, {"skillBuilds": skill_builds})
            except OSError as exc:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": f"Write failed: {exc}"})
                return
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "mode": "disk",
                    "filename": "builds/skill-builds.json",
                    "count": len(skill_builds),
                },
            )
            return
        if parsed.path == "/api/economy-prices":
            payload = self._read_json_body()
            if payload is None:
                return
            if not isinstance(payload, dict):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Expected JSON object"})
                return
            try:
                atomic_write_json(ECONOMY_PRICES_FILE, payload)
            except OSError as exc:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": f"Write failed: {exc}"})
                return
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "mode": "disk",
                    "filename": "economy/prices.json",
                },
            )
            return
        if parsed.path == "/api/buffs/import":
            payload = self._read_json_body()
            if payload is None:
                return
            if not isinstance(payload, dict):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Expected JSON object"})
                return
            try:
                if isinstance(payload.get("modifier"), dict):
                    mod = dict(payload["modifier"])
                    raw_icon = payload.get("rawIcon") or ""
                    if raw_icon:
                        local_icon = import_buff.download_aac_icon(str(raw_icon))
                        if local_icon:
                            mod["icon"] = local_icon
                    elif isinstance(mod.get("icon"), str):
                        safe_ic = _sanitize_icon_url(mod["icon"])
                        if safe_ic:
                            mod["icon"] = safe_ic
                            if safe_ic.startswith("assets/icons/"):
                                import_buff.download_aac_icon(safe_ic[len("assets/icons/"):])
                        else:
                            mod.pop("icon", None)
                    mod.pop("remoteIcon", None)
                    saved = import_buff.save_custom_buff(mod)
                elif payload.get("buffId") is not None:
                    mod, _raw = import_buff.fetch_and_convert_buff(
                        payload["buffId"],
                        download_icon=True,
                        side_override=payload.get("side"),
                        debuff_override=payload.get("isDebuff"),
                        name_override=payload.get("name"),
                        custom_id=payload.get("id"),
                    )
                    saved = import_buff.save_custom_buff(mod)
                else:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Provide buffId or modifier"})
                    return
            except ValueError as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                return
            except Exception as exc:
                self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": str(exc)})
                return

            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "id": saved["id"],
                    "filename": saved.get("filename"),
                    "buff": saved,
                },
            )
            return

        if parsed.path == "/api/sync/gear-catalog":
            payload, ok = self._read_optional_json_body()
            if not ok:
                return
            ver = payload.get("version") if payload else None
            try:
                res = darugear_sync.sync_gear_catalog(version=ver)
            except ValueError as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                return
            except Exception as exc:
                self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": str(exc)})
                return
            self._send_json(HTTPStatus.OK, res)
            return

        if parsed.path == "/api/sync/skills":
            payload, ok = self._read_optional_json_body()
            if not ok:
                return
            ver = payload.get("version") if payload else None
            try:
                res = darugear_sync.sync_skills(version=ver)
            except ValueError as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                return
            except Exception as exc:
                self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": str(exc)})
                return
            self._send_json(HTTPStatus.OK, res)
            return

        if parsed.path == "/api/sync/builds-complete":
            payload, ok = self._read_optional_json_body()
            if not ok:
                return
            try:
                updated = max(0, int((payload or {}).get("updated", 0)))
                total = max(0, int((payload or {}).get("total", 0)))
            except (ValueError, TypeError):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "updated and total must be integers"})
                return
            rec = darugear_sync.record_builds_synced(updated, total)
            self._send_json(HTTPStatus.OK, {"ok": True, "builds": rec})
            return

        if parsed.path == "/api/sync/economy-prices":
            _payload, ok = self._read_optional_json_body()
            if not ok:
                return
            try:
                res = economy_sync.sync_economy_prices()
            except ValueError as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                return
            except Exception as exc:
                self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": str(exc)})
                return
            self._send_json(HTTPStatus.OK, res)
            return

        if parsed.path == "/api/icons/cache":
            payload = self._read_json_body()
            if payload is None:
                return
            eq_list = payload.get("equipment") if isinstance(payload, dict) else None
            icons_list = payload.get("icons") if isinstance(payload, dict) else None
            cached = 0
            if isinstance(eq_list, list):
                cached += import_buff.cache_equipment_icons(eq_list[:MAX_ICON_CACHE_BATCH])
            if isinstance(icons_list, list):
                for ic in icons_list[:MAX_ICON_CACHE_BATCH]:
                    if isinstance(ic, str) and import_buff.download_aac_icon(ic):
                        cached += 1
            self._send_json(HTTPStatus.OK, {"ok": True, "cached": cached})
            return

        if parsed.path != "/api/builds":
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})
            return

        payload = self._read_json_body()
        if payload is None:
            return

        if not isinstance(payload, dict) or not (
            isinstance(payload.get("offense"), dict) or isinstance(payload.get("defense"), dict)
        ):
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "Build payload must be a JSON object with offense/defense stats"},
            )
            return

        raw_id = payload.get("savedId") or payload.get("name") or ""
        build_id = slugify_build_id(str(raw_id))
        if not VALID_ID_RE.match(build_id) or f"{build_id}.json" in NON_CHARACTER_BUILD_FILES:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid or reserved build ID"})
            return

        BUILDS_DIR.mkdir(parents=True, exist_ok=True)
        out_path = (BUILDS_DIR / f"{build_id}.json").resolve()
        if out_path.parent != BUILDS_DIR.resolve():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "Invalid path"})
            return

        saved = dict(payload)
        saved["schemaVersion"] = saved.get("schemaVersion", 1)
        saved["savedId"] = build_id
        saved["filename"] = f"builds/{build_id}.json"
        saved["savedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()

        if isinstance(saved.get("equipment"), list) and saved["equipment"]:
            try:
                import_buff.cache_equipment_icons(saved["equipment"][:MAX_ICON_CACHE_BATCH])
            except Exception:
                pass

        try:
            atomic_write_json(out_path, saved)
            rebuild_builds_index()
        except OSError as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": f"Write failed: {exc}"})
            return

        self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "id": build_id,
                "filename": f"builds/{build_id}.json",
                "build": saved,
            },
        )

    def do_DELETE(self):
        if not self._check_same_origin_mutation(require_json=False):
            return
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/buffs/"):
            mod_id = unquote(parsed.path[len("/api/buffs/"):]).strip()
            try:
                deleted = import_buff.delete_custom_buff(mod_id)
            except ValueError as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                return
            except OSError as exc:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": f"Delete failed: {exc}"})
                return
            if not deleted:
                self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Buff not found"})
                return
            self._send_json(HTTPStatus.OK, {"ok": True, "id": mod_id})
            return

        prefix = "/api/builds/"
        if not parsed.path.startswith(prefix):
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})
            return

        build_id = unquote(parsed.path[len(prefix):]).strip()
        if not VALID_ID_RE.match(build_id) or f"{build_id}.json" in NON_CHARACTER_BUILD_FILES:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid or reserved build ID"})
            return

        target = (BUILDS_DIR / f"{build_id}.json").resolve()
        if target.parent != BUILDS_DIR.resolve():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "Invalid path"})
            return

        if not target.exists():
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Build not found"})
            return

        try:
            target.unlink()
            rebuild_builds_index()
        except OSError as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": f"Delete failed: {exc}"})
            return

        self._send_json(HTTPStatus.OK, {"ok": True, "id": build_id})


def main():
    parser = argparse.ArgumentParser(description="Serve AA Classic Damage Simulator with disk build persistence")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="Bind port (default: 8765)")
    parser.add_argument(
        "--allow-remote",
        action="store_true",
        help="Explicitly allow binding to a non-loopback interface (exposes unauthenticated write/delete APIs)",
    )
    args = parser.parse_args()

    bind_host = (args.host or "127.0.0.1").strip()
    if bind_host.lower() not in ALLOWED_LOCAL_HOSTS:
        if not args.allow_remote:
            print(
                f"Refusing to bind unauthenticated build server to non-loopback host {bind_host!r}. "
                "Use --host 127.0.0.1 or pass --allow-remote explicitly.",
                file=sys.stderr,
            )
            raise SystemExit(2)
        print(
            f"WARNING: Binding unauthenticated write/delete APIs to non-loopback host {bind_host!r}!",
            file=sys.stderr,
        )
        ALLOWED_LOCAL_HOSTS.add(bind_host.lower())

    server = ThreadingHTTPServer((bind_host, args.port), SimRequestHandler)
    print(f"Serving {REPO_ROOT} at http://{bind_host}:{args.port}/index.html")
    print(f"Saved builds directory: {BUILDS_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
