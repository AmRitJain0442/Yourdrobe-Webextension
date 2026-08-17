[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$extensionRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $extensionRoot
$distPath = Join-Path $extensionRoot "dist"
$releasePath = Join-Path $repositoryRoot "release"

Push-Location $extensionRoot
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "The production extension build failed."
    }
}
finally {
    Pop-Location
}

$manifestPath = Join-Path $distPath "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.host_permissions -contains "http://127.0.0.1:8001/*") {
    throw "The Web Store manifest must not request localhost access."
}

$requiredFiles = @(
    "manifest.json",
    "sidepanel.html",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png"
)
foreach ($relativePath in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $distPath $relativePath))) {
        throw "The production build is missing $relativePath."
    }
}

New-Item -ItemType Directory -Force -Path $releasePath | Out-Null
$archivePath = Join-Path $releasePath "yourdrobe-ai-try-on-$($manifest.version).zip"
if (-not $archivePath.StartsWith($releasePath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace an archive outside the release directory."
}
if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath
}
Compress-Archive -Path (Join-Path $distPath "*") -DestinationPath $archivePath -CompressionLevel Optimal

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
    if ($entries -notcontains "manifest.json") {
        throw "manifest.json is not at the ZIP root."
    }
    $forbidden = @($entries | Where-Object {
        $_ -match "(^|/)(\.env($|\.)|.*-creds\.txt$|.*sa-key.*\.json$)" -or $_ -like "*.map"
    })
    if ($forbidden) {
        throw "The ZIP contains forbidden files: $($forbidden -join ', ')"
    }
}
finally {
    $archive.Dispose()
}

$checksum = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[pscustomobject]@{
    Archive = $archivePath
    Version = $manifest.version
    Entries = $entries.Count
    Bytes = (Get-Item -LiteralPath $archivePath).Length
    SHA256 = $checksum
}
