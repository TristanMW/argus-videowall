@echo off
REM Double-click installer: sets Argus up to start at every boot (no Docker).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1"
