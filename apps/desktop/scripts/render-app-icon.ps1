# Rasterize the Locus mark (public/logo.svg geometry) to buildResources/icon.png at 1024².
Add-Type -AssemblyName System.Drawing

$size = 1024
$s = $size / 128.0
$out = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\buildResources\icon.png"))

$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::FromArgb(255, 0, 0, 0))

$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0xFD, 0xCB, 0x2A))

# Vertical stem: x=34..50, y=27..84
$g.FillRectangle($brush, 34 * $s, 27 * $s, 16 * $s, 57 * $s)
# Horizontal foot: x=50..84, y=84..100
$g.FillRectangle($brush, 50 * $s, 84 * $s, 34 * $s, 16 * $s)
# Outer rounded corner: quarter pie centered at (50,84), r=16 (from (50,100) to (34,84))
$g.FillPie($brush, 34 * $s, 68 * $s, 32 * $s, 32 * $s, 90, 90)
# Terminal dot: cx=84, cy=92, r=11
$g.FillEllipse($brush, 73 * $s, 81 * $s, 22 * $s, 22 * $s)

$g.Dispose()
$brush.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "Wrote $out ($size x $size)"
