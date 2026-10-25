# tools/ - what lives where

| Path | What it is |
|---|---|
| `tools/cog_converter/` | **COG Converter** desktop app (PySide6 + GDAL, conda env `cog-converter`). Start with the Desktop shortcut or `tools\cog_converter\start-cog-converter.cmd` (`--check` prints `OK <gdal> <pyside>`, `--cli` runs without a window). The only copy - there is no separate standalone folder any more. |
| `tools/local-convert.py` / `local-convert.bat` | Command-line converter + uploader used by the admin "large ortho" flow (uses the conda GDAL). Deps: `requirements-local.txt`. |
| `tools/layer-convert/` | DXF/DWG/GeoJSON layer converter (see its README). |
| `backend/scripts/set-cors.ts` | Sets the CORS rules on the storage bucket (run from `backend/`). |

## Env files

Real settings live in git-ignored files and are **never committed**: `backend/.env`, `frontend/.env.local`, `tools/.env`, `tools/cog_converter/.env`
(they hold the admin login and storage keys). Copy the matching `.env.example` and fill it in.
Local SQLite files (`backend/data/*.db*`) are also git-ignored; the backend creates them on first start.
