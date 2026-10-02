# Preload the local model into memory so the user's first message
# does not have to wait for a cold start (loading qwen3.5:9b takes up to ~2 min).
$body = @{
    model     = "qwen3.5:9b"
    messages  = @(@{ role = "user"; content = "hi" })
    stream    = $false
    keep_alive = "30m"
    options   = @{ num_predict = 1; num_ctx = 8192 }
} | ConvertTo-Json -Depth 6

try {
    Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/chat" `
        -Method Post -ContentType "application/json" `
        -Body $body -TimeoutSec 900 | Out-Null
} catch {
    # warming up is best-effort only
}