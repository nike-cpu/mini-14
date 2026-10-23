Set-Location D:\mini-14
$exe = "D:\mini-14\runtime\vulkan\llama-server.exe"
$model = "D:\mini-14\models\vl\Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf"
$mmproj = "D:\mini-14\models\vl\mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf"
if (-not (Test-Path $model)) { Write-Host "VL model missing"; exit 1 }
if (-not (Test-Path $mmproj)) { Write-Host "mmproj missing"; exit 1 }
$running = $false
try { $r = Invoke-WebRequest "http://127.0.0.1:18020/health" -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $running = $true } } catch {}
if (-not $running) {
    Start-Process -FilePath $exe -ArgumentList @(
        '-m', $model,
        '--mmproj', $mmproj,
        '--host', '127.0.0.1', '--port', '18020',
        '-c', '2048', '-ngl', '16', '-fa', 'on', '--no-webui', '--jinja'
    ) -WindowStyle Hidden -RedirectStandardOutput "D:\mini-14\logs\vl.out.log" -RedirectStandardError "D:\mini-14\logs\vl.err.log"
    for ($i = 0; $i -lt 120; $i++) {
        Start-Sleep -Seconds 2
        try { $r = Invoke-WebRequest "http://127.0.0.1:18020/health" -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $running = $true; break } } catch {}
    }
}
if ($running) { Write-Host "vision service ready on 18020" } else { Write-Host "vision service failed to start; see logs\vl.err.log" }
