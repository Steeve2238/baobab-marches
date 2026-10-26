@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0recuperer_sauvegardes.ps1" %*
echo.
pause
