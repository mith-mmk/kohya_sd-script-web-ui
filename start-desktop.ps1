param(
  [int]$Port = 0,
  [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host '[INFO] Kohya Web UI desktop launcher'

if ($Port -gt 0) {
  $env:PORT = [string]$Port
  Write-Host "[INFO] Using PORT=$env:PORT"
}

if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
  Write-Host '[INFO] node_modules is missing. Running installer.'
  & (Join-Path $Root 'install.bat')
  if ($LASTEXITCODE -ne 0) { throw "Installer failed with exit code $LASTEXITCODE" }
}

function Get-NewestWriteTime {
  param([string[]]$Paths)

  $latest = [DateTime]::MinValue
  foreach ($target in $Paths) {
    if (-not (Test-Path $target)) { continue }
    $items = Get-ChildItem -LiteralPath $target -Recurse -File -ErrorAction SilentlyContinue
    foreach ($item in $items) {
      if ($item.LastWriteTime -gt $latest) { $latest = $item.LastWriteTime }
    }
  }
  return $latest
}

function Test-BuildRequired {
  $distFiles = @(
    Join-Path $Root 'apps/server/dist/index.js'
    Join-Path $Root 'apps/web/dist/index.html'
    Join-Path $Root 'apps/desktop/dist/main.js'
  )

  foreach ($file in $distFiles) {
    if (-not (Test-Path $file)) { return $true }
  }

  $newestSource = Get-NewestWriteTime @(
    (Join-Path $Root 'apps/server/src')
    (Join-Path $Root 'apps/web/src')
    (Join-Path $Root 'apps/web/index.html')
    (Join-Path $Root 'apps/web/vite.config.ts')
    (Join-Path $Root 'apps/desktop/src')
    (Join-Path $Root 'python/bridge')
    (Join-Path $Root 'package.json')
    (Join-Path $Root 'apps/server/package.json')
    (Join-Path $Root 'apps/web/package.json')
    (Join-Path $Root 'apps/desktop/package.json')
  )

  $oldestDist = [DateTime]::MaxValue
  foreach ($file in $distFiles) {
    $time = (Get-Item $file).LastWriteTime
    if ($time -lt $oldestDist) { $oldestDist = $time }
  }

  return $newestSource -gt $oldestDist
}

if ($Rebuild -or (Test-BuildRequired)) {
  Write-Host '[INFO] Build output is missing or stale. Running build.'
  npm run build:all
  if ($LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE" }
} else {
  Write-Host '[INFO] Using existing build output for fast startup.'
}

npm run start -w apps/desktop
if ($LASTEXITCODE -ne 0) { throw "Desktop startup failed with exit code $LASTEXITCODE" }
