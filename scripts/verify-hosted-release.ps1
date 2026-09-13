. (Join-Path $PSScriptRoot 'recovery-common.ps1')
$privateRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'StackMint-Recovery'
$work = Join-Path $privateRoot 'restore-blazhzqrxwwugvunkmud'
$statePath = Join-Path $work 'restore-state.json'
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json -AsHashtable
if ($state.TargetRef -ne 'blazhzqrxwwugvunkmud' -or -not $state.StageMigrationVerified -or -not $state.ConflictFixVerified -or -not $state.DataVerified -or -not $state.StorageVerified) { throw 'Verified isolated restoration and migrations are required' }
$bytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $work 'test-api-keys.json.dpapi')),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
try {
    $keys = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    $service = @($keys | Where-Object name -eq 'service_role')
    $anon = @($keys | Where-Object name -eq 'anon')
    if ($service.Count -ne 1 -or $anon.Count -ne 1) { throw 'Test project credentials unavailable' }
    $inputJson = @{ projectRef=$state.TargetRef; serviceKey=$service[0].api_key; anonKey=$anon[0].api_key } | ConvertTo-Json -Compress
    $result = Invoke-RecoveryTool (Get-Command node).Source @((Join-Path $PSScriptRoot 'verify-hosted-release.mjs')) @{} $inputJson
    $report = $result.Output | ConvertFrom-Json
    if ($result.ExitCode -ne 0 -or -not $report.verified) {
        Write-Output ('Hosted verification failed at ' + $report.phase + ' (' + $report.code + '). Private responses omitted.')
        exit 1
    }
    $state.HostedChecksVerified=$true
    $state.HostedChecks=@($report.checks)
    $state.HostedChecksVerifiedAt=[DateTime]::UtcNow.ToString('o')
    foreach ($oldError in @('FailedPhase','ErrorType','ErrorLine')) { $state.Remove($oldError) }
    [IO.File]::WriteAllText($statePath,($state | ConvertTo-Json -Depth 8))
    Write-Output ('Hosted Auth, restored ledger reads, isolation, writer compatibility, persistence and concurrent edits passed (' + $report.checks.Count + ' checks).')
} finally { [Array]::Clear($bytes) }
