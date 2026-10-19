@echo off
cd /d "%~dp0"
echo [NEXO] Comprobando los módulos principales...
call npm test
if errorlevel 1 (echo [NEXO] Hay pruebas fallidas. & pause & exit /b 1)
echo [NEXO] Todas las pruebas pasaron.
pause
