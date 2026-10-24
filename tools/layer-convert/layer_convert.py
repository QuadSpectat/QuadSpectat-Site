#!/usr/bin/env python3
"""
DXF to GeoJSON (WGS84) converter for QuadSpectat layers.

Local helper, not part of the server. Pure pip packages only (ezdxf + pyproj, see requirements.txt): no GDAL, no QGIS.
Reads a DXF (ASCII or binary). DWG is NOT read: export a DXF from AutoCAD (SAVEAS, "AutoCAD DXF") or use the free
ODA File Converter, then run this script on the DXF.

    python layer_convert.py survey.dxf --source-crs EPSG:2039 -o survey.geojson

What is converted (model space only):
    LINE, LWPOLYLINE, POLYLINE (2D and 3D, bulges become arcs)  -> LineString
    POINT                                                        -> Point
    CIRCLE, ARC, ELLIPSE, SPLINE                                 -> LineString (densified, see --arc-tolerance)
    TEXT, MTEXT                                                  -> Point with property "text"
    INSERT (block reference)                                     -> Point with property "block" (+ attributes)
    HATCH boundaries                                             -> Polygon (outer ring + holes)
Everything else (DIMENSION, 3DFACE, MESH, images, ...) is skipped and listed in the report.
Kept as feature properties: dxf_layer, dxf_type, color (+ stroke / marker-color / fill for the viewer), elevation (z),
text, block, handle.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

# Same limits as the server (backend/src/layerLimits.ts). Only used to warn before you upload.
SERVER_MAX_BYTES = 25 * 1024 * 1024
SERVER_WARN_FEATURES = 5_000
SERVER_MAX_FEATURES = 50_000

DEFAULT_SOURCE_CRS = "EPSG:2039"   # Israel TM Grid (ITM)
KNOWN_CRS = {
    "EPSG:2039": "Israeli TM Grid (ITM), the current national grid",
    "EPSG:28193": "Palestine 1923 / Israeli CS Grid (old grid, northings about 1,2xx,xxx)",
    "EPSG:28191": "Palestine 1923 / Palestine Grid (old grid, northings about 2xx,xxx)",
    "EPSG:4326": "WGS84 longitude/latitude, no conversion",
}


class ConvertError(Exception):
    """A problem the user can fix; printed without a traceback."""


# ── geoid (EGM2008, the same grid the viewer uses for heights above sea level) ──────────────────────────────────

class Geoid:
    def __init__(self, north: float, west: float, step: float, rows: list[list[float]]):
        self.north, self.west, self.step, self.rows = north, west, step, rows

    @classmethod
    def load(cls, path: Path) -> "Geoid":
        text = path.read_text(encoding="utf-8")

        def num(name: str) -> float:
            m = re.search(rf"export const {name}\s*=\s*([-0-9.]+)", text)
            if not m:
                raise ConvertError(f"{path} does not look like frontend/src/lib/geoid.ts (no {name}).")
            return float(m.group(1))

        body = text[text.index("const GRID"):text.index("/** Geoid undulation")]
        rows = [[float(v) for v in line.strip().strip(",").strip("[]").split(",") if v.strip()]
                for line in body.splitlines() if line.strip().startswith("[") and "," in line]
        if len(rows) != int(num("GEOID_ROWS")):
            raise ConvertError(f"geoid grid has {len(rows)} rows, expected {int(num('GEOID_ROWS'))}.")
        return cls(num("GEOID_NORTH"), num("GEOID_WEST"), num("GEOID_STEP"), rows)

    def undulation(self, lat: float, lon: float) -> float | None:
        """Geoid height N (m) above the ellipsoid, bilinear; None outside the bundled region (Israel and surroundings)."""
        fr, fc = (self.north - lat) / self.step, (lon - self.west) / self.step
        r, c = math.floor(fr), math.floor(fc)
        if r < 0 or c < 0 or r >= len(self.rows) - 1 or c >= len(self.rows[0]) - 1:
            return None
        dr, dc = fr - r, fc - c
        g = self.rows
        return (g[r][c] * (1 - dr) * (1 - dc) + g[r][c + 1] * (1 - dr) * dc
                + g[r + 1][c] * dr * (1 - dc) + g[r + 1][c + 1] * dr * dc)


def default_geoid_path() -> Path:
    return Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "geoid.ts"


# ── conversion ───────────────────────────────────────────────────────────────────────────────────────────────────

def _aci_hex(ezdxf: Any, entity: Any, layer_color: int | None) -> str | None:
    try:
        rgb = entity.rgb
        if rgb is not None:
            return "#%02x%02x%02x" % tuple(rgb)
        aci = entity.dxf.color
        if aci == 256 and layer_color is not None:   # BYLAYER
            aci = abs(layer_color)
        if aci in (0, 256):                          # BYBLOCK / unknown
            return None
        r, g, b = ezdxf.colors.aci2rgb(abs(aci))
        return "#%02x%02x%02x" % (r, g, b)
    except Exception:
        return None


def _ring_area(ring: list[tuple[float, float]]) -> float:
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1])) / 2


def _inside(pt: tuple[float, float], ring: list[tuple[float, float]]) -> bool:
    x, y, ins = pt[0], pt[1], False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            ins = not ins
    return ins


def convert(
    dxf_path: Path,
    source_crs: str = DEFAULT_SOURCE_CRS,
    heights: str = "ellipsoidal",
    arc_tolerance: float = 0.05,
    precision: int = 7,
    drop_z: bool = False,
    closed_as_polygon: bool = False,
    only_layers: set[str] | None = None,
    skip_layers: set[str] | None = None,
    include_hidden_layers: bool = False,
    geoid_file: Path | None = None,
) -> tuple[dict, dict]:
    """Returns (GeoJSON FeatureCollection in WGS84, report)."""
    import ezdxf
    import ezdxf.colors
    from ezdxf import path as ezpath
    from pyproj import CRS, Transformer
    from pyproj.exceptions import CRSError

    if dxf_path.suffix.lower() == ".dwg":
        raise ConvertError(
            "DWG files are not supported (no free, reliable DWG reader is bundled). Export a DXF from AutoCAD "
            "(SAVEAS, file type 'AutoCAD DXF', 2013 or older is safest) or convert it with the free ODA File "
            "Converter, then run this script on the DXF.")
    if not dxf_path.exists():
        raise ConvertError(f"File not found: {dxf_path}")

    try:
        src = CRS.from_user_input(source_crs)
    except CRSError as e:
        raise ConvertError(f"Unknown coordinate system '{source_crs}': {e}") from e
    to_wgs = None if src.to_epsg() == 4326 else Transformer.from_crs(src, CRS.from_epsg(4326), always_xy=True)

    geoid = None
    if heights == "orthometric":
        gp = geoid_file or default_geoid_path()
        if not gp.exists():
            raise ConvertError(f"--heights orthometric needs the geoid grid file, not found at {gp}. "
                               "Run from inside the repository or pass --geoid-file frontend/src/lib/geoid.ts.")
        geoid = Geoid.load(gp)

    try:
        doc = ezdxf.readfile(str(dxf_path))
    except ezdxf.DXFStructureError:
        from ezdxf import recover
        doc, _auditor = recover.readfile(str(dxf_path))
    except (OSError, ezdxf.DXFError) as e:
        raise ConvertError(f"Could not read {dxf_path.name} as DXF: {e}") from e

    report: dict[str, Any] = {"warnings": [], "converted": Counter(), "skipped": Counter(), "source_crs": source_crs,
                              "heights": heights}
    insunits = doc.header.get("$INSUNITS", 0)
    if insunits not in (0, 6):
        report["warnings"].append(f"Drawing units ($INSUNITS={insunits}) are not metres; coordinates are read as metres. "
                                  "Check the result against a known point.")

    layer_info = {l.dxf.name: l for l in doc.layers}

    def layer_visible(name: str) -> bool:
        if only_layers is not None and name not in only_layers:
            return False
        if skip_layers and name in skip_layers:
            return False
        lay = layer_info.get(name)
        if lay is not None and not include_hidden_layers and (lay.is_off() or lay.is_frozen()):
            return False
        return True

    ndec = max(0, int(precision))
    stats = {"n_far": 0, "n_geoid_missing": 0, "any_z": False}

    def project(pts: list[tuple[float, float, float]]) -> list[list[float]]:
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        if to_wgs is not None:
            lons, lats = to_wgs.transform(xs, ys)
        else:
            lons, lats = xs, ys
        has_z = (not drop_z) and any(abs(p[2]) > 1e-9 for p in pts)
        out = []
        for lon, lat, p in zip(lons, lats, pts):
            if not (math.isfinite(lon) and math.isfinite(lat)):
                raise ConvertError("A coordinate could not be projected: check --source-crs (the values do not fit that grid).")
            if has_z:
                z = p[2]
                if geoid is not None:
                    n = geoid.undulation(lat, lon)
                    if n is None:
                        stats["n_geoid_missing"] += 1
                    else:
                        z = z + n          # H (above sea level) -> h (ellipsoid) = H + N
                stats["any_z"] = True
                out.append([round(lon, ndec), round(lat, ndec), round(z, 3)])
            else:
                out.append([round(lon, ndec), round(lat, ndec)])
        return out

    features: list[dict] = []

    def add(geom: dict, e: Any, kind: str, extra: dict | None = None, zs: list[float] | None = None) -> None:
        lname = e.dxf.layer
        color = _aci_hex(ezdxf, e, layer_info[lname].dxf.color if lname in layer_info else None)
        props: dict[str, Any] = {"dxf_layer": lname, "dxf_type": e.dxftype(), "handle": e.dxf.handle}
        if color:
            props["color"] = color
            if geom["type"] == "Point":
                props["marker-color"] = color
            elif geom["type"] in ("Polygon", "MultiPolygon"):
                props["fill"] = color
                props["fill-opacity"] = 0.3
                props["stroke"] = color
            else:
                props["stroke"] = color
        nz = [z for z in (zs or []) if abs(z) > 1e-9]
        if nz and not drop_z:
            props["elevation"] = round(sum(nz) / len(nz), 3)
        if extra:
            props.update(extra)
        props.setdefault("name", props.get("text") or props.get("block") or lname)
        features.append({"type": "Feature", "properties": props, "geometry": geom})
        report["converted"][kind] += 1

    def line_from_vertices(verts: list[Any], closed: bool) -> list[tuple[float, float, float]]:
        pts = [(float(v.x), float(v.y), float(v.z)) for v in verts]
        if closed and pts and pts[0] != pts[-1]:
            pts.append(pts[0])
        return pts

    msp = doc.modelspace()
    for e in msp:
        t = e.dxftype()
        if not layer_visible(e.dxf.layer):
            report["skipped"][f"{t} (hidden/filtered layer)"] += 1
            continue
        try:
            if t == "POINT":
                p = e.dxf.location
                add({"type": "Point", "coordinates": project([(p.x, p.y, p.z)])[0]}, e, "POINT", zs=[p.z])
            elif t in ("TEXT", "MTEXT"):
                p = e.dxf.insert
                text = (e.plain_text() if t == "MTEXT" else e.dxf.text).strip()
                if not text:
                    report["skipped"][f"{t} (empty)"] += 1
                    continue
                add({"type": "Point", "coordinates": project([(p.x, p.y, p.z)])[0]}, e, t, {"text": text}, zs=[p.z])
            elif t == "INSERT":
                p = e.dxf.insert
                attrs = {a.dxf.tag: a.dxf.text for a in e.attribs} if e.has_attrib else {}
                extra: dict[str, Any] = {"block": e.dxf.name}
                if attrs:
                    extra["attributes"] = attrs
                add({"type": "Point", "coordinates": project([(p.x, p.y, p.z)])[0]}, e, "INSERT", extra, zs=[p.z])
            elif t == "LINE":
                s, d = e.dxf.start, e.dxf.end
                pts = [(s.x, s.y, s.z), (d.x, d.y, d.z)]
                add({"type": "LineString", "coordinates": project(pts)}, e, "LINE", zs=[s.z, d.z])
            elif t in ("LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "ELLIPSE", "SPLINE"):
                if t == "POLYLINE" and (e.is_polygon_mesh or e.is_poly_face_mesh):
                    report["skipped"]["POLYLINE (mesh)"] += 1
                    continue
                p = ezpath.make_path(e)
                verts = list(p.flattening(distance=arc_tolerance, segments=4))
                closed = bool(getattr(e, "is_closed", False)) or t in ("CIRCLE", "ELLIPSE") or p.is_closed
                pts = line_from_vertices(verts, closed)
                if len(pts) < 2:
                    report["skipped"][f"{t} (no geometry)"] += 1
                    continue
                zs = [q[2] for q in pts]
                if closed_as_polygon and closed and len(pts) >= 4:
                    add({"type": "Polygon", "coordinates": [project(pts)]}, e, t, zs=zs)
                else:
                    add({"type": "LineString", "coordinates": project(pts)}, e, t, zs=zs)
            elif t == "HATCH":
                rings = []
                for bp in ezpath.from_hatch(e):
                    pts = line_from_vertices(list(bp.flattening(distance=arc_tolerance, segments=4)), True)
                    if len(pts) >= 4:
                        rings.append(pts)
                if not rings:
                    report["skipped"]["HATCH (no boundary)"] += 1
                    continue
                rings.sort(key=lambda r: -abs(_ring_area([(q[0], q[1]) for q in r])))
                polys: list[list[list[tuple[float, float, float]]]] = []
                for ring in rings:
                    xy = (ring[0][0], ring[0][1])
                    host = next((pl for pl in polys if _inside(xy, [(q[0], q[1]) for q in pl[0]])), None)
                    if host is not None:
                        host.append(ring)
                    else:
                        polys.append([ring])
                for pl in polys:
                    add({"type": "Polygon", "coordinates": [project(r) for r in pl]}, e, "HATCH",
                        {"hatch_pattern": e.dxf.pattern_name}, zs=[q[2] for r in pl for q in r])
            else:
                report["skipped"][t] += 1
        except ConvertError:
            raise
        except Exception as ex:   # one broken entity must not abort the file
            report["skipped"][f"{t} (error: {type(ex).__name__})"] += 1

    # bbox and sanity
    lons = [c[0] for f in features for c in _coords(f["geometry"])]
    lats = [c[1] for f in features for c in _coords(f["geometry"])]
    bbox = [min(lons), min(lats), max(lons), max(lats)] if lons else None
    report["bbox"] = bbox
    report["feature_count"] = len(features)
    report["has_z"] = stats["any_z"]
    if stats["n_geoid_missing"]:
        report["warnings"].append(f"{stats['n_geoid_missing']} vertices are outside the bundled geoid grid: their heights were left unchanged.")
    fc = {"type": "FeatureCollection", "features": features}
    return fc, report


def _coords(g: dict):
    if g["type"] == "Point":
        yield g["coordinates"]
    elif g["type"] == "LineString":
        yield from g["coordinates"]
    elif g["type"] == "Polygon":
        for r in g["coordinates"]:
            yield from r


def haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(a))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Convert a DXF (surveyor / CAD drawing) to GeoJSON in WGS84 for the QuadSpectat viewer. DWG: export a DXF first.")
    ap.add_argument("input", type=Path, help="input .dxf file")
    ap.add_argument("-o", "--output", type=Path, help="output .geojson (default: next to the input)")
    ap.add_argument("--source-crs", default=DEFAULT_SOURCE_CRS,
                    help="coordinate system of the DXF numbers: " + "; ".join(f"{k} = {v}" for k, v in KNOWN_CRS.items())
                         + f". Default {DEFAULT_SOURCE_CRS}. Any other EPSG code known to pyproj also works.")
    ap.add_argument("--heights", choices=["ellipsoidal", "orthometric"], default="ellipsoidal",
                    help="meaning of the DXF z values. ellipsoidal (default): written unchanged. orthometric: heights above "
                         "sea level, converted to ellipsoid heights by adding the EGM2008 geoid height (grid from "
                         "frontend/src/lib/geoid.ts; the Israeli national geoid can differ by a few decimetres).")
    ap.add_argument("--drop-z", action="store_true", help="ignore all heights (the viewer then drapes the layer on the model)")
    ap.add_argument("--closed-as-polygon", action="store_true", help="write closed polylines/circles as Polygons (default: closed LineStrings)")
    ap.add_argument("--arc-tolerance", type=float, default=0.05, help="max distance in metres between an arc and its straight segments (default 0.05)")
    ap.add_argument("--precision", type=int, default=7, help="decimals for lon/lat (7 is about 1 cm, default)")
    ap.add_argument("--only-layers", help="comma separated DXF layer names to keep")
    ap.add_argument("--skip-layers", help="comma separated DXF layer names to drop")
    ap.add_argument("--include-hidden-layers", action="store_true", help="also convert layers that are off or frozen")
    ap.add_argument("--geoid-file", type=Path, help="path to frontend/src/lib/geoid.ts (only for --heights orthometric)")
    ap.add_argument("--near", help="LAT,LON of the model: warn when the result is further away than --max-km")
    ap.add_argument("--max-km", type=float, default=20.0, help="distance for --near (default 20 km)")
    a = ap.parse_args(argv)

    split = lambda s: {x.strip() for x in s.split(",") if x.strip()} if s else None  # noqa: E731
    try:
        fc, rep = convert(a.input, a.source_crs, a.heights, a.arc_tolerance, a.precision, a.drop_z, a.closed_as_polygon,
                          split(a.only_layers), split(a.skip_layers), a.include_hidden_layers, a.geoid_file)
    except ConvertError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    out = a.output or a.input.with_suffix(".geojson")
    text = json.dumps(fc, ensure_ascii=False, separators=(",", ":"))
    out.write_text(text, encoding="utf-8")
    size = len(text.encode("utf-8"))

    print(f"Input        : {a.input.name}")
    print(f"Source CRS   : {rep['source_crs']}  ({KNOWN_CRS.get(rep['source_crs'], 'user supplied')})")
    print(f"Heights      : {'none (2D, will be draped on the model)' if not rep['has_z'] else 'kept from the DXF (' + rep['heights'] + ')'}")
    print(f"Features     : {rep['feature_count']}   " + ", ".join(f"{k} {v}" for k, v in sorted(rep["converted"].items())))
    if rep["skipped"]:
        print("Skipped      : " + ", ".join(f"{k} x{v}" for k, v in sorted(rep["skipped"].items())))
    if rep["bbox"]:
        w, s, e, n = rep["bbox"]
        print(f"Bounding box : lon {w:.6f}..{e:.6f}  lat {s:.6f}..{n:.6f}")
        print(f"Centre       : lat {(s + n) / 2:.6f}  lon {(w + e) / 2:.6f}   (check this on a map)")
    warnings = list(rep["warnings"])
    if rep["bbox"]:
        w, s, e, n = rep["bbox"]
        if rep["source_crs"] == "EPSG:2039" and not (29.0 < (s + n) / 2 < 34.0 and 33.5 < (w + e) / 2 < 36.5):
            warnings.append("The result is outside Israel: --source-crs EPSG:2039 does not fit these numbers. Is the file in the old grid (EPSG:28193)?")
        if a.near:
            lat0, lon0 = (float(x) for x in a.near.split(","))
            d = haversine_km((w + e) / 2, (s + n) / 2, lon0, lat0)
            print(f"Distance to model: {d:.2f} km")
            if d > a.max_km:
                warnings.append(f"The layer centre is {d:.1f} km from the model ({a.near}): wrong --source-crs?")
    if rep["feature_count"] == 0:
        warnings.append("No features were converted: check --only-layers / hidden layers.")
    if rep["feature_count"] > SERVER_MAX_FEATURES:
        warnings.append(f"{rep['feature_count']} features: the server refuses more than {SERVER_MAX_FEATURES:,}. Split with --only-layers.")
    elif rep["feature_count"] > SERVER_WARN_FEATURES:
        warnings.append(f"{rep['feature_count']} features: may be slow on phones (warning above {SERVER_WARN_FEATURES:,}).")
    if size > SERVER_MAX_BYTES:
        warnings.append(f"The file is {size / 1048576:.1f} MB: the server limit is 25 MB. Split it or use a smaller --precision.")
    for w_ in warnings:
        print(f"WARNING      : {w_}")
    print(f"Wrote        : {out}  ({size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
