import os
import threading
from pathlib import Path

from PySide6.QtCore import Qt, Signal, QObject
from PySide6.QtGui import QDragEnterEvent, QDropEvent
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QFileDialog, QFormLayout, QGroupBox, QHBoxLayout, QHeaderView, QLabel,
    QLineEdit, QListWidget, QMainWindow, QMessageBox, QProgressBar, QPushButton, QScrollArea,
    QSizePolicy, QSpinBox, QSplitter, QTableWidget, QTableWidgetItem, QTextEdit, QVBoxLayout, QWidget,
)

from . import converter as cv
from .converter import PRESETS, ConversionWorker

SUPPORTED_EXT = {
    ".tif", ".tiff", ".img", ".hdr", ".jp2", ".j2k", ".ecw", ".sid",
    ".png", ".jpg", ".jpeg", ".vrt", ".nc", ".h4", ".h5", ".hdf",
}


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
        self.filesDropped.emit([u.toLocalFile() for u in event.mimeData().urls()])
        event.acceptProposedAction()


class _AssetFetcher(QObject):
    done = Signal(list, str)  # names, error

    def fetch(self):
        def work():
            try:
                from .uploader import list_assets
                self.done.emit(list_assets(), "")
            except Exception as exc:  # noqa: BLE001
                self.done.emit([], str(exc))
        threading.Thread(target=work, daemon=True).start()


def _tip(widget, text):
    widget.setToolTip(text)
    return widget


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("COG Converter")
        self.setMinimumSize(1020, 760)
        self._files: list[str] = []
        self._worker: ConversionWorker | None = None
        self._last_output_dir: str | None = None
        self._ok = self._failed = 0

        self._build_ui()
        self._apply_style()
        self._check_gdal()
        self._on_preset_changed()

    # ------------------------------------------------------------------ UI

    def _build_ui(self):
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.setSpacing(10)

        header = QHBoxLayout()
        title = QLabel("COG Converter")
        title.setObjectName("title")
        self._gdal_badge = QLabel("GDAL: checking...")
        self._gdal_badge.setObjectName("badgeNeutral")
        self._ecw_badge = QLabel("ECW: checking...")
        self._ecw_badge.setObjectName("badgeNeutral")
        header.addWidget(title)
        header.addStretch()
        header.addWidget(self._ecw_badge)
        header.addWidget(self._gdal_badge)
        layout.addLayout(header)

        splitter = QSplitter(Qt.Orientation.Horizontal)

        # ---- left: files + results
        left = QWidget()
        ll = QVBoxLayout(left)
        ll.setContentsMargins(0, 0, 0, 0)
        file_group = QGroupBox("Input files")
        fl = QVBoxLayout(file_group)
        self._file_list = DropFileList()
        self._file_list.setMinimumHeight(110)
        self._file_list.filesDropped.connect(self.add_files)
        self._file_list.currentRowChanged.connect(self._on_file_selected)
        fl.addWidget(self._file_list)
        hint = QLabel("Drag and drop raster files here, or use Add files")
        hint.setObjectName("hint")
        hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        fl.addWidget(hint)
        self._file_info = QLabel("")
        self._file_info.setObjectName("hint")
        self._file_info.setWordWrap(True)
        fl.addWidget(self._file_info)
        btn_row = QHBoxLayout()
        for text, fn in (("Add files...", self._browse_input), ("Remove selected", self._remove_selected),
                         ("Clear all", self._clear_files)):
            b = QPushButton(text)
            b.clicked.connect(fn)
            btn_row.addWidget(b)
        fl.addLayout(btn_row)
        ll.addWidget(file_group, 2)

        res_group = QGroupBox("Results")
        rl = QVBoxLayout(res_group)
        self._table = QTableWidget(0, 5)
        self._table.setHorizontalHeaderLabels(["File", "Status", "Size (in > out)", "Time", "Check / notes"])
        self._table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self._table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        self._table.verticalHeader().setVisible(False)
        self._table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self._table.setMinimumHeight(110)
        rl.addWidget(self._table)
        ll.addWidget(res_group, 2)
        splitter.addWidget(left)

        # ---- right: settings (scrollable)
        cfg_widget = QWidget()
        cl = QVBoxLayout(cfg_widget)
        cl.setContentsMargins(0, 0, 4, 0)

        g1 = QGroupBox("What is this file for?")
        f1 = QFormLayout(g1)
        self._preset = QComboBox()
        for key, p in PRESETS.items():
            self._preset.addItem(p["label"], key)
        self._preset.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)
        self._preset.setMinimumContentsLength(24)
        self._preset.currentIndexChanged.connect(self._on_preset_changed)
        _tip(self._preset, "Picks good settings for you. You can still change them under Advanced.")
        f1.addRow(self._preset)
        self._preset_help = QLabel("")
        self._preset_help.setWordWrap(True)
        self._preset_help.setObjectName("hint")
        f1.addRow(self._preset_help)
        cl.addWidget(g1)

        g2 = QGroupBox("Coordinate system")
        f2 = QFormLayout(g2)
        self._reproject = _tip(QCheckBox("Convert to Web Mercator (EPSG:3857)"),
                               "The viewer only shows files in EPSG:3857. Leave this ticked unless the file is for another program.")
        self._reproject.setChecked(True)
        self._reproject.toggled.connect(self._update_srs_enabled)
        f2.addRow(self._reproject)
        self._srs_auto = QLabel("File's own CRS: (select a file)")
        self._srs_auto.setObjectName("hint")
        f2.addRow(self._srs_auto)
        self._srs_override = _tip(QLineEdit(), "Only fill this in when the file has no coordinate system, or the wrong one. "
                                               "Examples: EPSG:2039 (Israeli ITM), EPSG:4326 (GPS lat/lon).")
        self._srs_override.setPlaceholderText("Only if the file has no CRS, e.g. EPSG:2039")
        f2.addRow("Source CRS override:", self._srs_override)
        self._warp_resampling = _tip(QComboBox(), "How pixels are recalculated when the map is reprojected. "
                                                  "Bilinear is smooth and right for photos; Nearest keeps exact values (use for classes).")
        self._warp_resampling.addItems(["BILINEAR", "CUBIC", "LANCZOS", "NEAREST", "AVERAGE"])
        f2.addRow("Reprojection resampling:", self._warp_resampling)
        cl.addWidget(g2)

        g3 = QGroupBox("Transparency and quality")
        f3 = QFormLayout(g3)
        self._keep_alpha = _tip(QCheckBox("Keep transparent edges (lossless, bigger file)"),
                                "JPEG cannot store transparency, so this switches to lossless compression. "
                                "Use it when the picture has empty (black) borders or a see-through background.")
        f3.addRow(self._keep_alpha)
        self._key_color = _tip(QComboBox(), "Client maps often have a white (or black) background. Pick the colour that "
                                            "should become see-through so the orthophoto shows underneath.")
        self._key_color.addItem("Nothing", "none")
        self._key_color.addItem("White", "white")
        self._key_color.addItem("Black", "black")
        f3.addRow("Make this colour transparent:", self._key_color)
        self._key_tol = _tip(QSpinBox(), "How close to pure white/black still counts. 8 is good for clean maps; "
                                         "raise it for blurry or JPEG-compressed originals.")
        self._key_tol.setRange(0, 60)
        f3.addRow("Colour tolerance:", self._key_tol)
        self._quality = _tip(QSpinBox(), "JPEG quality. 85 is visually the same as the original for aerial photos; "
                                         "lower is smaller.")
        self._quality.setRange(30, 100)
        self._quality.setSuffix(" %")
        f3.addRow("JPEG quality:", self._quality)
        cl.addWidget(g3)

        self._adv = QGroupBox("Advanced")
        self._adv.setCheckable(True)
        self._adv.setChecked(False)
        fa = QFormLayout(self._adv)
        self._adv_inner = []
        self._compression = _tip(QComboBox(), "JPEG = small, photos only. DEFLATE = lossless, works everywhere. "
                                              "ZSTD/WEBP/LERC are smaller or faster but the viewer cannot display them.")
        self._compression.addItems(["JPEG", "DEFLATE", "LZW", "ZSTD", "WEBP", "LERC_DEFLATE", "NONE"])
        fa.addRow("Compression:", self._compression)
        self._overview_resampling = _tip(QComboBox(), "How the zoomed-out previews are made. Average looks best for photos; "
                                                      "Nearest is only for class maps.")
        self._overview_resampling.addItems(["AVERAGE", "BILINEAR", "CUBIC", "LANCZOS", "NEAREST", "MODE"])
        fa.addRow("Preview (overview) resampling:", self._overview_resampling)
        self._tile_size = _tip(QComboBox(), "512 is the best default.")
        self._tile_size.addItems(["256", "512", "1024"])
        fa.addRow("Tile size (px):", self._tile_size)
        self._suffix = QLineEdit("_cog")
        fa.addRow("Output suffix:", self._suffix)
        self._overwrite = QCheckBox("Overwrite existing files")
        fa.addRow(self._overwrite)
        self._validate = _tip(QCheckBox("Check the result is a valid COG"), "Quick check after converting.")
        self._validate.setChecked(True)
        fa.addRow(self._validate)
        gb = QHBoxLayout()
        self._gdal_bin = _tip(QLineEdit(), "Optional. Folder of another GDAL installation (for example QGIS's bin folder) "
                                           "that can read ECW files. QGIS and OSGeo4W are found automatically.")
        self._gdal_bin.setPlaceholderText("Only for ECW files, e.g. C:\\Program Files\\QGIS 3.44.15\\bin")
        bb = QPushButton("Browse...")
        bb.clicked.connect(self._browse_gdal)
        gb.addWidget(self._gdal_bin, 1)
        gb.addWidget(bb)
        fa.addRow("External GDAL folder:", gb)
        self._gdal_bin.editingFinished.connect(self._check_gdal)
        cl.addWidget(self._adv)

        g4 = QGroupBox("Output folder")
        h4 = QHBoxLayout(g4)
        self._output_dir = QLineEdit()
        self._output_dir.setPlaceholderText("Leave blank to save next to each input file")
        browse_out = QPushButton("Browse...")
        browse_out.clicked.connect(self._browse_output)
        self._open_out = QPushButton("Open folder")
        self._open_out.clicked.connect(self._open_output_folder)
        h4.addWidget(self._output_dir, 1)
        h4.addWidget(browse_out)
        h4.addWidget(self._open_out)
        cl.addWidget(g4)

        self._up = QGroupBox("Upload to viewer after converting")
        self._up.setCheckable(True)
        self._up.setChecked(False)
        _tip(self._up, "Sends the finished file to the viewer and adds it as a layer of an existing asset. "
                       "Needs your admin login in the .env file next to this app. Files over 5 GB cannot be uploaded this way.")
        fu = QFormLayout(self._up)
        ar = QHBoxLayout()
        self._asset = QComboBox()
        self._asset.setEditable(True)
        self._asset.lineEdit().setPlaceholderText("Choose the asset (project) to add this layer to")
        _tip(self._asset, "The layer is added to this existing asset, next to its other orthophotos.")
        refresh = QPushButton("Load list")
        refresh.clicked.connect(self._load_assets)
        ar.addWidget(self._asset, 1)
        ar.addWidget(refresh)
        fu.addRow("Add to asset:", ar)
        self._layer_name = _tip(QLineEdit(), "Name shown in the viewer's layer list. Blank = file name.")
        fu.addRow("Layer name:", self._layer_name)
        self._new_asset = _tip(QCheckBox("Create the asset if it does not exist"),
                               "Off by default so a typo cannot create a stray asset.")
        fu.addRow(self._new_asset)
        self._up_note = QLabel("")
        self._up_note.setObjectName("hint")
        self._up_note.setWordWrap(True)
        fu.addRow(self._up_note)
        cl.addWidget(self._up)
        cl.addStretch(1)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(cfg_widget)
        scroll.setFrameShape(QScrollArea.Shape.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        scroll.setMinimumWidth(470)
        splitter.addWidget(scroll)
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 3)
        layout.addWidget(splitter, 1)

        action = QHBoxLayout()
        self._progress = QProgressBar()
        self._progress.setRange(0, 1000)
        self._eta = QLabel("Ready")
        self._eta.setMinimumWidth(230)
        self._cancel_btn = QPushButton("Cancel")
        self._cancel_btn.setEnabled(False)
        self._cancel_btn.clicked.connect(self._cancel)
        self._convert_btn = QPushButton("Convert")
        self._convert_btn.setObjectName("convertBtn")
        self._convert_btn.setMinimumWidth(120)
        self._convert_btn.clicked.connect(self._start)
        action.addWidget(self._progress, 1)
        action.addWidget(self._eta)
        action.addWidget(self._cancel_btn)
        action.addWidget(self._convert_btn)
        layout.addLayout(action)

        self._log = QTextEdit()
        self._log.setReadOnly(True)
        self._log.setMaximumHeight(110)
        layout.addWidget(self._log)
        self._update_up_note()

    def _apply_style(self):
        self.setStyleSheet("""
            QMainWindow, QWidget { background-color: #1e1e2e; color: #cdd6f4; }
            QLabel#title { font-size: 22px; font-weight: bold; color: #cdd6f4; }
            QLabel#badgeOk { background: #a6e3a1; color: #1e1e2e; border-radius: 10px; padding: 2px 10px; font-weight: bold; }
            QLabel#badgeFail { background: #f38ba8; color: #1e1e2e; border-radius: 10px; padding: 2px 10px; font-weight: bold; }
            QLabel#badgeWarn { background: #f9e2af; color: #1e1e2e; border-radius: 10px; padding: 2px 10px; font-weight: bold; }
            QLabel#badgeNeutral { background: #6c7086; color: #cdd6f4; border-radius: 10px; padding: 2px 10px; }
            QLabel#hint { color: #8a8da6; font-style: italic; font-size: 11px; }
            QGroupBox { border: 1px solid #313244; border-radius: 8px; margin-top: 12px; padding: 10px 8px 8px 8px;
                        font-weight: bold; color: #cdd6f4; }
            QGroupBox::title { subcontrol-origin: margin; subcontrol-position: top left; padding: 0 6px; color: #89b4fa; }
            QGroupBox::indicator { width: 15px; height: 15px; border: 1px solid #45475a; border-radius: 3px; background: #181825; }
            QGroupBox::indicator:checked { background: #89b4fa; border-color: #89b4fa; }
            QListWidget, QTableWidget { background: #181825; color: #cdd6f4; border: 1px solid #313244; border-radius: 6px;
                                        gridline-color: #313244; alternate-background-color: #1e1e2e; }
            QHeaderView::section { background: #313244; color: #cdd6f4; border: none; padding: 4px; }
            QListWidget::item { padding: 4px 6px; }
            QListWidget::item:selected, QTableWidget::item:selected { background: #45475a; color: #cdd6f4; }
            QLineEdit, QComboBox, QSpinBox { background: #181825; color: #cdd6f4; border: 1px solid #45475a;
                                             border-radius: 5px; padding: 4px 8px; }
            QComboBox::drop-down { border: none; }
            QComboBox QAbstractItemView { background: #181825; color: #cdd6f4; selection-background-color: #45475a; }
            QPushButton { background: #313244; color: #cdd6f4; border: 1px solid #45475a; border-radius: 5px; padding: 6px 14px; }
            QPushButton:hover { background: #45475a; border-color: #89b4fa; }
            QPushButton:disabled { background: #1e1e2e; color: #45475a; border-color: #313244; }
            QPushButton#convertBtn { background: #89b4fa; color: #1e1e2e; font-weight: bold; border: none; }
            QPushButton#convertBtn:hover { background: #74c7ec; }
            QPushButton#convertBtn:disabled { background: #45475a; color: #585b70; }
            QProgressBar { border: 1px solid #45475a; border-radius: 5px; background: #181825; text-align: center;
                           color: #cdd6f4; min-height: 22px; }
            QProgressBar::chunk { background: #89b4fa; border-radius: 4px; }
            QTextEdit { background: #181825; color: #a6e3a1; border: 1px solid #313244; border-radius: 6px;
                        font-family: 'Consolas', 'Courier New', monospace; font-size: 11px; }
            QSplitter::handle { background: #313244; width: 2px; }
            QCheckBox { color: #cdd6f4; spacing: 6px; }
            QCheckBox::indicator { width: 16px; height: 16px; border: 1px solid #45475a; border-radius: 3px; background: #181825; }
            QCheckBox::indicator:checked { background: #89b4fa; border-color: #89b4fa; }
            QToolTip { background: #313244; color: #cdd6f4; border: 1px solid #89b4fa; padding: 4px; }
            QScrollArea { background: transparent; }
        """)

    # ------------------------------------------------------------------ status

    def _badge(self, label, text, state):
        label.setText(text)
        label.setObjectName(state)
        label.style().unpolish(label)
        label.style().polish(label)

    def _check_gdal(self):
        try:
            from osgeo import gdal
            self._badge(self._gdal_badge, f"GDAL {gdal.__version__}", "badgeOk")
            st = cv.ecw_status({"gdal_bin": self._gdal_bin.text().strip()})
            if st["ecw"]:
                self._badge(self._ecw_badge, "ECW: readable", "badgeOk")
                self._ecw_badge.setToolTip(f"ECW reader found: {st['where']}")
            else:
                self._badge(self._ecw_badge, "ECW: not available", "badgeWarn")
                self._ecw_badge.setToolTip(cv.ECW_HELP)
        except ImportError:
            self._badge(self._gdal_badge, "GDAL not found", "badgeFail")
            self._badge(self._ecw_badge, "ECW: -", "badgeNeutral")
            self._log_msg("GDAL is not available. Start the app with start-cog-converter.cmd (conda environment cog-converter).")

    def _update_up_note(self):
        from .uploader import credentials, APP_DIR
        c = credentials()
        who = f"Viewer: {c['api']}" + ("" if (c["user"] and c["password"]) else
                                      f"  -  login missing: create {APP_DIR / '.env'} (QS_ADMIN_USER / QS_ADMIN_PASSWORD)")
        self._up_note.setText(who)

    # ------------------------------------------------------------------ presets / settings

    def _on_preset_changed(self):
        key = self._preset.currentData()
        p = PRESETS[key]
        self._preset_help.setText(p["help"])
        if key == "custom":
            self._adv.setChecked(True)
            return
        self._compression.setCurrentText(p["compression"])
        self._quality.setValue(p["quality"])
        self._warp_resampling.setCurrentText(p["warp_resampling"])
        self._overview_resampling.setCurrentText(p["overview_resampling"])
        self._tile_size.setCurrentText(str(p["tile_size"]))
        self._keep_alpha.setChecked(p["keep_transparency"])
        self._key_color.setCurrentIndex(max(0, self._key_color.findData(p["key_color"])))
        self._key_tol.setValue(p["key_tolerance"])
        self._update_srs_enabled()

    def _update_srs_enabled(self):
        on = self._reproject.isChecked()
        self._srs_override.setEnabled(True)
        self._warp_resampling.setEnabled(on)
        self._reproject.setText("Convert to Web Mercator (EPSG:3857) for the viewer" if on else "Keep the file's own coordinate system")

    def settings(self) -> dict:
        s = dict(cv.DEFAULT_SETTINGS)
        s.update({
            "preset": self._preset.currentData(),
            "reproject": self._reproject.isChecked(),
            "source_srs": self._srs_override.text().strip(),
            "warp_resampling": self._warp_resampling.currentText(),
            "keep_transparency": self._keep_alpha.isChecked(),
            "key_color": self._key_color.currentData(),
            "key_tolerance": self._key_tol.value(),
            "quality": self._quality.value(),
            "compression": self._compression.currentText(),
            "overview_resampling": self._overview_resampling.currentText(),
            "tile_size": int(self._tile_size.currentText()),
            "suffix": self._suffix.text().strip() or "_cog",
            "overwrite": self._overwrite.isChecked(),
            "validate": self._validate.isChecked(),
            "gdal_bin": self._gdal_bin.text().strip(),
            "upload": self._up.isChecked(),
            "upload_asset": self._asset.currentText().strip(),
            "upload_name": self._layer_name.text().strip(),
            "allow_new_asset": self._new_asset.isChecked(),
        })
        return s

    # ------------------------------------------------------------------ files

    def add_files(self, paths: list):
        added = 0
        for path in paths:
            p = Path(path)
            if p.suffix.lower() in SUPPORTED_EXT and path not in self._files:
                self._files.append(path)
                self._file_list.addItem(p.name)
                self._file_list.item(self._file_list.count() - 1).setToolTip(path)
                added += 1
        if added:
            self._log_msg(f"Added {added} file(s). Total: {len(self._files)}")
            if self._file_list.currentRow() < 0:
                self._file_list.setCurrentRow(0)

    def _on_file_selected(self, row: int):
        if 0 <= row < len(self._files):
            try:
                d = cv.describe(self._files[row], self.settings())
            except Exception as exc:  # noqa: BLE001
                d = str(exc)
            self._file_info.setText(d)
            self._srs_auto.setText("File's own CRS: " + (d.split(", ")[-1] if "," in d else d))
        else:
            self._file_info.setText("")
            self._srs_auto.setText("File's own CRS: (select a file)")

    def _browse_input(self):
        files, _ = QFileDialog.getOpenFileNames(
            self, "Select raster files", "",
            "Raster files (*.tif *.tiff *.img *.jp2 *.ecw *.png *.jpg *.jpeg *.vrt *.nc *.h5 *.hdf);;All files (*.*)")
        if files:
            self.add_files(files)

    def _browse_output(self):
        d = QFileDialog.getExistingDirectory(self, "Select output folder")
        if d:
            self._output_dir.setText(d)

    def _browse_gdal(self):
        d = QFileDialog.getExistingDirectory(self, "Select the bin folder of the other GDAL (contains gdal_translate.exe)")
        if d:
            self._gdal_bin.setText(d)
            self._check_gdal()

    def _remove_selected(self):
        for item in reversed(self._file_list.selectedItems()):
            row = self._file_list.row(item)
            self._file_list.takeItem(row)
            self._files.pop(row)

    def _clear_files(self):
        self._files.clear()
        self._file_list.clear()

    def _open_output_folder(self):
        d = self._output_dir.text().strip() or self._last_output_dir or (str(Path(self._files[0]).parent) if self._files else "")
        if d and os.path.isdir(d):
            os.startfile(d)  # noqa: S606 - Windows only, opens Explorer
        else:
            self._log_msg("No output folder yet.")

    # ------------------------------------------------------------------ upload helpers

    def _load_assets(self):
        self._log_msg("Loading the asset list from the viewer ...")
        self._fetcher = _AssetFetcher()
        self._fetcher.done.connect(self._assets_loaded)
        self._fetcher.fetch()

    def _assets_loaded(self, names: list, err: str):
        if err:
            self._log_msg("Could not load assets: " + err)
            return
        cur = self._asset.currentText()
        self._asset.clear()
        self._asset.addItems(names)
        self._asset.setEditText(cur if cur else (names[0] if names else ""))
        self._log_msg(f"{len(names)} asset(s) found.")

    # ------------------------------------------------------------------ run

    def _start(self):
        if not self._files:
            self._log_msg("No input files selected.")
            return
        s = self.settings()
        if s["upload"]:
            if not s["upload_asset"]:
                QMessageBox.warning(self, "Upload", "Choose the asset the layer should be added to (or untick the upload option).")
                return
            if s["compression"] not in cv.VIEWER_OK_COMPRESSION and not s["keep_transparency"]:
                QMessageBox.warning(self, "Upload", f"The viewer cannot display {s['compression']} compression. "
                                                     "Choose JPEG or DEFLATE, or untick the upload option.")
                return
            from .uploader import credentials
            c = credentials()
            if not (c["user"] and c["password"]):
                QMessageBox.warning(self, "Upload", "No viewer login found. See the note under 'Upload to viewer'.")
                return
            if not self._asset.findText(s["upload_asset"], Qt.MatchFlag.MatchFixedString) >= 0 and not s["allow_new_asset"]:
                if QMessageBox.question(self, "Upload", f"Add to asset '{s['upload_asset']}'? Use 'Load list' to check that "
                                        "it exists; otherwise the upload stops with a message.") != QMessageBox.StandardButton.Yes:
                    return
        out_dir = self._output_dir.text().strip() or None
        self._last_output_dir = out_dir
        self._log.clear()
        self._table.setRowCount(0)
        self._ok = self._failed = 0
        self._progress.setValue(0)
        self._eta.setText("Starting ...")
        self._convert_btn.setEnabled(False)
        self._cancel_btn.setEnabled(True)
        for f in self._files:
            r = self._table.rowCount()
            self._table.insertRow(r)
            for c, t in enumerate([Path(f).name, "waiting", "", "", ""]):
                self._table.setItem(r, c, QTableWidgetItem(t))

        self._worker = ConversionWorker(list(self._files), out_dir, s)
        self._worker.progress.connect(self._on_progress)
        self._worker.file_started.connect(self._on_file_started)
        self._worker.file_status.connect(lambda i, t: self._set_cell(i, 1, t))
        self._worker.file_done.connect(self._on_file_done)
        self._worker.log.connect(self._log_msg)
        self._worker.finished_all.connect(self._on_finished)
        self._worker.start()

    def _cancel(self):
        if self._worker:
            self._worker.cancel()
        self._cancel_btn.setEnabled(False)
        self._log_msg("Cancelling (the current step stops within a few seconds) ...")

    def _set_cell(self, row: int, col: int, text: str):
        if 0 <= row < self._table.rowCount():
            self._table.item(row, col).setText(text)

    def _on_progress(self, frac: float, eta: float):
        self._progress.setValue(int(frac * 1000))
        if eta >= 0:
            m, s = divmod(int(eta), 60)
            self._eta.setText(f"{frac * 100:.0f}%   about {m}:{s:02d} left" if eta > 1 else f"{frac * 100:.0f}%")
        else:
            self._eta.setText(f"{frac * 100:.0f}%")

    def _on_file_started(self, idx: int, path: str):
        self._set_cell(idx, 1, "converting")

    def _on_file_done(self, idx: int, path: str, ok: bool, res: dict):
        if idx < 0:
            self._log_msg(res.get("error", "error"))
            return
        if ok:
            self._ok += 1
            self._set_cell(idx, 1, "done")
            self._set_cell(idx, 2, f"{cv.fmt_size(res['in_size'])} > {cv.fmt_size(res['out_size'])}")
            self._set_cell(idx, 3, f"{res['seconds']:.0f} s")
            up = res.get("upload")
            extra = ""
            if up:
                extra = ("  |  not uploaded: " + up["skipped"]) if "skipped" in up else \
                        f"  |  uploaded to '{up['asset']}' as '{up['name']}' ({up['status']})"
                self._set_cell(idx, 1, "done, uploaded" if "skipped" not in up else "done, NOT uploaded")
            self._set_cell(idx, 4, res["valid"] + "".join(f"; {n}" for n in res["notes"]) + extra)
            self._table.item(idx, 4).setToolTip(self._table.item(idx, 4).text())
            self._last_output_dir = str(Path(res["output"]).parent)
            self._log_msg(f"  {Path(path).name} > {Path(res['output']).name}  ({res['seconds']:.1f}s)  {res['valid']}")
        else:
            self._failed += 1
            self._set_cell(idx, 1, "cancelled" if res.get("cancelled") else "FAILED")
            self._set_cell(idx, 4, res["error"].replace("\n", " "))
            self._table.item(idx, 4).setToolTip(res["error"])
            self._log_msg(f"  ERROR {Path(path).name}: {res['error']}")

    def _on_finished(self):
        self._convert_btn.setEnabled(True)
        self._cancel_btn.setEnabled(False)
        self._eta.setText(f"Finished: {self._ok} ok, {self._failed} failed")
        self._log_msg("Finished.")

    def _log_msg(self, text: str):
        self._log.append(text)
        self._log.verticalScrollBar().setValue(self._log.verticalScrollBar().maximum())
