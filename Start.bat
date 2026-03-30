@echo off
cd /d "%~dp0"
call npx tsc
call npx electron .
