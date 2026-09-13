# Restores only the disposable project created for this rollout. Never targets production.
[CmdletBinding()]
param([ValidateSet('blazhzqrxwwugvunkmud')][string]$TargetRef = 'blazhzqrxwwugvunkmud')
. (Join-Path $PSScriptRoot 'recovery-common.ps1')
$workspace = Split-Path $PSScriptRoot -Parent
$privateRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'StackMint-Recovery'
$backupRoot = Join-Path $privateRoot 'backup-20260911T204516Z-03199106'
$work = Join-Path $privateRoot ('restore-' + $TargetRef)
$null = New-Item -ItemType Directory -Path $work -Force
$cli = Join-Path $workspace '.tools/supabase-2.117.0/supabase.exe'
$pgBin = Join-Path $workspace '.tools/postgresql-17.11/pgsql/bin'
$manifest = Get-Content -LiteralPath (Join-Path $backupRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.ProjectRef -eq $TargetRef -or $manifest.ProjectRef -ne 'jxmpeafhuedzepuadmmd') { throw 'Restore destination rejected' }
$statePath = Join-Path $work 'restore-state.json'
$state = if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json -AsHashtable } else { @{ TargetRef=$TargetRef; SourceRef=$manifest.ProjectRef; SchemaRestored=$false; DataRestored=$false; DataVerified=$false; StorageVerified=$false } }
function Save-State { [IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json -Depth 8)) }
function Unprotect-Artifact([string]$Name) {
    $entry = @($manifest.Files | Where-Object File -eq ($Name + '.dpapi'))[0]
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $backupRoot $entry.File)),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    if ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)) -ne $entry.PlaintextSHA256) { throw 'Recovery artifact checksum mismatch' }
    return ,$bytes
}
function Run-Sql([string]$Sql,[hashtable]$Connection) {
    $sqlPath = Join-Path $work ('query-' + [guid]::NewGuid().ToString('N') + '.sql')
    [IO.File]::WriteAllText($sqlPath, ("SET ROLE postgres;`n" + $Sql).Replace("`r`n","`n"), [Text.UTF8Encoding]::new($false))
    $result = Invoke-RecoveryTool (Join-Path $pgBin 'psql.exe') @('-X','-q','-A','-t','--no-password','-v','ON_ERROR_STOP=1','-f',$sqlPath) $Connection
    Remove-Item -LiteralPath $sqlPath
    if ($result.ExitCode -ne 0) {
        # Persist encrypted diagnostics, never print SQL/data from an error.
        $errorPath = Join-Path $work ('diagnostic-' + [guid]::NewGuid().ToString('N') + '.txt')
        [IO.File]::WriteAllText($errorPath,$result.Error)
        $null = Protect-RecoveryFile $errorPath
        throw ('Restore SQL failed (exit ' + $result.ExitCode + '); encrypted diagnostic retained')
    }
    return $result.Output
}
function Hash-CopyRows([string]$Rows) {
    $normalized = $Rows.Replace("`r`n","`n")
    [string[]]$lines = @()
    if ($normalized.Length) { $lines = $normalized.Substring(0,$normalized.Length - [int]$normalized.EndsWith("`n")) -split "`n" }
    [Array]::Sort($lines, [StringComparer]::Ordinal)
    return @{ Rows=$lines.Count; Hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes(($lines -join "`n")))) }
}
$phase = 'connection'
try {
    $connection = Get-RecoveryConnection $cli $TargetRef $privateRoot
    $connection.PGAPPNAME = 'StackMint isolated restore test'
    $dump = Join-Path $work 'database.dump'
    $bytes = Unprotect-Artifact 'database.dump'
    [IO.File]::WriteAllBytes($dump,$bytes)
    [Array]::Clear($bytes)
    if (-not $state.SchemaRestored) {
        $phase = 'empty target guard'
        $empty = (Run-Sql "select (select count(*) from pg_tables where schemaname='public') + (select count(*) from auth.users) + (select count(*) from storage.objects);" $connection).Trim()
        if ($empty -ne '0') { throw 'Disposable target is not empty; refusing restore' }
        $phase = 'application schema'
        $toc = Invoke-RecoveryTool (Join-Path $pgBin 'pg_restore.exe') @('--list',$dump)
        if ($toc.ExitCode -ne 0) { throw 'Archive list failed' }
        $schemas = 'public|real_estate_archive_20260810|security_archive_20260810|supabase_migrations'
        $selected = $toc.Output -split "`n" | Where-Object { ($_ -match ('^\d+; \d+ \d+ [A-Z ]+ (' + $schemas + ') ') -or $_ -match ('^\d+; \d+ \d+ SCHEMA - (' + $schemas + ') ')) -and $_ -notmatch 'DEFAULT ACL .* supabase_admin\s*$' }
        $tocPath = Join-Path $work 'application.toc'
        [IO.File]::WriteAllText($tocPath,($selected -join "`n"))
        $schemaPath = Join-Path $work 'application-schema.sql'
        $schema = Invoke-RecoveryTool (Join-Path $pgBin 'pg_restore.exe') @('--schema-only','--no-owner','--use-list',$tocPath,'--file',$schemaPath,$dump)
        if ($schema.ExitCode -ne 0) { throw 'Application schema extraction failed' }
        $null = Run-Sql ("BEGIN;`n" + [IO.File]::ReadAllText($schemaPath) + "`nCOMMIT;") $connection
        $state.SchemaRestored = $true
        Save-State
        Write-Output 'Application and archived schemas restored in the isolated project.'
    }
    $phase = 'extract archived table data'
    $dataPath = Join-Path $work 'table-data.sql'
    $data = Invoke-RecoveryTool (Join-Path $pgBin 'pg_restore.exe') @('--data-only','--file',$dataPath,$dump)
    if ($data.ExitCode -ne 0) { throw 'Table data extraction failed' }
    $dataSql = [IO.File]::ReadAllText($dataPath).Replace("`r`n","`n")
    $copies = [regex]::Matches($dataSql, '(?ms)^COPY (?<table>[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*) \((?<columns>[^\n]+)\) FROM stdin;\n(?<rows>.*?)^\\\.\n')
    if ($copies.Count -ne $manifest.DatabaseArchiveTableDataEntries) { throw 'Not every archived table data section was parsed' }
    # Keep platform migration ledgers and cron configuration as restored historical
    # data without downgrading platform services or scheduling copied jobs.
    $historical = @('auth.schema_migrations','storage.migrations','storage.buckets_vectors','storage.vector_indexes','cron.job','cron.job_run_details') + @($copies | ForEach-Object { $_.Groups['table'].Value } | Where-Object { $_.StartsWith('realtime.') })
    if (-not $state.DataRestored) {
        $phase = 'restore archived table records'
        $sourceConnection = Get-RecoveryConnection $cli $manifest.ProjectRef $privateRoot
        $definitions = Run-Sql "select coalesce(json_agg(x),'[]'::json) from (select n.nspname||'.'||c.relname as name, string_agg(format('%I %s',a.attname,format_type(a.atttypid,a.atttypmod)),', ' order by a.attnum) as columns from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped where c.relkind='r' and n.nspname in ('auth','storage','realtime','cron') group by n.nspname,c.relname) x;" $sourceConnection | ConvertFrom-Json
        $script = [Text.StringBuilder]::new()
        $null = $script.AppendLine('BEGIN; SET session_replication_role = replica; CREATE SCHEMA stackmint_recovery_metadata; REVOKE ALL ON SCHEMA stackmint_recovery_metadata FROM PUBLIC;')
        foreach ($copy in $copies) {
            $table = $copy.Groups['table'].Value
            $target = $table
            if ($historical -contains $table) {
                $target = 'stackmint_recovery_metadata.' + $table.Replace('.','__')
                $definition = @($definitions | Where-Object name -eq $table)
                if ($definition.Count -ne 1) { throw 'Historical table definition missing' }
                $null = $script.AppendLine(('CREATE TABLE ' + $target + ' (' + $definition[0].columns + ');'))
            }
            if ($copy.Groups['rows'].Value.Length) {
                $null = $script.AppendLine(('COPY ' + $target + ' (' + $copy.Groups['columns'].Value + ') FROM stdin;'))
                $null = $script.Append($copy.Groups['rows'].Value)
                $null = $script.AppendLine('\.')
            }
        }
        foreach ($sequence in [regex]::Matches($dataSql,"SELECT pg_catalog\.setval\('[^']+', [0-9]+, (?:true|false)\);")) {
            if ($sequence.Value -notmatch "'cron\.") { $null = $script.AppendLine($sequence.Value) }
        }
        $null = $script.AppendLine('COMMIT;')
        $null = Run-Sql $script.ToString() $connection
        $state.DataRestored = $true
        Save-State
        Write-Output ('Restored ' + $copies.Count + ' archived table datasets; copied schedules are inactive historical data.')
    }
    $phase = 'verify every restored original field'
    $verified = 0
    $expected = @()
    foreach ($copy in $copies) {
        $table = $copy.Groups['table'].Value
        $target = if ($historical -contains $table) { 'stackmint_recovery_metadata.' + $table.Replace('.','__') } else { $table }
        $before = Hash-CopyRows $copy.Groups['rows'].Value
        $after = Hash-CopyRows (Run-Sql ('COPY (SELECT ' + $copy.Groups['columns'].Value + ' FROM ' + $target + ') TO STDOUT;') $connection)
        if ($before.Rows -ne $after.Rows -or $before.Hash -ne $after.Hash) { throw ('Restored data mismatch at dataset ' + $verified) }
        $expected += @{ Table=$table; Target=$target; Columns=$copy.Groups['columns'].Value; Rows=$before.Rows; Hash=$before.Hash }
        $verified++
    }
    $state.DataVerified = $true
    $state.VerifiedDatasets = $verified
    $expectedPath = Join-Path $work 'original-field-hashes.json'
    [IO.File]::WriteAllText($expectedPath,($expected | ConvertTo-Json -Depth 5))
    if (-not (Test-Path -LiteralPath ($expectedPath + '.dpapi'))) { $null = Protect-RecoveryFile $expectedPath }
    Save-State
    Write-Output ('Verified original rows and every original field across all ' + $verified + ' restored datasets.')
} catch {
    $state.FailedPhase = $phase
    $state.ErrorType = $_.Exception.GetType().Name
    $state.ErrorLine = $_.InvocationInfo.ScriptLineNumber
    Save-State
    Write-Output ('Isolated restore stopped at: ' + $phase + '. Production was not changed.')
    Write-Output ('Local diagnostic: ' + $state.ErrorType + ', line ' + $state.ErrorLine)
    if ($_.Exception.Message -match '^(Restore SQL failed|Disposable target is not empty|Not every archived|Restored data mismatch|Historical table|Temporary connection|Incomplete temporary|Application schema|Table data extraction|Archive list)') { Write-Output $_.Exception.Message }
    exit 1
}
