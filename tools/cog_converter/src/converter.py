"""COG Converter - conversion engine.

Everything in `convert_one()` is plain Python + GDAL (no Qt), so it can be tested
headlessly.  `ConversionWorker` is a thin QThread wrapper used by the GUI.

What it does, in one pass where possible:
  * optional reprojection to EPSG:3857 (Web Mercator) - what the viewer's tile server needs
  * Cloud-Optimized GeoTIFF output through GDAL's COG driver (multithreaded, big cache)
  * sensible defaults per use case (presets), transparency handling, validation
"""
from __future__ import annotations

import ctypes
import glob
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

try:  # the worker needs Qt, the headless tests do not
    from PySide6.QtCore import QThread, Signal
except Exception:  # pragma: no cover
    QThread = object  # type: ignore

    def Signal(*a, **k):  # type: ignore
        return None


# --------------------------------------------------------------------------- #
#  Presets (measured on this PC, see research/cog_converter_audit.md)         #
# --------------------------------------------------------------------------- #

PRESETS: dict[str, dict] = {
    "aerial": {
        "label": "Aerial photo / orthophoto (small file, JPEG)",
        "help": "For drone/aerial photos: JPEG quality 85, smooth previews. About 10x smaller "
                "than lossless. Cannot store transparency (empty edges stay black).",
        "compression": "JPEG", "quality": 85, "warp_resampling": "BILINEAR",
        "overview_resampling": "AVERAGE", "tile_size": 512,
        "keep_transparency": False, "key_color": "none", "key_tolerance": 8,
    },
    "overlay": {
        "label": "Overlay / client map (lossless, transparent background)",
        "help": "For client plans, cadastral or survey maps laid over your orthophoto. Lossless "
                "so thin lines stay sharp, and the background becomes see-through.",
        "compression": "DEFLATE", "quality": 85, "warp_resampling": "BILINEAR",
        "overview_resampling": "AVERAGE", "tile_size": 512,
        "keep_transparency": True, "key_color": "white", "key_tolerance": 8,
    },
    "elevation": {
        "label": "Elevation / measurements (lossless)",
        "help": "For height models and other measured values: lossless, no-data kept, "
                "values are never altered by compression.",
        "compression": "DEFLATE", "quality": 85, "warp_resampling": "BILINEAR",
        "overview_resampling": "AVERAGE", "tile_size": 512,
        "keep_transparency": False, "key_color": "none", "key_tolerance": 8,
    },
    "custom": {
        "label": "Custom (set everything yourself)",
        "help": "Use the Advanced options below.",
    },
}

# compressions the viewer's tile server (geotiff.js) can actually read
VIEWER_OK_COMPRESSION = {"JPEG", "DEFLATE", "LZW", "NONE"}

DEFAULT_SETTINGS: dict = {
    "preset": "aerial",
    "reproject": True,
    "source_srs": "",            # manual override, e.g. EPSG:2039 (only needed when the file has no CRS)
    "suffix": "_cog",
    "overwrite": False,
    "validate": True,
    "gdal_bin": "",              # optional folder of an external GDAL (e.g. QGIS/OSGeo4W with ECW)
    "upload": False,
    "upload_asset": "",
    "upload_name": "",
    "allow_new_asset": False,
}
DEFAULT_SETTINGS.update({k: v for k, v in PRESETS["aerial"].items() if k not in ("label", "help")})


def apply_preset(settings: dict, preset: str) -> dict:
    s = dict(settings)
    s["preset"] = preset
    for k, v in PRESETS.get(preset, {}).items():
        if k not in ("label", "help"):
            s[k] = v
    return s


class ConversionCancelled(Exception):
    pass


class ConversionError(Exception):
    """An error whose message is already written for the end user."""


# --------------------------------------------------------------------------- #
#  System helpers                                                              #
# --------------------------------------------------------------------------- #

def total_ram_mb() -> int:
    try:
        class MS(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]
        m = MS()
        m.dwLength = ctypes.sizeof(MS)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))  # type: ignore[attr-defined]
        return int(m.ullTotalPhys // (1024 * 1024))
    except Exception:
        return 8192


def memory_plan() -> tuple[int, int]:
    """(GDAL block cache MB, warp memory MB): 12% / 8% of RAM, capped at 8 GB / 4 GB."""
    ram = total_ram_mb()
    return min(8192, max(512, ram * 12 // 100)), min(4096, max(256, ram * 8 // 100))


def fmt_size(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return str(n)


# --------------------------------------------------------------------------- #
#  ECW / JP2 availability                                                      #
# --------------------------------------------------------------------------- #

ECW_HELP = (
    "This computer's GDAL cannot read ECW files (the ECW reader is a licensed Hexagon component "
    "that is not part of the free GDAL packages).\n"
    "Easiest fix: ask whoever sent the file for a GeoTIFF, JPEG2000 or PNG+world-file export.\n"
    "Alternative: install QGIS (the offline Windows installer from qgis.org includes an ECW reader; you accept "
    "Hexagon's licence during setup), then in this app open Advanced > 'External GDAL folder' and "
    "pick QGIS's bin folder (for example C:\\Program Files\\QGIS 3.44.15\\bin). It is also found automatically. "
    "Details: README, section ECW."
)
JP2_HELP = (
    "This computer's GDAL cannot read JPEG2000 (.jp2) files.  One free command fixes it (no licence prompt): "
    "conda install -n cog-converter -c conda-forge libgdal-jp2openjpeg   - or ask for a GeoTIFF export."
)
PROPRIETARY_EXT = {".ecw": "ECW", ".jp2": "JP2OpenJPEG", ".j2k": "JP2OpenJPEG", ".sid": "MrSID"}


def candidate_gdal_bins() -> list[str]:
    """Places where an external GDAL (with extra drivers such as ECW) could live."""
    c: list[str] = []
    env = os.environ.get("COG_GDAL_BIN")
    if env:
        c.append(env)
    c += [r"C:\OSGeo4W\bin", r"C:\OSGeo4W64\bin"]
    for base in (os.environ.get("ProgramFiles", r"C:\Program Files"),):
        try:
            for d in sorted(Path(base).glob("QGIS *"), reverse=True):
                c.append(str(d / "bin"))
        except OSError:
            pass
    return [p for p in c if (Path(p) / "gdal_translate.exe").exists()]


def _external_env(gdal_bin: str) -> dict:
    env = dict(os.environ)
    env["PATH"] = gdal_bin + os.pathsep + env.get("PATH", "")
    for k in ("GDAL_DATA", "PROJ_DATA", "PROJ_LIB", "GDAL_DRIVER_PATH"):  # do not leak the conda env's data
        env.pop(k, None)
    return env


def external_has_driver(gdal_bin: str, driver: str) -> bool:
    exe = Path(gdal_bin) / "gdalinfo.exe"
    if not exe.exists():
        return False
    try:
        r = subprocess.run([str(exe), "--formats"], capture_output=True, text=True, timeout=60,
                           env=_external_env(gdal_bin))
        return any(line.strip().startswith(driver) for line in r.stdout.splitlines())
    except Exception:
        return False


def find_external_for(driver: str, settings: dict) -> str | None:
    bins = ([settings.get("gdal_bin")] if settings.get("gdal_bin") else []) + candidate_gdal_bins()
    for b in bins:
        if b and external_has_driver(b, driver):
            return b
    return None


def ecw_status(settings: dict | None = None) -> dict:
    """ECW/JP2 availability for the GUI badge: {'ecw': bool, 'jp2': bool, 'where': str}."""
    from osgeo import gdal
    ecw = gdal.GetDriverByName("ECW") is not None
    jp2 = gdal.GetDriverByName("JP2OpenJPEG") is not None or gdal.GetDriverByName("JP2ECW") is not None
    where = "built-in GDAL" if ecw else ""
    if not ecw:
        b = find_external_for("ECW", settings or {})
        if b:
            ecw, where = True, b
    return {"ecw": ecw, "jp2": jp2, "where": where}


def _decode_with_external(gdal_bin: str, src: str, tmp_dir: str, log, cancelled) -> str:
    """Decode a proprietary-format raster to a plain temporary GeoTIFF with the external GDAL."""
    out = os.path.join(tmp_dir, "decoded_" + uuid.uuid4().hex[:8] + ".tif")
    cmd = [str(Path(gdal_bin) / "gdal_translate.exe"), "-of", "GTiff", "-co", "TILED=YES", "-co", "COMPRESS=DEFLATE",
           "-co", "PREDICTOR=2", "-co", "BIGTIFF=IF_SAFER", "-co", "NUM_THREADS=ALL_CPUS", src, out]
    log(f"Reading {Path(src).name} with the external GDAL in {gdal_bin} ...")
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                         env=_external_env(gdal_bin))
    while p.poll() is None:
        if cancelled():
            p.kill()
            raise ConversionCancelled()
        time.sleep(0.3)
    if p.returncode != 0:
        raise ConversionError("The external GDAL could not read this file:\n" + (p.stdout.read() if p.stdout else "")[-500:])
    return out


# --------------------------------------------------------------------------- #
#  Probing                                                                     #
# --------------------------------------------------------------------------- #

def probe(path: str) -> dict:
    from osgeo import gdal
    ds = gdal.Open(path)
    info: dict = {"w": ds.RasterXSize, "h": ds.RasterYSize, "bands": ds.RasterCount}
    b1 = ds.GetRasterBand(1)
    info["dtype"] = gdal.GetDataTypeName(b1.DataType)
    info["nodata"] = b1.GetNoDataValue()
    info["alpha_band"] = next((i + 1 for i in range(ds.RasterCount)
                               if ds.GetRasterBand(i + 1).GetColorInterpretation() == gdal.GCI_AlphaBand), None)
    info["has_palette"] = b1.GetColorTable() is not None
    srs = ds.GetSpatialRef()
    info["srs_name"] = srs.GetName() if srs else ""
    code = None
    epsg = ""
    if srs is not None:
        try:
            srs.AutoIdentifyEPSG()
        except Exception:
            pass
        code = srs.GetAuthorityCode(None)
        epsg = f"{srs.GetAuthorityName(None)}:{code}" if code else ""
    info["epsg"] = epsg
    info["is3857"] = code in ("3857", "3785", "900913") or "Pseudo-Mercator" in info["srs_name"] \
        or "Popular Visualisation" in info["srs_name"]
    info["has_crs"] = srs is not None
    ds = None
    return info


def describe(path: str, settings: dict | None = None) -> str:
    """One-line description for the file list (never raises)."""
    try:
        i = probe(path)
        crs = i["epsg"] or (i["srs_name"] or "no CRS")
        return f"{i['w']}x{i['h']}, {i['bands']} band(s) {i['dtype']}, {crs}"
    except Exception:
        ext = Path(path).suffix.lower()
        if ext == ".ecw":
            return "ECW - " + ("readable via external GDAL" if find_external_for("ECW", settings or {}) else "no ECW reader on this PC")
        return "cannot be read"


# --------------------------------------------------------------------------- #
#  Main conversion                                                             #
# --------------------------------------------------------------------------- #

def _key_vrt(src_path: str, info: dict, color: str, tol: int) -> str:
    """VRT XML = the source RGB bands + a derived alpha band that is 0 where the pixel is (near) white/black,
    or where the source's own alpha says so."""
    from osgeo import gdal
    ds = gdal.Open(src_path)
    gt = ds.GetGeoTransform()
    srs_wkt = ds.GetProjection()
    W, H = ds.RasterXSize, ds.RasterYSize
    ds = None
    if info["bands"] < 3:
        raise ConversionError("'Transparent white/black' needs a colour (3-band) image.")
    esc = lambda s: (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))
    if color == "white":
        cond = " && ".join(f"B{i} >= {255 - tol}" for i in range(1, 4))
    else:
        cond = " && ".join(f"B{i} <= {tol}" for i in range(1, 4))

    def src(i):
        return (f'<SimpleSource><SourceFilename relativeToVRT="0">{esc(src_path)}</SourceFilename>'
                f'<SourceBand>{i}</SourceBand></SimpleSource>')
    srcs = src(1) + src(2) + src(3)
    if info["nodata"] is not None:  # the file's own no-data (e.g. black fill) is transparent too
        nd = int(info["nodata"])
        cond = f"({cond}) || (B1 == {nd} && B2 == {nd} && B3 == {nd})"
    expr = f"({cond}) ? 0 : 255"
    if info["alpha_band"]:
        srcs += src(info["alpha_band"])
        expr = f"(B4 == 0 || {cond}) ? 0 : 255"
    bands = ""
    for i, name in ((1, "Red"), (2, "Green"), (3, "Blue")):
        bands += (f'<VRTRasterBand dataType="Byte" band="{i}"><ColorInterp>{name}</ColorInterp>{src(i)}</VRTRasterBand>')
    bands += ('<VRTRasterBand dataType="Byte" band="4" subClass="VRTDerivedRasterBand"><ColorInterp>Alpha</ColorInterp>'
              '<PixelFunctionType>expression</PixelFunctionType>'
              f'<PixelFunctionArguments expression="{esc(expr)}"/>{srcs}</VRTRasterBand>')
    return (f'<VRTDataset rasterXSize="{W}" rasterYSize="{H}"><SRS>{esc(srs_wkt)}</SRS>'
            f'<GeoTransform>{",".join(repr(x) for x in gt)}</GeoTransform>{bands}</VRTDataset>')


def output_path_for(input_path: str, output_dir: str | None, settings: dict, tag_3857: bool) -> str:
    p = Path(input_path)
    suffix = settings.get("suffix", "_cog") or "_cog"
    base = Path(output_dir) if output_dir else p.parent
    return str(base / (p.stem + ("_3857" if tag_3857 else "") + suffix + ".tif"))


def convert_one(input_path: str, output_dir: str | None, settings: dict,
                progress=None, cancelled=None, log=None) -> dict:
    """Convert one raster.  Returns a result dict; raises ConversionError / ConversionCancelled."""
    from osgeo import gdal
    gdal.UseExceptions()
    progress = progress or (lambda frac, msg="": None)
    cancelled = cancelled or (lambda: False)
    log = log or (lambda m: None)
    s = {**DEFAULT_SETTINGS, **settings}
    notes: list[str] = []
    t0 = time.time()
    temp_files: list[str] = []
    decode_dir = None

    ext = Path(input_path).suffix.lower()
    external = None
    work_src = input_path
    try:
        try:
            info = probe(input_path)
        except Exception as exc:  # the built-in drivers cannot open it
            want = PROPRIETARY_EXT.get(ext)
            if want == "ECW":
                external = find_external_for("ECW", s)
                if not external:
                    raise ConversionError(ECW_HELP)
            elif want == "JP2OpenJPEG":
                external = find_external_for("JP2OpenJPEG", s)
                if not external:
                    raise ConversionError(JP2_HELP)
            elif want:
                raise ConversionError(f"{want} files cannot be read on this computer. Ask for a GeoTIFF export.")
            else:
                raise ConversionError(f"GDAL cannot open this file: {str(exc)[:300]}")
            info = None

        out_dir = Path(output_dir) if output_dir else Path(input_path).parent
        out_dir.mkdir(parents=True, exist_ok=True)

        if external:
            decode_dir = tempfile.mkdtemp(prefix="cogconv_", dir=str(out_dir))
            work_src = _decode_with_external(external, input_path, decode_dir, log, cancelled)
            info = probe(work_src)
            notes.append("read through the external GDAL")

        reproject = bool(s["reproject"])
        src_srs = (s.get("source_srs") or "").strip()
        will_warp = False
        if reproject:
            if info["is3857"] and not src_srs:
                notes.append("already EPSG:3857, not reprojected")
            else:
                if not info["has_crs"] and not src_srs:
                    raise ConversionError(
                        "This file has no coordinate system (CRS). Type the CRS in the 'Source CRS' box, "
                        "for example EPSG:2039 for Israeli ITM or EPSG:4326 for GPS lat/lon, and try again.")
                if not src_srs and info["epsg"] == "" and ("Israel" in info["srs_name"] or "ITM" in info["srs_name"]):
                    src_srs = "EPSG:2039"
                    notes.append("custom Israeli grid detected, treated as EPSG:2039 (ITM)")
                will_warp = True
        elif not info["has_crs"] and not src_srs:
            notes.append("file has no CRS: the output will not be georeferenced")

        tagged = will_warp or (reproject and info["is3857"])
        out = output_path_for(input_path, output_dir, s, tagged)
        if os.path.abspath(out) == os.path.abspath(input_path):
            raise ConversionError("The output would overwrite the input file. Change the output suffix.")
        if Path(out).exists() and not s.get("overwrite"):
            raise ConversionError(f"Output already exists: {Path(out).name} (tick 'Overwrite existing files' to replace it)")

        # --- compression decisions -------------------------------------------------
        comp = s["compression"]
        key = s.get("key_color", "none")
        need_alpha = bool(s.get("keep_transparency")) or key != "none"
        has_edges = info["alpha_band"] is not None or info["nodata"] is not None
        if comp == "JPEG":
            if info["dtype"] != "Byte" or info["bands"] not in (1, 3, 4) or info["has_palette"]:
                comp = "DEFLATE"
                notes.append(f"JPEG only works for 8-bit photos: used lossless DEFLATE for this {info['dtype']} file")
            elif need_alpha:
                comp = "DEFLATE"
                notes.append("transparency wanted: used lossless DEFLATE (JPEG cannot hold transparency)")
            elif has_edges or will_warp:
                notes.append("JPEG cannot store transparency: empty edges will look black in the viewer "
                             "(use the 'Overlay' preset or tick 'Keep transparent edges' if that matters)")
        quality = int(s.get("quality", 85))
        predictor = None
        if comp in ("DEFLATE", "LZW", "ZSTD") and not info["has_palette"]:
            predictor = "3" if info["dtype"] in ("Float32", "Float64") else "2"

        # --- input dataset ---------------------------------------------------------
        dst_alpha = False
        if key != "none":
            if info["dtype"] != "Byte":
                raise ConversionError("'Transparent white/black' only works on 8-bit colour images.")
            open_src = gdal.Open(_key_vrt(work_src, info, key, int(s.get("key_tolerance", 8))))
            notes.append(f"{key} pixels (tolerance {int(s.get('key_tolerance', 8))}) made transparent")
        elif comp == "JPEG" and info["bands"] == 4:
            open_src = gdal.Translate("", work_src, format="VRT", bandList=[1, 2, 3])  # JPEG cannot hold alpha
        else:
            open_src = gdal.Open(work_src)
            if comp != "JPEG" and info["bands"] == 3 and need_alpha:
                dst_alpha = True

        # --- disk space ------------------------------------------------------------
        in_size = os.path.getsize(work_src)
        need = in_size * (0.4 if comp == "JPEG" else 1.3) + (in_size if will_warp else 0)
        free = shutil.disk_usage(str(out_dir)).free
        if free < need:
            raise ConversionError(
                f"Not enough free disk space on {out_dir.drive or out_dir}: about {fmt_size(need)} needed, "
                f"{fmt_size(free)} free. Choose another output folder.")

        # --- creation options ------------------------------------------------------
        co = [f"COMPRESS={comp}", f"BLOCKSIZE={int(s.get('tile_size', 512))}", "BIGTIFF=IF_SAFER",
              f"OVERVIEW_RESAMPLING={s.get('overview_resampling', 'AVERAGE')}", "NUM_THREADS=ALL_CPUS"]
        if predictor:
            co.append(f"PREDICTOR={predictor}")
        if comp in ("JPEG", "WEBP"):
            co.append(f"QUALITY={quality}")

        cache_mb, wm_mb = memory_plan()
        gdal.SetCacheMax(cache_mb * 1024 * 1024)
        gdal.SetConfigOption("GDAL_NUM_THREADS", "ALL_CPUS")
        gdal.SetConfigOption("CPL_TMPDIR", str(out_dir))  # temp files next to the output (the big drive)

        tmp_out = out + ".partial.tif"
        if os.path.exists(tmp_out):
            os.remove(tmp_out)
        temp_files.append(tmp_out)

        def cb(frac, msg, data):
            progress(min(max(frac, 0.0), 1.0), "")
            return 0 if cancelled() else 1

        log(f"{Path(input_path).name}: {'reprojecting to EPSG:3857 + ' if will_warp else ''}building COG "
            f"({comp}{' q' + str(quality) if comp == 'JPEG' else ''}, cache {cache_mb} MB)")
        try:
            if will_warp:
                kw: dict = dict(format="COG", dstSRS="EPSG:3857",
                                resampleAlg=s.get("warp_resampling", "BILINEAR").lower(),
                                creationOptions=co, multithread=True, warpMemoryLimit=wm_mb,
                                warpOptions=["NUM_THREADS=ALL_CPUS"], callback=cb)
                if src_srs:
                    kw["srcSRS"] = src_srs
                if dst_alpha:
                    kw["dstAlpha"] = True
                if info["bands"] == 1 and info["nodata"] is None:
                    kw["dstNodata"] = {"Float32": -9999, "Float64": -9999, "Int16": -32768,
                                       "UInt16": 65535}.get(info["dtype"], 0)
                res = gdal.Warp(tmp_out, open_src, options=gdal.WarpOptions(**kw))
            else:
                if dst_alpha:  # add an alpha band built from the file's no-data
                    open_src = gdal.Translate("", open_src, format="VRT", bandList=[1, 2, 3, "mask"])
                topt: dict = dict(format="COG", creationOptions=co, callback=cb)
                if src_srs and not info["has_crs"]:
                    topt["outputSRS"] = src_srs
                res = gdal.Translate(tmp_out, open_src, options=gdal.TranslateOptions(**topt))
        except RuntimeError as exc:
            if cancelled():
                raise ConversionCancelled()
            msg = str(exc)
            if "memory" in msg.lower() or "alloc" in msg.lower():
                msg += "\nNot enough memory for this file: close other programs and try again."
            raise ConversionError(f"GDAL failed: {msg[:600]}")
        if cancelled():
            raise ConversionCancelled()
        if res is None:
            raise ConversionError("GDAL returned no output - the file may be damaged.")
        res = None
        open_src = None
        os.replace(tmp_out, out)
        temp_files.remove(tmp_out)

        valid_text = "not checked"
        if s.get("validate", True):
            progress(1.0, "validating")
            valid_text = validate_output(out, expect_3857=tagged)
        return {"output": out, "seconds": time.time() - t0, "in_size": os.path.getsize(input_path),
                "out_size": os.path.getsize(out), "valid": valid_text, "notes": notes, "compression": comp,
                "reprojected": will_warp}
    finally:
        for f in temp_files:
            for g in [f] + glob.glob(glob.escape(f) + "_*"):  # also the COG driver's own temp files
                try:
                    if os.path.exists(g):
                        os.remove(g)
                except OSError:
                    pass
        if decode_dir:
            shutil.rmtree(decode_dir, ignore_errors=True)


def validate_output(path: str, expect_3857: bool) -> str:
    """COG layout check (GDAL's official validator when available) + a tiny read test."""
    from osgeo import gdal
    problems: list[str] = []
    try:
        from osgeo_utils.samples import validate_cloud_optimized_geotiff as v
        _, errors, _ = v.validate(path, full_check=False)
        problems += [f"COG layout: {e}" for e in errors]
    except ImportError:
        pass
    ds = gdal.Open(path)
    try:
        if expect_3857:
            srs = ds.GetSpatialRef()
            if srs is None or srs.GetAuthorityCode(None) not in ("3857", "900913"):
                problems.append("output is not EPSG:3857")
        band = ds.GetRasterBand(1)
        n = band.GetOverviewCount()
        ov = band.GetOverview(n - 1) if n else band
        if ov.ReadAsArray(0, 0, min(ov.XSize, 64), min(ov.YSize, 64)) is None:
            problems.append("cannot read pixels")
        if (ds.RasterXSize > 4096 or ds.RasterYSize > 4096) and n == 0:
            problems.append("no overviews (slow to display)")
    finally:
        ds = None
    return "OK (valid COG)" if not problems else "PROBLEM: " + "; ".join(problems)


# --------------------------------------------------------------------------- #
#  Qt worker                                                                   #
# --------------------------------------------------------------------------- #

class ConversionWorker(QThread):
    progress = Signal(float, float)           # overall fraction 0..1, eta seconds (-1 unknown)
    file_started = Signal(int, str)           # index, path
    file_status = Signal(int, str)            # index, short status text
    file_done = Signal(int, str, bool, dict)  # index, path, success, result-or-{"error": ...}
    log = Signal(str)
    finished_all = Signal()

    def __init__(self, files: list, output_dir: str | None, settings: dict):
        super().__init__()
        self.files = files
        self.output_dir = output_dir
        self.settings = settings
        self._cancelled = False

    def cancel(self):
        self._cancelled = True

    def run(self):
        try:
            from osgeo import gdal  # noqa: F401
        except ImportError:
            self.file_done.emit(-1, "", False, {"error": "GDAL Python bindings not found. Start the app with "
                                                          "start-cog-converter.cmd (cog-converter conda environment)."})
            self.finished_all.emit()
            return
        sizes = [max(1, os.path.getsize(f)) if os.path.exists(f) else 1 for f in self.files]
        total_bytes = sum(sizes)
        done_bytes = 0
        start = time.time()
        for idx, path in enumerate(self.files):
            if self._cancelled:
                break
            self.file_started.emit(idx, path)
            t0 = time.time()

            def prog(frac, msg="", _i=idx, _sz=sizes[idx], _done=done_bytes):
                overall = (_done + _sz * 0.9 * frac) / total_bytes
                el = time.time() - start
                eta = el * (1 - overall) / overall if overall > 0.02 else -1.0
                self.progress.emit(overall, eta)
                if msg:
                    self.file_status.emit(_i, msg)

            try:
                result = convert_one(path, self.output_dir, self.settings, prog, lambda: self._cancelled, self.log.emit)
                if self.settings.get("upload") and not self._cancelled:
                    self.file_status.emit(idx, "uploading")
                    from .uploader import upload_result
                    result["upload"] = upload_result(
                        result["output"], self.settings,
                        lambda frac, _sz=sizes[idx], _done=done_bytes: self.progress.emit(
                            (_done + _sz * (0.9 + 0.1 * frac)) / total_bytes, -1.0),
                        lambda: self._cancelled, self.log.emit)
                self.file_done.emit(idx, path, True, result)
            except ConversionCancelled:
                self.file_done.emit(idx, path, False, {"error": "Cancelled", "cancelled": True})
                break
            except Exception as exc:  # noqa: BLE001
                self.file_done.emit(idx, path, False, {"error": str(exc), "seconds": time.time() - t0})
            done_bytes += sizes[idx]
        self.progress.emit(1.0 if not self._cancelled else 0.0, 0.0)
        self.finished_all.emit()
