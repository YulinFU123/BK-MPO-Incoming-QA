@echo off
set "PANEL_PY="
if exist "%~dp0runtime\python.exe" (
  set PANEL_PY="%~dp0runtime\python.exe"
  exit /b 0
)
py -3.15 -c "import sys" >nul 2>nul
if not errorlevel 1 (
  set "PANEL_PY=py -3.15"
  exit /b 0
)
python -c "import sys" >nul 2>nul
if not errorlevel 1 (
  set "PANEL_PY=python"
  exit /b 0
)
echo Python not found. Use a company-approved Python installation.
exit /b 1
