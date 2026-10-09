@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\evolution.ps1" -Action Save
pause
