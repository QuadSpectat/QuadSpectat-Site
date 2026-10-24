@echo off
:: One-click local COG converter + uploader.
::   - drag a .tif onto this file, or:  local-convert.bat "C:\path\file.tif" ["Display name"] [options]
::   - first run creates tools\.venv and installs rasterio (bundles GDAL); no QGIS needed.
::     If gdalwarp is already on PATH (OSGeo4W Shell) that is used instead.
::   - admin login: copy tools\.env.example to tools\.env and fill it in (never committed).
setlocal
set "HERE=%~dp0"

if "%~1"=="" (
  echo Usage: local-convert.bat ^<input_file^> [display_name] [options]
  echo        see: python "%HERE%local-convert.py" --help
  pause
  exit /b 1
)

where gdalwarp >nul 2>nul
if %errorlevel%==0 (
  python "%HERE%local-convert.py" %*
  goto :done
)

if not exist "%HERE%.venv\Scripts\python.exe" (
  echo Creating "%HERE%.venv" and installing rasterio, one time only ...
  python -m venv "%HERE%.venv" || ( echo Python 3.9+ is required & pause & exit /b 1 )
  "%HERE%.venv\Scripts\python.exe" -m pip install -q -r "%HERE%requirements-local.txt" || ( echo pip install failed & pause & exit /b 1 )
)
"%HERE%.venv\Scripts\python.exe" "%HERE%local-convert.py" %*

:done
pause
