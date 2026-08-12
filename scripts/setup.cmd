@echo off
setlocal
cd /d "%~dp0.."

where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 20 or newer from https://nodejs.org and run this again.
  exit /b 1
)

echo Node:
node -v
call npm install
if errorlevel 1 exit /b 1

if not exist .env (
  copy /y .env.example .env >nul
  echo Created .env from the template.
)

echo.
echo Next:
echo   npm run key
echo   npm run generate -- --count 5
echo   npm run status
