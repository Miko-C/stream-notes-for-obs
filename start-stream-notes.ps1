$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverPath = Join-Path $root "server.js"
$bundledNodePath = Join-Path $root "runtime\node.exe"
$dataRoot = if ($env:STREAM_NOTES_DATA_DIR) {
  $env:STREAM_NOTES_DATA_DIR
} elseif ($env:LOCALAPPDATA) {
  Join-Path $env:LOCALAPPDATA "StreamNotes"
} else {
  Join-Path $root "data"
}
$pidPath = Join-Path $dataRoot "server.pid"
$appPort = if ($env:PORT -and $env:PORT -match '^\d+$') { [int]$env:PORT } else { 4177 }
$controlUrl = "http://127.0.0.1:$appPort/"
$appName = -join ([char[]](0x914D, 0x4FE1, 0x30CE, 0x30FC, 0x30C8))

function Test-StreamNotesServer {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "${controlUrl}api/state" -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Show-LaunchError([string]$message) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    $message,
    $appName,
    [System.Windows.MessageBoxButton]::OK,
    [System.Windows.MessageBoxImage]::Error
  ) | Out-Null
}

try {
  if (-not (Test-StreamNotesServer)) {
    if (Test-Path -LiteralPath $bundledNodePath) {
      $nodePath = $bundledNodePath
    } else {
      $nodePath = (Get-Command node -ErrorAction Stop).Source
    }

    New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
    $process = Start-Process `
      -FilePath $nodePath `
      -ArgumentList @($serverPath) `
      -WorkingDirectory $root `
      -WindowStyle Hidden `
      -PassThru

    Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ASCII

    $ready = $false
    for ($attempt = 0; $attempt -lt 80; $attempt += 1) {
      Start-Sleep -Milliseconds 100
      if (Test-StreamNotesServer) {
        $ready = $true
        break
      }
      if ($process.HasExited) {
        break
      }
    }

    if (-not $ready) {
      throw "Stream Notes could not start. Make sure port 4177 is available."
    }
  }

  if ($env:STREAM_NOTES_NO_BROWSER -ne "1") {
    Start-Process $controlUrl
  }
} catch {
  Show-LaunchError($_.Exception.Message)
  exit 1
}
