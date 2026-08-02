$ErrorActionPreference = "Stop"

# Reads the race data already registered by TARGET frontier JV.
# No JV-Link connection or network download is performed.

$dataRoot = "D:\TFJV\SE_DATA"
$horseDataRoot = "D:\TFJV\UM_DATA"
$fromRaceDate = "20240801"
$targetRaceDate = "20260816"
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
    "2023106227" = "Namura Cosmos"
    "2020106582" = "Phantom Thief"
    "2021105454" = "Buena Onda"
    "2021104854" = "Mina de Oro"
    "2021107098" = "Lavanda"
    "2022104401" = "Lance of Chaos"
    "2022104922" = "Lila Emblem"
    "2023105312" = "Lily Joie"
    "2021105661" = "Regalo del Cielo"
}

$raceRecords = @{}
$horseRaceRecords = @{}
$horseMasterRecords = @{}
$fileCount = 0
$raCount = 0
$seCount = 0
$skippedFileCount = 0
$umFileCount = 0
$umRecordCount = 0

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

function Get-RaceDate {
    param([byte[]]$Bytes)
    return (Get-TextFromBytes $Bytes 11 4) + (Get-TextFromBytes $Bytes 15 4)
}

function Get-RecordBytes {
    param(
        [byte[]]$FileBytes,
        [int]$Offset,
        [int]$Length
    )

    $record = New-Object byte[] $Length
    [Array]::Copy($FileBytes, $Offset, $record, 0, $Length)
    # Prevent PowerShell from unrolling the byte array on return.
    return ,$record
}

try {
    Write-Host "TARGET Chukyo Kinen history exporter"
    Write-Host "Data root: $dataRoot"
    Write-Host "Race date range: $fromRaceDate - $targetRaceDate (exclusive)"

    if (-not (Test-Path -LiteralPath $dataRoot -PathType Container)) {
        throw "TARGET SE_DATA folder was not found: $dataRoot"
    }
    if (-not (Test-Path -LiteralPath $horseDataRoot -PathType Container)) {
        throw "TARGET UM_DATA folder was not found: $horseDataRoot"
    }

    $yearFolders = @("2024", "2025", "2026") | ForEach-Object {
        Join-Path $dataRoot $_
    }

    foreach ($yearFolder in $yearFolders) {
        if (-not (Test-Path -LiteralPath $yearFolder -PathType Container)) {
            throw "Required TARGET year folder was not found: $yearFolder"
        }

        $files = Get-ChildItem -LiteralPath $yearFolder -File -Recurse |
            Sort-Object FullName
        foreach ($file in $files) {
            $fileCount++
            $fileBytes = [IO.File]::ReadAllBytes($file.FullName)
            if ($fileBytes.Length -lt 2) {
                $skippedFileCount++
                continue
            }

            $recordType = Get-TextFromBytes $fileBytes 0 2
            if ($recordType -eq "RA") {
                $recordSize = 1272
            }
            elseif ($recordType -eq "SE") {
                $recordSize = 555
            }
            else {
                $skippedFileCount++
                continue
            }

            for ($offset = 0; ($offset + $recordSize) -le $fileBytes.Length; $offset += $recordSize) {
                $recordBytes = Get-RecordBytes $fileBytes $offset $recordSize
                if ((Get-TextFromBytes $recordBytes 0 2) -ne $recordType) {
                    continue
                }

                $raceDate = Get-RaceDate $recordBytes
                if ($raceDate -lt $fromRaceDate -or $raceDate -ge $targetRaceDate) {
                    continue
                }

                $dataKubun = Get-TextFromBytes $recordBytes 2 1
                $raceId = Get-RaceId $recordBytes

                if ($recordType -eq "RA") {
                    $raCount++
                    if ($dataKubun -eq "0") {
                        [void]$raceRecords.Remove($raceId)
                        continue
                    }

                    $raceRecords[$raceId] = [PSCustomObject]@{
                        RaceId = $raceId
                        RaceDate = $raceDate
                        JyoCD = Get-TextFromBytes $recordBytes 19 2
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
                        SourceFile = $file.FullName
                    }
                    continue
                }

                $kettoNum = Get-TextFromBytes $recordBytes 30 10
                if (-not $targetHorses.ContainsKey($kettoNum)) {
                    continue
                }

                $seCount++
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
                    SourceFile = $file.FullName
                }
            }

            if (($fileCount % 100) -eq 0) {
                Write-Host ("Progress: {0:N0} files" -f $fileCount)
            }
        }
    }

    Write-Host "Reading current acquisition money from TARGET UM_DATA..."
    $horseFiles = Get-ChildItem -LiteralPath $horseDataRoot -File -Recurse |
        Sort-Object FullName

    foreach ($file in $horseFiles) {
        $fileBytes = [IO.File]::ReadAllBytes($file.FullName)
        if ($fileBytes.Length -lt 2) { continue }
        if ((Get-TextFromBytes $fileBytes 0 2) -ne "UM") { continue }

        $umFileCount++
        $recordSize = 1609
        for ($offset = 0; ($offset + $recordSize) -le $fileBytes.Length; $offset += $recordSize) {
            $recordBytes = Get-RecordBytes $fileBytes $offset $recordSize
            if ((Get-TextFromBytes $recordBytes 0 2) -ne "UM") { continue }

            $kettoNum = Get-TextFromBytes $recordBytes 11 10
            if (-not $targetHorses.ContainsKey($kettoNum)) { continue }

            $umRecordCount++
            $dataKubun = Get-TextFromBytes $recordBytes 2 1
            if ($dataKubun -eq "0") {
                [void]$horseMasterRecords.Remove($kettoNum)
                continue
            }

            $horseMasterRecords[$kettoNum] = [PSCustomObject]@{
                KettoNum = $kettoNum
                HorseName = Get-TextFromBytes $recordBytes 46 36
                CurrentAcquisitionMoneyYen = Get-HundredYenValue (Get-TextFromBytes $recordBytes 1088 9)
                SourceDataKubun = $dataKubun
                SourceFile = $file.FullName
            }
        }
    }

    if ($horseMasterRecords.Count -ne $targetHorses.Count) {
        $missingHorseIds = @($targetHorses.Keys | Where-Object {
            -not $horseMasterRecords.ContainsKey($_)
        } | Sort-Object)
        throw ("Current acquisition money was found for {0} of {1} horses. Missing: {2}" -f `
            $horseMasterRecords.Count, $targetHorses.Count, ($missingHorseIds -join ", "))
    }

    $currentPrizePath = Join-Path $PSScriptRoot "chukyo-kinen-current-prizes.csv"
    $horseMasterRecords.Values |
        Sort-Object KettoNum |
        Select-Object KettoNum, HorseName, CurrentAcquisitionMoneyYen, SourceDataKubun |
        Export-Csv -Path $currentPrizePath -NoTypeInformation -Encoding UTF8

    $historyRows = foreach ($horseRace in $horseRaceRecords.Values) {
        $race = $raceRecords[$horseRace.RaceId]
        if ($null -eq $race) { continue }

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

    if (@($historyRows).Count -eq 0) {
        throw "No matching race history was found in TARGET SE_DATA."
    }

    $historyPath = Join-Path $PSScriptRoot "chukyo-kinen-race-history.csv"
    $historyRows |
        Sort-Object KettoNum, RaceDate, RaceId |
        Export-Csv -Path $historyPath -NoTypeInformation -Encoding UTF8

    Write-Host ""
    Write-Host "RESULT: SUCCESS"
    Write-Host ("Files scanned: {0:N0}" -f $fileCount)
    Write-Host ("Files skipped: {0:N0}" -f $skippedFileCount)
    Write-Host ("RA records in range: {0:N0}" -f $raCount)
    Write-Host ("Target SE records in range: {0:N0}" -f $seCount)
    Write-Host ("UM files read: {0:N0}" -f $umFileCount)
    Write-Host ("Target UM records read: {0:N0}" -f $umRecordCount)
    Write-Host ("Output rows: {0:N0}" -f @($historyRows).Count)
    Write-Host "Current prize CSV: $currentPrizePath"
    Write-Host "History CSV: $historyPath"
}
catch {
    Write-Host ""
    Write-Host "RESULT: FAILED"
    Write-Host $_.Exception.Message
    Write-Host ("Files scanned: {0:N0}" -f $fileCount)
    Write-Host ("Files skipped: {0:N0}" -f $skippedFileCount)
    Write-Host ("RA records in range: {0:N0}" -f $raCount)
    Write-Host ("Target SE records in range: {0:N0}" -f $seCount)
    Write-Host ("UM files read: {0:N0}" -f $umFileCount)
    Write-Host ("Target UM records read: {0:N0}" -f $umRecordCount)
    exit 1
}
