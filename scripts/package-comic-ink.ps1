$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$bundlePath = Join-Path $repositoryRoot 'Comic-Ink-Vectorizer-1.0.0'
$archivePath = Join-Path $repositoryRoot 'Comic-Ink-Vectorizer-1.0.0.zip'
$resolvedBundle = [IO.Path]::GetFullPath($bundlePath)
if ((Split-Path -Parent $resolvedBundle) -ne [IO.Path]::GetFullPath($repositoryRoot)) {
  throw 'Refusing to package outside the repository.'
}
New-Item -ItemType Directory -Force -Path $bundlePath | Out-Null
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'docs/examples/comic-ink-vectorizer.tf-plugin.js') -Destination $bundlePath -Force
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'LICENSE') -Destination $bundlePath -Force
$guide = Get-Content -LiteralPath (Join-Path $repositoryRoot 'docs/comic-ink-vectorizer.md') -Raw -Encoding utf8
$guide = $guide.Replace('(examples/comic-ink-vectorizer.tf-plugin.js)', '(comic-ink-vectorizer.tf-plugin.js)')
$guide = $guide.Replace('(images/comic-ink/', '(images/')
foreach ($document in @('plugin-bitmap-preparation.md', 'comic-ink-validation.md')) {
  $guide = $guide.Replace("($document)", "(https://github.com/shaboomi/terraForge/blob/main/docs/$document)")
}
$guide | Set-Content -LiteralPath (Join-Path $bundlePath 'CONTROL-GUIDE.md') -Encoding utf8
$imagePath = Join-Path $bundlePath 'images'
New-Item -ItemType Directory -Force -Path $imagePath | Out-Null
Copy-Item -Path (Join-Path $repositoryRoot 'docs/images/comic-ink/*') -Destination $imagePath -Force
$imageReadme = Get-Content -LiteralPath (Join-Path $imagePath 'README.md') -Raw -Encoding utf8
$imageReadme.Replace('(../spiral-sawtooth/README.md#portrait-attribution)', '(https://github.com/shaboomi/terraForge/blob/main/docs/images/spiral-sawtooth/README.md#portrait-attribution)') |
  Set-Content -LiteralPath (Join-Path $imagePath 'README.md') -Encoding utf8
$validation = Get-Content -LiteralPath (Join-Path $repositoryRoot 'docs/comic-ink-validation.md') -Raw -Encoding utf8
$validation.Replace('(images/comic-ink/', '(images/') | Set-Content -LiteralPath (Join-Path $bundlePath 'VALIDATION.md') -Encoding utf8
@'
COMIC INK VECTORIZER 1.0.0 - START HERE

Requires TerraForge with shared bitmap preparation (the current repository build).

1. In TerraForge choose Plugins > Open Plugin Folder.
2. Copy ONLY comic-ink-vectorizer.tf-plugin.js from this folder into that folder.
3. Choose Plugins > Rescan Plugins, or restart the app. Install one copy only.
4. Import a PNG/JPEG, select it, then Plugins > Bitmap to Vector > Comic Ink Vectorizer.
5. Start with Clean Comic, Automatic colours, Processing long edge 160.
6. Choose Preview, inspect the result, then Apply artwork. Hide the original image
   using its eye control to see the vectors. The original image stays untouched.
7. Save a .tforge layout. To revise, select a generated item, Edit with Comic Ink
   Vectorizer, Preview, then Update artwork. One Undo restores the complete group.

Read CONTROL-GUIDE.md for every control, physical pen spacing, algorithm and limits.
The images folder has actual path examples, separate passes, SVGs and attribution.
VALIDATION.md records passed checks and an unresolved existing test-suite error.

Colour items are NOT real pen assignments. Assign them to the pens you own using
TerraForge's Groups controls. Black ink has an optional explicit real-pen dropdown.
Both output modes use actual drawable coverage strokes, not solid SVG fills.
Pen width and artwork scale determine whether colours and shadows appear solid.
No cloud services, accounts, uploads or additional software are needed by the plugin.

This is automatic comic-inspired stylisation, not a professional illustration.
The image-derived hatch directions approximate image flow, not 3D surface shape.
Busy backgrounds and facial details can be lost, especially with Heavy Ink.
If capacity is exceeded, reduce resolution, increase spacing or choose Extended
artwork capacity. The plugin refuses the whole result instead of truncating it.
No physical plotter was operated during testing. The comic reference is not bundled.

You do not need a GitHub account or a pull request to install the plugin.
'@ | Set-Content -LiteralPath (Join-Path $bundlePath 'READ-ME-FIRST.txt') -Encoding utf8
Compress-Archive -LiteralPath $bundlePath -DestinationPath $archivePath -CompressionLevel Optimal -Force
$originalHash = (Get-FileHash -LiteralPath (Join-Path $repositoryRoot 'docs/examples/comic-ink-vectorizer.tf-plugin.js')).Hash
$packagedHash = (Get-FileHash -LiteralPath (Join-Path $bundlePath 'comic-ink-vectorizer.tf-plugin.js')).Hash
if ($originalHash -ne $packagedHash) { throw 'The packaged plugin differs from the tested source.' }
Write-Output "Created $archivePath"
Write-Output "Plugin SHA256: $packagedHash"
