# MikroTik read-only audit. Paste everything into Winbox > New Terminal on each router. Changes nothing.
# Output:  OK = fine   !! = problem (fix shown)   -- = information
# Edit the 3 lines under "SETTINGS" if this router is not in 192.168.4.0/24 behind the main router 192.168.4.1.
# Firewall and NAT rules are read one by one on purpose: "find where ..." filters gave wrong answers on RouterOS 7.24.
{
:local gw "192.168.4.1"
:local sub "192.168.4."
:local lan "192.168.4.0/24"
:local ok do={:put ("  OK  " . $1)}
:local bad do={:put ("  !!  " . $1)}
:local inf do={:put ("  --  " . $1)}

:put ""; :put "===== 1. SYSTEM"
:do {
  $inf ([/system identity get name] . " | " . [/system resource get board-name] . " | RouterOS " . [/system resource get version] . " | uptime " . [/system resource get uptime])
  :local cpu [/system resource get cpu-load]
  :if ($cpu > 70) do={$bad ("CPU " . $cpu . "%")} else={$ok ("CPU " . $cpu . "%")}
  :local tm [/system resource get total-memory]
  :local mp ((($tm - [/system resource get free-memory]) * 100) / $tm)
  :if ($mp > 85) do={$bad ("memory used " . $mp . "%")} else={$ok ("memory used " . $mp . "%")}
  :do {
    :local hp (([/system resource get free-hdd-space] * 100) / [/system resource get total-hdd-space])
    :if ($hp < 10) do={$bad ("disk free only " . $hp . "%: delete old files")} else={$ok ("disk free " . $hp . "%")}
  } on-error={}
  :if ([/system identity get name] = "MikroTik") do={$bad "identity is the default MikroTik: give each router its own name"}
  :if ([/system ntp client get enabled]) do={$ok "NTP client on"} else={$bad "NTP off: /system ntp client set enabled=yes"}
} on-error={$bad "system check failed"}
:do {
  :local cf [/system routerboard get current-firmware]
  :local uf [/system routerboard get upgrade-firmware]
  :if ($cf != $uf) do={$bad ("RouterBOOT " . $cf . " -> " . $uf . " : /system routerboard upgrade, then reboot")} else={$ok ("RouterBOOT " . $cf)}
} on-error={}
:do {
  /system package update check-for-updates
  :delay 3s
  :local iv [/system package update get installed-version]
  :local lv [/system package update get latest-version]
  :if (([:len $lv] > 0) && ($lv != $iv)) do={$bad ("RouterOS " . $iv . " -> " . $lv . " available: /system package update install")} else={$ok ("RouterOS " . $iv . " is current")}
} on-error={$inf "update check failed (no internet or DNS)"}

:put ""; :put "===== 2. PORTS AND TOPOLOGY"
:do {
  :foreach i in=[/interface find] do={
    :if ([/interface get $i type] = "ether") do={
      :local n [/interface get $i name]
      :local st "down"
      :if ([/interface get $i running]) do={:set st "UP"}
      :if ([/interface get $i disabled]) do={:set st "disabled"}
      :local br ""
      :foreach p in=[/interface bridge port find] do={:if ([/interface bridge port get $p interface] = $n) do={:set br [/interface bridge port get $p bridge]}}
      $inf ($n . " (" . $st . ") bridge=" . $br)
      :local e ([/interface get $i rx-error] + [/interface get $i tx-error])
      :if ($e > 50) do={$bad ($n . " has " . $e . " rx/tx errors: bad cable, port or speed/duplex")}
    }
  }
} on-error={$bad "port check failed"}
:do {
  :foreach b in=[/interface bridge find] do={
    :local bn [/interface bridge get $b name]
    :if ([/interface bridge get $b protocol-mode] = "none") do={$bad ("bridge " . $bn . " has no loop protection: /interface bridge set " . $bn . " protocol-mode=rstp")} else={$ok ("bridge " . $bn . " protocol " . [/interface bridge get $b protocol-mode])}
  }
} on-error={}
:do {
  :put "  --  neighbors (other devices this router sees):"
  :foreach n in=[/ip neighbor find] do={:put ("       " . [/ip neighbor get $n address] . "  " . [/ip neighbor get $n identity] . "  " . [/ip neighbor get $n board] . "  " . [/ip neighbor get $n interface])}
} on-error={}

:put ""; :put "===== 3. IP, ROUTING, INTERNET"
:do {
  :foreach a in=[/ip address find] do={
    :if ([/ip address get $a disabled] = false) do={$inf ([/ip address get $a address] . " on " . [/ip address get $a interface])}
  }
} on-error={}
:do {
  :local found 0
  :foreach r in=[/ip route find] do={
    :if (([:tostr [/ip route get $r dst-address]] = "0.0.0.0/0") && ([/ip route get $r disabled] = false)) do={
      :set found ($found + 1)
      :local g [:tostr [/ip route get $r gateway]]
      :if ([/ip route get $r active]) do={
        :if ($g = $gw) do={$ok ("default route via the main router " . $g)} else={$inf ("default route via " . $g . " (main router is " . $gw . ")")}
      } else={$bad ("default route via " . $g . " is NOT active: gateway unreachable")}
    }
  }
  :if ($found = 0) do={$bad "no default route: no internet"}
} on-error={$bad "route check failed"}
:do {
  :local p1 [/ping $gw count=3]
  :if ($p1 = 0) do={$bad ("no reply from the main router " . $gw)} else={$ok ("main router " . $gw . ": " . $p1 . "/3 replies")}
  :local p2 [/ping 8.8.8.8 count=3]
  :if ($p2 = 0) do={$bad "no reply from 8.8.8.8: internet down"} else={$ok ("8.8.8.8: " . $p2 . "/3 replies")}
} on-error={$bad "ping failed"}
:do {:local rip [:resolve google.com]; $ok ("resolves google.com -> " . $rip)} on-error={$bad "cannot resolve names: check /ip dns servers"}
:do {
  :foreach s in=[/ip dhcp-server find] do={
    :if ([/ip dhcp-server get $s disabled] = false) do={
      :local ifn [/ip dhcp-server get $s interface]
      $inf ("DHCP server " . [/ip dhcp-server get $s name] . " on " . $ifn . " pool " . [/ip dhcp-server get $s address-pool])
      :foreach a in=[/ip address find] do={
        :local ad [:tostr [/ip address get $a address]]
        :if (([/ip address get $a interface] = $ifn) && ([:pick $ad 0 [:len $sub]] = $sub)) do={$bad ("second DHCP server inside the main network (" . $ad . "): clients get conflicting settings. /ip dhcp-server disable " . [/ip dhcp-server get $s name])}
      }
    }
  }
} on-error={}
:do {
  :foreach p in=[/ip pool find] do={
    :local rg [:tostr [/ip pool get $p ranges]]
    :local d [:find $rg "-"]
    :if ([:typeof $d] = "num") do={
      :local size ([:toip [:pick $rg ($d + 1) [:len $rg]]] - [:toip [:pick $rg 0 $d]] + 1)
      :local pu 0
      :foreach u in=[/ip pool used find] do={:if ([/ip pool used get $u pool] = [/ip pool get $p name]) do={:set pu ($pu + 1)}}
      :if (($pu * 100 / $size) > 85) do={$bad ("pool " . [/ip pool get $p name] . " almost full: " . $pu . " of " . $size)}
    }
  }
} on-error={}

:put ""; :put "===== 4. FIREWALL AND NAT"
:do {
  :local broad 0
  :local inv 0
  :local ft 0
  :foreach r in=[/ip firewall filter find] do={
    :do {
      :if (([/ip firewall filter get $r disabled] = false) && ([/ip firewall filter get $r dynamic] = false)) do={
        :local ch [/ip firewall filter get $r chain]
        :local ac [/ip firewall filter get $r action]
        :local cs [:tostr [/ip firewall filter get $r connection-state]]
        :if (($ch = "input") && ($ac = "drop") && ([:len [:tostr [/ip firewall filter get $r protocol]]] = 0) && ([:len [:tostr [/ip firewall filter get $r dst-port]]] = 0) && ([:len $cs] = 0)) do={:set broad ($broad + 1)}
        :if (($ch = "forward") && ($ac = "drop") && ($cs ~ "invalid")) do={:set inv ($inv + 1)}
        :if ($ac = "fasttrack-connection") do={:set ft ($ft + 1)}
      }
    } on-error={}
  }
  :if ($broad > 0) do={$ok "input: a general drop rule protects the router itself"} else={$bad "input: NO general drop rule, anything in the LAN can reach the router. /ip firewall filter add chain=input action=drop in-interface-list=!LAN (after the accept established/icmp rules)"}
  :if ($inv > 0) do={$ok "forward: invalid packets dropped"} else={$inf "forward: invalid packets are not dropped"}
  :if ($ft > 0) do={$inf "FastTrack on: queues and limits do not see fasttracked traffic"}
} on-error={$bad "firewall check failed"}
:do {
  :foreach r in=[/ip firewall nat find] do={
    :do {
      :if (([/ip firewall nat get $r disabled] = false) && ([/ip firewall nat get $r action] = "dst-nat")) do={
        :local src ([:tostr [/ip firewall nat get $r src-address]] . [:tostr [/ip firewall nat get $r src-address-list]])
        :local d ([:tostr [/ip firewall nat get $r dst-address]] . ":" . [:tostr [/ip firewall nat get $r dst-port]] . " -> " . [:tostr [/ip firewall nat get $r to-addresses]] . ":" . [:tostr [/ip firewall nat get $r to-ports]] . "  " . [/ip firewall nat get $r comment])
        :if ([:len $src] = 0) do={$bad ("port forward open to the whole internet: " . $d)} else={$ok ("port forward only for " . $src . ": " . $d)}
      }
      :if (([/ip firewall nat get $r disabled] = false) && ([/ip firewall nat get $r action] = "masquerade")) do={$inf "masquerade on: devices behind this router are hidden (double NAT if the main router also does NAT)"}
    } on-error={}
  }
} on-error={}
:do {
  :if ([/ip dns get allow-remote-requests]) do={$inf "DNS answers requests from the network (fine if the input drop rule above is present)"}
} on-error={}

:put ""; :put "===== 5. SERVICES AND ACCESS"
:do {
  :foreach s in=[/ip service find] do={
    :if ([/ip service get $s disabled] = false) do={
      :local n [/ip service get $s name]
      :local from ""
      :do {:set from [:tostr [/ip service get $s available-from]]} on-error={:do {:set from [:tostr [/ip service get $s address]]} on-error={}}
      :if (($n = "telnet") || ($n = "ftp")) do={$bad ($n . " is on, passwords travel in plain text: /ip service disable " . $n)} else={
        :if ([:len $from] = 0) do={$bad ($n . " (port " . [/ip service get $s port] . ") open to ANY address: /ip service set " . $n . " available-from=" . $lan)} else={$ok ($n . " (port " . [/ip service get $s port] . ") only from " . $from)}
      }
    }
  }
} on-error={$bad "service check failed"}
:do {
  :foreach u in=[/user find] do={
    :if ([/user get $u disabled] = false) do={
      :local n [/user get $u name]
      :local a [:tostr [/user get $u address]]
      :if ($n = "admin") do={$bad "user admin is enabled: the first name attackers try"}
      :if ([:len $a] = 0) do={$bad ("user " . $n . " (" . [/user get $u group] . ") can log in from ANY address: /user set " . $n . " address=" . $lan)} else={$ok ("user " . $n . " (" . [/user get $u group] . ") only from " . $a)}
    }
  }
} on-error={$bad "user check failed"}
:do {
  :local na [:len [/user active find]]
  :if ($na > 6) do={$bad ($na . " login sessions right now: unusual, check /user active print")} else={
    :foreach a in=[/user active find] do={$inf ("session: " . [/user active get $a name] . " from " . [/user active get $a address] . " via " . [/user active get $a via])}
  }
} on-error={}
:do {:if ([/tool mac-server get allowed-interface-list] != "LAN") do={$bad ("MAC-Telnet allowed on " . [/tool mac-server get allowed-interface-list] . ": /tool mac-server set allowed-interface-list=LAN")} else={$ok "MAC-Telnet LAN only"}} on-error={}
:do {:if ([/tool mac-server mac-winbox get allowed-interface-list] != "LAN") do={$bad ("MAC-Winbox allowed on " . [/tool mac-server mac-winbox get allowed-interface-list] . ": /tool mac-server mac-winbox set allowed-interface-list=LAN")} else={$ok "MAC-Winbox LAN only"}} on-error={}
:do {:if ([/ip neighbor discovery-settings get discover-interface-list] != "LAN") do={$bad ("neighbor discovery on " . [/ip neighbor discovery-settings get discover-interface-list] . ": /ip neighbor discovery-settings set discover-interface-list=LAN")} else={$ok "neighbor discovery LAN only"}} on-error={}
:do {:if ([/tool bandwidth-server get enabled]) do={$bad "bandwidth-test server on: /tool bandwidth-server set enabled=no"} else={$ok "bandwidth-test server off"}} on-error={}
:do {:if ([/ip upnp get enabled]) do={$bad "UPnP on: /ip upnp set enabled=no"} else={$ok "UPnP off"}} on-error={}
:do {:if ([/ip socks get enabled]) do={$bad "SOCKS proxy on, a common backdoor: /ip socks set enabled=no"} else={$ok "SOCKS off"}} on-error={}
:do {:if ([/ip proxy get enabled]) do={$bad "web proxy on: /ip proxy set enabled=no"} else={$ok "web proxy off"}} on-error={}
:do {:if ([/snmp get enabled]) do={$bad "SNMP on: /snmp set enabled=no"} else={$ok "SNMP off"}} on-error={}
:do {:if ([/ip ssh get forwarding-enabled] != "no") do={$bad "SSH forwarding on: /ip ssh set forwarding-enabled=no"} else={$ok "SSH forwarding off"}} on-error={}
:do {:if ([/ip ssh get strong-crypto]) do={$ok "SSH strong crypto"} else={$bad "SSH allows weak crypto: /ip ssh set strong-crypto=yes"}} on-error={}
:do {:if ([:len [/system script find]] = 0) do={$ok "no scripts"} else={$bad ([:len [/system script find]] . " script(s): make sure they are yours (/system script print)")}} on-error={}
:do {:if ([:len [/user ssh-keys find]] = 0) do={$ok "no SSH keys"} else={$bad ([:len [/user ssh-keys find]] . " SSH key(s): make sure they are yours (/user ssh-keys print)")}} on-error={}
:do {
  :foreach s in=[/system scheduler find] do={
    :if ([/system scheduler get $s on-event] ~ "fetch|import|http") do={$bad ("scheduler " . [/system scheduler get $s name] . " downloads or runs code")} else={$inf ("scheduler " . [/system scheduler get $s name] . " every " . [/system scheduler get $s interval])}
  }
} on-error={}

:put ""; :put "===== 6. LOGS AND LOAD"
:do {:if ([/system logging action get [find name=memory] memory-lines] < 100) do={$bad ("log memory only " . [/system logging action get [find name=memory] memory-lines] . " lines, the log is useless: /system logging action set [find name=memory] memory-lines=1000")} else={$ok "log memory ok"}} on-error={}
:do {:if ([:len [/system logging find where disabled=yes]] > 0) do={$bad "some logging rules are disabled: /system logging enable [find disabled=yes]"} else={$ok "all logging rules enabled"}} on-error={}
:do {
  :local lf [:len [/log find where message~"login failure"]]
  :if ($lf > 20) do={$bad ($lf . " login failures in the log: someone is guessing passwords (/log print where message~\"login failure\")")} else={$ok ($lf . " login failures in the log")}
  :local lp [:len [/log find where message~"loop"]]
  :if ($lp > 0) do={$bad ($lp . " loop messages in the log: cable or bridge loop")} else={$ok "no loop messages"}
} on-error={}
:do {
  :local ce [/ip firewall connection tracking get total-entries]
  :if ($ce > 50000) do={$bad ($ce . " tracked connections: virus, torrent or attack")} else={$ok ($ce . " tracked connections")}
} on-error={}
:put ""; :put "===== END"
}
