@echo off
setlocal
cd /d "%~dp0"
title Paperloom

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-paperloom.ps1"

if errorlevel 1 (
  echo.
  echo Paperloom could not be started.
  echo Review the message above, then try again.
  pause
)

endlocal
