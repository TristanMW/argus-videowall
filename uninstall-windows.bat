@echo off
REM Double-click uninstaller: stops Argus and removes everything it installed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-windows.ps1"
