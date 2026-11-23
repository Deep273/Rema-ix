$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:LANDSCOPE_NEW_USERNAME = Read-Host 'Логин нового пользователя'
$secret = Read-Host 'Пароль пользователя (минимум 10 символов)' -AsSecureString
$confirmation = Read-Host 'Повторите пароль' -AsSecureString
$plain = [System.Net.NetworkCredential]::new('', $secret).Password
if ($plain -cne [System.Net.NetworkCredential]::new('', $confirmation).Password) { throw 'Пароли не совпадают.' }
try {
    $env:LANDSCOPE_NEW_PASSWORD = $plain

    & "$PSScriptRoot/runtime/node.exe" "$PSScriptRoot/auth-setup.cjs"
    if ($LASTEXITCODE -ne 0) { throw 'Аккаунт не создан. См. сообщение выше.' }
} finally {
    Remove-Item Env:LANDSCOPE_NEW_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:LANDSCOPE_NEW_USERNAME -ErrorAction SilentlyContinue
    $plain = $null
}