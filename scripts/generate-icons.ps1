# Generates the NeostixSnap PNG toolbar and store icons from one vector-style master.
# Usage: pwsh -File scripts/generate-icons.ps1
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$iconDir = Join-Path $projectRoot 'extension\icons'
$assetDir = Join-Path $projectRoot 'extension\assets'
New-Item -ItemType Directory -Force -Path $iconDir, $assetDir | Out-Null

function New-RoundedPath {
  param(
    [single]$X,
    [single]$Y,
    [single]$Width,
    [single]$Height,
    [single]$Radius
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

$masterSize = 512
$master = [System.Drawing.Bitmap]::new(
  $masterSize,
  $masterSize,
  [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
)
$graphics = [System.Drawing.Graphics]::FromImage($master)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$graphics.Clear([System.Drawing.Color]::Transparent)

$gradientRect = [System.Drawing.RectangleF]::new(8, 8, 496, 496)
$gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  $gradientRect,
  [System.Drawing.Color]::FromArgb(255, 34, 211, 238),
  [System.Drawing.Color]::FromArgb(255, 139, 92, 246),
  [single]45
)
$outerPath = New-RoundedPath -X 8 -Y 8 -Width 496 -Height 496 -Radius 138
$graphics.FillPath($gradient, $outerPath)

$innerPath = New-RoundedPath -X 20 -Y 20 -Width 472 -Height 472 -Radius 127
$innerBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 7, 11, 20))
$graphics.FillPath($innerBrush, $innerPath)

$strokeBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.RectangleF]::new(136, 136, 240, 240),
  [System.Drawing.Color]::FromArgb(255, 34, 211, 238),
  [System.Drawing.Color]::FromArgb(255, 139, 92, 246),
  [single]45
)

$circlePen = [System.Drawing.Pen]::new($strokeBrush, [single]14)
$circlePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$circlePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawEllipse($circlePen, 172, 172, 168, 168)

$cornerPen = [System.Drawing.Pen]::new($strokeBrush, [single]20)
$cornerPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$cornerPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$cornerPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

$graphics.DrawLines($cornerPen, [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(136, 192),
  [System.Drawing.PointF]::new(136, 136),
  [System.Drawing.PointF]::new(192, 136)
))
$graphics.DrawLines($cornerPen, [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(320, 136),
  [System.Drawing.PointF]::new(376, 136),
  [System.Drawing.PointF]::new(376, 192)
))
$graphics.DrawLines($cornerPen, [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(376, 320),
  [System.Drawing.PointF]::new(376, 376),
  [System.Drawing.PointF]::new(320, 376)
))
$graphics.DrawLines($cornerPen, [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(192, 376),
  [System.Drawing.PointF]::new(136, 376),
  [System.Drawing.PointF]::new(136, 320)
))

$bolt = [System.Drawing.Drawing2D.GraphicsPath]::new()
$bolt.AddPolygon([System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(270.4, 180.0),
  [System.Drawing.PointF]::new(204.0, 272.0),
  [System.Drawing.PointF]::new(250.4, 272.0),
  [System.Drawing.PointF]::new(241.6, 334.4),
  [System.Drawing.PointF]::new(308.0, 240.8),
  [System.Drawing.PointF]::new(261.6, 240.8),
  [System.Drawing.PointF]::new(270.4, 180.0)
))
$boltBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.RectangleF]::new(204, 180, 104, 155),
  [System.Drawing.Color]::White,
  [System.Drawing.Color]::FromArgb(255, 224, 242, 254),
  [single]90
)
$graphics.FillPath($boltBrush, $bolt)

$graphics.Dispose()

$sizes = @(16, 32, 48, 128)
foreach ($size in $sizes) {
  $target = [System.Drawing.Bitmap]::new(
    $size,
    $size,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $targetGraphics = [System.Drawing.Graphics]::FromImage($target)
  $targetGraphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $targetGraphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $targetGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $targetGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $targetGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $targetGraphics.DrawImage($master, 0, 0, $size, $size)
  $targetGraphics.Dispose()

  $outPath = Join-Path $iconDir ("icon{0}.png" -f $size)
  $target.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $target.Dispose()
  Write-Host ("Wrote {0}" -f $outPath)
}

$master.Dispose()
Write-Host 'Icon generation complete.'
