param(
  [int] $Port = 8765
)

$ErrorActionPreference = "Stop"
$blogRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $blogRoot
try {
  & ".\scripts\sync-docs.ps1"
  Write-Host ""
  Write-Host "Blog is available at http://127.0.0.1:$Port/"
  Write-Host "Press Ctrl+C to stop."
  python ".\scripts\dev_server.py" --port $Port --bind 127.0.0.1 --directory $blogRoot
} finally {
  Pop-Location
}
