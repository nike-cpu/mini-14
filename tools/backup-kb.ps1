# 备份 / 恢复资料库
param([switch]$RestoreLatest)

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$kb = Join-Path $root 'web\kb'
$backupDir = Join-Path $root 'backups'
New-Item -ItemType Directory -Force $backupDir | Out-Null

if ($RestoreLatest) {
    $latest = Get-ChildItem $backupDir -Filter 'kb-*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) { Write-Host '没有找到备份。'; exit 1 }
    Write-Host ("从 {0} 恢复…" -f $latest.Name)
    Expand-Archive -Path $latest.FullName -DestinationPath $kb -Force
    Write-Host '恢复完成，刷新页面即可。'
    exit 0
}

$ts = Get-Date -Format 'yyyyMMdd-HHmm'
$zip = Join-Path $backupDir ("kb-{0}.zip" -f $ts)
Compress-Archive -Path (Join-Path $kb '*') -DestinationPath $zip -Force
$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ("已备份到 {0}（{1} MB）" -f $zip, $size)

# 只保留最近 5 份
Get-ChildItem $backupDir -Filter 'kb-*.zip' | Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 5 | Remove-Item -Force
