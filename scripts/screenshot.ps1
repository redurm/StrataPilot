param([string]$Out = "")

# Default output lives next to the project root, so the script keeps working after a rename.
if (-not $Out) {
  $root = Split-Path $PSScriptRoot -Parent
  $Out = Join-Path (Join-Path $root '.smoke') 'screen.png'
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
$bmp.Save($Out)
$gfx.Dispose()
$bmp.Dispose()
Write-Output "saved $Out ($($bounds.Width)x($bounds.Height))"
