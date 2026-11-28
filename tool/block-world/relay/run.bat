@echo off
rem 公网中继启动脚本（Windows）
cd /d "%~dp0"
node server.js %*
pause
