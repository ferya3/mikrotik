# MikroTik read-only report of free and used IP addresses. Paste everything into the terminal of the MAIN router.
# Changes nothing. Edit the first line if the LAN is not 192.168.4.x
#
# PUBLIC: every public address on the router, whether a port forward uses it, and addresses of your
#         blocks that are not configured on the router at all.
# LAN:    every used address (ARP + DHCP leases + router + port-forward targets), the free ranges
#         outside and inside the DHCP pool, and static devices sitting inside the pool.
# A device that is switched off and has no DHCP reservation does not show up anywhere: a free address
# is "not seen", not "guaranteed free". Run it during working hours.
{
:local sub "192.168.4."
:local ok do={:put ("  OK  " . $1)}
:local bad do={:put ("  !!  " . $1)}
:local inf do={:put ("  --  " . $1)}
:local ip2n do={
  :local s [:tostr $1]
  :local p1 [:find $s "."]
  :local p2 [:find $s "." ($p1 + 1)]
  :local p3 [:find $s "." ($p2 + 1)]
  :return (([:tonum [:pick $s 0 $p1]] * 16777216) + ([:tonum [:pick $s ($p1 + 1) $p2]] * 65536) + ([:tonum [:pick $s ($p2 + 1) $p3]] * 256) + [:tonum [:pick $s ($p3 + 1) [:len $s]]])
}
:local n2ip do={:return ((($1 / 16777216) % 256) . "." . (($1 / 65536) % 256) . "." . (($1 / 256) % 256) . "." . ($1 % 256))}
:local used [:toarray ""]
:local utype [:toarray ""]
:local umac [:toarray ""]
:local inpool [:toarray ""]
:local lanif ""

:do {
  :foreach a in=[/ip arp find] do={
    :local ad [:tostr [/ip arp get $a address]]
    :local mc ""
    :do {:set mc [:tostr [/ip arp get $a mac-address]]} on-error={}
    :if (([:pick $ad 0 [:len $sub]] = $sub) && ([:len $mc] > 0) && ($mc != "00:00:00:00:00:00")) do={
      :set ($used->$ad) ($mc . " seen in ARP")
      :set ($utype->$ad) "arp"
      :set ($umac->$ad) $mc
    }
  }
} on-error={$bad "could not read the ARP table"}

:do {
  :foreach l in=[/ip dhcp-server lease find] do={
    :local ad ""
    :do {:set ad [:tostr [/ip dhcp-server lease get $l address]]} on-error={}
    :if (([:len $ad] > 0) && ([:pick $ad 0 [:len $sub]] = $sub)) do={
      :local st ""
      :do {:set st [:tostr [/ip dhcp-server lease get $l status]]} on-error={}
      :local dyn true
      :do {:set dyn [/ip dhcp-server lease get $l dynamic]} on-error={}
      :local hn ""
      :do {:set hn [:tostr [/ip dhcp-server lease get $l host-name]]} on-error={}
      :local cm ""
      :do {:set cm [:tostr [/ip dhcp-server lease get $l comment]]} on-error={}
      :local mc ""
      :do {:set mc [:tostr [/ip dhcp-server lease get $l mac-address]]} on-error={}
      :local nm $hn
      :if ([:len $cm] > 0) do={:set nm $cm}
      :if ([:len $nm] = 0) do={:set nm $mc}
      :if ($st = "bound") do={
        :set ($used->$ad) ($nm . " (" . $mc . ")")
        :if ($dyn) do={:set ($utype->$ad) "lease"} else={:set ($utype->$ad) "reserved"}
      } else={
        :if ($dyn = false) do={
          :if ([:typeof ($used->$ad)] != "str") do={
            :set ($used->$ad) ($nm . " (" . $mc . ") reserved, device is off")
            :set ($utype->$ad) "reserved"
          }
        }
      }
    }
  }
} on-error={$bad "could not read the DHCP leases"}

:do {
  :foreach a in=[/ip address find] do={
    :if ([/ip address get $a disabled] = false) do={
      :local full [:tostr [/ip address get $a address]]
      :local sl [:find $full "/"]
      :local ip [:pick $full 0 $sl]
      :if ([:pick $ip 0 [:len $sub]] = $sub) do={
        :set ($used->$ip) ("this router (" . [/ip address get $a interface] . ")")
        :set ($utype->$ip) "router"
        :set lanif [:tostr [/ip address get $a interface]]
      }
    }
  }
} on-error={}

:do {
  :foreach r in=[/ip firewall nat find] do={
    :do {
      :if (([/ip firewall nat get $r action] = "dst-nat") && ([/ip firewall nat get $r disabled] = false)) do={
        :local tgt [:tostr [/ip firewall nat get $r to-addresses]]
        :if (([:len $tgt] > 0) && ([:pick $tgt 0 [:len $sub]] = $sub)) do={
          :local note ("[forward " . [/ip firewall nat get $r comment] . "]")
          :if ([:typeof ($used->$tgt)] = "str") do={:set ($used->$tgt) (($used->$tgt) . " " . $note)} else={
            :set ($used->$tgt) ("port-forward target " . $note)
            :set ($utype->$tgt) "nat"
          }
        }
      }
    } on-error={}
  }
} on-error={}

:do {
  :foreach s in=[/ip dhcp-server find] do={
    :if ([/ip dhcp-server get $s disabled] = false) do={
      :local pn [/ip dhcp-server get $s address-pool]
      :foreach p in=[/ip pool find] do={
        :if ([/ip pool get $p name] = $pn) do={
          :local rg [:tostr [/ip pool get $p ranges]]
          :while ([:len $rg] > 0) do={
            :local c [:find $rg ","]
            :local part $rg
            :if ([:typeof $c] = "num") do={
              :set part [:pick $rg 0 $c]
              :set rg [:pick $rg ($c + 1) [:len $rg]]
            } else={:set rg ""}
            :local d [:find $part "-"]
            :if ([:typeof $d] = "num") do={
              :local lo [$ip2n [:pick $part 0 $d]]
              :local hi [$ip2n [:pick $part ($d + 1) [:len $part]]]
              :if (($hi >= $lo) && (($hi - $lo) < 1024)) do={
                :for q from=$lo to=$hi do={
                  :local qk [$n2ip $q]
                  :set ($inpool->$qk) "1"
                }
              }
            }
          }
        }
      }
    }
  }
} on-error={$bad "could not read the DHCP pools"}

:put ""; :put ("===== 1. LAN (" . $sub . "x): USED ADDRESSES")
:put "  [zone: static = outside the DHCP pool, pool = inside it]"
:do {
  :local total 0
  :for i from=1 to=254 do={
    :local k ($sub . $i)
    :if ([:typeof ($used->$k)] = "str") do={
      :set total ($total + 1)
      :local zone "static"
      :if ([:typeof ($inpool->$k)] = "str") do={:set zone "pool  "}
      :local pad ""
      :for z from=[:len $k] to=15 do={:set pad ($pad . " ")}
      :put ("  " . $k . $pad . $zone . "  " . ($utype->$k) . "  " . ($used->$k))
    }
  }
  $inf ($total . " used address(es) of 254")
} on-error={$bad "could not print the used addresses"}

:put ""; :put "===== 2. LAN: FREE ADDRESSES"
:do {
  :foreach zone in={"static";"pool"} do={
    :local out ""
    :local cnt 0
    :local start 0
    :local run false
    :for i from=2 to=255 do={
      :local free false
      :if ($i < 255) do={
        :local k ($sub . $i)
        :local pt [:typeof ($inpool->$k)]
        :if ([:typeof ($used->$k)] != "str") do={
          :if (($zone = "pool") && ($pt = "str")) do={:set free true}
          :if (($zone = "static") && ($pt != "str")) do={:set free true}
        }
      }
      :if ($free) do={
        :set cnt ($cnt + 1)
        :if ($run = false) do={:set run true; :set start $i}
      } else={
        :if ($run) do={
          :local e ($i - 1)
          :local piece ("." . $start)
          :if ($e > $start) do={:set piece ("." . $start . "-." . $e)}
          :if ([:len $out] > 0) do={:set out ($out . ", ")}
          :set out ($out . $piece)
          :set run false
        }
      }
    }
    :if ($zone = "static") do={:put ("  STATIC ZONE, outside the DHCP pool, safe for fixed addresses (" . $cnt . " free):")} else={:put ("  INSIDE the DHCP pool, handed out automatically (" . $cnt . " free):")}
    :if ([:len $out] = 0) do={:put "       none"} else={:put ("       " . $sub . "x  ->  " . $out)}
  }
} on-error={$bad "could not compute the free ranges"}

:put ""; :put "===== 3. LAN: STATIC DEVICES INSIDE THE DHCP POOL"
:do {
  :local conf 0
  :for i from=2 to=254 do={
    :local k ($sub . $i)
    :if (([:typeof ($inpool->$k)] = "str") && (($utype->$k) = "arp")) do={
      :set conf ($conf + 1)
      $bad ($k . " is used by a device that has no DHCP lease (" . ($umac->$k) . "): DHCP may give this address to another device. Fix: /ip dhcp-server lease add address=" . $k . " mac-address=" . ($umac->$k))
    }
  }
  :if ($conf = 0) do={$ok "no static device inside the pool"}
} on-error={$bad "could not check the pool"}

:put ""; :put "===== 4. PUBLIC ADDRESSES"
:do {
  :local natby [:toarray ""]
  :local naton [:toarray ""]
  :foreach r in=[/ip firewall nat find] do={
    :do {
      :if ([/ip firewall nat get $r action] = "dst-nat") do={
        :local da [:tostr [/ip firewall nat get $r dst-address]]
        :if ([:len $da] = 0) do={:set da "*"}
        :local tag ""
        :if ([/ip firewall nat get $r disabled]) do={:set tag "(disabled rule) "} else={:set ($naton->$da) "1"}
        :local txt ($tag . [:tostr [/ip firewall nat get $r protocol]] . "/" . [:tostr [/ip firewall nat get $r dst-port]] . " -> " . [:tostr [/ip firewall nat get $r to-addresses]] . ":" . [:tostr [/ip firewall nat get $r to-ports]] . "  " . [/ip firewall nat get $r comment])
        :local prev ""
        :if ([:typeof ($natby->$da)] = "str") do={:set prev (($natby->$da) . " ; ")}
        :set ($natby->$da) ($prev . $txt)
      }
    } on-error={}
  }
  :local gwip ""
  :foreach r in=[/ip route find] do={
    :if (([:tostr [/ip route get $r dst-address]] = "0.0.0.0/0") && ([/ip route get $r disabled] = false) && ([:len $gwip] = 0)) do={:set gwip [:tostr [/ip route get $r gateway]]}
  }
  :local cfg [:toarray ""]
  :local bsz [:toarray ""]
  :local blist [:toarray ""]
  :foreach a in=[/ip address find] do={
    :if ([/ip address get $a disabled] = false) do={
      :local full [:tostr [/ip address get $a address]]
      :local sl [:find $full "/"]
      :local ip [:pick $full 0 $sl]
      :local pl [:tonum [:pick $full ($sl + 1) [:len $full]]]
      :local n [$ip2n $ip]
      :local priv false
      :if (($n >= 167772160) && ($n <= 184549375)) do={:set priv true}
      :if (($n >= 2886729728) && ($n <= 2887778303)) do={:set priv true}
      :if (($n >= 3232235520) && ($n <= 3232301055)) do={:set priv true}
      :if ($priv = false) do={
        :set ($cfg->$ip) [:tostr [/ip address get $a interface]]
        :if (($pl >= 8) && ($pl <= 30)) do={
          :local bs 1
          :for q from=1 to=(32 - $pl) do={:set bs ($bs * 2)}
          :local net (($n / $bs) * $bs)
          :local nk [:tostr $net]
          :if ([:typeof ($bsz->$nk)] != "str") do={
            :set ($bsz->$nk) [:tostr $bs]
            :set blist ($blist, $net)
          }
        }
      }
    }
  }
  :if ([:typeof ($natby->"*")] = "str") do={$inf ("port forward rule(s) with no destination address apply to EVERY public address: " . ($natby->"*"))}
  :local freepub ""
  :foreach net in=$blist do={
    :local nk [:tostr $net]
    :local bs [:tonum ($bsz->$nk)]
    :local last ($net + $bs - 1)
    :put ""
    :put ("  block " . [$n2ip $net] . " - " . [$n2ip $last] . " (" . $bs . " addresses)")
    :local notcfg ""
    :local run false
    :local rs 0
    :for h from=$net to=($last + 1) do={
      :local k [$n2ip $h]
      :local isCfg ([:typeof ($cfg->$k)] = "str")
      :local skip (($h = $net) || ($h = $last) || ($k = $gwip) || ($h > $last))
      :if ($h <= $last) do={
        :if ($isCfg) do={
          :local pad ""
          :for z from=[:len $k] to=15 do={:set pad ($pad . " ")}
          :local wif ($cfg->$k)
          :local ipad ""
          :if ([:len $wif] < 15) do={:for z from=[:len $wif] to=14 do={:set ipad ($ipad . " ")}}
          :local st ""
          :if ($h = $net) do={:set st "!! NETWORK address of this block: normally not usable as a host address, check with your ISP"} else={
            :if ($h = $last) do={:set st "!! BROADCAST address of this block: normally not usable as a host address, check with your ISP"} else={
              :if ([:typeof ($naton->$k)] = "str") do={:set st ("FORWARDED  " . ($natby->$k))} else={
                :set st "FREE (no active port forward)"
                :if ([:typeof ($natby->$k)] = "str") do={:set st ("FREE (no active port forward)  " . ($natby->$k))}
                :if ($wif = $lanif) do={:set st ($st . "  [on the LAN bridge]")}
                :set freepub ($freepub . $k . "  ")
              }
            }
          }
          :put ("    " . $k . $pad . $wif . $ipad . $st)
        }
      }
      :if (($isCfg = false) && ($skip = false)) do={
        :if ($run = false) do={:set run true; :set rs $h}
      } else={
        :if ($run) do={
          :local e ($h - 1)
          :local piece [$n2ip $rs]
          :if ($e > $rs) do={:set piece ([$n2ip $rs] . " - " . [$n2ip $e])}
          :if ([:len $notcfg] > 0) do={:set notcfg ($notcfg . ", ")}
          :set notcfg ($notcfg . $piece)
          :set run false
        }
      }
    }
    :if ([:len $notcfg] > 0) do={:put ("    in this block but NOT on the router: " . $notcfg)}
  }
  :put ""
  :if ([:len $freepub] > 0) do={$inf ("free public addresses on the router (no active port forward): " . $freepub)}
  :if ([:len $gwip] > 0) do={$inf ("default gateway (your ISP): " . $gwip)}
  :put "  Addresses 'NOT on the router' can only be used after you add them (/ip address add ...) and only if your ISP gave them to you."
} on-error={$bad "public address report failed"}
:put ""; :put "===== END"
}
