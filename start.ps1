param(
    [switch]$NoOpen,
    [switch]$BehindCaddy
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$localNode = Join-Path $PSScriptRoot 'runtime\node.exe'
if (Test-Path -LiteralPath $localNode) {
    $node = $localNode
} else {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
}

if (-not $env:PGPASSWORD) {
    $password = Read-Host 'PostgreSQL password (Enter for layout preview without database)' -AsSecureString
    if ($password.Length) {
        $env:PGPASSWORD = [System.Net.NetworkCredential]::new('', $password).Password
    }
}
$mailSettingsPath = Join-Path $PSScriptRoot 'mail-settings.clixml'
if (Test-Path -LiteralPath $mailSettingsPath) {
    $mailSettings = Import-Clixml -LiteralPath $mailSettingsPath
    $env:SMTP_HOST = $mailSettings.HostName
    $env:SMTP_PORT = [string]$mailSettings.Port
    $env:SMTP_FROM = $mailSettings.From
    $env:SMTP_USER = $mailSettings.Credential.UserName
    $env:SMTP_PASSWORD = $mailSettings.Credential.GetNetworkCredential().Password
}
$nodeArgs = @(Join-Path $PSScriptRoot 'server.cjs')
if ($BehindCaddy) {
    $nodeArgs += '--behind-caddy'
}
if (-not $NoOpen) {
    $nodeArgs += '--open'
}
& $node @nodeArgs
exit $LASTEXITCODE
