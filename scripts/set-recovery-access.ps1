# Local credential capture only. Does not connect to or modify any database.
# Run interactively in Windows PowerShell or PowerShell on Windows.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z]{20}$')]
    [string]$ProjectRef,

    [switch]$PromptWindow
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
    if ($PromptWindow) {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        [Windows.Forms.Application]::EnableVisualStyles()
        $taskForm = New-Object Windows.Forms.Form
        try {
            $taskForm.Text = 'StackMint - secure backup access'
            $taskForm.ClientSize = New-Object Drawing.Size(610, 255)
            $taskForm.StartPosition = 'CenterScreen'
            $taskForm.FormBorderStyle = 'FixedDialog'
            $taskForm.MaximizeBox = $false
            $taskForm.MinimizeBox = $false
            $taskForm.TopMost = $true

            $taskLabel = New-Object Windows.Forms.Label
            $taskLabel.Location = New-Object Drawing.Point(18, 18)
            $taskLabel.Size = New-Object Drawing.Size(574, 95)
            $taskLabel.Text = "Enter the EXISTING Supabase database password.`r`nProject: $ProjectRef`r`n`r`nThis is separate from your website login. Saving is local and costs nothing."
            $taskForm.Controls.Add($taskLabel)

            $taskPasswordBox = New-Object Windows.Forms.TextBox
            $taskPasswordBox.Location = New-Object Drawing.Point(18, 116)
            $taskPasswordBox.Size = New-Object Drawing.Size(574, 25)
            $taskPasswordBox.UseSystemPasswordChar = $true
            $taskPasswordBox.AccessibleName = 'Existing Supabase database password'
            $taskForm.Controls.Add($taskPasswordBox)

            $taskHint = New-Object Windows.Forms.Label
            $taskHint.Location = New-Object Drawing.Point(18, 153)
            $taskHint.Size = New-Object Drawing.Size(574, 35)
            $taskHint.Text = 'Saved with Windows encryption outside OneDrive and Git. If you do not know the password, choose Cancel. No password will be reset.'
            $taskForm.Controls.Add($taskHint)

            $taskSaveButton = New-Object Windows.Forms.Button
            $taskSaveButton.Text = 'Save encrypted credential'
            $taskSaveButton.Location = New-Object Drawing.Point(295, 204)
            $taskSaveButton.Size = New-Object Drawing.Size(190, 32)
            $taskSaveButton.DialogResult = [Windows.Forms.DialogResult]::OK
            $taskSaveButton.Enabled = $false
            $taskForm.Controls.Add($taskSaveButton)
            $taskPasswordBox.Add_TextChanged({ $taskSaveButton.Enabled = $taskPasswordBox.TextLength -gt 0 })

            $taskCancelButton = New-Object Windows.Forms.Button
            $taskCancelButton.Text = 'Cancel'
            $taskCancelButton.Location = New-Object Drawing.Point(497, 204)
            $taskCancelButton.Size = New-Object Drawing.Size(95, 32)
            $taskCancelButton.DialogResult = [Windows.Forms.DialogResult]::Cancel
            $taskForm.Controls.Add($taskCancelButton)
            $taskForm.AcceptButton = $taskSaveButton
            $taskForm.CancelButton = $taskCancelButton
            $taskForm.Add_Shown({ $taskPasswordBox.Focus() })

            if ($taskForm.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) {
                Write-Host 'Cancelled; no credential saved.'
                return
            }
            $taskPassword = ConvertTo-SecureString $taskPasswordBox.Text -AsPlainText -Force
            $taskPasswordBox.Clear()
        } finally {
            $taskForm.Dispose()
        }
    } else {
        $taskPassword = Read-Host 'Existing database password (input is hidden)' -AsSecureString
    }
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
