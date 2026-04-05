Param(
    [string]$OutFile = "$PSScriptRoot\slt-extension.zip"
)

if (Test-Path $OutFile) { Remove-Item $OutFile -Force }

$excludeDirs = @('.git','node_modules','publish')
$files = Get-ChildItem -Path $PSScriptROOT -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($PSScriptRoot.Length)
    foreach ($e in $excludeDirs) { if ($rel -match [regex]::Escape("\\$e\\")) { return $false } }
    return $true
}

if (-not $files) { Write-Error "No files found to package."; exit 1 }

Compress-Archive -LiteralPath ($files | ForEach-Object { $_.FullName }) -DestinationPath $OutFile -Force
Write-Output "Created package: $OutFile"