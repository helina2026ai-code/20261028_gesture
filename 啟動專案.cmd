@echo off
setlocal
cd /d "%~dp0"
echo Open http://localhost:8000 in Chrome or Edge.
echo Keep this window open while using the app. Press Ctrl+C to stop.
where uv >nul 2>nul
if errorlevel 1 (
  if not exist ".venv\Scripts\python.exe" (
    echo Python environment not found. Install uv and run uv sync --frozen first.
    pause
    exit /b 1
  )
  ".venv\Scripts\python.exe" main.py
) else (
  uv run --frozen python main.py
)
if errorlevel 1 pause
