@echo off
chcp 65001 >nul
cd /d "%~dp0"
call select_python.bat
if errorlevel 1 (pause & exit /b 1)
%PANEL_PY% setup_deps.py --check
if errorlevel 1 (echo 请先安装依赖 & pause & exit /b 1)
%PANEL_PY% selftest_analytics.py
set "TEST_RESULT=%ERRORLEVEL%"
pause
exit /b %TEST_RESULT%
