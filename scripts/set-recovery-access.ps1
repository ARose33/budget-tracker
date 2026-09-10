# Local credential capture only. Does not connect to or modify any database.
# Run interactively in Windows PowerShell or PowerShell on Windows.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z]{20}$')]
    [string]$ProjectRef
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This helper requires Windows user-bound credential encryption.'
}

$taskPrivateRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'StackMint-Recovery'
$taskCredentialPath = Join-Path $taskPrivateRoot ($ProjectRef + '-' + [guid]::NewGuid().ToString('N') + '.credential.xml')
$taskPassword = $null

try {
    if (Test-Path -LiteralPath $taskPrivateRoot) {
        $taskRootInfo = Get-Item -LiteralPath $taskPrivateRoot -Force
        if (-not $taskRootInfo.PSIsContainer -or ($taskRootInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'The recovery location must be a normal local directory.'
        }
    } else {
        $null = New-Item -ItemType Directory -Path $taskPrivateRoot
    }

    # Only this Windows user can access the directory. The password is also
    # encrypted by Windows DPAPI when Export-Clixml serializes PSCredential.
    $taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $taskAcl = New-Object Security.AccessControl.DirectorySecurity
    $taskAcl.SetOwner($taskIdentity.User)
    $taskAcl.SetAccessRuleProtection($true, $false)
    $taskRule = New-Object Security.AccessControl.FileSystemAccessRule(
        $taskIdentity.User,
        [Security.AccessControl.FileSystemRights]::FullControl,
        ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow
    )
    $taskAcl.AddAccessRule($taskRule)
    Set-Acl -LiteralPath $taskPrivateRoot -AclObject $taskAcl

    Write-Host 'Enter the EXISTING Supabase database password for the project below.'
    Write-Host ('Project: ' + $ProjectRef)
    Write-Host 'This is not your Supabase website sign-in password or an API key.'
    Write-Host 'No password reset, database connection, backup, or production change is performed.'
    $taskPassword = Read-Host 'Existing database password (input is hidden)' -AsSecureString
    if ($taskPassword.Length -eq 0) { throw 'No password was provided; no credential was saved.' }

    $taskCredential = New-Object Management.Automation.PSCredential('postgres', $taskPassword)
    [pscustomobject]@{
        Purpose = 'StackMint approved recovery preparation'
        ProjectRef = $ProjectRef
        CreatedAtUtc = [DateTime]::UtcNow.ToString('o')
        Credential = $taskCredential
    } | Export-Clixml -LiteralPath $taskCredentialPath -NoClobber

    Write-Host 'Encrypted credential saved outside the repository and OneDrive:'
    Write-Host $taskCredentialPath
    Write-Host 'Tell Codex that recovery access is saved. Do not send the password or this file in chat.'
} finally {
    if ($null -ne $taskPassword) { $taskPassword.Dispose() }
}
