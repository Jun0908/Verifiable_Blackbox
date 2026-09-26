$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (!(Test-Path 'rover-python/.venv/Scripts/python.exe')) {
    python -m venv rover-python/.venv
    if ($LASTEXITCODE) { throw 'Python 3.11+ is required' }
}
& ./rover-python/.venv/Scripts/python.exe -m pip install -r rover-python/requirements-dev.txt
if ($LASTEXITCODE) { throw 'Dependency installation failed' }
Write-Host 'Setup complete. No device was contacted or flashed.'
