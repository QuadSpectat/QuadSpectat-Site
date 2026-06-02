import os
import time
from pathlib import Path
from PySide6.QtCore import QThread, Signal


class ConversionWorker(QThread):
    progress = Signal(int, int)             # current_idx, total
    file_started = Signal(str)              # input path
    file_done = Signal(str, float, bool, str)  # input_path, elapsed_s, success, output_or_error
    finished = Signal()

    def __init__(self, files: list, output_dir: str | None, settings: dict):
        super().__init__()
        self.files = files
        self.output_dir = output_dir
        self.settings = settings
        self._cancelled = False

    def cancel(self):
        self._cancelled = True

    # ------------------------------------------------------------------ QThread

    def run(self):
        try:
            from osgeo import gdal
            gdal.UseExceptions()
        except ImportError:
            self.file_done.emit(
                "", 0.0, False,
                "GDAL Python bindings not found.\n"
                "Install with: conda install -c conda-forge gdal"
            )
            self.finished.emit()
            return

        total = len(self.files)
        for idx, input_path in enumerate(self.files):
            if self._cancelled:
                break
            self.file_started.emit(input_path)
            self.progress.emit(idx, total)
            t0 = time.time()
            try:
                out = self._output_path(input_path)
                if not self.settings.get("overwrite") and Path(out).exists():
                    raise FileExistsError(f"Output already exists: {Path(out).name}")
                self._convert(gdal, input_path, out)
                self.file_done.emit(input_path, time.time() - t0, True, out)
            except Exception as exc:
                self.file_done.emit(input_path, time.time() - t0, False, str(exc))

        self.progress.emit(total, total)
        self.finished.emit()

    # ------------------------------------------------------------------ helpers

    def _output_path(self, input_path: str) -> str:
        p = Path(input_path)
        suffix = self.settings.get("suffix", "_cog")
        name = p.stem + suffix + ".tif"
        base = Path(self.output_dir) if self.output_dir else p.parent
        base.mkdir(parents=True, exist_ok=True)
        return str(base / name)

    def _convert(self, gdal, input_path: str, output_path: str):
        s = self.settings
        compression = s.get("compression", "JPEG")
        tile_size = s.get("tile_size", 512)
        resampling = s.get("resampling", "BILINEAR")
        overview_levels = s.get("overview_levels", "AUTO")
        jpeg_quality = int(s.get("jpeg_quality", 75))
        # Predictor: 2 = horizontal differencing (int data), 1 = none, not valid for JPEG/WEBP
        predictor = "2" if compression in ("DEFLATE", "LZW", "ZSTD") else "1"

        src_ds = gdal.Open(input_path)
        if src_ds is None:
            raise IOError(f"Cannot open: {input_path}")

        try:
            if gdal.GetDriverByName("COG") is not None:
                self._convert_cog_driver(gdal, src_ds, output_path,
                                         compression, tile_size,
                                         resampling, overview_levels, predictor,
                                         jpeg_quality)
            else:
                self._convert_legacy(gdal, src_ds, output_path,
                                     compression, tile_size,
                                     resampling, overview_levels, predictor,
                                     jpeg_quality)
        finally:
            src_ds = None

    def _convert_cog_driver(self, gdal, src_ds, output_path,
                             compression, tile_size, resampling,
                             overview_levels, predictor, jpeg_quality=75):
        """Native COG driver — GDAL >= 3.1."""
        opts = [
            f"COMPRESS={compression}",
            f"BLOCKSIZE={tile_size}",
            f"OVERVIEW_RESAMPLING={resampling}",
        ]
        if compression in ("JPEG", "WEBP"):
            opts.append(f"QUALITY={jpeg_quality}")
        else:
            opts.append(f"PREDICTOR={predictor}")
        if overview_levels != "AUTO":
            opts.append(f"OVERVIEW_COUNT={len(overview_levels.split())}")

        dst = gdal.GetDriverByName("COG").CreateCopy(
            output_path, src_ds, 0, opts
        )
        if dst is None:
            raise RuntimeError(f"COG CreateCopy failed for {output_path}")
        dst = None  # flush & close

    def _convert_legacy(self, gdal, src_ds, output_path,
                        compression, tile_size, resampling,
                        overview_levels, predictor, jpeg_quality=75):
        """Fallback for GDAL < 3.1: tiled GeoTIFF + overviews + COPY_SRC_OVERVIEWS."""
        import tempfile

        tmp_path = output_path + ".tmp.tif"
        try:
            tiff_opts = [
                "TILED=YES",
                f"BLOCKXSIZE={tile_size}",
                f"BLOCKYSIZE={tile_size}",
                f"COMPRESS={compression}",
                "BIGTIFF=IF_SAFER",
            ]
            if compression in ("JPEG", "WEBP"):
                tiff_opts.append(f"JPEG_QUALITY={jpeg_quality}")
            else:
                tiff_opts.append(f"PREDICTOR={predictor}")
            tmp_ds = gdal.GetDriverByName("GTiff").CreateCopy(
                tmp_path, src_ds, 0, tiff_opts
            )
            if tmp_ds is None:
                raise RuntimeError("Failed to create temporary GeoTIFF")

            # Build overviews
            if overview_levels == "AUTO":
                # Build levels until smallest overview < 512 px
                w, h = tmp_ds.RasterXSize, tmp_ds.RasterYSize
                levels = []
                lv = 2
                while w // lv > 256 or h // lv > 256:
                    levels.append(lv)
                    lv *= 2
            else:
                levels = [int(x) for x in overview_levels.split()]

            if levels:
                tmp_ds.BuildOverviews(resampling, levels)

            # Write final COG
            cog_opts = [
                "TILED=YES",
                f"BLOCKXSIZE={tile_size}",
                f"BLOCKYSIZE={tile_size}",
                f"COMPRESS={compression}",
                "COPY_SRC_OVERVIEWS=YES",
                "BIGTIFF=IF_SAFER",
            ]
            if compression in ("JPEG", "WEBP"):
                cog_opts.append(f"JPEG_QUALITY={jpeg_quality}")
            else:
                cog_opts.append(f"PREDICTOR={predictor}")
            cog_ds = gdal.GetDriverByName("GTiff").CreateCopy(
                output_path, tmp_ds, 0, cog_opts
            )
            if cog_ds is None:
                raise RuntimeError("Failed to write COG output")
            cog_ds = None
            tmp_ds = None
        finally:
            if Path(tmp_path).exists():
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
