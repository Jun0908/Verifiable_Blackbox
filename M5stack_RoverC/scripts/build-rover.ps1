param([switch]$Signature)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot)
# Keep compiler intermediate paths below Windows MAX_PATH.
$env:PLATFORMIO_BUILD_DIR = Join-Path $env:TEMP 'vbb-rover-submit-build'
$target = if ($Signature) { 'm5stick-c-plus2-signature' } else { 'm5stick-c-plus2' }
& ./rover-python/.venv/Scripts/pio.exe run -d m5stick-rover -e $target
if ($LASTEXITCODE) { throw 'Rover build failed' }
