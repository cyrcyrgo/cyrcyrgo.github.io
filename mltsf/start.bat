@echo off
chcp 65001 >nul
title MLTSF - 本地服务器

echo ============================================
echo   MLTSF 本地服务器启动中...
echo ============================================
echo.

cd /d "%~dp0"

echo 正在启动 HTTP 服务器 (端口: 3000)...
echo.
echo 请用浏览器访问: http://localhost:3000
echo 按 Ctrl+C 可停止服务器
echo ============================================

start http://localhost:3000
npx --yes serve . -p 3000 --cors

echo.
pause
