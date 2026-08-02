$ErrorActionPreference = "Stop"

# JV-Link is normally registered as a 32-bit COM component.
# Relaunch this script with 32-bit Windows PowerShell when necessary.
if ([IntPtr]::Size -eq 8) {
    $powerShell32 = Join-Path $env:WINDIR "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
    if (-not (Test-Path $powerShell32)) {
        throw "32-bit Windows PowerShell was not found."
    }

    & $powerShell32 -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath
    exit $LASTEXITCODE
}

$fromTime = "20160101000000"
$dataSpec = "DIFN"
$dataOption = 1
$bufferSize = 110000
$encoding = [System.Text.Encoding]::GetEncoding(932)
$results = @{}
$jvLink = $null

function Get-TextFromBytes {
    param(
        [byte[]]$Bytes,
        [int]$Offset,
        [int]$Length
    )

    return $encoding.GetString($Bytes, $Offset, $Length).Trim()
}

try {
    Write-Host "JV-Link all-horse prize exporter"
    Write-Host "Process: 32-bit Windows PowerShell"

    $jvLink = New-Object -ComObject "JVDTLab.JVLink"

    $returnCode = $jvLink.JVInit("UNKNOWN")
    if ($returnCode -ne 0) {
        throw "JVInit failed. Return code: $returnCode"
    }
    Write-Host "JVInit: OK"

    $readCount = 0
    $downloadCount = 0
    $lastFileTimestamp = ""
    $returnCode = $jvLink.JVOpen(
        $dataSpec,
        $fromTime,
        $dataOption,
        [ref]$readCount,
        [ref]$downloadCount,
        [ref]$lastFileTimestamp
    )
    if ($returnCode -ne 0) {
        throw "JVOpen failed. Return code: $returnCode"
    }

    Write-Host "JVOpen: OK"
    Write-Host "Read files: $readCount"
    Write-Host "Download files: $downloadCount"

    if ($downloadCount -gt 0) {
        Write-Host "Waiting for download..."
        do {
            Start-Sleep -Milliseconds 500
            $downloaded = $jvLink.JVStatus()
            if ($downloaded -lt 0) {
                throw "JVStatus failed. Return code: $downloaded"
            }
            Write-Progress `
                -Activity "Downloading JV-Data" `
                -Status "$downloaded / $downloadCount files" `
                -PercentComplete ([Math]::Min(100, (100 * $downloaded / $downloadCount)))
        } while ($downloaded -lt $downloadCount)
        Write-Progress -Activity "Downloading JV-Data" -Completed
    }

    Write-Host "Reading UM records..."
    $recordCount = 0
    $umCount = 0

    while ($true) {
        $buffer = ""
        $fileName = ""
        $bytesRead = $jvLink.JVRead([ref]$buffer, $bufferSize, [ref]$fileName)

        if ($bytesRead -eq 0) {
            break
        }
        if ($bytesRead -eq -1) {
            # Normal physical-file boundary. Continue with the next file.
            continue
        }
        if ($bytesRead -eq -3) {
            Start-Sleep -Milliseconds 500
            continue
        }
        if ($bytesRead -lt 0) {
            throw "JVRead failed. Return code: $bytesRead"
        }

        $recordCount++
        $recordBytes = $encoding.GetBytes($buffer)
        if ($recordBytes.Length -lt 1097) {
            continue
        }

        $recordType = Get-TextFromBytes $recordBytes 0 2
        if ($recordType -ne "UM") {
            continue
        }
        $umCount++

        # JV_UM_UMA (byte positions are 1-based in the SDK specification):
        # KettoNum              byte 12, length 10
        # Bamei                 byte 47, length 36
        # RuikeiSyutokuHeichi   byte 1089, length 9, unit 100 yen
        $kettoNum = Get-TextFromBytes $recordBytes 11 10
        $horseName = Get-TextFromBytes $recordBytes 46 36
        $prizeText = Get-TextFromBytes $recordBytes 1088 9
        $prizeYen = 0L
        if (-not [long]::TryParse($prizeText, [ref]$prizeYen)) {
            throw "Invalid prize value for ${kettoNum}: '$prizeText'"
        }
        $prizeYen *= 100L

        # Later UM records overwrite earlier records, leaving the newest value.
        $results[$kettoNum] = [PSCustomObject]@{
            KettoNum = $kettoNum
            HorseName = $horseName
            PrizeYen = $prizeYen
            PrizeDisplay = ("{0:N0} yen" -f $prizeYen)
            SourceFile = $fileName
        }

        if (($umCount % 10000) -eq 0) {
            Write-Host (
                "Progress: {0:N0} records, {1:N0} latest horses" -f
                $recordCount,
                $results.Count
            )
        }
    }

    Write-Host ""
    Write-Host "RESULT"
    Write-Host "Records read: $recordCount (UM: $umCount)"
    Write-Host ("Latest horses: {0:N0}" -f $results.Count)

    $csvPath = Join-Path $PSScriptRoot "all-horse-prize-money.csv"
    $results.Values |
        Sort-Object KettoNum |
        Select-Object KettoNum, HorseName, PrizeYen, SourceFile |
        Export-Csv -Path $csvPath -NoTypeInformation -Encoding UTF8
    Write-Host "CSV: $csvPath"
}
catch {
    Write-Host ""
    Write-Host "RESULT: FAILED"
    Write-Host $_.Exception.Message
    exit 1
}
finally {
    if ($null -ne $jvLink) {
        try {
            [void]$jvLink.JVClose()
        }
        catch {
        }
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($jvLink)
    }
}
