# Audit several MikroTik routers from one Windows PC: security and correct network operation.
# READ-ONLY: every call is a GET, except /ping (a test) - nothing is changed on any router.
#
# Needs RouterOS v7 on the target (REST API). Windows PowerShell 5.1, nothing to install.
#
#   audit-fleet.cmd -Discover                       find MikroTiks next to the main router, then audit them
#   audit-fleet.cmd -Hosts 192.168.4.2,192.168.4.3  audit these routers
#   audit-fleet.cmd -Hosts 192.168.4.2:8080         with a non-default port
#
# Each router needs a temporary read-only user and the "www" service. In the router terminal:
#   /user group add name=audit policy=read,test,api,rest-api
#   /user add name=audit group=audit password="TEMP-PASSWORD" address=192.168.4.0/24
#   /ip service set www disabled=no available-from=192.168.4.0/24
# and when the audit is done:
#   /user remove audit
#   /user group remove audit
#   /ip service set www disabled=yes        (only if www was disabled before)
#
# Routers on RouterOS v6 have no REST API: paste tools/router-audit.rsc into their terminal instead.

param(
    [string[]]$Hosts = @(),
    [switch]$Discover,
    [string]$User = 'audit',
    # The main router: downstream routers should use it as gateway, and must not run a second DHCP server on its subnet.
    [string]$Gateway = '192.168.4.1',
    [string]$MainSubnet = '192.168.4.',
    # Routers older than this are reported as needing an update.
    [string]$LatestVersion = '7.24.4',
    [string]$Report = ''
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Report) { $Report = Join-Path $here ('audit-report-{0}.txt' -f (Get-Date -Format 'yyyyMMdd-HHmm')) }

# RouterOS uses a self-signed certificate by default. A compiled delegate: script blocks can fail on other threads.
if (-not ('TrustAll' -as [type])) {
    Add-Type -TypeDefinition @"
using System.Net;
public static class TrustAll {
    public static void Enable() { ServicePointManager.ServerCertificateValidationCallback = delegate { return true; }; }
}
"@
}
[TrustAll]::Enable()
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---------------------------------------------------------------- REST helpers

function Invoke-Ros($s, [string]$Method, [string]$Path, [string]$Body, [int]$TimeoutMs = 8000) {
    $req = [Net.HttpWebRequest]::Create($s.Base + $Path)
    $req.Method = $Method
    $req.Proxy = $null   # routers are on the LAN: never go through a system proxy
    $req.Timeout = $TimeoutMs
    $req.ReadWriteTimeout = $TimeoutMs
    $req.Accept = 'application/json'
    $req.Headers['Authorization'] = $s.Auth
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

# { Code; Message } from a failed request, without PowerShell's wrapper text.
function Get-RosError($err) {
    $inner = $err.Exception
    while ($inner.InnerException) { $inner = $inner.InnerException }
    $msg = $inner.Message
    $code = 0
    $we = $err.Exception
    while ($we -and -not ($we -is [Net.WebException])) { $we = $we.InnerException }
    if ($we -and $we.Response) {
        $code = [int]$we.Response.StatusCode
        try {
            $reader = New-Object IO.StreamReader($we.Response.GetResponseStream(), [Text.Encoding]::UTF8)
            $b = $reader.ReadToEnd() | ConvertFrom-Json
            if ($b.detail) { $msg = [string]$b.detail } elseif ($b.message) { $msg = [string]$b.message }
        } catch { }
    }
    return @{ Code = $code; Message = $msg }
}

# One object for single-row menus (/system/resource), or $null when the menu is missing.
function Get-One($s, [string]$Path) {
    try {
        $t = Invoke-Ros $s 'GET' $Path $null
        if ([string]::IsNullOrWhiteSpace($t)) { return $null }
        $o = $t | ConvertFrom-Json
        if ($o -is [array]) { return $o[0] }
        return $o
    } catch { return $null }
}

# The rows of a menu, one object per row. Emits nothing when the menu is empty or missing on this router,
# so always call it as @(Get-List ...) to get a real array.
function Get-List($s, [string]$Path) {
    try {
        $t = Invoke-Ros $s 'GET' $Path $null
        if ([string]::IsNullOrWhiteSpace($t)) { return }
        $o = $t | ConvertFrom-Json
        if ($null -eq $o) { return }
        return $o
    } catch { return }
}

function Connect-Router([string]$spec, [string]$user, [string]$plain) {
    $hostName = $spec
    $port = 0
    if ($spec -match '^(.+):(\d+)$') { $hostName = $Matches[1]; $port = [int]$Matches[2] }
    $auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($user + ':' + $plain))
    $tries = @()
    if ($port -gt 0) { $tries += ,@('http', $port); $tries += ,@('https', $port) }
    else { $tries += ,@('http', 80); $tries += ,@('https', 443) }
    $last = 'no answer'
    foreach ($t in $tries) {
        $s = @{ Base = ('{0}://{1}:{2}/rest' -f $t[0], $hostName, $t[1]); Auth = $auth; Label = $spec }
        try {
            $null = Invoke-Ros $s 'GET' '/system/identity' $null 5000
            return @{ Session = $s }
        } catch {
            $e = Get-RosError $_
            if ($e.Code -eq 401) { return @{ Error = 'auth' } }
            $last = $e.Message
        }
    }
    return @{ Error = 'connect'; Detail = $last }
}

# ---------------------------------------------------------------- output

$script:Lines = New-Object System.Collections.ArrayList
$script:Cur = $null

function Out-Line([string]$text, [string]$color = 'Gray') {
    Write-Host $text -ForegroundColor $color
    [void]$script:Lines.Add($text)
}
function Pass([string]$m) { Out-Line ('  OK  ' + $m) 'Green'; $script:Cur.Ok++ }
function Note([string]$m) { Out-Line ('  --  ' + $m) 'Gray' }
function Fail([string]$m, [string]$fix = '') {
    Out-Line ('  !!  ' + $m) 'Red'
    $script:Cur.Bad++
    if ($fix) { Out-Line ('        fix: ' + $fix) 'DarkYellow' }
}
function Head([string]$m) { Out-Line ''; Out-Line ('--- ' + $m) 'Cyan' }

function ConvertTo-UInt([string]$ip) {
    $b = [Net.IPAddress]::Parse($ip).GetAddressBytes()
    [Array]::Reverse($b)
    return [double][BitConverter]::ToUInt32($b, 0)
}

function Test-Flag($v) { return ($v -eq 'true' -or $v -eq 'yes') }

# ---------------------------------------------------------------- checks for one router

function Test-Router($s, $summary) {
    $res = Get-One $s '/system/resource'
    $identity = (Get-One $s '/system/identity').name
    $summary.Name = $identity

    Head 'System'
    Note ('{0} | {1} | RouterOS {2} | uptime {3}' -f $identity, $res.'board-name', $res.version, $res.uptime)
    $summary.Version = ($res.version -split ' ')[0]
    $summary.Cpu = [int]$res.'cpu-load'
    if ($identity -eq 'MikroTik') { Note 'identity is the default "MikroTik" - give each router its own name' }
    if ($summary.Version -match '^\d+(\.\d+)*') {
        try {
            if ([version]$Matches[0] -lt [version]$LatestVersion) {
                Fail ('RouterOS {0} is older than {1}' -f $summary.Version, $LatestVersion) '/system package update install   (older versions have known remote exploits)'
            } else { Pass ('RouterOS ' + $summary.Version + ' is current') }
        } catch { Note 'could not compare versions' }
    }
    $rb = Get-One $s '/system/routerboard'
    if ($rb -and $rb.'current-firmware' -and $rb.'upgrade-firmware' -and ($rb.'current-firmware' -ne $rb.'upgrade-firmware')) {
        Fail ('RouterBOOT {0} -> {1}' -f $rb.'current-firmware', $rb.'upgrade-firmware') '/system routerboard upgrade   then reboot'
    }
    if ($summary.Cpu -gt 70) { Fail ('CPU load {0}%' -f $summary.Cpu) '/tool profile duration=20s   to see what uses it' } else { Pass ('CPU load {0}%' -f $summary.Cpu) }
    $total = [double]$res.'total-memory'
    $memPct = [int](100 * ($total - [double]$res.'free-memory') / $total)
    $summary.Mem = $memPct
    if ($memPct -gt 85) { Fail ('memory used {0}%' -f $memPct) } else { Pass ('memory used {0}%' -f $memPct) }
    if ([double]$res.'total-hdd-space' -gt 0) {
        $hddFree = [int](100 * [double]$res.'free-hdd-space' / [double]$res.'total-hdd-space')
        if ($hddFree -lt 10) { Fail ('disk free only {0}%' -f $hddFree) 'delete old files and backups in /file' }
    }
    foreach ($h in @(Get-List $s '/system/health')) {
        if ($h -and $h.name -match 'temperature' -and [double]$h.value -gt 70) { Fail ('{0} = {1} C: too hot' -f $h.name, $h.value) }
    }
    $ntp = Get-One $s '/system/ntp/client'
    if ($ntp -and -not (Test-Flag $ntp.enabled)) { Fail 'NTP client is off, the clock and the logs will be wrong' '/system ntp client set enabled=yes' }

    Head 'Access'
    foreach ($svc in @(Get-List $s '/ip/service')) {
        if (-not $svc -or (Test-Flag $svc.disabled)) { continue }
        $from = $svc.'available-from'
        if (-not $from) { $from = $svc.address }
        if ($svc.name -eq 'telnet' -or $svc.name -eq 'ftp') {
            Fail ($svc.name + ' is on: passwords travel in plain text') ('/ip service disable ' + $svc.name)
        } elseif (-not $from) {
            Fail ('{0} (port {1}) is open to ANY address' -f $svc.name, $svc.port) ('/ip service set {0} available-from={1}0/24' -f $svc.name, $MainSubnet)
        } else { Pass ('{0} (port {1}) only from {2}' -f $svc.name, $svc.port, $from) }
    }
    $users = @(Get-List $s '/user')
    $full = 0
    foreach ($u in $users) {
        if (-not $u -or (Test-Flag $u.disabled)) { continue }
        if ($u.group -eq 'full') { $full++ }
        if ($u.name -eq 'admin') { Fail 'user "admin" is enabled: the first name attackers try' '/user add name=NEWNAME group=full password=...   then   /user disable admin' }
        if (-not $u.address) { Fail ('user {0} ({1}) can log in from ANY address' -f $u.name, $u.group) ('/user set {0} address={1}0/24' -f $u.name, $MainSubnet) }
    }
    Note ('{0} enabled user(s), {1} with full rights' -f @($users | Where-Object { $_ -and -not (Test-Flag $_.disabled) }).Count, $full)
    foreach ($a in @(Get-List $s '/user/active')) {
        if ($a -and $a.address -and $a.address -notlike ($MainSubnet + '*') -and $a.address -notmatch '^[0-9A-Fa-f]{2}:') {
            Fail ('{0} is logged in from outside the LAN: {1} via {2}' -f $a.name, $a.address, $a.via)
        }
    }
    $keys = @(Get-List $s '/user/ssh-keys')
    if ($keys -and $keys.Count -gt 0) { Fail ('{0} SSH key(s) installed: make sure they are yours' -f $keys.Count) '/user ssh-keys print' }
    $scripts = @(Get-List $s '/system/script')
    if ($scripts -and $scripts.Count -gt 0) { Fail ('{0} script(s): {1}. Make sure they are yours' -f $scripts.Count, (($scripts | ForEach-Object { $_.name }) -join ', ')) '/system script print' }
    foreach ($sc in @(Get-List $s '/system/scheduler')) {
        if (-not $sc) { continue }
        if ($sc.'on-event' -match 'fetch|/import|https?://') { Fail ('scheduler "{0}" downloads or runs code' -f $sc.name) ('/system scheduler print detail where name="' + $sc.name + '"') }
        else { Note ('scheduler {0} every {1}' -f $sc.name, $sc.interval) }
    }
    $ms = Get-One $s '/tool/mac-server'
    if ($ms -and $ms.'allowed-interface-list' -ne 'LAN') { Fail ('MAC-Telnet allowed on "{0}"' -f $ms.'allowed-interface-list') '/tool mac-server set allowed-interface-list=LAN' }
    $mw = Get-One $s '/tool/mac-server/mac-winbox'
    if ($mw -and $mw.'allowed-interface-list' -ne 'LAN') { Fail ('MAC-Winbox allowed on "{0}"' -f $mw.'allowed-interface-list') '/tool mac-server mac-winbox set allowed-interface-list=LAN' }
    $nd = Get-One $s '/ip/neighbor/discovery-settings'
    if ($nd -and $nd.'discover-interface-list' -ne 'LAN') { Fail ('neighbor discovery on "{0}"' -f $nd.'discover-interface-list') '/ip neighbor discovery-settings set discover-interface-list=LAN' }
    $checks = @(
        @('/tool/bandwidth-server', 'enabled', 'bandwidth-test server is on', '/tool bandwidth-server set enabled=no'),
        @('/ip/upnp', 'enabled', 'UPnP is on: devices can open ports by themselves', '/ip upnp set enabled=no'),
        @('/ip/socks', 'enabled', 'SOCKS proxy is on: a common backdoor', '/ip socks set enabled=no'),
        @('/ip/proxy', 'enabled', 'web proxy is on', '/ip proxy set enabled=no'),
        @('/snmp', 'enabled', 'SNMP is on', '/snmp set enabled=no')
    )
    foreach ($c in $checks) {
        $o = Get-One $s $c[0]
        if ($o -and (Test-Flag $o.($c[1]))) { Fail $c[2] $c[3] }
    }
    $ssh = Get-One $s '/ip/ssh'
    if ($ssh) {
        if ($ssh.'forwarding-enabled' -and $ssh.'forwarding-enabled' -ne 'no') { Fail 'SSH forwarding is on (lets the router be used as a tunnel)' '/ip ssh set forwarding-enabled=no' }
        if (-not (Test-Flag $ssh.'strong-crypto')) { Fail 'SSH allows weak crypto' '/ip ssh set strong-crypto=yes' }
    }

    Head 'Firewall'
    $fw = @(Get-List $s '/ip/firewall/filter')
    $rules = @($fw | Where-Object { $_ -and -not (Test-Flag $_.disabled) -and -not (Test-Flag $_.dynamic) })
    $inputDrops = @($rules | Where-Object { $_.chain -eq 'input' -and $_.action -eq 'drop' })
    $broad = @($inputDrops | Where-Object { -not $_.protocol -and -not $_.'dst-port' -and -not $_.'src-address' -and -not $_.'src-address-list' })
    if ($broad.Count -gt 0) { Pass 'input: a general drop rule protects the router itself' }
    else { Fail 'input: no general drop rule. Anything in the LAN (even an infected PC) can reach the router' '/ip firewall filter add chain=input action=drop in-interface-list=!LAN comment="drop all not from LAN"   (after accept established / icmp rules)' }
    $fwdInvalid = @($rules | Where-Object { $_.chain -eq 'forward' -and $_.action -eq 'drop' -and $_.'connection-state' -match 'invalid' })
    if ($fwdInvalid.Count -gt 0) { Pass 'forward: invalid packets dropped' } else { Note 'forward: invalid packets are not dropped' }
    if (@($rules | Where-Object { $_.action -eq 'fasttrack-connection' }).Count -gt 0) { Note 'FastTrack is on: queues and limits do not see fasttracked traffic' }
    foreach ($n in @(Get-List $s '/ip/firewall/nat')) {
        if (-not $n -or (Test-Flag $n.disabled) -or (Test-Flag $n.dynamic)) { continue }
        if ($n.action -eq 'dst-nat') {
            $d = ('{0}:{1} -> {2}:{3} {4}' -f $n.'dst-address', $n.'dst-port', $n.'to-addresses', $n.'to-ports', $n.comment)
            if (-not $n.'src-address' -and -not $n.'src-address-list') { Fail ('port forward open to everyone: ' + $d) } else { Pass ('port forward limited by source: ' + $d) }
        } elseif ($n.action -eq 'masquerade') {
            Note 'masquerade is on: devices behind this router are hidden behind it (double NAT if the main router also does NAT)'
        }
    }
    $dns = Get-One $s '/ip/dns'
    if ($dns -and (Test-Flag $dns.'allow-remote-requests') -and $broad.Count -eq 0) { Fail 'DNS answers everyone and nothing protects it: DNS amplification attacks' '/ip dns set allow-remote-requests=no  (or add the input drop rule above)' }

    Head 'Network operation'
    $addrs = @(Get-List $s '/ip/address' | Where-Object { $_ -and -not (Test-Flag $_.disabled) })
    foreach ($a in $addrs) { Note ('{0} on {1}' -f $a.address, $a.interface) }
    $routes = @(Get-List $s '/ip/route' | Where-Object { $_ -and $_.'dst-address' -eq '0.0.0.0/0' -and -not (Test-Flag $_.disabled) })
    if ($routes.Count -eq 0) { Fail 'no default route: this router has no internet' }
    else {
        $active = @($routes | Where-Object { Test-Flag $_.active })
        if ($active.Count -eq 0) { Fail ('default route via {0} is NOT active: gateway unreachable' -f $routes[0].gateway) }
        else {
            $gw = [string]$active[0].gateway
            if ($gw -eq $Gateway) { Pass ('default route via the main router ' + $gw) } else { Note ('default route via {0} (main router is {1})' -f $gw, $Gateway) }
        }
    }
    foreach ($target in @($Gateway, '8.8.8.8', 'google.com')) {
        try {
            $body = ConvertTo-Json -Compress -InputObject @{ address = $target; count = '3'; interval = '300ms' }
            $rows = @((Invoke-Ros $s 'POST' '/ping' $body 30000) | ConvertFrom-Json)
            $last = $rows[$rows.Count - 1]
            $recv = [int]$last.received
            if ($recv -eq 0) { Fail ('ping {0}: no reply' -f $target) }
            elseif ($recv -lt [int]$last.sent) { Fail ('ping {0}: {1}/{2} replies (packet loss), avg {3}' -f $target, $recv, $last.sent, $last.'avg-rtt') }
            else { Pass ('ping {0}: {1}/{2}, avg {3}' -f $target, $recv, $last.sent, $last.'avg-rtt') }
        } catch {
            $e = Get-RosError $_
            Note ('ping {0} not possible: {1} (the audit user needs the "test" policy)' -f $target, $e.Message)
            break
        }
    }
    $pools = @(Get-List $s '/ip/pool')
    $used = @(Get-List $s '/ip/pool/used')
    foreach ($srv in @(Get-List $s '/ip/dhcp-server' | Where-Object { $_ -and -not (Test-Flag $_.disabled) })) {
        Note ('DHCP server {0} on {1}, pool {2}' -f $srv.name, $srv.interface, $srv.'address-pool')
        foreach ($a in $addrs) {
            if ($a.interface -eq $srv.interface -and ([string]$a.address).StartsWith($MainSubnet)) {
                Fail ('second DHCP server in the main network ({0}): two servers hand out addresses and clients get conflicting settings' -f $a.address) ('/ip dhcp-server disable ' + $srv.name)
            }
        }
        $pool = @($pools | Where-Object { $_ -and $_.name -eq $srv.'address-pool' })
        if ($pool.Count -gt 0) {
            $size = 0.0
            foreach ($part in ([string]$pool[0].ranges -split ',')) {
                if ($part -match '^(\d+\.\d+\.\d+\.\d+)-(\d+\.\d+\.\d+\.\d+)$') { $size += (ConvertTo-UInt $Matches[2]) - (ConvertTo-UInt $Matches[1]) + 1 }
            }
            $inUse = @($used | Where-Object { $_ -and $_.pool -eq $pool[0].name }).Count
            if ($size -gt 0 -and ($inUse / $size) -gt 0.85) { Fail ('pool {0} almost full: {1} of {2} used' -f $pool[0].name, $inUse, [int]$size) }
        }
    }
    $bridges = @(Get-List $s '/interface/bridge')
    $ports = @(Get-List $s '/interface/bridge/port')
    foreach ($b in $bridges) {
        if (-not $b) { continue }
        $n = @($ports | Where-Object { $_ -and $_.bridge -eq $b.name }).Count
        if ($b.'protocol-mode' -eq 'none' -and $n -gt 1) { Fail ('bridge {0} ({1} ports) has no loop protection' -f $b.name, $n) ('/interface bridge set {0} protocol-mode=rstp' -f $b.name) }
        else { Note ('bridge {0}: {1} ports, {2}' -f $b.name, $n, $b.'protocol-mode') }
    }
    foreach ($i in @(Get-List $s '/interface' | Where-Object { $_ -and $_.type -eq 'ether' })) {
        $err = [double]$i.'rx-error' + [double]$i.'tx-error'
        if ($err -gt 50) { Fail ('{0} has {1} rx/tx errors: bad cable, port or speed/duplex' -f $i.name, [int]$err) }
        if ((Test-Flag $i.running) -eq $false -and -not (Test-Flag $i.disabled)) { Note ('{0} is down' -f $i.name) }
    }
    $trk = Get-One $s '/ip/firewall/connection/tracking'
    if ($trk -and $trk.'total-entries') {
        if ([int]$trk.'total-entries' -gt 50000) { Fail ('{0} tracked connections: virus, torrent or attack' -f $trk.'total-entries') } else { Note ('{0} tracked connections' -f $trk.'total-entries') }
    }

    Head 'Logs'
    $mem = @(Get-List $s '/system/logging/action' | Where-Object { $_ -and $_.name -eq 'memory' })
    if ($mem.Count -gt 0 -and [int]$mem[0].'memory-lines' -lt 100) {
        Fail ('log memory is only {0} lines: the log is useless (attackers cut it to hide their traces)' -f $mem[0].'memory-lines') '/system logging action set [find name=memory] memory-lines=1000'
    }
    $off = @(Get-List $s '/system/logging' | Where-Object { $_ -and (Test-Flag $_.disabled) })
    if ($off.Count -gt 0) { Fail ('{0} logging rule(s) are disabled' -f $off.Count) '/system logging enable [find disabled=yes]' }
    $log = @(Get-List $s '/log')
    $fails = @($log | Where-Object { $_ -and $_.message -match 'login failure' })
    if ($fails.Count -gt 10) {
        $top = $fails | ForEach-Object { if ($_.message -match 'from (\S+) via') { $Matches[1] } } | Group-Object | Sort-Object Count -Descending | Select-Object -First 3
        Fail ('{0} login failures in the log; top sources: {1}' -f $fails.Count, (($top | ForEach-Object { '{0} x{1}' -f $_.Name, $_.Count }) -join ', '))
    } else { Pass ('{0} login failures in the log' -f $fails.Count) }
    $loops = @($log | Where-Object { $_ -and $_.message -match 'loop' })
    if ($loops.Count -gt 0) { Fail ('{0} "loop" messages in the log: cable or bridge loop' -f $loops.Count) }
}

# ---------------------------------------------------------------- main

$targets = New-Object System.Collections.ArrayList
# powershell -File passes "-Hosts a,b" as ONE string, so split on commas and spaces here.
foreach ($item in $Hosts) {
    foreach ($h in ($item -split '[,;\s]+')) { if ($h -and -not $targets.Contains($h)) { [void]$targets.Add($h) } }
}

if ($Discover) {
    $cfgPath = Join-Path $here '..\mini-panel\config.json'
    if (-not (Test-Path $cfgPath)) { throw 'Discovery reads the neighbor list of the main router using the mini panel settings (mini-panel\config.json). Run mini-panel.cmd once first, or pass -Hosts.' }
    $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
    $sec = $cfg.password | ConvertTo-SecureString
    $plain = (New-Object Net.NetworkCredential('', $sec)).Password
    $scheme = 'http'
    if ($cfg.https) { $scheme = 'https' }
    $main = @{ Base = ('{0}://{1}:{2}/rest' -f $scheme, $cfg.host, $cfg.port); Auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cfg.username + ':' + $plain)) }
    $neighbors = @(Get-List $main '/ip/neighbor')
    if ($neighbors.Count -eq 0) { Write-Host 'The main router sees no neighbors (or the user cannot read /ip/neighbor).' -ForegroundColor Yellow }
    Write-Host ''
    Write-Host 'MikroTik devices the main router can see:' -ForegroundColor Cyan
    foreach ($n in $neighbors) {
        if (-not $n -or -not $n.address -or ($n.platform -and $n.platform -ne 'MikroTik')) { continue }
        Write-Host ('  {0,-16} {1,-20} {2,-14} {3}  {4}' -f $n.address, $n.identity, $n.board, $n.version, $n.interface)
        if ($targets -notcontains $n.address) { [void]$targets.Add([string]$n.address) }
    }
    Write-Host '  (Routers behind another router are not listed here: add them with -Hosts.)' -ForegroundColor DarkGray
}

if ($targets.Count -eq 0) {
    Write-Host 'Nothing to audit. Use -Discover or -Hosts 192.168.4.2,192.168.4.3' -ForegroundColor Yellow
    exit 1
}

Write-Host ''
$secure = Read-Host ('Password of user "{0}" (same on every router; Enter = ask per router)' -f $User)
$defaultPlain = (New-Object Net.NetworkCredential('', $secure)).Password

$summaries = New-Object System.Collections.ArrayList
foreach ($spec in $targets) {
    $summary = @{ Address = $spec; Name = '?'; Version = '?'; Cpu = ''; Mem = ''; Ok = 0; Bad = 0; Note = '' }
    $script:Cur = $summary
    Out-Line ''
    Out-Line ('=================== {0} ===================' -f $spec) 'White'
    $plain = $defaultPlain
    $conn = if ($plain) { Connect-Router $spec $User $plain } else { @{ Error = 'auth' } }
    if ($conn.Error -eq 'auth') {
        $again = Read-Host ('Password for {0} (Enter = skip)' -f $spec)
        if ($again) { $conn = Connect-Router $spec $User $again } else { $conn = @{ Error = 'skipped' } }
    }
    if (-not $conn.Session) {
        switch ($conn.Error) {
            'auth' { $summary.Note = 'wrong user/password'; Fail 'login rejected: check the user and password (the user needs the "read,test,api,rest-api" policies)' }
            'skipped' { $summary.Note = 'skipped'; Note 'skipped' }
            default {
                $summary.Note = 'REST not reachable'
                Fail ('cannot connect: {0}' -f $conn.Detail)
                Note 'The router may run RouterOS v6 (no REST API), or the www service is off. Paste tools/router-audit.rsc into its terminal instead,'
                Note ('or enable it:  /ip service set www disabled=no available-from={0}0/24' -f $MainSubnet)
            }
        }
        [void]$summaries.Add($summary)
        continue
    }
    try { Test-Router $conn.Session $summary } catch { $summary.Note = 'audit stopped'; Fail ('audit stopped: ' + (Get-RosError $_).Message) }
    [void]$summaries.Add($summary)
}

Out-Line ''
Out-Line '=================== SUMMARY ===================' 'White'
Out-Line ('{0,-20} {1,-18} {2,-10} {3,-5} {4,-5} {5,-8} {6}' -f 'Address', 'Name', 'RouterOS', 'CPU%', 'Mem%', 'Problems', '') 'White'
foreach ($m in $summaries) {
    $color = 'Green'
    if ($m.Bad -gt 0) { $color = 'Red' }
    Out-Line ('{0,-20} {1,-18} {2,-10} {3,-5} {4,-5} {5,-8} {6}' -f $m.Address, $m.Name, $m.Version, $m.Cpu, $m.Mem, $m.Bad, $m.Note) $color
}
Set-Content -Path $Report -Value ($script:Lines -join "`r`n") -Encoding ASCII
Write-Host ''
Write-Host ('Report saved: {0}' -f $Report) -ForegroundColor Cyan
