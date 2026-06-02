# COG Converter

A local desktop app that converts raster files to **Cloud Optimized GeoTIFF (COG)** format using GDAL. No cloud uploads — all processing happens on your machine.

## Supported input formats

GeoTIFF, TIFF, IMG, JP2, PNG, JPEG, VRT, NetCDF, HDF4/5, and any format GDAL can read.

---

## Setup

### Option A — Conda (recommended, easiest GDAL install)

```bat
conda create -n cog-converter python=3.11 -y
conda activate cog-converter
conda install -c conda-forge gdal pyside6 -y
python main.py
```

### Option B — pip (requires GDAL system library already installed)

```bat
pip install PySide6 GDAL
python main.py
```

> **Windows tip**: If `pip install GDAL` fails, use the pre-built wheel from
> [Christoph Gohlke's site](https://github.com/cgohlke/geospatial-wheels/releases)
> matching your Python version, or use Option A instead.

---

## Usage

1. **Add files** — drag and drop rasters onto the file list, or click *Add Files…*
2. **Configure settings** in the right panel:
   - **Compression** — DEFLATE (default) is lossless and well-supported; JPEG is lossy (uint8 only)
   - **Overview Resampling** — NEAREST is fastest; BILINEAR/CUBIC give smoother previews
   - **Tile Size** — 512×512 is the standard COG tile size
   - **Overview Levels** — AUTO computes optimal levels based on image dimensions
3. **Output Directory** — leave blank to save alongside the input files
4. Click **Convert**

Output files are named `<original_name>_cog.tif` (the suffix is configurable).

---

## COG validation