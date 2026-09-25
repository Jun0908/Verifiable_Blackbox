$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    node scripts/e2e-local.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local E2E failed' }
    node scripts/e2e-approval.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Approval E2E failed' }
} finally { Pop-Location }
