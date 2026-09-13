[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('blazhzqrxwwugvunkmud','jxmpeafhuedzepuadmmd')][string]$TargetRef)
. (Join-Path $PSScriptRoot 'recovery-common.ps1')
$workspace = Split-Path $PSScriptRoot -Parent
$privateRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'StackMint-Recovery'
$restoreRoot = Join-Path $privateRoot 'restore-blazhzqrxwwugvunkmud'
$statePath = Join-Path $restoreRoot 'restore-state.json'
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json -AsHashtable
if (-not $state.DataVerified -or -not $state.StorageVerified) { throw 'Verified database and file restoration required' }
if ($TargetRef -eq $state.SourceRef -and (-not $state.StageMigrationVerified -or -not $state.HostedChecksVerified)) { throw 'Verified isolated migration and hosted checks required' }
$migration = @(Get-ChildItem -LiteralPath (Join-Path $workspace 'supabase/migrations') -Filter '*_stackmint_v2_release.sql')
if ($migration.Count -ne 1 -or $migration[0].BaseName -notmatch '^(\d{14})_stackmint_v2_release$') { throw 'Unique CLI-generated release migration required' }
$version = $Matches[1]
$body = [IO.File]::ReadAllText($migration[0].FullName)
$hash = (Get-FileHash -LiteralPath $migration[0].FullName -Algorithm SHA256).Hash
if ($body.Contains('$stackmint_release_source$')) { throw 'Migration delimiter collision' }
$conflictMigration = @(Get-ChildItem -LiteralPath (Join-Path $workspace 'supabase/migrations') -Filter '*_stackmint_v2_http_conflicts.sql')
if ($conflictMigration.Count -ne 1 -or $conflictMigration[0].BaseName -notmatch '^(\d{14})_stackmint_v2_http_conflicts$') { throw 'Unique CLI-generated conflict correction required' }
$conflictVersion = $Matches[1]
$conflictBody = [IO.File]::ReadAllText($conflictMigration[0].FullName)
$conflictHash = (Get-FileHash -LiteralPath $conflictMigration[0].FullName -Algorithm SHA256).Hash
if ($conflictBody.Contains('$stackmint_release_source$')) { throw 'Migration delimiter collision' }
if ($TargetRef -eq $state.TargetRef -and $state.ContainsKey('ConflictFixVerified') -and $state.ConflictFixVerified) { throw 'Staging correction is already applied; do not replay migration history' }
if ($TargetRef -eq $state.SourceRef) {
    if ($state.ReleaseSHA256 -ne $hash) { throw 'Production migration differs from verified staging migration' }
    if (-not $state.ConflictFixVerified -or $state.ConflictSHA256 -ne $conflictHash) { throw 'Verified identical hosted conflict correction required' }
    $checkpoint = Get-Content -LiteralPath (Join-Path $privateRoot 'production-checkpoint.json') -Raw | ConvertFrom-Json
    if ($checkpoint.ProjectRef -ne $TargetRef -or $checkpoint.Status -ne 'exported-not-restored' -or ([DateTime]::UtcNow - [DateTime]::Parse($checkpoint.CreatedAtUtc)).TotalMinutes -gt 60) { throw 'A fresh completed production backup is required' }
}
$sql = "BEGIN;`nSET LOCAL lock_timeout='15s';`nSET LOCAL statement_timeout='120s';`n"
if ($TargetRef -eq $state.SourceRef -or -not $state.StageMigrationVerified) {
    $sql += $body + "`nINSERT INTO supabase_migrations.schema_migrations(version,statements,name) VALUES ('" + $version + "',ARRAY[`$stackmint_release_source`$" + $body + "`$stackmint_release_source`$],'stackmint_v2_release');`n"
} elseif ($state.ReleaseSHA256 -ne $hash) { throw 'Previously applied staging migration was changed' }
$sql += $conflictBody + "`nINSERT INTO supabase_migrations.schema_migrations(version,statements,name) VALUES ('" + $conflictVersion + "',ARRAY[`$stackmint_release_source`$" + $conflictBody + "`$stackmint_release_source`$],'stackmint_v2_http_conflicts');`nCOMMIT;`nSELECT true AS applied_and_original_fields_preserved;"
$path = Join-Path $privateRoot ('apply-release-' + $TargetRef + '.sql')
[IO.File]::WriteAllText($path,$sql.Replace("`r`n","`n"),[Text.UTF8Encoding]::new($false))
$environment = @{ DO_NOT_TRACK='1'; SUPABASE_TELEMETRY_DISABLED='1'; SUPABASE_HOME=(Join-Path $privateRoot 'supabase-cli') }
$result = Invoke-RecoveryTool (Join-Path $workspace '.tools/supabase-2.117.0/supabase.exe') @('db','query','--linked','--project-ref',$TargetRef,'--file',$path,'--output-format','json','--workdir',(Join-Path $privateRoot 'cli-workspace')) $environment
if ($result.ExitCode -ne 0) {
    $errorPath = Join-Path $privateRoot ('migration-error-' + [guid]::NewGuid().ToString('N') + '.txt')
    [IO.File]::WriteAllText($errorPath,$result.Error + $result.Output)
    $null = Protect-RecoveryFile $errorPath
    Write-Output 'Release migration failed; private diagnostics encrypted. No success is claimed.'
    exit 1
}
if ($result.Output -notmatch '"applied_and_original_fields_preserved"\s*:\s*true') { throw 'Migration success response missing; verify migration history before retrying' }
if ($TargetRef -eq $state.TargetRef) {
    $state.StageMigrationVerified=$true
    $state.ReleaseSHA256=$hash
    $state.ReleaseVersion=$version
    $state.ConflictFixVerified=$true
    $state.ConflictSHA256=$conflictHash
    $state.ConflictVersion=$conflictVersion
} else { $state.ProductionMigrationApplied=$true; $state.ProductionMigrationAppliedAt=[DateTime]::UtcNow.ToString('o') }
[IO.File]::WriteAllText($statePath,($state | ConvertTo-Json -Depth 8))
Write-Output ('Applied release through ' + $conflictVersion + ' atomically on ' + $TargetRef + '; preservation checks passed.')
