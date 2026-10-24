# COG Converter

A local desktop app that converts rasters to **Cloud-Optimized GeoTIFF (COG)** with GDAL, ready for the
QuadSpectat viewer (EPSG:3857). Everything runs on this PC. Start it with the Desktop shortcut or
`start-cog-converter.cmd` (uses the conda environment `cog-converter`).

## What it does

1. **Preset** - pick what the file is for:
   - *Aerial photo / orthophoto*: JPEG q85, average overviews (about 10x smaller than lossless).
   - *Overlay / client map*: lossless DEFLATE with transparency; white (or black) background becomes see-through.
   - *Elevation / measurements*: lossless, no-data kept.
2. **Coordinate system** - converts to Web Mercator (EPSG:3857) in the same pass (the viewer only shows 3857).
   The file's CRS is read automatically; type one (e.g. `EPSG:2039`) only for files that have none.
3. **Upload to viewer** (optional) - logs in with the admin login from `.env`, uploads to storage and adds the file
   as a layer of an *existing* asset (pick it from the list). Files over 5 GB are converted but not uploaded
   (single-upload limit of the storage).
4. Progress bar with time left, **Cancel**, per-file results table, **Open folder**.

Output name: `<name>_3857_cog.tif` (or `<name>_cog.tif` when not reprojected) next to the input, or in the chosen folder.

### Upload login
Copy `.env.example` to `.env` (same folder as `main.py`) and fill in `QS_ADMIN_USER` / `QS_ADMIN_PASSWORD`.
The file stays on this PC (`.gitignore` excludes it). Optional `QS_API=` overrides the server address.

### Command line (same engine)
```
start-cog-converter.cmd --cli "D:\maps\plan.tif" --preset overlay --asset "Bat Hefer" --upload
start-cog-converter.cmd --cli "D:\flights\site.tif" --out-dir E:\out
```

## Why these defaults (measured on this PC, 2 GB test ortho, ITM to 3857)
Reprojecting with GDAL's multithreaded warp straight into the COG driver, with a big cache, takes about 45 s instead of
about 80 s with a plain `gdalwarp`; JPEG output is 149 MB instead of 1.8 GB lossless.

Notes:
- JPEG cannot hold transparency. In the viewer, empty edges of a JPEG COG look black. Use the Overlay preset or tick
  *Keep transparent edges* if that matters.
- The viewer can display JPEG, DEFLATE, LZW, uncompressed. ZSTD / WEBP / LERC files are fine for other software but not for the viewer.

## Formats
Anything this GDAL build can read: GeoTIFF, IMG, PNG, JPEG, VRT, NetCDF, HDF.
**JPEG2000 (.jp2) and ECW (.ecw) are NOT readable with the current conda GDAL** (no JP2OpenJPEG and no ECW driver).

### JPEG2000
Free fix, no licence prompt:
`conda install -n cog-converter -c conda-forge libgdal-jp2openjpeg` (about 0.8 MB).

### ECW
ECW is a licensed Hexagon format; free GDAL builds do not include the reader. Options, cheapest first:
1. Ask the sender for a GeoTIFF, JPEG2000 or PNG + world-file export.
2. Install QGIS from qgis.org (the offline Windows installer includes ECW read support; you accept Hexagon's licence in the installer).
   This app then finds it automatically (`C:\Program Files\QGIS x.y\bin`, `C:\OSGeo4W\bin`), or set the folder under
   *Advanced > External GDAL folder*. The ECW file is decoded by that GDAL to a temporary GeoTIFF, then converted here.
The **ECW** badge at the top shows whether an ECW reader was found.

## Files
```
main.py            GUI entry point            cli.py             command line
src/converter.py   conversion engine          src/uploader.py    upload to the viewer
src/main_window.py PySide6 window             start-cog-converter.cmd
```
