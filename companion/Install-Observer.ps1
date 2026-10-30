$ErrorActionPreference = 'Stop'
$observerRoot = $PSScriptRoot
$runtimeFolder = Join-Path $observerRoot 'runtime'
$nodeFile = Join-Path $runtimeFolder 'node.exe'
$runtimeVersion = 'v24.19.0'
if (-not (Test-Path -LiteralPath $nodeFile)) {
  Write-Host 'First run: downloading the portable Node.js runtime. No administrator access is needed.'
  $archiveName = "node-$runtimeVersion-win-x64.zip"
  $archiveFile = Join-Path $observerRoot $archiveName
  $baseUrl = "https://nodejs.org/dist/$runtimeVersion/"
  Invoke-WebRequest -UseBasicParsing -Uri ($baseUrl + $archiveName) -OutFile $archiveFile
  $checksums = (Invoke-WebRequest -UseBasicParsing -Uri ($baseUrl + 'SHASUMS256.txt')).Content
  $expected = (($checksums -split "`n" | Where-Object { $_ -match ([regex]::Escape($archiveName) + '\s*$') }) -split '\s+')[0]
  if (-not $expected -or (Get-FileHash -LiteralPath $archiveFile -Algorithm SHA256).Hash -ne $expected) { throw 'Runtime checksum failed. Download was not used.' }
  Expand-Archive -LiteralPath $archiveFile -DestinationPath $observerRoot -Force
  Move-Item -LiteralPath (Join-Path $observerRoot "node-$runtimeVersion-win-x64") -Destination $runtimeFolder
  Remove-Item -LiteralPath $archiveFile
}
if (-not (Test-Path -LiteralPath (Join-Path $observerRoot 'collector/node_modules/deadem/package.json'))) {
  Write-Host 'First run: installing the pinned demo parser.'
  & $nodeFile (Join-Path $runtimeFolder 'node_modules/npm/bin/npm-cli.js') ci --prefix (Join-Path $observerRoot 'collector') --omit=dev --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Parser installation failed.' }
}
