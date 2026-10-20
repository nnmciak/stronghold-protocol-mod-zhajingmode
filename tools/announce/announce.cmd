@echo off
rem ===================================================================
rem  SERVER-WIDE NOTICE -- DOUBLE-CLICK THIS FILE (announce.cmd)
rem
rem  The message is read from notice.txt beside it, so there is nothing
rem  to type in a terminal and this file stays pure ASCII: a BOM or any
rem  non-ASCII byte in a .cmd breaks cmd.exe parsing on a Chinese
rem  Windows install (the console code page is not UTF-8).
rem
rem  Files in this folder:
rem    announce.cmd   <- double-click this one
rem    announce.ps1   <- does the work (no need to touch it)
rem    notice.txt     <- YOUR MESSAGE, edit in Notepad
rem
rem  Optional switches (only if you ever want them):
rem    announce.cmd warn    amber styling instead of teal
rem    announce.cmd error   red styling
rem    announce.cmd 120     disappears after 120 seconds
rem    announce.cmd clear   take the current notice down
rem ===================================================================
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0announce.ps1" %*
echo.
echo ================================================================
echo   Press any key to close this window.
echo ================================================================
pause >nul
