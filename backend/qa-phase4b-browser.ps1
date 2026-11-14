$ErrorActionPreference = 'Stop'
$backendRoot = (Resolve-Path '.').Path
$frontendRoot = (Resolve-Path '../frontend').Path
$logRoot = Join-Path $backendRoot '.qa-phase4b-log'
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
$env:SICTI_MONITORING_CONNECTOR_QA_ENABLED = 'true'
$env:SICTI_MONITORING_SIMULATOR_URL = 'http://127.0.0.1:33103/v1/collect'
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$simKey = New-Object byte[] 32
$identityKey = New-Object byte[] 32
$rng.GetBytes($simKey)
$rng.GetBytes($identityKey)
$env:SICTI_MONITORING_SIMULATOR_SECRET = [Convert]::ToBase64String($simKey).TrimEnd('=').Replace('+','-').Replace('/','_')
$env:SICTI_MONITORING_IDENTITY_ACTIVE_VERSION = 'v1'
$env:SICTI_MONITORING_IDENTITY_KEY_V1 = [Convert]::ToBase64String($identityKey).TrimEnd('=').Replace('+','-').Replace('/','_')
$env:TELEGRAM_POLL_ENABLED = 'false'
$nodeExe = (Get-Command node).Source
$api = $null
$web = $null
$simulator = $null
try {
  & $nodeExe qa-phase4a-fixture.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Fixture creation failed' }
  $simulator = Start-Process -FilePath $nodeExe -ArgumentList @('qa-phase4b-simulator.cjs') -WorkingDirectory $backendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'simulator.out') -RedirectStandardError (Join-Path $logRoot 'simulator.err')
  $api = Start-Process -FilePath $nodeExe -ArgumentList @('qa-phase4b-server.cjs') -WorkingDirectory $backendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'api.out') -RedirectStandardError (Join-Path $logRoot 'api.err')
  $web = Start-Process -FilePath $nodeExe -ArgumentList @('node_modules/next/dist/bin/next', 'start', '-p', '33014') -WorkingDirectory $frontendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'web.out') -RedirectStandardError (Join-Path $logRoot 'web.err')
  $ready = $false
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    if ($api.HasExited -or $web.HasExited -or $simulator.HasExited) { throw 'A Phase 4B QA service exited before readiness' }
    try {
      $response = Invoke-WebRequest -Uri 'http://localhost:33014/login' -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { throw 'Frontend startup failed' }
  Push-Location $frontendRoot
  try { & $nodeExe e2e/phase4b-monitoring-browser.cjs; if ($LASTEXITCODE -ne 0) { throw 'Browser scenario failed' } }
  finally { Pop-Location }
} finally {
  foreach ($process in @($web, $api, $simulator)) { if ($null -ne $process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } }
}
