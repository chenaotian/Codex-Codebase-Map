param(
  [string] $Remote = "origin",
  [string] $RemoteUrl = "",
  [string] $Branch = "",
  [string] $Message = "Publish blog snapshot",
  [switch] $NoPush
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$blogRoot = Resolve-Path (Join-Path $scriptDir "..")

function Get-RequiredCommand($Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Required command '$Name' was not found in PATH."
  }

  return $command.Source
}

Push-Location $blogRoot
try {
  $git = Get-RequiredCommand "git"
  $safeDirectory = $blogRoot.ProviderPath -replace "\\", "/"

  function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $Arguments)

    & $git -c "safe.directory=$safeDirectory" @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "git command failed: git $($Arguments -join ' ')"
    }
  }

  & (Join-Path $scriptDir "prepare-github-pages.ps1")

  if (-not $Branch) {
    $Branch = (Invoke-Git branch --show-current).Trim()
  }

  if (-not $Branch) {
    throw "Could not determine the current Git branch. Pass -Branch explicitly."
  }

  if ($RemoteUrl) {
    $existingRemotes = Invoke-Git remote
    if ($existingRemotes -contains $Remote) {
      Invoke-Git remote set-url $Remote $RemoteUrl
    } else {
      Invoke-Git remote add $Remote $RemoteUrl
    }
  }

  $remoteNames = Invoke-Git remote
  if ((-not $NoPush) -and (-not ($remoteNames -contains $Remote))) {
    throw "Git remote '$Remote' does not exist. Pass -RemoteUrl https://github.com/<user>/<repo>.git once, or add it manually."
  }

  $publishPaths = @(
    ".nojekyll",
    ".gitignore",
    "README.md",
    "index.html",
    "styles.css",
    "start-blog.ps1",
    "assets",
    "content",
    "data",
    "pages",
    "scripts"
  )

  $gitAddArgs = @("add", "--") + $publishPaths
  Invoke-Git @gitAddArgs

  $changes = Invoke-Git status --short
  if ($changes) {
    Invoke-Git commit -m $Message
  } else {
    Write-Host "No local changes to commit."
  }

  if (-not $NoPush) {
    Invoke-Git push -u $Remote $Branch
  } else {
    Write-Host "Skipped git push because -NoPush was set."
  }
} finally {
  Pop-Location
}
