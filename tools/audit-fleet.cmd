@echo off
rem Audit several MikroTik routers. Examples:
rem   audit-fleet.cmd -Discover
rem   audit-fleet.cmd -Hosts 192.168.4.2,192.168.4.3
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0audit-fleet.ps1" %*
pause
