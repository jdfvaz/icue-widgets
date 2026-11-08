@echo off
title Bambu bridge for XENEON EDGE
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed.
  echo Download the LTS version from https://nodejs.org, install it, then run this file again.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call npm install --omit=dev
)
if "%1"=="--demo" (
  node bridge.js --demo
) else (
  node bridge.js
)
pause
