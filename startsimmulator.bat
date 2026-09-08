@echo off
setlocal enabledelayedexpansion
title COBOL CoreBank - Kunden-Simulator

echo =======================================================
echo   COBOL CoreBank - Kunden-Simulator
echo   N parallele Bankkunden gegen PostgreSQL-Backend
echo =======================================================
echo.

cd /d "%~dp0"

REM 1. PostgreSQL
echo [INFO] Starte PostgreSQL (Docker Compose)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_postgres.ps1"
if errorlevel 1 (
    echo [FEHLER] PostgreSQL konnte nicht gestartet werden.
    pause
    exit /b 1
)
echo.

REM 2. COBOL Binary
if not exist "%~dp0bin\cobol_bank.exe" (
    echo [INFO] COBOL-Binary nicht gefunden. Starte Build...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build_cobol.ps1"
    if not exist "%~dp0bin\cobol_bank.exe" (
        echo [FEHLER] Kompilierung fehlgeschlagen.
        pause
        exit /b 1
    )
)

REM 3. Backend ggf. starten
netstat -ano | findstr ":3000 " | findstr ":0 " >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [STATUS] Backend laeuft bereits auf Port 3000.
    goto open_browser
)

echo [INFO] Starte Backend...
start "COBOL CoreBank Admin" /min node "%~dp0backend\server.js"

set /a attempts=0
:check_loop
timeout /t 1 /nobreak >nul 2>&1
netstat -ano | findstr ":3000 " | findstr ":0 " >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [ERFOLG] Backend online.
    goto open_browser
)
set /a attempts+=1
if %attempts% geq 10 goto open_browser
goto check_loop

:open_browser
echo [INFO] Oeffne Kunden-Simulator...
start "" "http://localhost:3000/simulator/"
echo.
echo =======================================================
echo   Simulator:  http://localhost:3000/simulator/
echo   Admin:      http://localhost:3000/
echo   Stop:       stop.bat
echo =======================================================
echo.
timeout /t 3 /nobreak >nul 2>&1
exit /b 0
