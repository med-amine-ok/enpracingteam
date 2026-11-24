@echo off
rem Double-click to stop the ERP started by start_erp.cmd (scripts\stop_erp.ps1 says what it does).
rem From a terminal, options are passed on: stop_erp.cmd -Docker
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop_erp.ps1" %*
pause
