<#
  announce.ps1 — 向全服广播一条公告(全服公告的发送端)。

  用法(通常你只需要双击同目录的 announce.cmd):
    双击              读取本目录的 notice.txt 并广播(info 级,常驻)
    announce.cmd warn   同上,但用警告配色
    announce.cmd error  同上,但用重要配色
    announce.cmd clear  撤下当前公告
    announce.cmd 60     60 秒后自动消失(可以和 warn/error 一起用)

  为什么做成「读文件」而不是让你在窗口里输入:运维常常是通过远程桌面或 SSH 进来,终端里既打不了中文也不好
  粘贴。记事本没有这两个问题,所以消息写在 notice.txt 里,这个脚本只负责把它送出去。
  (这些文件名保持 ASCII:中英文 Windows 上 .cmd/.ps1 的编码很脆弱,正文放 txt 里最稳。)

  鉴权:服务端信任本机回环来源(见 server/http/routes.js),所以在服务器上跑本脚本不需要任何 token。

  退出码:0 成功;1 失败(服务没起 / 广播被拒)。
#>

[CmdletBinding()]
param(
  # 公告正文所在的文件。留空 = 脚本同目录的 notice.txt。
  # 为什么不在这里直接写 Join-Path $PSScriptRoot:PowerShell 5.1 求值参数默认值时 $PSScriptRoot 还是空的
  # (要等参数绑定之后才填),会报 "Cannot bind argument to parameter 'Path' because it is an empty string"。
  [string]$File = '',
  # info | warn | error
  [string]$Level = 'info',
  # 显示多少秒后自动消失;0 = 常驻直到玩家关闭
  [int]$Seconds = 0,
  # 撤下当前公告(不需要正文)
  [switch]$Clear,
  # 服务端口,默认与 run-server.cmd 一致的 3000
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 脚本所在目录(参数绑定之后再算,这时路径才可用)
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot }
  elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path }
  else { (Get-Location).Path }
if (-not $File) { $File = Join-Path $ScriptDir 'notice.txt' }

function Say([string]$Text, [string]$Color = 'Gray') {
  Write-Host $Text -ForegroundColor $Color
}
function Fail([string]$Text) {
  Say ''
  Say "  ✗ $Text" 'Red'
  exit 1
}

Say ''
Say '============================================================' 'DarkCyan'
Say '   卫戍协议：盟约 · 全服公告' 'Cyan'
Say '============================================================' 'DarkCyan'
Say ''

# ---- 允许把参数写成位置形式(announce.cmd warn / clear / 60)----------------------------------------
# cmd 会把 `announce.cmd warn 60` 原样透传成 -File 之后的参数,PowerShell 会当成位置参数;
# 这里把它们归位,免得到窗口里还得记参数名。
$positional = @($args)
foreach ($a in $positional) {
  $s = [string]$a
  if ($s -match '^(?i)(info|warn|error)$') { $Level = $s.ToLower() }
  elseif ($s -match '^(?i)clear$') { $Clear = $true }
  elseif ($s -match '^\d+$') { $Seconds = [int]$s }
}

if ($Clear) {
  Say '  正在撤下当前公告…' 'Gray'
} else {
  # ---- 读正文 ------------------------------------------------------------------------------------
  if (-not (Test-Path -LiteralPath $File)) {
    Fail "找不到公告文件:$File"
  }
  # 记事本可能存成 UTF-8(带或不带 BOM)、UTF-16 或 GBK —— 全都试一遍,取第一个不出错的
  $text = $null
  foreach ($enc in @('utf8', 'unicode', 'bigendianunicode', 'default')) {
    try {
      $raw = [System.IO.File]::ReadAllText($File, [System.Text.Encoding]::$enc)
      if ($null -ne $raw -and $raw.Trim().Length -gt 0) { $text = $raw; break }
    } catch { }
  }
  if (-not $text) { $text = Get-Content -LiteralPath $File -Raw -Encoding UTF8 }
  if ($null -eq $text) { $text = '' }

  # 去掉 BOM、注释行(# 开头)和空行 —— 方便你把几种说法都写在文件里,临时注释掉不用的
  $lines = $text -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') }
  $body = ($lines -join ' ').Trim()

  if (-not $body) { Fail "公告内容为空。请用记事本编辑:$File" }
  if ($body.Length -gt 300) {
    Say "  ! 内容超过 300 字,将被截断:$($body.Length) 字" 'Yellow'
  }

  Say '  公告内容:' 'Gray'
  Say "    $body" 'White'
  Say ''
  $lvlName = @{ info = '普通(青色)'; warn = '警告(琥珀色)'; error = '重要(橙红色)' }[$Level]
  if (-not $lvlName) { $lvlName = $Level }
  Say "  显示级别:$lvlName" 'Gray'
  if ($Seconds -gt 0) { Say "  自动消失:${Seconds} 秒后" 'Gray' } else { Say '  自动消失:不消失(玩家手动关闭)' 'Gray' }
  Say ''
}

# ---- 服务在跑吗 ------------------------------------------------------------------------------------
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 6
} catch {
  Fail "连不上本机 $Port 端口的服务 —— 服务器没有在运行?(先确认计划任务 StrongholdProtocol 已启动)"
}
Say "  服务状态:在线(build $($health.build),在线人数 $($health.humans))" 'Green'
Say ''

# ---- 发送 ------------------------------------------------------------------------------------------
$payload = if ($Clear) { @{ clear = $true } } else { @{ text = $body; level = $Level; ttlSec = $Seconds } }
$json = $payload | ConvertTo-Json -Compress
# ConvertTo-Json 会把中文转成 \uXXXX,对服务端完全没问题;这里保持 UTF-8 字节发送
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

try {
  $res = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/announce" -Method Post -Body $bytes `
    -ContentType 'application/json; charset=utf-8' -TimeoutSec 15
} catch {
  $code = $null
  try { $code = [int]$_.Exception.Response.StatusCode } catch { }
  if ($code -eq 403) { Fail '服务拒绝了请求(403)。确认你是在服务器本机运行本脚本。' }
  elseif ($code -eq 401) { Fail '需要 token(401)。本机来源本应免 token,请确认端口指向本机服务。' }
  else { Fail "广播失败:$($_.Exception.Message)" }
}

if ($res.ok -ne $true) { Fail "服务返回失败:$($res.error)" }

Say ''
if ($Clear) {
  Say "  ✓ 已撤下公告,通知了 $($res.sent) 个连接。" 'Green'
} else {
  Say "  ✓ 广播成功,已送达 $($res.sent) 个在线连接。" 'Green'
  Say "    玩家会看到屏幕顶部的一条横幅。" 'Gray'
}
Say ''
