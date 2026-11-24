@echo off
rem Double-click to send the ERP e-mails for real, from a Google account (scripts\set_email.ps1 says how).
rem From a terminal: set_email.cmd -Off (the codes in the API window again), set_email.cmd -On
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0set_email.ps1" %*
pause
