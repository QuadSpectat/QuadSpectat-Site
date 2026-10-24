"""Upload a finished COG to the QuadSpectat viewer (same flow as the viewer repo's tools/local-convert.py).

  login (admin) -> presigned URL from the API -> one PUT straight to storage -> register the orthophoto.

Credentials come from a local `.env` (never committed) next to the app, or from environment variables:
    QS_ADMIN_USER=admin
    QS_ADMIN_PASSWORD=...
    QS_API=https://quadspectat-api.fly.dev     (optional)
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_API = "https://quadspectat-api.fly.dev"
MAX_SINGLE_PUT = 5 * 1024 ** 3  # a single PUT to S3/Spaces tops out at 5 GB
APP_DIR = Path(__file__).resolve().parent.parent
READABLE_BY_VIEWER = {"JPEG", "YCBCR JPEG", "DEFLATE", "LZW", "NONE", ""}


class UploadError(Exception):
    pass


def load_dotenv(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def credentials() -> dict:
    dot = load_dotenv(APP_DIR / ".env")
    home = load_dotenv(Path(os.path.expanduser("~")) / ".cog-converter.env")

    def g(name, default=None):
        return os.environ.get(name) or dot.get(name) or home.get(name) or default
    return {"user": g("QS_ADMIN_USER"), "password": g("QS_ADMIN_PASSWORD"), "api": g("QS_API", DEFAULT_API)}


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.token: str | None = None

    def call(self, method: str, path: str, body: dict | None = None, timeout: int = 60):
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            text = e.read().decode(errors="replace")[:300]
            if e.code == 401:
                raise UploadError(f"The viewer refused the login (wrong admin user/password in .env?): {text}")
            raise UploadError(f"The viewer answered HTTP {e.code} for {path}: {text}")
        except urllib.error.URLError as e:
            raise UploadError(f"Cannot reach {self.base}: {e.reason}")

    def login(self, user: str, password: str) -> None:
        self.token = self.call("POST", "/api/auth/login", {"username": user, "password": password})["token"]


def connect() -> Api:
    c = credentials()
    if not c["user"] or not c["password"]:
        raise UploadError(
            "No viewer login found. Create the file  " + str(APP_DIR / ".env") +
            "  with two lines:\nQS_ADMIN_USER=admin\nQS_ADMIN_PASSWORD=your-password\n(this file stays on your PC).")
    api = Api(c["api"])
    api.login(c["user"], c["password"])
    return api


def list_assets(api: Api | None = None) -> list[str]:
    """Names of the assets that already exist (from models and orthophotos)."""
    api = api or connect()
    names: set[str] = set()
    for path in ("/api/models", "/api/orthophotos"):
        try:
            rows = api.call("GET", path)
            names.update(r.get("asset_name") for r in rows if isinstance(r, dict) and r.get("asset_name"))
        except UploadError:
            pass
    return sorted(names, key=str.lower)


def _put(url: str, path: str, progress, cancelled) -> None:
    size = os.path.getsize(path)
    sent = 0

    class Body:
        def __init__(self, fh):
            self.fh = fh

        def read(self, n=-1):
            nonlocal sent
            if cancelled():
                raise UploadError("Cancelled")
            chunk = self.fh.read(n if n and n > 0 else 1024 * 1024)
            sent += len(chunk)
            progress(sent / max(size, 1))
            return chunk

        def __len__(self):
            return size

    with open(path, "rb") as fh:
        req = urllib.request.Request(url, data=Body(fh), method="PUT")
        req.add_header("Content-Type", "application/octet-stream")
        req.add_header("Content-Length", str(size))
        try:
            with urllib.request.urlopen(req, timeout=6 * 3600) as r:
                if r.status >= 300:
                    raise UploadError(f"Upload failed: HTTP {r.status}")
        except urllib.error.HTTPError as e:
            raise UploadError(f"Upload failed: HTTP {e.code} {e.read().decode(errors='replace')[:300]} "
                              "(403 usually means the upload link expired after 1 hour - run again)")
        except urllib.error.URLError as e:
            raise UploadError(f"Upload failed: {e.reason}")


def check_uploadable(path: str) -> str | None:
    """Return a reason why this file cannot go through the single-PUT flow, else None."""
    size = os.path.getsize(path)
    if size > MAX_SINGLE_PUT:
        return (f"{size / 1024 ** 3:.1f} GB is above the 5 GB limit of a single upload; this app only supports "
                "single uploads, so the file was converted but NOT uploaded (use the JPEG preset, which is much "
                "smaller, or upload it another way).")
    try:
        from osgeo import gdal
        ds = gdal.Open(path)
        comp = (ds.GetMetadata("IMAGE_STRUCTURE").get("COMPRESSION") or "").upper()
        ds = None
        if comp not in READABLE_BY_VIEWER:
            return (f"The viewer cannot read {comp} compression, so the file was NOT uploaded. "
                    "Use JPEG or DEFLATE.")
    except Exception:
        pass
    return None


def upload_result(path: str, settings: dict, progress, cancelled, log) -> dict:
    asset = (settings.get("upload_asset") or "").strip()
    if not asset:
        raise UploadError("Choose the asset (project) the layer should be added to.")
    reason = check_uploadable(path)
    if reason:
        return {"skipped": reason}
    name = (settings.get("upload_name") or "").strip() or Path(path).stem
    log("Logging in to the viewer ...")
    api = connect()
    existing = list_assets(api)
    if asset.lower() not in {a.lower() for a in existing}:
        if not settings.get("allow_new_asset"):
            raise UploadError(
                f"There is no asset called '{asset}' in the viewer yet (existing: {', '.join(existing) or 'none'}). "
                "Pick one from the list, or tick 'Create the asset if it does not exist'.")
    else:  # use the exact stored spelling
        asset = next(a for a in existing if a.lower() == asset.lower())
    pre = api.call("POST", "/api/orthophotos/presign",
                   {"filename": os.path.basename(path), "contentType": "application/octet-stream"})
    log(f"Uploading {os.path.getsize(path) / 1048576:.0f} MB to the viewer's storage ...")
    _put(pre["url"], path, progress, cancelled)
    log(f"Registering '{name}' in asset '{asset}' ...")
    row = api.call("POST", "/api/orthophotos", {
        "asset_name": asset, "name": name, "raw_key": pre["key"],
        "original_format": "GeoTIFF", "cog_ready": True,
    })
    for _ in range(90):
        if row.get("status") in ("ready", "error"):
            break
        if cancelled():
            break
        time.sleep(2)
        rows = api.call("GET", "/api/orthophotos")
        row = next((r for r in rows if r["id"] == row["id"]), row)
    if row.get("status") == "error":
        raise UploadError(f"The viewer rejected the file: {row.get('error_message')}")
    return {"id": row.get("id"), "name": row.get("name"), "asset": asset, "status": row.get("status"),
            "api": api.base}
