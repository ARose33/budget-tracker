# Read-only remote export. No migrations, resets, provider calls, or paid resources.
[CmdletBinding()]
param([Parameter(Mandatory)][ValidatePattern('^[a-z]{20}$')][string]$ProjectRef)
. (Join-Path $PSScriptRoot 'recovery-common.ps1')
$workspace = Split-Path $PSScriptRoot -Parent
$cli = Join-Path $workspace '.tools/supabase-2.117.0/supabase.exe'
$pgBin = Join-Path $workspace '.tools/postgresql-17.11/pgsql/bin'
$privateRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'StackMint-Recovery'
$rootInfo = Get-Item -LiteralPath $privateRoot -Force
if (-not $rootInfo.PSIsContainer -or ($rootInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid private backup directory' }
$backupRoot = Join-Path $privateRoot ('backup-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
$null = New-Item -ItemType Directory -Path $backupRoot
$manifest = @{ ProjectRef = $ProjectRef; CreatedAtUtc = [DateTime]::UtcNow.ToString('o'); Files = @(); Status = 'incomplete'; RestoreVerified = $false }
$phase = 'connect'
try {
    $connection = Get-RecoveryConnection $cli $ProjectRef $privateRoot
    $phase = 'database archive'
    $dumpPath = Join-Path $backupRoot 'database.dump'
    $result = Invoke-RecoveryTool (Join-Path $pgBin 'pg_dump.exe') @('--format=custom','--role=postgres','--no-password','--lock-wait-timeout=10000','--file',$dumpPath) $connection
    if ($result.ExitCode -ne 0) {
        $category = if ($result.Error -match 'permission denied') { 'permission denied' } elseif ($result.Error -match 'SSL|certificate') { 'TLS connection' } elseif ($result.Error -match 'authentication|password') { 'authentication' } else { 'database export' }
        throw ('Export failed: ' + $category + ' (exit ' + $result.ExitCode + ')')
    }
    $archiveList = Invoke-RecoveryTool (Join-Path $pgBin 'pg_restore.exe') @('--list',$dumpPath)
    if ($archiveList.ExitCode -ne 0 -or $archiveList.Output -notmatch 'TABLE DATA') { throw 'Database archive cannot be read' }
    $manifest.DatabaseArchiveTableDataEntries = ([regex]::Matches($archiveList.Output, '(?m)^\d+;.* TABLE DATA ')).Count
    $manifest.Files += Protect-RecoveryFile $dumpPath
    Write-Output 'Database archive exported, encrypted, and readable. Restore not yet verified.'

    $phase = 'roles export'
    $rolesPath = Join-Path $backupRoot 'roles.sql'
    $result = Invoke-RecoveryTool (Join-Path $pgBin 'pg_dumpall.exe') @('--roles-only','--role=postgres','--no-role-passwords','--no-password','--file',$rolesPath) $connection
    if ($result.ExitCode -ne 0) { throw ('Role export failed (exit ' + $result.ExitCode + ')') }
    $manifest.Files += Protect-RecoveryFile $rolesPath

    $phase = 'storage inventory'
    $inventoryPath = Join-Path $backupRoot 'storage-inventory.json'
    $inventorySql = "select json_build_object('buckets',(select coalesce(json_agg(b),'[]'::json) from storage.buckets b),'objects',(select coalesce(json_agg(o),'[]'::json) from storage.objects o));"
    $result = Invoke-RecoveryTool (Join-Path $pgBin 'psql.exe') @('-X','-q','-A','-t','--no-password','-v','ON_ERROR_STOP=1','-c',('SET ROLE postgres; ' + $inventorySql),'-o',$inventoryPath) $connection
    if ($result.ExitCode -ne 0) { throw 'Storage inventory export failed' }
    $inventory = [IO.File]::ReadAllText($inventoryPath) | ConvertFrom-Json
    $sourceEnvPath = Join-Path (Split-Path $workspace -Parent) '.env.local'
    $sourceEnv = @{}
    foreach ($line in [IO.File]::ReadAllLines($sourceEnvPath)) {
        if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { $sourceEnv[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
    }
    $sourceUrl = $sourceEnv['NEXT_PUBLIC_SUPABASE_URL'].TrimEnd('/')
    if (([uri]$sourceUrl).Host -ne ($ProjectRef + '.supabase.co')) { throw 'Storage source project mismatch' }
    $headers = @{ apikey = $sourceEnv['SUPABASE_SERVICE_ROLE_KEY']; Authorization = ('Bearer ' + $sourceEnv['SUPABASE_SERVICE_ROLE_KEY']) }
    $objectIndex = 0
    foreach ($object in $inventory.objects) {
        $phase = 'storage file bytes'
        $encodedPath = [uri]::EscapeDataString([string]$object.bucket_id) + '/' + (($object.name -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/')
        $objectFile = Join-Path $backupRoot ('storage-object-' + $objectIndex + '.bin')
        try { $null = Invoke-WebRequest -Uri ($sourceUrl + '/storage/v1/object/' + $encodedPath) -Headers $headers -OutFile $objectFile } catch { throw 'Storage file download failed; private URL and response omitted' }
        $manifest.Files += Protect-RecoveryFile $objectFile
        $objectIndex++
    }
    $manifest.StorageObjectCount = $objectIndex
    $manifest.StorageBucketCount = @($inventory.buckets).Count
    $manifest.Files += Protect-RecoveryFile $inventoryPath
    $sourceConfigPath = Join-Path $backupRoot 'source-environment.txt'
    [IO.File]::WriteAllText($sourceConfigPath, [IO.File]::ReadAllText($sourceEnvPath))
    $manifest.Files += Protect-RecoveryFile $sourceConfigPath

    $phase = 'root encryption key'
    $cliEnv = @{ DO_NOT_TRACK='1'; SUPABASE_TELEMETRY_DISABLED='1'; SUPABASE_HOME=(Join-Path $privateRoot 'supabase-cli') }
    $result = Invoke-RecoveryTool $cli @('encryption','get-root-key','--project-ref',$ProjectRef,'--output-format','json') $cliEnv
    if ($result.ExitCode -ne 0) { throw 'Root encryption key export failed' }
    $rootKeyPath = Join-Path $backupRoot 'project-root-key.json'
    [IO.File]::WriteAllText($rootKeyPath, $result.Output)
    $manifest.Files += Protect-RecoveryFile $rootKeyPath

    $phase = 'remote configuration'
    $result = Invoke-RecoveryTool $cli @('init','--workdir',$backupRoot,'--output-format','json') $cliEnv
    if ($result.ExitCode -ne 0) { throw 'Remote configuration export failed: local configuration setup' }
    $result = Invoke-RecoveryTool $cli @('config','pull','--project-ref',$ProjectRef,'--dry-run','--output-format','text','--workdir',$backupRoot) $cliEnv
    if ($result.ExitCode -ne 0) { throw 'Remote configuration export failed' }
    $configPath = Join-Path $backupRoot 'remote-configuration.txt'
    [IO.File]::WriteAllText($configPath, $result.Output)
    $manifest.Files += Protect-RecoveryFile $configPath
    $manifest.Status = 'exported-not-restored'
} catch {
    $manifest.FailedPhase = $phase
    Write-Output ('Backup incomplete at phase: ' + $phase + '. Production data was not changed.')
    # Only fixed messages produced by this script are suitable for reporting.
    if ($_.Exception.Message -match '^(Temporary connection failed|Incomplete temporary|Unsupported connection|Unexpected temporary|Connection project|Export failed:|Database archive cannot|Role export failed|Storage inventory export failed|Storage source project mismatch|Storage file download failed|Root encryption key export failed|Remote configuration export failed)') { Write-Output $_.Exception.Message }
} finally {
    # Encrypt partial exports too. Never delete an unencrypted file before its round-trip check.
    foreach ($remaining in Get-ChildItem -LiteralPath $backupRoot -File | Where-Object { $_.Extension -ne '.dpapi' -and $_.Name -ne 'manifest.json' }) {
        $manifest.Files += Protect-RecoveryFile $remaining.FullName
    }
    [IO.File]::WriteAllText((Join-Path $backupRoot 'manifest.json'), ($manifest | ConvertTo-Json -Depth 5))
    Write-Output ('Protected backup directory: ' + $backupRoot)
    Write-Output ('Status: ' + $manifest.Status)
}
if ($manifest.Status -ne 'exported-not-restored') { exit 1 }
