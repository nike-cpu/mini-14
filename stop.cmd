@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=18014,18016,18018,18019; $n=0; foreach($p in $ports){ $c=Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if($c){ $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue; $n++ } } }; if($n -gt 0){ Write-Host 'mini-14 stopped' } else { Write-Host 'mini-14 is not running' }"
timeout /t 2 >nul