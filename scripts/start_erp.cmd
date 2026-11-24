@echo off
rem Double-click to start the ERP on this PC (scripts\start_erp.ps1 says what it does).
rem From a terminal, options are passed on: start_erp.cmd -Demo
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_erp.ps1" %*
pause
