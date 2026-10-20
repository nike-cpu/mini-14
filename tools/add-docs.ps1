# mini-14 add documents to the knowledge base
# usage: add-docs.ps1 <file-or-folder> [...]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Paths
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$kbDir = Join-Path $root 'web\kb'
$chunksPath = Join-Path $kbDir 'chunks.json'
$vecPath = Join-Path $kbDir 'vectors.f32'
$metaPath = Join-Path $kbDir 'vectors.json'
$embPort = 18016
$CHUNK = 620

if (-not $Paths -or $Paths.Count -eq 0) {
    Write-Host '用法：把 txt / md / html 文件或文件夹拖到「添加资料.cmd」上。'
    exit 1
}

function Test-Port([int]$p) {
    try {
        $r = Invoke-WebRequest "http://127.0.0.1:$p/health" -UseBasicParsing -TimeoutSec 2
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

function Read-Text([string]$path) {
    $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
    if ($ext -eq '.html' -or $ext -eq '.htm') {
        $raw = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
        $raw = [regex]::Replace($raw, '(?is)<(script|style)[^>]*>.*?</\1>', ' ')
        $raw = [regex]::Replace($raw, '(?i)</?(p|div|br|li|ul|ol|h[1-6]|tr|td|table|section|article)[^>]*>', "`n")
        $raw = [regex]::Replace($raw, '<[^>]+>', ' ')
        $raw = [Net.WebUtility]::HtmlDecode($raw)
        return $raw
    }
    if ($ext -eq '.txt' -or $ext -eq '.md' -or $ext -eq '.markdown' -or $ext -eq '.csv') {
        try {
            return [IO.File]::ReadAllText($path, (New-Object Text.UTF8Encoding($false, $true)))
        } catch {
            return [IO.File]::ReadAllText($path, [Text.Encoding]::GetEncoding(936))
        }
    }
    return $null
}

function Split-Chunks([string]$text) {
    $paras = [regex]::Split($text, "\r?\n\s*\r?\n")
    $out = New-Object System.Collections.Generic.List[string]
    $cur = ''
    foreach ($p in $paras) {
        $p = $p.Trim()
        if (-not $p) { continue }
        if (($cur.Length + $p.Length + 2) -le $CHUNK) {
            if ($cur) { $cur = $cur + "`n`n" + $p } else { $cur = $p }
        } else {
            if ($cur) { $out.Add($cur) }
            if ($p.Length -le $CHUNK) {
                $cur = $p
            } else {
                $buf = ''
                foreach ($s in [regex]::Split($p, '(?<=[。！？；\.\!\?])')) {
                    if (($buf.Length + $s.Length) -le $CHUNK) { $buf += $s }
                    else {
                        if ($buf) { $out.Add($buf) }
                        $buf = $s.Substring(0, [Math]::Min($s.Length, $CHUNK))
                    }
                }
                $cur = $buf
            }
        }
    }
    if ($cur) { $out.Add($cur) }
    return @($out | Where-Object { $_.Length -ge 30 })
}

function Get-Sha([string]$s) {
    $sha = [Security.Cryptography.SHA1]::Create()
    $bytes = [Text.Encoding]::UTF8.GetBytes($s)
    return ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant()
}

# ---- make sure the embedding service is up ----
if (-not (Test-Port $embPort)) {
    Write-Host '正在启动 mini-14（向量服务）…'
    Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$root\launcher.ps1`"" -WindowStyle Hidden
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Port $embPort) { break }
    }
}
if (-not (Test-Port $embPort)) {
    Write-Host "向量服务没起来（端口 $embPort）。先双击桌面 mini-14，再重试。"
    exit 1
}

# ---- collect files ----
$files = New-Object System.Collections.Generic.List[string]
foreach ($p in $Paths) {
    if (Test-Path $p -PathType Container) {
        Get-ChildItem -LiteralPath $p -Recurse -File | Where-Object { $_.Extension -match '^\.(txt|md|markdown|html|htm|csv)$' } | ForEach-Object { $files.Add($_.FullName) }
    } elseif (Test-Path $p -PathType Leaf) {
        $files.Add((Resolve-Path $p).Path)
    }
}
if ($files.Count -eq 0) { Write-Host '没找到可用的 txt / md / html 文件。'; exit 1 }

# ---- load existing kb ----
$kb = Get-Content $chunksPath -Raw -Encoding UTF8 | ConvertFrom-Json
$items = New-Object System.Collections.Generic.List[object]
foreach ($it in $kb.items) { $items.Add($it) }
$known = New-Object 'System.Collections.Generic.HashSet[string]'
$hasSha = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($it in $items) {
    $h = $it.sha1
    if (-not $h) { $h = Get-Sha $it.text }
    [void]$known.Add($h)
    [void]$hasSha.Add($h)
}

$newChunks = New-Object System.Collections.Generic.List[object]
$addedDocs = 0
$skipped = 0

foreach ($f in $files) {
    $text = Read-Text $f
    if (-not $text -or $text.Trim().Length -lt 40) { continue }
    $title = [IO.Path]::GetFileNameWithoutExtension($f)
    $hash = ([BitConverter]::ToString(([Security.Cryptography.MD5]::Create()).ComputeHash([Text.Encoding]::UTF8.GetBytes($f))) -replace '-', '').ToLowerInvariant()
    $slug = 'local-' + $hash.Substring(0, 10)
    $mtime = (Get-Item -LiteralPath $f).LastWriteTime.ToString('yyyy-MM-dd')
    $idx = 0
    $docAdded = 0
    foreach ($ch in (Split-Chunks $text)) {
        $sha = Get-Sha $ch
        if ($known.Contains($sha)) { $skipped++; continue }
        [void]$known.Add($sha)
        $newChunks.Add([pscustomobject]@{
            id          = "$slug-$('{0:d3}' -f $idx)"
            doc_id      = $slug
            topic       = 'custom'
            title       = $title
            url         = ''
            source      = '本地文件'
            published   = $mtime
            lang        = 'zh'
            chunk_index = $idx
            n_chars     = $ch.Length
            sha1        = $sha
            text        = $ch
            seq         = $items.Count + $newChunks.Count
        })
        $idx++
        $docAdded++
    }
    if ($docAdded -gt 0) { $addedDocs++; Write-Host ("+ {0}  ({1} 段)" -f $title, $docAdded) }
}

if ($newChunks.Count -eq 0) {
    Write-Host "没有新内容（全部重复或文件为空）。现有 $($items.Count) 条。"
    exit 0
}

# ---- embed new chunks ----
$meta = Get-Content $metaPath -Raw -Encoding UTF8 | ConvertFrom-Json
$dim = [int]$meta.dim
$vecLen = (Get-Item $vecPath).Length
if ($vecLen -ne ($items.Count * $dim * 4)) {
    Write-Host ("向量文件与条目数对不上（{0} 字节 / 应为 {1} 字节），请先重新建库。" -f $vecLen, ($items.Count * $dim * 4))
    exit 1
}
$vecs = New-Object System.Collections.Generic.List[float]
$batchSize = 8
for ($i = 0; $i -lt $newChunks.Count; $i += $batchSize) {
    $batch = @()
    for ($j = $i; $j -lt [Math]::Min($i + $batchSize, $newChunks.Count); $j++) {
        $batch += ($newChunks[$j].title + "`n" + $newChunks[$j].text)
    }
    $body = @{ model = 'bge-m3'; input = $batch } | ConvertTo-Json -Depth 5 -Compress
    $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$embPort/v1/embeddings" -Method Post `
        -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 180
    foreach ($d in $resp.data) {
        $v = $d.embedding
        $sum = 0.0
        foreach ($x in $v) { $sum += [double]$x * [double]$x }
        $n = [Math]::Sqrt($sum); if ($n -eq 0) { $n = 1 }
        foreach ($x in $v) { $vecs.Add([float]([double]$x / $n)) }
    }
    Write-Host ("  向量化 {0}/{1}" -f [Math]::Min($i + $batchSize, $newChunks.Count), $newChunks.Count) -NoNewline
    Write-Host "`r" -NoNewline
}

# ---- append chunks + vectors ----
foreach ($c in $newChunks) { $items.Add($c) }
$totalChars = 0
foreach ($it in $items) { $totalChars += $it.text.Length }
$metaOut = [pscustomobject]@{
    built = (Get-Date -Format 'yyyy-MM-dd')
    count = $items.Count
    chars = $totalChars
    topics = (@{} )
    items = $items
}
# recompute topic counts
$topics = @{}
foreach ($it in $items) { $topics[$it.topic] = 1 + ($topics[$it.topic] -as [int]) }
$metaOut.topics = $topics

$json = $metaOut | ConvertTo-Json -Depth 6 -Compress
[IO.File]::WriteAllText($chunksPath, $json, (New-Object Text.UTF8Encoding($false)))

$arr = $vecs.ToArray()
$bytes = New-Object byte[] ($arr.Length * 4)
[Buffer]::BlockCopy($arr, 0, $bytes, 0, $bytes.Length)
$fs = [IO.File]::Open($vecPath, [IO.FileMode]::Append)
$fs.Write($bytes, 0, $bytes.Length)
$fs.Close()

$meta2 = [pscustomobject]@{ model = 'bge-m3'; dim = $dim; count = $items.Count }
[IO.File]::WriteAllText($metaPath, ($meta2 | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))

Write-Host ''
Write-Host ("完成：新增 {0} 个文件 / {1} 段；跳过重复 {2} 段。" -f $addedDocs, $newChunks.Count, $skipped)
Write-Host ("知识库现在共 {0} 条。刷新资料库页面或聊天窗口即可看到。" -f $items.Count)
