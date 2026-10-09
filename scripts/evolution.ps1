param(
    [ValidateSet('Save', 'Status', 'Check', 'Setup', 'Demo')]
    [string]$Action = 'Save',
    [string]$TestNumber,
    [switch]$ResetBootstrap
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-TTCredentialDirectory {
    Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'TT'
}

function Initialize-TTPrivateDirectory([string]$Directory) {
    if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Windows required.' }
    if (-not (Test-Path -LiteralPath $Directory)) {
        $null = New-Item -ItemType Directory -Path $Directory
    }
    if ((Get-Item -LiteralPath $Directory).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Credential directory must not be a link.'
    }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $currentAcl = Get-Acl -LiteralPath $Directory
    $rules = @($currentAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if ($currentAcl.AreAccessRulesProtected -and $rules.Count -eq 2 -and
        @($rules | Where-Object { $_.IdentityReference.Value -notin @($sid.Value, 'S-1-5-18') -or $_.AccessControlType -ne 'Allow' -or $_.FileSystemRights -ne 'FullControl' }).Count -eq 0) {
        return
    }
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($identity in @($sid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Directory -AclObject $acl
}

function Test-TTSettings([string]$Url, [string]$Instance) {
    $uri = $null
    if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
        throw 'Use an HTTPS base URL without credentials, query or fragment.'
    }
    if ([string]::IsNullOrWhiteSpace($Instance) -or $Instance.Length -gt 100 -or
        $Instance -match '[\x00-\x1f\x7f]') { throw 'Invalid instance name.' }
}

function Save-TTEvolutionCredentials(
    [string]$Directory, [string]$Url, [string]$Instance, [Security.SecureString]$ApiKey
) {
    Test-TTSettings $Url $Instance
    if ($ApiKey.Length -lt 1) { throw 'API key required.' }
    Initialize-TTPrivateDirectory $Directory
    $path = Join-Path $Directory 'evolution.dpapi'
    $temporary = Join-Path $Directory ('credentials-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $plain = $null; $payload = $null; $secure = $null
    try {
        $plain = [Net.NetworkCredential]::new('', $ApiKey).Password
        if ($plain -match '[\x00-\x1f\x7f]') { throw 'Invalid API key.' }
        $payload = @{ version = 1; url = $Url.TrimEnd('/'); instance = $Instance; apiKey = $plain } | ConvertTo-Json -Compress
        $secure = ConvertTo-SecureString -String $payload -AsPlainText -Force
        # No supplied encryption key: Windows DPAPI binds this to the current user/machine.
        $encrypted = ConvertFrom-SecureString -SecureString $secure
        [IO.File]::WriteAllText($temporary, $encrypted, [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporary -Destination $path -Force
    } finally {
        $plain = $null; $payload = $null
        if ($secure) { $secure.Dispose() }
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Read-TTEvolutionCredentials([string]$Directory) {
    $path = Join-Path $Directory 'evolution.dpapi'
    if (-not (Test-Path -LiteralPath $path)) { throw 'Credentials not saved.' }
    $secure = $null; $plain = $null
    try {
        $secure = ConvertTo-SecureString -String ([IO.File]::ReadAllText($path))
        $plain = [Net.NetworkCredential]::new('', $secure).Password
        $result = $plain | ConvertFrom-Json
        if ($result.version -ne 1 -or [string]::IsNullOrEmpty($result.apiKey)) { throw 'Invalid credential store.' }
        Test-TTSettings $result.url $result.instance
        return $result
    } finally {
        $plain = $null
        if ($secure) { $secure.Dispose() }
    }
}

function Set-TTDemoNumber([string]$Directory, [string]$Number) {
    $normalized = $Number -replace '[\s+()-]', ''
    if ($normalized -notmatch '^[1-9][0-9]{6,14}$') { throw 'Invalid test number.' }
    Initialize-TTPrivateDirectory $Directory
    [IO.File]::WriteAllText((Join-Path $Directory 'demo-number.txt'), $normalized)
}

function Use-TTEvolutionCredentials([string]$Directory, [scriptblock]$Command) {
    $names = @('EVOLUTION_URL', 'EVOLUTION_INSTANCE', 'EVOLUTION_API_KEY', 'TT_CREDENTIAL_DIRECTORY', 'TT_DEMO_NUMBER')
    $before = @{}
    foreach ($name in $names) { $before[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    $credentials = $null
    try {
        $credentials = Read-TTEvolutionCredentials $Directory
        [Environment]::SetEnvironmentVariable('EVOLUTION_URL', $credentials.url, 'Process')
        [Environment]::SetEnvironmentVariable('EVOLUTION_INSTANCE', $credentials.instance, 'Process')
        [Environment]::SetEnvironmentVariable('EVOLUTION_API_KEY', $credentials.apiKey, 'Process')
        [Environment]::SetEnvironmentVariable('TT_CREDENTIAL_DIRECTORY', $Directory, 'Process')
        $numberPath = Join-Path $Directory 'demo-number.txt'
        $number = if (Test-Path -LiteralPath $numberPath) { [IO.File]::ReadAllText($numberPath) } else { '' }
        [Environment]::SetEnvironmentVariable('TT_DEMO_NUMBER', $number, 'Process')
        & $Command
    } finally {
        foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $before[$name], 'Process') }
        if ($credentials) { $credentials.apiKey = $null }
    }
}

# Dot-sourcing defines functions only, for the local Windows regression test.
if ($MyInvocation.InvocationName -ne '.') {
    try {
        $directory = Get-TTCredentialDirectory
        if ($Action -eq 'Status') {
            Write-Output ('Evolution-Zugang gespeichert: ' + (Test-Path -LiteralPath (Join-Path $directory 'evolution.dpapi')))
            Write-Output ('Demo-Testnummer gespeichert: ' + (Test-Path -LiteralPath (Join-Path $directory 'demo-number.txt')))
        } elseif ($Action -eq 'Save') {
            $url = (Read-Host 'Evolution HTTPS-URL').Trim()
            $instance = (Read-Host 'Evolution Instanzname').Trim()
            Test-TTSettings $url $instance
            $key = Read-Host 'Evolution API-Key (verdeckte Eingabe)' -AsSecureString
            try { Save-TTEvolutionCredentials $directory $url $instance $key } finally { $key.Dispose() }
            if ($TestNumber) { Set-TTDemoNumber $directory $TestNumber }
            Write-Output 'Zugangsdaten dauerhaft mit Windows DPAPI gespeichert. Keine Verbindung oder Nachrichten ausgeloest.'
            Write-Output 'Du kannst Codex jetzt sagen: Zugangsdaten sind gespeichert.'
        } else {
            if ($TestNumber) { Set-TTDemoNumber $directory $TestNumber }
            if ($Action -eq 'Demo' -and -not (Test-Path -LiteralPath (Join-Path $directory 'demo-number.txt'))) {
                Set-TTDemoNumber $directory (Read-Host 'Eigene zweite WhatsApp-Testnummer mit Laendervorwahl')
            }
            $driver = Join-Path $PSScriptRoot 'evolution-live.mjs'
            Use-TTEvolutionCredentials $directory {
                $arguments = @($driver, $Action.ToLowerInvariant())
                if ($ResetBootstrap) { $arguments += '--reset-bootstrap' }
                & node @arguments
                if ($LASTEXITCODE -ne 0) { throw 'Evolution action failed.' }
            }
        }
    } catch {
        # Never format the exception: upstream errors can contain credentials.
        [Console]::Error.WriteLine('Aktion fehlgeschlagen. Eingaben, gespeicherten Zugang, Node.js und Verbindung pruefen. Keine Zugangsdaten ausgegeben.')
        exit 1
    }
}
