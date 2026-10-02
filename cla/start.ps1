# YJS LLM Agent -- 本地启动脚本
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not (Test-Path ".venv")) {
    Write-Host "[yjs] 创建虚拟环境..."
    python -m venv .venv
}
& ".venv\Scripts\python.exe" -m pip install -q --upgrade pip
Write-Host "[yjs] 安装依赖..."
& ".venv\Scripts\python.exe" -m pip install -q -r requirements.txt

Write-Host "[yjs] 安装 Playwright Chromium（首次较慢）..."
& ".venv\Scripts\python.exe" -m playwright install chromium

Write-Host "[yjs] 启动服务 http://127.0.0.1:8787 ..."
& ".venv\Scripts\python.exe" -m server.main