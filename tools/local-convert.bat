@echo off
:: Run from OSGeo4W Shell (comes with QGIS).
:: Drag-and-drop a GeoTIFF onto this .bat, or call it directly:
::   local-convert.bat "C:\path\to\file.tif" "Display Name"

if "%~1"=="" (
  echo Usage: local-convert.bat ^<input_file^> ^<display_name^> [output_cog.tif]
  echo.
  echo Run this from the OSGeo4W Shell that came with QGIS.
  pause
  exit /b 1
)

python "%~dp0local-convert.py" %*
pause
