$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherPath = Join-Path $root "start-stream-notes.cmd"
$iconPath = Join-Path $root "stream-notes.ico"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$appName = -join ([char[]](0x914D, 0x4FE1, 0x30CE, 0x30FC, 0x30C8))
$shortcutPath = Join-Path $desktopPath "$appName.lnk"

Add-Type -AssemblyName System.Drawing

$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::FromArgb(16, 18, 16))

$panelBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(29, 33, 30))
$tealBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(82, 211, 170))
$amberBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(241, 184, 76))
$textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(244, 240, 229))
$borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(82, 211, 170)), 10

$graphics.FillRectangle($panelBrush, 22, 22, 212, 212)
$graphics.DrawRectangle($borderPen, 27, 27, 202, 202)
$graphics.FillRectangle($amberBrush, 48, 54, 160, 18)
$graphics.FillEllipse($tealBrush, 48, 164, 34, 34)
$graphics.FillEllipse($amberBrush, 111, 164, 34, 34)
$graphics.FillEllipse($tealBrush, 174, 164, 34, 34)

$font = New-Object System.Drawing.Font "Segoe UI", 68, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString("SN", $font, $textBrush, (New-Object System.Drawing.RectangleF 36, 72, 184, 86), $format)

$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream = [System.IO.File]::Create($iconPath)
$icon.Save($stream)
$stream.Close()

$icon.Dispose()
$format.Dispose()
$font.Dispose()
$borderPen.Dispose()
$textBrush.Dispose()
$amberBrush.Dispose()
$tealBrush.Dispose()
$panelBrush.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcherPath
$shortcut.Arguments = ""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = "Start Stream Notes and open the control screen"
$shortcut.Save()

Write-Output $shortcutPath
