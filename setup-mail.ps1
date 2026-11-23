$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'Настройка почты LandScope. Понадобится пароль приложения почтового сервиса.'
$smtpHost = Read-Host 'SMTP-сервер (например smtp.gmail.com, smtp.yandex.ru или smtp.mail.ru)'
$smtpPortText = Read-Host 'Порт SMTP (Enter = 465)'
$smtpPort = if ($smtpPortText) { [int]$smtpPortText } else { 465 }
if ($smtpPort -notin 465, 587) { throw 'Укажите порт 465 или 587.' }
$smtpUser = Read-Host 'Логин SMTP (обычно адрес почты)'
$smtpFrom = Read-Host 'Адрес отправителя (Enter = логин SMTP)'
if (-not $smtpFrom) { $smtpFrom = $smtpUser }
$smtpSecret = Read-Host 'Пароль приложения почты' -AsSecureString
if (-not $smtpHost -or -not $smtpUser -or -not $smtpSecret.Length) { throw 'Заполните настройки SMTP.' }
[pscustomobject]@{
    HostName = $smtpHost
    Port = $smtpPort
    From = $smtpFrom
    Credential = [pscredential]::new($smtpUser, $smtpSecret)
} | Export-Clixml -LiteralPath "$PSScriptRoot/mail-settings.clixml"
Write-Host 'Настройки сохранены. Пароль зашифрован Windows для текущего пользователя.'
Write-Host 'Перезапустите LandScope через start.cmd.'