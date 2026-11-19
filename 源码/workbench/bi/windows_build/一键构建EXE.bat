@echo off
chcp 65001 >nul
cd /d "%~dp0"
py -3.12 build_windows.py
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
