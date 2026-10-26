@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deployer.ps1" %*
echo.
pause
