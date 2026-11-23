@echo off
setlocal

set "CADDY_EXE=%~dp0caddy_windows_amd64.exe"
if not exist "%CADDY_EXE%" set "CADDY_EXE=%~dp0caddy.exe"
if not exist "%CADDY_EXE%" (
    where.exe caddy.exe >nul 2>&1
    if errorlevel 1 (
        echo Caddy not found. Put caddy.exe next to start-caddy.cmd or add it to PATH.
        pause
        exit /b 1
    )
    set "CADDY_EXE=caddy.exe"
)

"%CADDY_EXE%" run --config "%~dp0Caddyfile" --adapter caddyfile
set "CADDY_EXIT_CODE=%ERRORLEVEL%"
if not "%CADDY_EXIT_CODE%"=="0" pause
exit /b %CADDY_EXIT_CODE%
