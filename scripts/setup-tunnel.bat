@echo off
chcp 65001 >nul
echo.
echo   ╔══════════════════════════════════════╗
echo   ║     外网隧道 (ngrok) 一键启动        ║
echo   ╚══════════════════════════════════════╝
echo.
cd /d "%~dp0.."

:: 检查 ngrok
where ngrok >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo   ⚠️  未找到 ngrok
    echo.
    echo   📥 下载安装步骤:
    echo   1. 访问 https://ngrok.com/download
    echo   2. 下载 Windows 版本
    echo   3. 注册账号获取 authtoken
    echo   4. 运行: ngrok config add-authtoken 你的token
    echo   5. 把 ngrok.exe 放到 PATH 里或本目录下
    echo.
    pause
    exit /b 1
)

:: 启动 ngrok (假设服务器在 3000 端口)
echo   🌐 启动 ngrok 隧道...
echo   📱 获取公网 URL 后，用手机打开该 URL 即可
echo.
echo   按 Ctrl+C 停止
echo.
ngrok http 3000

pause
