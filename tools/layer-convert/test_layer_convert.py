"""Tests for layer_convert.py:  python -m unittest test_layer_convert -v   (needs ezdxf + pyproj, see requirements.txt)"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from layer_convert import ConvertError, convert, haversine_km
from make_sample_dxf import build_sample

HERE = Path(__file__).resolve().parent
LAT, LON = 32.830, 34.979


def points_of(g):
    if g["type"] == "Point":
        return [g["coordinates"]]
    if g["type"] == "LineString":
        return g["coordinates"]
    return [c for ring in g["coordinates"] for c in ring]


class ConvertTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dxf = Path(cls.tmp.name) / "sample_itm.dxf"
        build_sample(cls.dxf, LAT, LON)
        cls.fc, cls.rep = convert(cls.dxf)
        cls.by_type = {}
        for f in cls.fc["features"]:
            cls.by_type.setdefault(f["properties"]["dxf_type"], []).append(f)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_everything_lands_near_the_expected_place(self):
        # the sample is centred on 32.830 N, 34.979 E; its entities span a few hundred metres
        for f in self.fc["features"]:
            for lon, lat, *_ in points_of(f["geometry"]):
                self.assertLess(haversine_km(lon, lat, LON, LAT), 0.5, f"{f['properties']['dxf_type']} at {lon},{lat}")
        w, s, e, n = self.rep["bbox"]
        self.assertAlmostEqual((s + n) / 2, LAT, delta=0.002)
        self.assertAlmostEqual((w + e) / 2, LON, delta=0.002)

    def test_entity_types(self):
        t = self.by_type
        self.assertEqual(len(t["LINE"]), 1)            # the ROAD line; the HIDDEN-layer line is skipped
        for kind in ("LWPOLYLINE", "POLYLINE", "POINT", "CIRCLE", "ARC", "TEXT", "MTEXT", "INSERT", "HATCH"):
            self.assertEqual(len(t[kind]), 1, kind)
        self.assertIn("DIMENSION", " ".join(self.rep["skipped"]))
        self.assertTrue(any("hidden" in k for k in self.rep["skipped"]))

    def test_geometry_kinds_and_densified_arcs(self):
        t = self.by_type
        self.assertEqual(t["POINT"][0]["geometry"]["type"], "Point")
        self.assertEqual(t["LWPOLYLINE"][0]["geometry"]["type"], "LineString")
        ring = t["LWPOLYLINE"][0]["geometry"]["coordinates"]
        self.assertEqual(ring[0][:2], ring[-1][:2], "closed polyline is a closed line")
        self.assertGreater(len(ring), 6, "the bulge arc is densified")
        self.assertGreater(len(t["CIRCLE"][0]["geometry"]["coordinates"]), 16, "circle is densified")
        self.assertGreater(len(t["ARC"][0]["geometry"]["coordinates"]), 8)
        poly = t["HATCH"][0]["geometry"]
        self.assertEqual(poly["type"], "Polygon")
        self.assertEqual(len(poly["coordinates"]), 2, "outer ring plus one hole")

    def test_properties_kept(self):
        t = self.by_type
        self.assertEqual(t["LWPOLYLINE"][0]["properties"]["dxf_layer"], "PARCELS")
        self.assertEqual(t["LWPOLYLINE"][0]["properties"]["color"], "#00ff00")       # ACI 3 via the layer colour
        self.assertEqual(t["TEXT"][0]["properties"]["text"], "Benchmark BM-7 נקודה")
        self.assertIn("Parcel 12/3", t["MTEXT"][0]["properties"]["text"])
        self.assertEqual(t["INSERT"][0]["properties"]["block"], "TREE")
        self.assertEqual(t["INSERT"][0]["properties"]["name"], "TREE")

    def test_heights_kept_as_z_and_as_elevation(self):
        cable = self.by_type["POLYLINE"][0]
        zs = [c[2] for c in cable["geometry"]["coordinates"]]
        self.assertEqual(zs, [60, 80, 85, 62])
        self.assertAlmostEqual(cable["properties"]["elevation"], 71.75, places=2)
        self.assertEqual(len(self.by_type["LINE"][0]["geometry"]["coordinates"][0]), 2, "2D entities stay 2D")
        self.assertTrue(self.rep["has_z"])

    def test_orthometric_adds_geoid_height(self):
        fc, _ = convert(self.dxf, heights="orthometric")
        cable = [f for f in fc["features"] if f["properties"]["dxf_type"] == "POLYLINE"][0]
        dz = cable["geometry"]["coordinates"][0][2] - 60
        self.assertGreater(dz, 15)   # EGM2008 N is about 18-19 m around Haifa
        self.assertLess(dz, 21)

    def test_wgs84_passthrough_and_drop_z(self):
        fc, _ = convert(self.dxf, source_crs="EPSG:4326", drop_z=True)
        for f in fc["features"]:
            if f["geometry"]["type"] == "Point":
                self.assertEqual(len(f["geometry"]["coordinates"]), 2)

    def test_dwg_is_refused_with_instructions(self):
        with self.assertRaises(ConvertError) as cm:
            convert(Path("x.dwg"))
        self.assertIn("DXF", str(cm.exception))

    def test_wrong_crs_is_detectable(self):
        # the same numbers read as the old grid land far from Haifa; the report bbox shows it
        _fc, rep = convert(self.dxf, source_crs="EPSG:28191")
        w, s, e, n = rep["bbox"]
        self.assertGreater(haversine_km((w + e) / 2, (s + n) / 2, LON, LAT), 20)

    def test_cli_writes_geojson_the_server_accepts(self):
        out = Path(self.tmp.name) / "out.geojson"
        r = subprocess.run([sys.executable, str(HERE / "layer_convert.py"), str(self.dxf), "-o", str(out), "--near", f"{LAT},{LON}"],
                           capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(doc["type"], "FeatureCollection")
        for f in doc["features"]:
            for lon, lat, *_ in points_of(f["geometry"]):
                self.assertTrue(-180 <= lon <= 180 and -90 <= lat <= 90)
        self.assertIn("Centre", r.stdout)
        self.assertNotIn("WARNING", r.stdout)


if __name__ == "__main__":
    unittest.main()
