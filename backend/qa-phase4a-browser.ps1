$ErrorActionPreference = 'Stop'
$backendRoot = (Resolve-Path '.').Path
$frontendRoot = (Resolve-Path '../frontend').Path
$logRoot = Join-Path $backendRoot '.qa-phase4a-log'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Get-Content -LiteralPath '../../backend/.env' | ForEach-Object {
  if ($_ -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { Set-Item -Path "Env:$($matches[1])" -Value $matches[2].Trim('"') }
}
$builder = [System.UriBuilder]::new([uri]$env:DATABASE_URL)
$builder.Path = 'cti_phase4a_qa_20261111'
$builder.Query = 'schema=public&connection_limit=2'
$env:DATABASE_URL = $builder.Uri.AbsoluteUri
if (([uri]$env:DATABASE_URL).AbsolutePath -ne '/cti_phase4a_qa_20261111') { throw 'QA database guard failed' }
$env:SICTI_ISOLATED_QA = 'true'
$env:SICTI_MONITORING_QA_ENABLED = 'true'
$env:TELEGRAM_POLL_ENABLED = 'false'
$nodeExe = (Get-Command node).Source
$api = $null
$web = $null
try {
  & $nodeExe qa-phase4a-fixture.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Fixture creation failed' }
  $api = Start-Process -FilePath $nodeExe -ArgumentList @('qa-phase4a-server.cjs') -WorkingDirectory $backendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'api.out') -RedirectStandardError (Join-Path $logRoot 'api.err')
  $web = Start-Process -FilePath $nodeExe -ArgumentList @('node_modules/next/dist/bin/next', 'start', '-p', '33014') -WorkingDirectory $frontendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'web.out') -RedirectStandardError (Join-Path $logRoot 'web.err')
  $ready = $false
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -Uri 'http://localhost:33014/login' -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { throw 'Frontend startup failed' }
  Push-Location $frontendRoot
  try { & $nodeExe e2e/phase4a-monitoring-browser.cjs; if ($LASTEXITCODE -ne 0) { throw 'Browser scenario failed' } }
  finally { Pop-Location }
} finally {
  foreach ($process in @($web, $api)) { if ($null -ne $process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } }
}
