@echo off
setlocal
cd /d "%~dp0"

where powershell >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Windows PowerShell が見つかりません。install.ps1 を実行できません。
    pause
    exit /b 1
)

echo [INFO] install.bat は install.ps1 に処理を委譲します。
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
exit /b %ERRORLEVEL%
