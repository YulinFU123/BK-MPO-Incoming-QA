@echo off
chcp 65001 >nul
cd /d "%~dp0"
call select_python.bat
if errorlevel 1 (pause & exit /b 1)
%PANEL_PY% setup_deps.py --diagnose
echo 请查看 environment_report.txt
pause
