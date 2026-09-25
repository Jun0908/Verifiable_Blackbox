$ErrorActionPreference = "Stop"
$workspace = Split-Path $PSScriptRoot -Parent
$dependencies = @(
    @{ Name = "openzeppelin-contracts"; Repo = "https://github.com/OpenZeppelin/openzeppelin-contracts.git"; Revision = "c64a1edb67b6e3f4a15cca8909c9482ad33a02b0" },
    @{ Name = "openzeppelin-contracts-upgradeable"; Repo = "https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable.git"; Revision = "e725abddf1e01cf05ace496e950fc8e243cc7cab" },
    @{ Name = "forge-std"; Repo = "https://github.com/foundry-rs/forge-std.git"; Revision = "7117c90c8cf6c68e5acce4f09a6b24715cea4de6" }
)
New-Item -ItemType Directory -Force (Join-Path $workspace "lib") | Out-Null
foreach ($dependency in $dependencies) {
    $target = Join-Path $workspace ("lib/" + $dependency.Name)
    if (-not (Test-Path -LiteralPath $target)) {
        & git clone --filter=blob:none --no-checkout $dependency.Repo $target
        if ($LASTEXITCODE -ne 0) { throw "Clone failed: $($dependency.Name)" }
        & git -C $target checkout --detach $dependency.Revision
        if ($LASTEXITCODE -ne 0) { throw "Checkout failed: $($dependency.Name)" }
    }
    $revision = & git -C $target rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $revision -ne $dependency.Revision) { throw "Unexpected dependency revision: $target" }
}
Write-Host "Pinned Solidity dependencies ready."
