# deploy-v2.1.ps1 —— 公开服一键部署（卫戍协议 · 炸惊 BETAv0.1 / V2.1 更新包）
#
# 在【公开服那台机器】上用管理员 PowerShell 跑（一行即可，见文末提示）：
#   iwr http://192.168.31.115:3000/deploy-v2.1.ps1 -OutFile $env:TEMP\d.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\d.ps1
#
# 它做什么（每一步都自检，失败就停下并告诉你怎么回滚）：
#   1. 检查环境：管理员权限、安装目录、计划任务、包能否下载
#   2. 先用回环地址发一条全服广播（玩家正在对局时有个准备）
#   3. 停服：停计划任务 → 结束 cmd 循环与 node（顺序不能反）
#   4. 备份 server / shared / public\js / public\css / data → <盘>\sp-backup-<时间>.zip（并校验）
#   5. 下载更新包（校验字节数 + 是合法 zip）→ 解压覆盖到安装目录
#   6. 把 UPDATE.json 挪开（它在的话服务器会拒绝启动）
#   7. 起服：起计划任务 → 等 HTTP 起来
#   8. 线上确认：版本名 / 默认模组表 / 公告 / 炸惊规则面板 / 惊变数据
#
# 回滚：powershell -NoProfile -ExecutionPolicy Bypass -File d.ps1 -Rollback
# 排练：-Root <临时目录> -Port 3999 -SkipTask -SkipAnnounce   （不碰计划任务与广播）
[CmdletBinding()]
param(
    [string]$Root = 'D:\Stronghold',
    [string]$Task = 'StrongholdProtocol',
    [string]$ZipUrl = 'http://192.168.31.115:3000/update-v2.1.zip',
    [int]$Port = 3000,
    [string]$ExpectZipBytes = '85319442',
    [switch]$SkipAnnounce,
    [switch]$SkipTask,
    [switch]$Rollback,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$script:Step = 0
$script:Problems = @()
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logPath = Join-Path (Split-Path $Root -Parent) "sp-deploy-$stamp.log"
try { Start-Transcript -Path $logPath -Force | Out-Null } catch { $logPath = $null }

function Say([string]$s = '') { Write-Host $s }
function Step([string]$s) { $script:Step++; Say ''; Say ("[{0}] {1}" -f $script:Step, $s) }
function Ok([string]$s) { Say "    OK   $s" }
function Bad([string]$s) { $script:Problems += $s; Say "    !!   $s" }
function Warn([string]$s) { Say "    ..   $s" }

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ServerAnswer([string]$path = '/healthz', [int]$timeoutMs = 4000) {
    try {
        $r = Invoke-WebRequest ("http://127.0.0.1:{0}{1}" -f $Port, $path) -UseBasicParsing -TimeoutSec ([int]($timeoutMs / 1000))
        return $r
    } catch { return $null }
}

function Wait-Server([int]$seconds = 90) {
    $until = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $until) {
        $r = Get-ServerAnswer '/'
        if ($r -and $r.StatusCode -eq 200) { return $true }
        Start-Sleep -Milliseconds 800
    }
    return $false
}

function Send-Announce([string]$text, [string]$level = 'warn', [int]$ttl = 0) {
    if ($SkipAnnounce) { return }
    try {
        $json = @{ text = $text; level = $level; ttlSec = $ttl } | ConvertTo-Json -Compress
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        $r = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/announce" -f $Port) -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 8
        Ok ("广播已发出（在线 {0}）" -f $r.sent)
    } catch { Warn ("广播没发出去（不影响部署）：{0}" -f $_.Exception.Message) }
}

function Get-NewestBackup {
    $dir = Split-Path $Root -Parent
    Get-ChildItem (Join-Path $dir 'sp-backup-*.zip') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

<#
  停掉游戏服务器。只认三条，绝不按「命令行里有 server\index.js」乱杀 —— 一台机器上可能同时跑着几个实例
  （2026-10-11 排练时就那样误杀了开发机的 3000）：
    1. cmd 循环（命令行含 run-server）
    2. 命令行里带本安装目录（$Root）
    3. 谁在监听 $Port 就结束谁 —— 公开服真正的 node 命令行只是 `node server\index.js`，
       前两条都匹配不到它；不干掉它，新进程会 EADDRINUSE，旧版本继续服务。
#>
function Get-ListenPids([int]$p) {
    $pids = @()
    try { $pids = @(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) } catch { }
    return $pids
}

function Stop-GameServer {
    $killed = @()
    $pids = Get-ListenPids $Port
    $rootPattern = [regex]::Escape($Root)
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe' or Name='cmd.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -and (
            $_.CommandLine -match 'run-server' -or
            $_.CommandLine -match $rootPattern -or
            ($pids -contains $_.ProcessId)
        )
    }
    foreach ($pr in $procs) {
        Stop-Process -Id $pr.ProcessId -Force -ErrorAction SilentlyContinue
        $killed += ("{0}({1})" -f $pr.Name, $pr.ProcessId)
    }
    # 还在监听就按 PID 再补一刀（比如不是 node 名字的进程）
    foreach ($lp in (Get-ListenPids $Port)) {
        Stop-Process -Id $lp -Force -ErrorAction SilentlyContinue
        $killed += ("pid:{0}" -f $lp)
    }
    return $killed
}

# ─────────────────────────────────────────────────────────────────────────────────────────────
Say '=============================================='
Say ' 卫戍协议 · 公开服部署（V2.1 / 炸惊 BETAv0.1）'
Say '=============================================='
Say ("  安装目录 : {0}" -f $Root)
Say ("  计划任务 : {0}" -f $(if ($SkipTask) { '(跳过)' } else { $Task }))
Say ("  更新包   : {0}" -f $ZipUrl)
Say ("  端口     : {0}" -f $Port)
Say ("  日志     : {0}" -f $(if ($logPath) { $logPath } else { '(未启用)' }))
if ($DryRun) { Say '  模式     : DryRun（只检查，不改任何东西）' }
if ($Rollback) { Say '  模式     : 回滚' }

# ── 0) 回滚分支 ──────────────────────────────────────────────────────────────────────────────
if ($Rollback) {
    Step '回滚'
    $bk = Get-NewestBackup
    if (-not $bk) { Bad '没找到 sp-backup-*.zip，无法回滚'; Say ''; Say '失败，未做任何改动。'; exit 1 }
    Say ("    用备份：{0}  ({1:N1} MB, {2})" -f $bk.FullName, ($bk.Length / 1MB), $bk.LastWriteTime)
    if (-not $DryRun) {
        if (-not $SkipTask) { Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue }
        $k = Stop-GameServer
        Ok ("结束进程：{0}" -f $(if ($k.Count) { $k -join ', ' } else { '无' }))
        Start-Sleep -Seconds 2
        Expand-Archive -Path $bk.FullName -DestinationPath $Root -Force
        Ok '备份已还原'
        if (-not $SkipTask) { Start-ScheduledTask -TaskName $Task }
    }
    Say ''; Say '回滚完成。'; exit 0
}

# ── 1) 环境检查 ─────────────────────────────────────────────────────────────────────────────
Step '检查环境'
$isAdmin = Test-Admin
if ($isAdmin) { Ok '管理员权限' }
elseif ($SkipTask) { Warn '非管理员，但 -SkipTask 模式不碰计划任务，可以继续' }
else { Bad '不是管理员 PowerShell —— 停/起计划任务会失败，请用「以管理员身份运行」' }
if (-not (Test-Path $Root)) { Bad ("安装目录不存在：{0}" -f $Root) } else { Ok ("安装目录存在：{0}" -f $Root) }
foreach ($sub in 'server', 'shared', 'public\js', 'data') {
    if (Test-Path (Join-Path $Root $sub)) { Ok ("有 {0}\" -f $sub) } else { Bad ("缺 {0}\" -f $sub) }
}
if (-not $SkipTask) {
    $t = Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
    if ($t) { Ok ("计划任务 {0}（状态 {1}）" -f $Task, $t.State) } else { Bad ("没找到计划任务 {0}（要用别的启动方式请加 -SkipTask 并手动起服）" -f $Task) }
}
try {
    $head = Invoke-WebRequest $ZipUrl -Method Head -UseBasicParsing -TimeoutSec 10
    $len = [int64]$head.Headers['Content-Length']
    if ($ExpectZipBytes -and $len -ne [int64]$ExpectZipBytes) { Bad ("更新包字节数不对：{0}（期望 {1}）" -f $len, $ExpectZipBytes) }
    else { Ok ("更新包可下载：{0:N1} MB" -f ($len / 1MB)) }
} catch { Bad ("更新包下载不到：{0}" -f $_.Exception.Message) }

$running = [bool](Get-ServerAnswer '/')
Say ("    服务器现在" + $(if ($running) { '在跑' } else { '没在跑' }))
if ($script:Problems.Count) {
    Say ''
    Say '环境检查没过，未做任何改动：'
    $script:Problems | ForEach-Object { Say ("  - {0}" -f $_) }
    exit 1
}
if ($DryRun) { Say ''; Say 'DryRun 结束：一切就绪，去掉 -DryRun 即可真正部署。'; exit 0 }

# ── 2) 广播 ─────────────────────────────────────────────────────────────────────────────────
Step '全服广播（重启提醒）'
if ($running) { Send-Announce '即将重启服务器更新 v2.1（炸惊模拟 BETAv0.1）请各位妥善处理当前对局' } else { Warn '服务器没在跑，跳过广播' }

# ── 3) 停服 ─────────────────────────────────────────────────────────────────────────────────
Step '停服'
if (-not $SkipTask) { Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue; Ok '计划任务已停' }
$killedList = Stop-GameServer
Ok ("结束进程：{0}" -f $(if ($killedList.Count) { $killedList -join ', ' } else { '无' }))
$free = $false
for ($i = 0; $i -lt 20; $i++) {
    $c = New-Object Net.Sockets.TcpClient
    try { $c.Connect('127.0.0.1', $Port); $c.Close() } catch { $free = $true; break }
    Start-Sleep -Milliseconds 500
}
if ($free) { Ok ("端口 {0} 已释放" -f $Port) } else { Warn ("端口 {0} 还占着（可能是别的程序），继续" -f $Port) }

# ── 4) 备份 ─────────────────────────────────────────────────────────────────────────────────
Step '备份'
$backup = Join-Path (Split-Path $Root -Parent) ("sp-backup-{0}.zip" -f $stamp)
$items = @('server', 'shared', 'public\js', 'public\css', 'data') | ForEach-Object { Join-Path $Root $_ } | Where-Object { Test-Path $_ }
Compress-Archive -Path $items -DestinationPath $backup -Force
if ((Test-Path $backup) -and ((Get-Item $backup).Length -gt 1MB)) { Ok ("备份 {0}（{1:N1} MB）" -f $backup, ((Get-Item $backup).Length / 1MB)) }
else { Bad ("备份异常：{0}" -f $backup); Say '备份不成立，停止部署。'; exit 1 }

# ── 5) 下载并解压 ───────────────────────────────────────────────────────────────────────────
Step '下载更新包'
$zip = Join-Path $env:TEMP ("update-v2.1-{0}.zip" -f $stamp)
$sw = [Diagnostics.Stopwatch]::StartNew()
(New-Object Net.WebClient).DownloadFile($ZipUrl, $zip)
$sw.Stop()
if ((Get-Item $zip).Length -ne [int64]$ExpectZipBytes) { Bad ("下载字节数不对：{0}" -f (Get-Item $zip).Length); Say '包不完整，停止部署（原始文件没动过）。'; exit 1 }
Ok ("下载完成 {0:N1} MB，用时 {1:N1} 秒" -f ((Get-Item $zip).Length / 1MB), $sw.Elapsed.TotalSeconds)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead($zip)
$entryCount = $z.Entries.Count
$hasServer = [bool]($z.Entries | Where-Object { $_.FullName -match '^server[\\/]index\.js$' })
$hasData = [bool]($z.Entries | Where-Object { $_.FullName -match '^data[\\/]zjDefaultLoadout\.json$' })
$z.Dispose()
if ($entryCount -gt 1000 -and $hasServer -and $hasData) { Ok ("包结构正确（{0} 个条目）" -f $entryCount) }
else { Bad '包结构不对，停止部署'; exit 1 }

Step '解压覆盖'
Expand-Archive -Path $zip -DestinationPath $Root -Force
Ok '已覆盖安装目录'

$upd = Join-Path $Root 'UPDATE.json'
if (Test-Path $upd) {
    $aside = Join-Path $Root ("UPDATE.json.disabled-{0}" -f $stamp)
    Move-Item $upd $aside -Force
    Warn ("发现 UPDATE.json，已挪到 {0}（它会让服务器拒绝启动）" -f (Split-Path $aside -Leaf))
}

# ── 6) 起服 ─────────────────────────────────────────────────────────────────────────────────
Step '起服'
if ($SkipTask) {
    Warn '跳过计划任务：直接起 node（排练模式）'
    $env:PORT = "$Port"
    Start-Process -FilePath 'node' -ArgumentList 'server/index.js' -WorkingDirectory $Root -WindowStyle Hidden
} else {
    Start-ScheduledTask -TaskName $Task
    Ok '计划任务已启动'
}
if (Wait-Server 90) { Ok 'HTTP 已就绪' } else { Bad ("等了 90 秒还没起来 —— 看 {0}\logs\server.log" -f $Root) }

# ── 7) 线上确认 ─────────────────────────────────────────────────────────────────────────────
Step '线上确认'
function Check([string]$label, [string]$path, [string]$needle) {
    $r = Get-ServerAnswer $path 4500
    if (-not $r) { Bad ("{0}：拿不到 {1}" -f $label, $path); return }
    if ($needle -and ($r.Content -notmatch [regex]::Escape($needle))) { Bad ("{0}：内容里没有「{1}」" -f $label, $needle); return }
    Ok ("{0}（{1} {2} B）" -f $label, $r.StatusCode, $r.RawContentLength)
}
Check '难度名 = 炸惊模拟（BETAv0.1）' '/data/config.json' '炸惊模拟（BETAv0.1）'
Check '默认模组表在' '/data/zjDefaultLoadout.json' '"count":85'
Check '最新公告 = V2.1' '/data/announcements.json' 'V2.1版本更新公告'
Check '炸惊规则面板' '/js/ui/zhajingRules.js' '炸惊'
Check '炸惊白值（zhajingBase）' '/shared/zhajingBase.js' 'allyScale'
Check '客户端接线（zjLoadout）' '/js/data.js' 'zjDefaultLoadout.json'
Check '惊变卡池数据' '/data/config.json' 'jibian'

if (-not $SkipAnnounce -and -not $script:Problems.Count) { Send-Announce '更新完成：炸惊模拟 BETAv0.1 已上线（默认模组 / 规则面板 / 惊变与机变调整），如有异常请反馈' 'info' 900 }

Say ''
Say '=============================================='
if ($script:Problems.Count) {
    Say (" 部署完成，但有 {0} 项没通过：" -f $script:Problems.Count)
    $script:Problems | ForEach-Object { Say ("   - {0}" -f $_) }
    Say ''
    Say (" 回滚：powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Rollback")
    Say (" 备份：{0}" -f $backup)
} else {
    Say ' 全部通过，公开服已是 V2.1（炸惊 BETAv0.1）'
    Say (" 备份：{0}" -f $backup)
    Say (" 日志：{0}" -f $logPath)
    Say ' 玩家端硬刷新（Ctrl+Shift+R）即可看到新内容。'
}
Say '=============================================='
if ($logPath) { try { Stop-Transcript | Out-Null } catch { } }
exit $(if ($script:Problems.Count) { 1 } else { 0 })
