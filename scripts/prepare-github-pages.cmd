@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0prepare-github-pages.ps1" %*
