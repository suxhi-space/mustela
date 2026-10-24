# Build Mustela on Windows.   .\build.cmd   (menu)   or   .\build.cmd --platform windows|android|web
# Missing tools (Node.js, Rust, Visual Studio C++ build tools, Java, Android SDK) are offered for install.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$NodeVersion = "v22.12.0"
$Toolchain = if ($env:MUSTELA_TOOLCHAIN) { $env:MUSTELA_TOOLCHAIN } else { Join-Path $HOME ".mustela\toolchain" }

function Test-Node {
  $n = Get-Command node -ErrorAction SilentlyContinue
  if (-not $n) { return $false }
  try { return ([int](& node -p "process.versions.node.split('.')[0]")) -ge 20 } catch { return $false }
}

$local = Join-Path $Toolchain "node"
if (-not (Test-Node) -and (Test-Path (Join-Path $local "node.exe"))) { $env:Path = "$local;$env:Path" }

if (-not (Test-Node)) {
  Write-Host "Node.js 20+ is needed to run the build."
  $a = Read-Host "Download Node.js $NodeVersion into $local (for your user only)? [Y/n]"
  if ($a -match '^[Nn]') { Write-Host "Install it from https://nodejs.org and run this again."; exit 1 }
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
  $name = "node-$NodeVersion-win-$arch"
  New-Item -ItemType Directory -Force -Path $Toolchain | Out-Null
  $zip = Join-Path $Toolchain "node.zip"
  Write-Host "Downloading https://nodejs.org/dist/$NodeVersion/$name.zip"
  $ProgressPreference = "SilentlyContinue"
  Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/$name.zip" -OutFile $zip
  if (Test-Path $local) { Remove-Item -Recurse -Force $local }
  Expand-Archive $zip -DestinationPath $Toolchain -Force
  Rename-Item (Join-Path $Toolchain $name) "node"
  Remove-Item $zip
  $env:Path = "$local;$env:Path"
  Write-Host "Node.js $(node --version) ready."
}

& node scripts\build.mjs @args
exit $LASTEXITCODE
