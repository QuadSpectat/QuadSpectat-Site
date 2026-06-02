@echo off
:: COG Converter — launcher using QGIS Python (which includes GDAL)
:: Searches for QGIS in the default Program Files locations.

setlocal enabledelayedexpansion

:: ── Find QGIS ────────────────────────────────────────────────────────────────
set QGIS_ROOT=
for /d %%D in ("%ProgramFiles%\QGIS*") do set QGIS_ROOT=%%D
for /d %%D in ("%ProgramFiles(x86)%\QGIS*") do set QGIS_ROOT=%%D

if not defined QGIS_ROOT (
    echo ERROR: QGIS not found in Program Files.
    echo Install QGIS from https://qgis.org and try again.
    pause
    exit /b 1
)

set QGIS_PYTHON=%QGIS_ROOT%\apps\Python312\python.exe
if not exist "%QGIS_PYTHON%" (
    set QGIS_PYTHON=%QGIS_ROOT%\apps\Python313\python.exe
)
if not exist "%QGIS_PYTHON%" (
    echo ERROR: QGIS Python not found under %QGIS_ROOT%\apps\
    pause
    exit /b 1
)

:: ── Set GDAL / PROJ environment ───────────────────────────────────────────────
set PATH=%QGIS_ROOT%\bin;%QGIS_ROOT%\apps\Python312;%PATH%
set GDAL_DATA=%QGIS_ROOT%\apps\gdal\share\gdal
set PROJ_LIB=%QGIS_ROOT%\share\proj
set GDAL_DRIVER_PATH=%QGIS_ROOT%\apps\gdal\lib\gdalplugins

:: ── Launch (hide the console window) ─────────────────────────────────────────
start "" "%QGIS_PYTHON%" "%~dp0main.py"
