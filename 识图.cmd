@echo off
chcp 65001 >nul
title mini-14 识图服务
echo 正在启动识图服务（第一次加载约 10 秒）...
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\mini-14\tools\start-vision.ps1"
echo.
echo 识图服务已就绪：http://127.0.0.1:18020
echo 现在回到聊天窗口，点 ?? 选图片即可。
timeout /t 6 >nul