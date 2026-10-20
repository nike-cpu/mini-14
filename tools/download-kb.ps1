# Download (or import) a knowledge-base package and rebuild the shard index.
param(
    [string]$Url = "",
    [string]$Zip = "",
    [string]$Root = "D:\mini-14",
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
$kb = Join-Path $Root 'web\kb'
$node = Join-Path $Root 'runtime\node\node.exe'
$shard = Join-Path $Root 'tools\shard_kb.mjs'

function Write-Step([string]$msg) { Write-Host $msg -ForegroundColor Cyan }

# resolve source
if (-not $Zip) {
    if (-not $Url) {
        $cfg = Join-Path $Root 'tools\db-url.txt'
        if (Test-Path $cfg) { $Url = (Get-Content $cfg -Raw).Trim() }
    }
    if (-not $Url) {
        Write-Host "没有配置数据库下载地址。" -ForegroundColor Yellow
        Write-Host "把地址写进 tools\db-url.txt，或直接指定本地 zip：download-kb.ps1 -Zip D:\kb.zip"
        exit 1
    }
    $Zip = Join-Path $env:TEMP ("mini14-kb-" + [guid]::NewGuid().ToString('N') + ".zip")
    Write-Step "正在下载数据库包…"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing -TimeoutSec 600
    } catch {
        Write-Host ("下载失败：" + $_.Exception.Message) -ForegroundColor Red
        exit 1
    }
    $sw.Stop()
    $mb = [math]::Round((Get-Item $Zip).Length / 1MB, 1)
    Write-Step ("下载完成：{0} MB，用时 {1:N0} 秒" -f $mb, $sw.Elapsed.TotalSeconds)
}

if (-not (Test-Path $Zip)) { Write-Host "找不到压缩包：$Zip" -ForegroundColor Red; exit 1 }

# back up the existing database
if (Test-Path $kb) {
    $bak = Join-Path $Root ("web\kb.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Write-Step "备份现有数据库到 $bak"
    Move-Item $kb $bak
}
New-Item -ItemType Directory -Force $kb | Out-Null

Write-Step "解压到 web\kb …"
Expand-Archive -Path $Zip -DestinationPath $kb -Force

# if the zip contains a top-level kb/ folder, move its content up
$entries = Get-ChildItem $kb
if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
    $inner = $entries[0].FullName
    Get-ChildItem $inner -Force | Move-Item -Destination $kb -Force
    Remove-Item $inner -Recurse -Force
}

$chunks = Join-Path $kb 'chunks.json'
if (-not (Test-Path $chunks)) { Write-Host "压缩包里没有 chunks.json，解压失败" -ForegroundColor Red; exit 1 }

Write-Step "重建分片索引…"
if ((Test-Path $node) -and (Test-Path $shard)) {
    & $node $shard | Select-Object -Last 2
} else {
    Write-Host "找不到 node 或 shard_kb.mjs，跳过重建" -ForegroundColor Yellow
}

$j = Get-Content $chunks -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Step ("数据库就绪：{0} 条资料，{1:N1} 万字" -f $j.count, ($j.chars / 10000))
