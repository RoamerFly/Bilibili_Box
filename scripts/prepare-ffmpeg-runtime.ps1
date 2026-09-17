param(
    [ValidateSet("windows-x64")]
    [string]$Platform = "windows-x64"
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$envDir = Join-Path $projectRoot "env"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("bilibox-ffmpeg-" + [Guid]::NewGuid().ToString("N"))
$archiveName = "ffmpeg-n8.1-latest-win64-gpl-8.1.zip"
$baseUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
$archivePath = Join-Path $tempDir $archiveName
$checksumPath = Join-Path $tempDir "checksums.sha256"

function Download-File([string]$Url, [string]$Destination) {
    Write-Host "Downloading $Url"
    & curl.exe --silent --show-error --fail --location --retry 3 --retry-all-errors --output $Destination $Url
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to download $Url"
    }
}

try {
    New-Item -ItemType Directory -Force $envDir, $tempDir | Out-Null
    Download-File "$baseUrl/$archiveName" $archivePath
    Download-File "$baseUrl/checksums.sha256" $checksumPath

    $checksumLine = (Get-Content $checksumPath) | Where-Object { $_ -match [regex]::Escape($archiveName) } | Select-Object -First 1
    if (-not $checksumLine) {
        throw "Archive $archiveName not found in checksums.sha256."
    }
    $expectedHash = ($checksumLine.Trim() -split "\s+")[0].ToLowerInvariant()
    $actualHash = (Get-FileHash -Algorithm SHA256 $archivePath).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "Checksum verification failed for $archiveName. Expected: $expectedHash, Actual: $actualHash"
    }

    $expandedDir = Join-Path $tempDir "expanded"
    Expand-Archive -Path $archivePath -DestinationPath $expandedDir
    foreach ($tool in @("ffmpeg.exe", "ffprobe.exe")) {
        $source = Get-ChildItem -Path $expandedDir -Recurse -File -Filter $tool |
            Where-Object { $_.FullName -match "[\\/]bin[\\/]" } |
            Select-Object -First 1
        if (-not $source) {
            throw "$tool was not found in $archiveName."
        }
        Copy-Item -LiteralPath $source.FullName -Destination (Join-Path $envDir $tool) -Force
    }

    $license = Get-ChildItem -Path $expandedDir -Recurse -File |
        Where-Object { $_.Name -match "^LICENSE(\.txt)?$" } |
        Select-Object -First 1
    if ($license) {
        Copy-Item -LiteralPath $license.FullName -Destination (Join-Path $envDir "FFmpeg-LICENSE.txt") -Force
    }
    Download-File "https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.1/COPYING.GPLv3" `
        (Join-Path $envDir "FFmpeg-GPL-3.0.txt")

    foreach ($tool in @("ffmpeg.exe", "ffprobe.exe")) {
        $path = Join-Path $envDir $tool
        if ((Get-Item $path).Length -lt 5MB) {
            throw "$tool is too small to be the standalone runtime; refusing a launcher shim."
        }
        & $path -version | Select-Object -First 1
        if ($LASTEXITCODE -ne 0) {
            throw "$tool failed its version check."
        }
    }
} finally {
    if (Test-Path $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force
    }
}
