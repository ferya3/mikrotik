# Clean configuration for the replacement router (built from the RTAWD RB2011UiAS export, 2026-09-29).
#
# Use on a router that is on the latest stable RouterOS (7.24 or newer: uses available-from) and was reset with:
#   /system reset-configuration no-defaults=yes skip-backup=yes
# Connect with Winbox by MAC address, drag this file into Files, then:
#   /import new-router.rsc verbose=yes
#
# Cables keep the SAME port numbers as on the old router: WAN in ether2, everything else in the bridge.
# If the WAN cable goes into another port on the new model, change nWan below.
#
# Left out on purpose (attacker leftovers / junk in the old config): SOCKS port 5678, SSH forwarding,
# OpenVPN server, BGP/OSPF/BFD, logging reduced to 1 line, detect-internet, dead limitdownload/reset
# schedulers, duplicate pools and routes, the 94.182.50.48 network address, disabled entries.

:global nWan "ether2"

# ---------------------------------------------------------------- system
/system identity set name=RTAWD
/system clock set time-zone-name=Asia/Tehran
/system ntp client set enabled=yes
/system ntp client servers add address=pool.ntp.org
/system ntp client servers add address=time.cloudflare.com
# Default logging (the old router had it cut to 1 line to hide the attack), with room to see what happens.
/system logging action set [find name=memory] memory-lines=1000
:foreach i in=[/system logging find] do={/system logging set $i disabled=no}

# ---------------------------------------------------------------- ports, bridge, lists
{
:global nWan
/interface ethernet set [find default-name=$nWan] name=wan comment="WAN"
}
/interface bridge add name=bridge1 protocol-mode=rstp comment="LAN"
:foreach i in=[/interface ethernet find where name!="wan"] do={/interface bridge port add bridge=bridge1 interface=[/interface ethernet get $i name]}
/interface list add name=WAN
/interface list add name=LAN
/interface list member add interface=wan list=WAN
/interface list member add interface=bridge1 list=LAN

# ---------------------------------------------------------------- addresses
/ip address add address=192.168.4.1/24 interface=bridge1 comment="LAN"
# ISP link /29 (gateway 94.182.50.65)
/ip address add address=94.182.50.66/29 interface=wan
/ip address add address=94.182.50.67/29 interface=wan
/ip address add address=94.182.50.69/29 interface=wan
/ip address add address=94.182.50.70/29 interface=wan
/ip address add address=94.182.50.71/29 interface=wan
/ip address add address=172.17.67.92/29 interface=wan comment="CHECK: private range on WAN - ask ISP if still needed"
# Public /28 used for port forwards
/ip address add address=94.182.50.49/28 interface=wan
/ip address add address=94.182.50.50/28 interface=wan
/ip address add address=94.182.50.51/28 interface=wan
/ip address add address=94.182.50.52/28 interface=wan
/ip address add address=94.182.50.53/28 interface=wan comment="roter daftar negin"
/ip address add address=94.182.50.54/28 interface=wan
/ip address add address=94.182.50.55/28 interface=wan
/ip address add address=94.182.50.60/28 interface=wan
# Public addresses that were on the LAN bridge in the old config (kept so nothing breaks).
# CHECK: .62/28 overlaps the /28 above on WAN; tell me which devices use these as their IP or gateway.
/ip address add address=94.182.50.62/28 interface=bridge1 comment="CHECK: overlaps WAN /28"
/ip address add address=94.182.50.73/29 interface=bridge1 comment="HPL port forward"
/ip address add address=94.182.50.74/29 interface=bridge1
/ip address add address=94.182.50.78/29 interface=bridge1

/ip route add dst-address=0.0.0.0/0 gateway=94.182.50.65 comment="ISP"

# ---------------------------------------------------------------- DNS and DHCP
/ip dns set servers=8.8.8.8,1.1.1.1,85.15.1.14,85.15.1.15 allow-remote-requests=yes
# .255 is the broadcast address; the old pool included it.
/ip pool add name=dhcp_pool0 ranges=192.168.4.70-192.168.4.254
/ip dhcp-server add name=dhcp interface=bridge1 address-pool=dhcp_pool0 lease-time=1h
/ip dhcp-server network add address=192.168.4.0/24 gateway=192.168.4.1 dns-server=8.8.8.8,8.8.4.4,85.15.1.14,85.15.1.15
# Static leases are imported separately from the old router (leases.rsc).

# ---------------------------------------------------------------- firewall
/ip firewall filter add chain=input action=accept connection-state=established,related,untracked comment="accept established"
/ip firewall filter add chain=input action=drop connection-state=invalid comment="drop invalid"
/ip firewall filter add chain=input action=accept protocol=icmp comment="accept icmp"
/ip firewall filter add chain=input action=drop in-interface-list=!LAN comment="drop all not from LAN"
/ip firewall filter add chain=forward action=fasttrack-connection connection-state=established,related hw-offload=yes comment="fasttrack"
/ip firewall filter add chain=forward action=accept connection-state=established,related,untracked comment="accept established"
/ip firewall filter add chain=forward action=drop connection-state=invalid comment="drop invalid"
/ip firewall filter add chain=forward action=drop connection-state=new connection-nat-state=!dstnat in-interface-list=WAN comment="drop WAN not DSTNATed"

/ip firewall nat add chain=srcnat action=masquerade src-address=192.168.4.0/24 out-interface-list=WAN comment="LAN to internet"
# Port forwards (open to the whole internet, as before).
# To allow only known offices: add their IPs to list remote-ok and add src-address-list=remote-ok to each rule.
/ip firewall nat add chain=dstnat action=dst-nat in-interface-list=WAN protocol=tcp dst-address=94.182.50.50 dst-port=4370 to-addresses=192.168.4.101 to-ports=4370 comment="vorodiye kolak"
/ip firewall nat add chain=dstnat action=dst-nat in-interface-list=WAN protocol=tcp dst-address=94.182.50.66 dst-port=4370 to-addresses=192.168.4.133 to-ports=4370 comment="vorodiyenegin"
/ip firewall nat add chain=dstnat action=dst-nat in-interface-list=WAN protocol=tcp dst-address=94.182.50.67 dst-port=4370 to-addresses=192.168.4.114 to-ports=4370 comment="ROYE DAR"
/ip firewall nat add chain=dstnat action=dst-nat in-interface-list=WAN protocol=tcp dst-address=94.182.50.51 dst-port=4370 to-addresses=192.168.4.228 to-ports=4370 comment="TOSEE 1"
/ip firewall nat add chain=dstnat action=dst-nat in-interface-list=WAN protocol=tcp dst-address=94.182.50.69 dst-port=4370 to-addresses=192.168.4.187 to-ports=4370 comment="MDF"
/ip firewall nat add chain=dstnat action=dst-nat in-interface-list=WAN protocol=tcp dst-address=94.182.50.70 dst-port=4370 to-addresses=192.168.4.85 to-ports=4370 comment="KOOLAK"
/ip firewall nat add chain=dstnat action=dst-nat in-interface-list=WAN protocol=tcp dst-address=94.182.50.73 dst-port=4370 to-addresses=192.168.4.76 to-ports=4370 comment="HPL"
/ip firewall nat add chain=dstnat action=dst-nat in-interface-list=WAN protocol=tcp dst-address=94.182.50.53 dst-port=37777 to-addresses=192.168.4.21 to-ports=37777 comment="p2p DVR - disable if the app works via P2P"
/ip firewall nat add chain=dstnat action=dst-nat in-interface-list=WAN protocol=tcp dst-address=94.182.50.60 dst-port=5801 to-addresses=192.168.4.80 to-ports=5801 comment="dorbin"

# ---------------------------------------------------------------- management access (LAN only)
/ip service set telnet disabled=yes
/ip service set ftp disabled=yes
/ip service set api disabled=yes
/ip service set api-ssl disabled=yes
/ip service set www-ssl disabled=yes
/ip service set ssh disabled=yes
/ip service set winbox port=8020 available-from=192.168.4.0/24
/ip service set www available-from=192.168.4.0/24
/ip ssh set strong-crypto=yes forwarding-enabled=no
/ip socks set enabled=no
/ip proxy set enabled=no
/ip upnp set enabled=no
/ip cloud set ddns-enabled=no update-time=no
/tool bandwidth-server set enabled=no
/tool mac-server set allowed-interface-list=LAN
/tool mac-server mac-winbox set allowed-interface-list=LAN
/tool mac-server ping set enabled=no
/ip neighbor discovery-settings set discover-interface-list=LAN
/ipv6 settings set disable-ipv6=yes

# Groups for the panels. Users and passwords are created by hand after import (never stored in files).
/user group add name=nms policy=read,write,reboot,api,rest-api,ssh
/user group add name=mini policy=read,test,api,rest-api

:put "new-router.rsc imported. Next: create users, import leases.rsc, remove admin."
