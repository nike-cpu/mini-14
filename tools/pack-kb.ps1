# Package the current knowledge base into a distributable zip (for hosting / sharing).
param([string]$Root = "D:\mini-14")
$ErrorActionPreference = 'Stop'
$kb = Join-Path $Root 'web\kb'
$outDir = Join-Path $Root 'backups'
New-Item -ItemType Directory -Force $outDir | Out-Null

if (-not (Test-Path (Join-Path $kb 'chunks.json'))) {
    Write-Host "web\kb\chunks.json 不存在，无法打包。" -ForegroundColor Red
    exit 1
}

$ts = Get-Date -Format 'yyyyMMdd-HHmm'
$zip = Join-Path $outDir ("mini14-kb-" + $ts + ".zip")
Write-Host "正在打包（向量文件较大，需要一会儿）…" -ForegroundColor Cyan
Compress-Archive -Path (Join-Path $kb '*') -DestinationPath $zip -Force
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ("已生成：{0}（{1} MB）" -f $zip, $mb) -ForegroundColor Green
Write-Host "把它上传到 GitHub Release，然后把地址写进 tools\db-url.txt 即可让别人一键下载。"
