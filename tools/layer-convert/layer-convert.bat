@echo off
:: DXF -> GeoJSON (WGS84) for the QuadSpectat layers panel.
::   - drag a .dxf onto this file, or:  layer-convert.bat "C:\path\survey.dxf" [--source-crs EPSG:2039] [options]
::   - first run creates tools\layer-convert\.venv and installs ezdxf + pyproj (pure pip, no GDAL / QGIS).
::   - DWG is not read: export a DXF from AutoCAD (or use the free ODA File Converter) first.
setlocal
set "HERE=%~dp0"

if "%~1"=="" (
  echo Usage: layer-convert.bat ^<input.dxf^> [--source-crs EPSG:2039 / EPSG:28193 / EPSG:4326] [options]
  echo        see: python "%HERE%layer_convert.py" --help
  pause
  exit /b 1
)

if not exist "%HERE%.venv\Scripts\python.exe" (
  echo Creating "%HERE%.venv" and installing ezdxf and pyproj, one time only ...
  python -m venv "%HERE%.venv" || ( echo Python 3.9+ is required & pause & exit /b 1 )
  "%HERE%.venv\Scripts\python.exe" -m pip install -q -r "%HERE%requirements.txt" || ( echo pip install failed & pause & exit /b 1 )
)
"%HERE%.venv\Scripts\python.exe" "%HERE%layer_convert.py" %*

pause
