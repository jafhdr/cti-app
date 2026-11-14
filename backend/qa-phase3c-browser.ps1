$ErrorActionPreference = 'Stop'
$backendRoot = (Resolve-Path '.').Path
$frontendRoot = (Resolve-Path '../frontend').Path
$logRoot = Join-Path $backendRoot '.qa-phase3c-log'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Get-Content -LiteralPath '../../backend/.env' | ForEach-Object {
  if ($_ -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { Set-Item -Path "Env:$($matches[1])" -Value $matches[2].Trim('"') }
}
$builder = [System.UriBuilder]::new([uri]$env:DATABASE_URL)
$builder.Path = 'cti_soar_qa_20261110133159'
$builder.Query = 'schema=public&connection_limit=2'
$env:DATABASE_URL = $builder.Uri.AbsoluteUri
if (([uri]$env:DATABASE_URL).AbsolutePath -ne '/cti_soar_qa_20261110133159') { throw 'QA database guard failed' }
$env:SICTI_SOAR_QA_ENABLED = 'true'
$env:SICTI_ISOLATED_QA = 'true'
$secretBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
$env:SICTI_SOAR_SANDBOX_SECRET = -join ($secretBytes | ForEach-Object { $_.ToString('x2') })
$env:SICTI_SOAR_MOCK_STATE_FILE = "browser3c-$([guid]::NewGuid().ToString('N')).json"
$nodeExe = (Get-Command node).Source
$mock = $null
$api = $null
$web = $null
try {
  & $nodeExe qa-phase3b-fixture.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Fixture creation failed' }
  $mock = Start-Process -FilePath $nodeExe -ArgumentList @('qa-phase3b-mock-tool.cjs') -WorkingDirectory $backendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'mock.out') -RedirectStandardError (Join-Path $logRoot 'mock.err')
  $port = $null
  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 250
    $line = Get-Content -LiteralPath (Join-Path $logRoot 'mock.out') -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($line -match '127\.0\.0\.1:(\d+)') { $port = $matches[1]; break }
  }
  if (-not $port) { throw 'Mock tool startup failed' }
  $env:SICTI_SOAR_SANDBOX_URL = "http://127.0.0.1:$port/"
  $env:SICTI_SOAR_MOCK_PID = [string]$mock.Id
  $api = Start-Process -FilePath $nodeExe -ArgumentList @('qa-phase3a-server.cjs') -WorkingDirectory $backendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'api.out') -RedirectStandardError (Join-Path $logRoot 'api.err')
  $web = Start-Process -FilePath $nodeExe -ArgumentList @('node_modules/next/dist/bin/next', 'start', '-p', '33010') -WorkingDirectory $frontendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'web.out') -RedirectStandardError (Join-Path $logRoot 'web.err')
  $ready = $false
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -Uri 'http://localhost:33010/login' -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { throw 'Frontend startup failed' }
  Push-Location $frontendRoot
  try { & $nodeExe e2e/phase3c-sandbox-restart-browser.cjs; if ($LASTEXITCODE -ne 0) { throw 'Browser scenario failed' } }
  finally { Pop-Location }
} finally {
  foreach ($process in @($web, $api, $mock)) { if ($null -ne $process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } }
}
