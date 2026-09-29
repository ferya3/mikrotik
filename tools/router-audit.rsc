# MikroTik read-only audit: topology, routing, DHCP/DNS, firewall, access, IPv6, logs.
# Paste everything into Winbox > New Terminal. Changes nothing on the router.
# Each { } block runs on its own, so an error in one section does not stop the others.
# Output:  OK = fine   !! = problem (fix command shown)   -- = information
# LAN is assumed to be 192.168.4.0/24 in the suggested fix commands.

:global aOK do={:put ("  OK  " . $1)}
:global aBAD do={:put ("  !!  " . $1)}
:global aINF do={:put ("  --  " . $1)}

{
:global aOK; :global aBAD; :global aINF
:put ""; :put "===== 1. SYSTEM"
$aINF ([/system identity get name] . " | " . [/system resource get board-name] . " | RouterOS " . [/system resource get version] . " | uptime " . [/system resource get uptime])
:local cpu [/system resource get cpu-load]
:if ($cpu > 70) do={$aBAD ("CPU load " . $cpu . "%")} else={$aOK ("CPU load " . $cpu . "%")}
:local tm [/system resource get total-memory]
:local mp ((($tm - [/system resource get free-memory]) * 100) / $tm)
:if ($mp > 85) do={$aBAD ("memory used " . $mp . "%")} else={$aOK ("memory used " . $mp . "%")}
:local hp (([/system resource get free-hdd-space] * 100) / [/system resource get total-hdd-space])
:if ($hp < 10) do={$aBAD ("disk free only " . $hp . "% - delete old files and backups")} else={$aOK ("disk free " . $hp . "%")}
:do {
  :local cf [/system routerboard get current-firmware]
  :local uf [/system routerboard get upgrade-firmware]
  :if ($cf != $uf) do={$aBAD ("RouterBOOT " . $cf . " -> " . $uf . " : /system routerboard upgrade  then reboot")} else={$aOK ("RouterBOOT " . $cf)}
} on-error={$aINF "no RouterBOOT (CHR or x86)"}
:do {
  :foreach h in=[/system health find] do={
    :local hn [/system health get $h name]
    :local hv [/system health get $h value]
    :if (($hn~"temperature") && ([:tonum $hv] > 70)) do={$aBAD ($hn . " = " . $hv . " - too hot")} else={$aINF ($hn . " = " . $hv)}
  }
} on-error={}
:local ch [/system package update get channel]
:if (($ch != "stable") && ($ch != "long-term")) do={$aBAD ("update channel is " . $ch . " : /system package update set channel=stable")} else={$aOK ("update channel " . $ch)}
:do {
  /system package update check-for-updates
  :delay 3s
  :local iv [/system package update get installed-version]
  :local lv [/system package update get latest-version]
  :if (([:len $lv] > 0) && ($lv != $iv)) do={$aBAD ("RouterOS " . $iv . " -> " . $lv . " available : /system package update install")} else={$aOK ("RouterOS " . $iv . " is current")}
} on-error={$aINF "update check failed (no internet or DNS)"}
:if ([/system ntp client get enabled]) do={$aOK "NTP client on"} else={$aBAD "NTP client off, clock may be wrong : /system ntp client set enabled=yes servers=pool.ntp.org"}
$aINF ("clock " . [/system clock get date] . " " . [/system clock get time])
}

{
:global aOK; :global aBAD; :global aINF
:put ""; :put "===== 2. PORTS AND TOPOLOGY"
:foreach i in=[/interface find where type="ether"] do={
  :local n [/interface get $i name]
  :local br ""
  :foreach p in=[/interface bridge port find where interface=$n] do={:set br [/interface bridge port get $p bridge]}
  :local ips ""
  :foreach a in=[/ip address find where interface=$n] do={:set ips ($ips . [/ip address get $a address] . " ")}
  :local lists ""
  :foreach m in=[/interface list member find where interface=$n] do={:set lists ($lists . [/interface list member get $m list] . " ")}
  :local st "down"
  :if ([/interface get $i running]) do={:set st "UP"}
  :if ([/interface get $i disabled]) do={:set st "disabled"}
  :put ("  " . $n . " (" . $st . ")  bridge=" . $br . "  ip=" . $ips . " lists=" . $lists . " " . [/interface get $i comment])
  :if (($st = "UP") && ([:len $br] = 0) && ([:len $ips] = 0)) do={$aBAD ($n . " is UP but in no bridge and has no IP - unused cable or mistake")}
}
:foreach b in=[/interface bridge find] do={
  :local bn [/interface bridge get $b name]
  :local pm [/interface bridge get $b protocol-mode]
  $aINF ("bridge " . $bn . " has " . [:len [/interface bridge port find where bridge=$bn]] . " ports, protocol-mode=" . $pm)
  :if ($pm = "none") do={$aBAD ("bridge " . $bn . " has no loop protection : /interface bridge set " . $bn . " protocol-mode=rstp")}
}
:if ([:len [/interface list member find where list="WAN"]] = 0) do={$aBAD "interface list WAN is empty - firewall rules using WAN do nothing"} else={$aOK ("WAN list has " . [:len [/interface list member find where list="WAN"]] . " member(s)")}
:if ([:len [/interface list member find where list="LAN"]] = 0) do={$aBAD "interface list LAN is empty"} else={$aOK ("LAN list has " . [:len [/interface list member find where list="LAN"]] . " member(s)")}
:do {
  :foreach i in=[/interface find where type="ether" and running] do={
    :local e ([/interface get $i rx-error] + [/interface get $i tx-error])
    :if ($e > 0) do={$aBAD ([/interface get $i name] . " has " . $e . " rx/tx errors - bad cable, port or speed/duplex")}
  }
} on-error={$aINF "interface error counters not available"}
:put "  -- other network devices seen by neighbor discovery:"
:foreach n in=[/ip neighbor find] do={
  :put ("       " . [:tostr [/ip neighbor get $n interface]] . "  " . [/ip neighbor get $n address] . "  " . [/ip neighbor get $n identity] . "  " . [/ip neighbor get $n platform] . " " . [/ip neighbor get $n board])
}
}

{
:put ""; :put "===== 3. DEVICES BEHIND EACH PORT (MAC addresses learned)"
:foreach i in=[/interface find where type="ether" and running] do={
  :local n [/interface get $i name]
  :put ("  " . $n . ": " . [:len [/interface bridge host find where on-interface=$n]] . " MAC(s)")
}
}

{
:global aOK; :global aBAD; :global aINF
:put ""; :put "===== 4. IP AND ROUTING"
:foreach a in=[/ip address find] do={
  :local d ""
  :if ([/ip address get $a disabled]) do={:set d "  (disabled)"}
  $aINF ([/ip address get $a address] . " on " . [/ip address get $a interface] . $d)
}
:local dr [/ip route find where dst-address=0.0.0.0/0]
:if ([:len $dr] = 0) do={$aBAD "no default route - no internet"}
:foreach r in=$dr do={
  :local gw [:tostr [/ip route get $r gateway]]
  :if ([/ip route get $r disabled]) do={$aINF ("default route via " . $gw . " is disabled")} else={
    :if ([/ip route get $r active]) do={$aOK ("default route via " . $gw . " active, distance " . [/ip route get $r distance])} else={$aBAD ("default route via " . $gw . " NOT active - gateway unreachable")}
  }
}
:foreach c in=[/ip dhcp-client find] do={$aINF ("dhcp-client on " . [/ip dhcp-client get $c interface] . " status=" . [/ip dhcp-client get $c status])}
:local pr [/ping 8.8.8.8 count=3]
:if ($pr = 0) do={$aBAD "no reply from 8.8.8.8 - internet down"} else={$aOK ("internet: " . $pr . "/3 replies from 8.8.8.8")}
:do {:local rip [:resolve google.com]; $aOK ("router resolves google.com -> " . $rip)} on-error={$aBAD "router cannot resolve names - check /ip dns servers"}
}

{
:global aOK; :global aBAD; :global aINF
:put ""; :put "===== 5. DHCP AND DNS"
:local srv [/ip dhcp-server find where disabled=no]
:if ([:len $srv] = 0) do={$aINF "no DHCP server running"}
:foreach s in=$srv do={
  :local nm [/ip dhcp-server get $s name]
  :local pool [/ip dhcp-server get $s address-pool]
  $aINF ("DHCP " . $nm . " on " . [/ip dhcp-server get $s interface] . " pool=" . $pool . " leases=" . [:len [/ip dhcp-server lease find where server=$nm]] . " lease-time=" . [/ip dhcp-server get $s lease-time])
  :do {
    :local rg [:tostr [/ip pool get [find name=$pool] ranges]]
    :local d [:find $rg "-"]
    :local size ([:toip [:pick $rg ($d + 1) [:len $rg]]] - [:toip [:pick $rg 0 $d]] + 1)
    :local pu [:len [/ip pool used find where pool=$pool]]
    :if (($pu * 100 / $size) > 85) do={$aBAD ("pool " . $pool . " almost full: " . $pu . " of " . $size . " used")} else={$aOK ("pool " . $pool . ": " . $pu . " of " . $size . " used")}
  } on-error={}
}
:foreach n in=[/ip dhcp-server network find] do={
  :local gw [:tostr [/ip dhcp-server network get $n gateway]]
  :local na [/ip dhcp-server network get $n address]
  :if ([:len $gw] = 0) do={$aBAD ("DHCP network " . $na . " gives no gateway to clients")} else={$aOK ("DHCP network " . $na . " gateway=" . $gw . " dns=" . [:tostr [/ip dhcp-server network get $n dns-server]])}
}
:local ds [:tostr [/ip dns get servers]]
:local dd [:tostr [/ip dns get dynamic-servers]]
:if (([:len $ds] = 0) && ([:len $dd] = 0)) do={$aBAD "router has no DNS servers"} else={$aOK ("DNS servers: " . $ds . " " . $dd)}
:if ([/ip dns get allow-remote-requests]) do={
  :if ([:len [/ip firewall filter find where chain=input and action=drop and disabled=no and comment~"from LAN"]] > 0) do={$aOK "DNS answers LAN only (WAN blocked by firewall)"} else={$aBAD "DNS allow-remote-requests=yes and no WAN block - DNS amplification attacks!"}
} else={$aOK "DNS remote requests off"}
}

{
:global aOK; :global aBAD; :global aINF
:put ""; :put "===== 6. FIREWALL AND NAT"
:if ([:len [/ip firewall filter find where chain=input and action=drop and disabled=no and comment~"from LAN"]] > 0) do={$aOK "input: everything not from LAN is dropped"} else={$aBAD "input: no drop-all-not-from-LAN rule - router reachable from internet!"}
:if ([:len [/ip firewall filter find where chain=forward and action=drop and disabled=no and connection-state=invalid]] > 0) do={$aOK "forward: invalid packets dropped"} else={$aBAD "forward: invalid packets not dropped : /ip firewall filter add chain=forward connection-state=invalid action=drop comment=\"drop invalid\""}
:if ([:len [/ip firewall filter find where chain=forward and action=drop and disabled=no and comment~"DSTNAT"]] > 0) do={$aOK "forward: new connections from WAN only if port-forwarded"} else={$aBAD "forward: no rule blocking new connections from WAN (only NAT hides the LAN) : /ip firewall filter add chain=forward action=drop connection-state=new connection-nat-state=!dstnat in-interface-list=WAN comment=\"drop WAN not DSTNATed\""}
:if ([:len [/ip firewall filter find where action=fasttrack-connection and disabled=no]] > 0) do={$aINF "FastTrack on: simple queues and limits do not see fasttracked traffic"}
:put "  -- input and forward rules in order:"
:foreach r in=[/ip firewall filter find where chain=input or chain=forward] do={
  :local d ""
  :if ([/ip firewall filter get $r disabled]) do={:set d " (disabled)"}
  :put ("       " . [/ip firewall filter get $r chain] . "  " . [/ip firewall filter get $r action] . "  " . [/ip firewall filter get $r comment] . $d)
}
:if (([:len [/ip firewall nat find where action=masquerade and disabled=no]] + [:len [/ip firewall nat find where action=src-nat and disabled=no]]) = 0) do={$aBAD "no masquerade or src-nat - LAN has no internet"} else={$aOK "masquerade/src-nat present"}
:foreach r in=[/ip firewall nat find where action=dst-nat and disabled=no] do={
  :local src ([:tostr [/ip firewall nat get $r src-address]] . [:tostr [/ip firewall nat get $r src-address-list]])
  :local d ([:tostr [/ip firewall nat get $r dst-address]] . ":" . [:tostr [/ip firewall nat get $r dst-port]] . " -> " . [:tostr [/ip firewall nat get $r to-addresses]] . ":" . [:tostr [/ip firewall nat get $r to-ports]] . "  " . [/ip firewall nat get $r comment])
  :if ([:len $src] = 0) do={$aBAD ("port open to the whole internet: " . $d)} else={$aOK ("port only for " . $src . ": " . $d)}
}
}

{
:global aOK; :global aBAD; :global aINF
:put ""; :put "===== 7. SERVICES AND ACCESS"
:foreach s in=[/ip service find where disabled=no] do={
  :local n [/ip service get $s name]
  :local a ""
  :do {:set a [:tostr [/ip service get $s available-from]]} on-error={:do {:set a [:tostr [/ip service get $s address]]} on-error={}}
  :if (($n = "telnet") || ($n = "ftp")) do={$aBAD ($n . " is on, passwords travel in plain text : /ip service disable " . $n)} else={
    :if ([:len $a] = 0) do={$aBAD ($n . " (port " . [/ip service get $s port] . ") open to ANY address : /ip service set " . $n . " available-from=192.168.4.0/24")} else={$aOK ($n . " (port " . [/ip service get $s port] . ") only from " . $a)}
  }
}
:foreach u in=[/user find where disabled=no] do={
  :local n [/user get $u name]
  :local a ""
  :do {:set a [:tostr [/user get $u address]]} on-error={}
  :if ($n = "admin") do={$aBAD "user admin is enabled - the first name attackers try"}
  :if ([:len $a] = 0) do={$aBAD ("user " . $n . " (" . [/user get $u group] . ") can log in from ANY address : /user set " . $n . " address=192.168.4.0/24")} else={$aOK ("user " . $n . " (" . [/user get $u group] . ") only from " . $a)}
}
:local v [/tool mac-server get allowed-interface-list]
:if ($v != "LAN") do={$aBAD ("MAC-Telnet allowed on " . $v . " : /tool mac-server set allowed-interface-list=LAN")} else={$aOK "MAC-Telnet LAN only"}
:set v [/tool mac-server mac-winbox get allowed-interface-list]
:if ($v != "LAN") do={$aBAD ("MAC-Winbox allowed on " . $v . " : /tool mac-server mac-winbox set allowed-interface-list=LAN")} else={$aOK "MAC-Winbox LAN only"}
:set v [/ip neighbor discovery-settings get discover-interface-list]
:if ($v != "LAN") do={$aBAD ("neighbor discovery on " . $v . " : /ip neighbor discovery-settings set discover-interface-list=LAN")} else={$aOK "neighbor discovery LAN only"}
:if ([/tool bandwidth-server get enabled]) do={$aBAD "bandwidth-test server on : /tool bandwidth-server set enabled=no"} else={$aOK "bandwidth-test server off"}
:if ([/ip upnp get enabled]) do={$aBAD "UPnP on, devices can open ports by themselves : /ip upnp set enabled=no"} else={$aOK "UPnP off"}
:if ([/ip socks get enabled]) do={$aBAD "SOCKS proxy on - common backdoor : /ip socks set enabled=no"} else={$aOK "SOCKS off"}
:if ([/ip proxy get enabled]) do={$aBAD "web proxy on : /ip proxy set enabled=no"} else={$aOK "web proxy off"}
:if ([/snmp get enabled]) do={$aBAD "SNMP on : /snmp set enabled=no"} else={$aOK "SNMP off"}
:if ([/ip ssh get strong-crypto]) do={$aOK "SSH strong crypto"} else={$aBAD "SSH allows weak crypto : /ip ssh set strong-crypto=yes"}
:do {:if ([/tool romon get enabled]) do={$aBAD "RoMON on : /tool romon set enabled=no"} else={$aOK "RoMON off"}} on-error={}
:foreach s in=[/system scheduler find] do={$aINF ("scheduler " . [/system scheduler get $s name] . " every " . [/system scheduler get $s interval])}
:if ([:len [/system script find]] = 0) do={$aOK "no scripts"} else={:foreach s in=[/system script find] do={$aBAD ("script " . [/system script get $s name] . " - make sure it is yours")}}
:if ([:len [/user ssh-keys find]] = 0) do={$aOK "no SSH keys"} else={$aBAD ([:len [/user ssh-keys find]] . " SSH key(s) installed - make sure they are yours")}
}

{
:global aOK; :global aBAD; :global aINF
:put ""; :put "===== 8. IPv6"
:do {
  :local g 0
  :foreach a in=[/ipv6 address find] do={:if ([:pick [:tostr [/ipv6 address get $a address]] 0 4] != "fe80") do={:set g ($g + 1)}}
  :local f [:len [/ipv6 firewall filter find where chain=input and action=drop and disabled=no]]
  :if (($g > 0) && ($f = 0)) do={$aBAD ("IPv6 has " . $g . " global address(es) but no input drop rule - router open over IPv6!")} else={$aOK ("IPv6 global addresses: " . $g . ", input drop rules: " . $f)}
} on-error={$aOK "IPv6 not in use"}
}

{
:global aOK; :global aBAD; :global aINF
:put ""; :put "===== 9. LOGS AND LOAD"
:local lf [:len [/log find where message~"login failure"]]
:if ($lf > 20) do={$aBAD ($lf . " login failures in the log - someone is guessing passwords")} else={$aOK ($lf . " login failures in the log")}
:local lp [:len [/log find where message~"loop"]]
:if ($lp > 0) do={$aBAD ($lp . " loop messages in the log - cable or bridge loop")} else={$aOK "no loop messages"}
:do {
  :local ce [/ip firewall connection tracking get total-entries]
  :if ($ce > 50000) do={$aBAD ($ce . " tracked connections - virus, torrent or attack")} else={$aOK ($ce . " tracked connections")}
} on-error={}
}

:global aOK; :global aBAD; :global aINF
/system script environment remove [find where name="aOK" or name="aBAD" or name="aINF"]
:put ""; :put "===== END"
