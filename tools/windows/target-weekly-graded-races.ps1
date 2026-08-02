$ErrorActionPreference = "Stop"

# Reads TARGET frontier JV data already stored on this PC.
# No JV-Link connection or network download is performed.
# Target meetings: 2026-08-08 and 2026-08-09 graded races.

$dataRoot = "D:\TFJV\SE_DATA"
$horseDataRoot = "D:\TFJV\UM_DATA"
$targetRaceDates = @("20260808", "20260809")
$gradedRaceCodes = @("A", "B", "C")
$fromRaceDate = "20240801"
$toRaceDateExclusive = "20260810"
$encoding = [System.Text.Encoding]::GetEncoding(932)

$registeredRaces = @{}
$targetHorses = @{}
$raceRecords = @{}
$horseRaceRecords = @{}
$horseMasterRecords = @{}
$tkFileCount = 0
$registrationFileCount = 0
$tkRaceSummaries = @()
$historyFileCount = 0
$raCount = 0
$seCount = 0
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
    return ,$record
}

function Get-FileRecordSpec {
    param([string]$Path)

    $stream = $null
    try {
        $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        $firstBytes = New-Object byte[] 2
        if ($stream.Read($firstBytes, 0, 2) -ne 2) {
            return ""
        }
        return $encoding.GetString($firstBytes, 0, 2)
    }
    catch {
        return ""
    }
    finally {
        if ($null -ne $stream) {
            $stream.Dispose()
        }
    }
}

function Get-GradeLabel {
    param([string]$GradeCode)
    switch ($GradeCode) {
        "A" { return "GI" }
        "B" { return "GII" }
        "C" { return "GIII" }
        default { return $GradeCode }
    }
}

try {
    Write-Host "TARGET weekly graded-race exporter"
    Write-Host "Data root: $dataRoot"
    Write-Host "Target dates: $($targetRaceDates -join ', ')"

    if (-not (Test-Path -LiteralPath $dataRoot -PathType Container)) {
        throw "TARGET SE_DATA folder was not found: $dataRoot"
    }
    if (-not (Test-Path -LiteralPath $horseDataRoot -PathType Container)) {
        throw "TARGET UM_DATA folder was not found: $horseDataRoot"
    }

    Write-Host "Locating special-race registration records (TK)..."
    # dataRoot was already verified above, so always search it recursively.
    $registrationSearchRoots = @($dataRoot)
    if ((-not [string]::IsNullOrWhiteSpace($targetRoot)) -and
        (Test-Path -LiteralPath $targetRoot -PathType Container)) {
        $registrationSearchRoots += $targetRoot
    }
    if ((-not [string]::IsNullOrWhiteSpace($jvDataRoot)) -and
        (Test-Path -LiteralPath $jvDataRoot -PathType Container)) {
        $registrationSearchRoots += $jvDataRoot
    }
    $registrationSearchRoots = @($registrationSearchRoots | Select-Object -Unique)
    Write-Host ("Search roots: {0}" -f ($registrationSearchRoots -join ", "))

    $registrationFiles = @()
    foreach ($searchRoot in $registrationSearchRoots) {
        if ([string]::IsNullOrWhiteSpace($searchRoot)) { continue }
        $registrationFiles += Get-ChildItem -LiteralPath $searchRoot -File -Recurse -ErrorAction SilentlyContinue
    }
    $registrationFiles = @($registrationFiles | Sort-Object FullName -Unique)

    foreach ($file in $registrationFiles) {
        $registrationFileCount++
        if ((Get-FileRecordSpec $file.FullName) -ne "TK") {
            if (($registrationFileCount % 1000) -eq 0) {
                Write-Host ("Registration search: {0:N0} files" -f $registrationFileCount)
            }
            continue
        }

        $fileBytes = [IO.File]::ReadAllBytes($file.FullName)
        $tkFileCount++
        $recordSize = 21657
        for ($offset = 0; ($offset + $recordSize) -le $fileBytes.Length; $offset += $recordSize) {
            $recordBytes = Get-RecordBytes $fileBytes $offset $recordSize
            if ((Get-TextFromBytes $recordBytes 0 2) -ne "TK") { continue }

            $raceDate = Get-RaceDate $recordBytes
            $gradeCode = Get-TextFromBytes $recordBytes 614 1
            $raceName = Get-TextFromBytes $recordBytes 32 60
            $tkRaceSummaries += "$raceDate $gradeCode $raceName"
            if ($targetRaceDates -notcontains $raceDate) { continue }
            if ($gradedRaceCodes -notcontains $gradeCode) { continue }

            $raceId = Get-RaceId $recordBytes
            $dataKubun = Get-TextFromBytes $recordBytes 2 1
            if ($dataKubun -eq "0") {
                [void]$registeredRaces.Remove($raceId)
                continue
            }

            $registeredCountText = Get-TextFromBytes $recordBytes 652 3
            $registeredCount = 0
            if (-not [int]::TryParse($registeredCountText, [ref]$registeredCount)) {
                throw "Invalid registered horse count '$registeredCountText' in race $raceId"
            }

            $entries = @()
            for ($index = 0; $index -lt [Math]::Min($registeredCount, 300); $index++) {
                $horseOffset = 655 + (70 * $index)
                $kettoNum = Get-TextFromBytes $recordBytes ($horseOffset + 3) 10
                if ([string]::IsNullOrWhiteSpace($kettoNum)) { continue }

                $horseName = Get-TextFromBytes $recordBytes ($horseOffset + 13) 36
                $rawWeight = Get-TextFromBytes $recordBytes ($horseOffset + 66) 3
                $weightKg = $null
                $weightValue = 0
                if ([int]::TryParse($rawWeight, [ref]$weightValue) -and $weightValue -gt 0) {
                    $weightKg = $weightValue / 10.0
                }

                $entry = [PSCustomObject]@{
                    RaceDate = $raceDate
                    RaceId = $raceId
                    RaceName = Get-TextFromBytes $recordBytes 32 60
                    GradeCD = $gradeCode
                    Grade = Get-GradeLabel $gradeCode
                    JyoCD = Get-TextFromBytes $recordBytes 19 2
                    SyubetuCD = Get-TextFromBytes $recordBytes 615 2
                    KigoCD = Get-TextFromBytes $recordBytes 617 3
                    JyuryoCD = Get-TextFromBytes $recordBytes 620 1
                    DistanceMeters = Get-TextFromBytes $recordBytes 636 4
                    TrackCD = Get-TextFromBytes $recordBytes 640 2
                    HandiDate = Get-TextFromBytes $recordBytes 644 8
                    RegisteredCount = $registeredCount
                    KettoNum = $kettoNum
                    HorseName = $horseName
                    RegisteredWeightKg = $weightKg
                    SourceDataKubun = $dataKubun
                }
                $entries += $entry
            }

            $registeredRaces[$raceId] = [PSCustomObject]@{
                RaceId = $raceId
                RaceDate = $raceDate
                RaceName = Get-TextFromBytes $recordBytes 32 60
                GradeCD = $gradeCode
                Entries = $entries
            }
        }
    }

    if ($registeredRaces.Count -ne 3) {
        $found = @($registeredRaces.Values | Sort-Object RaceDate, RaceName | ForEach-Object {
            "$($_.RaceDate) $($_.RaceName)"
        }) -join "; "
        $tkExamples = @($tkRaceSummaries | Sort-Object -Unique | Select-Object -Last 20) -join "; "
        throw ("Expected 3 graded races, but found {0}. TK files: {1}. Files searched: {2}. " +
            "Matching races: {3}. Latest TK records: {4}" -f $registeredRaces.Count,
            $tkFileCount, $registrationFileCount, $found, $tkExamples)
    }

    $entryRows = @($registeredRaces.Values |
        ForEach-Object { $_.Entries } |
        Sort-Object RaceDate, RaceName, KettoNum)

    foreach ($entry in $entryRows) {
        $targetHorses[$entry.KettoNum] = $entry.HorseName
    }
    if ($targetHorses.Count -eq 0) {
        throw "No registered horses were found in the three TK records."
    }

    $entriesPath = Join-Path $PSScriptRoot "weekly-graded-entries.csv"
    $entryRows | Export-Csv -Path $entriesPath -NoTypeInformation -Encoding UTF8

    $foundRaceLabels = @($registeredRaces.Values |
        Sort-Object RaceDate, RaceName |
        ForEach-Object { "$($_.RaceName) [$($_.Entries.Count)]" })
    Write-Host ("Found races: {0}" -f ($foundRaceLabels -join ", "))
    Write-Host ("Unique registered horses: {0:N0}" -f $targetHorses.Count)

    Write-Host "Reading two years of race history (RA/SE)..."
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
            $fileBytes = [IO.File]::ReadAllBytes($file.FullName)
            if ($fileBytes.Length -lt 2) { continue }

            $recordType = Get-TextFromBytes $fileBytes 0 2
            if ($recordType -eq "RA") {
                $recordSize = 1272
            }
            elseif ($recordType -eq "SE") {
                $recordSize = 555
            }
            else {
                continue
            }

            $historyFileCount++
            for ($offset = 0; ($offset + $recordSize) -le $fileBytes.Length; $offset += $recordSize) {
                $recordBytes = Get-RecordBytes $fileBytes $offset $recordSize
                if ((Get-TextFromBytes $recordBytes 0 2) -ne $recordType) { continue }

                $raceDate = Get-RaceDate $recordBytes
                if ($raceDate -lt $fromRaceDate -or $raceDate -ge $toRaceDateExclusive) { continue }

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
                        SyubetuCD = Get-TextFromBytes $recordBytes 615 2
                        KigoCD = Get-TextFromBytes $recordBytes 617 3
                        JyuryoCD = Get-TextFromBytes $recordBytes 620 1
                        JyokenCD1 = Get-TextFromBytes $recordBytes 621 3
                        JyokenCD2 = Get-TextFromBytes $recordBytes 624 3
                        JyokenCD3 = Get-TextFromBytes $recordBytes 627 3
                        JyokenCD4 = Get-TextFromBytes $recordBytes 630 3
                        JyokenCD5 = Get-TextFromBytes $recordBytes 633 3
                        FirstPrizeYen = Get-HundredYenValue (Get-TextFromBytes $recordBytes 713 8)
                        SecondPrizeYen = Get-HundredYenValue (Get-TextFromBytes $recordBytes 721 8)
                        SourceDataKubun = $dataKubun
                    }
                    continue
                }

                $kettoNum = Get-TextFromBytes $recordBytes 30 10
                if (-not $targetHorses.ContainsKey($kettoNum)) { continue }

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
                }
            }

            if (($historyFileCount % 100) -eq 0) {
                Write-Host ("Progress: {0:N0} history files" -f $historyFileCount)
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
            }
        }
    }

    $missingHorseIds = @($targetHorses.Keys | Where-Object {
        -not $horseMasterRecords.ContainsKey($_)
    } | Sort-Object)
    if ($missingHorseIds.Count -gt 0) {
        Write-Warning ("Current acquisition money is missing for {0} horse(s): {1}" -f `
            $missingHorseIds.Count, ($missingHorseIds -join ", "))
    }

    $currentPrizePath = Join-Path $PSScriptRoot "weekly-graded-current-prizes.csv"
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

    $historyPath = Join-Path $PSScriptRoot "weekly-graded-race-history.csv"
    $historyRows |
        Sort-Object KettoNum, RaceDate, RaceId |
        Export-Csv -Path $historyPath -NoTypeInformation -Encoding UTF8

    Write-Host ""
    Write-Host "RESULT: SUCCESS"
    Write-Host ("Registration files searched: {0:N0}" -f $registrationFileCount)
    Write-Host ("TK files read: {0:N0}" -f $tkFileCount)
    Write-Host ("Graded races: {0:N0}" -f $registeredRaces.Count)
    Write-Host ("Registration rows: {0:N0}" -f $entryRows.Count)
    Write-Host ("Unique registered horses: {0:N0}" -f $targetHorses.Count)
    Write-Host ("RA records in range: {0:N0}" -f $raCount)
    Write-Host ("Target SE records in range: {0:N0}" -f $seCount)
    Write-Host ("Target UM records read: {0:N0}" -f $umRecordCount)
    Write-Host "Entries CSV: $entriesPath"
    Write-Host "Current prize CSV: $currentPrizePath"
    Write-Host "History CSV: $historyPath"
}
catch {
    Write-Host ""
    Write-Host "RESULT: FAILED"
    Write-Host $_.Exception.Message
    exit 1
}
