@echo off
chcp 65001 >nul
title Dynamic Fit for Mplus
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 18 or newer from https://nodejs.org and try again.
  pause
  exit /b 1
)
echo Starting Dynamic Fit for Mplus (http://localhost:3401 or the next free port) ...
node serve.mjs --open
pause
