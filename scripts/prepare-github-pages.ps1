param(
  [switch] $SkipSync
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

  Invoke-Git rev-parse --is-inside-work-tree | Out-Null

  if (-not $SkipSync) {
    & (Join-Path $scriptDir "sync-docs.ps1")
  }

  if (-not (Test-Path ".nojekyll")) {
    New-Item -ItemType File -Path ".nojekyll" | Out-Null
  }

  $requiredPaths = @(
    "index.html",
    "styles.css",
    "pages",
    "scripts",
    "data",
    "content/final_docs",
    "content/diagrams"
  )

  foreach ($path in $requiredPaths) {
    if (-not (Test-Path $path)) {
      throw "Missing required GitHub Pages asset: $path"
    }
  }

  $node = Get-Command "node" -ErrorAction SilentlyContinue
  $codexNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  $nodePath = ""

  if ($node) {
    $nodePath = $node.Source
  } elseif (Test-Path $codexNode) {
    $nodePath = $codexNode
  }

  if ($nodePath) {
    $jsFiles = @(
      "data/docs-content.js",
      "data/map-data.js",
      "data/run-turn-diagram.js",
      "data/run-sampling-request-diagram.js",
      "scripts/app.js",
      "scripts/topic-page.js",
      "scripts/run-turn-page.js",
      "scripts/flow-page-loader.js",
      "scripts/code-highlight.js"
    )

    foreach ($file in $jsFiles) {
      if (Test-Path $file) {
        & $nodePath --check $file
      }
    }
  } else {
    Write-Warning "Node.js was not found in PATH; skipped JavaScript syntax checks."
  }

  Write-Host ""
  Write-Host "GitHub Pages snapshot is ready."
  Write-Host "Static files are in: $blogRoot"
  Write-Host ""
  Invoke-Git status --short
} finally {
  Pop-Location
}
