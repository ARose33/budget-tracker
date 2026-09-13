# Only the newly-created disposable restore project is permitted.
. (Join-Path $PSScriptRoot 'recovery-common.ps1')
$targetRef = 'blazhzqrxwwugvunkmud'
$workspace = Split-Path $PSScriptRoot -Parent
$privateRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'StackMint-Recovery'
$backupRoot = Join-Path $privateRoot 'backup-20260911T204516Z-03199106'
$work = Join-Path $privateRoot ('restore-' + $targetRef)
$statePath = Join-Path $work 'restore-state.json'
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json -AsHashtable
if ($state.TargetRef -ne $targetRef -or -not $state.DataVerified) { throw 'Verified isolated data restore is required first' }
function Read-EncryptedBytes([string]$Path) {
    return ,[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($Path),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
}
$keys = [Text.Encoding]::UTF8.GetString((Read-EncryptedBytes (Join-Path $work 'test-api-keys.json.dpapi'))) | ConvertFrom-Json
$service = @($keys | Where-Object name -eq 'service_role')
if ($service.Count -ne 1) { throw 'Isolated service credential unavailable' }
$headers = @{ apikey=$service[0].api_key; Authorization=('Bearer ' + $service[0].api_key); 'x-upsert'='true' }
$inventory = [Text.Encoding]::UTF8.GetString((Read-EncryptedBytes (Join-Path $backupRoot 'storage-inventory.json.dpapi'))) | ConvertFrom-Json
$manifest = Get-Content -LiteralPath (Join-Path $backupRoot 'manifest.json') -Raw | ConvertFrom-Json
$verified = 0
try {
    foreach ($object in $inventory.objects) {
        $name = 'storage-object-' + $verified + '.bin'
        $bytes = Read-EncryptedBytes (Join-Path $backupRoot ($name + '.dpapi'))
        $expected = @($manifest.Files | Where-Object File -eq ($name + '.dpapi'))[0].PlaintextSHA256
        if ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)) -ne $expected) { throw 'Source file checksum mismatch' }
        $encoded = [uri]::EscapeDataString([string]$object.bucket_id) + '/' + (($object.name -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/')
        $url = 'https://' + $targetRef + '.supabase.co/storage/v1/object/' + $encoded
        try { $null = Invoke-WebRequest -Uri $url -Method Post -Headers $headers -Body $bytes -ContentType 'application/octet-stream' } catch { throw 'Isolated Storage upload failed; private response omitted' }
        [Array]::Clear($bytes)
        $download = Join-Path $work ('restored-file-' + $verified + '.bin')
        try { $null = Invoke-WebRequest -Uri $url -Method Get -Headers $headers -OutFile $download } catch { throw 'Isolated Storage read failed; private response omitted' }
        if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $expected) { throw 'Restored Storage file checksum mismatch' }
        $null = Protect-RecoveryFile $download
        $verified++
    }
    $state.StorageVerified = $true
    $state.StorageFilesVerified = $verified
    [IO.File]::WriteAllText($statePath,($state | ConvertTo-Json -Depth 8))
    Write-Output ('Uploaded, downloaded, and verified all ' + $verified + ' restored Storage files in the isolated project.')
} catch {
    Write-Output 'Isolated file restore failed. Production was not changed.'
    if ($_.Exception.Message -match '^(Isolated Storage|Restored Storage|Source file checksum)') { Write-Output $_.Exception.Message }
    exit 1
}
