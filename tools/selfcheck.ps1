# mini-14 自检：确认所有组件都在本机、服务正常、数据库完整
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$ok = 0; $bad = 0

function Check([string]$name, [bool]$pass, [string]$detail = '') {
    if ($pass) { $script:ok++; Write-Host ("  [OK]  {0}  {1}" -f $name, $detail) -ForegroundColor Green }
    else       { $script:bad++; Write-Host ("  [!!]  {0}  {1}" -f $name, $detail) -ForegroundColor Red }
}

Write-Host ""
Write-Host "mini-14 独立运行自检" -ForegroundColor Cyan
Write-Host ("安装位置：{0}" -f $root)
Write-Host ""

Write-Host "组件" -ForegroundColor Yellow
Check 'llama.cpp (Vulkan)' (Test-Path "$root\runtime\vulkan\llama-server.exe")
Check 'llama.cpp (CPU 备用)' (Test-Path "$root\runtime\cpu\llama-server.exe")
Check 'Node 运行时' (Test-Path "$root\runtime\node\node.exe")
Check 'Python + NumPy 训练环境' (Test-Path "$root\runtime\py\Scripts\python.exe")
Check '对话模型 Qwen2.5-1.5B' (Test-Path "$root\models\qwen2.5-1.5b-instruct-q4_k_m.gguf")
Check '向量模型 bge-m3' (Test-Path "$root\models\bge-m3-Q4_K_M.gguf")

Write-Host ""
Write-Host "数据库" -ForegroundColor Yellow
$chunksPath = "$root\web\kb\chunks.json"
$vecPath = "$root\web\kb\vectors.f32"
$kb = $null
try { $kb = Get-Content $chunksPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
Check 'chunks.json 可读' ($null -ne $kb) $(if ($kb) { "{0} 条" -f $kb.count } else { '' })
if ($kb) {
    $vecLen = (Get-Item $vecPath).Length
    $expect = $kb.count * 1024 * 4
    Check '向量文件与条目对齐' ($vecLen -eq $expect) ("{0:N0} / {1:N0} 字节" -f $vecLen, $expect)
    Check '资料量' ($kb.chars -gt 100000) ("{0:N1} 万字" -f ($kb.chars / 10000))
}

Write-Host ""
Write-Host "外部依赖" -ForegroundColor Yellow
$extRefs = Get-ChildItem $root -Recurse -File -Include *.ps1,*.mjs,*.vbs,*.cmd,*.cfg | Where-Object { $_.FullName -ne $PSCommandPath } |
    Select-String -Pattern "C:\\Users\\[^\\]+\\\.dsh|dsh-runtimes" -List
Check '脚本中没有指向 DSH 的路径' (-not $extRefs) $(if ($extRefs) { "发现 {0} 处" -f $extRefs.Count } else { '' })
$pyCfg = Get-Content "$root\runtime\py\pyvenv.cfg" -Raw
Check 'Python 环境指向本机副本' ($pyCfg -match [regex]::Escape("$root\runtime\python"))

Write-Host ""
Write-Host "服务" -ForegroundColor Yellow
$ports = @{18014='聊天'; 18016='向量'; 18018='导入'; 18019='训练'}
foreach ($p in $ports.Keys) {
    $up = $false
    try { $r = Invoke-WebRequest "http://127.0.0.1:$p/health" -UseBasicParsing -TimeoutSec 2; $up = ($r.StatusCode -eq 200) } catch {}
    Check ("{0} 端口（{1}）" -f $p, $ports[$p]) $up
}

Write-Host ""
if ($bad -eq 0) {
    Write-Host "结论：全部组件在本机，断网可用；不依赖 DeepSeek Harness，关闭它也能运行。" -ForegroundColor Green
    exit 0
} else {
    Write-Host ("结论：{0} 项正常，{1} 项异常，上面标红的看 logs\ 目录。" -f $ok, $bad) -ForegroundColor Red
    exit 1
}
