param(
    [string]$DataRoot = "D:\TFJV",
    [string]$RaceId,
    [switch]$List,
    [switch]$Save
)

$ErrorActionPreference = "Stop"

# TARGET Frontier JV の保存済みファイルだけを読むNodeスクリプトを起動する。
# この互換ファイル自身は、外部通信やデータダウンロードを実行しない。
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if ($null -eq $node) {
    throw "node.exe がPATHに見つかりません。Node.js 22以上をインストールしてから実行してください。"
}

$reader = Join-Path $PSScriptRoot "..\..\scripts\target-local-ranking.mjs"
if (-not (Test-Path -LiteralPath $reader -PathType Leaf)) {
    throw "TARGETローカル読取スクリプトが見つかりません: $reader"
}

$arguments = @($reader, "--data-root", $DataRoot)
if ($List) {
    $arguments += "--list"
}
elseif ([string]::IsNullOrWhiteSpace($RaceId)) {
    throw "-List または -RaceId を指定してください。"
}
else {
    $arguments += @("--race-id", $RaceId)
    if ($Save) {
        $arguments += "--save"
    }
}

Write-Host "TARGET local ranking reader"
Write-Host "Data root: $DataRoot"
& $node.Source @arguments
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
