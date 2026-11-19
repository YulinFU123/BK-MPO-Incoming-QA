@echo off
cd /d "%~dp0"
call select_python.bat
if errorlevel 1 exit /b 1
%PANEL_PY% quiet_start.py
