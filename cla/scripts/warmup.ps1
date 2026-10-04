# Preload the default local model into memory so the user's first message
# does not have to wait for a cold start.
#
# The model is read from the local config (config.local.json -> config.json).
# Only models already present in the local Ollama library are warmed up, so a
# removed/renamed model (e.g. the retired qwen3.5:9b) will never trigger a
# registry pull or stall the one-click launcher.

$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ollama = Join-Path $root "bin\ollama\ollama.exe"
if (-not (Test-Path $ollama)) { $ollama = "ollama" }

# Match start-all.bat: models live in <root>\models and serve listens on
# 127.0.0.1:11434. The warmup only runs AFTER `ollama serve` is already up
# (step 1 of the launcher), so no server is started from here.
$modelsDir = Join-Path $root "models"
if (Test-Path $modelsDir) { $env:OLLAMA_MODELS = $modelsDir }
$env:OLLAMA_HOST = "127.0.0.1:11434"

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

# Verify the model exists locally; never let Ollama pull an unknown tag.
$list = & $ollama list 2>$null
if (-not ($list -match "(^|\s)$([regex]::Escape($model))(\s|$)")) {
    Write-Output "warmup skipped: model '$model' is not installed locally"
    exit 0
}

$body = @{
    model      = $model
    messages   = @(@{ role = "user"; content = "hi" })
    stream     = $false
    keep_alive = "30m"
    options    = @{ num_predict = 1; num_ctx = 8192 }
} | ConvertTo-Json -Depth 6

try {
    Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/chat" `
        -Method Post -ContentType "application/json" `
        -Body $body -TimeoutSec 900 | Out-Null
} catch {
    # warming up is best-effort only
}
