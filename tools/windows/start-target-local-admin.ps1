param(
    [string]$DataRoot = "D:\TFJV",
    [int]$Port = 3210
)

$ErrorActionPreference = "Stop"

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if ($null -eq $node) {
    throw "node.exe がPATHに見つかりません。Node.js 22以上をインストールしてから実行してください。"
}

$admin = Join-Path $PSScriptRoot "target-local-admin.mjs"
if (-not (Test-Path -LiteralPath $admin -PathType Leaf)) {
    throw "TARGETローカル管理画面が見つかりません: $admin"
}

Write-Host "TARGETローカル管理画面: http://127.0.0.1:$Port/"
Write-Host "停止: Ctrl+C"
& $node.Source $admin --data-root $DataRoot --port $Port
exit $LASTEXITCODE
