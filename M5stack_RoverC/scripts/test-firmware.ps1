$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot)
$python = './rover-python/.venv/Scripts/python.exe'
New-Item -ItemType Directory -Force .tools | Out-Null
& $python -m ziglang c++ -std=c++17 -I m5stick-rover/include m5stick-rover/test/host_protocol.cpp -o .tools/host_protocol.exe
if ($LASTEXITCODE) { throw 'Firmware host compilation failed' }
& ./.tools/host_protocol.exe
if ($LASTEXITCODE) { throw 'Firmware host assertions failed' }
