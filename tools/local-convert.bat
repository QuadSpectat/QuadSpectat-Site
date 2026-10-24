@echo off
:: One-click local COG converter + uploader.
::   - drag a .tif onto this file, or:  local-convert.bat "C:\path\file.tif" ["Display name"] [options]
::   - GDAL is taken from, in this order:
::       1. gdalwarp on PATH (OSGeo4W / QGIS shell)
::       2. your Miniconda environment  %USERPROFILE%\miniconda3\envs\cog-converter  (same GDAL as the COG Converter app)
::       3. first run creates tools\.venv and installs rasterio (bundles GDAL); no QGIS needed
::   - admin login: copy tools\.env.example to tools\.env and fill in (never committed).
::   - options: --asset "Existing asset" (add as a layer of that asset), --transparent white, --no-upload, --keep, --source-srs EPSG:2039
setlocal
set "HERE=%~dp0"
set "CONDA_ENV=%USERPROFILE%\miniconda3\envs\cog-converter"

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

if exist "%CONDA_ENV%\Library\bin\gdalwarp.exe" if exist "%CONDA_ENV%\python.exe" (
  echo Using GDAL from %CONDA_ENV%
  "%CONDA_ENV%\python.exe" "%HERE%local-convert.py" %*
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
