import os
import sys

# GDAL/PROJ data folders: normally set by "conda run"; set them ourselves when started another way
_lib = os.path.join(sys.prefix, "Library", "share")
if not os.environ.get("GDAL_DATA") and os.path.isdir(os.path.join(_lib, "gdal")):
    os.environ["GDAL_DATA"] = os.path.join(_lib, "gdal")
if not os.environ.get("PROJ_DATA") and os.path.isdir(os.path.join(_lib, "proj")):
    os.environ["PROJ_DATA"] = os.path.join(_lib, "proj")

from PySide6.QtWidgets import QApplication
from src.main_window import MainWindow


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("COG Converter")
    app.setApplicationVersion("2.0.0")
    app.setStyle("Fusion")

    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
