@echo off
cd /d "%~dp0"
echo Iniciando NEXO...
node --version
if errorlevel 1 (
  echo Primero tenes que instalar Node.js 22 o superior.
  pause
  exit /b 1
)
echo Abri: http://127.0.0.1:3377
npm start
pause
