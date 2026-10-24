"""Command-line front end of the COG Converter engine (same code as the GUI).

  start-cog-converter.cmd --cli "C:\\data\\map.tif" --preset overlay --asset "Bat Hefer" --upload
or:
  conda run -n cog-converter python cli.py <files> [options]
"""
import argparse
import os
import sys

_lib = os.path.join(sys.prefix, "Library", "share")
if not os.environ.get("GDAL_DATA") and os.path.isdir(os.path.join(_lib, "gdal")):
    os.environ["GDAL_DATA"] = os.path.join(_lib, "gdal")
if not os.environ.get("PROJ_DATA") and os.path.isdir(os.path.join(_lib, "proj")):
    os.environ["PROJ_DATA"] = os.path.join(_lib, "proj")

from src.converter import PRESETS, DEFAULT_SETTINGS, apply_preset, convert_one, ConversionError, ConversionCancelled


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Convert rasters to Cloud-Optimized GeoTIFF (EPSG:3857 by default)")
    ap.add_argument("files", nargs="+")
    ap.add_argument("--preset", choices=[p for p in PRESETS if p != "custom"], default="aerial")
    ap.add_argument("--out-dir")
    ap.add_argument("--no-reproject", action="store_true", help="keep the source CRS")
    ap.add_argument("--source-srs", default="", help="CRS for files that have none, e.g. EPSG:2039")
    ap.add_argument("--compression", help="override: JPEG, DEFLATE, LZW, ZSTD, ...")
    ap.add_argument("--quality", type=int)
    ap.add_argument("--key-color", choices=["none", "white", "black"])
    ap.add_argument("--key-tolerance", type=int)
    ap.add_argument("--suffix", default="_cog")
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--gdal-bin", default="", help="folder of an external GDAL (QGIS/OSGeo4W) for ECW input")
    ap.add_argument("--upload", action="store_true", help="upload to the viewer afterwards")
    ap.add_argument("--asset", default="", help="existing asset name to attach the layer to")
    ap.add_argument("--name", default="", help="display name of the layer")
    ap.add_argument("--allow-new-asset", action="store_true")
    a = ap.parse_args(argv)

    s = apply_preset(DEFAULT_SETTINGS, a.preset)
    s.update(reproject=not a.no_reproject, source_srs=a.source_srs, overwrite=a.overwrite, suffix=a.suffix, gdal_bin=a.gdal_bin,
             upload=a.upload, upload_asset=a.asset, upload_name=a.name, allow_new_asset=a.allow_new_asset)
    for k, v in (("compression", a.compression), ("quality", a.quality), ("key_color", a.key_color),
                 ("key_tolerance", a.key_tolerance)):
        if v is not None:
            s[k] = v
    rc = 0
    last = [-1]

    def prog(frac, msg=""):
        p = int(frac * 100)
        if p != last[0] and p % 10 == 0:
            last[0] = p
            print(f"  {p}%", flush=True)

    for f in a.files:
        try:
            r = convert_one(f, a.out_dir, s, prog, None, print)
            print(f"OK  {r['output']}  {r['out_size'] / 1048576:.1f} MB  {r['seconds']:.1f}s  {r['valid']}")
            for n in r["notes"]:
                print("  note:", n)
            if a.upload:
                from src.uploader import upload_result
                u = upload_result(r["output"], s, lambda fr: None, lambda: False, print)
                print("  upload:", u)
        except (ConversionError, ConversionCancelled, Exception) as exc:  # noqa: BLE001
            print(f"FAILED {f}: {exc}")
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
