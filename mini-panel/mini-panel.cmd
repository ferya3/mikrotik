@echo off
rem MikroTik mini panel - double-click to start. Extra arguments are passed on (e.g. -Reset, -Port 8095).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mini-panel.ps1" %*
if errorlevel 1 pause
