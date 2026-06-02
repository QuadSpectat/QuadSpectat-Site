from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QDragEnterEvent, QDropEvent
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QFileDialog, QFormLayout, QGroupBox,
    QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem,
    QMainWindow, QProgressBar, QPushButton, QSplitter, QTextEdit,
    QVBoxLayout, QWidget,
)

from .converter import ConversionWorker

SUPPORTED_EXT = {
    ".tif", ".tiff", ".img", ".hdr", ".jp2",
    ".png", ".jpg", ".jpeg", ".vrt", ".nc", ".h4", ".h5", ".hdf",
}


# --------------------------------------------------------------------------- #
#  Drop-enabled file list                                                      #
# --------------------------------------------------------------------------- #


class DropFileList(QListWidget):
    filesDropped = Signal(list)

    def __init__(self):
        super().__init__()
        self.setAcceptDrops(True)
        self.setAlternatingRowColors(True)
        self.setSelectionMode(QListWidget.SelectionMode.ExtendedSelection)

    def dragEnterEvent(self, event: QDragEnterEvent):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
        else:
            super().dragEnterEvent(event)

    def dragMoveEvent(self, event):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
        else:
            super().dragMoveEvent(event)

    def dropEvent(self, event: QDropEvent):
        paths = [u.toLocalFile() for u in event.mimeData().urls()]
        self.filesDropped.emit(paths)
        event.acceptProposedAction()


# --------------------------------------------------------------------------- #
#  Main window                                                                 #
# --------------------------------------------------------------------------- #

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("COG Converter")
        self.setMinimumSize(920, 680)
        self._files: list[str] = []
        self._worker: ConversionWorker | None = None

        self._build_ui()
        self._apply_style()
        self._check_gdal()

    def _apply_style(self):
        self.setStyleSheet("""
            QMainWindow, QWidget { background: #1e1e2e; color: #cdd6f4; font-size: 13px; }
            QGroupBox { border: 1px solid #45475a; border-radius: 6px; margin-top: 8px;
                        padding-top: 6px; font-weight: bold; color: #89b4fa; }
            QGroupBox::title { subcontrol-origin: margin; left: 10px; }
            QListWidget { background: #181825; border: 1px solid #45475a; border-radius: 4px;
                          alternate-background-color: #1e1e2e; }
            QListWidget::item:selected { background: #313244; color: #cdd6f4; }
            QTextEdit { background: #181825; border: 1px solid #45475a; border-radius: 4px;
                        font-family: Consolas, monospace; font-size: 11px; color: #a6e3a1; }
            QComboBox, QLineEdit { background: #313244; border: 1px solid #45475a;
                                   border-radius: 4px; padding: 3px 6px; color: #cdd6f4; }
            QComboBox::drop-down { border: none; }
            QComboBox QAbstractItemView { background: #313244; color: #cdd6f4;
                                          selection-background-color: #45475a; }
            QCheckBox { spacing: 6px; }
            QCheckBox::indicator { width: 14px; height: 14px; border: 1px solid #6c7086;
                                   border-radius: 3px; background: #313244; }
            QCheckBox::indicator:checked { background: #89b4fa; border-color: #89b4fa; }
            QPushButton { background: #313244; border: 1px solid #45475a; border-radius: 5px;
                          padding: 5px 14px; color: #cdd6f4; }
            QPushButton:hover { background: #45475a; }
            QPushButton:disabled { color: #6c7086; background: #1e1e2e; }
            QPushButton#btnConvert { background: #89b4fa; color: #1e1e2e; font-weight: bold;
                                     border: none; }
            QPushButton#btnConvert:hover { background: #b4befe; }
            QPushButton#btnConvert:disabled { background: #313244; color: #6c7086; }
            QPushButton#btnCancel { background: #f38ba8; color: #1e1e2e; font-weight: bold;
                                    border: none; }
            QPushButton#btnCancel:hover { background: #eba0ac; }
            QProgressBar { border: 1px solid #45475a; border-radius: 4px;
                           background: #313244; height: 16px; text-align: center; }
            QProgressBar::chunk { background: #89b4fa; border-radius: 3px; }
            QLabel#title { font-size: 18px; font-weight: bold; color: #89b4fa; }
            QLabel#badgeOk { color: #a6e3a1; font-size: 11px; }
            QLabel#badgeError { color: #f38ba8; font-size: 11px; }
            QLabel#badgeNeutral { color: #fab387; font-size: 11px; }
            QLabel#hint { color: #6c7086; font-size: 11px; }
            QSplitter::handle { background: #45475a; width: 2px; }
        """)

    # ------------------------------------------------------------------ build UI

    def _build_ui(self):
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.setSpacing(10)

        # Header row
        header = QHBoxLayout()
        title = QLabel("COG Converter")
        title.setObjectName("title")
        self._gdal_badge = QLabel("GDAL: checking…")
        self._gdal_badge.setObjectName("badgeNeutral")
        header.addWidget(title)
        header.addStretch()
        header.addWidget(self._gdal_badge)
        layout.addLayout(header)

        # ── Splitter: file list | settings ──────────────────────────────────
        splitter = QSplitter(Qt.Orientation.Horizontal)

        # Left – input files
        file_group = QGroupBox("Input Files")
        fl = QVBoxLayout(file_group)

        self._file_list = DropFileList()
        self._file_list.filesDropped.connect(self.add_files)
        fl.addWidget(self._file_list)

        hint = QLabel("Drag & drop raster files, or use Add Files")
        hint.setObjectName("hint")
        hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        fl.addWidget(hint)

        file_btns = QHBoxLayout()
        btn_add = QPushButton("＋ Add Files")
        btn_add.clicked.connect(self._browse_files)
        btn_remove = QPushButton("✕ Remove Selected")
        btn_remove.clicked.connect(self._remove_selected)
        btn_clear = QPushButton("Clear All")
        btn_clear.clicked.connect(self._clear_files)
        file_btns.addWidget(btn_add)
        file_btns.addWidget(btn_remove)
        file_btns.addWidget(btn_clear)
        fl.addLayout(file_btns)
        splitter.addWidget(file_group)

        # Right – settings
        settings_group = QGroupBox("Conversion Settings")
        sf = QFormLayout(settings_group)
        sf.setSpacing(8)

        self._combo_compression = QComboBox()
        self._combo_compression.addItems(["JPEG", "DEFLATE", "LZW", "ZSTD", "WEBP", "NONE"])
        self._combo_compression.setCurrentText("JPEG")
        self._combo_compression.currentTextChanged.connect(self._on_compression_changed)
        sf.addRow("Compression:", self._combo_compression)

        # JPEG quality row (shown only when JPEG selected)
        self._jpeg_quality_row_label = QLabel("JPEG quality (1-100):")
        self._edit_jpeg_quality = QLineEdit("75")
        self._edit_jpeg_quality.setPlaceholderText("75")
        sf.addRow(self._jpeg_quality_row_label, self._edit_jpeg_quality)

        # Compression hint label
        self._lbl_compression_hint = QLabel()
        self._lbl_compression_hint.setObjectName("hint")
        self._lbl_compression_hint.setWordWrap(True)
        sf.addRow("", self._lbl_compression_hint)
        self._on_compression_changed("JPEG")   # set initial hint

        self._combo_tile = QComboBox()
        self._combo_tile.addItems(["256", "512", "1024"])
        self._combo_tile.setCurrentText("512")
        sf.addRow("Tile size (px):", self._combo_tile)

        self._combo_resampling = QComboBox()
        self._combo_resampling.addItems(["BILINEAR", "NEAREST", "CUBIC", "LANCZOS", "AVERAGE"])
        self._combo_resampling.setCurrentText("BILINEAR")
        sf.addRow("Overview resampling:", self._combo_resampling)

        self._combo_overviews = QComboBox()
        self._combo_overviews.addItems(["AUTO", "2 4 8 16 32", "2 4 8 16", "NONE"])
        sf.addRow("Overview levels:", self._combo_overviews)

        self._edit_suffix = QLineEdit("_cog")
        sf.addRow("Output suffix:", self._edit_suffix)

        self._chk_overwrite = QCheckBox("Overwrite existing files")
        sf.addRow("", self._chk_overwrite)

        # Output directory
        out_row = QHBoxLayout()
        self._edit_outdir = QLineEdit()
        self._edit_outdir.setPlaceholderText("Same folder as input (default)")
        btn_browse_out = QPushButton("Browse…")
        btn_browse_out.clicked.connect(self._browse_output_dir)
        out_row.addWidget(self._edit_outdir)
        out_row.addWidget(btn_browse_out)
        sf.addRow("Output folder:", out_row)

        splitter.addWidget(settings_group)
        splitter.setSizes([480, 380])
        layout.addWidget(splitter, stretch=1)

        # ── Progress ────────────────────────────────────────────────────────
        self._progress = QProgressBar()
        self._progress.setValue(0)
        layout.addWidget(self._progress)

        # ── Log ─────────────────────────────────────────────────────────────
        log_group = QGroupBox("Log")
        lg = QVBoxLayout(log_group)
        self._log = QTextEdit()
        self._log.setReadOnly(True)
        self._log.setMaximumHeight(160)
        lg.addWidget(self._log)
        layout.addWidget(log_group)

        # ── Action buttons ───────────────────────────────────────────────────
        action_row = QHBoxLayout()
        action_row.addStretch()

        self._btn_cancel = QPushButton("Cancel")
        self._btn_cancel.setObjectName("btnCancel")
        self._btn_cancel.setEnabled(False)
        self._btn_cancel.clicked.connect(self._cancel_conversion)

        self._btn_convert = QPushButton("⚡  Convert")
        self._btn_convert.setObjectName("btnConvert")
        self._btn_convert.setEnabled(False)
        self._btn_convert.clicked.connect(self._start_conversion)

        action_row.addWidget(self._btn_cancel)
        action_row.addWidget(self._btn_convert)
        layout.addLayout(action_row)

    # ------------------------------------------------------------------ compression hint

    def _on_compression_changed(self, compression: str):
        hints = {
            "JPEG":    "Lossy — 5–10× smaller. Best for aerial/drone orthophotos. Avoids banding.",
            "DEFLATE": "Lossless — 10–30% smaller. Good for elevation data or when exact values matter.",
            "LZW":     "Lossless — similar to DEFLATE. Compatible with older software.",
            "ZSTD":    "Lossless — faster & better than DEFLATE. Requires GDAL 2.3+.",
            "WEBP":    "Lossy/lossless — very small. Requires GDAL 3.4+.",
            "NONE":    "No compression — largest file. Fastest read/write.",
        }
        self._lbl_compression_hint.setText(hints.get(compression, ""))
        show_quality = compression in ("JPEG", "WEBP")
        self._jpeg_quality_row_label.setVisible(show_quality)
        self._edit_jpeg_quality.setVisible(show_quality)

    # ------------------------------------------------------------------ GDAL check

    def _check_gdal(self):
        try:
            from osgeo import gdal
            ver = gdal.__version__
            has_cog = gdal.GetDriverByName("COG") is not None
            cog_str = "COG ✓" if has_cog else "no COG driver"
            self._gdal_badge.setText(f"GDAL {ver}  {cog_str}  ✓")
            self._gdal_badge.setObjectName("badgeOk")
            self._gdal_badge.style().unpolish(self._gdal_badge)
            self._gdal_badge.style().polish(self._gdal_badge)
            if not has_cog:
                self._log_msg("⚠ GDAL COG driver not available — will use legacy method.")
        except ImportError:
            self._gdal_badge.setText("GDAL not found ✗")
            self._gdal_badge.setObjectName("badgeError")
            self._gdal_badge.style().unpolish(self._gdal_badge)
            self._gdal_badge.style().polish(self._gdal_badge)
            self._log_msg(
                "⚠ GDAL not found.\n"
                "  Use the 'COG Converter.bat' launcher (it loads QGIS GDAL automatically).\n"
                "  Or install via: conda install -c conda-forge gdal"
            )

    # ------------------------------------------------------------------ file management

    def add_files(self, paths: list[str]):
        added = 0
        for path in paths:
            ext = Path(path).suffix.lower()
            if ext not in SUPPORTED_EXT:
                self._log_msg(f"⚠ Skipped (unsupported format): {Path(path).name}")
                continue
            if path not in self._files:
                self._files.append(path)
                self._file_list.addItem(path)
                added += 1
        if added:
            self._btn_convert.setEnabled(True)

    def _browse_files(self):
        exts = " ".join(f"*{e}" for e in sorted(SUPPORTED_EXT))
        paths, _ = QFileDialog.getOpenFileNames(
            self, "Select raster files", "", f"Raster files ({exts});;All files (*)"
        )
        if paths:
            self.add_files(paths)

    def _remove_selected(self):
        for item in self._file_list.selectedItems():
            row = self._file_list.row(item)
            self._file_list.takeItem(row)
            self._files.pop(row)
        if not self._files:
            self._btn_convert.setEnabled(False)

    def _clear_files(self):
        self._files.clear()
        self._file_list.clear()
        self._btn_convert.setEnabled(False)

    def _browse_output_dir(self):
        folder = QFileDialog.getExistingDirectory(self, "Select output folder")
        if folder:
            self._edit_outdir.setText(folder)

    # ------------------------------------------------------------------ conversion

    def _build_settings(self) -> dict:
        compression = self._combo_compression.currentText()
        try:
            quality = max(1, min(100, int(self._edit_jpeg_quality.text().strip() or "75")))
        except ValueError:
            quality = 75
        return {
            "compression":    compression,
            "jpeg_quality":   quality,
            "tile_size":      int(self._combo_tile.currentText()),
            "resampling":     self._combo_resampling.currentText(),
            "overview_levels": self._combo_overviews.currentText(),
            "suffix":         self._edit_suffix.text().strip() or "_cog",
            "overwrite":      self._chk_overwrite.isChecked(),
        }

    def _start_conversion(self):
        if not self._files:
            return
        out_dir = self._edit_outdir.text().strip() or None
        settings = self._build_settings()

        self._log.clear()
        self._progress.setValue(0)
        self._progress.setMaximum(len(self._files))
        self._btn_convert.setEnabled(False)
        self._btn_cancel.setEnabled(True)
        self._log_msg(f"Starting conversion of {len(self._files)} file(s)…\n")

        self._worker = ConversionWorker(list(self._files), out_dir, settings)
        self._worker.progress.connect(self._on_progress)
        self._worker.file_started.connect(self._on_file_started)
        self._worker.file_done.connect(self._on_file_done)
        self._worker.finished.connect(self._on_finished)
        self._worker.start()

    def _cancel_conversion(self):
        if self._worker:
            self._worker.cancel()
            self._log_msg("\n⛔ Cancelling…")
            self._btn_cancel.setEnabled(False)

    # ------------------------------------------------------------------ worker slots

    def _on_progress(self, current: int, total: int):
        self._progress.setValue(current)

    def _on_file_started(self, path: str):
        self._log_msg(f"▶ {Path(path).name}")

    def _on_file_done(self, input_path: str, elapsed: float, success: bool, out_or_err: str):
        if not input_path:
            # GDAL import error
            self._log_msg(f"✗ {out_or_err}")
            return
        name = Path(input_path).name
        if success:
            self._log_msg(f"  ✓ → {Path(out_or_err).name}  ({elapsed:.1f}s)")
        else:
            self._log_msg(f"  ✗ {name}: {out_or_err}")

    def _on_finished(self):
        self._btn_convert.setEnabled(bool(self._files))
        self._btn_cancel.setEnabled(False)
        self._progress.setValue(self._progress.maximum())
        self._log_msg("\n✅ Done.")
        self._worker = None

    # ------------------------------------------------------------------ helpers

    def _log_msg(self, text: str):
        self._log.append(text)
        sb = self._log.verticalScrollBar()
        sb.setValue(sb.maximum())
