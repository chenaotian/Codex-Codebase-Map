@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-github-pages.ps1" %*
