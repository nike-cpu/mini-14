# Restart the import service on 18018 (via wscript so it survives parent exit).
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$vbs = Join-Path $root 'tools\run-ingest.vbs'
$log = Join-Path $root 'logs'

Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*ingest-server*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

Start-Process -FilePath "$env:WINDIR\System32\wscript.exe" -ArgumentList ('"' + $vbs + '"') -WindowStyle Hidden
Start-Sleep -Seconds 4

try {
    $r = Invoke-WebRequest 'http://127.0.0.1:18018/health' -UseBasicParsing -TimeoutSec 4
    Write-Host ("导入服务已启动：" + $r.Content) -ForegroundColor Green
} catch {
    Write-Host '导入服务启动失败，看 logs\ingest.err.log' -ForegroundColor Red
    exit 1
}
