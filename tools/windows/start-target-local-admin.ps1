param(
    [string]$DataRoot = "D:\TFJV",
    [int]$Port = 3210
)

$ErrorActionPreference = "Stop"

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if ($null -eq $node) {
    throw "node.exe was not found on PATH. Install Node.js 22 or later."
}

$admin = Join-Path $PSScriptRoot "target-local-admin.mjs"
if (-not (Test-Path -LiteralPath $admin -PathType Leaf)) {
    throw "TARGET local admin was not found: $admin"
}

Write-Host "TARGET local admin: http://127.0.0.1:$Port/"
Write-Host "Stop: Ctrl+C"
& $node.Source $admin --data-root $DataRoot --port $Port
exit $LASTEXITCODE
