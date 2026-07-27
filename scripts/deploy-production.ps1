[CmdletBinding()]
param(
  [string]$ProductionUrl = "https://budget-tracker-beta-bice.vercel.app"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$projectConfig = Join-Path $projectRoot ".vercel\project.json"

if (-not (Test-Path -LiteralPath $projectConfig)) {
  throw "Missing .vercel/project.json. Refusing to deploy an unlinked project."
}

Push-Location $projectRoot
try {
  $identity = & npx --yes vercel whoami 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Vercel CLI authentication is unavailable in its standard config location. Restore the existing machine credential before deploying. Details: $identity"
  }

  & npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "Production build failed."
  }

  $deploymentOutput = & npx --yes vercel deploy --prod --yes 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Vercel deployment failed: $deploymentOutput"
  }

  $maxAttempts = 18
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    try {
      $response = Invoke-WebRequest `
        -Uri "$ProductionUrl/login" `
        -UseBasicParsing `
        -TimeoutSec 20 `
        -Headers @{ "Cache-Control" = "no-cache" }

      if ($response.StatusCode -eq 200) {
        Write-Output "Production deployment verified: $ProductionUrl"
        exit 0
      }
    } catch {
      if ($attempt -eq $maxAttempts) {
        throw
      }
    }

    Start-Sleep -Seconds 5
  }

  throw "Vercel completed, but production verification did not succeed."
} finally {
  Pop-Location
}
