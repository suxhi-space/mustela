@echo off
rem Build Mustela on Windows.  Usage: build.cmd   (menu)   or   build.cmd --platform windows
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" %*
exit /b %ERRORLEVEL%
