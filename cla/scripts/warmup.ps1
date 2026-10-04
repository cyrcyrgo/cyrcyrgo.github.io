# Preload the default local model so the user's first message is not a cold
# start. The backend serves models on demand through the llama.cpp engine, so
# this only fires an early warm-up request for the configured default model.
#
# The model name is read from the local config (config.local.json -> config.json)
# so a removed/renamed model never stalls the one-click launcher.

$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

$model = $null
foreach ($cfgPath in @((Join-Path $root "config.local.json"),
                       (Join-Path $root "config.json"))) {
    if (Test-Path $cfgPath) {
        try {
            $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($cfg.default_model) { $model = [string]$cfg.default_model; break }
            if ($cfg.model) { $model = [string]$cfg.model; break }
        } catch {}
    }
}
if (-not $model) { $model = "qwen3.5:0.8b" }

# The backend is already up (step 1 of the launcher). Ask it to preload; the
# load itself continues in the background server-side.
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/warmup" `
        -Method Post -TimeoutSec 20 | Out-Null
    Write-Output "warmup requested for '$model'"
} catch {
    Write-Output "warmup skipped: backend not reachable"
}