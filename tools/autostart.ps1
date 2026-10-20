# 开机自启开关：首次运行开启，再运行一次关闭
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup 'mini-14.lnk'

if (Test-Path $lnkPath) {
    Remove-Item $lnkPath -Force
    Write-Host '已关闭开机自启。' -ForegroundColor Yellow
} else {
    $ws = New-Object -ComObject WScript.Shell
    $lnk = $ws.CreateShortcut($lnkPath)
    $lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
    $lnk.Arguments = '"' + (Join-Path $root 'start.vbs') + '"'
    $lnk.WorkingDirectory = $root
    $lnk.IconLocation = (Join-Path $root 'assets\icon.ico') + ',0'
    $lnk.Description = 'mini-14 开机自启'
    $lnk.Save()
    Write-Host '已设置开机自启（登录后自动在后台启动服务，不弹窗）。' -ForegroundColor Green
}
