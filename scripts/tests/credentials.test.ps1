$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../evolution.ps1')
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('tt-credentials-test-' + [Guid]::NewGuid().ToString('N'))
$testKey = 'synthetic-credential-' + [Guid]::NewGuid().ToString('N')
$secret = ConvertTo-SecureString $testKey -AsPlainText -Force
$original = [Environment]::GetEnvironmentVariable('EVOLUTION_API_KEY', 'Process')
try {
    Save-TTEvolutionCredentials $testDir 'https://example.invalid' 'test-instance' $secret
    $encrypted = [IO.File]::ReadAllText((Join-Path $testDir 'evolution.dpapi'))
    if ($encrypted.Contains($testKey) -or $encrypted.Contains('example.invalid')) { throw 'Plaintext persisted.' }
    $decoded = Read-TTEvolutionCredentials $testDir
    if ($decoded.apiKey -ne $testKey -or $decoded.instance -ne 'test-instance') { throw 'Roundtrip failed.' }
    Set-TTDemoNumber $testDir '+49 170 1000000'
    if ([IO.File]::ReadAllText((Join-Path $testDir 'demo-number.txt')) -ne '491701000000') { throw 'Number normalization failed.' }
    $didThrow = $false
    try {
        Use-TTEvolutionCredentials $testDir {
            if ($env:EVOLUTION_API_KEY -ne $testKey) { throw 'Loading failed.' }
            throw 'Synthetic operation failure.'
        }
    } catch { $didThrow = $true }
    if (-not $didThrow -or [Environment]::GetEnvironmentVariable('EVOLUTION_API_KEY', 'Process') -cne $original) { throw 'Environment not restored.' }
    Save-TTEvolutionCredentials $testDir 'https://example.invalid' 'replaced-instance' $secret
    if ((Read-TTEvolutionCredentials $testDir).instance -ne 'replaced-instance') { throw 'Replacement failed.' }
    $rejected = $false
    try { Test-TTSettings 'https://user:password@example.invalid' 'instance' } catch { $rejected = $true }
    if (-not $rejected) { throw 'Embedded credentials accepted.' }
    $acl = Get-Acl -LiteralPath $testDir
    if (-not $acl.AreAccessRulesProtected) { throw 'ACL inheritance not restricted.' }
    Write-Output 'PASS: Windows DPAPI roundtrip, no plaintext, restricted ACL, replacement and environment restoration.'
} finally {
    $secret.Dispose()
    # Only the two exact files created by this test are removed; no recursive deletion.
    foreach ($name in @('evolution.dpapi', 'demo-number.txt')) {
        $path = Join-Path $testDir $name
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
    if (Test-Path -LiteralPath $testDir) { Remove-Item -LiteralPath $testDir }
}
