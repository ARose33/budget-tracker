Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-RecoveryTool {
    param([string]$Executable, [string[]]$Arguments, [hashtable]$Environment = @{}, [string]$InputText = '')
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    foreach ($entry in $Environment.GetEnumerator()) { $start.Environment[$entry.Key] = $entry.Value }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    try {
        $null = $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $inputFailed = $false
        try { if ($InputText) { $process.StandardInput.Write($InputText) } } catch { $inputFailed = $true }
        try { $process.StandardInput.Close() } catch { $inputFailed = $true }
        $process.WaitForExit()
        # Callers must never print raw output/errors from commands handling private data.
        $exitCode = if ($inputFailed -and $process.ExitCode -eq 0) { -1 } else { $process.ExitCode }
        return @{ ExitCode = $exitCode; Output = $stdout.GetAwaiter().GetResult(); Error = $stderr.GetAwaiter().GetResult() }
    } finally { $process.Dispose() }
}

function Protect-RecoveryFile {
    param([string]$Path)
    $bytes = [IO.File]::ReadAllBytes($Path)
    try {
        $encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $target = $Path + '.dpapi'
        if (Test-Path -LiteralPath $target) { throw 'Encrypted backup already exists' }
        [IO.File]::WriteAllBytes($target, $encrypted)
        $roundtrip = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($target), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $expected = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))
        if ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($roundtrip)) -ne $expected) { throw 'Backup encryption verification failed' }
        [Array]::Clear($roundtrip)
        Remove-Item -LiteralPath $Path
        return @{ File = [IO.Path]::GetFileName($target); PlaintextSHA256 = $expected; PlaintextBytes = $bytes.Length }
    } finally { [Array]::Clear($bytes) }
}

function Get-RecoveryConnection {
    param([string]$Cli, [string]$ProjectRef, [string]$PrivateRoot)
    $cliEnv = @{ DO_NOT_TRACK = '1'; SUPABASE_TELEMETRY_DISABLED = '1'; SUPABASE_HOME = (Join-Path $PrivateRoot 'supabase-cli') }
    $cliWork = Join-Path $PrivateRoot 'cli-workspace'
    $null = New-Item -ItemType Directory -Path $cliWork -Force
    $result = Invoke-RecoveryTool $Cli @('db','dump','--linked','--project-ref',$ProjectRef,'--dry-run','--output-format','text','--workdir',$cliWork) $cliEnv
    if ($result.ExitCode -ne 0) { throw ('Temporary connection failed (exit ' + $result.ExitCode + ')') }
    $connection = @{}
    foreach ($line in ($result.Output -split "`n")) {
        if ($line.TrimEnd("`r") -match '^export (PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)="([^"]*)"$') {
            # Treat CLI values as data; never execute its generated shell script.
            if ($Matches[2] -match '[`$\\]') { throw 'Unsupported connection escaping' }
            $connection[$Matches[1]] = $Matches[2]
        }
    }
    if ($connection.Count -ne 5) { throw 'Incomplete temporary connection configuration' }
    if ($connection.PGHOST -notmatch '(^db\.[a-z]{20}\.supabase\.co$|\.pooler\.supabase\.com$)' -or $connection.PGUSER -notmatch '^cli_login_postgres(\.[a-z]{20})?$' -or $connection.PGDATABASE -ne 'postgres') { throw 'Unexpected temporary connection destination' }
    if ($connection.PGUSER.Contains('.') -and -not $connection.PGUSER.EndsWith('.' + $ProjectRef)) { throw 'Connection project mismatch' }
    if ($connection.PGHOST.StartsWith('db.') -and $connection.PGHOST -ne ('db.' + $ProjectRef + '.supabase.co')) { throw 'Connection project mismatch' }
    $connection.PGSSLMODE = 'require'
    $connection.PGCONNECT_TIMEOUT = '20'
    $connection.PGAPPNAME = 'StackMint recovery export'
    $connection.PGCLIENTENCODING = 'UTF8'
    return $connection
}
