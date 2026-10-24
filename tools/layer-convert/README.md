# layer-convert: DXF to GeoJSON (WGS84) for the Layers panel

A local helper (not part of the server) that turns a surveyor's DXF into a GeoJSON file the viewer accepts.
The viewer stores and serves layers in WGS84. It shows each feature's coordinates in WGS84 or in Israel ITM (EPSG:2039).

Pure pip packages only (`ezdxf`, `pyproj`): no GDAL, no QGIS.

## Use

Windows: drag a `.dxf` onto `layer-convert.bat` (first run creates `.venv` and installs the two packages), or:

```
layer-convert.bat "C:\jobs\site7\survey.dxf" --source-crs EPSG:2039 --near 32.83,34.97
```

Any system with Python 3.9+:

```
pip install -r requirements.txt
python layer_convert.py survey.dxf --source-crs EPSG:2039 -o survey.geojson
```

Then upload `survey.geojson` in the viewer: Layers panel, source coordinate system **WGS84** (the file is already WGS84).

### The source coordinate system is not optional knowledge

A DXF has no coordinate system. You must say which one the numbers are in:

| `--source-crs` | Meaning |
|---|---|
| `EPSG:2039` (default) | Israel TM Grid (ITM). Eastings about 100,000 to 300,000, northings about 350,000 to 800,000 |
| `EPSG:28193` | Old Israeli CS grid. Northings about 1,2xx,xxx |
| `EPSG:28191` | Old Palestine grid. Northings about 2xx,xxx |
| `EPSG:4326` | The numbers are already longitude/latitude |

Any other EPSG code that pyproj knows also works. A wrong choice does not fail silently: the report prints the
bounding box and centre, `--near LAT,LON` (the model's position) warns when the result is further than `--max-km`
(default 20) away, and the server also refuses coordinates that still look projected.

### Options worth knowing

| Option | Effect |
|---|---|
| `--heights ellipsoidal` (default) | DXF z values are written unchanged. |
| `--heights orthometric` | z values are heights above sea level: the EGM2008 geoid height is added (grid read from `frontend/src/lib/geoid.ts`, the one the viewer uses). The Israeli national geoid can differ by a few decimetres. |
| `--drop-z` | Ignore all heights. The viewer then drapes the layer on the model (its default for 2D files). |
| `--only-layers A,B` / `--skip-layers C` | Choose DXF layers. Layers that are off or frozen are skipped unless `--include-hidden-layers`. |
| `--closed-as-polygon` | Closed polylines and circles become filled polygons instead of closed lines. |
| `--arc-tolerance 0.05` | Maximum distance (m) between an arc/circle and its straight segments. |
| `--precision 7` | Decimals of longitude/latitude (7 is about 1 cm). |

## What is converted

Model space only. Each feature keeps `dxf_layer`, `dxf_type`, `handle`, `color` (plus `stroke`, `marker-color` or `fill`,
which the viewer draws), `elevation` (mean z when the entity has heights), `text` and `block` where they apply.

| DXF | GeoJSON |
|---|---|
| LINE, LWPOLYLINE, POLYLINE (2D and 3D; bulges become arcs) | LineString |
| POINT | Point |
| CIRCLE, ARC, ELLIPSE, SPLINE | LineString, densified |
| TEXT, MTEXT | Point with `text` (Hebrew is kept, UTF-8) |
| INSERT (block reference) | Point with `block` (and attribute values) |
| HATCH | Polygon, outer ring plus holes |

Not converted, and listed in the report: DIMENSION, 3DFACE, MESH, images, the geometry inside blocks (a block
reference becomes one point), paper space. Entities with heights keep them as a third coordinate; entities without
stay 2D, so a file with a few 3D lines and many 2D lines is a "has heights" file: split it with `--only-layers`
or use `--drop-z`.

## DWG is not supported

Nothing in this tool reads DWG. Export a DXF from AutoCAD (`SAVEAS`, "AutoCAD DXF", 2013 or older is safest) or convert
the DWG with the free ODA File Converter, then run this script on the DXF. The script refuses a `.dwg` with this hint.

## Heights and how the viewer uses them

The viewer's **Drape on model** placement ignores heights and follows the surface (default for files without heights).
**File heights** places each vertex at the z in the file, read as an ellipsoid height in the model's own frame.
That frame is shifted by the model's stored height offset (about 54 m for the Haifa demo), so surveyed heights can
appear tens of metres off. Check one known benchmark before relying on file heights, or use Drape.

## Datum note

ITM sits on the Israel 1993 datum, which is not identical to WGS84. A plain Transverse Mercator formula without the
datum shift is about 78 m off near Haifa. This tool (pyproj, EPSG operation "Israel 1993 to WGS 84 (2)"), the server
(proj4 with the same parameters) and the layer coordinate card in the viewer agree to better than 1 cm.

## Tests

```
python -m unittest test_layer_convert -v
python make_sample_dxf.py sample.dxf --lat 32.83007 --lon 34.97041     # sample on the Haifa demo model
```
