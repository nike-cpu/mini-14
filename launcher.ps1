# mini-14 launcher: start llama-server (chat + embeddings, hidden) and open the chat window
$ErrorActionPreference = 'Stop'
$root     = Split-Path -Parent $MyInvocation.MyCommand.Definition
$port     = 18014
$embPort  = 18016
$ingPort  = 18018
$trainPort = 18019
$url      = "http://127.0.0.1:$port/"
$model    = Join-Path $root 'models\qwen2.5-1.5b-instruct-q4_k_m.gguf'
$embModel = Join-Path $root 'models\bge-m3-Q4_K_M.gguf'
$web      = Join-Path $root 'web'
$logDir   = Join-Path $root 'logs'
$logOut   = Join-Path $logDir 'server.out.log'
$logErr   = Join-Path $logDir 'server.err.log'
$pidFile  = Join-Path $logDir 'server.pid'
$embPidFile = Join-Path $logDir 'embed.pid'
$hintFile = Join-Path $root 'assets\startup-error.txt'

function Test-Port([int]$p) {
    try {
        $r = Invoke-WebRequest "http://127.0.0.1:$p/health" -UseBasicParsing -TimeoutSec 2
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}
function Test-Health { return (Test-Port $port) }

function Open-UI {
    $edge = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($edge) {
        Start-Process -FilePath $edge -ArgumentList "--app=$url", "--window-size=980,780"
    } else {
        Start-Process $url
    }
}

function Get-Backend {
    $v = Join-Path $root 'runtime\vulkan\llama-server.exe'
    if (Test-Path $v) { return $v }
    $c = Join-Path $root 'runtime\cpu\llama-server.exe'
    if (Test-Path $c) { return $c }
    return $null
}

function Start-Embedding {
    if (-not (Test-Path $embModel)) { return }
    if (Test-Port $embPort) { return }
    $exe = Get-Backend
    if (-not $exe) { return }
    $argList = @(
        '-m', "`"$embModel`"",
        '--embeddings',
        '--pooling', 'cls',
        '--host', '127.0.0.1',
        '--port', "$embPort",
        '-c', '16384',
        '-b', '4096',
        '-ub', '4096',
        '-ngl', '99',
        '-t', '8',
        '-a', 'bge-m3',
        '--no-webui'
    )
    try {
        $p = Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory $root `
             -WindowStyle Hidden -PassThru `
             -RedirectStandardOutput (Join-Path $logDir 'embed.out.log') `
             -RedirectStandardError (Join-Path $logDir 'embed.err.log')
        Set-Content -Path $embPidFile -Value $p.Id -Encoding ASCII
    } catch {}
}

function Start-Backend([string]$exe, [int]$waitSec) {
    if (-not (Test-Path $exe)) { return $false }
    $argList = @(
        '-m', "`"$model`"",
        '--host', '127.0.0.1',
        '--port', "$port",
        '-c', '8192',
        '-ngl', '99',
        '-fa', 'on',
        '-t', '12',
        '-a', 'mini-14',
        '--path', "`"$web`""
    )
    $p = Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory $root `
         -WindowStyle Hidden -PassThru -RedirectStandardOutput $logOut -RedirectStandardError $logErr
    Set-Content -Path $pidFile -Value $p.Id -Encoding ASCII
    $deadline = (Get-Date).AddSeconds($waitSec)
    while ((Get-Date) -lt $deadline) {
        if ($p.HasExited) { break }
        if (Test-Health) { return $true }
        Start-Sleep -Milliseconds 400
    }
    if (-not $p.HasExited) { try { Stop-Process -Id $p.Id -Force } catch {} }
    return $false
}

function Start-Train {
    $nodeExe = Join-Path $root 'runtime\node\node.exe'
    $script  = Join-Path $root 'tools\train-service.mjs'
    if (-not (Test-Path $nodeExe) -or -not (Test-Path $script)) { return }
    if (Test-Port $trainPort) { return }
    try {
        $p = Start-Process -FilePath $nodeExe -ArgumentList "`"$script`"" -WorkingDirectory $root 
             -WindowStyle Hidden -PassThru 
             -RedirectStandardOutput (Join-Path $logDir 'train.out.log') 
             -RedirectStandardError (Join-Path $logDir 'train.err.log')
        Set-Content -Path (Join-Path $logDir 'train.pid') -Value $p.Id -Encoding ASCII
    } catch {}
}

function Start-Ingest {
    $nodeExe = Join-Path $root 'runtime\node\node.exe'
    $script  = Join-Path $root 'tools\ingest-server.mjs'
    if (-not (Test-Path $nodeExe) -or -not (Test-Path $script)) { return }
    if (Test-Port $ingPort) { return }
    try {
        $vbs = Join-Path $root 'tools\run-ingest.vbs'
        if (Test-Path $vbs) {
            Start-Process -FilePath "$env:WINDIR\System32\wscript.exe" -ArgumentList "`"$vbs`"" -WindowStyle Hidden
        } else {
            $p = Start-Process -FilePath $nodeExe -ArgumentList "`"$script`"" -WorkingDirectory $root -WindowStyle Hidden
            Set-Content -Path (Join-Path $logDir 'ingest.pid') -Value $p.Id -Encoding ASCII
        }
    } catch {}
}

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force $logDir | Out-Null }

Start-Embedding
Start-Ingest
Start-Sleep -Seconds 2
if (-not (Test-Port $ingPort)) { Start-Ingest; Start-Sleep -Seconds 2 }

if (Test-Health) { Open-UI; exit 0 }

$exe = Get-Backend
$ok = $false
if ($exe) { $ok = Start-Backend $exe 90 }
if (-not $ok) {
    $cpu = Join-Path $root 'runtime\cpu\llama-server.exe'
    if ($exe -ne $cpu) { $ok = Start-Backend $cpu 120 }
}

if ($ok) {
    Open-UI
    exit 0
}

# database missing -> ask the user whether to download it
$chunksFile = Join-Path $web 'kb\chunks.json'
if (-not (Test-Path $chunksFile)) {
    $dl = Join-Path $root '数据库下载.cmd'
    if (Test-Path $dl) {
        Start-Process -FilePath $dl -Wait -ErrorAction SilentlyContinue
    }
}
# failure: show the Chinese hint file and the tail of the logs
$msg = Join-Path $logDir 'startup-error.txt'
$logTail = @()
foreach ($f in @($logErr, (Join-Path $logDir 'embed.err.log'))) {
    if (Test-Path $f) { $logTail += "----- $f -----"; $logTail += (Get-Content $f -Tail 40) }
}
$header = @("mini-14 failed to start at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')", "")
if (Test-Path $hintFile) { $header += (Get-Content $hintFile -Encoding UTF8) }
$header += $logTail
$header | Set-Content -Path $msg -Encoding UTF8
Start-Process notepad.exe -ArgumentList "`"$msg`""
exit 1
