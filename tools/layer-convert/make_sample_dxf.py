#!/usr/bin/env python3
"""Writes a small sample DXF in ITM (EPSG:2039) around a WGS84 position, for testing layer_convert.py.

    python make_sample_dxf.py sample_itm.dxf                                  # near 32.830 N, 34.979 E
    python make_sample_dxf.py haifa_model.dxf --lat 32.83007 --lon 34.97041   # on the public Haifa demo model
"""
import argparse
from pathlib import Path

import ezdxf
from pyproj import Transformer


def build_sample(path: Path, lat: float = 32.830, lon: float = 34.979) -> tuple[float, float]:
    """Creates the DXF and returns the ITM (E, N) of the origin."""
    e0, n0 = Transformer.from_crs(4326, 2039, always_xy=True).transform(lon, lat)
    e0, n0 = round(e0), round(n0)
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 6   # metres
    doc.layers.add("PARCELS", color=3)
    doc.layers.add("ROAD", color=1)
    doc.layers.add("UTILITY_3D", color=5)
    doc.layers.add("NOTES", color=7)
    doc.layers.add("TREES", color=2)
    doc.layers.add("HIDDEN", color=6).off()
    msp = doc.modelspace()
    # parcel boundary: closed LWPOLYLINE with one bulge (arc) corner
    msp.add_lwpolyline([(e0 - 100, n0 - 100, 0), (e0 - 20, n0 - 100, 0), (e0 - 20, n0 - 30, 0.4), (e0 - 100, n0 - 30, 0)],
                       format="xyb", close=True, dxfattribs={"layer": "PARCELS"})
    msp.add_line((e0 - 200, n0 - 100), (e0 + 250, n0 + 150), dxfattribs={"layer": "ROAD"})
    # 3D polyline (cable) with heights
    msp.add_polyline3d([(e0 - 150, n0 + 50, 60), (e0 - 50, n0 + 60, 80), (e0 + 50, n0 + 60, 85), (e0 + 150, n0 + 50, 62)],
                       dxfattribs={"layer": "UTILITY_3D"})
    msp.add_point((e0, n0), dxfattribs={"layer": "NOTES"})
    msp.add_circle((e0 + 120, n0 + 80), 15, dxfattribs={"layer": "TREES"})
    msp.add_arc((e0 + 60, n0 - 60), 40, 30, 150, dxfattribs={"layer": "ROAD"})
    msp.add_text("Benchmark BM-7 נקודה", dxfattribs={"layer": "NOTES", "height": 2.5}).set_placement((e0 + 5, n0 + 5))
    msp.add_mtext("Parcel 12/3\\Parea 5,640 m2", dxfattribs={"layer": "NOTES", "insert": (e0 - 60, n0 - 65)})
    doc.blocks.new("TREE")
    msp.add_blockref("TREE", (e0 + 90, n0 - 20), dxfattribs={"layer": "TREES"})
    hatch = msp.add_hatch(color=3, dxfattribs={"layer": "PARCELS"})
    hatch.paths.add_polyline_path([(e0 + 100, n0 - 120), (e0 + 200, n0 - 120), (e0 + 200, n0 - 40), (e0 + 100, n0 - 40)], is_closed=True)
    hatch.paths.add_polyline_path([(e0 + 130, n0 - 100), (e0 + 170, n0 - 100), (e0 + 170, n0 - 60), (e0 + 130, n0 - 60)], is_closed=True)
    msp.add_line((e0, n0 - 300), (e0 + 10, n0 - 300), dxfattribs={"layer": "HIDDEN"})
    msp.add_linear_dim(base=(e0, n0 - 150), p1=(e0 - 100, n0 - 100), p2=(e0 - 20, n0 - 100)).render()   # skipped: DIMENSION
    doc.saveas(path)
    return e0, n0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("output", type=Path)
    ap.add_argument("--lat", type=float, default=32.830)
    ap.add_argument("--lon", type=float, default=34.979)
    a = ap.parse_args()
    print("origin ITM E,N =", build_sample(a.output, a.lat, a.lon))
