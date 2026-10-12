param([ValidateSet('status','locate')][string]$Mode = 'status')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function BoolValue($Value) { if ($Value -is [bool]) { return $Value }; return $null }
function NoReparseAncestors([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
    return $true
}
function DateValue($Value) { if ($null -eq $Value) { return $null }; try { return $Value.ToUniversalTime().ToString('o') } catch { return $null } }
try {
    if ($Mode -eq 'locate') {
        $candidates = @()
        $platformRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'Microsoft\Windows Defender\Platform'
        if (Test-Path -LiteralPath $platformRoot) {
            $versions = @(Get-ChildItem -LiteralPath $platformRoot -Directory | Where-Object { $_.Name -match '^\d+(\.\d+){2,}(-\d+)?$' -and ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 } | Sort-Object @{ Expression = { [version]($_.Name.Split('-')[0]) } } -Descending)
            foreach ($version in $versions) { $candidates += Join-Path $version.FullName 'MpCmdRun.exe' }
        }
        $candidates += Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Windows Defender\MpCmdRun.exe'
        foreach ($candidate in $candidates) {
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                $item = Get-Item -LiteralPath $candidate
                if (-not (NoReparseAncestors $candidate)) { continue }
                $signature = Get-AuthenticodeSignature -LiteralPath $candidate
                if ($signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -match '(^|,\s*)O=Microsoft Corporation(,|$)') {
                    $digest = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
                    $after = Get-Item -LiteralPath $candidate -ErrorAction Stop
                    if ($item.Length -ne $after.Length -or $item.LastWriteTimeUtc.Ticks -ne $after.LastWriteTimeUtc.Ticks) { continue }
                    @{ path = $item.FullName; sha256 = $digest } | ConvertTo-Json -Compress
                    exit 0
                }
            }
        }
        throw 'A trusted Microsoft Defender command-line scanner was not found.'
    }
    $status = Get-MpComputerStatus -ErrorAction Stop
    if ($null -eq $status) { throw 'Defender returned no protection status.' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $administrator = (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $warnings = @()
    $detections = @()
    try {
        $known = @{}
        foreach ($threat in @(Get-MpThreat -ErrorAction Stop)) { $known[[string]$threat.ThreatID] = $threat }
        $severityLabels = @{}
        try {
            $property = (Get-CimClass -Namespace 'root/Microsoft/Windows/Defender' -ClassName 'MSFT_MpThreat').CimClassProperties['SeverityID']
            $values = @($property.Qualifiers['Values'].Value)
            $keys = @($property.Qualifiers['ValueMap'].Value)
            for ($index = 0; $index -lt $keys.Count; $index++) { if ($index -lt $values.Count) { $severityLabels[[string]$keys[$index]] = [string]$values[$index] } }
        } catch { }
        foreach ($detection in @(Get-MpThreatDetection -ErrorAction Stop | Sort-Object InitialDetectionTime -Descending | Select-Object -First 100)) {
            $threat = $known[[string]$detection.ThreatID]
            $severity = if ($null -ne $threat -and $severityLabels.ContainsKey([string]$threat.SeverityID)) { $severityLabels[[string]$threat.SeverityID] } elseif ($null -ne $threat) { 'Level ' + $threat.SeverityID } else { 'Unknown' }
            $detections += @{
                id = [string]$detection.DetectionID; threatId = [string]$detection.ThreatID
                name = $(if ($null -ne $threat) { [string]$threat.ThreatName } else { 'Threat ' + $detection.ThreatID })
                severity = $severity; active = $(if ($null -ne $threat) { [bool]$threat.IsActive } else { $null })
                actionSuccess = [bool]$detection.ActionSuccess; detectedAt = DateValue $detection.InitialDetectionTime
                resources = @($detection.Resources | Select-Object -First 10)
            }
        }
    } catch { $warnings += 'Protection history could not be read. Open Windows Security to review detections.' }
    @{
        available = $true; administrator = $administrator; provider = 'Microsoft Defender Antivirus'
        serviceEnabled = BoolValue $status.AMServiceEnabled; enabled = BoolValue $status.AntivirusEnabled
        realtimeEnabled = BoolValue $status.RealTimeProtectionEnabled; tamperProtected = $status.IsTamperProtected
        signatureVersion = [string]$status.AntivirusSignatureVersion; definitionsUpdated = DateValue $status.AntivirusSignatureLastUpdated
        quickScan = @{ startedAt = DateValue $status.QuickScanStartTime; finishedAt = DateValue $status.QuickScanEndTime }
        fullScan = @{ startedAt = DateValue $status.FullScanStartTime; finishedAt = DateValue $status.FullScanEndTime }
        detections = @($detections); warnings = @($warnings)
    } | ConvertTo-Json -Depth 7 -Compress
} catch {
    $reason = if ($_.Exception.Message -match 'Access.*denied|0x80070005') { 'Windows denied access to Microsoft Defender. Start your terminal as administrator and launch Jarvis there, or review Windows Security.' } else { 'Microsoft Defender status is unavailable. It may be disabled, replaced by another antivirus, or restricted by your organization.' }
    @{ available = $false; reason = $reason } | ConvertTo-Json -Compress
}
