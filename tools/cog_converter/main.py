import sys
from PySide6.QtWidgets import QApplication
from PySide6.QtGui import QIcon
from src.main_window import MainWindow


def main():
    print("[DEBUG] Starting COG Converter main.py...")
    app = QApplication(sys.argv)
    app.setApplicationName("COG Converter")
    app.setApplicationVersion("1.0.0")
    app.setStyle("Fusion")

    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()