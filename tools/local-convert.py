#!/usr/bin/env python3
"""
local-convert.py - convert a GeoTIFF/ECW/JP2 on THIS PC to an EPSG:3857 Cloud-Optimized GeoTIFF,
upload it straight to the viewer's storage and register it as an orthophoto.

Use it for big files: the Fly.io server has 512 MB of RAM and cannot reproject multi-GB rasters.

Easiest: double-click / drag a .tif onto  tools\\local-convert.bat  (sets everything up).

  python local-convert.py <input_file> [display_name] [--api URL] [--compress auto|jpeg|lzw|deflate]
                          [--source-srs EPSG:2039] [--no-upload] [--keep] [--output out_cog.tif]

Login (admin account, same as the website). Put it in tools/.env (never committed):
    QS_ADMIN_USER=admin
    QS_ADMIN_PASSWORD=...
    QS_API=https://quadspectat-api.fly.dev      (optional)
or set the same names as environment variables; otherwise you are asked. No Spaces keys are needed:
the API hands out a short-lived upload URL.

Conversion engine: GDAL's gdalwarp if it is on PATH (OSGeo4W / QGIS shell), otherwise the Python
'rasterio' package (pip install -r tools/requirements-local.txt; it bundles GDAL).
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

try:  # Windows consoles often default to cp1252
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

DEFAULT_API = "https://quadspectat-api.fly.dev"
MAX_SINGLE_PUT = 5 * 1024 ** 3  # S3/Spaces limit for one PUT


def die(msg: str) -> None:
    print(f"\n  ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


# -- config ------------------------------------------------------------------

def load_dotenv(path: str) -> dict[str, str]:
    out: dict[str, str] = {}
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8-sig") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def cfg(name: str, dotenv: dict[str, str], default: str | None = None) -> str | None:
    return os.environ.get(name) or dotenv.get(name) or default


# -- API ---------------------------------------------------------------------

class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.token: str | None = None

    def call(self, method: str, path: str, body: dict | None = None, timeout: int = 60) -> dict:
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
            text = e.read().decode(errors="replace")
            if e.code == 401:
                die(f"HTTP 401 from {path}: not logged in / wrong admin credentials ({text})")
            die(f"HTTP {e.code} from {path}: {text}")
        except urllib.error.URLError as e:
            die(f"Cannot reach {self.base}: {e.reason}")
        return {}

    def login(self, user: str, password: str) -> None:
        self.token = self.call("POST", "/api/auth/login", {"username": user, "password": password})["token"]


def upload_put(presigned_url: str, file_path: str) -> None:
    """PUT the file to the presigned URL, streaming, with a progress bar."""
    size = os.path.getsize(file_path)
    if size > MAX_SINGLE_PUT:
        die(f"{size / 1024 ** 3:.1f} GB is above the 5 GB single-upload limit of the storage. "
            "Use --compress jpeg (much smaller) or split the raster.")
    sent = 0

    class Body:
        def __init__(self, fh):
            self.fh = fh

        def read(self, n=-1):
            nonlocal sent
            chunk = self.fh.read(n if n and n > 0 else 1024 * 1024)
            sent += len(chunk)
            pct = sent * 100 // max(size, 1)
            print(f"\r    [{'#' * (pct // 5)}{'-' * (20 - pct // 5)}] {pct:3d}%  {sent / 1048576:.1f}/{size / 1048576:.1f} MB",
                  end="", flush=True)
            return chunk

        def __len__(self):
            return size

    with open(file_path, "rb") as fh:
        req = urllib.request.Request(presigned_url, data=Body(fh), method="PUT")
        req.add_header("Content-Type", "application/octet-stream")
        req.add_header("Content-Length", str(size))
        try:
            with urllib.request.urlopen(req, timeout=6 * 3600) as r:
                print()
                if r.status >= 300:
                    die(f"Upload failed: HTTP {r.status}")
        except urllib.error.HTTPError as e:
            print()
            die(f"Upload failed: HTTP {e.code} - {e.read().decode(errors='replace')[:400]}\n"
                "  (403 usually means the upload link expired after 1 hour - rerun)")


# -- conversion --------------------------------------------------------------

def _is_3857(wkt: str) -> bool:
    return any(t in wkt for t in ("3857", "Pseudo-Mercator", "Popular Visualisation"))


def probe(path: str) -> dict:
    """{'bands': n, 'dtype': 'Byte'|..., 'wkt': str}"""
    if shutil.which("gdalinfo"):
        r = subprocess.run(["gdalinfo", "-json", path], capture_output=True, text=True)
        if r.returncode == 0:
            d = json.loads(r.stdout)
            bands = d.get("bands") or []
            return {"bands": len(bands), "dtype": (bands[0].get("type") if bands else ""),
                    "wkt": (d.get("coordinateSystem") or {}).get("wkt", "")}
    try:
        import rasterio
        with rasterio.open(path) as s:
            return {"bands": s.count, "dtype": "Byte" if s.dtypes[0] == "uint8" else s.dtypes[0],
                    "wkt": s.crs.to_wkt() if s.crs else ""}
    except Exception as e:  # noqa: BLE001
        die(f"Cannot read {path}: {e}")
    return {}


def choose_compression(req: str, info: dict) -> list[str]:
    if req == "auto":
        req = "jpeg" if (info["dtype"] == "Byte" and info["bands"] == 3) else "lzw"
    if req == "jpeg":
        # lossy but ~5-10x smaller; the viewer's tile renderer handles YCbCr (commit 737c5c2)
        return ["COMPRESS=JPEG", "QUALITY=85", "PHOTOMETRIC=YCBCR", "BIGTIFF=IF_SAFER"]
    if req == "deflate":
        return ["COMPRESS=DEFLATE", "BIGTIFF=IF_SAFER"]
    return ["COMPRESS=LZW", "BIGTIFF=IF_SAFER"]


def _gdalwarp(src: str, dst: str, co: list[str], source_srs: str | None) -> None:
    # Do NOT pass OVERVIEW_LEVEL=AUTO: the COG driver builds overviews itself and some GDAL
    # versions then skip the reprojection while exiting 0.
    cmd = ["gdalwarp", "-overwrite"] + (["-s_srs", source_srs] if source_srs else []) + \
          ["-t_srs", "EPSG:3857", "-r", "bilinear", "-of", "COG"]
    for c in co:
        cmd += ["-co", c]
    cmd += [src, dst]
    print("    $", " ".join(f'"{a}"' if " " in a else a for a in cmd))
    if subprocess.run(cmd).returncode != 0:
        die("gdalwarp failed.")


def _rasterio_warp(src: str, dst: str, co: list[str], source_srs: str | None) -> None:
    try:
        import rasterio
        from rasterio.crs import CRS
        from rasterio.enums import Resampling
        from rasterio.shutil import copy as rcopy
        from rasterio.vrt import WarpedVRT
    except ImportError:
        die("Neither gdalwarp nor the 'rasterio' Python package is available.\n"
            "  Fix:  pip install -r tools/requirements-local.txt   (or run tools\\local-convert.bat)")
    opts = dict(kv.split("=", 1) for kv in co)
    print(f"    (rasterio {rasterio.__version__} / GDAL {rasterio.__gdal_version__}) -> EPSG:3857 COG {opts}")
    with rasterio.open(src) as s:
        vrt_kw = dict(crs=CRS.from_epsg(3857), resampling=Resampling.bilinear)
        if source_srs:
            vrt_kw["src_crs"] = CRS.from_string(source_srs)
        with WarpedVRT(s, **vrt_kw) as vrt:  # streams block by block, no full-size RAM copy
            if os.path.exists(dst):
                os.remove(dst)
            rcopy(vrt, dst, driver="COG", **opts)


def convert(src: str, dst: str, requested: str, source_srs: str | None) -> None:
    info = probe(src)
    co = choose_compression(requested, info)
    run = _gdalwarp if shutil.which("gdalwarp") else _rasterio_warp
    run(src, dst, co, source_srs)
    wkt = probe(dst)["wkt"]
    if _is_3857(wkt):
        print("    OK  coordinate system: EPSG:3857")
        return
    # Israeli rasters sometimes declare ITM as a user-defined CRS; GDAL then cannot pick a datum shift
    # and passes the pixels through. Retry once forcing EPSG:2039.
    print(f"    ! output is not EPSG:3857 ({(wkt.splitlines() or ['no CRS'])[0]}); retrying with source EPSG:2039 (Israeli ITM)")
    run(src, dst, co, "EPSG:2039")
    wkt = probe(dst)["wkt"]
    if not _is_3857(wkt):
        die("Even with source EPSG:2039 the output is not EPSG:3857 - the source CRS is unusual. "
            "Pass --source-srs EPSG:xxxx.")
    print("    OK  coordinate system: EPSG:3857")


# -- main --------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="Convert to COG and upload to the QuadSpectat viewer")
    ap.add_argument("input")
    ap.add_argument("name", nargs="?", help="display name (default: file name)")
    ap.add_argument("--output", help="COG output path (default: <input>_cog.tif)")
    ap.add_argument("--api", help=f"API base URL (default {DEFAULT_API})")
    ap.add_argument("--compress", choices=["auto", "jpeg", "lzw", "deflate"], default="auto")
    ap.add_argument("--source-srs", help="force the source CRS, e.g. EPSG:2039")
    ap.add_argument("--no-upload", action="store_true", help="only convert")
    ap.add_argument("--keep", action="store_true", help="keep the local COG afterwards (no prompt)")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    dotenv = load_dotenv(os.path.join(here, ".env"))
    api_base = args.api or cfg("QS_API", dotenv, DEFAULT_API)

    src = os.path.abspath(args.input)
    if not os.path.exists(src):
        die(f"Input file not found:\n  {src}")
    name = args.name or os.path.splitext(os.path.basename(src))[0]
    dst = os.path.abspath(args.output) if args.output else os.path.splitext(src)[0] + "_cog.tif"
    if os.path.abspath(dst) == src:
        die("Output would overwrite the input file.")

    print("=" * 56)
    print("  QuadSpectat - local COG converter + uploader")
    print("=" * 56)

    api = Api(api_base)
    if not args.no_upload:  # fail early on bad credentials, before a long conversion
        user = cfg("QS_ADMIN_USER", dotenv) or input("  Admin username: ").strip()
        pw = cfg("QS_ADMIN_PASSWORD", dotenv) or getpass.getpass("  Admin password: ")
        print(f"\n[0/3] Logging in to {api_base} ...")
        api.login(user, pw)
        print("    OK")

    print(f"\n[1/3] Converting to a Cloud-Optimized GeoTIFF ...\n    Input:  {src}\n    Output: {dst}")
    t0 = time.time()
    convert(src, dst, args.compress, args.source_srs)
    print(f"    Done ({os.path.getsize(dst) / 1048576:.1f} MB, {time.time() - t0:.0f}s)")
    if args.no_upload:
        print("\n  --no-upload: stopping here.")
        return

    print("\n[2/3] Requesting an upload URL ...")
    pre = api.call("POST", "/api/orthophotos/presign",
                   {"filename": os.path.basename(dst), "contentType": "application/octet-stream"})
    print(f"    OK -> {pre['key']}")

    print("\n[3/3] Uploading to storage ...")
    upload_put(pre["url"], dst)

    print(f"\nRegistering '{name}' ...")
    row = api.call("POST", "/api/orthophotos", {
        "asset_name": name, "name": name, "raw_key": pre["key"],
        "original_format": "GeoTIFF", "cog_ready": True,
    })
    for _ in range(60):  # cog_ready rows only need their header read; wait for 'ready' / 'error'
        if row.get("status") in ("ready", "error"):
            break
        time.sleep(2)
        rows = api.call("GET", "/api/orthophotos")
        row = next((r for r in rows if r["id"] == row["id"]), row)
    if row.get("status") == "error":
        die(f"The server rejected the file: {row.get('error_message')}")
    print(f"\n  OK '{row['name']}'  id={row['id']}  status={row.get('status')}")
    print("  Refresh the Orthophotos tab.")

    if not args.keep and os.path.exists(dst):
        if input(f"\nDelete the local COG ({os.path.basename(dst)})? [y/N] ").strip().lower() == "y":
            os.remove(dst)
            print("  Deleted.")
    print("\nAll done.")


if __name__ == "__main__":
    main()
