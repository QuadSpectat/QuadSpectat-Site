#!/usr/bin/env python3
"""
local-convert.py - convert a GeoTIFF/ECW/JP2 on THIS PC to an EPSG:3857 Cloud-Optimized GeoTIFF,
upload it straight to the viewer's storage and register it as an orthophoto.

Use it for big files: the Fly.io server has 512 MB of RAM and cannot reproject multi-GB rasters.

Easiest: double-click / drag a .tif onto  tools\\local-convert.bat  (sets everything up).

  python local-convert.py <input_file> [display_name] [--api URL] [--compress auto|jpeg|lzw|deflate]
                          [--source-srs EPSG:2039] [--no-upload] [--keep] [--output out_cog.tif]
                          [--asset "Existing asset"] [--new-asset] [--transparent white|black] [--tolerance 8]

  --asset        attach the new layer to an EXISTING asset (project) by name, e.g. a client's map laid over
                 your orthophoto. Without it the layer gets its own asset named like the file (old behaviour).
  --new-asset    allow --asset to create an asset that does not exist yet (off: a typo stops the upload)
  --transparent  make a white/black background see-through (client plans). Implies lossless output + alpha.

Login (admin account, same as the website). Put it in tools/.env (never committed):
    QS_ADMIN_USER=admin
    QS_ADMIN_PASSWORD=...
    QS_API=https://quadspectat-api.fly.dev      (optional)
    QS_GDAL_BIN=C:\\path\\to\\gdal\\bin           (optional: folder of another GDAL, e.g. QGIS with ECW)
or set the same names as environment variables; otherwise you are asked. No Spaces keys are needed:
the API hands out a short-lived upload URL.

Conversion engine, in this order:
  1. gdalwarp on PATH (OSGeo4W / QGIS shell),
  2. the Miniconda environment GDAL: %USERPROFILE%\\miniconda3\\envs\\cog-converter\\Library\\bin
     (also envs\\gdal, anaconda3, or QS_GDAL_BIN),
  3. the Python 'rasterio' package (pip install -r tools/requirements-local.txt; it bundles GDAL).
Reprojection to EPSG:3857 and COG writing happen in ONE multithreaded gdalwarp pass (measured about 40%
faster than a plain gdalwarp on a 2 GB ortho, and JPEG output is ~10x smaller than lossless).
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import shutil
import subprocess
import sys
import tempfile
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

    def asset_names(self) -> list[str]:
        names: set[str] = set()
        for path in ("/api/models", "/api/orthophotos"):
            try:
                rows = self.call("GET", path)
                names.update(r["asset_name"] for r in rows if isinstance(r, dict) and r.get("asset_name"))
            except SystemExit:
                pass
        return sorted(names, key=str.lower)


def upload_put(presigned_url: str, file_path: str) -> None:
    """PUT the file to the presigned URL, streaming, with a progress bar."""
    size = os.path.getsize(file_path)
    if size > MAX_SINGLE_PUT:
        die(f"{size / 1024 ** 3:.1f} GB is above the 5 GB single-upload limit of the storage. "
            "Use --compress jpeg (much smaller) or split the raster. The converted file is kept next to the input.")
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


def find_gdal_bin(dotenv: dict[str, str] | None = None) -> str | None:
    """Folder that contains gdalwarp, or None. PATH first, then the owner's conda env GDAL."""
    on_path = shutil.which("gdalwarp")
    if on_path:
        return os.path.dirname(on_path)
    home = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    cands = [(dotenv or {}).get("QS_GDAL_BIN"), os.environ.get("QS_GDAL_BIN")]
    for root in ("miniconda3", "anaconda3", "Miniconda3", "Anaconda3"):
        for env in ("cog-converter", "gdal"):
            cands.append(os.path.join(home, root, "envs", env, "Library", "bin"))
    for c in cands:
        if c and os.path.exists(os.path.join(c, "gdalwarp.exe")):
            return c
    return None


def use_gdal_bin(folder: str) -> None:
    """Make gdalwarp/gdalinfo from `folder` the ones subprocess finds, and give them their data folders."""
    os.environ["PATH"] = folder + os.pathsep + os.environ.get("PATH", "")
    share = os.path.join(os.path.dirname(folder), "share")  # <env>\Library\bin -> <env>\Library\share
    for var, sub in (("GDAL_DATA", "gdal"), ("PROJ_DATA", "proj")):
        if not os.environ.get(var) and os.path.isdir(os.path.join(share, sub)):
            os.environ[var] = os.path.join(share, sub)


def total_ram_mb() -> int:
    try:
        import ctypes

        class MS(ctypes.Structure):
            _fields_ = [("l", ctypes.c_ulong), ("load", ctypes.c_ulong), ("tp", ctypes.c_ulonglong),
                        ("ap", ctypes.c_ulonglong), ("tpf", ctypes.c_ulonglong), ("apf", ctypes.c_ulonglong),
                        ("tv", ctypes.c_ulonglong), ("av", ctypes.c_ulonglong), ("ae", ctypes.c_ulonglong)]
        m = MS()
        m.l = ctypes.sizeof(MS)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))  # type: ignore[attr-defined]
        return int(m.tp // 1048576)
    except Exception:  # noqa: BLE001
        return 8192


def probe(path: str) -> dict:
    """{'bands', 'dtype', 'wkt', 'alpha': bool, 'nodata': bool, 'size': [w, h], 'gt': [...]}"""
    if shutil.which("gdalinfo"):
        r = subprocess.run(["gdalinfo", "-json", path], capture_output=True, text=True)
        if r.returncode == 0:
            d = json.loads(r.stdout)
            bands = d.get("bands") or []
            return {"bands": len(bands), "dtype": (bands[0].get("type") if bands else ""),
                    "wkt": (d.get("coordinateSystem") or {}).get("wkt", ""),
                    "alpha": any(b.get("colorInterpretation") == "Alpha" for b in bands),
                    "nodata": bool(bands and "noDataValue" in bands[0]),
                    "size": d.get("size"), "gt": d.get("geoTransform")}
        err = (r.stderr or r.stdout or "").strip()
        if path.lower().endswith((".ecw", ".jp2", ".sid")):
            die(f"This GDAL cannot read {os.path.splitext(path)[1]} files ({err[:200]}).\n"
                "  ECW needs a GDAL with the licensed ECW reader (QGIS / OSGeo4W install: set QS_GDAL_BIN in tools/.env),\n"
                "  or ask the sender for a GeoTIFF / JPEG2000 / PNG+world-file export.")
    try:
        import rasterio
        with rasterio.open(path) as s:
            return {"bands": s.count, "dtype": "Byte" if s.dtypes[0] == "uint8" else s.dtypes[0],
                    "wkt": s.crs.to_wkt() if s.crs else "",
                    "alpha": any(getattr(ci, "name", "") == "alpha" for ci in s.colorinterp),
                    "nodata": s.nodata is not None, "size": [s.width, s.height], "gt": list(s.transform.to_gdal())}
    except Exception as e:  # noqa: BLE001
        die(f"Cannot read {path}: {e}")
    return {}


def choose_compression(req: str, info: dict, lossless_alpha: bool = False) -> list[str]:
    """COG creation options. JPEG for plain 8-bit RGB photos (about 10x smaller than lossless), else lossless.
    JPEG cannot store transparency and the viewer shows the empty edges of a JPEG COG as black; layers that need
    transparency (client maps, clear edges) therefore use DEFLATE + an alpha band."""
    base = ["BIGTIFF=IF_SAFER", "BLOCKSIZE=512", "OVERVIEW_RESAMPLING=AVERAGE", "NUM_THREADS=ALL_CPUS"]
    if req == "auto":
        req = "jpeg" if (info["dtype"] == "Byte" and info["bands"] in (3, 4) and not lossless_alpha) else "deflate"
    if req == "jpeg" and lossless_alpha:
        print("    ! transparency requested: JPEG cannot hold it, using lossless DEFLATE instead")
        req = "deflate"
    if req == "jpeg" and info["dtype"] != "Byte":
        print(f"    ! JPEG needs 8-bit data ({info['dtype']} found): using lossless DEFLATE")
        req = "deflate"
    if req == "jpeg":
        if info.get("alpha") or info.get("nodata"):
            print("    ! the source has transparent/no-data areas; with JPEG they look black in the viewer. "
                  "Use --compress deflate (or --transparent white|black) to keep them clear.")
        # the COG driver writes 3-band JPEG as YCbCr by itself (PHOTOMETRIC is not a COG option)
        return ["COMPRESS=JPEG", "QUALITY=85"] + base
    pred = "PREDICTOR=3" if info["dtype"] in ("Float32", "Float64") else "PREDICTOR=2"
    if req == "lzw":
        return ["COMPRESS=LZW", pred] + base
    return ["COMPRESS=DEFLATE", pred] + base


def make_key_vrt(src: str, info: dict, color: str, tol: int, tmpdir: str) -> str:
    """VRT = source RGB + a derived alpha band that is 0 where the pixel is (near) white/black or no-data."""
    if info["bands"] < 3 or info["dtype"] != "Byte" or not info.get("size") or not info.get("gt"):
        die("--transparent needs an 8-bit colour image with a georeference.")
    esc = lambda t: t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    cond = " && ".join((f"B{i} >= {255 - tol}" if color == "white" else f"B{i} <= {tol}") for i in (1, 2, 3))

    def sb(i):
        return (f'<SimpleSource><SourceFilename relativeToVRT="0">{esc(src)}</SourceFilename>'
                f'<SourceBand>{i}</SourceBand></SimpleSource>')
    expr = f"({cond}) ? 0 : 255"
    srcs = sb(1) + sb(2) + sb(3)
    if info.get("alpha"):
        srcs += sb(4)
        expr = f"(B4 == 0 || {cond}) ? 0 : 255"
    bands = "".join(f'<VRTRasterBand dataType="Byte" band="{i}"><ColorInterp>{n}</ColorInterp>{sb(i)}</VRTRasterBand>'
                    for i, n in ((1, "Red"), (2, "Green"), (3, "Blue")))
    bands += ('<VRTRasterBand dataType="Byte" band="4" subClass="VRTDerivedRasterBand"><ColorInterp>Alpha</ColorInterp>'
              f'<PixelFunctionType>expression</PixelFunctionType><PixelFunctionArguments expression="{esc(expr)}"/>'
              f'{srcs}</VRTRasterBand>')
    xml = (f'<VRTDataset rasterXSize="{info["size"][0]}" rasterYSize="{info["size"][1]}"><SRS>{esc(info["wkt"])}</SRS>'
           f'<GeoTransform>{",".join(repr(float(x)) for x in info["gt"])}</GeoTransform>{bands}</VRTDataset>')
    path = os.path.join(tmpdir, "key.vrt")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(xml)
    return path


def _gdalwarp(src: str, dst: str, co: list[str], source_srs: str | None, extra: list[str] | None = None) -> None:
    # One multithreaded pass: reproject + write the COG (with its overviews). Do NOT pass OVERVIEW_LEVEL=AUTO:
    # the COG driver builds overviews itself and some GDAL versions then skip the reprojection while exiting 0.
    ram = total_ram_mb()
    cache = min(8192, max(512, ram * 12 // 100))
    wm = min(4096, max(256, ram * 8 // 100))
    cmd = ["gdalwarp", "-overwrite", "--config", "GDAL_CACHEMAX", str(cache),
           "-multi", "-wo", "NUM_THREADS=ALL_CPUS", "-wm", str(wm)] + \
          (["-s_srs", source_srs] if source_srs else []) + \
          ["-t_srs", "EPSG:3857", "-r", "bilinear", "-of", "COG"] + (extra or [])
    for c in co:
        cmd += ["-co", c]
    cmd += [src, dst]
    print("    $", " ".join(f'"{a}"' if " " in a else a for a in cmd))
    if subprocess.run(cmd).returncode != 0:
        die("gdalwarp failed.")


def _rasterio_warp(src: str, dst: str, co: list[str], source_srs: str | None, extra: list[str] | None = None) -> None:
    try:
        import rasterio
        from rasterio.crs import CRS
        from rasterio.enums import Resampling
        from rasterio.shutil import copy as rcopy
        from rasterio.vrt import WarpedVRT
    except ImportError:
        die("Neither gdalwarp nor the 'rasterio' Python package is available.\n"
            "  Fix:  pip install -r tools/requirements-local.txt   (or run tools\\local-convert.bat)")
    if extra and "-dstalpha" in extra:
        print("    ! the rasterio fallback cannot add an alpha band; transparent edges may be black")
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


def convert(src: str, dst: str, requested: str, source_srs: str | None,
            transparent: str | None = None, tolerance: int = 8, dotenv: dict[str, str] | None = None) -> None:
    gdal_bin = find_gdal_bin(dotenv)
    if gdal_bin:
        use_gdal_bin(gdal_bin)
        print(f"    GDAL: {gdal_bin}")
    have_cli = bool(shutil.which("gdalwarp"))
    info = probe(src)
    tmpdir = tempfile.mkdtemp(prefix="qs_convert_")
    try:
        lossless_alpha = bool(transparent)
        warp_src = src
        if transparent:
            if not have_cli:
                die("--transparent needs gdalwarp (conda env / QGIS GDAL); the rasterio fallback cannot do it.")
            warp_src = make_key_vrt(src, info, transparent, tolerance, tmpdir)
            print(f"    {transparent} pixels (tolerance {tolerance}) become transparent")
        co = choose_compression(requested, info, lossless_alpha)
        extra: list[str] = []
        if "COMPRESS=JPEG" in co and info["bands"] == 4:
            extra = ["-srcband", "1", "-srcband", "2", "-srcband", "3"]  # JPEG cannot carry the alpha band
        elif "COMPRESS=JPEG" not in co and info["bands"] == 3 and not transparent:
            extra = ["-dstalpha"]  # lossless output: empty/no-data fill and reprojection corners become real transparency
        run = _gdalwarp if have_cli else _rasterio_warp
        run(warp_src, dst, co, source_srs, extra)
        wkt = probe(dst)["wkt"]
        if _is_3857(wkt):
            print("    OK  coordinate system: EPSG:3857")
            return
        # Israeli rasters sometimes declare ITM as a user-defined CRS; GDAL then cannot pick a datum shift
        # and passes the pixels through. Retry once forcing EPSG:2039.
        print(f"    ! output is not EPSG:3857 ({(wkt.splitlines() or ['no CRS'])[0]}); retrying with source EPSG:2039 (Israeli ITM)")
        run(warp_src, dst, co, "EPSG:2039", extra)
        wkt = probe(dst)["wkt"]
        if not _is_3857(wkt):
            die("Even with source EPSG:2039 the output is not EPSG:3857 - the source CRS is unusual. "
                "Pass --source-srs EPSG:xxxx.")
        print("    OK  coordinate system: EPSG:3857")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


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
    ap.add_argument("--asset", help="attach the layer to this EXISTING asset (default: a new asset named like the file)")
    ap.add_argument("--new-asset", action="store_true", help="allow --asset to create a new asset")
    ap.add_argument("--transparent", choices=["white", "black"], help="make this background colour transparent")
    ap.add_argument("--tolerance", type=int, default=8, help="how close to white/black counts (default 8)")
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
    asset = name
    if not args.no_upload:  # fail early on bad credentials, before a long conversion
        user = cfg("QS_ADMIN_USER", dotenv) or input("  Admin username: ").strip()
        pw = cfg("QS_ADMIN_PASSWORD", dotenv) or getpass.getpass("  Admin password: ")
        print(f"\n[0/3] Logging in to {api_base} ...")
        api.login(user, pw)
        print("    OK")
        if args.asset:
            existing = api.asset_names()
            match = next((a for a in existing if a.lower() == args.asset.lower()), None)
            if match:
                asset = match
            elif args.new_asset:
                asset = args.asset
            else:
                die(f"There is no asset called '{args.asset}' (existing: {', '.join(existing) or 'none'}).\n"
                    "  Check the spelling, or add --new-asset to create it.")
            print(f"    Layer will be added to asset: {asset}")

    print(f"\n[1/3] Converting to a Cloud-Optimized GeoTIFF ...\n    Input:  {src}\n    Output: {dst}")
    t0 = time.time()
    convert(src, dst, args.compress, args.source_srs, args.transparent, args.tolerance, dotenv)
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

    print(f"\nRegistering '{name}' in asset '{asset}' ...")
    row = api.call("POST", "/api/orthophotos", {
        "asset_name": asset, "name": name, "raw_key": pre["key"],
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
