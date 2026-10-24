@echo off
setlocal

set "PROJECT_ROOT=%~dp0"
set "CONDA_BAT=%USERPROFILE%\miniconda3\condabin\conda.bat"

if not exist "%CONDA_BAT%" (
  echo Conda was not found at:
  echo   %CONDA_BAT%
  echo Install Miniconda/Anaconda, then try again.
  exit /b 1
)

if /I "%~1"=="--check" (
  call "%CONDA_BAT%" run -n cog-converter python -c "from osgeo import gdal; import PySide6; print('OK', gdal.__version__, PySide6.__version__)"
  exit /b %ERRORLEVEL%
)

rem Command-line mode (same engine, no window):  start-cog-converter.cmd --cli file.tif --preset overlay
if /I "%~1"=="--cli" goto :cli

if not exist "%PROJECT_ROOT%main.py" (
  echo main.py not found in:
  echo   %PROJECT_ROOT%
  exit /b 1
)

call "%CONDA_BAT%" run -n cog-converter python "%PROJECT_ROOT%main.py"
exit /b %ERRORLEVEL%

:cli
for /f "tokens=1,* delims= " %%a in ("%*") do set "REST=%%b"
call "%CONDA_BAT%" run --no-capture-output -n cog-converter python "%PROJECT_ROOT%cli.py" %REST%
exit /b %ERRORLEVEL%
