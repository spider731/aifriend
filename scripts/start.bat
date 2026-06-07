@echo off
chcp 65001 >nul
echo.
echo   ╔══════════════════════════════════════╗
echo   ║     💕 AI 电子女友 一键启动 💕       ║
echo   ╚══════════════════════════════════════╝
echo.
cd /d "%~dp0.."

:: 检查 Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo   ❌ 未找到 Node.js，请先安装 Node.js
    echo   📥 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

:: 检查依赖
if not exist "node_modules" (
    echo   📦 首次运行，正在安装依赖...
    call npm install
    echo.
)

:: 检查 API Key
findstr /c:"YOUR_ANTHROPIC_API_KEY_HERE" config.json >nul
if %ERRORLEVEL% equ 0 (
    echo   ⚠️  请先在 config.json 中配置你的 Anthropic API Key
    echo   📋 获取地址: https://console.anthropic.com/
    echo.
    start notepad config.json
    pause
    exit /b 1
)

:: 启动
echo   🚀 启动服务器...
echo.
node server.js

pause
