param(
  [switch]$ResolveOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
  $projectRoot = Split-Path -Parent $PSScriptRoot
  $executableName = 'ADB Device Suite.exe'
  $candidates = @(
    Get-ChildItem -LiteralPath $projectRoot -Directory -Filter 'release*' |
      ForEach-Object {
        $executablePath = Join-Path $_.FullName "win-unpacked\$executableName"
        if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
          return
        }

        $executable = Get-Item -LiteralPath $executablePath
        try {
          $version = [version]$executable.VersionInfo.ProductVersion
        }
        catch {
          return
        }

        [PSCustomObject]@{
          Path = $executable.FullName
          Version = $version
          LastWriteTime = $executable.LastWriteTimeUtc
        }
      }
  )

  $latest = $candidates |
    Sort-Object -Property @{ Expression = 'Version'; Descending = $true }, @{ Expression = 'LastWriteTime'; Descending = $true } |
    Select-Object -First 1

  if ($null -eq $latest) {
    throw "No compiled $executableName was found under $projectRoot."
  }

  if ($ResolveOnly) {
    $latest.Path
    exit 0
  }

  Start-Process -FilePath $latest.Path -WorkingDirectory (Split-Path -Parent $latest.Path)
}
catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    $_.Exception.Message,
    'ADB Device Suite',
    [System.Windows.MessageBoxButton]::OK,
    [System.Windows.MessageBoxImage]::Error
  ) | Out-Null
  exit 1
}
