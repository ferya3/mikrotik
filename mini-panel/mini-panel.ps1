# MikroTik mini panel: CPU, connected users and internet (ping) in one small page.
#
# Runs on stock Windows PowerShell 5.1 - nothing to install, no Docker.
# The browser page talks only to this script on http://localhost:<port>; the script talks to the
# router's REST API (RouterOS v7, service "www" or "www-ssl") with a fixed set of read-only calls.
#
#   mini-panel.cmd             start (asks for the router details on first run)
#   mini-panel.cmd -Reset      enter the router details again
#   mini-panel.cmd -Port 8095  use another local port
#
# The router password is stored in config.json encrypted with Windows DPAPI: only this Windows
# user on this PC can decrypt it.

param(
    [int]$Port = 8090,
    [switch]$Reset,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $here 'config.json'
$pagePath = Join-Path $here 'index.html'

# ---------------------------------------------------------------- router access

function New-RouterSession($cfg, [string]$password) {
    $scheme = 'http'
    if ($cfg.https) { $scheme = 'https' }
    $script:Base = '{0}://{1}:{2}/rest' -f $scheme, $cfg.host, $cfg.port
    $script:Auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cfg.username + ':' + $password))
    $script:PingTarget = $cfg.pingTarget
}

# RouterOS uses a self-signed certificate by default; the router is addressed by its LAN IP.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }

# Returns the router's JSON response as a string (never parsed here, so nothing gets re-shaped).
function Invoke-Ros([string]$Method, [string]$Path, [string]$Body, [int]$TimeoutMs = 8000) {
    $req = [Net.HttpWebRequest]::Create($script:Base + $Path)
    $req.Method = $Method
    $req.Timeout = $TimeoutMs
    $req.ReadWriteTimeout = $TimeoutMs
    $req.Accept = 'application/json'
    $req.Headers['Authorization'] = $script:Auth
    if ($Body) {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Body)
        $req.ContentType = 'application/json'
        $req.ContentLength = $bytes.Length
        $stream = $req.GetRequestStream()
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Close()
    }
    $resp = $req.GetResponse()
    try {
        $reader = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
        return $reader.ReadToEnd()
    } finally {
        $resp.Close()
    }
}

# A literal IPv4/IPv6 address only (no host names, no "1" = 0.0.0.1 shortcuts).
function Test-IpLiteral([string]$s) {
    if ($s -match '^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$') { return $true }
    $ip = $null
    return ($s -match '^[0-9a-fA-F:.]+$' -and $s.Contains(':') -and [Net.IPAddress]::TryParse($s, [ref]$ip))
}

# /ping from the router. Only a validated IP and a bounded count ever reach the router.
function Invoke-Ping([string]$Target, [int]$Count, [string]$Interval) {
    if (-not (Test-IpLiteral $Target)) { throw 'Not an IP address' }
    $body = ConvertTo-Json -Compress -InputObject @{ address = $Target; count = [string]$Count; interval = $Interval }
    return '{"target":"' + $Target + '","rows":' + (Invoke-Ros 'POST' '/ping' $body (30000)) + '}'
}

# Turns any failure into {"error":<status>,"message":"...","detail":"..."} for the page.
function Get-ErrorJson($err) {
    $status = 0
    $detail = ''
    # Innermost cause, without PowerShell's "Exception calling ..." wrapper.
    $inner = $err.Exception
    while ($inner.InnerException) { $inner = $inner.InnerException }
    $message = $inner.Message
    $webEx = $err.Exception
    while ($webEx -and -not ($webEx -is [Net.WebException])) { $webEx = $webEx.InnerException }
    if ($webEx -and $webEx.Response) {
        $status = [int]$webEx.Response.StatusCode
        try {
            $reader = New-Object IO.StreamReader($webEx.Response.GetResponseStream(), [Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd() | ConvertFrom-Json
            if ($body.message) { $message = [string]$body.message }
            if ($body.detail) { $detail = [string]$body.detail }
        } catch { }
    }
    return (ConvertTo-Json -Compress -InputObject @{ error = $status; message = $message; detail = $detail })
}

# Optional menus (hotspot, PPP, kid-control) are missing on some routers: treat as empty.
function Get-Optional([string]$Path) {
    try { return (Invoke-Ros 'GET' $Path $null) } catch { return '[]' }
}

# The only calls the page can trigger. The one input (custom ping IP/count) is validated above.
$routes = @{
    '/api/system' = {
        '{"resource":' + (Invoke-Ros 'GET' '/system/resource?.proplist=cpu-load,free-memory,total-memory,uptime,version,board-name' $null) +
        ',"identity":' + (Invoke-Ros 'GET' '/system/identity' $null) + '}'
    }
    '/api/ping' = {
        Invoke-Ping $script:PingTarget 3 '200ms'
    }
    '/api/ping-test' = {
        param($ctx)
        $target = [string]$ctx.Request.QueryString['target']
        $count = 0
        if (-not [int]::TryParse([string]$ctx.Request.QueryString['count'], [ref]$count) -or $count -lt 1 -or $count -gt 20) { $count = 4 }
        if (-not (Test-IpLiteral $target)) { throw (New-Object ArgumentException('Enter an IP address, e.g. 4.2.2.4')) }
        Invoke-Ping $target $count '500ms'
    }
    '/api/accounts' = {
        '{"users":' + (Invoke-Ros 'GET' '/user?.proplist=name,group,disabled,address,last-logged-in,comment' $null) +
        ',"groups":' + (Invoke-Ros 'GET' '/user/group?.proplist=name,policy' $null) +
        ',"active":' + (Invoke-Ros 'GET' '/user/active?.proplist=name,address,via,when,group' $null) + '}'
    }
    '/api/users' = {
        param($ctx)
        # The connection table can be large; the page can switch it off (?conns=0) to spare the router CPU.
        $conns = '[]'
        if ($ctx.Request.QueryString['conns'] -ne '0') {
            $conns = Get-Optional '/ip/firewall/connection?.proplist=.id,src-address,orig-bytes,repl-bytes,orig-rate,repl-rate'
        }
        '{"leases":' + (Invoke-Ros 'GET' '/ip/dhcp-server/lease?.proplist=address,mac-address,host-name,comment,status,last-seen' $null) +
        ',"dhcpServers":' + (Get-Optional '/ip/dhcp-server?.proplist=name,interface') +
        ',"arp":' + (Invoke-Ros 'GET' '/ip/arp?.proplist=address,mac-address,interface,comment,complete' $null) +
        ',"queues":' + (Invoke-Ros 'GET' '/queue/simple?.proplist=name,target,rate,bytes,disabled' $null) +
        ',"kid":' + (Get-Optional '/ip/kid-control/device?.proplist=name,mac-address,ip-address,rate-down,rate-up,bytes-down,bytes-up') +
        ',"ppp":' + (Get-Optional '/ppp/active?.proplist=name,address,service,uptime') +
        ',"hotspot":' + (Get-Optional '/ip/hotspot/active?.proplist=user,address,mac-address,uptime') +
        ',"conns":' + $conns + '}'
    }
}

# ---------------------------------------------------------------- configuration

function Read-Default([string]$prompt, [string]$default) {
    $v = Read-Host ('{0} [{1}]' -f $prompt, $default)
    if ([string]::IsNullOrWhiteSpace($v)) { return $default }
    return $v.Trim()
}

function New-Config {
    Write-Host ''
    Write-Host 'Router details (press Enter to accept the value in brackets)' -ForegroundColor Cyan
    $useHttps = (Read-Default 'Use HTTPS (www-ssl)? y/n' 'n') -match '^[yY]'
    $defPort = '80'
    if ($useHttps) { $defPort = '443' }
    $cfg = [ordered]@{
        host       = Read-Default 'Router IP' '192.168.4.1'
        https      = $useHttps
        port       = [int](Read-Default 'Port' $defPort)
        username   = Read-Default 'Router username' 'mini'
        pingTarget = Read-Default 'IP to ping' '8.8.8.8'
    }
    if (-not (Test-IpLiteral $cfg.pingTarget)) { throw 'The ping target must be an IP address, e.g. 8.8.8.8' }
    $secure = Read-Host 'Router password' -AsSecureString
    return @{ cfg = $cfg; secure = $secure }
}

function Get-Plain($secure) {
    return (New-Object Net.NetworkCredential('', $secure)).Password
}

if ($Reset -and (Test-Path $configPath)) { Remove-Item $configPath }

if (Test-Path $configPath) {
    $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
    $password = Get-Plain ($cfg.password | ConvertTo-SecureString)
    New-RouterSession $cfg $password
} else {
    $new = New-Config
    $cfg = $new.cfg
    $password = Get-Plain $new.secure
    New-RouterSession $cfg $password
    Write-Host 'Testing the connection...'
    try {
        $null = Invoke-Ros 'GET' '/system/identity' $null
    } catch {
        $e = Get-ErrorJson $_ | ConvertFrom-Json
        Write-Host ('Could not connect: {0} {1}' -f $e.message, $e.detail) -ForegroundColor Red
        if ($e.error -eq 401) { Write-Host 'Check the username and password.' -ForegroundColor Yellow }
        elseif (('{0} {1}' -f $e.message, $e.detail) -match 'not allowed|permission') {
            Write-Host 'Connected, but the router user lacks a policy. In Winbox > Terminal run:' -ForegroundColor Yellow
            Write-Host '  /user group set mini policy=read,test,api,rest-api' -ForegroundColor Yellow
        }
        else { Write-Host 'Check the IP/port and that the router service is enabled: /ip service enable www' -ForegroundColor Yellow }
        exit 1
    }
    $cfg.password = ConvertFrom-SecureString $new.secure
    ConvertTo-Json -InputObject $cfg | Set-Content -Path $configPath -Encoding ASCII
    Write-Host 'Connected. Settings saved to config.json (password encrypted for this Windows user).' -ForegroundColor Green
}

# ---------------------------------------------------------------- local web server

function Send-Response($ctx, [int]$status, [string]$contentType, [string]$text) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($text)
    $ctx.Response.StatusCode = $status
    $ctx.Response.ContentType = $contentType
    $ctx.Response.Headers['Cache-Control'] = 'no-store'
    $ctx.Response.Headers['X-Content-Type-Options'] = 'nosniff'
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.Close()
}

$listener = New-Object Net.HttpListener
# localhost only: the page is not reachable from other machines, and needs no admin rights.
$listener.Prefixes.Add(('http://localhost:{0}/' -f $Port))
try {
    $listener.Start()
} catch {
    Write-Host ('Port {0} is busy. Run: mini-panel.cmd -Port 8095' -f $Port) -ForegroundColor Red
    exit 1
}

$url = 'http://localhost:{0}/' -f $Port
Write-Host ''
Write-Host ('Mini panel: {0}   (router {1})' -f $url, $cfg.host) -ForegroundColor Green
Write-Host 'Keep this window open. Press Ctrl+C to stop.'
if (-not $NoBrowser) { Start-Process $url }

$allowedHosts = @(('localhost:{0}' -f $Port), ('127.0.0.1:{0}' -f $Port))
try {
    while ($listener.IsListening) {
        # Poll so Ctrl+C is handled promptly.
        $pending = $listener.BeginGetContext($null, $null)
        while (-not $pending.AsyncWaitHandle.WaitOne(500)) { }
        $ctx = $listener.EndGetContext($pending)
        $path = $ctx.Request.Url.AbsolutePath
        try {
            # Reject other Host names (DNS rebinding) and anything but GET.
            if ($allowedHosts -notcontains $ctx.Request.Headers['Host'] -or $ctx.Request.HttpMethod -ne 'GET') {
                Send-Response $ctx 403 'text/plain' 'Forbidden'
            } elseif ($path -eq '/') {
                Send-Response $ctx 200 'text/html; charset=utf-8' ([IO.File]::ReadAllText($pagePath, [Text.Encoding]::UTF8))
            } elseif ($routes.ContainsKey($path)) {
                try {
                    Send-Response $ctx 200 'application/json; charset=utf-8' (& $routes[$path] $ctx)
                } catch {
                    if ($_.Exception -is [ArgumentException]) {
                        # Bad input from the page (e.g. not an IP): the router was never contacted.
                        $msg = ConvertTo-Json -Compress -InputObject @{ error = 400; message = $_.Exception.Message; detail = '' }
                        Send-Response $ctx 400 'application/json; charset=utf-8' $msg
                    } else {
                        Send-Response $ctx 502 'application/json; charset=utf-8' (Get-ErrorJson $_)
                    }
                }
            } else {
                Send-Response $ctx 404 'text/plain' 'Not found'
            }
        } catch {
            # The browser went away mid-response; keep serving.
        }
    }
} finally {
    $listener.Stop()
}
