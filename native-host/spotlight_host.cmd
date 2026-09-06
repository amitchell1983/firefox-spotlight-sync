@echo off
rem Firefox native-messaging launcher for the PowerShell host.
rem Firefox appends the manifest path (and extension id) as arguments; the
rem host script ignores them, so they are intentionally not forwarded.
setlocal
rem -InputFormat None is REQUIRED: without it powershell.exe consumes/transcodes
rem stdin (adds a UTF-8 BOM) and the native-messaging framing breaks.
powershell.exe -NoProfile -NonInteractive -InputFormat None -ExecutionPolicy Bypass -File "%~dp0spotlight_host.ps1"
