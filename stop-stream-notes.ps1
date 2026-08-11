$ErrorActionPreference = "Stop"

$appPort = if ($env:PORT -and $env:PORT -match '^\d+$') { [int]$env:PORT } else { 4177 }
$controlUrl = "http://127.0.0.1:$appPort/api/shutdown"
$appName = -join ([char[]](0x914D, 0x4FE1, 0x30CE, 0x30FC, 0x30C8))

try {
  Invoke-RestMethod -Method Post -Uri $controlUrl -TimeoutSec 2 | Out-Null
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "Stream Notes is not running.",
    $appName,
    [System.Windows.MessageBoxButton]::OK,
    [System.Windows.MessageBoxImage]::Information
  ) | Out-Null
}
