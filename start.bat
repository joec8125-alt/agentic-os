@echo off
REM Launch the AOS dashboard for C:\ai
cd /d "%~dp0"
echo Starting AOS dashboard for C:\ai ...
echo.
start "" http://localhost:4321
node server.js
