param(
  [string]$In = "",
  [string]$Out = "",
  [int]$X = 590,
  [int]$Y = 260,
  [int]$W = 1380,
  [int]$H = 920
)

# Defaults live next to the project root, so the script keeps working after a rename.
$root = Split-Path $PSScriptRoot -Parent
if (-not $In) { $In = Join-Path $root '.smoke\screen.png' }
if (-not $Out) { $Out = Join-Path $root '.smoke\app.png' }

Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile($In)
$rect = New-Object System.Drawing.Rectangle $X, $Y, $W, $H
$bmp = New-Object System.Drawing.Bitmap $W, $H
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $W, $H), $rect, [System.Drawing.GraphicsUnit]::Pixel)
$bmp.Save($Out)
$gfx.Dispose(); $bmp.Dispose(); $src.Dispose()
Write-Output "saved $Out"
