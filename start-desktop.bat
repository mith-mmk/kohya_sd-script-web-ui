@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  call install.bat
  if errorlevel 1 exit /b %errorlevel%
)

npm run desktop
