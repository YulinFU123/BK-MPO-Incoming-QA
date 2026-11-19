@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 仅在允许联网的电脑使用；下载到 wheel_download，不改动随附已校验包。
python -m pip download --index-url https://pypi.org/simple --only-binary=:all: --platform win_amd64 --python-version 3.15 --implementation cp --abi cp315 --dest wheel_download -r requirements-py315.txt
pause
