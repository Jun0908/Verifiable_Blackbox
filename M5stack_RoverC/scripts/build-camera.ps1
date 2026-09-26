param([string]$ArduinoCli = 'arduino-cli', [switch]$Detect)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot)
if (!(Get-Command $ArduinoCli -ErrorAction SilentlyContinue)) {
    $bundled = Join-Path $env:LOCALAPPDATA 'Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe'
    if (Test-Path $bundled) { $ArduinoCli = $bundled } else { throw 'Install Arduino CLI 1.5.1 or pass -ArduinoCli' }
}
$sketch = if ($Detect) { 'DetectCamera' } else { 'RoverCamera' }
& $ArduinoCli compile --fqbn esp32:esp32:m5stack_unit_cams3:PSRAM=opi --build-path "camera-firmware/build-$sketch" "camera-firmware/$sketch"
if ($LASTEXITCODE) { throw 'Camera build failed' }
