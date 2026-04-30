@echo off
setlocal
cd /d "%~dp0"

set "ARGS="
if not "%~1"=="" set "ARGS=-Port %~1"

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-desktop.ps1" %ARGS%
if errorlevel 1 goto fail
exit /b 0

:fail
echo.
echo [ERROR] Desktop startup failed. Check the error messages above.
pause
exit /b 1
