@echo off
chcp 65001 >nul
echo ============================================
echo   mini-14 database
echo ============================================
echo   1. Download latest database (recommended)
echo   2. Import a local kb zip
echo   3. Skip (keep current database)
echo ============================================
set /p CHOICE=Choose 1/2/3:
if "%CHOICE%"=="1" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\download-kb.ps1"
if "%CHOICE%"=="2" (
  set /p ZIP=Path to zip:
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\download-kb.ps1" -Zip "%ZIP%"
)
if "%CHOICE%"=="3" echo Skipped.
pause