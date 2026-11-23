@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
set "LANDSCOPE_EXIT_CODE=%ERRORLEVEL%"
pause
exit /b %LANDSCOPE_EXIT_CODE%
