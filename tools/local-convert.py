#!/usr/bin/env python3
"""
local-convert.py — local GeoTIFF/ECW/JP2 -> COG + upload to 3D Viewer
Run from OSGeo4W Shell (installed with QGIS):

  python local-convert.py <input_file> <display_name> [output_cog.tif]

Examples:
  python local-convert.py "C:\\Surveys\\barkai.tif" "Barkai 2025"
  python local-convert.py site.ecw "Site Survey" site_cog.tif
"""

import sys
import os
import subprocess
import json
import urllib.request
import urllib.error

BACKEND = "https://quadspectat-api.fly.dev"


def die(msg: str) -> None:
    print(f"\n  ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def api(method: str, path: str, body: dict | None = None) -> dict:
    url = BACKEND + path
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        text = e.read().decode(errors="replace")
        die(f"HTTP {e.code} from {path}: {text}")
    except urllib.error.URLError as e:
        die(f"Network error: {e.reason}")


def upload_put(presigned_url: str, file_path: str) -> None:
    """PUT file to presigned Spaces URL (streams in 4 MB chunks with progress)."""
    file_size = os.path.getsize(file_path)
    mb = file_size / 1024 / 1024
    uploaded = 0
    chunk = 4 * 1024 * 1024

    class ProgressFile:
        def __init__(self, fh):
            self._fh = fh

        def read(self, n=-1):
            nonlocal uploaded
            data = self._fh.read(n)
            uploaded += len(data)
            if file_size:
                pct = uploaded * 100 // file_size
                bar = "#" * (pct // 5) + "-" * (20 - pct // 5)
                print(f"\r    [{bar}] {pct:3d}%  {uploaded/1024/1024:.1f}/{mb:.1f} MB", end="", flush=True)
            return data

        def __len__(self):
            return file_size

    with open(file_path, "rb") as fh:
        req = urllib.request.Request(presigned_url, data=ProgressFile(fh), method="PUT")
        req.add_header("Content-Type", "application/octet-stream")
        req.add_header("Content-Length", str(file_size))
        try:
            with urllib.request.urlopen(req, timeout=3600) as r:
                print()  # newline after progress bar
                if r.status >= 300:
                    die(f"Upload failed: HTTP {r.status}")
        except urllib.error.HTTPError as e:
            print()
            die(f"Upload failed: HTTP {e.code} — {e.read().decode(errors='replace')}")


def run_gdalwarp(input_file: str, output_file: str) -> None:
    # NOTE: do NOT pass OVERVIEW_LEVEL=AUTO — the COG driver builds overviews
    # automatically and recent GDAL versions reject that flag with a warning
    # that can cause gdalwarp to skip the reprojection while exiting 0.
    cmd = [
        "gdalwarp",
        "-overwrite",
        "-t_srs", "EPSG:3857",
        "-r", "bilinear",
        "-of", "COG",
        "-co", "COMPRESS=LZW",
        "-co", "BIGTIFF=IF_SAFER",
        input_file,
        output_file,
    ]
    print("    $", " ".join(f'"{a}"' if " " in a else a for a in cmd))
    result = subprocess.run(cmd)
    if result.returncode != 0:
        die(
            "gdalwarp failed (exit code %d).\n"
            "  Make sure you are running from the OSGeo4W Shell that came with QGIS,\n"
            "  or that gdalwarp is in your PATH." % result.returncode
        )


def verify_output_is_web_mercator(output_file: str) -> None:
    """gdalwarp can silently produce an unreprojected output. Verify before upload."""
    try:
        info = subprocess.run(
            ["gdalinfo", "-json", output_file],
            capture_output=True, text=True, check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        die(f"gdalinfo on the converted file failed: {e}")
    data = json.loads(info.stdout)
    wkt = (data.get("coordinateSystem") or {}).get("wkt", "")
    # A correctly reprojected COG must reference EPSG:3857 / Web Mercator
    if "3857" not in wkt and "WGS 84 / Pseudo-Mercator" not in wkt and "Mercator_1SP" not in wkt:
        die(
            "Converted file is NOT in EPSG:3857 — gdalwarp likely skipped the\n"
            "  reprojection. First lines of its coordinate system:\n  "
            + (wkt.splitlines()[0] if wkt else "(no WKT)")
        )
    print("    OK  coordinate system: EPSG:3857 (Web Mercator)")


def main() -> None:
    print("=" * 52)
    print("  3D Viewer — Local COG Converter")
    print("=" * 52)

    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    input_file = os.path.abspath(sys.argv[1])
    display_name = sys.argv[2]
    base = os.path.splitext(input_file)[0]
    output_file = os.path.abspath(sys.argv[3]) if len(sys.argv) > 3 else f"{base}_cog.tif"

    if not os.path.exists(input_file):
        die(f"Input file not found:\n  {input_file}")

    if os.path.exists(output_file):
        ans = input(f"\n  Output file already exists:\n  {output_file}\n  Overwrite? [y/N] ").strip().lower()
        if ans != "y":
            print("Aborted.")
            sys.exit(0)

    # ── Step 1: Convert ──────────────────────────────────────────────────────
    print(f"\n[1/3] Converting to Cloud-Optimized GeoTIFF…")
    print(f"    Input:  {input_file}")
    print(f"    Output: {output_file}")
    run_gdalwarp(input_file, output_file)
    verify_output_is_web_mercator(output_file)
    size_mb = os.path.getsize(output_file) / 1024 / 1024
    print(f"    Done  ({size_mb:.1f} MB)")

    # ── Step 2: Get presigned upload URL ─────────────────────────────────────
    print(f"\n[2/3] Requesting upload URL…")
    filename = os.path.basename(output_file)
    result = api("POST", "/api/orthophotos/presign", {
        "filename": filename,
        "contentType": "application/octet-stream",
    })
    presigned_url = result["url"]
    key = result["key"]
    print(f"    OK  →  key: {key}")

    # ── Step 3: Upload ───────────────────────────────────────────────────────
    print(f"\n[3/3] Uploading to DigitalOcean Spaces…")
    upload_put(presigned_url, output_file)
    print(f"    Done")

    # ── Register in viewer ───────────────────────────────────────────────────
    print(f"\nRegistering '{display_name}' in viewer…")
    ortho = api("POST", "/api/orthophotos", {
        "asset_name": display_name,
        "name": display_name,
        "raw_key": key,
        "original_format": "GeoTIFF",
        "cog_ready": True,
    })
    print(f"\n  ✓ '{ortho['name']}' is live in the viewer!")
    print(f"    ID: {ortho['id']}")
    print(f"    Status: {ortho['status']}")
    print(f"\n  Refresh the Orthophotos tab to see it.")

    # ── Optionally delete local COG ──────────────────────────────────────────
    if os.path.abspath(output_file) != os.path.abspath(input_file):
        ans = input(f"\nDelete local COG file? ({os.path.basename(output_file)}) [y/N] ").strip().lower()
        if ans == "y":
            os.remove(output_file)
            print("  Deleted.")

    print("\nAll done.\n")


if __name__ == "__main__":
    main()
