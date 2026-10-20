@echo off
chcp 65001 >nul
echo.
echo  即将删除 mini-14：D:\mini-14 和桌面图标
echo.
choice /c YN /m "确定卸载吗"
if errorlevel 2 exit /b
call "%~dp0stop.cmd"
del /f /q "%USERPROFILE%\Desktop\mini-14.lnk" >nul 2>&1
cd /d "%TEMP%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 1; Remove-Item -LiteralPath 'D:\mini-14' -Recurse -Force -ErrorAction SilentlyContinue"
echo 已卸载。
timeout /t 2 >nul
