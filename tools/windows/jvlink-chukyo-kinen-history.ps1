$ErrorActionPreference = "Stop"

# Proof-of-concept exporter for the 2026 Chukyo Kinen.
# It exports only the 16 horses currently listed for the race and does not
# calculate acquisition money. The calculation is intentionally performed
# after the raw race facts have been checked.

if ([IntPtr]::Size -eq 8) {
    $powerShell32 = Join-Path $env:WINDIR "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
    if (-not (Test-Path $powerShell32)) {
        throw "32-bit Windows PowerShell was not found."
    }

    & $powerShell32 -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath
    exit $LASTEXITCODE
}

$targetRaceDate = "20260816"
$fromTime = "20240101000000" # Includes a buffer before the approximate 2-year window.
$dataSpec = "RACE"
$dataOption = 3 # Setup data is required to retrieve historical RA/SE records.
$bufferSize = 110000
$encoding = [System.Text.Encoding]::GetEncoding(932)

$targetHorses = @{
    "2022103875" = "Ai Sansan"
    "2021105564" = "Kazumi Kurashu"
    "2022104839" = "Kanera Fina"
    "2022103146" = "Kanshin"
    "2021105119" = "Keep Calm"
    "2021100139" = "Cranford"
    "2022101420" = "Satono Shining"
    "2019105239" = "Shonan Adive"
    "2020103428" = "Sweep Awards"
    "2022105778" = "Cherbiatto"
    "2020106582" = "Phantom Thief"
    "2021105454" = "Buena Onda"
    "2021104854" = "Mina de Oro"
    "2021107098" = "Lavanda"
    "2022104401" = "Lance of Chaos"
    "2022104922" = "Lila Emblem"
}

$raceRecords = @{}
$horseRaceRecords = @{}
$jvLink = $null

function Get-TextFromBytes {
    param(
        [byte[]]$Bytes,
        [int]$Offset,
        [int]$Length
    )

    if ($Bytes.Length -lt ($Offset + $Length)) {
        return ""
    }
    return $encoding.GetString($Bytes, $Offset, $Length).Trim()
}

function Get-HundredYenValue {
    param([string]$Text)

    $value = 0L
    if ([string]::IsNullOrWhiteSpace($Text)) {
        return 0L
    }
    if (-not [long]::TryParse($Text, [ref]$value)) {
        throw "Invalid hundred-yen value: '$Text'"
    }
    return $value * 100L
}

function Get-RaceId {
    param([byte[]]$Bytes)
    return Get-TextFromBytes $Bytes 11 16
}

try {
    Write-Host "JV-Link Chukyo Kinen history exporter"
    Write-Host "Target race: 2026-08-16 Chukyo Kinen"
    Write-Host "Process: 32-bit Windows PowerShell"

    $jvLink = New-Object -ComObject "JVDTLab.JVLink"
    $returnCode = $jvLink.JVInit("UNKNOWN")
    if ($returnCode -ne 0) {
        throw "JVInit failed. Return code: $returnCode"
    }

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

    $recordCount = 0
    while ($true) {
        $buffer = ""
        $fileName = ""
        $bytesRead = $jvLink.JVRead([ref]$buffer, $bufferSize, [ref]$fileName)

        if ($bytesRead -eq 0) { break }
        if ($bytesRead -eq -1) { continue }
        if ($bytesRead -eq -3) {
            Start-Sleep -Milliseconds 500
            continue
        }
        if ($bytesRead -lt 0) {
            throw "JVRead failed. Return code: $bytesRead"
        }

        $recordCount++
        $recordBytes = $encoding.GetBytes($buffer)
        $recordType = Get-TextFromBytes $recordBytes 0 2
        $dataKubun = Get-TextFromBytes $recordBytes 2 1

        if ($recordType -eq "RA" -and $recordBytes.Length -ge 769) {
            $raceId = Get-RaceId $recordBytes
            if ($dataKubun -eq "0") {
                [void]$raceRecords.Remove($raceId)
                continue
            }

            $raceRecords[$raceId] = [PSCustomObject]@{
                RaceId = $raceId
                RaceDate = (Get-TextFromBytes $recordBytes 11 4) + (Get-TextFromBytes $recordBytes 15 4)
                JyoCD = Get-TextFromBytes $recordBytes 19 2
                Kaiji = Get-TextFromBytes $recordBytes 21 2
                Nichiji = Get-TextFromBytes $recordBytes 23 2
                RaceNum = Get-TextFromBytes $recordBytes 25 2
                RaceName = Get-TextFromBytes $recordBytes 32 60
                GradeCD = Get-TextFromBytes $recordBytes 614 1
                SyubetuCD = Get-TextFromBytes $recordBytes 616 2
                KigoCD = Get-TextFromBytes $recordBytes 618 3
                JyuryoCD = Get-TextFromBytes $recordBytes 621 1
                JyokenCD1 = Get-TextFromBytes $recordBytes 622 3
                JyokenCD2 = Get-TextFromBytes $recordBytes 625 3
                JyokenCD3 = Get-TextFromBytes $recordBytes 628 3
                JyokenCD4 = Get-TextFromBytes $recordBytes 631 3
                JyokenCD5 = Get-TextFromBytes $recordBytes 634 3
                FirstPrizeYen = Get-HundredYenValue (Get-TextFromBytes $recordBytes 713 8)
                SecondPrizeYen = Get-HundredYenValue (Get-TextFromBytes $recordBytes 721 8)
                SourceDataKubun = $dataKubun
            }
            continue
        }

        if ($recordType -eq "SE" -and $recordBytes.Length -ge 382) {
            $kettoNum = Get-TextFromBytes $recordBytes 30 10
            if (-not $targetHorses.ContainsKey($kettoNum)) { continue }

            $raceId = Get-RaceId $recordBytes
            $horseRaceKey = $raceId + $kettoNum
            if ($dataKubun -eq "0") {
                [void]$horseRaceRecords.Remove($horseRaceKey)
                continue
            }

            $horseRaceRecords[$horseRaceKey] = [PSCustomObject]@{
                RaceId = $raceId
                KettoNum = $kettoNum
                HorseName = Get-TextFromBytes $recordBytes 40 36
                Finish = Get-TextFromBytes $recordBytes 334 2
                EarnedMainPrizeYen = Get-HundredYenValue (Get-TextFromBytes $recordBytes 365 8)
                SourceDataKubun = $dataKubun
            }
            continue
        }

        if (($recordCount % 50000) -eq 0) {
            Write-Host ("Progress: {0:N0} records" -f $recordCount)
        }
    }

    $historyRows = foreach ($horseRace in $horseRaceRecords.Values) {
        $race = $raceRecords[$horseRace.RaceId]
        if ($null -eq $race) { continue }
        if ($race.RaceDate -ge $targetRaceDate) { continue }

        [PSCustomObject]@{
            KettoNum = $horseRace.KettoNum
            HorseName = $horseRace.HorseName
            RaceDate = $race.RaceDate
            RaceId = $race.RaceId
            JyoCD = $race.JyoCD
            RaceName = $race.RaceName
            GradeCD = $race.GradeCD
            SyubetuCD = $race.SyubetuCD
            KigoCD = $race.KigoCD
            JyuryoCD = $race.JyuryoCD
            JyokenCD1 = $race.JyokenCD1
            JyokenCD2 = $race.JyokenCD2
            JyokenCD3 = $race.JyokenCD3
            JyokenCD4 = $race.JyokenCD4
            JyokenCD5 = $race.JyokenCD5
            Finish = $horseRace.Finish
            EarnedMainPrizeYen = $horseRace.EarnedMainPrizeYen
            FirstPrizeYen = $race.FirstPrizeYen
            SecondPrizeYen = $race.SecondPrizeYen
            RaceDataKubun = $race.SourceDataKubun
            HorseRaceDataKubun = $horseRace.SourceDataKubun
        }
    }

    $historyPath = Join-Path $PSScriptRoot "chukyo-kinen-race-history.csv"

    $historyRows |
        Sort-Object KettoNum, RaceDate, RaceId |
        Export-Csv -Path $historyPath -NoTypeInformation -Encoding UTF8

    Write-Host ""
    Write-Host "RESULT: SUCCESS"
    Write-Host ("Records read: {0:N0}" -f $recordCount)
    Write-Host ("Target horse race rows: {0:N0}" -f @($historyRows).Count)
    Write-Host "History CSV: $historyPath"
}
catch {
    Write-Host ""
    Write-Host "RESULT: FAILED"
    Write-Host $_.Exception.Message
    exit 1
}
finally {
    if ($null -ne $jvLink) {
        try { [void]$jvLink.JVClose() } catch {}
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($jvLink)
    }
}
